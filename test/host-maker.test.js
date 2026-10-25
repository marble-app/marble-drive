// The maker (server/host/maker.js): a drive's name checked, its port and its
// settings file made, its service started and its check passed; and the
// door's queue drained one drive at a time, every step reported, the ready
// report told again until the door hears it.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createGuestEnvs } from '../server/host/guest-env.js';
import { createMaker } from '../server/host/maker.js';
import { openRegistry } from '../server/host/registry.js';
import { addRelease, fakeDoor, fakeUnits, quiet, scratchPc } from './fixtures/host.js';

const NEWEST = '20261025T161133Z-4b2103a';

/** A probe that says every drive is well on whatever release it was made on. */
function wellProbe(releaseOf) {
  const state = { answering: true };
  const healthy = (port) => (state.answering ? { ok: true, working: 0, release: releaseOf(port) } : null);
  return {
    state,
    health: async (port) => healthy(port),
    page: async () => (state.answering ? 302 : null),
    deep: async (port) => (state.answering ? { ok: true, release: releaseOf(port), claude: { version: '2.1.281' }, codex: { version: '0.159.3' } } : null),
  };
}

async function rig({ releases = [NEWEST], door = null, ...settings } = {}) {
  const pc = await scratchPc({ releases, ...settings });
  const registry = await openRegistry({ dir: pc.state });
  const units = fakeUnits();
  const envs = createGuestEnvs({ dir: pc.guestEnvDir });
  const releaseOf = (port) => registry.drives().find((d) => d.port === port)?.release ?? null;
  const probe = wellProbe(releaseOf);
  const told = [];
  let secrets = 0;
  const maker = createMaker({
    settings: { ...pc.settings, ...(door ? { doorAdminToken: 'door-token' } : {}) },
    registry,
    units,
    envs,
    probe,
    notify: async (drive, kind, message) => told.push({ drive, kind, message }),
    fetchImpl: door?.fetchImpl ?? (async () => { throw new Error('no door in this test'); }),
    log: quiet,
    newSecret: () => `${String((secrets += 1)).padStart(2, '0')}${'f'.repeat(62)}`,
    inUse: async () => false,
    checkMs: 50,
  });
  return { pc, registry, units, envs, probe, maker, told };
}

test('a new drive: a port, its settings file, its service, its check, and the registry says running', async (t) => {
  const r = await rig();
  t.after(r.pc.cleanup);
  const steps = [];
  const made = await r.maker.make({ name: 'ana', owner: 'acct_1' }, { onStep: async (step, state) => steps.push(`${step} ${state}`) });
  assert.equal(made.ok, true, made.why);
  assert.deepEqual(steps, ['machine now', 'machine done', 'install now', 'install done', 'check now', 'check done']);
  const d = r.registry.drive('ana');
  assert.equal(d.state, 'running');
  assert.equal(d.port, 4500);
  assert.equal(d.release, NEWEST);
  assert.equal(d.channel, 'everyone');
  assert.equal(d.owner, 'acct_1');
  assert.deepEqual(r.units.calls, ['start ana']);
  const file = path.join(r.pc.guestEnvDir, 'ana.env');
  assert.equal((await fsp.stat(file)).mode & 0o777, 0o600);
  const env = await r.envs.read('ana');
  assert.equal(env.MARBLE_GUEST_RELEASE, NEWEST);
  assert.equal(env.PORT, '4500');
  assert.equal(env.MARBLE_DRIVE_SECRET, `01${'f'.repeat(62)}`);
  assert.equal(env.MARBLE_DOOR_KEYS, 'k1:AAAA k2:BBBB');
  assert.equal(env.MARBLE_DOOR_OWNER, 'acct_1');
  assert.equal(env.MARBLE_HOST_OWNER, 'Bryan');
  assert.deepEqual((await r.registry.events()).map((e) => e.kind), ['made']);
});

test('two drives asked for at once get two ports', async (t) => {
  const r = await rig();
  t.after(r.pc.cleanup);
  const [a, b] = await Promise.all([r.maker.make({ name: 'ana', owner: 'acct_1' }), r.maker.make({ name: 'ben', owner: 'acct_2' })]);
  assert.ok(a.ok && b.ok);
  assert.deepEqual([r.registry.drive('ana').port, r.registry.drive('ben').port], [4500, 4501]);
});

test('names: refused when not a drive\'s name, kept for marble-host, already here, or a folder already on the PC', async (t) => {
  const r = await rig();
  t.after(r.pc.cleanup);
  const refused = async (job, status, why) => {
    const got = await r.maker.make(job);
    assert.equal(got.ok, false, JSON.stringify(job));
    assert.equal(got.status, status, got.why);
    assert.match(got.why, why);
  };
  await refused({ name: 'An', owner: 'acct_1' }, 400, /3 to 40 of a-z/);
  await refused({ name: 'escape-check', owner: 'acct_1' }, 400, /keeps for itself/);
  await refused({ name: 'ana', owner: 'not an id' }, 400, /owner is the door account id/);
  await refused({ name: 'ana', owner: 'acct_1', cohort: 'a b' }, 400, /cohort/);
  assert.ok((await r.maker.make({ name: 'ana', owner: 'acct_1' })).ok);
  await refused({ name: 'ana', owner: 'acct_9' }, 409, /already on this PC \(running\)/);
  await fsp.mkdir(path.join(r.pc.guestStateDir, 'old'), { recursive: true });
  await refused({ name: 'old', owner: 'acct_1' }, 409, /a folder for old is already on this PC/);
  assert.equal(r.registry.drive('old'), null);
  assert.deepEqual(r.units.calls, ['start ana'], 'nothing refused was started');
});

test('the release: the newest in <opt>/releases, unless the registry names one; none is a 503', async (t) => {
  const r = await rig({ releases: ['20261024T234240Z-3f2d234', NEWEST, '20261025T012133Z-fa4cf63'] });
  t.after(r.pc.cleanup);
  // A folder that is not a release, and one with no host in it, are passed over.
  await fsp.mkdir(path.join(r.pc.opt, 'releases', 'zzz-empty', 'marble-drive'), { recursive: true });
  await fsp.mkdir(path.join(r.pc.opt, 'releases', '.partial'), { recursive: true });
  await r.maker.make({ name: 'ana', owner: 'acct_1' });
  assert.equal(r.registry.drive('ana').release, NEWEST);

  await r.registry.update((d) => {
    d.channels.everyone = '20261024T234240Z-3f2d234';
  });
  await r.maker.make({ name: 'ben', owner: 'acct_1' });
  assert.equal(r.registry.drive('ben').release, '20261024T234240Z-3f2d234');

  await r.registry.update((d) => {
    d.channels.everyone = '20261101T000000Z-gone000';
  });
  const gone = await r.maker.make({ name: 'cho', owner: 'acct_1' });
  assert.equal(gone.status, 503);
  assert.match(gone.why, /the release 20261101T000000Z-gone000 is not in/);

  const empty = await rig({ releases: [] });
  t.after(empty.pc.cleanup);
  const none = await empty.maker.make({ name: 'ana', owner: 'acct_1' });
  assert.equal(none.status, 503);
  assert.match(none.why, /there is no release in .*\/releases yet, so no drive can be made; putting one there is the updater's job/);
  await addRelease(empty.pc.opt, NEWEST);
  assert.ok((await empty.maker.make({ name: 'ana', owner: 'acct_1' })).ok);
});

test('a drive that fails its check is stopped, marked failed, keeps its port, and the owner is told; trying again can finish it', async (t) => {
  const r = await rig();
  t.after(r.pc.cleanup);
  r.probe.state.answering = false;
  const got = await r.maker.make({ name: 'ana', owner: 'acct_1' });
  assert.equal(got.ok, false);
  assert.equal(got.status, 500);
  assert.equal(got.step, 'check');
  assert.match(got.why, /did not answer \/health/);
  const d = r.registry.drive('ana');
  assert.equal(d.state, 'failed');
  assert.deepEqual(d.failed, { step: 'check', why: got.why });
  assert.deepEqual(r.units.calls, ['start ana', 'stop ana']);
  assert.equal(r.told.length, 1);
  assert.match(r.told[0].message, /Making ana stopped at check/);
  assert.equal((await r.maker.make({ name: 'ben', owner: 'acct_1' })).ok, false);
  assert.equal(r.registry.drive('ben').port, 4501, 'a failed drive still holds its port');

  r.probe.state.answering = true;
  const again = await r.maker.retry('ana');
  assert.equal(again.ok, true, again.why);
  assert.equal(r.registry.drive('ana').state, 'running');
  assert.equal(r.registry.drive('ana').failed, undefined);
  assert.equal((await r.envs.read('ana')).MARBLE_DRIVE_SECRET, `01${'f'.repeat(62)}`, 'the same settings file');
  assert.equal((await r.maker.retry('ana')).status, 409);
});

test('the door\'s queue: each drive for the PC is made in turn, every step reported, then ready with home pchost', async (t) => {
  const door = fakeDoor({
    queue: [
      { name: 'ana', owner: 'acct_1', home: 'pchost', state: 'queued' },
      { name: 'flyer', owner: 'acct_3', home: 'fly', state: 'queued' },
      { name: 'ben', owner: 'acct_2', home: 'pchost', state: 'queued', cohort: 'study' },
    ],
  });
  const r = await rig({ door });
  t.after(r.pc.cleanup);
  const drained = await r.maker.drain();
  assert.deepEqual(drained, { idle: true, made: 2 });
  assert.equal(r.registry.drive('ana').state, 'running');
  assert.equal(r.registry.drive('ben').state, 'running');
  assert.equal(r.registry.drive('flyer'), null, 'a Fly drive is the door sprite\'s');
  assert.equal((await r.envs.read('ben')).MARBLE_STUDY, '1');
  const ana = door.heard.filter((h) => h.path === '/_door/drives/ana/step').map((h) => h.body);
  assert.deepEqual(ana, [
    { step: 'machine', state: 'now' },
    { step: 'machine', state: 'done' },
    { step: 'install', state: 'now' },
    { step: 'install', state: 'done' },
    { step: 'check', state: 'now' },
    { step: 'check', state: 'done' },
    { state: 'ready', home: 'pchost' },
  ]);
  assert.ok(door.heard.every((h) => h.auth === 'Bearer door-token'));
  assert.ok(door.heard.some((h) => h.path === '/_door/queue?home=pchost'));
  assert.equal(r.registry.drive('ana').door.reported, true);
});

test('a ready report the door did not hear is told again at the next look', async (t) => {
  const door = fakeDoor({ queue: [{ name: 'ana', owner: 'acct_1', home: 'pchost', state: 'queued' }], failReady: 2 });
  const r = await rig({ door });
  t.after(r.pc.cleanup);
  await r.maker.drain();
  assert.equal(r.registry.drive('ana').state, 'running');
  assert.equal(r.registry.drive('ana').door.reported, false);
  // The next look: told again before the queue is read, and again from the
  // queue (it is still queued there) without making it twice.
  await r.maker.drain();
  const readies = door.steps().filter((b) => b.state === 'ready');
  assert.equal(readies.length, 3);
  assert.equal(r.registry.drive('ana').door.reported, true);
  assert.deepEqual(r.units.calls, ['start ana'], 'made once');
  assert.equal(door.queue[0].state, 'ready');
});

test('a drive the door asked for that cannot be made is reported failed at its step', async (t) => {
  const door = fakeDoor({ queue: [{ name: 'ana', owner: 'acct_1', home: 'pchost', state: 'queued' }] });
  const r = await rig({ door });
  t.after(r.pc.cleanup);
  r.probe.state.answering = false;
  await r.maker.drain();
  assert.deepEqual(door.steps().at(-1), { step: 'check', state: 'failed' });
  assert.equal(r.registry.drive('ana').state, 'failed');
});

test('without the door\'s admin token nothing is asked of the door', async (t) => {
  const r = await rig();
  t.after(r.pc.cleanup);
  assert.deepEqual(await r.maker.drain(), { off: true });
  r.maker.start();
  r.maker.stop();
});
