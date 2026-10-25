// The cgroup a drive is measured by.
//
// A drive on the owner's PC runs in a service of its own with a memory limit
// (marble-guest@<name>.service, MemoryMax=1536M), beside other people's drives
// on the same machine. Its ledger (server/ledger.js) and its memory guard
// (server/memory-guard.js) read that service's numbers: with the whole
// machine's, a quiet drive would stop its own agent's work because another
// drive was busy, and its ledger would bill it for everyone's memory.
//
// Anywhere else nothing changes. A sprite is one cgroup (`0::/`), a Mac has
// none, and the owner's own drive runs in a service with no limit, so each
// goes on reading the machine as before.

import fs from 'node:fs';
import path from 'node:path';

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

const bytes = (text) => (/^\d+$/.test(String(text ?? '').trim()) ? Number(String(text).trim()) : null);

/** The folder (under /sys/fs/cgroup) of this process's own cgroup, when it is
 *  not the root and has a numeric memory.max; otherwise null. */
export function ownCgroup({ proc = '/proc', root = '/sys/fs/cgroup', read = readText } = {}) {
  const text = read(path.join(proc, 'self', 'cgroup'));
  // cgroup v2 is the one line `0::<path>`.
  const rel = text?.split('\n').find((line) => line.startsWith('0::'))?.slice(3).trim();
  if (!rel || rel === '/' || rel.includes('..')) return null;
  const dir = path.join(root, rel);
  return bytes(read(path.join(dir, 'memory.max'))) === null ? null : dir;
}

/** A cgroup's memory in bytes: its hard limit (`max`), where it starts to be
 *  slowed (`high`, or null), what it holds (`current`, file cache included),
 *  what its programs use (`used`: less the inactive file cache it can drop,
 *  as a container's working set is counted), and the share of the last 10 s
 *  its tasks spent waiting on memory (`pressure`, 0–100). Null without a
 *  numeric limit. */
export function cgroupMemory(dir, read = readText) {
  const max = bytes(read(path.join(dir, 'memory.max')));
  if (max === null) return null;
  const high = bytes(read(path.join(dir, 'memory.high')));
  const current = bytes(read(path.join(dir, 'memory.current'))) ?? 0;
  const inactive = Number(/^inactive_file (\d+)$/m.exec(read(path.join(dir, 'memory.stat')) ?? '')?.[1] ?? 0);
  const some = /^some avg10=([\d.]+)/m.exec(read(path.join(dir, 'memory.pressure')) ?? '');
  return { max, high, current, used: Math.max(0, current - inactive), pressure: some ? Number(some[1]) : 0 };
}
