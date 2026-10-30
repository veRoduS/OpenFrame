import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireActiveSite, auditSite, siteTransaction } from './sites.mjs';
import { expiryDays, keyExpiry, migrateKeyExpiry } from './api-key-expiry.mjs';

const digest = (key) => createHash('sha256').update(key).digest('hex');
const fail = (status, code, message) =>
  Object.assign(new Error(message), { status, code });
const applicationSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    managingGroupId: z.uuid().nullable().default(null),
  })
  .strict();
const keySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    siteId: z.uuid().nullable().default(null),
    expiresInDays: expiryDays.default(90),
  })
  .strict();
const sourceKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
const keyFields =
  'id,applicationId,name,createdAt,expiresAt,revokedAt,lastUsedAt,siteId';

export function mountDataFeedApplications(
  app,
  {
    db,
    accounts,
    administrator,
    allRecords,
    put,
    raw,
    fieldSchema,
    values,
    resetConnections,
  },
) {
  db.exec(`CREATE TABLE IF NOT EXISTS data_feed_applications (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, managingGroupId TEXT,
    createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS data_feed_application_tokens (
    id TEXT PRIMARY KEY, applicationId TEXT NOT NULL, digest TEXT NOT NULL UNIQUE,
    creatorId TEXT NOT NULL, name TEXT NOT NULL, createdAt TEXT NOT NULL,
    expiresAt TEXT, revokedAt TEXT, lastUsedAt TEXT);
    CREATE INDEX IF NOT EXISTS data_feed_application_token_scope ON data_feed_application_tokens(applicationId);
    CREATE TABLE IF NOT EXISTS data_feed_application_sources (
    applicationId TEXT NOT NULL, sourceKey TEXT NOT NULL, feedId TEXT NOT NULL UNIQUE,
    PRIMARY KEY(applicationId,sourceKey));`);
  db.exec('SAVEPOINT site_source_migration');
  try {
    if (
      !db
        .prepare('PRAGMA table_info(data_feed_application_tokens)')
        .all()
        .some((column) => column.name === 'siteId')
    )
      db.exec(
        'ALTER TABLE data_feed_application_tokens ADD COLUMN siteId TEXT',
      );
    if (
      !db
        .prepare('PRAGMA table_info(data_feed_application_sources)')
        .all()
        .some((column) => column.name === 'siteId')
    ) {
      db.exec(`ALTER TABLE data_feed_application_sources RENAME TO data_feed_application_sources_legacy;
        CREATE TABLE data_feed_application_sources (
          applicationId TEXT NOT NULL, sourceKey TEXT NOT NULL, feedId TEXT NOT NULL UNIQUE,
          siteId TEXT NOT NULL DEFAULT '', PRIMARY KEY(applicationId,siteId,sourceKey));
        INSERT INTO data_feed_application_sources(applicationId,sourceKey,feedId)
          SELECT applicationId,sourceKey,feedId FROM data_feed_application_sources_legacy;
        DROP TABLE data_feed_application_sources_legacy;`);
    }
    db.exec('RELEASE site_source_migration');
  } catch (error) {
    db.exec('ROLLBACK TO site_source_migration; RELEASE site_source_migration');
    throw error;
  }
  migrateKeyExpiry(db, 'data_feed_application_tokens');
  const metadata = (application) => ({
    ...application,
    unassignedFeedCount: db
      .prepare(
        "SELECT COUNT(*) AS n FROM data_feed_application_sources WHERE applicationId=? AND siteId=''",
      )
      .get(application.id).n,
    feedCount: db
      .prepare(
        'SELECT COUNT(*) AS n FROM data_feed_application_sources WHERE applicationId=?',
      )
      .get(application.id).n,
  });
  const applicationById = (id) => {
    const application = db
      .prepare('SELECT * FROM data_feed_applications WHERE id=?')
      .get(id);
    if (!application) throw fail(404, 'NOT_FOUND', 'Application not found');
    return application;
  };
  app.get('/api/data-feeds/applications', administrator, (_req, res) => {
    res.json(
      db
        .prepare(
          'SELECT * FROM data_feed_applications ORDER BY name COLLATE NOCASE,id',
        )
        .all()
        .map(metadata),
    );
  });
  app.post('/api/data-feeds/applications', administrator, (req, res) => {
    const input = applicationSchema.parse(req.body);
    if (
      input.managingGroupId &&
      !db.prepare('SELECT id FROM groups WHERE id=?').get(input.managingGroupId)
    )
      throw fail(400, 'INVALID_GROUP', 'Managing group not found');
    if (
      db.prepare('SELECT COUNT(*) AS n FROM data_feed_applications').get().n >=
      50
    )
      throw fail(
        409,
        'APPLICATION_LIMIT',
        'Maximum of 50 applications reached',
      );
    const application = {
      id: randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO data_feed_applications VALUES (?,?,?,?)').run(
      application.id,
      application.name,
      application.managingGroupId,
      application.createdAt,
    );
    res.status(201).json(metadata(application));
  });
  app.post(
    '/api/data-feeds/applications/:id/assign-site',
    administrator,
    (req, res) => {
      const application = applicationById(req.params.id);
      const { siteId } = z
        .object({ siteId: z.uuid() })
        .strict()
        .parse(req.body);
      requireActiveSite(db, siteId);
      db.exec('SAVEPOINT assign_legacy_site');
      try {
        const mappings = db
          .prepare(
            "SELECT * FROM data_feed_application_sources WHERE applicationId=? AND siteId='' ",
          )
          .all(application.id);
        for (const mapping of mappings) {
          if (
            db
              .prepare(
                'SELECT feedId FROM data_feed_application_sources WHERE applicationId=? AND siteId=? AND sourceKey=?',
              )
              .get(application.id, siteId, mapping.sourceKey)
          )
            throw fail(
              409,
              'SITE_SOURCE_CONFLICT',
              'The destination already has a feed with this source name; no assignments changed',
            );
          const feed = raw(mapping.feedId);
          if (!feed || feed.siteId)
            throw fail(
              409,
              'SITE_SOURCE_CONFLICT',
              'The legacy feed assignment is inconsistent; no assignments changed',
            );
          db.prepare(
            "UPDATE records SET body=json_set(body,'$.siteId',?) WHERE kind='data-feed' AND id=?",
          ).run(siteId, feed.id);
        }
        db.prepare(
          "UPDATE data_feed_application_sources SET siteId=? WHERE applicationId=? AND siteId='' ",
        ).run(siteId, application.id);
        const result = db
          .prepare(
            'UPDATE data_feed_application_tokens SET siteId=? WHERE applicationId=? AND siteId IS NULL',
          )
          .run(siteId, application.id);
        if (mappings.length || result.changes)
          auditSite(
            db,
            req.user,
            'application-site-assigned',
            'application',
            application.id,
            null,
            siteId,
          );
        db.exec('RELEASE assign_legacy_site');
        res.json({
          ...metadata(application),
          assignedFeeds: mappings.length,
          assignedKeys: result.changes,
        });
      } catch (error) {
        db.exec('ROLLBACK TO assign_legacy_site; RELEASE assign_legacy_site');
        throw error;
      }
    },
  );
  app.delete('/api/data-feeds/applications/:id', administrator, (req, res) => {
    const application = applicationById(req.params.id);
    const disconnect =
      z
        .enum(['true', 'false'])
        .default('false')
        .parse(req.query.disconnectWidgets) === 'true';
    if (disconnect) {
      res.json(
        resetConnections.remove(
          { applicationIds: [application.id] },
          { actor: req.user },
        ),
      );
      return;
    }
    if (metadata(application).feedCount)
      throw fail(
        409,
        'APPLICATION_IN_USE',
        'Delete the application’s unused feeds before deleting the application',
      );
    db.exec('SAVEPOINT application_delete');
    try {
      db.prepare(
        'DELETE FROM data_feed_application_tokens WHERE applicationId=?',
      ).run(application.id);
      db.prepare('DELETE FROM data_feed_applications WHERE id=?').run(
        application.id,
      );
      db.exec('RELEASE application_delete');
    } catch (error) {
      db.exec('ROLLBACK TO application_delete; RELEASE application_delete');
      throw error;
    }
    res.json({ ok: true });
  });
  app.get(
    '/api/data-feeds/applications/:id/tokens',
    administrator,
    (req, res) => {
      applicationById(req.params.id);
      res.json(
        db
          .prepare(
            `SELECT ${keyFields} FROM data_feed_application_tokens WHERE applicationId=? ORDER BY createdAt DESC,id`,
          )
          .all(req.params.id),
      );
    },
  );
  app.post(
    '/api/data-feeds/applications/:id/tokens',
    administrator,
    (req, res) => {
      applicationById(req.params.id);
      const input = keySchema.parse(req.body);
      if (input.siteId) requireActiveSite(db, input.siteId);
      else if (db.prepare('SELECT COUNT(*) AS n FROM sites').get().n)
        throw fail(400, 'SITE_REQUIRED', 'Choose a site for this API key');
      const now = new Date().toISOString();
      if (
        db
          .prepare(
            'SELECT COUNT(*) AS n FROM data_feed_application_tokens WHERE applicationId=? AND revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt>?)',
          )
          .get(req.params.id, now).n >= 20
      )
        throw fail(
          409,
          'TOKEN_LIMIT',
          'Maximum of 20 active keys per application reached',
        );
      db.prepare(
        'DELETE FROM data_feed_application_tokens WHERE applicationId=? AND (revokedAt IS NOT NULL OR expiresAt<=?)',
      ).run(req.params.id, now);
      const token = `ofa_${randomBytes(32).toString('base64url')}`;
      const id = randomUUID();
      siteTransaction(db, () => {
        db.prepare(
          'INSERT INTO data_feed_application_tokens(id,applicationId,digest,creatorId,name,createdAt,expiresAt,siteId) VALUES (?,?,?,?,?,?,?,?)',
        ).run(
          id,
          req.params.id,
          digest(token),
          req.user.id,
          input.name,
          now,
          keyExpiry(input.expiresInDays),
          input.siteId,
        );
        auditSite(
          db,
          req.user,
          'application-key-created',
          'application-key',
          id,
          null,
          input.siteId,
        );
      });
      res.status(201).json({
        ...db
          .prepare(
            `SELECT ${keyFields} FROM data_feed_application_tokens WHERE id=?`,
          )
          .get(id),
        token,
      });
    },
  );
  app.patch(
    '/api/data-feeds/applications/:id/tokens/:tokenId',
    administrator,
    (req, res) => {
      applicationById(req.params.id);
      const input = z
        .object({ expiresInDays: expiryDays })
        .strict()
        .parse(req.body);
      const key = db
        .prepare(
          'SELECT * FROM data_feed_application_tokens WHERE applicationId=? AND id=?',
        )
        .get(req.params.id, req.params.tokenId);
      if (!key) throw fail(404, 'NOT_FOUND', 'API key not found');
      if (key.revokedAt)
        throw fail(409, 'TOKEN_REVOKED', 'Revoked keys cannot be renewed');
      if (key.siteId) requireActiveSite(db, key.siteId);
      if (
        db
          .prepare(
            'SELECT COUNT(*) AS n FROM data_feed_application_tokens WHERE applicationId=? AND id<>? AND revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt>?)',
          )
          .get(req.params.id, key.id, new Date().toISOString()).n >= 20
      )
        throw fail(
          409,
          'TOKEN_LIMIT',
          'Maximum of 20 active keys per application reached',
        );
      siteTransaction(db, () => {
        db.prepare(
          'UPDATE data_feed_application_tokens SET expiresAt=? WHERE id=?',
        ).run(keyExpiry(input.expiresInDays), key.id);
        auditSite(
          db,
          req.user,
          'application-key-expiry-changed',
          'application-key',
          key.id,
          key.siteId,
          key.siteId,
        );
      });
      res.json(
        db
          .prepare(
            `SELECT ${keyFields} FROM data_feed_application_tokens WHERE id=?`,
          )
          .get(key.id),
      );
    },
  );
  app.delete(
    '/api/data-feeds/applications/:id/tokens/:tokenId',
    administrator,
    (req, res) => {
      applicationById(req.params.id);
      const scope = db
        .prepare(
          'SELECT siteId FROM data_feed_application_tokens WHERE applicationId=? AND id=?',
        )
        .get(req.params.id, req.params.tokenId);
      siteTransaction(db, () => {
        if (
          !db
            .prepare(
              'UPDATE data_feed_application_tokens SET revokedAt=COALESCE(revokedAt,?) WHERE applicationId=? AND id=?',
            )
            .run(new Date().toISOString(), req.params.id, req.params.tokenId)
            .changes
        )
          throw fail(404, 'NOT_FOUND', 'API key not found');
        auditSite(
          db,
          req.user,
          'application-key-revoked',
          'application-key',
          req.params.tokenId,
          scope?.siteId || null,
          scope?.siteId || null,
        );
      });
      res.json({ ok: true });
    },
  );
  const buckets = new Map();
  // Application keys only authenticate ingestion; session-based management remains admin-only.
  app.post('/api/data-feeds/ingest/:sourceKey', (req, res) => {
    const token = /^Bearer (ofa_[A-Za-z0-9_-]{43})$/.exec(
      req.headers.authorization || '',
    )?.[1];
    const key =
      token &&
      db
        .prepare('SELECT * FROM data_feed_application_tokens WHERE digest=?')
        .get(digest(token));
    const creator =
      key && db.prepare('SELECT * FROM users WHERE id=?').get(key.creatorId);
    const application =
      key &&
      db
        .prepare('SELECT * FROM data_feed_applications WHERE id=?')
        .get(key.applicationId);
    if (
      !key ||
      key.revokedAt ||
      (key.expiresAt !== null && key.expiresAt <= new Date().toISOString()) ||
      !application ||
      !creator ||
      creator.disabled ||
      creator.role !== 'admin'
    )
      throw fail(
        401,
        'INVALID_TOKEN',
        'Invalid, expired, revoked, or unauthorized application key',
      );
    if (key.siteId) requireActiveSite(db, key.siteId);
    if (
      application.managingGroupId &&
      !db
        .prepare('SELECT id FROM groups WHERE id=?')
        .get(application.managingGroupId)
    )
      throw fail(
        409,
        'INVALID_GROUP',
        'The application’s managing group no longer exists',
      );
    const now = Date.now();
    for (const [id, bucket] of buckets)
      if (bucket.until <= now) buckets.delete(id);
    const scopeKey = `site:${application.id}:${key.siteId || 'unassigned'}`;
    const appKey = `application:${application.id}`;
    const scoped = buckets.get(scopeKey) || { until: now + 60000, count: 0 };
    const aggregate = buckets.get(appKey) || { until: now + 60000, count: 0 };
    buckets.set(scopeKey, scoped);
    buckets.set(appKey, aggregate);
    const exceeded =
      scoped.count >= 60 ? scoped : aggregate.count >= 600 ? aggregate : null;
    if (exceeded) {
      res.set(
        'Retry-After',
        String(Math.max(1, Math.ceil((exceeded.until - now) / 1000))),
      );
      throw fail(
        429,
        'RATE_LIMITED',
        exceeded === scoped
          ? 'Maximum of 60 ingestion attempts per minute per application and site'
          : 'Maximum of 600 ingestion attempts per minute per application',
      );
    }
    scoped.count++;
    aggregate.count++;
    if (!req.is('application/json'))
      throw fail(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Send Content-Type: application/json',
      );
    const source = sourceKey.parse(req.params.sourceKey);
    z.record(z.string(), z.unknown()).parse(req.body);
    const entries = Object.entries(req.body);
    if (!entries.length || entries.length > 20)
      throw fail(400, 'INVALID_PAYLOAD', 'Send 1–20 metric fields');
    const mapping = db
      .prepare(
        'SELECT feedId FROM data_feed_application_sources WHERE applicationId=? AND siteId=? AND sourceKey=?',
      )
      .get(application.id, key.siteId || '', source);
    const existing = mapping && raw(mapping.feedId);
    if (mapping && !existing)
      throw fail(
        409,
        'FEED_NOT_FOUND',
        'The application feed was removed; use a new feed name',
      );
    if (!existing && allRecords('data-feed').length >= 200)
      throw fail(409, 'FEED_LIMIT', 'Maximum of 200 feeds reached');
    const fields = [...(existing?.fields || [])];
    const data = Object.fromEntries(Object.entries(existing?.data || {}));
    for (const [name, value] of entries) {
      let field = fields.find((item) => item.key === name);
      if (!field) {
        let type;
        if (value === null || typeof value === 'number') type = 'number';
        else if (
          Array.isArray(value) &&
          value.length &&
          value[0] &&
          typeof value[0] === 'object'
        ) {
          if (Object.hasOwn(value[0], 'time')) type = 'series';
          else if (Object.hasOwn(value[0], 'label')) type = 'categories';
        }
        if (!type)
          throw fail(
            400,
            'INVALID_PAYLOAD',
            `${name}: use a number, null, or a nonempty time-series/category array for a new metric`,
          );
        field = fieldSchema.parse({ key: name, type });
        fields.push(field);
      }
      // Metric names remain data properties, including names such as constructor.
      Object.defineProperty(data, name, {
        value: values[field.type].parse(value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (fields.length > 20)
      throw fail(
        409,
        'FIELD_LIMIT',
        'Maximum of 20 fields per feed reached; use another feed name',
      );
    const updatedAt = new Date().toISOString();
    const feed = {
      ...(existing || {
        id: randomUUID(),
        name: `${application.name} · ${source}`.slice(0, 100),
        createdAt: updatedAt,
        managingGroupId: application.managingGroupId,
        applicationId: application.id,
        sourceKey: source,
        siteId: key.siteId,
      }),
      fields,
      data,
      revision: randomUUID(),
      updatedAt,
    };
    db.exec('SAVEPOINT application_ingest');
    try {
      accounts.context.run({ user: creator, groupId: null }, () =>
        put('data-feed', feed),
      );
      if (!mapping)
        db.prepare(
          'INSERT INTO data_feed_application_sources(applicationId,sourceKey,feedId,siteId) VALUES (?,?,?,?)',
        ).run(application.id, source, feed.id, key.siteId || '');
      db.prepare(
        'UPDATE data_feed_application_tokens SET lastUsedAt=? WHERE id=?',
      ).run(updatedAt, key.id);
      db.exec('RELEASE application_ingest');
    } catch (error) {
      db.exec('ROLLBACK TO application_ingest; RELEASE application_ingest');
      throw error;
    }
    // Return this write's identifiers/schema, without exposing any existing snapshot values.
    res.status(existing ? 200 : 201).json({
      applicationId: application.id,
      siteId: key.siteId,
      sourceKey: source,
      feedId: feed.id,
      fields: feed.fields,
      revision: feed.revision,
      updatedAt,
      created: !existing,
    });
  });
}
