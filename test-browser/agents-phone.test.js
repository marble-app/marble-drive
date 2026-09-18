// The Agents document on a phone: Deck, the fisheye Focus, the chrome and
// the sheets, all at 393 × 852 with a touch context.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { say: 'Read it.' },
  ],
  permission: [{ ask: { tool: 'Bash', input: { command: 'rm -rf build' } } }, { say: 'after' }],
};

const host = await startDrive({
  scripts: SCRIPTS,
  documents: { garden: GARDEN, Agents: AGENTS },
});
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: PHONE, hasTouch: true, isMobile: true, ...options });
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      const { folders } = await window.marble.agent.folders();
      for (const row of folders) await window.marble.agent.deleteFolder(row.id);
    } catch { /* fresh agent */ }
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
    localStorage.clear();
  });
  return { page, errors };
};

test('at phone width, Deck is the default view; a stored view wins', async () => {
  const { page } = await openAgents();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-view')), 'deck');
  assert.equal(await page.evaluate(() => document.body.hasAttribute('data-phone')), true);
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'library'));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-view')), 'library');
});

test('V cycles through five views and comes back', async () => {
  const { page } = await openAgents({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('v');
    seen.push(await page.evaluate(() => document.body.getAttribute('data-view')));
  }
  assert.deepEqual(seen, ['board', 'folders', 'focus', 'deck', 'library']);
});

test('Deck: an asking conversation is a card in NEEDS YOU with a peek; Allow answers it optimistically', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  const card = page.locator('.deck [data-band="asks"] .deck-ask');
  await card.waitFor();
  assert.match(await card.locator('.deck-ask-title').textContent(), /script:permission|Untitled/);
  assert.match(await card.locator('.deck-peek').textContent(), /rm -rf build/);
  assert.match(await page.locator('.deck [data-band="asks"] .band-count').textContent(), /1/);
  await card.locator('button.allow').click();
  // Gone on tap, before the answer lands.
  assert.equal(await page.locator('.deck-ask').count(), 0);
  await page.locator(`.deck [data-band]:not([data-band="asks"]) .conv[data-id="${id}"]`).waitFor();
});

test('Deck: running, review and idle rows land in their bands with counts', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    return [await agent.start({ provider: 'fake' }), await agent.start({ provider: 'fake' })];
  });
  await host.drive.agents.store.updateConversation(ids[0], { running: true, activity: 'reading' });
  await host.drive.agents.store.updateConversation(ids[1], { lastOutcome: 'failed', lastFinishedAt: Date.now(), activity: 'boom' });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.deck .conv').length >= 2);
  assert.equal(await page.locator(`[data-band="running"] .conv[data-id="${ids[0]}"]`).count(), 1);
  assert.equal(await page.locator(`[data-band="review"] .conv[data-id="${ids[1]}"]`).count(), 1);
  assert.equal((await page.locator('[data-band="running"] .band-count').textContent()).trim(), '1');
  assert.equal(await page.evaluate(() => document.querySelector('[data-band="idle"]').hasAttribute('data-collapsed')), true);
});
