import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const url = new URL('../app/canvas.tsx', import.meta.url);
const require = createRequire(url);
const source = ts.transpileModule(readFileSync(url, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const exports = {};
// Exercise actual canvas handlers with modeled hooks and pointer capture, not browser layout.
vm.runInNewContext(source, {
  exports,
  require: (name) =>
    name === 'react'
      ? {
          useRef: () => ({
            current: {
              getBoundingClientRect: () => ({ width: 1000, height: 500 }),
            },
          }),
          useState: (value) => [value, () => {}],
          useEffect: () => {},
          useLayoutEffect: () => {},
        }
      : require(name),
});

function handles(type, options = {}) {
  const changes = [];
  const layer = {
    id: 'layer',
    type,
    x: 10,
    y: 10,
    width: 40,
    height: 30,
    lockAspect: true,
  };
  const tree = exports.SlideCanvas({
    slide: { width: 1920, height: 1080, layers: [layer] },
    assets: [],
    selected: layer.id,
    interactive: true,
    onResize: (id, geometry) => changes.push({ id, ...geometry }),
    ...options,
  });
  const result = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node?.props) return;
    if (node.props.className?.startsWith('resize-handle ')) result.push(node);
    visit(node.props.children);
  }
  visit(tree);
  return { result, changes };
}

void test('both widget types expose four accessible corner handles only in editing mode', () => {
  for (const type of ['clock', 'counter']) {
    const { result } = handles(type);
    assert.equal(result.length, 4);
    assert.equal(result[0].props['aria-label'], `Resize ${type} top left`);
    assert.equal(handles(type, { interactive: false }).result.length, 0);
    assert.equal(handles(type, { selected: null }).result.length, 0);
  }
  assert.equal(handles('image', { cropMode: true }).result.length, 0);
});

void test('widget keyboard resizing changes width independently and image proportions stay locked', () => {
  for (const type of ['clock', 'counter', 'image']) {
    const { result, changes } = handles(type);
    result[3].props.onKeyDown({
      key: 'ArrowRight',
      shiftKey: true,
      preventDefault() {},
    });
    assert.equal(changes[0].width, 45);
    assert.equal(changes[0].height, type === 'image' ? 33.75 : 30);
  }
});

void test('widget pointer resizing uses slide coordinates and removes gesture listeners', () => {
  const { result, changes } = handles('counter');
  const listeners = new Map();
  const handle = {
    setPointerCapture() {},
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  };
  result[3].props.onPointerDown({
    button: 0,
    clientX: 100,
    clientY: 100,
    currentTarget: handle,
    pointerId: 1,
    preventDefault() {},
    stopPropagation() {},
  });
  listeners.get('pointermove')({ clientX: 200, clientY: 125 });
  assert.deepEqual(changes[0], {
    id: 'layer',
    x: 10,
    y: 10,
    width: 50,
    height: 35,
  });
  listeners.get('pointerup')();
  assert.equal(listeners.size, 0);
});
