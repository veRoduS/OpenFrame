import { useEffect, useState } from 'react';
import { api, type Library, type Slide } from './types';
import type { User } from './accounts';
import { orderedTree, indentedName, isWithin } from './hierarchy';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';

export function BulkSlideAccessDialog({
  slideIds,
  slides,
  user,
  onClose,
  refresh,
}: {
  slideIds: string[];
  slides: Slide[];
  user: User;
  onClose: () => void;
  refresh: () => Promise<void>;
}) {
  const [groups, setGroups] = useState<NonNullable<Library['groups']>>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [type, setType] = useState<'group' | 'user'>('group');
  const [recipient, setRecipient] = useState('');
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    if (slideIds.length > 100) {
      setError('Select up to 100 slides at a time.');
      return;
    }
    let active = true;
    Promise.all([
      api<Library>('/api/library'),
      user.role === 'admin' ? api<User[]>('/api/users') : Promise.resolve([]),
      ...slideIds.map((id) =>
        api<{ canShare: boolean }>(`/api/access/slide/${id}`),
      ),
    ])
      .then(([library, people, ...access]) => {
        if (!active) return;
        setGroups(library.groups || []);
        setUsers(people);
        if (access.some((item) => !item.canShare))
          setError(
            'You need sharing permission on every selected slide. Adjust the selection and try again.',
          );
        else if (slideIds.length > 100)
          setError('Select up to 100 slides at a time.');
        else setReady(true);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [slideIds, user.role]);
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="of-modal" size="standard">
        <DialogTitle>Assign access to {slideIds.length} slides</DialogTitle>
        <DialogDescription>
          Choose a recipient and View or Edit permission for every selected
          slide. Other recipients and ownership stay unchanged. Required linked
          content is shared using the existing sharing rules.
        </DialogDescription>
        <details>
          <summary>Selected slides ({slideIds.length})</summary>
          <ul>
            {slideIds.map((id) => (
              <li key={id}>
                {slides.find((slide) => slide.id === id)?.name || id}
              </li>
            ))}
          </ul>
        </details>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {success && <output>{success}</output>}
        {!ready && !error && <p>Checking sharing permissions…</p>}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            setSuccess('');
            try {
              await api('/api/access/bulk', 'POST', {
                slideIds,
                [type === 'group' ? 'groupId' : 'userId']: recipient,
                permission,
              });
              setSuccess(`Access assigned to ${slideIds.length} slides.`);
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy || !ready}>
            {user.role === 'admin' && (
              <label>
                Recipient type
                <select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as 'group' | 'user');
                    setRecipient('');
                    setSuccess('');
                  }}
                >
                  <option value="group">Group</option>
                  <option value="user">User</option>
                </select>
              </label>
            )}
            <label>
              {type === 'group' ? 'Group' : 'User'}
              <select
                required
                aria-label="Bulk access recipient"
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value);
                  setSuccess('');
                }}
              >
                <option value="">Choose a {type}</option>
                {type === 'group'
                  ? orderedTree(groups)
                      .filter(
                        ({ item }) =>
                          user.role === 'admin' ||
                          groups.some(
                            (own) =>
                              own.directMember &&
                              (isWithin(groups, item.id, own.id) ||
                                isWithin(groups, own.id, item.id)),
                          ),
                      )
                      .map(({ item, depth }) => (
                        <option key={item.id} value={item.id}>
                          {indentedName(item.name, depth)}
                        </option>
                      ))
                  : users
                      .filter(
                        (entry) => !entry.disabled && entry.role !== 'admin',
                      )
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name} ({entry.username})
                        </option>
                      ))}
              </select>
            </label>
            <label>
              Permission
              <select
                aria-label="Bulk access permission"
                value={permission}
                onChange={(e) => {
                  setPermission(e.target.value as 'view' | 'edit');
                  setSuccess('');
                }}
              >
                <option value="view">View</option>
                <option value="edit">Edit</option>
              </select>
            </label>
            <button type="submit" disabled={!recipient}>
              Apply to {slideIds.length} slides
            </button>
          </fieldset>
        </form>
        <button disabled={busy} onClick={onClose}>
          Done
        </button>
      </DialogContent>
    </Dialog>
  );
}
