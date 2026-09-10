import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(
    new URL('../app/use-unsaved-navigation.ts', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    emit(type, event = {}) {
      listeners.get(type)?.forEach((callback) => callback(event));
    },
  };
}
// Effect/ref harness tests the guard's state machine, not browser history implementation.
function fixture(t) {
  const window = events(),
    document = events(),
    slots = [],
    effects = [],
    entries = [null];
  let cursor = 0,
    position = 0,
    dirty = true,
    closed = 0;
  const location = {
    href: 'http://test.local/',
    assign: (url) => {
      location.href = url;
    },
  };
  const history = {
    get state() {
      return entries[position];
    },
    get length() {
      return entries.length;
    },
    pushState(value) {
      entries.splice(++position);
      entries.push(value);
    },
    replaceState(value) {
      entries[position] = value;
    },
    back() {
      if (position > 0) {
        position--;
        queueMicrotask(() => window.emit('popstate'));
      }
    },
  };
  const react = {
    useRef(value) {
      const index = cursor++;
      return (slots[index] ??= { current: value });
    },
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = value;
      return [
        slots[index],
        (next) => {
          slots[index] = next;
        },
      ];
    },
    useEffect(setup) {
      const index = cursor++;
      if (!(index in slots)) {
        slots[index] = true;
        effects.push({ setup });
      }
    },
  };
  class Element {
    closest() {
      return this;
    }
    hasAttribute() {
      return false;
    }
  }
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: () => react,
    window,
    document,
    history,
    location,
    Element,
  });
  function render() {
    cursor = 0;
    return exports.useUnsavedNavigation(dirty, () => {
      closed++;
    });
  }
  render();
  for (const effect of effects) effect.cleanup = effect.setup();
  t.after(() => effects.forEach((effect) => effect.cleanup()));
  return {
    window,
    document,
    history,
    location,
    Element,
    render,
    get closed() {
      return closed;
    },
    setDirty(value) {
      dirty = value;
      render();
    },
    replayEffects() {
      effects.forEach((effect) => {
        effect.cleanup();
        effect.cleanup = effect.setup();
      });
    },
  };
}

void test('dirty Back asks before leaving; cancel retains the editor and save/discard continuation closes once', async (t) => {
  const f = fixture(t);
  f.render().requestLeave();
  assert.equal(f.render().confirmOpen, true);
  assert.equal(f.closed, 0);
  f.render().cancel();
  assert.equal(f.render().confirmOpen, false);
  f.render().requestLeave();
  // The editor calls leave only after save succeeds, or explicit discard.
  f.setDirty(false);
  f.render().leave();
  f.render().leave();
  await Promise.resolve();
  assert.equal(f.closed, 1);
});
void test('browser Back restores a guard while dirty and continues only after confirmation', async (t) => {
  const f = fixture(t);
  f.history.back();
  await Promise.resolve();
  assert.equal(f.render().confirmOpen, true);
  assert.equal(f.closed, 0);
  assert.ok(f.history.state.openframeEditor);
  f.render().cancel();
  f.history.back();
  await Promise.resolve();
  assert.equal(f.render().confirmOpen, true);
  f.render().leave();
  await Promise.resolve();
  assert.equal(f.closed, 1);
});
void test('clean navigation does not ask, and StrictMode effect replay adds no extra history entry', async (t) => {
  const f = fixture(t);
  assert.equal(f.history.length, 2);
  f.replayEffects();
  assert.equal(f.history.length, 2);
  f.setDirty(false);
  f.history.back();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.closed, 1);
  assert.equal(f.render().confirmOpen, false);
});
void test('same-window links preserve their destination until save-and-continue', async (t) => {
  const f = fixture(t),
    anchor = new f.Element();
  anchor.href = 'http://test.local/destination';
  anchor.target = '';
  let prevented = false;
  f.document.emit('click', {
    target: anchor,
    button: 0,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(f.render().confirmOpen, true);
  assert.equal(f.location.href, 'http://test.local/');
  f.setDirty(false);
  f.render().leave();
  await Promise.resolve();
  assert.equal(f.location.href, anchor.href);
  assert.equal(f.closed, 0);
});
void test('reload or tab close requests the native unsaved warning only while dirty', (t) => {
  const f = fixture(t);
  let warnings = 0;
  const event = {
    preventDefault() {
      warnings++;
    },
  };
  f.window.emit('beforeunload', event);
  assert.equal(warnings, 1);
  f.setDirty(false);
  f.window.emit('beforeunload', event);
  assert.equal(warnings, 1);
});
