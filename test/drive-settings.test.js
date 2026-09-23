// The drive's own settings: choices that belong to one drive rather than to the
// machine it runs on or to one document in it. `<drive>/.marble/drive.json`,
// optional, and never able to break the host by being wrong.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { readDriveSettings } = await import('../server/drive-settings.js');
const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

const EMPTY = { realms: {}, latest: null };

async function marbleDirWith(contents) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-settings-'));
  if (contents !== undefined) await fsp.writeFile(path.join(dir, 'drive.json'), contents);
  return dir;
}

test('no drive.json is no settings', async () => {
  assert.deepEqual(await readDriveSettings(await marbleDirWith()), EMPTY);
});

test('a drive.json that is not JSON is no settings, not a crash', async () => {
  assert.deepEqual(await readDriveSettings(await marbleDirWith('{ realms: nope')), EMPTY);
  assert.deepEqual(await readDriveSettings(await marbleDirWith('[1, 2]')), EMPTY);
});

test('only well-formed entries survive', async () => {
  const dir = await marbleDirWith(JSON.stringify({
    realms: { Research: 'research', Bad: 7, '': 'x', Days: 'days' },
    latest: 42,
  }));
  assert.deepEqual(await readDriveSettings(dir), { realms: { Research: 'research', Days: 'days' }, latest: null });
  const listed = await marbleDirWith(JSON.stringify({ realms: ['research'], latest: 'Days/today' }));
  assert.deepEqual(await readDriveSettings(listed), { realms: {}, latest: 'Days/today' });
});

test('the default /today target names nobody\'s folder', () => {
  assert.equal(loadConfig({ MARBLE_DRIVE_ROOT: os.tmpdir() }).latestDoc, null);
});

// ------------------------------------------------------------------ the host

async function host(env = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-settings-host-'));
  const config = loadConfig({ MARBLE_DRIVE_ROOT: root, ...env });
  const drive = await createDrive(config, { log: { log() {}, error() {} } });
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const get = (route) => fetch(`http://127.0.0.1:${port}${route}`, { redirect: 'manual' });
  const settle = async (json) => {
    await fsp.mkdir(path.join(root, '.marble'), { recursive: true });
    await fsp.writeFile(path.join(root, '.marble', 'drive.json'), JSON.stringify(json));
  };
  return { root, drive, get, settle, close: () => drive.close() };
}

test('/drive/settings serves the drive\'s settings, and an empty answer when there are none', async (t) => {
  const h = await host();
  t.after(h.close);
  assert.deepEqual(await (await h.get('/drive/settings')).json(), EMPTY);
  await h.settle({ realms: { Research: 'research' }, latest: 'Days/today' });
  assert.deepEqual(await (await h.get('/drive/settings')).json(), { realms: { Research: 'research' }, latest: 'Days/today' });
});

test('/today opens the environment\'s pick, then drive.json\'s, then the newest document', async (t) => {
  const h = await host();
  t.after(h.close);
  await h.drive.store.write('older', '<html><body>older</body></html>', { label: 'seeded' });
  await h.drive.store.write('Days/today', '<html><body>today</body></html>', { label: 'seeded' });
  await h.drive.store.write('newest', '<html><body>newest</body></html>', { label: 'seeded' });
  assert.equal((await h.get('/today')).headers.get('location'), '/a/newest');

  await h.settle({ latest: 'Days/today' });
  assert.equal((await h.get('/today')).headers.get('location'), `/a/${encodeURIComponent('Days/today')}`);

  const pinned = await host({ MARBLE_DRIVE_LATEST_DOC: 'older' });
  t.after(pinned.close);
  await pinned.drive.store.write('older', '<html><body>older</body></html>', { label: 'seeded' });
  await pinned.drive.store.write('Days/today', '<html><body>today</body></html>', { label: 'seeded' });
  await pinned.settle({ latest: 'Days/today' });
  assert.equal((await pinned.get('/today')).headers.get('location'), '/a/older');
});
