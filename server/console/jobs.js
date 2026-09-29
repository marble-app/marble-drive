// Everything the console does is a job: a deploy, a settings change, a
// checkpoint, a test run. A job is recorded (what, on which drive, when, how it
// ended), its output is streamed to the page as it happens and kept on disk
// beside the record, and it can be stopped.
//
// Three rules hold for every job, so no action has to remember them:
//   - one at a time per target (a drive, or a workshop checkout): two deploys
//     racing on one sprite is how a release ends up half switched;
//   - a secret handed to or read by a job is replaced in its output, line by
//     line, so a value split across two writes is caught too;
//   - commands are argument lists, run without a shell.
//
// A job can also say where it is, for a page that shows its progress rather
// than its log: the steps it has gone through, a link it wants opened (an
// approval npm prints), and, when it fails, which action puts it right.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const KEEP = 200;
const MAX_OUTPUT = 1024 * 1024;
const MASK = '••••';

const busy = (target, job) => Object.assign(new Error(`${target} is busy: ${job.title}`), { status: 409, job });

export function createJobs({ dir, onEvent = () => {} }) {
  const jobs = new Map(); // id → record, oldest first
  const live = new Map(); // id → { children, output, bytes, cut, stopping }
  const index = path.join(dir, 'jobs.json');

  const view = (j) => ({ ...j, steps: j.steps.map((s) => ({ ...s })), links: j.links.map((l) => ({ ...l })) });
  const emit = (event) => {
    try {
      onEvent(event);
    } catch {
      // A listener that throws is not the job's problem.
    }
  };

  let saving = Promise.resolve();
  const save = () => {
    const all = [...jobs.values()].slice(-KEEP);
    saving = saving.then(() => fsp.writeFile(index, JSON.stringify(all))).catch(() => {});
    return saving;
  };

  async function ready() {
    await fsp.mkdir(dir, { recursive: true });
    let saved = [];
    try {
      saved = JSON.parse(await fsp.readFile(index, 'utf8'));
    } catch {}
    for (const j of saved) {
      // A job that was running when the host went away did not finish; it is
      // not failed either, because nobody knows how far it got.
      if (j.state === 'running') Object.assign(j, { state: 'interrupted', endedAt: j.endedAt ?? Date.now() });
      // Saved before jobs had steps.
      j.steps ??= [];
      j.links ??= [];
      j.fix ??= null;
      for (const s of j.steps) if (s.state === 'running') s.state = 'stopped';
      jobs.set(j.id, j);
    }
    if (saved.some((j) => j.state === 'interrupted')) await save();
  }

  function running(target) {
    return [...jobs.values()].find((j) => j.target === target && j.state === 'running') ?? null;
  }

  function start({ kind, title, target = null, meta = {}, run }) {
    if (target) {
      const other = running(target);
      if (other) throw busy(target, other);
    }
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const job = { id, kind, title, target, meta, state: 'running', startedAt: Date.now(), endedAt: null, error: null, result: null, steps: [], links: [], fix: null };
    jobs.set(id, job);
    const state = { children: new Set(), secrets: [], masks: [], lines: [], pending: { out: '', err: '' }, bytes: 0, cut: false, stopping: false, stream: fs.createWriteStream(path.join(dir, `${id}.log`)) };
    const changed = () => emit({ type: 'job', job: view(job) });
    const endStep = (to) => {
      const last = job.steps.at(-1);
      if (last?.state === 'running') Object.assign(last, { state: to, at: Date.now() });
    };
    live.set(id, state);

    const redact = (text) => {
      let out = text;
      for (const s of state.secrets) if (s) out = out.split(s).join(MASK);
      // A secret the job cannot know in advance (a passphrase a tool makes and
      // prints) is masked by where it appears: group 1 is kept, the rest goes.
      for (const re of state.masks) out = out.replace(re, (_, keep) => `${keep}${MASK}`);
      return out;
    };
    const write = (text) => {
      if (!text) return;
      if (state.cut) return;
      const clean = redact(text);
      if (state.bytes + clean.length > MAX_OUTPUT) {
        state.cut = true;
        const note = '\n… output cut at 1 MB\n';
        state.stream.write(note);
        emit({ type: 'output', id, text: note });
        return;
      }
      state.bytes += clean.length;
      state.stream.write(clean);
      emit({ type: 'output', id, text: clean });
      for (const line of clean.split('\n')) {
        for (const fn of state.lines) {
          try {
            fn(line);
          } catch {
            // A watcher that throws does not stop the job.
          }
        }
      }
    };
    // Whole lines only, so a secret split across two writes is still whole
    // when it is looked for.
    const feed = (which, chunk) => {
      state.pending[which] += chunk;
      const at = state.pending[which].lastIndexOf('\n');
      if (at < 0) return;
      write(state.pending[which].slice(0, at + 1));
      state.pending[which] = state.pending[which].slice(at + 1);
    };
    const flush = () => {
      for (const which of ['out', 'err']) {
        if (state.pending[which]) write(`${state.pending[which]}\n`);
        state.pending[which] = '';
      }
    };

    const ctx = {
      job,
      say: (line) => write(`${line}\n`),
      secret: (value) => {
        if (typeof value === 'string' && value.length >= 4) state.secrets.push(value);
      },
      mask: (re) => state.masks.push(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)),
      /** Begin a named step; the one before it is done. Said in the output too. */
      step: (name) => {
        endStep('done');
        job.steps.push({ name, state: 'running', at: Date.now() });
        write(`==> ${name}\n`);
        changed();
      },
      /** A link the person should open, such as an approval npm is waiting on. */
      link: (url, label) => {
        if (job.links.some((l) => l.url === url)) return;
        job.links.push({ url, label });
        changed();
      },
      /** Every line of output, as written (secrets already masked). */
      onLine: (fn) => state.lines.push(fn),
      get stopping() {
        return state.stopping;
      },
      /** Run one command; resolves with what it printed, rejects on a non-zero
       *  exit unless `allowFail`. Output is streamed into the job as it comes. */
      exec(cmd, args = [], { cwd, env, stdin, allowFail = false, quiet = false } = {}) {
        if (state.stopping) return Promise.reject(new Error('stopped'));
        return new Promise((resolve, reject) => {
          const child = spawn(cmd, args, { cwd, env: env ?? process.env, detached: true, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
          state.children.add(child);
          let out = '';
          let err = '';
          child.stdout.setEncoding('utf8');
          child.stderr.setEncoding('utf8');
          child.stdout.on('data', (c) => {
            out += c;
            if (!quiet) feed('out', c);
          });
          child.stderr.on('data', (c) => {
            err += c;
            if (!quiet) feed('err', c);
          });
          if (stdin !== undefined) child.stdin.end(stdin);
          child.on('error', (e) => {
            state.children.delete(child);
            reject(e);
          });
          child.on('close', (code, signal) => {
            state.children.delete(child);
            flush();
            if (code === 0 || allowFail) return resolve({ code, out, err });
            const why = signal ? `stopped (${signal})` : `exited ${code}`;
            reject(Object.assign(new Error(`${path.basename(cmd)} ${why}`), { code, out, err }));
          });
        });
      },
    };

    Promise.resolve()
      .then(() => run(ctx))
      .then((result) => {
        job.result = result ?? null;
        job.state = state.stopping ? 'stopped' : 'done';
        endStep(state.stopping ? 'stopped' : 'done');
      })
      .catch((err) => {
        job.state = state.stopping ? 'stopped' : 'failed';
        job.error = state.stopping ? null : redact(err?.message ?? String(err));
        // Which action puts it right, when the job knows: a name the page
        // turns into a button, never a command to run.
        job.fix = state.stopping ? null : (err?.fix ?? null);
        endStep(state.stopping ? 'stopped' : 'failed');
        if (job.error) write(`\n${job.error}\n`);
      })
      .finally(() => {
        flush();
        job.endedAt = Date.now();
        state.stream.end();
        live.delete(id);
        save();
        emit({ type: 'job', job: view(job) });
      });

    save();
    emit({ type: 'job', job: view(job) });
    return view(job);
  }

  function cancel(id) {
    const state = live.get(id);
    if (!state) return false;
    state.stopping = true;
    for (const child of state.children) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }, 5_000).unref();
    }
    return true;
  }

  async function output(id) {
    try {
      return await fsp.readFile(path.join(dir, `${id}.log`), 'utf8');
    } catch {
      return '';
    }
  }

  return {
    ready,
    start,
    cancel,
    output,
    running,
    get: (id) => (jobs.has(id) ? view(jobs.get(id)) : null),
    list: () => [...jobs.values()].slice(-KEEP).reverse().map(view),
    close: () => {
      for (const id of live.keys()) cancel(id);
    },
  };
}
