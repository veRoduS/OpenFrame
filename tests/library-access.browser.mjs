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
  assert.equal(
    await page.getByRole('button', { name: 'New folder', exact: true }).count(),
    0,
  );
  const folder = await api(adminPage, '/api/library-folders/slides', 'POST', {
    name: 'Local folder',
  });
  await page.reload();
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
  // The same folder interactions are available in both libraries, including phones.
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [kind, noun, item, dragName] of [
    ['slides', 'Slide', local, 'Edit Local announcement'],
    ['playlists', 'Playlist', fork, 'Edit Local safety fork'],
  ]) {
    const outer = await api(adminPage, `/api/library-folders/${kind}`, 'POST', {
      name: `${noun} outer folder`,
    });
    const inner = await api(adminPage, `/api/library-folders/${kind}`, 'POST', {
      name: `${noun} inner folder`,
      parentId: outer.id,
    });
    await page.goto(`${base}/dashboard`);
    if (kind === 'playlists')
      await page.getByRole('button', { name: /^Playlists/ }).click();
    const nav = page.getByRole('navigation', {
      name: `${noun} folders`,
      exact: true,
    });
    const innerButton = nav.getByRole('button', {
      name: inner.name,
      exact: true,
    });
    const outerButton = nav.getByRole('button', {
      name: outer.name,
      exact: true,
    });
    assert.ok(
      Number.parseInt(
        await innerButton.evaluate((el) => getComputedStyle(el).paddingLeft),
      ) >
        Number.parseInt(
          await outerButton.evaluate((el) => getComputedStyle(el).paddingLeft),
        ),
    );
    await nav
      .getByRole('button', { name: `Collapse ${outer.name}`, exact: true })
      .click();
    assert.equal(await innerButton.count(), 0);
    await nav
      .getByRole('button', { name: `Expand ${outer.name}`, exact: true })
      .click();
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    const dragSource =
      kind === 'playlists'
        ? page
            .locator('.playlist-name-info .title-button')
            .filter({ hasText: item.name })
        : page.getByRole('button', { name: dragName, exact: true });
    await dragSource.dispatchEvent('dragstart', { dataTransfer: transfer });
    await innerButton.dispatchEvent('drop', { dataTransfer: transfer });
    await page.waitForFunction(
      async ({ kind, id, folderId }) =>
        (await (await fetch('/api/library')).json())[kind].some(
          (entry) => entry.id === id && entry.folderId === folderId,
        ),
      { kind, id: item.id, folderId: inner.id },
    );
    await outerButton.click();
    await page.getByRole('button', { name: dragName, exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Edit folder', exact: true })
        .count(),
      0,
    );
    await api(adminPage, `/api/library-folders/${kind}/${outer.id}`, 'PUT', {
      ...outer,
      name: `${outer.name} renamed`,
    });
    await page.reload();
    if (kind === 'playlists')
      await page.getByRole('button', { name: /^Playlists/ }).click();
    await nav
      .getByRole('button', { name: `${outer.name} renamed`, exact: true })
      .click();
    await page.screenshot({
      path: path.join(root, 'work', `${kind}-folders-desktop.png`),
      fullPage: true,
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await nav.isVisible(), false);
      await page
        .getByRole('button', { name: new RegExp(`^Choose ${kind} folder:`) })
        .click();
      await innerButton.click();
      assert.equal(await nav.isVisible(), false);
      await page.getByRole('button', { name: dragName, exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        `${kind} folder overflow at ${width}px`,
      );
      await page.screenshot({
        path: path.join(root, 'work', `${kind}-folders-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(await innerButton.getAttribute('draggable'), 'false');
    await api(adminPage, `/api/library-folders/${kind}/${inner.id}`, 'PUT', {
      ...inner,
      parentId: null,
    });
    await page.waitForFunction(
      async ({ kind, id }) =>
        (await (await fetch('/api/library')).json())[
          kind === 'slides' ? 'slideFolders' : 'playlistFolders'
        ].some((entry) => entry.id === id && !entry.parentId),
      { kind, id: inner.id },
    );
  }
  // Moving feeds into Settings preserves existing non-admin View/Edit permissions.
  const inheritedFeed = await api(adminPage, '/api/data-feeds', 'POST', {
    name: 'Regional data',
    managingGroupId: top.id,
    fields: [{ key: 'value', type: 'number' }],
  });
  await page.goto(`${base}/dashboard`);
  await page.getByRole('button', { name: /^Settings/ }).click();
  assert.equal(
    await page
      .getByRole('heading', { name: 'Stock quotes', exact: true })
      .count(),
    0,
  );
  await page.getByRole('button', { name: /Regional data.*field/ }).click();
  await dialog
    .getByText('View only. The managing group controls this feed.', {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await dialog
      .getByRole('button', { name: 'Generate API key', exact: true })
      .count(),
    0,
  );
  assert.equal(
    (await api(page, `/api/data-feeds/${inheritedFeed.id}`)).readOnly,
    true,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New feed', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Local data');
  await dialog
    .getByRole('button', { name: 'Create feed', exact: true })
    .click();
  await page.getByRole('button', { name: /Local data.*field/ }).click();
  await dialog
    .getByRole('button', { name: 'Generate API key', exact: true })
    .waitFor();
  await page.keyboard.press('Escape');
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
