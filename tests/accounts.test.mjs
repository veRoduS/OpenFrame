import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';
import { hashPassword } from '../server/accounts.mjs';

const password = 'test-password-long-enough';
const slide = {
  name: 'Private slide',
  width: 1920,
  height: 1080,
  background: '#ffffff',
  layers: [],
};
async function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-users-'));
  const instance = createApp({ dataDir: dir });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    instance.close();
    await new Promise((r) => server.close(r));
    instance.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  function client() {
    let cookie = '';
    return async (url, method = 'GET', body, extraHeaders = {}) => {
      const options = {
        method,
        headers: {
          cookie,
          ...(body instanceof FormData
            ? {}
            : { 'Content-Type': 'application/json' }),
          ...extraHeaders,
        },
      };
      if (body !== undefined)
        options.body = body instanceof FormData ? body : JSON.stringify(body);
      const response = await fetch(base + url, options);
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0];
      return {
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
        data: response.headers.get('content-type')?.includes('json')
          ? await response.json()
          : await response.arrayBuffer(),
      };
    };
  }
  const admin = client();
  assert.equal((await admin('/api/setup', 'POST', { password })).status, 200);
  async function user(username) {
    const created = (
      await admin('/api/users', 'POST', { username, name: username })
    ).data;
    const call = client();
    assert.equal(
      (
        await call('/api/activate', 'POST', {
          token: created.invitation,
          password,
        })
      ).status,
      200,
    );
    return { call, ...created };
  }
  return { ...instance, client, admin, user };
}

void test('users are isolated, invitations are single-use and passwords revoke other sessions', async (t) => {
  const { admin, user, client } = await fixture(t);
  const alice = await user('alice');
  const bob = await user('bob');
  assert.equal(
    (
      await bob.call('/api/activate', 'POST', {
        token: alice.invitation,
        password,
      })
    ).status,
    400,
  );
  const item = (await alice.call('/api/slides', 'POST', slide)).data;
  assert.equal((await bob.call('/api/library')).data.slides.length, 0);
  assert.equal(
    (await bob.call(`/api/slides/${item.id}`, 'PUT', slide)).status,
    404,
  );
  assert.equal(
    (await bob.call(`/api/slides/${item.id}`, 'DELETE')).status,
    404,
  );
  assert.equal(
    (
      await bob.call('/api/playlists', 'POST', {
        name: 'Steal',
        items: [{ slideId: item.id, duration: 10 }],
      })
    ).status,
    404,
  );
  assert.equal((await bob.call('/api/users')).status, 403);
  assert.equal((await bob.call('/api/screen-setup')).status, 403);
  assert.equal((await bob.call('/api/managed-vpn')).status, 403);
  const second = client();
  assert.equal(
    (await second('/api/login', 'POST', { username: 'alice', password }))
      .status,
    200,
  );
  assert.equal(
    (
      await alice.call('/api/account/password', 'POST', {
        currentPassword: 'wrong-password',
        password: 'new-password-long-enough',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await alice.call('/api/account/password', 'POST', {
        currentPassword: password,
        password: 'new-password-long-enough',
      })
    ).status,
    200,
  );
  assert.equal((await second('/api/library')).status, 401);
  assert.equal((await alice.call('/api/library')).status, 200);
  assert.equal(
    (await second('/api/login', 'POST', { username: 'alice', password }))
      .status,
    401,
  );
  assert.equal(
    (await admin(`/api/users/${alice.user.id}`, 'PATCH', { disabled: true }))
      .status,
    200,
  );
  assert.equal((await alice.call('/api/library')).status, 401);
});

void test('group invitations, sharing, admin transfer and removal enforce membership', async (t) => {
  const { admin, user } = await fixture(t);
  const alice = await user('alice');
  const bob = await user('bob');
  const group = (
    await alice.call('/api/groups', 'POST', { name: 'Lobby team' })
  ).data;
  const item = (await alice.call('/api/slides', 'POST', slide)).data;
  assert.equal(
    (
      await alice.call(`/api/access/slide/${item.id}`, 'POST', {
        groupId: group.id,
      })
    ).status,
    200,
  );
  assert.equal((await bob.call('/api/library')).data.slides.length, 0);
  const invite = (
    await alice.call(`/api/groups/${group.id}/invitation`, 'POST')
  ).data.invitation;
  assert.equal(
    (await bob.call('/api/groups/join', 'POST', { token: invite })).status,
    200,
  );
  assert.equal(
    (await bob.call('/api/groups/join', 'POST', { token: invite })).status,
    400,
  );
  assert.equal((await bob.call('/api/library')).data.slides[0].id, item.id);
  assert.equal(
    (
      await bob.call(`/api/slides/${item.id}`, 'PUT', {
        ...slide,
        name: 'Shared edit',
      })
    ).status,
    200,
  );
  assert.equal(
    (await bob.call(`/api/groups/${group.id}/invitation`, 'POST')).status,
    403,
  );
  assert.equal(
    (
      await alice.call(
        `/api/groups/${group.id}/members/${alice.user.id}`,
        'PUT',
        { role: 'remove' },
      )
    ).status,
    409,
  );
  assert.equal(
    (await admin(`/api/users/${alice.user.id}`, 'PATCH', { disabled: true }))
      .status,
    409,
  );
  assert.equal(
    (
      await alice.call(
        `/api/groups/${group.id}/members/${bob.user.id}`,
        'PUT',
        { role: 'admin' },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await alice.call(
        `/api/groups/${group.id}/members/${alice.user.id}`,
        'PUT',
        { role: 'member' },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await bob.call(
        `/api/groups/${group.id}/members/${alice.user.id}`,
        'PUT',
        { role: 'remove' },
      )
    ).status,
    200,
  );
  assert.equal((await alice.call('/api/groups')).data.length, 0);
  assert.equal(
    (await alice.call(`/api/groups/${group.id}/invitation`, 'POST')).status,
    403,
  );
});

void test('screens require assignment; recovery, media, preview and shared references are checked', async (t) => {
  const { admin, user, client } = await fixture(t);
  const alice = await user('alice');
  const outsider = await user('outsider');
  const device = (
    await client()('/api/player/enroll', 'POST', { name: 'Lobby' })
  ).data;
  await admin(`/api/devices/${device.id}/approve`, 'POST', {
    code: device.code,
  });
  assert.equal((await alice.call('/api/library')).data.devices.length, 0);
  assert.equal(
    (await alice.call(`/api/devices/${device.id}/recovery`)).status,
    404,
  );
  assert.equal(
    (
      await alice.call(`/api/devices/${device.id}/command`, 'POST', {
        type: 'refresh',
      })
    ).status,
    404,
  );
  const form = new FormData();
  form.append(
    'file',
    new Blob([
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: 'red' },
      })
        .png()
        .toBuffer(),
    ]),
    'red.png',
  );
  const asset = (await admin('/api/assets', 'POST', form)).data;
  const imageSlide = {
    ...slide,
    layers: [
      {
        id: randomUUID(),
        type: 'image',
        assetId: asset.id,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    ],
  };
  const item = (await admin('/api/slides', 'POST', imageSlide)).data;
  assert.ok(item.id);
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Lobby',
      items: [{ slideId: item.id, duration: 10 }],
    })
  ).data;
  await admin(`/api/playlists/${playlist.id}/publish`, 'POST');
  await admin(`/api/devices/${device.id}`, 'PUT', {
    name: 'Lobby',
    playlistId: playlist.id,
    rotation: 0,
    blank: false,
  });
  assert.equal(
    (
      await admin(`/api/access/device/${device.id}`, 'POST', {
        userId: alice.user.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (await alice.call('/api/library')).data.devices[0].id,
    device.id,
  );
  assert.equal((await alice.call(`/api/preview/${playlist.id}`)).status, 200);
  const mediaResponse = await alice.call(asset.url);
  assert.equal(mediaResponse.status, 200);
  assert.equal(mediaResponse.cacheControl, 'private, no-store');
  assert.equal((await outsider.call(asset.url)).status, 404);
  assert.equal(
    (await outsider.call(`/api/preview/${playlist.id}`)).status,
    404,
  );
  assert.equal(
    (
      await alice.call(`/api/devices/${device.id}/command`, 'POST', {
        type: 'refresh',
      })
    ).status,
    200,
  );
  assert.equal(
    (await alice.call(`/api/devices/${device.id}`, 'DELETE')).status,
    403,
  );
  const privateSlide = (await admin('/api/slides', 'POST', slide)).data;
  assert.equal(
    (
      await admin(`/api/playlists/${playlist.id}`, 'PUT', {
        name: 'Changed',
        items: [{ slideId: privateSlide.id, duration: 10 }],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await outsider.call('/api/assets/batch', 'POST', {
        ids: [asset.id],
        action: 'delete',
      })
    ).status,
    404,
  );
  await admin(`/api/access/device/${device.id}`, 'POST', {
    userId: alice.user.id,
    remove: true,
  });
  assert.equal(
    (
      await alice.call(`/api/devices/${device.id}/command`, 'POST', {
        type: 'refresh',
      })
    ).status,
    404,
  );
  const sync = await client()(
    '/api/player/sync',
    'POST',
    {},
    { Authorization: `Bearer ${device.token}` },
  );
  assert.equal(sync.status, 200);
  assert.equal(sync.data.manifest.items.length, 1);
});

void test('legacy administrator migrates without losing content or retaining anonymous sessions', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-migrate-'));
  const old = new DatabaseSync(path.join(dir, 'openframe.sqlite'));
  old.exec(
    'CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE sessions (token TEXT PRIMARY KEY,expires INTEGER NOT NULL)',
  );
  const saved = hashPassword(password);
  old.prepare('INSERT INTO settings VALUES (?,?)').run('password', saved);
  old
    .prepare('INSERT INTO sessions VALUES (?,?)')
    .run('legacy', Date.now() + 86400000);
  old.close();
  const instance = createApp({ dataDir: dir });
  t.after(() => {
    instance.close();
    instance.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const user = instance.db.prepare('SELECT * FROM users').get();
  assert.equal(user.username, 'admin');
  assert.equal(user.password, saved);
  assert.equal(user.role, 'superadmin');
  assert.equal(instance.seedInitialAdmin(), null);
  assert.equal(
    instance.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,
    0,
  );
  assert.equal(
    instance.db.prepare('SELECT * FROM settings WHERE key=?').get('password'),
    undefined,
  );
});
