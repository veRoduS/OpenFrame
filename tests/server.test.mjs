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

void test('library publication status and published preview preserve the actual screen version', async (t) => {
  const { request } = await fixture(t);
  const slide = (await request('/api/slides', 'POST', slideData())).data;
  const body = { name: 'Lobby', items: [{ slideId: slide.id, duration: 10 }] };
  const playlist = (await request('/api/playlists', 'POST', body)).data;
  assert.equal(playlist.publicationState, 'draft');
  assert.equal(
    (await request(`/api/preview/${playlist.id}?version=published`)).status,
    404,
  );
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  let row = (await request('/api/library')).data.playlists.find(
    (p) => p.id === playlist.id,
  );
  assert.equal(row.publicationState, 'published');
  assert.ok(row.publishedRevision);
  await request(`/api/playlists/${playlist.id}`, 'PUT', {
    ...body,
    tags: ['lobby'],
  });
  assert.equal(
    (await request('/api/library')).data.playlists[0].publicationState,
    'published',
  );
  const updated = await request(`/api/playlists/${playlist.id}`, 'PUT', {
    ...body,
    items: [{ slideId: slide.id, duration: 20 }],
  });
  assert.equal(updated.data.publicationState, 'changes');
  assert.equal(
    (await request(`/api/preview/${playlist.id}`)).data.items[0].duration,
    20,
  );
  assert.equal(
    (await request(`/api/preview/${playlist.id}?version=published`)).data
      .items[0].duration,
    10,
  );
  assert.equal(
    (
      await request(
        `/api/preview/${playlist.id}?version=published`,
        'GET',
        undefined,
        false,
      )
    ).status,
    401,
  );
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  row = (await request('/api/library')).data.playlists[0];
  assert.equal(row.publicationState, 'published');
  assert.equal(
    (await request(`/api/preview/${playlist.id}?version=published`)).data
      .items[0].duration,
    20,
  );
});

void test('publication removes generated starter text from slides, including repeated entries, while preserving intentional text', async (t) => {
  const { request } = await fixture(t);
  const upload = new FormData();
  upload.append(
    'file',
    new Blob(
      [
        await sharp({
          create: {
            width: 100,
            height: 100,
            channels: 3,
            background: '#202923',
          },
        })
          .png()
          .toBuffer(),
      ],
      { type: 'image/png' },
    ),
    'cover.png',
  );
  const image = (await request('/api/assets', 'POST', upload)).data;
  const body = slideData();
  const starter = {
    ...body.layers[0],
    text: 'Something worth\nsharing.',
    starterText: true,
  };
  body.layers = [
    starter,
    { ...starter, id: randomUUID(), starterText: undefined },
    {
      ...starter,
      id: randomUUID(),
      type: 'image',
      assetId: image.id,
      starterText: undefined,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    },
  ];
  const slide = (await request('/api/slides', 'POST', body)).data;
  const playlist = (
    await request('/api/playlists', 'POST', {
      name: 'Starter cleanup',
      items: [
        { slideId: slide.id, duration: 10 },
        { slideId: slide.id, duration: 20 },
      ],
    })
  ).data;
  assert.equal(
    (await request(`/api/preview/${playlist.id}`)).data.items[0].slide.layers
      .length,
    3,
  );
  assert.equal((await request('/api/library')).data.slides[0].layers.length, 3);
  assert.equal(
    (await request(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  const stored = (await request('/api/library')).data.slides[0];
  assert.equal(stored.layers.length, 2);
  assert.equal(stored.layers[0].id, body.layers[1].id);
  for (const item of (
    await request(`/api/preview/${playlist.id}?version=published`)
  ).data.items) {
    assert.equal(item.slide.layers.length, 2);
    assert.equal(item.slide.layers[0].starterText, undefined);
  }
  const changed = (
    await request('/api/slides', 'POST', { ...slideData(), layers: [starter] })
  ).data;
  const edit = (
    await request(`/api/slides/${changed.id}`, 'PUT', {
      ...changed,
      layers: [{ ...changed.layers[0], text: 'Changed message' }],
    })
  ).data;
  assert.equal(edit.layers[0].starterText, undefined);
  await request(`/api/slides/${edit.id}`, 'PUT', {
    ...edit,
    layers: [starter],
  });
  const second = (
    await request('/api/playlists', 'POST', {
      name: 'Keep reverted text',
      items: [{ slideId: edit.id, duration: 10 }],
    })
  ).data;
  await request(`/api/playlists/${second.id}/publish`, 'POST');
  assert.equal(
    (await request(`/api/preview/${second.id}?version=published`)).data.items[0]
      .slide.layers.length,
    1,
  );
});

void test('failed publication leaves starter text untouched and published references block deletion', async (t) => {
  const { request, db } = await fixture(t);
  const body = slideData();
  body.layers[0] = {
    ...body.layers[0],
    text: 'Something worth\nsharing.',
    starterText: true,
  };
  const slide = (await request('/api/slides', 'POST', body)).data;
  const playlist = (
    await request('/api/playlists', 'POST', {
      name: 'Publication rollback',
      items: [{ slideId: slide.id, duration: 10 }],
    })
  ).data;
  const broken = {
    ...slide,
    layers: [
      ...slide.layers,
      {
        ...slide.layers[0],
        id: randomUUID(),
        type: 'image',
        assetId: randomUUID(),
        starterText: undefined,
      },
    ],
  };
  db.prepare("UPDATE records SET body=? WHERE kind='slide' AND id=?").run(
    JSON.stringify(broken),
    slide.id,
  );
  assert.equal(
    (await request(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    404,
  );
  assert.equal(
    (await request('/api/library')).data.slides[0].layers[0].starterText,
    true,
  );
  db.prepare("UPDATE records SET body=? WHERE kind='slide' AND id=?").run(
    JSON.stringify(slide),
    slide.id,
  );
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  await request(`/api/playlists/${playlist.id}`, 'PUT', {
    name: playlist.name,
    items: [],
  });
  assert.equal(
    (await request(`/api/slides/${slide.id}`, 'DELETE')).status,
    409,
  );
});

void test('playlist transitions validate, persist and remain isolated in publications', async (t) => {
  const { request, db } = await fixture(t);
  const slide = (await request('/api/slides', 'POST', slideData())).data;
  const body = {
    name: 'Transitions',
    items: [{ slideId: slide.id, duration: 2 }],
  };
  const playlist = (await request('/api/playlists', 'POST', body)).data;
  assert.deepEqual(playlist.transition, { type: 'cut', durationMs: 500 });
  let oldRevision;
  for (const type of ['fade', 'slide-left', 'slide-right', 'cut']) {
    const transition = { type, durationMs: 800 };
    const result = await request(`/api/playlists/${playlist.id}`, 'PUT', {
      ...body,
      transition,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.transition, transition);
    const preview = (await request(`/api/preview/${playlist.id}`)).data;
    assert.notEqual(preview.revision, oldRevision);
    oldRevision = preview.revision;
    assert.deepEqual(preview.transition, transition);
    await request(`/api/playlists/${playlist.id}/publish`, 'POST');
    const record = JSON.parse(
      db
        .prepare('SELECT body FROM records WHERE kind=? AND id=?')
        .get('playlist', playlist.id).body,
    );
    assert.deepEqual(record.published.transition, transition);
  }
  await request(`/api/playlists/${playlist.id}`, 'PUT', {
    ...body,
    transition: { type: 'fade', durationMs: 500 },
  });
  const record = JSON.parse(
    db
      .prepare('SELECT body FROM records WHERE kind=? AND id=?')
      .get('playlist', playlist.id).body,
  );
  assert.deepEqual(record.published.transition, {
    type: 'cut',
    durationMs: 800,
  });
  for (const transition of [
    { type: 'spin' },
    { type: 'fade', durationMs: 0 },
    { type: 'fade', durationMs: 2001 },
    { type: 'fade', durationMs: 250 },
  ])
    assert.equal(
      (await request('/api/playlists', 'POST', { ...body, transition })).status,
      400,
    );
});

void test('ZIP lookup is admin-only, validates requests and returns normalized coordinates', async (t) => {
  let calls = 0;
  const { request } = await fixture(t, {
    zipFetch: async (url) => {
      calls++;
      assert.equal(url, 'https://api.zippopotam.us/us/02108');
      return Response.json({
        places: [
          {
            'place name': 'Boston',
            'state abbreviation': 'MA',
            latitude: '42.357',
            longitude: '-71.064',
          },
        ],
      });
    },
  });
  assert.equal(
    (await request('/api/weather/zip?zip=02108', 'GET', undefined, false))
      .status,
    401,
  );
  assert.equal((await request('/api/weather/zip?zip=123')).status, 400);
  const result = await request('/api/weather/zip?zip=02108');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, {
    zip: '02108',
    places: [{ name: 'Boston, MA', latitude: 42.357, longitude: -71.064 }],
  });
  await request('/api/weather/zip?zip=02108');
  assert.equal(calls, 1);
});

void test('weather is admin-only, shared across approved players, and updates outside publication revisions', async (t) => {
  const gate = Promise.withResolvers();
  t.after(() => gate.resolve());
  let calls = 0;
  const { request } = await fixture(t, {
    weatherFetch: async (url) => {
      calls++;
      if (url.includes('/points/'))
        return Response.json({
          properties: { gridId: 'LOT', gridX: 75, gridY: 73 },
        });
      await gate.promise;
      return Response.json({
        properties: {
          periods: [
            {
              startTime: new Date(Date.now() - 3600000).toISOString(),
              endTime: new Date(Date.now() + 3600000).toISOString(),
              temperature: 72,
              temperatureUnit: 'F',
              shortForecast: 'Partly Sunny',
            },
          ],
        },
      });
    },
  });
  const endpoint = '/api/weather?latitude=41.8781&longitude=-87.6298';
  assert.equal((await request(endpoint, 'GET', undefined, false)).status, 401);
  assert.equal(
    (await request('/api/weather?latitude=91&longitude=0')).status,
    400,
  );
  assert.equal(
    (await request('/api/weather?latitude=&longitude=0')).status,
    400,
  );
  const draft = slideData();
  draft.layers = [
    {
      ...draft.layers[0],
      type: 'weather',
      weather: {
        latitude: 41.8781,
        longitude: -87.6298,
        name: 'Office',
        unit: 'F',
      },
    },
  ];
  const slide = (await request('/api/slides', 'POST', draft)).data;
  const playlist = (
    await request('/api/playlists', 'POST', {
      name: 'Weather',
      items: [{ slideId: slide.id, duration: 60 }],
    })
  ).data;
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  const devices = [];
  for (const name of ['First screen', 'Second screen']) {
    const device = (
      await request('/api/player/enroll', 'POST', { name }, false)
    ).data;
    const token = { Authorization: `Bearer ${device.token}` };
    assert.equal(
      (await request('/api/player/sync', 'POST', {}, false, token)).data
        .weather,
      undefined,
    );
    await request(`/api/devices/${device.id}/approve`, 'POST', {
      code: device.code,
    });
    await request(`/api/devices/${device.id}`, 'PUT', {
      name,
      playlistId: playlist.id,
      blank: false,
      rotation: 0,
    });
    devices.push(token);
  }
  const first = (
    await request('/api/player/sync', 'POST', {}, false, devices[0])
  ).data;
  const second = (
    await request('/api/player/sync', 'POST', {}, false, devices[1])
  ).data;
  assert.equal(first.manifest.revision, second.manifest.revision);
  assert.deepEqual(Object.keys(first.weather), ['41.8781,-87.6298']);
  assert.equal(first.weather['41.8781,-87.6298'].status, 'loading');
  gate.resolve();
  for (let i = 0; i < 50; i++) {
    if ((await request(endpoint)).data.periods.length) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const updated = (
    await request('/api/player/sync', 'POST', {}, false, devices[0])
  ).data;
  assert.equal(updated.manifest.revision, first.manifest.revision);
  assert.equal(updated.weather['41.8781,-87.6298'].periods[0].temperatureF, 72);
  assert.deepEqual(
    (await request('/api/player/sync', 'POST', {}, false, devices[1])).data
      .weather,
    updated.weather,
  );
  assert.equal(calls, 3);
  const preview = (await request(`/api/preview/${playlist.id}`)).data;
  assert.equal(
    (await request(`/api/preview/${playlist.id}`)).data.revision,
    preview.revision,
  );
  assert.equal(preview.weather['41.8781,-87.6298'].periods[0].temperatureF, 72);
  assert.equal(
    (await request(endpoint, 'GET', undefined, false, devices[0])).status,
    401,
  );
  await request(`/api/playlists/${playlist.id}`, 'PUT', {
    name: 'Weather',
    items: [],
  });
  // Draft edits do not remove a location from the published playlist.
  assert.equal(
    Object.keys(
      (await request('/api/player/sync', 'POST', {}, false, devices[0])).data
        .weather,
    ).length,
    1,
  );
});

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
  assert.match(created.data.items[0].id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(created.data.items[0], {
    ...item,
    id: created.data.items[0].id,
  });
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
  assert.match(created.data.items[0].id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(created.data.items[0], {
    ...item,
    id: created.data.items[0].id,
  });
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

async function fixture(t, options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-test-'));
  const { app, db, close } = createApp({ dataDir: dir, ...options });
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
    close();
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
  const child = (
    await request('/api/folders', 'POST', {
      name: 'Summer',
      parentId: folder.id,
    })
  ).data;
  assert.equal(child.parentId, folder.id);
  assert.equal(
    (
      await request(`/api/folders/${folder.id}`, 'PUT', {
        name: 'Events',
        parentId: child.id,
      })
    ).status,
    400,
  );
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
    (await request(`/api/folders/${child.id}`, 'DELETE')).status,
    200,
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

void test('batch deletion removes referenced files and preserves slide placeholders', async (t) => {
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
    200,
  );
  assert.equal((await request(spare.url)).status, 404);
  assert.equal(
    (await request('/api/library')).data.slides[0].layers[0].removedMedia,
    true,
  );
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
    404,
  );
  assert.equal(
    (
      await request('/api/assets/batch', 'POST', {
        ids: [spare.id],
        action: 'delete',
      })
    ).status,
    404,
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
    404,
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
  assert.equal(publishedSlide().background, '#2355aa');
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

void test('publishing refreshes included slides automatically after edits', async (t) => {
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
  const refreshed = (
    await request('/api/player/sync', 'POST', {}, false, headers)
  ).data.manifest;
  assert.notEqual(refreshed.revision, first.revision);
  assert.equal(refreshed.items[0].slide.layers[0].text, 'Updated');
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
  const normalized = await request('/api/slides', 'POST', invalid);
  assert.equal(normalized.status, 201);
  assert.equal(normalized.data.layers[0].x, 20);
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

void test('deleting referenced media leaves placeholders in slides and publications', async (t) => {
  const { request, db } = await fixture(t);
  const asset = (await uploadImage(request, 'removed.png')).data;
  const slide = slideData();
  slide.layers[0] = {
    ...slide.layers[0],
    type: 'image',
    assetId: asset.id,
  };
  const savedSlide = (await request('/api/slides', 'POST', slide)).data;
  const playlist = (
    await request('/api/playlists', 'POST', {
      name: 'Lobby',
      items: [{ slideId: savedSlide.id, duration: 10 }],
    })
  ).data;
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  const original = JSON.parse(
    db
      .prepare("SELECT body FROM records WHERE kind='playlist' AND id=?")
      .get(playlist.id).body,
  ).published;
  assert.equal(original.schemaVersion, 2);

  const result = await request('/api/assets/batch', 'POST', {
    ids: [asset.id],
    action: 'delete',
  });
  assert.equal(result.status, 200);
  const library = (await request('/api/library')).data;
  assert.equal(
    library.assets.some((item) => item.id === asset.id),
    false,
  );
  assert.equal(library.slides[0].layers[0].removedMedia, true);
  const savedPlaylist = JSON.parse(
    db
      .prepare("SELECT body FROM records WHERE kind='playlist' AND id=?")
      .get(playlist.id).body,
  ).published;
  assert.notEqual(savedPlaylist.revision, original.revision);
  assert.equal(savedPlaylist.items[0].slide.layers[0].removedMedia, true);
  assert.equal(
    savedPlaylist.assets.some((item) => item.id === asset.id),
    false,
  );
  assert.equal(
    (await request(`/api/slides/${savedSlide.id}`, 'PUT', library.slides[0]))
      .status,
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
      .prepare('SELECT password FROM users WHERE username=?')
      .get('admin')?.password,
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
