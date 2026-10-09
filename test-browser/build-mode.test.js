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

const LONG = `<!doctype html>
<html><head><meta charset="utf-8"><title>Long</title>
<style>body { font: 14px/1.5 system-ui, sans-serif; margin: 0; } main { max-width: 800px; margin: 0 auto; padding: 40px; } .card { border: 1px solid #ddd; border-radius: 12px; padding: 12px; margin: 12px 0; height: 160px; }</style></head>
<body data-marble-id="b"><main data-marble-id="m">${Array.from({ length: 24 }, (_, i) => `<section class="card" data-marble-id="r${i}"><h2 data-marble-id="r${i}h">Row ${i}</h2></section>`).join('')}</main></body></html>
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
  settle: [
    { call: 'build_plan', args: { parts: [{ title: 'Two weeks', state: 'now' }] } },
    { call: 'read_document', args: { path: 'Reviews' } },
    { call: 'build_plan', args: { parts: [{ title: 'Two weeks', state: 'done' }], settled: [{ id: 'mc1', said: 'It shows two weeks now.' }] } },
    { say: 'Showed two weeks.' },
  ],
  first: [
    { call: 'build_plan', args: { parts: [{ title: 'Title and summary', state: 'now' }], title: 'CHI reviews', folder: 'UCSD' } },
    { call: 'read_document', args: { path: 'Untitled' } },
    { sleep: 600 },
    { call: 'build_plan', args: { parts: [{ title: 'Title and summary', state: 'done' }] } },
    { say: 'Made the title.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { Reviews: APP, Calendar: OTHER, Long: LONG } });
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

/** A fresh Reviews app with nothing marked on it, open with Build mode on.
 *  Unless `defaults` is asked for, it starts as these tests were written:
 *  the frame put away and the sidebar on the chat, so the marks are on the
 *  app rather than folded into Marks. */
const open = async ({ doc = 'Reviews', width = 1280, height = 820, colorScheme = 'light', reducedMotion = 'no-preference', defaults = false } = {}) => {
  await closePages();
  const marks = (await state(doc)).marks ?? [];
  if (marks.length) await api('DELETE', `/agent/builds/marks?path=${encodeURIComponent(doc)}`, { ids: marks.map((m) => m.id) });
  await host.reset();
  const { page, errors } = await host.newPage({ build: true, viewport: { width, height }, colorScheme, reducedMotion });
  if (!defaults) {
    await page.addInitScript((name) => {
      try {
        if (localStorage.getItem('marble-shell:open') === null) localStorage.setItem('marble-shell:open', '0');
        if (localStorage.getItem(`marble-build:side:${name}`) === null) localStorage.setItem(`marble-build:side:${name}`, 'none');
      } catch { /* opaque origin */ }
    }, doc);
  }
  pages.push(page);
  await page.goto(`${host.base}/a/${encodeURIComponent(doc)}`);
  await page.waitForFunction(() => Boolean(window.marbleBuild?.state()));
  return { page, errors };
};

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

const bar = (page) => page.locator('.marble-marks-bar');
const tool = (page, id) => page.locator(`.marble-marks-tool[data-tool="${id}"]`);
const go = (page) => page.locator('.marble-build-go');
const box = (page, id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();

const noteOn = async (page, id, text) => {
  await tool(page, 'text').click();
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
  // One thing to write with: a note, kept or sent. No Comment tool, and the
  // bar holds the build alone: no Builds, no Pieces (they are on the shell's).
  assert.equal(await tool(page, 'comment').count(), 0, 'no Comment tool');
  assert.equal(await tool(page, 'text').count(), 1, 'Note is a tool');
  assert.equal(await tool(page, 'explore').count(), 0, 'Explore is not on the bar');
  assert.equal(await page.locator('.marble-marks-tool[aria-label^="Pieces"], .marble-marks-tool[aria-label^="Builds"]').count(), 0);
  // Clear stays on the bar, dimmed with nothing to clear.
  assert.equal(await tool(page, 'clear').isVisible(), true);
  assert.equal(await tool(page, 'clear').isDisabled(), true);
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

test('a Build mode app opens with the drive\'s frame out and the sidebar on Marks', async () => {
  const { page, errors } = await open({ defaults: true });
  await page.waitForFunction(() => window.marbleShell?.layout?.open === true);
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.viewName === 'marks');
  // The bar is shaded off the page's paper.
  const shade = await page.evaluate(() => getComputedStyle(document.querySelector('marble-shell').shadowRoot.querySelector('.bar')).backgroundColor);
  assert.notEqual(shade, 'rgba(0, 0, 0, 0)');
  // Docked or floating, from the bar; floating, Marks stays out while the hand moves.
  const dock = () => page.locator('marble-shell').evaluate((s) => s.shadowRoot.querySelector('[data-act="dock"]').click());
  assert.equal(await page.locator('marble-shell').evaluate((s) => s.shadowRoot.querySelector('[data-act="dock"]').hidden), false);
  await dock();
  await page.waitForFunction(() => window.marbleShell.layout.pinChat === false);
  await page.mouse.move(300, 400);
  await page.mouse.move(520, 520, { steps: 8 });
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer').isOpen), true, 'still out');
  await dock();
  await page.waitForFunction(() => window.marbleShell.layout.pinChat === true);
  // The note's footer: a model on the left, Send on the right.
  await page.evaluate(() => window.marbleBuild.setSide('none'));
  await tool(page, 'text').click();
  const r = await box(page, 's2');
  await page.mouse.click(r.x + 60, r.y + 30);
  await page.keyboard.type('Make the week two');
  const act = page.locator('.marble-marks-note[data-writing] .marble-marks-note-act');
  await act.locator('.model').waitFor();
  await act.locator('.send').waitFor();
  assert.deepEqual(errors.filter((e) => !/favicon|status of 404/.test(e)), []);
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

test('Build hands the marks to one agent: its status is three layers, nothing floats over the app, and History keeps it', async () => {
  const { page, errors } = await open();
  await noteOn(page, 's1', 'script:build Group the overdue ones on top');
  await go(page).click();
  // The build is the toolbar's now: its words and meter, with Pause and Stop.
  await page.locator('.marble-build-run:not([hidden])').waitFor();
  await page.locator('.marble-build-status[data-run="building"]').waitFor();
  // Nothing it reads floats over the app.
  assert.equal(await page.locator('.marble-build-found').count(), 0);
  // A rest on the status mark shows the build, not a chip.
  await page.locator('.marble-build-status').hover();
  await page.locator('.marble-build-peek:not([hidden])', { hasText: 'Build 1' }).waitFor();
  // The status mark opens Marks in the sidebar, headed by the build's status:
  // pressed, its stages; a stage pressed, its steps.
  await page.locator('.marble-build-status').click();
  await margin(page).locator('.marble-bst').waitFor();
  assert.match(await page.locator('.marble-margin .sum').textContent(), /1 in the build/);
  await page.locator('.marble-build-status[data-run="done"]').waitFor({ timeout: 15_000 });
  // Built is done with: it leaves the list and the app for Archived.
  await page.waitForFunction(() => !document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.marble-margin-card'));
  await page.locator('.marble-margin .tray', { hasText: '1' }).waitFor();
  assert.equal(await page.locator('[data-marble-id="h"]').textContent(), 'CHI reviews');
  const s = await state();
  assert.equal(s.builds.at(-1).status, 'finished');
  assert.equal(s.marks[0].archived, true);
  assert.ok(s.builds.at(-1).log.some((step) => step.kind === 'change' && step.ids.includes('h')), 'its steps are kept, with what each changed');
  assert.equal(await page.locator('.marble-marks-note').isVisible(), false, 'off the app, no faint note left');
  // History: the build and the app before it; a press lights what it changed
  // and goes back to a version.
  await page.evaluate(() => dispatchEvent(new CustomEvent('marble-build:toggle-history')));
  const history = page.locator('.marble-history');
  await history.locator('.ev[data-kind="build"]', { hasText: 'Build 1' }).waitFor();
  await history.locator('.ev[data-kind="build"] .eh').click();
  await page.locator('.marble-build-lit:not([hidden])').first().waitFor();
  // Its status, in three layers: pressed, its stages; a stage pressed, its
  // steps, kept with the build.
  const bst = history.locator('.marble-bst');
  await bst.locator('.bst-top').click();
  await bst.locator('.bst-stage', { hasText: 'Invitations list' }).waitFor();
  await bst.locator('.bst-stage', { hasText: 'Title' }).locator('button').click();
  await bst.locator('.bst-step', { hasText: 'Read this app' }).waitFor();
  await history.locator('.ev[data-kind="origin"] .eh').click();
  await history.locator('.ev[data-kind="origin"] .btn', { hasText: 'Go back to this' }).click();
  await page.waitForFunction(() => document.querySelector('[data-marble-id="h"]')?.textContent === 'Reviews');
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

test('Select picks marks to build, archive or delete; on a part of the app it opens the box to write in', async () => {
  const { page } = await open();
  await noteOn(page, 's1', 'One');
  await noteOn(page, 's2', 'Two');
  await page.keyboard.press('a');
  const note = page.locator('.marble-marks-note', { hasText: 'Two' });
  await note.locator('.marble-marks-note-body').click();
  await page.locator('.marble-build-sel:not([hidden])', { hasText: '1 mark' }).waitFor();
  assert.equal(await go(page).textContent(), 'Build selection');
  // Archive, from the bar: off the app, kept.
  await page.locator('.marble-build-sel button', { hasText: 'Archive' }).click();
  await hostSays(page, (marks) => marks.find((m) => m.text === 'Two')?.archived === true, 'archived from the bar');
  assert.equal(await note.isVisible(), false);
  // A pick hands the cursor back to the app; Select again to pick another.
  assert.equal(await page.evaluate(() => window.marbleMarks.mode), null);
  await tool(page, 'select').click();
  // Delete, from the bar, for the other.
  await page.locator('.marble-marks-note', { hasText: 'One' }).locator('.marble-marks-note-body').click();
  await page.locator('.marble-build-sel button', { hasText: 'Delete' }).click();
  await hostSays(page, (marks) => marks.length === 1, 'deleted from the bar');
  // A click on a part of the app picks the part, and the box to write in
  // comes up under it, with Save as piece.
  await tool(page, 'select').click();
  const r = await box(page, 's2');
  await page.mouse.click(r.x + 300, r.y + 60);
  await page.locator('.marble-marks-note[data-writing] .marble-marks-note-body:focus').waitFor();
  assert.equal(await page.locator('.marble-build-sel').isVisible(), false, 'no bar of its own');
  await page.keyboard.type('Bigger');
  await page.keyboard.press('Enter');
  await page.keyboard.type('and bolder');
  assert.equal(await page.locator('.marble-marks-note[data-writing] .marble-marks-note-body').evaluate((n) => n.innerText.trim()), 'Bigger\nand bolder', 'Enter is a new line');
  await page.locator('.marble-marks-note[data-writing] .piece').click();
  await page.waitForFunction(() => fetch('/agent/pieces?path=Reviews').then((r) => r.json()).then((p) => p.saved.length >= 1));
  // Left, it is a note on that part.
  await page.mouse.click(10, 10);
  await hostSays(page, (marks) => marks.some((m) => m.text === 'Bigger\nand bolder' && m.ids?.some((id) => id.startsWith('s2'))), 'kept as a note on the part');
});

test('a note sent with ⌘↵ becomes a comment; a change is made at once, and the comment says so', async () => {
  const { page } = await open();
  await tool(page, 'text').click();
  const r = await box(page, 's2');
  await page.mouse.click(r.x + 60, r.y + 30);
  await page.locator('.marble-marks-note-body:focus').waitFor();
  await page.locator('.marble-marks-note[data-writing] .send[aria-disabled="true"]').waitFor();
  await page.keyboard.type('script:build Can this show two weeks?');
  await page.keyboard.press('ControlOrMeta+Enter');
  // The note goes; its comment's thread opens where it was.
  await page.locator('.marble-build-line[data-who="you"]', { hasText: 'Can this show two weeks?' }).waitFor();
  // No model on a test host to tell a question from a change: it is made.
  const marks = await hostSays(page, (list) => list.some((m) => m.type === 'comment' && m.thread.some((l) => l.text === 'Making this now.')), 'answered: making it');
  const sent = marks.find((m) => m.type === 'note');
  assert.equal(sent.archived, true, 'the note is out of sight, kept as the build\'s brief');
  await page.locator('.marble-build-status[data-run="done"]').waitFor({ timeout: 15_000 });
  const done = await hostSays(page, (list) => list.find((m) => m.type === 'comment')?.resolved === true, 'the comment is settled');
  assert.match(done.find((m) => m.type === 'comment').thread.at(-1).text, /^Done in Build \d+\.$/);
});

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

test('done marks leave the app for Archived; a build clears the comments it settles; any mark can be archived and put back', async () => {
  const { page } = await open();
  await api('PUT', '/agent/builds/marks?path=Reviews', { mark: { id: 'mc1', type: 'comment', anchorId: 's2', u: 0.5, v: 0.2, at: Date.now(), thread: [{ who: 'you', text: 'Can this show two weeks?' }] } });
  await page.locator('.marble-marks-pin:not([data-archived])').waitFor();
  await noteOn(page, 's1', 'script:settle Show two weeks');
  await go(page).click();
  await page.locator('.marble-build-status[data-run="done"]').waitFor({ timeout: 15_000 });
  const marks = await hostSays(page, (list) => list.find((m) => m.id === 'mc1')?.resolved === true, 'the comment is settled');
  const comment = marks.find((m) => m.id === 'mc1');
  assert.equal(comment.archived, true);
  assert.equal(comment.thread.at(-1).text, 'It shows two weeks now.', 'answered in the app\'s name');
  assert.equal(marks.find((m) => m.type === 'note').archived, true);
  // Nothing done is left on the app: no faint note, no pin with a check.
  await page.waitForFunction(() => ![...document.querySelectorAll('.marble-marks-note, .marble-marks-pin')].some((n) => n.checkVisibility()));

  // The margin keeps them under Archived, to put back or delete.
  await openMargin(page);
  await page.locator('.marble-margin .tray', { hasText: '2' }).click();
  assert.equal(await page.locator('.marble-margin-old').count(), 2);
  await page.locator('.marble-margin-old', { hasText: 'Done in Build' }).locator('.sb', { hasText: 'Put back' }).click();
  await page.locator('.marble-margin .back').click();
  await page.locator('.marble-margin-card', { hasText: 'Show two weeks' }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.marble-marks-note')].some((n) => n.checkVisibility()));
  // Archive on a card puts it away again, and Undo brings it back.
  await page.locator('.marble-margin-card .arc').click();
  await page.waitForFunction(() => !document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.marble-margin-card'));
  await hostSays(page, (list) => list.find((m) => m.type === 'note')?.archived === true, 'archived on the host');
  await page.locator('.marble-marks-undo button').click();
  await page.locator('.marble-margin-card', { hasText: 'Show two weeks' }).waitFor();
  await hostSays(page, (list) => !list.find((m) => m.type === 'note')?.archived, 'back on the host');
  // Delete all clears the Archived list.
  await page.locator('.marble-margin .tray').click();
  await page.locator('.marble-margin .gone').click();
  await hostSays(page, (list) => list.length === 1, 'the archived comment is deleted');
});

test('a pick hands the cursor back to the app; a press away lets it go, and a drag leaves a ghost where it would go', async () => {
  const { page } = await open();
  await tool(page, 'select').click();
  const r = await box(page, 's1');
  await page.mouse.click(r.x + 300, r.y + 20);
  assert.equal(await page.evaluate(() => window.marbleMarks.mode), null, 'Use, with the part still picked');
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => window.marbleMarks.parts()), ['s1'], 'leaving the box keeps the pick');
  // Dragged: a ghost of it, tinted, follows the hand; let go, it stays as a move.
  await page.mouse.move(r.x + 200, r.y + 30);
  await page.mouse.down();
  const to = await box(page, 's2');
  await page.mouse.move(to.x + 200, to.y + 50, { steps: 10 });
  await page.locator('.marble-marks-drag').waitFor();
  await page.mouse.up();
  await page.locator('.marble-marks-move').waitFor();
  const [move] = await hostSays(page, (marks) => marks.some((m) => m.type === 'move'), 'the move is kept');
  assert.equal(move.from, 's1');
  assert.match(move.anchorId, /^s2/);
  // A press away lets go of what is picked.
  await tool(page, 'select').click();
  await page.mouse.click(r.x + 300, r.y + 20);
  await page.keyboard.press('Escape');
  await page.mouse.click(8, 700);
  assert.deepEqual(await page.evaluate(() => window.marbleMarks.parts()), []);
});

test('while a build runs, Build queues what is marked and a selection can steer the build instead', async () => {
  const { page } = await open();
  await noteOn(page, 'h', 'script:slow Half build it');
  await go(page).click();
  await page.locator('.marble-build-run:not([hidden])').waitFor();
  // The run says what it is doing in a line, over a dash for each stage.
  await page.locator('.marble-build-meter i[data-state="now"]').waitFor();
  assert.ok(await page.locator('.marble-build-run .w > span:first-child').textContent());
  // Away from the building note's corner.
  const noteAt = async (id, text) => {
    await tool(page, 'text').click();
    const at = await box(page, id);
    await page.mouse.click(at.x + 40, at.y + at.height - 20);
    await page.locator('.marble-marks-note-body:focus').waitFor();
    await page.keyboard.type(text);
    await page.locator('.marble-marks-note-body:focus').evaluate((node) => node.blur());
  };
  await noteAt('s1', 'After it');
  assert.equal(await go(page).textContent(), 'Queue');
  await go(page).click();
  await hostSays(page, (marks) => marks.find((m) => m.text === 'After it')?.now === true, 'queued');
  await noteAt('s2', 'Into it');
  await tool(page, 'select').click();
  await page.locator('.marble-marks-note', { hasText: 'Into it' }).locator('.marble-marks-note-body').click();
  await page.locator('.marble-build-sel button', { hasText: 'Steer' }).click();
  await hostSays(page, (marks) => marks.find((m) => m.text === 'Into it')?.state === 'building', 'it joins the running build');
  await page.locator('.marble-build-run button[aria-label^="Stop"]').click();
});

// Marks, Pieces and History are views of the chat's sidebar, in the
// drawer's shadow root: locators reach in; page.evaluate reads it through
// `side()`.
const margin = (page) => page.locator('.marble-margin');
const openMargin = async (page) => {
  await page.evaluate(() => dispatchEvent(new CustomEvent('marble-build:toggle-comments')));
  await margin(page).waitFor();
};
const dock = (page) => page.evaluate(() => getComputedStyle(document.documentElement).marginRight);
const SIDE = `const side = () => document.querySelector('marble-agent-drawer').shadowRoot;`;
void SIDE;

test('Marks: a view of the chat\'s sidebar, a card beside each mark, level with its pin', async () => {
  const { page, errors } = await open();
  await noteOn(page, 's1', 'Group the overdue ones on top');
  await noteOn(page, 's2', 'Show two weeks');
  await openMargin(page);
  // In the chat's sidebar, in place of the chat, at its width.
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer').viewName), 'marks');
  assert.ok((await margin(page).boundingBox()).width >= 380, 'wider than the old margin');
  const cards = page.locator('.marble-margin-card:not([hidden])');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelectorAll('.marble-margin-card:not([hidden])').length === 2);
  assert.match(await cards.first().textContent(), /Note · on Invitations/);
  // With the margin open the notes fold into their points; numbered pins stay.
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.marble-marks-note').first().evaluate((n) => getComputedStyle(n).visibility), 'hidden');
  assert.equal(await page.locator('.marble-margin-pin:not([hidden])').count(), 2);
  const level = await page.evaluate(() => [...document.querySelector('marble-agent-drawer').shadowRoot.querySelectorAll('.marble-margin-card')].map((card) => {
    const pin = document.querySelector(`.marble-margin-pin[data-id="${card.dataset.id}"]`);
    return Math.round(card.getBoundingClientRect().top - (pin.getBoundingClientRect().top - 10));
  }));
  // Level, or pushed down only as far as the card above it needs.
  for (const off of level) assert.ok(off >= -2 && off <= 8, `level with its pin: ${level}`);

  // A press picks it: it steps 12px toward the app, shaded in the accent as
  // its pin is. Esc lets go.
  const second = cards.nth(1);
  const before = (await second.boundingBox()).x;
  await second.click();
  assert.equal(await second.getAttribute('aria-expanded'), 'true');
  await page.waitForTimeout(450);
  assert.equal(Math.round(before - (await second.boundingBox()).x), 12);
  assert.equal(await page.locator('.marble-margin-pin[data-picked]').count(), 1);
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
  assert.match(await page.locator('.marble-margin .sum').textContent(), /2 open/);

  // A note's words can be changed on its card, and are kept.
  const words = cards.first().locator('.words[contenteditable]');
  await words.click();
  await page.keyboard.press('End');
  await page.keyboard.type(', then the rest');
  await page.keyboard.press('Escape');
  await hostSays(page, (marks) => marks.some((m) => m.text === 'Group the overdue ones on top, then the rest'), 'edited on its card');

  // The view survives a reload.
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marbleBuild?.state()));
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.viewName === 'marks');

  // Pieces and the chat take the same sidebar, one at a time; Describe off
  // puts Marks away for the chat.
  await page.evaluate(() => dispatchEvent(new CustomEvent('marble-build:toggle-pieces')));
  await page.locator('.marble-build-pieces').waitFor();
  await margin(page).waitFor({ state: 'hidden' });
  await openMargin(page);
  await page.evaluate(() => window.marbleMarks.setDescribing(false));
  await margin(page).waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer').viewName), 'chat');
  assert.equal(await page.evaluate(() => window.marbleBuild.side), 'none');
  assert.deepEqual(errors.filter((e) => !/favicon|status of 404/.test(e)), []);
});

test('a picked card stands level with its mark after the page comes to it, with marks crowding the top', async () => {
  const { page } = await open({ doc: 'Long', width: 1440, height: 900 });
  // Four marks near the top, two at one height, as on a long spec page;
  // and two far down, the way the whole page is anchored by a note on <main>.
  const marks = [['a', 0.6, 0.022], ['b', 0.3, 0.03], ['c', 0.4, 0.032], ['d', 0.55, 0.032], ['e', 0.5, 0.55], ['f', 0.45, 0.8]];
  for (const [id, u, v] of marks) {
    await api('PUT', '/agent/builds/marks?path=Long', { mark: { id: `m${id}`, type: 'note', anchorId: 'm', u, v, at: id.charCodeAt(0), text: `Mark ${id}` } });
  }
  await page.waitForFunction(() => window.marbleMarks.list().length === 6);
  await openMargin(page);
  await page.waitForTimeout(800);
  for (const id of ['me', 'mf', 'ma', 'me']) {
    await page.locator(`.marble-margin-card[data-id="${id}"]`).evaluate((card) => card.click());
    await page.waitForTimeout(1300);
    const off = await page.evaluate((mark) => {
      const card = document.querySelector('marble-agent-drawer').shadowRoot.querySelector(`.marble-margin-card[data-id="${mark}"]`).getBoundingClientRect();
      const pin = document.querySelector(`.marble-margin-pin[data-id="${mark}"]`).getBoundingClientRect();
      return { off: Math.round(card.top - (pin.top - 10)), pin: Math.round(pin.top), inView: pin.top > 44 && pin.bottom < innerHeight - 80 };
    }, id);
    assert.ok(Math.abs(off.off) <= 6 && off.inView, `${id}: ${JSON.stringify(off)}`);
  }
  await api('DELETE', '/agent/builds/marks?path=Long', { ids: marks.map(([id]) => `m${id}`) });
});

test('in the margin a comment is a card: the app answers in its own name, and a reply goes on in the card', async () => {
  const { page } = await open();
  await api('PUT', '/agent/builds/marks?path=Reviews', { mark: { id: 'mq', type: 'comment', anchorId: 's2', u: 0.3, v: 0.3, at: Date.now(), thread: [{ who: 'you', text: 'Can this show two weeks?' }] } });
  await openMargin(page);
  const card = page.locator('.marble-margin-card', { hasText: 'Can this show two weeks?' });
  await card.click();
  // The same box as a note's: words, pasted pictures, and Send (⌘↵).
  await card.locator('.reply .field').click();
  await page.keyboard.type('And next month?');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Or the one after.');
  await page.keyboard.press('ControlOrMeta+Enter');
  // No model on a test host: the thread says so rather than hanging.
  await card.locator('.marble-build-line[data-who="agent"] p').waitFor();
  // Q and A, not a chat: the question slanted and faded, no faces, no names.
  assert.equal(await card.locator('.marble-build-line[data-who="you"] p').first().evaluate((n) => getComputedStyle(n).fontStyle), 'italic');
  assert.equal(await card.locator('.av, .who').count(), 0);
  assert.doesNotMatch(await margin(page).textContent(), /\bAgent\b/);
  await hostSays(page, (marks) => marks.find((m) => m.type === 'comment')?.thread.some((l) => l.text === 'And next month?\nOr the one after.'), 'the reply is kept, its lines with it');
  // Resolved, it is put away under Archived; Put back there opens it again.
  await card.locator('.sb', { hasText: 'Resolve' }).click();
  await page.waitForFunction(() => !document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.marble-margin-card'));
  await page.locator('.marble-marks-undo:not([hidden])', { hasText: 'Comment resolved' }).waitFor();
  await page.locator('.marble-margin .tray').click();
  await page.locator('.marble-margin-old', { hasText: 'Resolved' }).locator('.sb', { hasText: 'Put back' }).click();
  await hostSays(page, (marks) => marks.find((m) => m.type === 'comment')?.resolved === false, 'opened again');
});

test('on a phone Marks is in the sidebar\'s sheet from the foot, in page order, and docks nothing', async () => {
  const { page } = await open({ width: 390, height: 800 });
  await noteOn(page, 's1', 'On a phone');
  await openMargin(page);
  assert.equal(await margin(page).getAttribute('data-sheet'), '');
  assert.equal(await dock(page), '0px');
  await page.waitForTimeout(500);
  const sheet = await margin(page).boundingBox();
  assert.ok(sheet.x >= 0 && sheet.x + sheet.width <= 391, JSON.stringify(sheet));
  await page.locator('.marble-margin-card').first().click();
  assert.equal(await page.locator('.marble-margin-card').first().getAttribute('aria-expanded'), 'true');
});

test('Pieces: parts of other apps, incorporated onto this one as a card that waits for a build', async () => {
  const { page } = await open();
  await page.evaluate(() => dispatchEvent(new CustomEvent('marble-build:toggle-pieces')));
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
  // The sidebar opens on Marks, so the prompt is read there as its card.
  await page.locator('.marble-marks-note[data-first]', { hasText: 'Track my CHI review invitations' }).waitFor({ state: 'attached' });
  assert.ok(!page.url().includes('#build='), 'the prompt is read once and taken off the address');
  await page.waitForURL(/\/a\/CHI%20reviews/, { timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.marbleBuild?.state()));
  const s = await state('CHI reviews');
  assert.equal(s.builds[0].status, 'finished');
  assert.equal(s.folder, 'UCSD');
  const chip = await page.evaluate(() => document.querySelector('marble-shell').shadowRoot.querySelector('.offer:not([hidden])')?.textContent ?? '');
  assert.match(chip, /Move to UCSD/);
  // The frame is out on a Build mode app, and its tree asks for the drive's
  // own page, which a test drive does not have: that one 404 is the frame's.
  assert.deepEqual(errors.filter((e) => !/favicon|status of 404/.test(e)), []);
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
    await page.evaluate(() => dispatchEvent(new CustomEvent('marble-build:toggle-pieces')));
    await page.waitForTimeout(600);
    const sheet = await page.locator('.marble-build-pieces').boundingBox();
    assert.ok(sheet.x >= 0 && sheet.x + sheet.width <= width + 1, `Pieces fits at ${width}`);
  }
});
