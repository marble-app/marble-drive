// test/standby.test.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import http from 'node:http';

import { createStandby, whereIsHome } from '../server/standby.js';

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}

test('health says standby and where home is; everything else waits', async () => {
  const server = createStandby({ home: 'mac', since: '2026-09-30T10:00:00.000Z' });
  const base = await listen(server);
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, standby: true, home: 'mac', working: 0 });
    const page = await fetch(`${base}/a/Agents`);
    assert.equal(page.status, 503);
    assert.equal(page.headers.get('retry-after'), '30');
    assert.match(await page.text(), /on the Mac right now/);
  } finally {
    server.close();
  }
});

test('the standby command touches nothing in the drive', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'standby-drive-'));
  await fsp.writeFile(path.join(root, 'notes.mrbl'), '<html>notes</html>');
  const before = await fsp.readdir(root, { recursive: true });
  const child = spawn(process.execPath, ['bin/marble-drive.js', 'standby'], {
    env: { ...process.env, MARBLE_DRIVE_ROOT: root, PORT: '4497', HOST: '127.0.0.1', MARBLE_HUB_ENV: '' },
    stdio: 'ignore',
  });
  try {
    let ok = false;
    for (let i = 0; i < 40 && !ok; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      ok = await fetch('http://127.0.0.1:4497/health').then((r) => r.ok, () => false);
    }
    assert.ok(ok, 'standby answered /health');
    await fetch('http://127.0.0.1:4497/notes.mrbl');
    assert.deepEqual(await fsp.readdir(root, { recursive: true }), before);
  } finally {
    child.kill('SIGTERM');
  }
});

// A host that serves instead of exiting would hang the test: give it 15 s.
const exitOf = (child) => new Promise((resolve) => {
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
});
const SETTINGS = 'HUB_DRIVE=bryan\nHUB_MACHINE=mac\nHUB_PASSPHRASE=p\nHUB_SALT=s\nLEASE_URL=http://127.0.0.1:1\nLEASE_TOKEN=t\nHUB_BACKEND=local\nHUB_LOCAL_DIR=/nowhere\n';

test('serve with MARBLE_HUB_ENV naming a missing file exits 75 before opening the drive', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'serve-nohub-'));
  const missing = path.join(root, '..', `${path.basename(root)}-hub.env`);
  let stderr = '';
  const child = spawn(process.execPath, ['bin/marble-drive.js', 'serve'], {
    env: { ...process.env, MARBLE_DRIVE_ROOT: root, PORT: '4496', HOST: '127.0.0.1', MARBLE_HUB_ENV: missing, MARBLE_DRIVE_AGENTS: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (d) => (stderr += d));
  assert.equal(await exitOf(child), 75);
  assert.ok(stderr.includes(missing), stderr);
  assert.deepEqual(await fsp.readdir(root), []);
});

test('serve with a hold file beside the hub settings exits 75 before opening the drive', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'serve-held-'));
  const config = await fsp.mkdtemp(path.join(os.tmpdir(), 'serve-held-config-'));
  await fsp.writeFile(path.join(config, 'hub-bryan.env'), SETTINGS);
  await fsp.writeFile(path.join(config, 'hold-bryan'), '');
  let stderr = '';
  const child = spawn(process.execPath, ['bin/marble-drive.js', 'serve'], {
    env: { ...process.env, MARBLE_DRIVE_ROOT: root, PORT: '4496', HOST: '127.0.0.1', MARBLE_HUB_ENV: path.join(config, 'hub-bryan.env'), MARBLE_DRIVE_AGENTS: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (d) => (stderr += d));
  assert.equal(await exitOf(child), 75);
  assert.match(stderr, /held by drive-home/);
  assert.deepEqual(await fsp.readdir(root), []);
});

test('standby with a malformed hub file still answers /health', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'standby-bad-'));
  const bad = path.join(root, '..', `${path.basename(root)}-hub.env`);
  await fsp.writeFile(bad, 'HUB_DRIVE=bryan\n'); // missing every other key
  const child = spawn(process.execPath, ['bin/marble-drive.js', 'standby'], {
    env: { ...process.env, MARBLE_DRIVE_ROOT: root, PORT: '4495', HOST: '127.0.0.1', MARBLE_HUB_ENV: bad },
    stdio: 'ignore',
  });
  try {
    let health = null;
    for (let i = 0; i < 40 && !health; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      health = await fetch('http://127.0.0.1:4495/health').then((r) => r.json(), () => null);
    }
    assert.deepEqual(health, { ok: true, standby: true, home: null, working: 0 });
  } finally {
    child.kill('SIGTERM');
  }
});

test('a held machine says the drive is served from the other one, naming no place', async () => {
  const server = createStandby({ home: 'fly', since: '2026-09-30T10:00:00.000Z', held: true });
  const base = await listen(server);
  try {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, standby: true, home: 'fly', working: 0 });
    const text = await (await fetch(`${base}/`)).text();
    assert.match(text, /This drive is being served from the other machine/);
    assert.doesNotMatch(text, /on Fly|on the Mac|since/);
  } finally {
    server.close();
  }
});

test('where home is: a fresh lease over the remembered one, the remembered one when the lease is unreachable', async () => {
  const settings = { HUB_DRIVE: 'bryan', file: '/x/hub.env' };
  const client = (get) => ({ get, cached: async () => ({ home: 'fly', since: 'old' }) });
  const notHeld = () => false;
  assert.deepEqual(await whereIsHome({ settings, client: client(async () => ({ home: 'mac', since: 'new' })), held: notHeld }), { home: 'mac', since: 'new', held: false });
  assert.deepEqual(await whereIsHome({ settings, client: client(async () => { throw new Error('offline'); }), held: notHeld }), { home: 'fly', since: 'old', held: false });
  assert.equal((await whereIsHome({ settings, client: client(async () => ({ home: 'mac' })), held: () => true })).held, true);
  assert.deepEqual(await whereIsHome({ settings: null, client: null }), { home: null, since: null, held: false });
});

test('the standby command asks the lease afresh, over a stale remembered one', async () => {
  const lease = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ home: 'mac', epoch: 7 }));
  });
  const leaseUrl = await listen(lease);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'standby-fresh-'));
  const config = await fsp.mkdtemp(path.join(os.tmpdir(), 'standby-fresh-config-'));
  await fsp.writeFile(path.join(config, 'hub-bryan.env'), SETTINGS.replace('HUB_MACHINE=mac', 'HUB_MACHINE=fly').replace('http://127.0.0.1:1', leaseUrl));
  await fsp.writeFile(path.join(config, 'lease-bryan.json'), JSON.stringify({ home: 'fly', epoch: 6 }));
  const child = spawn(process.execPath, ['bin/marble-drive.js', 'standby'], {
    env: { ...process.env, MARBLE_DRIVE_ROOT: root, PORT: '4494', HOST: '127.0.0.1', MARBLE_HUB_ENV: path.join(config, 'hub-bryan.env') },
    stdio: 'ignore',
  });
  try {
    let health = null;
    for (let i = 0; i < 60 && !health; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      health = await fetch('http://127.0.0.1:4494/health').then((r) => r.json(), () => null);
    }
    assert.equal(health?.home, 'mac');
    assert.match(await (await fetch('http://127.0.0.1:4494/')).text(), /on the Mac right now/);
  } finally {
    child.kill('SIGTERM');
    lease.close();
  }
});
