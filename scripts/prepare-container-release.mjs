import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersion } from './version.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

export function releaseMetadata(tag, version, repository) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.0$/.test(tag) || tag !== `v${version}`)
    throw new Error('Tag must match the package version and end in .0');
  if (!/^[\w-]+\/[\w.-]+$/.test(repository))
    throw new Error('Invalid GitHub repository');
  return { version, image: `ghcr.io/${repository.toLowerCase()}` };
}

export function bundleEnvironment(image, digest) {
  if (
    !/^ghcr\.io\/[a-z0-9_-]+\/[a-z0-9_.-]+$/.test(image) ||
    !/^sha256:[a-f0-9]{64}$/.test(digest)
  )
    throw new Error('A valid registry image and immutable digest are required');
  return `OPENFRAME_IMAGE=${image}@${digest}\nOPENFRAME_PORT=3100\nOPENFRAME_BIND_ADDRESS=0.0.0.0\nPUBLIC_URL=\nCOOKIE_SECURE=false\n`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { pkg } = checkVersion(root);
  if (process.argv[2] === 'bundle') {
    const env = bundleEnvironment(process.env.IMAGE, process.env.IMAGE_DIGEST);
    const output = resolve(root, 'outputs/compose-stack');
    mkdirSync(output, { recursive: true });
    copyFileSync(
      resolve(root, 'compose.registry.yaml'),
      resolve(output, 'compose.yaml'),
    );
    copyFileSync(
      resolve(root, 'docs/container-images.md'),
      resolve(output, 'README.md'),
    );
    writeFileSync(resolve(output, '.env.example'), env);
  } else {
    const metadata = releaseMetadata(
      process.env.RELEASE_TAG,
      pkg.version,
      process.env.GITHUB_REPOSITORY,
    );
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${metadata.version}\nimage=${metadata.image}\nsha=${sha}\n`,
    );
  }
}
