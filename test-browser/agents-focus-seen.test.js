/** Seeing is reviewing. An answer that lands in the pane you are focused in
 *  has been read by the only means that counts — you, looking at it — so it
 *  never sits in Needs review waiting to be crossed off by hand as well.
 *
 *  Its own file, with its own copies of the helpers, for the reason
 *  agents-focus-close.test.js gives: the shared focus test files are
 *  rewritten wholesale by other conversations and a test appended there
 *  gets dropped.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  answer: [{ say: 'Just an answer.' }],
};

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
const AGENTS = raw
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

/** Every page is closed when its test ends. These tests assert what the
 *  *server* believes, and a page left open is a second pair of eyes: it keeps
 *  streaming, picks up the conversations the next test makes, and marks the
 *  one its own dock is focused on as seen. */
const openAgents = async (t) => {
  await host.reset();
  const { page, errors } = await host.newPage();
  t.after(() => page.context().close());
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

/** The one pane wearing the focus tint — the chat the person is in. */
const focusedId = (page) => page.evaluate(() => (
  document.querySelector('.pane marble-conversation[conversation][data-focused="true"]')?.getAttribute('conversation') ?? null
));

/** The server's answer, not the page's: marking seen has to actually land. */
const metaOf = async (page, id) => (
  await page.evaluate((row) => window.marble.agent.conversation(row), id)
)?.meta ?? null;

const pin = (page, titles) => page.evaluate(async (names) => {
  const agent = window.marble.agent;
  const made = [];
  for (const title of names) {
    const id = await agent.start({ provider: 'fake' });
    await agent.update(id, { title, pinned: true });
    made.push(id);
  }
  return made;
}, titles);

const answer = (page, id) => page.evaluate(async (row) => {
  await window.marble.agent.send(row, { prompt: 'script:answer', target: 'garden', viewing: 'Agents', selection: [] });
}, id);

const finished = async (page, id) => {
  const meta = await metaOf(page, id);
  return Boolean(meta && !meta.running && meta.lastFinishedAt);
};

test('focusing a pane whose turn already finished counts as reviewing it', async (t) => {
  const { page, errors } = await openAgents(t);
  const ids = await pin(page, ['one', 'two']);
  await page.locator('.views [data-view="focus"]').click();
  await until(page, async () => (await panes(page)).length === 2, 'both pins to hold panes');

  // The chat you are *not* in answers, so it has to ask to be read.
  const here = await focusedId(page);
  const other = ids.find((id) => id !== here);
  await answer(page, other);
  await until(page, async () => (await metaOf(page, other))?.needsReview === true, 'the unwatched chat to need review');
  await page.locator(`.conv[data-id="${other}"][data-state="unseen"]`).waitFor({ state: 'attached' });

  // Focusing its pane is reading it.
  await page.locator(`.dock-bar[data-id="${other}"]`).click({ position: { x: 10, y: 10 } });
  assert.equal(await focusedId(page), other, 'the bar takes the focus');
  await until(page, async () => (await metaOf(page, other))?.needsReview === false, 'focus to count as review');
  await page.locator(`.conv[data-id="${other}"][data-state="idle"]`).waitFor({ state: 'attached' });
  assert.deepEqual(errors, []);
});

test('a turn that finishes in the pane you are in never enters Needs review', async (t) => {
  const { page, errors } = await openAgents(t);
  await pin(page, ['one', 'two']);
  await page.locator('.views [data-view="focus"]').click();
  await until(page, async () => (await panes(page)).length === 2, 'both pins to hold panes');

  const watched = await focusedId(page);
  await answer(page, watched);
  await until(page, () => finished(page, watched), 'the watched turn to finish');
  await until(page, async () => (await metaOf(page, watched))?.needsReview === false, 'the watched answer to be seen');
  assert.equal(await page.locator(`.conv[data-id="${watched}"]`).getAttribute('data-state'), 'idle');
  assert.deepEqual(errors, []);
});

test('an answer that arrived while you were elsewhere is seen when you arrive in front of it', async (t) => {
  const { page, errors } = await openAgents(t);
  const [only] = await pin(page, ['alone']);
  await answer(page, only);
  await until(page, async () => (await metaOf(page, only))?.needsReview === true, 'the answer to need review');

  await page.locator('.views [data-view="focus"]').click();
  await until(page, async () => (await panes(page)).length === 1, 'the pin to hold the stage');
  assert.equal(await focusedId(page), only);
  await until(page, async () => (await metaOf(page, only))?.needsReview === false, 'arriving to count as review');
  assert.deepEqual(errors, []);
});

test('a chat you are not in keeps its unseen dot', async (t) => {
  const { page, errors } = await openAgents(t);
  const ids = await pin(page, ['one', 'two']);
  await page.locator('.views [data-view="focus"]').click();
  await until(page, async () => (await panes(page)).length === 2, 'both pins to hold panes');
  const here = await focusedId(page);
  const other = ids.find((id) => id !== here);

  await answer(page, other);
  await until(page, () => finished(page, other), 'the unwatched turn to finish');
  // Long enough that a repaint racing the assertion would have happened.
  await page.waitForTimeout(250);
  assert.equal((await metaOf(page, other))?.needsReview, true, 'unwatched work still asks to be read');
  assert.deepEqual(errors, []);
});
