import test from 'node:test';
import assert from 'node:assert/strict';
import {
  starterText,
  trackStarterText,
  removeUntouchedStarter,
} from '../server/starter-text.mjs';

void test('only untouched generated text is removed; editing clears its marker permanently', () => {
  const layer = {
    id: 'starter',
    type: 'text',
    text: starterText,
    starterText: true,
  };
  const slide = trackStarterText({
    layers: [layer, { ...layer, id: 'intentional', starterText: undefined }],
  });
  assert.equal(removeUntouchedStarter(slide).layers.length, 1);
  const edited = trackStarterText(
    { layers: [{ ...layer, text: 'Welcome' }] },
    slide,
  );
  assert.equal(edited.layers[0].starterText, undefined);
  const reverted = trackStarterText({ layers: [layer] }, edited);
  assert.equal(reverted.layers[0].starterText, undefined);
  assert.equal(removeUntouchedStarter(reverted).layers.length, 1);
  assert.equal(
    trackStarterText({ layers: [{ ...layer, type: 'clock' }] }).layers[0]
      .starterText,
    undefined,
  );
});
