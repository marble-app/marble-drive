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

test('every document gets the toolbar at the bottom right; the Agents page does not', async () => {
  const page = await open();
  await bar(page).waitFor();
  const box = await barBox(page);
  assert.ok(Math.abs(box.right - (1200 - 16)) <= 1, `right edge at ${box.right}`);
  assert.ok(Math.abs(box.bottom - (800 - 16)) <= 1, `bottom edge at ${box.bottom}`);
  assert.equal(await page.evaluate(() => document.querySelector('.marble-marks-layer').hasAttribute('data-marble-transient')), true);
  assert.equal(await main(page).getAttribute('aria-expanded'), 'false');

  const agents = await open('Agents');
  await agents.waitForTimeout(300);
  assert.equal(await agents.locator('.marble-marks-layer').count(), 0, 'no toolbar on the page made of agents');
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
