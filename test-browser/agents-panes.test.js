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
