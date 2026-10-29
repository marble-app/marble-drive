// test/host-join.test.js
// Direct mode's sign-up page (server/host/join.js): one invite code, a name
// each, a drive each, and the link that signs its person in.
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createDoor, parseDoorKeys } from '../server/door.js';
import { createJoin, newInviteCode } from '../server/host/join.js';
import { newSigningKey } from '../server/host/passes.js';
import { createRouter } from '../server/host/router.js';
import { hostKeyEntry } from '../server/host/settings.js';
import { quiet } from './fixtures/host.js';

const signingKey = newSigningKey();
const CODE = 'ABCD-EFGH-JKLM';

async function rig({ code = CODE, max = 10, dnsOk = true, makeOk = true, drives = {} } = {}) {
  const made = [];
  const routed = [];
  const registry = { drive: (n) => drives[n] ?? null, drives: () => Object.values(drives) };
  const maker = {
    make: async ({ name, owner, cohort }) => {
      made.push({ name, owner, cohort });
      if (!makeOk) return { ok: false, status: 500, step: 'check', why: 'it did not answer /health' };
      drives[name] = { name, owner, state: 'running' };
      return { ok: true, drive: drives[name] };
    },
  };
  const settings = { publicSuffix: 'marbledrive.app', signingKey, inviteCohort: 'study', maxDrives: max };
  let current = code;
  const join = createJoin({ settings, registry, maker, readCode: () => current, routeDns: async (h) => (routed.push(h), { ok: dnsOk, said: dnsOk ? '' : 'already exists' }), log: quiet });
  const router = createRouter({ key: 'k', lookup: () => null, direct: { suffix: 'marbledrive.app' }, join, log: quiet });
  const port = await router.listen(0);
  return { port, made, routed, drives, setCode: (c) => (current = c), close: () => router.close() };
}

function ask(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: 'join.marbledrive.app', ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const post = (port, body, headers = {}) => ask(port, { method: 'POST', path: '/join', headers: { origin: 'https://join.marbledrive.app', 'content-type': 'application/json', ...headers }, body });

async function until(port, ticket) {
  for (let i = 0; i < 50; i += 1) {
    const r = (await ask(port, { path: `/join/${ticket}` })).json();
    if (r.state !== 'making') return r;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error('never ready');
}

test('the right code and a free name make a drive at its own name, and its link signs that person in', async (t) => {
  const r = await rig();
  t.after(r.close);
  const page = await ask(r.port);
  assert.equal(page.status, 200);
  assert.match(page.body, /Make your Marble Drive/);
  assert.equal((page.body.match(/<script/g) ?? []).length, 1);
  assert.doesNotMatch(page.body, /\son[a-z]+=/i);

  const res = await post(r.port, { code: ' abcd-efgh-jklm ', name: 'Ana-Lab' });
  assert.equal(res.status, 202, res.body);
  const { ticket, address } = res.json();
  assert.equal(address, 'ana-lab.marbledrive.app');
  const done = await until(r.port, ticket);
  assert.equal(done.state, 'ready');
  assert.deepEqual(r.routed, ['ana-lab.marbledrive.app']);
  assert.deepEqual(r.made, [{ name: 'ana-lab', owner: 'direct-ana-lab', cohort: 'study' }]);
  const pass = /^https:\/\/ana-lab\.marbledrive\.app\/enter#(.+)$/.exec(done.link)[1];
  const door = createDoor({ keys: parseDoorKeys(hostKeyEntry(signingKey)), name: 'ana-lab', owner: 'direct-ana-lab', direct: true });
  assert.equal(door.check(pass).drv, 'ana-lab');
  assert.equal((await ask(r.port, { path: `/join/${'0'.repeat(48)}` })).status, 404, 'another ticket sees nothing');
});

test('a wrong code, another site, a bad or taken name, and a full PC: nothing is made', async (t) => {
  const r = await rig({ drives: { ben: { name: 'ben', state: 'running' } } });
  t.after(r.close);
  assert.equal((await post(r.port, { code: CODE, name: 'ana' }, { origin: 'https://evil.marbledrive.app' })).status, 403);
  const wrong = await post(r.port, { code: 'NOPE', name: 'ana' });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.json().field, 'code');
  for (const name of ['pc-ana', 'www', 'bryan', 'a', 'escape-check', 'x y']) {
    const res = await post(r.port, { code: CODE, name });
    assert.equal(res.status, 400, name);
    assert.equal(res.json().field, 'name');
  }
  assert.equal((await post(r.port, { code: CODE, name: 'ben' })).status, 409);
  assert.equal(r.made.length, 0);

  const full = await rig({ max: 1, drives: { ben: { name: 'ben', state: 'running' } } });
  t.after(full.close);
  assert.equal((await post(full.port, { code: CODE, name: 'ana' })).status, 503);
});

test('ten wrong codes from one address shut it out for the hour, the right code included', async (t) => {
  const r = await rig();
  t.after(r.close);
  const from = { 'cf-connecting-ip': '203.0.113.7' };
  for (let i = 0; i < 10; i += 1) assert.equal((await post(r.port, { code: `WRONG${i}`, name: 'ana' }, from)).status, 403);
  assert.equal((await post(r.port, { code: CODE, name: 'ana' }, from)).status, 429);
  assert.equal((await post(r.port, { code: CODE, name: 'ana' }, { 'cf-connecting-ip': '203.0.113.8' })).status, 202, 'another address still gets in');
});

test('no code means sign-up is closed; a new code turns the old one off at once', async (t) => {
  const r = await rig({ code: null });
  t.after(r.close);
  assert.match((await post(r.port, { code: CODE, name: 'ana' })).json().error, /closed/);
  r.setCode('NEWC-ODEE-EEEE');
  assert.equal((await post(r.port, { code: CODE, name: 'ana' })).status, 403);
  assert.equal((await post(r.port, { code: 'newc-odee-eeee', name: 'ana' })).status, 202);
});

test('a name that cannot be pointed at the tunnel, or a drive that fails its check, says to tell the inviter', async (t) => {
  for (const opts of [{ dnsOk: false }, { makeOk: false }]) {
    const r = await rig(opts);
    t.after(r.close);
    const { ticket } = (await post(r.port, { code: CODE, name: 'ana' })).json();
    const done = await until(r.port, ticket);
    assert.equal(done.state, 'failed');
    assert.match(done.error, /Tell the person who invited you/);
    assert.equal(done.link, undefined);
  }
});

test('invite codes are twelve readable characters in threes of four', () => {
  const a = newInviteCode();
  assert.match(a, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.notEqual(a, newInviteCode());
});
