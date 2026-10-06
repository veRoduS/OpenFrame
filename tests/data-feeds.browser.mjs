import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
delete process.env.OPENFRAME_WG_SOCKET;
process.env.COOKIE_SECURE = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-data-browser-'));
const { app, db, close } = createApp({ dataDir: dir });
app.use('/player', express.static(path.join(root, 'player/web')));
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
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  async function api(route, method = 'GET', data, token) {
    const response = await context.request.fetch(base + route, {
      method,
      ...(data === undefined ? {} : { data }),
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
    const json = await response.json();
    assert.ok(response.ok(), `${response.status()}: ${JSON.stringify(json)}`);
    return json;
  }
  await api('/api/setup', 'POST', { password: 'data-widget-browser-password' });
  const chart = await api('/api/data-feeds', 'POST', {
    name: 'Store performance',
    fields: [
      { key: 'completed', type: 'number' },
      { key: 'goal', type: 'number' },
      { key: 'hourly', type: 'series' },
      { key: 'departments', type: 'categories' },
    ],
  });
  const issued = await api(`/api/data-feeds/${chart.id}/tokens`, 'POST', {
    name: 'Browser chart',
  });
  const values = {
    completed: 75,
    goal: 100,
    hourly: [
      { time: '2026-10-06T09:00:00Z', value: 30 },
      { time: '2026-10-06T10:00:00Z', value: 75 },
    ],
    departments: [
      { label: 'Grocery', value: 42 },
      { label: 'General merchandise', value: -12 },
    ],
  };
  await api(`/api/data-feeds/${chart.id}/data`, 'PUT', values, issued.token);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/dashboard`);
  await page.getByRole('button', { name: /^Settings/ }).click();
  assert.equal(
    await page
      .locator('[data-sidebar="menu-button"]')
      .filter({ hasText: 'Data feeds' })
      .count(),
    0,
  );
  await page
    .getByRole('heading', { name: 'Data feeds', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'New feed', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Daily total');
  await dialog.getByLabel('Key', { exact: true }).fill('completed');
  await dialog
    .getByRole('button', { name: 'Create feed', exact: true })
    .click();
  await page.getByRole('button', { name: /Daily total.*field/ }).click();
  await dialog
    .getByLabel('Application name', { exact: true })
    .fill('Simple integration');
  await dialog
    .getByRole('button', { name: 'Generate API key', exact: true })
    .click();
  await page.locator('.data-feed-secret code').waitFor();
  const secret = await page.locator('.data-feed-secret code').textContent();
  assert.match(secret, /^ofd_[A-Za-z0-9_-]{43}$/);
  const keyDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', {
      name: 'API key generated',
      exact: true,
    }),
  });
  await keyDialog
    .getByLabel('Update URL')
    .inputValue()
    .then((url) => assert.match(url, /\/api\/data-feeds\/[a-f0-9-]+\/data$/));
  await keyDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.data-feed-secret').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.data-feed-secret').count(), 0);
  assert.equal(
    await page
      .getByRole('heading', { name: 'API key generated', exact: true })
      .count(),
    0,
  );
  await page.keyboard.press('Escape');
  const library = await api('/api/library');
  const simple = library.dataFeeds.find((f) => f.name === 'Daily total');
  // A generated key works from an application without an OpenFrame login cookie.
  const integration = await browser.newContext();
  const sent = await integration.request.put(
    `${base}/api/data-feeds/${simple.id}/data`,
    { headers: { Authorization: `Bearer ${secret}` }, data: { completed: 42 } },
  );
  assert.equal(sent.status(), 200);
  const sessionOnly = await integration.request.get(
    `${base}/api/data-feeds/${simple.id}`,
  );
  assert.equal(sessionOnly.status(), 401);
  await integration.close();
  await api(
    `/api/data-feeds/${simple.id}/data`,
    'PUT',
    { completed: 42 },
    secret,
  );
  await page.getByRole('button', { name: /^Slides/ }).click();
  await page.getByRole('button', { name: 'New slide', exact: true }).click();
  await page.locator('.layer-list button').first().click();
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
  for (const name of ['metric', 'progress bar', 'line graph', 'bar chart']) {
    await page
      .getByRole('button', { name: `Add ${name} widget`, exact: true })
      .click();
    await page.getByLabel('Data feed', { exact: true }).selectOption(chart.id);
    await page
      .getByRole('img')
      .filter({ hasNot: page.locator('never-match') })
      .last()
      .waitFor();
  }
  assert.equal(await page.locator('.slide-canvas svg[role="img"]').count(), 4);
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  const savedLibrary = await api('/api/library');
  const savedSlide = savedLibrary.slides[0];
  assert.equal(savedSlide.layers.filter((l) => l.type === 'data').length, 4);
  await page.keyboard.press('Escape');
  await api(`/api/slides/${savedSlide.id}`, 'PUT', {
    ...savedSlide,
    layers: savedSlide.layers.map((layer, i) => ({
      ...layer,
      x: (i % 2) * 50,
      y: Math.floor(i / 2) * 50,
      width: 50,
      height: 50,
    })),
  });
  const playlist = await api('/api/playlists', 'POST', {
    name: 'Live data',
    items: [{ slideId: savedSlide.id, duration: 3600 }],
  });
  await api(`/api/playlists/${playlist.id}/publish`, 'POST');
  const playback = await context.newPage();
  playback.on('pageerror', (e) => errors.push(e.message));
  await playback.goto(`${base}/player/?preview=${playlist.id}`);
  await playback
    .locator('.slide-frame[aria-hidden="false"] svg[aria-label*="75"]')
    .first()
    .waitFor();
  await playback.evaluate(() => {
    window.activeDataFrame = document.querySelector(
      '.slide-frame[aria-hidden="false"]',
    );
  });
  await api(
    `/api/data-feeds/${chart.id}/data`,
    'PUT',
    { ...values, completed: 88 },
    issued.token,
  );
  await playback
    .locator('.slide-frame[aria-hidden="false"] svg[aria-label="Metric. 88"]')
    .waitFor({ timeout: 20000 });
  assert.equal(
    await playback.evaluate(
      () =>
        window.activeDataFrame ===
        document.querySelector('.slide-frame[aria-hidden="false"]'),
    ),
    true,
  );
  // Staged widgets stay unsubscribed; disposal removes subscriptions and age timers.
  const lifecycle = await playback.evaluate(async () => {
    const { widgets } = await import('/player/widgets.js');
    const { setDataFeedSnapshots } = await import('/player/data-feeds.js');
    const element = document.createElement('div');
    const layer = {
      type: 'data',
      color: '#202923',
      data: {
        feedId: 'test',
        field: 'value',
        mode: 'metric',
        title: 'Lifecycle',
        showUpdated: false,
      },
    };
    setDataFeedSnapshots({ test: { data: { value: 1 } } });
    const controller = widgets.get('data')(element, layer);
    setDataFeedSnapshots({ test: { data: { value: 2 } } });
    const staged = element.textContent;
    controller.activate();
    const active = element.textContent;
    controller.dispose();
    setDataFeedSnapshots({ test: { data: { value: 3 } } });
    return { staged, active, disposed: element.textContent };
  });
  assert.ok(lifecycle.staged.includes('1'));
  assert.ok(lifecycle.active.includes('2'));
  assert.equal(lifecycle.disposed, lifecycle.active);
  const liveManifest = await api(`/api/preview/${playlist.id}`);
  await playback.evaluate(async (data) => {
    const { setDataFeedSnapshots } = await import('/player/data-feeds.js');
    setDataFeedSnapshots(data);
  }, liveManifest.dataFeeds);
  mkdirSync(path.join(root, 'work'), { recursive: true });
  await playback.screenshot({
    path: path.join(root, 'work/data-feeds-player.png'),
  });
  await page.goto(`${base}/dashboard`);
  await page.getByRole('button', { name: /^Settings/ }).click();
  assert.equal(
    await page
      .locator('[data-sidebar="menu-button"]')
      .filter({ hasText: 'Data feeds' })
      .count(),
    0,
  );
  await page
    .getByRole('heading', { name: 'Data feeds', exact: true })
    .waitFor();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    if (width < 700) {
      /* Navigation has already selected the page. */
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page
      .getByRole('button', { name: /Store performance.*fields/ })
      .click();
    assert.equal(
      await dialog.evaluate((e) => e.scrollWidth > e.clientWidth + 1),
      false,
    );
    const request = await dialog
      .locator('.data-feed-code')
      .last()
      .textContent();
    assert.equal(request.split('\n').length, 4);
    assert.match(request, /Authorization: Bearer YOUR_API_KEY/);
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    await page.screenshot({
      path: path.join(root, `work/data-feeds-${width}.png`),
    });
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors, []);
  console.log(
    'Data feed UI, four editor widgets, live player updates, disposal and desktop/mobile layouts passed.',
  );
} finally {
  await browser?.close();
  close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
