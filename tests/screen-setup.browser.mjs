import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { unzipSync, strFromU8 } from 'fflate';
import { createApp } from '../server/app.mjs';

// A disposable real backend: never write to the user's library or VPN inventory.
delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-setup-browser-'));
const { app, db } = createApp({ dataDir: dir });
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
  assert.equal(
    (
      await context.request.post(`${base}/api/setup`, {
        data: { password: 'browser-setup-test-password' },
      })
    ).status(),
    200,
  );
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByText('Screens', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Screen setup', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Screen setup',
    exact: true,
  });
  await dialog.getByLabel('Screen name', { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel('Home server URL').inputValue(), '');
  await dialog.getByRole('tab', { name: 'VPN configs', exact: true }).click();
  await dialog
    .getByLabel('VPN config name', { exact: true })
    .fill('Offsite lobby VPN');
  await dialog
    .getByLabel('VPN-reachable server URL')
    .fill('https://signage.example.com');
  // Fake, deliberately unusable credentials for isolated export checks.
  const privateKey = Buffer.alloc(32, 7).toString('base64');
  const client = `[Interface]\nPrivateKey = ${privateKey}\nAddress = 10.8.0.2/32\n[Peer]\nPublicKey = ${Buffer.alloc(32, 19).toString('base64')}\nAllowedIPs = 0.0.0.0/0\nEndpoint = vpn.example.com:51820\n`;
  await dialog.getByLabel('WireGuard client file').setInputFiles({
    name: 'test-client.conf',
    mimeType: 'text/plain',
    buffer: Buffer.from(client),
  });
  await dialog.getByRole('button', { name: 'Import client config' }).click();
  await dialog.getByText('Available', { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(root, 'work/screen-setup-vpn-desktop.png'),
  });
  await dialog
    .getByRole('button', { name: 'Delete Offsite lobby VPN' })
    .click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Build config', exact: true }).click();
  await dialog.getByLabel('Screen name', { exact: true }).fill('Offsite lobby');
  await dialog.getByLabel(/^Connection/).selectOption('wireguard');
  assert.equal(
    await dialog.getByLabel('Available VPN config').locator('option').count(),
    2,
  );
  await dialog.getByLabel('Available VPN config').selectOption({ index: 1 });
  await dialog.getByText(/Full-tunnel VPN/).waitFor();
  await dialog.getByRole('switch', { name: 'Wi-Fi', exact: true }).click();
  await dialog.getByLabel('Network name (SSID)').fill('Test network');
  await dialog
    .getByLabel('Wi-Fi password', { exact: true })
    .fill('fake-wifi-password');
  await dialog
    .getByRole('switch', { name: 'Cloudflare Access service token' })
    .click();
  await dialog.getByLabel('Client ID', { exact: true }).fill('fake-id.access');
  await dialog
    .getByLabel('Client secret', { exact: true })
    .fill('fake-client-secret');

  async function checkLayout(width, state) {
    await page.setViewportSize({ width, height: 900 });
    await dialog.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: path.join(root, `work/screen-setup-${state}-${width}.png`),
    });
    assert.ok(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
      `${state}: horizontal overflow at ${width}px`,
    );
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
  }
  for (const width of [1280, 390, 320]) await checkLayout(width, 'build');
  const downloadEvent = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Create and download', exact: true })
    .click();
  const download = await downloadEvent;
  assert.match(
    download.suggestedFilename(),
    /^openframe-screen-[a-f0-9-]+\.zip$/,
  );
  const target = path.join(dir, 'export.zip');
  await download.saveAs(target);
  const files = unzipSync(readFileSync(target));
  assert.equal(strFromU8(files['openframe-wg.conf']), client);
  assert.deepEqual(JSON.parse(strFromU8(files['openframe.json'])), {
    name: 'Offsite lobby',
    server: 'https://signage.example.com',
    wifi_ssid: 'Test network',
    wifi_password: 'fake-wifi-password',
    wifi_country: 'US',
    cloudflare_access: {
      client_id: 'fake-id.access',
      client_secret: 'fake-client-secret',
    },
  });
  await dialog
    .getByRole('button', { name: 'Download Offsite lobby', exact: true })
    .waitFor();
  for (const width of [1280, 390, 320]) await checkLayout(width, 'issued');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    'Screens page overflows on mobile',
  );
  await page.screenshot({
    path: path.join(root, 'work/screen-setup-screens-320.png'),
  });
  await page.getByRole('button', { name: 'Screen setup', exact: true }).click();
  await dialog.getByRole('tab', { name: 'VPN configs', exact: true }).click();
  await dialog.getByText('Allocated: Offsite lobby', { exact: true }).waitFor();
  assert.equal(
    await dialog
      .getByRole('button', { name: 'Delete Offsite lobby VPN' })
      .count(),
    0,
  );
  for (const width of [1280, 390, 320]) await checkLayout(width, 'allocated');
  await dialog.getByRole('tab', { name: 'Build config', exact: true }).click();
  await dialog.getByLabel(/^Connection/).selectOption('wireguard');
  assert.equal(
    await dialog.getByLabel('Available VPN config').locator('option').count(),
    1,
  );
  assert.equal(
    await dialog
      .getByRole('button', { name: 'Create and download', exact: true })
      .isDisabled(),
    true,
  );
  await dialog.getByRole('tab', { name: 'Issued setups', exact: true }).click();
  const retry = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Download Offsite lobby', exact: true })
    .click();
  await (await retry).saveAs(path.join(dir, 'retry.zip'));
  const inventory = await (
    await context.request.get(`${base}/api/screen-setup`)
  ).json();
  assert.equal(inventory.setups.length, 1);
  for (const secret of [privateKey, 'fake-wifi-password', 'fake-client-secret'])
    assert.ok(!JSON.stringify(inventory).includes(secret));
  assert.deepEqual(errors, []);
  console.log(
    'Screen setup browser checks passed: real import/allocation/export, re-download, and 1280/390/320px layouts.',
  );
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
