import { useState, type DragEvent } from 'react';
import {
  Folder,
  FolderPlus,
  Pencil,
  Shield,
  Trash2,
  Tags,
  X,
} from 'lucide-react';
import { api, type LibraryFolder, type LibraryOrganization } from './types';
import { orderedTree, indentedName, isWithin } from './hierarchy';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';
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
}: {
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
    try {
      const data = JSON.parse(event.dataTransfer.getData(dragType));
      if (data.kind !== kind) return;
      if (data.folderId) {
        const moved = folders.find((f) => f.id === data.folderId);
        if (!moved || moved.readOnly || target?.readOnly)
          throw new Error('Edit permission is required to move folders.');
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
  const allowDrop = (event: DragEvent) => {
    if (event.dataTransfer.types.includes(dragType) && !busy)
      event.preventDefault();
  };
  return (
    <section className="library-organization" aria-label={`Organize ${kind}`}>
      <div className="organization-tools">
        <details className="library-folder-menu">
          <summary
            onDragOver={allowDrop}
            onDragEnter={(event) => {
              (event.currentTarget.parentElement as HTMLDetailsElement).open =
                true;
            }}
          >
            <Folder size={16} />
            {filter.folder === 'all'
              ? 'All folders'
              : filter.folder === 'none'
                ? 'No folder'
                : folders.find((f) => f.id === filter.folder)?.name || 'Folder'}
          </summary>
          <div className="library-folder-tree">
            <button
              type="button"
              className="folder-filter-button"
              aria-pressed={filter.folder === 'all'}
              onClick={() => onFilter({ ...filter, folder: 'all' })}
            >
              All folders
            </button>
            <button
              type="button"
              className="folder-filter-button"
              aria-pressed={filter.folder === 'none'}
              onClick={() => onFilter({ ...filter, folder: 'none' })}
              onDragOver={allowDrop}
              onDrop={(e) => drop(e, null)}
            >
              No folder <span>Drop to move out</span>
            </button>
            {orderedTree(folders).map(({ item: f, depth }) => (
              <div
                key={f.id}
                className="library-folder-row"
                style={{ paddingLeft: depth * 18 }}
                onDragOver={allowDrop}
                onDrop={(e) => {
                  e.stopPropagation();
                  drop(e, f);
                }}
              >
                <button
                  type="button"
                  className="folder-filter-button"
                  aria-pressed={filter.folder === f.id}
                  onClick={() => onFilter({ ...filter, folder: f.id })}
                  draggable={!f.readOnly && !busy}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      dragType,
                      JSON.stringify({ kind, folderId: f.id }),
                    );
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  <Folder size={14} />
                  <span>{f.name}</span>
                </button>
                {!f.pathOnly && (
                  <>
                    <button
                      type="button"
                      className="icon-button"
                      title={`Access to ${f.name}`}
                      aria-label={`Access to ${f.name}`}
                      onClick={() => onAccess(f)}
                    >
                      <Shield size={14} />
                    </button>
                  </>
                )}
                {!f.readOnly && (
                  <>
                    <button
                      type="button"
                      className="icon-button"
                      title={`Edit folder ${f.name}`}
                      aria-label={`Edit folder ${f.name}`}
                      onClick={() => setFolder(f)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title={`Delete folder ${f.name}`}
                      aria-label={`Delete folder ${f.name}`}
                      onClick={() => setDeleting(f)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            ))}
            <button
              type="button"
              className="folder-filter-button"
              disabled={busy}
              onClick={() => setFolder('new')}
            >
              <FolderPlus size={16} />
              New folder
            </button>
            <p>
              Drag items here to move them. Folders include their subfolders
              when filtering.
            </p>
          </div>
        </details>
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
            <span className="selection-count">{selection.length} selected</span>
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
                  defaultValue={folder === 'new' ? '' : folder.parentId || ''}
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
            <label>
              Add tags
              <input name="add" placeholder="safety, announcements" />
            </label>
            <label>
              Remove tags
              <input name="remove" placeholder="Separate tags with commas" />
            </label>
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
