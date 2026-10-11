/** Focus with no ceiling on the stage, and the field that folds to pay for it.
 *
 *  The cap of four is gone: what is on the stage is what you put there. The
 *  canvas buys the width back by compacting — cards to chips, then whole
 *  groups to piles — and it never, ever scrolls sideways.
 *
 *  Its own file, for the reason agents-focus-groups.test.js gives: the older
 *  focus test files are rewritten wholesale by other conversations and a test
 *  appended there gets dropped without anything failing.
 */
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

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(async () => {
  await openPage?.close().catch(() => {});
  await host.close();
});

// Ten pinned chats is ten live panes streaming at once. Left open, three
// tests' worth of them share one machine and the suite crawls, so each test
// hands its page back before the next one asks for one.
let openPage = null;

const openAgents = async (options = {}) => {
  if (openPage) {
    await openPage.close().catch(() => {});
    openPage = null;
  }
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: { width: 1440, height: 900 }, ...options });
  openPage = page;
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      for (const row of await window.marble.agent.conversations()) await window.marble.agent.archive(row.id, true);
    } catch { /* fresh agent */ }
    try { localStorage.removeItem('marble-agents:focus-mode'); } catch { /* private */ }
  });
  return { page, errors };
};

const until = async (page, check, what) => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const stageIds = (page) => page.evaluate(() => (
  [...document.querySelectorAll('.focus-card[data-lod="full"]')].map((el) => el.dataset.id).sort()
));
const pileNames = (page) => page.evaluate(() => (
  [...document.querySelectorAll('.focus-basin[data-pile]')].map((el) => el.querySelector('.focus-basin-name').textContent)
));
const openNames = (page) => page.evaluate(() => (
  [...document.querySelectorAll('.focus-basin:not([data-pile])')].map((el) => el.querySelector('.focus-basin-name').textContent)
));
const scrolls = (page) => page.evaluate(() => {
  const el = document.querySelector('.focus');
  return el.scrollWidth > el.clientWidth + 1;
});

const enterFocus = async (page) => {
  await page.locator('.views [data-view="focus"]').click();
  await page.locator('.focus-modes').waitFor();
};

/** `pins` pinned chats, a Research folder of 4, a Marble folder of 3, and six
 *  loose ones — enough field that the stage has to take it from somewhere. */
const seed = async (page, pins, loose = 6) => {
  const seeded = await page.evaluate(async ({ count, looseCount }) => {
    const mk = async (title) => {
      const id = await window.marble.agent.start({ provider: 'fake' });
      await window.marble.agent.update(id, { title });
      return id;
    };
    const pinned = [];
    for (let i = 0; i < count; i += 1) pinned.push(await mk(`focused ${i + 1}`));
    for (const id of pinned) await window.marble.agent.update(id, { pinned: true });
    const alpha = [];
    for (let i = 0; i < 4; i += 1) alpha.push(await mk(`alpha ${i + 1}`));
    await window.marble.agent.createFolder({ conversationIds: alpha, name: 'Research', color: 'research' });
    const beta = [];
    for (let i = 0; i < 3; i += 1) beta.push(await mk(`beta ${i + 1}`));
    await window.marble.agent.createFolder({ conversationIds: beta, name: 'Marble', color: 'marble' });
    const loose = [];
    for (let i = 0; i < looseCount; i += 1) loose.push(await mk(`loose ${i + 1}`));
    return { pinned, alpha, beta, loose };
  }, { count: pins, looseCount: loose });
  await enterFocus(page);
  return seeded;
};

test('ten pins all hold the stage — there is no cap of four', async () => {
  const { page } = await openAgents();
  const { pinned } = await seed(page, 10);
  await until(page, async () => (await stageIds(page)).length === 10, 'all ten pins to hold the stage');
  assert.deepEqual(await stageIds(page), [...pinned].sort());
  const panes = await page.evaluate(() => document.querySelectorAll('.dock-frame').length);
  assert.equal(panes, 10, 'and each one is a pane');
  // Every pin is still pinned: nothing was quietly retired to make room. The
  // stage under the pinned lens *is* the pinned set, so the ten Full cards
  // above are the assertion — asking the store instead would mean ten fetches
  // behind ten open event streams, and the browser only has six sockets.
});

test('the stage grows downward once it is as wide as the canvas allows', async () => {
  const { page } = await openAgents();
  await seed(page, 10);
  await until(page, async () => (await stageIds(page)).length === 10, 'ten pins');
  const rows = await page.evaluate(() => {
    const tops = [...document.querySelectorAll('.dock-frame')].map((el) => Math.round(el.getBoundingClientRect().top));
    return [...new Set(tops)].length;
  });
  assert.ok(rows > 1, 'ten panes in one row would be unreadable, so the stage stacked');
  const widths = await page.evaluate(() => (
    [...document.querySelectorAll('.dock-frame')].map((el) => el.getBoundingClientRect().width)
  ));
  for (const w of widths) assert.ok(w > 240, `a pane came out at ${Math.round(w)}px`);
});

test('the canvas never scrolls sideways, however much is focused', async () => {
  const { page } = await openAgents();
  await seed(page, 10);
  await until(page, async () => (await stageIds(page)).length === 10, 'ten pins');
  assert.equal(await scrolls(page), false, 'ten pins and three groups still fit one screen');
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector('.focus')).overflowX),
    'hidden',
    'and sideways is not even offered',
  );
});

test('groups fold into piles when the stage wants their width, Ungrouped first', async () => {
  const { page } = await openAgents();
  await seed(page, 2);
  await until(page, async () => (await stageIds(page)).length === 2, 'two pins');
  // Two pins leave room for the whole field.
  assert.deepEqual(await pileNames(page), [], 'nothing folds while there is room');
  assert.deepEqual(await openNames(page), ['Research', 'Marble', 'Ungrouped']);

  // Pin everything else that is loose: the field has to give.
  await page.evaluate(async () => {
    for (const row of await window.marble.agent.conversations()) {
      if ((row.title ?? '').startsWith('loose')) await window.marble.agent.update(row.id, { pinned: true });
    }
  });
  await until(page, async () => (await pileNames(page)).length > 0, 'the field to start folding');
  const piles = await pileNames(page);
  assert.ok(piles.includes('Ungrouped') || !(await openNames(page)).includes('Ungrouped'),
    'the junk drawer folds before any real folder');
  assert.equal(await scrolls(page), false);
  // A pile says how many chats went into it.
  const counts = await page.evaluate(() => (
    [...document.querySelectorAll('.focus-basin[data-pile]')].map((el) => el.querySelector('.focus-basin-count').textContent)
  ));
  for (const count of counts) assert.ok(Number(count) > 0, `a pile with no count: ${count}`);
});

test('a folded group is a tab in a rail — a finger wide and full height', async () => {
  const { page } = await openAgents();
  // The shape of the complaint: a big Ungrouped that has to fold, beside a
  // small folder that does not. Five pins is enough pressure for the first
  // and not enough for the second.
  await seed(page, 5, 23);
  await until(page, async () => (await pileNames(page)).length > 0, 'something to fold');
  await until(page, async () => (await openNames(page)).length > 0, 'a group to stay open');
  await page.waitForTimeout(600);
  const shape = await page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const canvas = document.querySelector('.focus');
    return {
      piles: [...document.querySelectorAll('.focus-basin[data-pile]')].map(box),
      open: [...document.querySelectorAll('.focus-basin:not([data-pile])')].map(box),
      canvasH: canvas.clientHeight,
      paneX: Math.round(document.querySelector('.pane').getBoundingClientRect().x),
      writing: getComputedStyle(document.querySelector('.focus-basin[data-pile] .focus-basin-name')).writingMode,
    };
  });
  assert.ok(shape.open.length, 'a group is still open');
  assert.equal(shape.piles.length, 1);
  const [tab] = shape.piles;
  // A tab, not a box: narrow enough that it costs the stage nothing, and tall
  // enough that there is no white space under it.
  assert.ok(tab.w <= 40, `a tab should be a finger wide, got ${tab.w}`);
  assert.ok(tab.h > shape.canvasH * 0.9, `a tab should fill the rail, got ${tab.h} of ${shape.canvasH}`);
  // Which is only possible because the name turned a quarter turn.
  assert.ok(shape.writing.startsWith('vertical') || shape.writing.startsWith('sideways'),
    `the name has to run sideways, got ${shape.writing}`);
  // The rail stands at the low end of the row, left of everything else.
  for (const region of shape.open) assert.ok(tab.x + tab.w <= region.x + 1, 'the rail is left of the field');
  assert.ok(tab.x + tab.w <= shape.paneX, 'and left of the stage');
  assert.equal(await scrolls(page), false);
});

test('opening a collapsed group lists it in the rail, and costs only the rail', async () => {
  // Narrow enough that the field has to give something up, wide enough that
  // it does not have to give up everything.
  const { page } = await openAgents({ viewport: { width: 1150, height: 900 } });
  await seed(page, 8, 8);
  await until(page, async () => (await pileNames(page)).length >= 1, 'the field to fold');
  await page.waitForTimeout(500);
  const shut = await page.evaluate(() => ({
    railW: Math.round(document.querySelector('.focus-basin[data-pile]').getBoundingClientRect().width),
    paneX: Math.round(document.querySelector('.pane').getBoundingClientRect().x),
  }));

  await page.locator('.focus-basin[data-pile="tab"][data-folder-id="ungrouped"] .focus-basin-name').click();
  await until(page, async () => (
    await page.evaluate(() => Boolean(document.querySelector('.focus-basin[data-opened]')))
  ), 'the entry to unroll');
  await page.waitForTimeout(700);

  const open = await page.evaluate(() => {
    const entry = document.querySelector('.focus-basin[data-opened]');
    const box = entry.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.focus-card:not([data-piled])')]
      .filter((el) => el.dataset.lod === 'chip')
      .map((el) => el.getBoundingClientRect());
    return {
      name: entry.querySelector('.focus-basin-name').textContent,
      x: Math.round(box.x), w: Math.round(box.width), y: Math.round(box.y), h: Math.round(box.height),
      rows: rows.map((r) => ({ x: Math.round(r.x), w: Math.round(r.width) })),
      // Everything else in the rail is a menu row now, not a rotated tab.
      forms: [...document.querySelectorAll('.focus-basin[data-pile]')].map((el) => el.dataset.pile),
      paneX: Math.round(document.querySelector('.pane').getBoundingClientRect().x),
      canvasH: document.querySelector('.focus').clientHeight,
    };
  });
  assert.equal(open.name, 'Ungrouped');
  assert.ok(open.rows.length > 0, 'the entry lists its chats');
  for (const row of open.rows) {
    assert.ok(row.x >= open.x - 1 && row.x + row.w <= open.x + open.w + 1, 'a row escaped the rail');
  }
  // It is a peek, not a promotion: as tall as what it shows, never the whole
  // canvas, and everything else in the rail became a plain menu row.
  assert.ok(open.h < open.canvasH * 0.95, `an opened entry should not fill the canvas, got ${open.h}`);
  assert.ok(open.forms.every((form) => form === 'row'), `expected menu rows, got ${open.forms.join(',')}`);
  // And the stage paid exactly the rail's widening for it.
  const cost = open.paneX - shut.paneX;
  assert.ok(cost > 0, 'the rail did widen');
  assert.ok(cost <= 200, `opening should cost about one column floor, cost ${cost}`);
  assert.equal(await scrolls(page), false);
});

test('too many groups to be tabs and each becomes a square with its count', async () => {
  // Seventeen groups is more than a canvas this tall can give a readable run
  // of height to, so the rail drops to its smallest form.
  const { page } = await openAgents({ viewport: { width: 1100, height: 900 } });
  await page.evaluate(async () => {
    const mk = async (t) => { const id = await window.marble.agent.start({ provider: 'fake' }); await window.marble.agent.update(id, { title: t }); return id; };
    const pinned = [];
    for (let i = 0; i < 8; i += 1) pinned.push(await mk(`focused ${i + 1}`));
    for (const id of pinned) await window.marble.agent.update(id, { pinned: true });
    for (let g = 0; g < 16; g += 1) {
      const ids = [];
      for (let i = 0; i < (g % 4) + 2; i += 1) ids.push(await mk(`g${g} ${i}`));
      await window.marble.agent.createFolder({ conversationIds: ids, name: `Folder ${g + 1}`, color: 'research' });
    }
  });
  await enterFocus(page);
  await until(page, async () => (
    await page.evaluate(() => document.querySelectorAll('.focus-basin[data-pile="dot"]').length >= 10)
  ), 'the rail to drop to squares');
  await page.waitForTimeout(600);
  const squares = await page.evaluate(() => (
    [...document.querySelectorAll('.focus-basin[data-pile="dot"]')].map((el) => {
      const r = el.getBoundingClientRect();
      const count = el.querySelector('.focus-basin-count');
      return {
        w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x),
        count: count.textContent,
        // The count has to be inside the square, not clipped out of it.
        inside: (() => { const c = count.getBoundingClientRect(); return c.top >= r.top - 1 && c.bottom <= r.bottom + 1; })(),
        shown: getComputedStyle(count).display !== 'none',
      };
    })
  ));
  assert.ok(squares.length >= 10);
  for (const square of squares) {
    assert.ok(square.w <= 30 && square.h <= 30, `a square should be small, got ${square.w}x${square.h}`);
    assert.ok(Number(square.count) > 0, `a square carries its count, got "${square.count}"`);
    assert.ok(square.shown, 'and shows it');
    assert.ok(square.inside, 'inside the square, not clipped out of it');
  }
  // Which is cheaper than any of the bigger forms.
  const paneX = await page.evaluate(() => Math.round(document.querySelector('.pane').getBoundingClientRect().x));
  assert.ok(paneX < 60, `sixteen groups should cost almost nothing, panes start at ${paneX}`);
  assert.equal(await scrolls(page), false);
});

test('clicking a pile opens it, and something staler folds in its place', async () => {
  const { page } = await openAgents();
  await seed(page, 10);
  await until(page, async () => (await pileNames(page)).length === 3, 'every group to fold');

  await page.locator('.focus-basin[data-pile][data-folder-id="ungrouped"] .focus-basin-name').click();
  await until(page, async () => (await openNames(page)).includes('Ungrouped'), 'the pile to open');
  // At rest — a card springing out of a pile passes through wherever it was,
  // and `overflow-x: hidden` means that is clipped rather than scrolled.
  await page.waitForTimeout(900);
  assert.equal(await scrolls(page), false, 'opening a pile does not leave the row overflowing');
  // Something had to go: the canvas did not grow.
  assert.ok((await pileNames(page)).length >= 1, 'a staler group folded to pay for it');
  // And it stays open across a repaint: held open is held open, not a weight
  // that the next fold pass can outbid.
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(400);
  assert.ok((await openNames(page)).includes('Ungrouped'), 'still open after a relayout');
  // The chats it was holding have seats on the canvas again.
  const titles = () => page.evaluate(() => (
    [...document.querySelectorAll('.focus-card:not([data-piled])')].map((el) => el.querySelector('.title').textContent)
  ));
  assert.ok((await titles()).some((title) => title.startsWith('loose')), 'the loose chats are back');

  // Clicking its name folds it away again — the same target, both halves of
  // one toggle — and its chats give their seats up with it.
  await page.locator('.focus-basin:not([data-pile])[data-folder-id="ungrouped"] .focus-basin-name').click();
  await until(page, async () => (await pileNames(page)).includes('Ungrouped'), 'the group to fold back');
  assert.ok(!(await titles()).some((title) => title.startsWith('loose')), 'and the pile swallowed them again');
});
