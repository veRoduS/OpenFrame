import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { requireActiveSite, siteTransaction, auditSite } from './sites.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function supportsSiteVersion(version = '', patch = 1) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-debug)?$/.exec(version);
  return (
    !!match &&
    (+match[1] > 0 ||
      +match[2] > 15 ||
      (+match[2] === 15 && +match[3] >= patch))
  );
}

export function mountSiteTransfers(
  app,
  {
    db,
    administrator,
    requireRecord,
    put,
    publicDevice,
    allRecords,
    dataFeeds,
  },
) {
  function preview(device, destination) {
    if (!device.approved || !device.siteId)
      throw fail(
        400,
        'Assign an approved screen to its first site before transferring it',
      );
    if (device.siteId === destination.id)
      throw fail(400, 'Choose a different destination site');
    if (device.siteTransfer && !device.siteTransfer.clearedAt)
      throw fail(409, 'Wait for the player to confirm its pending transfer');
    if (!supportsSiteVersion(device.status?.version, 2))
      throw fail(
        409,
        'Upgrade this player to 0.15.2 or newer and wait for its heartbeat before transferring it',
      );
    const from = db
      .prepare('SELECT id,siteNumber,name FROM sites WHERE id=?')
      .get(device.siteId);
    const published = device.playlistId
      ? requireRecord('playlist', device.playlistId).published
      : null;
    const resolved = dataFeeds.resolveSites(published, destination.id);
    const snapshots = dataFeeds.snapshots(resolved, (id) =>
      allRecords('data-feed').some(
        (feed) => feed.id === id && feed.siteId === destination.id,
      ),
    );
    const issues = [];
    let detachPlaylist = false;
    for (const [index, item] of (published?.items || []).entries()) {
      for (const [layerIndex, layer] of item.slide.layers.entries()) {
        if (layer.type !== 'data') continue;
        const config = layer.data;
        const local = resolved.items[index].slide.layers[layerIndex].data;
        const available =
          !!snapshots[local.feedId] &&
          snapshots[local.feedId].status !== 'unavailable';
        if (!available) {
          const fixed = !config.siteBinding;
          if (fixed) detachPlaylist = true;
          issues.push({
            slideId: item.slide.id,
            layerId: layer.id,
            title: config.title || config.field,
            reason: fixed
              ? 'Fixed feed does not belong to the destination site'
              : 'Local source or compatible fields are not available',
          });
        }
      }
    }
    const shares = db
      .prepare(
        'SELECT userId,groupId FROM resource_grants WHERE kind=? AND id=? ORDER BY userId,groupId',
      )
      .all('device', device.id);
    const owner =
      db
        .prepare('SELECT ownerId FROM resource_access WHERE kind=? AND id=?')
        .get('device', device.id)?.ownerId || null;
    const reviewToken = digest([
      device.id,
      device.siteId,
      device.siteRevision || 0,
      destination.id,
      device.playlistId,
      published?.revision,
      resolved?.revision,
      issues,
      shares,
      owner,
    ]);
    return {
      deviceId: device.id,
      deviceName: device.name,
      from,
      to: {
        id: destination.id,
        siteNumber: destination.siteNumber,
        name: destination.name,
      },
      playlistId: device.playlistId,
      resultingPlaylistId: detachPlaylist ? null : device.playlistId,
      detachPlaylist,
      issues,
      removedShareCount: shares.length,
      online:
        !!device.lastSeen && Date.now() - Date.parse(device.lastSeen) < 90000,
      reviewToken,
    };
  }
  app.get('/api/devices/:id/site-preview', administrator, (req, res) => {
    const siteId = z.uuid().parse(req.query.siteId);
    res.json(
      preview(
        requireRecord('device', req.params.id),
        requireActiveSite(db, siteId),
      ),
    );
  });
  app.post('/api/devices/:id/transfer', administrator, (req, res) => {
    const { siteId, reviewToken } = z
      .object({
        siteId: z.uuid(),
        reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(req.body);
    const device = requireRecord('device', req.params.id);
    const impact = preview(device, requireActiveSite(db, siteId));
    if (impact.reviewToken !== reviewToken)
      throw fail(
        409,
        'The screen or destination content changed. Review the transfer again',
      );
    const saved = siteTransaction(db, () => {
      // A location move must not carry the previous location's recipients or commands.
      for (const table of [
        'resource_grants',
        'resource_permissions',
        'resource_management',
      ])
        db.prepare(`DELETE FROM ${table} WHERE kind='device' AND id=?`).run(
          device.id,
        );
      db.prepare(
        "INSERT INTO resource_access(kind,id,ownerId) VALUES ('device',?,?) ON CONFLICT(kind,id) DO UPDATE SET ownerId=excluded.ownerId",
      ).run(device.id, req.user.id);
      const next = put('device', {
        ...device,
        siteId,
        siteRevision: (device.siteRevision || 0) + 1,
        playlistId: impact.resultingPlaylistId,
        command: null,
        siteTransfer: {
          id: randomUUID(),
          fromSiteId: device.siteId,
          toSiteId: siteId,
          requestedAt: new Date().toISOString(),
          clearedAt: null,
        },
      });
      auditSite(
        db,
        req.user,
        'screen-transferred',
        'device',
        device.id,
        device.siteId,
        siteId,
      );
      return next;
    });
    res.json(publicDevice(saved));
  });
}
