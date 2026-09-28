import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStore } from '../server/store/index.js';
import { seedAgents, seedChat, seedDesignSystem, seedDrive } from '../server/seed.js';

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

test('Chat is seeded once, with custom chrome, unique ids and its affordances', async () => {
  const { store } = await fresh();
  const first = await seedChat(store);
  assert.equal(first.seeded, true);
  assert.equal(first.path, 'Chat');
  const source = await store.read('Chat');
  assert.match(source, /marble-agent" content="custom"/);
  assert.doesNotMatch(source, /__(ID|TITLE|ICON|SCRIPT)__/);
  const ids = [...source.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((await seedChat(store)).seeded, false);
});

test('the Design System is seeded once, and a drive that already has one keeps it', async () => {
  const { store } = await fresh();
  const first = await seedDesignSystem(store);
  assert.equal(first.seeded, true);
  assert.equal(first.path, 'Design System');
  const source = await store.read('Design System');
  assert.match(source, /<title>Design system<\/title>/);
  assert.doesNotMatch(source, /__(ID|TITLE|ICON|SCRIPT)__/);
  // Its scripts find elements by id, so count the markup's ids, not theirs.
  const markup = source.replace(/<script>[\s\S]*?<\/script>/g, '');
  const ids = [...markup.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((await seedDesignSystem(store)).seeded, false);

  const { store: theirs } = await fresh();
  await theirs.write('Design System', '<!doctype html><title>Mine</title>', { label: 'edit' });
  const kept = await seedDesignSystem(theirs);
  assert.equal(kept.seeded, false);
  assert.match(await theirs.read('Design System'), /<title>Mine<\/title>/);
});
