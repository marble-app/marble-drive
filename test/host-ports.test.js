// A drive's port (server/host/ports.js): the lowest in HOST_GUEST_PORTS that
// no drive holds and nothing answers on at the address it gives a drive
// (asked from 127.0.0.2, as a drive's unit lets through), never 4400, 4401,
// 4402 or 4498 or marble-host's own, and none at all when the range is full.
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { listening, pickPort, portInUse } from '../server/host/ports.js';
import { freeGuestPort, listenGuest } from './fixtures/host.js';

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

test('a port something already answers on at its drive\'s address is passed over, asked from 127.0.0.2', async (t) => {
  const from = [];
  const busy = await listenGuest((req, res) => res.end());
  busy.server.on('connection', (socket) => from.push(socket.remoteAddress));
  t.after(() => busy.close());
  assert.equal(await portInUse(busy.port), true);
  assert.equal(await listening(busy.port, busy.address), true);
  assert.deepEqual(from, ['127.0.0.2', '127.0.0.2']);
  assert.equal(await portInUse(await freeGuestPort()), false);
  assert.equal(await pickPort({ range: { from: busy.port, to: busy.port } }), null);
  await busy.close();
  assert.equal(await pickPort({ range: { from: busy.port, to: busy.port } }), busy.port);

  // Something on 127.0.0.1 at that port is in no drive's way: the drive
  // listens on its own address.
  const elsewhere = http.createServer((req, res) => res.end());
  const bound = await new Promise((resolve) => {
    elsewhere.once('error', () => resolve(false));
    elsewhere.listen(busy.port, '127.0.0.1', () => resolve(true));
  });
  t.after(() => new Promise((resolve) => elsewhere.close(() => resolve())));
  if (bound) assert.equal(await portInUse(busy.port), false);
  assert.throws(() => portInUse(4600), /not a drive's/);
});

test('a full range is null', async () => {
  assert.equal(await pickPort({ range: { from: 4500, to: 4502 }, taken: new Set([4500, 4501, 4502]), inUse: nothing }), null);
  assert.equal(await pickPort({ range: { from: 4500, to: 4501 }, inUse: async () => true }), null);
});
