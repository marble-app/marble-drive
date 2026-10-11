// The Console's side of the Mac's backups (server/console/backups.js): it reads
// the report the Mac leaves and writes requests for it, and asks for a restore
// only with the target's name typed and a snapshot the Mac says it has.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { createBackups } from '../server/console/backups.js';
import { loadConfig } from '../server/config.js';
import { fakeFleet } from './fixtures/console-fleet.js';

const quiet = { log() {}, error() {}, info() {} };
const REPORT = {
  v: 1,
  sprite: 'admin-p1',
  machine: 'The MacBook',
  to: '~/Marble Backups/admin-p1',
  heardAt: '2026-09-27T19:00:00Z',
  link: '~/Marble Drive',
  rule: { quiet: 10, most: 60 },
  schedule: 'on',
  last: { at: '2026-09-27T18:50:00Z', ok: true, snapshot: '2026-09-27T185000Z', why: 'quiet after changes', error: null },
  copy: { name: '2026-09-27T185000Z', path: '~/Marble Backups/2026-09-27T185000Z', checkpoint: 'v42', documents: 96, files: 6500, added: 224_000, took: 11, why: 'quiet after changes', syncedAt: '2026-09-27T18:50:11Z' },
  changes: { waiting: false, since: null, next: null },
  disk: { used: 2_200_000_000, free: 180_000_000_000 },
  results: [],
};

async function withReport(dir) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'admin-p1.json'), JSON.stringify(REPORT));
}

test('requests: validated, one of a kind at a time, withdrawable', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-backups-'));
  const b = createBackups({ dir });
  assert.deepEqual(await b.list(), []);
  await assert.rejects(b.request('admin-p1', { kind: 'backup' }), /no Mac backs up admin-p1/);
  await withReport(dir);

  const req = await b.request('admin-p1', { kind: 'backup' });
  assert.equal(req.kind, 'backup');
  await assert.rejects(b.request('admin-p1', { kind: 'backup' }), /already asked/);
  const [one] = await b.list();
  assert.equal(one.machine, 'The MacBook');
  assert.deepEqual(one.pending.map((q) => q.id), [req.id]);
  const file = await fsp.readFile(path.join(dir, 'requests', `${req.id}.json`), 'utf8');
  assert.equal(file.trim().split('\n').length, 1, 'one JSON line, as the Mac reads it');

  await b.withdraw(req.id);
  assert.deepEqual((await b.list())[0].pending, []);

  await assert.rejects(b.request('admin-p1', { kind: 'schedule' }), /on or off/);
  assert.equal((await b.request('admin-p1', { kind: 'schedule', on: false })).on, false);
  await assert.rejects(b.request('admin-p1', { kind: 'nuke' }), /back up, schedule, restore or checkpoint/);
  await assert.rejects(b.request('../x', { kind: 'backup' }), /not a drive name/);
});

test('a restore needs the copy the Mac has, or a checkpoint, and the name typed', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-backups-'));
  await withReport(dir);
  const b = createBackups({ dir });
  await assert.rejects(b.request('admin-p1', { kind: 'restore', snapshot: '2026-01-01T000000Z', target: 'admin-p1', confirm: 'admin-p1' }), /copy is 2026-09-27T185000Z/);
  await assert.rejects(b.request('admin-p1', { kind: 'restore', snapshot: '2026-09-27T185000Z', target: 'admin-p1', confirm: 'admin' }), /type admin-p1/);
  const req = await b.request('admin-p1', { kind: 'restore', snapshot: '2026-09-27T185000Z', target: 'admin-p1', confirm: 'admin-p1' });
  assert.deepEqual([req.kind, req.snapshot, req.target], ['restore', '2026-09-27T185000Z', 'admin-p1']);
  await assert.rejects(b.request('admin-p1', { kind: 'checkpoint', checkpoint: 'v40', confirm: 'admin-p1' }), /already asked/, 'one restore at a time');
  await b.withdraw(req.id);
  await assert.rejects(b.request('admin-p1', { kind: 'checkpoint', checkpoint: '../v40', confirm: 'admin-p1' }), /not a checkpoint/);
  await assert.rejects(b.request('admin-p1', { kind: 'checkpoint', checkpoint: 'v40', confirm: 'admin' }), /type admin-p1/);
  const cp = await b.request('admin-p1', { kind: 'checkpoint', checkpoint: 'v40', confirm: 'admin-p1' });
  assert.deepEqual([cp.kind, cp.checkpoint, cp.target], ['checkpoint', 'v40', 'admin-p1']);
});

test('the routes: state carries backups, a request is a 202, only from the page', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-host-'));
  const fleet = await fakeFleet({});
  const config = loadConfig({
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_CONSOLE: '1',
    MARBLE_DRIVE_SECRET: 'pw-1234',
    MARBLE_DRIVE_CONSOLE_SPRITE: fleet.bin,
    MARBLE_DRIVE_CONSOLE_SRC: path.join(root, '..', `${path.basename(root)}-src`),
    MARBLE_DRIVE_CONSOLE_SELF: 'admin-p1',
  });
  await withReport(path.join(root, '.marble', 'console', 'backups'));
  const drive = await createDrive(config, { log: quiet, agents: false });
  t.after(() => drive.close());
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const gate = await fetch(`${base}/gate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'pw-1234' }) });
  const cookie = (gate.headers.get('set-cookie') ?? '').split(';')[0];
  const call = (route, { method = 'GET', body, origin = base } = {}) => fetch(`${base}${route}`, {
    method,
    headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  const state = await (await call('/console/api/state')).json();
  assert.equal(state.backups[0].sprite, 'admin-p1');
  assert.equal((await call('/console/api/backups/admin-p1/request', { method: 'POST', body: { kind: 'backup' }, origin: 'https://evil.example' })).status, 403);
  const res = await call('/console/api/backups/admin-p1/request', { method: 'POST', body: { kind: 'backup' } });
  assert.equal(res.status, 202);
  const req = await res.json();
  assert.equal((await call('/console/api/backups/admin-p1/request', { method: 'POST', body: { kind: 'backup' } })).status, 409);
  const listed = await (await call('/console/api/backups')).json();
  assert.deepEqual(listed.backups[0].pending.map((q) => q.id), [req.id]);
  assert.equal((await call('/console/api/backups/admin-p1/withdraw', { method: 'POST', body: { id: req.id } })).status, 200);
  assert.equal((await (await call('/console/api/backups')).json()).backups[0].pending.length, 0);
  assert.equal((await call('/console/api/backups/admin-p1/request', { method: 'POST', body: { kind: 'restore', snapshot: '2026-09-27T185000Z', target: 'admin-p1', confirm: 'no' } })).status, 400);
});
