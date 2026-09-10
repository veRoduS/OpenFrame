import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

// Optional browser regression: API responses are isolated fixtures, never real writes.
const { chromium } = await import(
  process.env.OPENFRAME_PLAYWRIGHT || 'playwright'
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.OPENFRAME_BROWSER_CHANNEL
    ? { channel: process.env.OPENFRAME_BROWSER_CHANNEL }
    : {}),
});
mkdirSync('work', { recursive: true });
try {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(5000);
    const names = [
      'Welcome',
      'Opening hours and upcoming announcements',
      'Weekend events',
    ];
    const slides = names.map((name, index) => ({
      id: `slide-${index}`,
      name,
      width: 1920,
      height: 1080,
      background: ['#e0eaf4', '#e3f0e8', '#f3e5eb'][index],
      layers: [],
    }));
    let playlist = {
      id: 'playlist',
      name: 'Picker regression',
      items: [
        { slideId: slides[0].id, duration: 10 },
        { slideId: slides[0].id, duration: 20 },
      ],
    };
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      let data;
      if (path === '/api/auth') data = { setup: false, authenticated: true };
      else if (path === '/api/library')
        data = {
          slides,
          playlists: [playlist],
          assets: [],
          devices: [],
          folders: [],
        };
      else if (
        path === '/api/playlists/playlist' &&
        request.method() === 'PUT'
      ) {
        playlist = { ...request.postDataJSON(), id: 'playlist' };
        data = playlist;
      } else return route.abort();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(data),
      });
    });
    await page.goto(process.env.OPENFRAME_URL || 'http://127.0.0.1:3100/');
    await page.getByText('Playlists', { exact: true }).first().click();
    await page.getByText(playlist.name, { exact: true }).click();
    const editor = page.locator('.of-modal.wide');
    await editor.waitFor();
    await page.setViewportSize({ width, height: 900 });
    await editor.getByRole('tab', { name: 'Add slides', exact: true }).click();
    const card = (index) => page.locator('.add-slide-grid > button').nth(index);
    const count = async (expected) =>
      assert.equal(
        await editor
          .getByRole('tab', {
            name: `Sequence (${expected})`,
            exact: true,
            includeHidden: true,
          })
          .count(),
        1,
      );
    assert.match(await card(0).innerText(), /In playlist \(2\)/);
    assert.match(await card(1).innerText(), /Not added/);

    await card(0).click();
    const confirmation = page.getByRole('alertdialog', {
      name: 'Add this slide again?',
    });
    await confirmation.waitFor();
    await count(2);
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await confirmation.waitFor({ state: 'hidden' });
    await count(2);

    await card(1).click();
    await count(3);
    assert.match(await card(1).innerText(), /In playlist/);
    assert.equal(await confirmation.count(), 0);

    // A quick double-click can add once, but must confirm the second entry.
    await card(2).dblclick();
    await confirmation.waitFor();
    await count(4);
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await confirmation.waitFor({ state: 'hidden' });

    await card(0).click();
    await confirmation
      .getByRole('button', { name: 'Add another copy', exact: true })
      .click();
    await confirmation.waitFor({ state: 'hidden' });
    await count(5);
    assert.match(await card(0).innerText(), /In playlist \(3\)/);
    await card(0).click();
    await confirmation.waitFor();
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await confirmation.waitFor({ state: 'hidden' });
    await count(5);

    const overflow = await page
      .locator('.add-slide-grid > button')
      .evaluateAll((buttons) =>
        buttons.some((button) => {
          const b = button.getBoundingClientRect();
          return [
            ...button.querySelectorAll('.add-slide-info, .add-slide-status'),
          ].some((child) => {
            const c = child.getBoundingClientRect();
            return c.left < b.left || c.right > b.right || c.bottom > b.bottom;
          });
        }),
      );
    assert.equal(overflow, false);
    await page.screenshot({ path: `work/playlist-picker-${width}.png` });

    await editor
      .getByRole('tab', { name: 'Sequence (5)', exact: true })
      .click();
    await editor
      .getByRole('button', { name: 'Remove slide 3', exact: true })
      .click();
    await editor.getByRole('tab', { name: 'Add slides', exact: true }).click();
    assert.match(await card(1).innerText(), /Not added/);
    await card(1).click();
    await count(5);
    assert.equal(await confirmation.count(), 0);
    await editor
      .getByRole('button', { name: 'Save draft', exact: true })
      .click();
    await editor.getByText('Playlist saved.', { exact: true }).waitFor();
    assert.equal(playlist.items.length, 5);
    assert.equal(
      playlist.items.filter((item) => item.slideId === slides[0].id).length,
      3,
    );
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'hidden' });
    await page.getByText(playlist.name, { exact: true }).click();
    await editor.getByRole('tab', { name: 'Add slides', exact: true }).click();
    assert.match(await card(0).innerText(), /In playlist \(3\)/);
    await card(0).click();
    await confirmation.waitFor();
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    console.log(
      `${width}px: indicators, cancel, confirmation, double-click, removal, and save/reopen passed`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
