import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { shapeGeometry } from '../player/web/shape.js';
import { layerSchema } from '../server/schema.mjs';
const slide = { width: 1920, height: 1080 };
void test('shape outlines stay inside their bounds and corner radius clamps to the smaller side', () => {
  const layer = {
    width: 20,
    height: 10,
    shape: {
      kind: 'rectangle',
      fill: '#ffffff',
      outline: '#123456',
      outlineWidth: 4,
      cornerRadius: 1000,
    },
  };
  const shape = shapeGeometry(layer, slide);
  assert.equal(shape.width, 384);
  assert.equal(shape.height, 108);
  assert.equal(shape.attributes.width, 380);
  assert.equal(shape.attributes.rx, 52);
  assert.equal(shape.attributes.x, 2);
  assert.equal(shape.attributes.fill, '#ffffff');
  const circle = shapeGeometry(
    { ...layer, shape: { ...layer.shape, kind: 'circle', fillEnabled: false } },
    slide,
  );
  assert.equal(circle.tag, 'circle');
  assert.equal(circle.attributes.r, 52);
  assert.equal(circle.attributes.fill, 'none');
});
void test('shape configuration validates paint colors, border widths, radius, and required configuration', () => {
  const layer = {
    id: randomUUID(),
    type: 'shape',
    x: 0,
    y: 0,
    width: 20,
    height: 10,
    shape: { kind: 'rectangle' },
  };
  assert.equal(layerSchema.parse(layer).shape.cornerRadius, 0);
  for (const shape of [
    undefined,
    { kind: 'triangle' },
    { fill: 'url(https://foreign.example)' },
    { outlineWidth: -1 },
    { cornerRadius: -1 },
  ])
    assert.throws(() => layerSchema.parse({ ...layer, shape }));
});
