// The spare drive (docs/ACCOUNTS.md, "The spare drive"): the door sprite keeps
// one drive made ahead, the Directory hands it to the next sign-up, the
// provisioner only names it and restarts it, and without one (or when handing
// it over fails) the drive is made from nothing as before. The door is the
// real Worker code over a Directory in memory; the script is a fake that
// prints what the real one prints.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { beforeEach } from 'node:test';

import { createProvisioner, scriptArgs, scriptRunner, SPARE_DRIVES, SPARE_STALE_MS, sparesWanted } from '../server/provisioner.js';
import { Directory } from '../worker/src/door/directory.js';
import { nameProblem, nameSuggestions } from '../worker/src/door/names.js';
import * as pages from '../worker/src/door/pages.js';
import { forgetLeases, route } from '../worker/src/router.js';
import { browser, signInWith } from './fixtures/door-browser.js';
import { doorEnv, fakeProviders, memoryStorage } from './fixtures/door-env.js';

beforeEach(() => forgetLeases());
const quiet = { log() {}, error() {} };
const SPARE = 'd-spare-3fa9c1d2';
const SPARE_URL = 'https://d-spare-3fa9c1d2-xyz.sprites.app';

// ------------------------------------------------------------ the name

test('a name is suggested from her Google or GitHub name, each one a name the door takes', () => {
  const ana = nameSuggestions('Ana Lima', 'ana.lima@example.com');
  assert.deepEqual(ana.slice(0, 3), ['ana', 'ana-lima', 'analima']);
  assert.ok(ana.includes('ana2') && ana.includes('ana9'), 'digits when the plain ones are taken');
  assert.equal(nameSuggestions('José Núñez')[0], 'jose', 'accents folded');
  assert.equal(nameSuggestions('bdhmin')[0], 'bdhmin', 'a GitHub login is kept as it is');
  assert.equal(nameSuggestions('Al Green', 'al@example.com')[0], 'al-green', 'too short alone: the full name');
  assert.equal(nameSuggestions('김민수', 'minsu.kim@example.com')[0], 'minsu-kim', 'no Latin letters: the email');
  assert.equal(nameSuggestions('Bryan', 'b@example.com')[0], 'bryan2', 'a name kept for a tester is skipped');
  assert.deepEqual(nameSuggestions('Spare Parts').slice(0, 2), ['spare', 'spareparts'], 'spare-… is kept for machines');
  assert.deepEqual(nameSuggestions('', ''), []);
  for (const n of [...ana, ...nameSuggestions('A Very Long Name Indeed Of Someone Who Has Many Names')]) assert.equal(nameProblem(n), null, n);
});

test('spare- names are kept for machines', () => {
  assert.match(nameProblem('spare-3fa9'), /kept for machines/);
  assert.equal(nameProblem('spares'), null);
});

// ------------------------------------------------------------ the Directory

function dir({ max = '10' } = {}) {
  const storage = memoryStorage();
  const object = new Directory({ storage }, { MAX_DRIVES: max });
  const call = async (method, path, body) => {
    const res = await object.fetch(new Request(`https://directory${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }));
    return { status: res.status, data: await res.json() };
  };
  return { storage, call };
}

async function member(d, who) {
  const code = (await d.call('POST', '/invite', { uses: 1 })).data.code;
  return (await d.call('POST', '/identity', { provider: 'google', subject: who, email: `${who}@example.com`, name: who, invite: code })).data.account;
}

test('Directory: a spare is made, made ready, and given to the next drive asked for', async () => {
  const d = dir();
  assert.deepEqual((await d.call('GET', '/spares')).data, { spares: [], room: 10 });
  assert.equal((await d.call('POST', '/spares', { sprite: 'd-ana', state: 'making' })).status, 400, 'only d-spare-<hex>');
  assert.equal((await d.call('POST', '/spares', { sprite: SPARE, state: 'making' })).status, 200);
  assert.equal((await d.call('POST', '/spares', { sprite: SPARE, state: 'making' })).status, 409);
  assert.equal((await d.call('POST', '/spares', { sprite: SPARE, state: 'ready', url: 'http://x.example' })).status, 400, 'https only');

  // While it is being made, a sign-up is made from nothing.
  const ana = await member(d, 'ana');
  const plain = (await d.call('POST', '/drive', { account: ana.id, name: 'ana' })).data.drive;
  assert.equal(plain.sprite, 'd-ana');
  assert.equal(plain.spare, null);

  assert.equal((await d.call('POST', '/spares', { sprite: SPARE, state: 'ready', url: `${SPARE_URL}/` })).status, 200);
  const bob = await member(d, 'bob');
  const given = (await d.call('POST', '/drive', { account: bob.id, name: 'bob' })).data.drive;
  assert.equal(given.state, 'queued');
  assert.equal(given.sprite, SPARE, 'the drive maps to the spare’s own sprite');
  assert.deepEqual(given.spare, { sprite: SPARE, url: SPARE_URL });
  assert.deepEqual((await d.call('GET', '/spares')).data.spares, [], 'given out, so no longer a spare');
  const queue = (await d.call('GET', '/queue')).data.drives;
  assert.deepEqual(queue.map((q) => [q.name, q.spare?.sprite ?? null]), [['ana', null], ['bob', SPARE]]);

  // Its two steps, then ready at the spare's URL.
  assert.equal((await d.call('POST', '/drives/bob/step', { step: 'machine', state: 'now' })).status, 400, 'a spare has its own steps');
  assert.equal((await d.call('POST', '/drives/bob/step', { step: 'name', state: 'now' })).status, 200);
  assert.equal((await d.call('POST', '/drives/bob/step', { state: 'ready', url: SPARE_URL, sprite: SPARE })).status, 200);
  const ready = (await d.call('GET', '/drives/bob')).data;
  assert.equal(ready.state, 'ready');
  assert.equal(ready.homes.fly, SPARE_URL);
  assert.deepEqual(ready.steps, { name: 'done', start: 'done' });
  const log = (await d.call('GET', '/log')).data.lines.map((l) => l.kind);
  assert.ok(log.includes('spare-ready') && log.includes('spare-given'));
});

test('Directory: two sign-ups at once and one spare: one gets it, the other is made from nothing', async () => {
  const d = dir();
  await d.call('POST', '/spares', { sprite: SPARE, state: 'making' });
  await d.call('POST', '/spares', { sprite: SPARE, state: 'ready', url: SPARE_URL });
  const a = await member(d, 'ana');
  const b = await member(d, 'bob');
  const [x, y] = await Promise.all([d.call('POST', '/drive', { account: a.id, name: 'ana' }), d.call('POST', '/drive', { account: b.id, name: 'bob' })]);
  const sprites = [x.data.drive.sprite, y.data.drive.sprite].sort();
  assert.ok(sprites.includes(SPARE));
  assert.equal(sprites.filter((s) => s === SPARE).length, 1);
});

test('Directory: a claim invite never takes a spare; a refused sign-up leaves it', async () => {
  const d = dir({ max: '1' });
  await d.call('POST', '/spares', { sprite: SPARE, state: 'making' });
  await d.call('POST', '/spares', { sprite: SPARE, state: 'ready', url: SPARE_URL });
  const code = (await d.call('POST', '/invite', { drive: 'irene', sprite: 't-irene' })).data.code;
  const irene = (await d.call('POST', '/identity', { provider: 'google', subject: 'i', email: 'i@example.com', name: 'Irene', invite: code })).data.account;
  const claimed = (await d.call('POST', '/drive', { account: irene.id })).data.drive;
  assert.equal(claimed.sprite, 't-irene');
  const ana = await member(d, 'ana');
  assert.equal((await d.call('POST', '/drive', { account: ana.id, name: 'pc-ana' })).status, 400);
  assert.equal((await d.call('GET', '/spares')).data.spares.length, 1, 'still there');
  await d.call('POST', '/drive', { account: ana.id, name: 'ana' });
  assert.equal((await d.call('GET', '/spares')).data.room, 0, 'no room left, so no spare is wanted');
});

test('Directory: a spare that could not be handed over goes back as failed, and its drive back to the queue', async () => {
  const d = dir();
  await d.call('POST', '/spares', { sprite: SPARE, state: 'making' });
  await d.call('POST', '/spares', { sprite: SPARE, state: 'ready', url: SPARE_URL });
  const ana = await member(d, 'ana');
  await d.call('POST', '/drive', { account: ana.id, name: 'ana' });
  await d.call('POST', '/drives/ana/step', { step: 'name', state: 'now' });
  assert.equal((await d.call('POST', '/drives/ana/unspare')).status, 200);
  const drive = (await d.call('GET', '/drives/ana')).data;
  assert.equal(drive.state, 'queued');
  assert.equal(drive.sprite, 'd-ana');
  assert.equal(drive.spare, null);
  assert.deepEqual(drive.steps, {});
  const [spare] = (await d.call('GET', '/spares')).data.spares;
  assert.equal(spare.state, 'failed');
  assert.equal(spare.failedFor, 'ana');
  assert.equal((await d.call('POST', '/drives/ana/unspare')).status, 409);
  assert.equal((await d.call('DELETE', `/spares/${SPARE}`)).status, 200);
  assert.deepEqual((await d.call('GET', '/spares')).data.spares, []);
  assert.equal((await d.call('DELETE', `/spares/${SPARE}`)).status, 404);
});

test('Directory: a drive handed a spare keeps its invite’s credit, minted under the drive’s name', async () => {
  const d = dir();
  await d.call('POST', '/spares', { sprite: SPARE, state: 'making' });
  await d.call('POST', '/spares', { sprite: SPARE, state: 'ready', url: SPARE_URL });
  const code = (await d.call('POST', '/invite', { uses: 1, credit: 7 })).data.code;
  const ana = (await d.call('POST', '/identity', { provider: 'google', subject: 'ana', email: 'ana@example.com', name: 'ana', invite: code })).data.account;
  await d.call('POST', '/drive', { account: ana.id, name: 'ana' });
  const [job] = (await d.call('GET', '/queue')).data.drives;
  assert.equal(job.spare.sprite, SPARE);
  assert.equal(job.credit, undefined, 'no credit rides on the queue: the door sprite mints it');
  const minted = await d.call('POST', '/credit/ana/token', {});
  assert.equal(minted.data.credit.name, 'ana');
  assert.equal(minted.data.credit.cap, 7, 'the invite’s amount, on the spare as on a drive made from nothing');
  assert.equal((await d.call('GET', `/credit/${SPARE}`)).status, 404, 'nothing under the spare’s sprite name');
});

// ------------------------------------------------------------ the provisioner

async function door({ names = [], spare = null, vars = {} } = {}) {
  const env = doorEnv(vars);
  const google = { sub: '1', email: 'ana@example.com', name: 'Ana Lima' };
  const fake = fakeProviders({ google });
  fake.setNonce = (n) => {
    google.nonce = n;
  };
  const reached = [];
  const fetchImpl = (input, init) => {
    const href = String(input instanceof Request ? input.url : input);
    if (/\.sprites\.app\//.test(href)) {
      reached.push(href);
      return Promise.resolve(new Response('a drive', { status: 200 }));
    }
    if (href.startsWith('https://door-sprite.example')) return Promise.resolve(new Response('', { status: 202 }));
    return href.startsWith('https://marbledrive.app/') ? route(new Request(input, init), env, { fetchImpl: fake.fetchImpl }) : fake.fetchImpl(input, init);
  };
  const admin = async (method, path, body) =>
    (await fetchImpl(`https://marbledrive.app/_door${path}`, { method, headers: { authorization: `Bearer ${env.DOOR_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
  if (spare) {
    await admin('POST', '/spares', { sprite: spare, state: 'making' });
    await admin('POST', '/spares', { sprite: spare, state: 'ready', url: SPARE_URL });
  }
  const people = [];
  const signUp = async (name, i = people.length) => {
    const code = (await admin('POST', '/invite', {})).link.split('/join/')[1];
    google.sub = String(i + 1);
    const b = browser(env, { fetchImpl, ip: `198.51.100.${i + 1}` });
    await signInWith(b, 'google', { invite: code, fake });
    const made = await b.form('/name', { name });
    assert.equal(made.status, 303);
    people.push(b);
    return b;
  };
  for (const name of names) await signUp(name);
  return { env, fetchImpl, admin, signUp, people, reached, google, fake };
}

const provisioner = (d, run, opts = {}) =>
  createProvisioner({ directoryUrl: 'https://marbledrive.app', adminToken: d.env.DOOR_ADMIN_TOKEN, fetchImpl: d.fetchImpl, log: quiet, run, ...opts });

test('spares are off unless MARBLE_SPARE_DRIVES turns them on, and then there is one', () => {
  assert.equal(SPARE_DRIVES, 1);
  for (const off of [undefined, '', '0', 'off', 'no', 'false']) assert.equal(sparesWanted(off), 0, String(off));
  assert.equal(sparesWanted('1'), 1);
  assert.equal(sparesWanted('on'), SPARE_DRIVES);
  assert.equal(sparesWanted('2'), 2);
  assert.equal(sparesWanted('40'), 3, 'at most three');
});

test('handing out: the spare is named and started, reported in two steps, and her address reaches it', async () => {
  const d = await door({ spare: SPARE });
  const ana = await d.signUp('ana');
  const opening = await (await ana.go('/making/ana')).text();
  assert.match(opening, /Opening <span class="addr">ana\.marbledrive\.app<\/span>/);
  assert.match(opening, /A few seconds\./);
  assert.match(opening, /Giving it your name/);
  assert.doesNotMatch(opening, /Making its machine|close this tab/);

  const seen = [];
  const p = provisioner(d, async (job, onLine) => {
    seen.push(job);
    await onLine('step: name now');
    const mid = await (await ana.go('/making/ana.json')).json();
    assert.deepEqual(mid, { state: 'making', spare: true, steps: { name: 'now', start: 'wait' }, failed: null });
    for (const line of ['step: name done', 'step: start now', 'MARBLE_DRIVE_SECRET=nope', 'step: start done', `url: ${SPARE_URL}`]) await onLine(line);
    return 0;
  });
  assert.deepEqual(await p.once(), { made: 'ana', spare: SPARE });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'handout');
  assert.equal(seen[0].sprite, SPARE);
  assert.equal(seen[0].name, 'ana');
  assert.deepEqual(seen[0].settings, {});
  const drive = (await d.admin('GET', '/drives')).drives[0];
  assert.equal(drive.state, 'ready');
  assert.equal(drive.sprite, SPARE);
  assert.equal(drive.homes.fly, SPARE_URL);
  assert.ok(!JSON.stringify(await d.admin('GET', '/log')).includes('nope'));

  // The Opening page's next look sees ready; the tab goes in through /enter
  // and the router sends ana.marbledrive.app to the spare's sprite.
  assert.equal((await (await ana.go('/making/ana.json')).json()).state, 'ready');
  const enter = await ana.go('/enter?drive=ana&to=%2F');
  assert.equal(enter.status, 302);
  const grant = await ana.go(enter.headers.get('location'));
  assert.equal(grant.status, 302);
  const home = await ana.go('https://ana.marbledrive.app/');
  assert.equal(home.status, 200);
  assert.deepEqual(d.reached, [`${SPARE_URL}/`]);
});

test('handing out fails: the drive is made from nothing instead, and the spare is kept as failed', async () => {
  const d = await door({ spare: SPARE });
  const ana = await d.signUp('ana');
  const jobs = [];
  const p = provisioner(d, async (job, onLine) => {
    jobs.push(job.kind);
    if (job.kind === 'handout') {
      await onLine('step: name now');
      return 1;
    }
    for (const line of ['step: machine now', 'step: machine done', 'step: install now', 'step: install done', 'step: check now', 'step: check done', 'url: https://d-ana-abc.sprites.app']) await onLine(line);
    return 0;
  });
  assert.deepEqual(await p.once(), { requeued: 'ana', spare: SPARE });
  const back = await (await ana.go('/making/ana.json')).json();
  assert.equal(back.spare, false, 'the page reloads as the three-step one');
  assert.match(await (await ana.go('/making/ana')).text(), /Making your drive[\s\S]*takes a few minutes/);
  assert.deepEqual(await p.drain(), { idle: true });
  assert.deepEqual(jobs, ['handout', 'drive']);
  const drive = (await d.admin('GET', '/drives')).drives[0];
  assert.equal(drive.state, 'ready');
  assert.equal(drive.sprite, 'd-ana');
  assert.equal(drive.homes.fly, 'https://d-ana-abc.sprites.app');
  const { spares } = await d.admin('GET', '/spares');
  assert.deepEqual(spares.map((s) => [s.sprite, s.state]), [[SPARE, 'failed']]);
});

test('no spare ready: the three-step page, and today’s full provisioning', async () => {
  const d = await door({ names: ['ana'] });
  const page = await (await d.people[0].go('/making/ana')).text();
  assert.match(page, /Making your drive/);
  assert.match(page, /Making its machine/);
  assert.match(page, /This takes a few minutes\. You can close this tab/);
  const kinds = [];
  const p = provisioner(d, async (job, onLine) => {
    kinds.push(job.kind);
    await onLine('url: https://d-ana-abc.sprites.app');
    return 0;
  });
  assert.deepEqual(await p.once(), { made: 'ana' });
  assert.deepEqual(kinds, ['drive']);
});

test('making spares: one when on, beside the queue, never while one has failed or the door is full', async () => {
  const d = await door();
  const names = ['d-spare-0000aaaa', 'd-spare-0000bbbb'];
  const made = [];
  const run = async (job, onLine) => {
    made.push(job);
    await onLine('step: machine now');
    await onLine(`url: https://${job.sprite}-x.sprites.app`);
    return 0;
  };
  // Off: nothing is made.
  assert.deepEqual(await provisioner(d, run).topUp(), { off: true });
  assert.equal(made.length, 0);

  const p = provisioner(d, run, { spares: 1, spareName: () => names.shift() });
  assert.deepEqual(await p.topUp(), { spare: 'd-spare-0000aaaa' });
  assert.deepEqual(made.map((j) => [j.kind, j.sprite]), [['spare', 'd-spare-0000aaaa']]);
  let { spares } = await d.admin('GET', '/spares');
  assert.deepEqual(spares.map((s) => [s.sprite, s.state, s.url]), [['d-spare-0000aaaa', 'ready', 'https://d-spare-0000aaaa-x.sprites.app']]);
  assert.deepEqual(await p.topUp(), { enough: true }, 'one is enough');

  // Handed out: the next one is made.
  await d.signUp('ana');
  assert.equal((await d.admin('GET', '/drives')).drives[0].sprite, 'd-spare-0000aaaa');
  const p2 = provisioner(d, async (job, onLine) => {
    if (job.kind === 'spare') return 1;
    await onLine(`url: ${SPARE_URL}`);
    return 0;
  }, { spares: 1, spareName: () => names.shift() });
  await p2.work();
  for (let i = 0; i < 50 && p2.busy(); i += 1) await new Promise((r) => setTimeout(r, 5));
  ({ spares } = await d.admin('GET', '/spares'));
  assert.deepEqual(spares.map((s) => [s.sprite, s.state]), [['d-spare-0000bbbb', 'failed']], 'that one failed');
  assert.deepEqual(await p2.topUp(), { blocked: true }, 'and no other is made until Bryan has looked');
  await d.admin('DELETE', '/spares/d-spare-0000bbbb');

  // Full: no spare is made that could never be given out.
  const tiny = doorEnv({ maxDrives: '0' });
  const fetchTiny = (input, init) => route(new Request(input, init), tiny);
  const p3 = createProvisioner({ directoryUrl: 'https://marbledrive.app', adminToken: tiny.DOOR_ADMIN_TOKEN, fetchImpl: fetchTiny, log: quiet, run, spares: 1 });
  assert.deepEqual(await p3.topUp(), { full: true });
});

test('a spare left `making` by a door sprite that stopped is marked failed after a while', async () => {
  const d = await door();
  await d.admin('POST', '/spares', { sprite: 'd-spare-0000cccc', state: 'making' });
  const later = Date.now() + SPARE_STALE_MS + 1000;
  const p = provisioner(d, async () => 0, { spares: 1, now: () => later });
  assert.deepEqual(await p.topUp(), { blocked: true });
  const { spares } = await d.admin('GET', '/spares');
  assert.equal(spares[0].state, 'failed');
});

test('a sign-up while a spare is being made is not held up behind it', async () => {
  const d = await door();
  let release;
  const order = [];
  const p = provisioner(d, async (job, onLine) => {
    order.push(`${job.kind} start`);
    if (job.kind === 'spare') await new Promise((r) => (release = r));
    await onLine(`url: https://${job.sprite ?? job.name}-x.sprites.app`);
    order.push(`${job.kind} end`);
    return 0;
  }, { spares: 1, spareName: () => 'd-spare-0000dddd' });
  const sparing = p.topUp();
  await new Promise((r) => setTimeout(r, 10));
  await d.signUp('ana');
  assert.deepEqual(await p.drain(), { idle: true });
  assert.deepEqual(order, ['spare start', 'drive start', 'drive end']);
  assert.equal(p.busy(), true, 'still making the spare');
  release();
  assert.deepEqual(await sparing, { spare: 'd-spare-0000dddd' });
});

test('a job’s settings reach the script in a private file; nothing when there are none', async () => {
  const base = { script: '/s.sh', keysFile: '/k', org: 'o' };
  assert.deepEqual(scriptArgs({ kind: 'spare', sprite: SPARE }, base), ['/s.sh', '--spare', SPARE, '--keys', '/k', '--org', 'o']);
  assert.deepEqual(scriptArgs({ kind: 'handout', name: 'ana', account: 'a1', sprite: SPARE }, { ...base, settingsFile: '/f' }), ['/s.sh', '--door', 'ana', '--from-spare', SPARE, '--account', 'a1', '--keys', '/k', '--org', 'o', '--settings', '/f']);
  assert.deepEqual(scriptArgs({ name: 'ana', account: 'a1' }, base), ['/s.sh', '--door', 'ana', '--account', 'a1', '--keys', '/k', '--org', 'o']);

  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  let file = null;
  let content = null;
  const fakeSpawn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const at = args.indexOf('--settings');
    file = at > 0 ? args[at + 1] : null;
    if (file) content = { text: fs.readFileSync(file, 'utf8'), mode: fs.statSync(file).mode & 0o777 };
    setImmediate(() => {
      child.stdout.end('url: https://x.sprites.app\n');
      child.stderr.end('');
      setTimeout(() => child.emit('close', 0), 5);
    });
    return child;
  };
  const run = scriptRunner({ script: '/s.sh', keysFile: '/k', spawnImpl: fakeSpawn, log: quiet });
  assert.equal(await run({ kind: 'handout', name: 'ana', account: 'a1', sprite: SPARE, settings: { MARBLE_CREDIT_URL: 'https://marbledrive.app/_credit', MARBLE_CREDIT_TOKEN: 'tok' } }, async () => {}), 0);
  assert.equal(content.text, 'MARBLE_CREDIT_URL=https://marbledrive.app/_credit\nMARBLE_CREDIT_TOKEN=tok\n');
  assert.equal(content.mode, 0o600);
  assert.equal(fs.existsSync(file), false, 'removed when the script ends');
  assert.equal(await run({ name: 'ana', account: 'a1', settings: { MARBLE_DRIVE_SECRET: 'x' } }, async () => {}), 2, 'only MARBLE_CREDIT_* settings');
  assert.equal(await run({ name: 'ana', account: 'a1', settings: { MARBLE_CREDIT_TOKEN: 'a,b' } }, async () => {}), 2, 'no comma');

  file = null;
  assert.equal(await run({ name: 'ana', account: 'a1', settings: {} }, async () => {}), 0);
  assert.equal(file, null, 'no settings, no --settings');
});

test('a spare handed over with starter credit on gets the token minted for her drive, in its settings file', async () => {
  const d = await door({ spare: SPARE, vars: { CREDIT_ANTHROPIC_KEY: 'sk-ant-owner' } });
  await d.signUp('ana');
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  let during = null;
  const fakeSpawn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const file = args[args.indexOf('--settings') + 1];
    during = { args, file, text: fs.readFileSync(file, 'utf8'), mode: fs.statSync(file).mode & 0o777 };
    setImmediate(() => {
      child.stdout.end(`step: name now\nstep: name done\nstep: start now\nstep: start done\nurl: ${SPARE_URL}\n`);
      child.stderr.end('');
      setTimeout(() => child.emit('close', 0), 5);
    });
    return child;
  };
  const run = scriptRunner({ script: '/s.sh', keysFile: '/k', spawnImpl: fakeSpawn, log: quiet });
  const p = provisioner(d, run, { settingsFor: () => ({ MARBLE_CREDIT_NOTE: 'kept' }) });
  assert.deepEqual(await p.once(), { made: 'ana', spare: SPARE });

  assert.deepEqual(during.args.slice(0, 5), ['/s.sh', '--door', 'ana', '--from-spare', SPARE]);
  assert.ok(during.args.includes('--settings'));
  const token = /^MARBLE_CREDIT_TOKEN=(mdc_[0-9a-f]{48})$/m.exec(during.text)?.[1];
  assert.ok(token, during.text);
  assert.match(during.text, /^MARBLE_CREDIT_URL=https:\/\/marbledrive\.app\/_credit$/m);
  assert.match(during.text, /^MARBLE_CREDIT_NOTE=kept$/m, 'merged with what settingsFor gives');
  assert.ok(!during.args.join(' ').includes(token), 'never in argv');
  assert.equal(during.mode, 0o600);
  assert.equal(fs.existsSync(during.file), false, 'removed when the script ends');

  // The token is the drive's, under her drive's name, and the proxy knows it.
  const headers = { authorization: `Bearer ${d.env.DOOR_ADMIN_TOKEN}` };
  const listed = await (await d.fetchImpl('https://marbledrive.app/_credit/admin/drives', { headers })).json();
  assert.deepEqual(listed.drives.map((c) => c.name), ['ana']);
  const balance = await d.fetchImpl('https://marbledrive.app/_credit/balance', { headers: { 'x-api-key': token } });
  assert.equal(balance.status, 200);
  assert.equal((await balance.json()).cap, 5);
});

test('no credit is minted for a spare made ahead, even with starter credit on', async () => {
  const d = await door({ vars: { CREDIT_ANTHROPIC_KEY: 'sk-ant-owner' } });
  const jobs = [];
  const p = provisioner(d, async (job, onLine) => {
    jobs.push(job);
    await onLine(`url: ${SPARE_URL}`);
    return 0;
  }, { spares: 1, spareName: () => SPARE });
  assert.deepEqual(await p.topUp(), { spare: SPARE });
  assert.equal(jobs[0].kind, 'spare');
  assert.equal(jobs[0].settings, undefined);
  const listed = await (await d.fetchImpl('https://marbledrive.app/_credit/admin/drives', { headers: { authorization: `Bearer ${d.env.DOOR_ADMIN_TOKEN}` } })).json();
  assert.deepEqual(listed.drives, []);
});

// ------------------------------------------------------------ the pages

test('Name your drive is filled from her name, skipping one that is taken, and the button opens it', async () => {
  const d = await door();
  d.google.name = 'Ana Lima';
  await d.signUp('ana');
  const code = (await d.admin('POST', '/invite', {})).link.split('/join/')[1];
  d.google.sub = '77';
  const b = browser(d.env, { fetchImpl: d.fetchImpl, ip: '198.51.100.77' });
  await signInWith(b, 'google', { invite: code, fake: d.fake });
  const page = await (await b.go('/name')).text();
  assert.match(page, /value="ana-lima"/, 'ana is taken, so the next one');
  assert.match(page, /data-ok="yes">Free\. You can’t change it later\.</);
  assert.match(page, /<button class="btn one" type="submit">Open my drive<\/button>/);
  assert.doesNotMatch(page, /Make my drive/);
});

test('with no name to go on, the field waits empty', () => {
  const html = pages.nameDrive({});
  return html.text().then((t) => {
    assert.match(t, /value=""/);
    assert.match(t, /placeholder="yourname"/);
  });
});

test('the Opening page: two steps, no button, and a script that moves the tab when ready', async () => {
  const spare = { sprite: SPARE, url: SPARE_URL };
  const opening = await pages.making({ drive: { name: 'ana', state: 'queued', spare, steps: {} } }).text();
  assert.match(opening, /<title>Opening your drive · Marble Drive<\/title>/);
  assert.match(opening, /<li data-step="name" data-state="now">.*Giving it your name/);
  assert.match(opening, /<li data-step="start" data-state="wait">.*Starting it/);
  assert.equal((opening.match(/<li data-step=/g) ?? []).length, 2);
  assert.doesNotMatch(opening, /btn one|close this tab|few minutes/);
  assert.match(opening, /data-enter="\/enter\?drive=ana&amp;to=%2F"/);
  assert.match(opening, /location\.replace\(card\.dataset\.enter\)/);
  assert.match(opening, /!j\.spare\) return location\.reload\(\)/, 'a fallback reloads as the three-step page');

  const starting = await pages.making({ drive: { name: 'ana', state: 'making', spare, steps: { name: 'done', start: 'now' } } }).text();
  assert.match(starting, /data-step="name" data-state="done"/);
  assert.match(starting, /data-step="start" data-state="now"/);

  // Ready, if it is ever loaded that way: the ready page, with its two steps done.
  const ready = await pages.making({ drive: { name: 'ana', state: 'ready', spare, steps: { name: 'done', start: 'done' } } }).text();
  assert.match(ready, /Your drive is ready/);
  assert.match(ready, /Giving it your name/);
  assert.match(ready, /href="\/enter\?drive=ana&amp;to=%2F">Open my drive/);

  const three = await pages.making({ drive: { name: 'ana', state: 'queued', steps: {} } }).text();
  assert.equal((three.match(/<li data-step=/g) ?? []).length, 3);
  assert.match(three, /This takes a few minutes\. You can close this tab/);
  assert.match(three, /Open my drive/);
  assert.deepEqual(pages.stepStates({ state: 'queued', spare, steps: {} }), { name: 'now', start: 'wait' });
  assert.deepEqual(pages.stepStates({ state: 'queued', steps: {} }), { machine: 'now', install: 'wait', check: 'wait' });
});
