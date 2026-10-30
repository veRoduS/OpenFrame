// Suggest the one group whose name contains the site number as a whole digit
// run, e.g. "Store 042" for site 042. Matching stays exact like enrollment, so
// "Store 42" is not suggested for 042. Ambiguous or absent matches suggest none.
export function suggestedSiteGroup<T extends { id: string; name: string }>(
  siteNumber: string,
  groups: T[],
): T | null {
  const number = siteNumber.trim();
  if (!/^[0-9]{1,20}$/.test(number)) return null;
  const matches = groups.filter((group) =>
    group.name.match(/[0-9]+/g)?.includes(number),
  );
  return matches.length === 1 ? matches[0] : null;
}
