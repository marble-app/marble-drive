// The overlays every document gets, in a hand (iPhone-sized, touch): the
// line that asks for a change, the callout's handle on a selection, the
// notes' pins and count, Build mode's thread. On a phone the line and the
// thread are sheets standing on the keyboard, every field is 16px so iOS
// does not zoom in on focus, and every target is 44px to land on.

import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

// Long enough that the last rows sit in the lower half of a phone's screen,
// where the keyboard comes up.
const LIST = `<!doctype html>
<html><head><meta charset="utf-8"><title>Reading list</title>
<style>
  body { font: 16px/1.5 Georgia, serif; margin: 20px; }
  li { display: flex; justify-content: space-between; padding: 6px 0; }
  .spacer { height: 420px; }
</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Reading list</h1>
  <p data-marble-id="p">Local-first apps keep your data on your machine and sync when they can.</p>
  <div class="spacer" data-marble-id="sp"></div>
  <ul data-marble-id="list">
    <li data-marble-id="r1"><span data-marble-id="r1n">Malleable software</span><span data-marble-id="r1s">Unread</span></li>
    <li data-marble-id="r2"><span data-marble-id="r2n">Local-first</span><span data-marble-id="r2s">Unread</span></li>
    <li data-marble-id="r3"><span data-marble-id="r3n">Dynamicland</span><span data-marble-id="r3s">Read</span></li>
  </ul>
  <div class="spacer" data-marble-id="sp2" style="height: 900px"></div>
</body></html>
`;

const APP = `<!doctype html>
<html><head><meta charset="utf-8"><title>Reviews</title>
<style>body { font: 14px/1.5 system-ui, sans-serif; margin: 0; } main { padding: 20px; } .card { border: 1px solid #e6e2d8; border-radius: 12px; padding: 12px; margin: 12px 0; }</style></head>
<body data-marble-id="b"><main data-marble-id="m">
  <h1 data-marble-id="h">Reviews</h1>
  <section class="card" data-marble-id="s1"><h2 data-marble-id="s1h">Invitations</h2><p data-marble-id="s1p">Five of them.</p></section>
  <section class="card" data-marble-id="s2"><h2 data-marble-id="s2h">This week</h2><p data-marble-id="s2p">Tue 6 · answer</p></section>
</main></body></html>
`;

const host = await startDrive({ scripts: {}, documents: { list: LIST, Reviews: APP } });
test.after(() => host.close());

const pages = [];
const closePages = async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); };
test.after(closePages);

const PHONE = { width: 393, height: 852 };
const KB = 336;

const open = async ({ viewport = PHONE, doc = 'list', build = false } = {}) => {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport, hasTouch: true, isMobile: true, build });
  pages.push(page);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleLine && window.marblePhone));
  page.errors = errors;
  return page;
};

/** What the browser does when a field takes the caret on iOS: the visual
 *  viewport shrinks by the keyboard (agents-phone-keyboard.test.js). */
const raiseKeyboard = async (page, kb = KB, offsetTop = 0) => {
  await page.evaluate(({ kb: k, offsetTop: top }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - k, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: top, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  }, { kb, offsetTop });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-marble-keyboard'));
  await page.waitForTimeout(120);
};

const line = (page) => page.locator('.marble-line:not([data-state="sent"]):not([data-leaving])');
const settled = (page) => page.evaluate(() => Promise.all([...document.querySelectorAll('.marble-line')].flatMap((el) => el.getAnimations().map((a) => a.finished.catch(() => {})))));
const rectOf = (page, selector) => page.evaluate((sel) => {
  const r = document.querySelector(sel)?.getBoundingClientRect();
  return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null;
}, selector);
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/** Whether a press `dx`,`dy` off an element's middle still lands on it. */
const lands = (page, selector, dx, dy) => page.evaluate(({ sel, dx: x, dy: y }) => {
  const el = document.querySelector(sel);
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2 + x, r.top + r.height / 2 + y);
  return Boolean(hit && (hit === el || el.contains(hit)));
}, { sel: selector, dx, dy });

test('on a phone the line is a sheet at the foot, edge to edge, with a 16px field whose return key says Send', async () => {
  const page = await open();
  await page.evaluate(() => window.marbleLine.open({ ids: ['r3'], from: 'key' }));
  await line(page).waitFor();
  await settled(page);
  assert.equal(await line(page).getAttribute('data-dock'), '');
  const r = await rectOf(page, '.marble-line:not([data-leaving])');
  const vw = await page.evaluate(() => innerWidth);
  const vh = await page.evaluate(() => innerHeight);
  assert.ok(Math.abs(r.left) <= 1 && Math.abs(r.right - vw) <= 1, `edge to edge: ${JSON.stringify(r)}`);
  assert.ok(Math.abs(r.bottom - vh) <= 1, `at the foot: ${r.bottom} of ${vh}`);
  const field = page.locator('.marble-line .marble-line-input');
  const size = await field.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  assert.ok(size >= 16, `the field is ${size}px; under 16 iOS zooms in on focus`);
  assert.equal(await field.getAttribute('enterkeyhint'), 'send');
  // Every chip under the words is a fingertip tall.
  const chips = await page.locator('.marble-line-chip:not([hidden])').evaluateAll((list) => list.map((c) => c.getBoundingClientRect().height));
  for (const h of chips) assert.ok(h >= 44, `a chip ${h}px tall`);
  assert.ok(await noSideways(page), 'nothing runs off the side');
  assert.deepEqual(page.errors, []);
});

test('with the keyboard up the line stands on it, and the row it is about is scrolled clear of it', async () => {
  const page = await open();
  await page.evaluate(() => window.marbleLine.open({ ids: ['r3'], from: 'key' }));
  await line(page).waitFor();
  await settled(page);
  await page.locator('.marble-line .marble-line-input').focus();
  await raiseKeyboard(page);
  const seen = await page.evaluate(() => {
    const vv = window.visualViewport;
    const sheet = document.querySelector('.marble-line:not([data-leaving])').getBoundingClientRect();
    return { foot: vv.offsetTop + vv.height, top: sheet.top, bottom: sheet.bottom };
  });
  assert.ok(Math.abs(seen.bottom - seen.foot) <= 1, `the sheet ends at ${seen.bottom}; the keys start at ${seen.foot}`);
  // The row was under the keys; once they settle the page brings it up.
  await page.waitForFunction(() => {
    const row = document.querySelector('[data-marble-id="r3"]').getBoundingClientRect();
    const sheet = document.querySelector('.marble-line:not([data-leaving])').getBoundingClientRect();
    return row.bottom <= sheet.top && row.top >= 0;
  }, null, { timeout: 3000 });
});

test('at 320px wide the sheet and its chips fit, and nothing scrolls sideways', async () => {
  const page = await open({ viewport: { width: 320, height: 640 } });
  await page.evaluate(() => window.marbleLine.open({ ids: ['p'], from: 'key' }));
  await line(page).waitFor();
  await settled(page);
  const r = await rectOf(page, '.marble-line:not([data-leaving])');
  assert.ok(r.left >= -1 && r.right <= 321, JSON.stringify(r));
  const chips = await page.locator('.marble-line-chip:not([hidden])').evaluateAll((list) => list.map((c) => c.closest('.marble-line-acts') ?? c).map((c) => c.getBoundingClientRect().right));
  for (const right of chips) assert.ok(right <= 321, `a chip ends at ${right}`);
  // The actions keep their words, on a row a thumb slides along, rather
  // than being cut to a letter.
  const cut = await page.locator('.marble-line-acts .marble-line-chip:not([hidden]) > span').evaluateAll((list) => list.filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent));
  assert.deepEqual(cut, []);
  assert.ok(await noSideways(page));
});

test('a selection made by a long press brings the handle, which a fingertip can land on', async () => {
  const page = await open();
  // A long press on a touch screen ends in a cancel, not an up: the browser
  // takes the touch for its own selection.
  await page.evaluate(() => {
    const target = document.querySelector('[data-marble-id="p"]');
    const r = target.getBoundingClientRect();
    const at = { clientX: r.left + 20, clientY: r.top + 8, pointerType: 'touch', bubbles: true, composed: true, isPrimary: true, pointerId: 7 };
    target.dispatchEvent(new PointerEvent('pointerdown', at));
    const range = document.createRange();
    range.selectNodeContents(target);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    target.dispatchEvent(new PointerEvent('pointercancel', at));
  });
  const handle = page.locator('.marble-callout-handle:not([hidden])');
  await handle.waitFor({ timeout: 3000 });
  await page.waitForTimeout(300); // it grows in from its corner
  assert.ok(await lands(page, '.marble-callout-handle', 0, 20), 'a press 20px under the bubble still lands on it');
  assert.ok(await lands(page, '.marble-callout-handle', 20, 0), 'a press 20px beside the bubble still lands on it');
  await handle.tap();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
});

test('Point at something says Tap, and Cancel is how a finger leaves it', async () => {
  const page = await open();
  // The tray's row turns pointing on: the row is asked for again, and pressed.
  await page.evaluate(() => {
    let point = null;
    const take = (event) => { if (event.detail?.id === 'point') point = event.detail; };
    addEventListener('marble-tray:register', take);
    dispatchEvent(new CustomEvent('marble-tray:ready'));
    removeEventListener('marble-tray:register', take);
    point.onSelect();
  });
  const latch = page.locator('.marble-callout-latch:not([hidden])');
  await latch.waitFor();
  assert.equal(await latch.locator('.for-touch').isVisible(), true);
  assert.equal(await latch.locator('.for-keys').isVisible(), false);
  assert.equal(await latch.locator('kbd').isVisible(), false);
  const cancel = latch.locator('.marble-callout-unlatch');
  const box = await cancel.boundingBox();
  assert.ok(box.height >= 44, `Cancel is ${box.height}px tall`);
  await cancel.tap();
  assert.equal(await page.locator('.marble-callout-latch:not([hidden])').count(), 0, 'Cancel ends pointing');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('marble-callout-latched')), false);
});

test('a note\'s pin and the notes count are fingertip targets, and the count steps aside for the keys', async () => {
  const page = await open();
  await page.evaluate(() => window.marbleNotes.add({ ids: ['r1'], text: 'Check the year', name: 'Row' }));
  await page.locator('.marble-note-pin:not([hidden])').waitFor();
  await page.waitForTimeout(300); // it grows in
  assert.ok(await lands(page, '.marble-note-pin', 0, 20), 'a press 20px under the pin lands on it');
  assert.ok(await lands(page, '.marble-note-pin', -20, 0), 'a press 20px beside the pin lands on it');
  const count = page.locator('.marble-notes-count');
  await count.waitFor();
  assert.ok((await count.boundingBox()).height >= 44);
  // A tap opens the note's card first, a finger having no hover.
  await page.locator('.marble-note-pin').tap();
  await page.locator('.marble-note-card:not([hidden])').waitFor();
  const acts = await page.locator('.marble-note-card-acts button').evaluateAll((list) => list.map((b) => b.getBoundingClientRect().height));
  for (const h of acts) assert.ok(h >= 44, `a note action ${h}px tall`);
  // The keys come up for a field on the page: the count goes.
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.setAttribute('data-marble-transient', '');
    field.style.cssText = 'position:fixed;top:10px;left:10px;font-size:16px';
    document.body.append(field);
    field.focus();
  });
  await raiseKeyboard(page);
  assert.equal(await count.isVisible(), false);
});

test('Build mode: a thread is a sheet on the keyboard, its reply box at 16px, its buttons a fingertip tall', async () => {
  const marks = (await (await fetch(`${host.base}/agent/builds?path=Reviews`)).json()).marks ?? [];
  if (marks.length) await fetch(`${host.base}/agent/builds/marks?path=Reviews`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: marks.map((m) => m.id) }) });
  await fetch(`${host.base}/agent/builds/marks?path=Reviews`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mark: { id: 'mc1', type: 'comment', anchorId: 's2', u: 0.5, v: 0.2, at: Date.now(), thread: [{ who: 'you', text: 'Can this show two weeks?' }] } }),
  });
  const page = await open({ doc: 'Reviews', build: true });
  await page.waitForFunction(() => Boolean(window.marbleBuild?.state()));
  await page.evaluate(() => window.marbleBuild.setSide?.('none'));
  await page.evaluate(() => dispatchEvent(new CustomEvent('marble-marks:comment', { detail: { id: 'mc1' } })));
  const thread = page.locator('.marble-build-thread:not([hidden])');
  await thread.waitFor();
  await page.waitForTimeout(300);
  assert.equal(await thread.getAttribute('data-dock'), '');
  const field = thread.locator('.marble-build-write .field');
  assert.ok(await field.evaluate((n) => parseFloat(getComputedStyle(n).fontSize)) >= 16);
  await field.focus();
  await raiseKeyboard(page);
  const seen = await page.evaluate(() => {
    const vv = window.visualViewport;
    const r = document.querySelector('.marble-build-thread:not([hidden])').getBoundingClientRect();
    return { foot: vv.offsetTop + vv.height, left: r.left, right: r.right, bottom: r.bottom, vw: innerWidth };
  });
  assert.ok(Math.abs(seen.bottom - seen.foot) <= 1, `the thread ends at ${seen.bottom}; the keys start at ${seen.foot}`);
  assert.ok(seen.left <= 1 && seen.right >= seen.vw - 1, JSON.stringify(seen));
  const buttons = await thread.locator('button:not([hidden])').evaluateAll((list) => list.filter((b) => b.offsetParent).map((b) => [b.className, b.getBoundingClientRect().height]));
  for (const [name, h] of buttons) assert.ok(h >= 40, `${name} is ${h}px tall`);
  assert.ok(await noSideways(page));
});
