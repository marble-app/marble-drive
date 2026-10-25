// The Console's people on the PC (server/console/pchost.js), against a fake
// door and a fake marble-host: the three sources join into one list, no token,
// invite code, email or address reaches the page, every action is a job that
// asks the right one of the two, and the updater's routes are shown
// unavailable with marble-host's own reason.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { createJobs } from '../server/console/jobs.js';
import { createPcHost, joinPeople, readSettings, UPDATER_WHY } from '../server/console/pchost.js';
import { DOOR_TOKEN, HOST_TOKEN, ago, drives, fakeDoor, fakeHost, lines, pcFiles, people } from './fixtures/console-pc.js';
import { fakeFleet, probe } from './fixtures/console-fleet.js';

const quiet = { log() {}, error() {}, info() {} };

async function setup({ door: withDoor = true, host: withHost = true, statuses, updaterWhy } = {}) {
  const door = withDoor ? await fakeDoor() : null;
  const host = withHost ? await fakeHost() : null;
  const files = await pcFiles({ door, host, statuses });
  const jobsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-pc-jobs-'));
  const jobs = createJobs({ dir: jobsDir });
  await jobs.ready();
  const pc = createPcHost({ hostEnv: files.hostEnv, doorEnv: files.doorEnv, statusDir: files.statusDir, jobs, ...(updaterWhy === undefined ? {} : { updaterWhy }) });
  const close = async () => {
    jobs.close();
    await door?.close();
    await host?.close();
  };
  return { door, host, files, jobs, jobsDir, pc, close };
}

const settle = async (jobs, id) => {
  for (let i = 0; i < 300; i += 1) {
    const job = jobs.get(id);
    if (job && job.state !== 'running') return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('job never settled');
};

const row = (view, key) => view.rows.find((r) => r.key === key);

test('with neither settings file the people are off, and a file others can read is refused', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-pc-none-'));
  const jobs = createJobs({ dir });
  await jobs.ready();
  const pc = createPcHost({ hostEnv: path.join(dir, 'host.env'), doorEnv: path.join(dir, 'door.env'), statusDir: dir, jobs });
  assert.deepEqual(await pc.read(), { on: false });
  assert.deepEqual(readSettings({}), { host: null, door: null }, 'a checkout pointed at nothing reads nothing');
  await assert.rejects(pc.invite({ note: 'Ana' }), /there is no door.env on this machine/);

  fs.writeFileSync(path.join(dir, 'door.env'), `DOOR_URL=https://marbledrive.app\nDOOR_ADMIN_TOKEN=${DOOR_TOKEN}\n`, { mode: 0o644 });
  fs.chmodSync(path.join(dir, 'door.env'), 0o644);
  const view = await pc.read();
  assert.equal(view.on, true);
  assert.equal(view.door.ok, false);
  assert.equal(view.door.why, 'door.env can be read by others; chmod 600 it first');
  assert.equal(view.host, null, 'no host.env: no marble-host side at all');
  fs.writeFileSync(path.join(dir, 'host.env'), 'HOST_ROUTER_PORT=4460\n', { mode: 0o600 });
  fs.chmodSync(path.join(dir, 'host.env'), 0o600);
  assert.equal((await pc.read()).host.why, 'host.env has no HOST_ADMIN_TOKEN');
  jobs.close();
});

test('the door’s people, marble-host’s drives and the backups join into one list', async (t) => {
  const s = await setup();
  t.after(s.close);
  const view = await s.pc.read();
  assert.equal(view.on, true);
  assert.deepEqual([view.door.ok, view.host.ok], [true, true]);
  // Drives by name, then the people on their way; Fly's eve and the removed
  // fay are not here, and hal, made by hand, is.
  assert.deepEqual(view.rows.map((r) => r.key), ['ana', 'ben', 'cho', 'hal', 'invite:inv-dee', 'invite:inv-gus']);
  assert.deepEqual(view.counts, { drives: 4, working: 1, invites: 1 });

  const ana = row(view, 'ana');
  assert.equal(ana.stage, 'using');
  assert.equal(ana.status, 'working');
  assert.equal(ana.agent, 'claude');
  assert.equal(ana.turnsToday, 12);
  assert.equal(ana.person, 'Ana');
  assert.equal(ana.study.inStudy, true);
  assert.equal(ana.study.consent.version, '2026-11-irb-v1');
  assert.deepEqual(ana.study.counts, { days: 3, prompts: 41, builds: 9, marks: 6, buttons: 5, conversations: 7, singlePromptConversations: 2, promptsWhileAnotherWorked: 4 }, 'counts only, under the drive\'s own names: a word is dropped');
  assert.equal(ana.host.memoryBytes, 412_000_000);
  assert.equal(ana.host.restarts, 2);
  assert.equal(ana.host.release, '20261025T161133Z-4b2103a');
  assert.deepEqual(ana.heldBack, ['Start here']);
  assert.equal(ana.backup.ok, true);
  assert.equal(ana.backup.files, 214);
  assert.ok(ana.timeline.firstDocument && ana.timeline.invited);

  const ben = row(view, 'ben');
  assert.equal(ben.agent, 'chatgpt');
  assert.equal(ben.stage, 'using', 'turns today mean it is in use, though the door has no first document yet');
  assert.equal(ben.study.inStudy, false);
  assert.deepEqual([ben.backup.ok, ben.backup.why], [false, 'R2 could not be reached']);

  const cho = row(view, 'cho');
  assert.equal(cho.agent, 'none', 'marble-host says no agent');
  assert.equal(cho.stage, 'no-agent');
  assert.equal(cho.status, 'stalled', 'ready two days ago and nothing since');
  assert.equal(cho.backup, null, 'no status file is no backup yet');

  const hal = row(view, 'hal');
  assert.equal(hal.door, null, 'the door doesn’t know it');
  assert.equal(hal.agent, null, 'not known: marble-host gave no agent');
  assert.equal(hal.host.channel, 'canary');
  assert.equal(hal.study.inStudy, false);
  assert.equal(hal.stage, 'ready', 'ready, and no claim about an agent nobody reported');

  const dee = row(view, 'invite:inv-dee');
  assert.equal(dee.label, 'Dee');
  assert.equal(dee.drive, null);
  assert.equal(dee.stage, 'invited');
  assert.equal(dee.status, 'waiting');
  assert.equal(dee.study.invited, true);

  const gus = row(view, 'invite:inv-gus');
  assert.equal(gus.stage, 'consent');
  assert.equal(gus.status, 'idle', 'signed in twenty minutes ago is not stalled');
  assert.equal(gus.person, null);
  assert.equal(gus.label, 'Gus');

  // The People list: the door's log in kinds and names, newest first, only
  // about these people; the owner's sign-in and Fly's eve are not there.
  assert.deepEqual(view.activity.map((l) => [l.kind, l.who]), [
    ['first-document', 'ana'],
    ['signed-in', 'ana'],
    ['agent-connected', 'ben'],
    ['drive-updated', 'ana'],
    ['invite-made', 'Dee'],
    ['account-made', 'cho'],
    ['consent-given', 'ana'],
  ]);
  assert.equal(view.activity.find((l) => l.kind === 'agent-connected').agent, 'chatgpt');
  assert.equal(view.activity.find((l) => l.kind === 'invite-made').study, true);
  assert.deepEqual(Object.keys(view.activity[1]).sort(), ['at', 'key', 'kind', 'who']);
  assert.deepEqual(view.updater, { available: false, why: "the updater isn't built yet" });
});

test('no token, invite code, email, address or account reaches the page', async (t) => {
  const s = await setup();
  t.after(s.close);
  const view = JSON.stringify(await s.pc.read());
  for (const secret of [DOOR_TOKEN, HOST_TOKEN, 'never-read-by-the-console']) assert.ok(!view.includes(secret), 'no token');
  for (const email of ['ana@example.com', 'ben@example.com', '@example.com']) assert.ok(!view.includes(email), 'no email');
  for (const ip of ['203.0.113.9', '198.51.100.1', '192.0.2.44']) assert.ok(!view.includes(ip), 'no address');
  assert.ok(!view.includes('a000000000000001'), 'no account id');
  assert.ok(!view.includes('Lopez'), 'a first name at most');
  assert.ok(!view.includes('never shown'), 'nothing a drive said in words');
  assert.ok(!view.includes('/join/'), 'no invite link');
  // The bearer goes to each with its own token, and only there.
  assert.ok(s.door.calls.every((c) => c.auth === `Bearer ${DOOR_TOKEN}`));
  assert.ok(s.host.calls.every((c) => c.auth === `Bearer ${HOST_TOKEN}`));
});

test('an invite comes back with its link once, and the link is kept nowhere', async (t) => {
  const s = await setup();
  t.after(s.close);
  await assert.rejects(s.pc.invite({ note: '  ' }), /a name is needed/);
  const made = await s.pc.invite({ note: 'Ivy', study: true });
  const { code } = s.door.state.invites[0];
  assert.equal(made.link, `https://marbledrive.app/join/${code}`);
  assert.deepEqual([made.invite.note, made.invite.study], ['Ivy', true]);
  assert.ok(made.invite.expires);
  const asked = s.door.calls.find((c) => c.url === '/_door/invite');
  assert.deepEqual(asked.body, { note: 'Ivy', uses: 1, days: 14, study: true });
  const job = await settle(s.jobs, made.job.id);
  assert.equal(job.state, 'done');
  assert.equal(job.title, 'Invite Ivy into the study');
  assert.equal(job.target, null, 'an invite waits for nothing');
  const out = await s.jobs.output(job.id);
  assert.match(out, /One link for Ivy, in the study, good until \d{4}-\d{2}-\d{2}\. It was shown once/);
  await new Promise((r) => setTimeout(r, 50));
  const kept = [out, JSON.stringify(s.jobs.list()), await fsp.readFile(path.join(s.jobsDir, 'jobs.json'), 'utf8')].join('\n');
  assert.ok(!kept.includes(code), 'not in the output, the record or the file');
  assert.ok(!JSON.stringify(await s.pc.read()).includes(code), 'not in the list');

  s.door.state.mode = 'broken';
  await assert.rejects(s.pc.invite({ note: 'Jo' }), (err) => {
    assert.match(err.message, /the door: the directory is busy/);
    assert.equal(err.job.state === 'failed' || err.job.state === 'running', true);
    return true;
  });
});

test('each action is a job on its drive: marble-host’s verbs, export, and remove through the door', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.pc.read();
  const posted = (url) => s.host.calls.filter((c) => c.method === 'POST' && c.url === url);

  const restart = await s.pc.act('ana', 'restart');
  assert.deepEqual([restart.kind, restart.target, restart.title], ['pc-restart', 'pc:ana', 'Restart ana']);
  assert.equal((await settle(s.jobs, restart.id)).state, 'done');
  assert.equal(posted('/drives/ana/restart').length, 1);
  assert.match(await s.jobs.output(restart.id), /==> asking marble-host to restart ana\nana is running, 3 restarts so far\./);

  // One at a time on a drive: a second action waits for the first to end.
  s.host.state.slow.suspend = 400;
  const suspend = await s.pc.act('ben', 'suspend');
  await assert.rejects(s.pc.act('ben', 'resume'), (err) => err.status === 409 && /pc:ben is busy: Suspend ben/.test(err.message));
  assert.equal((await settle(s.jobs, suspend.id)).state, 'done');
  assert.match(await s.jobs.output(suspend.id), /ben is suspended\. It stays stopped/);
  // marble-host's refusal is the job's failure, in its words.
  const again = await s.pc.act('ben', 'restart');
  const refused = await settle(s.jobs, again.id);
  assert.equal(refused.state, 'failed');
  assert.equal(refused.error, 'marble-host: ben is suspended; resume it instead');
  assert.equal((await settle(s.jobs, (await s.pc.act('ben', 'resume')).id)).state, 'done');

  const backup = await s.pc.act('cho', 'backup');
  assert.equal((await settle(s.jobs, backup.id)).state, 'done');
  assert.equal(posted('/drives/cho/backup').length, 1);

  // Export only with consent on file, and marble-host's helper does it.
  await assert.rejects(s.pc.act('ben', 'export'), /ben isn't in the study, so nothing of it is exported/);
  await assert.rejects(s.pc.act('hal', 'export'), /isn't in the study/, 'a drive the door doesn’t know is never in it');
  const exported = await s.pc.act('ana', 'export');
  assert.equal(exported.title, "Export ana's study data");
  assert.equal((await settle(s.jobs, exported.id)).state, 'done');
  assert.equal(posted('/drives/ana/export').length, 1);
  assert.match(await s.jobs.output(exported.id), /Research\/Probe study\/ana\//);
  s.host.state.missing.push('export');
  const early = await settle(s.jobs, (await s.pc.act('ana', 'export')).id);
  assert.equal(early.error, 'marble-host: no such route', 'a marble-host without export says so');

  // Remove asks for the name, and goes through the door when the door knows
  // the drive; marble-host finishes it. A drive made by hand goes to
  // marble-host itself.
  await assert.rejects(s.pc.act('cho', 'remove', { confirm: 'ch' }), /type cho to remove it/);
  const removed = await s.pc.act('cho', 'remove', { confirm: 'cho' });
  assert.equal((await settle(s.jobs, removed.id)).state, 'done');
  assert.deepEqual(s.door.calls.find((c) => c.url === '/_door/drives/cho/remove').body, { confirm: 'cho' });
  assert.equal(posted('/drives/cho/remove').length, 0, 'marble-host is not asked to stop it before its agents sign out');
  assert.match(await s.jobs.output(removed.id), /cho is removed at the door, and 2 sessions of its person ended\./);
  assert.equal(row(await s.pc.read(), 'cho').stage, 'removing');
  await assert.rejects(s.pc.act('cho', 'remove', { confirm: 'cho' }), /already being removed/);
  const byHand = await s.pc.act('hal', 'remove', { confirm: 'hal' });
  assert.equal((await settle(s.jobs, byHand.id)).state, 'done');
  assert.deepEqual(posted('/drives/hal/remove')[0].body, { confirm: 'hal' });

  await assert.rejects(s.pc.act('nobody', 'restart'), /there is no drive nobody on the PC/);
  await assert.rejects(s.pc.act('../etc', 'restart'), /not a drive’s name/);
  await assert.rejects(s.pc.act('ana', 'format'), /no such action/);
});

test('Move to canary and Roll back are unavailable until the updater exists, saying why', async (t) => {
  assert.equal(UPDATER_WHY, "the updater isn't built yet", 'marble-host’s own words (server/host/admin.js)');
  const s = await setup();
  t.after(s.close);
  await s.pc.read();
  for (const verb of ['canary', 'rollback']) {
    await assert.rejects(s.pc.act('ana', verb), (err) => err.status === 501 && err.message === "Unavailable: the updater isn't built yet");
  }
  assert.equal(s.host.calls.filter((c) => c.method === 'POST').length, 0, 'nothing was asked');

  // Once the updater exists, both are asked of marble-host, and a 501 from it
  // is the job's failure in its words.
  const built = await setup({ updaterWhy: null });
  t.after(built.close);
  const view = await built.pc.read();
  assert.deepEqual(view.updater, { available: true, why: null });
  const back = await settle(built.jobs, (await built.pc.act('ana', 'rollback')).id);
  assert.equal(back.error, "marble-host: the updater isn't built yet");
  assert.deepEqual(built.host.calls.find((c) => c.url === '/rollback').body, { name: 'ana' });
  const moved = await settle(built.jobs, (await built.pc.act('ana', 'canary')).id);
  assert.equal(moved.state, 'done');
  assert.deepEqual(built.host.calls.find((c) => c.url === '/drives/ana/channel').body, { channel: 'canary' });
});

test('a door or marble-host that can’t be read is said in words, and the last list stays', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.equal((await s.pc.read()).rows.length, 6);
  s.door.state.mode = 'html';
  let view = await s.pc.read();
  assert.equal(view.door.ok, false);
  assert.equal(view.door.why, 'the door answered 200 without JSON: is its admin API deployed?');
  assert.equal(view.rows.length, 6, 'the last good list is kept');
  s.door.state.mode = 'ok';
  await s.host.close();
  view = await s.pc.read();
  assert.match(view.host.why, /^marble-host isn't answering on 127\.0\.0\.1:\d+$/);
  assert.equal(view.door.ok, true);

  const wrong = await setup();
  t.after(wrong.close);
  fs.writeFileSync(wrong.files.doorEnv, `DOOR_URL=${wrong.door.url}\nDOOR_ADMIN_TOKEN=not-the-token\n`, { mode: 0o600 });
  view = await wrong.pc.read();
  assert.equal(view.door.why, 'the door refused the admin token in door.env');
  assert.ok(!JSON.stringify(view).includes('not-the-token'));

  // marble-host alone: its drives, with nothing from the door.
  const alone = await setup({ door: false });
  t.after(alone.close);
  view = await alone.pc.read();
  assert.equal(view.door, null);
  assert.deepEqual(view.rows.map((r) => r.key), ['ana', 'ben', 'cho', 'hal']);
  assert.equal(row(view, 'ana').study.inStudy, false, 'without the door, nobody is known to be in the study');
});

test('joining by itself: a ready drive marble-host doesn’t have is missing, and a stall needs a day', () => {
  const now = Date.now();
  const ps = people();
  const ds = drives().filter((d) => d.name !== 'ben');
  const { rows } = joinPeople({ people: ps, drives: ds, lines: lines(), now });
  assert.equal(rows.find((r) => r.key === 'ben').stage, 'missing');
  const unknown = joinPeople({ people: ps, drives: null, lines: lines(), now }).rows;
  assert.equal(unknown.find((r) => r.key === 'ben').stage, 'no-document', 'without marble-host, the door’s timeline says how far');
  assert.equal(unknown.find((r) => r.key === 'ben').agent, 'chatgpt', 'from the door’s log');
  assert.equal(unknown.find((r) => r.key === 'ana').agent, 'some', 'connected, but the log didn’t say which');
  const other = drives().map((d) => (d.name === 'cho' ? { ...d, agent: 'cursor' } : d));
  assert.equal(joinPeople({ people: ps, drives: other, now }).rows.find((r) => r.key === 'cho').agent, 'some', 'an agent this page doesn’t know is still an agent');
  const fresh = ps.map((p) => (p.drive?.name === 'cho' ? { ...p, timeline: { ...p.timeline, ready: ago(60 * 3) } } : p));
  assert.equal(joinPeople({ people: fresh, drives: ds, now }).rows.find((r) => r.key === 'cho').status, 'idle');
});

test('the Console’s routes carry the people, an invite’s link only in its answer, and no token', async (t) => {
  const door = await fakeDoor();
  const host = await fakeHost();
  const files = await pcFiles({ door, host });
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-pc-host-'));
  const fleet = await fakeFleet({ probe: { 't-sam': probe('t-sam') } });
  const config = loadConfig({
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_SECRET: 'pw-1234',
    MARBLE_DRIVE_CONSOLE: '1',
    MARBLE_DRIVE_CONSOLE_SPRITE: fleet.bin,
    MARBLE_DRIVE_CONSOLE_SRC: path.join(root, '..', `${path.basename(root)}-src`),
    MARBLE_DRIVE_CONSOLE_SELF: 'admin-p1',
    MARBLE_DRIVE_CONSOLE_HOST_ENV: files.hostEnv,
    MARBLE_DRIVE_CONSOLE_DOOR_ENV: files.doorEnv,
    MARBLE_DRIVE_CONSOLE_BACKUP_STATUS: files.statusDir,
  });
  const drive = await createDrive(config, { log: quiet, agents: false });
  t.after(async () => {
    await drive.close();
    await door.close();
    await host.close();
  });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const gate = await fetch(`${base}/gate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'pw-1234' }) });
  const cookie = (gate.headers.get('set-cookie') ?? '').split(';')[0];
  const call = (route, { method = 'GET', body } = {}) => fetch(`${base}${route}`, {
    method,
    headers: { cookie, Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  const state = await (await call('/console/api/state')).json();
  assert.equal(state.people.on, true);
  assert.deepEqual(state.people.rows.map((r) => r.key), ['ana', 'ben', 'cho', 'hal', 'invite:inv-dee', 'invite:inv-gus']);
  const made = await (await call('/console/api/people/invite', { method: 'POST', body: { note: 'Ivy', study: true } })).json();
  const { code } = door.state.invites[0];
  assert.equal(made.link, `https://marbledrive.app/join/${code}`);
  const job = await (await call('/console/api/people/ana/restart', { method: 'POST' })).json();
  assert.equal(job.target, 'pc:ana');
  for (let i = 0; i < 100 && !(await (await call(`/console/api/jobs/${job.id}`)).json()).endedAt; i += 1) await new Promise((r) => setTimeout(r, 20));
  const after = JSON.stringify([await (await call('/console/api/state')).json(), await (await call('/console/api/people')).json()]);
  for (const secret of [DOOR_TOKEN, HOST_TOKEN, code, 'ana@example.com', '203.0.113.9']) assert.ok(!after.includes(secret));
  assert.equal((await call('/console/api/people/ana/rollback', { method: 'POST' })).status, 501);
  assert.equal((await fetch(`${base}/console/api/people/ana/restart`, { method: 'POST', headers: { cookie, Origin: 'https://evil.example' } })).status, 403);
});
