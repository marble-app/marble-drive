#!/usr/bin/env node
// Run browser tests where there is room for them.
//
//   node tools/browser-tests.mjs [test-browser/<file>.test.js ...]    (none: all of them)
//
// A browser test starts the host and a Chromium, and on a sprite (8 GB, no
// swap) a few of those at once are what ran the machine out of memory. So on
// the owner's sprite, when the owner's Mac is watching it (tools/test-runner.mjs
// checks in to ~/app/runner every few seconds while the sprite is awake), the
// run is handed to the Mac and its output streamed back here as it comes. When
// no Mac is watching, or it does not take the run within TAKE seconds, or it
// goes quiet in the middle, the tests run here instead, one file at a time.
// Either way the exit status is the tests'.
//
// Only test files under this checkout's test-browser/ can be asked for, and the
// Mac runs nothing but `node --test` on them (it checks again).

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = process.env.MARBLE_RUNNER_DIR || path.join(os.homedir(), 'app', 'runner');
// A Mac that checked in this recently is watching (it looks at a quiet drive
// once a minute, at one an agent is busy on every few seconds); one that took a
// run and has not checked in for GONE seconds has gone away.
const FRESH = Number(process.env.MARBLE_RUNNER_FRESH_SECONDS || 90);
const TAKE = Number(process.env.MARBLE_RUNNER_TAKE_SECONDS || 75);
const GONE = Number(process.env.MARBLE_RUNNER_GONE_SECONDS || 60);
const POLL_MS = 500;
export const TEST_FILE = /^test-browser\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.test\.js$/;

const say = (line) => process.stderr.write(`browser-tests: ${line}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function files(argv) {
  const asked = argv.length
    ? argv
    : fs.readdirSync(path.join(REPO, 'test-browser')).filter((n) => n.endsWith('.test.js')).sort().map((n) => `test-browser/${n}`);
  return asked.map((f) => {
    const rel = path.relative(REPO, path.resolve(f)).split(path.sep).join('/');
    if (!TEST_FILE.test(rel) || rel.split('/').includes('..')) throw new Error(`${f} is not a test file in test-browser/`);
    if (!fs.existsSync(path.join(REPO, rel))) throw new Error(`${f} does not exist`);
    return rel;
  });
}

/** Seconds since the Mac last checked in, or null if none ever has. */
function sinceCheckIn() {
  try {
    return (Date.now() - fs.statSync(path.join(RUNNER, 'mac.json')).mtimeMs) / 1000;
  } catch {
    return null;
  }
}

function runHere(list) {
  say(`running ${list.length} file${list.length === 1 ? '' : 's'} here, one at a time`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...list], { cwd: REPO, stdio: 'inherit' });
    child.on('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function runOnMac(list) {
  const id = `${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${crypto.randomBytes(4).toString('hex')}`;
  for (const dir of ['requests', 'out', 'cancel']) fs.mkdirSync(path.join(RUNNER, dir), { recursive: true });
  const request = path.join(RUNNER, 'requests', `${id}.json`);
  const log = path.join(RUNNER, 'out', `${id}.log`);
  const status = path.join(RUNNER, 'out', `${id}.status`);
  fs.writeFileSync(`${request}.tmp`, JSON.stringify({ id, checkout: fs.realpathSync(REPO), files: list, at: new Date().toISOString() }));
  fs.renameSync(`${request}.tmp`, request);
  let host = 'the Mac';
  try {
    host = JSON.parse(fs.readFileSync(path.join(RUNNER, 'mac.json'), 'utf8')).host || host;
  } catch {}
  say(`handed to ${host}; its output follows`);

  const cancel = () => {
    try {
      fs.writeFileSync(path.join(RUNNER, 'cancel', id), '');
      fs.rmSync(request, { force: true });
    } catch {}
  };
  const stop = () => {
    cancel();
    process.exit(130);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const started = Date.now();
  let offset = 0;
  const drain = () => {
    try {
      const fd = fs.openSync(log, 'r');
      const buf = Buffer.alloc(64 * 1024);
      let n;
      while ((n = fs.readSync(fd, buf, 0, buf.length, offset)) > 0) {
        process.stdout.write(buf.subarray(0, n));
        offset += n;
      }
      fs.closeSync(fd);
    } catch {}
  };
  for (;;) {
    await sleep(POLL_MS);
    drain();
    if (fs.existsSync(status)) {
      drain();
      const { code } = JSON.parse(fs.readFileSync(status, 'utf8'));
      return code;
    }
    const taken = !fs.existsSync(request);
    const quiet = sinceCheckIn();
    if (!taken && (Date.now() - started) / 1000 > TAKE) {
      cancel();
      say(`${host} did not take the run within ${TAKE}s`);
      return null;
    }
    if (taken && (quiet === null || quiet > GONE)) {
      cancel();
      say(`${host} went quiet for ${Math.round(quiet ?? GONE)}s`);
      return null;
    }
  }
}

const main = async () => {
  let list;
  try {
    list = files(process.argv.slice(2));
  } catch (err) {
    say(err.message);
    process.exit(2);
  }
  const quiet = sinceCheckIn();
  let code = null;
  if (quiet !== null && quiet < FRESH) code = await runOnMac(list);
  if (code === null) code = await runHere(list);
  process.exit(code);
};

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
