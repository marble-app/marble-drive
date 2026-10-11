/** Balance in the pane tree: siblings on one axis share evenly.
 *
 *  This lives in its own file on purpose: the shared pane and Focus files are
 *  being rewritten wholesale by other conversations, and a test appended to
 *  their tails has been silently dropped before. The harness below is
 *  duplicated from agents-panes.test.js for the same reason.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const openAgents = async (count) => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) {
      const id = await window.marble.agent.start({ provider: 'fake' });
      await window.marble.agent.update(id, { title: `chat ${i}` });
    }
  }, count);
  await page.locator('#list .conv').nth(count - 1).waitFor();
  await page.locator('#list .conv').first().click();
  await page.locator('.pane > marble-conversation[conversation]').waitFor();
  return { page, errors };
};

const until = async (page, check, what) => {
  for (let i = 0; i < 80; i += 1) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** Every frame on the pane, the room's ghost included when `ghost` is set. */
const frames = (page, { ghost = false } = {}) => page.evaluate((withGhost) => [...document.querySelectorAll(
  withGhost ? '.dock-frame:not(.marble-leaving)' : '.dock-frame:not(.dock-ghost):not(.marble-leaving)',
)].map((frame) => {
  const r = frame.getBoundingClientRect();
  return { key: frame.dataset.key, ghost: frame.classList.contains('dock-ghost'), x: r.x, y: r.y, w: r.width, h: r.height };
}), ghost);

const spread = (rects, of) => Math.max(...rects.map(of)) - Math.min(...rects.map(of));
// Even shares of the row. A frame is inset by half the 5px gap on each side
// that faces a neighbour, so an inner column measures a half-gap narrower
// than the outer two: 3px of tolerance is that inset, not a lopsided tree.
const evenColumns = (rects) => rects.length > 1 && spread(rects, (r) => r.w) <= 3 && spread(rects, (r) => r.y) <= 1 && spread(rects, (r) => r.h) <= 1;

/** Take list row `index` to the pointer at `side` of the pane whose key is
 *  `key`, and leave it there — the room is open, the layout previewed. */
const carryOnto = async (page, index, key, side) => {
  const row = await page.locator('#list .conv').nth(index).boundingBox();
  const at = await page.evaluate((k) => {
    const el = document.querySelector(`.dock-frame[data-key="${k}"]`) ?? document.querySelector('.pane');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, key);
  const [fx, fy] = { left: [0.08, 0.5], right: [0.92, 0.5], top: [0.5, 0.1], bottom: [0.5, 0.92] }[side];
  await page.mouse.move(row.x + 60, row.y + 15);
  await page.mouse.down();
  await page.mouse.move(row.x + 100, row.y + 30, { steps: 3 });
  await page.mouse.move(at.x + at.w * fx, at.y + at.h * fy, { steps: 10 });
};

/** As asked: three columns means three even columns. An insert
 *  re-levels the row it lands in, and because the room previews with the
 *  same insert, what you are shown while the chat is in the air is the
 *  balanced layout you get. */
test('a third column re-levels the row to thirds, in the preview and on the drop', async () => {
  const { page, errors } = await openAgents(3);
  await carryOnto(page, 1, 'P', 'right');
  await page.mouse.up();
  await until(page, async () => (await frames(page)).length === 2, 'two panes');
  await until(page, async () => evenColumns(await frames(page)), 'two even columns');
  // The dropped chat takes the ghost's seat and the ghost goes; only then is
  // the next room a clean three.
  await until(page, async () => (await frames(page, { ghost: true })).length === 2, 'the first ghost to go');

  const second = (await frames(page)).find((r) => r.key !== 'P').key;
  await carryOnto(page, 2, second, 'right');
  // The room is open: the ghost stands in its seat and the row is already thirds.
  await until(page, async () => {
    const all = await frames(page, { ghost: true });
    return all.length === 3 && all.some((r) => r.ghost) && evenColumns(all);
  }, 'the preview to show three even columns');
  await page.mouse.up();
  await until(page, async () => (await frames(page)).length === 3, 'three panes');
  await until(page, async () => evenColumns(await frames(page)), 'three even columns');
  const rects = (await frames(page)).sort((a, b) => a.x - b.x);
  assert.equal(rects.length, 3);
  assert.ok(spread(rects, (r) => r.w) <= 3, `three even columns, got ${rects.map((r) => Math.round(r.w)).join(', ')}`);
  assert.ok(rects[0].x < rects[1].x && rects[1].x < rects[2].x, 'side by side');
  assert.equal(await page.locator('.pane marble-conversation').count(), 3);
  assert.deepEqual(errors, []);
});
