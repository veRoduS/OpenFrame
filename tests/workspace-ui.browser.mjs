import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.mjs';

process.env.COOKIE_SECURE = 'false';
const root = path.resolve(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-workspace-ui-'));
const instance = createApp({ dataDir: dir });
instance.app.use('/player', express.static(path.join(root, 'player/web')));
instance.app.use(express.static(path.join(root, 'dist')));
instance.app.get('/{*path}', (_req, res) =>
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
    executablePath:
      process.env.OPENFRAME_BROWSER_EXECUTABLE || '/usr/bin/chromium',
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function api(url, method = 'GET', data) {
    const response = await context.request.fetch(`${base}${url}`, {
      method,
      data,
    });
    assert.ok(response.ok(), `${url}: ${await response.text()}`);
    return response.json();
  }
  await api('/api/setup', 'POST', {
    password: 'workspace-ui-disposable-password',
  });
  let failLibrary = true;
  await page.route('**/api/library', async (route) => {
    if (failLibrary) {
      failLibrary = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary test outage' }),
      });
    } else await route.continue();
  });
  await page.goto(`${base}/dashboard`);
  await page
    .getByRole('heading', { name: 'Could not load your workspace' })
    .waitFor();
  assert.equal(
    await page.getByText('Start with a slide.', { exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByLabel('Search slides', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'New slide', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit slide', exact: true });
  await editor.getByLabel('Slide name').fill('Generated starter');
  assert.equal(
    await editor.locator('.caption-button span').first().innerText(),
    'Text',
  );
  await editor.getByRole('button', { name: 'Save slide', exact: true }).click();
  await editor
    .getByRole('button', { name: 'Back to slides', exact: true })
    .click();
  await editor.waitFor({ state: 'hidden' });
  const source = (await api('/api/library')).slides[0];
  assert.equal(source.layers[0].starterText, true);
  const playlist = await api('/api/playlists', 'POST', {
    name: 'Lobby',
    items: [{ slideId: source.id, duration: 10 }],
  });
  await api(`/api/playlists/${playlist.id}/publish`, 'POST');
  await page.goto(`${base}/dashboard/playlists`);
  await page.getByRole('button', { name: 'Edit Lobby', exact: true }).click();
  const playlistEditor = page.getByRole('dialog', {
    name: 'Edit playlist',
    exact: true,
  });
  await playlistEditor
    .getByRole('button', { name: 'Save draft and preview', exact: true })
    .waitFor();
  await playlistEditor
    .getByLabel('Playlist name', { exact: true })
    .fill('Lobby revised');
  await playlistEditor
    .getByRole('button', { name: 'Save draft', exact: true })
    .click();
  await playlistEditor
    .getByText('Unpublished changes', { exact: true })
    .waitFor();
  const publishedRequest = page.waitForResponse((response) =>
    response.url().includes(`/api/preview/${playlist.id}?version=published`),
  );
  await playlistEditor
    .getByRole('button', { name: 'Preview published', exact: true })
    .click();
  const preview = page.getByRole('dialog', {
    name: 'Published playlist preview',
    exact: true,
  });
  await preview.waitFor();
  assert.equal((await (await publishedRequest).json()).name, 'Lobby');
  assert.match(
    await preview.locator('iframe').getAttribute('src'),
    /version=published/,
  );
  assert.equal(
    (await api(`/api/preview/${playlist.id}?version=published`)).name,
    'Lobby',
  );
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 600 });
  const footer = playlistEditor.locator('.modal-footer');
  assert.ok(
    (await footer.boundingBox()).y + (await footer.boundingBox()).height <= 600,
  );
  await playlistEditor
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Toggle Sidebar', exact: true })
    .click();
  await page
    .locator('[data-slot="sidebar-menu-button"]')
    .filter({ hasText: 'Media' })
    .click();
  await page.getByRole('heading', { name: 'Media', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('dialog').count(),
    0,
    'Mobile navigation drawer closes',
  );
  await page.getByLabel('Search media', { exact: true }).fill('poster');
  await page.waitForURL('**/dashboard/media?q=poster');
  await page.reload();
  assert.equal(
    await page.getByLabel('Search media', { exact: true }).inputValue(),
    'poster',
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .locator('[data-slot="sidebar-menu-button"]')
    .filter({ hasText: 'Screens' })
    .click();
  await page.getByRole('button', { name: 'Add screen', exact: true }).click();
  await page.getByRole('button', { name: /Player already running/ }).click();
  await page
    .getByRole('dialog', { name: 'Pair a screen', exact: true })
    .waitFor();
  await page.keyboard.press('Escape');
  await page.goBack();
  await page.getByRole('heading', { name: 'Media', exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('Search media', { exact: true }).inputValue(),
    'poster',
  );
  await page.goto(`${base}/dashboard`);
  await page
    .getByRole('button', { name: 'Edit Generated starter', exact: true })
    .click();
  await editor
    .getByText('Saving updates published content.', { exact: true })
    .waitFor();
  await editor
    .getByRole('button', { name: 'Save and update screens', exact: true })
    .waitFor();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    await page.waitForFunction(
      () =>
        document
          .querySelector('.editor-overlay')
          ?.contains(document.activeElement),
      null,
      { timeout: 1000 },
    );
  }
  await editor
    .getByRole('button', { name: 'Back to slides', exact: true })
    .click();
  await editor.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'New slide', exact: true }).click();
  await editor.getByLabel('Slide name').fill('Edited starter retained');
  await editor.getByLabel('Text content').fill('An intentional message');
  await editor.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(
    await editor.getByLabel('Text content').inputValue(),
    'Something worth\nsharing.',
  );
  await editor.getByRole('button', { name: 'Save slide', exact: true }).click();
  const intentional = (await api('/api/library')).slides.find(
    (s) => s.name === 'Edited starter retained',
  );
  assert.equal(intentional.layers[0].starterText, undefined);
  const preserved = await api('/api/playlists', 'POST', {
    name: 'Intentional text',
    items: [{ slideId: intentional.id, duration: 10 }],
  });
  await api(`/api/playlists/${preserved.id}/publish`, 'POST');
  assert.equal(
    (await api(`/api/preview/${preserved.id}?version=published`)).items[0].slide
      .layers.length,
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Workspace UI passed: retry states, starter creation/publication, draft and published previews, fixed mobile actions, route/filter reload and Back, mobile drawer closure, guided pairing and editor focus/publication impact.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(dir, { recursive: true, force: true });
}
