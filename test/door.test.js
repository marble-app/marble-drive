// test/door.test.js
// The drive's side of the door (server/door.js): it checks a pass with public
// keys only, and only for its own name and its own owner. With no settings it
// is not there at all, and the drive behaves as it always has.
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import test from 'node:test';

import { createDoor, parseDoorKeys } from '../server/door.js';
import { loadConfig } from '../server/config.js';
import { importSigningKey, sign } from '../worker/src/door/tokens.js';

const pair = () => {
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519');
  return {
    pkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
};

const NOW = Date.parse('2026-10-10T12:00:00Z');
const sec = Math.floor(NOW / 1000);
const OWNER = 'a1b2c3d4e5f60718';
const pass = (over = {}) => ({ typ: 'pass', drv: 'ana', acct: OWNER, sid: 'h', role: 'owner', iat: sec, exp: sec + 3600, ...over });
const req = (cookie, extra = {}) => ({ url: '/a/Notes?x=1', headers: { cookie, ...extra }, socket: { remoteAddress: '127.0.0.1' } });

async function setup() {
  const p = pair();
  const key = await importSigningKey(p.pkcs8);
  const door = createDoor({ keys: parseDoorKeys(`k1:${p.spki}`), name: 'ana', owner: OWNER, now: () => NOW });
  return { p, key, door };
}

test("a pass the edge signed for this drive and its owner opens it", async () => {
  const { key, door } = await setup();
  assert.equal(door.configured, true);
  const token = await sign(key, 'k1', pass());
  assert.equal(door.allows(req(`other=1; __Host-md_pass=${token}`)), true);
  assert.deepEqual(door.who(req(`__Host-md_pass=${token}`)), { account: OWNER, role: 'owner', session: 'h' });
});

test('another drive, another owner, expired, an unknown key, a grant, or another cookie name: refused', async () => {
  const { key, door } = await setup();
  const other = pair();
  const otherKey = await importSigningKey(other.pkcs8);
  const cases = {
    'another drive': await sign(key, 'k1', pass({ drv: 'bob' })),
    'another owner': await sign(key, 'k1', pass({ acct: 'ffffffffffffffff' })),
    expired: await sign(key, 'k1', pass({ exp: sec - 1 })),
    'unknown kid': await sign(key, 'k2', pass()),
    'a key not in the settings': await sign(otherKey, 'k1', pass()),
    'a grant': await sign(key, 'k1', pass({ typ: 'grant', n: 'x' })),
  };
  for (const [why, token] of Object.entries(cases)) assert.equal(door.allows(req(`__Host-md_pass=${token}`)), false, why);
  const good = await sign(key, 'k1', pass());
  assert.equal(door.allows(req(`md_pass=${good}`)), false, 'another cookie name');
  assert.equal(door.allows(req(undefined)), false, 'no cookie');
  assert.equal(door.who(req(undefined)), null);
});

test('no settings: not configured, and nothing is allowed through it', async () => {
  const { key } = await setup();
  const token = await sign(key, 'k1', pass());
  for (const opts of [{}, { keys: new Map(), name: 'ana', owner: OWNER }, { keys: parseDoorKeys(`k1:${pair().spki}`), name: null, owner: OWNER }, { keys: parseDoorKeys(`k1:${pair().spki}`), name: 'ana', owner: null }]) {
    const door = createDoor(opts);
    assert.equal(door.configured, false);
    assert.equal(door.allows(req(`__Host-md_pass=${token}`)), false);
  }
});

test('enterUrl sends a browser to the door with only a path to come back to', async () => {
  const { door } = await setup();
  const at = (url) => new URL(door.enterUrl({ url, headers: {} }));
  assert.equal(at('/a/Notes?x=1').origin, 'https://marbledrive.app');
  assert.equal(at('/a/Notes?x=1').pathname, '/enter');
  assert.equal(at('/a/Notes?x=1').searchParams.get('drive'), 'ana');
  assert.equal(at('/a/Notes?x=1').searchParams.get('to'), '/a/Notes?x=1');
  assert.equal(at('//evil.example/x').searchParams.get('to'), '/');
  assert.equal(at('/%2e//evil').searchParams.get('to'), '/');
});

test('parseDoorKeys: kid:key pairs separated by spaces; a comma or a key that is not Ed25519 is refused by name, never by value', () => {
  const a = pair().spki;
  const b = pair().spki;
  const keys = parseDoorKeys(` k1:${a}   k2:${b} `);
  assert.deepEqual([...keys.keys()], ['k1', 'k2']);
  assert.equal(parseDoorKeys('').size, 0);
  assert.equal(parseDoorKeys(null).size, 0);
  const ec = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  for (const bad of [`k1:${a},k2:${b}`, `k1:${ec}`, 'k1:notbase64!!', `${a}`, `k 1:${a}`]) {
    assert.throws(() => parseDoorKeys(bad), (err) => {
      assert.match(err.message, /MARBLE_DOOR_KEYS/);
      assert.ok(!err.message.includes(a.slice(10, 30)), 'the value is not in the message');
      return true;
    }, bad.slice(0, 12));
  }
});

test('config: the door settings and the gate mode, off by default', () => {
  const a = pair().spki;
  const plain = loadConfig({ MARBLE_DRIVE_ROOT: '/tmp/x' });
  assert.equal(plain.doorKeys.size, 0);
  assert.equal(plain.doorName, null);
  assert.equal(plain.doorOwner, null);
  assert.equal(plain.gateMode, 'on');
  const set = loadConfig({ MARBLE_DRIVE_ROOT: '/tmp/x', MARBLE_DOOR_KEYS: `k1:${a}`, MARBLE_DOOR_NAME: 'ana', MARBLE_DOOR_OWNER: OWNER, MARBLE_DRIVE_GATE: 'tools' });
  assert.equal(set.doorKeys.size, 1);
  assert.equal(set.doorName, 'ana');
  assert.equal(set.doorOwner, OWNER);
  assert.equal(set.gateMode, 'tools');
  assert.equal(loadConfig({ MARBLE_DRIVE_ROOT: '/tmp/x', MARBLE_DRIVE_GATE: 'nonsense' }).gateMode, 'on');
  assert.throws(() => loadConfig({ MARBLE_DRIVE_ROOT: '/tmp/x', MARBLE_DOOR_KEYS: 'k1:a,b' }), /MARBLE_DOOR_KEYS/);
});
