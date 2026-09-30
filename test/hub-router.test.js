// test/hub-router.test.js
// The front door: marbledrive.app names go to wherever the drive's lease says
// it lives; every other hostname is still the lease API behind its token.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { handle, Lease } from '../worker/src/index.js';
import { forgetLeases, LEASE_TTL_MS, route } from '../worker/src/router.js';

beforeEach(() => forgetLeases());

const DRIVES = JSON.stringify({ bryan: { mac: 'https://mac-bryan.marbledrive.app', fly: 'https://admin-p2-b3fwm.sprites.app' } });

// A LEASE binding whose objects answer a GET with the given lease (or fail).
function fakeEnv({ lease = { home: 'mac', epoch: 1, since: 1 }, leaseFails = false, ...vars } = {}) {
  const asked = [];
  return {
    asked,
    DRIVES,
    LEASE_TOKEN: 'secret',
    LEASE: {
      idFromName: (name) => name,
      get: (id) => ({
        fetch: async (req) => {
          asked.push({ id, method: req.method, url: req.url });
          if (leaseFails) throw new Error('storage is down');
          return new Response(JSON.stringify(lease), { headers: { 'content-type': 'application/json' } });
        },
      }),
    },
    ...vars,
  };
}

// An upstream that records what it was sent and answers with `reply`.
function upstream(reply = () => new Response('ok')) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init, headers: new Headers(init.headers) });
    return reply(url, init);
  };
  return { calls, fetchImpl };
}

test('the apex and www are a placeholder, with no drives on it', async () => {
  for (const host of ['marbledrive.app', 'www.marbledrive.app']) {
    const up = upstream();
    const res = await route(new Request(`https://${host}/`), fakeEnv(), { fetchImpl: up.fetchImpl });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /coming soon/i);
    assert.doesNotMatch(body, /bryan/);
    assert.equal(up.calls.length, 0);
  }
});

test('reserved names, unknown names and deeper names are 404', async () => {
  for (const host of ['api.marbledrive.app', 'admin.marbledrive.app', 'mail.marbledrive.app', 'nobody.marbledrive.app', 'x.bryan.marbledrive.app']) {
    const env = fakeEnv();
    const up = upstream();
    const res = await route(new Request(`https://${host}/`), env, { fetchImpl: up.fetchImpl });
    assert.equal(res.status, 404, host);
    assert.match(await res.text(), /No drive lives here/);
    assert.equal(up.calls.length, 0);
    assert.equal(env.asked.length, 0, 'no lease read for a name with no drive');
  }
});

test('a drive at home on the Mac: the request goes there whole, and the answer comes back as it is', async () => {
  const env = fakeEnv();
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: hi\n\n')); c.close(); } });
  const reply = new Response(stream, { status: 201, headers: { 'content-type': 'text/event-stream' } });
  reply.headers.append('set-cookie', 'marble_drive=abc; HttpOnly; Path=/');
  reply.headers.append('set-cookie', 'other=1; Path=/');
  const up = upstream(() => reply);
  const req = new Request('https://bryan.marbledrive.app/agent/send?x=1&y=2', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'marble_drive=abc', 'x-forwarded-host': 'evil.example', origin: 'https://bryan.marbledrive.app' },
    body: '{"hello":1}',
    duplex: 'half',
  });
  const res = await route(req, env, { fetchImpl: up.fetchImpl });

  assert.deepEqual(env.asked, [{ id: 'bryan', method: 'GET', url: 'https://lease/lease/bryan' }]);
  assert.equal(up.calls.length, 1);
  const [call] = up.calls;
  assert.equal(call.url, 'https://mac-bryan.marbledrive.app/agent/send?x=1&y=2');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'manual');
  assert.equal(await new Response(call.init.body).text(), '{"hello":1}');
  assert.equal(call.headers.get('x-forwarded-host'), 'bryan.marbledrive.app');
  assert.equal(call.headers.get('x-forwarded-proto'), 'https');
  assert.equal(call.headers.get('cookie'), 'marble_drive=abc');
  assert.equal(call.headers.get('origin'), 'https://bryan.marbledrive.app');
  assert.equal(call.headers.get('host'), null);
  assert.equal(call.headers.get('authorization'), null, 'the Mac never gets the Sprites token');

  assert.equal(res, reply, 'the upstream response is returned untouched, so its body streams');
  assert.equal(res.status, 201);
  assert.deepEqual(res.headers.getSetCookie(), ['marble_drive=abc; HttpOnly; Path=/', 'other=1; Path=/']);
  assert.equal(await res.text(), 'data: hi\n\n');
});

test('a GET carries no body', async () => {
  const up = upstream();
  await route(new Request('https://bryan.marbledrive.app/'), fakeEnv(), { fetchImpl: up.fetchImpl });
  assert.equal(up.calls[0].init.method, 'GET');
  assert.equal(up.calls[0].init.body, undefined);
});

test('a drive on Fly with a Sprites token: the token is added', async () => {
  const up = upstream();
  const env = fakeEnv({ lease: { home: 'fly', epoch: 2, since: 1 }, SPRITES_TOKEN: 'sprites-token' });
  const res = await route(new Request('https://bryan.marbledrive.app/drive/list?q=1'), env, { fetchImpl: up.fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(up.calls[0].url, 'https://admin-p2-b3fwm.sprites.app/drive/list?q=1');
  assert.equal(up.calls[0].headers.get('authorization'), 'Bearer sprites-token');
  assert.equal(up.calls[0].headers.get('x-forwarded-host'), 'bryan.marbledrive.app');
});

test('a drive on Fly: a client Authorization is never overwritten', async () => {
  const up = upstream();
  const env = fakeEnv({ lease: { home: 'fly', epoch: 2, since: 1 }, SPRITES_TOKEN: 'sprites-token' });
  await route(new Request('https://bryan.marbledrive.app/', { headers: { authorization: 'Bearer mine' } }), env, { fetchImpl: up.fetchImpl });
  assert.equal(up.calls[0].headers.get('authorization'), 'Bearer mine');
});

test('a drive on Fly without a Sprites token: redirect to the sprite, where the owner can sign in', async () => {
  const up = upstream();
  const env = fakeEnv({ lease: { home: 'fly', epoch: 2, since: 1 } });
  const res = await route(new Request('https://bryan.marbledrive.app/a/Console?tab=1'), env, { fetchImpl: up.fetchImpl });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://admin-p2-b3fwm.sprites.app/a/Console?tab=1');
  assert.equal(up.calls.length, 0);
});

test('the Mac out of reach: 503 with the way to move the drive to Fly', async () => {
  for (const reply of [() => { throw new TypeError('fetch failed'); }, () => new Response('', { status: 530 })]) {
    const up = upstream(reply);
    const res = await route(new Request('https://bryan.marbledrive.app/'), fakeEnv(), { fetchImpl: up.fetchImpl });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '30');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.text();
    assert.match(body, /at home on your Mac/);
    assert.match(body, /node tools\/drive-home\.mjs to fly/);
  }
});

test('Fly out of reach: 503, try again', async () => {
  const up = upstream(() => { throw new TypeError('fetch failed'); });
  const env = fakeEnv({ lease: { home: 'fly', epoch: 2, since: 1 }, SPRITES_TOKEN: 't' });
  const res = await route(new Request('https://bryan.marbledrive.app/'), env, { fetchImpl: up.fetchImpl });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '30');
  assert.match(await res.text(), /Fly isn.t answering/);
});

test('a lease that cannot be read, or names no known home: 503', async () => {
  for (const env of [fakeEnv({ leaseFails: true }), fakeEnv({ lease: { home: 'moon', epoch: 1 } })]) {
    const up = upstream();
    const res = await route(new Request('https://bryan.marbledrive.app/'), env, { fetchImpl: up.fetchImpl });
    assert.equal(res.status, 503);
    assert.match(await res.text(), /Can.t tell where this drive lives/);
    assert.equal(up.calls.length, 0);
  }
});

test('handle sends marbledrive.app names to the router without the lease token; the lease API still needs it', async () => {
  const env = fakeEnv();
  const front = await handle(new Request('https://marbledrive.app/'), env);
  assert.equal(front.status, 200);
  assert.match(await front.text(), /coming soon/i);
  const api = await handle(new Request('https://marble-lease.example.workers.dev/lease/bryan'), env);
  assert.equal(api.status, 401);
  const lookalike = await handle(new Request('https://notmarbledrive.app/lease/bryan'), env);
  assert.equal(lookalike.status, 401, 'only marbledrive.app and its subdomains are routed');
});

test('a path that looks like another host never leaves the drive\'s origin', async () => {
  const MAC = 'https://mac-bryan.marbledrive.app';
  const FLY = 'https://admin-p2-b3fwm.sprites.app';
  for (const p of ['//evil.example/x', '/\\evil.example/x', '//evil.example:443/x?y=1']) {
    forgetLeases();
    const mac = upstream();
    await route(new Request(`https://bryan.marbledrive.app${p}`, { headers: { cookie: 'marble_drive=abc' } }), fakeEnv(), { fetchImpl: mac.fetchImpl });
    assert.equal(mac.calls.length, 1, p);
    assert.equal(new URL(mac.calls[0].url).origin, MAC, `${p}: mac`);

    forgetLeases();
    const fly = upstream();
    await route(new Request(`https://bryan.marbledrive.app${p}`), fakeEnv({ lease: { home: 'fly', epoch: 2 }, SPRITES_TOKEN: 'sprites-token' }), { fetchImpl: fly.fetchImpl });
    assert.equal(fly.calls.length, 1, p);
    assert.equal(new URL(fly.calls[0].url).origin, FLY, `${p}: the token goes only to the sprite`);

    forgetLeases();
    const away = upstream();
    const res = await route(new Request(`https://bryan.marbledrive.app${p}`), fakeEnv({ lease: { home: 'fly', epoch: 2 } }), { fetchImpl: away.fetchImpl });
    assert.equal(res.status, 302);
    const location = res.headers.get('location');
    assert.ok(location.startsWith(`${FLY}/`), `${p}: redirected to ${location}`);
    assert.equal(new URL(location).origin, FLY);
    assert.equal(away.calls.length, 0);
  }
});

test('an isolate keeps a lease for a few seconds, then reads it again', async () => {
  const env = fakeEnv();
  const up = upstream();
  const at = (now) => route(new Request('https://bryan.marbledrive.app/'), env, { fetchImpl: up.fetchImpl, now });
  await at(1_000);
  await at(1_000 + LEASE_TTL_MS - 1);
  assert.equal(env.asked.length, 1, 'one read within the TTL');
  await at(1_000 + LEASE_TTL_MS);
  assert.equal(env.asked.length, 2, 'read again after it');
  assert.equal(up.calls.length, 3);
});

test('a lease that could not be read is not kept', async () => {
  const env = fakeEnv({ leaseFails: true });
  const up = upstream();
  assert.equal((await route(new Request('https://bryan.marbledrive.app/'), env, { fetchImpl: up.fetchImpl, now: 1 })).status, 503);
  assert.equal((await route(new Request('https://bryan.marbledrive.app/'), env, { fetchImpl: up.fetchImpl, now: 2 })).status, 503);
  assert.equal(env.asked.length, 2);
});

test('the lease API under the public name is only a path on the drive: it never moves the lease', async () => {
  const objects = new Map();
  const seen = [];
  const env = {
    DRIVES,
    LEASE_TOKEN: 'secret',
    LEASE: {
      idFromName: (name) => name,
      get: (id) => {
        if (!objects.has(id)) {
          const store = new Map();
          const lease = new Lease({ storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v) } });
          objects.set(id, { fetch: (req) => { seen.push(`${req.method} ${req.url}`); return lease.fetch(req); } });
        }
        return objects.get(id);
      },
    },
  };
  // Home on Fly with no Sprites token: the router answers without any fetch.
  const res = await handle(new Request('https://bryan.marbledrive.app/lease/bryan/move', {
    method: 'POST',
    headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    body: JSON.stringify({ to: 'mac', epoch: 0 }),
  }), env);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://admin-p2-b3fwm.sprites.app/lease/bryan/move');
  assert.deepEqual(seen, ['GET https://lease/lease/bryan'], 'the Durable Object saw only the router\'s own read');
  const lease = await (await handle(new Request('https://marble-lease.example.workers.dev/lease/bryan', { headers: { authorization: 'Bearer secret' } }), env)).json();
  assert.deepEqual(lease, { home: 'fly', epoch: 0, since: null });
});
