import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import express from 'express';
import { createApp } from '../server/app.mjs';

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
  page.on('pageerror', (error) => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base + '/#android-player');
  await page
    .getByText('The Android download is not available on this server yet.')
    .waitFor();
  assert.equal(
    await page.getByRole('link', { name: /Download Android APK/ }).count(),
    0,
  );
  const bytes = Buffer.from('browser-test APK fixture');
  const name = 'openframe-player-0.10.3.apk';
  writeFileSync(path.join(dir, name), bytes);
  writeFileSync(
    path.join(dir, 'latest.json'),
    JSON.stringify({
      versionName: '0.10.3',
      versionCode: 10003,
      packageName: 'org.openframe.player',
      minSdk: 28,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      apkUrl: `/downloads/android/${name}`,
    }),
  );
  mkdirSync(path.join(root, 'work'), { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await page.reload();
    const link = page.getByRole('link', {
      name: 'Download Android APK · 0.10.3',
    });
    await link.waitFor();
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
    'Public Android download: unavailable state, desktop/mobile layout, and actual attachments passed',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(dir, { recursive: true, force: true });
}
