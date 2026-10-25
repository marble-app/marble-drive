// test/door-people.test.js
// The owner's side of the PC host's people (worker/src/door/apex.js's admin
// routes, tools/door.mjs): GET /_door/people, removing a drive, revoking an
// account, withdrawing someone from the study, marble-host's events and its
// `removed`, each behind
// DOOR_ADMIN_TOKEN and none of them handing out a secret; then the same from
// the terminal. The door is the real Worker code over a Directory in memory;
// the sign-in providers and the PC host are fakes.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { beforeEach } from 'node:test';

import { main } from '../tools/door.mjs';
import { forgetLeases, route } from '../worker/src/router.js';
import { browser, signInWith } from './fixtures/door-browser.js';
import { doorEnv, fakeProviders } from './fixtures/door-env.js';

beforeEach(() => forgetLeases());

const PC_HOST = 'https://pc-host.marbledrive.app';
const KEY = 'b'.repeat(64);
const VERSION = '2026-10.irb-1';
const FORM = 'The approved consent form, for the test.';
const PC = { NEW_DRIVE_HOME: 'pchost', PC_HOST_URL: PC_HOST, PC_HOST_KEY: KEY, DOOR_SPRITE_URL: '', CONSENT_VERSION: VERSION };

function world(vars = {}) {
  const env = doorEnv({ ...PC, ...vars });
  const google = { sub: '1100000000000001', email: 'ana@example.com', name: 'Ana Lima' };
  const fake = fakeProviders({ google, github: { id: 4242, emails: [{ email: 'bob@example.com', primary: true, verified: true }] } });
  fake.setNonce = (n) => {
    google.nonce = n;
  };
  const upstream = [];
  const fetchImpl = async (input, init = {}) => {
    const href = String(input instanceof Request ? input.url : input);
    if (href.startsWith(`${PC_HOST}/_host/poke`)) return new Response('{}', { status: 202 });
    if (href.startsWith(`${PC_HOST}/`)) {
      upstream.push(href);
      return new Response('from the drive', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return fake.fetchImpl(input, init);
  };
  const call = async (method, p, body, token = env.DOOR_ADMIN_TOKEN) => {
    const res = await route(new Request(`https://marbledrive.app/_door${p}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { fetchImpl });
    const raw = await res.text();
    return { status: res.status, raw, data: JSON.parse(raw) };
  };
  const b = (opts = {}) => browser(env, { fetchImpl, options: { consentForm: FORM }, ...opts });
  return { env, fake, fetchImpl, upstream, call, b };
}

/** Ana, all the way: a study invite, signed in, a yes, her drive on the PC
 *  host made and ready, and marble-host's first reports. */
async function ana(w) {
  const made = await w.call('POST', '/invite', { study: true, note: 'Ana' });
  const code = made.data.link.split('/join/')[1];
  const person = w.b();
  await signInWith(person, 'google', { invite: code, fake: w.fake });
  await person.form('/consent', { version: VERSION, choice: 'given' });
  assert.equal((await person.form('/name', { name: 'ana' })).headers.get('location'), '/making/ana');
  assert.equal((await w.call('POST', '/drives/ana/step', { state: 'ready', home: 'pchost' })).status, 200);
  await w.call('POST', '/events', { drive: 'ana', kind: 'agent-connected', detail: { provider: 'claude' } });
  await w.call('POST', '/events', { drive: 'ana', kind: 'first-document' });
  forgetLeases();
  const sid = person.jar('marbledrive.app').get('__Host-md_session');
  return { person, code, sid };
}

// ------------------------------------------------------------ the routes

test('each new admin route wants the admin token, and the person’s own routes are not behind /_door at all', async () => {
  const w = world();
  for (const [method, p, body] of [
    ['GET', '/people'],
    ['POST', '/drives/ana/remove', { confirm: 'ana' }],
    ['POST', `/accounts/${'a'.repeat(16)}/revoke`],
    ['POST', `/accounts/${'a'.repeat(16)}/withdraw`],
    ['POST', '/events', { drive: 'ana', kind: 'drive-updated' }],
  ]) {
    assert.equal((await w.call(method, p, body, null)).status, 401, `${p} with no token`);
    assert.equal((await w.call(method, p, body, 'not-the-token')).status, 401, `${p} with a wrong one`);
  }
  for (const [p, body] of [['/consent', { account: 'a'.repeat(16), version: VERSION, choice: 'given' }], ['/study/leave', {}], ['/study/delete', {}], ['/drives/ana/delete', { confirm: 'ana' }]]) {
    const r = await w.call('POST', p, body);
    assert.equal(r.status, 404, `${p} is the account page’s, not the owner’s`);
    assert.equal(r.data.why, 'no such route');
  }
  assert.equal((await w.call('GET', `/accounts/${'a'.repeat(16)}/revoke`)).status, 404, 'revoke is a POST');
  assert.equal((await w.call('GET', `/accounts/${'a'.repeat(16)}/withdraw`)).status, 404, 'withdraw is a POST');
  assert.equal((await w.call('POST', '/people')).status, 404, 'people is a GET');
});

test('GET /_door/people: her row from invite to first document, and nothing secret in it', async () => {
  const w = world();
  const { code, sid } = await ana(w);
  const dee = (await w.call('POST', '/invite', { study: true, note: 'Dee' })).data;
  const r = await w.call('GET', '/people');
  assert.equal(r.status, 200);
  assert.equal(r.data.people.length, 2);
  const [a, d] = r.data.people;
  assert.deepEqual(Object.keys(a), ['account', 'drive', 'invite', 'study', 'timeline']);
  assert.deepEqual(Object.keys(a.account), ['id', 'name', 'email', 'created', 'seen']);
  assert.equal(a.account.name, 'Ana Lima');
  assert.deepEqual(Object.keys(a.drive), ['name', 'state', 'home', 'created']);
  assert.deepEqual(a.drive, { name: 'ana', state: 'ready', home: 'pchost', created: a.drive.created });
  assert.deepEqual(Object.keys(a.invite), ['id', 'note', 'made', 'expires', 'used', 'study']);
  assert.equal(a.invite.study, true);
  assert.deepEqual(Object.keys(a.study), ['cohort', 'consent', 'withdrawn', 'deleteAsked']);
  assert.equal(a.study.cohort, 'study');
  assert.deepEqual(Object.keys(a.study.consent), ['version', 'at', 'choice']);
  assert.deepEqual(Object.keys(a.timeline), ['invited', 'signedIn', 'consented', 'named', 'ready', 'agentConnected', 'firstDocument', 'updated']);
  for (const step of ['invited', 'signedIn', 'consented', 'named', 'ready', 'agentConnected', 'firstDocument']) assert.match(a.timeline[step], /^\d{4}-\d{2}-\d{2}T/, step);
  assert.equal(a.timeline.updated, null);
  assert.equal(d.account, null, 'an invite nobody has opened');
  assert.equal(d.invite.note, 'Dee');

  const hash = [...w.env.storage.map.keys()].find((k) => k.startsWith('session:')).slice('session:'.length);
  for (const secret of [code, dee.link.split('/join/')[1], sid, hash, '1100000000000001', w.env.DOOR_ADMIN_TOKEN, w.env.DOOR_SIGNING_KEY, KEY]) assert.ok(!r.raw.includes(secret), secret.slice(0, 12));
  for (const key of w.env.storage.map.keys()) if (key.startsWith('invite:')) assert.ok(!r.raw.includes(key.slice('invite:'.length)), 'an invite hash');
});

test('POST /_door/drives/<name>/remove: her name typed; then the edge says removed, she is signed out, and marble-host’s removed keeps the record', async () => {
  const w = world();
  const { person } = await ana(w);
  assert.equal((await person.go('/account')).status, 200);
  assert.equal((await w.call('POST', '/drives/nobody/remove', { confirm: 'nobody' })).status, 404);
  const bad = await w.call('POST', '/drives/ana/remove', { confirm: 'an' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.why, /confirm is its name/);
  assert.equal((await w.call('POST', '/drives/ana/remove', {})).status, 400);

  const r = await w.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  assert.equal(r.status, 200);
  assert.equal(r.data.drive.state, 'removing');
  assert.equal(r.data.sessions, 1);
  assert.ok(!r.raw.includes(person.jar('marbledrive.app').get('__Host-md_session') ?? 'no session left'), 'no session id in the answer');
  assert.equal((await person.go('/account')).headers.get('location'), '/', 'her sign-in has ended');
  forgetLeases();
  const edge = await w.b().go('https://ana.marbledrive.app/');
  assert.equal(edge.status, 410);
  assert.match(await edge.text(), /This drive has been removed/);
  assert.equal(w.upstream.length, 0);

  const done = await w.call('POST', '/drives/ana/step', { state: 'removed', home: 'pchost' });
  assert.equal(done.status, 200);
  assert.equal((await w.call('GET', '/drives')).data.drives.find((d) => d.name === 'ana').state, 'removed');
  const row = (await w.call('GET', '/people')).data.people.find((p) => p.drive?.name === 'ana');
  assert.equal(row.drive.state, 'removed', 'still a row, as removed');
  const kinds = (await w.call('GET', '/log')).data.lines.map((l) => l.kind);
  for (const k of ['drive-remove-asked', 'sessions-revoked', 'drive-removed']) assert.ok(kinds.includes(k), k);
});

test('POST /_door/accounts/<id>/revoke: every session of the account ends; an unknown one is said so', async () => {
  const w = world();
  const { person } = await ana(w);
  const other = w.b({ ip: '203.0.113.9' });
  await signInWith(other, 'google', { fake: w.fake });
  const id = (await w.call('GET', '/people')).data.people[0].account.id;
  const unknown = await w.call('POST', `/accounts/${'f'.repeat(16)}/revoke`);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.data.why, 'No such account.');
  const r = await w.call('POST', `/accounts/${id}/revoke`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, count: 2 });
  for (const b of [person, other]) assert.equal((await b.go('/account')).headers.get('location'), '/', 'signed out in both browsers');
  assert.equal((await w.call('GET', '/drives')).data.drives[0].state, 'ready', 'her drive is left as it is');
});

test('POST /_door/accounts/<id>/withdraw: the Console’s Withdraw takes her out of the study as her own Leave would, logged as the owner’s', async () => {
  const w = world();
  const { person } = await ana(w);
  const id = (await w.call('GET', '/people')).data.people[0].account.id;
  assert.equal((await w.call('POST', `/accounts/${'f'.repeat(16)}/withdraw`)).status, 404);
  const r = await w.call('POST', `/accounts/${id}/withdraw`);
  assert.equal(r.status, 200, r.raw);
  assert.match(r.data.study.withdrawn, /^\d{4}-\d{2}-\d{2}T/);
  const row = (await w.call('GET', '/people')).data.people[0];
  assert.equal(row.study.withdrawn, r.data.study.withdrawn, 'out of the study for marble-host’s next look');
  assert.equal(row.study.consent.choice, 'given');
  const line = (await w.call('GET', '/log')).data.lines.find((l) => l.kind === 'consent-withdrawn');
  assert.equal(line.detail.by, 'owner');
  assert.equal((await w.call('POST', `/accounts/${id}/withdraw`)).data.already, true);
  assert.equal((await person.go('/account')).status, 200, 'she is still signed in, and her drive is hers');
  assert.equal((await w.call('GET', '/drives')).data.drives[0].state, 'ready');
});

test('POST /_door/events: marble-host’s reports land in the log under the drive’s owner and in her timeline; anything else is refused in words', async () => {
  const w = world();
  await ana(w);
  const refused = await w.call('POST', '/events', { drive: 'ana', kind: 'prompt-sent', detail: { text: 'hello' } });
  assert.equal(refused.status, 400);
  assert.match(refused.data.why, /kind is one of/);
  const prose = await w.call('POST', '/events', { drive: 'ana', kind: 'drive-updated', detail: { title: 'My grocery list' } });
  assert.equal(prose.status, 400);
  assert.match(prose.data.why, /one word with no spaces/);
  assert.equal((await w.call('POST', '/events', { drive: 'nobody', kind: 'drive-updated' })).status, 404);
  const again = await w.call('POST', '/events', { drive: 'ana', kind: 'first-document' });
  assert.deepEqual(again.data, { ok: true, already: true });
  assert.deepEqual((await w.call('POST', '/events', { drive: 'ana', kind: 'drive-updated', detail: { release: '20261025T161133Z-4b2103a', from: '20261024T120000Z-1a2b3c4' } })).data, { ok: true });
  assert.deepEqual((await w.call('POST', '/events', { drive: 'ana', kind: 'drive-restarted' })).data, { ok: true });
  const owner = (await w.call('GET', '/people')).data.people[0];
  const lines = (await w.call('GET', `/log?account=${owner.account.id}`)).data.lines;
  assert.deepEqual(lines.filter((l) => ['agent-connected', 'first-document', 'drive-updated', 'drive-restarted'].includes(l.kind)).map((l) => l.kind).sort(), ['agent-connected', 'drive-restarted', 'drive-updated', 'first-document']);
  assert.deepEqual(lines.find((l) => l.kind === 'drive-updated').detail, { release: '20261025T161133Z-4b2103a', from: '20261024T120000Z-1a2b3c4', drive: 'ana' });
  assert.match(owner.timeline.updated, /^\d{4}-/);
});

test('step: marble-host’s removed is refused for a drive nobody asked to remove, or one not on the PC host', async () => {
  const w = world();
  await ana(w);
  const r = await w.call('POST', '/drives/ana/step', { state: 'removed' });
  assert.equal(r.status, 409);
  assert.match(r.data.why, /isn’t being removed or deleted/);
  assert.equal((await w.call('GET', '/drives')).data.drives[0].state, 'ready');
});

// ------------------------------------------------------------ tools/door.mjs

async function rig() {
  const w = world();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'door-people-'));
  const settingsPath = path.join(dir, 'door.env');
  await fsp.writeFile(settingsPath, `DOOR_URL=https://marbledrive.app\nDOOR_ADMIN_TOKEN=${w.env.DOOR_ADMIN_TOKEN}\n`, { mode: 0o600 });
  await fsp.chmod(settingsPath, 0o600);
  const fetchImpl = (input, init) => route(new Request(input, init), w.env, { fetchImpl: w.fetchImpl });
  const run = async (...argv) => {
    const out = [];
    const err = [];
    const code = await main(argv, { settingsPath, fetchImpl, out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  return { ...w, run };
}

test('door.mjs invite --study: its link once, said to be in the study, and --study takes no value', async () => {
  const r = await rig();
  const made = await r.run('invite', '--study', '--note', 'Ana');
  assert.equal(made.code, 0, made.err);
  assert.match(made.out, /^1 use, in the study, for Ana, until \d{4}-\d{2}-\d{2}\. Send this link; it is not shown again:$/m);
  const link = /https:\/\/marbledrive\.app\/join\/([0-9a-f]{32})/.exec(made.out);
  assert.ok(link, made.out);
  const last = await r.run('invite', '--note', 'Bo', '--study');
  assert.equal(last.code, 0, last.err);
  assert.match(last.out, /in the study, for Bo/);
  const plain = await r.run('invite', '--note', 'Cy');
  assert.doesNotMatch(plain.out, /in the study/);
  const listed = await r.run('invites');
  assert.match(listed.out, /Ana\s+1\s+\d{4}-\d{2}-\d{2}\s+a new drive, in the study/);
  assert.match(listed.out, /Cy\s+1\s+\d{4}-\d{2}-\d{2}\s+a new drive$/m);
  assert.ok(!listed.out.includes(link[1]), 'never the code');
  const owner = await r.run('invite', '--study', '--owner');
  assert.equal(owner.code, 1);
  assert.match(owner.err, /study invite makes a new drive/);
});

test('door.mjs people: a row each, in words, and no secrets', async () => {
  const r = await rig();
  const { code, sid } = await ana(r);
  await r.run('invite', '--study', '--note', 'Dee');
  // Bob signs in with a study invite and says no.
  const bobInvite = (await r.call('POST', '/invite', { study: true, note: 'Bob' })).data.link.split('/join/')[1];
  const bob = r.b({ ip: '203.0.113.5' });
  await signInWith(bob, 'github', { invite: bobInvite });
  await bob.form('/consent', { version: VERSION, choice: 'declined' });

  const res = await r.run('people');
  assert.equal(res.code, 0, res.err);
  const lines = res.out.split('\n');
  assert.match(lines[0], /^who\s+account\s+drive\s+state\s+study\s+invited\s+signed in\s+ready\s+agent\s+first doc$/);
  assert.match(res.out, /Ana Lima\s+[0-9a-f]{16}\s+ana\s+ready\s+in, form 2026-10\.irb-1\s+(\d{4}-\d{2}-\d{2}\s+){4}\d{4}-\d{2}-\d{2}$/m);
  assert.match(res.out, /Dee\s+-\s+-\s+link not opened\s+invited\s+\d{4}-\d{2}-\d{2}\s+-\s+-\s+-\s+-$/m);
  assert.match(res.out, /Ana\s+[0-9a-f]{16}\s+-\s+no drive yet\s+said no\s+/m, 'GitHub calls Bob “Ana” in the fake');
  for (const secret of [code, bobInvite, sid, r.env.DOOR_ADMIN_TOKEN]) assert.ok(!res.out.includes(secret));

  const id = /Ana Lima\s+([0-9a-f]{16})/.exec(res.out)[1];
  await r.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  await r.call('POST', '/drives/ana/step', { state: 'removed' });
  assert.match((await r.run('people')).out, new RegExp(`Ana Lima\\s+${id}\\s+ana\\s+removed\\s+`));
});

test('door.mjs remove: nothing happens without --confirm and its name; then it says what happened, once', async () => {
  const r = await rig();
  await ana(r);
  const asked = await r.run('remove', 'ana');
  assert.equal(asked.code, 1);
  assert.match(asked.err, /signs its owner out everywhere/);
  assert.match(asked.err, /To go ahead: node tools\/door\.mjs remove ana --confirm ana/);
  assert.equal((await r.run('remove', 'ana', '--confirm', 'anna')).code, 1);
  assert.equal((await r.call('GET', '/drives')).data.drives[0].state, 'ready', 'nothing yet');
  assert.match((await r.run('remove')).err, /remove which drive/);

  const done = await r.run('remove', 'ana', '--confirm', 'ana');
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /^ana is removed at the edge, and 1 session of its owner ended\.$/m);
  assert.match(done.out, /marble-host deletes it from the PC and marks it removed\./);
  assert.equal((await r.run('remove', 'ana', '--confirm', 'ana')).out, 'ana is already removing.');
  assert.match((await r.run('remove', 'nobody', '--confirm', 'nobody')).err, /No such drive/);
});

test('door.mjs remove on a drive on Fly says its sprite is still there', async () => {
  const r = await rig();
  const dir = (p, b) => r.env.DIRECTORY.get('directory').fetch(new Request(`https://directory${p}`, { method: 'POST', body: JSON.stringify(b) }));
  const code = (await (await dir('/invite', { uses: 1 })).json()).code;
  const flo = await (await dir('/identity', { provider: 'google', subject: '77', email: 'flo@example.com', name: 'Flo', invite: code })).json();
  await dir('/drive', { account: flo.account.id, name: 'flo' });
  const done = await r.run('remove', 'flo', '--confirm', 'flo');
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /0 sessions of its owner ended/);
  assert.match(done.out, /Its sprite is still there: remove it with tools\/sprite-provision\.sh --remove flo --door flo/);
});

test('door.mjs revoke: an account’s sessions, by its id', async () => {
  const r = await rig();
  const { person } = await ana(r);
  const id = (await r.call('GET', '/people')).data.people[0].account.id;
  assert.match((await r.run('revoke')).err, /revoke which account/);
  assert.match((await r.run('revoke', 'ana')).err, /16 hex digits/);
  assert.match((await r.run('revoke', 'f'.repeat(16))).err, /No such account/);
  const done = await r.run('revoke', id);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, new RegExp(`^Signed ${id} out everywhere: 1 session ended\\.$`, 'm'));
  assert.match(done.out, /hold or remove the drive to stop it now/);
  assert.equal((await person.go('/account')).headers.get('location'), '/');
});

test('door.mjs people with nobody yet says how to start', async () => {
  const r = await rig();
  assert.equal((await r.run('people')).out, 'Nobody yet. node tools/door.mjs invite makes a link.');
});
