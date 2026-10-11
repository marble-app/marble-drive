// test/hub-lease.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL, MACHINES, move } from '../worker/src/lease.js';

const NOW = Date.parse('2026-09-30T10:00:00Z');

test('a new lease says Fly is home at epoch 0, which is today', () => {
  assert.deepEqual(INITIAL, { home: 'fly', epoch: 0, since: null });
  assert.deepEqual(MACHINES, ['mac', 'pc', 'fly']);
});

test('a move names the current epoch, and raises it', () => {
  const result = move(null, { to: 'mac', epoch: 0, now: NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.lease, { home: 'mac', epoch: 1, since: '2026-09-30T10:00:00.000Z' });
});

test('a move with a stale epoch is refused with the lease as it is', () => {
  const lease = { home: 'mac', epoch: 4, since: 'x' };
  const result = move(lease, { to: 'fly', epoch: 3, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.deepEqual(result.lease, lease);
  assert.match(result.why, /epoch 4, not 3/);
});

test('only mac, pc or fly, and only integer epochs', () => {
  assert.equal(move(null, { to: 'moon', epoch: 0, now: NOW }).status, 400);
  assert.equal(move(null, { to: 'pc', epoch: 0, now: NOW }).lease.home, 'pc');
  assert.equal(move(null, { to: 'mac', epoch: '0', now: NOW }).status, 400);
});
