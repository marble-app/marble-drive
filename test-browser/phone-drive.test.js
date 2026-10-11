// The Drive in a hand. Narrower than the shell's phone width the Drive draws
// its own frame, and on a phone that frame is one pane: a search bar, the
// listing as the one thing that scrolls, and the sidebar as a thumb bar at the
// sill. A tap opens; a held finger chooses, and moving on from the hold drags.
// Fields are 16px so iOS never zooms in on focus, every control is a 44px
// target, and the brief stands on the keyboard. 393 × 852 unless it says.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({
  agents: false,
  documents: {
    drive: await buildDrive(),
    garden: GARDEN,
    'A rather long document name that will not fit': GARDEN,
    'Papers/one': GARDEN,
    'Papers/deep/two': GARDEN,
  },
});
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };
const KB = 336;

async function openDrive(viewport = PHONE) {
  await host.reset();
  const { page, errors } = await host.newPage({ viewport, hasTouch: true, isMobile: true, shell: false });
  await page.goto(`${host.base}/a/drive`);
  await page.locator('#items .item[data-path="garden"]').waitFor();
  // The rows settle in; measure them once they have.
  await page.waitForTimeout(450);
  const cdp = await page.context().newCDPSession(page);
  return { page, errors: () => errors.filter((e) => !e.includes('sandboxed')), cdp };
}

const row = (page, path) => page.locator(`#items .item[data-path="${path}"]`);

/** A real finger, through the browser's own touch pipeline, so the page sees
 *  pointerType "touch" and the browser decides what is a scroll. */
const finger = (cdp) => ({
  down: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }),
  move: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }),
  up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
});

const centre = async (locator) => {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** The keyboard comes up: the visual viewport shrinks and slides. */
const raiseKeyboard = async (page, kb = KB, offsetTop = 0) => {
  await page.evaluate(({ kb: k, offsetTop: top }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - k - top, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: top, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  }, { kb, offsetTop });
  await page.waitForTimeout(150);
};

test('no field is under 16px, so focusing one never zooms the page', async () => {
  const { page, errors } = await openDrive();
  const sizes = await page.evaluate(() =>
    ['#q', '#ask', '#start-name', '#start-prompt'].map((sel) => [sel, parseFloat(getComputedStyle(document.querySelector(sel)).fontSize)]));
  for (const [sel, px] of sizes) assert.ok(px >= 16, `${sel} is ${px}px`);

  // A column heading is a word in the file you can rename, and while it is
  // being renamed it is a field like any other.
  await page.locator('[data-set-view="list"]').tap();
  const heading = page.locator('.listhead [data-marble-editable]').first();
  await heading.evaluate((el) => el.focus());
  assert.ok(parseFloat(await heading.evaluate((el) => getComputedStyle(el).fontSize)) >= 16);
  assert.deepEqual(errors(), []);
  await page.context().close();
});

test('the search asks for the right keyboard', async () => {
  const { page } = await openDrive();
  const q = await page.locator('#q').evaluate((el) => ({
    type: el.type, hint: el.getAttribute('enterkeyhint'), caps: el.getAttribute('autocapitalize'), spell: el.spellcheck,
  }));
  assert.deepEqual(q, { type: 'search', hint: 'search', caps: 'off', spell: false });
  assert.equal(await page.locator('#ask').getAttribute('enterkeyhint'), 'send');
  assert.equal(await page.locator('#start-name').getAttribute('enterkeyhint'), 'go');
  await page.context().close();
});

test('nothing runs off the side, at 393 or at 320, in any view', async () => {
  for (const viewport of [PHONE, { width: 320, height: 640 }]) {
    const { page } = await openDrive(viewport);
    for (const view of ['grid', 'list', 'timeline', 'weight']) {
      await page.locator(`[data-set-view="${view}"]`).tap();
      await page.waitForTimeout(250);
      const { page: wide, items } = await page.evaluate(() => {
        const el = document.querySelector('#items');
        return { page: document.documentElement.scrollWidth - innerWidth, items: el.scrollWidth - el.clientWidth };
      });
      assert.ok(wide <= 0, `${viewport.width} ${view}: the page is ${wide}px too wide`);
      assert.ok(items <= 1, `${viewport.width} ${view}: the listing scrolls sideways by ${items}px`);
    }
    await page.context().close();
  }
});

test('every control a thumb presses is at least 44px', async () => {
  const { page } = await openDrive();
  const small = await page.evaluate(() => {
    const sel = '.crumb, .chip, .toggle button, .item .more, .nav-item, #new, .mats-head, #q';
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.offsetParent)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { what: el.id || el.className, w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter(({ w, h }) => w < 44 || h < 44);
  });
  assert.deepEqual(small, []);

  // A row's menu: always there without a hover, and each of its rows a target.
  assert.ok(Number(await row(page, 'garden').locator('.more').evaluate((el) => getComputedStyle(el).opacity)) > 0.3);
  await row(page, 'garden').locator('.more').tap();
  await page.locator('#menu[data-open="1"]').waitFor();
  await page.waitForTimeout(250);
  const heights = await page.locator('#menu > button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  assert.ok(heights.every((h) => h >= 44), JSON.stringify(heights));
  // The keys a desk would press are not offered to a hand.
  assert.equal(await page.locator('#menu .key').first().isVisible(), false);
  await page.context().close();
});

test('the sidebar is a thumb bar at the sill, under the listing, and goes while typing', async () => {
  const { page } = await openDrive();
  const at = await page.evaluate(() => {
    const side = document.querySelector('.side').getBoundingClientRect();
    const items = document.querySelector('#items').getBoundingClientRect();
    return { side: { top: side.top, bottom: side.bottom, width: side.width }, items: { bottom: items.bottom }, h: innerHeight, w: innerWidth };
  });
  assert.equal(Math.round(at.side.bottom), at.h);
  assert.equal(Math.round(at.side.width), at.w);
  assert.ok(at.items.bottom <= at.side.top + 1, JSON.stringify(at));
  // Its places are words as well as glyphs, and a tap on one goes there.
  assert.equal(await page.locator('.side .nav-item[data-nav="recent"] [data-marble-editable]').isVisible(), true);
  await page.locator('.side .nav-item[data-nav="recent"]').tap();
  await page.locator('.side .nav-item[data-nav="recent"].marble-current').waitFor();
  // The tap went to the tab, not into its label.
  assert.notEqual(await page.evaluate(() => document.activeElement?.hasAttribute('data-marble-editable')), true);

  await page.locator('#q').tap();
  await raiseKeyboard(page);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-marble-keyboard'));
  assert.equal(await page.locator('.side').isVisible(), false);
  await page.context().close();
});

test('a tap on a folder goes into it; a tap on a document opens it', async () => {
  const { page } = await openDrive();
  await row(page, 'Papers').tap();
  await page.locator('#items .item[data-path="Papers/one"]').waitFor();
  assert.equal(new URL(page.url()).hash, '#/Papers');

  const [tab] = await Promise.all([
    page.context().waitForEvent('page'),
    row(page, 'Papers/one').tap(),
  ]);
  await tab.waitForLoadState('domcontentloaded');
  assert.match(decodeURIComponent(tab.url()), /Papers\/one/);
  await page.context().close();
});

test('a held finger picks the row and hangs its menu under it, and lifting opens nothing', async () => {
  const { page, cdp, errors } = await openDrive();
  const hand = finger(cdp);
  const at = await centre(row(page, 'garden').locator('.thumb'));
  let opened = false;
  page.context().on('page', () => { opened = true; });
  await hand.down(at.x, at.y);
  await page.waitForTimeout(650);
  await page.locator('#menu[data-open="1"]').waitFor();
  await hand.up();
  await page.waitForTimeout(300);
  assert.equal(opened, false);
  assert.equal(await page.locator('#menu').getAttribute('data-open'), '1');
  await row(page, 'garden').and(page.locator('.marble-picked')).waitFor();
  const labels = await page.locator('#menu > button').evaluateAll((els) => els.map((el) => el.firstChild.textContent.trim()));
  assert.ok(labels.includes('Rename…') && labels.includes('Move to trash'), labels.join());
  // Hung under the row, inside the screen.
  const menu = await page.locator('#menu').boundingBox();
  const box = await row(page, 'garden').boundingBox();
  assert.ok(menu.y >= box.y + box.height - 1 || menu.y + menu.height <= box.y + 1, JSON.stringify({ menu, box }));
  assert.ok(menu.x >= 0 && menu.x + menu.width <= PHONE.width && menu.y >= 0 && menu.y + menu.height <= PHONE.height);
  assert.deepEqual(errors(), []);
  await page.context().close();
});

test('a finger that moves at once scrolls; one that held first carries the row into a folder', async () => {
  const { page, cdp } = await openDrive();
  const hand = finger(cdp);

  // At once: no lift, no ghost, no move.
  const from = await centre(row(page, 'garden').locator('.thumb'));
  await hand.down(from.x, from.y);
  for (let i = 1; i <= 6; i++) await hand.move(from.x, from.y - i * 12);
  assert.equal(await page.locator('#ghost').getAttribute('data-open'), null);
  assert.equal(await row(page, 'garden').evaluate((el) => el.classList.contains('marble-lifting')), false);
  await hand.up();
  await page.waitForTimeout(200);

  // Held, then moved onto the folder.
  const start = await centre(row(page, 'garden').locator('.thumb'));
  const into = await centre(row(page, 'Papers').locator('.thumb'));
  await hand.down(start.x, start.y);
  await page.waitForTimeout(650);
  await page.locator('#menu[data-open="1"]').waitFor();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await hand.move(start.x + ((into.x - start.x) * i) / steps, start.y + ((into.y - start.y) * i) / steps);
  }
  assert.equal(await page.locator('#ghost').getAttribute('data-open'), '1');
  // Moving on from the hold answers the menu's question.
  assert.equal(await page.locator('#menu').getAttribute('data-open'), null);
  await hand.up();
  await page.waitForFunction(async () => (await window.marble.drive.tree('Papers')).children?.some((c) => c.path === 'Papers/garden'));
  await page.context().close();
});

test('New hangs its menu above the button in the thumb bar, and keeps the keyboard down', async () => {
  const { page } = await openDrive();
  await page.locator('#new').tap();
  await page.locator('#sheet[data-open="1"]').waitFor();
  await page.waitForTimeout(300);
  const sheet = await page.locator('#sheet').boundingBox();
  const button = await page.locator('#new').boundingBox();
  assert.ok(sheet.y + sheet.height <= button.y, JSON.stringify({ sheet, button }));
  assert.ok(sheet.y >= 0 && sheet.x >= 0 && sheet.x + sheet.width <= PHONE.width);
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'ask');
  // A phone has no desktop to drop a file from, so the menu offers the picker.
  assert.equal(await page.locator('#add-files').isVisible(), true);
  await page.context().close();
});

test('the brief is a sheet at the foot of the screen that stands on the keyboard', async () => {
  const { page } = await openDrive();
  await page.locator('#new').tap();
  await page.locator('#sheet[data-open="1"] .tcard').first().waitFor();
  await page.locator('#sheet .tcard').first().tap();
  await page.locator('#start[data-open="1"]').waitFor();
  await page.waitForTimeout(350);
  const rest = await page.locator('#start').boundingBox();
  assert.equal(Math.round(rest.y + rest.height), PHONE.height);
  assert.equal(Math.round(rest.width), PHONE.width);
  // Opened to read, not to type.
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'start-name');

  await page.locator('#start-name').tap();
  await raiseKeyboard(page);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-marble-keyboard'));
  await page.waitForTimeout(300);
  const up = await page.evaluate(() => {
    const r = document.querySelector('#start').getBoundingClientRect();
    const go = document.querySelector('#start-go').getBoundingClientRect();
    const name = document.querySelector('#start-name').getBoundingClientRect();
    const vv = window.visualViewport;
    return { bottom: r.bottom, top: r.top, go: go.bottom, name: name.top, seen: vv.offsetTop + vv.height };
  });
  assert.ok(Math.abs(up.bottom - (PHONE.height - KB)) <= 1, JSON.stringify(up));
  assert.ok(up.top >= 0 && up.go <= up.seen && up.name >= 0, JSON.stringify(up));
  await page.context().close();
});
