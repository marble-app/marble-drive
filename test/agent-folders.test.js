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

// The digest card is a golden rectangle; `focusLodSize` in the template
// names the same 260 × 161, and the packer falls back to it.
const SIZES = { digest: { w: 260, h: 161 }, chip: { w: 168, h: 56 } };
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
// The canvas margin is the module's to decide; a copy here goes stale the
// first time the layout is tightened.
const MARGIN = F().MARGIN;

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

test('the field stands to the left of the stage, never above it', () => {
  const { stage, regions } = pack({ fulls: [{ id: 'f0' }], groups: FIELD });
  // Priority rises to the right: folders first, the pins at the far edge.
  for (const region of regions) assert.ok(region.x + region.w <= stage.x + 0.01, 'a folder column overlapped the stage');
  assert.ok(stage.x > regions[0].x, 'the stage is the right-hand end of the row');
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

test('the field folds into piles rather than letting the canvas scroll sideways', () => {
  const four = pack({ fulls: cards('f', 4, 'full'), groups: FIELD });
  for (const col of four.stage.cols) assert.ok(col.w >= F().PANE_MIN, `a pane went under reading width at ${col.w}`);
  assert.equal(four.width, CANVAS.w, 'the canvas never scrolls sideways');
  assert.equal(four.height, CANVAS.h, 'and never scroll vertically');
  // Three folders cannot stand beside four conversations on a 1440 canvas, so
  // they fold: each becomes a pile, and the stage gets the width they were in.
  assert.equal(four.piles.length, 3, 'every group folded to make room');
  assert.equal(four.regions.filter((region) => !region.piled).length, 0);
  const railH = four.piles.reduce((sum, pile) => sum + pile.h, 0) + (four.piles.length - 1) * F().GAP;
  for (const pile of four.piles) {
    assert.equal(pile.w, F().PILE_W, 'a pile is a tab, a finger wide');
    assert.ok(pile.h >= F().PILE_MIN_H, `a tab is never shorter than a word, got ${Math.round(pile.h)}`);
    assert.ok(pile.x + pile.w <= four.stage.x, 'a pile is the low end of the row');
  }
  // The rail is full from top to bottom: the tabs divide the canvas's height
  // between them rather than sitting in a stack with white space under it.
  assert.ok(Math.abs(railH - (CANVAS.h - 2 * MARGIN)) < 2, `the rail left white space: ${Math.round(railH)}`);
  assert.deepEqual(four.piles.map((pile) => pile.folderId), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', null],
    'the rail reads in catalog order, whatever order things folded in');
});

test('a group with recent work stays open while a stale one folds', () => {
  const packed = F().packFocus({
    canvas: { w: 1000, h: 810 },
    sizes: SIZES,
    fulls: cards('f', 2, 'full'),
    groups: [
      { ...FIELD[0], weight: 10 },
      { ...FIELD[1], weight: 5_000 },
      { ...FIELD[2], weight: 900 },
    ],
  });
  assert.equal(packed.width, 1000);
  const open = packed.regions.filter((region) => !region.piled).map((region) => region.folderId);
  assert.ok(open.includes('bbbbbbbbbbbb'), 'the heaviest group is the last one standing');
  assert.ok(packed.piles.some((pile) => pile.folderId === 'aaaaaaaaaaaa'), 'the lightest folded first');
});

test('a folded group costs a tab of width, not a column', () => {
  // The shape of the complaint: one open group and one big folded one. Laid
  // flat, the folded one charged the stage a whole column to use thirty pixels
  // of it. On its side it is a tab, and the stage keeps the rest.
  const groups = [
    { folderId: 'polish000000', cards: cards('p', 4, 'digest'), weight: 9e12 },
    { folderId: null, cards: cards('u', 23, 'chip') },
  ];
  const packed = F().packFocus({ canvas: { w: 1600, h: 810 }, sizes: SIZES, fulls: cards('f', 4, 'full'), groups });
  assert.equal(packed.piles.length, 1, 'Ungrouped folded');
  const [pile] = packed.piles;
  const open = packed.regions.filter((region) => !region.piled);
  assert.equal(open.length, 1);
  const [region] = open;
  assert.equal(pile.w, F().PILE_W);
  assert.ok(pile.w < 40, 'a tab is a finger wide');
  // Full height, and standing to the left of everything else in the row.
  assert.ok(Math.abs(pile.h - (810 - 2 * MARGIN)) < 2, 'one tab fills the rail');
  assert.ok(pile.x + pile.w <= region.x + 0.5, 'the rail is the low end of the row');
  assert.ok(pile.x + pile.w <= packed.stage.x);

  // And a group held open is not a column either: the rail widens once, to one
  // field column's floor, and the entry lists its chats inside it.
  const apart = F().packFocus({
    canvas: { w: 1600, h: 810 }, sizes: SIZES, fulls: cards('f', 4, 'full'), groups, opened: [null],
  });
  const unrolled = apart.regions.find((r) => r.opened && r.folderId === null);
  assert.ok(unrolled, 'the opened group is drawn, expanded, in the rail');
  assert.equal(unrolled.w, F().PILE_OPEN_W, 'the rail widened to exactly one column floor');
  assert.ok(unrolled.cards.length > 0, 'and it lists its chats');
  assert.ok(unrolled.x + unrolled.w <= apart.stage.x, 'still at the low end of the row');
  // Opening costs the stage the rail's widening and nothing else — it is a
  // peek, not a promotion back to a column of its own.
  assert.ok(apart.stage.w >= packed.stage.w - (F().PILE_OPEN_W - F().PILE_W) - 2,
    `opening cost more than the rail's widening (${Math.round(packed.stage.w)} → ${Math.round(apart.stage.w)})`);
});

test('an opened entry lists what fits and says how much it did not', () => {
  const groups = [{ folderId: null, cards: cards('u', 40, 'chip') }];
  const packed = F().packFocus({
    canvas: { w: 1200, h: 810 }, sizes: SIZES, fulls: cards('f', 3, 'full'), groups, opened: [null],
  });
  const [unrolled] = packed.regions.filter((region) => region.opened);
  assert.ok(unrolled, 'opened');
  assert.equal(unrolled.count, 40);
  assert.ok(unrolled.cards.length > 0 && unrolled.cards.length < 40, 'shows what fits');
  assert.equal(unrolled.hidden, 40 - unrolled.cards.length, 'and counts what it could not');
  assert.equal(unrolled.hiddenIds.length, unrolled.hidden, 'naming every card it did not seat');
  // Nothing it drew ran off the bottom of the canvas.
  for (const card of unrolled.cards) assert.ok(card.y + card.h <= 810 - MARGIN + 1, 'a row escaped the rail');
  assert.equal(packed.width, 1200);
});

test('too many groups for tabs and each becomes a square with its count', () => {
  const groups = Array.from({ length: 18 }, (_, i) => (
    { folderId: `f${String(i).padStart(11, '0')}`, cards: cards(`g${i}`, i + 1, 'digest') }
  ));
  const packed = F().packFocus({ canvas: { w: 1100, h: 810 }, sizes: SIZES, fulls: cards('f', 3, 'full'), groups });
  assert.equal(packed.piles.length, 18, 'every group folded');
  for (const pile of packed.piles) {
    assert.equal(pile.form, 'dot', 'eighteen tabs cannot each have a readable run of height');
    assert.equal(pile.w, F().PILE_DOT);
    assert.equal(pile.h, F().PILE_DOT);
    assert.ok(pile.count > 0, 'and a square carries its count');
  }
  // The squares spread down the rail rather than stacking at the top: the
  // white space under a short stack was the complaint that started this.
  const ys = packed.piles.map((pile) => pile.y).sort((a, b) => a - b);
  assert.ok(ys[ys.length - 1] + F().PILE_DOT > 810 - 2 * MARGIN - F().PILE_DOT,
    'the rail should be full top to bottom');
  // And a square costs less width than a tab did.
  assert.ok(F().PILE_DOT < F().PILE_W);
  assert.equal(packed.width, 1100);
});

test('many piles stack down one column rather than across several', () => {
  const groups = Array.from({ length: 6 }, (_, i) => ({ folderId: `f${i}${'0'.repeat(11 - String(i).length)}`, cards: cards(`g${i}`, 3, 'digest') }));
  const packed = F().packFocus({ canvas: { w: 1200, h: 810 }, sizes: SIZES, fulls: cards('f', 3, 'full'), groups });
  assert.ok(packed.piles.length >= 2, 'the canvas is tight enough to fold several');
  const xs = new Set(packed.piles.map((pile) => Math.round(pile.x)));
  assert.equal(xs.size, 1, `piles should share one column, stood in ${xs.size}`);
  const stacked = [...packed.piles].sort((a, b) => a.y - b.y);
  for (let i = 1; i < stacked.length; i += 1) {
    const above = stacked[i - 1];
    assert.ok(stacked[i].y >= above.y + above.h - 0.5, 'and not overlap');
  }
  const railH = stacked.reduce((sum, pile) => sum + pile.h, 0) + (stacked.length - 1) * F().GAP;
  assert.ok(Math.abs(railH - (810 - 2 * MARGIN)) < 2, 'and fill the rail top to bottom');
  assert.equal(packed.width, 1200);
});

test('a group the person opened is never folded, however tight the canvas', () => {
  const tight = { canvas: { w: 900, h: 810 }, sizes: SIZES, fulls: cards('f', 3, 'full'), groups: FIELD };
  const shut = F().packFocus(tight);
  assert.equal(shut.piles.length, 3, 'left alone, three pins on a 900px canvas fold everything');
  // Held open, the shortfall comes off the panes instead — which is the whole
  // point: the person said they wanted to see this group.
  const held = F().packFocus({ ...tight, opened: [null] });
  assert.ok(held.regions.some((region) => region.folderId === null && !region.piled), 'Ungrouped stayed open');
  assert.ok(!held.piles.some((pile) => pile.folderId === null), 'and is not also a pile');
  assert.equal(held.width, 900, 'and the canvas still does not scroll');
  assert.ok(held.stage.cols[0].w < shut.stage.cols[0].w, 'the panes paid for it');
});

test('an explicitly folded group is a pile even on a canvas with room to spare', () => {
  const packed = pack({ groups: [FIELD[0], FIELD[1]], piled: ['aaaaaaaaaaaa'] });
  assert.equal(packed.piles.length, 1);
  assert.equal(packed.piles[0].folderId, 'aaaaaaaaaaaa');
  assert.equal(packed.piles[0].count, 4, 'a pile counts what it swallowed');
  assert.equal(packed.piles[0].cards.length, 0, 'and stands nothing up');
  for (const card of FIELD[0].cards) assert.equal(packed.rects[card.id], undefined, 'a piled card has no seat');
});

test('one pin and a small field fit without scrolling, and the pane takes the slack', () => {
  const packed = pack({ fulls: [{ id: 'f0' }], groups: [FIELD[0]] });
  assert.equal(packed.width, CANVAS.w);
  assert.ok(packed.stage.cols[0].w >= F().PANE_PREF, 'slack belongs to the conversation');
  // Nothing is left as air: the pane and the column grow past their
  // preferred widths until the New-group slot touches the right edge.
  assert.ok(packed.stage.cols[0].w > F().PANE_MAX, 'the pane grows into the leftover width');
  assert.ok(packed.newGroup, 'the New-group slot is still offered');
  assert.ok(packed.newGroup.x + packed.newGroup.w <= packed.stage.x + 0.01, 'it belongs to the field, so it stays left of the stage');
  assert.ok(Math.abs(packed.stage.x + packed.stage.w + MARGIN - CANVAS.w) < 2, 'the stage reaches the right edge');
});

test('PHI is the golden ratio, and the digest card is a golden rectangle', () => {
  assert.ok(Math.abs(F().PHI - 1.6180339887) < 1e-9);
  assert.ok(Math.abs(SIZES.digest.w / SIZES.digest.h - F().PHI) < 0.01);
});

test('at rest the stage stands against the field in the golden ratio', () => {
  // One pin, one sub-column, a canvas wide enough that neither floor binds.
  const packed = F().packFocus({ canvas: { w: 1400, h: 810 }, sizes: SIZES, fulls: [{ id: 'f0' }], groups: [FIELD[0]] });
  const [region] = packed.regions;
  const ratio = packed.stage.w / region.w;
  assert.ok(Math.abs(ratio - F().PHI) / F().PHI < 0.01, `stage/field should be φ, got ${ratio}`);
  assert.ok(Math.abs(packed.stage.x + packed.stage.w + MARGIN - 1400) < 2, 'and the canvas is still filled to the edge');
});

test('the golden split holds with two pins and a field that wraps', () => {
  const packed = F().packFocus({ canvas: { w: 2400, h: 810 }, sizes: SIZES, fulls: [{ id: 'f0' }, { id: 'f1' }], groups: [FIELD[0], FIELD[1]] });
  const field = packed.regions.reduce((most, region) => Math.max(most, region.x + region.w), 0) - packed.regions[0].x;
  const ratio = packed.stage.w / field;
  assert.ok(Math.abs(ratio - F().PHI) / F().PHI < 0.02, `stage/field should be about φ, got ${ratio}`);
  for (const col of packed.stage.cols) assert.ok(Math.abs(col.w - packed.stage.cols[0].w) < 1, 'panes on the stage share evenly');
});

test('floors win over the golden ratio when the canvas is tight', () => {
  // Two pins and one sub-column at 1100 wide: both preferred widths do not
  // fit, so the deficit is shared and neither side goes below its floor.
  const tight = F().packFocus({ canvas: { w: 1100, h: 810 }, sizes: SIZES, fulls: [{ id: 'f0' }, { id: 'f1' }], groups: [FIELD[0]] });
  for (const col of tight.stage.cols) assert.ok(col.w >= F().PANE_MIN, `a pane is never below reading width, got ${col.w}`);
  assert.ok(tight.colW >= F().FIELD_MIN);
  assert.equal(tight.width, 1100, 'it fits without scrolling');
  assert.ok(tight.stage.w / tight.regions[0].w > F().PHI * 1.2, 'the ratio gave way to the floors');
  // Tighter still: the field folds away altogether, and a rail of tabs costs
  // so little that two panes still stand at reading width on a 700px canvas.
  const tighter = F().packFocus({ canvas: { w: 700, h: 810 }, sizes: SIZES, fulls: [{ id: 'f0' }, { id: 'f1' }], groups: [FIELD[0]] });
  assert.equal(tighter.piles.length, 1, 'the folder folded');
  assert.equal(tighter.width, 700, 'and the canvas still does not scroll');
  for (const col of tighter.stage.cols) assert.ok(col.w >= F().PANE_MIN, `a pane at ${Math.round(col.w)}`);
  assert.ok(tighter.stage.x + tighter.stage.w <= 700 - MARGIN + 1, 'and the row ends at the edge');

  // Past even that: three panes on a 700px canvas cannot all read, and the
  // panes — not the canvas — take the shortfall, down to PANE_FLOOR.
  const crushed = F().packFocus({ canvas: { w: 700, h: 810 }, sizes: SIZES, fulls: cards('f', 3, 'full'), groups: [FIELD[0]] });
  assert.equal(crushed.width, 700, 'still no sideways scroll');
  for (const col of crushed.stage.cols) {
    assert.ok(col.w < F().PANE_MIN, 'three panes on a 700px canvas go under reading width');
    assert.ok(col.w >= F().PANE_FLOOR - 1, `never under PANE_FLOOR, got ${Math.round(col.w)}`);
  }
  // Past PANE_FLOOR too there is nothing left to give: the panes share what
  // the canvas has and the row still ends at the edge. (`maxStageColumns`
  // keeps the real stage from ever asking for this many columns at this
  // width; the packer answers anyway rather than overflowing.)
  const hopeless = F().packFocus({ canvas: { w: 700, h: 810 }, sizes: SIZES, fulls: cards('f', 6, 'full'), groups: [FIELD[0]] });
  assert.equal(hopeless.width, 700);
  assert.ok(hopeless.stage.x + hopeless.stage.w <= 700 - MARGIN + 1, 'and the row ends at the edge');
});

test('a lone region fills its column, and the columns share a wide canvas', () => {
  const packed = pack({ groups: [FIELD[0]] });
  const [region] = packed.regions;
  assert.ok(Math.abs(region.h - (CANVAS.h - 2 * MARGIN)) < 1, `a lone region is as tall as the canvas, not ${region.h}`);
  assert.ok(packed.colW > F().FIELD_MAX, `columns widen past FIELD_MAX to fill, got ${packed.colW}`);
  assert.ok(Math.abs(packed.newGroup.x + packed.newGroup.w + MARGIN - CANVAS.w) < 2, 'the New-group slot sits at the edge');
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
