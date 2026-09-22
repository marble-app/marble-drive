// The Canvas starter, driven the way somebody moves things around on one.
//
// A canvas is the one starter that is pure direct manipulation: its whole claim
// is that *where* a note is, is one attribute in the file. So every assertion
// here is about one of three things — whether a gesture reached the file,
// whether what the file says can still be seen and reached at 390px wide, and
// whether there is a way back from it.
//
// Two of these tests are about a press rather than a drag. The canvas affordance
// calls preventDefault on every pointerdown over one of its children and takes a
// pointer capture on the board, which between them stop anything inside a note
// from being clicked or given a caret at all. The document undoes both, and a
// canvas of editable notes that cannot be edited or deleted is worth a test
// saying so.

import assert from 'node:assert/strict';
import test from 'node:test';

import { build } from '../server/gallery.js';
import { startDrive } from './harness.js';

const demo = await build('canvas', { name: 'Demo' });
const host = await startDrive({ agents: false, documents: { demo } });
test.after(() => host.close());

const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 900 };

const open = async (viewport = DESK) => {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport });
  pages.push(page);
  await page.goto(`${host.base}/a/demo`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(200);
  return { page, errors };
};

const settle = async (page) => {
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(200);
};

/** What the file says, once everything queued has reached it. */
const filed = async (page) => {
  await page.evaluate(() => window.marble.flush());
  const answer = await fetch(`${host.base}/a/demo`, { headers: { accept: 'text/html' } });
  return answer.text();
};

/**
 * The same document, said as one line rather than as fifty kilobytes: a whole
 * starter in an assertion message is a wall nobody reads.
 */
const same = (got, want, message) => {
  if (got === want) return;
  let at = 0;
  while (at < want.length && want[at] === got[at]) at += 1;
  const window = (source) => JSON.stringify(source.slice(Math.max(0, at - 90), at + 90));
  assert.fail(`${message}\n  at ${at}\n  want: ${window(want)}\n  got : ${window(got)}`);
};

/** The notes as the file addresses them, with the one attribute that places them. */
const placed = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.note')].map((el) => ({
      id: el.getAttribute('data-marble-id'),
      style: el.getAttribute('style'),
      text: el.textContent.trim(),
    })),
  );

/** A pointer drag, in steps, because a drag that teleports is not a drag. */
const dragBy = async (page, selector, dx, dy) => {
  const box = await page.locator(selector).first().boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + 12 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(from.x + (dx * i) / 6, from.y + (dy * i) / 6);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
};

const undo = async (page, times = 1) => {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(160);
  }
};
const redo = async (page, times = 1) => {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForTimeout(160);
  }
};

test('a note is placed rather than laid out, and the position is the one attribute', async () => {
  const { page, errors } = await open();
  const shape = await page.evaluate(() => {
    const notes = [...document.querySelectorAll('.note')];
    return notes.map((el) => ({
      position: getComputedStyle(el).position,
      // The drag is on the note, never on the board: a board that swallowed
      // touch-action is a region of a phone that cannot be scrolled at all.
      touch: getComputedStyle(el).touchAction,
      boardTouch: getComputedStyle(document.querySelector('.board')).touchAction,
      // A note answers "how wide"; its height is its words.
      handles: [...el.querySelectorAll('.marble-resize')].map((h) => h.className.split(' ').pop()),
      tab: el.tabIndex,
    }));
  });
  for (const note of shape) {
    assert.equal(note.position, 'absolute', 'a note on a canvas is positioned, not in flow');
    assert.equal(note.touch, 'none');
    assert.equal(note.boardTouch, 'auto', 'the board still scrolls under a finger');
    assert.deepEqual(note.handles, ['marble-resize-w']);
    assert.equal(note.tab, 0, 'a note is on the tab ring');
  }

  const all = await placed(page);
  assert.equal(all.length, 2);
  for (const note of all) assert.match(note.style, /^left:\d+px;top:\d+px$/);
  // tabindex belongs to the page, so no note may carry one in the file.
  const source = await filed(page);
  assert.ok(!/tabindex=/.test(source));
  assert.deepEqual(errors, []);
});

test('a note dragged far to the right is still reachable and readable at 390px', async () => {
  const { page, errors } = await open(PHONE);
  const before = (await placed(page))[0];

  await dragBy(page, '.note', 340, 40);
  const after = (await placed(page))[0];
  assert.notEqual(after.style, before.style, 'the drag moved it');
  assert.match(after.style, /^left:\d+px;top:\d+px$/, 'and filed it as one attribute');
  assert.ok(parseFloat(after.style.match(/left:(\d+)/)[1]) > 300);
  assert.ok((await filed(page)).includes(after.style), 'the file has where it ended up');

  // The board it went off the edge of scrolls to it. This is the whole bug:
  // the note used to be clipped away with no way to scroll to it, drag it
  // back, or read what it said.
  const reach = await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    return { sw: frame.scrollWidth, cw: frame.clientWidth };
  });
  assert.ok(reach.sw > reach.cw, `the board did not grow to its content (${reach.sw} vs ${reach.cw})`);

  const seen = await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    frame.scrollLeft = frame.scrollWidth;
    const note = document.querySelector('.note').getBoundingClientRect();
    const box = frame.getBoundingClientRect();
    return {
      inside: note.right <= box.right + 1 && note.left >= box.left - 1,
      text: document.querySelector('.note h3').textContent,
    };
  });
  assert.ok(seen.inside, 'scrolled to the end, the whole note is in the window');
  assert.equal(seen.text, 'Start here', 'and it still says what it said');

  // And it can be dragged home again, which is the other half of reachable.
  await dragBy(page, '.note', -200, 0);
  assert.notEqual((await placed(page))[0].style, after.style);
  assert.deepEqual(errors, []);
});

test('an empty board says what to do, and does not collapse', async () => {
  const { page, errors } = await open({ width: 740, height: 900 });
  for (let i = 0; i < 2; i += 1) {
    await page.click('.note .marble-remove');
    await page.waitForTimeout(200);
  }

  const empty = await page.evaluate(() => {
    const board = document.querySelector('.board');
    const state = document.querySelector('.empty');
    return {
      notes: document.querySelectorAll('.note').length,
      shown: getComputedStyle(state).display,
      board: Math.round(board.getBoundingClientRect().height),
      says: state.textContent.replace(/\s+/g, ' ').trim(),
      count: getComputedStyle(document.querySelector('.count'), '::after').content,
    };
  });
  assert.equal(empty.notes, 0);
  assert.notEqual(empty.shown, 'none', 'the empty state is drawn');
  assert.ok(empty.board > 200, `the board collapsed to ${empty.board}px`);
  assert.match(empty.says, /note/i);

  // It is drawn by asking the board what is in it, so it goes away again.
  await page.click('.empty .add');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.note').length), 1);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.empty')).display), 'none');
  assert.deepEqual(errors, []);
});

test('resizing a note files one attribute, and a reload still has it', async () => {
  const { page, errors } = await open();
  const before = (await placed(page))[0];

  await dragBy(page, '.note .marble-resize-w', 70, 0);
  const after = (await placed(page))[0];
  // How big joined where, in the same attribute rather than beside it. The
  // spacing is the library's: `resizable` reads the style back through the
  // CSSOM, which respaces what `canvas` wrote.
  assert.match(after.style, /^width:\d+px;\s*left:\s*\d+px;\s*top:\s*\d+px$/, 'the size joined the position, in one style attribute');
  const width = Number(after.style.match(/width:(\d+)/)[1]);
  assert.ok(width > 240, `the note did not widen: ${width}px`);
  assert.ok((await filed(page)).includes(after.style));

  await undo(page);
  assert.equal((await placed(page))[0].style, before.style, 'and undo puts it back');
  await redo(page);

  // Nothing that matters lives only in the page.
  await page.reload();
  await settle(page);
  const back = (await placed(page))[0];
  assert.equal(back.style, after.style, 'the size came back from the file, not from the page');
  assert.equal(Math.round(await page.evaluate(() => document.querySelector('.note').getBoundingClientRect().width)), width);
  assert.deepEqual(errors, []);
});

test('an arrow key files the same attribute a drag does', async () => {
  const { page, errors } = await open();
  const before = (await placed(page))[0];

  await page.focus('.note');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);

  const after = (await placed(page))[0];
  assert.equal(after.style, 'left:36px;top:32px', 'four pixels, which is the grid a drag snaps to');
  assert.match(after.style, /^left:\d+px;top:\d+px$/);
  assert.ok((await filed(page)).includes('left:36px;top:32px'));

  // Shift is the same escape hatch from the grid a drag has.
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(150);
  assert.equal((await placed(page))[0].style, 'left:37px;top:32px');

  // The origin is the one place scrolling cannot reach, so a nudge stops there.
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  assert.equal((await placed(page))[0].style, 'left:0px;top:32px');

  await page.reload();
  await settle(page);
  assert.equal((await placed(page))[0].style, 'left:0px;top:32px', 'it was the file that moved, not the page');

  // And the arrows inside the words belong to the caret, not to the note.
  await page.click('.note h3');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  assert.equal((await placed(page))[0].style, 'left:0px;top:32px');
  assert.notEqual(before.style, 'left:0px;top:32px');
  assert.deepEqual(errors, []);
});

test('a press inside a note reaches what it landed on', async () => {
  const { page, errors } = await open();

  // The caret. A canvas of editable notes that cannot be typed in is the app.
  await page.click('.note h3');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H3');
  await page.keyboard.type('!');
  await page.waitForTimeout(200);
  assert.ok((await filed(page)).includes('!'));
  // And the caret landed where it was pointed, not at the start of the line.
  assert.notEqual(await page.textContent('.note h3'), '!Start here');

  // The fold, which is one attribute on the note that the body and the
  // chevron both read.
  await page.click('.note .fold');
  await page.waitForTimeout(200);
  const folded = await page.evaluate(() => ({
    attr: document.querySelector('.note').getAttribute('data-expanded'),
    body: getComputedStyle(document.querySelector('.note p')).display,
    said: document.querySelector('.note .fold').getAttribute('aria-expanded'),
  }));
  assert.equal(folded.attr, 'no');
  assert.equal(folded.body, 'none');
  assert.equal(folded.said, 'false', 'and it says so to a screen reader');
  assert.ok((await filed(page)).includes('data-expanded="no"'));

  // The ×.
  await page.click('.note .marble-remove');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.note').length), 1);
  assert.deepEqual(errors, []);
});

test('a new note lands beside the last one, never on top of it', async () => {
  const { page, errors } = await open();
  for (let i = 0; i < 3; i += 1) {
    await page.click('.bar .add');
    await page.waitForTimeout(250);
  }

  const all = await placed(page);
  assert.equal(all.length, 5);
  const seen = new Set(all.map((note) => note.style));
  assert.equal(seen.size, 5, 'no two notes are in the same place');
  const source = await filed(page);
  for (const note of all) assert.ok(source.includes(note.style));
  assert.deepEqual(errors, []);
});

test('a paste into a note is words, not the markup they were wearing', async () => {
  const { page, errors } = await open();
  // The part asks the browser for plaintext-only and falls back if it is not
  // honoured, so the answer is confirmed rather than assumed.
  assert.equal(
    await page.evaluate(() => document.querySelector('.note h3').getAttribute('contenteditable')),
    'plaintext-only',
  );

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('.note p');
  await page.waitForTimeout(150);
  await page.keyboard.press('ControlOrMeta+a');
  await page.evaluate(async () => {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob(['<h1 style="color:red">Pasted <b>bold</b></h1>'], { type: 'text/html' }),
        'text/plain': new Blob(['Pasted bold'], { type: 'text/plain' }),
      }),
    ]);
  });
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(250);

  assert.equal(await page.textContent('.note p'), 'Pasted bold');
  const source = await filed(page);
  assert.ok(source.includes('Pasted bold'), 'the words arrived');
  assert.ok(!source.includes('color:red'), 'the dressing did not come with them');
  assert.ok(!/Pasted <b>bold<\/b>/.test(source), 'nor the tags they were wearing');
  assert.deepEqual(errors, []);
});

test('a long unbroken word does not push the board sideways', async () => {
  const { page, errors } = await open(PHONE);
  const room = await page.evaluate(() => document.querySelector('.frame').scrollWidth);
  await page.evaluate(() => {
    const note = document.querySelector('.note p');
    note.textContent = 'x'.repeat(200);
    note.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({
    frame: document.querySelector('.frame').scrollWidth,
    note: Math.round(document.querySelector('.note').getBoundingClientRect().width),
  }));
  assert.equal(after.frame, room, 'two hundred characters moved nothing');
  assert.ok(after.note < 260, `the note grew to ${after.note}px`);
  assert.deepEqual(errors, []);
});

test('move, resize and add each undo back to the byte', async () => {
  for (const gesture of ['move', 'resize', 'add']) {
    const { page, errors } = await open();
    const start = await filed(page);

    if (gesture === 'move') await dragBy(page, '.note', 180, 90);
    if (gesture === 'resize') await dragBy(page, '.note .marble-resize-w', 60, 0);
    if (gesture === 'add') {
      await page.click('.bar .add');
      await page.waitForTimeout(250);
    }
    const after = await filed(page);
    assert.notEqual(after, start, `${gesture} reached the file`);

    await undo(page);
    same(await filed(page), start, `${gesture} undid to the same bytes`);
    await redo(page);
    same(await filed(page), after, `${gesture} redid to the same bytes`);
    assert.deepEqual(errors, []);
  }
});

test('a deleted note comes back whole, and the four gestures undo as four steps', async () => {
  const { page, errors } = await open();
  const start = await filed(page);
  const doomed = (await placed(page))[1];

  await dragBy(page, '.note', 180, 90);
  await dragBy(page, '.note .marble-resize-w', 60, 0);
  await page.click('.bar .add');
  await page.waitForTimeout(250);
  await page.click('.note:nth-of-type(2) .marble-remove');
  await page.waitForTimeout(250);

  const worked = await filed(page);
  assert.ok(!worked.includes(doomed.id), 'the note left the file');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.note').length), 2);

  await undo(page, 4);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.note').length), 2);
  assert.equal(await page.evaluate(() => window.marble.canUndo), false, 'four gestures were four steps');
  const back = await filed(page);
  // Every element, attribute and word is back where it was. What is not
  // byte-exact is one run of whitespace: removing an element leaves the
  // indentation on both sides of it, and the carrier's insert puts the
  // element back after both. Nothing in the document differs.
  const flat = (source) => source.replace(/\s+/g, ' ');
  same(flat(back), flat(start), 'the delete came back whole');
  assert.ok(back.includes(doomed.id) && back.includes(doomed.style));

  await redo(page, 4);
  same(await filed(page), worked, 'and forward again, to the byte');
  assert.deepEqual(errors, []);
});

test('the bar draws the way back, because a phone has no Mod+Z', async () => {
  const { page, errors } = await open(PHONE);
  const start = await filed(page);
  assert.equal(await page.evaluate(() => document.querySelector('[data-back]').disabled), true);

  await dragBy(page, '.note', 60, 40);
  assert.equal(await page.evaluate(() => document.querySelector('[data-back]').disabled), false);

  await page.click('[data-back]');
  await page.waitForTimeout(250);
  same(await filed(page), start, 'the button is the same history Mod+Z reaches');
  assert.equal(await page.evaluate(() => document.querySelector('[data-forward]').disabled), false);

  await page.click('[data-forward]');
  await page.waitForTimeout(250);
  assert.notEqual(await filed(page), start);
  assert.deepEqual(errors, []);
});

test('nothing that belongs to the page reaches the file', async () => {
  const { page, errors } = await open();
  await page.focus('.note');
  await page.click('.note .fold');
  await page.waitForTimeout(250);

  const source = await filed(page);
  assert.ok(!/class="[^"]*marble-/.test(source), 'a derived class is not a fact about a note');
  assert.ok(!/contenteditable=/.test(source));
  assert.ok(!/tabindex=/.test(source));
  assert.ok(!/aria-expanded=/.test(source));
  // The stylesheet names the library's chrome; no element may carry it.
  assert.ok(!/class="[^"]*marble-resize/.test(source));
  // What is content stays content.
  assert.match(source, /data-marble-canvas/);
  assert.match(source, /data-expanded="no"/);
  assert.deepEqual(errors, []);
});
