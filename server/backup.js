// Backups off the box.
//
// The documents are the work, and `.marble/history/` is the only undo that
// outlives a tab. In the Marble checkout that history is already 24 MB of gzip,
// which is the number that makes this a G0 card rather than a G3 one: the thing
// most worth not losing is the thing nobody thinks to copy.
//
// Two ways to send it, because there are two honest situations. A directory is
// a bind mount, a network share, or a path something else syncs onward — no
// dependencies, works on a laptop. A command is the escape hatch for object
// storage proper, and it is deliberately *your* command: this host has no
// business holding cloud credentials or choosing an SDK.

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';

const stamp = (at = new Date()) =>
  at.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

/** One backup, now. Returns what it did, so a CLI can print it and a timer can
 *  log it. Never throws into a timer — a failed backup must not stop a host. */
export async function backupNow({ root, dir, command, keep = 24, at = new Date() }) {
  if (command) {
    const code = await run(command, { MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_STAMP: stamp(at) });
    return { kind: 'command', command, code, ok: code === 0 };
  }
  if (!dir) return { kind: 'none', ok: false, why: 'no MARBLE_DRIVE_BACKUP_DIR and no MARBLE_DRIVE_BACKUP_CMD' };

  const target = path.join(dir, stamp(at));
  await fsp.mkdir(target, { recursive: true });
  // The whole root, `.marble/` included. Copying only the documents would be
  // copying the half you can rewrite and leaving the half you cannot.
  await fsp.cp(root, target, { recursive: true, force: true, errorOnExist: false });

  const dropped = await sweep(dir, keep);
  return { kind: 'dir', target, dropped, ok: true };
}

/** Oldest backups above `keep` are removed. Named by timestamp, so sorting the
 *  directory sorts by age and there is no index to keep honest. */
export async function sweep(dir, keep) {
  if (!Number.isFinite(keep) || keep <= 0) return 0;
  const entries = (await fsp.readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const doomed = entries.slice(0, Math.max(0, entries.length - keep));
  for (const name of doomed) await fsp.rm(path.join(dir, name), { recursive: true, force: true });
  return doomed.length;
}

function run(command, env) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

/** The schedule. Returns a stop function; the timer is unref'd so it never
 *  keeps a process alive on its own. */
export function scheduleBackups({ root, dir, command, keep, everyMinutes, log = console.log }) {
  if (!dir && !command) return () => {};
  if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) return () => {};

  const tick = async () => {
    const started = Date.now();
    try {
      const result = await backupNow({ root, dir, command, keep });
      log(
        result.ok
          ? `[drive] backup → ${result.target ?? result.command} in ${Date.now() - started}ms` +
              (result.dropped ? `, ${result.dropped} old one(s) swept` : '')
          : `[drive] backup skipped — ${result.why}`,
      );
    } catch (err) {
      log(`[drive] backup failed — ${err.message}`);
    }
  };

  const timer = setInterval(tick, everyMinutes * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
