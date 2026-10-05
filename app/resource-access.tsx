import './resource-access.css';
import { useEffect, useState } from 'react';
import { ChevronRight, Shield, X } from 'lucide-react';
import { api, type AccessTag, type Library } from './types';
import { orderedTree, indentedName, isWithin } from './hierarchy';
import type { User } from './accounts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './components/ui/dialog';

export type SharedResource = { kind: string; id: string; name: string };
type Group = {
  id: string;
  name: string;
  parentId?: string | null;
  directMember?: boolean;
};
type Grant = { userId: string; groupId: string; permission?: 'view' | 'edit' };
type Access = {
  canShare: boolean;
  grants: Grant[];
  managingGroupId?: string | null;
};

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
  const [access, setAccess] = useState<Access | null>(null);
  const hasRoles =
    !!resource &&
    ['slide', 'playlist', 'slide-folder', 'playlist-folder'].includes(
      resource.kind,
    );
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
    return names.length ? names : ['Shared group'];
  };

  useEffect(() => {
    if (!resource) {
      setAccess(null);
      setError('');
      return;
    }
    let current = true;
    setAccess(null);
    Promise.all([
      api<Access>(`/api/access/${resource.kind}/${resource.id}`),
      api<Library>('/api/library'),
      ...(user.role === 'admin' ? [api<User[]>('/api/users')] : []),
    ])
      .then(([nextAccess, nextGroups, nextUsers]) => {
        if (!current) return;
        setAccess(nextAccess as Access);
        setGroups((nextGroups as Library).groups || []);
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
      (await api(`/api/access/${resource.kind}/${resource.id}`)) as Access,
    );
    await refresh();
  }

  return (
    <Dialog open={!!resource} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="of-modal resource-access-modal"
        data-permission-roles={hasRoles}
      >
        <DialogTitle>Access: {resource?.name}</DialogTitle>
        <DialogDescription>
          {hasRoles
            ? 'Choose View or Edit access. Access inherited through the group hierarchy is View only.'
            : 'Shared users and groups can edit this item. Attached images are visible read-only.'}
        </DialogDescription>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {!access && !error && <p>Loading access...</p>}
        {access && hasRoles && (
          <label className="managing-group-control">
            Managing group
            <select
              aria-label="Managing group"
              value={access.managingGroupId || ''}
              disabled={busy || !access.canShare}
              onChange={(event) => {
                const groupId = event.target.value || null;
                void run(async () => {
                  await api(
                    `/api/access/${resource!.kind}/${resource!.id}/management`,
                    'PUT',
                    { groupId },
                  );
                  await refresh();
                  setAccess(
                    await api<Access>(
                      `/api/access/${resource!.kind}/${resource!.id}`,
                    ),
                  );
                });
              }}
            >
              <option value="">Personal ownership</option>
              {access.managingGroupId &&
                !groups.some(
                  (group) => group.id === access.managingGroupId,
                ) && (
                  <option value={access.managingGroupId}>
                    Assigned managing group
                  </option>
                )}
              {orderedTree(groups)
                .filter(
                  ({ item }) =>
                    user.role === 'admin' ||
                    item.directMember ||
                    item.id === access.managingGroupId,
                )
                .map(({ item, depth }) => (
                  <option key={item.id} value={item.id}>
                    {indentedName(item.name, depth)}
                  </option>
                ))}
            </select>
            <span className="muted">
              Direct members can edit. Other access inherited through the
              hierarchy is view only.
            </span>
          </label>
        )}
        {access?.canShare ? (
          <div className="access-grant-forms">
            {(
              ['group', ...(user.role === 'admin' ? ['user'] : [])] as const
            ).map((type) => (
              <form
                className="account-form"
                key={type}
                onSubmit={(event) => {
                  event.preventDefault();
                  const id = new FormData(event.currentTarget).get(
                    'target',
                  ) as string;
                  const form = event.currentTarget;
                  const permission = new FormData(form).get('permission') as
                    | 'view'
                    | 'edit';
                  void run(async () => {
                    await share({
                      userId: type === 'user' ? id : '',
                      groupId: type === 'group' ? id : '',
                      ...(hasRoles ? { permission } : {}),
                    });
                    form.reset();
                  });
                }}
              >
                <label>
                  {type === 'group' ? 'Groups' : 'Users'}
                  <select
                    aria-label={type === 'group' ? 'Groups' : 'Users'}
                    name="target"
                    required
                    defaultValue=""
                    disabled={busy}
                  >
                    <option value="" disabled>
                      Select a {type}
                    </option>
                    {type === 'group'
                      ? orderedTree(groups)
                          .filter(
                            ({ item: group }) =>
                              user.role === 'admin' ||
                              groups.some(
                                (own) =>
                                  own.directMember &&
                                  isWithin(groups, group.id, own.id),
                              ),
                          )
                          .map(({ item: group, depth }) => (
                            <option key={group.id} value={group.id}>
                              {indentedName(group.name, depth)}
                            </option>
                          ))
                      : users
                          .filter(
                            (entry) =>
                              !entry.disabled && entry.role !== 'admin',
                          )
                          .map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.name} ({entry.username})
                            </option>
                          ))}
                  </select>
                </label>
                {hasRoles && (
                  <label>
                    Permission
                    <select
                      name="permission"
                      defaultValue="view"
                      disabled={busy}
                    >
                      <option value="view">View</option>
                      <option value="edit">Edit</option>
                    </select>
                  </label>
                )}
                <button
                  className="primary"
                  disabled={busy}
                  aria-label={`Grant ${type} access`}
                >
                  <Shield size={16} /> Grant
                </button>
              </form>
            ))}
          </div>
        ) : access ? (
          <p>
            Only the managing group, personal owner, or admin can change access.
          </p>
        ) : null}
        {access && (
          <div className="access-existing-grants" aria-label="Existing access">
            {(['group', 'user'] as const).map((type) => {
              const grants = access.grants.filter((grant) =>
                type === 'group' ? grant.groupId : grant.userId,
              );
              return (
                <section
                  key={type}
                  className="access-grant-section"
                  aria-label={
                    type === 'group'
                      ? 'Existing group access'
                      : 'Existing user access'
                  }
                >
                  <h3>
                    {type === 'group' ? 'Groups' : 'Users'}{' '}
                    <span>{grants.length}</span>
                  </h3>
                  {!grants.length && (
                    <p className="muted">
                      No {type === 'group' ? 'group' : 'direct user'} grants.
                    </p>
                  )}
                  {grants.map((grant) => {
                    const names =
                      type === 'group'
                        ? groupName(grant.groupId)
                        : [
                            users.find((entry) => entry.id === grant.userId)
                              ?.name || 'Assigned user',
                          ];
                    const name = names.at(-1)!;
                    const path = names.slice(0, -1).join(' / ');
                    return (
                      <div
                        className="access-grant-row"
                        data-permission-roles={hasRoles}
                        key={grant.userId || grant.groupId}
                      >
                        <div>
                          <strong>{name}</strong>
                          {path && <span>{path}</span>}
                        </div>
                        {hasRoles && (
                          <select
                            aria-label={`Permission for ${name}`}
                            value={grant.permission || 'edit'}
                            disabled={
                              busy ||
                              !access.canShare ||
                              (type === 'user' && user.role !== 'admin')
                            }
                            onChange={(event) =>
                              void run(() =>
                                share({
                                  ...grant,
                                  permission: event.target.value as
                                    | 'view'
                                    | 'edit',
                                }),
                              )
                            }
                          >
                            <option value="view">View</option>
                            <option value="edit">Edit</option>
                          </select>
                        )}
                        {access.canShare &&
                          (type === 'group' || user.role === 'admin') && (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Remove access for ${names.join(' / ')}`}
                              title={`Remove access for ${name}`}
                              disabled={busy}
                              onClick={() => void run(() => share(grant, true))}
                            >
                              <X size={16} />
                            </button>
                          )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}
        <p className="muted access-explanation">
          Admins always have unrestricted access. Removing a grant keeps access
          inherited or shared separately.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function ManageAccessButton({
  resourceName,
  tags = [],
  maxTags = 2,
  onClick,
}: {
  resourceName: string;
  tags?: AccessTag[];
  maxTags?: number;
  onClick: () => void;
}) {
  const firstGroup = tags.find((tag) => tag.type === 'group');
  const firstUser = tags.find((tag) => tag.type === 'user');
  const visible =
    maxTags > 1 && firstGroup && firstUser
      ? [firstGroup, firstUser]
      : tags.slice(0, maxTags);
  return (
    <div className="resource-access-summary">
      <button
        type="button"
        className="manage-access-button"
        aria-label={`Manage access to ${resourceName}`}
        onClick={onClick}
      >
        <span>Manage access</span>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      {tags.length > 0 && (
        <div
          className="access-tags"
          aria-label={`Current access to ${resourceName}`}
        >
          {visible.map((tag) => (
            <span
              key={`${tag.type}:${tag.id}`}
              className={`access-tag ${tag.type}`}
              title={
                tag.type === 'group'
                  ? 'Group access includes subgroups'
                  : `Direct user access${tag.username ? `: ${tag.username}` : ''}`
              }
            >
              {tag.type === 'user' ? 'User: ' : ''}
              {tag.name}
            </span>
          ))}
          {tags.length > visible.length && (
            <button
              type="button"
              className="access-more"
              aria-label={`Show all ${tags.length} access grants for ${resourceName}`}
              onClick={onClick}
            >
              +{tags.length - visible.length} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
