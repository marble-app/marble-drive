// test/hub-move.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { macPaths } from '../server/hub/mac-paths.js';
import { moveHome } from '../server/hub/move.js';

function side(name, log, overrides = {}) {
  return {
    working: async () => 0,
    stop: async () => log.push(`${name}.stop`),
    start: async () => log.push(`${name}.start`),
    healthy: async () => true,
    upload: async ({ epoch }) => { log.push(`${name}.upload@${epoch}`); return { ok: true, state: { files: 5, documents: 2 } }; },
    download: async () => { log.push(`${name}.download`); return { ok: true, matches: true, state: { files: 5, documents: 2 }, counts: { files: 5, documents: 2 } }; },
    ...overrides,
  };
}
function lease(initial = { home: 'fly', epoch: 0 }) {
  let current = { ...initial };
  return {
    get current() { return current; },
    get: async () => current,
    move: async (to, epoch) => {
      if (epoch !== current.epoch) throw Object.assign(new Error('stale'), { status: 409, lease: current });
      current = { home: to, epoch: current.epoch + 1 };
      return current;
    },
  };
}
const quick = { sleep: async () => {}, pollMs: 0, log: () => {} };

test('a move runs in order and ends with the lease on the new home', async () => {
  const log = [];
  const client = lease();
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly: side('fly', log) }, client, ...quick });
  assert.equal(result.ok, true);
  assert.deepEqual(log, ['fly.stop', 'fly.upload@0', 'mac.download', 'mac.start', 'fly.start']);
  assert.deepEqual(client.current, { home: 'mac', epoch: 1 });
});

test('already there: nothing moves', async () => {
  const log = [];
  const result = await moveHome({ to: 'fly', sides: { mac: side('mac', log), fly: side('fly', log) }, client: lease(), ...quick });
  assert.equal(result.already, true);
  assert.deepEqual(log, []);
});

test('an agent working the whole time: nothing moves', async () => {
  const log = [];
  const fly = side('fly', log, { working: async () => 1 });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client: lease(), waitIdleMs: 0, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'idle']);
  assert.deepEqual(log, []);
});

test('--now does not wait for agents', async () => {
  const log = [];
  const fly = side('fly', log, { working: async () => 3 });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client: lease(), now: true, ...quick });
  assert.equal(result.ok, true);
});

test('a refused final upload restarts the old home and leaves the lease', async () => {
  const log = [];
  const client = lease();
  const fly = side('fly', log, { upload: async () => ({ ok: false, why: 'the drive has no documents' }) });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'upload']);
  assert.deepEqual(log, ['fly.stop', 'fly.start']);
  assert.deepEqual(client.current, { home: 'fly', epoch: 0 });
});

test('a lease that moved underneath aborts and restores the old home', async () => {
  const log = [];
  const client = lease();
  const fly = side('fly', log, {
    upload: async () => { await client.move('fly', 0); return { ok: true, state: {} }; }, // someone else moved it
  });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'lease']);
  assert.ok(log.at(-1) === 'fly.start');
  assert.equal(client.current.home, 'fly');
});

test('counts that do not match after download hand the lease back', async () => {
  const log = [];
  const client = lease();
  const mac = side('mac', log, {
    download: async () => ({ ok: true, matches: false, state: { files: 5, documents: 2 }, counts: { files: 4, documents: 2 } }),
  });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'verify']);
  assert.match(result.why, /hub 5\/2, here 4\/2/);
  assert.deepEqual(client.current, { home: 'fly', epoch: 2 });
  assert.deepEqual(log.slice(-2), ['mac.start', 'fly.start']);
});

test('where each drive lives on the Mac', () => {
  assert.deepEqual(macPaths('bryan', '/Users/b'), {
    root: '/Users/b/Marble Drive',
    hubEnv: '/Users/b/.config/marble-drive/hub-bryan.env',
    port: 4401,
    label: 'com.marble.drive.home.bryan',
    app: '/Users/b/Library/Application Support/Marble Drive/app',
  });
  assert.equal(macPaths('t-bryan', '/Users/b').root, '/Users/b/Marble Drive (t-bryan)');
  assert.equal(macPaths('t-bryan', '/Users/b').port, 4402);
});

// Rollback branches.
const boom = () => { throw new Error('boom'); };

test('a download that throws hands the lease back and serves from the old home', async () => {
  const log = [];
  const client = lease();
  const mac = side('mac', log, { download: async () => boom() });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'download']);
  assert.deepEqual(client.current, { home: 'fly', epoch: 2 });
  assert.equal(log.at(-1), 'fly.start');
});

test('an arriving host that is not healthy hands the lease back', async () => {
  const log = [];
  const client = lease();
  const mac = side('mac', log, { healthy: async () => false });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'start']);
  assert.deepEqual(client.current, { home: 'fly', epoch: 2 });
  assert.equal(log.at(-1), 'fly.start');
});

test('a failed hand-back with an unverified arriving copy starts nothing', async () => {
  const log = [];
  const client = lease();
  const base = client.move;
  let calls = 0;
  client.move = async (to, epoch) => { calls += 1; if (calls === 2) throw new Error('hub down'); return base(to, epoch); };
  const mac = side('mac', log, { download: async () => ({ ok: false, why: 'disk' }) });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.equal(result.step, 'download');
  assert.match(result.why, /lease still names mac.*not verified.*nothing was started/);
  assert.deepEqual(log, ['fly.stop', 'fly.upload@0']);
});

test('a lease move that committed but threw is handed back', async () => {
  const log = [];
  const client = lease();
  const base = client.move;
  let first = true;
  client.move = async (to, epoch) => {
    const r = await base(to, epoch);
    if (first) { first = false; throw new Error('timeout'); }
    return r;
  };
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly: side('fly', log) }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'lease']);
  assert.equal(client.current.home, 'fly');
  assert.equal(log.at(-1), 'fly.start');
});

test('an unreadable lease while settling starts nothing', async () => {
  const log = [];
  const client = lease();
  const base = client.get;
  let down = false;
  client.get = async () => { if (down) throw new Error('offline'); return base(); };
  const mac = side('mac', log, { download: async () => { down = true; return { ok: false, why: 'disk' }; } });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.equal(result.step, 'download');
  assert.match(result.why, /could not be read/);
  assert.deepEqual(log, ['fly.stop', 'fly.upload@0']);
});

test('a leaving host that will not stop: old home serves, lease untouched', async () => {
  const log = [];
  const client = lease();
  const fly = side('fly', log, { stop: async () => boom() });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'stop']);
  assert.deepEqual(log, ['fly.start']);
  assert.deepEqual(client.current, { home: 'fly', epoch: 0 });
});

test('an arriving host whose start throws hands the lease back', async () => {
  const log = [];
  const client = lease();
  let n = 0;
  const mac = side('mac', log, { start: async () => { n += 1; if (n === 1) boom(); log.push('mac.start'); } });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'start']);
  assert.deepEqual(client.current, { home: 'fly', epoch: 2 });
  assert.equal(log.at(-1), 'fly.start');
});

test('a leaving host that will not restart after a good move only warns', async () => {
  const log = [];
  const fly = side('fly', log, { start: async () => boom() });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client: lease(), ...quick });
  assert.equal(result.ok, true);
  assert.match(result.warning, /fly did not restart as standby/);
});

test('waits while an agent works, then moves', async () => {
  const log = [];
  const seq = [2, 0];
  const fly = side('fly', log, { working: async () => seq.shift() });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client: lease(), waitIdleMs: 60_000, ...quick });
  assert.equal(result.ok, true);
});

test('an unreachable leaving host during the idle wait names --now', async () => {
  const log = [];
  const fly = side('fly', log, { working: async () => boom() });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client: lease(), ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'idle']);
  assert.match(result.why, /--now/);
  assert.deepEqual(log, []);
});

test('a forward move refused with 409 is not handed back and starts nothing if it names mac', async () => {
  const log = [];
  let current = { home: 'fly', epoch: 0 };
  let moves = 0;
  const client = {
    get: async () => current,
    move: async () => { moves += 1; current = { home: 'mac', epoch: 1 }; throw Object.assign(new Error('stale'), { status: 409, lease: current }); },
  };
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly: side('fly', log) }, client, ...quick });
  assert.equal(result.step, 'lease');
  assert.equal(moves, 1);
  assert.match(result.why, /lease still names mac/);
  assert.deepEqual(log, ['fly.stop', 'fly.upload@0']);
});

test('an unreadable first lease touches no side', async () => {
  const log = [];
  const client = { get: async () => { throw new Error('offline'); }, move: async () => {} };
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly: side('fly', log) }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'lease']);
  assert.deepEqual(log, []);
});

test('a verified arriving copy whose start fails and hand-back fails is started by settle', async () => {
  const log = [];
  const client = lease();
  const base = client.move;
  let calls = 0;
  client.move = async (to, epoch) => { calls += 1; if (calls === 2) throw new Error('hub down'); return base(to, epoch); };
  const mac = side('mac', log, { start: async () => { log.push('mac.start'); throw new Error('nope'); } });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.equal(result.step, 'start');
  assert.deepEqual(log.slice(-2), ['mac.start', 'mac.start']);
  assert.ok(!log.includes('fly.start'));
});
