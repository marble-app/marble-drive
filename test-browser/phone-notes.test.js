// The Note starter in a hand. A note is a page you write on with the keyboard
// up most of the time, so on a phone the keyboard is the setting rather than
// an edge case: nothing typed into may zoom the page, the formatting row
// stands on the keys the way Notes' and Notion's do, the line being typed is
// never behind that row, and the page never scrolls sideways. 393 × 852, a
// finger, and a keyboard simulated the way the browser reports one.

import assert from 'node:assert/strict';
import test from 'node:test';

import { build } from '../server/gallery.js';
import { startDrive } from './harness.js';

const scratch = await build('note', { name: 'Scratch' });
// The Document starter is written on the same way and had the same troubles.
const paper = await build('doc', { name: 'Paper' });
const host = await startDrive({ agents: false, documents: { scratch, paper } });
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };
const KB = 336;

const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

const openPhone = async (viewport = PHONE, doc = 'scratch') => {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport, hasTouch: true, isMobile: true });
  pages.push(page);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble && window.marblePhone));
  await page.waitForTimeout(150);
  return { page, errors };
};

/** The keyboard, as the browser reports it: the visual viewport shrinks by
 *  `kb` and, on a browser that has to lift the caret clear, slides down the
 *  layout viewport by `offsetTop`. */
const raiseKeyboard = async (page, kb = KB, offsetTop = 0) => {
  await page.evaluate(({ kb: taken, offsetTop: slid }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - taken, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: slid, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  }, { kb, offsetTop });
  await page.waitForTimeout(200);
};

/** Put the caret at the true end of a block of the open note. */
const caretToEndOf = (page, index) =>
  page.evaluate((index) => {
    const note = document.querySelector('.note.marble-open');
    note.focus();
    const range = document.createRange();
    range.selectNodeContents(note.children[index]);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, index);

/** What is where, against the strip of screen the person can see. */
const seen = (page) =>
  page.evaluate(() => {
    const vv = window.visualViewport;
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el || !el.getClientRects().length) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      keyboard: document.documentElement.classList.contains('marble-keys'),
      strip: { top: Math.round(vv.offsetTop), bottom: Math.round(vv.offsetTop + vv.height) },
      sheet: box('.sheet'),
      tools: box('.sheet > .tools'),
      done: box('.tools .done'),
      rows: box('.rows'),
      find: box('.find'),
      name: box('.name'),
      pill: box('.marble-status'),
      wide: document.documentElement.scrollWidth,
      inner: innerWidth,
    };
  });

test('nothing you type into is set under 16px, so focusing it never zooms the page', async () => {
  const { page, errors } = await openPhone();
  const sizes = await page.evaluate(() => {
    const px = (el) => parseFloat(getComputedStyle(el).fontSize);
    return {
      note: px(document.querySelector('.note.marble-open')),
      find: px(document.querySelector('.find')),
      name: px(document.querySelector('.name')),
    };
  });
  for (const [field, size] of Object.entries(sizes)) assert.ok(size >= 16, `the ${field} is set at ${size}px`);

  // Held sideways the phone is wider than the narrow layout, and it is still a
  // touch screen with a keyboard.
  await page.setViewportSize({ width: 852, height: 393 });
  await page.waitForTimeout(150);
  const sideways = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.note.marble-open')).fontSize));
  assert.ok(sideways >= 16, `held sideways, the note is set at ${sideways}px`);
  assert.deepEqual(errors, []);
});

test('the open note asks the keyboard for prose, and the file never hears about it', async () => {
  const { page, errors } = await openPhone();
  const attrs = await page.evaluate(() => {
    const note = document.querySelector('.note.marble-open');
    return { cap: note.getAttribute('autocapitalize'), spell: note.getAttribute('spellcheck'), correct: note.getAttribute('autocorrect') };
  });
  assert.deepEqual(attrs, { cap: 'sentences', spell: 'true', correct: 'on' });
  const hints = await page.evaluate(() => ({
    find: document.querySelector('.find').getAttribute('enterkeyhint'),
    link: document.querySelector('.lb-in').getAttribute('enterkeyhint'),
    linkCaps: document.querySelector('.lb-in').getAttribute('autocapitalize'),
  }));
  assert.deepEqual(hints, { find: 'search', link: 'done', linkCaps: 'none' });

  await caretToEndOf(page, 1);
  await page.keyboard.type(' More.');
  await page.evaluate(() => window.marble.flush());
  const source = await (await fetch(`${host.base}/a/scratch`, { headers: { accept: 'text/html' } })).text();
  assert.match(source, /More\./);
  assert.doesNotMatch(source, /<article[^>]*\s(autocapitalize|autocorrect)=/);
  assert.doesNotMatch(source, /<html[^>]*marble-keys/);
  assert.deepEqual(errors, []);
});

test('with the keyboard up, the formatting row stands on it and the list folds away', async () => {
  for (const slid of [0, KB]) {
    const { page, errors } = await openPhone();
    const before = await seen(page);
    assert.equal(before.tools.top, before.sheet.top, 'with no keyboard the row is across the top of the page');
    assert.equal(before.done, null, 'Done is drawn with no keyboard to put away');

    await caretToEndOf(page, 2);
    await raiseKeyboard(page, KB, slid);
    const s = await seen(page);
    assert.ok(s.keyboard, 'the page never heard the keyboard come up');
    assert.ok(s.tools.bottom <= s.strip.bottom + 1 && s.tools.bottom >= s.strip.bottom - 2,
      `slid ${slid}: the row ends at ${s.tools.bottom}, not on the keys at ${s.strip.bottom}`);
    assert.ok(s.tools.top > s.sheet.top + 100, `slid ${slid}: the row is still at the top of the page`);
    assert.ok(s.done && s.done.h >= 44 && s.done.w >= 44, `slid ${slid}: Done is ${s.done?.w}×${s.done?.h}`);
    assert.ok(s.done.right <= s.inner, `slid ${slid}: Done is off the edge of the screen at ${s.done.right}`);
    assert.equal(s.rows, null, 'the strip of notes still takes room while typing');
    assert.equal(s.find, null, 'the search still takes room while typing');
    assert.ok(s.name && s.name.top >= s.strip.top - 1, `the note's name left the top of the screen at ${s.name?.top}`);
    assert.ok(s.pill.bottom <= s.tools.top, `the save pill ends at ${s.pill.bottom}, over the row at ${s.tools.top}`);
    assert.ok(s.wide <= s.inner, `the page is ${s.wide}px wide on a ${s.inner}px screen`);
    assert.deepEqual(errors, []);
  }
});

test('typing at the foot of a long note keeps the line clear of the row', async () => {
  const { page, errors } = await openPhone();
  await caretToEndOf(page, 3);
  await raiseKeyboard(page);
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`Line ${i} goes on`);
  }
  await page.waitForTimeout(200);
  const at = await page.evaluate(() => {
    const sel = getSelection();
    const range = document.createRange();
    range.setStart(sel.focusNode, sel.focusOffset);
    const caret = [...range.getClientRects()].find((r) => r.height) ?? sel.focusNode.parentElement.getBoundingClientRect();
    const bar = document.querySelector('.sheet > .tools').getBoundingClientRect();
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    return { bottom: Math.round(caret.bottom), top: Math.round(caret.top), bar: Math.round(bar.top), sheet: Math.round(sheet.top) };
  });
  assert.ok(at.bottom <= at.bar, `the caret ends at ${at.bottom}, behind the row that starts at ${at.bar}`);
  assert.ok(at.top >= at.sheet, `the caret starts at ${at.top}, above the page at ${at.sheet}`);
  assert.deepEqual(errors, []);
});

test('Done puts the keyboard away and gives the list back', async () => {
  const { page, errors } = await openPhone();
  await caretToEndOf(page, 2);
  await raiseKeyboard(page);
  await page.tap('.tools .done');
  await raiseKeyboard(page, 0, 0);
  const s = await seen(page);
  const inNote = await page.evaluate(() => Boolean(document.activeElement?.closest?.('.note')));
  assert.equal(inNote, false, 'the note still has the keys');
  assert.equal(s.keyboard, false);
  assert.equal(s.tools.top, s.sheet.top, 'the row did not go back across the top');
  assert.ok(s.rows && s.find, 'the list and the search did not come back');
  assert.deepEqual(errors, []);
});

test('the search field has the keyboard without the row moving onto it', async () => {
  const { page, errors } = await openPhone();
  await page.tap('.find');
  await raiseKeyboard(page);
  const s = await seen(page);
  assert.ok(s.find, 'the search folded away under its own keyboard');
  assert.equal(s.tools.top, s.sheet.top, 'the formatting row came down onto the keys for a search');
  assert.equal(s.done, null);
  assert.deepEqual(errors, []);
});

test('every press in the row and the link box is 44px, and the link box stays in sight', async () => {
  const { page, errors } = await openPhone();
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.sheet > .tools .tool')]
      .filter((b) => b.getClientRects().length)
      .map((b) => ({ name: b.getAttribute('aria-label'), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) }))
      .filter((b) => b.w < 44 || b.h < 44));
  assert.deepEqual(small, []);

  await caretToEndOf(page, 1);
  await raiseKeyboard(page);
  await page.tap('.tool[data-name="link"]');
  await page.waitForTimeout(150);
  const box = await page.evaluate(() => {
    const el = document.querySelector('.linkbox');
    const r = el.getBoundingClientRect();
    const field = el.querySelector('.lb-in');
    const vv = window.visualViewport;
    return {
      hidden: el.hidden,
      top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right),
      floor: Math.round(document.querySelector('.sheet > .tools').getBoundingClientRect().top),
      sill: Math.round(vv.offsetTop + vv.height),
      field: parseFloat(getComputedStyle(field).fontSize),
      buttons: [...el.querySelectorAll('.lb-edit button')].map((b) => Math.round(b.getBoundingClientRect().height)),
    };
  });
  assert.equal(box.hidden, false, 'the link box did not open');
  assert.ok(box.field >= 16, `the address field is set at ${box.field}px`);
  assert.ok(box.buttons.every((h) => h >= 44), `the link box's buttons are ${box.buttons.join(', ')}px tall`);
  assert.ok(box.bottom <= Math.min(box.floor, box.sill), `the link box ends at ${box.bottom}, under the row at ${box.floor}`);
  assert.ok(box.left >= 0 && box.right <= PHONE.width, `the link box runs ${box.left} to ${box.right}`);
  assert.deepEqual(errors, []);
});

test('holding a button in the row says what it does, and does not do it', async () => {
  const { page, errors } = await openPhone();
  await caretToEndOf(page, 1);
  // The row scrolls sideways on a phone; the quote is a way along it.
  await page.evaluate(() => document.querySelector('.tool[data-name="quote"]').scrollIntoView({ inline: 'center', block: 'nearest' }));
  await page.waitForTimeout(100);
  const cdp = await page.context().newCDPSession(page);
  const r = await page.locator('.tool[data-name="quote"]').boundingBox();
  const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(650);
  const tip = await page.evaluate(() => {
    const el = document.querySelector('.tooltip');
    return { shown: !el.hidden, text: el.textContent };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  assert.deepEqual(tip, { shown: true, text: 'Quote' });
  const quoted = await page.evaluate(() => document.querySelector('.note.marble-open').children[1].tagName);
  assert.equal(quoted, 'P', 'the press that asked what the button does also did it');
  assert.deepEqual(errors, []);
});

test('nothing scrolls sideways, at 320 or at 393, with the keyboard up or down', async () => {
  for (const width of [320, 393]) {
    const { page, errors } = await openPhone({ width, height: 700 });
    let s = await seen(page);
    assert.ok(s.wide <= s.inner, `${width}: the page is ${s.wide}px wide`);
    await caretToEndOf(page, 1);
    await raiseKeyboard(page, 300);
    s = await seen(page);
    assert.ok(s.wide <= s.inner, `${width}, keyboard up: the page is ${s.wide}px wide`);
    const scrollers = await page.evaluate(() =>
      ['.rows', '.sheet > .tools', '.sheet'].map((sel) => getComputedStyle(document.querySelector(sel)).overscrollBehaviorX));
    assert.deepEqual(scrollers, ['contain', 'contain', 'contain'], 'a swipe past the end of a strip goes back a page');
    assert.deepEqual(errors, []);
  }
});

// ------------------------------------------------------------- the document

const openDoc = () => openPhone(PHONE, 'paper');

const caretInDoc = (page, index) =>
  page.evaluate((index) => {
    const flow = document.querySelector('#flow');
    flow.focus();
    const range = document.createRange();
    range.selectNodeContents(flow.children[index]);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, index);

test('the document zooms into nothing either: the page and its name are 16px fields', async () => {
  const { page, errors } = await openDoc();
  const sizes = await page.evaluate(() => ({
    flow: parseFloat(getComputedStyle(document.querySelector('#flow')).fontSize),
    name: parseFloat(getComputedStyle(document.querySelector('.docname')).fontSize),
    // The paragraphs keep the points the document gives them.
    para: [...document.querySelectorAll('#flow > *')].map((el) => {
      const cs = getComputedStyle(el);
      const pt = parseFloat(cs.getPropertyValue('--pt')) || 10.5;
      return Math.abs(parseFloat(cs.fontSize) - pt * 4 / 3) < .5;
    }),
    cap: document.querySelector('#flow').getAttribute('autocapitalize'),
  }));
  assert.ok(sizes.flow >= 16, `the page is a field set at ${sizes.flow}px`);
  assert.ok(sizes.name >= 16, `the name is set at ${sizes.name}px`);
  assert.ok(sizes.para.length && sizes.para.every(Boolean), 'a paragraph lost the points the document gives it');
  assert.equal(sizes.cap, 'sentences');
  const menu = await page.evaluate(() => Math.round(document.querySelector('.menus .all').getBoundingClientRect().height));
  assert.ok(menu >= 44, `the Menu button is ${menu}px tall`);
  assert.deepEqual(errors, []);
});

test('in the document, the toolbar stands on the keyboard and its menu opens over it', async () => {
  for (const slid of [0, KB]) {
    const { page, errors } = await openDoc();
    await caretInDoc(page, 2);
    await raiseKeyboard(page, KB, slid);
    const s = await page.evaluate(() => {
      const vv = window.visualViewport;
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      return {
        keys: document.documentElement.classList.contains('marble-keys'),
        sill: Math.round(vv.offsetTop + vv.height),
        tools: { top: Math.round(r('.tools').top), bottom: Math.round(r('.tools').bottom) },
        work: Math.round(r('.work').bottom),
        wide: document.documentElement.scrollWidth,
      };
    });
    assert.ok(s.keys, `slid ${slid}: the page never heard the keyboard come up`);
    assert.ok(s.tools.bottom <= s.sill + 1 && s.tools.bottom >= s.sill - 2, `slid ${slid}: the toolbar ends at ${s.tools.bottom}, not on the keys at ${s.sill}`);
    assert.ok(s.work <= s.tools.top + 1, `slid ${slid}: the page runs under the toolbar`);
    assert.ok(s.wide <= PHONE.width, `slid ${slid}: the page is ${s.wide}px wide`);

    // The paragraph style is a menu, and it opens by its button: over it,
    // since under it is the keyboard.
    await page.tap('.tools [data-pick="style"]');
    await page.waitForTimeout(150);
    const menu = await page.evaluate(() => {
      const vv = window.visualViewport;
      const m = document.querySelector('#popup').getBoundingClientRect();
      const b = document.querySelector('.tools [data-pick="style"]').getBoundingClientRect();
      return { top: Math.round(m.top), bottom: Math.round(m.bottom), button: Math.round(b.top), sky: Math.round(vv.offsetTop) };
    });
    assert.ok(menu.bottom <= menu.button + 1, `slid ${slid}: the menu ends at ${menu.bottom}, over its button at ${menu.button}`);
    assert.ok(menu.top >= menu.sky, `slid ${slid}: the menu starts at ${menu.top}, above the screen at ${menu.sky}`);
    assert.deepEqual(errors, []);
  }
});
