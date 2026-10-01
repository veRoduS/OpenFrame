import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { buildWithSdk } from './android-sdk-build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
);
for (const key of [
  'OPENFRAME_ANDROID_KEYSTORE',
  'OPENFRAME_ANDROID_STORE_PASSWORD',
  'OPENFRAME_ANDROID_KEY_ALIAS',
  'OPENFRAME_ANDROID_KEY_PASSWORD',
]) {
  if (!process.env[key]) throw new Error(`Set ${key}; see docs/android-tv.md`);
}
const android = resolve(root, 'player/android');
const windows = process.platform === 'win32';
const sdkOnly = process.argv.includes('--sdk');
if (!sdkOnly)
  execFileSync(
    windows ? 'cmd.exe' : './gradlew',
    windows
      ? [
          '/d',
          '/c',
          'gradlew.bat',
          'testDebugUnitTest',
          'lintRelease',
          'assembleRelease',
        ]
      : ['testDebugUnitTest', 'lintRelease', 'assembleRelease'],
    { cwd: android, stdio: 'inherit' },
  );
const output = resolve(root, 'outputs/android');
mkdirSync(output, { recursive: true });
chmodSync(output, 0o755);
const name = `openframe-player-${version}.apk`;
const apk = resolve(output, name);
const temporaryApk = `${apk}.part`;
copyFileSync(
  sdkOnly
    ? buildWithSdk(root, version)
    : resolve(android, 'app/build/outputs/apk/release/app-release.apk'),
  temporaryApk,
);
chmodSync(temporaryApk, 0o644);
renameSync(temporaryApk, apk);
const bytes = readFileSync(apk);
const checksum = `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`;
writeFileSync(resolve(output, `${name}.sha256`), checksum);
chmodSync(resolve(output, `${name}.sha256`), 0o644);
const [major, minor, patch] = version.split('.').map(Number);
const release = {
  packageName: 'org.openframe.player',
  versionName: version,
  versionCode: major * 1000000 + minor * 1000 + patch,
  minSdk: 28,
  size: bytes.length,
  sha256: checksum.split(' ')[0],
  apkUrl: `/downloads/android/${name}`,
};
writeFileSync(
  resolve(output, 'latest.json.part'),
  `${JSON.stringify(release, null, 2)}\n`,
);
chmodSync(resolve(output, 'latest.json.part'), 0o644);
renameSync(resolve(output, 'latest.json.part'), resolve(output, 'latest.json'));
const instructions = `OpenFrame Player ${version} — Android TV installation

Requires Android 9 or newer and Android System WebView 100 or newer.
Without USB, download from your OpenFrame homepage or transfer the APK over Wi-Fi.
The stable server address is /downloads/android/openframe-player.apk.

USB installation:
1. Copy ${name} to a USB flash drive readable by your box (usually FAT32).
2. Insert the drive into the Android TV box and open a USB-capable file manager.
3. Select the APK. If prompted, allow that file manager to install unknown apps.
4. Choose Install, then open OpenFrame Player from the TV app launcher.
5. Enter your OpenFrame server address and a screen name with the remote.
6. On the server, approve the displayed code under Screens and assign a published playlist.

Installation works offline. Initial pairing and content download require the server.
After a successful sync, downloaded content plays offline while the app stays open.
Back or Menu opens settings. Reopen the app after restarting the box.
For updates, install a newer APK signed with the same key without uninstalling.
This player also checks its configured server for updates every six hours while open.
Use Back/Menu > Check for updates to download and open Android's installer.
Android requires installation approval; updates are not silent.

Server release files: deploy ${name} first, then latest.json into ANDROID_RELEASE_DIR.
For Docker, see the included guide and compose.android.yaml in the source repository.
This is an experimental build; physical Android TV acceptance is still required.
See the included android-tv.md for supported features and build/key backup details.
`;
writeFileSync(resolve(output, 'INSTALL.txt'), instructions);
chmodSync(resolve(output, 'INSTALL.txt'), 0o644);
writeFileSync(
  resolve(output, `openframe-player-${version}-usb.zip`),
  zipSync({
    [name]: bytes,
    [`${name}.sha256`]: strToU8(checksum),
    'latest.json': strToU8(`${JSON.stringify(release, null, 2)}\n`),
    'INSTALL.txt': strToU8(instructions),
    'android-tv.md': readFileSync(resolve(root, 'docs/android-tv.md')),
  }),
);
chmodSync(resolve(output, `openframe-player-${version}-usb.zip`), 0o644);
console.log(`Android installer and server update metadata ready: ${apk}`);
