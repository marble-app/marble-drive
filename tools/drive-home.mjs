#!/usr/bin/env node
// Move a drive's home between the owner's Mac and its sprite
// (docs/HOSTING.md, "The owner's drive on the Mac").
//
//   node tools/drive-home.mjs to <mac|fly> [--drive bryan] [--sprite admin-p2] [--now]
//
// Runs on the Mac. Waits (up to 10 minutes) until no agent is working on the
// side it leaves, unless --now. Prints each step, then where the drive is.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { createLeaseClient } from '../server/hub/lease-client.js';
import { macPaths } from '../server/hub/mac-paths.js';
import { moveHome } from '../server/hub/move.js';
import { loadHubSettings } from '../server/hub/settings.js';

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const to = args[0] === 'to' ? args[1] : null;
if (!['mac', 'fly'].includes(to)) {
  console.error('usage: node tools/drive-home.mjs to <mac|fly> [--drive bryan] [--sprite admin-p2] [--now]');
  process.exit(2);
}
const drive = flag('drive', 'bryan');
const sprite = flag('sprite', drive === 'bryan' ? 'admin-p2' : drive);
const mac = macPaths(drive);
const settings = loadHubSettings(mac.hubEnv);
if (!settings) {
  console.error(`drive-home: no hub settings at ${mac.hubEnv}`);
  process.exit(1);
}

const json = (stdout) => JSON.parse(stdout.trim().split('\n').pop());
const healthy = async (read) => {
  for (let i = 0; i < 60; i += 1) {
    const health = await read().catch(() => null);
    if (health?.ok && !health.standby) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};

function macSide() {
  const tool = path.join(mac.app, 'current', 'marble-drive', 'tools', 'drive-sync.mjs');
  const env = { ...process.env, MARBLE_HUB_ENV: mac.hubEnv };
  const home = path.join(import.meta.dirname, '..', 'macos', 'launchd', 'home.sh');
  const health = async () => (await fetch(`http://127.0.0.1:${mac.port}/health`)).json();
  return {
    working: async () => (await health()).working ?? 0,
    stop: () => run('/bin/zsh', [home, 'stop', drive]),
    start: () => run('/bin/zsh', [home, 'start', drive]),
    healthy: () => healthy(health),
    upload: async ({ epoch }) => json((await run(process.execPath, [tool, 'up', '--root', mac.root, '--epoch', String(epoch)], { env })).stdout),
    download: async () => json((await run(process.execPath, [tool, 'down', '--root', mac.root], { env })).stdout),
  };
}

function flySide() {
  const sh = (command) => run('sprite', ['exec', '-o', 'marble-drive', '-s', sprite, '--', 'bash', '-lc', command], { maxBuffer: 8 << 20 });
  const tool = 'cd ~/app/current/marble-drive && MARBLE_HUB_ENV=~/.config/marble-drive/hub.env node tools/drive-sync.mjs';
  const health = async () => json((await sh('curl -fsS 127.0.0.1:4400/health')).stdout);
  return {
    working: async () => (await health()).working ?? 0,
    stop: () => sh('sprite-env services stop marble-drive'),
    start: () => sh('bash ~/app/release.sh apply'),
    healthy: () => healthy(health),
    upload: async ({ epoch }) => json((await sh(`${tool} up --root /drive --epoch ${epoch}`)).stdout),
    download: async () => json((await sh(`${tool} down --root /drive`)).stdout),
  };
}

const result = await moveHome({
  to,
  sides: { mac: macSide(), fly: flySide() },
  client: createLeaseClient({ settings }),
  now: args.includes('--now'),
});
if (result.already) console.log(`${drive} is already at home on ${to} (epoch ${result.lease.epoch})`);
else if (result.ok) console.log(`${drive} is at home on ${to} (epoch ${result.lease.epoch}), moved in ${result.seconds}s`);
else {
  console.error(`drive-home: stopped at ${result.step}: ${result.why}`);
  process.exit(1);
}
