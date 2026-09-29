// server/hub/schedule.js
// The home host keeps the hub current: once a minute, only when something in
// the drive is newer than the last upload, and only while the lease still names
// this machine. A lease that moved means another machine is home, so this
// host stops (onLost) instead of uploading over it. A lease it cannot reach
// means waiting a minute, never uploading blind.

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
  let uploadedAt = 0;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { newest } = await scanImpl(root);
      if (newest <= uploadedAt) return;
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
      const started = Date.now();
      const result = await upload({ root, settings, epoch: lease.epoch });
      if (result.ok) {
        uploadedAt = started;
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
