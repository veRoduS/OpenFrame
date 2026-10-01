import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';

// Exercise the actual entrypoint with browser-native timers, including the
// Android telemetry bridge. Agent unit tests cannot catch WebView binding errors.
const root = fileURLToPath(new URL('..', import.meta.url));
const app = express();
app.use(express.json());
let state = { approved: false, code: 'TEST42' };
const reports = [];
app.get('/local/state', (req, res) => res.json(state));
app.post('/local/playback', (req, res) => {
  reports.push(req.body);
  res.sendStatus(204);
});
app.use(express.static(`${root}/player/web`));
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
  for (const android of [true, false]) {
    state = { approved: false, code: 'TEST42' };
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (android) {
      await page.addInitScript(() => {
        globalThis.androidReports = [];
        globalThis.OpenFrameAndroid = {
          reportPlayback: (json) =>
            globalThis.androidReports.push(JSON.parse(json)),
        };
      });
    }
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(
      () => document.querySelector('#heading').textContent !== 'Connecting...',
    );
    assert.equal(
      await page.locator('#heading').textContent(),
      'TEST42',
      `Startup failed: ${await page.locator('#detail').textContent()}`,
    );
    state = {
      approved: true,
      manifest: { revision: 'empty', items: [], assets: [] },
    };
    await page.waitForFunction(
      () =>
        document.querySelector('#heading').textContent ===
        'Ready for a playlist',
    );
    state = {
      approved: true,
      manifest: {
        revision: 'playing',
        assets: [],
        items: ['first', 'second'].map((id) => ({
          duration: 2,
          slide: {
            id,
            width: 1920,
            height: 1080,
            background: '#163e34',
            layers: [],
          },
        })),
      },
    };
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.slide-frame').length > 0 &&
        document.querySelector('#message').hidden,
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('.slide-frame[data-slide-id="second"]')
          ?.getAttribute('aria-hidden') === 'false',
    );
    if (android) {
      await page.waitForFunction(() =>
        globalThis.androidReports.some((r) => r.phase === 'playing'),
      );
    } else {
      await page.waitForTimeout(5500);
      assert.ok(reports.some((r) => r.phase === 'playing'));
    }
    assert.ok((await page.locator('.slide-frame').count()) <= 2);
    state = { ...state, blank: true };
    await page.waitForFunction(() => document.querySelector('#stage').hidden);
    state = { ...state, blank: false };
    await page.waitForFunction(
      () =>
        !document.querySelector('#stage').hidden &&
        document.querySelector('#message').hidden,
    );
    assert.deepEqual(errors, []);
    if (android) {
      mkdirSync(`${root}/work`, { recursive: true });
      await page.screenshot({
        path: `${root}/work/android-player-startup.png`,
      });
    }
    await page.close();
    console.log(
      `${android ? 'Android bridge' : 'Pi HTTP'} startup, pairing, playback, telemetry, blank/resume passed`,
    );
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
