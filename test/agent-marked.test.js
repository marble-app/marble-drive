// What a page may send about Describe mode's marks, as the host keeps it.
import assert from 'node:assert/strict';
import test from 'node:test';

import { SEEN_BUDGET, cleanMarked } from '../server/agent/marked.js';

test('nothing marked is nothing to picture', () => {
  assert.equal(cleanMarked(null), null);
  assert.equal(cleanMarked('marks'), null);
  assert.equal(cleanMarked({ viewport: { width: 800, height: 600 } }), null);
});

test('marks are kept to what a picture and a prompt can use', () => {
  const marked = cleanMarked({
    viewport: { width: 1e9, height: 'tall' },
    ids: ['a', 7, '', 'b'],
    strokes: [
      { anchorId: 'a', parts: [[[0, 0], [0.5, 'x'], [1, 1]]] },
      { anchorId: 'b', parts: [[[0, 0]]] },
      { parts: [[[0, 0], [1, 1]]] },
    ],
    notes: [{ anchorId: 'c', u: 0.2, v: 0.3, text: 'x'.repeat(900) }, { anchorId: 'd', u: 'left' }],
    values: { name: 'Ada', done: true, bad: { no: 1 } },
    seen: 'y'.repeat(SEEN_BUDGET + 50),
    extra: 'dropped',
  });
  assert.deepEqual(marked.viewport, { width: 1280, height: 800 }, 'a size that is not one falls back');
  assert.deepEqual(marked.ids, ['a', 'b']);
  assert.deepEqual(marked.strokes, [{ anchorId: 'a', parts: [[[0, 0], [1, 1]]] }], 'a point that is not one is dropped, and a stroke of one point');
  assert.equal(marked.notes.length, 1);
  assert.equal(marked.notes[0].text.length, 500);
  assert.deepEqual(marked.values, { name: 'Ada', done: true });
  assert.equal(marked.seen.length, SEEN_BUDGET);
  assert.equal('extra' in marked, false);
});
