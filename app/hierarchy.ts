export function orderedTree<
  T extends { id: string; name: string; parentId?: string | null },
>(items: T[]) {
  const rows: { item: T; depth: number }[] = [];
  const visited = new Set<string>();
  const sorted = [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  );
  const append = (item: T, depth: number) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    rows.push({ item, depth });
    sorted
      .filter((child) => child.parentId === item.id)
      .forEach((child) => append(child, depth + 1));
  };
  sorted
    .filter(
      (item) =>
        !item.parentId || !items.some((parent) => parent.id === item.parentId),
    )
    .forEach((item) => append(item, 0));
  sorted.forEach((item) => append(item, 0));
  return rows;
}
export function isWithin(
  items: { id: string; parentId?: string | null }[],
  candidate: string,
  ancestor: string,
) {
  const seen = new Set<string>();
  let current: string | null | undefined = candidate;
  while (current && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = items.find((item) => item.id === current)?.parentId;
  }
  return false;
}
export const indentedName = (name: string, depth: number) =>
  `${'\u00a0\u00a0\u00a0\u00a0'.repeat(depth)}${depth ? '↳ ' : ''}${name}`;
