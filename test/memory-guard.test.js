// The memory guard (server/memory-guard.js) reads /proc; here a folder stands
// in for it: meminfo, the pressure figure, and a process tree of the host, an
// agent's turn running a browser test, a second quieter turn, and a stranger.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { breakdown, candidates, createMemoryGuard, readProcesses } from '../server/memory-guard.js';

const MB = 2 ** 20;

async function fakeProc({ availableMB = 4000, totalMB = 8192, pressure = 0, procs }) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'proc-'));
  await fsp.writeFile(path.join(dir, 'meminfo'), `MemTotal: ${totalMB * 1024} kB\nMemFree: 100 kB\nMemAvailable: ${availableMB * 1024} kB\n`);
  await fsp.mkdir(path.join(dir, 'pressure'));
  await fsp.writeFile(path.join(dir, 'pressure', 'memory'), `some avg10=${pressure.toFixed(2)} avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=1\n`);
  for (const p of procs) {
    const d = path.join(dir, String(p.pid));
    await fsp.mkdir(d);
    // A command name with a space and a parenthesis, as /proc can hold.
    await fsp.writeFile(path.join(d, 'stat'), `${p.pid} (${p.name ?? 'x'}) S ${p.ppid} 1 1 0 -1\n`);
    await fsp.writeFile(path.join(d, 'statm'), `1000 ${Math.round((p.mb * MB) / 4096)} 10 1 0 100 0\n`);
    await fsp.writeFile(path.join(d, 'oom_score_adj'), `${p.score ?? -900}\n`);
    await fsp.writeFile(path.join(d, 'cmdline'), (p.cmd ?? p.name ?? 'x').split(' ').join('\0') + '\0');
  }
  return dir;
}

const HOST = 100;
const TREE = [
  // A sprite's init runs at the turns' score too, and holds a child: never a candidate.
  { pid: 1, ppid: 0, mb: 1, name: 'tini', cmd: '/.pilot/tini -- tail -f /dev/null', score: 500 },
  { pid: 5, ppid: 1, mb: 3, name: 'tail', cmd: 'tail -f /dev/null', score: 500 },
  { pid: HOST, ppid: 1, mb: 400, name: 'node', cmd: 'node bin/marble-drive.js serve' },
  // turn A: claude, a small shell, and a browser test with its Chromium
  { pid: 200, ppid: HOST, mb: 300, name: 'claude', cmd: 'claude -p', score: 500 },
  { pid: 201, ppid: 200, mb: 5, name: 'bash', cmd: 'bash -c ls', score: 500 },
  { pid: 210, ppid: 200, mb: 60, name: 'node', cmd: 'node --test test-browser/a.test.js', score: 500 },
  { pid: 211, ppid: 210, mb: 900, name: 'chrome (renderer)', cmd: '/cache/chromium/chrome --type=renderer', score: 500 },
  { pid: 212, ppid: 210, mb: 700, name: 'chrome', cmd: '/cache/chromium/chrome --headless', score: 500 },
  // turn B: only claude itself
  { pid: 300, ppid: HOST, mb: 350, name: 'claude', cmd: 'claude -p', score: 500 },
  // someone's own console session, not an agent's
  { pid: 400, ppid: 1, mb: 2000, name: 'python3', cmd: 'python3 big.py', score: -900 },
];

test('the heaviest thing a turn runs comes first, with its whole tree', async () => {
  const procs = readProcesses(await fakeProc({ procs: TREE }));
  const [first, second] = candidates(procs, HOST);
  assert.deepEqual(first.pids.sort(), [210, 211, 212]);
  assert.equal(first.whole, false);
  assert.equal(first.cmd, 'node --test test-browser/a.test.js');
  assert.equal(Math.round(first.rss / MB), 1660);
  assert.equal(second.turn, 300, 'then turn B, stopped whole since it runs nothing');
  assert.equal(second.whole, true);
  for (const c of candidates(procs, HOST)) {
    assert.ok(!c.pids.includes(HOST) && !c.pids.includes(400) && !c.pids.includes(1) && !c.pids.includes(5), 'never the host, init, or a stranger');
  }
  assert.equal(candidates(procs, HOST).length, 4, 'turn A: two commands and itself; turn B: itself');
});

test('where the memory is: host, agents and their browsers, the rest', async () => {
  const procs = readProcesses(await fakeProc({ procs: TREE }));
  assert.deepEqual(breakdown(procs, HOST), { host: 400, agents: 2315, browsers: 1600, other: 2004 });
});

test('with memory to spare it does nothing', async () => {
  const killed = [];
  const guard = createMemoryGuard({ host: HOST, proc: await fakeProc({ availableMB: 2000, pressure: 5, procs: TREE }), kill: (pid) => killed.push(pid), schedule: null, log: { error() {} } });
  assert.equal(guard.check(), null);
  assert.deepEqual(killed, []);
});

test('short of memory, it stops the heaviest command and says so; the turn goes on', async () => {
  const killed = [];
  const said = [];
  const reliefs = [];
  const guard = createMemoryGuard({
    host: HOST,
    proc: await fakeProc({ availableMB: 600, procs: TREE }),
    kill: (pid) => killed.push(pid),
    schedule: null,
    log: { error: (m) => said.push(m) },
    onRelief: (r) => reliefs.push(r),
  });
  const relief = guard.check();
  assert.deepEqual(killed.sort(), [210, 211, 212]);
  assert.equal(relief.whole, false);
  assert.equal(reliefs.length, 1);
  assert.match(said[0], /^\[memory\] 600 MB of 8192 MB available, memory pressure 0%: stopped a command an agent was running, 1660 MB \(node --test test-browser\/a\.test\.js\)/);
});

test('memory pressure with little left is enough, and it waits before the next stop', async () => {
  const killed = [];
  let t = 0;
  const guard = createMemoryGuard({ host: HOST, proc: await fakeProc({ availableMB: 2500, pressure: 35, procs: TREE }), kill: (pid) => killed.push(pid), now: () => t, schedule: null, log: { error() {} } });
  assert.ok(guard.check());
  const first = killed.length;
  t = 5_000;
  assert.equal(guard.check(), null, 'within the cooldown');
  t = 11_000;
  assert.ok(guard.check());
  assert.ok(killed.length > first);
});

test('pressure alone, with plenty left, is not enough', async () => {
  const guard = createMemoryGuard({ host: HOST, proc: await fakeProc({ availableMB: 4000, pressure: 60, procs: TREE }), kill: () => assert.fail('killed'), schedule: null, log: { error() {} } });
  assert.equal(guard.check(), null);
});

test('with no agent running anything, it stops nothing, and says so once a minute', async () => {
  const said = [];
  let t = 0;
  const guard = createMemoryGuard({ host: HOST, proc: await fakeProc({ availableMB: 300, procs: TREE.filter((p) => (p.score ?? -900) !== 500 || p.pid < 100) }), kill: () => assert.fail('killed'), now: () => t, schedule: null, log: { error: (m) => said.push(m) } });
  for (t = 0; t <= 70_000; t += 11_000) assert.equal(guard.check(), null);
  assert.equal(said.length, 2, 'at 0 s and again past a minute, though it stayed tight throughout');
  assert.match(said[0], /no agent is running anything to stop/);
});

test('the host\'s reading: MB left, the total, and pressure', async () => {
  const guard = createMemoryGuard({ host: HOST, proc: await fakeProc({ availableMB: 2500, pressure: 3, procs: TREE }), schedule: null });
  assert.deepEqual(guard.reading(), { availableMB: 2500, totalMB: 8192, pressure: 3 });
});

test('where there is no /proc it is inert', () => {
  const guard = createMemoryGuard({ host: HOST, proc: '/nonexistent-proc', schedule: null });
  assert.equal(guard.check(), null);
  assert.equal(guard.snapshot(), null);
});
