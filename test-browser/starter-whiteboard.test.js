// The Whiteboard starter: an endless board, talked about in the drive's own
// chat. Built the way a drive is seeded with it (a document called Board), and
// driven the way somebody sketches on it, comments on it and asks about it.

import assert from 'node:assert/strict';
import test from 'node:test';

import { build } from '../server/gallery.js';
import { startDrive } from './harness.js';

const SCRIPTS = { hello: [{ say: 'Hello **there**.' }] };

const Board = await build('whiteboard', { name: 'Board' });
const host = await startDrive({ scripts: SCRIPTS, documents: { Board } });
test.after(() => host.close());

const pages = [];
const closePages = async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); };
test.after(closePages);

// One tab at a time: a tab left open from the last test would write its board
// back over the reset.
async function openBoard({ hash = '', ...options } = {}) {
  const { page, errors } = await host.newPage(options);
  pages.push(page);
  await page.goto(`${host.base}/a/Board${hash}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marble?.drive));
  await page.waitForTimeout(200);
  return { page, errors };
}

const filed = async () =>
  (await fetch(`${host.base}/a/Board`, { headers: { accept: 'text/html' } })).text();
const markupOf = async () => (await filed()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

/** What the page sent for the first turn of a chat begun after `known`. */
const conversations = async () => (await (await fetch(`${host.base}/agent/conversations`)).json()) ?? [];
const known = async () => new Set((await conversations()).map((c) => c.id));
const firstTurn = async (page, before) => {
  for (let i = 0; i < 80; i += 1) {
    for (const c of (await conversations()).filter((one) => !before.has(one.id))) {
      const { turns } = await (await fetch(`${host.base}/agent/conversations/${c.id}`)).json();
      if (turns?.length) return { id: c.id, prompt: turns[0].prompt, context: turns[0].context };
    }
    await page.waitForTimeout(100);
  }
  return null;
};

test('a fresh board opens on its starter section, named for its file, with nothing of anybody else in it', async () => {
  await closePages();
  await host.reset();
  const { page, errors } = await openBoard();
  const seen = await page.evaluate(() => ({
    title: document.title,
    name: document.querySelector('.head .name').textContent,
    items: [...document.querySelectorAll('.world > .item')].map((el) => el.dataset.kind),
  }));
  assert.equal(seen.title, 'Board');
  assert.equal(seen.name, 'Board');
  assert.deepEqual(seen.items, ['frame', 'note', 'note', 'note', 'text']);
  assert.deepEqual(errors, []);
});

test('the drive’s own chat is on the board: its drawer is there, and no panel of the board’s', async () => {
  await closePages();
  await host.reset();
  const { page, errors } = await openBoard();
  await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')));
  assert.equal(await page.locator('meta[name="marble-agent"]').count(), 0);
  assert.equal(await page.locator('body > aside.panel').count(), 0);
  await page.locator('.ask-btn').click();
  await page.locator('marble-agent-drawer aside.panel[data-open="true"]').waitFor();
  assert.deepEqual(errors, []);
});

test('the board fills the window, whatever else the host puts in <body>', async () => {
  await host.reset();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const { page, errors } = await openBoard({ viewport });
    await page.evaluate(() => {
      const extra = document.createElement('marble-agent-setup-stand-in');
      extra.setAttribute('data-marble-transient', '');
      extra.textContent = 'injected';
      document.body.append(extra);
    });
    const stage = await page.evaluate(() => Math.round(document.querySelector('.stage').getBoundingClientRect().height));
    assert.equal(stage, viewport.height, `${viewport.width}px wide: the board is ${stage}px tall`);
    assert.deepEqual(errors, []);
  }
});

test('a double-click drops a note, filed; one Mod+Z takes back one note', async () => {
  await closePages();
  await host.reset();
  const { page, errors } = await openBoard();
  const notes = () => page.locator('.world > .item.note').count();
  const before = await notes();
  const stage = page.locator('.stage');
  await stage.dblclick({ position: { x: 300, y: 600 } });
  await page.keyboard.press('Escape');
  await stage.dblclick({ position: { x: 600, y: 650 } });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.equal(await notes(), before + 2);
  await page.evaluate(() => window.marble.flush?.());
  assert.equal((await markupOf()).match(/class="item note"/g).length, before + 2);

  // Undo is bound once — by the composed history part — so one press is one step.
  await page.locator('.stage').click({ position: { x: 40, y: 760 } });
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  assert.equal(await notes(), before + 1);
  assert.deepEqual(errors, []);
});

test('a picture pasted onto the board is kept in "Board media" beside it', async () => {
  await closePages();
  await host.reset();
  const { page, errors } = await openBoard();
  await page.locator('.stage').click({ position: { x: 40, y: 760 } });
  await page.evaluate(async () => {
    // One transparent pixel.
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'dot.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  const figure = page.locator('.world > figure.item[data-kind="image"]');
  await figure.waitFor({ timeout: 5000 });
  assert.equal(await figure.getAttribute('data-path'), 'Board media/dot.png');
  const loaded = await figure.locator('img').evaluate((img) => new Promise((resolve) => {
    if (img.complete) resolve(img.naturalWidth);
    else img.onload = () => resolve(img.naturalWidth);
  }));
  assert.equal(loaded, 1, 'the picture is served from where it was put');
  const tree = await (await fetch(`${host.base}/drive/tree`)).json();
  const folder = tree.children.find((c) => c.kind === 'folder' && c.path === 'Board media');
  assert.ok(folder?.children?.some((c) => c.path === 'Board media/dot.png'), 'the file is in the drive, beside the board');
  assert.deepEqual(errors, []);
});

test('a comment put on a note is filed on it, travels with it, and takes a reply as one more line', async () => {
  await closePages();
  await host.reset();
  const { page, errors } = await openBoard();
  const note = page.locator('.world > .note').first();
  const noteId = await note.getAttribute('data-marble-id');
  await page.locator('.stage').click({ position: { x: 40, y: 760 } });
  await page.keyboard.press('c');
  await note.click({ position: { x: 60, y: 60 } });
  const field = page.locator('.world > .comment.marble-open .reply textarea');
  await field.fill('Who is this for, really?');
  await field.press('Enter');
  const pin = page.locator('.world > .comment[data-on]');
  await pin.waitFor();
  assert.equal(await pin.getAttribute('data-on'), noteId);
  assert.equal(await pin.getAttribute('data-by'), 'you');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.querySelector('.head .count').textContent), '5 things', 'a comment is not a thing on the board');

  // The pin stands at the note's top-right corner, and moves when it moves.
  const corner = async () => page.evaluate((id) => {
    const n = document.querySelector(`[data-marble-id="${id}"]`).getBoundingClientRect();
    const c = document.querySelector('.world > .comment[data-on]').getBoundingClientRect();
    return { dx: Math.round(c.left - n.right), dy: Math.round(c.bottom - n.top) };
  }, noteId);
  const at = await corner();
  assert.ok(Math.abs(at.dx) <= 10 && Math.abs(at.dy) <= 10, `the pin is ${at.dx},${at.dy} from the corner`);
  const box = await note.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 80, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  assert.deepEqual(await corner(), at, 'the pin went with the note');

  await pin.click();
  const reply = page.locator('.world > .comment.marble-open .reply textarea');
  await reply.fill('Scientists who build their own tools.');
  await reply.press('Enter');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.marble.flush?.());
  const filedComment = (await markupOf()).match(/<aside class="item comment"[\s\S]*?<\/aside>/)[0];
  assert.match(filedComment, new RegExp(`data-on="${noteId}"`));
  assert.equal(filedComment.match(/class="said"/g).length, 2);
  assert.match(filedComment, /Scientists who build their own tools\./);
  assert.doesNotMatch(filedComment, /textarea|marble-open/, 'only the words are filed');

  // Resolving takes the thread off, and one undo puts it back.
  await pin.click();
  await page.locator('.world > .comment.marble-open .resolve').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.world > .comment').count(), 0);
  await page.locator('.stage').click({ position: { x: 40, y: 760 } });
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.world > .comment').count(), 1);
  assert.deepEqual(errors, []);
});

test('a comment Claude leaves by op is a pin at its thing, and opens to Claude’s words', async () => {
  await closePages();
  await host.reset();
  const { page, errors } = await openBoard();
  await page.evaluate(() => {
    const world = document.getElementById('world');
    const note = world.querySelector('.note');
    const op = {
      type: 'insert',
      parentId: window.marble.id(world),
      beforeId: null,
      html: `<aside class="item comment" data-kind="comment" data-by="claude" data-on="${window.marble.id(note)}" data-marble-id="cmt00001"><p class="said" data-by="claude" data-marble-id="cmt00002">Is the first day the same as the first week?</p></aside>`,
    };
    window.marble.apply(op);
    window.marble.op(op);
  });
  const pin = page.locator('.world > .comment[data-by="claude"]');
  await pin.waitFor();
  assert.equal(await pin.locator('.said').evaluate((el) => getComputedStyle(el).display), 'none', 'at rest, only the pin');
  await pin.click();
  await page.locator('.world > .comment.marble-open .said', { hasText: 'first week' }).waitFor();
  assert.equal(await page.locator('.world > .comment.marble-open .said').evaluate((el) => getComputedStyle(el, '::before').content), '"Claude"');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.world > .comment.marble-open').count(), 0);
  assert.deepEqual(errors, []);
});

test('typing in the drive’s chat is words, not the board’s keys', async () => {
  await closePages();
  await host.reset();
  const { page, errors } = await openBoard();
  await page.locator('.world > .note').first().click({ position: { x: 20, y: 20 } });
  await page.locator('.ask-btn').click();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('aside.panel[data-open="true"]').waitFor();
  await drawer.locator('marble-conversation .editor').click();
  await page.keyboard.type('note pen');
  await page.keyboard.press('Backspace');
  assert.equal(await page.evaluate(() => document.querySelector('.stage').dataset.tool), 'select');
  assert.equal(await page.locator('.world > .note').count(), 3, 'Backspace in the chat deleted nothing');
  assert.deepEqual(errors, []);
});

test('an ask from the drive’s chat carries the board: what is picked, and its outline', async () => {
  await closePages();
  await host.reset();
  const { page, errors } = await openBoard();
  const note = page.locator('.world > .note').first();
  const noteId = await note.getAttribute('data-marble-id');
  await note.click({ position: { x: 20, y: 20 } });
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), [noteId]);
  await page.locator('.ask-btn').click();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('aside.panel[data-open="true"]').waitFor();
  const view = drawer.locator('marble-conversation');
  await view.locator('.editor').fill('script:hello');
  const before = await known();
  await view.locator('.editor').press('Enter');
  const turn = await firstTurn(page, before);
  assert.deepEqual(turn.context.selection, [noteId]);
  assert.match(turn.context.brief, /<board name="Board"/);
  assert.match(turn.context.brief, /scope="1 selected thing"/);
  assert.match(turn.context.brief, new RegExp(`\\[${noteId}\\]`), 'the outline names things by id');
  assert.match(turn.context.brief, /class="item comment"/, 'and says how to leave a comment');
  assert.ok(turn.context.brief.length <= 4000, `the brief is ${turn.context.brief.length} characters`);
  assert.deepEqual(errors, []);
});

// The Drive's New menu hands over what was typed as #ask=…: a chat about the
// board in the drive's drawer, sent as its first ask, and the address spent so
// a reload does not send it again.
test('words handed over as #ask= are the first ask, sent once', async () => {
  await closePages();
  await host.reset();
  const before = await known();
  const { page, errors } = await openBoard({ hash: `#ask=${encodeURIComponent('script:hello')}` });
  const turn = await firstTurn(page, before);
  assert.equal(turn.prompt, 'script:hello');
  assert.equal(turn.context.target, 'Board');
  assert.match(turn.context.brief, /<board name="Board"/, 'the board went with it');
  assert.equal(await page.evaluate(() => location.hash), '');
  await page.locator('marble-agent-drawer aside.panel[data-open="true"]').waitFor();

  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForTimeout(600);
  const { turns } = await (await fetch(`${host.base}/agent/conversations/${turn.id}`)).json();
  assert.equal(turns.length, 1, 'a reload sent nothing');
  assert.deepEqual(errors, []);
});

test('Ask Claude in a thread says the words there, and sends them by the drive’s line, about that comment', async () => {
  await closePages();
  await host.reset();
  const { page, errors } = await openBoard();
  const note = page.locator('.world > .note').first();
  await page.locator('.stage').click({ position: { x: 40, y: 760 } });
  await page.keyboard.press('c');
  await note.click({ position: { x: 60, y: 60 } });
  const field = page.locator('.world > .comment.marble-open .reply textarea');
  await field.fill('script:hello');
  const before = await known();
  await field.press('ControlOrMeta+Enter');
  const turn = await firstTurn(page, before);
  const commentId = await page.locator('.world > .comment[data-on]').getAttribute('data-marble-id');
  assert.equal(turn.prompt, 'script:hello');
  assert.deepEqual(turn.context.selection, [commentId]);
  assert.match(turn.context.brief, new RegExp(`comment \\[${commentId}\\]`), 'the brief carries the thread');
  assert.equal(await page.locator('.world > .comment .said').count(), 1, 'and the words are in the thread');
  assert.deepEqual(errors, []);
});
