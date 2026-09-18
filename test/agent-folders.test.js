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

const cards = (prefix, n, lod) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, lod }));

const overlap = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const inside = (rect, region) =>
  rect.x >= region.x - 0.01 && rect.y >= region.y - 0.01 &&
  rect.x + rect.w <= region.x + region.w + 0.01 &&
  rect.y + rect.h <= region.y + region.h + 0.01;

test('packRegions gives every folder a region that no other region touches', () => {
  const { regions } = F().packRegions({
    groups: [
      { folderId: 'aaaaaaaaaaaa', cards: cards('a', 4, 'digest') },
      { folderId: 'bbbbbbbbbbbb', cards: cards('b', 3, 'chip') },
      { folderId: 'cccccccccccc', cards: cards('c', 2, 'digest') },
      { folderId: null, cards: cards('u', 3, 'chip') },
    ],
    canvas: { w: 1440, h: 840 },
    sizes: SIZES,
  });
  assert.equal(regions.length, 4);
  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) {
      assert.equal(overlap(regions[i], regions[j]), false, `${i} overlaps ${j}`);
    }
  }
});

test('packRegions keeps every card inside its own region', () => {
  const groups = [
    { folderId: 'aaaaaaaaaaaa', cards: [...cards('a', 3, 'digest'), ...cards('ac', 4, 'chip')] },
    { folderId: 'bbbbbbbbbbbb', cards: cards('b', 5, 'digest') },
    { folderId: null, cards: cards('u', 2, 'chip') },
  ];
  const { regions, rects } = F().packRegions({ groups, canvas: { w: 1440, h: 840 }, sizes: SIZES });
  for (const group of groups) {
    const region = regions.find((row) => row.folderId === group.folderId);
    for (const card of group.cards) {
      assert.ok(inside(rects[card.id], region), `${card.id} escaped its region`);
    }
  }
});

test('packRegions never places a region off the left or top edge', () => {
  const { regions, height } = F().packRegions({
    groups: [
      { folderId: 'aaaaaaaaaaaa', cards: cards('a', 9, 'digest') },
      { folderId: 'bbbbbbbbbbbb', cards: cards('b', 9, 'digest') },
      { folderId: 'cccccccccccc', cards: cards('c', 9, 'digest') },
    ],
    canvas: { w: 900, h: 700 },
    top: 40,
    sizes: SIZES,
  });
  for (const region of regions) {
    assert.ok(region.x >= 0, 'negative left');
    assert.ok(region.y >= 40, 'above the stage');
  }
  // Too wide for one shelf, so it wraps and reports a taller field.
  assert.ok(height > 700, `expected a scrolling field, got ${height}`);
});

test('packRegions orders a region by the stored drag hints', () => {
  const { rects } = F().packRegions({
    groups: [{
      folderId: 'aaaaaaaaaaaa',
      cards: [
        { id: 'last', lod: 'digest', ox: 0.9, oy: 0.9 },
        { id: 'first', lod: 'digest', ox: 0.1, oy: 0.1 },
      ],
    }],
    canvas: { w: 1440, h: 840 },
    sizes: SIZES,
  });
  assert.ok(rects.first.x < rects.last.x || rects.first.y < rects.last.y);
});

test('packRegions drops folders with no matching cards', () => {
  const { regions } = F().packRegions({
    groups: [
      { folderId: 'aaaaaaaaaaaa', cards: [] },
      { folderId: 'bbbbbbbbbbbb', cards: cards('b', 1, 'digest') },
    ],
    canvas: { w: 1440, h: 840 },
    sizes: SIZES,
  });
  assert.deepEqual(regions.map((row) => row.folderId), ['bbbbbbbbbbbb']);
});
