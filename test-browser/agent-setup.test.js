// The first visit to a drive whose Claude has no login and no key: a popup
// asks for an API key right there, checks it with Anthropic, and gets out of
// the way. "Not now" lasts the tab; a page inside another asks nothing.

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const GOOD = 'sk-ant-api03-good';
const anthropic = http.createServer((req, res) => {
  const ok = req.headers['x-api-key'] === GOOD;
  res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(ok
    ? { data: [], has_more: false, first_id: null, last_id: null }
    : { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
});
const anthropicBase = await new Promise((resolve) => {
  anthropic.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${anthropic.address().port}`));
});

const FRAMED = `<!doctype html>
<html><head><title>Framed</title></head>
<body data-marble-id="fb">
  <h1 data-marble-id="fh">A page with another inside it</h1>
  <iframe data-marble-id="ff" src="/a/garden" width="400" height="300"></iframe>
</body></html>
`;

const host = await startDrive({
  documents: { garden: GARDEN, orchard: GARDEN.replace('Research Garden', 'Orchard'), framed: FRAMED },
  providers: ['claude-subscription', 'claude-api'],
  signedOut: ['claude-subscription'],
  env: { MARBLE_DRIVE_ANTHROPIC_BASE: anthropicBase },
});
const pages = [];
test.after(async () => {
  for (const page of pages) await page.context().close().catch(() => {});
  await host.close();
  anthropic.close();
});

/** Each test starts from a drive with no key, on the Claude login. */
async function fresh() {
  await host.reset();
  await host.drive.agents.store.saveSettings({ claudeAuth: 'login', defaultProvider: 'claude-subscription' });
  await fetch(`${host.base}/agent/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: host.base },
    body: JSON.stringify({ keys: { anthropic: '' } }),
  });
  const opened = await host.newPage();
  pages.push(opened.page);
  return opened;
}

const dialogOpen = (page) => page.evaluate(() => Boolean(document.querySelector('marble-agent-setup')?.shadowRoot.querySelector('dialog')?.open));
const setup = (page) => page.locator('marble-agent-setup');

test('the first page of a visit asks for a key, with the field ready to paste into', async () => {
  const { page, errors } = await fresh();
  await page.goto(`${host.base}/a/garden`);
  await setup(page).locator('h2', { hasText: 'Connect Claude' }).waitFor();
  assert.equal(await dialogOpen(page), true);
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-setup').shadowRoot.activeElement?.name), 'key', 'focus is in the key field');
  assert.equal(await setup(page).locator('input[name="key"]').getAttribute('type'), 'password');
  assert.deepEqual(errors, []);
});

test('a wrong key is refused in place; a right one connects Claude and closes', async () => {
  const { page } = await fresh();
  await page.goto(`${host.base}/a/garden`);
  const field = setup(page).locator('input[name="key"]');
  await field.waitFor();

  await field.fill('sk-ant-api03-wrong');
  await setup(page).locator('button.save').click();
  await setup(page).locator('.status.error', { hasText: "didn't accept" }).waitFor();
  assert.equal(await dialogOpen(page), true, 'still open to try again');

  await field.fill(GOOD);
  await setup(page).locator('button.save').click();
  await setup(page).locator('.status', { hasText: 'Connected' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('marble-agent-setup').shadowRoot.querySelector('dialog').open);
  assert.equal(await field.inputValue(), '', 'the page does not keep the key');

  const settings = await (await fetch(`${host.base}/agent/settings`)).json();
  assert.equal(settings.keys.anthropic, true);
  assert.equal(settings.claudeAuth, 'api', 'Claude now runs on the key');

  // Connected, so the next visit asks nothing.
  const next = await host.newPage();
  pages.push(next.page);
  await next.page.goto(`${host.base}/a/garden`);
  await next.page.waitForFunction(() => Boolean(document.querySelector('marble-agent-setup')));
  await next.page.waitForTimeout(400);
  assert.equal(await dialogOpen(next.page), false);
});

test('Not now lasts the tab: moving to another document does not ask again, a new visit does', async () => {
  const { page } = await fresh();
  await page.goto(`${host.base}/a/garden`);
  await setup(page).locator('button.later').click();
  assert.equal(await dialogOpen(page), false);

  await page.goto(`${host.base}/a/orchard`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-setup')));
  await page.waitForTimeout(400);
  assert.equal(await dialogOpen(page), false, 'same tab, another page: not asked');

  const other = await host.newPage();
  pages.push(other.page);
  await other.page.goto(`${host.base}/a/orchard`);
  await setup(other.page).locator('h2', { hasText: 'Connect Claude' }).waitFor();
  assert.equal(await dialogOpen(other.page), true, 'a new visit asks again');
});

test('Escape is Not now', async () => {
  const { page } = await fresh();
  await page.goto(`${host.base}/a/garden`);
  await setup(page).locator('input[name="key"]').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('marble-agent-setup').shadowRoot.querySelector('dialog').open);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('marble-agent-setup-dismissed')), '1');
});

test('a page shown inside another asks nothing; only the page you opened does', async () => {
  const { page } = await fresh();
  await page.goto(`${host.base}/a/framed`);
  await setup(page).locator('h2', { hasText: 'Connect Claude' }).waitFor();
  const frame = page.frameLocator('iframe');
  await frame.locator('h1').waitFor();
  await page.waitForTimeout(400);
  assert.equal(await frame.locator('marble-agent-setup').count(), 0);
});
