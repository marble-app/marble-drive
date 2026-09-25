// The console's routes on a real host: absent unless the console is on and the
// drive has a passphrase; behind the gate; a changing request only from the
// page's own origin; the Console document gets its code, no other does.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { seedConsole } from '../server/seed.js';
import { fakeFleet, probe } from './fixtures/console-fleet.js';

const quiet = { log() {}, error() {}, info() {} };

async function host(env = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-host-'));
  const fleet = await fakeFleet({ probe: { 't-sam': probe('t-sam') } });
  const config = loadConfig({
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_CONSOLE_SPRITE: fleet.bin,
    MARBLE_DRIVE_CONSOLE_SRC: path.join(root, '..', `${path.basename(root)}-src`),
    MARBLE_DRIVE_CONSOLE_SELF: 'admin-p1',
    ...env,
  });
  const drive = await createDrive(config, { log: quiet, agents: false });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  if (config.secret) {
    const res = await fetch(`${base}/gate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: config.secret }) });
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  }
  const call = (route, { method = 'GET', body, origin = base } = {}) => fetch(`${base}${route}`, {
    method,
    headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { drive, base, call, fleet, close: () => drive.close() };
}

test('without the setting, or without a passphrase, there is no console', async () => {
  const off = await host({ MARBLE_DRIVE_SECRET: 'pw-1234' });
  assert.equal((await off.call('/console/api/state')).status, 404);
  await off.close();
  const open = await host({ MARBLE_DRIVE_CONSOLE: '1' });
  assert.equal(open.drive.console, null);
  assert.equal((await open.call('/console/api/state')).status, 404);
  await open.close();
});

test('the console answers the signed-in page, and only its own origin may change anything', async (t) => {
  const h = await host({ MARBLE_DRIVE_CONSOLE: '1', MARBLE_DRIVE_SECRET: 'pw-1234' });
  t.after(() => h.close());
  const state = await (await h.call('/console/api/state')).json();
  assert.deepEqual(state.fleet.map((d) => d.name), ['admin-p1', 't-bryan', 't-irene', 't-peiling', 't-sam', 't-sangho']);
  assert.equal(state.self, 'admin-p1');
  assert.equal(state.fleet[0].role, 'owner');
  assert.equal(state.fleet[0].self, true);
  assert.equal(state.fleet[4].awake, true);
  assert.ok(!JSON.stringify(state).includes('pass-'), 'no passphrase in the state');

  const stranger = await fetch(`${h.base}/console/api/state`);
  assert.equal(stranger.status, 401, 'behind the gate');
  assert.equal((await h.call('/console/api/drives/t-sam/look', { method: 'POST', origin: 'https://evil.example' })).status, 403);
  assert.equal((await h.call('/console/api/drives/t-sam/look', { method: 'POST', origin: null })).status, 403);

  const seen = await (await h.call('/console/api/drives/t-sam/look', { method: 'POST' })).json();
  assert.equal(seen.release, '20260924T053531Z-0dd39ac');
  assert.deepEqual(seen.env.find((e) => e.key === 'MARBLE_DRIVE_SECRET'), { key: 'MARBLE_DRIVE_SECRET', secret: true });
  const revealed = await (await h.call('/console/api/drives/t-sam/reveal', { method: 'POST' })).json();
  assert.equal(revealed.passphrase, 'pass-t-sam');
  assert.equal((await h.call('/console/api/drives/nobody/look', { method: 'POST' })).status, 404);
  assert.equal((await h.call('/console/api/drives/..%2Fetc/look', { method: 'POST' })).status, 400);
});

test('the live stream sends the fleet as soon as a page is watching', async (t) => {
  const h = await host({ MARBLE_DRIVE_CONSOLE: '1', MARBLE_DRIVE_SECRET: 'pw-1234' });
  t.after(() => h.close());
  const res = await h.call('/console/api/events', { origin: null });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  let seen = '';
  const end = Date.now() + 5_000;
  while (!seen.includes('event: fleet') && Date.now() < end) seen += new TextDecoder().decode((await reader.read()).value ?? new Uint8Array());
  assert.match(seen, /event: fleet/);
  await reader.cancel();
});

test('the Console document gets the console\'s code; no other document does', async (t) => {
  const h = await host({ MARBLE_DRIVE_CONSOLE: '1', MARBLE_DRIVE_SECRET: 'pw-1234' });
  t.after(() => h.close());
  await seedConsole(h.drive.store);
  const page = await (await h.call('/a/Console')).text();
  assert.match(page, /\/runtime\/console\.js/);
  assert.match(page, /\/runtime\/console\.css/);
  await h.drive.createDocument('plain', '<!doctype html><html><body data-marble-id="b"><p data-marble-id="p">x</p></body></html>', { label: 't' });
  assert.doesNotMatch(await (await h.call('/a/plain')).text(), /console\.js/);
  const css = await h.call('/runtime/console.css');
  assert.match(css.headers.get('content-type'), /text\/css/);
});

test('a drive nobody has looked inside still says what it runs, from its last deploy’s checkpoint', async (t) => {
  const h = await host({ MARBLE_DRIVE_CONSOLE: '1', MARBLE_DRIVE_SECRET: 'pw-1234' });
  t.after(() => h.close());
  await h.fleet.set({ checkpoints: { 't-irene': [
    { id: 'v4', create_time: '2026-09-24T05:36:00Z', comment: 'before deploy 20260924T053600Z-0dd39ac' },
    { id: 'v3', create_time: '2026-09-23T05:00:00Z', comment: 'from the console' },
  ] } });
  const state = await (await h.call('/console/api/state')).json();
  const irene = state.fleet.find((d) => d.name === 't-irene');
  assert.equal(irene.release, '20260924T053600Z-0dd39ac');
  assert.equal(irene.releaseFrom, 'checkpoint');
  assert.equal(irene.seen, null);
  assert.ok(!(await h.fleet.calls()).some((c) => c[0] === 'exec' && c.includes('t-irene')), 'nothing woke it');
});

test('a deploy the console finished is known exactly, and outranks an older checkpoint', async (t) => {
  const h = await host({ MARBLE_DRIVE_CONSOLE: '1', MARBLE_DRIVE_SECRET: 'pw-1234' });
  t.after(() => h.close());
  await h.fleet.set({ checkpoints: { 't-sam': [{ id: 'v2', create_time: '2026-09-20T05:00:00Z', comment: 'before deploy 20260920T050000Z-c949a34' }] } });
  const jobs = h.drive.console.jobs;
  const job = jobs.start({ kind: 'deploy', title: 'Deploy main to t-sam', target: 't-sam', run: async () => ({ sha: '0dd39ac1234567', name: 't-sam' }) });
  for (let i = 0; i < 50 && jobs.get(job.id).state === 'running'; i += 1) await new Promise((r) => setTimeout(r, 20));
  const sam = (await (await h.call('/console/api/state')).json()).fleet.find((d) => d.name === 't-sam');
  assert.equal(sam.releaseFrom, 'console');
  assert.match(sam.release, /0dd39ac1234567$/);
});

test('a cold drive is never asked about its checkpoints: that would start it', async (t) => {
  const h = await host({ MARBLE_DRIVE_CONSOLE: '1', MARBLE_DRIVE_SECRET: 'pw-1234' });
  t.after(() => h.close());
  const sprites = h.fleet.state.sprites.map((s) => (s.name === 't-peiling' ? { ...s, status: 'cold' } : s));
  await h.fleet.set({ sprites });
  await (await h.call('/console/api/state')).json();
  await (await h.call('/console/api/state')).json();
  const asked = (await h.fleet.calls()).filter((c) => c[0] === 'api' && c.at(-1).endsWith('/checkpoints')).map((c) => c.at(-1).split('/')[3]);
  assert.ok(!asked.includes('t-peiling'), 'the cold drive was left alone');
  assert.equal(asked.filter((n) => n === 't-irene').length, 1, 'a warm one is asked once, not on every read');
});

test('the dashboard\'s data: ledgers pulled from awake drives only, a live usage event, bills and a budget', async (t) => {
  const h = await host({ MARBLE_DRIVE_CONSOLE: '1', MARBLE_DRIVE_SECRET: 'pw-1234' });
  t.after(() => h.close());
  const now = Math.floor(Date.now() / 1000);
  const lines = Array.from({ length: 30 }, (_, i) => ({ t: now - 3600 + i * 60, dt: 60, cpu: 2, mem: 2, disk: 3, why: { tabs: 1, looking: 1 } }));
  await h.fleet.set({ ledger: { 't-sam': lines, 't-irene': lines } });
  const res = await h.call('/console/api/events', { origin: null });
  const reader = res.body.getReader();
  let seen = '';
  const end = Date.now() + 8_000;
  while (!seen.includes('event: usage') && Date.now() < end) seen += new TextDecoder().decode((await reader.read()).value ?? new Uint8Array());
  await reader.cancel();
  assert.match(seen, /event: usage\ndata: \{"sprite":"t-sam","lines":30/);
  const execs = (await h.fleet.calls()).filter((c) => c[0] === 'exec' && c.some((a) => a.endsWith('ledger-read.mjs')));
  assert.ok(execs.length >= 1);
  assert.ok(execs.every((c) => c.includes('t-sam')), 't-irene is asleep: never read');

  const data = await (await h.call('/console/api/usage?range=24h')).json();
  assert.equal(data.range, '24h');
  const sam = data.sprites.find((s) => s.name === 't-sam');
  assert.ok(Math.abs(sam.totals.awakeHours - sam.totals.estimatedHours - 0.5) < 1e-9, 'its ledger, plus the minutes since it woke that no line covers yet');
  assert.equal(data.sprites.find((s) => s.name === 't-irene').hasLedger, false);

  assert.equal((await h.call('/console/api/bill', { method: 'POST', body: { text: 'what $1' } })).status, 400);
  const bill = await h.call('/console/api/bill', { method: 'POST', body: { text: 'From: 09/19/2026\nTo: 09/25/2026\nTotal Spend $6.75\nSprites: RAM $6.05\nSprites: CPU $0.58\nSprites: Hot Storage $0.11' } });
  assert.equal(bill.status, 200);
  assert.deepEqual(await (await h.call('/console/api/budget', { method: 'PUT', body: { monthly: 30 } })).json(), { monthly: 30 });
  assert.equal((await h.call('/console/api/budget', { method: 'PUT', body: { monthly: 30 }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await (await h.call('/console/api/usage?range=month')).json()).budget, 30);
});
