import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';

void test('recovery Wi-Fi is approval-gated, encrypted, stable, admin-only and removed on revocation', async (t) => {
  const { request, db, base, dir } = await fixture(t);
  const enroll = async () =>
    (
      await request(
        '/api/player/enroll',
        'POST',
        { name: 'Recovery test' },
        false,
      )
    ).data;
  const device = await enroll();
  const token = { Authorization: `Bearer ${device.token}` };
  assert.equal(
    (await request('/api/player/recovery', 'POST', {}, false, token)).status,
    403,
  );
  await request(`/api/devices/${device.id}/approve`, 'POST', {
    code: device.code,
  });
  const result = await request(
    '/api/player/recovery',
    'POST',
    {},
    false,
    token,
  );
  assert.equal(result.status, 200);
  assert.equal(result.data.ssid, device.id.replaceAll('-', ''));
  assert.equal(result.data.ssid.length, 32);
  assert.match(result.data.password, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(result.data.hidden, true);
  assert.deepEqual(
    (await request('/api/player/recovery', 'POST', {}, false, token)).data,
    result.data,
  );
  const other = await enroll();
  await request(`/api/devices/${other.id}/approve`, 'POST', {
    code: other.code,
  });
  const second = await request('/api/player/recovery', 'POST', {}, false, {
    Authorization: `Bearer ${other.token}`,
  });
  assert.notEqual(second.data.password, result.data.password);
  const route = `/api/devices/${device.id}/recovery`;
  assert.equal((await request(route, 'GET', undefined, false)).status, 401);
  assert.equal(
    (await request(route, 'GET', undefined, false, token)).status,
    401,
  );
  assert.equal((await request(route)).data.password, result.data.password);
  assert.ok(
    !JSON.stringify((await request('/api/library')).data).includes(
      result.data.password,
    ),
  );
  assert.ok(
    !JSON.stringify(db.prepare('SELECT * FROM records').all()).includes(
      result.data.password,
    ),
  );
  const response = await fetch(base + '/api/player/recovery', {
    method: 'POST',
    headers: { ...token, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  // Losing the key fails closed and never silently creates replacement credentials.
  const keyPath = path.join(dir, 'provisioning.key');
  const key = readFileSync(keyPath);
  rmSync(keyPath);
  assert.equal((await request(route)).status, 503);
  assert.equal(existsSync(keyPath), false);
  writeFileSync(keyPath, key);
  await request(`/api/devices/${device.id}`, 'DELETE');
  assert.equal(
    (await request('/api/player/recovery', 'POST', {}, false, token)).status,
    401,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) AS n FROM records WHERE kind='recovery-wifi'")
      .get().n,
    1,
  );
});

void test('playlist availability windows validate and persist into immutable publications', async (t) => {
  const { request, db } = await fixture(t);
  const slide = (await request('/api/slides', 'POST', slideData())).data;
  const item = {
    slideId: slide.id,
    duration: 10,
    startsAt: '2027-01-01T00:00:00Z',
    expiresAt: '2027-02-01T00:00:00Z',
  };
  const created = await request('/api/playlists', 'POST', {
    name: 'Scheduled',
    items: [item],
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.items[0], item);
  const id = created.data.id;
  await request(`/api/playlists/${id}/publish`, 'POST');
  const snapshot = () =>
    JSON.parse(
      db
        .prepare('SELECT body FROM records WHERE kind=? AND id=?')
        .get('playlist', id).body,
    ).published;
  assert.equal(snapshot().items[0].startsAt, item.startsAt);
  assert.equal(snapshot().items[0].expiresAt, item.expiresAt);
  await request(`/api/playlists/${id}`, 'PUT', {
    name: 'Scheduled',
    items: [{ ...item, startsAt: null, expiresAt: null }],
  });
  assert.equal(snapshot().items[0].expiresAt, item.expiresAt);
  assert.equal(
    (await request(`/api/preview/${id}`)).data.items[0].expiresAt,
    null,
  );
  for (const bad of [
    { startsAt: 'tomorrow' },
    { expiresAt: item.startsAt },
    { expiresAt: '2026-01-01T00:00:00Z' },
    { startsAt: '2027-01-01T00:00:00' },
  ]) {
    assert.equal(
      (
        await request('/api/playlists', 'POST', {
          name: 'Invalid',
          items: [{ ...item, ...bad }],
        })
      ).status,
      400,
    );
  }
});

void test('schedule toggle retains draft dates and excludes disabled limits from publication', async (t) => {
  const { request, db } = await fixture(t);
  const slide = (await request('/api/slides', 'POST', slideData())).data;
  const item = {
    slideId: slide.id,
    duration: 10,
    scheduleEnabled: false,
    startsAt: '2027-01-01T00:00:00Z',
    expiresAt: '2027-02-01T00:00:00Z',
  };
  const created = await request('/api/playlists', 'POST', {
    name: 'Optional schedule',
    items: [item],
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.items[0], item);
  const id = created.data.id;
  const snapshot = () =>
    JSON.parse(
      db
        .prepare('SELECT body FROM records WHERE kind=? AND id=?')
        .get('playlist', id).body,
    ).published.items[0];
  await request(`/api/playlists/${id}/publish`, 'POST');
  assert.equal(snapshot().startsAt, null);
  assert.equal(snapshot().expiresAt, null);
  await request(`/api/playlists/${id}`, 'PUT', {
    name: 'Optional schedule',
    items: [{ ...item, scheduleEnabled: true }],
  });
  await request(`/api/playlists/${id}/publish`, 'POST');
  assert.equal(snapshot().startsAt, item.startsAt);
  assert.equal(snapshot().expiresAt, item.expiresAt);
});

void test('clock settings persist through save and publication with validated defaults', async (t) => {
  const { request, db } = await fixture(t);
  const doc = slideData();
  doc.layers[0] = {
    ...doc.layers[0],
    type: 'clock',
    clock: { showSeconds: true, hour12: false },
  };
  const created = await request('/api/slides', 'POST', doc);
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.layers[0].clock, doc.layers[0].clock);
  const playlist = (
    await request('/api/playlists', 'POST', {
      name: 'Clocks',
      items: [{ slideId: created.data.id, duration: 10 }],
    })
  ).data;
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  const snapshot = JSON.parse(
    db
      .prepare('SELECT body FROM records WHERE kind=? AND id=?')
      .get('playlist', playlist.id).body,
  ).published;
  assert.deepEqual(
    snapshot.items[0].slide.layers[0].clock,
    doc.layers[0].clock,
  );
  for (const clock of [{ showSeconds: 'yes' }, { hour12: 24 }]) {
    assert.equal(
      (
        await request('/api/slides', 'POST', {
          ...doc,
          layers: [{ ...doc.layers[0], clock }],
        })
      ).status,
      400,
    );
  }
  const defaults = await request('/api/slides', 'POST', {
    ...doc,
    layers: [{ ...doc.layers[0], clock: {} }],
  });
  assert.deepEqual(defaults.data.layers[0].clock, {
    showSeconds: false,
    hour12: true,
  });
});

async function uploadImage(request, name = 'photo.png', folderId) {
  const png = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#447755' },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append('file', new Blob([png]), name);
  if (folderId) form.append('folderId', folderId);
  return request('/api/assets', 'POST', form);
}

async function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-test-'));
  const { app, db } = createApp({ dataDir: dir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = async (
    url,
    method = 'GET',
    body,
    auth = true,
    extra = {},
  ) => {
    const headers = {
      ...(body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...(auth ? { Cookie: cookie } : {}),
      ...extra,
    };
    const options = {
      method,
      headers,
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
      data: response.headers.get('content-type')?.includes('json')
        ? await response.json()
        : await response.arrayBuffer(),
    };
  };
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await request('/api/setup', 'POST', {
    password: 'test-password-long-enough',
  });
  return { request, db, dir, base };
}
const slideData = () => ({
  name: 'Welcome',
  width: 1920,
  height: 1080,
  background: '#173e35',
  layers: [
    {
      id: randomUUID(),
      type: 'text',
      x: 10,
      y: 10,
      width: 80,
      height: 40,
      text: 'Hello',
      fontSize: 96,
      color: '#ffffff',
      bold: true,
      align: 'left',
      fit: 'cover',
    },
  ],
});

void test('media folders support creation, rename, moving images and safe deletion', async (t) => {
  const { request } = await fixture(t);
  assert.equal(
    (await request('/api/folders', 'POST', { name: 'Events' }, false)).status,
    401,
  );
  const folder = (await request('/api/folders', 'POST', { name: 'Events' }))
    .data;
  assert.equal(
    (await request('/api/folders', 'POST', { name: 'events' })).status,
    409,
  );
  const asset = (await uploadImage(request, 'event.png', folder.id)).data;
  assert.equal(asset.folderId, folder.id);
  assert.ok(asset.createdAt);
  assert.deepEqual(asset.tags, []);
  assert.equal(
    (await request(`/api/folders/${folder.id}`, 'PUT', { name: 'Seasonal' }))
      .status,
    200,
  );
  assert.equal(
    (await request(`/api/folders/${folder.id}`, 'DELETE')).status,
    409,
  );
  assert.equal(
    (
      await request('/api/assets/batch', 'POST', {
        ids: [asset.id],
        folderId: null,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/folders/${folder.id}`, 'DELETE')).status,
    200,
  );
  assert.equal(
    (await request(`/api/assets/${asset.id}`, 'PATCH', { folderId: folder.id }))
      .status,
    404,
  );
  assert.equal(
    (await uploadImage(request, 'invalid.png', folder.id)).status,
    404,
  );
});

void test('media tag edits normalize names and batch changes are all-or-nothing', async (t) => {
  const { request } = await fixture(t);
  const a = (await uploadImage(request, 'first.png')).data;
  const b = (await uploadImage(request, 'second.png')).data;
  const changed = await request(`/api/assets/${a.id}`, 'PATCH', {
    name: 'First photo',
    tags: [' Summer ', 'summer', 'Events'],
  });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.data.tags, ['summer', 'events']);
  assert.equal(
    (await request(`/api/assets/${a.id}`, 'PATCH', { tags: ['x'.repeat(41)] }))
      .status,
    400,
  );
  assert.equal(
    (
      await request('/api/assets/batch', 'POST', {
        ids: [a.id, randomUUID()],
        addTags: ['blocked'],
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request('/api/assets/batch', 'POST', {
        ids: [a.id, b.id],
        addTags: ['LOBBY'],
        removeTags: ['events'],
      })
    ).status,
    200,
  );
  const assets = (await request('/api/library')).data.assets;
  assert.deepEqual(assets.find((item) => item.id === a.id).tags, [
    'summer',
    'lobby',
  ]);
  assert.deepEqual(assets.find((item) => item.id === b.id).tags, ['lobby']);
  assert.equal(
    (
      await request(`/api/assets/${a.id}`, 'PATCH', {
        filename: '../../secrets',
      })
    ).status,
    400,
  );
});

void test('legacy media metadata is readable without migration or loss', async (t) => {
  const { request, db } = await fixture(t);
  const a = (await uploadImage(request)).data;
  delete a.tags;
  delete a.folderId;
  delete a.createdAt;
  db.prepare('UPDATE records SET body=? WHERE kind=? AND id=?').run(
    JSON.stringify(a),
    'asset',
    a.id,
  );
  const old = (await request('/api/library')).data.assets[0];
  assert.deepEqual(old.tags, []);
  assert.equal(old.folderId, null);
  assert.equal(old.createdAt, null);
  assert.equal(old.url, a.url);
});

void test('batch deletion protects draft and published references before removing anything', async (t) => {
  const { request } = await fixture(t);
  const used = (await uploadImage(request, 'used.png')).data;
  const spare = (await uploadImage(request, 'spare.png')).data;
  const doc = slideData();
  doc.layers[0].type = 'image';
  doc.layers[0].assetId = used.id;
  const slide = (await request('/api/slides', 'POST', doc)).data;
  assert.equal(
    (
      await request('/api/assets/batch', 'POST', {
        ids: [used.id, spare.id],
        action: 'delete',
      })
    ).status,
    409,
  );
  assert.equal((await request(spare.url)).status, 200);
  const playlist = (
    await request('/api/playlists', 'POST', {
      name: 'Protected',
      items: [{ slideId: slide.id, duration: 10 }],
    })
  ).data;
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  await request(`/api/playlists/${playlist.id}`, 'PUT', {
    name: 'Protected',
    items: [],
  });
  await request(`/api/slides/${slide.id}`, 'DELETE');
  assert.equal(
    (
      await request('/api/assets/batch', 'POST', {
        ids: [used.id],
        action: 'delete',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request('/api/assets/batch', 'POST', {
        ids: [spare.id],
        action: 'delete',
      })
    ).status,
    200,
  );
  assert.equal((await request(spare.url)).status, 404);
  await request(`/api/playlists/${playlist.id}`, 'DELETE');
  assert.equal(
    (
      await request('/api/assets/batch', 'POST', {
        ids: [used.id],
        action: 'delete',
      })
    ).status,
    200,
  );
});

void test('text layout options persist in slides and published manifests', async (t) => {
  const { request } = await fixture(t);
  const doc = slideData();
  Object.assign(doc.layers[0], {
    autoSize: true,
    verticalAlign: 'bottom',
    lockAspect: false,
  });
  const slide = (await request('/api/slides', 'POST', doc)).data;
  assert.equal(slide.layers[0].autoSize, true);
  assert.equal(slide.layers[0].verticalAlign, 'bottom');
  const playlist = (
    await request('/api/playlists', 'POST', {
      name: 'Text layout',
      items: [{ slideId: slide.id, duration: 10 }],
    })
  ).data;
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  const manifest = (await request(`/api/preview/${playlist.id}`)).data;
  assert.equal(manifest.items[0].slide.layers[0].autoSize, true);
  assert.equal(manifest.items[0].slide.layers[0].verticalAlign, 'bottom');
});

void test('white slide defaults, photo crops and counter settings persist through publication', async (t) => {
  const { request, db } = await fixture(t);
  const asset = (await uploadImage(request)).data;
  const doc = slideData();
  delete doc.background;
  doc.layers = [
    {
      ...doc.layers[0],
      type: 'image',
      assetId: asset.id,
      cropX: 15,
      cropY: 80,
      cropZoom: 2.25,
    },
    {
      ...doc.layers[0],
      id: randomUUID(),
      type: 'counter',
      counter: {
        direction: 'auto',
        prefix: 'Only more...',
        suffix: '... until New Years',
        goalMessage: 'Happy New Year!',
        targetAt: '2026-09-06T12:00:00-05:00',
        unit: 'hours',
        showUnit: false,
      },
      autoSize: true,
      verticalAlign: 'middle',
    },
  ];
  const created = await request('/api/slides', 'POST', doc);
  assert.equal(created.status, 201);
  const slide = created.data;
  assert.equal(slide.background, '#ffffff');
  const playlist = (
    await request('/api/playlists', 'POST', {
      name: 'Widgets and crops',
      items: [{ slideId: slide.id, duration: 4 }],
    })
  ).data;
  const publishedSlide = () =>
    JSON.parse(
      db
        .prepare('SELECT body FROM records WHERE kind=? AND id=?')
        .get('playlist', playlist.id).body,
    ).published.items[0].slide;
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  const snapshot = publishedSlide();
  assert.equal(snapshot.layers[0].cropX, 15);
  assert.equal(snapshot.layers[0].cropY, 80);
  assert.equal(snapshot.layers[0].cropZoom, 2.25);
  assert.deepEqual(snapshot.layers[1].counter, doc.layers[1].counter);
  slide.background = '#2355aa';
  assert.equal(
    (await request(`/api/slides/${slide.id}`, 'PUT', slide)).status,
    200,
  );
  assert.equal(publishedSlide().background, '#ffffff');
  assert.equal(
    (await request(`/api/preview/${playlist.id}`)).data.items[0].slide
      .background,
    '#2355aa',
  );
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  assert.equal(publishedSlide().background, '#2355aa');
});

void test('invalid crop bounds and incomplete or invalid counter configurations are rejected', async (t) => {
  const { request } = await fixture(t);
  const doc = slideData();
  const valid = {
    direction: 'down',
    targetAt: '2026-09-06T12:00:00Z',
    unit: 'seconds',
  };
  for (const patch of [
    { cropX: -1 },
    { cropY: 101 },
    { cropZoom: 0.5 },
    { cropZoom: 5 },
    { type: 'counter' },
    { type: 'counter', counter: { ...valid, unit: 'weeks' } },
    { type: 'counter', counter: { ...valid, direction: 'sideways' } },
    { type: 'counter', counter: { ...valid, prefix: 'x'.repeat(501) } },
    { type: 'counter', counter: { ...valid, suffix: 123 } },
    { type: 'counter', counter: { ...valid, goalMessage: 'x'.repeat(501) } },
    { type: 'counter', counter: { ...valid, goalMessage: 123 } },
    { type: 'counter', counter: { ...valid, targetAt: 'tomorrow' } },
    { type: 'counter', counter: { ...valid, targetAt: '2026-09-06T12:00:00' } },
  ]) {
    assert.equal(
      (
        await request('/api/slides', 'POST', {
          ...doc,
          layers: [{ ...doc.layers[0], ...patch }],
        })
      ).status,
      400,
    );
  }
});

void test('device heartbeats expose playback readiness and delayed-switch counts', async (t) => {
  const { request } = await fixture(t);
  const enrollment = (
    await request('/api/player/enroll', 'POST', { name: 'Pi' }, false)
  ).data;
  const headers = { Authorization: `Bearer ${enrollment.token}` };
  await request(`/api/devices/${enrollment.id}/approve`, 'POST', {
    code: enrollment.code,
  });
  const playback = {
    phase: 'waiting',
    slideId: randomUUID(),
    preparationMs: 432,
    missedDeadlines: 2,
    error: 'Next slide not ready',
  };
  assert.equal(
    (await request('/api/player/sync', 'POST', { playback }, false, headers))
      .status,
    200,
  );
  assert.deepEqual(
    (await request('/api/library')).data.devices[0].status.playback,
    playback,
  );
  assert.equal(
    (
      await request(
        '/api/player/sync',
        'POST',
        { playback: { ...playback, preparationMs: -1 } },
        false,
        headers,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        '/api/player/sync',
        'POST',
        { playback: { phase: 'stalled', error: 'Browser not reporting' } },
        false,
        headers,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request('/api/library')).data.devices[0].status.playback.phase,
    'stalled',
  );
});

void test('administrator setup, authentication, logout and CSRF protection', async (t) => {
  const { request } = await fixture(t);
  assert.equal(
    (await request('/api/setup', 'POST', { password: 'another-password-long' }))
      .status,
    409,
  );
  assert.equal(
    (await request('/api/library', 'GET', undefined, false)).status,
    401,
  );
  assert.equal(
    (
      await request('/api/slides', 'POST', slideData(), true, {
        Origin: 'https://attacker.example',
      })
    ).status,
    403,
  );
  assert.equal((await request('/api/library')).status, 200);
  assert.equal((await request('/api/logout', 'POST')).status, 200);
  assert.equal((await request('/api/library')).status, 401);
  assert.equal(
    (await request('/api/login', 'POST', { password: 'wrong-password-1234' }))
      .status,
    401,
  );
  assert.equal(
    (
      await request('/api/login', 'POST', {
        password: 'test-password-long-enough',
      })
    ).status,
    200,
  );
  assert.equal((await request('/api/library')).status, 200);
});

void test('publishing creates an immutable snapshot until republished', async (t) => {
  const { request } = await fixture(t);
  const slide = (await request('/api/slides', 'POST', slideData())).data;
  const playlist = (
    await request('/api/playlists', 'POST', {
      name: 'Lobby',
      items: [{ slideId: slide.id, duration: 10 }],
    })
  ).data;
  const enrollment = (
    await request('/api/player/enroll', 'POST', { name: 'Pi' }, false)
  ).data;
  const headers = { Authorization: `Bearer ${enrollment.token}` };
  assert.equal(
    (await request('/api/player/sync', 'POST', {}, false, headers)).data
      .approved,
    false,
  );
  assert.equal(
    (
      await request(`/api/devices/${enrollment.id}/approve`, 'POST', {
        code: 'WRONG',
      })
    ).status,
    400,
  );
  await request(`/api/devices/${enrollment.id}/approve`, 'POST', {
    code: enrollment.code,
  });
  await request(`/api/devices/${enrollment.id}`, 'PUT', {
    name: 'Lobby Pi',
    playlistId: playlist.id,
    blank: false,
    rotation: 0,
  });
  assert.equal(
    (await request('/api/player/sync', 'POST', {}, false, headers)).data
      .manifest.items.length,
    0,
  );
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  const first = (await request('/api/player/sync', 'POST', {}, false, headers))
    .data.manifest;
  assert.equal(first.items[0].slide.layers[0].text, 'Hello');
  slide.layers[0].text = 'Updated';
  await request(`/api/slides/${slide.id}`, 'PUT', slide);
  const unchanged = (
    await request('/api/player/sync', 'POST', {}, false, headers)
  ).data.manifest;
  assert.equal(unchanged.revision, first.revision);
  assert.equal(unchanged.items[0].slide.layers[0].text, 'Hello');
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  const changed = (
    await request('/api/player/sync', 'POST', {}, false, headers)
  ).data.manifest;
  assert.notEqual(changed.revision, first.revision);
  assert.equal(changed.items[0].slide.layers[0].text, 'Updated');
  assert.equal(
    (await request(`/api/slides/${slide.id}`, 'DELETE')).status,
    409,
  );
  assert.equal(
    (await request(`/api/playlists/${playlist.id}`, 'DELETE')).status,
    409,
  );
});

void test('validates geometry, images, playlist references and durations', async (t) => {
  const { request } = await fixture(t);
  const invalid = slideData();
  invalid.layers[0].x = 80;
  assert.equal((await request('/api/slides', 'POST', invalid)).status, 400);
  invalid.layers[0].x = 0;
  invalid.layers[0].type = 'image';
  assert.equal((await request('/api/slides', 'POST', invalid)).status, 400);
  assert.equal(
    (
      await request('/api/playlists', 'POST', {
        name: 'Broken',
        items: [{ slideId: randomUUID(), duration: 10 }],
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request('/api/playlists', 'POST', {
        name: 'Broken',
        items: [{ slideId: randomUUID(), duration: -1 }],
      })
    ).status,
    400,
  );
  const p = (
    await request('/api/playlists', 'POST', { name: 'Empty', items: [] })
  ).data;
  assert.equal(
    (await request(`/api/playlists/${p.id}/publish`, 'POST')).status,
    400,
  );
});

void test('media is validated, re-encoded, and restricted to assigned players', async (t) => {
  const { request } = await fixture(t);
  const bad = new FormData();
  bad.append('file', new Blob(['not an image']), 'bad.png');
  assert.equal((await request('/api/assets', 'POST', bad)).status, 400);
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#ffcc00' },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append('file', new Blob([png]), 'test.png');
  const uploaded = await request('/api/assets', 'POST', form);
  assert.equal(uploaded.status, 201);
  const asset = uploaded.data;
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await request(asset.url)).status, 200);
  assert.equal((await request(asset.url, 'GET', undefined, false)).status, 401);
  const enrollment = (
    await request('/api/player/enroll', 'POST', { name: 'Pi' }, false)
  ).data;
  const headers = { Authorization: `Bearer ${enrollment.token}` };
  assert.equal(
    (await request(asset.url, 'GET', undefined, false, headers)).status,
    403,
  );
  await request(`/api/devices/${enrollment.id}/approve`, 'POST', {
    code: enrollment.code,
  });
  assert.equal(
    (await request(asset.url, 'GET', undefined, false, headers)).status,
    403,
  );
  const s = slideData();
  s.layers[0].type = 'image';
  s.layers[0].assetId = asset.id;
  const slide = (await request('/api/slides', 'POST', s)).data;
  const p = (
    await request('/api/playlists', 'POST', {
      name: 'Images',
      items: [{ slideId: slide.id, duration: 10 }],
    })
  ).data;
  await request(`/api/playlists/${p.id}/publish`, 'POST');
  await request(`/api/devices/${enrollment.id}`, 'PUT', {
    name: 'Pi',
    playlistId: p.id,
    blank: false,
    rotation: 0,
  });
  assert.equal(
    (await request(asset.url, 'GET', undefined, false, headers)).status,
    200,
  );
});

void test('commands are acknowledged, token hashes stay private, and revocation invalidates access', async (t) => {
  const { request } = await fixture(t);
  const device = (
    await request('/api/player/enroll', 'POST', { name: 'Pi' }, false)
  ).data;
  const headers = { Authorization: `Bearer ${device.token}` };
  await request(`/api/devices/${device.id}/approve`, 'POST', {
    code: device.code,
  });
  await request(`/api/devices/${device.id}/command`, 'POST', {
    type: 'refresh',
  });
  const first = (await request('/api/player/sync', 'POST', {}, false, headers))
    .data;
  assert.equal(first.command.type, 'refresh');
  const acked = (
    await request(
      '/api/player/sync',
      'POST',
      { commandAck: first.command.id },
      false,
      headers,
    )
  ).data;
  assert.equal(acked.command, null);
  const library = (await request('/api/library')).data;
  assert.equal(library.devices[0].tokenHash, undefined);
  assert.ok(library.devices[0].lastSeen);
  await request(`/api/devices/${device.id}`, 'DELETE');
  assert.equal(
    (await request('/api/player/sync', 'POST', {}, false, headers)).status,
    401,
  );
});

void test('SQLite data and administrator credentials survive reopening the database', async (t) => {
  const { request, dir } = await fixture(t);
  const slide = (await request('/api/slides', 'POST', slideData())).data;
  const reopened = createApp({ dataDir: dir });
  assert.equal(
    JSON.parse(
      reopened.db
        .prepare('SELECT body FROM records WHERE kind=? AND id=?')
        .get('slide', slide.id).body,
    ).name,
    'Welcome',
  );
  assert.ok(
    reopened.db
      .prepare('SELECT value FROM settings WHERE key=?')
      .get('password'),
  );
  reopened.db.close();
});

void test('HTTPS proxy origin and secure cookies work without granting Access headers administrator rights', async (t) => {
  const oldUrl = process.env.PUBLIC_URL,
    oldSecure = process.env.COOKIE_SECURE;
  process.env.PUBLIC_URL = 'https://openframe.example.com';
  process.env.COOKIE_SECURE = 'true';
  t.after(() => {
    if (oldUrl === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = oldUrl;
    if (oldSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = oldSecure;
  });
  const { request, base } = await fixture(t);
  const response = await fetch(base + '/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://openframe.example.com',
    },
    body: JSON.stringify({ password: 'test-password-long-enough' }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /; Secure/);
  assert.match(response.headers.get('set-cookie'), /; HttpOnly/);
  assert.equal(
    (
      await request('/api/slides', 'POST', slideData(), true, {
        Origin: 'https://openframe.example.com',
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await request('/api/slides', 'POST', slideData(), true, {
        Origin: 'https://untrusted.example.com',
        'X-Forwarded-Host': 'openframe.example.com',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/api/library', 'GET', undefined, false, {
        'CF-Access-Client-Id': 'fake-id',
        'CF-Access-Authenticated-User-Email': 'admin@example.com',
      })
    ).status,
    401,
  );
  const invalid = await request('/api/player/sync', 'POST', {}, false, {
    Authorization: 'Bearer invalid-device-token',
  });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.data.code, 'DEVICE_CREDENTIALS_INVALID');
});

void test(
  'player connection-check CLI reaches the server without enrolling or creating a cache',
  { skip: !process.env.OPENFRAME_PYTHON },
  async (t) => {
    const { request, dir, base } = await fixture(t);
    const config = path.join(dir, 'connection-check.json'),
      cache = path.join(dir, 'unused-cache');
    writeFileSync(config, JSON.stringify({ server: base }));
    const output = await new Promise((resolve, reject) => {
      const child = spawn(
        process.env.OPENFRAME_PYTHON,
        [
          fileURLToPath(new URL('../player/agent.py', import.meta.url)),
          '--config',
          config,
          '--cache',
          cache,
          '--check-connection',
        ],
        { windowsHide: true },
      );
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolve(stdout) : reject(new Error(stderr)),
      );
    });
    assert.equal(JSON.parse(output).reachable, true);
    assert.equal(existsSync(cache), false);
    assert.equal((await request('/api/library')).data.devices.length, 0);
  },
);

void test(
  'real Python agent enrolls, downloads a publication and reports its revision',
  { skip: !process.env.OPENFRAME_PYTHON },
  async (t) => {
    const { request, dir, base } = await fixture(t);
    const cache = path.join(dir, 'player-cache');
    async function sync() {
      const code =
        "from agent import Agent; import sys; a=Agent({'server':sys.argv[1], 'name':'Integration Pi'},sys.argv[2]); a.sync()";
      await new Promise((resolve, reject) => {
        const child = spawn(
          process.env.OPENFRAME_PYTHON,
          ['-c', code, base, cache],
          {
            cwd: fileURLToPath(new URL('../player', import.meta.url)),
            windowsHide: true,
          },
        );
        let error = '';
        child.stderr.on('data', (chunk) => (error += chunk));
        child.on('error', reject);
        child.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(error)),
        );
      });
    }
    await sync();
    const identity = JSON.parse(
      readFileSync(path.join(cache, 'identity.json')),
    );
    assert.ok(identity.token);
    await request(`/api/devices/${identity.id}/approve`, 'POST', {
      code: identity.code,
    });
    const buffer = await sharp({
      create: { width: 80, height: 50, channels: 3, background: '#217b54' },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append('file', new Blob([buffer]), 'integration.png');
    const asset = (await request('/api/assets', 'POST', form)).data;
    const data = slideData();
    data.layers[0].type = 'image';
    data.layers[0].assetId = asset.id;
    const slide = (await request('/api/slides', 'POST', data)).data;
    const p = (
      await request('/api/playlists', 'POST', {
        name: 'Integration',
        items: [{ slideId: slide.id, duration: 8 }],
      })
    ).data;
    await request(`/api/playlists/${p.id}/publish`, 'POST');
    await request(`/api/devices/${identity.id}`, 'PUT', {
      name: 'Integration Pi',
      playlistId: p.id,
      blank: false,
      rotation: 90,
    });
    await sync();
    const state = JSON.parse(readFileSync(path.join(cache, 'state.json')));
    assert.equal(state.approved, true);
    assert.equal(state.rotation, 90);
    assert.equal(state.manifest.items[0].duration, 8);
    assert.ok(
      readFileSync(path.join(cache, 'media', asset.filename)).length > 0,
    );
    await sync();
    const library = (await request('/api/library')).data;
    assert.equal(library.devices[0].status.revision, state.manifest.revision);
  },
);
