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
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-widgets-browser-'));
const instance = createApp({
  dataDir: dir,
  stockFetch: async () =>
    Response.json({ c: 105, pc: 100, t: Math.floor(Date.now() / 1000) }),
});
instance.app.use('/player', express.static(path.join(root, 'player/web')));
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function api(url, method = 'GET', data) {
    const response = await context.request.fetch(base + url, { method, data });
    assert.ok(
      response.ok(),
      `${method} ${url}: ${response.status()} ${await response.text()}`,
    );
    return response.json();
  }
  await api('/api/setup', 'POST', { password: 'browser8' });
  const seeded = await api('/api/slides', 'POST', {
    name: 'Widget checks',
    width: 1920,
    height: 1080,
    background: '#ffffff',
    layers: [],
  });
  const hour = Math.floor(Date.now() / 3600000) * 3600000;
  const weather = {
    status: 'ready',
    fetchedAt: new Date().toISOString(),
    timeZone: 'America/New_York',
    observationStatus: 'ready',
    observation: {
      timestamp: new Date().toISOString(),
      temperatureF: 72,
      shortForecast: 'Partly Sunny',
    },
    periods: Array.from({ length: 8 }, (_, i) => ({
      startTime: new Date(hour + i * 3600000).toISOString(),
      endTime: new Date(hour + (i + 1) * 3600000).toISOString(),
      temperatureF: 70 + i,
      shortForecast: ['Sunny', 'Cloudy', 'Rain'][i % 3],
      isDaytime: true,
    })),
  };
  await page.route('**/api/weather?*', (route) =>
    route.fulfill({ json: weather }),
  );
  await page.goto(base + '/dashboard');
  await page
    .getByRole('button', { name: 'Edit Widget checks', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add rectangle', exact: true })
    .click();
  await page.getByLabel('Corner radius', { exact: true }).fill('32');
  await page.getByLabel('Outline width', { exact: true }).fill('8');
  await page.getByLabel('Fill color', { exact: true }).fill('#17613d');
  await page.getByLabel('Layer width', { exact: true }).fill('35');
  await page.getByLabel('Layer height', { exact: true }).fill('25');
  assert.equal(
    await page
      .locator('.canvas-holder [data-shape="rectangle"] rect')
      .getAttribute('rx'),
    '32',
  );
  await page.getByRole('button', { name: 'Add circle', exact: true }).click();
  assert.equal(
    await page.locator('.canvas-holder [data-shape="circle"] circle').count(),
    1,
  );
  await page
    .getByRole('button', { name: 'Add weather widget', exact: true })
    .click();
  await page.getByLabel('Latitude', { exact: true }).fill('41.8781');
  await page.getByLabel('Longitude', { exact: true }).fill('-87.6298');
  await page
    .getByRole('button', { name: 'Fit right sidebar', exact: true })
    .click();
  await page
    .getByLabel('Weather display', { exact: true })
    .selectOption('six-hour');
  await page
    .locator('.canvas-holder [data-weather-layout="vertical"]')
    .getByText('National Weather Service')
    .waitFor();
  async function fits(selector) {
    return page
      .locator(selector)
      .evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth + 1 &&
          element.scrollHeight <= element.clientHeight + 1,
      );
  }
  assert.ok(await fits('.canvas-holder [aria-label="Select weather layer"]'));
  await page.getByLabel('Layer height', { exact: true }).fill('45');
  assert.ok(await fits('.canvas-holder [aria-label="Select weather layer"]'));
  await page.getByLabel('Layer height', { exact: true }).fill('80');
  await page
    .getByRole('button', { name: 'Add stock tracker', exact: true })
    .click();
  await page.getByLabel('Layer x', { exact: true }).fill('55');
  await page.getByLabel('Stock symbols', { exact: true }).fill('WMT, AAPL');
  await page.getByLabel('Tracker title', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Save slide', exact: true })
    .first()
    .click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  const slide = (await api('/api/library')).slides.find(
    (s) => s.id === seeded.id,
  );
  assert.equal(
    slide.layers.find((layer) => layer.type === 'shape').shape.cornerRadius,
    32,
  );
  assert.equal(
    slide.layers.find((layer) => layer.type === 'weather').weather.layout,
    'vertical',
  );
  assert.deepEqual(
    slide.layers.find((layer) => layer.type === 'stocks').stocks.symbols,
    ['WMT', 'AAPL'],
  );
  await page
    .getByRole('button', { name: 'Back to slides', exact: true })
    .click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByLabel('Finnhub API key', { exact: true })
    .fill('fake-browser-token');
  await page
    .getByRole('button', { name: 'Connect stock quotes', exact: true })
    .click();
  await page.getByText(/Stock quotes configured/).waitFor();
  assert.equal(
    await page.getByLabel('Finnhub API key', { exact: true }).inputValue(),
    '',
  );
  await api('/api/stocks?symbols=WMT,AAPL');
  const playlist = await api('/api/playlists', 'POST', {
    name: 'Widget preview',
    items: [{ slideId: slide.id, duration: 60 }],
  });
  await api(`/api/playlists/${playlist.id}/publish`, 'POST');
  const manifest = await api(`/api/preview/${playlist.id}`);
  manifest.weather = { '41.8781,-87.6298': weather };
  const player = await context.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  player.on('pageerror', (error) => errors.push(error.message));
  await player.clock.install();
  await player.route('**/api/preview/*', (route) =>
    route.fulfill({ json: manifest }),
  );
  await player.goto(`${base}/player/?preview=${playlist.id}`);
  const visible = player.locator('.slide-frame[aria-hidden="false"]');
  await visible.waitFor();
  assert.equal(
    await visible.locator('[data-shape="rectangle"] rect').getAttribute('rx'),
    '32',
  );
  assert.equal(
    await visible.locator('[data-shape="circle"] circle').count(),
    1,
  );
  await visible
    .locator('[data-stock-symbol="WMT"]')
    .getByText('$105.00', { exact: true })
    .waitFor();
  const weatherBox = visible.locator('[data-layer-type="weather"]');
  assert.ok(
    await weatherBox.evaluate(
      (el) =>
        el.scrollWidth <= el.clientWidth + 1 &&
        el.scrollHeight <= el.clientHeight + 1,
    ),
  );
  const prior = await visible.elementHandle();
  manifest.stocks.WMT.price = 106;
  await player.clock.fastForward(15100);
  await visible
    .locator('[data-stock-symbol="WMT"]')
    .getByText('$106.00', { exact: true })
    .waitFor();
  assert.ok(
    await visible.evaluate((element, previous) => element === previous, prior),
  );
  mkdirSync(path.join(root, 'work'), { recursive: true });
  await player.screenshot({
    path: path.join(root, 'work/widgets-player-1920.png'),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    'Widget browser checks passed: saved circle/rectangle styles, vertical weather in tall/short narrow boxes, encrypted stock connection, player rendering and live quote changes without frame replacement. Provider data mocked.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(dir, { recursive: true, force: true });
}
