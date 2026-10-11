// Time that only passes while the sprite is awake, and a way to tell working
// from stuck that does not depend on a turn printing anything.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAwakeClock, createProgress } from '../server/awake.js';

test('the awake clock follows time, but a freeze adds at most two ticks', () => {
  let wall = 1_000_000;
  const clock = createAwakeClock({ tickMs: 15_000, now: () => wall, schedule: null });
  wall += 15_000; clock.tick();
  wall += 15_000; clock.tick();
  assert.equal(clock.now(), 30_000);
  wall += 8 * 60 * 60 * 1000; // frozen overnight
  clock.tick();
  assert.equal(clock.now(), 60_000, 'the night added two ticks, not eight hours');
  wall += 5_000;
  assert.equal(clock.now(), 65_000, 'reads between ticks');
});

/** A fake /proc: pid → { ppid, utime, stime, rchar, wchar }. */
async function fakeProc(procs) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'proc-'));
  const write = async (pid, p) => {
    await fsp.mkdir(path.join(root, String(pid)), { recursive: true });
    // Field 2 is the command in parentheses and may hold spaces.
    const fields = [pid, `(my cmd ${pid})`, 'S', p.ppid, ...Array(9).fill(0), p.utime, p.stime, 0, 0];
    await fsp.writeFile(path.join(root, String(pid), 'stat'), fields.join(' ') + ' 20 0 1 0\n');
    await fsp.writeFile(path.join(root, String(pid), 'io'), `rchar: ${p.rchar}\nwchar: ${p.wchar}\nsyscr: 1\n`);
  };
  for (const [pid, p] of Object.entries(procs)) await write(pid, p);
  await fsp.mkdir(path.join(root, 'self'), { recursive: true });
  return { root, write };
}

test('progress sums CPU and I/O over a process and all of its descendants', async () => {
  const proc = await fakeProc({
    100: { ppid: 1, utime: 10, stime: 5, rchar: 1000, wchar: 10 },
    200: { ppid: 100, utime: 50, stime: 0, rchar: 0, wchar: 0 },
    300: { ppid: 200, utime: 1, stime: 1, rchar: 5, wchar: 5 },
    999: { ppid: 1, utime: 7777, stime: 0, rchar: 0, wchar: 0 },
  });
  const progress = createProgress({ procRoot: proc.root });
  const first = progress.sample(100);
  assert.equal(first, 10 + 5 + 1000 + 10 + 50 + 1 + 1 + 5 + 5);
  // The grandchild works silently: CPU grows, nothing is printed.
  await proc.write(300, { ppid: 200, utime: 400, stime: 1, rchar: 5, wchar: 5 });
  assert.ok(progress.sample(100) > first, 'a descendant using CPU is progress');
  assert.equal(progress.sample(4242), null, 'a pid that is gone has no measure');
});

test('with no /proc (a Mac) progress is unknown, not zero', () => {
  const progress = createProgress({ procRoot: path.join(os.tmpdir(), 'no-such-proc') });
  assert.equal(progress.sample(1), null);
  assert.equal(progress.available, false);
});
