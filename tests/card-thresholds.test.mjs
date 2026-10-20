import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCardThreshold } from '../player/web/data-cards.js';
import { dataWidgetSchema } from '../server/data-feeds.mjs';

const config = (card = {}, extra = {}) => ({
  mode: 'metric',
  card: {
    thresholdMode: 'higher',
    thresholdGoal: 95,
    thresholdWarning: 90,
    ...card,
  },
  ...extra,
});
const ready = { status: 'ready', data: { goal: 92 } };
void test('higher thresholds compare unrounded values with inclusive green and yellow boundaries', () => {
  for (const [value, expected] of [
    [0, 'red'],
    [89.9999, 'red'],
    [90, 'yellow'],
    [94.9999, 'yellow'],
    [95, 'green'],
    [100, 'green'],
  ])
    assert.equal(evaluateCardThreshold(config(), ready, value).state, expected);
});
void test('lower thresholds support zero, negative and fractional goals', () => {
  for (const [value, expected] of [
    [-1, 'green'],
    [0, 'green'],
    [0.01, 'yellow'],
    [5, 'yellow'],
    [5.01, 'red'],
  ])
    assert.equal(
      evaluateCardThreshold(
        config({
          thresholdMode: 'lower',
          thresholdGoal: 0,
          thresholdWarning: 5,
        }),
        ready,
        value,
      ).state,
      expected,
    );
  assert.equal(
    evaluateCardThreshold(
      config({ thresholdGoal: -2.5, thresholdWarning: -10 }),
      ready,
      -2.5,
    ).state,
    'green',
  );
});
void test('gauge colors follow live targets, custom overrides, and equal cutoffs', () => {
  const gauge = config(
    {},
    { mode: 'progress', target: 100, targetField: 'goal' },
  );
  assert.equal(evaluateCardThreshold(gauge, ready, 92).state, 'green');
  assert.equal(
    evaluateCardThreshold(gauge, { ...ready, data: { goal: 96 } }, 92).state,
    'yellow',
  );
  assert.equal(
    evaluateCardThreshold({ ...gauge, targetField: '', target: 94 }, ready, 94)
      .state,
    'green',
  );
  const custom = {
    ...gauge,
    card: { ...gauge.card, thresholdUseTarget: false, thresholdGoal: 95 },
  };
  assert.equal(evaluateCardThreshold(custom, ready, 94).state, 'yellow');
  assert.equal(
    evaluateCardThreshold(config({ thresholdWarning: 95 }), ready, 94.99).state,
    'red',
  );
});
void test('disabled, missing, unavailable and malformed data cannot show success', () => {
  for (const value of [null, undefined, NaN, Infinity, '95'])
    assert.equal(evaluateCardThreshold(config(), ready, value).state, 'none');
  assert.equal(
    evaluateCardThreshold(config({ thresholdMode: 'off' }), ready, 100).color,
    null,
  );
  assert.equal(
    evaluateCardThreshold(config(), { status: 'unavailable' }, 100).state,
    'none',
  );
  for (const card of [
    { thresholdWarning: 96 },
    { thresholdGoal: Infinity },
    { thresholdWarning: '90' },
    { thresholdGoal: 1e12 + 1 },
  ])
    assert.equal(
      evaluateCardThreshold(config(card), ready, 100).state,
      'unknown',
    );
  const missing = evaluateCardThreshold(
    config({}, { mode: 'progress', targetField: 'missing' }),
    ready,
    100,
  );
  assert.equal(missing.message, 'Goal unavailable');
  assert.equal(missing.color, null);
});
void test('server validates bounded thresholds and cutoff ordering while preserving inactive settings', () => {
  for (const card of [
    { thresholdMode: 'bad' },
    { thresholdUseTarget: 'true' },
    { thresholdGoal: 1e12 + 1 },
    { thresholdWarning: -1e12 - 1 },
    { thresholdGoal: NaN },
    { thresholdWarning: null },
  ])
    assert.equal(dataWidgetSchema.safeParse(config(card)).success, false);
  assert.equal(
    dataWidgetSchema.safeParse(config({ thresholdWarning: 96 })).success,
    false,
  );
  assert.equal(
    dataWidgetSchema.safeParse(
      config({ thresholdMode: 'lower', thresholdGoal: 0, thresholdWarning: 5 }),
    ).success,
    true,
  );
  assert.equal(
    dataWidgetSchema.safeParse(
      config({ thresholdMode: 'lower', thresholdWarning: 90 }),
    ).success,
    false,
  );
  assert.equal(
    dataWidgetSchema.safeParse(
      config({ thresholdMode: 'off', thresholdWarning: 96 }),
    ).success,
    true,
  );
  assert.equal(
    dataWidgetSchema.safeParse(config({ style: 'plain', thresholdWarning: 96 }))
      .success,
    true,
  );
  assert.equal(
    dataWidgetSchema.safeParse(
      config({ thresholdWarning: 90 }, { mode: 'progress', target: 60 }),
    ).success,
    false,
  );
  assert.equal(
    dataWidgetSchema.safeParse(
      config(
        { thresholdWarning: 90 },
        { mode: 'progress', targetField: 'goal' },
      ),
    ).success,
    true,
  );
  assert.equal(
    dataWidgetSchema.safeParse(
      config(
        { thresholdUseTarget: false, thresholdGoal: 0, thresholdWarning: -10 },
        { mode: 'progress' },
      ),
    ).success,
    true,
  );
});
