// Connect your Claude, the sheet: it opens on the page's
// `marble:connect-claude` event and from Agents › Settings › Claude, its one
// action is the sign-in until a code is pasted and then Connect, and the
// whole round trip (address opened in a new tab, code back, token kept)
// works against a fake `claude setup-token` on the host's PATH.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const FAKE = fileURLToPath(new URL('../test/fixtures/fake-claude-setup-token.mjs', import.meta.url));
const binDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fake-claude-bin-'));
await fsp.writeFile(path.join(binDir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
process.env.PATH = `${binDir}:${process.env.PATH}`;

let hasScript = true;
try {
  execFileSync('sh', ['-c', 'command -v script'], { stdio: 'ignore' });
} catch {
  hasScript = false;
}

const host = await startDrive({
  documents: { garden: GARDEN },
  providers: ['claude-subscription', 'claude-api'],
});
const pages = [];
test.after(async () => {
  for (const page of pages) await page.context().close().catch(() => {});
  await host.close();
});

async function fresh(options) {
  await host.reset();
  await host.drive.agents.store.saveSettings({ claudeAuth: 'api', defaultProvider: 'claude-api' });
  await fetch(`${host.base}/agent/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: host.base },
    body: JSON.stringify({ keys: { claude: '' } }),
  });
  const opened = await host.newPage(options);
  pages.push(opened.page);
  // Claude's sign-in page, so the new tab has somewhere to land offline.
  await opened.page.context().route('https://claude.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Claude sign-in</title><p>Your code: good-code#FAKEstate</p>' }));
  await opened.page.goto(`${host.base}/a/garden`);
  await opened.page.waitForFunction(() => customElements.get('marble-claude-connect') && document.querySelector('marble-claude-connect'));
  return opened;
}

const sheet = (page) => page.locator('marble-claude-connect');
const sheetOpen = (page) => page.evaluate(() => Boolean(document.querySelector('marble-claude-connect')?.shadowRoot.querySelector('dialog')?.open));
const ask = (page) => page.evaluate(() => document.dispatchEvent(new CustomEvent('marble:connect-claude')));

test('the page event opens the sheet, in the spec\'s words, with one action', async () => {
  const { page, errors } = await fresh();
  assert.equal(await sheetOpen(page), false, 'closed until asked');
  await ask(page);
  assert.equal(await sheetOpen(page), true);
  const s = sheet(page);
  assert.equal(await s.locator('h2').textContent(), 'Connect your Claude');
  assert.equal(await s.locator('.lede').textContent(), 'Agents on this drive then run on your Claude plan, not on credit.');
  assert.deepEqual(await s.locator('.steps li').allTextContents(), ['Sign in to Claude in the tab this opens', 'Copy the code it shows you and paste it here']);
  assert.match(await s.locator('label').textContent(), /Code from Claude/);
  assert.equal(await s.locator('button.key').textContent(), 'Use an API key instead');
  assert.equal(await s.locator('button.save').count(), 1, 'one action');
  assert.equal(await s.locator('button.save').textContent(), 'Open Claude sign-in');
  assert.deepEqual(errors, []);
});

test('the action becomes Connect once a code is pasted, and goes back when it is cleared', async () => {
  const { page } = await fresh();
  await ask(page);
  const field = sheet(page).locator('input[name="code"]');
  await field.fill('abc123#state');
  assert.equal(await sheet(page).locator('button.save').textContent(), 'Connect');
  await field.fill('   ');
  assert.equal(await sheet(page).locator('button.save').textContent(), 'Open Claude sign-in');
  await page.keyboard.press('Escape');
  assert.equal(await sheetOpen(page), false, 'Escape closes it');
});

test('Agents › Settings › Claude opens it; Use an API key instead goes to the key popup', async () => {
  const { page } = await fresh();
  await page.evaluate(() => dispatchEvent(new CustomEvent('marble:agent-settings')));
  const settings = page.locator('marble-agent-settings');
  await settings.locator('input[name="claude-auth"][value="login"]').check({ force: true });
  await settings.locator('.claude-plan button', { hasText: 'Connect your Claude' }).click();
  await page.waitForFunction(() => document.querySelector('marble-claude-connect').shadowRoot.querySelector('dialog').open);
  assert.equal(await settings.getAttribute('data-open'), 'false', 'settings made way for it');

  await sheet(page).locator('button.key').click();
  assert.equal(await sheetOpen(page), false);
  await page.waitForFunction(() => document.querySelector('marble-agent-setup')?.shadowRoot.querySelector('dialog')?.open);
  assert.equal(await page.locator('marble-agent-setup input[name="key"]').getAttribute('placeholder'), 'sk-ant-…');
});

test('the whole way: Claude sign-in opens in a new tab, the code connects, Claude runs on the plan', { skip: hasScript ? false : 'no `script` on this machine' }, async () => {
  const { page, errors } = await fresh();
  await ask(page);
  const [tab] = await Promise.all([
    page.context().waitForEvent('page'),
    sheet(page).locator('button.save').click(),
  ]);
  await tab.waitForURL(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true/);
  assert.equal(await tab.evaluate(() => window.opener), null, 'the sign-in tab cannot reach the drive');
  await sheet(page).locator('.status', { hasText: 'Paste the code' }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('marble-claude-connect').shadowRoot.activeElement?.name), 'code', 'the field is ready for the paste');

  await sheet(page).locator('input[name="code"]').fill('good-code#FAKEstate');
  await sheet(page).locator('button.save', { hasText: 'Connect' }).click();
  await sheet(page).locator('.status', { hasText: 'Connected' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('marble-claude-connect').shadowRoot.querySelector('dialog').open);

  const settings = await (await fetch(`${host.base}/agent/settings`)).json();
  assert.equal(settings.keys.claude, true);
  assert.equal(settings.claudeAuth, 'login');
  assert.deepEqual(errors, []);
});

test('a code with no sign-in waiting is turned away and the action goes back to the sign-in', async () => {
  const { page } = await fresh();
  await ask(page);
  await sheet(page).locator('input[name="code"]').fill('good-but-nothing-started');
  await sheet(page).locator('button.save').click();
  await sheet(page).locator('.status.error', { hasText: 'Open Claude sign-in again' }).waitFor();
  assert.equal(await sheet(page).locator('button.save').textContent(), 'Open Claude sign-in');
});
