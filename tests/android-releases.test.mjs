import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../server/app.mjs';

async function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'openframe-android-'));
  const { app, close, db } = createApp({
    dataDir: path.join(root, 'data'),
    androidReleaseDir: root,
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
