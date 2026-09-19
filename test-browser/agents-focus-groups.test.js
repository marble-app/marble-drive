/** Groups on the Focus canvas: starting a chat in one, and a staged chat
 *  wearing its group's colour on its bar.
 *
 *  This lives in its own file rather than in agents-focus.test.js on purpose:
 *  that file is being rewritten wholesale by other conversations, and a test
 *  appended to its tail was silently dropped twice on 2026-09-18. The helpers
 *  below are duplicated from it for the same reason.
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

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
  });
  return { page, errors };
};

const until = async (page, check, what) => {
  for (let i = 0; i < 80; i += 1) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const metaOf = async (page, id) => (
  await page.evaluate((row) => window.marble.agent.conversation(row), id)
)?.meta ?? null;

/** Two chats, one of them filed in a group called Alpha; Focus open with the
 *  group's basin drawn. */
const seedGroup = async (page) => {
  const seeded = await page.evaluate(async () => {
    const a = await window.marble.agent.start({ provider: 'fake' });
    const b = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(a, { title: 'filed' });
    await window.marble.agent.update(b, { title: 'loose' });
    const folder = await window.marble.agent.createFolder({ conversationIds: [a], name: 'Alpha', color: 'research' });
    return { a, b, folderId: folder.id ?? folder.folder?.id };
  });
  assert.ok(seeded.folderId, 'the folder API returned an id');
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-basin[data-folder-id="${seeded.folderId}"]`).waitFor();
  await page.locator('.focus-basin[data-folder-id="ungrouped"]').waitFor();
  return seeded;
};

/** A point inside a basin's padding — inside the region, on no card and not
 *  on the basin's name. The packer pads a region by 10px, so the strip along
 *  its bottom-left corner is the empty area a double-click is aimed at. */
const emptySpotIn = async (page, folderId) => {
  const spot = await page.evaluate((id) => {
    const basin = document.querySelector(`.focus-basin[data-folder-id="${id}"]`);
    if (!basin) return null;
    const r = basin.getBoundingClientRect();
    const x = r.left + 5;
    const y = r.bottom - 5;
    const hit = document.elementFromPoint(x, y);
    return {
      x, y,
      onCard: Boolean(hit?.closest('.focus-card')),
      onName: Boolean(hit?.closest('.focus-basin-name')),
      onPane: Boolean(hit?.closest('.pane')),
      hit: hit?.className || hit?.tagName,
    };
  }, folderId);
  assert.ok(spot, `basin ${folderId} is drawn`);
  assert.equal(spot.onCard, false, `the spot is off every card (hit ${spot.hit})`);
  assert.equal(spot.onName, false, `the spot is off the basin's name (hit ${spot.hit})`);
  assert.equal(spot.onPane, false, `the spot is off the pane (hit ${spot.hit})`);
  return spot;
};

const newestConversation = async (page, known) => page.evaluate(async (ids) => (
  (await window.marble.agent.conversations()).map((row) => row.id).find((id) => !ids.includes(id))
), known);

/** Double-clicking the empty area of a group starts a chat in that group —
 *  filed there, and on the stage, since a chat started from Focus is one you
 *  mean to work in. */
test('double-clicking a group\'s empty area starts a chat in that group', async () => {
  const { page } = await openAgents();
  const { a, b, folderId } = await seedGroup(page);
  const spot = await emptySpotIn(page, folderId);
  await page.mouse.dblclick(spot.x, spot.y);

  let fresh = null;
  await until(page, async () => {
    fresh = await newestConversation(page, [a, b]);
    return Boolean(fresh);
  }, 'a third chat to start');
  await until(page, async () => (await metaOf(page, fresh))?.folderId === folderId, 'the new chat to be filed in Alpha');
  await until(page, async () => (await metaOf(page, fresh))?.pinned === true, 'the new chat to be pinned');
  await page.locator(`.pane marble-conversation[conversation="${fresh}"]`).waitFor();
  // The chats that were there stay as they were: one filed, one loose.
  assert.equal((await metaOf(page, a))?.folderId, folderId);
  assert.equal((await metaOf(page, b))?.folderId ?? null, null);
});

/** The loose region is a place too: a double-click there starts an ungrouped
 *  chat. */
test('double-clicking the ungrouped area starts a chat with no group', async () => {
  const { page } = await openAgents();
  const { a, b } = await seedGroup(page);
  const spot = await emptySpotIn(page, 'ungrouped');
  await page.mouse.dblclick(spot.x, spot.y);

  let fresh = null;
  await until(page, async () => {
    fresh = await newestConversation(page, [a, b]);
    return Boolean(fresh);
  }, 'a third chat to start');
  await until(page, async () => (await metaOf(page, fresh))?.pinned === true, 'the new chat to be pinned');
  assert.equal((await metaOf(page, fresh))?.folderId ?? null, null, 'the chat is not filed');
  await page.locator(`.pane marble-conversation[conversation="${fresh}"]`).waitFor();
});

/** A staged chat wears its group: its bar carries the group's colour and the
 *  same tick its card shows, named after the group. A chat with no group
 *  carries neither. */
test('a staged chat\'s bar wears its group colour and tick', async () => {
  const { page } = await openAgents();
  const { a, b, folderId } = await seedGroup(page);
  const spot = await emptySpotIn(page, folderId);
  await page.mouse.dblclick(spot.x, spot.y);
  let fresh = null;
  await until(page, async () => {
    fresh = await newestConversation(page, [a, b]);
    return Boolean(fresh);
  }, 'a third chat to start');
  await page.locator(`.pane marble-conversation[conversation="${fresh}"]`).waitFor();

  const barOf = (id) => page.evaluate((row) => {
    const bar = [...document.querySelectorAll('.pane .dock-bar')].find((el) => el.dataset.id === row && !el.closest('.dock-ghost'));
    if (!bar) return null;
    const tick = bar.querySelector('.dock-folder');
    return {
      color: bar.dataset.color ?? null,
      tickShown: Boolean(tick) && !tick.hidden && getComputedStyle(tick).display !== 'none',
      tickTitle: tick?.title ?? null,
    };
  }, id);

  await until(page, async () => (await barOf(fresh))?.color === 'research', 'the staged chat\'s bar to wear research');
  const grouped = await barOf(fresh);
  assert.equal(grouped.tickShown, true, 'the tick shows');
  assert.equal(grouped.tickTitle, 'Alpha', 'the tick names the group');

  // Pin the loose chat beside it: its bar has no colour and no tick.
  await page.locator(`.focus-card[data-id="${b}"]`).dblclick({ modifiers: ['Shift'] });
  await page.locator(`.pane marble-conversation[conversation="${b}"]`).waitFor();
  await until(page, async () => Boolean(await barOf(b)), 'the loose chat\'s bar to be painted');
  const loose = await barOf(b);
  assert.equal(loose.color, null, 'no group, no colour');
  assert.equal(loose.tickShown, false, 'no group, no tick');
});
