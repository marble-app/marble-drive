/** ⌘⇧O starts a chat. The chord is the one the CLI and the desktop app use,
 *  and it has to hold while you are typing: the moment you most want a new
 *  chat is mid-sentence in the wrong one.
 *
 *  Its own file, for the reason agents-new-chat.test.js gives: the older
 *  agents tests get rewritten wholesale by other conversations, and a test
 *  appended there is dropped without failing anything.
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

// A live Agents.mrbl can be older than the template — the page's script is
// written into the document, so a drive catches up only when the doc is
// rewritten. This is that page: the chord stripped out of its script, the
// runtime's fallback left to answer it.
const LEGACY = (() => {
  const start = AGENTS.indexOf('      // \u2318\u21e7O starts a chat from anywhere');
  const end = AGENTS.indexOf('      if (handleFocusKeys(event)) return;');
  if (start < 0 || end < 0) throw new Error('the page chord block moved');
  return `${AGENTS.slice(0, start)}${AGENTS.slice(end)}`
    .replace("    window.marbleAgentNewChatKey = 'page';\n", '');
})();

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS, AgentsOld: LEGACY } });
test.after(() => host.close());

const openAgents = async (doc = 'Agents') => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/${doc}`);
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
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const live = (page) => page.evaluate(async () => (await window.marble.agent.conversations()).map((row) => row.id));

test('⌘⇧O starts a chat and opens it', async () => {
  const { page, errors } = await openAgents();
  assert.deepEqual(await live(page), [], 'the drive starts empty');

  await page.keyboard.press('ControlOrMeta+Shift+O');
  await until(page, async () => (await live(page)).length === 1, 'the chat to start');

  const [id] = await live(page);
  await until(page, async () => (await page.getAttribute('body', 'data-open')) === 'true', 'the pane to open');
  assert.equal(await page.locator('.pane marble-conversation').first().getAttribute('conversation'), id);
  assert.deepEqual(errors, []);
});

test('⌘⇧O works with the caret in a composer, and types nothing into it', async () => {
  const { page, errors } = await openAgents();
  await page.keyboard.press('ControlOrMeta+Shift+O');
  await until(page, async () => (await live(page)).length === 1, 'the first chat');
  const [first] = await live(page);

  const editor = page.locator(`.pane marble-conversation[conversation="${first}"] .editor`);
  await editor.click();
  await editor.pressSequentially('half a sentence');
  await editor.press('ControlOrMeta+Shift+O');
  await until(page, async () => (await live(page)).length === 2, 'a second chat from inside the box');

  const second = (await live(page)).find((row) => row !== first);
  const box = page.locator(`.pane marble-conversation[conversation="${second}"] .editor`);
  await box.waitFor();
  // The box the pane carries over is the draft's business (pressing New does
  // the same). What the chord must never do is leave a letter behind.
  assert.doesNotMatch(await box.evaluate((el) => el.value), /o/i, 'the chord starts a chat rather than typing an O');
  assert.deepEqual(errors, []);
});

test('the New button says which chord it answers to', async () => {
  const { page } = await openAgents();
  const button = page.locator('header.topbar .new');
  assert.match(await button.getAttribute('title'), /⌘⇧O/);
  assert.equal(await button.getAttribute('aria-keyshortcuts'), 'Meta+Shift+O');
});

test('a page whose script predates the chord still answers it', async () => {
  const { page, errors } = await openAgents('AgentsOld');
  assert.equal(await page.evaluate(() => window.marbleAgentNewChatKey ?? null), null, 'the old page does not claim it');

  await page.keyboard.press('ControlOrMeta+Shift+O');
  await until(page, async () => (await live(page)).length === 1, 'the runtime to start the chat');
  assert.deepEqual(errors, []);
});

test('the page and the runtime never both answer the chord', async () => {
  const { page } = await openAgents();
  assert.equal(await page.evaluate(() => window.marbleAgentNewChatKey), 'page');
  await page.keyboard.press('ControlOrMeta+Shift+O');
  await page.waitForTimeout(600);
  assert.equal((await live(page)).length, 1, 'one press, one chat');
});
