// test/door-study.test.js
// The probe study at the front door (worker/src/door/apex.js, pages.js,
// worker/src/router.js): a study invite's consent screen comes after signing
// in and before the name and can't be gone round, either answer goes on to a
// drive, the screen is off until the form is set up, and the account page's
// Leave the study, Download my drive and Delete my drive. Then the edge's
// answer for a drive that is being removed, deleted, or has been removed.
// The door is the real Worker code over a Directory in memory; the PC host
// and the sign-in providers are fakes.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { consentVersion } from '../worker/src/door/apex.js';
import { CONSENT_FORM, consentFormReady } from '../worker/src/door/pages.js';
import { forgetLeases, route } from '../worker/src/router.js';
import { browser, signInWith } from './fixtures/door-browser.js';
import { doorEnv, fakeProviders } from './fixtures/door-env.js';

beforeEach(() => forgetLeases());

const PC_HOST = 'https://pc-host.marbledrive.app';
const KEY = 'a'.repeat(64);
const VERSION = '2026-10.irb-1';
// Stands in for the protocol's approved words, which only Bryan has.
const FORM = 'Consent to take part in a research study.\n\nYou are asked to take part in a study of how people make <tools> & "apps".\nIt lasts four weeks.\n\nTaking part is up to you.';
const PC = { NEW_DRIVE_HOME: 'pchost', PC_HOST_URL: PC_HOST, PC_HOST_KEY: KEY, DOOR_SPRITE_URL: '', CONSENT_VERSION: VERSION };

/** A door making drives on the PC host, with a consent form set up unless
 *  `form` is null (then the placeholder in pages.js is what it has). */
function world(vars = {}, { form = FORM } = {}) {
  const env = doorEnv({ ...PC, ...vars });
  const google = { sub: '1100000000000001', email: 'ana@example.com', name: 'Ana' };
  const fake = fakeProviders({ google, github: { id: 4242, emails: [{ email: 'bob@example.com', primary: true, verified: true }] } });
  fake.setNonce = (n) => {
    google.nonce = n;
  };
  const upstream = [];
  const fetchImpl = async (input, init = {}) => {
    const href = String(input instanceof Request ? input.url : input);
    if (href.startsWith(`${PC_HOST}/_host/poke`) || href.startsWith('https://door-sprite.example')) return new Response('{}', { status: 202 });
    if (href.startsWith(`${PC_HOST}/`) || href.includes('.sprites.app') || href.includes('-bryan.marbledrive.app')) {
      upstream.push({ href, method: init.method, headers: new Headers(init.headers) });
      return new Response('from the drive', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return fake.fetchImpl(input, init);
  };
  const options = form === null ? {} : { consentForm: form };
  const admin = async (method, path, body) => {
    const res = await route(new Request(`https://marbledrive.app/_door${path}`, { method, headers: { authorization: `Bearer ${env.DOOR_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { fetchImpl });
    return { status: res.status, data: await res.json() };
  };
  const invite = async (opts = {}) => {
    const r = await admin('POST', '/invite', { uses: 1, ...opts });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.link.split('/join/')[1];
  };
  const b = (opts = {}) => browser(env, { fetchImpl, options, ...opts });
  /** Someone signed in with an invite to the study. */
  const studyPerson = async ({ provider = 'google', ip = '198.51.100.7' } = {}) => {
    const code = await invite({ study: true, note: provider === 'google' ? 'Ana' : 'Bob' });
    const person = b({ ip });
    await signInWith(person, provider, { invite: code, fake });
    return { person, code };
  };
  const drive = async (name) => (await admin('GET', '/drives')).data.drives.find((d) => d.name === name);
  return { env, fake, fetchImpl, upstream, admin, invite, b, studyPerson, drive, options };
}

const text = (res) => res.text();
const answer = (b, fields, origin) => b.form('/consent', { version: VERSION, ...fields }, origin);
/** Ana's drive named, made by marble-host, and her pass in her jar. */
async function readyDrive(w, b, name = 'ana') {
  assert.equal((await b.form('/name', { name })).status, 303);
  assert.equal((await w.admin('POST', `/drives/${name}/step`, { state: 'ready', home: 'pchost' })).status, 200);
  forgetLeases();
  const grant = (await b.go(`/enter?drive=${name}&to=%2Fa%2FNotes`)).headers.get('location');
  assert.equal((await b.go(grant)).status, 302);
  w.upstream.length = 0;
}

// ------------------------------------------------------------ the consent screen

test('a study invite: its link says so, and after signing in the consent screen comes before the name, with no way round it', async () => {
  const w = world();
  const code = await w.invite({ study: true });
  const join = await text(await w.b().go(`/join/${code}`));
  assert.match(join, /Next you say whether you’ll take part in the study, then choose its name/);

  const ana = w.b();
  await signInWith(ana, 'google', { invite: code, fake: w.fake });
  assert.equal((await ana.go('/')).headers.get('location'), '/consent');
  const toName = await ana.go('/name');
  assert.equal(toName.status, 303);
  assert.equal(toName.headers.get('location'), '/consent', 'the name page sends her back');
  const posted = await ana.form('/name', { name: 'ana' });
  assert.equal(posted.status, 303);
  assert.equal(posted.headers.get('location'), '/consent', 'and so does posting a name');
  assert.equal((await w.admin('GET', '/drives')).data.drives.length, 0, 'no drive');

  const screen = await ana.go('/consent');
  assert.equal(screen.status, 200);
  assert.match(screen.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const page = await text(screen);
  assert.match(page, /<h1>Taking part in the study<\/h1>/);
  assert.match(page, /Bryan Min is studying how people make their own tools by asking an AI\./);
  assert.match(page, /Recorded: the pages you open, what you ask the agent, what it makes\./);
  assert.match(page, /Never recorded: your Claude or ChatGPT password, or anything outside your drive\./);
  assert.match(page, /Leave any time from your account page\./);
  assert.match(page, /Consent form, version <span class="whole">2026-10\.irb-1<\/span>/);
  assert.ok(page.includes('<p>Consent to take part in a research study.</p>'), 'the protocol’s words, a paragraph each');
  assert.ok(page.includes('a study of how people make &lt;tools&gt; &amp; &quot;apps&quot;.<br>It lasts four weeks.'), 'escaped, its line breaks kept');
  assert.match(page, /<input type="hidden" name="version" value="2026-10\.irb-1">/);
  assert.match(page, /<button class="btn" type="submit" name="choice" value="given">Take part<\/button>/);
  assert.match(page, /<button class="btn" type="submit" name="choice" value="declined">Don’t take part<\/button>/);
  assert.doesNotMatch(page, /btn one/, 'two choices of equal weight');
  assert.doesNotMatch(page, /PLACEHOLDER/);
});

test('Take part: from this site only, the answer is kept with its version, then the name, and the drive is in the study', async () => {
  const w = world();
  const { person: ana } = await w.studyPerson();
  assert.equal((await answer(ana, { choice: 'given' }, 'https://bob.marbledrive.app')).status, 403, 'a drive’s page can’t answer for her');
  const noOrigin = await ana.go('/consent', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `version=${VERSION}&choice=given` });
  assert.equal(noOrigin.status, 403);
  assert.equal((await ana.go('/')).headers.get('location'), '/consent', 'nothing was kept');

  const yes = await answer(ana, { choice: 'given' });
  assert.equal(yes.status, 303);
  assert.equal(yes.headers.get('location'), '/name');
  assert.equal((await ana.go('/consent')).headers.get('location'), '/name', 'answered: on to the name');
  const log = (await w.admin('GET', '/log')).data.lines;
  const given = log.find((l) => l.kind === 'consent-given');
  assert.ok(given, 'consent-given is logged');
  assert.equal(given.detail.version, VERSION);

  assert.match(await text(await ana.go('/name')), /Name your drive/);
  assert.equal((await ana.form('/name', { name: 'ana' })).headers.get('location'), '/making/ana');
  assert.equal(w.env.storage.map.get('drive:ana').cohort, 'study');
  const row = (await w.admin('GET', '/people')).data.people.find((p) => p.drive?.name === 'ana');
  assert.equal(row.study.cohort, 'study');
  assert.equal(row.study.consent.version, VERSION);
  assert.equal(row.study.consent.choice, 'given');
  assert.match(row.study.consent.at, /^\d{4}-\d{2}-\d{2}T/);
  // Once the drive is made, the screen has nothing to ask.
  assert.equal((await ana.go('/consent')).headers.get('location'), '/making/ana');
  assert.equal((await answer(ana, { choice: 'declined' })).headers.get('location'), '/making/ana');
  assert.equal(w.env.storage.map.get(`acct:${row.account.id}`).study.consent.choice, 'given', 'the answer stands');
});

test('Don’t take part: still a drive, made outside the study', async () => {
  const w = world();
  const { person: ana } = await w.studyPerson();
  const no = await answer(ana, { choice: 'declined' });
  assert.equal(no.status, 303);
  assert.equal(no.headers.get('location'), '/name');
  assert.equal((await ana.form('/name', { name: 'ana' })).headers.get('location'), '/making/ana');
  assert.equal(w.env.storage.map.get('drive:ana').cohort, null);
  assert.ok((await w.admin('GET', '/log')).data.lines.some((l) => l.kind === 'consent-declined'));
  await w.admin('POST', '/drives/ana/step', { state: 'ready', home: 'pchost' });
  const page = await text(await ana.go('/account'));
  assert.doesNotMatch(page, /<span class="ak">The study<\/span>/, 'no study row for someone who said no');
});

test('an answer to a form that has changed is shown the form again, not taken; a choice that isn’t one is refused', async () => {
  const w = world();
  const { person: ana } = await w.studyPerson();
  const stale = await ana.form('/consent', { version: '2026-09.irb-0', choice: 'given' });
  assert.equal(stale.status, 409);
  const page = await text(stale);
  assert.match(page, /The form changed while you were reading it\. Read it again, then choose\./);
  assert.match(page, /value="2026-10\.irb-1"/, 'the form as it is now');
  const odd = await answer(ana, { choice: 'maybe' });
  assert.equal(odd.status, 400);
  assert.match(await text(odd), /Choose Take part or Don’t take part/);
  assert.equal((await ana.go('/')).headers.get('location'), '/consent', 'still unanswered');
});

test('without CONSENT_VERSION, or with the placeholder still in pages.js, the study isn’t ready and no drive is made', async () => {
  assert.equal(consentFormReady(CONSENT_FORM), false, 'the form shipped is the placeholder');
  assert.match(CONSENT_FORM, /^PLACEHOLDER: Bryan replaces this with the consent form his IRB protocol approved/);
  assert.equal(consentFormReady(FORM), true);
  assert.equal(consentVersion({ CONSENT_VERSION: VERSION }), null, 'the placeholder: not ready, whatever the version');
  assert.equal(consentVersion({ CONSENT_VERSION: VERSION }, FORM), VERSION);
  assert.equal(consentVersion({}, FORM), null);
  assert.equal(consentVersion({ CONSENT_VERSION: 'form 1' }, FORM), null, 'a version that can’t go into a drive’s settings');

  for (const [vars, opts] of [[{ CONSENT_VERSION: undefined }, {}], [{}, { form: null }], [{ CONSENT_VERSION: 'v@1' }, {}]]) {
    const w = world(vars, opts);
    const code = await w.invite({ study: true });
    const ana = w.b();
    const back = await signInWith(ana, 'google', { invite: code, fake: w.fake });
    assert.equal(back.status, 303, 'study invites still work');
    assert.equal((await ana.go('/')).headers.get('location'), '/consent');
    const screen = await ana.go('/consent');
    assert.equal(screen.status, 503);
    const page = await text(screen);
    assert.match(page, /The study isn’t ready yet/);
    assert.match(page, /Bryan hasn’t finished setting up its consent form\. Your invite still works; try again later\./);
    assert.doesNotMatch(page, /Take part|PLACEHOLDER/, 'nothing to agree to');
    assert.equal((await answer(ana, { choice: 'given' })).status, 503);
    assert.equal((await ana.form('/name', { name: 'ana' })).headers.get('location'), '/consent');
    assert.equal((await w.admin('GET', '/drives')).data.drives.length, 0, JSON.stringify(vars));
  }
});

test('an ordinary invite never sees the consent screen, and /consent sends it on', async () => {
  const w = world();
  const code = await w.invite();
  assert.match(await text(await w.b().go(`/join/${code}`)), /You’ll choose its name next/);
  const ana = w.b();
  await signInWith(ana, 'google', { invite: code, fake: w.fake });
  assert.equal((await ana.go('/')).headers.get('location'), '/name');
  assert.equal((await ana.go('/consent')).headers.get('location'), '/name');
  assert.equal((await answer(ana, { choice: 'given' })).headers.get('location'), '/name', 'nothing to answer, nothing kept');
  assert.equal((await ana.form('/name', { name: 'ana' })).status, 303);
  assert.equal(w.env.storage.map.get('drive:ana').cohort, null);
  assert.equal((await w.admin('GET', '/log')).data.lines.filter((l) => l.kind.startsWith('consent-')).length, 0);
});

// ------------------------------------------------------------ the account page

test('the account page: Download my drive and Delete my drive under a ready drive on the PC host, and the study while she is in it', async () => {
  const w = world();
  const { person: ana } = await w.studyPerson();
  await answer(ana, { choice: 'given' });
  await readyDrive(w, ana);
  const page = await text(await ana.go('/account'));
  assert.ok(page.includes('<a href="https://ana.marbledrive.app/drive/export.zip">Download my drive</a>'));
  assert.ok(page.includes('<a class="danger" href="/account/delete/ana">Delete my drive</a>'));
  assert.match(page, /<span class="ak">The study<\/span>/);
  assert.match(page, /You’re taking part\. You agreed to form <span class="whole">2026-10\.irb-1<\/span> on <span class="whole">[A-Z][a-z]{2} \d{1,2}, \d{4}<\/span>\./);
  assert.match(page, /<form method="post" action="\/account\/study\/leave"><button class="link" type="submit">Leave the study<\/button><\/form>/);
  assert.doesNotMatch(page, /Delete what was collected/, 'a second choice, offered after leaving');
});

test('Leave the study, from this site only; then Delete what was collected, a separate choice; each logged once', async () => {
  const w = world();
  const { person: ana } = await w.studyPerson();
  await answer(ana, { choice: 'given' });
  await readyDrive(w, ana);
  const study = async () => (await w.admin('GET', '/people')).data.people.find((p) => p.drive?.name === 'ana').study;

  assert.equal((await ana.form('/account/study/leave', {}, 'https://ana.marbledrive.app')).status, 403, 'not from her drive’s own pages');
  assert.equal((await ana.go('/account/study/leave', { method: 'POST' })).status, 403, 'nor with no Origin');
  assert.equal((await study()).withdrawn, null);
  assert.equal((await w.b().form('/account/study/leave', {})).headers.get('location'), '/', 'signed out: sign in first');

  const left = await ana.form('/account/study/leave', {});
  assert.equal(left.status, 303);
  assert.equal(left.headers.get('location'), '/account');
  const after = await study();
  assert.match(after.withdrawn, /^\d{4}-/);
  assert.equal(after.deleteAsked, null, 'leaving deletes nothing by itself');
  let page = await text(await ana.go('/account'));
  assert.match(page, /You left on <span class="whole">[A-Z][a-z]{2} \d{1,2}, \d{4}<\/span>\. What was collected before then is kept unless you ask for it to be deleted\./);
  assert.match(page, /action="\/account\/study\/delete"><button class="link danger" type="submit">Delete what was collected<\/button>/);
  assert.doesNotMatch(page, /Leave the study/);

  assert.equal((await ana.form('/account/study/delete', {}, 'https://evil.example')).status, 403);
  assert.equal((await study()).deleteAsked, null);
  const asked = await ana.form('/account/study/delete', {});
  assert.equal(asked.headers.get('location'), '/account');
  assert.match((await study()).deleteAsked, /^\d{4}-/);
  page = await text(await ana.go('/account'));
  assert.match(page, /You left on <span class="whole">[^<]+<\/span>, and asked on <span class="whole">[^<]+<\/span> for what was collected to be deleted\./);
  assert.doesNotMatch(page, /<button class="link danger"[^>]*>Delete what was collected/);
  await ana.form('/account/study/leave', {});
  await ana.form('/account/study/delete', {});
  const kinds = (await w.admin('GET', '/log')).data.lines.map((l) => l.kind);
  assert.equal(kinds.filter((k) => k === 'consent-withdrawn').length, 1);
  assert.equal(kinds.filter((k) => k === 'study-delete-asked').length, 1);
});

test('asking to delete what was collected before leaving is refused in words', async () => {
  const w = world();
  const { person: ana } = await w.studyPerson();
  await answer(ana, { choice: 'given' });
  await readyDrive(w, ana);
  const early = await ana.form('/account/study/delete', {});
  assert.equal(early.status, 409);
  assert.match(await text(early), /Leave the study first/);
});

test('Delete my drive: a page that says what goes, the name typed, from this site only; then it is being deleted', async () => {
  const w = world();
  const { person: ana } = await w.studyPerson();
  await answer(ana, { choice: 'given' });
  await readyDrive(w, ana);

  const page = await ana.go('/account/delete/ana');
  assert.equal(page.status, 200);
  const body = await text(page);
  assert.match(body, /<h1>Delete <span class="addr">ana\.marbledrive\.app<\/span><\/h1>/);
  assert.match(body, /Its pages, files and history are deleted from Bryan’s PC, and it can’t be undone\. Its encrypted backup is kept until Bryan deletes it\. <a href="https:\/\/ana\.marbledrive\.app\/drive\/export\.zip">Download it<\/a> first to keep a copy\./);
  assert.match(body, /<label class="label" for="confirm">Type ana to delete it<\/label>/);
  assert.match(body, /<button class="btn danger" type="submit">Delete my drive<\/button>/);
  assert.match(body, /<a href="\/account">Keep my drive<\/a>/);

  assert.equal((await ana.form('/account/delete/ana', { confirm: 'ana' }, 'https://ana.marbledrive.app')).status, 403);
  const typo = await ana.form('/account/delete/ana', { confirm: 'anna' });
  assert.equal(typo.status, 400);
  assert.match(await text(typo), /That isn’t ana\. Type its name as it is\./);
  assert.equal((await w.drive('ana')).state, 'ready', 'nothing yet');

  const gone = await ana.form('/account/delete/ana', { confirm: 'ana' });
  assert.equal(gone.status, 303);
  assert.equal(gone.headers.get('location'), '/account');
  assert.equal((await w.drive('ana')).state, 'deleting');
  assert.ok((await w.admin('GET', '/log')).data.lines.some((l) => l.kind === 'drive-delete-asked' && l.detail.drive === 'ana'));
  const acct = await text(await ana.go('/account'));
  assert.match(acct, /<span class="addr">ana\.marbledrive\.app<\/span><span>Being deleted<\/span>/);
  assert.doesNotMatch(acct, /Download my drive|Delete my drive|>Open</);
  assert.equal((await ana.go('/')).headers.get('location'), '/account', 'never sent to the making page');
  assert.equal((await ana.go('/making/ana')).headers.get('location'), '/account');
  assert.equal((await ana.go('/account/delete/ana')).headers.get('location'), '/account');
  const enter = await ana.go('/enter?drive=ana&to=/');
  assert.equal(enter.status, 410);
  assert.match(await text(enter), /This drive is being deleted/);

  // The edge says so, to her and to a script, and never asks the PC.
  forgetLeases();
  const edge = await ana.go('https://ana.marbledrive.app/a/Notes');
  assert.equal(edge.status, 410);
  assert.match(await text(edge), /<h1>This drive is being deleted<\/h1><p>Nothing on it can be opened any more\.<\/p>/);
  const api = await ana.go('https://ana.marbledrive.app/docs', { headers: { accept: 'application/json' } });
  assert.equal(api.status, 410);
  assert.deepEqual(await api.json(), { error: 'This drive is being deleted.', gone: true });
  assert.equal(w.upstream.length, 0);

  // marble-host deletes it and says so; the record stays, as removed.
  assert.equal((await w.admin('POST', '/drives/ana/step', { state: 'removed' })).status, 200);
  forgetLeases();
  assert.match(await text(await ana.go('https://ana.marbledrive.app/a/Notes')), /This drive has been removed/);
  assert.match(await text(await ana.go('/account')), /<span>Removed<\/span>/);
});

test('Delete my drive is only for its owner, and only for a drive on the PC host', async () => {
  const w = world();
  const { person: ana } = await w.studyPerson();
  await answer(ana, { choice: 'given' });
  await readyDrive(w, ana);
  const bob = w.b({ ip: '203.0.113.5' });
  await signInWith(bob, 'github', { invite: await w.invite() });
  assert.equal((await bob.go('/account/delete/ana')).status, 403, 'not his');
  assert.equal((await bob.form('/account/delete/ana', { confirm: 'ana' })).status, 403);
  assert.equal((await w.drive('ana')).state, 'ready');

  // A drive on Fly: Download, but nothing here would carry a delete out.
  const fly = world({ NEW_DRIVE_HOME: undefined, DOOR_SPRITE_URL: 'https://door-sprite.example' });
  const flo = fly.b();
  await signInWith(flo, 'google', { invite: await fly.invite(), fake: fly.fake });
  await flo.form('/name', { name: 'flo' });
  await fly.admin('POST', '/drives/flo/step', { state: 'ready', url: 'https://d-flo-x.sprites.app', sprite: 'd-flo' });
  const page = await text(await flo.go('/account'));
  assert.match(page, /Download my drive/);
  assert.doesNotMatch(page, /Delete my drive/);
  assert.equal((await flo.go('/account/delete/flo')).headers.get('location'), '/account');
  assert.equal((await flo.form('/account/delete/flo', { confirm: 'flo' })).headers.get('location'), '/account');
  assert.equal((await fly.drive('flo')).state, 'ready');
});

// ------------------------------------------------------------ the edge

test('a drive Bryan removed: “This drive has been removed”, pass or no pass, and never forwarded; the sign-out walk still goes through', async () => {
  const w = world();
  const { person: ana } = await w.studyPerson();
  await answer(ana, { choice: 'given' });
  await readyDrive(w, ana);
  const grantUrl = (await ana.go('/enter?drive=ana&to=%2F')).headers.get('location');
  assert.equal((await w.admin('POST', '/drives/ana/remove', { confirm: 'ana' })).status, 200);
  forgetLeases();

  for (const headers of [{ accept: 'text/html' }, { accept: 'text/html', cookie: 'marble_share=tok.en' }, { accept: 'text/html', authorization: 'Bearer the-passphrase' }]) {
    const res = await route(new Request('https://ana.marbledrive.app/s/abc', { headers }), w.env, { fetchImpl: w.fetchImpl });
    assert.equal(res.status, 410, JSON.stringify(headers));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(await text(res), /<h1>This drive has been removed<\/h1><p>Nothing on it can be opened any more\.<\/p>/);
  }
  assert.equal((await ana.go('https://ana.marbledrive.app/a/Notes')).status, 410, 'with her pass too');
  const mcp = await route(new Request('https://ana.marbledrive.app/mcp', { method: 'POST', body: '{}' }), w.env, { fetchImpl: w.fetchImpl });
  assert.deepEqual(await mcp.json(), { error: 'This drive has been removed.', gone: true });
  assert.equal((await ana.go(grantUrl)).status, 410, 'a grant made before is no way back in');
  assert.equal(ana.jar('ana.marbledrive.app').has('__Host-md_pass'), true, 'and no new pass was set');
  assert.equal(w.upstream.length, 0, 'the PC host was never asked');

  const leave = await ana.go('https://ana.marbledrive.app/_marble/leave');
  assert.equal(leave.status, 303);
  assert.equal(leave.headers.get('location'), 'https://marbledrive.app/');
  assert.equal(ana.jar('ana.marbledrive.app').has('__Host-md_pass'), false, 'her pass is cleared on the way out');

  await w.admin('POST', '/drives/ana/step', { state: 'removed' });
  forgetLeases();
  const removed = await w.b().go('https://ana.marbledrive.app/');
  assert.equal(removed.status, 410);
  assert.match(await text(removed), /This drive has been removed/);
});

test('a removed drive in DRIVES is not passed on by its lease either', async () => {
  const w = world();
  const claim = (await w.admin('POST', '/invite', { drive: 'bryan', sprite: 'admin-p2' })).data.link.split('/join/')[1];
  const owner = w.b({ ip: '203.0.113.77' });
  await signInWith(owner, 'github', { invite: claim });
  await w.admin('POST', '/drives/bryan/remove', { confirm: 'bryan' });
  forgetLeases();
  const res = await route(new Request('https://bryan.marbledrive.app/a/x', { headers: { accept: 'text/html' } }), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(res.status, 410);
  assert.equal(w.upstream.length, 0);
});
