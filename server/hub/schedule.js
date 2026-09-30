// server/hub/schedule.js
// The home host keeps the hub current. Every minute it checks the lease, even
// when the drive is idle: a lease that moved means another machine is home, so
// this host stops (onLost) instead of uploading over it. A lease it cannot
// reach means waiting a minute, never uploading blind. It uploads only when the
// drive differs from the last upload (something newer, or files or documents
// added or deleted).
//
// dirty() says whether the hub is behind: an upload is running, or the drive
// last seen differs from the one last uploaded. A sprite pauses ~30 s after
// its last connection, freezing every timer, so the host keeps it awake while
// dirty() (bin/marble-drive.js). A separate timer (watchMs) rescans for it, so
// an edit is seen within seconds, not at the next minute; dirty() itself only
// reads what the scans left.

import { scan, up } from './sync.js';

export function scheduleUploads({
  root,
  settings,
  client,
  upload = up,
  scanImpl = scan,
  everyMs = 60_000,
  watchMs = 15_000,
  onLost,
  log = console.log,
  schedule = setInterval,
}) {
  let last = null; // the scan taken at the last successful upload
  let seen = null; // the newest scan, by either timer
  let scans = 0; // numbers each scan, so a slow one never overwrites a newer
  let seenNo = 0;
  let running = false;
  let uploading = false;
  let refreshing = false;
  const same = (a, b) => a.newest === b.newest && a.files === b.files && a.documents === b.documents;
  const look = async () => {
    const no = ++scans;
    const result = await scanImpl(root);
    if (no > seenNo) {
      seen = result;
      seenNo = no;
    }
    return result;
  };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      let lease;
      try {
        lease = await client.get();
      } catch (err) {
        log(`[hub] upload waits: the lease is unreachable (${err.message})`);
        return;
      }
      if (lease.home !== settings.HUB_MACHINE) {
        log(`[hub] the lease moved to ${lease.home} (epoch ${lease.epoch}); this host stops`);
        onLost(lease);
        return;
      }
      const now = await look();
      if (last && same(now, last)) return;
      const started = Date.now();
      uploading = true;
      let result;
      try {
        result = await upload({ root, settings, epoch: lease.epoch });
      } finally {
        uploading = false;
      }
      if (result.ok) {
        last = now;
        const moved = result.changed === undefined ? '' : ` ${result.changed} changed, ${result.deleted} deleted,`;
        log(`[hub] uploaded seq ${result.state.seq}: ${result.counts.files} files,${moved} in ${Date.now() - started}ms`);
      } else {
        log(`[hub] upload refused: ${result.why}`);
      }
    } catch (err) {
      log(`[hub] upload failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      await look();
    } catch {
      // the next tick scans again, and says what went wrong
    } finally {
      refreshing = false;
    }
  };
  const dirty = () => uploading || (seen !== null && (last === null || !same(seen, last)));
  const timer = schedule ? schedule(tick, everyMs) : null;
  timer?.unref?.();
  const watch = schedule ? schedule(refresh, watchMs) : null;
  watch?.unref?.();
  if (watch) refresh();
  return {
    tick,
    refresh,
    dirty,
    stop: () => {
      if (timer) clearInterval(timer);
      if (watch) clearInterval(watch);
    },
  };
}
