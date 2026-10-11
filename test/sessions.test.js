import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessions, sameOrigin } from '../server/sessions.js';

const request = (headers = {}) => ({ headers });
const KEY = 'a-long-random-signing-key';

test('a signing key is required', () => {
  assert.throws(() => createSessions({ key: '' }), /signing key/);
});

test('a session round-trips the account id it was issued for', () => {
  const sessions = createSessions({ key: KEY });
  const token = sessions.issue('00aa11bb22cc33dd');
  assert.equal(sessions.read(token), '00aa11bb22cc33dd');
  assert.equal(sessions.identify(request({ cookie: `marble_session=${token}` })), '00aa11bb22cc33dd');
});

test('the same token as a bearer header, for a script', () => {
  const sessions = createSessions({ key: KEY });
  const token = sessions.issue('deadbeefdeadbeef');
  assert.equal(sessions.identify(request({ authorization: `Bearer ${token}` })), 'deadbeefdeadbeef');
  assert.equal(sessions.identify(request()), null);
});

test('a token signed with another key is not a token', () => {
  const mine = createSessions({ key: KEY });
  const theirs = createSessions({ key: 'a-different-key' });
  assert.equal(mine.read(theirs.issue('00aa11bb22cc33dd')), null);
});

test('a tampered id or expiry fails the signature', () => {
  const sessions = createSessions({ key: KEY });
  const [id, expires, sig] = sessions.issue('00aa11bb22cc33dd').split('.');
  assert.equal(sessions.read(`ffffffffffffffff.${expires}.${sig}`), null);
  assert.equal(sessions.read(`${id}.${Number(expires) + 1e9}.${sig}`), null);
  assert.equal(sessions.read(`${id}.${expires}.`), null);
  assert.equal(sessions.read(`${id}.${expires}`), null);
});

test('an expired session is refused', () => {
  const sessions = createSessions({ key: KEY, days: -1 });
  assert.equal(sessions.read(sessions.issue('00aa11bb22cc33dd')), null);
});

test('Secure rides on the cookie only when it was asked for', () => {
  assert.ok(!createSessions({ key: KEY }).cookieHeader('00aa11bb22cc33dd').includes('Secure'));
  assert.ok(createSessions({ key: KEY, secure: true }).cookieHeader('00aa11bb22cc33dd').includes('; Secure'));
});

test('clearing the cookie expires it in place', () => {
  const header = createSessions({ key: KEY }).clearHeader();
  assert.match(header, /^marble_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/);
});

test('sameOrigin lets a header-less request through and refuses a foreign Origin', () => {
  assert.equal(sameOrigin(request({ host: 'drive.example' })), true);
  assert.equal(sameOrigin(request({ host: 'drive.example', origin: 'https://drive.example' })), true);
  assert.equal(sameOrigin(request({ host: 'drive.example', origin: 'https://evil.test' })), false);
  assert.equal(sameOrigin(request({ host: 'drive.example', origin: 'not a url' })), false);
  // Behind a proxy, the forwarded host is the one the browser used.
  assert.equal(
    sameOrigin(request({ host: 'drive.internal:4400', origin: 'https://drive.example', 'x-forwarded-host': 'drive.example' })),
    true,
  );
});
