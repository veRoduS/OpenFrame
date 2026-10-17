import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { fileMetadata, processVideo } from '../server/video.mjs';

const hasFFmpeg =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(t, options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-video-'));
  const instance = createApp({ dataDir: dir, ...options });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  function client(token) {
    let cookie = '';
    return async (url, method = 'GET', body, extra = {}) => {
      const options = {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body && !(body instanceof FormData)
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...extra,
        },
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
      };
      const response = await fetch(base + url, options);
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0];
      return {
        status: response.status,
        headers: response.headers,
        data: response.headers.get('content-type')?.includes('json')
          ? await response.json()
          : Buffer.from(await response.arrayBuffer()),
      };
    };
  }
  const admin = client();
  await admin('/api/setup', 'POST', { password: 'video-test-password' });
  const user = async (username) => {
    const created = (
      await admin('/api/users', 'POST', { name: username, username })
    ).data;
    const call = client();
    await call('/api/login', 'POST', { username, password: created.password });
    return { call, id: created.user?.id || created.id };
  };
  t.after(async () => {
    instance.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    instance.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...instance, admin, client, user, dir };
}
function upload(bytes = Buffer.from('test source'), fields = {}) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'clip.mp4');
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}
async function finish(call, id) {
  for (let count = 0; count < 300; count++) {
    const response = await call(`/api/video-jobs/${id}`);
    assert.equal(response.status, 200);
    if (['done', 'error'].includes(response.data.status)) return response.data;
    await sleep(20);
  }
  assert.fail('Video job did not finish');
}
async function fakeProcessor({ directory, signal }) {
  if (signal.aborted)
    throw Object.assign(new Error('Cancelled'), { status: 409 });
  const videoPath = path.join(directory, 'playback.mp4');
  const posterPath = path.join(directory, 'poster.webp');
  writeFileSync(videoPath, 'a synthetic video payload');
  writeFileSync(posterPath, 'a synthetic poster payload');
  return {
    videoPath,
    posterPath,
    width: 1280,
    height: 720,
    durationMs: 2000,
    fps: 30,
    ...(await fileMetadata(videoPath)),
    poster: { width: 640, height: 360, ...(await fileMetadata(posterPath)) },
  };
}
function slide(asset, type = 'video') {
  return {
    name: 'Video slide',
    width: 1920,
    height: 1080,
    background: '#000000',
    layers: [
      {
        id: randomUUID(),
        type,
        assetId: asset.id,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    ],
  };
}

void test('video jobs publish video and poster together, authorize both, and clean deleted references', async (t) => {
  const { admin, client, user, dir } = await fixture(t, {
    videoProcessor: fakeProcessor,
  });
  const viewer = await user('video-viewer');
  assert.equal((await client()('/api/videos', 'POST', upload())).status, 401);
  const started = await admin('/api/videos', 'POST', upload());
  assert.equal(started.status, 202);
  assert.equal(
    (await viewer.call(`/api/video-jobs/${started.data.id}`)).status,
    404,
  );
  assert.equal(
    (await viewer.call(`/api/video-jobs/${started.data.id}`, 'DELETE')).status,
    404,
  );
  const job = await finish(admin, started.data.id);
  assert.equal(job.status, 'done');
  const asset = job.asset;
  assert.equal(asset.kind, 'video');
  assert.equal(asset.mime, 'video/mp4');
  assert.equal((await viewer.call(asset.url)).status, 404);
  assert.equal((await viewer.call(asset.poster.url)).status, 404);
  assert.equal(
    (await admin('/api/slides', 'POST', slide(asset, 'image'))).status,
    400,
  );
  const twice = slide(asset);
  twice.layers.push({ ...twice.layers[0], id: randomUUID() });
  assert.equal((await admin('/api/slides', 'POST', twice)).status, 400);
  const saved = (await admin('/api/slides', 'POST', slide(asset))).data;
  await admin(`/api/access/slide/${saved.id}`, 'POST', { userId: viewer.id });
  assert.equal((await viewer.call(asset.url)).status, 200);
  assert.equal((await viewer.call(asset.poster.url)).status, 200);
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Video loop',
      items: [{ slideId: saved.id, duration: 10 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  const manifest = (
    await admin(`/api/preview/${playlist.id}?version=published`)
  ).data;
  assert.equal(manifest.schemaVersion, 5);
  assert.deepEqual(
    manifest.assets.map((item) => item.id),
    [asset.id, `${asset.id}-poster`],
  );
  const anon = client();
  const device = (
    await anon('/api/player/enroll', 'POST', { name: 'Onn video test' })
  ).data;
  const player = client(device.token);
  assert.equal((await player(asset.url)).status, 403);
  await admin(`/api/devices/${device.id}/approve`, 'POST', {
    code: device.code,
  });
  await admin(`/api/devices/${device.id}`, 'PUT', {
    name: 'Onn video test',
    playlistId: playlist.id,
    blank: false,
    rotation: 0,
  });
  const sync = (await player('/api/player/sync', 'POST', {})).data;
  assert.equal(sync.manifest.schemaVersion, 5);
  const partial = await player(asset.url, 'GET', undefined, {
    Range: 'bytes=2-5',
  });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-type'), 'video/mp4');
  assert.equal(partial.data.toString(), 'synt');
  assert.equal((await player(asset.poster.url)).status, 200);
  assert.equal(
    (await player(asset.url, 'GET', undefined, { Range: 'bytes=9999-' }))
      .status,
    416,
  );
  await admin('/api/assets/batch', 'POST', {
    ids: [asset.id],
    action: 'delete',
  });
  const removed = (await admin(`/api/preview/${playlist.id}?version=published`))
    .data;
  assert.equal(removed.items[0].slide.layers[0].removedMedia, true);
  assert.deepEqual(removed.assets, []);
  assert.equal(existsSync(path.join(dir, 'media', asset.filename)), false);
  assert.equal(
    existsSync(path.join(dir, 'media', asset.poster.filename)),
    false,
  );
  assert.equal((await player(asset.poster.url)).status, 403);
});

void test('video queue bounds work, serializes encoders, and cancellation releases queued files', async (t) => {
  let active = 0,
    peak = 0;
  const release = [];
  const processor = async (options) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => {
        release.push(resolve);
        options.signal.addEventListener('abort', resolve, { once: true });
      });
      return await fakeProcessor(options);
    } finally {
      active--;
    }
  };
  const { admin, dir } = await fixture(t, { videoProcessor: processor });
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const response = await admin('/api/videos', 'POST', upload());
    assert.equal(response.status, 202);
    ids.push(response.data.id);
  }
  assert.equal((await admin('/api/videos', 'POST', upload())).status, 429);
  assert.equal(active, 1);
  await admin(`/api/video-jobs/${ids[1]}`, 'DELETE');
  assert.equal(existsSync(path.join(dir, 'video-work', ids[1])), false);
  await admin(`/api/video-jobs/${ids[0]}`, 'DELETE');
  for (let i = 0; i < 100 && release.length < 2; i++) await sleep(5);
  assert.equal(release.length, 2);
  release[1]();
  assert.equal((await finish(admin, ids[2])).status, 'done');
  for (let i = 0; i < 100 && release.length < 3; i++) await sleep(5);
  release[2]();
  assert.equal((await finish(admin, ids[3])).status, 'done');
  assert.equal(peak, 1);
  assert.equal((await admin('/api/library')).data.assets.length, 2);
  assert.deepEqual(readdirSync(path.join(dir, 'video-work')), []);
});

void test('queued video rechecks destination permissions and ordinary publications retain old schemas', async (t) => {
  let release;
  const { admin, dir } = await fixture(t, {
    videoProcessor: async (options) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      return fakeProcessor(options);
    },
  });
  const folder = (
    await admin('/api/folders', 'POST', { name: 'Temporary folder' })
  ).data;
  assert.equal(
    (
      await admin(
        '/api/videos',
        'POST',
        upload(undefined, { profile: 'invalid' }),
      )
    ).status,
    400,
  );
  const started = await admin(
    '/api/videos',
    'POST',
    upload(undefined, { folderId: folder.id }),
  );
  assert.equal(
    (await admin(`/api/folders/${folder.id}`, 'DELETE')).status,
    200,
  );
  release();
  const job = await finish(admin, started.data.id);
  assert.equal(job.status, 'error');
  assert.equal((await admin('/api/library')).data.assets.length, 0);
  assert.deepEqual(readdirSync(path.join(dir, 'media')), []);
  const saved = (
    await admin('/api/slides', 'POST', { ...slide({}), layers: [] })
  ).data;
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'No video',
      items: [{ slideId: saved.id, duration: 5 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/preview/${playlist.id}`)).data.schemaVersion,
    2,
  );
});

void test('queued video cannot share into a group after the uploader loses membership', async (t) => {
  let release;
  const { admin, user, dir } = await fixture(t, {
    videoProcessor: async (options) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      return fakeProcessor(options);
    },
  });
  const uploader = await user('queued-uploader');
  const group = (await admin('/api/groups', 'POST', { name: 'Video group' }))
    .data;
  assert.equal(
    (
      await admin(`/api/groups/${group.id}/members/${uploader.id}`, 'PUT', {
        role: 'member',
      })
    ).status,
    200,
  );
  const started = await uploader.call('/api/videos', 'POST', upload(), {
    'X-OpenFrame-Group': group.id,
  });
  assert.equal(started.status, 202);
  assert.equal(
    (
      await admin(`/api/groups/${group.id}/members/${uploader.id}`, 'PUT', {
        role: 'remove',
      })
    ).status,
    200,
  );
  release();
  const job = await finish(uploader.call, started.data.id);
  assert.equal(job.status, 'error');
  assert.match(job.error, /group access/);
  assert.equal((await admin('/api/library')).data.assets.length, 0);
  assert.deepEqual(readdirSync(path.join(dir, 'media')), []);
});

void test(
  'real FFmpeg upload strips audio, bounds frame rate and resolution, and produces a valid cached poster',
  { skip: !hasFFmpeg },
  async (t) => {
    const { admin, dir } = await fixture(t);
    const input = path.join(dir, 'source.mp4');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1600x900:rate=60',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-t',
      '0.5',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-threads',
      '2',
      '-c:a',
      'aac',
      input,
    ]);
    const started = await admin(
      '/api/videos',
      'POST',
      upload(readFileSync(input)),
    );
    const job = await finish(admin, started.data.id);
    assert.equal(job.status, 'done', job.error);
    const asset = job.asset;
    assert.equal(asset.width, 1280);
    assert.equal(asset.height, 720);
    assert.equal(asset.fps, 30);
    assert.ok(asset.bytes < 25 * 1024 * 1024);
    const output = path.join(dir, 'media', asset.filename);
    const metadata = JSON.parse(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-show_streams',
        '-of',
        'json',
        output,
      ]),
    );
    assert.equal(metadata.streams.length, 1);
    assert.equal(metadata.streams[0].codec_name, 'h264');
    assert.equal(metadata.streams[0].pix_fmt, 'yuv420p');
    assert.deepEqual(await fileMetadata(output), {
      bytes: asset.bytes,
      sha256: asset.sha256,
    });
    const poster = await admin(asset.poster.url);
    assert.equal(poster.status, 200);
    assert.equal(poster.headers.get('content-type'), 'image/webp');
    assert.equal(poster.data.subarray(8, 12).toString(), 'WEBP');
    const invalid = await admin(
      '/api/videos',
      'POST',
      upload(Buffer.from('not a movie')),
    );
    assert.equal((await finish(admin, invalid.data.id)).status, 'error');
    assert.equal((await admin('/api/library')).data.assets.length, 1);
    assert.deepEqual(readdirSync(path.join(dir, 'video-work')), []);
  },
);

void test(
  'real video processing preserves portrait aspect and rejects clips longer than one minute',
  { skip: !hasFFmpeg },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-video-profile-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const input = path.join(dir, 'portrait.mp4');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=size=900x1600:rate=24',
      '-t',
      '0.25',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-threads',
      '2',
      input,
    ]);
    const signal = new AbortController().signal;
    const result = await processVideo({
      source: input,
      directory: dir,
      profile: 'economy',
      signal,
    });
    assert.equal(result.width, 720);
    assert.equal(result.height, 1280);
    assert.equal(result.fps, 24);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=size=16x16:rate=1',
      '-t',
      '61',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      input,
    ]);
    await assert.rejects(
      processVideo({
        source: input,
        directory: dir,
        profile: 'economy',
        signal,
      }),
      /60 seconds/,
    );
  },
);
