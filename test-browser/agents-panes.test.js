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

const host = await startDrive({ documents: { garden: GARDEN, Agents: await sourceOfAgents() } });
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

const cards = (page) => page.evaluate(() => [...document.querySelectorAll('.dock-frame:not(.dock-ghost):not(.marble-leaving)')].map((frame) => {
  const r = frame.getBoundingClientRect();
  return { key: frame.dataset.key, x: r.x, y: r.y, w: r.width, h: r.height };
}));

const overlaps = (rects) => rects.some((a, i) => rects.some((b, j) => j > i
  && a.x + 1 < b.x + b.w && b.x + 1 < a.x + a.w && a.y + 1 < b.y + b.h && b.y + 1 < a.y + a.h));

/** Drag list row `index` onto `side` of the pane whose key is `key`. */
const dragOnto = async (page, index, key, side) => {
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
  await page.mouse.up();
  await page.waitForTimeout(700);
};

test('panes split without a limit, each on the side of the pane it was dropped on', async () => {
  const { page, errors } = await openAgents(8);
  await dragOnto(page, 1, 'P', 'right');
  await dragOnto(page, 2, 'P', 'bottom');
  await dragOnto(page, 3, 'P', 'top');
  await dragOnto(page, 4, 'P', 'left');
  let keys = (await cards(page)).map((c) => c.key);
  await dragOnto(page, 5, keys.at(-1), 'bottom');
  keys = (await cards(page)).map((c) => c.key);
  await dragOnto(page, 6, keys[1], 'left');
  keys = (await cards(page)).map((c) => c.key);
  await dragOnto(page, 7, keys[2], 'top');
  const rects = await cards(page);
  assert.equal(rects.length, 8, 'eight chats, eight panes');
  assert.equal(overlaps(rects), false, 'no two panes overlap');
  const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
  const box = await page.locator('.pane').boundingBox();
  assert.ok(area > box.width * box.height * 0.8, 'the panes fill the workspace');
  assert.equal(await page.locator('.pane marble-conversation').count(), 8);
  assert.deepEqual(errors, []);
});

test('a docked pane can be moved beside another, closed, and the rest close up', async () => {
  const { page } = await openAgents(4);
  await dragOnto(page, 1, 'P', 'right');
  await dragOnto(page, 2, 'P', 'bottom');
  const before = await cards(page);
  assert.equal(before.length, 3);
  // Move the first extra's pane under the primary by its bar.
  const bar = await page.locator('.dock-leaf .dock-bar').first().boundingBox();
  const primary = before.find((c) => c.key === 'P');
  await page.mouse.move(bar.x + 60, bar.y + 10);
  await page.mouse.down();
  await page.mouse.move(bar.x + 90, bar.y + 40, { steps: 3 });
  await page.mouse.move(primary.x + primary.w / 2, primary.y + primary.h * 0.9, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const moved = await cards(page);
  assert.equal(moved.length, 3, 'moving does not duplicate or drop a pane');
  assert.equal(overlaps(moved), false);
  await page.locator('.dock-leaf .dock-close').first().click();
  await page.waitForTimeout(800);
  const closed = await cards(page);
  assert.equal(closed.length, 2);
  const box = await page.locator('.pane').boundingBox();
  assert.ok(closed.reduce((sum, r) => sum + r.w * r.h, 0) > box.width * box.height * 0.85, 'the freed room is taken up');
  await page.locator('.dock-leaf .dock-close').first().click();
  await page.waitForFunction(() => !document.querySelector('.pane').hasAttribute('data-dock'));
  assert.equal(await page.locator('.dock-stage').count(), 0, 'one pane goes back to the plain layout');
});

test('the arrangement is remembered across a reload', async () => {
  const { page } = await openAgents(4);
  await dragOnto(page, 1, 'P', 'right');
  await dragOnto(page, 2, 'P', 'bottom');
  const signature = async () => (await cards(page))
    .map((c) => `${Math.round(c.x)},${Math.round(c.y)},${Math.round(c.w)},${Math.round(c.h)}`).sort().join('|');
  const before = await signature();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.dock-frame').length === 3);
  await page.waitForTimeout(900);
  assert.equal(await signature(), before);
});

test('a seam between nested panes resizes only its own split', async () => {
  const { page } = await openAgents(3);
  await dragOnto(page, 1, 'P', 'right');
  await dragOnto(page, 2, 'P', 'bottom');
  const before = await cards(page);
  const seam = page.locator('.dock-gutter[data-dir="col"]').first();
  const s = await seam.boundingBox();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2 - 80, { steps: 6 });
  await page.mouse.up();
  const after = await cards(page);
  const other = (list) => list.find((c) => c.x > 700);
  assert.equal(Math.round(other(after).w), Math.round(other(before).w), 'the pane across the other seam is untouched');
  assert.equal(overlaps(after), false);
});

test('the focused pane is lit and the others dim, in every view', async () => {
  const { page } = await openAgents(2);
  await dragOnto(page, 1, 'P', 'right');
  const read = () => page.evaluate(() => [...document.querySelectorAll('.dock-frame:not(.dock-ghost)')].map((f) => ({
    key: f.dataset.key, focused: f.hasAttribute('data-focused'), bg: getComputedStyle(f).backgroundColor,
  })));
  let frames = await read();
  assert.equal(frames.filter((f) => f.focused).length, 1, 'exactly one lit pane');
  const lit = frames.find((f) => f.focused);
  const dim = frames.find((f) => !f.focused);
  assert.notEqual(lit.bg, dim.bg, 'the dim pane has a different surface');
  // The primary's bar sits on the pane, not inside its frame; bars carry the key.
  await page.locator(`.dock-bar[data-key="${dim.key}"]`).click();
  frames = await read();
  assert.equal(frames.find((f) => f.key === dim.key).focused, true, 'clicking a bar focuses it');
  // A bar click puts the caret in that pane's composer, so V would type there.
  await page.locator('.views [data-view="board"]').click();
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  frames = await read();
  assert.equal(frames.filter((f) => f.focused).length, 1, 'still one lit pane on the board');
});

test('focus moving between panes is a transition, not a cut', async () => {
  const { page } = await openAgents(2);
  await dragOnto(page, 1, 'P', 'right');
  const props = await page.evaluate(() => {
    const frame = document.querySelector('.dock-frame.dock-leaf[data-focused]');
    const bar = frame.querySelector('.dock-bar');
    const view = frame.querySelector('marble-conversation');
    const log = view.shadowRoot.querySelector('.log');
    return {
      bar: getComputedStyle(bar).transitionProperty,
      view: getComputedStyle(view).transitionProperty,
      log: getComputedStyle(log).transitionProperty,
      duration: getComputedStyle(bar).transitionDuration,
    };
  });
  assert.match(props.bar, /background-color/);
  assert.match(props.view, /opacity/);
  assert.match(props.view, /background-color/);
  assert.match(props.log, /filter/);
  assert.notEqual(props.duration, '0s');
});

test('Alt-click opens a conversation beside the focused pane', async () => {
  const { page } = await openAgents(2);
  await page.locator('#list .conv').nth(1).click({ modifiers: ['Alt'] });
  await page.waitForFunction(() => document.querySelectorAll('.dock-frame:not(.dock-ghost)').length === 2);
  await page.waitForTimeout(700);
  const rects = await cards(page);
  assert.equal(overlaps(rects), false);
  assert.equal(await page.locator('marble-conversation[conversation]').count(), 2);
});

test('split makes an empty pane, and the next row fills it', async () => {
  const { page } = await openAgents(2);
  await page.locator('.pane > .dock-bar .dock-split[data-side="right"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.dock-frame:not(.dock-ghost)').length === 2);
  const empty = page.locator('.dock-frame.dock-leaf marble-conversation:not([conversation])');
  assert.equal(await empty.count(), 1, 'the new pane is empty');
  assert.equal(await page.locator('.dock-frame.dock-leaf[data-focused]').count(), 1, 'and focused');
  await page.locator('#list .conv').nth(1).click();
  await page.locator('.dock-frame.dock-leaf marble-conversation[conversation]').waitFor();
  assert.equal(await page.locator('marble-conversation:not([conversation])').count(), 0);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.locator('.pane > marble-conversation[conversation]').waitFor();
});

test('split down stacks the empty pane under the pane', async () => {
  const { page } = await openAgents(1);
  await page.locator('.pane > .dock-bar .dock-split[data-side="bottom"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.dock-frame:not(.dock-ghost)').length === 2);
  const [a, b] = await cards(page);
  assert.ok(Math.abs(a.x - b.x) < 2 && a.y !== b.y, 'one above the other');
});

test('a patch landing mid-drag leaves the room standing', async () => {
  // Agents write to the Agents document while it is being used, and every
  // write reaches the page as a patch. The dock lives in the page, not in the
  // file, so a patch has nothing to say about it — but the page used to
  // rebuild the dock from scratch on every one, which took the stage, the
  // ghost and the room out from under a pointer that was still holding them.
  const { page, errors } = await openAgents(3);
  const row = await page.locator('#list .conv').nth(1).boundingBox();
  const box = await page.evaluate(() => {
    const r = document.querySelector('.pane').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.move(row.x + 60, row.y + 15);
  await page.mouse.down();
  await page.mouse.move(row.x + 100, row.y + 30, { steps: 3 });
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.92, { steps: 10 });
  await page.locator('.dock-ghost').waitFor();
  await page.waitForTimeout(700);
  const opened = await page.evaluate(() => document.querySelector('.dock-ghost').getBoundingClientRect().height);
  assert.ok(opened > 100, 'the room opened before the patch');

  await page.evaluate(() => window.marble.patch());
  await page.waitForTimeout(600);
  const held = await page.evaluate(() => {
    const ghost = document.querySelector('.dock-ghost');
    return {
      ghost: ghost ? Math.round(ghost.getBoundingClientRect().height) : null,
      dock: document.querySelector('.pane').getAttribute('data-dock'),
      stage: Boolean(document.querySelector('.dock-stage')),
      open: document.querySelector('.pane marble-conversation')?.getAttribute('conversation') ?? null,
    };
  });
  assert.equal(held.stage, true, 'the stage is still there');
  assert.equal(held.dock, 'tree');
  assert.ok(held.ghost > 100, `the room is still open (ghost ${held.ghost}px)`);
  // Standing the dock rebuild down for the length of a drag must not cost the
  // pane the chat it is showing.
  assert.ok(held.open, 'the open chat is still in its pane');

  // And the drop the preview promised still happens.
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.dock-frame:not(.dock-ghost)').length === 2);
  const rects = await cards(page);
  assert.equal(overlaps(rects), false);
  assert.deepEqual(errors, []);
});

test('the chat eases back when the room folds, it does not snap', async () => {
  // The primary chat is not inside its card — it is laid over it, positioned by
  // the same numbers. Two later rules gave it a colour-only transition, which
  // replaced the geometry one outright, so a room opening or folding moved every
  // card and jumped the one thing you are looking at. Watched as "it makes space
  // but it doesn't animate back": the ghost eased shut behind a chat that had
  // already finished.
  const { page, errors } = await openAgents(3);
  const row = await page.locator('#list .conv').nth(1).boundingBox();
  const box = await page.evaluate(() => { const r = document.querySelector('.pane').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(row.x + 60, row.y + 15);
  await page.mouse.down();
  await page.mouse.move(row.x + 100, row.y + 30, { steps: 3 });
  await page.mouse.move(box.x + box.w * 0.92, box.y + box.h * 0.5, { steps: 10 });
  await page.locator('.dock-ghost').waitFor();
  await page.waitForTimeout(700);

  const sample = () => page.evaluate(() => {
    window.__widths = [];
    const stop = performance.now() + 700;
    const tick = () => {
      const el = document.querySelector('.pane > marble-conversation:not([data-marble-transient])');
      if (el) window.__widths.push(Math.round(el.getBoundingClientRect().width));
      if (performance.now() < stop) requestAnimationFrame(tick);
    };
    tick();
  });

  // Off the edge band and into the pane's middle: the room folds.
  await sample();
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5, { steps: 8 });
  await page.waitForTimeout(900);
  const widths = await page.evaluate(() => window.__widths);
  const from = widths[0];
  const to = widths[widths.length - 1];
  assert.ok(to - from > 200, `the chat did not grow back (${from} -> ${to})`);
  // A snap is two values with nothing between them. An eased return spends
  // frames in the middle of the journey.
  const between = widths.filter((w) => w > from + 40 && w < to - 40).length;
  assert.ok(between >= 8, `the chat jumped back instead of easing (${between} in-between frames across ${widths.length}: ${widths.slice(0, 12).join(',')}…)`);

  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.deepEqual(errors, []);
});
