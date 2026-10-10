// test/door-edge.test.js
// The edge in front of every drive (worker/src/router.js with the door on):
// a drive with an owner is reached only with that owner's pass, which the
// edge mints from a single-use grant and renews while the session lives.
// Strangers are answered by the Worker and never wake the drive.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { forgetLeases, route } from '../worker/src/router.js';
import { importSigningKey, sign } from '../worker/src/door/tokens.js';
import { browser, signInWith } from './fixtures/door-browser.js';
import { doorEnv, fakeProviders } from './fixtures/door-env.js';

beforeEach(() => forgetLeases());

const SPRITE = 'https://d-ana-abc.sprites.app';

/** A door with Ana signed in, owning `ana`, ready on its sprite. */
async function world(vars = {}) {
  const env = doorEnv(vars);
  const google = { sub: '1100000000000001', email: 'ana@example.com', name: 'Ana' };
  const fake = fakeProviders({ google, github: { id: 4242, emails: [{ email: 'bob@example.com', primary: true, verified: true }] } });
  fake.setNonce = (n) => {
    google.nonce = n;
  };
  const upstream = [];
  let clock = Date.now();
  const fetchImpl = async (input, init = {}) => {
    const href = String(input);
    if (href.includes('.sprites.app') || href.includes('-bryan.marbledrive.app')) {
      upstream.push({ href, headers: new Headers(init.headers), method: init.method });
      return new Response('from the drive', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return fake.fetchImpl(input, init);
  };
  const admin = async (method, path, body) => {
    const res = await route(new Request(`https://marbledrive.app/_door${path}`, { method, headers: { authorization: `Bearer ${env.DOOR_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { fetchImpl });
    return res.json();
  };
  const code = (await admin('POST', '/invite', { uses: 3 })).link.split('/join/')[1];
  const ana = browser(env, { fetchImpl, now: () => clock });
  await signInWith(ana, 'google', { invite: code, fake });
  await ana.form('/name', { name: 'ana' });
  await admin('POST', '/drives/ana/step', { state: 'ready', url: SPRITE, sprite: 'd-ana' });
  forgetLeases();
  const enter = async (b, to = '/a/Notes') => {
    const res = await b.go(`/enter?drive=ana&to=${encodeURIComponent(to)}`);
    return res.headers.get('location');
  };
  return {
    env,
    fake,
    fetchImpl,
    upstream,
    admin,
    code,
    ana,
    enter,
    tick: (ms) => {
      clock += ms;
    },
    now: () => clock,
    b: (opts = {}) => browser(env, { fetchImpl, now: () => clock, ...opts }),
  };
}

async function forge(env, payload) {
  const now = Math.floor(Date.now() / 1000);
  const key = await importSigningKey(env.keys.pkcs8);
  return sign(key, 'k1', { typ: 'pass', drv: 'ana', acct: 'x', sid: 'y', role: 'owner', iat: now, exp: now + 3600, ...payload });
}

test('a grant becomes a pass, the address bar is cleaned, and the pass reaches the sprite', async () => {
  const w = await world();
  const grantUrl = await w.enter(w.ana);
  const entered = await w.ana.go(grantUrl);
  assert.equal(entered.status, 302);
  assert.equal(entered.headers.get('location'), '/a/Notes');
  assert.equal(entered.headers.get('referrer-policy'), 'no-referrer');
  assert.match(entered.headers.get('set-cookie'), /^__Host-md_pass=v1\.k1\.[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200$/);
  assert.equal(w.upstream.length, 0, 'the grant is handled at the edge');

  const res = await w.ana.go('https://ana.marbledrive.app/a/Notes');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'from the drive');
  assert.equal(w.upstream.length, 1);
  assert.equal(w.upstream[0].href, `${SPRITE}/a/Notes`);
  assert.equal(w.upstream[0].headers.get('x-forwarded-host'), 'ana.marbledrive.app');
  assert.match(w.upstream[0].headers.get('cookie'), /__Host-md_pass=/, 'the drive checks the same pass');
  assert.equal(w.upstream[0].headers.get('authorization'), null, 'no Sprites token is set, and none is invented');
});

test('the same grant twice: the second is refused', async () => {
  const w = await world();
  const grantUrl = await w.enter(w.ana);
  assert.equal((await w.ana.go(grantUrl)).status, 302);
  const again = await w.b().go(grantUrl);
  assert.equal(again.status, 400);
  assert.match(await again.text(), /That sign-in link has been used/);
  assert.equal(again.headers.get('set-cookie'), null);
});

test('a grant whose `to` leaves the drive comes back to /', async () => {
  const w = await world();
  for (const to of ['//evil.example', '/\\evil', '/%2e//evil']) {
    const grantUrl = new URL(await w.enter(w.ana, '/'));
    grantUrl.searchParams.set('to', to);
    const res = await w.ana.go(grantUrl.href);
    assert.equal(res.headers.get('location'), '/', to);
  }
});

test('a grant for another drive, or one past its minute, is refused', async () => {
  const w = await world();
  const grantUrl = new URL(await w.enter(w.ana));
  const elsewhere = new URL(grantUrl);
  elsewhere.hostname = 'bob.marbledrive.app';
  assert.equal((await w.b().go(elsewhere.href)).status, 404, 'bob has no drive here');
  w.tick(61_000);
  assert.equal((await w.ana.go(grantUrl.href)).status, 400);
});

test('no pass, a forged pass, an expired one, or one for another drive: sent to sign in, and the sprite is never asked', async () => {
  const w = await world();
  const keyless = await (async () => {
    const other = (await import('./fixtures/door-env.js')).edgeKeys();
    const now = Math.floor(Date.now() / 1000);
    return sign(await importSigningKey(other.pkcs8), 'k1', { typ: 'pass', drv: 'ana', acct: 'x', sid: 'y', iat: now, exp: now + 3600 });
  })();
  const ownerId = (await w.admin('GET', '/drives')).drives.find((d) => d.name === 'ana').owner;
  const cookies = [
    null,
    `__Host-md_pass=${keyless}`,
    `__Host-md_pass=${await forge(w.env, { acct: ownerId, exp: Math.floor(Date.now() / 1000) - 5 })}`,
    `__Host-md_pass=${await forge(w.env, { acct: ownerId, drv: 'bob' })}`,
    `__Host-md_pass=${await forge(w.env, { acct: 'ffffffffffffffff' })}`,
    `__Host-md_pass=${await forge(w.env, { acct: ownerId, typ: 'grant', n: 'a'.repeat(32) })}`,
  ];
  for (const cookie of cookies) {
    const res = await route(new Request('https://ana.marbledrive.app/a/Notes?x=1', { headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) } }), w.env, { fetchImpl: w.fetchImpl });
    assert.equal(res.status, 302, String(cookie).slice(0, 30));
    const to = new URL(res.headers.get('location'));
    assert.equal(to.origin, 'https://marbledrive.app');
    assert.equal(to.pathname, '/enter');
    assert.equal(to.searchParams.get('drive'), 'ana');
    assert.equal(to.searchParams.get('to'), '/a/Notes?x=1');
    const api = await route(new Request('https://ana.marbledrive.app/docs', { headers: cookie ? { cookie } : {} }), w.env, { fetchImpl: w.fetchImpl });
    assert.equal(api.status, 401);
  }
  assert.equal(w.upstream.length, 0);
});

test("Ana's pass, presented at Bob's drive, is refused there", async () => {
  const w = await world();
  const bob = w.b({ ip: '203.0.113.5' });
  await signInWith(bob, 'github', { invite: w.code });
  await bob.form('/name', { name: 'bob' });
  await w.admin('POST', '/drives/bob/step', { state: 'ready', url: 'https://d-bob-xyz.sprites.app', sprite: 'd-bob' });
  await w.ana.go(await w.enter(w.ana));
  const anaPass = w.ana.jar('ana.marbledrive.app').get('__Host-md_pass');
  const res = await route(new Request('https://bob.marbledrive.app/', { headers: { accept: 'text/html', cookie: `__Host-md_pass=${anaPass}` } }), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(res.status, 302);
  assert.equal(w.upstream.length, 0);
  assert.equal((await w.ana.go('/enter?drive=bob&to=/')).status, 403, 'and the door will not grant it');
});

test('a pass over an hour old is renewed while its session lives, and cleared once it is revoked', async () => {
  const w = await world();
  await w.ana.go(await w.enter(w.ana));
  const first = w.ana.jar('ana.marbledrive.app').get('__Host-md_pass');
  w.tick(61 * 60 * 1000);
  const renewed = await w.ana.go('https://ana.marbledrive.app/a/Notes');
  assert.equal(renewed.status, 200);
  assert.match(renewed.headers.get('set-cookie') ?? '', /^__Host-md_pass=/);
  assert.notEqual(w.ana.jar('ana.marbledrive.app').get('__Host-md_pass'), first);
  assert.equal(await renewed.text(), 'from the drive', 'the body still comes through');

  await w.ana.form('/signout', {});
  // The leave walk was not followed, so the old pass is still in this jar.
  w.tick(61 * 60 * 1000);
  const after = await w.ana.go('https://ana.marbledrive.app/a/Notes');
  assert.equal(after.status, 302);
  assert.match(after.headers.get('location'), /^https:\/\/marbledrive\.app\/enter\?/);
  assert.match(after.headers.get('set-cookie') ?? '', /^__Host-md_pass=; .*Max-Age=0/);
});

test('share links and a share cookie reach the drive, which judges them', async () => {
  const w = await world();
  const link = await route(new Request('https://ana.marbledrive.app/s/abcDEF123_-', { headers: { accept: 'text/html' } }), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(link.status, 200);
  const page = await route(new Request('https://ana.marbledrive.app/a/Notes', { headers: { accept: 'text/html', cookie: 'marble_share=tok.en' } }), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(page.status, 200);
  const ops = await route(new Request('https://ana.marbledrive.app/ops?app=Notes', { method: 'POST', headers: { cookie: 'a=1; marble_share=tok.en' }, body: '[]' }), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(ops.status, 200);
  assert.deepEqual(w.upstream.map((u) => new URL(u.href).pathname), ['/s/abcDEF123_-', '/a/Notes', '/ops']);
});

test('a script with a bearer passes through for the drive to judge', async () => {
  const w = await world();
  const res = await route(new Request('https://ana.marbledrive.app/docs', { headers: { authorization: 'Bearer the-drives-passphrase' } }), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(w.upstream[0].headers.get('authorization'), 'Bearer the-drives-passphrase');
});

test('leave clears the pass and walks on to the next drive, then home', async () => {
  const w = await world();
  const res = await route(new Request('https://ana.marbledrive.app/_marble/leave?then=bob,carol'), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://bob.marbledrive.app/_marble/leave?then=carol');
  assert.match(res.headers.get('set-cookie'), /^__Host-md_pass=; .*Max-Age=0/);
  const last = await route(new Request('https://ana.marbledrive.app/_marble/leave?then=https://evil.example'), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(last.headers.get('location'), 'https://marbledrive.app/');
});

test('a held drive is refused at the edge; one still being made says so', async () => {
  const w = await world();
  await w.admin('POST', '/drives/ana/hold', { on: true });
  forgetLeases();
  const held = await w.ana.go('https://ana.marbledrive.app/');
  assert.equal(held.status, 403);
  assert.match(await held.text(), /on hold/);

  const bob = w.b({ ip: '203.0.113.5' });
  await signInWith(bob, 'github', { invite: w.code });
  await bob.form('/name', { name: 'bob' });
  const grantUrl = (await bob.go('/enter?drive=bob&to=/')).headers.get('location');
  assert.equal(grantUrl, '/making/bob', 'no grant before it is ready');
  assert.equal(w.upstream.length, 0);
});

test('bryan with no owner yet is routed by its lease exactly as before; once claimed, it wants the pass', async () => {
  const w = await world();
  const before = await route(new Request('https://bryan.marbledrive.app/a/x', { headers: { accept: 'text/html' } }), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(before.status, 200);
  assert.equal(w.upstream.at(-1).href, 'https://pc-bryan.marbledrive.app/a/x');

  const claim = (await w.admin('POST', '/invite', { drive: 'bryan', sprite: 'admin-p2' })).link.split('/join/')[1];
  const owner = w.b({ ip: '203.0.113.77' });
  await signInWith(owner, 'github', { invite: claim });
  forgetLeases();
  const n = w.upstream.length;
  const stranger = await route(new Request('https://bryan.marbledrive.app/a/x', { headers: { accept: 'text/html' } }), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(stranger.status, 302);
  assert.equal(w.upstream.length, n);

  await owner.go((await owner.go('/enter?drive=bryan&to=/a/x')).headers.get('location'));
  const res = await owner.go('https://bryan.marbledrive.app/a/x');
  assert.equal(res.status, 200);
  assert.equal(w.upstream.at(-1).href, 'https://pc-bryan.marbledrive.app/a/x', 'still through the lease, to the PC');
});

test('unknown names are still nobody, and the Directory is not asked twice in a row for one', async () => {
  const w = await world();
  const res = await route(new Request('https://nobody-here.marbledrive.app/'), w.env, { fetchImpl: w.fetchImpl });
  assert.equal(res.status, 404);
  assert.match(await res.text(), /No drive lives here/);
});

test('a tunnel name caught by the wildcard goes on to the tunnel as it came', async () => {
  const w = await world();
  const seen = [];
  const res = await route(new Request('https://pc-bryan.marbledrive.app/health', { headers: { cookie: 'marble_drive=x' } }), w.env, {
    fetchImpl: async (req) => {
      seen.push(req);
      return new Response('tunnel');
    },
  });
  assert.equal(await res.text(), 'tunnel');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://pc-bryan.marbledrive.app/health');
  assert.equal(seen[0].headers.get('cookie'), 'marble_drive=x');
});
