import test from 'node:test';
import assert from 'node:assert/strict';
import { Playback, eligible } from '../player/web/playback.js';
import {
  counterValue,
  counterText,
  nextCounterDelay,
  unitMilliseconds,
} from '../player/web/counter.js';
import { imageStyle, panCrop } from '../player/web/image-layout.js';

export const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const manifest = (revision = 'one', ids = ['a', 'b']) => ({
  revision,
  assets: [],
  items: ids.map((id) => ({ slide: { id }, duration: 2 })),
});
function fixture(t) {
  let time = 0,
    id = 0;
  const tasks = new Map(),
    requests = [],
    shown = [],
    statuses = [];
  const playback = new Playback({
    now: () => time,
    wallNow: () => time,
    schedule: (fn, delay) => {
      tasks.set(++id, { fn, at: time + delay });
      return id;
    },
    cancel: (key) => tasks.delete(key),
    report: (status) => statuses.push(status),
    prepare: (item, assets, rotation, signal) =>
      new Promise((resolve, reject) => {
        const frame = {
          slideId: item.slide.id,
          disposed: false,
          dispose() {
            this.disposed = true;
          },
        };
        requests.push({
          frame,
          signal,
          assets,
          rotation,
          resolve: () => resolve(frame),
          reject,
        });
      }),
    commit: (next) => shown.push(next.slideId),
  });
  const advance = async (ms) => {
    const until = time + ms;
    while (true) {
      const due = [...tasks]
        .filter(([, task]) => task.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      time = due[1].at;
      tasks.delete(due[0]);
      due[1].fn();
      await flush();
    }
    time = until;
    await flush();
  };
  t.after(() => playback.stop());
  return { playback, requests, shown, statuses, advance, tasks };
}

void test('disabled schedules ignore retained dates while legacy and re-enabled schedules apply them', () => {
  const item = {
    startsAt: new Date(1000).toISOString(),
    expiresAt: new Date(2000).toISOString(),
  };
  assert.equal(eligible(item, 0), false);
  assert.equal(eligible({ ...item, scheduleEnabled: false }, 0), true);
  assert.equal(eligible({ ...item, scheduleEnabled: false }, 3000), true);
  assert.equal(eligible({ ...item, scheduleEnabled: true }, 3000), false);
});
void test('scheduled entries start and expire offline, including when no entries are eligible', async (t) => {
  const f = fixture(t);
  const doc = manifest('scheduled', ['a']);
  doc.items[0].startsAt = new Date(1500).toISOString();
  doc.items[0].expiresAt = new Date(2500).toISOString();
  f.playback.update(doc);
  await flush();
  assert.equal(f.requests.length, 0);
  await f.advance(1499);
  assert.equal(f.requests.length, 0);
  await f.advance(1);
  f.requests[0].resolve();
  await flush();
  assert.deepEqual(f.shown, ['a']);
  await f.advance(1000);
  assert.equal(f.playback.current, null);
  assert.equal(f.requests[0].frame.disposed, true);
  f.playback.stop();
  assert.equal(f.tasks.size, 0);
});
void test('expired slides are removed even while a replacement is not ready', async (t) => {
  const f = fixture(t);
  const doc = manifest();
  doc.items[0].expiresAt = new Date(500).toISOString();
  f.playback.update(doc);
  await flush();
  f.requests[0].resolve();
  await flush();
  await f.advance(500);
  assert.equal(f.playback.current, null);
  assert.equal(f.requests[0].frame.disposed, true);
  assert.equal(f.requests[1].signal.aborted, true);
  f.requests[1].resolve();
  f.requests[2].resolve();
  await flush();
  assert.deepEqual(f.shown, ['a', 'b']);
});
void test('prepared next frame waits for deadline, then switches without preparing again', async (t) => {
  const f = fixture(t);
  f.playback.update(manifest());
  await flush();
  f.requests[0].resolve();
  await flush();
  assert.deepEqual(f.shown, ['a']);
  f.requests[1].resolve();
  await flush();
  await f.advance(1999);
  assert.deepEqual(f.shown, ['a']);
  await f.advance(1);
  assert.deepEqual(f.shown, ['a', 'b']);
  assert.equal(f.requests[0].frame.disposed, true);
  assert.equal(f.requests.length, 3);
});
void test('late content holds the entire old frame and gets its full duration after becoming ready', async (t) => {
  const f = fixture(t);
  f.playback.update(manifest());
  await flush();
  f.requests[0].resolve();
  await flush();
  await f.advance(3000);
  assert.deepEqual(f.shown, ['a']);
  assert.equal(f.requests[0].frame.disposed, false);
  assert.equal(f.statuses.at(-1).phase, 'waiting');
  assert.equal(f.statuses.at(-1).missedDeadlines, 1);
  f.requests[1].resolve();
  await flush();
  assert.deepEqual(f.shown, ['a', 'b']);
  f.requests[2].resolve();
  await flush();
  await f.advance(1999);
  assert.equal(f.shown.length, 2);
  await f.advance(1);
  assert.deepEqual(f.shown, ['a', 'b', 'a']);
});
void test('decode or widget failure holds old content, retries, and recovers', async (t) => {
  const f = fixture(t);
  f.playback.update(manifest());
  await flush();
  f.requests[0].resolve();
  await flush();
  f.requests[1].reject(new Error('Image decode failed'));
  await flush();
  assert.match(f.statuses.at(-1).error, /Image decode failed/);
  assert.equal(f.requests[0].frame.disposed, false);
  assert.equal(f.requests[1].signal.aborted, true);
  await f.advance(2000);
  f.requests[2].resolve();
  await flush();
  assert.deepEqual(f.shown, ['a', 'b']);
});
void test('publication and rotation updates discard stale preparation without blanking current frame', async (t) => {
  const f = fixture(t);
  f.playback.update(manifest());
  await flush();
  f.requests[0].resolve();
  await flush();
  f.playback.update(manifest('two', ['c']), 90);
  await flush();
  assert.equal(f.requests[1].signal.aborted, true);
  f.requests[1].resolve();
  await flush();
  assert.equal(f.requests[1].frame.disposed, true);
  assert.deepEqual(f.shown, ['a']);
  assert.equal(f.requests[2].rotation, 90);
  f.requests[2].resolve();
  await flush();
  assert.deepEqual(f.shown, ['a', 'c']);
  f.playback.update(manifest('two', ['c']), 90);
  await flush();
  assert.equal(f.requests.length, 3);
});
void test('each request captures its own manifest even if cancelled before its microtask starts', async (t) => {
  const f = fixture(t);
  f.playback.update(manifest('one', ['old']));
  f.playback.update(manifest('two', ['new']));
  await flush();
  assert.equal(f.requests[0].frame.slideId, 'old');
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests.forEach((r) => r.resolve());
  await flush();
  assert.deepEqual(f.shown, ['new']);
});
void test('stop disposes buffered and visible frames and clears timers; one-slide playlists do not reload', async (t) => {
  const f = fixture(t);
  f.playback.update(manifest());
  await flush();
  f.requests[0].resolve();
  await flush();
  f.requests[1].resolve();
  await flush();
  f.playback.stop('blank');
  assert.ok(f.requests.every((r) => r.frame.disposed));
  assert.equal(f.tasks.size, 0);
  await f.advance(10000);
  assert.deepEqual(f.shown, ['a']);
  f.playback.update(manifest('single', ['c']));
  await flush();
  f.requests[2].resolve();
  await flush();
  await f.advance(100000);
  assert.equal(f.requests.length, 3);
  f.playback.update(manifest('empty', []));
  assert.equal(f.playback.current, null);
  assert.equal(f.requests[2].frame.disposed, true);
});
void test('hundreds of switches retain at most one current and one prepared frame', async (t) => {
  const f = fixture(t);
  f.playback.update(manifest());
  await flush();
  f.requests[0].resolve();
  await flush();
  for (let i = 0; i < 300; i++) {
    f.requests.at(-1).resolve();
    await flush();
    assert.ok(f.requests.filter((r) => !r.frame.disposed).length <= 2);
    await f.advance(2000);
  }
  assert.equal(f.playback.missedDeadlines, 0);
});
void test('counter units round correctly and legacy directions are automatic', () => {
  const targetAt = '2026-09-06T12:00:00-05:00',
    target = Date.parse(targetAt);
  for (const [unit, ms] of Object.entries(unitMilliseconds)) {
    const down = { direction: 'down', targetAt, unit };
    const up = { ...down, direction: 'up' };
    assert.equal(counterValue(down, target - ms * 1.1), 2);
    assert.equal(counterValue(up, target + ms * 1.9), 1);
    assert.equal(counterValue(up, target - ms), 1);
    assert.equal(counterValue(down, target + ms), 1);
    assert.equal(nextCounterDelay(down, target), ms);
    assert.equal(nextCounterDelay(up, target), ms);
    assert.equal(nextCounterDelay(down, target - ms * 2), ms);
    assert.equal(nextCounterDelay(up, target - ms), ms);
    assert.equal(counterText(up, target + ms), `1 ${unit.slice(0, -1)}`);
    assert.equal(counterText({ ...up, showUnit: false }, target + ms * 2), '2');
  }
});
void test('automatic counters cross the target and keep scheduling in every unit', () => {
  const targetAt = '2026-12-31T23:59:59Z',
    target = Date.parse(targetAt);
  for (const [unit, ms] of Object.entries(unitMilliseconds)) {
    const config = { direction: 'auto', targetAt, unit };
    assert.equal(counterValue(config, target - ms * 1.5), 2);
    assert.equal(counterValue(config, target), 0);
    assert.equal(counterValue(config, target + ms * 1.5), 1);
    assert.equal(nextCounterDelay(config, target - 100), 100);
    assert.equal(nextCounterDelay(config, target), ms);
    assert.equal(nextCounterDelay(config, target + ms * 1.5), ms / 2);
  }
});
void test('goal messages replace the entire counter at the target and remain after restart', () => {
  const targetAt = '2027-01-01T00:00:00Z',
    target = Date.parse(targetAt);
  for (const unit of Object.keys(unitMilliseconds)) {
    const config = {
      targetAt,
      unit,
      goalMessage: 'Happy New Year!',
      prefix: 'Only',
      suffix: 'remaining',
    };
    assert.equal(
      counterText(config, target - 100),
      `Only 1 ${unit.slice(0, -1)} remaining`,
    );
    assert.equal(nextCounterDelay(config, target - 100), 100);
    assert.equal(counterText(config, target), 'Happy New Year!');
    assert.equal(nextCounterDelay(config, target), null);
    assert.equal(
      counterText(JSON.parse(JSON.stringify(config)), target + 86400000),
      'Happy New Year!',
    );
    assert.equal(nextCounterDelay(config, target + 86400000), null);
    assert.notEqual(
      nextCounterDelay({ ...config, goalMessage: '  ' }, target),
      null,
    );
    assert.equal(
      counterText({ ...config, goalMessage: '<b>Done</b>' }, target),
      '<b>Done</b>',
    );
  }
});
void test('counter affixes surround the count as plain text with optional units', () => {
  const config = {
    direction: 'auto',
    targetAt: '2027-01-01T00:00:00Z',
    unit: 'days',
    prefix: 'Only more...',
    suffix: '... until New Years',
  };
  const now = Date.parse(config.targetAt) - 3 * unitMilliseconds.days;
  assert.equal(
    counterText(config, now),
    'Only more... 3 days ... until New Years',
  );
  assert.equal(
    counterText({ ...config, showUnit: false }, now),
    'Only more... 3 ... until New Years',
  );
  assert.equal(
    counterText({ ...config, prefix: '  ', suffix: '' }, now),
    '3 days',
  );
  assert.equal(
    counterText({ ...config, prefix: '<b>Only</b>', suffix: undefined }, now),
    '<b>Only</b> 3 days',
  );
});
void test('crop pan matches cover overflow and zoom; fit mode ignores zoom and clamps to edges', () => {
  assert.deepEqual(panCrop({}, 50, 200, 100, 100, 200, 100), {
    cropX: 0,
    cropY: 50,
  });
  assert.deepEqual(panCrop({ cropZoom: 2 }, 50, -500, 100, 100, 100, 100), {
    cropX: 0,
    cropY: 100,
  });
  assert.deepEqual(panCrop({}, -500, 0, 100, 100, 200, 100), {
    cropX: 100,
    cropY: 50,
  });
  assert.equal(imageStyle({ fit: 'cover' }).objectPosition, '50% 50%');
  assert.equal(
    imageStyle({ fit: 'cover', cropZoom: 3, cropX: 20, cropY: 30 })
      .transformOrigin,
    '20% 30%',
  );
  assert.equal(imageStyle({ fit: 'contain', cropZoom: 3 }).transform, 'none');
});
