// Time that passes only while this machine is awake, and whether a piece of
// work is making progress without printing anything.
//
// A paused Fly Sprite freezes every process; on waking, overdue timers fire at
// once and Date.now() has jumped by however long it slept. A limit measured in
// wall time would call a turn frozen overnight "stalled" the moment its owner
// opens the drive. So limits read `awake.now()`: a tick every 15 s adds the
// time since the last tick, but never more than two ticks, so a freeze adds
// nothing to speak of.
//
// Progress is output, or the CPU time and I/O of a process and everything it
// started, read from /proc: an agent running one quiet three-hour command is
// working, and a hung one is not. Off Linux there is no /proc, and progress is
// unknown (null) rather than zero.

import fs from 'node:fs';
import path from 'node:path';

export function createAwakeClock({ tickMs = 15_000, now = Date.now, schedule = setInterval } = {}) {
  let awake = 0;
  let last = now();
  const step = (t) => Math.max(0, Math.min(t - last, 2 * tickMs));
  function tick() {
    const t = now();
    awake += step(t);
    last = t;
  }
  const timer = schedule ? schedule(tick, tickMs) : null;
  timer?.unref?.();
  return {
    /** Milliseconds this process has been awake since the clock started. */
    now: () => awake + step(now()),
    tick,
    stop: () => timer && clearInterval(timer),
  };
}

export function createProgress({ procRoot = '/proc', read = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const available = fs.existsSync(path.join(procRoot, 'self'));

  /** pid → { ppid, cpu } for every process, from each /proc/<pid>/stat. */
  function table() {
    const all = new Map();
    for (const name of fs.readdirSync(procRoot)) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = read(path.join(procRoot, name, 'stat'));
        // The command sits in parentheses and may contain spaces: split after it.
        const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        // rest[0] is field 3 (state); ppid is field 4, utime 14, stime 15.
        all.set(Number(name), { ppid: Number(rest[1]), cpu: Number(rest[11]) + Number(rest[12]) });
      } catch {
        // Gone between the listing and the read.
      }
    }
    return all;
  }

  const ioOf = (pid) => {
    try {
      const io = read(path.join(procRoot, String(pid), 'io'));
      const field = (name) => Number((new RegExp(`^${name}:\\s*(\\d+)`, 'm').exec(io) || [])[1] || 0);
      return field('rchar') + field('wchar');
    } catch {
      return 0;
    }
  };

  /** CPU ticks plus I/O bytes of `pid` and all its descendants, or null. */
  function sample(pid) {
    if (!available || !pid) return null;
    let all;
    try {
      all = table();
    } catch {
      return null;
    }
    if (!all.has(pid)) return null;
    const tree = new Set([pid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [p, info] of all) {
        if (!tree.has(p) && tree.has(info.ppid)) {
          tree.add(p);
          grew = true;
        }
      }
    }
    let total = 0;
    for (const p of tree) total += all.get(p).cpu + ioOf(p);
    return total;
  }

  return { sample, available };
}
