// The Note starter, driven the way somebody jots into it.
//
// A note is one editing host and there are several notes in the file, so two
// things have to hold at once: the browser's idea of the markup after a keystroke
// gets turned back into the document's vocabulary and filed as ops, and only the
// open note is ever typeable. Which one that is, is a single attribute — so the
// list in the rail, the class that shows the page and the class that lights its
// row all have to be derivations, and none of them may reach the file.
//
// Every assertion here is about one of three things: what the person sees, what
// reaches the file, and whether undo can get back.

import assert from 'node:assert/strict';
import test from 'node:test';

import { build } from '../server/gallery.js';
import { startDrive } from './harness.js';

const scratch = await build('note', { name: 'Scratch' });
const host = await startDrive({ agents: false, documents: { scratch } });
test.after(() => host.close());

const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

const open = async ({ viewport = { width: 1280, height: 900 }, ...rest } = {}) => {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport, ...rest });
  pages.push(page);
  await page.goto(`${host.base}/a/scratch`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(150);
  return { page, errors };
};

/** A phone, with a finger rather than a pointer. */
const openPhone = () => open({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });

/** The keyboard coming up, as the browser reports it: the visual viewport
 *  shrinks by `kb`, and — on a browser that has to lift the caret clear — slides
 *  `offsetTop` down the layout viewport as well. Both halves, because a page
 *  that answers only the first looks right until it meets the other. */
const raiseKeyboard = async (page, kb, offsetTop = 0) => {
  await page.evaluate(({ kb: taken, offsetTop: slid }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - taken, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: slid, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  }, { kb, offsetTop });
  await page.waitForTimeout(150);
};

/** Where the person can actually see, and what is standing in it. */
const seen = (page) =>
  page.evaluate(() => {
    const vv = window.visualViewport;
    const box = (sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null;
    };
    const root = getComputedStyle(document.documentElement);
    return {
      kb: root.getPropertyValue('--kb').trim(),
      vvTop: root.getPropertyValue('--vv-top').trim(),
      strip: { top: Math.round(vv.offsetTop), bottom: Math.round(vv.offsetTop + vv.height) },
      shell: box('body.app'),
      pill: box('.marble-status'),
    };
  });

/** The blocks of the open note, as the file would address them. */
const blocks = (page) =>
  page.evaluate(() =>
    [...document.querySelector('.note.marble-open').children].map((el) => ({
      id: el.getAttribute('data-marble-id'),
      tag: el.tagName,
      rich: el.hasAttribute('data-marble-rich'),
      list: el.getAttribute('data-list'),
      text: el.textContent,
    })),
  );

/** What the file says, once everything queued has reached it. */
const filed = async (page) => {
  await page.evaluate(() => window.marble.flush());
  const answer = await fetch(`${host.base}/a/scratch`, { headers: { accept: 'text/html' } });
  return answer.text();
};

/** Put the caret at the true end of a block — End stops at the end of a line. */
const caretToEndOf = (page, index) =>
  page.evaluate((index) => {
    const note = document.querySelector('.note.marble-open');
    const range = document.createRange();
    range.selectNodeContents(note.children[index]);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    note.focus();
  }, index);

const select = (page, from, at, to, until) =>
  page.evaluate(([from, at, to, until]) => {
    const note = document.querySelector('.note.marble-open');
    const range = document.createRange();
    range.setStart(note.children[from].firstChild, at);
    range.setEnd(note.children[to].firstChild, until);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    note.focus();
  }, [from, at, to, until]);

test('one note is the editing host, and opening it files nothing', async () => {
  const { page, errors } = await open();
  const shape = await page.evaluate(() => ({
    notes: document.querySelectorAll('.note').length,
    open: document.querySelectorAll('.note.marble-open').length,
    hosts: [...document.querySelectorAll('[contenteditable]')].filter((el) => el.closest('.notes')).length,
    // A block of its own would be a second editing host, which is what stops a
    // selection crossing from one line into the next.
    inner: [...document.querySelector('.note.marble-open').children]
      .filter((el) => el.hasAttribute('contenteditable')).length,
  }));
  assert.equal(shape.notes, 2);
  assert.equal(shape.open, 1);
  assert.equal(shape.hosts, 1, 'only the open note is typeable');
  assert.equal(shape.inner, 0);

  const all = await blocks(page);
  assert.ok(all.length >= 4);
  assert.ok(all.every((block) => block.id && block.rich));
  assert.equal(new Set(all.map((block) => block.id)).size, all.length);

  const source = await filed(page);
  // Every one of these is derived or page-only, so none may be carried by an
  // element in the file — the names themselves are all over the stylesheet.
  assert.ok(!/contenteditable=/.test(source));
  assert.ok(!/class="[^"]*marble-/.test(source), 'a derived class is not a fact about a note');
  // The rail's own container is in the file; nothing it is filled with is.
  assert.ok(!/class="row"/.test(source), 'the rail is a reading, not a copy');
  assert.ok(!/class="open"/.test(source));
  assert.match(source, /class="rows" id="rows" role="list" data-marble-transient><\/div>/);
  assert.deepEqual(errors, []);
});

test('the rail is the notes read back — first line for the name', async () => {
  const { page, errors } = await open();
  const rail = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.row .t')].map((el) => el.textContent),
    under: [...document.querySelectorAll('.row .s')].map((el) => el.textContent.slice(0, 20)),
    lit: [...document.querySelectorAll('.row')].map((el) => el.classList.contains('marble-current')),
    meta: document.querySelector('.meta').textContent,
  }));
  assert.deepEqual(rail.rows, ['Scratch', 'Keys']);
  assert.equal(rail.lit[0], true, 'the open note is the lit row');
  assert.equal(rail.lit[1], false);
  assert.ok(rail.under[0].length > 0, 'and the line under it is the rest of the note');
  assert.equal(rail.meta, '2 notes');

  // Rename the note by typing over its first line: the rail follows, because it
  // is the same fact read again rather than a second copy of it.
  await caretToEndOf(page, 0);
  await page.keyboard.type('pad');
  await page.waitForTimeout(150);
  assert.equal(await page.textContent('.row.marble-current .t'), 'Scratchpad');
  assert.ok((await filed(page)).includes('Scratchpad'));
  assert.deepEqual(errors, []);
});

test('Select All takes the note rather than the line', async () => {
  const { page, errors } = await open();
  await page.click('.note.marble-open > *:nth-child(2)');
  await page.keyboard.press('ControlOrMeta+a');
  const picked = await page.evaluate(() => {
    const range = getSelection().getRangeAt(0);
    const kids = [...document.querySelector('.note.marble-open').children];
    return { blocks: kids.filter((el) => range.intersectsNode(el)).length, chars: getSelection().toString().length };
  });
  assert.equal(picked.blocks, (await blocks(page)).length);
  assert.ok(picked.chars > 400, `only ${picked.chars} characters`);
  assert.deepEqual(errors, []);
});

test('typing reaches the file, and one burst is one step of undo', async () => {
  const { page, errors } = await open();
  await caretToEndOf(page, 1);
  await page.keyboard.type(' Filed as you type.');
  await page.waitForTimeout(150);
  assert.ok((await filed(page)).includes('Filed as you type.'));

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  assert.ok(!(await filed(page)).includes('Filed as you type.'), 'undo reached the file too');
  assert.deepEqual(errors, []);
});

test('Enter splits a line into a new addressed block, and undo joins it back', async () => {
  const { page, errors } = await open();
  const before = await blocks(page);
  await caretToEndOf(page, 1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('A second line.');
  await page.waitForTimeout(150);

  const after = await blocks(page);
  assert.equal(after.length, before.length + 1);
  assert.equal(after[2].tag, 'P');
  assert.equal(after[2].text, 'A second line.');
  assert.ok(after[2].rich);
  // The browser splits a paragraph by duplicating the element, id and all.
  assert.equal(new Set(after.map((block) => block.id)).size, after.length);
  assert.ok((await filed(page)).includes('A second line.'));

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(200);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  assert.equal((await blocks(page)).length, before.length);
  assert.deepEqual(errors, []);
});

test('the markers are the formatting: # a heading, - a bullet, --- a rule', async () => {
  const { page, errors } = await open();
  await caretToEndOf(page, 1);
  await page.keyboard.press('Enter');

  await page.keyboard.type('# ');
  await page.waitForTimeout(150);
  let made = (await blocks(page))[2];
  assert.equal(made.tag, 'H2', 'the marker became the heading it was drawing');
  assert.equal(made.text, '', 'and the marker itself is gone');
  await page.keyboard.type('A heading');
  await page.waitForTimeout(150);

  await page.keyboard.press('Enter');
  await page.keyboard.type('- a bullet');
  await page.waitForTimeout(150);
  made = (await blocks(page))[3];
  assert.equal(made.tag, 'P');
  assert.equal(made.list, 'bullet');
  assert.equal(made.text, 'a bullet');

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('---');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const all = await blocks(page);
  assert.ok(all.some((block) => block.tag === 'HR'), 'three dashes and Enter drew a rule');

  const source = await filed(page);
  assert.match(source, /<h2[^>]*>A heading<\/h2>/);
  assert.match(source, /data-list="bullet"/);
  assert.match(source, /<hr/);
  // The marker is taken off and the block restyled inside one change, so one
  // press of undo puts the whole shortcut back.
  assert.deepEqual(errors, []);
});

test('bold marks exactly what was selected, across lines', async () => {
  const { page, errors } = await open();
  // The second line of this note already holds two marks of its own, so the
  // question is never "is there a <b>" but "is there one more than there was".
  const count = () =>
    page.evaluate(() =>
      [1, 2].map((at) => document.querySelector('.note.marble-open').children[at].querySelectorAll('b').length),
    );
  const before = await count();
  await select(page, 1, 4, 2, 6);
  await page.keyboard.press('ControlOrMeta+b');
  await page.waitForTimeout(200);

  const marked = await count();
  assert.ok(marked[0] > before[0], 'the line the selection started in');
  assert.ok(marked[1] > before[1], 'and the one it ended in');
  const source = await filed(page);
  assert.ok(/<b>/.test(source));
  // Wrapping a run that was already partly marked must not nest one mark in
  // the same mark.
  assert.ok(!/<b><b>/.test(source));

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  assert.deepEqual(await count(), before, 'undo takes the mark off again, and only it');
  assert.deepEqual(errors, []);
});

test('a mark with nothing selected opens at the caret and eats nothing', async () => {
  const { page, errors } = await open();
  await caretToEndOf(page, 1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ask about the ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('positioning');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type(' before Friday.');
  await page.waitForTimeout(250);

  // Selecting the line on the person's behalf — which is what a document with a
  // toolbar can afford to do — means the next character they type replaces it.
  const made = (await blocks(page))[2];
  assert.equal(made.text, 'Ask about the positioning before Friday.');
  const source = await filed(page);
  assert.ok(source.includes('Ask about the <b>positioning</b> before Friday.'));
  assert.deepEqual(errors, []);
});

test('an emptied line keeps its caret, wherever the bullet is drawn', async () => {
  const { page, errors } = await open();
  await caretToEndOf(page, 1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('- gone');
  await page.waitForTimeout(150);
  for (const _ of 'gone') await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);

  // An empty bullet's ::before is the bullet, out in the margin where it lays no
  // line box — so the line has nothing to put a caret in unless it is given one.
  await page.keyboard.type('still here');
  await page.waitForTimeout(200);
  const all = await blocks(page);
  assert.equal(all[2].list, 'bullet');
  assert.equal(all[2].text, 'still here', 'the line kept the caret it was given');
  assert.ok((await filed(page)).includes('still here'));
  assert.deepEqual(errors, []);
});

test('clicking a row opens that note, and the file remembers which', async () => {
  const { page, errors } = await open();
  const second = await page.evaluate(() => document.querySelectorAll('.note')[1].getAttribute('data-marble-id'));
  await page.click('.row:nth-child(2) .open');
  await page.waitForTimeout(200);

  const now = await page.evaluate(() => ({
    current: document.body.getAttribute('data-current'),
    open: document.querySelector('.note.marble-open').getAttribute('data-marble-id'),
    hosts: [...document.querySelectorAll('[contenteditable]')].filter((el) => el.closest('.notes')).length,
    lit: [...document.querySelectorAll('.row')].map((el) => el.classList.contains('marble-current')),
  }));
  assert.equal(now.current, second);
  assert.equal(now.open, second);
  assert.equal(now.hosts, 1, 'the note left behind is not typeable any more');
  assert.deepEqual(now.lit, [false, true]);
  assert.match(await filed(page), new RegExp(`data-current="${second}"`));

  // And typing lands in the note that is open, not the one that was.
  await caretToEndOf(page, 0);
  await page.keyboard.type(' and knobs');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent('.row.marble-current .t'), 'Keys and knobs');
  assert.deepEqual(errors, []);
});

test('a new note goes on top, is filed, and undo takes it back off', async () => {
  const { page, errors } = await open();
  await page.click('[data-cmd="new"]');
  await page.waitForTimeout(250);

  let all = await page.evaluate(() => [...document.querySelectorAll('.note')].map((el) => el.getAttribute('data-marble-id')));
  assert.equal(all.length, 3);
  const made = all[0];
  assert.equal(await page.evaluate(() => document.querySelector('.note.marble-open').getAttribute('data-marble-id')), made);
  assert.equal(await page.textContent('.meta'), '3 notes');

  await page.keyboard.type('Milk, bread');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent('.row.marble-current .t'), 'Milk, bread');
  let source = await filed(page);
  assert.ok(source.includes('Milk, bread'));
  assert.ok(source.includes(made));

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  all = await page.evaluate(() => [...document.querySelectorAll('.note')].map((el) => el.getAttribute('data-marble-id')));
  assert.equal(all.length, 2, 'undo took the note back off');
  source = await filed(page);
  assert.ok(!source.includes('Milk, bread'));
  assert.deepEqual(errors, []);
});

test('the × forgets a note, and says how to get it back', async () => {
  const { page, errors } = await open();
  const doomed = await page.evaluate(() => document.querySelectorAll('.note')[1].getAttribute('data-marble-id'));
  await page.hover('.row:nth-child(2)');
  await page.click('.row:nth-child(2) .drop');
  await page.waitForTimeout(250);

  assert.equal(await page.evaluate(() => document.querySelectorAll('.note').length), 1);
  assert.match(await page.textContent('.meta'), /Ctrl\+Z/);
  let source = await filed(page);
  assert.ok(!source.includes(doomed), 'the note left the file');
  // The last note has no × at all: emptying it is what deleting it would mean.
  assert.equal(await page.evaluate(() => document.querySelectorAll('.row .drop').length), 0);

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.note').length), 2);
  source = await filed(page);
  assert.ok(source.includes(doomed), 'and it came back whole, with its text');
  assert.ok(source.includes('Ctrl+Alt+1'));
  assert.deepEqual(errors, []);
});

test('searching the notes files nothing', async () => {
  const { page, errors } = await open();
  await page.fill('.find', 'menu');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.row').length), 1);
  assert.equal(await page.textContent('.row .t'), 'Keys');

  const source = await filed(page);
  assert.ok(!/class="find"[^>]*"menu"/.test(source), 'what was typed into the field is not in the file');
  assert.ok(!/class="find"[^>]*value=/.test(source));

  await page.focus('.find');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.row').length), 2);
  assert.deepEqual(errors, []);
});

test('a paste arrives as plain lines, each its own addressed block', async () => {
  const { page, errors } = await open();
  const before = await blocks(page);
  await caretToEndOf(page, 1);
  await page.evaluate(() => {
    const note = document.querySelector('.note.marble-open');
    const data = new DataTransfer();
    data.setData('text/plain', 'one\ntwo\nthree');
    data.setData('text/html', '<h1 style="color:red">one</h1><div>two</div><div>three</div>');
    note.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await page.waitForTimeout(200);

  const after = await blocks(page);
  assert.equal(after.length, before.length + 2);
  assert.ok(after[1].text.endsWith('one'));
  assert.equal(after[2].text, 'two');
  assert.equal(after[3].text, 'three');
  assert.ok(after.every((block) => block.id));
  const source = await filed(page);
  assert.ok(!source.includes('color:red'), 'the dressing did not come with it');
  assert.ok(!/<h1[^>]*>one/.test(source), 'nor the tag it was wearing');
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------- the phone
//
// A note is the thing you type into with a keyboard up, so the keyboard is not
// an edge case here — it is the setting. Everything below is about the screen
// the person is actually looking at rather than the one the window reports.

test('the keyboard is two insets, and nothing stands under it', async () => {
  const { page, errors } = await openPhone();
  await caretToEndOf(page, 3);
  await page.keyboard.type(' typing at the foot of the note.');

  // A browser that answers the keyboard by shrinking the visual viewport.
  await raiseKeyboard(page, 336);
  let s = await seen(page);
  assert.equal(s.kb, '336px');
  assert.equal(s.vvTop, '0px');
  assert.ok(s.shell.bottom <= s.strip.bottom + 1, `the shell ends at ${s.shell.bottom}, under a keyboard that starts at ${s.strip.bottom}`);
  assert.ok(s.shell.bottom >= s.strip.bottom - 2, `the shell ends at ${s.shell.bottom}, ${s.strip.bottom - s.shell.bottom}px short of the sill at ${s.strip.bottom}`);
  assert.ok(s.pill.bottom <= s.strip.bottom, `the save pill ends at ${s.pill.bottom}, behind the keyboard at ${s.strip.bottom}`);

  // And one that slides the viewport down the page to keep the caret clear:
  // nothing was taken off the bottom, and everything fixed to the layout
  // viewport is now above the screen unless it hears about --vv-top.
  await raiseKeyboard(page, 336, 336);
  s = await seen(page);
  assert.equal(s.vvTop, '336px');
  assert.ok(s.shell.top >= s.strip.top - 1, `the shell starts at ${s.shell.top}, above the screen's top edge at ${s.strip.top}`);
  assert.ok(s.shell.bottom <= s.strip.bottom + 1 && s.shell.bottom >= s.strip.bottom - 2, `the shell ends at ${s.shell.bottom}, not on the sill at ${s.strip.bottom}`);
  assert.ok(s.pill.bottom <= s.strip.bottom, `the save pill ends at ${s.pill.bottom}, off a screen that ends at ${s.strip.bottom}`);

  // The line being typed is the whole point of the exercise.
  await page.keyboard.type(' and more.');
  await page.waitForTimeout(200);
  const caret = await page.evaluate(() => {
    const r = getSelection().getRangeAt(0).getBoundingClientRect();
    const vv = window.visualViewport;
    return { bottom: Math.round(r.bottom), sill: Math.round(vv.offsetTop + vv.height) };
  });
  assert.ok(caret.bottom <= caret.sill, `the caret is at ${caret.bottom}, behind a keyboard that starts at ${caret.sill}`);

  // The keyboard going away puts the whole window back.
  await raiseKeyboard(page, 0, 0);
  s = await seen(page);
  assert.equal(s.kb, '0px');
  assert.ok(s.shell.bottom >= 778, `the shell ends at ${s.shell.bottom} with no keyboard up`);
  assert.deepEqual(errors, []);
});

test('the insets are written again after the file has been read back over the page', async () => {
  // They are an inline style on <html>, and the file says <html> carries none:
  // reconciling the page against the file takes them off unless something puts
  // them back. An edit made in a text editor is what that looks like.
  const { page, errors } = await openPhone();
  await raiseKeyboard(page, 336);
  const source = await filed(page);
  await host.drive.createDocument('scratch', source.replace('Keys', 'Keys and knobs'), { label: 'by hand' });
  await page.waitForFunction(() => document.body.textContent.includes('Keys and knobs'), null, { timeout: 4000 });
  await page.waitForTimeout(200);

  const s = await seen(page);
  assert.equal(s.kb, '336px', 'the reconcile took the keyboard inset off <html>');
  assert.ok(s.shell.bottom <= s.strip.bottom + 1, `the shell ends at ${s.shell.bottom}, under a keyboard that starts at ${s.strip.bottom}`);
  assert.deepEqual(errors, []);
});

test('a finger gets its 44, and the search field does not zoom the page', async () => {
  const { page, errors } = await openPhone();
  const hands = await page.evaluate(() => {
    const box = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      add: box('[data-cmd="new"]'),
      // The × was being cut back to 28px by the rule that places it in a row.
      drop: box('.row .drop'),
      row: box('.row .open'),
      find: box('.find'),
      // Under 16px a phone zooms the whole page when the field takes focus.
      findText: parseFloat(getComputedStyle(document.querySelector('.find')).fontSize),
      // Nothing is hidden behind a hover on a screen that has none.
      dropShown: getComputedStyle(document.querySelector('.row .drop')).opacity,
    };
  });
  assert.ok(hands.add.w >= 44 && hands.add.h >= 44, `the new-note button is ${hands.add.w}×${hands.add.h}`);
  assert.ok(hands.drop.w >= 44 && hands.drop.h >= 44, `the × is ${hands.drop.w}×${hands.drop.h}`);
  assert.ok(hands.row.h >= 44, `a note chip is ${hands.row.h}px tall`);
  assert.ok(hands.find.h >= 44, `the search field is ${hands.find.h}px tall`);
  assert.ok(hands.findText >= 16, `the search field is set at ${hands.findText}px`);
  assert.equal(hands.dropShown, '1');
  assert.deepEqual(errors, []);
});

test('the way back from a deletion is said on a phone too', async () => {
  // The count is not worth a line of a phone screen and is hidden there; the
  // news is, because the × is the one gesture on this screen that takes
  // something away and Ctrl+Z is the only way back from it.
  const { page, errors } = await openPhone();
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.meta')).display), 'none');
  await page.click('.row:nth-child(2) .drop');
  await page.waitForTimeout(250);
  const meta = await page.evaluate(() => ({
    display: getComputedStyle(document.querySelector('.meta')).display,
    text: document.querySelector('.meta').textContent,
    role: document.querySelector('.meta').getAttribute('role'),
  }));
  assert.notEqual(meta.display, 'none', 'the news was said off the screen');
  assert.match(meta.text, /Ctrl\+Z/);
  assert.equal(meta.role, 'status', 'and said out loud as well as drawn');
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------- on paper

test('printing gives you the note you are in, and none of the chrome', async () => {
  // From a screen that was in the dark, because that is the printout that goes
  // wrong: paper is white and ink is black whichever way the machine was set.
  const { page, errors } = await open({ colorScheme: 'dark' });
  await page.click('.row:nth-child(2) .open');
  await page.waitForTimeout(200);
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  await page.waitForTimeout(150);

  const paper = await page.evaluate(() => {
    const cs = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    return {
      rail: cs('.rail', 'display'),
      // The field is inside the rail, so what it is worth asking is whether it
      // comes out on the paper — not what its own display says.
      find: document.querySelector('.find').getClientRects().length,
      pill: cs('.marble-status', 'display'),
      ink: cs('.note.marble-open', 'color'),
      paper: cs('body.app', 'backgroundColor'),
      sheet: cs('.sheet', 'backgroundColor'),
      // The half screen of room under the last line would print as a blank page.
      trailing: cs('.note.marble-open', 'paddingBottom'),
      printed: [...document.querySelectorAll('.note')]
        .filter((el) => getComputedStyle(el).display !== 'none')
        .map((el) => el.textContent.trim().slice(0, 4)),
      breaks: cs('.note.marble-open > h2, .note.marble-open > p', 'orphans'),
    };
  });
  assert.equal(paper.rail, 'none', 'the rail is on the paper');
  assert.equal(paper.find, 0, 'the search field is on the paper');
  assert.equal(paper.pill, 'none', 'the save pill is on the paper');
  assert.equal(paper.ink, 'rgb(0, 0, 0)');
  assert.equal(paper.paper, 'rgb(255, 255, 255)');
  assert.equal(paper.sheet, 'rgb(255, 255, 255)');
  assert.equal(paper.trailing, '0px');
  assert.deepEqual(paper.printed, ['Keys'], 'the note you are in, and only it');
  assert.equal(paper.breaks, '2', 'a paragraph may not leave one line behind');
  assert.deepEqual(errors, []);
});

// ------------------------------------------------------------- the caret
//
// The failure this family is prone to: an empty block has no line box of its
// own, so the caret cannot be put in it, and the next thing typed lands in the
// line below. Placing the caret with a script would not catch it — these drive
// the mouse, which is the only thing that can fail.

test('the caret reaches an empty line, clicked into rather than placed', async () => {
  const { page, errors } = await open();
  await page.click('[data-cmd="new"]');
  await page.waitForTimeout(250);

  // A new note is one empty line with a placeholder drawn over it.
  const inside = await page.evaluate(() => {
    const r = document.querySelector('.note.marble-open').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 120) };
  });
  await page.mouse.click(inside.x, inside.y);
  await page.keyboard.type('Clicked into');
  await page.waitForTimeout(250);
  let all = await blocks(page);
  assert.equal(all.length, 1, 'the click made a second line rather than a caret');
  assert.equal(all[0].text, 'Clicked into');

  // And the white beside the page, which is the page: an empty first line is
  // where that has nothing to aim at.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  const margin = await page.evaluate(() => {
    const r = document.querySelector('.note.marble-open').getBoundingClientRect();
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    return { x: Math.round((sheet.left + r.left) / 2), y: Math.round(r.top + 30) };
  });
  await page.mouse.click(margin.x, margin.y);
  await page.keyboard.type('From the margin');
  await page.waitForTimeout(250);
  all = await blocks(page);
  assert.equal(all[0].text, 'From the margin', 'the click in the margin landed somewhere else');
  assert.deepEqual(errors, []);
});

test('an empty line in the middle of a note takes a caret and keeps it', async () => {
  const { page, errors } = await open();
  await caretToEndOf(page, 1);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('after the gap');
  await page.waitForTimeout(200);

  const gap = await page.evaluate(() => {
    const el = document.querySelector('.note.marble-open').children[2];
    const r = el.getBoundingClientRect();
    return { text: el.textContent, h: Math.round(r.height), x: Math.round(r.left + 8), y: Math.round(r.top + r.height / 2) };
  });
  assert.equal(gap.text, '', 'the middle line is not the empty one');
  assert.ok(gap.h > 8, `an empty line has no line box to stand a caret in — ${gap.h}px tall`);

  await page.mouse.click(gap.x, gap.y);
  await page.keyboard.type('in the gap');
  await page.waitForTimeout(250);
  const all = await blocks(page);
  assert.equal(all[2].text, 'in the gap', 'what was typed went into the line below instead');
  assert.equal(all[3].text, 'after the gap');
  assert.ok((await filed(page)).includes('in the gap'));
  assert.deepEqual(errors, []);
});

test('the rail says what it is to somebody who cannot see it', async () => {
  const { page, errors } = await open();
  const spoken = await page.evaluate(() => ({
    rail: document.querySelector('.rail').tagName,
    railName: document.querySelector('.rail').getAttribute('aria-label'),
    rows: document.querySelector('#rows').getAttribute('role'),
    row: document.querySelector('.row').getAttribute('role'),
    current: document.querySelector('.row.marble-current .open').getAttribute('aria-current'),
    find: document.querySelector('.find').getAttribute('aria-label'),
    add: document.querySelector('[data-cmd="new"]').getAttribute('aria-label'),
    keys: document.querySelector('[data-cmd="new"]').getAttribute('aria-keyshortcuts'),
    drop: document.querySelector('.row .drop').getAttribute('aria-label'),
    sheet: document.querySelector('.sheet').tagName,
  }));
  assert.equal(spoken.rail, 'NAV');
  assert.equal(spoken.railName, 'Notes');
  assert.equal(spoken.rows, 'list');
  assert.equal(spoken.row, 'listitem');
  assert.equal(spoken.current, 'page');
  assert.equal(spoken.find, 'Search notes');
  assert.equal(spoken.add, 'New note');
  assert.equal(spoken.keys, 'Control+Enter');
  assert.match(spoken.drop, /^Delete note: /);
  assert.equal(spoken.sheet, 'MAIN');

  // None of it reaches the file except the two that are in the markup.
  const source = await filed(page);
  assert.ok(!/role="list(item)?"/.test(source.replace('role="list"', '')), 'a row role is a reading, not a fact');
  assert.deepEqual(errors, []);
});
