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

test('turning Describe off is remembered for the app, and folds the toolbar into one button with a + on parts', async () => {
  const { page } = await open();
  await tool(page, 'done').click();
  await page.locator('.marble-build-handle:not([data-away])').waitFor();
  assert.equal(await page.evaluate(() => window.marbleMarks.describing), false);
  // A + on the part under the hand drops a note there, back in Describe.
  const r = await box(page, 's2');
  await page.mouse.move(r.x + 100, r.y + 40);
  await page.locator('.marble-build-plus:not([hidden])').waitFor();
  await page.locator('.marble-build-plus').click();
  assert.equal(await page.evaluate(() => window.marbleMarks.describing), true);
  await page.locator('.marble-marks-note-body:focus').waitFor();
  // Off again, and a reload opens it off.
  await page.keyboard.press('Escape');
  await tool(page, 'done').click();
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
  assert.equal(await page.locator('.marble-margin .filt [aria-pressed="true"]').textContent(), 'Building');
  await page.locator('.marble-margin-card[data-show="build"]', { hasText: 'Group the overdue' }).waitFor();
  assert.equal(await page.locator('.marble-build-pop').count(), 0, 'no plan popover');
  await page.locator('.marble-build-status[data-run="done"]').waitFor({ timeout: 15_000 });
  // Done, the build says so where it was followed, and the mark is Done.
  await page.locator('.marble-margin-build', { hasText: 'is done' }).waitFor();
  await page.locator('.marble-margin .filt button', { hasText: 'Done' }).click();
  await page.locator('.marble-margin-card[data-key="built"]', { hasText: 'Done in Build 1' }).waitFor();
  // Pressed again with no build in hand, the status mark puts the margin away.
  await page.locator('.marble-build-status').click();
  await page.locator('.marble-margin').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-marble-id="h"]').textContent(), 'CHI reviews');
  const s = await state();
  assert.equal(s.builds.at(-1).status, 'finished');
  assert.equal(s.marks[0].state, 'built');
  await page.locator('.marble-marks-note[data-state="built"]').waitFor();
  // Every build is kept: Builds lists it, showing, and the app before it.
  await page.keyboard.press('Escape');
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
  await page.locator('.marble-build-thread input:focus').waitFor();
  await page.keyboard.type('Can this show two weeks?');
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
  await page.locator('.marble-build-thread input:focus').waitFor();
  await page.mouse.click(10, 10);
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-pin').length === 1);
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
  // Each card's top is its pin's top less 10px.
  await page.waitForTimeout(450);
  const level = await page.evaluate(() => [...document.querySelectorAll('.marble-margin-card')].map((card) => {
    const pin = document.querySelector(`.marble-margin-pin[data-id="${card.dataset.id}"]`);
    return Math.round(card.getBoundingClientRect().top - (pin.getBoundingClientRect().top - 10));
  }));
  for (const off of level) assert.ok(Math.abs(off) <= 2, `level with its pin: ${level}`);

  // A press picks it: it steps 12px toward the app, its pin is lit, a line
  // joins them. Esc lets go.
  const second = cards.nth(1);
  const before = (await second.boundingBox()).x;
  await second.click();
  assert.equal(await second.getAttribute('aria-expanded'), 'true');
  await page.waitForTimeout(450);
  assert.equal(Math.round(before - (await second.boundingBox()).x), 12);
  assert.equal(await page.locator('.marble-margin-pin[data-picked]').count(), 1);
  assert.notEqual(await page.locator('.marble-margin-wire').evaluate((n) => n.style.display), 'none');
  await page.keyboard.press('Escape');
  assert.equal(await second.getAttribute('aria-expanded'), 'false');

  // Hold back: the mark says so on its card and its pin, and is kept so.
  assert.match(await second.locator('.stl').textContent(), /Waits for the next build/);
  await second.locator('.sb', { hasText: 'Hold back' }).click();
  await page.locator('.marble-margin-card[data-key="held"]', { hasText: 'Put back' }).waitFor();
  assert.equal(await page.locator('.marble-margin-pin[data-key="held"]').count(), 1);
  assert.equal((await state()).marks.find((m) => m.text === 'Show two weeks').held, true);
  assert.match(await go(page).textContent(), /Build/);

  // The filter: Done has nothing yet, and says so in words.
  await page.locator('.marble-margin .filt button', { hasText: 'Done' }).click();
  assert.equal(await cards.count(), 0);
  assert.match(await page.locator('.marble-margin .none').textContent(), /Nothing done yet/);
  await page.locator('.marble-margin .filt button', { hasText: 'Open' }).click();

  // The side and the filter survive a reload.
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marbleBuild?.state()));
  await margin(page).waitFor();
  await page.waitForFunction(() => Math.round(Number.parseFloat(getComputedStyle(document.documentElement).marginRight)) === 312);

  // Pieces takes the side from it, in the same place; closing gives the app
  // its width back. Describe off puts the margin away.
  await page.locator('.marble-marks-tool[aria-label^="Pieces"]').click();
  await page.locator('.marble-build-pieces').waitFor();
  await margin(page).waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.getElementById('marble-build-dock')?.textContent ?? ''), 'html { margin-inline-end: 312px !important; --marble-dock-right: 312px; }');
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
  await page.locator('.marble-margin .none', { hasText: 'Nothing on the app yet' }).waitFor();
  await page.locator('.marble-margin .add').click();
  const r = await box(page, 's2');
  await page.mouse.click(r.x + 60, r.y + 30);
  await page.locator('.marble-build-thread input:focus').waitFor();
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
  await card.locator('.reply input').fill('And next month?');
  await card.locator('.reply input').press('Enter');
  await page.waitForFunction(() => fetch('/agent/builds?path=Reviews').then((x) => x.json()).then((s) => s.marks.find((m) => m.type === 'comment')?.thread.length === 4));
  // Resolve puts it under Done; Reopen brings it back.
  await card.locator('.sb', { hasText: 'Resolve' }).waitFor();
  await card.locator('.sb', { hasText: 'Resolve' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.marble-margin-card:not([hidden])').length === 0);
  await page.locator('.marble-margin .filt button', { hasText: 'Done' }).click();
  await page.locator('.marble-margin-card[data-key="resolved"]').click();
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
    const sheet = await page.locator('.marble-build-pieces').boundingBox();
    assert.ok(sheet.x >= 0 && sheet.x + sheet.width <= width + 1, `Pieces fits at ${width}`);
  }
});
