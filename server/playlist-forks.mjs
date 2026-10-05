import { randomUUID } from 'node:crypto';

/** Entries, rather than slide IDs, keep repeated slides independent. */
export function composeFork(playlist, master) {
  if (!master?.published || !master.publishedEntries)
    throw new Error('Publish the master playlist first');
  const saved = new Map(
    playlist.items
      .filter((i) => i.sourceEntryId)
      .map((i) => [i.sourceEntryId, i]),
  );
  const inherited = master.publishedEntries.map((source) => {
    const override = saved.get(source.id);
    return {
      ...source,
      id: source.id,
      sourceEntryId: source.id,
      duration: override?.durationOverride
        ? override.duration
        : source.duration,
      durationOverride: !!override?.durationOverride,
      masterDuration: source.duration,
    };
  });
  const local = playlist.items.filter((i) => !i.sourceEntryId);
  if (
    new Set([...inherited, ...local].map((i) => i.id)).size !==
    inherited.length + local.length
  )
    throw new Error('Local entries conflict with master entry IDs');
  if (inherited.length + local.length > 200)
    throw new Error('A fork cannot contain more than 200 slides');
  if (playlist.fork.order === 'custom') {
    const available = new Map([...inherited, ...local].map((i) => [i.id, i]));
    const result = [];
    for (const entry of playlist.items)
      if (available.has(entry.id)) {
        result.push(available.get(entry.id));
        available.delete(entry.id);
      }
    return [...result, ...available.values()];
  }
  const result = [];
  for (const entry of inherited) {
    result.push(entry);
    result.push(...local.filter((i) => i.afterEntryId === entry.id));
  }
  const placed = new Set(result.map((i) => i.id));
  return [...result, ...local.filter((i) => !placed.has(i.id))];
}

export function identifyEntries(items, previous = []) {
  const used = new Set();
  return items.map((item, index) => {
    const id =
      item.id ||
      (previous[index]?.slideId === item.slideId ? previous[index].id : null) ||
      randomUUID();
    if (used.has(id))
      throw new Error('Playlist entries must have distinct IDs');
    used.add(id);
    return { ...item, id };
  });
}
