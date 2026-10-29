// Making a drive on the PC: a port, a settings file, its service started, its
// check passed. The admin API asks for one (`POST /drives`), and so does the
// door: like the door sprite's provisioner (server/provisioner.js), the maker
// takes the drives the Directory has queued for the PC (`home: 'pchost'`),
// makes them one at a time, and reports each step back, ending with
// `{ state: 'ready', home: 'pchost' }`. The door pokes it through the router
// (POST /_host/poke); it also looks once at start and every five minutes, for
// anything asked while it was not listening. Once the door is ending a drive
// (`removing` or `deleting`), it refuses every step but `removed` with a 409:
// the maker stops making it there, and the reconcile takes it off the PC
// (server/host/reconcile.js).
//
// A name the registry already knows, in any state, is refused, and so is one
// whose folder is already on the PC: a removed drive keeps its folder until
// root deletes it, and a new drive of the same name must never open it. (On
// the PC the folders are under /var/lib/private, which only root can open, so
// there the registry alone keeps a removed drive's name taken.)
//
// A new drive runs the release the registry names for everyone, or the
// newest in /opt/marble/releases (server/host/releases.js).

import fsp from 'node:fs/promises';
import path from 'node:path';

import { checkDrive } from './check.js';
import { createDoor } from './door.js';
import { guestEntries, newSecret as makeSecret } from './guest-env.js';
import { pickPort } from './ports.js';
import { onDisk, releaseForNewDrives } from './releases.js';
import { NAME, RESERVED } from './settings.js';

const OWNER = /^[A-Za-z0-9_-]{1,64}$/;
const COHORT = /^[A-Za-z0-9_.-]{1,64}$/;
export const STEPS = ['machine', 'install', 'check'];

class Refusal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The door refused a step with a 409: it is ending the drive. */
class Ending extends Error {}

export function createMaker({
  settings,
  registry,
  units,
  envs,
  probe,
  notify = async () => {},
  fetchImpl = fetch,
  door: given = null,
  log = console,
  newSecret = makeSecret,
  inUse,
  checkMs = 90_000,
  check = checkDrive,
  drainEveryMs = 5 * 60 * 1000,
}) {
  const folderOf = (name) => path.join(settings.guestStateDir, name);
  // True, false, or null when it cannot be told (a folder only root may open).
  const exists = (p) => fsp.lstat(p).then(() => true, (err) => (err.code === 'ENOENT' || err.code === 'ENOTDIR' ? false : null));

  // One drive is made at a time, so two asked for at once cannot be given
  // the same port.
  let queue = Promise.resolve();
  const make = (job, opts) => {
    const run = queue.then(() => makeOne(job, opts));
    queue = run.catch(() => {});
    return run;
  };

  /** Make one drive. `onStep(step, state)` hears machine, install and check,
   *  each `now` then `done`. Resolves { ok, drive } or { ok: false, status, step, why }. */
  async function makeOne({ name, owner, cohort = null }, { onStep = async () => {}, door = false } = {}) {
    let step = 'machine';
    let started = false;
    try {
      if (!NAME.test(name ?? '')) throw new Refusal(400, 'a drive name is 3 to 40 of a-z, 0-9 and -, starting and ending with a letter or digit');
      if (RESERVED.has(name)) throw new Refusal(400, `${name} is a name marble-host keeps for itself`);
      if (!OWNER.test(owner ?? '')) throw new Refusal(400, 'owner is the door account id');
      if (cohort !== null && cohort !== undefined && !COHORT.test(String(cohort))) throw new Refusal(400, 'cohort is letters, digits, dots, dashes and underscores');
      if (registry.drive(name)) throw new Refusal(409, `${name} is already on this PC (${registry.drive(name).state})`);
      if ((await exists(folderOf(name))) === true) throw new Refusal(409, `a folder for ${name} is already on this PC; a drive removed earlier keeps its folder until root deletes it`);
      const { release } = await releaseForNewDrives({ registry, opt: settings.opt });
      if (!release) throw new Refusal(503, `there is no release in ${settings.opt}/releases yet, so no drive can be made; putting one there is the updater's job`);
      if (!(await onDisk(settings.opt, release))) throw new Refusal(503, `the release ${release} is not in ${settings.opt}/releases`);
      const taken = new Set(registry.drives().filter((d) => d.state !== 'removed').map((d) => d.port));
      const port = await pickPort({ range: settings.guestPorts, taken, never: [settings.routerPort, settings.adminPort], ...(inUse ? { inUse } : {}) });
      if (!port) throw new Refusal(503, `every port in ${settings.guestPorts.from}-${settings.guestPorts.to} is taken`);

      await onStep('machine', 'now');
      const secret = newSecret();
      const entries = guestEntries({ name, release, port, secret, doorKeys: settings.guestDoorKeys ?? settings.doorKeys, owner, publicSuffix: settings.publicSuffix, ownerName: settings.ownerName, cohort, direct: settings.direct });
      await registry.update((r) => {
        r.drives[name] = {
          name,
          port,
          owner,
          channel: 'everyone',
          release,
          previous: null,
          state: 'making',
          created: new Date().toISOString(),
          cohort: cohort ?? null,
          restarts: 0,
          ...(door ? { door: { reported: false } } : {}),
        };
      });
      await envs.write(name, entries);
      await onStep('machine', 'done');

      step = 'install';
      await onStep('install', 'now');
      started = true;
      await units.start(name);
      await onStep('install', 'done');

      step = 'check';
      await onStep('check', 'now');
      const checked = await check({ probe, port, release, secret, deadlineMs: checkMs });
      if (!checked.ok) throw new Error(checked.why);
      await onStep('check', 'done');

      await registry.update((r) => {
        r.drives[name].state = 'running';
      });
      await registry.event(name, 'made', { port, release, owner, cohort: cohort ?? null });
      log.log?.(`[host] made ${name} on :${port} (${release})`);
      return { ok: true, drive: registry.drive(name) };
    } catch (err) {
      if (err instanceof Ending) {
        // Removed or deleted at the door while it was being made: no alert,
        // and the reconcile takes what was made off the PC.
        if (started) await units.stop(name).catch(() => {});
        if (registry.drive(name)) {
          await registry.update((r) => {
            Object.assign(r.drives[name], { state: 'failed', failed: { step, why: err.message } });
          });
          await registry.event(name, 'failed', { step, why: err.message });
        }
        log.log?.(`[host] stopped making ${name} at ${step}: ${err.message}`);
        return { ok: false, status: 409, step, why: err.message, ending: true };
      }
      const status = err instanceof Refusal ? err.status : 500;
      if (status !== 500) return { ok: false, status, step, why: err.message };
      if (started) await units.stop(name).catch(() => {});
      if (registry.drive(name)) {
        await registry.update((r) => {
          Object.assign(r.drives[name], { state: 'failed', failed: { step, why: err.message } });
        });
      }
      await registry.event(name, 'failed', { step, why: err.message });
      await notify(name, 'failed', `Making ${name} stopped at ${step}: ${err.message}`, { once: false });
      log.error?.(`[host] making ${name} stopped at ${step}: ${err.message}`);
      return { ok: false, status, step, why: err.message };
    }
  }

  /** A drive whose making failed, tried again from its settings file (written
   *  afresh if it never was). */
  async function retry(name) {
    const d = registry.drive(name);
    if (!d || d.state !== 'failed') return { ok: false, status: 409, why: `${name} is not a drive whose making failed` };
    try {
      let secret = (await envs.read(name))?.MARBLE_DRIVE_SECRET;
      if (!secret) {
        secret = newSecret();
        await envs.write(name, guestEntries({ name, release: d.release, port: d.port, secret, doorKeys: settings.guestDoorKeys ?? settings.doorKeys, owner: d.owner, publicSuffix: settings.publicSuffix, ownerName: settings.ownerName, cohort: d.cohort, direct: settings.direct }));
      }
      await units.start(name);
      const checked = await check({ probe, port: d.port, release: d.release, secret, deadlineMs: checkMs });
      if (!checked.ok) throw new Error(checked.why);
      await registry.update((r) => {
        r.drives[name].state = 'running';
        delete r.drives[name].failed;
      });
      await registry.event(name, 'made', { port: d.port, release: d.release, retried: true });
      if (d.door && !d.door.reported) await reportReady(name);
      return { ok: true, drive: registry.drive(name) };
    } catch (err) {
      await units.stop(name).catch(() => {});
      await registry.update((r) => {
        r.drives[name].failed = { step: 'check', why: err.message };
      });
      return { ok: false, status: 500, step: 'check', why: err.message };
    }
  }

  // ------------------------------------------------------------- the door

  const client = given ?? (settings.doorAdminToken ? createDoor({ url: settings.doorUrl, token: settings.doorAdminToken, fetchImpl }) : null);

  /** Tell the Directory a drive is ready on the PC; remembered until it hears,
   *  or until it says it is ending the drive, which no word of ours changes. */
  async function reportReady(name) {
    try {
      await client.step(name, { state: 'ready', home: 'pchost' });
      await registry.update((r) => {
        if (r.drives[name]?.door) r.drives[name].door.reported = true;
      });
      return true;
    } catch (err) {
      if (err.status === 409) {
        await registry.update((r) => {
          if (r.drives[name]?.door) Object.assign(r.drives[name].door, { reported: true, ending: true });
        });
        log.log?.(`[host] the door is ending ${name} (${err.message}); it is taken off the PC at the next look`);
        return false;
      }
      log.error?.(`[host] could not tell the door ${name} is ready: ${err.message}; telling it at the next look`);
      return false;
    }
  }

  async function fromDoor(job) {
    // A 409 is the door ending the drive: making it stops at that step.
    const report = (step, state) =>
      client.step(job.name, { step, state }).catch((err) => {
        if (err.status === 409) throw new Ending(err.message);
        log.error?.(`[host] ${job.name}: could not report ${step} ${state}: ${err.message}`);
      });
    const have = registry.drive(job.name);
    if (have && have.owner === job.owner && have.state === 'running') {
      // Made already, and the door did not hear: tell it again.
      await registry.update((r) => {
        r.drives[job.name].door = { reported: false };
      });
      return reportReady(job.name);
    }
    log.log?.(`[host] the door asked for ${job.name}`);
    const r = await make({ name: job.name, owner: job.owner, cohort: job.cohort ?? null }, { onStep: report, door: true });
    if (r.ok) return reportReady(job.name);
    if (!r.ending) await report(r.step, 'failed').catch(() => {});
    return false;
  }

  let draining = false;
  /** Every drive the door has queued for the PC, one after another. */
  async function drain() {
    if (!client?.on) return { off: true };
    if (draining) return { skipped: true };
    draining = true;
    try {
      for (const d of registry.drives()) {
        if (d.door && !d.door.reported && d.state === 'running') await reportReady(d.name);
      }
      const tried = new Set();
      for (let i = 0; i < 50; i += 1) {
        const drives = await client.queue();
        const job = drives.find((d) => d.home === 'pchost' && !tried.has(d.name));
        if (!job) return { idle: true, made: tried.size };
        tried.add(job.name);
        await fromDoor(job);
      }
      return { more: true };
    } finally {
      draining = false;
    }
  }

  let timer = null;
  return {
    make,
    retry,
    drain,
    reportReady,
    /** A look at the door's queue, now, in the background. */
    poke() {
      drain().catch((err) => log.error?.(`[host] the door's queue: ${err.message}`));
    },
    start() {
      if (!client?.on) {
        log.log?.('[host] no DOOR_ADMIN_TOKEN: drives are made only through the admin API');
        return;
      }
      this.poke();
      timer = setInterval(() => this.poke(), drainEveryMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    busy: () => draining,
  };
}
