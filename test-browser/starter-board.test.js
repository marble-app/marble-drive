// The Board starter, driven the way somebody works a board.
//
// Most of what a board does is the affordance library's — typing, dragging a
// card, adding one, deleting one, Mod+Z. What is this document's own is what a
// *column* is: where a new one goes, which way one moves, and what it costs to
// delete one with cards still in it. Those are the gestures worth a test, plus
// the three things that have to hold for all of them: an empty list says what
// to do, a paste arrives as text, and everything survives a reload.
//
// Every assertion is about one of three things — what the person sees, what
// reaches the file, and whether undo can get back.

import assert from 'node:assert/strict';
import test from 'node:test';

import { build } from '../server/gallery.js';
import { startDrive } from './harness.js';

const demo = await build('board', { name: 'Demo' });
const host = await startDrive({ agents: false, documents: { demo } });
test.after(() => host.close());

const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

const open = async ({ width = 1280, ...rest } = {}) => {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: { width, height: 900 }, ...rest });
  pages.push(page);
  await page.goto(`${host.base}/a/demo`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(150);
  return { page, errors };
};

/** What the file says, once everything queued has reached it. */
const filed = async (page) => {
  await page.evaluate(() => window.marble.flush());
  const answer = await fetch(`${host.base}/a/demo`, { headers: { accept: 'text/html' } });
  return answer.text();
};

/**
 * The file with the whitespace *between* elements collapsed.
 *
 * Undo is meant to end where it started, and everything the document owns does
 * — the elements, their ids, their attributes, their order. The indentation is
 * the patcher's: `remove` takes the whitespace around what it took and `insert`
 * lays its own out, so a column that leaves and comes back can carry a newline
 * across with it. That is the carrier's formatting, not the board's state.
 */
const same = (source) => source.replace(/>\s+</g, '><');

/** The board as a person reads it: the columns in order, with their cards. */
const shape = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.cols > .col')].map((col) => ({
      name: col.querySelector('h2').textContent,
      cards: [...col.querySelectorAll('.card')].map((card) => card.querySelector('h3').textContent),
      done: [...col.querySelectorAll('.card')].map((card) => card.getAttribute('data-done')),
    })),
  );

/** Generated content is the only place a drawn empty state lives. */
const drawn = (page, selector, part) =>
  page.evaluate(
    ([selector, part]) => getComputedStyle(document.querySelector(selector), part).content,
    [selector, part],
  );

const undo = async (page, times = 1) => {
  for (let at = 0; at < times; at += 1) {
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(160);
  }
};

test('three columns, and the empty one says what to do rather than sitting there', async () => {
  const { page, errors } = await open();
  assert.deepEqual(await shape(page), [
    { name: 'To do', cards: ['Something to do', 'Something after that'], done: ['no', 'no'] },
    { name: 'Doing', cards: ['Something in flight'], done: ['no'] },
    { name: 'Done', cards: [], done: [] },
  ]);

  // The Done column was a 4rem grey box that said nothing.
  assert.match(await drawn(page, '.cols > .col:nth-child(3) .cards', '::after'), /No cards yet/);
  assert.equal(await drawn(page, '.cols > .col:nth-child(1) .cards', '::after'), 'none');

  // How many cards is a count of elements, so it is counted and never kept: the
  // number is drawn by CSS and the element holding it is empty in the file.
  const counts = await page.evaluate(() =>
    [...document.querySelectorAll('.cols > .col')].map((col) => ({
      text: col.querySelector('.n').textContent,
      shown: getComputedStyle(col.querySelector('.n')).display,
      content: getComputedStyle(col.querySelector('.n'), '::after').content,
    })),
  );
  assert.deepEqual(counts.map((count) => count.text), ['', '', '']);
  assert.deepEqual(counts.map((count) => count.shown), ['block', 'block', 'none'], 'a column with no cards has no count to draw');
  assert.match(counts[0].content, /counter\(card\)/);

  // Asked of the markup rather than of the file, because the file also carries
  // the affordance library, which names all three of these in its own source.
  const markup = (await filed(page)).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  assert.ok(!/contenteditable=/.test(markup), 'the caret belongs to the page');
  assert.ok(!/class="[^"]*marble-/.test(markup), 'a derived class is not a fact about a board');
  assert.ok(!/aria-pressed|aria-disabled/.test(markup), 'nor is what a control announces');
  assert.deepEqual(errors, []);
});

test('a board with no columns left still says what to do, and undo fills it back in', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  for (const _ of [0, 1, 2]) {
    await page.click('.cols > .col:nth-child(1) .drop');
    await page.waitForTimeout(160);
  }
  assert.deepEqual(await shape(page), []);
  assert.match(await drawn(page, '.cols', '::before'), /empty board/);
  // The way to a first column is still on screen, which is the whole point of
  // the rail being a child of the strip rather than chrome beside it.
  assert.equal(await page.isVisible('.rail'), true);
  assert.ok(!(await filed(page)).includes('Something in flight'));

  await undo(page, 3);
  assert.deepEqual((await shape(page)).map((col) => col.name), ['To do', 'Doing', 'Done']);
  assert.equal(same(await filed(page)), same(before), 'three deletions and three undos left the file as it was');
  assert.deepEqual(errors, []);
});

test('+ column lands before the rail, with its own furniture, and the caret in its name', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  await page.click('.rail');
  await page.waitForTimeout(200);

  const made = await page.evaluate(() => {
    const kids = [...document.querySelector('.cols').children];
    const col = kids.at(-2);
    return {
      last: kids.at(-1).className,
      name: col.querySelector('h2').textContent,
      focused: document.activeElement === col.querySelector('h2'),
      selected: getSelection().toString(),
      // A column arrives able to take a card, or it is not a column.
      adds: Boolean(col.querySelector('.add[data-marble-add]')),
      counts: Boolean(col.querySelector('.n')),
      named: [...col.querySelectorAll('*')].every((el) => el.hasAttribute('data-marble-id')),
    };
  });
  assert.equal(made.last, 'rail', 'the rail stays the end of the strip');
  assert.equal(made.name, 'New column');
  assert.equal(made.focused, true);
  assert.equal(made.selected, 'New column', 'so the next thing typed is what it is called');
  assert.equal(made.adds, true);
  assert.equal(made.counts, true);
  assert.equal(made.named, true, 'every piece of it is addressable');

  // And the file agrees about the order, which is what an appending adder could
  // not have said: the column is before the + column button, not after it.
  const after = await filed(page);
  assert.ok(after.indexOf('New column') < after.indexOf('+ column'));
  assert.ok(after.includes('data-marble-add="#tpl-card"'));
  assert.equal((after.match(/class="rail"/g) ?? []).length, 1);

  await page.keyboard.type('Blocked');
  await page.waitForTimeout(200);
  assert.ok((await filed(page)).includes('Blocked'));

  // One gesture is one step: the name, then the column.
  await undo(page, 2);
  assert.deepEqual((await shape(page)).map((col) => col.name), ['To do', 'Doing', 'Done']);
  assert.equal(same(await filed(page)), same(before));
  assert.deepEqual(errors, []);
});

test('a column moves by a button, the file moves with it, and the ends are dead ends', async () => {
  const { page, errors } = await open();
  const before = await filed(page);
  const names = async () => (await shape(page)).map((col) => col.name);

  await page.click('.cols > .col:nth-child(1) .move[data-move="next"]');
  await page.waitForTimeout(180);
  assert.deepEqual(await names(), ['Doing', 'To do', 'Done']);
  const moved = await filed(page);
  assert.ok(moved.indexOf('>Doing<') < moved.indexOf('>To do<'));

  await undo(page);
  assert.deepEqual(await names(), ['To do', 'Doing', 'Done']);
  assert.equal(same(await filed(page)), same(before));

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(200);
  assert.deepEqual(await names(), ['Doing', 'To do', 'Done'], 'and redo puts it back');

  // The first column has nowhere earlier to go, and that is drawn rather than
  // discovered by pressing.
  const ends = await page.evaluate(() => {
    const first = document.querySelector('.cols > .col:nth-child(1) .move[data-move="prev"]');
    const last = document.querySelector('.cols > .col:nth-child(3) .move[data-move="next"]');
    return [first.className, first.getAttribute('aria-disabled'), last.getAttribute('aria-disabled')];
  });
  assert.match(ends[0], /marble-off/);
  assert.deepEqual([ends[1], ends[2]], ['true', 'true']);
  // Clicked past the disabled state rather than through it, so what is being
  // asserted is the handler's own answer and not the browser's.
  await page.evaluate(() => document.querySelector('.cols > .col:nth-child(1) .move[data-move="prev"]').click());
  await page.waitForTimeout(150);
  assert.deepEqual(await names(), ['Doing', 'To do', 'Done'], 'pressing it costs nothing');
  assert.deepEqual(errors, []);
});

test('deleting a column says how many cards went with it, and the offer brings them back', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  await page.click('.cols > .col:nth-child(1) .drop');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent('.reversal .said'), 'Removed “To do” and 2 cards');
  assert.equal(await page.isVisible('.reversal .back'), true);

  const gone = await filed(page);
  assert.ok(!gone.includes('Something to do'), 'the cards left with the column');
  assert.ok(!gone.includes('>To do<'));

  await page.click('.reversal .back');
  await page.waitForTimeout(250);
  assert.deepEqual(await shape(page), [
    { name: 'To do', cards: ['Something to do', 'Something after that'], done: ['no', 'no'] },
    { name: 'Doing', cards: ['Something in flight'], done: ['no'] },
    { name: 'Done', cards: [], done: [] },
  ]);
  // Whole, including the button that makes the next card — the reason a
  // column's furniture is addressed markup and not page chrome.
  assert.equal(same(await filed(page)), same(before), 'the column came back whole');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.col .add').length), 3);
  assert.deepEqual(errors, []);
});

test('a card crosses to the next column from the keyboard, and undo carries it home', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  // The library's handle takes the arrows; left and right are the board's own.
  await page.focus('.cols > .col:nth-child(1) .card:nth-child(1) .marble-handle');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);

  let board = await shape(page);
  assert.deepEqual(board[0].cards, ['Something after that']);
  assert.deepEqual(board[1].cards, ['Something in flight', 'Something to do']);
  const moved = await filed(page);
  assert.ok(moved.indexOf('Something in flight') < moved.indexOf('Something to do'));
  assert.equal(
    await page.evaluate(() => document.activeElement.className),
    'marble-btn marble-handle',
    'the handle keeps the focus, so the next press carries on from there',
  );

  await undo(page);
  board = await shape(page);
  assert.deepEqual(board[0].cards, ['Something to do', 'Something after that']);
  assert.equal(same(await filed(page)), same(before));
  assert.deepEqual(errors, []);
});

test('checking a card off is an op the file keeps, not a class the tab keeps', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  await page.click('.cols > .col:nth-child(1) .card:nth-child(1) .check');
  await page.waitForTimeout(200);
  const ticked = await page.evaluate(() => {
    const card = document.querySelector('.cols > .col:nth-child(1) .card');
    return {
      done: card.getAttribute('data-done'),
      pressed: card.querySelector('.check').getAttribute('aria-pressed'),
      struck: getComputedStyle(card.querySelector('h3')).textDecorationLine,
      // The count reads "done of all" the moment one of them is.
      count: getComputedStyle(card.closest('.col').querySelector('.n'), '::after').content,
    };
  });
  assert.equal(ticked.done, 'yes');
  assert.equal(ticked.pressed, 'true', 'and it says so out loud');
  assert.match(ticked.struck, /line-through/);
  assert.match(ticked.count, /counter\(done\)/);
  assert.match(await filed(page), /data-done="yes"/);

  await undo(page);
  assert.equal(await page.getAttribute('.cols > .col:nth-child(1) .card', 'data-done'), 'no');
  assert.equal(same(await filed(page)), same(before));
  assert.deepEqual(errors, []);
});

test('a card added by the button is a card, and undo takes it back off', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  await page.click('.cols > .col:nth-child(3) .add');
  await page.waitForTimeout(250);
  const added = await page.evaluate(() => {
    const card = document.querySelector('.cols > .col:nth-child(3) .card');
    return {
      title: card.querySelector('h3').textContent,
      checkable: Boolean(card.querySelector('.check[data-marble-toggle]')),
      named: [...card.querySelectorAll('*')]
        .filter((el) => !el.hasAttribute('data-marble-transient'))
        .every((el) => el.hasAttribute('data-marble-id')),
      empty: getComputedStyle(card.parentElement, '::after').content,
    };
  });
  assert.equal(added.title, 'New card');
  assert.equal(added.checkable, true);
  assert.equal(added.named, true);
  assert.equal(added.empty, 'none', 'and the empty state got out of the way');
  assert.ok((await filed(page)).includes('New card'));

  await undo(page);
  assert.deepEqual((await shape(page))[2].cards, []);
  assert.equal(same(await filed(page)), same(before));
  assert.deepEqual(errors, []);
});

test('a rich paste lands as plain text, because the editable is plaintext-only', async () => {
  const { page, errors } = await open();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: host.base });

  assert.equal(
    await page.getAttribute('.cols > .col:nth-child(1) .card h3', 'contenteditable'),
    'plaintext-only',
    'confirmed rather than assumed',
  );

  await page.click('.cols > .col:nth-child(1) .card h3');
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob(['<b style="color:red">Ship</b> the <i>thing</i>'], { type: 'text/html' }),
        'text/plain': new Blob(['Ship the thing'], { type: 'text/plain' }),
      }),
    ]),
  );
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(300);

  assert.equal(
    await page.evaluate(() => document.querySelector('.cols > .col:nth-child(1) .card h3').innerHTML),
    'Ship the thing',
    'no markup came with it',
  );
  const source = await filed(page);
  assert.ok(source.includes('>Ship the thing<'));
  assert.ok(!source.includes('color:red'), 'nor the dressing');
  assert.ok(!/<b>|<i>/.test(source));
  assert.deepEqual(errors, []);
});

test('a reload shows exactly what was left behind', async () => {
  const { page, errors } = await open();

  await page.click('.rail');                                            // a column
  await page.waitForTimeout(200);
  await page.keyboard.type('Blocked');
  await page.click('.cols > .col:nth-child(1) .card:nth-child(1) .check');  // a tick
  await page.click('.cols > .col:nth-child(2) .drop');                  // and a loss
  await page.waitForTimeout(250);
  const was = await shape(page);

  await filed(page);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(200);

  assert.deepEqual(await shape(page), was);
  assert.deepEqual(was.map((col) => col.name), ['To do', 'Done', 'Blocked']);
  assert.equal(was[0].done[0], 'yes');
  // Nothing that matters lived only in the page: the new column still adds
  // cards, and the ticked card still says it is ticked.
  assert.equal(await page.evaluate(() => document.querySelectorAll('.col .add').length), 3);
  assert.equal(await page.getAttribute('.cols > .col:nth-child(1) .card .check', 'aria-pressed'), 'true');
  assert.deepEqual(errors, []);
});

test('on a phone a board is a stack, and everything a finger presses is 44px', async () => {
  const { page, errors } = await open({ width: 390, hasTouch: true, isMobile: true });

  const stacked = await page.evaluate(() => {
    const [first, second] = document.querySelectorAll('.cols > .col');
    return {
      below: second.getBoundingClientRect().top >= first.getBoundingClientRect().bottom,
      sideways: document.querySelector('.cols').scrollWidth - document.querySelector('.cols').clientWidth,
      width: first.getBoundingClientRect().width,
    };
  });
  assert.equal(stacked.below, true, 'one column under the last, not beside it');
  assert.equal(stacked.sideways, 0, 'and nothing to scroll into off the side of the screen');
  assert.ok(stacked.width > 300, `a column is ${stacked.width}px wide`);

  const small = await page.evaluate(() => {
    const targets = [
      ...document.querySelectorAll('.col-head .tool, .add, .rail, .check, .card .marble-btn'),
    ];
    return targets
      .map((el) => ({ what: el.className, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.height < 44 - 0.5 || box.width < 32)
      .map(({ what, box }) => `${what} ${Math.round(box.width)}×${Math.round(box.height)}`);
  });
  assert.deepEqual(small, [], 'every target clears 44px under a finger');

  // Nothing hides behind a hover on a screen that has none.
  const grip = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.card > .marble-grip')).opacity,
  );
  assert.equal(grip, '1');
  assert.deepEqual(errors, []);
});
