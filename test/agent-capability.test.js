import assert from 'node:assert/strict';
import test from 'node:test';

import { effectiveCapability } from '../server/agent/capability.js';

test('a provider runs at the capability it declares', () => {
  assert.equal(effectiveCapability({ capability: 'full' }, {}), 'full');
  assert.equal(effectiveCapability({ capability: 'documents' }, {}), 'documents');
});

test('a provider that declares nothing is a full provider', () => {
  assert.equal(effectiveCapability({}, {}), 'full');
  assert.equal(effectiveCapability({ capability: 'nonsense' }, {}), 'full');
});

test('MARBLE_DRIVE_AGENT_POWER=documents holds every provider down', () => {
  assert.equal(effectiveCapability({ capability: 'full' }, { power: 'documents' }), 'documents');
});

test('any other value of the switch leaves the provider alone', () => {
  for (const power of ['', 'full', 'yes', undefined]) {
    assert.equal(effectiveCapability({ capability: 'full' }, { power }), 'full', `power=${power}`);
  }
});
