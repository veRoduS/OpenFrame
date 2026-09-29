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
    ...(process.env.OPENFRAME_BROWSER_CHANNEL
      ? { channel: process.env.OPENFRAME_BROWSER_CHANNEL }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page
    .getByLabel('Password', { exact: true })
    .fill('browser-password-long-enough');
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await page.getByRole('button', { name: 'Users & Groups' }).click();
  await page.getByLabel('New group', { exact: true }).fill('Campus displays');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await page.getByRole('heading', { name: 'Campus displays' }).waitFor();
  await page.getByRole('tab', { name: 'Users', exact: true }).click();
  await page.getByLabel('Full name').fill('Jordan Taylor');
  await page.getByLabel('Username', { exact: true }).fill('jordan');
  await page.getByRole('button', { name: 'Invite user', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  const invitation = await page.getByLabel('Set-password link').inputValue();
  assert.ok(invitation.includes('#activate='));
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByText('Jordan Taylor', { exact: true }).waitFor();
  mkdirSync(path.join(root, 'work'), { recursive: true });
  await page.screenshot({
    path: path.join(root, 'work/accounts-users-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('tab', { name: 'Groups', exact: true }).click();
  await page.getByRole('button', { name: 'Invite member' }).click();
  const code = await page
    .getByLabel('Invitation code', { exact: true })
    .inputValue();
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
  await page.getByRole('tab', { name: 'Sharing & assignments' }).click();
  await page.getByLabel('Resource', { exact: true }).selectOption('slide');
  await page.getByRole('button', { name: 'Access', exact: true }).click();
  await page
    .getByLabel('Share with')
    .selectOption({ label: 'Campus displays (group)' });
  await page.getByRole('button', { name: 'Grant access' }).click();
  await page.getByRole('button', { name: 'Remove access' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const member = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await member.goto(invitation);
  await member
    .getByLabel('Password', { exact: true })
    .fill('member-password-long-enough');
  await member
    .getByLabel('Confirm password')
    .fill('member-password-long-enough');
  await member.getByRole('button', { name: 'Set password & sign in' }).click();
  await member.getByRole('button', { name: 'Users & Groups' }).click();
  assert.equal(
    await member.getByRole('tab', { name: 'Users', exact: true }).count(),
    0,
  );
  await member.getByLabel('Join a group', { exact: true }).fill(code);
  await member.getByRole('button', { name: 'Join', exact: true }).click();
  await member.getByRole('heading', { name: 'Campus displays' }).waitFor();
  const shared = await member.request.get(`${base}/api/library`);
  assert.equal((await shared.json()).slides[0].name, 'Campus welcome');
  assert.equal(
    await member.getByRole('button', { name: 'Invite member' }).count(),
    0,
  );
  await member.getByRole('tab', { name: 'My password' }).click();
  await member
    .getByLabel('Current password', { exact: true })
    .fill('member-password-long-enough');
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
    'Accounts browser checks passed: invitations, groups, passwords, desktop and mobile.',
  );
} finally {
  await browser?.close();
  close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
