import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockFormatter, nextClockDelay } from '../player/web/clock.js';

void test('clock formats support all four precision and hour-cycle combinations', () => {
  const now = new Date(2026, 0, 1, 13, 4, 5);
  for (const hour12 of [true, false])
    for (const showSeconds of [true, false]) {
      const formatter = createClockFormatter({ hour12, showSeconds }, 'en-US');
      const parts = Object.fromEntries(
        formatter.formatToParts(now).map((p) => [p.type, p.value]),
      );
      assert.equal(parts.hour, hour12 ? '01' : '13');
      assert.equal(parts.minute, '04');
      assert.equal(parts.second, showSeconds ? '05' : undefined);
      assert.equal(parts.dayPeriod, hour12 ? 'PM' : undefined);
    }
});

void test('midnight is 00 in 24-hour mode and 12 AM in 12-hour mode', () => {
  const midnight = new Date(2026, 0, 1, 0, 0, 0);
  assert.equal(
    createClockFormatter({ hour12: false, showSeconds: true }, 'en-US').format(
      midnight,
    ),
    '00:00:00',
  );
  const parts = Object.fromEntries(
    createClockFormatter(undefined, 'en-US')
      .formatToParts(midnight)
      .map((p) => [p.type, p.value]),
  );
  assert.equal(parts.hour, '12');
  assert.equal(parts.dayPeriod, 'AM');
  assert.equal(parts.second, undefined);
});

void test('clock refreshes only at its selected second or minute boundary', () => {
  assert.equal(nextClockDelay({ showSeconds: true }, 12345), 655);
  assert.equal(nextClockDelay({ showSeconds: true }, 13000), 1000);
  assert.equal(nextClockDelay({}, 12345), 47655);
  assert.equal(nextClockDelay(undefined, 60000), 60000);
});
