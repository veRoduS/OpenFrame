import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from '../server/app.mjs';

// Fictional reference values belong only to this disposable test workspace.
const series = (values) =>
  values.map((value, i) => ({
    time: new Date(Date.UTC(2026, 9, i + 1)).toISOString(),
    value,
  }));
const values = {
  pickup: 94.2,
  pickupGoal: 92,
  pickupDelta: 2.4,
  picking: 91.8,
  pickingGoal: 90,
  pickingDelta: 1.9,
  gmv: series([27.1, 28, 27.6, 29.9, 31, 32.2, 34.6]),
  basket: series([71, 71.6, 73.1, 72.5, 74.6, 76.1, 78.45]),
  departments: [
    { label: 'Grocery & Fresh', value: 70.7 },
    { label: 'Pharmacy & Well', value: 40.4 },
    { label: 'Electronics', value: 31.9 },
    { label: 'Apparel Basics', value: 25.4 },
  ],
  departmentChanges: [
    { label: 'Apparel Basics', value: 1.9 },
    { label: 'Electronics', value: 3.2 },
    { label: 'Pharmacy & Well', value: 8.1 },
    { label: 'Grocery & Fresh', value: 6.4 },
  ],
  channels: [
    { label: 'Curbside Pickup', value: 48 },
    { label: 'Spark Delivery', value: 34 },
    { label: 'Express < 1Hr', value: 18 },
  ],
  retention: 89.4,
  speed: 41,
};
const card = (overrides = {}) => ({
  style: 'split',
  header: 'blue',
  badge: 'spark',
  deltaText: '',
  deltaField: '',
  deltaUnit: '%',
  prefix: '',
  subtitle: '',
  footer: '',
  footerRight: '',
  rows: 'table',
  rowDeltaField: '',
  maxRows: 4,
  scaleMax: 100,
  ...overrides,
});
const config = (feedId, mode, field, title, extra = {}, appearance = {}) => ({
  feedId,
  mode,
  field,
  title,
  unit: '',
  decimals: 1,
  target: 100,
  targetField: '',
  orientation: 'horizontal',
  accent: '#17613d',
  track: '#dce5df',
  showUpdated: false,
  staleAfterMinutes: 60,
  ...extra,
  card: card(appearance),
});

delete process.env.PUBLIC_URL;
delete process.env.OPENFRAME_WG_SOCKET;
process.env.COOKIE_SECURE = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'work/data-cards');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-cards-browser-'));
const { app, db, close } = createApp({ dataDir: dir });
app.get('/card-harness', (req, res) =>
  res
    .type('html')
    .send(
      '<!doctype html><html><head><title>Card rendering checks</title></head><body></body></html>',
    ),
);
app.use('/player', express.static(path.join(root, 'player/web')));
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (req, res) =>
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
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error('Browser error:', error.message);
    });
  });
  async function api(route, method = 'GET', data, token) {
    const response = await context.request.fetch(base + route, {
      method,
      ...(data === undefined ? {} : { data }),
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
    const body = await response.json();
    assert.ok(response.ok(), `${response.status()}: ${JSON.stringify(body)}`);
    return body;
  }
  await api('/api/setup', 'POST', { password: 'split-card-browser-password' });
  const feed = await api('/api/data-feeds', 'POST', {
    name: 'Card reference fixtures',
    fields: Object.entries(values).map(([key, value]) => ({
      key,
      type:
        typeof value === 'number'
          ? 'number'
          : value[0].time
            ? 'series'
            : 'categories',
    })),
  });
  const token = await api(`/api/data-feeds/${feed.id}/tokens`, 'POST', {
    name: 'Browser fixtures',
  });
  await api(`/api/data-feeds/${feed.id}/data`, 'PUT', values, token.token);
  const otherFeed = await api('/api/data-feeds', 'POST', {
    name: 'Different field names',
    fields: [{ key: 'groups', type: 'categories' }],
  });

  // Exercise the actual editor, including keyboard-operable style choices and
  // auxiliary bindings which must not follow a widget to a different feed.
  const page = await context.newPage();
  await page.goto(`${base}/dashboard`);
  await page.getByRole('button', { name: /^Slides/ }).click();
  await page.getByRole('button', { name: 'New slide', exact: true }).click();
  await page
    .getByLabel('Slide name', { exact: true })
    .fill('Split card editor');
  await page.locator('.layer-list button').first().click();
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add bar chart widget', exact: true })
    .click();
  await page.getByLabel('Data feed', { exact: true }).selectOption(feed.id);
  await page
    .getByLabel('Value field', { exact: true })
    .selectOption('departments');
  await page.getByRole('radio', { name: 'Split header', exact: true }).check();
  await page.getByLabel('Header color', { exact: true }).waitFor();
  await page
    .getByLabel('Title', { exact: true })
    .fill('Department performance');
  await page.getByLabel('Header color', { exact: true }).selectOption('navy');
  await page.getByLabel('Value prefix', { exact: true }).fill('$');
  await page.getByLabel('Unit / suffix', { exact: true }).fill('B');
  await page
    .getByLabel('Supporting text', { exact: true })
    .fill('Fictional browser fixtures');
  await page.getByLabel('Header badge', { exact: true }).selectOption('delta');
  await page
    .getByLabel('Delta field', { exact: true })
    .selectOption('pickupDelta');
  await page
    .getByLabel('Row delta field', { exact: true })
    .selectOption('departmentChanges');
  await page.getByLabel('Visible rows', { exact: true }).fill('4');
  await page.locator('.data-card-footer-options summary').click();
  await page
    .getByLabel('Footer text', { exact: true })
    .fill('Reference departments');
  await page.getByLabel('Footer right label', { exact: true }).fill('Fixture');
  await page.getByLabel('Show update time', { exact: true }).uncheck();
  await page.locator('.slide-canvas svg[data-card-style="split"]').waitFor();
  await page.getByRole('radio', { name: 'Classic', exact: true }).check();
  assert.equal(
    await page.locator('.slide-canvas svg[data-card-style="split"]').count(),
    0,
  );
  await page.getByRole('radio', { name: 'Split header', exact: true }).check();
  assert.equal(
    await page.getByLabel('Row delta field', { exact: true }).inputValue(),
    'departmentChanges',
  );
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  const saved = (await api('/api/library')).slides.find(
    (slide) => slide.name === 'Split card editor',
  );
  const appearance = saved.layers[0].data.card;
  assert.equal(appearance.style, 'split');
  assert.equal(appearance.header, 'navy');
  assert.equal(appearance.deltaField, 'pickupDelta');
  assert.equal(appearance.rowDeltaField, 'departmentChanges');
  assert.equal(appearance.prefix, '$');
  assert.equal(appearance.footer, 'Reference departments');
  await page
    .getByRole('button', { name: 'Back to slides', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit Split card editor', exact: true })
    .click();
  await page.locator('.layer-list button').first().click();
  assert.ok(
    await page
      .getByRole('radio', { name: 'Split header', exact: true })
      .isChecked(),
  );
  assert.equal(
    await page.getByLabel('Delta field', { exact: true }).inputValue(),
    'pickupDelta',
  );
  assert.equal(
    await page.getByLabel('Header color', { exact: true }).inputValue(),
    'navy',
  );
  await page
    .getByLabel('Data feed', { exact: true })
    .selectOption(otherFeed.id);
  assert.equal(
    await page.getByLabel('Delta field', { exact: true }).inputValue(),
    '',
  );
  assert.equal(
    await page.getByLabel('Row delta field', { exact: true }).inputValue(),
    '',
  );
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  const changed = (await api('/api/library')).slides.find(
    (slide) => slide.id === saved.id,
  );
  assert.equal(changed.layers[0].data.card.deltaField, '');
  assert.equal(changed.layers[0].data.card.rowDeltaField, '');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page
    .getByRole('radio', { name: 'Split header', exact: true })
    .scrollIntoViewIfNeeded();
  const mobile = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth,
    panel: document.querySelector('.properties-panel').clientWidth,
    panelScroll: document.querySelector('.properties-panel').scrollWidth,
    options: document
      .querySelector('.data-card-options')
      .getBoundingClientRect()
      .toJSON(),
  }));
  assert.ok(mobile.document <= mobile.viewport + 1, JSON.stringify(mobile));
  assert.ok(mobile.panelScroll <= mobile.panel + 1, JSON.stringify(mobile));
  assert.ok(
    mobile.options.right <= mobile.viewport + 1,
    JSON.stringify(mobile),
  );
  await page.screenshot({ path: path.join(output, 'editor-mobile.png') });

  const cards = [
    config(
      feed.id,
      'progress',
      'pickup',
      'On-time pickup SLA',
      { unit: '%', targetField: 'pickupGoal' },
      {
        badge: 'delta',
        deltaField: 'pickupDelta',
        subtitle: 'Curbside < 4 min wait',
      },
    ),
    config(
      feed.id,
      'progress',
      'picking',
      'First-time pick rate',
      { unit: '%', targetField: 'pickingGoal' },
      {
        badge: 'delta',
        deltaField: 'pickingDelta',
        subtitle: 'Zero-substitution orders',
      },
    ),
    config(
      feed.id,
      'line',
      'gmv',
      'Weekly digital GMV',
      { unit: 'B', decimals: 2 },
      {
        header: 'navy',
        badge: 'delta',
        deltaText: '+5.8%',
        prefix: '$',
        subtitle: '7-week velocity ($B)',
        footer: 'W1–W7 trend',
        footerRight: 'W7: 34.6',
      },
    ),
    config(
      feed.id,
      'line',
      'basket',
      'Avg basket value',
      { decimals: 2 },
      {
        header: 'navy',
        badge: 'delta',
        deltaText: '+3.1%',
        prefix: '$',
        subtitle: 'Omnichannel cart size',
        footer: 'W1–W7 trend',
        footerRight: 'W7: 78.45',
      },
    ),
    config(
      feed.id,
      'bar',
      'departments',
      'Top dept mix',
      { unit: 'B' },
      { prefix: '$', rowDeltaField: 'departmentChanges' },
    ),
    config(
      feed.id,
      'bar',
      'channels',
      'Channel split',
      { unit: '%', decimals: 0 },
      { header: 'navy', rows: 'bars', maxRows: 3 },
    ),
    config(
      feed.id,
      'metric',
      'retention',
      'Walmart+ active retention',
      { unit: '%' },
      {
        deltaText: '+4.2% YoY',
        footer: 'All-time high renewal rate',
        footerRight: 'Verified',
      },
    ),
    config(
      feed.id,
      'metric',
      'speed',
      'Avg Spark Express speed',
      { unit: 'm', decimals: 2 },
      {
        deltaText: '-6m Faster',
        footer: 'Store-to-door median',
        footerRight: 'Verified',
      },
    ),
  ];
  const gallery = await api('/api/slides', 'POST', {
    name: 'Split header reference fixtures',
    width: 1920,
    height: 720,
    background: '#f4f6f9',
    layers: cards.map((data, i) => ({
      id: randomUUID(),
      type: 'data',
      x: 1 + (i % 4) * 24.75,
      y: 3 + Math.floor(i / 4) * 48.5,
      width: 23.75,
      height: 45.5,
      color: '#202923',
      data,
    })),
  });
  const playlist = await api('/api/playlists', 'POST', {
    name: 'Split header browser fixtures',
    items: [{ slideId: gallery.id, duration: 3600 }],
  });
  await api(`/api/playlists/${playlist.id}/publish`, 'POST');
  const manifest = await api(`/api/preview/${playlist.id}`);
  assert.deepEqual(
    manifest.items[0].slide.layers.map((layer) => layer.data.card),
    cards.map((widget) => widget.card),
  );
  const playback = await context.newPage();
  await playback.setViewportSize({ width: 1920, height: 720 });
  await playback.goto(`${base}/player/?preview=${playlist.id}`);
  const visible = '.slide-frame[aria-hidden="false"]';
  await playback
    .locator(`${visible} svg[data-card-style="split"]`)
    .nth(7)
    .waitFor();
  assert.equal(
    await playback.locator(`${visible} svg[data-card-style="split"]`).count(),
    8,
  );
  assert.match(
    await playback.locator(`${visible} svg`).first().getAttribute('aria-label'),
    /94\.2/,
  );
  assert.match(
    await playback.locator(`${visible} svg`).first().textContent(),
    /92\.0/,
  );
  assert.equal(
    await playback.locator(`${visible} [data-card-part="row"]`).count(),
    7,
  );
  const firstRow = playback
    .locator(`${visible} [data-card-part="row"]`)
    .first();
  assert.match(await firstRow.textContent(), /Grocery & Fresh/);
  assert.match(
    await firstRow.locator('[data-card-part="row-delta"]').textContent(),
    /6\.4/,
  );
  await playback.screenshot({ path: path.join(output, 'reference.png') });
  // Each inline SVG must resolve its own clip and gradient references.
  const resources = await playback.locator(visible).evaluate((frame) => {
    const ids = [...frame.querySelectorAll('[id]')].map((node) => node.id);
    const missing = [...frame.querySelectorAll('*')].flatMap((node) =>
      [...node.attributes].flatMap(({ value }) =>
        [...value.matchAll(/url\(#([^)]*)\)/g)]
          .filter(
            (match) =>
              !node.closest('svg')?.querySelector(`[id="${match[1]}"]`),
          )
          .map((match) => match[1]),
      ),
    );
    return { ids, missing };
  });
  assert.equal(new Set(resources.ids).size, resources.ids.length);
  assert.deepEqual(resources.missing, []);
  await playback.evaluate(() => {
    window.cardFrame = document.querySelector(
      '.slide-frame[aria-hidden="false"]',
    );
  });
  await api(
    `/api/data-feeds/${feed.id}/data`,
    'PUT',
    { ...values, pickup: 95.7 },
    token.token,
  );
  await playback.waitForFunction(
    () =>
      document
        .querySelector('.slide-frame[aria-hidden="false"] svg')
        ?.getAttribute('aria-label')
        .includes('95.7'),
    { timeout: 20000 },
  );
  assert.ok(
    await playback.evaluate(
      () =>
        window.cardFrame ===
        document.querySelector('.slide-frame[aria-hidden="false"]'),
    ),
  );

  // The same renderer is used by the editor and the actual widget lifecycle.
  const checks = await context.newPage();
  await checks.goto(`${base}/card-harness`);
  const result = await checks.evaluate(
    async ({ cards, values }) => {
      const { renderDataWidget, setDataFeedSnapshots } =
        await import('/player/data-feeds.js');
      const { widgets } = await import('/player/widgets.js');
      Object.assign(document.body.style, {
        margin: '16px',
        background: '#f4f6f9',
        fontFamily: 'Arial',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 320px)',
        gap: '16px',
      });
      const now = Date.now();
      const snapshot = {
        status: 'ready',
        updatedAt: new Date(now).toISOString(),
        data: values,
      };
      function render(name, widget, data = snapshot) {
        const host = document.createElement('div');
        host.dataset.case = name;
        Object.assign(host.style, { width: '320px', height: '220px' });
        document.body.append(host);
        renderDataWidget(host, widget, data, '#202923', now);
        return host;
      }
      const hostile = '<img src=x onerror="window.injected=true">';
      const stress = render(
        'large-negative',
        {
          ...cards[6],
          title:
            'Long financial title with descriptive context and safe clipping',
          unit: 'USD',
          decimals: 4,
          card: {
            ...cards[6].card,
            prefix: '$',
            subtitle: hostile,
            footer: 'A longer footer label with context',
            footerRight: 'FY2026 quarterly report',
          },
        },
        { ...snapshot, data: { retention: -999999999999.9999 } },
      );
      const table = render(
        'eight-rows',
        {
          ...cards[4],
          card: { ...cards[4].card, maxRows: 8 },
        },
        {
          ...snapshot,
          data: {
            departments: Array.from({ length: 8 }, (_, i) => ({
              label: i ? `Long department name with detail ${i}` : hostile,
              value: (i - 4) * 123456789,
            })),
            departmentChanges: Array.from({ length: 8 }, (_, i) => ({
              label: i ? `Long department name with detail ${i}` : hostile,
              value: i - 4,
            })),
          },
        },
      );
      render('compact-line', cards[2]);
      const dynamic = render('metric-feed-comparison', {
        ...cards[6],
        card: { ...cards[6].card, badge: 'none', deltaField: 'pickupDelta' },
      });
      const zero = render('zero-gauge', cards[0], {
        ...snapshot,
        data: { ...values, pickup: 0 },
      });
      const wide = render('short-wide-line', {
        ...cards[2],
        showUpdated: true,
      });
      Object.assign(wide.style, { width: '640px', height: '180px' });
      renderDataWidget(
        wide,
        { ...cards[2], showUpdated: true },
        snapshot,
        '#202923',
        now,
      );
      const stale = render(
        'stale',
        { ...cards[0], showUpdated: true },
        { ...snapshot, updatedAt: new Date(now - 7200000).toISOString() },
      );
      const unavailable = render('unavailable', cards[0], {
        ...snapshot,
        status: 'unavailable',
      });
      const empty = render('empty', cards[0], { status: 'empty', data: {} });
      const legacyConfig = { ...cards[6], title: 'Legacy metric' };
      delete legacyConfig.card;
      const legacy = render('legacy', legacyConfig);
      const lifecycle = document.createElement('div');
      const layer = {
        type: 'data',
        color: '#202923',
        data: { ...cards[6], feedId: 'lifecycle', field: 'value' },
      };
      setDataFeedSnapshots({ lifecycle: { ...snapshot, data: { value: 1 } } });
      const controller = widgets.get('data')(lifecycle, layer);
      setDataFeedSnapshots({ lifecycle: { ...snapshot, data: { value: 2 } } });
      const staged = lifecycle.textContent;
      controller.activate();
      const active = lifecycle.textContent;
      controller.dispose();
      setDataFeedSnapshots({ lifecycle: { ...snapshot, data: { value: 3 } } });
      // Font glyph bounds catch actual browser clipping, including text in groups.
      const outside = [
        ...document.querySelectorAll('svg[data-card-style="split"] text'),
      ].flatMap((text) => {
        const box = text.getBoundingClientRect();
        const svg = text.ownerSVGElement.getBoundingClientRect();
        return box.left < svg.left - 1 ||
          box.right > svg.right + 1 ||
          box.top < svg.top - 1 ||
          box.bottom > svg.bottom + 1
          ? [
              {
                text: text.textContent,
                case: text.closest('[data-case]').dataset.case,
              },
            ]
          : [];
      });
      return {
        hostileText: table.textContent.includes('<img'),
        injected: window.injected === true,
        unsafeElements: document.querySelectorAll('img,script,foreignObject')
          .length,
        invalidGeometry: /(?:NaN|Infinity)/.test(document.body.innerHTML),
        outside,
        stressText: stress.textContent,
        rowCount: table.querySelectorAll('[data-card-part="row"]').length,
        stale: stale.textContent,
        unavailable: unavailable.textContent,
        empty: empty.textContent,
        unavailableDeltas: unavailable.querySelectorAll(
          '[data-card-part="delta"], [data-card-part="row-delta"]',
        ).length,
        emptyDeltas: empty.querySelectorAll(
          '[data-card-part="delta"], [data-card-part="row-delta"]',
        ).length,
        legacy: legacy.querySelector('svg').getAttribute('aria-label'),
        legacySplit: !!legacy.querySelector('[data-card-style="split"]'),
        dynamicDelta: dynamic.querySelector('[data-card-part="delta"]')
          .textContent,
        zeroRatio: zero
          .querySelector('[data-card-part="gauge-arc"]')
          .getAttribute('data-ratio'),
        densePillOverflow: [
          ...table.querySelectorAll('[data-card-part="row-delta"] rect'),
        ].some((pill) => {
          const box = pill.getBoundingClientRect();
          const row = pill
            .closest('[data-card-part="row"]')
            .querySelector('rect')
            .getBoundingClientRect();
          return box.top < row.top || box.bottom > row.bottom;
        }),
        staged,
        active,
        disposed: lifecycle.textContent,
      };
    },
    { cards, values },
  );
  assert.ok(result.hostileText);
  assert.equal(result.injected, false);
  assert.equal(result.unsafeElements, 0);
  assert.equal(result.invalidGeometry, false);
  assert.deepEqual(result.outside, []);
  assert.equal(result.rowCount, 8);
  assert.match(result.stale, /stale/i);
  assert.match(result.unavailable, /Data unavailable/i);
  assert.match(result.empty, /Waiting for data/i);
  assert.equal(result.unavailableDeltas, 0);
  assert.equal(result.emptyDeltas, 0);
  assert.match(result.legacy, /Legacy metric.*89\.4/);
  assert.equal(result.legacySplit, false);
  assert.match(result.dynamicDelta, /\+2\.4%/);
  assert.equal(result.zeroRatio, '0');
  assert.equal(result.densePillOverflow, false);
  assert.match(result.staged, /1/);
  assert.match(result.active, /2/);
  assert.equal(result.disposed, result.active);
  await checks.screenshot({
    path: path.join(output, 'edge-cases.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'Split cards passed: editor save/reopen/feed switching/mobile, published 8-card gallery, live refresh, safe SVG, compact edge cases and widget lifecycle.',
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({
      path: path.join(output, 'failure.png'),
      fullPage: true,
    });
    console.error(
      (
        await page
          .locator('.properties-panel')
          .textContent()
          .catch(() => 'No properties panel')
      ).slice(0, 5000),
    );
  }
  throw error;
} finally {
  await browser?.close();
  close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
