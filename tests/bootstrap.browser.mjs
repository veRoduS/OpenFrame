import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
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
try {
  for (const width of [900, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let submitted;
    await page.route('http://192.168.50.1/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.pathname === '/setup/state')
        return route.fulfill({
          json: { csrf: 'fixture-token', busy: false, error: null },
        });
      if (url.pathname === '/setup' && req.method() === 'POST') {
        assert.equal(req.headers()['x-setup-token'], 'fixture-token');
        submitted = req.postDataJSON();
        return route.fulfill({ status: 202, json: { ok: true } });
      }
      const files = {
        '/': ['index.html', 'text/html'],
        '/setup.css': ['setup.css', 'text/css'],
        '/setup.js': ['setup.js', 'text/javascript'],
      };
      const file = files[url.pathname];
      if (!file) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({
        contentType: file[1],
        body: readFileSync(
          fileURLToPath(
            new URL('../player/setup-web/' + file[0], import.meta.url),
          ),
        ),
      });
    });
    await page.goto('http://192.168.50.1/');
    await page.getByLabel('Screen name').fill('Off-site display');
    await page.getByLabel('Wi-Fi network (SSID)').fill('Test Wi-Fi');
    await page.getByLabel('Wi-Fi password').fill('fake-password');
    await page
      .getByLabel('OpenFrame server URL')
      .fill('https://openframe.example.com');
    await page.getByText('Cloudflare Access', { exact: true }).click();
    await page.getByLabel('Client ID', { exact: true }).fill('fake-id');
    await page.getByLabel('Client secret', { exact: true }).fill('fake-secret');
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: `work/bootstrap-form-${width}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByText(/Connecting to Wi-Fi/).waitFor();
    assert.equal(submitted.server, 'https://openframe.example.com');
    assert.equal(submitted.ssid, 'Test Wi-Fi');
    assert.equal(submitted.clientSecret, 'fake-secret');
    assert.equal(await page.getByLabel('Wi-Fi password').inputValue(), '');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    'First-boot form passed at 900/390/320px: layout, credential submission, and cleared form state. Networking was mocked.',
  );
} finally {
  await browser.close();
}
