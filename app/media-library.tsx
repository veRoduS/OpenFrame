import type { MediaUploadBatch } from './media-uploads';
import { orderedTree, isWithin, indentedName } from './hierarchy';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { IconButton as Tool } from './components/ui/icon-button';
import { LibraryFilters } from './library-filters';
import './media-library.css';
import {
  Folder,
  FolderPlus,
  Images,
  Upload,
  Grid2X2,
  List,
  Pencil,
  Trash2,
  FolderInput,
  Tags,
  X,
  Check,
  ChevronDown,
  ChevronRight,
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
import { TagInput } from './tag-input';
import { ManageAccessButton } from './resource-access';

type FormMode = 'folder' | 'rename-folder' | 'asset' | 'move' | 'tags' | null;
export function MediaLibrary({
  assets,
  isAdmin = false,
  folders,
  onRefresh,
  onUpload,
  uploading = false,
  onPick,
  onManageAccess,
  shareWithSlideId,
}: {
  assets: Asset[];
  isAdmin?: boolean;
  folders: MediaFolder[];
  onRefresh: () => Promise<void>;
  onUpload: MediaUploadBatch;
  uploading?: boolean;
  onPick?: (asset: Asset) => void;
  onManageAccess?: (asset: Asset) => void;
  shareWithSlideId?: string;
}) {
  const [draggedAssets, setDraggedAssets] = useState<string[]>([]);
  const [draggedFolder, setDraggedFolder] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const routeParam = useCallback(
    (key: string, fallback = '') =>
      !onPick
        ? new URLSearchParams(location.search).get(key) || fallback
        : fallback,
    [onPick],
  );
  const [folder, setFolder] = useState(() => routeParam('folder', 'all'));
  const [search, setSearch] = useState(() => routeParam('q'));
  const [tag, setTag] = useState(() => routeParam('tag'));
  const [sort, setSort] = useState(() => routeParam('sort', 'newest'));
  const [display, setDisplay] = useState(() => routeParam('layout', 'grid'));
  const [foldersOpen, setFoldersOpen] = useState(false);
  useEffect(() => {
    if (onPick) return;
    const params = new URLSearchParams();
    for (const [key, value, fallback] of [
      ['folder', folder, 'all'],
      ['q', search, ''],
      ['tag', tag, ''],
      ['sort', sort, 'newest'],
      ['layout', display, 'grid'],
    ])
      if (value !== fallback) params.set(key, value);
    const route = '/dashboard/media' + (params.size ? `?${params}` : '');
    history.replaceState(history.state, '', route);
    try {
      sessionStorage.setItem('openframe.media.route', route);
    } catch {
      /* Storage is optional. */
    }
  }, [folder, search, tag, sort, display, onPick]);
  useEffect(() => {
    if (onPick) return;
    function restore() {
      if (location.pathname !== '/dashboard/media') return;
      setFolder(routeParam('folder', 'all'));
      setSearch(routeParam('q'));
      setTag(routeParam('tag'));
      setSort(routeParam('sort', 'newest'));
      setDisplay(routeParam('layout', 'grid'));
      setSelected(new Set());
    }
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [onPick, routeParam]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(),
  );
  const folderNavigationId = useId();
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
  const branches = new Set(
    folders.map((item) => item.parentId).filter(Boolean),
  );
  const visibleFolders = folderRows.filter(({ item }) => {
    let ancestor = item.parentId;
    const seen = new Set<string>();
    while (ancestor && !seen.has(ancestor)) {
      if (collapsedFolders.has(ancestor)) return false;
      seen.add(ancestor);
      ancestor = folders.find((entry) => entry.id === ancestor)?.parentId;
    }
    return true;
  });
  const currentFolderName =
    currentFolder?.name || (folder === 'unfiled' ? 'Unfiled' : 'All media');
  const currentFolderPath = currentFolder
    ? folderPaths.get(currentFolder.id)
    : currentFolderName;
  function toggleFolderBranch(id: string) {
    setCollapsedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const canDropMedia = () => !busy && !onPick && draggedAssets.length > 0;
  function dropMedia(target: string | null) {
    const ids = draggedAssets;
    const valid = canDropMedia();
    setDraggedAssets([]);
    setDropTarget(null);
    if (!valid) return;
    run(async () => {
      await api('/api/assets/batch', 'POST', { ids, folderId: target });
      await onRefresh();
      setSelected(new Set());
      setNotice(`Moved ${ids.length} media file${ids.length === 1 ? '' : 's'}`);
    });
  }
  function canDrop(target: string | null) {
    return (
      isAdmin &&
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
    setFoldersOpen(false);
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
      <LibraryFilters
        noun="Media"
        shown={filtered.length}
        total={assets.length}
        groups={[]}
        statuses={[]}
        filter={{ query: search, group: '', status: tag }}
        searchPlaceholder="Search images or tags"
        onChange={(next) => {
          setSearch(next.query);
          setTag(next.status);
          setSelected(new Set());
        }}
        filterControls={
          <label>
            Tags
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
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <div className="slide-library-tools">
          <label className="slide-sort-control">
            Sort by
            <select
              aria-label="Sort images"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
              <option value="largest">Largest first</option>
              <option value="smallest">Smallest first</option>
            </select>
          </label>
          <fieldset className="slide-view-controls" aria-label="Media view">
            <Tool
              label="List view"
              active={display === 'list'}
              onClick={() => setDisplay('list')}
            >
              <List size={18} />
            </Tool>
            <Tool
              label="Grid view"
              active={display === 'grid'}
              onClick={() => setDisplay('grid')}
            >
              <Grid2X2 size={18} />
            </Tool>
          </fieldset>
          {onPick && (
            <button
              className="primary"
              onClick={() => uploadInput.current?.click()}
              disabled={busy || uploading}
            >
              <Upload size={17} />
              Upload
            </button>
          )}
        </div>
      </LibraryFilters>
      <div className="media-upload-inputs">
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
        <input
          ref={uploadInput}
          id={onPick ? undefined : 'workspace-media-upload'}
          type="file"
          multiple
          accept="image/*"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            if (files.length)
              run(async () => {
                await onUpload(
                  files,
                  currentFolder?.id || null,
                  shareUpload ? shareWithSlideId : undefined,
                );
              });
          }}
        />
      </div>
      <div className="media-library-body">
        <div className="media-folder-sidebar">
          <button
            type="button"
            className="media-folder-picker"
            aria-label={`Choose media folder: ${currentFolderName}`}
            aria-expanded={foldersOpen}
            aria-controls={folderNavigationId}
            onClick={() => setFoldersOpen(!foldersOpen)}
          >
            <Folder size={18} />
            <span>{currentFolderName}</span>
            <ChevronDown size={18} />
          </button>
          {foldersOpen && currentFolder?.parentId && (
            <p className="mobile-folder-context">{currentFolderPath}</p>
          )}
          <nav
            id={folderNavigationId}
            className={`folder-navigation ${foldersOpen ? 'is-open' : ''}`}
            aria-label="Media folders"
          >
            <div className="folder-navigation-heading">
              <strong>Folders</strong>
              {isAdmin && !onPick && (
                <button
                  type="button"
                  onClick={() => open('folder')}
                  disabled={busy}
                >
                  <FolderPlus size={16} />
                  New folder
                </button>
              )}
            </div>
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
              className={`${folder === 'unfiled' ? 'chosen' : ''} ${dropTarget === 'unfiled' ? 'folder-drop-target' : ''}`}
              onDragOver={(event) => {
                if (canDropMedia()) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropTarget('unfiled');
                }
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) => {
                event.preventDefault();
                dropMedia(null);
              }}
              onClick={() => chooseFolder('unfiled')}
            >
              <Folder size={16} />
              <span>Unfiled</span>
              <small>{assets.filter((a) => !a.folderId).length}</small>
            </button>
            {visibleFolders.map(({ item: f, depth }) => (
              <div className="folder-tree-row" key={f.id}>
                {branches.has(f.id) && (
                  <button
                    type="button"
                    className="folder-branch-toggle"
                    style={{ left: depth * 16 }}
                    aria-label={`${collapsedFolders.has(f.id) ? 'Expand' : 'Collapse'} ${f.name}`}
                    aria-expanded={!collapsedFolders.has(f.id)}
                    onClick={() => toggleFolderBranch(f.id)}
                  >
                    {collapsedFolders.has(f.id) ? (
                      <ChevronRight size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </button>
                )}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-current={folder === f.id ? 'page' : undefined}
                        aria-label={`${f.name} ${assets.filter((asset) => asset.folderId === f.id).length}`}
                        className={`${folder === f.id ? 'chosen' : ''} ${dropTarget === f.id ? 'folder-drop-target' : ''}`}
                        style={
                          {
                            paddingLeft: 30 + depth * 16,
                            '--folder-depth': depth,
                          } as React.CSSProperties
                        }
                        title={folderPaths.get(f.id)}
                        draggable={isAdmin && !busy && !onPick}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            'application/x-openframe-folder',
                            f.id,
                          );
                          event.dataTransfer.effectAllowed = 'move';
                          setDraggedAssets([]);
                          setDraggedFolder(f.id);
                        }}
                        onDragEnd={() => {
                          setDraggedFolder(null);
                          setDropTarget(null);
                        }}
                        onDragOver={(event) => {
                          if (canDrop(f.id) || canDropMedia()) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setDropTarget(f.id);
                          }
                        }}
                        onDragLeave={() => setDropTarget(null)}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedAssets.length) dropMedia(f.id);
                          else dropFolder(f.id);
                        }}
                        onClick={() => chooseFolder(f.id)}
                      />
                    }
                  >
                    <Folder size={16} />
                    <span>{f.name}</span>
                    <small>
                      {assets.filter((a) => a.folderId === f.id).length}
                    </small>
                  </TooltipTrigger>
                  <TooltipContent>{folderPaths.get(f.id)}</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </nav>
        </div>
        <section className="media-results">
          <div className="media-results-heading">
            <div className="media-folder-title">
              <strong>{currentFolderName}</strong>
              {currentFolder?.parentId && (
                <span className="media-folder-path">{currentFolderPath}</span>
              )}
            </div>
            <span>{filtered.length} images</span>
            {isAdmin && currentFolder && !onPick && (
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
                    draggable={!busy && !onPick && !a.readOnly}
                    onDragStart={(event) => {
                      const ids = selected.has(a.id) ? selection : [a.id];
                      event.dataTransfer.setData(
                        'application/x-openframe-media',
                        JSON.stringify(ids),
                      );
                      event.dataTransfer.effectAllowed = 'move';
                      setDraggedFolder(null);
                      setDraggedAssets(ids);
                    }}
                    onDragEnd={() => {
                      setDraggedAssets([]);
                      setDropTarget(null);
                    }}
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
                    <img
                      draggable={false}
                      loading="lazy"
                      src={a.url}
                      alt={a.name}
                    />
                  </button>
                  <div className="media-entry-info">
                    <button
                      className="media-name"
                      title={a.name}
                      disabled={a.readOnly && !!onPick}
                      onClick={() => (onPick ? onPick(a) : open('asset', a))}
                    >
                      {a.name}
                    </button>
                    <span className="media-dimensions">
                      {a.width} x {a.height} / {(a.bytes / 1024).toFixed(0)} KB
                    </span>
                    <span
                      className="media-folder-name"
                      title={folderPaths.get(a.folderId || '') || 'Unfiled'}
                    >
                      {folders.find((f) => f.id === a.folderId)?.name ||
                        'Unfiled'}
                    </span>
                    {a.readOnly && (
                      <span className="badge">Shared / read-only</span>
                    )}
                    <div className="media-tags">
                      {(a.tags || []).slice(0, 1).map((t) => (
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
                      {(a.tags || []).length > 1 && (
                        <button
                          type="button"
                          aria-label={`Show all ${a.tags.length} tags for ${a.name}`}
                          onClick={() => open('asset', a)}
                        >
                          +{a.tags.length - 1}
                        </button>
                      )}
                    </div>
                  </div>
                  {!onPick && onManageAccess && !a.readOnly && (
                    <ManageAccessButton
                      maxTags={1}
                      resourceName={a.name}
                      tags={a.accessTags}
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
              {(search || tag) && (
                <button
                  onClick={() => {
                    setSearch('');
                    setTag('');
                  }}
                >
                  Clear filters
                </button>
              )}
              <button
                className="primary"
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
                Folder location
                <select
                  aria-label="Folder location"
                  value={parentDestination}
                  onChange={(e) => setParentDestination(e.target.value)}
                >
                  <option value="">Top level</option>
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
              <TagInput
                label="Tags, separated by commas"
                existingLabel={
                  mode === 'tags' && tagAction === 'remove'
                    ? 'Choose existing tags to remove'
                    : 'Choose existing tags to add'
                }
                existingTags={allTags}
                value={tags}
                onChange={setTags}
                disabled={readOnlyAsset}
                placeholder="lobby, summer, events"
                required={mode === 'tags'}
              />
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
