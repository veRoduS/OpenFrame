import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationState } from '../server/publication-state.mjs';
import { connectionState, playbackState } from '../app/device-status.ts';

const item = { slideId: 'slide-1', duration: 10 };
const published = {
  name: 'Lobby',
  items: [{ slide: { id: 'slide-1' }, duration: 10 }],
  transition: { type: 'cut', durationMs: 500 },
};
const playlist = { name: 'Lobby', items: [item], published };

void test('publication state distinguishes playback edits from organization metadata', () => {
  assert.equal(publicationState({ ...playlist, published: null }), 'draft');
  assert.equal(publicationState(playlist), 'published');
  assert.equal(
    publicationState({
      ...playlist,
      tags: ['new'],
      folderId: 'folder',
      updatedAt: 'today',
      items: [
        {
          ...item,
          id: 'new-id',
          startsAt: '2027-01-01T00:00:00Z',
          scheduleEnabled: false,
        },
      ],
    }),
    'published',
  );
  for (const change of [
    { name: 'Renamed lobby' },
    { items: [{ ...item, duration: 20 }] },
    { items: [item, item] },
    { items: [{ ...item, startsAt: '2027-01-01T00:00:00Z' }] },
    { transition: { type: 'fade', durationMs: 500 } },
  ])
    assert.equal(publicationState({ ...playlist, ...change }), 'changes');
});

void test('fork comparison uses effective timing and retains repeated entry order', () => {
  assert.equal(
    publicationState({
      ...playlist,
      fork: { speed: 2 },
      items: [{ ...item, duration: 20 }],
    }),
    'published',
  );
  assert.equal(
    publicationState({ ...playlist, fork: { speed: 2 } }),
    'changes',
  );
  const repeat = {
    ...playlist,
    items: [item, { ...item, duration: 20 }],
    published: {
      ...published,
      items: [...published.items, { ...published.items[0], duration: 20 }],
    },
  };
  assert.equal(publicationState(repeat), 'published');
  assert.equal(
    publicationState({ ...repeat, items: [...repeat.items].reverse() }),
    'changes',
  );
});

void test('heartbeat, playback, blanking, failures and unsynced revisions remain distinct', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const device = {
    approved: true,
    lastSeen: new Date(now).toISOString(),
    blank: false,
    status: { revision: 'current', playback: { phase: 'playing' } },
  };
  const playlist = { publishedAt: 'today', publishedRevision: 'current' };
  assert.equal(connectionState(device, now), 'online');
  assert.equal(connectionState(device, now + 90000), 'offline');
  assert.equal(playbackState(device, playlist, now), 'Playing');
  assert.equal(
    playbackState({ ...device, blank: true }, playlist, now),
    'Blanked',
  );
  assert.equal(
    playbackState(
      { ...device, status: { error: 'Download failed' } },
      playlist,
      now,
    ),
    'Playback error',
  );
  assert.equal(
    playbackState(device, { ...playlist, publishedRevision: 'new' }, now),
    'Waiting for content sync',
  );
  assert.equal(
    playbackState(device, undefined, now),
    'Waiting for published playlist',
  );
  assert.equal(
    playbackState(
      { ...device, status: { revision: 'current' } },
      playlist,
      now,
    ),
    'Playback unverified',
  );
  assert.equal(
    playbackState(device, playlist, now + 90000),
    'Waiting for connection',
  );
});
