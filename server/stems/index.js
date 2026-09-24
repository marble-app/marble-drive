/**
 * Splitting a song into its voice and its band, on the host.
 *
 * A mashup needs one song's vocals over another's instrumental, and a finished
 * record has both in one file. The page could always split in the browser (see
 * Mashup Studio), but that is minutes of a laptop's fan for a job the machine
 * serving the drive does in about one — so the page asks the host instead, and
 * the answer is two files written beside the song:
 *
 *   Fun/Song Mashups/thank u next.mp3
 *   Fun/Song Mashups/thank u next - vocals.flac
 *   Fun/Song Mashups/thank u next - instrumental.flac
 *
 * They are ordinary drive files, so every page and every device sees them, and
 * splitting a song twice costs nothing: the second ask finds the pair and is
 * done.
 *
 * The work is `split.py` (HT-Demucs) run by `uv`, which builds and caches its
 * own Python — the host only has to find uv. Jobs run one at a time, because
 * they all want the same GPU; the rest wait in order. A job lives in memory
 * only: what outlives the host is the files, and a job the host forgot while
 * running is simply asked for again.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PathError, joinPath, parsePath, splitPath } from '../paths.js';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'split.py');
export const AUDIO = /\.(mp3|wav|m4a|aac|flac|aif|aiff|ogg|opus)$/i;
// What a split is called, so a stem is never mistaken for a song to split.
export const STEM = / - (vocals|instrumental)\.(flac|wav)$/i;
export const NAME_ROOM = 45; // 64 − ' - instrumental.flac'
const KEEP = 50; // finished jobs remembered, for the page that asks how it went

/** A title cut to fit, at a word where there is one. */
export function shorten(title) {
  if (title.length <= NAME_ROOM) return title;
  const head = title.slice(0, NAME_ROOM + 1);
  const space = head.lastIndexOf(' ');
  return (space > NAME_ROOM / 2 ? head.slice(0, space) : head.slice(0, NAME_ROOM)).trimEnd();
}

/** The pair of files a song splits into, beside it. */
export function stemPaths(songPath, ext = 'flac') {
  const { parent, name } = splitPath(songPath);
  // A name is at most 64 characters, and ` - instrumental.flac` takes 19 of
  // them, so a long title gives up its tail. The page shortens the same way.
  const stem = shorten(name.replace(/\.[^.]+$/, ''));
  return {
    vocals: joinPath(parent, `${stem} - vocals.${ext}`),
    instrumental: joinPath(parent, `${stem} - instrumental.${ext}`),
  };
}

/** uv, wherever it is. launchd's PATH is short, so the usual homes are tried
 *  too; MARBLE_STEMS_UV wins over all of them. */
export function findUv(env = process.env) {
  if (env.MARBLE_STEMS_UV) return env.MARBLE_STEMS_UV;
  const home = os.homedir();
  const dirs = [
    ...(env.PATH ?? '').split(path.delimiter),
    path.join(home, '.local/bin'),
    path.join(home, '.cargo/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const at = path.join(dir, 'uv');
    try {
      fs.accessSync(at, fs.constants.X_OK);
      return at;
    } catch {
      /* next */
    }
  }
  return null;
}

export function createStems({
  store,
  channels = null,
  log = console,
  uv = findUv(),
  model = process.env.MARBLE_STEMS_MODEL || 'htdemucs_ft',
  // Tests hand in a stand-in for `uv run --script split.py IN OUT`.
  command = null,
} = {}) {
  const jobs = new Map(); // id -> job, oldest first
  const queue = [];
  let running = null;
  let seq = 0;

  const view = (job) => {
    const { child, workDir, output, ...rest } = job;
    return rest;
  };

  function remember(job) {
    jobs.set(job.id, job);
    const finished = [...jobs.values()].filter((j) => j.state !== 'queued' && j.state !== 'running');
    for (const old of finished.slice(0, Math.max(0, finished.length - KEEP))) jobs.delete(old.id);
  }

  async function existing(songPath) {
    const want = stemPaths(songPath);
    const [v, i] = await Promise.all([store.hasFile(want.vocals), store.hasFile(want.instrumental)]);
    return v && i ? want : null;
  }

  /** Ask for a song to be split. Answers at once with the job: already done
   *  when the pair is there, the one in flight when somebody else asked
   *  first, a new one in the queue otherwise. */
  async function split(songPath) {
    const clean = parsePath(songPath, { allowRoot: false });
    if (!AUDIO.test(clean)) throw new PathError(`"${clean}" is not a song this can split`);
    if (STEM.test(clean)) throw new PathError(`"${clean}" is already a stem`);
    if (!(await store.hasFile(clean))) {
      const err = new PathError(`no file "${clean}"`);
      err.status = 404;
      throw err;
    }

    const live = [...jobs.values()].find((j) => j.path === clean && (j.state === 'queued' || j.state === 'running'));
    if (live) return view(live);

    const now = Date.now();
    const job = {
      id: `st${now.toString(36)}${(seq += 1)}`,
      path: clean,
      folder: splitPath(clean).parent,
      state: 'queued',
      stage: 'waiting',
      progress: 0,
      model,
      device: null,
      askedAt: now,
      startedAt: null,
      finishedAt: null,
      stems: null,
      error: null,
    };

    const found = await existing(clean);
    if (found) {
      Object.assign(job, { state: 'done', stage: 'already split', progress: 1, stems: found, finishedAt: now });
      remember(job);
      return view(job);
    }
    if (!uv && !command) {
      Object.assign(job, {
        state: 'failed',
        stage: 'no splitter',
        finishedAt: now,
        error: 'this host has no uv to run the splitter with — install it (brew install uv) or set MARBLE_STEMS_UV',
      });
      remember(job);
      return view(job);
    }

    remember(job);
    queue.push(job);
    pump();
    return view(job);
  }

  function pump() {
    if (running || !queue.length) return;
    running = queue.shift();
    run(running)
      .catch((err) => {
        if (running.state === 'running') {
          Object.assign(running, { state: 'failed', error: err.message, finishedAt: Date.now() });
        }
        log.error(`[stems] ${running.path} — ${err.message}`);
      })
      .finally(() => {
        const job = running;
        running = null;
        if (job.workDir) fsp.rm(job.workDir, { recursive: true, force: true }).catch(() => {});
        pump();
      });
  }

  async function run(job) {
    Object.assign(job, { state: 'running', stage: 'starting', startedAt: Date.now() });
    job.workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-stems-'));

    // The song is copied out rather than read in place: the splitter wants a
    // path, and a copy cannot change under it if the song is replaced mid-split.
    const raw = await store.readRaw(job.path);
    if (!raw) throw new Error('the song was moved or deleted before it could be split');
    const input = path.join(job.workDir, `song.${raw.ext || 'audio'}`);
    await new Promise((ok, no) => {
      const out = fs.createWriteStream(input);
      raw.open().on('error', no).pipe(out).on('finish', ok).on('error', no);
    });

    const outDir = path.join(job.workDir, 'out');
    const [cmd, args] = command
      ? command(input, outDir, { model })
      : [uv, ['run', '--quiet', '--script', SCRIPT, input, outDir, '--model', model]];

    const done = await new Promise((ok, no) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
      job.child = child;
      job.output = 0;
      let tail = '';
      let last = null;
      let buf = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        job.output += 1;
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (typeof msg.progress === 'number') job.progress = msg.progress;
          if (msg.stage) job.stage = msg.stage;
          if (msg.device) job.device = msg.device;
          if (msg.error) job.error = msg.error;
          if (msg.done) last = msg;
        }
      });
      // uv says what it is installing on stderr, the first time; that is the
      // one long wait nobody would otherwise be told about.
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        job.output += 1;
        tail = (tail + chunk).slice(-4000);
        if (job.stage === 'starting' && /Download|Install|Built|Resolved/.test(chunk)) job.stage = 'installing';
      });
      child.on('error', no);
      child.on('close', (code, signal) => {
        job.child = null;
        if (job.state === 'cancelled') return ok(null);
        if (code === 0 && last) return ok(last);
        const why = job.error || tail.trim().split('\n').slice(-3).join(' ') || `exit ${code ?? signal}`;
        no(new Error(why));
      });
    });
    if (!done) return;

    job.stage = 'saving';
    const want = stemPaths(job.path, path.extname(done.files.vocals).slice(1) || 'flac');
    const saved = {};
    for (const key of ['vocals', 'instrumental']) {
      // Somebody may have made one by hand while this ran; theirs stays.
      if (await store.hasFile(want[key])) {
        saved[key] = want[key];
        continue;
      }
      const put = await store.putFile(want[key], fs.createReadStream(done.files[key]));
      saved[key] = put.path;
      channels?.toDrive('created', { path: put.path, kind: 'file' });
    }
    Object.assign(job, {
      state: 'done',
      stage: 'done',
      progress: 1,
      stems: saved,
      device: done.device,
      took: done.took,
      seconds: done.seconds,
      finishedAt: Date.now(),
    });
    log.info?.(`[stems] split ${job.path} on ${done.device} in ${done.took}s`);
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (!job) return null;
    if (job.state === 'queued') {
      queue.splice(queue.indexOf(job), 1);
      Object.assign(job, { state: 'cancelled', stage: 'cancelled', finishedAt: Date.now() });
    } else if (job.state === 'running') {
      Object.assign(job, { state: 'cancelled', stage: 'cancelled', finishedAt: Date.now() });
      job.child?.kill('SIGTERM');
    }
    return view(job);
  }

  /** Every job the host remembers for a folder (or everywhere), and whether
   *  it can split at all. */
  function list({ folder = null } = {}) {
    const all = [...jobs.values()].filter((j) => folder === null || j.folder === folder);
    return {
      ready: Boolean(uv || command),
      model,
      jobs: all.map(view),
    };
  }

  /** The split in progress, as work that keeps a sprite awake (server/hold.js):
   *  its process, and how many times it has said anything. */
  function work() {
    const job = running;
    if (!job || job.state !== 'running' || !job.child) return [];
    return [{ key: `stems:${job.id}`, pid: job.child.pid, output: job.output ?? 0, pausedSince: null }];
  }

  function close() {
    queue.length = 0;
    running?.child?.kill('SIGTERM');
  }

  return { split, cancel, list, work, close, stemPaths };
}
