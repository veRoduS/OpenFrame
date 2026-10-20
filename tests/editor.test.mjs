import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeLayer, arrangeLayers } from '../app/geometry.mjs';
import { visibleMedia, parseTags } from '../app/media-utils.mjs';
import { fitFontSize, layoutText } from '../player/web/text-layout.js';
import { layerSchema } from '../server/schema.mjs';

const frame = { x: 20, y: 20, width: 40, height: 30 };
const arrangement = [
  { id: 'a', x: 5, y: 5, width: 10, height: 10 },
  { id: 'b', x: 22, y: 30, width: 20, height: 20 },
  { id: 'c', x: 70, y: 70, width: 15, height: 15 },
  { id: 'other', x: 1, y: 1, width: 5, height: 5 },
];
const arrangedIds = ['a', 'b', 'c'];
void test('alignment uses selected outer bounds, preserves dimensions and unselected layers', () => {
  for (const action of ['left', 'center', 'right', 'top', 'middle', 'bottom']) {
    const result = arrangeLayers(arrangement, arrangedIds, action);
    const horizontal = ['left', 'center', 'right'].includes(action);
    const axis = horizontal ? 'x' : 'y',
      size = horizontal ? 'width' : 'height';
    const expected = ['left', 'top'].includes(action)
      ? 5
      : ['right', 'bottom'].includes(action)
        ? 85
        : 45;
    for (const layer of result.slice(0, 3)) {
      assert.equal(
        layer[axis] +
          (['left', 'top'].includes(action)
            ? 0
            : ['right', 'bottom'].includes(action)
              ? layer[size]
              : layer[size] / 2),
        expected,
      );
      assert.ok(
        layer.x >= 0 &&
          layer.y >= 0 &&
          layer.x + layer.width <= 100 &&
          layer.y + layer.height <= 100,
      );
      const original = arrangement.find((item) => item.id === layer.id);
      assert.equal(layer.width, original.width);
      assert.equal(layer.height, original.height);
    }
    assert.equal(result[3], arrangement[3]);
  }
  assert.equal(arrangement[1].x, 22, 'input is never mutated');
});
void test('distribution equalizes gaps for unequal sizes, retaining both outer edges', () => {
  for (const action of ['horizontal', 'vertical']) {
    const result = arrangeLayers(arrangement, ['c', 'a', 'b'], action);
    const axis = action === 'horizontal' ? 'x' : 'y',
      size = action === 'horizontal' ? 'width' : 'height';
    assert.equal(result[0][axis], 5);
    assert.equal(result[2][axis] + result[2][size], 85);
    assert.equal(
      result[1][axis] - result[0][axis] - result[0][size],
      result[2][axis] - result[1][axis] - result[1][size],
    );
    assert.equal(
      arrangeLayers(result, arrangedIds, action),
      result,
      'repeating is a no-op',
    );
  }
});
void test('arrangement rejects locked, undersized, unknown and crowded operations atomically', () => {
  for (const lockMode of ['movement', 'full']) {
    const layers = arrangement.map((layer, i) =>
      i === 1 ? { ...layer, lockMode } : layer,
    );
    for (const action of ['left', 'horizontal', 'top', 'vertical'])
      assert.equal(arrangeLayers(layers, arrangedIds, action), layers);
    assert.notEqual(
      arrangeLayers(layers, ['a', 'c'], 'left'),
      layers,
      'unselected locks do not interfere',
    );
  }
  assert.equal(arrangeLayers(arrangement, ['a'], 'left'), arrangement);
  assert.equal(
    arrangeLayers(arrangement, ['a', 'b'], 'horizontal'),
    arrangement,
  );
  assert.equal(arrangeLayers(arrangement, arrangedIds, 'unknown'), arrangement);
  const crowded = arrangement
    .slice(0, 3)
    .map((layer, i) => ({ ...layer, x: i * 5, width: 30 }));
  assert.equal(arrangeLayers(crowded, arrangedIds, 'horizontal'), crowded);
});
void test('corner resizing keeps the opposite corner fixed and preserves proportions', () => {
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    const result = resizeLayer(
      frame,
      corner,
      corner.includes('w') ? -12 : 12,
      corner.includes('n') ? -9 : 9,
      true,
    );
    assert.ok(Math.abs(result.width / result.height - 4 / 3) < 0.00001);
    assert.equal(
      corner.includes('w') ? result.x + result.width : result.x,
      corner.includes('w') ? 60 : 20,
    );
    assert.equal(
      corner.includes('n') ? result.y + result.height : result.y,
      corner.includes('n') ? 50 : 20,
    );
    assert.equal(result.width, 52);
  }
});
void test('resizing clamps at every canvas edge without flipping or escaping', () => {
  for (const corner of ['nw', 'ne', 'sw', 'se'])
    for (const locked of [true, false])
      for (const delta of [-500, 500]) {
        const r = resizeLayer(frame, corner, delta, delta, locked);
        assert.ok(r.x >= -0.00001 && r.y >= -0.00001);
        assert.ok(r.x + r.width <= 100.00001 && r.y + r.height <= 100.00001);
        assert.ok(r.width >= 1 && r.height >= 1);
      }
  const free = resizeLayer(frame, 'se', 20, 0, false);
  assert.equal(free.width, 60);
  assert.equal(free.height, 30);
});
void test('auto-fit finds the largest size satisfying both layout constraints', () => {
  const size = fitFontSize((candidate) => candidate <= 47.3, 160);
  assert.ok(size <= 47.3 && size > 47);
  const narrow = fitFontSize(
    (candidate) => candidate * 20 <= 100 && candidate * 2 <= 50,
    100,
  );
  assert.ok(narrow <= 5 && narrow > 4.75);
});
void test('shared text layout supports vertical alignment and fixed-size fallback', () => {
  const box = { style: {}, clientWidth: 100, clientHeight: 80 };
  const content = {
    style: {},
    textContent: 'A multiline message',
    get scrollWidth() {
      return parseFloat(this.style.fontSize) * 5;
    },
    get scrollHeight() {
      return parseFloat(this.style.fontSize) * 4;
    },
  };
  layoutText(
    box,
    content,
    { verticalAlign: 'middle', autoSize: true, fontSize: 90 },
    1,
  );
  assert.equal(box.style.justifyContent, 'center');
  assert.ok(
    parseFloat(content.style.fontSize) <= 20 &&
      parseFloat(content.style.fontSize) > 19.75,
  );
  layoutText(
    box,
    content,
    { verticalAlign: 'bottom', autoSize: false, fontSize: 90 },
    0.5,
  );
  assert.equal(box.style.justifyContent, 'flex-end');
  assert.equal(content.style.fontSize, '45px');
  layoutText(box, content, { fontSize: 90 }, 1);
  assert.equal(box.style.justifyContent, 'flex-start');
});
void test('old layer documents default to top alignment and manual sizing', () => {
  const layer = layerSchema.parse({
    id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    type: 'text',
    ...frame,
  });
  assert.equal(layer.verticalAlign, 'top');
  assert.equal(layer.autoSize, false);
  assert.equal(layer.lockAspect, true);
  assert.equal(
    layerSchema.safeParse({ ...layer, verticalAlign: 'sideways' }).success,
    false,
  );
});
void test('media search, folder and tag filters compose without changing the source order', () => {
  const assets = [
    {
      id: '1',
      name: 'Lobby 10',
      tags: ['summer'],
      folderId: 'f',
      bytes: 40,
      createdAt: '2026-09-01',
    },
    {
      id: '2',
      name: 'Lobby 2',
      tags: ['summer', 'event'],
      folderId: null,
      bytes: 90,
      createdAt: '2026-09-03',
    },
    {
      id: '3',
      name: 'Menu',
      tags: ['winter'],
      folderId: 'f',
      bytes: 10,
      createdAt: null,
    },
  ];
  assert.deepEqual(
    visibleMedia(assets, { search: 'SUMMER', folder: 'f' }).map((a) => a.id),
    ['1'],
  );
  assert.deepEqual(
    visibleMedia(assets, { tag: 'summer', sort: 'name' }).map((a) => a.id),
    ['2', '1'],
  );
  assert.deepEqual(
    visibleMedia(assets, { folder: 'unfiled' }).map((a) => a.id),
    ['2'],
  );
  assert.equal(visibleMedia(assets, { sort: 'largest' })[0].id, '2');
  assert.equal(visibleMedia(assets, { sort: 'oldest' })[0].id, '3');
  assert.deepEqual(
    assets.map((a) => a.id),
    ['1', '2', '3'],
  );
  assert.deepEqual(parseTags(' Summer, event, summer, , '), [
    'summer',
    'event',
  ]);
});
