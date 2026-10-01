// Dependency-free Android build path for environments without Maven access.
// Uses the official SDK compiler, dexer, resource packager, aligner and signer.
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import { zipSync, unzipSync } from 'fflate';

export function buildWithSdk(root, version) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('Set ANDROID_HOME to the Android SDK directory.');
  const tools = resolve(sdk, 'build-tools/35.0.0');
  const platform = resolve(sdk, 'platforms/android-35/android.jar');
  const windows = process.platform === 'win32';
  const binary = (name) => resolve(tools, `${name}${windows ? '.exe' : ''}`);
  const run = (command, args) =>
    execFileSync(command, args, { stdio: 'inherit' });
  const work = resolve(root, 'player/android/app/build/sdk');
  rmSync(work, { recursive: true, force: true });
  for (const dir of ['classes', 'dex', 'generated'])
    mkdirSync(join(work, dir), { recursive: true });
  const source = resolve(root, 'player/android/app/src/main');
  const parts = version.split('.').map(Number);
  if (
    parts.length !== 3 ||
    parts.some((n) => !Number.isInteger(n) || n < 0) ||
    parts[1] >= 1000 ||
    parts[2] >= 1000
  ) {
    throw new Error(
      'Android version requires major.minor.patch with minor/patch < 1000',
    );
  }
  const versionCode = parts[0] * 1000000 + parts[1] * 1000 + parts[2];
  const manifest = readFileSync(join(source, 'AndroidManifest.xml'), 'utf8')
    .replace('<manifest ', '<manifest package="org.openframe.player" ')
    .replaceAll('${applicationId}', 'org.openframe.player');
  writeFileSync(join(work, 'AndroidManifest.xml'), manifest);
  writeFileSync(
    join(work, 'generated/BuildConfig.java'),
    `package org.openframe.player; public final class BuildConfig { public static final String VERSION_NAME = "${version}"; }\n`,
  );
  run(binary('aapt2'), [
    'compile',
    '--dir',
    join(source, 'res'),
    '-o',
    join(work, 'resources.zip'),
  ]);
  run(binary('aapt2'), [
    'link',
    '-o',
    join(work, 'resources.apk'),
    '--manifest',
    join(work, 'AndroidManifest.xml'),
    '-I',
    platform,
    '--min-sdk-version',
    '28',
    '--target-sdk-version',
    '35',
    '--version-code',
    String(versionCode),
    '--version-name',
    version,
    '-A',
    resolve(root, 'player/web'),
    join(work, 'resources.zip'),
  ]);
  const javaSource = join(source, 'java/org/openframe/player');
  // The compiler module also works on JDK installations without a javac launcher.
  run('java', [
    '-m',
    'jdk.compiler/com.sun.tools.javac.Main',
    '-source',
    '8',
    '-target',
    '8',
    '-bootclasspath',
    [platform, join(tools, 'core-lambda-stubs.jar')].join(delimiter),
    '-d',
    join(work, 'classes'),
    ...readdirSync(javaSource)
      .filter((name) => name.endsWith('.java'))
      .map((name) => join(javaSource, name)),
    join(work, 'generated/BuildConfig.java'),
  ]);
  const classes = readdirSync(
    join(work, 'classes/org/openframe/player'),
  ).filter((name) => name.endsWith('.class'));
  run('java', [
    '-cp',
    join(tools, 'lib/d8.jar'),
    'com.android.tools.r8.D8',
    '--release',
    '--min-api',
    '28',
    '--lib',
    platform,
    '--output',
    join(work, 'dex'),
    ...classes.map((name) => join(work, 'classes/org/openframe/player', name)),
  ]);
  const archive = unzipSync(readFileSync(join(work, 'resources.apk')));
  for (const dex of readdirSync(join(work, 'dex')))
    archive[dex] = readFileSync(join(work, 'dex', dex));
  // Store entries uncompressed, then align: resources.arsc must be mmap-able on Android 11+.
  writeFileSync(join(work, 'unaligned.apk'), zipSync(archive, { level: 0 }));
  run(binary('zipalign'), [
    '-f',
    '4',
    join(work, 'unaligned.apk'),
    join(work, 'aligned.apk'),
  ]);
  const output = join(work, 'openframe-release.apk');
  run('java', [
    '-jar',
    join(tools, 'lib/apksigner.jar'),
    'sign',
    '--ks',
    process.env.OPENFRAME_ANDROID_KEYSTORE,
    '--ks-key-alias',
    process.env.OPENFRAME_ANDROID_KEY_ALIAS,
    '--ks-pass',
    'env:OPENFRAME_ANDROID_STORE_PASSWORD',
    '--key-pass',
    'env:OPENFRAME_ANDROID_KEY_PASSWORD',
    '--out',
    output,
    join(work, 'aligned.apk'),
  ]);
  run('java', [
    '-jar',
    join(tools, 'lib/apksigner.jar'),
    'verify',
    '--verbose',
    output,
  ]);
  run(binary('zipalign'), ['-c', '4', output]);
  return output;
}
