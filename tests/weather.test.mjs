import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createWeatherCache } from '../server/weather.mjs';
import {
  weatherKey,
  weatherText,
  setWeatherSnapshots,
  weatherView,
  weatherCondition,
} from '../player/web/weather.js';
import { widgets } from '../player/web/widgets.js';
import { layerSchema } from '../server/schema.mjs';
import { createZipLookup } from '../server/zip.mjs';
import { weatherIcons } from '../player/web/weather-icons.js';

const start = Date.parse('2026-09-16T12:00:00Z');
const config = {
  name: 'Chicago',
  latitude: 41.8781,
  longitude: -87.6298,
  unit: 'F',
};
const point = {
  properties: {
    gridId: 'LOT',
    gridX: 75,
    gridY: 73,
    timeZone: 'America/Chicago',
  },
};
const stations = {
  features: [
    { properties: { stationIdentifier: 'KORD' } },
    { properties: { stationIdentifier: 'KMDW' } },
  ],
};
const observation = {
  properties: {
    timestamp: new Date(start).toISOString(),
    temperature: { value: 20, unitCode: 'wmoUnit:degC' },
    textDescription: 'Mostly Cloudy',
    icon: 'https://api.weather.gov/icons/land/day/bkn',
  },
};
const nwsResponse = (url) =>
  Response.json(
    url.includes('/points/')
      ? point
      : url.endsWith('/stations')
        ? stations
        : url.includes('/observations/')
          ? observation
          : forecast,
  );
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
      return nwsResponse(url);
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
  assert.equal(urls.length, 4);
  assert.equal(cache.read(config).observation.temperatureF, 68);
  assert.equal(cache.read(config).periods[0].temperatureF, 72);
  time += 15 * 60000;
  assert.equal(
    cache.read(config).status,
    'ready',
    'stale-while-refresh returns existing data immediately',
  );
  await cache.idle();
  assert.equal(
    urls.length,
    6,
    'point and station mapping are cached for a day',
  );
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
        : nwsResponse(url);
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
  assert.equal(calls, 5);
  time += 30 * 60000;
  cache.read(config);
  assert.equal(calls, 5);
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
  assert.equal(layerSchema.parse(layer).weather.mode, 'current');
  assert.ok(
    !layerSchema.safeParse({ ...layer, weather: { ...config, mode: 'weekly' } })
      .success,
  );
  assert.ok(
    !layerSchema.safeParse({ ...layer, weather: { ...config, zip: '1234' } })
      .success,
  );
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

function mockElement() {
  return {
    style: {},
    children: [],
    ownText: '',
    set textContent(value) {
      this.ownText = value;
      this.children = [];
    },
    get textContent() {
      return this.ownText + this.children.map((c) => c.textContent).join('');
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    setAttribute() {},
  };
}

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
      createElement: mockElement,
      createElementNS: mockElement,
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

void test('observations and forecasts fail independently, reject null readings and use a second station', async (t) => {
  let time = start,
    failForecast = false,
    failObservation = false;
  const { cache } = fixture(
    t,
    async (url) => {
      if (url.includes('/forecast/') && failForecast)
        return new Response('', { status: 503 });
      if (url.includes('/observations/')) {
        if (failObservation) return new Response('', { status: 503 });
        return Response.json({
          properties: {
            ...observation.properties,
            timestamp: new Date(time).toISOString(),
            temperature: {
              value: url.includes('KORD') ? null : 21,
              unitCode: 'wmoUnit:degC',
            },
          },
        });
      }
      return nwsResponse(url);
    },
    () => time,
  );
  cache.read(config);
  await cache.idle();
  assert.equal(cache.read(config).observation.station, 'KMDW');
  assert.match(weatherText(config, cache.read(config), time), /70\u00b0F/);
  time += 900000;
  failForecast = true;
  cache.read(config);
  await cache.idle();
  assert.equal(
    cache.read(config).observation.timestamp,
    new Date(time).toISOString(),
  );
  assert.equal(cache.read(config).fetchedAt, new Date(start).toISOString());
  assert.equal(cache.read(config).status, 'stale');
  time += 900000;
  failForecast = false;
  failObservation = true;
  cache.read(config);
  await cache.idle();
  assert.equal(cache.read(config).fetchedAt, new Date(time).toISOString());
  assert.equal(cache.read(config).observationStatus, 'unavailable');
  assert.match(
    weatherText(config, cache.read(config), time),
    /Cached observation/,
  );
});

void test('next six hours are bounded, timezone-correct, ordered and unit-converted', () => {
  const periods = Array.from({ length: 10 }, (_, i) => ({
    startTime: new Date(start + i * 3600000).toISOString(),
    endTime: new Date(start + (i + 1) * 3600000).toISOString(),
    temperatureF: 68,
    shortForecast: 'Rain',
    isDaytime: true,
  })).reverse();
  const data = { ...snapshot, timeZone: 'America/Chicago', periods };
  const view = weatherView(
    { ...config, mode: 'six-hour', unit: 'C' },
    data,
    start,
  );
  assert.equal(view.cells.length, 6);
  assert.equal(view.cells[0].label, '8 AM');
  assert.equal(view.cells[5].label, '1 PM');
  assert.ok(view.cells.every((c) => c.temperature === '20\u00b0C'));
  assert.equal(
    weatherView({ ...config, mode: 'six-hour' }, data, start + 20 * 3600000)
      .cells.length,
    0,
  );
  assert.match(
    weatherView(
      { ...config, mode: 'six-hour' },
      { ...data, periods: periods.slice(5) },
      start,
    ).detail,
    /partial/,
  );
  const current = weatherView(
    config,
    {
      ...data,
      observation: {
        timestamp: new Date(start).toISOString(),
        temperatureF: 50,
        shortForecast: 'Fog',
      },
    },
    start,
  );
  assert.equal(
    current.cells[0].temperature,
    '50\u00b0F',
    'current weather uses observations, not forecast',
  );
  assert.match(current.detail, /Current weather/);
});

void test('weather icons cover conditions and use local geometry with precipitation precedence', () => {
  const cases = {
    Clear: 'sun',
    'Mostly Clear': 'sun',
    'Partly Sunny': 'cloud-sun',
    'Scattered Clouds': 'cloud-sun',
    'Mostly Cloudy': 'cloudy',
    Overcast: 'cloudy',
    Cloudy: 'cloud',
    Fog: 'cloud-fog',
    Mist: 'cloud-fog',
    Haze: 'haze',
    Smoke: 'haze',
    Drizzle: 'cloud-drizzle',
    'Scattered Rain Showers': 'cloud-rain',
    'Heavy Rain': 'cloud-rain-wind',
    'Chance Thunderstorms': 'cloud-lightning',
    Snow: 'cloud-snow',
    'Snow Showers': 'cloud-snow',
    'Freezing Rain': 'cloud-hail',
    'Rain/Snow Mix': 'cloud-hail',
    Sleet: 'cloud-hail',
    Hail: 'cloud-hail',
    Windy: 'wind',
    Tornado: 'tornado',
    '': 'circle-question-mark',
  };
  for (const [description, name] of Object.entries(cases)) {
    assert.equal(weatherCondition(description)[0], name, description);
    assert.ok(weatherIcons[name].length);
  }
  assert.equal(weatherCondition('Clear', false)[0], 'moon');
  assert.equal(weatherCondition('Partly Cloudy', false)[0], 'cloud-moon');
});

void test('ZIP lookup validates, preserves leading zeros, deduplicates and bounds upstream access', async () => {
  let calls = 0,
    time = start;
  const lookup = createZipLookup({
    now: () => time,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.zippopotam.us/us/02108');
      assert.equal(options.redirect, 'error');
      return Response.json({
        places: [
          {
            'place name': 'Boston',
            'state abbreviation': 'MA',
            latitude: '42.357',
            longitude: '-71.064',
          },
        ],
      });
    },
  });
  const results = await Promise.all(
    Array.from({ length: 20 }, () => lookup.lookup('02108')),
  );
  assert.equal(calls, 1);
  assert.equal(results[0].zip, '02108');
  assert.equal(results[0].places[0].latitude, 42.357);
  await lookup.lookup('02108');
  assert.equal(calls, 1);
  for (const bad of ['', '12', '123456', '../foo', ['02108'], 2108])
    await assert.rejects(lookup.lookup(bad), { status: 400 });
  await assert.rejects(lookup.lookup('10001'), { status: 429 });
  time += 86400001;
  await lookup.lookup('02108');
  assert.equal(calls, 2);
  lookup.close();
  for (const [response, status] of [
    [() => new Response('', { status: 404 }), 404],
    [() => Response.json({ places: [] }), 502],
    [() => new Response('x'.repeat(128 * 1024 + 1)), 502],
  ]) {
    const failed = createZipLookup({ fetcher: response });
    await assert.rejects(failed.lookup('99999'), { status });
    failed.close();
  }
});
