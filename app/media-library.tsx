import { useRef, useState, type ReactNode } from 'react';
import {
  Folder,
  FolderPlus,
  Images,
  Upload,
  Search,
  Grid2X2,
  List,
  Pencil,
  Trash2,
  FolderInput,
  Tags,
  X,
  Check,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { api, type Asset, type MediaFolder } from './types';
import { visibleMedia, parseTags } from './media-utils.mjs';

function Tool({
  label,
  children,
  onClick,
  active,
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={`icon-button ${active ? 'active' : ''}`}
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            disabled={disabled}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
type FormMode = 'folder' | 'rename-folder' | 'asset' | 'move' | 'tags' | null;
export function MediaLibrary({
  assets,
  folders,
  onRefresh,
  onUpload,
  onPick,
}: {
  assets: Asset[];
  folders: MediaFolder[];
  onRefresh: () => Promise<void>;
  onUpload: (file: File, folderId?: string | null) => Promise<Asset>;
  onPick?: (asset: Asset) => void;
}) {
  const [folder, setFolder] = useState('all');
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('newest');
  const [display, setDisplay] = useState('grid');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<FormMode>(null);
  const [activeAsset, setActiveAsset] = useState<Asset | null>(null);
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [tagAction, setTagAction] = useState('add');
  const [destination, setDestination] = useState('');
  const [deleting, setDeleting] = useState<'assets' | 'folder' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const uploadInput = useRef<HTMLInputElement>(null);
  const filtered = visibleMedia(assets, {
    folder,
    search,
    tag,
    sort,
  }) as Asset[];
  const selection = assets.filter((a) => selected.has(a.id)).map((a) => a.id);
  const currentFolder = folders.find((f) => f.id === folder);
  const allTags = [...new Set(assets.flatMap((a) => a.tags || []))].sort();
  const sortedFolders = [...folders].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const selectedVisible = filtered.filter((a) => selected.has(a.id)).length;
  function chooseFolder(value: string) {
    setFolder(value);
    setSelected(new Set());
  }
  function toggle(id: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    void action()
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  }
  function open(mode: FormMode, asset?: Asset) {
    setError('');
    setMode(mode);
    setActiveAsset(asset || null);
    setName(
      asset?.name ||
        (mode === 'rename-folder' ? currentFolder?.name || '' : ''),
    );
    setTags(asset?.tags.join(', ') || '');
    setTagAction('add');
    setDestination(asset?.folderId || currentFolder?.id || '');
  }
  async function save() {
    if (mode === 'folder') {
      const created = await api<MediaFolder>('/api/folders', 'POST', { name });
      setFolder(created.id);
      setSelected(new Set());
    } else if (mode === 'rename-folder')
      await api(`/api/folders/${folder}`, 'PUT', { name });
    else if (mode === 'asset')
      await api(`/api/assets/${activeAsset!.id}`, 'PATCH', {
        name,
        tags: parseTags(tags),
        folderId: destination || null,
      });
    else if (mode === 'move')
      await api('/api/assets/batch', 'POST', {
        ids: selection,
        folderId: destination || null,
      });
    else if (mode === 'tags')
      await api('/api/assets/batch', 'POST', {
        ids: selection,
        [tagAction === 'add' ? 'addTags' : 'removeTags']: parseTags(tags),
      });
    await onRefresh();
    setMode(null);
    setNotice('Changes saved');
    if (mode === 'move') setSelected(new Set());
  }
  async function remove() {
    if (deleting === 'folder') {
      await api(`/api/folders/${folder}`, 'DELETE');
      chooseFolder('all');
    } else {
      await api('/api/assets/batch', 'POST', {
        ids: selection,
        action: 'delete',
      });
      setSelected(new Set());
    }
    await onRefresh();
    setDeleting(null);
    setNotice('Deleted');
  }
  const titles = {
    folder: 'New folder',
    'rename-folder': 'Rename folder',
    asset: 'Image details',
    move: 'Move selected images',
    tags: 'Tag selected images',
  };
  return (
    <div className={`media-library ${onPick ? 'picker-library' : ''}`}>
      <div className="media-toolbar">
        <label className="media-search">
          <Search size={17} />
          <input
            aria-label="Search media"
            placeholder="Search images or tags"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(new Set());
            }}
          />
        </label>
        <label
          className="sr-only"
          htmlFor={onPick ? 'picker-sort' : 'media-sort'}
        >
          Sort images
        </label>
        <select
          id={onPick ? 'picker-sort' : 'media-sort'}
          className="media-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A-Z</option>
          <option value="name-desc">Name Z-A</option>
          <option value="largest">Largest first</option>
          <option value="smallest">Smallest first</option>
        </select>
        <div className="media-display">
          <Tool
            label="Grid view"
            active={display === 'grid'}
            onClick={() => setDisplay('grid')}
          >
            <Grid2X2 size={18} />
          </Tool>
          <Tool
            label="List view"
            active={display === 'list'}
            onClick={() => setDisplay('list')}
          >
            <List size={18} />
          </Tool>
        </div>
        {!onPick && (
          <button onClick={() => open('folder')} disabled={busy}>
            <FolderPlus size={17} />
            New folder
          </button>
        )}
        <button
          className="primary"
          onClick={() => uploadInput.current?.click()}
          disabled={busy}
        >
          <Upload size={17} />
          Upload
        </button>
        <input
          ref={uploadInput}
          type="file"
          multiple
          accept="image/*"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            if (files.length)
              run(async () => {
                let completed = 0;
                for (const file of files) {
                  await onUpload(file, currentFolder?.id || null);
                  completed++;
                  setNotice(`Uploaded ${completed} of ${files.length}`);
                }
              });
          }}
        />
      </div>
      <div className="media-library-body">
        <nav className="folder-navigation" aria-label="Media folders">
          <button
            className={folder === 'all' ? 'chosen' : ''}
            onClick={() => chooseFolder('all')}
          >
            <Images size={16} />
            <span>All media</span>
            <small>{assets.length}</small>
          </button>
          <button
            className={folder === 'unfiled' ? 'chosen' : ''}
            onClick={() => chooseFolder('unfiled')}
          >
            <Folder size={16} />
            <span>Unfiled</span>
            <small>{assets.filter((a) => !a.folderId).length}</small>
          </button>
          {sortedFolders.map((f) => (
            <button
              key={f.id}
              className={folder === f.id ? 'chosen' : ''}
              onClick={() => chooseFolder(f.id)}
            >
              <Folder size={16} />
              <span>{f.name}</span>
              <small>{assets.filter((a) => a.folderId === f.id).length}</small>
            </button>
          ))}
        </nav>
        <section className="media-results">
          <div className="media-results-heading">
            <strong>
              {currentFolder?.name ||
                (folder === 'unfiled' ? 'Unfiled' : 'All media')}
            </strong>
            <span>{filtered.length} images</span>
            {currentFolder && !onPick && (
              <>
                <button disabled={busy} onClick={() => open('rename-folder')}>
                  <Pencil size={15} />
                  Rename folder
                </button>
                <Tool
                  label="Delete folder"
                  disabled={busy}
                  onClick={() => {
                    setError('');
                    setDeleting('folder');
                  }}
                >
                  <Trash2 size={15} />
                </Tool>
              </>
            )}
            <select
              aria-label="Filter by tag"
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                setSelected(new Set());
              }}
            >
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option value={t} key={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {!onPick && (
            <div className="media-selection-bar">
              <label htmlFor="select-visible-media">
                <Checkbox
                  id="select-visible-media"
                  checked={
                    filtered.length > 0 && selectedVisible === filtered.length
                  }
                  indeterminate={
                    selectedVisible > 0 && selectedVisible < filtered.length
                  }
                  disabled={!filtered.length || busy}
                  onCheckedChange={(checked) =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      filtered.forEach((a) =>
                        checked ? next.add(a.id) : next.delete(a.id),
                      );
                      return next;
                    })
                  }
                />
                <span>
                  {selection.length
                    ? `${selection.length} selected`
                    : 'Select visible'}
                </span>
              </label>
              {selection.length > 0 && (
                <>
                  <Tool
                    label="Clear selection"
                    onClick={() => setSelected(new Set())}
                  >
                    <X size={16} />
                  </Tool>
                  <button disabled={busy} onClick={() => open('move')}>
                    <FolderInput size={16} />
                    Move
                  </button>
                  <button disabled={busy} onClick={() => open('tags')}>
                    <Tags size={16} />
                    Tags
                  </button>
                  <Tool
                    label="Delete selected images"
                    disabled={busy}
                    onClick={() => {
                      setError('');
                      setDeleting('assets');
                    }}
                  >
                    <Trash2 size={17} />
                  </Tool>
                </>
              )}
            </div>
          )}
          {error && !mode && !deleting && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {notice && <output className="media-notice">{notice}</output>}
          {filtered.length ? (
            <div
              className={
                display === 'grid' ? 'media-browser-grid' : 'media-browser-list'
              }
            >
              {filtered.map((a) => (
                <article
                  className={`media-entry ${selected.has(a.id) ? 'is-selected' : ''}`}
                  key={a.id}
                >
                  {!onPick && (
                    <Checkbox
                      aria-label={`Select ${a.name}`}
                      className="media-checkbox"
                      checked={selected.has(a.id)}
                      disabled={busy}
                      onCheckedChange={(checked) => toggle(a.id, checked)}
                    />
                  )}
                  <button
                    className="media-image-button"
                    aria-label={onPick ? `Add ${a.name}` : `Edit ${a.name}`}
                    onClick={() => (onPick ? onPick(a) : open('asset', a))}
                  >
                    <img loading="lazy" src={a.url} alt={a.name} />
                  </button>
                  <div className="media-entry-info">
                    <button
                      className="media-name"
                      onClick={() => (onPick ? onPick(a) : open('asset', a))}
                    >
                      {a.name}
                    </button>
                    <span className="media-dimensions">
                      {a.width} x {a.height} / {(a.bytes / 1024).toFixed(0)} KB
                    </span>
                    <span className="media-folder-name">
                      {folders.find((f) => f.id === a.folderId)?.name ||
                        'Unfiled'}
                    </span>
                    <div className="media-tags">
                      {(a.tags || []).map((t) => (
                        <button
                          key={t}
                          aria-label={`Filter tag ${t}`}
                          onClick={() => {
                            setTag(t);
                            setSelected(new Set());
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="small-empty">
              <Images size={32} />
              <p>
                {search || tag
                  ? 'No matching images.'
                  : 'No images in this folder.'}
              </p>
              <button
                onClick={() => uploadInput.current?.click()}
                disabled={busy}
              >
                <Upload size={16} />
                Upload images
              </button>
            </div>
          )}
        </section>
      </div>
      <Dialog
        open={!!mode}
        onOpenChange={(v) => {
          if (!v && !busy) setMode(null);
        }}
      >
        <DialogContent className="of-modal">
          <DialogTitle>{mode ? titles[mode] : 'Media'}</DialogTitle>
          <DialogDescription>
            {mode === 'tags'
              ? `${selection.length} images selected`
              : mode === 'asset'
                ? 'Name, folder, and tags'
                : mode === 'move'
                  ? `${selection.length} images selected`
                  : 'Media folder'}
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(save);
            }}
          >
            {(mode === 'folder' ||
              mode === 'rename-folder' ||
              mode === 'asset') && (
              <label>
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={mode === 'asset' ? 200 : 80}
                />
              </label>
            )}
            {(mode === 'move' || mode === 'asset') && (
              <label>
                Folder
                <select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">Unfiled</option>
                  {sortedFolders.map((f) => (
                    <option value={f.id} key={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mode === 'tags' && (
              <label>
                Action
                <select
                  value={tagAction}
                  onChange={(e) => setTagAction(e.target.value)}
                >
                  <option value="add">Add tags</option>
                  <option value="remove">Remove tags</option>
                </select>
              </label>
            )}
            {(mode === 'tags' || mode === 'asset') && (
              <label>
                Tags, separated by commas
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="lobby, summer, events"
                  maxLength={1230}
                  required={mode === 'tags'}
                />
              </label>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                <Check size={16} />
                Save
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v && !busy) setDeleting(null);
        }}
      >
        <AlertDialogContent className="of-modal">
          <AlertDialogTitle>
            {deleting === 'folder'
              ? `Delete ${currentFolder?.name}?`
              : `Delete ${selection.length} selected images?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deleting === 'folder'
              ? 'Only empty folders can be deleted.'
              : 'Images used by slides or published playlists cannot be deleted.'}
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="inline-error">
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
              onClick={() => run(remove)}
            >
              Delete
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
