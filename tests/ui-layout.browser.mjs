import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = path.resolve(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-layout-'));
const instance = createApp({ dataDir: dir });
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
    executablePath:
      process.env.OPENFRAME_BROWSER_EXECUTABLE || '/usr/bin/chromium',
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function api(url, method = 'GET', data) {
    const response = await page.request.fetch(base + url, { method, data });
    assert.ok(response.ok(), `${url}: ${await response.text()}`);
    return response.json();
  }
  await api('/api/setup', 'POST', { password: 'layout-test-password' });
  const parent = await api('/api/groups', 'POST', {
    name: 'Regional communications',
  });
  const groups = [parent];
  for (let i = 1; i < 30; i++)
    groups.push(
      await api('/api/groups', 'POST', {
        name: `Store ${i} — Safety and associate communications`,
        parentId: parent.id,
      }),
    );
  const user = (
    await api('/api/users', 'POST', {
      name: 'Jordan Taylor',
      username: 'jordan.layout',
    })
  ).user;
  const slide = await api('/api/slides', 'POST', {
    name: 'October associate appreciation and community volunteering schedule',
    width: 1920,
    height: 1080,
    background: '#ffffff',
    layers: [],
  });
  for (const group of groups)
    await api(`/api/access/slide/${slide.id}`, 'POST', { groupId: group.id });
  await api(`/api/access/slide/${slide.id}`, 'POST', { userId: user.id });
  const folders = [];
  for (const name of [
    'Store communications',
    'Associate safety and training',
    'Seasonal lifting guidelines',
  ])
    folders.push(
      await api('/api/folders', 'POST', {
        name,
        parentId: folders.at(-1)?.id || null,
      }),
    );
  const assets = [];
  for (const [i, name] of [
    'Produce-department-flyer.png',
    'Associate-breakroom-schedule-final-approved-v3.png',
    'Welcome-to-the-team-October-2026.png',
    'Quarterly-review.png',
  ].entries()) {
    const buffer = await sharp({
      create: {
        width: 900,
        height: i % 2 ? 400 : 600,
        channels: 3,
        background: ['#876653', '#557768', '#31585f', '#ab8649'][i],
      },
    })
      .png()
      .toBuffer();
    const response = await page.request.post(base + '/api/assets', {
      multipart: { file: { name, mimeType: 'image/png', buffer } },
    });
    assert.equal(response.status(), 201);
    const asset = await response.json();
    await api(`/api/assets/${asset.id}`, 'PATCH', {
      folderId: folders[2].id,
      tags: i === 2 ? ['safety', 'team-communications', 'october-2026'] : [],
    });
    assets.push(asset);
  }
  for (const group of groups.slice(0, 4))
    await api(`/api/access/asset/${assets[2].id}`, 'POST', {
      groupId: group.id,
    });
  await page.goto(base + '/dashboard');
  const card = page.locator('.slide-card').first();
  await card.waitFor();
  assert.equal(await card.locator('.access-tag').count(), 2);
  await card
    .locator('.access-tag.user')
    .getByText('User: Jordan Taylor', { exact: true })
    .waitFor();
  await card
    .getByRole('button', {
      name: `Show all 31 access grants for ${slide.name}`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('region', { name: 'Existing group access' }).waitFor();
  assert.equal(await dialog.locator('.access-grant-row').count(), 31);
  await dialog
    .getByRole('region', { name: 'Existing user access' })
    .getByText(user.name, { exact: true })
    .waitFor();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const grant = await dialog
      .getByRole('button', { name: 'Grant user access', exact: true })
      .boundingBox();
    assert.ok(
      grant.y >= 0 && grant.y + grant.height <= 844,
      `Grant controls visible at ${width}px`,
    );
    assert.ok(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    );
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByLabel('Group', { exact: true }).selectOption(groups[1].id);
    await page
      .getByRole('button', { name: 'Filters (1)', exact: true })
      .click();
    assert.equal(
      await page.getByLabel('Group', { exact: true }).isVisible(),
      false,
    );
    await page
      .getByRole('button', { name: 'Clear filters', exact: true })
      .click();
    const bounds = await card.boundingBox();
    assert.ok(
      bounds.y + bounds.height < 844,
      `Complete result visible at ${width}px: ${JSON.stringify(bounds)}`,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('button', { name: /^Media/ })
    .first()
    .click();
  const nav = page.getByRole('navigation', { name: 'Media folders' });
  await nav
    .getByRole('button', { name: 'Collapse Store communications', exact: true })
    .click();
  assert.equal(
    await nav
      .getByRole('button', {
        name: 'Associate safety and training 0',
        exact: true,
      })
      .count(),
    0,
  );
  await nav
    .getByRole('button', { name: 'Expand Store communications', exact: true })
    .click();
  await nav
    .getByRole('button', { name: 'Seasonal lifting guidelines 4', exact: true })
    .click();
  await page
    .getByText(
      'Store communications / Associate safety and training / Seasonal lifting guidelines',
      { exact: true },
    )
    .first()
    .waitFor();
  async function checkFooters() {
    const positions = await page.locator('.media-entry').evaluateAll((nodes) =>
      nodes.map((node) => {
        const card = node.getBoundingClientRect();
        const action = node
          .querySelector('.manage-access-button')
          .getBoundingClientRect();
        return { top: card.top, action: action.top };
      }),
    );
    for (const row of positions)
      for (const other of positions.filter(
        (item) => Math.abs(item.top - row.top) < 1,
      ))
        assert.ok(
          Math.abs(row.action - other.action) < 1,
          JSON.stringify(positions),
        );
  }
  await checkFooters();
  mkdirSync(path.join(root, 'work/ui-review/after'), { recursive: true });
  await page.screenshot({
    path: path.join(root, 'work/ui-review/after/media-desktop.png'),
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await nav.isVisible(), false);
    await page.screenshot({
      path: path.join(root, `work/ui-review/after/media-folder-${width}.png`),
      fullPage: true,
    });
    const entry = await page.locator('.media-entry').first().boundingBox();
    assert.ok(
      entry.y + entry.height <= 844,
      `Complete media result at ${width}px: ${JSON.stringify(entry)}`,
    );
    await checkFooters();
    await page
      .getByRole('button', {
        name: /^Choose media folder:/,
      })
      .click();
    await nav.getByRole('button', { name: 'All media 4', exact: true }).click();
    assert.equal(await nav.isVisible(), false);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page
      .getByLabel('Filter by tag', { exact: true })
      .selectOption('safety');
    assert.equal(await page.locator('.media-entry').count(), 1);
    await page
      .getByRole('button', { name: 'Clear filters', exact: true })
      .click();
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    assert.equal(await page.locator('.media-entry').count(), 4);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(root, `work/ui-review/after/media-${width}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'UI layout passed: 31 access grants, direct-user summary, accessible sharing controls, compact mobile filters, complete first results, collapsible folders, tag filtering and aligned media footers.',
  );
} finally {
  await browser?.close();
  instance.close();
  await new Promise((resolve) => server.close(resolve));
  instance.db.close();
  rmSync(dir, { recursive: true, force: true });
}
