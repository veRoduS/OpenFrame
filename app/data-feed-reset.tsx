import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from './types';
import { Button } from './components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from './components/ui/alert-dialog';

type Review = {
  revision: string;
  counts: {
    applications: number;
    feeds: number;
    keys: number;
    widgets: number;
    slides: number;
    publishedPlaylists: number;
  };
};
export function DataFeedResetButton({
  onComplete,
}: {
  onComplete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function prepare() {
    setOpen(true);
    setReview(null);
    setConfirmation('');
    setError('');
    setBusy(true);
    try {
      setReview(await api<Review>('/api/data-feeds/reset/preview', 'POST'));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" onClick={() => void prepare()}>
        <Trash2 size={16} /> Reset all data connections
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(value) => !busy && setOpen(value)}
      >
        <AlertDialogContent className="of-modal">
          <AlertDialogTitle>Reset all data connections?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete every application, data feed, stored metric value and API key
            across all sites. Keep sites, screens, slides, playlists and widget
            layouts. Connected widgets will show “Waiting for data” after
            screens sync. Connect them to replacement feeds later in the slide
            editor.
          </AlertDialogDescription>
          {review && (
            <p>
              {review.counts.applications} applications · {review.counts.feeds}{' '}
              feeds · {review.counts.keys} API keys. Disconnect{' '}
              {review.counts.widgets} widgets across {review.counts.slides}{' '}
              slides and update {review.counts.publishedPlaylists} published
              playlists.
            </p>
          )}
          {busy && !review && <output>Reviewing data connections…</output>}
          {error && (
            <div>
              <p role="alert" className="inline-error">
                {error}
              </p>
              <button disabled={busy} onClick={() => void prepare()}>
                Review reset again
              </button>
            </div>
          )}
          <label>
            Type RESET to confirm
            <input
              aria-label="Type RESET to confirm"
              value={confirmation}
              disabled={busy || !review}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <Button
              variant="destructive"
              disabled={busy || !review || confirmation !== 'RESET'}
              onClick={() => {
                if (!review) return;
                void (async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api('/api/data-feeds/reset', 'POST', {
                      confirmation,
                      revision: review.revision,
                    });
                    setOpen(false);
                    await onComplete();
                  } catch (cause) {
                    setReview(null);
                    setError((cause as Error).message);
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Delete connections and keep widgets
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
