// test/door-directory.test.js
// The Directory (worker/src/door/directory.js): people, invites, drives,
// sessions, nonces, counters and the audit log, in one Durable Object.
import assert from 'node:assert/strict';
import test from 'node:test';

import { Directory } from '../worker/src/door/directory.js';
import { memoryStorage } from './fixtures/door-env.js';

function dir({ max = '10' } = {}) {
  const storage = memoryStorage();
  const object = new Directory({ storage }, { MAX_DRIVES: max });
  const call = async (method, path, body) => {
    const res = await object.fetch(new Request(`https://directory${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }));
    return { status: res.status, data: await res.json() };
  };
  return { storage, object, call, core: object.core };
}

const ana = { provider: 'google', subject: '1100000000000001', email: 'ana@example.com', name: 'Ana' };
const bob = { provider: 'github', subject: '4242', email: 'bob@example.com', name: 'Bob' };

async function invite(d, opts = {}) {
  const r = await d.call('POST', '/invite', { note: 'for a test', ...opts });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.code;
}

test('a new identity with an invite becomes an account, and the invite is not yet spent', async () => {
  const d = dir();
  const code = await invite(d);
  const r = await d.call('POST', '/identity', { ...ana, invite: code });
  assert.equal(r.status, 200);
  assert.equal(r.data.state, 'active');
  assert.equal(r.data.account.role, 'member');
  assert.equal(r.data.account.mayMake, true);
  assert.match(r.data.account.id, /^[0-9a-f]{16}$/);
  const peek = await d.call('POST', '/invite/peek', { code });
  assert.equal(peek.data.ok, true, 'still live until a drive is asked for');
  const again = await d.call('POST', '/identity', ana);
  assert.equal(again.data.account.id, r.data.account.id, 'a known identity returns its account');
});

test('a new identity without an invite is told so, and nothing is made', async () => {
  const d = dir();
  const r = await d.call('POST', '/identity', ana);
  assert.equal(r.data.state, 'new-needs-invite');
  assert.equal(r.data.account, undefined);
  assert.equal((await d.storage.list({ prefix: 'acct:' })).size, 0);
  const dead = await d.call('POST', '/identity', { ...ana, invite: 'f'.repeat(32) });
  assert.equal(dead.data.why, 'unknown');
});

test('two drives asked for at once on the last use of one invite: one drive, one refusal', async () => {
  const d = dir();
  const code = await invite(d, { uses: 1 });
  const a = (await d.call('POST', '/identity', { ...ana, invite: code })).data.account;
  const b = (await d.call('POST', '/identity', { ...bob, invite: code })).data.account;
  const [x, y] = await Promise.all([d.call('POST', '/drive', { account: a.id, name: 'ana' }), d.call('POST', '/drive', { account: b.id, name: 'bob' })]);
  const statuses = [x.status, y.status].sort();
  assert.deepEqual(statuses, [200, 403]);
  const refused = x.status === 403 ? x : y;
  assert.match(refused.data.why, /invite has been used/);
  assert.equal((await d.call('GET', '/drives')).data.drives.length, 1);
});

test('two people racing for the same name: one owner', async () => {
  const d = dir();
  const code = await invite(d, { uses: 2 });
  const a = (await d.call('POST', '/identity', { ...ana, invite: code })).data.account;
  const b = (await d.call('POST', '/identity', { ...bob, invite: code })).data.account;
  const [x, y] = await Promise.all([d.call('POST', '/drive', { account: a.id, name: 'garden' }), d.call('POST', '/drive', { account: b.id, name: 'garden' })]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  assert.match((x.status === 409 ? x : y).data.why, /garden is taken/);
  const drive = (await d.call('GET', '/drives/garden')).data;
  assert.equal(drive.state, 'queued');
  assert.equal(drive.sprite, 'd-garden');
  assert.ok([a.id, b.id].includes(drive.owner));
});

test('reserved and malformed names are refused with the reason in words', async () => {
  const d = dir();
  const code = await invite(d);
  const a = (await d.call('POST', '/identity', { ...ana, invite: code })).data.account;
  const cases = {
    ab: /at least 3/,
    'Ana': /lowercase/,
    '-ana': /start or end with a hyphen/,
    'a--b': /two hyphens/,
    'pc-ana': /kept for machines/,
    't-ana': /kept for machines/,
    admin: /kept for Marble Drive/,
    irene: /irene is taken/,
    [`a${'b'.repeat(30)}`]: /at most 30/,
  };
  for (const [name, why] of Object.entries(cases)) {
    const r = await d.call('POST', '/drive', { account: a.id, name });
    assert.equal(r.status, 400, name);
    assert.match(r.data.why, why, name);
  }
  assert.equal((await d.call('POST', '/invite/peek', { code })).data.ok, true, 'nothing was spent');
});

test('past MAX_DRIVES the drive is refused and the invite is left unspent', async () => {
  const d = dir({ max: '1' });
  const code = await invite(d, { uses: 2 });
  const a = (await d.call('POST', '/identity', { ...ana, invite: code })).data.account;
  const b = (await d.call('POST', '/identity', { ...bob, invite: code })).data.account;
  assert.equal((await d.call('POST', '/drive', { account: a.id, name: 'ana' })).status, 200);
  const r = await d.call('POST', '/drive', { account: b.id, name: 'bob' });
  assert.equal(r.status, 503);
  assert.match(r.data.why, /as many drives as he can/);
  const inv = (await d.call('GET', '/invites')).data.invites[0];
  assert.equal(inv.uses, 1, 'one use left');
  assert.equal(inv.code, undefined, 'no code in the list');
});

test('one drive per person', async () => {
  const d = dir();
  const code = await invite(d, { uses: 3 });
  const a = (await d.call('POST', '/identity', { ...ana, invite: code })).data.account;
  assert.equal((await d.call('POST', '/drive', { account: a.id, name: 'ana' })).status, 200);
  const r = await d.call('POST', '/drive', { account: a.id, name: 'ana-two' });
  assert.equal(r.status, 409);
  assert.match(r.data.why, /already have a drive/);
});

test('a claim invite binds an existing drive to the account without queuing a sprite', async () => {
  const d = dir();
  const code = await invite(d, { drive: 'irene', sprite: 't-irene' });
  const a = (await d.call('POST', '/identity', { provider: 'google', subject: '77', email: 'irene@example.com', name: 'Irene', invite: code })).data.account;
  assert.equal(a.claim, 'irene');
  const r = await d.call('POST', '/drive', { account: a.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.drive.state, 'ready');
  assert.equal(r.data.drive.owner, a.id);
  assert.equal(r.data.drive.sprite, 't-irene');
  assert.equal((await d.call('GET', '/queue')).data.drives.length, 0);
  assert.equal((await d.call('POST', '/invite/peek', { code })).data.why, 'spent');
});

test('the bootstrap invite makes the owner once; a second is refused', async () => {
  const d = dir();
  const code = await invite(d, { owner: true });
  const r = await d.call('POST', '/identity', { ...ana, invite: code });
  assert.equal(r.data.account.role, 'owner');
  assert.equal((await d.call('POST', '/invite', { owner: true })).status, 409);
  const other = await d.call('POST', '/identity', { ...bob, invite: code });
  assert.equal(other.data.state, 'new-needs-invite');
});

test('Ask for access: recorded once, approved, and the next sign-in may make a drive', async () => {
  const d = dir();
  const first = await d.call('POST', '/request', { ...bob, ip: '203.0.113.9' });
  const second = await d.call('POST', '/request', { ...bob, ip: '203.0.113.9' });
  assert.equal(second.data.already, true);
  assert.equal(second.data.request, first.data.request);
  assert.equal((await d.call('POST', '/identity', bob)).data.state, 'asked');
  const asked = (await d.call('GET', '/requests')).data.requests;
  assert.equal(asked.length, 1);
  assert.equal(asked[0].subject, undefined, 'the provider subject is not listed');
  await d.call('POST', '/approve', { request: first.data.request });
  const r = await d.call('POST', '/identity', bob);
  assert.equal(r.data.state, 'active');
  assert.equal(r.data.account.mayMake, true);
  assert.equal((await d.call('POST', '/drive', { account: r.data.account.id, name: 'bob' })).status, 200);
});

test('a nonce is fresh once within its two minutes', async () => {
  const d = dir();
  const n = 'a'.repeat(32);
  assert.equal((await d.call('POST', `/nonce/${n}`)).data.fresh, true);
  assert.equal((await d.call('POST', `/nonce/${n}`)).data.fresh, false);
  const [x, y] = await Promise.all([d.call('POST', `/nonce/${'b'.repeat(32)}`), d.call('POST', `/nonce/${'b'.repeat(32)}`)]);
  assert.deepEqual([x.data.fresh, y.data.fresh].sort(), [false, true]);
});

test('sessions: live until revoked, one or all', async () => {
  const d = dir();
  const code = await invite(d);
  const a = (await d.call('POST', '/identity', { ...ana, invite: code })).data.account;
  const s1 = (await d.call('POST', '/session', { account: a.id, method: 'google', device: 'Firefox' })).data;
  const s2 = (await d.call('POST', '/session', { account: a.id, method: 'google', device: 'Safari' })).data;
  assert.match(s1.sid, /^[0-9a-f]{64}$/);
  assert.equal((await d.call('GET', `/session/${s1.hash}`)).data.live, true);
  assert.ok(![...d.storage.map.keys()].some((k) => k.includes(s1.sid)), 'the session id itself is not stored');
  await d.call('DELETE', `/session/${s1.hash}`);
  assert.equal((await d.call('GET', `/session/${s1.hash}`)).data.live, false);
  assert.equal((await d.call('GET', `/session/${s2.hash}`)).data.live, true);
  await d.call('DELETE', `/accounts/${a.id}/sessions`);
  assert.equal((await d.call('GET', `/session/${s2.hash}`)).data.live, false);
});

test('a counter refuses past its limit and starts again after its window', async () => {
  const d = dir();
  let t = Date.parse('2026-10-10T12:00:00Z');
  d.core.now = () => t;
  for (let i = 0; i < 3; i += 1) assert.equal((await d.call('POST', '/count', { key: 'ip:1', limit: 3, windowSeconds: 60 })).data.ok, true);
  const over = (await d.call('POST', '/count', { key: 'ip:1', limit: 3, windowSeconds: 60 })).data;
  assert.equal(over.ok, false);
  assert.equal(over.retryAfter, 60);
  t += 61_000;
  assert.equal((await d.call('POST', '/count', { key: 'ip:1', limit: 3, windowSeconds: 60 })).data.ok, true);
});

test('the provisioner reports steps; ready names the sprite URL; failed names the step', async () => {
  const d = dir();
  const code = await invite(d, { uses: 2 });
  const a = (await d.call('POST', '/identity', { ...ana, invite: code })).data.account;
  const b = (await d.call('POST', '/identity', { ...bob, invite: code })).data.account;
  await d.call('POST', '/drive', { account: a.id, name: 'ana' });
  await d.call('POST', '/drive', { account: b.id, name: 'bob' });
  assert.deepEqual((await d.call('GET', '/queue')).data.drives.map((x) => x.name), ['ana', 'bob']);
  await d.call('POST', '/drives/ana/step', { step: 'machine', state: 'now' });
  let ana1 = (await d.call('GET', '/drives/ana')).data;
  assert.equal(ana1.state, 'making');
  assert.equal(ana1.steps.machine, 'now');
  assert.equal((await d.call('POST', '/drives/ana/step', { state: 'ready', url: 'http://x' })).status, 400);
  await d.call('POST', '/drives/ana/step', { state: 'ready', url: 'https://d-ana-abc.sprites.app', sprite: 'd-ana' });
  ana1 = (await d.call('GET', '/drives/ana')).data;
  assert.equal(ana1.state, 'ready');
  assert.equal(ana1.homes.fly, 'https://d-ana-abc.sprites.app');
  await d.call('POST', '/drives/bob/step', { step: 'install', state: 'failed' });
  const bob1 = (await d.call('GET', '/drives/bob')).data;
  assert.equal(bob1.state, 'failed');
  assert.equal(bob1.failed, 'install');
  await d.call('POST', '/drives/ana/hold', { on: true });
  assert.equal((await d.call('GET', '/drives/ana')).data.state, 'held');
  await d.call('POST', '/drives/ana/hold', { on: false });
  assert.equal((await d.call('GET', '/drives/ana')).data.state, 'ready');
});

test('audit lines name the kind and the account, and never a code or a session id', async () => {
  const d = dir();
  const code = await invite(d);
  const a = (await d.call('POST', '/identity', { ...ana, invite: code, ip: '198.51.100.7' })).data.account;
  const s = (await d.call('POST', '/session', { account: a.id, method: 'google' })).data;
  await d.call('POST', '/drive', { account: a.id, name: 'ana' });
  const lines = (await d.call('GET', '/log')).data.lines;
  const kinds = lines.map((l) => l.kind);
  for (const k of ['invite-made', 'account-made', 'session-opened', 'drive-asked']) assert.ok(kinds.includes(k), k);
  assert.ok(lines.some((l) => l.kind === 'drive-asked' && l.account === a.id));
  const all = JSON.stringify([...d.storage.map].filter(([k]) => k.startsWith('audit:')));
  assert.ok(!all.includes(code), 'no invite code');
  assert.ok(!all.includes(s.sid), 'no session id');
  assert.ok(!all.includes(s.hash), 'no session hash');
  const mine = (await d.call('GET', `/log?account=${a.id}`)).data.lines;
  assert.ok(mine.every((l) => l.account === a.id));
});
