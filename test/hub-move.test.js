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
