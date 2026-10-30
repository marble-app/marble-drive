// The Claude logins this drive can run a turn under. The default login is the
// CLI's own (~/.claude, or whatever CLAUDE_CONFIG_DIR the host started with),
// called Personal. Agents settings can name more, each a config dir the owner
// signed in to separately:
//
//   claudeAccounts: [{ folder: 'Ai2', configDir: '/home/…/.claude-ai2', label: 'Ai2' }]
//
// `folder` (or `folders`) is where that login is used without being asked: a
// turn on a document inside it runs there, the deepest folder winning. A chat
// can also be put on one login by hand (its `account`), which beats the folder.
// Entries that share a config dir are one login with several folders.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PERSONAL = 'personal';

const trimFolder = (value) => String(value ?? '').replace(/^\/+|\/+$/g, '');
const slug = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Every login, Personal first. `present` is false for a config dir this
 *  machine lacks (the drive moved hosts): it is listed, never used. */
export function listClaudeAccounts(entries, { exists = fs.existsSync, personalLabel = 'Personal' } = {}) {
  const personal = { id: PERSONAL, label: personalLabel, configDir: null, folders: [], present: true };
  const byDir = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const configDir = entry?.configDir;
    if (typeof configDir !== 'string' || !path.isAbsolute(configDir)) continue;
    const folders = [entry.folder, ...(Array.isArray(entry.folders) ? entry.folders : [])].map(trimFolder).filter(Boolean);
    const known = byDir.get(configDir);
    if (known) {
      for (const folder of folders) if (!known.folders.includes(folder)) known.folders.push(folder);
      continue;
    }
    const fallback = folders[0] || path.basename(configDir).replace(/^\.?claude-?/, '') || 'Other';
    const label = String(entry.label ?? '').trim() || fallback;
    let id = slug(entry.id) || slug(label) || slug(fallback);
    if (!id || id === PERSONAL) id = `login-${byDir.size + 1}`;
    byDir.set(configDir, { id, label, configDir, folders, present: Boolean(exists(configDir)) });
  }
  return [personal, ...byDir.values()];
}

/** The login a turn on `target` runs under. A hand-picked `choice` wins when
 *  that login is here; otherwise the deepest folder that holds the target;
 *  otherwise Personal. `how` says which of the three it was. */
export function claudeLoginFor({ target = null, entries = null, choice = null, exists = fs.existsSync } = {}) {
  const accounts = listClaudeAccounts(entries, { exists });
  const personal = accounts[0];
  if (choice === PERSONAL) return { ...personal, how: 'chosen' };
  const picked = choice ? accounts.find((account) => account.id === choice && account.present) : null;
  if (picked) return { ...picked, how: 'chosen' };
  const doc = typeof target === 'string' ? target.replace(/^\/+/, '') : '';
  let best = null;
  let depth = -1;
  for (const account of accounts) {
    if (!account.present) continue;
    for (const folder of account.folders) {
      if (doc.startsWith(`${folder}/`) && folder.length > depth) {
        best = account;
        depth = folder.length;
      }
    }
  }
  return best ? { ...best, how: 'folder' } : { ...personal, how: 'default' };
}

/** Two logins keep their sessions in one place when their projects folders
 *  are the same folder (the owner symlinked one to the other), so `--resume`
 *  finds a chat's session after it moves between them. */
export function sharesSessions(dirA, dirB, { home = os.homedir() } = {}) {
  const projects = (dir) => {
    const full = path.join(dir || path.join(home, '.claude'), 'projects');
    try {
      return fs.realpathSync(full);
    } catch {
      return full;
    }
  };
  return projects(dirA) === projects(dirB);
}

/** What the page is told: no config dirs, which are paths on the host. */
export const publicAccount = (account) => ({
  id: account.id,
  label: account.label,
  folders: [...(account.folders ?? [])],
  present: account.present !== false,
});

/** Who a login is signed in as, from Claude Code's own `auth status`: the
 *  email, the organisation and the plan. Nothing secret comes back.
 *  `signedIn` is null when the CLI could not be asked (slow, missing, or
 *  answering in words): not knowing is not being signed out. */
export async function describeLogin(account, { exec, env = {}, timeout = 15_000 } = {}) {
  const probeEnv = { ...env };
  if (account.configDir) probeEnv.CLAUDE_CONFIG_DIR = account.configDir;
  try {
    const probe = await exec('claude', ['auth', 'status'], { env: probeEnv, timeout });
    if (probe.missing) return { signedIn: null };
    const status = JSON.parse(String(probe.stdout ?? '').trim() || 'null');
    if (!status || typeof status !== 'object') return { signedIn: null };
    if (!status.loggedIn) return { signedIn: false };
    return {
      signedIn: true,
      email: typeof status.email === 'string' ? status.email : '',
      org: typeof status.orgName === 'string' ? status.orgName : '',
      plan: typeof status.subscriptionType === 'string' ? status.subscriptionType : '',
    };
  } catch {
    return { signedIn: null };
  }
}
