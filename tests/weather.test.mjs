import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createWeatherCache } from '../server/weather.mjs';
import {
  weatherKey,
  weatherText,
  setWeatherSnapshots,
} from '../player/web/weather.js';
import { widgets } from '../player/web/widgets.js';
import { layerSchema } from '../server/schema.mjs';

const start = Date.parse('2026-09-16T12:00:00Z');
const config = {
  name: 'Chicago',
  latitude: 41.8781,
  longitude: -87.6298,
  unit: 'F',
};
const point = { properties: { gridId: 'LOT', gridX: 75, gridY: 73 } };
const forecast = {
  properties: {
    periods: [
      {
        startTime: '2026-09-16T12:00:00Z',
        endTime: '2026-09-16T20:00:00Z',
        temperature: 72,
        temperatureUnit: 'F',
        shortForecast: 'Partly Sunny',
      },
    ],
  },
};
const snapshot = {
  status: 'ready',
  fetchedAt: new Date(start).toISOString(),
  periods: [{ ...forecast.properties.periods[0], temperatureF: 72 }],
};
function fixture(t, fetcher, now = () => start) {
  const db = new DatabaseSync(':memory:');
  const cache = createWeatherCache({ db, fetcher, now });
  t.after(async () => {
    cache.close();
    await cache.idle();
    db.close();
  });
  return { cache, db };
}

void test('NWS requests are shared by rounded location, independent of units, names and screen count', async (t) => {
  let time = start;
  const urls = [];
  const { cache, db } = fixture(
    t,
    async (url, options) => {
      urls.push(url);
      assert.equal(options.redirect, 'error');
      assert.match(options.headers['User-Agent'], /OpenFrame/);
      assert.ok(options.signal);
      return Response.json(url.includes('/points/') ? point : forecast);
    },
    () => time,
  );
  for (let i = 0; i < 100; i++)
    cache.read({
      ...config,
      name: `Screen ${i}`,
      latitude: 41.8781001,
      unit: i % 2 ? 'F' : 'C',
    });
  await cache.idle();
  assert.equal(urls.length, 2);
  assert.equal(cache.read(config).periods[0].temperatureF, 72);
  time += 15 * 60000;
  assert.equal(
    cache.read(config).status,
    'ready',
    'stale-while-refresh returns existing data immediately',
  );
  await cache.idle();
  assert.equal(urls.length, 3, 'point mapping is cached for a day');
  cache.close();
  const reopened = createWeatherCache({
    db,
    fetcher: () => {
      throw new Error('Unexpected request');
    },
    now: () => time,
  });
  assert.equal(reopened.read(config).periods[0].temperatureF, 72);
  reopened.close();
});

void test('NWS failures preserve data and honor shared retry backoff', async (t) => {
  let time = start,
    calls = 0,
    failed = false;
  const { cache } = fixture(
    t,
    async (url) => {
      calls++;
      return failed
        ? new Response('', { status: 429, headers: { 'Retry-After': '3600' } })
        : Response.json(url.includes('/points/') ? point : forecast);
    },
    () => time,
  );
  cache.read(config);
  await cache.idle();
  time += 15 * 60000;
  failed = true;
  cache.read(config);
  await cache.idle();
  assert.equal(cache.read(config).status, 'stale');
  assert.equal(cache.read(config).fetchedAt, new Date(start).toISOString());
  for (let i = 0; i < 50; i++) cache.read(config);
  assert.equal(calls, 3);
  time += 30 * 60000;
  cache.read(config);
  assert.equal(calls, 3);
});

void test('unsupported points, malformed responses and oversized bodies fail without foreign requests', async (t) => {
  for (const response of [
    () => new Response('', { status: 404 }),
    () =>
      Response.json({
        properties: {
          gridId: 'https://evil.example',
          gridX: 1,
          gridY: 2,
          forecastHourly: 'http://127.0.0.1',
        },
      }),
    () => new Response('x'.repeat(1024 * 1024 + 1)),
  ]) {
    let calls = 0;
    const { cache } = fixture(t, async (url) => {
      calls++;
      assert.match(url, /^https:\/\/api.weather.gov\/points\//);
      return response();
    });
    cache.read(config);
    await cache.idle();
    assert.equal(cache.read(config).periods.length, 0);
    assert.ok(
      ['unsupported', 'unavailable'].includes(cache.read(config).status),
    );
    assert.equal(calls, 1);
  }
});

void test('concurrency and location storage stay bounded', async (t) => {
  const pending = Promise.withResolvers();
  let calls = 0;
  const { cache, db } = fixture(t, async () => {
    calls++;
    await pending.promise;
    return new Response('', { status: 503 });
  });
  for (let i = 0; i < 300; i++)
    cache.read({ latitude: i / 1000, longitude: 0 });
  assert.equal(calls, 2);
  assert.equal(cache.read({ latitude: 50, longitude: 0 }).status, 'capacity');
  assert.ok(
    db.prepare('SELECT COUNT(*) AS n FROM weather_cache').get().n <= 256,
  );
  pending.resolve();
  await cache.idle();
});

void test('weather schema and formatting cover units, missing data, stale and expired forecasts', () => {
  const layer = {
    id: randomUUID(),
    type: 'weather',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    weather: config,
  };
  assert.ok(layerSchema.safeParse(layer).success);
  assert.ok(
    !layerSchema.safeParse({ ...layer, weather: { ...config, latitude: 91 } })
      .success,
  );
  assert.ok(!layerSchema.safeParse({ ...layer, weather: undefined }).success);
  assert.equal(
    weatherKey({ latitude: -0.000001, longitude: 0 }),
    '0.0000,0.0000',
  );
  assert.equal(weatherKey({ latitude: null, longitude: 0 }), null);
  assert.match(weatherText(config, snapshot, start), /72\u00b0F/);
  assert.match(
    weatherText({ ...config, unit: 'C' }, snapshot, start),
    /22\u00b0C/,
  );
  assert.match(
    weatherText(config, snapshot, start + 61 * 60000),
    /Cached forecast/,
  );
  assert.match(
    weatherText(config, snapshot, start + 9 * 3600000),
    /Expired forecast/,
  );
  assert.match(
    weatherText(config, { status: 'unsupported' }, start),
    /Outside NWS/,
  );
  assert.match(
    weatherText({ ...config, latitude: null }, null, start),
    /Set a weather location/,
  );
});

void test('weather widgets prepare without networking or timers and subscribe only while visible', async (t) => {
  t.mock.method(Date, 'now', () => start);
  const timers = new Set();
  t.mock.method(globalThis, 'setTimeout', (fn) => {
    timers.add(fn);
    return fn;
  });
  t.mock.method(globalThis, 'clearTimeout', (id) => timers.delete(id));
  setWeatherSnapshots({ [weatherKey(config)]: snapshot });
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({ style: {}, textContent: '' }),
    },
  });
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else delete globalThis.document;
  });
  const element = {
    textContent: '',
    replaceChildren(...children) {
      this.textContent = children.map((child) => child.textContent).join('');
    },
  };
  const controller = widgets.get('weather')(element, { weather: config });
  await controller.ready;
  assert.match(element.textContent, /72/);
  assert.equal(timers.size, 0);
  setWeatherSnapshots({});
  assert.match(element.textContent, /72/);
  controller.activate();
  assert.match(element.textContent, /Waiting/);
  assert.equal(timers.size, 1);
  setWeatherSnapshots({ [weatherKey(config)]: snapshot });
  assert.match(element.textContent, /72/);
  controller.dispose();
  assert.equal(timers.size, 0);
  setWeatherSnapshots({});
  assert.match(element.textContent, /72/);
});
