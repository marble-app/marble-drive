// Throwing something away, and getting it back.
//
// Three things were wrong here at once. The Drive had Delete-moves-to-trash
// and nothing on the page ever said so. The bulk "Move N to trash" branch was
// unreachable, because opening a row menu narrowed the selection to that row
// first. And Restore had never worked at all: the row never carried the trash
// id, so it posted `undefined` and the host answered 400.
//
// Since then the key is gone altogether: moving to the trash is only ever
// asked for by name, from a menu, so a stray keystroke never costs a file.
// The Drive's own bars, as a phone or a page without the shell has them:
// on a desk the shell frames the Drive and these are its (shell-drive-frame).

import fsp from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';
import { liveDriveSource } from './live-drive.js';

const host = await startDrive({
  agents: false,
  documents: {
    drive: await buildDrive(),
    garden: GARDEN,
    'Papers/one': GARDEN,
    'Papers/deep/two': GARDEN,
    // Its own document, because the trash is cumulative across these tests and
    // two entries that came from one path are two rows with one `data-path`.
    solo: GARDEN,
  },
});
test.after(() => host.close());

async function openDrive() {
  await host.reset();
  const { page } = await host.newPage({ shell: false });
  await page.goto(`${host.base}/a/drive`);
  await page.locator('#items .item[data-path="garden"]').waitFor();
  return page;
}

const pick = async (page, path, modifiers = []) => {
  await page.locator(`#items .item[data-path="${path}"] .name`).click({ modifiers });
  await page.locator(`#items .item[data-path="${path}"].marble-picked`).waitFor();
};

const menu = async (page, path) => {
  await page.locator(`#items .item[data-path="${path}"] .more`).click();
  await page.locator('#menu[data-open="1"]').waitFor();
};

const gone = (page, path) =>
  page.locator(`#items .item[data-path="${path}"]`).waitFor({ state: 'detached' });

const inDrive = async () =>
  (await host.drive.store.list({ recursive: true, files: true })).map((e) => e.path).sort();

// -------------------------------------------------------------------- the key

test('Delete and Backspace leave a picked document where it is', async () => {
  const page = await openDrive();
  await pick(page, 'garden');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  await page.locator('#items .item[data-path="garden"].marble-picked').waitFor();
  assert.ok((await inDrive()).includes('garden'));
});

test('nor do they touch a folder, or a selection with one in it', async () => {
  const page = await openDrive();
  await pick(page, 'garden');
  await pick(page, 'Papers', ['Meta']);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  const there = await inDrive();
  assert.ok(there.includes('garden'));
  assert.ok(there.includes('Papers/deep/two'));
});

// ------------------------------------------------------------------- the menu

test('the menu is how a folder is thrown away, and how it comes back', async () => {
  const page = await openDrive();
  const before = await inDrive();

  await menu(page, 'Papers');
  await page.locator('#menu button', { hasText: 'Move to trash' }).click();
  await gone(page, 'Papers');

  await page.locator('#nav .nav-item[data-nav="trash"]').click();
  const row = page.locator('#items .item[data-path="Papers"]');
  await row.waitFor();
  // The folder reports what it would give back. Drawn "empty", a trash row
  // says restoring it is worth nothing.
  assert.equal(await row.locator('.thumb .cap').textContent(), '2 items');
  assert.equal(await row.locator('.owner').textContent(), '2 items');

  await row.locator('.more').click();
  await page.locator('#menu button', { hasText: 'Restore' }).click();
  await page.locator('#nav .nav-item[data-nav="drive"]').click();
  await page.locator('#items .item[data-path="Papers"]').waitFor();
  assert.deepEqual(await inDrive(), before);
});

test('a document goes by its menu and comes back the same way', async () => {
  const page = await openDrive();
  await menu(page, 'solo');
  await page.locator('#menu button', { hasText: 'Move to trash' }).click();
  await gone(page, 'solo');

  await page.locator('#nav .nav-item[data-nav="trash"]').click();
  const row = page.locator('#items .item[data-path="solo"]');
  await row.waitFor();
  // Measured out of the trash rather than zeroed: GARDEN's six ids.
  assert.equal(await row.locator('.owner').textContent(), '6 nodes');
  assert.match(await row.locator('.size').textContent(), /\d+ B/);
  await row.locator('.more').click();
  await page.locator('#menu button', { hasText: 'Restore' }).click();
  await page.locator('#nav .nav-item[data-nav="drive"]').click();
  await page.locator('#items .item[data-path="solo"]').waitFor();
  assert.ok((await inDrive()).includes('solo'));
});

// ------------------------------------------------------------------ the hints

test('the trash verb names no key, because there is none', async () => {
  const page = await openDrive();
  await menu(page, 'garden');
  assert.equal(
    await page.locator('#menu button', { hasText: 'Move to trash' }).locator('.key').count(),
    0,
  );
  assert.equal(await page.locator('#menu button').first().locator('.key').textContent(), '⏎');
  assert.doesNotMatch(await page.locator('#menu').textContent(), /⌫/);
});

test('the bulk trash verb speaks for the selection', async () => {
  const page = await openDrive();
  await pick(page, 'garden');
  await pick(page, 'Papers', ['Meta']);
  await menu(page, 'Papers');
  const trash = page.locator('#menu button', { hasText: 'to trash' });
  assert.match(await trash.textContent(), /Move 2 to trash/);
  assert.equal(await trash.locator('.key').count(), 0);
});

// ------------------------------------------------------------------- the guard

test('a picked row typing into a name is not a picked row being deleted', async () => {
  const page = await openDrive();
  await menu(page, 'garden');
  await page.locator('#menu button', { hasText: 'Pin to sidebar' }).click();
  await page.locator('#pins .pin[data-path="garden"] [data-marble-editable]').click();
  await page.keyboard.press('Backspace');
  await page.locator('#items .item[data-path="garden"]').waitFor();
});

// --------------------------------------------------------------- the live copy

test('the live drive document does all of the above', async (t) => {
  const live = await liveDriveSource();
  if (!live) {
    t.skip('no drive/drive.mrbl in this checkout');
    return;
  }
  const there = await startDrive({
    agents: false,
    documents: { drive: live, garden: GARDEN, 'Papers/one': GARDEN, 'Papers/deep/two': GARDEN },
  });
  try {
    const { page, errors } = await there.newPage({ shell: false });
    await page.goto(`${there.base}/a/drive`);
    await page.locator('#items .item[data-path="Papers"]').waitFor();

    await page.locator('#items .item[data-path="Papers"] .name').click();
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);
    await page.locator('#items .item[data-path="Papers"].marble-picked').waitFor();

    await page.locator('#items .item[data-path="Papers"] .more').click();
    await page.locator('#menu button', { hasText: 'Move to trash' }).click();
    await page.locator('#items .item[data-path="Papers"]').waitFor({ state: 'detached' });

    await page.locator('#nav .nav-item[data-nav="trash"]').click();
    const row = page.locator('#items .item[data-path="Papers"]');
    await row.waitFor();
    assert.equal(await row.locator('.thumb .cap').textContent(), '2 items');
    await row.locator('.more').click();
    await page.locator('#menu button', { hasText: 'Restore' }).click();
    await page.locator('#nav .nav-item[data-nav="drive"]').click();
    await page.locator('#items .item[data-path="Papers"]').waitFor();

    const back = (await there.drive.store.list({ recursive: true })).map((e) => e.path).sort();
    assert.ok(back.includes('Papers/deep/two'), back.join(', '));
    assert.deepEqual(errors.filter((e) => !e.includes('sandboxed')), []);
  } finally {
    await there.close();
  }
});
