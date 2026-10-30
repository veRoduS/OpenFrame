import { KeyExpiryFields, KeyExpiryEditor } from './api-key-expiry';
import { SiteHistory } from './site-history';
import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus } from 'lucide-react';
import { api, type Library } from './types';
import { orderedTree, indentedName } from './hierarchy';
import { suggestedSiteGroup } from './site-groups';
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
  unassignedFeedCount?: number;
};
type Site = {
  accessGroupId?: string | null;
  id: string;
  siteNumber: string;
  name: string;
  archivedAt: string | null;
};
type ApplicationToken = {
  siteIds?: string[] | null;
  siteId: string | null;
  id: string;
  name: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
};
const base = '/api/data-feeds/applications';

export function DataFeedApplications({
  groups = [],
  onRefresh,
}: {
  groups?: Library['groups'];
  onRefresh?: () => Promise<void>;
}) {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [central, setCentral] = useState(false);
  const [centralSites, setCentralSites] = useState<string[]>([]);
  const [secretCentral, setSecretCentral] = useState(false);
  const [secretSites, setSecretSites] = useState<string[]>([]);
  const [legacySiteId, setLegacySiteId] = useState('');
  const [siteNumber, setSiteNumber] = useState('');
  const [siteName, setSiteName] = useState('');
  const [siteAccessGroup, setSiteAccessGroup] = useState('');
  const [siteAccessGroupChosen, setSiteAccessGroupChosen] = useState(false);
  const [applications, setApplications] = useState<Application[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState<Application | null>(null);
  const [keys, setKeys] = useState<ApplicationToken[]>([]);
  const [keyName, setKeyName] = useState('');
  const [expires, setExpires] = useState<number | null>(90);
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
        const [value, siteList] = await Promise.all([
          api<Application[]>(base),
          api<Site[]>('/api/sites'),
        ]);
        if (active) setSites(siteList);
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
  const endpoint = `${location.origin}/api/data-feeds/${secretCentral ? 'ingest-stores' : 'ingest'}/production`;
  const examplePayload = secretCentral
    ? {
        stores: secretSites.slice(0, 2).map((id) => ({
          siteNumber:
            sites.find((site) => site.id === id)?.siteNumber || '2882',
          metrics: { completed: 42, goal: 100 },
          tables: { training: [{ label: 'Safety', value: 98 }] },
        })),
      }
    : { completed: 42, goal: 100 };
  const requestExample = [
    `curl --request POST '${endpoint}'`,
    "  --header 'Authorization: Bearer YOUR_API_KEY'",
    "  --header 'Content-Type: application/json'",
    `  --data '${JSON.stringify(examplePayload)}'`,
  ].join(' \\' + '\n');
  return (
    <section
      className="data-feed-applications"
      aria-labelledby="data-feed-applications-heading"
    >
      <details>
        <summary>Sites ({sites.length})</summary>
        <p className="muted">
          Create a location, then select it when issuing an application key.
          Existing unassigned keys keep their original feeds.
        </p>
        <p className="muted">
          Choose an access group to let its members and subgroups approve new
          screens requesting this site. Without a group, approval requires an
          administrator.
        </p>
        {sites.map((site) => (
          <div className="data-feed-token site-settings-row" key={site.id}>
            <span>
              {site.siteNumber} · {site.name}
              {site.archivedAt ? ' · Archived' : ''}
            </span>
            <label>
              Access group
              <select
                aria-label={`Access group for site ${site.siteNumber}`}
                value={site.accessGroupId || ''}
                disabled={busy}
                onChange={(event) =>
                  void run(async () => {
                    await api(`/api/sites/${site.id}`, 'PATCH', {
                      accessGroupId: event.target.value || null,
                    });
                    setSites(await api<Site[]>('/api/sites'));
                  })
                }
              >
                <option value="">Resource sharing only</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/api/sites/${site.id}`, 'PATCH', {
                    archived: !site.archivedAt,
                  });
                  setSites(await api<Site[]>('/api/sites'));
                })
              }
            >
              {site.archivedAt ? 'Restore' : 'Archive'}
            </button>
          </div>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const site = await api<Site>('/api/sites', 'POST', {
                siteNumber,
                name: siteName,
                accessGroupId: siteAccessGroup || null,
              });
              setSites(await api<Site[]>('/api/sites'));
              setSiteId(site.id);
              setSiteNumber('');
              setSiteName('');
              setSiteAccessGroup('');
              setSiteAccessGroupChosen(false);
            });
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Site number
              <input
                value={siteNumber}
                onChange={(event) => {
                  setSiteNumber(event.target.value);
                  if (!siteAccessGroupChosen)
                    setSiteAccessGroup(
                      suggestedSiteGroup(event.target.value, groups)?.id || '',
                    );
                }}
                pattern="[0-9]{1,20}"
                maxLength={20}
                required
                placeholder="001"
              />
            </label>
            <label>
              Site name
              <input
                value={siteName}
                onChange={(event) => setSiteName(event.target.value)}
                maxLength={100}
                required
              />
            </label>
            <label>
              Access group
              <select
                aria-label="New site access group"
                value={siteAccessGroup}
                onChange={(event) => {
                  setSiteAccessGroup(event.target.value);
                  setSiteAccessGroupChosen(true);
                }}
              >
                <option value="">Resource sharing only</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            {!siteAccessGroupChosen && siteAccessGroup && (
              <p className="muted">
                Suggested because the group name includes this site number.
              </p>
            )}
            <p className="muted">
              An access group requires membership in that group or its
              descendants as well as resource access. Administrators retain
              access.
            </p>
            <Button type="submit">Create site</Button>
          </fieldset>
        </form>
      </details>
      <SiteHistory sites={sites} />
      <div className="data-feed-toolbar">
        <div>
          <h3 id="data-feed-applications-heading">Application API keys</h3>
          <p className="muted">
            Use one application for each integration. Its first push creates its
            feeds and metrics automatically.
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
                    setCentral(false);
                    setCentralSites([]);
                    setLegacySiteId('');
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
            Choose a default managing group. For central keys, each store’s
            access group takes precedence when creating its feeds. The
            application creates feeds and metrics when it pushes JSON.
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
                setCentral(false);
                setCentralSites([]);
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
            Use one application for an integration such as SMCC. Issue a key for
            one store, or a central key for multiple selected stores. Data stays
            separate for each screen’s store.
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
                    {key.siteIds
                      ? `Central · ${key.siteIds.map((id) => sites.find((site) => site.id === id)?.siteNumber || 'Unavailable').join(', ')}`
                      : key.siteId
                        ? (() => {
                            const site = sites.find(
                              (item) => item.id === key.siteId,
                            );
                            return site
                              ? `${site.siteNumber} · ${site.name}`
                              : 'Site unavailable';
                          })()
                        : 'Unassigned · legacy feeds'}
                  </small>
                  <small>
                    {key.revokedAt
                      ? 'Revoked'
                      : key.expiresAt === null
                        ? 'Never expires'
                        : `Expires ${new Date(key.expiresAt).toLocaleDateString()}`}
                    {key.lastUsedAt
                      ? ` · Last used ${new Date(key.lastUsedAt).toLocaleString()}`
                      : ' · Not used yet'}
                  </small>
                </div>
                {!key.revokedAt && (
                  <KeyExpiryEditor
                    name={key.name}
                    expiresAt={key.expiresAt}
                    onSave={async (days) => {
                      await api(
                        `${base}/${selected!.id}/tokens/${key.id}`,
                        'PATCH',
                        { expiresInDays: days },
                      );
                      setKeys(
                        await api<ApplicationToken[]>(
                          `${base}/${selected!.id}/tokens`,
                        ),
                      );
                    }}
                  />
                )}
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
          {!!sites.length &&
            (keys.some((key) => !key.siteId && !key.siteIds) ||
              !!selected?.unassignedFeedCount) && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!selected) return;
                  void run(async () => {
                    const updated = await api<Application>(
                      `${base}/${selected.id}/assign-site`,
                      'POST',
                      { siteId: legacySiteId },
                    );
                    setSelected(updated);
                    setKeys(
                      await api<ApplicationToken[]>(
                        `${base}/${selected.id}/tokens`,
                      ),
                    );
                    await reload();
                    setNotice(
                      'Existing keys and feeds assigned. Upgrade and assign the matching screens before using site-bound playback.',
                    );
                  });
                }}
              >
                <fieldset disabled={busy}>
                  <p>
                    Assign all existing unassigned keys and feeds for this
                    application to their original location. Feed IDs, values,
                    and secrets are preserved. Existing screens must also be
                    assigned to that site.
                  </p>
                  <label>
                    Site for existing integration
                    <select
                      aria-label="Site for existing integration"
                      value={legacySiteId}
                      required
                      onChange={(event) => setLegacySiteId(event.target.value)}
                    >
                      <option value="">Choose the original site</option>
                      {sites
                        .filter((site) => !site.archivedAt)
                        .map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.siteNumber} · {site.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Button type="submit">Assign existing integration</Button>
                </fieldset>
              </form>
            )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!selected) return;
              void run(async () => {
                const result = await api<ApplicationToken & { token: string }>(
                  `${base}/${selected.id}/tokens`,
                  'POST',
                  {
                    name: keyName,
                    expiresInDays: expires,
                    ...(central
                      ? { siteIds: centralSites }
                      : { siteId: siteId || null }),
                  },
                );
                setSecretCentral(!!result.siteIds);
                setSecretSites(result.siteIds || []);
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
                Key scope
                <select
                  aria-label="Key scope"
                  value={central ? 'central' : 'site'}
                  onChange={(event) =>
                    setCentral(event.target.value === 'central')
                  }
                >
                  <option value="site">One store</option>
                  <option value="central">Multiple stores (central)</option>
                </select>
              </label>
              {central ? (
                <fieldset className="central-store-picker">
                  <legend>Authorized stores</legend>
                  <p className="muted">
                    Select the stores this key can update. New stores are not
                    added automatically.
                  </p>
                  {sites
                    .filter((site) => !site.archivedAt)
                    .map((site) => (
                      <label key={site.id}>
                        <input
                          type="checkbox"
                          checked={centralSites.includes(site.id)}
                          onChange={(event) =>
                            setCentralSites((current) =>
                              event.target.checked
                                ? [...current, site.id]
                                : current.filter((id) => id !== site.id),
                            )
                          }
                        />
                        {site.siteNumber} · {site.name}
                      </label>
                    ))}
                  {!sites.some((site) => !site.archivedAt) && (
                    <p>Create an active site first.</p>
                  )}
                </fieldset>
              ) : (
                <label>
                  Site
                  <select
                    aria-label="Site"
                    value={siteId}
                    required={sites.length > 0}
                    onChange={(event) => setSiteId(event.target.value)}
                  >
                    <option value="">
                      {sites.length
                        ? 'Choose a site'
                        : 'Unassigned · legacy feeds'}
                    </option>
                    {sites
                      .filter((site) => !site.archivedAt)
                      .map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.siteNumber} · {site.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
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
              <KeyExpiryFields value={expires} onChange={setExpires} />
              <Button type="submit" disabled={central && !centralSites.length}>
                Generate application API key
              </Button>
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
                    `Application: ${selected?.name}\nIngest URL: ${endpoint}\nMethod: POST\nAuthorization: Bearer YOUR_API_KEY\nContent-Type: application/json\nExample payload: ${JSON.stringify(examplePayload)}\nUse a stable feed name in place of production; metrics are created on first push.\nGuide: ${location.origin}/api/data-feeds/guide`,
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
            Delete this application, all its feeds, stored values and API keys.
            Keep every widget’s position, size, formatting and settings. Widgets
            using these connections become disconnected in drafts and published
            playlists and can be connected to replacement feeds later.
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
                  await api(
                    `${base}/${deleting.id}?disconnectWidgets=true`,
                    'DELETE',
                  );
                  await reload();
                  await onRefresh?.();
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
