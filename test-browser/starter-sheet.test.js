// The Sheet starter, driven the way somebody keeps a spreadsheet in it.
//
// A sheet has two facts and a pile of readings of them. The facts are the cells
// and one number saying how many columns there are; the readings are the row
// numbers, the column letters, the totals, the right-alignment of a numeric
// column and the template + row clones. Every assertion here is about one of
// three things: that a gesture reaches the file, that a reading never does, and
// that Mod+Z gets back to where the document started.

import assert from 'node:assert/strict';
import test from 'node:test';

import { build } from '../server/gallery.js';
import { startDrive } from './harness.js';

const ledger = await build('sheet', { name: 'Ledger' });
const host = await startDrive({ agents: false, documents: { ledger } });
test.after(() => host.close());

// A leaked page keeps the browser — and so the host — alive after the suite.
const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

const open = async ({ width = 1280, height = 900 } = {}) => {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: { width, height } });
  pages.push(page);
  await page.goto(`${host.base}/a/ledger`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(150);
  return { page, errors };
};

/** What the file says, once everything queued has reached it. */
const filed = async (page) => {
  await page.evaluate(() => window.marble.flush());
  const answer = await fetch(`${host.base}/a/ledger`, { headers: { accept: 'text/html' } });
  return answer.text();
};

/** The sheet as a person reads it: the heading, the rows, and the totals. */
const shape = (page) =>
  page.evaluate(() => {
    const cells = (row) => [...row.querySelectorAll(':scope > .cell')].map((cell) => cell.textContent);
    return {
      cols: Number(getComputedStyle(document.querySelector('#grid')).getPropertyValue('--cols')),
      head: cells(document.querySelector('#head')),
      rows: [...document.querySelectorAll('#rows > .row')].map(cells),
      totals: [...document.querySelectorAll('#foot .cell')].map((cell) => cell.textContent),
      numeric: [...document.querySelectorAll('#head > .cell')].map((cell) => cell.classList.contains('marble-num')),
    };
  });

/** Put the caret in a cell, at a character offset inside it. */
const caretAt = (page, row, column, offset) =>
  page.evaluate(([row, column, offset]) => {
    const rows = [document.querySelector('#head'), ...document.querySelectorAll('#rows > .row')];
    const cell = rows[row].querySelectorAll(':scope > .cell')[column];
    cell.focus();
    const range = document.createRange();
    const text = cell.firstChild;
    if (text) range.setStart(text, Math.min(offset, text.length));
    else range.selectNodeContents(cell);
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, [row, column, offset]);

/** Which cell the caret is in, and where in it — the thing a key press moves. */
const caret = (page) =>
  page.evaluate(() => {
    const cell = document.activeElement?.closest?.('.cell');
    if (!cell) return null;
    const rows = [document.querySelector('#head'), ...document.querySelectorAll('#rows > .row')];
    const row = rows.findIndex((r) => r.contains(cell));
    const selection = getSelection();
    const upto = document.createRange();
    upto.selectNodeContents(cell);
    if (selection.rangeCount) upto.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
    return {
      row,
      column: [...rows[row].querySelectorAll(':scope > .cell')].indexOf(cell),
      text: cell.textContent,
      at: upto.toString().length,
      selected: selection.toString(),
      inside: cell.contains(selection.anchorNode),
    };
  });

const undo = async (page, times = 1) => {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(200);
  }
};
const redo = async (page, times = 1) => {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForTimeout(200);
  }
};

test('the grid is addressed, and everything read off it is not in the file', async () => {
  const { page, errors } = await open();
  const now = await shape(page);
  assert.equal(now.cols, 4);
  assert.deepEqual(now.head, ['Item', 'Owner', 'Due', 'Cost']);
  assert.equal(now.rows.length, 3);
  assert.ok(now.rows.every((row) => row.length === 4), 'every row has a cell per column');

  // The totals, the row numbers and the column letters are all readings. None of
  // them may be in the file: a stored sum is a sum that goes stale.
  assert.deepEqual(now.totals, ['', '', '', '168.5']);
  assert.deepEqual(now.numeric, [false, false, false, true], 'only the column of numbers right-aligns');

  const source = await filed(page);
  assert.match(source, /id="foot" data-marble-transient aria-label="Column totals"><\/div>/, 'the totals row is empty in the file');
  assert.ok(!source.includes('168.5'), 'the sum is counted, never stored');
  assert.ok(!/class="[^"]*marble-(num|here)/.test(source), 'a derived class is not a fact about a cell');
  // The page's own chrome does not need a name in the file, and anything worth
  // naming is not the page's — so no element carries both. Asked of the markup,
  // because the affordance copy spliced in here names both attributes in prose.
  const markup = source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  assert.ok(!/data-marble-transient[^>]*data-marble-id|data-marble-id[^>]*data-marble-transient/.test(markup));

  // The row numbers and the column letters are counters, so the markup says
  // neither — which is why reordering renumbers without an op.
  const gutter = await page.evaluate(() => ({
    numbers: [...document.querySelectorAll('#rows > .row')].map((row) => getComputedStyle(row, '::before').content),
    letter: getComputedStyle(document.querySelector('#head > .cell'), '::after').content,
  }));
  assert.equal(gutter.numbers.length, 3);
  assert.match(gutter.letter, /counter|"A"/);
  assert.deepEqual(errors, []);
});

test('a phone never moves sideways — the rows scroll and the page does not', async () => {
  const { page, errors } = await open({ width: 390, height: 844 });
  const fit = await page.evaluate(() => {
    const root = document.scrollingElement;
    const box = document.querySelector('#scroll');
    return {
      page: [root.scrollWidth, root.clientWidth],
      rows: [box.scrollWidth, box.clientWidth],
      gutterSticky: getComputedStyle(document.querySelector('#rows > .row'), '::before').position,
      headSticky: getComputedStyle(document.querySelector('#head')).position,
    };
  });
  assert.equal(fit.page[0], fit.page[1], 'the page itself has nowhere to scroll sideways');
  assert.ok(fit.rows[0] > fit.rows[1], 'the grid does, inside its own box');
  assert.equal(fit.gutterSticky, 'sticky');
  assert.equal(fit.headSticky, 'sticky');

  // A 200-character word is content, not a layout: it wraps inside its column and
  // widens nothing, because the grid's width is asked of --cols and --w.
  await caretAt(page, 1, 0, 0);
  await page.keyboard.insertText('x'.repeat(200));
  await page.waitForTimeout(200);
  assert.ok((await filed(page)).includes('x'.repeat(200)), 'the word really is in the cell');
  const after = await page.evaluate(() => [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth, document.querySelector('#scroll').scrollWidth]);
  assert.equal(after[0], after[1], 'still nothing to scroll sideways on the page');
  assert.equal(after[2], fit.rows[0], 'and the grid is exactly as wide as it was');
  assert.deepEqual(errors, []);
});

test('Tab commits and moves right, wrapping into the next row', async () => {
  const { page, errors } = await open();
  await caretAt(page, 1, 0, 3);
  await page.keyboard.press('Tab');
  let where = await caret(page);
  assert.deepEqual([where.row, where.column], [1, 1]);
  assert.equal(where.text, 'You');
  assert.equal(where.selected, 'You', 'arriving takes the cell, so typing replaces it');

  // Off the end of a row and into the next one.
  await caretAt(page, 1, 3, 0);
  await page.keyboard.press('Tab');
  where = await caret(page);
  assert.deepEqual([where.row, where.column], [2, 0]);
  assert.equal(where.text, 'Second thing');

  // And back the way it came.
  await page.keyboard.press('Shift+Tab');
  where = await caret(page);
  assert.deepEqual([where.row, where.column], [1, 3]);

  // Typing over the taken cell files that text and nothing else.
  await page.keyboard.type('99');
  await page.waitForTimeout(200);
  assert.deepEqual((await shape(page)).rows[0], ['First thing', 'You', 'Friday', '99']);
  assert.match(await filed(page), />99</);
  assert.deepEqual(errors, []);
});

test('Enter moves down the column, and stops at the bottom of it', async () => {
  const { page, errors } = await open();
  await caretAt(page, 0, 0, 0);
  await page.keyboard.press('Enter');
  let where = await caret(page);
  assert.deepEqual([where.row, where.column], [1, 0], 'out of the heading and into the first row');

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  where = await caret(page);
  assert.deepEqual([where.row, where.column], [3, 0]);

  // The last row has nowhere below it, so Enter means what it means there: the
  // edit is over and the caret leaves.
  await page.keyboard.press('Enter');
  assert.equal(await caret(page), null);
  assert.deepEqual(errors, []);
});

test('the arrows cross a cell boundary only from the edge of one', async () => {
  const { page, errors } = await open();
  // Mid-word, the arrow belongs to the text.
  await caretAt(page, 1, 0, 3);
  await page.keyboard.press('ArrowRight');
  let where = await caret(page);
  assert.deepEqual([where.row, where.column], [1, 0], 'still in the same cell');
  assert.equal(where.at, 4, 'the caret moved one character');

  // At the end of it, the same key leaves.
  await caretAt(page, 1, 0, 'First thing'.length);
  await page.keyboard.press('ArrowRight');
  where = await caret(page);
  assert.deepEqual([where.row, where.column], [1, 1]);
  assert.equal(where.at, 0, 'and lands at the edge it came in from');
  assert.ok(where.inside, 'the caret is really in the new cell, not only the focus');

  await page.keyboard.press('ArrowLeft');
  where = await caret(page);
  assert.deepEqual([where.row, where.column], [1, 0]);
  assert.equal(where.at, 'First thing'.length);

  await page.keyboard.press('ArrowDown');
  where = await caret(page);
  assert.deepEqual([where.row, where.column], [2, 0]);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  where = await caret(page);
  assert.deepEqual([where.row, where.column], [0, 0], 'up out of the rows and into the heading');
  assert.deepEqual(errors, []);
});

test('a paste into a cell arrives as plain text', async () => {
  const { page, errors } = await open();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async () => {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob(['<b style="color:red">bold</b> and <i>slanted</i>'], { type: 'text/html' }),
        'text/plain': new Blob(['bold and slanted'], { type: 'text/plain' }),
      }),
    ]);
  });
  await caretAt(page, 1, 1, 'You'.length);
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(250);

  assert.equal((await shape(page)).rows[0][1], 'Youbold and slanted');
  const source = await filed(page);
  assert.ok(source.includes('Youbold and slanted'));
  assert.ok(!source.includes('color:red'), 'the dressing did not come with it');
  assert.ok(!/<b>|<i>/.test(source), 'nor the tags it was wearing');
  // The cell is a setText affordance, and that is the reason: a setText's inverse
  // is another setText, so an element inside one could never be undone back.
  assert.equal(
    await page.evaluate(() => document.querySelector('#rows .cell').getAttribute('contenteditable')),
    'plaintext-only',
  );
  assert.deepEqual(errors, []);
});

test('+ column is one undo step, and the template grows with it', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  await page.click('#add-col');
  await page.waitForTimeout(250);
  let now = await shape(page);
  assert.equal(now.cols, 5);
  assert.deepEqual(now.head, ['Item', 'Owner', 'Due', 'Cost', 'Column']);
  assert.ok(now.rows.every((row) => row.length === 5));
  const added = await filed(page);
  assert.match(added, /--cols:5/);

  // + row clones a template, so a four-cell template in a five-column sheet would
  // make a short row. The template is the page's, so it is derived rather than
  // written — and this is the thing that proves it.
  assert.equal(await page.evaluate(() => document.querySelector('#tpl-row').content.firstElementChild.children.length), 5);
  await page.click('[data-marble-add]');
  await page.waitForTimeout(250);
  assert.equal((await shape(page)).rows.at(-1).length, 5);

  await undo(page, 2);
  now = await shape(page);
  assert.equal(now.cols, 4, 'one press took the whole column, not a cell of it');
  assert.equal(now.rows.length, 3);
  assert.equal(await filed(page), before, 'and the file is byte for byte where it started');

  await redo(page, 2);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#head > .cell').length), 5);
  assert.deepEqual(errors, []);
});

test('− column takes the column the caret is in, and gives it back whole', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  // Arming a column is the caret being in it, and the heading says so.
  await caretAt(page, 1, 1, 0);
  await page.waitForTimeout(100);
  assert.deepEqual(
    await page.evaluate(() => [...document.querySelectorAll('#head > .cell')].map((c) => c.classList.contains('marble-here'))),
    [false, true, false, false],
  );

  await page.click('#drop-col');
  await page.waitForTimeout(250);
  let now = await shape(page);
  assert.equal(now.cols, 3);
  assert.deepEqual(now.head, ['Item', 'Due', 'Cost'], 'the armed column left, not the last one');
  assert.deepEqual(now.rows[0], ['First thing', 'Friday', '120']);
  assert.deepEqual(now.totals, ['', '', '168.5'], 'and the totals moved with it');
  let source = await filed(page);
  assert.match(source, /--cols:3/);
  assert.ok(!source.includes('>Owner<'));
  assert.match(await page.textContent('#said'), /Column B removed/);

  await undo(page);
  now = await shape(page);
  assert.equal(now.cols, 4);
  assert.deepEqual(now.head, ['Item', 'Owner', 'Due', 'Cost']);
  assert.deepEqual(now.rows[0], ['First thing', 'You', 'Friday', '120'], 'with its text, in its place');
  assert.equal(await filed(page), before, 'byte for byte where it started');

  await redo(page);
  assert.equal((await shape(page)).cols, 3);
  assert.deepEqual(errors, []);
});

test('a row added and a row deleted both go back', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  await page.click('[data-marble-add]');
  await page.waitForTimeout(250);
  assert.equal((await shape(page)).rows.length, 4);
  await page.keyboard.type('Fourth thing');
  await page.waitForTimeout(200);
  assert.ok((await filed(page)).includes('Fourth thing'));

  await undo(page, 2);
  assert.equal((await shape(page)).rows.length, 3);
  assert.equal(await filed(page), before);

  // The × on a row files a remove with a real inverse, and the sheet says where
  // the row went rather than leaving a gap and a "saved" in the corner.
  await page.click('#rows > .row:nth-child(2) .marble-remove');
  await page.waitForTimeout(250);
  let now = await shape(page);
  assert.equal(now.rows.length, 2);
  assert.deepEqual(now.rows.map((row) => row[0]), ['First thing', 'Third thing']);
  assert.match(await page.textContent('#said'), /Ctrl\+Z/);
  assert.ok(!(await filed(page)).includes('Second thing'));

  await undo(page);
  now = await shape(page);
  assert.deepEqual(now.rows.map((row) => row[0]), ['First thing', 'Second thing', 'Third thing']);
  assert.equal(await filed(page), before, 'the row came back whole');
  assert.deepEqual(errors, []);
});

test('an emptied sheet says what to do, and does not collapse', async () => {
  const { page, errors } = await open();
  for (const _ of [0, 1, 2]) {
    await page.click('#rows > .row:first-child .marble-remove');
    await page.waitForTimeout(200);
  }

  const empty = await page.evaluate(() => ({
    rows: document.querySelectorAll('#rows > .row').length,
    height: document.querySelector('#scroll').getBoundingClientRect().height,
    prompt: getComputedStyle(document.querySelector('#rows'), '::before').content,
    foot: getComputedStyle(document.querySelector('#foot')).display,
    head: document.querySelectorAll('#head > .cell').length,
  }));
  assert.equal(empty.rows, 0);
  assert.ok(empty.height > 80, `the sheet collapsed to ${empty.height}px`);
  assert.match(empty.prompt, /No rows yet/);
  assert.equal(empty.foot, 'none', 'nothing to total, so nothing totalled');
  assert.equal(empty.head, 4, 'the columns are still there to put a row back into');

  // And + row starts one, numbered 1 again.
  await page.click('[data-marble-add]');
  await page.waitForTimeout(250);
  assert.equal((await shape(page)).rows.length, 1);
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector('#rows > .row'), '::before').content),
    'counter(row)',
  );
  assert.deepEqual(errors, []);
});

test('the totals toggle is a fact about the sheet, and survives the reload', async () => {
  const { page, errors } = await open();
  const toggle = '[data-marble-toggle]';
  assert.equal(await page.getAttribute(toggle, 'aria-pressed'), 'true');
  await page.click(toggle);
  await page.waitForTimeout(250);
  assert.equal(await page.getAttribute(toggle, 'aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#foot')).display), 'none');
  assert.match(await filed(page), /data-totals="off"/);

  await undo(page);
  assert.equal(await page.getAttribute(toggle, 'aria-pressed'), 'true');
  assert.deepEqual(errors, []);
});

test('everything a gesture changed is still there after a reload', async () => {
  const { page, errors } = await open();
  await page.click('#add-col');
  await page.waitForTimeout(200);
  await caretAt(page, 1, 4, 0);
  await page.keyboard.type('7.5');
  await page.click('#rows > .row:nth-child(3) .marble-remove');
  await page.waitForTimeout(250);
  const before = await shape(page);
  assert.equal(before.cols, 5);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(250);
  const after = await shape(page);
  assert.deepEqual(after, before, 'the page is a reading of the file, so it reads the same');
  assert.equal(after.totals[4], '7.5', 'including the totals, counted again from the cells');
  assert.deepEqual(errors, []);
});
