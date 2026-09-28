// The shell: ⌘J opens the drive around the open document — the tree, the bar,
// and the chat where it already was. What it has to get right is that the
// document is still the document: Fit moves it with a transient stylesheet and
// nothing else, Float leaves it where it was, and closing takes every trace of
// the shell off the page but a pill that only rises when the pointer asks.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const NOTES = GARDEN.replace('Research Garden', 'Field notes').replace('<title>Garden</title>', '<title>Field notes</title>');

const host = await startDrive({
  documents: { garden: GARDEN, 'Research/Specs/Field notes': NOTES, 'Travel/plans': GARDEN },
});
test.after(() => host.close());

async function visit(path = 'Research/Specs/Field notes', options) {
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/${path.split('/').map(encodeURIComponent).join('/')}`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.shadowRoot && document.querySelector('marble-agent-drawer')?.shadowRoot);
  const shell = page.locator('marble-shell');
  const panel = page.locator('marble-agent-drawer').locator('.panel');
  return { page, errors, shell, panel };
}

const margins = (page) => page.evaluate(() => {
  const s = getComputedStyle(document.documentElement);
  return { top: s.marginTop, left: s.marginLeft, right: s.marginRight };
});
const isOpen = (page) => page.evaluate(() => document.querySelector('marble-shell').hasAttribute('data-open'));

test('closed, the page is the page: no bar, no tree, no margin, and a pill only on the way to the corner', async () => {
  const { page, shell, errors } = await visit();
  await page.mouse.move(640, 400);
  assert.equal(await isOpen(page), false);
  assert.deepEqual(await margins(page), { top: '0px', left: '0px', right: '0px' });
  assert.equal(await shell.locator('.bar').isVisible(), false);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('marble-shell').shadowRoot.querySelector('.pill')).opacity === '0');
  // The corner strip raises it; the pill names the document by its name in the folder.
  await page.mouse.move(40, 3);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('marble-shell').shadowRoot.querySelector('.pill')).opacity === '1');
  assert.equal(await shell.locator('.pill b').innerText(), 'Field notes');
  await shell.locator('.pill').click();
  assert.equal(await isOpen(page), true);
  const served = await (await fetch(`${host.base}/a/garden`)).text();
  assert.ok(!served.includes('<marble-shell'), 'never written into a document');
  assert.equal(await host.drive.store.read('Research/Specs/Field notes'), NOTES, 'the file is untouched');
  assert.deepEqual(errors.filter((m) => !/favicon/.test(m)), []);
});

test('⌘J opens Fit: the page gives up the top, the left and the right, and the chat sits under the bar', async () => {
  const { page, shell, panel } = await visit();
  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === true);
  assert.equal(await isOpen(page), true);
  const m = await margins(page);
  assert.equal(m.top, '44px');
  assert.equal(m.left, '260px');
  assert.notEqual(m.right, '0px', 'the drawer docks on the right');
  assert.equal(await panel.evaluate((el) => el.getBoundingClientRect().top), 44);
  assert.equal(await panel.getAttribute('data-shell'), 'fit');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marble-shell-top')), '44px');
  // Where you are: the folders, then the document, which opens its menu.
  assert.deepEqual(await shell.locator('.crumbs a').allInnerTexts(), ['Drive', 'Research', 'Specs']);
  assert.equal(await shell.locator('.crumbs .here').innerText(), 'Field notes');
  assert.equal(await shell.locator('.crumbs a').nth(2).getAttribute('href'), `/#/${encodeURIComponent('Research/Specs')}`);

  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === false);
  assert.equal(await isOpen(page), false);
  assert.deepEqual(await margins(page), { top: '0px', left: '0px', right: '0px' });
});

test('Float lays the panels over the page and moves nothing', async () => {
  const { page, shell, panel } = await visit();
  await page.keyboard.press('Control+j');
  await shell.locator('[data-act="float"]').click();
  assert.deepEqual(await margins(page), { top: '0px', left: '0px', right: '0px' });
  assert.equal(await panel.getAttribute('data-shell'), 'float');
  assert.equal(await panel.evaluate((el) => el.getBoundingClientRect().top), 44 + 16);
  assert.equal(await shell.locator('[data-act="float"]').getAttribute('aria-pressed'), 'true');
  await shell.locator('[data-act="fit"]').click();
  assert.equal((await margins(page)).top, '44px');
});

test('the tree and the chat each put away on their own, and the choice follows you to the next page', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+j');
  await shell.locator('[data-act="chat"]').click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === false);
  assert.equal(await isOpen(page), true, 'the shell stays');
  assert.equal((await margins(page)).right, '0px');
  await page.keyboard.press('Control+\\');
  assert.equal((await margins(page)).left, '0px');
  await shell.locator('.nav').waitFor({ state: 'hidden' });

  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.hasAttribute('data-open'));
  assert.equal((await margins(page)).top, '44px', 'still open on the next document');
  assert.equal((await margins(page)).left, '0px', 'still without the tree');
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer').isOpen), false, 'still without the chat');
  assert.equal(await shell.locator('.crumbs .here').innerText(), 'garden');
});

test('the tree unfolds to where you are, marks it, and opens what you pick', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+j');
  const current = shell.locator('.sec[data-sec="drive"] [aria-current="page"]');
  await current.waitFor();
  assert.equal(await current.innerText(), 'Field notes');
  assert.equal(await shell.locator('button.row[data-folder="Travel"]').getAttribute('aria-expanded'), 'false');
  await shell.locator('button.row[data-folder="Travel"]').click();
  await shell.locator('.sec[data-sec="drive"] a.row[title="Travel/plans"]').click();
  await page.waitForURL(/\/a\/Travel(%2F|\/)plans$/);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.hasAttribute('data-open'));
  assert.equal(await page.locator('marble-shell').locator('button.row[data-folder="Travel"]').getAttribute('aria-expanded'), 'true', 'the folder you opened stays open');
});

test('⌘K searches the drive by name and Enter opens the first match', async () => {
  const { page, shell } = await visit('garden');
  await page.keyboard.press('Control+k');
  assert.equal(await isOpen(page), true, '⌘K opens the shell to search');
  await page.keyboard.type('field');
  await shell.locator('.scroll a.row').first().waitFor();
  assert.deepEqual(await shell.locator('.scroll a.row > span:first-of-type').allInnerTexts(), ['Field notes']);
  await page.keyboard.press('Enter');
  await page.waitForURL(/Field%20notes$/);
});

test('Share hands you the document\'s link', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+j');
  await shell.locator('[data-act="share"]').click();
  const input = shell.locator('.sharing input');
  await input.waitFor();
  assert.equal(await input.inputValue(), `${host.base}${await page.evaluate(() => window.marble.href(window.marble.app))}`);
  await page.keyboard.press('Escape');
  assert.equal(await shell.locator('.sharing').isVisible(), false);
});

test('at phone width there is no shell to open: ⌘J is the drawer\'s, as before', async () => {
  const { page } = await visit('garden', { viewport: { width: 393, height: 700 } });
  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === true);
  assert.equal(await isOpen(page), false);
  assert.equal((await margins(page)).top, '0px');
});
