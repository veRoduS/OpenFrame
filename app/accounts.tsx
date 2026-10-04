import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  minimumPasswordLength,
  maximumPasswordLength,
} from '../server/password-policy.mjs';
import {
  ChevronRight,
  Copy,
  KeyRound,
  Plus,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { api } from './types';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';
import { orderedTree, isWithin, indentedName } from './hierarchy';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import './accounts.css';

export type User = {
  id: string;
  username: string;
  name: string;
  role: string;
  disabled: number;
};
export type Auth = { setup: boolean; authenticated: boolean; user?: User };
type Group = {
  id: string;
  name: string;
  parentId: string | null;
  canManage: boolean;
  members: (User & { role: string; accountRole?: string })[];
};
type Resource = { kind: string; id: string; name: string };
const fields = (event: SyntheticEvent<HTMLFormElement>) => {
  event.preventDefault();
  return Object.fromEntries(
    [...new FormData(event.currentTarget)].map(([key, value]) => [
      key,
      typeof value === 'string' ? value : '',
    ]),
  ) as Record<string, string>;
};
async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copyCommand = Reflect.get(document, 'execCommand') as
    | ((command: string) => boolean)
    | undefined;
  const copied = copyCommand?.call(document, 'copy') ?? false;
  input.remove();
  if (!copied)
    throw new Error('Copy is unavailable. Select and copy the link instead.');
}

export function PasswordSettings({ user }: { user: User }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="account-notice">{notice}</output>}
      <section className="account-section">
        <h2>Change password</h2>
        <p className="muted">
          {user.name} · {user.username}
        </p>
        <form
          className="account-form"
          onSubmit={(e) => {
            const form = e.currentTarget;
            const data = fields(e);
            void run(async () => {
              if (data.password !== data.confirm)
                throw new Error('New passwords do not match');
              await api('/api/account/password', 'POST', {
                currentPassword: data.currentPassword,
                password: data.password,
              });
              form.reset();
              setNotice(
                'Password changed. Other sessions have been signed out.',
              );
            });
          }}
        >
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={minimumPasswordLength}
              maxLength={maximumPasswordLength}
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={minimumPasswordLength}
              maxLength={maximumPasswordLength}
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            <KeyRound size={16} />
            Change password
          </button>
        </form>
      </section>
    </div>
  );
}

export function Accounts({
  user,
  refresh,
}: {
  user: User;
  refresh: () => Promise<void>;
}) {
  const [dragged, setDragged] = useState<{
    type: 'group';
    id: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [tab, setTab] = useState('groups');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<{
    name: string;
    username: string;
    password: string;
  } | null>(null);
  const [invitation, setInvitation] = useState<{
    value: string;
    group: boolean;
  } | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const isAdmin = user.role === 'admin';
  const reload = useCallback(async () => {
    setGroups(await api<Group[]>('/api/groups'));
    if (isAdmin) setUsers(await api<User[]>('/api/users'));
  }, [isAdmin]);
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [reload]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function canDropGroup(target: string | null) {
    if (!isAdmin || busy || !dragged) return false;
    return (
      (!target || !isWithin(groups, target, dragged.id)) &&
      (groups.find((group) => group.id === dragged.id)?.parentId || null) !==
        target
    );
  }
  function dropInto(target: string | null) {
    const item = dragged;
    const valid = canDropGroup(target);
    setDragged(null);
    setDropTarget(null);
    if (!item || !valid) return;
    void run(async () => {
      await api(`/api/groups/${item.id}`, 'PATCH', { parentId: target });
      await reload();
      await refresh();
      setNotice('Group moved. Inherited access has been updated.');
    });
  }
  const orderedGroups = orderedTree(groups).map(({ item: group, depth }) => ({
    group,
    depth,
    memberCount: group.members.filter(
      (person) => person.accountRole !== 'admin',
    ).length,
    subgroupCount: groups.filter((entry) => entry.parentId === group.id).length,
  }));
  return (
    <Tabs
      className="accounts"
      value={tab}
      onValueChange={(value) => setTab(String(value))}
    >
      <TabsList
        className="account-tabs"
        aria-label="Account settings"
        activateOnFocus
      >
        {[
          ['groups', 'Groups', Users],
          ...(isAdmin ? [['users', 'Users', UserRound]] : []),
          ['password', 'My password', KeyRound],
        ].map(([id, title, Icon]) => {
          const Glyph = Icon as typeof Users;
          return (
            <TabsTrigger key={id as string} value={id as string}>
              <Glyph size={17} />
              {title as string}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {notice && <output className="account-notice">{notice}</output>}
      <TabsContent value="password">
        <PasswordSettings user={user} />
      </TabsContent>
      {isAdmin && (
        <TabsContent value="users">
          <section className="account-section">
            <h2>Users</h2>
            <form
              className="account-inline-form"
              onSubmit={(e) => {
                const form = e.currentTarget;
                const data = fields(e);
                void run(async () => {
                  const result = await api<{ user: User; password: string }>(
                    '/api/users',
                    'POST',
                    data,
                  );
                  setCredentials({
                    name: result.user.name,
                    username: result.user.username,
                    password: result.password,
                  });
                  form.reset();
                  await reload();
                });
              }}
            >
              <label>
                Full name
                <input name="name" required maxLength={100} />
              </label>
              <label>
                Username
                <input
                  name="username"
                  required
                  pattern="[a-z0-9][a-z0-9._\-]{2,63}"
                  autoComplete="off"
                />
              </label>
              <button className="primary" disabled={busy}>
                <Plus size={16} />
                Add user
              </button>
            </form>
            <div className="account-list">
              {users.map((item) => (
                <div className="account-row" key={item.id}>
                  <div>
                    <button
                      className="user-name-button"
                      onClick={() => setSelectedUser(item)}
                    >
                      {item.name}
                    </button>
                    <span>
                      {item.username} ·{' '}
                      {item.role === 'admin'
                        ? 'Admin'
                        : item.disabled
                          ? 'Disabled'
                          : 'User'}
                    </span>
                  </div>
                  <div className="account-actions">
                    {!item.disabled && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const result = await api<{ invitation: string }>(
                              `/api/users/${item.id}/invitation`,
                              'POST',
                            );
                            setInvitation({
                              value: result.invitation,
                              group: false,
                            });
                          })
                        }
                      >
                        <KeyRound size={16} />
                        Password invitation
                      </button>
                    )}
                    {item.id !== user.id && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(`/api/users/${item.id}`, 'PATCH', {
                              disabled: !item.disabled,
                            });
                            await reload();
                          })
                        }
                      >
                        {item.disabled ? 'Enable' : 'Disable'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </TabsContent>
      )}
      <TabsContent value="groups">
        <section className="account-section group-directory">
          {isAdmin && (
            <div className="group-drag-tools">
              <h2>Groups</h2>
              <p className="muted">
                Open a group to manage members or its location. Drag a group
                heading onto another group to move it inside.
              </p>
              <p className="group-admin-note">
                Admins manage every group and have unrestricted access to all
                content.
              </p>
            </div>
          )}

          <div className="account-group-forms">
            {isAdmin && (
              <form
                className="account-inline-form"
                onSubmit={(e) => {
                  const form = e.currentTarget;
                  const data = fields(e);
                  void run(async () => {
                    const created = await api<Group>('/api/groups', 'POST', {
                      name: data.name,
                      parentId: data.parentId || null,
                    });
                    form.reset();
                    await reload();
                    setExpandedGroup(created.id);
                  });
                }}
              >
                <label>
                  New group
                  <input
                    name="name"
                    required
                    maxLength={100}
                    placeholder="Group name"
                  />
                </label>
                <label>
                  Group location
                  <select name="parentId" defaultValue="">
                    <option value="">Top level</option>
                    {orderedGroups
                      .filter(({ group }) => group.canManage)
                      .map(({ group, depth }) => (
                        <option key={group.id} value={group.id}>
                          {indentedName(group.name, depth)}
                        </option>
                      ))}
                  </select>
                </label>
                <button disabled={busy}>
                  <Plus size={16} />
                  Create group
                </button>
              </form>
            )}
          </div>
          {!groups.length && <p className="account-empty">No groups yet.</p>}
          <div className="group-tree">
            {orderedGroups.map(
              ({ group, depth, memberCount, subgroupCount }) => (
                <section
                  className={`group-section ${dropTarget === group.id ? 'organization-drop-target' : ''}`}
                  onDragOver={(event) => {
                    if (canDropGroup(group.id)) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDropTarget(group.id);
                    }
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropInto(group.id);
                  }}
                  key={group.id}
                  style={{
                    marginLeft: `${Math.min(depth, 4) * 14}px`,
                  }}
                >
                  <div className="group-summary">
                    <h2>
                      <button
                        type="button"
                        className="group-drag-handle"
                        aria-expanded={expandedGroup === group.id}
                        aria-controls={`group-details-${group.id}`}
                        onClick={() =>
                          setExpandedGroup(
                            expandedGroup === group.id ? null : group.id,
                          )
                        }
                        draggable={isAdmin && !busy}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            'application/x-openframe-group',
                            group.id,
                          );
                          event.dataTransfer.effectAllowed = 'move';
                          setDragged({ type: 'group', id: group.id });
                        }}
                        onDragEnd={() => {
                          setDragged(null);
                          setDropTarget(null);
                        }}
                      >
                        <ChevronRight size={18} aria-hidden="true" />
                        <span>{group.name}</span>
                      </button>
                    </h2>
                    <span className="group-count">
                      {memberCount} {memberCount === 1 ? 'member' : 'members'}
                      {subgroupCount > 0 &&
                        ` · ${subgroupCount} ${subgroupCount === 1 ? 'subgroup' : 'subgroups'}`}
                    </span>
                  </div>
                  {expandedGroup === group.id && (
                    <div
                      id={`group-details-${group.id}`}
                      className="group-details"
                    >
                      <div className="group-details-heading">
                        <h3>Members &amp; location</h3>
                        {group.canManage && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const result = await api<{
                                  invitation: string;
                                }>(
                                  `/api/groups/${group.id}/invitation`,
                                  'POST',
                                );
                                setInvitation({
                                  value: result.invitation,
                                  group: true,
                                });
                              })
                            }
                          >
                            <Plus size={16} />
                            Invite member
                          </button>
                        )}
                      </div>
                      {group.canManage && (
                        <div className="account-inline-form">
                          <label>
                            Group location
                            <select
                              aria-label={`Group location for ${group.name}`}
                              value={group.parentId || ''}
                              disabled={busy || !isAdmin}
                              onChange={(event) => {
                                const parentId = event.target.value || null;
                                void run(async () => {
                                  await api(
                                    `/api/groups/${group.id}`,
                                    'PATCH',
                                    {
                                      parentId,
                                    },
                                  );
                                  await reload();
                                  await refresh();
                                  setNotice(
                                    'Group moved. Inherited access has been updated.',
                                  );
                                });
                              }}
                            >
                              <option value="">Top level</option>
                              {orderedGroups
                                .filter(
                                  ({ group: candidate }) =>
                                    candidate.canManage &&
                                    !isWithin(groups, candidate.id, group.id),
                                )
                                .map(({ group: candidate, depth: level }) => (
                                  <option
                                    key={candidate.id}
                                    value={candidate.id}
                                  >
                                    {indentedName(candidate.name, level)}
                                  </option>
                                ))}
                            </select>
                          </label>
                          {isAdmin && (
                            <form
                              className="account-inline-form"
                              onSubmit={(event) => {
                                const form = event.currentTarget;
                                const data = fields(event);
                                void run(async () => {
                                  await api(
                                    `/api/groups/${group.id}/members/${data.userId}`,
                                    'PUT',
                                    { role: 'member' },
                                  );
                                  form.reset();
                                  await reload();
                                  await refresh();
                                });
                              }}
                            >
                              <label>
                                Add existing user
                                <select
                                  name="userId"
                                  aria-label={`Add user to ${group.name}`}
                                  required
                                  defaultValue=""
                                  disabled={busy}
                                >
                                  <option value="" disabled>
                                    Select user
                                  </option>
                                  {users
                                    .filter(
                                      (entry) =>
                                        !entry.disabled &&
                                        !group.members.some(
                                          (person) => person.id === entry.id,
                                        ),
                                    )
                                    .map((entry) => (
                                      <option key={entry.id} value={entry.id}>
                                        {entry.name} ({entry.username})
                                      </option>
                                    ))}
                                </select>
                              </label>
                              <button disabled={busy}>Add user</button>
                            </form>
                          )}
                        </div>
                      )}
                      {group.members.map((person) => (
                        <div className="account-row" key={person.id}>
                          <div>
                            <strong>{person.name}</strong>
                            <span>{person.username}</span>
                          </div>
                          {person.accountRole === 'admin' ? (
                            <span className="badge green">
                              Group admin · Admin account
                            </span>
                          ) : group.canManage ? (
                            <div className="account-actions">
                              <select
                                aria-label={`Role for ${person.username}`}
                                value={person.role}
                                disabled={busy}
                                onChange={(e) => {
                                  const role = e.target.value;
                                  void run(async () => {
                                    await api(
                                      `/api/groups/${group.id}/members/${person.id}`,
                                      'PUT',
                                      { role },
                                    );
                                    await reload();
                                  });
                                }}
                              >
                                <option value="member">Member</option>
                                <option value="admin">Group admin</option>
                              </select>
                              <button
                                title={`Remove ${person.username}`}
                                aria-label={`Remove ${person.username}`}
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await api(
                                      `/api/groups/${group.id}/members/${person.id}`,
                                      'PUT',
                                      { role: 'remove' },
                                    );
                                    await reload();
                                    await refresh();
                                  })
                                }
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <span>
                              {person.role === 'admin'
                                ? 'Group admin'
                                : 'Member'}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ),
            )}
          </div>
        </section>
      </TabsContent>
      <Dialog
        open={!!credentials}
        onOpenChange={(open) => !open && setCredentials(null)}
      >
        <DialogContent className="of-modal">
          <DialogTitle>User created</DialogTitle>
          <DialogDescription>
            {credentials?.name} can sign in now. This password is shown once.
            Share these credentials privately.
          </DialogDescription>
          <label>
            Username
            <input
              readOnly
              value={credentials?.username || ''}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <label>
            Generated password
            <input
              aria-label="Generated password"
              readOnly
              autoComplete="off"
              spellCheck={false}
              value={credentials?.password || ''}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <div className="account-actions">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (credentials) {
                    await copyText(credentials.password);
                    setNotice('Password copied.');
                  }
                })
              }
            >
              <Copy size={16} />
              Copy password
            </button>
            <button className="primary" onClick={() => setCredentials(null)}>
              Done
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!invitation}
        onOpenChange={(v) => {
          if (!v) setInvitation(null);
        }}
      >
        <DialogContent className="of-modal">
          <DialogTitle>
            {invitation?.group ? 'Group invitation' : 'Password invitation'}
          </DialogTitle>
          <DialogDescription>
            Valid for 24 hours and one use. Share privately with the recipient.
          </DialogDescription>
          <label>
            {invitation?.group ? 'Invitation code' : 'Set-password link'}
            <input
              readOnly
              value={
                invitation
                  ? invitation.group
                    ? invitation.value
                    : `${location.origin}/login#activate=${invitation.value}`
                  : ''
              }
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            onClick={() =>
              void run(async () => {
                if (invitation) {
                  await copyText(
                    invitation.group
                      ? invitation.value
                      : `${location.origin}/login#activate=${invitation.value}`,
                  );
                  setNotice('Invitation copied.');
                }
              })
            }
          >
            <Copy size={16} />
            Copy
          </button>
        </DialogContent>
      </Dialog>
      <UserAccessDialog
        selected={selectedUser}
        currentUser={user}
        groups={groups}
        onClose={() => setSelectedUser(null)}
        onChanged={async () => {
          await reload();
          await refresh();
        }}
      />
    </Tabs>
  );
}

type UserResource = Resource & {
  direct: boolean;
  owner: boolean;
  viaGroups: string[];
  effective: boolean;
  readOnly: boolean;
};
function UserAccessDialog({
  selected,
  currentUser,
  groups,
  onClose,
  onChanged,
}: {
  selected: User | null;
  currentUser: User;
  groups: Group[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [resources, setResources] = useState<UserResource[]>([]);
  const [account, setAccount] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [section, setSection] = useState('account');
  const [confirmGroup, setConfirmGroup] = useState<string | null>(null);
  useEffect(() => {
    setAccount(selected);
    setError('');
    setResources([]);
    setQuery('');
    setKind('all');
    setSection('account');
    setConfirmGroup(null);
    if (!selected) return;
    let current = true;
    api<UserResource[]>(`/api/users/${selected.id}/access`)
      .then((items) => {
        if (current) setResources(items);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [selected]);
  async function change(action: () => Promise<void>) {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await action();
      await onChanged();
      setResources(
        await api<UserResource[]>(`/api/users/${selected.id}/access`),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={!!selected} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="of-modal user-access-modal">
        <DialogTitle>Access for {selected?.name}</DialogTitle>
        <DialogDescription>
          Manage this user&apos;s role, group memberships, and content access.
        </DialogDescription>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {account && (
          <Tabs
            className="user-access-tabs"
            value={section}
            onValueChange={(value) => {
              setSection(String(value));
              setConfirmGroup(null);
            }}
          >
            <TabsList
              className="account-tabs"
              aria-label="User access sections"
              activateOnFocus
            >
              <TabsTrigger value="account">Account</TabsTrigger>
              <TabsTrigger value="groups">Groups</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
            </TabsList>
            <TabsContent value="account" className="user-access-panel">
              <div className="user-account-summary">
                <strong>{account.name}</strong>
                <span>
                  {account.username}
                  {account.disabled ? ' · Disabled' : ''}
                </span>
              </div>
              <label>
                Account role
                <select
                  aria-label="Account role"
                  value={account.role}
                  disabled={busy || account.id === currentUser.id}
                  onChange={(event) => {
                    const role = event.target.value;
                    void change(async () => {
                      await api(`/api/users/${account.id}`, 'PATCH', { role });
                      setAccount({ ...account, role });
                    });
                  }}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              {account.role === 'admin' && (
                <p className="muted">
                  Admins have access to all content and account settings.
                </p>
              )}
              {account.id === currentUser.id && (
                <p className="muted">
                  Your own admin role cannot be changed here.
                </p>
              )}
              <p className="muted">
                Use Groups to manage memberships, or Content to review access to
                slides, playlists, screens, media, and folders.
              </p>
            </TabsContent>
            <TabsContent value="groups" className="user-access-panel">
              <h3>Group memberships</h3>
              <p className="muted">
                Membership includes access to every subgroup. Removing a direct
                membership keeps any access inherited from a containing group.
              </p>
              {!groups.length && (
                <p className="account-empty">No groups yet.</p>
              )}
              {orderedTree(groups).map(({ item: group, depth }) => {
                const direct = group.members.find(
                  (person) => person.id === account.id,
                );
                const inherited = groups.some(
                  (parent) =>
                    parent.id !== group.id &&
                    parent.members.some((person) => person.id === account.id) &&
                    isWithin(groups, group.id, parent.id),
                );
                return (
                  <div
                    className="account-row user-membership-row"
                    key={group.id}
                    style={{ paddingLeft: Math.min(depth, 4) * 12 }}
                  >
                    <div>
                      <strong>{group.name}</strong>
                      {account.role !== 'admin' && (
                        <span>
                          {direct
                            ? `Direct membership${inherited ? ' · Also inherited' : ''}`
                            : inherited
                              ? 'Has inherited access'
                              : 'No membership'}
                        </span>
                      )}
                    </div>
                    {account.role === 'admin' ? (
                      <span className="badge green">
                        Group admin · Unrestricted
                      </span>
                    ) : !direct ? (
                      confirmGroup === group.id ? (
                        <div className="account-actions">
                          <span>
                            Add {account.name} to {group.name}?
                            {inherited &&
                              ' This adds direct membership; inherited access already applies.'}
                          </span>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void change(async () => {
                                await api(
                                  `/api/groups/${group.id}/members/${account.id}`,
                                  'PUT',
                                  { role: 'member' },
                                );
                                setConfirmGroup(null);
                              })
                            }
                          >
                            Confirm add
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => setConfirmGroup(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          aria-label={`Add direct membership for ${account.name} to ${group.name}`}
                          title="Add direct membership"
                          className="add-membership-button"
                          disabled={busy || !!account.disabled}
                          onClick={() => setConfirmGroup(group.id)}
                        >
                          <Plus size={16} />
                        </button>
                      )
                    ) : (
                      <select
                        aria-label={`Membership in ${group.name}`}
                        value={direct?.role || ''}
                        disabled={busy || !!account.disabled}
                        onChange={(event) => {
                          const role = event.target.value || 'remove';
                          void change(async () => {
                            await api(
                              `/api/groups/${group.id}/members/${account.id}`,
                              'PUT',
                              { role },
                            );
                          });
                        }}
                      >
                        <option value="">Remove direct membership</option>
                        <option value="member">Member</option>
                        <option value="admin">Group admin</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </TabsContent>
            <TabsContent value="content" className="user-access-panel">
              <div className="user-content-filters">
                <h3>Content access</h3>
                <p className="muted">
                  Direct grants are separate from access through groups or
                  ownership.
                </p>
                <div className="account-inline-form">
                  <label>
                    Content type
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      <option value="all">All content</option>
                      <option value="device">Screens</option>
                      <option value="slide">Slides</option>
                      <option value="playlist">Playlists</option>
                      <option value="asset">Media</option>
                      <option value="folder">Folders</option>
                    </select>
                  </label>
                  <label>
                    Find content
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
              </div>
              {!resources.some(
                (item) =>
                  (kind === 'all' || item.kind === kind) &&
                  item.name.toLowerCase().includes(query.toLowerCase()),
              ) && <p className="account-empty">No matching content.</p>}
              {(['slide', 'playlist', 'device', 'asset', 'folder'] as const)
                .filter((type) => kind === 'all' || kind === type)
                .map((type) => {
                  const matches = resources.filter(
                    (item) =>
                      item.kind === type &&
                      item.name.toLowerCase().includes(query.toLowerCase()),
                  );
                  if (!matches.length) return null;
                  const titles = {
                    slide: 'Slides',
                    playlist: 'Playlists',
                    device: 'Screens',
                    asset: 'Media',
                    folder: 'Folders',
                  };
                  return (
                    <section className="user-content-section" key={type}>
                      <h4>{titles[type]}</h4>
                      {matches.map((item) => (
                        <div
                          className="account-row"
                          key={`${item.kind}:${item.id}`}
                        >
                          <div>
                            <strong>{item.name}</strong>
                            <span>
                              {item.kind} ·{' '}
                              {account.role === 'admin'
                                ? 'Admin access'
                                : item.owner
                                  ? 'Owner'
                                  : item.viaGroups.length
                                    ? `Through groups: ${item.viaGroups.join(', ')}`
                                    : item.readOnly
                                      ? 'Visible through shared content (read-only)'
                                      : item.direct
                                        ? 'Direct access'
                                        : 'No access'}
                            </span>
                          </div>
                          <label className="direct-access-toggle">
                            <input
                              type="checkbox"
                              aria-label={`Direct access to ${item.name}`}
                              checked={account.role === 'admin' || item.direct}
                              disabled={
                                busy ||
                                !!account.disabled ||
                                account.role === 'admin' ||
                                item.owner
                              }
                              onChange={(event) => {
                                const remove = !event.target.checked;
                                const previous = resources;
                                setResources((items) =>
                                  items.map((entry) =>
                                    entry.kind === item.kind &&
                                    entry.id === item.id
                                      ? { ...entry, direct: !remove }
                                      : entry,
                                  ),
                                );
                                void change(async () => {
                                  try {
                                    await api(
                                      `/api/access/${item.kind}/${item.id}`,
                                      'POST',
                                      { userId: account.id, remove },
                                    );
                                  } catch (error) {
                                    setResources(previous);
                                    throw error;
                                  }
                                });
                              }}
                            />
                            {account.role === 'admin'
                              ? 'Unrestricted admin access'
                              : 'Direct access'}
                          </label>
                        </div>
                      ))}
                    </section>
                  );
                })}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
