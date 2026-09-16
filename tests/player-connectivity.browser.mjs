import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(
  process.env.OPENFRAME_PLAYWRIGHT || 'playwright'
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.OPENFRAME_BROWSER_CHANNEL
    ? { channel: process.env.OPENFRAME_BROWSER_CHANNEL }
    : {}),
});
mkdirSync('work', { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const qrFixture =
  process.env.OPENFRAME_TEST_QR_PNG || `${root}/work/setup-qr.png`;
const sendFile = (route, folder, file) =>
  route.fulfill({
    body: readFileSync(`${root}/${folder}/${file}`),
    contentType: {
      html: 'text/html',
      js: 'text/javascript',
      css: 'text/css',
      svg: 'image/svg+xml',
      png: 'image/png',
    }[file.split('.').at(-1)],
  });
try {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 800, height: 480 },
    { width: 390, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.clock.install();
    let phase = 'Wi-Fi setup';
    await page.route('http://setup.test/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/setup/state')
        return route.fulfill({
          json: {
            phase,
            ssid: 'OpenFrame-Setup-AB12',
            password: 'fake-password',
            url: 'http://192.168.50.1',
            code: phase === 'Awaiting approval' ? 'ABCDEF12' : null,
          },
        });
      if (path === '/hotspot.png')
        return route.fulfill({
          body: readFileSync(qrFixture),
          contentType: 'image/png',
        });
      return sendFile(
        route,
        'player/setup-web',
        path === '/' ? 'screen.html' : path.slice(1),
      );
    });
    await page.goto('http://setup.test/');
    await page.getByText('Scan to connect', { exact: true }).waitFor();
    assert.ok(
      await page
        .locator('img')
        .evaluate((img) => img.complete && img.naturalWidth > 100),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    if (viewport.width > 600)
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
        'Setup overflows HDMI viewport',
      );
    await page.screenshot({
      path: `work/player-setup-${viewport.width}.png`,
      fullPage: true,
    });
    phase = 'Awaiting approval';
    await page.clock.fastForward(2200);
    await page.getByText('ABCDEF12').waitFor();
    assert.equal(await page.locator('#connection').isVisible(), false);
    await page.close();
  }
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 720 } });
    await page.clock.install();
    let connected = true,
      blank = false,
      localFailure = false;
    const state = () => ({
      approved: true,
      blank,
      rotation: 0,
      connection: { connected },
      manifest: {
        schemaVersion: 1,
        revision: 'fixture',
        assets: [],
        items: [
          {
            duration: 60,
            slide: {
              id: 'slide',
              name: 'Cached',
              width: 1920,
              height: 1080,
              background: '#e8f0e9',
              layers: [
                {
                  id: 'text',
                  type: 'text',
                  text: 'Saved playlist',
                  x: 10,
                  y: 35,
                  width: 80,
                  height: 25,
                  fontSize: 90,
                  color: '#203c30',
                  align: 'center',
                },
              ],
            },
          },
        ],
      },
    });
    await page.route('http://player.test/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/local/state')
        return localFailure ? route.abort() : route.fulfill({ json: state() });
      if (path === '/local/playback') return route.fulfill({ status: 204 });
      return sendFile(
        route,
        'player/web',
        path === '/' ? 'index.html' : path.slice(1),
      );
    });
    await page.goto('http://player.test/');
    await page.locator('.slide-frame[aria-hidden="false"]').waitFor();
    const frame = await page
      .locator('.slide-frame[aria-hidden="false"]')
      .elementHandle();
    const icon = page.locator('#connection-status');
    assert.equal(await icon.isVisible(), false);
    connected = false;
    await page.clock.fastForward(3100);
    await icon.waitFor();
    assert.ok(
      await frame.evaluate(
        (el) => el.isConnected && el.getAttribute('aria-hidden') === 'false',
      ),
    );
    assert.ok(
      await icon
        .locator('img')
        .evaluate((img) => img.complete && img.naturalWidth === 24),
    );
    await page.screenshot({ path: `work/player-offline-${width}.png` });
    connected = true;
    await page.clock.fastForward(3100);
    await icon.waitFor({ state: 'hidden' });
    localFailure = true;
    await page.clock.fastForward(3100);
    await icon.waitFor();
    assert.ok(await frame.evaluate((el) => el.isConnected));
    localFailure = false;
    blank = true;
    await page.clock.fastForward(3100);
    await icon.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#stage').isVisible(), false);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let submitted;
  await page.route('http://192.168.50.1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/setup/state')
      return route.fulfill({ json: { csrf: 'fixture-token' } });
    if (path === '/setup') {
      submitted = route.request().postDataJSON();
      assert.equal(route.request().headers()['x-setup-token'], 'fixture-token');
      return route.fulfill({ status: 202, json: { ok: true } });
    }
    return sendFile(
      route,
      'player/setup-web',
      path === '/' ? 'recovery.html' : path.slice(1),
    );
  });
  await page.goto('http://192.168.50.1/');
  await page.getByLabel('Wi-Fi network (SSID)').fill('Office');
  await page.getByLabel('Wi-Fi password').fill('fake-password');
  await page.screenshot({ path: 'work/player-recovery-390.png' });
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText(/your saved playlist/).waitFor();
  assert.deepEqual(submitted, {
    ssid: 'Office',
    password: 'fake-password',
    country: 'US',
  });
  assert.equal(await page.getByLabel('Wi-Fi password').inputValue(), '');
  console.log(
    'Setup QR/layout, approval state, cached playback/connection indicator, local-agent failure, blanking and recovery form passed. Wi-Fi networking mocked.',
  );
} finally {
  await browser.close();
}
