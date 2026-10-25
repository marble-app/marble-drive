// The remover (server/host/remover.js), one way off the PC whoever asked:
// the CLIs signed out while the drive runs, its service stopped, its
// settings file deleted, root's helper deleting its folder, the door told
// when the door is ending it, and the registry marking it removed. A step
// that fails leaves it `removing`, to be finished later; a removal asked for
// twice at once is one removal.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDoor } from '../server/host/door.js';
import { createGuestEnvs, guestEntries } from '../server/host/guest-env.js';
import { openRegistry } from '../server/host/registry.js';
import { createRemover } from '../server/host/remover.js';
import { fakeDoor, fakeProbe, fakeUnits, quiet, scratchPc } from './fixtures/host.js';

const RELEASE = '20261025T161133Z-4b2103a';
const SECRET = 'c'.repeat(64);
const AT = '2026-10-25T12:00:00.000Z';

async function rig({ drives = [['ana', 'running', 4500]], door: fake = null, mode = 'system' } = {}) {
  const pc = await scratchPc();
  const registry = await openRegistry({ dir: pc.state });
  const envs = createGuestEnvs({ dir: pc.guestEnvDir });
  await registry.update((r) => {
    for (const [name, state, port] of drives) r.drives[name] = { name, port, owner: 'acct_1', state, release: RELEASE, channel: 'everyone', restarts: 0, cohort: null, door: { reported: true } };
  });
  for (const [name, , port] of drives) await envs.write(name, guestEntries({ name, release: RELEASE, port, secret: SECRET, doorKeys: 'k1:AAAA', owner: 'acct_1' }));
  const units = fakeUnits({ mode });
  const probe = fakeProbe();
  for (const [, , port] of drives) probe.set(port);
  const door = fake ? createDoor({ url: 'https://door.test', token: 'door-token', fetchImpl: fake.fetchImpl }) : null;
  const remover = createRemover({ registry, units, envs, probe, door, log: quiet, now: () => AT });
  return { pc, registry, envs, units, probe, remover };
}

test('a running drive: signed out with its passphrase, stopped, its settings gone, then root\'s helper, then removed', async (t) => {
  const r = await rig();
  t.after(r.pc.cleanup);
  const out = await r.remover.remove('ana', { by: 'owner' });
  assert.equal(out.ok, true, out.why);
  assert.deepEqual(r.probe.asked, [['/health/logout', 4500, SECRET]]);
  assert.deepEqual(r.units.calls, ['stop ana', 'remove ana'], 'the helper is waited for, after the stop');
  assert.equal(await r.envs.read('ana'), null);
  const d = r.registry.drive('ana');
  assert.equal(d.state, 'removed');
  assert.equal(d.removed, AT);
  assert.equal(d.removing, undefined);
  const [removed, removing] = await r.registry.events(2);
  assert.equal(removing.kind, 'removing');
  assert.deepEqual(removed.detail, { by: 'owner', claude: 'signed-out', codex: 'was-not-signed-in', folder: 'deleted' });
  assert.deepEqual(out.detail, removed.detail);
  const again = await r.remover.remove('ana');
  assert.equal(again.ok, true);
  assert.equal(again.already, true);
  assert.deepEqual(r.units.calls, ['stop ana', 'remove ana'], 'nothing done twice');
});

test('a drive that wasn\'t running is not asked to sign out: its logins go with its folder', async (t) => {
  const r = await rig({ drives: [['ana', 'suspended', 4500], ['ben', 'failed', 4501]] });
  t.after(r.pc.cleanup);
  for (const name of ['ana', 'ben']) assert.equal((await r.remover.remove(name)).ok, true);
  assert.deepEqual(r.probe.asked, []);
  assert.equal((await r.registry.events(1))[0].detail.logout, 'not-running');
  // One that was running but doesn't answer is removed all the same.
  const s = await rig({ drives: [['cho', 'running', 4502]] });
  t.after(s.pc.cleanup);
  s.probe.set(4502, { ok: false });
  const out = await s.remover.remove('cho');
  assert.equal(out.ok, true);
  assert.equal(out.detail.logout, 'no-answer');
});

test('a step that fails leaves it removing, and asking again finishes it from where it is', async (t) => {
  const r = await rig();
  t.after(r.pc.cleanup);
  const stop = r.units.stop;
  r.units.stop = async () => {
    throw new Error('systemctl stop marble-guest@ana.service failed (exit 1): Access denied');
  };
  const failed = await r.remover.remove('ana');
  assert.equal(failed.ok, false);
  assert.match(failed.why, /Access denied/);
  assert.equal(r.registry.drive('ana').state, 'removing');
  assert.deepEqual(r.registry.drive('ana').removing, { at: AT, by: 'owner', door: false, was: 'running' });
  assert.ok(await r.envs.read('ana'), 'its settings stay until it has stopped: root\'s helper would refuse anyway');
  assert.equal((await r.registry.events(1))[0].kind, 'remove-failed');

  r.units.stop = stop;
  const helper = r.units.helper;
  r.units.helper = async () => {
    throw new Error('systemctl start marble-guest-remove@ana.service failed (exit 1)');
  };
  assert.equal((await r.remover.remove('ana')).ok, false);
  assert.equal(r.registry.drive('ana').state, 'removing');
  assert.equal(await r.envs.read('ana'), null, 'stopped and its settings gone; only the folder is left');

  r.units.helper = helper;
  const done = await r.remover.remove('ana', { by: 'door' });
  assert.equal(done.ok, true, done.why);
  assert.equal(done.detail.by, 'owner', 'whoever began it');
  assert.equal(done.detail.logout, 'no-answer', 'its passphrase went with its settings');
  assert.equal(r.registry.drive('ana').state, 'removed');
});

test('one removal at a time: asked twice at once, it is the same removal', async (t) => {
  const r = await rig();
  t.after(r.pc.cleanup);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const helper = r.units.helper;
  r.units.helper = async (...args) => {
    await gate;
    return helper(...args);
  };
  const first = r.remover.remove('ana');
  const second = r.remover.remove('ana');
  assert.equal(r.remover.busy('ana'), true);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.deepEqual(r.units.calls, ['stop ana', 'remove ana']);
  assert.equal(r.remover.busy('ana'), false);
});

test('the door hears removed when it is what ended the drive; a drive it doesn\'t know is said so; a refusal is tried again later', async (t) => {
  const door = fakeDoor({ drives: [{ name: 'ana', owner: 'acct_1', home: 'pchost', state: 'deleting' }, { name: 'ben', owner: 'acct_1', home: 'pchost', state: 'ready' }] });
  const r = await rig({ drives: [['ana', 'running', 4500], ['ben', 'running', 4501], ['cho', 'running', 4502]], door });
  t.after(r.pc.cleanup);
  assert.equal((await r.remover.remove('ana', { by: 'person', door: true })).detail.door, 'told');
  assert.equal(door.drives[0].state, 'removed');
  assert.equal((await r.remover.remove('cho', { door: true })).detail.door, 'unknown');
  // The door has ben as ready: it refuses `removed`, and the drive is still gone from here.
  const ben = await r.remover.remove('ben', { door: true });
  assert.equal(ben.ok, true);
  assert.equal(ben.detail.door, 'not-told');
  door.drives[1].state = 'removing';
  const retold = await r.remover.remove('ben', { door: true });
  assert.equal(retold.already, true);
  assert.equal(retold.door, 'told');
  assert.equal(door.drives[1].state, 'removed');
  // Without `door`, the door hears nothing.
  const quiet = await rig({ drives: [['dee', 'running', 4503]], door });
  t.after(quiet.pc.cleanup);
  const before = door.heard.length;
  assert.equal((await quiet.remover.remove('dee')).detail.door, undefined);
  assert.equal(door.heard.length, before);
});

test('user mode has no root helper: the folder stays, and the event says so; a drive being made or not here is refused', async (t) => {
  const r = await rig({ mode: 'user', drives: [['ana', 'running', 4500], ['ben', 'making', 4501]] });
  t.after(r.pc.cleanup);
  const out = await r.remover.remove('ana');
  assert.equal(out.ok, true);
  assert.equal(out.detail.folder, 'kept');
  assert.deepEqual(r.units.calls, ['stop ana']);
  const making = await r.remover.remove('ben');
  assert.equal(making.status, 409);
  assert.match(making.why, /ben is being made/);
  assert.equal((await r.remover.remove('nobody')).status, 404);
});
