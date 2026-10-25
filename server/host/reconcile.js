// marble-host's look at the door's people, at start and every five minutes
// (docs/HOSTING.md, "marble-host and the study"), for what only the door
// knows:
//
//   - who is in the study. A drive whose person said yes and hasn't left has
//     MARBLE_STUDY=1 and MARBLE_CONSENT=<version>@<at> in its settings file;
//     any other has neither. Nothing is restarted for it: the export helper
//     reads the file each time it runs, and the drive takes it up when it
//     next starts.
//   - which drives are ending: `removing` (its owner removed it at the door)
//     or `deleting` (its person deleted it from the account page). The
//     remover takes each off the PC and tells the door `removed`.
//
// A row speaks for a drive here only when it names that drive, on the PC
// host, for the account the drive was made for. A drive the door doesn't
// list is in no study. When the door can't be reached, nothing changes. A
// removal cut off part way (`removing` in the registry) is finished here
// whoever began it, with the door or without one.

const ENDING = new Set(['removing', 'deleting', 'removed']);
// The door's own rule for a consent form's version (CONSENT_VERSION_RE), and
// the time it records an answer at: both go into the settings file as they
// are, so anything else is not written.
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** A row of /_door/people as MARBLE_CONSENT: `<version>@<at>` for someone
 *  in the study (its cohort is the study's, they said yes, and they haven't
 *  left), else null. */
export function consentOf(row) {
  const s = row?.study;
  if (s?.cohort !== 'study' || s?.consent?.choice !== 'given' || s?.withdrawn) return null;
  const { version, at } = s.consent;
  if (typeof version !== 'string' || !VERSION.test(version) || typeof at !== 'string' || !ISO.test(at)) return null;
  return `${version}@${at}`;
}

export function createReconciler({ registry, envs, door = null, remover, log = console, everyMs = 5 * 60 * 1000 }) {
  let ticking = false;
  let timer = null;

  /** The study's two settings as `consent` says: 'joined', 'left' or null
   *  when the file already says so (or there is no file). */
  async function studySettings(name, consent) {
    const env = await envs.read(name);
    if (!env) return null;
    if (consent) {
      if (env.MARBLE_STUDY === '1' && env.MARBLE_CONSENT === consent) return null;
      await envs.update(name, { MARBLE_STUDY: '1', MARBLE_CONSENT: consent });
      await registry.event(name, 'study', { in: true, consent });
      return 'joined';
    }
    if (env.MARBLE_STUDY === undefined && env.MARBLE_CONSENT === undefined) return null;
    await envs.update(name, { MARBLE_STUDY: null, MARBLE_CONSENT: null });
    await registry.event(name, 'study', { in: false });
    return 'left';
  }

  async function tick() {
    if (ticking) return { skipped: true };
    ticking = true;
    try {
      let rows = null;
      if (door?.on) {
        try {
          rows = new Map();
          for (const p of await door.people()) {
            const name = p?.drive?.name;
            if (typeof name === 'string' && p.drive.home === 'pchost') rows.set(name, p);
          }
        } catch (err) {
          rows = null;
          log.error?.(`[host] could not read the door's people (${err.message}); the study's settings and removals wait for the next look`);
        }
      }
      const done = { joined: [], left: [], removed: [], failed: [], read: rows !== null };
      const ending = [];
      for (const d of registry.drives()) {
        const p = rows?.get(d.name) ?? null;
        const ours = Boolean(p) && Boolean(d.owner) && p.account?.id === d.owner;
        const ends = ours && ENDING.has(p.drive.state);
        if (d.state === 'removing') {
          ending.push({ name: d.name, by: d.removing?.by ?? 'owner', door: Boolean(d.removing?.door) || ends });
          continue;
        }
        if (d.state === 'removed') {
          // The door didn't hear `removed` the last time: tell it again.
          if (ends && p.drive.state !== 'removed') ending.push({ name: d.name, by: 'door', door: true });
          continue;
        }
        if (ends) {
          ending.push({ name: d.name, by: p.drive.state === 'deleting' ? 'person' : 'door', door: true });
          continue;
        }
        if (rows === null || d.state === 'making') continue;
        try {
          const changed = await studySettings(d.name, ours ? consentOf(p) : null);
          if (changed) done[changed].push(d.name);
        } catch (err) {
          log.error?.(`[host] could not set ${d.name}'s study settings: ${err.message}`);
        }
      }
      for (const job of ending) {
        const r = await remover.remove(job.name, { by: job.by, door: job.door });
        (r.ok ? done.removed : done.failed).push(job.name);
      }
      return done;
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    start() {
      if (!door?.on) log.log?.('[host] no DOOR_ADMIN_TOKEN: no study settings or removals come from the door');
      const look = () => tick().catch((err) => log.error?.(`[host] the door's people: ${err.message}`));
      look();
      timer = setInterval(look, everyMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
