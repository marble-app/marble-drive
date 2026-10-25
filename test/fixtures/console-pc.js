// Fakes of the door's admin API and marble-host's, for the Console's people
// on the PC (server/console/pchost.js): each an HTTP server on 127.0.0.1 that
// checks its bearer, answers from a state the test may change, and records
// every request. Their settings files and a backup status folder are written
// into a temporary folder, never ~/.config/marble-drive.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const DOOR_TOKEN = 'door-admin-token-0123456789abcdef0123456789abcdef';
export const HOST_TOKEN = 'host-admin-token-0123456789abcdef0123456789abcdef';
export const NOT_BUILT = { why: "the updater isn't built yet" };

const MIN = 60_000;
export const ago = (minutes) => new Date(Date.now() - minutes * MIN).toISOString();

/** The door's people: four drives on the PC, one invite nobody has opened,
 *  someone who hasn't answered the consent form, a drive on Fly and one
 *  that is gone. */
export function people() {
  const acct = (id, name, email, seen) => ({ id, name, email, created: ago(60 * 24 * 4), seen });
  const invite = (id, note, study, made) => ({ id, note, made, expires: ago(-60 * 24 * 10), used: null, study });
  const none = { invited: null, signedIn: null, consented: null, named: null, ready: null, agentConnected: null, firstDocument: null, updated: null };
  const inStudy = (at) => ({ cohort: 'study', consent: { version: '2026-11-irb-v1', at, choice: 'given' }, withdrawn: null, deleteAsked: null });
  const out = { cohort: null, consent: null, withdrawn: null, deleteAsked: null };
  return [
    {
      account: acct('a000000000000001', 'Ana Lopez', 'ana@example.com', ago(30)),
      drive: { name: 'ana', state: 'ready', home: 'pchost', created: ago(60 * 50) },
      invite: invite('inv-ana', 'Ana', true, ago(60 * 52)),
      study: inStudy(ago(60 * 51)),
      timeline: { ...none, invited: ago(60 * 52), signedIn: ago(60 * 51), consented: ago(60 * 51), named: ago(60 * 50), ready: ago(60 * 50), agentConnected: ago(60 * 49), firstDocument: ago(60 * 48), updated: ago(60 * 24) },
    },
    {
      account: acct('b000000000000002', 'Ben Okafor', 'ben@example.com', ago(60)),
      drive: { name: 'ben', state: 'ready', home: 'pchost', created: ago(60 * 30) },
      invite: invite('inv-ben', 'Ben', false, ago(60 * 31)),
      study: out,
      timeline: { ...none, invited: ago(60 * 31), signedIn: ago(60 * 30), named: ago(60 * 30), ready: ago(60 * 30), agentConnected: ago(60 * 29) },
    },
    {
      account: acct('c000000000000003', 'Cho Park', 'cho@example.com', ago(60 * 48)),
      drive: { name: 'cho', state: 'ready', home: 'pchost', created: ago(60 * 48) },
      invite: invite('inv-cho', 'Cho', false, ago(60 * 50)),
      study: out,
      timeline: { ...none, invited: ago(60 * 50), signedIn: ago(60 * 49), named: ago(60 * 48), ready: ago(60 * 48) },
    },
    {
      account: null,
      drive: null,
      invite: invite('inv-dee', 'Dee', true, ago(60 * 47)),
      study: { cohort: 'study', consent: null, withdrawn: null, deleteAsked: null },
      timeline: { ...none, invited: ago(60 * 47) },
    },
    {
      account: acct('e000000000000005', 'Eve Fly', 'eve@example.com', ago(10)),
      drive: { name: 'eve', state: 'ready', home: 'fly', created: ago(60 * 100) },
      invite: invite('inv-eve', 'Eve', false, ago(60 * 101)),
      study: out,
      timeline: { ...none, invited: ago(60 * 101), signedIn: ago(60 * 100), named: ago(60 * 100), ready: ago(60 * 100) },
    },
    {
      account: acct('f000000000000006', 'Fay Gone', 'fay@example.com', ago(60 * 70)),
      drive: { name: 'fay', state: 'removed', home: 'pchost', created: ago(60 * 90) },
      invite: invite('inv-fay', 'Fay', false, ago(60 * 91)),
      study: out,
      timeline: { ...none, invited: ago(60 * 91), signedIn: ago(60 * 90), named: ago(60 * 90), ready: ago(60 * 90) },
    },
    {
      account: acct('g000000000000007', 'Gus Ito', 'gus@example.com', ago(20)),
      drive: null,
      invite: invite('inv-gus', 'Gus', true, ago(60 * 2)),
      study: { cohort: 'study', consent: null, withdrawn: null, deleteAsked: null },
      timeline: { ...none, invited: ago(60 * 2), signedIn: ago(20) },
    },
  ];
}

/** marble-host's drives: the door's four on the PC, one made by hand that the
 *  door doesn't know, and the one that is gone. */
export function drives() {
  const row = (name, extra = {}) => ({
    name,
    port: 4500 + name.charCodeAt(0) % 50,
    owner: null,
    channel: 'everyone',
    release: '20261025T161133Z-4b2103a',
    state: 'running',
    active: 'active',
    memoryBytes: 180_000_000,
    health: { ok: true, working: 0, release: '20261025T161133Z-4b2103a', at: ago(0.2) },
    restarts: 0,
    created: ago(60 * 50),
    cohort: null,
    ...extra,
  });
  return [
    row('ana', { owner: 'a000000000000001', cohort: 'study', agent: 'claude', memoryBytes: 412_000_000, restarts: 2, health: { ok: true, working: 1, release: '20261025T161133Z-4b2103a', at: ago(0.2) }, turnsToday: 12, lastActive: ago(4), study: { counts: { days: 3, prompts: 41, builds: 9, marks: 6, buttons: 5, conversations: 7, singlePromptConversations: 2, promptsWhileAnotherWorked: 4, note: 'never shown' }, at: ago(3) }, heldBack: ['Start here'] }),
    row('ben', { owner: 'b000000000000002', agent: 'chatgpt', turnsToday: 3, lastActive: ago(60) }),
    row('cho', { owner: 'c000000000000003', agent: null }),
    row('hal', { channel: 'canary' }),
    row('fay', { owner: 'f000000000000006', state: 'removed', active: 'inactive', health: null, removed: ago(60 * 70) }),
  ];
}

/** The door's audit log, newest first, as GET /_door/log answers it. */
export function lines() {
  const l = (minutes, kind, account, detail = null, ip = null) => ({ at: ago(minutes), kind, account, ip, detail });
  return [
    l(4, 'first-document', 'a000000000000001', { drive: 'ana' }),
    l(30, 'signed-in', 'a000000000000001', { provider: 'google' }, '203.0.113.9'),
    l(40, 'session-opened', 'a000000000000001', { method: 'google' }, '203.0.113.9'),
    l(50, 'signed-in', 'o000000000000000', { provider: 'google' }, '198.51.100.1'),
    l(60 * 29, 'agent-connected', 'b000000000000002', { drive: 'ben', agent: 'chatgpt' }),
    l(60 * 24, 'drive-updated', 'a000000000000001', { drive: 'ana', release: '20261025T161133Z-4b2103a' }),
    l(60 * 47, 'invite-made', null, { invite: 'inv-dee', uses: 1, drive: null, owner: false, cohort: 'study' }),
    l(60 * 49, 'account-made', 'c000000000000003', { provider: 'github', role: 'member', invite: 'inv-cho' }, '192.0.2.44'),
    l(60 * 51, 'consent-given', 'a000000000000001', { version: '2026-11-irb-v1', invite: 'inv-ana' }),
    l(60 * 100, 'drive-ready', 'e000000000000005', { drive: 'eve' }),
  ];
}

const reply = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

const readBody = (req) => new Promise((resolve) => {
  let text = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { text += c; });
  req.on('end', () => {
    try {
      resolve(text ? JSON.parse(text) : {});
    } catch {
      resolve({ unparsed: text });
    }
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(handler) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const body = req.method === 'POST' ? await readBody(req) : null;
    const call = { method: req.method, url: req.url, auth: req.headers.authorization ?? null, body };
    calls.push(call);
    try {
      await handler(req, res, call);
    } catch (err) {
      reply(res, 500, { why: err.message });
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({
      port,
      url: `http://127.0.0.1:${port}`,
      calls,
      close: () => new Promise((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
    });
  }));
}

/** The door. `state.mode` is 'ok', 'html' (an admin API not yet deployed, as
 *  the live door was on 25 Oct) or 'broken' (500s). Invites it makes are kept
 *  in `state.invites`, with their codes, so a test can look for them. */
export async function fakeDoor({ token = DOOR_TOKEN } = {}) {
  const state = { people: people(), lines: lines(), mode: 'ok', invites: [] };
  const door = await serve(async (req, res, call) => {
    if (state.mode === 'html') return reply(res, 200, '<!doctype html><title>Marble Drive</title>', 'text/html');
    if (call.auth !== `Bearer ${token}`) return reply(res, 401, { why: 'unauthorised' });
    if (state.mode === 'broken') return reply(res, 500, { why: 'the directory is busy' });
    const url = new URL(req.url, 'http://door');
    if (req.method === 'GET' && url.pathname === '/_door/people') return reply(res, 200, { people: state.people });
    if (req.method === 'GET' && url.pathname === '/_door/log') return reply(res, 200, { lines: state.lines.slice(0, Number(url.searchParams.get('limit')) || 200) });
    if (req.method === 'POST' && url.pathname === '/_door/invite') {
      const code = crypto.randomBytes(16).toString('hex');
      const invite = { id: `inv-${crypto.randomBytes(3).toString('hex')}`, note: call.body.note, uses: call.body.uses, made: new Date().toISOString(), expires: new Date(Date.now() + call.body.days * 24 * 60 * MIN).toISOString(), cohort: call.body.study ? 'study' : null };
      state.invites.push({ code, invite });
      return reply(res, 200, { link: `https://marbledrive.app/join/${code}`, invite });
    }
    const m = /^\/_door\/drives\/([a-z0-9-]+)\/remove$/.exec(url.pathname);
    if (req.method === 'POST' && m) {
      if (call.body.confirm !== m[1]) return reply(res, 400, { why: `To remove ${m[1]}, send { "confirm": "${m[1]}" }.` });
      const p = state.people.find((x) => x.drive?.name === m[1]);
      if (!p) return reply(res, 404, { why: 'No such drive.' });
      if (['removing', 'deleting', 'removed'].includes(p.drive.state)) return reply(res, 200, { drive: p.drive, sessions: 0, already: true });
      p.drive.state = 'removing';
      return reply(res, 200, { drive: p.drive, sessions: 2 });
    }
    return reply(res, 404, { why: 'no such route' });
  });
  return { ...door, state };
}

/** marble-host's admin API. `state.slow[verb]` holds a verb's answer back
 *  that many ms; `state.missing` lists verbs it doesn't have yet (a 404, as
 *  before the build that adds export and backup). */
export async function fakeHost({ token = HOST_TOKEN } = {}) {
  const state = { drives: drives(), slow: {}, missing: [] };
  const host = await serve(async (req, res, call) => {
    if (call.auth !== `Bearer ${token}`) return reply(res, 401, { why: 'unauthorised' });
    const url = new URL(req.url, 'http://host');
    if (req.method === 'GET' && url.pathname === '/drives') return reply(res, 200, { drives: state.drives });
    if (req.method === 'POST' && ['/release', '/promote', '/rollback', '/pause'].includes(url.pathname)) return reply(res, 501, NOT_BUILT);
    const m = /^\/drives\/([a-z0-9-]+)\/([a-z]+)$/.exec(url.pathname);
    if (req.method !== 'POST' || !m) return reply(res, 404, { why: 'no such route' });
    const [, name, verb] = m;
    if (state.missing.includes(verb)) return reply(res, 404, { why: 'no such route' });
    const d = state.drives.find((x) => x.name === name);
    if (!d) return reply(res, 404, { why: `there is no drive ${name} on this PC` });
    if (state.slow[verb]) await sleep(state.slow[verb]);
    if (verb === 'restart') {
      if (d.state !== 'running') return reply(res, 409, { why: `${name} is ${d.state}${d.state === 'suspended' ? '; resume it instead' : ''}` });
      d.restarts += 1;
    } else if (verb === 'suspend') d.state = 'suspended';
    else if (verb === 'resume') d.state = 'running';
    else if (verb === 'remove') {
      if (call.body.confirm !== name) return reply(res, 400, { why: `to remove ${name}, send { "confirm": "${name}" }` });
      d.state = 'removed';
    } else if (verb === 'channel') d.channel = call.body.channel;
    else if (verb === 'export' || verb === 'backup') return reply(res, 202, { started: true });
    else return reply(res, 404, { why: 'no such route' });
    return reply(res, 200, { drive: d });
  });
  return { ...host, state };
}

/** host.env, door.env and a backup status folder for the fakes, in a
 *  temporary folder. `statuses` are the status files' contents by name. */
export async function pcFiles({ door, host, statuses = null } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-pc-'));
  const hostEnv = path.join(dir, 'host.env');
  const doorEnv = path.join(dir, 'door.env');
  const statusDir = path.join(dir, 'status');
  await fsp.mkdir(statusDir);
  if (host) await fsp.writeFile(hostEnv, `HOST_ADMIN_TOKEN=${HOST_TOKEN}\nHOST_ADMIN_PORT=${host.port}\nHOST_KEY=never-read-by-the-console\n`, { mode: 0o600 });
  if (door) await fsp.writeFile(doorEnv, `DOOR_URL=${door.url}\nDOOR_ADMIN_TOKEN=${DOOR_TOKEN}\n`, { mode: 0o600 });
  const all = statuses ?? {
    ana: { name: 'ana', at: ago(20), ok: true, files: 214, bytes: 5_813_302, changed: true, lastGood: ago(20) },
    ben: { name: 'ben', at: ago(15), ok: false, why: 'R2 could not be reached', files: 90, bytes: 1_200_000, changed: false, lastGood: ago(60 * 3) },
  };
  for (const [name, s] of Object.entries(all)) await fsp.writeFile(path.join(statusDir, `${name}.json`), JSON.stringify(s));
  return { dir, hostEnv, doorEnv, statusDir };
}
