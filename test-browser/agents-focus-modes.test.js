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
  // A turn that starts and finishes, which is a chat that goes from live to
  // done with nobody stopping it.
  answer: [{ say: 'Just an answer.' }],
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

/** The ids of the cards standing in one column, top to bottom. A column is
 *  found by its basin: a card belongs to it when its middle is over it.
 *  `folderId` of null reads the whole canvas. */
const columnOrder = (page, folderId = null) => page.evaluate((fid) => {
  const basin = fid ? document.querySelector(`.focus-basin[data-folder-id="${fid}"]`) : null;
  const box = basin?.getBoundingClientRect() ?? null;
  return [...document.querySelectorAll('.focus-card')]
    .map((el) => ({ id: el.dataset.id, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => {
      if (!box) return true;
      const mid = rect.left + rect.width / 2;
      return mid >= box.left && mid <= box.right;
    })
    .sort((a, b) => a.rect.top - b.rect.top)
    .map(({ id }) => id);
}, folderId);

/** Timestamps are milliseconds; two writes in the same one are a tie — and
 *  filing a folder writes every member at once, so an order that is meant to
 *  be read has to be written on purpose, with a gap. */
const tick = (page) => page.waitForTimeout(25);
const answer = (page, id) => page.evaluate(async (row) => {
  await window.marble.agent.send(row, { prompt: 'script:answer', target: 'garden', viewing: 'Agents', selection: [] });
}, id);

const finished = async (page, id) => {
  const meta = await metaOf(page, id);
  return Boolean(meta && !meta.running && meta.lastFinishedAt);
};

const touch = async (page, id, title) => {
  await page.evaluate(([row, name]) => window.marble.agent.update(row, { title: name }), [id, title]);
  await tick(page);
};

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
  assert.ok(await pill.isVisible(), 'the mode pill is in the top bar');
  assert.equal(await pill.locator('button[data-mode="pinned"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await pill.locator('button[data-mode="active"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await pill.locator('button[data-mode="group"]').textContent(), 'Group');
  assert.deepEqual(await stageIds(page), [a]);
});

test('the pill lives in the top bar beside the view switch, and only in Focus', async () => {
  const { page } = await openAgents();
  await seedPinned(page);
  const placed = await page.evaluate(() => {
    const pill = document.querySelector('.focus-modes');
    return {
      inToggles: Boolean(pill?.closest('.topbar .toggles')),
      onCanvas: Boolean(pill?.closest('.focus')),
      afterViews: pill?.previousElementSibling?.classList.contains('views') ?? false,
      segmented: pill?.classList.contains('seg') ?? false,
    };
  });
  assert.deepEqual(placed, { inToggles: true, onCanvas: false, afterViews: true, segmented: true });
  // Nothing of it is left over the canvas: Focus gets its whole corner back.
  const corner = await page.evaluate(() => {
    const canvas = document.querySelector('.focus').getBoundingClientRect();
    return document.elementFromPoint(canvas.right - 20, canvas.top + 20)?.closest('.focus-modes') === null;
  });
  assert.ok(corner, "the canvas's top-right corner is free");

  await page.locator('.views [data-view="board"]').click();
  await until(page, async () => !(await page.locator('.focus-modes').isVisible()), 'the pill to leave with Focus');
  await page.locator('.views [data-view="focus"]').click();
  await until(page, async () => page.locator('.focus-modes').isVisible(), 'the pill to come back with Focus');
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

test('Active with nothing active stages nothing and lights every card', async () => {
  const { page } = await openAgents();
  const { a, b, c } = await seedPinned(page);
  // The last title write makes b the most recently updated chat.
  await page.evaluate((id) => window.marble.agent.update(id, { title: 'freshest' }), b);
  await page.locator('.focus-modes button[data-mode="active"]').click();
  await until(page, async () => (await modeOf(page)).mode === 'active', 'the canvas to enter active mode');
  await until(page, async () => (await stageIds(page)).length === 0, 'the stage to hold nothing');
  // Nothing is staged, so nothing is off the stage: no card is dimmed and the
  // canvas says so.
  assert.equal(await page.evaluate(() => document.querySelector('.focus').dataset.staged), 'false');
  assert.deepEqual(await chipIds(page), [], 'no card is demoted to a chip');
  const lit = await page.evaluate(() => (
    [...document.querySelectorAll('.focus-card')].every((el) => Number(getComputedStyle(el).opacity) > 0.9)
  ));
  assert.ok(lit, 'every card is lit');
  // And what is left reads newest first, whatever order it was made in.
  await touch(page, c, 'touched third');
  await touch(page, a, 'touched second');
  await touch(page, b, 'touched first');
  await until(page, async () => (await columnOrder(page))[0] === b, 'the last-changed chat to rise');
  assert.deepEqual(await columnOrder(page), [b, a, c]);
});

test('Active ranks every column by recency, newest at the top', async () => {
  const { page } = await openAgents();
  const seeded = await page.evaluate(async () => {
    const ids = [];
    for (let i = 0; i < 3; i += 1) ids.push(await window.marble.agent.start({ provider: 'fake' }));
    for (let i = 0; i < ids.length; i += 1) await window.marble.agent.update(ids[i], { title: `member ${i + 1}` });
    const folder = await window.marble.agent.createFolder({ conversationIds: ids, name: 'Alpha', color: 'research' });
    return { ids, folderId: folder.id ?? folder.folder?.id };
  });
  const [m1, m2, m3] = seeded.ids;
  await enterFocus(page);
  await page.locator('.focus-modes button[data-mode="active"]').click();
  await until(page, async () => (await modeOf(page)).mode === 'active', 'active mode');
  await page.locator(`.focus-basin[data-folder-id="${seeded.folderId}"]`).waitFor();
  await until(page, async () => sameSet(await columnOrder(page, seeded.folderId), [m1, m2, m3]), 'the group to hold its three');
  // Written oldest to newest, so the column reads m1 at the top.
  await touch(page, m3, 'finished third');
  await touch(page, m2, 'finished second');
  await touch(page, m1, 'finished first');
  await until(page, async () => (await columnOrder(page, seeded.folderId))[0] === m1, 'the newest member to lead');
  assert.deepEqual(await columnOrder(page, seeded.folderId), [m1, m2, m3]);

  // The one that changes next rises to the top of its group, without anybody
  // dragging it there.
  await touch(page, m3, 'just finished');
  await until(page, async () => (await columnOrder(page, seeded.folderId))[0] === m3, 'the newest member to rise');
  assert.deepEqual(await columnOrder(page, seeded.folderId), [m3, m1, m2]);
});

test('Active holds a chat you are reading, and relegates it only when new work arrives', async () => {
  const { page } = await openAgents();
  const seeded = await page.evaluate(async () => {
    const a = await window.marble.agent.start({ provider: 'fake' });
    const b = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(a, { title: 'first job' });
    await window.marble.agent.update(b, { title: 'second job' });
    return { a, b };
  });
  const { a, b } = seeded;
  await enterFocus(page);
  await page.locator('.focus-modes button[data-mode="active"]').click();
  await until(page, async () => (await modeOf(page)).mode === 'active', 'active mode');
  await until(page, async () => (await stageIds(page)).length === 0, 'an empty stage to start');

  // One chat runs and finishes. Reading it clears Needs review, so it stops
  // being active — and used to fall off the stage under the pointer.
  await answer(page, a);
  await until(page, async () => sameSet(await stageIds(page), [a]), 'the running chat to take the stage');
  await until(page, async () => finished(page, a), 'the turn to finish');
  await page.locator(`.dock-bar[data-id="${a}"]`).click({ position: { x: 10, y: 10 } });
  await until(page, async () => (await metaOf(page, a))?.needsReview === false, 'reading it to clear Needs review');
  // Two quiet repaints later it is still there: attention never relegates.
  await page.waitForTimeout(1400);
  assert.deepEqual(await stageIds(page), [a], 'the chat you are reading stays on the stage');

  // New work arriving is the one thing that does.
  await answer(page, b);
  await until(page, async () => sameSet(await stageIds(page), [b]), 'the new chat to take the stage alone');
  await until(page, async () => (await chipIds(page)).includes(a), 'the finished chat to step off into the field');
});

test('a Group stages every one of its members, live first, and the basin toggles it', async () => {
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
  // Every member, not the first four: the stage has no ceiling, so a lens
  // stages the whole group and the canvas compacts the rest to make room.
  await until(page, async () => sameSet(await stageIds(page), [m1, m2, m3, m4, m5]), 'every member to hold the stage');
  assert.deepEqual(await chipIds(page), [seeded.loose], 'only the loose chat is left in the field');
  const groupBtn = page.locator('.focus-modes button[data-mode="group"]');
  assert.equal(await groupBtn.textContent(), 'Alpha');
  assert.equal(await groupBtn.getAttribute('data-color'), 'research');
  assert.equal(await groupBtn.getAttribute('aria-pressed'), 'true');

  // Staging the whole group empties its column, so the basin folds to a pile
  // — but it keeps its place in the row, because Unfocus lives on it.
  const basin = page.locator(`.focus-basin[data-folder-id="${seeded.folderId}"]`);
  // `data-pile` names which of the rail's three forms it took.
  assert.ok(['row', 'tab', 'dot'].includes(await basin.getAttribute('data-pile')), 'an emptied group is a pile');

  // The basin's own button reads Unfocus while its group is the lens, and
  // returns to pinned.
  const basinBtn = page.locator(`.focus-basin[data-folder-id="${seeded.folderId}"] .focus-basin-focus`);
  assert.equal(await basinBtn.textContent(), 'Unfocus');
  await basinBtn.click();
  await until(page, async () => (await modeOf(page)).mode === 'pinned', 'the basin button to return to pinned');
  await until(page, async () => sameSet(await stageIds(page), [seeded.loose]), 'the pinned stage to come back');
  assert.equal(await basinBtn.textContent(), 'Focus');
  // A lens writes nothing: no member came back pinned, and the real pin is
  // untouched. Asked here, with one pane open, rather than under the lens —
  // every open conversation holds an EventSource and the browser has six
  // sockets, so a fetch behind five panes never returns.
  assert.equal((await metaOf(page, m1))?.pinned ?? false, false, 'no member was pinned by the mode');
  assert.equal((await metaOf(page, seeded.loose))?.pinned, true, 'the pinned chat stays pinned');
  // And Focus enters the group again.
  await basinBtn.click();
  await until(page, async () => (await modeOf(page)).folder === seeded.folderId, 'the basin button to enter the group');
  await until(page, async () => sameSet(await stageIds(page), [m1, m2, m3, m4, m5]), 'the group to hold the stage again');
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
