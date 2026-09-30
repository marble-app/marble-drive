// The agent in the text (v3): work on words is a caret in the words — where
// it will write, "thinking" while it reads, its edit typed out when it lands —
// and work that is not words keeps its box (Notes and Sketches/Ask at Anything).

import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const REWRITTEN = 'Open questions we keep returning to, and why they matter.';
const SCRIPTS = {
  think: [{ call: 'read_document', args: { path: 'garden' } }, { silent: 20_000 }],
  retype: [
    { call: 'read_document', args: { path: 'garden' } },
    { sleep: 700 },
    { call: 'apply_ops', args: { path: 'garden', note: 'say why', ops: [{ type: 'setText', id: 'p', text: REWRITTEN }] } },
    { sleep: 2500 },
    { say: 'done' },
  ],
  hold: [{ silent: 20_000 }],
};

const host = await startDrive({ scripts: SCRIPTS });
test.after(() => host.close());

const pages = [];
const closePages = async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); };
test.after(closePages);

const settle = async () => {
  const list = await (await fetch(`${host.base}/agent/conversations`)).json();
  for (const summary of list) {
    const detail = await (await fetch(`${host.base}/agent/conversations/${summary.id}`)).json();
    for (const turn of detail.turns ?? []) {
      if (turn.status === 'running') await fetch(`${host.base}/agent/turns/${turn.id}/cancel`, { method: 'POST' });
    }
    await fetch(`${host.base}/agent/conversations/${summary.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }),
    });
  }
};

const open = async (options = {}) => {
  await closePages();
  await host.reset();
  await settle();
  const { page } = await host.newPage(options);
  pages.push(page);
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleText));
  return page;
};

const selectAll = async (page, id) => {
  await page.evaluate((mid) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(`[data-marble-id="${mid}"]`));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, id);
  await page.waitForFunction((mid) => window.marble.agent.context().selection.includes(mid), id);
};
const selectWords = async (page, id, words) => {
  await page.evaluate(({ mid, said }) => {
    const text = document.querySelector(`[data-marble-id="${mid}"]`).firstChild;
    const at = text.data.indexOf(said);
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + said.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, { mid: id, said: words });
  await page.waitForFunction((mid) => window.marble.agent.context().selection.includes(mid), id);
};
const ask = async (page, prompt) => {
  await page.locator('.marble-callout-handle:not([hidden])').click();
  const input = page.locator('.marble-callout[data-offer] .marble-offer-input');
  await input.waitFor();
  await page.keyboard.type(prompt);
  await page.keyboard.press('Enter');
};
const caret = (page) => page.locator('.marble-text-caret:not([hidden])');
const marks = (page, name) => page.evaluate((n) => CSS.highlights.get(n)?.size ?? 0, name);

test('work on words is a caret at their end, thinking, with a wash on them — not a box', async () => {
  const page = await open();
  await selectWords(page, 'p', 'keep coming back');
  await ask(page, 'script:think');
  await caret(page).waitFor();
  await page.locator('.marble-text-tag', { hasText: /Agent · (thinking|reading)/ }).waitFor();
  assert.equal(await page.locator('.marble-zone').count(), 0, 'no box round the paragraph');
  assert.equal(await marks(page, 'marble-agent-scope'), 1, 'the words asked about are washed');
  const [end, bar] = await Promise.all([
    page.evaluate(() => {
      const text = document.querySelector('[data-marble-id="p"]').firstChild;
      const at = text.data.indexOf('keep coming back') + 'keep coming back'.length;
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at);
      return range.getClientRects()[0].toJSON();
    }),
    caret(page).boundingBox(),
  ]);
  assert.ok(Math.abs(bar.x - end.left) < 3 && Math.abs(bar.y - end.top) < 3, 'the caret waits at the end of the words');
  // A tag you can press is a way to the chat.
  await page.locator('.marble-text-tag').click();
  await page.locator('.marble-callout[data-state="card"]').waitFor();
});

test('its edit is typed out after the caret, and when the turn ends the caret goes', async () => {
  const page = await open();
  await selectAll(page, 'p');
  await ask(page, 'script:retype');
  await caret(page).waitFor();
  await page.locator('.marble-text-tag', { hasText: 'Agent · typing' }).waitFor({ timeout: 8000 });
  // Mid-type: some of the new words are still hidden, and nothing is boxed.
  await page.waitForFunction(() => (CSS.highlights.get('marble-agent-untyped')?.size ?? 0) > 0, null, { timeout: 4000 });
  assert.equal(await page.locator('.marble-zone').count(), 0);
  assert.equal(await page.locator('[data-marble-id="p"]').textContent(), REWRITTEN, 'the document holds all of it at once; only the drawing waits');
  await page.waitForFunction(() => (CSS.highlights.get('marble-agent-untyped')?.size ?? 0) === 0, null, { timeout: 4000 });
  assert.ok(await marks(page, 'marble-agent-typed') >= 1, 'the new words keep a wash');
  await caret(page).waitFor({ state: 'detached', timeout: 10_000 });
  await page.waitForFunction(() => ['marble-agent-typed', 'marble-agent-typed-2', 'marble-agent-typed-3'].every((n) => (CSS.highlights.get(n)?.size ?? 0) === 0), null, { timeout: 5000 });
  assert.equal(await host.drive.store.read('garden').then((s) => s.includes(REWRITTEN)), true);
});

test('with reduced motion nothing is typed: the words appear at once, washed', async () => {
  const page = await open({ reducedMotion: 'reduce' });
  let hidden = 0;
  await page.exposeFunction('sawHidden', () => { hidden += 1; });
  await page.evaluate(() => {
    document.addEventListener('marble:ops', () => requestAnimationFrame(() => {
      if ((CSS.highlights.get('marble-agent-untyped')?.size ?? 0) > 0) window.sawHidden();
    }));
  });
  await selectAll(page, 'p');
  await ask(page, 'script:retype');
  await page.waitForFunction(() => (CSS.highlights.get('marble-agent-typed')?.size ?? 0) > 0, null, { timeout: 8000 });
  assert.equal(hidden, 0);
});

test('work that is not words keeps its box, and no caret', async () => {
  const page = await open();
  await selectAll(page, 'q');
  await ask(page, 'script:hold');
  await page.locator('.marble-zone').waitFor();
  await page.waitForTimeout(300);
  assert.equal(await caret(page).count(), 0);
});

test('while the person types in the same block, the agent\'s caret steps aside', async () => {
  const page = await open();
  await selectAll(page, 'h');
  await ask(page, 'script:hold');
  await caret(page).waitFor();
  await page.evaluate(() => {
    const h = document.querySelector('[data-marble-id="h"]');
    h.contentEditable = 'true';
    h.focus();
  });
  await caret(page).waitFor({ state: 'hidden' });
  await page.evaluate(() => document.activeElement.blur());
  await caret(page).waitFor();
});
