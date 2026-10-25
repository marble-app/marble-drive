// marble-host's admin API, on 127.0.0.1:4461: how the owner's Console and
// tools/pc-host.mjs see and change the drives on the PC (docs/HOSTING.md,
// "marble-host and the sandbox"). Every request carries
// `Authorization: Bearer <HOST_ADMIN_TOKEN>`; JSON goes in and out, and a
// refusal is `{ why }` with its status.
//
// No guest can open 127.0.0.1, where this listens: its unit denies it
// (server/host/addresses.js). The token is the lock all the same, for
// anything else on the PC: it lives in host.env, in the owner's home, which
// no guest can see.
//
// Moving drives between releases is the updater's, which the owner is writing
// himself, so its four routes (/release, /promote, /rollback, /pause) answer
// 501 until it exists.
//
// Removing a drive goes the remover's one way (server/host/remover.js), and a
// drive the door made is ended at the door first. Exporting a drive's study
// data and backing it up start root's helpers and answer at once (202): each
// runs as a service of its own.

import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { releaseForNewDrives, releasesOnDisk } from './releases.js';
import { same } from './router.js';
import { NAME } from './settings.js';

export const NOT_BUILT = Object.freeze({ why: "the updater isn't built yet" });
const UPDATER = new Set(['/release', '/promote', '/rollback', '/pause']);
const CHANNELS = ['canary', 'everyone'];
const MAX_BODY = 64 * 1024;
const ACTION = /^\/drives\/([^/]+)\/(restart|suspend|resume|remove|channel|export|backup)$/;
// A drive the door is ending, or has ended.
const ENDING = new Set(['removing', 'deleting', 'removed']);
const BACKUP_FIELDS = ['name', 'at', 'ok', 'why', 'files', 'bytes', 'changed', 'lastGood'];

/** A drive's last backup, as root's backup service wrote it
 *  (docs/HOSTING.md, "Backups of PC drives"): counts and times, or null
 *  before its first. */
export async function backupStatus(dir, name) {
  try {
    const status = JSON.parse(await fsp.readFile(path.join(dir, `${name}.json`), 'utf8'));
    if (!status || typeof status !== 'object' || Array.isArray(status)) return null;
    return Object.fromEntries(BACKUP_FIELDS.filter((k) => Object.hasOwn(status, k)).map((k) => [k, status[k]]));
  } catch {
    return null;
  }
}

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

export function createAdmin({ token, settings, registry, units, maker, watcher = null, envs, probe, remover, looks = null, door = null, log = console, now = () => new Date().toISOString() }) {
  if (!token) throw new Error('the admin API needs HOST_ADMIN_TOKEN');

  const drive = (name) => {
    const d = NAME.test(name) ? registry.drive(name) : null;
    if (!d) throw new Refusal(404, `there is no drive ${name} on this PC`);
    return d;
  };

  /** A drive as GET /drives shows it: the registry's record, with what its
   *  service and its last /health say now, what the last look at it found
   *  (server/host/looks.js) and its last backup. */
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
      ...(looks?.row(d.name) ?? { agent: null, turnsToday: null, lastActive: null, study: null }),
      backup: d.state === 'removed' ? null : await backupStatus(settings.backupStatusDir, d.name),
      ...(d.failed ? { failed: d.failed } : {}),
      ...(d.removing ? { removing: { at: d.removing.at, by: d.removing.by } } : {}),
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

  /** Off the PC for good, the remover's way: its CLIs signed out, stopped,
   *  its settings file gone, its folder deleted by root's helper, and the
   *  door told. A drive the door made is ended at the door first, so the edge
   *  stops serving it and its person's sessions end; if the door can't be
   *  reached, nothing is changed. */
  async function remove(d, body) {
    if (body.confirm !== d.name) throw new Refusal(400, `to remove ${d.name}, send { "confirm": "${d.name}" }`);
    if (d.state === 'removed') return answer(d.name);
    if (d.state === 'making') throw new Refusal(409, `${d.name} is being made; remove it once that ends`);
    let tell = false;
    if (door?.on && d.door) {
      try {
        const theirs = (await door.drives()).find((x) => x?.name === d.name);
        if (theirs && theirs.home === 'pchost' && theirs.owner === d.owner) {
          if (!ENDING.has(theirs.state)) await door.remove(d.name);
          tell = true;
        }
      } catch (err) {
        throw new Refusal(502, `the door could not end ${d.name} (${err.message}); nothing was changed, so try again`);
      }
    }
    const r = await remover.remove(d.name, { by: 'owner', door: tell });
    if (!r.ok) throw new Refusal(r.status ?? 500, r.why);
    return { ...(await answer(d.name)), ...(r.detail ? { removal: r.detail } : {}) };
  }

  /** The study's data, copied into the owner's drive by root's helper,
   *  which reads the drive's settings itself and refuses without consent on
   *  file. Asked here only for a drive whose settings say it is in the
   *  study, as the last look at the door left them. */
  async function exportStudy(d) {
    if (!['running', 'suspended', 'failed'].includes(d.state)) throw new Refusal(409, `${d.name} is ${d.state}`);
    const env = await envs.read(d.name);
    if (env?.MARBLE_STUDY !== '1' || !env?.MARBLE_CONSENT) throw new Refusal(409, `${d.name} isn't in the study, so nothing of it is exported`);
    const unit = await helper('export', d);
    await registry.event(d.name, 'export', { unit });
    return { ...(await answer(d.name)), started: unit };
  }

  /** A backup now, as the hourly timer would make one. */
  async function backup(d) {
    if (!['running', 'suspended', 'failed'].includes(d.state)) throw new Refusal(409, `${d.name} is ${d.state}`);
    const unit = await helper('backup', d);
    await registry.event(d.name, 'backup', { unit });
    return { ...(await answer(d.name)), started: unit };
  }

  async function helper(kind, d) {
    try {
      return await units.helper(kind, d.name, { wait: false });
    } catch (err) {
      throw new Refusal(err.status ?? 500, err.message);
    }
  }

  /** Which release channel a drive follows; only the updater acts on it. */
  async function channel(d, body) {
    if (!CHANNELS.includes(body.channel)) throw new Refusal(400, 'channel is canary or everyone');
    if (d.state === 'removed' || d.state === 'removing') throw new Refusal(409, `${d.name} is ${d.state}`);
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
      if (verb === 'export') return [202, await exportStudy(d)];
      if (verb === 'backup') return [202, await backup(d)];
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
