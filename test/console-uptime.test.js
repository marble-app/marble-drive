// The console's timeline: a drive's changes of state, gathered from the edges
// the Sprites API gives at each read of the fleet.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createUptime } from '../server/console/uptime.js';

const H = 3600_000;
const T0 = Date.parse('2026-09-24T12:00:00Z');
const iso = (t) => new Date(t).toISOString();

test('the edges of a sleep, the state it is in, and a stop dated when it is seen', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uptime-'));
  let t = T0;
  const u = createUptime({ file: path.join(dir, 'u.json'), now: () => t });
  // Awake since 10:00, after a sleep from 08:00.
  await u.record([{ name: 'a', status: 'running', since: iso(T0 - 2 * H), ranAt: iso(T0 - 2 * H), warmedAt: iso(T0 - 4 * H) }]);
  assert.deepEqual(u.of('a'), [[T0 - 4 * H, 'asleep'], [T0 - 2 * H, 'awake']]);
  // Paused at 12:30; read again, nothing new at 12:40.
  t = T0 + 40 * 60_000;
  const paused = { name: 'a', status: 'warm', since: iso(T0 + 30 * 60_000), ranAt: iso(T0 - 2 * H), warmedAt: iso(T0 + 30 * 60_000) };
  await u.record([paused]);
  await u.record([paused]);
  assert.deepEqual(u.of('a'), [[T0 - 4 * H, 'asleep'], [T0 - 2 * H, 'awake'], [T0 + 30 * 60_000, 'asleep']]);
  // Stopped: no edge from the API, so the time it is first seen.
  t = T0 + 5 * H;
  await u.record([{ ...paused, status: 'cold' }]);
  assert.deepEqual(u.of('a').at(-1), [T0 + 5 * H, 'stopped']);
  // A day's window keeps the change it starts inside of.
  t = T0 + 26 * H;
  assert.deepEqual(u.of('a'), [[T0 + 30 * 60_000, 'asleep'], [T0 + 5 * H, 'stopped']]);
});

test('kept on disk, and a drive that is gone is forgotten', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uptime-'));
  const file = path.join(dir, 'u.json');
  const u = createUptime({ file, now: () => T0 });
  await u.record([
    { name: 'a', status: 'running', since: iso(T0 - H), ranAt: iso(T0 - H), warmedAt: null },
    { name: 'b', status: 'warm', since: iso(T0 - H), ranAt: iso(T0 - 3 * H), warmedAt: iso(T0 - H) },
  ]);
  await u.record([{ name: 'a', status: 'running', since: iso(T0 - H), ranAt: iso(T0 - H), warmedAt: null }]);
  assert.deepEqual(u.of('b'), []);
  await new Promise((r) => setTimeout(r, 1200));
  const again = createUptime({ file, now: () => T0 });
  await again.load();
  assert.deepEqual(again.of('a'), [[T0 - H, 'awake']]);
});
