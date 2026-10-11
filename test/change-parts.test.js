import assert from 'node:assert/strict';
import test from 'node:test';
import { partsOf, parseStep } from '../server/change/parts.js';
import { indexOf, watchParses } from '../server/agent/source.js';

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

// A fragment that cannot stand in a document body on its own — a row outside
// a table, a cell outside a row — is read inside the elements its parent
// needs around it, so the parts it adds are named by their own ids.
const TABLE = `<!doctype html><html><head></head><body data-marble-id="b">
<table data-marble-id="t"><tbody data-marble-id="tb"><tr data-marble-id="r1"><td data-marble-id="c1">A</td></tr></tbody></table>
<select data-marble-id="sel"><option data-marble-id="o1">One</option></select></body></html>`;

test('an inserted table row is named by its own id', () => {
  const r = partsOf(TABLE, [{ type: 'insert', parentId: 'tb', beforeId: null, html: '<tr data-marble-id="r2"><td data-marble-id="c2">B</td></tr>' }]);
  assert.deepEqual(r.parts, ['r2']);
  assert.deepEqual(r.inserts, [{ parentId: 'tb', beforeId: null, ids: ['r2'] }]);
  assert.equal(r.kind, 'structure');
});
test('an inserted cell, and an inserted option, are named by their own ids', () => {
  assert.deepEqual(partsOf(TABLE, [{ type: 'insert', parentId: 'r1', beforeId: null, html: '<td data-marble-id="c9">C</td>' }]).parts, ['c9']);
  assert.deepEqual(partsOf(TABLE, [{ type: 'insert', parentId: 'sel', beforeId: null, html: '<option data-marble-id="o2">Two</option>' }]).parts, ['o2']);
});
test('setInner on a table body narrows to the row that changed, not its cells', () => {
  const r = partsOf(TABLE, [{ type: 'setInner', id: 'tb', html: '<tr data-marble-id="r1"><td data-marble-id="c1">A</td></tr><tr data-marble-id="r2"><td data-marble-id="c2">B</td></tr>' }]);
  assert.deepEqual(r.parts, ['r2']);
});

// Five lists, each of whose rows a batch rewrites, drops one of, or nests.
const LISTS = Array.from({ length: 5 }, (_, k) =>
  `<ul data-marble-id="u${k}">${[0, 1, 2].map((i) => `<li data-marble-id="u${k}i${i}">Item ${i}</li>`).join('')}</ul>`).join('\n');
const PAGE = `<!doctype html><html><head></head><body data-marble-id="b">\n${LISTS}\n</body></html>`;
const REWRITES = Array.from({ length: 5 }, (_, k) => ({
  type: 'setInner',
  id: `u${k}`,
  html: `<li data-marble-id="u${k}i0">Item 0</li><li data-marble-id="u${k}i1">Changed</li>`,
}));

function parsesOf(source, run) {
  let parses = 0;
  watchParses((text) => {
    if (text === source) parses += 1;
  });
  try {
    return { result: run(), parses: () => parses };
  } finally {
    watchParses(null);
  }
}

test('a batch of setInners is read against one parse of the page', () => {
  const { result, parses } = parsesOf(PAGE, () => partsOf(PAGE, REWRITES));
  assert.deepEqual(result.parts, ['u0i1', 'u0i2', 'u1i1', 'u1i2', 'u2i1', 'u2i2', 'u3i1', 'u3i2', 'u4i1', 'u4i2']);
  assert.deepEqual(result.removes, ['u0i2', 'u1i2', 'u2i2', 'u3i2', 'u4i2']);
  assert.equal(parses(), 1, 'one parse for five setInners');
});

test('a parse the caller already has is used, not made again', () => {
  const index = indexOf(PAGE);
  const { result, parses } = parsesOf(PAGE, () => partsOf(PAGE, REWRITES, { index }));
  assert.deepEqual(result, partsOf(PAGE, REWRITES));
  assert.equal(parses(), 0);
});

test('a removed row is dropped under the removed row that held it', () => {
  const nested = '<!doctype html><html><head></head><body data-marble-id="b"><ul data-marble-id="ul"><li data-marble-id="a"><span data-marble-id="as">A</span></li><li data-marble-id="k">Keep</li></ul></body></html>';
  const r = partsOf(nested, [{ type: 'setInner', id: 'ul', html: '<li data-marble-id="k">Keep</li>' }]);
  assert.deepEqual(r.parts, ['a']);
  assert.deepEqual(r.removes, ['a']);
});
