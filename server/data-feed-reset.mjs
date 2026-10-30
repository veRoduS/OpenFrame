import { createHash, randomUUID } from 'node:crypto';
import { auditSite } from './sites.mjs';

const fail = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

/** Explicit deletion preserves layout records and disconnects their data bindings. */
export function createDataFeedReset(db) {
  const records = (kind) =>
    db
      .prepare('SELECT body FROM records WHERE kind=? ORDER BY id')
      .all(kind)
      .map((row) => JSON.parse(row.body));
  function plan({ all = false, feedIds = [], applicationIds = [] } = {}) {
    const applications = db
      .prepare('SELECT id FROM data_feed_applications ORDER BY id')
      .all()
      .filter((a) => all || applicationIds.includes(a.id));
    const apps = new Set(applications.map((a) => a.id));
    const feeds = records('data-feed').filter(
      (feed) =>
        all || feedIds.includes(feed.id) || apps.has(feed.applicationId),
    );
    const ids = new Set(feeds.map((feed) => feed.id));
    const widgets = new Set(),
      slides = new Set(),
      updates = [];
    let publishedPlaylists = 0;
    function disconnect(slide) {
      let changed = false;
      const layers = (slide.layers || []).map((layer) => {
        const config = layer.type === 'data' && layer.data;
        if (
          !config ||
          !(all
            ? config.feedId || config.siteBinding
            : ids.has(config.feedId) ||
              apps.has(config.siteBinding?.applicationId))
        )
          return layer;
        changed = true;
        widgets.add(`${slide.id}:${layer.id}`);
        slides.add(slide.id);
        const { siteBinding: _binding, ...settings } = config;
        return { ...layer, data: { ...settings, feedId: null } };
      });
      return changed ? { ...slide, layers } : slide;
    }
    for (const slide of records('slide')) {
      const next = disconnect(slide);
      if (next !== slide) updates.push({ kind: 'slide', before: slide, next });
    }
    for (const playlist of records('playlist')) {
      if (!playlist.published) continue;
      let changed = false;
      const items = playlist.published.items.map((item) => {
        const next = disconnect(item.slide);
        if (next === item.slide) return item;
        changed = true;
        return { ...item, slide: next };
      });
      if (changed) {
        publishedPlaylists++;
        updates.push({
          kind: 'playlist',
          before: playlist,
          next: { ...playlist, published: { ...playlist.published, items } },
        });
      }
    }
    const feedKeys = db
      .prepare('SELECT id,feedId FROM data_feed_tokens ORDER BY id')
      .all()
      .filter((key) => all || ids.has(key.feedId));
    const appKeys = db
      .prepare(
        'SELECT id,applicationId FROM data_feed_application_tokens ORDER BY id',
      )
      .all()
      .filter((key) => all || apps.has(key.applicationId));
    const revision = createHash('sha256')
      .update(
        JSON.stringify({
          all,
          feeds: [...ids].sort((a, b) => a.localeCompare(b)),
          apps: [...apps].sort((a, b) => a.localeCompare(b)),
          keys: [...feedKeys, ...appKeys],
          updates: updates.map(({ kind, before }) => [kind, before]),
        }),
      )
      .digest('hex');
    return {
      applications,
      feeds,
      updates,
      revision,
      counts: {
        applications: applications.length,
        feeds: feeds.length,
        keys: feedKeys.length + appKeys.length,
        widgets: widgets.size,
        slides: slides.size,
        publishedPlaylists,
      },
    };
  }
  function preview(scope) {
    const { revision, counts } = plan(scope);
    return { revision, counts };
  }
  function remove(scope, { actor, expectedRevision } = {}) {
    db.exec('SAVEPOINT reset_data_connections');
    try {
      const result = plan(scope);
      if (expectedRevision && result.revision !== expectedRevision)
        throw fail(
          409,
          'RESET_CHANGED',
          'Connections or widgets changed. Review the reset again before deleting.',
        );
      const now = new Date().toISOString();
      for (const update of result.updates) {
        const next = { ...update.next, updatedAt: now };
        if (update.kind === 'playlist')
          next.published = {
            ...next.published,
            revision: randomUUID(),
            publishedAt: now,
          };
        db.prepare('UPDATE records SET body=? WHERE kind=? AND id=?').run(
          JSON.stringify(next),
          update.kind,
          next.id,
        );
      }
      for (const feed of result.feeds) {
        auditSite(
          db,
          actor,
          'feed-deleted',
          'data-feed',
          feed.id,
          feed.siteId || null,
          null,
        );
        db.prepare('DELETE FROM data_feed_tokens WHERE feedId=?').run(feed.id);
        db.prepare(
          'DELETE FROM data_feed_application_sources WHERE feedId=?',
        ).run(feed.id);
        for (const table of [
          'resource_access',
          'resource_management',
          'resource_grants',
          'resource_permissions',
        ])
          db.prepare(
            `DELETE FROM ${table} WHERE kind='data-feed' AND id=?`,
          ).run(feed.id);
        db.prepare("DELETE FROM records WHERE kind='data-feed' AND id=?").run(
          feed.id,
        );
      }
      for (const application of result.applications) {
        auditSite(
          db,
          actor,
          'application-deleted',
          'application',
          application.id,
        );
        db.prepare(
          'DELETE FROM data_feed_application_sources WHERE applicationId=?',
        ).run(application.id);
        db.prepare(
          'DELETE FROM data_feed_application_tokens WHERE applicationId=?',
        ).run(application.id);
        db.prepare('DELETE FROM data_feed_applications WHERE id=?').run(
          application.id,
        );
      }
      if (scope.all) {
        for (const table of [
          'data_feed_tokens',
          'data_feed_application_sources',
          'data_feed_application_tokens',
          'data_feed_applications',
        ])
          db.prepare(`DELETE FROM ${table}`).run();
        for (const table of [
          'resource_access',
          'resource_management',
          'resource_grants',
          'resource_permissions',
        ])
          db.prepare(`DELETE FROM ${table} WHERE kind='data-feed'`).run();
      }
      db.exec('RELEASE reset_data_connections');
      return { ok: true, ...result.counts };
    } catch (error) {
      db.exec(
        'ROLLBACK TO reset_data_connections; RELEASE reset_data_connections',
      );
      throw error;
    }
  }
  return { preview, remove };
}
