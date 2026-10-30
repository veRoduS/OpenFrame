import type { Library } from './types';
import type { User } from './accounts';
import { isWithin } from './hierarchy';

export function focusHomeLibrary(
  library: Library,
  home: NonNullable<User['home']>,
): Library {
  const groups = library.groups || [];
  const groupMatches = (item: { groupIds?: string[] }) =>
    item.groupIds?.some(
      (id) =>
        isWithin(groups, id, home.groupId) ||
        isWithin(groups, home.groupId, id),
    );
  const siteMatches = (siteId?: string | null) => {
    if (home.siteId) return siteId === home.siteId;
    const groupId = library.sites?.find(
      (site) => site.id === siteId,
    )?.accessGroupId;
    return !!groupId && isWithin(groups, groupId, home.groupId);
  };
  const slides = library.slides.filter(groupMatches);
  return {
    ...library,
    slides,
    playlists: library.playlists.filter(groupMatches),
    devices: library.devices.filter(
      (device) =>
        siteMatches(
          device.siteId ||
            library.sites?.find(
              (site) => site.siteNumber === device.requestedSiteNumber,
            )?.id,
        ) ||
        (!home.siteId &&
          device.groupIds?.some((id) => isWithin(groups, id, home.groupId))),
    ),
    dataFeeds: library.dataFeeds?.filter((feed) => siteMatches(feed.siteId)),
    sites: library.sites?.filter((site) => siteMatches(site.id)),
  };
}
