// tools/door.mjs against the real Worker code over a Directory in memory:
// an invite link is printed once and nothing else secret is, the bootstrap
// invite is the owner's alone, and a settings file others can read is refused.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { beforeEach } from 'node:test';

import { main } from '../tools/door.mjs';
import { forgetLeases, route } from '../worker/src/router.js';
import { doorEnv } from './fixtures/door-env.js';

beforeEach(() => forgetLeases());

async function rig({ mode = 0o600 } = {}) {
  const env = doorEnv();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'door-cli-'));
  const settingsPath = path.join(dir, 'door.env');
  await fsp.writeFile(settingsPath, `# the door\nDOOR_URL=https://marbledrive.app\nDOOR_ADMIN_TOKEN=${env.DOOR_ADMIN_TOKEN}\n`, { mode });
  await fsp.chmod(settingsPath, mode);
  const fetchImpl = (input, init) => route(new Request(input, init), env);
  const run = async (...argv) => {
    const out = [];
    const err = [];
    const code = await main(argv, { settingsPath, fetchImpl, out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  return { env, run, settingsPath };
}

test('invite prints its link once; invites lists it without the code', async () => {
  const r = await rig();
  const made = await r.run('invite', '--note', 'Ana', '--uses', '2');
  assert.equal(made.code, 0, made.err);
  const link = /https:\/\/marbledrive\.app\/join\/([0-9a-f]{32})/.exec(made.out);
  assert.ok(link, made.out);
  assert.match(made.out, /2 uses, for Ana, until \d{4}-\d{2}-\d{2}/);
  assert.ok(!made.out.includes(r.env.DOOR_ADMIN_TOKEN));
  const listed = await r.run('invites');
  assert.equal(listed.code, 0);
  assert.match(listed.out, /Ana/);
  assert.ok(!listed.out.includes(link[1]), 'the code is not listed');
});

test('--owner makes the bootstrap invite, and only while there is no owner', async () => {
  const r = await rig();
  const first = await r.run('invite', '--owner');
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /The owner’s invite/);
  const code = /join\/([0-9a-f]+)/.exec(first.out)[1];
  await r.env.DIRECTORY.get('directory').fetch(new Request('https://directory/identity', { method: 'POST', body: JSON.stringify({ provider: 'google', subject: '1', email: 'b@example.com', name: 'Bryan', invite: code }) }));
  const second = await r.run('invite', '--owner');
  assert.equal(second.code, 1);
  assert.match(second.err, /already an owner/);
});

test('a claim invite needs the sprite it hands over', async () => {
  const r = await rig();
  const bad = await r.run('invite', '--drive', 'irene');
  assert.equal(bad.code, 1);
  assert.match(bad.err, /--drive needs --sprite/);
  const good = await r.run('invite', '--drive', 'irene', '--sprite', 't-irene', '--note', 'Irene');
  assert.equal(good.code, 0, good.err);
  assert.match(good.out, /Hands over irene/);
});

test('a settings file others can read is refused by name, and the token never printed', async () => {
  const r = await rig({ mode: 0o644 });
  const res = await r.run('drives');
  assert.equal(res.code, 1);
  assert.match(res.err, /door\.env can be read by others; chmod 600 it first/);
  assert.ok(!res.err.includes('admin-token'));
  const missing = await main(['drives'], { settingsPath: '/nonexistent/door.env', out() {}, err: (l) => assert.match(l, /is missing/) });
  assert.equal(missing, 1);
});

test('requests, approve, drives, hold and log', async () => {
  const r = await rig();
  const dir = (p, b) => r.env.DIRECTORY.get('directory').fetch(new Request(`https://directory${p}`, { method: 'POST', body: JSON.stringify(b) }));
  await dir('/request', { provider: 'github', subject: '9', email: 'cy@example.com', name: 'Cy' });
  const reqs = await r.run('requests');
  assert.match(reqs.out, /Cy\s+cy@example\.com\s+github/);
  const id = reqs.out.split('\n')[1].split(/\s+/)[0];
  assert.match((await r.run('approve', id)).out, /Approved/);
  assert.equal((await r.run('requests')).out, 'Nobody is waiting.');

  const ident = await (await dir('/identity', { provider: 'github', subject: '9', email: 'cy@example.com', name: 'Cy' })).json();
  await dir('/drive', { account: ident.account.id, name: 'cyra' });
  assert.match((await r.run('drives')).out, /cyra\s+queued/);
  assert.match((await r.run('hold', 'cyra')).out, /cyra is on hold/);
  assert.match((await r.run('hold', 'cyra', '--off')).out, /cyra is open again/);
  const log = await r.run('log', '--account', ident.account.id);
  assert.match(log.out, /drive-asked/);
  assert.ok(log.out.split('\n').every((l) => l.includes(ident.account.id)));
});

test('a wrong token is said plainly', async () => {
  const r = await rig();
  await fsp.writeFile(r.settingsPath, 'DOOR_ADMIN_TOKEN=nope\n', { mode: 0o600 });
  const res = await r.run('drives');
  assert.equal(res.code, 1);
  assert.match(res.err, /refused the admin token/);
});
