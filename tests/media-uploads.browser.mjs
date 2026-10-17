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
  await page.locator('.media-library input[type="file"]').setInputFiles([
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
  let poll = 0;
  const videoAsset = {
    id: 'video-asset',
    name: 'loop.mov',
    kind: 'video',
    mime: 'video/mp4',
    url: '/media/loop.mp4',
    width: 1280,
    height: 720,
    bytes: 512000,
    durationMs: 12000,
    fps: 30,
    profile: 'economy',
    poster: {
      filename: 'poster.webp',
      url: '/media/poster.webp',
      bytes: 9000,
      sha256: 'a'.repeat(64),
      width: 1280,
      height: 720,
    },
    tags: [],
    folderId: mediaFolder.id,
    createdAt: new Date().toISOString(),
  };
  await page.route('**/api/videos', async (route) => {
    const body = route.request().postDataBuffer().toString('latin1');
    assert.ok(body.includes('profile') && body.includes('economy'));
    await route.fulfill({
      status: 202,
      json: { id: 'video-job', status: 'queued' },
    });
  });
  await page.route('**/api/video-jobs/video-job', async (route) => {
    poll++;
    await route.fulfill({
      json:
        poll < 2
          ? { id: 'video-job', status: 'processing' }
          : { id: 'video-job', status: 'done', asset: videoAsset },
    });
  });
  const replacementVideo = {
    ...videoAsset,
    id: 'replacement-video',
    name: 'replacement.webm',
    url: '/media/replacement.webm',
  };
  await page.route('**/api/library', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.assets.push(videoAsset);
    body.assets.push(replacementVideo);
    await route.fulfill({ response, json: body });
  });
  await page.locator('.media-library input[type="file"]').setInputFiles({
    name: 'loop.mov',
    mimeType: '',
    buffer: Buffer.from('synthetic video'),
  });
  await panel.getByText('Processing video…', { exact: true }).waitFor();
  await panel.getByText('Upload complete', { exact: true }).waitFor();
  assert.equal(await panel.locator('li[data-status="done"]').count(), 1);
  assert.equal(
    await page.locator('.media-entry .media-video-badge').count(),
    2,
  );
  assert.equal(await page.locator('.media-entry video').count(), 0);
  assert.match(
    await page
      .locator('.media-entry-info')
      .filter({ hasText: 'loop.mov' })
      .locator('.media-dimensions')
      .textContent(),
    /MB/,
  );
  await panel
    .getByRole('button', { name: 'Dismiss upload notification', exact: true })
    .click();
  await panel.waitFor({ state: 'detached' });
  const videoSlide = await api(page, '/api/slides', 'POST', {
    name: 'Video editor regression',
    width: 1920,
    height: 1080,
    layers: [],
  });
  await page.reload();
  await page.getByRole('button', { name: /^Slides/ }).click();
  await page
    .getByRole('button', { name: 'Edit Video editor regression', exact: true })
    .click();
  const editor = page.locator('.slide-editor');
  const layerList = editor.locator('.layer-list');
  await editor.getByRole('button', { name: 'Add media', exact: true }).click();
  await page.getByRole('button', { name: 'Add loop.mov', exact: true }).click();
  assert.equal(
    await layerList.getByRole('button', { name: /loop\.mov/ }).count(),
    1,
  );
  await editor.getByRole('button', { name: 'Add media', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add replacement.webm', exact: true })
    .click();
  await page
    .getByText(
      'A slide can contain one video. Replace the existing video first.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await layerList.locator('button').filter({ hasText: 'loop.mov' }).count(),
    1,
  );
  await page.keyboard.press('Escape');
  await layerList.getByRole('button', { name: /loop\.mov/ }).click();
  await editor
    .getByRole('button', { name: 'Replace video', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add replacement.webm', exact: true })
    .click();
  let savedVideoSlide;
  await page.route(`**/api/slides/${videoSlide.id}`, async (route) => {
    if (route.request().method() === 'PUT') {
      savedVideoSlide = route.request().postDataJSON();
      await route.fulfill({ json: savedVideoSlide });
    } else await route.continue();
  });
  await editor.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  assert.equal(
    savedVideoSlide.layers.filter((layer) => layer.type === 'video').length,
    1,
  );
  assert.equal(
    savedVideoSlide.layers.find((layer) => layer.type === 'video').assetId,
    replacementVideo.id,
  );
  await layerList.getByRole('button', { name: /replacement\.webm/ }).click();
  await editor
    .getByRole('button', { name: 'Replace video', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add first.png', exact: true })
    .click();
  await page
    .getByText(
      'Choose a video to replace this layer. Image and video layers keep their media type.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.getByRole('dialog', { name: 'Replace video' }).count(),
    1,
  );
  await page.keyboard.press('Escape');
  await page.unrouteAll({ behavior: 'wait' });
  await editor
    .getByRole('button', { name: 'Back to slides', exact: true })
    .click();
  await page.getByRole('button', { name: /^Media/ }).click();
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
