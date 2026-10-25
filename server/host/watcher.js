// The watcher: every half minute, each running drive's /health and its
// service's memory, and the disk the drives live on.
//
// A drive that fails to answer twice in a row is restarted, and the owner is
// told; one failure alone is a drive busy for a moment. Memory past 90% of
// its service's MemoryMax, or the disk under /var/lib past 90%, is an alert,
// at most once an hour per drive and kind. A drive being moved to a release
// is the updater's to watch, and is skipped here.

import fs from 'node:fs';

export function createWatcher({ registry, units, probe, notify, diskPath = '/var/lib', statfs = (p) => fs.statfsSync(p), busy = () => false, everyMs = 30_000, now = Date.now, log = console }) {
  const strikes = new Map();
  const readings = new Map();
  let ticking = false;
  let timer = null;

  const mb = (n) => `${Math.round(n / 2 ** 20)} MB`;

  async function look(d) {
    const h = await probe.health(d.port);
    readings.set(d.name, { ok: Boolean(h), working: h?.working ?? null, release: h?.release ?? null, at: new Date(now()).toISOString() });
    if (h) strikes.set(d.name, 0);
    else {
      const n = (strikes.get(d.name) ?? 0) + 1;
      strikes.set(d.name, n);
      if (n >= 2) {
        strikes.set(d.name, 0);
        await registry.event(d.name, 'unhealthy', { why: 'it did not answer /health twice in a row' });
        let restarted = true;
        try {
          await units.restart(d.name);
        } catch (err) {
          restarted = false;
          log.error?.(`[host] could not restart ${d.name}: ${err.message}`);
        }
        if (restarted) {
          await registry.update((r) => {
            if (r.drives[d.name]) r.drives[d.name].restarts = (r.drives[d.name].restarts ?? 0) + 1;
          });
          await registry.event(d.name, 'restarted', { by: 'watcher' });
        }
        await notify(d.name, 'unhealthy', restarted ? `${d.name} stopped answering and was restarted.` : `${d.name} stopped answering, and restarting it failed.`);
      }
    }
    const s = await units.show(d.name).catch(() => null);
    if (s?.memoryMax && s.memoryBytes !== null && s.memoryBytes > 0.9 * s.memoryMax) {
      await notify(d.name, 'memory', `${d.name} is using ${mb(s.memoryBytes)} of its ${mb(s.memoryMax)}.`);
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      for (const d of registry.drives()) {
        if (d.state !== 'running') {
          strikes.delete(d.name);
          continue;
        }
        if (busy(d.name)) continue;
        await look(d).catch((err) => log.error?.(`[host] watching ${d.name}: ${err.message}`));
      }
      try {
        const s = statfs(diskPath);
        const used = s.blocks ? 1 - s.bavail / s.blocks : 0;
        if (used > 0.9) await notify(null, 'disk', `The disk under ${diskPath} is ${Math.round(used * 100)}% full.`);
      } catch (err) {
        log.error?.(`[host] could not read the disk under ${diskPath}: ${err.message}`);
      }
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    /** The last /health reading of a drive: { ok, working, release, at }, or null. */
    health: (name) => readings.get(name) ?? null,
    start() {
      timer = setInterval(() => tick().catch(() => {}), everyMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
