// The Console in a hand: an iPhone-sized screen (393 × 852) with a touch
// pointer, against the fake fleet. The views are a strip of tabs under the
// drive's corner, every field is big enough that focusing it does not zoom
// the page, everything pressed is 44px to the finger, a task with fields is a
// sheet standing on the keyboard while a plan stays under its button, the
// bar of changes stands on the keys, a chart's tip stays after the finger
// lifts, and nothing on any view runs off the side at 320.

import assert from 'node:assert/strict';
import test from 'node:test';

import { consoleWorld } from './console-world.js';

const world = await consoleWorld();
test.after(() => world.host.close());

const PHONE = { width: 393, height: 852, hasTouch: true, isMobile: true };
const KB = 336;

/** A keyboard the browser answers by shrinking what can be seen, sliding it
 *  `slid` px down the layout; runtime/phone.js reads it as the page would. */
const raiseKeyboard = async (page, slid = 0) => {
  await page.evaluate(({ kb, top }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - kb, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: top, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  }, { kb: KB, top: slid });
  await page.waitForTimeout(150);
};
const visible = (page) => page.evaluate(() => ({ top: Math.round(visualViewport.offsetTop), bottom: Math.round(visualViewport.offsetTop + visualViewport.height) }));
const box = async (page, selector) => {
  const r = await page.locator(selector).first().boundingBox();
  return r && { top: Math.round(r.y), bottom: Math.round(r.y + r.height), left: Math.round(r.x), right: Math.round(r.x + r.width), height: r.height, width: r.width };
};

/** What a finger can hit: the box, grown by an ::after margin where there is one. */
const smallTargets = (page, scope) => page.evaluate((sel) => {
  const out = [];
  for (const el of document.querySelectorAll(`${sel} :is(button, a.btn, a.link, select, input)`)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden' || el.closest('[hidden]')) continue;
    const a = getComputedStyle(el, '::after');
    const grown = a.content !== 'none' && a.position === 'absolute';
    const dy = grown ? Math.max(0, -parseFloat(a.top) || 0) : 0;
    const dx = grown ? Math.max(0, -parseFloat(a.left) || 0) : 0;
    if (r.height + 2 * dy < 43.5 || r.width + 2 * dx < 43.5) out.push(`${el.tagName.toLowerCase()} “${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}” ${Math.round(r.width + 2 * dx)}×${Math.round(r.height + 2 * dy)}`);
  }
  return out;
}, scope);

const openDrive = async (page, name) => {
  await page.tap(`.row[data-name="${name}"]`);
  await page.waitForFunction(() => document.querySelector('.cx-view[data-view="drives"] .well').hasAttribute('data-open'));
  await page.waitForTimeout(650);
};

test('the views are a strip of 44px tabs under the corner, and the one picked is scrolled into it', async () => {
  const { page, errors } = await world.open({ ...PHONE, view: 'dashboard' });
  const strip = await box(page, '.cx-bar > .seg');
  // The drive's pill (runtime/shell.js) stands at the top-left corner, 12px
  // in and 32px tall, on a screen with no hover: the tabs start below it.
  assert.ok(strip.top >= 44, `the tabs start at ${strip.top}, under the shell's pill`);
  assert.ok(strip.right <= 393 && strip.left >= 0, 'the strip is the screen\'s width');
  const tabs = await page.$$eval('.cx-bar > .seg button', (els) => els.map((b) => Math.round(b.getBoundingClientRect().height)));
  assert.equal(tabs.length, 7);
  assert.ok(tabs.every((hgt) => hgt >= 44), `tab heights ${tabs}`);
  // Picked from code, so nothing scrolls it but the page.
  await page.evaluate(() => document.querySelector('.cx-bar .seg [data-view="activity"]').click());
  await page.waitForTimeout(600);
  const on = await box(page, '.cx-bar .seg [data-view="activity"]');
  assert.ok(on.left >= 0 && on.right <= 393, `Activity's tab is at ${on.left}–${on.right}, inside the screen`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('every field is 16px, so focusing one does not zoom the page', async () => {
  const { page, errors } = await world.open({ ...PHONE });
  await openDrive(page, 't-sam');
  const settings = await page.$$eval('.cx-view[data-view="drives"] .pane.detail input', (els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
  assert.ok(settings.length >= 7);
  assert.ok(settings.every((px) => px >= 16), `settings fields at ${settings}`);
  assert.equal(await page.getAttribute('input[data-key="set:t-sam:MARBLE_DRIVE_AWAKE_MAX_HOURS"]', 'enterkeyhint'), 'done');
  await page.tap('.cx-bar .seg [data-view="drives"]');
  await page.tap('.cx-view[data-view="drives"] .d-head .back');
  await page.waitForFunction(() => !document.querySelector('.cx-view[data-view="drives"] .well').hasAttribute('data-open'));
  await page.tap('.cx-primary .btn');
  await page.waitForSelector('.pop:popover-open input');
  const sheet = await page.$$eval('.pop:popover-open :is(input, select, textarea)', (els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
  assert.ok(sheet.every((px) => px >= 16), `the new drive's fields at ${sheet}`);
  assert.equal(await page.getAttribute('.pop:popover-open input[type="text"]', 'enterkeyhint'), 'go');
  assert.deepEqual(errors, []);
  await page.close();
});

test('everything pressed in a drive is 44px to the finger', async () => {
  const { page, errors } = await world.open({ ...PHONE });
  await openDrive(page, 't-sam');
  assert.deepEqual(await smallTargets(page, '.cx-view[data-view="drives"] .pane.detail'), []);
  assert.deepEqual(await smallTargets(page, '.cx-bar'), []);
  // A pill keeps its look: it grows a margin, not a fatter border.
  const deploy = await box(page, '.detail button:text("Deploy main")');
  assert.ok(deploy.height < 44, `Deploy main is drawn ${deploy.height}px tall`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a restore asks for the name in a sheet that stands on the keyboard', async () => {
  const { page, errors } = await world.open({ ...PHONE });
  await openDrive(page, 't-sangho');
  await page.waitForSelector('.detail button:text("Restore")');
  await page.tap('.detail button:text("Restore")');
  await page.waitForSelector('.pop[data-sheet]:popover-open input');
  const input = page.locator('.pop:popover-open input');
  assert.equal(await input.evaluate((el) => el === document.activeElement), true, 'the field has the keys');
  assert.equal(await input.getAttribute('autocapitalize'), 'none');
  await raiseKeyboard(page);
  const seen = await visible(page);
  const sheet = await box(page, '.pop:popover-open');
  assert.ok(Math.abs(sheet.bottom - seen.bottom) <= 2, `the sheet ends at ${sheet.bottom}, the keys start at ${seen.bottom}`);
  assert.ok(sheet.left === 0 && sheet.right === 393, 'edge to edge');
  const field = await box(page, '.pop:popover-open input');
  const go = await box(page, '.pop:popover-open .btn.danger');
  assert.ok(field.top >= seen.top && field.bottom <= seen.bottom, 'the field is in sight');
  assert.ok(go.bottom <= seen.bottom && go.height >= 44, 'and so is the button that acts, full height');
  // iOS slides the page up the rest of the way; the sheet stays on the keys.
  await raiseKeyboard(page, 120);
  const slid = await visible(page);
  const after = await box(page, '.pop:popover-open');
  assert.ok(Math.abs(after.bottom - slid.bottom) <= 2, `slid: the sheet ends at ${after.bottom}, the keys start at ${slid.bottom}`);
  await input.fill('t-sangho');
  assert.equal(await page.locator('.pop:popover-open .btn.danger').isDisabled(), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a deploy\'s plan stays a popover under its button, inside the screen', async () => {
  const { page, errors } = await world.open({ ...PHONE });
  await openDrive(page, 't-peiling');
  await page.tap('.detail button:text("Deploy main")');
  await page.waitForSelector('.pop:popover-open .btn.primary:not([disabled])');
  assert.equal(await page.getAttribute('.pop:popover-open', 'data-sheet'), null, 'no sheet for a question with no field');
  const pop = await box(page, '.pop:popover-open');
  const button = await box(page, '.detail button:text("Deploy main")');
  assert.ok(pop.left >= 12 && pop.right <= 393 - 12, `the popover spans ${pop.left}–${pop.right}`);
  assert.ok(pop.top >= button.bottom || pop.bottom <= button.top, 'beside its button, not over it');
  assert.ok(pop.bottom <= 852 && pop.top >= 0, 'and on the screen');
  assert.deepEqual(errors, []);
  await page.close();
});

test('with the keys up in a setting, the bar of changes stands on them', async () => {
  const { page, errors } = await world.open({ ...PHONE });
  await openDrive(page, 't-sam');
  const field = 'input[data-key="set:t-sam:MARBLE_DRIVE_ASK_HOLD_MINUTES"]';
  await page.tap(field);
  await page.fill(field, '7');
  await page.waitForSelector('.pending');
  // The bar rises into place; measure it once it has.
  await page.waitForTimeout(400);
  await raiseKeyboard(page);
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-marble-keyboard')), true);
  const seen = await visible(page);
  const bar = await box(page, '.pending');
  assert.ok(bar.bottom <= seen.bottom + 1 && bar.bottom >= seen.bottom - 2, `the bar ends at ${bar.bottom}, the keys start at ${seen.bottom}`);
  const apply = await box(page, '.pending .btn.primary');
  assert.ok(apply.bottom <= seen.bottom, 'Apply is above the keys');
  // The strip of views steps aside while typing; the frame starts where the screen does.
  assert.equal(await page.locator('.cx-bar > .seg').isVisible(), false);
  const frame = await box(page, '.cx');
  assert.ok(frame.top >= seen.top - 1, 'the frame\'s top is on the screen');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a chart\'s tip stays after the finger lifts, and goes with the next touch elsewhere', async () => {
  const { page, errors } = await world.open({ ...PHONE, view: 'dashboard' });
  await page.waitForSelector('[data-card="cost"] .chart.hbars');
  const chart = await box(page, '[data-card="cost"] .chart.hbars');
  await page.touchscreen.tap(chart.left + chart.width * 0.45, chart.top + 12);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.querySelector('.cx-tip')?.matches(':popover-open') ?? false), true, 'the tip is up after the lift');
  const tip = await box(page, '.cx-tip');
  assert.ok(tip.bottom <= chart.top + 12, 'above the finger, not under it');
  await page.tap('[data-card="cost"] .card-head h2');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.querySelector('.cx-tip').matches(':popover-open')), false, 'a touch elsewhere puts it away');
  assert.deepEqual(errors, []);
  await page.close();
});

test('at 320, no view runs off the side, and the drives table stacks with its actions in reach', async () => {
  const { page, errors } = await world.open({ ...PHONE, width: 320, height: 640, view: 'dashboard' });
  await page.waitForSelector('[data-card="cost"] .chart');
  // A chart's numbers as a table scroll in their card, never the page.
  await page.tap('[data-card="heat"] .card-head button:text("Table")');
  await page.waitForSelector('[data-card="heat"] .table-scroll table');
  const off = {};
  for (const view of ['dashboard', 'drives', 'backups', 'ship', 'features', 'workshop', 'activity']) {
    await page.evaluate((v) => document.querySelector(`.cx-bar .seg [data-view="${v}"]`).click(), view);
    await page.waitForTimeout(700);
    off[view] = await page.evaluate((v) => {
      const scroller = document.querySelector(`.cx-view[data-view="${v}"] :is(.page, .pane-scroll)`);
      return [document.documentElement.scrollWidth - innerWidth, scroller ? scroller.scrollWidth - scroller.clientWidth : 0];
    }, view);
  }
  for (const [view, [doc, inner]] of Object.entries(off)) {
    assert.ok(doc <= 0, `${view}: the page is ${doc}px wider than the screen`);
    assert.ok(inner <= 1, `${view}: its scroller is ${inner}px wider than itself`);
  }
  await page.evaluate(() => document.querySelector('.cx-bar .seg [data-view="ship"]').click());
  await page.waitForSelector('.cx-view[data-view="ship"] .table tbody tr');
  const rows = await page.$$eval('.cx-view[data-view="ship"] .table tbody tr', (trs) => trs.map((tr) => {
    const acts = [...tr.querySelectorAll('.acts .btn')].map((b) => b.getBoundingClientRect());
    return { right: Math.max(...acts.map((r) => r.right)), against: tr.children[2].getBoundingClientRect().width > 0 };
  }));
  assert.ok(rows.length >= 6);
  assert.ok(rows.every((r) => r.right <= 320), 'Deploy and Roll back are on the screen in every row');
  assert.ok(rows.every((r) => r.against), 'where each drive stands against main is shown');
  assert.deepEqual(errors, []);
  await page.close();
});
