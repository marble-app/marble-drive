// Automations that run by themselves: what Make it alive builds.
//
// An automation is an element carrying its own brief (runtime/agent-run.js):
//
//   <button data-marble-run="Gather what is new about the Ai2 project from
//     Bryan's Days and update the notes under Progress."
//     data-marble-scope="progress" data-marble-on="daily 07:00">Update now</button>
//
// `press` runs it when it is pressed. Any other `data-marble-on` is a
// schedule, and the host runs it on that schedule with no page open: the same
// brief, aimed at the same document and element, as a press would send. A
// press still runs it now. `data-marble-paused` on the trigger holds it.
//
// Schedules, in the zone the daily run uses:
//   hourly | every 3h | every 2d | daily 07:00 | weekly mon 07:00
// Nothing runs more often than once an hour.
//
// When it last ran is read off the conversations, as server/daily.js reads
// the day's run: each scheduled run is a conversation titled for its trigger
// and aimed at its document, so a restart neither forgets a run nor starts a
// second one. A trigger with no run yet counts from when this host first saw
// it, so making something alive does not set it off at once.
//
// What a run costs is kept small: one run of a trigger at a time (a run still
// going when the next is due holds the next), at most three scheduled runs
// across the drive at once, and the file is read again just before a run, so
// a pause or a delete made since the last scan wins.
//
// A paused Fly Sprite runs no timers, so any request nudges this too (as it
// does the day), and a minute tick covers a host that is simply awake. The
// timer holds nothing up: a sprite asleep at 07:00 runs the morning's run when
// something next wakes it.

import { localTime, parseAt } from './daily.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** A `data-marble-on` value → a schedule, or null when it is not one. */
export function parseSchedule(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t || t === 'press') return null;
  if (t === 'hourly') return { every: HOUR };
  let m = /^every (\d{1,3}) ?(h|hours?|d|days?)$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    if (!n) return null;
    return { every: n * (m[2].startsWith('h') ? HOUR : DAY) };
  }
  m = /^daily (\d{1,2}:\d{2})$/.exec(t);
  if (m) {
    const at = parseAt(m[1]);
    return at === null ? null : { at };
  }
  m = /^weekly (sun|mon|tue|wed|thu|fri|sat)\w* (\d{1,2}:\d{2})$/.exec(t);
  if (m) {
    const at = parseAt(m[2]);
    return at === null ? null : { at, day: DAYS.indexOf(m[1]) };
  }
  return null;
}

/** Whether a schedule is due at `t`, having last run (or been first seen) at `last`. */
export function isDue(schedule, last, t, zone) {
  if (schedule.every) return t - last >= schedule.every;
  const nowAt = localTime(t, zone);
  if (nowAt.minutes < schedule.at) return false;
  if (schedule.day != null && weekday(t, zone) !== schedule.day) return false;
  // Due once the slot has passed today and nothing ran since it.
  const then = localTime(last, zone);
  return !(then.date === nowAt.date && then.minutes >= schedule.at);
}

function weekday(t, zone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(new Date(t)).toLowerCase();
  return DAYS.indexOf(name.slice(0, 3));
}

const unescape = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// An opening tag, with quoted values that may hold a > of their own.
const TAG = /<[a-zA-Z][\w-]*((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** The scheduled triggers in a document's source. */
export function triggersIn(source) {
  const text = String(source ?? '');
  if (!text.includes('data-marble-on')) return [];
  const found = [];
  for (const [, attrs] of text.matchAll(TAG)) {
    if (!attrs || !attrs.includes('data-marble-on') || !attrs.includes('data-marble-run')) continue;
    const a = {};
    for (const [, name, d, s, bare] of attrs.matchAll(ATTR)) a[name.toLowerCase()] = unescape(d ?? s ?? bare ?? '');
    const schedule = parseSchedule(a['data-marble-on']);
    const brief = (a['data-marble-run'] ?? '').trim();
    const id = a['data-marble-id'];
    if (!schedule || !brief || !id || 'data-marble-transient' in a) continue;
    found.push({ id, brief, scope: a['data-marble-scope'] || null, on: a['data-marble-on'].trim(), schedule, paused: 'data-marble-paused' in a });
  }
  return found;
}

/** A scheduled run's conversation title: how its last run is found again. */
export const runTitle = (docPath, id) => `Kept alive · ${docPath.split('/').pop()} · ${id}`;

/** What a scheduled run is asked: the trigger's own brief, said to be one. */
export function runPrompt({ brief, on, id }) {
  return [
    `This is a scheduled run (${on}) of the automation on [data-marble-id="${id}"] in this document. Nobody pressed anything and nobody is watching, so do what its brief says and nothing more:`,
    '',
    brief,
    '',
    'Change only what the brief covers, keep what a person wrote, and if nothing is new, change nothing. Where the document shows when this last ran, set it to now.',
  ].join('\n');
}

/**
 * `store` lists and reads documents; `start({ prompt, target, title,
 * selection })` begins a run; `conversations()` lists every conversation's
 * meta. Returns `{ nudge, check, stop, triggers }`.
 */
export function createAlive({
  store,
  start,
  conversations,
  zone = 'America/Los_Angeles',
  now = Date.now,
  tickMs = 60_000,
  scanMs = 5 * 60_000,
  retryMs = 15 * 60_000,
  // Every request nudges; one look at the drive per this long is plenty.
  gapMs = 20_000,
  // Scheduled runs going at once, across the drive. The rest wait a tick.
  maxRunning = 3,
  schedule = setInterval,
  log = console,
}) {
  try {
    localTime(0, zone);
  } catch {
    log.error?.(`[alive] "${zone}" is not a time zone — nothing runs on a schedule`);
    return { nudge: async () => [], check: async () => [], triggers: () => [], stop() {} };
  }

  const docs = new Map(); // path -> { modified, triggers }
  const firstSeen = new Map(); // key -> ms
  const startedAt = new Map(); // key -> ms: runs this host started
  const lastTry = new Map(); // key -> ms
  let known = null; // key -> the last run the conversations show, once read
  let going = new Set(); // keys whose last run is still at work
  let busy = 0; // scheduled runs at work, across the drive
  let scanned = -Infinity;
  let checked = -Infinity;
  let checking = null;

  // A document and the id of a trigger in it. Two documents with one name in
  // two folders are two keys, and a move takes the conversations along
  // (server/app.js followMove), so the key follows it.
  const keyOf = (path, id) => `${path}\n${id}`;

  async function scan() {
    const seen = new Set();
    for (const entry of await store.list({ recursive: true })) {
      if (entry.kind !== 'doc') continue;
      seen.add(entry.path);
      const had = docs.get(entry.path);
      if (had && had.modified === entry.modified) continue;
      const source = await store.read(entry.path).catch(() => null);
      docs.set(entry.path, { modified: entry.modified, triggers: triggersIn(source) });
    }
    for (const p of docs.keys()) if (!seen.has(p)) docs.delete(p);
  }

  function triggers() {
    return [...docs].flatMap(([path, { triggers: list }]) =>
      list.map((tr) => ({ ...tr, path, title: runTitle(path, tr.id), key: keyOf(path, tr.id) })));
  }

  /** When each trigger last ran, and which runs are still going, off the
   *  conversations: what a restart remembers. */
  async function readHistory(live) {
    const byTitle = new Map();
    busy = 0;
    for (const meta of await conversations()) {
      if (!meta.title?.startsWith('Kept alive · ')) continue;
      if (meta.running || meta.queued) busy += 1;
      if (!byTitle.has(meta.title)) byTitle.set(meta.title, []);
      byTitle.get(meta.title).push(meta);
    }
    known = new Map();
    going = new Set();
    for (const tr of live) {
      // A run not yet aimed anywhere is this one's; one aimed elsewhere is a
      // document of the same name in another folder.
      for (const meta of byTitle.get(tr.title) ?? []) {
        if (meta.target && meta.target !== tr.path) continue;
        if (meta.createdAt > (known.get(tr.key) ?? -Infinity)) known.set(tr.key, meta.createdAt);
        if (meta.running || meta.queued) going.add(tr.key);
      }
    }
  }

  // The last run, from the conversations or this host's own starts (a run
  // whose conversation was deleted still ran); a trigger that never ran
  // counts from when it was first seen.
  function since(tr) {
    const ran = Math.max(known?.get(tr.key) ?? -Infinity, startedAt.get(tr.key) ?? -Infinity);
    return ran > -Infinity ? ran : firstSeen.get(tr.key);
  }

  /** The trigger as the file has it now: a pause, an edit or a delete since
   *  the last scan wins. */
  async function fresh(tr) {
    const source = await store.read(tr.path).catch(() => null);
    const found = triggersIn(source).find((t) => t.id === tr.id);
    return found && !found.paused ? { ...tr, ...found } : null;
  }

  async function check() {
    const t = now();
    checked = t;
    if (t - scanned >= scanMs) {
      scanned = t;
      await scan();
    }
    const live = triggers().filter((tr) => !tr.paused);
    if (!live.length) return [];
    let unseen = false;
    for (const tr of live) {
      if (firstSeen.has(tr.key)) continue;
      firstSeen.set(tr.key, t);
      unseen = true;
    }
    const due = () => live.filter((tr) => isDue(tr.schedule, since(tr), t, zone) && t - (lastTry.get(tr.key) ?? -Infinity) >= retryMs);
    // The conversations are read only when they could change the answer: on
    // the first look, for a trigger not seen before, and before a run.
    if (!known || unseen || due().length) await readHistory(live);
    const started = [];
    for (const tr of due()) {
      // One run of a trigger at a time, and only a few across the drive.
      if (going.has(tr.key)) continue;
      if (busy >= maxRunning) break;
      const run = await fresh(tr);
      if (!run) continue;
      // Before the start, not after it: a start that fails halfway may have
      // made a conversation, and the next try should find it.
      lastTry.set(tr.key, t);
      try {
        const { id } = await start({
          prompt: runPrompt(run),
          target: run.path,
          title: run.title,
          selection: [run.scope ?? run.id],
        });
        startedAt.set(tr.key, t);
        going.add(tr.key);
        busy += 1;
        log.log?.(`[alive] ${run.on}: ${run.path} #${run.id} (${id})`);
        started.push(id);
      } catch (err) {
        log.error?.(`[alive] could not run ${run.path} #${run.id}: ${err.message}`);
      }
    }
    return started;
  }

  // One check at a time, and not on every request: a burst of requests on
  // waking is one round of runs.
  function nudge() {
    if (checking) return checking;
    if (now() - checked < gapMs) return Promise.resolve([]);
    checking = check()
      .catch((err) => {
        log.error?.(`[alive] ${err.message}`);
        return [];
      })
      .finally(() => {
        checking = null;
      });
    return checking;
  }

  // Unref'd, and a paused sprite runs no timers anyway: this never holds a
  // sprite up. A run it starts is held as any turn is, by keep-awake.
  const timer = schedule ? schedule(nudge, tickMs) : null;
  timer?.unref?.();
  return { nudge, check, triggers, stop: () => timer && clearInterval(timer) };
}
