// A drive's own ledger: one line for every minute it is awake.
//
// Nothing can watch the fleet from outside for free: the Sprites API answers
// only "now", Fly has no API for the bill, and the Console runs on a sprite
// that sleeps. But a drive's host runs exactly while the drive is awake, which
// is exactly while Fly bills it. So the host writes down, once a minute, what
// the machine used and why it was up, and the Console gathers the lines later
// (docs/superpowers/specs/2026-09-25-console-dashboard-design.md).
//
// A line: { t, dt, cpu, mem, used, disk, why, turns, opens, wake }
//   t      end of the minute, unix seconds
//   dt     awake seconds it covers (a freeze ends a minute early and adds nothing)
//   cpu    CPU-seconds the whole machine used (cgroup cpu.stat)
//   mem    GB of memory the machine holds, file cache included (memory.current)
//   used   GB in use by programs (MemTotal − MemAvailable); which of the two Fly
//          bills is settled by comparing with a real bill
//   disk   GB used on the drive's filesystem
//   why    the most seen in the minute of: tabs with live streams, tabs someone
//          used, work holding the sprite up, work waiting on a question
//   wake   on the first line after a sleep or a start: "warm" (the process was
//          frozen and carried on), "cold" (the machine booted), "restart" (a
//          new host on the same boot: a deploy or a settings change)
//
// One file per UTC day in <drive>/.marble/usage, kept 90 days. The ledger must
// never break a drive: a failed write is logged once and dropped.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const GiB = 2 ** 30;
const DAY = 24 * 60 * 60 * 1000;
const FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
// A machine up for less than this when the host starts has just booted.
const FRESH_BOOT_S = 300;

const round = (n, places = 3) => (n === null || n === undefined || !Number.isFinite(n) ? null : Number(n.toFixed(places)));
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** What the machine can say about itself, each null where it cannot. */
export function systemReaders({ cgroup = '/sys/fs/cgroup', proc = '/proc', disk = '/', read = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const attempt = (fn) => {
    try {
      const v = fn();
      return v === undefined || Number.isNaN(v) ? null : v;
    } catch {
      return null;
    }
  };
  const meminfo = () => {
    const text = read(path.join(proc, 'meminfo'));
    const kb = (name) => Number((new RegExp(`^${name}:\\s*(\\d+)`, 'm').exec(text) || [])[1]);
    return { total: kb('MemTotal'), available: kb('MemAvailable') };
  };
  return {
    cpuSeconds: () => attempt(() => {
      const m = /^usage_usec\s+(\d+)/m.exec(read(path.join(cgroup, 'cpu.stat')));
      return m ? Number(m[1]) / 1e6 : null;
    }),
    memGB: () => attempt(() => Number(read(path.join(cgroup, 'memory.current')).trim()) / GiB),
    usedGB: () => attempt(() => {
      const { total, available } = meminfo();
      return total && Number.isFinite(available) ? (total - available) / 2 ** 20 : null;
    }),
    diskGB: () => attempt(() => {
      const s = fs.statfsSync(disk);
      return ((s.blocks - s.bfree) * s.bsize) / GiB;
    }),
    bootId: () => attempt(() => read(path.join(proc, 'sys', 'kernel', 'random', 'boot_id')).trim() || null),
    uptimeSeconds: () => attempt(() => Number(read(path.join(proc, 'uptime')).split(/\s+/)[0])),
  };
}

export function createLedger({
  dir,
  readers = systemReaders(),
  why = () => ({ tabs: 0, looking: 0, work: 0, asks: 0 }),
  now = Date.now,
  tickMs = 15_000,
  lineMs = 60_000,
  keepDays = 90,
  schedule = setInterval,
  log = console,
} = {}) {
  let lastWall = now();
  let lastCpu = readers.cpuSeconds();
  let wake = null;
  let failed = false;
  let writes = Promise.resolve();
  const counts = { turns: 0, opens: 0 };
  const fresh = () => ({ dt: 0, mem: [], used: [], why: { tabs: 0, looking: 0, work: 0, asks: 0 } });
  let minute = fresh();

  const fail = (err) => {
    if (failed) return;
    failed = true;
    log.error?.(`[ledger] ${err.message}`);
  };

  // How this process came to be running: a boot, or a new host on an old boot.
  async function start() {
    const boot = readers.bootId();
    const stored = await fsp.readFile(path.join(dir, '.boot'), 'utf8').then((s) => s.trim(), () => null);
    if (boot) wake = stored === boot ? 'restart' : 'cold';
    else {
      const up = readers.uptimeSeconds();
      wake = up !== null && up < FRESH_BOOT_S ? 'cold' : 'restart';
    }
    try {
      await fsp.mkdir(dir, { recursive: true });
      if (boot) await fsp.writeFile(path.join(dir, '.boot'), boot);
      const oldest = dayOf(now() - keepDays * DAY);
      for (const name of await fsp.readdir(dir)) {
        const m = FILE.exec(name);
        if (m && m[1] < oldest) await fsp.rm(path.join(dir, name), { force: true });
      }
    } catch (err) {
      fail(err);
    }
  }
  const ready = start();

  function flush(endMs) {
    if (minute.dt <= 0) return;
    const cpu = readers.cpuSeconds();
    let used = null;
    if (cpu !== null) {
      // A counter that went backwards belongs to a new machine: it started at zero.
      used = lastCpu === null || cpu < lastCpu ? cpu : cpu - lastCpu;
    }
    lastCpu = cpu;
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const line = {
      t: Math.round(endMs / 1000),
      dt: Math.round(minute.dt / 1000),
      cpu: round(used),
      mem: round(avg(minute.mem)),
      used: round(avg(minute.used)),
      disk: round(readers.diskGB(), 2),
      why: minute.why,
      turns: counts.turns,
      opens: counts.opens,
      wake,
    };
    wake = null;
    counts.turns = 0;
    counts.opens = 0;
    minute = fresh();
    const file = path.join(dir, `${dayOf(endMs)}.jsonl`);
    writes = writes
      .then(() => ready)
      .then(() => fsp.appendFile(file, `${JSON.stringify(line)}\n`))
      .catch(fail);
  }

  function tick() {
    const t = now();
    const gap = t - lastWall;
    const prior = lastWall;
    lastWall = t;
    if (gap > 2 * tickMs) {
      // The machine was frozen: the minute ended where it froze, and the time
      // asleep is not awake time.
      flush(prior);
      wake = 'warm';
      return;
    }
    minute.dt += gap;
    const mem = readers.memGB();
    if (mem !== null) minute.mem.push(mem);
    const used = readers.usedGB();
    if (used !== null) minute.used.push(used);
    try {
      const w = why() ?? {};
      for (const key of Object.keys(minute.why)) minute.why[key] = Math.max(minute.why[key], Number(w[key]) || 0);
    } catch {}
    if (minute.dt >= lineMs) flush(t);
  }

  const timer = schedule ? schedule(tick, tickMs) : null;
  timer?.unref?.();

  /** Every line after `since` (unix seconds), oldest first. */
  async function read(since = 0) {
    let names;
    try {
      names = (await fsp.readdir(dir)).filter((n) => FILE.test(n)).sort();
    } catch {
      return [];
    }
    const from = dayOf(since * 1000);
    const out = [];
    for (const name of names) {
      if (FILE.exec(name)[1] < from) continue;
      const text = await fsp.readFile(path.join(dir, name), 'utf8').catch(() => '');
      for (const raw of text.split('\n')) {
        if (!raw) continue;
        try {
          const line = JSON.parse(raw);
          if (line.t > since) out.push(line);
        } catch {}
      }
    }
    return out;
  }

  return {
    ready,
    tick,
    read,
    /** Something worth counting happened this minute: 'turns' or 'opens'. */
    count: (kind) => {
      if (kind in counts) counts[kind] += 1;
    },
    /** Resolves once every line so far is on disk. */
    settled: () => writes,
    /** Write the part-minute so far, then stop. */
    async stop() {
      if (timer) clearInterval(timer);
      flush(now());
      await writes;
    },
  };
}
