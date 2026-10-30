import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';

async function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'openframe-approval-'));
  const instance = createApp({ dataDir: directory });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    return async (route, method = 'GET', body, token) => {
      const response = await fetch(origin + route, {
        method,
        headers: {
          cookie,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, data: await response.json() };
    };
  }
  const admin = client();
  await admin('/api/setup', 'POST', { password: 'store-approval-password' });
  const root = (await admin('/api/groups', 'POST', { name: 'Company' })).data;
  const northGroup = (
    await admin('/api/groups', 'POST', {
      name: 'North store',
      parentId: root.id,
    })
  ).data;
  const branch = (
    await admin('/api/groups', 'POST', {
      name: 'North department',
      parentId: northGroup.id,
    })
  ).data;
  const southGroup = (
    await admin('/api/groups', 'POST', {
      name: 'South store',
      parentId: root.id,
    })
  ).data;
  const north = (
    await admin('/api/sites', 'POST', {
      siteNumber: '001',
      name: 'North',
      accessGroupId: northGroup.id,
    })
  ).data;
  const south = (
    await admin('/api/sites', 'POST', {
      siteNumber: '002',
      name: 'South',
      accessGroupId: southGroup.id,
    })
  ).data;
  async function person(username, groupId) {
    const invitation = (
      await admin('/api/users', 'POST', {
        username,
        name: username,
      })
    ).data;
    const call = client();
    await call('/api/activate', 'POST', {
      token: invitation.invitation,
      password: 'store-user-password',
    });
    if (groupId)
      await admin(
        `/api/groups/${groupId}/members/${invitation.user.id}`,
        'PUT',
        { role: 'member' },
      );
    return { call, id: invitation.user.id };
  }
  const enroll = async (name, siteNumber) =>
    (
      await client()('/api/player/enroll', 'POST', {
        name,
        ...(siteNumber ? { siteNumber } : {}),
      })
    ).data;
  t.after(async () => {
    instance.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    instance.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    admin,
    client,
    db: instance.db,
    person,
    enroll,
    root,
    northGroup,
    branch,
    southGroup,
    north,
    south,
  };
}

void test('ordinary store members approve only their requested store, then retain screen access', async (t) => {
  const {
    admin,
    client,
    person,
    enroll,
    north,
    south,
    northGroup,
    branch,
    southGroup,
    root,
  } = await fixture(t);
  const member = await person('north-member', northGroup.id);
  const colleague = await person('north-colleague', branch.id);
  const other = await person('south-member', southGroup.id);
  const parent = await person('company-member', root.id);
  const device = await enroll('North TV', north.siteNumber);
  const southDevice = await enroll('South TV', south.siteNumber);
  const library = (await member.call('/api/library')).data;
  assert.deepEqual(
    library.devices.map((d) => d.id),
    [device.id],
  );
  assert.equal(library.devices[0].canApprove, true);
  assert.equal(library.devices[0].readOnly, true);
  assert.equal('tokenHash' in library.devices[0], false);
  assert.equal('token' in library.devices[0], false);
  assert.deepEqual(
    library.sites.map((s) => s.id),
    [north.id],
  );
  assert.equal(library.sites[0].canApprove, true);
  assert.deepEqual(
    (await other.call('/api/library')).data.devices.map((d) => d.id),
    [southDevice.id],
  );
  assert.deepEqual((await parent.call('/api/library')).data.devices, []);
  const route = `/api/devices/${device.id}/approve`;
  const body = { code: device.code, siteId: north.id };
  assert.equal((await client()(route, 'POST', body)).status, 401);
  assert.equal((await other.call(route, 'POST', body)).status, 403);
  assert.equal((await parent.call(route, 'POST', body)).status, 403);
  assert.equal(
    (await member.call(route, 'POST', { ...body, code: 'BADCODE1' })).status,
    400,
  );
  // Being a member of both stores still cannot redirect a screen's request.
  await admin(`/api/groups/${southGroup.id}/members/${member.id}`, 'PUT', {
    role: 'member',
  });
  assert.equal(
    (await member.call(route, 'POST', { ...body, siteId: south.id })).status,
    403,
  );
  assert.equal(
    (await member.call(route, 'POST', { ...body, siteId: null })).status,
    403,
  );
  assert.equal(
    (
      await member.call(`/api/devices/${device.id}`, 'PUT', {
        name: 'Tampered',
        playlistId: null,
        blank: false,
        rotation: 0,
      })
    ).status,
    404,
  );
  assert.equal(
    (await member.call(`/api/devices/${device.id}`, 'DELETE')).status,
    403,
  );
  assert.equal(
    (
      await member.call(`/api/devices/${device.id}/command`, 'POST', {
        type: 'refresh',
      })
    ).status,
    404,
  );
  const approved = await member.call(route, 'POST', body);
  assert.equal(approved.status, 200);
  assert.equal(approved.data.siteId, north.id);
  assert.equal(approved.data.siteRevision, 1);
  assert.equal(approved.data.approved, true);
  assert.equal((await member.call(route, 'POST', body)).status, 409);
  assert.equal((await admin(route, 'POST', body)).status, 200);
  for (const user of [member, colleague]) {
    const visible = (await user.call('/api/library')).data.devices.find(
      (d) => d.id === device.id,
    );
    assert.equal(visible.readOnly, false);
    assert.equal(visible.canApprove, false);
  }
  assert.equal(
    (
      await member.call(`/api/devices/${device.id}/command`, 'POST', {
        type: 'refresh',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await member.call(`/api/devices/${device.id}/site`, 'POST', {
        siteId: south.id,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await member.call(`/api/devices/${device.id}/transfer`, 'POST', {
        siteId: south.id,
        reviewToken: 'fake',
      })
    ).status,
    403,
  );
  const entries = (
    await admin(`/api/sites/audit?siteId=${north.id}`)
  ).data.entries.filter((e) => e.action === 'screen-approved');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].actorId, member.id);
  await admin(`/api/groups/${northGroup.id}/members/${member.id}`, 'PUT', {
    role: 'remove',
  });
  assert.equal(
    (await member.call('/api/library')).data.devices.some(
      (d) => d.id === device.id,
    ),
    false,
  );
  assert.equal(
    (
      await member.call(`/api/devices/${device.id}/command`, 'POST', {
        type: 'refresh',
      })
    ).status,
    404,
  );
});

void test('pending approval follows live site membership, archives and legacy administrator fallback', async (t) => {
  const { admin, client, db, person, enroll, north, branch } = await fixture(t);
  const member = await person('department-member', branch.id);
  const device = await enroll('Department TV', north.siteNumber);
  const route = `/api/devices/${device.id}/approve`;
  const body = { code: device.code, siteId: north.id };
  assert.equal(
    (await member.call('/api/library')).data.devices[0].canApprove,
    true,
  );
  await admin(`/api/groups/${branch.id}/members/${member.id}`, 'PUT', {
    role: 'remove',
  });
  assert.equal((await member.call('/api/library')).data.devices.length, 0);
  assert.equal((await member.call(route, 'POST', body)).status, 403);
  await admin(`/api/groups/${branch.id}/members/${member.id}`, 'PUT', {
    role: 'member',
  });
  await admin(`/api/sites/${north.id}`, 'PATCH', { archived: true });
  assert.equal((await member.call('/api/library')).data.devices.length, 0);
  assert.equal((await member.call(route, 'POST', body)).status, 403);
  assert.equal((await admin(route, 'POST', body)).status, 409);
  await admin(`/api/sites/${north.id}`, 'PATCH', { archived: false });
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(member.id);
  assert.equal((await member.call(route, 'POST', body)).status, 401);
  db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(member.id);
  assert.equal(
    (await member.call(route, 'POST', { code: device.code })).status,
    200,
  );
  assert.equal(
    (await member.call('/api/library')).data.devices[0].approved,
    true,
  );
  const noNumber = await enroll('Legacy TV');
  assert.equal(
    (
      await member.call(`/api/devices/${noNumber.id}/approve`, 'POST', {
        code: noNumber.code,
        siteId: north.id,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await admin(`/api/devices/${noNumber.id}/approve`, 'POST', {
        code: noNumber.code,
        siteId: north.id,
      })
    ).status,
    200,
  );
  const ungrouped = (
    await admin('/api/sites', 'POST', {
      siteNumber: '003',
      name: 'Legacy store',
    })
  ).data;
  const ungroupedDevice = await enroll('Ungrouped TV', ungrouped.siteNumber);
  await admin(`/api/access/device/${ungroupedDevice.id}`, 'POST', {
    userId: member.id,
  });
  const view = (await member.call('/api/library')).data.devices.find(
    (d) => d.id === ungroupedDevice.id,
  );
  assert.equal(view.canApprove, false);
  assert.equal(
    (
      await member.call(`/api/devices/${ungroupedDevice.id}/approve`, 'POST', {
        code: ungroupedDevice.code,
        siteId: ungrouped.id,
      })
    ).status,
    403,
  );
  assert.equal(
    (await client()(`/api/devices/${device.id}/approve`, 'POST', body)).status,
    401,
  );
});

void test('approval records, group sharing and audit commit atomically', async (t) => {
  const { admin, db, person, enroll, north, northGroup } = await fixture(t);
  const member = await person('atomic-member', northGroup.id);
  const device = await enroll('Atomic TV', north.siteNumber);
  db.exec(
    "CREATE TRIGGER reject_approval BEFORE INSERT ON site_audit WHEN NEW.action='screen-approved' BEGIN SELECT RAISE(ABORT,'test audit failure'); END;",
  );
  const route = `/api/devices/${device.id}/approve`;
  const body = { code: device.code, siteId: north.id };
  assert.equal((await member.call(route, 'POST', body)).status, 500);
  const pending = JSON.parse(
    db
      .prepare("SELECT body FROM records WHERE kind='device' AND id=?")
      .get(device.id).body,
  );
  assert.equal(pending.approved, false);
  assert.equal(pending.siteId, null);
  assert.equal(
    db
      .prepare(
        "SELECT ownerId FROM resource_access WHERE kind='device' AND id=?",
      )
      .get(device.id).ownerId,
    null,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM resource_grants WHERE kind='device' AND id=?",
      )
      .get(device.id).n,
    0,
  );
  assert.equal(
    (await admin('/api/sites/audit')).data.entries.some(
      (e) => e.resourceId === device.id,
    ),
    false,
  );
  db.exec('DROP TRIGGER reject_approval');
  assert.equal((await member.call(route, 'POST', body)).status, 200);
});

void test('store screen metrics and subgroup access survive departure of the approving user', async (t) => {
  const { admin, client, db, person, enroll, north, northGroup } =
    await fixture(t);
  const member = await person('departing-member', northGroup.id);
  const device = await enroll('Store-owned TV', north.siteNumber);
  assert.equal(
    (
      await member.call(`/api/devices/${device.id}/approve`, 'POST', {
        code: device.code,
        siteId: north.id,
      })
    ).status,
    200,
  );
  const feed = (
    await admin('/api/data-feeds', 'POST', {
      name: 'Store sales',
      siteId: north.id,
      fields: [{ key: 'sales', type: 'number' }],
    })
  ).data;
  const key = (
    await admin(`/api/data-feeds/${feed.id}/tokens`, 'POST', {
      name: 'Sales producer',
    })
  ).data;
  const external = client();
  assert.equal(
    (
      await external(
        `/api/data-feeds/${feed.id}/data`,
        'PUT',
        { sales: 42 },
        key.token,
      )
    ).status,
    200,
  );
  await admin(`/api/access/data-feed/${feed.id}`, 'POST', {
    groupId: northGroup.id,
  });
  const slide = (
    await admin('/api/slides', 'POST', {
      name: 'Sales slide',
      width: 1920,
      height: 1080,
      layers: [
        {
          id: randomUUID(),
          type: 'data',
          x: 0,
          y: 0,
          width: 50,
          height: 40,
          data: { mode: 'metric', feedId: feed.id, field: 'sales' },
        },
      ],
    })
  ).data;
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Store playlist',
      items: [{ slideId: slide.id, duration: 30 }],
    })
  ).data;
  assert.equal(
    (await admin(`/api/playlists/${playlist.id}/publish`, 'POST')).status,
    200,
  );
  assert.equal(
    (
      await admin(`/api/access/playlist/${playlist.id}`, 'POST', {
        groupId: northGroup.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await admin(`/api/devices/${device.id}`, 'PUT', {
        name: 'Store-owned TV',
        playlistId: playlist.id,
        rotation: 0,
        blank: false,
      })
    ).status,
    200,
  );
  const sync = () =>
    external('/api/player/sync', 'POST', { version: '0.15.3' }, device.token);
  assert.equal((await sync()).data.dataFeeds[feed.id].data.sales, 42);
  // New departments inherit the explicit store share without copying a user grant.
  const department = (
    await admin('/api/groups', 'POST', {
      name: 'New store department',
      parentId: northGroup.id,
    })
  ).data;
  const colleague = await person('future-colleague', department.id);
  assert.equal(
    (await colleague.call('/api/library')).data.devices[0].id,
    device.id,
  );
  await admin(`/api/groups/${northGroup.id}/members/${member.id}`, 'PUT', {
    role: 'remove',
  });
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(member.id);
  const after = await sync();
  assert.equal(after.status, 200);
  assert.equal(after.data.manifest.items.length, 1);
  assert.equal(after.data.dataFeeds[feed.id].data.sales, 42);
  assert.equal(
    (
      await colleague.call('/api/devices/' + device.id + '/command', 'POST', {
        type: 'refresh',
      })
    ).status,
    200,
  );
});
