import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = path.resolve(import.meta.dirname, '..');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'openframe-font-settings-'));
const { app, db, seedInitialAdmin, close } = createApp({ dataDir });
const credentials = seedInitialAdmin();
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (_, res) =>
  res.sendFile(path.join(root, 'dist/index.html')),
);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;

function addFont(id, family) {
  db.prepare(
    'INSERT INTO custom_fonts (id,family,filename,format,bytes,sha256) VALUES (?,?,?,?,?,?)',
  ).run(id, family, `${id}.woff`, 'woff', 4, 'test');
}

try {
  const oldId = randomUUID();
  addFont(oldId, 'Race Font');
  const { chromium } = await import(
    process.env.OPENFRAME_PLAYWRIGHT || 'playwright'
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.OPENFRAME_BROWSER_EXECUTABLE
      ? { executablePath: process.env.OPENFRAME_BROWSER_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const faces = new Set();
    const loads = [];
    window.__fontLoads = loads;
    window.FontFace = class DeferredFontFace {
      constructor(family, source) {
        this.family = family;
        this.source = source;
      }
      load() {
        return new Promise((resolve) =>
          loads.push({ face: this, resolve: () => resolve(this) }),
        );
      }
    };
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        [Symbol.iterator]: () => faces[Symbol.iterator](),
        add(face) {
          faces.add(face);
          return this;
        },
        delete(face) {
          return faces.delete(face);
        },
      },
    });
  });
  const login = await page.request.post(`${base}/api/login`, {
    data: { username: credentials.username, password: credentials.password },
  });
  assert.equal(login.status(), 200);
  await page.goto(`${base}/dashboard`);
  await page.getByRole('button', { name: 'New slide', exact: true }).waitFor();
  await page.waitForFunction(() => window.__fontLoads.length === 1);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Remove Race Font', exact: true })
    .click();
  await page.getByText('No custom fonts have been added.').waitFor();
  await page.evaluate(() => window.__fontLoads[0].resolve());
  await page.waitForTimeout(30);
  assert.deepEqual(
    await page.evaluate(() => [...document.fonts].map((face) => face.family)),
    [],
    'a pending load must not restore a deleted font',
  );

  await page.getByLabel('Font name').fill('Race Font');
  await page.getByLabel('Font file').setInputFiles({
    name: 'race.woff',
    mimeType: 'font/woff',
    buffer: Buffer.from('wOFF0000'),
  });
  await page.getByRole('button', { name: 'Add font', exact: true }).click();
  await page
    .getByText('Font added. It is ready to use in slide typography.')
    .waitFor();
  await page.waitForFunction(() => window.__fontLoads.length === 2);
  await page.evaluate(() => window.__fontLoads[1].resolve());
  await page.waitForFunction(() => [...document.fonts].length === 1);
  const newId = db
    .prepare('SELECT id FROM custom_fonts WHERE family=?')
    .get('Race Font').id;
  assert.equal(
    await page.evaluate(() => [...document.fonts][0].family),
    `OpenFrameFont_${newId.replaceAll('-', '')}`,
  );
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.close();
  close();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(
  'Font settings browser checks passed: stale pending font loads are ignored after deletion and re-addition.',
);
