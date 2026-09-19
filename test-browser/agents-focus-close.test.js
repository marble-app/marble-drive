/** Closing a pane in Focus. The stage is the person's own set: a pane that
 *  closes leaves the stage for good, the panes beside it keep their places,
 *  and nothing is promoted onto the stage to fill the gap.
 *
 *  Its own file, with its own copies of the helpers, for the reason
 *  agents-focus-groups.test.js gives: agents-focus.test.js is rewritten
 *  wholesale by other conversations and a test appended there gets dropped.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  permission: [{ ask: { tool: 'Bash', input: { command: 'ls' } } }, { say: 'after' }],
};

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
const AGENTS = raw
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const openAgents = async () => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
    try { localStorage.removeItem('marble-agents:focus-mode'); } catch { /* private */ }
  });
  return { page, errors };
};

const until = async (page, check, what) => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** The chats holding panes, left to right and top to bottom — the order the
 *  stage reads in. */
const panes = (page) => page.evaluate(() => (
  [...document.querySelectorAll('.pane marble-conversation[conversation]')]
    .map((el) => ({ id: el.getAttribute('conversation'), box: el.getBoundingClientRect() }))
    .sort((a, b) => (a.box.x - b.box.x) || (a.box.y - b.box.y))
    .map((row) => row.id)
));
const fullIds = (page) => page.evaluate(() => (
  [...document.querySelectorAll('.focus-card[data-lod="full"]')].map((el) => el.dataset.id).sort()
));
const metaOf = async (page, id) => (
  await page.evaluate((row) => window.marble.agent.conversation(row), id)
)?.meta ?? null;
const modeOf = (page) => page.evaluate(() => document.querySelector('.focus')?.dataset.mode ?? null);
const closePane = (page, id) => page.locator(`.dock-bar[data-id="${id}"] .dock-close`).click();

test('closing a pinned pane takes that chat off the stage and leaves the rest where they are', async () => {
  const { page, errors } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const made = [];
    for (const title of ['one', 'two', 'three', 'loose four', 'loose five']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title, pinned: made.length < 3 });
      made.push(id);
    }
    return made;
  });
  const [, , , d, e] = ids;
  await page.locator('.views [data-view="focus"]').click();
  await until(page, async () => (await panes(page)).length === 3, 'three pinned chats to hold the stage');
  const before = await panes(page);
  const middle = before[1];
  const rest = before.filter((id) => id !== middle);

  await closePane(page, middle);
  await until(page, async () => (await panes(page)).length === 2, 'the closed pane to go');
  await page.waitForTimeout(1500);

  assert.deepEqual(await panes(page), rest, 'the panes that stay keep their order and nothing floats up');
  assert.equal((await metaOf(page, middle))?.pinned ?? false, false, 'the closed chat is no longer pinned');
  for (const id of rest) assert.equal((await metaOf(page, id))?.pinned, true, 'the rest stay pinned');
  assert.deepEqual(await fullIds(page), [...rest].sort(), 'only the two remaining chats read as full');
  for (const id of [d, e]) {
    assert.equal((await metaOf(page, id))?.pinned ?? false, false, `${id} was not promoted onto the stage`);
  }
  assert.deepEqual(errors, []);
});

test('closing a pane in Active mode keeps the other panes and does not re-stage the closed chat', async () => {
  const { page, errors } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const made = [];
    for (const title of ['asking one', 'asking two', 'quiet three']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
      made.push(id);
    }
    return made;
  });
  const [a, b, c] = ids;
  for (const id of [a, b]) {
    await page.evaluate(async (row) => {
      await window.marble.agent.send(row, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] });
    }, id);
    await until(page, async () => (await metaOf(page, id))?.asking === true, 'the chat to be asking');
  }
  await page.locator('.views [data-view="focus"]').click();
  await page.locator('.focus-modes').waitFor();
  await page.locator('.focus-modes button[data-mode="active"]').click();
  await until(page, async () => (await panes(page)).length === 2, 'the two asking chats to hold the stage');

  await closePane(page, a);
  await until(page, async () => (await panes(page)).length === 1, 'the closed pane to go');
  await page.waitForTimeout(1500);

  assert.deepEqual(await panes(page), [b], 'the other asking chat stays on the stage alone');
  assert.equal(await modeOf(page), 'pinned', 'closing a pane is the person taking the stage over');
  assert.equal((await metaOf(page, b))?.pinned, true, 'the chat that stayed became a pin');
  assert.equal((await metaOf(page, a))?.pinned ?? false, false, 'the closed chat is not pinned');
  assert.equal((await metaOf(page, c))?.pinned ?? false, false, 'the quiet chat was not promoted');
  assert.deepEqual(errors, []);
});

test('closing the last pane empties the stage rather than promoting a card into it', async () => {
  const { page, errors } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const made = [];
    for (const title of ['only pin', 'loose two', 'loose three']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title, pinned: made.length < 1 });
      made.push(id);
    }
    return made;
  });
  const [a] = ids;
  await page.locator('.views [data-view="focus"]').click();
  await until(page, async () => (await panes(page)).length === 1, 'the pinned chat to hold the stage');

  await closePane(page, a);
  await until(page, async () => (await panes(page)).length === 0, 'the stage to empty');
  await page.waitForTimeout(1500);

  assert.deepEqual(await panes(page), [], 'no chat takes the empty stage');
  assert.deepEqual(await fullIds(page), [], 'and no card reads as full');
  for (const id of ids) assert.equal((await metaOf(page, id))?.pinned ?? false, false, 'nothing is pinned');
  assert.deepEqual(errors, []);
});
