import assert from 'node:assert/strict';
import test from 'node:test';

import { hashesOf, idsIn, tagsOf, topLevelIds } from '../server/agent/source.js';

const SOURCE = `<!doctype html>
<html><head><title>S</title></head>
<body>
  <main data-marble-id="m">
    <h1 data-marble-id="h">Hello</h1>
    <p data-marble-id="p">Text</p>
  </main>
  <aside data-marble-id="a">Side</aside>
</body></html>
`;

test('a hash names the bytes of one element, and changes when they do', () => {
  const before = hashesOf(SOURCE);
  assert.equal(before.size, 4);
  assert.match(before.get('h'), /^[0-9a-f]{16}$/);
  const after = hashesOf(SOURCE.replace('Hello', 'Hi'), ['h', 'p']);
  assert.notEqual(after.get('h'), before.get('h'));
  assert.equal(after.get('p'), before.get('p'));
  assert.equal(after.has('m'), false, 'only the ids asked for');
});

test('an id the source does not have is missing, not an error', () => {
  assert.equal(hashesOf(SOURCE, ['nope']).has('nope'), false);
});

test('top-level ids are the addressed elements nothing addressed contains', () => {
  assert.deepEqual(topLevelIds(SOURCE), ['m', 'a']);
});

test('ids in a fragment, in order', () => {
  assert.deepEqual(idsIn('<li data-marble-id="x"><b data-marble-id="y">z</b></li>'), ['x', 'y']);
});

test('tags by id', () => {
  assert.deepEqual(tagsOf(SOURCE).find((t) => t.id === 'p'), { id: 'p', tag: 'p' });
});
