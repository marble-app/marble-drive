import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const FORKED = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fork</title>
<style>body { font: 16px/1.5 Georgia, serif; margin: 40px; } h1 { font-size: 32px; }</style>
</head>
<body data-marble-id="b">
  <marble-alt data-marble-id="h" data-marble-active="you">
    <h1 data-marble-id="hy" data-marble-alt="you" data-marble-by="person">Yours</h1>
    <h1 data-marble-id="ha" data-marble-alt="agent:c1" data-marble-by="agent">Theirs</h1>
  </marble-alt>
  <p data-marble-id="p">A paragraph the fork does not own.</p>
</body></html>
`;

const host = await startDrive({
  agents: true,
  documents: { forked: FORKED },
});
test.after(() => host.close());

test('a fork shows Drive verbs on the component and hides generic chips', async () => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  const bar = page.locator('marble-alt > .marble-fork');
  await bar.waitFor();

  assert.equal(await page.locator('.marble-alts').count(), 0, 'Drive chrome replaces generic chips');
  assert.equal(await page.locator('h1:visible').textContent(), 'Yours');

  await bar.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('h1.marble-alt-shown')?.textContent === 'Theirs');
  assert.equal(await page.locator('h1.marble-alt-shown').textContent(), 'Theirs');

  await bar.getByRole('button', { name: 'Approve' }).click();
  const deadline = Date.now() + 8000;
  let stored = await host.drive.store.read('forked');
  while (Date.now() < deadline && stored.includes('<marble-alt')) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    stored = await host.drive.store.read('forked');
  }

  assert.match(stored, />Theirs</);
  assert.doesNotMatch(stored, /<marble-alt/);
  assert.doesNotMatch(stored, /Yours/);
  assert.match(stored, /A paragraph the fork does not own/);
  assert.deepEqual(errors.filter((message) => !/favicon/.test(message)), []);
});

test('a remote op flashes the component it changed', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:ops', {
      detail: { ops: [{ type: 'setText', id: 'p', text: 'A paragraph the fork does not own.' }] },
    }));
  });
  assert.equal(await page.locator('[data-marble-id="p"]').evaluate((el) => el.classList.contains('marble-flash')), true);
});

test('presence outlines the id another writer is on', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: { client: 'agent:c1', ids: ['p'] },
    }));
  });
  assert.equal(await page.locator('[data-marble-id="p"]').evaluate((el) => el.classList.contains('marble-presence')), true);
});
