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
//
// `fallback: 'personal'` (or another login's id) is where that login's turns
// go while it is out: a turn it ran stopped on a usage or spend limit, and the
// runner holds it out until the reset it named. `paused: true` takes its
// folders back by hand, so Auto puts them on Personal until it is unpaused; a
// chat that picked the login by name still uses it.

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
      if (entry.paused === true) known.paused = true;
      if (!known.fallback && entry.fallback) known.fallback = slug(entry.fallback) || null;
      continue;
    }
    const fallback = folders[0] || path.basename(configDir).replace(/^\.?claude-?/, '') || 'Other';
    const label = String(entry.label ?? '').trim() || fallback;
    let id = slug(entry.id) || slug(label) || slug(fallback);
    if (!id || id === PERSONAL) id = `login-${byDir.size + 1}`;
    byDir.set(configDir, {
      id,
      label,
      configDir,
      folders,
      present: Boolean(exists(configDir)),
      paused: entry.paused === true,
      fallback: slug(entry.fallback) || null,
    });
  }
  return [personal, ...byDir.values()];
}

/** The login a turn on `target` runs under. A hand-picked `choice` wins when
 *  that login is here; otherwise the deepest folder that holds the target,
 *  skipping a paused login; otherwise Personal. `how` says which of the three
 *  it was. A login in `out` (ids of logins that are out of usage) hands the
 *  turn to its `fallback`, when it names one that is here and not out itself:
 *  `how` is then 'fallback' and `from` is the login it stood in for. */
export function claudeLoginFor({ target = null, entries = null, choice = null, out = null, exists = fs.existsSync } = {}) {
  const accounts = listClaudeAccounts(entries, { exists });
  const personal = accounts[0];
  const isOut = (account) => Boolean(out && (out instanceof Map || out instanceof Set ? out.has(account.id) : out[account.id]));
  const standIn = (account, how) => {
    if (account.id === PERSONAL || !account.fallback || !isOut(account)) return { ...account, how };
    const next = accounts.find((item) => item.id === account.fallback && item.present && item.id !== account.id);
    if (!next || isOut(next)) return { ...account, how };
    return { ...next, how: 'fallback', from: account.id, fromLabel: account.label };
  };
  if (choice === PERSONAL) return { ...personal, how: 'chosen' };
  const picked = choice ? accounts.find((account) => account.id === choice && account.present) : null;
  if (picked) return standIn(picked, 'chosen');
  const doc = typeof target === 'string' ? target.replace(/^\/+/, '') : '';
  let best = null;
  let depth = -1;
  for (const account of accounts) {
    if (!account.present || account.paused) continue;
    for (const folder of account.folders) {
      if (doc.startsWith(`${folder}/`) && folder.length > depth) {
        best = account;
        depth = folder.length;
      }
    }
  }
  return best ? standIn(best, 'folder') : { ...personal, how: 'default' };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Minutes `zone` is ahead of UTC at the instant `ms`. */
function zoneOffset(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((wall - ms) / 60_000);
}

/** When a limit message says the login comes back, as epoch ms, or null.
 *  Claude says it as "resets Nov 2, 12pm (America/Los_Angeles)" or
 *  "resets 10:30am (America/Los_Angeles)": a time with no date is the next
 *  time that clock reads it. */
export function limitResetsAt(message, { now = Date.now() } = {}) {
  const match = /resets\s+(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(([^)]+)\))?/i.exec(String(message ?? ''));
  if (!match) return null;
  const [, mon, day, hourText, minText, half, zoneText] = match;
  let zone = zoneText?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  let hour = Number(hourText) % 12;
  if (/pm/i.test(half)) hour += 12;
  const minute = Number(minText ?? 0);
  const here = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  let year = +here.year;
  let month = mon ? MONTHS.indexOf(mon.toLowerCase()) : +here.month - 1;
  if (month < 0) return null;
  let date = mon ? Number(day) : +here.day;
  const at = (y, m, d) => {
    const guess = Date.UTC(y, m, d, hour, minute);
    const first = guess - zoneOffset(guess, zone) * 60_000;
    return guess - zoneOffset(first, zone) * 60_000;
  };
  let when = at(year, month, date);
  if (when <= now - 60_000) when = mon ? at(year + 1, month, date) : at(year, month, date + 1);
  return when;
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
  paused: account.paused === true,
  fallback: account.fallback ?? null,
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
