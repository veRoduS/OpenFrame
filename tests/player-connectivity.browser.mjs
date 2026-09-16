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
    assert.equal(
      await page.locator('.setup-progress [aria-current]').textContent(),
      '01 Connect',
    );
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
    await page.screenshot({
      path: `work/player-setup-${viewport.width}.png`,
      fullPage: true,
    });
    if (viewport.width > 600)
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
        'Setup overflows HDMI viewport',
      );
    phase = 'Joining Wi-Fi';
    await page.clock.fastForward(2200);
    await page.getByRole('heading', { name: 'Joining Wi-Fi' }).waitFor();
    assert.equal(
      await page.locator('.setup-progress [aria-current]').textContent(),
      '02 Configure',
    );
    assert.equal(await page.locator('#connection').isVisible(), false);
    phase = 'Awaiting approval';
    await page.clock.fastForward(2200);
    await page.getByText('ABCDEF12').waitFor();
    assert.equal(await page.locator('#connection').isVisible(), false);
    assert.equal(
      await page.locator('.setup-progress [aria-current]').textContent(),
      '03 Pair screen',
    );
    await page.screenshot({
      path: `work/player-approval-${viewport.width}.png`,
      fullPage: true,
    });
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
  for (const width of [900, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    let submitted;
    let resumed = false;
    let failPause = false;
    const state = {
      csrf: 'fixture-token',
      paused: false,
      remainingSeconds: 90,
      closing: false,
    };
    await page.route('http://192.168.50.1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/setup/state') return route.fulfill({ json: state });
      if (path === '/setup/pause') {
        assert.equal(route.request().headers()['x-setup-token'], state.csrf);
        if (failPause) return route.fulfill({ status: 503, json: {} });
        const { duration } = route.request().postDataJSON();
        assert.ok([60, 300, 900, null].includes(duration));
        state.paused = true;
        state.pauseSeconds = duration;
        state.remainingSeconds = duration;
        return route.fulfill({ json: state });
      }
      if (path === '/setup/resume') {
        assert.equal(route.request().headers()['x-setup-token'], state.csrf);
        assert.deepEqual(route.request().postDataJSON(), {});
        resumed = true;
        return route.fulfill({ status: 202, json: { ok: true } });
      }
      if (path === '/setup') {
        submitted = route.request().postDataJSON();
        assert.equal(
          route.request().headers()['x-setup-token'],
          'fixture-token',
        );
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
    for (const [value, label] of [
      ['60', 'Paused - 1:00 remaining'],
      ['300', 'Paused - 5:00 remaining'],
      ['900', 'Paused - 15:00 remaining'],
      ['indefinite', 'Paused indefinitely'],
    ]) {
      await page.getByLabel('Pause duration').selectOption(value);
      await page
        .getByRole('button', { name: 'Pause reconnects', exact: true })
        .click();
      await page.getByText(label, { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel('Wi-Fi network (SSID)').inputValue(),
        'Office',
      );
    }
    await page.reload();
    await page.getByText('Paused indefinitely', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('Pause duration').inputValue(),
      'indefinite',
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `work/player-recovery-paused-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Resume reconnects', exact: true })
      .click();
    await page.getByText(/your saved playlist/).waitFor();
    assert.ok(resumed);
    state.paused = false;
    state.remainingSeconds = 90;
    await page.reload();
    failPause = true;
    await page
      .getByRole('button', { name: 'Pause reconnects', exact: true })
      .click();
    await page.getByText(/Could not confirm/).waitFor();
    assert.equal(
      await page.locator('#reconnect-status').textContent(),
      'Reconnects in 1:30',
    );
    failPause = false;
    await page.getByLabel('Pause duration').selectOption('indefinite');
    await page
      .getByRole('button', { name: 'Pause reconnects', exact: true })
      .click();
    await page.getByText('Paused indefinitely', { exact: true }).waitFor();
    await page.getByLabel('Wi-Fi network (SSID)').fill('Office');
    await page.getByLabel('Wi-Fi password').fill('fake-password');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByText(/your saved playlist/).waitFor();
    assert.deepEqual(submitted, {
      ssid: 'Office',
      password: 'fake-password',
      country: 'US',
    });
    assert.equal(await page.getByLabel('Wi-Fi password').inputValue(), '');
    await page.close();
  }
  console.log(
    'Branded setup QR/layout, approval, cached playback/connection indicator, agent failure, blanking, recovery pause choices/reload/resume/errors and Wi-Fi submission passed. Wi-Fi networking mocked.',
  );
} finally {
  await browser.close();
}
