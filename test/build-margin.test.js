import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// The margin's rules run without a page: the script stops before it touches
// the document, and leaves them on globalThis.marbleMargin.
const source = fs.readFileSync(new URL('../runtime/build-margin.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const { stackCards, statusOf } = context.marbleMargin;

const tops = (map) => Object.fromEntries(map);

test('cards sit level with their pins while they have room', () => {
  const placed = stackCards([
    { id: 'a', want: 40, height: 60 },
    { id: 'b', want: 300, height: 60 },
  ], { head: 8, gap: 8 });
  assert.deepEqual(tops(placed), { a: 40, b: 300 });
});

test('a card that would overlap the one above moves down to 8px below it, in page order', () => {
  const placed = stackCards([
    { id: 'b', want: 60, height: 50 },
    { id: 'a', want: 40, height: 60 },
    { id: 'c', want: 70, height: 20 },
  ], { head: 8, gap: 8 });
  assert.deepEqual(tops(placed), { a: 40, b: 108, c: 166 });
});

test('no card goes above the head', () => {
  const placed = stackCards([{ id: 'a', want: -30, height: 40 }, { id: 'b', want: 0, height: 40 }], { head: 8, gap: 8 });
  assert.deepEqual(tops(placed), { a: 8, b: 56 });
});

test('a picked card comes level with its pin and the ones above make way', () => {
  const items = [
    { id: 'a', want: 100, height: 60 },
    { id: 'b', want: 110, height: 60 },
    { id: 'c', want: 120, height: 60 },
  ];
  assert.deepEqual(tops(stackCards(items, { head: 8, gap: 8 })), { a: 100, b: 168, c: 236 });
  // No room above for both: they pack down from the head, and c comes as
  // near its pin as that leaves.
  assert.deepEqual(tops(stackCards(items, { head: 8, gap: 8, picked: 'c' })), { a: 8, b: 76, c: 144 });
  // With room above, the picked card is exactly level and the rest pack up.
  const roomy = [
    { id: 'a', want: 200, height: 60 },
    { id: 'b', want: 210, height: 60 },
    { id: 'c', want: 220, height: 60 },
  ];
  assert.deepEqual(tops(stackCards(roomy, { head: 8, gap: 8, picked: 'c' })), { a: 84, b: 152, c: 220 });
  assert.deepEqual(tops(stackCards(roomy, { head: 8, gap: 8, picked: 'b' })), { a: 142, b: 210, c: 278 });
});

test('cards that crowd each other above a picked one settle among themselves, and the picked one stays level', () => {
  // The spec page: four marks near the top, two at one height, and the
  // picked one far down. Nothing near the top is in its way.
  const items = [
    { id: 'a', want: 52, height: 83 }, { id: 'e', want: 151, height: 60 }, { id: 'd', want: 176, height: 60 },
    { id: 'f', want: 176, height: 60 }, { id: 'b', want: 968, height: 60 }, { id: 'g', want: 1043, height: 60 },
  ];
  const placed = tops(stackCards(items, { head: 8, gap: 8, picked: 'g' }));
  assert.equal(placed.g, 1043, 'level with its pin');
  assert.deepEqual(placed, tops(stackCards(items, { head: 8, gap: 8 })), 'nothing above had to move');
});

test('the cards under a picked one make way below it', () => {
  const placed = stackCards([
    { id: 'a', want: 10, height: 60 },
    { id: 'b', want: 20, height: 60 },
    { id: 'c', want: 30, height: 20 },
  ], { head: 8, gap: 8, picked: 'b' });
  assert.deepEqual(tops(placed), { a: 8, b: 76, c: 144 });
});

const builds = [
  { id: 'b1', n: 1, status: 'finished', plan: { parts: [] } },
  {
    id: 'b2', n: 2, status: 'running',
    plan: { parts: [
      { title: 'Title', state: 'done', ids: ['h'] },
      { title: 'List', state: 'now', ids: ['list'] },
      { title: 'Week', state: 'ahead', ids: ['week'] },
    ] },
  },
];
const at = (mark) => statusOf(mark, { builds, name: 'CHI reviews' });

test('a waiting mark can be held back, and a held one put back', () => {
  assert.deepEqual({ ...at({ type: 'note', state: 'waiting' }) }, { key: 'waiting', words: 'Waits for the next build', show: 'open', act: 'hold', ring: null });
  const held = at({ type: 'note', state: 'waiting', held: true });
  assert.equal(held.key, 'held');
  assert.equal(held.words, 'Held back');
  assert.equal(held.act, 'unhold');
});

test('a mark in the build says how its own part is going, from the plan', () => {
  const making = at({ type: 'note', state: 'building', build: 'b2', anchorId: 'list' });
  assert.equal(making.key, 'making');
  assert.equal(making.words, 'Being made');
  assert.equal(making.show, 'build');
  assert.equal(making.act, null, 'nothing to hold back once it is in the build');
  assert.equal(making.ring, 0.5);
  assert.equal(at({ type: 'stroke', state: 'building', build: 'b2', anchorId: 'h' }).key, 'made');
  assert.equal(at({ type: 'note', state: 'building', build: 'b2', anchorId: 'week' }).words, 'In this build · still to come');
  const elsewhere = at({ type: 'note', state: 'building', build: 'b2', anchorId: 'footer' });
  assert.equal(elsewhere.words, 'In this build · 1 of 3 parts made');
  assert.ok(Math.abs(elsewhere.ring - 1 / 3) < 1e-9);
});

test('a part holds a mark by containment, as the page says', () => {
  const holds = (ids, id) => ids.includes('list') && id === 'row-3';
  assert.equal(statusOf({ type: 'note', state: 'building', build: 'b2', anchorId: 'row-3' }, { builds, holds }).key, 'making');
});

test('a paused build says Paused on its marks; a built mark says which build', () => {
  const paused = [{ ...builds[1], status: 'paused' }];
  assert.equal(statusOf({ type: 'note', state: 'building', build: 'b2', anchorId: 'list' }, { builds: paused }).key, 'paused');
  const built = at({ type: 'note', state: 'built', build: 'b1' });
  assert.equal(built.words, 'Done in Build 1');
  assert.equal(built.show, 'done');
});

test('a comment is answered by the app, in its name, and can be resolved', () => {
  const thread = (...lines) => ({ type: 'comment', thread: lines });
  assert.equal(at(thread({ who: 'you', text: 'Why?' }, { who: 'agent', pending: true, text: '' })).words, 'CHI reviews is answering');
  const asking = at(thread({ who: 'you', text: 'Two weeks?' }, { who: 'agent', text: 'Yes.', offer: { text: 'Show two weeks', taken: null } }));
  assert.equal(asking.key, 'asking');
  assert.equal(asking.words, 'CHI reviews asked you');
  assert.equal(asking.act, 'offer');
  const answered = at(thread({ who: 'you', text: 'Why?' }, { who: 'agent', text: 'Because.', offer: { text: 'x', taken: true } }));
  assert.equal(answered.key, 'answered');
  assert.equal(answered.act, 'resolve');
  const resolved = at({ ...thread({ who: 'you', text: 'Why?' }), resolved: true });
  assert.equal(resolved.key, 'resolved');
  assert.equal(resolved.show, 'done');
  assert.equal(resolved.act, 'reopen');
  for (const s of [asking, answered, resolved]) assert.doesNotMatch(s.words, /agent/i);
});
