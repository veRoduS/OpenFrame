import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  Copy,
  KeyRound,
  Plus,
  Share2,
  Shield,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { api, type Library } from './types';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';

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
  canManage: boolean;
  members: (User & { role: string })[];
};
type Grant = { userId: string; groupId: string };
type Resource = { kind: string; id: string; name: string };
const fields = (event: SyntheticEvent<HTMLFormElement>) => {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget));
};

export function Accounts({
  user,
  library,
  refresh,
}: {
  user: User;
  library: Library;
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState('groups');
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [invitation, setInvitation] = useState<{
    value: string;
    group: boolean;
  } | null>(null);
  const [selected, setSelected] = useState<Resource | null>(null);
  const [access, setAccess] = useState<{
    canShare: boolean;
    grants: Grant[];
  } | null>(null);
  const [kind, setKind] = useState('device');
  const [search, setSearch] = useState('');
  const isSuper = user.role === 'superadmin';
  const reload = useCallback(async () => {
    setGroups(await api<Group[]>('/api/groups'));
    if (isSuper) setUsers(await api<User[]>('/api/users'));
  }, [isSuper]);
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
  async function share(target: Grant, remove = false) {
    if (!selected) return;
    await api(`/api/access/${selected.kind}/${selected.id}`, 'POST', {
      ...target,
      remove,
    });
    setAccess(await api(`/api/access/${selected.kind}/${selected.id}`));
    await refresh();
  }
  const resources: Record<string, { id: string; name: string }[]> = {
    device: library.devices,
    slide: library.slides,
    playlist: library.playlists,
    asset: library.assets,
    folder: library.folders,
  };
  return (
    <div className="accounts">
      <div
        className="account-tabs"
        role="tablist"
        aria-label="Account settings"
      >
        {[
          ['groups', 'Groups', Users],
          ['sharing', 'Sharing & assignments', Share2],
          ...(isSuper ? [['users', 'Users', UserRound]] : []),
          ['password', 'My password', KeyRound],
        ].map(([id, title, Icon]) => {
          const Glyph = Icon as typeof Users;
          return (
            <button
              key={id as string}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id as string)}
            >
              <Glyph size={17} />
              {title as string}
            </button>
          );
        })}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {notice && <output className="account-notice">{notice}</output>}
      {tab === 'password' && (
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
                minLength={12}
                maxLength={256}
                required
              />
            </label>
            <label>
              Confirm new password
              <input
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              <KeyRound size={16} />
              Change password
            </button>
          </form>
        </section>
      )}
      {tab === 'users' && isSuper && (
        <section className="account-section">
          <h2>Users</h2>
          <form
            className="account-inline-form"
            onSubmit={(e) => {
              const form = e.currentTarget;
              const data = fields(e);
              void run(async () => {
                const result = await api<{ invitation: string }>(
                  '/api/users',
                  'POST',
                  data,
                );
                setInvitation({ value: result.invitation, group: false });
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
              Invite user
            </button>
          </form>
          <div className="account-list">
            {users.map((item) => (
              <div className="account-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.username} ·{' '}
                    {item.role === 'superadmin'
                      ? 'Super-admin'
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
                  {item.role !== 'superadmin' && (
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
      )}
      {tab === 'groups' && (
        <section className="account-section">
          <div className="account-group-forms">
            <form
              className="account-inline-form"
              onSubmit={(e) => {
                const form = e.currentTarget;
                const data = fields(e);
                void run(async () => {
                  await api('/api/groups', 'POST', data);
                  form.reset();
                  await reload();
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
              <button disabled={busy}>
                <Plus size={16} />
                Create group
              </button>
            </form>
            <form
              className="account-inline-form"
              onSubmit={(e) => {
                const form = e.currentTarget;
                const data = fields(e);
                void run(async () => {
                  await api('/api/groups/join', 'POST', data);
                  form.reset();
                  await reload();
                  await refresh();
                  setNotice('You joined the group.');
                });
              }}
            >
              <label>
                Join a group
                <input
                  name="token"
                  required
                  placeholder="Invitation code"
                  autoComplete="off"
                />
              </label>
              <button disabled={busy}>
                <Users size={16} />
                Join
              </button>
            </form>
          </div>
          {!groups.length && <p className="account-empty">No groups yet.</p>}
          {groups.map((group) => (
            <section className="group-section" key={group.id}>
              <div className="account-row">
                <h2>{group.name}</h2>
                {group.canManage && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await api<{ invitation: string }>(
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
              {group.members.map((person) => (
                <div className="account-row" key={person.id}>
                  <div>
                    <strong>{person.name}</strong>
                    <span>{person.username}</span>
                  </div>
                  {group.canManage ? (
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
                      {person.role === 'admin' ? 'Group admin' : 'Member'}
                    </span>
                  )}
                </div>
              ))}
            </section>
          ))}
        </section>
      )}
      {tab === 'sharing' && (
        <section className="account-section">
          <div className="account-inline-form">
            <label>
              Resource
              <select
                aria-label="Resource"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="device">Screens</option>
                <option value="slide">Slides</option>
                <option value="playlist">Playlists</option>
                <option value="asset">Media</option>
                <option value="folder">Folders</option>
              </select>
            </label>
            <label>
              Search
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name"
              />
            </label>
          </div>
          <div className="account-list">
            {resources[kind]
              .filter((item) =>
                item.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((item) => (
                <div className="account-row" key={item.id}>
                  <strong>{item.name}</strong>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await api<{
                          canShare: boolean;
                          grants: Grant[];
                        }>(`/api/access/${kind}/${item.id}`);
                        setAccess(result);
                        setSelected({ kind, ...item });
                      })
                    }
                  >
                    <Share2 size={16} />
                    Access
                  </button>
                </div>
              ))}
          </div>
          {!resources[kind].length && (
            <p className="account-empty">No items available.</p>
          )}
        </section>
      )}
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
                  await navigator.clipboard.writeText(
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
      <Dialog
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      >
        <DialogContent className="of-modal">
          <DialogTitle>Access: {selected?.name}</DialogTitle>
          <DialogDescription>
            Shared members can edit this item. Sharing includes its current
            slides and images. Removing access here does not remove separately
            shared content.
          </DialogDescription>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {access?.grants.map((grant) => (
            <div className="account-row" key={grant.userId || grant.groupId}>
              <span>
                {grant.userId
                  ? users.find((u) => u.id === grant.userId)?.name ||
                    'Assigned user'
                  : groups.find((g) => g.id === grant.groupId)?.name ||
                    'Shared group'}
              </span>
              {access.canShare && (
                <button
                  aria-label="Remove access"
                  title="Remove access"
                  disabled={busy}
                  onClick={() => void run(() => share(grant, true))}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
          {access?.canShare ? (
            <form
              className="account-form"
              onSubmit={(e) => {
                const data = fields(e);
                const [type, id] = (data.target as string).split(':');
                void run(() =>
                  share({
                    userId: type === 'user' ? id : '',
                    groupId: type === 'group' ? id : '',
                  }),
                );
              }}
            >
              <label>
                Share with
                <select
                  aria-label="Share with"
                  name="target"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select a group{isSuper ? ' or user' : ''}
                  </option>
                  {groups.map((g) => (
                    <option key={g.id} value={`group:${g.id}`}>
                      {g.name} (group)
                    </option>
                  ))}
                  {isSuper &&
                    users
                      .filter((u) => !u.disabled)
                      .map((u) => (
                        <option key={u.id} value={`user:${u.id}`}>
                          {u.name} ({u.username})
                        </option>
                      ))}
                </select>
              </label>
              <button className="primary" disabled={busy}>
                <Shield size={16} />
                Grant access
              </button>
            </form>
          ) : (
            <p>Only the owner or super-admin can change sharing.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
