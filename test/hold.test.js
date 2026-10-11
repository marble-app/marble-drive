// What keeps a sprite awake: work that is making progress, bounded by how long
// nobody has answered it, how long it has gone without progress, and a day
// since anyone used the drive. Limits only let the sprite sleep; they never
// end the work.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createHold } from '../server/hold.js';

const MIN = 60_000;
function setup() {
  const clock = { t: 0, now() { return this.t; } };
  const samples = new Map();
  const progress = { available: true, sample: (pid) => samples.get(pid) ?? null };
  const hold = createHold({ clock, progress, limits: { pausedMs: 10 * MIN, noProgressMs: 30 * MIN, maxMs: 24 * 60 * MIN } });
  return { clock, samples, hold };
}

test('a turn making progress holds; with nothing running, nothing holds', () => {
  const { clock, hold } = setup();
  assert.equal(hold.holds([]), false);
  clock.t = 20 * MIN;
  assert.equal(hold.holds([{ key: 't1', lastProgress: 19 * MIN, pausedSince: null }]), true);
});

test('an unanswered question holds for ten minutes, then lets the sprite sleep', () => {
  const { clock, hold } = setup();
  const turn = { key: 't1', lastProgress: 0, pausedSince: 0 };
  clock.t = 9 * MIN;
  assert.equal(hold.holds([turn]), true);
  clock.t = 10 * MIN;
  assert.equal(hold.holds([turn]), false);
});

test('thirty minutes without progress lets the sprite sleep', () => {
  const { clock, hold } = setup();
  clock.t = 30 * MIN;
  assert.equal(hold.holds([{ key: 't1', lastProgress: 0, pausedSince: null }]), false);
});

test('a job measured by its processes holds while they work, even without output', () => {
  const { clock, samples, hold } = setup();
  const job = { key: 'split', pid: 42, lastProgress: 0, pausedSince: null };
  samples.set(42, 100);
  clock.t = 1 * MIN; hold.holds([job]);
  for (let m = 2; m <= 40; m += 1) {
    clock.t = m * MIN;
    samples.set(42, 100 + m); // CPU keeps growing
    assert.equal(hold.holds([job]), true, `minute ${m}`);
  }
});

test('a day after anyone used the drive, even working, it lets the sprite sleep; use resets it', () => {
  const { clock, hold } = setup();
  const busy = () => ({ key: 't1', lastProgress: clock.t, pausedSince: null });
  clock.t = 24 * 60 * MIN - 1;
  assert.equal(hold.holds([busy()]), true);
  clock.t = 24 * 60 * MIN;
  assert.equal(hold.holds([busy()]), false);
  hold.used();
  assert.equal(hold.holds([busy()]), true);
});

test('where processes cannot be measured, a job that keeps printing holds, and a silent one lets go', () => {
  const { clock, hold } = setup();
  const job = { key: 'split', pid: 7, output: 0, pausedSince: null }; // no sample for pid 7
  clock.t = 1 * MIN;
  assert.equal(hold.holds([job]), true, 'a job just seen has just started');
  clock.t = 25 * MIN; job.output = 3;
  assert.equal(hold.holds([job]), true);
  clock.t = 54 * MIN;
  assert.equal(hold.holds([job]), true);
  clock.t = 55 * MIN;
  assert.equal(hold.holds([job]), false, 'thirty minutes since it last printed');
});
