// A sprite's state over time from its ledger and from what the Console saw.

import assert from 'node:assert/strict';
import test from 'node:test';

import { reason, segments } from '../server/console/timeline.js';

const H = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 5, 0, 0, 0);
/** Ledger minutes covering [startMs, endMs), the first one carrying `wake`. */
const minutes = (startMs, endMs, { wake = null, mem = 2, why = { tabs: 1, looking: 1 } } = {}) => {
  const out = [];
  for (let t = startMs + 60_000; t <= endMs; t += 60_000) out.push({ t: t / 1000, dt: 60, cpu: 1, mem, disk: 5, why, wake: out.length ? null : wake });
  return out;
};
const brief = (segs) => segs.map((s) => [s.state, (s.from - T0) / H, (s.to - T0) / H]);

test('from the ledger alone: awake stretches, a warm gap, a cold gap, unknown before', () => {
  const lines = [
    ...minutes(T0 + 1 * H, T0 + 2 * H, { wake: 'cold' }),
    ...minutes(T0 + 3 * H, T0 + 4 * H, { wake: 'warm' }),
    ...minutes(T0 + 6 * H, T0 + 7 * H, { wake: 'cold' }),
  ];
  const segs = segments({ lines, from: T0, to: T0 + 8 * H });
  assert.deepEqual(brief(segs), [
    ['unknown', 0, 1], ['running', 1, 2], ['warm', 2, 3], ['running', 3, 4], ['cold', 4, 6], ['running', 6, 7], ['unknown', 7, 8],
  ]);
  assert.equal(segs[4].coldEdge, true, 'when it stopped in that gap is not known');
  close(segs[1].cost > 0);
  assert.equal(segs[1].peakMem, 2);
  assert.equal(segs[1].why.looking, 3600);
});

test('from observations alone: each status holds until the next', () => {
  const segs = segments({
    observations: [{ t: T0 + 1 * H, status: 'running' }, { t: T0 + 2 * H, status: 'warm' }, { t: T0 + 5 * H, status: 'cold' }],
    from: T0,
    to: T0 + 6 * H,
  });
  assert.deepEqual(brief(segs), [['unknown', 0, 1], ['running', 1, 2], ['warm', 2, 5], ['cold', 5, 6]]);
});

test('both: the ledger\'s minutes win for running, observations say where warm turned cold', () => {
  const lines = [...minutes(T0 + 1 * H, T0 + 2 * H), ...minutes(T0 + 5 * H, T0 + 6 * H, { wake: 'cold' })];
  const segs = segments({
    lines,
    observations: [{ t: T0 + 2 * H, status: 'warm' }, { t: T0 + 3 * H, status: 'cold' }, { t: T0 + 5 * H, status: 'running' }],
    from: T0,
    to: T0 + 7 * H,
  });
  assert.deepEqual(brief(segs), [['unknown', 0, 1], ['running', 1, 2], ['warm', 2, 3], ['cold', 3, 5], ['running', 7 - 2, 7]]);
});

test('a restart inside a stretch does not split it; an empty range is nothing', () => {
  const lines = [...minutes(T0, T0 + H), ...minutes(T0 + H, T0 + 2 * H, { wake: 'restart' })];
  assert.deepEqual(brief(segments({ lines, from: T0, to: T0 + 2 * H })), [['running', 0, 2]]);
  assert.deepEqual(segments({ from: T0, to: T0 }), []);
  assert.deepEqual(brief(segments({ from: T0, to: T0 + H })), [['unknown', 0, 1]]);
});

test('the reason a minute was awake, most telling first', () => {
  assert.equal(reason({ why: { tabs: 2, looking: 1, work: 1 } }), 'looking');
  assert.equal(reason({ why: { tabs: 1, work: 1 } }), 'work');
  assert.equal(reason({ why: { tabs: 1, asks: 1 } }), 'asks');
  assert.equal(reason({ why: { tabs: 1 } }), 'idle');
  assert.equal(reason({}), 'other');
});

function close(ok) {
  assert.ok(ok);
}
