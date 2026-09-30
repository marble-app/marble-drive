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

// A sprite pauses ~30 s after its last connection, freezing timers: the host
// keeps it awake while dirty(), so an edit made just before it dozes is
// uploaded first.

test('dirty after a change until the upload succeeds, clean after', async () => {
  const { loop, state } = harness();
  await loop.tick();
  assert.equal(loop.dirty(), false);
  await loop.refresh();
  assert.equal(loop.dirty(), false, 'nothing changed since the upload');
  state.newest = 2000;
  await loop.refresh();
  assert.equal(loop.dirty(), true);
  await loop.tick();
  assert.equal(loop.dirty(), false);
});

test('before the first upload, a drive that was scanned is dirty', async () => {
  const { loop } = harness();
  assert.equal(loop.dirty(), false, 'nothing scanned yet');
  await loop.refresh();
  assert.equal(loop.dirty(), true);
});

test('dirty while an upload is in flight', async () => {
  let finish;
  let started;
  const begun = new Promise((r) => { started = r; });
  const loop = scheduleUploads({
    root: '/d', settings, client: { get: async () => ({ home: 'mac', epoch: 0 }) },
    scanImpl: async () => ({ newest: 1, files: 1, documents: 1 }),
    upload: () => { started(); return new Promise((r) => { finish = () => r({ ok: true, state: { seq: 1 }, counts: { files: 1 }, changed: 1, deleted: 0 }); }); },
    onLost: () => {}, log: () => {}, schedule: null,
  });
  const ticking = loop.tick();
  await begun;
  assert.equal(loop.dirty(), true);
  finish();
  await ticking;
  assert.equal(loop.dirty(), false);
});

test('a refused or failed upload stays dirty', async () => {
  for (const upload of [async () => ({ ok: false, why: 'the drive has no documents' }), async () => { throw new Error('boom'); }]) {
    const loop = scheduleUploads({
      root: '/d', settings, client: { get: async () => ({ home: 'mac', epoch: 0 }) },
      scanImpl: async () => ({ newest: 1, files: 1, documents: 1 }), upload,
      onLost: () => {}, log: () => {}, schedule: null,
    });
    await loop.tick();
    assert.equal(loop.dirty(), true);
  }
});

test('the upload line says how many files changed and were deleted', async () => {
  const logs = [];
  const loop = scheduleUploads({
    root: '/d', settings, client: { get: async () => ({ home: 'mac', epoch: 0 }) },
    scanImpl: async () => ({ newest: 1, files: 9, documents: 1 }),
    upload: async () => ({ ok: true, state: { seq: 4 }, counts: { files: 9 }, changed: 3, deleted: 2 }),
    onLost: () => {}, log: (m) => logs.push(m), schedule: null,
  });
  await loop.tick();
  assert.match(logs.join('\n'), /uploaded seq 4: 9 files, 3 changed, 2 deleted, in \d+ms/);
});

test('the refresh runs on its own timer, apart from the uploads', () => {
  const timers = [];
  const loop = scheduleUploads({
    root: '/d', settings, client: { get: async () => ({ home: 'mac', epoch: 0 }) },
    scanImpl: async () => ({ newest: 1, files: 1, documents: 1 }), upload: async () => ({ ok: true }),
    onLost: () => {}, log: () => {}, everyMs: 60_000, watchMs: 15_000,
    schedule: (fn, ms) => { timers.push(ms); return { unref() {} }; },
  });
  assert.deepEqual(timers.sort(), [15_000, 60_000]);
  loop.stop();
});
