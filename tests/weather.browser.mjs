import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
delete process.env.OPENFRAME_WG_SOCKET;
process.env.COOKIE_SECURE = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-weather-browser-'));
let calls = 0;
const { app, db, close } = createApp({
  dataDir: dir,
  weatherFetch: async (url) => {
    calls++;
    return Response.json(
      url.includes('/points/')
        ? { properties: { gridId: 'LOT', gridX: 75, gridY: 73 } }
        : {
            properties: {
              periods: [
                {
                  startTime: new Date(Date.now() - 3600000).toISOString(),
                  endTime: new Date(Date.now() + 86400000).toISOString(),
                  temperature: 72,
                  temperatureUnit: 'F',
                  shortForecast: 'Partly Sunny',
                },
              ],
            },
          },
    );
  },
});
app.use('/player', express.static(path.join(root, 'player/web')));
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (req, res) =>
  res.sendFile(path.join(root, 'dist/index.html')),
);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
mkdirSync(path.join(root, 'work'), { recursive: true });
try {
  const { chromium } = await import(
    process.env.OPENFRAME_PLAYWRIGHT || 'playwright'
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.OPENFRAME_BROWSER_CHANNEL
      ? { channel: process.env.OPENFRAME_BROWSER_CHANNEL }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.request.post(`${base}/api/setup`, {
    data: { password: 'weather-test-password' },
  });
  const endpoint = `${base}/api/weather?latitude=41.8781&longitude=-87.6298`;
  for (let i = 0; i < 30; i++) {
    if ((await (await context.request.get(endpoint)).json()).periods.length)
      break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'New slide', exact: true }).click();
  await page.locator('.layer-list button').first().click();
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add weather widget', exact: true })
    .click();
  await page.getByLabel('Location name', { exact: true }).fill('Chicago');
  await page.getByLabel('Latitude', { exact: true }).fill('41.8781');
  await page.getByLabel('Longitude', { exact: true }).fill('-87.6298');
  await page
    .locator('.canvas-holder')
    .getByText(/72\u00b0F/)
    .waitFor();
  assert.equal(
    await page.getByRole('button', { name: /^Resize weather/ }).count(),
    4,
  );
  await page
    .getByRole('button', { name: 'Resize weather bottom right', exact: true })
    .press('ArrowRight');
  await page.getByLabel('Temperature unit').selectOption('C');
  await page
    .locator('.canvas-holder')
    .getByText(/22\u00b0C/)
    .waitFor();
  await page.getByLabel('Temperature unit').selectOption('F');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `work/weather-editor-${width}.png`,
      fullPage: true,
    });
    const text = page.locator('.slide-layer > span').first();
    assert.ok(
      await text.evaluate(
        (element) =>
          element.scrollHeight <= element.parentElement.clientHeight + 1 &&
          element.scrollWidth <= element.parentElement.clientWidth + 1,
      ),
    );
    if (width < 500) {
      await page
        .getByLabel('Latitude', { exact: true })
        .scrollIntoViewIfNeeded();
      assert.ok(
        (await page.getByLabel('Latitude', { exact: true }).boundingBox())
          .width >= 100,
      );
      await page.screenshot({ path: `work/weather-properties-${width}.png` });
    }
  }
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  const library = await (
    await context.request.get(`${base}/api/library`)
  ).json();
  const slide = library.slides[0];
  assert.equal(slide.layers[0].type, 'weather');
  assert.equal(slide.layers[0].weather.latitude, 41.8781);
  assert.ok(slide.layers[0].width > 60);
  const data = await (await context.request.get(endpoint)).json();
  assert.equal(calls, 2);
  await page.close();

  for (const width of [1280, 390]) {
    const player = await context.newPage({ viewport: { width, height: 720 } });
    player.on('pageerror', (error) => errors.push(error.message));
    await player.clock.install();
    let weather = data,
      connected = true,
      blank = false;
    await player.route(`${base}/local/state`, (route) =>
      route.fulfill({
        json: {
          approved: true,
          blank,
          connection: { connected },
          weather: { '41.8781,-87.6298': weather },
          manifest: {
            schemaVersion: 1,
            revision: 'weather-fixture',
            assets: [],
            items: [{ slide, duration: 3600 }],
          },
        },
      }),
    );
    await player.route(`${base}/local/playback`, (route) =>
      route.fulfill({ status: 204 }),
    );
    await player.goto(`${base}/player/`);
    const visible = player.locator('.slide-frame[aria-hidden="false"]');
    await visible.getByText(/72\u00b0F/).waitFor();
    const original = await visible.elementHandle();
    weather = {
      ...data,
      periods: data.periods.map((p) => ({ ...p, temperatureF: 75 })),
    };
    await player.clock.fastForward(3100);
    await visible.getByText(/75\u00b0F/).waitFor();
    assert.ok(
      await visible
        .locator('.layer > span')
        .evaluate(
          (element) =>
            element.scrollHeight <= element.parentElement.clientHeight + 1 &&
            element.scrollWidth <= element.parentElement.clientWidth + 1,
        ),
    );
    assert.ok(
      await original.evaluate(
        (element) =>
          element.isConnected &&
          element.getAttribute('aria-hidden') === 'false',
      ),
    );
    connected = false;
    await player.clock.fastForward(61000);
    await player.locator('#connection-status').waitFor();
    await visible.getByText(/75\u00b0F/).waitFor();
    assert.ok((await player.locator('.slide-frame').count()) <= 2);
    await player.screenshot({ path: `work/weather-player-${width}.png` });
    blank = true;
    await player.clock.fastForward(3100);
    await player.locator('#stage').waitFor({ state: 'hidden' });
    assert.equal(await player.locator('.slide-frame').count(), 0);
    await player.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Weather editor, resize, units, persistence, 1280/390/320px layouts and cached player updates without frame replacement passed. NWS responses mocked.',
  );
} finally {
  close();
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
