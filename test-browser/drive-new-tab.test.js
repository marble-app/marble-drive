// Documents and files open in a tab of their own; the Drive stays the tab you
// come back to. Folders are still somewhere you go, in place. A document you
// just made is the one exception: that is where you meant to go next.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({
  agents: false,
  documents: { drive: await buildDrive(), garden: GARDEN, 'Papers/one': GARDEN },
});
await host.drive.store.putFile('Papers/notes.txt', (async function* () { yield Buffer.from('plain words\n'); })());
test.after(() => host.close());

async function openDrive() {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/drive`);
  await page.locator('#items .item[data-path="garden"]').waitFor();
  return page;
}

const DRIVE = () => `${host.base}/a/drive`;

async function opensInNewTab(page, act, pattern) {
  const was = page.url();
  const [popup] = await Promise.all([page.waitForEvent('popup'), act()]);
  await popup.waitForLoadState('domcontentloaded');
  assert.match(decodeURIComponent(popup.url()), pattern);
  await popup.close();
  assert.equal(page.url(), was, 'the Drive tab stayed where it was');
}

test('a double-click opens a document in a new tab, and Enter does too', async () => {
  const page = await openDrive();
  const garden = page.locator('#items .item[data-path="garden"] .name');
  await opensInNewTab(page, () => garden.dblclick(), /\/a\/garden/);
  await garden.click();
  await opensInNewTab(page, () => page.keyboard.press('Enter'), /\/a\/garden/);
  await page.context().close();
});

test('a file opens in a new tab too, and a folder still opens in place', async () => {
  const page = await openDrive();
  await page.locator('#items .item[data-path="Papers"] .name').dblclick();
  await page.locator('#items .item[data-path="Papers/one"]').waitFor();
  assert.equal(page.url(), DRIVE() + '#/Papers');
  // The only file in there is a material, folded away until asked for.
  await page.locator('.mats-head').click();
  await opensInNewTab(page, () => page.locator('#items .item[data-path="Papers/notes.txt"]').dblclick(), /notes\.txt/);
  assert.equal(page.url(), DRIVE() + '#/Papers');
  await page.context().close();
});

test('a pin opens its document in a new tab from its button and on a double-click', async () => {
  const page = await openDrive();
  await page.locator('#items .item[data-path="garden"] .more').click();
  await page.locator('#menu button', { hasText: 'Pin to sidebar' }).click();
  const pin = page.locator('#pins .pin[data-path="garden"]');
  await pin.waitFor();
  await opensInNewTab(page, () => pin.locator('.pin-open').click(), /\/a\/garden/);
  await opensInNewTab(page, () => pin.locator('.ico').dblclick(), /\/a\/garden/);
  await page.context().close();
});

test('the menu’s first verb for a document is Open in new tab, and Enter’s', async () => {
  const page = await openDrive();
  await page.locator('#items .item[data-path="garden"] .name').click({ button: 'right' });
  const first = page.locator('#menu > button').first();
  assert.equal(await first.textContent(), 'Open in new tab⏎');
  await opensInNewTab(page, () => first.click(), /\/a\/garden/);
  await page.context().close();
});
