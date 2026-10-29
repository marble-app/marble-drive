// test/host-direct.test.js
// Direct mode (docs/HOSTING.md, "Direct mode"): no door in front of the PC's
// drives. marble-host signs each person's pass, their sign-in link carries it
// to the drive's /enter, and the drive takes it as the cookie the edge would
// have set.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { createDoor, parseDoorKeys } from '../server/door.js';
import { guestEntries } from '../server/host/guest-env.js';
import { newSigningKey, signInLink, signPass } from '../server/host/passes.js';
import { hostKeyEntry, loadHostSettings } from '../server/host/settings.js';
import { verify } from '../worker/src/door/tokens.js';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const signingKey = newSigningKey();
const entry = hostKeyEntry(signingKey);

test('a pass marble-host signs is the door\'s own kind: the edge\'s check and the drive\'s both take it', async () => {
  const { pass, expires } = signPass({ signingKey, name: 'ana', account: 'direct-ana', days: 90, now: NOW });
  assert.equal(expires, '2027-01-27T12:00:00.000Z');
  assert.match(pass, /^v1\.h1\./);
  const [kid, spki] = entry.split(':');
  const keys = new Map([[kid, await crypto.subtle.importKey('spki', Buffer.from(spki, 'base64'), { name: 'Ed25519' }, true, ['verify'])]]);
  const payload = await verify(keys, pass, { now: NOW, typ: 'pass', drv: 'ana' });
  assert.equal(payload.acct, 'direct-ana');
  assert.equal(payload.role, 'owner');

  const door = createDoor({ keys: parseDoorKeys(entry), name: 'ana', owner: 'direct-ana', direct: true, now: () => NOW });
  assert.ok(door.direct);
  assert.equal(door.check(pass).drv, 'ana');
  assert.equal(door.passCookie(pass), `__Host-md_pass=${pass}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${90 * 86400}`);
  assert.equal(signInLink({ name: 'ana', suffix: 'marbledrive.app', pass }), `https://ana.marbledrive.app/enter#${pass}`);

  // Another drive's, another owner's, a run-out one, or one signed by another key: nothing.
  const other = createDoor({ keys: parseDoorKeys(entry), name: 'bob', owner: 'direct-bob', direct: true, now: () => NOW });
  assert.equal(other.check(pass), null);
  assert.equal(other.passCookie(pass), null);
  const later = createDoor({ keys: parseDoorKeys(entry), name: 'ana', owner: 'direct-ana', direct: true, now: () => NOW + 91 * 86400e3 });
  assert.equal(later.check(pass), null);
  const stranger = signPass({ signingKey: newSigningKey(), name: 'ana', account: 'direct-ana', now: NOW }).pass;
  assert.equal(door.check(stranger), null);
  assert.equal(door.check('v1.h1.x.y'), null);
  assert.equal(door.check(undefined), null);
});

test('a direct drive sends a browser without a pass to its own /enter, and offers no door', () => {
  const door = createDoor({ keys: parseDoorKeys(entry), name: 'ana', owner: 'direct-ana', direct: true });
  assert.equal(door.enterUrl({ url: '/a/Notes?x=1' }), '/enter?to=%2Fa%2FNotes%3Fx%3D1');
  assert.equal(door.enterUrl({ url: '//evil.example' }), '/enter?to=%2F');
  assert.equal(door.askUrl, null);
  const usual = createDoor({ keys: parseDoorKeys(entry), name: 'ana', owner: 'direct-ana' });
  assert.equal(usual.direct, false);
  assert.match(usual.enterUrl({ url: '/' }), /^https:\/\/marbledrive\.app\/enter\?/);
});

test('signPass refuses no key and an unlikely length', () => {
  assert.throws(() => signPass({ signingKey: null, name: 'ana', account: 'a' }), /HOST_SIGNING_KEY/);
  assert.throws(() => signPass({ signingKey, name: 'ana', account: 'a', days: 0 }), /1 to 366 days/);
  assert.throws(() => signPass({ signingKey, name: 'ana', account: 'a', days: 400 }), /1 to 366 days/);
});

test('host settings: direct needs a signing key, and every guest is given its public half beside the door\'s', () => {
  const base = { HOME: '/nowhere', MARBLE_HOST_ENV: '/nowhere/host.env' };
  assert.throws(() => loadHostSettings({ ...base, HOST_DIRECT: '1' }), /HOST_DIRECT needs HOST_SIGNING_KEY/);
  assert.throws(() => loadHostSettings({ ...base, HOST_SIGNING_KEY: 'bm90IGEga2V5' }), /HOST_SIGNING_KEY is not a private key/);
  const s = loadHostSettings({ ...base, HOST_DIRECT: '1', HOST_SIGNING_KEY: signingKey, MARBLE_DOOR_KEYS: 'k1:AAAA' });
  assert.equal(s.direct, true);
  assert.equal(s.guestDoorKeys, `k1:AAAA ${entry}`);
  const off = loadHostSettings(base);
  assert.equal(off.direct, false);
  assert.equal(off.guestDoorKeys, null);
});

test('a direct guest\'s settings say so', () => {
  const at = (entries, key) => entries.find(([k]) => k === key)?.[1];
  const common = { name: 'ana', release: '20261029T000000Z-abc1234', port: 4500, secret: 'f'.repeat(64), doorKeys: entry, owner: 'direct-ana' };
  assert.equal(at(guestEntries({ ...common, direct: true }), 'MARBLE_DOOR_DIRECT'), '1');
  assert.equal(at(guestEntries(common), 'MARBLE_DOOR_DIRECT'), undefined);
  assert.equal(at(guestEntries({ ...common, direct: true }), 'MARBLE_DRIVE_GATE'), 'tools');
});

test('a direct drive, end to end: no pass sends a browser to /enter, the link\'s pass becomes the cookie, and the cookie opens the drive', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'host-direct-'));
  const config = loadConfig({
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_SECRET: 'e'.repeat(64),
    MARBLE_DRIVE_GATE: 'tools',
    MARBLE_DOOR_KEYS: entry,
    MARBLE_DOOR_NAME: 'ana',
    MARBLE_DOOR_OWNER: 'direct-ana',
    MARBLE_DOOR_DIRECT: '1',
  });
  const drive = await createDrive(config, { log: { log() {}, error() {}, info() {} }, agents: false });
  t.after(async () => {
    await drive.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  // As the router passes a request on: forwarded, over https, for ana's name.
  const through = { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-host': 'ana.marbledrive.app', 'x-forwarded-proto': 'https' };
  const go = (route, init = {}) => fetch(`http://127.0.0.1:${port}${route}`, { redirect: 'manual', ...init, headers: { ...through, ...(init.headers ?? {}) } });

  const closed = await go('/a/Notes', { headers: { accept: 'text/html' } });
  assert.equal(closed.status, 302);
  assert.equal(closed.headers.get('location'), '/enter?to=%2Fa%2FNotes');

  const page = await go('/enter?to=%2Fa%2FNotes', { headers: { accept: 'text/html' } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  const body = await page.text();
  assert.match(body, /data-to="\/a\/Notes"/);
  assert.equal((body.match(/<script/g) ?? []).length, 1);
  assert.doesNotMatch(body, /\son[a-z]+=/i);

  const { pass } = signPass({ signingKey, name: 'ana', account: 'direct-ana' });
  const post = (p, origin = 'https://ana.marbledrive.app') => go('/enter', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ pass: p }) });
  assert.equal((await post(pass, 'https://bob.marbledrive.app')).status, 403, 'only from its own page');
  assert.equal((await post(signPass({ signingKey, name: 'bob', account: 'direct-bob' }).pass)).status, 401, 'another drive\'s pass');
  const ok = await post(pass);
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /^__Host-md_pass=v1\.h1\.[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);

  const open = await go('/drive/list', { headers: { cookie: cookie.split(';')[0] } });
  assert.notEqual(open.status, 401);
  assert.notEqual(open.status, 302);
  // The passphrase still isn't a way in for a browser from outside.
  assert.equal((await go('/gate', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://ana.marbledrive.app' }, body: JSON.stringify({ secret: 'e'.repeat(64) }) })).status, 403);
});

test('a drive that isn\'t direct has no /enter of its own', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'host-direct-'));
  const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: 'e'.repeat(64), MARBLE_DRIVE_GATE: 'tools', MARBLE_DOOR_KEYS: entry, MARBLE_DOOR_NAME: 'ana', MARBLE_DOOR_OWNER: 'direct-ana' }), { log: { log() {}, error() {}, info() {} }, agents: false });
  t.after(async () => {
    await drive.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const { pass } = signPass({ signingKey, name: 'ana', account: 'direct-ana' });
  const res = await fetch(`http://127.0.0.1:${port}/enter`, { method: 'POST', redirect: 'manual', headers: { 'x-forwarded-for': '203.0.113.9', 'content-type': 'application/json' }, body: JSON.stringify({ pass }) });
  assert.equal(res.headers.get('set-cookie'), null);
});
