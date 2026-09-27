// A timeline row says what a document is, not only what it is called: a small
// live preview, and the colour of the folder it lives in. Nothing on it pulses.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({
  agents: false,
  documents: {
    drive: (await buildDrive()).replace(/(<body\b[^>]*)data-view="grid"/, '$1data-view="timeline"'),
    loose: GARDEN,
    'Research/paper': GARDEN,
  },
});
await fsp.writeFile(path.join(host.drive.store.marbleDir, 'drive.json'), JSON.stringify({ realms: { Research: 'research' } }));
test.after(() => host.close());

test('each row mounts a preview of its document and wears its folder’s colour', async () => {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/drive`);
  const paper = page.locator('#items .item.trow[data-path="Research/paper"][data-realm="research"]');
  await paper.waitFor();
  await paper.locator('.thumb .peek.marble-is-loaded iframe').waitFor({ state: 'attached' });
  assert.match(await paper.locator('.thumb .peek iframe').getAttribute('src'), /Research/);
  assert.equal(await paper.getAttribute('data-home'), 'Research');
  const ink = await paper.locator('.tdot').evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(ink, 'rgb(47, 111, 91)', 'the dot is Research green');

  const loose = page.locator('#items .item.trow[data-path="loose"]');
  await loose.locator('.thumb .peek').waitFor({ state: 'attached' });
  assert.equal(await loose.getAttribute('data-realm'), null);
  assert.equal(await loose.getAttribute('data-home'), null);

  // Both were written seconds ago; neither dot moves.
  const moving = await page.locator('#items .tdot').evaluateAll((els) => els.filter((el) => getComputedStyle(el).animationName !== 'none').length);
  assert.equal(moving, 0);
  assert.deepEqual(errors.filter((e) => !e.includes('sandboxed')), []);
  await page.context().close();
});
