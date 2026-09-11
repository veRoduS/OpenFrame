import test from 'node:test';
import assert from 'node:assert/strict';
import {
  releaseMetadata,
  bundleEnvironment,
} from '../scripts/prepare-container-release.mjs';

void test('container releases require matching milestone tags and lowercase registry names', () => {
  assert.deepEqual(releaseMetadata('v0.2.0', '0.2.0', 'veRoduS/OpenFrame'), {
    version: '0.2.0',
    image: 'ghcr.io/verodus/openframe',
  });
  for (const tag of ['main', 'v0.2.1', 'v0.3.0', 'v00.2.0', 'v0.2.0\nBAD=1'])
    assert.throws(() => releaseMetadata(tag, '0.2.0', 'veRoduS/OpenFrame'));
  assert.throws(() => releaseMetadata('v0.2.0', '0.2.0', 'bad\nREPO=value'));
});

void test('Compose bundles pin the manifest digest and reject environment injection', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  assert.match(
    bundleEnvironment('ghcr.io/verodus/openframe', digest),
    new RegExp(`^OPENFRAME_IMAGE=ghcr.io/verodus/openframe@${digest}\n`),
  );
  for (const bad of ['latest', 'sha256:123', `${digest}\nTOKEN=secret`])
    assert.throws(() => bundleEnvironment('ghcr.io/verodus/openframe', bad));
  assert.throws(() =>
    bundleEnvironment('ghcr.io/name/repo\nTOKEN=secret', digest),
  );
});
