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
const directory = mkdtempSync(path.join(os.tmpdir(), 'openframe-tag-picker-'));
const instance = createApp({ dataDir: directory });
instance.app.use(express.static(path.join(root, 'dist')));
instance.app.get('/{*path}', (_, res) =>
  res.sendFile(path.join(root, 'dist/index.html')),
);
const server = instance.app.listen(0, '127.0.0.1');
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
  });
  const admin = await browser.newPage();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function api(who, url, method = 'GET', data) {
    const response = await who.request.fetch(base + url, { method, data });
    assert.ok(response.ok(), `${url}: ${await response.text()}`);
    return response.json();
  }
  await api(admin, '/api/setup', 'POST', { password: 'tag-browser-password' });
  const created = await api(admin, '/api/users', 'POST', {
    name: 'Tag editor',
    username: 'tag-editor',
  });
  await api(page, '/api/login', 'POST', {
    username: 'tag-editor',
    password: created.password,
  });
  const targets = {};
  for (const kind of ['slides', 'playlists']) {
    const body =
      kind === 'slides'
        ? { width: 1920, height: 1080, layers: [] }
        : { items: [] };
    const hidden = await api(admin, `/api/${kind}`, 'POST', {
      ...body,
      name: `Private ${kind}`,
    });
    await api(admin, `/api/organization/${kind}`, 'POST', {
      ids: [hidden.id],
      addTags: ['private-tag'],
    });
    const source = await api(page, `/api/${kind}`, 'POST', {
      ...body,
      name: `Tagged ${kind}`,
    });
    targets[kind] = await api(page, `/api/${kind}`, 'POST', {
      ...body,
      name: `Target ${kind}`,
    });
    await api(page, `/api/organization/${kind}`, 'POST', {
      ids: [source.id],
      addTags: ['safety', 'seasonal'],
    });
  }
  const buffer = await sharp({
    create: { width: 80, height: 80, channels: 3, background: '#26714f' },
  })
    .png()
    .toBuffer();
  async function upload(who, name, tags) {
    const response = await who.request.post(base + '/api/assets', {
      multipart: { file: { name, mimeType: 'image/png', buffer } },
    });
    assert.equal(response.status(), 201);
    const asset = await response.json();
    await api(who, `/api/assets/${asset.id}`, 'PATCH', { tags });
    return asset;
  }
  await upload(admin, 'private.png', ['private-tag']);
  await upload(page, 'tagged.png', ['safety', 'seasonal']);
  const image = await upload(page, 'target.png', []);
  await page.goto(base + '/dashboard');
  const dialog = page.getByRole('dialog');
  const add = () =>
    dialog.getByLabel('Choose existing tags to add', { exact: true });
  const remove = () =>
    dialog.getByLabel('Choose existing tags to remove', { exact: true });
  async function confirm(name) {
    await dialog.getByRole('button', { name, exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  async function verify(kind, id, expected) {
    const library = await api(page, '/api/library');
    assert.deepEqual(
      library[kind].find((item) => item.id === id).tags,
      expected,
    );
  }
  for (const kind of ['slides', 'playlists']) {
    if (kind === 'playlists')
      await page.getByRole('button', { name: /^Playlists/ }).click();
    const target = targets[kind];
    async function open() {
      await page
        .getByRole('checkbox', { name: `Select ${target.name}`, exact: true })
        .check();
      await page
        .getByRole('button', { name: 'Move / tag', exact: true })
        .click();
    }
    await open();
    assert.equal(await add().locator('option[value="private-tag"]').count(), 0);
    await dialog
      .getByLabel('Add tags', { exact: true })
      .fill('SAFETY, new-tag');
    assert.equal(await add().locator('option[value="safety"]').count(), 0);
    await add().selectOption('seasonal');
    await confirm('Apply changes');
    await verify(kind, target.id, ['safety', 'new-tag', 'seasonal']);
    await open();
    assert.equal(
      await dialog.getByLabel('Add tags', { exact: true }).inputValue(),
      '',
    );
    await remove().selectOption('seasonal');
    await confirm('Apply changes');
    await verify(kind, target.id, ['safety', 'new-tag']);
  }
  await page.getByRole('button', { name: /^Media/ }).click();
  await page
    .getByRole('button', { name: 'Edit target.png', exact: true })
    .click();
  assert.equal(await add().locator('option[value="private-tag"]').count(), 0);
  await add().selectOption('safety');
  await add().selectOption('seasonal');
  assert.equal(await add().locator('option[value="safety"]').count(), 0);
  await dialog
    .getByLabel('Tags, separated by commas', { exact: true })
    .fill('safety, seasonal, new-tag');
  await confirm('Save');
  await verify('assets', image.id, ['safety', 'seasonal', 'new-tag']);
  await page
    .getByRole('checkbox', { name: 'Select target.png', exact: true })
    .check();
  await page
    .locator('.media-selection-bar')
    .getByRole('button', { name: 'Tags', exact: true })
    .click();
  await dialog.getByLabel('Action').selectOption('remove');
  await remove().selectOption('seasonal');
  await confirm('Save');
  await verify('assets', image.id, ['safety', 'new-tag']);
  await page
    .getByRole('checkbox', { name: 'Select target.png', exact: true })
    .check();
  await page
    .locator('.media-selection-bar')
    .getByRole('button', { name: 'Tags', exact: true })
    .click();
  await add().selectOption('seasonal');
  await confirm('Save');
  await verify('assets', image.id, ['safety', 'new-tag', 'seasonal']);
  // Clearing a full tag list makes those tags selectable again, including on phones.
  await page.setViewportSize({ width: 320, height: 844 });
  await page
    .getByRole('button', { name: 'Edit target.png', exact: true })
    .click();
  await dialog
    .getByLabel('Tags, separated by commas', { exact: true })
    .fill('');
  await add().selectOption('safety');
  assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth));
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  mkdirSync(path.join(root, 'work'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'work/tag-picker-320.png') });
  await confirm('Save');
  await verify('assets', image.id, ['safety']);
  assert.deepEqual(errors, []);
  console.log(
    'Tag picker checks passed: existing/new tags, duplicate exclusion, bulk add/remove, catalog privacy, reset, persistence, and phone layout.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
}
