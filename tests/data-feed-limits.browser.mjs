import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const directory = mkdtempSync(
  path.join(os.tmpdir(), 'openframe-feed-limits-browser-'),
);
const instance = createApp({ dataDir: directory });
instance.app.use(express.static(path.resolve('dist')));
instance.app.get('/{*path}', (_req, res) =>
  res.sendFile(path.resolve('dist/index.html')),
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
    ...(process.env.OPENFRAME_BROWSER_EXECUTABLE
      ? { executablePath: process.env.OPENFRAME_BROWSER_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function api(route, method = 'GET', data) {
    const result = await context.request.fetch(base + route, { method, data });
    assert.ok(
      result.ok(),
      `${route}: ${result.status()} ${await result.text()}`,
    );
    return result.json();
  }
  async function fit() {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  }
  await api('/api/setup', 'POST', { password: 'feed-limits-browser-password' });
  const application = await api('/api/data-feeds/applications', 'POST', {
    name: 'SMCC',
  });
  const key = await api(
    `/api/data-feeds/applications/${application.id}/tokens`,
    'POST',
    { name: 'Metrics' },
  );
  const send = (data) =>
    context.request.post(base + '/api/data-feeds/ingest/production', {
      data,
      headers: { Authorization: `Bearer ${key.token}` },
    });
  await page.goto(base + '/dashboard/settings');
  const settings = page.locator('.data-feed-limits');
  await settings
    .locator('summary')
    .getByText('Feed limits · 100 fields per feed', { exact: true })
    .waitFor();
  await settings.locator('summary').click();
  const input = settings.getByLabel('Fields per feed', { exact: true });
  assert.equal(await input.inputValue(), '100');
  await input.fill('125');
  await settings
    .getByRole('button', { name: 'Save feed limit', exact: true })
    .click();
  await settings
    .getByRole('status')
    .getByText('Feed field limit saved.', { exact: true })
    .waitFor();
  assert.equal((await api('/api/settings/data-feeds')).maxFieldsPerFeed, 125);
  const metrics = Object.fromEntries(
    Array.from({ length: 125 }, (_, i) => [`metric${i}`, i]),
  );
  const wide = await send(metrics);
  assert.equal(wide.status(), 201);
  const feed = await wide.json();
  assert.equal(feed.fields.length, 125);
  await page.reload();
  await settings
    .locator('summary')
    .getByText('Feed limits · 125 fields per feed', { exact: true })
    .waitFor();
  await settings.locator('summary').click();
  assert.equal(await input.inputValue(), '125');
  await input.fill('501');
  await settings
    .getByRole('button', { name: 'Save feed limit', exact: true })
    .click();
  assert.equal(
    await input.evaluate((element) => element.validity.rangeOverflow),
    true,
  );
  assert.equal((await api('/api/settings/data-feeds')).maxFieldsPerFeed, 125);
  await input.fill('3');
  await settings
    .getByRole('button', { name: 'Save feed limit', exact: true })
    .click();
  await settings
    .locator('summary')
    .getByText('Feed limits · 3 fields per feed', { exact: true })
    .waitFor();
  assert.equal((await send({ ...metrics, metric0: 99 })).status(), 200);
  const additional = await send({ extra: 1 });
  assert.equal(additional.status(), 409);
  assert.equal((await additional.json()).code, 'FIELD_LIMIT');
  assert.equal(
    (await api(`/api/data-feeds/${feed.feedId}/data`)).data.metric0,
    99,
  );
  await page.getByRole('button', { name: 'New feed', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const add = dialog.getByRole('button', { name: 'Add field', exact: true });
  await add.click();
  await add.click();
  assert.equal(await dialog.getByLabel('Key', { exact: true }).count(), 3);
  assert.equal(await add.isDisabled(), true);
  await dialog
    .getByRole('button', { name: 'Remove field 3', exact: true })
    .click();
  assert.equal(await add.isEnabled(), true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await input.fill('100');
  await settings
    .getByRole('button', { name: 'Save feed limit', exact: true })
    .click();
  await settings
    .locator('summary')
    .getByText('Feed limits · 100 fields per feed', { exact: true })
    .waitFor();
  const output = path.resolve('work/data-feed-limits');
  mkdirSync(output, { recursive: true });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await fit();
    await page.screenshot({
      path: path.join(output, `${width}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'Feed limit settings passed: default, persistence, bounds, immediate ingestion, preserved wider feeds, manual form controls and desktop/phone layouts.',
  );
} finally {
  if (browser) await browser.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
}
