import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersion } from './version.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const files = [
  ...new Set(
    execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter(Boolean),
  ),
];
const privatePath =
  /(^|\/)(data|backups|node_modules|\.pnpm-store|\.secrets|player-cache|work|outputs|dist|\.openai)(\/|$)|(^|\/)(openframe|identity)\.json$|(^|\/)openframe-screen-.*\.zip$|\.private\.json$|\.(conf|pem|key|p12|pfx|db|img)(\.|$)|\.sqlite|\.tar\.gz$/i;
for (const file of files) {
  const example = file.endsWith('.example') || file.endsWith('.example.json');
  if (
    !example &&
    (privatePath.test(file) ||
      /(^|\/)(\.env|(?:server-key|recovery)\.json$)/.test(file))
  )
    failures.push(`Private/generated path: ${file}`);
  const full = resolve(root, file);
  if (!existsSync(full)) continue;
  const content = readFileSync(full, 'utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content))
    failures.push(`Private key material: ${file}`);
  if (!file.endsWith('.md')) continue;
  // Check repository-relative inline links used by our docs, without fetching external URLs.
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    if (!existsSync(resolve(dirname(full), decodeURIComponent(target))))
      failures.push(`Broken link in ${file}: ${target}`);
  }
}
const { pkg } = checkVersion(root);
if (process.env.GITHUB_REF_TYPE === 'tag') {
  const tag = process.env.GITHUB_REF_NAME;
  if (tag !== `v${pkg.version}` || !pkg.version.endsWith('.0'))
    failures.push(
      'Release tag must match package version and have a zero patch',
    );
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Checked ${files.length} candidate files, documentation links, and version ${pkg.version}. Review content for secrets manually before committing.`,
  );
