// Runs only in the dedicated NET_ADMIN container, never in the web app process.
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  chmodSync,
  chownSync,
  lstatSync,
} from 'node:fs';
import {
  hostSettings,
  validKey,
  validatePeers,
  serverConfig,
} from './wireguard-core.mjs';

// Never serialize subprocess errors: commands can contain private configuration.
process.on('uncaughtException', () => {
  try {
    execFileSync('ip', ['link', 'set', 'down', 'dev', 'wg-openframe'], {
      timeout: 1000,
      stdio: 'ignore',
    });
  } catch {
    /* Startup may have failed before an interface existed. */
  }
  console.error(
    'WireGuard service failed; check configuration, permissions, and kernel support',
  );
  process.exit(1);
});
const settings = hostSettings(process.env);
const state = '/var/lib/openframe-wireguard';
const control = '/run/openframe-vpn';
const socket = `${control}/control.sock`;
const iface = 'wg-openframe';
process.umask(0o077);
mkdirSync(state, { recursive: true, mode: 0o700 });
mkdirSync(control, { recursive: true });
chownSync(control, 0, 1000);
chmodSync(control, 0o750);
const keyPath = `${state}/server-key.json`;
if (!existsSync(keyPath)) {
  const { privateKey } = generateKeyPairSync('x25519');
  const jwk = privateKey.export({ format: 'jwk' });
  writeFileSync(
    keyPath,
    JSON.stringify({
      privateKey: Buffer.from(jwk.d, 'base64url').toString('base64'),
      publicKey: Buffer.from(jwk.x, 'base64url').toString('base64'),
    }),
    { flag: 'wx', mode: 0o600, flush: true },
  );
}
if (!lstatSync(keyPath).isFile() || lstatSync(keyPath).isSymbolicLink())
  throw new Error('Invalid key file');
const keys = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!validKey(keys.privateKey) || !validKey(keys.publicKey))
  throw new Error('Invalid server key; restore a matching backup');
function command(name, args) {
  return execFileSync(name, args, {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function apply(peers) {
  const temporary = `${state}/interface.tmp`;
  writeFileSync(temporary, serverConfig(keys.privateKey, peers), {
    mode: 0o600,
  });
  try {
    command('wg', ['syncconf', iface, temporary]);
  } finally {
    unlinkSync(temporary);
  }
}
// A container restart must not retain peers until the app re-authorizes them.
try {
  command('ip', ['link', 'show', iface]);
  command('ip', ['link', 'delete', iface]);
} catch {
  /* A new namespace has no interface yet. */
}
command('ip', ['link', 'add', iface, 'type', 'wireguard']);
command('ip', ['address', 'add', `${settings.address}/24`, 'dev', iface]);
command('ip', ['link', 'set', 'dev', iface, 'mtu', '1420']);
// Only the app port is reachable. No forwarding to LAN, other peers, or Internet.
function rule(chain, args) {
  try {
    command('iptables', ['-w', '-C', chain, ...args]);
  } catch {
    command('iptables', ['-w', '-I', chain, '1', ...args]);
  }
}
rule('INPUT', ['-i', iface, '-j', 'DROP']);
rule('INPUT', [
  '-i',
  iface,
  '-d',
  settings.address,
  '-p',
  'tcp',
  '--dport',
  '3100',
  '-j',
  'ACCEPT',
]);
rule('FORWARD', ['-i', iface, '-j', 'DROP']);
rule('FORWARD', ['-o', iface, '-j', 'DROP']);
apply([]);
command('ip', ['link', 'set', 'up', 'dev', iface]);
let peers = [];
let lease = 0;
const watchdog = setInterval(() => {
  if (peers.length && performance.now() > lease) {
    try {
      apply([]);
      peers = [];
    } catch {
      command('ip', ['link', 'set', 'down', 'dev', iface]);
      process.exit(1);
    }
  }
}, 5000);
if (existsSync(socket)) {
  if (!lstatSync(socket).isSocket())
    throw new Error('Control socket path is occupied');
  unlinkSync(socket);
}
const service = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'PUT' && req.url === '/peers') {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) throw new Error('Too large');
        chunks.push(chunk);
      }
      const desired = validatePeers(
        JSON.parse(Buffer.concat(chunks)).peers,
        settings.prefix,
      );
      if (desired.some((p) => p.publicKey === keys.publicKey))
        throw new Error('A client cannot use the server identity');
      apply(desired);
      peers = desired;
      lease = performance.now() + 45000;
      res.end(
        JSON.stringify({
          ...settings,
          publicKey: keys.publicKey,
          peers: peers.length,
        }),
      );
    } else if (req.method === 'GET' && req.url === '/status') {
      res.end(
        JSON.stringify({
          ...settings,
          publicKey: keys.publicKey,
          peers: peers.length,
        }),
      );
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  } catch {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: 'WireGuard operation failed' }));
  }
});
service.requestTimeout = 5000;
service.headersTimeout = 5000;
service.listen(socket, () => {
  chownSync(socket, 0, 1000);
  chmodSync(socket, 0o660);
});
function stop() {
  clearInterval(watchdog);
  try {
    apply([]);
  } catch {
    command('ip', ['link', 'set', 'down', 'dev', iface]);
  }
  service.close(() => process.exit(0));
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
