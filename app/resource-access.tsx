import { useEffect, useState } from 'react';
import { ChevronRight, Shield, X } from 'lucide-react';
import { api } from './types';
import type { User } from './accounts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './components/ui/dialog';

export type SharedResource = { kind: string; id: string; name: string };
type Group = { id: string; name: string; parentId: string | null };
type Grant = { userId: string; groupId: string };

export function ResourceAccessDialog({
  resource,
  user,
  onClose,
  refresh,
}: {
  resource: SharedResource | null;
  user: User;
  onClose: () => void;
  refresh: () => Promise<void>;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [access, setAccess] = useState<{
    canShare: boolean;
    grants: Grant[];
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const groupName = (id: string) => {
    const names: string[] = [];
    const seen = new Set<string>();
    let group = groups.find((item) => item.id === id);
    while (group && !seen.has(group.id)) {
      seen.add(group.id);
      names.unshift(group.name);
      group = groups.find((item) => item.id === group?.parentId);
    }
    return names.join(' / ') || 'Shared group';
  };

  useEffect(() => {
    if (!resource) {
      setAccess(null);
      setError('');
      return;
    }
    let current = true;
    Promise.all([
      api<{ canShare: boolean; grants: Grant[] }>(
        `/api/access/${resource.kind}/${resource.id}`,
      ),
      api<Group[]>('/api/groups'),
      ...(user.role === 'superadmin' ? [api<User[]>('/api/users')] : []),
    ])
      .then(([nextAccess, nextGroups, nextUsers]) => {
        if (!current) return;
        setAccess(nextAccess as { canShare: boolean; grants: Grant[] });
        setGroups(nextGroups as Group[]);
        setUsers((nextUsers as User[] | undefined) || []);
      })
      .catch((e) => current && setError((e as Error).message));
    return () => {
      current = false;
    };
  }, [resource, user.role]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function share(target: Grant, remove = false) {
    if (!resource) return;
    await api(`/api/access/${resource.kind}/${resource.id}`, 'POST', {
      ...target,
      remove,
    });
    setAccess(
      (await api(`/api/access/${resource.kind}/${resource.id}`)) as {
        canShare: boolean;
        grants: Grant[];
      },
    );
    await refresh();
  }

  return (
    <Dialog open={!!resource} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="of-modal resource-access-modal">
        <DialogTitle>Access: {resource?.name}</DialogTitle>
        <DialogDescription>
          Shared members can edit this item. Images attached to shared slides
          remain visible and read-only. Removing access here does not remove
          separately shared content.
        </DialogDescription>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {!access && !error && <p>Loading access...</p>}
        {access?.grants.map((grant) => (
          <div className="account-row" key={grant.userId || grant.groupId}>
            <span>
              {grant.userId
                ? users.find((u) => u.id === grant.userId)?.name ||
                  'Assigned user'
                : groupName(grant.groupId)}
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
            onSubmit={(event) => {
              event.preventDefault();
              const target = new FormData(event.currentTarget).get(
                'target',
              ) as string;
              const [type, id] = target.split(':');
              void run(() =>
                share({
                  userId: type === 'user' ? id : '',
                  groupId: type === 'group' ? id : '',
                }),
              );
              event.currentTarget.reset();
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
                  Select a group{user.role === 'superadmin' ? ' or user' : ''}
                </option>
                {groups.map((group) => (
                  <option key={group.id} value={`group:${group.id}`}>
                    {groupName(group.id)} (group)
                  </option>
                ))}
                {user.role === 'superadmin' &&
                  users
                    .filter((u) => !u.disabled)
                    .map((entry) => (
                      <option key={entry.id} value={`user:${entry.id}`}>
                        {entry.name} ({entry.username})
                      </option>
                    ))}
              </select>
            </label>
            <button className="primary" disabled={busy}>
              <Shield size={16} />
              Grant access
            </button>
          </form>
        ) : access ? (
          <p>Only the owner or super-admin can change sharing.</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ManageAccessButton({
  resourceName,
  onClick,
}: {
  resourceName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="manage-access-button"
      aria-label={`Manage access to ${resourceName}`}
      onClick={onClick}
    >
      <span>Manage access</span>
      <ChevronRight size={15} aria-hidden="true" />
    </button>
  );
}
