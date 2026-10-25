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

async function rig({ mode = 0o600, vars = {} } = {}) {
  const env = doorEnv(vars);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'door-cli-'));
  const settingsPath = path.join(dir, 'door.env');
  await fsp.writeFile(settingsPath, `# the door\nDOOR_URL=https://marbledrive.app\nDOOR_ADMIN_TOKEN=${env.DOOR_ADMIN_TOKEN}\n`, { mode });
  await fsp.chmod(settingsPath, mode);
  const fetchImpl = (input, init) => route(new Request(input, init), env, { fetchImpl: async () => new Response('{}', { status: 200 }) });
  const run = async (...argv) => {
    const out = [];
    const err = [];
    const code = await main(argv, { settingsPath, fetchImpl, out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  return { env, run, settingsPath, dir };
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
  // A drive on the PC host has no sprite; the list says where it runs.
  const code = (await (await dir('/invite', { uses: 1 })).json()).code;
  const pia = await (await dir('/identity', { provider: 'google', subject: '10', email: 'pia@example.com', name: 'Pia', invite: code })).json();
  await dir('/drive', { account: pia.account.id, name: 'pia', home: 'pchost' });
  const listed = (await r.run('drives')).out;
  assert.match(listed, /cyra\s+queued\s+[0-9a-f]{16}\s+d-cyra\s/);
  assert.match(listed, /pia\s+queued\s+[0-9a-f]{16}\s+the PC host\s/);
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

test('credit mint gives a drive made by hand its two settings, once; credit lists it without the token', async () => {
  const r = await rig({ vars: { CREDIT_ANTHROPIC_KEY: 'sk-ant-owner' } });
  const minted = await r.run('credit', 'mint', 't-ana', '--cap', '5', '--by', 'Bryan');
  assert.equal(minted.code, 0, minted.err);
  assert.match(minted.out, /t-ana has \$5\.00 of starter credit/);
  assert.match(minted.out, /^MARBLE_CREDIT_URL=https:\/\/marbledrive\.app\/_credit$/m);
  const token = /^MARBLE_CREDIT_TOKEN=(mdc_[0-9a-f]{48})$/m.exec(minted.out)?.[1];
  assert.ok(token, minted.out);

  const listed = await r.run('credit');
  assert.equal(listed.code, 0, listed.err);
  assert.match(listed.out, /t-ana\s+\$0\.00 of \$5\.00\s+Bryan\s+on/);
  assert.ok(!listed.out.includes(token));

  assert.match((await r.run('credit', 'cap', 't-ana', '8')).out, /\$0\.00 of \$8\.00 used/);
  assert.equal((await r.run('credit', 'off', 't-ana')).code, 0);
  assert.match((await r.run('credit')).out, /t-ana.*off/);
});

test('credit mint --write writes the settings at mode 600 and does not print the token', async () => {
  const r = await rig({ vars: { CREDIT_ANTHROPIC_KEY: 'sk-ant-owner' } });
  const file = path.join(r.dir, 'credit.env');
  const minted = await r.run('credit', 'mint', 'ana', '--write', file);
  assert.equal(minted.code, 0, minted.err);
  assert.ok(!/mdc_/.test(minted.out));
  const text = await fsp.readFile(file, 'utf8');
  assert.match(text, /^MARBLE_CREDIT_URL=https:\/\/marbledrive\.app\/_credit\nMARBLE_CREDIT_TOKEN=mdc_[0-9a-f]{48}\n$/);
  assert.equal((await fsp.stat(file)).mode & 0o777, 0o600);
});

test('with credit off, credit says so', async () => {
  const r = await rig();
  const res = await r.run('credit', 'mint', 'ana');
  assert.equal(res.code, 1);
  assert.match(res.err, /starter credit is off: the Worker has no CREDIT_ANTHROPIC_KEY/);
});

test('invite --credit gives the drive it makes its own amount', async () => {
  const r = await rig();
  assert.equal((await r.run('invite', '--credit', '10')).code, 0);
  const listed = await route(new Request('https://marbledrive.app/_door/invites', { headers: { authorization: `Bearer ${r.env.DOOR_ADMIN_TOKEN}` } }), r.env);
  assert.equal((await listed.json()).invites[0].credit, 10);
});

test('spares lists the drives kept ready, says why none is made, and forget-spare stops one being given out', async () => {
  const r = await rig();
  const dir = (p, b) => r.env.DIRECTORY.get('directory').fetch(new Request(`https://directory${p}`, { method: 'POST', body: JSON.stringify(b) }));
  assert.match((await r.run('spares')).out, /No spare drives\. With MARBLE_SPARE_DRIVES set on the door sprite/);
  await dir('/spares', { sprite: 'd-spare-0000aaaa', state: 'making' });
  await dir('/spares', { sprite: 'd-spare-0000aaaa', state: 'ready', url: 'https://d-spare-0000aaaa-x.sprites.app' });
  await dir('/spares', { sprite: 'd-spare-0000bbbb', state: 'making' });
  await dir('/spares', { sprite: 'd-spare-0000bbbb', state: 'failed' });
  const listed = await r.run('spares');
  assert.equal(listed.code, 0, listed.err);
  assert.match(listed.out, /d-spare-0000aaaa\s+ready\s+\d{4}-\d{2}-\d{2}\s+https:\/\/d-spare-0000aaaa-x\.sprites\.app/);
  assert.match(listed.out, /d-spare-0000bbbb\s+failed/);
  assert.match(listed.out, /No new spare is made while one has failed/);
  assert.match(listed.out, /--remove <sprite> --spare <sprite>/);
  const forgot = await r.run('forget-spare', 'd-spare-0000bbbb');
  assert.equal(forgot.code, 0, forgot.err);
  assert.match(forgot.out, /Forgot d-spare-0000bbbb/);
  assert.match(forgot.out, /tools\/sprite-provision\.sh --remove d-spare-0000bbbb --spare d-spare-0000bbbb/);
  assert.doesNotMatch((await r.run('spares')).out, /0000bbbb/);
  assert.match((await r.run('forget-spare', 'd-ana')).err, /forget which spare/);
  assert.match((await r.run('forget-spare', 'd-spare-0000cccc')).err, /No such spare/);
});
