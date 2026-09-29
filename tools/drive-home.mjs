#!/usr/bin/env node
// Move a drive's home between the owner's Mac and its sprite
// (docs/HOSTING.md, "The owner's drive on the Mac").
//
//   node tools/drive-home.mjs to <mac|fly> [--drive bryan] [--sprite admin-p2] [--now]
//   node tools/drive-home.mjs lease-to <mac|fly> [--drive bryan] [--sprite admin-p2]
//
// Runs on the Mac. `to` waits (up to 10 minutes) until no agent is working on
// the side it leaves, unless --now, then holds that side, uploads, moves the
// lease, downloads and releases the other. `lease-to` moves only the lease (no
// upload, no download) to a side whose copy is good, holding the other side:
// for after a move that stopped with the lease on a copy it could not verify.
//
// Holding a side = a hold file beside its hub settings (server/hub/settings.js,
// holdPath) and a restart: tools/home-mode.mjs then says standby whatever the
// lease says. A stopped Sprites service would be started again by the proxy on
// the next request, as home; a held one comes back on standby.

import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { createLeaseClient } from '../server/hub/lease-client.js';
import { macPaths } from '../server/hub/mac-paths.js';
import { leaseTo, moveHome } from '../server/hub/move.js';
import { holdPath, loadHubSettings } from '../server/hub/settings.js';

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const [command, to] = args;
if (!['to', 'lease-to'].includes(command) || !['mac', 'fly'].includes(to)) {
  console.error('usage: node tools/drive-home.mjs to <mac|fly> [--drive bryan] [--sprite admin-p2] [--now]');
  console.error('       node tools/drive-home.mjs lease-to <mac|fly> [--drive bryan] [--sprite admin-p2]');
  process.exit(2);
}
const drive = flag('drive', 'bryan');
const sprite = flag('sprite', drive === 'bryan' ? 'admin-p2' : drive);
const mac = macPaths(drive);
let settings;
try {
  settings = loadHubSettings(mac.hubEnv);
} catch (err) {
  console.error(`drive-home: ${err.message}`);
  process.exit(1);
}

const HEALTH_TIMEOUT_MS = 5_000;
const WAIT_MS = 60_000;
const json = (stdout) => JSON.parse(stdout.trim().split('\n').pop());
const serving = (health) => Boolean(health?.ok && !health.standby);
const standingBy = (health) => Boolean(health?.ok && health.standby === true);
const answers = (health) => Boolean(health?.ok);
// Reads /health until it passes, for up to a minute (by the clock: a read over
// sprite exec takes a second or two on its own).
const waitFor = async (read, pass) => {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    if (pass(await read().catch(() => null))) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
};

// Every side holds and releases the same way; only the file and the restart differ.
function holding(name, { health, mark, unmark, restart }) {
  return {
    working: async () => (await health()).working ?? 0,
    health,
    healthy: () => waitFor(health, serving),
    async hold() {
      await mark();
      // Already on standby (the lease names the other side): the hold file is
      // enough, since the next start asks home-mode, which reads it.
      if (standingBy(await health().catch(() => null))) return;
      await restart();
      if (!(await waitFor(health, standingBy))) throw new Error(`${name} did not come back on standby within ${WAIT_MS / 1000} s`);
    },
    async release() {
      await unmark();
      await restart();
      if (!(await waitFor(health, answers))) throw new Error(`${name} did not answer /health within ${WAIT_MS / 1000} s`);
    },
  };
}

function macSide() {
  const tool = path.join(mac.app, 'current', 'marble-drive', 'tools', 'drive-sync.mjs');
  const env = { ...process.env, MARBLE_HUB_ENV: mac.hubEnv };
  const home = path.join(import.meta.dirname, '..', 'macos', 'launchd', 'home.sh');
  const hold = holdPath(settings);
  return {
    ...holding('mac', {
      health: async () => (await fetch(`http://127.0.0.1:${mac.port}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })).json(),
      mark: () => fsp.writeFile(hold, `held by drive-home at ${new Date().toISOString()}\n`),
      unmark: () => fsp.rm(hold, { force: true }),
      restart: () => run('/bin/zsh', [home, 'restart', drive]),
    }),
    holdFile: hold,
    upload: async ({ epoch }) => json((await run(process.execPath, [tool, 'up', '--root', mac.root, '--epoch', String(epoch)], { env })).stdout),
    download: async () => json((await run(process.execPath, [tool, 'down', '--root', mac.root], { env })).stdout),
  };
}

function flySide() {
  const sh = (command, options = {}) =>
    run('sprite', ['exec', '-o', 'marble-drive', '-s', sprite, '--', 'bash', '-lc', command], { maxBuffer: 8 << 20, ...options });
  const tool = 'cd ~/app/current/marble-drive && MARBLE_HUB_ENV=~/.config/marble-drive/hub.env node tools/drive-sync.mjs';
  // HUB_DRIVE is lowercase letters, digits and dashes (loadHubSettings), so it is safe in a command.
  const hold = `~/.config/marble-drive/hold-${settings.HUB_DRIVE}`;
  return {
    ...holding('fly', {
      health: async () => json((await sh('curl -fsS --max-time 5 127.0.0.1:4400/health', { timeout: 30_000 })).stdout),
      mark: () => sh(`mkdir -p ~/.config/marble-drive && date -u +'held by drive-home at %FT%TZ' > ${hold}`),
      unmark: () => sh(`rm -f ${hold}`),
      restart: () => sh('bash ~/app/release.sh apply'),
    }),
    holdFile: `${hold} on ${sprite}`,
    upload: async ({ epoch }) => json((await sh(`${tool} up --root /drive --epoch ${epoch}`)).stdout),
    download: async () => json((await sh(`${tool} down --root /drive`)).stdout),
  };
}

const sides = { mac: macSide(), fly: flySide() };
const client = createLeaseClient({ settings });

if (command === 'lease-to') {
  const result = await leaseTo({ to, sides, client });
  if (result.ok) console.log(`${drive} is at home on ${to} (epoch ${result.lease.epoch}); ${to === 'mac' ? 'fly' : 'mac'} is held`);
  else {
    console.error(`drive-home: stopped at ${result.step}: ${result.why}`);
    process.exit(1);
  }
} else {
  const result = await moveHome({ to, sides, client, now: args.includes('--now') });
  if (result.already) console.log(`${drive} is already at home on ${to} (epoch ${result.lease.epoch})`);
  else if (result.ok) console.log(`${drive} is at home on ${to} (epoch ${result.lease.epoch}), moved in ${result.seconds}s`);
  else {
    console.error(`drive-home: stopped at ${result.step}: ${result.why}`);
    process.exit(1);
  }
}
