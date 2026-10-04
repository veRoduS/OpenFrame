import { orderedTree, isWithin, indentedName } from './hierarchy';
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
import { ManageAccessButton } from './resource-access';

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
  onManageAccess,
  shareWithSlideId,
}: {
  assets: Asset[];
  folders: MediaFolder[];
  onRefresh: () => Promise<void>;
  onUpload: (
    file: File,
    folderId?: string | null,
    shareWithSlideId?: string,
  ) => Promise<Asset>;
  onPick?: (asset: Asset) => void;
  onManageAccess?: (asset: Asset) => void;
  shareWithSlideId?: string;
}) {
  const [draggedFolder, setDraggedFolder] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
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
  const [parentDestination, setParentDestination] = useState('');
  const [deleting, setDeleting] = useState<'assets' | 'folder' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [shareUpload, setShareUpload] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const filtered = visibleMedia(assets, {
    folder,
    search,
    tag,
    sort,
  }) as Asset[];
  const selection = assets
    .filter((a) => selected.has(a.id) && !a.readOnly)
    .map((a) => a.id);
  const currentFolder = folders.find((f) => f.id === folder);
  const allTags = [...new Set(assets.flatMap((a) => a.tags || []))].sort();
  const folderPaths = new Map<string, string>();
  function folderPath(id: string, seen = new Set<string>()): string {
    if (seen.has(id)) return '';
    seen.add(id);
    const item = folders.find((entry) => entry.id === id);
    if (!item) return '';
    return [item.parentId ? folderPath(item.parentId, seen) : '', item.name]
      .filter(Boolean)
      .join(' / ');
  }
  folders.forEach((item) => folderPaths.set(item.id, folderPath(item.id)));
  const isDescendant = (candidateId: string, ancestorId: string) =>
    isWithin(folders, candidateId, ancestorId);
  const folderRows = orderedTree(folders);
  const sortedFolders = folderRows.map(({ item }) => item);
  function canDrop(target: string | null) {
    return (
      !busy &&
      !onPick &&
      !!draggedFolder &&
      (target || null) !==
        (folders.find((f) => f.id === draggedFolder)?.parentId || null) &&
      (!target || !isWithin(folders, target, draggedFolder))
    );
  }
  function dropFolder(target: string | null) {
    const item = folders.find((entry) => entry.id === draggedFolder);
    const valid = canDrop(target);
    setDraggedFolder(null);
    setDropTarget(null);
    if (!item || !valid) return;
    run(async () => {
      await api(`/api/folders/${item.id}`, 'PUT', {
        name: item.name,
        parentId: target,
      });
      await onRefresh();
      setNotice(`Moved ${item.name}`);
    });
  }
  const selectableVisible = filtered.filter((a) => !a.readOnly);
  const selectedVisible = selectableVisible.filter((a) =>
    selected.has(a.id),
  ).length;
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
    setParentDestination(
      mode === 'folder'
        ? currentFolder?.id || ''
        : currentFolder?.parentId || '',
    );
  }
  async function save() {
    if (mode === 'folder') {
      const created = await api<MediaFolder>('/api/folders', 'POST', {
        name,
        parentId: parentDestination || null,
      });
      setFolder(created.id);
      setSelected(new Set());
    } else if (mode === 'rename-folder')
      await api(`/api/folders/${folder}`, 'PUT', {
        name,
        parentId: parentDestination || null,
      });
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
    'rename-folder': 'Edit folder',
    asset: 'Image details',
    move: 'Move selected images',
    tags: 'Tag selected images',
  };
  const readOnlyAsset = mode === 'asset' && !!activeAsset?.readOnly;
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
        {onPick && shareWithSlideId && (
          <label className="media-share-upload">
            <input
              type="checkbox"
              checked={shareUpload}
              onChange={(event) => setShareUpload(event.target.checked)}
            />
            Share uploaded images with this slide’s audience
          </label>
        )}
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
                  await onUpload(
                    file,
                    currentFolder?.id || null,
                    shareUpload ? shareWithSlideId : undefined,
                  );
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
            className={`${folder === 'all' ? 'chosen' : ''} ${dropTarget === 'root' ? 'folder-drop-target' : ''}`}
            onDragOver={(event) => {
              if (canDrop(null)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget('root');
              }
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(event) => {
              event.preventDefault();
              dropFolder(null);
            }}
            title={draggedFolder ? 'Move folder to top level' : undefined}
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
          {folderRows.map(({ item: f, depth }) => (
            <button
              key={f.id}
              className={`${folder === f.id ? 'chosen' : ''} ${dropTarget === f.id ? 'folder-drop-target' : ''}`}
              style={{ paddingLeft: 12 + depth * 18 }}
              title={folderPaths.get(f.id)}
              draggable={!busy && !onPick}
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  'application/x-openframe-folder',
                  f.id,
                );
                event.dataTransfer.effectAllowed = 'move';
                setDraggedFolder(f.id);
              }}
              onDragEnd={() => {
                setDraggedFolder(null);
                setDropTarget(null);
              }}
              onDragOver={(event) => {
                if (canDrop(f.id)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropTarget(f.id);
                }
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) => {
                event.preventDefault();
                dropFolder(f.id);
              }}
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
                  Edit folder
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
                    selectableVisible.length > 0 &&
                    selectedVisible === selectableVisible.length
                  }
                  indeterminate={
                    selectedVisible > 0 &&
                    selectedVisible < selectableVisible.length
                  }
                  disabled={!selectableVisible.length || busy}
                  onCheckedChange={(checked) =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      selectableVisible.forEach((a) =>
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
                      disabled={busy || a.readOnly}
                      onCheckedChange={(checked) => toggle(a.id, checked)}
                    />
                  )}
                  <button
                    className="media-image-button"
                    aria-label={
                      onPick
                        ? `Add ${a.name}`
                        : a.readOnly
                          ? `View ${a.name}`
                          : `Edit ${a.name}`
                    }
                    onClick={() => (onPick ? onPick(a) : open('asset', a))}
                  >
                    <img loading="lazy" src={a.url} alt={a.name} />
                  </button>
                  <div className="media-entry-info">
                    <button
                      className="media-name"
                      disabled={a.readOnly && !!onPick}
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
                    {a.readOnly && (
                      <span className="badge">Shared / read-only</span>
                    )}
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
                  {!onPick && onManageAccess && !a.readOnly && (
                    <ManageAccessButton
                      resourceName={a.name}
                      onClick={() => onManageAccess(a)}
                    />
                  )}
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
            {readOnlyAsset
              ? 'This image is shared through content and is read-only.'
              : mode === 'tags'
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
                  disabled={readOnlyAsset}
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
                  disabled={readOnlyAsset}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">Unfiled</option>
                  {sortedFolders.map((f) => (
                    <option value={f.id} key={f.id}>
                      {indentedName(
                        f.name,
                        folderRows.find((row) => row.item.id === f.id)?.depth ||
                          0,
                      )}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(mode === 'folder' || mode === 'rename-folder') && (
              <label>
                Parent folder
                <select
                  value={parentDestination}
                  onChange={(e) => setParentDestination(e.target.value)}
                >
                  <option value="">No parent</option>
                  {sortedFolders
                    .filter(
                      (f) =>
                        mode !== 'rename-folder' ||
                        (f.id !== folder && !isDescendant(f.id, folder)),
                    )
                    .map((f) => (
                      <option value={f.id} key={f.id}>
                        {indentedName(
                          f.name,
                          folderRows.find((row) => row.item.id === f.id)
                            ?.depth || 0,
                        )}
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
                  disabled={readOnlyAsset}
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
              {!readOnlyAsset && (
                <button className="primary" disabled={busy}>
                  <Check size={16} />
                  Save
                </button>
              )}
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
              ? 'A folder must have no images or subfolders before it can be deleted.'
              : 'Slides and published playlists will show a “Removed media” placeholder wherever these images were used.'}
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
