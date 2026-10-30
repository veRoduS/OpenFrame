import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedSiteGroup } from '../app/site-groups.ts';

const groups = [
  { id: 'a', name: 'Store 042' },
  { id: 'b', name: 'Store 1042 staff' },
  { id: 'c', name: 'District 7' },
  { id: 'd', name: 'Store #7 managers' },
];

void test('suggests the single group naming the exact site number', () => {
  assert.equal(suggestedSiteGroup('042', groups)?.id, 'a');
  assert.equal(suggestedSiteGroup(' 1042 ', groups)?.id, 'b');
});

void test('does not suggest partial, unpadded, ambiguous, or invalid matches', () => {
  assert.equal(suggestedSiteGroup('42', groups), null);
  assert.equal(suggestedSiteGroup('104', groups), null);
  assert.equal(suggestedSiteGroup('7', groups), null);
  assert.equal(suggestedSiteGroup('', groups), null);
  assert.equal(suggestedSiteGroup('04a', groups), null);
});
