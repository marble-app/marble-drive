// test/host-join.test.js
// Direct mode's sign-up page (server/host/join.js): one invite code, a name
// each, a drive each, and the link that signs its person in.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';

import { createDoor, parseDoorKeys } from '../server/door.js';
import { createJoin, newInviteCode } from '../server/host/join.js';
import { newSigningKey } from '../server/host/passes.js';
import { createRouter } from '../server/host/router.js';
import { hostKeyEntry } from '../server/host/settings.js';
import { quiet } from './fixtures/host.js';

const signingKey = newSigningKey();
const CODE = 'ABCD-EFGH-JKLM';

async function rig({ code = CODE, max = 10, dnsOk = true, makeOk = true, drives = {}, interest = null } = {}) {
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
  const settings = { publicSuffix: 'marbledrive.app', signingKey, inviteCohort: 'study', maxDrives: max, ownerName: 'Bryan' };
  let current = code;
  const join = createJoin({ settings, registry, maker, readCode: () => current, readInterest: () => interest, routeDns: async (h) => (routed.push(h), { ok: dnsOk, said: dnsOk ? '' : 'already exists' }), log: quiet });
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

// The owner's own drive, with a list for emails and an Add only link to it.
const LIST_DOC = `<!doctype html>
<html data-marble-id="h"><head data-marble-id="hd"><title data-marble-id="t">Interest list</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="title">Interest list</h1>
  <ol data-marble-id="emails" data-marble-sortable></ol>
</body></html>
`;

async function ownerDrive(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'join-interest-'));
  await fsp.writeFile(path.join(root, 'Interest list.mrbl'), LIST_DOC);
  const drive = await createDrive(
    loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: 'hunter2' }),
    { log: quiet, agents: false },
  );
  t.after(async () => {
    await drive.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const at = (p) => `http://127.0.0.1:${port}${p}`;
  const signIn = await fetch(at('/gate'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'hunter2' }) });
  const owner = signIn.headers.get('set-cookie').split(';')[0];
  const made = await fetch(at('/drive/shares'), { method: 'POST', headers: { Cookie: owner, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'Interest list', role: 'drop' }) });
  const { link } = await made.json();
  return { link: at(link.href ?? link), file: () => fsp.readFile(path.join(root, 'Interest list.mrbl'), 'utf8') };
}
const leave = (port, email, headers = {}) => ask(port, { method: 'POST', path: '/interest', headers: { origin: 'https://join.marbledrive.app', 'content-type': 'application/json', ...headers }, body: { email } });

test('an email left on the page lands as a row in the owner\'s list, through an Add only link', async (t) => {
  const drive = await ownerDrive(t);
  const r = await rig({ interest: { link: drive.link, list: 'emails' } });
  t.after(r.close);
  const page = (await ask(r.port)).body;
  assert.match(page, /<section id="ask">/);
  assert.match(page, /Bryan will write to you/);

  const sent = await leave(r.port, 'ana@example.org');
  assert.equal(sent.status, 200, sent.body);
  assert.deepEqual(sent.json(), { ok: true });
  const file = await drive.file();
  assert.match(file, /<ol data-marble-id="emails" data-marble-sortable>\s*<li[^>]*data-marble-removable[^>]*><a[^>]*href="mailto:ana@example.org"[^>]*>ana@example.org<\/a> <time[^>]*>\d{4}-\d\d-\d\d<\/time><\/li>/);

  assert.equal((await leave(r.port, 'ANA@example.org')).status, 200, 'the same address again');
  assert.equal(((await drive.file()).match(/mailto:/gi) ?? []).length, 1, 'is filed once');
});

test('the email form asks for an address, and refuses markup, other origins and too many tries', async (t) => {
  const drive = await ownerDrive(t);
  const r = await rig({ interest: { link: drive.link, list: 'emails' } });
  t.after(r.close);
  for (const bad of ['', 'ana', 'ana@example', '<b>x</b>@example.org', 'a"b@example.org', `${'a'.repeat(250)}@example.org`]) {
    const res = await leave(r.port, bad);
    assert.equal(res.status, 400, bad);
    assert.equal(res.json().field, 'email');
  }
  assert.equal((await leave(r.port, 'ana@example.org', { origin: 'https://evil.example' })).status, 403);
  const from = { 'cf-connecting-ip': '203.0.113.9' };
  for (let i = 0; i < 5; i += 1) assert.equal((await leave(r.port, `p${i}@example.org`, from)).status, 200);
  assert.equal((await leave(r.port, 'p9@example.org', from)).status, 429);
  assert.equal(((await drive.file()).match(/mailto:/g) ?? []).length, 5);
});

test('no list set means no email form, and a list the link cannot add to says to try later', async (t) => {
  const none = await rig();
  t.after(none.close);
  assert.match((await ask(none.port)).body, /<section id="ask" hidden>/);
  assert.equal((await leave(none.port, 'ana@example.org')).status, 403);

  const drive = await ownerDrive(t);
  const wrong = await rig({ interest: { link: drive.link, list: 'title' } });
  t.after(wrong.close);
  const res = await leave(wrong.port, 'ana@example.org');
  assert.equal(res.status, 502);
  assert.match(res.json().error, /Try again in a minute/);
  assert.doesNotMatch(await drive.file(), /mailto:/);
});
