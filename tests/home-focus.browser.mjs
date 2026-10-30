import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const directory = mkdtempSync(
  path.join(os.tmpdir(), 'openframe-home-browser-'),
);
const instance = createApp({ dataDir: directory });
instance.app.use('/player', express.static(path.resolve('player/web')));
instance.app.use(express.static(path.resolve('dist')));
instance.app.get('/{*path}', (_req, res) =>
  res.sendFile(path.resolve('dist/index.html')),
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
  const adminContext = await browser.newContext();
  async function api(route, method = 'GET', data) {
    const response = await adminContext.request.fetch(base + route, {
      method,
      data,
    });
    assert.ok(response.ok(), `${route}: ${await response.text()}`);
    return response.json();
  }
  await api('/api/setup', 'POST', { password: 'home-browser-password' });
  const company = await api('/api/groups', 'POST', {
    name: 'Company templates',
  });
  const north = await api('/api/groups', 'POST', {
    name: 'North store',
    parentId: company.id,
  });
  const south = await api('/api/groups', 'POST', {
    name: 'South store',
    parentId: company.id,
  });
  const department = await api('/api/groups', 'POST', {
    name: 'North department',
    parentId: north.id,
  });
  const sites = [];
  for (const [index, group] of [north, south].entries())
    sites.push(
      await api('/api/sites', 'POST', {
        siteNumber: `00${index + 1}`,
        name: group.name,
        accessGroupId: group.id,
      }),
    );
  for (const [name, group] of [
    ['North slide', north],
    ['South slide', south],
    ['Shared slide', company],
    ['Department slide', department],
  ]) {
    const slide = await api('/api/slides', 'POST', {
      name,
      managingGroupId: group.id,
      width: 1920,
      height: 1080,
      layers: [],
    });
    await api('/api/playlists', 'POST', {
      name: name.replace('slide', 'playlist'),
      managingGroupId: group.id,
      items: [{ slideId: slide.id, duration: 30 }],
    });
  }
  await api('/api/slides', 'POST', {
    name: 'Personal slide',
    width: 1920,
    height: 1080,
    layers: [],
  });
  for (const site of sites) {
    const screen = await api('/api/player/enroll', 'POST', {
      name: `${site.name} TV`,
      siteNumber: site.siteNumber,
    });
    await api(`/api/devices/${screen.id}/approve`, 'POST', {
      code: screen.code,
      siteId: site.id,
    });
    await api(`/api/access/device/${screen.id}`, 'POST', {
      groupId: site.accessGroupId,
    });
  }
  const invitation = await api('/api/users', 'POST', {
    username: 'store-manager',
    name: 'Store manager',
  });
  await api(`/api/users/${invitation.user.id}`, 'PATCH', { role: 'admin' });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  assert.equal(
    (
      await context.request.post(base + '/api/activate', {
        data: {
          token: invitation.invitation,
          password: 'home-browser-password',
        },
      })
    ).status(),
    200,
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const nav = (label) =>
    page.locator('[data-sidebar="menu-button"]').filter({ hasText: label });
  await page.goto(base + '/dashboard/slides');
  await nav('Users & Groups').waitFor();
  assert.equal(
    await page.getByRole('switch', { name: 'Show admin controls' }).count(),
    0,
  );
  await page.getByLabel('Group', { exact: true }).selectOption(north.id);
  await page
    .getByRole('button', { name: 'Edit North slide', exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit South slide', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit Shared slide', exact: true })
      .count(),
    1,
  );
  await nav('Playlists').click();
  await page.getByLabel('Group', { exact: true }).selectOption(north.id);
  await page
    .getByRole('button', { name: 'Edit North playlist', exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit South playlist', exact: true })
      .count(),
    0,
  );
  await nav('Screens').click();
  await page.getByLabel('Group', { exact: true }).selectOption(north.id);
  assert.equal(await page.locator('.device-row').count(), 1);
  assert.match(
    await page.locator('.device-row').textContent(),
    /North store TV/,
  );
  await page
    .getByRole('button', { name: 'Set home store or group', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Home store or group', { exact: true })
    .selectOption(`site:${sites[0].id}`);
  await dialog
    .getByRole('button', { name: 'Save home workspace', exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
  const toggle = page.getByRole('switch', {
    name: 'Show admin controls',
    exact: true,
  });
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  assert.equal(await nav('Users & Groups').count(), 0);
  assert.equal(await nav('Settings').count(), 0);
  assert.equal(
    await page
      .getByRole('button', { name: 'Revoke device', exact: true })
      .count(),
    0,
  );
  await nav('Slides').click();
  await page
    .getByRole('button', { name: 'Edit North slide', exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit South slide', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit Personal slide', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit Department slide', exact: true })
      .count(),
    1,
  );
  await page.screenshot({ path: 'work/home-focus-desktop.png' });
  await page.getByRole('button', { name: 'New slide', exact: true }).click();
  await page
    .getByLabel('Slide name', { exact: true })
    .fill('Home-created slide');
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Back to slides', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit Home-created slide', exact: true })
    .waitFor();
  assert.equal(
    (await api('/api/library')).slides.find(
      (slide) => slide.name === 'Home-created slide',
    ).managingGroupId,
    north.id,
  );
  await nav('Playlists').click();
  await page.getByRole('button', { name: 'New playlist', exact: true }).click();
  const playlistDialog = page.getByRole('dialog');
  assert.equal(
    await playlistDialog
      .getByLabel('Playlist managing group', { exact: true })
      .inputValue(),
    north.id,
  );
  await playlistDialog
    .getByLabel('Playlist name', { exact: true })
    .fill('Home-created playlist');
  const savedPlaylist = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/playlists') &&
      response.request().method() === 'POST',
  );
  await playlistDialog
    .getByRole('button', { name: 'Save draft', exact: true })
    .click();
  const savedHomePlaylist = await (await savedPlaylist).json();
  assert.equal(savedHomePlaylist.managingGroupId, north.id);
  await playlistDialog
    .getByLabel('Playlist managing group', { exact: true })
    .waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await playlistDialog.waitFor({ state: 'hidden' });
  await nav('Slides').click();
  await page.getByLabel('Group', { exact: true }).selectOption(south.id);
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit South slide', exact: true })
      .count(),
    0,
  );
  await toggle.click();
  await nav('Users & Groups').waitFor();
  await page
    .getByRole('button', { name: 'Edit South slide', exact: true })
    .waitFor();
  await page.reload();
  await nav('Users & Groups').waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await toggle.click();
  await page.reload();
  await toggle.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role="switch"][aria-label="Show admin controls"]')
        ?.getAttribute('aria-checked') === 'false',
  );
  assert.equal(await nav('Users & Groups').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.getByLabel('Group', { exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  await page
    .getByRole('button', { name: 'Toggle Sidebar', exact: true })
    .click();
  await page.getByRole('dialog', { name: 'Sidebar', exact: true }).waitFor();
  await page.waitForFunction(() => {
    const sidebar = document.querySelector(
      '[data-mobile="true"][data-sidebar="sidebar"]',
    );
    const bounds = sidebar?.getBoundingClientRect();
    return (
      bounds &&
      bounds.left >= -1 &&
      bounds.right <= innerWidth + 1 &&
      Number(getComputedStyle(sidebar).opacity) > 0.95
    );
  });
  await toggle.waitFor({ state: 'visible' });
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  await toggle.click();
  await nav('Users & Groups').waitFor();
  await toggle.click();
  await page.screenshot({ path: 'work/home-focus-mobile.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole('button', { name: 'Set home store or group', exact: true })
    .click();
  await dialog
    .getByLabel('Home store or group', { exact: true })
    .selectOption(`group:${north.id}`);
  await dialog
    .getByRole('button', { name: 'Save home workspace', exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
  await nav('Playlists').click();
  await page
    .getByRole('button', { name: 'Edit North playlist', exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit South playlist', exact: true })
      .count(),
    0,
  );
  await page
    .getByRole('button', { name: 'Set home store or group', exact: true })
    .click();
  await dialog
    .getByLabel('Home store or group', { exact: true })
    .selectOption('');
  await dialog
    .getByRole('button', { name: 'Save home workspace', exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
  await nav('Users & Groups').waitFor();
  assert.equal(await toggle.count(), 0);
  const rootPage = await adminContext.newPage();
  await rootPage.goto(base + '/dashboard/screens');
  await rootPage.locator('.device-row').first().waitFor();
  assert.equal(
    await rootPage
      .getByRole('button', { name: 'Set home store or group', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await rootPage
      .getByRole('switch', { name: 'Show admin controls', exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Home workspace browser checks passed: optional self-selection, store/group scope, subgroups/shared templates, mode persistence, admin control visibility, group filters and mobile layout; built-in admin unchanged.',
  );
} finally {
  await browser?.close();
  instance.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
}
