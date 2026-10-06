#!/usr/bin/env node
// Move a drive's home between this machine (the owner's Mac or PC) and its
// sprite (docs/HOSTING.md, "A drive at home on the Mac or the PC").
//
//   node tools/drive-home.mjs to <here|fly> [--drive bryan] [--sprite admin-p2] [--now]
//   node tools/drive-home.mjs lease-to <here|fly> [--drive bryan] [--sprite admin-p2]
//   node tools/drive-home.mjs rescue-to <here|fly> --from <mac|pc> [--drive bryan] [--sprite admin-p2]
//
// <here> is this machine's name in the hub, its HUB_MACHINE: mac on the Mac,
// pc on the PC. Runs on that machine; the Mac and the PC never move a drive
// straight to each other, but through Fly. `to` waits (up to 10 minutes) until no agent is working on
// the side it leaves, unless --now, then holds that side, uploads, moves the
// lease, downloads and releases the other. `lease-to` moves only the lease (no
// upload, no download) to a side whose copy is good, holding the other side:
// for after a move that stopped with the lease on a copy it could not verify.
// `rescue-to` is for a home that is gone (the PC off or broken while the lease
// names it): the drive comes back from the hub as that home last uploaded it.
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
import { homePaths } from '../server/hub/home-paths.js';
import { leaseTo, moveHome, rescueTo } from '../server/hub/move.js';
import { holdPath, loadHubSettings, MACHINES } from '../server/hub/settings.js';

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const [command, to] = args;
const dead = flag('from', null);
if (!['to', 'lease-to', 'rescue-to'].includes(command) || !MACHINES.includes(to) || (command === 'rescue-to' && !MACHINES.includes(dead))) {
  console.error('usage: node tools/drive-home.mjs to <mac|pc|fly> [--drive bryan] [--sprite admin-p2] [--now]');
  console.error('       node tools/drive-home.mjs lease-to <mac|pc|fly> [--drive bryan] [--sprite admin-p2]');
  console.error('       node tools/drive-home.mjs rescue-to <mac|pc|fly> --from <mac|pc> [--drive bryan] [--sprite admin-p2]');
  process.exit(2);
}
const drive = flag('drive', 'bryan');
const sprite = flag('sprite', drive === 'bryan' ? 'admin-p2' : drive);
const local = homePaths(drive);
let settings;
try {
  settings = loadHubSettings(local.hubEnv);
} catch (err) {
  console.error(`drive-home: ${err.message}`);
  process.exit(1);
}
const here = settings.HUB_MACHINE;
if (here === 'fly') {
  console.error(`drive-home: ${local.hubEnv} says this machine is fly; run drive-home on the Mac or the PC`);
  process.exit(1);
}
if (to !== here && to !== 'fly') {
  console.error(`drive-home: this machine is ${here}; to move the drive to ${to}, run drive-home on ${to} (move it to fly from here first if it is at home here)`);
  process.exit(2);
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

// This machine: the Mac under launchd, or the PC (WSL2) under systemd.
function localSide() {
  const tool = path.join(local.app, 'current', 'marble-drive', 'tools', 'drive-sync.mjs');
  const env = { ...process.env, MARBLE_HUB_ENV: local.hubEnv };
  const repo = path.join(import.meta.dirname, '..');
  const restart = process.platform === 'darwin'
    ? () => run('/bin/zsh', [path.join(repo, 'macos', 'launchd', 'home.sh'), 'restart', drive])
    : () => run('/bin/bash', [path.join(repo, 'linux', 'systemd', 'home.sh'), 'restart', drive]);
  const hold = holdPath(settings);
  return {
    ...holding(here, {
      health: async () => (await fetch(`http://127.0.0.1:${local.port}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })).json(),
      mark: () => fsp.writeFile(hold, `held by drive-home at ${new Date().toISOString()}\n`),
      unmark: () => fsp.rm(hold, { force: true }),
      restart,
    }),
    holdFile: hold,
    upload: async ({ epoch }) => json((await run(process.execPath, [tool, 'up', '--root', local.root, '--epoch', String(epoch)], { env })).stdout),
    download: async () => json((await run(process.execPath, [tool, 'down', '--root', local.root], { env })).stdout),
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

const sides = { [here]: localSide(), fly: flySide() };
const client = createLeaseClient({ settings });

if (command === 'rescue-to') {
  const result = await rescueTo({ to, dead, sides, client });
  if (result.ok) console.log(`${drive} is at home on ${to} (epoch ${result.lease.epoch}), from the hub as ${dead} last uploaded it (${result.state.at}); ${dead} stands by when it is back`);
  else {
    console.error(`drive-home: stopped at ${result.step}: ${result.why}`);
    process.exit(1);
  }
} else if (command === 'lease-to') {
  const result = await leaseTo({ to, sides, client });
  if (result.ok) console.log(`${drive} is at home on ${to} (epoch ${result.lease.epoch}); ${to === 'fly' ? here : 'fly'} is held`);
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
