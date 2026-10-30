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
  zipFetch: async () =>
    Response.json({
      places: [
        {
          'place name': 'Chicago',
          'state abbreviation': 'IL',
          latitude: '41.8781',
          longitude: '-87.6298',
        },
      ],
    }),
  weatherFetch: async (url) => {
    calls++;
    if (url.endsWith('/stations'))
      return Response.json({
        features: [{ properties: { stationIdentifier: 'KORD' } }],
      });
    if (url.includes('/observations/'))
      return Response.json({
        properties: {
          timestamp: new Date().toISOString(),
          temperature: { value: 72, unitCode: 'wmoUnit:degF' },
          textDescription: 'Partly Sunny',
        },
      });
    return Response.json(
      url.includes('/points/')
        ? {
            properties: {
              gridId: 'LOT',
              gridX: 75,
              gridY: 73,
              timeZone: 'America/Chicago',
            },
          }
        : {
            properties: {
              periods: Array.from({ length: 8 }, (_, i) => ({
                startTime: new Date(
                  Math.floor(Date.now() / 3600000) * 3600000 + i * 3600000,
                ).toISOString(),
                endTime: new Date(
                  Math.floor(Date.now() / 3600000) * 3600000 +
                    (i + 1) * 3600000,
                ).toISOString(),
                temperature: 72 + i,
                temperatureUnit: 'F',
                shortForecast: [
                  'Partly Sunny',
                  'Mostly Cloudy',
                  'Rain',
                  'Thunderstorms',
                  'Snow',
                  'Fog',
                  'Clear',
                  'Scattered Clouds',
                ][i],
                isDaytime: true,
              })),
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
    ...(process.env.OPENFRAME_BROWSER_EXECUTABLE
      ? { executablePath: process.env.OPENFRAME_BROWSER_EXECUTABLE }
      : {}),
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
  await page.goto(`${base}/app`);
  await page.getByRole('button', { name: 'New slide', exact: true }).click();
  await page.locator('.layer-list button').first().click();
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add forecast card', exact: true })
    .click();
  assert.equal(
    await page.getByLabel('Weather layout', { exact: true }).inputValue(),
    'forecast-card',
  );
  assert.equal(
    await page.getByLabel('Weather display', { exact: true }).inputValue(),
    'six-hour',
  );
  await page
    .getByLabel('Weather display', { exact: true })
    .selectOption('current');
  await page.route('**/api/weather/zip?zip=99999', (route) =>
    route.fulfill({ status: 404, json: { error: 'ZIP code not found' } }),
  );
  await page.getByLabel('US ZIP code', { exact: true }).fill('99999');
  await page
    .getByRole('button', { name: 'Look up ZIP code', exact: true })
    .click();
  await page.getByRole('alert').getByText('ZIP code not found').waitFor();
  assert.equal(
    await page.getByLabel('Location name', { exact: true }).inputValue(),
    'Weather',
  );
  assert.equal(
    await page.getByLabel('Latitude', { exact: true }).inputValue(),
    '',
  );
  await page.getByLabel('US ZIP code', { exact: true }).fill('60601');
  await page
    .getByRole('button', { name: 'Look up ZIP code', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('input[autocomplete="postal-code"]').value ===
        '60601' &&
      [...document.querySelectorAll('input')].some(
        (input) => input.value === 'Chicago, IL',
      ),
  );
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
  await page.getByLabel('Weather display').selectOption('six-hour');
  await page
    .locator('.canvas-holder')
    .getByText(/Next 6 hours/)
    .waitFor();
  assert.equal(
    await page.locator('.canvas-holder [data-weather-icon]').count(),
    6,
  );
  for (const width of [1280, 767, 430, 390, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: `work/weather-editor-${width}.png`,
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `no horizontal page overflow at ${width}px`,
    );
    const text = page.locator('.slide-layer > span').first();
    assert.ok(
      await text.evaluate(
        (element) =>
          element.scrollHeight <= element.parentElement.clientHeight + 1 &&
          element.scrollWidth <= element.parentElement.clientWidth + 1,
      ),
    );
    if (width < 768) {
      assert.ok(
        (await page.getByLabel('Slide name', { exact: true }).boundingBox())
          .width >=
          width - 80,
        `slide title has its own row at ${width}px`,
      );
      const navigation = page.getByRole('navigation', {
        name: 'Editor panels',
      });
      await navigation
        .getByRole('button', { name: 'Layers', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Add text', exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel('Latitude', { exact: true }).isVisible(),
        false,
      );
      await navigation
        .getByRole('button', { name: 'Properties', exact: true })
        .click();
      await page
        .getByLabel('Latitude', { exact: true })
        .scrollIntoViewIfNeeded();
      assert.ok(
        (await page.getByLabel('Latitude', { exact: true }).boundingBox())
          .width >= 100,
      );
      const canvas = await page.locator('.canvas-holder').boundingBox();
      assert.ok(
        canvas.y > 0 && canvas.y + canvas.height < 900,
        'canvas stays visible when scrolling through properties',
      );
      await page.getByLabel('Weather display').selectOption('current');
      await page.getByLabel('Temperature unit').selectOption('C');
      await page
        .locator('.canvas-holder')
        .getByText(/22\u00b0C/)
        .waitFor();
      await page.getByLabel('Temperature unit').selectOption('F');
      await page.getByLabel('Weather display').selectOption('six-hour');
      await navigation
        .getByRole('button', { name: 'Canvas', exact: true })
        .click();
      assert.equal(
        await page.getByLabel('Latitude', { exact: true }).isVisible(),
        false,
      );
      await page.locator('.canvas-holder .slide-layer').first().click();
      assert.equal(
        await navigation
          .getByRole('button', { name: 'Canvas', exact: true })
          .getAttribute('aria-pressed'),
        'true',
        'selecting a layer preserves the expanded canvas for dragging',
      );
      await navigation
        .getByRole('button', { name: 'Properties', exact: true })
        .click();
      await page.screenshot({ path: `work/weather-properties-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 390, height: 480 });
  await page.getByLabel('US ZIP code', { exact: true }).fill('60601');
  const shortViewportCanvas = await page
    .locator('.canvas-holder')
    .boundingBox();
  const shortViewportInput = await page
    .getByLabel('US ZIP code', { exact: true })
    .boundingBox();
  assert.ok(
    shortViewportCanvas.y > 0 &&
      shortViewportCanvas.y + shortViewportCanvas.height < 480,
  );
  assert.ok(
    shortViewportInput.y > shortViewportCanvas.y + shortViewportCanvas.height &&
      shortViewportInput.y + shortViewportInput.height <= 480,
    'properties remain reachable alongside the canvas in a short viewport',
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByLabel('Weather display').selectOption('current');
  await page
    .locator('.canvas-holder')
    .getByText(/Current weather/)
    .waitFor();
  await page.route('**/api/slides/*', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          status: 503,
          json: { error: 'Please try saving again.' },
        })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  const saveError = page
    .getByRole('alert')
    .getByText('Please try saving again.', { exact: true });
  await saveError.waitFor();
  const saveErrorBounds = await saveError.boundingBox();
  assert.ok(
    saveErrorBounds.y > 0 && saveErrorBounds.y + saveErrorBounds.height < 900,
    'save failures remain visible above the mobile inspector',
  );
  await page.unroute('**/api/slides/*');
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  const library = await (
    await context.request.get(`${base}/api/library`)
  ).json();
  const slide = library.slides[0];
  assert.equal(slide.layers[0].type, 'weather');
  assert.equal(slide.layers[0].weather.latitude, 41.8781);
  assert.equal(slide.layers[0].weather.zip, '60601');
  assert.equal(slide.layers[0].weather.mode, 'current');
  assert.equal(slide.layers[0].weather.layout, 'forecast-card');
  assert.ok(slide.layers[0].width > 40);
  const createdPlaylist = await context.request.post(`${base}/api/playlists`, {
    data: {
      name: 'Forecast card publication',
      items: [{ slideId: slide.id, duration: 10 }],
    },
  });
  assert.equal(createdPlaylist.status(), 201);
  const playlist = await createdPlaylist.json();
  const publication = await context.request.post(
    `${base}/api/playlists/${playlist.id}/publish`,
  );
  assert.equal(publication.status(), 200);
  const published = await (
    await context.request.get(
      `${base}/api/preview/${playlist.id}?version=published`,
    )
  ).json();
  assert.equal(published.schemaVersion, 3);
  assert.equal(
    published.items[0].slide.layers[0].weather.layout,
    'forecast-card',
  );

  const data = await (await context.request.get(endpoint)).json();
  assert.equal(calls, 4);
  await page.close();

  for (const width of [1280, 390]) {
    const player = await context.newPage({ viewport: { width, height: 720 } });
    player.on('pageerror', (error) => errors.push(error.message));
    await player.clock.install();
    let weather = data,
      connected = true,
      blank = false;
    let displaySlide = structuredClone(slide),
      revision = 'weather-fixture';
    displaySlide.layers[0].weather.layout = 'horizontal';
    player.on('request', (request) =>
      assert.equal(
        new URL(request.url()).origin,
        base,
        'players use no remote weather or icon requests',
      ),
    );
    await player.route(`${base}/local/state`, (route) =>
      route.fulfill({
        json: {
          approved: true,
          blank,
          connection: { connected },
          weather: { '41.8781,-87.6298': weather },
          manifest: {
            schemaVersion: 1,
            revision,
            assets: [],
            items: [{ slide: displaySlide, duration: 3600 }],
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
      observation: { ...data.observation, temperatureF: 75 },
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
    displaySlide = structuredClone(slide);
    displaySlide.layers[0].weather.mode = 'six-hour';
    displaySlide.layers[0].weather.layout = 'horizontal';
    revision = 'weather-six-hour-fixture';
    weather = data;
    await player.clock.fastForward(3100);
    await visible.getByText(/Next 6 hours/).waitFor();
    assert.equal(await visible.locator('[data-weather-icon]').count(), 6);
    assert.ok(
      await visible.locator('[data-weather-icon]').evaluateAll((icons) =>
        icons.every((icon) => {
          const bounds = icon.getBoundingClientRect();
          return (
            bounds.width > 0 && bounds.height > 0 && icon.children.length > 0
          );
        }),
      ),
    );
    assert.ok(
      await visible
        .locator('.layer > span')
        .evaluate(
          (element) =>
            element.scrollWidth <= element.parentElement.clientWidth + 1 &&
            element.scrollHeight <= element.parentElement.clientHeight + 1,
        ),
    );
    await player.screenshot({
      path: `work/weather-six-hour-player-${width}.png`,
    });
    displaySlide = structuredClone(slide);
    displaySlide.layers[0].weather.mode = 'six-hour';
    revision = 'weather-card-fixture';
    await player.clock.fastForward(3100);
    await visible.locator('[data-weather-layout="forecast-card"]').waitFor();
    assert.equal(await visible.locator('[data-weather-row]').count(), 6);
    const cardFrame = await visible.elementHandle();
    weather = {
      ...data,
      periods: data.periods.map((period) => ({ ...period, temperatureF: 68 })),
    };
    await player.clock.fastForward(3100);
    await visible
      .locator('[data-weather-temperature]')
      .filter({ hasText: '68°F' })
      .first()
      .waitFor();
    assert.equal(
      await visible
        .locator('[data-weather-temperature]')
        .filter({ hasText: '68°F' })
        .count(),
      6,
    );
    assert.ok(
      await cardFrame.evaluate(
        (element) =>
          element.isConnected &&
          element.getAttribute('aria-hidden') === 'false',
      ),
      'live card updates keep the visible frame',
    );
    assert.ok((await player.locator('.slide-frame').count()) <= 2);
    await player.screenshot({ path: `work/weather-card-player-${width}.png` });
    blank = true;
    await player.clock.fastForward(3100);
    await player.locator('#stage').waitFor({ state: 'hidden' });
    assert.equal(await player.locator('.slide-frame').count(), 0);
    await player.close();
  }
  // Match the photographed white card, then exercise narrow and landscape sizes.
  const card = await context.newPage({
    viewport: { width: 1000, height: 1000 },
  });
  card.on('pageerror', (error) => errors.push(error.message));
  await card.goto(`${base}/player/weather.js`);
  const now = Date.now();
  const cardData = {
    ...data,
    timeZone: 'America/Chicago',
    fetchedAt: new Date(now).toISOString(),
    periods: Array.from({ length: 6 }, (_, i) => ({
      startTime: new Date(now + (i + 1) * 3600000).toISOString(),
      temperatureF: [46, 50, 52, 53, 53, 53][i],
      shortForecast: [
        'Partly Sunny',
        'Partly Sunny',
        'Partly Sunny',
        'Partly Sunny',
        'Mostly Cloudy',
        'Mostly Sunny',
      ][i],
      isDaytime: true,
    })),
  };
  for (const [width, height] of [
    [760, 740],
    [300, 850],
    [1000, 400],
  ]) {
    await card.evaluate(
      async ({ width, height, data, now }) => {
        const { renderWeather, weatherView } =
          await import('/player/weather.js');
        const { layoutText } = await import('/player/text-layout.js');
        document.body.replaceChildren();
        document.body.style.cssText =
          'margin:0;background:#e8edf5;padding:24px;';
        const box = document.createElement('div');
        box.id = 'forecast-fixture';
        box.style.cssText = `width:${width}px;height:${height}px;color:#164a91;background:white;font-family:Arial,sans-serif;overflow:hidden;`;
        const content = document.createElement('span');
        box.append(content);
        document.body.append(box);
        renderWeather(
          content,
          weatherView(
            {
              latitude: 44.95,
              longitude: -93.09,
              name: 'Saint Paul, MN',
              mode: 'six-hour',
              layout: 'forecast-card',
            },
            data,
            now,
          ),
        );
        layoutText(box, content, { autoSize: true, fontSize: 48 }, 1);
      },
      { width, height, data: cardData, now },
    );
    const fixture = card.locator('#forecast-fixture');
    const rows = fixture.locator('[data-weather-row]');
    assert.equal(await rows.count(), 6);
    assert.ok(
      await fixture.evaluate(
        (box) =>
          box.scrollWidth <= box.clientWidth + 1 &&
          box.scrollHeight <= box.clientHeight + 1,
      ),
    );
    const bounds = await fixture.boundingBox();
    const firstRow = await rows.first().boundingBox();
    const lastRow = await rows.last().boundingBox();
    assert.ok(
      firstRow.width >= bounds.width * 0.95,
      'hourly rows use the card width',
    );
    assert.ok(
      lastRow.y + lastRow.height - firstRow.y >= bounds.height * 0.7,
      'forecast fills the card height',
    );
    assert.ok(
      (await fixture
        .locator('[data-weather-temperature]')
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >=
        (width === 760 ? 45 : 18),
      'temperatures stay readable',
    );
    await fixture.screenshot({
      path: `work/forecast-card-${width}x${height}.png`,
    });
  }
  for (const status of ['partial', 'stale', 'unavailable']) {
    await card.evaluate(
      async ({ data, now, status }) => {
        const { renderWeather, weatherView } =
          await import('/player/weather.js');
        const { layoutText } = await import('/player/text-layout.js');
        const box = document.querySelector('#forecast-fixture');
        box.style.width = '360px';
        box.style.height = '740px';
        const periods =
          status === 'unavailable'
            ? []
            : data.periods.slice(0, 3).map((period) => ({
                ...period,
                temperatureF: -15,
                shortForecast: 'Chance Light Snow And Freezing Rain',
              }));
        renderWeather(
          box.firstElementChild,
          weatherView(
            {
              latitude: 44.95,
              longitude: -93.09,
              name: 'Saint Paul, MN',
              mode: 'six-hour',
              layout: 'forecast-card',
            },
            {
              ...data,
              periods,
              status: status === 'stale' ? 'stale' : 'ready',
            },
            now,
          ),
        );
        layoutText(
          box,
          box.firstElementChild,
          { autoSize: true, fontSize: 48 },
          1,
        );
      },
      { data: cardData, now, status },
    );
    const fixture = card.locator('#forecast-fixture');
    assert.ok(
      await fixture.evaluate(
        (box) =>
          box.scrollWidth <= box.clientWidth + 1 &&
          box.scrollHeight <= box.clientHeight + 1,
      ),
      `${status} fits without clipping`,
    );
    await fixture
      .getByText(
        status === 'stale'
          ? /Cached forecast/
          : status === 'partial'
            ? /partial forecast/
            : /Six-hour forecast unavailable/,
      )
      .waitFor();
  }
  await card.close();
  assert.deepEqual(errors, []);
  console.log(
    'Weather ZIP lookup/errors, current observations, six-hour forecast, forecast-card publication/rows, partial/stale/unavailable states, local icons, resize, units, persistence, 1280/390/320px layouts and offline player updates without frame replacement passed. NWS/ZIP responses mocked.',
  );
} finally {
  close();
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
