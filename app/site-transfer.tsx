import { useState } from 'react';
import { api, type Device, type Site } from './types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './components/ui/dialog';

type Impact = {
  from: Site;
  to: Site;
  online: boolean;
  reviewToken: string;
  detachPlaylist: boolean;
  playlistId: string | null;
  removedShareCount: number;
  issues: { slideId: string; layerId: string; title: string; reason: string }[];
};
export function SiteTransfer({
  device,
  sites,
  onClose,
  onTransferred,
}: {
  device: Device;
  sites: Site[];
  onClose: () => void;
  onTransferred: () => Promise<void>;
}) {
  const [siteId, setSiteId] = useState('');
  const [impact, setImpact] = useState<Impact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="of-modal" size="standard">
        <DialogTitle>Transfer {device.name}</DialogTitle>
        <DialogDescription>
          Review the destination and content before moving this screen. Requires
          player 0.15.2 or newer.
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () =>
              setImpact(
                await api<Impact>(
                  `/api/devices/${device.id}/site-preview?siteId=${encodeURIComponent(siteId)}`,
                ),
              ),
            );
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Destination site
              <select
                aria-label="Destination site"
                required
                value={siteId}
                onChange={(event) => {
                  setSiteId(event.target.value);
                  setImpact(null);
                }}
              >
                <option value="">Choose a destination</option>
                {sites
                  .filter(
                    (site) => !site.archivedAt && site.id !== device.siteId,
                  )
                  .map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.siteNumber} · {site.name}
                    </option>
                  ))}
              </select>
            </label>
            <button>Review transfer</button>
          </fieldset>
        </form>
        {impact && (
          <div>
            <p>
              Move from{' '}
              <strong>
                {impact.from.siteNumber} · {impact.from.name}
              </strong>{' '}
              to{' '}
              <strong>
                {impact.to.siteNumber} · {impact.to.name}
              </strong>
              .
            </p>
            <p>
              {impact.detachPlaylist
                ? 'The current playlist will be unassigned because it contains fixed metrics from another site.'
                : impact.playlistId
                  ? 'The current playlist will be retained. Shared metrics will use the destination site.'
                  : 'No playlist is currently assigned.'}
            </p>
            {impact.issues.length > 0 && (
              <ul>
                {impact.issues.map((issue, index) => (
                  <li key={`${issue.layerId}-${index}`}>
                    {issue.title}: {issue.reason}
                  </li>
                ))}
              </ul>
            )}
            <p>
              Screen access will reset to administrators.{' '}
              {impact.removedShareCount} existing shares will be removed. Share
              it with the destination group after the move.
            </p>
            <p>
              {impact.online
                ? 'The player is currently connected.'
                : 'The player is currently offline.'}{' '}
              It can keep showing its previous cached content until it
              reconnects. Wait for “Previous site cache cleared” before
              relocating it.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/api/devices/${device.id}/transfer`, 'POST', {
                    siteId: impact.to.id,
                    reviewToken: impact.reviewToken,
                  });
                  await onTransferred();
                })
              }
            >
              Transfer screen
            </button>
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </DialogContent>
    </Dialog>
  );
}
