import { useEffect, useId, useState } from 'react';
import { Button } from './components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from './components/ui/alert-dialog';
import {
  Database,
  Plus,
  Copy,
  KeyRound,
  Trash2,
  Gauge,
  Hash,
  ChartLine,
  ChartColumn,
} from 'lucide-react';
import { api, type DataFeed, type Layer, type Library } from './types';
import { orderedTree, indentedName } from './hierarchy';
import { ManageAccessButton, type SharedResource } from './resource-access';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';
import './data-feeds.css';

export const dataModes = [
  { mode: 'metric', label: 'Metric', icon: Hash },
  { mode: 'progress', label: 'Progress bar', icon: Gauge },
  { mode: 'line', label: 'Line graph', icon: ChartLine },
  { mode: 'bar', label: 'Bar chart', icon: ChartColumn },
] as const;
type Token = {
  id: string;
  name: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};
export function exampleData(feed: DataFeed) {
  return Object.fromEntries(
    feed.fields.map((f) => [
      f.key,
      f.type === 'number'
        ? 42
        : f.type === 'series'
          ? [
              { time: '2026-10-06T09:00:00Z', value: 30 },
              { time: '2026-10-06T10:00:00Z', value: 42 },
            ]
          : [
              { label: 'North', value: 42 },
              { label: 'South', value: 35 },
            ],
    ]),
  );
}
function exampleRequest(feed: DataFeed, url: string) {
  return [
    `curl --request PUT '${url}'`,
    "  --header 'Authorization: Bearer YOUR_API_KEY'",
    "  --header 'Content-Type: application/json'",
    `  --data '${JSON.stringify(exampleData(feed))}'`,
  ].join(' \\' + '\n');
}
export function DataFeeds({
  feeds,
  groups = [],
  isAdmin,
  onRefresh,
  onAccess,
}: {
  feeds: DataFeed[];
  groups?: Library['groups'];
  isAdmin: boolean;
  onRefresh: () => Promise<void>;
  onAccess: (resource: SharedResource) => void;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [fields, setFields] = useState<DataFeed['fields']>([
    { key: 'value', type: 'number' },
  ]);
  const [selected, setSelected] = useState<DataFeed | null>(null);
  const [snapshot, setSnapshot] = useState<{
    data: unknown;
    updatedAt: string | null;
  } | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tokenName, setTokenName] = useState('');
  const [expires, setExpires] = useState(90);
  const [secret, setSecret] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [revoking, setRevoking] = useState<Token | null>(null);
  const keyHelpId = useId();
  const [keyErrors, setKeyErrors] = useState<Record<number, string>>({});
  async function run(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const base = selected ? `/api/data-feeds/${selected.id}` : '';
  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setSnapshot(null);
    setTokens([]);
    setError('');
    setDeleting(false);
    setNotice('');
    let stopped = false;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`${base}/data`, {
          cache: 'no-store',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
        });
        const value = await response.json();
        if (!stopped) {
          if (response.ok) setSnapshot(value);
          else {
            setSnapshot(null);
            setError(value.error || 'Feed unavailable');
          }
        }
      } catch {
        /* Preserve last snapshot while reconnecting. */
      } finally {
        if (!stopped) timer = setTimeout(poll, 15000);
      }
    }
    void poll();
    if (!selected.readOnly)
      void api<Token[]>(`${base}/tokens`)
        .then((value) => {
          if (!stopped) setTokens(value);
        })
        .catch((cause) => {
          if (!stopped) setError(cause.message);
        });
    return () => {
      stopped = true;
      clearTimeout(timer);
      abort.abort();
    };
  }, [base, selected]);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('Copied');
    } catch {
      setError('Clipboard unavailable. Select and copy the text.');
    }
  }
  return (
    <section className="data-feeds-page" aria-labelledby="data-feeds-heading">
      <h2 id="data-feeds-heading">Data feeds</h2>
      <p className="muted">
        Connect an application with an API key and send data to metrics,
        progress bars, graphs, and charts across your slides.
      </p>
      <div className="data-feed-toolbar">
        <label>
          Find a feed
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
          />
        </label>
        <Button
          onClick={() => {
            setKeyErrors({});
            setCreating(true);
            setName('');
            setGroup('');
            setFields([{ key: 'value', type: 'number' }]);
            setError('');
          }}
        >
          <Plus size={18} /> New feed
        </Button>
      </div>
      {!feeds.length && (
        <div className="data-feed-empty">
          <Database size={32} />
          <h2>Connect your data</h2>
          <p>
            Create a feed, define its fields, then give your integration a
            feed-specific API key.
          </p>
        </div>
      )}
      {!!feeds.length && (
        <div className="data-feed-list">
          {feeds
            .filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
            .map((feed) => (
              <article key={feed.id}>
                <button
                  className="data-feed-open"
                  onClick={() => {
                    setSecret('');
                    setSelected(feed);
                  }}
                >
                  <Database size={22} />
                  <span>
                    <strong>{feed.name}</strong>
                    <small>
                      {feed.fields.length}{' '}
                      {feed.fields.length === 1 ? 'field' : 'fields'} ·{' '}
                      {feed.readOnly ? 'View only' : 'Can edit'}
                      {feed.updatedAt
                        ? ` · Updated ${new Date(feed.updatedAt).toLocaleString()}`
                        : ' · Waiting for first update'}
                    </small>
                  </span>
                </button>
                <ManageAccessButton
                  resourceName={feed.name}
                  tags={feed.accessTags}
                  onClick={() =>
                    onAccess({
                      kind: 'data-feed',
                      id: feed.id,
                      name: feed.name,
                    })
                  }
                />
              </article>
            ))}
        </div>
      )}
      <p>
        <a href="/api/data-feeds/guide" target="_blank" rel="noreferrer">
          API integration guide
        </a>{' '}
        ·{' '}
        <a href="/api/data-feeds/openapi.json" target="_blank" rel="noreferrer">
          OpenAPI contract
        </a>
      </p>
      <AlertDialog
        open={!!revoking}
        onOpenChange={(open) => !open && !busy && setRevoking(null)}
      >
        <AlertDialogContent className="of-modal">
          <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
          <AlertDialogDescription>
            {revoking?.name} will immediately lose permission to update this
            feed. Create a replacement key and update the application to
            reconnect.
          </AlertDialogDescription>
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setRevoking(null)}>
              Cancel
            </button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`${base}/tokens/${revoking!.id}`, 'DELETE');
                  setTokens(await api<Token[]>(`${base}/tokens`));
                  setRevoking(null);
                })
              }
            >
              Revoke API key
            </Button>
          </div>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={creating}
        onOpenChange={(open) => !busy && setCreating(open)}
      >
        <DialogContent size="standard" className="of-modal data-feed-modal">
          <DialogTitle>New data feed</DialogTitle>
          <DialogDescription>
            Field keys are fixed once created. Use short names your integration
            can send.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const duplicate = fields.findIndex((field, i) =>
                fields.some((other, j) => i !== j && other.key === field.key),
              );
              if (duplicate >= 0) {
                setKeyErrors({ [duplicate]: 'Each field needs a unique key.' });
                const keys =
                  e.currentTarget.querySelectorAll<HTMLInputElement>(
                    'input[pattern]',
                  );
                keys[duplicate]?.focus();
                return;
              }
              setKeyErrors({});
              void run(async () => {
                await api('/api/data-feeds', 'POST', {
                  name,
                  managingGroupId: group || null,
                  fields,
                });
                await onRefresh();
                setCreating(false);
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Managing group
                <select
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                >
                  <option value="">Personal</option>
                  {orderedTree(groups)
                    .filter(({ item }) => isAdmin || item.directMember)
                    .map(({ item, depth }) => (
                      <option key={item.id} value={item.id}>
                        {indentedName(item.name, depth)}
                      </option>
                    ))}
                </select>
              </label>
              <div className="data-feed-field-heading">Fields</div>
              <p className="field-help" id={keyHelpId}>
                Start each unique key with a letter. Use only letters, numbers,
                and underscores, up to 40 characters.
              </p>
              {fields.map((f, i) => (
                <div className="data-feed-field" key={i}>
                  <label>
                    Key
                    <input
                      value={f.key}
                      onChange={(e) => {
                        setKeyErrors((current) => {
                          const next = { ...current };
                          delete next[i];
                          return next;
                        });
                        setFields(
                          fields.map((v, j) =>
                            j === i ? { ...v, key: e.target.value } : v,
                          ),
                        );
                      }}
                      aria-invalid={!!keyErrors[i]}
                      aria-describedby={
                        keyErrors[i]
                          ? `${keyHelpId} ${keyHelpId}-${i}`
                          : keyHelpId
                      }
                      onInvalid={() =>
                        setKeyErrors((current) => ({
                          ...current,
                          [i]: 'Enter a key that matches the requirements above.',
                        }))
                      }
                      pattern="[A-Za-z][A-Za-z0-9_]{0,39}"
                      required
                      maxLength={40}
                    />
                    {keyErrors[i] && (
                      <p
                        className="field-error"
                        id={`${keyHelpId}-${i}`}
                        role="alert"
                      >
                        {keyErrors[i]}
                      </p>
                    )}
                  </label>
                  <label>
                    Type
                    <select
                      value={f.type}
                      onChange={(e) =>
                        setFields(
                          fields.map((v, j) =>
                            j === i
                              ? { ...v, type: e.target.value as typeof f.type }
                              : v,
                          ),
                        )
                      }
                    >
                      <option value="number">Number</option>
                      <option value="series">Time series</option>
                      <option value="categories">Categories</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="ghost"
                    aria-label={`Remove field ${i + 1}`}
                    disabled={fields.length === 1}
                    onClick={() => setFields(fields.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="ghost"
                disabled={fields.length >= 20}
                onClick={() =>
                  setFields([...fields, { key: '', type: 'number' }])
                }
              >
                <Plus size={16} /> Add field
              </button>
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <div className="data-feed-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
                <Button type="submit">Create feed</Button>
              </div>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setSelected(null);
            setSecret('');
          }
        }}
      >
        <DialogContent size="standard" className="of-modal data-feed-modal">
          <DialogTitle>{selected?.name}</DialogTitle>
          <DialogDescription>
            {selected?.readOnly
              ? 'View only. The managing group controls this feed.'
              : 'Manage updates and application API keys for this feed.'}
          </DialogDescription>
          {selected && (
            <>
              <p className="muted">
                Feed ID <code className="data-feed-id">{selected.id}</code>
              </p>
              {!selected.readOnly && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      const next = await api<DataFeed>(base, 'PUT', {
                        name,
                        managingGroupId: selected.managingGroupId || null,
                        fields: selected.fields,
                      });
                      setSelected(next);
                      await onRefresh();
                    });
                  }}
                >
                  <fieldset disabled={busy}>
                    <label>
                      Name
                      <input
                        required
                        maxLength={100}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <button disabled={name.trim() === selected.name}>
                      Save name
                    </button>
                  </fieldset>
                </form>
              )}
              <button
                className="ghost"
                onClick={() =>
                  void copy(
                    JSON.stringify(
                      {
                        baseUrl: location.origin,
                        feedId: selected.id,
                        fields: selected.fields,
                        update: {
                          method: 'PUT',
                          url: `${location.origin}${base}/data`,
                        },
                        authentication:
                          'API key in Authorization: Bearer YOUR_API_KEY, supplied separately',
                        guide: `${location.origin}/api/data-feeds/guide`,
                        openapi: `${location.origin}/api/data-feeds/openapi.json`,
                      },
                      null,
                      2,
                    ),
                  )
                }
              >
                <Copy size={16} /> Copy integration details
              </button>
              <h3>{snapshot?.data ? 'Latest snapshot' : 'Example payload'}</h3>
              <p className="muted">
                {snapshot?.updatedAt
                  ? `Updated ${new Date(snapshot.updatedAt).toLocaleString()}`
                  : 'Waiting for first update'}
              </p>
              <pre className="data-feed-code">
                {JSON.stringify(
                  snapshot?.data ?? exampleData(selected),
                  null,
                  2,
                )}
              </pre>
              {!selected.readOnly && (
                <>
                  <h3>
                    <KeyRound size={18} /> API keys
                  </h3>
                  <p className="muted">
                    Generate a separate key for each application that sends data
                    to this feed. Keys can update only this feed; they cannot
                    read data or edit slides. They expire and can be revoked at
                    any time. Keys also stop working if their creator loses Edit
                    access.
                  </p>
                  {tokens.map((token) => (
                    <div className="data-feed-token" key={token.id}>
                      <span>
                        <strong>{token.name}</strong>
                        <small>
                          {token.revokedAt
                            ? 'Revoked'
                            : `Expires ${new Date(token.expiresAt).toLocaleDateString()}`}
                          {token.lastUsedAt
                            ? ` · Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                            : ' · Never used'}
                        </small>
                      </span>
                      <button
                        className="ghost"
                        disabled={busy || !!token.revokedAt}
                        onClick={() => setRevoking(token)}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        const result = await api<Token & { token: string }>(
                          `${base}/tokens`,
                          'POST',
                          { name: tokenName, expiresInDays: expires },
                        );
                        setSecret(result.token);
                        setTokenName('');
                        setTokens(await api<Token[]>(`${base}/tokens`));
                      });
                    }}
                  >
                    <fieldset disabled={busy}>
                      <label>
                        Application name
                        <input
                          required
                          value={tokenName}
                          maxLength={80}
                          onChange={(e) => setTokenName(e.target.value)}
                          placeholder="Sales dashboard integration"
                        />
                      </label>
                      <label>
                        Expires in days
                        <input
                          type="number"
                          min={1}
                          max={365}
                          required
                          value={expires}
                          onChange={(e) => setExpires(Number(e.target.value))}
                        />
                      </label>
                      <Button type="submit">Generate API key</Button>
                    </fieldset>
                  </form>
                  <Dialog
                    open={!!secret}
                    onOpenChange={(open) => !open && setSecret('')}
                  >
                    <DialogContent
                      size="standard"
                      className="of-modal data-feed-modal"
                    >
                      <DialogTitle>API key generated</DialogTitle>
                      <DialogDescription>
                        Copy this key now. You will not be able to see it again.
                        Store it in the application’s secrets configuration.
                      </DialogDescription>
                      <output className="data-feed-secret">
                        <code>{secret}</code>
                        <button onClick={() => void copy(secret)}>
                          <Copy size={16} /> Copy API key
                        </button>
                      </output>
                      <p className="muted">
                        This key can send updates only to {selected.name}.
                      </p>
                      <label className="data-feed-endpoint">
                        Update URL
                        <input
                          readOnly
                          value={`${location.origin}${base}/data`}
                          onFocus={(event) => event.target.select()}
                        />
                      </label>
                      <pre className="data-feed-code">{`Authorization: Bearer YOUR_API_KEY`}</pre>
                      <p>
                        Use PUT with Content-Type: application/json and the
                        example payload in this feed’s integration details.
                      </p>
                      <button
                        className="ghost"
                        onClick={() =>
                          void copy(`${location.origin}${base}/data`)
                        }
                      >
                        <Copy size={16} /> Copy update URL
                      </button>
                      {notice && <output>{notice}</output>}
                      {error && (
                        <p className="inline-error" role="alert">
                          {error}
                        </p>
                      )}
                      <div className="data-feed-actions">
                        <button onClick={() => setSecret('')}>Done</button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </>
              )}
              <h3>Send an update</h3>
              <pre className="data-feed-code">
                {exampleRequest(selected, `${location.origin}${base}/data`)}
              </pre>
              <button
                className="ghost"
                onClick={() =>
                  void copy(
                    exampleRequest(selected, `${location.origin}${base}/data`),
                  )
                }
              >
                <Copy size={16} /> Copy request example
              </button>
              <button
                className="ghost"
                onClick={() =>
                  void copy(JSON.stringify(exampleData(selected), null, 2))
                }
              >
                <Copy size={16} /> Copy example payload
              </button>
              {notice && <output>{notice}</output>}
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              {!selected.readOnly && (
                <div className="data-feed-actions">
                  {deleting ? (
                    <>
                      <span>Delete feed and all its API keys?</span>
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() => setDeleting(false)}
                      >
                        Cancel
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(base, 'DELETE');
                            await onRefresh();
                            setSelected(null);
                            setSecret('');
                          })
                        }
                      >
                        Delete feed
                      </button>
                    </>
                  ) : (
                    <button className="ghost" onClick={() => setDeleting(true)}>
                      <Trash2 size={16} /> Delete feed
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function DataWidgetOptions({
  layer,
  feeds,
  onChange,
}: {
  layer: Layer;
  feeds: DataFeed[];
  onChange: (value: NonNullable<Layer['data']>) => void;
}) {
  const config = layer.data!;
  const feed = feeds.find((f) => f.id === config.feedId);
  const expected =
    config.mode === 'line'
      ? 'series'
      : config.mode === 'bar'
        ? 'categories'
        : 'number';
  const fields = feed?.fields.filter((f) => f.type === expected) || [];
  const patch = (value: Partial<typeof config>) =>
    onChange({ ...config, ...value });
  return (
    <div className="data-widget-options">
      <label>
        Data feed
        <select
          aria-label="Data feed"
          value={config.feedId || ''}
          onChange={(e) => {
            const f = feeds.find((v) => v.id === e.target.value);
            patch({
              feedId: f?.id || null,
              field: f?.fields.find((v) => v.type === expected)?.key || '',
              targetField: '',
            });
          }}
        >
          <option value="">Choose a feed</option>
          {feeds.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Value field
        <select
          aria-label="Value field"
          value={config.field}
          onChange={(e) => patch({ field: e.target.value })}
        >
          <option value="">Choose a {expected} field</option>
          {fields.map((f) => (
            <option key={f.key}>{f.key}</option>
          ))}
        </select>
      </label>
      {!feeds.length && (
        <p className="muted">
          Create a feed under Settings → Data feeds first.
        </p>
      )}
      <label>
        Title
        <input
          maxLength={80}
          value={config.title}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </label>
      <label>
        Unit / suffix
        <input
          maxLength={20}
          value={config.unit}
          onChange={(e) => patch({ unit: e.target.value })}
          placeholder="USD, units, %"
        />
      </label>
      <label>
        Decimal places
        <input
          type="number"
          min={0}
          max={4}
          value={config.decimals}
          onChange={(e) => patch({ decimals: Number(e.target.value) })}
        />
      </label>
      {config.mode === 'progress' && (
        <>
          <label>
            Target field
            <select
              value={config.targetField}
              onChange={(e) => patch({ targetField: e.target.value })}
            >
              <option value="">Fixed target</option>
              {feed?.fields
                .filter((f) => f.type === 'number')
                .map((f) => (
                  <option key={f.key}>{f.key}</option>
                ))}
            </select>
          </label>
          {!config.targetField && (
            <label>
              Target
              <input
                type="number"
                min={0.000001}
                max={1e12}
                value={config.target}
                onChange={(e) => patch({ target: Number(e.target.value) })}
              />
            </label>
          )}
          <label>
            Orientation
            <select
              value={config.orientation}
              onChange={(e) =>
                patch({
                  orientation: e.target.value as typeof config.orientation,
                })
              }
            >
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </label>
        </>
      )}
      {config.mode !== 'metric' && (
        <>
          <label>
            Accent color
            <input
              type="color"
              value={config.accent}
              onChange={(e) => patch({ accent: e.target.value })}
            />
          </label>
          <label>
            Track / grid color
            <input
              type="color"
              value={config.track}
              onChange={(e) => patch({ track: e.target.value })}
            />
          </label>
        </>
      )}
      <label className="data-feed-checkbox">
        <input
          type="checkbox"
          checked={config.showUpdated}
          onChange={(e) => patch({ showUpdated: e.target.checked })}
        />
        Show update time
      </label>
      <label>
        Mark stale after (minutes)
        <input
          type="number"
          min={1}
          max={10080}
          value={config.staleAfterMinutes}
          onChange={(e) => patch({ staleAfterMinutes: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
