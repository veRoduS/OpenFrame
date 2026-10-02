import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  stageAndroidPublication,
  publishAndroid,
} from '../scripts/publish-android.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openframe-apk-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, 'output'),
    checkout = join(root, 'checkout');
  mkdirSync(output);
  mkdirSync(checkout);
  const build = (version = '0.10.3', bytes = Buffer.from('fixture APK')) => {
    const [major, minor, patch] = version.split('.').map(Number);
    writeFileSync(join(output, `openframe-player-${version}.apk`), bytes);
    writeFileSync(
      join(output, 'latest.json'),
      JSON.stringify({
        versionName: version,
        versionCode: major * 1000000 + minor * 1000 + patch,
        packageName: 'org.openframe.player',
        minSdk: 28,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        apkUrl: `/downloads/android/openframe-player-${version}.apk`,
      }),
    );
  };
  build();
  writeFileSync(
    join(output, 'do-not-upload.private.json'),
    'fixture private data',
  );
  return { root, output, checkout, build };
}

void test('APK publication retains immutable versions, advances latest, and excludes unrelated files', (t) => {
  const f = fixture(t);
  stageAndroidPublication(f.output, f.checkout, { reviewed: 'first' });
  const archived = readFileSync(
    join(f.checkout, 'apks/0.10.3/release.json'),
    'utf8',
  );
  stageAndroidPublication(f.output, f.checkout, { reviewed: 'later' });
  assert.equal(
    readFileSync(join(f.checkout, 'apks/0.10.3/release.json'), 'utf8'),
    archived,
  );
  f.build('0.10.4', Buffer.from('new APK'));
  stageAndroidPublication(f.output, f.checkout);
  assert.equal(
    JSON.parse(readFileSync(join(f.checkout, 'apks/latest.json'))).versionName,
    '0.10.4',
  );
  assert.equal(
    readFileSync(join(f.checkout, 'apks/latest/openframe-player.apk'), 'utf8'),
    'new APK',
  );
  f.build();
  assert.throws(
    () => stageAndroidPublication(f.output, f.checkout),
    /older version/,
  );
  f.build('0.10.4', Buffer.from('replacement APK'));
  assert.throws(
    () => stageAndroidPublication(f.output, f.checkout),
    /already published/,
  );
});

void test('APK publishing uses an isolated branch and retries unchanged uploads without commits', (t) => {
  const f = fixture(t);
  const remote = join(f.root, 'remote.git');
  execFileSync('git', ['init', '--bare', '-q', remote]);
  const options = {
    output: f.output,
    remote,
    author: { name: 'Test Fixture', email: 'fixture@example.invalid' },
  };
  assert.equal(publishAndroid(options).changed, true);
  const git = (args) =>
    execFileSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8' });
  const before = git(['rev-parse', 'android-releases']);
  assert.equal(publishAndroid(options).changed, false);
  assert.equal(git(['rev-parse', 'android-releases']), before);
  assert.deepEqual(
    git(['ls-tree', '-r', '--name-only', 'android-releases'])
      .trim()
      .split('\n'),
    [
      'README.md',
      'apks/0.10.3/openframe-player.apk',
      'apks/0.10.3/release.json',
      'apks/latest.json',
      'apks/latest/openframe-player.apk',
    ],
  );
  f.build('0.10.4');
  assert.equal(publishAndroid(options).changed, true);
  assert.equal(git(['rev-list', '--count', 'android-releases']).trim(), '2');
});

void test('APK publication rejects symlinks instead of writing outside the checkout', (t) => {
  const f = fixture(t);
  const outside = join(f.root, 'outside');
  writeFileSync(outside, 'untouched');
  mkdirSync(join(f.checkout, 'apks/latest'), { recursive: true });
  symlinkSync(outside, join(f.checkout, 'apks/latest/openframe-player.apk'));
  assert.throws(
    () => stageAndroidPublication(f.output, f.checkout),
    /regular directories and files/,
  );
  assert.equal(readFileSync(outside, 'utf8'), 'untouched');
});
