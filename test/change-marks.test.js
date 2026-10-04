// What a change draws in its own terms (v6, server/change/marks.js): cut to
// size and to a small vocabulary on the way to every tab, anchored only to
// parts of the document, and never the words for a share link.

import assert from 'node:assert/strict';
import test from 'node:test';

import { anchorsOf, marksForVisitor, marksOf, MARKS_MAX, mergeMarks } from '../server/change/marks.js';
import { forVisitor } from '../server/sse.js';

const has = (id) => ['s1', 's2', 's3', 'trace'].includes(id);

test('the words of the tag are the thing\'s own, one line, cut to size', () => {
  const marks = marksOf({ verb: '  picking\n first arrivals ', unit: ['station', 'stations'], measure: { now: 2.456, of: 4, unit: 'km' } }, { has });
  assert.equal(marks.verb, 'Picking first arrivals');
  assert.deepEqual(marks.unit, ['station', 'stations']);
  assert.deepEqual(marks.measure, { now: 2.46, of: 4, unit: 'km' });
  assert.deepEqual(marksOf({ unit: 'well' }).unit, ['well', 'wells'], 'one word makes its own plural');
  assert.equal(marksOf({ verb: 'x'.repeat(80) }).verb.length, 32);
  assert.equal(marksOf({ measure: { of: 3 } }), null, 'a measure needs where it is now');
  assert.equal(marksOf(null), null);
  assert.equal(marksOf([]), null);
  assert.equal(marksOf({}), null);
});

test('a mark stands on a part of the document, in a place and a state it knows, with something to draw', () => {
  const marks = marksOf({
    draw: [
      { at: 's1', shape: 'ring', key: 'cursor' },
      { at: 's2', on: 'below', as: 'ahead', shape: 'line', text: 'Next' },
      { at: 'gone', shape: 'ring' },
      { at: 's3', on: 'sideways', as: 'glowing', shape: 'star', text: 'Old', x: 140, y: -4 },
      { at: 's3' },
      { at: 'trace', svg: '<path d="M38 0V100"/>' },
    ],
  }, { has });
  assert.deepEqual(marks.draw, [
    { at: 's1', on: 'over', as: 'now', key: 'cursor', shape: 'ring' },
    { at: 's2', on: 'below', as: 'ahead', shape: 'line', text: 'Next' },
    { at: 's3', on: 'over', as: 'now', text: 'Old', x: 100, y: 0 },
    { at: 'trace', on: 'over', as: 'now', svg: '<path d="M38 0V100"/>' },
  ]);
});

test('a path that could run, load or link anything is not drawn', () => {
  const bad = [
    '<script>alert(1)</script>',
    '<path d="M0 0" onclick="x()"/>',
    '<a href="https://example.com"><path d="M0 0"/></a>',
    '<image href="https://example.com/x.png"/>',
    '<path style="fill:url(https://example.com/x)"/>',
    '<foreignObject><div>hi</div></foreignObject>',
    '<svg><path d="M0 0"/></svg>',
    `<path d="${'M0 0 '.repeat(600)}"/>`,
  ];
  for (const svg of bad) {
    const marks = marksOf({ draw: [{ at: 's1', svg }] }, { has });
    assert.deepEqual(marks?.draw ?? [], [], svg.slice(0, 40));
  }
});

test('no more marks than the page draws at once, and an empty draw is kept, to clear them', () => {
  const draw = Array.from({ length: 60 }, () => ({ at: 's1', shape: 'dot' }));
  assert.equal(marksOf({ draw }, { has }).draw.length, MARKS_MAX);
  assert.deepEqual(marksOf({ draw: [] }), { draw: [] });
});

test('a batch\'s marks lie over the turn\'s: a draw given replaces the last one whole', () => {
  const first = marksOf({ verb: 'Picking', unit: ['station'], draw: [{ at: 's1', shape: 'ring' }] }, { has });
  const next = marksOf({ draw: [{ at: 's2', shape: 'ring' }] }, { has });
  assert.deepEqual(mergeMarks(first, next), { verb: 'Picking', unit: ['station', 'stations'], draw: [{ at: 's2', on: 'over', as: 'now', shape: 'ring' }] });
  assert.deepEqual(mergeMarks(first, null), first);
  assert.deepEqual(mergeMarks(null, next), next);
  assert.deepEqual(anchorsOf(mergeMarks(first, next)), ['s2']);
});

test('a share link is sent where the marks are, never their words', () => {
  const marks = marksOf({
    verb: 'Redlining',
    unit: ['clause', 'clauses'],
    draw: [{ at: 's1', shape: 'ring', text: 'Cap at 12 months' }, { at: 's2', text: 'Mutual' }],
  }, { has });
  assert.deepEqual(marksForVisitor(marks), { unit: ['clause', 'clauses'], draw: [{ at: 's1', on: 'over', as: 'now', shape: 'ring' }] });
  const frame = forVisitor({ client: 'agent:c1', ids: ['s1'], note: 'Cap liability', marks });
  assert.equal(frame.note, undefined);
  assert.equal(frame.marks.verb, undefined);
  assert.equal(JSON.stringify(frame).includes('12 months'), false);
});
