// test/door-pchost.test.js
// Other people's drives on the owner's PC, at the front door
// (worker/src/pc-host.js, worker/src/router.js, worker/src/door/): sign-up
// makes a drive on the PC host when NEW_DRIVE_HOME says so, the router sends
// it down the PC host's one tunnel with its name and the host key, a PC that
// can't be reached is said kindly, and the Worker's own check every five
// minutes tells Bryan. The door is the real Worker code over a Directory in
// memory; the PC host and ntfy are fakes.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { createProvisioner } from '../server/provisioner.js';
import { Directory } from '../worker/src/door/directory.js';
import { scheduled } from '../worker/src/index.js';
import { ALERT_EVERY_MS, alertText, checkPcHost, newDriveHome, nextWatch } from '../worker/src/pc-host.js';
import { forgetLeases, route } from '../worker/src/router.js';
import { browser, signInWith } from './fixtures/door-browser.js';
import { doorEnv, fakeProviders, memoryStorage } from './fixtures/door-env.js';

beforeEach(() => forgetLeases());
const quiet = { log() {}, error() {} };

const PC_HOST = 'https://pc-host.marbledrive.app';
const KEY = 'a'.repeat(64);
const PC = { NEW_DRIVE_HOME: 'pchost', PC_HOST_URL: PC_HOST, PC_HOST_KEY: KEY, DOOR_SPRITE_URL: '' };

/** A door with sign-up on the PC host. `pc` answers what reaches the PC
 *  host's tunnel (its router); everything it was sent is in `upstream`. */
async function world(vars = {}, { pc = () => new Response('from the drive', { status: 200, headers: { 'content-type': 'text/html' } }) } = {}) {
  const env = doorEnv({ ...PC, ...vars });
  const google = { sub: '1100000000000001', email: 'ana@example.com', name: 'Ana' };
  const fake = fakeProviders({ google });
  fake.setNonce = (n) => {
    google.nonce = n;
  };
  const upstream = [];
  const pokes = [];
  let reply = pc;
  const fetchImpl = async (input, init = {}) => {
    const href = String(input instanceof Request ? input.url : input);
    if (href.startsWith(`${PC_HOST}/_host/poke`)) {
      pokes.push({ href, method: init.method, headers: new Headers(init.headers) });
      return new Response('{"ok":true}', { status: 202 });
    }
    if (href.startsWith('https://door-sprite.example')) {
      pokes.push({ href, method: init.method, headers: new Headers(init.headers) });
      return new Response('', { status: 202 });
    }
    if (href.startsWith(`${PC_HOST}/`) || href.includes('.sprites.app')) {
      const body = init.body ? await new Response(init.body).text() : null;
      upstream.push({ href, method: init.method, headers: new Headers(init.headers), body });
      return reply(href, init);
    }
    return fake.fetchImpl(input, init);
  };
  const admin = async (method, path, body) => {
    const res = await route(new Request(`https://marbledrive.app/_door${path}`, { method, headers: { authorization: `Bearer ${env.DOOR_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { fetchImpl });
    return { status: res.status, data: await res.json() };
  };
  const invite = async (opts = {}) => (await admin('POST', '/invite', { uses: 5, ...opts })).data.link.split('/join/')[1];
  const code = await invite();
  const ana = browser(env, { fetchImpl });
  await signInWith(ana, 'google', { invite: code, fake });
  return {
    env,
    fake,
    fetchImpl,
    upstream,
    pokes,
    admin,
    invite,
    ana,
    code,
    answer: (fn) => {
      reply = fn;
    },
    b: (opts = {}) => browser(env, { fetchImpl, ...opts }),
    /** Ana's drive named, made by marble-host, and her pass in her jar. */
    async ready() {
      assert.equal((await ana.form('/name', { name: 'ana' })).status, 303);
      assert.equal((await admin('POST', '/drives/ana/step', { state: 'ready', home: 'pchost' })).status, 200);
      forgetLeases();
      const grant = (await ana.go('/enter?drive=ana&to=%2Fa%2FNotes')).headers.get('location');
      assert.equal((await ana.go(grant)).status, 302);
      upstream.length = 0;
    },
  };
}

// ------------------------------------------------------------ sign-up

test('NEW_DRIVE_HOME: pchost when it says so, fly when unset or anything else', () => {
  assert.equal(newDriveHome({}), 'fly');
  assert.equal(newDriveHome({ NEW_DRIVE_HOME: '' }), 'fly');
  assert.equal(newDriveHome({ NEW_DRIVE_HOME: 'fly' }), 'fly');
  assert.equal(newDriveHome({ NEW_DRIVE_HOME: 'pchost' }), 'pchost');
  assert.equal(newDriveHome({ NEW_DRIVE_HOME: ' PCHost ' }), 'pchost');
  assert.equal(newDriveHome({ NEW_DRIVE_HOME: 'pc-host' }), 'fly');
});

test('on the PC host, naming a drive needs no door sprite, makes the PC record, and pokes the PC host with its key alone', async () => {
  const w = await world({ SPRITES_TOKEN: 'sprites-token', CREDIT_ANTHROPIC_KEY: 'sk-ant-owner' });
  const page = await w.ana.go('/name');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Name your drive/);
  const made = await w.ana.form('/name', { name: 'ana' });
  assert.equal(made.status, 303);
  assert.equal(made.headers.get('location'), '/making/ana');
  await new Promise((r) => setTimeout(r, 0));

  const drive = (await w.admin('GET', '/drives')).data.drives.find((d) => d.name === 'ana');
  const stored = w.env.storage.map.get('drive:ana');
  assert.equal(stored.home, 'pchost');
  assert.deepEqual(stored.homes, { pchost: true });
  assert.equal(stored.sprite, null);
  assert.equal(stored.credit, 0, 'no starter credit on the PC host');
  assert.equal(stored.state, 'queued');
  assert.equal(drive.home, 'pchost');
  assert.equal(drive.spare, null);

  assert.equal(w.pokes.length, 1);
  const [poke] = w.pokes;
  assert.equal(poke.href, `${PC_HOST}/_host/poke`);
  assert.equal(poke.method, 'POST');
  assert.equal(poke.headers.get('x-marble-host-key'), KEY);
  assert.equal(poke.headers.get('authorization'), null, 'never the Sprites token');
  assert.equal(poke.headers.get('x-door-token'), null, 'never the admin token');
  assert.equal(poke.headers.get('x-marble-drive'), null);

  const steps = await (await w.ana.go('/making/ana.json')).json();
  assert.equal(steps.state, 'queued');
  assert.deepEqual(steps.steps, { machine: 'now', install: 'wait', check: 'wait' });
});

test('on the PC host, a ready spare is not taken, and an invite’s credit is not given', async () => {
  const w = await world();
  await w.admin('POST', '/spares', { sprite: 'd-spare-3fa9c1d2', state: 'making' });
  await w.admin('POST', '/spares', { sprite: 'd-spare-3fa9c1d2', state: 'ready', url: 'https://d-spare-3fa9c1d2-x.sprites.app' });
  const code = await w.invite({ credit: 20 });
  const bob = w.b({ ip: '203.0.113.5' });
  await signInWith(bob, 'github', { invite: code });
  assert.equal((await bob.form('/name', { name: 'bob' })).status, 303);
  const stored = w.env.storage.map.get('drive:bob');
  assert.equal(stored.credit, 0);
  assert.equal(stored.spare, undefined);
  assert.equal(stored.sprite, null);
  assert.equal((await w.admin('GET', '/spares')).data.spares.length, 1, 'the spare is still there for a drive on Fly');
});

test('NEW_DRIVE_HOME=pchost without the PC host’s address or key: drives can’t be made yet, and nothing is made', async () => {
  for (const missing of [{ PC_HOST_KEY: '' }, { PC_HOST_URL: '' }]) {
    const w = await world({ ...missing, DOOR_SPRITE_URL: 'https://door-sprite.example' });
    const page = await w.ana.go('/name');
    assert.equal(page.status, 503);
    assert.match(await page.text(), /Bryan hasn’t switched on making drives/);
    assert.equal((await w.ana.form('/name', { name: 'ana' })).status, 503);
    assert.equal((await w.admin('GET', '/drives')).data.drives.length, 0);
    assert.equal(w.pokes.length, 0);
  }
});

test('NEW_DRIVE_HOME unset: a drive on Fly from the door sprite, exactly as before', async () => {
  const w = await world({ NEW_DRIVE_HOME: undefined, DOOR_SPRITE_URL: 'https://door-sprite.example' });
  assert.equal((await w.ana.form('/name', { name: 'ana' })).status, 303);
  await new Promise((r) => setTimeout(r, 0));
  const stored = w.env.storage.map.get('drive:ana');
  assert.equal(stored.home, undefined, 'the record is the one a Fly drive always had');
  assert.equal(stored.sprite, 'd-ana');
  assert.deepEqual(stored.homes, {});
  assert.deepEqual(w.pokes.map((p) => p.href), ['https://door-sprite.example/poke']);
  assert.equal((await w.admin('GET', '/drives')).data.drives.find((d) => d.name === 'ana').home, 'fly');
});

// ------------------------------------------------------------ the Directory

function dir() {
  const storage = memoryStorage();
  const object = new Directory({ storage }, { MAX_DRIVES: '10' });
  const call = async (method, path, body) => {
    const res = await object.fetch(new Request(`https://directory${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }));
    return { status: res.status, data: await res.json() };
  };
  return { storage, call };
}

async function member(d, who, invite = {}) {
  const code = (await d.call('POST', '/invite', { uses: 1, ...invite })).data.code;
  return (await d.call('POST', '/identity', { provider: 'google', subject: who, email: `${who}@example.com`, name: who, invite: code })).data.account;
}

test('Directory: a drive on the PC host is ready when marble-host says so, with no sprite URL', async () => {
  const d = dir();
  const ana = await member(d, 'ana');
  const fly = await member(d, 'flo');
  assert.equal((await d.call('POST', '/drive', { account: ana.id, name: 'ana', home: 'pchost' })).status, 200);
  assert.equal((await d.call('POST', '/drive', { account: fly.id, name: 'flo' })).status, 200);
  assert.equal((await d.call('POST', '/drive', { account: (await member(d, 'mo')).id, name: 'mo', home: 'moon' })).status, 400);

  assert.equal((await d.call('POST', '/drives/ana/step', { step: 'install', state: 'now' })).status, 200);
  assert.equal((await d.call('GET', '/drives/ana')).data.state, 'making');
  const urlStyle = await d.call('POST', '/drives/ana/step', { state: 'ready', url: 'https://d-ana.sprites.app' });
  assert.equal(urlStyle.status, 400, 'a drive on the PC host is not made ready on a sprite');
  assert.match(urlStyle.data.why, /home: pchost/);
  assert.equal((await d.call('POST', '/drives/flo/step', { state: 'ready', home: 'pchost' })).status, 409, 'nor a drive on Fly on the PC');

  assert.equal((await d.call('POST', '/drives/ana/step', { state: 'ready', home: 'pchost' })).status, 200);
  const ready = (await d.call('GET', '/drives/ana')).data;
  assert.equal(ready.state, 'ready');
  assert.equal(ready.home, 'pchost');
  assert.deepEqual(ready.homes, { pchost: true });
  assert.equal(ready.sprite, null);
  assert.deepEqual(ready.steps, { machine: 'done', install: 'done', check: 'done' });
  assert.equal(ready.failed, null);
  const log = (await d.call('GET', '/log')).data.lines;
  assert.ok(log.some((l) => l.kind === 'drive-ready' && l.detail.drive === 'ana' && l.detail.home === 'pchost'));
  assert.ok(log.some((l) => l.kind === 'drive-asked' && l.detail.drive === 'ana' && l.detail.home === 'pchost'));
});

test('Directory: the queue says each drive’s home, and keeps to one home when asked', async () => {
  const d = dir();
  await d.call('POST', '/drive', { account: (await member(d, 'ana')).id, name: 'ana', home: 'pchost' });
  await d.call('POST', '/drive', { account: (await member(d, 'flo')).id, name: 'flo' });
  const all = (await d.call('GET', '/queue')).data.drives;
  assert.deepEqual(all.map((q) => [q.name, q.home]), [['ana', 'pchost'], ['flo', 'fly']]);
  assert.deepEqual((await d.call('GET', '/queue?home=pchost')).data.drives.map((q) => q.name), ['ana']);
  assert.deepEqual((await d.call('GET', '/queue?home=fly')).data.drives.map((q) => q.name), ['flo']);
});

test('the door sprite never makes a drive on the PC host, and marble-host’s maker never one on Fly', async () => {
  const w = await world({ CREDIT_ANTHROPIC_KEY: 'sk-ant-owner' });
  assert.equal((await w.ana.form('/name', { name: 'ana' })).status, 303);
  // A drive asked for while sign-up still made drives on Fly.
  const flyEnv = { ...w.env, NEW_DRIVE_HOME: 'fly', DOOR_SPRITE_URL: 'https://door-sprite.example' };
  const flower = browser(flyEnv, { fetchImpl: w.fetchImpl, ip: '203.0.113.8' });
  await signInWith(flower, 'github', { invite: await w.invite() });
  assert.equal((await flower.form('/name', { name: 'flo' })).status, 303);
  const directoryOf = (env) => (input, init) => route(new Request(input, init), env, { fetchImpl: w.fetchImpl });

  const madeOnFly = [];
  const sprite = createProvisioner({
    directoryUrl: 'https://marbledrive.app',
    adminToken: w.env.DOOR_ADMIN_TOKEN,
    fetchImpl: directoryOf(flyEnv),
    log: quiet,
    run: async (job, onLine) => {
      madeOnFly.push(job.name);
      await onLine('url: https://d-flo-x.sprites.app');
      return 0;
    },
  });
  assert.deepEqual(await sprite.drain(), { idle: true });
  assert.deepEqual(madeOnFly, ['flo'], 'only the drive on Fly');

  const madeOnPc = [];
  const pc = createProvisioner({
    directoryUrl: 'https://marbledrive.app',
    adminToken: w.env.DOOR_ADMIN_TOKEN,
    fetchImpl: directoryOf(w.env),
    log: quiet,
    home: 'pchost',
    spares: 1,
    run: async (job, onLine) => {
      madeOnPc.push({ name: job.name, settings: job.settings });
      for (const line of ['step: machine now', 'step: machine done', 'step: install now', 'step: install done', 'step: check now', 'step: check done']) await onLine(line);
      return 0;
    },
  });
  assert.deepEqual(await pc.once(), { made: 'ana' });
  assert.deepEqual(madeOnPc, [{ name: 'ana', settings: {} }], 'no starter credit settings, though credit is on');
  assert.deepEqual(await pc.topUp(), { off: true }, 'no spares on the PC host');
  const ana = (await w.admin('GET', '/drives')).data.drives.find((d) => d.name === 'ana');
  assert.equal(ana.state, 'ready');
  assert.equal(ana.home, 'pchost');
  const credit = (await (await route(new Request('https://marbledrive.app/_credit/admin/drives', { headers: { authorization: `Bearer ${w.env.DOOR_ADMIN_TOKEN}` } }), w.env, { fetchImpl: w.fetchImpl })).json()).drives;
  assert.deepEqual(credit.map((c) => c.name), ['flo'], 'a token only for the drive on Fly');
});

// ------------------------------------------------------------ the router

test('a ready drive on the PC host goes to PC_HOST_URL whole, with its name and the key, after its pass is checked', async () => {
  const w = await world({ SPRITES_TOKEN: 'sprites-token' });
  await w.ready();
  const res = await w.ana.go('https://ana.marbledrive.app/a/Notes?x=1&y=2', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-marble-drive': 'bob', 'x-marble-host-key': 'guessed', 'x-forwarded-host': 'evil.example', origin: 'https://ana.marbledrive.app' },
    body: '{"hello":1}',
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'from the drive');
  assert.equal(w.upstream.length, 1);
  const [call] = w.upstream;
  assert.equal(call.href, `${PC_HOST}/a/Notes?x=1&y=2`);
  assert.equal(call.method, 'POST');
  assert.equal(call.body, '{"hello":1}');
  assert.equal(call.headers.get('x-marble-drive'), 'ana', 'the browser’s own is replaced');
  assert.equal(call.headers.get('x-marble-host-key'), KEY);
  assert.equal(call.headers.get('x-forwarded-host'), 'ana.marbledrive.app');
  assert.equal(call.headers.get('x-forwarded-proto'), 'https');
  assert.equal(call.headers.get('origin'), 'https://ana.marbledrive.app');
  assert.match(call.headers.get('cookie'), /__Host-md_pass=/, 'the drive checks the pass again');
  assert.equal(call.headers.get('authorization'), null, 'never the Sprites token');
  assert.equal(call.headers.get('host'), null);

  // A script's own bearer goes through for the drive to judge.
  await route(new Request('https://ana.marbledrive.app/docs', { headers: { authorization: 'Bearer the-drives-passphrase' } }), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(w.upstream.at(-1).headers.get('authorization'), 'Bearer the-drives-passphrase');
  assert.equal(w.upstream.at(-1).headers.get('x-marble-host-key'), KEY);
});

test('no pass for a drive on the PC host: sent to sign in, and the PC host never asked', async () => {
  const w = await world();
  await w.ready();
  for (const headers of [{ accept: 'text/html' }, {}, { 'x-marble-host-key': KEY, 'x-marble-drive': 'ana' }]) {
    const res = await route(new Request('https://ana.marbledrive.app/a/Notes', { headers }), w.env, { fetchImpl: w.fetchImpl });
    assert.ok(res.status === 302 || res.status === 401, String(res.status));
  }
  assert.equal(w.upstream.length, 0);
});

test('a path that looks like another host stays on the PC host’s origin', async () => {
  const w = await world();
  await w.ready();
  for (const p of ['//evil.example/x', '/\\evil.example/x', '//evil.example:443/x?y=1']) {
    await w.ana.go(`https://ana.marbledrive.app${p}`);
    assert.equal(new URL(w.upstream.at(-1).href).origin, PC_HOST, p);
  }
});

test('the PC out of reach: “Your drive is resting”, for a page and for a script, never the owner’s commands', async () => {
  const w = await world();
  await w.ready();
  const down = [() => { throw new TypeError('fetch failed'); }, ...[502, 503, 504, 530].map((status) => () => new Response('router says no', { status }))];
  for (const reply of down) {
    w.answer(reply);
    const res = await w.ana.go('https://ana.marbledrive.app/a/Notes');
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '30');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /<h1>Your drive is resting<\/h1><p>Bryan has been told, and your work is safe\.<\/p>/);
    assert.doesNotMatch(body, /drive-home|tools\/|router says no/);

    const api = await w.ana.go('https://ana.marbledrive.app/docs', { headers: { accept: 'application/json' } });
    assert.equal(api.status, 503);
    assert.equal(api.headers.get('retry-after'), '30');
    assert.deepEqual(await api.json(), { error: 'Your drive is resting. Bryan has been told, and your work is safe.', resting: true });
  }
  // Anything else the drive says is its own, and comes back as it is.
  for (const status of [404, 500, 401]) {
    w.answer(() => new Response('the drive said so', { status }));
    const res = await w.ana.go('https://ana.marbledrive.app/a/Nope');
    assert.equal(res.status, status);
    assert.equal(await res.text(), 'the drive said so');
  }
  // So is a 503 in JSON: the drive's apps answer that way when they have no key.
  w.answer(() => Response.json({ error: 'Add an Anthropic key in Settings to use this' }, { status: 503 }));
  const apps = await w.ana.go('https://ana.marbledrive.app/genui/root', { method: 'POST', headers: { accept: 'application/json', origin: 'https://ana.marbledrive.app' }, body: '{}' });
  assert.equal(apps.status, 503);
  assert.deepEqual(await apps.json(), { error: 'Add an Anthropic key in Settings to use this' });
});

test('a drive on the PC host whose address or key has gone from the Worker can’t be found, and nothing is sent', async () => {
  const w = await world();
  await w.ready();
  w.env.PC_HOST_KEY = '';
  const lost = await w.ana.go('https://ana.marbledrive.app/');
  assert.equal(lost.status, 503);
  assert.match(await lost.text(), /Can’t tell where this drive lives/);
  assert.equal(w.upstream.length, 0, 'nothing is sent to the PC host without its key');
});

test('pc-host.marbledrive.app, caught by the wildcard, goes on to its tunnel as it came, with no key added', async () => {
  const w = await world();
  for (const headers of [{}, { 'x-marble-host-key': 'guessed', 'x-marble-drive': 'ana' }]) {
    const seen = [];
    const res = await route(new Request('https://pc-host.marbledrive.app/_host/health', { headers: { cookie: 'a=1', ...headers } }), w.env, {
      fetchImpl: async (req) => {
        seen.push(req);
        return new Response('the tunnel');
      },
    });
    assert.equal(await res.text(), 'the tunnel');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://pc-host.marbledrive.app/_host/health');
    assert.equal(seen[0].headers.get('x-marble-host-key'), headers['x-marble-host-key'] ?? null, 'never the Worker’s key');
    assert.equal(seen[0].headers.get('x-marble-drive'), headers['x-marble-drive'] ?? null);
    assert.equal(seen[0].headers.get('cookie'), 'a=1');
  }
});

test('the drive headers are taken off every request the Worker forwards, wherever its home', async () => {
  const env = doorEnv({ DOOR_SIGNING_KEY: '', lease: { home: 'pc', epoch: 1 } });
  const seen = [];
  await route(new Request('https://bryan.marbledrive.app/', { headers: { 'x-marble-drive': 'ana', 'x-marble-host-key': 'guessed' } }), env, {
    fetchImpl: async (url, init) => {
      seen.push(new Headers(init.headers));
      return new Response('ok');
    },
  });
  assert.equal(seen[0].get('x-marble-drive'), null);
  assert.equal(seen[0].get('x-marble-host-key'), null);
});

// ------------------------------------------------------------ the watch

/** The PC host's health, ntfy, and what was sent to each. */
function watchWorld({ health = () => Response.json({ ok: true, drives: 2, running: 2, release: 'r1' }), ntfy = () => new Response('{}'), vars = {} } = {}) {
  const env = doorEnv({ PC_HOST_URL: PC_HOST, PC_HOST_KEY: KEY, ALERT_NTFY_URL: 'https://ntfy.example/marble-secret-topic', ...vars });
  const asked = [];
  const alerts = [];
  let answerHealth = health;
  let answerNtfy = ntfy;
  const fetchImpl = async (input, init = {}) => {
    const href = String(input);
    if (href === `${PC_HOST}/_host/health`) {
      asked.push({ href, headers: new Headers(init.headers) });
      return answerHealth(init);
    }
    if (href === env.ALERT_NTFY_URL) {
      alerts.push({ method: init.method, body: String(init.body), headers: new Headers(init.headers) });
      return answerNtfy();
    }
    throw new Error(`not faked: ${href}`);
  };
  let clock = Date.parse('2026-10-25T12:00:00Z');
  return {
    env,
    asked,
    alerts,
    health: (fn) => {
      answerHealth = fn;
    },
    ntfy: (fn) => {
      answerNtfy = fn;
    },
    tick: (minutes) => {
      clock += minutes * 60_000;
    },
    check: (opts = {}) => checkPcHost(env, { fetchImpl, now: clock, timeoutMs: 50, ...opts }),
    kept: () => env.storage.map.get('meta:pchost-watch'),
  };
}

const downHealth = () => new Response('', { status: 530 });

test('the watch: one alert when the PC stops answering, then at most one an hour, and one when it is back', async () => {
  const w = watchWorld();
  assert.deepEqual(await w.check(), { ok: true, said: null });
  assert.equal(w.asked[0].headers.get('x-marble-host-key'), KEY);
  assert.equal(w.alerts.length, 0);
  assert.equal(w.kept(), undefined, 'well, and nothing written');

  w.health(downHealth);
  w.tick(5);
  assert.deepEqual(await w.check(), { ok: false, said: 'down' });
  assert.equal(w.alerts.length, 1);
  assert.equal(w.alerts[0].method, 'POST');
  assert.match(w.alerts[0].headers.get('content-type'), /^text\/plain/);
  assert.equal(w.alerts[0].body, 'The PC host isn’t answering (it answered 530). Drives on it show “Your drive is resting”.');

  for (let i = 0; i < 11; i += 1) {
    w.tick(5);
    assert.deepEqual(await w.check(), { ok: false, said: null }, `quiet at ${(i + 2) * 5} min`);
  }
  w.tick(5);
  assert.deepEqual(await w.check(), { ok: false, said: 'down' }, 'an hour after the first');
  assert.equal(w.alerts.length, 2);
  assert.equal(w.alerts[1].body, 'The PC host still isn’t answering, 1 h now (it answered 530).');

  w.health(() => Response.json({ ok: true }));
  w.tick(5);
  assert.deepEqual(await w.check(), { ok: true, said: 'back' });
  assert.equal(w.alerts.length, 3);
  assert.equal(w.alerts[2].body, 'The PC host is answering again, after 1 h 5 min.');
  w.tick(5);
  assert.deepEqual(await w.check(), { ok: true, said: null }, 'said once');
  assert.equal(w.alerts.length, 3);
  assert.equal(w.kept().down, false);
});

test('the watch: no answer in time, a refusal, or a health that says it is not well are each the PC down', async () => {
  for (const [health, words] of [
    [(init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))), 'no answer in 0 s'],
    [() => { throw new TypeError('fetch failed'); }, 'it could not be reached'],
    [() => new Response('nope', { status: 401 }), 'it answered 401'],
    [() => Response.json({ ok: false }), 'it answered, but not that it is well'],
    [() => new Response('<html>'), 'it answered, but not that it is well'],
  ]) {
    const w = watchWorld({ health });
    assert.equal((await w.check()).said, 'down');
    assert.match(w.alerts[0].body, new RegExp(`\\(${words}\\)`));
    assert.equal(w.kept().detail, words);
  }
});

test('the watch: an alert that could not be sent is tried again on the next look; a “back” is owed until it goes', async () => {
  const w = watchWorld({ health: downHealth, ntfy: () => new Response('', { status: 500 }) });
  assert.deepEqual(await w.check(), { ok: false, said: null });
  assert.equal(w.kept().alerted, null);
  w.ntfy(() => new Response('{}'));
  w.tick(5);
  assert.deepEqual(await w.check(), { ok: false, said: 'down' }, 'not an hour away: it was never sent');

  w.health(() => Response.json({ ok: true }));
  w.ntfy(() => { throw new TypeError('ntfy is down'); });
  w.tick(5);
  assert.deepEqual(await w.check(), { ok: true, said: null });
  assert.equal(w.kept().down, true, 'still owed');
  w.ntfy(() => new Response('{}'));
  w.tick(5);
  assert.deepEqual(await w.check(), { ok: true, said: 'back' });
  assert.equal(w.alerts.at(-1).body, 'The PC host is answering again, after 15 min.');
});

test('the watch: no ALERT_NTFY_URL, no alert and nothing kept; no PC host settings, nothing asked', async () => {
  const quietWatch = watchWorld({ health: downHealth, vars: { ALERT_NTFY_URL: undefined } });
  assert.deepEqual(await quietWatch.check(), { ok: false, said: null });
  assert.equal(quietWatch.asked.length, 1);
  assert.equal(quietWatch.alerts.length, 0);
  assert.equal(quietWatch.kept(), undefined);
  for (const vars of [{ PC_HOST_KEY: '' }, { PC_HOST_URL: '' }]) {
    const off = watchWorld({ vars });
    assert.deepEqual(await off.check(), { skipped: true });
    assert.equal(off.asked.length, 0);
  }
});

test('the cron runs the watch and hands it to waitUntil', async () => {
  const waited = [];
  const env = doorEnv({ PC_HOST_URL: '', PC_HOST_KEY: '' });
  const result = await scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, env, { waitUntil: (p) => waited.push(p) });
  assert.equal(waited.length, 1);
  assert.deepEqual(result, { skipped: true });
});

test('nextWatch and alertText: the hour is counted from the last alert that went out', () => {
  const at = Date.parse('2026-10-25T12:00:00Z');
  const first = nextWatch(null, { ok: false, at, detail: 'it answered 502' });
  assert.equal(first.say, 'down');
  assert.equal(first.watch.since, '2026-10-25T12:00:00.000Z');
  const sent = { ...first.watch, alerted: first.watch.checked };
  assert.equal(nextWatch(sent, { ok: false, at: at + ALERT_EVERY_MS - 1, detail: 'x' }).say, null);
  assert.equal(nextWatch(sent, { ok: false, at: at + ALERT_EVERY_MS, detail: 'x' }).say, 'down');
  assert.equal(nextWatch(sent, { ok: true, at: at + 60_000 }).say, 'back');
  assert.equal(nextWatch({ ...first.watch }, { ok: true, at: at + 60_000 }).say, null, 'nothing went out, so no “back”');
  assert.equal(nextWatch(null, { ok: true, at }).say, null);
  assert.equal(alertText('back', { at: at + 2 * 3600_000 + 7 * 60_000, since: first.watch.since }), 'The PC host is answering again, after 2 h 7 min.');
  assert.equal(alertText('down', { at: at + 3 * 3600_000, since: first.watch.since, detail: 'no answer in 10 s' }), 'The PC host still isn’t answering, 3 h now (no answer in 10 s).');
});
