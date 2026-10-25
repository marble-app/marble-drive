// Taking a drive off the PC for good, the same way whoever asked
// (docs/HOSTING.md, "marble-host and the study"): the door, once its owner
// removed it there or its person deleted it from the account page
// (`removing` or `deleting` in /_door/people, server/host/reconcile.js), or
// the owner here (the admin API's remove, `tools/pc-host.mjs remove`). In
// this order:
//
//   1. its CLIs sign out (POST /health/logout) while it runs, so no login of
//      its person's is left signed in on the PC
//   2. its service stops
//   3. its settings file is deleted
//   4. marble-guest-remove@<name>.service deletes its folder, home and all.
//      That is root's helper, and it refuses unless 2 and 3 are done; it
//      waits for a backup of the drive that is running to end
//   5. the door hears `removed`, when the door is what is ending it
//   6. the registry marks it removed, so its name is never given out again
//
// From the first step the registry says `removing`: the router answers
// resting, the watcher and boot leave it alone, and a removal cut off part
// way is finished at the reconcile's next look. A step that fails stops the
// removal there, to be tried again. In user mode there is no root helper, so
// the folder stays where the trial keeps it, and the event says so.

export function createRemover({ registry, units, envs, probe, door = null, log = console, now = () => new Date().toISOString() }) {
  const going = new Map();

  /** What the door said to `removed`: told, unknown (it has no such drive)
   *  or not-told (it could not be reached, or refused; asked again at the
   *  next look while it still lists the drive as ending). */
  async function tellDoor(name) {
    if (!door?.on) return 'not-told';
    try {
      await door.step(name, { state: 'removed' });
      return 'told';
    } catch (err) {
      if (err.status === 404) return 'unknown';
      log.error?.(`[host] could not tell the door ${name} is removed: ${err.message}`);
      return 'not-told';
    }
  }

  async function removeOne(name, by, tell) {
    let d = registry.drive(name);
    if (!d) return { ok: false, status: 404, why: `there is no drive ${name} on this PC` };
    if (d.state === 'making') return { ok: false, status: 409, why: `${name} is being made; remove it once that ends` };
    if (d.state === 'removed') {
      const told = tell ? await tellDoor(name) : null;
      return { ok: true, already: true, drive: d, ...(told ? { door: told } : {}) };
    }
    if (d.state !== 'removing') {
      await registry.update((r) => {
        Object.assign(r.drives[name], { state: 'removing', removing: { at: now(), by, door: Boolean(tell), was: d.state } });
      });
      await registry.event(name, 'removing', { by });
      d = registry.drive(name);
    }
    const plan = d.removing ?? { by, door: Boolean(tell), was: 'running' };
    try {
      // 1. Only a drive that was running answers; one cut off after its
      //    settings went has no passphrase left to ask with.
      let logout = null;
      if (plan.was === 'running') {
        const secret = (await envs.read(name))?.MARBLE_DRIVE_SECRET ?? null;
        if (secret) logout = await probe.logout(d.port, secret);
        if (!logout) log.error?.(`[host] ${name} did not sign its CLIs out; their logins go with its folder`);
        else if (logout.claude === 'failed' || logout.codex === 'failed') log.error?.(`[host] ${name} could not sign out of every CLI (claude ${logout.claude}, codex ${logout.codex}); their logins go with its folder`);
      }
      // 2, 3.
      await units.stop(name);
      await envs.remove(name);
      // 4.
      let folder = 'deleted';
      if (units.mode === 'user') folder = 'kept';
      else await units.helper('remove', name);
      // 5.
      const told = plan.door ? await tellDoor(name) : null;
      // 6.
      await registry.update((r) => {
        const x = r.drives[name];
        x.state = 'removed';
        x.removed = now();
        delete x.removing;
      });
      const detail = {
        by: plan.by,
        ...(logout ? { claude: logout.claude, codex: logout.codex } : { logout: plan.was === 'running' ? 'no-answer' : 'not-running' }),
        folder,
        ...(told ? { door: told } : {}),
      };
      await registry.event(name, 'removed', detail);
      log.log?.(`[host] removed ${name} (${plan.by}); its folder ${folder === 'deleted' ? 'is deleted' : 'stays: user mode has no root helper'}`);
      return { ok: true, drive: registry.drive(name), detail };
    } catch (err) {
      log.error?.(`[host] removing ${name} stopped: ${err.message}; the next look tries again`);
      await registry.event(name, 'remove-failed', { why: String(err.message).slice(0, 300) });
      return { ok: false, status: 500, why: err.message };
    }
  }

  return {
    /** Take a drive off the PC: { ok, drive, detail } or { ok: false,
     *  status, why }. `door` is whether the door is ending it, and so hears
     *  `removed`. Asked again while it runs, it is the same removal. */
    remove(name, { by = 'owner', door: tell = false } = {}) {
      if (going.has(name)) return going.get(name);
      const run = removeOne(name, by, tell).finally(() => going.delete(name));
      going.set(name, run);
      return run;
    },
    busy: (name) => going.has(name),
  };
}
