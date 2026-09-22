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

const open = async () => {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: { width: 1280, height: 900 } });
  pages.push(page);
  await page.goto(`${host.base}/a/scratch`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(150);
  return { page, errors };
};

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
  assert.match(source, /class="rows" id="rows" data-marble-transient><\/div>/);
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
