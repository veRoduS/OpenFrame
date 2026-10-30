import { useState } from 'react';
import { api, type Site } from './types';

type Entry = {
  id: string;
  createdAt: string;
  actorName: string;
  action: string;
  resourceName: string | null;
  resourceId: string;
  fromSiteId: string | null;
  toSiteId: string | null;
};
type Page = { entries: Entry[]; nextCursor: string | null };
export function SiteHistory({ sites }: { sites: Site[] }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [siteId, setSiteId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load(append = false) {
    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (siteId) query.set('siteId', siteId);
      if (append && cursor) query.set('before', cursor);
      const result = await api<Page>(`/api/sites/audit?${query}`);
      setEntries((current) =>
        append ? [...current, ...result.entries] : result.entries,
      );
      setCursor(result.nextCursor);
      setLoaded(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const label = (id: string | null) =>
    id
      ? sites.find((site) => site.id === id)?.siteNumber || 'Unknown site'
      : 'Unassigned';
  return (
    <details className="site-history">
      <summary>Site history</summary>
      <label>
        Site
        <select
          aria-label="Site history filter"
          value={siteId}
          disabled={busy}
          onChange={(event) => {
            setSiteId(event.target.value);
            setEntries([]);
            setCursor(null);
            setLoaded(false);
          }}
        >
          <option value="">All sites</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.siteNumber} · {site.name}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy} onClick={() => void load()}>
        {loaded ? 'Refresh site history' : 'Load site history'}
      </button>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {loaded && entries.length === 0 && <p>No site changes recorded.</p>}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.resourceName || entry.resourceId}</strong>:{' '}
            {entry.action.replaceAll('-', ' ')} · {entry.actorName} ·{' '}
            {new Date(entry.createdAt).toLocaleString()}
            {(entry.fromSiteId || entry.toSiteId) && (
              <span>
                {' '}
                · {label(entry.fromSiteId)} → {label(entry.toSiteId)}
              </span>
            )}
          </li>
        ))}
      </ul>
      {cursor && (
        <button disabled={busy} onClick={() => void load(true)}>
          Load older site history
        </button>
      )}
    </details>
  );
}
