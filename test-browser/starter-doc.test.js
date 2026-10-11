// The Document starter, driven the way somebody types into it.
//
// The flow is one editing host, so the browser — not the document — decides
// what the markup is after a keystroke. Everything the document does about that
// happens in two steps it owns: normalise() puts the flow back into its own
// vocabulary, and the difference against the last state filed becomes the ops.
// Which means the only honest test of it is a real browser making real edits,
// against a real carrier, with the file read back afterwards.
//
// Every assertion here is about one of three things: what the person sees
// selected, what reaches the file, and whether undo can get back.

import assert from 'node:assert/strict';
import test from 'node:test';

import { build } from '../server/gallery.js';
import { startDrive } from './harness.js';

const notes = await build('doc', { name: 'Notes' });
const host = await startDrive({ agents: false, documents: { notes } });
test.after(() => host.close());

const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

const open = async (how = {}) => {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: { width: 1280, height: 900 }, ...how });
  pages.push(page);
  await page.goto(`${host.base}/a/notes`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(150);
  return { page, errors };
};

/** A phone: 390 by 780, with a finger rather than a pointer. The finger is
 *  half the point — 44px targets are asked for by the pointer, so a desktop
 *  Chromium at 390px is not the thing that was too tall. */
const openPhone = () => open({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });

/** What is actually on screen, by CSS rather than by guessing. */
const shown = (page, selector) =>
  page.evaluate((selector) => getComputedStyle(document.querySelector(selector)).display !== 'none', selector);

/** The blocks of the flow, as the file would address them. */
const blocks = (page) =>
  page.evaluate(() =>
    [...document.querySelector('#flow').children].map((el) => ({
      id: el.getAttribute('data-marble-id'),
      tag: el.tagName,
      rich: el.hasAttribute('data-marble-rich'),
      text: el.textContent,
    })),
  );

/** What the file says, once everything queued has reached it. */
const filed = async (page) => {
  await page.evaluate(() => window.marble.flush());
  const answer = await fetch(`${host.base}/a/notes`, { headers: { accept: 'text/html' } });
  return answer.text();
};

/** Put the caret at the true end of a block — End stops at the end of a line. */
const caretToEndOf = (page, index) =>
  page.evaluate((index) => {
    const el = document.querySelector('#flow').children[index];
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('#flow').focus();
  }, index);

/** Put the selection across two blocks, by index and character offset. */
const select = (page, from, at, to, until) =>
  page.evaluate(([from, at, to, until]) => {
    const kids = document.querySelector('#flow').children;
    const range = document.createRange();
    range.setStart(kids[from].firstChild, at);
    range.setEnd(kids[to].firstChild, until);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('#flow').focus();
  }, [from, at, to, until]);

test('the whole flow is the editing host, and opening it files nothing', async () => {
  const { page, errors } = await open();
  const shape = await page.evaluate(() => ({
    host: document.querySelector('#flow').getAttribute('contenteditable'),
    // A block of its own would be a second editing host, which is what stops a
    // selection crossing from one paragraph into the next.
    inner: [...document.querySelector('#flow').children].filter((el) => el.hasAttribute('contenteditable')).length,
  }));
  assert.equal(shape.host, 'true');
  assert.equal(shape.inner, 0);

  const all = await blocks(page);
  assert.equal(all.length, 14);
  assert.ok(all.every((block) => block.id));
  assert.equal(new Set(all.map((block) => block.id)).size, all.length);
  // contenteditable is page-only, so the attribute must not have reached the
  // file — the word itself is all over the editor's own source.
  assert.ok(!/contenteditable=/.test(await filed(page)));
  assert.deepEqual(errors, []);
});

test('Select All takes the document rather than the paragraph', async () => {
  const { page, errors } = await open();
  await page.click('#flow > *:nth-child(3)');
  await page.keyboard.press('ControlOrMeta+a');
  const picked = await page.evaluate(() => {
    const range = getSelection().getRangeAt(0);
    const kids = [...document.querySelector('#flow').children];
    return { blocks: kids.filter((el) => range.intersectsNode(el)).length, chars: getSelection().toString().length };
  });
  assert.equal(picked.blocks, 14);
  assert.ok(picked.chars > 1500, `only ${picked.chars} characters`);
  assert.deepEqual(errors, []);
});

test('a drag selects across a heading, and the toolbar acts on every block it touched', async () => {
  const { page, errors } = await open();
  const from = await page.locator('#flow > *:nth-child(8)').boundingBox();
  const to = await page.locator('#flow > *:nth-child(10)').boundingBox();
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 90, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();

  const reached = await page.evaluate(() => {
    const range = getSelection().getRangeAt(0);
    const kids = [...document.querySelector('#flow').children];
    return kids.filter((el) => range.intersectsNode(el)).map((el) => el.tagName);
  });
  assert.deepEqual(reached, ['H3', 'P', 'P']);

  // The selection starts in a heading, whose weight is 600 because it is a
  // heading. queryCommandState reads that as "already bold" and would take the
  // mark off text that never had it, so the document asks its own markup
  // instead — and every block in the selection gets one.
  await page.keyboard.press('ControlOrMeta+b');
  await page.waitForTimeout(120);
  const marked = await page.evaluate(() =>
    [7, 8, 9].map((at) => document.querySelector('#flow').children[at].querySelectorAll('b').length > 0),
  );
  assert.deepEqual(marked, [true, true, true]);

  // Exactly where the selection was, mid-word ends included — the drag started
  // inside "Two", so the heading is filed as Tw<b>o kinds of property</b>.
  const source = await filed(page);
  const ids = await page.evaluate(() =>
    [7, 8, 9].map((at) => document.querySelector('#flow').children[at].getAttribute('data-marble-id')),
  );
  for (const id of ids) {
    const slice = source.slice(source.indexOf(id), source.indexOf(id) + 200);
    assert.match(slice, /<b>/, `the mark reached the file for ${id}`);
  }
  // Wrapping a run that was already partly marked must not nest one mark in
  // the same mark: the starter's own <b>bold</b> is still a single <b>.
  assert.ok(!/<b><b>/.test(source));
  assert.deepEqual(errors, []);
});

test('typing reaches the file, and one burst is one step of undo', async () => {
  const { page, errors } = await open();
  await page.click('#flow > *:nth-child(3)');
  await page.keyboard.press('End');
  await page.keyboard.type(' Filed as you type.');
  await page.waitForTimeout(120);

  assert.ok((await filed(page)).includes('Filed as you type.'));

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(200);
  assert.ok(!(await filed(page)).includes('Filed as you type.'), 'undo reached the file too');
  assert.deepEqual(errors, []);
});

test('Enter splits a paragraph into a new addressed block, and undo joins it back', async () => {
  const { page, errors } = await open();
  const before = await blocks(page);
  await caretToEndOf(page, 2);
  await page.keyboard.press('Enter');
  await page.keyboard.type('A second paragraph.');
  await page.waitForTimeout(120);

  const after = await blocks(page);
  assert.equal(after.length, before.length + 1);
  const made = after[3];
  assert.equal(made.tag, 'P');
  assert.equal(made.text, 'A second paragraph.');
  assert.ok(made.rich, 'a new block carries the rich affordance');
  // The browser splits a paragraph by duplicating the element, id and all.
  assert.equal(new Set(after.map((block) => block.id)).size, after.length);
  assert.ok((await filed(page)).includes('A second paragraph.'));

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(150);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(200);
  assert.equal((await blocks(page)).length, before.length);
  assert.deepEqual(errors, []);
});

test('a selection across two paragraphs is deleted as one, joining them', async () => {
  const { page, errors } = await open();
  const before = await blocks(page);
  await select(page, 8, 4, 10, 4);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);

  const after = await blocks(page);
  assert.equal(after.length, before.length - 2);
  assert.ok(after[8].text.startsWith('The '), after[8].text);
  const source = await filed(page);
  assert.ok(!source.includes(before[9].id), 'the emptied blocks left the file');
  assert.ok(!source.includes(before[10].id));

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  assert.equal((await blocks(page)).length, before.length);
  assert.deepEqual(errors, []);
});

test('the handle in the margin carries a paragraph, and files one move', async () => {
  const { page, errors } = await open();
  const before = await blocks(page);
  const carried = before[9].id;

  const over = await page.locator('#flow > *:nth-child(10)').boundingBox();
  await page.mouse.move(over.x + 60, over.y + over.height / 2);
  await page.waitForTimeout(120);
  const grip = await page.locator('.grip').boundingBox();
  assert.ok(grip, 'a handle appears beside the paragraph under the pointer');

  const landing = await page.locator('#flow > *:nth-child(3)').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(landing.x + 20, landing.y + 2, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await blocks(page);
  assert.equal(after.length, before.length, 'a move is not a copy');
  assert.equal(after[2].id, carried);
  // The handle belongs to the page, so nothing about it reaches the file.
  const source = await filed(page);
  assert.ok(!source.includes('class="grip"'));
  assert.ok(source.indexOf(carried) < source.indexOf(before[2].id), 'the file holds the new order');

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  assert.equal((await blocks(page))[9].id, carried, 'undo carries it back');
  assert.deepEqual(errors, []);
});

test('Select All and Backspace leaves one writable block, and undo restores the document', async () => {
  const { page, errors } = await open();
  const before = await blocks(page);
  await page.click('#flow > *:nth-child(3)');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);

  const left = await blocks(page);
  assert.equal(left.length, 1);
  assert.ok(left[0].rich, 'what is left is a block you can type into');
  assert.equal(left[0].text.trim(), '');

  await page.keyboard.type('Starting over.');
  await page.waitForTimeout(120);
  assert.equal((await blocks(page))[0].text, 'Starting over.');

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  assert.equal((await blocks(page)).length, before.length);
  assert.deepEqual(errors, []);
});

test('markup the browser leaves behind becomes an addressed paragraph', async () => {
  const { page, errors } = await open();
  const before = await blocks(page);

  // What a drop, a paste or an extension leaves at the top of the flow: a tag
  // the document has no style for and no id of its own. Chromium's synthesized
  // input cannot start a native text drag, so the state one arrives in is made
  // directly — which is all the document ever sees of it anyway.
  await page.evaluate(() => {
    const flow = document.querySelector('#flow');
    const stray = document.createElement('div');
    stray.textContent = 'Dropped from somewhere else.';
    flow.insertBefore(stray, flow.children[5]);
    flow.focus();
    flow.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromDrop' }));
  });
  await page.waitForTimeout(150);

  const after = await blocks(page);
  assert.equal(after.length, before.length + 1);
  assert.equal(after[5].tag, 'P');
  assert.ok(after[5].rich);
  assert.ok(after[5].id, 'and it is addressable');
  assert.equal(after[5].text, 'Dropped from somewhere else.');

  const source = await filed(page);
  assert.ok(source.includes('Dropped from somewhere else.'));
  assert.ok(!source.includes('<div>Dropped'), 'the tag the document has no style for did not reach the file');
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------- the phone
//
// At 390px this document used to put 273px of chrome — six menus, five wrapped
// rows of tools and a ruler measuring inches on a four-inch screen — above the
// first word, and then an inch of margin each side of what was left, which is
// 196px of text on a 390px screen. None of it was wrong; there was no room for
// it. What these check is that there is room now, and that nothing was thrown
// away to make it: every tool is still one press from the thumb.

test('the phone shows the document rather than the chrome', async () => {
  const { page, errors } = await openPhone();

  const room = await page.evaluate(() => ({
    chrome: document.querySelector('.work').getBoundingClientRect().top,
    rows: document.querySelector('.tools').getBoundingClientRect().height,
    firstWord: document.querySelector('#flow').getBoundingClientRect().top,
    text: document.querySelector('#flow').getBoundingClientRect().width,
  }));
  assert.ok(room.chrome < 110, `${room.chrome}px of chrome before the page`);
  // One row of 44px targets and its padding, not five.
  assert.ok(room.rows < 60, `the toolbar is ${room.rows}px tall`);
  assert.ok(room.firstWord < 160, `the first word is ${room.firstWord}px down`);
  assert.ok(room.text > 330, `only ${room.text}px of text on a 390px screen`);

  // The ruler measures inches, and there are four of them across this screen.
  assert.equal(await shown(page, '.ruler'), false);
  // Six menus became one, and it says what the six say.
  const menus = await page.evaluate(() =>
    [...document.querySelectorAll('.menus button')]
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => el.textContent),
  );
  assert.deepEqual(menus, ['Menu']);

  // Every tool a finger commits with is 44px, and nothing hides behind hover.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.tools button')]
      .filter((el) => el.offsetParent)
      .map((el) => el.getBoundingClientRect())
      .filter((box) => box.width < 44 || box.height < 44).length,
  );
  assert.equal(small, 0, 'a tool a finger can reach is at least 44px');
  assert.deepEqual(errors, []);
});

test('the rest of the toolbar is one press away, and that press files nothing', async () => {
  const { page, errors } = await openPhone();
  const before = await filed(page);

  const hidden = () =>
    page.evaluate(() => [...document.querySelectorAll('.tools button')].filter((el) => !el.offsetParent).length);
  assert.ok((await hidden()) > 10, 'most of the toolbar is behind the control');

  const corner = await page.locator('.tools .more').boundingBox();
  await page.click('.tools .more');
  await page.waitForTimeout(150);
  assert.equal(await hidden(), 0, 'and all of it is one press away');
  assert.equal(await page.getAttribute('.tools .more', 'aria-expanded'), 'true');
  // A control that moves the moment you press it is one you have to find again.
  const after = await page.locator('.tools .more').boundingBox();
  assert.deepEqual([after.x, after.y], [corner.x, corner.y], 'the control keeps its corner');

  // Which half of a toolbar somebody is looking at is attention, not content.
  assert.equal(await page.getAttribute('body', 'data-tools'), 'on');
  const source = await filed(page);
  // Asked of the <body> tag rather than of the whole file, which names the
  // attribute in a selector and in the line that sets it.
  const body = /<body[^>]*>/.exec(source)[0];
  assert.ok(!body.includes('data-tools'), 'the open toolbar did not reach the file');
  assert.ok(!/<button[^>]*tabindex/.test(source), 'nor did the tab stop inside it');
  assert.equal(source, before, 'nothing at all reached the file');
  assert.deepEqual(errors, []);
});

test('the one menu on a phone is the six, one press deeper', async () => {
  const { page, errors } = await openPhone();
  await page.click('.menus .all');
  await page.waitForTimeout(120);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#popup button')].map((el) => el.textContent));
  assert.deepEqual(rows, ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools']);

  await page.click('#popup button:nth-child(3)');
  await page.waitForTimeout(120);
  const view = await page.evaluate(() => [...document.querySelectorAll('#popup button')].map((el) => el.textContent));
  assert.deepEqual(view, ['Outline', 'Ruler', 'Fonts']);
  assert.deepEqual(errors, []);
});

test('a 200-character word breaks rather than carrying the page sideways', async () => {
  const { page, errors } = await openPhone();
  await caretToEndOf(page, 2);
  await page.keyboard.type(' ' + 'w'.repeat(200));
  await page.waitForTimeout(200);
  const held = await page.evaluate(() => {
    const scroll = document.querySelector('.scroll');
    return {
      sideways: scroll.scrollWidth - scroll.clientWidth,
      page: document.querySelector('#page').getBoundingClientRect().width,
    };
  });
  assert.equal(held.sideways, 0, 'the page did not grow sideways');
  assert.ok(held.page <= 390, `the page is ${held.page}px wide`);
  assert.deepEqual(errors, []);
});

// ------------------------------------------------------------- the keyboard
//
// The software keyboard takes room off the bottom of the screen and *moves*
// the room, sliding the visible strip down the layout viewport. A headless
// Chromium has no keyboard to raise, so what is checked is the wiring: both
// halves are written, and the layout is built out of them rather than beside
// them.

test('the layout is built out of both halves of the visual viewport', async () => {
  const { page, errors } = await openPhone();
  const at = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return { kb: css.getPropertyValue('--kb').trim(), top: css.getPropertyValue('--vv-top').trim() };
  });
  assert.equal(at.kb, '0px', 'no keyboard, no inset');
  assert.equal(at.top, '0px', 'and the strip starts at the top');

  const moved = await page.evaluate(() => {
    const count = document.querySelector('#count');
    const box = () => document.body.getBoundingClientRect();
    const was = { bottom: count.getBoundingClientRect().bottom, top: box().top, height: box().height };
    document.documentElement.style.setProperty('--kb', '300px');
    const kb = {
      lift: was.bottom - count.getBoundingClientRect().bottom,
      shrink: was.height - box().height,
    };
    // The other half: the keyboard slides the visible strip down the layout
    // viewport as well as shrinking it, and everything the page put at the top
    // is then exactly that far above the screen.
    document.documentElement.style.setProperty('--kb', '0px');
    document.documentElement.style.setProperty('--vv-top', '120px');
    return { ...kb, slid: box().top - was.top, lost: was.height - box().height };
  });
  assert.equal(moved.lift, 300, 'the word count sits above the keyboard');
  assert.equal(moved.shrink, 300, 'and the field you are typing in ends above it');
  assert.equal(moved.slid, 120, 'the toolbar comes down with the visible strip');
  assert.equal(moved.lost, 120, 'and the app is still exactly that strip');
  assert.deepEqual(errors, []);
});

// ------------------------------------------------------------- on paper
//
// This starter draws an 8.5in page with a ruler setting its margins and, until
// there was a print stylesheet, no way at all to get that onto one.

test('printing drops the interface and keeps the page', async () => {
  // Opened in the dark, because paper is white whatever the screen was set to.
  const { page, errors } = await open({ colorScheme: 'dark' });
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(120);

  for (const chrome of ['.bar', '.tools', '.ruler', '.outline', '#count', '#popup', '.fonts']) {
    assert.equal(await shown(page, chrome), false, `${chrome} printed`);
  }
  assert.equal(await shown(page, '#flow'), true, 'the notes did not');

  const paper = await page.evaluate(() => {
    const page_ = document.querySelector('#page');
    return {
      ink: getComputedStyle(document.body).color,
      paper: getComputedStyle(page_).backgroundColor,
      margins: getComputedStyle(page_).padding,
      // The scroller and the column that holds it are for a screen.
      clipped: getComputedStyle(document.body).overflow,
      scrolls: getComputedStyle(document.querySelector('.scroll')).overflow,
      // A heading is not left at the bottom of a sheet on its own.
      heading: getComputedStyle(document.querySelector('#flow > h2')).breakAfter,
    };
  });
  assert.equal(paper.ink, 'rgb(0, 0, 0)');
  assert.equal(paper.paper, 'rgb(255, 255, 255)');
  // The inch each side that the ruler was drawing all along.
  assert.equal(paper.margins, '0px 96px');
  assert.equal(paper.clipped, 'visible');
  assert.equal(paper.scrolls, 'visible');
  assert.equal(paper.heading, 'avoid');
  assert.deepEqual(errors, []);
});

// ------------------------------------------------------- reaching the chrome

test('the toolbar is one tab stop, and the arrows move inside it', async () => {
  const { page, errors } = await open();

  const stops = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.tools button')]
        .filter((el) => el.offsetParent && !el.disabled)
        .filter((el) => el.getAttribute('tabindex') === '0')
        .map((el) => el.getAttribute('data-cmd') ?? el.getAttribute('data-pick')),
    );
  assert.equal((await stops()).length, 1, 'one tool holds the tab stop');

  await page.focus('[data-cmd="bold"]');
  await page.waitForTimeout(60);
  assert.deepEqual(await stops(), ['bold'], 'and it follows the focus');

  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-cmd')), 'italic');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  // Backwards past the two halves of the size stepper, which are tools too.
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-cmd')), 'bigger');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-pick')), 'style');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-cmd')), 'fonts');
  assert.equal((await stops()).length, 1, 'still one tab stop, at the end');

  // And nothing about where somebody's focus is reaches the file.
  assert.ok(!(await filed(page)).includes('tabindex='));
  assert.deepEqual(errors, []);
});

test('a menu opens, walks and closes without a pointer', async () => {
  const { page, errors } = await open();
  await page.focus('.menus [data-menu="view"]');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  assert.equal(await page.getAttribute('.menus [data-menu="view"]', 'aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Outline');

  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Ruler');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  assert.equal(await page.getAttribute('.menus [data-menu="view"]', 'aria-expanded'), 'false');
  assert.equal(await shown(page, '#popup'), false);
  // The key goes back to the button that opened it, not to nowhere.
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-menu')), 'view');
  assert.deepEqual(errors, []);
});

test('a lit tool says so to a screen reader as well as in colour', async () => {
  const { page, errors } = await open();
  await select(page, 2, 0, 2, 12);
  await page.keyboard.press('ControlOrMeta+b');
  await page.waitForTimeout(150);
  assert.equal(await page.getAttribute('[data-cmd="bold"]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('[data-cmd="italic"]', 'aria-pressed'), 'false');
  // Which tool is lit is read off the notes every time, never kept beside them.
  assert.ok(!(await filed(page)).includes('aria-pressed="true"'));
  assert.deepEqual(errors, []);
});

test('the toolbar reports the block the caret is in, at every width', async () => {
  // Reported as "23 on a phone where the desktop says 10.5". It is neither a
  // width nor a readback: both widths say 23 with the caret nowhere, because
  // with nothing selected the commands fall back to the first block and the
  // first block is the Title. Clicking into the body says 10.5 at both. What
  // was wrong was the resting text in the markup, which said Body/10.5 while
  // the moment a host arrived it said Title/23.
  for (const how of [{}, { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true }]) {
    const { page, errors } = await open(how);
    const read = () =>
      page.evaluate(() => ({
        style: document.querySelector('#now-style').textContent,
        pt: document.querySelector('#now-pt').textContent,
      }));
    assert.deepEqual(await read(), { style: 'Title', pt: '23' }, 'the caret starts in the title');
    await page.click('#flow > *:nth-child(3)');
    await page.waitForTimeout(120);
    assert.deepEqual(await read(), { style: 'Body', pt: '10.5' }, 'and follows it into the body');
    assert.deepEqual(errors, []);
  }
});
