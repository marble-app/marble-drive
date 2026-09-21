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

const open = async () => {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: { width: 1280, height: 900 } });
  pages.push(page);
  await page.goto(`${host.base}/a/notes`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(150);
  return { page, errors };
};

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
