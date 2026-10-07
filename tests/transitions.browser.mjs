import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
delete process.env.OPENFRAME_WG_SOCKET;
process.env.COOKIE_SECURE = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-transitions-'));
const { app, db, close } = createApp({ dataDir: dir });
const bitmap = await sharp({
  create: { width: 200, height: 200, channels: 3, background: '#f05a60' },
})
  .png()
  .toBuffer();
app.get('/fixture.png', (req, res) => res.type('png').send(bitmap));
app.get('/transition-harness', (req, res) =>
  res
    .type('html')
    .send(
      '<!doctype html><html><head><link rel="stylesheet" href="/player/player.css"></head><body><div id="stage"></div></body></html>',
    ),
);
app.use('/player', express.static(path.join(root, 'player/web')));
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
    ...(process.env.OPENFRAME_BROWSER_EXECUTABLE
      ? { executablePath: process.env.OPENFRAME_BROWSER_EXECUTABLE }
      : {}),
    ...(process.env.OPENFRAME_BROWSER_CHANNEL
      ? { channel: process.env.OPENFRAME_BROWSER_CHANNEL }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.request.post(`${base}/api/setup`, {
    data: { password: 'transition-test-password' },
  });
  const slide = await (
    await context.request.post(`${base}/api/slides`, {
      data: {
        name: 'Transition example',
        width: 1920,
        height: 1080,
        background: '#ffffff',
        layers: [],
      },
    })
  ).json();
  const playlist = await (
    await context.request.post(`${base}/api/playlists`, {
      data: {
        name: 'Transition test',
        items: [{ slideId: slide.id, duration: 5 }],
      },
    })
  ).json();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app`);
  await page.getByText('Playlists', { exact: true }).first().click();
  await page.getByText(playlist.name, { exact: true }).click();
  const editor = page.locator('.of-modal.wide');
  const selection = editor.getByLabel('Transition', { exact: true });
  assert.equal(await selection.inputValue(), 'cut');
  assert.equal(await editor.getByRole('slider').count(), 0);
  await selection.selectOption('fade');
  const slider = editor.getByRole('slider', { name: 'Transition duration' });
  await slider.fill('800');
  assert.equal(await slider.getAttribute('aria-valuetext'), '0.8 seconds');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await editor.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    );
    const controls = await editor.locator('.playlist-transition').boundingBox();
    assert.ok(controls.x >= 0 && controls.x + controls.width <= width);
    await page.screenshot({ path: `work/transitions-editor-${width}.png` });
  }
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.of-modal.wide button') !== null,
  );
  // Read the persisted draft after the UI save has completed.
  await page.waitForFunction(
    () => !document.querySelector('.playlist-fields').inert,
  );
  const preview = await (
    await context.request.get(`${base}/api/preview/${playlist.id}`)
  ).json();
  assert.deepEqual(preview.transition, { type: 'fade', durationMs: 800 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.getByText('Playlists', { exact: true }).first().click();
  await page.getByText(playlist.name, { exact: true }).click();
  assert.equal(await selection.inputValue(), 'fade');
  assert.equal(await slider.inputValue(), '800');
  await selection.selectOption('slide-left');
  await selection.selectOption('slide-right');
  await selection.selectOption('cut');
  assert.equal(await editor.getByRole('slider').count(), 0);
  await page.close();

  // Real DOM, image decoding, widget activation and native browser animations.
  const player = await context.newPage();
  player.on('pageerror', (error) => errors.push(error.message));
  for (const [width, height, rotation] of [
    [1280, 720, 0],
    [390, 700, 0],
    [720, 1280, 90],
  ]) {
    await player.setViewportSize({ width, height });
    for (const type of ['fade', 'slide-left', 'slide-right']) {
      await player.goto(`${base}/transition-harness`);
      await player.evaluate(
        async ({ type, rotation }) => {
          const { prepareFrame, commitFrame } =
            await import('/player/frame.js');
          const host = document.querySelector('#stage');
          const layer = {
            x: 5,
            y: 5,
            width: 40,
            height: 15,
            color: '#202923',
            fontSize: 64,
            align: 'left',
            verticalAlign: 'middle',
            autoSize: true,
          };
          const item = (id, background) => ({
            duration: 5,
            slide: {
              id,
              width: 1920,
              height: 1080,
              background,
              layers: [
                { ...layer, id: 'text', type: 'text', text: 'OpenFrame' },
                {
                  ...layer,
                  id: 'clock',
                  type: 'clock',
                  y: 25,
                  clock: { hour12: false, showSeconds: true },
                },
                {
                  ...layer,
                  id: 'image',
                  type: 'image',
                  x: 60,
                  y: 5,
                  width: 30,
                  height: 40,
                  assetId: 'photo',
                  fit: 'cover',
                },
              ],
            },
          });
          const assets = [{ id: 'photo', url: '/fixture.png' }];
          const previous = await prepareFrame(
            host,
            item('white', '#ffffff'),
            assets,
            rotation,
            new AbortController().signal,
          );
          commitFrame(previous, null);
          const next = await prepareFrame(
            host,
            item('blue', '#4098d0'),
            assets,
            rotation,
            new AbortController().signal,
          );
          const effect = commitFrame(next, previous, {
            type,
            durationMs: 2000,
          });
          const animations = document.getAnimations();
          animations.forEach((animation) => {
            animation.pause();
            animation.currentTime = 1000;
          });
          window.fixture = { previous, next, effect, animations };
        },
        { type, rotation },
      );
      const state = await player.evaluate(() => ({
        frames: document.querySelectorAll('.slide-frame').length,
        decoded: [...document.images].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
        targets: document
          .getAnimations()
          .map((animation) => animation.effect.target.className),
        text: [...document.querySelectorAll('[data-layer-type="clock"]')].every(
          (element) => /\d{2}:\d{2}:\d{2}/.test(element.textContent),
        ),
      }));
      assert.equal(state.frames, 2);
      assert.ok(state.decoded && state.text);
      assert.deepEqual(
        state.targets,
        Array(type === 'fade' ? 1 : 2).fill('slide-frame'),
      );
      const screenshot = await player.screenshot({
        path: `work/transitions-${type}-${width}-${rotation}.png`,
      });
      if (width === 1280) {
        const { data, info } = await sharp(screenshot)
          .raw()
          .toBuffer({ resolveWithObject: true });
        const pixel = (x, y) => [
          ...data.subarray(
            (y * info.width + x) * info.channels,
            (y * info.width + x) * info.channels + 3,
          ),
        ];
        if (type === 'fade') {
          const mid = pixel(640, 600);
          assert.ok(
            Math.abs(mid[0] - 160) < 6 &&
              Math.abs(mid[1] - 204) < 6 &&
              Math.abs(mid[2] - 232) < 6,
            `fade midpoint: ${mid.join(',')}`,
          );
        } else {
          assert.deepEqual(
            pixel(200, 600),
            type === 'slide-left' ? [255, 255, 255] : [64, 152, 208],
          );
          assert.deepEqual(
            pixel(1080, 600),
            type === 'slide-left' ? [64, 152, 208] : [255, 255, 255],
          );
        }
      }
      await player.evaluate(async () => {
        fixture.animations.forEach((animation) => animation.finish());
        await fixture.effect.finished;
        fixture.previous.dispose();
      });
      assert.equal(await player.locator('.slide-frame').count(), 1);
      assert.equal(
        await player.evaluate(() => document.getAnimations().length),
        0,
      );
      await player.evaluate(() => fixture.next.dispose());
      assert.equal(await player.locator('.slide-frame').count(), 0);
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'Transition controls/persistence at 1280/390/320px, decoded photos + clock/text, native fade/slide animation pixel checks, portrait rotation, and effect/frame cleanup passed. No physical Pi tested.',
  );
} finally {
  close();
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
