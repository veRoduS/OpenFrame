import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'work/data-tables');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-smcc-tables-'));
const { app, db, close } = createApp({ dataDir: dir });
app.get('/table-harness', (_req, res) =>
  res
    .type('html')
    .send(
      '<!doctype html><html><head><title>Table fixture</title></head><body></body></html>',
    ),
);
app.use('/player', express.static(path.join(root, 'player/web')));
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (_req, res) =>
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
    executablePath:
      process.env.OPENFRAME_BROWSER_EXECUTABLE || '/usr/bin/chromium',
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  context.on('page', (page) => {
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
  });
  const external = await browser.newContext();
  async function api(route, method = 'GET', data) {
    const response = await context.request.fetch(base + route, {
      method,
      data,
    });
    const body = await response.json();
    assert.ok(
      response.ok(),
      `${route}: ${response.status()} ${JSON.stringify(body)}`,
    );
    return body;
  }
  await api('/api/setup', 'POST', { password: 'smcc-table-fixture-password' });
  const application = await api('/api/data-feeds/applications', 'POST', {
    name: 'SMCC fixture',
  });
  const key = await api(
    `/api/data-feeds/applications/${application.id}/tokens`,
    'POST',
    { name: 'Synthetic table sender' },
  );
  async function ingest(source, data) {
    const response = await external.request.post(
      `${base}/api/data-feeds/ingest/${source}`,
      {
        headers: { Authorization: `Bearer ${key.token}` },
        data,
      },
    );
    assert.ok(response.ok(), await response.text());
    return response.json();
  }
  const metricFeed = await ingest('production', { freight: 7 });
  const rows = Array.from({ length: 40 }, (_, index) => ({
    label: `Metric ${String(index + 1).padStart(2, '0')}`,
    value: index + 1.5,
  }));
  const tableFeed = await ingest('production-tables', { freight: rows });
  assert.deepEqual(tableFeed.fields, [{ key: 'freight', type: 'categories' }]);
  assert.notEqual(metricFeed.feedId, tableFeed.feedId);
  const page = await context.newPage();
  await page.goto(`${base}/dashboard`);
  await page.getByRole('button', { name: /^Slides/ }).click();
  await page.getByRole('button', { name: 'New slide', exact: true }).click();
  await page
    .getByLabel('Slide name', { exact: true })
    .fill('SMCC table display');
  await page.locator('.layer-list button').first().click();
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add table widget', exact: true })
    .click();
  assert.ok(
    await page
      .getByRole('radio', { name: 'Split header', exact: true })
      .isChecked(),
  );
  await page
    .getByLabel('Data feed', { exact: true })
    .selectOption(tableFeed.feedId);
  await page.getByLabel('Value field', { exact: true }).selectOption('freight');
  await page.getByLabel('Title', { exact: true }).fill('SMCC metric table');
  await page.getByLabel('Decimal places', { exact: true }).fill('1');
  await page.getByLabel('First row', { exact: true }).fill('21');
  await page.getByLabel('Visible rows', { exact: true }).fill('20');
  await page.getByText('Footer and freshness', { exact: true }).click();
  await page.getByLabel('Show update time', { exact: true }).uncheck();
  await page
    .locator('.slide-canvas.editable [data-card-part="row"]')
    .nth(19)
    .waitFor();
  assert.equal(
    await page
      .locator('.slide-canvas.editable [data-card-part="row-label"]')
      .first()
      .textContent(),
    'Metric 21',
  );
  assert.match(
    await page.locator('.slide-canvas.editable').textContent(),
    /Rows 21–40 of 40/,
  );
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  const slide = (await api('/api/library')).slides.find(
    (entry) => entry.name === 'SMCC table display',
  );
  const config = slide.layers[0].data;
  assert.equal(config.mode, 'bar');
  assert.equal(config.card.rows, 'table');
  assert.equal(config.card.rowOffset, 20);
  assert.equal(config.card.maxRows, 20);
  await page
    .getByRole('button', { name: 'Back to slides', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit SMCC table display', exact: true })
    .click();
  await page.locator('.layer-list button').first().click();
  assert.equal(
    await page.getByLabel('First row', { exact: true }).inputValue(),
    '21',
  );
  assert.equal(
    await page.getByLabel('Visible rows', { exact: true }).inputValue(),
    '20',
  );
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page.getByLabel('First row', { exact: true }).scrollIntoViewIfNeeded();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.ok(
    await page
      .locator('.properties-panel')
      .evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1),
  );
  await page.screenshot({ path: path.join(output, 'editor-mobile.png') });

  const playlist = await api('/api/playlists', 'POST', {
    name: 'SMCC table player',
    items: [{ slideId: slide.id, duration: 3600 }],
  });
  await api(`/api/playlists/${playlist.id}/publish`, 'POST');
  assert.equal((await api(`/api/preview/${playlist.id}`)).schemaVersion, 4);
  const playback = await context.newPage();
  await playback.setViewportSize({ width: 1920, height: 1080 });
  await playback.goto(`${base}/player/?preview=${playlist.id}`);
  const active = '.slide-frame[aria-hidden="false"]';
  await playback.locator(`${active} [data-card-part="row"]`).nth(19).waitFor();
  assert.equal(
    await playback
      .locator(`${active} [data-card-part="row-label"]`)
      .first()
      .textContent(),
    'Metric 21',
  );
  assert.equal(
    await playback
      .locator(`${active} [data-card-part="row-label"]`)
      .last()
      .textContent(),
    'Metric 40',
  );
  await playback.screenshot({ path: path.join(output, 'player.png') });
  await playback.evaluate(() => {
    window.tableFrame = document.querySelector(
      '.slide-frame[aria-hidden="false"]',
    );
  });
  await ingest('production-tables', {
    freight: rows.map((row) => ({ ...row, value: row.value + 100 })),
  });
  await playback.waitForFunction(
    () =>
      document.querySelector(
        '.slide-frame[aria-hidden="false"] [data-card-part="row-value"]',
      )?.textContent === '121.5',
    undefined,
    { timeout: 22000 },
  );
  assert.ok(
    await playback.evaluate(
      () =>
        window.tableFrame ===
        document.querySelector('.slide-frame[aria-hidden="false"]'),
    ),
  );
  assert.deepEqual(
    (await api(`/api/data-feeds/${metricFeed.feedId}/data`)).data,
    { freight: 7 },
  );

  // A full 40-row view remains bounded and fits a tall sign. No paging timer is needed.
  const full = await context.newPage();
  await full.setViewportSize({ width: 640, height: 1080 });
  await full.goto(`${base}/table-harness`);
  const geometry = await full.evaluate(
    async ({ config, rows }) => {
      const { renderDataWidget } = await import('/player/data-feeds.js');
      Object.assign(document.body.style, {
        margin: '20px',
        background: '#f4f6f9',
      });
      const host = document.createElement('div');
      Object.assign(host.style, { width: '600px', height: '1040px' });
      document.body.append(host);
      renderDataWidget(
        host,
        { ...config, card: { ...config.card, rowOffset: 0, maxRows: 40 } },
        { status: 'ready', data: { freight: rows } },
      );
      const svg = host.querySelector('svg');
      const bounds = svg.getBoundingClientRect();
      return {
        rows: host.querySelectorAll('[data-card-part="row"]').length,
        nodes: host.querySelectorAll('*').length,
        invalid: /NaN|Infinity/.test(svg.innerHTML),
        outside: [...svg.querySelectorAll('text')]
          .filter((text) => {
            const box = text.getBoundingClientRect();
            return (
              box.left < bounds.left - 1 ||
              box.right > bounds.right + 1 ||
              box.top < bounds.top - 1 ||
              box.bottom > bounds.bottom + 1
            );
          })
          .map((text) => text.textContent),
      };
    },
    { config, rows },
  );
  assert.equal(geometry.rows, 40);
  assert.ok(geometry.nodes < 250);
  assert.equal(geometry.invalid, false);
  assert.deepEqual(geometry.outside, []);
  await full.screenshot({ path: path.join(output, 'forty-rows.png') });

  await ingest('production-tables', { freight: rows.slice(0, 3) });
  await playback.waitForFunction(
    () =>
      document.querySelector(
        '.slide-frame[aria-hidden="false"] [data-card-part="status"]',
      )?.textContent === 'No rows in this range',
    undefined,
    { timeout: 22000 },
  );
  assert.equal(
    await playback.locator(`${active} [data-card-part="row"]`).count(),
    0,
  );
  assert.match(
    await playback.locator(active).textContent(),
    /Adjust First row/,
  );
  assert.deepEqual(errors, []);
  console.log(
    'SMCC tables passed: application-key ingestion, separate metrics/tables sources, Table preset, saved row ranges, 320px controls, 40-row fitting, live refresh and shrinking snapshots.',
  );
} finally {
  await browser?.close();
  close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
