// server/hub/settings.js
// The hub's settings: a KEY=value file outside every drive and repo, mode 600,
// named by MARBLE_HUB_ENV. Unset or missing is "no hub": a drive with one home,
// which is every drive but the owner's. Read from a file rather than the
// process environment so the R2 keys never reach an agent's child processes.

import fs from 'node:fs';

export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const REQUIRED = ['HUB_DRIVE', 'HUB_MACHINE', 'HUB_PASSPHRASE', 'HUB_SALT', 'LEASE_URL', 'LEASE_TOKEN'];
const R2 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

export function loadHubSettings(file) {
  if (!file) return null;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const s = parseEnvFile(text);
  const needs = [...REQUIRED, ...(s.HUB_BACKEND === 'local' ? ['HUB_LOCAL_DIR'] : R2)];
  const missing = needs.filter((key) => !s[key]);
  if (missing.length) throw new Error(`${file} is missing ${missing.join(', ')}`);
  if (!['mac', 'fly'].includes(s.HUB_MACHINE)) throw new Error(`${file}: HUB_MACHINE must be mac or fly`);
  if (!/^[a-z0-9-]+$/.test(s.HUB_DRIVE)) throw new Error(`${file}: HUB_DRIVE must be lowercase letters, digits and dashes`);
  return { ...s, file };
}
