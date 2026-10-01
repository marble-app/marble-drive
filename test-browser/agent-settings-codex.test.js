// Agents settings has a row for Codex beside Claude, and an OpenAI key field
// beside the other keys: saving one puts Codex on the key, and the page never
// gets it back.

import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({ documents: { garden: GARDEN }, providers: ['claude-subscription', 'claude-api', 'codex'] });
test.after(() => host.close());

test('Codex has its own row, and an OpenAI key saved in settings is kept and never shown', async () => {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent?.openSettings));
  await page.evaluate(() => window.marble.agent.openSettings());
  const settings = page.locator('marble-agent-settings');
  await settings.locator('h2', { hasText: 'Agent settings' }).waitFor();

  assert.equal(await settings.locator('input[name="default"][value="codex"]').count(), 1, 'Codex can be the default');
  const field = settings.locator('.key input[name="key-openai"]');
  assert.equal(await field.count(), 1);
  assert.match(await settings.locator('label:has(input[name="key-openai"])').textContent(), /OpenAI API key/);
  assert.equal(await field.getAttribute('placeholder'), 'Not set');

  await field.fill('sk-proj-from-settings');
  await settings.locator('button.save').click();
  await page.waitForFunction(() => document.querySelector('marble-agent-settings')?.getAttribute('data-open') === 'false');
  const saved = await (await fetch(`${host.base}/agent/settings`)).json();
  assert.equal(saved.keys.openai, true);
  assert.ok(!JSON.stringify(saved).includes('sk-proj-from-settings'));

  await page.evaluate(() => window.marble.agent.openSettings());
  await settings.locator('.key input[name="key-openai"]').waitFor();
  assert.equal(await settings.locator('.key input[name="key-openai"]').getAttribute('placeholder'), 'Set — paste to replace');
  assert.deepEqual(errors, []);
  await page.context().close();
});
