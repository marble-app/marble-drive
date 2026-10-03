import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  building: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { sleep: 1500 },
    { say: 'done' },
  ],
  // Structure, not words: an item added to the list. Its zone is a box.
  listing: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'add a question', ops: [{ type: 'insert', parentId: 'q', beforeId: null, html: '<li>What does a tool owe the person using it?</li>' }] } },
    { sleep: 1500 },
    { say: 'done' },
  ],
  holdList: [
    { call: 'read_document', args: { path: 'garden', ids: ['q'] } },
    { silent: 20_000 },
  ],
  hold: [{ silent: 20_000 }],
  quiet: [{ say: 'Nothing to change.' }],
};

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

// A document with an automation in it: a button carrying its own brief.
const RUNNABLE = `<!doctype html><html><head><title>Reading list</title></head>
<body data-marble-id="b"><table data-marble-id="t"><tbody data-marble-id="tb">
<tr data-marble-id="r2"><td data-marble-id="c1">Generative Agents <button data-marble-id="fill" data-marble-run="script:quiet Look it up by its title and fill the rest." data-marble-scope="r2" data-marble-on="press">Fill</button></td><td data-marble-id="c2">—</td></tr>
</tbody></table></body></html>`;

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, Agents: AGENTS, runnable: RUNNABLE } });
test.after(() => host.close());

// A reset drive keeps its conversations, and this layer rebuilds a callout
// for every unreviewed chat about the document it opens — so one test's chat
// would hang over the next test's page.
// A turn left running is a live child process, so this stops them as well as
// filing them: several 20-second holds at once is a slow machine, not a test.
const clearConversations = async () => {
  const list = await (await fetch(`${host.base}/agent/conversations`)).json();
  for (const summary of list) {
    if (summary.status === 'running' || summary.queued) {
      const detail = await (await fetch(`${host.base}/agent/conversations/${summary.id}`)).json();
      for (const turn of detail.turns ?? []) {
        if (turn.status === 'running') await fetch(`${host.base}/agent/turns/${turn.id}/cancel`, { method: 'POST' });
        if (turn.status === 'queued') await fetch(`${host.base}/agent/turns/${turn.id}`, { method: 'DELETE' });
      }
    }
    await fetch(`${host.base}/agent/conversations/${summary.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
  }
};

// Every page left open keeps its streams and rebuilds its own callouts; a
// file's worth of them is a busy machine, not a test.
const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

// Agent settings › Chat holds the switches that stood in the tray until v4.
async function setChatPref(page, label, on) {
  await page.evaluate(() => window.marble.agent.openSettings('chat'));
  const sheet = page.locator('marble-agent-settings');
  await sheet.getByRole('checkbox', { name: label }).setChecked(on);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => document.querySelector('marble-agent-settings')?.getAttribute('data-open') === 'false');
}

const open = async (doc = 'garden', { width = 1200, height = 800 } = {}) => {
  await closePages();
  await host.reset();
  await clearConversations();
  const { page } = await host.newPage();
  pages.push(page);
  await page.setViewportSize({ width, height });
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  return page;
};

// selectionchange is queued, not synchronous: a gesture that reads the
// context has to wait for it the way a person's hand does.
const select = async (page, id) => {
  await page.evaluate((mid) => {
    const el = document.querySelector(`[data-marble-id="${mid}"]`);
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, id);
  await page.waitForFunction((mid) => window.marble.agent.context().selection.includes(mid), id);
};

const handle = (page) => page.locator('.marble-callout-handle:not([hidden])');
const card = (page) => page.locator('.marble-callout[data-state="card"]');

test('a settled selection grows a handle, and collapsing takes it away', async () => {
  const page = await open();
  assert.equal(await handle(page).count(), 0);
  await select(page, 'h');
  await handle(page).waitFor();
  const [h, dot] = await Promise.all([
    page.locator('[data-marble-id="h"]').boundingBox(),
    handle(page).boundingBox(),
  ]);
  assert.ok(dot.y >= h.y + h.height - 2, 'the handle hangs below the selection');
  assert.ok(Math.abs(dot.x - (h.x - 10)) < 3, 'left edge lines up with where the zone label will hang');
  await page.evaluate(() => getSelection().collapse(document.querySelector('[data-marble-id="p"]').firstChild, 1));
  await page.locator('.marble-callout-handle[hidden]').waitFor({ state: 'attached' });
});

test('the handle opens a fresh card on the offer, and typing does not lose the selection', async () => {
  const page = await open();
  await select(page, 'q1');
  await handle(page).click();
  await card(page).waitFor();
  await offerInput(page).waitFor();
  // The offer: one card, the input named for what it is about, the four
  // actions in words, two suggestions, and one line of help. The
  // conversation is there, not shown, until a send.
  assert.equal(await offerInput(page).getAttribute('data-placeholder'), 'Ask about this item…', 'all of an element selected is that element');
  assert.deepEqual(
    await page.locator('.marble-offer-act').allInnerTexts(),
    ['Try variations', 'Automate it', 'Make it interactive', 'Sketch it'],
  );
  await page.locator('.marble-offer-bubble').first().waitFor();
  assert.equal(await page.locator('.marble-offer-bubble').count(), 2, 'two suggestions');
  const help = await page.locator('.marble-offer-hint').innerText();
  assert.match(help, /send/);
  assert.match(help, /keep as a note/);
  assert.match(help, /No need to select: ⌘J asks about what the pointer is on\./, 'the first cards from a selection teach asking without selecting');
  assert.equal(await card(page).locator('marble-conversation[data-chrome="callout"]').isVisible(), false);
  assert.equal(await page.locator('.marble-callout-frame').count(), 1, 'what it is about is outlined');
  await offerInput(page).click();
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['q1'], 'focus into the card is not a new selection');
  assert.equal(await handle(page).count(), 0, 'the handle steps aside for the card');
});

test('an action drafts its words with the idea selected, previews on hover, and sends what it means beside them', async () => {
  const page = await open();
  await select(page, 'q1');
  await handle(page).click();
  await offerInput(page).waitFor();
  // Pointing at one says what it would ask for here, in the empty line.
  await page.locator('.marble-offer-act[data-act="automate"]').hover();
  assert.match(await offerInput(page).getAttribute('data-placeholder'), /^Automate this item: /);
  await page.locator('.marble-offer-act[data-act="interactive"]').click();
  const draft = await offerInput(page).textContent();
  assert.match(draft, /^Make this item interactive: /);
  assert.equal(await page.evaluate(() => getSelection().toString()), draft.split(': ')[1], 'the idea is selected, to type over');
  assert.equal(await page.locator('.marble-offer-act[data-act="interactive"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.marble-offer-bubble').count(), 0, 'no suggestions once there are words');
  assert.equal(await page.locator('.marble-offer-send').isVisible(), true, 'a drafted prompt can be sent as it is');
  await page.keyboard.type('click to open it');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.marble-callout[data-offer]'));
  await until(page, async () => {
    const [s] = await window.marble.agent.conversations();
    return Boolean(s && (await window.marble.agent.conversation(s.id)).turns?.length);
  });
  const { detail } = await firstConversation(page);
  assert.equal(detail.turns[0].prompt, 'Make this item interactive: click to open it', 'the chat shows only what was typed');
  assert.match(detail.turns[0].context.brief, /in place/, 'what the action means rides beside it');
  assert.deepEqual(detail.turns[0].context.selection, ['q1']);

  // Pressing it again takes an untouched draft with it.
  await select(page, 'h');
  await handle(page).click();
  await offerInput(page).waitFor();
  await page.locator('.marble-offer-act[data-act="variations"]').click();
  assert.equal(await offerInput(page).textContent(), 'Try 3 variations of this heading: shorter, bolder, or quieter');
  await page.locator('.marble-offer-act[data-act="variations"]').click();
  assert.equal(await offerInput(page).textContent(), '');
  await page.locator('.marble-offer-bubble').first().waitFor();
});

test('Sketch it opens the mode with the element marked, and says so on the page', async () => {
  const page = await open();
  await select(page, 'q1');
  await handle(page).click();
  await offerInput(page).waitFor();
  await page.locator('.marble-offer-act[data-act="sketch"]').click();
  await page.locator('.marble-marks-layer[data-describing]').waitFor({ state: 'attached' });
  await page.locator('.marble-marks-notice', { hasText: 'Describe mode' }).waitFor();
  assert.equal(await page.locator('.marble-marks-ring').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['q1'], 'arrives with the element marked');
  assert.equal(await page.locator('.marble-callout[data-offer]').count(), 0, 'the offer steps aside for the mode');
  await page.locator('.marble-marks-notice button').click();
  await page.waitForFunction(() => !document.querySelector('.marble-marks-layer[data-describing]'));
});

test('an offer nobody used goes with Escape or a click elsewhere', async () => {
  const page = await open();
  await select(page, 'q1');
  await handle(page).click();
  await offerInput(page).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('.marble-callout, .marble-callout-frame').length === 0);
  await select(page, 'q1');
  await handle(page).click();
  await offerInput(page).waitFor();
  await page.mouse.click(5, 700);
  await page.waitForFunction(() => document.querySelectorAll('.marble-callout, .marble-callout-frame').length === 0);
});

test('resting the pointer offers nothing until it is turned on in Agent settings › Chat', async () => {
  const page = await open();
  const li = await page.locator('[data-marble-id="q1"]').boundingBox();
  await page.mouse.move(li.x + 20, li.y + li.height / 2, { steps: 3 });
  await page.waitForTimeout(900);
  const quiet = page.locator('.marble-callout-handle.is-quiet:not([hidden])');
  assert.equal(await quiet.count(), 0, 'resting is what reading looks like: nothing happens');

  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').hover();
  await drawer.locator('.tool[data-tool="new"]').waitFor();
  assert.equal(await drawer.locator('.tool[data-tool="rest"]').count(), 0, 'a switch is a setting, not a row in the tray');
  await page.mouse.move(5, 5);
  await setChatPref(page, 'Offer to ask when I rest the pointer', true);
  assert.equal(await page.evaluate(() => localStorage.getItem('marble-ask-rest')), '1');

  await page.mouse.move(li.x + 30, li.y + li.height / 2, { steps: 3 });
  await page.mouse.move(li.x + 20, li.y + li.height / 2, { steps: 3 });
  await quiet.waitFor({ timeout: 3000 });
  await page.locator('.marble-callout-hover:not([hidden])').waitFor({ state: 'attached' });
  const mark = await quiet.boundingBox();
  assert.ok(mark.x < li.x, 'the mark waits in the left margin');
  await page.mouse.move(mark.x + mark.width / 2, mark.y + mark.height / 2, { steps: 4 });
  await quiet.click();
  await offerInput(page).waitFor();
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['q1'], 'the rested-on element is what the card is about');
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.removeItem('marble-ask-rest'));
});

test('⌘J with a selection summons a card; with nothing to ask about it opens the chat', async () => {
  const page = await open();
  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  await page.evaluate(() => window.marble.agent.close?.() ?? dispatchEvent(new CustomEvent('marble:agent-close')));
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === false);
  await select(page, 'p');
  await page.keyboard.press('Control+j');
  await card(page).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer')?.isOpen), false, 'the drawer stayed shut');
});

test('at phone width the handle opens the drawer with the selection instead of a card', async () => {
  const page = await open('garden', { width: 393, height: 700 });
  await select(page, 'h');
  await handle(page).click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  assert.equal(await card(page).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['h']);
});

test('at phone width the in-situ handle starts a new conversation', async () => {
  const page = await open('garden', { width: 393, height: 700 });
  const earlier = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    window.marble.agent.remember(id);
    return id;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForFunction((id) => document.querySelector('marble-agent-drawer')?.shadowRoot.querySelector('marble-conversation')?.getAttribute('conversation') === id, earlier);
  await select(page, 'h');
  await handle(page).click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  const shown = await page.evaluate(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('marble-conversation').getAttribute('conversation'));
  assert.notEqual(shown, earlier, 'spawning in the document does not continue the chat this tab was in');
});

test('the Agents page draws no callout layer', async () => {
  const page = await open('Agents');
  await page.waitForFunction(() => Boolean(document.querySelector('marble-conversation')));
  assert.equal(await page.locator('.marble-callout-layer').count(), 0);
});

// Point at something, from the tray: the one way to name a thing by clicking it.
async function startPointing(page) {
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').hover();
  const point = drawer.locator('.tool[data-tool="point"]');
  await point.waitFor();
  await point.click();
  await page.locator('.marble-callout-latch:not([hidden])').waitFor();
}

test('holding ⌥ points at nothing: it is the key that moves the caret by a word', async () => {
  const page = await open();
  const q2 = await page.locator('[data-marble-id="q2"]').boundingBox();
  await page.mouse.move(q2.x + 10, q2.y + q2.height / 2);
  await page.keyboard.down('Alt');
  await page.mouse.move(q2.x + 14, q2.y + q2.height / 2, { steps: 3 });
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.marble-callout-pick:not([hidden])').count(), 0, 'no outline while ⌥ is held');
  await page.mouse.click(q2.x + 10, q2.y + q2.height / 2);
  await page.keyboard.up('Alt');
  await page.waitForTimeout(250);
  assert.equal(await offerInput(page).count(), 0, '⌥-click is an ordinary click');
});

test('pointing outlines what the pointer is over with its name; [ widens it, and a click opens its card', async () => {
  const page = await open();
  const q2 = await page.locator('[data-marble-id="q2"]').boundingBox();
  await startPointing(page);
  await page.mouse.move(q2.x + 10, q2.y + q2.height / 2);
  const pick = page.locator('.marble-callout-pick:not([hidden])');
  await pick.waitFor();
  assert.equal(await page.locator('.marble-callout-pick-name').textContent(), 'Item · What makes an interface f…', 'the name, clipped');
  await page.keyboard.press('BracketLeft');
  assert.match(await page.locator('.marble-callout-pick-name').textContent(), /^List · /, '[ takes in the containing element');
  await page.keyboard.press('BracketRight');
  await page.mouse.click(q2.x + 10, q2.y + q2.height / 2);
  await offerInput(page).waitFor();
  assert.equal(await offerInput(page).getAttribute('data-placeholder'), 'Ask about this item…');
  assert.equal(await pick.count(), 0, 'one click, and pointing is over');
});

test('⇧-click while pointing adds the thing to the open card', async () => {
  const page = await open();
  const q1 = await page.locator('[data-marble-id="q1"]').boundingBox();
  const q2 = await page.locator('[data-marble-id="q2"]').boundingBox();
  await startPointing(page);
  await page.mouse.move(q1.x + 10, q1.y + q1.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.click(q1.x + 10, q1.y + q1.height / 2);
  await offerInput(page).waitFor();
  await page.mouse.move(q2.x + 10, q2.y + q2.height / 2);
  await page.locator('.marble-callout-pick.is-adding').waitFor();
  assert.match(await page.locator('.marble-callout-pick-name').textContent(), /^\+ Item/);
  await page.mouse.click(q2.x + 10, q2.y + q2.height / 2);
  await page.keyboard.up('Shift');
  await page.waitForFunction(() => document.querySelector('.marble-callout[data-offer] .marble-offer-input')?.dataset.placeholder === 'Ask about these 2 items…');
  // The old frame fades out as the card is redrawn about both.
  await page.waitForFunction(() => document.querySelectorAll('.marble-callout-frame:not(.is-out)').length === 2);
  assert.equal(await page.locator('.marble-callout-frame.is-group:not(.is-out)').count(), 2, 'a line round each');
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['q1', 'q2']);
});

test('Point at something in the tray names one thing with one click', async () => {
  const page = await open();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').hover();
  const point = drawer.locator('.tool[data-tool="point"]');
  await point.waitFor();
  assert.equal(await point.locator('.tool-label').innerText(), 'Point at something');
  assert.equal(await point.locator('.tool-key').innerText(), '', 'no key: ⌥ no longer points');
  await point.click();
  await page.locator('.marble-callout-latch:not([hidden])').waitFor();
  const p = await page.locator('[data-marble-id="p"]').boundingBox();
  await page.mouse.move(p.x + 10, p.y + p.height / 2);
  await page.locator('.marble-callout-pick:not([hidden])').waitFor();
  await page.mouse.click(p.x + 10, p.y + p.height / 2);
  await offerInput(page).waitFor();
  assert.equal(await page.locator('.marble-callout-latch:not([hidden])').count(), 0, 'one click, then it is over');
});

test('⌘J with nothing selected asks about the block the caret is in, or what the pointer is over', async () => {
  const page = await open();
  // The pointer, with no wait.
  const q1 = await page.locator('[data-marble-id="q1"]').boundingBox();
  await page.mouse.move(q1.x + 10, q1.y + q1.height / 2);
  await page.keyboard.press('Control+j');
  await offerInput(page).waitFor();
  assert.equal(await offerInput(page).getAttribute('data-placeholder'), 'Ask about this item…');
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer')?.isOpen), false, 'the chat stays shut');
  // Again, with a card waiting: it puts the card away, and nothing else.
  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => !document.querySelector('.marble-callout[data-offer]'));
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer')?.isOpen), false);

  // The caret, while typing.
  await page.evaluate(() => {
    const p = document.querySelector('[data-marble-id="p"]');
    p.contentEditable = 'true';
    p.focus();
    getSelection().collapse(p.firstChild, 4);
  });
  await page.mouse.move(2, 790);
  await page.keyboard.press('Control+j');
  await offerInput(page).waitFor();
  assert.equal(await offerInput(page).getAttribute('data-placeholder'), 'Ask about this paragraph…');
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['p']);
});

// A fresh card is the offer (agent-offer.js): its own light input sends the
// first brief. After that the card is the callout conversation.
const offerInput = (page) => page.locator('.marble-callout[data-offer] .marble-offer-input');
const sendFromCard = async (page, prompt) => {
  const fresh = await offerInput(page).count();
  const editor = fresh ? offerInput(page) : card(page).locator('marble-conversation .editor');
  await editor.click();
  await page.keyboard.type(prompt);
  await page.keyboard.press('Enter');
};
const cancelLast = (page) => page.evaluate(async () => {
  const [s] = await window.marble.agent.conversations();
  const d = await window.marble.agent.conversation(s.id);
  await window.marble.agent.cancel(d.turns.at(-1).id);
});

// waitForFunction does not wait on an async predicate (a Promise is truthy),
// so a question for the host is asked again until it has an answer.
const until = async (page, fn, arg, { timeout = 10_000 } = {}) => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting for the host');
    await page.waitForTimeout(100);
  }
};
const firstConversation = (page) => page.evaluate(async () => {
  const [summary] = await window.marble.agent.conversations();
  return summary ? { summary, detail: await window.marble.agent.conversation(summary.id) } : null;
});

// The marks: what a change draws on the page while it runs (change-marks.js).
const marks = (page) => page.locator('.marble-change-layer > *');
const marksGone = (page) => page.waitForFunction(() => document.querySelector('.marble-change-layer')?.children.length === 0, null, { timeout: 5000 });

test('a brief sent from the card carries the selection, is marked part by part, and ends with Undo, which brings the card back with variations first', async () => {
  const page = await open();
  await select(page, 'q');
  await handle(page).click();
  await sendFromCard(page, 'script:listing');
  await page.locator('.marble-change-tag').waitFor();
  const { summary, detail } = await firstConversation(page);
  assert.deepEqual(detail.turns[0].context.selection, ['q'], 'the turn carries the selection');
  assert.equal(detail.turns[0].context.target, 'garden');

  await page.locator('.marble-callout-status', { hasText: 'Add a question' }).waitFor();
  assert.equal(await page.locator('.marble-zone').count(), 0, 'the marks stand where the box was');
  assert.ok(await page.locator('.marble-callout[data-live]').count(), 'the head pulses while the turn runs');

  await page.locator('.marble-callout-status', { hasText: 'Changed 1 element' }).waitFor({ timeout: 15_000 });
  await marksGone(page);
  assert.equal(await page.locator('[data-marble-id="q"] li').count(), 3);

  await page.getByRole('button', { name: 'Undo this turn' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-marble-id="q"] li').length === 2);
  // Undo is a verdict on the change, not on the wish.
  await offerInput(page).waitFor();
  await page.locator('.marble-offer-bubble').first().waitFor();
  assert.equal(await page.locator('.marble-offer-bubble').first().getAttribute('data-act'), 'variations');
  assert.match(await page.locator('.marble-offer-bubble').first().innerText(), /Try 3 variations of this list/);
  // The undo is tinted where it lands, and leaves nothing behind.
  await marksGone(page);
  assert.equal(await page.locator('.marble-zone').count(), 0);
  const after = await page.evaluate(async (cid) => (await window.marble.agent.conversations()).find((s) => s.id === cid), summary.id);
  assert.equal(after.needsReview, false, 'seeing it and undoing it reviewed the chat');
});

test('closing a live card leaves nothing but the marks, whose tag opens the drawer', async () => {
  const page = await open();
  await select(page, 'q');
  await handle(page).click();
  await sendFromCard(page, 'script:hold');
  await page.locator('.marble-change-tint[data-id="q"]').waitFor();

  await page.getByRole('button', { name: 'Close' }).click();
  // Put away, not folded: no pill is left on the page, and the change's own
  // tag stays because this tab asked for the work.
  await page.waitForFunction(() => document.querySelectorAll('.marble-callout').length === 0);
  await page.locator('.marble-change-tag button').click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  await cancelLast(page);
});

test('a turn that touches nothing reads No changes', async () => {
  const page = await open();
  await select(page, 'p');
  await handle(page).click();
  await sendFromCard(page, 'script:quiet');
  await page.locator('.marble-callout-status', { hasText: 'No changes' }).waitFor({ timeout: 10_000 });
  assert.equal(await page.getByRole('button', { name: 'Undo this turn' }).count(), 0, 'nothing to undo');
  await page.getByRole('button', { name: 'Mark reviewed and put the callout away' }).waitFor();
});


test('a reload while the agent works rebuilds no card; the marks stay for the tab that asked', async () => {
  const page = await open();
  await select(page, 'q');
  await handle(page).click();
  await sendFromCard(page, 'script:hold');
  await page.locator('.marble-change-tint[data-id="q"]').waitFor();

  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.locator('.marble-change-tag').waitFor();
  await page.locator('.marble-change-tint[data-id="q"]').waitFor();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.marble-callout').count(), 0, 'no card comes back on its own');
  assert.equal(await page.locator('.marble-glints-host .glint').count(), 0, 'the marks already say it: no glint beside them');
  await cancelLast(page);
});

test('a prompt sent from the drawer with a selection draws its marks, not a card', async () => {
  const page = await open();
  // The drawer first, then the selection: opening the drawer takes focus, and
  // a selection made before it goes with it.
  await page.evaluate(() => window.marble.agent.open());
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  await select(page, 'q');
  const drawerEditor = page.locator('marble-agent-drawer marble-conversation .editor');
  await drawerEditor.click();
  await page.keyboard.type('script:hold');
  await page.keyboard.press('Enter');
  await page.locator('.marble-change-tint[data-id="q"]').waitFor();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.marble-callout').count(), 0);
  assert.equal(await page.locator('.marble-zone').count(), 0);
  await cancelLast(page);
});

test('a finished chat leaves no dot on the page: working agents are marked only while they work', async () => {
  const page = await open();
  await select(page, 'p');
  await handle(page).click();
  await sendFromCard(page, 'script:building');
  await page.locator('.marble-callout-status', { hasText: 'Changed' }).waitFor({ timeout: 15_000 });
  // While its card is on the page, the card says it: no dot.
  assert.equal(await page.locator('.marble-glints-host .glint').count(), 0);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.marble-glints-host .glint').count(), 0, 'finished work waits in the chat button and the Agents page, not on the page');
  assert.equal(await page.locator('.marble-callout').count(), 0, 'no pill, no card');
  const { summary } = await firstConversation(page);
  assert.equal(summary.needsReview, true, 'it is still unread; the page just does not say so');
});

test('a summoned callout starts a new conversation, and Open beside moves that chat to the drawer', async () => {
  const page = await open();
  // The chat this tab was last in. Spawning at a selection must not pick it up.
  const earlier = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.send(id, { prompt: 'script:quiet', target: 'garden' });
    await new Promise((resolve) => {
      const off = window.marble.agent.on(id, (e) => { if (e.type === 'turn.completed') { off(); resolve(); } });
    });
    window.marble.agent.remember(id);
    return id;
  });
  await select(page, 'q2');
  await handle(page).click();
  await card(page).waitFor();
  assert.equal(await page.locator('.marble-callout-tools button', { hasText: 'Continue in' }).count(), 0);
  const convo = card(page).locator('marble-conversation');
  assert.equal(await convo.getAttribute('conversation'), null);

  await sendFromCard(page, 'script:quiet');
  await page.locator('.marble-callout-status', { hasText: 'No changes' }).waitFor({ timeout: 10_000 });
  const id = await convo.getAttribute('conversation');
  assert.ok(id && id !== earlier, 'the brief is a new conversation');

  await page.getByRole('button', { name: 'Open this chat on the side' }).click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  assert.equal(
    await page.evaluate(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('marble-conversation').getAttribute('conversation')),
    id,
  );
  // Moved to the side, the card leaves the page rather than folding on it.
  await page.waitForFunction(() => document.querySelectorAll('.marble-callout').length === 0);
});

test('the corner buttons line up, and resting on one names it', async () => {
  const page = await open();
  await select(page, 'h');
  await handle(page).click();
  // The corners belong to a card with a chat in it; the offer has none.
  await sendFromCard(page, 'script:quiet');
  await page.locator('.marble-callout-status', { hasText: 'No changes' }).waitFor({ timeout: 10_000 });
  const side = page.getByRole('button', { name: 'Open this chat on the side' });
  const minimize = page.getByRole('button', { name: 'Close' });
  // Measured once the card has arrived: it grows in from .98.
  await page.waitForTimeout(300);
  const [a, b] = await Promise.all([side.boundingBox(), minimize.boundingBox()]);
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  assert.ok(Math.abs(a.y - b.y) < 1, 'the two icons share a line');

  await side.hover();
  const tip = page.locator('.marble-callout-tip');
  await tip.waitFor();
  assert.equal(await tip.innerText(), 'Open on the side');
  const tipBox = await tip.boundingBox();
  const overlaps = tipBox.y < a.y + a.height && tipBox.y + tipBox.height > a.y
    && tipBox.x < a.x + a.width && tipBox.x + tipBox.width > a.x;
  assert.equal(overlaps, false, 'the tip sits clear of the button');

  await minimize.hover();
  await page.locator('.marble-callout-tip', { hasText: 'Close' }).waitFor();
});

test('Open in Agents leaves for the Agents page with the chat open', async () => {
  const page = await open();
  await select(page, 'h');
  await handle(page).click();
  await sendFromCard(page, 'script:quiet');
  await page.locator('.marble-callout-status', { hasText: 'No changes' }).waitFor({ timeout: 10_000 });
  const { summary } = await firstConversation(page);
  await page.getByRole('button', { name: 'Open this chat on the Agents page' }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/a/Agents'));
  await page.waitForFunction((cid) => document.querySelector(`marble-conversation[conversation="${cid}"]`) !== null, summary.id);
  assert.equal(new URL(page.url()).searchParams.has('open'), false, 'the parameter is spent');
});

test('Close puts the card away and leaves nothing on the page', async () => {
  const page = await open();
  await select(page, 'p');
  await handle(page).click();
  await sendFromCard(page, 'script:quiet');
  await page.locator('.marble-callout-status', { hasText: 'No changes' }).waitFor({ timeout: 10_000 });
  const { summary } = await firstConversation(page);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.marble-callout').length === 0);
  const after = await page.evaluate(async (cid) => (await window.marble.agent.conversations()).find((s) => s.id === cid), summary.id);
  assert.equal(after.needsReview, true, 'closing does not review the chat');
  // Put away, and finished: nothing is left on the page for it.
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.marble-glints-host .glint').count(), 0);
});

// A chat about this page started somewhere else — another tab, the Agents
// page — straight through the host, so this tab is not following it.
const startElsewhere = (page, { target = 'garden', selection = ['q1'], prompt = 'script:hold' } = {}) => page.evaluate(async ({ target, selection, prompt }) => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const { id } = await post('/agent/conversations', { provider: 'fake' });
  await post(`/agent/conversations/${id}/turns`, { prompt, context: { target, viewing: target, selection, also: [] } });
  return id;
}, { target, selection, prompt });

test('an agent this tab is not following draws nothing until Show agent dots is on', async () => {
  const page = await open();
  await startElsewhere(page);
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.marble-glints-host .glint').count(), 0, 'no dots by default');
  assert.equal(await page.locator('.marble-zone').count(), 0);
  await setChatPref(page, 'Show agent dots', true);
  await page.locator('.marble-glints-host .glint').waitFor();
  await cancelLast(page);
});

test('an agent this tab is not following is a glint, not a zone: Follow opens it, Hide puts it away until someone sends', async () => {
  const page = await open();
  await page.evaluate(() => localStorage.setItem('marble-agent-dots', '1'));
  const id = await startElsewhere(page);
  const glint = page.locator('.marble-glints-host .glint');
  await glint.waitFor();
  assert.equal(await glint.getAttribute('data-state'), 'working');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.marble-zone').count(), 0, 'work nobody here asked for draws no zone');
  assert.equal(await marks(page).count(), 0, 'and no marks');

  await glint.click();
  const peek = page.locator('.marble-glints-host .peek');
  assert.deepEqual(await peek.locator('.acts button').allInnerTexts(), ['Follow', 'Hide'], 'in progress: Follow and Hide, never Done');
  await peek.getByRole('button', { name: 'Hide' }).click();
  await glint.waitFor({ state: 'detached' });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForTimeout(500);
  assert.equal(await glint.count(), 0, 'Hide lasts across a reload');

  // Sending in it again is the progress that brings it back.
  await page.evaluate((cid) => { dispatchEvent(new CustomEvent('marble:agent-sent', { detail: { id: cid } })); }, id);
  assert.equal(await page.evaluate((cid) => JSON.parse(localStorage.getItem('marble-glints-hidden:garden') || '[]').includes(cid), id), false);

  await page.evaluate((cid) => window.marbleGlints.toggle(cid), id);
  await page.locator('.marble-glints-host .peek').getByRole('button', { name: 'Follow' }).click();
  await page.waitForFunction((cid) => {
    const drawer = document.querySelector('marble-agent-drawer');
    return drawer?.isOpen === true && drawer.shadowRoot.querySelector('marble-conversation')?.getAttribute('conversation') === cid;
  }, id);
  // Followed: its work is now this tab's to watch, so its marks take over.
  await page.locator('.marble-change-tag').waitFor();
  assert.equal(await page.locator('.marble-zone').count(), 0);
  await cancelLast(page);
});

test('Show agent dots in Agent settings › Chat hides and shows every glint', async () => {
  const page = await open();
  await page.evaluate(() => localStorage.setItem('marble-agent-dots', '1'));
  await startElsewhere(page);
  const glint = page.locator('.marble-glints-host .glint');
  await glint.waitFor();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').hover();
  await drawer.locator('.tool[data-tool="new"]').waitFor();
  assert.equal(await drawer.locator('.tool[data-tool="glints"]').count(), 0, 'not a row in the tray');
  await page.mouse.move(5, 5);
  await setChatPref(page, 'Show agent dots', false);
  await glint.waitFor({ state: 'detached' });
  await setChatPref(page, 'Show agent dots', true);
  await glint.waitFor();
  await cancelLast(page);
});

test('the drawer\'s switcher lists this app\'s agents first, apart from the rest', async () => {
  const page = await open();
  await startElsewhere(page, { prompt: 'script:quiet' });
  await startElsewhere(page, { target: 'Agents', selection: [], prompt: 'script:quiet' });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.marble.agent.open());
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.title').first().click();
  await drawer.locator('.menu.recent .seg').first().waitFor();
  const segs = await drawer.locator('.menu.recent .seg').evaluateAll((els) => els.map((el) => el.firstChild.textContent));
  assert.deepEqual(segs, ['In this app', 'Elsewhere']);
  const order = await drawer.locator('.menu.recent').evaluate((menu) => [...menu.children].map((el) => el.className || el.getAttribute('role')));
  assert.equal(order[0], 'seg');
  assert.equal(order[1], 'menuitem', 'this app\'s chat comes straight under its heading');
});

test('a data-marble-run button starts an agent with its brief, aimed at its element', async () => {
  const page = await open('runnable');
  await page.getByRole('button', { name: 'Fill' }).click();
  const run = await until(page, async () => {
    for (const s of await window.marble.agent.conversations()) {
      const turn = (await window.marble.agent.conversation(s.id)).turns?.[0];
      if (turn?.prompt) return { id: s.id, prompt: turn.prompt, context: turn.context };
    }
    return null;
  });
  assert.match(run.prompt, /Look it up by its title and fill the rest\./);
  assert.equal(run.context.target, 'runnable');
  assert.deepEqual(run.context.selection, ['r2'], 'the scope it names');
  assert.equal(await page.evaluate((cid) => window.marble.agent.attending(cid), run.id), true, 'pressed here, so followed here');
});
