import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';
import { createAccounts, hashPassword } from '../server/accounts.mjs';

void test('deleting users is admin-only, preserves content and removes identities, grants and keys', async (t) => {
  const { admin, user, db, client } = await fixture(t);
  const person = await user('delete-member');
  const other = await user('delete-other');
  const adminId = (await admin('/api/auth')).data.user.id;
  const owned = (await person.call('/api/slides', 'POST', slide)).data;
  const shared = (await admin('/api/slides', 'POST', slide)).data;
  await admin(`/api/access/slide/${shared.id}`, 'POST', {
    userId: person.user.id,
    permission: 'edit',
  });
  const group = (await admin('/api/groups', 'POST', { name: 'Deletion group' }))
    .data;
  await admin(`/api/groups/${group.id}/members/${person.user.id}`, 'PUT', {
    role: 'admin',
  });
  const feed = (
    await admin('/api/data-feeds', 'POST', {
      name: 'Deletion feed',
      fields: [{ key: 'value', type: 'number' }],
    })
  ).data;
  const key = (
    await admin(`/api/data-feeds/${feed.id}/tokens`, 'POST', {
      name: 'Legacy key',
    })
  ).data;
  db.prepare('UPDATE data_feed_tokens SET creatorId=? WHERE id=?').run(
    person.user.id,
    key.id,
  );
  const invitation = (
    await admin(`/api/users/${person.user.id}/invitation`, 'POST')
  ).data.invitation;
  assert.equal(
    (await other.call(`/api/users/${person.user.id}`, 'DELETE')).status,
    403,
  );
  assert.equal((await admin(`/api/users/${adminId}`, 'DELETE')).status, 409);
  assert.equal(
    (await admin(`/api/users/${person.user.id}`, 'DELETE')).status,
    409,
  );
  assert.ok(db.prepare('SELECT id FROM users WHERE id=?').get(person.user.id));
  await admin(`/api/groups/${group.id}/members/${other.user.id}`, 'PUT', {
    role: 'admin',
  });
  assert.equal(
    (await admin(`/api/users/${person.user.id}`, 'DELETE')).status,
    200,
  );
  assert.equal((await person.call('/api/library')).status, 401);
  assert.equal(
    (await admin('/api/users')).data.some(
      (entry) => entry.id === person.user.id,
    ),
    false,
  );
  for (const table of [
    'memberships',
    'user_sessions',
    'invitations',
    'resource_grants',
    'resource_permissions',
  ])
    assert.equal(
      db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE userId=?`)
        .get(person.user.id).n,
      0,
    );
  assert.equal(
    db
      .prepare(
        "SELECT ownerId FROM resource_access WHERE kind='slide' AND id=?",
      )
      .get(owned.id).ownerId,
    adminId,
  );
  assert.ok(
    (await admin('/api/library')).data.slides.some(
      (entry) => entry.id === owned.id,
    ),
  );
  assert.ok(
    db.prepare('SELECT revokedAt FROM data_feed_tokens WHERE id=?').get(key.id)
      .revokedAt,
  );
  const anonymous = client();
  assert.equal(
    (
      await anonymous('/api/activate', 'POST', {
        token: invitation,
        password: 'deletion-test-password',
      })
    ).status,
    400,
  );
  await admin(`/api/users/${other.user.id}`, 'PATCH', { role: 'admin' });
  assert.equal(
    (await other.call(`/api/users/${other.user.id}`, 'DELETE')).status,
    400,
  );
  assert.equal(
    (await admin(`/api/users/${person.user.id}`, 'DELETE')).status,
    404,
  );
});

const password = 'test-password-long-enough';
const slide = {
  name: 'Private slide',
  width: 1920,
  height: 1080,
  background: '#ffffff',
  layers: [],
};

void test('publishing shared view-only starter text cleans the publication without editing another owner’s slide', async (t) => {
  const { admin, user } = await fixture(t);
  const publisher = await user('starter-publisher');
  const source = (
    await admin('/api/slides', 'POST', {
      ...slide,
      layers: [
        {
          id: randomUUID(),
          type: 'text',
          x: 10,
          y: 10,
          width: 80,
          height: 40,
          text: 'Something worth\nsharing.',
          starterText: true,
        },
      ],
    })
  ).data;
  await admin(`/api/access/slide/${source.id}`, 'POST', {
    userId: publisher.user.id,
    permission: 'view',
  });
  const playlist = (
    await publisher.call('/api/playlists', 'POST', {
      name: 'Shared starter',
      items: [{ slideId: source.id, duration: 10 }],
    })
  ).data;
  assert.equal(
    (await publisher.call(`/api/playlists/${playlist.id}/publish`, 'POST'))
      .status,
    200,
  );
  assert.equal(
    (await publisher.call(`/api/preview/${playlist.id}?version=published`)).data
      .items[0].slide.layers.length,
    0,
  );
  const original = (await admin('/api/library')).data.slides.find(
    (s) => s.id === source.id,
  );
  assert.equal(original.layers.length, 1);
  assert.equal(original.layers[0].starterText, true);
  await admin(`/api/slides/${source.id}`, 'PUT', {
    ...original,
    background: '#202923',
  });
  assert.equal(
    (await publisher.call(`/api/preview/${playlist.id}?version=published`)).data
      .items[0].slide.layers.length,
    0,
  );
});

void test('library filter metadata exposes only accessible resources and visible groups', async (t) => {
  const { admin, user } = await fixture(t);
  const alice = await user('filter-alice');
  const parent = (await admin('/api/groups', 'POST', { name: 'Region' })).data;
  const child = (
    await admin('/api/groups', 'POST', { name: 'Store', parentId: parent.id })
  ).data;
  const hidden = (
    await admin('/api/groups', 'POST', { name: 'Private region' })
  ).data;
  await admin(`/api/groups/${parent.id}/members/${alice.user.id}`, 'PUT', {
    role: 'member',
  });
  const shared = (await admin('/api/slides', 'POST', slide)).data;
  const privateSlide = (
    await admin('/api/slides', 'POST', { ...slide, name: 'Hidden slide' })
  ).data;
  await admin(`/api/access/slide/${shared.id}`, 'POST', { groupId: child.id });
  await admin(`/api/access/slide/${shared.id}`, 'POST', { groupId: hidden.id });
  await admin(`/api/access/slide/${privateSlide.id}`, 'POST', {
    groupId: hidden.id,
  });
  const library = (await alice.call('/api/library')).data;
  assert.deepEqual(
    new Set(library.groups.map((g) => g.id)),
    new Set([parent.id, child.id]),
  );
  assert.equal(library.slides.length, 1);
  assert.equal(library.slides[0].id, shared.id);
  assert.deepEqual(library.slides[0].groupIds, [child.id]);
  assert.ok(!JSON.stringify(library).includes(hidden.id));
  const published = (
    await admin('/api/playlists', 'POST', {
      name: 'Live summary',
      items: [{ slideId: privateSlide.id, duration: 15 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${published.id}/publish`, 'POST')).status,
    200,
  );
  const adminLibrary = (await admin('/api/library')).data;
  assert.deepEqual(
    adminLibrary.playlists.find((p) => p.id === published.id).publishedSlideIds,
    [privateSlide.id],
  );
  assert.deepEqual(
    new Set(adminLibrary.slides.find((s) => s.id === shared.id).groupIds),
    new Set([child.id, hidden.id]),
  );
});

void test('existing group tables gain a nullable parent without losing groups', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO groups VALUES ('legacy-root', 'Legacy root');
  `);
  createAccounts(db);
  const columns = db.prepare('PRAGMA table_info(groups)').all();
  assert.ok(columns.some((column) => column.name === 'parentId'));
  assert.equal(
    db.prepare('SELECT parentId FROM groups WHERE id=?').get('legacy-root')
      .parentId,
    null,
  );
  db.close();
});
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

async function uploadImage(call) {
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
    'private.png',
  );
  const result = await call('/api/assets', 'POST', form);
  assert.equal(result.status, 201);
  return result.data;
}

void test('non-image references cannot authorize private media, including legacy records', async (t) => {
  const { admin, user, db } = await fixture(t);
  const outsider = await user('outsider');
  const asset = await uploadImage(admin);
  const layer = {
    id: randomUUID(),
    type: 'text',
    assetId: asset.id,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  };
  for (const type of ['text', 'clock']) {
    assert.equal(
      (
        await outsider.call('/api/slides', 'POST', {
          ...slide,
          layers: [{ ...layer, type }],
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await outsider.call('/api/slides', 'POST', {
        ...slide,
        layers: [{ ...layer, type: 'image' }],
      })
    ).status,
    404,
  );
  const owned = (await outsider.call('/api/slides', 'POST', slide)).data;
  db.prepare("UPDATE records SET body=? WHERE kind='slide' AND id=?").run(
    JSON.stringify({ ...owned, layers: [layer] }),
    owned.id,
  );
  assert.equal((await outsider.call(asset.url)).status, 404);
  assert.equal((await outsider.call('/api/library')).data.assets.length, 0);
});

void test('published media is read-only for shared playlists and screens until their access is removed', async (t) => {
  const { admin, user, client } = await fixture(t);
  const recipient = await user('recipient');
  const outsider = await user('outsider');
  const asset = await uploadImage(admin);
  const item = (
    await admin('/api/slides', 'POST', {
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
    })
  ).data;
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Published',
      items: [{ slideId: item.id, duration: 10 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  const group = (await admin('/api/groups', 'POST', { name: 'Viewers' })).data;
  await admin(`/api/groups/${group.id}/members/${recipient.user.id}`, 'PUT', {
    role: 'admin',
  });
  for (const target of [{ userId: recipient.user.id }, { groupId: group.id }]) {
    assert.equal(
      (await admin(`/api/access/playlist/${playlist.id}`, 'POST', target))
        .status,
      200,
    );
    const visible = (await recipient.call('/api/library')).data.assets.find(
      (a) => a.id === asset.id,
    );
    assert.equal(visible.readOnly, true);
    assert.equal((await recipient.call(asset.url)).status, 200);
    assert.equal((await outsider.call(asset.url)).status, 404);
    assert.equal(
      (
        await recipient.call(`/api/assets/${asset.id}`, 'PATCH', {
          name: 'Changed',
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await recipient.call('/api/assets/batch', 'POST', {
          ids: [asset.id],
          addTags: ['changed'],
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await admin(`/api/access/playlist/${playlist.id}`, 'POST', {
          ...target,
          remove: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await admin(`/api/access/slide/${item.id}`, 'POST', {
          ...target,
          remove: true,
        })
      ).status,
      200,
    );
    assert.equal((await recipient.call(asset.url)).status, 404);
  }
  const device = (
    await client()('/api/player/enroll', 'POST', { name: 'Screen' })
  ).data;
  await admin(`/api/devices/${device.id}/approve`, 'POST', {
    code: device.code,
  });
  await admin(`/api/devices/${device.id}`, 'PUT', {
    name: 'Screen',
    playlistId: playlist.id,
    rotation: 0,
    blank: false,
  });
  assert.equal(
    (
      await admin(`/api/access/device/${device.id}`, 'POST', {
        userId: recipient.user.id,
      })
    ).status,
    200,
  );
  assert.equal((await recipient.call(asset.url)).status, 200);
  await admin(`/api/access/device/${device.id}`, 'POST', {
    userId: recipient.user.id,
    remove: true,
  });
  // Parent grants leave slide access intact until its separate grant is removed.
  assert.equal((await recipient.call(asset.url)).status, 200);
  await admin(`/api/access/playlist/${playlist.id}`, 'POST', {
    userId: recipient.user.id,
    remove: true,
  });
  assert.equal((await recipient.call(asset.url)).status, 200);
  await admin(`/api/access/slide/${item.id}`, 'POST', {
    userId: recipient.user.id,
    remove: true,
  });
  assert.equal((await recipient.call(asset.url)).status, 404);
  await admin(`/api/access/device/${device.id}`, 'POST', {
    userId: recipient.user.id,
  });
  await admin(`/api/access/playlist/${playlist.id}`, 'POST', {
    userId: recipient.user.id,
    remove: true,
  });
  assert.equal((await recipient.call(asset.url)).status, 200);
  await admin(`/api/access/device/${device.id}`, 'POST', {
    userId: recipient.user.id,
    remove: true,
  });
  assert.equal((await recipient.call(asset.url)).status, 200);
  await admin(`/api/access/slide/${item.id}`, 'POST', {
    userId: recipient.user.id,
    remove: true,
  });
  assert.equal((await recipient.call(asset.url)).status, 404);
});

void test('password changes enforce eight characters and shorter valid credentials can log in', async (t) => {
  const { admin } = await fixture(t);
  assert.equal(
    (
      await admin('/api/account/password', 'POST', {
        currentPassword: password,
        password: 'short77',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await admin('/api/account/password', 'POST', {
        currentPassword: password,
        password: 'valid888',
      })
    ).status,
    200,
  );
  await admin('/api/logout', 'POST');
  assert.equal(
    (
      await admin('/api/login', 'POST', {
        username: 'admin',
        password: 'valid888',
      })
    ).status,
    200,
  );
});

void test('collaborators cannot add dependencies the resource owner cannot access', async (t) => {
  const { admin, user } = await fixture(t);
  const owner = await user('owner');
  const collaborator = await user('collaborator');
  const original = (await owner.call('/api/slides', 'POST', slide)).data;
  const privateSlide = (await collaborator.call('/api/slides', 'POST', slide))
    .data;
  const playlist = (
    await owner.call('/api/playlists', 'POST', {
      name: 'Owned',
      items: [{ slideId: original.id, duration: 10 }],
    })
  ).data;
  await admin(`/api/access/playlist/${playlist.id}`, 'POST', {
    userId: collaborator.user.id,
    permission: 'edit',
  });
  assert.equal(
    (
      await collaborator.call(`/api/playlists/${playlist.id}`, 'PUT', {
        name: 'Changed',
        items: [{ slideId: privateSlide.id, duration: 10 }],
      })
    ).status,
    409,
  );
  assert.equal((await owner.call(`/api/preview/${playlist.id}`)).status, 200);
  assert.equal(
    (await owner.call(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  assert.equal(
    (
      await admin(`/api/access/slide/${privateSlide.id}`, 'POST', {
        userId: owner.user.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await collaborator.call(`/api/playlists/${playlist.id}`, 'PUT', {
        name: 'Shared',
        items: [{ slideId: privateSlide.id, duration: 10 }],
      })
    ).status,
    200,
  );
  assert.equal((await owner.call(`/api/preview/${playlist.id}`)).status, 200);
});

void test('login aliases share the same attempt budget', async (t) => {
  const { client } = await fixture(t);
  const call = client();
  const routes = ['/api/login', '/API/LOGIN', '/api/login/', '/Api/Login'];
  for (let i = 0; i < 15; i++) {
    assert.equal(
      (
        await call(routes[i % routes.length], 'POST', {
          username: 'admin',
          password: 'incorrect-password',
        })
      ).status,
      401,
    );
  }
  for (const route of routes) {
    assert.equal(
      (await call(route, 'POST', { username: 'admin', password })).status,
      429,
    );
  }
});

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
  const group = (await admin('/api/groups', 'POST', { name: 'Lobby team' }))
    .data;
  await admin(`/api/groups/${group.id}/members/${alice.user.id}`, 'PUT', {
    role: 'admin',
  });
  const item = (await alice.call('/api/slides', 'POST', slide)).data;
  assert.equal(
    (
      await alice.call(`/api/access/slide/${item.id}`, 'POST', {
        groupId: group.id,
        permission: 'edit',
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

void test('child membership views parent content without gaining edit access', async (t) => {
  const { admin, user } = await fixture(t);
  const alice = await user('alice');
  const bob = await user('bob');
  const outsider = await user('outsider');
  const parent = (await admin('/api/groups', 'POST', { name: 'Company' })).data;
  await admin(`/api/groups/${parent.id}/members/${alice.user.id}`, 'PUT', {
    role: 'admin',
  });
  const child = (
    await admin('/api/groups', 'POST', {
      name: 'Warehouse',
      parentId: parent.id,
    })
  ).data;
  assert.equal(child.parentId, parent.id);
  assert.equal(
    (
      await outsider.call('/api/groups', 'POST', {
        name: 'Unauthorized subgroup',
        parentId: parent.id,
      })
    ).status,
    403,
  );
  const parentSlide = (await alice.call('/api/slides', 'POST', slide)).data;
  const childSlide = (await alice.call('/api/slides', 'POST', slide)).data;
  assert.equal(
    (
      await alice.call(`/api/access/slide/${parentSlide.id}`, 'POST', {
        groupId: parent.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await alice.call(`/api/access/slide/${childSlide.id}`, 'POST', {
        groupId: child.id,
      })
    ).status,
    200,
  );
  const invite = (
    await alice.call(`/api/groups/${child.id}/invitation`, 'POST')
  ).data.invitation;
  assert.equal(
    (await bob.call('/api/groups/join', 'POST', { token: invite })).status,
    200,
  );
  const visible = (await bob.call('/api/library')).data.slides;
  assert.deepEqual(
    visible.map((item) => item.id),
    [childSlide.id, parentSlide.id],
  );
  assert.ok(visible.every((item) => item.readOnly));
  assert.equal(
    (await bob.call(`/api/slides/${parentSlide.id}`, 'PUT', slide)).status,
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
  assert.equal(user.role, 'admin');
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

void test('parent access reaches descendants, shared images, and screens and follows group moves', async (t) => {
  const { admin, user, client, db } = await fixture(t);
  const parentMember = await user('parent-member');
  const childMember = await user('child-member');
  const outsider = await user('outsider');
  const parent = (await admin('/api/groups', 'POST', { name: 'A' })).data;
  const other = (await admin('/api/groups', 'POST', { name: 'Other' })).data;
  const children = [];
  for (const name of ['1', '2', '3'])
    children.push(
      (await admin('/api/groups', 'POST', { name, parentId: parent.id })).data,
    );
  const deep = (
    await admin('/api/groups', 'POST', {
      name: 'Deep',
      parentId: children[0].id,
    })
  ).data;
  await admin(
    `/api/groups/${parent.id}/members/${parentMember.user.id}`,
    'PUT',
    { role: 'member' },
  );
  await admin(
    `/api/groups/${children[0].id}/members/${childMember.user.id}`,
    'PUT',
    { role: 'member' },
  );
  const items = [];
  for (const group of [parent, ...children, deep, other]) {
    const item = (
      await admin('/api/slides', 'POST', { ...slide, name: group.name })
    ).data;
    await admin(`/api/access/slide/${item.id}`, 'POST', { groupId: group.id });
    items.push(item);
  }
  assert.equal((await parentMember.call('/api/groups')).data.length, 5);
  assert.equal((await parentMember.call('/api/library')).data.slides.length, 5);
  assert.equal((await childMember.call('/api/library')).data.slides.length, 3);
  assert.equal((await outsider.call('/api/library')).data.slides.length, 0);
  assert.equal(
    (await childMember.call(`/api/slides/${items[0].id}`, 'PUT', slide)).status,
    403,
  );
  assert.equal(
    (await parentMember.call(`/api/slides/${items[4].id}`, 'PUT', slide))
      .status,
    403,
  );
  // Group context and dependency validation use the same inherited access.
  const playlist = await parentMember.call(
    '/api/playlists',
    'POST',
    {
      name: 'Inherited playlist',
      items: [{ slideId: items[4].id, duration: 10 }],
      loop: true,
    },
    { 'X-OpenFrame-Group': parent.id },
  );
  assert.equal(playlist.status, 409); // The other subgroups cannot see this slide.
  const asset = await uploadImage(admin);
  const imageSlide = (
    await admin('/api/slides', 'POST', {
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
    })
  ).data;
  await admin(`/api/access/slide/${imageSlide.id}`, 'POST', {
    groupId: deep.id,
  });
  assert.equal((await parentMember.call(asset.url)).status, 200);
  assert.equal(
    (await parentMember.call('/api/library')).data.assets[0].readOnly,
    true,
  );
  assert.equal(
    (
      await parentMember.call(`/api/assets/${asset.id}`, 'PATCH', {
        name: 'Denied',
      })
    ).status,
    404,
  );
  const screen = (
    await client()('/api/player/enroll', 'POST', { name: 'Nested screen' })
  ).data;
  await admin(`/api/devices/${screen.id}/approve`, 'POST', {
    code: screen.code,
  });
  await admin(`/api/access/device/${screen.id}`, 'POST', { groupId: deep.id });
  assert.equal(
    (await parentMember.call('/api/library')).data.devices.length,
    1,
  );
  assert.equal(
    (await outsider.call(`/api/devices/${screen.id}/recovery`)).status,
    404,
  );
  assert.equal(
    (await admin(`/api/groups/${parent.id}`, 'PATCH', { parentId: deep.id }))
      .status,
    400,
  );
  assert.equal(
    (
      await outsider.call(`/api/groups/${deep.id}`, 'PATCH', {
        parentId: other.id,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await admin(`/api/groups/${children[0].id}`, 'PATCH', {
        parentId: other.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (await parentMember.call(`/api/slides/${items[4].id}`, 'PUT', slide))
      .status,
    404,
  );
  assert.equal((await parentMember.call(asset.url)).status, 404);
  assert.equal(
    (await parentMember.call('/api/library')).data.devices.length,
    0,
  );
  assert.equal(
    (await childMember.call('/api/library')).data.slides.some(
      (item) => item.id === items[4].id,
    ),
    true,
  );
  assert.equal(
    (await admin(`/api/groups/${children[0].id}`, 'PATCH', { parentId: null }))
      .status,
    200,
  );
  assert.equal(
    db.prepare('SELECT parentId FROM groups WHERE id=?').get(children[0].id)
      .parentId,
    null,
  );
});

void test('admins manage existing memberships, account roles, and user access without escalation by users', async (t) => {
  const { admin, user } = await fixture(t);
  const alice = await user('alice');
  const bob = await user('bob');
  const group = (await admin('/api/groups', 'POST', { name: 'Team' })).data;
  await admin(`/api/groups/${group.id}/members/${alice.user.id}`, 'PUT', {
    role: 'admin',
  });
  assert.equal(
    (
      await alice.call(
        `/api/groups/${group.id}/members/${bob.user.id}`,
        'PUT',
        { role: 'member' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await admin(`/api/groups/${group.id}/members/${bob.user.id}`, 'PUT', {
        role: 'member',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await admin(`/api/groups/${group.id}/members/${randomUUID()}`, 'PUT', {
        role: 'member',
      })
    ).status,
    404,
  );
  assert.equal(
    (await bob.call(`/api/users/${alice.user.id}`, 'PATCH', { role: 'admin' }))
      .status,
    403,
  );
  assert.equal(
    (await bob.call(`/api/users/${alice.user.id}/access`)).status,
    403,
  );
  assert.equal(
    (
      await admin(`/api/users/${alice.user.id}`, 'PATCH', {
        role: 'superadmin',
      })
    ).status,
    400,
  );
  assert.equal(
    (await admin(`/api/users/${bob.user.id}`, 'PATCH', { role: 'admin' }))
      .status,
    200,
  );
  assert.equal((await bob.call('/api/auth')).data.user.role, 'admin');
  assert.equal((await bob.call('/api/users')).status, 200);
  const item = (await admin('/api/slides', 'POST', slide)).data;
  await admin(`/api/access/slide/${item.id}`, 'POST', { groupId: group.id });
  let overview = (await admin(`/api/users/${alice.user.id}/access`)).data.find(
    (entry) => entry.id === item.id,
  );
  assert.equal(overview.direct, false);
  assert.equal(overview.effective, true);
  assert.deepEqual(overview.viaGroups, ['Team']);
  await admin(`/api/access/slide/${item.id}`, 'POST', {
    userId: alice.user.id,
  });
  overview = (await admin(`/api/users/${alice.user.id}/access`)).data.find(
    (entry) => entry.id === item.id,
  );
  assert.equal(overview.direct, true);
  await admin(`/api/access/slide/${item.id}`, 'POST', {
    userId: alice.user.id,
    remove: true,
  });
  assert.equal((await alice.call('/api/library')).data.slides.length, 1);
  assert.equal(
    (await bob.call(`/api/users/${bob.user.id}`, 'PATCH', { role: 'user' }))
      .status,
    400,
  );
  assert.equal(
    (await bob.call(`/api/users/${bob.user.id}`, 'PATCH', { disabled: true }))
      .status,
    400,
  );
  assert.equal(
    (await admin(`/api/users/${bob.user.id}`, 'PATCH', { role: 'user' }))
      .status,
    200,
  );
  assert.equal((await bob.call('/api/users')).status, 403);
  assert.equal((await bob.call('/api/library')).data.slides.length, 1);
});

void test('existing superadmin identities migrate to admin without changing credentials or sessions', async (t) => {
  const { db, admin } = await fixture(t);
  db.prepare("UPDATE users SET role='superadmin',username='superadmin'").run();
  const before = db.prepare('SELECT * FROM users').get();
  const savedSession = db.prepare('SELECT * FROM user_sessions').get();
  createAccounts(db);
  const after = db.prepare('SELECT * FROM users').get();
  assert.equal(after.role, 'admin');
  assert.equal(after.username, 'superadmin');
  assert.equal(after.password, before.password);
  assert.deepEqual(
    db.prepare('SELECT * FROM user_sessions').get(),
    savedSession,
  );
  assert.equal((await admin('/api/users')).status, 200);
});

void test('admin folder moves reject cycles and preserve descendants and grants', async (t) => {
  const { admin, user, db } = await fixture(t);
  const alice = await user('alice');
  const parent = (await admin('/api/folders', 'POST', { name: 'Parent' })).data;
  const hidden = (
    await admin('/api/folders', 'POST', { name: 'Hidden', parentId: parent.id })
  ).data;
  const deep = (
    await admin('/api/folders', 'POST', { name: 'Deep', parentId: hidden.id })
  ).data;
  await admin(`/api/access/folder/${deep.id}`, 'POST', {
    userId: alice.user.id,
  });
  assert.equal(
    (
      await admin(`/api/folders/${parent.id}`, 'PUT', {
        name: parent.name,
        parentId: deep.id,
      })
    ).status,
    400,
  );
  assert.equal(
    (await admin(`/api/folders/${parent.id}`, 'DELETE')).status,
    409,
  );
  const other = (await admin('/api/folders', 'POST', { name: 'Other' })).data;
  assert.equal(
    (
      await admin(`/api/folders/${parent.id}`, 'PUT', {
        name: parent.name,
        parentId: other.id,
      })
    ).status,
    200,
  );
  const saved = db
    .prepare("SELECT * FROM resource_grants WHERE kind='folder' AND id=?")
    .all(deep.id);
  assert.equal(
    (
      await admin(`/api/folders/${parent.id}`, 'PUT', {
        name: parent.name,
        parentId: other.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (await admin('/api/library')).data.folders.find((f) => f.id === deep.id)
      .parentId,
    hidden.id,
  );
  assert.deepEqual(
    db
      .prepare("SELECT * FROM resource_grants WHERE kind='folder' AND id=?")
      .all(deep.id),
    saved,
  );
});

void test('migration preserves separate existing admin and superadmin accounts, passwords, ownership, and sessions', async (t) => {
  const { db, admin, user } = await fixture(t);
  const second = await user('superadmin');
  db.prepare("UPDATE users SET role='superadmin' WHERE id=?").run(
    second.user.id,
  );
  const before = db.prepare('SELECT * FROM users ORDER BY id').all();
  const sessions = db
    .prepare('SELECT * FROM user_sessions ORDER BY token')
    .all();
  const item = (await admin('/api/slides', 'POST', slide)).data;
  const owner = db
    .prepare("SELECT * FROM resource_access WHERE kind='slide' AND id=?")
    .get(item.id);
  createAccounts(db);
  const after = db.prepare('SELECT * FROM users ORDER BY id').all();
  assert.equal(after.length, 2);
  assert.deepEqual(
    after.map((entry) => ({ ...entry })),
    before.map((entry) => ({ ...entry, role: 'admin' })),
  );
  assert.deepEqual(
    db.prepare('SELECT * FROM user_sessions ORDER BY token').all(),
    sessions,
  );
  assert.deepEqual(
    db
      .prepare("SELECT * FROM resource_access WHERE kind='slide' AND id=?")
      .get(item.id),
    owner,
  );
  assert.equal((await admin('/api/users')).status, 200);
  assert.equal((await second.call('/api/users')).status, 200);
});
void test('group moves require a global admin even when the caller manages the group', async (t) => {
  const { admin, user } = await fixture(t);
  const manager = await user('manager');
  const parent = (await admin('/api/groups', 'POST', { name: 'Parent' })).data;
  const child = (await admin('/api/groups', 'POST', { name: 'Child' })).data;
  for (const group of [parent, child])
    await admin(`/api/groups/${group.id}/members/${manager.user.id}`, 'PUT', {
      role: 'admin',
    });
  assert.equal(
    (
      await manager.call(`/api/groups/${child.id}`, 'PATCH', {
        parentId: parent.id,
      })
    ).status,
    403,
  );
});

void test('only global admins create groups; admin group access is implicit and irrevocable', async (t) => {
  const { admin, user } = await fixture(t);
  const manager = await user('group-manager');
  assert.equal(
    (await manager.call('/api/groups', 'POST', { name: 'Forbidden root' }))
      .status,
    403,
  );
  const root = (await admin('/api/groups', 'POST', { name: 'Root' })).data;
  const child = (
    await admin('/api/groups', 'POST', { name: 'Child', parentId: root.id })
  ).data;
  await admin(`/api/groups/${root.id}/members/${manager.user.id}`, 'PUT', {
    role: 'admin',
  });
  assert.equal(
    (
      await manager.call('/api/groups', 'POST', {
        name: 'Forbidden child',
        parentId: root.id,
      })
    ).status,
    403,
  );
  await admin(`/api/users/${manager.user.id}`, 'PATCH', { role: 'admin' });
  const backup = await user('backup-group-admin');
  await admin(`/api/groups/${root.id}/members/${backup.user.id}`, 'PUT', {
    role: 'admin',
  });
  for (const group of (await admin('/api/groups')).data) {
    const membership = group.members.find(
      (person) => person.id === manager.user.id,
    );
    assert.equal(membership.role, 'admin');
    assert.equal(membership.accountRole, 'admin');
    for (const role of ['member', 'remove'])
      assert.equal(
        (
          await admin(
            `/api/groups/${group.id}/members/${manager.user.id}`,
            'PUT',
            { role },
          )
        ).status,
        200,
      );
    const stillImplicit = (await admin('/api/groups')).data
      .find((item) => item.id === group.id)
      .members.find((person) => person.id === manager.user.id);
    assert.equal(stillImplicit.role, 'admin');
    assert.equal(stillImplicit.directRole, null);
  }
  const privateItem = (await admin('/api/slides', 'POST', slide)).data;
  assert.equal(
    (await manager.call('/api/library')).data.slides.some(
      (item) => item.id === privateItem.id,
    ),
    true,
  );
  await admin(`/api/access/slide/${privateItem.id}`, 'POST', {
    userId: manager.user.id,
    remove: true,
  });
  const effective = (
    await admin(`/api/users/${manager.user.id}/access`)
  ).data.find((item) => item.id === privateItem.id);
  assert.equal(effective.direct, false);
  assert.equal(effective.effective, true);
  // Demotion removes implicit group administration without creating a membership.
  await admin(`/api/users/${manager.user.id}`, 'PATCH', { role: 'user' });
  assert.equal(
    (await admin('/api/groups')).data
      .find((group) => group.id === child.id)
      .members.some((person) => person.id === manager.user.id),
    false,
  );
});

void test('library access tags include groups and users granted access outside those groups', async (t) => {
  const { admin, user } = await fixture(t);
  const member = await user('tag-member');
  const direct = await user('tag-direct');
  const parent = (await admin('/api/groups', 'POST', { name: 'Region' })).data;
  const child = (
    await admin('/api/groups', 'POST', { name: 'Store', parentId: parent.id })
  ).data;
  await admin(`/api/groups/${parent.id}/members/${member.user.id}`, 'PUT', {
    role: 'member',
  });
  const item = (await admin('/api/slides', 'POST', slide)).data;
  for (const grant of [
    { groupId: child.id },
    { userId: member.user.id },
    { userId: direct.user.id },
  ]) {
    assert.equal(
      (await admin(`/api/access/slide/${item.id}`, 'POST', grant)).status,
      200,
    );
  }
  const tags = (await admin('/api/library')).data.slides.find(
    (entry) => entry.id === item.id,
  ).accessTags;
  assert.deepEqual(
    tags.map((tag) => tag.id),
    [child.id, direct.user.id],
  );
  assert.equal(tags[0].type, 'group');
  assert.equal(tags[1].username, 'tag-direct');
  assert.equal(tags[1].type, 'user');
  assert.ok(!JSON.stringify(tags).includes('password'));
  assert.equal(
    (await direct.call('/api/library')).data.slides[0].accessTags.some(
      (tag) => tag.id === child.id,
    ),
    false,
  );
});

void test('admin-created users receive unique 12-character passwords and can sign in immediately', async (t) => {
  const { admin, client, db } = await fixture(t);
  const created = await admin('/api/users', 'POST', {
    username: 'generated-user',
    name: 'Generated User',
    role: 'admin',
    password: 'caller-password-is-ignored',
  });
  assert.equal(created.status, 201);
  assert.match(created.data.password, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(created.data.user.role, 'user');
  assert.equal('password' in created.data.user, false);
  assert.notEqual(
    db
      .prepare('SELECT password FROM users WHERE id=?')
      .get(created.data.user.id).password,
    created.data.password,
  );
  const other = await admin('/api/users', 'POST', {
    username: 'generated-other',
    name: 'Other User',
  });
  assert.match(other.data.password, /^[A-Za-z0-9_-]{12}$/);
  assert.notEqual(other.data.password, created.data.password);
  const signedIn = client();
  assert.equal(
    (
      await signedIn('/api/login', 'POST', {
        username: created.data.user.username,
        password: created.data.password,
      })
    ).status,
    200,
  );
  assert.equal(
    (await signedIn('/api/auth')).data.user.id,
    created.data.user.id,
  );
  assert.equal('password' in (await signedIn('/api/auth')).data.user, false);
  assert.equal((await signedIn('/api/users')).status, 403);
  assert.equal(
    (
      await signedIn('/api/users', 'POST', {
        username: 'forbidden-user',
        name: 'Forbidden',
      })
    ).status,
    403,
  );
  const listed = (await admin('/api/users')).data;
  assert.ok(listed.every((person) => !('password' in person)));
  assert.ok(!JSON.stringify(listed).includes(created.data.password));
  assert.equal(
    (
      await signedIn('/api/account/password', 'POST', {
        currentPassword: created.data.password,
        password: 'my-new-personal-password',
      })
    ).status,
    200,
  );
  const afterChange = client();
  assert.equal(
    (
      await afterChange('/api/login', 'POST', {
        username: created.data.user.username,
        password: created.data.password,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await afterChange('/api/login', 'POST', {
        username: created.data.user.username,
        password: 'my-new-personal-password',
      })
    ).status,
    200,
  );
});

void test('managing groups edit directly while hierarchy access stays view-only', async (t) => {
  const { admin, user } = await fixture(t);
  const manager = await user('permission-manager');
  const viewer = await user('permission-viewer');
  const root = (await admin('/api/groups', 'POST', { name: 'Group A' })).data;
  const child = (
    await admin('/api/groups', 'POST', { name: 'Group B', parentId: root.id })
  ).data;
  await admin(`/api/groups/${root.id}/members/${manager.user.id}`, 'PUT', {
    role: 'member',
  });
  await admin(`/api/groups/${child.id}/members/${viewer.user.id}`, 'PUT', {
    role: 'member',
  });
  const asset = await uploadImage(admin);
  const item = (
    await admin('/api/slides', 'POST', {
      ...slide,
      managingGroupId: root.id,
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
    })
  ).data;
  const master = (
    await admin('/api/playlists', 'POST', {
      name: 'Master',
      managingGroupId: root.id,
      items: [{ slideId: item.id, duration: 10 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${master.id}/publish`, 'POST')).status,
    200,
  );
  let library = (await viewer.call('/api/library')).data;
  assert.equal(library.slides.find((s) => s.id === item.id).readOnly, true);
  assert.equal(
    library.playlists.find((p) => p.id === master.id).readOnly,
    true,
  );
  assert.equal(
    library.groups.find((g) => g.id === root.id).directMember,
    false,
  );
  assert.equal((await viewer.call(`/api/preview/${master.id}`)).status, 200);
  assert.equal(
    (
      await viewer.call(`/api/slides/${item.id}`, 'PUT', {
        ...item,
        name: 'Forbidden',
      })
    ).status,
    403,
  );
  assert.equal(
    (await viewer.call(`/api/slides/${item.id}`, 'DELETE')).status,
    403,
  );
  for (const [path, method, body] of [
    [`/api/playlists/${master.id}`, 'PUT', master],
    [`/api/playlists/${master.id}`, 'DELETE'],
    [`/api/playlists/${master.id}/publish`, 'POST'],
    [`/api/playlists/${master.id}/share-plan`, 'POST', master],
    [`/api/playlists/${master.id}/share-apply`, 'POST', []],
    [`/api/access/slide/${item.id}/management`, 'PUT', { groupId: child.id }],
    [
      `/api/organization/slides`,
      'POST',
      { ids: [item.id], addTags: ['forbidden'] },
    ],
  ])
    assert.equal((await viewer.call(path, method, body)).status, 403, path);
  assert.equal(
    (
      await manager.call(`/api/slides/${item.id}`, 'PUT', {
        ...item,
        name: 'Managed edit',
      })
    ).status,
    200,
  );
  await admin(`/api/access/slide/${item.id}`, 'POST', {
    userId: viewer.user.id,
    permission: 'edit',
  });
  library = (await viewer.call('/api/library')).data;
  const inheritedFork = (
    await viewer.call(`/api/playlists/${master.id}/fork`, 'POST', {
      name: 'Image fork',
      managingGroupId: child.id,
    })
  ).data;
  const sharingPlan = await viewer.call(
    `/api/playlists/${inheritedFork.id}/share-plan`,
    'POST',
    inheritedFork,
  );
  assert.equal(sharingPlan.status, 200);
  assert.deepEqual(sharingPlan.data, []);
  assert.equal(
    (await viewer.call('/api/library')).data.assets.find(
      (a) => a.id === asset.id,
    ).readOnly,
    true,
  );
  const originallyOwned = (await viewer.call('/api/slides', 'POST', slide))
    .data;
  await admin(`/api/access/slide/${originallyOwned.id}/management`, 'PUT', {
    groupId: root.id,
  });
  assert.equal(
    (
      await viewer.call(
        `/api/slides/${originallyOwned.id}`,
        'PUT',
        originallyOwned,
      )
    ).status,
    403,
  );
  assert.equal(
    (await viewer.call(`/api/access/slide/${originallyOwned.id}`)).data
      .canShare,
    false,
  );
  const granted = library.slides.find((s) => s.id === item.id);
  assert.equal(granted.readOnly, false);
  assert.equal(
    (
      await viewer.call(`/api/slides/${item.id}`, 'PUT', {
        ...granted,
        name: 'Explicit edit',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await viewer.call(`/api/access/slide/${item.id}/management`, 'PUT', {
        groupId: child.id,
      })
    ).status,
    403,
  );
  await admin(`/api/access/slide/${item.id}`, 'POST', {
    userId: viewer.user.id,
    permission: 'view',
  });
  assert.equal(
    (await viewer.call(`/api/slides/${item.id}`, 'PUT', granted)).status,
    403,
  );
  assert.equal(
    (
      await admin(`/api/slides/${item.id}`, 'PUT', {
        ...granted,
        name: 'Admin edit',
      })
    ).status,
    200,
  );
});

void test('published linked forks preserve local overrides and do not publish local drafts on master updates', async (t) => {
  const { admin, user, db } = await fixture(t);
  const localUser = await user('fork-editor');
  const root = (await admin('/api/groups', 'POST', { name: 'Master group' }))
    .data;
  const child = (
    await admin('/api/groups', 'POST', {
      name: 'Local group',
      parentId: root.id,
    })
  ).data;
  await admin(`/api/groups/${child.id}/members/${localUser.user.id}`, 'PUT', {
    role: 'member',
  });
  const slides = [];
  for (let i = 0; i < 3; i++)
    slides.push(
      (
        await admin('/api/slides', 'POST', {
          ...slide,
          name: `Master slide ${i}`,
          managingGroupId: root.id,
        })
      ).data,
    );
  let master = (
    await admin('/api/playlists', 'POST', {
      name: 'Master',
      managingGroupId: root.id,
      items: [
        { slideId: slides[0].id, duration: 10 },
        { slideId: slides[0].id, duration: 20 },
        { slideId: slides[1].id, duration: 30 },
      ],
    })
  ).data;
  await admin(`/api/playlists/${master.id}/publish`, 'POST');
  const local = (
    await localUser.call('/api/slides', 'POST', {
      ...slide,
      name: 'Local slide',
      managingGroupId: child.id,
    })
  ).data;
  const forkResponse = await localUser.call(
    `/api/playlists/${master.id}/fork`,
    'POST',
    { name: 'Local fork', managingGroupId: child.id },
  );
  assert.equal(forkResponse.status, 201, JSON.stringify(forkResponse.data));
  let fork = forkResponse.data;
  assert.equal(fork.tags.length, 0);
  assert.equal(fork.items.length, 3);
  assert.notEqual(fork.items[0].id, fork.items[1].id);
  const sourceIds = fork.items.map((i) => i.id);
  fork = {
    ...fork,
    fork: { ...fork.fork, order: 'custom', speed: 2 },
    items: [
      { id: randomUUID(), slideId: local.id, duration: 8 },
      fork.items[2],
      { ...fork.items[1], duration: 40, durationOverride: true },
      fork.items[0],
    ],
  };
  const saved = await localUser.call(`/api/playlists/${fork.id}`, 'PUT', fork);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  fork = saved.data;
  assert.equal(
    (await localUser.call(`/api/playlists/${fork.id}/publish`, 'POST')).status,
    200,
  );
  const record = (id) =>
    JSON.parse(
      db
        .prepare("SELECT body FROM records WHERE kind='playlist' AND id=?")
        .get(id).body,
    );
  assert.deepEqual(
    record(fork.id).published.items.map((i) => i.duration),
    [4, 15, 20, 5],
  );
  assert.deepEqual(
    record(master.id).published.items.map((i) => i.duration),
    [10, 20, 30],
  );
  const revision = record(fork.id).published.revision;
  const draft = {
    ...fork,
    name: 'Unpublished local name',
    transition: { type: 'fade', durationMs: 800 },
    items: fork.items.map((i) =>
      i.slideId === local.id ? { ...i, duration: 18 } : i,
    ),
  };
  assert.equal(
    (await localUser.call(`/api/playlists/${fork.id}`, 'PUT', draft)).status,
    200,
  );
  master = (
    await admin(`/api/playlists/${master.id}`, 'PUT', {
      ...master,
      items: [
        master.items[1],
        { slideId: slides[2].id, duration: 50 },
        master.items[0],
      ],
    })
  ).data;
  assert.equal(record(fork.id).published.revision, revision);
  assert.equal(
    (await admin(`/api/playlists/${master.id}/publish`, 'POST')).status,
    200,
  );
  const updated = record(fork.id);
  assert.notEqual(updated.published.revision, revision);
  assert.deepEqual(
    updated.published.items.map((i) => [i.slide.id, i.duration]),
    [
      [local.id, 4],
      [slides[0].id, 20],
      [slides[0].id, 5],
      [slides[2].id, 25],
    ],
  );
  assert.equal(updated.items.find((i) => i.slideId === local.id).duration, 18);
  assert.deepEqual(
    updated.publishedEntries.slice(1, 3).map((i) => i.id),
    [sourceIds[1], sourceIds[0]],
  );
  assert.ok(updated.published.items.every((i) => !('sourceEntryId' in i)));
  assert.equal(updated.published.schemaVersion, 2);
  assert.equal(
    (await admin(`/api/playlists/${master.id}`, 'DELETE')).status,
    409,
  );
  assert.equal(
    (
      await localUser.call(`/api/playlists/${fork.id}`, 'PUT', {
        ...draft,
        items: [{ ...draft.items[0], id: sourceIds[0] }],
      })
    ).status,
    400,
  );
});

void test('folders and tags keep access unchanged and bulk updates reject inherited items atomically', async (t) => {
  const { admin, user } = await fixture(t);
  const member = await user('organizer');
  const root = (
    await admin('/api/groups', 'POST', { name: 'Organization root' })
  ).data;
  const child = (
    await admin('/api/groups', 'POST', {
      name: 'Organization child',
      parentId: root.id,
    })
  ).data;
  await admin(`/api/groups/${child.id}/members/${member.user.id}`, 'PUT', {
    role: 'member',
  });
  const inherited = (
    await admin('/api/slides', 'POST', { ...slide, managingGroupId: root.id })
  ).data;
  const own = (await member.call('/api/slides', 'POST', slide)).data;
  const folder = (
    await admin('/api/library-folders/slides', 'POST', {
      name: 'Safety',
      managingGroupId: root.id,
    })
  ).data;
  const nested = (
    await admin('/api/library-folders/slides', 'POST', {
      name: 'Local safety',
      parentId: folder.id,
      managingGroupId: root.id,
    })
  ).data;
  assert.equal(
    (
      await member.call('/api/organization/slides', 'POST', {
        ids: [own.id, inherited.id],
        folderId: nested.id,
        addTags: ['Safety'],
      })
    ).status,
    403,
  );
  let library = (await member.call('/api/library')).data;
  assert.equal(library.slides.find((s) => s.id === own.id).folderId, null);
  assert.equal(
    (
      await member.call('/api/organization/slides', 'POST', {
        ids: [own.id],
        folderId: nested.id,
        addTags: ['Safety', ' safety ', 'NEWS'],
      })
    ).status,
    200,
  );
  library = (await member.call('/api/library')).data;
  const moved = library.slides.find((s) => s.id === own.id);
  assert.equal(moved.readOnly, false);
  assert.equal(moved.managingGroupId, null);
  assert.deepEqual(moved.tags, ['safety', 'news']);
  assert.equal(moved.folderId, nested.id);
  assert.equal(
    library.slideFolders.find((f) => f.id === folder.id).readOnly,
    true,
  );
  assert.equal(
    (
      await member.call(`/api/library-folders/slides/${nested.id}`, 'PUT', {
        name: 'Forbidden',
        parentId: null,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await admin(`/api/library-folders/slides/${folder.id}`, 'PUT', {
        ...folder,
        parentId: nested.id,
      })
    ).status,
    400,
  );
  assert.equal(
    (await admin(`/api/library-folders/slides/${nested.id}`, 'DELETE')).status,
    409,
  );
  assert.equal(
    (
      await member.call('/api/organization/slides', 'POST', {
        ids: [own.id],
        folderId: null,
        removeTags: ['safety'],
      })
    ).status,
    200,
  );
  assert.equal(
    (await admin(`/api/library-folders/slides/${nested.id}`, 'DELETE')).status,
    200,
  );
});

void test('a fork retains its last valid publication when master viewing access is revoked', async (t) => {
  const { admin, user, db } = await fixture(t);
  const editor = await user('paused-fork-editor');
  const first = (await admin('/api/slides', 'POST', slide)).data;
  const second = (
    await admin('/api/slides', 'POST', { ...slide, name: 'New master slide' })
  ).data;
  let master = (
    await admin('/api/playlists', 'POST', {
      name: 'Revocable master',
      items: [{ slideId: first.id, duration: 10 }],
    })
  ).data;
  await admin(`/api/playlists/${master.id}/publish`, 'POST');
  await admin(`/api/access/playlist/${master.id}`, 'POST', {
    userId: editor.user.id,
    permission: 'view',
  });
  const fork = (
    await editor.call(`/api/playlists/${master.id}/fork`, 'POST', {
      name: 'Protected fork',
    })
  ).data;
  assert.equal(
    (await editor.call(`/api/playlists/${fork.id}/publish`, 'POST')).status,
    200,
  );
  const record = () =>
    JSON.parse(
      db
        .prepare("SELECT body FROM records WHERE kind='playlist' AND id=?")
        .get(fork.id).body,
    );
  const initial = record().published;
  await admin(`/api/access/playlist/${master.id}`, 'POST', {
    userId: editor.user.id,
    remove: true,
  });
  master = (
    await admin(`/api/playlists/${master.id}`, 'PUT', {
      ...master,
      items: [...master.items, { slideId: second.id, duration: 20 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${master.id}/publish`, 'POST')).status,
    200,
  );
  assert.deepEqual(record().published, initial);
  assert.match(record().forkSyncError, /Viewing access to the master/);
  assert.equal(
    (
      await admin(`/api/slides/${first.id}`, 'PUT', {
        ...first,
        name: 'Protected new slide content',
      })
    ).status,
    200,
  );
  assert.deepEqual(record().published, initial);
  assert.equal((await editor.call(`/api/preview/${fork.id}`)).status, 404);
  await admin(`/api/access/playlist/${master.id}`, 'POST', {
    userId: editor.user.id,
    permission: 'view',
  });
  assert.equal(
    (await editor.call(`/api/playlists/${fork.id}/publish`, 'POST')).status,
    200,
  );
  assert.equal(record().forkSyncError, undefined);
  assert.equal(record().published.items.length, 2);
  assert.notEqual(record().published.revision, initial.revision);
});

void test('folders are globally visible but only admins can change even legacy owned or granted folders', async (t) => {
  const { admin, user, db, client } = await fixture(t);
  const member = await user('folder-user');
  const outsider = await user('folder-outsider');
  const privateGroup = (
    await admin('/api/groups', 'POST', { name: 'Private folder managers' })
  ).data;
  for (const [route, kind, collection] of [
    ['/api/folders', 'folder', 'folders'],
    ['/api/library-folders/slides', 'slide-folder', 'slideFolders'],
    ['/api/library-folders/playlists', 'playlist-folder', 'playlistFolders'],
  ]) {
    const root = (
      await admin(route, 'POST', {
        name: `${kind} root`,
        ...(kind !== 'folder' ? { managingGroupId: privateGroup.id } : {}),
      })
    ).data;
    const nested = (
      await admin(route, 'POST', { name: `${kind} nested`, parentId: root.id })
    ).data;
    // Older installations may have user-owned folders and explicit Edit grants.
    db.prepare(
      'UPDATE resource_access SET ownerId=? WHERE kind=? AND id=?',
    ).run(member.user.id, kind, nested.id);
    await admin(`/api/access/${kind}/${nested.id}`, 'POST', {
      userId: member.user.id,
      permission: 'edit',
    });
    for (const person of [member, outsider]) {
      const navigation = (await person.call('/api/library')).data[collection];
      assert.ok(navigation.some((f) => f.id === root.id));
      assert.equal(
        navigation.find((f) => f.id === nested.id).parentId,
        root.id,
      );
      assert.ok(navigation.every((f) => f.readOnly));
      assert.ok(!JSON.stringify(navigation).includes(privateGroup.id));
      assert.equal(
        (await person.call(route, 'POST', { name: 'Forbidden new folder' }))
          .status,
        403,
      );
      assert.equal(
        (
          await person.call(`${route}/${nested.id}`, 'PUT', {
            name: 'Forbidden rename',
            parentId: null,
          })
        ).status,
        403,
      );
      assert.equal(
        (await person.call(`${route}/${nested.id}`, 'DELETE')).status,
        403,
      );
      assert.equal(
        (
          await person.call(`/api/access/${kind}/${nested.id}`, 'POST', {
            userId: outsider.user.id,
          })
        ).status,
        403,
      );
      assert.equal(
        (await person.call(`/api/access/${kind}/${nested.id}`)).status,
        403,
      );
    }
    assert.equal(
      (
        await admin(`${route}/${nested.id}`, 'PUT', {
          name: 'Admin renamed',
          parentId: null,
        })
      ).status,
      200,
    );
    assert.equal((await admin(`${route}/${nested.id}`, 'DELETE')).status, 200);
  }
  assert.equal((await client()('/api/library')).status, 401);
});

void test('users move editable content and upload into any shared folder without gaining access to private contents', async (t) => {
  const { admin, user } = await fixture(t);
  const member = await user('shared-folder-organizer');
  const outsider = await user('shared-folder-outsider');
  for (const kind of ['slides', 'playlists']) {
    const folder = (
      await admin(`/api/library-folders/${kind}`, 'POST', {
        name: 'Shared destination',
      })
    ).data;
    const body =
      kind === 'slides' ? slide : { name: 'Local playlist', items: [] };
    const own = (await member.call(`/api/${kind}`, 'POST', body)).data;
    const secret = (await admin(`/api/${kind}`, 'POST', body)).data;
    await admin(`/api/organization/${kind}`, 'POST', {
      ids: [secret.id],
      folderId: folder.id,
    });
    for (const folderId of [folder.id, null]) {
      assert.equal(
        (
          await member.call(`/api/organization/${kind}`, 'POST', {
            ids: [own.id],
            folderId,
          })
        ).status,
        200,
      );
      assert.equal(
        (await member.call(`/api/library`)).data[kind].find(
          (item) => item.id === own.id,
        ).folderId,
        folderId,
      );
    }
    assert.equal((await outsider.call('/api/library')).data[kind].length, 0);
    assert.equal(
      (
        await member.call(`/api/organization/${kind}`, 'POST', {
          ids: [secret.id],
          folderId: null,
        })
      ).status,
      404,
    );
  }
  const a = (await admin('/api/folders', 'POST', { name: 'Shared media A' }))
    .data;
  const b = (await admin('/api/folders', 'POST', { name: 'Shared media B' }))
    .data;
  const form = new FormData();
  form.append(
    'file',
    new Blob([
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: 'blue' },
      })
        .png()
        .toBuffer(),
    ]),
    'user-upload.png',
  );
  form.append('folderId', a.id);
  const uploaded = await member.call('/api/assets', 'POST', form);
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.data.folderId, a.id);
  const secret = await uploadImage(admin);
  await admin(`/api/assets/${secret.id}`, 'PATCH', { folderId: a.id });
  assert.equal(
    (
      await member.call('/api/assets/batch', 'POST', {
        ids: [uploaded.data.id],
        folderId: b.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (await member.call('/api/library')).data.assets.find(
      (item) => item.id === uploaded.data.id,
    ).folderId,
    b.id,
  );
  assert.equal(
    (
      await member.call('/api/assets/batch', 'POST', {
        ids: [secret.id],
        folderId: b.id,
      })
    ).status,
    404,
  );
  assert.equal((await outsider.call('/api/library')).data.assets.length, 0);
});
