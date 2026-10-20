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
const output = path.join(root, 'work/card-thresholds');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-card-thresholds-'));
const { app, db, close } = createApp({ dataDir: dir });
app.get('/threshold-harness', (_req, res) =>
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
    name: 'Threshold fixtures',
    fields: [
      { key: 'value', type: 'number' },
      { key: 'goal', type: 'number' },
      { key: 'history', type: 'series' },
      { key: 'rows', type: 'categories' },
    ],
  });
  const token = await api(`/api/data-feeds/${feed.id}/tokens`, 'POST', {
    name: 'Fixture',
  });
  const values = {
    value: 94,
    goal: 95,
    history: [89, 90, 95].map((value, index) => ({
      value,
      time: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
    })),
    rows: [89, 90, 95].map((value, index) => ({
      label: `Department ${index + 1}`,
      value,
    })),
  };
  const write = (value, goal = 95) =>
    api(
      `/api/data-feeds/${feed.id}/data`,
      'PUT',
      { ...values, value, goal },
      token.token,
    );
  await write(94);
  const slide = await api('/api/slides', 'POST', {
    name: 'Goal colors',
    width: 1920,
    height: 1080,
    layers: ['metric', 'progress', 'line', 'bar'].map((mode, index) => ({
      id: randomUUID(),
      type: 'data',
      x: index * 25,
      y: 10,
      width: 25,
      height: 50,
      data: {
        feedId: feed.id,
        mode,
        field: mode === 'bar' ? 'rows' : mode === 'line' ? 'history' : 'value',
        title: [
          'Metric status',
          'Circle status',
          'Latest status',
          'Row status',
        ][index],
        targetField: mode === 'progress' ? 'goal' : '',
        showUpdated: false,
        card: {
          style: 'split',
          valueAlign: 'center',
          ...(index > 1
            ? {
                thresholdMode: 'higher',
                thresholdGoal: 95,
                thresholdWarning: 90,
              }
            : {}),
        },
      },
    })),
  });
  const page = await context.newPage();
  await page.goto(`${base}/dashboard`);
  await page.getByRole('button', { name: /^Slides/ }).click();
  await page
    .getByRole('button', { name: 'Edit Goal colors', exact: true })
    .click();
  const pick = (name) =>
    page.locator('.layer-list button').filter({ hasText: name }).click();
  const canvas = page.locator('.slide-canvas.editable');
  await pick('Metric status');
  assert.equal(
    await page.getByLabel('Color thresholds', { exact: true }).inputValue(),
    'off',
  );
  await page
    .getByLabel('Color thresholds', { exact: true })
    .selectOption('higher');
  await page.getByLabel('Green goal', { exact: true }).fill('95');
  await page.getByLabel('Yellow threshold', { exact: true }).fill('90');
  assert.equal(
    await canvas.locator('svg').nth(0).getAttribute('data-card-threshold'),
    'yellow',
  );
  await page
    .getByLabel('Color thresholds', { exact: true })
    .selectOption('lower');
  await page.getByLabel('Green goal', { exact: true }).fill('0');
  await page.getByLabel('Yellow threshold', { exact: true }).fill('5');
  assert.equal(
    await canvas.locator('svg').nth(0).getAttribute('data-card-threshold'),
    'red',
  );
  await page
    .getByLabel('Color thresholds', { exact: true })
    .selectOption('higher');
  await page.getByLabel('Green goal', { exact: true }).fill('95');
  await page.getByLabel('Yellow threshold', { exact: true }).fill('90');
  await pick('Circle status');
  assert.doesNotMatch(
    await canvas.locator('svg').nth(1).textContent(),
    /SCORE/,
  );
  await page
    .getByLabel('Color thresholds', { exact: true })
    .selectOption('higher');
  assert.ok(
    await page
      .getByLabel('Use gauge target as green goal', { exact: true })
      .isChecked(),
  );
  await page
    .getByLabel('Use gauge target as green goal', { exact: true })
    .uncheck();
  await page.getByLabel('Green goal', { exact: true }).fill('90');
  assert.equal(
    await canvas.locator('svg').nth(1).getAttribute('data-card-threshold'),
    'green',
  );
  assert.match(
    await canvas.locator('svg').nth(1).getAttribute('aria-label'),
    /Goal: 90/,
  );
  await page
    .getByLabel('Use gauge target as green goal', { exact: true })
    .check();
  assert.equal(
    await canvas.locator('svg').nth(1).getAttribute('data-card-threshold'),
    'yellow',
  );
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  const saved = (await api('/api/library')).slides.find(
    (entry) => entry.id === slide.id,
  );
  assert.equal(saved.layers[0].data.card.thresholdMode, 'higher');
  assert.equal(saved.layers[0].data.card.thresholdGoal, 95);
  assert.equal(saved.layers[0].data.card.thresholdWarning, 90);
  assert.equal(saved.layers[1].data.card.thresholdUseTarget, true);
  await page
    .getByRole('button', { name: 'Back to slides', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit Goal colors', exact: true })
    .click();
  await pick('Metric status');
  assert.equal(
    await page.getByLabel('Color thresholds', { exact: true }).inputValue(),
    'higher',
  );
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page
    .getByLabel('Yellow threshold', { exact: true })
    .scrollIntoViewIfNeeded();
  assert.ok(
    await page
      .locator('.properties-panel')
      .evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1),
  );
  await page.screenshot({ path: path.join(output, 'editor-mobile.png') });

  const playlist = await api('/api/playlists', 'POST', {
    name: 'Threshold publication',
    items: [{ slideId: slide.id, duration: 3600 }],
  });
  await api(`/api/playlists/${playlist.id}/publish`, 'POST');
  const playback = await context.newPage();
  await playback.setViewportSize({ width: 1920, height: 1080 });
  await playback.goto(`${base}/player/?preview=${playlist.id}`);
  const active = playback.locator('.slide-frame[aria-hidden="false"]');
  await active.locator('[data-card-part="gauge-arc"]').waitFor();
  assert.doesNotMatch(
    await active.locator('svg').nth(1).textContent(),
    /SCORE/,
  );
  assert.deepEqual(
    await active
      .locator('[data-card-part="row"]')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-card-threshold')),
      ),
    ['red', 'yellow', 'green'],
  );
  assert.equal(
    await active.locator('svg').nth(2).getAttribute('data-card-threshold'),
    'green',
  );
  await playback.evaluate(() => {
    window.originalFrame = document.querySelector(
      '.slide-frame[aria-hidden="false"]',
    );
  });
  for (const [value, goal, state] of [
    [89, 95, 'red'],
    [90, 95, 'yellow'],
    [95, 95, 'green'],
    [95, 98, 'yellow'],
  ]) {
    await write(value, goal);
    await playback.waitForFunction(
      ({ value, state }) => {
        const frame = document.querySelector(
          '.slide-frame[aria-hidden="false"]',
        );
        const svg = frame?.querySelectorAll('svg')[1];
        return (
          svg
            ?.getAttribute('aria-label')
            .includes(
              `Circle status. ${state === 'green' ? 'Goal met' : state === 'yellow' ? 'Near goal' : 'Below warning level'}`,
            ) &&
          svg
            ?.querySelector('[data-card-part="value"]')
            ?.getAttribute('aria-label') === String(value)
        );
      },
      { value, state },
      { timeout: 25000 },
    );
    assert.equal(
      await active.locator('svg').nth(1).getAttribute('data-card-threshold'),
      state,
    );
    assert.equal(
      await active
        .locator('[data-card-part="gauge-arc"]')
        .getAttribute('stroke'),
      { red: '#B91C1C', yellow: '#FFC220', green: '#166534' }[state],
    );
    assert.equal(
      await active
        .locator('svg')
        .nth(1)
        .locator('[data-card-part="header"]')
        .getAttribute('fill'),
      '#0053E2',
    );
    assert.equal(
      await active
        .locator('svg')
        .nth(1)
        .locator(':scope > rect')
        .last()
        .getAttribute('stroke'),
      'rgba(0,83,226,0.2)',
    );
    assert.ok(
      await playback.evaluate(
        () =>
          window.originalFrame ===
          document.querySelector('.slide-frame[aria-hidden="false"]'),
      ),
    );
  }
  await playback.screenshot({ path: path.join(output, 'player.png') });

  const harness = await context.newPage();
  await harness.goto(`${base}/threshold-harness`);
  const cases = await harness.evaluate(async (baseConfig) => {
    const { renderDataCard } = await import('/player/data-cards.js');
    document.body.style.cssText =
      'background:#f4f6f9;display:grid;grid-template-columns:repeat(3,320px);gap:16px;margin:16px';
    const results = [];
    for (const [value, goal, warning, direction, unavailable] of [
      [89, 95, 90, 'higher'],
      [90, 95, 90, 'higher'],
      [95, 95, 90, 'higher'],
      [0, 0, 5, 'lower'],
      [5, 0, 5, 'lower'],
      [6, 0, 5, 'lower'],
      [99, null, 90, 'higher'],
      [99, 80, 90, 'higher'],
      [99, 95, 90, 'higher', true],
    ]) {
      const host = document.createElement('div');
      host.style.cssText = 'width:320px;height:260px';
      document.body.append(host);
      renderDataCard(
        host,
        {
          ...baseConfig,
          mode: 'progress',
          title: `${direction}: ${value}`,
          field: 'value',
          targetField: 'goal',
          unit: '',
          card: {
            ...baseConfig.card,
            thresholdMode: direction,
            thresholdUseTarget: true,
            thresholdWarning: warning,
          },
        },
        {
          status: unavailable ? 'unavailable' : 'ready',
          data: { value, goal },
        },
      );
      const svg = host.querySelector('svg');
      results.push({
        state: svg.getAttribute('data-card-threshold'),
        text: svg.textContent,
        navy: svg
          .querySelector('[data-card-part="value"] > text')
          ?.getAttribute('fill'),
        titleColor: svg
          .querySelector('[data-card-part="title"]')
          .getAttribute('fill'),
      });
    }
    return results;
  }, saved.layers[1].data);
  assert.deepEqual(
    cases.map((entry) => entry.state),
    [
      'red',
      'yellow',
      'green',
      'green',
      'yellow',
      'red',
      'unknown',
      'unknown',
      'none',
    ],
  );
  assert.ok(cases.every((entry) => !entry.text.includes('SCORE')));
  assert.ok(cases.every((entry) => entry.titleColor === '#FFFFFF'));
  assert.equal(cases[0].navy, '#001E60');
  assert.match(cases[6].text, /Goal unavailable/);
  assert.match(cases[7].text, /Check color thresholds/);
  await harness.setViewportSize({ width: 1032, height: 850 });
  await harness.screenshot({
    path: path.join(output, 'thresholds.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    `Goal colors passed: controls, saved/reopened settings, mobile, published live transitions, row thresholds, missing/invalid goals, and score-free circles. Screenshots: ${output}`,
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
