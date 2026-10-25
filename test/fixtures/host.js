// What the marble-host tests share: a scratch PC (an opt with releases, an
// /etc/marble-guests, a folder for the drives' state and one for
// marble-host's own), stand-ins for systemctl and for a drive answering on
// loopback, and a door that records what it is told. Nothing here touches
// systemd, /opt, /etc or the network beyond 127.0.0.1.

import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { parseRange } from '../../server/host/settings.js';

export const quiet = { log() {}, error() {}, info() {} };

/** A scratch PC. `releases` are made in <opt>/releases with a host in each. */
export async function scratchPc({ releases = ['20261025T161133Z-4b2103a'], ...more } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pc-host-'));
  const dirs = {
    root,
    opt: path.join(root, 'opt'),
    guestEnvDir: path.join(root, 'etc', 'marble-guests'),
    guestStateDir: path.join(root, 'var', 'lib', 'marble-guests'),
    state: path.join(root, 'state', 'marble-host'),
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
 *  answer for show(). `fail` makes a verb throw. */
export function fakeUnits({ fail = {} } = {}) {
  const calls = [];
  const active = new Map();
  const act = (verb, state) => async (name) => {
    calls.push(`${verb} ${name}`);
    if (fail[verb]) throw new Error(`${verb} ${name} failed`);
    if (state) active.set(name, state);
  };
  return {
    calls,
    active,
    start: act('start', 'active'),
    stop: act('stop', 'inactive'),
    restart: act('restart', 'active'),
    show: async (name) => ({ active: active.get(name) ?? 'inactive', sub: null, pid: null, memoryBytes: active.get(name) === 'active' ? 200 * 2 ** 20 : null, memoryMax: 1536 * 2 ** 20, restarts: 0, invocation: null }),
  };
}

/** A probe whose answers a test sets per port. */
export function fakeProbe() {
  const health = new Map();
  const deep = new Map();
  const page = new Map();
  return {
    health: async (port) => health.get(port) ?? null,
    deep: async (port) => deep.get(port) ?? null,
    page: async (port) => page.get(port) ?? null,
    get: async () => null,
    set(port, { release = '20261025T161133Z-4b2103a', ok = true } = {}) {
      if (!ok) {
        health.delete(port);
        deep.delete(port);
        page.delete(port);
        return;
      }
      health.set(port, { ok: true, working: 0, release });
      deep.set(port, { ok: true, release, claude: { version: '2.1.281', signedIn: false }, codex: { version: '0.159.3', signedIn: false }, docs: 0, agentConnected: false });
      page.set(port, 302);
    },
  };
}

/** The door's admin API: a queue the test fills, and every report it hears. */
export function fakeDoor({ queue = [], failReady = 0 } = {}) {
  const heard = [];
  let readyFailures = failReady;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    heard.push({ method: init.method ?? 'GET', path: u.pathname + u.search, body, auth: init.headers?.authorization });
    if (u.pathname === '/_door/queue') {
      const home = u.searchParams.get('home');
      return Response.json({ drives: queue.filter((d) => d.state === 'queued' && (!home || d.home === home)) });
    }
    const step = /^\/_door\/drives\/([a-z0-9-]+)\/step$/.exec(u.pathname);
    if (step) {
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
  return { heard, fetchImpl, queue, steps: () => heard.filter((h) => h.path.endsWith('/step')).map((h) => h.body) };
}

/** A server on a free loopback port. */
export async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    port: server.address().port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** A port nothing listens on, for a moment. */
export async function freePort() {
  const s = await listen(() => {});
  const { port } = s;
  await s.close();
  return port;
}
