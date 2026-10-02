import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Verify the actual signed APK, independently of generated release metadata. */
export function verifyAndroidApk(
  apk,
  {
    root = defaultRoot,
    version = JSON.parse(
      readFileSync(resolve(root, 'player/version.json'), 'utf8'),
    ).version,
    minSdk = 28,
    sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT,
    run = execFileSync,
  } = {},
) {
  if (!sdk)
    throw new Error(
      'Set ANDROID_HOME or ANDROID_SDK_ROOT to verify the release APK',
    );
  if (typeof version !== 'string' || !versionPattern.test(version))
    throw new Error('Expected a plain Android X.Y.Z release version');
  const [major, minor, patch] = version.split('.').map(Number);
  const versionCode = major * 1000000 + minor * 1000 + patch;
  if (
    minor >= 1000 ||
    patch >= 1000 ||
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    versionCode > 2100000000
  )
    throw new Error(
      'Android release version does not fit a valid version code',
    );
  if (!Number.isInteger(minSdk) || minSdk < 28 || minSdk > 100)
    throw new Error('Expected a supported Android minimum SDK');
  const pin = JSON.parse(
    readFileSync(resolve(root, 'player/android/release-signing.json'), 'utf8'),
  );
  if (
    !pin ||
    pin.schemaVersion !== 1 ||
    pin.packageName !== 'org.openframe.player' ||
    typeof pin.certificateSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(pin.certificateSha256)
  )
    throw new Error('Invalid public Android signing certificate pin');
  const filename = resolve(apk);
  if (!lstatSync(filename).isFile())
    throw new Error('Release APK must be a regular file, not a symbolic link');
  const tools = resolve(sdk, 'build-tools/35.0.0');
  const binary = (name) =>
    resolve(tools, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  const execute = (command, args) =>
    String(
      run(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      }),
    );
  const signature = execute('java', [
    '-jar',
    resolve(tools, 'lib/apksigner.jar'),
    'verify',
    '--print-certs',
    filename,
  ]);
  const signers = [
    ...signature.matchAll(
      /^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})\r?$/gm,
    ),
  ];
  if (
    signers.length !== 1 ||
    signers[0][1].toLowerCase() !== pin.certificateSha256
  )
    throw new Error(
      'APK signing certificate does not match the existing OpenFrame release key; do not publish a replacement key',
    );
  const badging = execute(binary('aapt2'), ['dump', 'badging', filename]);
  const packages = [
    ...badging.matchAll(
      /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'(?:\s|$)/gm,
    ),
  ];
  const minimums = [
    ...badging.matchAll(/^(?:sdkVersion|minSdkVersion):'(\d+)'\r?$/gm),
  ];
  if (
    packages.length !== 1 ||
    packages[0][1] !== pin.packageName ||
    Number(packages[0][2]) !== versionCode ||
    packages[0][3] !== version ||
    minimums.length !== 1 ||
    Number(minimums[0][1]) !== minSdk
  )
    throw new Error(
      'APK package, version, version code, or minimum SDK does not match its release metadata',
    );
  if (/^application-debuggable(?:\r?$|:)/m.test(badging))
    throw new Error('Refusing to publish a debuggable Android APK');
  execute(binary('zipalign'), ['-c', '4', filename]);
  return {
    packageName: pin.packageName,
    versionName: version,
    versionCode,
    minSdk,
    signerSha256: pin.certificateSha256,
  };
}
