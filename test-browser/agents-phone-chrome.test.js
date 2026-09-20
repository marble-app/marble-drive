// The Agents document's phone chrome: the topbar as a conversation header,
// the thumb bar on every list view, and sheets that read the keyboard, scroll
// under a finger and still fall away from the grip. 393 × 852 with touch.

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

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { say: 'Read it.' },
  ],
  permission: [{ ask: { tool: 'Bash', input: { command: 'rm -rf build' } } }, { say: 'after' }],
};

const host = await startDrive({
  scripts: SCRIPTS,
  documents: { garden: GARDEN, Agents: AGENTS },
});
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: PHONE, hasTouch: true, isMobile: true, ...options });
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      const { folders } = await window.marble.agent.folders();
      for (const row of folders) await window.marble.agent.deleteFolder(row.id);
    } catch { /* fresh agent */ }
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
    localStorage.clear();
  });
  return { page, errors };
};

const inView = async (page, view) => {
  await page.evaluate((v) => localStorage.setItem('marble-agents:view', v), view);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
};

/** A running conversation, which lands in an open Deck band. */
const seedRunning = async (page, title = 'a phone chat') => {
  const id = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  await host.drive.agents.store.updateConversation(id, { title, target: 'Marble/site.mrbl', running: true, activity: 'busy' });
  return id;
};

const longPress = async (page, locator, dx = 100) => {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + dx, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(520);
  await page.mouse.up();
};

test('an open conversation: the topbar is its header, and the pane keeps no bar or back disc of its own', async () => {
  const { page } = await openAgents();
  const id = await seedRunning(page, 'Rebuild the site');
  await page.reload();
  await page.locator(`.deck .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-open'));
  await page.waitForTimeout(350);

  const shot = await page.evaluate(() => {
    const shown = (el) => Boolean(el) && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
    return {
      back: (document.querySelector('.topbar .phone-back-label')?.textContent ?? '').trim(),
      backShown: shown(document.querySelector('.topbar .phone-back')),
      title: (document.querySelector('.topbar .phone-title-text')?.textContent ?? '').trim(),
      titleShown: shown(document.querySelector('.topbar .phone-title')),
      status: document.querySelector('.topbar .phone-title')?.dataset.status ?? null,
      h1Shown: shown(document.querySelector('.topbar h1')),
      dockBar: shown(document.querySelector('.pane > .dock-bar')),
      paneBack: shown(document.querySelector('.pane .back')),
    };
  });
  assert.equal(shot.backShown, true, 'no back chevron in the topbar');
  assert.equal(shot.back, 'Deck', `the back chevron is named for the view: ${shot.back}`);
  assert.equal(shot.titleShown, true, 'no conversation title in the topbar');
  assert.equal(shot.title, 'Rebuild the site');
  assert.equal(shot.status, 'running', 'the title dot does not carry the status');
  assert.equal(shot.h1Shown, false, 'the document title is still in the topbar over a conversation');
  assert.equal(shot.dockBar, false, 'the pane still shows its dock bar');
  assert.equal(shot.paneBack, false, 'the pane still shows its floating back disc');

  // ⋯ now belongs to the conversation, not to the view list.
  await page.locator('.topbar .more').click();
  await page.locator('.sheet[data-kind="actions"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.sheet .sheet-name').first().textContent(), 'Rebuild the site');
  assert.ok(await page.locator('.sheet-row', { hasText: 'Stop' }).count(), 'a running conversation cannot be stopped from its sheet');

  // And the chevron goes back to the view it is named for.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.hasAttribute('data-sheet'));
  await page.locator('.topbar .phone-back').click();
  await page.waitForFunction(() => !document.body.hasAttribute('data-open'));
});

test('every topbar control is a 44pt hit box on one centre line', async () => {
  const { page } = await openAgents();
  const id = await seedRunning(page);
  await page.evaluate(async () => {
    const a = window.marble.agent;
    const chat = await a.start({ provider: 'fake' });
    await a.send(chat, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] });
  });
  await page.reload();
  await page.locator(`.deck .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-open'));
  await page.locator('.topbar .asks-pill:not([hidden])').waitFor();
  await page.locator('.topbar .usage-dot:not([hidden])').waitFor();

  const boxes = await page.evaluate(() => [...document.querySelectorAll('.topbar button')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { sel: el.className, w: Math.round(r.width), h: Math.round(r.height), mid: Math.round(r.top + r.height / 2) };
    }));
  assert.ok(boxes.length >= 4, `only ${boxes.length} topbar controls`);
  for (const box of boxes) assert.ok(box.w >= 44 && box.h >= 44, `${box.sel} is ${box.w}×${box.h}`);
  const cluster = boxes.filter((b) => /asks-pill|usage-dot|more/.test(b.sel));
  assert.equal(cluster.length, 3, 'the right-hand cluster is not three controls');
  assert.equal(new Set(cluster.map((b) => b.mid)).size, 1, `the cluster is off one centre line: ${JSON.stringify(cluster)}`);
  // The ring says what it is worth to a reader who cannot see it.
  assert.match(await page.locator('.topbar .usage-dot').getAttribute('aria-label'), /^Usage \d+%$/);
});

test('⋯ is a structured sheet: New conversation, the views with a tick, then Filter and Settings', async () => {
  const { page } = await openAgents();
  await seedRunning(page);
  await inView(page, 'library');
  await page.locator('.topbar .more').click();
  const sheet = page.locator('.sheet[data-kind="more"]');
  await sheet.waitFor({ state: 'visible' });
  assert.equal(await sheet.locator('.sheet-name').textContent(), 'Agents');
  assert.equal(await sheet.locator('.sheet-group').count(), 3, 'the sheet is not grouped');
  const ticked = await page.evaluate(() => [...document.querySelectorAll('.sheet-row')]
    .filter((row) => row.querySelector('.sheet-mark'))
    .map((row) => row.querySelector('.sheet-label').textContent));
  assert.deepEqual(ticked, ['List'], 'the current view is not marked');

  // New conversation is the first row, and it reaches the New sheet from List.
  await sheet.locator('.sheet-row', { hasText: 'New conversation' }).click();
  await page.locator('.sheet[data-kind="new"]').waitFor({ state: 'visible' });
  assert.ok(await page.locator('.sheet .sheet-prompt').count(), 'the New sheet has no prompt');
});

test('⋯ → Filter is a sheet holding the real filter panel, and a chip filters the list', async () => {
  const { page } = await openAgents();
  await seedRunning(page, 'busy one');
  const idle = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  await host.drive.agents.store.updateConversation(idle, { title: 'quiet one' });
  await inView(page, 'library');
  await page.waitForFunction(() => document.querySelectorAll('#list .conv').length === 2);

  await page.locator('.topbar .more').click();
  await page.locator('.sheet[data-kind="more"]').waitFor({ state: 'visible' });
  await page.locator('.sheet-row', { hasText: 'Filter' }).click();
  const sheet = page.locator('.sheet[data-kind="filter"]');
  await sheet.waitFor({ state: 'visible' });
  assert.ok(await sheet.locator('.filter-pop').isVisible(), 'the filter panel opened at 0 × 0 again');
  assert.equal(await sheet.locator('.filters button').count(), 4, 'the status chips did not come along');
  // 17px so iOS does not zoom the page when the field takes the caret.
  const search = await sheet.locator('.filter-pop .search').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { size: getComputedStyle(el).fontSize, h: Math.round(r.height) };
  });
  assert.equal(search.size, '17px');
  assert.ok(search.h >= 44, `the search field is ${search.h} tall`);

  await sheet.locator('.filters button[data-filter="running"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#list .conv')].filter((el) => !el.hidden).length === 1);
  const left = await page.evaluate(() => [...document.querySelectorAll('#list .conv')]
    .filter((el) => !el.hidden)
    .map((el) => el.querySelector('.title').textContent));
  assert.deepEqual(left, ['busy one']);

  // The panel goes home, so the desk's filter box is whole again.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.hasAttribute('data-sheet'));
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.filterbox > .filter-pop'))), true);
});

test('the thumb bar is on every list view, and never over Focus or a conversation', async () => {
  const { page } = await openAgents();
  const id = await seedRunning(page);
  for (const view of ['deck', 'library', 'board', 'folders']) {
    await inView(page, view);
    assert.equal(await page.locator('.thumb').isVisible(), true, `no thumb bar in ${view}`);
  }
  await inView(page, 'focus');
  assert.equal(await page.locator('.thumb').isVisible(), false, 'the thumb bar stands over Focus');
  // Focus puts a conversation on its stage; the list wants none open.
  await page.evaluate(() => localStorage.removeItem('marble-agents:open'));
  await inView(page, 'library');
  await page.locator(`#list .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-open'));
  assert.equal(await page.locator('.thumb').isVisible(), false, 'the thumb bar stands over a conversation');
});

test('a row ⋯ opens the actions sheet on a phone, and never the desk popover', async () => {
  const { page } = await openAgents();
  const id = await seedRunning(page, 'Rebuild the site');
  await page.reload();
  // Measured before the sheet, which pushes the page back a step as it opens.
  const box = await page.locator(`.deck .conv[data-id="${id}"] .manage .more`).boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, `the row ⋯ is ${box.width}×${box.height}`);
  await page.locator(`.deck .conv[data-id="${id}"] .manage .more`).click();
  await page.locator('.sheet[data-kind="actions"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.conv .manage .menu').count(), 0, 'the 13px popover is still built');
});

test('a long press opens the actions sheet and selects no text', async () => {
  const { page } = await openAgents();
  const id = await seedRunning(page, 'Rebuild the site');
  await page.reload();
  await longPress(page, page.locator(`.deck .conv[data-id="${id}"]`));
  await page.locator('.sheet[data-kind="actions"]').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => getSelection().isCollapsed), true, 'the press left a selection behind');
});

test('a tall sheet scrolls under a pan, and only the grip throws it away', async () => {
  const { page } = await openAgents();
  const id = await seedRunning(page, 'Rebuild the site');
  // A crowd on one target: the actions sheet grows a Working here list and
  // runs past the bottom of the screen.
  const ids = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 14; i += 1) out.push(await window.marble.agent.start({ provider: 'fake' }));
    return out;
  });
  for (const [i, other] of ids.entries()) {
    await host.drive.agents.store.updateConversation(other, { title: `Neighbour ${i}`, target: 'Marble/site.mrbl' });
  }
  await page.reload();
  await page.locator(`.deck .conv[data-id="${id}"] .manage .more`).click();
  const sheet = page.locator('.sheet[data-kind="actions"]');
  await sheet.waitFor({ state: 'visible' });
  await page.waitForTimeout(500);

  const shape = await sheet.evaluate((el) => ({
    over: el.scrollHeight > el.clientHeight + 4,
    touch: getComputedStyle(el).touchAction,
  }));
  assert.equal(shape.over, true, 'the sheet did not overflow, so this proves nothing');
  assert.equal(shape.touch, 'pan-y', 'the sheet still blocks panning');

  // A pan over the list scrolls it and leaves the sheet where it is.
  const box = await sheet.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 60);
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => document.querySelector('.sheet').scrollTop > 0);
  const midY = box.y + box.height - 60;
  await page.mouse.down();
  for (let y = 0; y < 200; y += 20) await page.mouse.move(box.x + box.width / 2, midY + y);
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-sheet')), 'actions', 'a read of the list threw the sheet away');

  // The grip is always the handle — once you have scrolled back up to it.
  await sheet.evaluate((el) => { el.scrollTop = 0; });
  const grip = await page.locator('.sheet-grip').boundingBox();
  const gx = grip.x + grip.width / 2;
  await page.mouse.move(gx, grip.y + grip.height / 2);
  await page.mouse.down();
  for (let y = 0; y <= 520; y += 40) {
    await page.mouse.move(gx, grip.y + y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForFunction(() => !document.body.hasAttribute('data-sheet'));
});

test('the mast’s "+N here" tag asks the page who they are, and the sheet answers', async () => {
  const { page } = await openAgents();
  const id = await seedRunning(page, 'Rebuild the site');
  for (const name of ['Neighbour one', 'Neighbour two']) {
    const other = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
    await host.drive.agents.store.updateConversation(other, { title: name, target: 'Marble/site.mrbl', running: true, activity: 'busy' });
  }
  await page.reload();
  await page.locator(`.deck .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-open'));
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('marble-conversation[conversation]').announceWorkingHere());
  await page.locator('.sheet[data-kind="actions"]').waitFor({ state: 'visible' });
  const rows = await page.evaluate(() => [...document.querySelectorAll('.sheet .sheet-label')].map((el) => el.textContent));
  assert.ok(rows.includes('Neighbour one') && rows.includes('Neighbour two'), `no Working here list: ${rows.join(', ')}`);
  assert.ok(await page.locator('.sheet .sheet-sub', { hasText: 'Working here' }).count(), 'the list is not named');
});

test('with the keyboard up, the New sheet stands on it: Start is inside the visual viewport', async () => {
  const { page } = await openAgents();
  await inView(page, 'deck');
  await page.locator('.thumb-new').click();
  await page.locator('.sheet[data-kind="new"]').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  const KB = 336;
  await page.evaluate((kb) => document.documentElement.style.setProperty('--kb', `${kb}px`), KB);
  await page.waitForTimeout(100);
  const seen = await page.evaluate((kb) => {
    const start = document.querySelector('.sheet-start').getBoundingClientRect();
    const vv = window.visualViewport?.height ?? window.innerHeight;
    return { bottom: Math.round(start.bottom), vv: Math.round(vv), sill: Math.round(window.innerHeight - kb) };
  }, KB);
  assert.ok(seen.bottom <= seen.vv, `Start ends at ${seen.bottom}, past the visual viewport ${seen.vv}`);
  assert.ok(seen.bottom <= seen.sill + 1, `Start ends at ${seen.bottom}, under a keyboard that starts at ${seen.sill}`);
});

test('the New sheet takes the caret only once it has arrived', async () => {
  const { page } = await openAgents();
  await inView(page, 'deck');
  await page.locator('.thumb-new').click();
  await page.locator('.sheet[data-kind="new"]').waitFor({ state: 'visible' });
  // Mid-spring the field is not yet the caret's.
  const early = await page.evaluate(() => document.activeElement?.className ?? '');
  await page.waitForFunction(() => document.activeElement?.classList?.contains('sheet-prompt'), null, { timeout: 4000 });
  assert.notEqual(early, 'sheet-prompt', 'the keyboard came up under a moving sheet');
});
