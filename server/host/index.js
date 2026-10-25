// marble-host: the one service outside every guest's sandbox on the owner's
// PC, and the only thing that starts and stops their drives (docs/HOSTING.md,
// "marble-host and the sandbox"). `marble-drive host` runs it, under the
// owner's user service marble-host.service (linux/pc-host/host.sh).
//
//   the router     127.0.0.1:4460, the tunnel's one way in
//   the admin API  127.0.0.1:4461, for the Console and tools/pc-host.mjs
//   the maker      the door's queue at start, when poked, and every 5 minutes
//   the watcher    every drive's health and memory, and the disk, every 30 s
//
// On start it brings back every drive the registry says is running
// (server/host/boot.js): no drive's service is enabled, so after the PC
// restarts this is what starts them. Stopping it leaves the drives running;
// they are services of their own.

import path from 'node:path';

import { createAdmin } from './admin.js';
import { createAlerts, notifier } from './alerts.js';
import { bootDrives } from './boot.js';
import { createProbe } from './check.js';
import { createGuestEnvs } from './guest-env.js';
import { createMaker } from './maker.js';
import { openRegistry } from './registry.js';
import { releaseForNewDrives } from './releases.js';
import { createRouter } from './router.js';
import { loadHostSettings } from './settings.js';
import { createUnits } from './units.js';
import { createWatcher } from './watcher.js';

export async function startHost({ env = process.env, log = console, units = null, probe = null, fetchImpl = fetch, watchEveryMs = 30_000, drainEveryMs = 5 * 60 * 1000 } = {}) {
  const settings = loadHostSettings(env);
  const init = `node tools/pc-host.mjs init writes it`;
  if (!settings.key) throw new Error(`HOST_KEY is not set in ${settings.settingsFile} (${init})`);
  if (!settings.adminToken) throw new Error(`HOST_ADMIN_TOKEN is not set in ${settings.settingsFile} (${init})`);

  const registry = await openRegistry({ dir: settings.state });
  const guestUnits = units ?? createUnits({ mode: settings.mode, opt: settings.opt, guestEnvDir: settings.guestEnvDir, guestStateDir: settings.guestStateDir, log });
  const envs = createGuestEnvs({ dir: settings.guestEnvDir });
  const asker = probe ?? createProbe({ fetchImpl });
  const notify = notifier({ alerts: createAlerts({ url: settings.ntfyUrl, fetchImpl, log }), registry });
  const maker = createMaker({ settings, registry, units: guestUnits, envs, probe: asker, notify, fetchImpl, log, drainEveryMs });
  // The drives' folders: /var/lib on the PC (the folder itself is root's to
  // open), or wherever a trial keeps them.
  const watcher = createWatcher({ registry, units: guestUnits, probe: asker, notify, diskPath: path.dirname(settings.guestStateDir), everyMs: watchEveryMs, log });

  const router = createRouter({
    key: settings.key,
    lookup: (name) => registry.drive(name),
    onPoke: () => maker.poke(),
    health: async () => {
      const kept = registry.drives().filter((d) => d.state !== 'removed');
      const { release } = await releaseForNewDrives({ registry, opt: settings.opt });
      return { drives: kept.length, running: kept.filter((d) => d.state === 'running').length, release };
    },
    log,
  });
  const admin = createAdmin({ token: settings.adminToken, settings, registry, units: guestUnits, maker, watcher, envs, probe: asker, log });

  const routerPort = await router.listen(settings.routerPort);
  let adminPort;
  try {
    adminPort = await admin.listen(settings.adminPort);
  } catch (err) {
    await router.close();
    throw err;
  }
  log.log?.(`[host] router on 127.0.0.1:${routerPort}, admin API on 127.0.0.1:${adminPort}; ${settings.mode} mode; registry ${registry.file}`);
  if (settings.mode === 'user') {
    log.log?.('[host] HOST_MODE=user: each drive is a transient unit of this user\'s own systemd, without a Linux user of its own or the network walls (those need linux/pc-host/install.sh)');
  }

  await bootDrives({ registry, units: guestUnits, envs, settings, notify, log });
  maker.start();
  watcher.start();

  return {
    settings,
    registry,
    maker,
    watcher,
    ports: { router: routerPort, admin: adminPort },
    async stop() {
      watcher.stop();
      maker.stop();
      await Promise.all([router.close(), admin.close()]);
    },
  };
}
