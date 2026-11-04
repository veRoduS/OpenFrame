// Derive associations from the caller's visible library; this never grants access.
export function siteContentIds(library, selection) {
  if (!selection)
    return Object.fromEntries(
      ['slides', 'playlists', 'assets'].map((kind) => [
        kind,
        new Set((library[kind] || []).map((item) => item.id)),
      ]),
    );
  const groups = new Map((library.groups || []).map((g) => [g.id, g]));
  const within = (id, ancestor) => {
    const visited = new Set();
    while (id && !visited.has(id)) {
      if (id === ancestor) return true;
      visited.add(id);
      id = groups.get(id)?.parentId;
    }
    return false;
  };
  const related = (item, group) =>
    group &&
    [
      ...(item.groupIds || []),
      ...(item.accessTags || [])
        .filter((t) => t.type === 'group')
        .map((t) => t.id),
      item.managingGroupId,
    ]
      .filter(Boolean)
      .some((id) => within(id, group) || within(group, id));
  const combined = {
    slides: new Set(),
    playlists: new Set(),
    assets: new Set(),
  };
  let selected;
  for (const site of (library.sites || []).filter(
    (site) => selection === 'unassigned' || site.id === selection,
  )) {
    const ids = { slides: new Set(), playlists: new Set(), assets: new Set() };
    for (const kind of ['slides', 'playlists', 'assets'])
      for (const item of library[kind] || [])
        if (related(item, site.accessGroupId)) ids[kind].add(item.id);
    for (const screen of library.devices || []) {
      const assigned =
        screen.siteId ||
        (library.sites || []).find(
          (s) => s.siteNumber === screen.requestedSiteNumber,
        )?.id;
      if (assigned === site.id && screen.playlistId)
        ids.playlists.add(screen.playlistId);
    }
    const includeMedia = (slide) => {
      for (const layer of slide?.layers || [])
        if (layer.assetId && !layer.removedMedia) ids.assets.add(layer.assetId);
    };
    for (const playlist of library.playlists || [])
      if (ids.playlists.has(playlist.id)) {
        for (const entry of playlist.items || []) ids.slides.add(entry.slideId);
        for (const id of playlist.publishedSlideIds || []) ids.slides.add(id);
        for (const entry of playlist.published?.items || []) {
          ids.slides.add(entry.slide.id);
          includeMedia(entry.slide);
        }
        for (const asset of playlist.published?.assets || [])
          ids.assets.add(asset.id);
      }
    for (const slide of library.slides || [])
      if (ids.slides.has(slide.id)) includeMedia(slide);
    for (const kind of ['slides', 'playlists', 'assets'])
      for (const id of ids[kind]) combined[kind].add(id);
    if (selection === site.id) selected = ids;
  }
  if (selection === 'unassigned')
    return Object.fromEntries(
      ['slides', 'playlists', 'assets'].map((kind) => [
        kind,
        new Set(
          (library[kind] || [])
            .filter((item) => !combined[kind].has(item.id))
            .map((item) => item.id),
        ),
      ]),
    );
  return (
    selected || { slides: new Set(), playlists: new Set(), assets: new Set() }
  );
}
