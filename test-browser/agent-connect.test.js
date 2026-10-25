// Connect an agent, the sheet (the plan's screens 4 and 5): it opens by
// itself on the first page of a visit to a drive with no agent that works,
// offers Claude, ChatGPT and an API key, and each sign-in goes the whole way
// against the fake CLIs on the host's PATH (test/fixtures): Claude's page in
// a new tab and its code typed back into `claude auth login`; OpenAI's
// one-time code shown large while `codex login --device-auth` waits, and the
// sheet closing when the login lands. Settings then says which plan each
// agent is on, with Disconnect.
//
// HOME is a scratch folder, so the fakes' "logins" land there and this
// machine's own ~/.claude and ~/.codex are never touched. Playwright finds its
// Chromium under HOME unless told where, so it is told first.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(os.homedir(), '.cache', 'ms-playwright');
const HOME = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-connect-home-'));
process.env.HOME = HOME;

const { GARDEN, startDrive } = await import('./harness.js');

const CLAUDE_FAKE = fileURLToPath(new URL('../test/fixtures/fake-claude-auth.mjs', import.meta.url));
const CODEX_FAKE = fileURLToPath(new URL('../test/fixtures/fake-codex-login.mjs', import.meta.url));
const binDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fake-cli-bin-'));
await fsp.writeFile(path.join(binDir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${CLAUDE_FAKE}" "$@"\n`, { mode: 0o755 });
await fsp.writeFile(path.join(binDir, 'codex'), `#!/bin/sh\nexec "${process.execPath}" "${CODEX_FAKE}" "$@"\n`, { mode: 0o755 });
process.env.PATH = `${binDir}:${process.env.PATH}`;

const claudeLogin = path.join(HOME, '.claude', 'fake-login.json');
const codexLogin = path.join(HOME, '.codex', 'fake-login.json');
// Where the pictures of the sheet go, for the pull request.
const SHOTS = process.env.MARBLE_CONNECT_SHOTS || path.join(os.tmpdir(), 'pc-signin-shots');

let hasScript = true;
try {
  execFileSync('sh', ['-c', 'command -v script'], { stdio: 'ignore' });
} catch {
  hasScript = false;
}

const host = await startDrive({
  documents: { garden: GARDEN },
  providers: ['claude-subscription', 'claude-api', 'codex'],
  signedOut: ['claude-api', 'fake'],
  // The stand-in agents are signed in when the fake CLIs keep a login.
  detect: {
    'claude-subscription': async () => ({ installed: true, signedIn: fs.existsSync(claudeLogin), detail: fs.existsSync(claudeLogin) ? 'signed in (claude.ai)' : 'run `claude` once to sign in' }),
    codex: async () => ({ installed: true, signedIn: fs.existsSync(codexLogin), detail: fs.existsSync(codexLogin) ? 'signed in with ChatGPT' : 'add an OpenAI API key, or run `codex login`' }),
  },
  env: { MARBLE_HOST_OWNER: 'Bryan', MARBLE_DRIVE_AGENT_PROVIDER: 'claude-subscription' },
});
const pages = [];
test.after(async () => {
  for (const page of pages) await page.context().close().catch(() => {});
  await host.close();
});

const post = (route) => fetch(`${host.base}${route}`, { method: 'POST', headers: { Origin: host.base } });

/** A drive with neither agent signed in, and a new tab on the garden. */
async function fresh(options) {
  await host.reset();
  // Each CLI's own logout, which also tells the host to look again.
  await post('/agent/claude/sign-out');
  await post('/agent/codex/sign-out');
  await fsp.rm(path.join(HOME, 'fake-approve'), { force: true });
  await host.drive.agents.store.saveSettings({ claudeAuth: 'login', defaultProvider: 'claude-subscription', setupLater: null });
  const opened = await host.newPage(options);
  pages.push(opened.page);
  // The two sign-in pages, so a new tab has somewhere to land offline.
  await opened.page.context().route('https://claude.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Claude sign-in</title><p>Your code: good-code#FAKEstate</p>' }));
  await opened.page.context().route('https://auth.openai.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>OpenAI device sign-in</title><p>Enter your code</p>' }));
  await opened.page.goto(`${host.base}/a/garden`);
  await opened.page.waitForFunction(() => document.querySelector('marble-agent-setup')?.shadowRoot.querySelector('dialog')?.open);
  return opened;
}

const sheet = (page) => page.locator('marble-agent-setup');
const sheetOpen = (page) => page.evaluate(() => Boolean(document.querySelector('marble-agent-setup')?.shadowRoot.querySelector('dialog')?.open));
const viewOf = (page) => page.evaluate(() => document.querySelector('marble-agent-setup').shadowRoot.querySelector('.view:not([hidden])')?.dataset.view ?? null);
const words = (page) => page.evaluate(() => {
  const root = document.querySelector('marble-agent-setup').shadowRoot;
  const shown = (el) => el && !el.hidden && el.getClientRects().length > 0;
  return {
    title: root.querySelector('h2').textContent.trim(),
    lede: root.querySelector('.lede').textContent.trim(),
    rows: [...root.querySelectorAll('.choice')].filter(shown).map((row) => row.innerText.replace(/\s+/g, ' ').trim()),
    buttons: [...root.querySelectorAll('.actions button')].filter(shown).map((b) => b.textContent.trim()),
    status: root.querySelector('.status').textContent.trim(),
  };
});

test('the first page of a visit opens Connect an agent, in the plan\'s words', async () => {
  const { page, errors } = await fresh();
  assert.equal(await viewOf(page), 'choose');
  assert.deepEqual(await words(page), {
    title: 'Connect an agent',
    lede: 'Agents on this drive run on your own Claude or ChatGPT plan. You sign in on their page, so Bryan never sees your password.',
    rows: ['Claude', 'ChatGPT Its agent is called Codex here'],
    buttons: ['Use an API key instead', 'Not now'],
    status: '',
  });
  // Nothing looks chosen before anything is: the title has the caret, and
  // Tab reaches Claude.
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-setup').shadowRoot.activeElement?.id), 'agent-setup-title');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-setup').shadowRoot.activeElement?.dataset.agent), 'claude');
  assert.deepEqual(errors, []);
});

test('Claude: its page opens in a new tab, the code goes back to the CLI, and the sheet closes', { skip: hasScript ? false : 'no `script` on this machine' }, async () => {
  const { page, errors } = await fresh();
  await sheet(page).locator('.choice[data-agent="claude"]').click();
  assert.equal(await viewOf(page), 'claude');
  const shown = await words(page);
  assert.equal(shown.title, 'Connect your Claude');
  assert.equal(shown.lede, 'Open Claude’s sign-in, then paste the code it shows here.');
  assert.deepEqual(shown.buttons, ['Back', 'Open Claude sign-in']);

  const [tab] = await Promise.all([
    page.context().waitForEvent('page'),
    sheet(page).locator('button.save').click(),
  ]);
  await tab.waitForURL(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true/);
  assert.equal(await tab.evaluate(() => window.opener), null, 'the sign-in tab cannot reach the drive');
  await sheet(page).locator('.status', { hasText: 'Paste the code from Claude' }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-setup').shadowRoot.activeElement?.name), 'code', 'the field is ready for the paste');

  await sheet(page).locator('input[name="code"]').fill('good-code#FAKEstate');
  assert.equal(await sheet(page).locator('button.save').textContent(), 'Connect');
  await sheet(page).locator('button.save').click();
  await sheet(page).locator('.status', { hasText: 'Connected. Agents now run on your Claude plan.' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('marble-agent-setup').shadowRoot.querySelector('dialog').open);
  assert.ok(fs.existsSync(claudeLogin), 'Claude Code keeps the login, in the drive\'s home');

  const settings = await (await fetch(`${host.base}/agent/settings`)).json();
  assert.equal(settings.keys.claude, false, 'no token in Marble\'s key file');
  assert.equal(settings.claudeAuth, 'login');
  assert.equal(settings.logins.claude, true);
  assert.equal(settings.signOut.claude, true, 'a login this drive made is its to end');

  // Settings says so, and Disconnect is Claude Code's own logout.
  await page.evaluate(() => window.marble.agent.openSettings());
  const plan = page.locator('marble-agent-settings .claude-plan');
  await plan.locator('span', { hasText: 'On your Claude plan' }).waitFor();
  await plan.getByRole('button', { name: 'Disconnect' }).click();
  await plan.getByRole('button', { name: 'Connect your Claude' }).waitFor();
  assert.equal(fs.existsSync(claudeLogin), false, 'the CLI forgot its login');
  assert.deepEqual(errors, []);
});

test('Claude: half a code is asked for again; a refused one goes back to the sign-in', { skip: hasScript ? false : 'no `script` on this machine' }, async () => {
  const { page } = await fresh();
  await sheet(page).locator('.choice[data-agent="claude"]').click();
  await Promise.all([page.context().waitForEvent('page'), sheet(page).locator('button.save').click()]);
  await sheet(page).locator('.status', { hasText: 'Paste the code' }).waitFor();
  const field = sheet(page).locator('input[name="code"]');
  await field.fill('good-but-no-state');
  await sheet(page).locator('button.save').click();
  await sheet(page).locator('.status.error', { hasText: "isn't the whole code" }).waitFor();
  assert.equal(await field.inputValue(), 'good-but-no-state', 'kept, to be pasted over');
  assert.equal(await sheet(page).locator('button.save').textContent(), 'Connect', 'the same sign-in still waits');

  await field.fill('wrong-code#state');
  await sheet(page).locator('button.save').click();
  await sheet(page).locator('.status.error', { hasText: "didn't accept that code" }).waitFor();
  assert.equal(await sheet(page).locator('button.save').textContent(), 'Open Claude sign-in');
});

test('ChatGPT: the code is shown large, OpenAI\'s page opens on the press, and the sheet closes when the login lands', async () => {
  const { page, errors } = await fresh();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: host.base });
  await sheet(page).locator('.choice[data-agent="codex"]').click();
  assert.equal(await viewOf(page), 'codex');
  await sheet(page).locator('.code', { hasText: 'FAKE-C0DE7' }).waitFor();
  const shown = await words(page);
  assert.equal(shown.title, 'Connect your ChatGPT');
  assert.equal(shown.lede, 'Open OpenAI’s sign-in, then enter this code there.');
  assert.equal(shown.status, 'Waiting for the code on OpenAI’s page…');
  assert.deepEqual(shown.buttons, ['Back', 'Open OpenAI sign-in']);
  assert.equal(await sheet(page).locator('.device-hint').textContent(), 'Enter it at auth.openai.com/codex/device. It lasts 15 minutes.');
  // Large enough to read off one screen and type on another.
  const size = await sheet(page).locator('.code').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(size >= 22, `the code is ${size}px`);

  await sheet(page).locator('button.copy').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'FAKE-C0DE7');

  const [tab] = await Promise.all([
    page.context().waitForEvent('page'),
    sheet(page).locator('button.save').click(),
  ]);
  await tab.waitForURL('https://auth.openai.com/codex/device');
  assert.equal(await sheetOpen(page), true, 'the sheet waits');

  // The person enters the code on OpenAI's page; OpenAI hands the login to
  // the waiting CLI. Nothing passes through the page.
  await fsp.writeFile(path.join(HOME, 'fake-approve'), '');
  await sheet(page).locator('.status', { hasText: 'Connected. Agents now run on your ChatGPT plan.' }).waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => !document.querySelector('marble-agent-setup').shadowRoot.querySelector('dialog').open);
  assert.ok(fs.existsSync(codexLogin), 'Codex keeps the login, in the drive\'s home');

  const settings = await (await fetch(`${host.base}/agent/settings`)).json();
  assert.equal(settings.logins.chatgpt, true);
  assert.equal(settings.defaultProvider, 'codex', 'new chats start on the agent that runs');
  await page.evaluate(() => window.marble.agent.openSettings());
  const plan = page.locator('marble-agent-settings .codex-plan');
  await plan.locator('span', { hasText: 'On your ChatGPT plan' }).waitFor();
  await plan.getByRole('button', { name: 'Disconnect' }).click();
  await plan.getByRole('button', { name: 'Connect your ChatGPT' }).waitFor();
  assert.equal(fs.existsSync(codexLogin), false, 'Codex forgot its login');
  assert.deepEqual(errors, []);
});

test('a ChatGPT code that runs out says so, and a new one can be had', async () => {
  const { page } = await fresh();
  // An expiring Codex for this one test.
  const expiring = path.join(binDir, 'codex');
  const before = await fsp.readFile(expiring, 'utf8');
  await fsp.writeFile(expiring, before.replace('"$@"', '"$@" --mode expire'));
  try {
    await sheet(page).locator('.choice[data-agent="codex"]').click();
    await sheet(page).locator('.status.error', { hasText: 'That code ran out' }).waitFor({ timeout: 10_000 });
    assert.equal(await sheet(page).locator('button.save').textContent(), 'Get a new code');
  } finally {
    await fsp.writeFile(expiring, before);
  }
  await sheet(page).locator('button.save').click();
  await sheet(page).locator('.status', { hasText: 'Waiting for the code' }).waitFor();
  assert.equal(await sheet(page).locator('.code').textContent(), 'FAKE-C0DE7');
});

test('Use an API key instead: a key for either, and Back goes back', async () => {
  const { page } = await fresh();
  await sheet(page).getByRole('button', { name: 'Use an API key instead' }).click();
  assert.equal(await viewOf(page), 'key');
  const shown = await words(page);
  assert.equal(shown.title, 'Use an API key');
  assert.equal(shown.lede, 'Paste a key from Anthropic for Claude, or from OpenAI for Codex.');
  assert.deepEqual(shown.buttons, ['Back', 'Connect']);
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-setup').shadowRoot.activeElement?.name), 'key');
  await sheet(page).locator('.agent-choice label', { hasText: 'OpenAI' }).click();
  assert.equal(await sheet(page).locator('input[name="key"]').getAttribute('placeholder'), 'sk-proj-…');
  await sheet(page).getByRole('button', { name: 'Back' }).click();
  assert.equal(await viewOf(page), 'choose');
});

test('pages open it by event: on ChatGPT, on Claude, and the event says it was drawn', async () => {
  const { page } = await fresh();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('marble-agent-setup').shadowRoot.querySelector('dialog').open);
  const taken = await page.evaluate(() => !document.dispatchEvent(new CustomEvent('marble:connect-agent', { cancelable: true, detail: { agent: 'codex' } })));
  assert.equal(taken, true);
  await page.waitForFunction(() => document.querySelector('marble-agent-setup').shadowRoot.querySelector('[data-view="codex"]:not([hidden])'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('marble-agent-setup').shadowRoot.querySelector('dialog').open);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('marble-agent-setup-dismissed')), '1', 'the first visit\'s Escape was Not now');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('marble:connect-claude', { cancelable: true })));
  await page.waitForFunction(() => document.querySelector('marble-agent-setup').shadowRoot.querySelector('[data-view="claude"]:not([hidden])'));
  assert.equal(await sheetOpen(page), true);
});

test('the sheet holds up at phone and desk widths, in both schemes', async () => {
  await fsp.mkdir(SHOTS, { recursive: true });
  for (const colorScheme of ['light', 'dark']) {
    for (const [name, viewport, touch] of [['desk', { width: 1280, height: 860 }, false], ['phone', { width: 390, height: 844 }, true]]) {
      const { page, errors } = await fresh({ viewport, colorScheme, hasTouch: touch, isMobile: touch });
      await page.waitForTimeout(250);
      const fits = await page.evaluate(() => {
        const box = document.querySelector('marble-agent-setup').shadowRoot.querySelector('dialog').getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && box.height <= innerHeight;
      });
      assert.ok(fits, `${name} ${colorScheme}: the sheet fits the window`);
      if (touch) {
        const rows = await sheet(page).locator('.choice:visible').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        assert.ok(rows.every((h) => h >= 48), `rows a thumb can press: ${rows}`);
      }
      await page.screenshot({ path: path.join(SHOTS, `connect-choose-${name}-${colorScheme}.png`) });
      await sheet(page).locator('.choice[data-agent="codex"]').click();
      await sheet(page).locator('.code', { hasText: 'FAKE-C0DE7' }).waitFor();
      await page.screenshot({ path: path.join(SHOTS, `connect-chatgpt-${name}-${colorScheme}.png`) });
      if (touch) {
        const buttons = await sheet(page).locator('.actions button:visible').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        assert.ok(buttons.every((h) => h >= 44), `buttons a thumb can press: ${buttons}`);
      }
      await sheet(page).getByRole('button', { name: 'Back' }).click();
      await sheet(page).locator('.choice[data-agent="claude"]').click();
      await page.screenshot({ path: path.join(SHOTS, `connect-claude-${name}-${colorScheme}.png`) });
      assert.deepEqual(errors, [], `${name} ${colorScheme}`);
      await page.context().close();
    }
  }
});
