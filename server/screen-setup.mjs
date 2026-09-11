import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { zipSync, strToU8 } from 'fflate';

const fail = (status, message) => Object.assign(new Error(message), { status });
const name = z.string().trim().min(1).max(100);
const origin = z
  .string()
  .trim()
  .max(2048)
  .transform((value, ctx) => {
    try {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        /\s/.test(value)
      )
        throw new Error();
      return url.origin;
    } catch {
      ctx.addIssue({
        code: 'custom',
        message:
          'Use an HTTP or HTTPS server origin without credentials or a path',
      });
      return z.NEVER;
    }
  });
const credential = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[\x21-\x7e]+$/, 'Invalid credential');
const setupSchema = z
  .object({
    name,
    server: origin.optional(),
    vpnId: z.uuid().optional(),
    wifi: z
      .object({
        ssid: z
          .string()
          .min(1)
          .max(32)
          .refine((v) => Buffer.byteLength(v) <= 32, 'SSID exceeds 32 bytes'),
        password: z.string().max(64),
        country: z
          .string()
          .regex(/^[A-Z]{2}$/, 'Use a two-letter country code'),
      })
      .strict()
      .optional(),
    access: z
      .object({ client_id: credential, client_secret: credential })
      .strict()
      .optional(),
  })
  .strict();

// Mirrors the installer's safety filter; interoperability is tested against Python.
export function validateWireGuard(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536)
    throw fail(400, 'WireGuard config must be UTF-8 text, at most 64 KiB');
  const allowed = {
    Interface: [
      'PrivateKey',
      'Address',
      'DNS',
      'MTU',
      'Table',
      'ListenPort',
      'FwMark',
      'SaveConfig',
    ],
    Peer: [
      'PublicKey',
      'PresharedKey',
      'AllowedIPs',
      'Endpoint',
      'PersistentKeepalive',
    ],
  };
  const sections = [],
    lines = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) continue;
    if (line === '[Interface]' || line === '[Peer]') {
      const type = line.slice(1, -1);
      if (
        (!sections.length && type !== 'Interface') ||
        (sections.length && type === 'Interface')
      )
        throw fail(
          400,
          'WireGuard requires one Interface followed by Peer sections',
        );
      sections.push({ type, fields: new Map() });
      lines.push(line);
      continue;
    }
    const eq = line.indexOf('=');
    const field = line.slice(0, eq).trim(),
      value = line.slice(eq + 1).trim();
    const section = sections.at(-1);
    if (/^(preup|postup|predown|postdown)$/i.test(field))
      throw fail(400, 'WireGuard shell hooks are not supported');
    if (
      eq < 0 ||
      !section ||
      !allowed[section.type].includes(field) ||
      !/^[\x20-\x7e]+$/.test(value)
    )
      throw fail(400, 'Unsupported or incomplete WireGuard setting');
    if (
      section.fields.has(field) &&
      !['Address', 'DNS', 'AllowedIPs'].includes(field)
    )
      throw fail(400, 'Duplicate WireGuard setting');
    if (field === 'SaveConfig' && value !== 'false')
      throw fail(400, 'SaveConfig must be false or omitted');
    if (
      ['PrivateKey', 'PublicKey', 'PresharedKey'].includes(field) &&
      (!/^[A-Za-z0-9+/]{43}=$/.test(value) ||
        Buffer.from(value, 'base64').length !== 32)
    )
      throw fail(400, 'Invalid WireGuard key: expected 32-byte base64');
    section.fields.set(field, [...(section.fields.get(field) || []), value]);
    lines.push(`${field} = ${value}`);
  }
  if (
    sections.length < 2 ||
    !sections[0].fields.has('PrivateKey') ||
    !sections[0].fields.has('Address') ||
    sections
      .slice(1)
      .some((s) => !s.fields.has('PublicKey') || !s.fields.has('AllowedIPs')) ||
    !sections.slice(1).some((s) => s.fields.has('Endpoint'))
  )
    throw fail(
      400,
      'Client config requires PrivateKey, Address, Peer PublicKey, AllowedIPs, and an Endpoint',
    );
  const fields = sections[0].fields;
  const privateKey = Buffer.from(fields.get('PrivateKey')[0], 'base64');
  // Equivalent X25519 private scalars must not appear as separate available clients.
  privateKey[0] &= 248;
  privateKey[31] = (privateKey[31] & 127) | 64;
  return {
    text: lines.join('\n') + '\n',
    fingerprint: createHash('sha256').update(privateKey).digest('hex'),
    addresses: fields.get('Address').join(', '),
    endpoints: sections
      .slice(1)
      .flatMap((s) => s.fields.get('Endpoint') || [])
      .join(', '),
    fullTunnel: sections
      .slice(1)
      .some((s) =>
        s.fields
          .get('AllowedIPs')
          .some((v) =>
            v
              .split(',')
              .some((ip) => ['0.0.0.0/0', '::/0'].includes(ip.trim())),
          ),
      ),
  };
}

const instructions = `OpenFrame screen setup\n\nPRIVATE: this bundle can contain VPN, Wi-Fi, and Cloudflare credentials. Keep it off Git and shared drives. Use it for this screen only.\n\nExtract openframe.json and optional openframe-wg.conf together. On an OpenFrame-customized SD image, put both files on the visible boot partition BEFORE first boot. Adding files to a stock Raspberry Pi OS image does not install OpenFrame.\n\nFor an existing dedicated Pi, copy the files together and run:\nsudo bash player/install.sh ./openframe.json\nsudo reboot\n\nFirst boot requires Internet access for OS packages. Wi-Fi must work before WireGuard connects. Approve the displayed pairing code in Screens, then assign a published playlist. Allocation here does not create or revoke a peer on your VPN server and does not approve an OpenFrame device.\n\nBoot-file edits after provisioning are not automatically imported. Preserve each Pi's own identity/cache. Do not reuse an allocated WireGuard client on a different screen. Full-tunnel routes can interrupt SSH.\n`;

export function mountScreenSetup(
  app,
  { admin, db, root, list, get, put, remove },
) {
  const keyPath = path.join(root, 'provisioning.key');
  function key() {
    try {
      if (!existsSync(keyPath)) {
        if (list('vpn-config').length || list('screen-setup').length)
          throw new Error();
        try {
          writeFileSync(keyPath, randomBytes(32), {
            flag: 'wx',
            mode: 0o600,
            flush: true,
          });
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
        }
      }
      if (!lstatSync(keyPath).isFile() || lstatSync(keyPath).isSymbolicLink())
        throw new Error();
      const value = readFileSync(keyPath);
      if (value.length !== 32) throw new Error();
      return value;
    } catch {
      throw fail(
        503,
        'Setup encryption key unavailable. Restore provisioning.key from the matching server backup.',
      );
    }
  }
  function encrypt(value, id) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
  }
  function decrypt(record) {
    const secret = key();
    try {
      const cipher = createDecipheriv(
        'aes-256-gcm',
        secret,
        Buffer.from(record.encrypted.iv, 'base64'),
      );
      cipher.setAAD(Buffer.from(record.id));
      cipher.setAuthTag(Buffer.from(record.encrypted.tag, 'base64'));
      return JSON.parse(
        Buffer.concat([
          cipher.update(Buffer.from(record.encrypted.data, 'base64')),
          cipher.final(),
        ]).toString('utf8'),
      );
    } catch {
      throw fail(
        503,
        'Saved setup cannot be decrypted. Restore the matching server backup.',
      );
    }
  }
  const publicVpn = (v) => ({
    id: v.id,
    name: v.name,
    server: v.server,
    addresses: v.addresses,
    endpoints: v.endpoints,
    fullTunnel: v.fullTunnel,
    assignedTo: v.assignedTo,
    createdAt: v.createdAt,
  });
  const publicSetup = (s) => ({
    id: s.id,
    name: s.name,
    server: s.server,
    vpnId: s.vpnId,
    createdAt: s.createdAt,
  });
  const requireItem = (kind, id) => {
    const value = get(kind, id);
    if (!value) throw fail(404, 'Setup record not found');
    return value;
  };
  app.get('/api/screen-setup', admin, (req, res) =>
    res.json({
      vpns: list('vpn-config').map(publicVpn),
      setups: list('screen-setup').map(publicSetup),
      defaultServer: process.env.PUBLIC_URL || '',
    }),
  );
  app.post('/api/screen-setup/vpns', admin, (req, res) => {
    const input = z
      .object({ name, server: origin, config: z.string().max(65536) })
      .strict()
      .parse(req.body);
    const parsed = validateWireGuard(input.config);
    const vpns = list('vpn-config');
    if (vpns.length >= 500)
      throw fail(409, 'VPN inventory is limited to 500 configs');
    if (vpns.some((v) => v.fingerprint === parsed.fingerprint))
      throw fail(409, 'This WireGuard client key is already in the inventory');
    if (vpns.some((v) => v.name.toLowerCase() === input.name.toLowerCase()))
      throw fail(409, 'A VPN config with that name already exists');
    const id = randomUUID();
    const encrypted = encrypt(parsed.text, id);
    res.status(201).json(
      publicVpn(
        put('vpn-config', {
          id,
          name: input.name,
          server: input.server,
          encrypted,
          fingerprint: parsed.fingerprint,
          addresses: parsed.addresses,
          endpoints: parsed.endpoints,
          fullTunnel: parsed.fullTunnel,
          assignedTo: null,
          createdAt: new Date().toISOString(),
        }),
      ),
    );
  });
  app.delete('/api/screen-setup/vpns/:id', admin, (req, res) => {
    const vpn = requireItem('vpn-config', req.params.id);
    if (vpn.assignedTo)
      throw fail(
        409,
        'Allocated VPN configs cannot be deleted or reused. Revoke the peer on your VPN server when retiring a screen.',
      );
    remove('vpn-config', vpn.id);
    res.json({ ok: true });
  });
  app.post('/api/screen-setup/setups', admin, (req, res) => {
    const input = setupSchema.parse(req.body);
    db.exec('BEGIN IMMEDIATE');
    try {
      const setups = list('screen-setup');
      if (setups.length >= 2000)
        throw fail(409, 'Setup history is limited to 2000 screens');
      if (setups.some((s) => s.name.toLowerCase() === input.name.toLowerCase()))
        throw fail(
          409,
          'A setup with this screen name already exists. Download it from Issued setups.',
        );
      const vpn = input.vpnId ? requireItem('vpn-config', input.vpnId) : null;
      if (vpn?.assignedTo)
        throw fail(409, 'This VPN config is already allocated to a screen');
      const server = vpn?.server || input.server;
      if (!server) throw fail(400, 'A server origin is required');
      if (input.access && !server.startsWith('https://'))
        throw fail(400, 'Cloudflare Access requires an HTTPS server');
      const config = {
        name: input.name,
        server,
        ...(input.wifi
          ? {
              wifi_ssid: input.wifi.ssid,
              wifi_password: input.wifi.password,
              wifi_country: input.wifi.country,
            }
          : {}),
        ...(input.access ? { cloudflare_access: input.access } : {}),
      };
      const id = randomUUID();
      const encrypted = encrypt(
        { config, wireguard: vpn ? decrypt(vpn) : null },
        id,
      );
      const setup = put('screen-setup', {
        id,
        name: input.name,
        server,
        vpnId: vpn?.id || null,
        createdAt: new Date().toISOString(),
        encrypted,
      });
      if (vpn) put('vpn-config', { ...vpn, assignedTo: setup.id });
      db.exec('COMMIT');
      res.status(201).json(publicSetup(setup));
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });
  app.post('/api/screen-setup/setups/:id/download', admin, (req, res) => {
    const setup = requireItem('screen-setup', req.params.id);
    const { config, wireguard } = decrypt(setup);
    const files = {
      'openframe.json': strToU8(JSON.stringify(config, null, 2) + '\n'),
      'SETUP.txt': strToU8(instructions),
    };
    if (wireguard) files['openframe-wg.conf'] = strToU8(wireguard);
    res.set('Cache-Control', 'no-store');
    res.set(
      'Content-Disposition',
      `attachment; filename="openframe-screen-${setup.id}.zip"`,
    );
    res.type('application/zip').send(Buffer.from(zipSync(files)));
  });
}
