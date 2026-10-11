/** The peek: resting a pointer on a Focus card says what that chat was about
 *  — the last thing you asked and the last thing that came back — without
 *  opening it and without counting as having read it.
 *
 *  Its own file, with its own copies of the helpers, for the reason
 *  agents-focus-seen.test.js gives: the shared focus test files are rewritten
 *  wholesale by other conversations and a test appended there gets dropped.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  // A turn with something in it: a write, two tool calls, and an answer with
  // markdown in it, so the peek has each of its parts to draw.
  work: [
    { call: 'read_document', args: { path: 'garden' } },
    { tool: 'Bash', input: { command: 'node --test test/agent-folders.test.js', description: 'Run the folder tests' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading to **Backlog** and left the questions alone.' },
  ],
};

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
const AGENTS = raw
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, Agents: AGENTS } });
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

const until = async (page, check, what) => {
  for (let i = 0; i < 120; i += 1) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const metaOf = async (page, id) => (
  await page.evaluate((row) => window.marble.agent.conversation(row), id)
)?.meta ?? null;

/** Two loose chats, one of them with a finished turn behind it. */
const twoChats = async (page) => {
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'the worked one', pinned: false });
    await agent.update(b, { title: 'the empty one', pinned: false });
    await agent.send(a, {
      prompt: 'script:work Rename the heading of the garden, and tell me what you left alone.',
      target: 'garden',
      viewing: 'Agents',
      selection: [],
    });
    return { a, b };
  });
  await until(page, async () => {
    const meta = await metaOf(page, ids.a);
    return Boolean(meta && !meta.running && meta.lastFinishedAt);
  }, 'the scripted turn to finish');
  return ids;
};

const peekText = (page) => page.evaluate(() => document.querySelector('.focus-look')?.innerText ?? '');

test('resting on a card peeks at what the chat was about', async (t) => {
  const { page, errors } = await openAgents(t);
  const ids = await twoChats(page);
  await page.locator('.views [data-view="focus"]').click();
  const card = page.locator(`.focus-card[data-id="${ids.a}"]`);
  await card.waitFor();

  await card.hover();
  await page.locator('.focus-look').waitFor();
  await until(page, async () => (await peekText(page)).includes('Backlog'), 'the answer to arrive in the peek');
  const text = await peekText(page);
  assert.match(text, /Rename the heading of the garden/, 'what you asked');
  assert.match(text, /Renamed the heading to Backlog/, 'what came back, without its markdown');
  assert.match(text, /garden/, 'the document it wrote to');

  // A peek is not an opening and not a review: the whole point of it is
  // deciding whether to open the thing, which reading it would foreclose.
  assert.equal(await card.getAttribute('data-lod'), 'digest');
  const meta = await metaOf(page, ids.a);
  assert.equal(meta.pinned, false);
  assert.equal(meta.needsReview, true, 'resting a pointer on a card does not count as reading it');
  assert.deepEqual(errors, []);
});

test('the peek follows the pointer to the next card and leaves with it', async (t) => {
  const { page, errors } = await openAgents(t);
  const ids = await twoChats(page);
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.a}"]`).hover();
  await page.locator(`.focus-look[data-id="${ids.a}"]`).waitFor();

  await page.locator(`.focus-card[data-id="${ids.b}"]`).hover();
  await page.locator(`.focus-look[data-id="${ids.b}"]`).waitFor();

  await page.mouse.move(4, 4);
  await page.locator('.focus-look').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
});

test('Space holds the peek open, and the pointer leaving does not take it away', async (t) => {
  const { page, errors } = await openAgents(t);
  const ids = await twoChats(page);
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.a}"]`).click();
  await page.keyboard.press('Space');
  await page.locator('.focus-look[data-held]').waitFor();

  await page.mouse.move(4, 4);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.focus-look').count(), 1, 'a held peek stays');

  await page.keyboard.press('Escape');
  await page.locator('.focus-look').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
});

test('a Full card has its pane on top of it and is not peeked at', async (t) => {
  const { page, errors } = await openAgents(t);
  const ids = await twoChats(page);
  await page.locator('.views [data-view="focus"]').click();
  const card = page.locator(`.focus-card[data-id="${ids.a}"]`);
  await card.dblclick();
  await page.waitForFunction((id) => (
    document.querySelector(`.focus-card[data-id="${id}"]`)?.dataset.lod === 'full'
  ), ids.a);

  // The card is under its pane; hovering the stage is hovering the pane.
  await page.evaluate((id) => {
    const el = document.querySelector(`.focus-card[data-id="${id}"]`);
    const box = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerover', {
      bubbles: true, pointerType: 'mouse', clientX: box.left + 8, clientY: box.top + 8,
    }));
  }, ids.a);
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.focus-look').count(), 0);
  assert.deepEqual(errors, []);
});
