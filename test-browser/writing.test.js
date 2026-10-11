// Which text takes typing (runtime/writing.js). Out of build mode a page's
// fixed text (a heading, a label) is locked, and only its writing areas take
// typing: data-marble-editable="write", anything under data-marble-write, an
// editable with a placeholder. Build mode unlocks all of it. Someone on an
// edit link never has build mode, so they only ever get the writing areas.
//
// Each case is checked from the page and from the file: the lock is the
// page's, and nothing about it is ever filed.

import assert from 'node:assert/strict';
import test from 'node:test';

import { composeScript } from '../server/gallery.js';
import { startDrive } from './harness.js';

const SECRET = 'hunter2';

const LIST = `<!doctype html>
<html><head><meta charset="utf-8"><title>Groceries</title>
<style>body { font: 16px/1.5 system-ui, sans-serif; margin: 0; } main { max-width: 640px; margin: 0 auto; padding: 40px; } [data-marble-editable] { min-height: 1.5em; }</style>
</head>
<body data-marble-id="b"><main data-marble-id="m">
  <h1 data-marble-id="title" data-marble-editable>Groceries</h1>
  <p data-marble-id="lede" data-marble-editable>What we need this week.</p>
  <p data-marble-id="note" data-marble-editable="write">Oat milk</p>
  <p data-marble-id="idea" data-marble-editable data-ph="Type an idea"></p>
  <ul data-marble-id="list" data-marble-write>
    <li data-marble-id="r1"><span data-marble-id="r1t" data-marble-editable>Eggs</span></li>
  </ul>
  <label data-marble-id="qtyl">How many <input data-marble-id="qty" value="2"></label>
</main>
<script>
${await composeScript(['editable'])}
</script>
</body></html>
`;

const host = await startDrive({ documents: { groceries: LIST }, env: { MARBLE_DRIVE_SECRET: SECRET } });
test.after(() => host.close());

const pages = [];
test.afterEach(async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
});

/** The owner, signed in, on `doc`, with build mode as `build` says (harness). */
async function owner({ build = 'closed', doc = 'groceries' } = {}) {
  const { page, errors } = await host.newPage({ build });
  pages.push(page);
  const res = await page.request.post(`${host.base}/gate`, { data: { secret: SECRET } });
  assert.equal(res.status(), 200);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble && window.marbleWriting));
  return { page, errors };
}

/** Someone with no passphrase, in by a link at `role`. */
async function visitor(me, role, doc = 'groceries') {
  const { link } = await (await me.page.request.post(`${host.base}/drive/shares`, { data: { path: doc, role } })).json();
  const { page, errors } = await host.newPage({ shell: false });
  pages.push(page);
  await page.goto(`${host.base}${link.href}`);
  await page.waitForFunction(() => Boolean(window.marble?.shareWrapped));
  await page.waitForTimeout(150);
  return { page, errors };
}

const editable = (page, id) => page.evaluate((i) => document.querySelector(`[data-marble-id="${i}"]`).getAttribute('contenteditable'), id);
const textOf = (page, id) => page.evaluate((i) => document.querySelector(`[data-marble-id="${i}"]`).textContent, id);
const file = async () => (await host.drive.store.read('groceries')) ?? '';
async function until(check, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
/** Clicks the end of an element's text and types. */
async function typeInto(page, id, words) {
  await page.locator(`[data-marble-id="${id}"]`).click();
  await page.keyboard.press('End');
  await page.keyboard.type(words);
}

test('an app opens in normal use: its fixed text is locked, its writing areas take typing', async () => {
  await host.reset();
  const { page, errors } = await owner();
  await page.waitForFunction(() => window.marbleWriting.locked);
  assert.equal(await page.evaluate(() => window.marbleMarks.describing), false, 'not in build mode');

  assert.equal(await editable(page, 'title'), 'false');
  assert.equal(await editable(page, 'lede'), 'false');
  assert.notEqual(await editable(page, 'note'), 'false', 'data-marble-editable="write"');
  assert.notEqual(await editable(page, 'idea'), 'false', 'an editable with a placeholder');
  assert.notEqual(await editable(page, 'r1t'), 'false', 'under data-marble-write');
  assert.equal(await page.locator('[data-marble-id="qty"]').isEditable(), true, 'an input is never touched');

  await typeInto(page, 'title', ' and more');
  assert.equal(await textOf(page, 'title'), 'Groceries', 'the heading took no typing');
  await typeInto(page, 'note', ', two');
  await typeInto(page, 'r1t', ', a dozen');
  assert.ok(await until(async () => /Oat milk, two/.test(await file()) && /Eggs, a dozen/.test(await file())), 'the writing areas filed what was typed');
  const source = await file();
  assert.match(source, /<h1 data-marble-id="title" data-marble-editable>Groceries<\/h1>/, 'the heading is the same heading in the file');
  assert.doesNotMatch(source, /contenteditable="/, 'the lock is never filed');
  assert.deepEqual(errors.filter((e) => !/favicon|status of 404/.test(e)), []);
});

test('what arrives while locked is locked as it lands, and a row added to a writing area is writable', async () => {
  await host.reset();
  const { page } = await owner();
  await page.waitForFunction(() => window.marbleWriting.locked);
  await page.evaluate(() => {
    window.marble.apply({ type: 'insert', parentId: 'm', html: '<h2 data-marble-id="sub" data-marble-editable>This week</h2>' });
    window.marble.apply({ type: 'insert', parentId: 'list', html: '<li data-marble-id="r2"><span data-marble-id="r2t" data-marble-editable>Bread</span></li>' });
  });
  await page.waitForFunction(() => document.querySelector('[data-marble-id="sub"]')?.getAttribute('contenteditable') === 'false');
  assert.notEqual(await editable(page, 'r2t'), 'false');
  assert.notEqual(await editable(page, 'r2t'), null, 'wired, and left wired');
});

test('build mode unlocks every editable, leaving it locks them again, and the choice is kept for next time', async () => {
  await host.reset();
  const { page } = await owner();
  await page.waitForFunction(() => window.marbleWriting.locked);

  await page.evaluate(() => window.marbleMarks.setDescribing(true));
  await page.waitForFunction(() => !window.marbleWriting.locked);
  assert.equal(await editable(page, 'title'), 'plaintext-only');
  // The app still works under the cursor in build mode, so the heading types.
  await page.locator('.marble-marks-tool[data-tool="use"]').click().catch(() => {});
  await typeInto(page, 'title', ' list');
  assert.ok(await until(async () => /Groceries list<\/h1>/.test(await file())), 'the heading filed in build mode');

  await page.reload();
  await page.waitForFunction(() => Boolean(window.marbleWriting && window.marbleMarks));
  assert.equal(await page.evaluate(() => window.marbleMarks.describing), true, 'left in build mode, it opens in it');
  assert.equal(await page.evaluate(() => window.marbleWriting.locked), false);

  await page.evaluate(() => window.marbleMarks.setDescribing(false));
  await page.waitForFunction(() => window.marbleWriting.locked);
  assert.equal(await editable(page, 'title'), 'false');
  await page.reload();
  await page.waitForFunction(() => window.marbleWriting?.locked === true);
  assert.equal(await page.evaluate(() => window.marbleMarks.describing), false, 'left in normal use, it opens in it');
});

test('a page with no build mode stays as it was: Build mode off in Settings locks nothing', async () => {
  await host.reset();
  const { page } = await owner({ build: false });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.marbleWriting.locked), false);
  assert.equal(await editable(page, 'title'), 'plaintext-only');
});

test('an edit link writes only in the writing areas; a modify link keeps every editable', async () => {
  await host.reset();
  const me = await owner();
  const them = await visitor(me, 'edit');
  assert.equal(await them.page.evaluate(() => window.marbleWriting?.locked), true);
  assert.equal(await editable(them.page, 'title'), 'false');
  assert.notEqual(await editable(them.page, 'note'), 'false');
  await typeInto(them.page, 'title', ' (theirs)');
  await typeInto(them.page, 'note', ' from them');
  assert.ok(await until(async () => /Oat milk from them/.test(await file())), 'their note is filed');
  assert.doesNotMatch(await file(), /theirs/);

  const other = await visitor(me, 'modify');
  assert.equal(await other.page.evaluate(() => Boolean(window.marbleWriting)), false);
  assert.equal(await editable(other.page, 'title'), 'plaintext-only');
});
