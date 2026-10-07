import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus } from 'lucide-react';
import { api, type Library } from './types';
import { orderedTree, indentedName } from './hierarchy';
import { Button } from './components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from './components/ui/alert-dialog';

type Application = {
  id: string;
  name: string;
  managingGroupId: string | null;
  feedCount: number;
};
type ApplicationToken = {
  id: string;
  name: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};
const base = '/api/data-feeds/applications';

export function DataFeedApplications({
  groups = [],
}: {
  groups?: Library['groups'];
}) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState<Application | null>(null);
  const [keys, setKeys] = useState<ApplicationToken[]>([]);
  const [keyName, setKeyName] = useState('');
  const [expires, setExpires] = useState(90);
  const [secret, setSecret] = useState('');
  const [revoking, setRevoking] = useState<ApplicationToken | null>(null);
  const [deleting, setDeleting] = useState<Application | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await api<Application[]>(base);
        if (active) setApplications(value);
      } catch (cause) {
        if (active) setError((cause as Error).message);
      }
      if (active) timer = setTimeout(poll, 15000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  async function reload() {
    setApplications(await api<Application[]>(base));
  }
  async function run(action: () => Promise<void>) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('Copied');
    } catch {
      setError('Clipboard unavailable. Select and copy the text.');
    }
  }
  const endpoint = `${location.origin}/api/data-feeds/ingest/production`;
  const requestExample = [
    `curl --request POST '${endpoint}'`,
    "  --header 'Authorization: Bearer YOUR_API_KEY'",
    "  --header 'Content-Type: application/json'",
    `  --data '{"completed":42,"goal":100}'`,
  ].join(' \\' + '\n');
  return (
    <section
      className="data-feed-applications"
      aria-labelledby="data-feed-applications-heading"
    >
      <div className="data-feed-toolbar">
        <div>
          <h3 id="data-feed-applications-heading">Application API keys</h3>
          <p className="muted">
            Give an application one key. Its first push creates its feeds and
            metrics automatically.
          </p>
        </div>
        <Button
          onClick={() => {
            setName('');
            setGroup('');
            setError('');
            setCreating(true);
          }}
        >
          <Plus size={18} /> New application
        </Button>
      </div>
      {error && !selected && !creating && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!!applications.length && (
        <details className="data-feed-application-list">
          <summary>Applications ({applications.length})</summary>
          {applications.map((application) => (
            <div className="data-feed-token" key={application.id}>
              <div>
                <strong>{application.name}</strong>
                <small>
                  {application.managingGroupId
                    ? groups.find(
                        (item) => item.id === application.managingGroupId,
                      )?.name || 'Group unavailable'
                    : 'Personal'}{' '}
                  · {application.feedCount}{' '}
                  {application.feedCount === 1 ? 'feed' : 'feeds'}
                </small>
              </div>
              <button
                aria-label={`Manage application keys for ${application.name}`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setKeys(
                      await api<ApplicationToken[]>(
                        `${base}/${application.id}/tokens`,
                      ),
                    );
                    setKeyName('');
                    setExpires(90);
                    setSecret('');
                    setSelected(application);
                  })
                }
              >
                <KeyRound size={16} /> Manage keys
              </button>
            </div>
          ))}
        </details>
      )}
      <Dialog
        open={creating}
        onOpenChange={(open) => !busy && setCreating(open)}
      >
        <DialogContent className="of-modal data-feed-modal" size="standard">
          <DialogTitle>New application</DialogTitle>
          <DialogDescription>
            Choose who can use this application’s data. The application defines
            feeds and metrics when it pushes JSON.
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const application = await api<Application>(base, 'POST', {
                  name,
                  managingGroupId: group || null,
                });
                await reload();
                setCreating(false);
                setKeys([]);
                setKeyName('');
                setExpires(90);
                setSelected(application);
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Application name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={80}
                  placeholder="Sales dashboard"
                />
              </label>
              <label>
                Managing group
                <select
                  aria-label="Managing group"
                  value={group}
                  onChange={(event) => setGroup(event.target.value)}
                >
                  <option value="">Personal</option>
                  {orderedTree(groups).map(({ item, depth }) => (
                    <option key={item.id} value={item.id}>
                      {indentedName(item.name, depth)}
                    </option>
                  ))}
                </select>
              </label>
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <button type="button" onClick={() => setCreating(false)}>
                  Cancel
                </button>
                <Button type="submit">Create application</Button>
              </div>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && !busy && setSelected(null)}
      >
        <DialogContent className="of-modal data-feed-modal" size="standard">
          <DialogTitle>Application keys: {selected?.name}</DialogTitle>
          <DialogDescription>
            Each key can create and update this application’s own feeds. The
            same key works with any feed name supplied by the application.
          </DialogDescription>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {notice && <output>{notice}</output>}
          <div>
            {keys.map((key) => (
              <div className="data-feed-token" key={key.id}>
                <div>
                  <strong>{key.name}</strong>
                  <small>
                    {key.revokedAt
                      ? 'Revoked'
                      : `Expires ${new Date(key.expiresAt).toLocaleDateString()}`}
                    {key.lastUsedAt
                      ? ` · Last used ${new Date(key.lastUsedAt).toLocaleString()}`
                      : ' · Not used yet'}
                  </small>
                </div>
                {!key.revokedAt && (
                  <button
                    disabled={busy}
                    aria-label={`Revoke application key ${key.name}`}
                    onClick={() => {
                      setError('');
                      setRevoking(key);
                    }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!selected) return;
              void run(async () => {
                const result = await api<ApplicationToken & { token: string }>(
                  `${base}/${selected.id}/tokens`,
                  'POST',
                  { name: keyName, expiresInDays: expires },
                );
                setSecret(result.token);
                setKeyName('');
                setKeys(
                  await api<ApplicationToken[]>(
                    `${base}/${selected.id}/tokens`,
                  ),
                );
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Key name
                <input
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                  required
                  maxLength={80}
                  placeholder="Production integration"
                />
              </label>
              <label>
                Expires in days
                <input
                  type="number"
                  value={expires}
                  onChange={(event) => setExpires(Number(event.target.value))}
                  min={1}
                  max={365}
                  required
                />
              </label>
              <Button type="submit">Generate application API key</Button>
            </fieldset>
          </form>
          <p className="muted">
            Existing metrics keep their types. New metric names become new
            fields; omitted metrics keep their last values. Use another feed
            name for a separate set of metrics.
          </p>
          <div className="dialog-actions">
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (selected) {
                  setError('');
                  setDeleting(selected);
                }
              }}
            >
              Delete application
            </button>
            <button disabled={busy} onClick={() => setSelected(null)}>
              Done
            </button>
          </div>
          <Dialog
            open={!!secret}
            onOpenChange={(open) => !open && setSecret('')}
          >
            <DialogContent className="of-modal data-feed-modal" size="standard">
              <DialogTitle>Application API key generated</DialogTitle>
              <DialogDescription>
                Copy the key now; it is shown once. Give it to your application
                with the ingest URL below.
              </DialogDescription>
              <output className="data-feed-secret">
                <code>{secret}</code>
                <button onClick={() => void copy(secret)}>
                  <Copy size={16} /> Copy API key
                </button>
              </output>
              <label>
                Ingest URL
                <input
                  readOnly
                  value={endpoint}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <p className="muted">
                Replace <code>production</code> with a stable feed name chosen
                by the application. OpenFrame creates it on the first push.
              </p>
              <pre className="data-feed-code">{requestExample}</pre>
              <button
                onClick={() =>
                  void copy(
                    `Application: ${selected?.name}\nIngest URL: ${endpoint}\nMethod: POST\nAuthorization: Bearer YOUR_API_KEY\nContent-Type: application/json\nExample payload: {"completed":42,"goal":100}\nUse a stable feed name in place of production; metrics are created on first push.\nGuide: ${location.origin}/api/data-feeds/guide`,
                  )
                }
              >
                <Copy size={16} /> Copy integration details
              </button>
              {notice && <output>{notice}</output>}
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <button onClick={() => setSecret('')}>Done</button>
              </div>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!revoking}
        onOpenChange={(open) => !open && !busy && setRevoking(null)}
      >
        <AlertDialogContent className="of-modal">
          <AlertDialogTitle>Revoke application API key?</AlertDialogTitle>
          <AlertDialogDescription>
            This key will stop accepting new feeds and metric updates. Existing
            feeds, values and slides are preserved.
          </AlertDialogDescription>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setRevoking(null)}>
              Cancel
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (!selected || !revoking) return;
                void run(async () => {
                  await api(
                    `${base}/${selected.id}/tokens/${revoking.id}`,
                    'DELETE',
                  );
                  setKeys(
                    await api<ApplicationToken[]>(
                      `${base}/${selected.id}/tokens`,
                    ),
                  );
                  setRevoking(null);
                  setNotice('Application API key revoked.');
                });
              }}
            >
              Revoke API key
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && !busy && setDeleting(null)}
      >
        <AlertDialogContent className="of-modal">
          <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the application and all its API keys. Only applications
            with no feeds can be deleted. Remove unused feeds first; feeds
            referenced by slides must be retained.
          </AlertDialogDescription>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (!deleting) return;
                void run(async () => {
                  await api(`${base}/${deleting.id}`, 'DELETE');
                  await reload();
                  setDeleting(null);
                  setSelected(null);
                  setSecret('');
                });
              }}
            >
              Delete application
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
