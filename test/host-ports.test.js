// A drive's port (server/host/ports.js): the lowest in HOST_GUEST_PORTS that
// no drive holds and nothing is listening on, never 4400, 4401, 4402 or 4498
// or marble-host's own, and none at all when the range is full.
import assert from 'node:assert/strict';
import test from 'node:test';

import { listening, pickPort } from '../server/host/ports.js';
import { freePort, listen } from './fixtures/host.js';

const nothing = async () => false;

test('the lowest free port in the range', async () => {
  assert.equal(await pickPort({ range: { from: 4500, to: 4599 }, inUse: nothing }), 4500);
  assert.equal(await pickPort({ range: { from: 4500, to: 4599 }, taken: new Set([4500, 4501]), inUse: nothing }), 4502);
});

test('never the dev host, the owner\'s drive, a trial drive, the release smoke test or marble-host\'s own', async () => {
  const range = { from: 4398, to: 4405 };
  const got = [];
  const taken = new Set();
  for (;;) {
    const port = await pickPort({ range, taken, never: [4399], inUse: nothing });
    if (port === null) break;
    got.push(port);
    taken.add(port);
  }
  assert.deepEqual(got, [4398, 4403, 4404, 4405]);
  assert.equal(await pickPort({ range: { from: 4498, to: 4498 }, inUse: nothing }), null);
});

test('a port something already listens on is passed over', async (t) => {
  const busy = await listen((req, res) => res.end());
  t.after(() => busy.close());
  assert.equal(await listening(busy.port), true);
  assert.equal(await listening(await freePort()), false);
  const port = await pickPort({ range: { from: busy.port, to: busy.port + 1 } });
  assert.notEqual(port, busy.port);
});

test('a full range is null', async () => {
  assert.equal(await pickPort({ range: { from: 4500, to: 4502 }, taken: new Set([4500, 4501, 4502]), inUse: nothing }), null);
  assert.equal(await pickPort({ range: { from: 4500, to: 4501 }, inUse: async () => true }), null);
});
