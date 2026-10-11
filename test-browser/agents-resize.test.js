// Dragging a seam is an edit: the width lands in the file, not in a store
// beside it. These tests drag, then read the document off the host.

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

const openAgents = async () => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && document.querySelector('.rz-list')));
  return { page, errors };
};

/** The op reaches the file a beat after the pointer comes up. */
const untilSource = async (match, tries = 60) => {
  for (let n = 0; n < tries; n += 1) {
    const source = await host.drive.store.read('Agents');
    if (match.test(source)) return source;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`the document never matched ${match}`);
};

const dragBy = async (page, selector, dx) => {
  const box = await page.locator(selector).boundingBox();
  const y = box.y + Math.min(200, box.height / 2);
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 10 });
  await page.mouse.up();
};

test('dragging the list seam widens the list and writes the width into the file', async () => {
  const { page, errors } = await openAgents();
  const before = await page.locator('#list').evaluate((el) => el.getBoundingClientRect().width);
  await dragBy(page, '.rz-list', 120);
  const after = await page.locator('#list').evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(after > before + 80, `list should have grown: ${before} → ${after}`);

  const source = await untilSource(/<body[^>]*style="[^"]*--list-w: \d+px/);
  const px = Number(/--list-w: (\d+)px/.exec(source)[1]);
  assert.ok(Math.abs(px - after) < 4, `filed ${px}px, rendered ${after}px`);
  assert.deepEqual(errors, []);
});

test('the width a drag left is the width the next visit opens with', async () => {
  const { page } = await openAgents();
  await dragBy(page, '.rz-list', 140);
  await untilSource(/--list-w: \d+px/);
  const wanted = await page.locator('#list').evaluate((el) => el.getBoundingClientRect().width);

  const { page: second } = await host.newPage();
  await second.goto(`${host.base}/a/Agents`);
  await second.waitForFunction(() => Boolean(document.querySelector('.rz-list')));
  const reopened = await second.locator('#list').evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(Math.abs(reopened - wanted) < 2, `${reopened} should match ${wanted}`);
});

test('a seam answers the arrow keys, and files one op when they stop', async () => {
  const { page, errors } = await openAgents();
  const before = await page.locator('#list').evaluate((el) => el.getBoundingClientRect().width);
  await page.locator('.rz-list').focus();
  for (let n = 0; n < 3; n += 1) await page.keyboard.press('ArrowRight');
  const after = await page.locator('#list').evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(after > before, `arrows should widen the list: ${before} → ${after}`);
  await untilSource(/--list-w: \d+px/);
  assert.deepEqual(errors, []);
});

test('double-clicking a seam puts the width back and takes it out of the file', async () => {
  const { page } = await openAgents();
  const before = await page.locator('#list').evaluate((el) => el.getBoundingClientRect().width);
  await dragBy(page, '.rz-list', 120);
  await untilSource(/--list-w: \d+px/);
  await page.locator('.rz-list').dblclick();
  await untilSource(/<body data-marble-id="[^"]*" data-view="library">/);
  const after = await page.locator('#list').evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(Math.abs(after - before) < 2, `${after} should be back to ${before}`);
});

test('dragging a board seam moves the share between two columns', async () => {
  const { page, errors } = await openAgents();
  await page.locator('.views [data-view="board"]').click();
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  const widthOf = (col) =>
    page.locator(`.column[data-col="${col}"]`).evaluate((el) => el.getBoundingClientRect().width);
  const before = await widthOf('running');
  await dragBy(page, '.board > .rz-col >> nth=0', 100);
  const after = await widthOf('running');
  assert.ok(after > before + 60, `Running should have grown: ${before} → ${after}`);

  const source = await untilSource(/--col-running: [\d.]+/);
  assert.match(source, /--col-review: [\d.]+/);
  assert.deepEqual(errors, []);
});

test('the folder rail has its own seam, and the Folders shell lets it through', async () => {
  const { page } = await openAgents();
  await page.locator('.views [data-view="folders"]').click();
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'folders');
  const before = await page.locator('.folder-rail').evaluate((el) => el.getBoundingClientRect().width);
  await dragBy(page, '.rz-rail', 90);
  const after = await page.locator('.folder-rail').evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(after > before + 50, `the rail should have grown: ${before} → ${after}`);
  await untilSource(/--rail-w: \d+px/);
});
