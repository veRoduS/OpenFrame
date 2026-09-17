import { v4 as uuid } from 'uuid';

export type Layer = {
  id: string;
  type: 'text' | 'image' | 'clock' | 'counter' | 'weather';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  assetId?: string;
  fontSize: number;
  color: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  autoSize?: boolean;
  lockAspect?: boolean;
  fit: 'cover' | 'contain';
  cropX?: number;
  cropY?: number;
  cropZoom?: number;
  clock?: { showSeconds?: boolean; hour12?: boolean };
  weather?: {
    name: string;
    latitude: number | null;
    longitude: number | null;
    unit: 'F' | 'C';
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
export type Slide = {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: Layer[];
  updatedAt?: string;
};
export type Playlist = {
  id: string;
  name: string;
  items: {
    slideId: string;
    duration: number;
    startsAt?: string | null;
    scheduleEnabled?: boolean;
    expiresAt?: string | null;
  }[];
  publishedAt?: string | null;
  updatedAt?: string;
};
export type Asset = {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  tags: string[];
  folderId: string | null;
  createdAt: string | null;
};
export type MediaFolder = { id: string; name: string };
export type Device = {
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
