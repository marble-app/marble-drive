import assert from 'node:assert/strict';
import test from 'node:test';

import '../runtime/agent-folders.js';

const F = () => globalThis.marbleAgentFolders;

test('suggestName uses the most specific shared path segment', () => {
  assert.equal(F().suggestName(['Research/Marble/a', 'Research/Marble/b']), 'Marble');
  assert.equal(F().suggestName(['Research/x', 'Fun/y']), 'Group');
  assert.equal(F().suggestName([]), 'Group');
});

test('realmOf reads Drive’s first-segment map', () => {
  assert.equal(F().realmOf('Research/Marble/uist'), 'research');
  assert.equal(F().realmOf("Bryan's Days/today"), 'days');
  assert.equal(F().realmOf(''), '');
});

test('nextColor skips keys already used', () => {
  assert.equal(F().nextColor([]), 'research');
  assert.equal(F().nextColor(['research', 'fun']), 'days');
  const all = [...F().COLOR_KEYS];
  assert.equal(F().nextColor(all), 'research');
});

test('assignLods never chips a selected, running, or review card', () => {
  const cards = [
    { id: 'a', running: false, needsReview: false, lastInteractedAt: 0, updatedAt: 0 },
    { id: 'b', running: true, needsReview: false, lastInteractedAt: 0, updatedAt: 0 },
    { id: 'c', running: false, needsReview: true, lastInteractedAt: 0, updatedAt: 0 },
  ];
  const lods = F().assignLods(cards, {
    fullIds: ['a'],
    selectedIds: [],
    hoveredId: null,
    now: 1_000_000,
  });
  assert.equal(lods.a, 'full');
  assert.equal(lods.b, 'digest');
  assert.equal(lods.c, 'digest');
});

test('cold unfocused cards chip once Digest budget is exceeded', () => {
  const cards = Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    running: false,
    needsReview: false,
    lastInteractedAt: 0,
    updatedAt: 0,
  }));
  const lods = F().assignLods(cards, {
    fullIds: [],
    selectedIds: [],
    hoveredId: null,
    now: 60_000,
  });
  const digest = Object.values(lods).filter((v) => v === 'digest').length;
  const chip = Object.values(lods).filter((v) => v === 'chip').length;
  assert.equal(digest, 4);
  assert.equal(chip, 2);
});

test('nearestCard picks the nearest card in a 90 degree cone', () => {
  const cards = [
    { id: 'o', cx: 0, cy: 0 },
    { id: 'r', cx: 10, cy: 1 },
    { id: 'far', cx: 40, cy: 2 },
    { id: 'up', cx: 1, cy: -10 },
  ];
  assert.equal(F().nearestCard(cards, 'o', 'right').id, 'r');
  assert.equal(F().nearestCard(cards, 'o', 'up').id, 'up');
  assert.equal(F().nearestCard(cards, 'o', 'left'), null);
});

const SIZES = { digest: { w: 260, h: 132 }, chip: { w: 168, h: 56 } };
const CANVAS = { w: 1440, h: 810 };

const cards = (prefix, n, lod) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, lod }));

const overlap = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const inside = (rect, region) =>
  rect.x >= region.x - 0.01 && rect.y >= region.y - 0.01 &&
  rect.x + rect.w <= region.x + region.w + 0.01 &&
  rect.y + rect.h <= region.y + region.h + 0.01;

const pack = (opts) => F().packFocus({ canvas: CANVAS, sizes: SIZES, ...opts });
const MARGIN = 16;

const FIELD = [
  { folderId: 'aaaaaaaaaaaa', cards: cards('a', 4, 'digest') },
  { folderId: 'bbbbbbbbbbbb', cards: [...cards('b', 2, 'digest'), ...cards('bc', 2, 'chip')] },
  { folderId: null, cards: cards('u', 3, 'chip') },
];

test('packFocus gives every folder a column no other column touches', () => {
  const { stage, regions } = pack({ fulls: [{ id: 'f0' }, { id: 'f1' }], groups: FIELD });
  const boxes = [...stage.cols, ...regions];
  assert.equal(regions.length, 3);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.equal(overlap(boxes[i], boxes[j]), false, `${i} overlaps ${j}`);
    }
  }
});

test('packFocus keeps every card inside its own column', () => {
  const { regions, rects } = pack({ groups: FIELD });
  for (const group of FIELD) {
    const region = regions.find((row) => row.folderId === group.folderId);
    for (const card of group.cards) {
      assert.ok(inside(rects[card.id], region), `${card.id} escaped its column`);
    }
  }
});

test('a pinned Full is a full-height column, not a band across the top', () => {
  const { stage } = pack({ fulls: [{ id: 'f0' }, { id: 'f1' }], groups: FIELD });
  assert.equal(stage.cols.length, 2);
  for (const col of stage.cols) {
    // A conversation is a tall thing. The old stage was min(h * .52, 460).
    assert.ok(col.h > CANVAS.h * 0.9, `stage column only ${col.h} tall`);
    assert.ok(col.w >= F().PANE_MIN, `stage column only ${col.w} wide`);
  }
  assert.ok(stage.cols[0].x < stage.cols[1].x, 'rank reads left to right');
  assert.equal(Math.round(stage.cols[0].y), Math.round(stage.cols[1].y), 'one row');
});

test('the field never starts above the stage it sits beside', () => {
  const { stage, regions } = pack({ fulls: [{ id: 'f0' }], groups: FIELD });
  for (const region of regions) assert.ok(region.x >= stage.x + stage.w, 'a folder column overlapped the stage');
  assert.equal(Math.round(regions[0].y), Math.round(stage.y), 'the field is beside, not below');
});

test('a deep folder wraps into a second sub-column', () => {
  const { regions } = pack({ groups: [{ folderId: 'deep', cards: cards('d', 12, 'digest') }] });
  const region = regions[0];
  const columns = new Set(region.cards.map((card) => Math.round(card.x)));
  assert.ok(columns.size > 1, 'expected the column to widen');
  for (const card of region.cards) {
    assert.ok(card.y + card.h <= region.y + region.h + 0.01, 'a card ran past the canvas');
  }
});

test('every field card spans its column, so a chip is a row and not a ragged edge', () => {
  const { regions, colW } = pack({ groups: FIELD });
  for (const region of regions) {
    for (const card of region.cards) assert.equal(card.w, colW);
  }
});

test('the canvas scrolls sideways rather than pinning a conversation below reading width', () => {
  const four = pack({ fulls: cards('f', 4, 'full'), groups: FIELD });
  for (const col of four.stage.cols) assert.ok(col.w >= F().PANE_MIN);
  assert.ok(four.width > CANVAS.w, 'four pins and three folders should scroll');
  assert.equal(four.height, CANVAS.h, 'and never scroll vertically');
});

test('one pin and a small field fit without scrolling, and the pane takes the slack', () => {
  const packed = pack({ fulls: [{ id: 'f0' }], groups: [FIELD[0]] });
  assert.equal(packed.width, CANVAS.w);
  assert.ok(packed.stage.cols[0].w >= F().PANE_PREF, 'slack belongs to the conversation');
  // Nothing is left as air: the pane and the column grow past their
  // preferred widths until the New-group slot touches the right edge.
  assert.ok(packed.stage.cols[0].w > F().PANE_MAX, 'the pane grows into the leftover width');
  assert.ok(packed.newGroup, 'the New-group slot is still offered');
  assert.ok(Math.abs(packed.newGroup.x + packed.newGroup.w + MARGIN - CANVAS.w) < 1, 'the field reaches the right edge');
});

test('a lone region fills its column, and the columns share a wide canvas', () => {
  const packed = pack({ groups: [FIELD[0]] });
  const [region] = packed.regions;
  assert.ok(Math.abs(region.h - (CANVAS.h - 2 * MARGIN)) < 1, `a lone region is as tall as the canvas, not ${region.h}`);
  assert.ok(packed.colW > F().FIELD_MAX, `columns widen past FIELD_MAX to fill, got ${packed.colW}`);
  assert.ok(Math.abs(packed.newGroup.x + packed.newGroup.w + MARGIN - CANVAS.w) < 1, 'the New-group slot sits at the edge');
  for (const card of region.cards) assert.ok(inside(card, region));
  assert.equal(region.cards[0].y, region.inner.y, 'cards stay at the top of a grown region');
});

test('packFocus orders a column by the stored rank', () => {
  const { rects } = pack({
    groups: [{
      folderId: 'aaaaaaaaaaaa',
      cards: [
        { id: 'last', lod: 'digest', oy: 0.9 },
        { id: 'first', lod: 'digest', oy: 0.1 },
        { id: 'unranked', lod: 'digest' },
      ],
    }],
  });
  assert.ok(rects.first.y < rects.last.y, 'rank reads down a column');
  assert.ok(rects.unranked.y > rects.last.y, 'an unranked card joins the bottom');
});

test('packFocus drops folders with no matching cards', () => {
  const { regions } = pack({
    groups: [
      { folderId: 'aaaaaaaaaaaa', cards: [] },
      { folderId: 'bbbbbbbbbbbb', cards: cards('b', 1, 'digest') },
    ],
  });
  assert.deepEqual(regions.map((row) => row.folderId), ['bbbbbbbbbbbb']);
});

test('the New group column appears when there is room, and always during a drag', () => {
  const roomy = pack({ groups: [FIELD[0]] });
  assert.ok(roomy.newGroup, 'a wide canvas has room to offer one');
  assert.ok(roomy.newGroup.x >= roomy.regions[0].x + roomy.regions[0].w);

  const tight = pack({ fulls: cards('f', 4, 'full'), groups: FIELD });
  assert.equal(tight.newGroup, null, 'it costs the conversations nothing');

  const dragging = pack({ fulls: cards('f', 4, 'full'), groups: FIELD, newGroup: 'always' });
  assert.ok(dragging.newGroup, 'but it is there when it is what you are aiming at');
});

test('slotAt names the gap a drop would land in', () => {
  const { regions } = pack({ groups: [{ folderId: 'one', cards: cards('a', 3, 'digest') }] });
  const region = regions[0];
  const [first, second, third] = region.cards;

  assert.equal(F().slotAt(region, { x: first.x + 10, y: first.y + 2 }).index, 0);
  assert.equal(F().slotAt(region, { x: first.x + 10, y: second.y + 2 }).index, 1);
  assert.equal(F().slotAt(region, { x: first.x + 10, y: third.y + third.h + 40 }).index, 3);
});

test('slotAt reports the card a point sits squarely on, which is the merge reading', () => {
  const { regions } = pack({ groups: [{ folderId: null, cards: cards('u', 2, 'digest') }] });
  const region = regions[0];
  const card = region.cards[0];
  assert.equal(F().slotAt(region, { x: card.x + 10, y: card.y + card.h / 2 }).over, card.id);
  assert.equal(F().slotAt(region, { x: card.x + 10, y: card.y + 2 }).over, null);
});

test('slotAt picks the sub-column the point is nearest', () => {
  const { regions } = pack({ groups: [{ folderId: 'deep', cards: cards('d', 12, 'digest') }] });
  const region = regions[0];
  const second = region.cards.find((card) => card.x > region.cards[0].x);
  const slot = F().slotAt(region, { x: second.x + 10, y: second.y + 2 });
  assert.equal(Math.round(slot.x), Math.round(second.x));
  assert.equal(slot.index, region.cards.indexOf(second));
});

test('an empty region still offers a slot', () => {
  const { regions } = pack({ groups: [{ folderId: 'one', cards: cards('a', 1, 'digest') }] });
  const empty = { ...regions[0], cards: [] };
  assert.deepEqual(F().slotAt(empty, { x: empty.x, y: empty.y }).index, 0);
});

test('stageSlotAt names the gap between two panes', () => {
  const { stage } = pack({ fulls: [{ id: 'f0' }, { id: 'f1' }], groups: FIELD });
  const [a, b] = stage.cols;
  assert.equal(F().stageSlotAt(stage, { x: a.x + 4, y: a.y + 40 }).index, 0);
  assert.equal(F().stageSlotAt(stage, { x: b.x + 4, y: b.y + 40 }).index, 1);
  assert.equal(F().stageSlotAt(stage, { x: b.x + b.w, y: b.y + 40 }).index, 2);
});

test('rankFor takes the midpoint, and asks to renumber when there is none', () => {
  assert.equal(F().rankFor([0.25, 0.5, 0.75], 1), 0.375);
  assert.equal(F().rankFor([0.25, 0.5], 0), 0.125);
  assert.equal(F().rankFor([0.25, 0.5], 2), 0.75);
  assert.equal(F().rankFor([], 0), 0.5);
  // An unranked neighbour has no midpoint to take.
  assert.equal(F().rankFor([0.25, undefined], 2), null);
  assert.equal(F().rankFor([undefined, 0.5], 0), null);
  // Nor has a pair a float can no longer split.
  assert.equal(F().rankFor([0.5, 0.50001], 1), null);
});

test('ranks numbers a column strictly inside the range the store clamps to', () => {
  const out = F().ranks(4);
  assert.equal(out.length, 4);
  for (let i = 0; i < out.length; i += 1) {
    assert.ok(out[i] > 0 && out[i] < 1, `${out[i]} outside (0,1)`);
    if (i) assert.ok(out[i] > out[i - 1], 'ranks must increase');
  }
});

test('byRank is stable, so an untouched column keeps the order it came in', () => {
  const out = F().byRank([
    { id: 'c' }, { id: 'd' }, { id: 'b', oy: 0.6 }, { id: 'a', oy: 0.2 },
  ]);
  assert.deepEqual(out.map((row) => row.id), ['a', 'b', 'c', 'd']);
});

test('assignLods does not promote a hovered card — hover informs, selection commits', () => {
  const cards = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, lastInteractedAt: 0, updatedAt: 0 }));
  const cold = F().assignLods(cards, { fullIds: [], selectedIds: [], hoveredId: 'c7', now: 1e12 });
  const plain = F().assignLods(cards, { fullIds: [], selectedIds: [], hoveredId: null, now: 1e12 });
  assert.deepEqual(cold, plain);
});

test('steadySlot holds the current slot while the pointer hovers a midline', () => {
  const prev = { column: 'folder', folderId: 'a', key: 'folder:a:2', index: 2, edge: 300 };
  const flip = { column: 'folder', folderId: 'a', key: 'folder:a:3', index: 3, edge: 300 };
  assert.equal(F().steadySlot(prev, flip, { y: 305 }), prev, 'within the band, the old answer stands');
  assert.equal(F().steadySlot(prev, flip, { y: 312 }), flip, 'past it, the new one wins');
  assert.equal(F().steadySlot(prev, { column: 'folder', folderId: 'b', key: 'folder:b:0', index: 0, edge: 40 }, { y: 305 }).key, 'folder:b:0', 'a different column is never held');
  assert.equal(F().steadySlot(null, flip, { y: 305 }), flip);
});

test('two small folders sit one above the other, not in two mostly-empty columns', () => {
  const two = [
    { folderId: 'aaaaaaaaaaaa', cards: cards('a', 2, 'digest') },
    { folderId: 'bbbbbbbbbbbb', cards: cards('b', 2, 'digest') },
  ];
  const { regions } = pack({ groups: two });
  assert.equal(regions.length, 2);
  assert.equal(Math.round(regions[0].x), Math.round(regions[1].x), 'same field column');
  assert.ok(regions[1].y >= regions[0].y + regions[0].h, 'the second sits below the first');
  assert.ok(regions[0].h < CANVAS.h * 0.6, 'the column is shared, not taken by the first');
  assert.ok(Math.abs(regions[1].y + regions[1].h - (CANVAS.h - MARGIN)) < 1, 'together they fill the column');
  assert.equal(regions[0].col, 0);
  assert.equal(regions[1].col, 0);
});

test('a region that does not fit under the previous one starts the next field column', () => {
  const groups = [
    { folderId: 'aaaaaaaaaaaa', cards: cards('a', 4, 'digest') },
    { folderId: 'bbbbbbbbbbbb', cards: cards('b', 4, 'digest') },
    { folderId: null, cards: cards('u', 1, 'chip') },
  ];
  const { regions } = pack({ groups });
  assert.ok(regions[1].x > regions[0].x || regions[1].y >= regions[0].y + regions[0].h);
  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) assert.equal(overlap(regions[i], regions[j]), false, `${i} overlaps ${j}`);
  }
  assert.equal(regions.at(-1).folderId, null, 'ungrouped is last');
  for (const region of regions) assert.ok(region.y + region.h <= CANVAS.h, 'nothing runs past the canvas');
});

test('regionAt answers the region under a point, else the nearest', () => {
  const two = [
    { folderId: 'aaaaaaaaaaaa', cards: cards('a', 2, 'digest') },
    { folderId: 'bbbbbbbbbbbb', cards: cards('b', 2, 'digest') },
  ];
  const packed = pack({ groups: two });
  const [a, b] = packed.regions;
  assert.equal(F().regionAt(packed, { x: a.x + 5, y: a.y + 5 }).folderId, a.folderId);
  assert.equal(F().regionAt(packed, { x: b.x + 5, y: b.y + b.h + 200 }).folderId, b.folderId, 'below everything → nearest');
  assert.equal(F().regionAt({ regions: [] }, { x: 0, y: 0 }), null);
});
