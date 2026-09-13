import { isIP } from 'node:net';

export function validKey(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9+/]{43}=$/.test(value) &&
    Buffer.from(value, 'base64').toString('base64') === value &&
    !Buffer.from(value, 'base64').equals(Buffer.alloc(32))
  );
}

export function hostSettings(env) {
  const prefix = env.WG_PREFIX || '10.77.0';
  const address = `${prefix}.1`;
  if (
    isIP(address) !== 4 ||
    !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
  )
    throw new Error('WG_PREFIX must be a private IPv4 /24 prefix');
  const endpoint = env.WG_ENDPOINT || '';
  if (
    !/^(?:[a-zA-Z0-9][a-zA-Z0-9.-]*|\[[a-fA-F0-9:]+\]):\d{1,5}$/.test(endpoint)
  )
    throw new Error(
      'Set WG_ENDPOINT to a reachable DNS name or IP and UDP port',
    );
  const port = Number(endpoint.slice(endpoint.lastIndexOf(':') + 1));
  if (port < 1 || port > 65535)
    throw new Error('Invalid WireGuard endpoint port');
  return {
    prefix,
    address,
    endpoint,
    server: `http://${address}:3100`,
    allowedIPs: `${address}/32`,
  };
}

export function validatePeers(peers, prefix) {
  if (!Array.isArray(peers) || peers.length > 253)
    throw new Error('Invalid peer count');
  const keys = new Set(),
    addresses = new Set();
  return peers.map((peer) => {
    const suffix = Number(peer.address?.slice(prefix.length + 1));
    if (
      !validKey(peer.publicKey) ||
      !Number.isInteger(suffix) ||
      suffix < 2 ||
      suffix > 254 ||
      peer.address !== `${prefix}.${suffix}` ||
      keys.has(peer.publicKey) ||
      addresses.has(peer.address)
    )
      throw new Error('Invalid or duplicate peer');
    keys.add(peer.publicKey);
    addresses.add(peer.address);
    return { publicKey: peer.publicKey, address: peer.address };
  });
}

export function serverConfig(privateKey, peers) {
  return (
    `[Interface]\nPrivateKey = ${privateKey}\nListenPort = 51820\n` +
    peers
      .map(
        (p) =>
          `\n[Peer]\nPublicKey = ${p.publicKey}\nAllowedIPs = ${p.address}/32\n`,
      )
      .join('')
  );
}
