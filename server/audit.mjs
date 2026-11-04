import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { siteTransaction } from './sites.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const keys = {
  records: ['kind', 'id'],
  resource_grants: ['kind', 'id', 'userId', 'groupId'],
  resource_permissions: ['kind', 'id', 'userId', 'groupId'],
  resource_management: ['kind', 'id'],
  resource_access: ['kind', 'id'],
  users: ['id'],
  groups: ['id'],
  memberships: ['groupId', 'userId'],
  user_home_preferences: ['userId'],
  custom_fonts: ['id'],
  sites: ['id'],
  settings: ['key'],
  data_feed_applications: ['id'],
  data_feed_tokens: ['id'],
  data_feed_application_tokens: ['id'],
};
export function createAudit(db) {
  const context = new AsyncLocalStorage();
  db.exec(`CREATE TABLE IF NOT EXISTS app_audit (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, requestId TEXT NOT NULL, createdAt TEXT NOT NULL,
    actorId TEXT NOT NULL, actorName TEXT NOT NULL, action TEXT NOT NULL, tableName TEXT NOT NULL,
    resourceKind TEXT NOT NULL, resourceId TEXT NOT NULL, resourceName TEXT NOT NULL,
    beforeJson TEXT, afterJson TEXT);
    CREATE INDEX IF NOT EXISTS app_audit_request ON app_audit(requestId,sequence);`);
  db.function('audit_request', () => context.getStore()?.id || '');
  db.function(
    'audit_actor',
    () =>
      context.getStore()?.req.user?.id ||
      context.getStore()?.req.auditActor?.id ||
      'system-api',
  );
  db.function('audit_name', () => {
    const req = context.getStore()?.req;
    return (
      req?.auditActor?.name ||
      req?.user?.name ||
      req?.user?.username ||
      (req?.device ? `Player: ${req.device.name}` : 'System / API')
    );
  });
  db.function('audit_action', () => context.getStore()?.action || '');
  db.function('audit_safe', (table, value) => {
    if (!value) return null;
    const row = JSON.parse(value);
    if (table === 'users')
      return JSON.stringify(
        Object.fromEntries(
          ['id', 'username', 'name', 'role', 'disabled'].map((k) => [
            k,
            row[k],
          ]),
        ),
      );
    if (table.endsWith('_tokens')) {
      delete row.digest;
      delete row.tokenHash;
      delete row.lastUsedAt;
    }
    if (table === 'settings') return JSON.stringify({ key: row.key });
    if (table === 'records') {
      let body;
      try {
        body = typeof row.body === 'string' ? JSON.parse(row.body) : row.body;
      } catch {
        body = { id: row.id, name: 'Invalid saved record' };
      }
      row.body = JSON.stringify(body);
      if (
        ![
          'slide',
          'playlist',
          'slide-folder',
          'playlist-folder',
          'folder',
          'asset',
        ].includes(row.kind)
      ) {
        row.body = JSON.stringify(
          Object.fromEntries(
            [
              'id',
              'name',
              'siteId',
              'playlistId',
              'approved',
              'rotation',
              'blank',
              'managingGroupId',
              'fields',
              'command',
              'siteRevision',
              'siteTransfer',
            ]
              .filter((k) => body[k] !== undefined)
              .map((k) => [k, body[k]]),
          ),
        );
      }
    }
    return JSON.stringify(row);
  });
  return {
    middleware(req, _res, next) {
      context.run(
        { id: randomUUID(), req, action: `${req.method} ${req.path}` },
        next,
      );
    },
    install(app, administrator, validateRestore) {
      for (const table of Object.keys(keys)) {
        const columns = db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((c) => c.name)
          .filter(
            (name) =>
              !(
                table === 'data_feed_application_tokens' &&
                ['siteId', 'siteIds'].includes(name)
              ),
          );
        if (!columns.length) continue;
        const row = (prefix) =>
          `audit_safe('${table}',json_object(${columns.map((c) => `'${c}',${prefix}.${c}`).join(',')}))`;
        for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
          const existing = `(SELECT ${row('previous')} FROM ${table} previous WHERE ${keys[table].map((k) => `previous.${k}=NEW.${k}`).join(' AND ')})`;
          const before = operation === 'INSERT' ? existing : row('OLD');
          const after = operation === 'DELETE' ? 'NULL' : row('NEW');
          const prefix = operation === 'DELETE' ? 'OLD' : 'NEW';
          const kind =
            table === 'records' || table.startsWith('resource_')
              ? `${prefix}.kind`
              : `'${table}'`;
          const id = columns.includes('id')
            ? `${prefix}.id`
            : columns.includes('userId')
              ? `${prefix}.userId`
              : `${prefix}.key`;
          const name =
            table === 'records'
              ? `COALESCE(json_extract(${prefix}.body,'$.name'),${prefix}.id)`
              : columns.includes('name')
                ? `${prefix}.name`
                : id;
          db.exec(`DROP TRIGGER IF EXISTS app_audit_${table}_${operation}`);
          db.exec(`CREATE TEMP TRIGGER app_audit_${table}_${operation} ${operation === 'INSERT' ? 'BEFORE' : 'AFTER'} ${operation} ON ${table}
            WHEN audit_request()<>'' AND (${['settings', 'users'].includes(table) ? '1' : `${before} IS NOT ${after}`})
            BEGIN INSERT INTO app_audit(requestId,createdAt,actorId,actorName,action,tableName,resourceKind,resourceId,resourceName,beforeJson,afterJson)
            VALUES(audit_request(),strftime('%Y-%m-%dT%H:%M:%fZ','now'),audit_actor(),audit_name(),audit_action(),'${table}',${kind},${id},${name},${before},${after}); END;`);
        }
      }
      const canRestore = (rows) =>
        rows.length > 0 &&
        rows.every(
          (r) =>
            (r.tableName === 'records' &&
              ['slide', 'playlist'].includes(r.resourceKind) &&
              r.beforeJson &&
              r.afterJson) ||
            [
              'resource_grants',
              'resource_permissions',
              'resource_management',
            ].includes(r.tableName),
        );
      app.get('/api/audit', administrator, (req, res) => {
        const q = z
          .object({
            search: z.string().max(100).default(''),
            actorId: z.string().max(100).default(''),
            kind: z.string().max(40).default(''),
            action: z.string().max(100).default(''),
            from: z.string().max(30).default(''),
            to: z.string().max(30).default(''),
            before: z.coerce.number().int().positive().optional(),
          })
          .parse(req.query);
        const rows = db
          .prepare(
            `SELECT * FROM app_audit WHERE (?='' OR actorId=?) AND (?='' OR resourceKind=?) AND (?='' OR instr(action,?)>0) AND (?='' OR createdAt>=?) AND (?='' OR createdAt<=?) AND (? IS NULL OR sequence<?) AND (?='' OR instr(lower(resourceName||' '||resourceId||' '||actorName),lower(?))>0) ORDER BY sequence DESC LIMIT 51`,
          )
          .all(
            q.actorId,
            q.actorId,
            q.kind,
            q.kind,
            q.action,
            q.action,
            q.from,
            q.from,
            q.to,
            q.to,
            q.before || null,
            q.before || null,
            q.search,
            q.search,
          );
        const entries = rows
          .slice(0, 50)
          .map(({ beforeJson, afterJson, ...r }) => {
            const request = db
              .prepare('SELECT * FROM app_audit WHERE requestId=?')
              .all(r.requestId);
            return {
              ...r,
              operation: !beforeJson
                ? 'created'
                : !afterJson
                  ? 'deleted'
                  : 'updated',
              canRestore: canRestore(request),
            };
          });
        res.json({
          entries,
          nextCursor: rows.length > 50 ? entries.at(-1).sequence : null,
        });
      });
      app.get('/api/audit/:sequence', administrator, (req, res) => {
        const row = db
          .prepare('SELECT * FROM app_audit WHERE sequence=?')
          .get(z.coerce.number().int().parse(req.params.sequence));
        if (!row) throw fail(404, 'History entry not found');
        res.json({
          ...row,
          before: row.beforeJson ? JSON.parse(row.beforeJson) : null,
          after: row.afterJson ? JSON.parse(row.afterJson) : null,
          related: db
            .prepare(
              'SELECT sequence,resourceName,resourceKind,action FROM app_audit WHERE requestId=? ORDER BY sequence',
            )
            .all(row.requestId),
          beforeJson: undefined,
          afterJson: undefined,
        });
      });
      app.post('/api/audit/:sequence/revert', administrator, (req, res) => {
        const entry = db
          .prepare('SELECT * FROM app_audit WHERE sequence=?')
          .get(z.coerce.number().int().parse(req.params.sequence));
        if (!entry) throw fail(404, 'History entry not found');
        const rows = db
          .prepare(
            'SELECT * FROM app_audit WHERE requestId=? ORDER BY sequence DESC',
          )
          .all(entry.requestId);
        if (!canRestore(rows))
          throw fail(
            409,
            'This operation cannot be restored automatically. Account, device, upload, deletion and configuration history is audit-only.',
          );
        context.getStore().action = `REVERT ${entry.requestId}`;
        siteTransaction(db, () => {
          for (const row of rows) {
            const before = row.beforeJson && JSON.parse(row.beforeJson),
              after = row.afterJson && JSON.parse(row.afterJson);
            const target = after || before,
              columns = keys[row.tableName];
            const where = columns.map((c) => `${c}=?`).join(' AND ');
            const values = columns.map((c) => target[c]);
            const current = db
              .prepare(`SELECT * FROM ${row.tableName} WHERE ${where}`)
              .get(...values);
            if (JSON.stringify(current || null) !== JSON.stringify(after))
              throw fail(
                409,
                'This item has newer changes. Review its current state before restoring.',
              );
            if (row.tableName === 'records')
              validateRestore(row.resourceKind, JSON.parse(before.body));
            else {
              if (
                !db
                  .prepare('SELECT 1 FROM records WHERE kind=? AND id=?')
                  .get(target.kind, target.id)
              )
                throw fail(409, 'The shared item no longer exists');
              if (
                before?.groupId &&
                !db
                  .prepare('SELECT 1 FROM groups WHERE id=?')
                  .get(before.groupId)
              )
                throw fail(409, 'The group no longer exists');
              if (
                before?.userId &&
                !db.prepare('SELECT 1 FROM users WHERE id=?').get(before.userId)
              )
                throw fail(409, 'The user no longer exists');
            }
            if (before) {
              const fields = Object.keys(before);
              db.prepare(
                `INSERT OR REPLACE INTO ${row.tableName}(${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
              ).run(...fields.map((c) => before[c]));
            } else
              db.prepare(`DELETE FROM ${row.tableName} WHERE ${where}`).run(
                ...values,
              );
          }
        });
        res.json({ ok: true });
      });
    },
  };
}
