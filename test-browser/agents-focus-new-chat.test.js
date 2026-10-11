/** Starting a chat while Focus is open.
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

/** A chat you start while Focus is open is one you mean to work in. It used to
 *  land in the field as one more card to go and find — and with nothing pinned
 *  the pane is off the canvas, so it landed nowhere you could see. */
test('a chat started while Focus is open joins the stage', async () => {
  const { page } = await openAgents();
  const seeded = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(id, { title: 'first' });
    return id;
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${seeded}"]`).dblclick();
  await page.locator(`.pane marble-conversation[conversation="${seeded}"]`).waitFor();
  await until(page, async () => (await metaOf(page, seeded))?.pinned === true, 'the seed to be pinned');

  await page.locator('.topbar .new').click();
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)').length === 2);
  const fresh = await page.evaluate(async (first) => (
    (await window.marble.agent.conversations()).map((row) => row.id).find((id) => id !== first)
  ), seeded);
  assert.ok(fresh, 'the button started a chat');

  await until(page, async () => (await metaOf(page, fresh))?.pinned === true, 'the new chat to be pinned');
  // It joins the stage; it does not take it over.
  assert.equal((await metaOf(page, seeded))?.pinned, true, 'the chat already on stage stayed');
  assert.equal(await page.locator(`.focus-card[data-id="${fresh}"]`).getAttribute('data-lod'), 'full');
  await page.locator(`.pane marble-conversation[conversation="${fresh}"]`).waitFor();
  // And it is the pane you are typing into.
  await until(
    page,
    async () => await page.locator(`.pane .dock-frame[data-focused]:has(marble-conversation[conversation="${fresh}"])`).count() === 1,
    'the new pane to be the focused one',
  );
});

/** And it joins as a column of its own, even with the rest — never as a pane
 *  tucked under the one you were in. The pane tree used to split the focused
 *  pane on its longer side, which is downward whenever a pane is taller than
 *  wide, which on the stage it always is. */
test('a chat started while Focus is open is a root column, even with the rest', async () => {
  const { page } = await openAgents();
  const seeded = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(id, { title: 'first' });
    return id;
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${seeded}"]`).dblclick();
  await page.locator(`.pane marble-conversation[conversation="${seeded}"]`).waitFor();
  await until(page, async () => (await metaOf(page, seeded))?.pinned === true, 'the seed to be pinned');

  await page.locator('.topbar .new').click();
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)').length === 2);
  const rects = () => page.evaluate(() => [...document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)')].map((frame) => {
    const r = frame.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  // The panes ease into place; wait for the layout to settle into columns.
  await until(page, async () => {
    const [a, b] = await rects();
    return a && b && Math.abs(a.y - b.y) <= 1 && Math.abs(a.h - b.h) <= 1 && Math.abs(a.x - b.x) > 10 && Math.abs(a.w - b.w) <= 2;
  }, 'two even columns');
  const [a, b] = await rects();
  assert.ok(Math.abs(a.y - b.y) <= 1 && Math.abs(a.h - b.h) <= 1, 'same top and height: columns, not a stack');
  assert.ok(Math.abs(a.x - b.x) > 10, 'side by side');
  assert.ok(Math.abs(a.w - b.w) <= 2, `even columns, got ${Math.round(a.w)} and ${Math.round(b.w)}`);
});
