// Looking is not changing: a share link's visitor steps through a mockup,
// switches a tab and opens another note in their own tab, at every level,
// while what the page says is still judged by the level.
//
// Each case is checked from both sides: what the visitor's tab shows, and what
// the file has (read through the owner, who is the only one it is filed for).

import assert from 'node:assert/strict';
import test from 'node:test';

import { build, composeScript } from '../server/gallery.js';
import { startDrive } from './harness.js';

const SECRET = 'hunter2';

// A stepper whose step is looking by default, and a quiz whose choose records
// an answer and says so.
const MOCKUP = `<!doctype html>
<html><head><meta charset="utf-8"><title>Mockup</title>
<style>.screen { display: none; } .mock[data-step="1"] .s1, .mock[data-step="2"] .s2, .mock[data-step="3"] .s3 { display: block; }</style>
</head>
<body data-marble-id="b">
  <section class="mock" data-marble-id="mock" data-step="1">
    <p class="screen s1" data-marble-id="s1">Open Share</p>
    <p class="screen s2" data-marble-id="s2">Pick a level</p>
    <p class="screen s3" data-marble-id="s3">Copy link</p>
    <button data-marble-id="back" data-marble-step="data-step:1:3" data-marble-by="-1" data-marble-of=".mock">Back</button>
    <button data-marble-id="next" data-marble-step="data-step:1:3" data-marble-of=".mock">Next</button>
  </section>
  <section class="quiz" data-marble-id="quiz">
    <p data-marble-id="q">Which level only reads?</p>
    <span data-marble-id="pick" data-marble-choose="data-answer" data-marble-of=".quiz" data-marble-look="off">
      <button data-marble-id="a1" data-marble-value="view">Read only</button>
      <button data-marble-id="a2" data-marble-value="edit">Read &amp; write</button>
    </span>
  </section>
  <h1 data-marble-id="title">Sharing flow</h1>
  <script>
${await composeScript(['state'])}
  </script>
</body></html>
`;

const notebook = await build('note', { name: 'Notebook' });
const host = await startDrive({ agents: false, documents: { mockup: MOCKUP, notebook }, env: { MARBLE_DRIVE_SECRET: SECRET } });
test.after(() => host.close());

const pages = [];
test.afterEach(async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
});

/** The owner, signed in. */
async function owner() {
  const { page, errors } = await host.newPage({ shell: false });
  pages.push(page);
  const res = await page.request.post(`${host.base}/gate`, { data: { secret: SECRET } });
  assert.equal(res.status(), 200);
  return { page, errors };
}

/** Whether the file, as it is now, says `pattern` (read through the owner). */
const filed = async (who, doc, pattern) => pattern.test(await (await who.page.request.get(`${host.base}/a/${doc}`)).text());

/** Someone with no passphrase, in by a link at `role`. */
async function visitor(who, doc, role) {
  const made = await who.page.request.post(`${host.base}/drive/shares`, { data: { path: doc, role } });
  const { link } = await made.json();
  const { page, errors } = await host.newPage({ shell: false });
  pages.push(page);
  await page.goto(`${host.base}${link.href}`);
  await page.waitForFunction(() => Boolean(window.marble?.shareWrapped));
  await page.waitForTimeout(150);
  return { page, errors };
}

const stepOf = (page) => page.evaluate(() => document.querySelector('.mock').getAttribute('data-step'));
const answerOf = (page) => page.evaluate(() => document.querySelector('.quiz').getAttribute('data-answer'));
/** Asks `check` until it holds, for up to `ms`. */
async function until(check, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// What the carrier logs when the host refuses a batch is the refusal working.
const real = (errors) => errors.filter((e) => !/rejected|403/.test(e));

test('at Read only the stepper moves, stays moved, and files nothing; the quiz answer is refused', async () => {
  await host.reset();
  const me = await owner();
  const them = await visitor(me, 'mockup', 'view');

  await them.page.click('button:has-text("Next")');
  await them.page.click('button:has-text("Next")');
  await them.page.waitForTimeout(600);
  assert.equal(await stepOf(them.page), '3', 'the step did not snap back');
  assert.ok(await them.page.isVisible('text=Copy link'));
  assert.ok(await filed(me, 'mockup', /class="mock" data-marble-id="mock" data-step="1"/), 'and nobody else moved');

  // The page put back to the file, as a refusal or someone else's edit does,
  // keeps where this visitor is.
  await them.page.evaluate(() => window.marble.patch());
  await them.page.waitForTimeout(300);
  assert.equal(await stepOf(them.page), '3');

  // Back is at the first screen again after two presses, and undo has nothing
  // to send: stepping was never a change.
  await them.page.click('button:has-text("Back")');
  await them.page.waitForTimeout(150);
  assert.equal(await stepOf(them.page), '2');
  assert.equal(await them.page.evaluate(() => window.marble.canUndo), false);

  // An answer is a change, and this link changes nothing.
  await them.page.click('button:has-text("Read only")');
  await them.page.waitForTimeout(800);
  assert.equal(await answerOf(them.page), null, 'the answer was put back');
  assert.ok(!(await filed(me, 'mockup', /data-answer=/)));
  assert.equal(await stepOf(them.page), '2', 'and putting it back left the step alone');
  assert.deepEqual(real(them.errors), []);
});

test('at Read & write the step stays in the tab and the answer is saved', async () => {
  await host.reset();
  const me = await owner();
  await me.page.goto(`${host.base}/a/mockup`);
  await me.page.waitForFunction(() => Boolean(window.marble));
  const them = await visitor(me, 'mockup', 'edit');

  await them.page.click('button:has-text("Next")');
  await them.page.waitForTimeout(400);
  assert.equal(await stepOf(them.page), '2');
  assert.equal(await stepOf(me.page), '1', 'the owner is not moved by a visitor looking');
  assert.ok(await filed(me, 'mockup', /data-step="1"/));

  await them.page.click('button:has-text("Read & write")');
  await them.page.waitForTimeout(600);
  assert.ok(await filed(me, 'mockup', /data-answer="edit"/));
  assert.equal(await answerOf(me.page), 'edit', 'the answer reached the owner');
  assert.equal(await stepOf(them.page), '2');

  // The owner's own looking is still saved, so a link opens where they left it.
  await me.page.click('button:has-text("Next")');
  await me.page.click('button:has-text("Next")');
  await me.page.waitForTimeout(500);
  assert.ok(await filed(me, 'mockup', /data-step="3"/));
  assert.equal(await stepOf(them.page), '2', 'and the visitor stays where they are');
  assert.deepEqual(real(them.errors), []);
});

test('at Read & write a notebook takes typing, and opening another note is the visitor’s own', async () => {
  await host.reset();
  const me = await owner();
  const them = await visitor(me, 'notebook', 'edit');
  const second = await them.page.evaluate(() => document.querySelectorAll('.note')[1].getAttribute('data-marble-id'));

  await them.page.click('.row:nth-child(2) .open');
  await them.page.waitForTimeout(300);
  assert.equal(await them.page.evaluate(() => document.querySelector('.note.marble-open').getAttribute('data-marble-id')), second);
  assert.ok(!(await filed(me, 'notebook', /data-current=/)), 'which note is open is not filed for a visitor');

  await them.page.click('.note.marble-open > :last-child');
  await them.page.keyboard.press('Control+End');
  await them.page.keyboard.type(' Also a visitor wrote this.');
  assert.ok(await until(() => filed(me, 'notebook', /links\. Also a visitor wrote this\./)), 'the typing was saved');
  // Put back to the file, the page keeps the note this visitor has open.
  await them.page.evaluate(() => window.marble.patch());
  await them.page.waitForTimeout(300);
  assert.equal(await them.page.evaluate(() => document.querySelector('.note.marble-open').getAttribute('data-marble-id')), second);
  assert.deepEqual(real(them.errors), []);
});

test('a visitor who has not moved follows the owner, and stops once they do', async () => {
  await host.reset();
  const me = await owner();
  await me.page.goto(`${host.base}/a/mockup`);
  await me.page.waitForFunction(() => Boolean(window.marble));
  const them = await visitor(me, 'mockup', 'view');

  await me.page.click('button:has-text("Next")');
  assert.ok(await until(async () => (await stepOf(them.page)) === '2'), 'the visitor follows');

  await them.page.click('button:has-text("Back")');
  await me.page.click('button:has-text("Next")');
  assert.ok(await until(() => filed(me, 'mockup', /data-step="3"/)));
  await them.page.waitForTimeout(400);
  assert.equal(await stepOf(them.page), '1', 'and stays where they went');
  assert.deepEqual(real(them.errors), []);
});
