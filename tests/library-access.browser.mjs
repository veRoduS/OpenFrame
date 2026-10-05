import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from '../server/app.mjs';

// Every request and mutation below targets a disposable local database.
delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = mkdtempSync(
  path.join(os.tmpdir(), 'openframe-library-access-'),
);
const instance = createApp({ dataDir: directory });
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
    ...(process.env.OPENFRAME_BROWSER_EXECUTABLE
      ? { executablePath: process.env.OPENFRAME_BROWSER_EXECUTABLE }
      : {}),
  });
  const adminPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  async function api(page, url, method = 'GET', data) {
    const response = await page.request.fetch(base + url, { method, data });
    assert.ok(
      response.ok(),
      `${method} ${url}: ${response.status()} ${await response.text()}`,
    );
    return response.json();
  }
  await api(adminPage, '/api/setup', 'POST', {
    password: 'browser-check-password',
  });
  const top = await api(adminPage, '/api/groups', 'POST', {
    name: 'Master group',
  });
  const branch = await api(adminPage, '/api/groups', 'POST', {
    name: 'Local group',
    parentId: top.id,
  });
  const user = await api(adminPage, '/api/users', 'POST', {
    name: 'Local editor',
    username: 'local-editor',
  });
  await api(
    adminPage,
    `/api/groups/${branch.id}/members/${user.user.id}`,
    'PUT',
    { role: 'member' },
  );
  const source = await api(adminPage, '/api/slides', 'POST', {
    name: 'Safety master',
    width: 1920,
    height: 1080,
    layers: [],
    managingGroupId: top.id,
  });
  const master = await api(adminPage, '/api/playlists', 'POST', {
    name: 'Safety playlist',
    managingGroupId: top.id,
    items: [{ slideId: source.id, duration: 20 }],
  });
  await api(adminPage, `/api/playlists/${master.id}/publish`, 'POST');
  await api(adminPage, `/api/access/slide/${source.id}`, 'POST', {
    groupId: branch.id,
    permission: 'view',
  });
  await api(adminPage, `/api/access/slide/${source.id}`, 'POST', {
    userId: user.user.id,
    permission: 'view',
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await api(page, '/api/login', 'POST', {
    username: 'local-editor',
    password: user.password,
  });
  const local = await api(page, '/api/slides', 'POST', {
    name: 'Local announcement',
    width: 1920,
    height: 1080,
    layers: [],
    managingGroupId: branch.id,
  });
  await page.goto(`${base}/dashboard`);
  await page
    .getByRole('button', { name: 'View Safety master', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByText('View only. This slide is managed by another group.')
    .waitFor();
  assert.equal(
    await dialog.getByRole('button', { name: 'Save', exact: true }).count(),
    0,
  );
  await page.keyboard.press('Escape');
  assert.equal(
    await page
      .getByRole('button', { name: 'Delete Safety master', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole('checkbox', { name: 'Select Safety master', exact: true })
      .count(),
    0,
  );
  await page
    .getByRole('checkbox', { name: 'Select Local announcement', exact: true })
    .check();
  await page.getByRole('button', { name: 'Move / tag', exact: true }).click();
  await dialog.getByLabel('Add tags', { exact: true }).fill('Local, Safety');
  await dialog
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(
    (await api(page, '/api/library')).slides.find((s) => s.id === local.id)
      .tags,
    ['local', 'safety'],
  );
  await page
    .getByLabel('Filter slides by tag', { exact: true })
    .selectOption('local');
  assert.equal(
    await page
      .getByRole('button', { name: 'View Safety master', exact: true })
      .count(),
    0,
  );
  await page
    .getByRole('button', { name: 'Clear folder and tag filters', exact: true })
    .click();
  await page.locator('.library-folder-menu summary').click();
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Local folder');
  await dialog
    .getByRole('button', { name: 'Save folder', exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
  const folder = (await api(page, '/api/library')).slideFolders.find(
    (f) => f.name === 'Local folder',
  );
  const drag = await page.evaluateHandle(() => new DataTransfer());
  await page
    .getByRole('button', { name: 'Edit Local announcement', exact: true })
    .dispatchEvent('dragstart', { dataTransfer: drag });
  await page
    .getByRole('button', { name: 'Local folder', exact: true })
    .dispatchEvent('drop', { dataTransfer: drag });
  await page.waitForFunction(
    async (id) =>
      (await (await fetch('/api/library')).json()).slides.some(
        (s) => s.id === id && !!s.folderId,
      ),
    local.id,
  );
  assert.equal(
    (await api(page, '/api/library')).slides.find((s) => s.id === local.id)
      .folderId,
    folder.id,
  );
  await page.locator('.library-folder-menu summary').click();
  await page.getByRole('button', { name: /^Playlists/ }).click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit Safety playlist', exact: true })
      .count(),
    0,
  );
  await page
    .getByRole('button', { name: 'Fork Safety playlist', exact: true })
    .click();
  await dialog.getByLabel('Name', { exact: true }).fill('Local safety fork');
  await dialog
    .getByLabel('Managing group', { exact: true })
    .selectOption(branch.id);
  await dialog
    .getByRole('button', { name: 'Create linked fork', exact: true })
    .click();
  await dialog.getByLabel('Fork playback speed', { exact: true }).fill('2');
  await dialog.getByRole('tab', { name: 'Add slides', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Add Local announcement', exact: true })
    .click();
  await dialog.getByRole('tab', { name: 'Sequence (2)', exact: true }).click();
  assert.equal(
    await dialog
      .getByRole('button', { name: 'Remove slide 1', exact: true })
      .isDisabled(),
    true,
  );
  await dialog
    .getByRole('button', { name: 'Move slide 2 up', exact: true })
    .click();
  assert.equal(
    await dialog.getByLabel('Fork order', { exact: true }).inputValue(),
    'custom',
  );
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
  await dialog.getByText('Playlist saved.', { exact: true }).waitFor();
  const fork = (await api(page, '/api/library')).playlists.find(
    (p) => p.name === 'Local safety fork',
  );
  assert.equal(fork.fork.speed, 2);
  assert.equal(fork.items[0].slideId, local.id);
  await page.keyboard.press('Escape');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 500)
      await page
        .getByRole('button', { name: 'Toggle Sidebar', exact: true })
        .click();
    await page.getByRole('button', { name: /^Slides/ }).click();
    if (width < 500) await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await page
      .getByRole('button', { name: 'View Safety master', exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
      `Horizontal overflow at ${width}px`,
    );
    mkdirSync(path.join(root, 'work'), { recursive: true });
    await page.screenshot({
      path: path.join(root, 'work', `library-access-${width}.png`),
      fullPage: true,
    });
  }
  await adminPage.goto(`${base}/dashboard`);
  await adminPage
    .getByRole('button', {
      name: 'Manage access to Safety master',
      exact: true,
    })
    .click();
  const access = adminPage.getByRole('dialog');
  await access
    .getByLabel('Permission for Local group', { exact: true })
    .waitFor();
  for (const width of [1280, 390]) {
    await adminPage.setViewportSize({ width, height: 900 });
    assert.equal(
      await access.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
      `Access dialog overflow at ${width}px`,
    );
    const row = access.locator('.access-grant-row').first();
    const boxes = await row.evaluate((el) =>
      [...el.children].map((child) => child.getBoundingClientRect().toJSON()),
    );
    assert.ok(
      boxes[1].x >= boxes[0].right && boxes[2].x >= boxes[1].right,
      'Grant name, role, and remove controls overlap',
    );
    await adminPage.screenshot({
      path: path.join(root, 'work', `library-access-dialog-${width}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'Library browser checks passed: inherited read-only views, independent forks, timing/order, bulk tagging, folder moves, and desktop/mobile layouts.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
}
