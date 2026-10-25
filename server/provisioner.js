// The door sprite's one job: make the drives people asked for at
// marbledrive.app (docs/superpowers/specs/2026-10-10-accounts-and-sign-in-
// design.md, "The door sprite").
//
// The Worker cannot run the `sprite` CLI or bash, so a small sprite does: it
// takes the oldest queued drive from the Directory, runs
// `tools/sprite-provision.sh --door` for it, and reports each step back, one
// drive at a time. The door pokes it when a drive is asked for; it also looks
// once when it starts, for anything asked while it slept.
//
// Only lines of a known shape are passed on (`step: <step> <state>`, `url:
// <https URL>`), so nothing the script or the sprite CLI says, a secret
// included, can reach the person's page.
//
// When starter credit is on (worker/src/credit.js), each drive is minted its
// own credit token first, made from nothing or handed a spare, and the script
// writes it into the drive's settings beside the proxy's address. It travels
// in a file only this user can read (--settings), never in argv, and the file
// is gone when the script ends. A spare, nobody's yet, gets no token.
//
// The spare (docs/ACCOUNTS.md, "The spare drive"): with MARBLE_SPARE_DRIVES
// set, it also keeps SPARE_DRIVES drives made ahead, provisioned, deployed and
// asleep, with nobody's name on them. A sign-up that finds one ready is given
// it by the Directory; here that drive only gets its settings and a restart.
// Fly can't rename a sprite, so the spare keeps its own name (d-spare-<hex>)
// and the Directory maps the drive's name to it. If handing it over fails, the
// drive goes back to the queue and is made from nothing, as without a spare.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const STEP = /^step: (machine|install|check|name|start) (now|done)$/;

/** How many spares are kept ready once MARBLE_SPARE_DRIVES turns them on. */
export const SPARE_DRIVES = 1;
/** A spare still `making` after this long was left by a door sprite that
 *  stopped part way; it is marked failed so another can be made. */
export const SPARE_STALE_MS = 45 * 60 * 1000;

/** MARBLE_SPARE_DRIVES: unset, empty, 0 or off keeps none (the default); a
 *  whole number keeps that many (at most 3); anything else (on, yes, true)
 *  keeps SPARE_DRIVES. */
export function sparesWanted(setting) {
  const v = String(setting ?? '').trim().toLowerCase();
  if (!v || v === '0' || v === 'off' || v === 'no' || v === 'false') return 0;
  const n = Number(v);
  if (Number.isInteger(n) && n > 0) return Math.min(n, 3);
  return SPARE_DRIVES;
}

export const newSpareName = () => `d-spare-${crypto.randomBytes(4).toString('hex')}`;

// What --settings may carry into a drive's sprite.env, and in what shape:
// one line each, no comma (a sprite.env value can't hold one), no space.
const SETTING_KEY = /^MARBLE_CREDIT_[A-Z0-9_]+$/;
const SETTING_VALUE = /^[^\s,]{1,2000}$/;
const URL_LINE = /^url: (https:\/\/[A-Za-z0-9.-]+)\/?$/;

const same = (a, b) =>
  crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a ?? '')).digest(), crypto.createHash('sha256').update(String(b ?? '')).digest());

/** The script's arguments for a job: a drive made from nothing (`drive`),
 *  a spare handed to a drive (`handout`), or a spare made ahead (`spare`). */
export function scriptArgs({ kind = 'drive', name, account, sprite }, { script, keysFile, org, settingsFile = null }) {
  const extra = settingsFile ? ['--settings', settingsFile] : [];
  if (kind === 'spare') return [script, '--spare', sprite, '--keys', keysFile, '--org', org];
  if (kind === 'handout') return [script, '--door', name, '--from-spare', sprite, '--account', account, '--keys', keysFile, '--org', org, ...extra];
  return [script, '--door', name, '--account', account, '--keys', keysFile, '--org', org, ...extra];
}

/** Runs the provisioning script for one job; each stdout line goes to
 *  `onLine`, in order. Resolves with the exit code. A job's `settings` go to
 *  the script in a file only this user can read, removed when it ends. */
export function scriptRunner({ script, keysFile, org = 'marble-drive', log = console, spawnImpl = spawn }) {
  return (job, onLine) =>
    new Promise((resolve) => {
      let dir = null;
      let settingsFile = null;
      const entries = Object.entries(job.settings ?? {});
      if (entries.length) {
        const bad = entries.find(([k, v]) => !SETTING_KEY.test(k) || !SETTING_VALUE.test(String(v)));
        if (bad) {
          log.error(`[provisioner] ${job.name}: the setting ${SETTING_KEY.test(bad[0]) ? bad[0] : '(a name)'} can't go in a sprite.env`);
          return resolve(2);
        }
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marble-settings-'));
        settingsFile = path.join(dir, 'settings');
        fs.writeFileSync(settingsFile, entries.map(([k, v]) => `${k}=${v}\n`).join(''), { mode: 0o600 });
      }
      const cleanup = () => {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
      };
      const label = job.name ?? job.sprite;
      const child = spawnImpl('bash', scriptArgs(job, { script, keysFile, org, settingsFile }), { stdio: ['ignore', 'pipe', 'pipe'] });
      let chain = Promise.resolve();
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        chain = chain.then(() => onLine(line)).catch(() => {});
      });
      readline.createInterface({ input: child.stderr }).on('line', (line) => log.error(`[provisioner] ${label}: ${line.slice(0, 300)}`));
      child.on('error', () => {
        cleanup();
        resolve(127);
      });
      child.on('close', (code) =>
        chain.then(() => {
          cleanup();
          resolve(code ?? 1);
        }),
      );
    });
}

/** `home` is whose share of the queue this maker takes: `fly`, the door
 *  sprite's (the default), or `pchost`, marble-host's on the PC
 *  (worker/src/pc-host.js). A drive on the PC host has no sprite URL to
 *  report, no spare and no starter credit. */
export function createProvisioner({
  directoryUrl,
  adminToken,
  run,
  home = 'fly',
  spares = 0,
  settingsFor = () => ({}),
  spareName = newSpareName,
  now = () => Date.now(),
  log = console,
  fetchImpl = fetch,
}) {
  let working = false;
  let sparing = false;
  const onFly = home === 'fly';

  async function api(method, path, body) {
    const res = await fetchImpl(new URL(`/_door${path}`, directoryUrl).href, {
      method,
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`the door answered ${method} ${path} with ${res.status}`);
    return res.json();
  }

  /** A credit token for the drive, or null when starter credit is off (the
   *  Worker answers 404) or could not be minted: the drive is then made
   *  without it, as before, and its person brings a key. */
  async function mintCredit(name) {
    try {
      const res = await fetchImpl(new URL(`/_credit/admin/drives/${encodeURIComponent(name)}/token`, directoryUrl).href, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        log.error(`[provisioner] ${name}: no starter credit (the door answered ${res.status})`);
        return null;
      }
      const { token, credit } = await res.json();
      // An invite with --credit 0: this drive is made without credit.
      if (credit?.cap === 0) return null;
      return /^mdc_[0-9a-f]{48}$/.test(token ?? '') ? { url: new URL('/_credit', directoryUrl).href, token } : null;
    } catch (err) {
      log.error(`[provisioner] ${name}: no starter credit (${err.message})`);
      return null;
    }
  }

  /** What goes into a drive's sprite.env beyond the door's own: whatever
   *  `settingsFor` gives, and the starter credit's address and the token
   *  just minted for the drive's name, when credit is on. Only for a drive
   *  someone asked for, made from nothing or handed a spare. */
  async function settingsWithCredit(job) {
    const settings = { ...settingsFor(job) };
    const credit = onFly ? await mintCredit(job.name) : null;
    if (credit) Object.assign(settings, { MARBLE_CREDIT_URL: credit.url, MARBLE_CREDIT_TOKEN: credit.token });
    return settings;
  }

  /** The oldest queued drive of this maker's home, made. A second call
   *  while one runs does nothing. A drive on the PC host is never made on
   *  Fly, nor one on Fly on the PC, whichever the queue lists first. */
  async function once() {
    if (working) return { skipped: true };
    working = true;
    try {
      const { drives = [] } = await api('GET', `/queue?home=${home}`);
      const job = drives.find((d) => (d.home ?? 'fly') === home);
      if (!job) return { idle: true };
      if (job.spare) return await handOut(job);
      let current = 'machine';
      let url = null;
      const onLine = async (line) => {
        const step = STEP.exec(line);
        if (step) {
          if (step[2] === 'now') current = step[1];
          try {
            await api('POST', `/drives/${job.name}/step`, { step: step[1], state: step[2] });
          } catch (err) {
            log.error(`[provisioner] ${job.name}: could not report ${step[1]}: ${err.message}`);
          }
          return;
        }
        const at = URL_LINE.exec(line);
        if (at) url = at[1];
      };
      log.log(`[provisioner] making ${job.name}`);
      const code = await run({ kind: 'drive', name: job.name, account: job.owner, settings: await settingsWithCredit(job) }, onLine);
      if (code === 0 && (url || !onFly)) {
        await api('POST', `/drives/${job.name}/step`, onFly ? { state: 'ready', url, sprite: job.sprite } : { state: 'ready', home });
        log.log(`[provisioner] ${job.name} is ready`);
        return { made: job.name };
      }
      await api('POST', `/drives/${job.name}/step`, { step: current, state: 'failed' });
      log.error(`[provisioner] ${job.name} stopped at ${current} (exit ${code})`);
      return { failed: job.name, step: current };
    } finally {
      working = false;
    }
  }

  /** A drive given a spare: its settings written and its host restarted.
   *  If that fails the drive goes back to the queue without the spare. */
  async function handOut(job) {
    let url = null;
    const onLine = async (line) => {
      const step = STEP.exec(line);
      if (step) {
        try {
          await api('POST', `/drives/${job.name}/step`, { step: step[1], state: step[2] });
        } catch (err) {
          log.error(`[provisioner] ${job.name}: could not report ${step[1]}: ${err.message}`);
        }
        return;
      }
      const at = URL_LINE.exec(line);
      if (at) url = at[1];
    };
    log.log(`[provisioner] handing ${job.spare.sprite} to ${job.name}`);
    const code = await run({ kind: 'handout', name: job.name, account: job.owner, sprite: job.spare.sprite, settings: await settingsWithCredit(job) }, onLine);
    if (code === 0 && url) {
      await api('POST', `/drives/${job.name}/step`, { state: 'ready', url, sprite: job.spare.sprite });
      log.log(`[provisioner] ${job.name} is ready, on ${job.spare.sprite}`);
      return { made: job.name, spare: job.spare.sprite };
    }
    log.error(`[provisioner] handing ${job.spare.sprite} to ${job.name} failed (exit ${code}); making ${job.name} from nothing`);
    await api('POST', `/drives/${job.name}/unspare`, {});
    return { requeued: job.name, spare: job.spare.sprite };
  }

  /** Every queued drive, one after another. */
  async function drain() {
    for (let i = 0; i < 50; i += 1) {
      const r = await once();
      if (!r.made && !r.failed && !r.requeued) return r;
    }
    return { more: true };
  }

  /** One spare made, if fewer than `spares` are ready or being made and the
   *  door has room for another drive. A spare that failed stops this until
   *  Bryan has looked at it (node tools/door.mjs spares), so a fault can't
   *  make sprite after sprite. */
  async function makeSpare() {
    const { spares: list = [], room = 0 } = await api('GET', '/spares');
    for (const s of list) {
      if (s.state === 'making' && now() - Date.parse(s.made) > SPARE_STALE_MS) {
        await api('POST', '/spares', { sprite: s.sprite, state: 'failed' });
        s.state = 'failed';
      }
    }
    if (list.some((s) => s.state === 'failed')) return { blocked: true };
    const live = list.filter((s) => s.state === 'ready' || s.state === 'making').length;
    if (live >= spares) return { enough: true };
    if (room <= 0) return { full: true };
    const sprite = spareName();
    await api('POST', '/spares', { sprite, state: 'making' });
    let url = null;
    log.log(`[provisioner] making a spare, ${sprite}`);
    const code = await run({ kind: 'spare', sprite }, async (line) => {
      const at = URL_LINE.exec(line);
      if (at) url = at[1];
    });
    if (code === 0 && url) {
      await api('POST', '/spares', { sprite, state: 'ready', url });
      log.log(`[provisioner] ${sprite} is ready and asleep`);
      return { spare: sprite };
    }
    await api('POST', '/spares', { sprite, state: 'failed' });
    log.error(`[provisioner] the spare ${sprite} failed (exit ${code})`);
    return { failed: sprite };
  }

  /** Spares made until there are enough. Runs beside drain(): a sign-up
   *  never waits behind a spare being made. A second call while one runs
   *  does nothing. */
  async function topUp() {
    if (!spares || !onFly) return { off: true };
    if (sparing) return { skipped: true };
    sparing = true;
    try {
      let r = { enough: true };
      for (let i = 0; i < spares; i += 1) {
        r = await makeSpare();
        if (!r.spare) return r;
      }
      return r;
    } finally {
      sparing = false;
    }
  }

  /** The queue first, then the spares. */
  async function work() {
    const r = await drain();
    topUp().catch((err) => log.error(`[provisioner] spare: ${err.message}`));
    return r;
  }

  /** `POST /poke` with the door's token starts a drain; `GET /health` answers. */
  function serve(port, host = '0.0.0.0') {
    const server = http.createServer((req, res) => {
      const answer = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && req.url === '/health') return answer(200, { ok: true, working, sparing });
      if (req.method === 'POST' && req.url === '/poke') {
        if (!adminToken || !same(req.headers['x-door-token'], adminToken)) return answer(401, { error: 'unauthorised' });
        work().catch((err) => log.error(`[provisioner] ${err.message}`));
        return answer(202, { ok: true });
      }
      return answer(404, { error: 'not found' });
    });
    return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
  }

  return { once, drain, topUp, work, serve, busy: () => working || sparing };
}
