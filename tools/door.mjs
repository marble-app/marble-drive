#!/usr/bin/env node
// The door, from the owner's terminal (docs/superpowers/specs/
// 2026-10-10-accounts-and-sign-in-design.md; Console's People view is phase 2).
//
//   node tools/door.mjs invite [--note <who>] [--uses <n>] [--days <n>]   a link to make a drive
//   node tools/door.mjs invite --drive <name> --sprite <sprite> [--note]   hand an existing drive over
//   node tools/door.mjs invite --owner                                     the one bootstrap invite, for you
//   node tools/door.mjs invite --study [--note <who>]                      a link into the probe study: its
//                                                   person answers the consent screen before naming
//   node tools/door.mjs invites                     what each invite is for, uses left (never the links)
//   node tools/door.mjs people                      everyone with a drive or an open invite: their drive,
//                                                   the study, and how far they got from invite to first document
//   node tools/door.mjs remove <name> --confirm <name>
//                                                   take a drive away: the edge says it was removed, its
//                                                   owner is signed out, and marble-host deletes it from the PC
//   node tools/door.mjs revoke <account id>         sign someone out everywhere
//   node tools/door.mjs requests                    people who asked for access
//   node tools/door.mjs approve <request id>        let one of them make a drive at their next sign-in
//   node tools/door.mjs drives                      every drive, its state and owner
//   node tools/door.mjs hold <name> [--off]         stop a drive at the edge, or let it go again
//   node tools/door.mjs log [--account <id>]        the audit log, newest first
//   node tools/door.mjs credit                      each drive's starter credit: spent, cap, whose
//   node tools/door.mjs credit mint <name> [--cap <usd>] [--by <first name>] [--write <path>]
//                                                   a credit token for a drive, door-made or made by
//                                                   hand (t-<person>); its two settings are printed
//                                                   once, or written to --write (mode 600)
//   node tools/door.mjs credit cap <name> <usd>     change a drive's cap
//   node tools/door.mjs credit reset <name>         what it spent back to nothing
//   node tools/door.mjs credit off <name>           its token stops working
//   (invite takes --credit <usd> too: the credit the drive it makes gets)
//   node tools/door.mjs spares                      the drives kept ready for the next sign-ups
//   node tools/door.mjs forget-spare <sprite>       stop handing that spare out (its sprite stays)
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
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && !['owner', 'off', 'study'].includes(a.slice(2))) flags[a.slice(2)] = argv[++i];
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

/** Where someone is with the study, in a few words for a column. */
function studyWords(p) {
  const s = p.study ?? {};
  if (s.withdrawn) return `left ${day(s.withdrawn)}${s.deleteAsked ? ', delete asked' : ''}`;
  if (s.consent?.choice === 'declined') return 'said no';
  // A yes with a drive outside the cohort: made on Fly, where the study doesn't run.
  if (s.consent?.choice === 'given') return s.cohort === 'study' ? `in, form ${s.consent.version}` : 'said yes, drive on Fly';
  return p.invite?.study ? 'invited' : '-';
}

/** What someone's drive is doing, or how far they got without one. */
const stateWords = (p) => (p.drive ? (p.drive.home === 'pchost' ? p.drive.state : `${p.drive.state} on Fly`) : p.account ? 'no drive yet' : 'link not opened');
const pad = (rows) => {
  if (!rows.length) return [];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length)));
  return rows.map((r) => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd());
};

export async function main(argv, { settingsPath = SETTINGS, fetchImpl = fetch, out = console.log, err = console.error } = {}) {
  const { flags, args } = parseArgs(argv);
  const [command, ...rest] = args;
  if (!command || flags.help) {
    out('node tools/door.mjs invite [--study] | invites | people | requests | approve <id> | drives | hold <name> [--off] | remove <name> --confirm <name> | revoke <account> | log [--account <id>] | credit [mint|cap|reset|off <name>] | spares | forget-spare <sprite>');
    return command ? 0 : 2;
  }
  let settings;
  try {
    settings = readSettings(settingsPath);
  } catch (e) {
    err(`door: ${e.message}`);
    return 1;
  }
  const call = async (method, route, body, { under = '/_door' } = {}) => {
    let res;
    try {
      res = await fetchImpl(new URL(`${under}${route}`, settings.url).href, {
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
    if (res.status === 404 && under === '/_credit/admin' && !data.why) throw new Error('starter credit is off: the Worker has no CREDIT_ANTHROPIC_KEY');
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
          ...(flags.credit !== undefined ? { credit: Number(flags.credit) } : {}),
          ...(flags.study ? { study: true } : {}),
        };
        const { link, invite } = await call('POST', '/invite', body);
        const what = invite.owner ? 'The owner’s invite' : invite.drive ? `Hands over ${invite.drive}` : `${invite.uses} use${invite.uses === 1 ? '' : 's'}`;
        out(`${what}${invite.cohort === 'study' ? ', in the study' : ''}${invite.note ? `, for ${invite.note}` : ''}, until ${day(invite.expires)}. Send this link; it is not shown again:`);
        out(link);
        return 0;
      }
      case 'invites': {
        const { invites } = await call('GET', '/invites');
        if (!invites.length) return out('No invites yet.'), 0;
        for (const line of pad([['id', 'note', 'uses left', 'until', 'for'], ...invites.map((i) => [i.id, i.note, i.uses, day(i.expires), i.owner ? 'the owner' : i.drive ? `drive ${i.drive}` : i.cohort === 'study' ? 'a new drive, in the study' : 'a new drive'])])) out(line);
        return 0;
      }
      case 'people': {
        const { people } = await call('GET', '/people');
        if (!people.length) return out('Nobody yet. node tools/door.mjs invite makes a link.'), 0;
        const header = ['who', 'account', 'drive', 'state', 'study', 'invited', 'signed in', 'ready', 'agent', 'first doc'];
        const rows = people.map((p) => {
          const t = p.timeline ?? {};
          return [p.account?.name ?? (p.invite?.note || `invite ${p.invite?.id ?? ''}`), p.account?.id ?? '-', p.drive?.name ?? '-', stateWords(p), studyWords(p), ...[t.invited, t.signedIn, t.ready, t.agentConnected, t.firstDocument].map((at) => day(at) || '-')];
        });
        for (const line of pad([header, ...rows])) out(line);
        return 0;
      }
      case 'remove': {
        const name = rest[0];
        if (!name) throw new Error('remove which drive? node tools/door.mjs people lists them');
        // The name typed twice, as the Console has it typed once.
        if (flags.confirm !== name) {
          err(`door: removing ${name} stops it at the edge for good and signs its owner out everywhere; on the PC host, marble-host then deletes it. Its name is never given out again.`);
          err(`To go ahead: node tools/door.mjs remove ${name} --confirm ${name}`);
          return 1;
        }
        const { drive, sessions, already } = await call('POST', `/drives/${encodeURIComponent(name)}/remove`, { confirm: name });
        if (already) {
          out(`${name} is already ${drive.state}.`);
          return 0;
        }
        out(`${name} is removed at the edge, and ${sessions} session${sessions === 1 ? '' : 's'} of its owner ended.`);
        out(drive.home === 'pchost' ? 'marble-host deletes it from the PC and marks it removed.' : `Its sprite is still there: remove it with tools/sprite-provision.sh --remove ${name} --door ${name}`);
        return 0;
      }
      case 'revoke': {
        const id = rest[0];
        if (!id || !/^[0-9a-f]{16}$/.test(id)) throw new Error('revoke which account? node tools/door.mjs people lists their ids (16 hex digits)');
        const { count } = await call('POST', `/accounts/${id}/revoke`);
        out(`Signed ${id} out everywhere: ${count} session${count === 1 ? '' : 's'} ended.`);
        out('A drive they have open keeps working until its pass is an hour old; hold or remove the drive to stop it now.');
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
        // Where it runs: its sprite on Fly, or the PC host, which has no sprite.
        for (const line of pad([['name', 'state', 'owner', 'runs on', 'made'], ...drives.map((d) => [d.name, d.state === 'failed' ? `failed at ${d.failed}` : d.state, d.owner, d.home === 'pchost' ? 'the PC host' : d.sprite ?? '', day(d.created)])])) out(line);
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
      case 'credit': {
        const credit = (method, route, body) => call(method, route, body, { under: '/_credit/admin' });
        const [what, name, amount] = rest;
        const used = (c) => `$${c.spent.toFixed(2)} of $${c.cap.toFixed(2)}`;
        if (!what) {
          const { drives } = await credit('GET', '/drives');
          if (!drives.length) return out('No drive has starter credit yet.'), 0;
          for (const line of pad([['name', 'used', 'whose', 'token', 'last used'], ...drives.map((c) => [c.name, used(c), c.by ?? '', c.on ? 'on' : 'off', day(c.last)])])) out(line);
          return 0;
        }
        if (!name) throw new Error(`credit ${what} which drive?`);
        const at = `/drives/${encodeURIComponent(name)}`;
        if (what === 'mint') {
          const { token, credit: c } = await credit('POST', `${at}/token`, {
            ...(flags.cap !== undefined ? { cap: Number(flags.cap) } : {}),
            ...(typeof flags.by === 'string' ? { by: flags.by } : {}),
          });
          const lines = `MARBLE_CREDIT_URL=${new URL('/_credit', settings.url).href}\nMARBLE_CREDIT_TOKEN=${token}\n`;
          if (typeof flags.write === 'string') {
            fs.writeFileSync(flags.write, lines, { mode: 0o600 });
            fs.chmodSync(flags.write, 0o600);
            out(`${name} has $${c.cap.toFixed(2)} of starter credit. Its two settings are in ${flags.write}; add them to the drive's sprite.env and restart it.`);
          } else {
            out(`${name} has $${c.cap.toFixed(2)} of starter credit. Add these two lines to its sprite.env and restart it; they are not shown again:`);
            out(lines.trimEnd());
          }
          return 0;
        }
        if (what === 'cap') {
          if (amount === undefined) throw new Error('credit cap <name> <dollars>');
          const { credit: c } = await credit('POST', at, { cap: Number(amount) });
          out(`${name}: ${used(c)} used.`);
          return 0;
        }
        if (what === 'reset') {
          const { credit: c } = await credit('POST', at, { reset: true });
          out(`${name}: ${used(c)} used.`);
          return 0;
        }
        if (what === 'off') {
          await credit('DELETE', `${at}/token`);
          out(`${name}'s credit token no longer works. Mint a new one to turn it back on.`);
          return 0;
        }
        throw new Error(`no "credit ${what}": mint, cap, reset, off`);
      }
      case 'spares': {
        const { spares, room } = await call('GET', '/spares');
        if (!spares.length) out('No spare drives. With MARBLE_SPARE_DRIVES set on the door sprite, it makes one after its next poke.');
        else for (const line of pad([['sprite', 'state', 'since', 'url'], ...spares.map((x) => [x.sprite, x.state === 'failed' && x.failedFor ? `failed for ${x.failedFor}` : x.state, day(x.ready ?? x.made), x.url ?? ''])])) out(line);
        if (spares.some((x) => x.state === 'failed')) {
          out('');
          out('No new spare is made while one has failed. Forget it with node tools/door.mjs forget-spare <sprite>,');
          out('then remove its sprite on the door sprite: tools/sprite-provision.sh --remove <sprite> --spare <sprite>');
        }
        if (room <= 0) out('Sign-up has made as many drives as MAX_DRIVES allows, so no spare is made.');
        return 0;
      }
      case 'forget-spare': {
        const sprite = rest[0];
        if (!sprite || !/^d-spare-[0-9a-f]{6,16}$/.test(sprite)) throw new Error('forget which spare? node tools/door.mjs spares lists them (d-spare-<hex>)');
        await call('DELETE', `/spares/${sprite}`);
        out(`Forgot ${sprite}: no sign-up is given it. Its sprite is still there; remove it on the door sprite with`);
        out(`  tools/sprite-provision.sh --remove ${sprite} --spare ${sprite}`);
        return 0;
      }
      default:
        throw new Error(`no command "${command}": invite, invites, people, requests, approve, drives, hold, remove, revoke, log, credit, spares, forget-spare`);
    }
  } catch (e) {
    err(`door: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
