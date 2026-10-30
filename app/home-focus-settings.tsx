import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { User } from './accounts';
import { api, type Library } from './types';
import { orderedTree, indentedName } from './hierarchy';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';

export function HomeFocusSettings({
  user,
  library,
  adminMode,
  onMode,
  onSaved,
}: {
  user: User;
  library: Library;
  adminMode: boolean;
  onMode: (admin: boolean) => void;
  onSaved: (home: User['home']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (user.role !== 'admin' || user.username === 'admin') return null;
  return (
    <div className="home-focus-controls">
      {user.home && (
        <>
          <span className="home-focus-label">{user.home.label}</span>
          <button
            type="button"
            role="switch"
            aria-label="Show admin controls"
            aria-checked={adminMode}
            onClick={() => onMode(!adminMode)}
          >
            {adminMode ? 'Admin mode' : 'Home mode'}
          </button>
        </>
      )}
      <button
        type="button"
        className="home-focus-configure"
        aria-label="Set home store or group"
        onClick={() => {
          setSelection(
            user.home
              ? `${user.home.siteId ? 'site' : 'group'}:${user.home.siteId || user.home.groupId}`
              : '',
          );
          setError('');
          setOpen(true);
        }}
      >
        <Settings2 size={14} />
        {user.home ? 'Change home' : 'Set home store/group'}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="standard" className="of-modal">
          <DialogTitle>Home store/group</DialogTitle>
          <DialogDescription>
            Choose your home workspace. Home mode focuses on this group and
            hides admin controls. Leave this unset to keep the full workspace.
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                setBusy(true);
                setError('');
                try {
                  const [kind, id] = selection.split(':');
                  const result = await api<{ home: User['home'] }>(
                    '/api/account/home',
                    'PATCH',
                    {
                      siteId: kind === 'site' ? id : null,
                      groupId: kind === 'group' ? id : null,
                    },
                  );
                  onSaved(result.home);
                  setOpen(false);
                } catch (cause) {
                  setError((cause as Error).message);
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <label>
              Home store or group
              <select
                aria-label="Home store or group"
                value={selection}
                onChange={(event) => setSelection(event.target.value)}
                disabled={busy}
              >
                <option value="">None — full workspace</option>
                <optgroup label="Stores">
                  {(library.sites || [])
                    .filter((site) => !site.archivedAt)
                    .map((site) => (
                      <option
                        key={site.id}
                        value={`site:${site.id}`}
                        disabled={!site.accessGroupId}
                      >
                        {site.siteNumber} · {site.name}
                        {!site.accessGroupId
                          ? ' (set an access group first)'
                          : ''}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Groups">
                  {orderedTree(library.groups || []).map(({ item, depth }) => (
                    <option key={item.id} value={`group:${item.id}`}>
                      {indentedName(item.name, depth)}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy} type="submit">
              Save home workspace
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
