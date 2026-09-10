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
import { nextVersion, checkVersion, bumpVersion } from '../scripts/version.mjs';

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

void test('bump synchronizes package, standalone agent, and changelog without Git', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'openframe-version-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'player'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.1.0' }),
  );
  writeFileSync(join(dir, 'player/agent.py'), "VERSION = '0.1.0'\r\n");
  writeFileSync(
    join(dir, 'CHANGELOG.md'),
    '# Changelog\n\n## [0.1.0] - Baseline\n\n- Initial\n',
  );
  const before = readFileSync(join(dir, 'package.json'), 'utf8');
  assert.throws(() => bumpVersion(dir, 'major', undefined, 'Release'));
  assert.throws(() => bumpVersion(dir, 'patch', undefined, ''));
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before);
  assert.equal(
    bumpVersion(dir, 'patch', undefined, 'Fix clock', new Date('2026-09-09Z')),
    '0.1.1',
  );
  assert.equal(checkVersion(dir).pkg.name, 'fixture');
  assert.match(
    checkVersion(dir).log,
    /## \[0.1.1\] - 2026-09-09\n\n- Fix clock/,
  );
  writeFileSync(join(dir, 'player/agent.py'), "VERSION = '0.9.0'\n");
  assert.throws(() => checkVersion(dir), /must match/);
});

void test('repository package, player, and changelog are synchronized', () => {
  assert.ok(checkVersion().pkg.version);
});
