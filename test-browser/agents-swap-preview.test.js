/** The swap preview: dragging a docked chat onto another's centre trades the
 *  two panes' places while the hand is still down, and the drop commits the
 *  tree the preview showed.
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

/** Every pane on the stage with the chat that is drawn over it. The primary
 *  chat is not inside its frame — it is the pane's own element laid over the
 *  frame — so "the chat in this frame" is the conversation whose box holds
 *  the frame's centre. */
const panes = (page) => page.evaluate(() => {
  const views = [...document.querySelectorAll('.pane marble-conversation[conversation]')].map((view) => {
    const b = view.getBoundingClientRect();
    return { id: view.getAttribute('conversation'), left: b.left, right: b.right, top: b.top, bottom: b.bottom };
  });
  return [...document.querySelectorAll('.dock-frame:not(.dock-ghost):not(.marble-leaving)')].map((frame) => {
    const r = frame.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const view = views.find((v) => cx >= v.left && cx <= v.right && cy >= v.top && cy <= v.bottom);
    return { key: frame.dataset.key, x: r.x, y: r.y, w: r.width, h: r.height, id: view?.id ?? null };
  });
});

const byKey = (list) => Object.fromEntries(list.map((item) => [item.key, item]));

/** The stage at rest: two samples a beat apart agree on where every pane is
 *  and what it shows. A rect read mid-transition is the wrong rect — the
 *  first dock eases the primary from the full width to half, and its centre
 *  is the seam until that is over. */
const steady = async (page) => {
  let last = null;
  for (let i = 0; i < 60; i += 1) {
    const now = JSON.stringify((await panes(page)).map((p) => [p.key, Math.round(p.x), Math.round(p.w), p.id]));
    if (now === last) return JSON.parse(now);
    last = now;
    await page.waitForTimeout(120);
  }
  throw new Error('timed out waiting for the stage to settle');
};

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

/** Two chats side by side: the first opened as the primary, the second
 *  docked to its right. Resolves once the room's ghost has gone, so the
 *  stage is two clean panes. */
const twoPanes = async () => {
  const { page, errors } = await openAgents(2);
  await carryOnto(page, 1, 'P', 'right');
  await page.mouse.up();
  await until(page, async () => (await frames(page)).length === 2, 'two panes');
  await until(page, async () => (await frames(page, { ghost: true })).length === 2, 'the ghost to go');
  await until(page, async () => {
    const all = await panes(page);
    return all.length === 2 && all.every((p) => p.id) && new Set(all.map((p) => p.id)).size === 2;
  }, 'a different chat in each pane');
  await steady(page);
  const rest = byKey(await panes(page));
  const extra = Object.keys(rest).find((key) => key !== 'P');
  assert.ok(rest.P.x < rest[extra].x, 'the primary sits on the left, the docked chat on the right');
  assert.ok(Math.abs(rest.P.w - rest[extra].w) <= 3, 'two even columns');
  return { page, errors, rest, extra };
};

/** Pick up the docked pane `key` by its bar and carry it to the centre of
 *  pane `onto`, leaving the pointer down there. */
const carryBarOnto = async (page, key, onto) => {
  const bar = await page.locator(`.dock-frame[data-key="${key}"] .dock-bar`).boundingBox();
  const at = await page.evaluate((k) => {
    const r = document.querySelector(`.dock-frame[data-key="${k}"]`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, onto);
  // The title, not the grip's buttons: a press on a button is not a drag.
  await page.mouse.move(bar.x + 40, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + 60, bar.y + bar.height / 2 + 20, { steps: 3 });
  await page.mouse.move(at.x, at.y, { steps: 10 });
};

const exchanged = (page, extra) => page.waitForFunction((k) => {
  const p = document.querySelector('.dock-frame[data-key="P"]')?.getBoundingClientRect();
  const e = document.querySelector(`.dock-frame[data-key="${k}"]`)?.getBoundingClientRect();
  return Boolean(p && e) && p.x > e.x + e.width / 2;
}, extra, { timeout: 5000 });

const settledAt = (page, key, x) => page.waitForFunction(([k, want]) => {
  const r = document.querySelector(`.dock-frame[data-key="${k}"]`)?.getBoundingClientRect();
  return Boolean(r) && Math.abs(r.x - want) < 1;
}, [key, x], { timeout: 5000 });

/** Bryan's ask: a swap showed no preview. Now the preview is the swap — hold
 *  a pane over another's centre and the two ease across while the hand is
 *  still down. */
test('holding a pane over another pane\'s centre trades their places before the drop', async () => {
  const { page, errors, rest, extra } = await twoPanes();
  await carryBarOnto(page, extra, 'P');
  await exchanged(page, extra);
  // Fully across, not merely started: each frame ends where the other began.
  await settledAt(page, 'P', rest[extra].x);
  await settledAt(page, extra, rest.P.x);
  const held = byKey(await panes(page));
  assert.ok(held.P.x > held[extra].x, 'the primary is now on the right while the pointer is still down');
  assert.equal(held.P.id, rest.P.id, 'the primary chat rode along with its frame');
  assert.equal(held[extra].id, rest[extra].id, 'the docked chat rode along with its frame');
  // The target's bar still says "release here".
  assert.equal(await page.locator('.dock-bar.marble-drop-swap').count(), 1);
  await page.mouse.up();
  assert.deepEqual(errors, []);
});

/** The drop commits the tree the preview showed, so nothing jumps: the frames
 *  stay where they were eased to, and each keeps its chat. */
test('releasing commits the swap the preview showed, frames and chats together', async () => {
  const { page, errors, rest, extra } = await twoPanes();
  await carryBarOnto(page, extra, 'P');
  await exchanged(page, extra);
  await settledAt(page, 'P', rest[extra].x);
  await page.mouse.up();
  await until(page, async () => await page.locator('.dock-bar.marble-drop-swap').count() === 0, 'the drop cue to clear');
  // Still exchanged after the drop, and still there once any motion is over.
  await settledAt(page, 'P', rest[extra].x);
  await settledAt(page, extra, rest.P.x);
  await page.waitForTimeout(600);
  const after = byKey(await panes(page));
  assert.equal(Object.keys(after).length, 2);
  assert.ok(Math.abs(after.P.x - rest[extra].x) < 1, `the primary frame stays on the right (${after.P.x} vs ${rest[extra].x})`);
  assert.ok(Math.abs(after[extra].x - rest.P.x) < 1, 'the docked frame stays on the left');
  assert.equal(after.P.id, rest.P.id, 'the primary frame still shows the same chat');
  assert.equal(after[extra].id, rest[extra].id, 'the docked frame still shows the same chat');
  // Committed, and remembered: the layout survives a reload.
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await until(page, async () => {
    const all = await panes(page);
    return all.length === 2 && all.every((p) => p.id) && new Set(all.map((p) => p.id)).size === 2;
  }, 'two panes back, a different chat in each');
  await steady(page);
  const back = byKey(await panes(page));
  const key = Object.keys(back).find((k) => k !== 'P');
  assert.ok(back.P.x > back[key].x, 'the primary is still on the right after a reload');
  assert.equal(back.P.id, rest.P.id);
  assert.equal(back[key].id, rest[extra].id);
  assert.deepEqual(errors, []);
});

/** Carry it away again and the panes go back: the preview was only ever a
 *  preview. */
test('leaving the centre without dropping eases the panes back', async () => {
  const { page, errors, rest, extra } = await twoPanes();
  await carryBarOnto(page, extra, 'P');
  await exchanged(page, extra);
  await settledAt(page, 'P', rest[extra].x);
  // Off the pane altogether: over the list, where a drop would not swap.
  const row = await page.locator('#list .conv').first().boundingBox();
  await page.mouse.move(row.x + 60, row.y + 15, { steps: 10 });
  await settledAt(page, 'P', rest.P.x);
  await settledAt(page, extra, rest[extra].x);
  const back = byKey(await panes(page));
  assert.ok(back.P.x < back[extra].x, 'the primary is back on the left while the pointer is still down');
  assert.equal(back.P.id, rest.P.id);
  assert.equal(back[extra].id, rest[extra].id);
  assert.equal(await page.locator('.dock-bar.marble-drop-swap').count(), 0);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = byKey(await panes(page));
  assert.ok(after.P.x < after[extra].x, 'nothing was swapped');
  assert.deepEqual(errors, []);
});

/** A pass through a pane's centre on the way to a band must not shuffle the
 *  panes: the swap waits for a moment of intent, and a split clears it. */
test('crossing the centre on the way to a band does not swap', async () => {
  const { page, errors, rest, extra } = await twoPanes();
  const bar = await page.locator(`.dock-frame[data-key="${extra}"] .dock-bar`).boundingBox();
  await page.mouse.move(bar.x + 40, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + 60, bar.y + bar.height / 2 + 20, { steps: 3 });
  // Straight through the primary's centre to its left band, without pausing.
  await page.mouse.move(rest.P.x + rest.P.w / 2, rest.P.y + rest.P.h / 2, { steps: 2 });
  await page.mouse.move(rest.P.x + rest.P.w * 0.08, rest.P.y + rest.P.h / 2, { steps: 4 });
  // The room opens on the left of the primary; the primary never left its side.
  await until(page, async () => (await frames(page, { ghost: true })).some((r) => r.ghost), 'the room to open');
  await page.waitForTimeout(400);
  const now = byKey(await panes(page));
  assert.ok(now.P.x < now[extra].x, 'the primary is still left of the docked chat');
  assert.equal(await page.locator('.dock-bar.marble-drop-swap').count(), 0);
  await page.mouse.up();
  assert.deepEqual(errors, []);
});
