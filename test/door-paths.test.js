// The door's returnPath (worker/src/door/paths.js) answers as the gate's does
// (server/gate.js): the Worker cannot import the gate, so the two are held
// to the same answers here.
import assert from 'node:assert/strict';
import test from 'node:test';

import { returnPath as gates } from '../server/gate.js';
import { returnPath as doors } from '../worker/src/door/paths.js';

test('the door and the gate keep the same paths and refuse the same tricks', () => {
  const cases = ['/', '/a/x?y=1#z', '//evil.example', '/\\evil', '/%2e//evil', '/.//evil', '/a/..//evil', 'javascript:alert(1)', 'https://evil.example', '/\t/evil', '', null, undefined, '/a/drive?q=a&b="c"', '/%2E%2E//evil.example'];
  for (const to of cases) assert.equal(doors(to), gates(to), String(to));
  assert.equal(doors('//evil.example'), '/');
  assert.equal(doors('/%2e//evil'), '/');
});
