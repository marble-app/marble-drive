import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

// Simple is how a chat opens for people: one card per turn that says where the
// work is, shows the few things changing, and ends on what to do next. The
// steps underneath are still built, for Technical and for Details.
const LIST = '<section><h2>Shopping list</h2><ul><li>Tomatoes</li><li>Basil</li><li>Feta</li></ul><label><input type="checkbox"> Got it</label></section>';

const SCRIPTS = {
  building: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'Stage 1 of 2: the list', ops: [{ type: 'insert', parentId: 'b', html: LIST }] } },
    { sleep: 600 },
    { call: 'apply_ops', args: { path: 'garden', note: 'Stage 2 of 2: a warmer heading', ops: [{ type: 'setAttr', id: 'h', name: 'style', value: 'color: #c0643f' }] } },
    { sleep: 600 },
    { say: 'Added a shopping list and warmed up the heading.' },
  ],
  reading: [
    { tool: 'WebSearch', input: { query: 'HCI grants 2027' } },
    { tool: 'WebFetch', input: { url: 'https://www.nsf.gov/funding/hcc' } },
    { tool: 'Bash', input: { command: 'ls', description: 'Look around' } },
    { say: 'Three programs fit.' },
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

test('Simple is the default: one card per turn, and the step rows stand back', async () => {
  const { page, errors, view, send } = await mount({ detail: null });
  await send('script:reading');
  const card = view.locator('.progress');
  await card.waitFor();
  await view.locator('.progress[data-state="completed"]').waitFor();
  assert.equal(await view.locator('.log').getAttribute('data-detail'), 'simple');
  assert.equal(await card.count(), 1);
  // The rows are built, and hidden.
  assert.ok(await view.locator('.tool, .tool-group').count() > 0);
  assert.equal(await view.locator('.tool-group').first().isVisible(), false);
  assert.equal(await card.locator('.progress-say').textContent(), 'All done');
  assert.equal(await view.locator('.msg.agent').last().textContent(), 'Three programs fit.');
  assert.deepEqual(errors, []);
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
  assert.equal(await view.locator('.log').getAttribute('data-detail'), 'simple');
  await more.click();
  assert.equal(await view.locator('.tool-group').first().isVisible(), false);
  await page.context().close();
});

test('an edit shows the element it adds, sized by what it holds, and what changed', async () => {
  const { page, view, send } = await mount();
  await send('script:building');
  const card = view.locator('.progress');
  const added = card.locator('.f-el-new', { hasText: 'Shopping list' });
  await added.waitFor();
  const parts = await added.locator('.f-part').allTextContents();
  assert.ok(parts.includes('3 items'), parts.join(', '));
  assert.ok(parts.includes('1 tick box'), parts.join(', '));
  // Live, the agent's note is the sub-line; the caption waits for the record.
  assert.equal(await card.locator('.progress-sub').textContent(), 'Stage 1 of 2: the list');
  await card.locator('.f-sw').waitFor();
  assert.equal(await card.locator('.f-sw').evaluate((el) => getComputedStyle(el).getPropertyValue('--c').trim()), '#c0643f');
  const changes = await card.locator('.f-changes li').allTextContents();
  // The heading is on this page, so the change says whose colour it was.
  assert.deepEqual(changes.map((t) => t.trim()), ['+Shopping list', '~Colour of “Research Garden”']);
  await view.locator('.progress[data-state="completed"]').waitFor();
  assert.equal(await card.locator('.progress-say').textContent(), 'Updated garden');
  // Finished, the close-up gathers everything the turn made, not just the last edit.
  assert.deepEqual(await card.locator('.f-el-name .f-el-text').allTextContents(), ['Shopping list', 'Colour of “Research Garden”']);
  // Each edit is a step you can go back to.
  assert.equal(await card.locator('.pv-step').count(), 2);
  await card.locator('.pv-step').first().click();
  assert.equal(await card.locator('.pv-cap').textContent(), 'Stage 1 of 2: the list');
  await page.context().close();
});

test('only what is new moves: the second edit leaves the first line where it was', async () => {
  const { page, view, send } = await mount();
  await send('script:building');
  const card = view.locator('.progress');
  const firstLine = card.locator('.f-changes li').first();
  await firstLine.waitFor();
  const before = await firstLine.elementHandle();
  await card.locator('.f-changes li').nth(1).waitFor();
  // Patched in place: the same node, not a fresh copy that would enter again.
  assert.equal(await card.locator('.f-changes li').first().evaluate((li, old) => li === old, before), true);
  // The card itself is never moved: the closing text arrives above it.
  const cardHandle = await card.elementHandle();
  await view.locator('.progress[data-state="completed"]').waitFor();
  assert.equal(await card.evaluate((el, old) => el === old, cardHandle), true);
  assert.equal(await view.locator('.log').evaluate((log) => {
    const text = [...log.querySelectorAll('.msg.agent')].pop();
    return Boolean(text.compareDocumentPosition(log.querySelector('.progress')) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), true);
  await page.context().close();
});

test('sources show where an answer comes from', async () => {
  const { page, view, send } = await mount();
  await send('script:reading');
  await view.locator('.progress[data-state="completed"]').waitFor();
  const rows = await view.locator('.f-src').allTextContents();
  assert.equal(rows.length, 2);
  assert.match(rows[1], /www\.nsf\.gov/);
  await page.context().close();
});

test('a permission is asked in the card, in words, and its answer is the ask’s', async () => {
  const { page, view, send } = await mount();
  await send('script:permission');
  const card = view.locator('.progress[data-state="asking"]');
  await card.waitFor();
  assert.equal(await card.locator('.progress-sub').textContent(), 'Run: Deploy to the public server');
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
  assert.equal(await card.locator('.pv-where').textContent(), 'Where it got stuck');
  assert.match(await card.locator('.f-note').textContent(), /sign-in/);
  const buttons = await card.locator('.progress-acts .act').allTextContents();
  assert.deepEqual(buttons.slice(0, 3), ['Try again', 'What went wrong?', 'Give it a hint…']);
  // A drafting answer puts the question in the box and waits for words.
  await card.locator('.act', { hasText: 'Give it a hint' }).click();
  assert.equal(await view.locator('.editor').getAttribute('data-placeholder'), 'What should it try?');
  await page.context().close();
});

test('while it works, Stop stops it and the card says so, with a way on', async () => {
  const { page, view, send } = await mount();
  await send('script:hold');
  const card = view.locator('.progress[data-state="running"]');
  await card.waitFor();
  await card.locator('.act', { hasText: 'Stop' }).click();
  const stopped = view.locator('.progress[data-state="cancelled"]');
  await stopped.waitFor();
  assert.equal(await stopped.locator('.progress-say').textContent(), 'Stopped');
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
  assert.equal(await old.locator('.f-changes').isVisible(), true);
  assert.equal(await old.locator('.f-focus').isVisible(), false);
  await page.context().close();
});
