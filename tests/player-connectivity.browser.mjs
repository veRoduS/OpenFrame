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
    let failSave = false;
    let networkState = {
      revision: 'revision-1',
      country: 'US',
      limit: 20,
      networks: [
        {
          id: 'office-id',
          ssid: 'Office',
          security: 'wpa-psk',
          hidden: false,
          hasPassword: true,
          priority: 999,
        },
      ],
    };
    const state = {
      csrf: 'fixture-token',
      paused: false,
      remainingSeconds: 90,
      closing: false,
    };
    await page.route('http://192.168.50.1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/setup/state') return route.fulfill({ json: state });
      if (path === '/setup/networks') {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: networkState });
        assert.equal(route.request().headers()['x-setup-token'], state.csrf);
        if (failSave)
          return route.fulfill({
            status: 409,
            json: {
              error:
                'Saved networks changed. Reload the page before editing again.',
            },
          });
        submitted = route.request().postDataJSON();
        assert.equal(submitted.revision, networkState.revision);
        networkState = {
          ...networkState,
          revision: `revision-${Date.now()}`,
          country: submitted.country,
          networks: submitted.networks.map((network, index) => ({
            id: network.id || `new-${index}`,
            ssid: network.ssid,
            security: network.security,
            hidden: network.hidden,
            hasPassword: network.security !== 'open',
            priority: 999 - index,
          })),
        };
        return route.fulfill({ json: networkState });
      }
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
      return sendFile(
        route,
        'player/setup-web',
        path === '/' ? 'recovery.html' : path.slice(1),
      );
    });
    await page.goto('http://192.168.50.1/');
    await page
      .getByRole('button', { name: 'Add network', exact: true })
      .click();
    await page.getByLabel('Wi-Fi network (SSID)').last().fill('Backup');
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
        await page.getByLabel('Wi-Fi network (SSID)').last().inputValue(),
        'Backup',
      );
    }
    await page
      .getByRole('button', { name: 'Reorder network 2', exact: true })
      .press('ArrowUp');
    assert.equal(
      await page.locator('#networks summary strong').first().textContent(),
      'Backup',
    );
    await page
      .getByRole('button', { name: 'Reorder network 1', exact: true })
      .press('End');
    await page.locator('#networks details[open] > summary').click();
    await page.locator('#networks').scrollIntoViewIfNeeded();
    const start = await page.locator('.network-grip').last().boundingBox();
    const destination = await page
      .locator('#networks li')
      .first()
      .boundingBox();
    const x = start.x + start.width / 2,
      y = start.y + start.height / 2;
    if (width === 900) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, destination.y + 8, { steps: 10 });
      await page.mouse.up();
    } else {
      const session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y, id: 1 }],
      });
      for (let step = 1; step <= 10; step++)
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x, y: y + ((destination.y + 8 - y) * step) / 10, id: 1 },
          ],
        });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await session.detach();
    }
    assert.equal(
      await page.locator('#networks summary strong').first().textContent(),
      'Backup',
    );
    assert.equal(await page.locator('.dragging, [data-drop]').count(), 0);
    assert.equal(submitted, undefined, 'reordering does not save or reconnect');
    // Escape cancels an in-progress mouse drag without losing the draft order.
    const firstGrip = await page.locator('.network-grip').first().boundingBox();
    const lastRow = await page.locator('#networks li').last().boundingBox();
    await page.mouse.move(firstGrip.x + 10, firstGrip.y + 10);
    await page.mouse.down();
    await page.mouse.move(firstGrip.x + 10, lastRow.y + lastRow.height - 5, {
      steps: 5,
    });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(
      await page.locator('#networks summary strong').first().textContent(),
      'Backup',
    );
    assert.equal(await page.locator('.dragging, [data-drop]').count(), 0);
    await page.locator('#networks summary').first().click();
    assert.equal(
      await page.getByLabel('Wi-Fi password').inputValue(),
      'fake-password',
    );
    await page.getByLabel('Hidden network').first().check();
    await page
      .getByRole('button', { name: 'Save networks', exact: true })
      .click();
    await page.getByText('Networks saved.', { exact: true }).waitFor();
    assert.equal(resumed, false);
    assert.equal(submitted.networks[0].ssid, 'Backup');
    assert.equal(submitted.networks[0].password, 'fake-password');
    assert.equal(submitted.networks[0].hidden, true);
    assert.equal(Object.hasOwn(submitted.networks[1], 'password'), false);
    assert.ok(await page.locator('#recovery-form').isVisible());
    assert.equal(
      await page.getByLabel('Replacement password').first().inputValue(),
      '',
    );
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
    assert.equal(
      await page.locator('#networks summary strong').first().textContent(),
      'Backup',
    );
    await page.locator('#networks summary').first().click();
    await page
      .getByLabel('Replacement password')
      .first()
      .fill('changed-password');
    failSave = true;
    await page
      .getByRole('button', { name: 'Save networks', exact: true })
      .click();
    await page.getByText(/Saved networks changed/).waitFor();
    assert.equal(
      await page.getByLabel('Replacement password').first().inputValue(),
      'changed-password',
    );
    failSave = false;
    await page
      .getByRole('button', { name: 'Save networks', exact: true })
      .click();
    await page.getByText('Networks saved.', { exact: true }).waitFor();
    await page.locator('#networks summary').first().click();
    await page.screenshot({
      path: `work/player-recovery-networks-${width}.png`,
      fullPage: true,
    });
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .getByRole('button', { name: 'Remove network 2', exact: true })
      .click();
    assert.equal(await page.locator('#networks li').count(), 1);
    await page
      .getByRole('button', { name: 'Save networks', exact: true })
      .click();
    await page.getByText('Networks saved.', { exact: true }).waitFor();
    await page.locator('#networks summary').first().click();
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
    await page
      .getByRole('button', { name: 'Add network', exact: true })
      .click();
    await page.getByLabel('Wi-Fi network (SSID)').last().fill('Guest');
    await page.getByLabel('Security').last().selectOption('open');
    assert.equal(await page.getByLabel('Wi-Fi password').isDisabled(), true);
    await page
      .getByRole('button', { name: 'Save networks', exact: true })
      .click();
    await page.getByText('Networks saved.', { exact: true }).waitFor();
    assert.equal(submitted.networks[1].ssid, 'Guest');
    assert.equal(Object.hasOwn(submitted.networks[1], 'password'), false);
    await page
      .getByRole('button', { name: 'Resume reconnects', exact: true })
      .click();
    await page.getByText(/your saved playlist/).waitFor();
    assert.equal(await page.locator('#networks li').count(), 0);
    await page.close();
  }
  console.log(
    'Setup/approval, cached playback/offline indicator, blanking, recovery pause/reload/resume, saved Wi-Fi add/edit/remove/reorder, hidden/open networks, secret retention, conflicts and mobile layouts passed. Wi-Fi networking mocked.',
  );
} finally {
  await browser.close();
}
