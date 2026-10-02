import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const agentPattern = /^VERSION = '([^']+)'\r?$/gm;

export function nextVersion(current, kind, approval) {
  if (!versionPattern.test(current))
    throw new Error('Expected a plain X.Y.Z version');
  const parts = current.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger))
    throw new Error('Version exceeds safe integer range');
  if (kind === 'patch') parts[2]++;
  else if (kind === 'minor' && approval === '--milestone-approved') {
    parts[1]++;
    parts[2] = 0;
  } else if (kind === 'major' && approval === '--major-approved') {
    parts[0]++;
    parts[1] = parts[2] = 0;
  } else
    throw new Error(
      'Use patch, minor --milestone-approved, or major --major-approved',
    );
  if (!parts.every(Number.isSafeInteger))
    throw new Error('Version exceeds safe integer range');
  return parts.join('.');
}

export function checkVersion(directory = root) {
  const pkg = JSON.parse(
    readFileSync(resolve(directory, 'package.json'), 'utf8'),
  );
  const player = JSON.parse(
    readFileSync(resolve(directory, 'player/version.json'), 'utf8'),
  );
  const agent = readFileSync(resolve(directory, 'player/agent.py'), 'utf8');
  const log = readFileSync(resolve(directory, 'CHANGELOG.md'), 'utf8');
  const playerLog = readFileSync(
    resolve(directory, 'player/CHANGELOG.md'),
    'utf8',
  );
  const matches = [...agent.matchAll(agentPattern)];
  if (!versionPattern.test(pkg.version))
    throw new Error('Server package must have a plain X.Y.Z version');
  if (
    !versionPattern.test(player.version) ||
    matches.length !== 1 ||
    matches[0][1] !== player.version
  )
    throw new Error('Player metadata and standalone agent versions must match');
  if (
    !log
      .split(/\r?\n/)
      .some((line) => line.startsWith(`## [${pkg.version}] - `))
  )
    throw new Error('Current server version is missing from CHANGELOG.md');
  if (
    !playerLog
      .split(/\r?\n/)
      .some((line) => line.startsWith(`## [${player.version}] - `))
  )
    throw new Error(
      'Current player version is missing from player/CHANGELOG.md',
    );
  return { pkg, agent, log, player, playerLog };
}

function changelogRevision(log, next, summary, date) {
  if (!summary?.trim() || /[\r\n]/.test(summary))
    throw new Error('Supply a one-line change summary');
  const insertion = log.search(/^## \[/m);
  if (insertion < 0 || log.includes(`## [${next}]`))
    throw new Error('Invalid or duplicate changelog section');
  const section = `## [${next}] - ${date.toISOString().slice(0, 10)}\n\n- ${summary.trim()}\n\n`;
  return log.slice(0, insertion) + section + log.slice(insertion);
}

export function bumpVersion(
  directory,
  kind,
  approval,
  summary,
  date = new Date(),
) {
  const { pkg, log } = checkVersion(directory);
  const next = nextVersion(pkg.version, kind, approval);
  const revisedLog = changelogRevision(log, next, summary, date);
  // Validate everything before touching files; Git provides review and recovery.
  pkg.version = next;
  writeFileSync(
    resolve(directory, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n',
  );
  writeFileSync(resolve(directory, 'CHANGELOG.md'), revisedLog);
  return next;
}

export function bumpPlayerVersion(
  directory,
  kind,
  approval,
  summary,
  date = new Date(),
) {
  const { player, agent, playerLog } = checkVersion(directory);
  const next = nextVersion(player.version, kind, approval);
  const revisedLog = changelogRevision(playerLog, next, summary, date);
  player.version = next;
  writeFileSync(
    resolve(directory, 'player/version.json'),
    JSON.stringify(player, null, 2) + '\n',
  );
  writeFileSync(
    resolve(directory, 'player/agent.py'),
    agent.replace(agentPattern, `VERSION = '${next}'`),
  );
  writeFileSync(resolve(directory, 'player/CHANGELOG.md'), revisedLog);
  return next;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    const component = args[0] === 'player' ? args.shift() : 'server';
    const kind = args.shift();
    if (kind === 'check' && !args.length) {
      const { pkg, player } = checkVersion();
      console.log(
        `Server ${pkg.version}; player ${player.version}: consistent`,
      );
    } else {
      const needsApproval = kind === 'minor' || kind === 'major';
      const approval = needsApproval ? args.shift() : undefined;
      if (args.length !== 1)
        throw new Error('Supply exactly one quoted change summary');
      const bump = component === 'player' ? bumpPlayerVersion : bumpVersion;
      console.log(
        `Prepared ${component} ${bump(root, kind, approval, args[0])} locally. No commit, tag, or push performed.`,
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
