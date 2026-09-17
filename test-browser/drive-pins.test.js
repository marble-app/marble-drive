import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({
  agents: false,
  documents: {
    drive: await buildDrive(),
    garden: GARDEN,
  },
});
test.after(() => host.close());

async function openDrive() {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/drive`);
  await page.locator('#items .item[data-path="garden"]').waitFor();
  return page;
}

async function pinGarden(page) {
  await page.locator('#items .item[data-path="garden"] .more').click();
  await page.locator('#menu button', { hasText: 'Pin to sidebar' }).click();
  await page.locator('#pins .pin[data-path="garden"]').waitFor();
}

test('a pinned document has an Open in new tab button', async () => {
  const page = await openDrive();
  await pinGarden(page);
  const label = await page.locator('#pins .pin[data-path="garden"] .pin-open').getAttribute('aria-label');
  assert.equal(label, 'Open in new tab');
});

test('one click of a pin’s Open button opens the document in a new tab', async () => {
  const page = await openDrive();
  await pinGarden(page);
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#pins .pin[data-path="garden"] .pin-open').click();
  const popup = await popupPromise;
  await popup.waitForFunction(() => document.querySelector('h1')?.textContent === 'Research Garden');
  assert.match(popup.url(), /garden/);
  assert.equal(page.url(), `${host.base}/a/drive`);
});
