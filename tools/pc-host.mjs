#!/usr/bin/env node
// marble-host, from the owner's terminal (docs/HOSTING.md, "marble-host and
// the sandbox"): the drives the PC runs for other people, through
// marble-host's admin API on 127.0.0.1.
//
//   node tools/pc-host.mjs init                  write ~/.config/marble-drive/host.env (only what it lacks)
//   node tools/pc-host.mjs status                is marble-host up, which release new drives get, what runs
//   node tools/pc-host.mjs drives                every drive: state, port, release, memory, health, agent, last backup
//   node tools/pc-host.mjs make <name> --owner <door account id> [--cohort <cohort>]
//   node tools/pc-host.mjs restart|suspend|resume <name>
//   node tools/pc-host.mjs remove <name> --confirm <name>    off the PC for good: signed out, stopped, deleted
//   node tools/pc-host.mjs export <name>         copy its study data into Research/Probe study/<name>/
//   node tools/pc-host.mjs backup <name>         back it up now
//   node tools/pc-host.mjs events [--limit <n>]  what happened, newest first
//
// release, promote, rollback and pause belong to the updater, which the owner
// is writing himself; until then they say so and exit 1.
//
// init makes HOST_KEY (the Worker's PC_HOST_KEY) and HOST_ADMIN_TOKEN, copies
// DOOR_ADMIN_TOKEN from door.env and MARBLE_DOOR_KEYS from door-keys, and the
// alert topic from ntfy-topic when there is one. It never overwrites a value
// and never prints one. Every other command reads host.env, which must be
// mode 600.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDoorKeys } from '../server/door.js';
import { loadHostSettings } from '../server/host/settings.js';

const UPDATER = new Set(['release', 'promote', 'rollback', 'pause']);
export const NOT_BUILT = "the updater isn't built yet";
const NTFY_TOPIC = /^[A-Za-z0-9_-]{1,64}$/;

const random = () => crypto.randomBytes(32).toString('hex');

/** host.env's settings in order, each as [value, where it came from] when it
 *  is missing, or [null, why not] when there is nothing to put. */
const DEFAULTS = [
  ['HOST_KEY', () => [random(), 'made']],
  ['HOST_ADMIN_TOKEN', () => [random(), 'made']],
  ['HOST_ROUTER_PORT', () => ['4460', 'default']],
  ['HOST_ADMIN_PORT', () => ['4461', 'default']],
  ['HOST_GUEST_PORTS', () => ['4500-4599', 'default']],
  ['HOST_PUBLIC_SUFFIX', () => ['marbledrive.app', 'default']],
  ['DOOR_URL', (from) => (from.door.DOOR_URL ? [from.door.DOOR_URL, 'from door.env'] : ['https://marbledrive.app', 'default'])],
  ['DOOR_ADMIN_TOKEN', (from) => (from.door.DOOR_ADMIN_TOKEN ? [from.door.DOOR_ADMIN_TOKEN, 'from door.env'] : [null, 'not set: door.env has none'])],
  ['MARBLE_DOOR_KEYS', (from) => (from.keys ? [from.keys, 'from door-keys'] : [null, 'not set: there is no door-keys'])],
  ['HOST_NTFY_URL', (from) => (from.topic ? [`https://ntfy.sh/${from.topic}`, 'from ntfy-topic'] : [null, 'not set: there is no ntfy-topic'])],
  ['HOST_MODE', () => ['system', 'default']],
  ['HOST_OWNER_NAME', () => ['Bryan', 'default']],
];

function parseArgs(argv) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      args.push(a);
      continue;
    }
    const at = a.indexOf('=');
    if (at > 0) flags[a.slice(2, at)] = a.slice(at + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return { flags, args };
}

const lines = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

const keyOf = (line) => /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line)?.[1] ?? null;
const valueOf = (line) => line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');

/** KEY=value pairs from a file only its owner can read; null when there is none. */
function privateSettings(file) {
  const text = lines(file);
  if (text === null) return null;
  if ((fs.statSync(file).mode & 0o077) !== 0) throw new Error(`${file} can be read by others; chmod 600 it first`);
  const out = {};
  for (const line of text.split('\n')) {
    const key = keyOf(line);
    if (key && !line.trim().startsWith('#')) out[key] = valueOf(line);
  }
  return out;
}

/** host.env, written with what it lacks and nothing it has changed. Returns
 *  what was done to each setting, never a value. */
export function init({ home, out = console.log }) {
  const dir = path.join(home, '.config', 'marble-drive');
  const file = path.join(dir, 'host.env');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const before = lines(file);
  if (before !== null && (fs.statSync(file).mode & 0o077) !== 0) throw new Error(`${file} can be read by others; chmod 600 it first`);

  const door = privateSettings(path.join(dir, 'door.env')) ?? {};
  let keys = null;
  const keysText = lines(path.join(dir, 'door-keys'));
  if (keysText !== null) {
    if ((fs.statSync(path.join(dir, 'door-keys')).mode & 0o077) !== 0) throw new Error(`${path.join(dir, 'door-keys')} can be read by others; chmod 600 it first`);
    const entries = keysText.split(/\s+/).filter(Boolean).join(' ');
    try {
      parseDoorKeys(entries);
    } catch (err) {
      throw new Error(`door-keys: ${err.message.replace(/^MARBLE_DOOR_KEYS: /, '')}`);
    }
    keys = entries || null;
  }
  const topicText = lines(path.join(dir, 'ntfy-topic'))?.trim() ?? '';
  if (topicText && !NTFY_TOPIC.test(topicText)) throw new Error('ntfy-topic is not a topic name (letters, digits, - and _)');
  const from = { door, keys, topic: topicText || null };

  // Kept in their order; a setting there with no value is filled in where it
  // stands, and one not there at all is added at the end.
  const kept = (before ?? '').split('\n');
  if (kept.at(-1) === '') kept.pop();
  const has = new Map();
  kept.forEach((line, i) => {
    const key = keyOf(line);
    if (key && !line.trim().startsWith('#')) has.set(key, { i, value: valueOf(line) });
  });
  const done = [];
  for (const [key, make] of DEFAULTS) {
    const there = has.get(key);
    if (there?.value) {
      done.push([key, 'kept']);
      continue;
    }
    const [value, how] = make(from);
    if (value) {
      if (there) kept[there.i] = `${key}=${value}`;
      else kept.push(`${key}=${value}`);
    }
    done.push([key, how]);
  }
  const text = `${before === null ? '# marble-host (docs/HOSTING.md, "marble-host and the sandbox"); written by node tools/pc-host.mjs init\n' : ''}${kept.join('\n')}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);

  for (const [key, how] of done) out(`  ${key.padEnd(18)} ${how}`);
  out(`${file} is ready (mode 600).`);
  if (!door.DOOR_ADMIN_TOKEN) out('Without DOOR_ADMIN_TOKEN marble-host makes drives only when asked here (make), not from the door; run init again once door.env has it.');
  if (!keys) out('Without MARBLE_DOOR_KEYS a drive takes no pass from the door; run init again once door-keys is there.');
  return done;
}

const day = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '');
const mb = (n) => (Number.isFinite(n) && n !== null ? `${Math.round(n / 2 ** 20)} MB` : '');
const pad = (rows) => {
  if (!rows.length) return [];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length)));
  return rows.map((r) => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd());
};

export async function main(argv, { home = os.homedir(), env = process.env, fetchImpl = fetch, out = console.log, err = console.error } = {}) {
  const { flags, args } = parseArgs(argv);
  const [command, ...rest] = args;
  if (!command || flags.help) {
    out('node tools/pc-host.mjs init | status | drives | make <name> --owner <id> | restart|suspend|resume <name> | remove <name> --confirm <name> | export|backup <name> | events');
    return command ? 0 : 2;
  }

  if (command === 'init') {
    try {
      init({ home, out });
      return 0;
    } catch (e) {
      err(`pc-host: ${e.message}`);
      return 1;
    }
  }
  if (UPDATER.has(command)) {
    err(`pc-host: ${command}: ${NOT_BUILT}. Moving drives between releases is the owner's to write (docs/HOSTING.md, "marble-host and the sandbox").`);
    return 1;
  }

  let settings;
  try {
    settings = loadHostSettings({ ...env, HOME: home });
    if (!settings.settingsFound) throw new Error(`${settings.settingsFile} is missing: node tools/pc-host.mjs init`);
    if (!settings.adminToken) throw new Error(`${settings.settingsFile} has no HOST_ADMIN_TOKEN: node tools/pc-host.mjs init`);
  } catch (e) {
    err(`pc-host: ${e.message}`);
    return 1;
  }
  const base = `http://127.0.0.1:${settings.adminPort}`;
  const call = async (method, route, body) => {
    let res;
    try {
      res = await fetchImpl(`${base}${route}`, {
        method,
        headers: { authorization: `Bearer ${settings.adminToken}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error(`marble-host isn't answering on ${base} (linux/pc-host/host.sh status)`), { down: true });
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('marble-host refused the admin token in host.env');
    if (!res.ok) throw new Error(data.why ?? `marble-host answered ${res.status}`);
    return data;
  };
  const named = () => {
    if (!rest[0]) throw new Error(`${command} which drive? node tools/pc-host.mjs drives lists them`);
    return encodeURIComponent(rest[0]);
  };

  try {
    switch (command) {
      case 'status': {
        const [{ drives }, releases] = await Promise.all([call('GET', '/drives'), call('GET', '/releases')]);
        out(`marble-host is up on ${base} (${settings.mode} mode; router on 127.0.0.1:${settings.routerPort}).`);
        const { release, from } = releases.newDrives ?? {};
        if (release) out(`New drives get ${release} (${from === 'registry' ? 'the release the registry names for everyone' : `the newest in ${settings.opt}/releases`}).`);
        else out(`No release is in ${settings.opt}/releases, so no drive can be made yet. Putting one there is the updater's job.`);
        const count = (state) => drives.filter((d) => d.state === state).length;
        const up = drives.filter((d) => d.state === 'running' && d.active === 'active').length;
        const parts = [`${up} of ${count('running')} running drive${count('running') === 1 ? '' : 's'} up`];
        for (const state of ['suspended', 'failed', 'making', 'removed']) if (count(state)) parts.push(`${count(state)} ${state}`);
        out(`${parts.join(', ')}.`);
        return 0;
      }
      case 'drives': {
        const { drives } = await call('GET', '/drives');
        if (!drives.length) return out('No drives on this PC yet.'), 0;
        const health = (d) => (!d.health ? '' : d.health.ok ? `ok${d.health.working ? `, ${d.health.working} working` : ''}` : 'no answer');
        const backup = (b) => (!b ? '' : b.ok ? day(b.at) : `failed ${day(b.at)}`);
        const rows = drives.map((d) => [d.name, d.state === 'failed' && d.failed ? `failed at ${d.failed.step}` : d.state, d.active, d.port, d.release, mb(d.memoryBytes), health(d), d.restarts, d.agent ?? '', backup(d.backup), d.owner, d.cohort ?? '', day(d.created)]);
        for (const line of pad([['name', 'state', 'service', 'port', 'release', 'memory', 'health', 'restarts', 'agent', 'backup', 'owner', 'cohort', 'made'], ...rows])) out(line);
        return 0;
      }
      case 'make': {
        if (!rest[0]) throw new Error('make <name> --owner <door account id>');
        if (typeof flags.owner !== 'string') throw new Error('make needs --owner: the door account id of the person it is for');
        out(`Making ${rest[0]}; this waits for its check, about a minute.`);
        const { drive } = await call('POST', '/drives', { name: rest[0], owner: flags.owner, ...(typeof flags.cohort === 'string' ? { cohort: flags.cohort } : {}) });
        out(`${drive.name} is running on port ${drive.port}, release ${drive.release}.`);
        return 0;
      }
      case 'restart':
      case 'suspend':
      case 'resume': {
        const { drive } = await call('POST', `/drives/${named()}/${command}`, {});
        out(`${drive.name} is ${drive.state}${drive.state === 'running' ? ` (service ${drive.active})` : ''}.`);
        return 0;
      }
      case 'remove': {
        const name = named();
        if (flags.confirm !== rest[0]) {
          err(`pc-host: removing ${rest[0]} signs its agents out, stops it for good and deletes it from the PC; its encrypted backup stays. To go on: node tools/pc-host.mjs remove ${rest[0]} --confirm ${rest[0]}`);
          return 2;
        }
        const { removal } = await call('POST', `/drives/${name}/remove`, { confirm: rest[0] });
        const parts = [];
        if (removal?.folder === 'deleted') parts.push('its folder is deleted from the PC');
        if (removal?.folder === 'kept') parts.push('its folder stays, since user mode has no root helper');
        if (removal?.door === 'told') parts.push('the door knows');
        out(`${rest[0]} is removed${parts.length ? `: ${parts.join(', and ')}` : ''}. Its encrypted backup stays until you forget it.`);
        return 0;
      }
      case 'export': {
        const { started } = await call('POST', `/drives/${named()}/export`, {});
        out(`${started} is copying ${rest[0]}'s study data into Research/Probe study/${rest[0]}/ in your drive, in a folder named for when it ran.`);
        return 0;
      }
      case 'backup': {
        const { started } = await call('POST', `/drives/${named()}/backup`, {});
        out(`${started} is backing ${rest[0]} up; node tools/pc-host.mjs drives shows when it last ended well.`);
        return 0;
      }
      case 'events': {
        const { events } = await call('GET', `/events?limit=${encodeURIComponent(flags.limit ?? 50)}`);
        if (!events.length) return out('Nothing has happened yet.'), 0;
        for (const e of events) out(`${e.at}  ${String(e.kind).padEnd(11)} ${e.drive ?? '-'}  ${e.detail && Object.keys(e.detail).length ? JSON.stringify(e.detail) : ''}`.trimEnd());
        return 0;
      }
      default:
        err(`pc-host: no command "${command}"; there is init, status, drives, make, restart, suspend, resume, remove, export, backup, events`);
        return 2;
    }
  } catch (e) {
    err(`pc-host: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
