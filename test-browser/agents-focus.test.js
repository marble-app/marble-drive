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

test('click selects a Focus card; double-click pins Full and demotes the previous Full to digest', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'first', pinned: true });
    await agent.update(b, { title: 'second' });
    return { a, b };
  });
  await page.locator('.views [data-view="focus"]').click();
  const second = page.locator(`.focus-card[data-id="${ids.b}"]`);
  await second.click();
  assert.equal(await second.getAttribute('data-selected'), 'true');
  assert.equal(await second.getAttribute('data-lod'), 'digest');
  await second.dblclick();
  await page.waitForFunction((id) => {
    const el = document.querySelector(`.focus-card[data-id="${id}"]`);
    return el?.getAttribute('data-lod') === 'full';
  }, ids.b);
  assert.equal(await page.locator(`.focus-card[data-id="${ids.a}"]`).getAttribute('data-lod'), 'digest');
  const stillInPane = await page.evaluate(() => Boolean(document.querySelector('.pane > marble-conversation:not([data-marble-transient])')));
  assert.equal(stillInPane, true);
});
