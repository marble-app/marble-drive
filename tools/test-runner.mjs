#!/usr/bin/env node
// The Mac's half of tools/browser-tests.mjs: browser tests asked for on the
// owner's sprite, run here, where there is memory for them.
//
//   node tools/test-runner.mjs [<sprite>] [--org <org>] [--scratch <dir>]
//
// Kept running by launchd (macos/launchd/test-runner.sh). The sprite cannot
// reach this Mac, so the Mac does the talking, in the backup agent's manner:
// it asks the Sprites API whether the sprite is awake (which wakes nothing),
// and only while it is does it look in ~/app/runner there: it leaves a
// check-in (mac.json), takes a request, and sends the output back as it comes.
// It looks every few seconds while the drive is busy of itself (an agent's
// turn holding it awake, or a tab), and backs off to once a minute when it is
// not, so its own looking never keeps the sprite up.
//
// A run: the request's checkout, and marble beside it, copied into a scratch
// folder here (only what changed moves; node_modules and .git stay behind),
// packages installed when package.json or the lock changed, then
// `node --test` on the asked files, two at a time. Nothing else is ever run:
// the checkout must be under /home/sprite/src and every file under its
// test-browser/. The tests run as this Mac's user, as the owner's own Claude
// Code sessions do; only the owner's sprite has a runner watching it.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ID = /^[0-9TZ]{15}-[0-9a-f]{8}$/;
const CHECKOUT = /^\/home\/sprite\/src\/[A-Za-z0-9._-]+$/;
const TEST_FILE = /^test-browser\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.test\.js$/;
const REMOTE = '$HOME/app/runner';

/** A request is run only if every part of it is what a browser test run looks like. */
export function validRequest(req) {
  if (!req || typeof req !== 'object') return false;
  if (!ID.test(req.id ?? '')) return false;
  if (!CHECKOUT.test(req.checkout ?? '') || req.checkout.endsWith('/.') || req.checkout.endsWith('/..')) return false;
  if (!Array.isArray(req.files) || !req.files.length || req.files.length > 200) return false;
  return req.files.every((f) => typeof f === 'string' && TEST_FILE.test(f) && !f.split('/').includes('..'));
}

const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const say = (line) => console.log(`${stamp()} ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;

function run(cmd, argv, { input = null, timeout = 0, cwd, env, onData } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd, env, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'], timeout });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; onData?.(d); });
    child.stderr.on('data', (d) => { err += d; onData?.(d); });
    child.on('error', (e) => resolve({ code: 127, out, err: err + e.message }));
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 124 : 1), out, err }));
    if (input !== null) child.stdin.end(input);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const opts = { sprite: 'admin-p2', org: 'marble-drive', scratch: null };
  if (args[0] && !args[0].startsWith('-')) opts.sprite = args.shift();
  while (args.length) {
    const flag = args.shift();
    if (flag === '--org') opts.org = args.shift();
    else if (flag === '--scratch') opts.scratch = args.shift();
    else {
      console.error(`test-runner: unknown option ${flag}`);
      process.exit(2);
    }
  }
  if (!NAME.test(opts.sprite)) {
    console.error('test-runner: not a drive name');
    process.exit(2);
  }
  const SPRITE = process.env.SPRITE_BIN || 'sprite';
  const scratch = opts.scratch || path.join(os.homedir(), 'Library', 'Caches', 'marble-runner', opts.sprite);
  const host = os.hostname().replace(/\.local$/, '');
  const onSprite = (script, input = null) =>
    run(SPRITE, ['exec', '-o', opts.org, '-s', opts.sprite, ...(input === null ? ['--no-stdin'] : []), '--', 'sh', '-c', script], { input, timeout: 60_000 });
  const checkIn = () => {
    const json = JSON.stringify({ host, pid: process.pid, at: stamp() });
    return `R=${REMOTE}; mkdir -p "$R/requests" "$R/running" "$R/out" "$R/cancel" && printf '%s' ${quote(json)} > "$R/mac.json.tmp" && mv "$R/mac.json.tmp" "$R/mac.json"`;
  };

  async function awake() {
    const r = await run(SPRITE, ['api', '-o', opts.org, `/v1/sprites/${opts.sprite}`], { timeout: 20_000 });
    try {
      const body = JSON.parse(r.out);
      return (body.data ?? body).status === 'running';
    } catch {
      return false;
    }
  }

  /** One look: check in, and say what is asked for, cancelled, and whether the drive is busy of itself. */
  async function look() {
    const r = await onSprite(`${checkIn()}
for f in "$R"/requests/*.json; do [ -e "$f" ] && { printf 'REQ '; tr -d '\\n' < "$f"; echo; }; done
H=$(curl -s -m 2 http://127.0.0.1:4400/health); T=$(curl -s -m 2 --unix-socket /.sprite/api.sock http://sprite/v1/tasks)
echo "HEALTH $H"; echo "TASKS $T"
find "$R/out" "$R/cancel" -type f -mmin +1440 -delete 2>/dev/null; true`);
    if (r.code !== 0) return null;
    const requests = [];
    let busy = false;
    for (const line of r.out.split('\n')) {
      if (line.startsWith('REQ ')) {
        try {
          requests.push(JSON.parse(line.slice(4)));
        } catch {}
      } else if (line.startsWith('HEALTH ')) {
        try {
          busy ||= (JSON.parse(line.slice(7)).streams ?? 0) > 0;
        } catch {}
      } else if (line.startsWith('TASKS ')) {
        try {
          busy ||= (JSON.parse(line.slice(6)).tasks ?? []).some((t) => t.name === 'marble-drive');
        } catch {}
      }
    }
    return { requests, busy };
  }

  const rsh = path.join(HERE, 'sprite-rsh.sh');
  const copy = (from, to) =>
    run('rsync', ['-a', '--delete', '--exclude', 'node_modules', '--exclude', '.git', '-e', rsh, `${opts.sprite}:${from}/`, `${to}/`], {
      env: { ...process.env, SPRITE_ORG: opts.org },
      timeout: 15 * 60_000,
    });

  async function prepare(dir, write) {
    const name = path.basename(dir);
    const hash = crypto.createHash('sha256');
    for (const f of ['package.json', 'package-lock.json']) hash.update(await fsp.readFile(path.join(dir, f), 'utf8').catch(() => ''));
    const digest = hash.digest('hex');
    const marker = path.join(scratch, '.deps', `${name}.hash`);
    if ((await fsp.readFile(marker, 'utf8').catch(() => '')) === digest) return true;
    write(`[the Mac] installing ${name}'s packages\n`);
    const r = await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, timeout: 15 * 60_000 });
    if (r.code !== 0) {
      write(`[the Mac] npm install failed in ${name}:\n${r.err.slice(-2000)}\n`);
      return false;
    }
    // The Chromium this checkout's Playwright drives, the lookup the host makes.
    const entry = await run(process.execPath, ['--input-type=module', '-e', "import { fileURLToPath } from 'node:url'; import { playwrightEntry } from './server/agent/browser.js'; console.log(fileURLToPath(playwrightEntry()))"], { cwd: dir });
    if (entry.code === 0 && entry.out.trim()) {
      await run(process.execPath, [path.join(path.dirname(entry.out.trim()), 'cli.js'), 'install', 'chromium'], { cwd: dir, timeout: 15 * 60_000 });
    }
    await fsp.mkdir(path.dirname(marker), { recursive: true });
    await fsp.writeFile(marker, digest);
    return true;
  }

  async function job(req) {
    const taken = await onSprite(`R=${REMOTE}; mv "$R/requests/${req.id}.json" "$R/running/${req.id}.json" && echo TAKEN`);
    if (!taken.out.includes('TAKEN')) return;
    const name = path.basename(req.checkout);
    say(`${req.id}: ${req.files.length} file(s) from ${name}`);
    const started = Date.now();
    let pending = '';
    let cancelled = false;
    const write = (text) => {
      pending += text;
    };
    // Every 2 s: send what is new, check in, and hear a cancel. One send at a
    // time, in order: a slow one must not be overtaken by the next.
    let sending = Promise.resolve();
    const flush = (final = null) => (sending = sending.then(() => send(final)));
    const send = async (final) => {
      const chunk = pending;
      pending = '';
      const end = final
        ? `; printf '%s' ${quote(JSON.stringify(final))} > "$R/out/${req.id}.status.tmp" && mv "$R/out/${req.id}.status.tmp" "$R/out/${req.id}.status"; rm -f "$R/running/${req.id}.json"`
        : '';
      const r = await onSprite(`${checkIn()}; cat >> "$R/out/${req.id}.log"${end}; [ -e "$R/cancel/${req.id}" ] && echo CANCEL; true`, chunk);
      if (r.out.includes('CANCEL')) cancelled = true;
    };
    let child = null;
    const ticker = setInterval(async () => {
      if (!final) await flush();
      if (cancelled && child) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }
    }, 2000);

    let code = 1;
    let final = false;
    try {
      write(`[the Mac] ${host}: copying ${name} and marble\n`);
      const src = path.join(scratch, 'src');
      await fsp.mkdir(src, { recursive: true });
      const copied = [await copy('/home/sprite/src/marble', path.join(src, 'marble')), await copy(req.checkout, path.join(src, name))];
      const failed = copied.find((c) => c.code !== 0);
      if (failed) throw new Error(`copy failed: ${failed.err.slice(-500)}`);
      if (!(await prepare(path.join(src, 'marble'), write)) || !(await prepare(path.join(src, name), write))) throw new Error('could not install packages');
      if (cancelled) throw new Error('cancelled');
      write(`[the Mac] running ${req.files.length} file(s), two at a time\n`);
      code = await new Promise((resolve) => {
        child = spawn(process.execPath, ['--test', '--test-concurrency=2', '--test-reporter=spec', ...req.files], {
          cwd: path.join(src, name),
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', (d) => write(String(d)));
        child.stderr.on('data', (d) => write(String(d)));
        const limit = setTimeout(() => {
          write('[the Mac] stopped after 60 min\n');
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {}
        }, 60 * 60_000);
        child.on('close', (c, signal) => {
          clearTimeout(limit);
          resolve(c ?? (signal ? 1 : 0));
        });
      });
    } catch (err) {
      write(`[the Mac] ${err.message}\n`);
    }
    final = true;
    clearInterval(ticker);
    await flush({ code: cancelled ? 130 : code, host, ms: Date.now() - started });
    say(`${req.id}: exit ${cancelled ? 'cancelled' : code} in ${Math.round((Date.now() - started) / 1000)}s`);
  }

  say(`watching ${opts.sprite} for browser test runs (scratch: ${scratch.replace(os.homedir(), '~')})`);
  let quiet = 0;
  for (;;) {
    if (!(await awake())) {
      quiet = 0;
      await sleep(15_000);
      continue;
    }
    const seen = await look();
    if (!seen) {
      await sleep(10_000);
      continue;
    }
    const runnable = seen.requests.filter(validRequest);
    for (const bad of seen.requests.filter((r) => !validRequest(r))) {
      say(`refused a request that is not a browser test run: ${JSON.stringify(bad).slice(0, 200)}`);
      if (typeof bad?.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(bad.id)) await onSprite(`rm -f ${REMOTE}/requests/${bad.id}.json`);
    }
    if (runnable.length) {
      quiet = 0;
      await job(runnable[0]);
      continue;
    }
    quiet = seen.busy ? 0 : quiet + 1;
    // Busy of itself: look often. Quiet a few times running: once a minute,
    // so this looking is never what keeps the sprite awake.
    await sleep(quiet >= 3 ? 60_000 : 3_000);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await fsp.realpath(process.argv[1]).catch(() => ''))) await main();
