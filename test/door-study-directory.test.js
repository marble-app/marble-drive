// test/door-study-directory.test.js
// The Directory's side of the probe study and of drives that end
// (worker/src/door/directory.js): study invites, the consent answer and what
// it makes, leaving and asking for deletion, Bryan removing a drive and its
// owner deleting one, marble-host's `removed` and its events, revoking an
// account, and the people list built from all of it.
import assert from 'node:assert/strict';
import test from 'node:test';

import { Directory } from '../worker/src/door/directory.js';
import { memoryStorage } from './fixtures/door-env.js';

function dir() {
  const storage = memoryStorage();
  const object = new Directory({ storage }, { MAX_DRIVES: '10' });
  let t = Date.parse('2026-10-25T12:00:00Z');
  object.core.now = () => t;
  const call = async (method, path, body) => {
    const res = await object.fetch(new Request(`https://directory${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }));
    return { status: res.status, data: await res.json() };
  };
  return {
    storage,
    call,
    /** Move the clock on, so each step has its own time in the log. */
    tick: (minutes = 1) => {
      t += minutes * 60_000;
    },
    at: () => new Date(t).toISOString(),
  };
}

/** Someone signed in with an invite of their own, made with `opts`. */
async function invited(d, who, opts = {}) {
  const made = await d.call('POST', '/invite', { uses: 1, note: who, ...opts });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  d.tick();
  const r = await d.call('POST', '/identity', { provider: 'google', subject: `sub-${who}`, email: `${who}@example.com`, name: who, invite: made.data.code });
  d.tick();
  return { code: made.data.code, invite: made.data.invite, account: r.data.account };
}

const kinds = async (d) => (await d.call('GET', '/log')).data.lines.map((l) => l.kind);

// ------------------------------------------------------------ study invites

test('a study invite carries the cohort; others carry none; it can’t hand a drive over or make the owner', async () => {
  const d = dir();
  const study = await d.call('POST', '/invite', { study: true, note: 'Ana' });
  assert.equal(study.data.invite.cohort, 'study');
  assert.equal((await d.call('POST', '/invite/peek', { code: study.data.code })).data.study, true);
  const plain = await d.call('POST', '/invite', { note: 'Bo' });
  assert.equal(plain.data.invite.cohort, null);
  assert.equal((await d.call('POST', '/invite/peek', { code: plain.data.code })).data.study, false);
  assert.equal((await d.call('POST', '/invite', { study: 'yes' })).data.invite.cohort, null, 'only study: true');
  for (const extra of [{ owner: true }, { drive: 'irene', sprite: 't-irene' }]) {
    const r = await d.call('POST', '/invite', { study: true, ...extra });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.match(r.data.why, /study invite makes a new drive/);
  }
  const line = (await d.call('GET', '/log')).data.lines.find((l) => l.kind === 'invite-made' && l.detail.cohort === 'study');
  assert.ok(line, 'the log says which invite was for the study');
});

test('a study invite asks for consent before any drive: the Directory refuses one, and spends nothing', async () => {
  const d = dir();
  const { code, account } = await invited(d, 'ana', { study: true });
  assert.equal(account.studyInvite, true);
  assert.equal(account.askConsent, true);
  assert.deepEqual(account.study, { consent: null, withdrawn: null, deleteAsked: null });
  for (const home of ['pchost', 'fly']) {
    const r = await d.call('POST', '/drive', { account: account.id, name: 'ana', home });
    assert.equal(r.status, 409, home);
    assert.match(r.data.why, /take part in the study first/);
    assert.equal(r.data.consent, 'ask');
  }
  assert.equal((await d.call('POST', '/invite/peek', { code })).data.ok, true, 'the invite is still unspent');
  assert.equal((await d.call('GET', '/drives')).data.drives.length, 0);

  const plain = (await invited(d, 'bob')).account;
  assert.equal(plain.studyInvite, false);
  assert.equal(plain.askConsent, false);
  assert.equal((await d.call('POST', '/drive', { account: plain.id, name: 'bob', home: 'pchost' })).status, 200, 'any other invite makes its drive as before');
});

test('consent: the answer is kept as { version, at, choice } and logged; a bad one is refused in words', async () => {
  const d = dir();
  const { account } = await invited(d, 'ana', { study: true });
  const refusals = [
    [{ account: account.id, version: '', choice: 'given' }, 400, /version/],
    [{ account: account.id, version: 'v 1', choice: 'given' }, 400, /version/],
    [{ account: account.id, version: 'v1@x', choice: 'given' }, 400, /version/],
    [{ account: account.id, version: 'v1', choice: 'maybe' }, 400, /given or declined/],
    [{ account: 'f'.repeat(16), version: 'v1', choice: 'given' }, 404, /No such account/],
  ];
  for (const [b, status, why] of refusals) {
    const r = await d.call('POST', '/consent', b);
    assert.equal(r.status, status, JSON.stringify(b));
    assert.match(r.data.why, why);
  }
  const plain = (await invited(d, 'bob')).account;
  const notStudy = await d.call('POST', '/consent', { account: plain.id, version: 'v1', choice: 'given' });
  assert.equal(notStudy.status, 409);
  assert.match(notStudy.data.why, /nothing to answer/);

  const at = d.at();
  const given = await d.call('POST', '/consent', { account: account.id, version: '2026-10-irb.v1', choice: 'given' });
  assert.equal(given.status, 200, JSON.stringify(given.data));
  assert.deepEqual(given.data.study.consent, { version: '2026-10-irb.v1', at, choice: 'given' });
  const after = (await d.call('GET', `/accounts/${account.id}`)).data;
  assert.equal(after.askConsent, false);
  assert.equal(after.studyInvite, true, 'still a drive to make');
  assert.deepEqual(after.study.consent, { version: '2026-10-irb.v1', at, choice: 'given' });
  // Two tabs: the later answer is the one kept, and both are in the log.
  d.tick();
  await d.call('POST', '/consent', { account: account.id, version: '2026-10-irb.v1', choice: 'declined' });
  assert.equal((await d.call('GET', `/accounts/${account.id}`)).data.study.consent.choice, 'declined');
  const log = (await d.call('GET', '/log')).data.lines;
  assert.ok(log.some((l) => l.kind === 'consent-given' && l.account === account.id && l.detail.version === '2026-10-irb.v1'));
  assert.ok(log.some((l) => l.kind === 'consent-declined' && l.account === account.id));
});

test('a yes makes a drive on the PC host in the study; a no makes one outside it; Fly drives carry no cohort', async () => {
  const d = dir();
  const yes = (await invited(d, 'ana', { study: true })).account;
  await d.call('POST', '/consent', { account: yes.id, version: 'v1', choice: 'given' });
  const made = await d.call('POST', '/drive', { account: yes.id, name: 'ana', home: 'pchost' });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.equal(made.data.drive.cohort, 'study');
  assert.equal(d.storage.map.get('drive:ana').cohort, 'study');
  assert.equal((await d.call('GET', '/drives/ana')).data.cohort, 'study');
  assert.equal((await d.call('GET', '/queue?home=pchost')).data.drives[0].cohort, 'study', 'marble-host reads it off the queue');
  assert.equal((await d.call('POST', '/consent', { account: yes.id, version: 'v1', choice: 'declined' })).status, 409, 'once the drive is made the answer stands');

  const no = (await invited(d, 'bob', { study: true })).account;
  await d.call('POST', '/consent', { account: no.id, version: 'v1', choice: 'declined' });
  assert.equal((await d.call('POST', '/drive', { account: no.id, name: 'bob', home: 'pchost' })).status, 200, 'declining still makes a drive');
  assert.equal(d.storage.map.get('drive:bob').cohort, null);

  const fly = (await invited(d, 'flo', { study: true })).account;
  await d.call('POST', '/consent', { account: fly.id, version: 'v1', choice: 'given' });
  assert.equal((await d.call('POST', '/drive', { account: fly.id, name: 'flo' })).status, 200);
  assert.equal(Object.hasOwn(d.storage.map.get('drive:flo'), 'cohort'), false, 'the Fly record is the one it always was');
  assert.equal((await d.call('GET', '/drives/flo')).data.cohort, null);
  const asked = (await d.call('GET', '/log')).data.lines.find((l) => l.kind === 'drive-asked' && l.detail.drive === 'ana');
  assert.equal(asked.detail.cohort, 'study');
});

test('leaving the study: only while in it, once, and deleting what was collected is a second choice after it', async () => {
  const d = dir();
  const ana = (await invited(d, 'ana', { study: true })).account;
  assert.equal((await d.call('POST', '/study/leave', { account: ana.id })).status, 409, 'no drive yet');
  await d.call('POST', '/consent', { account: ana.id, version: 'v1', choice: 'given' });
  assert.equal((await d.call('POST', '/study/leave', { account: ana.id })).status, 409, 'consent alone is not a drive in the study');
  await d.call('POST', '/drive', { account: ana.id, name: 'ana', home: 'pchost' });

  const early = await d.call('POST', '/study/delete', { account: ana.id });
  assert.equal(early.status, 409);
  assert.match(early.data.why, /Leave the study first/);

  d.tick();
  const leftAt = d.at();
  const left = await d.call('POST', '/study/leave', { account: ana.id });
  assert.equal(left.status, 200, JSON.stringify(left.data));
  assert.equal(left.data.study.withdrawn, leftAt);
  assert.equal(left.data.study.deleteAsked, null, 'leaving deletes nothing by itself');
  assert.equal(left.data.study.consent.choice, 'given', 'the answer given stays on record');
  assert.equal((await d.call('GET', '/drives/ana')).data.cohort, 'study', 'the drive is still the study’s; withdrawn says it left');
  d.tick();
  assert.equal((await d.call('POST', '/study/leave', { account: ana.id })).data.already, true);

  const askedAt = d.at();
  const asked = await d.call('POST', '/study/delete', { account: ana.id });
  assert.equal(asked.status, 200);
  assert.equal(asked.data.study.deleteAsked, askedAt);
  assert.equal(asked.data.study.withdrawn, leftAt);
  d.tick();
  assert.equal((await d.call('POST', '/study/delete', { account: ana.id })).data.already, true);
  const log = (await d.call('GET', '/log')).data.lines;
  assert.equal(log.filter((l) => l.kind === 'consent-withdrawn').length, 1);
  assert.equal(log.filter((l) => l.kind === 'study-delete-asked').length, 1);
  assert.equal(log.find((l) => l.kind === 'consent-withdrawn').detail.drive, 'ana');

  const no = (await invited(d, 'bob', { study: true })).account;
  await d.call('POST', '/consent', { account: no.id, version: 'v1', choice: 'declined' });
  await d.call('POST', '/drive', { account: no.id, name: 'bob', home: 'pchost' });
  assert.equal((await d.call('POST', '/study/leave', { account: no.id })).status, 409, 'someone who said no was never in it');
  assert.equal((await d.call('POST', '/study/leave', { account: 'f'.repeat(16) })).status, 404);
  assert.equal((await d.call('POST', '/study/delete', { account: 'f'.repeat(16) })).status, 404);
});

test('withdraw: Bryan takes someone out of the study as their own Leave does, logged as his; only someone in it, once', async () => {
  const d = dir();
  const ana = (await invited(d, 'ana', { study: true })).account;
  await d.call('POST', '/consent', { account: ana.id, version: 'v1', choice: 'given' });
  assert.equal((await d.call('POST', `/accounts/${ana.id}/withdraw`)).status, 409, 'consent alone is not a drive in the study');
  await d.call('POST', '/drive', { account: ana.id, name: 'ana', home: 'pchost' });
  d.tick();
  const at = d.at();
  const out = await d.call('POST', `/accounts/${ana.id}/withdraw`);
  assert.equal(out.status, 200, JSON.stringify(out.data));
  assert.equal(out.data.study.withdrawn, at);
  assert.equal(out.data.study.consent.choice, 'given', 'the answer given stays on record');
  assert.equal(out.data.study.deleteAsked, null, 'withdrawing deletes nothing by itself');
  const line = (await d.call('GET', '/log')).data.lines.find((l) => l.kind === 'consent-withdrawn');
  assert.deepEqual(line.detail, { drive: 'ana', version: 'v1', by: 'owner' });
  assert.equal(line.account, ana.id);
  const people = (await d.call('GET', '/people')).data.people;
  assert.equal(people.find((p) => p.account?.id === ana.id).study.withdrawn, at, 'marble-host sees her out of the study at its next look');
  d.tick();
  assert.equal((await d.call('POST', `/accounts/${ana.id}/withdraw`)).data.already, true);
  assert.equal((await d.call('POST', '/study/leave', { account: ana.id })).data.already, true, 'one leaving, whoever did it');
  assert.equal((await d.call('GET', '/log')).data.lines.filter((l) => l.kind === 'consent-withdrawn').length, 1);
  // Asking for what was collected to be deleted is still hers to do.
  assert.equal((await d.call('POST', '/study/delete', { account: ana.id })).status, 200);

  const no = (await invited(d, 'bob', { study: true })).account;
  await d.call('POST', '/consent', { account: no.id, version: 'v1', choice: 'declined' });
  await d.call('POST', '/drive', { account: no.id, name: 'bob', home: 'pchost' });
  const never = await d.call('POST', `/accounts/${no.id}/withdraw`);
  assert.equal(never.status, 409);
  assert.match(never.data.why, /They aren’t taking part in the study/);
  assert.equal((await d.call('POST', `/accounts/${'f'.repeat(16)}/withdraw`)).status, 404);
  assert.equal((await d.call('GET', `/accounts/${ana.id}/withdraw`)).status, 404, 'a POST');
});

// ------------------------------------------------------------ ending a drive

/** Ana's drive on the PC host, ready, and a session of hers. */
async function readyOnPc(d, who = 'ana', opts = {}) {
  const { account } = await invited(d, who, opts);
  if (opts.study) await d.call('POST', '/consent', { account: account.id, version: 'v1', choice: 'given' });
  assert.equal((await d.call('POST', '/drive', { account: account.id, name: who, home: 'pchost' })).status, 200);
  d.tick();
  assert.equal((await d.call('POST', `/drives/${who}/step`, { state: 'ready', home: 'pchost' })).status, 200);
  d.tick();
  const session = (await d.call('POST', '/session', { account: account.id, method: 'google' })).data;
  return { account, session };
}

test('remove: the name typed, then removing, every session of its owner ended, and said once', async () => {
  const d = dir();
  const { account, session } = await readyOnPc(d);
  assert.equal((await d.call('POST', '/drives/nobody/remove', { confirm: 'nobody' })).status, 404);
  for (const confirm of [undefined, '', 'an', 'ANA']) {
    const r = await d.call('POST', '/drives/ana/remove', confirm === undefined ? {} : { confirm });
    assert.equal(r.status, 400, String(confirm));
    assert.match(r.data.why, /confirm is its name/);
  }
  assert.equal((await d.call('GET', '/drives/ana')).data.state, 'ready', 'nothing happened');

  const r = await d.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.drive.state, 'removing');
  assert.equal(r.data.sessions, 1);
  assert.equal((await d.call('GET', `/session/${session.hash}`)).data.live, false, 'her session ended');
  assert.equal((await d.call('GET', '/drives/ana')).data.owner, account.id, 'the record keeps its owner');
  const again = await d.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  assert.equal(again.data.already, true);
  assert.equal((await kinds(d)).filter((k) => k === 'drive-remove-asked').length, 1);
});

test('delete: only its owner, the name typed, a drive on the PC host; then deleting, logged once', async () => {
  const d = dir();
  const { account } = await readyOnPc(d);
  const bob = (await invited(d, 'bob')).account;
  await d.call('POST', '/drive', { account: bob.id, name: 'bob' });
  const someoneElse = await d.call('POST', '/drives/ana/delete', { account: bob.id, confirm: 'ana' });
  assert.equal(someoneElse.status, 404, 'someone else’s drive reads as no drive');
  assert.equal((await d.call('POST', '/drives/ana/delete', { confirm: 'ana' })).status, 404, 'nobody’s');
  const typo = await d.call('POST', '/drives/ana/delete', { account: account.id, confirm: 'anna' });
  assert.equal(typo.status, 400);
  assert.match(typo.data.why, /Type ana to delete it/);
  const fly = await d.call('POST', '/drives/bob/delete', { account: bob.id, confirm: 'bob' });
  assert.equal(fly.status, 409, 'nothing would carry it out on Fly');
  assert.match(fly.data.why, /Ask him/);
  assert.equal((await d.call('GET', '/drives/bob')).data.state, 'queued');

  const r = await d.call('POST', '/drives/ana/delete', { account: account.id, confirm: 'ana' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.drive.state, 'deleting');
  assert.equal((await d.call('POST', '/drives/ana/delete', { account: account.id, confirm: 'ana' })).data.already, true);
  assert.equal((await d.call('POST', '/drives/ana/remove', { confirm: 'ana' })).data.drive.state, 'deleting', 'Bryan removing it too changes nothing');
  const lines = (await d.call('GET', '/log')).data.lines.filter((l) => l.kind === 'drive-delete-asked');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].account, account.id);
});

test('step removed: marble-host’s last word, for a removing or deleting drive on the PC host; the name stays taken', async () => {
  const d = dir();
  await readyOnPc(d);
  const deleter = await readyOnPc(d, 'cyd');
  const bob = (await invited(d, 'bob')).account;
  await d.call('POST', '/drive', { account: bob.id, name: 'bob' });
  await d.call('POST', '/drives/bob/remove', { confirm: 'bob' });

  const early = await d.call('POST', '/drives/ana/step', { state: 'removed' });
  assert.equal(early.status, 409, 'a ready drive is not removed by a report');
  assert.match(early.data.why, /isn’t being removed or deleted/);
  const onFly = await d.call('POST', '/drives/bob/step', { state: 'removed' });
  assert.equal(onFly.status, 409);
  assert.match(onFly.data.why, /not on the PC host/);

  await d.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  await d.call('POST', '/drives/cyd/delete', { account: deleter.account.id, confirm: 'cyd' });
  for (const name of ['ana', 'cyd']) {
    const r = await d.call('POST', `/drives/${name}/step`, { state: 'removed', home: 'pchost' });
    assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.data)}`);
    assert.equal((await d.call('GET', `/drives/${name}`)).data.state, 'removed');
    assert.equal((await d.call('POST', `/drives/${name}/step`, { state: 'removed' })).data.already, true, 'said twice, a no-op');
  }
  const removed = (await d.call('GET', '/log')).data.lines.filter((l) => l.kind === 'drive-removed');
  assert.deepEqual(removed.map((l) => [l.detail.drive, l.detail.was]).sort(), [['ana', 'removing'], ['cyd', 'deleting']]);

  // The record stays: nobody can take the name, and nothing brings it back.
  const dee = (await invited(d, 'dee')).account;
  const taken = await d.call('POST', '/drive', { account: dee.id, name: 'ana', home: 'pchost' });
  assert.equal(taken.status, 409);
  assert.match(taken.data.why, /ana is taken/);
  for (const [path, b] of [
    ['/drives/ana/step', { step: 'install', state: 'now' }],
    ['/drives/ana/step', { state: 'ready', home: 'pchost' }],
    ['/drives/bob/step', { step: 'machine', state: 'done' }],
    ['/drives/ana/hold', { on: true }],
    ['/drives/bob/unspare', {}],
  ]) {
    const r = await d.call('POST', path, b);
    assert.equal(r.status, 409, `${path} ${JSON.stringify(b)}`);
    assert.match(r.data.why, /has been removed|being removed/);
  }
});

test('removing and deleting drives still count against MAX_DRIVES until they are removed', async () => {
  const d = dir();
  await readyOnPc(d);
  const count = () => d.call('GET', '/spares').then((r) => r.data.room);
  assert.equal(await count(), 9);
  await d.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  assert.equal(await count(), 9);
  await d.call('POST', '/drives/ana/step', { state: 'removed' });
  assert.equal(await count(), 10);
});

test('revoke: every session of an account ends; an unknown account is said so', async () => {
  const d = dir();
  const { account, session } = await readyOnPc(d);
  const second = (await d.call('POST', '/session', { account: account.id, method: 'google' })).data;
  assert.equal((await d.call('POST', `/accounts/${'f'.repeat(16)}/revoke`)).status, 404);
  const r = await d.call('POST', `/accounts/${account.id}/revoke`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, count: 2 });
  for (const s of [session, second]) assert.equal((await d.call('GET', `/session/${s.hash}`)).data.live, false);
  assert.equal((await d.call('GET', '/drives/ana')).data.state, 'ready', 'the drive itself is left as it is');
});

// ------------------------------------------------------------ events

test('events: four kinds, under the drive’s owner; the two firsts are logged once; detail is states and counts', async () => {
  const d = dir();
  const { account } = await readyOnPc(d);
  const bad = [
    [{ drive: 'ana', kind: 'agent-disconnected' }, 400, /kind is one of agent-connected, first-document, drive-updated, drive-restarted/],
    [{ drive: 'Ana!', kind: 'drive-updated' }, 400, /drive is a drive’s name/],
    [{ kind: 'drive-updated' }, 400, /drive is a drive’s name/],
    [{ drive: 'nobody', kind: 'drive-updated' }, 404, /No such drive/],
    [{ drive: 'ana', kind: 'first-document', detail: 'My grocery list' }, 400, /detail is an object/],
    [{ drive: 'ana', kind: 'first-document', detail: ['x'] }, 400, /detail is an object/],
    [{ drive: 'ana', kind: 'first-document', detail: { title: 'My grocery list' } }, 400, /detail\.title is a number, true or false, or one word/],
    [{ drive: 'ana', kind: 'first-document', detail: { doc: { name: 'x' } } }, 400, /detail\.doc/],
    [{ drive: 'ana', kind: 'drive-updated', detail: { 'two words': 1 } }, 400, /short name/],
    [{ drive: 'ana', kind: 'drive-updated', detail: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i])) }, 400, /at most 8/],
    [{ drive: 'ana', kind: 'drive-updated', detail: { release: 'r'.repeat(81) } }, 400, /detail\.release/],
  ];
  for (const [b, status, why] of bad) {
    const r = await d.call('POST', '/events', b);
    assert.equal(r.status, status, JSON.stringify(b));
    assert.match(r.data.why, why, JSON.stringify(b));
  }
  assert.equal((await d.call('POST', '/events', { drive: 'ana', kind: 'agent-connected', detail: { provider: 'codex', via: 'login' } })).data.ok, true);
  d.tick();
  assert.equal((await d.call('POST', '/events', { drive: 'ana', kind: 'agent-connected', detail: { provider: 'claude' } })).data.already, true, 'the first time only');
  await d.call('POST', '/events', { drive: 'ana', kind: 'first-document' });
  for (const release of ['20261025T161133Z-4b2103a', '20261026T090000Z-9c1d2e3']) {
    d.tick();
    await d.call('POST', '/events', { drive: 'ana', kind: 'drive-updated', detail: { release, from: 'x', ok: true, tries: 1, note: null, drive: 'bob' } });
  }
  await d.call('POST', '/events', { drive: 'ana', kind: 'drive-restarted', detail: { why: 'unhealthy' } });

  const lines = (await d.call('GET', '/log')).data.lines;
  const of = (kind) => lines.filter((l) => l.kind === kind);
  assert.equal(of('agent-connected').length, 1);
  assert.deepEqual(of('agent-connected')[0].detail, { provider: 'codex', via: 'login', drive: 'ana' });
  assert.equal(of('agent-connected')[0].account, account.id, 'under the drive’s owner');
  assert.equal(of('first-document').length, 1);
  assert.equal(of('drive-updated').length, 2, 'every move is its own line');
  assert.equal(of('drive-updated')[0].detail.drive, 'ana', 'the drive is the one reported on, whatever detail says');
  assert.equal(of('drive-restarted').length, 1);
});

// ------------------------------------------------------------ people

test('people: one row per person, from an open invite to a first document, with the timeline read from the log', async () => {
  const d = dir();
  // The owner, who is not a row.
  const ownerCode = (await d.call('POST', '/invite', { owner: true })).data.code;
  await d.call('POST', '/identity', { provider: 'github', subject: 'owner-sub', email: 'bryan@example.com', name: 'Bryan Min', invite: ownerCode });

  // Dee: invited to the study, link not opened.
  const deeInvite = (await d.call('POST', '/invite', { study: true, note: 'Dee' })).data;
  d.tick();
  // Cho: signed in with a study invite, no answer yet.
  const cho = await invited(d, 'cho', { study: true });
  // Ana: all the way, in the study.
  const invitedAt = d.at();
  const ana = await invited(d, 'ana', { study: true });
  const signedInAt = new Date(Date.parse(invitedAt) + 60_000).toISOString();
  const consentAt = d.at();
  await d.call('POST', '/consent', { account: ana.account.id, version: 'v1', choice: 'given' });
  d.tick();
  const namedAt = d.at();
  await d.call('POST', '/drive', { account: ana.account.id, name: 'ana', home: 'pchost' });
  d.tick();
  const readyAt = d.at();
  await d.call('POST', '/drives/ana/step', { state: 'ready', home: 'pchost' });
  d.tick();
  const agentAt = d.at();
  await d.call('POST', '/events', { drive: 'ana', kind: 'agent-connected', detail: { provider: 'claude' } });
  d.tick();
  const docAt = d.at();
  await d.call('POST', '/events', { drive: 'ana', kind: 'first-document' });
  d.tick();
  await d.call('POST', '/events', { drive: 'ana', kind: 'drive-updated', detail: { release: 'r1' } });
  d.tick();
  const updatedAt = d.at();
  await d.call('POST', '/events', { drive: 'ana', kind: 'drive-updated', detail: { release: 'r2' } });
  // Bo: said no, so his drive is outside the study.
  const bob = await invited(d, 'bob', { study: true });
  await d.call('POST', '/consent', { account: bob.account.id, version: 'v1', choice: 'declined' });
  await d.call('POST', '/drive', { account: bob.account.id, name: 'bob', home: 'pchost' });
  // Eve: in, then left, then asked for what was collected to go.
  const eve = await readyOnPc(d, 'eve', { study: true });
  await d.call('POST', '/study/leave', { account: eve.account.id });
  d.tick();
  await d.call('POST', '/study/delete', { account: eve.account.id });
  // Flo: an ordinary invite, on Fly.
  const flo = await invited(d, 'flo');
  await d.call('POST', '/drive', { account: flo.account.id, name: 'flo' });
  // Neither a row: a spent invite nobody signed in with, and an expired one.
  const expired = (await d.call('POST', '/invite', { days: 1, note: 'late' })).data;
  d.tick(2 * 24 * 60);

  const r = await d.call('GET', '/people');
  assert.equal(r.status, 200);
  const people = r.data.people;
  const row = (who) => people.find((p) => (p.account?.name ?? p.invite?.note) === who);
  assert.deepEqual(people.map((p) => p.account?.name ?? p.invite?.note), ['Dee', 'cho', 'ana', 'bob', 'eve', 'flo'], 'oldest first, Bryan not among them');
  assert.ok(!people.some((p) => p.invite?.note === 'late'), 'an expired invite is not open');

  assert.deepEqual(row('Dee'), {
    account: null,
    drive: null,
    invite: { id: deeInvite.invite.id, note: 'Dee', made: deeInvite.invite.made, expires: deeInvite.invite.expires, used: null, study: true },
    study: { cohort: 'study', consent: null, withdrawn: null, deleteAsked: null },
    timeline: { invited: deeInvite.invite.made, signedIn: null, consented: null, named: null, ready: null, agentConnected: null, firstDocument: null, updated: null },
  });

  const c = row('cho');
  assert.deepEqual(Object.keys(c.account), ['id', 'name', 'email', 'created', 'seen']);
  assert.equal(c.drive, null);
  assert.equal(c.invite.study, true);
  assert.equal(c.invite.used, null, 'held, not yet spent');
  assert.equal(c.study.cohort, 'study');
  assert.equal(c.study.consent, null);
  assert.equal(c.timeline.signedIn, c.account.created);

  const a = row('ana');
  assert.deepEqual(a.account, { id: ana.account.id, name: 'ana', email: 'ana@example.com', created: signedInAt, seen: signedInAt });
  assert.deepEqual(a.drive, { name: 'ana', state: 'ready', home: 'pchost', created: namedAt });
  assert.deepEqual(a.invite, { id: ana.invite.id, note: 'ana', made: invitedAt, expires: ana.invite.expires, used: namedAt, study: true });
  assert.deepEqual(a.study, { cohort: 'study', consent: { version: 'v1', at: consentAt, choice: 'given' }, withdrawn: null, deleteAsked: null });
  assert.deepEqual(a.timeline, { invited: invitedAt, signedIn: signedInAt, consented: consentAt, named: namedAt, ready: readyAt, agentConnected: agentAt, firstDocument: docAt, updated: updatedAt });

  const b = row('bob');
  assert.equal(b.study.cohort, null, 'outside the study');
  assert.equal(b.study.consent.choice, 'declined');
  assert.equal(b.timeline.consented, null);
  assert.equal(b.invite.study, true, 'though invited to it');

  const e = row('eve');
  assert.equal(e.study.cohort, 'study');
  assert.match(e.study.withdrawn, /^2026-/);
  assert.match(e.study.deleteAsked, /^2026-/);
  assert.ok(e.study.deleteAsked > e.study.withdrawn);

  const f = row('flo');
  assert.equal(f.drive.home, 'fly');
  assert.equal(f.invite.study, false);
  assert.equal(f.study.cohort, null);
  assert.equal(f.timeline.ready, null, 'not made yet');

  // Nothing secret: no invite code or its hash, no session, no sign-in subject.
  const all = JSON.stringify(r.data);
  for (const secret of [deeInvite.code, cho.code, ana.code, expired.code, 'sub-ana', 'owner-sub', eve.session.sid, eve.session.hash]) assert.ok(!all.includes(secret), secret);
  for (const [key] of d.storage.map) if (key.startsWith('invite:')) assert.ok(!all.includes(key.slice('invite:'.length)), 'an invite hash');
  assert.ok(!all.includes('Bryan Min') && !all.includes('bryan@example.com'), 'the owner’s own account is not listed');
});

test('people: a removed drive keeps its row, as removed; an older account finds its invite in the log', async () => {
  const d = dir();
  const ana = await readyOnPc(d);
  await d.call('POST', '/drives/ana/remove', { confirm: 'ana' });
  await d.call('POST', '/drives/ana/step', { state: 'removed' });
  // An account from before accounts kept their invite's id.
  const stored = d.storage.map.get(`acct:${ana.account.id}`);
  delete stored.invite;
  const row = (await d.call('GET', '/people')).data.people.find((p) => p.account?.id === ana.account.id);
  assert.equal(row.drive.state, 'removed');
  assert.match(row.invite.id, /^[0-9a-f]{8}$/);
  assert.match(row.timeline.ready, /^2026-/);
});

test('a study invite that lapsed before a drive was named gives way to a new one, and the new one asks again', async () => {
  const d = dir();
  const first = await invited(d, 'ana', { study: true, days: 1 });
  await d.call('POST', '/consent', { account: first.account.id, version: 'v1', choice: 'given' });
  d.tick(2 * 24 * 60);
  const gone = (await d.call('GET', `/accounts/${first.account.id}`)).data;
  assert.equal(gone.mayMake, false, 'the first has expired');
  assert.equal((await d.call('POST', '/drive', { account: first.account.id, name: 'ana', home: 'pchost' })).status, 403);

  const again = (await d.call('POST', '/invite', { study: true, note: 'Ana, again' })).data;
  const back = await d.call('POST', '/identity', { provider: 'google', subject: 'sub-ana', email: 'ana@example.com', name: 'ana', invite: again.code });
  assert.equal(back.data.account.id, first.account.id, 'the same account');
  assert.equal(back.data.account.mayMake, true);
  assert.equal(back.data.account.askConsent, true, 'the new invite asks for itself');
  assert.deepEqual(back.data.account.study, { consent: null, withdrawn: null, deleteAsked: null });
  assert.ok((await d.call('GET', '/log')).data.lines.some((l) => l.kind === 'consent-given' && l.account === first.account.id), 'the first answer stays in the log');
  await d.call('POST', '/consent', { account: first.account.id, version: 'v2', choice: 'given' });
  assert.equal((await d.call('POST', '/drive', { account: first.account.id, name: 'ana', home: 'pchost' })).status, 200);
  const row = (await d.call('GET', '/people')).data.people.find((p) => p.account?.id === first.account.id);
  assert.equal(row.invite.id, again.invite.id, 'the row names the invite she made her drive with');
  assert.equal(row.study.consent.version, 'v2');

  // A live invite is never swapped for another.
  const bob = await invited(d, 'bob');
  const other = (await d.call('POST', '/invite', { study: true })).data;
  const still = await d.call('POST', '/identity', { provider: 'google', subject: 'sub-bob', email: 'bob@example.com', name: 'bob', invite: other.code });
  assert.equal(still.data.account.studyInvite, false, 'he keeps the invite he came in on');
  assert.equal((await d.call('POST', '/invite/peek', { code: bob.code })).data.ok, true);
});
