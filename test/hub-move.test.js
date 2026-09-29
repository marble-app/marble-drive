// test/hub-move.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { macPaths } from '../server/hub/mac-paths.js';
import { leaseTo, moveHome } from '../server/hub/move.js';

// A side as drive-home drives it: hold() puts it on standby (a hold file and a
// restart), release() takes the hold off, health() is its /health.
function side(name, log, overrides = {}) {
  let held = false;
  return {
    get held() { return held; },
    working: async () => 0,
    hold: async () => { held = true; log.push(`${name}.hold`); },
    release: async () => { held = false; log.push(`${name}.release`); },
    health: async () => ({ ok: true, standby: held }),
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
  // The leaving side is held before its last upload and stays held: never released.
  assert.deepEqual(log, ['fly.hold', 'fly.upload@0', 'mac.download', 'mac.release']);
  assert.deepEqual(client.current, { home: 'mac', epoch: 1 });
});

test('already there: nothing moves', async () => {
  const log = [];
  const result = await moveHome({ to: 'fly', sides: { mac: side('mac', log), fly: side('fly', log) }, client: lease(), ...quick });
  assert.equal(result.already, true);
  assert.equal(result.ok, true);
  assert.deepEqual(log, []);
});

test('already there, but that side is on standby: an error that names lease-to', async () => {
  const log = [];
  const fly = side('fly', log, { health: async () => ({ ok: true, standby: true }) });
  const result = await moveHome({ to: 'fly', sides: { mac: side('mac', log), fly }, client: lease(), ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'already']);
  assert.match(result.why, /on standby.*lease-to fly/);
  assert.deepEqual(log, []);
});

test('already there, but that side does not answer: an error', async () => {
  const log = [];
  const fly = side('fly', log, { health: async () => { throw new Error('refused'); } });
  const result = await moveHome({ to: 'fly', sides: { mac: side('mac', log), fly }, client: lease(), ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'already']);
  assert.match(result.why, /does not answer \/health \(refused\)/);
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

test('a refused final upload releases the old home and leaves the lease', async () => {
  const log = [];
  const client = lease();
  const fly = side('fly', log, { upload: async () => ({ ok: false, why: 'the drive has no documents' }) });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'upload']);
  assert.deepEqual(log, ['fly.hold', 'fly.release']);
  assert.equal(fly.held, false);
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
  assert.ok(log.at(-1) === 'fly.release');
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
  // The arriving side is held once the lease is back; the old home released.
  assert.deepEqual(log.slice(-2), ['mac.hold', 'fly.release']);
  assert.equal(mac.held, true);
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
  assert.equal(log.at(-1), 'fly.release');
});

test('an arriving host that is not healthy hands the lease back', async () => {
  const log = [];
  const client = lease();
  const mac = side('mac', log, { healthy: async () => false });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'start']);
  assert.deepEqual(client.current, { home: 'fly', epoch: 2 });
  assert.deepEqual(log.slice(-3), ['mac.release', 'mac.hold', 'fly.release']);
  assert.equal(mac.held, true);
});

test('a failed hand-back with an unverified arriving copy releases nothing, holds it, and names lease-to', async () => {
  const log = [];
  const client = lease();
  const base = client.move;
  let calls = 0;
  client.move = async (to, epoch) => { calls += 1; if (calls === 2) throw new Error('hub down'); return base(to, epoch); };
  const mac = side('mac', log, { download: async () => ({ ok: false, why: 'disk' }) });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.equal(result.step, 'download');
  assert.match(result.why, /lease still names mac.*not verified.*not released \(which is held\)/);
  assert.match(result.why, /run drive-home lease-to fly to give the drive back to fly/);
  assert.deepEqual(log, ['fly.hold', 'fly.upload@0', 'mac.hold']);
  assert.equal(mac.held, true);
});

test('an unverified arriving copy that cannot be held says so', async () => {
  const log = [];
  const client = lease();
  const base = client.move;
  let calls = 0;
  client.move = async (to, epoch) => { calls += 1; if (calls === 2) throw new Error('hub down'); return base(to, epoch); };
  const mac = side('mac', log, { download: async () => ({ ok: false, why: 'disk' }), hold: async () => boom() });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.match(result.why, /could not be held \(boom\): stop it by hand/);
  assert.deepEqual(log, ['fly.hold', 'fly.upload@0']);
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
  assert.equal(log.at(-1), 'fly.release');
});

test('an unreadable lease while settling releases nothing', async () => {
  const log = [];
  const client = lease();
  const base = client.get;
  let down = false;
  client.get = async () => { if (down) throw new Error('offline'); return base(); };
  const mac = side('mac', log, { download: async () => { down = true; return { ok: false, why: 'disk' }; } });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.equal(result.step, 'download');
  assert.match(result.why, /could not be read.*nothing was released/);
  assert.deepEqual(log, ['fly.hold', 'fly.upload@0']);
});

test('a leaving host that cannot be held: old home released, lease untouched', async () => {
  const log = [];
  const client = lease();
  const fly = side('fly', log, { hold: async () => boom() });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'hold']);
  assert.deepEqual(log, ['fly.release']);
  assert.deepEqual(client.current, { home: 'fly', epoch: 0 });
});

test('an arriving host whose release throws hands the lease back', async () => {
  const log = [];
  const client = lease();
  let n = 0;
  const mac = side('mac', log, { release: async () => { n += 1; if (n === 1) boom(); log.push('mac.release'); } });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'start']);
  assert.deepEqual(client.current, { home: 'fly', epoch: 2 });
  assert.deepEqual(log.slice(-2), ['mac.hold', 'fly.release']);
});

test('a leaving side that does not say standby after a good move is an error, and the new home keeps serving', async () => {
  const log = [];
  const client = lease();
  const fly = side('fly', log, { health: async () => ({ ok: true, standby: false }) });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'verify-standby']);
  assert.match(result.why, /mac is home \(epoch 1\) and serving, but fly does not say standby/);
  assert.deepEqual(result.lease, { home: 'mac', epoch: 1 });
  assert.deepEqual(client.current, { home: 'mac', epoch: 1 });
  assert.ok(!log.includes('mac.hold') && !log.includes('fly.release'));
});

test('a leaving side that does not answer /health after a good move is an error', async () => {
  const log = [];
  const fly = side('fly', log, { health: async () => boom() });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client: lease(), ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'verify-standby']);
  assert.match(result.why, /fly did not answer \/health \(boom\)/);
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
  assert.deepEqual(log, ['fly.hold', 'fly.upload@0', 'mac.hold']);
});

test('an unreadable first lease touches no side', async () => {
  const log = [];
  const client = { get: async () => { throw new Error('offline'); }, move: async () => {} };
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly: side('fly', log) }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'lease']);
  assert.deepEqual(log, []);
});

test('a verified arriving copy whose release fails and hand-back fails is released by settle', async () => {
  const log = [];
  const client = lease();
  const base = client.move;
  let calls = 0;
  client.move = async (to, epoch) => { calls += 1; if (calls === 2) throw new Error('hub down'); return base(to, epoch); };
  const mac = side('mac', log, { release: async () => { log.push('mac.release'); throw new Error('nope'); } });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.equal(result.step, 'start');
  assert.deepEqual(log.slice(-2), ['mac.release', 'mac.release']);
  assert.ok(!log.includes('fly.release'));
  assert.match(result.why, /names mac \(epoch 1\), which could not be released: nope/);
});

// lease-to: the lease alone, to a side whose copy is good.
test('lease-to gives the lease back to a side whose copy is good: the other is held first', async () => {
  const log = [];
  const client = lease({ home: 'mac', epoch: 1 }); // left on an unverified mac copy
  const mac = side('mac', log);
  const fly = side('fly', log);
  await mac.hold(); await fly.hold(); log.length = 0; // both held, as moveHome leaves them
  const result = await leaseTo({ to: 'fly', sides: { mac, fly }, client, log: () => {} });
  assert.equal(result.ok, true);
  assert.deepEqual(client.current, { home: 'fly', epoch: 2 });
  assert.deepEqual(log, ['mac.hold', 'fly.release']);
  assert.deepEqual([mac.held, fly.held], [true, false]);
});

test('lease-to a side the lease already names moves nothing but still holds the other and releases it', async () => {
  const log = [];
  const client = lease({ home: 'fly', epoch: 3 });
  const result = await leaseTo({ to: 'fly', sides: { mac: side('mac', log), fly: side('fly', log) }, client, log: () => {} });
  assert.equal(result.ok, true);
  assert.deepEqual(client.current, { home: 'fly', epoch: 3 });
  assert.deepEqual(log, ['mac.hold', 'fly.release']);
});

test('lease-to refuses while the other side serves as home', async () => {
  const log = [];
  const client = lease({ home: 'mac', epoch: 1 });
  const result = await leaseTo({ to: 'fly', sides: { mac: side('mac', log), fly: side('fly', log) }, client, log: () => {} });
  assert.deepEqual([result.ok, result.step], [false, 'serving']);
  assert.match(result.why, /run drive-home to fly/);
  assert.deepEqual(log, []);
  assert.deepEqual(client.current, { home: 'mac', epoch: 1 });
});

test('lease-to moves nothing when the other side cannot be held', async () => {
  const log = [];
  const client = lease({ home: 'mac', epoch: 1 });
  const mac = side('mac', log, { health: async () => ({ ok: true, standby: true }), hold: async () => boom() });
  const result = await leaseTo({ to: 'fly', sides: { mac, fly: side('fly', log) }, client, log: () => {} });
  assert.deepEqual([result.ok, result.step], [false, 'hold']);
  assert.deepEqual(client.current, { home: 'mac', epoch: 1 });
  assert.deepEqual(log, []);
});

test('lease-to: a lease move that fails leaves the other side held and releases nothing', async () => {
  const log = [];
  const client = lease({ home: 'mac', epoch: 1 });
  client.move = async () => { throw new Error('hub down'); };
  const mac = side('mac', log, { health: async () => ({ ok: true, standby: true }) });
  const result = await leaseTo({ to: 'fly', sides: { mac, fly: side('fly', log) }, client, log: () => {} });
  assert.deepEqual([result.ok, result.step], [false, 'lease']);
  assert.match(result.why, /mac is held and nothing serves/);
  assert.deepEqual(log, ['mac.hold']);
});

test('lease-to: a lease move that committed but threw goes on', async () => {
  const log = [];
  const client = lease({ home: 'mac', epoch: 1 });
  const base = client.move;
  client.move = async (to, epoch) => { await base(to, epoch); throw new Error('timeout'); };
  const mac = side('mac', log, { health: async () => ({ ok: true, standby: true }) });
  const result = await leaseTo({ to: 'fly', sides: { mac, fly: side('fly', log) }, client, log: () => {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.lease, { home: 'fly', epoch: 2 });
  assert.deepEqual(log, ['mac.hold', 'fly.release']);
});

test('lease-to: a released side that does not come up as home is an error', async () => {
  const log = [];
  const client = lease({ home: 'fly', epoch: 0 });
  const result = await leaseTo({ to: 'fly', sides: { mac: side('mac', log), fly: side('fly', log, { healthy: async () => false }) }, client, log: () => {} });
  assert.deepEqual([result.ok, result.step], [false, 'start']);
  assert.match(result.why, /did not come up as home; mac is held/);
});
