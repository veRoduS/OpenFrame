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
  const agent = readFileSync(resolve(directory, 'player/agent.py'), 'utf8');
  const log = readFileSync(resolve(directory, 'CHANGELOG.md'), 'utf8');
  const matches = [...agent.matchAll(agentPattern)];
  if (
    !versionPattern.test(pkg.version) ||
    matches.length !== 1 ||
    matches[0][1] !== pkg.version
  )
    throw new Error('Package and player versions must match');
  if (
    !log
      .split(/\r?\n/)
      .some((line) => line.startsWith(`## [${pkg.version}] - `))
  )
    throw new Error('Current version is missing from CHANGELOG.md');
  return { pkg, agent, log };
}

export function bumpVersion(
  directory,
  kind,
  approval,
  summary,
  date = new Date(),
) {
  if (!summary?.trim() || /[\r\n]/.test(summary))
    throw new Error('Supply a one-line change summary');
  const { pkg, agent, log } = checkVersion(directory);
  const next = nextVersion(pkg.version, kind, approval);
  const insertion = log.search(/^## \[/m);
  if (insertion < 0 || log.includes(`## [${next}]`))
    throw new Error('Invalid or duplicate changelog section');
  const section = `## [${next}] - ${date.toISOString().slice(0, 10)}\n\n- ${summary.trim()}\n\n`;
  // Validate everything before touching files; Git provides review and recovery.
  pkg.version = next;
  writeFileSync(
    resolve(directory, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n',
  );
  writeFileSync(
    resolve(directory, 'player/agent.py'),
    agent.replace(agentPattern, `VERSION = '${next}'`),
  );
  writeFileSync(
    resolve(directory, 'CHANGELOG.md'),
    log.slice(0, insertion) + section + log.slice(insertion),
  );
  return next;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [kind, ...args] = process.argv.slice(2);
    if (kind === 'check' && !args.length)
      console.log(`Version ${checkVersion().pkg.version}: consistent`);
    else {
      const needsApproval = kind === 'minor' || kind === 'major';
      const approval = needsApproval ? args.shift() : undefined;
      if (args.length !== 1)
        throw new Error('Supply exactly one quoted change summary');
      console.log(
        `Prepared ${bumpVersion(root, kind, approval, args[0])} locally. No commit, tag, or push performed.`,
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
