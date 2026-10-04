import sharp from 'sharp';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(
  path.join(os.tmpdir(), 'openframe-organization-browser-'),
);
const instance = createApp({ dataDir: dir });
instance.app.use(express.static(path.join(root, 'dist')));
instance.app.get('/{*path}', (req, res) =>
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
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function api(url, method = 'GET', data) {
    const response = await page.request.fetch(base + url, { method, data });
    assert.ok(
      response.ok(),
      `${method} ${url}: ${response.status()} ${await response.text()}`,
    );
    return response.json();
  }
  await api('/api/setup', 'POST', { password: 'browser8' });
  const parent = await api('/api/groups', 'POST', { name: 'Group A' });
  const child = await api('/api/groups', 'POST', {
    name: 'Group 1',
    parentId: parent.id,
  });
  const other = await api('/api/groups', 'POST', { name: 'Group B' });
  const created = await api('/api/users', 'POST', {
    name: 'Jordan Taylor',
    username: 'jordan',
  });
  const robin = await api('/api/users', 'POST', {
    name: 'Robin Smith',
    username: 'robin',
  });
  const mediaBuffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  const images = [];
  for (const name of ['first.png', 'second.png']) {
    const uploaded = await page.request.post(base + '/api/assets', {
      multipart: { file: { name, mimeType: 'image/png', buffer: mediaBuffer } },
    });
    assert.equal(uploaded.status(), 201);
    images.push(await uploaded.json());
  }
  const slide = await api('/api/slides', 'POST', {
    name: 'Nested welcome',
    width: 1920,
    height: 1080,
    background: '#ffffff',
    layers: [],
  });
  await api(`/api/access/slide/${slide.id}`, 'POST', { groupId: child.id });
  const folderA = await api('/api/folders', 'POST', { name: 'Events' });
  const folderB = await api('/api/folders', 'POST', { name: 'Campus' });
  const folderChild = await api('/api/folders', 'POST', {
    name: 'Summer',
    parentId: folderA.id,
  });
  await page.goto(`${base}/dashboard`);
  await page
    .getByRole('button', { name: 'Users & Groups', exact: true })
    .click();
  const section = page.locator('.group-section').filter({
    has: page.getByRole('heading', { name: 'Group A', exact: true }),
  });
  assert.equal(await page.locator('.group-details').count(), 0);
  await section.getByRole('button', { name: 'Group A', exact: true }).click();
  await section
    .getByLabel('Add user to Group A', { exact: true })
    .selectOption(robin.user.id);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/groups') &&
        response.request().method() === 'GET',
    ),
    section.getByRole('button', { name: 'Add user', exact: true }).click(),
  ]);
  assert.equal(
    await page.locator('[draggable="true"][aria-label^="Drag " ]').count(),
    0,
  );
  assert.ok(
    (await api('/api/groups'))
      .find((g) => g.id === parent.id)
      .members.some((u) => u.id === robin.user.id),
  );
  await page
    .locator('.group-drag-handle')
    .filter({ hasText: 'Group B' })
    .dragTo(section);
  await page
    .getByText('Group moved. Inherited access has been updated.', {
      exact: true,
    })
    .waitFor();
  assert.equal(
    (await api('/api/groups')).find((g) => g.id === other.id).parentId,
    parent.id,
  );
  await page.setViewportSize({ width: 1280, height: 1800 });
  assert.equal(
    await page.getByRole('button', { name: /Top-level groups/ }).count(),
    0,
  );
  const movedOut = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/groups/${other.id}`) &&
      response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Group B', exact: true }).click();
  await page
    .getByLabel('Group location for Group B', { exact: true })
    .selectOption('');
  assert.equal((await movedOut).status(), 200);
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Group location for Group B"]')
        .disabled,
  );
  assert.equal(
    (await api('/api/groups')).find((g) => g.id === other.id).parentId,
    null,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await section.getByRole('button', { name: 'Group A', exact: true }).click();
  await section
    .getByLabel('Add user to Group A', { exact: true })
    .selectOption(created.user.id);
  await section.getByRole('button', { name: 'Add user', exact: true }).click();
  await section.getByText('Jordan Taylor', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Group 1', exact: true }).click();
  await page
    .getByLabel('Group location for Group 1', { exact: true })
    .selectOption(other.id);
  await page
    .getByText('Group moved. Inherited access has been updated.', {
      exact: true,
    })
    .waitFor();
  assert.equal(
    (await api('/api/groups')).find((g) => g.id === child.id).parentId,
    other.id,
  );
  await page
    .getByLabel('Group location for Group 1', { exact: true })
    .selectOption(parent.id);
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Group location for Group 1"]')
        .disabled,
  );
  await page.getByRole('tab', { name: 'Users', exact: true }).click();
  await page
    .getByRole('button', { name: 'Jordan Taylor', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Groups', exact: true }).click();
  await dialog.getByText('Has inherited access', { exact: true }).waitFor();
  assert.equal(
    await dialog.getByLabel('Membership in Group B', { exact: true }).count(),
    0,
  );
  await dialog
    .getByRole('button', {
      name: 'Add direct membership for Jordan Taylor to Group B',
      exact: true,
    })
    .click();
  await dialog
    .getByText('Add Jordan Taylor to Group B?', { exact: true })
    .waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog
    .getByRole('button', {
      name: 'Add direct membership for Jordan Taylor to Group B',
      exact: true,
    })
    .click();
  await dialog
    .getByRole('button', { name: 'Confirm add', exact: true })
    .click();
  await dialog.getByLabel('Membership in Group B', { exact: true }).waitFor();
  assert.ok(
    (await api('/api/groups'))
      .find((group) => group.id === other.id)
      .members.some((person) => person.id === created.user.id),
  );
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Membership in Group B"]').disabled,
  );
  await dialog
    .getByLabel('Membership in Group B', { exact: true })
    .selectOption('');
  await dialog
    .getByRole('button', {
      name: 'Add direct membership for Jordan Taylor to Group B',
      exact: true,
    })
    .waitFor();
  await dialog.getByRole('tab', { name: 'Content', exact: true }).click();
  await dialog.getByRole('heading', { name: 'Slides', exact: true }).waitFor();
  await dialog.getByText('Through groups: Group 1', { exact: false }).waitFor();
  await dialog.getByRole('tab', { name: 'Account', exact: true }).click();
  await dialog
    .getByLabel('Account role', { exact: true })
    .selectOption('admin');
  await dialog
    .getByText('Admins have access to all content and account settings.', {
      exact: true,
    })
    .waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Account role"]').disabled,
  );
  await dialog.getByRole('tab', { name: 'Groups', exact: true }).click();
  assert.equal(
    await dialog.getByLabel('Membership in Group A', { exact: true }).count(),
    0,
  );
  assert.ok(
    (await dialog
      .getByText('Group admin · Unrestricted', { exact: true })
      .count()) >= 3,
  );
  await dialog.getByRole('tab', { name: 'Content', exact: true }).click();
  assert.equal(
    await dialog
      .getByLabel('Direct access to Nested welcome', { exact: true })
      .isChecked(),
    true,
  );
  await dialog.getByRole('tab', { name: 'Account', exact: true }).click();
  await dialog.getByLabel('Account role', { exact: true }).selectOption('user');
  await dialog.getByRole('tab', { name: 'Content', exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Direct access to Nested welcome"]')
        .disabled,
  );
  await dialog
    .getByLabel('Direct access to Nested welcome', { exact: true })
    .check();
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Direct access to Nested welcome"]')
        .disabled,
  );
  assert.equal(
    (await api(`/api/users/${created.user.id}/access`)).find(
      (item) => item.id === slide.id,
    ).direct,
    true,
  );
  await dialog
    .getByLabel('Direct access to Nested welcome', { exact: true })
    .uncheck();
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Direct access to Nested welcome"]')
        .disabled,
  );
  const effective = (await api(`/api/users/${created.user.id}/access`)).find(
    (item) => item.id === slide.id,
  );
  assert.equal(effective.direct, false);
  assert.equal(effective.effective, true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  mkdirSync(path.join(root, 'work'), { recursive: true });
  await dialog
    .getByLabel('Direct access to Nested welcome', { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(root, 'work/user-access-mobile.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(
    await page
      .getByRole('tab', { name: 'Sharing & assignments', exact: true })
      .count(),
    0,
  );
  await page
    .getByRole('button', { name: /^Slides/ })
    .first()
    .click();
  await page
    .getByRole('button', {
      name: 'Manage access to Nested welcome',
      exact: true,
    })
    .click();
  const options = await page
    .getByLabel('Groups', { exact: true })
    .locator('option')
    .allTextContents();
  const rootIndex = options.findIndex((name) => name === 'Group A');
  assert.equal(options[rootIndex + 1], '\u00a0\u00a0\u00a0\u00a0↳ Group 1');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Media/ }).click();
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const folderDialog = page.getByRole('dialog');
  await folderDialog.getByLabel('Folder location', { exact: true }).waitFor();
  assert.equal(
    await folderDialog
      .getByRole('option', { name: 'Top level', exact: true })
      .count(),
    1,
  );
  assert.equal(
    await folderDialog.getByLabel('Parent folder', { exact: true }).count(),
    0,
  );
  await page.keyboard.press('Escape');
  await folderDialog.waitFor({ state: 'detached' });
  const nav = page.getByRole('navigation', { name: 'Media folders' });
  const folder = (name) =>
    nav.getByRole('button', { name: new RegExp(`^${name}`) });
  await page
    .getByRole('checkbox', { name: `Select ${images[0].name}`, exact: true })
    .click();
  await page
    .getByRole('checkbox', { name: `Select ${images[1].name}`, exact: true })
    .click();
  await page
    .getByRole('button', { name: `Edit ${images[0].name}`, exact: true })
    .dragTo(folder('Campus'));
  await page.getByText('Moved 2 media files', { exact: true }).waitFor();
  assert.ok(
    (await api('/api/library')).assets.every(
      (asset) => asset.folderId === folderB.id,
    ),
  );
  await page
    .getByRole('button', { name: `Edit ${images[0].name}`, exact: true })
    .dragTo(nav.getByRole('button', { name: /^Unfiled/ }));
  await page.getByText('Moved 1 media file', { exact: true }).waitFor();
  assert.equal(
    (await api('/api/library')).assets.find(
      (asset) => asset.id === images[0].id,
    ).folderId,
    null,
  );
  assert.equal(await folder('Summer').locator('span').innerText(), 'Summer');
  assert.ok(
    (await folder('Summer').evaluate((el) =>
      parseFloat(el.style.paddingLeft),
    )) >
      (await folder('Events').evaluate((el) =>
        parseFloat(el.style.paddingLeft),
      )),
  );
  await folder('Events').dragTo(folder('Campus'));
  await page.getByText('Moved Events', { exact: true }).waitFor();
  assert.equal(
    (await api('/api/library')).folders.find((f) => f.id === folderA.id)
      .parentId,
    folderB.id,
  );
  assert.equal(
    (await api('/api/library')).folders.find((f) => f.id === folderChild.id)
      .parentId,
    folderA.id,
  );
  await folder('Events').dragTo(
    nav.getByRole('button', { name: /^All media/ }),
  );
  await page.waitForFunction(
    () => !document.querySelector('.folder-navigation [draggable="false"]'),
  );
  assert.equal(
    (await api('/api/library')).folders.find((f) => f.id === folderA.id)
      .parentId,
    null,
  );
  await folder('Events').dragTo(folder('Summer'));
  assert.equal(
    (await api('/api/library')).folders.find((f) => f.id === folderA.id)
      .parentId,
    null,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: path.join(root, 'work/media-folders-mobile.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'Organization browser checks passed: admin membership/role/access controls, group moves, inherited labels, tree indentation, folder drag/drop/cycles, desktop/mobile layouts.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(dir, { recursive: true, force: true });
}
