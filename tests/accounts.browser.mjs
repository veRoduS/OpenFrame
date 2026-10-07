import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from '../server/app.mjs';

delete process.env.PUBLIC_URL;
process.env.COOKIE_SECURE = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(path.join(os.tmpdir(), 'openframe-accounts-browser-'));
const { app, db, close } = createApp({ dataDir: dir });
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (req, res) =>
  res.sendFile(path.join(root, 'dist/index.html')),
);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
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
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/login`);
  await page.getByLabel('Password', { exact: true }).fill('browser8');
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await page.getByRole('button', { name: 'Users & Groups' }).click();
  const accountTabs = page.getByRole('tablist', { name: 'Account settings' });
  await accountTabs.getByRole('tab', { name: 'Groups', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await accountTabs
      .getByRole('tab', { name: 'Users', exact: true })
      .getAttribute('aria-selected'),
    'true',
  );
  await page.keyboard.press('End');
  assert.equal(
    await accountTabs
      .getByRole('tab', { name: 'My password', exact: true })
      .getAttribute('aria-selected'),
    'true',
  );
  await page.keyboard.press('Home');
  assert.equal(await accountTabs.locator('[tabindex="0"]').count(), 1);
  const activeTab = accountTabs.getByRole('tab', {
    name: 'Groups',
    exact: true,
  });
  assert.equal(await activeTab.getAttribute('aria-selected'), 'true');
  assert.equal(
    await page.getByRole('tabpanel').getAttribute('id'),
    await activeTab.getAttribute('aria-controls'),
  );
  assert.equal(
    await page.getByLabel('Join a group', { exact: true }).count(),
    0,
  );
  await page.getByLabel('New group', { exact: true }).fill('Campus displays');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await page.getByRole('heading', { name: 'Campus displays' }).waitFor();
  await page.getByRole('tab', { name: 'Users', exact: true }).click();
  await page.getByLabel('Full name').fill('Jordan Taylor');
  await page.getByLabel('Username', { exact: true }).fill('jordan');
  await page.getByRole('button', { name: 'Add user', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  const credentials = page.getByRole('dialog');
  await credentials
    .getByRole('heading', { name: 'User created', exact: true })
    .waitFor();
  const generatedPassword = await credentials
    .getByLabel('Generated password', { exact: true })
    .inputValue();
  assert.match(generatedPassword, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(
    await credentials.getByLabel('Username', { exact: true }).inputValue(),
    'jordan',
  );
  await credentials.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByText('Jordan Taylor', { exact: true }).waitFor();
  mkdirSync(path.join(root, 'work'), { recursive: true });
  await page.screenshot({
    path: path.join(root, 'work/accounts-users-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('tab', { name: 'Groups', exact: true }).click();
  await page.getByRole('button', { name: 'Invite member' }).click();
  assert.ok(
    (await page.getByLabel('Invitation code', { exact: true }).inputValue())
      .length > 0,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(root, 'work/accounts-groups-mobile.png'),
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const created = await page.request.post(`${base}/api/slides`, {
    data: {
      name: 'Campus welcome',
      width: 1920,
      height: 1080,
      background: '#ffffff',
      layers: [],
    },
  });
  assert.equal(created.status(), 201);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.getByRole('button', { name: 'Users & Groups' }).click();
  assert.equal(
    await page
      .getByRole('tab', { name: 'Sharing & assignments', exact: true })
      .count(),
    0,
  );
  await page
    .getByRole('button', { name: /^Slides/ })
    .first()
    .click();
  await page
    .getByRole('button', {
      name: 'Manage access to Campus welcome',
      exact: true,
    })
    .click();
  await page
    .getByLabel('Groups', { exact: true })
    .selectOption({ label: 'Campus displays' });
  await page.getByRole('button', { name: 'Grant group access' }).click();
  await page.getByRole('button', { name: /^Remove access/ }).waitFor();
  await page
    .getByLabel('Users', { exact: true })
    .selectOption({ label: 'Jordan Taylor (jordan)' });
  await page
    .getByRole('button', { name: 'Grant user access', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByText('Jordan Taylor', { exact: true })
    .waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page
    .getByRole('button', { name: /^Slides/ })
    .first()
    .click();
  await page
    .getByRole('button', {
      name: 'Manage access to Campus welcome',
      exact: true,
    })
    .hover();
  await page
    .locator('[data-slot="tooltip-content"]')
    .getByText('Group: Campus displays', { exact: true })
    .waitFor();
  await page
    .locator('[data-slot="tooltip-content"]')
    .getByText('User: Jordan Taylor', { exact: true })
    .waitFor();
  await page.mouse.move(0, 0);
  const member = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await member.goto(`${base}/login`);
  await member.getByLabel('Username', { exact: true }).fill('jordan');
  await member.getByLabel('Password', { exact: true }).fill(generatedPassword);
  await member.getByRole('button', { name: 'Sign in', exact: true }).click();
  await member.getByRole('heading', { name: 'Slides', exact: true }).waitFor();
  assert.equal(
    await member
      .getByRole('button', { name: 'Users & Groups', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await member.getByRole('button', { name: 'Settings', exact: true }).count(),
    0,
  );
  await member.goto(`${base}/dashboard/settings`);
  await member.waitForURL(`${base}/dashboard`);
  await member.getByRole('heading', { name: 'Slides', exact: true }).waitFor();
  assert.equal(
    await member
      .getByRole('heading', { name: /^(Data feeds|Stock quotes|Fonts)$/ })
      .count(),
    0,
  );
  await member.setViewportSize({ width: 390, height: 844 });
  await member
    .getByRole('button', { name: 'Toggle Sidebar', exact: true })
    .click();
  assert.equal(
    await member.getByRole('button', { name: 'Settings', exact: true }).count(),
    0,
  );
  await member.keyboard.press('Escape');
  await member.setViewportSize({ width: 1280, height: 900 });
  assert.equal((await member.request.get(`${base}/api/users`)).status(), 403);
  assert.equal(
    await member
      .getByRole('button', { name: 'Create group', exact: true })
      .count(),
    0,
  );
  assert.ok((await member.locator('.logged-in-user').innerText()).length > 0);
  const shared = await member.request.get(`${base}/api/library`);
  assert.equal((await shared.json()).slides[0].name, 'Campus welcome');
  assert.equal(
    await member.getByRole('button', { name: 'Invite member' }).count(),
    0,
  );
  await member
    .getByRole('button', { name: 'My password', exact: true })
    .click();
  await member
    .getByLabel('Current password', { exact: true })
    .fill(generatedPassword);
  await member
    .getByLabel('New password', { exact: true })
    .fill('changed-password-long-enough');
  await member
    .getByLabel('Confirm new password')
    .fill('changed-password-long-enough');
  await member
    .getByRole('button', { name: 'Change password', exact: true })
    .click();
  await member
    .getByText('Password changed. Other sessions have been signed out.')
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Accounts browser checks passed: generated credentials, immediate login, admin-only navigation, password resets and self-service password changes.',
  );
} finally {
  await browser?.close();
  close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
