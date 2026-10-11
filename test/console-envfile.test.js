// A drive's sprite.env, read and changed by the console: KEY=value lines and
// # comments, kept in their order; a value the service cannot hold (a comma,
// a newline) is refused; secrets are recognised by name.

import assert from 'node:assert/strict';
import test from 'node:test';

import { isSecret, parse, patch } from '../server/console/envfile.js';

const FILE = '# t-irene\nMARBLE_DRIVE_SECRET=abc\n\nMARBLE_DRIVE_AGENT_PROVIDER=claude-api\n';

test('parse gives the settings in order, comments aside', () => {
  assert.deepEqual(parse(FILE), [
    { key: 'MARBLE_DRIVE_SECRET', value: 'abc' },
    { key: 'MARBLE_DRIVE_AGENT_PROVIDER', value: 'claude-api' },
  ]);
});

test('patch changes a value in place, adds a new one at the end, and drops one, keeping comments', () => {
  const next = patch(FILE, { set: { MARBLE_DRIVE_AGENT_PROVIDER: 'claude-subscription', MARBLE_DRIVE_AWAKE_MAX_HOURS: '12' }, unset: ['MARBLE_DRIVE_SECRET'] });
  assert.equal(next, '# t-irene\n\nMARBLE_DRIVE_AGENT_PROVIDER=claude-subscription\nMARBLE_DRIVE_AWAKE_MAX_HOURS=12\n');
});

test('a value with a comma or a newline, or a key that is not a key, is refused', () => {
  assert.throws(() => patch(FILE, { set: { A: 'x,y' } }), /comma/);
  assert.throws(() => patch(FILE, { set: { A: 'x\ny' } }), /line/);
  assert.throws(() => patch(FILE, { set: { 'not a key': '1' } }), /name/);
});

test('secrets are known by name', () => {
  for (const key of ['MARBLE_DRIVE_SECRET', 'TYPESAFE_API_KEY', 'SOME_TOKEN', 'X_PASSWORD']) assert.equal(isSecret(key), true, key);
  for (const key of ['MARBLE_DRIVE_AGENT_PROVIDER', 'MARBLE_DRIVE_AWAKE_MAX_HOURS']) assert.equal(isSecret(key), false, key);
});
