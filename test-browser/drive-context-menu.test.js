// Right-click asks a row what can be done with it. The answer is the same
// menu its ⋮ opens, at the pointer, for the row or for the selection it is
// part of; the gap between rows answers for the folder, a pin for itself.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({
  agents: false,
  documents: {
    drive: await buildDrive(),
    garden: GARDEN,
    plan: GARDEN,
    'Papers/one': GARDEN,
    'Papers/deep/two': GARDEN,
  },
});
await host.drive.store.putFile('notes.txt', (async function* () { yield Buffer.from('plain words\n'); })());
test.after(() => host.close());

async function openDrive(viewport) {
  await host.reset();
  const { page, errors } = await host.newPage(viewport ? { viewport } : {});
  await page.goto(`${host.base}/a/drive`);
  await page.locator('#items .item[data-path="garden"]').waitFor();
  return { page, errors };
}

const row = (page, path) => page.locator(`#items .item[data-path="${path}"]`);
const labels = (page) =>
  page.locator('#menu > button').evaluateAll((els) => els.map((el) => el.firstChild.textContent.trim()));
const opened = (page) => page.locator('#menu[data-open="1"]').waitFor();

async function rightClick(page, locator, options = {}) {
  await locator.click({ button: 'right', ...options });
}

test('a document answers a right-click with its menu, at the pointer, and is picked', async () => {
  const { page, errors } = await openDrive();
  const name = row(page, 'garden').locator('.name');
  const box = await name.boundingBox();
  await rightClick(page, name, { position: { x: 10, y: 5 } });
  await opened(page);
  assert.deepEqual(await labels(page), [
    'Open in new tab', 'Rename…', 'Move to…', 'Make a copy', 'Pin to sidebar',
    'Copy link', 'Copy path', 'Download as .mrbl', 'Download as HTML', 'Move to trash',
  ]);
  const at = await page.locator('#menu').boundingBox();
  // Loose by a few pixels: the row is still settling from its entrance.
  assert.ok(Math.abs(at.x - (box.x + 10)) < 6 && Math.abs(at.y - (box.y + 5)) < 6, JSON.stringify({ at, box }));
  await row(page, 'garden').and(page.locator('.marble-picked')).waitFor();
  assert.deepEqual(errors.filter((e) => !e.includes('sandboxed')), []);
  await page.context().close();
});

test('a folder, a file and the trash each get their own verbs', async () => {
  const { page } = await openDrive();
  await rightClick(page, row(page, 'Papers').locator('.name'));
  await opened(page);
  const folder = await labels(page);
  assert.deepEqual(folder.slice(0, 2), ['Open', 'Open in new tab']);
  assert.ok(!folder.includes('Make a copy'));
  assert.ok(folder.includes('Pin to sidebar') && folder.includes('Move to trash'));

  // The only file here is a material, folded away until asked for.
  await page.keyboard.press('Escape');
  await page.locator('.mats-head').click();
  await rightClick(page, row(page, 'notes.txt'));
  await opened(page);
  const file = await labels(page);
  assert.equal(file[0], 'Open in new tab');
  assert.ok(file.includes('Download') && !file.includes('Pin to sidebar') && !file.includes('Make a copy'));

  await page.keyboard.press('Escape');
  await rightClick(page, row(page, 'plan').locator('.name'));
  await opened(page);
  await page.locator('#menu button', { hasText: 'Move to trash' }).click();
  await row(page, 'plan').waitFor({ state: 'detached' });
  await page.locator('#nav .nav-item[data-nav="trash"]').click();
  await rightClick(page, row(page, 'plan'));
  await opened(page);
  assert.deepEqual(await labels(page), ['Restore']);
  await page.locator('#menu button', { hasText: 'Restore' }).click();
  await page.locator('#toast[data-open="1"]', { hasText: 'Restored' }).waitFor();
  assert.ok((await host.drive.store.list({ recursive: true })).some((e) => e.path === 'plan'));
  await page.context().close();
});

test('right-clicking one of several picked rows speaks for all of them', async () => {
  const { page } = await openDrive();
  await row(page, 'garden').locator('.name').click();
  await row(page, 'Papers').locator('.name').click({ modifiers: ['Meta'] });
  await rightClick(page, row(page, 'Papers').locator('.name'));
  await opened(page);
  const bulk = await labels(page);
  assert.deepEqual(bulk.filter((l) => /\b2\b|1 in/.test(l)), [
    'Open 1 in new tabs', 'Move 2 to…', 'Copy 2 links', 'Download 2 as .zip', 'Download 2 as .zip of HTML', 'Move 2 to trash',
  ]);
  assert.equal(await page.locator('#items .item.marble-picked').count(), 2);

  // A row outside the selection becomes the selection.
  await page.keyboard.press('Escape');
  await rightClick(page, row(page, 'plan').locator('.name'));
  await opened(page);
  assert.equal(await page.locator('#items .item.marble-picked').count(), 1);
  assert.equal((await labels(page))[0], 'Open in new tab');
  await page.context().close();
});

test('the gap between rows answers for the folder, and a pin for itself', async () => {
  const { page } = await openDrive();
  const items = await page.locator('#items').boundingBox();
  await page.mouse.click(items.x + items.width - 20, items.y + items.height - 20, { button: 'right' });
  await opened(page);
  assert.deepEqual(await labels(page), ['New document…', 'New folder…', 'Select all', 'Copy link to this folder']);
  await page.locator('#menu button', { hasText: 'Select all' }).click();
  assert.equal(await page.locator('#items .item.marble-picked').count(), await page.locator('#items .item').count());
  await page.keyboard.press('Escape');

  await rightClick(page, row(page, 'garden').locator('.name'));
  await page.locator('#menu button', { hasText: 'Pin to sidebar' }).click();
  const pin = page.locator('#pins .pin[data-path="garden"]');
  await pin.waitFor();
  await rightClick(page, pin.locator('.ico'));
  await opened(page);
  assert.deepEqual(await labels(page), ['Open in new tab', 'Rename pin…', 'Copy link', 'Unpin from sidebar']);
  await page.locator('#menu button', { hasText: 'Unpin from sidebar' }).click();
  await pin.waitFor({ state: 'detached' });
  await page.context().close();
});

test('near the edges it flips to stay on screen', async () => {
  const { page } = await openDrive({ width: 900, height: 600 });
  const items = await page.locator('#items').boundingBox();
  const x = items.x + items.width - 6;
  const y = items.y + items.height - 6;
  await page.mouse.click(x, y, { button: 'right' });
  await opened(page);
  const box = await page.locator('#menu').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 900, JSON.stringify(box));
  assert.ok(box.y >= 0 && box.y + box.height <= 600, JSON.stringify(box));
  // Up and to the left of the pointer, its corner at the pointer.
  assert.ok(Math.abs(box.x + box.width - x) < 3 && Math.abs(box.y + box.height - y) < 3, JSON.stringify({ box, x, y }));
  await page.context().close();
});

test('the arrow keys walk it and Enter presses the item', async () => {
  const { page } = await openDrive();
  await rightClick(page, row(page, 'Papers').locator('.name'));
  await opened(page);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Open⏎');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Move to trash');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await row(page, 'Papers/one').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#/Papers');
  await page.context().close();
});

test('Shift+right-click is the browser’s menu, and a right press never lifts a row', async () => {
  const { page } = await openDrive();
  const prevented = page.evaluate(
    () => new Promise((resolve) => addEventListener('contextmenu', (e) => setTimeout(() => resolve(e.defaultPrevented)), { once: true })),
  );
  await rightClick(page, row(page, 'garden').locator('.name'), { modifiers: ['Shift'] });
  assert.equal(await prevented, false);
  assert.equal(await page.locator('#menu[data-open="1"]').count(), 0);

  const box = await row(page, 'garden').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + 120, box.y + 140, { steps: 5 });
  assert.equal(await page.locator('#ghost[data-open="1"]').count(), 0);
  assert.equal(await page.locator('#items .item.marble-lifting').count(), 0);
  await page.mouse.up({ button: 'right' });
  await page.context().close();
});
