import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const directory = mkdtempSync(
  path.join(os.tmpdir(), 'openframe-central-browser-'),
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
  const external = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function api(route, method = 'GET', data) {
    const response = await context.request.fetch(base + route, {
      method,
      data,
    });
    assert.ok(
      response.ok(),
      `${route}: ${response.status()} ${await response.text()}`,
    );
    return response.json();
  }
  async function fit() {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    for (const dialog of await page.getByRole('dialog').all()) {
      if (await dialog.isVisible())
        assert.ok(
          await dialog.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return (
              bounds.left >= -1 &&
              bounds.right <= innerWidth + 1 &&
              element.scrollWidth <= element.clientWidth + 1
            );
          }),
          'Dialog fits viewport',
        );
    }
  }
  await api('/api/setup', 'POST', { password: 'central-browser-password' });
  const sites = [];
  for (const [siteNumber, name] of [
    ['2882', 'Maple Grove'],
    ['3404', 'Roseville'],
  ]) {
    const group = await api('/api/groups', 'POST', {
      name: `${siteNumber} - ${name}`,
    });
    sites.push(
      await api('/api/sites', 'POST', {
        siteNumber,
        name,
        accessGroupId: group.id,
      }),
    );
  }
  const application = await api('/api/data-feeds/applications', 'POST', {
    name: 'SMCC',
  });
  const original = await api('/api/slides', 'POST', {
    name: 'Retained store layout',
    width: 1920,
    height: 1080,
    layers: ['completed', 'training'].map((field, index) => ({
      id: randomUUID(),
      type: 'data',
      x: 5 + index * 48,
      y: 10,
      width: 42,
      height: 75,
      data: {
        feedId: null,
        field,
        mode: index ? 'bar' : 'metric',
        title: index ? 'Training table' : 'Completed metric',
        card: {
          style: 'split',
          rows: 'table',
          maxRows: 15,
          footer: 'Keep this card',
          paddingX: 24,
        },
      },
    })),
  });
  await page.goto(base + '/dashboard/settings');
  await page.locator('.data-feed-application-list summary').click();
  await page
    .getByRole('button', {
      name: 'Manage application keys for SMCC',
      exact: true,
    })
    .click();
  const keys = page.getByRole('dialog').filter({
    has: page.getByRole('heading', {
      name: 'Application keys: SMCC',
      exact: true,
    }),
  });
  await keys.getByLabel('Key scope', { exact: true }).selectOption('central');
  const generate = keys.getByRole('button', {
    name: 'Generate application API key',
    exact: true,
  });
  assert.equal(await generate.isDisabled(), true);
  await keys.getByLabel('2882 · Maple Grove', { exact: true }).check();
  await keys.getByLabel('3404 · Roseville', { exact: true }).check();
  await keys.getByLabel('Key name', { exact: true }).fill('SMCC central');
  await keys.getByLabel('Never expires', { exact: true }).check();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await fit();
  }
  await generate.click();
  const secretDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', {
      name: 'Application API key generated',
      exact: true,
    }),
  });
  const secret = await secretDialog
    .locator('.data-feed-secret code')
    .textContent();
  assert.match(secret, /^ofa_[A-Za-z0-9_-]{43}$/);
  const endpoint = await secretDialog
    .getByLabel('Ingest URL', { exact: true })
    .inputValue();
  assert.equal(endpoint, base + '/api/data-feeds/ingest-stores/production');
  const example = await secretDialog.locator('.data-feed-code').textContent();
  assert.ok(example.includes('"stores"') && example.includes('"tables"'));
  assert.equal(example.includes(secret), false);
  await fit();
  await secretDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await keys.getByText('Central · 2882, 3404', { exact: true }).waitFor();
  assert.equal(
    await keys
      .getByRole('button', { name: 'Assign existing integration', exact: true })
      .count(),
    0,
  );
  await keys.getByRole('button', { name: 'Done', exact: true }).click();
  const data = {
    stores: sites.map((site, i) => ({
      siteNumber: site.siteNumber,
      metrics: { completed: 75 + i, goal: 100 },
      tables: { training: [{ label: 'Safety', value: 98 - i }] },
    })),
  };
  const response = await external.request.post(endpoint, {
    headers: { Authorization: `Bearer ${secret}` },
    data,
  });
  assert.equal(response.status(), 200);
  assert.equal((await response.json()).feedsCreated, 4);
  await page.goto(base + '/dashboard/settings');
  const integration = page.locator('.data-feed-integration');
  await integration
    .locator('summary')
    .getByText('SMCC', { exact: true })
    .waitFor();
  assert.equal(await integration.count(), 1);
  assert.equal(await integration.getAttribute('open'), null);
  await integration.locator('summary').click();
  assert.equal(await integration.locator('.data-feed-store').count(), 2);
  assert.equal(await integration.locator('.data-feed-open').count(), 4);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await fit();
  }
  await page
    .getByLabel('Filter metrics by site', { exact: true })
    .selectOption(sites[1].id);
  assert.equal(await integration.locator('.data-feed-open').count(), 2);
  await integration
    .getByRole('button', { name: /SMCC · production · Site 3404.*2 fields/ })
    .click();
  const snapshotDialog = page.getByRole('dialog');
  await snapshotDialog
    .getByRole('heading', { name: 'Latest snapshot', exact: true })
    .waitFor();
  assert.ok(
    (
      await snapshotDialog.locator('.data-feed-code').first().textContent()
    ).includes('76'),
  );
  await fit();
  await page.keyboard.press('Escape');
  await snapshotDialog.waitFor({ state: 'hidden' });
  await page
    .getByLabel('Filter metrics by site', { exact: true })
    .selectOption('');
  await page.getByPlaceholder('Search by name').fill('does-not-exist');
  await page
    .getByText('No feeds match these filters.', { exact: true })
    .waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base + '/dashboard/slides');
  await page
    .getByRole('button', { name: 'Edit Retained store layout', exact: true })
    .click();
  for (const [title, source] of [
    ['Completed metric', 'production'],
    ['Training table', 'production-tables'],
  ]) {
    await page.locator('.layer-list button').filter({ hasText: title }).click();
    const picker = page.getByLabel('Data feed', { exact: true });
    await picker.selectOption(`store:${application.id}:${source}`);
    await fit();
  }
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  const saved = (await api('/api/library')).slides.find(
    (slide) => slide.id === original.id,
  );
  for (let i = 0; i < 2; i++) {
    assert.equal(saved.layers[i].id, original.layers[i].id);
    assert.equal(saved.layers[i].data.field, original.layers[i].data.field);
    assert.equal(saved.layers[i].data.card.footer, 'Keep this card');
    assert.equal(saved.layers[i].data.card.maxRows, 15);
    assert.deepEqual(saved.layers[i].data.siteBinding, {
      applicationId: application.id,
      sourceKey: i ? 'production-tables' : 'production',
    });
  }
  await page.goto(base + '/dashboard/settings');
  await page.locator('.data-feed-application-list summary').click();
  await page
    .getByRole('button', {
      name: 'Manage application keys for SMCC',
      exact: true,
    })
    .click();
  await keys
    .getByRole('button', {
      name: 'Revoke application key SMCC central',
      exact: true,
    })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Revoke API key', exact: true })
    .click();
  await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
  assert.equal(
    (
      await external.request.post(endpoint, {
        headers: { Authorization: `Bearer ${secret}` },
        data,
      })
    ).status(),
    401,
  );
  assert.equal((await api('/api/data-feeds')).length, 4);
  await keys.getByRole('button', { name: 'Done', exact: true }).click();
  await keys.waitFor({ state: 'hidden' });
  const out = path.resolve('work/multi-store-feeds');
  mkdirSync(out, { recursive: true });
  await page.locator('.data-feed-integration summary').click();
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await fit();
    await page.screenshot({
      path: path.join(out, `${width}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'Multi-store key setup, grouped feeds, retained widget reconnection, revocation and responsive layouts passed.',
  );
} finally {
  if (browser) await browser.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
}
