// Every document is its own page, so every click in the tree is a page that
// starts with nothing. The sidebar draws at once from how the last page left
// it, then from what the drive says now — and only re-reads the Drive's file
// for the pins when that file has changed.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const drive = (pins) => `<!doctype html>
<html><head><meta charset="utf-8"><title>My Drive</title></head>
<body data-marble-id="b">
  <ul class="pins" id="pins" data-marble-id="pins">
    ${pins.map((p, i) => `<li class="pin" data-marble-id="p${i}" data-path="${p}" data-kind="doc"><span data-marble-id="p${i}l" data-marble-editable>${p.split('/').at(-1)}</span></li>`).join('\n    ')}
  </ul>
</body></html>
`;

const host = await startDrive({
  documents: { garden: GARDEN, 'Travel/plans': GARDEN, 'Research/atlas': GARDEN, drive: drive(['Travel/plans']) },
});
test.after(() => host.close());
await fsp.writeFile(path.join(host.drive.store.marbleDir, 'drive.json'), JSON.stringify({ realms: { Research: 'research' } }));

const rows = (page, sec) => page.evaluate((name) => [...document.querySelector('marble-shell').shadowRoot
  .querySelectorAll(`.sec[data-sec="${name}"] .row`)].map((r) => r.textContent.trim()), sec);

test('the next page draws the sidebar before the drive has answered, and reads the pins only when the Drive changed', async () => {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.shadowRoot);
  await page.keyboard.press('Control+j');
  await page.locator('marble-shell').locator('.sec[data-sec="pinned"] a.row').first().waitFor();
  // Leaving is when it is kept.
  await page.waitForFunction(() => localStorage.getItem('marble-shell:last'));

  // The next page, with the tree held back and the Drive's file counted.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/drive/tree**', async (route) => { await held; await route.continue(); });
  await page.route('**/drive/settings**', async (route) => { await held; await route.continue(); });
  let driveReads = 0;
  page.on('request', (req) => { if (new URL(req.url()).pathname === '/a/drive') driveReads += 1; });
  let treeAsked = '';
  page.on('request', (req) => { if (req.url().includes('/drive/tree')) treeAsked = req.url(); });

  await page.goto(`${host.base}/a/Research%2Fatlas`);
  await page.locator('marble-shell').locator('.sec[data-sec="drive"] .row').first().waitFor();
  assert.deepEqual(await rows(page, 'pinned'), ['plansTravel'], 'the pins, from the last page');
  assert.ok((await rows(page, 'drive')).includes('Research'), 'the tree, from the last page');
  assert.equal(await page.locator('marble-shell').locator('button.row[data-folder="Research"]').getAttribute('data-realm'), 'research', 'in its colours, too');
  // Where you are is this page's, not the last one's.
  await page.waitForFunction(() => document.querySelector('marble-shell').shadowRoot
    .querySelector('.sec[data-sec="recent"] [aria-current="page"]')?.textContent.includes('atlas'));
  assert.match(treeAsked, /files=0/, 'folders and documents only');
  release();
  await page.waitForResponse((res) => res.url().includes('/drive/tree'));
  await page.waitForTimeout(200);
  assert.equal(driveReads, 0, 'the Drive has not changed, so its pins are not read again');

  // The Drive's pins change: the stamp in the tree moves, and they are read.
  await host.drive.createDocument('drive', drive(['Travel/plans', 'Research/atlas']), { label: 'test' });
  await page.waitForFunction(() => document.querySelector('marble-shell').shadowRoot
    .querySelectorAll('.sec[data-sec="pinned"] a.row').length === 2);
  assert.ok(driveReads >= 1);

  // A document made elsewhere arrives with the next tree.
  await host.drive.createDocument('Research/brand-new', GARDEN, { label: 'test' });
  await page.locator('marble-shell').locator('.sec[data-sec="recent"] .row', { hasText: 'brand-new' }).waitFor();
  assert.deepEqual(errors, []);
});

test('what the last page left is replaced, not added to: a document gone since is gone from the tree', async () => {
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.shadowRoot);
  // A last page that knew a document this drive no longer has.
  await page.evaluate(() => {
    localStorage.setItem('marble-shell:open', '1');
    localStorage.setItem('marble-shell:last', JSON.stringify({
      v: 1, pins: [], pinsStamp: null, convs: [],
      tree: { kind: 'folder', path: '', name: '', title: 'My Drive', children: [
        { kind: 'doc', path: 'ghost', name: 'ghost', folder: '', title: 'ghost', modified: Date.now() + 1e6 },
      ] },
    }));
  });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/drive/tree**', async (route) => { await held; await route.continue(); });
  await page.reload();
  await page.locator('marble-shell').locator('.sec[data-sec="recent"] .row', { hasText: 'ghost' }).waitFor();
  release();
  await page.waitForFunction(() => {
    const names = [...document.querySelector('marble-shell').shadowRoot.querySelectorAll('.sec[data-sec="recent"] .row')].map((r) => r.textContent);
    return names.length && !names.some((n) => n.includes('ghost'));
  });
  assert.ok((await rows(page, 'drive')).includes('Travel'));
});
