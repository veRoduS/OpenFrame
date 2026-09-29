import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
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
        cookie,
        setCookies: response.headers.getSetCookie(),
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

void test('sessions persist for 30 days and renew at most daily, including existing shorter sessions', async (t) => {
  const { admin, db } = await fixture(t);
  const login = await admin('/api/login', 'POST', { password });
  assert.equal(login.setCookies.length, 1);
  assert.match(login.setCookies[0], /Max-Age=2592000/);
  assert.match(login.setCookies[0], /Expires=/);
  assert.match(login.setCookies[0], /HttpOnly/);
  assert.match(login.setCookies[0], /SameSite=Strict/);
  assert.match(login.setCookies[0], /Path=\//);
  const hash = createHash('sha256')
    .update(login.cookie.slice(18))
    .digest('hex');
  const saved = () =>
    db.prepare('SELECT expires FROM user_sessions WHERE token=?').get(hash)
      ?.expires;
  const day = 86400000;
  assert.ok(saved() > Date.now() + 29 * day);
  const initialExpiry = saved();
  assert.deepEqual((await admin('/api/auth')).setCookies, []);
  assert.equal(saved(), initialExpiry);

  // A still-valid session created by the previous 24-hour policy is upgraded.
  db.prepare('UPDATE user_sessions SET expires=? WHERE token=?').run(
    Date.now() + day,
    hash,
  );
  const upgraded = await admin('/api/auth');
  assert.equal(upgraded.data.authenticated, true);
  assert.equal(upgraded.data.user.password, undefined);
  assert.equal(upgraded.data.user.sessionExpires, undefined);
  assert.equal(upgraded.cookie, login.cookie);
  assert.equal(upgraded.setCookies.length, 1);
  assert.match(upgraded.setCookies[0], /Max-Age=2592000/);
  assert.ok(saved() > Date.now() + 29 * day);
  const renewedExpiry = saved();
  assert.deepEqual((await admin('/api/library')).setCookies, []);
  assert.equal(saved(), renewedExpiry);

  db.prepare('UPDATE user_sessions SET expires=? WHERE token=?').run(
    Date.now() + 28 * day,
    hash,
  );
  const active = await admin('/api/slides', 'POST', slide);
  assert.equal(active.status, 201);
  assert.equal(active.cookie, login.cookie);
  assert.match(active.setCookies[0], /Max-Age=2592000/);
  assert.ok(saved() > Date.now() + 29 * day);

  db.prepare('UPDATE user_sessions SET expires=? WHERE token=?').run(
    Date.now() - 1,
    hash,
  );
  const expired = await admin('/api/auth');
  assert.equal(expired.data.authenticated, false);
  assert.deepEqual(expired.setCookies, []);
  assert.equal((await admin('/api/library')).status, 401);
  assert.ok(saved() < Date.now());
});

void test('logout revokes a session due for renewal without issuing a fresh cookie', async (t) => {
  const { admin, db } = await fixture(t);
  const { cookie } = await admin('/api/auth');
  db.prepare('UPDATE user_sessions SET expires=?').run(Date.now() + 86400000);
  const logout = await admin('/api/logout/', 'POST');
  assert.equal(logout.status, 200);
  assert.equal(logout.setCookies.length, 1);
  assert.match(logout.setCookies[0], /openframe_session=;/);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,
    0,
  );
  const revoked = await admin('/api/auth', 'GET', undefined, { cookie });
  assert.equal(revoked.data.authenticated, false);
  assert.deepEqual(revoked.setCookies, []);
});

void test('secure session cookies retain their protection when renewed', async (t) => {
  const previous = process.env.COOKIE_SECURE;
  process.env.COOKIE_SECURE = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = previous;
  });
  const { admin, db } = await fixture(t);
  const login = await admin('/api/login', 'POST', { password });
  assert.match(login.setCookies[0], /; Secure;/);
  db.prepare('UPDATE user_sessions SET expires=?').run(Date.now() + 86400000);
  const renewed = await admin('/api/auth');
  assert.equal(renewed.data.authenticated, true);
  assert.match(renewed.setCookies[0], /; Secure;/);
  assert.match(renewed.setCookies[0], /HttpOnly/);
  assert.match(renewed.setCookies[0], /SameSite=Strict/);
});

void test('users are isolated, invitations are single-use and passwords revoke other sessions', async (t) => {
  const { admin, user, client, db } = await fixture(t);
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
  db.prepare('UPDATE user_sessions SET expires=? WHERE userId=?').run(
    Date.now() + 86400000,
    alice.user.id,
  );
  const changed = await alice.call('/api/account/password', 'POST', {
    currentPassword: password,
    password: 'new-password-long-enough',
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.setCookies.length, 1);
  assert.match(changed.setCookies[0], /Max-Age=2592000/);
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
