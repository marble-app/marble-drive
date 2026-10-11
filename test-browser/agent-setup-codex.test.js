// The first visit to a drive that has Claude and Codex and can run neither:
// the popup offers both, says what each one's key looks like and where to make
// one, follows the key that is pasted, and checks it with the company that
// issued it.

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const OPENAI_GOOD = 'sk-proj-good';
const openai = http.createServer((req, res) => {
  const ok = req.headers.authorization === `Bearer ${OPENAI_GOOD}`;
  res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(ok ? { object: 'list', data: [] } : { error: { message: 'Incorrect API key provided' } }));
});
const openaiBase = await new Promise((resolve) => {
  openai.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${openai.address().port}`));
});

const host = await startDrive({
  documents: { garden: GARDEN },
  providers: ['claude-subscription', 'claude-api', 'codex'],
  signedOut: ['claude-subscription', 'codex'],
  env: { MARBLE_DRIVE_OPENAI_BASE: openaiBase },
});
const pages = [];
test.after(async () => {
  for (const page of pages) await page.context().close().catch(() => {});
  await host.close();
  openai.close();
});

async function fresh() {
  await host.reset();
  await host.drive.agents.store.saveSettings({ claudeAuth: 'login', defaultProvider: 'claude-subscription' });
  await fetch(`${host.base}/agent/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: host.base },
    body: JSON.stringify({ keys: { anthropic: '', openai: '' } }),
  });
  const opened = await host.newPage();
  pages.push(opened.page);
  await opened.page.goto(`${host.base}/a/garden`);
  await setup(opened.page).locator('input[name="key"]').waitFor();
  return opened;
}

const setup = (page) => page.locator('marble-agent-setup');
const dialogOpen = (page) => page.evaluate(() => Boolean(document.querySelector('marble-agent-setup')?.shadowRoot.querySelector('dialog')?.open));
const chosen = (page) => page.evaluate(() => document.querySelector('marble-agent-setup').shadowRoot.querySelector('input[name="agent"]:checked')?.value ?? null);
const looks = (page) => page.evaluate(() => {
  const root = document.querySelector('marble-agent-setup').shadowRoot;
  return {
    title: root.querySelector('h2').textContent.trim(),
    lede: root.querySelector('.lede').textContent.trim(),
    placeholder: root.querySelector('input[name="key"]').placeholder,
    link: root.querySelector('.hint a')?.href ?? '',
    choiceShown: !root.querySelector('.agent-choice').hidden,
  };
});

test('a drive with Claude and Codex asks once, for either, starting on Claude', async () => {
  const { page, errors } = await fresh();
  const claude = await looks(page);
  assert.equal(claude.title, 'Connect an agent');
  assert.match(claude.lede, /Claude or Codex/);
  assert.equal(claude.choiceShown, true);
  assert.equal(await chosen(page), 'claude');
  assert.equal(claude.placeholder, 'sk-ant-…');
  assert.match(claude.link, /console\.anthropic\.com/);

  await setup(page).locator('label', { hasText: 'Codex' }).click();
  const codex = await looks(page);
  assert.equal(await chosen(page), 'codex');
  assert.equal(codex.placeholder, 'sk-proj-…');
  assert.match(codex.link, /platform\.openai\.com\/api-keys/);
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-setup').shadowRoot.activeElement?.name), 'key', 'the field keeps the caret');
  assert.deepEqual(errors, []);
});

test('a pasted key picks the agent it belongs to', async () => {
  const { page } = await fresh();
  const field = setup(page).locator('input[name="key"]');
  await setup(page).locator('label', { hasText: 'Codex' }).click();
  await field.fill('sk-ant-api03-something');
  assert.equal(await chosen(page), 'claude');
  await field.fill('sk-proj-something');
  assert.equal(await chosen(page), 'codex');
});

test('a wrong OpenAI key is refused in place; a right one connects Codex and closes', async () => {
  const { page, errors } = await fresh();
  const field = setup(page).locator('input[name="key"]');
  await field.fill('sk-proj-wrong');
  await setup(page).locator('button.save').click();
  await setup(page).locator('.status.error', { hasText: "OpenAI didn't accept" }).waitFor();
  assert.equal(await dialogOpen(page), true);

  await field.fill(OPENAI_GOOD);
  await setup(page).locator('button.save').click();
  await setup(page).locator('.status', { hasText: 'Connected' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('marble-agent-setup').shadowRoot.querySelector('dialog').open);
  assert.equal(await field.inputValue(), '', 'the page does not keep the key');

  const settings = await (await fetch(`${host.base}/agent/settings`)).json();
  assert.equal(settings.keys.openai, true);
  // The stand-in Codex here ignores keys, so read the saved choice itself.
  assert.equal((await host.drive.agents.store.settings()).defaultProvider, 'codex', 'new chats start on the agent that can run');
  // The refused key's 400 is the browser logging an answer the popup read.
  assert.deepEqual(errors.filter((e) => !/status of 400/.test(e)), []);
});
