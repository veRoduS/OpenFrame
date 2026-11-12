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
const capture = process.env.OPENFRAME_CAPTURE_LANDING === 'true';
const title = 'Your screens. Your little corner of the world.';
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
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  assert.equal(
    requests.some((url) => url.includes('/api/')),
    false,
    'Public page must not request private data',
  );
  assert.deepEqual(
    requests.filter((url) => !url.startsWith(base)),
    [],
    'Public page must not request anything from another origin',
  );
  await page.getByRole('link', { name: 'Log in', exact: true }).first().click();
  await page.getByLabel('Username', { exact: true }).fill(credentials.username);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'New slide', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/dashboard');
  for (const route of ['/dashboard', '/login', '/app']) {
    await page.goto(base + route);
    await page
      .getByRole('button', { name: 'New slide', exact: true })
      .waitFor();
    assert.equal(new URL(page.url()).pathname, '/dashboard');
    assert.equal(await page.getByLabel('Password', { exact: true }).count(), 0);
  }
  await page.reload();
  await page.getByRole('button', { name: 'New slide', exact: true }).waitFor();
  const savedBrowser = await context.storageState();
  const session = savedBrowser.cookies.find(
    (cookie) => cookie.name === 'openframe_session',
  );
  assert.ok(
    session.expires > Date.now() / 1000 + 29 * 86400,
    'Session must survive closing the browser',
  );
  assert.equal(session.httpOnly, true);
  const restored = await browser.newContext({ storageState: savedBrowser });
  try {
    const bookmark = await restored.newPage();
    await bookmark.goto(`${base}/dashboard`);
    await bookmark
      .getByRole('button', { name: 'New slide', exact: true })
      .waitFor();
    assert.equal(new URL(bookmark.url()).pathname, '/dashboard');
  } finally {
    await restored.close();
  }
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

  // The fictional sample workspace pictured on the landing page. Its four
  // slides are the playlist the page itself plays (see app/landing.tsx).
  const api = async (url, data, headers) => {
    const response = await context.request.post(base + url, { data, headers });
    assert.ok(response.ok(), `${url} returned ${response.status()}`);
    return response.json();
  };
  const text = (value, y, fontSize, color, extra = {}) => ({
    id: randomUUID(),
    type: 'text',
    x: 7,
    y,
    width: 86,
    height: 9,
    text: value,
    fontSize,
    color,
    ...extra,
  });
  const sample = (name, background, color, label, headline, detail) => ({
    name,
    background,
    width: 1920,
    height: 1080,
    layers: [
      text(label, 9, 36, color),
      text(headline, 27, 168, color, { bold: true, height: 46 }),
      text(detail, 84, 40, color),
    ],
  });
  const examples = [
    sample(
      'Welcome to the studio',
      '#183e28',
      '#c6dc64',
      'THE COMMUNITY STUDIO',
      'Make something\ngood.',
      'Workshops  /  Talks  /  Good company',
    ),
    sample(
      'This week, together',
      '#e0d6e8',
      '#574069',
      'ON THE CALENDAR',
      'A little time.\nA new perspective.',
      'Tuesday  /  Open studio  /  6 pm',
    ),
    sample(
      'Coffee & conversation',
      '#eb896d',
      '#592e25',
      'SLOW DOWN. STAY A WHILE.',
      'Good coffee.\nBetter company.',
      'Every morning  /  From 8 am',
    ),
    sample(
      'A moment to recharge',
      '#e6edda',
      '#3b5430',
      'A LITTLE REMINDER',
      'Great things take\na little space.',
      'See you in the courtyard.',
    ),
  ];
  examples[2].layers.push({
    id: randomUUID(),
    type: 'clock',
    x: 63,
    y: 7.5,
    width: 30,
    height: 9,
    fontSize: 64,
    color: '#592e25',
    bold: true,
    align: 'right',
  });
  const slides = [];
  for (const example of examples)
    slides.push(await api('/api/slides', example));

  // Product images are captured at twice the density they are shown at.
  const studio = await browser.newContext({
    storageState: savedBrowser,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const shots = {};
  try {
    const view = await studio.newPage();
    view.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name, clip) => {
      shots[name] = await view.screenshot({
        path: path.join(root, `work/landing-${name}.png`),
        animations: 'disabled',
        ...(clip ? { clip } : {}),
      });
    };
    // Crops stay just inside the dialog or card they picture and share one
    // shape, so the two smaller figures line up on the page.
    const crop = ({ x, y, width }) => ({
      x: x + 2,
      y: y + 2,
      width: width - 4,
      height: Math.round(((width - 4) * 3) / 4),
    });
    await view.goto(`${base}/dashboard`);
    await view
      .getByRole('button', { name: 'Edit Welcome to the studio', exact: true })
      .click();
    await view
      .locator('.layer-list')
      .getByText('Make something', { exact: false })
      .click();
    await view.locator('.slide-layer.selected').waitFor();
    await shot('editor');

    const playlist = await api('/api/playlists', {
      name: 'Studio welcome loop',
      items: slides.map((slide, index) => ({
        slideId: slide.id,
        duration: [12, 10, 15, 8][index],
      })),
    });
    await api(`/api/playlists/${playlist.id}/publish`, {});
    for (const name of ['Courtyard', 'Front desk', 'Down the road']) {
      const screen = await api('/api/player/enroll', { name });
      await api(`/api/devices/${screen.id}/approve`, { code: screen.code });
      const updated = await context.request.put(
        `${base}/api/devices/${screen.id}`,
        { data: { name, playlistId: playlist.id, blank: false, rotation: 0 } },
      );
      assert.ok(updated.ok());
      // Stand in for a player: download the playlist, then report playback.
      const player = { Authorization: `Bearer ${screen.token}` };
      const { manifest } = await api('/api/player/sync', {}, player);
      assert.equal(manifest.items.length, slides.length);
      await api(
        '/api/player/sync',
        { revision: manifest.revision, playback: { phase: 'playing' } },
        player,
      );
    }

    await view.setViewportSize({ width: 768, height: 1000 });
    await view.goto(`${base}/dashboard/playlists`);
    await view
      .getByRole('button', { name: 'Edit Studio welcome loop', exact: true })
      .click();
    await view.locator('.sequence-row').nth(3).waitFor();
    assert.equal(await view.locator('.sequence-row').count(), 4);
    const dialog = await view.getByRole('dialog').boundingBox();
    const tabs = await view.getByRole('tablist').boundingBox();
    await shot('playlist', crop({ ...dialog, y: tabs.y - 14 }));

    await view.goto(`${base}/dashboard/screens`);
    await view.getByRole('button', { name: 'Grid view', exact: true }).click();
    const card = view.locator('.device-row').first();
    await card.getByText('Playing', { exact: true }).waitFor();
    await card.getByText('Courtyard', { exact: true }).waitFor();
    assert.equal(await view.locator('.device-row').count(), 3);
    await shot('screens', crop(await card.boundingBox()));
  } finally {
    await studio.close();
  }
  if (capture)
    for (const [name, image] of Object.entries(shots))
      await sharp(image)
        .webp({ quality: 90 })
        .toFile(path.join(root, `public/images/openframe-${name}.webp`));

  await page.reload();
  await page
    .getByRole('button', { name: 'Edit Welcome to the studio', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/login');
  await page.goto(`${base}/dashboard`);
  await page.getByLabel('Username', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/login');
  const revokedContext = await browser.newContext({
    storageState: savedBrowser,
  });
  try {
    const bookmark = await revokedContext.newPage();
    await bookmark.goto(`${base}/dashboard`);
    await bookmark.getByLabel('Username', { exact: true }).waitFor();
    assert.equal(new URL(bookmark.url()).pathname, '/login');
  } finally {
    await revokedContext.close();
  }
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

  // With reduced motion the sample playlist waits to be played or stepped
  // through, and every screen on the page shows the same slide.
  const playing = page.getByRole('group', { name: 'Sample playlist' });
  const current = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.landing-screen')].map(
        (screen) =>
          screen.querySelector('.landing-slide.is-current strong').innerText,
      ),
    );
  await playing.getByText('Welcome to the studio', { exact: true }).waitFor();
  await playing
    .getByRole('button', { name: 'Play sample playlist', exact: true })
    .waitFor();
  assert.deepEqual(await current(), Array(4).fill('Make something\ngood.'));
  const third = playing.getByRole('button', {
    name: 'Show slide 3: Coffee & conversation',
    exact: true,
  });
  await third.click();
  assert.equal(await third.getAttribute('aria-pressed'), 'true');
  await playing.getByText('Coffee & conversation', { exact: true }).waitFor();
  assert.deepEqual(
    await current(),
    Array(4).fill('Good coffee.\nBetter company.'),
  );
  assert.match(
    await page
      .locator('.landing-slide.is-current .landing-slide-clock')
      .first()
      .textContent(),
    /^\d\d:\d\d\s[AP]M$/,
    'The clock slide uses the player clock format',
  );
  // This test server is reached by a loopback address, which a TV cannot use.
  assert.equal(
    await page.locator('.landing-address').textContent(),
    'http://192.168.1.10:3100',
  );

  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
    [1280, 720],
    [768, 1024],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(base);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((img) => {
          img.loading = 'eager';
          return img.decode().catch(() => {});
        }),
      );
    });
    // The page clips horizontal overflow, so measure its sections as well.
    assert.ok(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          [
            ...document.querySelectorAll(
              '.landing-header, .landing main > *, .landing-footer',
            ),
          ].every(
            (section) => section.getBoundingClientRect().right <= innerWidth,
          ),
      ),
      `Overflow at ${width}`,
    );
    if (!capture)
      assert.ok(
        await page.evaluate(() =>
          [...document.images].every(
            (img) => img.complete && img.naturalWidth > 0,
          ),
        ),
        'Marketing images must load',
      );
    // The display in the photograph stays whole, in view, and a useful size.
    const wall = await page.evaluate(() => {
      const box = (selector) =>
        document.querySelector(selector).getBoundingClientRect().toJSON();
      return { scene: box('.landing-scene'), screen: box('.landing-wall') };
    });
    assert.ok(
      wall.screen.left >= wall.scene.left &&
        wall.screen.right <= wall.scene.right &&
        wall.screen.top >= wall.scene.top &&
        wall.screen.bottom <= wall.scene.bottom,
      `Wall display must stay inside the photograph at ${width}`,
    );
    assert.ok(
      wall.screen.width >= wall.scene.width * 0.38,
      `Wall display too small at ${width}`,
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

  // Without a reduced-motion preference the playlist advances by itself and
  // can be paused.
  const moving = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  try {
    const live = await moving.newPage();
    live.on('pageerror', (e) => errors.push(e.message));
    await live.goto(base);
    const group = live.getByRole('group', { name: 'Sample playlist' });
    await group.getByText('Welcome to the studio', { exact: true }).waitFor();
    await group
      .getByText('This week, together', { exact: true })
      .waitFor({ timeout: 12_000 });
    await group
      .getByRole('button', { name: 'Pause sample playlist', exact: true })
      .click();
    await group
      .getByRole('button', { name: 'Play sample playlist', exact: true })
      .waitFor();
  } finally {
    await moving.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Landing passed: public privacy, login/logout, sample workspace, copy, FAQ, sample playlist, mobile navigation, images and six viewport widths.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(dir, { recursive: true, force: true });
}
