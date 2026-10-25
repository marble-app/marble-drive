// marble-host's admin API, on 127.0.0.1:4461: how the owner's Console and
// tools/pc-host.mjs see and change the drives on the PC (docs/HOSTING.md,
// "marble-host and the sandbox"). Every request carries
// `Authorization: Bearer <HOST_ADMIN_TOKEN>`; JSON goes in and out, and a
// refusal is `{ why }` with its status.
//
// Every guest shares the PC's loopback, so the token, not the address, is
// what keeps one out: it lives in host.env, in the owner's home, which no
// guest can see.
//
// Moving drives between releases is the updater's, which the owner is writing
// himself, so its four routes (/release, /promote, /rollback, /pause) answer
// 501 until it exists.

import http from 'node:http';

import { releaseForNewDrives, releasesOnDisk } from './releases.js';
import { same } from './router.js';
import { NAME } from './settings.js';

export const NOT_BUILT = Object.freeze({ why: "the updater isn't built yet" });
const UPDATER = new Set(['/release', '/promote', '/rollback', '/pause']);
const CHANNELS = ['canary', 'everyone'];
const MAX_BODY = 64 * 1024;
const ACTION = /^\/drives\/([^/]+)\/(restart|suspend|resume|remove|channel)$/;

class Refusal extends Error {
  constructor(status, why) {
    super(why);
    this.status = status;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Refusal(413, 'the body is too big'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        const body = JSON.parse(text);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
        resolve(body);
      } catch {
        reject(new Refusal(400, 'the body is a JSON object'));
      }
    });
    req.on('error', reject);
  });
}

export function createAdmin({ token, settings, registry, units, maker, watcher = null, envs, probe, log = console, now = () => new Date().toISOString() }) {
  if (!token) throw new Error('the admin API needs HOST_ADMIN_TOKEN');

  const drive = (name) => {
    const d = NAME.test(name) ? registry.drive(name) : null;
    if (!d) throw new Refusal(404, `there is no drive ${name} on this PC`);
    return d;
  };

  /** A drive as GET /drives shows it: the registry's record, with what its
   *  service and its last /health say now. */
  async function row(d) {
    const unit = d.state === 'removed' ? null : await units.show(d.name).catch(() => null);
    let health = watcher?.health(d.name) ?? null;
    if (!health && d.state === 'running') {
      // Not looked at yet (marble-host has just started): look now.
      const h = await probe.health(d.port).catch(() => null);
      health = { ok: Boolean(h), working: h?.working ?? null, release: h?.release ?? null, at: now() };
    }
    return {
      name: d.name,
      port: d.port,
      owner: d.owner,
      channel: d.channel ?? 'everyone',
      release: d.release,
      state: d.state,
      active: unit?.active ?? 'inactive',
      memoryBytes: unit?.memoryBytes ?? null,
      health,
      restarts: d.restarts ?? 0,
      created: d.created,
      cohort: d.cohort ?? null,
      ...(d.failed ? { failed: d.failed } : {}),
      ...(d.removed ? { removed: d.removed } : {}),
    };
  }

  const answer = async (name) => ({ drive: await row(registry.drive(name)) });

  async function restart(d) {
    if (d.state === 'failed') {
      // Its making stopped part way: try the rest again.
      const r = await maker.retry(d.name);
      if (!r.ok) throw new Refusal(r.status ?? 500, r.why);
      return answer(d.name);
    }
    if (d.state !== 'running') throw new Refusal(409, `${d.name} is ${d.state}${d.state === 'suspended' ? '; resume it instead' : ''}`);
    await units.restart(d.name);
    await registry.update((r) => {
      r.drives[d.name].restarts = (r.drives[d.name].restarts ?? 0) + 1;
    });
    await registry.event(d.name, 'restarted', { by: 'owner' });
    return answer(d.name);
  }

  async function suspend(d) {
    if (d.state === 'suspended') return answer(d.name);
    if (!['running', 'failed'].includes(d.state)) throw new Refusal(409, `${d.name} is ${d.state}`);
    await units.stop(d.name);
    await registry.update((r) => {
      Object.assign(r.drives[d.name], { state: 'suspended', suspended: now() });
    });
    await registry.event(d.name, 'suspended', {});
    return answer(d.name);
  }

  async function resume(d) {
    if (!['suspended', 'running'].includes(d.state)) throw new Refusal(409, `${d.name} is ${d.state}`);
    await units.start(d.name);
    if (d.state === 'suspended') {
      await registry.update((r) => {
        r.drives[d.name].state = 'running';
        delete r.drives[d.name].suspended;
      });
      await registry.event(d.name, 'resumed', {});
    }
    return answer(d.name);
  }

  /** Stopped for good, its settings file gone. Its folder stays: deleting a
   *  drive's data is a root helper's job, never marble-host's. */
  async function remove(d, body) {
    if (body.confirm !== d.name) throw new Refusal(400, `to remove ${d.name}, send { "confirm": "${d.name}" }`);
    if (d.state === 'removed') return answer(d.name);
    if (d.state === 'making') throw new Refusal(409, `${d.name} is being made; remove it once that ends`);
    await units.stop(d.name);
    await envs.remove(d.name);
    await registry.update((r) => {
      Object.assign(r.drives[d.name], { state: 'removed', removed: now() });
    });
    await registry.event(d.name, 'removed', { by: 'owner' });
    return answer(d.name);
  }

  /** Which release channel a drive follows; only the updater acts on it. */
  async function channel(d, body) {
    if (!CHANNELS.includes(body.channel)) throw new Refusal(400, 'channel is canary or everyone');
    if (d.state === 'removed') throw new Refusal(409, `${d.name} is removed`);
    if ((d.channel ?? 'everyone') !== body.channel) {
      await registry.update((r) => {
        r.drives[d.name].channel = body.channel;
      });
      await registry.event(d.name, 'channel', { channel: body.channel });
    }
    return answer(d.name);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://admin');
    const route = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;

    if (method === 'GET' && route === '/drives') {
      return [200, { drives: await Promise.all(registry.drives().map(row)) }];
    }
    if (method === 'POST' && route === '/drives') {
      const body = await readJson(req);
      const r = await maker.make({ name: body.name, owner: body.owner, cohort: body.cohort ?? null });
      if (!r.ok) throw new Refusal(r.status ?? 500, r.step && r.status === 500 ? `${r.why} (at ${r.step})` : r.why);
      return [201, await answer(body.name)];
    }
    const action = ACTION.exec(route);
    if (method === 'POST' && action) {
      const body = await readJson(req);
      const d = drive(decodeURIComponent(action[1]));
      const verb = action[2];
      if (verb === 'restart') return [200, await restart(d)];
      if (verb === 'suspend') return [200, await suspend(d)];
      if (verb === 'resume') return [200, await resume(d)];
      if (verb === 'remove') return [200, await remove(d, body)];
      return [200, await channel(d, body)];
    }
    if (method === 'GET' && route === '/releases') {
      const forNew = await releaseForNewDrives({ registry, opt: settings.opt });
      return [200, { channels: registry.channels(), paused: registry.paused(), onDisk: await releasesOnDisk(settings.opt), newDrives: forNew }];
    }
    if (method === 'POST' && UPDATER.has(route)) {
      req.resume();
      return [501, NOT_BUILT];
    }
    if (method === 'GET' && route === '/events') {
      const limit = Math.min(1000, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100));
      return [200, { events: await registry.events(limit) }];
    }
    throw new Refusal(404, 'no such route');
  }

  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      if (res.headersSent) return res.end();
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(`${JSON.stringify(body)}\n`);
    };
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!same(bearer, token)) {
      req.resume();
      return send(401, { why: 'unauthorised' });
    }
    handle(req, res).then(
      ([status, body]) => send(status, body),
      (err) => {
        if (err instanceof Refusal) return send(err.status, { why: err.message });
        log.error?.(`[admin] ${req.method} ${req.url}: ${err.stack ?? err.message}`);
        send(500, { why: err.message });
      },
    );
  });
  // Making a drive waits for its check, a minute or more.
  server.requestTimeout = 10 * 60 * 1000;

  return {
    server,
    listen: (port, host = '127.0.0.1') =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address().port);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
