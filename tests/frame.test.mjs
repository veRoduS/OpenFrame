import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFrame, commitFrame } from '../player/web/frame.js';
import { widgets } from '../player/web/widgets.js';

const deferred = () => Promise.withResolvers();
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
// A small DOM double isolates readiness/lifecycle behavior, not browser painting.
function fixture(t) {
  const created = [],
    frames = [],
    font = deferred();
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.style = {};
      this.dataset = {};
      this.attributes = {};
      this.children = [];
      this.clientWidth = 400;
      this.clientHeight = 200;
      this.decoded = deferred();
      created.push(this);
    }
    append(element) {
      this.children.push(element);
      element.parent = this;
    }
    remove() {
      if (this.parent)
        this.parent.children = this.parent.children.filter(
          (child) => child !== this,
        );
    }
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    removeAttribute(key) {
      delete this[key];
    }
    decode() {
      this.decodeCalled = true;
      return this.decoded.promise;
    }
  }
  const globals = {
    document: {
      createElement: (tag) => new Element(tag),
      fonts: { ready: font.promise },
    },
    innerWidth: 1920,
    innerHeight: 1080,
    requestAnimationFrame: (cb) => frames.push(cb),
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  const host = new Element('host');
  const paint = async () => {
    frames.splice(0).forEach((cb) => cb());
    await flush();
  };
  return { host, font, created, paint };
}
const layer = (type, extra = {}) => ({
  id: type,
  type,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  fontSize: 72,
  color: '#202923',
  fit: 'cover',
  ...extra,
});
const item = (layers) => ({
  duration: 2,
  slide: {
    id: 'slide',
    background: '#ffffff',
    width: 1920,
    height: 1080,
    layers,
  },
});

void test('frame waits for the actual image nodes, widgets, fonts and layout before committing', async (t) => {
  const f = fixture(t),
    widget = deferred(),
    abort = new AbortController();
  let activations = 0,
    disposals = 0,
    ready = false;
  widgets.set('test-ready', (element) => {
    element.textContent = 'Prepared data';
    return {
      ready: widget.promise,
      activate() {
        activations++;
      },
      dispose() {
        disposals++;
      },
    };
  });
  t.after(() => {
    abort.abort();
    widgets.delete('test-ready');
  });
  const promise = prepareFrame(
    f.host,
    item([
      layer('image', { assetId: 'photo', cropX: 10, cropY: 70, cropZoom: 2 }),
      layer('test-ready'),
    ]),
    [{ id: 'photo', url: '/media/photo.webp' }],
    0,
    abort.signal,
  ).then((frame) => {
    ready = true;
    return frame;
  });
  const image = f.created.find((e) => e.tagName === 'img');
  assert.equal(image.decodeCalled, true);
  assert.equal(image.style.objectPosition, '10% 70%');
  assert.equal(image.style.transform, 'scale(2)');
  assert.equal(f.host.children[0].style.visibility, 'hidden');
  image.decoded.resolve();
  await flush();
  assert.equal(ready, false);
  widget.resolve();
  await flush();
  assert.equal(ready, false);
  f.font.resolve();
  await flush();
  assert.equal(ready, false);
  await f.paint();
  assert.equal(ready, false);
  await f.paint();
  const frame = await promise;
  assert.equal(activations, 0);
  assert.equal(frame.element.dataset.ready, 'true');
  assert.equal(frame.element.children[0].children[0], image);
  commitFrame(frame, null);
  assert.equal(activations, 1);
  assert.equal(frame.element.style.visibility, 'visible');
  assert.equal(frame.element.attributes['aria-hidden'], 'false');
  frame.dispose();
  frame.dispose();
  assert.equal(disposals, 1);
  assert.equal(f.host.children.length, 0);
  assert.equal(image.src, undefined);
});
void test('aborting a still-decoding frame releases DOM and widget resources immediately', async (t) => {
  const f = fixture(t),
    abort = new AbortController();
  let disposed = false;
  widgets.set('test-abort', () => ({
    ready: Promise.resolve(),
    activate() {},
    dispose() {
      disposed = true;
    },
  }));
  t.after(() => widgets.delete('test-abort'));
  const pending = prepareFrame(
    f.host,
    item([layer('image', { assetId: 'photo' }), layer('test-abort')]),
    [{ id: 'photo', url: '/media/photo.webp' }],
    0,
    abort.signal,
  );
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.host.children.length, 0);
  assert.equal(disposed, true);
  assert.equal(f.created.find((e) => e.tagName === 'img').src, undefined);
});
void test('widget rejection fails promptly even if a photo has not finished decoding', async (t) => {
  const f = fixture(t),
    widget = deferred(),
    abort = new AbortController();
  widgets.set('test-failure', () => ({
    ready: widget.promise,
    activate() {},
    dispose() {},
  }));
  t.after(() => {
    abort.abort();
    widgets.delete('test-failure');
  });
  const pending = prepareFrame(
    f.host,
    item([layer('image', { assetId: 'photo' }), layer('test-failure')]),
    [{ id: 'photo', url: '/media/photo.webp' }],
    0,
    abort.signal,
  );
  widget.reject(new Error('Snapshot is missing'));
  await assert.rejects(pending, /Snapshot is missing/);
  assert.equal(f.host.children.length, 0);
});
void test('missing assets and unsupported widgets never leave a partial frame behind', async (t) => {
  const f = fixture(t);
  for (const value of [
    layer('image', { assetId: 'missing' }),
    layer('unknown'),
  ]) {
    await assert.rejects(
      prepareFrame(f.host, item([value]), [], 0, new AbortController().signal),
    );
    assert.equal(f.host.children.length, 0);
  }
});
void test('activation failure leaves the old frame visible', () => {
  const previous = { element: { style: { visibility: 'visible' } } };
  const next = {
    activate() {
      throw new Error('Activation failed');
    },
  };
  assert.throws(() => commitFrame(next, previous), /Activation failed/);
  assert.equal(previous.element.style.visibility, 'visible');
});
void test('clock widgets defer timers until activation and respect seconds precision', (t) => {
  const timers = new Map();
  let id = 0;
  t.mock.method(
    Date,
    'now',
    () => new Date(2026, 0, 1, 13, 4, 5).getTime() + 250,
  );
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => {
    timers.set(++id, { fn, delay });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', (key) => timers.delete(key));
  for (const showSeconds of [true, false]) {
    const element = {};
    let layouts = 0;
    const controller = widgets.get('clock')(
      element,
      { clock: { hour12: false, showSeconds } },
      { onChange: () => layouts++ },
    );
    assert.equal(timers.size, 0);
    assert.equal(element.textContent, showSeconds ? '13:04:05' : '13:04');
    controller.activate();
    assert.equal(layouts, 2);
    assert.equal([...timers.values()][0].delay, showSeconds ? 750 : 54750);
    controller.dispose();
    assert.equal(timers.size, 0);
  }
});
void test('counter widgets do not schedule work until visible and release timers on disposal', (t) => {
  const timers = new Map();
  let id = 0,
    now = Date.parse('2026-09-06T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => {
    timers.set(++id, { fn, delay });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', (key) => timers.delete(key));
  const element = {};
  const controller = widgets.get('counter')(element, {
    counter: {
      direction: 'up',
      targetAt: '2026-09-06T12:00:00Z',
      unit: 'days',
    },
  });
  assert.equal(timers.size, 0);
  assert.equal(element.textContent, '0 days');
  now += 86400000;
  controller.activate();
  assert.equal(element.textContent, '1 day');
  assert.equal([...timers.values()][0].delay, 86400000);
  controller.dispose();
  assert.equal(timers.size, 0);
});
