// A row in the shell's tree has a menu and can be carried. Right-click (or the
// menu key) offers what the Drive's own menu does; carried into Pinned it pins
// there, along Pinned it moves, onto a folder it moves into it. What it has to
// get right is that a pin is still the Drive's: every pin made here is markup
// filed into the Drive's own file, by the ops the Drive itself would file.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const DRIVE = `<!doctype html>
<html><head><meta charset="utf-8"><title>My Drive</title></head>
<body data-marble-id="b">
  <ul class="pins" id="pins" data-marble-id="pins">
    <li class="pin" data-marble-id="p1" data-path="Travel/plans" data-kind="doc"><span class="ico" data-marble-id="p1i">·</span><span data-marble-id="p1l" data-marble-editable>plans</span></li>
    <li class="pin" data-marble-id="p2" data-path="Travel" data-kind="folder"><span class="ico" data-marble-id="p2i">·</span><span data-marble-id="p2l" data-marble-editable>Travel</span></li>
  </ul>
</body></html>
`;

let host;
test.beforeEach(async () => {
  host = await startDrive({
    agents: false,
    documents: { garden: GARDEN, 'Travel/plans': GARDEN, 'Research/atlas': GARDEN, 'Research/notes': GARDEN, drive: DRIVE },
  });
});
test.afterEach(() => host.close());

async function visit(at = 'garden') {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/${at.split('/').map(encodeURIComponent).join('/')}`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.shadowRoot && window.marble?.drive);
  const shell = page.locator('marble-shell');
  await page.keyboard.press('Control+\\');
  await shell.locator('.sec[data-sec="pinned"] a.row').first().waitFor();
  // The tree has slid all the way in, so a row is where it is drawn.
  await page.waitForFunction(() => {
    const nav = document.querySelector('marble-shell').shadowRoot.querySelector('.nav');
    return nav.getBoundingClientRect().left >= 0 && !nav.getAnimations().length;
  });
  return { page, errors, shell };
}

const pinsInFile = async () => {
  const html = await (await fetch(`${host.base}/a/drive`, { cache: 'no-store' })).text();
  return [...html.matchAll(/<li class="pin"[^>]*data-path="([^"]*)"[^>]*data-kind="([^"]*)"/g)].map((m) => `${m[1]}:${m[2]}`);
};
// Whether a document is at this address itself, not forwarded from it.
const isAt = async (p) => (await fetch(`${host.base}/a/${encodeURIComponent(p)}`, { redirect: 'manual' })).status === 200;
const driveRow = (shell, p) => shell.locator(`.sec[data-sec="drive"] .row[data-path="${p}"], .sec[data-sec="drive"] button.row[data-folder="${p}"]`).first();
const waitPins = (page, want) => page.waitForFunction((want) => JSON.stringify([...document.querySelector('marble-shell').shadowRoot
  .querySelectorAll('.sec[data-sec="pinned"] a.row')].map((el) => el.dataset.path)) === JSON.stringify(want), want);

test('right-click a page in the tree and Pin it: the pin is filed into the Drive\'s own file, and Unpin takes it out', async () => {
  const { page, shell } = await visit();
  await driveRow(shell, 'garden').click({ button: 'right' });
  const menu = shell.locator('.menu');
  await menu.waitFor();
  assert.deepEqual(await menu.locator('button span').allInnerTexts(),
    ['Show in Drive', 'Open in new tab', 'Pin', 'Rename or move…', 'Make a copy', 'Copy link', 'Copy path', 'Download', 'Move to trash']);
  await menu.locator('[data-pick="pin"]').click();
  await waitPins(page, ['Travel/plans', 'Travel', 'garden']);
  assert.deepEqual(await pinsInFile(), ['Travel/plans:doc', 'Travel:folder', 'garden:doc']);

  await driveRow(shell, 'garden').click({ button: 'right' });
  assert.equal(await menu.locator('[data-pick="pin"]').innerText(), 'Unpin');
  await menu.locator('[data-pick="pin"]').click();
  await waitPins(page, ['Travel/plans', 'Travel']);
  assert.deepEqual(await pinsInFile(), ['Travel/plans:doc', 'Travel:folder']);
});

test('a folder pins as a folder, and its pin opens the Drive there', async () => {
  const { page, shell } = await visit();
  await driveRow(shell, 'Research').click({ button: 'right' });
  await shell.locator('.menu [data-pick="pin"]').click();
  await waitPins(page, ['Travel/plans', 'Travel', 'Research']);
  assert.deepEqual(await pinsInFile(), ['Travel/plans:doc', 'Travel:folder', 'Research:folder']);
  assert.equal(await shell.locator('.sec[data-sec="pinned"] a.row[data-path="Research"]').getAttribute('href'), `/#/Research`);
});

test('carried into Pinned a row pins where it is let go, and a pin carried along Pinned moves', async () => {
  const { page, shell } = await visit();
  const drag = async (from, to, dy) => {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    await page.mouse.move(a.x + 20, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 30, a.y + a.height / 2 + 4, { steps: 3 });
    await page.mouse.move(b.x + 20, b.y + b.height / 2 + dy, { steps: 8 });
    await page.mouse.up();
  };
  const first = shell.locator('.sec[data-sec="pinned"] a.row').first();
  await drag(driveRow(shell, 'garden'), first, -6);
  await waitPins(page, ['garden', 'Travel/plans', 'Travel']);
  assert.deepEqual(await pinsInFile(), ['garden:doc', 'Travel/plans:doc', 'Travel:folder']);
  assert.equal(page.url().endsWith('/a/garden'), true, 'letting go opened nothing');

  // The first pin, carried below the last.
  const pins = shell.locator('.sec[data-sec="pinned"] a.row');
  await drag(pins.first(), pins.last(), 8);
  await waitPins(page, ['Travel/plans', 'Travel', 'garden']);
  // The row is in its new place as it is let go; the file hears a moment later.
  for (let i = 0; i < 50 && (await pinsInFile())[0] !== 'Travel/plans:doc'; i += 1) await page.waitForTimeout(100);
  assert.deepEqual(await pinsInFile(), ['Travel/plans:doc', 'Travel:folder', 'garden:doc']);
});

test('carried onto a folder a page moves into it; Escape puts it back', async () => {
  const { page, shell } = await visit('Research/atlas');
  const garden = driveRow(shell, 'garden');
  const a = await garden.boundingBox();
  const folder = await driveRow(shell, 'Travel').boundingBox();
  await page.mouse.move(a.x + 20, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(folder.x + 30, folder.y + folder.height / 2, { steps: 8 });
  assert.equal(await driveRow(shell, 'Travel').getAttribute('data-drop'), '', 'the folder answers');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await driveRow(shell, 'Travel').getAttribute('data-drop'), null);
  assert.equal(await isAt('garden'), true, 'nothing moved');

  await page.mouse.move(a.x + 20, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(folder.x + 30, folder.y + folder.height / 2, { steps: 8 });
  await page.mouse.up();
  await shell.locator('.toast[data-on]').waitFor();
  assert.equal(await shell.locator('.toast').innerText(), 'Moved garden to Travel');
  assert.equal(await isAt('Travel/garden'), true);
});

test('a pin\'s menu renames the pin in place, and the menu key opens it from the keyboard', async () => {
  const { page, shell } = await visit();
  const plans = shell.locator('.sec[data-sec="pinned"] a.row[data-path="Travel/plans"]');
  await plans.focus();
  await page.keyboard.press('Shift+F10');
  const menu = shell.locator('.menu');
  await menu.waitFor();
  assert.deepEqual(await menu.locator('button span').allInnerTexts(), ['Show in Drive', 'Open in new tab', 'Rename pin', 'Copy link', 'Copy path', 'Unpin']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const input = shell.locator('input.rename');
  await input.waitFor();
  await input.fill('Trip');
  await page.keyboard.press('Enter');
  await page.waitForFunction(async () => (await (await fetch('/a/drive', { cache: 'no-store' })).text()).includes('data-marble-editable>Trip</span>'));
  assert.equal(await plans.locator('span').first().innerText(), 'Trip');
  assert.equal(page.url().endsWith('/a/garden'), true, 'renaming opened nothing');
});

test('Rename or move from a row\'s menu moves that row, not the page you are on', async () => {
  const { page, shell } = await visit();
  await driveRow(shell, 'Research').click();
  await driveRow(shell, 'Research/notes').click({ button: 'right' });
  await shell.locator('.menu [data-pick="move"]').click();
  const dialog = shell.locator('.moving');
  await dialog.waitFor();
  assert.equal(await dialog.locator('.name').inputValue(), 'notes');
  await dialog.locator('.name').fill('field notes');
  assert.equal(await dialog.locator('.ok').innerText(), 'Rename');
  await dialog.locator('.ok').click();
  await shell.locator('.toast[data-on]').waitFor();
  assert.equal(await shell.locator('.toast').innerText(), 'Renamed to field notes');
  assert.equal(await isAt('Research/field notes'), true);
  assert.equal(page.url().endsWith('/a/garden'), true);
});

test('on the Drive itself a pin is filed by the page, so it shows there at once', async () => {
  const { page, shell } = await visit('drive');
  await driveRow(shell, 'garden').click({ button: 'right' });
  await shell.locator('.menu [data-pick="pin"]').click();
  await waitPins(page, ['Travel/plans', 'Travel', 'garden']);
  assert.equal(await page.locator('#pins > .pin[data-path="garden"]').count(), 1, 'the page has it');
  for (let i = 0; i < 50 && !(await pinsInFile()).includes('garden:doc'); i += 1) await page.waitForTimeout(100);
  assert.deepEqual(await pinsInFile(), ['Travel/plans:doc', 'Travel:folder', 'garden:doc']);
});
