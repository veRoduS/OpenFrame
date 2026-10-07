import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import contract from './data-feeds.openapi.json' with { type: 'json' };

export const fieldSchema = z
  .object({
    key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),
    type: z.enum(['number', 'series', 'categories']),
  })
  .strict();
export const feedSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    managingGroupId: z.uuid().nullable().optional(),
    fields: z
      .array(fieldSchema)
      .min(1)
      .max(20)
      .refine(
        (fields) => new Set(fields.map((f) => f.key)).size === fields.length,
        'Field keys must be unique',
      ),
  })
  .strict();
export const dataWidgetSchema = z
  .object({
    mode: z.enum(['metric', 'progress', 'line', 'bar']).default('metric'),
    feedId: z.uuid().nullable().default(null),
    field: z.string().max(40).default(''),
    title: z.string().max(80).default(''),
    unit: z.string().max(20).default(''),
    decimals: z.number().int().min(0).max(4).default(0),
    target: z.number().positive().max(1e12).default(100),
    targetField: z.string().max(40).default(''),
    orientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
    accent: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default('#17613d'),
    track: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default('#dce5df'),
    showUpdated: z.boolean().default(true),
    staleAfterMinutes: z.number().int().min(1).max(10080).default(60),
  })
  .strict();
const number = z.number().min(-1e12).max(1e12);
const values = {
  number: number.nullable(),
  series: z
    .array(
      z
        .object({ time: z.iso.datetime({ offset: true }), value: number })
        .strict(),
    )
    .max(240)
    .refine(
      (points) =>
        points.every(
          (p, i) => !i || Date.parse(p.time) > Date.parse(points[i - 1].time),
        ),
      'Series times must be unique and ascending',
    ),
  categories: z
    .array(
      z
        .object({ label: z.string().trim().min(1).max(60), value: number })
        .strict(),
    )
    .max(40)
    .refine(
      (rows) => new Set(rows.map((r) => r.label)).size === rows.length,
      'Category labels must be unique',
    ),
};
const digest = (token) => createHash('sha256').update(token).digest('hex');
const fail = (status, code, message) =>
  Object.assign(new Error(message), { status, code });
export const feedIds = (manifest) => [
  ...new Set(
    (manifest?.items || []).flatMap((i) =>
      (i.slide?.layers || [])
        .filter((l) => l.type === 'data')
        .map((l) => l.data?.feedId)
        .filter(Boolean),
    ),
  ),
];
export function feedMetadata({ data: _data, ...feed }) {
  return feed;
}

export function mountDataFeeds(
  app,
  {
    db,
    accounts,
    admin,
    administrator,
    allRecords,
    list,
    put,
    remove,
    requireRecord,
    requireEditable,
    publicResource,
  },
) {
  db.exec(`CREATE TABLE IF NOT EXISTS data_feed_tokens (
    id TEXT PRIMARY KEY, feedId TEXT NOT NULL, digest TEXT NOT NULL UNIQUE,
    creatorId TEXT NOT NULL, name TEXT NOT NULL, createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL, revokedAt TEXT, lastUsedAt TEXT);
    CREATE INDEX IF NOT EXISTS data_feed_token_feed ON data_feed_tokens(feedId);`);
  const raw = (id) => {
    const row = db
      .prepare("SELECT body FROM records WHERE kind='data-feed' AND id=?")
      .get(id);
    return row ? JSON.parse(row.body) : null;
  };
  const publicFeed = (feed) => publicResource('data-feed', feedMetadata(feed));
  const tokenFields = 'id,feedId,name,createdAt,expiresAt,revokedAt,lastUsedAt';
  const inUse = (id) =>
    allRecords('slide').some((s) =>
      s.layers.some((l) => l.type === 'data' && l.data?.feedId === id),
    ) || allRecords('playlist').some((p) => feedIds(p.published).includes(id));
  function validateLayers(slide, user) {
    for (const layer of slide.layers.filter((l) => l.type === 'data')) {
      const config = layer.data;
      if (!config?.feedId)
        throw fail(
          400,
          'INVALID_BINDING',
          'Choose a data feed for each data widget',
        );
      const feed = raw(config.feedId);
      if (!feed || !accounts.can(user, 'data-feed', feed.id))
        throw fail(
          403,
          'FEED_ACCESS_REQUIRED',
          'Viewing access to the data feed is required',
        );
      const expected =
        config.mode === 'line'
          ? 'series'
          : config.mode === 'bar'
            ? 'categories'
            : 'number';
      if (
        !feed.fields.some((f) => f.key === config.field && f.type === expected)
      )
        throw fail(
          400,
          'INVALID_BINDING',
          `Choose a ${expected} field for the data widget`,
        );
      if (
        config.targetField &&
        !feed.fields.some(
          (f) => f.key === config.targetField && f.type === 'number',
        )
      )
        throw fail(
          400,
          'INVALID_BINDING',
          'Progress target must reference a number field',
        );
    }
  }
  function snapshots(manifest, visible = () => true) {
    return Object.fromEntries(
      feedIds(manifest)
        .slice(0, 20)
        .map((id) => {
          const feed = raw(id);
          return [
            id,
            feed && visible(id)
              ? {
                  revision: feed.revision,
                  updatedAt: feed.updatedAt,
                  data: feed.data,
                  status: feed.data ? 'ready' : 'empty',
                }
              : {
                  revision: null,
                  updatedAt: null,
                  data: null,
                  status: 'unavailable',
                },
          ];
        }),
    );
  }
  const guide = readFileSync(
    new URL('../docs/data-feeds-api.md', import.meta.url),
    'utf8',
  );
  app.get('/api/data-feeds/guide', (req, res) =>
    res.type('text/markdown').send(guide),
  );
  app.get('/api/data-feeds/openapi.json', (req, res) => res.json(contract));
  app.get('/api/data-feeds', admin, (req, res) =>
    res.json(list('data-feed').map(publicFeed)),
  );
  app.post('/api/data-feeds', administrator, (req, res) => {
    const input = feedSchema.parse(req.body);
    if (allRecords('data-feed').length >= 200)
      throw fail(409, 'FEED_LIMIT', 'Maximum of 200 feeds reached');
    const feed = put('data-feed', {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: null,
      revision: null,
      data: null,
    });
    res.status(201).json(publicFeed(feed));
  });
  app.get('/api/data-feeds/:id', admin, (req, res) =>
    res.json(publicFeed(requireRecord('data-feed', req.params.id))),
  );
  app.put('/api/data-feeds/:id', administrator, (req, res) => {
    const feed = requireEditable('data-feed', req.params.id);
    const input = feedSchema.parse(req.body);
    if (JSON.stringify(input.fields) !== JSON.stringify(feed.fields))
      throw fail(
        409,
        'IMMUTABLE_FIELDS',
        'Field definitions are fixed; create a new feed to change its schema',
      );
    res.json(publicFeed(put('data-feed', { ...feed, ...input })));
  });
  app.delete('/api/data-feeds/:id', administrator, (req, res) => {
    requireEditable('data-feed', req.params.id);
    if (inUse(req.params.id))
      throw fail(
        409,
        'FEED_IN_USE',
        'Remove widgets using this feed from drafts and published playlists first',
      );
    db.exec('SAVEPOINT feed_delete');
    try {
      db.prepare('DELETE FROM data_feed_tokens WHERE feedId=?').run(
        req.params.id,
      );
      for (const table of [
        'resource_access',
        'resource_management',
        'resource_grants',
        'resource_permissions',
      ])
        db.prepare(`DELETE FROM ${table} WHERE kind='data-feed' AND id=?`).run(
          req.params.id,
        );
      remove('data-feed', req.params.id);
      db.exec('RELEASE feed_delete');
    } catch (error) {
      db.exec('ROLLBACK TO feed_delete; RELEASE feed_delete');
      throw error;
    }
    res.json({ ok: true });
  });
  app.get('/api/data-feeds/:id/data', admin, (req, res) => {
    const feed = requireRecord('data-feed', req.params.id);
    res.json(
      snapshots({
        items: [
          { slide: { layers: [{ type: 'data', data: { feedId: feed.id } }] } },
        ],
      })[feed.id],
    );
  });
  app.get('/api/data-feeds/:id/tokens', administrator, (req, res) => {
    requireEditable('data-feed', req.params.id);
    res.json(
      db
        .prepare(
          `SELECT ${tokenFields} FROM data_feed_tokens WHERE feedId=? ORDER BY createdAt DESC`,
        )
        .all(req.params.id),
    );
  });
  app.post('/api/data-feeds/:id/tokens', administrator, (req, res) => {
    requireEditable('data-feed', req.params.id);
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        expiresInDays: z.number().int().min(1).max(365).default(90),
      })
      .strict()
      .parse(req.body);
    const now = new Date().toISOString();
    if (
      db
        .prepare(
          'SELECT count(*) AS count FROM data_feed_tokens WHERE feedId=? AND revokedAt IS NULL AND expiresAt>?',
        )
        .get(req.params.id, now).count >= 20
    )
      throw fail(
        409,
        'TOKEN_LIMIT',
        'Maximum of 20 active tokens per feed reached',
      );
    // Keep revoked/expired metadata bounded too.
    db.prepare(
      'DELETE FROM data_feed_tokens WHERE feedId=? AND (revokedAt IS NOT NULL OR expiresAt<=?)',
    ).run(req.params.id, now);
    const token = `ofd_${randomBytes(32).toString('base64url')}`;
    const id = randomUUID();
    db.prepare(
      'INSERT INTO data_feed_tokens VALUES (?,?,?,?,?,?,?,NULL,NULL)',
    ).run(
      id,
      req.params.id,
      digest(token),
      req.user.id,
      input.name,
      now,
      new Date(Date.now() + input.expiresInDays * 86400000).toISOString(),
    );
    res.status(201).json({
      ...db
        .prepare(`SELECT ${tokenFields} FROM data_feed_tokens WHERE id=?`)
        .get(id),
      token,
    });
  });
  app.delete(
    '/api/data-feeds/:id/tokens/:tokenId',
    administrator,
    (req, res) => {
      requireEditable('data-feed', req.params.id);
      if (
        !db
          .prepare(
            'UPDATE data_feed_tokens SET revokedAt=COALESCE(revokedAt,?) WHERE id=? AND feedId=?',
          )
          .run(new Date().toISOString(), req.params.tokenId, req.params.id)
          .changes
      )
        throw fail(404, 'NOT_FOUND', 'Token not found');
      res.json({ ok: true });
    },
  );
  const buckets = new Map();
  // Token auth intentionally runs before session middleware. Tokens cannot manage feeds or read the library.
  app.put('/api/data-feeds/:id/data', (req, res) => {
    const token = /^Bearer (ofd_[A-Za-z0-9_-]{43})$/.exec(
      req.headers.authorization || '',
    )?.[1];
    const row =
      token &&
      db
        .prepare('SELECT * FROM data_feed_tokens WHERE digest=? AND feedId=?')
        .get(digest(token), req.params.id);
    const creator =
      row && db.prepare('SELECT * FROM users WHERE id=?').get(row.creatorId);
    const feed = raw(req.params.id);
    if (
      !row ||
      row.revokedAt ||
      row.expiresAt <= new Date().toISOString() ||
      !feed ||
      !accounts.canEdit(creator, 'data-feed', feed.id)
    )
      throw fail(
        401,
        'INVALID_TOKEN',
        'Invalid, expired, revoked, or unauthorized feed token',
      );
    if (!req.is('application/json'))
      throw fail(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Send Content-Type: application/json',
      );
    const now = Date.now();
    for (const [id, bucket] of buckets)
      if (bucket.until <= now) buckets.delete(id);
    const bucket = buckets.get(feed.id) || { until: now + 60000, count: 0 };
    buckets.set(feed.id, bucket);
    if (++bucket.count > 60) {
      res.set(
        'Retry-After',
        String(Math.max(1, Math.ceil((bucket.until - now) / 1000))),
      );
      throw fail(
        429,
        'RATE_LIMITED',
        'Maximum of 60 writes per minute per feed',
      );
    }
    const data = z
      .object(
        Object.fromEntries(feed.fields.map((f) => [f.key, values[f.type]])),
      )
      .strict()
      .parse(req.body);
    const updatedAt = new Date().toISOString();
    const revision = randomUUID();
    db.exec('SAVEPOINT feed_snapshot');
    try {
      db.prepare(
        "UPDATE records SET body=? WHERE kind='data-feed' AND id=?",
      ).run(JSON.stringify({ ...feed, data, revision, updatedAt }), feed.id);
      db.prepare('UPDATE data_feed_tokens SET lastUsedAt=? WHERE id=?').run(
        updatedAt,
        row.id,
      );
      db.exec('RELEASE feed_snapshot');
    } catch (error) {
      db.exec('ROLLBACK TO feed_snapshot; RELEASE feed_snapshot');
      throw error;
    }
    res.json({ feedId: feed.id, revision, updatedAt });
  });
  return { snapshots, validateLayers };
}
