import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-landing-'));
const instance = createApp({ dataDir: dir });
const credentials = instance.seedInitialAdmin();
instance.app.use(express.static(path.join(root, 'dist')));
instance.app.get('/{*path}', (req, res) =>
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
    ...(process.env.OPENFRAME_BROWSER_CHANNEL
      ? { channel: process.env.OPENFRAME_BROWSER_CHANNEL }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  mkdirSync(path.join(root, 'work'), { recursive: true });
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(base);
  await page
    .getByRole('heading', { name: 'OpenFrame.', exact: true })
    .waitFor();
  assert.equal(
    requests.some((url) => url.includes('/api/')),
    false,
    'Public page must not request private data',
  );
  await page.getByRole('link', { name: 'Log in', exact: true }).first().click();
  await page.getByLabel('Username', { exact: true }).fill(credentials.username);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'New slide', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/app');
  const invited = await context.request.post(`${base}/api/users`, {
    data: { username: 'sample-member', name: 'Sample member' },
  });
  const invitation = (await invited.json()).invitation;
  const legacyPage = await context.newPage();
  await legacyPage.goto(`${base}/#activate=${invitation}`);
  await legacyPage
    .getByRole('button', { name: 'Set password & sign in' })
    .waitFor();
  await legacyPage.close();
  const layer = (text, y, fontSize, color, extra = {}) => ({
    id: randomUUID(),
    type: 'text',
    x: 8,
    y,
    width: 84,
    height: 23,
    text,
    fontSize,
    color,
    bold: false,
    ...extra,
  });
  const examples = [
    {
      name: 'Welcome to the studio',
      background: '#274d38',
      layers: [
        layer('THE COMMUNITY STUDIO', 10, 28, '#d5e8af'),
        layer('Make something\ngood.', 32, 100, '#d5e8af', {
          bold: true,
          height: 47,
        }),
        layer('Workshops / Talks / Good company', 86, 22, '#d5e8af', {
          height: 9,
        }),
      ],
    },
    {
      name: 'This week, together',
      background: '#e0d6e8',
      layers: [
        layer('ON THE CALENDAR', 10, 28, '#574069'),
        layer('A little time.\nA new perspective.', 32, 72, '#574069', {
          height: 43,
        }),
        layer('Tuesday  /  Open studio  /  6 pm', 83, 25, '#574069', {
          height: 12,
        }),
      ],
    },
    {
      name: 'Coffee & conversation',
      background: '#eb896d',
      layers: [
        layer('SLOW DOWN. STAY A WHILE.', 10, 28, '#592e25'),
        layer('Good coffee.\nBetter company.', 32, 78, '#592e25', {
          height: 43,
        }),
        layer('Every morning  /  From 8 am', 83, 26, '#592e25', { height: 12 }),
      ],
    },
    {
      name: 'A moment to recharge',
      background: '#e6edda',
      layers: [
        layer('A LITTLE REMINDER', 10, 28, '#3b5430'),
        layer('Great things\ntake a little space.', 32, 72, '#3b5430', {
          height: 43,
        }),
        layer('See you in the courtyard.', 83, 26, '#3b5430', { height: 12 }),
      ],
    },
  ];
  for (const example of examples.reverse()) {
    const response = await context.request.post(`${base}/api/slides`, {
      data: { ...example, width: 1920, height: 1080 },
    });
    assert.equal(response.status(), 201);
  }
  await page.reload();
  await page
    .getByRole('button', { name: 'Edit Welcome to the studio', exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(root, 'work/landing-product.png'),
    animations: 'disabled',
  });
  if (process.env.OPENFRAME_CAPTURE_LANDING === 'true') {
    await sharp(path.join(root, 'work/landing-product.png'))
      .webp({ quality: 92 })
      .toFile(path.join(root, 'public/images/openframe-workspace.webp'));
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/login');
  await page.getByRole('link', { name: 'OpenFrame', exact: true }).click();
  await page.getByRole('button', { name: 'Copy install commands' }).click();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /docker compose up -d --build/,
  );
  await page
    .getByText('What happens when a screen goes offline?', { exact: true })
    .click();
  await page
    .getByText(
      'A configured player keeps playing its last synced playlist and retries the server connection. New content arrives when the connection returns.',
      { exact: true },
    )
    .waitFor();
  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
    [768, 1024],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(base);
    await page
      .getByRole('heading', { name: 'OpenFrame.', exact: true })
      .waitFor();
    await page.evaluate(async () => {
      await Promise.all(
        [...document.images].map((img) => {
          img.loading = 'eager';
          return img.decode().catch(() => {});
        }),
      );
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Overflow at ${width}`,
    );
    if (process.env.OPENFRAME_CAPTURE_LANDING !== 'true')
      assert.ok(
        await page.evaluate(() =>
          [...document.images].every(
            (img) => img.complete && img.naturalWidth > 0,
          ),
        ),
        'Marketing images must load',
      );
    await page.screenshot({
      path: path.join(root, `work/landing-hero-${width}.png`),
      animations: 'disabled',
    });
    await page.screenshot({
      path: path.join(root, `work/landing-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    if (width <= 900) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.getByRole('link', { name: 'Your setup', exact: true }).click();
      assert.equal(
        await page
          .getByRole('button', { name: 'Open navigation' })
          .getAttribute('aria-expanded'),
        'false',
      );
      assert.equal(new URL(page.url()).hash, '#your-server');
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'Landing passed: public privacy, login/logout, sample workspace, copy, FAQ, mobile navigation, images and five viewport widths.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(dir, { recursive: true, force: true });
}
