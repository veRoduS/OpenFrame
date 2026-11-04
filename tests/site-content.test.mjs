import test from 'node:test';
import assert from 'node:assert/strict';
import { siteContentIds } from '../app/site-content.mjs';
const library = {
  groups: [
    { id: 'company' },
    { id: 'north', parentId: 'company' },
    { id: 'south', parentId: 'company' },
    { id: 'dept', parentId: 'north' },
  ],
  sites: [
    { id: 'n', siteNumber: '001', accessGroupId: 'north' },
    { id: 's', siteNumber: '002', accessGroupId: 'south' },
    { id: 'none', siteNumber: '003' },
  ],
  slides: [
    { id: 'shared', groupIds: ['company'], layers: [] },
    { id: 'local', groupIds: ['dept'], layers: [{ assetId: 'image' }] },
    { id: 'south', groupIds: ['south'], layers: [] },
    { id: 'private', layers: [] },
    { id: 'assigned', layers: [{ assetId: 'assigned-image' }] },
  ],
  playlists: [
    { id: 'playlist', items: [{ slideId: 'assigned' }] },
    { id: 'group-playlist', groupIds: ['north'], items: [] },
  ],
  assets: [
    { id: 'image' },
    { id: 'assigned-image' },
    { id: 'shared-image', accessTags: [{ type: 'group', id: 'company' }] },
    { id: 'private-image' },
  ],
  devices: [{ id: 'tv', siteId: 'none', playlistId: 'playlist' }],
};
void test('site associations include shared ancestors and subgroups without including sibling stores', () => {
  const ids = siteContentIds(library, 'n');
  assert.deepEqual([...ids.slides], ['shared', 'local']);
  assert.deepEqual([...ids.assets], ['shared-image', 'image']);
  assert.deepEqual([...ids.playlists], ['group-playlist']);
});
void test('screen assignments associate personal content and media even without a site access group', () => {
  const ids = siteContentIds(library, 'none');
  assert.deepEqual([...ids.playlists], ['playlist']);
  assert.deepEqual([...ids.slides], ['assigned']);
  assert.deepEqual([...ids.assets], ['assigned-image']);
});
void test('unassigned excludes any known site association and unknown sites show no results', () => {
  assert.deepEqual(
    [...siteContentIds(library, 'unassigned').slides],
    ['private'],
  );
  assert.deepEqual(
    [...siteContentIds(library, 'unassigned').assets],
    ['private-image'],
  );
  assert.equal(siteContentIds(library, '').slides.size, 5);
  assert.equal(siteContentIds(library, 'missing').slides.size, 0);
});
void test('associations are derived without changing library objects and group cycles remain bounded', () => {
  const input = structuredClone(library);
  input.groups.push({ id: 'loop', parentId: 'loop' });
  input.slides.push({ id: 'cycle', groupIds: ['loop'] });
  const before = JSON.stringify(input);
  siteContentIds(input, 'n');
  assert.equal(JSON.stringify(input), before);
});
