// The shell is the Drive's frame. On a desk the Drive page draws no top bar or
// sidebar of its own: the shell stays open around it, and what those bars held
// is in the shell on every page — New at the head of the tree, Trash at its
// foot, and Settings and This drive at the end of the bar. On a phone, where
// there is no shell, the Drive keeps its own bars.
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({
  documents: { drive: await buildDrive(), garden: GARDEN, 'Research/notes': GARDEN, Agents: GARDEN, Board: GARDEN, Chat: GARDEN },
});
test.after(() => host.close());

async function visit(path, options) {
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/${path.split('/').map(encodeURIComponent).join('/')}`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.shadowRoot);
  return { page, errors, shell: page.locator('marble-shell') };
}

const shown = (locator) => locator.evaluate((el) => getComputedStyle(el).display !== 'none');
const quiet = (errors) => errors.filter((e) => !/favicon|sandboxed/.test(e));

test('on the Drive the shell is the frame: open, no way to hide it, and the page draws no bars of its own', async () => {
  const { page, shell, errors } = await visit('drive');
  await page.locator('#items .item[data-path="garden"]').waitFor();
  assert.equal(await shell.evaluate((el) => el.hasAttribute('data-open')), true, 'open though it was never opened');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('marble-shell-open')), true);
  assert.equal(await shown(page.locator('.topbar')), false);
  assert.equal(await shown(page.locator('aside.side')), false);
  assert.equal(await shell.locator('[data-act="close"]').isVisible(), false);
  // ⌘\ has nothing to hide here.
  await page.locator('#items').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+\\');
  assert.equal(await shell.evaluate((el) => el.hasAttribute('data-open')), true);
  // The file is untouched: the bars are still in it, and the class is the page's.
  const served = await host.drive.store.read('drive');
  assert.ok(served.includes('class="topbar"') && served.includes('id="pins"'));
  assert.doesNotMatch(served, /<html[^>]*marble-shell-open/);
  // The crumbs follow the folder the Drive is showing.
  await page.evaluate(() => { location.hash = '#/Research'; });
  await page.waitForFunction(() => document.querySelector('marble-shell').shadowRoot.querySelector('.crumbs .here')?.textContent === 'Research');
  assert.deepEqual(quiet(errors), []);
  await page.context().close();
});

test('on a phone there is no shell, and the Drive keeps its own bars', async () => {
  const { page } = await visit('drive', { viewport: { width: 400, height: 800 } });
  await page.locator('#items .item[data-path="garden"]').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('marble-shell-open')), false);
  assert.equal(await shown(page.locator('.topbar')), true);
  await page.context().close();
});

test('elsewhere the shell is closed until asked, as before, and the page keeps its corner', async () => {
  const { page, shell } = await visit('garden');
  assert.equal(await shell.evaluate((el) => el.hasAttribute('data-open')), false);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('marble-shell-open')), false);
  // Open, the section of documents with agents on them is called Modifying.
  await page.keyboard.press('Control+\\');
  assert.equal((await shell.locator('.sec[data-sec="agents"] .sec-fold').innerText()).trim(), 'Modifying');
  await page.context().close();
});

test('New heads the tree on any page: a focused box, the three apps, the templates', async () => {
  const { page, shell, errors } = await visit('garden');
  await page.keyboard.press('Control+\\');
  await shell.locator('.nav .new').click();
  const pop = shell.locator('.making');
  await pop.waitFor({ state: 'visible' });
  assert.equal(await shell.evaluate((el) => el.shadowRoot.activeElement?.getAttribute('aria-label')), 'Describe an app to build');
  assert.deepEqual(await pop.locator('.apps > .to b').allTextContents(), ['Chat', 'Agent', 'Board']);
  assert.equal(await pop.locator('.apps > .to[aria-pressed="true"] b').textContent(), 'Chat');
  await pop.locator('.tpl').first().waitFor();
  assert.ok(await pop.locator('.tpl').count() >= 4);
  assert.equal(await pop.locator('.send').isDisabled(), true);
  await page.keyboard.type('a habit tracker');
  assert.equal(await pop.locator('.send').isDisabled(), false);
  // Escape puts it away, and a half-typed sentence is still there after.
  await page.keyboard.press('Escape');
  await pop.waitFor({ state: 'hidden' });
  await shell.locator('.nav .new').click();
  assert.equal(await pop.locator('.ask textarea').inputValue(), 'a habit tracker');
  // Enter sends to the app used last, in the address.
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/a\/Chat#ask=/);
  assert.equal(new URL(page.url()).hash, `#ask=${encodeURIComponent('a habit tracker')}`);
  assert.deepEqual(quiet(errors), []);
  await page.context().close();
});

test('a template from New is named, made in the folder you are in, and opened', async () => {
  const { page, shell } = await visit('Research/notes');
  await page.keyboard.press('Control+\\');
  await shell.locator('.nav .new').click();
  const pop = shell.locator('.making');
  await pop.locator('.tpl[data-id="doc"]').click();
  await pop.locator('.brief').waitFor({ state: 'visible' });
  assert.equal(await pop.locator('.brief h3').textContent(), 'Document');
  // Escape from the form goes back to the list, not out.
  await page.keyboard.press('Escape');
  await pop.locator('.start').waitFor({ state: 'visible' });
  await pop.locator('.tpl[data-id="doc"]').click();
  await pop.locator('.brief .name').fill('Reading log');
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => decodeURIComponent(url.pathname) === '/a/Research/Reading log');
  assert.ok(await host.drive.store.read('Research/Reading log'));
  await page.context().close();
});

test('Settings says where the built-in apps show, files it on the Drive, and the tree follows', async () => {
  const { page, shell, errors } = await visit('garden');
  await page.keyboard.press('Control+\\');
  await shell.locator('.sec[data-sec="drive"] a.row[data-path="Agents"]').waitFor();
  await shell.locator('[data-act="settings"]').click();
  const pop = shell.locator('.settings');
  await pop.waitFor({ state: 'visible' });
  // Never chosen: with my files, where they always were.
  assert.equal(await pop.locator('.level[aria-checked="true"] .lv-name').textContent(), 'With my files');
  assert.ok((await pop.locator('.chips a').allTextContents()).includes('Agents'));

  await pop.locator('.level[data-builtin="sidebar"]').click();
  await shell.locator('.sec[data-sec="builtin"] a.row[data-path="Agents"]').waitFor();
  assert.equal(await shell.locator('.sec[data-sec="drive"] a.row[data-path="Agents"]').count(), 0);
  await page.waitForFunction(async () => (await (await fetch('/a/drive', { cache: 'no-store' })).text()).includes('data-builtin="sidebar"'));

  await pop.locator('.level[data-builtin="hidden"]').click();
  await page.waitForFunction(() => !document.querySelector('marble-shell').shadowRoot.querySelector('.sec[data-sec="builtin"]'));
  assert.equal(await shell.locator('a.row[data-path="Agents"]').count(), 0);
  // Search still finds them.
  await shell.locator('.search input').fill('Agents');
  await shell.locator('.scroll a.row[data-path="Agents"]').waitFor();
  assert.deepEqual(quiet(errors), []);
  await page.context().close();

  // The Drive's own listing leaves them out too.
  const drive = await visit('drive');
  await drive.page.locator('#items .item[data-path="garden"]').waitFor();
  assert.equal(await drive.page.locator('#items .item[data-path="Agents"]').count(), 0);
  // And back with the files.
  await drive.shell.locator('[data-act="settings"]').click();
  await drive.shell.locator('.settings .level[data-builtin="listing"]').click();
  await drive.page.locator('#items .item[data-path="Agents"]').waitFor();
  await drive.page.context().close();
});

test('This drive says whose it is, where it lives, and how much is in it, and nothing about being connected', async () => {
  const { page, shell } = await visit('garden');
  await page.keyboard.press('Control+\\');
  await shell.locator('.sec[data-sec="drive"]').waitFor();
  // A page that loaded is connected: no dot on the avatar to say so.
  assert.equal(await shell.locator('[data-act="me"] .live').count(), 0);
  await shell.locator('[data-act="me"]').click();
  const pop = shell.locator('.mepop');
  await pop.waitFor({ state: 'visible' });
  assert.equal(await pop.locator('.me-head b').textContent(), 'My Drive');
  assert.equal(await pop.locator('.host').textContent(), new URL(host.base).host);
  assert.doesNotMatch(await pop.innerText(), /Live|connected|Offline/);
  assert.match(await pop.locator('.weight').textContent(), /^\d+ documents · /);
  await page.context().close();
});

test('Trash at the foot of the tree opens the Drive on its trash, in place on the Drive', async () => {
  const { page, shell } = await visit('garden');
  await page.keyboard.press('Control+\\');
  await shell.locator('.foot .row').click();
  await page.waitForURL((url) => url.pathname === '/a/drive');
  // The address asked once and is put back as it was.
  await page.waitForFunction(() => !location.search);
  await page.locator('#nav .nav-item[data-nav="trash"].marble-current').waitFor({ state: 'attached' });
  await page.locator('#nav .nav-item[data-nav="drive"]').evaluate((el) => el.click());
  await page.locator('#nav .nav-item[data-nav="drive"].marble-current').waitFor({ state: 'attached' });
  // On the Drive it goes there without loading again.
  await page.evaluate(() => { window.stayed = true; });
  await shell.locator('.foot .row').click();
  await page.locator('#nav .nav-item[data-nav="trash"].marble-current').waitFor({ state: 'attached' });
  assert.equal(await page.evaluate(() => window.stayed), true);
  await page.context().close();
});
