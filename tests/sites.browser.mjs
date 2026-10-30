import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const directory = mkdtempSync(
  path.join(os.tmpdir(), 'openframe-sites-browser-'),
);
const instance = createApp({ dataDir: directory });
instance.app.use('/player', express.static(path.resolve('player/web')));
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
    executablePath:
      process.env.OPENFRAME_BROWSER_EXECUTABLE || '/usr/bin/chromium',
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const api = async (route, method = 'GET', data) => {
    const response = await context.request.fetch(base + route, {
      method,
      data,
    });
    assert.ok(response.ok(), `${route}: ${await response.text()}`);
    return response.json();
  };
  await api('/api/setup', 'POST', { password: 'site-browser-password' });
  const legacyFeed = await api('/api/data-feeds', 'POST', {
    name: 'Legacy manual feed',
    fields: [{ key: 'completed', type: 'number' }],
  });
  const legacyKey = await api(
    `/api/data-feeds/${legacyFeed.id}/tokens`,
    'POST',
    { name: 'Existing manual key' },
  );
  const a = await api('/api/sites', 'POST', {
    siteNumber: '001',
    name: 'North',
  });
  const b = await api('/api/sites', 'POST', {
    siteNumber: '002',
    name: 'South',
  });
  const application = await api('/api/data-feeds/applications', 'POST', {
    name: 'Shared metrics',
  });
  const feeds = [];
  for (const [site, value] of [
    [a, 10],
    [b, 20],
  ]) {
    const key = await api(
      `/api/data-feeds/applications/${application.id}/tokens`,
      'POST',
      { name: site.name, siteId: site.id },
    );
    const response = await context.request.post(
      base + '/api/data-feeds/ingest/production',
      {
        headers: { Authorization: `Bearer ${key.token}` },
        data: { completed: value },
      },
    );
    assert.equal(response.status(), 201);
    feeds.push((await response.json()).feedId);
  }
  const slide = await api('/api/slides', 'POST', {
    name: 'Shared slide',
    width: 1920,
    height: 1080,
    layers: [
      {
        id: randomUUID(),
        type: 'data',
        x: 0,
        y: 0,
        width: 50,
        height: 40,
        data: {
          mode: 'metric',
          feedId: feeds[0],
          field: 'completed',
          siteBinding: {
            applicationId: application.id,
            sourceKey: 'production',
          },
        },
      },
    ],
  });
  const playlist = await api('/api/playlists', 'POST', {
    name: 'Shared playlist',
    items: [{ slideId: slide.id, duration: 30 }],
  });
  await api(`/api/playlists/${playlist.id}/publish`, 'POST');
  const device = await api('/api/player/enroll', 'POST', {
    name: 'North lobby',
    siteNumber: '001',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(base + '/dashboard/screens');
  const row = page.locator('.device-row').filter({ hasText: 'North lobby' });
  await row
    .getByRole('button', { name: 'Enter pairing code', exact: true })
    .click();
  const pairing = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Pair a screen', exact: true }),
  });
  assert.equal(
    await pairing.getByLabel('Pairing code', { exact: true }).inputValue(),
    device.code,
  );
  assert.equal(
    await pairing.getByLabel('Approved site', { exact: true }).inputValue(),
    a.id,
  );
  await pairing
    .getByRole('button', { name: 'Approve screen', exact: true })
    .click();
  await pairing.waitFor({ state: 'hidden' });
  await row.getByText('Site 001 · North', { exact: true }).waitFor();
  await page.getByLabel('Filter screens by site').selectOption(b.id);
  await row.waitFor({ state: 'hidden' });
  await page.getByLabel('Filter screens by site').selectOption(a.id);
  await row.waitFor();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  }
  await page.goto(base + '/dashboard/playlists');
  await page
    .getByRole('button', { name: 'Preview draft Shared playlist', exact: true })
    .click();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/preview/${playlist.id}`) &&
      response.url().includes(`siteId=${b.id}`),
  );
  await page.getByLabel('Preview site', { exact: true }).selectOption(b.id);
  const resolved = await (await responsePromise).json();
  assert.equal(resolved.dataFeeds[feeds[1]].data.completed, 20);
  assert.equal(resolved.items[0].slide.layers[0].data.feedId, feeds[1]);
  await page.goto(base + '/dashboard/settings');
  await page.locator('.data-feed-open').first().waitFor();
  await page
    .getByLabel('Filter metrics by site', { exact: true })
    .selectOption(b.id);
  assert.equal(await page.locator('.data-feed-open').count(), 1);
  assert.ok(
    (await page.locator('.data-feed-open').innerText()).includes('Site 002'),
  );
  await page.reload();
  await page.locator('.data-feed-open').first().waitFor();
  assert.equal(
    await page
      .getByLabel('Filter metrics by site', { exact: true })
      .inputValue(),
    b.id,
  );
  await page.goto(base + '/dashboard/screens');
  await row.waitFor();
  const heartbeat = async (siteAck) => {
    const response = await context.request.post(base + '/api/player/sync', {
      headers: { Authorization: `Bearer ${device.token}` },
      data: { version: '0.15.2', siteAck },
    });
    assert.ok(response.ok());
    return response.json();
  };
  await api(`/api/devices/${device.id}`, 'PUT', {
    name: 'North lobby',
    playlistId: playlist.id,
    blank: false,
    rotation: 0,
  });
  await heartbeat(1);
  await row.getByRole('button', { name: 'Transfer site', exact: true }).click();
  const transfer = page.getByRole('dialog').filter({
    has: page.getByRole('heading', {
      name: 'Transfer North lobby',
      exact: true,
    }),
  });
  await transfer
    .getByLabel('Destination site', { exact: true })
    .selectOption(b.id);
  await transfer
    .getByRole('button', { name: 'Review transfer', exact: true })
    .click();
  await transfer.getByText(/current playlist will be retained/).waitFor();
  await transfer
    .getByRole('button', { name: 'Transfer screen', exact: true })
    .click();
  await transfer.waitFor({ state: 'hidden' });
  await page
    .getByLabel('Filter screens by site', { exact: true })
    .selectOption(b.id);
  await row.getByText(/Transfer pending/).waitFor();
  const destination = await heartbeat(1);
  assert.equal(destination.siteRevision, 2);
  await heartbeat(2);
  await page.reload();
  await row.getByText('Previous site cache cleared', { exact: true }).waitFor();
  assert.equal(
    await page
      .getByLabel('Filter screens by site', { exact: true })
      .inputValue(),
    b.id,
  );
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  }
  await page.goto(base + '/dashboard/settings');
  const history = page.locator('details').filter({
    has: page.locator('summary').getByText('Site history', { exact: true }),
  });
  await history.locator('summary').click();
  await history
    .getByRole('button', { name: 'Load site history', exact: true })
    .click();
  await history.getByText(/screen transferred/).waitFor();
  await page
    .getByLabel('Filter metrics by site', { exact: true })
    .selectOption('unassigned');
  await page
    .locator('.data-feed-open')
    .filter({ hasText: 'Legacy manual feed' })
    .click();
  const legacyDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', {
      name: 'Legacy manual feed',
      exact: true,
    }),
  });
  await legacyDialog
    .getByLabel('Original feed site', { exact: true })
    .selectOption(a.id);
  await legacyDialog
    .getByRole('button', { name: 'Assign feed site', exact: true })
    .click();
  await legacyDialog.getByText('Site 001', { exact: true }).waitFor();
  const legacyUpdate = await context.request.put(
    base + `/api/data-feeds/${legacyFeed.id}/data`,
    {
      headers: { Authorization: `Bearer ${legacyKey.token}` },
      data: { completed: 77 },
    },
  );
  assert.equal(legacyUpdate.status(), 200);
  assert.equal(
    (await api(`/api/data-feeds/${legacyFeed.id}/data`)).data.completed,
    77,
  );
  // Site filters are scoped to each login and cleared when membership disappears.
  const destinationGroup = await api('/api/groups', 'POST', {
    name: 'Destination team',
  });
  await api(`/api/sites/${b.id}`, 'PATCH', {
    accessGroupId: destinationGroup.id,
  });
  const invitation = await api('/api/users', 'POST', {
    username: 'destination-user',
    name: 'Destination user',
  });
  await api(
    `/api/groups/${destinationGroup.id}/members/${invitation.user.id}`,
    'PUT',
    { role: 'member' },
  );
  await api(`/api/access/device/${device.id}`, 'POST', {
    groupId: destinationGroup.id,
  });
  await api(`/api/access/data-feed/${feeds[1]}`, 'POST', {
    groupId: destinationGroup.id,
  });
  const otherContext = await browser.newContext();
  await otherContext.request.post(base + '/api/activate', {
    data: { token: invitation.invitation, password: 'site-browser-password' },
  });
  const otherPage = await otherContext.newPage();
  otherPage.on('pageerror', (error) => errors.push(error.message));
  await otherPage.goto(base + '/dashboard/screens');
  await otherPage.locator('.device-row').first().waitFor();
  // Ordinary store members see and approve only their own store's requests.
  const storeRequest = await api('/api/player/enroll', 'POST', {
    name: 'South staff TV',
    siteNumber: b.siteNumber,
  });
  const foreignRequest = await api('/api/player/enroll', 'POST', {
    name: 'North private request',
    siteNumber: a.siteNumber,
  });
  await otherPage.reload();
  const memberRow = otherPage
    .locator('.device-row')
    .filter({ hasText: 'South staff TV' });
  await memberRow.waitFor();
  assert.equal(
    await otherPage
      .locator('.device-row')
      .filter({ hasText: 'North private request' })
      .count(),
    0,
  );
  assert.equal(
    await memberRow
      .getByRole('button', { name: 'Remove pending screen', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await memberRow
      .getByRole('button', { name: 'Rename South staff TV', exact: true })
      .count(),
    0,
  );
  assert.equal(
    (
      await otherContext.request.post(
        base + `/api/devices/${foreignRequest.id}/approve`,
        {
          data: { code: foreignRequest.code, siteId: a.id },
        },
      )
    ).status(),
    403,
  );
  await otherPage.setViewportSize({ width: 390, height: 844 });
  await memberRow
    .getByRole('button', { name: 'Enter pairing code', exact: true })
    .click();
  const memberPairing = otherPage
    .getByRole('dialog')
    .filter({
      has: otherPage.getByRole('heading', {
        name: 'Pair a screen',
        exact: true,
      }),
    });
  assert.equal(
    await memberPairing
      .getByLabel('Pairing code', { exact: true })
      .inputValue(),
    storeRequest.code,
  );
  const memberSite = memberPairing.getByLabel('Approved site', { exact: true });
  assert.equal(await memberSite.inputValue(), b.id);
  assert.deepEqual(
    await memberSite
      .locator('option')
      .evaluateAll((options) => options.map((o) => o.value)),
    ['', b.id],
  );
  await memberPairing
    .getByRole('button', { name: 'Approve screen', exact: true })
    .click();
  await memberPairing.waitFor({ state: 'hidden' });
  await memberRow
    .getByRole('button', { name: 'Rename South staff TV', exact: true })
    .waitFor();
  assert.equal(
    await memberRow
      .getByRole('button', { name: 'Enter pairing code', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await memberRow
      .getByRole('button', { name: 'Transfer site', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await memberRow
      .getByRole('button', { name: 'Revoke device', exact: true })
      .count(),
    0,
  );
  const approvedStoreScreen = (await api('/api/library')).devices.find(
    (d) => d.id === storeRequest.id,
  );
  assert.equal(approvedStoreScreen.approved, true);
  assert.equal(approvedStoreScreen.siteId, b.id);
  await otherPage
    .getByLabel('Filter screens by site', { exact: true })
    .selectOption(b.id);
  await api(
    `/api/groups/${destinationGroup.id}/members/${invitation.user.id}`,
    'PUT',
    { role: 'remove' },
  );
  await otherPage.reload();
  await otherPage
    .getByLabel('Filter screens by site', { exact: true })
    .waitFor();
  await otherPage.waitForFunction(
    () =>
      document.querySelector('[aria-label="Filter screens by site"]').value ===
      '',
  );
  assert.equal(await otherPage.locator('.device-row').count(), 0);
  await otherContext.close();
  await page.goto(base + '/dashboard/screens');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL('**/login');
  assert.equal(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((key) =>
        key.startsWith('openframe.site-filter.'),
      ),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Site browser checks passed: administrator and store-member approval, cross-store request isolation, reviewed transfer/acknowledgement, shared previews, manual migration, access loss, saved-filter/logout clearing, history, and responsive layouts.',
  );
} finally {
  await browser?.close();
  instance.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
}
