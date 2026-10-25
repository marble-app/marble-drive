// marble-host's admin API (server/host/admin.js): nothing without the admin
// token; every drive with its live state, what the last look found and its
// last backup; make, restart, suspend, resume, remove (the remover's way,
// ended at the door first for a drive the door made), channel, export and
// backup; the releases; the events; and the updater's four routes answering
// 501, since moving drives between releases is the owner's to write.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { backupStatus, createAdmin, NOT_BUILT } from '../server/host/admin.js';
import { createDoor } from '../server/host/door.js';
import { createGuestEnvs } from '../server/host/guest-env.js';
import { createLooks } from '../server/host/looks.js';
import { createMaker } from '../server/host/maker.js';
import { openRegistry } from '../server/host/registry.js';
import { createRemover } from '../server/host/remover.js';
import { fakeDoor, fakeUnits, quiet, scratchPc } from './fixtures/host.js';

const TOKEN = 'admin-token-for-tests';
const NEWEST = '20261025T161133Z-4b2103a';

async function rig({ door: fake = null, mode = 'system' } = {}) {
  const pc = await scratchPc({ releases: ['20261024T234240Z-3f2d234', NEWEST] });
  const registry = await openRegistry({ dir: pc.state });
  const units = fakeUnits({ mode });
  const envs = createGuestEnvs({ dir: pc.guestEnvDir });
  const well = { on: true, deep: {}, study: null };
  const asked = [];
  const releaseOf = (port) => registry.drives().find((d) => d.port === port)?.release ?? null;
  const probe = {
    health: async (port) => (well.on ? { ok: true, working: 0, release: releaseOf(port) } : null),
    page: async () => (well.on ? 302 : null),
    deep: async (port) => (well.on ? { ok: true, claude: { version: '2.1.281' }, codex: { version: '0.159.3' }, release: releaseOf(port), ...well.deep } : null),
    study: async () => (well.on ? well.study : null),
    logout: async (port, secret) => {
      asked.push(['logout', port, secret]);
      return well.on ? { claude: 'signed-out', codex: 'was-not-signed-in' } : null;
    },
  };
  const door = fake ? createDoor({ url: 'https://door.test', token: 'door-token', fetchImpl: fake.fetchImpl }) : null;
  const maker = createMaker({ settings: pc.settings, registry, units, envs, probe, door, log: quiet, inUse: async () => false, checkMs: 50 });
  const watched = new Map();
  const watcher = { health: (name) => watched.get(name) ?? null };
  const remover = createRemover({ registry, units, envs, probe, door, log: quiet, now: () => '2026-10-25T12:00:00.000Z' });
  const looks = createLooks({ registry, probe, envs, door, log: quiet });
  const admin = createAdmin({ token: TOKEN, settings: pc.settings, registry, units, maker, watcher, envs, probe, remover, looks, door, log: quiet, now: () => '2026-10-25T12:00:00.000Z' });
  const port = await admin.listen(0);
  const call = async (method, route, body, { token = TOKEN } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return { pc, registry, units, envs, well, asked, watched, looks, call, cleanup: async () => { await admin.close(); await pc.cleanup(); } };
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
  assert.deepEqual(Object.keys(ana).sort(), ['active', 'agent', 'backup', 'channel', 'cohort', 'created', 'health', 'lastActive', 'memoryBytes', 'name', 'owner', 'port', 'release', 'restarts', 'state', 'study', 'turnsToday'].sort());
  assert.equal(ana.agent, null, 'not looked at yet');
  assert.equal(ana.study, null);
  assert.equal(ana.backup, null, 'no backup yet');
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

test('remove: only with the drive\'s name typed; signed out, stopped, its settings gone, root\'s helper deletes it, and the name stays taken', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' });
  const secret = (await r.envs.read('ana')).MARBLE_DRIVE_SECRET;
  r.units.calls.length = 0;
  assert.equal((await r.call('POST', '/drives/ana/remove', {})).status, 400);
  assert.equal((await r.call('POST', '/drives/ana/remove', { confirm: 'ben' })).status, 400);
  assert.equal(r.registry.drive('ana').state, 'running');
  assert.deepEqual(r.units.calls, [], 'nothing done without its name');
  const removed = await r.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  assert.equal(removed.status, 200, removed.body.why);
  assert.equal(removed.body.drive.state, 'removed');
  assert.equal(removed.body.drive.removed, '2026-10-25T12:00:00.000Z');
  assert.deepEqual(removed.body.removal, { by: 'owner', claude: 'signed-out', codex: 'was-not-signed-in', folder: 'deleted' });
  assert.deepEqual(r.asked, [['logout', 4500, secret]], 'its CLIs signed out first, with its passphrase');
  assert.deepEqual(r.units.calls, ['stop ana', 'remove ana'], 'stopped, then root\'s helper, waited for');
  assert.equal(await r.envs.read('ana'), null);
  assert.deepEqual((await r.registry.events()).slice(0, 2).map((e) => e.kind), ['removed', 'removing']);
  assert.equal((await r.call('POST', '/drives/ana/remove', { confirm: 'ana' })).status, 200, 'again is fine');
  assert.equal((await r.call('POST', '/drives/ana/resume')).status, 409);
  assert.equal((await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' })).status, 409, 'the name stays taken');
});

test('remove: a helper that fails leaves it removing, its settings gone, to be finished at the next look; user mode keeps the folder', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' });
  r.units.helper = async () => {
    throw new Error('systemctl start marble-guest-remove@ana.service failed (exit 1): a backup of ana is running');
  };
  const failed = await r.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  assert.equal(failed.status, 500);
  assert.match(failed.body.why, /a backup of ana is running/);
  assert.equal(r.registry.drive('ana').state, 'removing');
  assert.equal(await r.envs.read('ana'), null);
  const listed = (await r.call('GET', '/drives')).body.drives[0];
  assert.equal(listed.state, 'removing');
  assert.deepEqual(listed.removing, { at: '2026-10-25T12:00:00.000Z', by: 'owner' });
  assert.equal((await r.call('POST', '/drives/ana/restart')).status, 409, 'a drive being removed is not restarted');

  const trial = await rig({ mode: 'user' });
  t.after(trial.cleanup);
  await trial.call('POST', '/drives', { name: 'ben', owner: 'acct_2' });
  const out = await trial.call('POST', '/drives/ben/remove', { confirm: 'ben' });
  assert.equal(out.status, 200, out.body.why);
  assert.equal(out.body.removal.folder, 'kept', 'no root helper in user mode');
  assert.deepEqual(trial.units.calls.slice(-1), ['stop ben']);
});

test('remove: a drive the door made is ended at the door first, which then hears removed; a door that can\'t be reached changes nothing', async (t) => {
  const door = fakeDoor({ queue: [{ name: 'ana', owner: 'acct_1', home: 'pchost', state: 'queued' }], drives: [{ name: 'ana', owner: 'acct_1', home: 'pchost', state: 'ready' }, { name: 'ben', owner: 'someone-else', home: 'fly', state: 'ready' }] });
  const r = await rig({ door });
  t.after(r.cleanup);
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' });
  await r.registry.update((x) => {
    x.drives.ana.door = { reported: true };
  });
  door.state.down = true;
  const down = await r.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  assert.equal(down.status, 502);
  assert.match(down.body.why, /the door could not end ana .*nothing was changed/);
  assert.equal(r.registry.drive('ana').state, 'running');
  door.state.down = false;
  const removed = await r.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  assert.equal(removed.status, 200, removed.body.why);
  assert.equal(removed.body.removal.door, 'told');
  const asked = door.heard.map((h) => `${h.method} ${h.path}${h.body?.state ? ` ${h.body.state}` : ''}`);
  assert.deepEqual(asked.filter((a) => !a.startsWith('GET /_door/drives') || true).slice(-3), ['GET /_door/drives', 'POST /_door/drives/ana/remove', 'POST /_door/drives/ana/step removed']);
  assert.equal(door.drives[0].state, 'removed', 'the door keeps its record, as removed');

  // A drive made here by hand whose name the door gave someone else is not theirs to end.
  await r.call('POST', '/drives', { name: 'ben', owner: 'acct_2' });
  await r.registry.update((x) => {
    x.drives.ben.door = { reported: true };
  });
  const before = door.heard.length;
  assert.equal((await r.call('POST', '/drives/ben/remove', { confirm: 'ben' })).status, 200);
  assert.deepEqual(door.heard.slice(before).map((h) => h.path), ['/_door/drives'], 'only looked');
  assert.equal(door.drives[1].state, 'ready');
});

test('export: only a drive whose settings say it is in the study, root\'s helper started and not waited for', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1', cohort: 'study' });
  const no = await r.call('POST', '/drives/ana/export');
  assert.equal(no.status, 409);
  assert.match(no.body.why, /ana isn't in the study, so nothing of it is exported/);
  await r.envs.update('ana', { MARBLE_CONSENT: '2026-11-irb-v1@2026-10-25T11:00:00.000Z' });
  r.units.calls.length = 0;
  const yes = await r.call('POST', '/drives/ana/export');
  assert.equal(yes.status, 202, yes.body.why);
  assert.equal(yes.body.started, 'marble-guest-export@ana.service');
  assert.deepEqual(r.units.calls, ['export ana --no-block']);
  assert.equal((await r.registry.events())[0].kind, 'export');
  assert.equal((await r.call('POST', '/drives/nobody/export')).status, 404);

  const trial = await rig({ mode: 'user' });
  t.after(trial.cleanup);
  await trial.call('POST', '/drives', { name: 'ben', owner: 'acct_2', cohort: 'study' });
  await trial.envs.update('ben', { MARBLE_CONSENT: 'v1@2026-10-25T11:00:00.000Z' });
  const none = await trial.call('POST', '/drives/ben/export');
  assert.equal(none.status, 501);
  assert.match(none.body.why, /root's helpers; HOST_MODE=user has none/);
});

test('backup: root\'s backup started now, not waited for; and each row carries the drive\'s last backup', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1' });
  r.units.calls.length = 0;
  const started = await r.call('POST', '/drives/ana/backup');
  assert.equal(started.status, 202, started.body.why);
  assert.equal(started.body.started, 'marble-guest-backup@ana.service');
  assert.deepEqual(r.units.calls, ['backup ana --no-block']);
  await fsp.mkdir(r.pc.settings.backupStatusDir, { recursive: true });
  const status = { name: 'ana', at: '2026-10-25T17:00:03Z', ok: true, files: 214, bytes: 5813302, changed: false, lastGood: '2026-10-25T17:00:03Z', extra: 'not passed on' };
  await fsp.writeFile(path.join(r.pc.settings.backupStatusDir, 'ana.json'), JSON.stringify(status));
  const { extra, ...shown } = status;
  assert.deepEqual((await r.call('GET', '/drives')).body.drives[0].backup, shown);
  assert.equal(await backupStatus(r.pc.settings.backupStatusDir, 'ben'), null);
  await fsp.writeFile(path.join(r.pc.settings.backupStatusDir, 'ben.json'), '{torn');
  assert.equal(await backupStatus(r.pc.settings.backupStatusDir, 'ben'), null);
  await r.call('POST', '/drives/ana/suspend');
  assert.equal((await r.call('POST', '/drives/ana/backup')).status, 202, 'a suspended drive is backed up too');
});

test('GET /drives: the agent, the day\'s turns, last active, held-back pages and the study\'s counts from the last look', async (t) => {
  const r = await rig();
  t.after(r.cleanup);
  await r.call('POST', '/drives', { name: 'ana', owner: 'acct_1', cohort: 'study' });
  await r.envs.update('ana', { MARBLE_CONSENT: 'v1@2026-10-25T11:00:00.000Z' });
  r.well.deep = { codex: { version: '0.159.3', signedIn: true }, agentConnected: true, docs: 2, turnsToday: 5, lastActive: '2026-10-25T11:58:00.000Z', heldBack: ['Start here', { path: 'Design System' }] };
  r.well.study = { ok: true, at: '2026-10-25T11:59:00.000Z', days: 3, prompts: 40, builds: 2, marks: 7, buttons: 1, conversations: 9, singlePromptConversations: 4, promptsWhileAnotherWorked: 6 };
  await r.looks.tick();
  const [ana] = (await r.call('GET', '/drives')).body.drives;
  assert.equal(ana.agent, 'chatgpt');
  assert.equal(ana.turnsToday, 5);
  assert.equal(ana.lastActive, '2026-10-25T11:58:00.000Z');
  assert.deepEqual(ana.heldBack, ['Start here', 'Design System']);
  assert.deepEqual(ana.study, { counts: { days: 3, prompts: 40, builds: 2, marks: 7, buttons: 1, conversations: 9, singlePromptConversations: 4, promptsWhileAnotherWorked: 6 }, at: '2026-10-25T11:59:00.000Z' });
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
