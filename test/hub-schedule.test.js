import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleUploads } from '../server/hub/schedule.js';

const settings = { HUB_MACHINE: 'mac' };
function harness({ lease = { home: 'mac', epoch: 2 }, newest = 1000, leaseError = null } = {}) {
  const calls = { uploads: [], lost: [], logs: [] };
  const state = { newest, files: 5 };
  const loop = scheduleUploads({
    root: '/drive',
    settings,
    client: { get: async () => { if (leaseError) throw leaseError; return lease; } },
    scanImpl: async () => ({ files: state.files, documents: 2, newest: state.newest }),
    upload: async (args) => { calls.uploads.push(args); return { ok: true, state: { seq: calls.uploads.length }, counts: { files: 5 } }; },
    onLost: (l) => calls.lost.push(l),
    log: (m) => calls.logs.push(m),
    schedule: null,
  });
  return { loop, calls, state, setLease: (l) => { lease = l; } };
}

test('a change is uploaded with the epoch the lease is at', async () => {
  const { loop, calls } = harness();
  await loop.tick();
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.uploads[0].epoch, 2);
});

test('nothing changed since the last upload: no upload', async () => {
  const { loop, calls, state } = harness();
  await loop.tick();
  state.newest = 1000; // unchanged
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

test('an idle drive whose lease moved still stops the host', async () => {
  const { loop, calls, setLease } = harness();
  await loop.tick();
  setLease({ home: 'fly', epoch: 6 });
  await loop.tick();
  assert.equal(calls.uploads.length, 1);
  assert.deepEqual(calls.lost, [{ home: 'fly', epoch: 6 }]);
});

test('a deletion (fewer files, nothing newer) is uploaded', async () => {
  const { loop, calls, state } = harness();
  await loop.tick();
  state.files = 4;
  await loop.tick();
  assert.equal(calls.uploads.length, 2);
});

test('an upload that throws is logged, and the next tick still runs', async () => {
  const logs = [];
  let n = 0;
  const loop = scheduleUploads({
    root: '/d', settings, client: { get: async () => ({ home: 'mac', epoch: 1 }) },
    scanImpl: async () => ({ newest: 1, files: 1, documents: 1 }),
    upload: async () => { if (++n === 1) throw new Error('boom'); return { ok: true, state: { seq: 1 }, counts: { files: 1 } }; },
    onLost: () => {}, log: (m) => logs.push(m), schedule: null,
  });
  await loop.tick();
  await loop.tick();
  assert.match(logs.join('\n'), /\[hub\] upload failed: boom/);
  assert.equal(n, 2);
});
