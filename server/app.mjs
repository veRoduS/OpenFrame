import { createStockCache, stockSymbols } from './stocks.mjs';
import express from 'express';
import { createAccounts } from './accounts.mjs';
import { mountAndroidReleases } from './android-releases.mjs';
import { mountScreenSetup } from './screen-setup.mjs';
import { mountManagedVpn } from './managed-vpn.mjs';
import { mountRecovery } from './recovery.mjs';
import { createWeatherCache } from './weather.mjs';
import { createZipLookup } from './zip.mjs';
import packageInfo from '../package.json' with { type: 'json' };
import multer from 'multer';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  slideSchema,
  playlistSchema,
  deviceSchema,
  assetPatchSchema,
  assetBatchSchema,
  folderSchema,
} from './schema.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const { version } = packageInfo;
const secret = () => randomBytes(32).toString('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

export function createApp({
  dataDir = process.env.DATA_DIR || './data',
  managedVpnTransport,
  weatherFetch,
  stockFetch,
  stockNow,
  zipFetch,
  androidReleaseDir,
  androidReleaseSource = process.env.ANDROID_RELEASE_SOURCE ||
    (androidReleaseDir || process.env.ANDROID_RELEASE_DIR ? 'local' : 'github'),
  androidReleaseFetch,
  androidReleaseNow,
} = {}) {
  const root = path.resolve(dataDir);
  mkdirSync(path.join(root, 'media'), { recursive: true });
  const db = new DatabaseSync(path.join(root, 'openframe.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS custom_fonts (id TEXT PRIMARY KEY, family TEXT NOT NULL COLLATE NOCASE UNIQUE, filename TEXT NOT NULL UNIQUE, format TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL);`);
  const accounts = createAccounts(db);
  const allRecords = (kind) =>
    db
      .prepare('SELECT body FROM records WHERE kind=?')
      .all(kind)
      .map((r) => JSON.parse(r.body));
  const weather = createWeatherCache({ db, fetcher: weatherFetch });
  const zipLookup = createZipLookup({ fetcher: zipFetch });
  const list = (kind) =>
    db
      .prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC')
      .all(kind)
      .map((r) => JSON.parse(r.body))
      .filter((r) => accounts.allowed(kind, r.id));
  const get = (kind, id) => {
    if (!accounts.allowed(kind, id)) return null;
    const r = db
      .prepare('SELECT body FROM records WHERE kind=? AND id=?')
      .get(kind, id);
    return r ? JSON.parse(r.body) : null;
  };
  const put = (kind, item) => {
    const exists = db
      .prepare('SELECT 1 FROM records WHERE kind=? AND id=?')
      .get(kind, item.id);
    if (exists && !accounts.allowed(kind, item.id))
      throw fail(404, 'Not found');
    const state = accounts.context.getStore();
    if (state && ['slide', 'playlist', 'device', 'asset'].includes(kind)) {
      const audiences = db
        .prepare(
          'SELECT userId,groupId FROM resource_grants WHERE kind=? AND id=?',
        )
        .all(kind, item.id);
      const ownerId = db
        .prepare('SELECT ownerId FROM resource_access WHERE kind=? AND id=?')
        .get(kind, item.id)?.ownerId;
      if (ownerId) audiences.push({ userId: ownerId, groupId: '' });
      if (!exists && state.groupId)
        audiences.push({ userId: '', groupId: state.groupId });
      for (const [childKind, childId] of dependencies(kind, item)) {
        if (childKind === 'asset') continue;
        if (!accounts.allowed(childKind, childId))
          throw fail(404, 'Referenced item not found');
        for (const audience of audiences) {
          const granted = audience.userId
            ? accounts.can(
                db
                  .prepare('SELECT * FROM users WHERE id=?')
                  .get(audience.userId),
                childKind,
                childId,
              )
            : accounts.groupCan(audience.groupId, childKind, childId);
          if (!granted)
            throw fail(
              409,
              'Share the referenced content with the owner and all recipients first',
            );
        }
      }
    }
    if (!exists) accounts.created(kind, item.id);
    db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?)').run(
      kind,
      item.id,
      JSON.stringify(item),
    );
    return item;
  };
  const remove = (kind, id) =>
    db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id);
  const requireRecord = (kind, id) => {
    const record = get(kind, id);
    if (!record) throw fail(404, 'Not found');
    return record;
  };
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin
    ) {
      const expected = process.env.PUBLIC_URL
        ? new URL(process.env.PUBLIC_URL).origin
        : `${req.protocol}://${req.get('host')}`;
      if (req.headers.origin !== expected)
        return res.status(403).json({ error: 'Origin not allowed' });
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  mountAndroidReleases(app, {
    source: androidReleaseSource,
    directory: path.resolve(
      androidReleaseDir ||
        process.env.ANDROID_RELEASE_DIR ||
        fileURLToPath(new URL('../outputs/android/', import.meta.url)),
    ),
    fetcher: androidReleaseFetch,
    now: androidReleaseNow,
  });
  const limits = new Map();
  function rateLimit(req, res, next) {
    const now = Date.now();
    for (const [key, value] of limits)
      if (value.until < now) limits.delete(key);
    const route =
      typeof req.route?.path === 'string'
        ? req.route.path
        : req.path.toLowerCase().replace(/\/+$/, '');
    const key = `${req.ip}:${route}`;
    const bucket = limits.get(key) || { count: 0, until: now + 60000 };
    limits.set(key, bucket);
    if (++bucket.count > 15)
      return res
        .status(429)
        .json({ error: 'Too many attempts. Try again in a minute.' });
    next();
  }
  const { admin, administrator, session } = accounts;
  const player = (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const device =
      token && list('device').find((d) => d.tokenHash === hash(token));
    if (!device)
      return res.status(401).json({
        error: 'Device credentials invalid',
        code: 'DEVICE_CREDENTIALS_INVALID',
      });
    req.device = device;
    next();
  };
  app.get('/api/health', (req, res) => res.json({ ok: true, version }));
  accounts.mount(app, rateLimit);
  const vault = mountScreenSetup(app, {
    admin: administrator,
    db,
    root,
    list,
    get,
    put,
    remove,
  });
  const stockRecord = () =>
    db
      .prepare(
        "SELECT body FROM records WHERE kind='integration' AND id='stock-provider'",
      )
      .get();
  const stockToken = () => {
    const row = stockRecord();
    return row ? vault.decrypt(JSON.parse(row.body)).token : '';
  };
  const stocks = createStockCache({
    db,
    token: stockToken,
    fetcher: stockFetch,
    now: stockNow,
  });
  app.get('/api/settings/stocks', administrator, (req, res) =>
    res.json({ configured: !!stockRecord() }),
  );
  app.put('/api/settings/stocks', administrator, (req, res) => {
    const { token } = z
      .object({
        token: z.union([
          z.literal(''),
          z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9._-]{10,200}$/),
        ]),
      })
      .parse(req.body);
    if (!token)
      db.prepare(
        "DELETE FROM records WHERE kind='integration' AND id='stock-provider'",
      ).run();
    else {
      const record = {
        id: 'stock-provider',
        encrypted: vault.encrypt({ token }, 'stock-provider'),
      };
      db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?)').run(
        'integration',
        record.id,
        JSON.stringify(record),
      );
    }
    stocks.reset();
    res.json({ configured: !!token });
  });
  app.get('/api/stocks', admin, (req, res) => {
    const symbols = stockSymbols.parse(
      String(req.query.symbols || '').split(','),
    );
    res.json(
      Object.fromEntries(
        symbols.map((symbol) => [symbol, stocks.read(symbol)]),
      ),
    );
  });
  const recovery = mountRecovery(app, {
    admin,
    player,
    get,
    put,
    remove,
    vault,
  });
  const managedVpn = mountManagedVpn(app, {
    admin: administrator,
    player,
    list,
    get,
    put,
    transport: managedVpnTransport,
  });
  const publicDevice = (d) => {
    const { tokenHash: _tokenHash, ...rest } = d;
    return rest;
  };
  const publicAsset = (a) => ({
    tags: [],
    folderId: null,
    createdAt: null,
    ...a,
  });
  const grants = (kind, id) =>
    db
      .prepare(
        'SELECT userId,groupId FROM resource_grants WHERE kind=? AND id=?',
      )
      .all(kind, id);
  function canShare(user, kind, id) {
    return (
      user.role === 'admin' ||
      db
        .prepare(
          'SELECT 1 FROM resource_access WHERE kind=? AND id=? AND ownerId=?',
        )
        .get(kind, id, user.id)
    );
  }
  function dependencies(kind, item) {
    if (kind === 'folder')
      return [
        ...allRecords('asset')
          .filter((a) => a.folderId === item.id)
          .map((a) => ['asset', a.id]),
        ...allRecords('folder')
          .filter((f) => f.parentId === item.id)
          .map((f) => ['folder', f.id]),
      ];
    if (kind === 'slide')
      return item.layers
        .filter((l) => l.type === 'image' && !l.removedMedia)
        .map((l) => ['asset', l.assetId]);
    if (kind === 'playlist')
      return [
        ...item.items.map((i) => ['slide', i.slideId]),
        ...(item.published?.assets || []).map((a) => ['asset', a.id]),
      ];
    if (kind === 'device' && item.playlistId)
      return [['playlist', item.playlistId]];
    return [];
  }
  function grantTree(user, kind, id, target, visited = new Set()) {
    const key = `${kind}:${id}`;
    if (visited.has(key)) return;
    visited.add(key);
    const item = requireRecord(kind, id);
    const exists = grants(kind, id).some(
      (g) => g.userId === target.userId && g.groupId === target.groupId,
    );
    if (!exists && !canShare(user, kind, id))
      throw fail(
        403,
        'Only the owner or admin can share this item and its contents',
      );
    if (!exists)
      db.prepare('INSERT INTO resource_grants VALUES (?,?,?,?)').run(
        kind,
        id,
        target.userId,
        target.groupId,
      );
    for (const [childKind, childId] of dependencies(kind, item)) {
      // Embedded media stays owned and editable only by its media audience.
      if (childKind === 'asset' && kind !== 'folder') continue;
      grantTree(user, childKind, childId, target, visited);
    }
  }
  app.get('/api/users/:id/access', administrator, (req, res) => {
    const user = db
      .prepare('SELECT * FROM users WHERE id=?')
      .get(req.params.id);
    if (!user) throw fail(404, 'User not found');
    res.json(
      ['device', 'slide', 'playlist', 'asset', 'folder'].flatMap((kind) =>
        allRecords(kind).map((item) => {
          const audience = grants(kind, item.id);
          const direct = audience.some((grant) => grant.userId === user.id);
          const owner =
            db
              .prepare(
                'SELECT ownerId FROM resource_access WHERE kind=? AND id=?',
              )
              .get(kind, item.id)?.ownerId === user.id;
          const viaGroups = audience
            .filter(
              (grant) => grant.groupId && accounts.member(user, grant.groupId),
            )
            .map(
              (grant) =>
                db
                  .prepare('SELECT name FROM groups WHERE id=?')
                  .get(grant.groupId)?.name,
            )
            .filter(Boolean);
          return {
            kind,
            id: item.id,
            name: item.name,
            direct,
            owner,
            viaGroups,
            effective: accounts.can(user, kind, item.id),
            readOnly:
              kind === 'asset' &&
              !accounts.can(user, kind, item.id) &&
              !!accounts.canViewAsset(user, item.id),
          };
        }),
      ),
    );
  });
  app.get('/api/access/:kind/:id', admin, (req, res) => {
    const { kind, id } = req.params;
    if (!['slide', 'asset', 'playlist', 'folder', 'device'].includes(kind))
      throw fail(400, 'Invalid resource');
    requireRecord(kind, id);
    res.json({
      canShare: !!canShare(req.user, kind, id),
      grants: grants(kind, id),
    });
  });
  app.post('/api/access/:kind/:id', admin, (req, res) => {
    const { kind, id } = req.params;
    if (!['slide', 'asset', 'playlist', 'folder', 'device'].includes(kind))
      throw fail(400, 'Invalid resource');
    const target = z
      .object({
        userId: z.string().default(''),
        groupId: z.string().default(''),
        remove: z.boolean().default(false),
      })
      .parse(req.body);
    if (!!target.userId === !!target.groupId)
      throw fail(400, 'Choose one user or group');
    requireRecord(kind, id);
    if (!canShare(req.user, kind, id))
      throw fail(403, 'Owner or admin required');
    if (
      target.userId &&
      (req.user.role !== 'admin' ||
        !db
          .prepare('SELECT id FROM users WHERE id=? AND (disabled=0 OR ?=1)')
          .get(target.userId, Number(target.remove)))
    )
      throw fail(403, 'Admin assigns users');
    if (
      target.groupId &&
      (!db.prepare('SELECT id FROM groups WHERE id=?').get(target.groupId) ||
        (!target.remove &&
          req.user.role !== 'admin' &&
          !accounts.member(req.user, target.groupId)))
    )
      throw fail(403, 'Join the group before sharing');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (target.remove)
        db.prepare(
          'DELETE FROM resource_grants WHERE kind=? AND id=? AND userId=? AND groupId=?',
        ).run(kind, id, target.userId, target.groupId);
      else grantTree(req.user, kind, id, target);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ ok: true });
  });
  app.get('/api/library', admin, (req, res) => {
    const groups = db
      .prepare(
        'SELECT id,name,parentId FROM groups ORDER BY name COLLATE NOCASE',
      )
      .all()
      .filter(
        (group) =>
          req.user.role === 'admin' || accounts.member(req.user, group.id),
      );
    const visibleGroups = new Set(groups.map((group) => group.id));
    const withGroups = (kind, item) => ({
      ...item,
      groupIds: grants(kind, item.id)
        .map((grant) => grant.groupId)
        .filter((id) => visibleGroups.has(id)),
    });
    res.json({
      groups,
      slides: list('slide').map((item) => withGroups('slide', item)),
      playlists: list('playlist').map(({ published, ...p }) => ({
        ...withGroups('playlist', p),
        publishedAt: published?.publishedAt || null,
        publishedSlideIds:
          published?.items
            ?.map((item) => item.slide?.id ?? item.slideId)
            .filter(Boolean) || [],
      })),
      assets: allRecords('asset')
        .filter((asset) => accounts.canViewAsset(req.user, asset.id))
        .map((asset) => ({
          ...publicAsset(asset),
          readOnly: !accounts.can(req.user, 'asset', asset.id),
        })),
      folders: list('folder'),
      devices: list('device').map((item) =>
        withGroups('device', publicDevice(item)),
      ),
    });
  });
  function checkImages(slide, user) {
    for (const layer of slide.layers) {
      if (layer.type !== 'image') continue;
      if (layer.removedMedia) continue;
      const asset = allRecords('asset').find(
        (item) => item.id === layer.assetId,
      );
      if (!asset || !accounts.canViewAsset(user, asset.id))
        throw fail(404, 'Referenced item not found');
    }
  }
  function checkFonts(slide) {
    for (const layer of slide.layers) {
      if (
        layer.fontId &&
        !db.prepare('SELECT 1 FROM custom_fonts WHERE id=?').get(layer.fontId)
      )
        throw fail(400, 'A selected custom font is no longer available');
    }
  }
  app.post('/api/slides', admin, (req, res) => {
    const slide = slideSchema.parse(req.body);
    checkImages(slide, req.user);
    checkFonts(slide);
    res.status(201).json(
      put('slide', {
        ...slide,
        id: randomUUID(),
        updatedAt: new Date().toISOString(),
      }),
    );
  });
  app.put('/api/slides/:id', admin, (req, res) => {
    requireRecord('slide', req.params.id);
    const slide = slideSchema.parse(req.body);
    checkImages(slide, req.user);
    checkFonts(slide);
    const saved = put('slide', {
      ...slide,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    });
    refreshPublishedSlide(saved);
    res.json(saved);
  });
  app.delete('/api/slides/:id', admin, (req, res) => {
    requireRecord('slide', req.params.id);
    if (
      allRecords('playlist').some((p) =>
        p.items.some((i) => i.slideId === req.params.id),
      )
    )
      throw fail(409, 'Remove this slide from playlists first');
    remove('slide', req.params.id);
    res.json({ ok: true });
  });
  function validatePlaylist(body) {
    const p = playlistSchema.parse(body);
    p.items.forEach((i) => requireRecord('slide', i.slideId));
    return p;
  }
  function playlistShareChanges(user, playlistId, candidate) {
    const targets = [];
    const playlistOwner = playlistId
      ? db
          .prepare('SELECT ownerId FROM resource_access WHERE kind=? AND id=?')
          .get('playlist', playlistId)?.ownerId
      : user.id;
    if (playlistOwner)
      targets.push({
        userId: playlistOwner,
        groupId: '',
        label:
          db.prepare('SELECT name FROM users WHERE id=?').get(playlistOwner)
            ?.name || 'Playlist owner',
      });
    if (playlistId) {
      for (const grant of grants('playlist', playlistId)) {
        targets.push({
          ...grant,
          label: grant.userId
            ? db.prepare('SELECT name FROM users WHERE id=?').get(grant.userId)
                ?.name || 'Shared user'
            : db
                .prepare('SELECT name FROM groups WHERE id=?')
                .get(grant.groupId)?.name || 'Shared group',
        });
      }
    }
    const resources = new Map();
    for (const { slideId } of candidate.items) {
      const slide = requireRecord('slide', slideId);
      resources.set(`slide:${slide.id}`, {
        kind: 'slide',
        id: slide.id,
        name: slide.name,
      });
      for (const layer of slide.layers) {
        if (layer.type !== 'image' || !layer.assetId) continue;
        if (layer.removedMedia) continue;
        const asset = allRecords('asset').find(
          (item) => item.id === layer.assetId,
        );
        if (!asset || !accounts.canViewAsset(user, asset.id))
          throw fail(404, 'Referenced media not found');
        resources.set(`asset:${asset.id}`, {
          kind: 'asset',
          id: asset.id,
          name: asset.name,
        });
      }
    }
    const changes = [];
    for (const resource of resources.values()) {
      for (const target of targets) {
        const accessible = target.userId
          ? accounts.can(
              db.prepare('SELECT * FROM users WHERE id=?').get(target.userId),
              resource.kind,
              resource.id,
            )
          : accounts.groupCan(target.groupId, resource.kind, resource.id);
        if (accessible) continue;
        const canShare = !!canShareResource(user, resource.kind, resource.id);
        changes.push({
          ...resource,
          target: { userId: target.userId, groupId: target.groupId },
          targetLabel: target.label,
          canShare,
        });
      }
    }
    return changes;
  }
  function canShareResource(user, kind, id) {
    return (
      user.role === 'admin' ||
      !!db
        .prepare(
          'SELECT 1 FROM resource_access WHERE kind=? AND id=? AND ownerId=?',
        )
        .get(kind, id, user.id)
    );
  }
  app.post('/api/playlists/:id/share-plan', admin, (req, res) => {
    const playlistId = req.params.id === 'new' ? '' : req.params.id;
    if (playlistId) requireRecord('playlist', playlistId);
    const candidate = validatePlaylist(req.body);
    res.json(playlistShareChanges(req.user, playlistId, candidate));
  });
  app.post('/api/playlists/:id/share-apply', admin, (req, res) => {
    const changes = z
      .array(
        z.object({
          kind: z.enum(['slide', 'asset']),
          id: z.string(),
          target: z.object({ userId: z.string(), groupId: z.string() }),
        }),
      )
      .parse(req.body);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const change of changes) {
        if (!!change.target.userId === !!change.target.groupId)
          throw fail(400, 'Choose one sharing recipient');
        requireRecord(change.kind, change.id);
        if (!canShareResource(req.user, change.kind, change.id))
          throw fail(403, 'You cannot share one or more referenced items');
        if (
          change.target.userId &&
          (req.user.role !== 'admin' ||
            !db
              .prepare('SELECT id FROM users WHERE id=? AND disabled=0')
              .get(change.target.userId))
        )
          throw fail(403, 'Only an admin can share with individual users');
        if (
          change.target.groupId &&
          (!db
            .prepare('SELECT id FROM groups WHERE id=?')
            .get(change.target.groupId) ||
            (req.user.role !== 'admin' &&
              !accounts.member(req.user, change.target.groupId)))
        )
          throw fail(403, 'Join the recipient group before sharing');
        db.prepare(
          'INSERT OR IGNORE INTO resource_grants VALUES (?,?,?,?)',
        ).run(
          change.kind,
          change.id,
          change.target.userId,
          change.target.groupId,
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ ok: true });
  });
  app.post('/api/playlists', admin, (req, res) =>
    res.status(201).json(
      put('playlist', {
        ...validatePlaylist(req.body),
        id: randomUUID(),
        updatedAt: new Date().toISOString(),
      }),
    ),
  );
  app.put('/api/playlists/:id', admin, (req, res) => {
    const p = requireRecord('playlist', req.params.id);
    res.json(
      put('playlist', {
        ...p,
        ...validatePlaylist(req.body),
        updatedAt: new Date().toISOString(),
      }),
    );
  });
  app.delete('/api/playlists/:id', admin, (req, res) => {
    requireRecord('playlist', req.params.id);
    if (allRecords('device').some((d) => d.playlistId === req.params.id))
      throw fail(409, 'Unassign this playlist from devices first');
    remove('playlist', req.params.id);
    res.json({ ok: true });
  });
  function playlistAssets(items) {
    const imageIds = new Set(
      items.flatMap((item) =>
        item.slide.layers
          .filter((layer) => layer.type === 'image' && !layer.removedMedia)
          .map((layer) => layer.assetId),
      ),
    );
    const fontIds = new Set(
      items.flatMap((item) =>
        item.slide.layers.map((layer) => layer.fontId).filter(Boolean),
      ),
    );
    const assets = [...imageIds].map((id) => {
      const asset = allRecords('asset').find((item) => item.id === id);
      if (!asset) throw fail(404, 'Referenced media not found');
      return asset;
    });
    for (const id of fontIds) {
      const font = db
        .prepare(
          'SELECT id,family,filename,format,bytes,sha256 FROM custom_fonts WHERE id=?',
        )
        .get(id);
      if (!font) throw fail(404, 'Referenced font not found');
      assets.push({
        ...font,
        name: font.family,
        kind: 'font',
        url: `/media/${String(font.filename)}`,
      });
    }
    return assets;
  }
  function snapshot(p) {
    const items = p.items.map((item) => ({
      duration: item.duration,
      startsAt: item.scheduleEnabled === false ? null : (item.startsAt ?? null),
      scheduleEnabled: item.scheduleEnabled,
      expiresAt:
        item.scheduleEnabled === false ? null : (item.expiresAt ?? null),
      slide: requireRecord('slide', item.slideId),
    }));
    return {
      schemaVersion: items.some((item) =>
        item.slide.layers.some(
          (layer) =>
            ['shape', 'stocks'].includes(layer.type) ||
            (layer.type === 'weather' && layer.weather?.layout === 'vertical'),
        ),
      )
        ? 3
        : 2,
      revision: randomUUID(),
      name: p.name,
      publishedAt: new Date().toISOString(),
      transition: p.transition || { type: 'cut', durationMs: 500 },
      items,
      assets: playlistAssets(items),
    };
  }
  function refreshPublishedSlide(slide) {
    const rows = db
      .prepare("SELECT id,body FROM records WHERE kind='playlist'")
      .all();
    for (const row of rows) {
      const playlist = JSON.parse(row.body);
      const published = playlist.published;
      if (!published?.items?.some((item) => item.slide?.id === slide.id))
        continue;
      const items = published.items.map((item) =>
        item.slide?.id === slide.id ? { ...item, slide } : item,
      );
      playlist.published = {
        ...published,
        revision: randomUUID(),
        publishedAt: new Date().toISOString(),
        items,
        assets: playlistAssets(items),
      };
      db.prepare(
        "UPDATE records SET body=? WHERE kind='playlist' AND id=?",
      ).run(JSON.stringify(playlist), playlist.id);
    }
  }
  app.post('/api/playlists/:id/publish', admin, (req, res) => {
    const p = requireRecord('playlist', req.params.id);
    if (!p.items.length)
      throw fail(400, 'Add at least one slide before publishing');
    p.published = snapshot(p);
    put('playlist', p);
    res.json({ publishedAt: p.published.publishedAt });
  });
  app.get('/api/preview/:id', admin, (req, res) => {
    const manifest = snapshot(requireRecord('playlist', req.params.id));
    manifest.revision = hash(
      JSON.stringify([manifest.items, manifest.assets, manifest.transition]),
    );
    res.json({
      ...manifest,
      weather: weather.forManifest(manifest),
      stocks: stocks.forManifest(manifest),
    });
  });
  app.get('/api/weather/zip', admin, async (req, res) => {
    res.json(await zipLookup.lookup(req.query.zip));
  });
  app.get('/api/weather', admin, (req, res) => {
    const config = z
      .object({
        latitude: z
          .string()
          .trim()
          .min(1)
          .transform(Number)
          .pipe(z.number().min(-90).max(90)),
        longitude: z
          .string()
          .trim()
          .min(1)
          .transform(Number)
          .pipe(z.number().min(-180).max(180)),
      })
      .parse(req.query);
    res.json(weather.read(config));
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  });
  const fontUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  const fontFormats = {
    woff2: { signature: 'wOF2', mime: 'font/woff2' },
    woff: { signature: 'wOFF', mime: 'font/woff' },
    ttf: { signature: '\u0000\u0001\u0000\u0000', mime: 'font/ttf' },
    otf: { signature: 'OTTO', mime: 'font/otf' },
  };
  const fontList = () =>
    db
      .prepare(
        'SELECT id,family,format,bytes FROM custom_fonts ORDER BY family COLLATE NOCASE',
      )
      .all()
      .map((font) => ({ ...font, url: `/api/fonts/${String(font.id)}/file` }));
  app.get('/api/fonts', admin, (_req, res) => res.json(fontList()));
  app.get('/api/fonts/:id/file', admin, (req, res) => {
    const font = db
      .prepare('SELECT filename,format FROM custom_fonts WHERE id=?')
      .get(req.params.id);
    if (!font || !existsSync(path.join(root, 'media', font.filename)))
      throw fail(404, 'Font not found');
    res.type(fontFormats[font.format].mime);
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(path.join(root, 'media', font.filename));
  });
  app.post(
    '/api/fonts',
    accounts.administrator,
    fontUpload.single('file'),
    (req, res) => {
      if (!req.file) throw fail(400, 'Choose a font file');
      const family = z.string().trim().min(1).max(80).parse(req.body.family);
      const format = path.extname(req.file.originalname).slice(1).toLowerCase();
      const definition = fontFormats[format];
      if (
        !definition ||
        req.file.buffer.subarray(0, 4).toString('latin1') !==
          definition.signature
      )
        throw fail(400, 'Use a valid WOFF2, WOFF, TTF, or OTF font file');
      if (
        db
          .prepare('SELECT 1 FROM custom_fonts WHERE family=? COLLATE NOCASE')
          .get(family)
      )
        throw fail(409, 'A font with that name already exists');
      const id = randomUUID();
      const filename = `${id}.${format}`;
      const font = {
        id,
        family,
        filename,
        format,
        bytes: req.file.size,
        sha256: hash(req.file.buffer),
      };
      writeFileSync(path.join(root, 'media', filename), req.file.buffer, {
        flag: 'wx',
      });
      try {
        db.prepare('INSERT INTO custom_fonts VALUES (?,?,?,?,?,?)').run(
          id,
          family,
          filename,
          format,
          req.file.size,
          font.sha256,
        );
      } catch (error) {
        unlinkSync(path.join(root, 'media', filename));
        throw error;
      }
      res.status(201).json({
        id,
        family,
        format,
        bytes: font.bytes,
        url: `/api/fonts/${id}/file`,
      });
    },
  );
  app.delete('/api/fonts/:id', accounts.administrator, (req, res) => {
    const font = db
      .prepare('SELECT filename FROM custom_fonts WHERE id=?')
      .get(req.params.id);
    if (!font) throw fail(404, 'Font not found');
    const usedInDraft = allRecords('slide').some((slide) =>
      slide.layers.some((layer) => layer.fontId === req.params.id),
    );
    const usedInPublished = allRecords('playlist').some((playlist) =>
      playlist.published?.assets?.some(
        (asset) => asset.kind === 'font' && asset.id === req.params.id,
      ),
    );
    if (usedInDraft || usedInPublished)
      throw fail(
        409,
        'Remove this font from slides and published playlists first',
      );
    db.prepare('DELETE FROM custom_fonts WHERE id=?').run(req.params.id);
    unlinkSync(path.join(root, 'media', font.filename));
    res.json({ ok: true });
  });
  app.post('/api/assets', admin, upload.single('file'), async (req, res) => {
    if (!req.file) throw fail(400, 'Choose an image');
    const { folderId = null } = assetPatchSchema.parse({
      folderId: req.body.folderId || null,
    });
    if (folderId) requireRecord('folder', folderId);
    const shareWithSlideId = req.body.shareWithSlideId || '';
    let slideGrants = [];
    if (shareWithSlideId) {
      requireRecord('slide', shareWithSlideId);
      if (!canShare(req.user, 'slide', shareWithSlideId))
        throw fail(403, 'Only the slide owner or admin can share its audience');
      slideGrants = grants('slide', shareWithSlideId);
    }
    let buffer, info;
    try {
      const source = sharp(req.file.buffer, {
        limitInputPixels: 25000000,
        animated: true,
      });
      const metadata = await source.metadata();
      const result = await source
        .rotate()
        .resize({
          width: 1920,
          height: 1920,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({
          quality: 88,
          effort: 4,
          loop: metadata.loop ?? 0,
          ...(metadata.delay ? { delay: metadata.delay } : {}),
        })
        .toBuffer({ resolveWithObject: true });
      buffer = result.data;
      info = result.info;
    } catch {
      throw fail(400, 'Use a valid image under 25 megapixels and 15 MB');
    }
    const id = randomUUID();
    const filename = `${id}.webp`;
    if (folderId) requireRecord('folder', folderId);
    writeFileSync(path.join(root, 'media', filename), buffer);
    const asset = put('asset', {
      id,
      filename,
      name: req.file.originalname.slice(0, 200),
      width: info.width,
      height: info.height,
      bytes: buffer.length,
      sha256: hash(buffer),
      url: `/media/${filename}`,
      tags: [],
      folderId,
      createdAt: new Date().toISOString(),
    });
    for (const grant of slideGrants)
      db.prepare('INSERT OR IGNORE INTO resource_grants VALUES (?,?,?,?)').run(
        'asset',
        id,
        grant.userId,
        grant.groupId,
      );
    res.status(201).json(asset);
  });
  function validateFolder(id) {
    if (id) requireRecord('folder', id);
  }
  function folderName(body, currentId) {
    const folder = folderSchema.parse(body);
    validateFolder(folder.parentId);
    if (currentId && folder.parentId) {
      let parent = folder.parentId;
      const visited = new Set();
      while (parent && !visited.has(parent)) {
        if (parent === currentId)
          throw fail(400, 'A folder cannot be moved inside itself');
        visited.add(parent);
        parent = allRecords('folder').find((f) => f.id === parent)?.parentId;
      }
    }
    if (
      list('folder').some(
        (f) =>
          f.id !== currentId &&
          f.name.toLowerCase() === folder.name.toLowerCase(),
      )
    )
      throw fail(409, 'A folder with that name already exists');
    return folder;
  }
  app.post('/api/folders', admin, (req, res) =>
    res
      .status(201)
      .json(put('folder', { ...folderName(req.body), id: randomUUID() })),
  );
  app.put('/api/folders/:id', admin, (req, res) => {
    requireRecord('folder', req.params.id);
    res.json(
      put('folder', {
        ...folderName(req.body, req.params.id),
        id: req.params.id,
      }),
    );
  });
  app.delete('/api/folders/:id', admin, (req, res) => {
    requireRecord('folder', req.params.id);
    if (allRecords('folder').some((f) => f.parentId === req.params.id))
      throw fail(409, 'Move subfolders out of this folder before deleting it');
    if (allRecords('asset').some((a) => a.folderId === req.params.id))
      throw fail(409, 'Move the images out of this folder before deleting it');
    remove('folder', req.params.id);
    res.json({ ok: true });
  });
  app.patch('/api/assets/:id', admin, (req, res) => {
    const asset = publicAsset(requireRecord('asset', req.params.id));
    const patch = assetPatchSchema.parse(req.body);
    validateFolder(patch.folderId);
    res.json(put('asset', { ...asset, ...patch }));
  });
  app.post('/api/assets/batch', admin, (req, res) => {
    const patch = assetBatchSchema.parse(req.body);
    const assets = patch.ids.map((id) =>
      publicAsset(requireRecord('asset', id)),
    );
    if (
      patch.action === 'delete' &&
      assets.some((asset) => !canShare(req.user, 'asset', asset.id))
    )
      throw fail(403, 'Only the media owner or admin can delete images');
    validateFolder(patch.folderId);
    const deletedIds = new Set(
      patch.action === 'delete' ? assets.map((asset) => asset.id) : [],
    );
    const markRemoved = (slide) => {
      let changed = false;
      const layers = slide.layers.map((layer) => {
        if (
          layer.type !== 'image' ||
          layer.removedMedia ||
          !deletedIds.has(layer.assetId)
        )
          return layer;
        changed = true;
        return { ...layer, removedMedia: true };
      });
      return changed
        ? { ...slide, layers, updatedAt: new Date().toISOString() }
        : slide;
    };
    const updated = assets.map((a) => ({
      ...a,
      ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
      tags: [...new Set([...a.tags, ...patch.addTags])].filter(
        (t) => !patch.removeTags.includes(t),
      ),
    }));
    if (updated.some((a) => a.tags.length > 30))
      throw fail(400, 'An image can have at most 30 tags');
    // Validate the entire selection before making any changes.
    db.exec('BEGIN IMMEDIATE');
    try {
      if (patch.action === 'delete') {
        for (const slide of allRecords('slide')) {
          const updatedSlide = markRemoved(slide);
          if (updatedSlide !== slide)
            db.prepare(
              "UPDATE records SET body=? WHERE kind='slide' AND id=?",
            ).run(JSON.stringify(updatedSlide), slide.id);
        }
        for (const playlist of allRecords('playlist')) {
          const published = playlist.published;
          if (!published) continue;
          let changed = false;
          const items = published.items.map((item) => {
            const slide = item.slide && markRemoved(item.slide);
            if (slide !== item.slide) changed = true;
            return slide === item.slide ? item : { ...item, slide };
          });
          const publishedAssets = (published.assets || []).filter(
            (asset) => !deletedIds.has(asset.id),
          );
          if (
            !changed &&
            publishedAssets.length === (published.assets || []).length
          )
            continue;
          playlist.published = {
            ...published,
            revision: randomUUID(),
            publishedAt: new Date().toISOString(),
            items,
            assets: publishedAssets,
          };
          db.prepare(
            "UPDATE records SET body=? WHERE kind='playlist' AND id=?",
          ).run(JSON.stringify(playlist), playlist.id);
        }
      }
      for (const a of updated) {
        if (patch.action === 'delete') {
          remove('asset', a.id);
          db.prepare('DELETE FROM resource_access WHERE kind=? AND id=?').run(
            'asset',
            a.id,
          );
          db.prepare('DELETE FROM resource_grants WHERE kind=? AND id=?').run(
            'asset',
            a.id,
          );
        } else put('asset', a);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    if (patch.action === 'delete')
      for (const a of assets) {
        try {
          unlinkSync(path.join(root, 'media', a.filename));
        } catch (error) {
          if (error.code !== 'ENOENT')
            console.error('Unused media file could not be removed', error);
        }
      }
    res.json({ ok: true, count: assets.length });
  });
  app.get(
    '/media/:filename',
    (req, res, next) => {
      const user = session(req, res);
      if (user) {
        res.locals.userMedia = true;
        const font = db
          .prepare('SELECT 1 FROM custom_fonts WHERE filename=?')
          .get(req.params.filename);
        if (font) return next();
        const asset = allRecords('asset').find(
          (a) => a.filename === req.params.filename,
        );
        if (!asset || !accounts.canViewAsset(user, asset.id))
          return res.status(404).json({ error: 'Not found' });
        return next();
      }
      player(req, res, () => {
        if (!req.device.approved)
          return res.status(403).json({ error: 'Approval required' });
        const p = get('playlist', req.device.playlistId || '');
        if (
          !p?.published?.assets.some((a) => a.filename === req.params.filename)
        )
          return res.status(403).json({ error: 'Asset not assigned' });
        next();
      });
    },
    (req, res) => {
      if (
        !/^[a-f0-9-]{36}\.(?:webp|woff2|woff|ttf|otf)$/.test(
          req.params.filename,
        ) ||
        !existsSync(path.join(root, 'media', req.params.filename))
      )
        throw fail(404, 'Not found');
      res.set(
        'Cache-Control',
        res.locals.userMedia
          ? 'private, no-store'
          : 'private, max-age=31536000, immutable',
      );
      const format = path.extname(req.params.filename).slice(1);
      res.type(fontFormats[format]?.mime || 'image/webp');
      res.sendFile(path.join(root, 'media', req.params.filename));
    },
  );
  app.post('/api/player/enroll', rateLimit, (req, res) => {
    const { name, wireguardPublicKey, enrollmentToken } = z
      .object({
        name: z.string().trim().min(1).max(100),
        wireguardPublicKey: z.string().max(44).optional(),
        enrollmentToken: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .parse(req.body);
    if (wireguardPublicKey && !enrollmentToken)
      throw fail(
        400,
        'Managed enrollment requires a persistent enrollment token',
      );
    if (wireguardPublicKey) {
      const previous = list('device').find(
        (d) => d.wireguardPublicKey === wireguardPublicKey,
      );
      if (previous && previous.tokenHash === hash(enrollmentToken))
        return res.status(200).json({
          id: previous.id,
          token: enrollmentToken,
          code: previous.code,
        });
    }
    managedVpn.validateEnrollment(wireguardPublicKey);
    for (const d of list('device'))
      if (!d.approved && Date.now() - Date.parse(d.createdAt) > 86400000)
        remove('device', d.id);
    if (list('device').filter((d) => !d.approved).length >= 50)
      throw fail(429, 'Too many pending devices');
    const token = wireguardPublicKey ? enrollmentToken : secret();
    if (list('device').some((d) => d.tokenHash === hash(token)))
      throw fail(409, 'Enrollment token already in use');
    const code = randomBytes(4).toString('hex').toUpperCase();
    const device = put('device', {
      id: randomUUID(),
      name,
      code,
      tokenHash: hash(token),
      approved: false,
      playlistId: null,
      rotation: 0,
      blank: false,
      createdAt: new Date().toISOString(),
      lastSeen: null,
      status: null,
      command: null,
      ...(wireguardPublicKey ? { wireguardPublicKey } : {}),
    });
    res.status(201).json({ id: device.id, token, code });
  });
  app.post('/api/devices/:id/approve', administrator, (req, res) => {
    const device = requireRecord('device', req.params.id);
    const { code } = z.object({ code: z.string() }).parse(req.body);
    if (device.code !== code.trim().toUpperCase())
      throw fail(400, 'Pairing code does not match');
    res.json(publicDevice(put('device', { ...device, approved: true })));
  });
  app.put('/api/devices/:id', admin, (req, res) => {
    const device = requireRecord('device', req.params.id);
    const patch = deviceSchema.parse(req.body);
    if (patch.playlistId) requireRecord('playlist', patch.playlistId);
    res.json(publicDevice(put('device', { ...device, ...patch })));
  });
  app.post('/api/devices/:id/command', admin, (req, res) => {
    const device = requireRecord('device', req.params.id);
    if (!device.approved) throw fail(400, 'Approve device first');
    const { type } = z
      .object({ type: z.enum(['refresh', 'reboot']) })
      .parse(req.body);
    device.command = {
      id: randomUUID(),
      type,
      createdAt: new Date().toISOString(),
    };
    put('device', device);
    res.json({ ok: true });
  });
  app.delete('/api/devices/:id', administrator, async (req, res) => {
    requireRecord('device', req.params.id);
    remove('device', req.params.id);
    recovery.remove(req.params.id);
    await managedVpn.revoked();
    res.json({ ok: true });
  });
  app.post('/api/player/sync', player, (req, res) => {
    const status = z
      .object({
        revision: z.string().nullable().optional(),
        error: z.string().max(500).nullable().optional(),
        version: z.string().max(50).optional(),
        uptime: z.number().nonnegative().optional(),
        recovery: z
          .enum(['standby', 'starting', 'hotspot', 'reconnecting', 'error'])
          .nullable()
          .optional(),
        commandAck: z.string().nullable().optional(),
        playback: z
          .object({
            phase: z.enum([
              'playing',
              'preparing',
              'waiting',
              'blank',
              'empty',
              'unpaired',
              'stalled',
            ]),
            error: z.string().max(500).nullable().optional(),
            slideId: z.string().max(100).nullable().optional(),
            preparationMs: z.number().min(0).max(1e12).optional(),
            missedDeadlines: z.number().min(0).max(1e12).optional(),
          })
          .nullable()
          .optional(),
      })
      .parse(req.body);
    const device = req.device;
    device.status = status;
    device.lastSeen = new Date().toISOString();
    if (status.commandAck === device.command?.id) device.command = null;
    put('device', device);
    if (!device.approved)
      return res.json({ approved: false, code: device.code });
    const published = device.playlistId
      ? get('playlist', device.playlistId)?.published
      : null;
    res.json({
      approved: true,
      blank: device.blank,
      rotation: device.rotation,
      command: device.command,
      weather: weather.forManifest(published),
      manifest: {
        ...(published || {
          schemaVersion: 2,
          revision: 'empty',
          name: 'No published playlist',
          items: [],
          assets: [],
        }),
        stocks: stocks.forManifest(published),
      },
    });
  });
  app.use('/api', (req, res) =>
    res.status(404).json({ error: 'Endpoint not found' }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status =
      err instanceof z.ZodError
        ? 400
        : err.code === 'LIMIT_FILE_SIZE'
          ? 413
          : err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({
      error:
        err instanceof z.ZodError
          ? err.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ')
          : status === 500
            ? 'Server error'
            : err.message,
    });
  });
  return {
    app,
    db,
    seedInitialAdmin: accounts.seedInitialAdmin,
    close: () => {
      weather.close();
      stocks.close();
      zipLookup.close();
      managedVpn.close();
    },
  };
}
