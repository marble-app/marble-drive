// A fresh install starts with its own space: nothing the host seeds, lists or
// lands on belongs to whoever wrote the app.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { seedAgents, seedDrive } = await import('../server/seed.js');
const { PLUGIN_DIR, listSkills, skillDirs } = await import('../server/agent/skills.js');

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-fresh-'));
const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-fresh-home-'));
const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root }), { log: { log() {}, error() {} }, agents: false });
await seedDrive(drive.store);
await seedAgents(drive.store);
const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
test.after(() => drive.close());

test('the seeded Drive and Agents pages name nobody\'s folders', async () => {
  for (const doc of ['drive', 'Agents']) {
    const source = await drive.store.read(doc);
    assert.ok(source, `${doc} was seeded`);
    assert.doesNotMatch(source, /Bryan/, `${doc} names the owner`);
  }
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/drive/settings`)).json(), { realms: {}, latest: null });
});

test('the only skills a fresh drive is offered are the app\'s own', async () => {
  const skills = await listSkills(skillDirs({ home, root, plugin: PLUGIN_DIR }));
  assert.ok(skills.length > 0);
  for (const skill of skills) assert.match(skill.id, /^marble-drive:/);
  assert.ok(!skills.some((s) => /my-day/.test(s.id)));
});

test('/today on a fresh drive lands on a document it actually has', async () => {
  const landing = await fetch(`http://127.0.0.1:${port}/today`, { redirect: 'manual' });
  assert.equal(landing.status, 302);
  const where = decodeURIComponent(landing.headers.get('location').slice('/a/'.length));
  assert.ok(await drive.store.has(where), `${where} exists`);
});
