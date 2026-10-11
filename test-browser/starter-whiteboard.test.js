// The Whiteboard starter: an endless board with Claude beside it, where the
// board is the prompt. Built the way a drive is seeded with it (a document
// called Board), and driven the way somebody sketches on it.

import assert from 'node:assert/strict';
import test from 'node:test';

import { build } from '../server/gallery.js';
import { startDrive } from './harness.js';

const SCRIPTS = { hello: [{ say: 'Hello **there**.' }] };

const Board = await build('whiteboard', { name: 'Board' });
const host = await startDrive({ scripts: SCRIPTS, documents: { Board } });
test.after(() => host.close());

const pages = [];
test.after(async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); });

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

test('a fresh board opens on its starter section, named for its file, with nothing of anybody else in it', async () => {
  await host.reset();
  const { page, errors } = await openBoard();
  const seen = await page.evaluate(() => ({
    title: document.title,
    name: document.querySelector('.head .name').textContent,
    items: [...document.querySelectorAll('.world > .item')].map((el) => el.dataset.kind),
    conversation: document.body.dataset.conversation,
  }));
  assert.equal(seen.title, 'Board');
  assert.equal(seen.name, 'Board');
  assert.deepEqual(seen.items, ['frame', 'note', 'note', 'note', 'text']);
  assert.equal(seen.conversation, '');
  assert.deepEqual(errors, []);
});

test('the board and the panel fill the window, whatever else the host puts in <body>', async () => {
  await host.reset();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const { page, errors } = await openBoard({ viewport });
    for (const panel of ['open', 'closed']) {
      await page.evaluate((panel) => {
        document.body.dataset.panel = panel;
        if (!document.querySelector('marble-agent-setup-stand-in')) {
          const extra = document.createElement('marble-agent-setup-stand-in');
          extra.setAttribute('data-marble-transient', '');
          extra.textContent = 'injected';
          document.body.append(extra);
        }
      }, panel);
      const stage = await page.evaluate(() => Math.round(document.querySelector('.stage').getBoundingClientRect().height));
      assert.equal(stage, viewport.height, `${viewport.width}px wide, panel ${panel}: the board is ${stage}px tall`);
    }
    assert.deepEqual(errors, []);
  }
});

test('a double-click drops a note, filed; one Mod+Z takes back one note', async () => {
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
  const markup = (await filed()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  assert.equal(markup.match(/class="item note"/g).length, before + 2);

  // Undo is bound once — by the composed history part — so one press is one step.
  await page.locator('.stage').click({ position: { x: 40, y: 760 } });
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  assert.equal(await notes(), before + 1);
  assert.deepEqual(errors, []);
});

test('a picture pasted onto the board is kept in "Board media" beside it', async () => {
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

// The Drive's New menu hands over what was typed as #ask=…: a fresh thread on
// the board, sent as its first ask, and the address spent so a reload does not
// send it again.
test('words handed over as #ask= are the first ask, sent once', async () => {
  await host.reset();
  const { page, errors } = await openBoard({ hash: `#ask=${encodeURIComponent('script:hello')}` });
  await page.locator('.panel .thread', { hasText: 'script:hello' }).waitFor();
  await page.locator('.panel .thread strong', { hasText: 'there' }).waitFor();
  assert.equal(await page.evaluate(() => location.hash), '');
  const id = await page.evaluate(() => document.body.dataset.conversation);
  assert.match(id, /^[0-9a-f]{12}$/);

  const { turns } = await (await fetch(`${host.base}/agent/conversations/${id}`)).json();
  assert.equal(turns.length, 1);
  assert.equal(turns[0].context.target, 'Board');
  assert.match(turns[0].prompt, /<board name="Board"/, 'the board went with it');

  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForTimeout(600);
  const again = await (await fetch(`${host.base}/agent/conversations/${id}`)).json();
  assert.equal(again.turns.length, 1, 'a reload sent nothing');
  assert.deepEqual(errors, []);
});

test('on a phone the board opens first, and the conversation is a tap away', async () => {
  await host.reset();
  const { page, errors } = await openBoard({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  assert.equal(await page.evaluate(() => document.body.dataset.panel), 'closed');
  assert.equal(await page.locator('.panel').isVisible(), false);
  await page.locator('.ask-btn').tap();
  await page.locator('.panel').waitFor();
  assert.deepEqual(errors, []);
});
