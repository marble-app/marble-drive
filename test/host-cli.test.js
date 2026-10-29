// tools/pc-host.mjs: init writes host.env with only what it lacks, mode 600,
// and never prints a secret (always against a temporary HOME); every other
// command asks marble-host's admin API (a stand-in here) with the token from
// host.env; and the updater's four commands say it isn't built and exit 1.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { init, main } from '../tools/pc-host.mjs';
import { tempDirs } from './fixtures/host.js';

const temp = tempDirs();
after(temp.cleanup);

async function tempHome() {
  const home = await temp.make('pc-host-home-');
  const dir = path.join(home, '.config', 'marble-drive');
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  return { home, dir, file: path.join(dir, 'host.env') };
}

const doorKey = () => `k1:${crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`;
const read = async (file) => Object.fromEntries((await fsp.readFile(file, 'utf8')).split('\n').filter((l) => /^[A-Z]/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

async function run(argv, opts) {
  const out = [];
  const err = [];
  const code = await main(argv, { env: {}, out: (l) => out.push(l), err: (l) => err.push(l), ...opts });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('init: random keys, the door\'s token and keys copied, the alert topic, the defaults; mode 600; no secret printed', async () => {
  const h = await tempHome();
  const k1 = doorKey();
  const k2 = doorKey();
  await fsp.writeFile(path.join(h.dir, 'door.env'), 'DOOR_URL=https://marbledrive.app\nDOOR_ADMIN_TOKEN=door-admin-secret\n', { mode: 0o600 });
  await fsp.writeFile(path.join(h.dir, 'door-keys'), `${k1}\n${k2}\n`, { mode: 0o600 });
  await fsp.writeFile(path.join(h.dir, 'ntfy-topic'), 'marble-0123456789abcdef\n', { mode: 0o600 });
  const res = await run(['init'], { home: h.home });
  assert.equal(res.code, 0, res.err);
  assert.equal((await fsp.stat(h.file)).mode & 0o777, 0o600);
  const env = await read(h.file);
  assert.match(env.HOST_KEY, /^[0-9a-f]{64}$/);
  assert.match(env.HOST_ADMIN_TOKEN, /^[0-9a-f]{64}$/);
  assert.notEqual(env.HOST_KEY, env.HOST_ADMIN_TOKEN);
  assert.equal(env.DOOR_ADMIN_TOKEN, 'door-admin-secret');
  assert.equal(env.MARBLE_DOOR_KEYS, `${k1} ${k2}`, 'the keys on one line, one space between');
  assert.equal(env.HOST_NTFY_URL, 'https://ntfy.sh/marble-0123456789abcdef');
  assert.equal(env.HOST_OWNER_NAME, 'Bryan');
  assert.equal(env.HOST_MODE, 'system');
  assert.equal(env.HOST_ROUTER_PORT, '4460');
  assert.equal(env.HOST_ADMIN_PORT, '4461');
  assert.equal(env.HOST_GUEST_PORTS, '4500-4599');
  assert.equal(env.DOOR_URL, 'https://marbledrive.app');
  for (const secret of [env.HOST_KEY, env.HOST_ADMIN_TOKEN, 'door-admin-secret', k1, 'marble-0123456789abcdef']) {
    assert.ok(!res.out.includes(secret) && !res.err.includes(secret), 'a secret was printed');
  }
  assert.match(res.out, /HOST_KEY +made/);
  assert.match(res.out, /DOOR_ADMIN_TOKEN +from door\.env/);
});

test('init again changes no value, fills in only what is missing or empty, and keeps what the owner wrote', async () => {
  const h = await tempHome();
  await fsp.writeFile(h.file, '# mine\nHOST_KEY=keep-this-key\nHOST_MODE=user\nHOST_NTFY_URL=\nEXTRA=1\n', { mode: 0o600 });
  const first = await run(['init'], { home: h.home });
  assert.equal(first.code, 0, first.err);
  let env = await read(h.file);
  assert.equal(env.HOST_KEY, 'keep-this-key');
  assert.equal(env.HOST_MODE, 'user');
  assert.equal(env.EXTRA, '1');
  assert.equal(env.HOST_NTFY_URL, '', 'no topic yet: left as it was');
  assert.equal(env.DOOR_ADMIN_TOKEN, undefined, 'no door.env: not written, so a later init can add it');
  assert.match(first.out, /DOOR_ADMIN_TOKEN +not set: door\.env has none/);
  assert.match((await fsp.readFile(h.file, 'utf8')).split('\n')[0], /^# mine$/);

  await fsp.writeFile(path.join(h.dir, 'ntfy-topic'), 'marble-aaaa\n', { mode: 0o600 });
  await fsp.writeFile(path.join(h.dir, 'door.env'), 'DOOR_ADMIN_TOKEN=later\n', { mode: 0o600 });
  const admin = env.HOST_ADMIN_TOKEN;
  await run(['init'], { home: h.home });
  env = await read(h.file);
  assert.equal(env.HOST_NTFY_URL, 'https://ntfy.sh/marble-aaaa', 'the empty line filled in where it stood');
  assert.equal(env.DOOR_ADMIN_TOKEN, 'later');
  assert.equal(env.HOST_ADMIN_TOKEN, admin, 'not made again');
  assert.equal(env.HOST_KEY, 'keep-this-key');
  const lines = (await fsp.readFile(h.file, 'utf8')).split('\n').filter((l) => l.startsWith('HOST_NTFY_URL='));
  assert.equal(lines.length, 1, 'never a second line for one setting');
});

test('init refuses a settings file others can read, and door keys or a topic that are not what they should be', async () => {
  const h = await tempHome();
  await fsp.writeFile(h.file, 'HOST_KEY=x\n', { mode: 0o644 });
  await fsp.chmod(h.file, 0o644);
  let res = await run(['init'], { home: h.home });
  assert.equal(res.code, 1);
  assert.match(res.err, /host\.env can be read by others; chmod 600 it first/);
  await fsp.chmod(h.file, 0o600);
  await fsp.writeFile(path.join(h.dir, 'door.env'), 'DOOR_ADMIN_TOKEN=t\n', { mode: 0o644 });
  await fsp.chmod(path.join(h.dir, 'door.env'), 0o644);
  res = await run(['init'], { home: h.home });
  assert.equal(res.code, 1);
  assert.match(res.err, /door\.env can be read by others/);
  await fsp.rm(path.join(h.dir, 'door.env'));
  await fsp.writeFile(path.join(h.dir, 'door-keys'), 'k1:not-a-key\n', { mode: 0o600 });
  res = await run(['init'], { home: h.home });
  assert.equal(res.code, 1);
  assert.match(res.err, /door-keys: key k1 is not base64/);
  await fsp.rm(path.join(h.dir, 'door-keys'));
  await fsp.writeFile(path.join(h.dir, 'ntfy-topic'), 'has spaces in it\n', { mode: 0o600 });
  res = await run(['init'], { home: h.home });
  assert.equal(res.code, 1);
  assert.match(res.err, /ntfy-topic is not a topic name/);
  assert.equal((await read(h.file)).HOST_KEY, 'x', 'nothing written by a refused init');
});

test('init makes the settings folder when there is none', async () => {
  const home = await temp.make('pc-host-bare-');
  const done = init({ home, out() {} });
  assert.ok(done.length >= 12);
  const stat = await fsp.stat(path.join(home, '.config', 'marble-drive'));
  assert.equal(stat.mode & 0o777, 0o700);
});

/** marble-host's admin API, stood in for: what was asked, and canned answers. */
function fakeApi(answers) {
  const asked = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    asked.push({ method: init.method, route: u.pathname + u.search, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null, port: u.port });
    const answer = answers[`${init.method} ${u.pathname}`];
    if (!answer) return Response.json({ why: 'no such route' }, { status: 404 });
    const [status, body] = typeof answer === 'function' ? answer(init) : answer;
    return Response.json(body, { status });
  };
  return { asked, fetchImpl };
}

async function withSettings() {
  const h = await tempHome();
  await fsp.writeFile(h.file, 'HOST_ADMIN_TOKEN=the-admin-token\nHOST_ADMIN_PORT=4471\nHOST_ROUTER_PORT=4470\nHOST_MODE=user\nHOST_OPT=/var/tmp/x/opt\n', { mode: 0o600 });
  return h;
}

const ANA = { name: 'ana', port: 4500, owner: 'acct_1', channel: 'everyone', release: '20261025T161133Z-4b2103a', state: 'running', active: 'active', memoryBytes: 150 * 2 ** 20, health: { ok: true, working: 1, release: '20261025T161133Z-4b2103a', at: '2026-10-25T12:00:00Z' }, restarts: 0, created: '2026-10-25T11:00:00Z', cohort: null, agent: 'claude', study: null, backup: { at: '2026-10-25T17:00:03Z', ok: true, lastGood: '2026-10-25T17:00:03Z' } };

test('status: up, the release new drives get, and how many run', async () => {
  const h = await withSettings();
  const api = fakeApi({
    'GET /drives': [200, { drives: [ANA, { ...ANA, name: 'ben', state: 'suspended', active: 'inactive' }] }],
    'GET /releases': [200, { channels: { canary: null, everyone: null }, paused: false, onDisk: ['20261025T161133Z-4b2103a'], newDrives: { release: '20261025T161133Z-4b2103a', from: 'newest' } }],
  });
  const res = await run(['status'], { home: h.home, fetchImpl: api.fetchImpl });
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /marble-host is up on http:\/\/127\.0\.0\.1:4471 \(user mode; router on 127\.0\.0\.1:4470\)/);
  assert.match(res.out, /New drives get 20261025T161133Z-4b2103a \(the newest in .*\/releases\)/);
  assert.match(res.out, /1 of 1 running drive up, 1 suspended/);
  assert.ok(api.asked.every((a) => a.auth === 'Bearer the-admin-token' && a.port === '4471'));
  assert.ok(!res.out.includes('the-admin-token'));

  const empty = fakeApi({ 'GET /drives': [200, { drives: [] }], 'GET /releases': [200, { channels: {}, paused: false, onDisk: [], newDrives: { release: null, from: null } }] });
  assert.match((await run(['status'], { home: h.home, fetchImpl: empty.fetchImpl })).out, /No release is in .* so no drive can be made yet\. Putting one there is the updater's job/);

  const down = await run(['status'], { home: h.home, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(down.code, 1);
  assert.match(down.err, /marble-host isn't answering on http:\/\/127\.0\.0\.1:4471/);
});

test('drives, make, restart, suspend, resume, remove and events ask the API', async () => {
  const h = await withSettings();
  const api = fakeApi({
    'GET /drives': [200, { drives: [ANA] }],
    'POST /drives': [201, { drive: ANA }],
    'POST /drives/ana/restart': [200, { drive: ANA }],
    'POST /drives/ana/suspend': [200, { drive: { ...ANA, state: 'suspended' } }],
    'POST /drives/ana/resume': [200, { drive: ANA }],
    'POST /drives/ana/remove': [200, { drive: { ...ANA, state: 'removed' }, removal: { by: 'owner', claude: 'signed-out', codex: 'was-not-signed-in', folder: 'deleted', door: 'told' } }],
    'POST /drives/ana/export': [202, { drive: ANA, started: 'marble-guest-export@ana.service' }],
    'POST /drives/ana/backup': [202, { drive: ANA, started: 'marble-guest-backup@ana.service' }],
    'GET /events': [200, { events: [{ at: '2026-10-25T12:00:00Z', drive: 'ana', kind: 'made', detail: { port: 4500 } }] }],
  });
  const opts = { home: h.home, fetchImpl: api.fetchImpl };
  const listed = await run(['drives'], opts);
  assert.match(listed.out, /^name +state +service +port/);
  assert.match(listed.out, /ana +running +active +4500 +20261025T161133Z-4b2103a +150 MB +ok, 1 working +0 +claude +2026-10-25 17:00 +acct_1/);
  assert.equal((await run(['make', 'ana', '--owner', 'acct_1', '--cohort', 'study'], opts)).code, 0);
  assert.deepEqual(api.asked.at(-1).body, { name: 'ana', owner: 'acct_1', cohort: 'study' });
  const noOwner = await run(['make', 'ana'], opts);
  assert.equal(noOwner.code, 1);
  assert.match(noOwner.err, /make needs --owner/);
  for (const verb of ['restart', 'suspend', 'resume']) {
    const res = await run([verb, 'ana'], opts);
    assert.equal(res.code, 0, res.err);
    assert.equal(api.asked.at(-1).route, `/drives/ana/${verb}`);
  }
  assert.match((await run(['suspend', 'ana'], opts)).out, /ana is suspended/);
  const unconfirmed = await run(['remove', 'ana'], opts);
  assert.equal(unconfirmed.code, 2);
  assert.match(unconfirmed.err, /remove ana --confirm ana/);
  assert.notEqual(api.asked.at(-1).route, '/drives/ana/remove', 'nothing asked without the name typed');
  const removed = await run(['remove', 'ana', '--confirm', 'ana'], opts);
  assert.equal(removed.code, 0);
  assert.deepEqual(api.asked.at(-1).body, { confirm: 'ana' });
  assert.match(removed.out, /ana is removed: its folder is deleted from the PC, and the door knows\. Its encrypted backup stays until you forget it\./);
  const exported = await run(['export', 'ana'], opts);
  assert.equal(exported.code, 0, exported.err);
  assert.equal(api.asked.at(-1).route, '/drives/ana/export');
  assert.match(exported.out, /marble-guest-export@ana\.service is copying ana's study data into Research\/Probe study\/ana\//);
  const backedUp = await run(['backup', 'ana'], opts);
  assert.equal(backedUp.code, 0, backedUp.err);
  assert.equal(api.asked.at(-1).route, '/drives/ana/backup');
  assert.match(backedUp.out, /marble-guest-backup@ana\.service is backing ana up/);
  assert.equal((await run(['export'], opts)).code, 1, 'which drive?');
  const events = await run(['events', '--limit', '5'], opts);
  assert.equal(api.asked.at(-1).route, '/events?limit=5');
  assert.match(events.out, /made +ana +\{"port":4500\}/);
});

test('a refusal is said in marble-host\'s words, and a wrong token plainly', async () => {
  const h = await withSettings();
  const api = fakeApi({ 'POST /drives/ana/restart': [409, { why: 'ana is suspended; resume it instead' }], 'GET /drives': [401, { why: 'unauthorised' }] });
  const refused = await run(['restart', 'ana'], { home: h.home, fetchImpl: api.fetchImpl });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /pc-host: ana is suspended; resume it instead/);
  const wrong = await run(['drives'], { home: h.home, fetchImpl: api.fetchImpl });
  assert.match(wrong.err, /refused the admin token in host\.env/);
});

test('release, promote, rollback and pause say the updater isn\'t built yet, and exit 1 without asking anything', async () => {
  const h = await withSettings();
  const api = fakeApi({});
  for (const argv of [['release'], ['release', '20261025T161133Z-4b2103a'], ['promote'], ['rollback'], ['rollback', 'ana'], ['pause', 'on'], ['pause', 'off']]) {
    const res = await run(argv, { home: h.home, fetchImpl: api.fetchImpl });
    assert.equal(res.code, 1, argv.join(' '));
    assert.match(res.err, /the updater isn't built yet/);
  }
  assert.equal(api.asked.length, 0);
});

test('without host.env, or with one others can read, nothing is asked', async () => {
  const h = await tempHome();
  const api = fakeApi({});
  const missing = await run(['drives'], { home: h.home, fetchImpl: api.fetchImpl });
  assert.equal(missing.code, 1);
  assert.match(missing.err, /host\.env is missing: node tools\/pc-host\.mjs init/);
  await fsp.writeFile(h.file, 'HOST_ADMIN_TOKEN=t\n', { mode: 0o640 });
  await fsp.chmod(h.file, 0o640);
  const open = await run(['drives'], { home: h.home, fetchImpl: api.fetchImpl });
  assert.match(open.err, /can be read by others/);
  assert.equal(api.asked.length, 0);
  assert.equal((await run([], { home: h.home })).code, 2);
  assert.equal((await run(['frobnicate'], { home: h.home, fetchImpl: api.fetchImpl })).code, 1);
});

test('direct mode: link signs a pass for the drive\'s owner; invite turns away a name kept for machines or the service; neither works without HOST_DIRECT', async () => {
  const { newSigningKey } = await import('../server/host/passes.js');
  const { createDoor, parseDoorKeys } = await import('../server/door.js');
  const { hostKeyEntry } = await import('../server/host/settings.js');
  const key = newSigningKey();
  const h = await withSettings();
  const plain = fakeApi({ 'GET /drives': [200, { drives: [ANA] }] });
  const off = await run(['link', 'ana'], { home: h.home, fetchImpl: plain.fetchImpl });
  assert.equal(off.code, 1);
  assert.match(off.err, /link is for direct mode: HOST_DIRECT=1/);

  await fsp.appendFile(h.file, `HOST_DIRECT=1\nHOST_SIGNING_KEY=${key}\n`);
  const api = fakeApi({ 'GET /drives': [200, { drives: [ANA] }] });
  const res = await run(['link', 'ana', '--days', '30'], { home: h.home, fetchImpl: api.fetchImpl });
  assert.equal(res.code, 0, res.err);
  const link = /https:\/\/ana\.marbledrive\.app\/enter#(\S+)/.exec(res.out);
  assert.ok(link, res.out);
  const door = createDoor({ keys: parseDoorKeys(hostKeyEntry(key)), name: 'ana', owner: 'acct_1', direct: true });
  assert.equal(door.check(link[1]).acct, 'acct_1');
  assert.ok(!res.out.includes(key));
  assert.match((await run(['link', 'carol'], { home: h.home, fetchImpl: api.fetchImpl })).err, /there is no drive called carol/);

  for (const name of ['pc-ana', 'mac-x', 'www', 'escape-check', 'A']) {
    const r = await run(['invite', name], { home: h.home, fetchImpl: api.fetchImpl });
    assert.equal(r.code, 1, name);
    assert.ok(!api.asked.some((a) => a.method === 'POST'), `${name}: nothing made`);
  }
});

test('direct mode: code shows the invite code, and --new replaces it in host.env', async () => {
  const { newSigningKey } = await import('../server/host/passes.js');
  const h = await withSettings();
  await fsp.appendFile(h.file, `HOST_DIRECT=1\nHOST_SIGNING_KEY=${newSigningKey()}\nHOST_INVITE_CODE=AAAA-BBBB-CCCC\n`);
  const shown = await run(['code'], { home: h.home });
  assert.equal(shown.code, 0, shown.err);
  assert.match(shown.out, /Invite code: AAAA-BBBB-CCCC/);
  assert.match(shown.out, /https:\/\/join\.marbledrive\.app/);
  const fresh = await run(['code', '--new'], { home: h.home });
  const code = /Invite code: (\S+)/.exec(fresh.out)[1];
  assert.notEqual(code, 'AAAA-BBBB-CCCC');
  assert.equal((await read(h.file)).HOST_INVITE_CODE, code);
  assert.equal((await fsp.stat(h.file)).mode & 0o777, 0o600);
});
