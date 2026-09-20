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

test('folder name and color patch the catalog', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.createFolder({ conversationIds: [a, b], name: 'Research', color: 'research' });
  });
  await page.locator('.views [data-view="folders"]').click();
  const name = page.locator('.folder-name');
  // Rename is a double-click. A single click on the header opens the folder —
  // the name is `flex: 1`, so taking the click for renaming left opening it
  // reachable only in the few pixels beside the count.
  await name.dblclick();
  await page.waitForFunction(() => document.querySelector('.folder-name')?.isContentEditable);
  await name.evaluate((el) => {
    el.textContent = 'CHI';
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  });
  const renamed = await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      const listed = await window.marble.agent.folders();
      if (listed.folders[0]?.name === 'CHI') return listed;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      folders: (await window.marble.agent.folders()).folders,
      debug: window.__folderEdit || null,
    };
  });
  assert.equal(renamed.folders[0].name, 'CHI', JSON.stringify(renamed));
  await page.locator('.folder-tick').click();
  await page.locator('.folder-palette [data-color="gold"]').click();
  const recoloured = await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      const listed = await window.marble.agent.folders();
      if (listed.folders[0]?.color === 'gold') return listed;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return window.marble.agent.folders();
  });
  assert.equal((await recoloured).folders[0].name, 'CHI');
  assert.equal((await recoloured).folders[0].color, 'gold');
});

test('folder tab drag ghost keeps the grab point', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'alpha' });
    return { a };
  });
  await page.locator('.views [data-view="folders"]').click();
  const tab = page.locator(`.folder-tab[data-id="${ids.a}"]`);
  await tab.waitFor();
  await tab.hover();
  const box = await tab.boundingBox();
  const grabX = box.width - 8;
  const startX = box.x + grabX;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 48, startY + 36, { steps: 12 });
  await page.locator('.dock-card').waitFor({ timeout: 2000 });
  const ghost = await page.evaluate(() => {
    const card = document.querySelector('.dock-card');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  await page.mouse.up();
  assert.ok(ghost, 'expected a drag ghost');
  assert.ok(Math.abs(ghost.left - (startX + 48 - grabX)) < 24, `ghost left ${ghost.left}`);
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

test('clicking a folder header opens it as a workspace; the name does not swallow the click', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    const ids = [];
    for (const title of ['one', 'two', 'three']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
      ids.push(id);
    }
    await agent.createFolder({ conversationIds: ids, name: 'Research', color: 'research' });
  });
  await page.locator('.views [data-view="folders"]').click();
  // Dead centre of the header, which is where the editable name lives.
  await page.locator('.folder-header').first().click();
  await page.locator('.folder-group.marble-active').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('marble-conversation').length >= 3);
  assert.equal(await page.locator('.folder-name[contenteditable]').count(), 0, 'click must not start a rename');
  assert.equal(await page.locator('.dock-leaf').count(), 2);
});

test('a rail tab carries its status, target and age, not just a title', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.update(id, { title: 'figure pass' });
    await agent.createFolder({ conversationIds: [id], name: 'Research', color: 'research' });
  });
  await page.locator('.views [data-view="folders"]').click();
  const tab = page.locator('.folder-tab').first();
  await tab.locator('.tab-dot').waitFor();
  assert.equal((await tab.locator('.tab-title').textContent()).trim(), 'figure pass');
  assert.ok((await tab.locator('.tab-age').textContent()).trim().length > 0);
});

test('right-clicking a selected tab offers a folder made from the whole selection', async () => {
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
  await page.locator(`.folder-tab[data-id="${ids.b}"]`).click({ modifiers: ['Meta'] });
  await page.locator(`.folder-tab[data-id="${ids.a}"]`).click({ button: 'right' });
  await page.locator('.rail-menu').waitFor();
  assert.equal((await page.locator('.rail-menu-head').first().textContent()).trim(), '2 chats');
  await page.locator('.rail-menu button', { hasText: 'New folder from 2 chats' }).click();
  await page.waitForFunction(async () => (await window.marble.agent.folders()).folders.length === 1);
  const listed = await page.evaluate(() => window.marble.agent.folders());
  assert.equal(listed.folders.length, 1);
  const members = await page.evaluate(async (pair) => {
    const agent = window.marble.agent;
    return [(await agent.conversation(pair.a)).meta.folderId, (await agent.conversation(pair.b)).meta.folderId];
  }, ids);
  assert.equal(members[0], listed.folders[0].id);
  assert.equal(members[1], listed.folders[0].id);
  // The folder it just made is waiting for a name.
  await page.locator('.folder-name[contenteditable]').waitFor();
  await page.keyboard.press('Escape');
});

test('right-clicking empty rail space makes an empty folder, named on the spot', async () => {
  const { page } = await openAgents();
  await page.locator('.views [data-view="folders"]').click();
  await page.locator('.folder-ungrouped-label').click({ button: 'right' });
  await page.locator('.rail-menu').waitFor();
  assert.equal((await page.locator('.rail-menu-head').first().textContent()).trim(), 'Folders');
  await page.locator('.rail-menu button', { hasText: 'New folder' }).click();
  await page.locator('.folder-group').waitFor();
  const listed = await page.evaluate(() => window.marble.agent.folders());
  assert.equal(listed.folders.length, 1);
  const name = page.locator('.folder-name[contenteditable]');
  await name.waitFor();
  await page.keyboard.type('CHI 2027');
  await page.keyboard.press('Enter');
  await page.waitForFunction(async () => (await window.marble.agent.folders()).folders[0]?.name === 'CHI 2027');
});

test('dragging a selection opens a new-folder well, and dropping in it groups them', async () => {
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
  await page.locator(`.folder-tab[data-id="${ids.a}"]`).click();
  await page.locator(`.folder-tab[data-id="${ids.b}"]`).click({ modifiers: ['Meta'] });
  const tab = page.locator(`.folder-tab[data-id="${ids.a}"]`);
  const box = await tab.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30, { steps: 8 });
  const well = page.locator('.folder-well');
  await well.waitFor();
  assert.match(await well.textContent(), /from these 2 chats/);
  await page.waitForFunction(() => document.querySelector('.folder-well')?.dataset.open === 'true');
  const wellBox = await well.boundingBox();
  await page.mouse.move(wellBox.x + wellBox.width / 2, wellBox.y + wellBox.height / 2, { steps: 8 });
  await page.waitForSelector('.folder-well.marble-drop-target');
  await page.mouse.up();
  await page.waitForFunction(async () => (await window.marble.agent.folders()).folders.length === 1);
  const members = await page.evaluate(async (pair) => {
    const agent = window.marble.agent;
    return [(await agent.conversation(pair.a)).meta.folderId, (await agent.conversation(pair.b)).meta.folderId];
  }, ids);
  assert.ok(members[0]);
  assert.equal(members[0], members[1]);
  // The well is the drag's, not the file's: it goes when the drag does.
  await page.waitForFunction(() => !document.querySelector('.folder-well'));
});

test('right-clicking a folder header ungroups it without losing the chats', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.createFolder({ conversationIds: [a, b], name: 'Research', color: 'research' });
    return { a, b };
  });
  await page.locator('.views [data-view="folders"]').click();
  await page.locator('.folder-header').first().click({ button: 'right' });
  await page.locator('.rail-menu').waitFor();
  assert.equal((await page.locator('.rail-menu-head').first().textContent()).trim(), 'Research');
  await page.locator('.rail-menu button', { hasText: 'Ungroup folder' }).click();
  await page.waitForFunction(async () => (await window.marble.agent.folders()).folders.length === 0);
  const homes = await page.evaluate(async (pair) => {
    const agent = window.marble.agent;
    return [(await agent.conversation(pair.a)).meta.folderId, (await agent.conversation(pair.b)).meta.folderId];
  }, ids);
  assert.deepEqual(homes, [null, null]);
  await page.waitForFunction(
    (pair) => [pair.a, pair.b].every((id) => document.querySelector(`.folder-ungrouped .folder-tab[data-id="${id}"]`)),
    ids,
  );
  assert.equal(await page.locator('.folder-group').count(), 0);
});

test('right-clicking a pane files the chat in it, group or none', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const loose = await agent.start({ provider: 'fake' });
    const filed = await agent.start({ provider: 'fake' });
    await agent.update(loose, { title: 'loose end' });
    await agent.update(filed, { title: 'in the folder' });
    await agent.createFolder({ conversationIds: [filed], name: 'Research', color: 'research' });
    return { loose, filed };
  });
  await page.locator(`#list .conv[data-id="${ids.loose}"]`).click();
  await page.locator('.pane > .dock-bar').waitFor();
  // A chat with no group has no tick in its bar; the bar itself is the way in.
  assert.equal(await page.locator('.pane > .dock-bar .dock-folder:not([hidden])').count(), 0);
  await page.locator('.pane > .dock-bar').click({ button: 'right', position: { x: 120, y: 12 } });
  await page.locator('.rail-menu').waitFor();
  assert.equal((await page.locator('.rail-menu-head').first().textContent()).trim(), 'loose end');
  await page.locator('.rail-menu button', { hasText: 'Research' }).click();
  await page.waitForFunction(
    (id) => document.querySelector('.pane > .dock-bar')?.dataset.id === id
      && document.querySelector('.pane > .dock-bar')?.dataset.color === 'research',
    ids.loose,
  );
  const home = await page.evaluate(async (id) => (await window.marble.agent.conversation(id)).meta.folderId, ids.loose);
  const listed = await page.evaluate(() => window.marble.agent.folders());
  assert.equal(home, listed.folders[0].id);
  // And back out again, from the same menu.
  await page.locator('.pane > .dock-bar').click({ button: 'right', position: { x: 120, y: 12 } });
  await page.locator('.rail-menu button', { hasText: 'Take out of folder' }).click();
  await page.waitForFunction(
    () => !document.querySelector('.pane > .dock-bar')?.dataset.color,
  );
});

test('the pane menu opens from the mast, and never over the transcript', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.update(id, { title: 'read me' });
  });
  await page.locator('#list .conv').first().click();
  const convo = page.locator('.pane > marble-conversation');
  await convo.locator('.mast').waitFor();
  await convo.locator('.tags').click({ button: 'right' });
  await page.locator('.rail-menu').waitFor();
  assert.equal((await page.locator('.rail-menu-head').first().textContent()).trim(), 'read me');
  // Nothing on this menu opens the chat: it is already in front of you.
  assert.equal(await page.locator('.rail-menu button', { hasText: /^Open/ }).count(), 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('.rail-menu').length === 0);
  // Over words you might want to copy, the browser keeps its own menu.
  await convo.locator('.log').click({ button: 'right' });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.rail-menu').count(), 0);
});
