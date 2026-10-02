import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const digestPattern = /^[a-f0-9]{64}$/;
const groups = ['server', 'renderer', 'android', 'pi'];
const components = ['server', 'android', 'pi'];
const protocols = {
  playerSync: ['android', 'pi'],
  playlistManifest: ['android', 'pi'],
  androidUpdate: ['android'],
};

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(directory, path) {
  return JSON.parse(readFileSync(resolve(directory, path), 'utf8'));
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameKeys(value, names) {
  return (
    object(value) &&
    Object.keys(value).sort(compareStrings).join('\n') ===
      [...names].sort(compareStrings).join('\n')
  );
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort(compareStrings)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function currentVersions(directory = root) {
  const server = readJson(directory, 'package.json').version;
  const player = readJson(directory, 'player/version.json').version;
  if (
    typeof server !== 'string' ||
    typeof player !== 'string' ||
    !versionPattern.test(server) ||
    !versionPattern.test(player)
  )
    throw new Error('Server and player must each have a plain X.Y.Z version');
  return { server, player };
}

export function validateProtocols(support) {
  if (!sameKeys(support, Object.keys(protocols)))
    throw new Error(
      'Expected playerSync, playlistManifest, and androidUpdate protocols',
    );
  for (const [name, consumers] of Object.entries(protocols)) {
    if (!sameKeys(support[name], components))
      throw new Error(`${name} needs server, android, and pi support arrays`);
    for (const component of components) {
      const versions = support[name][component];
      if (
        !Array.isArray(versions) ||
        versions.some((value) => !Number.isSafeInteger(value) || value < 1) ||
        new Set(versions).size !== versions.length
      )
        throw new Error(
          `${name}.${component} must list unique positive protocol versions`,
        );
      if (name === 'androidUpdate' && component === 'pi') {
        if (versions.length)
          throw new Error(
            'androidUpdate.pi must be empty: the Pi does not install APK updates',
          );
      } else if (!versions.length) {
        throw new Error(
          `${name}.${component} must support at least one protocol version`,
        );
      }
    }
    for (const consumer of consumers)
      if (
        !support[name].server.some((version) =>
          support[name][consumer].includes(version),
        )
      )
        throw new Error(
          `${name}: server and ${consumer} have no shared protocol version; review both components`,
        );
  }
  return support;
}

function sourceFiles(directory, path, include = () => true, recursive = true) {
  const result = [];
  for (const entry of readdirSync(resolve(directory, path), {
    withFileTypes: true,
  })) {
    const child = `${path}/${entry.name}`;
    if (entry.isSymbolicLink())
      throw new Error(
        `Compatibility source cannot be a symbolic link: ${child}`,
      );
    if (entry.isDirectory() && recursive)
      result.push(...sourceFiles(directory, child, include));
    else if (entry.isFile() && include(child)) result.push(child);
  }
  return result.sort(compareStrings);
}

/** Conservative source fingerprints, not an inference of wire compatibility. */
export function collectFingerprints(directory = root) {
  const sources = {
    server: sourceFiles(directory, 'server', (path) => path.endsWith('.mjs')),
    renderer: sourceFiles(directory, 'player/web'),
    android: [
      ...sourceFiles(
        directory,
        'player/android/app/src/main',
        (path) =>
          path.endsWith('.java') || path.endsWith('AndroidManifest.xml'),
      ),
      'player/android/app/build.gradle',
      'player/android/release-signing.json',
    ].sort(compareStrings),
    pi: sourceFiles(directory, 'player', (path) => path.endsWith('.py'), false),
  };
  return Object.fromEntries(
    Object.entries(sources).map(([group, paths]) => {
      if (!paths.length)
        throw new Error(`No compatibility source files found for ${group}`);
      return [
        group,
        Object.fromEntries(
          paths.map((path) => {
            let source = readFileSync(resolve(directory, path));
            if (path === 'player/agent.py')
              source = Buffer.from(
                source
                  .toString('utf8')
                  .replace(
                    /^VERSION\s*=\s*(['"])[^'"\r\n]+\1\r?$/gm,
                    'VERSION = "<player-version>"',
                  ),
              );
            return [path, createHash('sha256').update(source).digest('hex')];
          }),
        ),
      ];
    }),
  );
}

function validateReview(review) {
  if (
    !object(review) ||
    !['compatible', 'breaking'].includes(review.impact) ||
    typeof review.summary !== 'string' ||
    !review.summary.trim() ||
    /[\r\n]/.test(review.summary) ||
    typeof review.reviewedAt !== 'string' ||
    !Number.isFinite(Date.parse(review.reviewedAt)) ||
    !sameKeys(review.versions, ['server', 'player']) ||
    !Object.values(review.versions).every(
      (value) => typeof value === 'string' && versionPattern.test(value),
    )
  )
    throw new Error('Invalid compatibility review record');
  validateProtocols(review.protocols);
  if (!sameKeys(review.fingerprints, groups))
    throw new Error('Invalid compatibility review fingerprints');
  for (const group of groups) {
    const fingerprints = review.fingerprints[group];
    if (
      !object(fingerprints) ||
      !Object.keys(fingerprints).length ||
      Object.entries(fingerprints).some(
        ([path, digest]) =>
          !path ||
          path.includes('\\') ||
          path.startsWith('/') ||
          path.split('/').includes('..') ||
          typeof digest !== 'string' ||
          !digestPattern.test(digest),
      )
    )
      throw new Error(`Invalid ${group} compatibility review fingerprints`);
  }
}

function readRecord(directory) {
  const record = readJson(directory, 'compatibility.json');
  if (
    !object(record) ||
    record.schemaVersion !== 1 ||
    !Array.isArray(record.reviews)
  )
    throw new Error(
      'Expected compatibility.json schemaVersion 1 and a reviews array',
    );
  validateProtocols(record.protocols);
  for (const review of record.reviews) validateReview(review);
  return record;
}

export function changedSources(previous, current) {
  return groups.flatMap((group) =>
    [
      ...new Set([
        ...Object.keys(previous[group] || {}),
        ...Object.keys(current[group] || {}),
      ]),
    ]
      .sort(compareStrings)
      .filter((path) => previous[group]?.[path] !== current[group]?.[path])
      .map((path) => ({ group, path })),
  );
}

export function checkCompatibility(directory = root) {
  const record = readRecord(directory);
  const versions = currentVersions(directory);
  const review = record.reviews.at(-1);
  if (!review)
    throw new Error(
      'Compatibility review required: no reviewed baseline. Review the player/server contract, then run compatibility:review.',
    );
  const changes = changedSources(
    review.fingerprints,
    collectFingerprints(directory),
  );
  const protocolChanges =
    stableJson(review.protocols) !== stableJson(record.protocols);
  if (changes.length || protocolChanges)
    throw new Error(
      [
        'Compatibility review required before release:',
        ...changes.map(({ group, path }) => `  ${group}: ${path}`),
        ...(protocolChanges ? ['  Protocol support declarations changed'] : []),
        'Review the impact on the other component, run relevant checks, then record compatibility:review --impact compatible|breaking "Summary".',
      ].join('\n'),
    );
  return { versions, review, protocols: record.protocols };
}

export function recordReview(directory, impact, summary, date = new Date()) {
  if (!['compatible', 'breaking'].includes(impact))
    throw new Error('Review impact must be compatible or breaking');
  if (typeof summary !== 'string' || !summary.trim() || /[\r\n]/.test(summary))
    throw new Error('Supply a one-line compatibility review summary');
  const record = readRecord(directory);
  const review = {
    reviewedAt: date.toISOString(),
    impact,
    summary: summary.trim(),
    versions: currentVersions(directory),
    protocols: structuredClone(record.protocols),
    fingerprints: collectFingerprints(directory),
  };
  validateReview(review);
  record.reviews.push(review);
  writeFileSync(
    resolve(directory, 'compatibility.json'),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return review;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'check' && !args.length) {
      const { versions, review } = checkCompatibility();
      console.log(
        `Compatibility review current: server ${versions.server}, player ${versions.player}; ${review.impact} review at server ${review.versions.server}, player ${review.versions.player}.`,
      );
    } else if (
      command === 'review' &&
      args.length === 3 &&
      args[0] === '--impact'
    ) {
      const review = recordReview(root, args[1], args[2]);
      console.log(
        `Recorded ${review.impact} review for server ${review.versions.server} and player ${review.versions.player} in compatibility.json. No publication performed.`,
      );
    } else {
      throw new Error(
        'Use check, or review --impact compatible|breaking "Compatibility summary"',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
