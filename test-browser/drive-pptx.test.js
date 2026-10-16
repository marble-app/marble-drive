// A PowerPoint dropped on the Drive, and the deck it becomes.
//
// The drop is the whole feature from the outside: a .pptx goes in, a deck of
// the drive's own comes out beside where it landed, and the PowerPoint is in
// the Trash. Then the deck has to behave like one: its slides drawn to scale,
// its text typed into without losing the bold word, and presenting it keeps
// the slide's shape on any screen.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';
import { makePptx } from '../test/fixtures/pptx.js';

const host = await startDrive({ agents: false, documents: { drive: await buildDrive(), garden: GARDEN } });
test.after(() => host.close());

/** A file off the desktop arrives as a DataTransfer, built in the page. */
async function dropFile(page, name, bytes) {
  await page.evaluate(
    ({ name, base64 }) => {
      const data = new DataTransfer();
      const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      data.items.add(new File([raw], name, { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
      const fire = (type) => document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
      fire('dragenter');
      fire('dragover');
      fire('drop');
    },
    { name, base64: bytes.toString('base64') },
  );
}

test('a .pptx dropped on the Drive becomes a deck, and the PowerPoint goes to the Trash', async () => {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/drive`);
  await page.waitForFunction(() => document.querySelector('[data-live="1"]'));

  await dropFile(page, 'Quarterly Review.pptx', makePptx());
  await page.waitForFunction(() => /Added Quarterly Review/.test(document.body.innerText), null, { timeout: 15000 });
  assert.match(await page.locator('.uploads .up-files').innerText(), /3 slides/);

  assert.ok(await host.drive.store.has('Quarterly Review'), 'the deck is a document');
  assert.equal(await host.drive.store.hasFile('Quarterly Review.pptx'), false);
  assert.ok((await host.drive.store.listTrash()).some((e) => e.path === 'Quarterly Review.pptx'));
  await page.locator('#items .item[data-path="Quarterly Review"]').waitFor();
  assert.deepEqual(errors.filter((e) => !/sandboxed/.test(e)), []);
  await page.close();
});

test('the deck draws its slides to scale and keeps the bold word when typed into', async () => {
  const { page, errors } = await host.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${host.base}/a/Quarterly%20Review`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(200);

  // The title box sits 5% in from the left of its slide and 90% of it wide.
  const placed = await page.evaluate(() => {
    const face = document.querySelector('.slides > .slide .face.placed');
    const title = face.querySelector('[role="heading"]');
    const f = face.getBoundingClientRect();
    const t = title.getBoundingClientRect();
    return {
      ratio: f.width / f.height,
      left: (t.left - f.left) / f.width,
      width: t.width / f.width,
      fontPx: parseFloat(getComputedStyle(title.querySelector('p')).fontSize),
      faceWidth: f.width,
      kinds: document.querySelectorAll('.slides > .slide > .kind').length,
      seams: document.querySelectorAll('.slides > .slide > .seam').length,
      editable: title.getAttribute('contenteditable'),
    };
  });
  assert.ok(Math.abs(placed.ratio - 16 / 9) < 0.01, `the face is 16:9 (${placed.ratio})`);
  assert.ok(Math.abs(placed.left - 0.05) < 0.005, `title left ${placed.left}`);
  assert.ok(Math.abs(placed.width - 0.9) < 0.005, `title width ${placed.width}`);
  // 44pt on a 720pt slide is 6.111% of its width.
  assert.ok(Math.abs(placed.fontPx / placed.faceWidth - 0.06111) < 0.001, `type is a share of the slide (${placed.fontPx}px)`);
  assert.equal(placed.kinds, 0, 'a placed slide has no title/point switch');
  assert.equal(placed.seams, 3, 'a slide can still be added between them');
  assert.equal(placed.editable, 'true');

  // Typed at the end of the title: the bold run stays a bold run in the file.
  const title = page.locator('.slides > .slide [role="heading"]').first();
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' again');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.marble.flush());
  const source = await host.drive.store.read('Quarterly Review');
  assert.match(source, /<span style="font-weight:700">world again<\/span>/);

  // Presenting keeps the slide's shape, as large as the screen allows.
  await page.locator('.play').click();
  await page.waitForTimeout(450);
  const shown = await page.evaluate(() => {
    const r = document.querySelector('.slide.marble-at .face').getBoundingClientRect();
    return { width: r.width, height: r.height, top: r.top, notes: getComputedStyle(document.querySelector('.slide.marble-at .notes')).visibility };
  });
  assert.ok(Math.abs(shown.width - 1280) < 1, `as wide as the screen (${shown.width})`);
  assert.ok(Math.abs(shown.height - 720) < 1, `and 16:9 (${shown.height})`);
  assert.ok(Math.abs(shown.top - 90) < 1, `centred (${shown.top})`);
  assert.equal(shown.notes, 'hidden');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors.filter((e) => !/sandboxed/.test(e)), []);
  await page.close();
});
