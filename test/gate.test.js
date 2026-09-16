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

// A request as Node hands it over: the peer is on the socket, not in a header.
const arriving = (remoteAddress, headers = {}) => ({ headers, socket: { remoteAddress } });

test('Secure follows the request when it came through a local HTTPS proxy', () => {
  const gate = createGate({ secret: 'x' });
  // Tailscale Serve terminates TLS and forwards to loopback, saying so.
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const req = arriving(peer, { 'x-forwarded-proto': 'https' });
    assert.ok(gate.cookieHeader(req).includes('; Secure'), peer);
    assert.ok(gate.clearHeader(req).includes('; Secure'), peer);
  }
  // Plain http://localhost keeps working, in Safari too, which drops a Secure
  // cookie over http even on localhost.
  assert.ok(!gate.cookieHeader(arriving('127.0.0.1')).includes('Secure'));
});

test('a forwarded-proto header from anywhere but loopback is not believed', () => {
  const gate = createGate({ secret: 'x' });
  const req = arriving('192.168.1.20', { 'x-forwarded-proto': 'https' });
  assert.ok(!gate.cookieHeader(req).includes('Secure'));
});

test('asking for Secure still means always', () => {
  const gate = createGate({ secret: 'x', secure: true });
  assert.ok(gate.cookieHeader(arriving('127.0.0.1')).includes('; Secure'));
});
