// A new drive wears nobody's folders. The shipped Drive names no realms of its
// own; a drive that wants Research green says so in `.marble/drive.json`.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({
  agents: false,
  documents: { drive: await buildDrive(), 'Research/paper': GARDEN, 'Days/today': GARDEN },
});
test.after(() => host.close());

const realmsOnPage = async () => {
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/drive`);
  await page.locator('#items .item[data-path="Research"]').waitFor();
  // Settings may land after the first draw; give the redraw a moment.
  await page.waitForTimeout(400);
  const realms = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('#items .item[data-kind="folder"]')].map((el) => [el.dataset.path, el.dataset.realm ?? '']),
  ));
  await page.context().close();
  return realms;
};

test('the shipped Drive names no one\'s folders', async () => {
  const source = await buildDrive();
  assert.doesNotMatch(source, /Bryan/);
  assert.deepEqual(await realmsOnPage(), { Research: '', Days: '' });
});

test('a drive\'s own drive.json decides which folders wear a realm', async () => {
  const marbleDir = host.drive.store.marbleDir;
  await fsp.writeFile(path.join(marbleDir, 'drive.json'), JSON.stringify({ realms: { Research: 'research' } }));
  try {
    assert.deepEqual(await realmsOnPage(), { Research: 'research', Days: '' });
  } finally {
    await fsp.rm(path.join(marbleDir, 'drive.json'));
  }
});
