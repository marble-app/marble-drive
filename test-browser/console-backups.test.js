// The Console's Backups view, from a report as the Mac leaves it: it says how
// the backups are doing, its buttons leave requests for the Mac (and can take
// them back), a restore asks for the target's name, a new report arrives by
// itself, and a failed backup marks the tab.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { consoleWorld } from './console-world.js';

const world = await consoleWorld();
test.after(() => world.host.close());
const dir = path.join(world.host.drive.store.marbleDir, 'console', 'backups');

const name = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace(/[:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const snaps = [0, 15, 30, 45].map((m) => ({ name: name(m * 60_000 + 60_000), documents: 96, files: 6500, added: 224_000, took: 11, why: 'running' }))
  .concat([{ name: name(3 * 86_400_000), documents: 90, files: 6400, added: 2_200_000_000, took: 82, why: 'asked' }]);
const report = (over = {}) => ({
  v: 1,
  sprite: 'admin-p1',
  machine: 'Test MacBook',
  to: '~/Marble Backups/admin-p1',
  heardAt: new Date().toISOString(),
  every: 15,
  schedule: 'on',
  last: { at: new Date(Date.now() - 60_000).toISOString(), ok: true, snapshot: snaps[0].name, why: 'running', error: null },
  snapshots: snaps,
  disk: { used: 2_300_000_000, free: 180_000_000_000 },
  results: [],
  ...over,
});
async function leave(r) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'admin-p1.json'), JSON.stringify(r));
}
const requests = async () => {
  const names = await fsp.readdir(path.join(dir, 'requests')).catch(() => []);
  return Promise.all(names.filter((n) => n.endsWith('.json')).map(async (n) => JSON.parse(await fsp.readFile(path.join(dir, 'requests', n), 'utf8'))));
};

test('it says how the backups are doing, and Back up now leaves a request that can be withdrawn', async () => {
  await leave(report());
  const { page, errors } = await world.open({ view: 'backups' });
  await page.waitForSelector('.cx-view[data-view="backups"] .card h2:text("admin-p1")');
  const text = await page.textContent('.cx-view[data-view="backups"]');
  assert.match(text, /backed up to Test MacBook/);
  assert.match(text, /5 kept/);
  assert.match(text, /2\.3 GB on the Mac, 180 GB free/);
  assert.deepEqual(await page.$$eval('.snap-group', (els) => els.map((e) => e.textContent)).then((g) => g[0]), 'Today');
  assert.match(text, /96 documents · \+224 KB · while awake/);

  await page.click('.cx-view[data-view="backups"] button:text("Back up now")');
  await page.waitForSelector('.cx-view[data-view="backups"] button:text("Asked…")');
  const [req] = await requests();
  assert.equal(req.kind, 'backup');
  assert.match(await page.textContent('.cx-view[data-view="backups"] .commits'), /waiting\s*Back up now/);
  await page.click('.cx-view[data-view="backups"] button:text("Withdraw")');
  await page.waitForSelector('.cx-view[data-view="backups"] button:text("Back up now")');
  assert.deepEqual(await requests(), []);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a restore asks for the target and its name typed, then leaves the request', async () => {
  await leave(report());
  const { page } = await world.open({ view: 'backups' });
  await page.click('.cx-view[data-view="backups"] .commits button:text("Restore…")');
  const go = page.locator('.pop:popover-open .btn.danger');
  assert.equal(await go.isDisabled(), true);
  assert.match(await page.textContent('.pop:popover-open'), /this page goes away/);
  await page.selectOption('.pop:popover-open select', 't-bryan');
  assert.doesNotMatch(await page.textContent('.pop:popover-open'), /this page goes away/);
  await page.fill('.pop:popover-open input', 'admin-p1');
  assert.equal(await go.isDisabled(), true, 'the name typed is the target’s');
  await page.fill('.pop:popover-open input', 't-bryan');
  await go.click();
  for (let i = 0; i < 50 && !(await requests()).length; i += 1) await page.waitForTimeout(100);
  const [req] = await requests();
  assert.deepEqual([req.kind, req.snapshot, req.target], ['restore', snaps[0].name, 't-bryan']);
  await fsp.rm(path.join(dir, 'requests'), { recursive: true, force: true });
  await page.close();
});

test('a new report arrives by itself, and a failed backup marks the tab', async () => {
  await leave(report());
  const { page, errors } = await world.open({ view: 'dashboard' });
  assert.equal(await page.$('.cx-bar .seg [data-view="backups"] .mark'), null);
  await leave(report({
    last: { at: new Date().toISOString(), ok: false, snapshot: null, why: null, error: 'rsync exit 12' },
    results: [{ id: 'x', kind: 'backup', state: 'done', at: new Date().toISOString(), note: 'Snapshot 2026' }],
  }));
  await page.waitForSelector('.cx-bar .seg [data-view="backups"] .mark.warn', { timeout: 15_000 });
  await page.click('.cx-bar .seg [data-view="backups"]');
  await page.waitForSelector('.cx-view[data-view="backups"] p.bad');
  assert.match(await page.textContent('.cx-view[data-view="backups"] p.bad'), /rsync exit 12/);
  assert.deepEqual(errors, []);
  await page.close();
});
