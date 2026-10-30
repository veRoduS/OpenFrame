import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = path.resolve(import.meta.dirname, '..');
const directory = mkdtempSync(
  path.join(os.tmpdir(), 'openframe-applications-'),
);
const instance = createApp({ dataDir: directory });
instance.app.use(express.static(path.join(root, 'dist')));
instance.app.get('/{*path}', (_req, res) =>
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
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const external = await browser.newContext();
  async function api(route, method = 'GET', data) {
    const response = await context.request.fetch(base + route, {
      method,
      data,
    });
    assert.ok(response.ok(), `${route}: ${await response.text()}`);
    return response.json();
  }
  async function fit() {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    for (const dialog of await page.getByRole('dialog').all())
      if (await dialog.isVisible()) {
        assert.ok(
          await dialog.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return (
              bounds.left >= -1 &&
              bounds.right <= innerWidth + 1 &&
              element.scrollWidth <= element.clientWidth + 1
            );
          }),
          'Application dialog fits viewport',
        );
      }
  }
  await api('/api/setup', 'POST', { password: 'application-browser-password' });
  const group = await api('/api/groups', 'POST', { name: 'Store metrics' });
  const storeGroup = await api('/api/groups', 'POST', { name: 'Store 001' });
  await page.goto(`${base}/dashboard/settings`);
  await page
    .getByRole('heading', { name: 'Data feeds', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'New application', exact: true })
    .click();
  const creation = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'New application', exact: true }),
  });
  await creation
    .getByLabel('Application name', { exact: true })
    .fill('Sales dashboard');
  await creation
    .getByLabel('Managing group', { exact: true })
    .selectOption(group.id);
  await creation
    .getByRole('button', { name: 'Create application', exact: true })
    .click();
  const keysDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', {
      name: 'Application keys: Sales dashboard',
      exact: true,
    }),
  });
  await keysDialog.getByLabel('Key name', { exact: true }).fill('Production');
  await keysDialog.getByLabel('Never expires', { exact: true }).check();
  await keysDialog
    .getByRole('button', { name: 'Generate application API key', exact: true })
    .click();
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
  assert.equal(endpoint, `${base}/api/data-feeds/ingest/production`);
  const example = await secretDialog.locator('.data-feed-code').textContent();
  assert.ok(example.includes(String.fromCharCode(92, 10)));
  assert.ok(example.includes('--request POST'));
  assert.equal(example.includes(secret), false);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await fit();
  }
  await secretDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.data-feed-secret').waitFor({ state: 'detached' });
  await keysDialog
    .getByText('Never expires · Not used yet', { exact: true })
    .waitFor();
  await keysDialog
    .getByRole('button', {
      name: 'Change expiration for Production',
      exact: true,
    })
    .click();
  const expiryForm = keysDialog.getByRole('form', {
    name: 'Expiration for Production',
    exact: true,
  });
  await expiryForm.getByLabel('Never expires', { exact: true }).uncheck();
  await expiryForm.getByLabel('Expires in days', { exact: true }).fill('7');
  await expiryForm
    .getByRole('button', { name: 'Save expiration', exact: true })
    .click();
  await expiryForm.waitFor({ state: 'hidden' });
  assert.equal(
    await keysDialog
      .getByText('Never expires · Not used yet', { exact: true })
      .count(),
    0,
  );
  await keysDialog.getByRole('button', { name: 'Done', exact: true }).click();
  const first = await external.request.post(endpoint, {
    headers: { Authorization: `Bearer ${secret}` },
    data: { completed: 42, goal: 100 },
  });
  assert.equal(first.status(), 201);
  const receipt = await first.json();
  // Discover the application's feed without navigation, reload or host field setup.
  await page
    .getByRole('button', { name: /Sales dashboard · production.*2 fields/ })
    .waitFor({ timeout: 22000 });
  await page
    .getByRole('button', { name: /Sales dashboard · production.*2 fields/ })
    .click();
  const feedDialog = page.getByRole('dialog');
  await feedDialog
    .getByRole('heading', { name: 'Latest snapshot', exact: true })
    .waitFor();
  assert.ok(
    (
      await feedDialog.locator('.data-feed-code').first().textContent()
    ).includes('42'),
  );
  const updated = await external.request.post(endpoint, {
    headers: { Authorization: `Bearer ${secret}` },
    data: { completed: 43, orders: 12 },
  });
  assert.equal(updated.status(), 200);
  assert.equal((await updated.json()).feedId, receipt.feedId);
  const snapshot = await api(`/api/data-feeds/${receipt.feedId}/data`);
  assert.deepEqual(snapshot.data, { completed: 43, goal: 100, orders: 12 });
  await feedDialog
    .locator('.data-feed-code')
    .filter({ hasText: 'curl --request PUT' })
    .filter({ hasText: '"orders"' })
    .waitFor({ timeout: 22000 });
  await page.keyboard.press('Escape');
  await page.locator('.data-feed-application-list summary').click();
  await page
    .getByRole('button', {
      name: 'Manage application keys for Sales dashboard',
      exact: true,
    })
    .click();
  // Rotating a key in the same application keeps stable source IDs.
  await keysDialog.getByLabel('Key name', { exact: true }).fill('Replacement');
  await keysDialog
    .getByRole('button', { name: 'Generate application API key', exact: true })
    .click();
  const replacement = await secretDialog
    .locator('.data-feed-secret code')
    .textContent();
  await secretDialog.getByRole('button', { name: 'Done', exact: true }).click();
  const rotated = await external.request.post(endpoint, {
    headers: { Authorization: `Bearer ${replacement}` },
    data: { completed: 44 },
  });
  assert.equal(rotated.status(), 200);
  assert.equal((await rotated.json()).feedId, receipt.feedId);
  await keysDialog
    .getByRole('button', {
      name: 'Revoke application key Production',
      exact: true,
    })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await keysDialog
    .getByRole('button', {
      name: 'Revoke application key Production',
      exact: true,
    })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Revoke API key', exact: true })
    .click();
  await keysDialog
    .getByText('Application API key revoked.', { exact: true })
    .waitFor();
  assert.equal(
    (
      await external.request.post(endpoint, {
        headers: { Authorization: `Bearer ${secret}` },
        data: { completed: 45 },
      })
    ).status(),
    401,
  );
  assert.equal(
    (await api(`/api/data-feeds/${receipt.feedId}/data`)).data.completed,
    44,
  );
  const screenshots = path.join(root, 'work/ui-review/application-keys');
  mkdirSync(screenshots, { recursive: true });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await fit();
    await page.screenshot({
      path: path.join(screenshots, `application-keys-${width}.png`),
      fullPage: true,
    });
  }
  await keysDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await api('/api/data-feeds/applications', 'POST', { name: 'Unused test' });
  await page.reload();
  await page.locator('.data-feed-application-list summary').click();
  await page
    .getByRole('button', {
      name: 'Manage application keys for Unused test',
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete application', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete application', exact: true })
    .click();
  await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
  assert.equal(
    (await api('/api/data-feeds/applications')).some(
      (application) => application.name === 'Unused test',
    ),
    false,
  );
  await page.getByText('Sites (0)', { exact: true }).click();
  await page.getByLabel('Site number', { exact: true }).fill('001');
  await page.getByLabel('Site name', { exact: true }).fill('North');
  assert.equal(
    await page
      .getByLabel('New site access group', { exact: true })
      .inputValue(),
    storeGroup.id,
  );
  await page.getByRole('button', { name: 'Create site', exact: true }).click();
  await page.getByText('Sites (1)', { exact: true }).waitFor();
  if (
    !(await page
      .locator('.data-feed-token > span')
      .filter({ hasText: /^001 · North$/ })
      .isVisible())
  )
    await page.getByText('Sites (1)', { exact: true }).click();
  await page
    .locator('.data-feed-token > span')
    .filter({ hasText: /^001 · North$/ })
    .waitFor();
  const site = (await api('/api/sites'))[0];
  assert.equal(site.accessGroupId, storeGroup.id);
  const policyUpdate = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/sites/${site.id}`) &&
      response.request().method() === 'PATCH',
  );
  await page
    .getByLabel('Access group for site 001', { exact: true })
    .selectOption(group.id);
  assert.equal((await (await policyUpdate).json()).accessGroupId, group.id);

  await page
    .getByRole('button', {
      name: 'Manage application keys for Sales dashboard',
      exact: true,
    })
    .click();
  await keysDialog.getByLabel('Site', { exact: true }).selectOption(site.id);
  await keysDialog
    .getByLabel('Key name', { exact: true })
    .fill('North integration');
  await keysDialog
    .getByRole('button', { name: 'Generate application API key', exact: true })
    .click();
  const siteSecret = await secretDialog
    .locator('.data-feed-secret code')
    .textContent();
  const siteWrite = await external.request.post(endpoint, {
    headers: { Authorization: `Bearer ${siteSecret}` },
    data: { completed: 55 },
  });
  assert.equal(siteWrite.status(), 201);
  const siteReceipt = await siteWrite.json();
  assert.equal(siteReceipt.siteId, site.id);
  assert.notEqual(siteReceipt.feedId, receipt.feedId);
  await secretDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await secretDialog.waitFor({ state: 'hidden' });
  await keysDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await keysDialog.waitFor({ state: 'hidden' });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await fit();
  }
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page
    .locator('.data-feed-token > span')
    .filter({ hasText: /^001 · North · Archived$/ })
    .waitFor();
  assert.equal(
    (
      await external.request.post(endpoint, {
        headers: { Authorization: `Bearer ${siteSecret}` },
        data: { completed: 56 },
      })
    ).status(),
    409,
  );
  const originalSite = await api('/api/sites', 'POST', {
    siteNumber: '003',
    name: 'Original location',
  });
  await page.reload();
  await page.locator('.data-feed-application-list summary').click();
  await page
    .getByRole('button', {
      name: 'Manage application keys for Sales dashboard',
      exact: true,
    })
    .click();
  await keysDialog
    .getByLabel('Site for existing integration', { exact: true })
    .selectOption(originalSite.id);
  await keysDialog
    .getByRole('button', { name: 'Assign existing integration', exact: true })
    .click();
  await keysDialog.getByText(/Existing keys and feeds assigned/).waitFor();
  const migrated = await external.request.post(endpoint, {
    headers: { Authorization: `Bearer ${replacement}` },
    data: { completed: 46 },
  });
  assert.equal(migrated.status(), 200);
  const migratedReceipt = await migrated.json();
  assert.equal(migratedReceipt.feedId, receipt.feedId);
  assert.equal(migratedReceipt.siteId, originalSite.id);
  assert.deepEqual(errors, []);
  await external.close();
  console.log(
    'Application key browser checks passed: setup, one-time key, external first push, discovery, schema growth, key rotation/revocation, cleanup, site creation/assignment/archival and desktop/mobile layouts.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  instance.close();
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
}
