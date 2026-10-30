import { useEffect, useState } from 'react';
import type { Site } from '../types';

const keyFor = (userId: string, kind: string) =>
  `openframe.site-filter.${userId}.${kind}`;
export function clearSiteFilters(userId?: string) {
  if (!userId) return;
  try {
    for (const kind of ['screens', 'metrics', 'preview'])
      sessionStorage.removeItem(keyFor(userId, kind));
  } catch {
    /* Storage can be unavailable. */
  }
}
export function useSiteFilter(
  kind: 'screens' | 'metrics' | 'preview',
  userId: string | undefined,
  sites: Site[] | undefined,
) {
  const [selection, setSelection] = useState({ userId, value: '' });
  const valid = (value: string) =>
    !value ||
    (kind !== 'preview' && value === 'unassigned') ||
    !!sites?.some(
      (site) => site.id === value && (kind !== 'preview' || !site.archivedAt),
    );
  useEffect(() => {
    if (!userId) {
      setSelection((current) =>
        current.userId !== undefined || current.value
          ? { userId: undefined, value: '' }
          : current,
      );
      return;
    }
    if (!sites) return;
    let value = '';
    try {
      value = sessionStorage.getItem(keyFor(userId, kind)) || '';
      if (
        value &&
        !(kind !== 'preview' && value === 'unassigned') &&
        !sites.some(
          (site) =>
            site.id === value && (kind !== 'preview' || !site.archivedAt),
        )
      ) {
        sessionStorage.removeItem(keyFor(userId, kind));
        value = '';
      }
    } catch {
      /* Keep All sites when storage is unavailable. */
    }
    setSelection({ userId, value });
  }, [kind, userId, sites]);
  const setValue = (value: string) => {
    const next = valid(value) ? value : '';
    setSelection({ userId, value: next });
    if (userId)
      try {
        sessionStorage.setItem(keyFor(userId, kind), next);
      } catch {
        /* In-memory selection still works. */
      }
  };
  return [
    selection.userId === userId && userId ? selection.value : '',
    setValue,
  ] as const;
}
