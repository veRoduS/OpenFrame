import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';

async function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'openframe-transfer-'));
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
  await admin('/api/setup', 'POST', { password: 'transfer-test-password' });
  t.after(async () => {
    instance.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    instance.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { admin, client, db: instance.db };
}
async function screenFixture(t, relative = true) {
  const fixtureData = await fixture(t);
  const { admin, client } = fixtureData;
  const a = (
    await admin('/api/sites', 'POST', { siteNumber: '001', name: 'North' })
  ).data;
  const b = (
    await admin('/api/sites', 'POST', { siteNumber: '002', name: 'South' })
  ).data;
  const application = (
    await admin('/api/data-feeds/applications', 'POST', {
      name: 'Transfer metrics',
    })
  ).data;
  const feeds = [],
    secrets = [];
  for (const [site, value] of [
    [a, 10],
    [b, 20],
  ]) {
    const key = (
      await admin(
        `/api/data-feeds/applications/${application.id}/tokens`,
        'POST',
        { name: site.name, siteId: site.id },
      )
    ).data;
    secrets.push(key.token);
    const receipt = await client()(
      '/api/data-feeds/ingest/production',
      'POST',
      { completed: value },
      key.token,
    );
    assert.equal(receipt.status, 201);
    feeds.push(receipt.data.feedId);
  }
  const slide = (
    await admin('/api/slides', 'POST', {
      name: 'Transfer layout',
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
          data: {
            mode: 'metric',
            feedId: feeds[0],
            field: 'completed',
            ...(relative
              ? {
                  siteBinding: {
                    applicationId: application.id,
                    sourceKey: 'production',
                  },
                }
              : {}),
          },
        },
      ],
    })
  ).data;
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Transfer playlist',
      items: [{ slideId: slide.id, duration: 30 }],
    })
  ).data;
  await admin(`/api/playlists/${playlist.id}/publish`, 'POST');
  const player = client();
  const device = (
    await player('/api/player/enroll', 'POST', {
      name: 'Transfer screen',
      siteNumber: '001',
    })
  ).data;
  await admin(`/api/devices/${device.id}/approve`, 'POST', {
    code: device.code,
    siteId: a.id,
  });
  await admin(`/api/devices/${device.id}`, 'PUT', {
    name: 'Transfer screen',
    playlistId: playlist.id,
    rotation: 0,
    blank: false,
  });
  const group = (
    await admin('/api/groups', 'POST', { name: 'Original recipients' })
  ).data;
  await admin(`/api/access/device/${device.id}`, 'POST', { groupId: group.id });
  const sync = (siteAck = 1, version = '0.15.2') =>
    player('/api/player/sync', 'POST', { version, siteAck }, device.token);
  assert.equal((await sync()).status, 200);
  const preview = (siteId = b.id) =>
    admin(`/api/devices/${device.id}/site-preview?siteId=${siteId}`);
  const transfer = (impact, siteId = b.id) =>
    admin(`/api/devices/${device.id}/transfer`, 'POST', {
      siteId,
      reviewToken: impact.reviewToken,
    });
  return {
    ...fixtureData,
    a,
    b,
    device,
    sync,
    preview,
    transfer,
    feeds,
    secrets,
    group,
    playlist,
  };
}

void test('transfer retains a shared layout, resets access, and stays pending until the exact cleared revision is acknowledged', async (t) => {
  const {
    admin,
    db,
    a,
    b,
    device,
    sync,
    preview,
    transfer,
    feeds,
    client,
    group,
  } = await screenFixture(t);
  const invitation = (
    await admin('/api/users', 'POST', {
      username: 'previous-site-user',
      name: 'Previous site user',
    })
  ).data;
  const previousUser = client();
  assert.equal(
    (
      await previousUser('/api/activate', 'POST', {
        token: invitation.invitation,
        password: 'transfer-test-password',
      })
    ).status,
    200,
  );
  await admin(`/api/groups/${group.id}/members/${invitation.user.id}`, 'PUT', {
    role: 'member',
  });
  assert.ok(
    (await previousUser('/api/library')).data.devices.some(
      (item) => item.id === device.id,
    ),
  );
  assert.equal(
    (
      await previousUser(
        `/api/devices/${device.id}/site-preview?siteId=${b.id}`,
      )
    ).status,
    403,
  );
  const impact = await preview();
  assert.equal(impact.status, 200);
  assert.equal(impact.data.detachPlaylist, false);
  assert.equal(impact.data.issues.length, 0);
  assert.equal(impact.data.removedShareCount, 1);
  const moved = await transfer(impact.data);
  assert.equal(moved.status, 200);
  assert.equal(moved.data.siteRevision, 2);
  assert.equal(moved.data.siteId, b.id);
  assert.equal(moved.data.siteTransfer.clearedAt, null);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM resource_grants WHERE kind='device' AND id=?",
      )
      .get(device.id).n,
    0,
  );
  assert.ok(
    !(await previousUser('/api/library')).data.devices.some(
      (item) => item.id === device.id,
    ),
  );
  assert.equal((await preview(a.id)).status, 409);
  assert.equal((await sync(3)).status, 400);
  const firstContact = await sync(1);
  assert.equal(firstContact.data.siteRevision, 2);
  assert.equal(firstContact.data.dataFeeds[feeds[1]].data.completed, 20);
  assert.equal(Object.hasOwn(firstContact.data.dataFeeds, feeds[0]), false);
  let stored = JSON.parse(
    db
      .prepare("SELECT body FROM records WHERE kind='device' AND id=?")
      .get(device.id).body,
  );
  assert.equal(stored.siteTransfer.clearedAt, null);
  assert.equal((await sync(2)).status, 200);
  stored = JSON.parse(
    db
      .prepare("SELECT body FROM records WHERE kind='device' AND id=?")
      .get(device.id).body,
  );
  assert.ok(stored.siteTransfer.clearedAt);
  assert.equal((await preview(a.id)).status, 200);
  const audit = (await admin('/api/sites/audit')).data.entries;
  assert.ok(
    audit.some(
      (entry) =>
        entry.action === 'screen-transferred' &&
        entry.fromSiteId === a.id &&
        entry.toSiteId === b.id,
    ),
  );
  assert.ok(
    audit.some(
      (entry) =>
        entry.action === 'screen-site-cleared' && entry.actorKind === 'device',
    ),
  );
});

void test('transfer reviews expire on content changes and incompatible fixed-feed playlists are detached', async (t) => {
  const { admin, b, device, preview, transfer, sync, playlist } =
    await screenFixture(t, false);
  await sync(1, '0.15.1');
  assert.equal((await preview()).status, 409);
  await sync();
  const initial = (await preview()).data;
  assert.equal(initial.detachPlaylist, true);
  assert.ok(initial.issues[0].reason.includes('Fixed feed'));
  await admin(`/api/playlists/${playlist.id}/publish`, 'POST');
  assert.equal((await transfer(initial)).status, 409);
  const current = (await preview()).data;
  await admin(`/api/sites/${b.id}`, 'PATCH', { archived: true });
  assert.equal((await transfer(current)).status, 409);
  await admin(`/api/sites/${b.id}`, 'PATCH', { archived: false });
  const moved = await transfer((await preview()).data);
  assert.equal(moved.status, 200);
  assert.equal(moved.data.playlistId, null);
  assert.equal(
    (
      await admin(`/api/devices/${device.id}/approve`, 'POST', {
        code: device.code,
        siteId: current.from.id,
      })
    ).status,
    409,
  );
});

void test('audit failure rolls back the entire transfer and audit history is private, paginated, and credential-free', async (t) => {
  const { admin, client, db, a, device, preview, transfer, secrets } =
    await screenFixture(t);
  const before = db
    .prepare("SELECT body FROM records WHERE kind='device' AND id=?")
    .get(device.id).body;
  const impact = (await preview()).data;
  db.exec(
    "CREATE TRIGGER reject_transfer_audit BEFORE INSERT ON site_audit WHEN NEW.action='screen-transferred' BEGIN SELECT RAISE(FAIL,'audit unavailable'); END;",
  );
  assert.equal((await transfer(impact)).status, 500);
  assert.equal(
    db
      .prepare("SELECT body FROM records WHERE kind='device' AND id=?")
      .get(device.id).body,
    before,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM resource_grants WHERE kind='device' AND id=?",
      )
      .get(device.id).n,
    1,
  );
  db.exec('DROP TRIGGER reject_transfer_audit');
  assert.equal((await transfer(impact)).status, 200);
  const first = (await admin('/api/sites/audit?limit=2')).data;
  assert.equal(first.entries.length, 2);
  assert.ok(first.nextCursor);
  const second = (
    await admin(
      `/api/sites/audit?limit=2&before=${encodeURIComponent(first.nextCursor)}`,
    )
  ).data;
  assert.ok(
    second.entries.every(
      (entry) => !first.entries.some((earlier) => earlier.id === entry.id),
    ),
  );
  const history = (await admin(`/api/sites/audit?siteId=${a.id}&limit=100`))
    .data;
  assert.ok(history.entries.length > 0);
  assert.ok(
    history.entries.every(
      (entry) => entry.fromSiteId === a.id || entry.toSiteId === a.id,
    ),
  );
  for (const secret of secrets)
    assert.ok(!JSON.stringify(history).includes(secret));
  assert.equal((await client()('/api/sites/audit')).status, 401);
  assert.equal((await admin('/api/sites/audit?limit=1000')).status, 400);
});

void test('manual feeds keep their ID, key, values and fields on first site assignment; new feeds require a site', async (t) => {
  const { admin, client, db } = await fixture(t);
  const fields = [{ key: 'completed', type: 'number' }];
  const legacy = (
    await admin('/api/data-feeds', 'POST', { name: 'Legacy feed', fields })
  ).data;
  const key = (
    await admin(`/api/data-feeds/${legacy.id}/tokens`, 'POST', {
      name: 'Existing key',
    })
  ).data;
  const external = client();
  assert.equal(
    (
      await external(
        `/api/data-feeds/${legacy.id}/data`,
        'PUT',
        { completed: 42 },
        key.token,
      )
    ).status,
    200,
  );
  const beforeDigest = db
    .prepare('SELECT digest FROM data_feed_tokens WHERE id=?')
    .get(key.id).digest;
  const a = (
    await admin('/api/sites', 'POST', { siteNumber: '001', name: 'North' })
  ).data;
  const b = (
    await admin('/api/sites', 'POST', { siteNumber: '002', name: 'South' })
  ).data;
  assert.equal(
    (await admin('/api/data-feeds', 'POST', { name: 'Missing site', fields }))
      .data.code,
    'SITE_REQUIRED',
  );
  assert.equal(
    (
      await admin('/api/data-feeds', 'POST', {
        name: 'Local feed',
        fields,
        siteId: b.id,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await admin(`/api/data-feeds/${legacy.id}`, 'PUT', {
        name: 'Legacy feed',
        fields,
        siteId: a.id,
      })
    ).status,
    409,
  );
  const assigned = await admin(
    `/api/data-feeds/${legacy.id}/assign-site`,
    'POST',
    { siteId: a.id },
  );
  assert.equal(assigned.status, 200);
  assert.equal(assigned.data.id, legacy.id);
  assert.equal(assigned.data.siteNumber, '001');
  assert.deepEqual(assigned.data.fields, fields);
  assert.equal(
    (await admin(`/api/data-feeds/${legacy.id}/data`)).data.data.completed,
    42,
  );
  assert.equal(
    db.prepare('SELECT digest FROM data_feed_tokens WHERE id=?').get(key.id)
      .digest,
    beforeDigest,
  );
  assert.equal(
    (
      await admin(`/api/data-feeds/${legacy.id}/assign-site`, 'POST', {
        siteId: a.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await admin(`/api/data-feeds/${legacy.id}/assign-site`, 'POST', {
        siteId: b.id,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await external(
        `/api/data-feeds/${legacy.id}/data`,
        'PUT',
        { completed: 43 },
        key.token,
      )
    ).status,
    200,
  );
  await admin(`/api/sites/${a.id}`, 'PATCH', { archived: true });
  assert.equal(
    (
      await external(
        `/api/data-feeds/${legacy.id}/data`,
        'PUT',
        { completed: 44 },
        key.token,
      )
    ).status,
    409,
  );
});

void test('site access groups constrain broad resource grants, direct IDs, commands and preview values', async (t) => {
  const { admin, client } = await fixture(t);
  const root = (await admin('/api/groups', 'POST', { name: 'Organisation' }))
    .data;
  const north = (
    await admin('/api/groups', 'POST', {
      name: 'North team',
      parentId: root.id,
    })
  ).data;
  const south = (
    await admin('/api/groups', 'POST', {
      name: 'South team',
      parentId: root.id,
    })
  ).data;
  const branch = (
    await admin('/api/groups', 'POST', {
      name: 'North branch',
      parentId: north.id,
    })
  ).data;
  const a = (
    await admin('/api/sites', 'POST', {
      siteNumber: '001',
      name: 'North',
      accessGroupId: north.id,
    })
  ).data;
  const b = (
    await admin('/api/sites', 'POST', {
      siteNumber: '002',
      name: 'South',
      accessGroupId: south.id,
    })
  ).data;
  const fields = [{ key: 'completed', type: 'number' }];
  const feeds = [],
    devices = [];
  for (const site of [a, b]) {
    const feed = (
      await admin('/api/data-feeds', 'POST', {
        name: site.name,
        fields,
        siteId: site.id,
      })
    ).data;
    assert.equal(
      (
        await admin(`/api/access/data-feed/${feed.id}`, 'POST', {
          groupId: root.id,
        })
      ).status,
      200,
    );
    feeds.push(feed);
    const device = (
      await client()('/api/player/enroll', 'POST', {
        name: site.name,
        siteNumber: site.siteNumber,
      })
    ).data;
    await admin(`/api/devices/${device.id}/approve`, 'POST', {
      code: device.code,
      siteId: site.id,
    });
    await admin(`/api/access/device/${device.id}`, 'POST', {
      groupId: root.id,
    });
    devices.push(device);
  }
  async function person(name, groupId) {
    const invitation = (
      await admin('/api/users', 'POST', { name, username: name })
    ).data;
    const call = client();
    await call('/api/activate', 'POST', {
      token: invitation.invitation,
      password: 'site-access-password',
    });
    await admin(`/api/groups/${groupId}/members/${invitation.user.id}`, 'PUT', {
      role: 'member',
    });
    return { call, id: invitation.user.id };
  }
  const northUser = await person('north-user', branch.id);
  const southUser = await person('south-user', south.id);
  const parentUser = await person('parent-user', root.id);
  for (const device of devices)
    assert.equal(
      (
        await admin(`/api/access/device/${device.id}`, 'POST', {
          userId: northUser.id,
        })
      ).status,
      200,
    );
  const visible = (await northUser.call('/api/library')).data;
  assert.deepEqual(
    visible.dataFeeds.map((feed) => feed.id),
    [feeds[0].id],
  );
  assert.deepEqual(
    visible.devices.map((device) => device.id),
    [devices[0].id],
  );
  assert.equal(
    (await northUser.call(`/api/data-feeds/${feeds[1].id}/data`)).status,
    404,
  );
  assert.equal(
    (
      await northUser.call(`/api/devices/${devices[1].id}/command`, 'POST', {
        type: 'refresh',
      })
    ).status,
    404,
  );
  assert.equal(
    (await southUser.call(`/api/data-feeds/${feeds[0].id}`)).status,
    404,
  );
  assert.equal(
    (await parentUser.call(`/api/data-feeds/${feeds[0].id}/data`)).status,
    404,
  );
  // Even an explicit user share cannot override a configured site boundary.
  await admin(`/api/access/data-feed/${feeds[1].id}`, 'POST', {
    userId: northUser.id,
  });
  assert.equal(
    (await northUser.call(`/api/data-feeds/${feeds[1].id}/data`)).status,
    404,
  );
  const token = (
    await admin(`/api/data-feeds/${feeds[1].id}/tokens`, 'POST', {
      name: 'South values',
    })
  ).data;
  await client()(
    `/api/data-feeds/${feeds[1].id}/data`,
    'PUT',
    { completed: 7735 },
    token.token,
  );
  const source = (
    await admin('/api/slides', 'POST', {
      name: 'Shared preview',
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
          data: { mode: 'metric', feedId: feeds[1].id, field: 'completed' },
        },
      ],
    })
  ).data;
  const playlist = (
    await admin('/api/playlists', 'POST', {
      name: 'Shared preview',
      items: [{ slideId: source.id, duration: 30 }],
    })
  ).data;
  await admin(`/api/playlists/${playlist.id}/publish`, 'POST');
  await admin(`/api/access/playlist/${playlist.id}`, 'POST', {
    groupId: root.id,
  });
  assert.equal(
    (await northUser.call(`/api/preview/${playlist.id}?siteId=${b.id}`)).data
      .dataFeeds[feeds[1].id].status,
    'unavailable',
  );
  assert.equal(
    (await southUser.call(`/api/preview/${playlist.id}?siteId=${b.id}`)).data
      .dataFeeds[feeds[1].id].data.completed,
    7735,
  );
  await admin(`/api/groups/${branch.id}/members/${northUser.id}`, 'PUT', {
    role: 'remove',
  });
  assert.equal(
    (await northUser.call(`/api/data-feeds/${feeds[0].id}/data`)).status,
    404,
  );
  assert.equal(
    (await admin(`/api/data-feeds/${feeds[0].id}/data`)).status,
    200,
  );
});

void test('site rate budgets isolate busy locations while the application retains an aggregate ceiling', async (t) => {
  const { admin, client } = await fixture(t);
  const application = (
    await admin('/api/data-feeds/applications', 'POST', { name: 'Many sites' })
  ).data;
  const keys = [];
  for (let i = 0; i < 11; i++) {
    const site = (
      await admin('/api/sites', 'POST', {
        siteNumber: `${i + 1}`,
        name: `Site ${i + 1}`,
      })
    ).data;
    keys.push(
      (
        await admin(
          `/api/data-feeds/applications/${application.id}/tokens`,
          'POST',
          { name: site.name, siteId: site.id },
        )
      ).data,
    );
  }
  const write = (key) =>
    client()(
      '/api/data-feeds/ingest/production',
      'POST',
      { completed: 1 },
      key.token,
    );
  for (let i = 0; i < 60; i++)
    assert.equal((await write(keys[0])).status, i ? 200 : 201);
  const rotated = (
    await admin(
      `/api/data-feeds/applications/${application.id}/tokens`,
      'POST',
      { name: 'Rotated', siteId: keys[0].siteId },
    )
  ).data;
  assert.equal((await write(rotated)).status, 429);
  // This rejected call must not consume the aggregate allowance of other sites.
  for (let site = 1; site < 10; site++)
    for (let i = 0; i < 60; i++)
      assert.equal((await write(keys[site])).status, i ? 200 : 201);
  const ceiling = await write(keys[10]);
  assert.equal(ceiling.status, 429);
  assert.ok(ceiling.data.error.includes('600'));
});
