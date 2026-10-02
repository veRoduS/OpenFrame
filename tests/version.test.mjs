import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nextVersion,
  checkVersion,
  bumpVersion,
  bumpPlayerVersion,
} from '../scripts/version.mjs';

void test('local patches and approved milestones use the requested numbering', () => {
  assert.equal(nextVersion('0.1.9', 'patch'), '0.1.10');
  assert.equal(nextVersion('0.1.10', 'minor', '--milestone-approved'), '0.2.0');
  assert.equal(nextVersion('0.2.4', 'major', '--major-approved'), '1.0.0');
  assert.equal(nextVersion('1.2.3', 'minor', '--milestone-approved'), '1.3.0');
  for (const kind of ['minor', 'major', 'other'])
    assert.throws(() => nextVersion('0.1.0', kind));
  assert.throws(() => nextVersion('0.1.0', 'major', '--milestone-approved'));
  for (const value of ['01.0.0', 'v1.0.0', '1.0', '1.0.0-beta'])
    assert.throws(() => nextVersion(value, 'patch'));
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'openframe-version-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'player'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.4.0' }),
  );
  writeFileSync(
    join(dir, 'player/version.json'),
    JSON.stringify({ version: '0.1.0' }),
  );
  writeFileSync(join(dir, 'player/agent.py'), "VERSION = '0.1.0'\r\n");
  writeFileSync(
    join(dir, 'CHANGELOG.md'),
    '# Changelog\n\n## [0.4.0] - Baseline\n\n- Initial server\n',
  );
  writeFileSync(
    join(dir, 'player/CHANGELOG.md'),
    '# Changelog\n\n## [0.1.0] - Baseline\n\n- Initial\n',
  );
  return dir;
}

const versionFiles = [
  'package.json',
  'CHANGELOG.md',
  'player/version.json',
  'player/agent.py',
  'player/CHANGELOG.md',
];

function contents(dir, paths = versionFiles) {
  return paths.map((path) => readFileSync(join(dir, path), 'utf8'));
}

void test('server patches preserve the installed player version and history', (t) => {
  const dir = fixture(t);
  const before = contents(dir);
  assert.throws(() => bumpVersion(dir, 'major', undefined, 'Release'));
  assert.throws(() => bumpVersion(dir, 'patch', undefined, ''));
  assert.deepEqual(contents(dir), before);
  assert.equal(
    bumpVersion(
      dir,
      'patch',
      undefined,
      'Fix dashboard',
      new Date('2026-09-09Z'),
    ),
    '0.4.1',
  );
  const { pkg, player, log } = checkVersion(dir);
  assert.equal(pkg.name, 'fixture');
  assert.equal(pkg.version, '0.4.1');
  assert.equal(player.version, '0.1.0');
  assert.match(log, /## \[0.4.1\] - 2026-09-09\n\n- Fix dashboard/);
  assert.deepEqual(contents(dir).slice(2), before.slice(2));
});

void test('player patches synchronize Pi and Android metadata without changing the server', (t) => {
  const dir = fixture(t);
  const before = contents(dir);
  for (const [kind, approval, summary] of [
    ['major', undefined, 'Release'],
    ['minor', undefined, 'Release'],
    ['major', '--milestone-approved', 'Release'],
    ['patch', undefined, ''],
    ['patch', undefined, 'Two\nlines'],
  ]) {
    assert.throws(() => bumpPlayerVersion(dir, kind, approval, summary));
    assert.deepEqual(contents(dir), before);
  }
  assert.equal(
    bumpPlayerVersion(
      dir,
      'patch',
      undefined,
      'Fix clock',
      new Date('2026-09-09Z'),
    ),
    '0.1.1',
  );
  const { pkg, player, agent, playerLog } = checkVersion(dir);
  assert.equal(pkg.version, '0.4.0');
  assert.equal(player.version, '0.1.1');
  assert.match(agent, /^VERSION = '0.1.1'\r?$/m);
  assert.match(playerLog, /## \[0.1.1\] - 2026-09-09\n\n- Fix clock/);
  assert.deepEqual(contents(dir).slice(0, 2), before.slice(0, 2));
});

void test('approved player milestones remain independent of server versions', (t) => {
  const dir = fixture(t);
  const before = contents(dir).slice(0, 2);
  assert.equal(
    bumpPlayerVersion(dir, 'minor', '--milestone-approved', 'Player milestone'),
    '0.2.0',
  );
  assert.equal(
    bumpPlayerVersion(dir, 'major', '--major-approved', 'Player major release'),
    '1.0.0',
  );
  assert.deepEqual(contents(dir).slice(0, 2), before);
  assert.equal(checkVersion(dir).player.version, '1.0.0');
});

void test('version checks allow drift and detect player mismatches or missing history', (t) => {
  const dir = fixture(t);
  assert.notEqual(
    checkVersion(dir).pkg.version,
    checkVersion(dir).player.version,
  );
  writeFileSync(join(dir, 'player/agent.py'), "VERSION = '0.9.0'\n");
  assert.throws(() => checkVersion(dir), /must match/);
  writeFileSync(join(dir, 'player/agent.py'), "VERSION = '0.1.0'\n");
  writeFileSync(join(dir, 'player/CHANGELOG.md'), '# Player changelog\n');
  assert.throws(() => checkVersion(dir), /player\/CHANGELOG.md/);
});

void test('duplicate changelog versions cannot partially rewrite either component', (t) => {
  const dir = fixture(t);
  for (const { path, next, bump } of [
    { path: 'CHANGELOG.md', next: '0.4.1', bump: bumpVersion },
    { path: 'player/CHANGELOG.md', next: '0.1.1', bump: bumpPlayerVersion },
  ]) {
    writeFileSync(
      join(dir, path),
      readFileSync(join(dir, path), 'utf8') + `\n## [${next}] - Future\n`,
    );
    const before = contents(dir);
    assert.throws(
      () => bump(dir, 'patch', undefined, 'Duplicate'),
      /duplicate/,
    );
    assert.deepEqual(contents(dir), before);
  }
});

void test('repository server and player have matching component metadata and history', () => {
  const { pkg, player } = checkVersion();
  assert.ok(pkg.version);
  assert.ok(player.version);
});
