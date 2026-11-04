import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createApp } from '../server/app.mjs';

// All deletes and resets in this test target a disposable local installation.
delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const directory = mkdtempSync(
  path.join(os.tmpdir(), 'openframe-feed-reset-browser-'),
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
    ...(process.env.OPENFRAME_BROWSER_EXECUTABLE
      ? { executablePath: process.env.OPENFRAME_BROWSER_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const api = async (route, method = 'GET', data) => {
    const response = await context.request.fetch(base + route, {
      method,
      data,
    });
    assert.ok(
      response.ok(),
      `${route}: ${response.status()} ${await response.text()}`,
    );
    return response.json();
  };
  await api('/api/setup', 'POST', { password: 'reset-browser-password' });
  const site = await api('/api/sites', 'POST', {
    siteNumber: '3404',
    name: 'Reset browser store',
  });
  async function application(name, value) {
    const app = await api('/api/data-feeds/applications', 'POST', { name });
    const key = await api(
      `/api/data-feeds/applications/${app.id}/tokens`,
      'POST',
      { name: 'Integration', siteId: site.id },
    );
    const response = await context.request.post(
      base + '/api/data-feeds/ingest/production',
      {
        headers: { Authorization: `Bearer ${key.token}` },
        data: {
          completed: value,
          goal: 100,
          rows: [
            { label: 'One', value: 1 },
            { label: 'Two', value: 2 },
            { label: 'Three', value: 3 },
          ],
        },
      },
    );
    assert.equal(response.status(), 201);
    return { app, feed: await response.json() };
  }
  const old = await application('Old metrics', 75);
  const manual = await api('/api/data-feeds', 'POST', {
    name: 'Manual backup',
    siteId: site.id,
    fields: [{ key: 'completed', type: 'number' }],
  });
  const layer = (title, x, mode, field) => ({
    id: randomUUID(),
    type: 'data',
    x,
    y: 10,
    width: 30,
    height: 70,
    color: '#123456',
    data: {
      mode,
      feedId: old.feed.feedId,
      field,
      title,
      siteBinding: { applicationId: old.app.id, sourceKey: 'production' },
      targetField: 'goal',
      card: {
        style: 'split',
        badge: 'delta',
        deltaField: 'goal',
        rows: 'table',
        rowDeltaField: 'rows',
        rowOffset: 1,
        maxRows: 2,
        footer: 'Keep this footer',
        paddingX: 24,
        titleScale: 120,
      },
    },
  });
  const metric = layer('Keep this metric', 2, 'metric', 'completed');
  const table = layer('Keep this table', 35, 'bar', 'rows');
  const manualLayer = {
    ...layer('Keep manual widget', 68, 'metric', 'completed'),
    data: {
      mode: 'metric',
      feedId: manual.id,
      field: 'completed',
      title: 'Keep manual widget',
    },
  };
  const slide = await api('/api/slides', 'POST', {
    name: 'Reconnectable layout',
    width: 1920,
    height: 1080,
    layers: [metric, table, manualLayer],
  });
  const playlist = await api('/api/playlists', 'POST', {
    name: 'Reconnectable playlist',
    items: [{ slideId: slide.id, duration: 3600 }],
  });
  await api(`/api/playlists/${playlist.id}/publish`, 'POST');
  const preview = await context.newPage();
  await preview.clock.install();
  await preview.goto(
    `${base}/player/?preview=${playlist.id}&siteId=${site.id}`,
  );
  const visible = preview.locator('.slide-frame[aria-hidden="false"]');
  await visible.getByText('75', { exact: true }).waitFor();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  preview.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(base + '/dashboard/settings');
  await page.locator('.data-feed-application-list summary').click();
  await page
    .getByRole('button', {
      name: 'Manage application keys for Old metrics',
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete application', exact: true })
    .click();
  const confirmation = page.getByRole('alertdialog');
  await confirmation.getByText(/Keep every widget/).waitFor();
  await confirmation
    .getByRole('button', { name: 'Delete application', exact: true })
    .click();
  await confirmation.waitFor({ state: 'hidden' });
  await page
    .getByText('Old metrics · production', { exact: true })
    .waitFor({ state: 'hidden' });
  let saved = (await api('/api/library')).slides.find((s) => s.id === slide.id);
  assert.equal(saved.layers.length, 3);
  assert.equal(saved.layers[0].data.feedId, null);
  assert.equal(saved.layers[1].data.feedId, null);
  assert.equal(saved.layers[2].data.feedId, manual.id);
  await preview.clock.fastForward(16000);
  await visible
    .getByText('Waiting for data', { exact: true })
    .first()
    .waitFor();
  assert.equal(await visible.getByText('75', { exact: true }).count(), 0);
  await page
    .locator('.data-feed-open')
    .filter({ hasText: 'Manual backup' })
    .click();
  const detail = page.getByRole('dialog');
  await detail
    .getByRole('button', { name: 'Delete feed', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Delete feed', exact: true })
    .click();
  await detail.waitFor({ state: 'hidden' });
  assert.deepEqual((await api('/api/library')).dataFeeds, []);
  const replacement = await application('Replacement metrics', 88);
  await page.goto(base + '/dashboard/slides');
  await page
    .getByRole('button', { name: 'Edit Reconnectable layout', exact: true })
    .click();
  for (const title of ['Keep this metric', 'Keep this table']) {
    await page.locator('.layer-list button').filter({ hasText: title }).click();
    await page
      .getByText('This widget is disconnected.', { exact: false })
      .waitFor();
    await page
      .getByLabel('Data feed', { exact: true })
      .selectOption({ label: 'Replacement metrics · production' });
  }
  await page
    .getByRole('button', { name: 'Save and update screens', exact: true })
    .click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  saved = (await api('/api/library')).slides.find((s) => s.id === slide.id);
  for (let i = 0; i < 2; i++) {
    assert.equal(saved.layers[i].id, slide.layers[i].id);
    assert.equal(saved.layers[i].x, slide.layers[i].x);
    assert.equal(saved.layers[i].width, slide.layers[i].width);
    assert.equal(saved.layers[i].data.feedId, replacement.feed.feedId);
    assert.equal(saved.layers[i].data.targetField, 'goal');
    assert.equal(saved.layers[i].data.card.deltaField, 'goal');
    assert.equal(saved.layers[i].data.card.footer, 'Keep this footer');
    assert.equal(saved.layers[i].data.card.rowOffset, 1);
  }
  assert.equal(saved.layers[1].data.field, 'rows');
  assert.equal(saved.layers[1].data.card.rowDeltaField, 'rows');
  await preview.clock.fastForward(16000);
  await visible.getByText('88', { exact: true }).waitFor();
  await api('/api/data-feeds', 'POST', {
    name: 'Spare feed',
    siteId: site.id,
    fields: [{ key: 'value', type: 'number' }],
  });
  await page.goto(base + '/dashboard/settings');
  await page
    .getByRole('button', { name: 'Reset all data connections', exact: true })
    .click();
  await confirmation.getByText(/1 applications · 2 feeds/).waitFor();
  assert.ok(
    await confirmation
      .getByRole('button', {
        name: 'Delete connections and keep widgets',
        exact: true,
      })
      .isDisabled(),
  );
  await api('/api/data-feeds/applications', 'POST', {
    name: 'Changed after review',
  });
  await confirmation
    .getByLabel('Type RESET to confirm', { exact: true })
    .fill('RESET');
  await confirmation
    .getByRole('button', {
      name: 'Delete connections and keep widgets',
      exact: true,
    })
    .click();
  await confirmation
    .getByRole('alert')
    .getByText(/Connections or widgets changed/)
    .waitFor();
  await confirmation
    .getByRole('button', { name: 'Review reset again', exact: true })
    .click();
  await confirmation.getByText(/2 applications · 2 feeds/).waitFor();
  assert.equal(
    await confirmation
      .getByLabel('Type RESET to confirm', { exact: true })
      .inputValue(),
    '',
  );
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  assert.equal((await api('/api/library')).dataFeeds.length, 2);
  await page
    .getByRole('button', { name: 'Reset all data connections', exact: true })
    .click();
  await confirmation.getByText(/2 applications · 2 feeds/).waitFor();
  await page.setViewportSize({ width: 390, height: 900 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await confirmation
    .getByLabel('Type RESET to confirm', { exact: true })
    .fill('RESET');
  await confirmation
    .getByRole('button', {
      name: 'Delete connections and keep widgets',
      exact: true,
    })
    .click();
  await confirmation.waitFor({ state: 'hidden' });
  await page.getByText('Connect your data', { exact: true }).waitFor();
  const final = await api('/api/library');
  assert.deepEqual(final.dataFeeds, []);
  assert.deepEqual(await api('/api/data-feeds/applications'), []);
  assert.equal(final.sites[0].id, site.id);
  assert.equal(final.playlists[0].id, playlist.id);
  const finalSlide = final.slides.find((s) => s.id === slide.id);
  for (let i = 0; i < 3; i++) {
    const { siteBinding: _binding, ...settings } = saved.layers[i].data;
    assert.deepEqual(finalSlide.layers[i], {
      ...saved.layers[i],
      data: { ...settings, feedId: null },
    });
  }
  await preview.clock.fastForward(16000);
  await visible
    .getByText('Waiting for data', { exact: true })
    .first()
    .waitFor();
  assert.equal(await visible.getByText('88', { exact: true }).count(), 0);
  assert.ok((await preview.locator('.slide-frame').count()) <= 2);
  mkdirSync('work', { recursive: true });
  await page.screenshot({ path: 'work/data-connections-reset-mobile.png' });
  await preview.screenshot({ path: 'work/data-connections-reset-player.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Application/feed deletion, preserved widget layouts and settings, live cached-value clearing, reconnecting replacement feeds, full reset review/cancel, mobile layout and two-frame bound passed.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
}
