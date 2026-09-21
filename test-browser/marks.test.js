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

const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

const open = async (doc = 'garden', { width = 1200, height = 800, reducedMotion = null } = {}) => {
  await closePages();
  await host.reset();
  const { page } = await host.newPage();
  pages.push(page);
  await page.setViewportSize({ width, height });
  if (reducedMotion) await page.emulateMedia({ reducedMotion });
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  return page;
};

const bar = (page) => page.locator('.marble-marks-bar');
const main = (page) => page.locator('.marble-marks-main');
const barBox = (page) => page.evaluate(() => {
  const r = document.querySelector('.marble-marks-bar').getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
});

test('every document gets the toolbar in the bottom-right corner above the drawer\'s launcher; the Agents page does not', async () => {
  const page = await open();
  await bar(page).waitFor();
  const box = await barBox(page);
  assert.ok(Math.abs(box.right - (1200 - 16)) <= 1, `right edge at ${box.right}`);
  const launcherTop = await page.evaluate(() =>
    document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.launcher').getBoundingClientRect().top);
  assert.ok(Math.abs(box.bottom - (launcherTop - 12)) <= 1, `bottom edge at ${box.bottom}, launcher top at ${launcherTop}`);
  assert.equal(await page.evaluate(() => document.querySelector('.marble-marks-layer').hasAttribute('data-marble-transient')), true);
  assert.equal(await main(page).getAttribute('aria-expanded'), 'false');

  const agents = await open('Agents');
  await agents.waitForTimeout(300);
  assert.equal(await agents.locator('.marble-marks-layer').count(), 0, 'no toolbar on the page made of agents');
});

test('the toolbar leaves the drawer’s launcher reachable in the same corner', async () => {
  const page = await open();
  await bar(page).waitFor();
  const [barRect, launcherRect] = await page.evaluate(() => {
    const l = document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.launcher');
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
    return [r(document.querySelector('.marble-marks-bar')), r(l)];
  });
  const overlaps = barRect.left < launcherRect.right && barRect.right > launcherRect.left
    && barRect.top < launcherRect.bottom && barRect.bottom > launcherRect.top;
  assert.equal(overlaps, false, `toolbar ${JSON.stringify(barRect)} covers launcher ${JSON.stringify(launcherRect)}`);
  // And the launcher is what a click in its middle actually reaches.
  const hit = await page.evaluate(() => {
    const l = document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.launcher');
    const b = l.getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return top?.tagName?.toLowerCase() ?? null;
  });
  assert.equal(hit, 'marble-agent-drawer');
});

test('the toolbar steps aside while the drawer is open, and comes back when it closes', async () => {
  const page = await open();
  await bar(page).waitFor();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').click();
  await page.locator('marble-agent-drawer aside.panel[data-open="true"]').waitFor();
  await page.waitForFunction(() => document.querySelector('.marble-marks-bar').hidden);
  await drawer.locator('button.close').click();
  await page.waitForFunction(() => !document.querySelector('.marble-marks-bar').hidden);
});

test('a resize while the drawer is open does not strand the toolbar when it reappears', async () => {
  const page = await open();
  await bar(page).waitFor();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').click();
  await page.locator('marble-agent-drawer aside.panel[data-open="true"]').waitFor();
  await page.waitForFunction(() => document.querySelector('.marble-marks-bar').hidden);
  // The bar is display:none here, so its offsetWidth/offsetHeight are 0.
  // restingPoint() must not use them, or this resize computes a degenerate
  // rest point nothing ever corrects afterwards.
  await page.setViewportSize({ width: 1000, height: 700 });
  await drawer.locator('button.close').click();
  await page.waitForFunction(() => !document.querySelector('.marble-marks-bar').hidden);
  const box = await barBox(page);
  assert.ok(Math.abs(box.right - (1000 - 16)) <= 1, `right edge at ${box.right}`);
  const launcherTop = await page.evaluate(() =>
    document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.launcher').getBoundingClientRect().top);
  assert.ok(Math.abs(box.bottom - (launcherTop - 12)) <= 1, `bottom edge at ${box.bottom}, launcher top at ${launcherTop}`);
});

test('pinning the drawer moves the toolbar in with the page edge', async () => {
  const page = await open();
  await bar(page).waitFor();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').click();
  await page.locator('marble-agent-drawer aside.panel[data-open="true"]').waitFor();
  await drawer.locator('button.pin').click();
  await page.locator('marble-agent-drawer aside.panel[data-pinned="true"]').waitFor();
  await page.waitForFunction(() => document.documentElement.getBoundingClientRect().right < innerWidth - 300);
  await page.waitForFunction(() => {
    const edge = document.documentElement.getBoundingClientRect().right;
    const r = document.querySelector('.marble-marks-bar').getBoundingClientRect();
    return Math.abs(r.right - (edge - 16)) <= 1;
  });
});

const strip = (page) => page.locator('.marble-marks-strip');
const tool = (page, name) => page.locator(`.marble-marks-tool[data-tool="${name}"]`);

test('the button opens a strip holding Select, out of its own corner, and closes it again', async () => {
  const page = await open();
  await bar(page).waitFor();
  assert.equal(await strip(page).isHidden(), true);
  await main(page).click();
  await strip(page).waitFor();
  assert.equal(await main(page).getAttribute('aria-expanded'), 'true');
  await tool(page, 'select').waitFor();
  assert.equal(await tool(page, 'select').getAttribute('aria-pressed'), 'false');
  assert.equal(await tool(page, 'select').getAttribute('data-label'), 'Select');
  // The strip hangs above the button and shares its right edge.
  const [b, s] = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return [r('.marble-marks-main'), r('.marble-marks-strip')];
  });
  assert.ok(s.bottom < b.top, 'strip sits above the button');
  assert.ok(Math.abs(s.right - b.right) <= 1, 'strip shares the button\'s right edge');
  assert.equal(await strip(page).evaluate((el) => {
    const [x, y] = getComputedStyle(el).transformOrigin.split(' ').map(parseFloat);
    return Math.round(x) === el.offsetWidth && Math.round(y) === el.offsetHeight;
  }), true, 'grows from the bottom right');
  await main(page).click();
  await page.waitForFunction(() => document.querySelector('.marble-marks-strip').hidden);
  assert.equal(await main(page).getAttribute('aria-expanded'), 'false');
});

test('under reduced motion the strip appears with no animation', async () => {
  const page = await open('garden', { reducedMotion: 'reduce' });
  await bar(page).waitFor();
  await main(page).click();
  await strip(page).waitFor();
  assert.equal(await strip(page).evaluate((el) => el.getAnimations().length), 0);
});
