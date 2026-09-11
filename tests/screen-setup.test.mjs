import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';
import { createApp } from '../server/app.mjs';
import { validateWireGuard } from '../server/screen-setup.mjs';

// Deliberately fake test keys; never use these fixtures for a real tunnel.
const privateKey = Buffer.alloc(32, 7).toString('base64');
const publicKey = Buffer.alloc(32, 19).toString('base64');
const client = `[Interface]\nPrivateKey = ${privateKey}\nAddress = 10.8.0.2/32\n[Peer]\nPublicKey = ${publicKey}\nAllowedIPs = 10.8.0.0/24\nEndpoint = vpn.example.com:51820\nPersistentKeepalive = 25\n`;
const vpnInput = {
  name: 'Lobby VPN',
  server: 'http://10.8.0.1:3100/',
  config: client,
};
const unpack = (response) => {
  assert.equal(response.status, 200);
  return Object.fromEntries(
    Object.entries(unzipSync(new Uint8Array(response.data))).map(
      ([name, bytes]) => [name, strFromU8(bytes)],
    ),
  );
};

async function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-setup-test-'));
  let db,
    server,
    base,
    cookie = '';
  async function start() {
    const instance = createApp({ dataDir: dir });
    db = instance.db;
    server = instance.app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
  await start();
  t.after(async () => {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const request = async (
    url,
    method = 'GET',
    body,
    auth = true,
    extra = {},
  ) => {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Cookie: cookie } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    const response = await fetch(base + url, options);
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0];
    return {
      status: response.status,
      headers: response.headers,
      data: response.headers.get('content-type')?.includes('json')
        ? await response.json()
        : await response.arrayBuffer(),
    };
  };
  assert.equal(
    (
      await request('/api/setup', 'POST', {
        password: 'setup-test-password-long',
      })
    ).status,
    200,
  );
  return {
    request,
    dir,
    get db() {
      return db;
    },
    async reopen() {
      await stop();
      await start();
    },
  };
}

void test('WireGuard safety filter normalizes clients and rejects executable or incomplete settings', () => {
  assert.equal(
    validateWireGuard('\ufeff# client\r\n' + client.replaceAll('\n', '\r\n'))
      .text,
    client,
  );
  assert.equal(validateWireGuard(client).fullTunnel, false);
  assert.equal(
    validateWireGuard(client.replace('10.8.0.0/24', '0.0.0.0/0, ::/0'))
      .fullTunnel,
    true,
  );
  for (const invalid of [
    '',
    null,
    'x'.repeat(65537),
    client.replace('[Interface]', '[Peer]'),
    client + 'PostUp = echo no\n',
    client + 'SaveConfig = true\n',
    client.replace('Address = 10.8.0.2/32', 'SaveConfig = true'),
    client.replace(privateKey, 'invalid-key'),
    client.replace(`PublicKey = ${publicKey}`, ''),
    client.replace('Endpoint = vpn.example.com:51820', ''),
    client + 'Endpoint = second.example.com:51820\n',
    client + 'Endpoint = bad\u0000value',
  ])
    assert.throws(() => validateWireGuard(invalid), { status: 400 });
});

void test('VPN inventory is admin-only, rejects hooks/duplicates, and never returns keys', async (t) => {
  const { request } = await fixture(t);
  assert.equal(
    (await request('/api/screen-setup', 'GET', undefined, false)).status,
    401,
  );
  assert.equal(
    (await request('/api/screen-setup/vpns', 'POST', vpnInput, false)).status,
    401,
  );
  assert.equal(
    (
      await request('/api/screen-setup/vpns', 'POST', vpnInput, true, {
        Origin: 'https://foreign.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/api/screen-setup/vpns', 'POST', {
        ...vpnInput,
        config: client + 'PostUp = echo secret',
      })
    ).status,
    400,
  );
  const imported = await request('/api/screen-setup/vpns', 'POST', vpnInput);
  assert.equal(imported.status, 201);
  assert.equal(imported.data.server, 'http://10.8.0.1:3100');
  assert.equal(imported.data.assignedTo, null);
  const alias = Buffer.from(privateKey, 'base64');
  alias[0] ^= 7;
  alias[31] ^= 128;
  assert.equal(
    (
      await request('/api/screen-setup/vpns', 'POST', {
        ...vpnInput,
        name: 'Alias',
        config: client.replace(privateKey, alias.toString('base64')),
      })
    ).status,
    409,
  );
  assert.equal(
    (await request('/api/screen-setup/vpns', 'POST', vpnInput)).status,
    409,
  );
  const listing = await request('/api/screen-setup');
  const json = JSON.stringify(listing.data);
  for (const secret of [privateKey, publicKey, 'encrypted', 'fingerprint'])
    assert.ok(!json.includes(secret));
  assert.equal(listing.headers.get('cache-control'), 'no-store');
  assert.equal(
    (await request(`/api/screen-setup/vpns/${imported.data.id}`, 'DELETE'))
      .status,
    200,
  );
  assert.equal((await request('/api/screen-setup')).data.vpns.length, 0);
});

void test('setup bundle allocates one VPN, keeps secrets encrypted, and survives reopening the server', async (t) => {
  const f = await fixture(t);
  const vpn = (
    await f.request('/api/screen-setup/vpns', 'POST', {
      ...vpnInput,
      server: 'https://signage.example.com',
    })
  ).data;
  const wifi = {
    ssid: 'Test WiFi',
    password: 'fake-wifi-password',
    country: 'US',
  };
  const access = {
    client_id: 'fake-id.access',
    client_secret: 'fake-access-secret',
  };
  const created = await f.request('/api/screen-setup/setups', 'POST', {
    name: 'Lobby',
    vpnId: vpn.id,
    wifi,
    access,
  });
  assert.equal(created.status, 201);
  const id = created.data.id;
  const endpoint = `/api/screen-setup/setups/${id}/download`;
  assert.equal(
    (await f.request(endpoint, 'POST', undefined, false)).status,
    401,
  );
  assert.equal(
    (
      await f.request(endpoint, 'POST', undefined, true, {
        Origin: 'https://foreign.example',
      })
    ).status,
    403,
  );
  const response = await f.request(endpoint, 'POST');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.match(
    response.headers.get('content-disposition'),
    /attachment; filename="openframe-screen-[a-f0-9-]+\.zip"/,
  );
  const files = unpack(response);
  assert.deepEqual(Object.keys(files).sort(), [
    'SETUP.txt',
    'openframe-wg.conf',
    'openframe.json',
  ]);
  assert.equal(files['openframe-wg.conf'], client);
  assert.deepEqual(JSON.parse(files['openframe.json']), {
    name: 'Lobby',
    server: 'https://signage.example.com',
    wifi_ssid: wifi.ssid,
    wifi_password: wifi.password,
    wifi_country: wifi.country,
    cloudflare_access: access,
  });
  assert.match(files['SETUP.txt'], /stock Raspberry Pi OS/);
  const metadata = JSON.stringify((await f.request('/api/screen-setup')).data);
  const stored = JSON.stringify(f.db.prepare('SELECT * FROM records').all());
  for (const value of [
    privateKey,
    wifi.password,
    access.client_secret,
    access.client_id,
  ]) {
    assert.ok(!metadata.includes(value));
    assert.ok(!stored.includes(value));
  }
  assert.equal(readFileSync(path.join(f.dir, 'provisioning.key')).length, 32);
  const inventory = (await f.request('/api/screen-setup')).data;
  assert.equal(inventory.vpns[0].assignedTo, id);
  assert.equal(
    (await f.request(`/api/screen-setup/vpns/${vpn.id}`, 'DELETE')).status,
    409,
  );
  assert.equal(
    (
      await f.request('/api/screen-setup/setups', 'POST', {
        name: 'Second screen',
        vpnId: vpn.id,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request('/api/screen-setup/setups', 'POST', {
        name: 'lobby',
        server: vpn.server,
      })
    ).status,
    409,
  );
  const library = (await f.request('/api/library')).data;
  assert.ok(!JSON.stringify(library).includes(vpn.id));
  await f.reopen();
  assert.deepEqual(unpack(await f.request(endpoint, 'POST')), files);
});

void test('competing setup requests cannot allocate a VPN twice', async (t) => {
  const { request } = await fixture(t);
  const vpn = (await request('/api/screen-setup/vpns', 'POST', vpnInput)).data;
  const results = await Promise.all(
    ['A', 'B'].map((name) =>
      request('/api/screen-setup/setups', 'POST', { name, vpnId: vpn.id }),
    ),
  );
  assert.deepEqual(
    results.map((r) => r.status).sort((a, b) => a - b),
    [201, 409],
  );
  assert.equal((await request('/api/screen-setup')).data.setups.length, 1);
});

void test('invalid setup requests leave allocation untouched and direct bundles omit VPN credentials', async (t) => {
  const { request } = await fixture(t);
  const vpn = (await request('/api/screen-setup/vpns', 'POST', vpnInput)).data;
  const access = { client_id: 'fake-id', client_secret: 'fake-secret' };
  for (const input of [
    { name: 'Missing server' },
    { name: 'Unknown VPN', vpnId: '00000000-0000-4000-8000-000000000000' },
    { name: 'Bad Access', vpnId: vpn.id, access },
    ...[
      'ftp://example.com',
      'https://user:fake-password@example.com',
      'https://example.com/path',
      'https://example.com?secret=bad',
      'https://example.com#secret',
      'https://exa\nmple.com',
    ].map((server) => ({ name: 'Invalid', server })),
    {
      name: 'Bad SSID',
      server: vpn.server,
      wifi: { ssid: 'a'.repeat(33), password: '', country: 'US' },
    },
    {
      name: 'UTF8 SSID',
      server: vpn.server,
      wifi: { ssid: '\u00e9'.repeat(17), password: '', country: 'US' },
    },
    {
      name: 'Bad Access header',
      server: 'https://example.com',
      access: { ...access, client_secret: 'secret\r\nHeader' },
    },
  ])
    assert.ok(
      [400, 404].includes(
        (await request('/api/screen-setup/setups', 'POST', input)).status,
      ),
    );
  const inventory = (await request('/api/screen-setup')).data;
  assert.equal(inventory.setups.length, 0);
  assert.equal(inventory.vpns[0].assignedTo, null);
  const created = await request('/api/screen-setup/setups', 'POST', {
    name: 'LAN',
    server: 'http://192.168.1.10:3100/',
  });
  assert.equal(created.status, 201);
  const files = unpack(
    await request(
      `/api/screen-setup/setups/${created.data.id}/download`,
      'POST',
    ),
  );
  assert.deepEqual(Object.keys(files).sort(), ['SETUP.txt', 'openframe.json']);
  assert.deepEqual(JSON.parse(files['openframe.json']), {
    name: 'LAN',
    server: 'http://192.168.1.10:3100',
  });
});

void test('lost or incorrect vault keys fail closed without replacing the key or allocating clients', async (t) => {
  const { request, dir } = await fixture(t);
  const vpn = (await request('/api/screen-setup/vpns', 'POST', vpnInput)).data;
  const keyPath = path.join(dir, 'provisioning.key');
  const key = readFileSync(keyPath);
  unlinkSync(keyPath);
  const input = { name: 'Lobby', vpnId: vpn.id };
  assert.equal(
    (await request('/api/screen-setup/setups', 'POST', input)).status,
    503,
  );
  assert.equal(existsSync(keyPath), false);
  writeFileSync(keyPath, Buffer.alloc(32));
  assert.equal(
    (await request('/api/screen-setup/setups', 'POST', input)).status,
    503,
  );
  assert.equal(
    (await request('/api/screen-setup')).data.vpns[0].assignedTo,
    null,
  );
  writeFileSync(keyPath, key);
  const created = await request('/api/screen-setup/setups', 'POST', input);
  assert.equal(created.status, 201);
  unlinkSync(keyPath);
  const result = await request(
    `/api/screen-setup/setups/${created.data.id}/download`,
    'POST',
  );
  assert.equal(result.status, 503);
  assert.ok(!JSON.stringify(result.data).includes(privateKey));
  assert.equal(existsSync(keyPath), false);
});

void test('vault authentication rejects ciphertext copied between records', async (t) => {
  const { request, db } = await fixture(t);
  const first = (
    await request('/api/screen-setup/setups', 'POST', {
      name: 'First',
      server: 'https://example.com',
    })
  ).data;
  const second = (
    await request('/api/screen-setup/setups', 'POST', {
      name: 'Second',
      server: 'https://example.com',
    })
  ).data;
  const record = (id) =>
    JSON.parse(
      db
        .prepare('SELECT body FROM records WHERE kind=? AND id=?')
        .get('screen-setup', id).body,
    );
  db.prepare('UPDATE records SET body=? WHERE kind=? AND id=?').run(
    JSON.stringify({
      ...record(second.id),
      encrypted: record(first.id).encrypted,
    }),
    'screen-setup',
    second.id,
  );
  assert.equal(
    (await request(`/api/screen-setup/setups/${second.id}/download`, 'POST'))
      .status,
    503,
  );
});

void test(
  'exported setup is accepted by the Python installer and connection validator',
  { skip: !process.env.OPENFRAME_PYTHON },
  async (t) => {
    const { request } = await fixture(t);
    const vpn = (await request('/api/screen-setup/vpns', 'POST', vpnInput))
      .data;
    const setup = (
      await request('/api/screen-setup/setups', 'POST', {
        name: 'Interop',
        vpnId: vpn.id,
      })
    ).data;
    const files = unpack(
      await request(`/api/screen-setup/setups/${setup.id}/download`, 'POST'),
    );
    const code = `import json, sys\nsys.path.insert(0, 'player')\nfrom wireguard import validate\nfrom agent import connection_settings\nfiles = json.load(sys.stdin)\nassert validate(files['openframe-wg.conf']) == files['openframe-wg.conf']\nassert connection_settings(json.loads(files['openframe.json']))[0] == 'http://10.8.0.1:3100'\n`;
    const result = spawnSync(process.env.OPENFRAME_PYTHON, ['-c', code], {
      input: JSON.stringify(files),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  },
);
