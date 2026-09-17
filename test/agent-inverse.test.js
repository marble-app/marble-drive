import assert from 'node:assert/strict';
import test from 'node:test';

import { applyOp } from '../server/engine.js';
import { inverseSteps } from '../server/agent/inverse.js';
import { hashesOf } from '../server/agent/source.js';

const SOURCE = `<!doctype html>
<html><head><title>I</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="h" class="big">Hello <em data-marble-id="e">there</em></h1>
  <ul data-marble-id="u">
    <li data-marble-id="i1">One</li>
    <li data-marble-id="i2">Two</li>
    <li data-marble-id="i3">Three</li>
  </ul>
  <ol data-marble-id="o"></ol>
</body></html>
`;

const run = (source, ops) => ops.reduce(applyOp, source);
const undo = (source, steps) => steps.slice().reverse().reduce((s, step) => applyOp(s, step.inverse), source);
const order = (source) => [...source.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);

test('setInner comes back byte for byte', () => {
  const ops = [{ type: 'setInner', id: 'h', html: 'Plain' }];
  const steps = inverseSteps(SOURCE, ops);
  assert.equal(undo(run(SOURCE, ops), steps), SOURCE);
});

test('setText is undone with setInner, so markup inside it survives', () => {
  const ops = [{ type: 'setText', id: 'i1', text: 'Uno' }];
  const steps = inverseSteps(SOURCE, ops);
  assert.equal(steps[0].inverse.type, 'setInner');
  assert.equal(undo(run(SOURCE, ops), steps), SOURCE);
});

test('setAttr restores the old value, or removes an attribute that was not there', () => {
  const ops = [
    { type: 'setAttr', id: 'h', name: 'class', value: 'small' },
    { type: 'setAttr', id: 'u', name: 'hidden', value: '' },
  ];
  const steps = inverseSteps(SOURCE, ops);
  assert.deepEqual(steps[1].inverse, { type: 'setAttr', id: 'u', name: 'hidden', value: null });
  assert.equal(undo(run(SOURCE, ops), steps), SOURCE);
});

test('remove comes back in the same place', () => {
  const ops = [{ type: 'remove', id: 'i2' }];
  const steps = inverseSteps(SOURCE, ops);
  assert.equal(steps[0].absent, 'i2');
  const restored = undo(run(SOURCE, ops), steps);
  assert.deepEqual(order(restored), order(SOURCE));
  assert.equal(hashesOf(restored).get('i2'), hashesOf(SOURCE).get('i2'));
});

test('move goes back to its old parent and neighbour', () => {
  const ops = [{ type: 'move', id: 'i1', parentId: 'o', beforeId: null }];
  const steps = inverseSteps(SOURCE, ops);
  const restored = undo(run(SOURCE, ops), steps);
  assert.deepEqual(order(restored), order(SOURCE));
});

test('insert is undone by removing what it inserted', () => {
  const ops = [{ type: 'insert', html: '<li data-marble-id="i4">Four</li>', parentId: 'u', beforeId: null }];
  const steps = inverseSteps(SOURCE, ops);
  assert.deepEqual(steps[0].inverse, { type: 'remove', id: 'i4' });
  assert.equal(steps[0].id, 'i4');
  assert.deepEqual(order(undo(run(SOURCE, ops), steps)), order(SOURCE));
});

test('each step expects the element as that op left it, not as the batch did', () => {
  const ops = [
    { type: 'setText', id: 'i3', text: 'Tres' },
    { type: 'setText', id: 'i3', text: 'Drei' },
  ];
  const steps = inverseSteps(SOURCE, ops);
  assert.equal(steps[0].expect, hashesOf(run(SOURCE, ops.slice(0, 1))).get('i3'));
  assert.equal(steps[1].expect, hashesOf(run(SOURCE, ops)).get('i3'));
});

test('an element whose parent has no id cannot be put back, and says so with a null inverse', () => {
  const source = SOURCE.replace('<ol data-marble-id="o"></ol>', '<div><p data-marble-id="orphan">x</p></div>');
  const steps = inverseSteps(source, [{ type: 'remove', id: 'orphan' }]);
  assert.equal(steps[0].inverse, null);
});

test('an insert of several elements is undone by removing every one of them', () => {
  const ops = [
    { type: 'insert', html: '<li data-marble-id="n1">two</li><li data-marble-id="n2"><em data-marble-id="n2i">three</em></li>', parentId: 'u', beforeId: null },
  ];
  const steps = inverseSteps(SOURCE, ops);
  assert.deepEqual(steps.map((s) => s.inverse), [{ type: 'remove', id: 'n1' }, { type: 'remove', id: 'n2' }]);
  const after = run(SOURCE, ops);
  assert.equal(steps[1].expect, hashesOf(after).get('n2'));
  assert.deepEqual(order(undo(after, steps)), order(SOURCE));
});
