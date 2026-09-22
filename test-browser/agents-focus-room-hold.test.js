/** A card held over a stage edge opens a room, and the room stays open for as
 *  long as the hand holds it there — whatever else the page hears meanwhile.
 *
 *  The Agents page is never quiet: every running agent streams conversation
 *  events, and agents write to Agents.mrbl itself, so a patch or an upsert
 *  landing mid-drag is the ordinary case, not a corner. Each repaints Focus,
 *  and the Focus paint lays the pane out through applyDock — which used to
 *  take the room, drop the ghost, and ease the space closed under a hand
 *  still holding it. Nothing then reopened it, because the intent for that
 *  edge had already been spent.
 *
 *  Its own file, for the reason agents-focus-seen.test.js gives: the shared
 *  focus test files are rewritten wholesale by other conversations.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
const AGENTS = raw
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const openAgents = async (t) => {
  await host.reset();
  const { page, errors } = await host.newPage();
  t.after(() => page.context().close());
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      const { folders } = await window.marble.agent.folders();
      for (const row of folders) await window.marble.agent.deleteFolder(row.id);
    } catch { /* fresh agent */ }
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
    try { localStorage.removeItem('marble-agents:focus-mode'); } catch { /* private */ }
  });
  return { page, errors };
};

/** One chat pinned on the stage, one loose in the field. */
const seed = async (page) => {
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'first', pinned: true });
    await agent.update(b, { title: 'second' });
    return { a, b };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.pane marble-conversation[conversation="${ids.a}"]`).waitFor();
  await page.waitForTimeout(600);
  return ids;
};

/** Drag `id` to the bottom band of the stage and hold it there; the room
 *  has opened and finished easing when this resolves. */
const holdOverBottomBand = async (page, id) => {
  const paneBox = await page.locator('.pane').boundingBox();
  const to = { x: paneBox.x + paneBox.width / 2, y: paneBox.y + paneBox.height * 0.92 };
  const box = await page.locator(`.focus-card[data-id="${id}"]`).boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + 14 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 16, from.y + 12, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.move(to.x, to.y);
  await page.locator('.pane .dock-ghost').waitFor();
  await page.waitForTimeout(700);
  return to;
};

const roomState = (page) => page.evaluate(() => {
  const ghost = document.querySelector('.pane .dock-ghost');
  const frames = [...document.querySelectorAll('.pane .dock-frame:not(.dock-ghost):not(.marble-leaving)')];
  return {
    ghost: ghost ? Math.round(ghost.getBoundingClientRect().height) : 0,
    leaving: Boolean(ghost?.classList.contains('marble-leaving')),
    primary: Math.round(frames[0]?.getBoundingClientRect().height ?? 0),
    dock: document.querySelector('.pane').getAttribute('data-dock'),
  };
});

const assertStanding = (before, after, what) => {
  assert.ok(after.ghost > 100, `${what}: the ghost is still on the stage (${JSON.stringify(after)})`);
  assert.equal(after.leaving, false, `${what}: the ghost is not folding`);
  assert.equal(after.dock, 'tree', `${what}: the stage is still in tree mode`);
  assert.ok(Math.abs(after.primary - before.primary) <= 2, `${what}: the pane kept its share (${before.primary} → ${after.primary})`);
};

test('a conversation event landing mid-drag leaves the room standing', async (t) => {
  const { page } = await openAgents(t);
  const ids = await seed(page);
  await holdOverBottomBand(page, ids.b);
  const before = await roomState(page);
  assert.ok(before.ghost > 100, `the room opened: ${JSON.stringify(before)}`);
  // What every running agent does all the time: a summary changes and the
  // page repaints Focus.
  await page.evaluate((id) => window.marble.agent.update(id, { title: 'renamed mid-hold' }), ids.a);
  await page.waitForTimeout(900);
  assertStanding(before, await roomState(page), 'after an event');
  // And the drop still lands in the room it showed.
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost):not(.marble-leaving)').length === 2);
});

test('a patch landing mid-drag leaves the room standing in Focus', async (t) => {
  const { page } = await openAgents(t);
  const ids = await seed(page);
  await holdOverBottomBand(page, ids.b);
  const before = await roomState(page);
  assert.ok(before.ghost > 100, `the room opened: ${JSON.stringify(before)}`);
  await page.evaluate(() => window.marble.patch?.());
  await page.waitForTimeout(900);
  assertStanding(before, await roomState(page), 'after a patch');
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost):not(.marble-leaving)').length === 2);
});

test('a room whose stage changed under it moves with the panes', async (t) => {
  const { page } = await openAgents(t);
  const ids = await seed(page);
  await holdOverBottomBand(page, ids.b);
  const before = await roomState(page);
  assert.ok(before.ghost > 100, `the room opened: ${JSON.stringify(before)}`);
  // A third chat pins itself while the hand is down: a new pane joins the
  // stage, and the room keeps its place beside the pane it was opening.
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    const c = await agent.start({ provider: 'fake' });
    await agent.update(c, { title: 'third', pinned: true });
  });
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost):not(.marble-leaving)').length === 2);
  await page.waitForTimeout(900);
  const after = await roomState(page);
  assert.ok(after.ghost > 60, `the ghost is still on the stage (${JSON.stringify(after)})`);
  assert.equal(after.leaving, false, 'the ghost is not folding');
  assert.equal(after.dock, 'tree');
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost):not(.marble-leaving)').length === 3);
});
