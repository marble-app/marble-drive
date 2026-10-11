// test/door-tokens.test.js
// Passes and grants (worker/src/door/tokens.js): signed with Ed25519 at the
// edge, checked there and on each drive. Both sides are proven against each
// other: what WebCrypto signs, node:crypto verifies, and the other way round.
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import test from 'node:test';

import { b64urlDecode, b64urlEncode, importSigningKey, importVerifyKey, randomId, sha256Hex, sign, verify } from '../worker/src/door/tokens.js';

const pair = () => {
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519');
  return {
    pkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey,
    publicKey,
  };
};

const NOW = Date.parse('2026-10-10T12:00:00Z');
const sec = Math.floor(NOW / 1000);
const payload = (over = {}) => ({ typ: 'pass', drv: 'ana', acct: 'a1b2c3d4e5f60718', sid: 'abc', role: 'owner', iat: sec, exp: sec + 3600, ...over });

async function keysFor(p, kid = 'k1') {
  return { signing: await importSigningKey(p.pkcs8), verifying: new Map([[kid, await importVerifyKey(p.spki)]]) };
}

test('a token round-trips its payload', async () => {
  const p = pair();
  const { signing, verifying } = await keysFor(p);
  const token = await sign(signing, 'k1', payload());
  assert.match(token, /^v1\.k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await verify(verifying, token, { now: NOW, typ: 'pass', drv: 'ana' }), payload());
});

test('a changed byte, an unknown key, the wrong kind, the wrong drive, or a past expiry: null', async () => {
  const p = pair();
  const { signing, verifying } = await keysFor(p);
  const token = await sign(signing, 'k1', payload());
  const [v, kid, body, sig] = token.split('.');
  const flip = (s) => (s[5] === 'A' ? `${s.slice(0, 5)}B${s.slice(6)}` : `${s.slice(0, 5)}A${s.slice(6)}`);
  const opts = { now: NOW, typ: 'pass', drv: 'ana' };
  assert.equal(await verify(verifying, [v, kid, flip(body), sig].join('.'), opts), null, 'payload');
  assert.equal(await verify(verifying, [v, kid, body, flip(sig)].join('.'), opts), null, 'signature');
  assert.equal(await verify(verifying, [v, 'k2', body, sig].join('.'), opts), null, 'unknown kid');
  assert.equal(await verify(verifying, token, { ...opts, typ: 'grant' }), null, 'kind');
  assert.equal(await verify(verifying, token, { ...opts, drv: 'bob' }), null, 'drive');
  assert.equal(await verify(verifying, token, { ...opts, now: NOW + 3601 * 1000 }), null, 'expired');
  assert.equal(await verify(verifying, ['v2', kid, body, sig].join('.'), opts), null, 'version');
});

test('four or six parts, or rubbish, is null and never throws', async () => {
  const p = pair();
  const { signing, verifying } = await keysFor(p);
  const token = await sign(signing, 'k1', payload());
  const opts = { now: NOW, typ: 'pass', drv: 'ana' };
  assert.equal(await verify(verifying, token.split('.').slice(0, 3).join('.'), opts), null);
  assert.equal(await verify(verifying, `${token}.x`, opts), null);
  for (const junk of [undefined, null, '', 'v1', 'v1.k1.%%%.###', 42]) assert.equal(await verify(verifying, junk, opts), null);
});

test('a key signed by another pair does not verify', async () => {
  const mine = await keysFor(pair());
  const theirs = await keysFor(pair());
  const token = await sign(theirs.signing, 'k1', payload());
  assert.equal(await verify(mine.verifying, token, { now: NOW, typ: 'pass', drv: 'ana' }), null);
});

test('what the edge signs, node:crypto verifies, and the other way round', async () => {
  const p = pair();
  const { signing, verifying } = await keysFor(p);
  const token = await sign(signing, 'k1', payload());
  const at = token.lastIndexOf('.');
  const ok = nodeCrypto.verify(null, Buffer.from(token.slice(0, at)), p.publicKey, Buffer.from(token.slice(at + 1), 'base64url'));
  assert.equal(ok, true, 'the drive accepts the edge');

  const data = `v1.k1.${Buffer.from(JSON.stringify(payload())).toString('base64url')}`;
  const nodeToken = `${data}.${nodeCrypto.sign(null, Buffer.from(data), p.privateKey).toString('base64url')}`;
  assert.deepEqual(await verify(verifying, nodeToken, { now: NOW, typ: 'pass', drv: 'ana' }), payload());
});

test('base64url, random ids and hashes', async () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  assert.equal(b64urlEncode(bytes), Buffer.from(bytes).toString('base64url'));
  assert.deepEqual([...b64urlDecode(b64urlEncode(bytes))], [...bytes]);
  assert.match(randomId(16), /^[0-9a-f]{32}$/);
  assert.notEqual(randomId(16), randomId(16));
  assert.equal(await sha256Hex('abc'), nodeCrypto.createHash('sha256').update('abc').digest('hex'));
});

test('a key that is not Ed25519 is refused on import', async () => {
  const { publicKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  await assert.rejects(importVerifyKey(publicKey.export({ type: 'spki', format: 'der' }).toString('base64')));
});

test('the public half of the edge key verifies what it signs', async () => {
  const { publicFromPrivate } = await import('../worker/src/door/tokens.js');
  const p = pair();
  const pub = await publicFromPrivate(p.pkcs8);
  assert.equal(pub.spki, p.spki);
  const token = await sign(await importSigningKey(p.pkcs8), 'k1', payload());
  assert.ok(await verify(new Map([['k1', pub.key]]), token, { now: NOW, typ: 'pass', drv: 'ana' }));
});

test('a sealed value opens only with its secret and purpose, and only until it expires', async () => {
  const { seal, unseal } = await import('../worker/src/door/tokens.js');
  const sealed = await seal('s3cret', 'oauth', { state: 'x' }, { now: NOW, ttlSeconds: 600 });
  assert.deepEqual(await unseal('s3cret', 'oauth', sealed, { now: NOW }), { state: 'x' });
  assert.equal(await unseal('other', 'oauth', sealed, { now: NOW }), null);
  assert.equal(await unseal('s3cret', 'ask', sealed, { now: NOW }), null);
  assert.equal(await unseal('s3cret', 'oauth', sealed, { now: NOW + 601_000 }), null);
  assert.equal(await unseal('s3cret', 'oauth', `${sealed}x`, { now: NOW }), null);
});
