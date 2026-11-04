import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { randomUUID } from 'node:crypto';
import { metricText } from '../player/web/metric-text.js';

async function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'of-audit-'));
  const instance = createApp({ dataDir: directory });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    return async (route, method = 'GET', body) => {
      const response = await fetch(origin + route, {
        method,
        headers: { cookie, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, data: await response.json() };
    };
  }
  const admin = client();
  await admin('/api/setup', 'POST', { password: 'audit-test-password' });
  t.after(async () => {
    instance.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    instance.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { admin, client, db: instance.db };
}
void test('audit captures actor and content, filters, restores atomically and rejects newer edits', async (t) => {
  const { admin, client, db } = await fixture(t);
  assert.equal((await client()('/api/audit')).status, 401);
  const slide = (
    await admin('/api/slides', 'POST', {
      name: 'Original',
      width: 1080,
      height: 1920,
      background: '#ffffff',
      layers: [],
    })
  ).data;
  assert.ok(slide.id);
  assert.equal(
    (
      await admin(`/api/slides/${slide.id}`, 'PUT', {
        ...slide,
        name: 'Edited',
      })
    ).status,
    200,
  );
  const list = (await admin('/api/audit?kind=slide&search=Edited')).data;
  const event = list.entries.find(
    (e) => e.resourceId === slide.id && e.operation === 'updated',
  );
  assert.equal(event.canRestore, true);
  assert.notEqual(event.actorId, 'system-api');
  const detail = (await admin(`/api/audit/${event.sequence}`)).data;
  assert.equal(JSON.parse(detail.before.body).name, 'Original');
  assert.equal(
    (await admin(`/api/audit/${event.sequence}/revert`, 'POST', {})).status,
    200,
  );
  assert.equal(
    JSON.parse(
      db
        .prepare("SELECT body FROM records WHERE kind='slide' AND id=?")
        .get(slide.id).body,
    ).name,
    'Original',
  );
  assert.equal(
    (await admin(`/api/audit/${event.sequence}/revert`, 'POST', {})).status,
    409,
  );
  const invitation = (
    await admin('/api/users', 'POST', {
      username: 'audit-user',
      name: 'Audit User',
    })
  ).data;
  const user = client();
  await user('/api/activate', 'POST', {
    token: invitation.invitation,
    password: 'private-audit-password',
  });
  assert.equal((await user('/api/audit')).status, 403);
  const raw = db.prepare('SELECT * FROM app_audit').all();
  assert.equal(JSON.stringify(raw).includes('private-audit-password'), false);
  assert.equal(JSON.stringify(raw).includes('"password"'), false);
});
void test('metric sentences preserve plain text and include zero and unavailable values', () => {
  const config = { field: 'AccidentFreeDays', decimals: 0 };
  assert.equal(
    metricText('We are <AccidentFreeDays> days accident free', config, {
      data: { AccidentFreeDays: 0 },
    }),
    'We are 0 days accident free',
  );
  assert.equal(
    metricText('<AccidentFreeDays>', config, {
      status: 'unavailable',
      data: { AccidentFreeDays: 4 },
    }),
    '—',
  );
  assert.equal(
    metricText('<Other> <AccidentFreeDays>', config, {
      data: { AccidentFreeDays: 42 },
    }),
    '<Other> 42',
  );
});
void test('sharing restore reverses the complete operation and remains in audit history', async (t) => {
  const { admin } = await fixture(t);
  const group = (await admin('/api/groups', 'POST', { name: 'Review team' }))
    .data;
  const slide = (
    await admin('/api/slides', 'POST', {
      name: 'Shared',
      width: 1920,
      height: 1080,
      background: '#ffffff',
      layers: [],
    })
  ).data;
  assert.equal(
    (
      await admin(`/api/access/slide/${slide.id}`, 'POST', {
        groupId: group.id,
        permission: 'view',
      })
    ).status,
    200,
  );
  const event = (await admin('/api/audit?kind=slide')).data.entries.find((e) =>
    e.action.includes('/api/access/'),
  );
  assert.equal(event.canRestore, true);
  assert.equal(
    (await admin(`/api/audit/${event.sequence}/revert`, 'POST', {})).status,
    200,
  );
  assert.deepEqual(
    (await admin(`/api/access/slide/${slide.id}`)).data.grants,
    [],
  );
});
void test('text metric bindings persist and disconnect safely when their feed is deleted', async (t) => {
  const { admin } = await fixture(t);
  const site = (
    await admin('/api/sites', 'POST', { siteNumber: '11', name: 'Store' })
  ).data;
  const feed = (
    await admin('/api/data-feeds', 'POST', {
      name: 'Safety',
      siteId: site.id,
      fields: [{ key: 'AccidentFreeDays', type: 'number' }],
    })
  ).data;
  const layer = {
    id: randomUUID(),
    type: 'text',
    x: 5,
    y: 5,
    width: 80,
    height: 30,
    text: 'We are <AccidentFreeDays> days accident free',
    data: { mode: 'metric', feedId: feed.id, field: 'AccidentFreeDays' },
  };
  const slide = await admin('/api/slides', 'POST', {
    name: 'Safety sentence',
    width: 1080,
    height: 1920,
    background: '#ffffff',
    layers: [layer],
  });
  assert.equal(slide.status, 201);
  assert.equal(
    (await admin(`/api/data-feeds/${feed.id}`, 'DELETE')).status,
    409,
  );
  assert.equal(
    (await admin(`/api/data-feeds/${feed.id}?disconnectWidgets=true`, 'DELETE'))
      .status,
    200,
  );
  const saved = (await admin('/api/library')).data.slides.find(
    (item) => item.id === slide.data.id,
  );
  assert.equal(saved.layers[0].data.feedId, null);
  assert.equal(saved.layers[0].text, layer.text);
});

void test('restoring a slide also restores its publication, and a conflict rolls back all changes', async (t) => {
  const { admin, db } = await fixture(t);
  const slide = (
    await admin('/api/slides', 'POST', {
      name: 'Before publication',
      width: 1920,
      height: 1080,
      background: '#ffffff',
      layers: [],
    })
  ).data;
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Published',
      items: [{ slideId: slide.id, duration: 30 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST', {})).status,
    200,
  );
  assert.equal(
    (
      await admin(`/api/slides/${slide.id}`, 'PUT', {
        ...slide,
        name: 'After publication',
      })
    ).status,
    200,
  );
  const event = (await admin('/api/audit?kind=slide')).data.entries.find(
    (e) => e.resourceId === slide.id && e.operation === 'updated',
  );
  assert.equal(
    (await admin(`/api/audit/${event.sequence}/revert`, 'POST', {})).status,
    200,
  );
  const record = (kind, id) =>
    JSON.parse(
      db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id)
        .body,
    );
  assert.equal(record('slide', slide.id).name, 'Before publication');
  assert.equal(
    record('playlist', playlist.id).published.items[0].slide.name,
    'Before publication',
  );
  assert.equal(
    (
      await admin(`/api/slides/${slide.id}`, 'PUT', {
        ...slide,
        name: 'Another edit',
      })
    ).status,
    200,
  );
  const next = (await admin('/api/audit?kind=slide')).data.entries.find(
    (e) => e.resourceId === slide.id && e.operation === 'updated',
  );
  const current = record('playlist', playlist.id);
  await admin(`/api/playlists/${playlist.id}`, 'PUT', {
    ...current,
    name: 'Newer playlist edit',
  });
  const beforeCount = db.prepare('SELECT count(*) AS n FROM app_audit').get().n;
  assert.equal(
    (await admin(`/api/audit/${next.sequence}/revert`, 'POST', {})).status,
    409,
  );
  assert.equal(record('slide', slide.id).name, 'Another edit');
  assert.equal(record('playlist', playlist.id).name, 'Newer playlist edit');
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM app_audit').get().n,
    beforeCount,
  );
});
