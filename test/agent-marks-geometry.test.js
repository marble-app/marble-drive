import assert from 'node:assert/strict';
import test from 'node:test';

import '../runtime/agent-marks-geometry.js';

const G = () => globalThis.marbleMarksGeometry;

// A page: a heading, a paragraph, and a list of two items. Body is not a box —
// the layer never offers <body> or <html>.
const PAGE = [
  { id: 'h', parent: null, left: 40, top: 40, width: 600, height: 40 },
  { id: 'p', parent: null, left: 40, top: 100, width: 600, height: 24 },
  { id: 'q', parent: null, left: 40, top: 140, width: 600, height: 60 },
  { id: 'q1', parent: 'q', left: 80, top: 140, width: 560, height: 30 },
  { id: 'q2', parent: 'q', left: 80, top: 170, width: 560, height: 30 },
];
const rect = (left, top, right, bottom) => ({ left, top, width: right - left, height: bottom - top });

test('coverage is the share of the box inside the rect', () => {
  const box = { left: 0, top: 0, width: 100, height: 100 };
  assert.equal(G().coverage(rect(0, 0, 100, 100), box), 1);
  assert.equal(G().coverage(rect(0, 0, 50, 100), box), 0.5);
  assert.equal(G().coverage(rect(200, 200, 300, 300), box), 0);
  assert.equal(G().coverage(rect(-50, -50, 150, 150), box), 1, 'a rect larger than the box contains it');
  assert.equal(G().coverage(rect(0, 0, 100, 100), { left: 0, top: 0, width: 0, height: 0 }), 0, 'an empty box covers nothing');
});

test('a rect that grazes an element does not select it', () => {
  assert.deepEqual(G().idsInRect(rect(30, 121, 700, 130), PAGE), []);
});

test('an element counts at 60% coverage, not below', () => {
  // p spans y 100..124. 60% of 24 is 14.4.
  assert.deepEqual(G().idsInRect(rect(30, 100, 700, 115), PAGE), ['p']);
  assert.deepEqual(G().idsInRect(rect(30, 100, 700, 113), PAGE), []);
});

test('a rect over a whole list selects the list, not its items', () => {
  assert.deepEqual(G().idsInRect(rect(30, 130, 700, 210), PAGE), ['q']);
});

test('a rect over one item selects that item', () => {
  assert.deepEqual(G().idsInRect(rect(30, 135, 700, 172), PAGE), ['q1']);
});

test('a rect over both items but not the list itself still coalesces only when the list is a candidate', () => {
  // The list is 60px tall; a rect covering exactly the two items covers the
  // whole list too, so this coalesces. Shrink the list's box so it is taller
  // than its items and only 50% covered: the items stay items.
  const tall = PAGE.map((b) => (b.id === 'q' ? { ...b, top: 140, height: 120 } : b));
  assert.deepEqual(G().idsInRect(rect(30, 135, 700, 205), tall), ['q1', 'q2']);
});

test('ids come back in document order', () => {
  assert.deepEqual(G().idsInRect(rect(30, 30, 700, 210), PAGE), ['h', 'p', 'q']);
});

test('threshold is an option', () => {
  assert.deepEqual(G().idsInRect(rect(30, 100, 700, 113), PAGE, { threshold: 0.5 }), ['p']);
});

test('project is the exponential-decay form, not v²/2a', () => {
  // 1000 px/s at 0.998 lands 499px out.
  assert.equal(Math.round(G().project(1000)), 499);
  assert.equal(G().project(0), 0);
  assert.ok(G().project(-400) < 0, 'sign follows velocity');
  assert.ok(Math.abs(G().project(1000, 0.99)) < Math.abs(G().project(1000)), 'a snappier rate lands shorter');
});

test('nearestCorner reads the quadrant', () => {
  const field = { width: 1000, height: 600 };
  assert.equal(G().nearestCorner({ x: 10, y: 10 }, field), 'tl');
  assert.equal(G().nearestCorner({ x: 990, y: 10 }, field), 'tr');
  assert.equal(G().nearestCorner({ x: 10, y: 590 }, field), 'bl');
  assert.equal(G().nearestCorner({ x: 990, y: 590 }, field), 'br');
  assert.equal(G().nearestCorner({ x: 2000, y: -50 }, field), 'tr', 'a projection past the field still picks a corner');
});

const fly = (damping, { seconds = 2, dt = 1 / 120 } = {}) => {
  let state = { x: 0, v: 0 };
  let peak = 0;
  for (let t = 0; t < seconds; t += dt) {
    state = G().spring(state, 100, dt, { damping, response: 0.4 });
    peak = Math.max(peak, state.x);
  }
  return { state, peak };
};

test('a critically damped spring reaches the target without overshoot', () => {
  const { state, peak } = fly(1);
  assert.ok(Math.abs(state.x - 100) < 0.5, `ends at ${state.x}`);
  assert.ok(peak <= 100.5, `peaked at ${peak}`);
  assert.ok(G().settled(state, 100));
});

test('an underdamped spring overshoots and still settles', () => {
  const { state, peak } = fly(0.8);
  assert.ok(peak > 101, `peaked at ${peak}`);
  assert.ok(Math.abs(state.x - 100) < 0.5, `ends at ${state.x}`);
});

test('a spring started with velocity carries it', () => {
  const still = G().spring({ x: 0, v: 0 }, 100, 1 / 120, { damping: 1 });
  const thrown = G().spring({ x: 0, v: 2000 }, 100, 1 / 120, { damping: 1 });
  assert.ok(thrown.x > still.x);
});

test('settled needs both a near position and a slow velocity', () => {
  assert.equal(G().settled({ x: 100.2, v: 0 }, 100), true);
  assert.equal(G().settled({ x: 100.2, v: 50 }, 100), false);
  assert.equal(G().settled({ x: 103, v: 0 }, 100), false);
});
