import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleUploads } from '../server/hub/schedule.js';

const settings = { HUB_MACHINE: 'mac' };
function harness({ lease = { home: 'mac', epoch: 2 }, newest = 1000, leaseError = null } = {}) {
  const calls = { uploads: [], lost: [], logs: [] };
  const state = { newest };
  const loop = scheduleUploads({
    root: '/drive',
    settings,
    client: { get: async () => { if (leaseError) throw leaseError; return lease; } },
    scanImpl: async () => ({ files: 5, documents: 2, newest: state.newest }),
    upload: async (args) => { calls.uploads.push(args); return { ok: true, state: { seq: calls.uploads.length }, counts: { files: 5 } }; },
    onLost: (l) => calls.lost.push(l),
    log: (m) => calls.logs.push(m),
    schedule: null,
  });
  return { loop, calls, state };
}

test('a change is uploaded with the epoch the lease is at', async () => {
  const { loop, calls } = harness();
  await loop.tick();
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.uploads[0].epoch, 2);
});

test('nothing changed since the last upload: no upload, no lease call', async () => {
  const { loop, calls, state } = harness();
  await loop.tick();
  state.newest = 500; // older than the upload
  await loop.tick();
  assert.equal(calls.uploads.length, 1);
});

test('a lost lease stops the host and uploads nothing', async () => {
  const { loop, calls } = harness({ lease: { home: 'fly', epoch: 5 } });
  await loop.tick();
  assert.equal(calls.uploads.length, 0);
  assert.deepEqual(calls.lost, [{ home: 'fly', epoch: 5 }]);
});

test('lease unreachable: wait for the next minute, do not upload blind', async () => {
  const { loop, calls } = harness({ leaseError: new Error('offline') });
  await loop.tick();
  assert.equal(calls.uploads.length, 0);
  assert.equal(calls.lost.length, 0);
  assert.match(calls.logs.join('\n'), /waits: the lease is unreachable/);
});

test('a refused upload is said, and tried again next minute', async () => {
  const calls = [];
  const loop = scheduleUploads({
    root: '/d', settings, client: { get: async () => ({ home: 'mac', epoch: 0 }) },
    scanImpl: async () => ({ newest: 1 }), upload: async () => ({ ok: false, why: 'the drive has no documents' }),
    onLost: () => {}, log: (m) => calls.push(m), schedule: null,
  });
  await loop.tick();
  await loop.tick();
  assert.equal(calls.filter((m) => /refused: the drive has no documents/.test(m)).length, 2);
});
