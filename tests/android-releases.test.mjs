import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import {
  ANDROID_GITHUB_BASE,
  ANDROID_GITHUB_METADATA,
} from '../server/android-release-config.mjs';

async function fixture(t, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'openframe-android-'));
  const { app, close, db } = createApp({
    dataDir: path.join(root, 'data'),
    androidReleaseDir: root,
    androidReleaseSource: 'local',
    ...options,
  });
  // Ensure missing downloads are not accidentally handled as SPA routes.
  app.get('/{*path}', (req, res) => res.type('html').send('SPA'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    close();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const bytes = Buffer.from('test release bytes, not an installable APK');
  const release = {
    packageName: 'org.openframe.player',
    versionName: '0.10.3',
    versionCode: 10003,
    minSdk: 28,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    apkUrl: '/downloads/android/openframe-player-0.10.3.apk',
  };
  const manifest = path.join(root, 'latest.json');
  const apk = path.join(root, path.basename(release.apkUrl));
  const publish = (value = release) => {
    writeFileSync(apk, bytes);
    writeFileSync(manifest, JSON.stringify(value));
  };
  return {
    root,
    bytes,
    release,
    manifest,
    apk,
    publish,
    request: (url, options) =>
      fetch(`http://127.0.0.1:${server.address().port}${url}`, options),
  };
}

void test('Android download metadata and APK are public, checksum verified, and served as attachments', async (t) => {
  const f = await fixture(t);
  f.publish({ ...f.release, secret: 'never expose arbitrary fields' });
  const metadata = await f.request('/downloads/android/latest.json');
  assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), { available: true, ...f.release });
  for (const url of [
    f.release.apkUrl,
    '/downloads/android/openframe-player.apk',
  ]) {
    const response = await f.request(url);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type'),
      /application\/vnd.android.package-archive/,
    );
    assert.match(
      response.headers.get('content-disposition'),
      /attachment; filename="openframe-player-0.10.3.apk"/,
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes);
  }
  const head = await f.request(f.release.apkUrl, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(f.bytes.length));
});

void test('missing, invalid, and incomplete Android releases fail closed without SPA fallback', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/downloads/android/latest.json')).status, 404);
  for (const change of [
    { apkUrl: '/../../secret' },
    { apkUrl: 'https://example.com/update.apk' },
    { versionCode: 1 },
    { size: 100000000 },
    { packageName: 'other.app' },
  ]) {
    f.publish({ ...f.release, ...change });
    assert.equal(
      (await f.request('/downloads/android/latest.json')).status,
      503,
    );
  }
  f.publish();
  writeFileSync(f.apk, Buffer.alloc(f.bytes.length));
  assert.equal((await f.request(f.release.apkUrl)).status, 503);
  f.publish();
  rmSync(f.apk);
  assert.equal((await f.request('/downloads/android/latest.json')).status, 404);
  for (const name of [
    'identity.json',
    'signing.private.json',
    'openframe-player-0.0.1.apk',
  ]) {
    const response = await f.request(`/downloads/android/${name}`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).available, false);
  }
});

void test('Android downloads reject symlinked artifacts and discover atomic manifest replacements', async (t) => {
  const f = await fixture(t);
  f.publish();
  assert.equal((await f.request('/downloads/android/latest.json')).status, 200);
  rmSync(f.apk);
  writeFileSync(path.join(f.root, 'outside'), f.bytes);
  symlinkSync(path.join(f.root, 'outside'), f.apk);
  assert.equal((await f.request('/downloads/android/latest.json')).status, 503);
  rmSync(f.apk);
  f.publish();
  const next = {
    ...f.release,
    versionName: '0.10.4',
    versionCode: 10004,
    apkUrl: '/downloads/android/openframe-player-0.10.4.apk',
  };
  writeFileSync(path.join(f.root, path.basename(next.apkUrl)), f.bytes);
  writeFileSync(f.manifest, JSON.stringify(next));
  assert.equal(
    (await (await f.request('/downloads/android/latest.json')).json())
      .versionCode,
    10004,
  );
});

async function githubFixture(t) {
  let clock = 1000;
  let metadata;
  let apkBytes;
  let responseOverride;
  const calls = [];
  const f = await fixture(t, {
    androidReleaseSource: 'github',
    androidReleaseNow: () => clock,
    androidReleaseFetch: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, false);
      // Yield so overlapping requests exercise the shared in-flight promise.
      await new Promise((resolve) => setImmediate(resolve));
      const overridden = responseOverride?.(url);
      if (overridden) return overridden;
      if (url === ANDROID_GITHUB_METADATA) return Response.json(metadata);
      assert.equal(
        url,
        `${ANDROID_GITHUB_BASE}/apks/${metadata.versionName}/openframe-player.apk`,
      );
      return new Response(apkBytes);
    },
  });
  metadata = f.release;
  apkBytes = f.bytes;
  return {
    ...f,
    calls,
    setMetadata(value) {
      metadata = value;
    },
    setApk(value) {
      apkBytes = value;
    },
    setResponseOverride(callback) {
      responseOverride = callback;
    },
    advance(ms = 5 * 60 * 1000) {
      clock += ms;
    },
  };
}

void test('GitHub releases preserve same-origin Android updater URLs and cache verified bytes across simultaneous checks', async (t) => {
  const f = await githubFixture(t);
  f.setMetadata({ ...f.release, untrusted: 'not reflected into responses' });
  const checks = await Promise.all(
    Array.from({ length: 4 }, () =>
      f.request('/downloads/android/latest.json'),
    ),
  );
  for (const response of checks) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available: true, ...f.release });
  }
  assert.equal(f.calls.length, 2);
  for (const url of [
    f.release.apkUrl,
    '/downloads/android/openframe-player.apk',
  ]) {
    const response = await f.request(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-disposition'), /attachment;/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes);
  }
  const head = await f.request(f.release.apkUrl, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(f.bytes.length));
  assert.equal(
    (await f.request('/downloads/android/openframe-player-0.0.1.apk')).status,
    404,
  );
  assert.equal(f.calls.length, 2);
  f.advance(5 * 60 * 1000 - 1);
  assert.equal((await f.request('/downloads/android/latest.json')).status, 200);
  assert.equal(f.calls.length, 2);
  f.advance(1);
  const next = {
    ...f.release,
    versionName: '0.11.0',
    versionCode: 11000,
    apkUrl: '/downloads/android/openframe-player-0.11.0.apk',
  };
  f.setMetadata(next);
  const response = await f.request('/downloads/android/latest.json');
  assert.deepEqual(await response.json(), { available: true, ...next });
  assert.equal(f.calls.length, 4);
  assert.equal((await f.request(f.release.apkUrl)).status, 404);
});

void test('GitHub mirror rejects cross-origin and malformed metadata before fetching any APK', async (t) => {
  const f = await githubFixture(t);
  for (const changed of [
    { apkUrl: 'https://example.com/untrusted.apk' },
    { apkUrl: `${ANDROID_GITHUB_BASE}/apks/latest/openframe-player.apk` },
    { apkUrl: '/downloads/android/../../untrusted.apk' },
    { versionName: '../main', versionCode: 1 },
    { versionCode: 10004 },
    { packageName: 'other.app' },
    { size: 64 * 1024 * 1024 + 1 },
  ]) {
    f.advance();
    f.setMetadata({ ...f.release, ...changed });
    const previous = f.calls.length;
    assert.equal(
      (await f.request('/downloads/android/latest.json')).status,
      503,
    );
    assert.equal(f.calls.length, previous + 1);
    assert.equal(f.calls.at(-1), ANDROID_GITHUB_METADATA);
  }
});

void test('GitHub mirror bounds payloads, rejects corruption and redirects, and briefly caches failures', async (t) => {
  const f = await githubFixture(t);
  f.setApk(Buffer.alloc(f.bytes.length));
  assert.equal((await f.request('/downloads/android/latest.json')).status, 503);
  assert.equal((await f.request(f.release.apkUrl)).status, 503);
  assert.equal(f.calls.length, 2);
  f.setApk(f.bytes);
  f.advance(29999);
  assert.equal((await f.request('/downloads/android/latest.json')).status, 503);
  assert.equal(f.calls.length, 2);
  f.advance(1);
  assert.equal((await f.request('/downloads/android/latest.json')).status, 200);
  assert.equal(f.calls.length, 4);
  for (const invalidResponse of [
    () => new Response(Buffer.alloc(f.bytes.length - 1)),
    () => new Response(Buffer.alloc(f.bytes.length + 1)),
    () => new Response(f.bytes, { headers: { 'content-length': '999999999' } }),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/update.apk' },
      }),
  ]) {
    f.advance();
    f.setResponseOverride(
      (url) => url !== ANDROID_GITHUB_METADATA && invalidResponse(),
    );
    assert.equal(
      (await f.request('/downloads/android/latest.json')).status,
      503,
    );
  }
  f.advance();
  f.setResponseOverride(
    (url) => url === ANDROID_GITHUB_METADATA && new Response(' '.repeat(16385)),
  );
  assert.equal((await f.request('/downloads/android/latest.json')).status, 503);
  f.advance();
  f.setResponseOverride(() => new Response(null, { status: 404 }));
  const missing = await f.request('/downloads/android/latest.json');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).available, false);
});
