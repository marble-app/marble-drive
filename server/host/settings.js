// marble-host's settings (docs/HOSTING.md, "Other people's drives on the PC").
//
// The keys and ports are in ~/.config/marble-drive/host.env, mode 600, which
// the owner makes with `node tools/pc-host.mjs init`. Every place marble-host
// reads or writes has a default here and an override in the environment, so a
// test or the user-mode trial never comes near /opt/marble, /etc/marble-guests
// or the owner's own state. The environment wins over the file, as node's
// --env-file does.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseEnvFile } from '../hub/settings.js';
import { GUEST_PORTS } from './addresses.js';

/** A drive's name on the PC: what the unit, its folder and its env file are called. */
export const NAME = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
/** A release's name, as tools/home-release.sh makes them (20261025T161133Z-4b2103a). */
export const RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** Never a drive's name: kept for the owner's escape check, whose throwaway
 *  guest is to be called this. */
export const RESERVED = new Set(['escape-check']);
/** The ports a guest may never have: the dev host, the owner's drive, a
 *  trial drive, and the release script's smoke test. */
export const NEVER_PORTS = [4400, 4401, 4402, 4498];

export const MODES = ['system', 'user'];

/** "4500-4599" as { from, to }, or an error naming the setting. */
export function parseRange(text) {
  const m = /^\s*(\d{4,5})\s*-\s*(\d{4,5})\s*$/.exec(String(text ?? ''));
  const from = m ? Number(m[1]) : NaN;
  const to = m ? Number(m[2]) : NaN;
  if (!m || from < 1024 || to > 65535 || from > to) throw new Error(`HOST_GUEST_PORTS is <first>-<last>, like 4500-4599 (not "${text}")`);
  return { from, to };
}

/** A KEY=value file, or null when there is none. One that others can read is
 *  refused: it holds the router's key and the door's admin token. */
export function readSettingsFile(file, { private: needPrivate = true } = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  if (needPrivate && (stat.mode & 0o077) !== 0) throw new Error(`${file} can be read by others; chmod 600 it first`);
  return parseEnvFile(fs.readFileSync(file, 'utf8'));
}

/** Where marble-host keeps and finds things. */
export function hostPaths(env = process.env) {
  const home = env.HOME || os.homedir();
  return {
    hostEnv: env.MARBLE_HOST_ENV || path.join(home, '.config', 'marble-drive', 'host.env'),
    // registry.json and events.jsonl
    state: env.HOST_STATE_DIR || path.join(home, '.local', 'state', 'marble-host'),
    // releases/, ms-playwright/ and bin/run-guest, as every guest sees them
    opt: env.HOST_OPT || '/opt/marble',
    // <name>.env, one per drive, hidden from every guest
    guestEnvDir: env.HOST_GUEST_ENV_DIR || '/etc/marble-guests',
    // StateDirectory=marble-guests/%i: each drive's own folder and home
    guestStateDir: env.HOST_GUEST_STATE_DIR || '/var/lib/marble-guests',
    // <name>.json, each drive's last backup, which root's backup writes and
    // anyone may read (docs/HOSTING.md, "Backups of PC drives")
    backupStatusDir: env.HOST_BACKUP_STATUS_DIR || '/var/lib/marble-backup/status',
  };
}

export function loadHostSettings(env = process.env) {
  const paths = hostPaths(env);
  const file = readSettingsFile(paths.hostEnv) ?? {};
  const get = (key, fallback = null) => {
    const value = env[key] ?? file[key];
    return value === undefined || value === '' ? fallback : value;
  };
  const port = (key, fallback) => {
    const n = Number(get(key, fallback));
    if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error(`${key} is a port number, not "${get(key)}"`);
    return n;
  };
  const mode = get('HOST_MODE', 'system');
  if (!MODES.includes(mode)) throw new Error(`HOST_MODE is system or user, not "${mode}"`);
  // A drive's loopback address comes from its port (server/host/addresses.js),
  // and only 127.0.0.10 to 127.0.0.109 are ever a drive's.
  const guestPorts = parseRange(get('HOST_GUEST_PORTS', `${GUEST_PORTS.from}-${GUEST_PORTS.to}`));
  if (guestPorts.from < GUEST_PORTS.from || guestPorts.to > GUEST_PORTS.to) {
    throw new Error(`HOST_GUEST_PORTS lies within ${GUEST_PORTS.from}-${GUEST_PORTS.to}, where each port gives a drive a loopback address of its own (not "${get('HOST_GUEST_PORTS')}")`);
  }
  return {
    ...paths,
    settingsFile: paths.hostEnv,
    settingsFound: Object.keys(file).length > 0,
    key: get('HOST_KEY'),
    adminToken: get('HOST_ADMIN_TOKEN'),
    routerPort: port('HOST_ROUTER_PORT', 4460),
    adminPort: port('HOST_ADMIN_PORT', 4461),
    guestPorts,
    publicSuffix: get('HOST_PUBLIC_SUFFIX', 'marbledrive.app'),
    doorUrl: get('DOOR_URL', 'https://marbledrive.app'),
    doorAdminToken: get('DOOR_ADMIN_TOKEN'),
    doorKeys: get('MARBLE_DOOR_KEYS'),
    ntfyUrl: get('HOST_NTFY_URL'),
    mode,
    ownerName: get('HOST_OWNER_NAME', 'Bryan'),
  };
}
