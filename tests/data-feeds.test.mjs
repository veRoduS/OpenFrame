import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';

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
