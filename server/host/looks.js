// What marble-host knows of each running drive beyond /health
// (docs/HOSTING.md, "marble-host and the study"), for GET /drives and the
// door's sign-up timeline, looked at when marble-host starts and every five
// minutes:
//
//   - /health/deep: which agent its person connected (claude, chatgpt, or a
//     key of their own), whether they have made a document, how many turns
//     its agents began today and when it was last used, and the starter
//     pages an update left alone, if the drive says
//   - /health/study, for a drive in the study only (MARBLE_STUDY=1 and
//     MARBLE_CONSENT in its settings file), at most every ten minutes:
//     counts and times, never anything its person wrote
//
// The first time /health/deep shows an agent, or a document, on a drive the
// door asked for, the door hears `agent-connected` or `first-document`. The
// registry keeps that it heard (`told`), so marble-host starting again
// doesn't say it twice. /health/deep runs four short CLI commands inside the
// drive when it hasn't for a minute, which is why this looks no more often.

/** The agent a drive's person connected, from /health/deep: claude,
 *  chatgpt, key (an API key of their own, in Agents settings) or null. */
export function agentOf(deep) {
  if (!deep) return null;
  if (deep.claude?.signedIn) return 'claude';
  if (deep.codex?.signedIn) return 'chatgpt';
  if (deep.agentConnected) return 'key';
  return null;
}

const number = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const time = (v) => (typeof v === 'string' && ISO.test(v) ? v : null);
const COUNT = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

/** /health/study's answer as counts alone: every number but its own `ok`
 *  and `at`, under a plain name, at most sixteen of them. */
export function studyCounts(answer) {
  const out = {};
  for (const [key, value] of Object.entries(answer ?? {})) {
    if (key === 'ok' || key === 'at' || !COUNT.test(key) || number(value) === null) continue;
    out[key] = value;
    if (Object.keys(out).length >= 16) break;
  }
  return out;
}

/** The starter pages an update held back, if /health/deep names them. */
function heldBackOf(deep) {
  if (!Array.isArray(deep?.heldBack)) return undefined;
  return deep.heldBack
    .map((x) => (typeof x === 'string' ? x : x?.path ?? x?.name ?? x?.title ?? null))
    .filter((x) => typeof x === 'string' && x.length > 0 && x.length <= 200)
    .slice(0, 50);
}

export function createLooks({ registry, probe, envs, door = null, busy = () => false, log = console, everyMs = 5 * 60 * 1000, studyEveryMs = 10 * 60 * 1000, now = Date.now }) {
  const deeps = new Map();
  const studies = new Map();
  let ticking = false;
  let timer = null;
  const at = () => new Date(now()).toISOString();

  /** Once per drive: the door hears it, or says it never will (a 4xx). */
  async function tell(name, kind, detail = null) {
    if (!door?.on || registry.drive(name)?.told?.[kind]) return;
    try {
      await door.event(name, kind, detail);
    } catch (err) {
      if (!err.status || err.status >= 500) {
        log.error?.(`[host] could not tell the door ${kind} for ${name}: ${err.message}; telling it at the next look`);
        return;
      }
      log.error?.(`[host] the door refused ${kind} for ${name}: ${err.message}`);
    }
    await registry.update((r) => {
      const x = r.drives[name];
      if (x) x.told = { ...(x.told ?? {}), [kind]: at() };
    });
  }

  async function look(d) {
    const env = await envs.read(d.name).catch(() => null);
    const secret = env?.MARBLE_DRIVE_SECRET;
    if (!secret) return;
    const deep = await probe.deep(d.port, secret);
    if (deep) {
      const reading = {
        agent: agentOf(deep),
        docs: number(deep.docs),
        turnsToday: number(deep.turnsToday),
        lastActive: time(deep.lastActive),
        heldBack: heldBackOf(deep),
        at: at(),
      };
      deeps.set(d.name, reading);
      if (d.door) {
        if (reading.agent) await tell(d.name, 'agent-connected', { agent: reading.agent });
        if (reading.docs > 0) await tell(d.name, 'first-document');
      }
    }
    if (env.MARBLE_STUDY !== '1' || !env.MARBLE_CONSENT) {
      studies.delete(d.name);
      return;
    }
    const last = studies.get(d.name);
    if (last && now() - last.read < studyEveryMs) return;
    const answer = await probe.study(d.port, secret);
    if (answer) studies.set(d.name, { counts: studyCounts(answer), at: time(answer.at) ?? at(), read: now() });
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      for (const d of registry.drives()) {
        if (d.state !== 'running' || busy(d.name)) continue;
        await look(d).catch((err) => log.error?.(`[host] looking at ${d.name}: ${err.message}`));
      }
      // A drive being removed, or gone, keeps no reading; one suspended keeps
      // its last.
      const kept = new Set(registry.drives().filter((d) => d.state !== 'removed' && d.state !== 'removing').map((d) => d.name));
      for (const map of [deeps, studies]) for (const name of [...map.keys()]) if (!kept.has(name)) map.delete(name);
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    /** What GET /drives adds to a drive's row from the last look. */
    row(name) {
      const deep = deeps.get(name) ?? null;
      const study = studies.get(name) ?? null;
      return {
        agent: deep?.agent ?? null,
        turnsToday: deep?.turnsToday ?? null,
        lastActive: deep?.lastActive ?? null,
        study: study ? { counts: study.counts, at: study.at } : null,
        ...(deep?.heldBack ? { heldBack: deep.heldBack } : {}),
      };
    },
    start() {
      const go = () => tick().catch((err) => log.error?.(`[host] looking at the drives: ${err.message}`));
      go();
      timer = setInterval(go, everyMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
