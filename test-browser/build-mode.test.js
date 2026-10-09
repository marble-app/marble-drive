// Build mode: no chat. A new app is a place you go to, Describe is on from the
// start, the marks are kept on the host, and Build hands them to one agent
// that builds in the open. Every build is kept, and can be paused, stopped
// and gone back to.
import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const APP = `<!doctype html>
<html><head><meta charset="utf-8"><title>Reviews</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; }
  main { max-width: 900px; margin: 0 auto; padding: 40px; }
  .card { border: 1px solid #e6e2d8; border-radius: 12px; padding: 12px; margin: 12px 0; }
</style></head>
<body data-marble-id="b"><main data-marble-id="m">
  <h1 data-marble-id="h">Reviews</h1>
  <section class="card" data-marble-id="s1"><h2 data-marble-id="s1h">Invitations</h2><p data-marble-id="s1p">Five of them.</p></section>
  <section class="card" data-marble-id="s2"><h2 data-marble-id="s2h">This week</h2><p data-marble-id="s2p">Tue 6 · answer</p></section>
</main></body></html>
`;

const OTHER = `<!doctype html>
<html><head><meta charset="utf-8"><title>Calendar</title><style>.weeks { display: flex; gap: 8px; }</style></head>
<body data-marble-id="b">
  <section class="weeks" data-marble-id="w" aria-label="Weeks ahead">
    <h2 data-marble-id="w1">Weeks ahead</h2>
    <ol data-marble-id="w2"><li data-marble-id="w3">Fri 9 · VinCa review due, with enough words to be a piece</li><li data-marble-id="w4">Mon 12 · second pass on all five</li></ol>
  </section>
</body></html>
`;

const at = (doc) => ({ call: 'apply_ops', args: { path: doc } });
const build = (doc) => [
  { call: 'build_plan', args: { parts: [{ title: 'Title', state: 'now' }, { title: 'Invitations list', state: 'ahead' }] } },
  { call: 'read_document', args: { path: doc } },
  { call: 'list_documents', args: {} },
  { call: 'apply_ops', args: { path: doc, note: 'Stage 1 of 2: ahead', ops: [], reach: ['h', 's1'], total: 2, marks: { verb: 'Building', unit: ['part', 'parts'], draw: [{ at: 's1', as: 'ahead', shape: 'ring' }] } } },
  { sleep: 900 },
  { call: 'apply_ops', args: { path: doc, note: 'Stage 1 of 2: the title', ops: [{ type: 'setText', id: 'h', text: 'CHI reviews' }] } },
  { call: 'build_plan', args: { parts: [{ title: 'Title', state: 'done' }, { title: 'Invitations list', state: 'done' }] } },
  { say: 'Built the title.' },
];
void at;

const SCRIPTS = {
  build: build('Reviews'),
  slow: [
    { call: 'build_plan', args: { parts: [{ title: 'Title', state: 'now' }, { title: 'List', state: 'ahead' }] } },
    { call: 'read_document', args: { path: 'Reviews' } },
    { call: 'apply_ops', args: { path: 'Reviews', note: 'Stage 1 of 2', ops: [{ type: 'setText', id: 'h', text: 'Half built' }] } },
    { sleep: 15000 },
    { say: 'late' },
  ],
  first: [
    { call: 'build_plan', args: { parts: [{ title: 'Title and summary', state: 'now' }], title: 'CHI reviews', folder: 'UCSD' } },
    { call: 'read_document', args: { path: 'Untitled' } },
    { sleep: 600 },
    { call: 'build_plan', args: { parts: [{ title: 'Title and summary', state: 'done' }] } },
    { say: 'Made the title.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { Reviews: APP, Calendar: OTHER } });
await host.drive.store.mkdir('UCSD').catch(() => {});
test.after(() => host.close());

const pages = [];
const closePages = async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); };
test.after(closePages);

const api = async (method, route, body) => {
  const response = await fetch(`${host.base}${route}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json().catch(() => null);
};
const state = (doc = 'Reviews') => api('GET', `/agent/builds?path=${encodeURIComponent(doc)}`);

/** A fresh Reviews app with nothing marked on it, open with Build mode on. */
const open = async ({ doc = 'Reviews', width = 1280, height = 820, colorScheme = 'light', reducedMotion = 'no-preference' } = {}) => {
  await closePages();
  const marks = (await state(doc)).marks ?? [];
  if (marks.length) await api('DELETE', `/agent/builds/marks?path=${encodeURIComponent(doc)}`, { ids: marks.map((m) => m.id) });
  await host.reset();
  const { page, errors } = await host.newPage({ build: true, viewport: { width, height }, colorScheme, reducedMotion });
  pages.push(page);
  await page.goto(`${host.base}/a/${encodeURIComponent(doc)}`);
  await page.waitForFunction(() => Boolean(window.marbleBuild?.state()));
  return { page, errors };
};

const bar = (page) => page.locator('.marble-marks-bar');
const tool = (page, id) => page.locator(`.marble-marks-tool[data-tool="${id}"]`);
const go = (page) => page.locator('.marble-build-go');
const box = (page, id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();

const noteOn = async (page, id, text) => {
  await page.keyboard.press('t');
  const r = await box(page, id);
  await page.mouse.click(r.x + r.width - 80, r.y + 12);
  await page.keyboard.type(text);
  await page.locator('.marble-marks-note-body:focus').evaluate((node) => node.blur());
  await page.waitForFunction((words) => fetch(`/agent/builds?path=${encodeURIComponent(window.marble.app)}`).then((r) => r.json()).then((s) => s.marks.some((m) => m.text === words)), text);
};

test('every app starts in Describe: the toolbar is up, no ring, no notice, full size', async () => {
  const { page, errors } = await open();
  assert.equal(await page.evaluate(() => window.marbleMarks.describing), true);
  await bar(page).waitFor();
  // The tools, then the build's own controls in place of Explore.
  assert.equal(await tool(page, 'comment').count(), 1, 'Comment is a tool');
  assert.equal(await tool(page, 'explore').count(), 0, 'Explore is not on the bar');
  assert.equal(await page.locator('.marble-build-status').count(), 1);
  assert.equal(await go(page).textContent(), 'Build');
  assert.equal(await go(page).getAttribute('aria-disabled'), 'true', 'nothing to build yet');
  assert.equal(await page.locator('.marble-marks-ring').isVisible(), false, 'no green ring');
  assert.equal(await page.locator('.marble-marks-notice').isVisible(), false, 'no notice');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).transform), 'none', 'the app is not scaled');
  // The app still works under the cursor.
  assert.equal(await tool(page, 'use').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
});

test('a note is kept on the host, survives a reload, and the status mark counts it', async () => {
  const { page } = await open();
  await noteOn(page, 's1', 'Group the overdue ones on top');
  await page.locator('.marble-build-status[data-run="pending"]').waitFor();
  assert.equal(await page.locator('.marble-build-status .g-pend .n').textContent(), '1');
  assert.equal(await go(page).getAttribute('aria-disabled'), 'false');
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marbleBuild?.state()));
  await page.locator('.marble-marks-note-body', { hasText: 'Group the overdue ones on top' }).waitFor();
});

test('turning Describe off is remembered for the app, and folds the toolbar into one button; nothing comes up under a passing hand', async () => {
  const { page } = await open();
  await tool(page, 'done').click();
  await page.locator('.marble-build-handle:not([data-away])').waitFor();
  assert.equal(await page.evaluate(() => window.marbleMarks.describing), false);
  // Hovering a part of the app draws nothing on it.
  const r = await box(page, 's2');
  await page.mouse.move(r.x + 100, r.y + 40);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.marble-build-plus, .marble-build-plus-ring').count(), 0, 'no + and no ring on hover');
  // A reload opens it off.
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marbleBuild));
  assert.equal(await page.evaluate(() => window.marbleMarks.describing), false);
  await page.locator('.marble-build-handle').click();
  assert.equal(await page.evaluate(() => window.marbleMarks.describing), true);
});

test('Build hands the marks to one agent: the plan fills the status, what it reads is drawn, and the marks are built', async () => {
  const { page, errors } = await open();
  await noteOn(page, 's1', 'script:build Group the overdue ones on top');
  await go(page).click();
  // The build is the toolbar's now: its words and meter, with Pause and Stop.
  await page.locator('.marble-build-run:not([hidden])').waitFor();
  await page.locator('.marble-build-status[data-run="building"]').waitFor();
  // What it read, beside the part it works on.
  await page.locator('.marble-build-found', { hasText: 'Read this app' }).waitFor();
  // The status mark opens no card: it opens the margin on Building, headed
  // by the build (its parts in words until a picture comes), and the note's
  // card there says it is in the build.
  await page.locator('.marble-build-status').click();
  await page.locator('.marble-margin:not([hidden]) .marble-margin-build', { hasText: 'Invitations list' }).waitFor();
  assert.match(await page.locator('.marble-margin .sum').textContent(), /1 in the build/);
  await page.locator('.marble-margin-card[data-show="build"]', { hasText: 'Group the overdue' }).waitFor();
  assert.equal(await page.locator('.marble-build-pop').count(), 0, 'no plan popover');
  await page.locator('.marble-build-status[data-run="done"]').waitFor({ timeout: 15_000 });
  // Done: the build's card goes, and the mark says it was made in it.
  // One list: the built mark stays in it, drawn as done.
  await page.locator('.marble-margin-card[data-key="built"][data-show="done"]', { hasText: 'Done in Build 1' }).waitFor();
  // Pressed again with no build in hand, the status mark puts the margin away.
  await page.locator('.marble-build-status').click();
  await page.locator('.marble-margin').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-marble-id="h"]').textContent(), 'CHI reviews');
  const s = await state();
  assert.equal(s.builds.at(-1).status, 'finished');
  assert.equal(s.marks[0].state, 'built');
  await page.locator('.marble-marks-note[data-state="built"]').waitFor();
  // Every build is kept: Builds lists it, showing, and the app before it.
  await page.locator('.marble-marks-tool[aria-label^="Builds"]').click();
  await page.locator('.marble-build-row[data-showing]', { hasText: 'Build' }).waitFor();
  await page.locator('.marble-build-row', { hasText: 'Before build 1' }).locator('button.pick').click();
  await page.waitForFunction(() => document.querySelector('[data-marble-id="h"]')?.textContent === 'Reviews');
  // The margin opened the shell's frame, whose tree asks for the drive's own
  // page, which a test drive does not have: that one 404 is the frame's.
  assert.deepEqual(errors.filter((e) => !/favicon|status of 404/.test(e)), []);
});

test('pause holds the build where it got to; stop goes back and keeps it in Builds', async () => {
  const { page } = await open();
  await noteOn(page, 's1', 'script:slow Make it');
  await go(page).click();
  await page.waitForFunction(() => document.querySelector('[data-marble-id="h"]')?.textContent === 'Half built');
  await page.locator('.marble-build-run button').first().click(); // Pause
  await page.locator('.marble-build-run[data-run="paused"]').waitFor();
  assert.equal(await page.locator('.marble-build-status').getAttribute('data-run'), 'paused');
  assert.equal(await page.locator('[data-marble-id="h"]').textContent(), 'Half built', 'what landed stays');
  await page.locator('.marble-build-run button').last().click(); // Stop
  await page.waitForFunction(() => document.querySelector('[data-marble-id="h"]')?.textContent === 'Reviews');
  const s = await state();
  assert.equal(s.builds.at(-1).status, 'stopped');
  assert.equal(s.marks.find((m) => m.text === 'script:slow Make it').state, 'waiting', 'its marks wait again');
});

test('Select picks marks and builds only those; on parts of the app it saves a piece', async () => {
  const { page } = await open();
  await noteOn(page, 's1', 'One');
  await noteOn(page, 's2', 'Two');
  await page.keyboard.press('a');
  const note = page.locator('.marble-marks-note', { hasText: 'Two' });
  await note.locator('.marble-marks-note-body').click();
  await page.locator('.marble-build-sel:not([hidden])', { hasText: '1 mark' }).waitFor();
  assert.equal(await go(page).textContent(), 'Build selection');
  // Remove, from the bar.
  await page.locator('.marble-build-sel button', { hasText: 'Remove' }).click();
  await page.waitForFunction(() => fetch('/agent/builds?path=Reviews').then((r) => r.json()).then((s) => s.marks.length === 1));
  // A click on a part of the app picks the part: Save as piece.
  const r = await box(page, 's2');
  await page.mouse.click(r.x + 300, r.y + 60);
  await page.locator('.marble-build-sel:not([hidden])', { hasText: 'This part' }).waitFor();
  await page.locator('.marble-build-sel button', { hasText: 'Save as piece' }).click();
  await page.waitForFunction(() => fetch('/agent/pieces?path=Reviews').then((r) => r.json()).then((p) => p.saved.length >= 1));
});

test('a comment is a pin with a thread; the agent answers in it', async () => {
  const { page } = await open();
  await page.keyboard.press('c');
  const r = await box(page, 's2');
  await page.mouse.click(r.x + 60, r.y + 30);
  await page.locator('.marble-build-thread textarea:focus').waitFor();
  // The box is as wide and as tall as what is written in it.
  const thin = await page.locator('.marble-build-thread').boundingBox();
  await page.keyboard.type('Can this show two weeks? And when a week has more than five invitations in it, can it fold the rest under a count?');
  await page.waitForTimeout(260);
  const grown = await page.locator('.marble-build-thread').boundingBox();
  assert.ok(grown.width > thin.width + 60 && grown.height > thin.height, `${JSON.stringify(thin)} → ${JSON.stringify(grown)}`);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Thanks.');
  assert.match(await page.locator('.marble-build-thread textarea').inputValue(), /count\?\nThanks\.$/);
  await page.keyboard.press('Enter');
  await page.locator('.marble-build-line[data-who="you"]', { hasText: 'Can this show two weeks?' }).waitFor();
  // No model on a test host: the thread says so rather than hanging.
  await page.locator('.marble-build-line[data-who="agent"] p').waitFor();
  assert.equal(await page.locator('.marble-marks-pin').textContent(), '1');
  const s = await state();
  assert.equal(s.marks.find((m) => m.type === 'comment').thread.length, 2);
  // An empty pin is taken off when its card closes. (The caret is still in
  // the thread, where C is a letter, so the tool is taken from the toolbar.)
  await tool(page, 'comment').click();
  await page.mouse.click(r.x + 200, r.y + 30);
  await page.locator('.marble-build-thread textarea:focus').waitFor();
  await page.mouse.click(10, 10);
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-pin').length === 1);
});

/** Waits until the host's state for Reviews says so. (waitForFunction takes a
 *  promise for a yes, so a fetch in it is checked once and never again.) */
const hostSays = async (page, test, label = 'the host never said so') => {
  for (let i = 0; i < 100; i += 1) {
    const marks = await page.evaluate(() => fetch('/agent/builds?path=Reviews').then((x) => x.json()).then((s) => s.marks));
    if (test(marks)) return marks;
    await page.waitForTimeout(100);
  }
  throw new Error(label);
};

test('a note is one press: the app is the app again after it, its × deletes it, and Undo puts it back', async () => {
  const { page } = await open();
  await tool(page, 'text').click();
  const r = await box(page, 's1');
  await page.mouse.click(r.x + 300, r.y + 12);
  await page.locator('.marble-marks-note-body:focus').waitFor();
  assert.equal(await page.evaluate(() => window.marbleMarks.mode), null, 'back to using the app');
  assert.equal(await tool(page, 'use').getAttribute('aria-pressed'), 'true');
  // It widens with what is typed, then wraps.
  const slip = (await page.locator('.marble-marks-note').boundingBox()).width;
  await page.keyboard.type('Group the overdue ones on top, and colour each by how many days late it is, with the worst first');
  const wide = await page.locator('.marble-marks-note').boundingBox();
  assert.ok(wide.width > slip && wide.width <= 381 && wide.height > 60, `${slip} → ${JSON.stringify(wide)}`);
  // A press away is the app's, not a second note.
  await page.mouse.click(r.x + 40, r.y + 400);
  assert.equal(await page.locator('.marble-marks-note').count(), 1);
  await hostSays(page, (marks) => marks.length === 1);
  // The × deletes it, and says so with Undo; ⌘Z does the same.
  await page.locator('.marble-marks-note-close').click();
  assert.equal(await page.locator('.marble-marks-note').count(), 0);
  await page.locator('.marble-marks-undo:not([hidden])', { hasText: 'Note deleted' }).waitFor();
  await hostSays(page, (marks) => marks.length === 0, 'deleted on the host');
  await page.locator('.marble-marks-undo button').click();
  await page.locator('.marble-marks-note-body', { hasText: 'Group the overdue' }).waitFor();
  await hostSays(page, (marks) => marks.length === 1 && marks[0].text.startsWith('Group the overdue'), 'kept again');
  await page.locator('.marble-marks-note-close').click();
  await page.keyboard.press('ControlOrMeta+z');
  await page.locator('.marble-marks-note-body', { hasText: 'Group the overdue' }).waitFor();
});

test('a note takes a pasted picture and a pasted part as themselves, and the build is told where they are', async () => {
  const { page } = await open();
  await tool(page, 'text').click();
  const r = await box(page, 's1');
  await page.mouse.click(r.x + 300, r.y + 12);
  await page.locator('.marble-marks-note-body:focus').waitFor();
  await page.keyboard.type('Like this');
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 120;
    c.getContext('2d').fillRect(0, 0, 120, 60);
    const blob = await new Promise((done) => c.toBlob(done, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const html = new DataTransfer();
    html.setData('text/html', '<div><button>Accept</button><button>Decline</button></div>');
    html.setData('text/plain', 'Accept Decline');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: html, bubbles: true, cancelable: true }));
  });
  await page.locator('.marble-marks-att[data-kind="image"]:not([data-loading]) img').waitFor();
  await page.locator('.marble-marks-att[data-kind="clip"]', { hasText: 'Accept Decline' }).waitFor();
  assert.equal(await page.locator('.marble-marks-note-body').textContent(), 'Like this', 'the pasted things are not in the words');
  await page.mouse.click(r.x + 40, r.y + 400);
  const [kept] = await hostSays(page, (marks) => marks[0]?.images?.length === 1 && marks[0]?.clips?.length === 1, 'the picture and the part are kept');
  assert.equal(kept.text, 'Like this');
  const type = await page.evaluate((name) => fetch(`/agent/builds/image?name=${name}`).then((x) => x.headers.get('content-type')), kept.images[0].name);
  assert.equal(type, 'image/png');
});

test('with the margin open, a note being written stays on the app, then folds into its pin', async () => {
  const { page } = await open();
  await openMargin(page);
  await page.waitForTimeout(400);
  await tool(page, 'text').click();
  const r = await box(page, 's2');
  await page.mouse.click(r.x + 200, r.y + 20);
  await page.locator('.marble-marks-note-body:focus').waitFor();
  await page.keyboard.type('Shown while I write it');
  assert.equal(await page.locator('.marble-marks-note').evaluate((n) => getComputedStyle(n).visibility), 'visible');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.marble-marks-note')).visibility === 'hidden');
  await page.locator('.marble-margin-card', { hasText: 'Shown while I write it' }).waitFor();
  assert.equal(await page.locator('.marble-margin-pin:not([hidden])').count(), 1);
});

const margin = (page) => page.locator('.marble-margin');
const openMargin = async (page) => {
  await page.evaluate(() => dispatchEvent(new CustomEvent('marble-build:toggle-comments')));
  await margin(page).waitFor();
};
const dock = (page) => page.evaluate(() => getComputedStyle(document.documentElement).marginRight);

test('the margin: a card beside each mark, level with its pin, the app narrowed to make room', async () => {
  const { page, errors } = await open();
  await noteOn(page, 's1', 'Group the overdue ones on top');
  await noteOn(page, 's2', 'Show two weeks');
  assert.equal(await dock(page), '0px');
  await openMargin(page);
  // Docked where the chat docks: the page narrows by the margin's width.
  await page.waitForFunction(() => Math.round(Number.parseFloat(getComputedStyle(document.documentElement).marginRight)) === 312);
  const cards = page.locator('.marble-margin-card:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('.marble-margin-card:not([hidden])').length === 2);
  assert.match(await cards.first().textContent(), /Note · on Invitations/);
  // With the margin open the notes' bodies leave the app; numbered pins stay.
  assert.equal(await page.locator('.marble-marks-note').first().evaluate((n) => getComputedStyle(n).visibility), 'hidden');
  assert.equal(await page.locator('.marble-margin-pin:not([hidden])').count(), 2);
  // Each card's top is its pin's top less 10px, once the margin has slid in.
  await page.waitForTimeout(900);
  const level = await page.evaluate(() => [...document.querySelectorAll('.marble-margin-card')].map((card) => {
    const pin = document.querySelector(`.marble-margin-pin[data-id="${card.dataset.id}"]`);
    return Math.round(card.getBoundingClientRect().top - (pin.getBoundingClientRect().top - 10));
  }));
  for (const off of level) assert.ok(Math.abs(off) <= 2, `level with its pin: ${level}`);

  // A press picks it: it steps 12px toward the app, and it and its pin are
  // shaded in the accent; no line joins them. Esc lets go.
  const second = cards.nth(1);
  const before = (await second.boundingBox()).x;
  await second.click();
  assert.equal(await second.getAttribute('aria-expanded'), 'true');
  await page.waitForTimeout(450);
  assert.equal(Math.round(before - (await second.boundingBox()).x), 12);
  assert.equal(await page.locator('.marble-margin-pin[data-picked]').count(), 1);
  assert.equal(await page.locator('.marble-margin-wire').count(), 0, 'no line');
  const shade = await second.evaluate((n) => getComputedStyle(n).backgroundColor);
  assert.notEqual(shade, await cards.first().evaluate((n) => getComputedStyle(n).backgroundColor), 'the picked card is shaded');
  await page.keyboard.press('Escape');
  assert.equal(await second.getAttribute('aria-expanded'), 'false');

  // Hold back: the mark says so on its card and its pin, and is kept so.
  assert.match(await second.locator('.stl').textContent(), /Waits for the next build/);
  await second.locator('.sb', { hasText: 'Hold back' }).click();
  await page.locator('.marble-margin-card[data-key="held"]', { hasText: 'Put back' }).waitFor();
  assert.equal(await page.locator('.marble-margin-pin[data-key="held"]').count(), 1);
  assert.equal((await state()).marks.find((m) => m.text === 'Show two weeks').held, true);
  assert.match(await go(page).textContent(), /Build/);

  // One list, no filter: the head counts what is in it.
  assert.equal(await page.locator('.marble-margin .filt').count(), 0);
  assert.match(await page.locator('.marble-margin .sum').textContent(), /2 open/);

  // A note's words can be changed on its card, and are kept.
  const words = cards.first().locator('.words[contenteditable]');
  await words.click();
  await page.keyboard.press('End');
  await page.keyboard.type(', then the rest');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => fetch('/agent/builds?path=Reviews').then((x) => x.json()).then((s) => s.marks.some((m) => m.text === 'Group the overdue ones on top, then the rest')));
  await page.locator('.marble-marks-note-body', { hasText: 'then the rest' }).waitFor({ state: 'attached' });

  // The side survives a reload.
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marbleBuild?.state()));
  await margin(page).waitFor();
  await page.waitForFunction(() => Math.round(Number.parseFloat(getComputedStyle(document.documentElement).marginRight)) === 312);

  // Pieces takes the side from it, in the same place; closing gives the app
  // its width back. Describe off puts the margin away.
  await page.locator('.marble-marks-tool[aria-label^="Pieces"]').click();
  await page.locator('.marble-build-pieces').waitFor();
  await margin(page).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.getElementById('marble-build-dock')?.textContent === 'html { margin-inline-end: 312px !important; --marble-dock-right: 312px; }');
  await page.locator('.marble-build-pieces button[aria-label="Close Pieces"]').click();
  await page.waitForFunction(() => getComputedStyle(document.documentElement).marginRight === '0px');
  await openMargin(page);
  await page.evaluate(() => window.marbleMarks.setDescribing(false));
  await margin(page).waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.marbleBuild.side), 'none');
  // The side opens the shell's frame, whose tree asks for the drive's own
  // page, which a test drive does not have: that one 404 is the frame's.
  assert.deepEqual(errors.filter((e) => !/favicon|status of 404/.test(e)), []);
});

test('in the margin a comment is a card: the app answers in its own name, and a reply goes on in the card', async () => {
  const { page } = await open();
  await openMargin(page);
  await page.locator('.marble-margin .sum', { hasText: 'No marks yet' }).waitFor();
  await page.locator('.marble-margin .add').click();
  const r = await box(page, 's2');
  await page.mouse.click(r.x + 60, r.y + 30);
  await page.locator('.marble-build-thread textarea:focus').waitFor();
  await page.keyboard.type('Can this show two weeks?');
  await page.keyboard.press('Enter');
  // Posted, it is read in the margin: the floating box goes, the card is picked.
  const card = page.locator('.marble-margin-card[aria-expanded="true"]');
  await card.waitFor();
  await page.locator('.marble-build-thread').waitFor({ state: 'hidden' });
  await card.locator('.marble-build-line[data-who="agent"] p').waitFor();
  assert.equal(await card.locator('.marble-build-line[data-who="agent"] b').textContent(), 'Reviews', 'signed with the app\'s name');
  assert.doesNotMatch(await margin(page).textContent(), /\bAgent\b/);
  assert.match(await card.locator('.stl').textContent(), /Answered/);
  await card.locator('.reply textarea').fill('And next month?');
  await card.locator('.reply textarea').press('Enter');
  await page.waitForFunction(() => fetch('/agent/builds?path=Reviews').then((x) => x.json()).then((s) => s.marks.find((m) => m.type === 'comment')?.thread.length === 4));
  // Resolved, it stays in the list drawn as done; Reopen brings it back.
  await card.locator('.sb', { hasText: 'Resolve' }).waitFor();
  await card.locator('.sb', { hasText: 'Resolve' }).click();
  await page.locator('.marble-margin-card[data-key="resolved"][data-show="done"]').waitFor();
  await page.locator('.marble-margin-card .sb', { hasText: 'Reopen' }).click();
  await page.waitForFunction(() => fetch('/agent/builds?path=Reviews').then((x) => x.json()).then((s) => s.marks.find((m) => m.type === 'comment')?.resolved === false));
});

test('on a phone the margin is a sheet from the foot, and docks nothing', async () => {
  const { page } = await open({ width: 390, height: 800 });
  await noteOn(page, 's1', 'On a phone');
  await openMargin(page);
  assert.equal(await margin(page).getAttribute('data-sheet'), '');
  assert.equal(await dock(page), '0px');
  const sheet = await margin(page).boundingBox();
  assert.ok(sheet.x >= 0 && sheet.x + sheet.width <= 391 && sheet.y > 200, JSON.stringify(sheet));
  await page.locator('.marble-margin-card').first().click();
  assert.equal(await margin(page).getAttribute('data-low'), '');
});

test('Pieces: parts of other apps, incorporated onto this one as a card that waits for a build', async () => {
  const { page } = await open();
  await page.locator('.marble-marks-tool[aria-label^="Pieces"]').click();
  const card = page.locator('.marble-build-pc', { hasText: 'Weeks ahead' }).first();
  await card.waitFor();
  await card.hover();
  await card.locator('.inc').click();
  await page.locator('.marble-marks-piece', { hasText: 'Weeks ahead' }).waitFor();
  await page.waitForFunction(() => fetch('/agent/builds?path=Reviews').then((r) => r.json()).then((s) => s.marks.some((m) => m.type === 'piece')));
  await page.locator('.marble-build-pc[data-in]', { hasText: 'Weeks ahead' }).first().waitFor();
});

test('New goes to the app: the prompt is its first note, the first build names it and offers a folder', async () => {
  await closePages();
  const { page, errors } = await host.newPage({ build: true });
  pages.push(page);
  await page.goto(`${host.base}/a/Reviews`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-shell')?.buildApp));
  await page.evaluate(() => document.querySelector('marble-shell').buildApp('script:first Track my CHI review invitations'));
  await page.waitForURL(/\/a\/Untitled/);
  await page.locator('.marble-marks-note[data-first]', { hasText: 'Track my CHI review invitations' }).waitFor();
  assert.ok(!page.url().includes('#build='), 'the prompt is read once and taken off the address');
  await page.waitForURL(/\/a\/CHI%20reviews/, { timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.marbleBuild?.state()));
  const s = await state('CHI reviews');
  assert.equal(s.builds[0].status, 'finished');
  assert.equal(s.folder, 'UCSD');
  const chip = await page.evaluate(() => document.querySelector('marble-shell').shadowRoot.querySelector('.offer:not([hidden])')?.textContent ?? '');
  assert.match(chip, /Move to UCSD/);
  assert.deepEqual(errors.filter((e) => !/favicon/.test(e)), []);
});

test('the shell New offers App first, and Enter builds it there', async () => {
  await closePages();
  const { page } = await host.newPage({ build: true });
  pages.push(page);
  await page.goto(`${host.base}/a/Reviews`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-shell')));
  const tiles = await page.evaluate(() => [...document.querySelector('marble-shell').shadowRoot.querySelectorAll('.apps > .to')].filter((t) => !t.hidden).map((t) => t.dataset.app));
  assert.deepEqual(tiles, ['App', 'Chat', 'Agents', 'Board']);
  assert.equal(await page.evaluate(() => document.querySelector('marble-shell').chosenApp()), 'App');
});

test('Build mode off: Describe is the mode you turn on, and New is the chat\'s', async () => {
  await closePages();
  const { page } = await host.newPage({ build: false });
  pages.push(page);
  await page.goto(`${host.base}/a/Reviews`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && document.querySelector('.marble-marks-layer')));
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => Boolean(window.marbleBuild)), false);
  assert.equal(await page.evaluate(() => window.marbleMarks?.building ?? false), false);
  assert.equal(await page.locator('.marble-marks-layer[data-describing]').count(), 0);
  assert.equal(await page.evaluate(() => document.querySelector('marble-shell').chosenApp()), 'Chat');
});

test('both schemes, desk and phone: nothing runs off the side', async () => {
  for (const [width, scheme] of [[1100, 'dark'], [390, 'light'], [390, 'dark']]) {
    const { page } = await open({ width, height: 800, colorScheme: scheme });
    await noteOn(page, 's1', `At ${width}`);
    const wide = await page.evaluate(() => {
      const r = document.querySelector('.marble-marks-bar').getBoundingClientRect();
      return { left: r.left, right: r.right, vw: innerWidth };
    });
    assert.ok(wide.left >= 0 && wide.right <= wide.vw + 1, `the toolbar fits at ${width}: ${JSON.stringify(wide)}`);
    await page.locator('.marble-marks-tool[aria-label^="Pieces"]').click();
    await page.waitForTimeout(450);
    const sheet = await page.locator('.marble-build-pieces').boundingBox();
    assert.ok(sheet.x >= 0 && sheet.x + sheet.width <= width + 1, `Pieces fits at ${width}`);
  }
});
