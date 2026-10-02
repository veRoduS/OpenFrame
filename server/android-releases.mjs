import express from 'express';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import {
  ANDROID_GITHUB_BASE,
  ANDROID_GITHUB_METADATA,
} from './android-release-config.mjs';

const MAX_APK = 64 * 1024 * 1024;
const MAX_METADATA = 16384;
const CACHE_MS = 5 * 60 * 1000;
const FAILURE_CACHE_MS = 30000;
// Stay below the installed Android client's 15-second response timeout, even
// when a cold-cache request needs both metadata and the APK from GitHub.
const FETCH_TIMEOUT_MS = 12000;

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

async function fetchBounded(fetcher, url, maxSize, signal, expectedSize) {
  // URLs are constructed only from the pinned repository and validated version.
  // Never follow a metadata-provided URL or a redirect to another resource.
  const response = await fetcher(url, {
    signal,
    redirect: 'error',
    cache: 'no-store',
  });
  if (response.redirected || (response.url && response.url !== url))
    throw new Error('Unexpected Android release URL');
  if (!response.ok) {
    const error = new Error('Android release download failed');
    if (response.status === 404) error.code = 'ENOENT';
    throw error;
  }
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    (!/^\d+$/.test(length) ||
      Number(length) > maxSize ||
      (expectedSize !== undefined && Number(length) !== expectedSize))
  )
    throw new Error('Invalid Android download size');
  if (!response.body) throw new Error('Empty Android release response');
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxSize || (expectedSize !== undefined && size > expectedSize))
      throw new Error('Android download exceeds its size limit');
    chunks.push(chunk);
  }
  if (expectedSize !== undefined && size !== expectedSize)
    throw new Error('Incomplete Android download');
  return Buffer.concat(chunks, size);
}

function githubReleases(fetcher, now) {
  // A single verified release bounds cache memory to one APK. Concurrent checks
  // share the fetch, and failures are briefly cached to bound outage traffic.
  let cached;
  let pending;
  return async () => {
    if (!cached || now() >= cached.expires) {
      if (!pending) {
        cached = undefined;
        pending = (async () => {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            FETCH_TIMEOUT_MS,
          );
          timeout.unref?.();
          try {
            const metadata = await fetchBounded(
              fetcher,
              ANDROID_GITHUB_METADATA,
              MAX_METADATA,
              controller.signal,
            );
            const release = validateAndroidRelease(JSON.parse(metadata));
            const bytes = await fetchBounded(
              fetcher,
              `${ANDROID_GITHUB_BASE}/apks/${release.versionName}/openframe-player.apk`,
              MAX_APK,
              controller.signal,
              release.size,
            );
            if (
              createHash('sha256').update(bytes).digest('hex') !==
              release.sha256
            )
              throw new Error('Invalid APK checksum');
            cached = { release, bytes, expires: now() + CACHE_MS };
          } catch (error) {
            cached = { error, expires: now() + FAILURE_CACHE_MS };
          } finally {
            clearTimeout(timeout);
            controller.abort();
            pending = undefined;
          }
        })();
      }
      await pending;
    }
    if (cached.error) throw cached.error;
    return cached;
  };
}

export function mountAndroidReleases(
  app,
  { directory, source = 'github', fetcher = globalThis.fetch, now = Date.now },
) {
  if (!['github', 'local'].includes(source))
    throw new Error('ANDROID_RELEASE_SOURCE must be github or local');
  const githubRelease = githubReleases(fetcher, now);
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
      let release, bytes;
      if (source === 'github') {
        ({ release, bytes } = await githubRelease());
      } else {
        manifest = await open(
          path.join(directory, 'latest.json'),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        const manifestStat = await manifest.stat();
        if (!manifestStat.isFile() || manifestStat.size > MAX_METADATA)
          throw new Error('Invalid metadata');
        release = validateAndroidRelease(
          JSON.parse(await manifest.readFile('utf8')),
        );
      }
      const filename = path.basename(release.apkUrl);
      if (!['latest.json', 'openframe-player.apk', filename].includes(name))
        return res.status(404).json({
          available: false,
          error: 'Release no longer available; check again',
        });
      if (source === 'local') {
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
      }
      if (name === 'latest.json') return res.json(release);
      res.type('application/vnd.android.package-archive');
      res.attachment(filename);
      res.set('Content-Length', String(release.size));
      if (bytes) res.send(bytes);
      else
        await pipeline(
          apk.createReadStream({ start: 0, autoClose: false }),
          res,
        );
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
