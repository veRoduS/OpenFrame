import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  requireActiveSite,
  auditSite,
  siteTransaction,
  siteNumberSchema,
} from './sites.mjs';
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
    siteIds: z.array(z.uuid()).min(1).max(200).optional(),
    expiresInDays: expiryDays.default(90),
  })
  .strict();
const sourceKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
const keyFields =
  'id,applicationId,name,createdAt,expiresAt,revokedAt,lastUsedAt,siteId,siteIds';
const publicKey = (key) => ({
  ...key,
  siteIds: key.siteIds ? JSON.parse(key.siteIds) : null,
});

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
    fieldLimits,
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
  if (
    !db
      .prepare('PRAGMA table_info(data_feed_application_tokens)')
      .all()
      .some((column) => column.name === 'siteIds')
  )
    db.exec('ALTER TABLE data_feed_application_tokens ADD COLUMN siteIds TEXT');
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
            'UPDATE data_feed_application_tokens SET siteId=? WHERE applicationId=? AND siteId IS NULL AND siteIds IS NULL',
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
          .all(req.params.id)
          .map(publicKey),
      );
    },
  );
  app.post(
    '/api/data-feeds/applications/:id/tokens',
    administrator,
    (req, res) => {
      applicationById(req.params.id);
      const input = keySchema.parse(req.body);
      if (input.siteIds) {
        if (
          input.siteId ||
          new Set(input.siteIds).size !== input.siteIds.length
        )
          throw fail(
            400,
            'INVALID_SCOPE',
            'Choose distinct stores and do not combine siteId with siteIds',
          );
        for (const id of input.siteIds) requireActiveSite(db, id);
      } else if (input.siteId) requireActiveSite(db, input.siteId);
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
          'INSERT INTO data_feed_application_tokens(id,applicationId,digest,creatorId,name,createdAt,expiresAt,siteId,siteIds) VALUES (?,?,?,?,?,?,?,?,?)',
        ).run(
          id,
          req.params.id,
          digest(token),
          req.user.id,
          input.name,
          now,
          keyExpiry(input.expiresInDays),
          input.siteId,
          input.siteIds ? JSON.stringify(input.siteIds) : null,
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
        ...publicKey(
          db
            .prepare(
              `SELECT ${keyFields} FROM data_feed_application_tokens WHERE id=?`,
            )
            .get(id),
        ),
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
      if (key.siteIds)
        for (const id of JSON.parse(key.siteIds)) requireActiveSite(db, id);
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
        publicKey(
          db
            .prepare(
              `SELECT ${keyFields} FROM data_feed_application_tokens WHERE id=?`,
            )
            .get(key.id),
        ),
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
  const authenticate = (req) => {
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
    return { key, creator, application };
  };
  const charge = (applicationId, siteIds, res, cost = siteIds.length) => {
    const now = Date.now();
    for (const [id, bucket] of buckets)
      if (bucket.until <= now) buckets.delete(id);
    const charges = [
      [`application:${applicationId}`, 600, cost],
      ...siteIds.map((id) => [
        `site:${applicationId}:${id || 'unassigned'}`,
        60,
        1,
      ]),
    ];
    const pending = charges.map(([id, limit, amount]) => ({
      id,
      limit,
      amount,
      bucket: buckets.get(id) || { until: now + 60000, count: 0 },
    }));
    const exceeded = pending.find(
      (item) => item.bucket.count + item.amount > item.limit,
    );
    if (exceeded) {
      res.set(
        'Retry-After',
        String(Math.max(1, Math.ceil((exceeded.bucket.until - now) / 1000))),
      );
      throw fail(
        429,
        'RATE_LIMITED',
        exceeded.limit === 600
          ? 'Maximum of 600 ingestion attempts per minute per application'
          : 'Maximum of 60 ingestion attempts per minute per application and site',
      );
    }
    for (const { id, amount, bucket } of pending) {
      bucket.count += amount;
      buckets.set(id, bucket);
    }
  };
  const prepare = (
    application,
    siteId,
    source,
    body,
    managingGroupId = application.managingGroupId,
    forcedType = null,
  ) => {
    z.record(z.string(), z.unknown()).parse(body);
    const entries = Object.entries(body);
    if (Buffer.byteLength(JSON.stringify(body)) > 32768)
      throw fail(
        413,
        'PAYLOAD_TOO_LARGE',
        'Each metrics or tables section must be at most 32 KiB',
      );
    const mapping = db
      .prepare(
        'SELECT feedId FROM data_feed_application_sources WHERE applicationId=? AND siteId=? AND sourceKey=?',
      )
      .get(application.id, siteId || '', source);
    const existing = mapping && raw(mapping.feedId);
    const limit = fieldLimits.read().maxFieldsPerFeed;
    // Lowering the limit never blocks value updates to existing wider feeds.
    const allowedInputFields = Math.max(limit, existing?.fields.length || 0);
    if (!entries.length || entries.length > allowedInputFields)
      throw fail(
        400,
        'INVALID_PAYLOAD',
        `Send 1–${allowedInputFields} fields per section`,
      );
    if (mapping && !existing)
      throw fail(
        409,
        'FEED_NOT_FOUND',
        'The application feed was removed; use a new feed name',
      );
    const fields = [...(existing?.fields || [])];
    const data = Object.fromEntries(Object.entries(existing?.data || {}));
    for (const [name, value] of entries) {
      let field = fields.find((item) => item.key === name);
      if (!field) {
        let type = forcedType;
        if (!type && (value === null || typeof value === 'number'))
          type = 'number';
        else if (
          !type &&
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
      if (forcedType && field.type !== forcedType)
        throw fail(
          409,
          'SOURCE_SCHEMA_CONFLICT',
          `${name}: table fields must use categories`,
        );
      // Metric names remain data properties, including names such as constructor.
      Object.defineProperty(data, name, {
        value: values[field.type].parse(value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (fields.length > limit && fields.length > (existing?.fields.length || 0))
      throw fail(
        409,
        'FIELD_LIMIT',
        `Maximum of ${limit} fields per feed reached; adjust Feed limits in Settings or use another source`,
      );
    const updatedAt = new Date().toISOString();
    const feed = {
      ...(existing || {
        id: randomUUID(),
        name: `${application.name} · ${source}`.slice(0, 100),
        createdAt: updatedAt,
        managingGroupId,
        applicationId: application.id,
        sourceKey: source,
        siteId,
      }),
      fields,
      data,
      revision: randomUUID(),
      updatedAt,
    };
    return { feed, mapping, existing };
  };
  const save = ({ key, creator, application }, plans) => {
    if (
      allRecords('data-feed').length +
        plans.filter((plan) => !plan.existing).length >
      200
    )
      throw fail(409, 'FEED_LIMIT', 'Maximum of 200 feeds reached');
    db.exec('SAVEPOINT application_ingest');
    try {
      for (const { feed, mapping } of plans) {
        accounts.context.run({ user: creator, groupId: null }, () =>
          put('data-feed', feed),
        );
        if (!mapping)
          db.prepare(
            'INSERT INTO data_feed_application_sources(applicationId,sourceKey,feedId,siteId) VALUES (?,?,?,?)',
          ).run(application.id, feed.sourceKey, feed.id, feed.siteId || '');
      }
      db.prepare(
        'UPDATE data_feed_application_tokens SET lastUsedAt=? WHERE id=?',
      ).run(new Date().toISOString(), key.id);
      db.exec('RELEASE application_ingest');
    } catch (error) {
      db.exec('ROLLBACK TO application_ingest; RELEASE application_ingest');
      throw error;
    }
  };
  const jsonOnly = (req) => {
    if (!req.is('application/json'))
      throw fail(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Send Content-Type: application/json',
      );
  };
  // Application keys only authenticate ingestion; session-based management remains admin-only.
  app.post('/api/data-feeds/ingest/:sourceKey', (req, res) => {
    const auth = authenticate(req);
    const { key, application } = auth;
    if (key.siteIds)
      throw fail(
        403,
        'KEY_SCOPE',
        'Use the multi-store endpoint with a central key',
      );
    if (key.siteId) requireActiveSite(db, key.siteId);
    charge(application.id, [key.siteId], res);
    jsonOnly(req);
    const source = sourceKey.parse(req.params.sourceKey);
    const plan = prepare(application, key.siteId, source, req.body);
    save(auth, [plan]);
    const { feed, existing } = plan;
    res.status(existing ? 200 : 201).json({
      applicationId: application.id,
      siteId: key.siteId,
      sourceKey: source,
      feedId: feed.id,
      fields: feed.fields,
      revision: feed.revision,
      updatedAt: feed.updatedAt,
      created: !existing,
    });
  });
  const storeBatch = z
    .object({
      stores: z
        .array(
          z
            .object({
              siteNumber: siteNumberSchema,
              metrics: z.record(z.string(), z.unknown()).optional(),
              tables: z.record(z.string(), z.unknown()).optional(),
            })
            .strict()
            .refine(
              (store) =>
                store.metrics !== undefined || store.tables !== undefined,
              'Include metrics or tables',
            ),
        )
        .min(1)
        .max(50),
    })
    .strict();
  app.post('/api/data-feeds/ingest-stores/:sourceKey', (req, res) => {
    const auth = authenticate(req);
    const { key, application } = auth;
    if (!key.siteIds)
      throw fail(
        403,
        'KEY_SCOPE',
        'A central key with selected stores is required',
      );
    charge(application.id, [], res, 1);
    jsonOnly(req);
    const source = sourceKey.parse(req.params.sourceKey);
    const { stores } = storeBatch.parse(req.body);
    if (new Set(stores.map((store) => store.siteNumber)).size !== stores.length)
      throw fail(400, 'DUPLICATE_SITE', 'Include each store number once');
    const allowed = new Set(JSON.parse(key.siteIds));
    const sites = stores.map((store) => {
      const site = db
        .prepare('SELECT * FROM sites WHERE siteNumber=?')
        .get(store.siteNumber);
      // Avoid disclosing store configuration to a key outside its authorized scope.
      if (!site || !allowed.has(site.id))
        throw fail(
          403,
          'SITE_NOT_AUTHORIZED',
          'A store is outside this key’s scope',
        );
      return requireActiveSite(db, site.id);
    });
    charge(
      application.id,
      sites.map((site) => site.id),
      res,
      stores.length - 1,
    );
    const plans = [];
    for (let index = 0; index < stores.length; index++) {
      const store = stores[index],
        site = sites[index];
      const owner = site.accessGroupId || application.managingGroupId;
      if (store.metrics !== undefined)
        plans.push(prepare(application, site.id, source, store.metrics, owner));
      if (store.tables !== undefined)
        plans.push(
          prepare(
            application,
            site.id,
            sourceKey.parse(`${source}-tables`),
            store.tables,
            owner,
            'categories',
          ),
        );
    }
    // A logical source uses one field type across stores, including existing snapshots.
    const schemas = new Map();
    for (const feed of [
      ...allRecords('data-feed').filter(
        (feed) => feed.applicationId === application.id,
      ),
      ...plans.map((plan) => plan.feed),
    ]) {
      if (!plans.some((plan) => plan.feed.sourceKey === feed.sourceKey))
        continue;
      for (const field of feed.fields) {
        const id = JSON.stringify([feed.sourceKey, field.key]);
        if (schemas.has(id) && schemas.get(id) !== field.type)
          throw fail(
            409,
            'SOURCE_SCHEMA_CONFLICT',
            `${feed.sourceKey}.${field.key}: field types must match across stores`,
          );
        schemas.set(id, field.type);
      }
    }
    save(auth, plans);
    res.json({
      ok: true,
      applicationId: application.id,
      sourceKey: source,
      storesAccepted: stores.length,
      feedsCreated: plans.filter((plan) => !plan.existing).length,
      feedsUpdated: plans.filter((plan) => plan.existing).length,
      updatedAt: new Date().toISOString(),
    });
  });
}
