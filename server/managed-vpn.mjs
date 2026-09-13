import { request as httpRequest } from 'node:http';
import { validKey } from './wireguard-core.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
export function vpnTransport(socketPath) {
  return (method, path, body) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          socketPath,
          path,
          method,
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let length = 0;
          const chunks = [];
          res.on('data', (chunk) => {
            length += chunk.length;
            if (length > 65536)
              req.destroy(new Error('Oversized VPN response'));
            else chunks.push(chunk);
          });
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) throw new Error();
              resolve(JSON.parse(Buffer.concat(chunks)));
            } catch {
              reject(fail(503, 'Managed WireGuard service unavailable'));
            }
          });
          res.on('error', () =>
            reject(fail(503, 'Managed WireGuard service unavailable')),
          );
        },
      );
      req.setTimeout(5000, () => req.destroy());
      req.on('error', () =>
        reject(fail(503, 'Managed WireGuard service unavailable')),
      );
      req.end(body ? JSON.stringify(body) : undefined);
    });
}

export function mountManagedVpn(
  app,
  {
    admin,
    player,
    list,
    get,
    put,
    socketPath = process.env.OPENFRAME_WG_SOCKET,
    transport,
  },
) {
  const enabled = Boolean(socketPath || transport);
  const rpc = transport || vpnTransport(socketPath);
  let queue = Promise.resolve();
  let pending = 0;
  function serial(action) {
    if (pending >= 32)
      return Promise.reject(fail(429, 'VPN setup is busy. Retry shortly.'));
    pending++;
    const next = queue.then(action).finally(() => {
      pending--;
    });
    queue = next.catch(() => {});
    return next;
  }
  const selected = () =>
    list('device').filter(
      (d) => d.approved && d.wireguardPublicKey && d.wireguardAddress,
    );
  async function readHost() {
    const host = await rpc('GET', '/status');
    const previous = get('managed-vpn', 'host');
    if (
      previous &&
      (previous.publicKey !== host.publicKey || previous.prefix !== host.prefix)
    )
      throw fail(
        503,
        'WireGuard identity or subnet changed. Restore the matching VPN backup.',
      );
    if (!previous)
      put('managed-vpn', {
        id: 'host',
        publicKey: host.publicKey,
        prefix: host.prefix,
      });
    return host;
  }
  async function reconcile() {
    await readHost();
    return rpc('PUT', '/peers', {
      peers: selected().map((d) => ({
        publicKey: d.wireguardPublicKey,
        address: d.wireguardAddress,
      })),
    });
  }
  const timer = enabled
    ? setInterval(() => {
        if (!pending) void serial(reconcile).catch(() => {});
      }, 10000)
    : null;
  timer?.unref();
  if (enabled) void serial(reconcile).catch(() => {});
  app.get('/api/managed-vpn', admin, async (req, res) => {
    if (!enabled) return res.json({ enabled: false, peers: [] });
    const status = await serial(reconcile);
    res.json({
      enabled: true,
      ...status,
      peers: selected().map((d) => ({
        id: d.id,
        name: d.name,
        address: d.wireguardAddress,
      })),
    });
  });
  app.post('/api/player/provision', player, async (req, res) => {
    if (!enabled)
      throw fail(503, 'Managed WireGuard is not enabled on this server');
    const result = await serial(async () => {
      // Re-read after waiting in the queue; approval/revocation may have changed.
      let device = get('device', req.device.id);
      if (!device) throw fail(401, 'Device credentials invalid');
      if (!device.approved) return { approved: false, code: device.code };
      if (!validKey(device.wireguardPublicKey))
        throw fail(400, 'Enroll with a WireGuard public key first');
      const host = await readHost();
      if (!device.wireguardAddress) {
        const used = new Set(list('device').map((d) => d.wireguardAddress));
        const address = Array.from(
          { length: 253 },
          (_, i) => `${host.prefix}.${i + 2}`,
        ).find((a) => !used.has(a));
        if (!address) throw fail(409, 'Managed WireGuard address pool is full');
        // Revocation may have happened while the helper was being contacted.
        device = get('device', device.id);
        if (!device?.approved) throw fail(403, 'Device approval required');
        device = put('device', { ...device, wireguardAddress: address });
      }
      const applied = await reconcile();
      if (!get('device', device.id)?.approved)
        throw fail(403, 'Device approval required');
      return {
        approved: true,
        wireguard: {
          address: `${device.wireguardAddress}/32`,
          publicKey: applied.publicKey,
          endpoint: applied.endpoint,
          allowedIPs: applied.allowedIPs,
          server: applied.server,
        },
      };
    });
    res.json(result);
  });
  return {
    enabled,
    validateEnrollment(key) {
      if (key === undefined) return;
      if (!enabled)
        throw fail(503, 'Managed WireGuard is not enabled on this server');
      if (!validKey(key)) throw fail(400, 'Invalid WireGuard public key');
      if (list('device').some((d) => d.wireguardPublicKey === key))
        throw fail(409, 'This WireGuard identity is already enrolled');
    },
    async revoked() {
      if (enabled) await serial(reconcile);
    },
    close() {
      if (timer) clearInterval(timer);
    },
  };
}
