import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import {
  minimumPasswordLength,
  maximumPasswordLength,
} from './password-policy.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const digest = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
const sessionRenewalInterval = 24 * 60 * 60 * 1000;
const password = z
  .string()
  .min(minimumPasswordLength)
  .max(maximumPasswordLength);
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);
export function hashPassword(value) {
  const salt = token();
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}
function matches(value, saved) {
  if (!saved) return false;
  const [salt, expected] = saved.split(':');
  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    scryptSync(value, salt, 64),
  );
}
const publicUser = ({ password: _password, ...user }) => user;

export function createAccounts(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT, role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS user_sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, parentId TEXT);
    CREATE TABLE IF NOT EXISTS memberships (groupId TEXT NOT NULL, userId TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(groupId,userId));
    CREATE TABLE IF NOT EXISTS invitations (token TEXT PRIMARY KEY, userId TEXT, groupId TEXT, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS resource_access (kind TEXT NOT NULL, id TEXT NOT NULL, ownerId TEXT, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS resource_grants (kind TEXT NOT NULL, id TEXT NOT NULL, userId TEXT NOT NULL DEFAULT '', groupId TEXT NOT NULL DEFAULT '', PRIMARY KEY(kind,id,userId,groupId));
  `);
  if (
    !db
      .prepare('PRAGMA table_info(groups)')
      .all()
      .some((column) => column.name === 'parentId')
  )
    db.exec('ALTER TABLE groups ADD COLUMN parentId TEXT');
  // Preserve existing identities and sessions while retiring the old global role.
  db.exec("UPDATE users SET role='admin' WHERE role='superadmin'");
  const oldPassword = db
    .prepare("SELECT value FROM settings WHERE key='password'")
    .get()?.value;
  if (oldPassword && !db.prepare('SELECT id FROM users LIMIT 1').get()) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,0)').run(
      randomUUID(),
      'admin',
      'Administrator',
      oldPassword,
      'admin',
    );
  }
  // The legacy password is migrated once; legacy sessions cannot identify a user.
  db.exec("DELETE FROM settings WHERE key='password'; DELETE FROM sessions;");
  db.exec(
    "INSERT OR IGNORE INTO resource_access(kind,id,ownerId) SELECT kind,id,NULL FROM records WHERE kind IN ('slide','playlist','asset','folder','device')",
  );
  const context = new AsyncLocalStorage();
  const userById = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const descendants = `WITH RECURSIVE effective_groups(id) AS (
    SELECT groupId FROM memberships WHERE userId=?
    UNION
    SELECT g.id FROM groups g JOIN effective_groups e ON g.parentId=e.id
  )`;
  const groupAdmin = (user, id) =>
    user.role === 'admin' ||
    !!db
      .prepare(`
      WITH RECURSIVE managed(id) AS (
        SELECT groupId FROM memberships WHERE userId=? AND role='admin'
        UNION SELECT g.id FROM groups g JOIN managed m ON g.parentId=m.id
      ) SELECT 1 FROM managed WHERE id=?`)
      .get(user.id, id);
  const member = (user, id) =>
    !!db
      .prepare(`${descendants} SELECT 1 FROM effective_groups WHERE id=?`)
      .get(user.id, id);
  const can = (user, kind, id) =>
    !!user &&
    !user.disabled &&
    (user.role === 'admin' ||
      !!db
        .prepare(`
      ${descendants}
      SELECT 1 FROM resource_access a WHERE a.kind=? AND a.id=? AND (
        a.ownerId=? OR EXISTS (SELECT 1 FROM resource_grants g
          WHERE g.kind=a.kind AND g.id=a.id AND
          (g.userId=? OR g.groupId IN (SELECT id FROM effective_groups))))
    `)
        .get(user.id, kind, id, user.id, user.id));
  const groupCan = (groupId, kind, id) =>
    !!db
      .prepare(`
    WITH RECURSIVE audience(id) AS (
      SELECT id FROM groups WHERE id=?
      UNION SELECT g.id FROM groups g JOIN audience a ON g.parentId=a.id
    ) SELECT 1 FROM resource_grants WHERE kind=? AND id=? AND groupId IN (SELECT id FROM audience)
  `)
      .get(groupId, kind, id);
  const canViewAsset = (user, id) =>
    can(user, 'asset', id) ||
    !!db
      .prepare(
        `WITH RECURSIVE effective_groups(id) AS (
          SELECT groupId FROM memberships WHERE userId=@userId
          UNION SELECT g.id FROM groups g JOIN effective_groups e ON g.parentId=e.id
        ), visible AS (
          SELECT r.kind, r.body FROM records r
          JOIN resource_access a ON a.kind=r.kind AND a.id=r.id
          WHERE r.kind IN ('slide','playlist','device') AND (
            a.ownerId=@userId OR EXISTS (
              SELECT 1 FROM resource_grants g WHERE g.kind=a.kind AND g.id=a.id
              AND (g.userId=@userId OR g.groupId IN (
                SELECT id FROM effective_groups
              ))
            )
          )
        ), playlists AS (
          SELECT body FROM visible WHERE kind='playlist'
          UNION
          SELECT p.body FROM visible d JOIN records p
            ON p.kind='playlist' AND p.id=json_extract(d.body, '$.playlistId')
          WHERE d.kind='device'
        )
        SELECT 1 FROM visible s, json_each(s.body, '$.layers') layer
          WHERE s.kind='slide' AND json_extract(layer.value, '$.type')='image'
          AND json_extract(layer.value, '$.assetId')=@assetId
        UNION ALL
        SELECT 1 FROM playlists p, json_each(p.body, '$.published.items') item,
          json_each(item.value, '$.slide.layers') layer
          WHERE json_extract(layer.value, '$.type')='image'
          AND json_extract(layer.value, '$.assetId')=@assetId
        LIMIT 1`,
      )
      .get({ assetId: id, userId: user?.id || '' });
  const scopedKinds = new Set([
    'slide',
    'playlist',
    'asset',
    'folder',
    'device',
  ]);
  function allowed(kind, id) {
    const user = context.getStore()?.user;
    return !user || !scopedKinds.has(kind) || can(user, kind, id);
  }
  function created(kind, id) {
    const state = context.getStore();
    if (!scopedKinds.has(kind)) return;
    const result = db
      .prepare('INSERT OR IGNORE INTO resource_access VALUES (?,?,?)')
      .run(kind, id, state?.user.id || null);
    if (result.changes && state?.groupId)
      db.prepare('INSERT OR IGNORE INTO resource_grants VALUES (?,?,?,?)').run(
        kind,
        id,
        '',
        state.groupId,
      );
  }
  function sessionCookie(res, value) {
    res.cookie('openframe_session', value, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: sessionLifetime,
      path: '/',
    });
  }
  function session(req, res) {
    const value = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('openframe_session='))
      ?.slice(18);
    if (!value) return null;
    const now = Date.now();
    const saved = db
      .prepare(
        'SELECT u.*, s.expires AS sessionExpires FROM users u JOIN user_sessions s ON s.userId=u.id WHERE s.token=? AND s.expires>? AND u.disabled=0',
      )
      .get(digest(value), now);
    if (!saved) return null;
    const { sessionExpires, ...user } = saved;
    // Renew at most daily, reusing the token so parallel requests stay valid.
    if (
      res &&
      sessionExpires <= now + sessionLifetime - sessionRenewalInterval
    ) {
      const renewed = db
        .prepare(
          'UPDATE user_sessions SET expires=? WHERE token=? AND expires>?',
        )
        .run(now + sessionLifetime, digest(value), now);
      if (!renewed.changes) return null;
      sessionCookie(res, value);
    }
    return user;
  }
  function login(res, user) {
    const value = token();
    db.prepare('DELETE FROM user_sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO user_sessions VALUES (?,?,?)').run(
      digest(value),
      user.id,
      Date.now() + sessionLifetime,
    );
    sessionCookie(res, value);
  }
  function admin(req, res, next) {
    // These routes clear or replace the cookie themselves, without renewing it first.
    const replacesSession =
      req.route?.path === '/api/logout' ||
      req.route?.path === '/api/account/password';
    const user = session(req, replacesSession ? undefined : res);
    if (!user) return res.status(401).json({ error: 'Sign in to continue' });
    const groupId = req.get('X-OpenFrame-Group') || null;
    if (
      groupId &&
      (!db.prepare('SELECT id FROM groups WHERE id=?').get(groupId) ||
        (user.role !== 'admin' && !member(user, groupId)))
    )
      throw fail(403, 'Group access required');
    req.user = user;
    context.run({ user, groupId }, next);
  }
  function administrator(req, res, next) {
    admin(req, res, () => {
      if (req.user.role !== 'admin')
        return res.status(403).json({ error: 'Admin access required' });
      next();
    });
  }
  function createUser(body) {
    const input = z
      .object({
        username,
        name: z.string().trim().min(1).max(100),
        password: password.optional(),
        role: z.enum(['user', 'admin']).default('user'),
      })
      .parse(body);
    if (db.prepare('SELECT id FROM users WHERE username=?').get(input.username))
      throw fail(409, 'Username already exists');
    const user = { id: randomUUID(), ...input };
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,0)').run(
      user.id,
      user.username,
      user.name,
      input.password ? hashPassword(input.password) : null,
      input.role,
    );
    return userById(user.id);
  }
  function invite({ userId = null, groupId = null }) {
    db.prepare('DELETE FROM invitations WHERE expires<?').run(Date.now());
    const value = token();
    db.prepare('INSERT INTO invitations VALUES (?,?,?,?)').run(
      digest(value),
      userId,
      groupId,
      Date.now() + 86400000,
    );
    return value;
  }
  function seedInitialAdmin() {
    // Serialize the empty-database check so simultaneous starts cannot seed twice.
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT id FROM users LIMIT 1').get()) {
        db.exec('COMMIT');
        return null;
      }
      const credentials = {
        username: 'admin',
        password: randomBytes(24).toString('base64url'),
      };
      createUser({
        ...credentials,
        name: 'Administrator',
        role: 'admin',
      });
      db.exec('COMMIT');
      return credentials;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function mount(app, rateLimit) {
    app.get('/api/auth', (req, res) => {
      const user = session(req, res);
      res.json({
        setup: !db.prepare('SELECT id FROM users LIMIT 1').get(),
        authenticated: !!user,
        user: user ? publicUser(user) : null,
      });
    });
    app.post('/api/setup', rateLimit, (req, res) => {
      if (db.prepare('SELECT id FROM users LIMIT 1').get())
        throw fail(409, 'Administrator already configured');
      const value = password.parse(req.body.password);
      const user = createUser({
        username: req.body.username || 'admin',
        name: 'Administrator',
        password: value,
        role: 'admin',
      });
      login(res, user);
      res.json({ ok: true });
    });
    app.post('/api/login', rateLimit, (req, res) => {
      const input = z
        .object({ username: username.default('admin'), password })
        .parse(req.body);
      const user = db
        .prepare('SELECT * FROM users WHERE username=?')
        .get(input.username);
      // Do equivalent password work for unknown usernames as well.
      const valid = matches(
        input.password,
        user?.password || `${'0'.repeat(64)}:${'0'.repeat(128)}`,
      );
      if (!user || user.disabled || !valid)
        throw fail(401, 'Incorrect username or password');
      login(res, user);
      res.json({ ok: true });
    });
    app.post('/api/logout', admin, (req, res) => {
      const value = req.headers.cookie
        ?.split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith('openframe_session='))
        ?.slice(18);
      if (value)
        db.prepare('DELETE FROM user_sessions WHERE token=?').run(
          digest(value),
        );
      res.clearCookie('openframe_session', { path: '/' });
      res.json({ ok: true });
    });
    app.post('/api/account/password', rateLimit, admin, (req, res) => {
      const input = z
        .object({ currentPassword: password, password })
        .parse(req.body);
      if (!matches(input.currentPassword, req.user.password))
        throw fail(403, 'Current password is incorrect');
      db.prepare('UPDATE users SET password=? WHERE id=?').run(
        hashPassword(input.password),
        req.user.id,
      );
      db.prepare('DELETE FROM user_sessions WHERE userId=?').run(req.user.id);
      db.prepare('DELETE FROM invitations WHERE userId=?').run(req.user.id);
      login(res, req.user);
      res.json({ ok: true });
    });
    app.post('/api/activate', rateLimit, (req, res) => {
      const input = z
        .object({ token: z.string().length(64), password })
        .parse(req.body);
      const invitation = db
        .prepare(
          'SELECT * FROM invitations WHERE token=? AND userId IS NOT NULL AND expires>?',
        )
        .get(digest(input.token), Date.now());
      const user = invitation && userById(invitation.userId);
      if (!user || user.disabled)
        throw fail(400, 'Invitation expired or invalid');
      db.prepare('UPDATE users SET password=? WHERE id=?').run(
        hashPassword(input.password),
        user.id,
      );
      db.prepare('DELETE FROM invitations WHERE userId=?').run(user.id);
      db.prepare('DELETE FROM user_sessions WHERE userId=?').run(user.id);
      login(res, user);
      res.json({ ok: true });
    });
    app.get('/api/users', administrator, (req, res) =>
      res.json(
        db
          .prepare('SELECT * FROM users ORDER BY username')
          .all()
          .map(publicUser),
      ),
    );
    app.post('/api/users', administrator, (req, res) => {
      const user = createUser({
        ...req.body,
        password: undefined,
        role: 'user',
      });
      res.status(201).json({
        user: publicUser(user),
        invitation: invite({ userId: user.id }),
      });
    });
    app.post('/api/users/:id/invitation', administrator, (req, res) => {
      const user = userById(req.params.id);
      if (!user || user.disabled) throw fail(404, 'User not found');
      db.prepare('DELETE FROM invitations WHERE userId=?').run(user.id);
      res.json({ invitation: invite({ userId: user.id }) });
    });
    app.patch('/api/users/:id', administrator, (req, res) => {
      const input = z
        .object({
          disabled: z.boolean().optional(),
          role: z.enum(['user', 'admin']).optional(),
        })
        .refine(
          (value) => value.disabled !== undefined || value.role !== undefined,
          'Choose a role or status',
        )
        .parse(req.body);
      const user = userById(req.params.id);
      if (!user) throw fail(404, 'User not found');
      const nextRole = input.role ?? user.role;
      const disabled = input.disabled ?? !!user.disabled;
      if (user.id === req.user.id && (disabled || nextRole !== 'admin'))
        throw fail(400, 'Cannot disable or demote your own admin account');
      if (
        user.role === 'admin' &&
        !user.disabled &&
        (disabled || nextRole !== 'admin') &&
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0",
          )
          .get().n <= 1
      )
        throw fail(409, 'Keep at least one active admin');
      if (input.disabled) {
        const soleAdmin = db
          .prepare(
            `SELECT m.groupId FROM memberships m WHERE m.userId=? AND m.role='admin' AND NOT EXISTS (SELECT 1 FROM memberships other JOIN users u ON u.id=other.userId WHERE other.groupId=m.groupId AND other.role='admin' AND other.userId<>? AND u.disabled=0)`,
          )
          .get(user.id, user.id);
        if (soleAdmin)
          throw fail(
            409,
            'Assign another active group admin before disabling this user',
          );
      }
      db.prepare('UPDATE users SET disabled=?,role=? WHERE id=?').run(
        Number(disabled),
        nextRole,
        user.id,
      );
      if (disabled) {
        db.prepare('DELETE FROM user_sessions WHERE userId=?').run(user.id);
        db.prepare('DELETE FROM invitations WHERE userId=?').run(user.id);
      }
      res.json({ ok: true });
    });
    app.get('/api/groups', admin, (req, res) => {
      const groups =
        req.user.role === 'admin'
          ? db
              .prepare('SELECT * FROM groups ORDER BY name COLLATE NOCASE')
              .all()
          : db
              .prepare(
                `${descendants} SELECT g.* FROM groups g JOIN effective_groups e ON e.id=g.id ORDER BY g.name COLLATE NOCASE`,
              )
              .all(req.user.id);
      res.json(
        groups.map((group) => ({
          ...group,
          parentId: group.parentId || null,
          canManage: !!groupAdmin(req.user, group.id),
          members: db
            .prepare(
              'SELECT u.id,u.username,u.name,m.role FROM memberships m JOIN users u ON u.id=m.userId WHERE m.groupId=?',
            )
            .all(group.id),
        })),
      );
    });
    app.post('/api/groups', admin, (req, res) => {
      const { name, parentId } = z
        .object({
          name: z.string().trim().min(1).max(100),
          parentId: z.uuid().nullable().optional(),
        })
        .parse(req.body);
      if (
        parentId &&
        (!db.prepare('SELECT id FROM groups WHERE id=?').get(parentId) ||
          !groupAdmin(req.user, parentId))
      )
        throw fail(
          403,
          'A parent group admin is required to create a subgroup',
        );
      const id = randomUUID();
      db.prepare('INSERT INTO groups(id,name,parentId) VALUES (?,?,?)').run(
        id,
        name,
        parentId || null,
      );
      db.prepare('INSERT INTO memberships VALUES (?,?,?)').run(
        id,
        req.user.id,
        'admin',
      );
      res.status(201).json({ id, name, parentId: parentId || null });
    });
    app.patch('/api/groups/:id', admin, (req, res) => {
      const group = db
        .prepare('SELECT * FROM groups WHERE id=?')
        .get(req.params.id);
      if (!group) throw fail(404, 'Group not found');
      if (!groupAdmin(req.user, group.id))
        throw fail(403, 'Group admin required');
      const input = z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          parentId: z.uuid().nullable().optional(),
        })
        .refine(
          (value) => value.name !== undefined || value.parentId !== undefined,
          'Choose a name or parent',
        )
        .parse(req.body);
      if (input.parentId !== undefined && req.user.role !== 'admin')
        throw fail(403, 'Only an admin can move groups');
      const parentId =
        input.parentId === undefined ? group.parentId : input.parentId;
      if (
        parentId &&
        (!db.prepare('SELECT id FROM groups WHERE id=?').get(parentId) ||
          !groupAdmin(req.user, parentId))
      )
        throw fail(403, 'Parent group admin required');
      if (
        req.user.role !== 'admin' &&
        group.parentId &&
        group.parentId !== parentId &&
        !groupAdmin(req.user, group.parentId)
      )
        throw fail(403, 'Current parent group admin required');
      let ancestor = parentId;
      const seen = new Set([group.id]);
      while (ancestor) {
        if (seen.has(ancestor))
          throw fail(400, 'A group cannot be moved inside itself');
        seen.add(ancestor);
        ancestor = db
          .prepare('SELECT parentId FROM groups WHERE id=?')
          .get(ancestor)?.parentId;
      }
      db.prepare('UPDATE groups SET name=?,parentId=? WHERE id=?').run(
        input.name ?? group.name,
        parentId,
        group.id,
      );
      res.json({ ok: true });
    });
    app.post('/api/groups/join', admin, rateLimit, (req, res) => {
      const value = z.string().length(64).parse(req.body.token);
      const invitation = db
        .prepare(
          'SELECT * FROM invitations WHERE token=? AND groupId IS NOT NULL AND expires>?',
        )
        .get(digest(value), Date.now());
      if (!invitation) throw fail(400, 'Invitation expired or invalid');
      db.prepare("INSERT OR IGNORE INTO memberships VALUES (?,?,'member')").run(
        invitation.groupId,
        req.user.id,
      );
      db.prepare('DELETE FROM invitations WHERE token=?').run(digest(value));
      res.json({ ok: true });
    });
    app.post('/api/groups/:id/invitation', admin, (req, res) => {
      if (
        !groupAdmin(req.user, req.params.id) ||
        !db.prepare('SELECT id FROM groups WHERE id=?').get(req.params.id)
      )
        throw fail(403, 'Group admin required');
      res.json({ invitation: invite({ groupId: req.params.id }) });
    });
    app.put('/api/groups/:id/members/:userId', admin, (req, res) => {
      if (!db.prepare('SELECT id FROM groups WHERE id=?').get(req.params.id))
        throw fail(404, 'Group not found');
      if (!groupAdmin(req.user, req.params.id))
        throw fail(403, 'Group admin required');
      const { role } = z
        .object({ role: z.enum(['admin', 'member', 'remove']) })
        .parse(req.body);
      const existing = db
        .prepare('SELECT role FROM memberships WHERE groupId=? AND userId=?')
        .get(req.params.id, req.params.userId);
      const target = userById(req.params.userId);
      if (!target || (target.disabled && role !== 'remove'))
        throw fail(404, 'Active user not found');
      if (!existing && req.user.role !== 'admin')
        throw fail(403, 'Only an admin can add existing users');
      if (!existing && role === 'remove') throw fail(404, 'Member not found');
      if (
        existing?.role === 'admin' &&
        role !== 'admin' &&
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM memberships m JOIN users u ON u.id=m.userId WHERE m.groupId=? AND m.role='admin' AND u.disabled=0",
          )
          .get(req.params.id).n <= 1
      )
        throw fail(409, 'Each group must retain an active admin');
      if (role === 'remove')
        db.prepare('DELETE FROM memberships WHERE groupId=? AND userId=?').run(
          req.params.id,
          req.params.userId,
        );
      else
        db.prepare(
          'INSERT INTO memberships(groupId,userId,role) VALUES (?,?,?) ON CONFLICT(groupId,userId) DO UPDATE SET role=excluded.role',
        ).run(req.params.id, req.params.userId, role);
      res.json({ ok: true });
    });
  }
  return {
    allowed,
    canViewAsset,
    created,
    session,
    admin,
    administrator,
    mount,
    can,
    groupAdmin,
    groupCan,
    member,
    createUser,
    seedInitialAdmin,
    context,
  };
}
