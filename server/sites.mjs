import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const fail = (status, code, message) =>
  Object.assign(new Error(message), { status, code });
export const siteNumberSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{1,20}$/);

export function siteByNumber(db, number) {
  const site = db
    .prepare('SELECT id FROM sites WHERE siteNumber=?')
    .get(number);
  return requireActiveSite(db, site?.id || '');
}

const siteInput = z
  .object({
    siteNumber: siteNumberSchema,
    name: z.string().trim().min(1).max(100),
    accessGroupId: z.uuid().nullable().default(null),
  })
  .strict();

export function requireActiveSite(db, id) {
  const site = db.prepare('SELECT * FROM sites WHERE id=?').get(id);
  if (!site) throw fail(400, 'INVALID_SITE', 'Site not found');
  if (site.archivedAt) throw fail(409, 'SITE_ARCHIVED', 'Site is archived');
  return site;
}

export function siteMember(db, user, site) {
  if (!user || user.disabled || !site?.accessGroupId) return false;
  return !!db
    .prepare(`WITH RECURSIVE audience(id) AS (SELECT id FROM groups WHERE id=? UNION SELECT g.id FROM groups g JOIN audience a ON g.parentId=a.id)
    SELECT 1 FROM memberships WHERE userId=? AND groupId IN (SELECT id FROM audience)`)
    .get(site.accessGroupId, user.id);
}

export function siteTransaction(db, change) {
  db.exec('SAVEPOINT site_change');
  try {
    const result = change();
    db.exec('RELEASE site_change');
    return result;
  } catch (error) {
    db.exec('ROLLBACK TO site_change; RELEASE site_change');
    throw error;
  }
}

export function auditSite(
  db,
  actor,
  action,
  resourceKind,
  resourceId,
  fromSiteId = null,
  toSiteId = null,
) {
  // Fixed columns intentionally exclude request bodies, credentials, and snapshots.
  const tables = {
    site: 'sites',
    application: 'data_feed_applications',
    'application-key': 'data_feed_application_tokens',
    'feed-key': 'data_feed_tokens',
  };
  const table = tables[resourceKind];
  const resourceName = table
    ? db.prepare(`SELECT name FROM ${table} WHERE id=?`).get(resourceId)?.name
    : db
        .prepare(
          "SELECT json_extract(body,'$.name') AS name FROM records WHERE kind=? AND id=?",
        )
        .get(resourceKind, resourceId)?.name;
  db.prepare(
    'INSERT INTO site_audit(id,createdAt,actorKind,actorId,actorName,action,resourceKind,resourceId,fromSiteId,toSiteId,resourceName) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    randomUUID(),
    new Date().toISOString(),
    actor.kind || 'user',
    actor.id,
    actor.name || actor.username || actor.id,
    action,
    resourceKind,
    resourceId,
    fromSiteId,
    toSiteId,
    resourceName || resourceId,
  );
}

export function mountSites(app, { db, administrator, accounts }) {
  db.exec(`CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY, siteNumber TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    createdAt TEXT NOT NULL, archivedAt TEXT);
    CREATE TABLE IF NOT EXISTS site_audit (
      id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, actorKind TEXT NOT NULL,
      actorId TEXT NOT NULL, actorName TEXT NOT NULL, action TEXT NOT NULL,
      resourceKind TEXT NOT NULL, resourceId TEXT NOT NULL, fromSiteId TEXT, toSiteId TEXT);
    CREATE INDEX IF NOT EXISTS site_audit_order ON site_audit(createdAt,id);`);
  if (
    !db
      .prepare('PRAGMA table_info(site_audit)')
      .all()
      .some((column) => column.name === 'resourceName')
  )
    db.exec('ALTER TABLE site_audit ADD COLUMN resourceName TEXT');
  if (
    !db
      .prepare('PRAGMA table_info(sites)')
      .all()
      .some((column) => column.name === 'accessGroupId')
  )
    db.exec('ALTER TABLE sites ADD COLUMN accessGroupId TEXT');
  function accessGroup(kind, id) {
    if (!['device', 'data-feed'].includes(kind)) return null;
    return (
      db
        .prepare(
          "SELECT s.accessGroupId FROM records r JOIN sites s ON s.id=json_extract(r.body,'$.siteId') WHERE r.kind=? AND r.id=?",
        )
        .get(kind, id)?.accessGroupId || null
    );
  }
  accounts.configureSitePolicy({
    device(user, id) {
      // A screen explicitly shared with its store belongs to that whole store,
      // including subgroup members, without depending on the approving account.
      const site = db
        .prepare(`SELECT s.accessGroupId FROM records r
        JOIN sites s ON s.id=json_extract(r.body,'$.siteId')
        JOIN resource_grants g ON g.kind=r.kind AND g.id=r.id AND g.groupId=s.accessGroupId
        WHERE r.kind='device' AND r.id=?`)
        .get(id);
      return siteMember(db, user, site);
    },
    user(user, kind, id) {
      const group = accessGroup(kind, id);
      if (!group) return true;
      return siteMember(db, user, { accessGroupId: group });
    },
    group(groupId, kind, id) {
      const group = accessGroup(kind, id);
      return !group || accounts.related(group, groupId);
    },
  });
  function validateGroup(id) {
    if (id && !db.prepare('SELECT id FROM groups WHERE id=?').get(id))
      throw fail(400, 'INVALID_GROUP', 'Site access group not found');
  }
  app.get('/api/sites/audit', administrator, (req, res) => {
    const query = z
      .object({
        siteId: z.uuid().optional(),
        before: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);
    let at = null,
      id = null;
    if (query.before) {
      const [time, entry] = query.before.split('|');
      at = z.iso.datetime().parse(time);
      id = z.uuid().parse(entry);
    }
    const rows = db
      .prepare(`SELECT * FROM site_audit
      WHERE (? IS NULL OR fromSiteId=? OR toSiteId=?)
        AND (? IS NULL OR createdAt<? OR (createdAt=? AND id<?))
      ORDER BY createdAt DESC,id DESC LIMIT ?`)
      .all(
        query.siteId || null,
        query.siteId || null,
        query.siteId || null,
        at,
        at,
        at,
        id,
        query.limit + 1,
      );
    const entries = rows.slice(0, query.limit);
    const last = entries.at(-1);
    res.json({
      entries,
      nextCursor:
        rows.length > query.limit ? `${last.createdAt}|${last.id}` : null,
    });
  });
  app.get('/api/sites', administrator, (_req, res) => {
    res.json(db.prepare('SELECT * FROM sites ORDER BY siteNumber,id').all());
  });
  app.post('/api/sites', administrator, (req, res) => {
    const input = siteInput.parse(req.body);
    validateGroup(input.accessGroupId);
    if (
      db
        .prepare('SELECT id FROM sites WHERE siteNumber=?')
        .get(input.siteNumber)
    )
      throw fail(409, 'SITE_EXISTS', 'Site number already exists');
    const site = {
      id: randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
      archivedAt: null,
    };
    siteTransaction(db, () => {
      db.prepare(
        'INSERT INTO sites(id,siteNumber,name,createdAt,archivedAt,accessGroupId) VALUES (?,?,?,?,?,?)',
      ).run(
        site.id,
        site.siteNumber,
        site.name,
        site.createdAt,
        null,
        site.accessGroupId,
      );
      auditSite(db, req.user, 'site-created', 'site', site.id, null, site.id);
    });
    res.status(201).json(site);
  });
  app.patch('/api/sites/:id', administrator, (req, res) => {
    const site = db
      .prepare('SELECT * FROM sites WHERE id=?')
      .get(req.params.id);
    if (!site) throw fail(404, 'NOT_FOUND', 'Site not found');
    const input = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        archived: z.boolean().optional(),
        accessGroupId: z.uuid().nullable().optional(),
      })
      .strict()
      .parse(req.body);
    validateGroup(input.accessGroupId);
    const next = {
      ...site,
      accessGroupId:
        input.accessGroupId === undefined
          ? site.accessGroupId
          : input.accessGroupId,
      name: input.name ?? site.name,
      archivedAt:
        input.archived === undefined
          ? site.archivedAt
          : input.archived
            ? site.archivedAt || new Date().toISOString()
            : null,
    };
    siteTransaction(db, () => {
      db.prepare(
        'UPDATE sites SET name=?,archivedAt=?,accessGroupId=? WHERE id=?',
      ).run(next.name, next.archivedAt, next.accessGroupId, site.id);
      if (next.accessGroupId !== site.accessGroupId)
        auditSite(
          db,
          req.user,
          'site-access-changed',
          'site',
          site.id,
          site.id,
          site.id,
        );
      if (next.name !== site.name)
        auditSite(
          db,
          req.user,
          'site-renamed',
          'site',
          site.id,
          site.id,
          site.id,
        );
      if (next.archivedAt !== site.archivedAt)
        auditSite(
          db,
          req.user,
          next.archivedAt ? 'site-archived' : 'site-restored',
          'site',
          site.id,
          site.id,
          site.id,
        );
    });
    res.json(next);
  });
}
