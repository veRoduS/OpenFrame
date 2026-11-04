import { useEffect, useState } from 'react';
import { api } from './types';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';

type Entry = {
  sequence: number;
  createdAt: string;
  actorId: string;
  actorName: string;
  action: string;
  resourceKind: string;
  resourceName: string;
  resourceId: string;
  operation: string;
  canRestore: boolean;
};
type Page = { entries: Entry[]; nextCursor: number | null };
export function AuditHistory({ refresh }: { refresh: () => Promise<void> }) {
  const [filters, setFilters] = useState({
    search: '',
    actorId: '',
    kind: '',
    action: '',
    from: '',
    to: '',
  });
  const [page, setPage] = useState<Page>({ entries: [], nextCursor: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<{
    entry: Entry;
    before: unknown;
    after: unknown;
    related?: {
      sequence: number;
      resourceName: string;
      resourceKind: string;
    }[];
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  ).toString();
  useEffect(() => {
    let stale = false;
    setBusy(true);
    setError('');
    api<Page>(`/api/audit?${query}`)
      .then((next) => {
        if (!stale) setPage(next);
      })
      .catch((e) => !stale && setError(e.message))
      .finally(() => !stale && setBusy(false));
    return () => {
      stale = true;
    };
  }, [query, revision]);
  async function inspect(entry: Entry) {
    try {
      const result = await api<{ before: unknown; after: unknown }>(
        `/api/audit/${entry.sequence}`,
      );
      setDetail({ entry, ...result });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="account-section">
      <h2>Audit &amp; history</h2>
      <p className="muted">
        Administrator access only. History starts when this version is
        installed. Restore reverses a complete recorded operation, including
        related publication and sharing changes. Newer changes block
        restoration. Uploads, deletions, accounts and configuration are
        audit-only.
      </p>
      <div className="audit-filters">
        {(
          [
            ['search', 'Search name or ID'],
            ['actorId', 'Actor ID'],
            ['kind', 'Resource type'],
            ['action', 'Action / route'],
            ['from', 'From (UTC)'],
            ['to', 'To (UTC)'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type={key === 'from' || key === 'to' ? 'datetime-local' : 'text'}
              value={
                key === 'from' || key === 'to'
                  ? filters[key].slice(0, 16)
                  : filters[key]
              }
              placeholder={key === 'kind' ? 'slide, playlist, asset…' : ''}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  [key]: e.target.value
                    ? key === 'from' || key === 'to'
                      ? `${e.target.value}${key === 'to' ? ':59.999Z' : ':00.000Z'}`
                      : e.target.value
                    : '',
                })
              }
            />
          </label>
        ))}
        <button
          onClick={() =>
            setFilters({
              search: '',
              actorId: '',
              kind: '',
              action: '',
              from: '',
              to: '',
            })
          }
        >
          Clear filters
        </button>
        <button disabled={busy} onClick={() => setRevision((v) => v + 1)}>
          Refresh history
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Time (UTC)</th>
              <th>Who</th>
              <th>Item</th>
              <th>Change</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {page.entries.map((entry) => (
              <tr key={entry.sequence}>
                <td>{entry.createdAt}</td>
                <td>
                  <button
                    title={entry.actorId}
                    onClick={() =>
                      setFilters({ ...filters, actorId: entry.actorId })
                    }
                  >
                    {entry.actorName}
                  </button>
                </td>
                <td>
                  {entry.resourceName}
                  <small style={{ display: 'block' }}>
                    {entry.resourceKind}
                  </small>
                </td>
                <td>
                  {entry.operation}
                  <small style={{ display: 'block' }}>{entry.action}</small>
                </td>
                <td>
                  <button onClick={() => void inspect(entry)}>Review</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!busy && !page.entries.length && <p>No changes match these filters.</p>}
      {page.nextCursor && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const next = await api<Page>(
                `/api/audit?${query}&before=${page.nextCursor}`,
              );
              setPage({
                entries: [...page.entries, ...next.entries],
                nextCursor: next.nextCursor,
              });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Load older changes
        </button>
      )}
      {detail && (
        <Dialog open onOpenChange={(open) => !open && !busy && setDetail(null)}>
          <DialogContent className="of-modal" size="standard">
            <DialogTitle>Review {detail.entry.resourceName}</DialogTitle>
            <DialogDescription>
              Recorded by {detail.entry.actorName}. Restore applies to the
              entire operation. Review both versions first.
            </DialogDescription>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            {detail.related && detail.related.length > 1 && (
              <div>
                <h3>Changes in this operation</h3>
                <ul>
                  {detail.related.map((item) => (
                    <li key={item.sequence}>
                      {item.resourceName} · {item.resourceKind}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <h3>Before</h3>
            <pre
              style={{
                maxHeight: 220,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {JSON.stringify(
                detail.before,
                (key, value) =>
                  key === 'body' && typeof value === 'string'
                    ? JSON.parse(value)
                    : value,
                2,
              )}
            </pre>
            <h3>After</h3>
            <pre
              style={{
                maxHeight: 220,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {JSON.stringify(
                detail.after,
                (key, value) =>
                  key === 'body' && typeof value === 'string'
                    ? JSON.parse(value)
                    : value,
                2,
              )}
            </pre>
            {detail.entry.canRestore ? (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(
                      `/api/audit/${detail.entry.sequence}/revert`,
                      'POST',
                      {},
                    );
                    await refresh();
                    setDetail(null);
                    setRevision((v) => v + 1);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Restore before this operation
              </button>
            ) : (
              <p>This change is audit-only.</p>
            )}
            <button disabled={busy} onClick={() => setDetail(null)}>
              Close
            </button>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
