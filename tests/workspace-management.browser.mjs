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
const directory = mkdtempSync(path.join(os.tmpdir(), 'openframe-management-'));
const captures = path.join(root, 'work/ui-review/management');
mkdirSync(captures, { recursive: true });
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
    executablePath:
      process.env.OPENFRAME_BROWSER_EXECUTABLE || '/usr/bin/chromium',
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function api(url, method = 'GET', data, headers) {
    const response = await page.request.fetch(base + url, {
      method,
      data,
      headers,
    });
    assert.ok(response.ok(), `${method} ${url}: ${await response.text()}`);
    return response.json();
  }
  async function noOverflow() {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `Page overflow at ${page.viewportSize().width}px`,
    );
    for (const dialog of await page.getByRole('dialog').all()) {
      assert.ok(
        await dialog.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.left >= -1 &&
            rect.right <= innerWidth + 1 &&
            element.scrollWidth <= element.clientWidth + 1
          );
        }),
        'Dialog should fit viewport',
      );
    }
  }
  await api('/api/setup', 'POST', { password: 'management-browser-password' });
  const group = await api('/api/groups', 'POST', { name: 'Campus' });
  const person = (
    await api('/api/users', 'POST', {
      name: 'Jordan Taylor',
      username: 'jordan',
    })
  ).user;
  const slide = await api('/api/slides', 'POST', {
    name: 'Welcome',
    width: 1920,
    height: 1080,
    layers: [],
  });
  // Use a valid editor layer rather than depending on server default text.
  await api(`/api/slides/${slide.id}`, 'PUT', {
    ...slide,
    layers: [
      {
        id: crypto.randomUUID(),
        type: 'text',
        x: 10,
        y: 10,
        width: 50,
        height: 10,
        text: 'Welcome',
        fontSize: 48,
        color: '#111111',
      },
    ],
  });
  await api('/api/organization/slides', 'POST', {
    ids: [slide.id],
    addTags: ['welcome', 'campus'],
  });
  await api(`/api/access/slide/${slide.id}`, 'POST', { groupId: group.id });
  const playlist = await api('/api/playlists', 'POST', {
    name: 'Campus loop',
    items: [{ slideId: slide.id, duration: 10 }],
  });
  await api(`/api/playlists/${playlist.id}/publish`, 'POST', {});
  const screens = [];
  for (const name of ['Screen 10', 'Screen 2', 'Atrium']) {
    const screen = await api('/api/player/enroll', 'POST', { name });
    await api(`/api/devices/${screen.id}/approve`, 'POST', {
      code: screen.code,
    });
    await api(`/api/devices/${screen.id}`, 'PUT', {
      name,
      playlistId: playlist.id,
      blank: false,
      rotation: 0,
    });
    await api(
      '/api/player/sync',
      'POST',
      {},
      { Authorization: `Bearer ${screen.token}` },
    );
    screens.push({ ...screen, name });
  }
  const png = await sharp({
    create: { width: 16, height: 9, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  for (let i = 0; i < 8; i++) {
    const response = await page.request.post(base + '/api/assets', {
      multipart: {
        file: { name: `image-${i}.png`, mimeType: 'image/png', buffer: png },
      },
    });
    assert.equal(response.status(), 201);
  }
  await page.goto(`${base}/dashboard`);
  await page
    .locator('.slide-card-info .title-button')
    .filter({ hasText: /1 layer$/ })
    .waitFor();
  assert.equal(
    await page
      .locator('.slide-card-info .title-button')
      .filter({ hasText: /1 layers/ })
      .count(),
    0,
  );
  await page
    .getByRole('button', { name: 'Screen assignments for Welcome' })
    .hover();
  const tooltip = page.locator('[data-slot="tooltip-content"]');
  await tooltip.getByText('Assigned to connected screens').waitFor();
  assert.equal(
    await tooltip
      .getByText(
        'Connection does not confirm that a physical display is showing this slide.',
      )
      .count(),
    0,
  );
  await page.getByRole('button', { name: 'Tags for Welcome' }).hover();
  await tooltip.getByText('campus', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Tags for Welcome' }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Tags', { exact: true })
    .fill('campus, updated');
  const before = (await api('/api/library')).slides.find(
    (item) => item.id === slide.id,
  );
  await page.getByRole('button', { name: 'Save tags', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const after = (await api('/api/library')).slides.find(
    (item) => item.id === slide.id,
  );
  assert.deepEqual(after.tags, ['campus', 'updated']);
  assert.deepEqual(after.layers, before.layers);
  assert.equal(
    (await api('/api/library')).playlists.find(
      (item) => item.id === playlist.id,
    ).publicationState,
    'published',
  );
  await page.getByRole('button', { name: 'Manage access to Welcome' }).hover();
  await tooltip.getByText('Group: Campus', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Manage access to Welcome' }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Users & Groups', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Users', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: 'admin', exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .locator('.account-row span')
      .filter({ hasText: /^admin$/ })
      .count(),
    0,
  );
  await page
    .getByRole('button', { name: 'Jordan Taylor', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('tab', { name: 'Groups', exact: true })
    .click();
  const membership = page.getByLabel('Membership in Campus', { exact: true });
  await membership.selectOption('member');
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Membership in Campus"]').disabled,
  );
  assert.equal(
    (await api('/api/groups'))
      .find((item) => item.id === group.id)
      .members.find((member) => member.id === person.id).directRole,
    'member',
  );
  await membership.selectOption('');
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Membership in Campus"]').disabled,
  );
  await page
    .getByRole('dialog')
    .getByRole('tab', { name: 'Account', exact: true })
    .click();
  await page.getByLabel('Account role', { exact: true }).selectOption('admin');
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Account role"]').disabled,
  );
  await page
    .getByRole('dialog')
    .getByRole('tab', { name: 'Groups', exact: true })
    .click();
  await membership.selectOption('member');
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Membership in Campus"]').disabled,
  );
  await membership.selectOption('');
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Membership in Campus"]').disabled,
  );
  await page
    .getByRole('dialog')
    .getByText('Admin · Unrestricted', { exact: true })
    .waitFor();
  const effective = (await api('/api/groups'))
    .find((item) => item.id === group.id)
    .members.find((member) => member.id === person.id);
  assert.equal(effective.role, 'admin');
  assert.equal(effective.directRole, null);
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Delete Jordan Taylor', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  assert.ok((await api('/api/users')).some((user) => user.id === person.id));
  await page
    .getByRole('button', { name: 'Delete Jordan Taylor', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete user', exact: true })
    .click();
  await page
    .getByText('User deleted. Content has been preserved.', { exact: true })
    .waitFor();
  assert.equal(
    (await api('/api/users')).some((user) => user.id === person.id),
    false,
  );
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/dashboard`);
    for (const name of [
      'Small grid',
      'Medium grid',
      'Large grid',
      'List view',
    ]) {
      await page.getByRole('button', { name, exact: true }).click();
      await noOverflow();
      if (name === 'Medium grid' || name === 'List view')
        await page.screenshot({
          path: path.join(
            captures,
            `slides-${name === 'List view' ? 'list' : 'grid'}-${width}.png`,
          ),
          fullPage: true,
        });
      await page.getByRole('button', { name: 'Tags for Welcome' }).click();
      await page.getByRole('dialog').waitFor();
      await noOverflow();
      await page.keyboard.press('Escape');
    }
    await page.goto(`${base}/dashboard/media`);
    const columns = [];
    for (const [name, layout] of [
      ['Small grid', 'small'],
      ['Medium grid', 'medium'],
      ['Large grid', 'large'],
      ['List view', 'list'],
    ]) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.locator(`[data-layout="${layout}"]`).waitFor();
      await noOverflow();
      if (layout !== 'list')
        columns.push(
          await page
            .locator('.media-browser-grid')
            .evaluate(
              (element) =>
                getComputedStyle(element).gridTemplateColumns.split(' ').length,
            ),
        );
    }
    if (width === 1280)
      assert.ok(
        columns[0] > columns[1] && columns[1] > columns[2],
        `Distinct media grid sizes: ${columns.join(', ')}`,
      );
    await page.getByRole('button', { name: 'Large grid', exact: true }).click();
    await page.reload();
    await page.locator('.media-browser-grid[data-layout="large"]').waitFor();
    await page.screenshot({
      path: path.join(captures, `media-large-${width}.png`),
      fullPage: true,
    });
    await page.goto(`${base}/dashboard/screens`);
    const expected = ['Atrium', 'Screen 2', 'Screen 10'];
    await page.locator('.device-row').first().waitFor();
    assert.deepEqual(
      await page.locator('.screen-name-display strong').allTextContents(),
      expected,
    );
    for (const name of ['Grid view', 'Row view']) {
      await page.getByRole('button', { name, exact: true }).click();
      await noOverflow();
      for (const screen of screens) {
        await api(
          '/api/player/sync',
          'POST',
          {},
          { Authorization: `Bearer ${screen.token}` },
        );
        await Promise.all([
          page.waitForResponse((response) =>
            response.url().endsWith('/api/library'),
          ),
          page
            .getByRole('button', { name: 'Refresh screens', exact: true })
            .click(),
        ]);
        assert.deepEqual(
          await page.locator('.screen-name-display strong').allTextContents(),
          expected,
        );
      }
    }
    await page.getByRole('button', { name: 'Grid view', exact: true }).click();
    await page.reload();
    await page.locator('.devices-list[data-layout="grid"]').waitFor();
    await noOverflow();
    await page.screenshot({
      path: path.join(captures, `screens-grid-${width}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'Workspace management browser checks passed: metadata, memberships, deletion, media sizes, stable screen views, desktop/phone layouts.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  instance.close();
  rmSync(directory, { recursive: true, force: true });
}
