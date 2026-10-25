import assert from 'node:assert/strict';
import test from 'node:test';

import { askedHost, createSessions, fromOwnPage, sameOrigin } from '../server/sessions.js';

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

test('sameOrigin reads the browser’s host first when a proxy added its own, and never matches no host at all', () => {
  const edge = { host: '127.0.0.1:4501', 'x-forwarded-host': 'ana.marbledrive.app, pc-host.marbledrive.app' };
  assert.equal(askedHost(request(edge)), 'ana.marbledrive.app');
  assert.equal(sameOrigin(request({ ...edge, origin: 'https://ana.marbledrive.app' })), true);
  assert.equal(sameOrigin(request({ ...edge, origin: 'https://pc-host.marbledrive.app' })), false);
  assert.equal(sameOrigin(request({ host: 'Drive.Example', origin: 'https://drive.example' })), true, 'a host name has no case');
  assert.equal(sameOrigin(request({ origin: 'file://' })), false);
});

// A page on bob.marbledrive.app posting to ana's, as a browser sends it:
// same-site, so Lax lets ana's cookie ride along.
const ANA = { host: '127.0.0.1:4501', 'x-forwarded-host': 'ana.marbledrive.app', cookie: 'marble_drive=1.sig' };

test('fromOwnPage: a change from the drive’s own page goes on, one from another drive’s page does not', () => {
  assert.equal(fromOwnPage(request({ ...ANA, origin: 'https://ana.marbledrive.app' })), true);
  assert.equal(fromOwnPage(request({ ...ANA, origin: 'https://bob.marbledrive.app' })), false);
  assert.equal(fromOwnPage(request({ ...ANA, origin: 'https://marbledrive.app' })), false, 'not even the door');
  assert.equal(fromOwnPage(request({ ...ANA, origin: 'null' })), false, 'a sandboxed frame or a privacy redirect');
  assert.equal(fromOwnPage(request({ ...ANA, origin: 'https://ana.marbledrive.app', 'sec-fetch-site': 'same-site' })), true, 'Origin, when there is one, decides');
});

test('fromOwnPage: with no Origin, Sec-Fetch-Site has to say same-origin', () => {
  assert.equal(fromOwnPage(request({ ...ANA, 'sec-fetch-site': 'same-origin' })), true);
  for (const site of ['same-site', 'cross-site', 'none', 'nonsense']) assert.equal(fromOwnPage(request({ ...ANA, 'sec-fetch-site': site })), false, site);
});

test('fromOwnPage: a bearer, or no browser headers at all, goes on to be judged as before', () => {
  assert.equal(fromOwnPage(request({ ...ANA, authorization: 'Bearer the-passphrase', origin: 'https://bob.marbledrive.app' })), true, 'a script');
  assert.equal(fromOwnPage(request({ host: '127.0.0.1:4401', 'sec-fetch-mode': 'cors' })), true, 'curl, node’s fetch, the backup job');
  assert.equal(fromOwnPage(request({ ...ANA, authorization: 'Bearer ', origin: 'https://bob.marbledrive.app' })), false, 'an empty bearer is no bearer');
  assert.equal(fromOwnPage(request({ ...ANA, authorization: 'Basic eDp5', origin: 'https://bob.marbledrive.app' })), false);
});

test('fromOwnPage: the agent’s browser at 127.0.0.1 is its own page; localhost is another origin', () => {
  const local = { host: '127.0.0.1:4401' };
  assert.equal(fromOwnPage(request({ ...local, origin: 'http://127.0.0.1:4401' })), true);
  assert.equal(fromOwnPage(request({ host: 'localhost:4401', origin: 'http://localhost:4401' })), true);
  assert.equal(fromOwnPage(request({ ...local, origin: 'http://localhost:4401' })), false);
  assert.equal(fromOwnPage(request({ ...local, origin: 'http://127.0.0.1:4402' })), false, 'another drive on this machine');
});
