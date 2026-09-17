import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStore } from '../server/store/index.js';
import { seedAgents, seedDrive } from '../server/seed.js';

const fresh = async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-agents-seed-'));
  const store = createStore({ root });
  await store.ready();
  return { root, store };
};

test('Agents is seeded once, and a hand-edited copy is not overwritten', async () => {
  const { store } = await fresh();
  await seedDrive(store);
  const first = await seedAgents(store);
  assert.equal(first.seeded, true);
  assert.equal(first.path, 'Agents');
  assert.match(await store.read('Agents'), /marble-agent" content="custom"/);
  assert.match(await store.read('Agents'), /<marble-conversation/);

  const edited = (await store.read('Agents')).replace('Agents', 'Agents (mine)');
  await store.write('Agents', edited, { label: 'edit' });
  const second = await seedAgents(store);
  assert.equal(second.seeded, false);
  assert.match(await store.read('Agents'), /Agents \(mine\)/);
});
