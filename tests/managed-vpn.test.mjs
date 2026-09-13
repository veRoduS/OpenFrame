import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/app.mjs';
import {
  hostSettings,
  validKey,
  validatePeers,
  serverConfig,
} from '../server/wireguard-core.mjs';

const publicKey = () =>
  Buffer.from(
    generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' }).x,
    'base64url',
  ).toString('base64');
async function fixture(t, enabled = true) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-managed-test-'));
  const host = {
    ...hostSettings({ WG_ENDPOINT: 'vpn.example.com:51820' }),
    publicKey: publicKey(),
  };
  let peers = [],
    down = false;
  const transport = async (method, _path, body) => {
    if (down)
      throw Object.assign(new Error('Managed WireGuard service unavailable'), {
        status: 503,
      });
    if (method === 'PUT') peers = validatePeers(body.peers, host.prefix);
    return { ...host, peers: peers.length };
  };
  const { app, db, close } = createApp({
    dataDir: dir,
    managedVpnTransport: enabled ? transport : undefined,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  let cookie = '';
  const request = async (endpoint, method = 'GET', body, token) => {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : { Cookie: cookie }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${endpoint}`,
      options,
    );
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
  };
  t.after(async () => {
    close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await request('/api/setup', 'POST', {
    password: 'managed-vpn-test-password',
  });
  const input = () => ({
    name: 'Test Pi',
    wireguardPublicKey: publicKey(),
    enrollmentToken: randomBytes(32).toString('hex'),
  });
  return {
    request,
    input,
    host,
    db,
    get peers() {
      return peers;
    },
    set down(value) {
      down = value;
    },
  };
}

void test('managed VPN validates private subnets, endpoints, canonical keys and unique /32 peers', () => {
  assert.equal(
    hostSettings({ WG_ENDPOINT: 'vpn.example.com:12345' }).address,
    '10.77.0.1',
  );
  for (const env of [
    { WG_ENDPOINT: 'bad\nendpoint:51820' },
    { WG_ENDPOINT: 'https://vpn.example.com' },
    { WG_ENDPOINT: 'vpn.example.com:0' },
    { WG_ENDPOINT: 'vpn.example.com:99999' },
    { WG_ENDPOINT: 'vpn.example.com:51820', WG_PREFIX: '8.8.8' },
  ])
    assert.throws(() => hostSettings(env));
  const key = publicKey();
  assert.ok(validKey(key));
  assert.equal(validKey(Buffer.alloc(32).toString('base64')), false);
  const peer = { publicKey: key, address: '10.77.0.2' };
  assert.deepEqual(validatePeers([peer], '10.77.0'), [peer]);
  for (const peers of [
    [peer, peer],
    [{ ...peer, address: '10.77.0.1' }],
    [{ ...peer, address: '10.77.0.255' }],
    [{ ...peer, address: '192.168.1.2' }],
    [{ ...peer, address: '10.77.0.2\nPostUp = bad' }],
    [{ ...peer, publicKey: 'invalid' }],
    Array(254).fill(peer),
  ])
    assert.throws(() => validatePeers(peers, '10.77.0'));
  assert.match(
    serverConfig('fake-test-key', [peer]),
    /AllowedIPs = 10\.77\.0\.2\/32/,
  );
  assert.ok(!serverConfig('fake-test-key', [peer]).includes('0.0.0.0/0'));
});

void test('default deployments do not enable managed VPN or change normal enrollment', async (t) => {
  const f = await fixture(t, false);
  assert.deepEqual((await f.request('/api/managed-vpn')).data, {
    enabled: false,
    peers: [],
  });
  assert.equal(
    (await f.request('/api/player/enroll', 'POST', f.input())).status,
    503,
  );
  assert.equal(
    (await f.request('/api/player/enroll', 'POST', { name: 'Normal player' }))
      .status,
    201,
  );
  assert.equal(
    (await f.request('/api/managed-vpn', 'GET', undefined, 'not-admin')).status,
    401,
  );
});

void test('first-boot enrollment retries preserve identity and release VPN settings only after approval', async (t) => {
  const f = await fixture(t);
  const input = f.input();
  const first = await f.request('/api/player/enroll', 'POST', input);
  assert.equal(first.status, 201);
  const retry = await f.request('/api/player/enroll', 'POST', input);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.data, first.data);
  assert.equal(
    (
      await f.request('/api/player/enroll', 'POST', {
        ...input,
        enrollmentToken: randomBytes(32).toString('hex'),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request('/api/player/enroll', 'POST', {
        name: 'Missing token',
        wireguardPublicKey: publicKey(),
      })
    ).status,
    400,
  );
  const pending = await f.request(
    '/api/player/provision',
    'POST',
    {},
    first.data.token,
  );
  assert.deepEqual(pending.data, { approved: false, code: first.data.code });
  assert.deepEqual(f.peers, []);
  await f.request(`/api/devices/${first.data.id}/approve`, 'POST', {
    code: first.data.code,
  });
  const provisioned = await f.request(
    '/api/player/provision',
    'POST',
    {},
    first.data.token,
  );
  assert.equal(provisioned.status, 200);
  assert.deepEqual(provisioned.data.wireguard, {
    address: '10.77.0.2/32',
    publicKey: f.host.publicKey,
    endpoint: f.host.endpoint,
    allowedIPs: '10.77.0.1/32',
    server: 'http://10.77.0.1:3100',
  });
  assert.deepEqual(f.peers, [
    { address: '10.77.0.2', publicKey: input.wireguardPublicKey },
  ]);
  assert.deepEqual(
    (await f.request('/api/player/provision', 'POST', {}, first.data.token))
      .data,
    provisioned.data,
  );
  const library = JSON.stringify((await f.request('/api/library')).data);
  assert.ok(!library.includes(first.data.token));
  assert.ok(
    !JSON.stringify(f.db.prepare('SELECT body FROM records').all()).includes(
      first.data.token,
    ),
  );
  // The same bearer token continues to work on the private-origin player protocol.
  assert.equal(
    (await f.request('/api/player/sync', 'POST', {}, first.data.token)).data
      .approved,
    true,
  );
  await f.request(`/api/devices/${first.data.id}`, 'DELETE');
  assert.deepEqual(f.peers, []);
  assert.equal(
    (await f.request('/api/player/provision', 'POST', {}, first.data.token))
      .status,
    401,
  );
});

void test('concurrent managed requests allocate distinct addresses and retries do not consume the pool', async (t) => {
  const f = await fixture(t);
  const clients = [];
  for (let i = 0; i < 3; i++) {
    const device = (await f.request('/api/player/enroll', 'POST', f.input()))
      .data;
    await f.request(`/api/devices/${device.id}/approve`, 'POST', {
      code: device.code,
    });
    clients.push(device);
  }
  const results = await Promise.all(
    clients.map((d) => f.request('/api/player/provision', 'POST', {}, d.token)),
  );
  assert.equal(new Set(results.map((r) => r.data.wireguard.address)).size, 3);
  assert.equal(f.peers.length, 3);
  for (const d of clients)
    assert.equal(
      (await f.request('/api/player/provision', 'POST', {}, d.token)).status,
      200,
    );
  assert.equal(f.peers.length, 3);
});

void test('helper outages do not undo API revocation and an unexpected server key fails closed', async (t) => {
  const f = await fixture(t);
  const d = (await f.request('/api/player/enroll', 'POST', f.input())).data;
  await f.request(`/api/devices/${d.id}/approve`, 'POST', { code: d.code });
  assert.equal(
    (await f.request('/api/player/provision', 'POST', {}, d.token)).status,
    200,
  );
  const original = f.host.publicKey;
  f.host.publicKey = publicKey();
  assert.equal((await f.request('/api/managed-vpn')).status, 503);
  f.host.publicKey = original;
  f.down = true;
  assert.equal((await f.request(`/api/devices/${d.id}`, 'DELETE')).status, 503);
  assert.equal(
    (await f.request('/api/player/sync', 'POST', {}, d.token)).status,
    401,
  );
  f.down = false;
  await f.request('/api/managed-vpn');
  assert.deepEqual(f.peers, []);
});
