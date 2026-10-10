// Agents held in a hand, against the phone standard every system app is held
// to (runtime/phone.js publishes the visible strip; the page has to use it):
// no zoom when a field takes the caret, a sheet that stands on the keyboard,
// one measurement of the screen rather than two, nothing past the right edge
// at 320, 44pt targets in the folder rail and the filter, a held finger for
// the rail's menu, and usage tips a tap can read. 393 × 852 unless it says.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive, usageHistoryStub } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };
const KB = 336;

const inView = async (page, view) => {
  await page.evaluate((v) => localStorage.setItem('marble-agents:view', v), view);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForTimeout(300);
};

const openAgents = async ({ viewport = PHONE, view = 'deck' } = {}) => {
  await host.reset();
  const { page } = await host.newPage({ viewport, hasTouch: true, isMobile: true });
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      const { folders } = await window.marble.agent.folders();
      for (const row of folders) await window.marble.agent.deleteFolder(row.id);
    } catch { /* fresh agent */ }
    try {
      for (const row of await window.marble.agent.conversations()) await window.marble.agent.archive(row.id, true);
    } catch { /* fresh agent */ }
    localStorage.clear();
  });
  await inView(page, view);
  return page;
};

/** Three chats on one file, the first with a title too long for a row. */
const seed = async (page) => {
  const ids = [];
  for (const [title, extra] of [
    ['Write the grant summary for the second year of the project', { needsReview: true }],
    ['Rebuild the site', { running: true, activity: 'busy' }],
    ['Idle one', {}],
  ]) {
    const id = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
    await host.drive.agents.store.updateConversation(id, { title, target: 'Marble/site.mrbl', ...extra });
    ids.push(id);
  }
  return ids;
};

/** What the browser does when the keyboard comes up: the visual viewport
 *  shrinks by the keys and, on iOS, slides down by `offsetTop`. */
const raiseKeyboard = async (page, kb = KB, offsetTop = 0) => {
  await page.evaluate(({ k, top }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - k - top, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: top, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  }, { k: kb, top: offsetTop });
  await page.waitForTimeout(150);
};

const fontSize = (page, selector) => page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize), selector);

/** Escape, then wait out the spring: the scrim stays until the sheet has gone. */
const closeSheet = async (page) => {
  // Escape belongs to a sheet only once it has arrived.
  await page.waitForFunction(() => document.body.hasAttribute('data-sheet'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.hasAttribute('data-sheet') && document.querySelector('.sheet-scrim')?.hidden !== false);
};

const openSheetFromMore = async (page, row) => {
  await page.locator('.topbar .more').click();
  await page.locator('.sheet[data-kind="more"]').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await page.locator('.sheet-row', { hasText: row }).click();
};

// ------------------------------------------------------------ no focus zoom

test('every field a phone can type in is at least 16px, so iOS never zooms on focus', async () => {
  const page = await openAgents();
  await page.locator('.thumb-new').click();
  await page.locator('.sheet[data-kind="new"]').waitFor({ state: 'visible' });
  assert.ok(await fontSize(page, '.sheet-prompt') >= 16);
  await closeSheet(page);
  await openSheetFromMore(page, 'Filter');
  await page.locator('.sheet[data-kind="filter"] input.search').waitFor({ state: 'visible' });
  assert.ok(await fontSize(page, '.sheet input.search') >= 16);
  await page.close();
});

test('on a touch tablet the desk filter field is 16px too', async () => {
  const page = await openAgents({ viewport: { width: 820, height: 1180 }, view: 'library' });
  await page.locator('.filter-toggle').click();
  await page.locator('.filter-pop input.search').waitFor({ state: 'visible' });
  assert.ok(await fontSize(page, '.filter-pop input.search') >= 16);
  await page.close();
});

// ------------------------------------------------------------ the right keyboard

test('search asks for a Search key and puts the keyboard away with it; the New prompt writes sentences', async () => {
  const page = await openAgents();
  const attrs = await page.evaluate(() => {
    const s = document.querySelector('input.search');
    return { type: s.type, hint: s.getAttribute('enterkeyhint'), caps: s.getAttribute('autocapitalize'), spell: s.spellcheck };
  });
  assert.deepEqual(attrs, { type: 'search', hint: 'search', caps: 'off', spell: false });
  await openSheetFromMore(page, 'Filter');
  const search = page.locator('.sheet input.search');
  await search.waitFor({ state: 'visible' });
  await search.focus();
  await search.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.matches?.('input.search')), false, 'Search left the caret in the field');
  await closeSheet(page);
  await page.locator('.thumb-new').click();
  await page.locator('.sheet-prompt').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.querySelector('.sheet-prompt').getAttribute('autocapitalize')), 'sentences');
  await page.close();
});

// ------------------------------------------------------------ the keyboard

test('the New sheet stands on the keyboard: Start is in the visible strip, the thumb bar steps aside, the home-bar inset goes', async () => {
  const page = await openAgents();
  await page.locator('.thumb-new').click();
  await page.locator('.sheet[data-kind="new"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.activeElement?.classList?.contains('sheet-prompt'), null, { timeout: 4000 });
  const padBefore = await page.evaluate(() => getComputedStyle(document.querySelector('.sheet')).paddingBottom);
  await raiseKeyboard(page);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-marble-keyboard'));
  const seen = await page.evaluate(() => {
    const vv = window.visualViewport;
    const start = document.querySelector('.sheet-start').getBoundingClientRect();
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    return {
      startBottom: Math.round(start.bottom),
      sheetTop: Math.round(sheet.top),
      visibleTop: Math.round(vv.offsetTop),
      visibleBottom: Math.round(vv.offsetTop + vv.height),
      thumb: getComputedStyle(document.querySelector('.thumb')).display,
      pad: getComputedStyle(document.querySelector('.sheet')).paddingBottom,
    };
  });
  assert.ok(seen.startBottom <= seen.visibleBottom, `Start ends at ${seen.startBottom}, under keys that start at ${seen.visibleBottom}`);
  assert.ok(seen.sheetTop >= seen.visibleTop, `the sheet's top ${seen.sheetTop} is above the screen`);
  assert.equal(seen.thumb, 'none', 'the thumb bar is still up with the keyboard');
  assert.ok(parseFloat(seen.pad) <= parseFloat(padBefore), `the sheet kept ${seen.pad} of padding under the keys`);
  await page.close();
});

test('one measurement of the screen: the page mirrors runtime/phone.js, it does not take its own', async () => {
  const page = await openAgents();
  await raiseKeyboard(page, KB, 120);
  const read = await page.evaluate(() => {
    const inline = (name) => document.documentElement.style.getPropertyValue(name).trim();
    const published = document.getElementById('marble-phone-vars')?.textContent ?? '';
    const of = (name) => published.match(new RegExp(`${name}: ([^;]+);`))?.[1]?.trim();
    const state = window.marblePhone.state();
    return {
      inline: { h: inline('--vv-h'), top: inline('--vv-top'), kb: inline('--kb') },
      published: { h: of('--vv-h'), top: of('--vv-top'), kb: of('--kb') },
      state: { h: `${state.h}px`, top: `${state.top}px`, kb: `${state.kb}px` },
    };
  });
  assert.deepEqual(read.inline, read.published);
  assert.deepEqual(read.inline, read.state);
  assert.deepEqual(read.inline, { h: `${852 - KB - 120}px`, top: '120px', kb: `${KB}px` });
  await page.close();
});

// ------------------------------------------------------------ nothing sideways

test('nothing runs past the right edge at 320, in any view or in a sheet with a long title in it', async () => {
  const page = await openAgents({ viewport: { width: 320, height: 640 } });
  const ids = await seed(page);
  await page.evaluate(async (first) => {
    await window.marble.agent.createFolder({ conversationIds: [first], name: 'Site work' });
  }, ids[0]);
  for (const view of ['deck', 'library', 'board', 'folders', 'focus']) {
    await inView(page, view);
    const width = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(width[0] <= width[1], `${view} is ${width[0]} wide in ${width[1]}`);
  }
  // The actions sheet for a chat that shares its file lists its neighbours.
  await inView(page, 'deck');
  await page.evaluate((id) => {
    document.querySelector(`.conv[data-id="${id}"] .manage .more`)?.click();
  }, ids[1]);
  await page.locator('.sheet[data-kind="actions"]').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  const past = await page.evaluate(() => [...document.querySelectorAll('.sheet .sheet-row, .sheet .sheet-note')]
    .map((el) => ({ text: el.textContent, right: Math.round(el.getBoundingClientRect().right) }))
    .filter((row) => row.right > window.innerWidth));
  assert.deepEqual(past, [], 'sheet rows run past the edge');
  await page.close();
});

// ------------------------------------------------------------ targets

test('Folders on a phone is the rail edge to edge, with 44pt rows, a 44pt tick and room above the thumb bar', async () => {
  const page = await openAgents();
  const ids = await seed(page);
  await page.evaluate(async (two) => {
    await window.marble.agent.createFolder({ conversationIds: two, name: 'Site work' });
  }, ids.slice(0, 2));
  await inView(page, 'folders');
  const rail = await page.evaluate(() => {
    const box = (el) => el.getBoundingClientRect();
    const tick = document.querySelector('.folder-tick');
    const t = box(tick);
    // What a finger 18px off the swatch's centre lands on.
    const near = document.elementFromPoint(t.left + t.width / 2 - 18, t.top + t.height / 2);
    return {
      width: Math.round(box(document.querySelector('.folder-rail')).width),
      header: Math.round(box(document.querySelector('.folder-header')).height),
      tabs: [...document.querySelectorAll('.folder-tab')].map((el) => Math.round(box(el).height)),
      newChat: Math.round(box(document.querySelector('.folder-new-chat')).height),
      tickReach: near === tick,
      label: document.querySelector('.folder-ungrouped-label')?.textContent,
      padBottom: parseFloat(getComputedStyle(document.querySelector('.folder-rail')).paddingBottom),
      thumb: Math.round(box(document.querySelector('.thumb')).height),
    };
  });
  assert.ok(rail.width >= 393 - 1, `the rail is ${rail.width} of 393`);
  assert.ok(rail.header >= 44, `folder header ${rail.header}`);
  assert.ok(rail.tabs.every((h) => h >= 44), `tabs ${rail.tabs}`);
  assert.ok(rail.newChat >= 44, `New chat ${rail.newChat}`);
  assert.ok(rail.tickReach, 'a finger beside the colour tick misses it');
  assert.equal(rail.label, 'Ungrouped');
  assert.ok(rail.padBottom >= rail.thumb, `the rail's last row can sit under the thumb bar (${rail.padBottom} < ${rail.thumb})`);
  await page.close();
});

test('the filter sheet: every chip is 44pt wide and the idle track is a 44pt strip', async () => {
  const page = await openAgents();
  await seed(page);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await openSheetFromMore(page, 'Filter');
  await page.locator('.sheet .filter-pop').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  const sizes = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.sheet .filter-pop .seg button')]
      .filter((b) => b.offsetParent)
      .map((b) => [b.textContent, Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]),
    range: Math.round(document.querySelector('.sheet .idle-range')?.getBoundingClientRect().height ?? 0),
  }));
  assert.ok(sizes.chips.length > 0);
  assert.deepEqual(sizes.chips.filter(([, w, h]) => w < 44 || h < 44), []);
  assert.ok(sizes.range >= 44, `the idle track is ${sizes.range} tall`);
  await page.close();
});

// ------------------------------------------------------------ a held finger

test('a held finger on a folder opens the rail menu beside it, and Rename gives a Done key at 16px', async () => {
  const page = await openAgents();
  const ids = await seed(page);
  await page.evaluate(async (two) => {
    await window.marble.agent.createFolder({ conversationIds: two, name: 'Site work' });
  }, ids.slice(0, 2));
  await inView(page, 'folders');
  const header = await page.locator('.folder-header').first().boundingBox();
  const x = header.x + header.width / 2;
  const y = header.y + header.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [{ x, y }]);
  await page.waitForTimeout(650);
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  const menu = await page.evaluate(() => {
    const el = document.querySelector('.rail-menu');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      items: [...el.querySelectorAll('button')].map((b) => [b.textContent, Math.round(b.getBoundingClientRect().height)]),
      inside: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight,
    };
  });
  assert.ok(menu, 'no menu after a held finger');
  assert.ok(menu.inside, 'the menu hangs off the screen');
  assert.ok(menu.items.some(([label]) => label === 'Rename'), menu.items.map(([l]) => l).join(', '));
  assert.deepEqual(menu.items.filter(([, h]) => h < 44), []);
  // The release was not a tap: the folder did not open behind the menu.
  assert.equal(await page.evaluate(() => document.body.hasAttribute('data-open')), false);
  await page.locator('.rail-menu button', { hasText: 'Rename' }).click();
  const name = await page.evaluate(() => {
    const el = document.querySelector('.folder-name[contenteditable]');
    return el ? { hint: el.getAttribute('enterkeyhint'), size: parseFloat(getComputedStyle(el).fontSize) } : null;
  });
  assert.ok(name, 'Rename did not open the name');
  assert.equal(name.hint, 'done');
  assert.ok(name.size >= 16, `the name is ${name.size}px`);
  await page.close();
});

// ------------------------------------------------------------ usage charts

test('usage charts: a tap shows a day and it stays to be read; the controls are 44pt', async () => {
  const page = await openAgents();
  const history = usageHistoryStub(12);
  await page.evaluate((h) => {
    const style = document.createElement('style');
    style.textContent = window.marbleUsageCharts.CSS;
    document.head.append(style);
    const holder = document.createElement('div');
    holder.id = 'charts';
    holder.style.cssText = 'position: fixed; inset: 60px 12px auto; z-index: 99; background: var(--paper);';
    document.body.append(holder);
    window.marbleUsageCharts.render(holder, h);
  }, history);
  const cell = page.locator('#charts .uh-cell[data-level]:not([data-level="0"])').first();
  const box = await cell.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(250);
  const tip = await page.evaluate(() => {
    const el = document.querySelector('#charts .uh-tip');
    return { hidden: el.hidden, text: el.textContent };
  });
  assert.equal(tip.hidden, false, 'the tip went with the finger');
  assert.ok(tip.text.length > 0);
  // A second tap on the same day puts it away.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.querySelector('#charts .uh-tip').hidden), true);
  const small = await page.evaluate(() => [...document.querySelectorAll('#charts .uh-metric button, #charts .uh-view button, #charts .uh-chip')]
    .map((b) => [b.textContent, Math.round(b.getBoundingClientRect().height)])
    .filter(([, h]) => h < 44));
  assert.deepEqual(small, []);
  await page.close();
});
