// marble-host's settings (server/host/settings.js): host.env, mode 600, with
// the environment over it, every path movable for a test or a trial, and a
// bad value refused by name, never shown.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { hostPaths, loadHostSettings, NAME, NEVER_PORTS, parseRange, readSettingsFile, RELEASE } from '../server/host/settings.js';
import { tempDirs } from './fixtures/host.js';

const temp = tempDirs();
after(temp.cleanup);

async function home(text, mode = 0o600) {
  const dir = await temp.make('host-settings-');
  const file = path.join(dir, '.config', 'marble-drive', 'host.env');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (text !== null) {
    await fsp.writeFile(file, text, { mode });
    await fsp.chmod(file, mode);
  }
  return { dir, file };
}

test('the defaults are the PC\'s: ports 4460 and 4461, guests on 4500-4599, /opt/marble, /etc/marble-guests', async () => {
  const h = await home(null);
  const s = loadHostSettings({ HOME: h.dir });
  assert.equal(s.settingsFound, false);
  assert.equal(s.routerPort, 4460);
  assert.equal(s.adminPort, 4461);
  assert.deepEqual(s.guestPorts, { from: 4500, to: 4599 });
  assert.equal(s.mode, 'system');
  assert.equal(s.opt, '/opt/marble');
  assert.equal(s.guestEnvDir, '/etc/marble-guests');
  assert.equal(s.guestStateDir, '/var/lib/marble-guests');
  assert.equal(s.state, path.join(h.dir, '.local', 'state', 'marble-host'));
  assert.equal(s.hostEnv, h.file);
  assert.equal(s.ownerName, 'Bryan');
  assert.equal(s.key, null);
  assert.deepEqual(NEVER_PORTS, [4400, 4401, 4402, 4498]);
});

test('host.env is read, the environment wins over it, and an empty value is no value', async () => {
  const h = await home('# marble-host\nHOST_KEY=from-file\nHOST_ADMIN_TOKEN=admin\nHOST_ROUTER_PORT=4470\nHOST_MODE=user\nHOST_NTFY_URL=\nMARBLE_DOOR_KEYS=k1:AAAA k2:BBBB\n');
  const s = loadHostSettings({ HOME: h.dir, HOST_ROUTER_PORT: '4480' });
  assert.equal(s.settingsFound, true);
  assert.equal(s.key, 'from-file');
  assert.equal(s.adminToken, 'admin');
  assert.equal(s.routerPort, 4480, 'the environment wins');
  assert.equal(s.mode, 'user');
  assert.equal(s.ntfyUrl, null);
  assert.equal(s.doorKeys, 'k1:AAAA k2:BBBB', 'keys keep their single spaces');
});

test('every place marble-host reads or writes can be moved', () => {
  const p = hostPaths({ HOME: '/h', MARBLE_HOST_ENV: '/x/host.env', HOST_STATE_DIR: '/x/state', HOST_OPT: '/x/opt', HOST_GUEST_ENV_DIR: '/x/etc', HOST_GUEST_STATE_DIR: '/x/guests', HOST_BACKUP_STATUS_DIR: '/x/backups' });
  assert.deepEqual(p, { hostEnv: '/x/host.env', state: '/x/state', opt: '/x/opt', guestEnvDir: '/x/etc', guestStateDir: '/x/guests', backupStatusDir: '/x/backups' });
  assert.equal(hostPaths({ HOME: '/h' }).backupStatusDir, '/var/lib/marble-backup/status', 'where root\'s backup writes each drive\'s status');
});

test('a host.env others can read is refused, naming the file and not a value', async () => {
  const h = await home('HOST_KEY=secret-value\n', 0o644);
  assert.throws(() => loadHostSettings({ HOME: h.dir }), (err) => /can be read by others; chmod 600 it first/.test(err.message) && !err.message.includes('secret-value'));
  assert.equal(readSettingsFile(path.join(h.dir, 'nope.env')), null);
});

test('a bad port, range or mode is refused by name', async () => {
  const h = await home(null);
  assert.throws(() => loadHostSettings({ HOME: h.dir, HOST_ROUTER_PORT: 'eighty' }), /HOST_ROUTER_PORT is a port number/);
  assert.throws(() => loadHostSettings({ HOME: h.dir, HOST_ADMIN_PORT: '80' }), /HOST_ADMIN_PORT is a port number/);
  assert.throws(() => loadHostSettings({ HOME: h.dir, HOST_MODE: 'root' }), /HOST_MODE is system or user/);
  assert.throws(() => parseRange('4599-4500'), /HOST_GUEST_PORTS is <first>-<last>/);
  assert.throws(() => parseRange('80-90'), /HOST_GUEST_PORTS/);
  assert.deepEqual(parseRange(' 4500 - 4510 '), { from: 4500, to: 4510 });
});

test('the drives\' ports lie within 4500-4599, since each gives a drive its loopback address', async () => {
  const h = await home(null);
  assert.deepEqual(loadHostSettings({ HOME: h.dir, HOST_GUEST_PORTS: '4510-4520' }).guestPorts, { from: 4510, to: 4520 });
  for (const range of ['4500-4600', '4400-4599', '5000-5010']) {
    assert.throws(() => loadHostSettings({ HOME: h.dir, HOST_GUEST_PORTS: range }), /HOST_GUEST_PORTS lies within 4500-4599/, range);
  }
});

test('a drive\'s name and a release\'s name', () => {
  for (const ok of ['ana', 'ana-b', 'a1b', 'x'.repeat(40)]) assert.ok(NAME.test(ok), ok);
  for (const bad of ['an', 'Ana', '-ana', 'ana-', 'a_b', 'a.b', 'x'.repeat(41), '../x']) assert.ok(!NAME.test(bad), bad);
  assert.ok(RELEASE.test('20261025T161133Z-4b2103a'));
  for (const bad of ['', '.hidden', '../x', 'a/b', 'a b']) assert.ok(!RELEASE.test(bad), bad);
});
