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
