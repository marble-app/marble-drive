import assert from 'node:assert/strict';
import test from 'node:test';

import { applyOp } from '../server/engine.js';
import { inverseSteps } from '../server/agent/inverse.js';
import { reviewPartsOf } from '../server/change/review.js';

const DOC = `<!doctype html><html><head></head><body data-marble-id="b">
<h1 data-marble-id="h">Original</h1>
<p data-marble-id="p" class="old">Text</p>
<ul data-marble-id="ul"><li data-marble-id="l1">One</li><li data-marble-id="l2">Two</li></ul>
</body></html>`;

const find = (parts, id) => parts.find((part) => part.id === id);

test('an insert is an added part', () => {
  const op = { type: 'insert', parentId: 'ul', beforeId: null, html: '<li data-marble-id="n1">New</li>' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'n1'), { id: 'n1', kind: 'added' });
});

test('setText is a words part, carrying the old text as before', () => {
  const op = { type: 'setText', id: 'h', text: 'Changed' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'h'), { id: 'h', kind: 'words', before: 'Original' });
});

test('setAttr on class is a look part, carrying the old value', () => {
  const op = { type: 'setAttr', id: 'p', name: 'class', value: 'new' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'p'), { id: 'p', kind: 'look', name: 'class', before: 'old' });
});

test('setAttr on a plain attribute is an attr part', () => {
  const op = { type: 'setAttr', id: 'p', name: 'title', value: 'hi' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'p'), { id: 'p', kind: 'attr', name: 'title', before: null });
});

test('a remove is a removed part, with the html and where it was', () => {
  const op = { type: 'remove', id: 'l1' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'l1'), {
    id: 'l1',
    kind: 'removed',
    html: '<li data-marble-id="l1">One</li>',
    parentId: 'ul',
    beforeId: 'l2',
  });
});

test('a move is a moved part, naming where it was', () => {
  const op = { type: 'move', id: 'l2', parentId: 'b', beforeId: null };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'l2'), { id: 'l2', kind: 'moved', parentId: 'ul', beforeId: null });
});

test('the first step for an id wins when the turn touched it twice', () => {
  const ops = [
    { type: 'setAttr', id: 'p', name: 'class', value: 'mid' },
    { type: 'setAttr', id: 'p', name: 'class', value: 'new' },
  ];
  const steps = inverseSteps(DOC, ops);
  const after = applyOp(applyOp(DOC, ops[0]), ops[1]);
  const parts = reviewPartsOf({ source: after, steps });
  // The original value ("old") survives, not the mid-turn value ("mid").
  assert.deepEqual(find(parts, 'p'), { id: 'p', kind: 'look', name: 'class', before: 'old' });
});

test('a part is dropped when the person changed it since', () => {
  const op = { type: 'setText', id: 'h', text: 'Changed' };
  const steps = inverseSteps(DOC, [op]);
  const afterTurn = applyOp(DOC, op);
  const afterPerson = applyOp(afterTurn, { type: 'setText', id: 'h', text: 'Mine' });
  const parts = reviewPartsOf({ source: afterPerson, steps });
  assert.equal(find(parts, 'h'), undefined);
});

test('a part is dropped when its element is now absent', () => {
  const op = { type: 'insert', parentId: 'ul', beforeId: null, html: '<li data-marble-id="n1">New</li>' };
  const steps = inverseSteps(DOC, [op]);
  const afterTurn = applyOp(DOC, op);
  const afterPerson = applyOp(afterTurn, { type: 'remove', id: 'n1' });
  const parts = reviewPartsOf({ source: afterPerson, steps });
  assert.equal(find(parts, 'n1'), undefined);
});

test('a removed part survives even though its element is, correctly, gone', () => {
  const op = { type: 'remove', id: 'l1' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.equal(find(parts, 'l1')?.kind, 'removed');
});

test('setInner that leaves addressed children inside is a changed part, not words', () => {
  const op = { type: 'setInner', id: 'ul', html: '<li data-marble-id="l1">One</li><li data-marble-id="l3">Three</li>' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.equal(find(parts, 'ul')?.kind, 'changed');
});
