// The line (v5, Notes and Sketches/Ask at Anything, "Asking, flush with the
// thing"): ⌘J tints the thing and grows one line under it, as wide as it is.
// The line is the only place words go in and the only place words come back:
// ⏎ folds it into the thing, and what answers is the thing changing. A
// question's answer, a change that could not be made and a question back all
// come back in the same line; nothing about the conversation is drawn.

import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

// Rows are flex lines, so a row is a part of the list rather than one block
// of words (the caret's, agent-text.js): its change is tinted (change-marks.js).
const LIST = `<!doctype html>
<html><head><meta charset="utf-8"><title>Reading list</title>
<style>
  body { font: 16px/1.5 Georgia, serif; margin: 40px; max-width: 560px; }
  li { display: flex; justify-content: space-between; padding: 6px 0; }
</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Reading list</h1>
  <p data-marble-id="p">Local-first apps keep your data on your machine and sync when they can, so the network is never the thing you wait on.</p>
  <ul data-marble-id="list">
    <li data-marble-id="r1"><span data-marble-id="r1n">Malleable software</span><span data-marble-id="r1s">Unread</span></li>
    <li data-marble-id="r2"><span data-marble-id="r2n">Local-first</span><span data-marble-id="r2s">Unread</span></li>
    <li data-marble-id="r3"><span data-marble-id="r3n">Dynamicland</span><span data-marble-id="r3s">Read</span></li>
  </ul>
  <input data-marble-id="note" aria-label="A note">
</body></html>
`;

const due = (id, value) => ({ type: 'setAttr', id, name: 'data-due', value });
const SCRIPTS = {
  due: [
    { call: 'read_document', args: { path: 'list' } },
    { call: 'apply_ops', args: { path: 'list', note: 'Add a due date.', ops: [due('r2', 'Oct 9')] } },
    { sleep: 600 },
    { say: 'Done.' },
  ],
  why: [{ say: 'You opened it on Sep 28 and never marked it read.' }],
  cant: [{ say: 'None of these has a date to use. I looked at every row. Nothing else.' }],
  which: [
    { call: 'read_document', args: { path: 'list' } },
    { ask: { tool: 'AskUserQuestion', input: { questions: [{ question: 'Which date?', header: 'Date', options: [{ label: 'Due', description: '' }, { label: 'Added', description: '' }], multiSelect: false }] } } },
    { call: 'apply_ops', args: { path: 'list', note: 'Add the due dates.', ops: [due('r1', 'Oct 9')] } },
    { say: 'Done.' },
  ],
  hold: [{ silent: 20_000 }],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { list: LIST } });
test.after(() => host.close());

const pages = [];
const closePages = async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); };
test.after(closePages);

const clearConversations = async () => {
  const list = await (await fetch(`${host.base}/agent/conversations`)).json();
  for (const summary of list) {
    const detail = await (await fetch(`${host.base}/agent/conversations/${summary.id}`)).json();
    for (const turn of detail.turns ?? []) {
      if (turn.status === 'running') await fetch(`${host.base}/agent/turns/${turn.id}/cancel`, { method: 'POST' });
      if (turn.status === 'queued') await fetch(`${host.base}/agent/turns/${turn.id}`, { method: 'DELETE' });
    }
    await fetch(`${host.base}/agent/conversations/${summary.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }),
    });
  }
};

const open = async ({ viewport = { width: 1280, height: 800 } } = {}) => {
  await closePages();
  await host.reset();
  await clearConversations();
  const { page, errors } = await host.newPage({ viewport });
  pages.push(page);
  await page.goto(`${host.base}/a/list`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleLine));
  page.errors = errors;
  return page;
};

// The line on screen: one sent a moment ago may still be folding into its
// thing, and one put away may still be fading.
const line = (page) => page.locator('.marble-line:not([data-state="sent"]):not([data-leaving])');
const input = (page) => page.locator('.marble-line:not([data-state="sent"]):not([data-leaving]) .marble-line-input');
const lineGone = (page) => page.waitForFunction(() => !document.querySelector('.marble-line'), null, { timeout: 5000 });
const boxOf = (page, id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();
const pointAt = async (page, id) => {
  const r = await boxOf(page, id);
  await page.mouse.move(r.x + 12, r.y + r.height / 2);
};
const summon = (page) => page.keyboard.press('Control+j');
const drawerOpen = (page) => page.evaluate(() => document.querySelector('marble-agent-drawer')?.isOpen === true);

// waitForFunction does not wait on a Promise, so a question for the host is
// asked again until it has an answer.
const until = async (page, fn, arg, { timeout = 10_000 } = {}) => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting for the host');
    await page.waitForTimeout(100);
  }
};
const conversations = (page) => page.evaluate(async () => {
  const out = [];
  for (const s of await window.marble.agent.conversations()) out.push({ summary: s, detail: await window.marble.agent.conversation(s.id) });
  return out;
});
const caretAtEnd = (page) => page.evaluate(() => {
  const el = document.querySelector('.marble-line .marble-line-input');
  const sel = getSelection();
  if (!el || !sel.rangeCount || !sel.isCollapsed || !el.contains(sel.anchorNode)) return false;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(sel.anchorNode, sel.anchorOffset);
  return before.toString().length === el.textContent.length;
});

test('⌘J on a selected phrase hangs one line under its paragraph, flush with it, and the words take the tint', async () => {
  const page = await open();
  await page.evaluate(() => {
    const text = document.querySelector('[data-marble-id="p"]').firstChild;
    const at = text.data.indexOf('keep your data');
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + 'keep your data'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForFunction(() => window.marble.agent.context().selection.includes('p'));
  await summon(page);
  await line(page).waitFor();
  assert.equal(await page.locator('.marble-callout').count(), 0, 'no card');
  const [para, box] = await Promise.all([boxOf(page, 'p'), line(page).boundingBox()]);
  assert.ok(Math.abs(box.x - para.x) <= 1, `left edges: ${box.x} vs ${para.x}`);
  assert.ok(Math.abs(box.x + box.width - (para.x + para.width)) <= 1, 'right edges');
  assert.ok(Math.abs(box.y - (para.y + para.height + 10)) <= 1, 'it hangs 10px under the paragraph');
  assert.equal(await input(page).getAttribute('data-placeholder'), 'Change these words');
  assert.equal(await page.evaluate(() => CSS.highlights.get('marble-line-words')?.size ?? 0), 1, 'the words are tinted');
  assert.equal(await page.locator('.marble-line-scope:not([hidden])').count(), 0, 'and nothing is boxed');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('marble-line-input')), true, 'typing goes into it');
  // Nothing on the page says who will do it.
  const words = await page.locator('.marble-line-host').evaluate((el) => [el.innerText, ...[...el.querySelectorAll('[aria-label]')].map((n) => n.getAttribute('aria-label'))].join(' '));
  assert.doesNotMatch(words, /\bagent\b/i);
  assert.deepEqual(page.errors, []);
});

test('⌘J with nothing under the pointer or caret is about the page: one line at the foot of the window, and the chat stays shut', async () => {
  const page = await open();
  await page.mouse.move(900, 600);
  await summon(page);
  await line(page).waitFor();
  assert.equal(await line(page).getAttribute('data-scope'), 'page');
  assert.equal(await input(page).getAttribute('data-placeholder'), 'Change this page');
  const box = await line(page).boundingBox();
  assert.ok(Math.abs(box.x + box.width / 2 - 640) <= 1, 'centred');
  assert.ok(Math.abs(box.y + box.height - (800 - 16)) <= 1, '16px from the bottom');
  assert.ok(Math.abs(box.width - 560) <= 1, 'min(560px, 100vw − 32px)');
  assert.equal(await page.locator('.marble-line-scope:not([hidden])').count(), 0, 'the page is not tinted');
  await page.waitForTimeout(200);
  assert.equal(await drawerOpen(page), false);
  // A second ⌘J puts it away.
  await summon(page);
  await lineGone(page);
  assert.equal(await drawerOpen(page), false);
});

test('Esc puts the line away and keeps the words for the next ⌘J on the same thing, with the caret at the end', async () => {
  const page = await open();
  await pointAt(page, 'r2');
  await summon(page);
  await input(page).waitFor();
  assert.equal(await input(page).getAttribute('data-placeholder'), 'Change this row');
  await page.keyboard.type('Add a due date');
  await page.keyboard.press('Escape');
  await lineGone(page);
  assert.equal((await conversations(page)).length, 0, 'nothing was sent');
  await summon(page);
  await input(page).waitFor();
  assert.equal(await input(page).textContent(), 'Add a due date');
  assert.equal(await caretAtEnd(page), true);
  // Somewhere else, the line starts empty.
  await page.keyboard.press('Escape');
  await lineGone(page);
  await pointAt(page, 'r3');
  await summon(page);
  await input(page).waitFor();
  assert.equal(await input(page).textContent(), '');
});

test('⏎ folds the line into the row; the change is tinted part by part, and no card is drawn', async () => {
  const page = await open();
  await pointAt(page, 'r2');
  await summon(page);
  await input(page).waitFor();
  await page.evaluate(() => {
    window.__tinted = false;
    new MutationObserver(() => { if (document.querySelector('.marble-change-tint')) window.__tinted = true; })
      .observe(document.documentElement, { childList: true, subtree: true });
  });
  await page.keyboard.type('script:due Add a due date');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.marble-line')?.dataset.state === 'sent');
  await lineGone(page);
  await page.waitForFunction(() => window.__tinted, null, { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('[data-marble-id="r2"]')?.getAttribute('data-due') === 'Oct 9', null, { timeout: 8000 });
  assert.equal(await page.locator('.marble-callout').count(), 0, 'no card');
  const [{ detail, summary }] = await conversations(page);
  assert.deepEqual(detail.turns[0].context.selection, ['r2']);
  assert.match(detail.turns[0].context.brief, /in place/);
  assert.equal(detail.turns[0].prompt, 'script:due Add a due date', 'the chat shows only what was typed');
  assert.equal(await page.evaluate((id) => window.marble.agent.attending(id), summary.id), true);
  // Done: nothing reopens, and nothing of the line is left.
  await until(page, async () => (await window.marble.agent.conversations())[0]?.running === false);
  await page.waitForTimeout(400);
  assert.equal(await line(page).count(), 0);
  await page.waitForFunction(() => !document.querySelector('.marble-line-scope'), null, { timeout: 3000 });
});

test('a question is answered in the line, and Ask more carries on the same conversation', async () => {
  const page = await open();
  await pointAt(page, 'r2');
  await summon(page);
  await input(page).waitFor();
  await page.keyboard.type('script:why Why is this still unread?');
  await page.keyboard.press('Enter');
  await page.locator('.marble-line[data-state="answer"]').waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('.marble-line-answer').innerText(), 'You opened it on Sep 28 and never marked it read.');
  const more = input(page);
  assert.equal(await more.getAttribute('data-placeholder'), 'Ask more');
  await more.click();
  await page.keyboard.type('script:why And the others?');
  await page.keyboard.press('Enter');
  const [only, ...rest] = await until(page, async () => {
    const list = await window.marble.agent.conversations();
    const detail = list[0] && await window.marble.agent.conversation(list[0].id);
    return detail?.turns?.length === 2 ? list : null;
  });
  assert.equal(rest.length, 0, 'one conversation');
  assert.ok(only.id);
  await page.locator('.marble-line[data-state="answer"]').waitFor({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await lineGone(page);
});

test('a change that could not be made gives the words back, with why above them', async () => {
  const page = await open();
  await pointAt(page, 'list');
  await summon(page);
  await input(page).waitFor();
  await page.keyboard.type('script:cant Add a due date to each');
  await page.keyboard.press('Enter');
  await page.locator('.marble-line[data-state="cant"]').waitFor({ timeout: 10_000 });
  assert.equal(await input(page).textContent(), 'script:cant Add a due date to each');
  assert.equal(await page.locator('.marble-line-said').innerText(), 'None of these has a date to use. I looked at every row.', 'the first two sentences');
  assert.equal(await caretAtEnd(page), true);
  // Said another way, in the same conversation.
  await page.keyboard.type(' today');
  await page.keyboard.press('Enter');
  await until(page, async () => {
    const list = await window.marble.agent.conversations();
    return list.length === 1 && (await window.marble.agent.conversation(list[0].id)).turns?.length === 2;
  });
  await page.locator('.marble-line[data-state="cant"]').waitFor({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await lineGone(page);
});

test('a question back opens the line with its choices, and a press answers it', async () => {
  const page = await open();
  await pointAt(page, 'list');
  await summon(page);
  await input(page).waitFor();
  await page.keyboard.type('script:which Add a due date to each');
  await page.keyboard.press('Enter');
  await page.locator('.marble-line[data-state="ask"]').waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('.marble-line-question').innerText(), 'Which date?');
  assert.deepEqual(await page.locator('.marble-line-opt').allInnerTexts(), ['Due', 'Added']);
  await page.locator('.marble-line-opt', { hasText: 'Due' }).click();
  await lineGone(page);
  const said = await until(page, async () => {
    const [s] = await window.marble.agent.conversations();
    const detail = s && await window.marble.agent.conversation(s.id);
    return detail?.turns?.[0]?.status === 'completed' ? detail.events.filter((e) => e.type === 'text').map((e) => e.text) : null;
  });
  assert.ok(said.includes('answered:allow:Due'), said.join(' | '));
  await page.waitForTimeout(400);
  assert.equal(await line(page).count(), 0, 'a change that landed reopens nothing');
});

test('Esc stops a running change only when the page has the keys', async () => {
  const page = await open();
  await pointAt(page, 'r2');
  await summon(page);
  await input(page).waitFor();
  await page.keyboard.type('script:hold Add a due date');
  await page.keyboard.press('Enter');
  const first = await until(page, () => window.marbleLine.running());
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Escape');
  await until(page, async (turn) => {
    const [s] = await window.marble.agent.conversations();
    return (await window.marble.agent.conversation(s.id)).turns.find((t) => t.id === turn)?.status === 'cancelled';
  }, first.turn);
  await page.waitForFunction(() => window.marbleLine.running() === null);

  // Below the row: the stopped change's tag hangs over the row above it.
  await pointAt(page, 'r3');
  await summon(page);
  await input(page).waitFor();
  await page.keyboard.type('script:hold Again');
  await page.keyboard.press('Enter');
  const second = await until(page, () => window.marbleLine.running());
  await page.focus('[data-marble-id="note"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const status = await page.evaluate(async ({ conversation, turn }) => (await window.marble.agent.conversation(conversation)).turns.find((t) => t.id === turn)?.status, second);
  assert.equal(status, 'running', 'Esc in a field is the field\'s');
  await page.evaluate(({ turn }) => window.marble.agent.cancel(turn), second);
});

test('[ widens the line from a row to its list, and ] narrows it back', async () => {
  const page = await open();
  await pointAt(page, 'r2');
  await summon(page);
  await input(page).waitFor();
  assert.equal(await input(page).getAttribute('data-placeholder'), 'Change this row');
  await page.keyboard.press('BracketLeft');
  assert.equal(await input(page).getAttribute('data-placeholder'), 'Change this list');
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['list']);
  const [list, box] = await Promise.all([boxOf(page, 'list'), line(page).boundingBox()]);
  assert.ok(Math.abs(box.y - (list.y + list.height + 10)) <= 1, 'it hangs under the list now');
  await page.keyboard.press('BracketRight');
  assert.equal(await input(page).getAttribute('data-placeholder'), 'Change this row');
  assert.equal(await input(page).textContent(), '', '[ and ] are not typed');
});

test('at phone width ⌘J opens the drawer, as before', async () => {
  const page = await open({ viewport: { width: 390, height: 760 } });
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-marble-id="r2n"]'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForFunction(() => window.marble.agent.context().selection.length > 0);
  await summon(page);
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  assert.equal(await line(page).count(), 0);
});

test('Describe mode still borrows the card, and ⌘J there means that card', async () => {
  const page = await open();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').hover();
  await drawer.locator('.tool[data-tool="marks-describe"]').click();
  await page.locator('.marble-marks-bar').waitFor();
  const list = await boxOf(page, 'list');
  await page.mouse.move(list.x - 6, list.y - 6);
  await page.mouse.down();
  await page.mouse.move(list.x + list.width + 6, list.y + list.height + 6, { steps: 4 });
  await page.mouse.up();
  await page.locator('.marble-callout[data-state]').waitFor();
  assert.equal(await line(page).count(), 0);
  await summon(page);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.marble-callout').count(), 1);
  assert.equal(await line(page).count(), 0);
});
