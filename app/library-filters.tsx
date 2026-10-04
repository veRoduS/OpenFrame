import { useId, useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
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
  children,
}: {
  filter: LibraryFilter;
  onChange: (filter: LibraryFilter) => void;
  groups: Group[];
  statuses: { value: string; label: string }[];
  shown: number;
  total: number;
  noun: string;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const controlsId = useId();
  const active = Number(!!filter.group) + Number(!!filter.status);
  return (
    <section className="library-filters" aria-label={`${noun} filters`}>
      <label className="library-search">
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
      <button
        type="button"
        className="library-filter-toggle"
        aria-expanded={expanded}
        aria-controls={controlsId}
        onClick={() => setExpanded(!expanded)}
      >
        <SlidersHorizontal size={17} /> Filters{active ? ` (${active})` : ''}
      </button>
      <div
        id={controlsId}
        className={`library-filter-options ${expanded ? 'is-open' : ''}`}
      >
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
      </div>
      <div className="library-filter-meta">
        <output>
          Showing {shown} of {total} {noun.toLowerCase()}
        </output>
        <button
          type="button"
          className="library-filter-reset"
          disabled={!filter.query && !filter.group && !filter.status}
          onClick={() => onChange({ ...clearLibraryFilter })}
        >
          Clear filters
        </button>
        {children}
      </div>
    </section>
  );
}
