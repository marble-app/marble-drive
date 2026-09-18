// Precision: nothing moves that the person did not move, focus is visible,
// and the chrome holds its row. Measured, not eyeballed.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const openAgents = async (options = {}) => {
  await host.reset();
  const { page } = await host.newPage(options);
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    try { for (const row of await agent.conversations()) await agent.archive(row.id, true); } catch { /* fresh */ }
    for (const title of ['one', 'two', 'three', 'four', 'five', 'six']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
    }
  });
  await page.waitForFunction(() => document.querySelectorAll('#list .conv:not([hidden])').length === 6);
  return { page };
};

test('hovering a Focus card shows its actions without moving anything', async () => {
  const { page } = await openAgents();
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.focus-card[data-lod="digest"]').length >= 1 && !document.querySelector('.vt-layer'));
  await page.waitForTimeout(500);
  const card = page.locator('.focus-card[data-lod="digest"]').first();
  const measure = () => card.evaluate((el) => ({
    head: el.querySelector('.focus-card-head').getBoundingClientRect().height,
    body: Math.round(el.querySelector('.focus-card-body').getBoundingClientRect().top * 4) / 4,
    title: Math.round(el.querySelector('.focus-card-title').getBoundingClientRect().width * 4) / 4,
    actions: getComputedStyle(el.querySelector('.focus-card-actions')).opacity,
  }));
  const before = await measure();
  await card.hover();
  await page.waitForTimeout(300);
  const after = await measure();
  assert.equal(after.head, before.head, 'the head keeps its height');
  assert.equal(after.body, before.body, 'the body does not move');
  assert.equal(after.title, before.title, 'the title keeps its width');
  assert.equal(after.actions, '1', 'and the actions are there');
});

test('a row’s agent tag and activity sit on one baseline', async () => {
  const { page } = await openAgents();
  const store = host.drive.agents.store;
  for (const row of await store.conversations()) if (!row.archived) await store.updateConversation(row.id, { activity: 'doing a thing' });
  // A store write does not reach an open page; reload to read it.
  await page.reload();
  await page.waitForFunction(() => [...document.querySelectorAll('#list .conv .activity')].some((el) => el.textContent.trim()));
  const gap = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#list .conv')].find((el) => el.querySelector('.activity')?.textContent.trim());
    const bottomOfText = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      return rects.length ? Math.max(...rects.map((r) => r.bottom)) : null;
    };
    return Math.abs(bottomOfText(row.querySelector('.tags .tag')) - bottomOfText(row.querySelector('.activity')));
  });
  assert.ok(gap <= 1.5, `tag and activity text bottoms differ by ${gap}px`);
});

test('the topbar stays one row down to the phone breakpoint', async () => {
  for (const width of [1280, 1024, 900, 760]) {
    const { page } = await openAgents({ viewport: { width, height: 800 } });
    // One row of controls is ~52px tall; a wrapped bar is nearly twice that.
    const height = await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().height);
    assert.ok(height < 70, `at ${width}px the topbar is ${height}px tall`);
  }
});

test('keyboard focus draws a ring the hover look does not', async () => {
  const { page } = await openAgents();
  await page.locator('#list .conv').first().hover();
  const hovered = await page.locator('#list .conv').first().evaluate((el) => getComputedStyle(el).boxShadow);
  await page.mouse.move(700, 400);
  await page.keyboard.press('Tab');
  for (let i = 0; i < 12; i += 1) {
    const focused = await page.evaluate(() => document.activeElement?.className ?? '');
    if (focused.includes('conv')) break;
    await page.keyboard.press('Tab');
  }
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  assert.notEqual(ring, 'none', 'the focused row has a ring');
  assert.notEqual(ring, hovered, 'and it is not the hover look');
  const viewRing = await page.evaluate(() => { const b = document.querySelector('.views [data-view="board"]'); b.focus(); return getComputedStyle(b).boxShadow; });
  assert.notEqual(viewRing, 'none', 'so does a view button');
});

test('the view switch slides its thumb to the pressed view', async () => {
  const { page } = await openAgents();
  await page.locator('.views [data-view="board"]').click();
  await page.waitForTimeout(350);
  const at = await page.evaluate(() => {
    const thumb = document.querySelector('.views .seg-thumb')?.getBoundingClientRect();
    const btn = document.querySelector('.views [data-view="board"]').getBoundingClientRect();
    return thumb ? { dx: Math.abs(thumb.x - btn.x), dw: Math.abs(thumb.width - btn.width) } : null;
  });
  assert.ok(at, 'the view switch has a thumb');
  assert.ok(at.dx < 1.5 && at.dw < 1.5, `thumb sits under Board (${JSON.stringify(at)})`);
});

test('a pane bar shortens its target before its title', async () => {
  const { page } = await openAgents({ viewport: { width: 1000, height: 800 } });
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.update(id, { title: 'A title that is long enough to need room', target: 'Research/Some/Deep/Folder/With a long document name.mrbl' });
  });
  await page.locator('#list .conv').first().click();
  await page.locator('.pane > .dock-bar .dock-title').waitFor();
  await page.waitForTimeout(300);
  const widths = await page.evaluate(() => ({
    title: document.querySelector('.pane > .dock-bar .dock-title').getBoundingClientRect().width,
    target: document.querySelector('.pane > .dock-bar .dock-target').getBoundingClientRect().width,
  }));
  assert.ok(widths.title >= 96, `the title keeps at least 6rem (${widths.title})`);
});
