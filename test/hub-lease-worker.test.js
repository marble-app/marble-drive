// test/hub-lease-worker.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { handle, Lease } from '../worker/src/index.js';

// Stand-ins for the Durable Object runtime: one object per name, each with a
// Map for storage. The real runtime runs one request per object at a time.
function fakeEnv(token = 'secret') {
  const objects = new Map();
  return {
    LEASE_TOKEN: token,
    LEASE: {
      idFromName: (name) => name,
      get: (id) => {
        if (!objects.has(id)) {
          const store = new Map();
          objects.set(id, new Lease({ storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v) } }));
        }
        return objects.get(id);
      },
    },
  };
}
const auth = { authorization: 'Bearer secret' };
const call = (env, method, path, body, headers = auth) =>
  handle(new Request(`https://lease.test${path}`, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);

test('without the token, nothing', async () => {
  const res = await call(fakeEnv(), 'GET', '/lease/bryan', null, {});
  assert.equal(res.status, 401);
});

test('a drive nobody moved is at home on Fly', async () => {
  const res = await call(fakeEnv(), 'GET', '/lease/bryan');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { home: 'fly', epoch: 0, since: null });
});

test('a move is kept, and a second move from the same epoch loses', async () => {
  const env = fakeEnv();
  const first = await call(env, 'POST', '/lease/bryan/move', { to: 'mac', epoch: 0 });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).epoch, 1);
  const second = await call(env, 'POST', '/lease/bryan/move', { to: 'fly', epoch: 0 });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).lease.home, 'mac');
  assert.equal((await (await call(env, 'GET', '/lease/bryan')).json()).home, 'mac');
});

test('drives do not share a lease', async () => {
  const env = fakeEnv();
  await call(env, 'POST', '/lease/t-bryan/move', { to: 'mac', epoch: 0 });
  assert.equal((await (await call(env, 'GET', '/lease/bryan')).json()).home, 'fly');
});

test('a Worker with no token set refuses everyone', async () => {
  const res = await call(fakeEnv(''), 'GET', '/lease/bryan', null, { authorization: 'Bearer ' });
  assert.equal(res.status, 500);
});
