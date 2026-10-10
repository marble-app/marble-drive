// test/door-apex.test.js
// The door's routes at marbledrive.app (worker/src/door/apex.js), through the
// router as the Worker runs them, with a Directory in memory and fakes for
// Google, GitHub and the door sprite.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { forgetLeases, route } from '../worker/src/router.js';
import { importVerifyKey, verify } from '../worker/src/door/tokens.js';
import { browser, signInWith } from './fixtures/door-browser.js';
import { doorEnv, fakeProviders } from './fixtures/door-env.js';

beforeEach(() => forgetLeases());

function world(vars = {}) {
  const env = doorEnv(vars);
  const google = { sub: '1100000000000001', email: 'ana@example.com', name: 'Ana' };
  const github = { id: 4242, emails: [{ email: 'bob@example.com', primary: true, verified: true }] };
  const fake = fakeProviders({ google, github });
  const pokes = [];
  const fetchImpl = async (input, init = {}) => {
    const href = String(input);
    if (href.startsWith('https://door-sprite.example')) {
      pokes.push({ href, headers: new Headers(init.headers) });
      return new Response('', { status: 202 });
    }
    return fake.fetchImpl(input, init);
  };
  fake.setNonce = (n) => {
    google.nonce = n;
  };
  const adminCall = async (method, path, body) => {
    const res = await route(new Request(`https://marbledrive.app/_door${path}`, {
      method,
      headers: { authorization: `Bearer ${env.DOOR_ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { fetchImpl });
    return { status: res.status, data: await res.json() };
  };
  const invite = async (opts = {}) => {
    const r = await adminCall('POST', '/invite', { note: 'test', ...opts });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.link.split('/join/')[1];
  };
  return { env, google, github, fake, fetchImpl, pokes, adminCall, invite, b: (opts = {}) => browser(env, { fetchImpl, ...opts }) };
}

const text = async (res) => res.text();

test('signed out, / shows both ways in and no greeting', async () => {
  const w = world();
  const res = await w.b().go('/');
  assert.equal(res.status, 200);
  const body = await text(res);
  assert.match(body, /Continue with Google/);
  assert.match(body, /Continue with GitHub/);
  assert.match(body, /You need an invite link from Bryan/);
  assert.doesNotMatch(body, /welcome/i);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('without the door switched on, the apex is the placeholder', async () => {
  const w = world({ DOOR_SIGNING_KEY: '' });
  const body = await text(await w.b().go('/'));
  assert.match(body, /Coming soon/);
});

test('an invite, Google, a name, and the drive is queued; the door sprite is poked', async () => {
  const w = world({ DOOR_SPRITE_URL: 'https://door-sprite.example', SPRITES_TOKEN: 'sprites-token' });
  const code = await w.invite();
  const b = w.b();
  const join = await b.go(`/join/${code}`);
  assert.equal(join.status, 200);
  const page = await text(join);
  assert.match(page, /Bryan invited you/);
  assert.ok(page.includes(`/auth/google/start?invite=${code}`));

  const back = await signInWith(b, 'google', { invite: code, fake: w.fake });
  assert.equal(back.status, 303);
  assert.equal(back.headers.get('location'), '/');
  assert.match(back.headers.getSetCookie().join('\n'), /__Host-md_session=[0-9a-f]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000/);
  assert.equal(b.jar('marbledrive.app').has('__Host-md_oauth'), false, 'the round trip cookie is cleared');

  const home = await b.go('/');
  assert.equal(home.headers.get('location'), '/name');
  assert.match(await text(await b.go('/name')), /Name your drive/);

  const check = await (await b.go('/name/check?n=ana')).json();
  assert.deepEqual(check, { ok: true, said: 'ana is free.' });
  assert.equal((await (await b.go('/name/check?n=pc-ana')).json()).ok, false);

  const crossSite = await b.form('/name', { name: 'ana' }, 'https://bob.marbledrive.app');
  assert.equal(crossSite.status, 403);
  const noOrigin = await b.go('/name', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=ana' });
  assert.equal(noOrigin.status, 403);

  const made = await b.form('/name', { name: 'ana' });
  assert.equal(made.status, 303);
  assert.equal(made.headers.get('location'), '/making/ana');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.pokes.length, 1);
  assert.equal(w.pokes[0].href, 'https://door-sprite.example/poke');
  assert.equal(w.pokes[0].headers.get('authorization'), 'Bearer sprites-token');
  assert.equal(w.pokes[0].headers.get('x-door-token'), w.env.DOOR_ADMIN_TOKEN);

  const making = await b.go('/making/ana');
  assert.match(await text(making), /Making your drive/);
  const steps = await (await b.go('/making/ana.json')).json();
  assert.equal(steps.state, 'queued');
  assert.deepEqual(steps.steps, { machine: 'now', install: 'wait', check: 'wait' });
  assert.equal((await b.go('/')).headers.get('location'), '/making/ana');
});

test('a name that is taken or wrong is said in words, and the invite is kept', async () => {
  const w = world();
  const code = await w.invite({ uses: 2 });
  const ana = w.b();
  await signInWith(ana, 'google', { invite: code, fake: w.fake });
  assert.equal((await ana.form('/name', { name: 'garden' })).status, 303);
  const bob = w.b({ ip: '203.0.113.5' });
  await signInWith(bob, 'github', { invite: code });
  assert.deepEqual(await (await bob.go('/name/check?n=garden')).json(), { ok: false, said: 'garden is taken.' });
  const taken = await bob.form('/name', { name: 'garden' });
  assert.equal(taken.status, 409);
  assert.match(await text(taken), /garden is taken/);
  const bad = await bob.form('/name', { name: 'Garden!' });
  assert.equal(bad.status, 400);
  assert.match(await text(bad), /lowercase letters, digits and hyphens/);
  assert.equal((await bob.form('/name', { name: 'bob' })).status, 303);
});

test('a dead invite says which, and offers to sign in and ask', async () => {
  const w = world();
  const code = await w.invite();
  const ana = w.b();
  await signInWith(ana, 'google', { invite: code, fake: w.fake });
  await ana.form('/name', { name: 'ana' });
  const spent = await w.b().go(`/join/${code}`);
  assert.equal(spent.status, 410);
  const body = await text(spent);
  assert.match(body, /This invite has been used/);
  assert.match(body, /ask for access/);
  assert.match(body, /Continue with Google/);
  assert.equal((await w.b().go(`/join/${'0'.repeat(32)}`)).status, 404);
});

test('no invite: open by invitation, Ask for access records it once, and says what it sends', async () => {
  const w = world();
  const b = w.b();
  const back = await signInWith(b, 'github', {});
  assert.equal(back.status, 303);
  assert.equal(back.headers.get('location'), '/ask');
  assert.equal(b.jar('marbledrive.app').has('__Host-md_session'), false, 'no session without an account');
  const page = await text(await b.go('/ask'));
  assert.match(page, /open by invitation for now/);
  assert.match(page, /bob@example\.com/);
  assert.equal((await b.form('/ask', {}, 'https://evil.example')).status, 403);
  const asked = await b.form('/ask', {});
  assert.match(await text(asked), /Bryan will tell you when there’s room/);
  const requests = (await w.adminCall('GET', '/requests')).data.requests;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].email, 'bob@example.com');
  await w.adminCall('POST', '/approve', { request: requests[0].id });
  await signInWith(b, 'github', {});
  assert.equal((await b.go('/')).headers.get('location'), '/name');
});

test('/enter: the owner gets a grant for their drive; anyone else is told it isn’t theirs, and not whose it is', async () => {
  const w = world();
  const code = await w.invite({ uses: 2 });
  const ana = w.b();
  await signInWith(ana, 'google', { invite: code, fake: w.fake });
  await ana.form('/name', { name: 'ana' });
  await w.adminCall('POST', '/drives/ana/step', { state: 'ready', url: 'https://d-ana-abc.sprites.app', sprite: 'd-ana' });

  const res = await ana.go('/enter?drive=ana&to=/a/x');
  assert.equal(res.status, 302);
  const at = new URL(res.headers.get('location'));
  assert.equal(at.origin, 'https://ana.marbledrive.app');
  assert.equal(at.pathname, '/_marble/enter');
  assert.equal(at.searchParams.get('to'), '/a/x');
  const keys = new Map([['k1', await importVerifyKey(w.env.keys.spki)]]);
  const grant = await verify(keys, at.searchParams.get('grant'), { typ: 'grant', drv: 'ana' });
  assert.ok(grant);
  assert.equal(grant.exp - grant.iat, 60);
  assert.match(grant.n, /^[0-9a-f]{32}$/);
  assert.match(res.headers.get('location'), /to=%2Fa%2Fx$/);

  const evil = new URL((await ana.go('/enter?drive=ana&to=//evil.example')).headers.get('location'));
  assert.equal(evil.searchParams.get('to'), '/');

  const bob = w.b({ ip: '203.0.113.5' });
  await signInWith(bob, 'github', { invite: code });
  const refused = await bob.go('/enter?drive=ana&to=/');
  assert.equal(refused.status, 403);
  const body = await text(refused);
  assert.match(body, /That drive isn’t yours/);
  assert.doesNotMatch(body, /ana@example\.com/);
  assert.equal((await bob.go('/enter?drive=nobody&to=/')).status, 403, 'a drive that does not exist reads the same');

  const stranger = await w.b().go('/enter?drive=ana&to=/a/x');
  assert.equal(stranger.status, 200);
  const signIn = await text(stranger);
  assert.match(signIn, /Sign in to open/);
  assert.ok(signIn.includes('/auth/google/start?to=%2Fenter%3Fdrive%3Dana%26to%3D%252Fa%252Fx'), 'the way back rides the round trip');
});

test('starting a sign-in is limited per address, with Retry-After and words', async () => {
  const w = world();
  const b = w.b();
  for (let i = 0; i < 20; i += 1) assert.equal((await b.go('/auth/google/start')).status, 302);
  const slow = await b.go('/auth/google/start');
  assert.equal(slow.status, 429);
  assert.ok(Number(slow.headers.get('retry-after')) > 0);
  assert.match(await text(slow), /Too many tries from here/);
  assert.equal((await w.b({ ip: '203.0.113.99' }).go('/auth/google/start')).status, 302, 'another address is not held up');
});

test('sign out revokes the session and walks the drive’s leave; sign out everywhere ends the others', async () => {
  const w = world();
  const code = await w.invite();
  const one = w.b();
  await signInWith(one, 'google', { invite: code, fake: w.fake });
  await one.form('/name', { name: 'ana' });
  const two = w.b();
  await signInWith(two, 'google', { fake: w.fake });
  assert.equal((await two.go('/account')).status, 200);

  assert.equal((await one.form('/signout', {}, 'https://ana.marbledrive.app')).status, 403);
  const out = await one.form('/signout', {});
  assert.equal(out.status, 303);
  assert.equal(out.headers.get('location'), 'https://ana.marbledrive.app/_marble/leave');
  assert.equal(one.jar('marbledrive.app').has('__Host-md_session'), false);
  assert.equal((await two.go('/account')).status, 200, 'the other browser is still in');

  await signInWith(one, 'google', { fake: w.fake });
  await one.form('/signout/everywhere', {});
  assert.equal((await two.go('/account')).status, 303, 'everywhere means the other browser too');
});

test('without the door sprite, naming a drive says it can’t be made yet, and spends nothing', async () => {
  const w = world({ DOOR_SPRITE_URL: '' });
  const code = await w.invite();
  const b = w.b();
  await signInWith(b, 'google', { invite: code, fake: w.fake });
  const page = await b.go('/name');
  assert.equal(page.status, 503);
  assert.match(await text(page), /Bryan hasn’t switched on making drives/);
  assert.equal((await b.form('/name', { name: 'ana' })).status, 503);
  assert.equal((await w.adminCall('GET', '/drives')).data.drives.length, 0);
});

test('a claim invite hands an existing drive over at sign-in, without a sprite being made', async () => {
  const w = world({ DOOR_SPRITE_URL: 'https://door-sprite.example' });
  const code = await w.invite({ drive: 'irene', sprite: 't-irene' });
  const b = w.b();
  assert.match(await text(await b.go(`/join/${code}`)), /take over/);
  await signInWith(b, 'google', { invite: code, fake: w.fake });
  assert.equal((await b.go('/')).headers.get('location'), '/account');
  const page = await text(await b.go('/account'));
  assert.match(page, /irene\.marbledrive\.app/);
  assert.equal(w.pokes.length, 0);
  const drive = (await w.adminCall('GET', '/drives')).data.drives.find((d) => d.name === 'irene');
  assert.equal(drive.state, 'ready');
  assert.equal(drive.sprite, 't-irene');
});

test('the admin API wants its token, and an invite link is given once', async () => {
  const w = world();
  const res = await route(new Request('https://marbledrive.app/_door/invites'), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(res.status, 401);
  const wrong = await route(new Request('https://marbledrive.app/_door/invites', { headers: { authorization: 'Bearer nope' } }), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(wrong.status, 401);
  const made = await w.adminCall('POST', '/invite', { note: 'Ana' });
  assert.match(made.data.link, /^https:\/\/marbledrive\.app\/join\/[0-9a-f]{32}$/);
  const listed = await w.adminCall('GET', '/invites');
  assert.ok(!JSON.stringify(listed.data).includes(made.data.link.split('/join/')[1]));
  assert.equal((await w.adminCall('POST', '/drive', { account: 'x', name: 'y' })).status, 404, 'only the admin routes');
});

test('www goes to the apex', async () => {
  const w = world();
  const res = await w.b().go('https://www.marbledrive.app/privacy');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://marbledrive.app/privacy');
});
