/** Focus modes: which set holds the stage. Pinned is the person's own set;
 *  Active and Group are lenses over the same chats that write nothing to the
 *  store, so leaving one restores the pinned stage exactly.
 *
 *  Its own file, with its own copies of the helpers, for the reason
 *  agents-focus-groups.test.js gives: agents-focus.test.js is rewritten
 *  wholesale by other conversations and a test appended there gets dropped.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  // A chat that asks and then waits on the person: running and asking for as
  // long as nobody answers.
  permission: [{ ask: { tool: 'Bash', input: { command: 'ls' } } }, { say: 'after' }],
};

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
    try { localStorage.removeItem('marble-agents:focus-mode'); } catch { /* private */ }
  });
  return { page, errors };
};

const until = async (page, check, what) => {
  for (let i = 0; i < 80; i += 1) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const metaOf = async (page, id) => (
  await page.evaluate((row) => window.marble.agent.conversation(row), id)
)?.meta ?? null;

const stageIds = (page) => page.evaluate(() => (
  [...document.querySelectorAll('.focus-card[data-lod="full"]')].map((el) => el.dataset.id).sort()
));
const chipIds = (page) => page.evaluate(() => (
  [...document.querySelectorAll('.focus-card[data-lod="chip"]')].map((el) => el.dataset.id).sort()
));
const modeOf = (page) => page.evaluate(() => ({
  mode: document.querySelector('.focus')?.dataset.mode ?? null,
  folder: document.querySelector('.focus')?.dataset.modeFolder ?? null,
  stored: (() => { try { return localStorage.getItem('marble-agents:focus-mode'); } catch { return null; } })(),
}));
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const enterFocus = async (page) => {
  await page.locator('.views [data-view="focus"]').click();
  await page.locator('.focus-modes').waitFor();
};

/** Three chats: a pinned, b and c loose; Focus open on the pinned stage. */
const seedPinned = async (page) => {
  const seeded = await page.evaluate(async () => {
    const a = await window.marble.agent.start({ provider: 'fake' });
    const b = await window.marble.agent.start({ provider: 'fake' });
    const c = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(a, { title: 'pinned one', pinned: true });
    await window.marble.agent.update(b, { title: 'loose two' });
    await window.marble.agent.update(c, { title: 'loose three' });
    return { a, b, c };
  });
  await enterFocus(page);
  await until(page, async () => sameSet(await stageIds(page), [seeded.a]), 'the pinned chat to hold the stage');
  return seeded;
};

test('the default mode is pinned and the pill shows it', async () => {
  const { page } = await openAgents();
  const { a } = await seedPinned(page);
  assert.deepEqual(await modeOf(page), { mode: 'pinned', folder: null, stored: null });
  const pill = page.locator('.focus-modes');
  assert.ok(await pill.isVisible(), 'the mode pill is on the canvas');
  assert.equal(await pill.locator('button[data-mode="pinned"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await pill.locator('button[data-mode="active"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await pill.locator('button[data-mode="group"]').textContent(), 'Group');
  assert.deepEqual(await stageIds(page), [a]);
});

test('Active stages what is running or asking, dims the rest, and pins nothing', async () => {
  const { page } = await openAgents();
  const { a, b, c } = await seedPinned(page);
  await page.evaluate(async (id) => {
    await window.marble.agent.send(id, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] });
  }, c);
  await until(page, async () => (await metaOf(page, c))?.asking === true, 'the third chat to be asking');

  await page.locator('.focus-modes button[data-mode="active"]').click();
  await until(page, async () => (await modeOf(page)).mode === 'active', 'the canvas to enter active mode');
  await until(page, async () => sameSet(await stageIds(page), [c]), 'the asking chat to hold the stage');
  assert.equal(await page.locator('.focus-modes button[data-mode="active"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.focus-modes button[data-mode="pinned"]').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await chipIds(page), [a, b].sort(), 'every card off the stage is a chip');
  await until(page, async () => {
    const opacities = await page.evaluate(() => (
      [...document.querySelectorAll('.focus-card[data-lod="chip"]')].map((el) => Number(getComputedStyle(el).opacity))
    ));
    return opacities.length === 2 && opacities.every((o) => Math.abs(o - 0.55) < 0.02);
  }, 'the chips to dim to .55');
  assert.equal((await metaOf(page, a))?.pinned, true, 'the pinned chat stays pinned in the store');
  assert.equal((await metaOf(page, c))?.pinned ?? false, false, 'the staged chat was not pinned by the mode');
  assert.equal((await modeOf(page)).stored, 'active');
});

test('Active with nothing active stages the most recent chat', async () => {
  const { page } = await openAgents();
  const { a, b, c } = await seedPinned(page);
  // The last title write makes b the most recently updated chat.
  await page.evaluate((id) => window.marble.agent.update(id, { title: 'freshest' }), b);
  await page.locator('.focus-modes button[data-mode="active"]').click();
  await until(page, async () => sameSet(await stageIds(page), [b]), 'the most recent chat to hold the stage alone');
  assert.deepEqual(await chipIds(page), [a, c].sort());
});

test('a Group stages up to four of its members, live first, and the basin toggles it', async () => {
  const { page } = await openAgents();
  const seeded = await page.evaluate(async () => {
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push(await window.marble.agent.start({ provider: 'fake' }));
    const loose = await window.marble.agent.start({ provider: 'fake' });
    for (let i = 0; i < ids.length; i += 1) await window.marble.agent.update(ids[i], { title: `member ${i + 1}` });
    await window.marble.agent.update(loose, { title: 'loose', pinned: true });
    const folder = await window.marble.agent.createFolder({ conversationIds: ids, name: 'Alpha', color: 'research' });
    return { ids, loose, folderId: folder.id ?? folder.folder?.id };
  });
  assert.ok(seeded.folderId, 'the folder API returned an id');
  const [m1, m2, m3, m4, m5] = seeded.ids;
  // The first member asks: live, so it leads the stage whatever its recency.
  await page.evaluate(async (id) => {
    await window.marble.agent.send(id, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] });
  }, m1);
  await until(page, async () => (await metaOf(page, m1))?.asking === true, 'the first member to be asking');
  await enterFocus(page);
  await until(page, async () => sameSet(await stageIds(page), [seeded.loose]), 'the pinned chat to hold the stage');
  await page.locator(`.focus-basin[data-folder-id="${seeded.folderId}"]`).waitFor();

  await page.locator('.focus-modes button[data-mode="group"]').click();
  await page.locator(`.focus-modes-menu button[data-folder-id="${seeded.folderId}"]`).click();
  await until(page, async () => (await modeOf(page)).mode === 'group', 'the canvas to enter group mode');
  assert.equal((await modeOf(page)).folder, seeded.folderId);
  // The asking member plus the three most recently updated others: m2 is the
  // least recent of the rest and is the one left off.
  await until(page, async () => sameSet(await stageIds(page), [m1, m3, m4, m5]), 'four members to hold the stage');
  assert.deepEqual(await chipIds(page), [m2, seeded.loose].sort(), 'the fifth member and the loose chat are chips');
  const groupBtn = page.locator('.focus-modes button[data-mode="group"]');
  assert.equal(await groupBtn.textContent(), 'Alpha');
  assert.equal(await groupBtn.getAttribute('data-color'), 'research');
  assert.equal(await groupBtn.getAttribute('aria-pressed'), 'true');
  assert.equal((await metaOf(page, m1))?.pinned ?? false, false, 'no member was pinned by the mode');
  assert.equal((await metaOf(page, seeded.loose))?.pinned, true, 'the pinned chat stays pinned');

  // The basin's own button reads Unfocus while its group is the lens, and
  // returns to pinned.
  const basinBtn = page.locator(`.focus-basin[data-folder-id="${seeded.folderId}"] .focus-basin-focus`);
  assert.equal(await basinBtn.textContent(), 'Unfocus');
  await basinBtn.click();
  await until(page, async () => (await modeOf(page)).mode === 'pinned', 'the basin button to return to pinned');
  await until(page, async () => sameSet(await stageIds(page), [seeded.loose]), 'the pinned stage to come back');
  assert.equal(await basinBtn.textContent(), 'Focus');
  // And Focus enters the group again.
  await basinBtn.click();
  await until(page, async () => (await modeOf(page)).folder === seeded.folderId, 'the basin button to enter the group');
  await until(page, async () => sameSet(await stageIds(page), [m1, m3, m4, m5]), 'the group to hold the stage again');
  // The Ungrouped basin has no such button.
  assert.equal(await page.locator('.focus-basin[data-folder-id="ungrouped"] .focus-basin-focus').isVisible(), false);
});

test('Pinned restores the pinned stage, and a pin while in a mode returns to it', async () => {
  const { page } = await openAgents();
  const { a, b, c } = await seedPinned(page);
  await page.locator('.focus-modes button[data-mode="active"]').click();
  await until(page, async () => (await modeOf(page)).mode === 'active', 'active mode');
  await until(page, async () => !(await stageIds(page)).includes(a), 'the pinned chat to leave the stage');

  await page.locator('.focus-modes button[data-mode="pinned"]').click();
  await until(page, async () => (await modeOf(page)).mode === 'pinned', 'pinned mode');
  await until(page, async () => sameSet(await stageIds(page), [a]), 'the pinned stage to come back');
  assert.equal((await modeOf(page)).stored, null);
  assert.equal((await metaOf(page, a))?.pinned, true);

  // A pin taken while a lens is on: the lens yields and the pin applies.
  await page.locator('.focus-modes button[data-mode="active"]').click();
  await until(page, async () => (await modeOf(page)).mode === 'active', 'active mode again');
  await page.locator(`.focus-card[data-id="${b}"]`).dblclick();
  await until(page, async () => (await modeOf(page)).mode === 'pinned', 'the double-click to return to pinned');
  await until(page, async () => sameSet(await stageIds(page), [b]), 'the double-clicked chat to be the stage');
  assert.equal((await metaOf(page, b))?.pinned, true);
  assert.equal((await metaOf(page, a))?.pinned, false);
  assert.equal((await metaOf(page, c))?.pinned ?? false, false);
});

test('the mode survives a reload', async () => {
  const { page } = await openAgents();
  const seeded = await page.evaluate(async () => {
    const a = await window.marble.agent.start({ provider: 'fake' });
    const b = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(a, { title: 'in group' });
    await window.marble.agent.update(b, { title: 'pinned', pinned: true });
    const folder = await window.marble.agent.createFolder({ conversationIds: [a], name: 'Beta', color: 'gold' });
    return { a, b, folderId: folder.id ?? folder.folder?.id };
  });
  await enterFocus(page);
  await until(page, async () => sameSet(await stageIds(page), [seeded.b]), 'the pinned stage');
  await page.locator('.focus-modes button[data-mode="group"]').click();
  await page.locator(`.focus-modes-menu button[data-folder-id="${seeded.folderId}"]`).click();
  await until(page, async () => sameSet(await stageIds(page), [seeded.a]), 'the group member to hold the stage');
  assert.equal((await modeOf(page)).stored, `group:${seeded.folderId}`);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  if (await page.evaluate(() => document.body.getAttribute('data-view')) !== 'focus') {
    await page.locator('.views [data-view="focus"]').click();
  }
  await page.locator('.focus-modes').waitFor();
  await until(page, async () => (await modeOf(page)).folder === seeded.folderId, 'the group mode to come back');
  await until(page, async () => sameSet(await stageIds(page), [seeded.a]), 'the group member to hold the stage after reload');
  assert.equal(await page.locator('.focus-modes button[data-mode="group"]').textContent(), 'Beta');
  assert.equal(await page.locator('.focus-modes button[data-mode="group"]').getAttribute('data-color'), 'gold');
});
