// Throwing something away, finding out that you can, and getting it back.
//
// Three things were wrong here at once. The Drive has had Delete-moves-to-
// trash since the row menu grew a trash verb and nothing on the page ever
// said so. The bulk "Move N to trash" branch was unreachable, because opening
// a row menu narrowed the selection to that row first. And Restore had never
// worked at all: the row never carried the trash id, so it posted `undefined`
// and the host answered 400.

import fsp from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

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
  const { page } = await host.newPage();
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

test('Delete on a picked document moves it to the trash', async () => {
  const page = await openDrive();
  await pick(page, 'garden');
  await page.keyboard.press('Delete');
  await gone(page, 'garden');

  await page.locator('#nav .nav-item[data-nav="trash"]').click();
  // The id it got on the way in is what makes the row restorable at all.
  await page.locator('#items .item[data-path="garden"][data-trash-id]').waitFor();
  assert.deepEqual(await page.locator('#items .item b').allTextContents(), ['garden']);
});

test('the key will not throw a folder away, and says where to', async () => {
  const page = await openDrive();
  await pick(page, 'Papers');
  await page.keyboard.press('Backspace');
  await page.locator('#toast[data-open="1"]').waitFor();
  assert.match(await page.locator('#toast').textContent(), /Delete a folder from its . menu/);
  // Still there, and still picked — nothing happened at all.
  await page.locator('#items .item[data-path="Papers"].marble-picked').waitFor();
  assert.ok((await inDrive()).includes('Papers/deep/two'));
});

test('one folder in the selection spares the documents beside it', async () => {
  const page = await openDrive();
  await pick(page, 'garden');
  await pick(page, 'Papers', ['Meta']);
  await page.keyboard.press('Delete');
  await page.locator('#toast[data-open="1"]').waitFor();
  assert.ok((await inDrive()).includes('garden'));
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

test('a document comes back from the trash the same way', async () => {
  const page = await openDrive();
  await pick(page, 'solo');
  await page.keyboard.press('Delete');
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

test('the trash verb names its key, and does not on a folder', async () => {
  const page = await openDrive();
  await menu(page, 'garden');
  assert.equal(
    await page.locator('#menu button', { hasText: 'Move to trash' }).locator('.key').textContent(),
    '⌫',
  );
  assert.equal(await page.locator('#menu button').first().locator('.key').textContent(), '⏎');

  await page.keyboard.press('Escape');
  await menu(page, 'Papers');
  // A hint for a key that would refuse is worse than no hint.
  assert.equal(
    await page.locator('#menu button', { hasText: 'Move to trash' }).locator('.key').count(),
    0,
  );
});

test('the bulk trash verb speaks for the selection', async () => {
  const page = await openDrive();
  await pick(page, 'garden');
  await pick(page, 'Papers', ['Meta']);
  await menu(page, 'Papers');
  const trash = page.locator('#menu button', { hasText: 'to trash' });
  assert.match(await trash.textContent(), /Move 2 to trash/);
  // A folder is in it, so the key is not offered.
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

test('the document Bryan is actually looking at does all of the above', async () => {
  const live = await fsp.readFile(new URL('../drive/drive.mrbl', import.meta.url), 'utf8');
  const there = await startDrive({
    agents: false,
    documents: { drive: live, garden: GARDEN, 'Papers/one': GARDEN, 'Papers/deep/two': GARDEN },
  });
  try {
    const { page, errors } = await there.newPage();
    await page.goto(`${there.base}/a/drive`);
    await page.locator('#items .item[data-path="Papers"]').waitFor();

    await page.locator('#items .item[data-path="Papers"] .name').click();
    await page.keyboard.press('Backspace');
    await page.locator('#toast[data-open="1"]').waitFor();
    assert.match(await page.locator('#toast').textContent(), /Delete a folder/);

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
