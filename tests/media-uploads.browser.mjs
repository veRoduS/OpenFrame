import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = path.resolve(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-uploads-browser-'));
const instance = createApp({ dataDir: dir });
instance.app.use(express.static(path.join(root, 'dist')));
instance.app.get('/{*path}', (_, res) =>
  res.sendFile(path.join(root, 'dist/index.html')),
);
// Hold real HTTP responses after the server has accepted the image, so Chromium
// emits actual upload progress while waiting for processing confirmation.
let responseGate = null;
const host = express();
host.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/assets' && responseGate) {
    const gate = responseGate;
    responseGate = null;
    const original = res.json.bind(res);
    res.json = (body) => {
      void gate.then(() => {
        if (!res.destroyed) original(body);
      });
      return res;
    };
  }
  next();
});
host.use(instance.app);
const server = host.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  const { chromium } = await import(
    process.env.OPENFRAME_PLAYWRIGHT || 'playwright'
  );
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.OPENFRAME_BROWSER_EXECUTABLE || '/usr/bin/chromium',
  });
  const admin = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on('pageerror', (error) => errors.push(error.message));
  async function api(who, url, method = 'GET', data) {
    const response = await who.request.fetch(base + url, { method, data });
    assert.ok(response.ok(), `${url}: ${await response.text()}`);
    return response.json();
  }
  await api(admin, '/api/setup', 'POST', {
    password: 'upload-browser-password',
  });
  const created = await api(admin, '/api/users', 'POST', {
    name: 'Media editor',
    username: 'media-editor',
  });
  const mediaFolder = await api(admin, '/api/folders', 'POST', {
    name: 'Shared media',
  });
  await api(admin, '/api/library-folders/slides', 'POST', {
    name: 'Shared slides',
  });
  await api(admin, '/api/library-folders/playlists', 'POST', {
    name: 'Shared playlists',
  });
  await api(page, '/api/login', 'POST', {
    username: 'media-editor',
    password: created.password,
  });
  await page.goto(base + '/dashboard');
  await page
    .getByRole('navigation', { name: 'Slide folders' })
    .getByRole('button', { name: 'Shared slides', exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'New folder', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: /^Playlists/ }).click();
  await page
    .getByRole('navigation', { name: 'Playlist folders' })
    .getByRole('button', { name: 'Shared playlists', exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'New folder', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: /^Media/ }).click();
  const nav = page.getByRole('navigation', { name: 'Media folders' });
  await nav
    .getByRole('button', { name: 'Shared media 0', exact: true })
    .click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit folder', exact: true })
      .count(),
    0,
  );
  assert.equal(await nav.locator('[draggable="true"]').count(), 0);
  const image = await sharp({
    create: { width: 100, height: 100, channels: 3, background: '#26714f' },
  })
    .png()
    .toBuffer();
  const file = (name) => ({ name, mimeType: 'image/png', buffer: image });
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  responseGate = hold;
  await page
    .locator('.media-library input[type="file"]')
    .setInputFiles([
      file('first.png'),
      {
        name: 'invalid.png',
        mimeType: 'image/png',
        buffer: Buffer.from('not an image'),
      },
      file('last.png'),
    ]);
  const panel = page.getByRole('region', { name: 'Media uploads' });
  await panel.getByText('Uploading media', { exact: true }).waitFor();
  await panel
    .getByRole('progressbar', { name: 'Overall upload progress', exact: true })
    .waitFor();
  assert.equal(await panel.getByText('Queued', { exact: true }).count(), 2);
  await panel.getByText('Processing image…', { exact: true }).waitFor();
  assert.equal(await panel.getByText('Uploaded', { exact: true }).count(), 0);
  const transferred = Number(
    await panel
      .getByRole('progressbar', {
        name: 'Overall upload progress',
        exact: true,
      })
      .getAttribute('value'),
  );
  assert.ok(transferred > 0 && transferred < 100);
  assert.equal(
    await page
      .getByRole('button', { name: 'Upload', exact: true })
      .isDisabled(),
    true,
  );
  const bounds = await panel.boundingBox();
  assert.ok(
    bounds.x > 900 && bounds.y > 500,
    `Bottom-right upload panel: ${JSON.stringify(bounds)}`,
  );
  await page.getByRole('button', { name: /^Slides/ }).click();
  await panel.getByText('Uploading media', { exact: true }).waitFor();
  release();
  await panel
    .getByText('Uploads finished with errors', { exact: true })
    .waitFor();
  await panel
    .getByText('2 of 3 uploaded · 1 failed', { exact: true })
    .waitFor();
  assert.equal(await panel.locator('li[data-status="done"]').count(), 2);
  assert.equal(await panel.locator('li[data-status="error"]').count(), 1);
  const library = await api(page, '/api/library');
  assert.equal(library.assets.length, 2);
  assert.ok(library.assets.every((asset) => asset.folderId === mediaFolder.id));
  await page.setViewportSize({ width: 320, height: 844 });
  assert.ok(
    await panel.evaluate(
      (el) =>
        el.getBoundingClientRect().left >= 0 &&
        el.getBoundingClientRect().right <= innerWidth,
    ),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  mkdirSync(path.join(root, 'work'), { recursive: true });
  await page.screenshot({
    path: path.join(root, 'work/media-upload-results-320.png'),
  });
  await panel
    .getByRole('button', { name: 'Dismiss upload notification', exact: true })
    .click();
  await panel.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /^Media/ }).click();
  await page
    .locator('.media-library input[type="file"]')
    .setInputFiles([file('third.png'), file('fourth.png')]);
  await panel.getByText('Upload complete', { exact: true }).waitFor();
  await panel.getByText('2 of 2 uploaded', { exact: true }).waitFor();
  await panel
    .getByRole('button', { name: 'Dismiss upload notification', exact: true })
    .click();
  await panel.waitFor({ state: 'detached' });
  // A file already accepted for processing is confirmed, while queued files stop.
  let confirm;
  responseGate = new Promise((resolve) => {
    confirm = resolve;
  });
  await page
    .locator('.media-library input[type="file"]')
    .setInputFiles([file('processing.png'), file('queued.png')]);
  await panel.getByText('Processing image…', { exact: true }).waitFor();
  await panel
    .getByRole('button', { name: 'Cancel uploads', exact: true })
    .click();
  await panel
    .getByRole('button', { name: 'Finishing current upload…', exact: true })
    .waitFor();
  confirm();
  await panel.getByText('Uploads cancelled', { exact: true }).waitFor();
  assert.equal(await panel.locator('li[data-status="done"]').count(), 1);
  assert.equal(await panel.locator('li[data-status="cancelled"]').count(), 1);
  await panel
    .getByText('1 of 2 uploaded · 1 cancelled', { exact: true })
    .waitFor();
  const confirmed = await api(page, '/api/library');
  assert.ok(confirmed.assets.some((asset) => asset.name === 'processing.png'));
  assert.ok(!confirmed.assets.some((asset) => asset.name === 'queued.png'));
  assert.equal(
    await page
      .getByRole('button', { name: 'Upload', exact: true })
      .isDisabled(),
    false,
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  await page.getByLabel('Username', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Shared folder visibility, admin-only controls, real multi-file uploads, queued progress, processing/confirmation, mixed failures, navigation persistence, mobile layout and cancellation passed.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(dir, { recursive: true, force: true });
}
