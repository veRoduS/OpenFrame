import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateAndroidRelease } from '../server/android-releases.mjs';
import { verifyAndroidApk } from './verify-android-apk.mjs';

export const androidRepository = 'veRoduS/OpenFrame';
export const androidBranch = 'android-releases';
const root = fileURLToPath(new URL('..', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const formatted = (value) => `${JSON.stringify(value, null, 2)}\n`;

function rejectUnsafeEntries(directory) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('APK publication requires regular directories and files');
  for (const name of readdirSync(directory)) {
    if (name === '.git') continue;
    const file = join(directory, name);
    const entry = lstatSync(file);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
      throw new Error('APK publication requires regular directories and files');
    if (entry.isDirectory()) rejectUnsafeEntries(file);
  }
}

/** Only these files are uploaded; no workspace archive or signing files. */
export function stageAndroidPublication(output, checkout, compatibility) {
  rejectUnsafeEntries(checkout);
  const input = json(join(output, 'latest.json'));
  const release = validateAndroidRelease(input);
  delete release.available;
  if (input.sourceCommit && /^[a-f0-9]{40}$/.test(input.sourceCommit))
    release.sourceCommit = input.sourceCommit;
  if (
    typeof input.signerSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(input.signerSha256)
  )
    release.signerSha256 = input.signerSha256;
  if (compatibility) release.compatibility = compatibility;
  const bytes = readFileSync(
    join(output, `openframe-player-${release.versionName}.apk`),
  );
  if (bytes.length !== release.size || digest(bytes) !== release.sha256)
    throw new Error('APK does not match latest.json');
  const latest = join(checkout, 'apks/latest.json');
  if (
    existsSync(latest) &&
    validateAndroidRelease(json(latest)).versionCode > release.versionCode
  )
    throw new Error(
      'Refusing to move the latest Android download to an older version',
    );
  const versionDir = join(checkout, 'apks', release.versionName);
  const archived = join(versionDir, 'release.json');
  const apk = join(versionDir, 'openframe-player.apk');
  let published = release;
  if (existsSync(versionDir)) {
    if (!existsSync(archived) || !existsSync(apk))
      throw new Error(
        'Existing Android version is incomplete; inspect the APK branch',
      );
    published = json(archived);
    const previous = validateAndroidRelease(published);
    if (
      previous.sha256 !== release.sha256 ||
      previous.versionCode !== release.versionCode ||
      previous.minSdk !== release.minSdk ||
      previous.size !== release.size ||
      digest(readFileSync(apk)) !== release.sha256
    )
      throw new Error(
        'This Android version is already published with different bytes or requirements. Bump the player version.',
      );
    // An archived release and its compatibility record never change on retry.
  } else {
    mkdirSync(versionDir, { recursive: true });
    writeFileSync(apk, bytes);
    writeFileSync(archived, formatted(release));
  }
  mkdirSync(join(checkout, 'apks/latest'), { recursive: true });
  writeFileSync(join(checkout, 'apks/latest/openframe-player.apk'), bytes);
  writeFileSync(latest, formatted(published));
  const readme = join(checkout, 'README.md');
  if (!existsSync(readme))
    writeFileSync(
      readme,
      `# OpenFrame Android APKs

Signed Android player builds are kept in the [apks](apks) folder. Each version is immutable.

- [Download the latest APK](https://raw.githubusercontent.com/${androidRepository}/${androidBranch}/apks/latest/openframe-player.apk)
- [Latest update metadata](apks/latest.json)
- [Source and server](https://github.com/${androidRepository})

Server and player versions advance independently. Each release's metadata records compatibility review details when available. Android requires approval to install updates. Keep the same signing key for in-place updates.

Only APKs and public release metadata belong on this branch. Never add signing keys, passwords, provisioning files, or player data.
`,
    );
  return release;
}

export function publishAndroid({
  output,
  remote,
  author,
  compatibility,
  env = process.env,
}) {
  const checkout = mkdtempSync(join(tmpdir(), 'openframe-apk-publish-'));
  const git = (args, options = {}) =>
    execFileSync('git', args, {
      cwd: checkout,
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
  try {
    git(['init', '-q', `--initial-branch=${androidBranch}`]);
    git(['remote', 'add', 'origin', remote]);
    let exists = true;
    try {
      git([
        'ls-remote',
        '--exit-code',
        '--heads',
        'origin',
        `refs/heads/${androidBranch}`,
      ]);
    } catch (error) {
      if (error.status === 2) exists = false;
      else throw error;
    }
    if (exists) {
      git([
        'fetch',
        '-q',
        '--depth=1',
        'origin',
        `refs/heads/${androidBranch}`,
      ]);
      git(['checkout', '-q', '-B', androidBranch, 'FETCH_HEAD']);
      const files = git(['ls-files']).trim().split('\n').filter(Boolean);
      if (
        files.some(
          (name) =>
            !/^(README\.md|apks\/(latest\.json|latest\/openframe-player\.apk|\d+\.\d+\.\d+\/(release\.json|openframe-player\.apk)))$/.test(
              name,
            ),
        )
      )
        throw new Error(
          'The Android release branch contains unexpected files; refusing to modify it',
        );
    }
    const release = stageAndroidPublication(output, checkout, compatibility);
    git(['add', '--', 'README.md', 'apks']);
    if (!git(['diff', '--cached', '--name-only']).trim())
      return { version: release.versionName, changed: false };
    if (!author?.name || !author?.email)
      throw new Error(
        'Configure Git user.name and user.email before publishing APKs',
      );
    git(['config', 'user.name', author.name]);
    git(['config', 'user.email', author.email]);
    git([
      'commit',
      '-q',
      '-m',
      `Publish Android player ${release.versionName}`,
    ]);
    // A concurrent publisher is a normal non-fast-forward failure. Never force.
    git(['push', 'origin', `HEAD:refs/heads/${androidBranch}`], {
      stdio: 'inherit',
    });
    return { version: release.versionName, changed: true };
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 2)
      throw new Error('Usage: pnpm publish:android');
    execFileSync('node', ['scripts/version.mjs', 'check'], {
      cwd: root,
      stdio: 'inherit',
    });
    execFileSync('node', ['scripts/compatibility.mjs', 'check'], {
      cwd: root,
      stdio: 'inherit',
    });
    if (
      execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      }).trim()
    )
      throw new Error(
        'Commit the reviewed source changes before publishing an APK. The built files remain in outputs/android.',
      );
    const player = json(join(root, 'player/version.json'));
    if (
      json(join(root, 'outputs/android/latest.json')).versionName !==
      player.version
    )
      throw new Error('Build the current player version before publishing');
    const metadata = json(join(root, 'outputs/android/latest.json'));
    const verified = verifyAndroidApk(
      join(root, 'outputs/android', `openframe-player-${player.version}.apk`),
      { root, version: player.version, minSdk: metadata.minSdk },
    );
    if (metadata.signerSha256 !== verified.signerSha256)
      throw new Error(
        'APK signer metadata is missing or incorrect; rebuild before publishing',
      );
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (json(join(root, 'outputs/android/latest.json')).sourceCommit !== head)
      throw new Error(
        'Rebuild the APK from the current clean source commit before publishing',
      );
    const name = execFileSync('git', ['config', 'user.name'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const email = execFileSync('git', ['config', 'user.email'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const record = json(join(root, 'compatibility.json'));
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    // GitHub Actions provides this explicitly. Local users use their normal Git credential helper.
    if (env.OPENFRAME_ANDROID_GITHUB_TOKEN) {
      const index = Number(env.GIT_CONFIG_COUNT || 0);
      env.GIT_CONFIG_COUNT = String(index + 1);
      env[`GIT_CONFIG_KEY_${index}`] = 'http.https://github.com/.extraheader';
      env[`GIT_CONFIG_VALUE_${index}`] =
        `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${env.OPENFRAME_ANDROID_GITHUB_TOKEN}`).toString('base64')}`;
    }
    const latestReview = record.reviews.at(-1);
    const compatibility = {
      protocols: record.protocols,
      reviewedWith: latestReview.versions,
      impact: latestReview.impact,
      summary: latestReview.summary,
      reviewedAt: latestReview.reviewedAt,
    };
    const result = publishAndroid({
      output: join(root, 'outputs/android'),
      remote: `https://github.com/${androidRepository}.git`,
      author: { name, email },
      compatibility,
      env,
    });
    console.log(
      `Android ${result.version}: ${result.changed ? 'published' : 'already published'} in ${androidRepository}/${androidBranch}/apks`,
    );
  } catch (error) {
    console.error(
      `Android upload failed: ${error.message}. The local APK is preserved; retry pnpm publish:android after resolving the error.`,
    );
    process.exitCode = 1;
  }
}
