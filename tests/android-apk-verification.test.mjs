import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAndroidApk } from '../scripts/verify-android-apk.mjs';

const certificate = 'a'.repeat(64);
const signature = `Signer #1 certificate SHA-256 digest: ${certificate}\n`;
const badging =
  "package: name='org.openframe.player' versionCode='10003' versionName='0.10.3' platformBuildVersionName='15'\nminSdkVersion:'28'\n";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openframe-apk-verification-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'player/android'), { recursive: true });
  writeFileSync(
    join(root, 'player/version.json'),
    JSON.stringify({ version: '0.10.3' }),
  );
  writeFileSync(
    join(root, 'player/android/release-signing.json'),
    JSON.stringify({
      schemaVersion: 1,
      packageName: 'org.openframe.player',
      certificateSha256: certificate,
    }),
  );
  const apk = join(root, 'player.apk');
  writeFileSync(apk, 'fixture APK: external SDK tool output is simulated');
  const calls = [];
  let verification = signature,
    metadata = badging;
  const options = {
    root,
    sdk: join(root, 'sdk'),
    run(command, args) {
      calls.push({ command, args });
      if (command === 'java') return verification;
      if (args[0] === 'dump') return metadata;
      return '';
    },
  };
  return {
    root,
    apk,
    options,
    calls,
    setSignature(value) {
      verification = value;
    },
    setBadging(value) {
      metadata = value;
    },
  };
}

void test('APK verification pins the existing signer and checks actual package metadata and alignment', (t) => {
  const f = fixture(t);
  assert.deepEqual(verifyAndroidApk(f.apk, f.options), {
    packageName: 'org.openframe.player',
    versionName: '0.10.3',
    versionCode: 10003,
    minSdk: 28,
    signerSha256: certificate,
  });
  assert.deepEqual(f.calls[0].args.slice(2), [
    'verify',
    '--print-certs',
    f.apk,
  ]);
  assert.deepEqual(f.calls[1].args, ['dump', 'badging', f.apk]);
  assert.deepEqual(f.calls[2].args, ['-c', '4', f.apk]);
});

void test('different, missing, and multiple signing certificates block publication', (t) => {
  const f = fixture(t);
  for (const value of [
    signature.replace(certificate, 'b'.repeat(64)),
    'No matching signer certificate output\n',
    signature + signature.replace('Signer #1', 'Signer #2'),
  ]) {
    f.setSignature(value);
    assert.throws(
      () => verifyAndroidApk(f.apk, f.options),
      /signing certificate does not match/,
    );
  }
});

void test('wrong APK identity, release version, version code, or SDK is rejected even with the pinned signer', (t) => {
  const f = fixture(t);
  for (const value of [
    badging.replace('org.openframe.player', 'org.openframe.player.debug'),
    badging.replace("versionName='0.10.3'", "versionName='0.10.2'"),
    badging.replace("versionCode='10003'", "versionCode='10002'"),
    badging.replace("minSdkVersion:'28'", "minSdkVersion:'29'"),
    badging.replace("minSdkVersion:'28'", ''),
    '',
  ]) {
    f.setBadging(value);
    assert.throws(
      () => verifyAndroidApk(f.apk, f.options),
      /does not match its release metadata/,
    );
  }
  f.setBadging(badging + 'application-debuggable\n');
  assert.throws(() => verifyAndroidApk(f.apk, f.options), /debuggable/);
});

void test('failed cryptographic verification and failed alignment are not treated as success', (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      verifyAndroidApk(f.apk, {
        ...f.options,
        run() {
          throw new Error('APK signature is invalid');
        },
      }),
    /signature is invalid/,
  );
  assert.throws(
    () =>
      verifyAndroidApk(f.apk, {
        ...f.options,
        run(command, args) {
          if (args[0] === '-c') throw new Error('APK is not aligned');
          return f.options.run(command, args);
        },
      }),
    /not aligned/,
  );
});

void test('legacy aapt SDK field and CRLF output parse without weakening checks', (t) => {
  const f = fixture(t);
  f.setSignature(
    signature
      .toUpperCase()
      .replace(
        'SIGNER #1 CERTIFICATE SHA-256 DIGEST:',
        'Signer #1 certificate SHA-256 digest:',
      )
      .replaceAll('\n', '\r\n'),
  );
  f.setBadging(
    badging.replace('minSdkVersion:', 'sdkVersion:').replaceAll('\n', '\r\n'),
  );
  assert.equal(verifyAndroidApk(f.apk, f.options).minSdk, 28);
});

void test('invalid expected versions, certificate pins, and symlinked APKs fail before invoking SDK tools', (t) => {
  const f = fixture(t);
  for (const version of ['0.10.1000', 'v0.10.3', '999999.0.0', '0.0.0'])
    assert.throws(
      () => verifyAndroidApk(f.apk, { ...f.options, version }),
      /version/i,
    );
  assert.equal(f.calls.length, 0);
  const link = join(f.root, 'link.apk');
  symlinkSync(f.apk, link);
  assert.throws(() => verifyAndroidApk(link, f.options), /regular file/);
  writeFileSync(join(f.root, 'player/android/release-signing.json'), '{}');
  assert.throws(() => verifyAndroidApk(f.apk, f.options), /certificate pin/);
  assert.equal(f.calls.length, 0);
});
