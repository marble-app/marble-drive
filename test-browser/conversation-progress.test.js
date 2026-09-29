import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

// Simple is how a chat opens for people. A running turn is one line (glyph,
// sentence, stops, time), a live view drawn from the work, and frames for the
// steps it has finished; it ends on a receipt and your call. The steps
// underneath are still built, for Technical and for Details.
const LIST = '<section><h2>Shopping list</h2><ul><li>Tomatoes</li><li>Basil</li><li>Feta</li></ul><label><input type="checkbox"> Got it</label></section>';
const NOTES = '<section><h2>Notes</h2><p>Buy early.</p></section>';

const SCRIPTS = {
  building: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'Stage 1 of 2: the list', ops: [{ type: 'insert', parentId: 'b', html: LIST }] } },
    { sleep: 600 },
    { call: 'apply_ops', args: { path: 'garden', note: 'Stage 2 of 2: a warmer heading', ops: [{ type: 'setAttr', id: 'h', name: 'style', value: 'color: #c0643f' }] } },
    { sleep: 600 },
    { say: 'Added a shopping list and warmed up the heading.' },
  ],
  growing: [
    { call: 'apply_ops', args: { path: 'garden', note: 'the list', ops: [{ type: 'insert', parentId: 'b', html: LIST }] } },
    { sleep: 600 },
    { call: 'apply_ops', args: { path: 'garden', note: 'notes under it', ops: [{ type: 'insert', parentId: 'b', html: NOTES }] } },
    { sleep: 600 },
    { say: 'Two sections.' },
  ],
  words: [
    { call: 'apply_ops', args: { path: 'garden', note: 'a plainer intro', ops: [{ type: 'setText', id: 'p', text: 'Questions we keep asking.' }] } },
    { sleep: 400 },
    { say: 'Reworded.' },
  ],
  reading: [
    { tool: 'WebSearch', input: { query: 'HCI grants 2027' } },
    { tool: 'WebFetch', input: { url: 'https://www.nsf.gov/funding/hcc' } },
    { tool: 'Bash', input: { command: 'ls', description: 'Look around' } },
    { say: 'Three programs fit.' },
  ],
  testing: [
    { tool: 'Bash', input: { command: 'npm test', description: 'Run the tests' }, summary: 'ℹ tests 12\nℹ pass 11\nℹ fail 1\n✖ the footer says Done' },
    { say: 'One failing.' },
  ],
  permission: [
    { tool: 'Read', input: { file_path: '/x/fly.toml' } },
    { ask: { tool: 'Bash', input: { command: 'fly deploy', description: 'Deploy to the public server' } } },
    { say: 'after' },
  ],
  stuck: [
    { tool: 'WebFetch', input: { url: 'https://docs.google.com/spreadsheets/d/1' }, ok: false, summary: 'The sheet asks for a sign-in. Nothing was downloaded.' },
    { fail: 'Could not open the spreadsheet.' },
  ],
  hold: [{ tool: 'Read', input: { file_path: '/x/a.js' } }, { silent: 20_000 }],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN } });
test.after(() => host.close());

async function mount({ detail = 'simple' } = {}) {
  await host.reset();
  const { page, errors } = await host.newPage({ detail });
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(() => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    el.style.cssText = 'position:fixed;right:0;top:0;width:440px;height:100vh;';
    document.body.append(el);
  });
  const view = page.locator('body > marble-conversation');
  const send = async (text) => {
    await view.locator('.editor').fill(text);
    await view.locator('.editor').press('Enter');
  };
  return { page, errors, view, send };
}

test('Simple is the default: one card per turn, one line, and the step rows stand back', async () => {
  const { page, errors, view, send } = await mount({ detail: null });
  await send('script:reading');
  const card = view.locator('.progress');
  await view.locator('.progress[data-state="completed"]').waitFor();
  assert.equal(await view.locator('.log').getAttribute('data-detail'), 'simple');
  assert.equal(await card.count(), 1);
  assert.ok(await view.locator('.tool, .tool-group').count() > 0);
  assert.equal(await view.locator('.tool-group').first().isVisible(), false);
  assert.equal(await card.locator('.w-say').textContent(), 'All done');
  assert.match(await card.locator('.w-time').textContent(), /\d+ s|\d+ min/);
  assert.equal(await view.locator('.msg.agent').last().textContent(), 'Three programs fit.');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('while it works the line has its four stops and a running clock', async () => {
  const { page, view, send } = await mount();
  await send('script:hold');
  const card = view.locator('.progress[data-state="running"]');
  await card.waitFor();
  assert.equal(await card.locator('.w-stops i').count(), 4);
  assert.match(await card.locator('.w-time').textContent(), /^\d+:\d\d$/);
  await card.locator('.w-steer .w-quiet', { hasText: 'Stop' }).click();
  await view.locator('.progress[data-state="cancelled"]').waitFor();
  await page.context().close();
});

test('the switch flips every chat on the page to Technical and back, and is remembered', async () => {
  const { page, view, send } = await mount();
  await send('script:reading');
  await view.locator('.progress[data-state="completed"]').waitFor();
  await view.locator('button.detail').click();
  assert.equal(await view.locator('.log').getAttribute('data-detail'), 'technical');
  assert.equal(await view.locator('.progress').isVisible(), false);
  assert.equal(await view.locator('.tool-group').first().isVisible(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('marble:chat-detail')), 'technical');
  await view.locator('button.detail').click();
  assert.equal(await view.locator('.progress').isVisible(), true);
  await page.context().close();
});

test('Details shows one turn’s steps without switching the chat over', async () => {
  const { page, view, send } = await mount();
  await send('script:reading');
  await view.locator('.progress[data-state="completed"]').waitFor();
  const more = view.locator('.progress-more');
  await more.click();
  assert.equal(await more.getAttribute('aria-expanded'), 'true');
  assert.equal(await view.locator('.tool-group').first().isVisible(), true);
  await more.click();
  assert.equal(await view.locator('.tool-group').first().isVisible(), false);
  await page.context().close();
});

test('an edit draws the page growing, a colour as swatches, and a stage plan as frames', async () => {
  const { page, view, send } = await mount();
  await send('script:building');
  const card = view.locator('.progress');
  const added = card.locator('.w-live .v-map-list li', { hasText: 'Shopping list' });
  await added.waitFor();
  assert.match(await added.textContent(), /3 items · 1 tick box/);
  // The document is this page, so the outline is drawn and the new part lit.
  assert.ok(await card.locator('.w-live .v-map-page i[data-fresh]').count() >= 1);
  assert.equal(await card.locator('.w-cap').textContent(), 'Stage 1 of 2: the list');
  // "Stage 1 of 2" is a plan: two frames, the first now.
  assert.equal(await card.locator('.w-frame').count(), 2);
  const chip = card.locator('.w-live .v-sw-chip[data-new]');
  await chip.waitFor();
  assert.equal(await chip.getAttribute('title'), '#c0643f');
  assert.match(await card.locator('.w-live .v-sw-lab').textContent(), /Research Garden/);
  await view.locator('.progress[data-state="completed"]').waitFor();
  assert.equal(await card.locator('.w-say').textContent(), 'Updated garden');
  const rows = await card.locator('.w-change .w-ct').allTextContents();
  assert.match(rows[0], /^Added Shopping list/);
  assert.match(rows[1], /^Text colour of “Research Garden”/);
  assert.equal(await card.locator('.w-change .w-dot').count() >= 1, true);
  // A finished frame opens its step again.
  await card.locator('.w-frame').first().click();
  assert.equal(await card.locator('.w-live').isVisible(), true);
  assert.equal(await card.locator('.w-back button').textContent(), 'Close');
  await page.context().close();
});

test('changed words are a redline: what went, what came', async () => {
  const { page, view, send } = await mount();
  await send('script:words');
  const card = view.locator('.progress');
  await card.locator('.w-live .v-red-text').waitFor();
  assert.match(await card.locator('.w-live .v-red-text del').first().textContent(), /Open/);
  assert.match(await card.locator('.w-live .v-red-text ins').first().textContent(), /asking|Questions/);
  await view.locator('.progress[data-state="completed"]').waitFor();
  assert.match(await card.locator('.w-change .w-ct').first().textContent(), /^Words in “Open questions/);
  await page.context().close();
});

test('only what is new moves: a second section joins the list, the first stays put', async () => {
  const { page, view, send } = await mount();
  await send('script:growing');
  const card = view.locator('.progress');
  const first = card.locator('.w-live .v-map-list li', { hasText: 'Shopping list' });
  await first.waitFor();
  const before = await first.elementHandle();
  const second = card.locator('.w-live .v-map-list li', { hasText: 'Notes' });
  await second.waitFor();
  assert.equal(await first.evaluate((li, old) => li === old, before), true);
  assert.equal(await second.getAttribute('data-enter'), '');
  const cardHandle = await card.elementHandle();
  await view.locator('.progress[data-state="completed"]').waitFor();
  assert.equal(await card.evaluate((el, old) => el === old, cardHandle), true);
  assert.equal(await view.locator('.log').evaluate((log) => {
    const text = [...log.querySelectorAll('.msg.agent')].pop();
    return Boolean(text.compareDocumentPosition(log.querySelector('.progress')) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), true);
  await page.context().close();
});

test('sources show where an answer comes from, and are the proof at the end', async () => {
  const { page, view, send } = await mount();
  await send('script:reading');
  await view.locator('.progress[data-state="completed"]').waitFor();
  assert.equal(await view.locator('.w-strip .v-src-q').first().textContent(), 'HCI grants 2027');
  assert.match(await view.locator('.w-strip .v-src-r').first().textContent(), /www\.nsf\.gov/);
  assert.equal(await view.locator('.w-strip .v-src-r').first().getAttribute('data-st'), 'read');
  assert.match(await view.locator('.w-proof-line').textContent(), /^Read 1 source/);
  await page.context().close();
});

test('a test run is counted as dots, and a failure named', async () => {
  const { page, view, send } = await mount();
  await send('script:testing');
  await view.locator('.progress[data-state="completed"]').waitFor();
  const card = view.locator('.progress');
  assert.equal(await card.locator('.w-proof-line').textContent(), '11 of 12 tests passed');
  await card.locator('.w-frame').first().click();
  assert.equal(await card.locator('.w-live .v-ts-dots i').count(), 12);
  assert.equal(await card.locator('.w-live .v-ts-dots i[data-st="fail"]').count(), 1);
  assert.match(await card.locator('.w-live .v-ts-fail').textContent(), /the footer says Done/);
  await page.context().close();
});

test('a permission is drawn in the card, in words, and its answer is the ask’s', async () => {
  const { page, view, send } = await mount();
  await send('script:permission');
  const card = view.locator('.progress[data-state="asking"]');
  await card.waitFor();
  assert.equal(await card.locator('.w-live .v-pm-t').textContent(), 'Run: Deploy to the public server');
  assert.match(await card.locator('.w-live .v-pm-r').first().textContent(), /fly deploy/);
  assert.equal(await view.locator('.ask').isVisible(), false);
  const buttons = await card.locator('.progress-acts .act').allTextContents();
  assert.deepEqual(buttons, ['Allow once', 'Don’t allow', 'Ask why first']);
  await card.locator('.act.primary').click();
  await view.locator('.progress[data-state="completed"]').waitFor();
  assert.match(await view.locator('.progress-said').textContent(), /allowed/);
  assert.equal(await view.locator('.msg.agent').last().textContent(), 'after');
  await page.context().close();
});

test('a failed turn says where it got stuck and what you can do', async () => {
  const { page, view, send } = await mount();
  await send('script:stuck');
  const card = view.locator('.progress[data-state="failed"]');
  await card.waitFor();
  assert.equal(await card.locator('.w-vh b').textContent(), 'Where it got stuck');
  assert.match(await card.locator('.w-live .v-halt p').textContent(), /sign-in/);
  const buttons = await card.locator('.progress-acts .act').allTextContents();
  assert.deepEqual(buttons.slice(0, 3), ['Try again', 'What went wrong?', 'Give it a hint…']);
  await card.locator('.act', { hasText: 'Give it a hint' }).click();
  assert.equal(await view.locator('.editor').getAttribute('data-placeholder'), 'What should it try?');
  await page.context().close();
});

test('stopped partway, the card says so, with a way on', async () => {
  const { page, view, send } = await mount();
  await send('script:hold');
  await view.locator('.progress[data-state="running"]').waitFor();
  await view.locator('.w-steer .w-quiet', { hasText: 'Stop' }).click();
  const stopped = view.locator('.progress[data-state="cancelled"]');
  await stopped.waitFor();
  assert.equal(await stopped.locator('.w-say').textContent(), 'Stopped');
  assert.match(await stopped.locator('.w-live .v-halt p').textContent(), /Nothing was lost/);
  assert.equal(await stopped.locator('.act.primary').textContent(), 'Keep going');
  await page.context().close();
});

test('a new prompt folds the last card down to what it changed', async () => {
  const { page, view, send } = await mount();
  await send('script:building');
  await view.locator('.progress[data-state="completed"]').waitFor();
  await send('script:reading');
  await view.locator('.progress').nth(1).waitFor();
  const old = view.locator('.progress').first();
  assert.equal(await old.getAttribute('data-old'), '');
  assert.equal(await old.locator('.progress-next').isVisible(), false);
  assert.equal(await old.locator('.w-changes').isVisible(), true);
  assert.equal(await old.locator('.w-live').isVisible(), false);
  await page.context().close();
});

test('a message relayed from another chat is that chat’s words, not the envelope', async () => {
  const { page, view } = await mount();
  // A conversation the host does not have: it fails to open, and then takes
  // the one event this test hands it.
  await view.evaluate((el) => el.setAttribute('conversation', 'relaytest'));
  await view.locator('.system.error').waitFor();
  await view.evaluate((el) => {
    el.receive({ type: 'user', turn: 'relaytest-1', t: Date.now(), text: 'Message from the conversation "Design notes" (abc123def456, claude-subscription):\n\nThe test browser was closed by another chat; it has been reopened.\n\nReply with send_message to "abc123def456" and inReplyTo "m1".' });
  });
  const msg = view.locator('.msg.me[data-relayed]');
  await msg.waitFor();
  assert.match(await msg.locator('.from').textContent(), /Design notes/);
  assert.equal((await msg.locator('.msg-text').textContent()).trim(), 'The test browser was closed by another chat; it has been reopened.');
  await page.context().close();
});
