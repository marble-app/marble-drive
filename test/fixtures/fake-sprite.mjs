#!/usr/bin/env node
// A stand-in for the Sprites CLI, for the console's tests: it answers from a
// JSON state file (FAKE_SPRITE_STATE) and appends every call to FAKE_SPRITE_LOG,
// so no test can reach a real sprite.
//
// state = {
//   sprites: [ { name, status, url, url_settings, labels, last_running_at, ... } ],
//   checkpoints: { <name>: [ { id, create_time, comment } ] },
//   exec: { <name>: { stdout, stderr, code, delayMs } }       // any exec on it
//   probe: { <name>: { ...probe output } }                      // node <probe>
//   ledger: { <name>: [ { t, dt, cpu, mem, ... } ] }              // node ledger-read.mjs <since>
//   fail: { <command>: { stderr, code } }                        // e.g. "checkpoint"
// }

import fs from 'node:fs';

const statePath = process.env.FAKE_SPRITE_STATE;
const state = statePath ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const args = process.argv.slice(2);
// Files an exec uploads are logged with their contents, so a test can see
// exactly what a job wrote to a drive.
const files = {};
for (let i = 0; i < args.length; i += 1) {
  if (args[i] !== '--file') continue;
  const [local, remote] = args[i + 1].split(':');
  try {
    files[remote] = fs.readFileSync(local, 'utf8');
  } catch {
    files[remote] = null;
  }
}
if (process.env.FAKE_SPRITE_LOG) fs.appendFileSync(process.env.FAKE_SPRITE_LOG, `${JSON.stringify({ args, files })}\n`);

const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const done = (out, code = 0, err = '') => {
  if (out) process.stdout.write(typeof out === 'string' ? out : JSON.stringify(out));
  if (err) process.stderr.write(err);
  process.exit(code);
};
const failing = state.fail?.[args[0]];
if (failing) done('', failing.code ?? 1, failing.stderr ?? 'failed\n');

const sprites = state.sprites ?? [];
const one = (name) => sprites.find((s) => s.name === name);

switch (args[0]) {
  case 'api': {
    const route = args[args.length - 1];
    if (route === '/v1/sprites/' || route === '/v1/sprites') done({ data: sprites });
    const cp = /^\/v1\/sprites\/([^/]+)\/checkpoints$/.exec(route);
    if (cp) done([{ id: 'Current', create_time: new Date().toISOString() }, ...(state.checkpoints?.[cp[1]] ?? [])]);
    const single = /^\/v1\/sprites\/([^/]+)$/.exec(route);
    if (single) done(one(single[1]) ? { data: one(single[1]) } : { error: 'sprite not found' });
    done({ error: 'sprite not found' });
    break;
  }
  case 'list':
    done(sprites.map((s) => s.name).join('\n') + '\n');
    break;
  case 'info': {
    const s = one(flag('-s'));
    done(s ? `URL:  ${s.url}\nAuth: ${s.url_settings?.auth}\nLabels: ${(s.labels ?? []).join(', ')}\n` : '', s ? 0 : 1);
    break;
  }
  case 'exec': {
    const name = flag('-s');
    const rest = args.slice(args.indexOf('--') + 1);
    const script = rest.find((a) => a.endsWith('.mjs'));
    // A ledger read: every line of state.ledger[name] after the cursor.
    if (rest[0] === 'node' && script?.endsWith('ledger-read.mjs')) {
      const since = Number(rest[2]) || 0;
      const lines = (state.ledger?.[name] ?? []).filter((l) => l.t > since);
      done(`${JSON.stringify({ ledger: lines.length, more: false })}\n${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
    }
    if (rest[0] === 'node' && script && state.probe?.[name]) done(state.probe[name]);
    // A command may have its own answer (state.exec[name][<first word>]), or
    // the drive answers every exec the same way.
    const own = state.exec?.[name] ?? {};
    const answer = own[rest[0]] ?? own;
    const finish = () => done(answer.stdout ?? '', answer.code ?? 0, answer.stderr ?? '');
    if (answer.delayMs) setTimeout(finish, answer.delayMs);
    else finish();
    break;
  }
  case 'checkpoint':
  case 'restore':
  case 'config':
    done(`${args[0]} ok\n`);
    break;
  default:
    done('', 2, `fake sprite: no ${args[0]}\n`);
}
