/** A chat that has not been used yet. It is called New Chat rather than
 *  Untitled, and on the Focus stage the close button on its pane discards
 *  it: pressing New and changing your mind should leave the drive as it was.
 *  The moment there is a message in the box — sent or not — it is a chat
 *  like any other and closing only takes it off the stage.
 *
 *  Its own file, for the reason agents-focus-close.test.js gives: the older
 *  agents tests are rewritten wholesale by other conversations, and a test
 *  appended there gets dropped.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  hold: [{ silent: 20_000 }],
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

const panes = (page) => page.evaluate(() => (
  [...document.querySelectorAll('.pane marble-conversation[conversation]')].map((el) => el.getAttribute('conversation'))
));
const live = (page) => page.evaluate(async () => (await window.marble.agent.conversations()).map((row) => row.id));
const closePane = (page, id) => page.locator(`.dock-bar[data-id="${id}"] .dock-close`).click();

/** Press New in Focus and wait for the pane it opens. */
const pressNew = async (page) => {
  await page.locator('.views [data-view="focus"]').click();
  const before = await panes(page);
  await page.locator('.new').click();
  await until(page, async () => (await panes(page)).length > before.length, 'the new chat to take a pane');
  const id = (await panes(page)).find((row) => !before.includes(row));
  assert.ok(id, 'the new chat holds a pane');
  return id;
};

test('a chat nobody has spoken in is called New Chat', async () => {
  const { page, errors } = await openAgents();
  // Pinned on the way in: a bare start is not streamed, and the pin is what
  // puts the same untitled chat on the stage as well as in the list.
  const id = await page.evaluate(async () => {
    const row = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(row, { pinned: true });
    return row;
  });
  await until(page, async () => Boolean(await page.$(`.conv[data-id="${id}"]`)), 'the row to arrive');

  const row = await page.locator(`.conv[data-id="${id}"] .title`).textContent();
  assert.equal(row.trim(), 'New Chat', 'the list row names it');

  await page.locator('.views [data-view="focus"]').click();
  await until(page, async () => (await panes(page)).includes(id), 'the pane');
  const bar = await page.locator(`.dock-bar[data-id="${id}"] .dock-title`).textContent();
  assert.equal(bar.trim(), 'New Chat', 'and so does its pane');
  assert.deepEqual(errors, []);
});

test('closing a brand-new pane discards the chat', async () => {
  const { page, errors } = await openAgents();
  const id = await pressNew(page);
  assert.ok((await live(page)).includes(id), 'the chat exists while the pane is open');

  await closePane(page, id);
  await until(page, async () => !(await live(page)).includes(id), 'the chat to be discarded');
  await page.waitForTimeout(500);

  assert.deepEqual(await panes(page), [], 'the pane is gone');
  assert.equal(await page.$(`.conv[data-id="${id}"]`), null, 'and no row is left behind');
  assert.deepEqual(errors, []);
});

test('closing a pane whose box has words in it keeps the chat', async () => {
  const { page, errors } = await openAgents();
  const id = await pressNew(page);
  const editor = page.locator(`.pane marble-conversation[conversation="${id}"] .editor`);
  await editor.fill('half a thought');
  await until(page, async () => Boolean(await editor.textContent()), 'the words to land in the box');

  await closePane(page, id);
  await until(page, async () => (await panes(page)).length === 0, 'the pane to close');
  await page.waitForTimeout(800);

  assert.ok((await live(page)).includes(id), 'an unsent draft is still a chat');
  assert.ok(await page.$(`.conv[data-id="${id}"]`), 'and it keeps its row');
  assert.deepEqual(errors, []);
});

test('closing a pane that has been asked something keeps the chat', async () => {
  const { page, errors } = await openAgents();
  const id = await pressNew(page);
  await page.evaluate((row) => window.marble.agent.send(row, {
    prompt: 'script:hold', target: 'garden', viewing: 'Agents', selection: [],
  }), id);
  await until(page, async () => Boolean((await page.evaluate((row) => window.marble.agent.conversation(row), id))?.meta?.title), 'the prompt to name the chat');

  await closePane(page, id);
  await until(page, async () => (await panes(page)).length === 0, 'the pane to close');
  await page.waitForTimeout(800);

  assert.ok((await live(page)).includes(id), 'a chat with a turn in it stays');
  assert.deepEqual(errors, []);
});
