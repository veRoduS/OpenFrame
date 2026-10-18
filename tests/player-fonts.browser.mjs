import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';

// Use a real locally installed font; never download fixtures or store font binaries.
const fontPath = [
  process.env.OPENFRAME_TEST_FONT,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/open-sans/OpenSans-Regular.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
].find((path) => path && existsSync(path));
assert.ok(fontPath, 'Set OPENFRAME_TEST_FONT to an installed TrueType font');
const font = readFileSync(fontPath);
const app = express();
app.get('/', (req, res) => res.type('html').send('<div id="stage"></div>'));
app.get('/media/:font', (req, res) => res.type('font/ttf').send(font));
app.use(
  express.static(fileURLToPath(new URL('../player/web', import.meta.url))),
);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
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
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const { prepareFrame, commitFrame } = await import('/frame.js');
    window.makeFrame = (id, signal = new AbortController().signal, path = id) =>
      prepareFrame(
        document.getElementById('stage'),
        {
          slide: {
            id,
            width: 800,
            height: 450,
            background: '#fff',
            layers: [
              {
                id: 'text',
                type: 'text',
                text: 'Custom font lifecycle',
                fontId: id,
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                fontSize: 48,
                color: '#000',
              },
            ],
          },
        },
        [{ id, kind: 'font', url: `/media/${path}.ttf` }],
        0,
        signal,
      );
    let current;
    for (let i = 0; i < 12; i++) {
      const next = await window.makeFrame(`font-${i}`);
      if (document.fonts.size !== (current ? 2 : 1))
        throw new Error('Unused fonts accumulated');
      commitFrame(next, current);
      current?.dispose();
      current = next;
      if (document.fonts.size !== 1)
        throw new Error('Outgoing font remained registered');
    }
    const prepared = await window.makeFrame('font-11');
    if (document.fonts.size !== 1) throw new Error('Shared font loaded twice');
    current.dispose();
    if (document.fonts.size !== 1)
      throw new Error('Prepared frame lost its shared font');
    prepared.dispose();
    if (document.fonts.size !== 0)
      throw new Error('Final font was not released');
  });

  let releaseRequest;
  const held = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  let requestSeen;
  const seen = new Promise((resolve) => {
    requestSeen = resolve;
  });
  await page.route('**/media/delayed.ttf', async (route) => {
    requestSeen();
    await held;
    await route.fulfill({ contentType: 'font/ttf', body: font });
  });
  await page.evaluate(() => {
    // Observe real FontFace completion after cancellation without replacing loading.
    const { value: load } = Object.getOwnPropertyDescriptor(
      FontFace.prototype,
      'load',
    );
    window.completedFontLoads = 0;
    FontFace.prototype.load = function () {
      return load.call(this).finally(() => {
        window.completedFontLoads++;
      });
    };
    window.cancelFont = new AbortController();
    window.cancelledFrame = window
      .makeFrame('race', window.cancelFont.signal, 'delayed')
      .then(
        () => 'unexpected success',
        (error) => error.name,
      );
  });
  await seen;
  assert.equal(
    await page.evaluate(async () => {
      window.cancelFont.abort();
      return window.cancelledFrame;
    }),
    'AbortError',
  );
  await page.evaluate(async () => {
    window.replacement = await window.makeFrame('race');
  });
  releaseRequest();
  await page.waitForFunction(() => window.completedFontLoads === 2);
  assert.equal(await page.evaluate(() => document.fonts.size), 1);
  await page.evaluate(() => window.replacement.dispose());
  assert.equal(await page.evaluate(() => document.fonts.size), 0);
  assert.equal(await page.locator('.slide-frame').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'Player font lifecycle passed: revision churn, shared frames, cancelled late completion.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
