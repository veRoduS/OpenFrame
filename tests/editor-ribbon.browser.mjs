import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.mjs';
const directory = mkdtempSync(path.join(os.tmpdir(), 'of-ribbon-'));
const instance = createApp({ dataDir: directory });
instance.app.use(express.static(path.resolve('dist')));
instance.app.get('/{*path}', (_req, res) =>
  res.sendFile(path.resolve('dist/index.html')),
);
const server = instance.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const origin = `http://127.0.0.1:${server.address().port}`;
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await context.request.post(`${origin}/api/setup`, {
    data: { password: 'ribbon-test-password' },
  });
  const site = await (
    await context.request.post(`${origin}/api/sites`, {
      data: { siteNumber: '10', name: 'Demo store' },
    })
  ).json();
  const feed = await (
    await context.request.post(`${origin}/api/data-feeds`, {
      data: {
        name: 'Safety',
        siteId: site.id,
        fields: [{ key: 'AccidentFreeDays', type: 'number' }],
      },
    })
  ).json();
  const key = await (
    await context.request.post(`${origin}/api/data-feeds/${feed.id}/tokens`, {
      data: { name: 'Demo key' },
    })
  ).json();
  const pushed = await context.request.put(
    `${origin}/api/data-feeds/${feed.id}/data`,
    {
      headers: { Authorization: `Bearer ${key.token}` },
      data: { AccidentFreeDays: 42 },
    },
  );
  assert.equal(pushed.status(), 200);
  await page.goto(`${origin}/dashboard`);
  await page.getByRole('button', { name: 'New slide', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal((await context.request.get(`${origin}/api/library`)).ok(), true);
  assert.equal(
    (await (await context.request.get(`${origin}/api/library`)).json()).slides
      .length,
    0,
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Save slide', exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole('button', { name: 'Back to slides', exact: true })
    .click();
  await page.getByRole('button', { name: 'New slide', exact: true }).click();
  await page.getByLabel('Slide name', { exact: true }).fill('Portrait welcome');
  await page
    .getByLabel('Slide orientation', { exact: true })
    .selectOption('portrait');
  await page.getByLabel('Toolbar font size', { exact: true }).fill('88');
  await page.getByRole('button', { name: 'Italic', exact: true }).click();
  // Text-field deletion must not remove a selected layer.
  const name = page.getByLabel('Slide name', { exact: true });
  await name.focus();
  await name.press('Delete');
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  let slides = (
    await (await context.request.get(`${origin}/api/library`)).json()
  ).slides;
  assert.equal(slides.length, 1);
  assert.equal(slides[0].width, 1080);
  assert.equal(slides[0].layers[0].fontSize, 88);
  assert.equal(slides[0].layers[0].italic, true);
  await page.getByRole('button', { name: 'Text box', exact: true }).click();
  const canvas = page.getByRole('region', { name: 'Slide canvas' });
  // The dialog owns keyboard shortcuts; focus a non-input control before Delete.
  await page.getByRole('button', { name: 'Text box', exact: true }).focus();
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  slides = (await (await context.request.get(`${origin}/api/library`)).json())
    .slides;
  assert.equal(slides[0].layers.length, 1);
  await page.locator('.layer-list button').first().click();
  await page
    .getByLabel('Text metric', { exact: true })
    .selectOption(`${feed.id}|AccidentFreeDays`);
  await page
    .getByLabel('Text content', { exact: true })
    .fill('We are <AccidentFreeDays> days accident free.');
  await page
    .locator('.canvas-holder')
    .getByText('We are 42 days accident free.', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Save slide', exact: true }).click();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  mkdirSync('work/editor-ribbon', { recursive: true });
  await page.screenshot({
    path: 'work/editor-ribbon/desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'work/editor-ribbon/mobile.png',
    fullPage: true,
  });
  assert.ok(await canvas.count());
  await page
    .getByRole('button', { name: 'Back to slides', exact: true })
    .click();
  await page.goto(`${origin}/dashboard/settings`);
  await page
    .getByRole('heading', { name: 'Audit & history', exact: true })
    .waitFor();
  await page.getByLabel('Resource type', { exact: true }).fill('slide');
  await page
    .getByRole('button', { name: 'Review', exact: true })
    .first()
    .click();
  await page.getByRole('dialog').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Editor ribbon: drafts, portrait, formatting, Delete, responsive layouts and audit review passed.',
  );
} finally {
  await browser?.close();
  instance.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
}
