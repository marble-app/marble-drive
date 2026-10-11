// The machine's memory, watched: stop the heaviest thing an agent is running
// before the machine runs out.
//
// A sprite has 8 GB and no swap. Run short, Linux does not kill anything: it
// drops programs' own pages from memory and reads them back, again and again,
// and everything stalls (exec, the files API, the host) for as long as the
// load lasts. That, not the disk, is what froze admin-p2 on 2026-09-29, with
// several agents' browser tests running at once. The kernel's own killer only
// acts on a true out-of-memory, which thrashing never quite reaches, so the
// turn-first kill order (server/agent/first-to-go.js) alone did not help.
//
// So the host looks every couple of seconds at two cheap numbers: memory still
// available, and the share of time tasks spent waiting on memory (the kernel's
// pressure stall figure). When either says the machine is close, it finds the
// agents' turns (the processes that raised their score to 500, and the trees
// under them), and stops the heaviest single thing one is running: a test run
// and its Chromium, a build. The turn itself goes on and reads its command as
// killed; only a turn whose own process is the heaviest thing is stopped
// whole. The host is never a candidate, nor anything that is not an agent's.
//
// Where there is no /proc (a Mac), it does nothing.

import fs from 'node:fs';
import path from 'node:path';

const PAGE = 4096;
const MB = 2 ** 20;
export const TURN_SCORE = 500;

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/** Available and total memory (bytes), and the pressure stall share (0–100). */
export function readMemory(proc = '/proc') {
  const info = readText(path.join(proc, 'meminfo'));
  if (!info) return null;
  const kb = (name) => Number((new RegExp(`^${name}:\\s*(\\d+)`, 'm').exec(info) || [])[1]) * 1024;
  const pressure = readText(path.join(proc, 'pressure', 'memory')) ?? '';
  const some = /^some avg10=([\d.]+)/m.exec(pressure);
  return { total: kb('MemTotal'), available: kb('MemAvailable'), pressure: some ? Number(some[1]) : 0 };
}

/** Every process: its parent, resident memory, score and command. */
export function readProcesses(proc = '/proc') {
  const out = new Map();
  let names;
  try {
    names = fs.readdirSync(proc);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const dir = path.join(proc, name);
    const stat = readText(path.join(dir, 'stat'));
    const statm = readText(path.join(dir, 'statm'));
    if (!stat || !statm) continue;
    // The command name is in parentheses and may hold anything, parentheses
    // included; the fields that follow start after the last one.
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const cmd = (readText(path.join(dir, 'cmdline')) ?? '').split('\0').filter(Boolean).join(' ');
    out.set(Number(name), {
      pid: Number(name),
      ppid: Number(after[1]),
      rss: Number(statm.split(' ')[1]) * PAGE,
      score: Number(readText(path.join(dir, 'oom_score_adj')) ?? 0),
      cmd,
    });
  }
  return out;
}

const childrenOf = (procs) => {
  const kids = new Map();
  for (const p of procs.values()) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p.pid);
  }
  return kids;
};

const treeOf = (pid, kids) => {
  const pids = [];
  const stack = [pid];
  while (stack.length) {
    const next = stack.pop();
    pids.push(next);
    stack.push(...(kids.get(next) ?? []));
  }
  return pids;
};

/**
 * The turns' roots, and for each the things it runs: every child's whole tree,
 * and the root itself. A root is a process at the turns' score whose parent is
 * not, under the host: the score alone is not enough, since a sprite's init
 * (tini, PID 1) runs at it too, and stopping that stops the machine.
 */
export function candidates(procs, host = process.pid) {
  const kids = childrenOf(procs);
  const hosted = new Set(treeOf(host, kids));
  hosted.delete(host);
  const out = [];
  for (const p of procs.values()) {
    if (!hosted.has(p.pid) || p.score !== TURN_SCORE || procs.get(p.ppid)?.score === TURN_SCORE) continue;
    const children = kids.get(p.pid) ?? [];
    const rest = new Set(treeOf(p.pid, kids));
    for (const child of children) {
      const pids = treeOf(child, kids);
      for (const pid of pids) rest.delete(pid);
      out.push({ turn: p.pid, pids, rss: pids.reduce((sum, pid) => sum + (procs.get(pid)?.rss ?? 0), 0), cmd: procs.get(child).cmd, whole: false });
    }
    // The turn's own process, stopped with everything under it.
    out.push({ turn: p.pid, pids: treeOf(p.pid, kids), rss: p.rss, cmd: p.cmd, whole: true });
  }
  return out.sort((a, b) => b.rss - a.rss);
}

const BROWSER = /chrom|headless_shell/i;

/** Where the memory is, in MB: the host, the agents' turns (and of those, browsers), everything else. */
export function breakdown(procs, host = process.pid) {
  const kids = childrenOf(procs);
  const turns = new Set();
  for (const c of candidates(procs, host)) if (c.whole) for (const pid of c.pids) turns.add(pid);
  let hostMB = 0;
  let agents = 0;
  let browsers = 0;
  let other = 0;
  const hostTree = new Set(treeOf(host, kids));
  for (const p of procs.values()) {
    if (turns.has(p.pid)) {
      agents += p.rss;
      if (BROWSER.test(p.cmd)) browsers += p.rss;
    } else if (hostTree.has(p.pid)) hostMB += p.rss;
    else other += p.rss;
  }
  const mb = (n) => Math.round(n / MB);
  return { host: mb(hostMB), agents: mb(agents), browsers: mb(browsers), other: mb(other) };
}

export function createMemoryGuard({
  proc = '/proc',
  host = process.pid,
  tickMs = 2000,
  // Act when less than `lowMB` is available, or when tasks spent at least
  // `pressure`% of the last 10 s waiting on memory and less than `pressuredMB`
  // is left. Amounts, not shares: the host on a sprite sees a 16 GB machine
  // of which about 8 GB is never its to use (the rest of Fly's autoscaled
  // memory), so MemAvailable is the real room left: about 6 GB idle, and
  // about 0.3 GB when admin-p2 froze. A hog on t-bryan stalled the machine
  // at 6.75 GB (pressure 46% over a minute).
  lowMB = 1536,
  pressure = 10,
  pressuredMB = 3072,
  cooldownMs = 10_000,
  now = Date.now,
  kill = (pid) => process.kill(pid, 'SIGKILL'),
  schedule = setInterval,
  log = console,
  onRelief = () => {},
} = {}) {
  const inert = { check: () => null, snapshot: () => null, reading: () => null, stop() {} };
  if (!readMemory(proc)) return inert;
  let quietUntil = 0;
  let saidNothing = -Infinity;

  function check() {
    const mem = readMemory(proc);
    if (!mem || !mem.total) return null;
    const left = mem.available / MB;
    const tight = left < lowMB || (mem.pressure >= pressure && left < pressuredMB);
    if (!tight || now() < quietUntil) return null;
    quietUntil = now() + cooldownMs;
    const state = `${Math.round(mem.available / MB)} MB of ${Math.round(mem.total / MB)} MB available, memory pressure ${mem.pressure}%`;
    const [heaviest] = candidates(readProcesses(proc), host);
    if (!heaviest) {
      if (now() - saidNothing > 60_000) {
        log.error?.(`[memory] ${state}, and no agent is running anything to stop`);
        saidNothing = now();
      }
      return null;
    }
    for (const pid of heaviest.pids) {
      try {
        kill(pid);
      } catch {}
    }
    const what = heaviest.whole ? 'an agent turn' : 'a command an agent was running';
    log.error?.(`[memory] ${state}: stopped ${what}, ${Math.round(heaviest.rss / MB)} MB (${heaviest.cmd.slice(0, 120)})`);
    const relief = { turnPid: heaviest.turn, whole: heaviest.whole, mb: Math.round(heaviest.rss / MB), cmd: heaviest.cmd };
    onRelief(relief);
    return relief;
  }

  const timer = schedule ? schedule(check, tickMs) : null;
  timer?.unref?.();
  return {
    check,
    snapshot: () => {
      const mem = readMemory(proc);
      return mem ? { totalGB: mem.total / 2 ** 30, ...breakdown(readProcesses(proc), host) } : null;
    },
    /** The two numbers it acts on, as the host sees them: MB left, and pressure. */
    reading: () => {
      const mem = readMemory(proc);
      return mem ? { availableMB: Math.round(mem.available / MB), totalMB: Math.round(mem.total / MB), pressure: mem.pressure } : null;
    },
    stop: () => timer && clearInterval(timer),
  };
}
