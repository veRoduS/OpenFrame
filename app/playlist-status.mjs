import { eligible } from '../player/web/playback.js';

export function playlistItemStatus(item, now = Date.now()) {
  if (item.scheduleEnabled === false) return { state: 'active', at: null };
  const start = item.startsAt ? Date.parse(item.startsAt) : null;
  const end = item.expiresAt ? Date.parse(item.expiresAt) : null;
  if (
    (start !== null && !Number.isFinite(start)) ||
    (end !== null && !Number.isFinite(end)) ||
    (start !== null && end !== null && start >= end)
  )
    return { state: 'invalid', at: null };
  if (eligible(item, now)) return { state: 'active', at: null };
  if (start !== null && now < start)
    return { state: 'scheduled', at: item.startsAt };
  return { state: 'expired', at: item.expiresAt };
}
