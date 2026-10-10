#!/usr/bin/env node
// The door, from the owner's terminal (docs/superpowers/specs/
// 2026-10-10-accounts-and-sign-in-design.md; Console's People view is phase 2).
//
//   node tools/door.mjs invite [--note <who>] [--uses <n>] [--days <n>]   a link to make a drive
//   node tools/door.mjs invite --drive <name> --sprite <sprite> [--note]   hand an existing drive over
//   node tools/door.mjs invite --owner                                     the one bootstrap invite, for you
//   node tools/door.mjs invites                     what each invite is for, uses left (never the links)
//   node tools/door.mjs requests                    people who asked for access
//   node tools/door.mjs approve <request id>        let one of them make a drive at their next sign-in
//   node tools/door.mjs drives                      every drive, its state and owner
//   node tools/door.mjs hold <name> [--off]         stop a drive at the edge, or let it go again
//   node tools/door.mjs log [--account <id>]        the audit log, newest first
//
// Reads DOOR_URL and DOOR_ADMIN_TOKEN from ~/.config/marble-drive/door.env,
// which must be mode 600. An invite link is printed once, when it is made:
// the door keeps only its hash.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SETTINGS = path.join(os.homedir(), '.config', 'marble-drive', 'door.env');

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
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && !['owner', 'off'].includes(a.slice(2))) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return { flags, args };
}

export function readSettings(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error(`${file} is missing. Put DOOR_URL and DOOR_ADMIN_TOKEN in it, then chmod 600 it.`);
  }
  if ((stat.mode & 0o077) !== 0) throw new Error(`${file} can be read by others; chmod 600 it first.`);
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  if (!out.DOOR_ADMIN_TOKEN) throw new Error(`${file} has no DOOR_ADMIN_TOKEN.`);
  return { url: out.DOOR_URL || 'https://marbledrive.app', token: out.DOOR_ADMIN_TOKEN };
}

const day = (iso) => (iso ? iso.slice(0, 10) : '');
const pad = (rows) => {
  if (!rows.length) return [];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length)));
  return rows.map((r) => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd());
};

export async function main(argv, { settingsPath = SETTINGS, fetchImpl = fetch, out = console.log, err = console.error } = {}) {
  const { flags, args } = parseArgs(argv);
  const [command, ...rest] = args;
  if (!command || flags.help) {
    out('node tools/door.mjs invite | invites | requests | approve <id> | drives | hold <name> [--off] | log [--account <id>]');
    return command ? 0 : 2;
  }
  let settings;
  try {
    settings = readSettings(settingsPath);
  } catch (e) {
    err(`door: ${e.message}`);
    return 1;
  }
  const call = async (method, route, body) => {
    let res;
    try {
      res = await fetchImpl(new URL(`/_door${route}`, settings.url).href, {
        method,
        headers: { authorization: `Bearer ${settings.token}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(`couldn't reach ${settings.url}`);
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (res.status === 401) throw new Error('the door refused the admin token in door.env');
    if (!res.ok) throw new Error(data.why ?? `the door answered ${res.status}`);
    return data;
  };

  try {
    switch (command) {
      case 'invite': {
        if (flags.drive && !flags.sprite) throw new Error('--drive needs --sprite: the sprite that drive runs on');
        const body = {
          note: typeof flags.note === 'string' ? flags.note : '',
          uses: flags.uses ? Number(flags.uses) : 1,
          days: flags.days ? Number(flags.days) : 14,
          ...(flags.drive ? { drive: String(flags.drive), sprite: String(flags.sprite) } : {}),
          ...(flags.owner ? { owner: true } : {}),
        };
        const { link, invite } = await call('POST', '/invite', body);
        const what = invite.owner ? 'The owner’s invite' : invite.drive ? `Hands over ${invite.drive}` : `${invite.uses} use${invite.uses === 1 ? '' : 's'}`;
        out(`${what}${invite.note ? `, for ${invite.note}` : ''}, until ${day(invite.expires)}. Send this link; it is not shown again:`);
        out(link);
        return 0;
      }
      case 'invites': {
        const { invites } = await call('GET', '/invites');
        if (!invites.length) return out('No invites yet.'), 0;
        for (const line of pad([['id', 'note', 'uses left', 'until', 'for'], ...invites.map((i) => [i.id, i.note, i.uses, day(i.expires), i.owner ? 'the owner' : i.drive ? `drive ${i.drive}` : 'a new drive'])])) out(line);
        return 0;
      }
      case 'requests': {
        const { requests } = await call('GET', '/requests');
        if (!requests.length) return out('Nobody is waiting.'), 0;
        for (const line of pad([['id', 'name', 'email', 'via', 'asked'], ...requests.map((r) => [r.id, r.name, r.email, r.provider, day(r.at)])])) out(line);
        return 0;
      }
      case 'approve': {
        const id = rest[0];
        if (!id) throw new Error('approve which request? node tools/door.mjs requests lists them');
        await call('POST', '/approve', { request: id });
        out(`Approved. They can make a drive the next time they sign in; tell them.`);
        return 0;
      }
      case 'drives': {
        const { drives } = await call('GET', '/drives');
        if (!drives.length) return out('No drives yet.'), 0;
        for (const line of pad([['name', 'state', 'owner', 'sprite', 'made'], ...drives.map((d) => [d.name, d.state === 'failed' ? `failed at ${d.failed}` : d.state, d.owner, d.sprite ?? '', day(d.created)])])) out(line);
        return 0;
      }
      case 'hold': {
        const name = rest[0];
        if (!name) throw new Error('hold which drive?');
        const { drive } = await call('POST', `/drives/${encodeURIComponent(name)}/hold`, { on: !flags.off });
        out(drive.state === 'held' ? `${name} is on hold: the edge refuses it.` : `${name} is open again.`);
        return 0;
      }
      case 'log': {
        const q = flags.account ? `?account=${encodeURIComponent(flags.account)}` : '';
        const { lines } = await call('GET', `/log${q}`);
        for (const l of lines) out(`${l.at}  ${l.kind.padEnd(16)} ${l.account ?? '-'}  ${l.detail ? JSON.stringify(l.detail) : ''}`.trimEnd());
        return 0;
      }
      default:
        throw new Error(`no command "${command}": invite, invites, requests, approve, drives, hold, log`);
    }
  } catch (e) {
    err(`door: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
