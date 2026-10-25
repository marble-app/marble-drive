// marble-host's start (server/host/boot.js, server/host/index.js): every
// drive the registry says is running is started unless it already is, one
// cut off while being made is marked failed, a missing settings file is
// written again, and the router and the admin API answer on their ports.
// Stopping marble-host leaves the drives alone.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { bootDrives } from '../server/host/boot.js';
import { createGuestEnvs, guestEntries } from '../server/host/guest-env.js';
import { startHost } from '../server/host/index.js';
import { openRegistry } from '../server/host/registry.js';
import { fakeUnits, freePort, quiet, scratchPc } from './fixtures/host.js';

const RELEASE = '20261025T161133Z-4b2103a';

async function withDrives(pc, drives) {
  const registry = await openRegistry({ dir: pc.state });
  const envs = createGuestEnvs({ dir: pc.guestEnvDir });
  await registry.update((r) => {
    for (const [name, state, port] of drives) r.drives[name] = { name, port, owner: 'acct_1', state, release: RELEASE, channel: 'everyone', restarts: 0, cohort: null };
  });
  for (const [name, state, port] of drives) {
    if (state !== 'removed') await envs.write(name, guestEntries({ name, release: RELEASE, port, secret: 'f'.repeat(64), doorKeys: pc.settings.doorKeys, owner: 'acct_1', ownerName: 'Bryan' }));
  }
  return { registry, envs };
}

test('boot starts every running drive that is down, leaves one that is up, and touches no other', async (t) => {
  const pc = await scratchPc();
  t.after(pc.cleanup);
  const { registry, envs } = await withDrives(pc, [['ana', 'running', 4500], ['ben', 'running', 4501], ['cho', 'suspended', 4502], ['dee', 'failed', 4503], ['eve', 'removed', 4504], ['fay', 'making', 4505]]);
  const units = fakeUnits();
  units.active.set('ben', 'active');
  const result = await bootDrives({ registry, units, envs, settings: pc.settings, log: quiet });
  assert.deepEqual(result, { started: ['ana'], already: ['ben'], failed: [], interrupted: ['fay'] });
  assert.deepEqual(units.calls, ['start ana']);
  assert.equal(registry.drive('fay').state, 'failed');
  assert.match(registry.drive('fay').failed.why, /marble-host stopped while it was being made/);
  assert.equal(registry.drive('cho').state, 'suspended');
  const kinds = (await registry.events()).map((e) => `${e.kind} ${e.drive}`);
  assert.deepEqual(kinds.sort(), ['failed fay', 'started ana']);
});

test('a running drive whose settings file is gone gets a new one before it starts', async (t) => {
  const pc = await scratchPc();
  t.after(pc.cleanup);
  const { registry, envs } = await withDrives(pc, [['ana', 'running', 4500]]);
  await envs.remove('ana');
  const units = fakeUnits();
  await bootDrives({ registry, units, envs, settings: pc.settings, log: quiet, newSecret: () => 'e'.repeat(64) });
  const env = await envs.read('ana');
  assert.equal(env.PORT, '4500');
  assert.equal(env.MARBLE_GUEST_RELEASE, RELEASE);
  assert.equal(env.MARBLE_DRIVE_SECRET, 'e'.repeat(64));
  assert.equal((await fsp.stat(envs.file('ana'))).mode & 0o777, 0o600);
  assert.deepEqual(units.calls, ['start ana']);
});

test('a settings file from before drives had addresses of their own gets its drive\'s, keeping the rest', async (t) => {
  const pc = await scratchPc();
  t.after(pc.cleanup);
  const { registry, envs } = await withDrives(pc, [['ana', 'running', 4500], ['ben', 'suspended', 4527], ['cho', 'removed', 4502]]);
  for (const name of ['ana', 'ben']) {
    const text = await fsp.readFile(envs.file(name), 'utf8');
    await fsp.writeFile(envs.file(name), text.replace(/^HOST=.*\n/m, ''), { mode: 0o600 });
    assert.equal((await envs.read(name)).HOST, undefined);
  }
  const units = fakeUnits();
  await bootDrives({ registry, units, envs, settings: pc.settings, log: quiet });
  assert.equal((await envs.read('ana')).HOST, '127.0.0.10');
  assert.equal((await envs.read('ben')).HOST, '127.0.0.37', 'a suspended drive too, for when it is resumed');
  assert.equal((await envs.read('ana')).MARBLE_DRIVE_SECRET, 'f'.repeat(64), 'its passphrase kept');
  assert.equal(await envs.read('cho'), null);
  assert.deepEqual(units.calls, ['start ana']);
});

test('a drive that cannot be started is said, and the rest still start', async (t) => {
  const pc = await scratchPc();
  t.after(pc.cleanup);
  const { registry, envs } = await withDrives(pc, [['ana', 'running', 4500], ['ben', 'running', 4501]]);
  const units = fakeUnits();
  const start = units.start;
  units.start = async (name) => {
    if (name === 'ana') throw new Error('Access denied');
    return start(name);
  };
  const told = [];
  const result = await bootDrives({ registry, units, envs, settings: pc.settings, log: quiet, notify: async (drive, kind, message) => told.push({ drive, kind, message }) });
  assert.deepEqual(result.failed, ['ana']);
  assert.deepEqual(result.started, ['ben']);
  assert.deepEqual(told, [{ drive: 'ana', kind: 'boot', message: 'ana could not be started when marble-host started: Access denied' }]);
});

test('startHost: the router and the admin API on their ports, the drives brought back, and stop leaves them running', async (t) => {
  const pc = await scratchPc();
  t.after(pc.cleanup);
  await withDrives(pc, [['ana', 'running', 4500], ['ben', 'suspended', 4501]]);
  const settingsFile = path.join(pc.root, 'host.env');
  const routerPort = await freePort();
  const adminPort = await freePort();
  await fsp.writeFile(settingsFile, `HOST_KEY=router-key\nHOST_ADMIN_TOKEN=admin-token\nHOST_ROUTER_PORT=${routerPort}\nHOST_ADMIN_PORT=${adminPort}\nHOST_MODE=user\n`, { mode: 0o600 });
  const env = { HOME: pc.root, MARBLE_HOST_ENV: settingsFile, HOST_STATE_DIR: pc.state, HOST_OPT: pc.opt, HOST_GUEST_ENV_DIR: pc.guestEnvDir, HOST_GUEST_STATE_DIR: pc.guestStateDir };
  const units = fakeUnits();
  const probe = { health: async () => ({ ok: true, working: 0, release: RELEASE }), page: async () => 302, deep: async () => null };
  const host = await startHost({ env, log: quiet, units, probe, watchEveryMs: 60_000 });
  t.after(() => host.stop());
  assert.deepEqual(host.ports, { router: routerPort, admin: adminPort });
  assert.deepEqual(units.calls, ['start ana'], 'boot brought ana back, and not the suspended one');

  const health = await fetch(`http://127.0.0.1:${routerPort}/_host/health`, { headers: { 'x-marble-host-key': 'router-key' } });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { drives: 2, running: 1, release: RELEASE, ok: true });
  assert.equal((await fetch(`http://127.0.0.1:${routerPort}/_host/health`)).status, 401);
  const drives = await fetch(`http://127.0.0.1:${adminPort}/drives`, { headers: { authorization: 'Bearer admin-token' } });
  assert.deepEqual((await drives.json()).drives.map((d) => [d.name, d.state, d.active]), [['ana', 'running', 'active'], ['ben', 'suspended', 'inactive']]);
  assert.equal((await fetch(`http://127.0.0.1:${adminPort}/drives`, { headers: { authorization: 'Bearer router-key' } })).status, 401, 'the router\'s key is not the admin token');

  await host.stop();
  assert.deepEqual(units.calls, ['start ana'], 'stopping marble-host stopped no drive');
  await assert.rejects(fetch(`http://127.0.0.1:${routerPort}/_host/health`));
});

test('startHost refuses to start without its keys, naming the setting and not a value', async (t) => {
  const pc = await scratchPc();
  t.after(pc.cleanup);
  const settingsFile = path.join(pc.root, 'host.env');
  await fsp.writeFile(settingsFile, 'HOST_ADMIN_TOKEN=only-this\n', { mode: 0o600 });
  const env = { HOME: pc.root, MARBLE_HOST_ENV: settingsFile, HOST_STATE_DIR: pc.state };
  await assert.rejects(startHost({ env, log: quiet, units: fakeUnits() }), (err) => /HOST_KEY is not set/.test(err.message) && !err.message.includes('only-this'));
  await fsp.writeFile(settingsFile, 'HOST_KEY=k\n', { mode: 0o600 });
  await assert.rejects(startHost({ env, log: quiet, units: fakeUnits() }), /HOST_ADMIN_TOKEN is not set/);
});
