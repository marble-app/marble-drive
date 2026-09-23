// The Drive a new drive starts with is the product's, not the owner's: none of
// the owner's own views, and the page does not list itself as a document.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const SOURCE = await buildDrive();
const host = await startDrive({
  agents: false,
  documents: {
    drive: SOURCE,
    // The same Drive, saved while it was showing a view it no longer has.
    'old-drive': SOURCE.replace(/(<body\b[^>]*)data-view="grid"/, '$1data-view="map"'),
    'Notes/a': GARDEN,
    plan: GARDEN,
  },
});
test.after(() => host.close());

test('the shipped Drive has Grid, List, Timeline and Weight, and nothing of Map or Pulse', () => {
  const views = [...SOURCE.matchAll(/data-set-view="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(views)], ['grid', 'list', 'timeline', 'weight']);
  assert.doesNotMatch(SOURCE, /function drawMap|function drawPulse|\.orbit\b|data-view="pulse"|data-view="map"/);
});

test('a Drive saved on a view it no longer has opens on Grid', async () => {
  assert.match(await host.drive.store.read('old-drive'), /<body\b[^>]*data-view="map"/);
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/old-drive`);
  await page.locator('#items .item[data-path="plan"]').waitFor();
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-view')), 'grid');
  await page.context().close();
});

test('the Drive page is not listed among the documents; it folds away with the materials', async () => {
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/drive`);
  await page.locator('#items .item[data-path="plan"]').waitFor();
  const self = page.locator('#items .item[data-path="drive"]');
  assert.equal(await self.count(), 1, 'still reachable');
  assert.equal(await self.getAttribute('data-material'), '1');
  assert.equal(await page.locator('#items .item[data-path="plan"]').getAttribute('data-material'), null);
  // The other copy is just a document, as far as this page is concerned.
  assert.equal(await page.locator('#items .item[data-path="old-drive"]').getAttribute('data-material'), null);
  await page.context().close();
});
