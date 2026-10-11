// Starter credit on the page: Agents › Settings › Claude says whose credit
// and how much is used, with Connect your Claude and Use an API key instead;
// the chat says when it is used up (and opens the sheet once) and, once on
// the drive, when less than a dollar is left.

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const TOKEN = `mdc_${'7c'.repeat(24)}`;
const balance = { cap: 5, spent: 3.9 };
const proxy = http.createServer((req, res) => {
  const ok = req.url === '/_credit/balance' && req.headers['x-api-key'] === TOKEN;
  res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
  res.end(ok ? JSON.stringify({ ...balance, left: Math.max(0, balance.cap - balance.spent), by: 'Bryan' }) : '{}');
});
const proxyBase = await new Promise((resolve) => proxy.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${proxy.address().port}/_credit`)));

const host = await startDrive({
  documents: { garden: GARDEN },
  providers: ['claude-subscription', 'claude-api', 'claude-credit'],
  signedOut: ['claude-subscription', 'claude-api'],
  env: { MARBLE_DRIVE_AGENT_PROVIDER: 'claude-api', MARBLE_CREDIT_URL: proxyBase, MARBLE_CREDIT_TOKEN: TOKEN },
});
test.after(() => {
  host.close();
  proxy.close();
});

/** Count Connect your Claude; `take` says whether a sheet answers it. */
const listen = (page, take = true) => page.evaluate((taking) => {
  window.__connects = 0;
  document.addEventListener('marble:connect-claude', (event) => {
    window.__connects += 1;
    if (taking) event.preventDefault();
  });
}, take);

/** A chat on credit, in a bare <marble-conversation>: the drawer is not
 *  needed to test the view. */
async function chat(page) {
  return page.evaluate(async () => {
    const made = await (await fetch('/agent/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'claude-credit' }) })).json();
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    el.setAttribute('conversation', made.id);
    el.style.cssText = 'position:fixed;right:0;top:0;width:420px;height:100vh;';
    document.body.append(el);
    return made.id;
  });
}

async function openSettings(page) {
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent?.openSettings));
  await page.evaluate(() => window.marble.agent.openSettings());
  const settings = page.locator('marble-agent-settings');
  await settings.locator('.claude-credit').waitFor();
  return settings;
}

test('Claude in settings: on Bryan’s starter credit, how much is used, and the two ways off it', async () => {
  balance.spent = 3.9;
  const { page, errors } = await host.newPage();
  const settings = await openSettings(page);
  await listen(page);
  const line = settings.locator('.claude-credit');
  assert.equal(await settings.locator('input[name="claude-auth"][value="credit"]').isChecked(), true);
  assert.equal(await line.locator('.credit-whose').innerText(), 'On Bryan’s starter credit');
  assert.equal(await line.locator('.credit-used').innerText(), '$3.90 of $5 used');
  assert.equal(await settings.locator('.claude-key').isHidden(), true);
  assert.equal(await settings.locator('marble-agent-setup dialog[open]').count(), 0);

  await line.getByRole('button', { name: 'Use an API key instead' }).click();
  assert.equal(await settings.locator('input[name="claude-auth"][value="api"]').isChecked(), true);
  assert.equal(await settings.locator('.claude-key').isVisible(), true);
  assert.equal(await line.isHidden(), true);

  // Back to credit, and saved: credit is a choice that sticks.
  await settings.locator('.claude-auth label', { hasText: 'Starter credit' }).click();
  await settings.locator('button.save').click();
  await page.waitForFunction(() => document.querySelector('marble-agent-settings')?.getAttribute('data-open') === 'false');
  assert.equal((await host.drive.agents.store.settings()).claudeAuth, 'credit');

  // Connect your Claude fires the event the sheet listens for, and the
  // settings make way for the sheet.
  const again = await openSettings(page);
  await listen(page);
  await again.locator('.claude-credit').getByRole('button', { name: 'Connect your Claude' }).click();
  assert.equal(await page.evaluate(() => window.__connects), 1, 'the event the Connect sheet listens for');
  await page.waitForFunction(() => document.querySelector('marble-claude-connect')?.shadowRoot.querySelector('dialog')?.open);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('on a phone the credit line fits and its buttons take a thumb', async () => {
  const { page } = await host.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const settings = await openSettings(page);
  const box = await settings.locator('.claude-credit').boundingBox();
  assert.ok(box.width <= 390, 'fits the phone');
  const tall = await settings.locator('.claude-credit button').first().boundingBox();
  assert.ok(tall.height >= 44, 'a thumb-sized button');
  await page.context().close();
});

test('a chat whose credit ran out says so above the box and opens the Connect sheet once', async () => {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await listen(page);
  const id = await chat(page);
  const view = page.locator('body > marble-conversation');
  await view.locator('.editor').waitFor();
  for (const n of [1, 2]) {
    await view.evaluate((el, [c, i]) => el.receive({ type: 'turn.failed', creditUsedUp: true, error: 'Starter credit used up.', turn: `${c}-t${i}` }), [id, n]);
  }
  const note = view.locator('.credit-note');
  await note.waitFor();
  assert.equal(await view.locator('.credit-note-text').innerText(), 'Starter credit used up. Connect your Claude to keep going.');
  assert.equal(await page.evaluate(() => window.__connects), 1, 'the sheet opens once, not every turn');
  const place = await view.evaluate((el) => el.shadowRoot.querySelector('.credit-note').getBoundingClientRect().bottom <= el.shadowRoot.querySelector('.editor').getBoundingClientRect().top);
  assert.ok(place, 'the note sits above the box');
  // The sheet it opened is closed before the note's own button is tried.
  await page.waitForFunction(() => document.querySelector('marble-claude-connect')?.shadowRoot.querySelector('dialog')?.open);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('marble-claude-connect').shadowRoot.querySelector('dialog').open);
  await view.locator('.credit-note .credit-connect').click();
  assert.equal(await page.evaluate(() => window.__connects), 2);
  await page.waitForFunction(() => document.querySelector('marble-claude-connect')?.shadowRoot.querySelector('dialog')?.open);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('marble-claude-connect').shadowRoot.querySelector('dialog').open);
  await view.locator('.credit-note .credit-leave').click();
  await note.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('under a dollar left, the chat says so once on this drive', async () => {
  balance.spent = 4.4;
  try {
    const { page } = await host.newPage();
    await page.goto(`${host.base}/a/garden`);
    await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
    await page.evaluate(() => localStorage.removeItem('marble-credit-low-said'));
    let id = null;
    const make = async () => {
      await page.evaluate(() => document.querySelector('body > marble-conversation')?.remove());
      id = await chat(page);
    };
    await make();
    const view = page.locator('body > marble-conversation');
    await view.locator('.editor').waitFor();
    await page.waitForFunction(() => document.querySelector('body > marble-conversation')?.meta?.provider === 'claude-credit');
    const done = () => view.evaluate((el, c) => el.receive({ type: 'turn.completed', turn: `${c}-t1` }), id);
    await done();
    await view.locator('.credit-note').waitFor();
    assert.equal(await view.locator('.credit-note-text').innerText(), 'Under a dollar of Bryan’s starter credit left.');
    await view.locator('.credit-note .credit-leave').click();

    await make();
    await view.locator('.editor').waitFor();
    await page.waitForFunction(() => document.querySelector('body > marble-conversation')?.meta?.provider === 'claude-credit');
    await done();
    await page.waitForTimeout(400);
    assert.equal(await view.locator('.credit-note').isHidden(), true, 'said once');
    await page.context().close();
  } finally {
    balance.spent = 3.9;
  }
});
