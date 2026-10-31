import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { dataWidgetSchema } from '../server/data-feeds.mjs';
import { migrateKeyExpiry } from '../server/api-key-expiry.mjs';

const definition = {
  name: 'Production',
  fields: [
    { key: 'completed', type: 'number' },
    { key: 'goal', type: 'number' },
    { key: 'hourly', type: 'series' },
    { key: 'departments', type: 'categories' },
  ],
};
const payload = {
  completed: 75,
  goal: 100,
  hourly: [
    { time: '2026-10-06T09:00:00Z', value: 30 },
    { time: '2026-10-06T10:00:00Z', value: 75 },
  ],
  departments: [{ label: 'Grocery', value: 42 }],
};
const widget = (feedId, mode = 'metric', field = 'completed') => ({
  id: randomUUID(),
  type: 'data',
  x: 0,
  y: 0,
  width: 50,
  height: 40,
  data: { mode, feedId, field },
});
const slide = (feedId) => ({
  name: 'Data slide',
  width: 1920,
  height: 1080,
  layers: [widget(feedId)],
});
async function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-feeds-'));
  const instance = createApp({ dataDir: dir });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    instance.close();
    await new Promise((resolve) => server.close(resolve));
    instance.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  function client() {
    let cookie = '';
    return async (url, method = 'GET', body, headers = {}, raw = false) => {
      const response = await fetch(base + url, {
        method,
        headers: { cookie, 'Content-Type': 'application/json', ...headers },
        ...(body === undefined
          ? {}
          : { body: raw ? body : JSON.stringify(body) }),
      });
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0];
      return {
        status: response.status,
        headers: response.headers,
        data: response.headers.get('content-type')?.includes('json')
          ? await response.json()
          : await response.text(),
      };
    };
  }
  const admin = client();
  assert.equal(
    (await admin('/api/setup', 'POST', { password: 'data-feed-test-password' }))
      .status,
    200,
  );
  async function user(name) {
    const result = (await admin('/api/users', 'POST', { username: name, name }))
      .data;
    const call = client();
    assert.equal(
      (
        await call('/api/activate', 'POST', {
          token: result.invitation,
          password: 'data-feed-test-password',
        })
      ).status,
      200,
    );
    return { ...result.user, call };
  }
  const created = await admin('/api/data-feeds', 'POST', definition);
  assert.equal(created.status, 201);
  const feed = created.data;
  const issued = await admin(`/api/data-feeds/${feed.id}/tokens`, 'POST', {
    name: 'Integration',
  });
  assert.equal(issued.status, 201);
  const token = issued.data;
  const external = client();
  const write = (
    data = payload,
    headers = {},
    raw = false,
    id = feed.id,
    secret = token.token,
  ) =>
    external(
      `/api/data-feeds/${id}/data`,
      'PUT',
      data,
      { Authorization: `Bearer ${secret}`, ...headers },
      raw,
    );
  return { ...instance, admin, client, user, feed, token, write };
}

void test('snapshot replacement is atomic, bounded, persisted, and tokens are write only', async (t) => {
  const { admin, feed, token, write, db, client } = await fixture(t);
  const updated = await write();
  assert.equal(updated.status, 200);
  assert.equal(updated.data.feedId, feed.id);
  assert.equal(
    (await admin(`/api/data-feeds/${feed.id}/data`)).data.data.completed,
    75,
  );
  assert.equal(
    JSON.parse(
      db
        .prepare("SELECT body FROM records WHERE kind='data-feed' AND id=?")
        .get(feed.id).body,
    ).data.completed,
    75,
  );
  const row = db
    .prepare('SELECT * FROM data_feed_tokens WHERE id=?')
    .get(token.id);
  assert.ok(row.lastUsedAt);
  assert.notEqual(row.digest, token.token);
  assert.ok(
    !JSON.stringify(
      (await admin(`/api/data-feeds/${feed.id}/tokens`)).data,
    ).includes(token.token),
  );
  const library = (await admin('/api/library')).data;
  assert.equal(library.dataFeeds[0].data, undefined);
  assert.ok(!JSON.stringify(library).includes(token.token));
  assert.equal(
    (
      await client()(`/api/data-feeds/${feed.id}/data`, 'GET', undefined, {
        Authorization: `Bearer ${token.token}`,
      })
    ).status,
    401,
  );
  assert.equal((await write(payload, {}, false, randomUUID())).status, 401);
  const cleared = await write({
    ...payload,
    completed: null,
    hourly: [],
    departments: [],
  });
  assert.equal(cleared.status, 200);
  assert.notEqual(cleared.data.revision, updated.data.revision);
  assert.equal(
    (await admin(`/api/data-feeds/${feed.id}/data`)).data.data.completed,
    null,
  );
});

void test('rejects malformed, partial, oversized and invalid snapshots without replacing the last valid data', async (t) => {
  const { write, admin, feed } = await fixture(t);
  const original = await write();
  const bad = [
    { ...payload, extra: 4 },
    { completed: 4 },
    { ...payload, completed: '75' },
    { ...payload, completed: 1e13 },
    { ...payload, hourly: [...payload.hourly].reverse() },
    { ...payload, hourly: [payload.hourly[0], payload.hourly[0]] },
    { ...payload, hourly: [{ time: '2026-10-06T10:00:00', value: 4 }] },
    {
      ...payload,
      departments: [
        { label: 'A', value: 1 },
        { label: 'A', value: 2 },
      ],
    },
    {
      ...payload,
      hourly: Array.from({ length: 241 }, (_, i) => ({
        time: new Date(i * 60000).toISOString(),
        value: i,
      })),
    },
  ];
  for (const data of bad) {
    const result = await write(data);
    assert.equal(result.status, 400, JSON.stringify(result.data));
    assert.equal(result.data.code, 'INVALID_PAYLOAD');
  }
  assert.equal((await write('{broken', {}, true)).status, 400);
  const tooLarge = await write(
    JSON.stringify(payload) + ' '.repeat(32768),
    {},
    true,
  );
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.data.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(
    (await write(payload, { 'Content-Type': 'text/plain' })).status,
    415,
  );
  assert.equal(
    (await write(payload, { Origin: 'https://wrong.example' })).status,
    403,
  );
  assert.equal(
    (await admin(`/api/data-feeds/${feed.id}/data`)).data.revision,
    original.data.revision,
  );
});

void test('token revocation, expiry and creator loss of access deny subsequent writes', async (t) => {
  const { admin, feed, token, write, user, db } = await fixture(t);
  await admin(`/api/data-feeds/${feed.id}/tokens/${token.id}`, 'DELETE');
  assert.equal((await write()).status, 401);
  const expired = (
    await admin(`/api/data-feeds/${feed.id}/tokens`, 'POST', {
      name: 'Expired',
    })
  ).data;
  db.prepare('UPDATE data_feed_tokens SET expiresAt=? WHERE id=?').run(
    '2000-01-01T00:00:00Z',
    expired.id,
  );
  assert.equal(
    (await write(payload, {}, false, feed.id, expired.token)).status,
    401,
  );
  const editor = await user('feed-editor');
  await admin(`/api/access/data-feed/${feed.id}`, 'POST', {
    userId: editor.id,
    permission: 'edit',
  });
  // Model a key issued before setup was restricted to admins.
  const mine = await admin(`/api/data-feeds/${feed.id}/tokens`, 'POST', {
    name: 'Legacy editor key',
  });
  db.prepare('UPDATE data_feed_tokens SET creatorId=? WHERE id=?').run(
    editor.id,
    mine.data.id,
  );
  assert.equal(
    (await write(payload, {}, false, feed.id, mine.data.token)).status,
    200,
  );
  await admin(`/api/access/data-feed/${feed.id}`, 'POST', {
    userId: editor.id,
    remove: true,
  });
  assert.equal(
    (await write(payload, {}, false, feed.id, mine.data.token)).status,
    401,
  );
});

void test('Settings setup requires admin even with explicit feed Edit access', async (t) => {
  const { admin, feed, token, write, user } = await fixture(t);
  const editor = await user('settings-editor');
  await admin(`/api/access/data-feed/${feed.id}`, 'POST', {
    userId: editor.id,
    permission: 'edit',
  });
  assert.equal((await editor.call(`/api/data-feeds/${feed.id}`)).status, 200);
  assert.equal(
    (await editor.call(`/api/data-feeds/${feed.id}/data`)).status,
    200,
  );
  assert.ok(
    (await editor.call('/api/library')).data.dataFeeds.some(
      (entry) => entry.id === feed.id,
    ),
  );
  /** @type {[string, string, unknown?][]} */
  const denied = [
    ['/api/data-feeds', 'POST', definition],
    [`/api/data-feeds/${feed.id}`, 'PUT', { name: 'Unauthorized rename' }],
    [`/api/data-feeds/${feed.id}`, 'DELETE'],
    [`/api/data-feeds/${feed.id}/tokens`, 'GET'],
    [`/api/data-feeds/${feed.id}/tokens`, 'POST', { name: 'Unauthorized key' }],
    [`/api/data-feeds/${feed.id}/tokens/${token.id}`, 'DELETE'],
    ['/api/settings/stocks', 'GET'],
    ['/api/settings/stocks', 'PUT', { apiKey: 'unauthorized' }],
    ['/api/fonts', 'POST'],
    [`/api/fonts/${randomUUID()}`, 'DELETE'],
  ];
  for (const [url, method, body] of denied) {
    const result = await editor.call(url, method, body);
    assert.equal(result.status, 403, `${method} ${url}`);
    assert.equal(result.data.error, 'Admin access required');
  }
  assert.equal(
    (await admin(`/api/data-feeds/${feed.id}`)).data.name,
    definition.name,
  );
  assert.equal(
    (await admin(`/api/data-feeds/${feed.id}/tokens`)).data.length,
    1,
  );
  assert.equal((await write()).status, 200);
  assert.equal((await editor.call('/api/fonts')).status, 200);
});

void test('inherited groups can view feeds but cannot manage them or issue tokens', async (t) => {
  const { admin, feed, user } = await fixture(t);
  const parent = (await admin('/api/groups', 'POST', { name: 'Region' })).data;
  const child = (
    await admin('/api/groups', 'POST', { name: 'Store', parentId: parent.id })
  ).data;
  const person = await user('feed-viewer');
  await admin(`/api/groups/${child.id}/members/${person.id}`, 'PUT', {
    role: 'member',
  });
  assert.equal(
    (
      await admin(`/api/access/data-feed/${feed.id}/management`, 'PUT', {
        groupId: parent.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (await person.call(`/api/data-feeds/${feed.id}/data`)).status,
    200,
  );
  assert.equal(
    (await person.call(`/api/data-feeds/${feed.id}`)).data.readOnly,
    true,
  );
  assert.equal(
    (
      await person.call(`/api/data-feeds/${feed.id}/tokens`, 'POST', {
        name: 'No',
      })
    ).status,
    403,
  );
  assert.equal(
    (await person.call(`/api/data-feeds/${feed.id}`, 'DELETE')).status,
    403,
  );
  const outsider = await user('feed-outsider');
  assert.equal((await outsider.call('/api/data-feeds')).data.length, 0);
  assert.equal(
    (await outsider.call('/api/slides', 'POST', slide(feed.id))).status,
    403,
  );
});

void test('publishes schema four and syncs current data independently of the playlist revision, including revocation', async (t) => {
  const { admin, feed, write, client, user } = await fixture(t);
  const saved = (await admin('/api/slides', 'POST', slide(feed.id))).data;
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Live data',
      items: [{ slideId: saved.id, duration: 30 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  const person = await user('screen-viewer');
  const external = client();
  const device = (
    await external('/api/player/enroll', 'POST', { name: 'Data TV' })
  ).data;
  assert.equal(
    (
      await admin(`/api/devices/${device.id}/approve`, 'POST', {
        code: device.code,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await admin(`/api/devices/${device.id}`, 'PUT', {
        name: 'Data TV',
        playlistId: playlist.id,
        blank: false,
        rotation: 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await admin(`/api/access/device/${device.id}`, 'POST', {
        userId: person.id,
      })
    ).status,
    200,
  );
  const sync = () =>
    external(
      '/api/player/sync',
      'POST',
      {},
      { Authorization: `Bearer ${device.token}` },
    );
  const firstResponse = await sync();
  assert.equal(firstResponse.status, 200);
  const first = firstResponse.data;
  assert.equal(first.manifest.schemaVersion, 4);
  assert.equal(first.dataFeeds[feed.id].status, 'empty');
  assert.equal((await write()).status, 200);
  const next = (await sync()).data;
  assert.equal(next.manifest.revision, first.manifest.revision);
  assert.equal(next.dataFeeds[feed.id].data.completed, 75);
  assert.equal(next.manifest.dataFeeds, undefined);
  assert.equal(
    (await admin(`/api/preview/${playlist.id}`)).data.dataFeeds[feed.id].data
      .completed,
    75,
  );
  await admin(`/api/access/data-feed/${feed.id}`, 'POST', {
    userId: person.id,
    remove: true,
  });
  const revoked = (await sync()).data;
  assert.equal(revoked.dataFeeds[feed.id].status, 'unavailable');
  assert.equal(revoked.dataFeeds[feed.id].data, null);
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    409,
  );
  assert.equal(
    (await admin(`/api/data-feeds/${feed.id}`, 'DELETE')).status,
    409,
  );
});

void test('widget bindings reject wrong types and field changes preserve stored schema', async (t) => {
  const { admin, feed } = await fixture(t);
  const invalid = await admin('/api/slides', 'POST', {
    ...slide(feed.id),
    layers: [widget(feed.id, 'line', 'completed')],
  });
  assert.equal(invalid.status, 400);
  for (const [mode, field] of [
    ['metric', 'completed'],
    ['progress', 'completed'],
    ['line', 'hourly'],
    ['bar', 'departments'],
  ]) {
    assert.equal(
      (
        await admin('/api/slides', 'POST', {
          ...slide(feed.id),
          layers: [widget(feed.id, mode, field)],
        })
      ).status,
      201,
    );
  }
  assert.equal(
    (
      await admin(`/api/data-feeds/${feed.id}`, 'PUT', {
        ...definition,
        fields: [{ key: 'changed', type: 'number' }],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await admin(`/api/data-feeds/${feed.id}`, 'PUT', {
        ...definition,
        name: 'Renamed',
      })
    ).status,
    200,
  );
});

void test('card settings are optional, strict, and bounded without changing classic modes', () => {
  const legacy = widget(randomUUID()).data;
  assert.equal(Object.hasOwn(dataWidgetSchema.parse(legacy), 'card'), false);
  const defaults = dataWidgetSchema.parse({ ...legacy, card: {} }).card;
  assert.deepEqual(defaults, {
    style: 'split',
    header: 'blue',
    badge: 'spark',
    deltaText: '',
    deltaField: '',
    deltaUnit: '%',
    prefix: '',
    subtitle: '',
    footer: '',
    footerRight: '',
    rows: 'table',
    rowDeltaField: '',
    maxRows: 4,
    rowOffset: 0,
    showRowRange: true,
    scaleMax: 100,
    showStats: false,
    valueAlign: 'auto',
    titleScale: 100,
    valueScale: 100,
    detailScale: 100,
    paddingX: 16,
    paddingY: 16,
    thresholdMode: 'off',
    thresholdGoal: 95,
    thresholdWarning: 90,
    thresholdUseTarget: true,
  });
  for (const card of [
    null,
    [],
    { style: 'unknown' },
    { header: 'red' },
    { badge: 'icon' },
    { rows: 'grid' },
    { showStats: 'true' },
    { valueAlign: 'sideways' },
    { unexpected: true },
    { maxRows: 0 },
    { maxRows: 101 },
    { rowOffset: -1 },
    { rowOffset: 100 },
    { rowOffset: 1.5 },
    { rowOffset: '1' },
    { showRowRange: 'false' },
    { maxRows: 1.5 },
    { maxRows: '4' },
    { scaleMax: 0 },
    { scaleMax: -1 },
    { scaleMax: 1e12 + 1 },
    { scaleMax: Infinity },
    { scaleMax: NaN },
    { scaleMax: '100' },
  ]) {
    assert.equal(
      dataWidgetSchema.safeParse({ ...legacy, card }).success,
      false,
    );
  }
  for (const key of [
    'titleScale',
    'valueScale',
    'detailScale',
    'paddingX',
    'paddingY',
  ]) {
    const padding = key.startsWith('padding');
    const min = padding ? 0 : 50;
    const max = padding ? 48 : 200;
    for (const value of [min, max])
      assert.equal(
        dataWidgetSchema.safeParse({ ...legacy, card: { [key]: value } })
          .success,
        true,
      );
    for (const value of [
      min - 1,
      max + 1,
      min + 0.5,
      '100',
      null,
      Infinity,
      NaN,
    ])
      assert.equal(
        dataWidgetSchema.safeParse({ ...legacy, card: { [key]: value } })
          .success,
        false,
        `${key} rejects ${value}`,
      );
  }
  for (const [key, limit] of [
    ['deltaText', 32],
    ['deltaField', 40],
    ['deltaUnit', 12],
    ['prefix', 8],
    ['subtitle', 100],
    ['footer', 80],
    ['footerRight', 40],
    ['rowDeltaField', 40],
  ]) {
    assert.equal(
      dataWidgetSchema.safeParse({
        ...legacy,
        card: { [key]: 'x'.repeat(limit) },
      }).success,
      true,
      `${key} accepts its documented limit`,
    );
    assert.equal(
      dataWidgetSchema.safeParse({
        ...legacy,
        card: { [key]: 'x'.repeat(limit + 1) },
      }).success,
      false,
      `${key} rejects oversized text`,
    );
  }
  for (const card of [
    { style: 'plain', maxRows: 1, scaleMax: 0.01 },
    { style: 'split', maxRows: 100, rowOffset: 99, scaleMax: 1e12 },
  ])
    assert.equal(dataWidgetSchema.safeParse({ ...legacy, card }).success, true);
});

void test('card options persist, update, and publish with schema four and unchanged feed data', async (t) => {
  const { admin, feed, write } = await fixture(t);
  const card = {
    style: 'split',
    header: 'navy',
    badge: 'delta',
    deltaText: '+2.4% YoY',
    deltaField: 'goal',
    deltaUnit: '%',
    prefix: '$',
    subtitle: 'Weekly performance',
    footer: 'Store median',
    footerRight: 'Verified',
    rows: 'table',
    rowDeltaField: 'departments',
    maxRows: 8,
    rowOffset: 0,
    showRowRange: true,
    scaleMax: 250,
    showStats: true,
    valueAlign: 'center',
    titleScale: 125,
    valueScale: 150,
    detailScale: 90,
    paddingX: 24,
    paddingY: 8,
    thresholdMode: 'off',
    thresholdGoal: 95,
    thresholdWarning: 90,
    thresholdUseTarget: true,
  };
  const layers = [
    widget(feed.id),
    ...[
      ['metric', 'completed'],
      ['progress', 'completed'],
      ['line', 'hourly'],
      ['bar', 'departments'],
    ].map(([mode, field]) => {
      const layer = widget(feed.id, mode, field);
      return { ...layer, data: { ...layer.data, card } };
    }),
  ];
  const created = await admin('/api/slides', 'POST', {
    ...slide(feed.id),
    layers,
  });
  assert.equal(created.status, 201);
  assert.equal(Object.hasOwn(created.data.layers[0].data, 'card'), false);
  for (const layer of created.data.layers.slice(1))
    assert.deepEqual(layer.data.card, card);
  const saved = (await admin('/api/library')).data.slides.find(
    (entry) => entry.id === created.data.id,
  );
  assert.deepEqual(saved.layers, created.data.layers);
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Split header cards',
      items: [{ slideId: saved.id, duration: 30 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  const preview = await admin(`/api/preview/${playlist.id}?version=published`);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.schemaVersion, 4);
  assert.deepEqual(preview.data.items[0].slide.layers, saved.layers);
  assert.equal((await write()).status, 200);
  const updatedData = (
    await admin(`/api/preview/${playlist.id}?version=published`)
  ).data;
  assert.equal(updatedData.revision, preview.data.revision);
  assert.deepEqual(updatedData.dataFeeds[feed.id].data, payload);

  const updatedLayers = saved.layers.map((layer, index) =>
    index === 4
      ? {
          ...layer,
          data: {
            ...layer.data,
            card: { ...card, rows: 'bars', header: 'blue', maxRows: 3 },
          },
        }
      : layer,
  );
  const updated = await admin(`/api/slides/${saved.id}`, 'PUT', {
    ...saved,
    layers: updatedLayers,
  });
  assert.equal(updated.status, 200);
  const refreshed = (
    await admin(`/api/preview/${playlist.id}?version=published`)
  ).data;
  assert.deepEqual(refreshed.items[0].slide.layers, updated.data.layers);
  assert.notEqual(refreshed.revision, preview.data.revision);
  assert.deepEqual(refreshed.dataFeeds[feed.id].data, payload);
});

void test('active card bindings use typed fields from the permitted feed and retain inactive settings', async (t) => {
  const { admin, feed, user } = await fixture(t);
  const otherFeed = await admin('/api/data-feeds', 'POST', {
    name: 'Other feed',
    fields: [
      { key: 'externalDelta', type: 'number' },
      { key: 'externalRows', type: 'categories' },
    ],
  });
  assert.equal(otherFeed.status, 201);
  const document = (mode, card) => {
    const layer = widget(
      feed.id,
      mode,
      mode === 'bar' ? 'departments' : mode === 'line' ? 'hourly' : 'completed',
    );
    return {
      ...slide(feed.id),
      layers: [{ ...layer, data: { ...layer.data, card } }],
    };
  };
  for (const [mode, card] of [
    ['progress', { badge: 'delta', deltaField: 'missing' }],
    ['line', { badge: 'delta', deltaField: 'hourly' }],
    ['bar', { badge: 'delta', deltaField: 'departments' }],
    ['metric', { badge: 'spark', deltaField: 'missing' }],
    ['metric', { badge: 'none', deltaField: 'externalDelta' }],
    ['bar', { rowDeltaField: 'missing' }],
    ['bar', { rowDeltaField: 'completed' }],
    ['bar', { rowDeltaField: 'hourly' }],
    ['bar', { rowDeltaField: 'externalRows' }],
  ]) {
    const rejected = await admin('/api/slides', 'POST', document(mode, card));
    assert.equal(rejected.status, 400, JSON.stringify({ mode, card }));
    assert.match(rejected.data.error, /must reference .* in the selected feed/);
  }
  for (const [mode, card] of [
    ['metric', { deltaField: 'goal' }],
    ['progress', { badge: 'spark', deltaField: 'missing' }],
    ['line', { badge: 'none', deltaField: 'missing' }],
    ['metric', { rowDeltaField: 'missing' }],
    ['bar', { rows: 'bars', rowDeltaField: 'missing' }],
    ['bar', { rows: 'table', rowDeltaField: 'departments' }],
    [
      'bar',
      {
        style: 'plain',
        badge: 'delta',
        deltaField: 'missing',
        rowDeltaField: 'missing',
      },
    ],
  ]) {
    const accepted = await admin('/api/slides', 'POST', document(mode, card));
    assert.equal(accepted.status, 201, JSON.stringify({ mode, card }));
  }

  const valid = document('bar', {
    badge: 'delta',
    deltaField: 'goal',
    rowDeltaField: 'departments',
  });
  const saved = (await admin('/api/slides', 'POST', valid)).data;
  const invalidEdit = document('bar', { rowDeltaField: 'goal' });
  assert.equal(
    (await admin(`/api/slides/${saved.id}`, 'PUT', invalidEdit)).status,
    400,
  );
  assert.deepEqual(
    (await admin('/api/library')).data.slides.find(
      (entry) => entry.id === saved.id,
    ).layers,
    saved.layers,
  );
  const outsider = await user('card-outsider');
  const denied = await outsider.call('/api/slides', 'POST', valid);
  assert.equal(denied.status, 403);
  assert.match(
    denied.data.error,
    /Viewing access to the data feed is required/,
  );
  assert.equal(
    (
      await admin(
        '/api/slides',
        'POST',
        document('metric', { style: 'unknown' }),
      )
    ).status,
    400,
  );
});

void test('bounded token and rate limits report retry information', async (t) => {
  const { write, admin, feed } = await fixture(t);
  for (let i = 1; i < 20; i++)
    assert.equal(
      (
        await admin(`/api/data-feeds/${feed.id}/tokens`, 'POST', {
          name: `Token ${i}`,
        })
      ).status,
      201,
    );
  assert.equal(
    (
      await admin(`/api/data-feeds/${feed.id}/tokens`, 'POST', {
        name: 'Excess',
      })
    ).data.code,
    'TOKEN_LIMIT',
  );
  for (let i = 0; i < 60; i++) assert.equal((await write()).status, 200);
  const rejected = await write();
  assert.equal(rejected.status, 429);
  assert.equal(rejected.data.code, 'RATE_LIMITED');
  assert.ok(Number(rejected.headers.get('retry-after')) > 0);
});

void test('public handoff contract and guide match the external endpoint and example', async (t) => {
  const { client, admin, feed, write } = await fixture(t);
  const contract = (await client()('/api/data-feeds/openapi.json')).data;
  assert.equal(contract.openapi, '3.1.0');
  assert.deepEqual(
    contract.paths['/api/data-feeds/{feedId}/data'].put.security,
    [{ FeedWriteToken: [] }],
  );
  const example =
    contract.paths['/api/data-feeds/{feedId}/data'].put.requestBody.content[
      'application/json'
    ].example;
  assert.equal((await write(example)).status, 200);
  assert.equal(
    (await admin(`/api/data-feeds/${feed.id}/data`)).data.data.completed,
    example.completed,
  );
  const guide = await client()('/api/data-feeds/guide');
  assert.equal(guide.status, 200);
  assert.equal(
    guide.data,
    readFileSync(new URL('../docs/data-feeds-api.md', import.meta.url), 'utf8'),
  );
});

void test('feed and publication limits preserve valid snapshots and existing content', async (t) => {
  const { admin, db, feed } = await fixture(t);
  // Seed only an isolated database to exercise total capacity without hundreds of HTTP calls.
  const insert = db.prepare('INSERT INTO records VALUES (?,?,?)');
  for (let i = 0; i < 199; i++) {
    const id = randomUUID();
    insert.run(
      'data-feed',
      id,
      JSON.stringify({ ...definition, id, name: `Capacity ${i}`, data: null }),
    );
  }
  const excess = await admin('/api/data-feeds', 'POST', definition);
  assert.equal(excess.status, 409);
  assert.equal(excess.data.code, 'FEED_LIMIT');
  const ids = db
    .prepare("SELECT id FROM records WHERE kind='data-feed' LIMIT 21")
    .all()
    .map((row) => row.id);
  const layers = ids.map((id) => widget(id));
  const saved = (
    await admin('/api/slides', 'POST', { ...slide(feed.id), layers })
  ).data;
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Bounded sync',
      items: [{ slideId: saved.id, duration: 30 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    400,
  );
  assert.equal((await admin(`/api/preview/${playlist.id}`)).status, 400);
  const schema = JSON.parse(
    db
      .prepare("SELECT body FROM records WHERE kind='slide' AND id=?")
      .get(saved.id).body,
  );
  assert.equal(schema.layers.length, 21); // Refusal does not destroy the saved draft.
});

async function applicationFixture(t, options = {}) {
  const fixtureData = await fixture(t);
  const application = (
    await fixtureData.admin('/api/data-feeds/applications', 'POST', {
      name: 'Metrics app',
      ...options,
    })
  ).data;
  assert.ok(application.id);
  const issued = await fixtureData.admin(
    `/api/data-feeds/applications/${application.id}/tokens`,
    'POST',
    { name: 'Production' },
  );
  assert.equal(issued.status, 201);
  const applicationKey = issued.data;
  const external = fixtureData.client();
  const ingest = (
    body,
    source = 'production',
    secret = applicationKey.token,
    headers = {},
    raw = false,
  ) =>
    external(
      `/api/data-feeds/ingest/${source}`,
      'POST',
      body,
      { Authorization: `Bearer ${secret}`, ...headers },
      raw,
    );
  return { ...fixtureData, application, applicationKey, ingest, external };
}

async function resetFixture(t) {
  const f = await applicationFixture(t);
  const site = (
    await f.admin('/api/sites', 'POST', {
      siteNumber: '2882',
      name: 'Reset test store',
    })
  ).data;
  assert.equal(
    (
      await f.admin(
        `/api/data-feeds/applications/${f.application.id}/assign-site`,
        'POST',
        { siteId: site.id },
      )
    ).status,
    200,
  );
  const feedId = (await f.ingest({ completed: 75, goal: 100 })).data.feedId;
  const directKey = (
    await f.admin(`/api/data-feeds/${feedId}/tokens`, 'POST', {
      name: 'Direct feed key',
    })
  ).data;
  const layer = widget(feedId);
  Object.assign(layer, {
    x: 12,
    y: 18,
    width: 42,
    height: 61,
    color: '#123456',
    fontSize: 48,
  });
  layer.data = {
    ...layer.data,
    title: 'Keep this metric',
    targetField: 'goal',
    unit: '%',
    siteBinding: { applicationId: f.application.id, sourceKey: 'production' },
    card: {
      style: 'split',
      badge: 'delta',
      deltaField: 'goal',
      footer: 'Keep this footer',
      paddingX: 24,
      titleScale: 120,
      thresholdMode: 'higher',
    },
  };
  const saved = await f.admin('/api/slides', 'POST', {
    ...slide(feedId),
    layers: [
      layer,
      {
        id: randomUUID(),
        type: 'text',
        x: 1,
        y: 1,
        width: 20,
        height: 10,
        text: 'Leave this text alone',
      },
    ],
  });
  assert.equal(saved.status, 201);
  const playlist = (
    await f.admin('/api/playlists', 'POST', {
      name: 'Reset master',
      items: [{ slideId: saved.data.id, duration: 30 }],
    })
  ).data;
  assert.equal(
    (await f.admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  const fork = (
    await f.admin(`/api/playlists/${playlist.id}/fork`, 'POST', {
      name: 'Reset fork',
    })
  ).data;
  assert.equal(
    (await f.admin(`/api/playlists/${fork.id}/publish`, 'POST')).status,
    200,
  );
  const player = f.client();
  const credentials = (
    await player('/api/player/enroll', 'POST', {
      name: 'Reset screen',
      siteNumber: '2882',
    })
  ).data;
  assert.equal(
    (
      await f.admin(`/api/devices/${credentials.id}/approve`, 'POST', {
        code: credentials.code,
        siteId: site.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.admin(`/api/devices/${credentials.id}`, 'PUT', {
        name: 'Reset screen',
        playlistId: playlist.id,
        rotation: 0,
        blank: false,
      })
    ).status,
    200,
  );
  const adminId = (await f.admin('/api/auth')).data.user.id;
  assert.equal(
    (
      await f.admin(`/api/access/device/${credentials.id}`, 'POST', {
        userId: adminId,
      })
    ).status,
    200,
  );
  const sync = () =>
    player(
      '/api/player/sync',
      'POST',
      { version: '0.15.5' },
      { Authorization: `Bearer ${credentials.token}` },
    );
  assert.equal((await sync()).data.dataFeeds[feedId].data.completed, 75);
  return {
    ...f,
    site,
    feedId,
    directKey,
    saved: saved.data,
    playlist,
    fork,
    credentials,
    sync,
  };
}

function disconnectedLayers(saved) {
  return saved.layers.map((layer) => {
    if (layer.type !== 'data') return layer;
    const { siteBinding: _binding, ...settings } = layer.data;
    return { ...layer, data: { ...settings, feedId: null } };
  });
}

void test('explicit feed deletion disconnects draft and published widgets, clears player data and allows reconnection', async (t) => {
  const f = await resetFixture(t);
  const before = (await f.sync()).data.manifest.revision;
  assert.equal(
    (await f.admin(`/api/data-feeds/${f.feedId}`, 'DELETE')).status,
    409,
  );
  const removed = await f.admin(
    `/api/data-feeds/${f.feedId}?disconnectWidgets=true`,
    'DELETE',
  );
  assert.equal(removed.status, 200);
  assert.equal(removed.data.widgets, 1);
  assert.equal(removed.data.publishedPlaylists, 2);
  const library = (await f.admin('/api/library')).data;
  const saved = library.slides.find((s) => s.id === f.saved.id);
  assert.deepEqual(saved.layers, disconnectedLayers(f.saved));
  for (const playlist of [f.playlist, f.fork]) {
    const preview = (
      await f.admin(
        `/api/preview/${playlist.id}?version=published&siteId=${f.site.id}`,
      )
    ).data;
    assert.deepEqual(
      preview.items[0].slide.layers,
      disconnectedLayers(f.saved),
    );
    assert.deepEqual(preview.dataFeeds, {});
  }
  const cleared = (await f.sync()).data;
  assert.notEqual(cleared.manifest.revision, before);
  assert.deepEqual(cleared.dataFeeds, {});
  assert.equal(cleared.manifest.items[0].slide.layers[0].data.feedId, null);
  assert.equal(
    (await f.write(payload, {}, false, f.feedId, f.directKey.token)).status,
    401,
  );
  assert.ok(
    library.dataFeeds.some((feed) => feed.id === f.feed.id),
    'Unrelated manual feed remains',
  );
  const invalidRelative = structuredClone(saved);
  invalidRelative.layers[0].data.siteBinding =
    f.saved.layers[0].data.siteBinding;
  assert.equal(
    (await f.admin(`/api/slides/${saved.id}`, 'PUT', invalidRelative)).status,
    400,
    'A missing example feed must not retain a relative binding',
  );
  assert.equal(
    (await f.admin(`/api/slides/${saved.id}`, 'PUT', saved)).status,
    200,
    'Disconnected widgets remain editable/saveable',
  );
  assert.equal(
    (await f.admin(`/api/playlists/${f.playlist.id}/publish`, 'POST')).status,
    200,
  );
  const recreated = await f.ingest({ completed: 88, goal: 100 });
  assert.equal(
    recreated.status,
    201,
    'Application keys survive individual feed deletion',
  );
  assert.notEqual(recreated.data.feedId, f.feedId);
  assert.equal(
    (await f.sync()).data.manifest.items[0].slide.layers[0].data.feedId,
    null,
    'New pushes do not silently reconnect a different feed ID',
  );
  const rewired = {
    ...saved,
    layers: f.saved.layers.map((layer) =>
      layer.type === 'data'
        ? { ...layer, data: { ...layer.data, feedId: recreated.data.feedId } }
        : layer,
    ),
  };
  assert.equal(
    (await f.admin(`/api/slides/${saved.id}`, 'PUT', rewired)).status,
    200,
  );
  assert.equal(
    (await f.admin(`/api/playlists/${f.playlist.id}/publish`, 'POST')).status,
    200,
  );
  assert.equal(
    (await f.sync()).data.dataFeeds[recreated.data.feedId].data.completed,
    88,
  );
});

void test('explicit application deletion removes used feeds and every associated key while preserving layouts and other connections', async (t) => {
  const f = await resetFixture(t);
  await f.ingest({ hours: 42 }, 'hours');
  const ordinary = await f.user('reset-ordinary');
  const url = `/api/data-feeds/applications/${f.application.id}`;
  assert.equal(
    (await ordinary.call(`${url}?disconnectWidgets=true`, 'DELETE')).status,
    403,
  );
  assert.equal(
    (await f.admin(url, 'DELETE')).status,
    409,
    'Legacy API behavior is preserved',
  );
  const removed = await f.admin(`${url}?disconnectWidgets=true`, 'DELETE');
  assert.equal(removed.status, 200);
  assert.equal(removed.data.feeds, 2);
  assert.equal(removed.data.keys, 2);
  assert.equal((await f.ingest({ completed: 99 })).status, 401);
  assert.equal(
    (await f.write(payload, {}, false, f.feedId, f.directKey.token)).status,
    401,
  );
  assert.equal(
    f.db
      .prepare(
        'SELECT COUNT(*) AS n FROM data_feed_application_sources WHERE applicationId=?',
      )
      .get(f.application.id).n,
    0,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) AS n FROM resource_access WHERE kind='data-feed' AND id=?",
      )
      .get(f.feedId).n,
    0,
  );
  const library = (await f.admin('/api/library')).data;
  assert.deepEqual(
    library.slides.find((s) => s.id === f.saved.id).layers,
    disconnectedLayers(f.saved),
  );
  assert.ok(
    library.devices.some(
      (d) => d.id === f.credentials.id && d.playlistId === f.playlist.id,
    ),
  );
  assert.ok(library.sites.some((s) => s.id === f.site.id));
  assert.ok(library.dataFeeds.some((feed) => feed.id === f.feed.id));
  assert.equal(
    (await f.write()).status,
    200,
    'Unrelated integration key still works',
  );
  assert.deepEqual((await f.sync()).data.dataFeeds, {});
});

void test('full data-connection reset reviews its scope, refuses stale requests and rolls back all disconnections on failure', async (t) => {
  const f = await resetFixture(t);
  const ordinary = await f.user('reset-denied');
  assert.equal(
    (await ordinary.call('/api/data-feeds/reset/preview', 'POST')).status,
    403,
  );
  assert.equal(
    (
      await ordinary.call('/api/data-feeds/reset', 'POST', {
        confirmation: 'RESET',
        revision: 'a'.repeat(64),
      })
    ).status,
    403,
  );
  const review = (await f.admin('/api/data-feeds/reset/preview', 'POST')).data;
  assert.deepEqual(review.counts, {
    applications: 1,
    feeds: 2,
    keys: 3,
    widgets: 1,
    slides: 1,
    publishedPlaylists: 2,
  });
  assert.equal(
    (
      await f.admin('/api/data-feeds/reset', 'POST', {
        confirmation: 'DELETE',
        revision: review.revision,
      })
    ).status,
    400,
  );
  await f.admin('/api/data-feeds/applications', 'POST', {
    name: 'Created after review',
  });
  assert.equal(
    (
      await f.admin('/api/data-feeds/reset', 'POST', {
        confirmation: 'RESET',
        revision: review.revision,
      })
    ).status,
    409,
  );
  const latest = (await f.admin('/api/data-feeds/reset/preview', 'POST')).data;
  const snapshot = () =>
    JSON.stringify(
      [
        'records',
        'resource_access',
        'resource_grants',
        'resource_management',
        'resource_permissions',
        'data_feed_tokens',
        'data_feed_application_tokens',
        'data_feed_application_sources',
        'data_feed_applications',
        'site_audit',
      ].map((table) =>
        f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ),
    );
  const before = snapshot();
  f.db.exec(
    "CREATE TRIGGER reject_reset BEFORE DELETE ON data_feed_applications BEGIN SELECT RAISE(ABORT, 'fixture rejects reset'); END;",
  );
  assert.equal(
    (
      await f.admin('/api/data-feeds/reset', 'POST', {
        confirmation: 'RESET',
        revision: latest.revision,
      })
    ).status,
    500,
  );
  assert.equal(
    snapshot(),
    before,
    'Widgets, publications, keys, feeds, grants and audit all roll back',
  );
  f.db.exec('DROP TRIGGER reject_reset');
  assert.equal(
    (
      await f.admin('/api/data-feeds/reset', 'POST', {
        confirmation: 'RESET',
        revision: latest.revision,
      })
    ).status,
    200,
  );
  const library = (await f.admin('/api/library')).data;
  assert.deepEqual(library.dataFeeds, []);
  assert.deepEqual((await f.admin('/api/data-feeds/applications')).data, []);
  assert.deepEqual(
    library.slides.find((s) => s.id === f.saved.id).layers,
    disconnectedLayers(f.saved),
  );
  assert.equal(library.playlists.length, 2);
  assert.ok(library.sites.some((site) => site.id === f.site.id));
  assert.ok(library.devices.some((screen) => screen.id === f.credentials.id));
  assert.equal((await f.ingest({ completed: 99 })).status, 401);
  assert.equal((await f.write()).status, 401);
  assert.deepEqual((await f.sync()).data.dataFeeds, {});
  assert.equal(
    (await f.admin(`/api/playlists/${f.playlist.id}/publish`, 'POST')).status,
    200,
    'Disconnected master and fork stay publishable',
  );
});

void test('both key types support non-expiring issuance, in-place expiry changes and irreversible revocation', async (t) => {
  const {
    admin,
    feed,
    token,
    write,
    application,
    applicationKey,
    ingest,
    client,
    db,
  } = await applicationFixture(t);
  for (const [base, key, table, send] of [
    [
      `/api/data-feeds/${feed.id}/tokens`,
      token,
      'data_feed_tokens',
      (secret) => write(payload, {}, false, feed.id, secret),
    ],
    [
      `/api/data-feeds/applications/${application.id}/tokens`,
      applicationKey,
      'data_feed_application_tokens',
      (secret) => ingest({ value: 42 }, 'expiry-check', secret),
    ],
  ]) {
    const digestBefore = db
      .prepare(`SELECT digest FROM ${table} WHERE id=?`)
      .get(key.id).digest;
    assert.equal(
      (await client()(`${base}/${key.id}`, 'PATCH', { expiresInDays: null }))
        .status,
      401,
    );
    const changed = await admin(`${base}/${key.id}`, 'PATCH', {
      expiresInDays: null,
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.expiresAt, null);
    assert.equal('token' in changed.data, false);
    assert.equal(
      db.prepare(`SELECT digest FROM ${table} WHERE id=?`).get(key.id).digest,
      digestBefore,
    );
    assert.ok([200, 201].includes((await send(key.token)).status));
    const forever = await admin(base, 'POST', {
      name: 'Permanent sender',
      expiresInDays: null,
    });
    assert.equal(forever.status, 201);
    assert.equal(forever.data.expiresAt, null);
    assert.ok([200, 201].includes((await send(forever.data.token)).status));
    const creator = db
      .prepare(`SELECT creatorId FROM ${table} WHERE id=?`)
      .get(forever.data.id).creatorId;
    db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(creator);
    assert.equal((await send(forever.data.token)).status, 401);
    db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(creator);
    const renewed = await admin(`${base}/${key.id}`, 'PATCH', {
      expiresInDays: 7,
    });
    assert.ok(Date.parse(renewed.data.expiresAt) > Date.now() + 6 * 86400000);
    for (const days of [0, 366, 'never', false])
      assert.equal(
        (await admin(`${base}/${key.id}`, 'PATCH', { expiresInDays: days }))
          .status,
        400,
      );
    await admin(`${base}/${key.id}`, 'DELETE');
    assert.equal(
      (await admin(`${base}/${key.id}`, 'PATCH', { expiresInDays: null }))
        .status,
      409,
    );
    assert.equal((await send(key.token)).status, 401);
  }
});

void test('non-expiring keys count toward active-key caps and cannot be renewed around the cap', async (t) => {
  const { admin, feed, token, application, applicationKey, db } =
    await applicationFixture(t);
  for (const [base, key, table] of [
    [`/api/data-feeds/${feed.id}/tokens`, token, 'data_feed_tokens'],
    [
      `/api/data-feeds/applications/${application.id}/tokens`,
      applicationKey,
      'data_feed_application_tokens',
    ],
  ]) {
    assert.equal(
      (await admin(`${base}/${key.id}`, 'PATCH', { expiresInDays: null }))
        .status,
      200,
    );
    for (let i = 0; i < 19; i++)
      assert.equal(
        (
          await admin(base, 'POST', {
            name: `Long-lived sender ${i}`,
            expiresInDays: null,
          })
        ).status,
        201,
      );
    assert.equal(
      (await admin(base, 'POST', { name: 'Overflow', expiresInDays: null }))
        .status,
      409,
    );
    assert.equal(
      (await admin(`${base}/${key.id}`, 'PATCH', { expiresInDays: 90 })).status,
      200,
    );
    db.prepare(
      `UPDATE ${table} SET expiresAt='2000-01-01T00:00:00Z' WHERE id=?`,
    ).run(key.id);
    assert.equal(
      (await admin(base, 'POST', { name: 'Replacement', expiresInDays: null }))
        .status,
      201,
    );
    assert.equal(
      (await admin(`${base}/${key.id}`, 'PATCH', { expiresInDays: null }))
        .status,
      404,
    );
  }
});

void test('expiry migration preserves original key digests, indexes and usable credentials', async (t) => {
  const { db, feed, token, write, applicationKey, ingest } =
    await applicationFixture(t);
  for (const [table, key] of [
    ['data_feed_tokens', token],
    ['data_feed_application_tokens', applicationKey],
  ]) {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key.id);
    const schema = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
      .get(table).sql;
    const indexes = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
      )
      .all(table);
    db.exec(
      schema
        .replace(table, `${table}_old`)
        .replace(/expiresAt TEXT/i, 'expiresAt TEXT NOT NULL'),
    );
    db.exec(
      `INSERT INTO ${table}_old SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_old RENAME TO ${table};`,
    );
    for (const index of indexes) db.exec(index.sql);
    assert.equal(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .find((column) => column.name === 'expiresAt').notnull,
      1,
    );
    migrateKeyExpiry(db, table);
    migrateKeyExpiry(db, table);
    assert.deepEqual(
      db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key.id),
      row,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
        )
        .get(table).n,
      indexes.length,
    );
  }
  assert.equal(
    (await write(payload, {}, false, feed.id, token.token)).status,
    200,
  );
  assert.equal((await ingest({ value: 42 })).status, 201);
});

void test('SMCC table pushes infer categories in a separate stable source and retain omitted tables atomically', async (t) => {
  const { admin, ingest } = await applicationFixture(t, { name: 'SMCC' });
  const metrics = await ingest({ freight: 42 });
  const rows = Array.from({ length: 100 }, (_, index) => ({
    label: `Store metric ${String(index + 1).padStart(2, '0')}`,
    value: index - 10.5,
  }));
  const tables = await ingest(
    { freight: rows, training: [{ label: 'Completion', value: 97.2 }] },
    'production-tables',
  );
  assert.equal(tables.status, 201);
  assert.notEqual(tables.data.feedId, metrics.data.feedId);
  assert.deepEqual(tables.data.fields, [
    { key: 'freight', type: 'categories' },
    { key: 'training', type: 'categories' },
  ]);
  assert.deepEqual(
    (await admin(`/api/data-feeds/${tables.data.feedId}/data`)).data.data
      .freight,
    rows,
  );
  assert.deepEqual(
    (await admin(`/api/data-feeds/${metrics.data.feedId}/data`)).data.data,
    { freight: 42 },
  );

  const layer = widget(tables.data.feedId, 'bar', 'freight');
  layer.data.card = {
    style: 'split',
    rows: 'table',
    maxRows: 100,
    rowOffset: 0,
    showRowRange: true,
  };
  const saved = await admin('/api/slides', 'POST', {
    ...slide(tables.data.feedId),
    layers: [layer],
  });
  assert.equal(saved.status, 201);
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'SMCC tables',
      items: [{ slideId: saved.data.id, duration: 60 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  const preview = (await admin(`/api/preview/${playlist.id}`)).data;
  assert.equal(preview.schemaVersion, 4);
  assert.deepEqual(preview.dataFeeds[tables.data.feedId].data.freight, rows);

  const before = (await admin(`/api/data-feeds/${tables.data.feedId}/data`))
    .data;
  for (const bad of [
    [...rows, { label: 'Overflow', value: 1 }],
    [
      { label: 'Duplicate', value: 1 },
      { label: 'Duplicate', value: 2 },
    ],
    [{ label: 'x'.repeat(61), value: 1 }],
    [{ label: 'Too large', value: 1e12 + 1 }],
    [{ label: 'Text cell', value: 'unavailable' }],
  ]) {
    assert.equal(
      (await ingest({ freight: bad }, 'production-tables')).status,
      400,
    );
    assert.deepEqual(
      (await admin(`/api/data-feeds/${tables.data.feedId}/data`)).data,
      before,
    );
  }
  const changed = await ingest(
    { training: [{ label: 'Completion', value: 98 }] },
    'production-tables',
  );
  assert.equal(changed.status, 200);
  assert.equal(changed.data.feedId, tables.data.feedId);
  assert.deepEqual(
    (await admin(`/api/data-feeds/${tables.data.feedId}/data`)).data.data
      .freight,
    rows,
  );
  assert.equal(
    (await ingest({ freight: [] }, 'production-tables')).status,
    200,
  );
  assert.deepEqual(
    (await admin(`/api/data-feeds/${tables.data.feedId}/data`)).data.data
      .freight,
    [],
  );
  assert.equal((await ingest({ empty: [] }, 'new-tables')).status, 400);
});

void test('application ingestion creates stable scoped feeds, infers fields, merges updates, and survives server reopen', async (t) => {
  const { admin, application, applicationKey, ingest, db } =
    await applicationFixture(t);
  const first = await ingest({ completed: 42, goal: 100, constructor: 3 });
  assert.equal(first.status, 201);
  assert.equal(first.data.created, true);
  assert.equal(first.data.applicationId, application.id);
  assert.deepEqual(first.data.fields, [
    { key: 'completed', type: 'number' },
    { key: 'goal', type: 'number' },
    { key: 'constructor', type: 'number' },
  ]);
  assert.equal(first.data.data, undefined);
  const feed = (await admin('/api/library')).data.dataFeeds.find(
    (item) => item.id === first.data.feedId,
  );
  assert.equal(feed.applicationId, application.id);
  assert.equal(feed.sourceKey, 'production');
  assert.equal(feed.name, 'Metrics app · production');
  const last = await ingest({
    completed: 43,
    missing: null,
    hourly: [{ time: '2026-10-07T12:00:00Z', value: 43 }],
    regions: [{ label: 'North', value: 10 }],
  });
  assert.equal(last.status, 200);
  assert.equal(last.data.feedId, first.data.feedId);
  assert.equal(last.data.created, false);
  const cleared = await ingest({ hourly: [], regions: [], completed: null });
  assert.equal(cleared.status, 200);
  const snapshot = (await admin(`/api/data-feeds/${feed.id}/data`)).data;
  assert.deepEqual(snapshot.data, {
    completed: null,
    goal: 100,
    constructor: 3,
    missing: null,
    hourly: [],
    regions: [],
  });
  const metadata = (await admin('/api/data-feeds/applications')).data.find(
    (item) => item.id === application.id,
  );
  assert.equal(metadata.feedCount, 1);
  assert.equal(
    (await admin(`/api/data-feeds/applications/${application.id}`, 'DELETE'))
      .status,
    409,
  );
  assert.ok(
    db
      .prepare('SELECT lastUsedAt FROM data_feed_application_tokens WHERE id=?')
      .get(applicationKey.id).lastUsedAt,
  );
  assert.notEqual(
    db
      .prepare('SELECT digest FROM data_feed_application_tokens WHERE id=?')
      .get(applicationKey.id).digest,
    applicationKey.token,
  );
  assert.ok(
    !JSON.stringify(
      (await admin(`/api/data-feeds/applications/${application.id}/tokens`))
        .data,
    ).includes(applicationKey.token),
  );
  const concurrency = await Promise.all(
    Array.from({ length: 3 }, (_, index) =>
      ingest({ goal: 110 + index }, 'parallel'),
    ),
  );
  assert.ok(concurrency.every((item) => [200, 201].includes(item.status)));
  const contract = (await admin('/api/data-feeds/openapi.json')).data;
  assert.deepEqual(
    contract.paths['/api/data-feeds/ingest/{sourceKey}'].post.security,
    [{ ApplicationWriteToken: [] }],
  );
  const contractExample =
    contract.paths['/api/data-feeds/ingest/{sourceKey}'].post.requestBody
      .content['application/json'].example;
  assert.equal((await ingest(contractExample, 'contract-example')).status, 201);
  assert.equal(new Set(concurrency.map((item) => item.data.feedId)).size, 1);
  assert.equal(concurrency.filter((item) => item.status === 201).length, 1);
  const persisted = JSON.parse(
    db
      .prepare("SELECT body FROM records WHERE kind='data-feed' AND id=?")
      .get(feed.id).body,
  );
  assert.deepEqual(persisted.data, snapshot.data);
  // Re-mounting the app against the same disk database preserves application/key/source identity.
  const databasePath = db
    .prepare('PRAGMA database_list')
    .all()
    .find((item) => item.name === 'main').file;
  const reopened = createApp({ dataDir: path.dirname(databasePath) });
  t.after(() => {
    reopened.close();
    reopened.db.close();
  });
  assert.equal(
    reopened.db
      .prepare(
        'SELECT feedId FROM data_feed_application_sources WHERE applicationId=? AND sourceKey=?',
      )
      .get(application.id, 'production').feedId,
    feed.id,
  );
  assert.equal(
    reopened.db
      .prepare(
        'SELECT COUNT(*) AS n FROM data_feed_application_tokens WHERE id=?',
      )
      .get(applicationKey.id).n,
    1,
  );
});

void test('application keys cannot read or manage feeds, cross namespaces, or replace feed-specific keys', async (t) => {
  const {
    admin,
    application,
    applicationKey,
    ingest,
    external,
    feed,
    token,
    client,
    user,
  } = await applicationFixture(t);
  const own = await ingest({ completed: 1 });
  const secondApp = (
    await admin('/api/data-feeds/applications', 'POST', { name: 'Other app' })
  ).data;
  const secondKey = (
    await admin(`/api/data-feeds/applications/${secondApp.id}/tokens`, 'POST', {
      name: 'Other key',
    })
  ).data;
  const other = await ingest({ completed: 2 }, 'production', secondKey.token);
  assert.equal(other.status, 201);
  assert.notEqual(own.data.feedId, other.data.feedId);
  assert.equal(
    (await admin(`/api/data-feeds/${own.data.feedId}/data`)).data.data
      .completed,
    1,
  );
  assert.equal(
    (await ingest({ completed: 3 }, 'production', token.token)).status,
    401,
  );
  assert.equal(
    (
      await external(`/api/data-feeds/${feed.id}/data`, 'PUT', payload, {
        Authorization: `Bearer ${applicationKey.token}`,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await external(
        `/api/data-feeds/${own.data.feedId}/data`,
        'GET',
        undefined,
        { Authorization: `Bearer ${applicationKey.token}` },
      )
    ).status,
    401,
  );
  for (const [route, method, body] of [
    ['/api/library', 'GET'],
    ['/api/data-feeds', 'GET'],
    ['/api/data-feeds/applications', 'GET'],
    ['/api/data-feeds/applications', 'POST', { name: 'Injected' }],
    [`/api/data-feeds/applications/${application.id}/tokens`, 'GET'],
    [
      `/api/data-feeds/applications/${application.id}/tokens`,
      'POST',
      { name: 'Injected' },
    ],
    [
      `/api/data-feeds/applications/${application.id}/tokens/${applicationKey.id}`,
      'DELETE',
    ],
  ])
    assert.equal(
      (
        await external(route, method, body, {
          Authorization: `Bearer ${applicationKey.token}`,
        })
      ).status,
      401,
    );
  const person = await user('application-reader');
  assert.equal((await person.call('/api/data-feeds/applications')).status, 403);
  assert.equal(
    (
      await person.call('/api/data-feeds/applications', 'POST', {
        name: 'Injected',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await client()('/api/data-feeds/ingest/production', 'POST', {
        completed: 1,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await admin(
        `/api/data-feeds/applications/${application.id}/tokens/${secondKey.id}`,
        'DELETE',
      )
    ).status,
    404,
  );
  assert.equal(
    (await ingest({ completed: 4 }, 'production', secondKey.token)).status,
    200,
  );
});

void test('automatic fields validate atomically with immutable types and bounded ingestion bodies', async (t) => {
  const { admin, ingest, application, db } = await applicationFixture(t);
  await admin('/api/settings/data-feeds', 'PUT', { maxFieldsPerFeed: 20 });
  const first = await ingest({ completed: 42 });
  const before = (await admin(`/api/data-feeds/${first.data.feedId}/data`))
    .data;
  for (const body of [
    {},
    [],
    null,
    { completed: '43' },
    { completed: 1e13 },
    { completed: 43, bad: 'text' },
    { completed: 43, 'invalid-key': 2 },
    { ambiguous: [] },
    {
      events: [
        { time: '2026-10-07T12:00:00Z', value: 2 },
        { time: '2026-10-07T11:00:00Z', value: 1 },
      ],
    },
    {
      categories: [
        { label: 'One', value: 1 },
        { label: 'One', value: 2 },
      ],
    },
  ]) {
    const result = await ingest(body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(result.data.code, 'INVALID_PAYLOAD');
  }
  assert.equal(
    (
      await ingest(
        '{"completed":43,"__proto__":2}',
        'production',
        undefined,
        {},
        true,
      )
    ).status,
    400,
  );
  assert.equal(
    (await ingest('{bad json', 'production', undefined, {}, true)).status,
    400,
  );
  assert.equal(
    (
      await ingest(
        JSON.stringify({ completed: 43 }) + ' '.repeat(32768),
        'production',
        undefined,
        {},
        true,
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await ingest({ completed: 43 }, 'production', undefined, {
        'Content-Type': 'text/plain',
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await ingest({ completed: 43 }, 'production', undefined, {
        Origin: 'https://wrong.example',
      })
    ).status,
    403,
  );
  assert.equal((await ingest({ completed: 43 }, 'bad.name')).status, 400);
  assert.deepEqual(
    (await admin(`/api/data-feeds/${first.data.feedId}/data`)).data,
    before,
  );
  assert.equal(
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM data_feed_application_sources WHERE applicationId=?',
      )
      .get(application.id).n,
    1,
  );
  const twenty = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`value${index}`, index]),
  );
  const full = await ingest(twenty, 'full');
  assert.equal(full.status, 201);
  assert.equal((await ingest({ extra: 1 }, 'full')).status, 409);
  assert.equal((await ingest({ ...twenty, extra: 1 }, 'another')).status, 400);
  assert.equal(
    (await admin(`/api/data-feeds/${full.data.feedId}`)).data.fields.length,
    20,
  );
});

void test('application keys expire and revoke immediately; disabled, demoted and deleted key creators cannot ingest', async (t) => {
  const { admin, application, applicationKey, ingest, user, db } =
    await applicationFixture(t);
  const saved = await ingest({ completed: 42 });
  await admin(
    `/api/data-feeds/applications/${application.id}/tokens/${applicationKey.id}`,
    'DELETE',
  );
  assert.equal((await ingest({ completed: 43 })).status, 401);
  assert.equal(
    (await admin(`/api/data-feeds/${saved.data.feedId}/data`)).data.data
      .completed,
    42,
  );
  const person = await user('application-admin');
  await admin(`/api/users/${person.id}`, 'PATCH', { role: 'admin' });
  const named = (
    await person.call(
      `/api/data-feeds/applications/${application.id}/tokens`,
      'POST',
      { name: 'Named admin key' },
    )
  ).data;
  assert.equal(
    (await ingest({ completed: 43 }, 'production', named.token)).status,
    200,
  );
  await admin(`/api/users/${person.id}`, 'PATCH', { disabled: true });
  assert.equal(
    (await ingest({ completed: 44 }, 'production', named.token)).status,
    401,
  );
  await admin(`/api/users/${person.id}`, 'PATCH', {
    disabled: false,
    role: 'user',
  });
  assert.equal(
    (await ingest({ completed: 44 }, 'production', named.token)).status,
    401,
  );
  await admin(`/api/users/${person.id}`, 'PATCH', { role: 'admin' });
  assert.equal(
    (await ingest({ completed: 44 }, 'production', named.token)).status,
    200,
  );
  assert.equal((await admin(`/api/users/${person.id}`, 'DELETE')).status, 200);
  assert.ok(
    db
      .prepare('SELECT revokedAt FROM data_feed_application_tokens WHERE id=?')
      .get(named.id).revokedAt,
  );
  assert.equal(
    (await ingest({ completed: 45 }, 'production', named.token)).status,
    401,
  );
  const expired = (
    await admin(
      `/api/data-feeds/applications/${application.id}/tokens`,
      'POST',
      { name: 'Expired' },
    )
  ).data;
  db.prepare(
    'UPDATE data_feed_application_tokens SET expiresAt=? WHERE id=?',
  ).run('2000-01-01T00:00:00Z', expired.id);
  assert.equal(
    (await ingest({ completed: 45 }, 'production', expired.token)).status,
    401,
  );
});

void test('application-created feeds retain group access and existing player sync/publication behavior', async (t) => {
  const { admin, user, client, ingest, application, db } =
    await applicationFixture(t);
  const group = (
    await admin('/api/groups', 'POST', { name: 'Metrics audience' })
  ).data;
  // Set the configured scope before the application's first push.
  db.prepare(
    'UPDATE data_feed_applications SET managingGroupId=? WHERE id=?',
  ).run(group.id, application.id);
  const person = await user('metrics-viewer');
  const outsider = await user('metrics-outsider');
  await admin(`/api/groups/${group.id}/members/${person.id}`, 'PUT', {
    role: 'member',
  });
  const automatic = await ingest({ completed: 42 });
  const feedId = automatic.data.feedId;
  const visible = (await person.call('/api/library')).data.dataFeeds.find(
    (item) => item.id === feedId,
  );
  assert.equal(visible.managingGroupId, group.id);
  assert.equal(
    (await outsider.call(`/api/data-feeds/${feedId}/data`)).status,
    404,
  );
  const saved = (await admin('/api/slides', 'POST', slide(feedId))).data;
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'App metrics',
      items: [{ slideId: saved.id, duration: 30 }],
    })
  ).data;
  await admin(`/api/playlists/${playlist.id}/publish`, 'POST');
  const player = client();
  const device = (
    await player('/api/player/enroll', 'POST', { name: 'Metrics screen' })
  ).data;
  await admin(`/api/devices/${device.id}/approve`, 'POST', {
    code: device.code,
  });
  await admin(`/api/devices/${device.id}`, 'PUT', {
    name: 'Metrics screen',
    playlistId: playlist.id,
    blank: false,
    rotation: 0,
  });
  assert.equal(
    (
      await admin(`/api/access/device/${device.id}`, 'POST', {
        groupId: group.id,
      })
    ).status,
    200,
  );
  const sync = () =>
    player(
      '/api/player/sync',
      'POST',
      {},
      { Authorization: `Bearer ${device.token}` },
    );
  const first = (await sync()).data;
  assert.equal(first.manifest.schemaVersion, 4);
  assert.equal(first.dataFeeds[feedId].data.completed, 42);
  await ingest({ completed: 43, goal: 100 });
  const next = (await sync()).data;
  assert.equal(next.manifest.revision, first.manifest.revision);
  assert.equal(next.dataFeeds[feedId].data.completed, 43);
  assert.equal(next.dataFeeds[feedId].data.goal, 100);
  assert.ok(!JSON.stringify(next).includes('ofa_'));
  assert.equal(
    (await admin(`/api/data-feeds/${feedId}`, 'DELETE')).status,
    409,
  );
});

void test('application quotas and shared rate budgets keep ingestion bounded and atomic', async (t) => {
  const { admin, application, ingest, db } = await applicationFixture(t);
  for (let index = 0; index < 60; index++)
    assert.equal(
      (await ingest({ value: index }, 'bounded')).status,
      index ? 200 : 201,
    );
  const another = (
    await admin(
      `/api/data-feeds/applications/${application.id}/tokens`,
      'POST',
      { name: 'Another writer' },
    )
  ).data;
  const throttled = await ingest({ value: 61 }, 'another', another.token);
  assert.equal(throttled.status, 429);
  assert.equal(throttled.data.code, 'RATE_LIMITED');
  assert.ok(Number(throttled.headers.get('Retry-After')) > 0);
  const second = (
    await admin('/api/data-feeds/applications', 'POST', {
      name: 'Independent budget',
    })
  ).data;
  let independentKey;
  for (let index = 0; index < 20; index++) {
    const issued = await admin(
      `/api/data-feeds/applications/${second.id}/tokens`,
      'POST',
      { name: `Writer ${index}` },
    );
    assert.equal(issued.status, 201);
    independentKey ||= issued.data.token;
  }
  const independent = await ingest({ value: 1 }, 'independent', independentKey);
  assert.equal(independent.status, 201);
  const count = Number(
    db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='data-feed'").get()
      .n,
  );
  for (let index = count; index < 200; index++) {
    const dummy = {
      id: randomUUID(),
      name: `Quota feed ${index}`,
      fields: [{ key: 'value', type: 'number' }],
      data: null,
      updatedAt: null,
      revision: null,
    };
    db.prepare('INSERT INTO records VALUES (?,?,?)').run(
      'data-feed',
      dummy.id,
      JSON.stringify(dummy),
    );
  }
  const overflow = await ingest({ value: 2 }, 'overflow', independentKey);
  assert.equal(overflow.status, 409);
  assert.equal(overflow.data.code, 'FEED_LIMIT');
  assert.equal(
    (await ingest({ value: 2 }, 'independent', independentKey)).status,
    200,
  );
  assert.equal(
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM data_feed_application_sources WHERE applicationId=?',
      )
      .get(second.id).n,
    1,
  );
  assert.equal(
    (
      await admin(`/api/data-feeds/applications/${second.id}/tokens`, 'POST', {
        name: 'Overflow',
      })
    ).status,
    409,
  );
  const key = (await admin(`/api/data-feeds/applications/${second.id}/tokens`))
    .data[0];
  assert.ok(key.id);
  for (let index = 0; index < 48; index++)
    assert.equal(
      (
        await admin('/api/data-feeds/applications', 'POST', {
          name: `App ${index}`,
        })
      ).status,
      201,
    );
  assert.equal(
    (await admin('/api/data-feeds/applications', 'POST', { name: 'Overflow' }))
      .status,
    409,
  );
  assert.equal(
    (
      await admin('/api/data-feeds/applications', 'POST', {
        name: 'Invalid group',
        managingGroupId: randomUUID(),
      })
    ).status,
    400,
  );
  const thirdWriter = (
    await admin(
      `/api/data-feeds/applications/${application.id}/tokens`,
      'POST',
      { name: 'Quota writer' },
    )
  ).data;
  assert.equal(
    (await ingest({ value: 61 }, 'extra', thirdWriter.token)).status,
    429,
  );
  assert.equal(
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM data_feed_application_sources WHERE applicationId=?',
      )
      .get(application.id).n,
    1,
  );
});

void test('failed application creation rolls back ownership, schema, source mapping and key usage together', async (t) => {
  const { ingest, application, applicationKey, db } =
    await applicationFixture(t);
  db.exec(
    `CREATE TRIGGER fail_application_source BEFORE INSERT ON data_feed_application_sources BEGIN SELECT RAISE(ABORT, 'test source failure'); END`,
  );
  const logging = t.mock.method(console, 'error', () => {});
  assert.equal((await ingest({ value: 42 })).status, 500);
  logging.mock.restore();
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM records WHERE kind='data-feed' AND json_extract(body,'$.applicationId')=?",
      )
      .get(application.id).n,
    0,
  );
  assert.equal(
    db
      .prepare('SELECT lastUsedAt FROM data_feed_application_tokens WHERE id=?')
      .get(applicationKey.id).lastUsedAt,
    null,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM resource_access WHERE kind='data-feed'",
      )
      .get().n,
    1,
  );
  db.exec('DROP TRIGGER fail_application_source');
  const saved = await ingest({ value: 42 });
  assert.equal(saved.status, 201);
});

void test('unused applications can be deleted and recreated; feed removal clears only its application mapping', async (t) => {
  const { admin, application, applicationKey, ingest, db } =
    await applicationFixture(t);
  const first = await ingest({ value: 42 });
  assert.equal(
    (await admin(`/api/data-feeds/${first.data.feedId}`, 'DELETE')).status,
    200,
  );
  assert.equal(
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM data_feed_application_sources WHERE applicationId=?',
      )
      .get(application.id).n,
    0,
  );
  const recreated = await ingest({ value: 43 });
  assert.equal(recreated.status, 201);
  assert.notEqual(recreated.data.feedId, first.data.feedId);
  await admin(`/api/data-feeds/${recreated.data.feedId}`, 'DELETE');
  assert.equal(
    (await admin(`/api/data-feeds/applications/${application.id}`, 'DELETE'))
      .status,
    200,
  );
  assert.equal((await ingest({ value: 44 })).status, 401);
  assert.equal(
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM data_feed_application_tokens WHERE id=?',
      )
      .get(applicationKey.id).n,
    0,
  );
  assert.equal(
    (await admin(`/api/data-feeds/applications/${application.id}`, 'DELETE'))
      .status,
    404,
  );
});

void test('site-bound keys isolate identical sources and preserve identity during rotation', async (t) => {
  const { admin, application, ingest, applicationKey, client } =
    await applicationFixture(t);
  const original = await ingest({ completed: 7 });
  const siteA = (
    await admin('/api/sites', 'POST', { siteNumber: ' 001 ', name: 'North' })
  ).data;
  const siteB = (
    await admin('/api/sites', 'POST', { siteNumber: '002', name: 'South' })
  ).data;
  assert.equal(siteA.siteNumber, '001');
  assert.equal(
    (
      await admin('/api/sites', 'POST', {
        siteNumber: '001',
        name: 'Duplicate',
      })
    ).status,
    409,
  );
  assert.equal(
    (await admin('/api/sites', 'POST', { siteNumber: 'bad', name: 'Invalid' }))
      .status,
    400,
  );
  assert.equal((await client()('/api/sites')).status, 401);
  assert.equal(
    (await admin(`/api/sites/${siteA.id}`, 'PATCH', { siteNumber: '003' }))
      .status,
    400,
  );
  const issue = (siteId) =>
    admin(`/api/data-feeds/applications/${application.id}/tokens`, 'POST', {
      name: 'Integration',
      siteId,
    });
  assert.equal((await issue(null)).data.code, 'SITE_REQUIRED');
  assert.equal((await issue(randomUUID())).status, 400);
  const keyA = (await issue(siteA.id)).data;
  const keyB = (await issue(siteB.id)).data;
  const a = await ingest({ completed: 10 }, 'production', keyA.token);
  const b = await ingest({ completed: 20 }, 'production', keyB.token);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.data.siteId, siteA.id);
  assert.equal(b.data.siteId, siteB.id);
  assert.notEqual(a.data.feedId, b.data.feedId);
  assert.notEqual(a.data.feedId, original.data.feedId);
  const rotated = (await issue(siteA.id)).data;
  const again = await ingest({ completed: 11 }, 'production', rotated.token);
  assert.equal(again.status, 200);
  assert.equal(again.data.feedId, a.data.feedId);
  assert.equal(
    (await admin(`/api/data-feeds/${b.data.feedId}/data`)).data.data.completed,
    20,
  );
  // A site claim inside the metric payload cannot change the authorized destination.
  assert.equal(
    (
      await ingest(
        { completed: 999, siteId: siteB.id },
        'production',
        keyA.token,
      )
    ).status,
    400,
  );
  assert.equal(
    (await admin(`/api/data-feeds/${a.data.feedId}/data`)).data.data.completed,
    11,
  );
  assert.equal(
    (await ingest({ completed: 8 }, 'production', applicationKey.token)).data
      .feedId,
    original.data.feedId,
  );
  const feedKey = (
    await admin(`/api/data-feeds/${a.data.feedId}/tokens`, 'POST', {
      name: 'Legacy protocol',
    })
  ).data;
  const savedSlide = (await admin('/api/slides', 'POST', slide(a.data.feedId)))
    .data;
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Scoped values',
      items: [{ slideId: savedSlide.id, duration: 30 }],
    })
  ).data;
  await admin(`/api/playlists/${playlist.id}/publish`, 'POST');
  const player = client();
  const device = (
    await player('/api/player/enroll', 'POST', { name: 'Unassigned screen' })
  ).data;
  await admin(`/api/devices/${device.id}/approve`, 'POST', {
    code: device.code,
    siteId: siteB.id,
  });
  await admin(`/api/devices/${device.id}`, 'PUT', {
    name: 'Unassigned screen',
    playlistId: playlist.id,
    blank: false,
    rotation: 0,
  });
  const sync = await player(
    '/api/player/sync',
    'POST',
    {},
    { Authorization: `Bearer ${device.token}` },
  );
  assert.equal(sync.data.dataFeeds[a.data.feedId].status, 'unavailable');
  assert.equal(sync.data.dataFeeds[a.data.feedId].data, null);
  await admin(`/api/sites/${siteA.id}`, 'PATCH', { archived: true });
  assert.equal(
    (await ingest({ completed: 12 }, 'production', keyA.token)).data.code,
    'SITE_ARCHIVED',
  );
  assert.equal((await issue(siteA.id)).status, 409);
  assert.equal(
    (
      await client()(
        `/api/data-feeds/${a.data.feedId}/data`,
        'PUT',
        { completed: 99 },
        { Authorization: `Bearer ${feedKey.token}` },
      )
    ).data.code,
    'SITE_ARCHIVED',
  );
  await admin(`/api/sites/${siteA.id}`, 'PATCH', { archived: false });
  assert.equal(
    (await ingest({ completed: 12 }, 'production', keyA.token)).data.feedId,
    a.data.feedId,
  );
});

void test('legacy source migration preserves key hashes and feed IDs and is repeatable', async (t) => {
  const { admin, application, applicationKey, ingest, db } =
    await applicationFixture(t);
  const original = await ingest({ completed: 17 });
  const before = db
    .prepare('SELECT digest FROM data_feed_application_tokens WHERE id=?')
    .get(applicationKey.id).digest;
  db.exec(`ALTER TABLE data_feed_application_tokens DROP COLUMN siteIds;
    ALTER TABLE data_feed_application_tokens DROP COLUMN siteId;
    ALTER TABLE data_feed_application_sources RENAME TO scoped_sources;
    CREATE TABLE data_feed_application_sources(applicationId TEXT NOT NULL,sourceKey TEXT NOT NULL,feedId TEXT NOT NULL UNIQUE,PRIMARY KEY(applicationId,sourceKey));
    INSERT INTO data_feed_application_sources SELECT applicationId,sourceKey,feedId FROM scoped_sources;
    DROP TABLE scoped_sources;`);
  const dir = path.dirname(
    db
      .prepare('PRAGMA database_list')
      .all()
      .find((row) => row.name === 'main').file,
  );
  for (let iteration = 0; iteration < 2; iteration++) {
    const reopened = createApp({ dataDir: dir });
    try {
      assert.equal(
        reopened.db
          .prepare(
            'SELECT feedId FROM data_feed_application_sources WHERE applicationId=? AND siteId=?',
          )
          .get(application.id, '').feedId,
        original.data.feedId,
      );
      const key = reopened.db
        .prepare('SELECT * FROM data_feed_application_tokens WHERE id=?')
        .get(applicationKey.id);
      assert.equal(key.digest, before);
      assert.equal(key.siteId, null);
    } finally {
      reopened.close();
      reopened.db.close();
    }
  }
  assert.equal(
    (await ingest({ completed: 18 })).data.feedId,
    original.data.feedId,
  );
  assert.equal(
    (await admin(`/api/data-feeds/${original.data.feedId}/data`)).data.data
      .completed,
    18,
  );
});

void test('enrollment site is untrusted until pairing; first assignments require cache-aware players', async (t) => {
  const { admin, client, application, ingest, db } =
    await applicationFixture(t);
  const oldPlayer = client();
  const old = (
    await oldPlayer('/api/player/enroll', 'POST', { name: 'Existing screen' })
  ).data;
  await admin(`/api/devices/${old.id}/approve`, 'POST', { code: old.code });
  const a = (
    await admin('/api/sites', 'POST', { siteNumber: '001', name: 'North' })
  ).data;
  const b = (
    await admin('/api/sites', 'POST', { siteNumber: '002', name: 'South' })
  ).data;
  const player = client();
  for (const siteNumber of ['003', 'not-a-site', 1])
    assert.equal(
      (
        await player('/api/player/enroll', 'POST', {
          name: 'Bad site',
          siteNumber,
        })
      ).status,
      400,
    );
  const enrolled = (
    await player('/api/player/enroll', 'POST', {
      name: 'New screen',
      siteNumber: '001',
    })
  ).data;
  let row = (await admin('/api/library')).data.devices.find(
    (item) => item.id === enrolled.id,
  );
  assert.equal(row.siteId, null);
  assert.equal(row.requestedSiteNumber, '001');
  const sync = (credentials, version = '0.15.1') =>
    player(
      '/api/player/sync',
      'POST',
      { version, siteId: b.id },
      { Authorization: `Bearer ${credentials.token}` },
    );
  assert.equal((await sync(enrolled)).data.approved, false);
  assert.equal(
    (
      await admin(`/api/devices/${enrolled.id}/approve`, 'POST', {
        code: enrolled.code,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await admin(`/api/devices/${enrolled.id}/approve`, 'POST', {
        code: 'BAD',
        siteId: b.id,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await admin(`/api/devices/${enrolled.id}/approve`, 'POST', {
        code: enrolled.code,
        siteId: a.id,
      })
    ).status,
    200,
  );
  assert.equal((await sync(enrolled)).data.siteId, a.id);
  assert.equal((await sync(enrolled)).data.siteNumber, '001');
  assert.equal(
    (
      await admin(`/api/devices/${enrolled.id}/approve`, 'POST', {
        code: enrolled.code,
        siteId: b.id,
      })
    ).status,
    409,
  );
  assert.equal(
    (await admin(`/api/devices/${enrolled.id}/site`, 'POST', { siteId: b.id }))
      .status,
    409,
  );
  await sync(old, '0.15.0');
  assert.equal(
    (await admin(`/api/devices/${old.id}/site`, 'POST', { siteId: a.id }))
      .status,
    409,
  );
  await sync(old);
  assert.equal(
    (await admin(`/api/devices/${old.id}/site`, 'POST', { siteId: a.id }))
      .status,
    200,
  );
  row = (await admin('/api/library')).data.devices.find(
    (item) => item.id === old.id,
  );
  assert.equal(row.siteId, a.id);
  // The matching approved site unlocks only that site's feed, without relaxing grants.
  const key = (
    await admin(
      `/api/data-feeds/applications/${application.id}/tokens`,
      'POST',
      { name: 'North', siteId: a.id },
    )
  ).data;
  const feed = await ingest({ completed: 42 }, 'production', key.token);
  const saved = (await admin('/api/slides', 'POST', slide(feed.data.feedId)))
    .data;
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'North data',
      items: [{ slideId: saved.id, duration: 30 }],
    })
  ).data;
  await admin(`/api/playlists/${playlist.id}/publish`, 'POST');
  await admin(`/api/devices/${enrolled.id}`, 'PUT', {
    name: 'North screen',
    playlistId: playlist.id,
    blank: false,
    rotation: 0,
  });
  const audience = (
    await admin('/api/groups', 'POST', { name: 'North screens' })
  ).data;
  await admin(`/api/access/data-feed/${feed.data.feedId}`, 'POST', {
    groupId: audience.id,
  });
  await admin(`/api/access/device/${enrolled.id}`, 'POST', {
    groupId: audience.id,
  });
  assert.equal(
    (await sync(enrolled)).data.dataFeeds[feed.data.feedId].data.completed,
    42,
  );
  const stored = JSON.parse(
    db
      .prepare("SELECT body FROM records WHERE kind='device' AND id=?")
      .get(enrolled.id).body,
  );
  assert.equal(stored.siteId, a.id);
});

void test('one shared publication resolves only the approved site with stable live revisions and matching previews', async (t) => {
  const { admin, client, user, db, application, ingest } =
    await applicationFixture(t);
  const audience = (
    await admin('/api/groups', 'POST', { name: 'Shared layout screens' })
  ).data;
  const groups = [];
  const sites = [];
  const keys = [];
  const feeds = [];
  for (let i = 0; i < 4; i++) {
    groups.push(
      (
        await admin('/api/groups', 'POST', {
          name: `Store ${i + 1}`,
          parentId: audience.id,
        })
      ).data,
    );
    sites.push(
      (
        await admin('/api/sites', 'POST', {
          siteNumber: `00${i + 1}`,
          name: `Site ${i + 1}`,
          accessGroupId: groups[i].id,
        })
      ).data,
    );
    keys.push(
      (
        await admin(
          `/api/data-feeds/applications/${application.id}/tokens`,
          'POST',
          { name: `Site ${i + 1}`, siteId: sites[i].id },
        )
      ).data,
    );
    if (i < 3) {
      const result = await ingest(
        {
          completed:
            i === 2 ? [{ label: 'wrong type', value: 5 }] : (i + 1) * 10,
        },
        'production',
        keys[i].token,
      );
      feeds.push(result.data.feedId);
      await admin(`/api/access/data-feed/${result.data.feedId}`, 'POST', {
        groupId: groups[i].id,
      });
    }
  }
  const southAuthor = await user('south-publisher');
  assert.equal(
    (
      await admin(
        `/api/groups/${groups[1].id}/members/${southAuthor.id}`,
        'PUT',
        { role: 'member' },
      )
    ).status,
    200,
  );
  const input = { ...slide(feeds[0]), managingGroupId: audience.id };
  input.layers[0].data.siteBinding = {
    applicationId: application.id,
    sourceKey: 'production',
  };
  const saved = await admin('/api/slides', 'POST', input);
  assert.equal(saved.status, 201);
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'One layout for every site',
      managingGroupId: audience.id,
      items: [{ slideId: saved.data.id, duration: 30 }],
    })
  ).data;
  assert.equal(
    (
      await admin(`/api/access/playlist/${playlist.id}`, 'POST', {
        userId: southAuthor.id,
        permission: 'edit',
      })
    ).status,
    200,
  );
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  assert.equal(
    (await southAuthor.call(`/api/playlists/${playlist.id}/publish`, 'POST'))
      .status,
    200,
  );
  // Publishing a shared template does not grant access to its example store.
  assert.equal(
    (await southAuthor.call(`/api/data-feeds/${feeds[0]}/data`)).status,
    404,
  );
  assert.ok(
    !(await southAuthor.call('/api/library')).data.dataFeeds.some(
      (feed) => feed.id === feeds[0],
    ),
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM resource_grants WHERE kind='data-feed' AND id=? AND groupId=?",
      )
      .get(feeds[0], audience.id).n,
    0,
  );
  // Creating a new widget still requires access to its actual example feed.
  assert.equal(
    (
      await southAuthor.call('/api/slides', 'POST', {
        ...input,
        managingGroupId: undefined,
      })
    ).status,
    403,
  );
  const players = [];
  for (let i = 0; i < sites.length; i++) {
    const player = client();
    const credentials = (
      await player('/api/player/enroll', 'POST', {
        name: `Screen ${i}`,
        siteNumber: sites[i].siteNumber,
      })
    ).data;
    await admin(`/api/devices/${credentials.id}/approve`, 'POST', {
      code: credentials.code,
      siteId: sites[i].id,
    });
    await admin(`/api/devices/${credentials.id}`, 'PUT', {
      name: `Screen ${i}`,
      playlistId: playlist.id,
      blank: false,
      rotation: 0,
    });
    assert.equal(
      (
        await admin(`/api/access/device/${credentials.id}`, 'POST', {
          groupId: groups[i].id,
        })
      ).status,
      200,
    );
    players.push(() =>
      player(
        '/api/player/sync',
        'POST',
        { version: '0.15.1' },
        { Authorization: `Bearer ${credentials.token}` },
      ),
    );
  }
  const north = (await players[0]()).data;
  const south = (await players[1]()).data;
  assert.equal(north.dataFeeds[feeds[0]].data.completed, 10);
  assert.equal(south.dataFeeds[feeds[1]].data.completed, 20);
  assert.deepEqual(Object.keys(north.dataFeeds), [feeds[0]]);
  assert.deepEqual(Object.keys(south.dataFeeds), [feeds[1]]);
  assert.equal(south.manifest.items[0].slide.layers[0].data.feedId, feeds[1]);
  assert.equal(
    south.manifest.items[0].slide.layers[0].data.siteBinding,
    undefined,
  );
  assert.notEqual(north.manifest.revision, south.manifest.revision);
  const preview = (
    await admin(
      `/api/preview/${playlist.id}?version=published&siteId=${sites[1].id}`,
    )
  ).data;
  assert.equal(preview.items[0].slide.layers[0].data.feedId, feeds[1]);
  assert.equal(preview.dataFeeds[feeds[1]].data.completed, 20);
  for (const index of [2, 3]) {
    const unavailable = (await players[index]()).data;
    const snapshot = Object.values(unavailable.dataFeeds)[0];
    assert.equal(snapshot.status, 'unavailable');
    assert.equal(snapshot.data, null);
    assert.ok(!Object.keys(unavailable.dataFeeds).includes(feeds[0]));
  }
  const localPreview = (
    await southAuthor.call(
      `/api/preview/${playlist.id}?version=published&siteId=${sites[1].id}`,
    )
  ).data;
  assert.deepEqual(Object.keys(localPreview.dataFeeds), [feeds[1]]);
  assert.equal(localPreview.dataFeeds[feeds[1]].data.completed, 20);
  const deniedPreview = (
    await southAuthor.call(
      `/api/preview/${playlist.id}?version=published&siteId=${sites[0].id}`,
    )
  ).data;
  assert.equal(Object.values(deniedPreview.dataFeeds)[0].status, 'unavailable');
  assert.ok(!Object.keys(deniedPreview.dataFeeds).includes(feeds[0]));
  await admin(`/api/access/data-feed/${feeds[1]}`, 'POST', {
    groupId: groups[1].id,
    remove: true,
  });
  const revoked = (await players[1]()).data;
  assert.equal(Object.values(revoked.dataFeeds)[0].status, 'unavailable');
  assert.ok(!Object.keys(revoked.dataFeeds).includes(feeds[0]));
  await admin(`/api/access/data-feed/${feeds[1]}`, 'POST', {
    groupId: groups[1].id,
  });
  const noSite = (await admin(`/api/preview/${playlist.id}?version=published`))
    .data;
  assert.equal(Object.values(noSite.dataFeeds)[0].status, 'unavailable');
  await ingest({ completed: 11 }, 'production', keys[0].token);
  const updated = (await players[0]()).data;
  assert.equal(updated.manifest.revision, north.manifest.revision);
  assert.equal(updated.dataFeeds[feeds[0]].data.completed, 11);
  const fork = (
    await southAuthor.call(`/api/playlists/${playlist.id}/fork`, 'POST', {
      name: 'South fork',
      managingGroupId: groups[1].id,
    })
  ).data;
  assert.ok(fork.id);
  assert.equal(
    (await southAuthor.call(`/api/playlists/${fork.id}/publish`, 'POST'))
      .status,
    200,
  );
  assert.equal(
    (
      await admin(`/api/slides/${saved.data.id}`, 'PUT', {
        ...saved.data,
        name: 'Refreshed local metrics',
      })
    ).status,
    200,
  );
  const refreshed = (
    await admin(
      `/api/preview/${playlist.id}?version=published&siteId=${sites[1].id}`,
    )
  ).data;
  assert.equal(refreshed.items[0].slide.name, 'Refreshed local metrics');
  assert.equal(
    (
      await admin(`/api/playlists/${playlist.id}`, 'PUT', {
        ...playlist,
        items: playlist.items.map((item) => ({ ...item, duration: 45 })),
      })
    ).status,
    200,
  );
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  const savedFork = (await admin('/api/library')).data.playlists.find(
    (p) => p.id === fork.id,
  );
  assert.equal(savedFork.forkSyncError, undefined);
  const forkPreview = (
    await southAuthor.call(
      `/api/preview/${fork.id}?version=published&siteId=${sites[1].id}`,
    )
  ).data;
  assert.equal(forkPreview.items[0].duration, 45);
  assert.deepEqual(Object.keys(forkPreview.dataFeeds), [feeds[1]]);
});

void test('fixed feeds still require every playlist recipient even beside a store-relative widget', async (t) => {
  const { admin, application, ingest, user } = await applicationFixture(t);
  const north = (await admin('/api/groups', 'POST', { name: 'North audience' }))
    .data;
  const south = (await admin('/api/groups', 'POST', { name: 'South audience' }))
    .data;
  const person = await user('south-fixed-publisher');
  await admin(`/api/groups/${south.id}/members/${person.id}`, 'PUT', {
    role: 'member',
  });
  const site = (
    await admin('/api/sites', 'POST', {
      siteNumber: '101',
      name: 'North',
      accessGroupId: north.id,
    })
  ).data;
  const key = (
    await admin(
      `/api/data-feeds/applications/${application.id}/tokens`,
      'POST',
      { name: 'North metrics', siteId: site.id },
    )
  ).data;
  const feed = (await ingest({ completed: 10 }, 'production', key.token)).data
    .feedId;
  for (const mixed of [false, true]) {
    const fixed = widget(feed);
    const relative = widget(feed);
    relative.data.siteBinding = {
      applicationId: application.id,
      sourceKey: 'production',
    };
    const saved = await admin('/api/slides', 'POST', {
      ...slide(feed),
      layers: mixed ? [relative, fixed] : [fixed],
    });
    assert.equal(saved.status, 201);
    const playlist = (
      await admin('/api/playlists', 'POST', {
        name: mixed ? 'Mixed bindings' : 'Fixed binding',
        items: [{ slideId: saved.data.id, duration: 10 }],
      })
    ).data;
    const first = await admin(`/api/playlists/${playlist.id}/publish`, 'POST');
    assert.equal(first.status, 200);
    assert.equal(
      (
        await admin(`/api/access/playlist/${playlist.id}`, 'POST', {
          groupId: south.id,
          permission: 'edit',
        })
      ).status,
      200,
    );
    // Sharing content never overrides the feed's store scope.
    assert.equal(
      (await person.call(`/api/data-feeds/${feed}/data`)).status,
      404,
    );
    const rejected = await admin(
      `/api/playlists/${playlist.id}/publish`,
      'POST',
    );
    assert.equal(rejected.status, 409);
    assert.match(rejected.data.error, /Viewing access to every data feed/);
    assert.equal(
      (await person.call(`/api/playlists/${playlist.id}/publish`, 'POST'))
        .status,
      403,
    );
    assert.equal(
      (await admin('/api/library')).data.playlists.find(
        (p) => p.id === playlist.id,
      ).publishedRevision,
      first.data.publishedRevision,
    );
  }
});

void test('assigning an existing integration preserves secrets and feeds and rolls back source conflicts', async (t) => {
  const { admin, ingest, application, applicationKey, db } =
    await applicationFixture(t);
  const first = await ingest({ completed: 42 });
  const extra = await ingest({ count: 1 }, 'aaa');
  const a = (
    await admin('/api/sites', 'POST', {
      siteNumber: '001',
      name: 'Original site',
    })
  ).data;
  const b = (
    await admin('/api/sites', 'POST', { siteNumber: '002', name: 'Other site' })
  ).data;
  const keyB = (
    await admin(
      `/api/data-feeds/applications/${application.id}/tokens`,
      'POST',
      { name: 'Other site', siteId: b.id },
    )
  ).data;
  const other = await ingest({ completed: 99 }, 'production', keyB.token);
  const digest = db
    .prepare('SELECT digest FROM data_feed_application_tokens WHERE id=?')
    .get(applicationKey.id).digest;
  const assign = (siteId) =>
    admin(
      `/api/data-feeds/applications/${application.id}/assign-site`,
      'POST',
      { siteId },
    );
  assert.equal((await assign(b.id)).data.code, 'SITE_SOURCE_CONFLICT');
  assert.equal(
    (await admin(`/api/data-feeds/${extra.data.feedId}`)).data.siteId,
    null,
  );
  assert.equal(
    db
      .prepare('SELECT siteId FROM data_feed_application_tokens WHERE id=?')
      .get(applicationKey.id).siteId,
    null,
  );
  const migrated = await assign(a.id);
  assert.equal(migrated.status, 200);
  assert.equal(migrated.data.assignedFeeds, 2);
  assert.equal(migrated.data.assignedKeys, 1);
  assert.equal(
    (await admin(`/api/data-feeds/${first.data.feedId}`)).data.siteId,
    a.id,
  );
  const update = await ingest({ completed: 43 });
  assert.equal(update.data.feedId, first.data.feedId);
  assert.equal(update.data.siteId, a.id);
  assert.equal(
    (await admin(`/api/data-feeds/${other.data.feedId}/data`)).data.data
      .completed,
    99,
  );
  assert.equal(
    db
      .prepare('SELECT digest FROM data_feed_application_tokens WHERE id=?')
      .get(applicationKey.id).digest,
    digest,
  );
  assert.equal((await assign(a.id)).data.assignedFeeds, 0);
  assert.equal((await assign(a.id)).data.assignedKeys, 0);
});

async function centralFixture(t) {
  const f = await applicationFixture(t, { name: 'SMCC' });
  const groups = [],
    sites = [];
  for (const siteNumber of ['02882', '3404', '9999']) {
    const group = (
      await f.admin('/api/groups', 'POST', { name: `Store ${siteNumber}` })
    ).data;
    groups.push(group);
    sites.push(
      (
        await f.admin('/api/sites', 'POST', {
          siteNumber,
          name: `Store ${siteNumber}`,
          accessGroupId: group.id,
        })
      ).data,
    );
  }
  const keyPath = `/api/data-feeds/applications/${f.application.id}/tokens`;
  const issued = await f.admin(keyPath, 'POST', {
    name: 'Central SMCC',
    siteIds: sites.slice(0, 2).map((site) => site.id),
    expiresInDays: null,
  });
  assert.equal(issued.status, 201);
  const key = issued.data;
  const batch = (
    stores,
    secret = key.token,
    source = 'production',
    headers = {},
    raw = false,
  ) =>
    f.external(
      `/api/data-feeds/ingest-stores/${source}`,
      'POST',
      raw ? stores : { stores },
      { Authorization: `Bearer ${secret}`, ...headers },
      raw,
    );
  return { ...f, groups, sites, keyPath, key, batch };
}

void test('one central application writes isolated store metrics and tables; retries preserve identity and omitted values', async (t) => {
  const { admin, key, sites, groups, batch, application, user } =
    await centralFixture(t);
  assert.deepEqual(
    key.siteIds,
    sites.slice(0, 2).map((site) => site.id),
  );
  assert.equal(key.siteId, null);
  const records = [
    {
      siteNumber: '02882',
      metrics: { completed: 75, goal: 100, hourly: payload.hourly },
      tables: {
        training: Array.from({ length: 100 }, (_, i) => ({
          label: `Row ${i}`,
          value: i,
        })),
      },
    },
    {
      siteNumber: '3404',
      metrics: { completed: 82, goal: 100 },
      tables: { training: [] },
    },
  ];
  const first = await batch(records);
  assert.equal(first.status, 200);
  assert.equal(first.data.storesAccepted, 2);
  assert.equal(first.data.feedsCreated, 4);
  assert.equal(JSON.stringify(first.data).includes('completed'), false);
  const feeds = (await admin('/api/data-feeds')).data.filter(
    (feed) => feed.applicationId === application.id,
  );
  assert.equal(feeds.length, 4);
  for (let i = 0; i < 2; i++) {
    const reader = await user(`central-reader-${i}`);
    await admin(`/api/groups/${groups[i].id}/members/${reader.id}`, 'PUT', {
      role: 'member',
    });
    const visible = (await reader.call('/api/data-feeds')).data;
    assert.equal(visible.length, 2);
    assert.ok(visible.every((feed) => feed.siteId === sites[i].id));
    assert.ok(visible.every((feed) => feed.applicationName === 'SMCC'));
    const other = feeds.find((feed) => feed.siteId === sites[1 - i].id);
    assert.equal(
      (await reader.call(`/api/data-feeds/${other.id}/data`)).status,
      404,
    );
  }
  const again = await batch(records);
  assert.equal(again.data.feedsCreated, 0);
  assert.equal(again.data.feedsUpdated, 4);
  assert.deepEqual(
    (await admin('/api/data-feeds')).data
      .filter((feed) => feed.applicationId === application.id)
      .map((feed) => feed.id)
      .sort(),
    feeds.map((feed) => feed.id).sort(),
  );
  await batch([
    {
      siteNumber: '02882',
      metrics: { completed: null },
      tables: { training: [] },
    },
  ]);
  const metric = feeds.find(
    (feed) => feed.siteId === sites[0].id && feed.sourceKey === 'production',
  );
  const snapshot = (await admin(`/api/data-feeds/${metric.id}/data`)).data.data;
  assert.equal(snapshot.completed, null);
  assert.equal(snapshot.goal, 100);
  const south = feeds.find(
    (feed) => feed.siteId === sites[1].id && feed.sourceKey === 'production',
  );
  assert.equal(
    (await admin(`/api/data-feeds/${south.id}/data`)).data.data.completed,
    82,
  );
});

void test('central batches reject unauthorized stores, invalid values, schemas and body limits without partial writes', async (t) => {
  const { admin, batch, db, application, sites } = await centralFixture(t);
  await admin('/api/settings/data-feeds', 'PUT', { maxFieldsPerFeed: 20 });
  await batch([{ siteNumber: '02882', metrics: { completed: 1 } }]);
  const before = () =>
    db
      .prepare("SELECT body FROM records WHERE kind='data-feed' ORDER BY id")
      .all();
  const original = before();
  const lastUsed = db
    .prepare(
      'SELECT lastUsedAt FROM data_feed_application_tokens WHERE siteIds IS NOT NULL',
    )
    .get().lastUsedAt;
  const bad = [
    [{ siteNumber: '9999', metrics: { completed: 2 } }, 'SITE_NOT_AUTHORIZED'],
    [{ siteNumber: '8888', metrics: { completed: 2 } }, 'SITE_NOT_AUTHORIZED'],
    [{ siteNumber: '3404', metrics: { completed: 'bad' } }, 'INVALID_PAYLOAD'],
    [
      {
        siteNumber: '3404',
        tables: { training: [{ label: 'x', value: Infinity }] },
      },
      'INVALID_PAYLOAD',
    ],
    [
      {
        siteNumber: '3404',
        metrics: { completed: [{ label: 'wrong type', value: 2 }] },
      },
      'SOURCE_SCHEMA_CONFLICT',
    ],
  ];
  for (const [invalid, code] of bad) {
    const result = await batch([
      { siteNumber: '02882', metrics: { completed: 99 } },
      invalid,
    ]);
    assert.ok(result.status >= 400, JSON.stringify(result));
    if (code !== 'INVALID_PAYLOAD') assert.equal(result.data.code, code);
    assert.deepEqual(before(), original);
  }
  assert.equal(
    db
      .prepare(
        'SELECT lastUsedAt FROM data_feed_application_tokens WHERE siteIds IS NOT NULL',
      )
      .get().lastUsedAt,
    lastUsed,
  );
  assert.equal(
    (
      await batch([
        { siteNumber: '02882', metrics: { completed: 2 } },
        { siteNumber: '02882', metrics: { completed: 3 } },
      ])
    ).data.code,
    'DUPLICATE_SITE',
  );
  assert.equal(
    (
      await batch([
        {
          siteNumber: '3404',
          tables: {
            training: Array.from({ length: 101 }, (_, i) => ({
              label: `Row ${i}`,
              value: i,
            })),
          },
        },
      ])
    ).status,
    400,
  );
  assert.equal(
    (
      await batch([
        {
          siteNumber: '3404',
          metrics: Object.fromEntries(
            Array.from({ length: 21 }, (_, i) => [`field${i}`, 1]),
          ),
        },
      ])
    ).status,
    400,
  );
  assert.equal(
    (
      await batch([
        {
          siteNumber: '3404',
          tables: {
            rows: Array.from({ length: 100 }, (_, i) => ({
              label: `${i}`.padEnd(60, 'a'),
              value: i,
            })),
          },
          metrics: {},
        },
      ])
    ).status,
    400,
  );
  assert.equal(
    (
      await batch(
        '{"stores":['.padEnd(262145, ' '),
        undefined,
        'production',
        {},
        true,
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await batch(
        Array.from({ length: 51 }, () => ({
          siteNumber: '3404',
          metrics: { completed: 2 },
        })),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await batch(
        [{ siteNumber: '3404', metrics: { completed: 2 } }],
        undefined,
        'production',
        { 'Content-Type': 'text/plain' },
      )
    ).status,
    415,
  );
  await admin(`/api/sites/${sites[1].id}`, 'PATCH', { archived: true });
  assert.equal(
    (
      await batch([
        { siteNumber: '02882', metrics: { completed: 99 } },
        { siteNumber: '3404', metrics: { completed: 2 } },
      ])
    ).data.code,
    'SITE_ARCHIVED',
  );
  assert.deepEqual(before(), original);
  assert.equal(
    (await admin('/api/data-feeds')).data.filter(
      (feed) => feed.applicationId === application.id,
    ).length,
    1,
  );
});

void test('central keys preserve legacy keys and cannot bypass endpoint scopes, expiry or revocation', async (t) => {
  const {
    admin,
    batch,
    ingest,
    keyPath,
    sites,
    key,
    applicationKey,
    application,
    db,
  } = await centralFixture(t);
  for (const scope of [
    { siteIds: [] },
    { siteIds: [sites[0].id, sites[0].id] },
    { siteIds: [sites[0].id], siteId: sites[1].id },
    { siteIds: [randomUUID()] },
  ])
    assert.equal(
      (await admin(keyPath, 'POST', { name: 'Invalid', ...scope })).status,
      400,
    );
  assert.equal(
    (await ingest({ completed: 1 }, 'production', key.token)).data.code,
    'KEY_SCOPE',
  );
  assert.equal(
    (
      await batch(
        [{ siteNumber: '02882', metrics: { completed: 1 } }],
        applicationKey.token,
      )
    ).data.code,
    'KEY_SCOPE',
  );
  assert.equal((await ingest({ completed: 3 })).status, 201);
  const assigned = await admin(
    `/api/data-feeds/applications/${application.id}/assign-site`,
    'POST',
    { siteId: sites[0].id },
  );
  assert.equal(assigned.status, 200);
  assert.equal(assigned.data.assignedKeys, 1);
  const listed = (await admin(keyPath)).data;
  assert.deepEqual(
    listed.find((item) => item.id === key.id).siteIds,
    key.siteIds,
  );
  assert.equal(listed.find((item) => item.id === key.id).siteId, null);
  assert.equal(
    listed.some((item) => 'digest' in item || 'token' in item),
    false,
  );
  const storeKey = (
    await admin(keyPath, 'POST', { name: 'Single', siteId: sites[1].id })
  ).data;
  assert.equal(
    (await ingest({ completed: 4 }, 'production', storeKey.token)).status,
    201,
  );
  const stores = [{ siteNumber: '02882', metrics: { completed: 5 } }];
  assert.equal((await batch(stores)).status, 200);
  db.prepare(
    'UPDATE data_feed_application_tokens SET expiresAt=? WHERE id=?',
  ).run('2000-01-01T00:00:00Z', key.id);
  assert.equal((await batch(stores)).status, 401);
  const renewed = await admin(`${keyPath}/${key.id}`, 'PATCH', {
    expiresInDays: null,
  });
  assert.equal(renewed.status, 200);
  assert.deepEqual(renewed.data.siteIds, key.siteIds);
  assert.equal((await batch(stores)).status, 200);
  await admin(`${keyPath}/${key.id}`, 'DELETE');
  assert.equal((await batch(stores)).status, 401);
});

void test('central ingestion rolls back database failures and enforces aggregate and per-store limits', async (t) => {
  const { admin, batch, db, sites } = await centralFixture(t);
  db.exec(
    `CREATE TRIGGER fail_central BEFORE INSERT ON data_feed_application_sources WHEN NEW.siteId='${sites[1].id}' BEGIN SELECT RAISE(ABORT,'central rollback test'); END;`,
  );
  const stores = sites.slice(0, 2).map((site) => ({
    siteNumber: site.siteNumber,
    metrics: { completed: 1 },
  }));
  assert.equal((await batch(stores)).status, 500);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM data_feed_application_sources').get()
      .n,
    0,
  );
  assert.equal(
    db
      .prepare(
        'SELECT lastUsedAt FROM data_feed_application_tokens WHERE siteIds IS NOT NULL',
      )
      .get().lastUsedAt,
    null,
  );
  db.exec('DROP TRIGGER fail_central');
  for (let i = 0; i < 59; i++)
    assert.equal((await batch(stores.slice(0, 1))).status, 200);
  const limited = await batch(stores.slice(0, 1));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.equal((await batch(stores.slice(1))).status, 200);
  // Aggregate rate limit also counts malformed authenticated requests.
  for (let i = 0; i < 600; i++) {
    const result = await batch([]);
    if (result.status === 429) break;
    assert.equal(result.status, 400);
  }
  assert.equal((await batch(stores.slice(1))).status, 429);
  assert.equal((await admin('/api/data-feeds')).data.length, 3);
});

void test('central data resolves through unchanged shared player layouts without cross-store values', async (t) => {
  const { admin, client, sites, groups, batch, application } =
    await centralFixture(t);
  await batch(
    sites.slice(0, 2).map((site, i) => ({
      siteNumber: site.siteNumber,
      metrics: { completed: (i + 1) * 10 },
    })),
  );
  const feeds = (await admin('/api/data-feeds')).data.filter(
    (feed) => feed.applicationId === application.id,
  );
  const first = feeds.find((feed) => feed.siteId === sites[0].id);
  const input = slide(first.id);
  input.layers[0].data.siteBinding = {
    applicationId: application.id,
    sourceKey: 'production',
  };
  const saved = await admin('/api/slides', 'POST', input);
  assert.equal(saved.status, 201);
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Central shared template',
      items: [{ slideId: saved.data.id, duration: 30 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  for (let i = 0; i < 3; i++) {
    const player = client();
    const screen = (
      await player('/api/player/enroll', 'POST', {
        name: `Central screen ${i}`,
        siteNumber: sites[i].siteNumber,
      })
    ).data;
    await admin(`/api/devices/${screen.id}/approve`, 'POST', {
      code: screen.code,
      siteId: sites[i].id,
    });
    await admin(`/api/devices/${screen.id}`, 'PUT', {
      name: `Central screen ${i}`,
      playlistId: playlist.id,
      blank: false,
      rotation: 0,
    });
    await admin(`/api/access/device/${screen.id}`, 'POST', {
      groupId: groups[i].id,
    });
    const sync = (
      await player(
        '/api/player/sync',
        'POST',
        { version: '0.15.5' },
        { Authorization: `Bearer ${screen.token}` },
      )
    ).data;
    const preview = (
      await admin(
        `/api/preview/${playlist.id}?version=published&siteId=${sites[i].id}`,
      )
    ).data;
    if (i < 2) {
      const local = feeds.find((feed) => feed.siteId === sites[i].id);
      assert.deepEqual(Object.keys(sync.dataFeeds), [local.id]);
      assert.equal(sync.dataFeeds[local.id].data.completed, (i + 1) * 10);
      assert.equal(preview.dataFeeds[local.id].data.completed, (i + 1) * 10);
    } else {
      assert.equal(Object.values(sync.dataFeeds)[0].status, 'unavailable');
      assert.equal(Object.values(sync.dataFeeds)[0].data, null);
    }
  }
});

void test('central scopes survive restarts, respect disabled creators and are removed by connection reset', async (t) => {
  const { admin, batch, db, key, keyPath, application } =
    await centralFixture(t);
  const stores = [{ siteNumber: '02882', metrics: { completed: 42 } }];
  await batch(stores);
  const before = db
    .prepare(
      'SELECT digest,siteIds FROM data_feed_application_tokens WHERE id=?',
    )
    .get(key.id);
  const dir = path.dirname(
    db
      .prepare('PRAGMA database_list')
      .all()
      .find((row) => row.name === 'main').file,
  );
  const reopened = createApp({ dataDir: dir });
  try {
    assert.deepEqual(
      reopened.db
        .prepare(
          'SELECT digest,siteIds FROM data_feed_application_tokens WHERE id=?',
        )
        .get(key.id),
      before,
    );
  } finally {
    reopened.close();
    reopened.db.close();
  }
  const creator = db
    .prepare('SELECT creatorId FROM data_feed_application_tokens WHERE id=?')
    .get(key.id).creatorId;
  for (const update of ['disabled=1', "role='user'"]) {
    db.prepare(`UPDATE users SET ${update} WHERE id=?`).run(creator);
    assert.equal((await batch(stores)).status, 401);
    db.prepare("UPDATE users SET disabled=0,role='admin' WHERE id=?").run(
      creator,
    );
  }
  assert.equal(
    (await admin(keyPath)).data.find((item) => item.id === key.id).siteIds
      .length,
    2,
  );
  const result = await admin(
    `/api/data-feeds/applications/${application.id}?disconnectWidgets=true`,
    'DELETE',
  );
  assert.equal(result.status, 200);
  assert.equal((await batch(stores)).status, 401);
  assert.equal(
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM data_feed_application_tokens WHERE applicationId=?',
      )
      .get(application.id).n,
    0,
  );
});

void test('central contract examples work and quota/body failures leave all stores unchanged', async (t) => {
  const { admin, batch, sites, db, application } = await centralFixture(t);
  const contract = (await admin('/api/data-feeds/openapi.json')).data;
  const endpoint = contract.paths['/api/data-feeds/ingest-stores/{sourceKey}'];
  assert.equal(endpoint.parameters[0].name, 'sourceKey');
  assert.deepEqual(endpoint.post.security, [{ ApplicationWriteToken: [] }]);
  const sample = endpoint.post.requestBody.content['application/json'].example;
  sample.stores[0].siteNumber = sites[0].siteNumber;
  sample.stores[1].siteNumber = sites[1].siteNumber;
  assert.equal((await batch(sample.stores)).status, 200);
  const snapshot = () =>
    db
      .prepare(
        "SELECT body FROM records WHERE kind='data-feed' AND json_extract(body,'$.applicationId')=? ORDER BY id",
      )
      .all(application.id);
  const original = snapshot();
  const rows = Array.from({ length: 100 }, (_, i) => ({
    label: String(i).padEnd(60, 'x'),
    value: i,
  }));
  const oversized = await batch([
    { siteNumber: sites[0].siteNumber, metrics: { completed: 999 } },
    {
      siteNumber: sites[1].siteNumber,
      tables: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`table${i}`, rows]),
      ),
    },
  ]);
  assert.equal(oversized.status, 413);
  assert.deepEqual(snapshot(), original);
  const count = Number(
    db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='data-feed'").get()
      .n,
  );
  for (let i = count; i < 199; i++) {
    const feed = {
      id: randomUUID(),
      name: `Quota ${i}`,
      fields: [{ key: 'value', type: 'number' }],
      data: null,
      revision: null,
      updatedAt: null,
    };
    db.prepare('INSERT INTO records VALUES (?,?,?)').run(
      'data-feed',
      feed.id,
      JSON.stringify(feed),
    );
  }
  const result = await batch(
    sites
      .slice(0, 2)
      .map((site) => ({ siteNumber: site.siteNumber, metrics: { extra: 1 } })),
    undefined,
    'new-source',
  );
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'FEED_LIMIT');
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='data-feed'").get()
      .n,
    199,
  );
  assert.deepEqual(snapshot(), original);
  assert.equal(
    (
      await batch([
        { siteNumber: sites[0].siteNumber, metrics: { completed: 77 } },
      ])
    ).status,
    200,
  );
});

const metricFields = (count) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`metric${index}`, index]),
  );
const manualFields = (count) =>
  Object.keys(metricFields(count)).map((key) => ({ key, type: 'number' }));

void test('feeds default to 100 fields and only admins can change the bounded workspace limit', async (t) => {
  const { admin, client, user, ingest, feed, write } =
    await applicationFixture(t);
  const path = '/api/settings/data-feeds';
  const initial = await admin(path);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.data, {
    maxFieldsPerFeed: 100,
    minimum: 1,
    maximum: 500,
  });
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  const member = await user('field-limit-member');
  for (const call of [client(), member.call]) {
    assert.ok((await call(path)).status >= 400);
    assert.ok(
      (await call(path, 'PUT', { maxFieldsPerFeed: 120 })).status >= 400,
    );
  }
  for (const value of [0, 501, 1.5, '100', null])
    assert.equal(
      (await admin(path, 'PUT', { maxFieldsPerFeed: value })).status,
      400,
    );
  assert.equal(
    (await admin(path, 'PUT', { maxFieldsPerFeed: 100, extra: true })).status,
    400,
  );
  assert.equal((await admin(path, 'PUT', {})).status, 400);
  assert.equal((await admin(path)).data.maxFieldsPerFeed, 100);
  const first = await ingest(metricFields(100), 'full');
  assert.equal(first.status, 201);
  assert.equal(first.data.fields.length, 100);
  const saved = await admin('/api/slides', 'POST', {
    ...slide(first.data.feedId),
    layers: [widget(first.data.feedId, 'metric', 'metric99')],
  });
  assert.equal(saved.status, 201);
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Hundred-field playback',
      items: [{ slideId: saved.data.id, duration: 30 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  const preview = (await admin(`/api/preview/${playlist.id}?version=published`))
    .data;
  assert.equal(
    Object.keys(preview.dataFeeds[first.data.feedId].data).length,
    100,
  );
  assert.equal(preview.dataFeeds[first.data.feedId].data.metric99, 99);
  const player = client();
  const screen = (
    await player('/api/player/enroll', 'POST', { name: 'Hundred-field screen' })
  ).data;
  await admin(`/api/devices/${screen.id}/approve`, 'POST', {
    code: screen.code,
  });
  await admin(`/api/devices/${screen.id}`, 'PUT', {
    name: 'Hundred-field screen',
    playlistId: playlist.id,
    blank: false,
    rotation: 0,
  });
  const audience = (
    await admin('/api/groups', 'POST', { name: 'Hundred-field audience' })
  ).data;
  await admin(`/api/access/data-feed/${first.data.feedId}`, 'POST', {
    groupId: audience.id,
  });
  await admin(`/api/access/device/${screen.id}`, 'POST', {
    groupId: audience.id,
  });
  const synced = await player(
    '/api/player/sync',
    'POST',
    { version: '0.15.5' },
    { Authorization: `Bearer ${screen.token}` },
  );
  assert.equal(synced.status, 200);
  assert.equal(synced.data.dataFeeds[first.data.feedId].data.metric99, 99);
  assert.equal(
    Object.keys(synced.data.dataFeeds[first.data.feedId].data).length,
    100,
  );
  assert.equal((await ingest(metricFields(101), 'too-wide')).status, 400);
  assert.equal((await ingest({ extra: 1 }, 'full')).data.code, 'FIELD_LIMIT');
  const manual = await admin('/api/data-feeds', 'POST', {
    name: 'Hundred fields',
    fields: manualFields(100),
  });
  assert.equal(manual.status, 201);
  assert.equal(
    (
      await admin('/api/data-feeds', 'POST', {
        name: 'Too wide',
        fields: manualFields(101),
      })
    ).data.code,
    'FIELD_LIMIT',
  );
  // Existing feed-specific keys keep accepting their fixed schema independently.
  assert.equal((await write()).status, 200);
  assert.equal((await admin(`/api/data-feeds/${feed.id}`)).status, 200);
});

void test('live field-limit changes apply atomically to central batches and preserve existing wider feeds when lowered', async (t) => {
  const { admin, batch, sites, application, db } = await centralFixture(t);
  const path = '/api/settings/data-feeds';
  const stores = sites.slice(0, 2).map((site) => ({
    siteNumber: site.siteNumber,
    metrics: metricFields(45),
  }));
  assert.equal((await batch(stores)).status, 200);
  const feeds = (await admin('/api/data-feeds')).data.filter(
    (feed) => feed.applicationId === application.id,
  );
  assert.equal(feeds.length, 2);
  assert.ok(feeds.every((feed) => feed.fields.length === 45));
  assert.equal(
    (await admin(path, 'PUT', { maxFieldsPerFeed: 125 })).status,
    200,
  );
  assert.equal(
    (
      await batch(
        stores.map((store) => ({ ...store, metrics: metricFields(125) })),
      )
    ).status,
    200,
  );
  const original = () =>
    db
      .prepare("SELECT body FROM records WHERE kind='data-feed' ORDER BY id")
      .all();
  const before = original();
  const tooWide = await batch([
    { siteNumber: sites[0].siteNumber, metrics: { metric0: 999 } },
    { siteNumber: sites[1].siteNumber, metrics: { extra: 1 } },
  ]);
  assert.equal(tooWide.data.code, 'FIELD_LIMIT');
  assert.deepEqual(original(), before);
  assert.equal(
    (await admin(path, 'PUT', { maxFieldsPerFeed: 20 })).status,
    200,
  );
  const update = await batch(
    stores.map((store) => ({
      ...store,
      metrics: { ...metricFields(125), metric0: 88 },
    })),
  );
  assert.equal(update.status, 200);
  for (const feed of feeds) {
    const saved = (await admin(`/api/data-feeds/${feed.id}`)).data;
    assert.equal(saved.fields.length, 125);
    assert.equal(
      (await admin(`/api/data-feeds/${feed.id}/data`)).data.data.metric0,
      88,
    );
    assert.equal(
      (
        await admin(`/api/data-feeds/${feed.id}`, 'PUT', {
          name: 'Renamed wider feed',
          fields: saved.fields,
        })
      ).status,
      200,
    );
  }
  assert.equal(
    (await batch([{ siteNumber: sites[0].siteNumber, metrics: { extra: 3 } }]))
      .data.code,
    'FIELD_LIMIT',
  );
  assert.equal(
    (
      await batch(
        [{ siteNumber: sites[0].siteNumber, metrics: metricFields(21) }],
        undefined,
        'new-source',
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await batch(
        [{ siteNumber: sites[0].siteNumber, metrics: metricFields(20) }],
        undefined,
        'new-source',
      )
    ).status,
    200,
  );
  assert.equal(
    (await admin(path, 'PUT', { maxFieldsPerFeed: 500 })).status,
    200,
  );
  assert.equal(
    (
      await batch(
        [{ siteNumber: sites[0].siteNumber, metrics: metricFields(500) }],
        undefined,
        'wide-source',
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await batch(
        [{ siteNumber: sites[0].siteNumber, metrics: metricFields(501) }],
        undefined,
        'too-wide-source',
      )
    ).status,
    400,
  );
});

void test('configured field limits persist across restart and existing application credentials use the saved value', async (t) => {
  const { admin, db, applicationKey } = await applicationFixture(t);
  await admin('/api/settings/data-feeds', 'PUT', { maxFieldsPerFeed: 130 });
  const dataDir = path.dirname(
    db
      .prepare('PRAGMA database_list')
      .all()
      .find((row) => row.name === 'main').file,
  );
  const reopened = createApp({ dataDir });
  const server = reopened.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const result = await fetch(
      `http://127.0.0.1:${server.address().port}/api/data-feeds/ingest/restarted`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${applicationKey.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metricFields(130)),
      },
    );
    assert.equal(result.status, 201);
    assert.equal((await result.json()).fields.length, 130);
    const above = await fetch(
      `http://127.0.0.1:${server.address().port}/api/data-feeds/ingest/rejected`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${applicationKey.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metricFields(131)),
      },
    );
    assert.equal(above.status, 400);
  } finally {
    reopened.close();
    await new Promise((resolve) => server.close(resolve));
    reopened.db.close();
  }
});
