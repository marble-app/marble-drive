import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading to **Backlog**.\n\n- kept the questions\n- changed nothing else' },
  ],
  hostile: [{ say: 'Try <img src=x onerror="window.__pwned=1"> and [bad](javascript:window.__pwned=1) and [good](https://example.com)' }],
  slow: [{ sleep: 1500 }, { say: 'finally' }],
  hold: [{ silent: 20_000 }],
  stale: [
    { call: 'apply_ops', args: { path: 'garden', note: 'unread', ops: [{ type: 'setText', id: 'p', text: 'x' }] } },
    { say: 'It was refused.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS });
test.after(() => host.close());

/** A page with a bare <marble-conversation> in it — the drawer is not needed to test the view. */
async function mount(id = null) {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate((conversation) => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    if (conversation) el.setAttribute('conversation', conversation);
    el.style.cssText = 'position:fixed;right:0;top:0;width:420px;height:100vh;';
    document.body.append(el);
  }, id);
  // `body >` so the drawer's own conversation (inside its shadow root, Task 4) is never matched.
  return { page, errors, view: page.locator('body > marble-conversation') };
}

const sendFrom = async (view, text) => {
  await view.locator('textarea').fill(text);
  await view.locator('textarea').press('Enter');
};

test('a new conversation picks an agent, sends on Enter, and becomes that conversation', async () => {
  const { page, view, errors } = await mount();
  await view.locator('select.picker-select').waitFor();
  assert.equal(await view.locator('select.picker-select').inputValue(), 'fake');

  const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
  await sendFrom(view, 'script:rename');
  const id = await started;
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(await view.getAttribute('conversation'), id);

  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.msg.me').first().textContent(), 'script:rename');
  assert.equal(await view.locator('select.picker-select').count() === 0 || !(await view.locator('select.picker-select').isVisible()), true);
  assert.deepEqual(errors, []);
});

test('a new conversation can name its model from the picker', async () => {
  const { page, view } = await mount();
  await view.locator('select.picker-select').waitFor();
  await view.locator('select.picker-model').selectOption('alt');
  await view.locator('select.effort-select').selectOption('high');
  const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
  await sendFrom(view, 'script:rename');
  const id = await started;
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const meta = await page.evaluate(async (conversation) => (await window.marble.agent.conversation(conversation)).meta, id);
  assert.equal(meta.model, 'alt');
  assert.equal(meta.effort, 'high');
});

test('typing / lists clear, compact, models, effort and skills', async () => {
  const { view } = await mount();
  await view.locator('select.picker-select').waitFor();
  await view.locator('textarea').fill('/');
  await view.locator('.slash').waitFor();
  const listed = await view.locator('.slash').textContent();
  assert.match(listed, /Clear conversation/);
  assert.match(listed, /Compact/);
  assert.match(listed, /Effort: high/);
  assert.match(listed, /Alt/);
});

test('the transcript shows the agent’s words, its tool calls, and what changed', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:rename');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();

  const agent = view.locator('.msg.agent').last();
  assert.equal(await agent.locator('strong').textContent(), 'Backlog');
  assert.equal(await agent.locator('li').count(), 2);
  assert.equal(await view.locator('.msg.agent.live').count(), 0, 'the streamed text was replaced by the final text');

  const tools = view.locator('.tool');
  assert.match(await tools.nth(0).textContent(), /Read garden/);
  assert.match(await tools.nth(1).textContent(), /Edited 1 element in garden/);
  assert.equal(await tools.nth(1).getAttribute('data-state'), 'done');
  assert.match(await view.locator('.turn-footer').last().textContent(), /Changed 1 element/);
});

test('undo reverts the turn and says so', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:rename');
  await view.locator('.turn-footer[data-status="completed"] button.undo').click();
  await page.waitForFunction(async () => (await (await fetch('/a/garden')).text()).includes('>Research Garden<'));
  await view.locator('.turn-footer .undone').waitFor();
  assert.match(await view.locator('.turn-footer .undone').textContent(), /Undid 1/);
  assert.equal(await view.locator('.turn-footer button.undo').count(), 0);
});

test('agent text is never HTML, and only http(s) links become links', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:hostile');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const agent = view.locator('.msg.agent').last();
  assert.equal(await agent.locator('img').count(), 0);
  assert.match(await agent.textContent(), /<img src=x onerror=/);
  const links = agent.locator('a');
  assert.equal(await links.count(), 1);
  assert.equal(await links.first().getAttribute('href'), 'https://example.com');
  assert.equal(await links.first().getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
});

test('stop is there while a turn runs, and stops it', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await view.locator('button.stop').click();
  await view.locator('.turn-footer[data-status="cancelled"]').waitFor();
  assert.equal(await view.locator('button.stop').isVisible(), false);
});

test('a second message while one runs is queued, and can be removed', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:slow');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await sendFrom(view, 'script:rename');
  await view.locator('.queued-item').waitFor();
  await view.locator('.queued-item button.dequeue').click();
  await view.locator('.queued-item').waitFor({ state: 'detached' });
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.turn-footer').count(), 1, 'only the first turn ran');
});

test('a refused edit is shown as refused, not as an error', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:stale');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.tool').first().getAttribute('data-state'), 'refused');
  assert.match(await view.locator('.tool').first().textContent(), /Refused/);
});

test('an existing conversation opens with its whole history', async () => {
  const id = await (async () => {
    const { page } = await mount();
    const view = page.locator('body > marble-conversation');
    const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
    await sendFrom(view, 'script:rename');
    const conversation = await started;
    await view.locator('.turn-footer[data-status="completed"]').waitFor();
    return conversation;
  })();
  const { view } = await mount(id);
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.msg.me').count(), 1);
  assert.match(await view.locator('.msg.agent').last().textContent(), /Backlog/);
});

test('the context chip shows the target and the selection, and can drop the selection', async () => {
  const { page, view } = await mount();
  assert.equal((await view.locator('.context-text').textContent()).trim(), 'garden');
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-marble-id="h"]'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await view.locator('.context-text', { hasText: '1 selected' }).waitFor();
  await view.locator('.context-clear').click();
  assert.equal((await view.locator('.context-text').textContent()).trim(), 'garden');
});

test('the context chip names the aimed target and how many more are in view', async () => {
  const { page, view } = await mount();
  await page.evaluate(() => window.marble.agent.aim('notes', { also: ['reading', 'log'] }));
  await view.locator('.context-text', { hasText: 'notes' }).waitFor();
  assert.match((await view.locator('.context-text').textContent()).trim(), /\+ 2 more/);
});

test('shift+enter makes a new line instead of sending', async () => {
  const { view } = await mount();
  await view.locator('textarea').fill('one');
  await view.locator('textarea').press('Shift+Enter');
  await view.locator('textarea').pressSequentially('two');
  assert.equal(await view.locator('textarea').inputValue(), 'one\ntwo');
  assert.equal(await view.locator('.msg.me').count(), 0);
});
