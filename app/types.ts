import { v4 as uuid } from 'uuid';

export type Layer = {
  id: string;
  type: 'text' | 'image' | 'clock' | 'counter' | 'weather' | 'shape' | 'stocks';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  assetId?: string;
  removedMedia?: boolean;
  fontSize: number;
  fontFamily?: string;
  fontId?: string;
  color: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  autoSize?: boolean;
  lockAspect?: boolean;
  lockMode?: 'full' | 'movement';
  fit: 'cover' | 'contain';
  cropX?: number;
  cropY?: number;
  cropZoom?: number;
  clock?: { showSeconds?: boolean; hour12?: boolean };
  stocks?: { name: string; symbols: string[] };
  shape?: {
    kind: 'rectangle' | 'circle';
    fill: string;
    fillEnabled?: boolean;
    outline: string;
    outlineWidth: number;
    cornerRadius: number;
  };
  weather?: {
    name: string;
    latitude: number | null;
    longitude: number | null;
    unit: 'F' | 'C';
    mode?: 'current' | 'six-hour';
    layout?: 'horizontal' | 'vertical';
    zip?: string;
  };
  counter?: {
    direction: 'auto' | 'up' | 'down';
    prefix?: string;
    suffix?: string;
    goalMessage?: string;
    targetAt: string;
    unit: 'seconds' | 'minutes' | 'hours' | 'days';
    showUnit: boolean;
  };
};
export type AccessTag = {
  type: 'group' | 'user';
  id: string;
  name: string;
  username?: string;
};
export type LibraryOrganization = {
  readOnly?: boolean;
  managingGroupId?: string | null;
  folderId?: string | null;
  tags?: string[];
};
export type LibraryFolder = {
  pathOnly?: boolean;
  id: string;
  name: string;
  parentId: string | null;
  readOnly?: boolean;
  managingGroupId?: string | null;
};
export type Slide = LibraryOrganization & {
  accessTags?: AccessTag[];
  groupIds?: string[];
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: Layer[];
  updatedAt?: string;
};
export type Playlist = LibraryOrganization & {
  fork?: { masterId: string; order: 'master' | 'custom'; speed: number } | null;
  forkSyncError?: string;
  accessTags?: AccessTag[];
  groupIds?: string[];
  id: string;
  name: string;
  transition?: {
    type: 'cut' | 'fade' | 'slide-left' | 'slide-right';
    durationMs: number;
  };
  items: {
    id?: string;
    sourceEntryId?: string;
    afterEntryId?: string | null;
    durationOverride?: boolean;
    masterDuration?: number;
    slideId: string;
    duration: number;
    startsAt?: string | null;
    scheduleEnabled?: boolean;
    expiresAt?: string | null;
  }[];
  publishedAt?: string | null;
  publishedSlideIds?: string[];
  updatedAt?: string;
};
export function playlistDuration(playlist: Playlist) {
  const animation =
    playlist.items.length > 1 &&
    playlist.transition &&
    playlist.transition.type !== 'cut'
      ? (playlist.items.length * playlist.transition.durationMs) / 1000
      : 0;
  return (
    Math.round(
      (playlist.items.reduce(
        (sum, item) =>
          sum +
          Math.max(
            2,
            Math.min(
              3600,
              Math.round(item.duration / (playlist.fork?.speed || 1)),
            ),
          ),
        0,
      ) +
        animation) *
        10,
    ) / 10
  );
}
export type Asset = {
  accessTags?: AccessTag[];
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  tags: string[];
  folderId: string | null;
  createdAt: string | null;
  readOnly?: boolean;
};
export type MediaFolder = {
  accessTags?: AccessTag[];
  id: string;
  name: string;
  parentId?: string | null;
};
export type Device = {
  accessTags?: AccessTag[];
  groupIds?: string[];
  id: string;
  name: string;
  code: string;
  approved: boolean;
  playlistId: string | null;
  blank: boolean;
  rotation: 0 | 90 | 180 | 270;
  lastSeen: string | null;
  status: {
    revision?: string;
    error?: string | null;
    version?: string;
    recovery?: string | null;
    playback?: {
      phase: string;
      preparationMs?: number;
      missedDeadlines?: number;
      error?: string | null;
    } | null;
  } | null;
  command?: { type: string } | null;
};
export type Library = {
  groups?: {
    id: string;
    name: string;
    parentId?: string | null;
    directMember?: boolean;
  }[];
  slideFolders?: LibraryFolder[];
  playlistFolders?: LibraryFolder[];
  slides: Slide[];
  playlists: Playlist[];
  assets: Asset[];
  folders: MediaFolder[];
  devices: Device[];
};
export async function api<T = unknown>(
  url: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const options: RequestInit = {
    method,
    headers:
      body instanceof FormData
        ? undefined
        : { 'Content-Type': 'application/json' },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  };
  const response = await fetch(url, options);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export function newLayer(type: Layer['type'], assetId?: string): Layer {
  return {
    id: uuid(),
    type,
    x: 10,
    y: 10,
    width: type === 'image' ? 40 : 75,
    height: type === 'image' ? 60 : 25,
    text: type === 'text' ? 'Your message here' : '',
    assetId,
    fontSize: 96,
    fontFamily: 'Arial',
    color: '#202923',
    bold: false,
    align: 'left',
    verticalAlign: 'top',
    autoSize: false,
    lockAspect: true,
    fit: 'cover',
    cropX: 50,
    cropY: 50,
    cropZoom: 1,
    ...(type === 'stocks'
      ? {
          width: 25,
          height: 40,
          autoSize: true,
          stocks: { name: 'Stocks', symbols: ['WMT'] },
        }
      : {}),
    ...(type === 'shape'
      ? {
          width: 30,
          height: 30,
          shape: {
            kind: 'rectangle' as const,
            fill: '#17613d',
            fillEnabled: true,
            outline: '#202923',
            outlineWidth: 4,
            cornerRadius: 0,
          },
        }
      : {}),
    ...(type === 'weather'
      ? {
          width: 60,
          height: 40,
          autoSize: true,
          weather: {
            name: 'Weather',
            latitude: null,
            longitude: null,
            unit: 'F' as const,
            mode: 'current' as const,
          },
        }
      : {}),
    ...(type === 'clock'
      ? { clock: { showSeconds: false, hour12: true } }
      : {}),
    ...(type === 'counter'
      ? {
          autoSize: true,
          counter: {
            direction: 'auto' as const,
            prefix: '',
            suffix: '',
            targetAt: new Date(Date.now() + 86400000).toISOString(),
            unit: 'seconds' as const,
            showUnit: true,
          },
        }
      : {}),
  };
}
