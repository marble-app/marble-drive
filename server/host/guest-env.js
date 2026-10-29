// A drive's settings on the PC: /etc/marble-guests/<name>.env, mode 600, in a
// folder only the owner can open and every guest's sandbox hides. systemd
// reads it (EnvironmentFile=) before the sandbox closes, so the drive gets its
// passphrase and its door settings without being able to read anyone else's.
//
// systemd's parser and node's agree only on simple lines, so a value is
// written unquoted and may not hold whitespace, a quote, a backslash, `$` or a
// backtick. The one exception is MARBLE_DOOR_KEYS, the door's public keys,
// which are entries separated by single spaces (server/door.js): systemd keeps
// the spaces inside an unquoted value.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { guestAddress } from './addresses.js';
import { atomicWrite } from './registry.js';
import { NAME, RELEASE } from './settings.js';

const KEY = /^[A-Z][A-Z0-9_]*$/;
export const VALUE = /^[^\s"'\\$`]*$/;
const LIST = /^[^\s"'\\$`]+( [^\s"'\\$`]+)*$/;
const LISTS = new Set(['MARBLE_DOOR_KEYS']);

/** Throws, naming the key but never the value, for anything systemd might read differently. */
export function checkEntry(key, value) {
  if (!KEY.test(key)) throw new Error(`"${key}" is not a setting's name`);
  const text = String(value ?? '');
  if (text.includes('\n') || text.includes('\r')) throw new Error(`${key} holds a line break`);
  const ok = LISTS.has(key) ? text === '' || LIST.test(text) : VALUE.test(text);
  if (!ok) throw new Error(`${key} holds a character a guest's settings file cannot carry unquoted`);
}

/** What a drive's settings file says (docs/HOSTING.md, "A guest's settings"). */
export function guestEntries({ name, release, port, secret, doorKeys, owner, publicSuffix = 'marbledrive.app', ownerName = null, cohort = null, direct = false }) {
  if (!NAME.test(name ?? '')) throw new Error(`"${name}" is not a drive's name`);
  if (!RELEASE.test(release ?? '')) throw new Error(`"${release}" is not a release's name`);
  const email = `${name}@users.${publicSuffix}`;
  const entries = [
    ['MARBLE_GUEST_NAME', name],
    ['MARBLE_GUEST_RELEASE', release],
    ['PORT', String(port)],
    // The drive's own loopback address, from its port: run-guest listens there.
    ['HOST', guestAddress(port)],
    ['MARBLE_DRIVE_SECRET', secret],
    ['MARBLE_DOOR_KEYS', String(doorKeys ?? '').trim().split(/\s+/).filter(Boolean).join(' ')],
    ['MARBLE_DOOR_NAME', name],
    ['MARBLE_DOOR_OWNER', owner],
    ['MARBLE_DRIVE_GATE', 'tools'],
    ['MARBLE_DRIVE_PUBLIC_URL', `https://${name}.${publicSuffix}`],
    ['GIT_AUTHOR_NAME', name],
    ['GIT_AUTHOR_EMAIL', email],
    ['GIT_COMMITTER_NAME', name],
    ['GIT_COMMITTER_EMAIL', email],
  ];
  // A drive made from a study invite (the door's cohort `study`).
  if (cohort === 'study') entries.push(['MARBLE_STUDY', '1']);
  if (ownerName) entries.push(['MARBLE_HOST_OWNER', ownerName]);
  // No door in front: the pass comes by the person's sign-in link (server/door.js).
  if (direct) entries.push(['MARBLE_DOOR_DIRECT', '1']);
  for (const [key, value] of entries) checkEntry(key, value);
  return entries;
}

export const newSecret = () => crypto.randomBytes(32).toString('hex');

export function renderEnv(entries, { comment = null } = {}) {
  for (const [key, value] of entries) checkEntry(key, value);
  const head = comment ? `# ${comment}\n` : '';
  return `${head}${entries.map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}

/** The file's settings in order, as [key, value] pairs. */
export function parseEntries(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 1) continue;
    out.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
  }
  return out;
}

export function createGuestEnvs({ dir }) {
  const fileOf = (name) => {
    if (!NAME.test(name ?? '')) throw new Error(`"${name}" is not a drive's name`);
    return path.join(dir, `${name}.env`);
  };
  async function read(name) {
    try {
      return Object.fromEntries(parseEntries(await fsp.readFile(fileOf(name), 'utf8')));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }
  async function writeNow(name, entries) {
    const file = fileOf(name);
    await atomicWrite(file, renderEnv(entries, { comment: `${name}: written by marble-host; systemd reads it for marble-guest@${name}.service` }), 0o600);
    await fsp.chmod(file, 0o600);
  }
  // One change to a drive's file at a time, in the order asked: a change that
  // read the file before it was deleted must not write it back.
  const chains = new Map();
  const serial = (name, fn) => {
    const run = (chains.get(name) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    chains.set(name, tail);
    tail.then(() => {
      if (chains.get(name) === tail) chains.delete(name);
    });
    return run;
  };
  return {
    dir,
    file: fileOf,
    read,
    write: (name, entries) => serial(name, () => writeNow(name, entries)),
    /** Change some settings and keep the rest, in their order. A setting
     *  given as null is taken out. A file that is not there stays not there. */
    update: (name, patch) =>
      serial(name, async () => {
        const text = await fsp.readFile(fileOf(name), 'utf8');
        const entries = parseEntries(text);
        const seen = new Set();
        const next = [];
        for (const [key, value] of entries) {
          seen.add(key);
          if (!Object.hasOwn(patch, key)) next.push([key, value]);
          else if (patch[key] !== null && patch[key] !== undefined) next.push([key, String(patch[key])]);
        }
        for (const [key, value] of Object.entries(patch)) if (!seen.has(key) && value !== null && value !== undefined) next.push([key, String(value)]);
        await writeNow(name, next);
      }),
    remove: (name) => serial(name, () => fsp.rm(fileOf(name), { force: true })),
  };
}
