import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import express from 'express';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-editor-locks-'));
const { app, db, close } = createApp({ dataDir: dir });
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (req, res) =>
  res.sendFile(path.join(root, 'dist/index.html')),
);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
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
    ...(process.env.OPENFRAME_BROWSER_CHANNEL
      ? { channel: process.env.OPENFRAME_BROWSER_CHANNEL }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  assert.equal(
    (
      await context.request.post(`${base}/api/setup`, {
        data: { password: 'browser8' },
      })
    ).status(),
    200,
  );
  await context.request.post(`${base}/api/logout`);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/login`);
  await page.getByLabel('Username', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('browser8');
  const login = page.waitForResponse((response) =>
    response.url().endsWith('/api/login'),
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  assert.equal((await login).status(), 200);
  await page.waitForURL('**/dashboard');
  const buffer = await sharp({
    create: { width: 20, height: 20, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  async function upload(name) {
    const response = await context.request.post(`${base}/api/assets`, {
      multipart: { file: { name, mimeType: 'image/png', buffer } },
    });
    assert.equal(response.status(), 201);
    return response.json();
  }
  const original = await upload('Original.png');
  const second = await upload('Second.png');
  const corner = await upload('Corner.png');
  const firstImage = {
    id: randomUUID(),
    type: 'image',
    assetId: original.id,
    x: 5,
    y: 5,
    width: 30,
    height: 30,
  };
  const locked = { x: 70, y: 70, width: 20, height: 20, lockMode: 'movement' };
  const created = await context.request.post(`${base}/api/slides`, {
    data: {
      name: 'Lock regression',
      width: 1920,
      height: 1080,
      layers: [
        firstImage,
        { id: randomUUID(), type: 'text', text: 'Locked text', ...locked },
        { id: randomUUID(), type: 'clock', ...locked },
        {
          id: randomUUID(),
          type: 'counter',
          counter: { targetAt: '2030-01-01T00:00:00Z', unit: 'days' },
          ...locked,
        },
        {
          id: randomUUID(),
          type: 'image',
          assetId: corner.id,
          lockAspect: false,
          ...locked,
        },
      ],
    },
  });
  assert.equal(created.status(), 201);
  const slide = await created.json();
  await page.reload();
  await page
    .getByRole('button', { name: 'Edit Lock regression', exact: true })
    .click();
  const panel = page.locator('.properties-panel');
  const layers = page.locator('.layer-list');
  async function save() {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/slides/${slide.id}`) &&
        r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Save slide', exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.getByText('All changes saved', { exact: true }).waitFor();
    return (
      await (await context.request.get(`${base}/api/library`)).json()
    ).slides.find((item) => item.id === slide.id);
  }
  async function addImage() {
    await page.getByRole('button', { name: 'Add image', exact: true }).click();
    assert.equal(
      await page
        .getByRole('dialog')
        .locator('[data-slot="dialog-title"]')
        .textContent(),
      'Add an image',
    );
    await page
      .getByRole('button', { name: 'Add Second.png', exact: true })
      .click();
  }
  await addImage();
  let saved = await save();
  assert.equal(
    saved.layers.filter((layer) => layer.type === 'image').length,
    3,
  );
  assert.equal(
    saved.layers.find((layer) => layer.id === firstImage.id).assetId,
    original.id,
  );
  await layers.getByRole('button', { name: /Original\.png/ }).click();
  await panel.getByLabel('Layer lock').selectOption('full');
  assert.equal(
    await panel
      .getByRole('button', { name: 'Replace image', exact: true })
      .isDisabled(),
    true,
  );
  await addImage();
  saved = await save();
  assert.equal(
    saved.layers.filter((layer) => layer.type === 'image').length,
    4,
  );
  assert.equal(
    saved.layers.find((layer) => layer.id === firstImage.id).assetId,
    original.id,
  );
  assert.equal(
    saved.layers.find((layer) => layer.id === firstImage.id).lockMode,
    'full',
  );
  await layers.getByRole('button', { name: /Original\.png/ }).click();
  await panel.getByLabel('Layer lock').selectOption('movement');
  await panel
    .getByRole('button', { name: 'Replace image', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add Second.png', exact: true })
    .click();
  saved = await save();
  const replaced = saved.layers.find((layer) => layer.id === firstImage.id);
  assert.equal(replaced.assetId, second.id);
  assert.equal(replaced.lockMode, 'movement');
  assert.deepEqual(
    [replaced.x, replaced.y, replaced.width, replaced.height],
    [5, 5, 30, 30],
  );
  assert.equal(
    saved.layers.filter((layer) => layer.type === 'image').length,
    4,
  );
  for (const name of [/Locked text/, /^Clock/, /^Counter/, /Corner\.png/]) {
    await layers.getByRole('button', { name }).click();
    assert.equal(
      await panel.getByLabel('Layer x', { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await panel.getByLabel('Layer y', { exact: true }).isDisabled(),
      true,
    );
    await panel.getByLabel('Layer width', { exact: true }).fill('60');
    await panel.getByLabel('Layer height', { exact: true }).fill('60');
    if (name.source === 'Locked text')
      await panel.getByLabel('Text content').fill('Updated locked text');
    saved = await save();
  }
  for (const layer of saved.layers.filter(
    (layer) => layer.id !== firstImage.id && layer.lockMode === 'movement',
  )) {
    assert.deepEqual(
      [layer.x, layer.y, layer.width, layer.height],
      [70, 70, 30, 30],
    );
  }
  assert.equal(
    saved.layers.find((layer) => layer.type === 'text').text,
    'Updated locked text',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Editor browser checks passed: eight-character login, add versus replace, full locks, and fixed movement-locked coordinates for text/images/widgets.',
  );
} finally {
  await browser?.close();
  close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
