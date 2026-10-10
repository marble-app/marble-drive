// The shell in a hand. On a phone there is no frame to open, so nothing of it
// may sit over the app: the pill that opens it on a desk used to cover every
// app's top-left corner (the Drive's own logo, Agents' back button) and did
// nothing when pressed. What can still open there, a task with a field in it,
// is a sheet that stands on the keyboard. On a touch screen wide enough for
// the frame (a tablet, a phone on its side), every press is 44 square, a field
// never makes iOS zoom, a held row opens its menu under it, and a popover is
// measured against the part of the screen the keyboard leaves.
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({
  documents: { drive: await buildDrive(), garden: GARDEN, 'Research/notes': GARDEN },
});
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };
const TABLET = { width: 1024, height: 768 };
const KB = 336;

async function visit(path, viewport = PHONE) {
  const { page, errors } = await host.newPage({ viewport, hasTouch: true, isMobile: true });
  await page.goto(`${host.base}/a/${path.split('/').map(encodeURIComponent).join('/')}`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.shadowRoot && window.marblePhone);
  return { page, errors, shell: page.locator('marble-shell') };
}

/** The keyboard as iOS raises it: the visible strip shrinks by `kb`, and has
 *  slid `offsetTop` down the page to keep the caret in it. */
const raiseKeyboard = async (page, kb = KB, offsetTop = 0) => {
  await page.evaluate(({ kb: k, offsetTop: top }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - k, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: top, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  }, { kb, offsetTop });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-marble-keyboard'));
  await page.waitForTimeout(150);
};

const box = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
});
const fontSize = (locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const quiet = (errors) => errors.filter((e) => !/favicon|sandboxed/.test(e));

/** Whether a press this far from a control's middle still lands on it. */
const reaches = (locator, dx, dy) => locator.evaluate((el, [x, y]) => {
  const r = el.getBoundingClientRect();
  const hit = el.getRootNode().elementFromPoint(r.left + r.width / 2 + x, r.top + r.height / 2 + y);
  return Boolean(hit && (hit === el || el.contains(hit)));
}, [dx, dy]);

test('on a phone nothing of the shell covers the app: no pill in the corner, and the page is the page', async () => {
  for (const path of ['garden', 'drive']) {
    const { page, shell, errors } = await visit(path);
    await page.waitForTimeout(300);
    assert.equal(await shell.locator('.pill').isVisible(), false, `${path}: the pill is drawn`);
    const corner = await page.evaluate(() => document.elementFromPoint(30, 28)?.localName);
    assert.notEqual(corner, 'marble-shell', `${path}: the shell takes presses in the top-left corner`);
    assert.equal(await noSideways(page), true, `${path}: the page scrolls sideways`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marble-shell-corner-w')), '', `${path}: a corner is kept for a pill that is not there`);
    assert.deepEqual(quiet(errors), []);
    await page.context().close();
  }
});

test('on a phone at 320px nothing of the shell pushes the page sideways', async () => {
  const { page } = await visit('garden', { width: 320, height: 640 });
  await page.evaluate(() => document.querySelector('marble-shell').say('Moved to a folder with a long name that goes on'));
  const toast = await box(page.locator('marble-shell').locator('.toast'));
  assert.ok(toast.left >= 0 && toast.right <= 320, JSON.stringify(toast));
  assert.equal(await noSideways(page), true);
  await page.context().close();
});

test('on a phone a task with a field is a sheet that stands on the keyboard, in type that does not zoom', async () => {
  const { page, shell } = await visit('garden');
  await page.evaluate(() => document.querySelector('marble-shell').openMove());
  const sheet = shell.locator('.moving');
  await sheet.waitFor({ state: 'visible' });
  assert.equal(await sheet.evaluate((el) => el.hasAttribute('data-sheet')), true);
  const name = sheet.locator('.name');
  assert.equal(await shell.evaluate((el) => el.shadowRoot.activeElement?.className), 'name');
  assert.ok(await fontSize(name) >= 16, 'the name field would zoom the page');
  assert.ok(await fontSize(sheet.locator('.find')) >= 16, 'the folder search would zoom the page');
  assert.equal(await name.getAttribute('enterkeyhint'), 'done');
  await page.waitForTimeout(250);
  let r = await box(sheet);
  assert.ok(r.left === 0 && r.width === PHONE.width, `the sheet is not the screen's width: ${JSON.stringify(r)}`);
  assert.ok(Math.abs(r.bottom - PHONE.height) <= 1, `the sheet stops at ${r.bottom}, not the foot of the screen`);

  // The keys come up under it, the layout viewport left where it was.
  await raiseKeyboard(page, KB, 0);
  r = await box(sheet);
  assert.ok(Math.abs(r.bottom - (PHONE.height - KB)) <= 1, `the sheet ends at ${r.bottom}, not on a keyboard at ${PHONE.height - KB}`);
  assert.ok(r.top >= 0, `the sheet runs off the top: ${r.top}`);
  // And its primary action is on the screen above the keys.
  const ok = await box(sheet.locator('.ok'));
  assert.ok(ok.bottom <= PHONE.height - KB && ok.height >= 44, JSON.stringify(ok));
  await page.context().close();
});

test('on a touch screen the frame opens from a pill a finger can press, and every press in the bar is 44 square', async () => {
  const { page, shell } = await visit('garden', TABLET);
  const pill = shell.locator('.pill');
  await pill.waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  const p = await box(pill);
  assert.ok(p.height >= 44 && p.width >= 44 && p.width <= 48, `the pill is not one press wide: ${JSON.stringify(p)}`);
  assert.equal(await pill.locator('kbd').isVisible(), false, 'a key is named to a hand with no keys');
  assert.equal(await pill.locator('b').isVisible(), false, 'the pill spells out the name the page already shows');
  // The corner it keeps is published for the app's own bar to keep clear of.
  const corner = () => page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return [s.getPropertyValue('--marble-shell-corner-w'), s.getPropertyValue('--marble-shell-corner-h')].map((v) => v.trim());
  });
  assert.deepEqual(await corner(), [`${p.right}px`, `${p.bottom}px`]);
  assert.notEqual(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.localName, [p.right + 4, p.top + 10]), 'marble-shell', 'the pill takes presses past its edge');
  await pill.tap();
  await page.waitForFunction(() => document.querySelector('marble-shell').hasAttribute('data-open'));
  assert.deepEqual(await corner(), ['', ''], 'the corner is still kept with the pill put away');
  await page.waitForTimeout(450);
  for (const sel of ['[data-act="nav"]', '[data-act="share"]', '[data-act="settings"]', '[data-act="me"]', '[data-act="close"]', '.home', '.new']) {
    const el = shell.locator(`.bar ${sel}`);
    for (const [dx, dy] of [[0, -20], [0, 20]]) {
      assert.equal(await reaches(el, dx, dy), true, `${sel} misses a press ${dy}px from its middle`);
    }
    if (!sel.startsWith('[data-act="share"]') && sel !== '.new') {
      for (const [dx, dy] of [[-19, 0], [19, 0]]) assert.equal(await reaches(el, dx, dy), true, `${sel} misses a press ${dx}px from its middle`);
    }
  }
  // The tree: a field that does not zoom, with the right key, and rows to land on.
  const search = shell.locator('.nav .search input');
  assert.ok(await fontSize(search) >= 16);
  assert.equal(await search.getAttribute('enterkeyhint'), 'go');
  assert.equal(await search.getAttribute('type'), 'search');
  await shell.locator('.nav .row').first().waitFor();
  const rows = await shell.locator('.nav .scroll .row').evaluateAll((els) => els.filter((el) => el.offsetParent).map((el) => Math.round(el.getBoundingClientRect().height)));
  assert.ok(rows.length && rows.every((ht) => ht >= 44), `rows a finger can miss: ${rows.join(' ')}`);
  assert.equal(await noSideways(page), true);
  await page.context().close();
});

test('on a touch screen New stays under its button, and a keyboard shortens it to what can be seen', async () => {
  const { page, shell } = await visit('garden', TABLET);
  await shell.locator('.pill').tap();
  await page.waitForFunction(() => document.querySelector('marble-shell').hasAttribute('data-open'));
  await shell.locator('.bar .new').tap();
  const pop = shell.locator('.making');
  await pop.waitFor({ state: 'visible' });
  await pop.locator('.tpl').first().waitFor();
  const button = await box(shell.locator('.bar .new'));
  let r = await box(pop);
  assert.equal(await pop.evaluate((el) => el.hasAttribute('data-sheet')), false, 'a menu became a sheet');
  assert.ok(r.top >= button.bottom && r.top - button.bottom <= 10, `New is not under its button: ${JSON.stringify(r)}`);
  const ask = pop.locator('.ask textarea');
  assert.ok(await fontSize(ask) >= 16);
  assert.equal(await ask.getAttribute('enterkeyhint'), 'send');

  // A tall keyboard on a short screen: the popover ends above it and scrolls.
  await raiseKeyboard(page, 420, 0);
  r = await box(pop);
  assert.ok(r.bottom <= TABLET.height - 420, `New runs under the keyboard: ends at ${r.bottom}, keys from ${TABLET.height - 420}`);
  assert.equal(await pop.evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY), 'auto');
  // What is said at the foot of the screen is said above the keys.
  await page.evaluate(() => document.querySelector('marble-shell').say('Link copied'));
  await page.waitForTimeout(200);
  const toast = await box(shell.locator('.toast'));
  assert.ok(toast.bottom <= TABLET.height - 420, `the toast is under the keyboard: ${JSON.stringify(toast)}`);
  await page.context().close();
});

test('a held finger on a row opens its menu under the row, once, and the next press is a press', async () => {
  const { page, shell } = await visit('garden', TABLET);
  await shell.locator('.pill').tap();
  await page.waitForFunction(() => document.querySelector('marble-shell').hasAttribute('data-open'));
  const row = shell.locator('.nav .scroll a.row[data-path="garden"]').first();
  await row.waitFor();
  await page.waitForTimeout(400);
  const at = await box(row);
  const cdp = await page.context().newCDPSession(page);
  const point = { x: at.left + 40, y: at.top + at.height / 2 };
  let opened = 0;
  await page.exposeFunction('menuOpened', () => { opened += 1; });
  await page.evaluate(() => {
    const menu = document.querySelector('marble-shell').shadowRoot.querySelector('.menu');
    new MutationObserver(() => { if (!menu.hidden) window.menuOpened(); }).observe(menu, { attributes: true, attributeFilter: ['hidden'] });
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(800);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const menu = shell.locator('.menu');
  await menu.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  assert.equal(opened, 1, `the hold opened the menu ${opened} times`);
  const m = await box(menu);
  assert.ok(m.top >= at.bottom, `the menu covers the row under the finger: menu ${m.top}, row ${at.bottom}`);
  assert.ok(await page.evaluate(() => location.pathname.endsWith('/garden')), 'lifting the finger opened the row');
  const items = await menu.locator('button').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  assert.ok(items.every((ht) => ht >= 44), `menu items a finger can miss: ${items.join(' ')}`);

  // Put away, and the next press on a folder unfolds it.
  await page.touchscreen.tap(5, TABLET.height - 5);
  await menu.waitFor({ state: 'hidden' });
  const folder = shell.locator('.nav .scroll button.row[data-folder="Research"]').first();
  const was = await folder.getAttribute('aria-expanded');
  await folder.tap();
  await page.waitForFunction((before) => document.querySelector('marble-shell').shadowRoot
    .querySelector('.nav .scroll button.row[data-folder="Research"]')?.getAttribute('aria-expanded') !== before, was);
  await page.context().close();
});
