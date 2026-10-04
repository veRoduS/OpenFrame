import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = path.resolve(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-filters-'));
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
    executablePath:
      process.env.OPENFRAME_BROWSER_EXECUTABLE || '/usr/bin/chromium',
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const api = async (url, method = 'GET', data) => {
    const response = await page.request.fetch(base + url, { method, data });
    assert.ok(response.ok(), `${url}: ${await response.text()}`);
    return response.json();
  };
  await api('/api/setup', 'POST', { password: 'filter-test-password' });
  const parent = await api('/api/groups', 'POST', { name: 'Region' });
  const child = await api('/api/groups', 'POST', {
    name: 'Store 1',
    parentId: parent.id,
  });
  const sibling = await api('/api/groups', 'POST', {
    name: 'Store 2',
    parentId: parent.id,
  });
  const unrelated = await api('/api/groups', 'POST', { name: 'Other region' });
  for (const [name, group] of [
    ['Safety North', child],
    ['Safety South', sibling],
    ['Seasonal', unrelated],
    ['Personal', null],
  ]) {
    const slide = await api('/api/slides', 'POST', {
      name,
      width: 1920,
      height: 1080,
      background: '#ffffff',
      layers: [],
    });
    const playlist = await api('/api/playlists', 'POST', {
      name,
      items: [{ slideId: slide.id, duration: 15 }],
    });
    const device = await api('/api/player/enroll', 'POST', { name });
    if (group)
      for (const [kind, id] of [
        ['slide', slide.id],
        ['playlist', playlist.id],
        ['device', device.id],
      ]) {
        await api(`/api/access/${kind}/${id}`, 'POST', { groupId: group.id });
      }
    if (name === 'Safety North') {
      await api(`/api/playlists/${playlist.id}/publish`, 'POST');
      await api(`/api/devices/${device.id}/approve`, 'POST', {
        code: device.code,
      });
      await api(`/api/devices/${device.id}`, 'PUT', {
        name,
        playlistId: playlist.id,
        blank: false,
        rotation: 0,
      });
      const sync = await page.request.post(base + '/api/player/sync', {
        headers: { Authorization: `Bearer ${device.token}` },
        data: {},
      });
      assert.ok(sync.ok());
    }
  }
  const library = await api('/api/library');
  assert.ok(
    library.playlists.find((p) => p.name === 'Safety North').publishedSlideIds
      .length,
    JSON.stringify(library.playlists),
  );
  assert.ok(
    library.devices.find((d) => d.name === 'Safety North').lastSeen,
    JSON.stringify(library.devices),
  );
  assert.deepEqual(
    library.slides.find((s) => s.name === 'Safety North').groupIds,
    [child.id],
  );
  assert.ok(
    library.groups.some((g) => g.id === sibling.id && g.parentId === parent.id),
  );
  await page.goto(base + '/dashboard');
  await page.getByRole('heading', { name: 'Slides', exact: true }).waitFor();
  const liveCard = page.locator('.slide-card').filter({
    has: page.getByText('Safety North', { exact: true }),
  });
  await liveCard
    .getByRole('button', {
      name: 'Live playlists for Safety North',
      exact: true,
    })
    .hover();
  await page.getByText('Live in playlists', { exact: true }).waitFor();
  await page
    .locator('[data-slot=tooltip-content]')
    .getByText('Safety North', { exact: true })
    .waitFor();
  await page.mouse.move(0, 0);
  await page
    .locator('[data-slot=tooltip-content]')
    .waitFor({ state: 'hidden' });
  async function expectSlideOrder(expected) {
    await page.waitForFunction(
      (names) =>
        JSON.stringify(
          [
            ...document.querySelectorAll('.slide-card .title-button strong'),
          ].map((node) => node.textContent),
        ) === JSON.stringify(names),
      expected,
    );
  }
  await expectSlideOrder([
    'Personal',
    'Safety North',
    'Safety South',
    'Seasonal',
  ]);
  await page.getByLabel('Sort slides', { exact: true }).selectOption('oldest');
  await expectSlideOrder([
    'Safety North',
    'Safety South',
    'Seasonal',
    'Personal',
  ]);
  await page.getByLabel('Sort slides', { exact: true }).selectOption('newest');
  await expectSlideOrder([
    'Personal',
    'Seasonal',
    'Safety South',
    'Safety North',
  ]);
  const north = library.slides.find((slide) => slide.name === 'Safety North');
  await api(`/api/slides/${north.id}`, 'PUT', north);
  await page.reload();
  await page.locator('.slide-grid').waitFor();
  assert.equal(
    await page.getByLabel('Sort slides', { exact: true }).inputValue(),
    'newest',
  );
  await expectSlideOrder([
    'Safety North',
    'Personal',
    'Seasonal',
    'Safety South',
  ]);
  await page.getByLabel('Sort slides', { exact: true }).selectOption('name');
  await expectSlideOrder([
    'Personal',
    'Safety North',
    'Safety South',
    'Seasonal',
  ]);
  const viewControls = page.getByRole('group', {
    name: 'Slide view',
    exact: true,
  });
  const widths = {};
  for (const [layout, label] of [
    ['small', 'Small grid'],
    ['medium', 'Medium grid'],
    ['large', 'Large grid'],
    ['list', 'List view'],
  ]) {
    await viewControls
      .getByRole('button', { name: label, exact: true })
      .click();
    await page.locator(`.slide-grid[data-layout="${layout}"]`).waitFor();
    assert.equal(
      await viewControls
        .getByRole('button', { name: label, exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      (
        await viewControls
          .getByRole('button', { name: label, exact: true })
          .innerText()
      ).trim(),
      '',
    );
    assert.equal(await page.locator('.slide-card').count(), 4);
    widths[layout] = await page
      .locator('.slide-card')
      .first()
      .evaluate((node) => node.getBoundingClientRect().width);
  }
  assert.ok(
    widths.small < widths.medium && widths.medium < widths.large,
    JSON.stringify(widths),
  );
  assert.equal(
    await page
      .locator('.slide-grid')
      .evaluate(
        (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length,
      ),
    1,
  );
  await page.reload();
  await page.locator('.slide-grid[data-layout="list"]').waitFor();
  mkdirSync(path.join(root, 'work'), { recursive: true });
  await page.screenshot({
    path: path.join(root, 'work/slides-list-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 844 });
  for (const label of [
    'List view',
    'Small grid',
    'Medium grid',
    'Large grid',
  ]) {
    await viewControls
      .getByRole('button', { name: label, exact: true })
      .click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      label,
    );
  }
  await viewControls
    .getByRole('button', { name: 'List view', exact: true })
    .click();
  await page.screenshot({
    path: path.join(root, 'work/slides-list-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await viewControls
    .getByRole('button', { name: 'Medium grid', exact: true })
    .click();
  for (const [noun, selector] of [
    ['Slides', '.slide-card'],
    ['Playlists', '.playlist-row'],
    ['Screens', '.device-row'],
  ]) {
    if (noun !== 'Slides')
      await page
        .getByRole('button', { name: new RegExp(`^${noun}`) })
        .first()
        .click();
    const bar = page.getByRole('region', { name: `${noun} filters` });
    await bar
      .getByRole('status')
      .getByText(`Showing 4 of 4 ${noun.toLowerCase()}`, { exact: true })
      .waitFor();
    await bar.getByLabel('Group', { exact: true }).selectOption(parent.id);
    await bar
      .getByRole('status')
      .getByText(`Showing 2 of 4 ${noun.toLowerCase()}`, { exact: true })
      .waitFor();
    const childOption = bar
      .getByLabel('Group', { exact: true })
      .locator(`option[value="${child.id}"]`);
    assert.match(await childOption.textContent(), /↳ Store 1/);
    await bar.getByLabel(`Search ${noun.toLowerCase()}`).fill('  NORTH  ');
    await bar
      .getByRole('status')
      .getByText(`Showing 1 of 4 ${noun.toLowerCase()}`, { exact: true })
      .waitFor();
    assert.equal(await page.locator(selector).count(), 1);
    await bar
      .getByLabel('Status', { exact: true })
      .selectOption(
        noun === 'Slides'
          ? 'live'
          : noun === 'Playlists'
            ? 'published'
            : 'online',
      );
    await bar
      .getByRole('status')
      .getByText(`Showing 1 of 4 ${noun.toLowerCase()}`, { exact: true })
      .waitFor();
    await bar
      .getByLabel('Status', { exact: true })
      .selectOption(
        noun === 'Slides'
          ? 'not-live'
          : noun === 'Playlists'
            ? 'draft'
            : 'offline',
      );
    await page
      .getByText('No results match these filters.', { exact: false })
      .waitFor();
    await bar.getByRole('button', { name: 'Clear filters' }).click();
    await bar.getByLabel('Group', { exact: true }).selectOption('ungrouped');
    await bar
      .getByRole('status')
      .getByText(`Showing 1 of 4 ${noun.toLowerCase()}`, { exact: true })
      .waitFor();
    await bar.getByRole('button', { name: 'Clear filters' }).click();
    await bar.getByLabel('Group', { exact: true }).selectOption(child.id);
  }
  await page
    .getByRole('button', { name: /^Playlists/ })
    .first()
    .click();
  assert.equal(
    await page.getByLabel('Group', { exact: true }).inputValue(),
    child.id,
  );
  mkdirSync(path.join(root, 'work'), { recursive: true });
  await page.screenshot({
    path: path.join(root, 'work/access-playlists-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.screenshot({
    path: path.join(root, 'work/access-playlists-mobile.png'),
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    'Library filters passed: nested groups, name/status combinations, ungrouped resources, counts, empty results, independent page state and 320px layout.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(dir, { recursive: true, force: true });
}
