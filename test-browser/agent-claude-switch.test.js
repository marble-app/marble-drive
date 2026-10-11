// Agents settings shows one Claude with a switch: Claude login or API key. The
// key field is there only while "API key" is on, and saving the switch makes
// the next conversation run on that sign-in.

import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({ documents: { garden: GARDEN }, providers: ['claude-subscription', 'claude-api'] });
test.after(() => host.close());

test('one Claude in settings, a login/API switch, and the key field only for API', async () => {
  await host.drive.agents.store.saveSettings({ defaultProvider: 'claude-subscription' });
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent?.openSettings));
  await page.evaluate(() => window.marble.agent.openSettings());
  const settings = page.locator('marble-agent-settings');
  await settings.locator('h2', { hasText: 'Agent settings' }).waitFor();

  const claudeRows = settings.locator('.agent', { has: page.locator('input[name="claude-auth"]') });
  assert.equal(await claudeRows.count(), 1, 'one Claude row');
  assert.equal(await settings.locator('input[name="default"][value="claude-api"]').count(), 0, 'no second Claude to pick');
  const key = settings.locator('.claude-key');
  assert.equal(await key.isHidden(), true, 'no key field while signed in with the login');
  assert.equal(await settings.locator('.key input[name="key-anthropic"]').count(), 1);

  await settings.locator('.claude-auth label', { hasText: 'API key' }).click();
  assert.equal(await key.isVisible(), true, 'key field appears for API key');
  await settings.locator('button.save').click();
  await page.waitForFunction(() => document.querySelector('marble-agent-settings')?.getAttribute('data-open') === 'false');

  assert.equal((await host.drive.agents.store.settings()).claudeAuth, 'api');
  const started = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'claude-subscription' });
    return (await (await fetch('/agent/conversations')).json()).find((c) => c.id === id)?.provider;
  });
  assert.equal(started, 'claude-api', 'the next conversation runs on the API key');
  await page.context().close();
});
