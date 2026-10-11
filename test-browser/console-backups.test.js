// The Console's Backups view, from a report as the Mac leaves it: it says how
// the backups are doing and whether changes are waiting, its buttons leave
// requests for the Mac (and can take them back), the Mac's one copy and Fly's
// checkpoints can each be restored with the name typed, a new report arrives
// by itself, and a failed backup marks the tab.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { consoleWorld } from './console-world.js';

const world = await consoleWorld({ fleet: { checkpoints: {
  'admin-p1': [
    { id: 'v43', create_time: new Date(Date.now() - 5 * 60_000).toISOString(), comment: 'backup 2026-09-28T040000Z' },
    { id: 'v42', create_time: new Date(Date.now() - 3 * 3600_000).toISOString(), comment: 'before deploy 20260927T191201Z-e3605ba' },
  ],
  't-sangho': [{ id: 'v6', create_time: '2026-09-24T05:36:33Z', comment: 'before deploy 20260924T053633Z-0dd39ac' }],
} } });
test.after(() => world.host.close());
const dir = path.join(world.host.drive.store.marbleDir, 'console', 'backups');

const name = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace(/[:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const COPY = name(5 * 60_000);
const report = (over = {}) => ({
  v: 2,
  sprite: 'admin-p1',
  machine: 'Test MacBook',
  to: '~/Marble Backups',
  link: '~/Marble Drive',
  heardAt: new Date().toISOString(),
  rule: { quiet: 10, most: 60 },
  schedule: 'on',
  last: { at: new Date(Date.now() - 5 * 60_000).toISOString(), ok: true, snapshot: COPY, why: 'quiet after changes', error: null },
  copy: { name: COPY, path: `~/Marble Backups/${COPY}`, checkpoint: 'v43', checkpointError: null, documents: 96, files: 6500, added: 224_000, took: 11, why: 'quiet after changes' },
  changes: { waiting: true, since: new Date(Date.now() - 2 * 60_000).toISOString(), next: new Date(Date.now() + 8 * 60_000).toISOString() },
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
const view = '.cx-view[data-view="backups"]';

test('it says how the backups are doing, and Back up now leaves a request that can be withdrawn', async () => {
  await leave(report());
  const { page, errors } = await world.open({ view: 'backups' });
  await page.waitForSelector(`${view} .card h2:text("History on Fly")`);
  await page.waitForSelector(`${view} li:has-text("v43")`);
  const text = await page.textContent(view);
  assert.match(text, /backed up to Test MacBook/);
  assert.match(text, /after changes went quiet/);
  assert.match(text, /Changes since .*Backed up about/);
  assert.match(text, /~\/Marble Drive → ~\/Marble Backups\//);
  assert.match(text, /96 documents/);
  assert.match(text, /matches Fly checkpoint v43/);
  assert.match(text, /Backup · the copy on the Mac/);
  assert.match(text, /before deploy 20260927T191201Z-e3605ba/);

  await page.click(`${view} button:text("Back up now")`);
  await page.waitForSelector(`${view} button:text("Asked…")`);
  const [req] = await requests();
  assert.equal(req.kind, 'backup');
  await page.click(`${view} button:text("Withdraw")`);
  await page.waitForSelector(`${view} button:text("Back up now")`);
  assert.deepEqual(await requests(), []);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the copy is restored onto a drive with its name typed', async () => {
  await leave(report());
  const { page } = await world.open({ view: 'backups' });
  await page.click(`${view} .card:has(h2:text("On the Mac")) button:text("Restore…")`);
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
  assert.deepEqual([req.kind, req.snapshot, req.target], ['restore', COPY, 't-bryan']);
  await fsp.rm(path.join(dir, 'requests'), { recursive: true, force: true });
  await page.close();
});

test('a Fly checkpoint is restored by the Mac, with the drive’s name typed', async () => {
  await leave(report());
  const { page } = await world.open({ view: 'backups' });
  await page.waitForSelector(`${view} li:has-text("v42") button`);
  await page.click(`${view} li:has-text("v42") button:text("Restore…")`);
  assert.match(await page.textContent('.pop:popover-open'), /its drive, its code and its settings/);
  await page.fill('.pop:popover-open input', 'admin-p1');
  await page.click('.pop:popover-open .btn.danger');
  for (let i = 0; i < 50 && !(await requests()).length; i += 1) await page.waitForTimeout(100);
  const [req] = await requests();
  assert.deepEqual([req.kind, req.checkpoint, req.target], ['checkpoint', 'v42', 'admin-p1']);
  await fsp.rm(path.join(dir, 'requests'), { recursive: true, force: true });
  await page.close();
});

test('a new report arrives by itself, and a failed backup marks the tab', async () => {
  await leave(report({ changes: { waiting: false, since: null, next: null } }));
  const { page, errors } = await world.open({ view: 'dashboard' });
  assert.equal(await page.$('.cx-bar .seg [data-view="backups"] .mark'), null);
  await leave(report({ last: { at: new Date().toISOString(), ok: false, snapshot: null, why: 'quiet after changes', error: 'rsync exit 12' } }));
  await page.waitForSelector('.cx-bar .seg [data-view="backups"] .mark.warn', { timeout: 15_000 });
  await page.click('.cx-bar .seg [data-view="backups"]');
  await page.waitForSelector(`${view} p.bad`);
  assert.match(await page.textContent(`${view} p.bad`), /rsync exit 12/);
  assert.deepEqual(errors, []);
  await page.close();
});
