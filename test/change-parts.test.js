import assert from 'node:assert/strict';
import test from 'node:test';
import { partsOf, parseStep } from '../server/change/parts.js';

const DOC = `<!doctype html><html><head><style data-marble-id="st">.a{}</style></head><body data-marble-id="b">
<ul data-marble-id="ul"><li data-marble-id="l1">One</li><li data-marble-id="l2">Two</li><li data-marble-id="l3">Three</li></ul>
<p data-marble-id="p">Hello <b data-marble-id="pb">there</b></p></body></html>`;

test('setInner on a list narrows to the rows that changed', () => {
  const ops = [{ type: 'setInner', id: 'ul', html: '<li data-marble-id="l1">One</li><li data-marble-id="l2">Deux</li><li data-marble-id="l3">Three</li>' }];
  const r = partsOf(DOC, ops);
  assert.deepEqual(r.parts, ['l2']);
  assert.equal(r.kind, 'structure');
});
test('setInner that drops a row names it removed', () => {
  const r = partsOf(DOC, [{ type: 'setInner', id: 'ul', html: '<li data-marble-id="l1">One</li><li data-marble-id="l3">Three</li>' }]);
  assert.deepEqual(r.removes, ['l2']);
});
test('insert names its roots and where they land', () => {
  const r = partsOf(DOC, [{ type: 'insert', parentId: 'ul', beforeId: 'l2', html: '<li data-marble-id="n1">New</li>' }]);
  assert.deepEqual(r.parts, ['n1']);
  assert.deepEqual(r.inserts, [{ parentId: 'ul', beforeId: 'l2', ids: ['n1'] }]);
});
test('style and class are a look; other attributes are attr; text is words', () => {
  assert.equal(partsOf(DOC, [{ type: 'setAttr', id: 'p', name: 'class', value: 'x' }]).kind, 'look');
  assert.equal(partsOf(DOC, [{ type: 'setAttr', id: 'p', name: 'title', value: 'x' }]).kind, 'attr');
  assert.equal(partsOf(DOC, [{ type: 'setText', id: 'pb', text: 'you' }]).kind, 'words');
  assert.equal(partsOf(DOC, [{ type: 'setInner', id: 'st', html: '.a{color:red}' }]).kind, 'look');
});
test('parseStep reads the stage out of a note', () => {
  assert.deepEqual(parseStep('Stage 2 of 4: lay out the three columns, empty.'), { n: 2, of: 4, text: 'lay out the three columns, empty.' });
  assert.deepEqual(parseStep('step 1/3 — read it'), { n: 1, of: 3, text: 'read it' });
  assert.equal(parseStep('Rename the heading.'), null);
});
