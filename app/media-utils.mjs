export function visibleMedia(
  assets,
  { folder = 'all', search = '', tag = '', sort = 'newest' } = {},
) {
  const query = search.trim().toLowerCase();
  const result = assets.filter(
    (a) =>
      (folder === 'all' ||
        (folder === 'unfiled' ? !a.folderId : a.folderId === folder)) &&
      (!tag || (a.tags || []).includes(tag)) &&
      (!query ||
        [a.name, ...(a.tags || [])].some((value) =>
          value.toLowerCase().includes(query),
        )),
  );
  return result.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (sort === 'name') return byName;
    if (sort === 'name-desc') return -byName;
    if (sort === 'largest') return b.bytes - a.bytes || byName;
    if (sort === 'smallest') return a.bytes - b.bytes || byName;
    const difference =
      (Date.parse(a.createdAt || '') || 0) -
      (Date.parse(b.createdAt || '') || 0);
    return (sort === 'oldest' ? difference : -difference) || byName;
  });
}
export const parseTags = (value) => [
  ...new Set(
    value
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  ),
];
