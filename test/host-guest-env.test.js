// A drive's settings file (server/host/guest-env.js): what it says, mode 600
// in a folder only the owner opens, and nothing in it that systemd's
// EnvironmentFile= could read differently from node.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { GUEST_ADDRESS, guestAddress, HOST_SIDE } from '../server/host/addresses.js';
import { checkEntry, createGuestEnvs, guestEntries, newSecret, parseEntries, renderEnv } from '../server/host/guest-env.js';
import { tempDirs } from './fixtures/host.js';

const temp = tempDirs();
after(temp.cleanup);

const base = { name: 'ana', release: '20261025T161133Z-4b2103a', port: 4501, secret: 'a'.repeat(64), doorKeys: 'k1:AAAA', owner: 'acct_1', publicSuffix: 'marbledrive.app', ownerName: 'Bryan' };

test('a drive\'s settings: its name, release, port, passphrase, the door, its address and its git name', () => {
  const env = Object.fromEntries(guestEntries(base));
  assert.deepEqual(env, {
    MARBLE_GUEST_NAME: 'ana',
    MARBLE_GUEST_RELEASE: '20261025T161133Z-4b2103a',
    PORT: '4501',
    HOST: '127.0.0.11',
    MARBLE_DRIVE_SECRET: 'a'.repeat(64),
    MARBLE_DOOR_KEYS: 'k1:AAAA',
    MARBLE_DOOR_NAME: 'ana',
    MARBLE_DOOR_OWNER: 'acct_1',
    MARBLE_DRIVE_GATE: 'tools',
    MARBLE_DRIVE_PUBLIC_URL: 'https://ana.marbledrive.app',
    GIT_AUTHOR_NAME: 'ana',
    GIT_AUTHOR_EMAIL: 'ana@users.marbledrive.app',
    GIT_COMMITTER_NAME: 'ana',
    GIT_COMMITTER_EMAIL: 'ana@users.marbledrive.app',
    MARBLE_HOST_OWNER: 'Bryan',
  });
});

test('a drive\'s address comes from its port alone: 127.0.0.10 for 4500 up to 127.0.0.109 for 4599, and never 127.0.0.1', () => {
  assert.equal(guestAddress(4500), '127.0.0.10');
  assert.equal(guestAddress(4527), '127.0.0.37');
  assert.equal(guestAddress('4599'), '127.0.0.109');
  for (let port = 4500; port <= 4599; port += 1) assert.match(guestAddress(port), GUEST_ADDRESS);
  for (const bad of [4499, 4600, 4401, 4500.5, 'x', null, undefined, -4500]) {
    assert.throws(() => guestAddress(bad), /not a drive's/, String(bad));
  }
  assert.throws(() => guestEntries({ ...base, port: 4401 }), /not a drive's/, 'no settings file for a port that has no address');
  for (const bad of ['127.0.0.1', '127.0.0.2', '127.0.0.9', '127.0.0.110', '127.0.0.010', '127.0.1.10', '10.0.0.10', '127.0.0.10 ', '']) {
    assert.ok(!GUEST_ADDRESS.test(bad), bad);
  }
  assert.equal(HOST_SIDE, '127.0.0.2', 'marble-host asks from an address no drive has');
  assert.ok(!GUEST_ADDRESS.test(HOST_SIDE));
});

test('MARBLE_STUDY only for a drive from a study invite', () => {
  assert.equal(Object.fromEntries(guestEntries({ ...base, cohort: 'study' })).MARBLE_STUDY, '1');
  assert.equal(Object.fromEntries(guestEntries({ ...base, cohort: 'labmates' })).MARBLE_STUDY, undefined);
  assert.equal(Object.fromEntries(guestEntries(base)).MARBLE_STUDY, undefined);
});

test('the door\'s keys keep one space between them, however they came', () => {
  const env = Object.fromEntries(guestEntries({ ...base, doorKeys: '  k1:AAAA\n\tk2:BB+/== ' }));
  assert.equal(env.MARBLE_DOOR_KEYS, 'k1:AAAA k2:BB+/==');
});

test('nothing systemd and node might read differently gets in, and the value is never named', () => {
  for (const bad of ['two words', 'quo"te', "it's", 'back\\slash', '$HOME', '`id`', 'line\nbreak', 'tab\there', 'cr\rhere']) {
    assert.throws(() => checkEntry('MARBLE_DRIVE_SECRET', bad), (err) => /MARBLE_DRIVE_SECRET/.test(err.message) && !err.message.includes(bad), JSON.stringify(bad));
  }
  assert.throws(() => checkEntry('MARBLE_DOOR_KEYS', 'k1:AAAA  k2:BBBB'), /MARBLE_DOOR_KEYS/);
  assert.throws(() => checkEntry('MARBLE_DOOR_KEYS', 'k1:AAAA "k2"'), /MARBLE_DOOR_KEYS/);
  assert.throws(() => checkEntry('lower', 'x'), /not a setting's name/);
  checkEntry('MARBLE_DOOR_KEYS', 'k1:AAAA k2:BBBB');
  checkEntry('MARBLE_DOOR_KEYS', '');
  assert.throws(() => guestEntries({ ...base, name: 'Ana' }), /not a drive's name/);
  assert.throws(() => guestEntries({ ...base, release: '../x' }), /not a release's name/);
  assert.throws(() => guestEntries({ ...base, ownerName: 'Bryan Min' }), /MARBLE_HOST_OWNER/);
});

test('written mode 600, read back, changed in place keeping its order, and removed', async () => {
  const dir = await temp.make('guest-env-');
  const envs = createGuestEnvs({ dir });
  await envs.write('ana', guestEntries(base));
  const file = path.join(dir, 'ana.env');
  assert.equal(envs.file('ana'), file);
  assert.equal((await fsp.stat(file)).mode & 0o777, 0o600);
  const text = await fsp.readFile(file, 'utf8');
  assert.match(text, /^# ana: written by marble-host/);
  assert.ok(!/["']/.test(text.split('\n').slice(1).join('\n')), 'nothing quoted');
  assert.equal((await envs.read('ana')).PORT, '4501');
  await envs.update('ana', { MARBLE_GUEST_RELEASE: '20261026T000000Z-abcdef0', MARBLE_CONSENT: 'v1' });
  const keys = parseEntries(await fsp.readFile(file, 'utf8')).map(([k]) => k);
  assert.equal(keys[1], 'MARBLE_GUEST_RELEASE');
  assert.equal(keys.at(-1), 'MARBLE_CONSENT');
  assert.equal((await envs.read('ana')).MARBLE_GUEST_RELEASE, '20261026T000000Z-abcdef0');
  assert.equal((await fsp.stat(file)).mode & 0o777, 0o600);
  await envs.remove('ana');
  assert.equal(await envs.read('ana'), null);
  assert.throws(() => envs.file('../etc/passwd'), /not a drive's name/);
  assert.deepEqual(await fsp.readdir(dir), []);
});

test('a setting given as null is taken out; changes to one file go in the order asked, and none writes a file back once it is deleted', async () => {
  const dir = await temp.make('guest-env-');
  const envs = createGuestEnvs({ dir });
  await envs.write('ana', guestEntries({ ...base, cohort: 'study' }));
  await envs.update('ana', { MARBLE_CONSENT: 'v1@2026-10-25T11:00:00.000Z' });
  assert.equal((await envs.read('ana')).MARBLE_STUDY, '1');
  await envs.update('ana', { MARBLE_STUDY: null, MARBLE_CONSENT: null, NEVER_THERE: null });
  const env = await envs.read('ana');
  assert.equal(env.MARBLE_STUDY, undefined);
  assert.equal(env.MARBLE_CONSENT, undefined);
  assert.equal(env.NEVER_THERE, undefined);
  assert.equal(env.MARBLE_DRIVE_SECRET, 'a'.repeat(64), 'the rest kept');
  assert.equal((await fsp.stat(envs.file('ana'))).mode & 0o777, 0o600);

  const before = envs.update('ana', { MARBLE_CONSENT: 'v2@2026-10-25T12:00:00.000Z' });
  const gone = envs.remove('ana');
  const after = envs.update('ana', { MARBLE_CONSENT: 'v3@2026-10-25T13:00:00.000Z' });
  await before;
  await gone;
  await assert.rejects(after, { code: 'ENOENT' });
  assert.equal(await envs.read('ana'), null, 'not written back');
  assert.deepEqual(await fsp.readdir(dir), []);
});

test('a passphrase is 64 random hex characters', () => {
  const a = newSecret();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, newSecret());
  assert.equal(renderEnv([['A', '1']]), 'A=1\n');
});
