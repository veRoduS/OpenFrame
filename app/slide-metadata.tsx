import { useEffect, useState } from 'react';
import { Tags, Users } from 'lucide-react';
import { api, type Slide } from './types';
import { parseTags } from './media-utils.mjs';
import { TagInput } from './tag-input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';

export function SlideMetadata({
  slide,
  onTags,
  onAccess,
}: {
  slide: Slide;
  onTags: () => void;
  onAccess: () => void;
}) {
  const grants = slide.accessTags || [];
  const groups = grants.filter((tag) => tag.type === 'group');
  const users = grants.filter((tag) => tag.type === 'user');
  const preview =
    groups.length && users.length
      ? [groups[0], users[0], ...groups.slice(1), ...users.slice(1)].slice(0, 5)
      : grants.slice(0, 5);
  return (
    <div className="slide-metadata">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              className="metadata-placeholder"
              aria-label={`Tags for ${slide.name}`}
              onClick={onTags}
            />
          }
        >
          <Tags size={15} /> Tags <span>{slide.tags?.length || 0}</span>
        </TooltipTrigger>
        <TooltipContent className="metadata-tooltip">
          <strong>Tags</strong>
          {slide.tags?.length ? (
            slide.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)
          ) : (
            <span>No tags</span>
          )}
          {(slide.tags?.length || 0) > 5 && (
            <span>+{slide.tags!.length - 5} more tags</span>
          )}
          <small>
            {slide.readOnly ? 'Click to view tags' : 'Click to edit tags'}
          </small>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              className="metadata-placeholder"
              aria-label={`Manage access to ${slide.name}`}
              onClick={onAccess}
            />
          }
        >
          <Users size={15} /> Access{' '}
          <span>{slide.accessTags?.length || 0}</span>
        </TooltipTrigger>
        <TooltipContent className="metadata-tooltip">
          <strong>Access</strong>
          {slide.accessTags?.length ? (
            preview.map((tag) => (
              <span key={`${tag.type}:${tag.id}`}>
                {tag.type === 'user' ? 'User: ' : 'Group: '}
                {tag.name}
              </span>
            ))
          ) : (
            <span>No shared groups or users</span>
          )}
          {(slide.accessTags?.length || 0) > 5 && (
            <span>+{slide.accessTags!.length - 5} more access grants</span>
          )}
          <small>Click to manage access</small>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function SlideTagsDialog({
  slide,
  existingTags,
  onClose,
  onChanged,
}: {
  slide: Slide | null;
  existingTags: string[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setTags(slide?.tags?.join(', ') || '');
    setError('');
  }, [slide]);
  return (
    <Dialog open={!!slide} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="of-modal">
        <DialogTitle>Tags: {slide?.name}</DialogTitle>
        <DialogDescription>
          {slide?.readOnly
            ? 'You can view this slide’s tags.'
            : 'Choose existing tags or enter new tags. Changes apply to this slide.'}
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!slide || slide.readOnly) return;
            const next = parseTags(tags);
            setBusy(true);
            setError('');
            void (async () => {
              try {
                await api('/api/organization/slides', 'POST', {
                  ids: [slide.id],
                  addTags: next,
                  removeTags: (slide.tags || []).filter(
                    (tag) => !next.includes(tag),
                  ),
                });
                await onChanged();
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <TagInput
            label="Tags"
            existingLabel="Choose existing tags"
            existingTags={existingTags}
            value={tags}
            onChange={setTags}
            disabled={busy || !!slide?.readOnly}
          />
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              {slide?.readOnly ? 'Close' : 'Cancel'}
            </button>
            {!slide?.readOnly && (
              <button className="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save tags'}
              </button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
