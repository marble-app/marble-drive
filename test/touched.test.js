import assert from 'node:assert/strict';
import test from 'node:test';

import { createTouched } from '../server/touched.js';

test('note remembers ids per document and client; except unions the others', () => {
  const t = createTouched();
  t.note('doc', 'you', ['a', 'b']);
  t.note('doc', 'agent:c1', ['c']);
  t.note('other', 'you', ['z']);
  assert.deepEqual(t.except('doc', 'you').sort(), ['c']);
  assert.deepEqual(t.except('doc', 'agent:c1').sort(), ['a', 'b']);
  assert.deepEqual(t.all('doc').sort(), ['a', 'b', 'c']);
  assert.deepEqual(t.except('doc', null).sort(), ['a', 'b', 'c']);
});

test('an agent and its undo are one writer', () => {
  const t = createTouched();
  t.note('doc', 'agent:c1', ['a']);
  t.note('doc', 'agent-undo:c1', ['b']);
  assert.deepEqual(t.except('doc', 'agent:c1'), []);
  assert.deepEqual(t.except('doc', 'agent-undo:c1'), []);
  assert.deepEqual(t.except('doc', 'agent:c2').sort(), ['a', 'b']);
});

test('since keeps only ids noted at or after it, and a re-note moves the id forward', () => {
  const t = createTouched();
  t.note('doc', 'you', ['old'], 1000);
  t.note('doc', 'you', ['new'], 3000);
  assert.deepEqual(t.except('doc', 'agent:c1', { since: 2000 }), ['new']);
  assert.deepEqual(t.except('doc', 'agent:c1', { since: 3000 }), ['new']);
  assert.deepEqual(t.except('doc', 'agent:c1').sort(), ['new', 'old']);
  t.note('doc', 'you', ['old'], 4000);
  assert.deepEqual(t.except('doc', 'agent:c1', { since: 2000 }).sort(), ['new', 'old']);
  assert.deepEqual(t.all('doc', { since: 3500 }), ['old']);
});

test('note ignores a missing client and empty ids; drop and forget clear', () => {
  const t = createTouched();
  t.note('doc', null, ['a']);
  t.note('doc', 'you', ['', null, 'a']);
  assert.deepEqual(t.all('doc'), ['a']);
  t.drop('doc', 'you');
  assert.deepEqual(t.all('doc'), []);
  t.note('doc', 'agent:c1', ['a']);
  t.note('two', 'agent-undo:c1', ['b']);
  t.forget('agent:c1');
  assert.deepEqual(t.all('doc'), []);
  assert.deepEqual(t.all('two'), []);
});
