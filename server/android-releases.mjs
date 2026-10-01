import express from 'express';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const MAX_APK = 64 * 1024 * 1024;

export function validateAndroidRelease(input) {
  const versionName = input.versionName;
  if (
    typeof versionName !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(versionName)
  )
    throw new Error('Invalid Android version');
  const [major, minor, patch] = versionName.split('.').map(Number);
  const versionCode = major * 1000000 + minor * 1000 + patch;
  if (
    minor >= 1000 ||
    patch >= 1000 ||
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    versionCode > 2100000000 ||
    input.versionCode !== versionCode
  )
    throw new Error('Invalid Android version code');
  const apkUrl = `/downloads/android/openframe-player-${versionName}.apk`;
  if (
    input.packageName !== 'org.openframe.player' ||
    input.apkUrl !== apkUrl ||
    !Number.isInteger(input.minSdk) ||
    input.minSdk < 28 ||
    input.minSdk > 100 ||
    !Number.isInteger(input.size) ||
    input.size < 1 ||
    input.size > MAX_APK ||
    typeof input.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  )
    throw new Error('Invalid Android release metadata');
  return {
    available: true,
    packageName: input.packageName,
    versionName,
    versionCode,
    minSdk: input.minSdk,
    size: input.size,
    sha256: input.sha256,
    apkUrl,
  };
}

export function mountAndroidReleases(app, directory) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.get('/:name', async (req, res) => {
    const name = req.params.name;
    if (
      name !== 'latest.json' &&
      name !== 'openframe-player.apk' &&
      !/^openframe-player-\d+\.\d+\.\d+\.apk$/.test(name)
    )
      return res
        .status(404)
        .json({ available: false, error: 'Download not found' });
    let manifest, apk;
    try {
      manifest = await open(
        path.join(directory, 'latest.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const manifestStat = await manifest.stat();
      if (!manifestStat.isFile() || manifestStat.size > 16384)
        throw new Error('Invalid metadata');
      const release = validateAndroidRelease(
        JSON.parse(await manifest.readFile('utf8')),
      );
      const filename = path.basename(release.apkUrl);
      if (!['latest.json', 'openframe-player.apk', filename].includes(name))
        return res.status(404).json({
          available: false,
          error: 'Release no longer available; check again',
        });
      apk = await open(
        path.join(directory, filename),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const stat = await apk.stat();
      if (!stat.isFile() || stat.size !== release.size)
        throw new Error('Invalid APK size');
      // Verify the exact open file that will be sent, including during an atomic release switch.
      const hash = createHash('sha256');
      for await (const chunk of apk.createReadStream({ autoClose: false }))
        hash.update(chunk);
      if (hash.digest('hex') !== release.sha256)
        throw new Error('Invalid APK checksum');
      if (name === 'latest.json') return res.json(release);
      res.type('application/vnd.android.package-archive');
      res.attachment(filename);
      res.set('Content-Length', String(release.size));
      await pipeline(apk.createReadStream({ start: 0, autoClose: false }), res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const missing = error.code === 'ENOENT';
      res.status(missing ? 404 : 503).json({
        available: false,
        error: missing
          ? 'No Android player release is available on this server yet'
          : 'Android player release is unavailable; contact the server administrator',
      });
    } finally {
      await manifest?.close();
      await apk?.close();
    }
  });
  router.use((req, res) =>
    res.status(404).json({ available: false, error: 'Download not found' }),
  );
  app.use('/downloads/android', router);
}
