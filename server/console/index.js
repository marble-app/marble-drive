// The console: every drive, from one page on admin-p1
// (docs/superpowers/specs/2026-09-24-the-console-design.md).
//
// On only with MARBLE_DRIVE_CONSOLE=1 and a passphrase. It answers
// /console/api/*: the state of the fleet and the workshop, a live stream of
// what changes, and one route per action, each of which starts a job.
//
// It looks at the fleet only while a console tab is open: the Sprites list
// every 20 s (which wakes nobody), a look inside any drive that is awake
// anyway and has not been looked at in five minutes, and the workshop every
// minute. With no tab open it does nothing, and admin-p1 can sleep.

import os from 'node:os';
import path from 'node:path';

import { createActions } from './actions.js';
import { createInspector } from './inspect.js';
import { createJobs } from './jobs.js';
import { createSprites } from './sprites.js';
import { createUsage } from './usage.js';
import { createWorkshop } from './workshop.js';

const FLEET_EVERY = 20_000;
const LOOK_AWAKE_EVERY = 5 * 60_000;
// An awake drive's ledger is read this often while a console tab is open.
const PULL_EVERY = 60_000;
const WORKSHOP_EVERY = 60_000;
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

export function consoleAllowed(config) {
  if (!config.console) return { ok: false, why: 'MARBLE_DRIVE_CONSOLE is not set' };
  if (!config.secret) return { ok: false, why: 'the console needs a passphrase on this drive' };
  return { ok: true, why: null };
}

export async function createConsole({ config, store, streams = null, ledger = null, log = console, json, readJson, text }) {
  const dir = path.join(store.marbleDir, 'console');
  const self = config.consoleSelf || os.hostname();
  const listeners = new Set();
  const send = (event, data) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of listeners) {
      try {
        res.write(frame);
      } catch {}
    }
  };

  const sprites = createSprites({ bin: config.consoleSprite, org: config.consoleOrg });
  const inspector = createInspector({ sprites, dir: path.join(dir, 'sprites') });
  const jobs = createJobs({
    dir: path.join(dir, 'jobs'),
    onEvent: (e) => {
      if (e.type === 'job') {
        send('job', e.job);
        // A job's end changes what the fleet looks like.
        if (e.job.state !== 'running') {
          if (e.job.target) hints.delete(e.job.target);
          refreshSoon();
        }
      } else send('output', e);
    },
  });
  await jobs.ready();
  const usage = createUsage({ dir: path.join(dir, 'usage'), sprites, self, selfLedger: ledger, log });
  const workshop = createWorkshop({ src: config.consoleSrc });
  const actions = createActions({ sprites, inspector, jobs, workshop, src: config.consoleSrc, self, stateDir: dir });

  // ---------------------------------------------------------------- state

  let fleet = [];
  let fleetError = null;
  let fleetAt = 0;

  async function readFleet() {
    try {
      fleet = await sprites.list();
      fleetError = null;
      fleetAt = Date.now();
      const changes = await usage.observe(fleet).catch(() => []);
      for (const change of changes) send('status', change);
    } catch (err) {
      fleetError = err.message;
    }
    return fleet;
  }

  // What a drive is running, known without waking it: every deploy checkpoints
  // first, as "before deploy <release>", so the newest such checkpoint names the
  // last release sent there. A look, when newer, is the better answer.
  // Asking about a cold drive's checkpoints starts it, so a cold drive is never
  // asked: what was known is kept. Anyone else is asked once, and again only
  // after it has run since (a deploy runs it).
  const hints = new Map(); // name → { ranAt, value }
  async function lastDeploy(row) {
    const have = hints.get(row.name);
    if (row.status === 'cold') return have?.value ?? null;
    if (have && have.ranAt === row.ranAt) return have.value;
    let value = have?.value ?? null;
    try {
      const cp = (await sprites.checkpoints(row.name)).find((c) => /^before deploy \S+/.test(c.comment));
      value = cp ? { release: /^before deploy (\S+)/.exec(cp.comment)[1], at: cp.at } : null;
    } catch {}
    hints.set(row.name, { ranAt: row.ranAt, value });
    return value;
  }

  async function drives() {
    const stuck = new Set(actions.stuck());
    const recent = jobs.list();
    return Promise.all(fleet.map(async (row) => {
      // Three ways to know what a drive runs, newest wins: a look (certain), a
      // deploy this console finished (certain), or the last deploy's checkpoint
      // (a floor: a deploy made without a checkpoint does not show there).
      const seen = await inspector.cached(row.name);
      const hint = await lastDeploy(row);
      const shipped = recent.find((j) => j.state === 'done' && j.result?.sha
        && ((j.kind === 'deploy' && j.target === row.name) || (j.kind === 'ship' && j.result.deployed?.includes(row.name))));
      const answers = [
        seen?.release ? { release: seen.release, at: Date.parse(seen.lookedAt), from: 'look' } : null,
        shipped ? { release: `console-${shipped.result.sha}`, at: shipped.endedAt, from: 'console' } : null,
        hint ? { release: hint.release, at: Date.parse(hint.at), from: 'checkpoint' } : null,
      ].filter(Boolean).sort((a, b) => b.at - a.at);
      const best = answers[0] ?? null;
      const release = best?.release ?? null;
      const running = jobs.running(row.name) ?? (jobs.running('fleet')?.meta?.targets?.includes(row.name) ? jobs.running('fleet') : null);
      const last = recent.find((j) => j.target === row.name && j.state !== 'running') ?? null;
      return {
        ...row,
        self: row.name === self,
        role: row.labels.includes('marble-owner') ? 'owner' : row.labels.some((l) => l === 'marble-tester' || l === 'marble-user') ? 'user' : 'other',
        seen,
        release,
        releaseFrom: best?.from ?? null,
        behind: release ? await workshop.behind(release) : null,
        stuckCheckpoints: stuck.has(row.name),
        job: running ? { id: running.id, title: running.title, kind: running.kind } : null,
        lastJob: last ? { id: last.id, title: last.title, state: last.state, endedAt: last.endedAt } : null,
      };
    }));
  }

  async function state() {
    if (!fleetAt) await readFleet();
    const [list, shop] = await Promise.all([drives(), workshop.status()]);
    return {
      self,
      org: config.consoleOrg,
      fleet: list,
      fleetAt,
      fleetError,
      workshop: shop,
      jobs: jobs.list().slice(0, 60),
    };
  }

  // -------------------------------------------------------------- polling

  let timer = null;
  let ticking = false;
  let lastWorkshop = 0;
  let pending = null;

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await readFleet();
      send('fleet', { fleet: await drives(), fleetAt, fleetError });
      // A drive that is awake anyway is looked inside for nothing extra.
      for (const row of fleet.filter((r) => r.awake)) {
        if (jobs.running(row.name)) continue;
        const seen = await inspector.cached(row.name);
        if (seen && Date.now() - Date.parse(seen.lookedAt) < LOOK_AWAKE_EVERY) continue;
        await actions.look(row.name).catch(() => {});
        send('fleet', { fleet: await drives(), fleetAt, fleetError });
      }
      await pullAwake();
      if (Date.now() - lastWorkshop >= WORKSHOP_EVERY) {
        lastWorkshop = Date.now();
        await workshop.fetch();
        send('workshop', await workshop.status());
      }
    } catch (err) {
      log.error?.(`[console] ${err.message}`);
    } finally {
      ticking = false;
    }
  }

  // Every awake drive's new ledger lines. Never a drive that is asleep: the API
  // said it is running, and an exec on a running sprite wakes nothing.
  const pulledAt = new Map();
  async function pullAwake() {
    const due = fleet.filter((r) => r.awake && !jobs.running(r.name) && Date.now() - (pulledAt.get(r.name) ?? 0) >= PULL_EVERY);
    await Promise.allSettled(due.map(async (row) => {
      pulledAt.set(row.name, Date.now());
      const lines = await usage.pull(row.name);
      if (lines.length) send('usage', { sprite: row.name, lines: lines.length, t: lines.at(-1).t });
    }));
  }

  function refreshSoon() {
    if (pending || !listeners.size) return;
    pending = setTimeout(async () => {
      pending = null;
      await readFleet();
      send('fleet', { fleet: await drives(), fleetAt, fleetError });
      send('workshop', await workshop.status());
    }, 300);
    pending.unref?.();
  }

  const watching = () => {
    if (timer || !listeners.size) return;
    timer = setInterval(tick, FLEET_EVERY);
    timer.unref?.();
    tick();
  };
  const unwatching = () => {
    if (listeners.size || !timer) return;
    clearInterval(timer);
    timer = null;
  };

  // --------------------------------------------------------------- routes

  const name = (value) => {
    if (!NAME.test(String(value ?? ''))) throw bad('not a drive name');
    return value;
  };

  /** A changing request comes from this page's own origin, on top of the
   *  SameSite cookie the gate already set. */
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return false;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  async function handle(req, res, url, route) {
    const method = req.method;
    if (!route.startsWith('/console/api/')) return text(res, 404, 'not found');
    const parts = route.slice('/console/api/'.length).split('/').map(decodeURIComponent);
    try {
      if (method !== 'GET' && !sameOrigin(req)) throw bad('the console acts only for its own page', 403);
      const body = method === 'POST' || method === 'PUT' ? await readJson(req, 64 * 1024).catch(() => ({})) : {};
      const [a, b, c] = parts;

      if (a === 'state' && method === 'GET') return json(res, 200, await state());

      if (a === 'events' && method === 'GET') {
        if (streams && !streams.admit(req, url)) {
          res.writeHead(204, { 'Cache-Control': 'no-store' });
          return res.end();
        }
        streams?.track(req, res, url);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(': connected\n\n');
        listeners.add(res);
        const beat = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {}
        }, 25_000);
        beat.unref?.();
        res.on('close', () => {
          clearInterval(beat);
          listeners.delete(res);
          unwatching();
        });
        watching();
        return undefined;
      }

      if (a === 'usage' && method === 'GET') {
        if (!fleetAt) await readFleet();
        const range = ['24h', '7d', '30d', 'month'].includes(url.searchParams.get('range')) ? url.searchParams.get('range') : '7d';
        return json(res, 200, await usage.query({ range, rows: fleet }));
      }
      if (a === 'bill' && method === 'POST') {
        const result = await usage.addBill(String(body.text ?? '').slice(0, 20_000));
        return json(res, result.ok ? 200 : 400, result);
      }
      if (a === 'budget' && method === 'PUT') return json(res, 200, { monthly: await usage.setBudget(body.monthly) });

      if (a === 'plan' && method === 'GET') {
        return json(res, 200, await actions.plan({
          name: url.searchParams.get('name') ? name(url.searchParams.get('name')) : null,
          source: url.searchParams.get('source') === 'workshop' ? 'workshop' : 'main',
        }));
      }
      if (a === 'ship' && method === 'POST') return json(res, 202, await actions.ship());

      if (a === 'jobs' && b) {
        if (c === 'log' && method === 'GET') return text(res, 200, await jobs.output(b));
        if (c === 'cancel' && method === 'POST') return json(res, 200, { ok: jobs.cancel(b) });
        if (!c && method === 'GET') return json(res, 200, jobs.get(b) ?? { error: 'no such job' });
      }

      if (a === 'drives' && !b && method === 'POST') {
        return json(res, 202, await actions.provision({ person: body.person, agent: body.agent, key: body.key }));
      }
      if (a === 'drives' && b) {
        const n = name(b);
        if (method === 'GET' && c === 'log') return json(res, 200, { text: await actions.log(n, url.searchParams.get('lines')) });
        if (method === 'GET' && c === 'checkpoints') return json(res, 200, { checkpoints: await sprites.checkpoints(n) });
        if (method === 'POST') {
          switch (c) {
            case 'look': {
              const seen = await actions.look(n);
              refreshSoon();
              return json(res, 200, seen);
            }
            case 'reveal': return json(res, 200, { passphrase: await actions.reveal(n) });
            case 'deploy': return json(res, 202, await actions.deploy(n, { source: body.source === 'workshop' ? 'workshop' : 'main' }));
            case 'rollback': return json(res, 202, await actions.rollback(n));
            case 'settings': return json(res, 202, await actions.settings(n, { set: body.set ?? {}, unset: body.unset ?? [] }));
            case 'passphrase': return json(res, 202, await actions.newPassphrase(n));
            case 'claude': return json(res, 202, await actions.claude(n, body.auth));
            case 'signout': return json(res, 202, await actions.signOut(n));
            case 'access': return json(res, 202, await actions.access(n, body.to));
            case 'checkpoint': return json(res, 202, await actions.checkpoint(n, body.comment));
            case 'restore': return json(res, 202, await actions.restore(n, String(body.id ?? ''), body.confirm));
            case 'remove': return json(res, 202, await actions.remove(n, body.confirm));
            case 'checkpoints-ok': {
              await actions.clearStuck(n);
              refreshSoon();
              return json(res, 200, { ok: true });
            }
            default: break;
          }
        }
      }

      if (a === 'workshop') {
        if (!b && method === 'GET') {
          await workshop.fetch({ force: url.searchParams.get('fetch') === '1' });
          return json(res, 200, await workshop.status());
        }
        if (method === 'POST' && c === 'pull') return json(res, 202, actions.pull(b));
        if (method === 'POST' && c === 'test') return json(res, 202, actions.test(b));
        if (method === 'POST' && b === 'marble' && c === 'publish') return json(res, 202, actions.publish());
      }
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) log.error?.(`[console] ${route}: ${err.message}`);
      return json(res, status, { error: err.message, ...(err.job ? { job: err.job } : {}) });
    }
  }

  return {
    handle,
    state,
    jobs,
    actions,
    usage,
    close() {
      if (timer) clearInterval(timer);
      if (pending) clearTimeout(pending);
      for (const res of listeners) {
        try {
          res.end();
        } catch {}
      }
      listeners.clear();
      jobs.close();
    },
  };
}
