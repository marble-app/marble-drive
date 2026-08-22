import assert from 'node:assert/strict';
import test from 'node:test';

import { createGate } from '../server/gate.js';

const request = (headers = {}) => ({ headers });

test('no secret is an open host, and it says so', () => {
  const gate = createGate({ secret: null });
  assert.equal(gate.open, true);
  assert.equal(gate.allows(request()), true);
});

test('a closed host refuses a request with nothing on it', () => {
  const gate = createGate({ secret: 'hunter2' });
  assert.equal(gate.open, false);
  assert.equal(gate.allows(request()), false);
  assert.equal(gate.allows(request({ cookie: 'marble_drive=nonsense' })), false);
});

test('the secret is exchanged for a cookie, and the cookie is accepted', () => {
  const gate = createGate({ secret: 'hunter2' });
  assert.equal(gate.accepts('wrong'), false);
  assert.equal(gate.accepts('hunter2'), true);

  const header = gate.cookieHeader();
  assert.match(header, /^marble_drive=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
  const token = header.slice('marble_drive='.length, header.indexOf(';'));
  assert.equal(gate.allows(request({ cookie: `marble_drive=${token}` })), true);
});

test('a cookie signed with a different secret is not a cookie', () => {
  const mine = createGate({ secret: 'hunter2' });
  const theirs = createGate({ secret: 'something-else' });
  const token = theirs.issue();
  assert.equal(mine.valid(token), false);
});

test('an expired cookie is refused', () => {
  const gate = createGate({ secret: 'hunter2', days: -1 });
  assert.equal(gate.valid(gate.issue()), false);
});

test('a tampered payload is refused, signature and all', () => {
  const gate = createGate({ secret: 'hunter2' });
  const token = gate.issue();
  const [payload, signature] = token.split('.');
  assert.equal(gate.valid(`${Number(payload) + 1e9}.${signature}`), false);
  assert.equal(gate.valid(`${payload}.`), false);
  assert.equal(gate.valid(payload), false);
});

test('the same secret as a bearer token, for a script', () => {
  const gate = createGate({ secret: 'hunter2' });
  assert.equal(gate.allows(request({ authorization: 'Bearer hunter2' })), true);
  assert.equal(gate.allows(request({ authorization: 'Bearer nope' })), false);
});

test('Secure is set only when it was asked for', () => {
  assert.ok(!createGate({ secret: 'x' }).cookieHeader().includes('Secure'));
  assert.ok(createGate({ secret: 'x', secure: true }).cookieHeader().includes('Secure'));
});
