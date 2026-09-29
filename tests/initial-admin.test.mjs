import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const project = fileURLToPath(new URL('..', import.meta.url));
async function start(dataDir, t) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: project,
    windowsHide: true,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: '0',
      HOST: '127.0.0.1',
      PUBLIC_URL: '',
      COOKIE_SECURE: 'false',
      OPENFRAME_WG_SOCKET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  };
  t.after(stop);
  let output = '';
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Server startup timed out')),
      15000,
    );
    const failed = () => {
      clearTimeout(timeout);
      reject(new Error('Server exited before listening'));
    };
    child.once('error', failed);
    child.once('exit', failed);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/OpenFrame: http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        child.removeListener('error', failed);
        child.removeListener('exit', failed);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
  });
  return { base, stop, password: output.match(/Initial password: (\S+)/)?.[1] };
}

void test('fresh server boots seed unique admins; restarts preserve changed passwords and sessions', async (t) => {
  const firstDir = mkdtempSync(
    path.join(os.tmpdir(), 'openframe-first-admin-'),
  );
  const secondDir = mkdtempSync(
    path.join(os.tmpdir(), 'openframe-second-admin-'),
  );
  const running = [];
  t.after(async () => {
    for (const server of running) await server.stop();
    rmSync(firstDir, { recursive: true, force: true });
    rmSync(secondDir, { recursive: true, force: true });
  });
  const first = await start(firstDir, t);
  running.push(first);
  const second = await start(secondDir, t);
  running.push(second);
  assert.match(first.password, /^[A-Za-z0-9_-]{32}$/);
  assert.match(second.password, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(first.password, second.password);
  const post = (base, route, body, cookie = '') =>
    fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await fetch(first.base + '/api/auth').then((r) => r.json())).setup,
    false,
  );
  assert.equal(
    (
      await post(first.base, '/api/setup', {
        password: 'attacker-password-long',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(second.base, '/api/login', {
        username: 'superadmin',
        password: first.password,
      })
    ).status,
    401,
  );
  const login = await post(first.base, '/api/login', {
    username: 'superadmin',
    password: first.password,
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const auth = await fetch(first.base + '/api/auth', {
    headers: { cookie },
  }).then((r) => r.json());
  assert.equal(auth.user.role, 'superadmin');
  const changed = await post(
    first.base,
    '/api/account/password',
    {
      currentPassword: first.password,
      password: 'my-replacement-password-long',
    },
    cookie,
  );
  assert.equal(changed.status, 200);
  const updatedCookie = changed.headers.get('set-cookie').split(';')[0];
  await first.stop();
  const restarted = await start(firstDir, t);
  running.push(restarted);
  assert.equal(restarted.password, undefined);
  const resumed = await fetch(restarted.base + '/api/auth', {
    headers: { cookie: updatedCookie },
  }).then((r) => r.json());
  assert.equal(resumed.authenticated, true);
  assert.equal(resumed.user.username, 'superadmin');
  const revoked = await fetch(restarted.base + '/api/auth', {
    headers: { cookie },
  }).then((r) => r.json());
  assert.equal(revoked.authenticated, false);
  assert.equal(
    (
      await post(restarted.base, '/api/login', {
        username: 'superadmin',
        password: 'my-replacement-password-long',
      })
    ).status,
    200,
  );
  const db = new DatabaseSync(path.join(firstDir, 'openframe.sqlite'), {
    readOnly: true,
  });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
    assert.notEqual(
      db.prepare('SELECT password FROM users').get().password,
      'my-replacement-password-long',
    );
  } finally {
    db.close();
  }
});
