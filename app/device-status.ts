import type { Device, Playlist } from './types';

export function connectionState(device: Device, now = Date.now()) {
  if (!device.approved) return 'pending';
  return device.lastSeen && now - Date.parse(device.lastSeen) < 90000
    ? 'online'
    : 'offline';
}

export function playbackState(
  device: Device,
  playlist?: Playlist,
  now = Date.now(),
) {
  if (!device.approved) return 'Awaiting approval';
  if (connectionState(device, now) !== 'online')
    return 'Waiting for connection';
  if (device.blank || device.status?.playback?.phase === 'blank')
    return 'Blanked';
  if (
    device.status?.error ||
    device.status?.playback?.error ||
    device.status?.playback?.phase === 'stalled'
  )
    return 'Playback error';
  if (!playlist?.publishedAt) return 'Waiting for published playlist';
  if (
    playlist.publishedRevision &&
    device.status?.revision !== playlist.publishedRevision
  )
    return 'Waiting for content sync';
  switch (device.status?.playback?.phase) {
    case 'playing':
      return 'Playing';
    case 'preparing':
      return 'Preparing content';
    case 'empty':
      return 'No active slides';
    case 'waiting':
      return 'Waiting for content';
    default:
      return 'Playback unverified';
  }
}
