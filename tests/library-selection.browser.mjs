import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.mjs';

process.env.COOKIE_SECURE = 'false';
const root = path.resolve(import.meta.dirname, '..');
const directory = mkdtempSync(path.join(os.tmpdir(), 'openframe-selection-'));
const instance = createApp({ dataDir: directory });
instance.app.use(express.static(path.join(root, 'dist')));
instance.app.get('/{*path}', (_req, res) =>
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
    executablePath:
      process.env.OPENFRAME_BROWSER_EXECUTABLE || '/usr/bin/chromium',
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  async function api(url, data) {
    const response = await context.request.post(base + url, { data });
    assert.ok(response.ok(), await response.text());
    return response.json();
  }
  await api('/api/setup', { password: 'selection-browser-test-password' });
  for (const name of ['Welcome', 'Announcements']) {
    const slide = await api('/api/slides', {
      name,
      width: 1920,
      height: 1080,
      layers: [],
    });
    await api('/api/playlists', {
      name,
      items: [{ slideId: slide.id, duration: 10 }],
    });
  }
  async function selectionAppearance(checkbox) {
    return checkbox.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      );
      const style = getComputedStyle(element);
      const icon = element.querySelector(
        '[data-slot="checkbox-indicator"] svg',
      );
      return {
        checked: element.getAttribute('aria-checked'),
        background: style.backgroundColor,
        stroke: icon ? getComputedStyle(icon).stroke : null,
        iconVisible:
          !!icon &&
          icon.getBoundingClientRect().width > 0 &&
          getComputedStyle(icon).visibility === 'visible',
      };
    });
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const kind of ['slides', 'playlists']) {
      await page.goto(
        `${base}/dashboard${kind === 'slides' ? '' : '/playlists'}`,
      );
      const first = page.getByRole('checkbox', {
        name: 'Select Welcome',
        exact: true,
      });
      const second = page.getByRole('checkbox', {
        name: 'Select Announcements',
        exact: true,
      });
      const unchecked = await selectionAppearance(first);
      await first.click();
      await page.getByText('1 selected', { exact: true }).waitFor();
      // Leave hover/focus so the persistent appearance is checked, too.
      await page.mouse.move(0, 0);
      await first.evaluate((element) => element.blur());
      await page.getByLabel(`Search ${kind}`, { exact: true }).fill('Welcome');
      const selected = await selectionAppearance(first);
      assert.equal(selected.checked, 'true');
      assert.equal(selected.iconVisible, true);
      assert.notEqual(
        selected.background,
        unchecked.background,
        `${kind} checked fill at ${width}px`,
      );
      assert.notEqual(
        selected.stroke,
        selected.background,
        `${kind} checkmark must contrast with fill at ${width}px`,
      );
      if (kind === 'slides') {
        for (const view of [
          'List view',
          'Small grid',
          'Medium grid',
          'Large grid',
        ]) {
          await page.getByRole('button', { name: view, exact: true }).click();
          const appearance = await selectionAppearance(first);
          assert.equal(appearance.checked, 'true');
          assert.equal(appearance.iconVisible, true);
          assert.equal(appearance.background, selected.background);
          assert.equal(appearance.stroke, selected.stroke);
        }
      }
      await page.getByLabel(`Search ${kind}`, { exact: true }).fill('');
      await second.click();
      await page.getByText('2 selected', { exact: true }).waitFor();
      assert.equal((await selectionAppearance(first)).checked, 'true');
      await first.press('Space');
      await page.getByText('1 selected', { exact: true }).waitFor();
      assert.equal((await selectionAppearance(first)).checked, 'false');
      await page
        .getByRole('button', { name: 'Clear selection', exact: true })
        .click();
      assert.equal((await selectionAppearance(second)).checked, 'false');
    }
  }
  console.log(
    'Library selection stays visible after blur and rerender; pointer, keyboard, multi-select and clear pass on desktop and phone.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
}
