// The arithmetic the marks tools stand on: what a rectangle means on a page of
// addressed boxes, what a drawn stroke means, and how a stroke is held to the
// element it was drawn on.
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

// The Drive's own home page: a sidebar holding a visible pins list, a visible
// recents list, and `<ul class="folder-tints" hidden>` between them. A hidden
// element has a zero-area box, so it can never be a candidate — and a rule
// that asks for *every* addressed child would let it veto its parent forever.
const SIDEBAR = [
  { id: 'side', parent: null, left: 0, top: 0, width: 200, height: 300 },
  { id: 'pins', parent: 'side', left: 8, top: 8, width: 184, height: 140 },
  { id: 'tints', parent: 'side', left: 8, top: 148, width: 0, height: 0 },
  { id: 'recent', parent: 'side', left: 8, top: 152, width: 184, height: 140 },
];

test('a hidden, zero-area child does not stop its parent from coalescing', () => {
  assert.deepEqual(G().idsInRect(rect(-10, -10, 210, 310), SIDEBAR), ['side']);
});

test('a parent whose only children are zero-area is still chosen on its own', () => {
  const empty = [
    { id: 'wrap', parent: null, left: 0, top: 0, width: 200, height: 100 },
    { id: 'ghost', parent: 'wrap', left: 0, top: 0, width: 0, height: 0 },
  ];
  assert.deepEqual(G().idsInRect(rect(-10, -10, 210, 110), empty), ['wrap']);
});

// ---------------------------------------------------------------- strokes

/** A hand, not a plotter: every point is nudged off the ideal line, so a
 *  reading that only works on clean geometry fails here. */
const wobble = (points, amount = 1.5) => points.map((p, i) => ({
  x: p.x + Math.sin(i * 2.3) * amount,
  y: p.y + Math.cos(i * 1.7) * amount,
}));
const line = (from, to, steps = 24) => Array.from({ length: steps + 1 }, (_, i) => ({
  x: from.x + ((to.x - from.x) * i) / steps,
  y: from.y + ((to.y - from.y) * i) / steps,
}));
const boxStroke = (left, top, right, bottom) => [
  ...line({ x: left, y: top }, { x: right, y: top }),
  ...line({ x: right, y: top }, { x: right, y: bottom }),
  ...line({ x: right, y: bottom }, { x: left, y: bottom }),
  ...line({ x: left, y: bottom }, { x: left, y: top }),
];
const circle = (cx, cy, r, steps = 48) => Array.from({ length: steps + 1 }, (_, i) => ({
  x: cx + r * Math.cos((i / steps) * 2 * Math.PI),
  y: cy + r * Math.sin((i / steps) * 2 * Math.PI),
}));

test('a hand-drawn box around something is a box', () => {
  assert.equal(G().readStroke(wobble(boxStroke(40, 140, 640, 200))), 'box');
});

test('a circle drawn round something is a box too — it encloses, which is what the reading says', () => {
  assert.equal(G().readStroke(wobble(circle(300, 170, 90))), 'box');
});

test('a stroke from one place to another is an arrow', () => {
  assert.equal(G().readStroke(wobble(line({ x: 60, y: 60 }, { x: 560, y: 300 }))), 'arrow');
});

test('a scribble that happens to end where it started is still ink', () => {
  const scribble = [];
  for (let i = 0; i <= 200; i += 1) {
    const t = (i / 200) * Math.PI * 8;
    scribble.push({ x: 300 + 120 * Math.sin(t), y: 200 + 60 * Math.sin(t * 2.7) });
  }
  assert.equal(G().readStroke(scribble), 'ink');
});

test('a stroke over a line of words is ink, and a tap is ink rather than an arrow of no length', () => {
  assert.equal(G().readStroke(wobble(line({ x: 40, y: 100 }, { x: 160, y: 104 }), 6)), 'ink');
  assert.equal(G().readStroke([{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 11 }]), 'ink');
  assert.equal(G().readStroke([{ x: 10, y: 10 }]), 'ink');
  assert.equal(G().readStroke(null), 'ink');
});

test('a short stroke at the end of an arrow is its head, and which end says which way it points', () => {
  const shaft = line({ x: 60, y: 60 }, { x: 560, y: 300 });
  const arrow = { kind: 'arrow', points: shaft };
  const head = [{ x: 540, y: 270 }, { x: 560, y: 300 }, { x: 520, y: 300 }];
  assert.equal(G().arrowHeadFor(arrow, head, { elapsed: 120 }), 'end');
  const atStart = [{ x: 80, y: 40 }, { x: 60, y: 60 }, { x: 90, y: 70 }];
  assert.equal(G().arrowHeadFor(arrow, atStart, { elapsed: 120 }), 'start');
});

test('a mark of its own is not a head: too late, too long, too far away, or not on an arrow', () => {
  const shaft = line({ x: 60, y: 60 }, { x: 560, y: 300 });
  const arrow = { kind: 'arrow', points: shaft };
  const head = [{ x: 540, y: 270 }, { x: 560, y: 300 }, { x: 520, y: 300 }];
  assert.equal(G().arrowHeadFor(arrow, head, { elapsed: 900 }), null, 'a minute later is a new mark');
  assert.equal(G().arrowHeadFor(arrow, line({ x: 500, y: 300 }, { x: 100, y: 320 }), { elapsed: 100 }), null, 'as long as the shaft is not a head');
  assert.equal(G().arrowHeadFor(arrow, [{ x: 300, y: 500 }, { x: 320, y: 510 }, { x: 300, y: 520 }], { elapsed: 100 }), null, 'nowhere near either end');
  assert.equal(G().arrowHeadFor({ kind: 'box', points: shaft }, head, { elapsed: 100 }), null, 'a box has no head');
  assert.equal(G().arrowHeadFor(null, head, { elapsed: 100 }), null);
});

test('a stroke is kept as fractions of its anchor, so it survives the element moving and resizing', () => {
  const box = { left: 100, top: 100, width: 200, height: 100 };
  const points = [{ x: 100, y: 100 }, { x: 200, y: 150 }, { x: 340, y: 210 }];
  const pairs = G().toFractions(box, points);
  assert.deepEqual(pairs[0], [0, 0]);
  assert.deepEqual(pairs[1], [0.5, 0.5]);
  assert.deepEqual(pairs[2], [1.2, 1.1], 'a stroke may run past its anchor');
  assert.deepEqual(G().fromFractions(box, pairs), points, 'round trip');
  // Scrolled 40px up and grown by half: the stroke is where the element is.
  const moved = { left: 100, top: 60, width: 300, height: 100 };
  assert.deepEqual(G().fromFractions(moved, pairs)[1], { x: 250, y: 110 });
});

test('a zero-sized anchor does not divide by it', () => {
  const pairs = G().toFractions({ left: 0, top: 0, width: 0, height: 0 }, [{ x: 5, y: 5 }]);
  assert.deepEqual(pairs, [[0, 0]]);
});

test('bounds, length and centroid are the three things a reading is made of', () => {
  const points = [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 0 }];
  assert.deepEqual(G().boundsOf(points), { left: 0, top: 0, width: 30, height: 40 });
  assert.equal(G().lengthOf(points), 90);
  assert.deepEqual(G().centroidOf(points), { x: 20, y: 40 / 3 });
  assert.deepEqual(G().boundsOf([]), { left: 0, top: 0, width: 0, height: 0 });
  assert.deepEqual(G().centroidOf([]), { x: 0, y: 0 });
});
