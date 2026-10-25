// Other people's drives on the PC, as the Console sees them (docs/HOSTING.md,
// "People in the Console"). Three things are joined into one list:
//
//   - the door's people (GET /_door/people, with DOOR_URL and DOOR_ADMIN_TOKEN
//     from door.env): who was invited, who has signed in, the study, and when
//     each step from invite to first document happened;
//   - marble-host's drives (GET /drives on 127.0.0.1, with HOST_ADMIN_TOKEN
//     from host.env): which run, which have an agent working, their memory,
//     release and restarts;
//   - each drive's last backup, /var/lib/marble-backup/status/<name>.json,
//     which anyone on the PC may read.
//
// Neither token leaves this file, and no invite's code reaches the page but
// the one link the owner has just made, in the answer to making it. The page
// gets counts and states, never what someone wrote: no email, no address, no
// sign-in, nothing from inside a drive. A field the door or marble-host add to
// their answers later stays here until it is named below.
//
// The actions are jobs like the Console's others (jobs.js): one at a time per
// drive, each kept in Activity. Each is a request to marble-host or the door,
// which do the work in their own processes, so a restart of the owner's drive
// cuts off an answer, never the work.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// Read as a namespace, so the day the updater lands and NOT_BUILT goes, the
// Release buttons come back by themselves rather than this import failing.
import * as hostAdmin from '../host/admin.js';
import { parseEnvFile } from '../hub/settings.js';

/** A drive's name on the PC, as marble-host has it (server/host/settings.js). */
export const NAME = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const BACKUP_STATUS = '/var/lib/marble-backup/status';
/** Why Move to canary and Roll back can't be pressed, or null once they can:
 *  marble-host answers its four updater routes 501 until the owner's updater
 *  exists, and says so in the same words. */
export const UPDATER_WHY = hostAdmin.NOT_BUILT?.why ?? null;

const DAY = 24 * 60 * 60 * 1000;
// Someone who signed in and hasn't reached a first document, with no step for
// this long, has stalled: the caution ring.
const STALL_MS = DAY;
// An invite is for one person, for two weeks, as `door.mjs invite` makes one.
const INVITE_USES = 1;
const INVITE_DAYS = 14;
const LOG_LINES = 200;
const ACTIVITY_LINES = 60;
const TIMEOUT = { door: 10_000, host: 8_000 };
const STEPS = ['invited', 'signedIn', 'consented', 'named', 'ready', 'agentConnected', 'firstDocument', 'updated'];
// The stages someone can stall in: theirs to take, not the PC's. A drive
// that is only known to be ready isn't one: its person may be using it.
const STALLABLE = new Set(['consent', 'naming', 'making', 'no-agent', 'no-document']);
const ENDING = new Set(['removing', 'deleting']);

const refuse = (message, status = 400) => Object.assign(new Error(message), { status });
const iso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const word = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const firstName = (v) => word(String(v ?? '').split(/\s+/)[0], 40);
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Claude, ChatGPT or an API key, from however it is said. */
function agentWord(v) {
  const s = String(v ?? '').toLowerCase();
  if (s === 'claude' || s === 'anthropic') return 'claude';
  if (s === 'chatgpt' || s === 'codex' || s === 'openai') return 'chatgpt';
  if (s === 'key' || s === 'api' || s === 'api-key') return 'key';
  return null;
}

// --------------------------------------------------------------- settings

/** One settings file: its values, why it can't be used, or null when it
 *  isn't there. Both hold an admin token, so one that others can read is
 *  refused, as tools/door.mjs and marble-host refuse it. */
function settingsFile(file) {
  if (!file) return null;
  const base = path.basename(file);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    return err.code === 'ENOENT' ? null : { why: `${base} can't be read (${err.code ?? 'error'})` };
  }
  if ((stat.mode & 0o077) !== 0) return { why: `${base} can be read by others; chmod 600 it first` };
  try {
    return { values: parseEnvFile(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    return { why: `${base} can't be read (${err.code ?? 'error'})` };
  }
}

/** Where the door and marble-host are, and their tokens: `{ host, door }`,
 *  each null without its file, or `{ why }` when the file can't be used. */
export function readSettings({ hostEnv = null, doorEnv = null } = {}) {
  const h = settingsFile(hostEnv);
  const d = settingsFile(doorEnv);
  let host = h;
  if (h?.values) {
    const port = Number(h.values.HOST_ADMIN_PORT || 4461);
    host = !h.values.HOST_ADMIN_TOKEN ? { why: 'host.env has no HOST_ADMIN_TOKEN' }
      : !Number.isInteger(port) || port < 1 || port > 65535 ? { why: 'HOST_ADMIN_PORT in host.env is not a port' }
        : { url: `http://127.0.0.1:${port}`, port, token: h.values.HOST_ADMIN_TOKEN };
  }
  let door = d;
  if (d?.values) {
    let url = null;
    try {
      url = new URL(d.values.DOOR_URL || 'https://marbledrive.app');
    } catch {}
    door = !d.values.DOOR_ADMIN_TOKEN ? { why: 'door.env has no DOOR_ADMIN_TOKEN' }
      : !url || !/^https?:$/.test(url.protocol) ? { why: 'DOOR_URL in door.env is not an address' }
        : { url: url.origin, token: d.values.DOOR_ADMIN_TOKEN };
  }
  return { host, door };
}

/** A way to ask the door or marble-host, with its token. What comes back is
 *  their JSON; a refusal is an Error whose message is theirs, never a token. */
function caller(side, s, fetchImpl) {
  const who = side === 'door' ? 'the door' : 'marble-host';
  return async (method, route, body = undefined) => {
    const url = new URL(side === 'door' ? `/_door${route}` : route, s.url);
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { authorization: `Bearer ${s.token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        // A redirect would carry the token somewhere else; it is an answer instead.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT[side]),
      });
    } catch {
      throw refuse(side === 'door' ? `the door at ${url.host} couldn't be reached` : `marble-host isn't answering on 127.0.0.1:${s.port}`, 502);
    }
    const text = await res.text().catch(() => '');
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (res.status === 401) throw refuse(`${who} refused the admin token in ${side === 'door' ? 'door.env' : 'host.env'}`, 502);
    // The door's admin API not yet deployed answers with the landing page.
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw refuse(`${who} answered ${res.status} without JSON${side === 'door' ? ': is its admin API deployed?' : ''}`, 502);
    }
    if (!res.ok) {
      const why = word(data.why, 300);
      const status = res.status === 501 || res.status === 404 || res.status === 409 ? res.status : res.status >= 500 ? 502 : 400;
      throw Object.assign(refuse(why ? `${who}: ${why}` : `${who} answered ${res.status}`, status), { why });
    }
    return data;
  };
}

// ------------------------------------------------------------------ joining

/** What a row is called: its drive, else what the invite was for, else the
 *  account's first name. */
const labelOf = (p) => p?.drive?.name ?? word(p?.invite?.note, 40) ?? firstName(p?.account?.name) ?? 'Someone';

/** The row's key, unique across drives, invites and accounts; a drive's name
 *  never holds a colon. An invite's id is not its code. */
const keyOf = (p, h) => p?.drive?.name ?? h?.name ?? (p?.invite?.id ? `invite:${p.invite.id}` : `account:${p?.account?.id ?? 'unknown'}`);

/** On the PC, or not yet anywhere: a drive on Fly is the fleet's to show. */
const onThePc = (p, hostNames) => !p.drive || p.drive.home === 'pchost' || hostNames.has(p.drive.name);

function timelineOf(p) {
  const t = p?.timeline ?? {};
  return Object.fromEntries(STEPS.map((k) => [k, iso(t[k])]));
}

function studyOf(p, h) {
  const s = p?.study ?? {};
  const consent = s.consent && typeof s.consent === 'object'
    ? { version: word(s.consent.version, 80), at: iso(s.consent.at), choice: s.consent.choice === 'given' ? 'given' : s.consent.choice === 'declined' ? 'declined' : null }
    : null;
  const cohort = p ? (s.cohort === 'study' ? 'study' : null) : (h?.cohort === 'study' ? 'study' : null);
  const withdrawn = iso(s.withdrawn);
  // Only the door knows a yes and a leaving: a drive it doesn't list is never
  // in the study here, so nothing of it can be exported.
  const inStudy = Boolean(p) && cohort === 'study' && consent?.choice === 'given' && !withdrawn;
  const raw = h?.study?.counts;
  const counts = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([k, v]) => /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k) && num(v) !== null).slice(0, 12))
    : null;
  return {
    invited: Boolean(p?.invite?.study),
    cohort,
    consent,
    withdrawn,
    deleteAsked: iso(s.deleteAsked),
    inStudy,
    counts: counts && Object.keys(counts).length ? counts : null,
    countsAt: iso(h?.study?.at),
  };
}

function hostOf(h) {
  if (!h) return null;
  const health = h.health && typeof h.health === 'object' ? h.health : null;
  return {
    state: word(h.state, 20),
    active: word(h.active, 20),
    release: word(h.release, 100),
    channel: h.channel === 'canary' ? 'canary' : 'everyone',
    restarts: num(h.restarts) ?? 0,
    memoryBytes: num(h.memoryBytes),
    created: iso(h.created),
    ok: typeof health?.ok === 'boolean' ? health.ok : null,
    working: num(health?.working),
    checkedAt: iso(health?.at),
    failed: h.failed && typeof h.failed === 'object' ? { step: word(h.failed.step, 40), why: word(h.failed.why, 200) } : null,
  };
}

/** A backup status file, or marble-host's copy of it, as counts and times. */
function backupOf(b) {
  if (!b || typeof b !== 'object') return null;
  return {
    at: iso(b.at),
    ok: b.ok === true,
    why: b.ok === true ? null : word(b.why, 200),
    files: num(b.files),
    bytes: num(b.bytes),
    changed: typeof b.changed === 'boolean' ? b.changed : null,
    lastGood: iso(b.lastGood),
  };
}

/** The starter pages an update left alone because their person changed them. */
function heldBackOf(h) {
  if (!Array.isArray(h?.heldBack)) return null;
  return h.heldBack
    .map((x) => word(typeof x === 'string' ? x : x?.name ?? x?.title ?? x?.path, 80))
    .filter(Boolean)
    .slice(0, 20);
}

/** How far someone is: before a drive, the door says; once it is ready,
 *  marble-host does (with the door's timeline for what it doesn't report). */
function stageOf({ p, h, hostKnown, agent, timeline }) {
  const d = p?.drive ?? null;
  if (p && !d) {
    if (!p.account) return 'invited';
    if (p.invite?.study && !p.study?.consent) return 'consent';
    return 'naming';
  }
  if (d) {
    if (ENDING.has(d.state)) return d.state;
    if (d.state === 'removed') return 'removing';
    if (d.state === 'held') return 'held';
    if (d.state === 'failed') return 'failed';
    if (d.state !== 'ready') return 'making';
    if (!h && hostKnown) return 'missing';
  }
  if (h) {
    if (h.state === 'making') return 'making';
    if (h.state === 'failed') return 'failed';
    if (h.state === 'suspended') return 'suspended';
    if (h.state === 'removed') return 'removing';
    if (h.health && h.health.ok === false) return 'down';
  }
  const working = num(h?.health?.working) ?? 0;
  const turns = num(h?.turnsToday) ?? 0;
  if (timeline.firstDocument || working > 0 || turns > 0) return 'using';
  if (timeline.agentConnected || (agent && agent !== 'none')) return 'no-document';
  // No agent is a fact only when marble-host says so; without its word the
  // drive is ready, and nothing more is claimed.
  return agent === 'none' ? 'no-agent' : 'ready';
}

/** Which agent a drive's person connected: marble-host's word (`agent`, from
 *  the drive's own /health/deep), else what the door's log said when it
 *  happened, else 'some' when the door knows one connected but not which.
 *  'none' is known to have none; null is not known. */
function agentOf(h, p, fromLog) {
  // A value this page doesn't know yet is still an agent connected.
  if (h && Object.hasOwn(h, 'agent')) return h.agent === null || h.agent === false || h.agent === '' ? 'none' : agentWord(h.agent) ?? 'some';
  if (fromLog) return fromLog;
  if (p?.timeline?.agentConnected) return 'some';
  return null;
}

/** One row for the page. */
function rowOf({ p = null, h = null, hostKnown, logAgent = null, backup = null, now }) {
  const timeline = timelineOf(p);
  const agent = agentOf(h, p, logAgent);
  const stage = stageOf({ p, h, hostKnown, agent, timeline });
  const working = num(h?.health?.working);
  const steps = STEPS.map((k) => Date.parse(timeline[k] ?? '')).filter(Number.isFinite);
  const lastStep = steps.length ? Math.max(...steps) : null;
  const active = [Date.parse(h?.lastActive ?? ''), Date.parse(p?.account?.seen ?? ''), lastStep ?? NaN].filter(Number.isFinite);
  const lastActive = active.length ? new Date(Math.max(...active)).toISOString() : iso(h?.created);
  const status = stage === 'down' || stage === 'failed' ? 'down'
    : working > 0 ? 'working'
      : stage === 'invited' ? 'waiting'
        : p?.account && STALLABLE.has(stage) && lastStep !== null && now - lastStep > STALL_MS ? 'stalled'
          : 'idle';
  const label = p ? labelOf(p) : h.name;
  const person = word(p?.invite?.note, 40) ?? firstName(p?.account?.name);
  return {
    key: keyOf(p, h),
    drive: p?.drive?.name ?? h?.name ?? null,
    label,
    person: person && person !== label ? person : null,
    stage,
    status,
    agent,
    working,
    turnsToday: num(h?.turnsToday),
    lastActive,
    lastStep: lastStep === null ? null : new Date(lastStep).toISOString(),
    timeline,
    invite: p?.invite ? { made: iso(p.invite.made), expires: iso(p.invite.expires), used: iso(p.invite.used), study: Boolean(p.invite.study) } : null,
    door: p?.drive ? { state: word(p.drive.state, 20), home: p.drive.home === 'pchost' ? 'pchost' : 'fly', created: iso(p.drive.created) } : null,
    host: hostOf(h),
    study: studyOf(p, h),
    backup,
    heldBack: heldBackOf(h),
  };
}

// The door's log lines the People list says in words; the rest (sessions,
// spares, credit, requests, the owner's own) are not about these people.
const ACTIVITY_KINDS = new Set([
  'invite-made', 'account-made', 'signed-in', 'consent-given', 'consent-declined', 'consent-withdrawn',
  'study-delete-asked', 'drive-asked', 'drive-ready', 'drive-failed', 'agent-connected', 'first-document',
  'drive-updated', 'drive-restarted', 'drive-remove-asked', 'drive-delete-asked', 'drive-removed', 'sessions-revoked',
]);

/** The door's audit log, as the People list says it: when, what kind, and
 *  who (the drive, or what the invite was for). Never an address, an
 *  account's id, or anything else a line's detail holds. */
function activityOf({ lines, people, hostNames }) {
  const byAccount = new Map();
  const byInvite = new Map();
  const drives = new Set();
  for (const p of people) {
    if (!onThePc(p, hostNames)) continue;
    const who = { who: labelOf(p), key: keyOf(p, null) };
    if (p.account?.id) byAccount.set(p.account.id, who);
    if (p.invite?.id) byInvite.set(p.invite.id, who);
    if (p.drive?.name) drives.add(p.drive.name);
  }
  const out = [];
  for (const l of lines ?? []) {
    if (!l || !ACTIVITY_KINDS.has(l.kind) || !iso(l.at)) continue;
    const d = l.detail && typeof l.detail === 'object' ? l.detail : {};
    const drive = typeof d.drive === 'string' && drives.has(d.drive) ? d.drive : null;
    const by = drive ? { who: drive, key: drive }
      : l.account && byAccount.has(l.account) ? byAccount.get(l.account)
        : l.kind === 'invite-made' && byInvite.has(d.invite) ? byInvite.get(d.invite) : null;
    if (!by) continue;
    const line = { at: l.at, kind: l.kind, who: by.who, key: by.key };
    if (l.kind === 'agent-connected') {
      const agent = agentWord(d.agent) ?? agentWord(d.cli) ?? Object.values(d).map(agentWord).find(Boolean) ?? null;
      if (agent) line.agent = agent;
    }
    if (l.kind === 'invite-made') line.study = d.cohort === 'study';
    out.push(line);
    if (out.length >= ACTIVITY_LINES) break;
  }
  return out;
}

/** The latest agent each drive connected, from the door's log (newest first). */
function agentsFromLog(lines) {
  const out = new Map();
  for (const l of lines ?? []) {
    if (l?.kind !== 'agent-connected' || typeof l.detail?.drive !== 'string' || out.has(l.detail.drive)) continue;
    const d = l.detail;
    const agent = agentWord(d.agent) ?? agentWord(d.cli) ?? Object.values(d).map(agentWord).find(Boolean) ?? null;
    if (agent) out.set(d.drive, agent);
  }
  return out;
}

/** Everyone on the PC, or on the way there: the door's people with a drive on
 *  the PC or none yet, then marble-host's drives the door doesn't list. A
 *  drive that is gone is left out; the People list says when it went. */
export function joinPeople({ people = null, drives = null, lines = [], backups = new Map(), now = Date.now() } = {}) {
  const hostKnown = Array.isArray(drives);
  const hostByName = new Map((drives ?? []).filter((d) => d && NAME.test(String(d.name ?? ''))).map((d) => [d.name, d]));
  const hostNames = new Set(hostByName.keys());
  const logAgents = agentsFromLog(lines);
  const rows = [];
  const listed = new Set();
  for (const p of people ?? []) {
    if (!p || typeof p !== 'object' || !onThePc(p, hostNames)) continue;
    const name = p.drive?.name ?? null;
    if (name && !NAME.test(name)) continue;
    if (p.drive?.state === 'removed') {
      listed.add(name);
      continue;
    }
    const h = name ? hostByName.get(name) ?? null : null;
    if (name) listed.add(name);
    rows.push(rowOf({ p, h, hostKnown, logAgent: name ? logAgents.get(name) : null, backup: backupOf(backups.get(name) ?? h?.backup), now }));
  }
  for (const h of hostByName.values()) {
    if (listed.has(h.name) || h.state === 'removed') continue;
    rows.push(rowOf({ h, hostKnown, backup: backupOf(backups.get(h.name) ?? h.backup), now }));
  }
  // Drives by name, then the people still on their way, by name.
  rows.sort((a, b) => (a.drive ? 0 : 1) - (b.drive ? 0 : 1) || a.label.localeCompare(b.label));
  return { rows, activity: Array.isArray(people) ? activityOf({ lines, people, hostNames }) : [] };
}

// -------------------------------------------------------------- the module

export function createPcHost({ hostEnv = null, doorEnv = null, statusDir = BACKUP_STATUS, jobs, fetchImpl = fetch, now = () => Date.now(), updaterWhy = UPDATER_WHY } = {}) {
  const got = { door: null, host: null }; // the last good answer of each: { at, ... }
  const failed = { door: null, host: null }; // why the last read of each failed
  let view = null;
  let reading = null;

  const settings = () => readSettings({ hostEnv, doorEnv });

  async function readDoor(s) {
    if (!s?.url) {
      got.door = null;
      failed.door = null;
      return;
    }
    const ask = caller('door', s, fetchImpl);
    try {
      const [people, log] = await Promise.all([ask('GET', '/people'), ask('GET', `/log?limit=${LOG_LINES}`).catch(() => null)]);
      if (!Array.isArray(people.people)) throw refuse('the door answered /people without a list', 502);
      got.door = { at: now(), people: people.people, lines: Array.isArray(log?.lines) ? log.lines : got.door?.lines ?? [] };
      failed.door = null;
    } catch (err) {
      failed.door = err.message;
    }
  }

  async function readHost(s) {
    if (!s?.url) {
      got.host = null;
      failed.host = null;
      return;
    }
    try {
      const out = await caller('host', s, fetchImpl)('GET', '/drives');
      if (!Array.isArray(out.drives)) throw refuse('marble-host answered /drives without a list', 502);
      got.host = { at: now(), drives: out.drives };
      failed.host = null;
    } catch (err) {
      failed.host = err.message;
    }
  }

  async function readBackups(names) {
    const out = new Map();
    await Promise.all([...names].filter((n) => NAME.test(n)).map(async (name) => {
      try {
        const s = JSON.parse(await fsp.readFile(path.join(statusDir, `${name}.json`), 'utf8'));
        if (s?.name === name) out.set(name, s);
      } catch {
        // No file is no backup yet.
      }
    }));
    return out;
  }

  const side = (s, which) => (!s ? null : {
    ok: !s.why && !failed[which] && Boolean(got[which]),
    why: s.why ?? failed[which] ?? null,
    at: got[which]?.at ?? null,
  });

  /** Read all three again and join them. One read at a time. */
  function read() {
    if (reading) return reading;
    reading = (async () => {
      const s = settings();
      if (!s.door && !s.host) {
        got.door = null;
        got.host = null;
        view = { on: false };
        return view;
      }
      await Promise.all([readDoor(s.door), readHost(s.host)]);
      const names = new Set([
        ...(got.door?.people ?? []).map((p) => p?.drive?.name).filter(Boolean),
        ...(got.host?.drives ?? []).map((d) => d?.name).filter(Boolean),
      ]);
      const { rows, activity } = joinPeople({
        people: got.door?.people ?? null,
        drives: got.host?.drives ?? null,
        lines: got.door?.lines ?? [],
        backups: await readBackups(names),
        now: now(),
      });
      const live = rows.filter((r) => r.drive && !ENDING.has(r.stage));
      view = {
        on: true,
        at: now(),
        door: side(s.door, 'door'),
        host: side(s.host, 'host'),
        updater: { available: !updaterWhy, why: updaterWhy },
        counts: {
          drives: live.length,
          working: got.host ? live.filter((r) => r.working > 0).length : null,
          invites: rows.filter((r) => r.stage === 'invited').length,
        },
        rows,
        activity,
      };
      return view;
    })().finally(() => {
      reading = null;
    });
    return reading;
  }

  // ------------------------------------------------------------- actions

  function ask(which) {
    const s = settings()[which];
    if (!s) throw refuse(which === 'door' ? 'there is no door.env on this machine' : 'there is no host.env on this machine', 409);
    if (s.why) throw refuse(s.why, 409);
    return caller(which, s, fetchImpl);
  }

  async function known(name) {
    if (!NAME.test(String(name ?? ''))) throw refuse('not a drive’s name');
    const v = view?.on ? view : await read();
    if (!v.on) throw refuse('there is no host.env or door.env on this machine', 404);
    const row = v.rows.find((r) => r.drive === name) ?? (await read()).rows?.find((r) => r.drive === name);
    if (!row) throw refuse(`there is no drive ${name} on the PC`, 404);
    return row;
  }

  const start = (kind, name, title, run, meta = {}) => jobs.start({ kind: `pc-${kind}`, title, target: `pc:${name}`, meta: { drive: name, ...meta }, run });

  // What each of marble-host's own verbs is called, and what it says after.
  const VERBS = {
    restart: { title: (n) => `Restart ${n}`, done: (n, d) => `${n} is ${d?.state ?? 'restarting'}${d ? `, ${plural(d.restarts ?? 0, 'restart')} so far` : ''}.` },
    suspend: { title: (n) => `Suspend ${n}`, done: (n) => `${n} is suspended. It stays stopped, through restarts of the PC, until you resume it; its person sees that their drive is resting.` },
    resume: { title: (n) => `Resume ${n}`, done: (n, d) => `${n} is ${d?.state ?? 'running'} again.` },
    backup: { title: (n) => `Back ${n} up now`, done: (n) => `The backup runs on the PC as its own service; Health shows when it ends.` },
  };

  async function hostVerb(name, verb) {
    const row = await known(name);
    if (!row.host) throw refuse(`${name} isn't one of marble-host's drives`, 409);
    const call = ask('host');
    return start(verb, name, VERBS[verb].title(name), async (ctx) => {
      ctx.say(`==> asking marble-host to ${verb === 'backup' ? 'back up' : verb} ${name}`);
      const out = await call('POST', `/drives/${encodeURIComponent(name)}/${verb}`, {});
      ctx.say(VERBS[verb].done(name, out?.drive && typeof out.drive === 'object' ? out.drive : null));
      return { state: word(out?.drive?.state, 20) };
    });
  }

  async function exportStudy(name) {
    const row = await known(name);
    // The study's data leaves a drive only with consent on file; the root
    // helper checks the drive's own settings again.
    if (!row.study.inStudy) throw refuse(`${name} isn't in the study, so nothing of it is exported`, 409);
    const call = ask('host');
    return start('export', name, `Export ${name}'s study data`, async (ctx) => {
      ctx.say(`==> asking marble-host to export ${name}'s study data`);
      await call('POST', `/drives/${encodeURIComponent(name)}/export`, {});
      ctx.say(`The export runs on the PC as its own service. It copies into Research/Probe study/${name}/ in your drive, in a folder named for when it ran.`);
    });
  }

  async function remove(name, confirm) {
    if (confirm !== name) throw refuse(`type ${name} to remove it`);
    const row = await known(name);
    if (ENDING.has(row.stage)) throw refuse(`${name} is already being removed`, 409);
    // The door is where a drive ends: the edge stops serving it at once, and
    // marble-host signs its agents out and deletes it at its next look. Only a
    // drive the door doesn't know goes to marble-host directly.
    const viaDoor = Boolean(row.door);
    const call = ask(viaDoor ? 'door' : 'host');
    return start('remove', name, `Remove ${name}`, async (ctx) => {
      if (viaDoor) {
        ctx.say(`==> asking the door to remove ${name}`);
        const out = await call('POST', `/drives/${encodeURIComponent(name)}/remove`, { confirm: name });
        if (out.already) ctx.say(`${name} was already ending at the door.`);
        else ctx.say(`${name} is removed at the door, and ${plural(num(out.sessions) ?? 0, 'session')} of its person ended.`);
        ctx.say('marble-host finishes at its next look at the door: it signs the drive’s agents out and deletes it from the PC. Its encrypted backup stays until you forget it, and the name is never given out again.');
      } else {
        ctx.say(`==> asking marble-host to remove ${name}`);
        await call('POST', `/drives/${encodeURIComponent(name)}/remove`, { confirm: name });
        ctx.say(`${name} is stopped and its settings file is gone. Its folder stays on the PC: deleting it is the root helper’s job.`);
      }
    });
  }

  async function moveChannel(name, channel) {
    if (updaterWhy) throw refuse(`Unavailable: ${updaterWhy}`, 501);
    const row = await known(name);
    if (!row.host) throw refuse(`${name} isn't one of marble-host's drives`, 409);
    const call = ask('host');
    return start('canary', name, `Move ${name} to ${channel === 'canary' ? 'canary' : 'everyone'}`, async (ctx) => {
      ctx.say(`==> asking marble-host to put ${name} on the ${channel} channel`);
      await call('POST', `/drives/${encodeURIComponent(name)}/channel`, { channel });
      ctx.say(`${name} follows the ${channel} channel; the updater moves it when no agent is working there.`);
    });
  }

  async function rollback(name) {
    if (updaterWhy) throw refuse(`Unavailable: ${updaterWhy}`, 501);
    const row = await known(name);
    if (!row.host) throw refuse(`${name} isn't one of marble-host's drives`, 409);
    const call = ask('host');
    return start('rollback', name, `Roll ${name} back`, async (ctx) => {
      ctx.say(`==> asking marble-host to roll ${name} back to its last release`);
      await call('POST', '/rollback', { name });
      ctx.say(`${name} goes back to its last release when no agent is working there.`);
    });
  }

  /** One action on one drive, as a job. */
  function act(name, verb, body = {}) {
    if (VERBS[verb]) return hostVerb(name, verb);
    if (verb === 'export') return exportStudy(name);
    if (verb === 'remove') return remove(name, body?.confirm);
    if (verb === 'canary') return moveChannel(name, body?.channel === 'everyone' ? 'everyone' : 'canary');
    if (verb === 'rollback') return rollback(name);
    return Promise.reject(refuse('no such action', 404));
  }

  /** An invite for one person, as a job kept in Activity. The link holds the
   *  invite's code, so it goes to the page once, in this answer, and nowhere
   *  else: not the job's output, not its record, not the stream. */
  async function invite({ note = '', study = false } = {}) {
    const text = word(note, 60);
    if (!text) throw refuse('a name is needed: it is how the invite shows here until they sign in');
    const call = ask('door');
    let hand;
    const handed = new Promise((resolve) => {
      hand = resolve;
    });
    const job = jobs.start({
      kind: 'pc-invite',
      title: study ? `Invite ${text} into the study` : `Invite ${text}`,
      target: null,
      meta: { study: Boolean(study) },
      run: async (ctx) => {
        try {
          ctx.say('==> asking the door for an invite');
          const out = await call('POST', '/invite', { note: text, uses: INVITE_USES, days: INVITE_DAYS, study: Boolean(study) });
          const link = typeof out.link === 'string' && /^https?:\/\/\S+$/.test(out.link) ? out.link : null;
          if (!link) throw refuse('the door made an invite but sent no link', 502);
          ctx.secret(link);
          ctx.secret(/\/join\/([^/?#]+)/.exec(link)?.[1]);
          const expires = iso(out.invite?.expires);
          ctx.say(`One link for ${text}${study ? ', in the study' : ''}${expires ? `, good until ${expires.slice(0, 10)}` : ''}. It was shown once, on the page; the door keeps only its hash.`);
          hand({ link, invite: { note: text, study: Boolean(study), expires } });
          return { study: Boolean(study), expires };
        } catch (err) {
          hand({ error: err });
          throw err;
        }
      },
    });
    const out = await handed;
    if (out.error) throw Object.assign(refuse(out.error.message, out.error.status ?? 502), { job: jobs.get(job.id) ?? job });
    return { job: jobs.get(job.id) ?? job, link: out.link, invite: out.invite };
  }

  return {
    read,
    /** The last list, read now if there is none. */
    view: async () => view ?? read(),
    act,
    invite,
  };
}
