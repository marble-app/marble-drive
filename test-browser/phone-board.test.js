// The Board (the whiteboard) and the board starter, in a hand. A canvas on a
// phone is the hard case: one finger pans or draws, two fingers zoom the
// board and never the page, the dock is under the thumb and stands on the
// keyboard while a note is typed into, and nothing a finger presses is under
// 44px. The keyboard is simulated as agents-phone-keyboard.test.js does it:
// the visual viewport shrinks, and slides down by however far the browser
// moved it to keep the caret clear. 393 × 852, and 320 for the narrowest.

import assert from 'node:assert/strict';
import test from 'node:test';

import { build } from '../server/gallery.js';
import { startDrive } from './harness.js';

const Board = await build('whiteboard', { name: 'Board' });
const demo = await build('board', { name: 'Demo' });
const host = await startDrive({ scripts: { hello: [{ say: 'Hello.' }] }, documents: { Board, demo } });
test.after(() => host.close());

const pages = [];
const closePages = async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); };
test.after(closePages);

const PHONE = { width: 393, height: 852 };
const KB = 336;

async function openBoard(viewport = PHONE) {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport, hasTouch: true, isMobile: true });
  pages.push(page);
  await page.goto(`${host.base}/a/Board`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marble?.drive && window.marblePhone));
  await page.waitForTimeout(250);
  return { page, errors };
}

async function openStarter(viewport = PHONE) {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport, hasTouch: true, isMobile: true });
  pages.push(page);
  await page.goto(`${host.base}/a/demo`);
  await page.waitForFunction(() => Boolean(window.marble && window.marblePhone));
  await page.waitForTimeout(150);
  return { page, errors };
}

const raiseKeyboard = async (page, kb = KB, offsetTop = 0) => {
  await page.evaluate(({ kb: k, offsetTop: top }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - k, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: top, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  }, { kb, offsetTop });
  await page.waitForTimeout(120);
};

/** A finger held still on one spot, the way a long press is made. */
async function longPress(page, x, y, ms = 650) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(120);
}

/** Two fingers spread apart from a midpoint. */
async function pinch(page, x, y, from, to) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d) => [{ x: x - d, y, id: 1 }, { x: x + d, y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= 6; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 6) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(80);
}

const centreOf = (page, selector) => page.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, selector);

/** Every control a finger can see and press, smaller than 44 on a side. A
 *  control may draw small and reach further with a ::before, so that counts. */
const smallTargets = (page, selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)]
  .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
  .map((el) => {
    const r = el.getBoundingClientRect();
    const b = getComputedStyle(el, '::before');
    if (b.content === 'none' || b.position !== 'absolute') return { el, r };
    const out = (v) => Math.max(0, -(parseFloat(v) || 0));
    return { el, r: { width: r.width + out(b.left) + out(b.right), height: r.height + out(b.top) + out(b.bottom) } };
  })
  .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
  .map(({ el, r }) => `${el.className || el.tagName} ${el.getAttribute('aria-label') ?? el.textContent.trim()} ${Math.round(r.width)}×${Math.round(r.height)}`), selector);

test('the page is a phone to the board: a coarse pointer, and phone.js on it', async () => {
  const { page } = await openBoard();
  assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches && window.marblePhone.touch), true);
});

for (const viewport of [PHONE, { width: 320, height: 640 }]) {
  test(`at ${viewport.width}px nothing runs off the side, the chrome does not collide, and every control is 44px`, async () => {
    const { page, errors } = await openBoard(viewport);
    const seen = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel).getBoundingClientRect();
      const dock = box('.dock');
      return {
        scroll: document.documentElement.scrollWidth,
        inner: innerWidth,
        dock: { left: dock.left, right: dock.right },
        head: box('.head').right,
        view: box('.view').left,
        more: getComputedStyle(document.querySelector('.dock .more')).display,
      };
    });
    assert.ok(seen.scroll <= seen.inner, `the page is ${seen.scroll}px wide in a ${seen.inner}px window`);
    assert.ok(seen.dock.left >= 0 && seen.dock.right <= seen.inner, `the dock runs ${seen.dock.left}–${seen.dock.right}`);
    assert.ok(seen.head <= seen.view, `the name and undo end at ${seen.head}, over the view's buttons from ${seen.view}`);
    assert.equal(seen.more, 'grid', 'the tools that do not fit are under More, not off the side');
    assert.deepEqual(await smallTargets(page, '.dock > .tb, .head .tb, .view .tb, .view .ask-btn'), []);
    assert.deepEqual(errors, []);
  });
}

test('More holds the tools the dock has no room for, by its button, and wears the one picked', async () => {
  const { page, errors } = await openBoard();
  await page.locator('.dock .more').tap();
  const menu = page.locator('#bw-more');
  await menu.waitFor();
  const seen = await page.evaluate(() => {
    const m = document.querySelector('#bw-more').getBoundingClientRect();
    const b = document.querySelector('.dock .more').getBoundingClientRect();
    return {
      rows: [...document.querySelectorAll('#bw-more .act span')].map((s) => s.textContent),
      menu: { top: m.top, bottom: m.bottom, left: m.left, right: m.right },
      button: { top: b.top },
    };
  });
  assert.deepEqual(seen.rows, ['Section', 'Highlighter', 'Image, video or file', 'From your drive', 'Link']);
  assert.ok(seen.menu.bottom <= seen.button.top && seen.button.top - seen.menu.bottom < 16, `the menu ends at ${seen.menu.bottom}, not by its button at ${seen.button.top}`);
  assert.ok(seen.menu.top >= 0 && seen.menu.left >= 0 && seen.menu.right <= PHONE.width, 'and inside the screen');
  assert.deepEqual(await smallTargets(page, '#bw-more .act'), []);

  await page.locator('#bw-more .act', { hasText: 'Highlighter' }).tap();
  const after = await page.evaluate(() => ({
    tool: document.querySelector('.stage').dataset.tool,
    pressed: document.querySelector('.dock .more').getAttribute('aria-pressed'),
    icon: document.querySelector('.dock .more use').getAttribute('href'),
    open: document.querySelector('#bw-more').matches(':popover-open'),
  }));
  assert.deepEqual(after, { tool: 'marker', pressed: 'true', icon: '#i-marker', open: false });
  assert.deepEqual(errors, []);
});

test('every field a thumb types into is 16px, so iOS has nothing to zoom in on', async () => {
  const { page, errors } = await openBoard();
  const sizes = await page.evaluate(() => {
    const px = (el) => parseFloat(getComputedStyle(el).fontSize);
    document.body.dataset.panel = 'open';
    const out = {
      composer: px(document.querySelector('.field textarea')),
      link: px(document.querySelector('.linkin input')),
      search: px(document.querySelector('.drivepick input')),
      name: px(document.querySelector('.head .name')),
      note: px(document.querySelector('.note > .words')),
    };
    for (const kind of ['frame']) {
      const item = document.querySelector(`.world > .${kind}`);
      item.classList.add('marble-editing');
      out[kind] = px(item.querySelector(':scope > .words'));
      item.classList.remove('marble-editing');
    }
    return out;
  });
  for (const [field, size] of Object.entries(sizes)) assert.ok(size >= 16, `${field} is ${size}px`);
  const hints = await page.evaluate(() => ({
    link: document.querySelector('.linkin input').getAttribute('enterkeyhint'),
    search: document.querySelector('.drivepick input').getAttribute('enterkeyhint'),
  }));
  assert.deepEqual(hints, { link: 'go', search: 'go' });
  assert.deepEqual(errors, []);
});

test('a note typed into stands clear of the keyboard, and the dock stands on the keys', async () => {
  const { page, errors } = await openBoard();
  // A note low on the screen, where the keyboard will come up over it.
  await page.evaluate(() => { document.querySelectorAll('.world > .note')[1].dataset.probe = '1'; });
  const lowNote = '.world > .note[data-probe]';
  // Drag the board so the note sits low, where the keys will come up over it
  // (and above the selection's tools, which stand over the dock).
  const at = await centreOf(page, lowNote);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 20, y: 300, id: 1 }] });
  for (let i = 1; i <= 8; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 20, y: 300 + ((560 - at.y) * i) / 8, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  const low = await centreOf(page, lowNote);
  assert.ok(low.y > 852 - KB, `the note is at ${low.y}, not low enough for the keyboard to cover`);

  await page.touchscreen.tap(low.x, low.y);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(low.x, low.y);
  await page.waitForFunction(() => document.activeElement?.closest?.('.note'));
  await raiseKeyboard(page);
  await page.waitForTimeout(450);
  const seen = await page.evaluate((sel) => {
    const vv = window.visualViewport;
    const dock = document.querySelector('.dock').getBoundingClientRect();
    const note = document.querySelector(sel).getBoundingClientRect();
    return {
      keyboard: document.documentElement.hasAttribute('data-marble-keyboard'),
      visibleBottom: Math.round(vv.offsetTop + vv.height),
      dock: { top: Math.round(dock.top), bottom: Math.round(dock.bottom) },
      note: { top: Math.round(note.top), bottom: Math.round(note.bottom) },
      stageScroll: document.querySelector('.stage').scrollTop,
    };
  }, lowNote);
  assert.equal(seen.keyboard, true);
  assert.ok(seen.dock.bottom <= seen.visibleBottom && seen.dock.bottom >= seen.visibleBottom - 16, `the dock ends at ${seen.dock.bottom}, the keyboard starts at ${seen.visibleBottom}`);
  assert.ok(seen.note.bottom <= seen.dock.top, `the note ends at ${seen.note.bottom}, behind the dock at ${seen.dock.top}`);
  assert.ok(seen.note.top >= 0, `the note starts at ${seen.note.top}, off the top`);
  assert.equal(seen.stageScroll, 0, 'the stage itself never scrolls; the camera moves');

  // When iOS slides the visible strip down instead, the dock rides with it.
  await raiseKeyboard(page, KB, 120);
  const slid = await page.evaluate(() => {
    const vv = window.visualViewport;
    return { bottom: Math.round(vv.offsetTop + vv.height), dock: Math.round(document.querySelector('.dock').getBoundingClientRect().bottom) };
  });
  assert.ok(slid.dock <= slid.bottom && slid.dock >= slid.bottom - 16, `the dock ends at ${slid.dock}, the keyboard starts at ${slid.bottom}`);
  assert.deepEqual(errors, []);
});

test('the conversation is a sheet that stands on the keyboard, its composer in sight', async () => {
  const { page, errors } = await openBoard();
  await page.locator('.ask-btn').tap();
  await page.locator('.panel').waitFor();
  await page.locator('.field textarea').focus();
  await raiseKeyboard(page);
  const seen = await page.evaluate(() => {
    const vv = window.visualViewport;
    const panel = document.querySelector('.panel').getBoundingClientRect();
    const field = document.querySelector('.field').getBoundingClientRect();
    return { top: vv.offsetTop, bottom: Math.round(vv.offsetTop + vv.height), panel: { top: Math.round(panel.top), bottom: Math.round(panel.bottom) }, field: Math.round(field.bottom) };
  });
  assert.equal(seen.panel.bottom, seen.bottom, `the sheet ends at ${seen.panel.bottom}, the keyboard starts at ${seen.bottom}`);
  assert.ok(seen.panel.top >= seen.top, `the sheet starts at ${seen.panel.top}, above what can be seen`);
  assert.ok(seen.field <= seen.bottom, `the composer ends at ${seen.field}, under the keyboard at ${seen.bottom}`);
  assert.deepEqual(await smallTargets(page, '.panel-bar .tb, .send'), []);
  assert.deepEqual(errors, []);
});

test('a long press on a note opens its menu by the finger; on the board, what can go there', async () => {
  const { page, errors } = await openBoard();
  const note = await centreOf(page, '.world > .note');
  await longPress(page, note.x, note.y);
  const onNote = await page.evaluate(() => {
    const m = document.querySelector('#bw-context');
    const r = m.getBoundingClientRect();
    return {
      open: m.matches(':popover-open'),
      rows: [...m.querySelectorAll('.act span')].map((s) => s.textContent),
      selected: document.querySelectorAll('.world > .marble-selected').length,
      box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
    };
  });
  assert.equal(onNote.open, true, 'no menu after a long press');
  assert.deepEqual(onNote.rows, ['Edit text', 'Copy', 'Duplicate', 'Bring to front', 'Send to back', 'Ask Claude about this', 'Delete']);
  assert.equal(onNote.selected, 1);
  assert.ok(onNote.box.left >= 0 && onNote.box.right <= PHONE.width && onNote.box.top >= 0 && onNote.box.bottom <= PHONE.height, 'the menu is inside the screen');
  assert.ok(Math.abs((onNote.box.top + onNote.box.bottom) / 2 - note.y) < 400, 'and by the finger');
  assert.deepEqual(await smallTargets(page, '#bw-context .act'), []);

  const before = await page.locator('.world > .item').count();
  await page.locator('#bw-context .act', { hasText: 'Duplicate' }).tap();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.world > .item').count(), before + 1);
  assert.equal(await page.evaluate(() => document.querySelector('#bw-context').matches(':popover-open')), false);

  await longPress(page, 200, 160);
  const onBoard = await page.evaluate(() => [...document.querySelectorAll('#bw-context .act span')].map((s) => s.textContent));
  assert.deepEqual(onBoard.slice(0, 2), ['Sticky note here', 'Text here']);
  assert.deepEqual(errors, []);
});

test('two fingers zoom the board and never the page; one finger on the board pans it', async () => {
  const { page, errors } = await openBoard();
  const z = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')));
  const before = await z();
  await pinch(page, 196, 420, 40, 140);
  const after = await z();
  assert.ok(after > before * 1.8, `the board went from ${before} to ${after}`);
  assert.equal(await page.evaluate(() => window.visualViewport.scale), 1, 'the page zoomed with it');

  const cx = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cx')));
  const x0 = await cx();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 40, y: 160, id: 1 }] });
  for (let i = 1; i <= 5; i += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 40 + i * 20, y: 160, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(Math.abs((await cx()) - x0 - 100) < 2, 'one finger on empty board moves the camera with it');
  assert.equal(await page.evaluate(() => document.documentElement.scrollLeft + document.documentElement.scrollTop), 0);
  assert.deepEqual(errors, []);
});

test('a double-tap on the board puts a sticky note there, once', async () => {
  const { page, errors } = await openBoard();
  const notes = () => page.locator('.world > .note').count();
  const before = await notes();
  await page.touchscreen.tap(200, 170);
  await page.waitForTimeout(60);
  await page.touchscreen.tap(202, 171);
  await page.waitForTimeout(400);
  assert.equal(await notes(), before + 1);
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('.note'))), true, 'and its words have the caret');
  assert.deepEqual(errors, []);
});

test('with a note in hand its tools stand above the dock, inside the screen, 44px each', async () => {
  for (const viewport of [PHONE, { width: 320, height: 640 }]) {
    const { page, errors } = await openBoard(viewport);
    const note = await centreOf(page, '.world > .note');
    await page.touchscreen.tap(note.x, note.y);
    await page.waitForTimeout(150);
    const seen = await page.evaluate(() => {
      const bar = document.querySelector('.selbar').getBoundingClientRect();
      const dock = document.querySelector('.dock').getBoundingClientRect();
      return { left: bar.left, right: bar.right, bottom: bar.bottom, dock: dock.top, scroll: document.documentElement.scrollWidth };
    });
    assert.ok(seen.left >= 0 && seen.right <= viewport.width, `${viewport.width}px: the bar runs ${seen.left}–${seen.right}`);
    assert.ok(seen.bottom <= seen.dock, `${viewport.width}px: the bar ends at ${seen.bottom}, over the dock at ${seen.dock}`);
    assert.ok(seen.scroll <= viewport.width);
    assert.deepEqual(await smallTargets(page, '.selbar .tb, .selbar .sw, .handle'), []);
    assert.deepEqual(errors, []);
  }
});

test('picking from the drive on a phone is a sheet standing on the keyboard', async () => {
  const { page, errors } = await openBoard();
  await page.locator('.dock .more').tap();
  await page.locator('#bw-more .act', { hasText: 'From your drive' }).tap();
  await page.locator('.drivepick').waitFor();
  await page.locator('.drivepick input').focus();
  await raiseKeyboard(page);
  const seen = await page.evaluate(() => {
    const vv = window.visualViewport;
    const r = document.querySelector('.drivepick').getBoundingClientRect();
    return { left: r.left, right: Math.round(r.right), top: r.top, bottom: Math.round(r.bottom), visible: Math.round(vv.offsetTop + vv.height), w: innerWidth };
  });
  assert.equal(seen.left, 0);
  assert.equal(seen.right, seen.w);
  assert.equal(seen.bottom, seen.visible, `the sheet ends at ${seen.bottom}, the keyboard starts at ${seen.visible}`);
  assert.ok(seen.top >= 0);
  assert.deepEqual(errors, []);
});

// ------------------------------------------------------------- the starter

test('the board starter on a phone: 16px fields, nothing off the side at 320, the undo strip on the keyboard', async () => {
  for (const viewport of [PHONE, { width: 320, height: 640 }]) {
    const { page, errors } = await openStarter(viewport);
    const seen = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      small: [...document.querySelectorAll('[data-marble-editable]')]
        .map((el) => [el.tagName, parseFloat(getComputedStyle(el).fontSize)])
        .filter(([, px]) => px < 16),
    }));
    assert.ok(seen.scroll <= viewport.width, `${viewport.width}px: the page is ${seen.scroll}px wide`);
    assert.deepEqual(seen.small, [], 'every editable is 16px or more');
    assert.deepEqual(errors, []);
  }
  const { page } = await openStarter();
  await page.locator('.card h3').first().focus();
  await page.evaluate(() => window.offerUndo('Removed a card'));
  await raiseKeyboard(page);
  const strip = await page.evaluate(() => {
    const vv = window.visualViewport;
    return { bottom: Math.round(document.querySelector('.reversal').getBoundingClientRect().bottom), visible: Math.round(vv.offsetTop + vv.height) };
  });
  assert.ok(strip.bottom <= strip.visible && strip.bottom >= strip.visible - 24, `the undo strip ends at ${strip.bottom}, the keyboard starts at ${strip.visible}`);
});
