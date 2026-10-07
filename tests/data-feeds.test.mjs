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
