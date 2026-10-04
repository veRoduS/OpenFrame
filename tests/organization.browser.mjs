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
  await page
    .getByLabel('Add user to Group A', { exact: true })
    .selectOption(created.user.id);
  const section = page.locator('.group-section').filter({
    has: page.getByRole('heading', { name: 'Group A', exact: true }),
  });
  await section.getByRole('button', { name: 'Add user', exact: true }).click();
  await section.getByText('Jordan Taylor', { exact: true }).waitFor();
  await page
    .getByLabel('Parent group for Group 1', { exact: true })
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
    .getByLabel('Parent group for Group 1', { exact: true })
    .selectOption(parent.id);
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Parent group for Group 1"]')
        .disabled,
  );
  await page.getByRole('tab', { name: 'Users', exact: true }).click();
  await page
    .getByRole('button', { name: 'Jordan Taylor', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Through groups: Group 1', { exact: false }).waitFor();
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
  await dialog.getByLabel('Account role', { exact: true }).selectOption('user');
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
  await page.getByRole('tab', { name: 'Sharing & assignments' }).click();
  await page.getByLabel('Resource', { exact: true }).selectOption('slide');
  await page.getByRole('button', { name: 'Access', exact: true }).click();
  const options = await page
    .getByLabel('Share with')
    .locator('option')
    .allTextContents();
  const rootIndex = options.findIndex((name) => name === 'Group A (group)');
  assert.equal(
    options[rootIndex + 1],
    '\u00a0\u00a0\u00a0\u00a0↳ Group 1 (group)',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Media/ }).click();
  const nav = page.getByRole('navigation', { name: 'Media folders' });
  const folder = (name) =>
    nav.getByRole('button', { name: new RegExp(`^${name}`) });
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
