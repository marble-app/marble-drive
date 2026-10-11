/** A group on the Focus canvas reads from its biggest card down to its
 *  smallest. Cards come in two heights — Digest and Chip — and a column that
 *  alternates between them looks shuffled however carefully it is ranked, so
 *  the field sorts by size first and by rank second.
 *
 *  Its own file for the reason the other Focus files say: agents-focus.test.js
 *  is rewritten wholesale by other conversations and a test appended to its
 *  tail has been dropped before. The helpers below are duplicated from it.
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

/** Tall on purpose: six cards have to stand in one sub-column for "top to
 *  bottom" to be the only axis the assertions read. */
const openAgents = async () => {
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: { width: 1280, height: 1200 } });
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

/** Six chats in one group. The LOD budget is four Digests, so the two the
 *  page has heard from least become Chips — which is the mix this is about. */
const seedSix = async (page) => {
  const seeded = await page.evaluate(async () => {
    const ids = [];
    for (let i = 0; i < 6; i += 1) {
      const id = await window.marble.agent.start({ provider: 'fake' });
      await window.marble.agent.update(id, { title: `chat ${i + 1}` });
      ids.push(id);
    }
    const folder = await window.marble.agent.createFolder({ conversationIds: ids, name: 'Alpha', color: 'research' });
    return { ids, folderId: folder.id ?? folder.folder?.id };
  });
  assert.ok(seeded.folderId, 'the folder API returned an id');
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-basin[data-folder-id="${seeded.folderId}"]`).waitFor();
  return seeded;
};

/** Every card the group holds, in the order the canvas reads them: down a
 *  sub-column, then on to the next. */
const cardsInOrder = async (page, folderId) => page.evaluate((id) => {
  const basin = document.querySelector(`.focus-basin[data-folder-id="${id}"]`);
  const box = basin.getBoundingClientRect();
  return [...document.querySelectorAll('.focus-card')]
    .map((card) => {
      const r = card.getBoundingClientRect();
      return { id: card.dataset.id, lod: card.dataset.lod, x: r.left, y: r.top, h: r.height };
    })
    .filter((card) => card.x >= box.left - 1 && card.x <= box.right + 1 && card.y >= box.top - 1 && card.y <= box.bottom + 1)
    .sort((a, b) => (Math.abs(a.x - b.x) > 4 ? a.x - b.x : a.y - b.y));
}, folderId);

test('a group orders its cards biggest to smallest', async () => {
  const { page, errors } = await openAgents();
  const { ids, folderId } = await seedSix(page);

  let cards = [];
  await until(page, async () => {
    cards = await cardsInOrder(page, folderId);
    return cards.length === ids.length && cards.some((card) => card.lod === 'chip');
  }, 'six cards, some of them chips');

  const lods = cards.map((card) => card.lod);
  const firstChip = lods.indexOf('chip');
  assert.ok(firstChip > 0, `the group mixes digests and chips (${lods.join(', ')})`);
  assert.ok(
    lods.slice(firstChip).every((lod) => lod === 'chip'),
    `no digest sits below a chip (${lods.join(', ')})`,
  );
  // The same claim in pixels, which is what the eye is actually reading.
  for (const [i, card] of cards.entries()) {
    if (!i) continue;
    assert.ok(card.h <= cards[i - 1].h + 0.5, `card ${i} is no taller than the one above it`);
  }
  assert.deepEqual(errors, []);
});

/** Sorting by size must not cost the field the order you dragged things into:
 *  cards of one size keep their rank order among themselves. */
test('rank still orders the cards of one size', async () => {
  const { page, errors } = await openAgents();
  const { ids, folderId } = await seedSix(page);

  await until(page, async () => (await cardsInOrder(page, folderId)).length === ids.length, 'six cards');
  // Rank the column back to front — the order no card was created in.
  await page.evaluate(async (rows) => {
    const order = [...rows].reverse();
    for (const [i, id] of order.entries()) {
      await window.marble.agent.update(id, { focusY: (i + 1) / (order.length + 1) });
    }
  }, ids);

  let cards = [];
  await until(page, async () => {
    cards = await cardsInOrder(page, folderId);
    return cards.length === ids.length && cards[0]?.id !== ids[0];
  }, 'the ranks to land');

  // Which cards are Digests is the LOD pass's call and recency moves it, so
  // the claim here is only about order: size first, then the rank filed.
  const ranks = await page.evaluate(async (rows) => Object.fromEntries(await Promise.all(
    rows.map(async (id) => [id, (await window.marble.agent.conversation(id))?.meta?.focusY]),
  )), ids);
  const tier = (card) => (card.lod === 'chip' ? 1 : 0);
  const expected = [...cards]
    .sort((a, b) => (tier(a) - tier(b)) || (ranks[a.id] - ranks[b.id]))
    .map((card) => card.id);
  assert.ok(cards.some((card) => card.lod === 'chip'), 'the group still mixes two sizes');
  assert.deepEqual(cards.map((card) => card.id), expected, 'size first, then rank');
  assert.notDeepEqual(cards.map((card) => card.id), ids, 'the ranks moved the column');
  assert.deepEqual(errors, []);
});
