// The chat's keys (v4 of Ask at Anything). ⌘J asks in place and is tested
// with the callout; this file is the other two. ⌘⇧O is New chat from any
// page: the side chat opens on a fresh conversation, even mid-sentence in
// the page. ⌘⇧J shows and hides the chat, the way ⌘⇧\ pins and unpins the
// tree. Neither may press a page's own New, which on the Drive makes a
// document.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

// A page with its own New in a top bar, as the Drive has: ⌘⇧O must not press it.
const WITH_NEW = GARDEN.replace('<h1 data-marble-id="h">', `<header class="topbar" data-marble-id="tb"><button class="new" data-marble-transient onclick="window.__pressedNew = (window.__pressedNew || 0) + 1">New</button></header>
  <h1 data-marble-id="h">`);

const host = await startDrive({ documents: { garden: GARDEN, drivelike: WITH_NEW } });
test.after(() => host.close());

async function visit(path = 'garden', { shell = false } = {}) {
  const { page, errors } = await host.newPage();
  if (shell) await page.addInitScript(() => localStorage.setItem('marble-shell:open', '1'));
  await page.goto(`${host.base}/a/${path}`);
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher'));
  return { page, errors, drawer: page.locator('marble-agent-drawer') };
}

const drawerOpen = (page) => page.evaluate(() => document.querySelector('marble-agent-drawer').isOpen);
const deepFocus = (page) => page.evaluate(() => {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el ? (el.getAttribute('data-marble-id') || el.className || el.localName) : null;
});

test('⌘⇧O opens the side chat on a new conversation, from the middle of typing in the page', async () => {
  await host.reset();
  const { page, errors, drawer } = await visit();
  // A conversation already showing, so "new" is something that happens.
  await page.evaluate(async () => {
    const res = await fetch('/agent/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'fake' }) });
    const { id } = await res.json();
    document.querySelector('marble-agent-drawer').shadowRoot.querySelector('marble-conversation').setAttribute('conversation', id);
  });
  await page.evaluate(() => {
    const p = document.querySelector('[data-marble-id="p"]');
    p.contentEditable = 'true';
    p.focus();
  });
  await page.keyboard.type('half a sen');
  await page.keyboard.press('ControlOrMeta+Shift+O');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === true);
  assert.equal(await drawer.locator('marble-conversation').getAttribute('conversation'), null, 'a new conversation, not the last one');
  assert.equal(await page.locator('[data-marble-id="p"]').innerText(), 'half a senOpen questions we keep coming back to.', 'the chord typed nothing');
  await page.waitForFunction(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return Boolean(el?.closest?.('marble-conversation') || el?.getRootNode?.()?.host?.localName === 'marble-conversation');
  });
  assert.deepEqual(errors.filter((m) => !/favicon/.test(m)), []);
});

test('⌘⇧O never presses the page\'s own New', async () => {
  await host.reset();
  const { page } = await visit('drivelike');
  await page.keyboard.press('ControlOrMeta+Shift+O');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === true);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__pressedNew ?? 0), 0, 'the Drive\'s New makes a document, not a chat');
});

test('⌘⇧J opens and closes the chat, and gives the caret back to the page', async () => {
  await host.reset();
  const { page } = await visit();
  await page.evaluate(() => {
    const p = document.querySelector('[data-marble-id="p"]');
    p.contentEditable = 'true';
    p.focus();
  });
  assert.equal(await drawerOpen(page), false);
  await page.keyboard.press('ControlOrMeta+Shift+J');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === true);
  await page.keyboard.press('ControlOrMeta+Shift+J');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === false);
  assert.equal(await deepFocus(page), 'p', 'the caret is back where it was');
  assert.equal(
    await page.evaluate(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.tray').dataset.open),
    'false',
    'putting the chat away by key does not hang the tray\'s menu up',
  );
});

test('with the drive around the page, ⌘⇧J pins and unpins the chat, as ⌘⇧\\ does the tree', async () => {
  await host.reset();
  const { page } = await visit('garden', { shell: true });
  await page.waitForFunction(() => document.querySelector('marble-shell')?.hasAttribute('data-open'));
  const pinned = () => page.evaluate(() => window.marbleShell.layout?.pinChat);
  const start = await pinned();
  await page.keyboard.press('ControlOrMeta+Shift+J');
  await page.waitForFunction((was) => window.marbleShell.layout?.pinChat === !was, start);
  if (start) {
    // It was pinned: now it waits at the edge, out of the way.
    await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === false);
  }
  await page.keyboard.press('ControlOrMeta+Shift+J');
  await page.waitForFunction((was) => window.marbleShell.layout?.pinChat === was, start);
  assert.equal(
    await page.evaluate(() => document.querySelector('marble-shell').shadowRoot.querySelector('[data-act="chat"]').title),
    `${start ? 'Unpin the chat: it waits at the edge' : 'Pin the chat'} (⌘⇧J)`,
    'the chat button names its key',
  );
});
