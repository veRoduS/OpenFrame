import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
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
const name = `openframe-player-${version}.apk`;
const apk = resolve(output, name);
copyFileSync(
  sdkOnly
    ? buildWithSdk(root, version)
    : resolve(android, 'app/build/outputs/apk/release/app-release.apk'),
  apk,
);
const bytes = readFileSync(apk);
const checksum = `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`;
writeFileSync(resolve(output, `${name}.sha256`), checksum);
const instructions = `OpenFrame Player ${version} — Android TV USB installation

Requires Android 9 or newer and Android System WebView 100 or newer.
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
This is an experimental build; physical Android TV acceptance is still required.
See the included android-tv.md for supported features and build/key backup details.
`;
writeFileSync(resolve(output, 'INSTALL.txt'), instructions);
writeFileSync(
  resolve(output, `openframe-player-${version}-usb.zip`),
  zipSync({
    [name]: bytes,
    [`${name}.sha256`]: strToU8(checksum),
    'INSTALL.txt': strToU8(instructions),
    'android-tv.md': readFileSync(resolve(root, 'docs/android-tv.md')),
  }),
);
console.log(`USB installer ready: ${apk}`);
