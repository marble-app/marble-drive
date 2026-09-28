// tools/sprite/serve.sh keeps a sprite's host up, and
// server/agent/first-to-go.js makes a turn the kernel's first choice when
// memory runs out. Both run on a sprite; what they promise can be checked
// anywhere: a stub `node` that dies once and then waits, and, where there is a
// /proc (Linux), a turn's own score read back.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { firstToGo } from '../server/agent/first-to-go.js';

const SERVE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'sprite', 'serve.sh');

const until = async (check, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

const running = new Set();
test.afterEach(() => {
  for (const child of running) child.kill('SIGKILL');
  running.clear();
});

async function keeper({ env = {} } = {}) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'sprite-serve-'));
  const starts = path.join(home, 'starts');
  // The first start dies at once; every later one waits to be stopped.
  await fsp.writeFile(path.join(home, 'node'), `#!/bin/sh
echo "$*" >> '${starts}'
[ "$(wc -l < '${starts}')" -eq 1 ] && exit 3
trap 'echo stopped >> "${home}/stops"; exit 0' TERM
while :; do sleep 0.05; done
`, { mode: 0o755 });
  const child = spawn('bash', [SERVE], {
    cwd: home,
    env: { ...process.env, HOME: home, MARBLE_SERVE_NODE: path.join(home, 'node'), MARBLE_SERVE_FIRST_WAIT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.add(child);
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const lines = (f) => fsp.readFile(path.join(home, f), 'utf8').then((t) => t.split('\n').filter(Boolean), () => []);
  return { home, child, exited, lines, stderr: () => stderr };
}

test('a host that dies is started again, and the exit is written down', async () => {
  const k = await keeper();
  assert.ok(await until(async () => (await k.lines('starts')).length === 2), 'started a second time');
  const [first] = await k.lines('starts');
  assert.match(first, /--report-on-fatalerror --report-directory=.*app\/crash bin\/marble-drive\.js serve/);
  const log = await k.lines('app/crash/crashes.log');
  assert.equal(log.length, 1);
  assert.match(log[0], /host exited \(status 3\) after \d+s; starting it again in 0s/);
  k.child.kill('SIGTERM');
  await k.exited;
});

test('a stop reaches the host and ends the loop without a restart', async () => {
  const k = await keeper();
  assert.ok(await until(async () => (await k.lines('starts')).length === 2));
  k.child.kill('SIGTERM');
  const { code } = await k.exited;
  assert.equal(code, 0);
  assert.deepEqual(await k.lines('stops'), ['stopped']);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await k.lines('starts')).length, 2, 'not started again');
  assert.equal((await k.lines('app/crash/crashes.log')).length, 1, 'a stop is not a crash');
});

test('a turn launches as it was where the kernel has no score to raise', () => {
  const launch = { command: 'claude', args: ['-p'], stdin: 'x' };
  assert.equal(firstToGo(launch, false), launch);
});

test('a turn raises its own score as the process that becomes the command', () => {
  const launch = firstToGo({ command: 'sh', args: ['-c', 'echo "$$ $1"', 'x', 'an argument with spaces'] }, true);
  assert.equal(launch.command, 'sh');
  const run = spawnSync(launch.command, launch.args, { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const [, ...said] = run.stdout.trim().split(' ');
  assert.equal(said.join(' '), 'an argument with spaces', 'the command runs with its arguments whole, with or without a score to raise');
});

test('on Linux, the turn\'s score is raised', { skip: !fs.existsSync('/proc/self/oom_score_adj') }, () => {
  const launch = firstToGo({ command: 'cat', args: ['/proc/self/oom_score_adj'] });
  assert.equal(spawnSync(launch.command, launch.args, { encoding: 'utf8' }).stdout.trim(), '500');
});
