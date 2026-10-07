const transition = (value) => ({
  type: value?.type || 'cut',
  durationMs:
    value?.type && value.type !== 'cut' ? (value.durationMs ?? 500) : 0,
});

/** Compare what plays, ignoring folders, tags, access, timestamps and entry IDs. */
export function publicationState(playlist) {
  if (!playlist.published) return 'draft';
  const entries = (items, speed = 1) =>
    items.map((item) => ({
      slideId: item.slide?.id || item.slideId,
      duration: Math.max(2, Math.min(3600, Math.round(item.duration / speed))),
      startsAt: item.scheduleEnabled === false ? null : item.startsAt || null,
      expiresAt: item.scheduleEnabled === false ? null : item.expiresAt || null,
    }));
  const draft = {
    name: playlist.name,
    transition: transition(playlist.transition),
    items: entries(playlist.items, playlist.fork?.speed || 1),
  };
  const published = {
    name: playlist.published.name,
    transition: transition(playlist.published.transition),
    items: entries(playlist.published.items),
  };
  return JSON.stringify(draft) === JSON.stringify(published)
    ? 'published'
    : 'changes';
}
