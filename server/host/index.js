// marble-host: the one service outside every guest's sandbox on the owner's
// PC, and the only thing that starts and stops their drives (docs/HOSTING.md,
// "marble-host and the sandbox"). `marble-drive host` runs it, under the
// owner's user service marble-host.service (linux/pc-host/host.sh).
//
//   the router     127.0.0.1:4460, the tunnel's one way in
//   the admin API  127.0.0.1:4461, for the Console and tools/pc-host.mjs
//   the maker      the door's queue at start, when poked, and every 5 minutes
//   the watcher    every drive's health and memory, and the disk, every 30 s
//   the reconcile  the door's people at start and every 5 minutes: who is in
//                  the study, and which drives are ending
//   the remover    a drive off the PC for good, one way whoever asked
//   the looks      each drive's /health/deep and, in the study, /health/study,
//                  every 5 minutes, and the door's firsts for its timeline
//
// Each drive listens on a loopback address of its own, 127.0.0.<10 + port −
// 4500>, and marble-host asks it everything from 127.0.0.2: a guest's unit
// keeps it off 127.0.0.1, where this machine's own services listen
// (server/host/addresses.js).
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
import { createDoor } from './door.js';
import { createGuestEnvs } from './guest-env.js';
import { createLooks } from './looks.js';
import { createMaker } from './maker.js';
import { createReconciler } from './reconcile.js';
import { openRegistry } from './registry.js';
import { releaseForNewDrives } from './releases.js';
import { createRemover } from './remover.js';
import { createRouter } from './router.js';
import { loadHostSettings } from './settings.js';
import { createUnits } from './units.js';
import { createWatcher } from './watcher.js';

export async function startHost({ env = process.env, log = console, units = null, probe = null, fetchImpl = fetch, watchEveryMs = 30_000, drainEveryMs = 5 * 60 * 1000, reconcileEveryMs = 5 * 60 * 1000, lookEveryMs = 5 * 60 * 1000 } = {}) {
  const settings = loadHostSettings(env);
  const init = `node tools/pc-host.mjs init writes it`;
  if (!settings.key) throw new Error(`HOST_KEY is not set in ${settings.settingsFile} (${init})`);
  if (!settings.adminToken) throw new Error(`HOST_ADMIN_TOKEN is not set in ${settings.settingsFile} (${init})`);

  const registry = await openRegistry({ dir: settings.state });
  const guestUnits = units ?? createUnits({ mode: settings.mode, opt: settings.opt, guestEnvDir: settings.guestEnvDir, guestStateDir: settings.guestStateDir, log });
  const envs = createGuestEnvs({ dir: settings.guestEnvDir });
  const asker = probe ?? createProbe();
  const notify = notifier({ alerts: createAlerts({ url: settings.ntfyUrl, fetchImpl, log }), registry });
  const door = createDoor({ url: settings.doorUrl, token: settings.doorAdminToken, fetchImpl });
  const maker = createMaker({ settings, registry, units: guestUnits, envs, probe: asker, notify, door, log, drainEveryMs });
  const remover = createRemover({ registry, units: guestUnits, envs, probe: asker, door, log });
  const reconciler = createReconciler({ registry, envs, door, remover, log, everyMs: reconcileEveryMs });
  const looks = createLooks({ registry, probe: asker, envs, door, busy: (name) => remover.busy(name), log, everyMs: lookEveryMs });
  // A restart the watcher makes is a line in the door's timeline of a drive
  // the door asked for.
  const onRestart = async (name, restarts) => {
    if (door.on && registry.drive(name)?.door) await door.event(name, 'drive-restarted', { by: 'watcher', restarts });
  };
  // The drives' folders: /var/lib on the PC (the folder itself is root's to
  // open), or wherever a trial keeps them.
  const watcher = createWatcher({ registry, units: guestUnits, probe: asker, notify, diskPath: path.dirname(settings.guestStateDir), busy: (name) => remover.busy(name), onRestart, everyMs: watchEveryMs, log });

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
  const admin = createAdmin({ token: settings.adminToken, settings, registry, units: guestUnits, maker, watcher, envs, probe: asker, remover, looks, door, log });

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
  reconciler.start();
  looks.start();

  return {
    settings,
    registry,
    maker,
    watcher,
    reconciler,
    remover,
    looks,
    ports: { router: routerPort, admin: adminPort },
    async stop() {
      watcher.stop();
      maker.stop();
      reconciler.stop();
      looks.stop();
      await Promise.all([router.close(), admin.close()]);
    },
  };
}
