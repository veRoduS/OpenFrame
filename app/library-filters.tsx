import { indentedName, isWithin, orderedTree } from './hierarchy';

type Group = { id: string; name: string; parentId?: string | null };
export type LibraryFilter = { query: string; group: string; status: string };
export const clearLibraryFilter: LibraryFilter = {
  query: '',
  group: '',
  status: '',
};
export function matchesLibraryFilter(
  item: { name: string; groupIds?: string[] },
  filter: LibraryFilter,
  groups: Group[],
  status: string,
) {
  return (
    item.name
      .toLocaleLowerCase()
      .includes(filter.query.trim().toLocaleLowerCase()) &&
    (!filter.status || filter.status === status) &&
    (!filter.group ||
      (filter.group === 'ungrouped'
        ? !item.groupIds?.length
        : item.groupIds?.some((id) => isWithin(groups, id, filter.group))))
  );
}
export function LibraryFilters({
  filter,
  onChange,
  groups,
  statuses,
  shown,
  total,
  noun,
}: {
  filter: LibraryFilter;
  onChange: (filter: LibraryFilter) => void;
  groups: Group[];
  statuses: { value: string; label: string }[];
  shown: number;
  total: number;
  noun: string;
}) {
  return (
    <section className="library-filters" aria-label={`${noun} filters`}>
      <label>
        Search {noun.toLowerCase()}
        <input
          aria-label={`Search ${noun.toLowerCase()}`}
          type="search"
          value={filter.query}
          placeholder="Search by name"
          onChange={(event) =>
            onChange({ ...filter, query: event.target.value })
          }
        />
      </label>
      <label>
        Group
        <select
          aria-label="Group"
          value={filter.group}
          onChange={(event) =>
            onChange({ ...filter, group: event.target.value })
          }
        >
          <option value="">All groups</option>
          <option value="ungrouped">No visible group</option>
          {orderedTree(groups).map(({ item, depth }) => (
            <option key={item.id} value={item.id}>
              {indentedName(item.name, depth)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select
          aria-label="Status"
          value={filter.status}
          onChange={(event) =>
            onChange({ ...filter, status: event.target.value })
          }
        >
          <option value="">All statuses</option>
          {statuses.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!filter.query && !filter.group && !filter.status}
        onClick={() => onChange({ ...clearLibraryFilter })}
      >
        Clear filters
      </button>
      <output>
        Showing {shown} of {total} {noun.toLowerCase()}
      </output>
    </section>
  );
}
