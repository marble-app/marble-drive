// marble-host and the study (server/host/reconcile.js, server/host/looks.js,
// server/host/door.js): the door's people every five minutes, turned into
// each drive's study settings (MARBLE_STUDY and MARBLE_CONSENT, nothing
// restarted) and into removals for the drives it is ending; each running
// drive's /health/deep and, in the study, /health/study, and the door's two
// firsts said once. Last, all of it against the door's own Directory, in
// memory, from invite to deletion.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

import { Directory } from '../worker/src/door/directory.js';
import { createDoor } from '../server/host/door.js';
import { createGuestEnvs, guestEntries } from '../server/host/guest-env.js';
import { agentOf, createLooks, studyCounts } from '../server/host/looks.js';
import { createMaker } from '../server/host/maker.js';
import { consentOf, createReconciler } from '../server/host/reconcile.js';
import { openRegistry } from '../server/host/registry.js';
import { createRemover } from '../server/host/remover.js';
import { fakeDoor, fakeProbe, fakeUnits, quiet, scratchPc } from './fixtures/host.js';
import { memoryStorage } from './fixtures/door-env.js';

const RELEASE = '20261025T161133Z-4b2103a';
const SECRET = 'd'.repeat(64);
const GIVEN = { version: '2026-11-irb-v1', at: '2026-10-25T11:00:00.000Z', choice: 'given' };

/** A row of /_door/people for a drive on the PC host. */
const person = (name, { owner = 'acct_1', state = 'ready', cohort = 'study', consent = GIVEN, withdrawn = null, home = 'pchost' } = {}) => ({
  account: { id: owner, name: 'Ana Lima', email: 'ana@example.com', created: '2026-10-25T10:00:00.000Z', seen: null },
  drive: { name, state, home, created: '2026-10-25T10:30:00.000Z' },
  invite: null,
  study: { cohort, consent, withdrawn, deleteAsked: null },
  timeline: {},
});

async function rig({ drives = [['ana', 'running', 4500, 'study']], people = [], doorDrives = [] } = {}) {
  const pc = await scratchPc();
  const registry = await openRegistry({ dir: pc.state });
  const envs = createGuestEnvs({ dir: pc.guestEnvDir });
  await registry.update((r) => {
    for (const [name, state, port, cohort = null] of drives) r.drives[name] = { name, port, owner: 'acct_1', state, release: RELEASE, channel: 'everyone', restarts: 0, cohort, door: { reported: true } };
  });
  for (const [name, state, port, cohort = null] of drives) {
    if (state !== 'removed') await envs.write(name, guestEntries({ name, release: RELEASE, port, secret: SECRET, doorKeys: 'k1:AAAA', owner: 'acct_1', cohort }));
  }
  const fake = fakeDoor({ people, drives: doorDrives });
  const door = createDoor({ url: 'https://door.test', token: 'door-token', fetchImpl: fake.fetchImpl });
  const units = fakeUnits();
  const probe = fakeProbe();
  for (const [, , port] of drives) probe.set(port);
  const remover = createRemover({ registry, units, envs, probe, door, log: quiet });
  const reconciler = createReconciler({ registry, envs, door, remover, log: quiet });
  return { pc, registry, envs, fake, door, units, probe, remover, reconciler };
}

test('consent as the settings file carries it: <version>@<at> for someone in the study, and nothing for anyone else', () => {
  assert.equal(consentOf(person('ana')), '2026-11-irb-v1@2026-10-25T11:00:00.000Z');
  assert.equal(consentOf(person('ana', { withdrawn: '2026-10-26T09:00:00.000Z' })), null, 'left');
  assert.equal(consentOf(person('ana', { consent: { ...GIVEN, choice: 'declined' } })), null);
  assert.equal(consentOf(person('ana', { consent: null })), null);
  assert.equal(consentOf(person('ana', { cohort: null })), null);
  for (const bad of [{ version: 'two words' }, { version: '$(id)' }, { version: '' }, { at: 'yesterday' }, { at: '2026-10-25 11:00' }, { at: null }]) {
    assert.equal(consentOf(person('ana', { consent: { ...GIVEN, ...bad } })), null, JSON.stringify(bad));
  }
  assert.equal(consentOf(null), null);
});

test('in the study: MARBLE_STUDY=1 and MARBLE_CONSENT written once, and nothing restarted; leaving takes both out', async (t) => {
  const r = await rig({ people: [person('ana')] });
  t.after(r.pc.cleanup);
  const first = await r.reconciler.tick();
  assert.deepEqual(first.joined, ['ana']);
  let env = await r.envs.read('ana');
  assert.equal(env.MARBLE_STUDY, '1');
  assert.equal(env.MARBLE_CONSENT, '2026-11-irb-v1@2026-10-25T11:00:00.000Z');
  assert.equal(env.MARBLE_DRIVE_SECRET, SECRET, 'the rest kept');
  assert.equal(env.HOST, '127.0.0.10');
  assert.deepEqual(r.units.calls, [], 'nothing restarted: the export helper reads the file each time it runs');
  // What the export helper reads (linux/pc-host/backup-tree consent) agrees.
  const helper = () => spawnSync('python3', [path.join(import.meta.dirname, '../linux/pc-host/backup-tree'), 'consent', r.envs.file('ana')], { encoding: 'utf8' });
  assert.equal(helper().stdout.trim(), 'study=1 consent=2026-11-irb-v1@2026-10-25T11:00:00.000Z');
  assert.deepEqual((await r.reconciler.tick()).joined, [], 'said once');
  assert.deepEqual(r.fake.heard.map((h) => `${h.method} ${h.path}`), ['GET /_door/people', 'GET /_door/people']);
  assert.ok(r.fake.heard.every((h) => h.auth === 'Bearer door-token'));

  r.fake.people[0].study.withdrawn = '2026-10-26T09:00:00.000Z';
  assert.deepEqual((await r.reconciler.tick()).left, ['ana']);
  env = await r.envs.read('ana');
  assert.equal(env.MARBLE_STUDY, undefined);
  assert.equal(env.MARBLE_CONSENT, undefined);
  assert.equal(env.MARBLE_DRIVE_SECRET, SECRET);
  assert.equal(helper().stdout.trim(), 'study=0 consent=', 'and the export helper refuses it');
  assert.deepEqual((await r.registry.events(2)).map((e) => [e.kind, e.detail.in]), [['study', false], ['study', true]]);
  assert.deepEqual(r.units.calls, []);
});

test('a row speaks only for the drive it names, on the PC host, for the account it was made for; a drive the door doesn\'t list is in no study', async (t) => {
  const r = await rig({
    drives: [['ana', 'running', 4500, 'study'], ['ben', 'running', 4501, 'study'], ['cho', 'running', 4502, 'study'], ['dee', 'suspended', 4503, 'study'], ['eve', 'making', 4504, 'study']],
    people: [person('ana'), person('ben', { owner: 'acct_other' }), person('cho', { home: 'fly' }), person('dee'), person('eve')],
  });
  t.after(r.pc.cleanup);
  const done = await r.reconciler.tick();
  assert.deepEqual(done.joined.sort(), ['ana', 'dee'], 'a suspended drive too: its file is read when it starts');
  for (const name of ['ben', 'cho']) {
    const env = await r.envs.read(name);
    assert.equal(env.MARBLE_CONSENT, undefined, name);
    assert.equal(env.MARBLE_STUDY, undefined, `${name}: made for the study, but no row of its own says so`);
  }
  assert.equal((await r.envs.read('eve')).MARBLE_CONSENT, undefined, 'one being made is the maker\'s');
});

test('when the door can\'t be reached, nothing changes', async (t) => {
  const r = await rig({ drives: [['ana', 'running', 4500, 'study']], people: [person('ana')] });
  t.after(r.pc.cleanup);
  await r.reconciler.tick();
  r.fake.state.down = true;
  const done = await r.reconciler.tick();
  assert.equal(done.read, false);
  assert.equal((await r.envs.read('ana')).MARBLE_CONSENT, '2026-11-irb-v1@2026-10-25T11:00:00.000Z', 'kept as the last look left it');
  assert.equal(r.registry.drive('ana').state, 'running');
});

test('a drive the door is removing or deleting is taken off the PC, and the door hears removed; one cut off part way is finished', async (t) => {
  const r = await rig({
    drives: [['ana', 'running', 4500, 'study'], ['ben', 'running', 4501], ['cho', 'removed', 4502], ['dee', 'running', 4503]],
    people: [person('ana', { state: 'deleting' }), person('ben', { state: 'removing', cohort: null, consent: null }), person('cho', { state: 'removing' })],
    doorDrives: [{ name: 'ana', owner: 'acct_1', home: 'pchost', state: 'deleting' }, { name: 'ben', owner: 'acct_1', home: 'pchost', state: 'removing' }, { name: 'cho', owner: 'acct_1', home: 'pchost', state: 'removing' }],
  });
  t.after(r.pc.cleanup);
  // dee's removal began here and was cut off.
  await r.registry.update((x) => {
    x.drives.dee.state = 'removing';
    x.drives.dee.removing = { at: '2026-10-25T11:00:00.000Z', by: 'owner', door: false, was: 'running' };
  });
  const done = await r.reconciler.tick();
  assert.deepEqual(done.removed.sort(), ['ana', 'ben', 'cho', 'dee']);
  for (const name of ['ana', 'ben', 'dee']) {
    assert.equal(r.registry.drive(name).state, 'removed', name);
    assert.equal(await r.envs.read(name), null, name);
  }
  assert.deepEqual(r.units.calls.filter((c) => c.startsWith('remove')).sort(), ['remove ana', 'remove ben', 'remove dee']);
  assert.deepEqual(r.fake.drives.map((d) => [d.name, d.state]), [['ana', 'removed'], ['ben', 'removed'], ['cho', 'removed']], 'cho was removed here before; the door is told again');
  const byOf = async (name) => (await r.registry.events(50)).find((e) => e.drive === name && e.kind === 'removed').detail.by;
  assert.equal(await byOf('ana'), 'person');
  assert.equal(await byOf('ben'), 'door');
  assert.equal(await byOf('dee'), 'owner');
  // The next look has nothing to do.
  const calls = r.units.calls.length;
  await r.reconciler.tick();
  assert.equal(r.units.calls.length, calls);
});

test('without the door, a removal cut off part way is still finished; study settings are left as they are', async (t) => {
  const pc = await scratchPc();
  t.after(pc.cleanup);
  const registry = await openRegistry({ dir: pc.state });
  const envs = createGuestEnvs({ dir: pc.guestEnvDir });
  await registry.update((x) => {
    x.drives.ana = { name: 'ana', port: 4500, owner: 'acct_1', state: 'removing', release: RELEASE, removing: { at: 'x', by: 'owner', door: false, was: 'suspended' } };
  });
  const units = fakeUnits();
  const remover = createRemover({ registry, units, envs, probe: fakeProbe(), log: quiet });
  const reconciler = createReconciler({ registry, envs, door: createDoor({ url: 'https://door.test', token: null }), remover, log: quiet });
  const done = await reconciler.tick();
  assert.equal(done.read, false);
  assert.deepEqual(done.removed, ['ana']);
  assert.equal(registry.drive('ana').state, 'removed');
});

test('agentOf: claude, chatgpt or a key of their own, from /health/deep', () => {
  assert.equal(agentOf({ claude: { signedIn: true }, codex: { signedIn: true }, agentConnected: true }), 'claude');
  assert.equal(agentOf({ claude: { signedIn: false }, codex: { signedIn: true }, agentConnected: true }), 'chatgpt');
  assert.equal(agentOf({ claude: { signedIn: false }, codex: { signedIn: false }, agentConnected: true }), 'key');
  assert.equal(agentOf({ claude: { signedIn: false }, codex: { signedIn: false }, agentConnected: false }), null);
  assert.equal(agentOf(null), null);
  assert.deepEqual(studyCounts({ ok: true, at: '2026-10-25T12:00:00.000Z', days: 2, prompts: 9, 'bad key': 1, words: 'never', nested: { a: 1 }, builds: Number.NaN }), { days: 2, prompts: 9 });
});

async function looksRig({ drives = [['ana', 'running', 4500, 'study']], doorDrives = [{ name: 'ana', owner: 'acct_1', home: 'pchost', state: 'ready' }] } = {}) {
  const r = await rig({ drives, doorDrives });
  let t = Date.parse('2026-10-25T12:00:00Z');
  const looks = createLooks({ registry: r.registry, probe: r.probe, envs: r.envs, door: r.door, log: quiet, now: () => t });
  return { ...r, looks, advance: (ms) => (t += ms) };
}

test('looks: the agent, the day\'s turns and last active from /health/deep; the door hears its two firsts once, even after a restart of marble-host', async (t) => {
  const r = await looksRig();
  t.after(r.pc.cleanup);
  await r.looks.tick();
  assert.deepEqual(r.looks.row('ana'), { agent: null, turnsToday: null, lastActive: null, study: null });
  assert.deepEqual(r.fake.events, [], 'nothing yet to tell');
  assert.deepEqual(r.probe.asked.at(-1), ['/health/deep', 4500, SECRET]);

  r.probe.set(4500, { deep: { claude: { version: '2.1.281', signedIn: true }, agentConnected: true, docs: 1, turnsToday: 3, lastActive: '2026-10-25T11:59:00.000Z', heldBack: ['Start here'] } });
  await r.looks.tick();
  assert.deepEqual(r.looks.row('ana'), { agent: 'claude', turnsToday: 3, lastActive: '2026-10-25T11:59:00.000Z', study: null, heldBack: ['Start here'] });
  assert.deepEqual(r.fake.events, [{ drive: 'ana', kind: 'agent-connected', detail: { agent: 'claude' } }, { drive: 'ana', kind: 'first-document' }]);
  assert.ok(r.registry.drive('ana').told['agent-connected']);
  await r.looks.tick();
  const fresh = createLooks({ registry: r.registry, probe: r.probe, envs: r.envs, door: r.door, log: quiet });
  await fresh.tick();
  assert.equal(r.fake.events.length, 2, 'once each, across a restart');
});

test('looks: a door that can\'t be reached is told at the next look; one that refuses is not asked again; a drive the door didn\'t make tells it nothing', async (t) => {
  const r = await looksRig({ drives: [['ana', 'running', 4500], ['ben', 'running', 4501]], doorDrives: [{ name: 'ana', owner: 'acct_1', home: 'pchost', state: 'ready' }] });
  t.after(r.pc.cleanup);
  await r.registry.update((x) => {
    delete x.drives.ben.door;
  });
  r.probe.set(4500, { deep: { codex: { version: '0.159.3', signedIn: true }, agentConnected: true } });
  r.probe.set(4501, { deep: { agentConnected: true, docs: 4 } });
  r.fake.state.down = true;
  await r.looks.tick();
  assert.equal(r.registry.drive('ana').told, undefined);
  r.fake.state.down = false;
  await r.looks.tick();
  assert.deepEqual(r.fake.events, [{ drive: 'ana', kind: 'agent-connected', detail: { agent: 'chatgpt' } }]);
  assert.equal(r.looks.row('ben').agent, 'key');
  assert.ok(!r.fake.heard.some((h) => h.body?.drive === 'ben'), 'ben was made by hand');

  // A refusal (here: the door no longer knows ana) is final.
  r.fake.drives.length = 0;
  r.probe.set(4500, { deep: { codex: { version: '0.159.3', signedIn: true }, agentConnected: true, docs: 1 } });
  await r.looks.tick();
  assert.ok(r.registry.drive('ana').told['first-document']);
  const asked = r.fake.heard.length;
  await r.looks.tick();
  assert.equal(r.fake.heard.length, asked);
});

test('looks: /health/study only for a drive in the study, at most every ten minutes, counts only; leaving drops them', async (t) => {
  const r = await looksRig({ drives: [['ana', 'running', 4500, 'study'], ['ben', 'running', 4501]] });
  t.after(r.pc.cleanup);
  const counts = { at: '2026-10-25T11:55:00.000Z', days: 2, prompts: 9, builds: 1, marks: 5, buttons: 4, conversations: 4, singlePromptConversations: 1, promptsWhileAnotherWorked: 5 };
  r.probe.set(4500, { study: counts });
  r.probe.set(4501, { study: counts });
  await r.looks.tick();
  assert.equal(r.looks.row('ana').study, null, 'MARBLE_STUDY alone is not consent');
  await r.envs.update('ana', { MARBLE_CONSENT: '2026-11-irb-v1@2026-10-25T11:00:00.000Z' });
  await r.looks.tick();
  const { at, ...rest } = counts;
  assert.deepEqual(r.looks.row('ana').study, { counts: rest, at });
  assert.equal(r.looks.row('ben').study, null);
  const studyAsks = () => r.probe.asked.filter(([route]) => route === '/health/study').map(([, port]) => port);
  assert.deepEqual(studyAsks(), [4500], 'never ben, outside the study');
  r.advance(5 * 60 * 1000);
  await r.looks.tick();
  assert.deepEqual(studyAsks(), [4500], 'not again within ten minutes');
  r.advance(5 * 60 * 1000);
  await r.looks.tick();
  assert.deepEqual(studyAsks(), [4500, 4500]);
  await r.envs.update('ana', { MARBLE_STUDY: null, MARBLE_CONSENT: null });
  await r.looks.tick();
  assert.equal(r.looks.row('ana').study, null);
});

// ------------------------------------------------- with the door's own code

/** The door's Directory in memory, behind a fetch that speaks to it as
 *  marble-host would through the Worker (which checks the token first). */
function realDoor() {
  const object = new Directory({ storage: memoryStorage() }, { MAX_DRIVES: '10' });
  let t = Date.parse('2026-10-25T12:00:00Z');
  object.core.now = () => t;
  const heard = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    assert.equal(init.headers.authorization, 'Bearer door-token');
    heard.push(`${init.method ?? 'GET'} ${u.pathname}`);
    return object.fetch(new Request(`https://directory${u.pathname.replace(/^\/_door/, '')}${u.search}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json' }, body: init.body }));
  };
  const call = async (method, p, body) => {
    const res = await object.fetch(new Request(`https://directory${p}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
    return { status: res.status, data: await res.json() };
  };
  return { fetchImpl, call, heard, tick: () => (t += 60_000) };
}

test('with the door\'s own Directory: made from its queue, in the study, its firsts in her timeline, out of the study, and deleted from the PC', async (t) => {
  const door = realDoor();
  // Ana: a study invite, signed in, a yes, and her drive's name.
  const invite = (await door.call('POST', '/invite', { study: true, note: 'Ana' })).data;
  const { account } = (await door.call('POST', '/identity', { provider: 'google', subject: 'sub-ana', email: 'ana@example.com', name: 'Ana Lima', invite: invite.code })).data;
  door.tick();
  assert.equal((await door.call('POST', '/consent', { account: account.id, version: '2026-11-irb-v1', choice: 'given' })).status, 200);
  door.tick();
  assert.equal((await door.call('POST', '/drive', { account: account.id, name: 'ana', home: 'pchost' })).status, 200);

  const pc = await scratchPc({ doorAdminToken: 'door-token' });
  t.after(pc.cleanup);
  const registry = await openRegistry({ dir: pc.state });
  const envs = createGuestEnvs({ dir: pc.guestEnvDir });
  const units = fakeUnits();
  const probe = fakeProbe();
  probe.set(4500);
  const client = createDoor({ url: 'https://door.test', token: 'door-token', fetchImpl: door.fetchImpl });
  const maker = createMaker({ settings: pc.settings, registry, units, envs, probe, door: client, log: quiet, inUse: async () => false, checkMs: 50 });
  const remover = createRemover({ registry, units, envs, probe, door: client, log: quiet });
  const reconciler = createReconciler({ registry, envs, door: client, remover, log: quiet });
  const looks = createLooks({ registry, probe, envs, door: client, log: quiet });

  assert.deepEqual(await maker.drain(), { idle: true, made: 1 });
  assert.equal(registry.drive('ana').state, 'running');
  assert.equal(registry.drive('ana').cohort, 'study');
  assert.equal((await door.call('GET', '/drives/ana')).data.state, 'ready');

  await reconciler.tick();
  const env = await envs.read('ana');
  assert.equal(env.MARBLE_STUDY, '1');
  assert.match(env.MARBLE_CONSENT, /^2026-11-irb-v1@2026-10-25T12:01:00\.000Z$/);

  probe.set(4500, { deep: { claude: { version: '2.1.281', signedIn: true }, agentConnected: true, docs: 1 } });
  await looks.tick();
  await looks.tick();
  const row = (await door.call('GET', '/people')).data.people[0];
  assert.match(row.timeline.agentConnected, /^2026-10-25T/);
  assert.match(row.timeline.firstDocument, /^2026-10-25T/);
  const log = (await door.call('GET', '/log')).data.lines;
  assert.equal(log.filter((l) => l.kind === 'agent-connected').length, 1);
  assert.equal(log.find((l) => l.kind === 'agent-connected').detail.agent, 'claude');

  // The owner's Withdraw: out of the study at the next look.
  assert.equal((await door.call('POST', `/accounts/${account.id}/withdraw`)).status, 200);
  await reconciler.tick();
  assert.equal((await envs.read('ana')).MARBLE_CONSENT, undefined);
  assert.equal((await envs.read('ana')).MARBLE_STUDY, undefined);

  // She deletes her drive from the account page; the next look takes it off the PC.
  assert.equal((await door.call('POST', '/drives/ana/delete', { account: account.id, confirm: 'ana' })).status, 200);
  const done = await reconciler.tick();
  assert.deepEqual(done.removed, ['ana']);
  assert.equal(registry.drive('ana').state, 'removed');
  assert.deepEqual(units.calls.slice(-2), ['stop ana', 'remove ana']);
  assert.ok(probe.asked.some(([route]) => route === '/health/logout'));
  const record = (await door.call('GET', '/drives/ana')).data;
  assert.equal(record.state, 'removed', 'the record stays, so the name is never given out again');
  assert.equal((await door.call('GET', '/log')).data.lines.filter((l) => l.kind === 'drive-removed').length, 1);
});
