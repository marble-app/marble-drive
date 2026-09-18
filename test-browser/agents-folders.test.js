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
  await page.evaluate(async () => {
    try {
      const { folders } = await window.marble.agent.folders();
      for (const row of folders) await window.marble.agent.deleteFolder(row.id);
    } catch { /* fresh agent */ }
  });
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

test('Folders rail groups conversations and New chat lands ungrouped', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'outline spec' });
    await agent.update(b, { title: 'figure pass' });
    await agent.createFolder({ conversationIds: [a, b], name: 'Research', color: 'research' });
    window.__ids = { a, b };
  });
  await page.locator('.views [data-view="folders"]').click();
  await page.locator('.folder-group[data-color="research"]', { hasText: 'Research' }).waitFor();
  assert.match(await page.locator('.folder-group[data-color="research"]').textContent(), /outline spec/);
  await page.locator('.folder-new-chat').click();
  await page.waitForFunction(() => document.querySelectorAll('.folder-ungrouped .folder-tab').length >= 1);
});

test('dropping a tab on another tab creates a folder', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'alpha' });
    await agent.update(b, { title: 'beta' });
    return { a, b };
  });
  await page.locator('.views [data-view="folders"]').click();
  const alpha = page.locator(`.folder-tab[data-id="${ids.a}"]`);
  const beta = page.locator(`.folder-tab[data-id="${ids.b}"]`);
  await alpha.waitFor();
  await alpha.dragTo(beta);
  await page.locator('.folder-group').waitFor();
  const listed = await page.evaluate(() => window.marble.agent.folders());
  assert.equal((await listed).folders.length, 1);
});

test('Save as folder persists a shift-selected working set; Not now does not', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'one' });
    await agent.update(b, { title: 'two' });
    return { a, b };
  });
  await page.locator('.views [data-view="folders"]').click();
  await page.locator(`.folder-tab[data-id="${ids.a}"]`).click();
  await page.locator(`.folder-tab[data-id="${ids.b}"]`).click({ modifiers: ['Shift'] });
  await page.locator('.folder-save').waitFor();
  await page.locator('.folder-save-dismiss').click();
  let listed = await page.evaluate(() => window.marble.agent.folders());
  assert.equal((await listed).folders.length, 0);
  await page.locator(`.folder-tab[data-id="${ids.b}"]`).click({ modifiers: ['Shift'] });
  await page.locator('.folder-save-confirm').click();
  listed = await page.evaluate(() => window.marble.agent.folders());
  assert.equal((await listed).folders.length, 1);
});
