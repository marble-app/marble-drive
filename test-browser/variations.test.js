// Variations: the pill on an element that has more than one version, and the
// surface for comparing them. The thing to keep honest is that a variation is
// a real `<marble-alt>` child in the document — so switching one is an op that
// records, undoes and reaches the file, and keeping one leaves the element
// answering to the id it always had.
import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const STUDIO = `<!doctype html>
<html><head><meta charset="utf-8"><title>Studio</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 40px; }
  .card { padding: 16px; border: 1px solid #ddd; border-radius: 12px; }
  .tight { padding: 6px; }
  .loud { font-size: 22px; font-weight: 700; }
</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Studio</h1>
  <p data-marble-id="p">A page with one element that might have been three.</p>
  <marble-alt data-marble-id="card" data-marble-active="v1">
    <div data-marble-id="c1" data-marble-alt="v1" data-why="the one that was here" class="card">The plain card</div>
    <div data-marble-id="c2" data-marble-alt="tight" data-why="less air around it" class="card tight">The tight card</div>
    <div data-marble-id="c3" data-marble-alt="loud" data-why="reads first" class="card loud">The loud card</div>
  </marble-alt>
</body></html>
`;

const host = await startDrive({ documents: { studio: STUDIO } });
test.after(() => host.close());

const pages = [];
test.after(async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); });

const open = async ({ width = 1280, height = 860 } = {}) => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
  await host.reset();
  const { page } = await host.newPage();
  pages.push(page);
  await page.setViewportSize({ width, height });
  await page.goto(`${host.base}/a/studio`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.locator('.marble-variations-pill:not([hidden])').waitFor();
  return page;
};

const pill = (page) => page.locator('.marble-variations-pill');
const panel = (page) => page.locator('.marble-variations-panel');
const cards = (page) => page.locator('.marble-variations-card');
const activeName = (page) => page.evaluate(() => document.querySelector('marble-alt').getAttribute('data-marble-active'));
const shown = (page) => page.evaluate(() => [...document.querySelectorAll('marble-alt > [data-marble-alt]')]
  .filter((el) => getComputedStyle(el).display !== 'none')
  .map((el) => el.getAttribute('data-marble-alt')));

test('an element with three versions grows a pill that says where you are, and only one of them shows', async () => {
  const page = await open();
  assert.match(await pill(page).textContent(), /v1\s*1\/3/);
  assert.deepEqual(await shown(page), ['v1'], 'the document is not three cards deep');
  // On the element, not in the corner.
  const [tag, alt] = await Promise.all([pill(page).boundingBox(), page.locator('marble-alt').boundingBox()]);
  assert.ok(Math.abs(tag.x + tag.width - (alt.x + alt.width)) < 3, 'the pill hangs at the element\'s right edge');
  assert.ok(tag.y + tag.height <= alt.y + 2, 'and above it');
});

test('the pill steps through the set, and a step is an op the document keeps and undo takes back', async () => {
  const page = await open();
  await page.locator('.marble-variations-step[aria-label="Next version"]').click();
  await page.waitForFunction(() => document.querySelector('marble-alt').getAttribute('data-marble-active') === 'tight');
  assert.deepEqual(await shown(page), ['tight']);
  assert.match(await pill(page).textContent(), /tight\s*2\/3/);

  // Recorded like any edit: the carrier's own undo puts the version back. (The
  // key itself belongs to each document's affordances, which a bare fixture
  // has none of — what is being checked here is that a step was recorded.)
  await page.evaluate(() => window.marble.undo());
  await page.waitForFunction(() => document.querySelector('marble-alt').getAttribute('data-marble-active') === 'v1');
  await page.waitForFunction(() => [...document.querySelectorAll('marble-alt > [data-marble-alt]')]
    .filter((el) => getComputedStyle(el).display !== 'none')
    .map((el) => el.getAttribute('data-marble-alt')).join() === 'v1');

  // And it reaches the file, not just the page: a reload comes back on the
  // version that was chosen, because the choice is one attribute in it.
  await page.locator('.marble-variations-step[aria-label="Next version"]').click();
  await page.waitForFunction(() => document.querySelector('marble-alt').getAttribute('data-marble-active') === 'tight');
  await page.waitForTimeout(500);
  await page.reload();
  await page.locator('.marble-variations-pill:not([hidden])').waitFor();
  assert.equal(await activeName(page), 'tight');
  assert.deepEqual(await shown(page), ['tight']);
});

test('Compare lays every version out in the space the page has left, and Use switches to one', async () => {
  const page = await open();
  await page.locator('.marble-variations-open').click();
  await panel(page).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.marble-variations-card').length === 3);
  assert.equal(await cards(page).count(), 3);
  // Each card shows the version itself, at the size it fits.
  assert.equal(await page.locator('.marble-variations-hold').count(), 3);
  assert.equal(await page.locator('.marble-variations-hold', { hasText: 'The loud card' }).count(), 1);
  // A preview is not a place: no clone answers to an id.
  assert.equal(await page.evaluate(() => document.querySelectorAll('.marble-variations-hold [data-marble-id]').length), 0);
  // The one in use says so, and offers nothing to press.
  assert.equal(await page.locator('.marble-variations-card[data-active="true"] .marble-variations-use').textContent(), 'In use');
  assert.equal(await page.locator('.marble-variations-why').first().textContent(), 'the one that was here');

  // Inside the page's own edges, and clear of Describe mode's toolbar.
  const box = await panel(page).boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 + 1 && box.y + box.height <= 860 + 1, JSON.stringify(box));

  await page.locator('.marble-variations-card', { hasText: 'loud' }).locator('.marble-variations-use').click();
  await page.waitForFunction(() => document.querySelector('marble-alt').getAttribute('data-marble-active') === 'loud');
  assert.deepEqual(await shown(page), ['loud']);
});

test('Keep only this unwraps the alternative and leaves the survivor holding the id', async () => {
  const page = await open();
  await page.locator('.marble-variations-open').click();
  await panel(page).waitFor();
  await page.locator('.marble-variations-card', { hasText: 'tight' }).locator('.marble-variations-keep').click();

  await page.waitForFunction(() => document.querySelectorAll('marble-alt').length === 0);
  const kept = await page.evaluate(() => {
    const el = document.querySelector('[data-marble-id="card"]');
    return el ? { text: el.textContent.trim(), cls: el.className, alt: el.getAttribute('data-marble-alt') } : null;
  });
  assert.equal(kept.text, 'The tight card', 'the version kept is the one asked for');
  assert.ok(kept.cls.includes('tight'));
  assert.equal(kept.alt, null, 'it is no longer a version of anything');
  assert.equal(await page.locator('.marble-variations-pill:not([hidden])').count(), 0, 'nothing left to step through');
  assert.equal(await panel(page).isVisible(), false);
});

test('the surface is moved by its bar and stays inside the page', async () => {
  const page = await open();
  await page.locator('.marble-variations-open').click();
  await panel(page).waitFor();
  const before = await panel(page).boundingBox();
  const bar = await page.locator('.marble-variations-bar').boundingBox();
  await page.mouse.move(bar.x + 40, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + 40 + 160, bar.y + bar.height / 2 - 120, { steps: 8 });
  await page.mouse.up();
  const after = await panel(page).boundingBox();
  assert.ok(after.x > before.x + 100, `${before.x} → ${after.x}`);
  assert.ok(after.y < before.y - 60, `${before.y} → ${after.y}`);
  assert.ok(after.x >= 0 && after.y >= 0);

  // And it is remembered: the same corner when it opens again.
  await page.locator('.marble-variations-shut').click();
  await page.locator('.marble-variations-open').click();
  await panel(page).waitFor();
  const again = await panel(page).boundingBox();
  assert.ok(Math.abs(again.x - after.x) < 3 && Math.abs(again.y - after.y) < 3, `${JSON.stringify(after)} vs ${JSON.stringify(again)}`);
});
