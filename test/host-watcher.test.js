// The watcher (server/host/watcher.js) and the alerts it sends
// (server/host/alerts.js): a drive that misses /health twice in a row is
// restarted and the owner told, once alone is a drive busy for a moment;
// memory and disk past 90% are alerts; and an alert is sent at most once an
// hour per drive and kind, each one that is due also an event.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createAlerts, notifier } from '../server/host/alerts.js';
import { openRegistry } from '../server/host/registry.js';
import { createWatcher } from '../server/host/watcher.js';
import { fakeUnits, quiet, scratchPc } from './fixtures/host.js';

async function rig({ drives = { ana: 4500, ben: 4501 }, memory = 200, disk = 0.5 } = {}) {
  const pc = await scratchPc();
  const registry = await openRegistry({ dir: pc.state });
  await registry.update((r) => {
    for (const [name, port] of Object.entries(drives)) r.drives[name] = { name, port, state: 'running', restarts: 0 };
  });
  const units = fakeUnits();
  units.show = async () => ({ active: 'active', memoryBytes: memory * 2 ** 20, memoryMax: 1536 * 2 ** 20 });
  const well = new Set(Object.values(drives));
  const probe = { health: async (port) => (well.has(port) ? { ok: true, working: 1, release: 'r1' } : null) };
  let t = Date.parse('2026-10-25T12:00:00Z');
  const sent = [];
  const alerts = createAlerts({ url: 'https://ntfy.test/topic', now: () => t, log: quiet, fetchImpl: async (url, init) => {
    sent.push({ url, title: init.headers.title, body: init.body });
    return new Response('ok');
  } });
  const notify = notifier({ alerts, registry });
  const watcher = createWatcher({ registry, units, probe, notify, now: () => t, statfs: () => ({ blocks: 100, bavail: 100 * (1 - disk) }), log: quiet });
  return { pc, registry, units, probe, well, watcher, sent, advance: (ms) => (t += ms) };
}

test('one missed /health is a busy drive; two in a row restart it, count it, and tell the owner', async (t) => {
  const r = await rig();
  t.after(r.pc.cleanup);
  await r.watcher.tick();
  assert.deepEqual(r.watcher.health('ana'), { ok: true, working: 1, release: 'r1', at: '2026-10-25T12:00:00.000Z' });
  r.well.delete(4500);
  await r.watcher.tick();
  assert.deepEqual(r.units.calls, [], 'not after one');
  assert.equal(r.watcher.health('ana').ok, false);
  await r.watcher.tick();
  assert.deepEqual(r.units.calls, ['restart ana'], 'after two, and only ana');
  assert.equal(r.registry.drive('ana').restarts, 1);
  assert.deepEqual((await r.registry.events()).map((e) => e.kind), ['alert', 'restarted', 'unhealthy']);
  assert.equal(r.sent.length, 1);
  assert.match(r.sent[0].body, /ana stopped answering and was restarted/);
  assert.equal(r.sent[0].title, 'marble-host: unhealthy (ana)');
  // The count starts again: one more miss is not a second restart.
  await r.watcher.tick();
  assert.deepEqual(r.units.calls, ['restart ana']);
  // Answering again clears it.
  r.well.add(4500);
  await r.watcher.tick();
  r.well.delete(4500);
  await r.watcher.tick();
  assert.deepEqual(r.units.calls, ['restart ana']);
});

test('a drive that keeps falling over is restarted each time, and the owner told once an hour', async (t) => {
  const r = await rig({ drives: { ana: 4500 } });
  t.after(r.pc.cleanup);
  r.well.clear();
  for (let i = 0; i < 6; i += 1) {
    await r.watcher.tick();
    r.advance(30_000);
  }
  assert.equal(r.units.calls.filter((c) => c === 'restart ana').length, 3);
  assert.equal(r.sent.length, 1, 'one note, not three');
  assert.equal((await r.registry.events()).filter((e) => e.kind === 'alert').length, 1, 'an alert held back is not an event either');
  r.advance(60 * 60 * 1000);
  await r.watcher.tick();
  await r.watcher.tick();
  assert.equal(r.sent.length, 2, 'an hour on, it says so again');
});

test('a restart that fails is said, and not counted', async (t) => {
  const r = await rig({ drives: { ana: 4500 } });
  t.after(r.pc.cleanup);
  r.units.restart = async () => {
    throw new Error('polkit said no');
  };
  r.well.clear();
  await r.watcher.tick();
  await r.watcher.tick();
  assert.equal(r.registry.drive('ana').restarts, 0);
  assert.match(r.sent[0].body, /restarting it failed/);
});

test('memory past 90% of the drive\'s limit and the disk past 90% are alerts', async (t) => {
  const r = await rig({ drives: { ana: 4500 }, memory: 1450, disk: 0.95 });
  t.after(r.pc.cleanup);
  await r.watcher.tick();
  const said = r.sent.map((s) => s.body);
  assert.ok(said.some((b) => /ana is using 1450 MB of its 1536 MB/.test(b)), said.join('\n'));
  assert.ok(said.some((b) => /The disk under \/var\/lib is 95% full/.test(b)), said.join('\n'));
  await r.watcher.tick();
  assert.equal(r.sent.length, 2, 'once an hour each');
});

test('a drive that is not running is not watched', async (t) => {
  const r = await rig({ drives: { ana: 4500 } });
  t.after(r.pc.cleanup);
  await r.registry.update((d) => {
    d.drives.ana.state = 'suspended';
  });
  r.well.clear();
  await r.watcher.tick();
  await r.watcher.tick();
  await r.watcher.tick();
  assert.deepEqual(r.units.calls, []);
  assert.equal(r.watcher.health('ana'), null);
});

test('alerts: without a URL nothing is sent and the hour still counts; a refused or failed send is reported, never thrown', async () => {
  let t = 0;
  const off = createAlerts({ now: () => t });
  assert.equal(off.on, false);
  assert.deepEqual(await off.send({ drive: 'ana', kind: 'disk', message: 'x' }), { due: true, sent: false });
  assert.deepEqual(await off.send({ drive: 'ana', kind: 'disk', message: 'x' }), { due: false, sent: false });
  assert.deepEqual(await off.send({ drive: 'ana', kind: 'failed', message: 'x', once: false }), { due: true, sent: false });
  assert.deepEqual(await off.send({ drive: 'ana', kind: 'failed', message: 'x', once: false }), { due: true, sent: false }, 'not held back');
  t += 60 * 60 * 1000;
  assert.equal((await off.send({ drive: 'ana', kind: 'disk', message: 'x' })).due, true);

  const errors = [];
  const refused = createAlerts({ url: 'https://ntfy.test/t', log: { error: (m) => errors.push(m) }, fetchImpl: async () => new Response('no', { status: 429 }) });
  assert.deepEqual(await refused.send({ kind: 'disk', message: 'x' }), { due: true, sent: false });
  const broken = createAlerts({ url: 'https://ntfy.test/t', log: { error: (m) => errors.push(m) }, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(await broken.send({ kind: 'disk', message: 'x' }), { due: true, sent: false });
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => !e.includes('ntfy.test/t')), 'the topic is the secret, never logged');
});
