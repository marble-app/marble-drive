#!/usr/bin/env node
// The Mac's half of the Console's Backups view
// (docs/superpowers/specs/2026-09-27-backups-in-console-design.md).
//
//   node tools/backup-agent.mjs [<sprite>] [--org <org>] [--to <dir>] [--link <path>] [--quiet <min>] [--most <min>]
//
// Run every minute by launchd (macos/launchd/backup.sh). The sprite cannot
// reach this Mac, so the Mac does the talking. Each run asks the Sprites API
// about the sprite, which wakes nothing. Only while it is running (awake
// anyway) does it look inside, once: the requests the Console left, and when
// the drive last really changed. It leaves a report the Console reads.
//
// When it backs up (tools/drive-backup.sh: one copy here, a checkpoint on Fly):
// only after the drive changed, and then once it has been quiet for --quiet
// minutes (10), or every --most minutes (60) while changes keep coming, or once
// after it went to sleep with changes not yet copied. Nothing changed, nothing
// copied, however long it stays awake. What the drive writes by itself (its
// usage ledger, this report) is not a change.
//
// Requests (<drive>/.marble/console/backups/requests/<id>.json, one JSON line
// each): back up now, schedule on or off, put the copy on a drive, restore a
// Fly checkpoint. Each is taken off the sprite before it is acted on, its id
// is remembered here, and one older than an hour is refused, so a restore that
// brings back an old request cannot replay it.
//
// The schedule is <to>/.schedule-off, not the launchd job: turned off, this
// still checks in and still takes requests, so the page can turn it back on.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SNAPSHOT = /^\d{4}-\d{2}-\d{2}T\d{6}Z$/;
const CHECKPOINT = /^v\d{1,9}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const HOUR = 60 * 60_000;

const args = process.argv.slice(2);
const opts = {
  sprite: 'admin-p1',
  org: 'marble-drive',
  to: path.join(os.homedir(), 'Marble Backups'),
  link: path.join(os.homedir(), 'Marble Drive'),
  quiet: 10,
  most: 60,
};
if (args[0] && !args[0].startsWith('-')) opts.sprite = args.shift();
while (args.length) {
  const flag = args.shift();
  if (flag === '--org') opts.org = args.shift();
  else if (flag === '--to') opts.to = args.shift();
  else if (flag === '--link') opts.link = args.shift();
  else if (flag === '--quiet') opts.quiet = Number(args.shift());
  else if (flag === '--most') opts.most = Number(args.shift());
  else {
    console.error(`backup-agent: unknown option ${flag}`);
    process.exit(2);
  }
}
if (!NAME.test(opts.sprite)) {
  console.error('backup-agent: not a drive name');
  process.exit(2);
}

const SPRITE = process.env.SPRITE_BIN || 'sprite';
const BACKUP = process.env.BACKUP_TOOL || path.join(HERE, 'drive-backup.sh');
const RESTORE = process.env.RESTORE_TOOL || path.join(HERE, 'drive-restore.sh');
const DRIVE = process.env.BACKUP_REMOTE_DRIVE || '/drive';
const REMOTE = `${DRIVE}/.marble/console/backups`;
const STATE = path.join(opts.to, '.agent.json');
const OFF = path.join(opts.to, '.schedule-off');

const stamp = (t = Date.now()) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const say = (line) => console.log(`${stamp()} ${line}`);
const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const home = (p) => p.replace(os.homedir(), '~');

/** Run a command; resolves { code, out, err } and never throws. */
function run(cmd, argv, { input = null, timeout = 0 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'], timeout });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ code: 127, out, err: err + e.message }));
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 124 : 1), out, err }));
    if (input !== null) child.stdin.end(input);
  });
}
const onSprite = (script, input = null) => run(SPRITE, ['exec', '-o', opts.org, '-s', opts.sprite, ...(input === null ? ['--no-stdin'] : []), '--', 'sh', '-c', script], { input, timeout: 150_000 });
const tail = (text, n = 12) => text.trim().split('\n').slice(-n).join('\n');

// ------------------------------------------------------------------- lock

await fsp.mkdir(opts.to, { recursive: true });
const LOCK = path.join(opts.to, '.agent-lock');
try {
  await fsp.mkdir(LOCK);
} catch {
  const pid = Number.parseInt(await fsp.readFile(path.join(LOCK, 'pid'), 'utf8').catch(() => ''), 10);
  let alive = false;
  try {
    alive = Number.isInteger(pid) && process.kill(pid, 0);
  } catch {}
  // A restore or a stuck sprite outlasts a minute; the next run leaves it be.
  if (alive) process.exit(0);
  await fsp.rm(LOCK, { recursive: true, force: true });
  await fsp.mkdir(LOCK);
}
await fsp.writeFile(path.join(LOCK, 'pid'), String(process.pid));
process.on('exit', () => fs.rmSync(LOCK, { recursive: true, force: true }));

// Times on the sprite's clock, in seconds: synced is when the drive was last
// looked at for a copy, changed is the newest real change seen, skew is the
// sprite's clock less this one's.
const state = JSON.parse(await fsp.readFile(STATE, 'utf8').catch(() => '{}'));
state.done ??= [];
state.results ??= [];
state.synced ??= 0;
state.changed ??= 0;
state.skew ??= 0;
const saveState = () => fsp.writeFile(STATE, `${JSON.stringify(state, null, 1)}\n`);
const spriteNow = () => Math.floor(Date.now() / 1000) + state.skew;

// ------------------------------------------------------------ the sprite

async function status() {
  const r = await run(SPRITE, ['api', '-o', opts.org, `/v1/sprites/${opts.sprite}`], { timeout: 30_000 });
  try {
    const body = JSON.parse(r.out);
    return (body.data ?? body).status ?? null;
  } catch {
    return null;
  }
}

// What the drive writes by itself, awake and untouched: not a change.
const NOISE = ['.marble/usage/*', '.marble/usage-last.json', '.marble/console/*', '.marble/agents/host.lock'];

/** One look inside: the sprite's clock, its newest real change, the requests. */
async function checkIn() {
  const skip = NOISE.map((p) => `! -path ${quote(`${DRIVE}/${p}`)}`).join(' ');
  const script = [
    'echo "NOW $(date +%s)"',
    `echo "CHANGED $(find ${quote(DRIVE)} -type f ${skip} -printf '%T@\\n' 2>/dev/null | awk 'm < $1 { m = $1 } END { printf "%d", m }')"`,
    `for f in ${quote(REMOTE)}/requests/*.json; do [ -f "$f" ] && { printf 'REQ '; head -n 1 "$f"; }; done`,
    'true',
  ].join('; ');
  const r = await onSprite(script);
  if (r.code !== 0) return null;
  const seen = { now: null, changed: 0, requests: [] };
  for (const line of r.out.split('\n')) {
    if (line.startsWith('NOW ')) seen.now = Number(line.slice(4));
    else if (line.startsWith('CHANGED ')) seen.changed = Number(line.slice(8)) || 0;
    else if (line.startsWith('REQ ')) {
      try {
        const q = JSON.parse(line.slice(4));
        if (q && ID.test(String(q.id)) && q.sprite === opts.sprite) seen.requests.push(q);
      } catch {}
    }
  }
  seen.requests.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return seen.now ? seen : null;
}

// ------------------------------------------------------------- the copy

async function copy() {
  const target = await fsp.realpath(opts.link).catch(() => null);
  if (!target || !SNAPSHOT.test(path.basename(target))) return null;
  const sync = JSON.parse(await fsp.readFile(path.join(target, '.marble', 'sync.json'), 'utf8').catch(() => '{}'));
  return { ...sync, name: path.basename(target), path: home(target) };
}

async function disk(measure) {
  const c = await fsp.realpath(opts.link).catch(() => null);
  if (c && (measure || state.used === undefined)) {
    const r = await run('du', ['-sk', c]);
    const kb = Number.parseInt(r.out, 10);
    if (Number.isFinite(kb)) state.used = kb * 1024;
  }
  const r = await run('df', ['-k', opts.to]);
  const free = Number.parseInt(r.out.trim().split('\n').at(-1)?.split(/\s+/)[3], 10);
  return { used: state.used ?? null, free: Number.isFinite(free) ? free * 1024 : null };
}

async function machine() {
  const r = await run('scutil', ['--get', 'ComputerName']);
  return r.code === 0 && r.out.trim() ? r.out.trim() : os.hostname();
}

const dirty = () => Boolean(state.force) || state.changed > state.synced;
/** When the next backup is due, on this Mac's clock, if changes are waiting. */
function nextAt() {
  if (!dirty() || state.force) return null;
  const due = Math.min(state.changed + opts.quiet * 60, state.synced + opts.most * 60);
  return stamp((due - state.skew) * 1000);
}

async function report(measured) {
  const c = await copy();
  let last = state.last ?? null;
  if (c?.syncedAt && (!last || c.syncedAt > last.at)) last = { at: c.syncedAt, ok: true, snapshot: c.name, why: c.why ?? null, error: null };
  return {
    v: 2,
    sprite: opts.sprite,
    machine: await machine(),
    to: home(opts.to),
    link: home(opts.link),
    heardAt: stamp(),
    rule: { quiet: opts.quiet, most: opts.most },
    schedule: fs.existsSync(OFF) ? 'off' : 'on',
    last,
    copy: c,
    changes: { waiting: dirty(), since: state.changed ? stamp((state.changed - state.skew) * 1000) : null, next: nextAt() },
    disk: await disk(measured),
    results: state.results.slice(0, 20),
  };
}

async function push(taken, measured) {
  const body = `${JSON.stringify(await report(measured))}\n`;
  const file = `${opts.sprite}.json`;
  const rm = taken.filter((id) => ID.test(id)).map((id) => quote(`${id}.json`)).join(' ');
  const script = `set -e; d=${quote(REMOTE)}; mkdir -p "$d/requests"; cat > "$d/.${file}.tmp"; mv "$d/.${file}.tmp" "$d/${file}"${rm ? `; cd "$d/requests" && rm -f -- ${rm}` : ''}`;
  const r = await onSprite(script, body);
  if (r.code !== 0) say(`could not report to ${opts.sprite}: ${tail(r.err || r.out, 2)}`);
  return r.code === 0;
}

// ------------------------------------------------------------- the work

function result(req, fields) {
  const at = state.results.findIndex((x) => x.id === req.id);
  const row = { id: req.id, kind: req.kind, snapshot: req.snapshot ?? null, checkpoint: req.checkpoint ?? null, target: req.target ?? null, on: req.on ?? null, asked: req.at ?? null, ...fields };
  if (at >= 0) state.results[at] = { ...state.results[at], ...row };
  else state.results.unshift(row);
  state.results = state.results.slice(0, 20);
}

/** Copy the drive now. `looked` is the sprite time its changes were read at. */
async function backup(why, looked) {
  const r = await run(BACKUP, [opts.sprite, '--org', opts.org, '--to', opts.to, '--link', opts.link, '--why', why]);
  const text = `${r.out}${r.err}`;
  if (r.code !== 0) {
    state.last = { at: stamp(), ok: false, snapshot: null, why, error: tail(text, 2) };
    return { ok: false, text };
  }
  const made = /done: (\S+?),/.exec(r.out)?.[1] ?? null;
  if (!made) return { ok: true, text, busy: true };
  // Times are whole seconds: a change in the very second it was looked at
  // might not be in the copy, so that second counts as after it.
  // Asleep, nothing has changed since it was last looked at: all of it is in.
  state.synced = Math.max(state.synced, looked - 1, awake ? 0 : state.changed);
  state.force = false;
  state.last = { at: stamp(), ok: true, snapshot: made, why, error: null };
  return { ok: true, text, snapshot: made };
}

async function act(req, looked) {
  switch (req.kind) {
    case 'backup': {
      const b = await backup('asked from the Console', looked);
      return b.ok ? { state: 'done', note: b.snapshot ? `Copied ${b.snapshot}` : 'Another backup was running' } : { state: 'failed', note: tail(b.text, 3) };
    }
    case 'schedule':
      if (req.on) await fsp.rm(OFF, { force: true });
      else await fsp.writeFile(OFF, `turned off from the Console at ${stamp()}\n`);
      return { state: 'done', note: req.on ? 'Backing up after changes' : 'Schedule off' };
    case 'restore': {
      const c = await copy();
      if (!c || c.name !== req.snapshot) return { state: 'failed', note: `The copy on this Mac is ${c?.name ?? 'missing'}, not ${req.snapshot}` };
      if (!NAME.test(String(req.target))) return { state: 'failed', note: 'Not a drive name' };
      const r = await run(RESTORE, [await fsp.realpath(opts.link), req.target, '--org', opts.org, '--yes']);
      return { state: r.code === 0 ? 'done' : 'failed', note: tail(`${r.out}${r.err}`, r.code === 0 ? 1 : 4) };
    }
    case 'checkpoint': {
      if (!CHECKPOINT.test(String(req.checkpoint))) return { state: 'failed', note: 'Not a checkpoint' };
      // Sprites' own advice: checkpoint before restoring, or what is there now is gone.
      const before = await run(SPRITE, ['checkpoint', 'create', '-o', opts.org, '-s', opts.sprite, '--comment', `before restoring ${req.checkpoint}`], { timeout: 300_000 });
      const r = await run(SPRITE, ['restore', req.checkpoint, '-o', opts.org, '-s', opts.sprite], { timeout: 300_000 });
      // Restored files keep their old times, so the next look would not see a
      // change: copy it anyway.
      if (r.code === 0) state.force = true;
      const saved = /Failed/.test(before.out + before.err) ? 'no checkpoint could be made first' : 'what was there is a checkpoint too';
      return { state: r.code === 0 ? 'done' : 'failed', note: r.code === 0 ? `Restored ${req.checkpoint}; ${saved}` : tail(`${r.out}${r.err}`, 3) };
    }
    default:
      return { state: 'failed', note: `Unknown request ${req.kind}` };
  }
}

const awake = (await status()) === 'running';
const seen = awake ? await checkIn() : null;
if (seen) {
  state.skew = seen.now - Math.floor(Date.now() / 1000);
  state.changed = Math.max(state.changed, seen.changed);
}
const looked = seen?.now ?? spriteNow();
let taken = [];
let touched = false;
let measured = false;

for (const req of seen?.requests ?? []) {
  taken.push(req.id);
  if (state.done.includes(req.id)) continue;
  state.done = [req.id, ...state.done].slice(0, 200);
  touched = true;
  if (!(Date.now() - Date.parse(req.at) < HOUR)) {
    result(req, { state: 'failed', at: stamp(), note: 'Older than an hour when the Mac saw it; ask again' });
    continue;
  }
  say(`request ${req.id}: ${req.kind}${req.snapshot ? ` ${req.snapshot}` : ''}${req.checkpoint ? ` ${req.checkpoint}` : ''}${req.target ? ` onto ${req.target}` : ''}`);
  result(req, { state: 'running', at: stamp() });
  await saveState();
  // Off the sprite first, and the page told it has started.
  await push(taken, false);
  taken = [];
  const done = await act(req, looked);
  result(req, { ...done, at: stamp() });
  if (req.kind !== 'schedule') measured = true;
  say(`request ${req.id}: ${done.state}${done.note ? `: ${done.note.split('\n').at(-1)}` : ''}`);
  await saveState();
}

// A failure is tried again after --quiet minutes, not every minute: whatever
// broke it would otherwise wake a sleeping sprite once a minute.
const failedLately = state.last && !state.last.ok && Date.now() - Date.parse(state.last.at) < opts.quiet * 60_000;
if (!fs.existsSync(OFF) && !failedLately) {
  const now = spriteNow();
  const first = !(await copy());
  const why = first ? (awake ? 'first backup' : null)
    : !dirty() ? null
      : state.force ? 'after a restore'
        : !awake ? 'went to sleep with changes'
          : now - state.changed >= opts.quiet * 60 ? 'quiet after changes'
            : now - state.synced >= opts.most * 60 ? 'hourly while working'
              : null;
  if (why) {
    const b = await backup(why, looked);
    touched = true;
    measured = true;
    say(b.ok ? `backed up (${why}): ${b.snapshot ?? 'another backup was running'}` : `backup FAILED (${why}): ${tail(b.text, 2)}`);
  }
}

await saveState();
// Awake anyway, or just woken by the backup: say so. Asleep and nothing
// happened: leave it asleep.
if (awake || touched) await push(taken, measured);
