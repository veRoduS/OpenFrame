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
import { dirname, join } from 'node:path';
import {
  checkCompatibility,
  collectFingerprints,
  recordReview,
  validateProtocols,
} from '../scripts/compatibility.mjs';

const support = {
  playerSync: { server: [1], android: [1], pi: [1] },
  playlistManifest: { server: [1], android: [1], pi: [1] },
  androidUpdate: { server: [1], android: [1], pi: [] },
};

function put(directory, path, value) {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(
    join(directory, path),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

function record(directory) {
  return JSON.parse(
    readFileSync(join(directory, 'compatibility.json'), 'utf8'),
  );
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'openframe-compatibility-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  put(directory, 'package.json', { version: '0.10.3' });
  put(directory, 'player/version.json', { version: '0.9.2' });
  put(directory, 'server/app.mjs', 'export const playlistSchema = 1;\n');
  put(directory, 'player/web/player.js', 'export const schema = 1;\n');
  put(
    directory,
    'player/android/app/src/main/java/org/openframe/player/PlayerAgent.java',
    'class PlayerAgent {}\n',
  );
  put(
    directory,
    'player/android/app/src/main/AndroidManifest.xml',
    '<manifest />\n',
  );
  put(directory, 'player/android/app/build.gradle', 'android {}\n');
  put(directory, 'player/android/release-signing.json', {
    schemaVersion: 1,
    certificateSha256: 'fixture',
  });
  put(directory, 'player/agent.py', "VERSION = '0.9.2'\nSCHEMA = 1\n");
  put(directory, 'compatibility.json', {
    schemaVersion: 1,
    protocols: support,
    reviews: [],
  });
  return directory;
}

void test('a baseline review is explicit and captures independent versions and protocol support', (t) => {
  const directory = fixture(t);
  assert.throws(() => checkCompatibility(directory), /no reviewed baseline/);
  const review = recordReview(
    directory,
    'compatible',
    'Existing contracts preserved',
    new Date('2026-10-02T00:00:00Z'),
  );
  assert.deepEqual(review.versions, { server: '0.10.3', player: '0.9.2' });
  assert.deepEqual(review.protocols, support);
  assert.equal(review.reviewedAt, '2026-10-02T00:00:00.000Z');
  assert.equal(
    checkCompatibility(directory).review.summary,
    'Existing contracts preserved',
  );
});

void test('version-only changes can drift without invalidating a source compatibility review', (t) => {
  const directory = fixture(t);
  recordReview(directory, 'compatible', 'Baseline');
  const previous = collectFingerprints(directory);
  put(directory, 'package.json', {
    version: '0.14.0',
    description: 'Server only release',
  });
  put(directory, 'player/version.json', { version: '0.9.3' });
  put(directory, 'player/agent.py', "VERSION = '0.9.3'\nSCHEMA = 1\n");
  assert.deepEqual(collectFingerprints(directory), previous);
  const result = checkCompatibility(directory);
  assert.deepEqual(result.versions, { server: '0.14.0', player: '0.9.3' });
  assert.deepEqual(result.review.versions, {
    server: '0.10.3',
    player: '0.9.2',
  });
});

void test('server, renderer, native Android, and Pi behavior changes each require review', async (t) => {
  for (const path of [
    'server/app.mjs',
    'player/web/player.js',
    'player/android/app/src/main/java/org/openframe/player/PlayerAgent.java',
    'player/android/app/src/main/AndroidManifest.xml',
    'player/android/app/build.gradle',
    'player/android/release-signing.json',
    'player/agent.py',
  ])
    await t.test(path, (subtest) => {
      const directory = fixture(subtest);
      recordReview(directory, 'compatible', 'Baseline');
      put(
        directory,
        path,
        `${readFileSync(join(directory, path), 'utf8')}changed behavior\n`,
      );
      assert.throws(
        () => checkCompatibility(directory),
        (error) =>
          error.message.includes('Compatibility review required') &&
          error.message.includes(path),
      );
    });
});

void test('new helpers and deleted source files cannot bypass the fingerprint review', (t) => {
  const directory = fixture(t);
  recordReview(directory, 'compatible', 'Baseline');
  put(directory, 'server/new-contract.mjs', 'export const schema = 2;\n');
  assert.throws(
    () => checkCompatibility(directory),
    /server\/new-contract.mjs/,
  );
  recordReview(directory, 'compatible', 'Reviewed new helper');
  rmSync(join(directory, 'server/new-contract.mjs'));
  assert.throws(
    () => checkCompatibility(directory),
    /server\/new-contract.mjs/,
  );
});

void test('each applicable server and player pair needs a shared protocol version', () => {
  assert.deepEqual(validateProtocols(structuredClone(support)), support);
  for (const protocol of ['playerSync', 'playlistManifest', 'androidUpdate']) {
    const changed = structuredClone(support);
    changed[protocol].android = [2];
    assert.throws(
      () => validateProtocols(changed),
      /server and android have no shared protocol/,
    );
  }
  const changed = structuredClone(support);
  changed.playerSync.pi = [2];
  assert.throws(
    () => validateProtocols(changed),
    /server and pi have no shared protocol/,
  );
  changed.playerSync.server = [1, 2];
  assert.doesNotThrow(() => validateProtocols(changed));
});

void test('protocol support changes require review and cannot record unsupported current pairings', (t) => {
  const directory = fixture(t);
  recordReview(directory, 'compatible', 'Baseline');
  const changed = record(directory);
  changed.protocols.playerSync.server = [1, 2];
  put(directory, 'compatibility.json', changed);
  assert.throws(
    () => checkCompatibility(directory),
    /Protocol support declarations changed/,
  );
  recordReview(
    directory,
    'compatible',
    'Server retains old sync contract during transition',
  );
  assert.doesNotThrow(() => checkCompatibility(directory));
  changed.protocols.playerSync.server = [2];
  put(directory, 'compatibility.json', changed);
  const before = readFileSync(join(directory, 'compatibility.json'), 'utf8');
  assert.throws(
    () => recordReview(directory, 'breaking', 'Missing upgrade'),
    /no shared protocol/,
  );
  assert.equal(
    readFileSync(join(directory, 'compatibility.json'), 'utf8'),
    before,
  );
});

void test('breaking reviews preserve earlier reviewed versions and describe migration', (t) => {
  const directory = fixture(t);
  recordReview(directory, 'compatible', 'Original contract');
  put(directory, 'package.json', { version: '0.12.0' });
  put(directory, 'player/version.json', { version: '0.11.0' });
  put(directory, 'server/app.mjs', 'export const playlistSchema = 2;\n');
  const changed = record(directory);
  changed.protocols.playlistManifest = { server: [2], android: [2], pi: [2] };
  put(directory, 'compatibility.json', changed);
  recordReview(
    directory,
    'breaking',
    'Schema 2 requires server 0.12.0 and player 0.11.0; upgrade players before publishing',
  );
  const result = checkCompatibility(directory);
  assert.equal(result.review.impact, 'breaking');
  assert.deepEqual(result.protocols.playlistManifest, {
    server: [2],
    android: [2],
    pi: [2],
  });
  assert.equal(record(directory).reviews.length, 2);
  assert.equal(record(directory).reviews[0].versions.player, '0.9.2');
});

void test('malformed declarations, review impact, versions, and fingerprints fail clearly', (t) => {
  const directory = fixture(t);
  for (const invalid of [[], [0], [1, 1], ['1']]) {
    const changed = structuredClone(support);
    changed.playlistManifest.server = invalid;
    assert.throws(() => validateProtocols(changed), /playlistManifest.server/);
  }
  const changed = structuredClone(support);
  changed.androidUpdate.pi = [1];
  assert.throws(() => validateProtocols(changed), /Pi does not install APK/);
  assert.throws(
    () => recordReview(directory, 'unchecked', 'Baseline'),
    /impact/,
  );
  assert.throws(() => recordReview(directory, 'compatible', ' '), /one-line/);
  assert.throws(
    () => recordReview(directory, 'compatible', 'one\ntwo'),
    /one-line/,
  );
  recordReview(directory, 'compatible', 'Baseline');
  const invalidRecord = record(directory);
  invalidRecord.reviews[0].fingerprints.server['server/app.mjs'] = 'not-a-hash';
  put(directory, 'compatibility.json', invalidRecord);
  assert.throws(
    () => checkCompatibility(directory),
    /Invalid server compatibility review fingerprints/,
  );
  put(directory, 'compatibility.json', {
    schemaVersion: 1,
    protocols: support,
    reviews: [],
  });
  put(directory, 'player/version.json', { version: 'v0.9.2' });
  assert.throws(
    () => recordReview(directory, 'compatible', 'Baseline'),
    /plain X.Y.Z/,
  );
});
