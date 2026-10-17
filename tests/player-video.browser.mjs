import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

// Synthetic media stays outside the source tree. This tests actual browser MP4
// decode/autoplay and lifecycle, not Android hardware decoder performance.
const media = mkdtempSync(join(tmpdir(), 'openframe-video-browser-'));
const root = fileURLToPath(new URL('..', import.meta.url));
const videoName = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.mp4';
const posterName = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp';
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=c=green:s=160x90:r=15',
  '-t',
  '0.6',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-an',
  '-movflags',
  '+faststart',
  join(media, videoName),
]);
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=c=green:s=160x90',
  '-frames:v',
  '1',
  join(media, posterName),
]);
writeFileSync(
  join(media, 'cccccccc-cccc-cccc-cccc-cccccccccccc.mp4'),
  'corrupt clip',
);
const asset = {
  id: 'clip',
  kind: 'video',
  url: `/media/${videoName}`,
  poster: { url: `/media/${posterName}` },
};
const item = (id, type = 'video', assetId = 'clip') => ({
  duration: 2,
  slide: {
    id,
    width: 160,
    height: 90,
    background: '#000000',
    layers: [
      {
        id: 'layer',
        type,
        assetId,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fit: 'cover',
      },
    ],
  },
});
let state = {
  approved: true,
  manifest: {
    schemaVersion: 5,
    revision: 'single',
    assets: [asset],
    items: [item('single')],
    transition: { type: 'fade' },
  },
};
const app = express();
app.get('/local/state', (req, res) => res.json(state));
app.post('/local/playback', (req, res) => res.sendStatus(204));
app.use('/media', express.static(media));
app.use(express.static(join(root, 'player/web')));
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
let browser;
try {
  const { chromium } = await import(
    process.env.OPENFRAME_PLAYWRIGHT || 'playwright'
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.OPENFRAME_BROWSER_EXECUTABLE
      ? { executablePath: process.env.OPENFRAME_BROWSER_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage();
  const errors = [],
    requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => requests.push(req.url()));
  await page.addInitScript(() => {
    globalThis.videoOpenViolations = [];
    globalThis.videoLoops = 0;
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'src',
    );
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...descriptor,
      set(value) {
        if (
          [...document.querySelectorAll('video[src]')].some((v) => v !== this)
        )
          globalThis.videoOpenViolations.push(value);
        descriptor.set.call(this, value);
      },
    });
    document.addEventListener(
      'timeupdate',
      (event) => {
        const video = event.target;
        if (video.tagName !== 'VIDEO') return;
        if (video.currentTime < (video.lastSample || 0))
          globalThis.videoLoops++;
        video.lastSample = video.currentTime;
      },
      true,
    );
    globalThis.androidReports = [];
    globalThis.OpenFrameAndroid = {
      reportPlayback(json) {
        globalThis.androidReports.push(JSON.parse(json));
      },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() =>
    document.querySelector('[data-video-state="playing"]'),
  );
  await page.waitForFunction(() => globalThis.videoLoops >= 2);
  const single = await page
    .locator('video')
    .evaluate((v) => ({ loop: v.loop, muted: v.muted, time: v.currentTime }));
  assert.ok(single.loop && single.muted);
  await page.evaluate(() => globalThis.openFrameSetBackground(true, 3));
  assert.equal(await page.locator('video').count(), 0);
  assert.equal(await page.locator('.slide-frame').count(), 0);
  await page.evaluate(() => {
    globalThis.openFrameSetBackground(false, 4);
    globalThis.openFrameSetBackground(true, 3);
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-video-state="playing"]'),
  );
  state = { ...state, blank: true };
  await page.waitForFunction(() => document.querySelector('#stage').hidden);
  assert.equal(await page.locator('video').count(), 0);
  state = {
    ...state,
    blank: false,
    manifest: {
      ...state.manifest,
      revision: 'mixed',
      items: [item('first'), item('second')],
    },
  };
  await page.waitForFunction(() =>
    document.querySelector(
      '[data-slide-id="second"][aria-hidden="false"] [data-video-state="playing"]',
    ),
  );
  // The prepared next item keeps a poster only, while exactly one src is active.
  assert.equal(await page.locator('video[src]').count(), 1);
  assert.deepEqual(
    await page.evaluate(() => globalThis.videoOpenViolations),
    [],
  );
  const corrupt = {
    ...asset,
    id: 'bad',
    url: '/media/cccccccc-cccc-cccc-cccc-cccccccccccc.mp4',
  };
  state = {
    approved: true,
    manifest: {
      schemaVersion: 5,
      revision: 'corrupt',
      assets: [corrupt, { id: 'photo', url: `/media/${posterName}` }],
      items: [
        { ...item('broken', 'video', 'bad'), duration: 7 },
        { ...item('photo', 'image', 'photo'), duration: 6 },
      ],
    },
  };
  await page.waitForFunction(() =>
    document.querySelector(
      '[data-slide-id="broken"][aria-hidden="false"] [data-video-state="poster"]',
    ),
  );
  assert.equal(await page.locator('video').count(), 0);
  await page.waitForFunction(() =>
    globalThis.androidReports.some(
      (r) => r.slideId === 'broken' && r.error?.includes('poster'),
    ),
  );
  await page.waitForFunction(() =>
    document.querySelector('[data-slide-id="photo"][aria-hidden="false"]'),
  );
  await page.waitForFunction(() =>
    globalThis.androidReports.some(
      (r) => r.slideId === 'photo' && r.error === null,
    ),
  );
  assert.deepEqual(errors, []);
  assert.ok(
    requests
      .filter((url) => url.includes('.mp4'))
      .every((url) =>
        url.startsWith(`http://127.0.0.1:${server.address().port}/media/`),
      ),
  );
  console.log(
    'Browser video autoplay, looping, poster staging, decoder ordering, background/blank disposal, stale lifecycle commands, corrupt-clip advance and fallback telemetry passed.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(media, { recursive: true, force: true });
}
