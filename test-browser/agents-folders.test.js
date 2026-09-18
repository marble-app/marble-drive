import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();

const host = await startDrive({
  documents: { garden: GARDEN, Agents: AGENTS },
});
test.after(() => host.close());

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  return { page, errors };
};

test('marble.agent can create and list a folder', async () => {
  const { page } = await openAgents();
  const result = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    const folder = await agent.createFolder({ conversationIds: [a, b], name: 'CHI', color: 'fun' });
    const listed = await agent.folders();
    return { folder, listed, aFolder: (await agent.conversation(a)).meta.folderId };
  });
  assert.equal(result.folder.name, 'CHI');
  assert.equal(result.listed.folders.length, 1);
  assert.equal(result.aFolder, result.folder.id);
});
