import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'work/card-layout');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-card-layout-'));
const { app, db, close } = createApp({ dataDir: dir });
app.get('/layout-harness', (_req, res) =>
  res.type('html').send('<!doctype html><html><body></body></html>'),
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
    ...(process.env.OPENFRAME_BROWSER_EXECUTABLE
      ? { executablePath: process.env.OPENFRAME_BROWSER_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  context.on('page', (page) => {
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
  });
  async function api(route, method = 'GET', data, token) {
    const response = await context.request.fetch(base + route, {
      method,
      data,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
    const body = await response.json();
    assert.ok(
      response.ok(),
      `${route}: ${response.status()} ${JSON.stringify(body)}`,
    );
    return body;
  }
  await api('/api/setup', 'POST', { password: 'card-layout-fixture-password' });
  const feed = await api('/api/data-feeds', 'POST', {
    name: 'Layout fixtures',
    fields: [{ key: 'count', type: 'number' }],
  });
  const token = await api(`/api/data-feeds/${feed.id}/tokens`, 'POST', {
    name: 'Fixture',
  });
  await api(
    `/api/data-feeds/${feed.id}/data`,
    'PUT',
    { count: 2534 },
    token.token,
  );
  const slide = await api('/api/slides', 'POST', {
    name: 'Layout controls',
    width: 1920,
    height: 1080,
    layers: [
      { x: 5, y: 5 },
      { x: 32, y: 15 },
      { x: 70, y: 10 },
      { x: 5, y: 70, lockMode: 'movement' },
    ].map((geometry, i) => ({
      id: randomUUID(),
      type: 'data',
      width: 20,
      height: 25,
      ...geometry,
      data: {
        mode: 'metric',
        feedId: feed.id,
        field: 'count',
        title: `Card ${String.fromCharCode(65 + i)}`,
        showUpdated: false,
        card: { style: 'split' },
      },
    })),
  });
  const page = await context.newPage();
  await page.goto(`${base}/dashboard`);
  await page.getByRole('button', { name: /^Slides/ }).click();
  await page
    .getByRole('button', { name: 'Edit Layout controls', exact: true })
    .click();
  await page
    .locator('.layer-list button')
    .filter({ hasText: 'Card A' })
    .click();
  const first = page.locator('.slide-canvas.editable .slide-layer').nth(0);
  const value = first.locator('[data-card-part="value"] > text');
  await value.waitFor();
  await page.getByText('Text size and alignment', { exact: true }).click();
  await page.getByText('Card padding', { exact: true }).click();
  const originalSize = Number(await value.getAttribute('font-size'));
  await page
    .getByLabel('Value alignment', { exact: true })
    .selectOption('center');
  await page.getByLabel('Value text size (%)', { exact: true }).fill('140');
  await page.getByLabel('Header text size (%)', { exact: true }).fill('125');
  await page.getByLabel('Detail text size (%)', { exact: true }).fill('120');
  await page.getByLabel('Horizontal body padding', { exact: true }).fill('24');
  await page.getByLabel('Vertical body padding', { exact: true }).fill('10');
  assert.equal(await value.getAttribute('text-anchor'), 'middle');
  assert.ok(Number(await value.getAttribute('font-size')) > originalSize);
  const editorAppearance = await first.locator('svg').evaluate((svg) => ({
    width: svg.viewBox.baseVal.width,
    valueX: Number(
      svg.querySelector('[data-card-part="value"] > text').getAttribute('x'),
    ),
    titleSize: Number(
      svg.querySelector('[data-card-part="title"]').getAttribute('font-size'),
    ),
    paddingTop:
      Number(
        svg.querySelector('defs clipPath:last-of-type rect').getAttribute('y'),
      ) -
      Number(
        svg.querySelector('[data-card-part="header"]').getAttribute('height'),
      ),
  }));
  assert.ok(
    Math.abs(editorAppearance.valueX - editorAppearance.width / 2) < 0.0001,
  );
  assert.equal(editorAppearance.titleSize, 15);
  assert.equal(editorAppearance.paddingTop, 10);
  // Right and left use the selected inset, while center remains card-centered.
  for (const [alignment, anchor] of [
    ['right', 'end'],
    ['left', 'start'],
    ['center', 'middle'],
  ]) {
    await page
      .getByLabel('Value alignment', { exact: true })
      .selectOption(alignment);
    assert.equal(await value.getAttribute('text-anchor'), anchor);
    if (alignment === 'left')
      assert.equal(Number(await value.getAttribute('x')), 24);
  }
  const canvasLayers = page.locator('.slide-canvas.editable .slide-layer');
  await canvasLayers.nth(1).click({ modifiers: ['Control'] });
  assert.equal(await page.locator('.slide-layer.selected').count(), 2);
  await first.click({ modifiers: ['Control'] });
  assert.equal(await page.locator('.slide-layer.selected').count(), 1);
  await first.click({ modifiers: ['Control'] });
  await canvasLayers.nth(1).click({ modifiers: ['Meta'] });
  assert.equal(await page.locator('.slide-layer.selected').count(), 1);
  await page
    .locator('.layer-list button')
    .filter({ hasText: 'Card B' })
    .click({ modifiers: ['Control'] });
  assert.equal(await page.locator('.slide-layer.selected').count(), 2);

  await page
    .getByRole('button', { name: 'Select all cards', exact: true })
    .click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Unlock the selected' })
    .waitFor();
  assert.ok(
    await page
      .getByRole('button', { name: 'Align top', exact: true })
      .isDisabled(),
  );
  await page
    .getByLabel('Select layer 4 for arrangement', { exact: true })
    .uncheck();
  assert.equal(
    await page.locator('.slide-canvas.editable .slide-layer.selected').count(),
    3,
  );
  assert.equal(
    await page.locator('.slide-canvas.editable .resize-handle').count(),
    0,
  );
  await page.getByRole('button', { name: 'Align top', exact: true }).click();
  await page
    .getByRole('button', { name: 'Space evenly horizontally', exact: true })
    .click();
  const geometry = () =>
    page.locator('.slide-canvas.editable .slide-layer').evaluateAll((layers) =>
      layers.map((layer) => ({
        x: parseFloat(layer.style.left),
        y: parseFloat(layer.style.top),
      })),
    );
  assert.deepEqual(await geometry(), [
    { x: 5, y: 5 },
    { x: 37.5, y: 5 },
    { x: 70, y: 5 },
    { x: 5, y: 70 },
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await geometry())[1].x, 32);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await geometry())[1].y, 15);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  // Canvas selection toggles exactly once per click and never drags in arrange mode.
  await first.click();
  assert.equal(
    await page.locator('.slide-canvas.editable .slide-layer.selected').count(),
    2,
  );
  await first.click();
  assert.equal(
    await page.locator('.slide-canvas.editable .slide-layer.selected').count(),
    3,
  );
  await page
    .getByRole('button', { name: 'Done arranging', exact: true })
    .click();
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  const saved = (await api('/api/library')).slides.find(
    (entry) => entry.id === slide.id,
  );
  const appearance = saved.layers[0].data.card;
  assert.deepEqual(
    [
      appearance.valueAlign,
      appearance.titleScale,
      appearance.valueScale,
      appearance.detailScale,
      appearance.paddingX,
      appearance.paddingY,
    ],
    ['center', 125, 140, 120, 24, 10],
  );
  assert.equal(saved.layers[1].x, 37.5);
  await page
    .getByRole('button', { name: 'Back to slides', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit Layout controls', exact: true })
    .click();
  await page
    .locator('.layer-list button')
    .filter({ hasText: 'Card A' })
    .click();
  assert.equal(
    await page.getByLabel('Value alignment', { exact: true }).inputValue(),
    'center',
  );
  assert.equal(
    await page.getByLabel('Value text size (%)', { exact: true }).inputValue(),
    '140',
  );
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  const paddingSection = page.locator('.widget-property-section').filter({
    has: page.locator('summary', { hasText: /^Card padding$/ }),
  });
  if (!(await paddingSection.evaluate((section) => section.open))) {
    await paddingSection.locator('summary').click();
  }
  await page
    .getByLabel('Horizontal body padding', { exact: true })
    .scrollIntoViewIfNeeded();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page
    .getByRole('button', { name: 'Arrange layers', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Select all cards', exact: true })
    .click();
  await page
    .getByLabel('Select layer 4 for arrangement', { exact: true })
    .uncheck();
  assert.ok(
    await page
      .locator('.layer-panel')
      .evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1),
  );
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page
    .getByRole('button', { name: 'Align top', exact: true })
    .scrollIntoViewIfNeeded();
  assert.ok(
    await page
      .locator('.properties-panel')
      .evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1),
  );
  await page.screenshot({ path: path.join(output, 'arrange-mobile.png') });
  const playlist = await api('/api/playlists', 'POST', {
    name: 'Layout preview',
    items: [{ slideId: slide.id, duration: 3600 }],
  });
  await api(`/api/playlists/${playlist.id}/publish`, 'POST');
  const playback = await context.newPage();
  await playback.setViewportSize({ width: 1920, height: 1080 });
  await playback.goto(`${base}/player/?preview=${playlist.id}`);
  const liveValue = playback
    .locator(
      '.slide-frame[aria-hidden="false"] [data-card-part="value"] > text',
    )
    .first();
  await liveValue.waitFor();
  assert.equal(await liveValue.getAttribute('text-anchor'), 'middle');
  assert.equal(
    Number(await liveValue.getAttribute('font-size')),
    Number(await value.getAttribute('font-size')),
  );
  // Sweep permitted typography/padding extremes across all card modes. SVG must
  // stay finite and bounded without introducing requests or new timers.
  const harness = await context.newPage();
  await harness.goto(`${base}/layout-harness`);
  const invalid = await harness.evaluate(async (baseConfig) => {
    const { renderDataCard } = await import('/player/data-cards.js');
    document.body.style.cssText =
      'margin:16px;background:#f4f6f9;display:grid;grid-template-columns:repeat(4,320px);gap:16px';
    const failures = [];
    for (const mode of ['metric', 'progress', 'line', 'bar']) {
      for (const large of [false, true]) {
        for (const inset of [0, 48]) {
          const host = document.createElement('div');
          host.style.cssText = 'width:320px;height:260px';
          document.body.append(host);
          const data =
            mode === 'line'
              ? [2, 8, -3, 12].map((value, i) => ({
                  time: new Date(Date.UTC(2026, 9, i + 1)).toISOString(),
                  value,
                }))
              : mode === 'bar'
                ? Array.from({ length: 4 }, (_, i) => ({
                    label: `Department ${i + 1}`,
                    value: i * 12.5,
                  }))
                : mode === 'progress'
                  ? 40.1
                  : 2534;
          renderDataCard(
            host,
            {
              ...baseConfig,
              title: `${mode} ${large ? '200%' : '50%'} / ${inset}px`,
              mode,
              unit: mode === 'progress' ? '%' : '',
              showUpdated: true,
              card: {
                ...baseConfig.card,
                titleScale: large ? 200 : 50,
                valueScale: large ? 200 : 50,
                detailScale: large ? 200 : 50,
                paddingX: inset,
                paddingY: inset,
                subtitle: 'Performance',
                footer: 'Updated data',
                footerRight: 'Context',
                showStats: true,
              },
            },
            {
              status: 'ready',
              updatedAt: new Date().toISOString(),
              data: { count: data },
            },
          );
          for (const node of host.querySelectorAll('*'))
            for (const { name, value } of node.attributes) {
              if (
                /NaN|Infinity/.test(value) ||
                (['width', 'height', 'r', 'rx', 'font-size'].includes(name) &&
                  Number(value) < 0)
              )
                failures.push(`${mode}: ${name}=${value}`);
            }
          const svg = host.querySelector('svg'),
            box = svg.viewBox.baseVal;
          const text = host.querySelector('[data-card-part="value"] > text');
          if (mode === 'line') {
            const heading = host
              .querySelector('[data-card-part="subtitle"]')
              .getBBox();
            const plot = host
              .querySelector('[data-card-part="sparkline"]')
              .getBBox();
            if (heading.y + heading.height > plot.y + 1)
              failures.push(`${mode}: supporting text overlaps plot`);
          }
          if (text) {
            const bounds = text.getBBox();
            if (bounds.x < -1 || bounds.x + bounds.width > box.width + 1)
              failures.push(`${mode}: value escapes card`);
          }
        }
      }
    }
    return failures;
  }, saved.layers[0].data);
  assert.deepEqual(invalid, []);
  await harness.setViewportSize({ width: 1376, height: 1120 });
  await harness.screenshot({
    path: path.join(output, 'sizes-padding.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    `Card layout: saved typography/padding, published playback, multi-selection, locks, alignment, equal gaps, undo/redo, mobile and bounded extremes pass. Screenshots: ${output}`,
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
