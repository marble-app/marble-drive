// server/hub/schedule.js
// The home host keeps the hub current. Every minute it checks the lease, even
// when the drive is idle: a lease that moved means another machine is home, so
// this host stops (onLost) instead of uploading over it. A lease it cannot
// reach means waiting a minute, never uploading blind. It uploads only when the
// drive differs from the last upload (something newer, or files or documents
// added or deleted).

import { scan, up } from './sync.js';

export function scheduleUploads({
  root,
  settings,
  client,
  upload = up,
  scanImpl = scan,
  everyMs = 60_000,
  onLost,
  log = console.log,
  schedule = setInterval,
}) {
  let last = null; // the scan taken at the last successful upload
  let running = false;
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
      const seen = await scanImpl(root);
      if (last && seen.newest === last.newest && seen.files === last.files && seen.documents === last.documents) return;
      const started = Date.now();
      const result = await upload({ root, settings, epoch: lease.epoch });
      if (result.ok) {
        last = seen;
        log(`[hub] uploaded seq ${result.state.seq}: ${result.counts.files} files in ${Date.now() - started}ms`);
      } else {
        log(`[hub] upload refused: ${result.why}`);
      }
    } catch (err) {
      log(`[hub] upload failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = schedule ? schedule(tick, everyMs) : null;
  timer?.unref?.();
  return { tick, stop: () => timer && clearInterval(timer) };
}
