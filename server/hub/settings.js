// server/hub/settings.js
// The hub's settings: a KEY=value file outside every drive and repo, mode 600,
// named by MARBLE_HUB_ENV. Unset (or empty) is "no hub": a drive with one home,
// which is every drive but the owner's. Set but unreadable is an error, never
// "no hub": a typo'd path must stop the drive, not make it a second home. Read
// from a file rather than the process environment so the R2 keys never reach
// an agent's child processes.

import fs from 'node:fs';
import path from 'node:path';

export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

// The drive's homes: the owner's Mac, the owner's PC (WSL2) and Fly. The
// lease names one; each machine knows which it is.
export const MACHINES = ['mac', 'pc', 'fly'];

const REQUIRED = ['HUB_DRIVE', 'HUB_MACHINE', 'HUB_PASSPHRASE', 'HUB_SALT', 'LEASE_URL', 'LEASE_TOKEN'];
const R2 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

export function loadHubSettings(file) {
  if (!file) return null;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`the hub settings file ${file} could not be read (${err.code ?? err.message})`);
  }
  const s = parseEnvFile(text);
  const needs = [...REQUIRED, ...(s.HUB_BACKEND === 'local' ? ['HUB_LOCAL_DIR'] : R2)];
  const missing = needs.filter((key) => !s[key]);
  if (missing.length) throw new Error(`${file} is missing ${missing.join(', ')}`);
  if (!MACHINES.includes(s.HUB_MACHINE)) throw new Error(`${file}: HUB_MACHINE must be one of ${MACHINES.join(', ')}`);
  if (!/^[a-z0-9-]+$/.test(s.HUB_DRIVE)) throw new Error(`${file}: HUB_DRIVE must be lowercase letters, digits and dashes`);
  return { ...s, file };
}

// While this file exists the machine stands by, whatever the lease says
// (tools/home-mode.mjs): tools/drive-home.mjs holds the side a drive leaves,
// so a restart, a reboot or the Sprites proxy waking a stopped service can
// never bring it back up serving.
export function holdPath(settings) {
  return path.join(path.dirname(settings.file), `hold-${settings.HUB_DRIVE}`);
}
