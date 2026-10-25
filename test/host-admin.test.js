// marble-host's admin API (server/host/admin.js): nothing without the admin
// token; every drive with its live state; make, restart, suspend, resume,
// remove and channel; the releases; the events; and the updater's four
// routes answering 501, since moving drives between releases is the owner's
// to write.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createAdmin, NOT_BUILT } from '../server/host/admin.js';
import { createGuestEnvs } from '../server/host/guest-env.js';
import { createMaker } from '../server/host/maker.js';
import { openRegistry } from '../server/host/registry.js';
import { fakeUnits, quiet, scratchPc } from './fixtures/host.js';

const TOKEN = 'admin-token-for-tests';
const NEWEST = '20261025T161133Z-4b2103a';

async function rig() {
  const pc = await scratchPc({ releases: ['20261024T234240Z-3f2d234', NEWEST] });
  const registry = await openRegistry({ dir: pc.state });
  const units = fakeUnits();
  const envs = createGuestEnvs({ dir: pc.guestEnvDir });
  const well = { on: true };
  const releaseOf = (port) => registry.drives().find((d) => d.port === port)?.release ?? null;
  const probe = {
    health: async (port) => (well.on ? { ok: true, working: 0, release: releaseOf(port) } : null),
    page: async () => (well.on ? 302 : null),
    deep: async (port) => (well.on ? { ok: true, claude: { version: '2.1.281' }, codex: { version: '0.159.3' }, release: releaseOf(port) } : null),
  };
  const maker = createMaker({ settings: pc.settings, registry, units, envs, probe, log: quiet, inUse: async () => false, checkMs: 50 });
  const watched = new Map();
  const watcher = { health: (name) => watched.get(name) ?? null };
  const admin = createAdmin({ token: TOKEN, settings: pc.settings, registry, units, maker, watcher, envs, probe, log: quiet, now: () => '2026-10-25T12:00:00.000Z' });
  const port = await admin.listen(0);
  const call = async (method, route, body, { token = TOKEN } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return { pc, registry, units, envs, well, watched, call, cleanup: async () => { await admin.close(); await pc.cleanup(); } };
}

test('nothing without the admin token', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  for (const [method, route] of [['GET', '/drives'], ['POST', '/drives'], ['GET', '/releases'], ['POST', '/release'], ['GET', '/events'], ['POST', '/drives/ana/remove']]) {
    for (const token of [null, 'wrong', `${TOKEN}x`]) {
      const res = await r.call(method, route, method === 'POST' ? { name: 'ana', owner: 'acct_1', confirm: 'ana' } : undefined, { token });
      assert.equal(res.status, 401, `${method} ${route} with ${token}`);
      assert.deepEqual(res.body, { why: 'unauthorised' });
    }
  }
  assert.deepEqual(r.registry.drives(), [], 'nothing was made');
});

test('the updater\'s four routes answer 501 until the owner writes it', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  for (const route of ['/release', '/promote', '/rollback', '/pause']) {
    const res = await r.call('POST', route, route === '/pause' ? { on: true } : {});
    assert.equal(res.status, 501, route);
    assert.deepEqual(res.body, { why: "the updater isn't built yet" });
  }
  assert.deepEqual(NOT_BUILT, { why: "the updater isn't built yet" });
  assert.equal(r.registry.paused(), false, 'pause changed nothing');
});

test('make one: 201 with the drive, refusals with their status and why', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  const made = await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1', cohort: 'study' });
  assert.equal(made.status, 201, made.body.why);
  assert.equal(made.body.drive.name, 'ana');
  assert.equal(made.body.drive.state, 'running');
  assert.equal(made.body.drive.release, NEWEST);
  assert.equal(made.body.drive.cohort, 'study');
  assert.equal((await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' })).status, 409);
  assert.equal((await r.call('POST', '/drives', { name: 'A', owner: 'acct_1' })).status, 400);
  assert.equal((await r.call('POST', '/drives', '{not json')).status, 400);
  assert.equal((await r.call('POST', '/drives', '[1]')).status, 400);
  r.well.on = false;
  const failed = await r.call('POST', '/drives', { name: 'ben', owner: 'acct_2' });
  assert.equal(failed.status, 500);
  assert.match(failed.body.why, /did not answer \/health \(at check\)/);
});

test('GET /drives: each drive with its service, memory and last health', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' });
  const { status, body } = await r.call('GET', '/drives');
  assert.equal(status, 200);
  const [ana] = body.drives;
  assert.deepEqual(Object.keys(ana).sort(), ['active', 'channel', 'cohort', 'created', 'health', 'memoryBytes', 'name', 'owner', 'port', 'release', 'restarts', 'state'].sort());
  assert.equal(ana.active, 'active');
  assert.equal(ana.memoryBytes, 200 * 2 ** 20);
  assert.deepEqual(ana.health, { ok: true, working: 0, release: NEWEST, at: '2026-10-25T12:00:00.000Z' }, 'asked now when the watcher has not looked yet');
  r.watched.set('ana', { ok: false, working: null, release: null, at: '2026-10-25T11:59:30.000Z' });
  assert.equal((await r.call('GET', '/drives')).body.drives[0].health.at, '2026-10-25T11:59:30.000Z', 'the watcher\'s reading when it has one');
});

test('restart, suspend and resume', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' });
  r.units.calls.length = 0;
  const restarted = await r.call('POST', '/drives/ana/restart');
  assert.equal(restarted.status, 200);
  assert.equal(restarted.body.drive.restarts, 1);
  const suspended = await r.call('POST', '/drives/ana/suspend');
  assert.equal(suspended.body.drive.state, 'suspended');
  assert.equal(suspended.body.drive.active, 'inactive');
  assert.equal((await r.call('POST', '/drives/ana/restart')).status, 409, 'resume it instead');
  assert.equal((await r.call('POST', '/drives/ana/suspend')).status, 200, 'again is fine');
  const resumed = await r.call('POST', '/drives/ana/resume');
  assert.equal(resumed.body.drive.state, 'running');
  assert.deepEqual(r.units.calls, ['restart ana', 'stop ana', 'start ana']);
  assert.deepEqual((await r.registry.events()).map((e) => e.kind), ['resumed', 'suspended', 'restarted', 'made']);
  assert.equal((await r.call('POST', '/drives/nobody/restart')).status, 404);
  assert.equal((await r.call('POST', '/drives/..%2F..%2Fetc/restart')).status, 404);
});

test('restart a drive whose making failed tries the rest again', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  r.well.on = false;
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' });
  assert.equal(r.registry.drive('ana').state, 'failed');
  r.well.on = true;
  const again = await r.call('POST', '/drives/ana/restart');
  assert.equal(again.status, 200, again.body.why);
  assert.equal(again.body.drive.state, 'running');
});

test('remove: only with the drive\'s name typed; the service stops, the settings go, the folder stays', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' });
  const folder = path.join(r.pc.guestStateDir, 'ana');
  await fsp.mkdir(path.join(folder, 'drive'), { recursive: true });
  await fsp.writeFile(path.join(folder, 'drive', 'Notes.mrbl'), 'hers');
  assert.equal((await r.call('POST', '/drives/ana/remove', {})).status, 400);
  assert.equal((await r.call('POST', '/drives/ana/remove', { confirm: 'ben' })).status, 400);
  assert.equal(r.registry.drive('ana').state, 'running');
  const removed = await r.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.drive.state, 'removed');
  assert.equal(removed.body.drive.removed, '2026-10-25T12:00:00.000Z');
  assert.equal(await r.envs.read('ana'), null);
  assert.equal(await fsp.readFile(path.join(folder, 'drive', 'Notes.mrbl'), 'utf8'), 'hers');
  assert.equal((await r.call('POST', '/drives/ana/resume')).status, 409);
  assert.equal((await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' })).status, 409, 'the name stays taken');
});

test('channel: canary or everyone, recorded for the updater', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' });
  assert.equal((await r.call('POST', '/drives/ana/channel', { channel: 'beta' })).status, 400);
  const moved = await r.call('POST', '/drives/ana/channel', { channel: 'canary' });
  assert.equal(moved.body.drive.channel, 'canary');
  assert.equal(r.registry.drive('ana').release, NEWEST, 'nothing moved: that is the updater\'s');
  assert.equal((await r.registry.events())[0].kind, 'channel');
});

test('GET /releases: the channels, pause, what is on disk, and what new drives get', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  const { body } = await r.call('GET', '/releases');
  assert.deepEqual(body, { channels: { canary: null, everyone: null }, paused: false, onDisk: [NEWEST, '20261024T234240Z-3f2d234'], newDrives: { release: NEWEST, from: 'newest' } });
});

test('GET /events, newest first, limited', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' });
  await r.call('POST', '/drives/ana/restart');
  const { body } = await r.call('GET', '/events?limit=1');
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].kind, 'restarted');
  assert.equal((await r.call('GET', '/events?limit=nonsense')).body.events.length, 2);
  assert.equal((await r.call('GET', '/nothing')).status, 404);
  assert.equal((await r.call('DELETE', '/drives')).status, 404);
});
