import test from 'node:test';
import assert from 'node:assert/strict';
import { playlistItemStatus } from '../app/playlist-status.mjs';
import { eligible } from '../player/web/playback.js';

const start = '2027-01-01T00:00:00Z';
const end = '2027-02-01T00:00:00Z';
const item = { startsAt: start, expiresAt: end };

void test('playlist indicators follow player eligibility at exact start and expiration boundaries', () => {
  for (const [now, state, at] of [
    [Date.parse(start) - 1, 'scheduled', start],
    [Date.parse(start), 'active', null],
    [Date.parse(end) - 1, 'active', null],
    [Date.parse(end), 'expired', end],
  ]) {
    assert.deepEqual(playlistItemStatus(item, now), { state, at });
    assert.equal(state === 'active', eligible(item, now));
  }
});

void test('unscheduled entries and disabled schedules are active without misleading historical dates', () => {
  for (const entry of [
    {},
    { scheduleEnabled: true },
    { ...item, scheduleEnabled: false },
  ]) {
    assert.deepEqual(playlistItemStatus(entry, Date.parse(end) + 1), {
      state: 'active',
      at: null,
    });
  }
  assert.deepEqual(playlistItemStatus({ startsAt: start }, 0), {
    state: 'scheduled',
    at: start,
  });
  assert.deepEqual(playlistItemStatus({ expiresAt: end }, Date.parse(end)), {
    state: 'expired',
    at: end,
  });
});

void test('incomplete or invalid draft windows show a validation state rather than false activity', () => {
  for (const entry of [
    { startsAt: 'invalid' },
    { expiresAt: 'invalid' },
    { startsAt: end, expiresAt: start },
    { startsAt: start, expiresAt: start },
  ])
    assert.deepEqual(playlistItemStatus(entry), { state: 'invalid', at: null });
});
