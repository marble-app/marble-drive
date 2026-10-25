// What the marble-host tests share: a scratch PC (an opt with releases, an
// /etc/marble-guests, a folder for the drives' state and one for
// marble-host's own), stand-ins for systemctl and for a drive answering on
// loopback (at a drive's own address, as on the PC), and a door that records
// what it is told. Nothing here touches systemd, /opt, /etc or the network
// beyond 127.0.0.0/8, all of which Linux keeps on lo without root.

import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { GUEST_PORTS, guestAddress } from '../../server/host/addresses.js';
import { parseRange } from '../../server/host/settings.js';

export const quiet = { log() {}, error() {}, info() {} };

/** Temporary folders a test file makes, all removed by `cleanup` (its
 *  after() hook): /tmp on the PC is a small RAM disk. */
export function tempDirs() {
  const made = [];
  return {
    make: async (prefix) => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
      made.push(dir);
      return dir;
    },
    cleanup: () => Promise.all(made.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true }))),
  };
}

/** A scratch PC. `releases` are made in <opt>/releases with a host in each. */
export async function scratchPc({ releases = ['20261025T161133Z-4b2103a'], ...more } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pc-host-'));
  const dirs = {
    root,
    opt: path.join(root, 'opt'),
    guestEnvDir: path.join(root, 'etc', 'marble-guests'),
    guestStateDir: path.join(root, 'var', 'lib', 'marble-guests'),
    state: path.join(root, 'state', 'marble-host'),
    backupStatusDir: path.join(root, 'var', 'lib', 'marble-backup', 'status'),
  };
  await fsp.mkdir(dirs.guestEnvDir, { recursive: true, mode: 0o700 });
  await fsp.mkdir(path.join(dirs.opt, 'releases'), { recursive: true });
  for (const release of releases) await addRelease(dirs.opt, release);
  const settings = {
    ...dirs,
    key: 'host-key-for-tests',
    adminToken: 'admin-token-for-tests',
    routerPort: 4460,
    adminPort: 4461,
    guestPorts: parseRange('4500-4599'),
    publicSuffix: 'marbledrive.app',
    doorUrl: 'https://door.test',
    doorAdminToken: null,
    doorKeys: 'k1:AAAA k2:BBBB',
    ntfyUrl: null,
    mode: 'user',
    ownerName: 'Bryan',
    ...more,
  };
  return { ...dirs, settings, cleanup: () => fsp.rm(root, { recursive: true, force: true }) };
}

export async function addRelease(opt, release) {
  const bin = path.join(opt, 'releases', release, 'marble-drive', 'bin');
  await fsp.mkdir(bin, { recursive: true });
  await fsp.writeFile(path.join(bin, 'marble-drive.js'), '// a release\n');
}

/** systemd, as marble-host's units object sees it: what was asked, and an
 *  answer for show(). `fail` makes a verb throw. Root's helpers are
 *  `helper` calls, `remove ana` or `export ana --no-block`; in user mode
 *  there are none. */
export function fakeUnits({ fail = {}, mode = 'system' } = {}) {
  const calls = [];
  const active = new Map();
  const act = (verb, state) => async (name) => {
    calls.push(`${verb} ${name}`);
    if (fail[verb]) throw new Error(`${verb} ${name} failed`);
    if (state) active.set(name, state);
  };
  return {
    mode,
    calls,
    active,
    start: act('start', 'active'),
    stop: act('stop', 'inactive'),
    restart: act('restart', 'active'),
    show: async (name) => ({ active: active.get(name) ?? 'inactive', sub: null, pid: null, memoryBytes: active.get(name) === 'active' ? 200 * 2 ** 20 : null, memoryMax: 1536 * 2 ** 20, restarts: 0, invocation: null }),
    async helper(kind, name, { wait = true } = {}) {
      if (mode === 'user') throw Object.assign(new Error(`marble-guest-${kind}@${name}.service is one of root's helpers; HOST_MODE=user has none`), { status: 501 });
      calls.push(`${kind} ${name}${wait ? '' : ' --no-block'}`);
      if (fail.helper || fail[kind]) throw new Error(`systemctl start marble-guest-${kind}@${name}.service failed (exit 1)`);
      return `marble-guest-${kind}@${name}.service`;
    },
  };
}

/** A probe whose answers a test sets per port. Every passphrase it was
 *  asked with is in `asked`, as [route, port, secret]. */
export function fakeProbe() {
  const health = new Map();
  const deep = new Map();
  const page = new Map();
  const study = new Map();
  const logout = new Map();
  const asked = [];
  return {
    asked,
    health: async (port) => health.get(port) ?? null,
    deep: async (port, secret) => (asked.push(['/health/deep', port, secret]), deep.get(port) ?? null),
    page: async (port) => page.get(port) ?? null,
    study: async (port, secret) => (asked.push(['/health/study', port, secret]), study.get(port) ?? null),
    logout: async (port, secret) => (asked.push(['/health/logout', port, secret]), logout.get(port) ?? null),
    get: async () => null,
    set(port, { release = '20261025T161133Z-4b2103a', ok = true, deep: more = {}, study: counts = null, logout: out = { claude: 'signed-out', codex: 'was-not-signed-in' } } = {}) {
      if (!ok) {
        for (const map of [health, deep, page, study, logout]) map.delete(port);
        return;
      }
      health.set(port, { ok: true, working: 0, release });
      deep.set(port, { ok: true, release, claude: { version: '2.1.281', signedIn: false }, codex: { version: '0.159.3', signedIn: false }, docs: 0, agentConnected: false, ...more });
      page.set(port, 302);
      if (counts) study.set(port, { ok: true, ...counts });
      else study.delete(port);
      logout.set(port, out);
    },
  };
}

/** The door's admin API: a queue the test fills, and every report it hears.
 *  `drives` are its records ({ name, owner, home, state }), which it ends
 *  and removes as the real door does: once one is `removing` or `deleting`
 *  it refuses every step but `removed` with a 409. `people` is what GET
 *  /_door/people answers; `down` makes every call fail. */
export function fakeDoor({ queue = [], failReady = 0, drives = [], people = [] } = {}) {
  const heard = [];
  const events = [];
  let readyFailures = failReady;
  const state = { down: false };
  const ENDING = new Set(['removing', 'deleting']);
  const refuse = (status, why) => Response.json({ why }, { status });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    heard.push({ method: init.method ?? 'GET', path: u.pathname + u.search, body, auth: init.headers?.authorization });
    if (state.down) throw new TypeError('fetch failed');
    if (u.pathname === '/_door/queue') {
      const home = u.searchParams.get('home');
      // One record, one state: a drive the door is ending is queued no more.
      const ending = (name) => ENDING.has(drives.find((x) => x.name === name)?.state);
      return Response.json({ drives: queue.filter((d) => d.state === 'queued' && (!home || d.home === home) && !ending(d.name)) });
    }
    if (u.pathname === '/_door/people') return Response.json({ people });
    if (u.pathname === '/_door/drives' && (init.method ?? 'GET') === 'GET') return Response.json({ drives });
    if (u.pathname === '/_door/events') {
      if (!drives.some((d) => d.name === body?.drive) && !queue.some((d) => d.name === body?.drive)) return refuse(404, 'No such drive.');
      events.push(body);
      return Response.json({ ok: true });
    }
    const remove = /^\/_door\/drives\/([a-z0-9-]+)\/remove$/.exec(u.pathname);
    if (remove) {
      const d = drives.find((x) => x.name === remove[1]);
      if (!d) return refuse(404, 'No such drive.');
      if (ENDING.has(d.state) || d.state === 'removed') return Response.json({ drive: d, sessions: 0, already: true });
      d.state = 'removing';
      return Response.json({ drive: d, sessions: 1 });
    }
    const step = /^\/_door\/drives\/([a-z0-9-]+)\/step$/.exec(u.pathname);
    if (step) {
      const record = drives.find((x) => x.name === step[1]);
      if (body?.state === 'removed') {
        if (!record) return refuse(404, 'No such drive.');
        if (record.state === 'removed') return Response.json({ ok: true, already: true });
        if (!ENDING.has(record.state)) return refuse(409, `${record.name} isn’t being removed or deleted.`);
        record.state = 'removed';
        return Response.json({ ok: true });
      }
      if (record && ENDING.has(record.state)) return refuse(409, `${record.name} is being removed.`);
      if (body?.state === 'ready' && readyFailures > 0) {
        readyFailures -= 1;
        return new Response('{"why":"down"}', { status: 503 });
      }
      const d = queue.find((x) => x.name === step[1]);
      if (d && body?.state === 'ready') d.state = 'ready';
      if (d && body?.state === 'failed') d.state = 'failed';
      return Response.json({ ok: true });
    }
    return new Response('{}', { status: 404 });
  };
  return { heard, events, state, fetchImpl, queue, drives, people, steps: () => heard.filter((h) => h.path.endsWith('/step')).map((h) => h.body) };
}

const closer = (server) => () =>
  new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });

/** A server on a free loopback port. */
export async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, close: closer(server) };
}

/** A drive as the PC runs one: on a free port in 4500-4599, at the loopback
 *  address that port gives it (127.0.0.<10 + port − 4500>). Tried from a
 *  random port, since other test files may hold some at the same time. */
export async function listenGuest(handler) {
  const span = GUEST_PORTS.to - GUEST_PORTS.from + 1;
  const first = Math.floor(Math.random() * span);
  for (let i = 0; i < span; i += 1) {
    const port = GUEST_PORTS.from + ((first + i) % span);
    const address = guestAddress(port);
    const server = http.createServer(handler);
    const bound = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, address, () => resolve(true));
    });
    if (bound) return { server, port, address, close: closer(server) };
  }
  throw new Error(`no port in ${GUEST_PORTS.from}-${GUEST_PORTS.to} is free`);
}

/** A drive's port nothing answers on at its address, for a moment. */
export async function freeGuestPort() {
  const s = await listenGuest(() => {});
  await s.close();
  return s.port;
}

/** A port nothing listens on, for a moment. */
export async function freePort() {
  const s = await listen(() => {});
  const { port } = s;
  await s.close();
  return port;
}
