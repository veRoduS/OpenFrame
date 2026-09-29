import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

const fail = (status, message) => Object.assign(new Error(message), { status });
const digest = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const password = z.string().min(12).max(256);
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
    CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships (groupId TEXT NOT NULL, userId TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(groupId,userId));
    CREATE TABLE IF NOT EXISTS invitations (token TEXT PRIMARY KEY, userId TEXT, groupId TEXT, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS resource_access (kind TEXT NOT NULL, id TEXT NOT NULL, ownerId TEXT, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS resource_grants (kind TEXT NOT NULL, id TEXT NOT NULL, userId TEXT NOT NULL DEFAULT '', groupId TEXT NOT NULL DEFAULT '', PRIMARY KEY(kind,id,userId,groupId));
  `);
  const oldPassword = db
    .prepare("SELECT value FROM settings WHERE key='password'")
    .get()?.value;
  if (oldPassword && !db.prepare('SELECT id FROM users LIMIT 1').get()) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,0)').run(
      randomUUID(),
      'admin',
      'Administrator',
      oldPassword,
      'superadmin',
    );
  }
  // The legacy password is migrated once; legacy sessions cannot identify a user.
  db.exec("DELETE FROM settings WHERE key='password'; DELETE FROM sessions;");
  db.exec(
    "INSERT OR IGNORE INTO resource_access(kind,id,ownerId) SELECT kind,id,NULL FROM records WHERE kind IN ('slide','playlist','asset','folder','device')",
  );
  const context = new AsyncLocalStorage();
  const userById = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const groupAdmin = (user, id) =>
    user.role === 'superadmin' ||
    db
      .prepare(
        "SELECT 1 FROM memberships WHERE groupId=? AND userId=? AND role='admin'",
      )
      .get(id, user.id);
  const member = (user, id) =>
    db
      .prepare('SELECT 1 FROM memberships WHERE groupId=? AND userId=?')
      .get(id, user.id);
  const can = (user, kind, id) =>
    !!user &&
    (user.role === 'superadmin' ||
      !!db
        .prepare(
          `SELECT 1 FROM resource_access a WHERE a.kind=? AND a.id=? AND (a.ownerId=? OR EXISTS (SELECT 1 FROM resource_grants g WHERE g.kind=a.kind AND g.id=a.id AND (g.userId=? OR g.groupId IN (SELECT groupId FROM memberships WHERE userId=?))))`,
        )
        .get(kind, id, user.id, user.id, user.id));
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
  function session(req) {
    const value = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('openframe_session='))
      ?.slice(18);
    if (!value) return null;
    return (
      db
        .prepare(
          'SELECT u.* FROM users u JOIN user_sessions s ON s.userId=u.id WHERE s.token=? AND s.expires>? AND u.disabled=0',
        )
        .get(digest(value), Date.now()) || null
    );
  }
  function login(res, user) {
    const value = token();
    db.prepare('DELETE FROM user_sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO user_sessions VALUES (?,?,?)').run(
      digest(value),
      user.id,
      Date.now() + 86400000,
    );
    res.cookie('openframe_session', value, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 86400000,
      path: '/',
    });
  }
  function admin(req, res, next) {
    const user = session(req);
    if (!user) return res.status(401).json({ error: 'Sign in to continue' });
    const groupId = req.get('X-OpenFrame-Group') || null;
    if (
      groupId &&
      (!db.prepare('SELECT id FROM groups WHERE id=?').get(groupId) ||
        (user.role !== 'superadmin' && !member(user, groupId)))
    )
      throw fail(403, 'Group access required');
    req.user = user;
    context.run({ user, groupId }, next);
  }
  function superadmin(req, res, next) {
    admin(req, res, () => {
      if (req.user.role !== 'superadmin')
        return res.status(403).json({ error: 'Super-admin access required' });
      next();
    });
  }
  function createUser(body) {
    const input = z
      .object({
        username,
        name: z.string().trim().min(1).max(100),
        password: password.optional(),
        role: z.enum(['user', 'superadmin']).default('user'),
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
        username: 'superadmin',
        password: randomBytes(24).toString('base64url'),
      };
      createUser({
        ...credentials,
        name: 'Super Administrator',
        role: 'superadmin',
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
      const user = session(req);
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
        role: 'superadmin',
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
    app.get('/api/users', superadmin, (req, res) =>
      res.json(
        db
          .prepare('SELECT * FROM users ORDER BY username')
          .all()
          .map(publicUser),
      ),
    );
    app.post('/api/users', superadmin, (req, res) => {
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
    app.post('/api/users/:id/invitation', superadmin, (req, res) => {
      const user = userById(req.params.id);
      if (!user || user.disabled) throw fail(404, 'User not found');
      db.prepare('DELETE FROM invitations WHERE userId=?').run(user.id);
      res.json({ invitation: invite({ userId: user.id }) });
    });
    app.patch('/api/users/:id', superadmin, (req, res) => {
      const input = z.object({ disabled: z.boolean() }).parse(req.body);
      const user = userById(req.params.id);
      if (!user) throw fail(404, 'User not found');
      if (user.id === req.user.id || user.role === 'superadmin')
        throw fail(400, 'Cannot disable a super-admin');
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
      db.prepare('UPDATE users SET disabled=? WHERE id=?').run(
        Number(input.disabled),
        user.id,
      );
      db.prepare('DELETE FROM user_sessions WHERE userId=?').run(user.id);
      db.prepare('DELETE FROM invitations WHERE userId=?').run(user.id);
      res.json({ ok: true });
    });
    app.get('/api/groups', admin, (req, res) => {
      const groups =
        req.user.role === 'superadmin'
          ? db.prepare('SELECT * FROM groups').all()
          : db
              .prepare(
                'SELECT g.* FROM groups g JOIN memberships m ON m.groupId=g.id WHERE m.userId=?',
              )
              .all(req.user.id);
      res.json(
        groups.map((group) => ({
          ...group,
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
      const { name } = z
        .object({ name: z.string().trim().min(1).max(100) })
        .parse(req.body);
      const id = randomUUID();
      db.prepare('INSERT INTO groups VALUES (?,?)').run(id, name);
      db.prepare('INSERT INTO memberships VALUES (?,?,?)').run(
        id,
        req.user.id,
        'admin',
      );
      res.status(201).json({ id, name });
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
      if (!groupAdmin(req.user, req.params.id))
        throw fail(403, 'Group admin required');
      const { role } = z
        .object({ role: z.enum(['admin', 'member', 'remove']) })
        .parse(req.body);
      const existing = db
        .prepare('SELECT role FROM memberships WHERE groupId=? AND userId=?')
        .get(req.params.id, req.params.userId);
      if (!existing) throw fail(404, 'Member not found');
      if (
        existing.role === 'admin' &&
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
          'UPDATE memberships SET role=? WHERE groupId=? AND userId=?',
        ).run(role, req.params.id, req.params.userId);
      res.json({ ok: true });
    });
  }
  return {
    allowed,
    created,
    session,
    admin,
    superadmin,
    mount,
    can,
    groupAdmin,
    member,
    createUser,
    seedInitialAdmin,
    context,
  };
}
