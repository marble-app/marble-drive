import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

// The work, on the page: a dot on each part an agent changed (kept until you
// clear them), a rail with a tick for each, the island while the chat is
// closed, and a walk through the changes only when asked for.
const LIST = '<section><h2>Shopping list</h2><ul><li>Tomatoes</li></ul></section>';
const SCRIPTS = {
  building: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'the list', ops: [{ type: 'insert', parentId: 'b', html: LIST }] } },
    { sleep: 300 },
    { call: 'apply_ops', args: { path: 'garden', note: 'a warmer heading', ops: [{ type: 'setAttr', id: 'h', name: 'style', value: 'color: #c0643f' }] } },
    { sleep: 300 },
    { say: 'Done.' },
  ],
  slow: [
    { call: 'apply_ops', args: { path: 'garden', note: 'the list', ops: [{ type: 'insert', parentId: 'b', html: LIST }] } },
    { sleep: 4000 },
    { say: 'Done.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN } });
test.after(() => host.close());

async function mount() {
  await host.reset();
  const { page, errors } = await host.newPage({ detail: 'simple' });
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation') && window.marbleWork));
  await page.evaluate(() => {
    window.marbleWork.clear();
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    el.style.cssText = 'position:fixed;right:0;top:0;width:420px;height:100vh;';
    document.body.append(el);
  });
  const view = page.locator('body > marble-conversation');
  const send = async (text) => {
    await view.locator('.editor').fill(text);
    await view.locator('.editor').press('Enter');
  };
  const work = (sel) => page.evaluate((s) => [...document.querySelector('marble-work').shadowRoot.querySelectorAll(s)].length, sel);
  return { page, errors, view, send, work };
}

test('each part an agent changed keeps a dot and a tick on the rail, shown only once asked for, until cleared', async () => {
  const { page, errors, view, send, work } = await mount();
  await send('script:building');
  await view.locator('.progress[data-state="completed"]').waitFor();
  await page.waitForFunction(() => window.marbleWork.dots().length >= 2);
  await page.waitForTimeout(200);
  assert.equal(await work('.dot'), 0, 'no dots on the page by default');
  assert.equal(await page.evaluate(() => document.querySelector('marble-work').shadowRoot.querySelector('.rail').hidden), true);
  await page.evaluate(() => { localStorage.setItem('marble-agent-dots', '1'); dispatchEvent(new CustomEvent('marble-agent-dots')); });
  await page.waitForFunction(() => document.querySelector('marble-work').shadowRoot.querySelectorAll('.dot').length >= 2);
  assert.ok(await work('.dot') >= 2);
  assert.ok(await work('.tick') >= 2);
  // Kept per page in this browser: a reload still has them.
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marbleWork));
  await page.waitForFunction(() => document.querySelector('marble-work').shadowRoot.querySelectorAll('.tick').length >= 2);
  await page.evaluate(() => document.querySelector('marble-work').shadowRoot.querySelector('.clear').click());
  await page.waitForFunction(() => document.querySelector('marble-work').shadowRoot.querySelectorAll('.tick, .dot').length === 0);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('while the chat is closed, the island carries the turn’s line', async () => {
  const { page, send, work } = await mount();
  await send('script:slow');
  await page.waitForFunction(() => {
    const island = document.querySelector('marble-work').shadowRoot.querySelector('.island');
    return !island.hidden && island.dataset.state === 'running';
  });
  const say = await page.evaluate(() => document.querySelector('marble-work').shadowRoot.querySelector('.isl-say').textContent);
  assert.match(say, /Updating garden|Putting|Writing/);
  // Done, it opens by itself and offers to walk through the changes.
  await page.waitForFunction(() => document.querySelector('marble-work').shadowRoot.querySelector('.island').dataset.state === 'completed', null, { timeout: 15000 });
  const acts = await page.evaluate(() => [...document.querySelector('marble-work').shadowRoot.querySelectorAll('.isl-acts button')].map((b) => b.textContent));
  assert.deepEqual(acts, ['Review changes', 'Open chat', 'Done']);
  assert.equal(await work('.tour:not([hidden])'), 0, 'the walk does not start by itself');
  await page.context().close();
});

test('Review on the page walks through a turn’s changes, part by part', async () => {
  const { page, view, send } = await mount();
  await send('script:building');
  await view.locator('.progress[data-state="completed"]').waitFor();
  await view.locator('.w-review').click();
  const where = () => page.evaluate(() => document.querySelector('marble-work').shadowRoot.querySelector('.tour-where').textContent);
  await page.waitForFunction(() => !document.querySelector('marble-work').shadowRoot.querySelector('.tour').hidden);
  assert.match(await where(), /^Change 1 of \d/);
  await page.evaluate(() => document.querySelector('marble-work').shadowRoot.querySelector('.tour [data-a="next"]').click());
  assert.match(await where(), /^Change 2 of \d/);
  await page.evaluate(() => document.querySelector('marble-work').shadowRoot.querySelector('.tour [data-a="done"]').click());
  assert.equal(await page.evaluate(() => document.querySelector('marble-work').shadowRoot.querySelector('.tour').hidden), true);
  await page.context().close();
});
