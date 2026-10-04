import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStockCache, scheduledMarketSession } from '../server/stocks.mjs';
import { layerSchema } from '../server/schema.mjs';
import { createApp } from '../server/app.mjs';

const opening = Date.parse('2026-10-05T13:30:00Z');
void test('stock polling follows scheduled US hours across DST and weekends', () => {
  assert.equal(scheduledMarketSession(opening - 1), false);
  assert.equal(scheduledMarketSession(opening), true);
  assert.equal(
    scheduledMarketSession(Date.parse('2026-10-05T20:00:00Z')),
    false,
  );
  assert.equal(
    scheduledMarketSession(Date.parse('2026-10-04T15:00:00Z')),
    false,
  );
  assert.equal(
    scheduledMarketSession(Date.parse('2026-12-07T14:30:00Z')),
    true,
  );
  assert.equal(
    scheduledMarketSession(Date.parse('2026-12-07T14:29:00Z')),
    false,
  );
});
void test('stock quotes share a persistent 15-minute cache and preserve prices on failure', async (t) => {
  const db = new DatabaseSync(':memory:');
  let now = opening,
    calls = 0,
    fail = false;
  const cache = createStockCache({
    db,
    token: () => 'fake-test-token',
    now: () => now,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(new URL(url).hostname, 'finnhub.io');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['X-Finnhub-Token'], 'fake-test-token');
      return fail
        ? new Response('Limited', { status: 429 })
        : Response.json({ c: 105, pc: 100, t: Math.floor(now / 1000) });
    },
  });
  t.after(() => {
    cache.close();
    db.close();
  });
  for (let i = 0; i < 100; i++) cache.read('WMT');
  await cache.idle();
  assert.equal(calls, 1);
  assert.equal(cache.read('WMT').changePercent, 5);
  now += 15 * 60000 - 1;
  cache.read('WMT');
  assert.equal(calls, 1);
  now++;
  fail = true;
  cache.read('WMT');
  await cache.idle();
  assert.equal(calls, 2);
  assert.equal(cache.read('WMT').price, 105);
  assert.equal(cache.read('WMT').status, 'stale');
  now = Date.parse('2026-10-05T21:00:00Z');
  cache.read('WMT');
  await cache.idle();
  assert.equal(calls, 2);
  cache.close();
  const reopened = createStockCache({
    db,
    token: () => 'fake-test-token',
    now: () => now,
    fetcher: () => {
      throw new Error('Should not request');
    },
  });
  assert.equal(reopened.read('WMT').price, 105);
  assert.equal(reopened.read('WMT').scheduledSession, false);
  reopened.close();
});
void test('stocks reject malformed, oversized, and redirected responses without exposing the key', async () => {
  for (const response of [
    Response.json({ c: 0, pc: 100, t: opening / 1000 }),
    Response.json({ c: 100, pc: 0, t: opening / 1000 }),
    Response.json({ c: 100, pc: 99, t: (opening + 600000) / 1000 }),
    new Response('x'.repeat(17000)),
    new Response(null, { status: 302 }),
  ]) {
    const db = new DatabaseSync(':memory:');
    const cache = createStockCache({
      db,
      token: () => 'fake-test-token',
      now: () => opening,
      fetcher: async () => response,
    });
    cache.read('WMT');
    await cache.idle();
    assert.deepEqual(cache.read('WMT').status, 'unavailable');
    assert.ok(!JSON.stringify(cache.read('WMT')).includes('fake-test-token'));
    cache.close();
    db.close();
  }
});
void test('stock provider reset discards an in-flight quote and bounded polling respects its request budget', async () => {
  const db = new DatabaseSync(':memory:');
  const pending = Promise.withResolvers();
  const cache = createStockCache({
    db,
    token: () => 'fake-test-token',
    now: () => opening,
    fetcher: () => pending.promise,
  });
  cache.read('WMT');
  cache.reset();
  pending.resolve(Response.json({ c: 100, pc: 99, t: opening / 1000 }));
  await cache.idle();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_cache').get().n, 0);
  cache.close();
  let calls = 0;
  const limited = createStockCache({
    db,
    token: () => 'fake-test-token',
    now: () => opening,
    fetcher: async () => {
      calls++;
      return Response.json({ c: 100, pc: 99, t: opening / 1000 });
    },
  });
  for (let i = 0; i < 80; i++) {
    limited.read(`S${i}`);
    await limited.idle();
  }
  assert.equal(calls, 30);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_cache').get().n, 30);
  limited.close();
  db.close();
});
void test('stock layer symbols validate and normalize without accepting arbitrary provider URLs', () => {
  const base = {
    id: randomUUID(),
    type: 'stocks',
    x: 0,
    y: 0,
    width: 20,
    height: 60,
    stocks: { symbols: ['wmt', 'WMT', 'BRK.B'] },
  };
  assert.deepEqual(layerSchema.parse(base).stocks.symbols, ['WMT', 'BRK.B']);
  assert.throws(() =>
    layerSchema.parse({
      ...base,
      stocks: { symbols: ['https://foreign.example'] },
    }),
  );
  assert.throws(() => layerSchema.parse({ ...base, stocks: { symbols: [] } }));
  assert.throws(() => layerSchema.parse({ ...base, stocks: undefined }));
});
void test('stock connection is admin-only, encrypted, and quotes reach authenticated previews and player manifests', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-stock-api-'));
  const instance = createApp({
    dataDir: dir,
    stockNow: () => opening,
    stockFetch: async () =>
      Response.json({ c: 105, pc: 100, t: opening / 1000 }),
  });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    instance.close();
    await new Promise((resolve) => server.close(resolve));
    instance.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function request(url, method = 'GET', data, headers = {}) {
    const response = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', cookie, ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await request('/api/settings/stocks')).status, 401);
  await request('/api/setup', 'POST', {
    password: 'test-password-long-enough',
  });
  const adminCookie = cookie;
  const invited = (
    await request('/api/users', 'POST', {
      username: 'regular',
      name: 'Regular',
    })
  ).data;
  await request('/api/activate', 'POST', {
    token: invited.invitation,
    password: 'test-password-long-enough',
  });
  assert.equal(
    (await request('/api/settings/stocks', 'PUT', { token: 'fake-test-token' }))
      .status,
    403,
  );
  assert.equal((await request('/api/settings/stocks')).status, 403);
  assert.equal(
    (await request('/api/stocks?symbols=WMT')).data.WMT.status,
    'unconfigured',
  );
  cookie = adminCookie;
  assert.equal(
    (await request('/api/settings/stocks', 'PUT', { token: 'fake-test-token' }))
      .status,
    200,
  );
  const stored = instance.db
    .prepare("SELECT body FROM records WHERE kind='integration'")
    .get().body;
  assert.ok(!stored.includes('fake-test-token'));
  assert.deepEqual((await request('/api/settings/stocks')).data, {
    configured: true,
  });
  await request('/api/stocks?symbols=WMT');
  for (let i = 0; i < 30; i++) {
    if ((await request('/api/stocks?symbols=WMT')).data.WMT.price) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  const slide = (
    await request('/api/slides', 'POST', {
      name: 'Stocks',
      width: 1920,
      height: 1080,
      background: '#ffffff',
      layers: [
        {
          id: randomUUID(),
          type: 'stocks',
          x: 0,
          y: 0,
          width: 20,
          height: 60,
          stocks: { symbols: ['WMT'] },
        },
      ],
    })
  ).data;
  const playlist = (
    await request('/api/playlists', 'POST', {
      name: 'Stocks',
      items: [{ slideId: slide.id, duration: 10 }],
    })
  ).data;
  await request(`/api/playlists/${playlist.id}/publish`, 'POST');
  const preview = (await request(`/api/preview/${playlist.id}`)).data;
  assert.equal(preview.schemaVersion, 3);
  assert.equal(preview.stocks.WMT.price, 105);
  const player = (
    await request('/api/player/enroll', 'POST', { name: 'Stock screen' })
  ).data;
  await request(`/api/devices/${player.id}/approve`, 'POST', {
    code: player.code,
  });
  await request(`/api/devices/${player.id}`, 'PUT', {
    name: 'Stock screen',
    playlistId: playlist.id,
    blank: false,
    rotation: 0,
  });
  const synced = (
    await request(
      '/api/player/sync',
      'POST',
      {},
      { Authorization: `Bearer ${player.token}` },
    )
  ).data;
  assert.equal(synced.manifest.stocks.WMT.price, 105);
  assert.ok(!JSON.stringify(synced).includes('fake-test-token'));
  await request('/api/settings/stocks', 'PUT', { token: '' });
  assert.equal(
    (await request('/api/stocks?symbols=WMT')).data.WMT.status,
    'unconfigured',
  );
});
