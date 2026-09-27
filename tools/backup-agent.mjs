#!/usr/bin/env node
// The Mac's half of the Console's Backups view
// (docs/superpowers/specs/2026-09-27-backups-in-console-design.md).
//
//   node tools/backup-agent.mjs [<sprite>] [--org <org>] [--to <dir>] [--every <min>]
//
// Run every minute by launchd (macos/launchd/backup.sh). The sprite cannot
// reach this Mac, so the Mac does the talking. Each run asks the Sprites API
// about the sprite, which wakes nothing. Only while the sprite is running
// (awake anyway), or right after this run backed it up, does it touch it: one
// `sprite exec` reads the requests the Console left, another leaves a report.
// So a Console page hears from the Mac within a minute, and a sleeping drive is
// never woken to be told nothing.
//
// Requests (<remote>/requests/<id>.json, one JSON line each): back up now,
// schedule on or off, restore a snapshot onto a drive. Each is taken off the
// sprite before it is acted on, its id is remembered here, and one older than
// an hour is refused, so a restored snapshot that held a pending request
// cannot replay it.
//
// The schedule is <to>/<sprite>/.schedule-off, not the launchd job: turned
// off, this still checks in and still takes requests, so the page can turn it
// back on.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SNAPSHOT = /^\d{4}-\d{2}-\d{2}T\d{6}Z$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const HOUR = 60 * 60_000;

const args = process.argv.slice(2);
const opts = { sprite: 'admin-p1', org: 'marble-drive', to: path.join(os.homedir(), 'Marble Backups'), every: 15 };
if (args[0] && !args[0].startsWith('-')) opts.sprite = args.shift();
while (args.length) {
  const flag = args.shift();
  if (flag === '--org') opts.org = args.shift();
  else if (flag === '--to') opts.to = args.shift();
  else if (flag === '--every') opts.every = Number(args.shift());
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
const REMOTE = process.env.BACKUP_REMOTE_DIR || '/drive/.marble/console/backups';
const DEST = path.join(opts.to, opts.sprite);
const STATE = path.join(DEST, '.agent.json');
const OFF = path.join(DEST, '.schedule-off');

const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const say = (line) => console.log(`${stamp()} ${line}`);
const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;

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

await fsp.mkdir(DEST, { recursive: true });
const LOCK = path.join(DEST, '.agent-lock');
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
const unlock = () => fs.rmSync(LOCK, { recursive: true, force: true });
process.on('exit', unlock);

const state = JSON.parse(await fsp.readFile(STATE, 'utf8').catch(() => '{}'));
state.done ??= [];
state.results ??= [];
const saveState = () => fsp.writeFile(STATE, `${JSON.stringify(state, null, 1)}\n`);

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

async function readRequests() {
  const r = await onSprite(`cat ${quote(REMOTE)}/requests/*.json 2>/dev/null; true`);
  if (r.code !== 0) return null;
  return r.out.split('\n').map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter((q) => q && ID.test(String(q.id)) && q.sprite === opts.sprite)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// ------------------------------------------------------------- the report

async function snapshots() {
  const names = (await fsp.readdir(DEST).catch(() => [])).filter((n) => SNAPSHOT.test(n));
  const index = new Map();
  for (const line of (await fsp.readFile(path.join(DEST, '.snapshots.jsonl'), 'utf8').catch(() => '')).split('\n')) {
    try {
      const s = JSON.parse(line);
      if (s?.name) index.set(s.name, s);
    } catch {}
  }
  return names.sort().reverse().map((name) => {
    const s = index.get(name) ?? {};
    return { name, documents: s.documents ?? null, files: s.files ?? null, added: s.added ?? null, took: s.took ?? null, why: s.why ?? null };
  });
}

async function disk(measure) {
  // Measuring every snapshot's files is seconds of work, so only after a
  // backup; free space is one call.
  if (measure || state.used === undefined) {
    const r = await run('du', ['-sk', DEST]);
    const kb = Number.parseInt(r.out, 10);
    if (Number.isFinite(kb)) state.used = kb * 1024;
  }
  const r = await run('df', ['-k', DEST]);
  const cols = r.out.trim().split('\n').at(-1)?.split(/\s+/) ?? [];
  const free = Number.parseInt(cols[3], 10);
  return { used: state.used ?? null, free: Number.isFinite(free) ? free * 1024 : null };
}

async function machine() {
  const r = await run('scutil', ['--get', 'ComputerName']);
  return r.code === 0 && r.out.trim() ? r.out.trim() : os.hostname();
}

const snapIso = (name) => name.replace(/T(\d{2})(\d{2})(\d{2})Z$/, 'T$1:$2:$3Z');

async function report(measured) {
  const snaps = await snapshots();
  // A snapshot newer than the last run this agent saw (a backup taken from a
  // terminal) is the last backup.
  let last = state.last ?? null;
  if (snaps[0] && (!last || snapIso(snaps[0].name) > last.at)) last = { at: snapIso(snaps[0].name), ok: true, snapshot: snaps[0].name, why: snaps[0].why, error: null };
  return {
    v: 1,
    sprite: opts.sprite,
    machine: await machine(),
    to: DEST.replace(os.homedir(), '~'),
    heardAt: stamp(),
    every: opts.every,
    schedule: fs.existsSync(OFF) ? 'off' : 'on',
    last,
    snapshots: snaps,
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
  const row = { id: req.id, kind: req.kind, snapshot: req.snapshot ?? null, target: req.target ?? null, on: req.on ?? null, asked: req.at ?? null, ...fields };
  if (at >= 0) state.results[at] = { ...state.results[at], ...row };
  else state.results.unshift(row);
  state.results = state.results.slice(0, 20);
}

async function backup(extra) {
  const r = await run(BACKUP, [opts.sprite, '--org', opts.org, '--to', opts.to, ...extra]);
  const text = `${r.out}${r.err}`;
  if (r.code !== 0) {
    state.last = { at: stamp(), ok: false, snapshot: null, why: null, error: tail(text, 3) };
    return { ran: true, ok: false, text };
  }
  const made = /done: (\S+?),/.exec(r.out)?.[1] ?? null;
  if (!made) return { ran: false, ok: true, text };
  const why = /backing up \S+ \((.*)\) ->/.exec(r.out)?.[1] ?? null;
  state.last = { at: stamp(), ok: true, snapshot: made, why, error: null };
  return { ran: true, ok: true, text, snapshot: made };
}

async function act(req) {
  switch (req.kind) {
    case 'backup': {
      const b = await backup(['--why', 'asked from the Console']);
      return b.ok ? { state: 'done', note: b.snapshot ? `Snapshot ${b.snapshot}` : 'Another backup was running' } : { state: 'failed', note: tail(b.text, 3) };
    }
    case 'schedule':
      if (req.on) await fsp.rm(OFF, { force: true });
      else await fsp.writeFile(OFF, `turned off from the Console at ${stamp()}\n`);
      return { state: 'done', note: req.on ? 'Backing up on schedule' : 'Schedule off' };
    case 'restore': {
      if (!SNAPSHOT.test(String(req.snapshot)) || !fs.existsSync(path.join(DEST, req.snapshot))) return { state: 'failed', note: `No snapshot ${req.snapshot} on this Mac` };
      if (!NAME.test(String(req.target))) return { state: 'failed', note: 'Not a drive name' };
      const r = await run(RESTORE, [path.join(DEST, req.snapshot), req.target, '--org', opts.org, '--yes']);
      return { state: r.code === 0 ? 'done' : 'failed', note: tail(`${r.out}${r.err}`, r.code === 0 ? 1 : 4) };
    }
    default:
      return { state: 'failed', note: `Unknown request ${req.kind}` };
  }
}

const awake = (await status()) === 'running';
let taken = [];
let touched = false;
let measured = false;

if (awake) {
  const requests = (await readRequests()) ?? [];
  for (const req of requests) {
    taken.push(req.id);
    if (state.done.includes(req.id)) continue;
    state.done = [req.id, ...state.done].slice(0, 200);
    touched = true;
    if (!(Date.now() - Date.parse(req.at) < HOUR)) {
      result(req, { state: 'failed', at: stamp(), note: 'Older than an hour when the Mac saw it; ask again' });
      continue;
    }
    say(`request ${req.id}: ${req.kind}${req.snapshot ? ` ${req.snapshot}` : ''}${req.target ? ` onto ${req.target}` : ''}`);
    result(req, { state: 'running', at: stamp() });
    await saveState();
    // Off the sprite first, and the page told it has started.
    await push(taken, false);
    taken = [];
    const done = await act(req);
    result(req, { ...done, at: stamp() });
    if (req.kind === 'backup' || req.kind === 'restore') measured = true;
    say(`request ${req.id}: ${done.state}${done.note ? `: ${done.note.split('\n').at(-1)}` : ''}`);
    await saveState();
  }
}

// A failure is tried again after --every minutes, not every minute: whatever
// broke it would otherwise wake a sleeping sprite once a minute.
const failedLately = state.last && !state.last.ok && Date.now() - Date.parse(state.last.at) < opts.every * 60_000;
if (!fs.existsSync(OFF) && !failedLately) {
  const b = await backup(['--if-changed', '--every', String(opts.every)]);
  if (b.ran) {
    touched = true;
    measured = true;
    say(b.ok ? `backed up: ${b.snapshot}` : `backup FAILED: ${tail(b.text, 2)}`);
  }
}

await saveState();
// Awake anyway, or just woken by the backup: say so. Asleep and nothing
// happened: leave it asleep.
if (awake || touched) await push(taken, measured);
