import {
  useId,
  useState,
  type DragEvent,
  type ReactNode,
  type CSSProperties,
} from 'react';
import {
  Folder,
  ChevronDown,
  ChevronRight,
  LayoutTemplate,
  ListVideo,
  FolderPlus,
  Pencil,
  Shield,
  Trash2,
  Tags,
  X,
} from 'lucide-react';
import { api, type LibraryFolder, type LibraryOrganization } from './types';
import { orderedTree, indentedName, isWithin } from './hierarchy';
import { TagInput } from './tag-input';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';
import './media-library.css';
import './library-organization.css';

export type OrganizationFilter = { folder: string; tag: string };
type Item = LibraryOrganization & { id: string; name: string };
type Group = {
  id: string;
  name: string;
  parentId?: string | null;
  directMember?: boolean;
};
const dragType = 'application/x-openframe-library';

export function startLibraryDrag(
  event: DragEvent,
  kind: string,
  ids: string[],
) {
  event.dataTransfer.setData(dragType, JSON.stringify({ kind, ids }));
  event.dataTransfer.effectAllowed = 'move';
}
export function matchesOrganization(
  item: Item,
  filter: OrganizationFilter,
  folders: LibraryFolder[],
) {
  return (
    (filter.folder === 'all' ||
      (filter.folder === 'none'
        ? !item.folderId
        : !!item.folderId &&
          isWithin(folders, item.folderId, filter.folder))) &&
    (!filter.tag || (item.tags || []).includes(filter.tag))
  );
}

export function LibraryOrganizationToolbar({
  kind,
  items,
  folders,
  groups,
  isAdmin,
  filter,
  onFilter,
  selected,
  onSelect,
  refresh,
  onAccess,
  children,
}: {
  children: ReactNode;
  kind: 'slides' | 'playlists';
  items: Item[];
  folders: LibraryFolder[];
  groups: Group[];
  isAdmin: boolean;
  filter: OrganizationFilter;
  onFilter: (filter: OrganizationFilter) => void;
  selected: string[];
  onSelect: (ids: string[]) => void;
  refresh: () => Promise<void>;
  onAccess: (folder: LibraryFolder) => void;
}) {
  const [error, setError] = useState('');
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [draggedFolder, setDraggedFolder] = useState<string | null>(null);
  const navigationId = useId();
  const currentFolder = folders.find((f) => f.id === filter.folder);
  const currentName =
    currentFolder?.name ||
    (filter.folder === 'none' ? 'Unfiled' : `All ${kind}`);
  const rows = orderedTree(folders);
  const branches = new Set(folders.map((f) => f.parentId).filter(Boolean));
  const paths = new Map<string, string>();
  const visible = rows.filter(({ item }) => {
    let id = item.parentId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      if (collapsed.has(id)) return false;
      seen.add(id);
      id = folders.find((f) => f.id === id)?.parentId || null;
    }
    return true;
  });
  for (const { item } of rows) {
    paths.set(
      item.id,
      [paths.get(item.parentId || ''), item.name].filter(Boolean).join(' / '),
    );
  }
  function choose(value: string) {
    onFilter({ ...filter, folder: value });
    setFoldersOpen(false);
  }
  function toggle(id: string, expand = false) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (expand || next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const LibraryIcon = kind === 'slides' ? LayoutTemplate : ListVideo;
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState<LibraryFolder | 'new' | null>(null);
  const [organize, setOrganize] = useState(false);
  const [deleting, setDeleting] = useState<LibraryFolder | null>(null);
  const tags = [...new Set(items.flatMap((item) => item.tags || []))].sort();
  const selection = selected.filter((id) =>
    items.some((item) => item.id === id && !item.readOnly),
  );
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function drop(event: DragEvent, target: LibraryFolder | null) {
    event.preventDefault();
    setDropTarget(null);
    if (busy) return;
    try {
      const data = JSON.parse(event.dataTransfer.getData(dragType));
      if (data.kind !== kind) return;
      if (data.folderId) {
        const moved = folders.find((f) => f.id === data.folderId);
        if (!isAdmin || !moved || moved.readOnly || target?.readOnly)
          throw new Error('Edit permission is required to move folders.');
        if (target && isWithin(folders, target.id, moved.id))
          throw new Error(
            'A folder cannot contain itself or one of its enclosing folders.',
          );
        if ((moved.parentId || null) === (target?.id || null)) return;
        void run(async () => {
          await api(`/api/library-folders/${kind}/${moved.id}`, 'PUT', {
            ...moved,
            parentId: target?.id || null,
          });
        });
      } else if (Array.isArray(data.ids)) {
        void run(async () => {
          await api(`/api/organization/${kind}`, 'POST', {
            ids: data.ids,
            folderId: target?.id || null,
          });
        });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const allowDrop = (event: DragEvent, target: string) => {
    if (event.dataTransfer.types.includes(dragType) && !busy) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(target);
    }
  };
  return (
    <section className="library-organization" aria-label={`Organize ${kind}`}>
      <div className="media-library-body library-browser-body">
        <div className="media-folder-sidebar">
          <button
            type="button"
            className="media-folder-picker"
            aria-label={`Choose ${kind} folder: ${currentName}`}
            aria-expanded={foldersOpen}
            aria-controls={navigationId}
            onClick={() => setFoldersOpen(!foldersOpen)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(dragType)) {
                event.preventDefault();
                setFoldersOpen(true);
              }
            }}
          >
            <Folder size={18} />
            <span>{currentName}</span>
            <ChevronDown size={18} />
          </button>
          {foldersOpen && currentFolder?.parentId && (
            <p className="mobile-folder-context">
              {paths.get(currentFolder.id)}
            </p>
          )}
          <nav
            id={navigationId}
            className={`folder-navigation ${foldersOpen ? 'is-open' : ''}`}
            aria-label={`${kind === 'slides' ? 'Slide' : 'Playlist'} folders`}
          >
            <div className="folder-navigation-heading">
              <strong>Folders</strong>
              {isAdmin && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setFolder('new')}
                >
                  <FolderPlus size={16} />
                  New folder
                </button>
              )}
            </div>
            <button
              type="button"
              className={`${filter.folder === 'all' ? 'chosen' : ''} ${dropTarget === 'all' ? 'folder-drop-target' : ''}`}
              aria-current={filter.folder === 'all' ? 'page' : undefined}
              onClick={() => choose('all')}
              onDragOver={(event) => allowDrop(event, 'all')}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) => drop(event, null)}
              title="Drop a folder to move it to the top level"
            >
              <LibraryIcon size={16} />
              <span>All {kind}</span>
              <small>{items.length}</small>
            </button>
            <button
              type="button"
              className={`${filter.folder === 'none' ? 'chosen' : ''} ${dropTarget === 'none' ? 'folder-drop-target' : ''}`}
              aria-current={filter.folder === 'none' ? 'page' : undefined}
              onClick={() => choose('none')}
              onDragOver={(event) => allowDrop(event, 'none')}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) => drop(event, null)}
            >
              <Folder size={16} />
              <span>Unfiled</span>
              <small>{items.filter((item) => !item.folderId).length}</small>
            </button>
            {visible.map(({ item: f, depth }) => (
              <div className="folder-tree-row" key={f.id}>
                {branches.has(f.id) && (
                  <button
                    type="button"
                    className="folder-branch-toggle"
                    style={{ left: depth * 16 }}
                    aria-label={`${collapsed.has(f.id) ? 'Expand' : 'Collapse'} ${f.name}`}
                    aria-expanded={!collapsed.has(f.id)}
                    onClick={() => toggle(f.id)}
                  >
                    {collapsed.has(f.id) ? (
                      <ChevronRight size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  className={`${filter.folder === f.id ? 'chosen' : ''} ${dropTarget === f.id ? 'folder-drop-target' : ''}`}
                  aria-label={f.name}
                  aria-current={filter.folder === f.id ? 'page' : undefined}
                  title={paths.get(f.id)}
                  style={
                    {
                      paddingLeft: 30 + depth * 16,
                      '--folder-depth': depth,
                    } as CSSProperties
                  }
                  onClick={() => choose(f.id)}
                  draggable={isAdmin && !f.readOnly && !busy}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      dragType,
                      JSON.stringify({ kind, folderId: f.id }),
                    );
                    event.dataTransfer.effectAllowed = 'move';
                    setDraggedFolder(f.id);
                  }}
                  onDragEnd={() => {
                    setDropTarget(null);
                    setDraggedFolder(null);
                  }}
                  onDragOver={(event) =>
                    (!draggedFolder ||
                      (!f.readOnly &&
                        !isWithin(folders, f.id, draggedFolder))) &&
                    allowDrop(event, f.id)
                  }
                  onDragEnter={(event) => {
                    if (event.dataTransfer.types.includes(dragType))
                      toggle(f.id, true);
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(event) => drop(event, f)}
                >
                  <Folder size={16} />
                  <span>{f.name}</span>
                  <small>
                    {items.filter((item) => item.folderId === f.id).length}
                  </small>
                </button>
              </div>
            ))}
          </nav>
        </div>
        <div className="library-results">
          <div className="media-results-heading library-results-heading">
            <div className="media-folder-title">
              <strong>{currentName}</strong>
              {currentFolder?.parentId && (
                <span className="media-folder-path">
                  {paths.get(currentFolder.id)}
                </span>
              )}
            </div>
            {isAdmin && currentFolder && !currentFolder.pathOnly && (
              <button
                type="button"
                className="icon-button"
                title={`Access to ${currentFolder.name}`}
                aria-label={`Access to ${currentFolder.name}`}
                onClick={() => onAccess(currentFolder)}
              >
                <Shield size={16} />
              </button>
            )}
            {isAdmin && currentFolder && !currentFolder.readOnly && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setFolder(currentFolder)}
                >
                  <Pencil size={15} />
                  Edit folder
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={busy}
                  title={`Delete folder ${currentFolder.name}`}
                  aria-label={`Delete folder ${currentFolder.name}`}
                  onClick={() => setDeleting(currentFolder)}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
          <div className="organization-tools">
            <label className="organization-tag-filter">
              <Tags size={16} />
              <select
                aria-label={`Filter ${kind} by tag`}
                value={filter.tag}
                onChange={(e) => onFilter({ ...filter, tag: e.target.value })}
              >
                <option value="">All tags</option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
            {(filter.folder !== 'all' || filter.tag) && (
              <button
                type="button"
                className="icon-button"
                aria-label="Clear folder and tag filters"
                onClick={() => onFilter({ folder: 'all', tag: '' })}
              >
                <X size={16} />
              </button>
            )}
            {!!selection.length && (
              <>
                <span className="selection-count">
                  {selection.length} selected
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOrganize(true)}
                >
                  <Tags size={16} />
                  Move / tag
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Clear selection"
                  onClick={() => onSelect([])}
                >
                  <X size={16} />
                </button>
              </>
            )}
          </div>
          {children}
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <Dialog
        open={!!folder}
        onOpenChange={(open) => !open && !busy && setFolder(null)}
      >
        <DialogContent className="of-modal">
          <DialogTitle>
            {folder === 'new' ? 'New folder' : 'Edit folder'}
          </DialogTitle>
          <DialogDescription>
            Folders organize this library. Moving content does not change its
            access.
          </DialogDescription>
          {folder && (
            <form
              className="organization-form"
              key={folder === 'new' ? 'new' : folder.id}
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void run(async () => {
                  await api(
                    `/api/library-folders/${kind}${folder === 'new' ? '' : `/${folder.id}`}`,
                    folder === 'new' ? 'POST' : 'PUT',
                    {
                      ...(folder === 'new' ? {} : folder),
                      name: data.get('name'),
                      parentId: data.get('folder') || null,
                      ...(folder === 'new'
                        ? { managingGroupId: data.get('group') || null }
                        : {}),
                    },
                  );
                  setFolder(null);
                });
              }}
            >
              <label>
                Name
                <input
                  name="name"
                  required
                  maxLength={80}
                  defaultValue={folder === 'new' ? '' : folder.name}
                />
              </label>
              <label>
                Inside folder
                <select
                  name="folder"
                  defaultValue={
                    folder === 'new'
                      ? currentFolder?.id || ''
                      : folder.parentId || ''
                  }
                >
                  <option value="">Top level</option>
                  {orderedTree(folders)
                    .filter(
                      ({ item }) =>
                        (!item.readOnly ||
                          (folder !== 'new' && item.id === folder.parentId)) &&
                        (folder === 'new' ||
                          !isWithin(folders, item.id, folder.id)),
                    )
                    .map(({ item, depth }) => (
                      <option key={item.id} value={item.id}>
                        {indentedName(item.name, depth)}
                      </option>
                    ))}
                </select>
              </label>
              {folder === 'new' && (
                <label>
                  Managing group
                  <select name="group">
                    <option value="">Personal folder</option>
                    {orderedTree(groups)
                      .filter(({ item }) => isAdmin || item.directMember)
                      .map(({ item, depth }) => (
                        <option key={item.id} value={item.id}>
                          {indentedName(item.name, depth)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                Save folder
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={organize}
        onOpenChange={(open) => !open && !busy && setOrganize(false)}
      >
        <DialogContent className="of-modal">
          <DialogTitle>
            Organize {selection.length}{' '}
            {kind === 'slides' ? 'slide(s)' : 'playlist(s)'}
          </DialogTitle>
          <DialogDescription>
            Apply folders and tags to your selected items. Access stays the
            same.
          </DialogDescription>
          <form
            className="organization-form"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const location = data.get('folder') as string;
              const parse = (name: string) =>
                ((data.get(name) as string) || '')
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean);
              void run(async () => {
                await api(`/api/organization/${kind}`, 'POST', {
                  ids: selection,
                  ...(location !== 'keep'
                    ? { folderId: location || null }
                    : {}),
                  addTags: parse('add'),
                  removeTags: parse('remove'),
                });
                onSelect([]);
                setOrganize(false);
              });
            }}
          >
            <label>
              Move to folder
              <select name="folder" defaultValue="keep">
                <option value="keep">Keep current folders</option>
                <option value="">No folder</option>
                {orderedTree(folders).map(({ item, depth }) => (
                  <option key={item.id} value={item.id}>
                    {indentedName(item.name, depth)}
                  </option>
                ))}
              </select>
            </label>
            <TagInput
              label="Add tags"
              existingLabel="Choose existing tags to add"
              existingTags={tags}
              name="add"
              placeholder="safety, announcements"
            />
            <TagInput
              label="Remove tags"
              existingLabel="Choose existing tags to remove"
              existingTags={tags}
              name="remove"
            />
            <p className="muted">
              Up to 30 tags per item, 40 characters each. Tags are shared within
              this library.
            </p>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy || !selection.length}>
              Apply changes
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => !open && !busy && setDeleting(null)}
      >
        <DialogContent className="of-modal">
          <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
          <DialogDescription>
            Move its items and subfolders out first.
          </DialogDescription>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api(
                  `/api/library-folders/${kind}/${deleting!.id}`,
                  'DELETE',
                );
                if (filter.folder === deleting!.id)
                  onFilter({ ...filter, folder: 'all' });
                setDeleting(null);
              })
            }
          >
            Delete folder
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function OrganizationTags({ item }: { item: Item }) {
  return (item.tags || []).length ? (
    <div className="library-item-tags" aria-label={`Tags for ${item.name}`}>
      {item.tags!.slice(0, 3).map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </div>
  ) : null;
}
