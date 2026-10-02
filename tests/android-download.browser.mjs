import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from '../server/app.mjs';
import { ANDROID_GITHUB_APK } from '../server/android-release-config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'openframe-apk-page-'));
const instance = createApp({
  dataDir: path.join(dir, 'data'),
  androidReleaseDir: dir,
});
instance.app.use(express.static(path.join(root, 'dist')));
instance.app.get('/{*path}', (req, res) =>
  res.sendFile(path.join(root, 'dist/index.html')),
);
const server = instance.app.listen(0, '127.0.0.1');
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
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  const base = `http://127.0.0.1:${server.address().port}`;
  const bytes = Buffer.from('browser-test APK fixture');
  const name = 'openframe-player.apk';
  // Exercise the actual direct-link click without contacting GitHub or requiring
  // a local release. Raw GitHub serves unknown binary types as attachments.
  await page.route(ANDROID_GITHUB_APK, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${name}"`,
      },
      body: bytes,
    }),
  );
  mkdirSync(path.join(root, 'work'), { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 850 });
    requests.length = 0;
    await page.goto(base + '/#android-player');
    const link = page.getByRole('link', {
      name: 'Download latest Android APK',
    });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), ANDROID_GITHUB_APK);
    assert.equal(
      requests.some(
        (url) => url.includes('github') || url.includes('/downloads/android/'),
      ),
      false,
      'Rendering the landing page must not fetch release metadata or GitHub assets',
    );
    await link.scrollIntoViewIfNeeded();
    const downloading = page.waitForEvent('download');
    await link.click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), name);
    assert.equal(await download.failure(), null);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(root, 'work', `android-download-${width}.png`),
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'Public Android download: stable direct GitHub link without local release, mocked attachment, no metadata request, and desktop/mobile layouts passed',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(dir, { recursive: true, force: true });
}
