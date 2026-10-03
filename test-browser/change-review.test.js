// The change on request (v5, Notes and Sketches/Ask at Anything, "After a
// change: the result, and the change on request"): a finished change leaves
// nothing on the page. Rest on it, or move focus into it, and it draws itself
// over what it made — added parts tinted, old words struck through under the
// new, a removed part as a ghost where it was, a moved one with a gap where it
// came from, an old shape in dashes — with one tag that counts and one bar:
// Change more, Keep, Undo. Keep takes the drawing away for good; Undo takes
// the change back (Redo while you are there); the chat button's menu draws
// every change at once.

import assert from 'node:assert/strict';
import test from 'node:test';

import { composeScript } from '../server/gallery.js';
import { startDrive } from './harness.js';

// The page's own affordances: its titles and its note are editable, and ⌘Z
// is the document's history, as a starter would have it.
const AFFORDANCES = await composeScript(['editable']);

const LIST = `<!doctype html>
<html><head><meta charset="utf-8"><title>Reading list</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 16px/1.5 Georgia, serif; margin: 40px; max-width: 560px; }
  h1 { font-size: 28px; margin: 0 0 12px; }
  ul { list-style: none; margin: 0 0 24px; padding: 0; }
  li { display: flex; gap: 12px; align-items: baseline; padding: 6px 0; }
  li > span:first-child { flex: 1; }
  .date { font-size: 13px; color: #555; }
</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Reading list</h1>
  <ul data-marble-id="list">
    <li data-marble-id="r1"><span data-marble-id="r1n" data-marble-editable>Malleable software</span><span data-marble-id="r1s">Unread</span></li>
    <li data-marble-id="r2"><span data-marble-id="r2n" data-marble-editable>Local-first</span><span data-marble-id="r2s">Unread</span></li>
    <li data-marble-id="r3"><span data-marble-id="r3n" data-marble-editable>Dynamicland</span><span data-marble-id="r3s">Read</span></li>
  </ul>
  <p data-marble-id="p" data-marble-editable>Notes for the week.</p>
  <script data-marble-id="aff">${AFFORDANCES}</script>
</body></html>
`;

// One of each kind of change, for what each is drawn as.
const KINDS = `<!doctype html>
<html><head><meta charset="utf-8"><title>Board</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 40px; max-width: 560px; }
  ul { margin: 0 0 20px; padding-left: 20px; }
  li { padding: 4px 0; }
  .card { padding: 12px; border: 1px solid #bbb; }
  .card.round { border-radius: 14px; }
</style></head>
<body data-marble-id="kb">
  <h1 data-marble-id="kh">Board</h1>
  <ul data-marble-id="a"><li data-marble-id="a1">First</li><li data-marble-id="a2">Second</li><li data-marble-id="a3">Third</li></ul>
  <ul data-marble-id="m"><li data-marble-id="m1">One</li><li data-marble-id="m2">Two</li><li data-marble-id="m3">Three</li></ul>
  <div data-marble-id="c" class="card">A card</div>
</body></html>
`;

// A board: cards in two columns.
const BOARD = `<!doctype html>
<html><head><meta charset="utf-8"><title>Board</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 40px; max-width: 640px; }
  .cols { display: flex; gap: 16px; }
  .col { flex: 1; display: flex; flex-direction: column; gap: 10px; }
  .card { border: 1px solid #bbb; border-radius: 10px; padding: 10px; }
  h3 { margin: 0; font-size: 15px; }
  .due { margin: 4px 0 0; font-size: 13px; color: #555; }
</style></head>
<body data-marble-id="bb">
  <main data-marble-id="board" class="board"><div data-marble-id="cols" class="cols">
    <section data-marble-id="ca" class="col">
      <article data-marble-id="c1" class="card"><h3 data-marble-id="c1t">Malleable software</h3></article>
      <article data-marble-id="c2" class="card"><h3 data-marble-id="c2t">Local-first</h3></article>
    </section>
    <section data-marble-id="cb" class="col">
      <article data-marble-id="c3" class="card"><h3 data-marble-id="c3t">Dynamicland</h3></article>
      <article data-marble-id="c4" class="card"><h3 data-marble-id="c4t">Potluck</h3></article>
    </section>
  </div></main>
</body></html>
`;

// A shelf whose rows and card take their look from the section they are in:
// .shelf .list > li and .shelf .card.round.
const SHELF = `<!doctype html>
<html><head><meta charset="utf-8"><title>Shelf</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 40px; max-width: 560px; }
  .shelf .list { list-style: none; margin: 0 0 20px; padding: 0; }
  .shelf .list > li { padding: 11px 0; color: rgb(40, 60, 90); letter-spacing: .5px; }
  .shelf .card { padding: 12px; border: 1px solid #bbb; }
  .shelf .card.round { border-radius: 14px; }
</style></head>
<body data-marble-id="sb">
  <section class="shelf" data-marble-id="shelf">
    <ul class="list" data-marble-id="sl"><li data-marble-id="s1">First</li><li data-marble-id="s2">Second</li><li data-marble-id="s3">Third</li></ul>
    <div class="card round" data-marble-id="sc">A card</div>
  </section>
</body></html>
`;

// A component of the page's own, which counts every instance of itself.
const CUSTOM = `<!doctype html>
<html><head><meta charset="utf-8"><title>Custom</title>
<style>body { font: 16px/1.5 system-ui, sans-serif; margin: 40px; } review-card { display: block; padding: 12px; border: 1px solid #bbb; } .wide { padding: 20px; }</style>
</head>
<body data-marble-id="xb">
  <review-card data-marble-id="rc" class="card"><b data-marble-id="rct">A card</b></review-card>
  <script data-marble-id="xs">customElements.define('review-card', class extends HTMLElement { constructor() { super(); window.__made = (window.__made || 0) + 1; } });</script>
</body></html>
`;

const read = (path = 'list') => ({ call: 'read_document', args: { path } });
const batch = (args, path = 'list') => ({ call: 'apply_ops', args: { path, ...args } });
const date = (row, text) => ({ type: 'insert', parentId: row, beforeId: null, html: `<span class="date" data-marble-kind="date">${text}</span>` });

const SCRIPTS = {
  dates: [read(), batch({ note: 'Add a date to each row.', ops: [date('r1', 'Oct 9'), date('r2', 'Oct 14'), date('r3', 'Oct 21')] }), { say: 'Done.' }],
  firstTwo: [read(), batch({ note: 'Date the first two.', ops: [date('r1', 'Oct 9'), date('r2', 'Oct 14')] }), { say: 'Done.' }],
  // A second ask on the same list: a row in it.
  addRow: [read(), batch({ note: 'Add Potluck.', ops: [{ type: 'insert', parentId: 'list', beforeId: null, html: '<li><span>Potluck</span><span>Unread</span></li>' }] }), { say: 'Done.' }],
  rename: [read(), batch({ note: 'Rename the list.', ops: [{ type: 'setText', id: 'h', text: 'Papers to read' }] }), { say: 'Done.' }],
  spread: [read('board'), batch({ note: 'Due dates on two cards.', ops: [
    { type: 'insert', parentId: 'c1', beforeId: null, html: '<p class="due">Due Oct 9</p>' },
    { type: 'insert', parentId: 'c3', beforeId: null, html: '<p class="due">Due Oct 21</p>' },
  ] }, 'board'), { say: 'Done.' }],
  cardTitle: [read('board'), batch({ note: 'Retitle one card.', ops: [{ type: 'setText', id: 'c2t', text: 'Local-first, revisited' }] }, 'board'), { say: 'Done.' }],
  shelfRemove: [read('shelf'), batch({ note: 'Take out the second.', ops: [{ type: 'remove', id: 's2' }] }, 'shelf'), { say: 'Done.' }],
  shelfLook: [read('shelf'), batch({ note: 'Square the card.', ops: [{ type: 'setAttr', id: 'sc', name: 'class', value: 'card' }] }, 'shelf'), { say: 'Done.' }],
  custom: [read('custom'), batch({ note: 'Widen the card.', ops: [{ type: 'setAttr', id: 'rc', name: 'class', value: 'card wide' }] }, 'custom'), { say: 'Done.' }],
  retitle: [read(), batch({ note: 'Shorter titles.', ops: [
    { type: 'setText', id: 'r1n', text: 'Malleable' },
    { type: 'setText', id: 'r2n', text: 'Local' },
    { type: 'setText', id: 'r3n', text: 'Dynamic' },
  ] }), { say: 'Done.' }],
  one: [read(), batch({ note: 'Rename the first.', ops: [{ type: 'setText', id: 'r1n', text: 'Malleable software, again' }] }), { say: 'Done.' }],
  kinds: [read('kinds'), batch({ note: 'Tidy the board.', ops: [
    { type: 'setText', id: 'kh', text: 'Board, renamed' },
    { type: 'remove', id: 'a2' },
    { type: 'move', id: 'm3', parentId: 'm', beforeId: 'm1' },
    { type: 'setAttr', id: 'c', name: 'class', value: 'card round' },
  ] }, 'kinds'), { say: 'Done.' }],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { list: LIST, kinds: KINDS, board: BOARD, shelf: SHELF, custom: CUSTOM } });
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Each of the page's asks of the host for what is left to review, held back
// a while, as a slow host would.
const slowReview = (page, ms) => page.route('**/agent/review?*', async (route) => { await sleep(ms); await route.continue().catch(() => {}); });
test.after(() => host.close());

const pages = [];
const closePages = async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); };
test.after(closePages);

const api = async (method, url, body) => {
  const response = await fetch(`${host.base}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
};

// Every test starts from the documents as written and no chat about them.
const settle = async () => {
  for (const summary of await api('GET', '/agent/conversations')) {
    const detail = await api('GET', `/agent/conversations/${summary.id}`);
    for (const turn of detail.turns ?? []) {
      if (turn.status === 'running') await api('POST', `/agent/turns/${turn.id}/cancel`);
    }
    await api('PATCH', `/agent/conversations/${summary.id}`, { archived: true });
  }
  await host.reset();
};

const newChat = async () => (await api('POST', '/agent/conversations', { provider: 'fake' })).id;
const finished = async (id, n) => {
  const end = Date.now() + 20_000;
  for (;;) {
    const turns = (await api('GET', `/agent/conversations/${id}`)).turns ?? [];
    const turn = turns[n - 1];
    if (turn && ['completed', 'failed', 'cancelled'].includes(turn.status)) return turn;
    if (Date.now() > end) throw new Error('the turn did not finish');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
// A turn sent as the line or another tab would, and waited for.
const ask = async (id, script, target = 'list') => {
  const before = ((await api('GET', `/agent/conversations/${id}`)).turns ?? []).length;
  await api('POST', `/agent/conversations/${id}/turns`, { prompt: `script:${script}`, context: { target, viewing: target, selection: [], also: [] } });
  return finished(id, before + 1);
};
const review = (doc = 'list') => api('GET', `/agent/review?path=${doc}`);
const file = async (doc = 'list') => (await fetch(`${host.base}/a/${doc}`)).text();

const open = async ({ doc = 'list', attending = [], ...options } = {}) => {
  const { page, errors } = await host.newPage({ attending, ...options });
  pages.push(page);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleReview && document.querySelector('.marble-review-host')));
  page.errors = errors;
  return page;
};

const groups = (page, n, timeout = 10_000) => page.waitForFunction((count) => window.marbleReview.groups().length === count, n, { timeout });
const box = (page, id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();
// A rest: the pointer comes to a stop over a part and stays.
const restOn = async (page, id, { dx = 12, wait = 600 } = {}) => {
  const r = await box(page, id);
  await page.mouse.move(r.x + dx, r.y + r.height / 2);
  await page.waitForTimeout(wait);
};
const away = (page) => page.mouse.move(1000, 120);
// The 300ms a drawing waits once the pointer has left it, and a frame.
const LEAVE_AND_A_FRAME = 360;
const drawing = (page) => page.locator('.marble-review-group:not([data-state="out"]):not([data-state="lift"])');
const bar = (page) => page.locator('.marble-review-bar');
const act = (page, name) => page.locator(`.marble-review-bar button[data-act="${name}"]`);
const tagText = (page) => page.locator('.marble-review-tag').innerText();
const nothingDrawn = (page, timeout = 1500) => page.waitForFunction(() => !document.querySelector('.marble-review-host .marble-review-group'), null, { timeout });
// Anything of the drawing on screen: a change drawn, or a tip.
const shownAtAll = (page) => page.locator('.marble-review-group, .marble-review-tip:not([hidden])').count();
// Which stop of the drawing has the keys: the tag, a bar button, or a part.
const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (a?.closest('.marble-review-tag')) return 'tag';
  return a?.dataset.act ?? a?.getAttribute('data-marble-id') ?? a?.localName ?? null;
});
const dates = (page) => page.evaluate(() => document.querySelectorAll('[data-marble-id="list"] .date').length);

test.beforeEach(async () => {
  await closePages();
  await settle();
});

// ------------------------------------------------------------ at rest, and on a rest

test('after a change nothing is drawn; a rest draws what was added, one tag and one bar, and leaving puts it away', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'dates');
  await groups(page, 1);
  await page.waitForFunction(() => document.querySelectorAll('[data-marble-id="list"] .date').length === 3);
  await page.mouse.move(1000, 120);
  await page.waitForTimeout(900);
  assert.equal(await shownAtAll(page), 0, 'at rest, the result and nothing else');

  await restOn(page, 'r1', { wait: 650 });
  await bar(page).waitFor({ timeout: 1000 });
  assert.match(await tagText(page), /^3 dates added$/);
  assert.equal(await page.locator('.marble-review-add').count(), 3, 'each date is tinted');
  assert.deepEqual(await page.locator('.marble-review-bar button').allInnerTexts(), ['Change more', 'Keep', 'Undo']);
  assert.doesNotMatch(await page.locator('.marble-review-host').innerText(), /agent/i);
  // Flush under the list: as wide as it is, 10px below.
  const list = await box(page, 'list');
  const b = await bar(page).boundingBox();
  assert.ok(Math.abs(b.x - list.x) < 1.5, `flush with the list: ${b.x} vs ${list.x}`);
  assert.ok(Math.abs(b.width - Math.max(300, list.width)) < 1.5, `as wide: ${b.width} vs ${list.width}`);
  assert.ok(Math.abs(b.y - (list.y + list.height + 10)) < 1.5, `10px below: ${b.y} vs ${list.y + list.height}`);
  // Nothing in the drawing is a part of the document.
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.marble-review-host, .marble-review-host *')].every((el) => !el.hasAttribute('data-marble-id'))), true);
  assert.equal(await page.evaluate(() => document.querySelector('.marble-review-host').hasAttribute('data-marble-transient')), true);

  // Timed in the page, from the pointer leaving to the drawing being gone.
  await page.evaluate(() => {
    window.__left = 0;
    window.__gone = 0;
    addEventListener('pointermove', () => { window.__left ||= performance.now(); }, { capture: true, once: true });
    new MutationObserver(() => {
      if (window.__left && !window.__gone && !document.querySelector('.marble-review-group')) window.__gone = performance.now();
    }).observe(document.querySelector('.marble-review-host'), { childList: true, subtree: true });
  });
  await away(page);
  await nothingDrawn(page, 1500);
  const took = await page.evaluate(() => window.__gone - window.__left);
  assert.ok(took > 250 && took < 500, `gone within 500ms of the pointer leaving, not at once: ${Math.round(took)}ms`);
  // The change is still waiting: leaving loses nothing.
  assert.equal((await review()).turns.length, 1);
});

test('Keep lifts the drawing for good and clears the chat button\'s dot', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'dates');
  await groups(page, 1);
  await restOn(page, 'r2');
  await act(page, 'keep').click();
  await page.locator('.marble-review-group[data-state="lift"]').waitFor({ state: 'attached', timeout: 1000 });
  await nothingDrawn(page, 2500);
  assert.deepEqual((await review()).turns, []);
  await groups(page, 0);

  await away(page);
  await restOn(page, 'r1', { wait: 900 });
  assert.equal(await shownAtAll(page), 0, 'kept: resting on it again shows nothing');
  const summary = (await api('GET', '/agent/conversations')).find((s) => s.id === id);
  assert.equal(summary.needsReview, false);
  // The dates are the list now.
  assert.equal(await dates(page), 3);
});

test('Undo takes the dates back and offers Redo while you are there; Redo puts them back', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'dates');
  await groups(page, 1);
  // One answer about what is left to review can be held back: asked of the
  // host before the redo, handed to the page after it.
  const gate = { armed: false };
  gate.asked = new Promise((resolve) => { gate.got = resolve; });
  gate.open = new Promise((resolve) => { gate.release = resolve; });
  await page.route(/\/agent\/review\?/, async (route) => {
    if (!gate.armed) return route.continue();
    gate.armed = false;
    const response = await route.fetch();
    gate.got();
    await gate.open;
    await route.fulfill({ response });
  });
  await restOn(page, 'r1');
  await act(page, 'undo').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-marble-id="list"] .date').length === 0, null, { timeout: 5000 });
  assert.doesNotMatch(await file(), /Oct 9|Oct 14|Oct 21/, 'the file no longer has them');
  await act(page, 'redo').waitFor();
  assert.match(await bar(page).innerText(), /Undone/);
  assert.equal(await act(page, 'keep').count(), 0);

  // Something asks the host what is left (here, an undo's end heard again)
  // just before the redo; its answer, from before the redo, comes after it.
  await page.waitForTimeout(400);
  gate.armed = true;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('marble-change:end', { detail: { client: 'agent-undo:elsewhere' } })));
  await gate.asked;
  // Pressed with the pointer still, so nothing but Redo can draw it again.
  const redone = page.waitForResponse((r) => /\/redo$/.test(r.url()));
  await act(page, 'redo').dispatchEvent('click');
  await redone;
  await page.waitForTimeout(200);
  gate.release();
  await page.waitForFunction(() => document.querySelectorAll('[data-marble-id="list"] .date').length === 3, null, { timeout: 5000 });
  assert.match(await file(), /Oct 9/);
  // Back in the list of changes, and drawn again where it is, by the same bar:
  // the redo waits for an answer asked after it, not the one on its way.
  await groups(page, 1);
  await act(page, 'keep').waitFor({ timeout: 3000 });
  await page.waitForTimeout(300);
  assert.equal(await drawing(page).count(), 1, 'the same drawing stays up, not one put away');
  assert.equal(await page.locator('.marble-review-group[data-state]').count(), 0);
  assert.equal(await page.locator('.marble-review-add').count(), 3);

  await away(page);
  await nothingDrawn(page, 1200);
});

test('two asks on one list are one change; holding Undo takes back both', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'firstTwo');
  await ask(id, 'addRow');
  await groups(page, 1);
  await page.waitForFunction(() => window.marbleReview.groups()[0]?.turns.length === 2);
  await restOn(page, 'r2');
  await bar(page).waitFor();
  assert.match(await tagText(page), /^3 parts added · 2 asks$/);

  const undo = await act(page, 'undo').boundingBox();
  await page.mouse.move(undo.x + undo.width / 2, undo.y + undo.height / 2);
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.marble-review-tip').innerText(), 'Hold to undo all 2', 'the hold is named on a rest');
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('[data-marble-id="list"] .date').length === 0
    && document.querySelectorAll('[data-marble-id="list"] > li').length === 3, null, { timeout: 8000 });
  const turns = (await api('GET', `/agent/conversations/${id}`)).turns;
  assert.ok(turns.every((t) => t.undoneAt), 'both asks are undone');
  await act(page, 'redo').waitFor();
  assert.match(await bar(page).innerText(), /^Undone/);
});

test('holding the tag shows the list as it was, over it; letting go brings the change back, and nothing is undone', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'dates');
  await groups(page, 1);
  await restOn(page, 'r1');
  const tag = await page.locator('.marble-review-tag button').boundingBox();
  await page.mouse.move(tag.x + tag.width / 2, tag.y + tag.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  const held = await page.evaluate(() => {
    const before = document.querySelector('.marble-review-before');
    const list = document.querySelector('[data-marble-id="list"]');
    const a = before?.getBoundingClientRect();
    const b = list.getBoundingClientRect();
    return {
      hidden: getComputedStyle(list).visibility,
      shown: Boolean(before) && getComputedStyle(before).visibility !== 'hidden',
      dates: before?.querySelectorAll('.date').length ?? -1,
      words: before?.innerText.replace(/\s+/g, ' ').trim(),
      ids: before ? before.querySelectorAll('[data-marble-id], [id]').length : -1,
      over: a ? Math.abs(a.left - b.left) < 1.5 && Math.abs(a.top - b.top) < 1.5 && Math.abs(a.width - b.width) < 1.5 : false,
      tag: document.querySelector('.marble-review-tag').innerText,
    };
  });
  assert.equal(held.hidden, 'hidden', 'the list itself is out of sight while held');
  assert.equal(held.shown, true);
  assert.equal(held.dates, 0, 'the copy is without the dates');
  assert.match(held.words, /Malleable software Unread Local-first Unread Dynamicland Read/);
  assert.equal(held.ids, 0, 'the copy carries no ids');
  assert.equal(held.over, true, 'laid exactly over the list');
  assert.equal(held.tag, 'Before');
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.marble-review-before')
    && getComputedStyle(document.querySelector('[data-marble-id="list"]')).visibility === 'visible');
  assert.equal(await dates(page), 3);
  assert.match(await file(), /Oct 21/, 'the file is unchanged');
  assert.equal((await review()).turns.length, 1);
});

test('each kind is drawn as itself: old words struck through, a ghost where a row was, a gap where one came from, the old shape in dashes', async () => {
  const id = await newChat();
  const page = await open({ doc: 'kinds', attending: [id] });
  await ask(id, 'kinds', 'kinds');
  await page.waitForFunction(() => window.marbleReview.groups().length === 1, null, { timeout: 10_000 });
  await page.waitForTimeout(400);
  const next = await box(page, 'a3');

  await restOn(page, 'kh');
  await bar(page).waitFor();
  const seen = await page.evaluate(() => {
    const was = document.querySelector('.marble-review-was');
    const ghost = document.querySelector('.marble-review-ghost');
    const gap = document.querySelector('.marble-review-gap');
    const outline = document.querySelector('.marble-review-outline');
    const card = document.querySelector('[data-marble-id="c"]');
    const deco = (el) => getComputedStyle(el).textDecorationLine;
    return {
      was: was?.textContent.trim(),
      struck: was ? deco(was) : null,
      ghost: ghost?.textContent.trim(),
      ghostStruck: ghost ? [...ghost.querySelectorAll('*')].some((el) => deco(el).includes('line-through')) : false,
      ghostTop: ghost?.getBoundingClientRect().top,
      ghostIds: ghost ? ghost.querySelectorAll('[data-marble-id], [id], script').length : -1,
      ghostInert: ghost ? getComputedStyle(ghost).pointerEvents : null,
      gap: Boolean(gap),
      gapStyle: gap ? getComputedStyle(gap).borderTopStyle : null,
      outline: Boolean(outline),
      outlineStyle: outline ? getComputedStyle(outline).borderTopStyle : null,
      outlineRadius: outline ? parseFloat(getComputedStyle(outline).borderTopLeftRadius) : null,
      cardRadius: parseFloat(getComputedStyle(card).borderTopLeftRadius),
      tag: document.querySelector('.marble-review-tag').innerText,
    };
  });
  assert.equal(seen.was, 'Board');
  assert.match(seen.struck, /line-through/);
  assert.equal(seen.ghost, 'Second');
  assert.equal(seen.ghostStruck, true, 'its words struck through');
  assert.ok(Math.abs(seen.ghostTop - next.y) < 2, `at its old place, over the row after it: ${seen.ghostTop} vs ${next.y}`);
  assert.equal(seen.ghostIds, 0, 'a ghost carries no ids and no scripts');
  assert.equal(seen.ghostInert, 'none');
  const after = await box(page, 'a3');
  assert.deepEqual(after, next, 'the ghost takes no room');
  assert.equal(seen.gap, true);
  assert.equal(seen.gapStyle, 'dashed');
  assert.equal(seen.outline, true);
  assert.equal(seen.outlineStyle, 'dashed');
  assert.equal(seen.cardRadius, 14);
  assert.equal(seen.outlineRadius, 0, 'the square corners the card had');
  assert.match(seen.tag, /1 changed/);
  assert.match(seen.tag, /1 removed/);
  assert.match(seen.tag, /1 moved/);
  assert.match(seen.tag, /1 restyled/);
});

test('a reload loses nothing: the next rest still draws the change', async () => {
  const id = await newChat();
  let page = await open({ attending: [id] });
  await ask(id, 'dates');
  await groups(page, 1);
  await page.close();
  page = await open();
  await groups(page, 1);
  await restOn(page, 'r3');
  await bar(page).waitFor({ timeout: 1000 });
  assert.equal(await page.locator('.marble-review-add').count(), 3);
});

test('a part you type in is yours: its drawing goes, and the rest of the change still shows', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'retitle');
  await groups(page, 1);
  await page.waitForFunction(() => document.querySelector('[data-marble-id="r2n"]').textContent === 'Local');
  await restOn(page, 'r1');
  await bar(page).waitFor();
  assert.equal(await page.locator('.marble-review-was').count(), 3);

  await page.locator('[data-marble-id="r2n"]').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' apps');
  await page.waitForFunction(() => !document.querySelector('.marble-review-tint[data-id="r2n"], .marble-review-was[data-id="r2n"]'));
  assert.equal(await page.locator('.marble-review-tint[data-id="r1n"]').count(), 1);
  assert.equal(await page.locator('.marble-review-tint[data-id="r3n"]').count(), 1);
  assert.match(await tagText(page), /^2 /);
  // The host drops it too, once the edit is filed: its hash is the person's.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const parts = (await review()).turns[0].parts.map((p) => p.id).sort();
  assert.deepEqual(parts, ['r1n', 'r3n']);
});

test('⌘Z on the page takes back the change; ⌘Z right after your own edit takes back your edit', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'dates');
  await groups(page, 1);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(() => document.querySelectorAll('[data-marble-id="list"] .date').length === 0, null, { timeout: 5000 });
  await groups(page, 0);
  // And ⇧⌘Z puts it back, nothing of yours having come since.
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForFunction(() => document.querySelectorAll('[data-marble-id="list"] .date').length === 3, null, { timeout: 5000 });
  await groups(page, 1);

  // Your own edit, after the change: ⌘Z is the document's.
  await page.locator('[data-marble-id="p"]').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' More.');
  await page.waitForFunction(() => document.querySelector('[data-marble-id="p"]').textContent === 'Notes for the week. More.');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(() => document.querySelector('[data-marble-id="p"]').textContent === 'Notes for the week.');
  await page.waitForTimeout(500);
  assert.equal(await dates(page), 3, 'the change is untouched');
  assert.equal((await review()).turns.length, 1);
  assert.equal((await api('GET', `/agent/conversations/${id}`)).turns.at(-1).undoneAt ?? null, null);
});

test('Show what changed is in the chat button\'s menu only while something is unreviewed; it draws every change, and Esc puts them away', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  const launcher = page.locator('marble-agent-drawer .launcher');
  const row = page.locator('marble-agent-drawer .tool[data-tool="changes"]');
  await launcher.waitFor();
  await launcher.hover();
  await page.waitForTimeout(300);
  assert.equal(await row.count(), 0, 'nothing waiting, no row');
  await page.mouse.move(1000, 120);

  await ask(id, 'dates');
  await groups(page, 1);
  await launcher.hover();
  await row.waitFor({ state: 'visible' });
  assert.equal(await row.getAttribute('aria-label'), 'Show what changed');
  await row.click();
  await bar(page).waitFor();
  assert.equal(await page.locator('.marble-review-add').count(), 3);
  // A drawing asked for from the menu does not go when the pointer moves.
  await away(page);
  await page.waitForTimeout(600);
  assert.equal(await bar(page).count(), 1);
  await page.keyboard.press('Escape');
  await nothingDrawn(page);

  await page.evaluate(() => window.marbleReview.showAll());
  await act(page, 'keep').click();
  await groups(page, 0);
  await launcher.hover();
  await page.waitForTimeout(300);
  assert.equal(await row.count(), 0, 'kept: the row goes');
});

test('from the keyboard: Tab into a changed part draws it, Tab walks the tag, Change more and Keep, and Enter keeps', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'one');
  await groups(page, 1);
  await page.mouse.move(1000, 120);
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.getAttribute('data-marble-id') === 'r1n')) break;
  }
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-marble-id')), 'r1n');
  await bar(page).waitFor({ timeout: 500 });
  await page.keyboard.press('Tab');
  assert.equal(await focused(page), 'tag', 'Tab from the change reaches its tag first');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-marble-id')), 'r1n', 'Shift+Tab goes back');
  // Esc from the bar puts the drawing away and gives the keys back, and
  // the keys coming back do not draw it again.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await focused(page), 'more');
  await page.keyboard.press('Escape');
  await nothingDrawn(page);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.marble-review-group').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-marble-id')), 'r1n');
  // Into it again, from the next field: it draws, and ⏎ on Keep keeps.
  await page.locator('[data-marble-id="r2n"]').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-marble-id')), 'r1n');
  await bar(page).waitFor({ timeout: 500 });
  for (const want of ['tag', 'more', 'keep']) {
    await page.keyboard.press('Tab');
    assert.equal(await focused(page), want);
  }
  await page.keyboard.press('Enter');
  await groups(page, 0);
  assert.deepEqual((await review()).turns, []);
});

test('on touch the bar is a finger tall', async () => {
  const id = await newChat();
  const page = await open({ attending: [id], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true);
  await ask(id, 'dates');
  await groups(page, 1);
  await page.evaluate(() => window.marbleReview.showAll());
  await bar(page).waitFor();
  const heights = await page.locator('.marble-review-bar button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  assert.equal(heights.length, 3);
  for (const h of heights) assert.ok(h >= 44, `a finger tall: ${h}`);
  const b = await bar(page).boundingBox();
  assert.ok(b.x >= 8 && b.x + b.width <= 390 - 8 + 0.5, 'kept inside the window');
});

test('Change more, or ⌘J while it is drawn, opens the line on what the change made, carrying on its chat', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'dates');
  await groups(page, 1);
  const chips = await page.evaluate(() => [...document.querySelectorAll('[data-marble-id="list"] .date')].map((el) => el.getAttribute('data-marble-id')));
  await restOn(page, 'r1');
  await act(page, 'more').click();
  await page.locator('.marble-line:not([data-state="sent"]):not([data-leaving])').waitFor();
  let line = await page.evaluate(() => window.marbleLine.current());
  assert.deepEqual([...line.ids].sort(), [...chips].sort(), 'about the three dates');
  assert.equal(line.conversation, id, 'the same chat carries on');
  assert.equal(line.state, 'edit');
  await nothingDrawn(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.marbleLine.current());

  await away(page);
  await restOn(page, 'r2');
  await bar(page).waitFor();
  await page.keyboard.press('ControlOrMeta+j');
  await page.locator('.marble-line:not([data-state="sent"]):not([data-leaving])').waitFor();
  line = await page.evaluate(() => window.marbleLine.current());
  assert.equal(line.conversation, id);
  assert.equal(line.ids.length, 3);
});

test('with reduced motion the drawing appears and goes at once, and Keep does not fade', async () => {
  const id = await newChat();
  const page = await open({ attending: [id], reducedMotion: 'reduce' });
  await ask(id, 'dates');
  await groups(page, 1);
  await restOn(page, 'r1');
  await bar(page).waitFor();
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.marble-review-group')).transitionDuration), '0s');
  await away(page);
  await page.waitForTimeout(LEAVE_AND_A_FRAME);
  assert.equal(await page.locator('.marble-review-group').count(), 0, 'gone the moment it is put away');
  await restOn(page, 'r1');
  await page.evaluate(() => {
    window.__lifting = false;
    new MutationObserver(() => { if (document.querySelector('.marble-review-group[data-state="lift"]')) window.__lifting = true; })
      .observe(document.querySelector('.marble-review-host'), { subtree: true, childList: true, attributes: true });
  });
  await act(page, 'keep').click();
  await groups(page, 0);
  await nothingDrawn(page, 500);
  assert.equal(await page.evaluate(() => window.__lifting), false, 'kept: gone at once, no lift to wait for');
});

// ------------------------------------------------------------ fix round 1

test('on a board, an ask spread over two columns and a later ask on one card are two changes; Undo on the card takes back only its ask', async () => {
  const id = await newChat();
  const page = await open({ doc: 'board', attending: [id] });
  await ask(id, 'spread', 'board');
  await ask(id, 'cardTitle', 'board');
  await groups(page, 2);
  // A card nothing changed is not a change, however high the board.
  await restOn(page, 'c4t', { wait: 750 });
  assert.equal(await page.locator('.marble-review-group').count(), 0, 'resting on an unchanged card draws nothing');

  await restOn(page, 'c2t');
  await bar(page).waitFor();
  assert.equal(await tagText(page), '1 heading changed');
  await act(page, 'undo').click();
  await page.waitForFunction(() => document.querySelector('[data-marble-id="c2t"]').textContent === 'Local-first', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-marble-id="board"] .due').count(), 2, 'the spread ask stands');
  const turns = (await api('GET', `/agent/conversations/${id}`)).turns;
  assert.equal(turns[0].undoneAt ?? null, null, 'the spread ask is not undone');
  assert.ok(turns[1].undoneAt, 'the card\'s ask is');
  await groups(page, 1);

  // The spread ask is still one change, drawn whichever of its parts you rest on.
  await away(page);
  await nothingDrawn(page);
  await restOn(page, 'c3t');
  await bar(page).waitFor();
  assert.equal(await page.locator('.marble-review-add').count(), 2);
});

test('holding the tag of one row added shows the list without it', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'addRow');
  await groups(page, 1);
  const row = page.locator('[data-marble-id="list"] > li').last();
  const r = await row.boundingBox();
  await page.mouse.move(r.x + 20, r.y + r.height / 2);
  await page.waitForTimeout(600);
  await bar(page).waitFor();
  assert.equal(await tagText(page), '1 row added');
  const tag = await page.locator('.marble-review-tag button').boundingBox();
  await page.mouse.move(tag.x + tag.width / 2, tag.y + tag.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  const held = await page.evaluate(() => {
    const before = document.querySelector('.marble-review-before');
    return { rows: before?.querySelectorAll('li').length ?? -1, words: before?.innerText.replace(/\s+/g, ' ').trim() ?? '' };
  });
  await page.mouse.up();
  assert.equal(held.rows, 3, 'the list as it was: three rows');
  assert.doesNotMatch(held.words, /Potluck/);
});

test('a Keep or an Undo the host refuses says so on the bar, changes nothing, and can be tried again', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'dates');
  await groups(page, 1);
  await page.evaluate(() => {
    window.__reviewed = 0;
    document.addEventListener('marble-callout:reviewed', () => { window.__reviewed += 1; });
  });
  const refuse = (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });

  await page.route('**/agent/turns/*/keep', refuse);
  await restOn(page, 'r1');
  await act(page, 'keep').click();
  await page.waitForFunction(() => /Couldn't keep it\. Try again\./.test(document.querySelector('.marble-review-bar')?.innerText ?? ''));
  assert.equal(await page.locator('.marble-review-group[data-state="lift"]').count(), 0, 'nothing lifts');
  assert.equal(await drawing(page).count(), 1, 'the drawing stays');
  assert.equal(await page.evaluate(() => window.__reviewed), 0, 'nobody hears it was reviewed');
  assert.equal((await review()).turns.length, 1);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.marble-review-bar [data-failed]')).color), await page.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--danger, light-dark(#5f6267, #a6a9ae))';
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }));

  await page.route('**/agent/turns/*/undo', refuse);
  await act(page, 'undo').click();
  await page.waitForFunction(() => /Couldn't undo it\. Try again\./.test(document.querySelector('.marble-review-bar')?.innerText ?? ''));
  assert.equal(await dates(page), 3, 'nothing was taken back');
  assert.equal(await act(page, 'redo').count(), 0, 'and nothing offers to be redone');

  await page.unroute('**/agent/turns/*/keep');
  await page.unroute('**/agent/turns/*/undo');
  await act(page, 'keep').click();
  await page.locator('.marble-review-group[data-state="lift"]').waitFor({ state: 'attached', timeout: 2000 });
  await groups(page, 0);
  assert.equal(await page.evaluate(() => window.__reviewed), 1);
});

test('an Undo of two asks that stops halfway says how far it got and takes the rest on a retry; a Redo refused says so, one not possible goes', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'firstTwo');
  await ask(id, 'addRow');
  await groups(page, 1);
  let undos = 0;
  await page.route('**/agent/turns/*/undo', (route) => {
    undos += 1;
    if (undos === 2) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    return route.continue();
  });
  await restOn(page, 'r2');
  const undo = await act(page, 'undo').boundingBox();
  await page.mouse.move(undo.x + undo.width / 2, undo.y + undo.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForFunction(() => /Undid 1 of 2\. Try again\./.test(document.querySelector('.marble-review-bar')?.innerText ?? ''), null, { timeout: 5000 });
  assert.equal(await page.locator('[data-marble-id="list"] > li').count(), 3, 'the newest ask, the row, is taken back');
  assert.equal(await dates(page), 2, 'the first ask still stands');
  // Try again: Undo takes the rest.
  await act(page, 'undo').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-marble-id="list"] .date').length === 0, null, { timeout: 5000 });
  await page.waitForFunction(() => /^Undone/.test(document.querySelector('.marble-review-bar')?.innerText ?? ''));

  // A Redo the host fails: said, and Redo stays to try again.
  await page.route('**/agent/turns/*/redo', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  await act(page, 'redo').click();
  await page.waitForFunction(() => /Couldn't redo\. Try again\./.test(document.querySelector('.marble-review-bar')?.innerText ?? ''));
  assert.equal(await act(page, 'redo').count(), 1);
  // A Redo that is not possible (R4): Redo goes, nothing else is said.
  await page.unroute('**/agent/turns/*/redo');
  await page.route('**/agent/turns/*/redo', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"there is nothing to redo"}' }));
  await act(page, 'redo').click();
  await page.waitForFunction(() => !document.querySelector('.marble-review-bar button[data-act="redo"]'));
  assert.match(await bar(page).innerText(), /^Undone$/);
});

test('Tab walks into the change, through its tag, Change more, Keep and Undo, and on out; Shift+Tab walks back', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'retitle');
  await groups(page, 1);
  await page.mouse.move(1000, 120);
  await page.locator('[data-marble-id="h"]').evaluate((el) => { el.tabIndex = -1; el.focus(); });
  // The parts first, as they are in the page: the bar only after the last.
  for (const want of ['r1n', 'r2n', 'r3n', 'tag', 'more', 'keep', 'undo', 'p']) {
    await page.keyboard.press('Tab');
    assert.equal(await focused(page), want);
  }
  // Out of the change: the drawing goes.
  await nothingDrawn(page);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await focused(page), 'r3n');
  await bar(page).waitFor({ timeout: 500 });
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Tab');
  assert.equal(await focused(page), 'undo');
  for (const want of ['keep', 'more', 'tag', 'r3n', 'r2n']) {
    await page.keyboard.press('Shift+Tab');
    assert.equal(await focused(page), want);
  }
  assert.equal(await drawing(page).count(), 1, 'drawn the whole way');
});

test('the thing as it was, and an old shape, take the look the page gives them where they stand', async () => {
  const one = await newChat();
  const two = await newChat();
  const page = await open({ doc: 'shelf', attending: [one, two] });
  await ask(one, 'shelfRemove', 'shelf');
  await ask(two, 'shelfLook', 'shelf');
  await page.waitForFunction(() => window.marbleReview.groups().length === 2, null, { timeout: 10_000 });

  // The old card had round corners, from .shelf .card.round.
  await restOn(page, 'sc');
  await page.locator('.marble-review-outline').waitFor({ timeout: 1000 });
  assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.marble-review-outline')).borderTopLeftRadius)), 14);
  await away(page);
  await nothingDrawn(page);

  // The removed row comes back in the copy styled as its neighbours are.
  await restOn(page, 's3');
  await bar(page).waitFor();
  const tag = await page.locator('.marble-review-tag button').boundingBox();
  await page.mouse.move(tag.x + tag.width / 2, tag.y + tag.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  const seen = await page.evaluate(() => {
    const copy = document.querySelector('.marble-review-before');
    const list = document.querySelector('[data-marble-id="sl"]');
    const back = [...(copy?.querySelectorAll('li') ?? [])].find((li) => li.textContent === 'Second');
    const pick = (el) => { const c = getComputedStyle(el); return [c.paddingTop, c.color, c.letterSpacing].join(' '); };
    return {
      beside: list.nextElementSibling === copy,
      transient: copy?.hasAttribute('data-marble-transient'),
      inert: copy?.inert,
      hidden: copy?.getAttribute('aria-hidden'),
      events: copy ? getComputedStyle(copy).pointerEvents : null,
      back: back ? pick(back) : null,
      sibling: pick(document.querySelector('[data-marble-id="s1"]')),
      original: getComputedStyle(list).visibility,
    };
  });
  await page.mouse.up();
  assert.equal(seen.beside, true, 'the copy stands right after the list');
  assert.equal(seen.transient, true);
  assert.equal(seen.inert, true);
  assert.equal(seen.hidden, 'true');
  assert.equal(seen.events, 'none');
  assert.equal(seen.original, 'hidden');
  assert.equal(seen.back, seen.sibling, 'the removed row looks as its neighbours do');
  await page.waitForFunction(() => !document.querySelector('.marble-review-before'));
});

test('a held ⌘Z repeating while the change is being taken back never reaches your own undo', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await page.locator('[data-marble-id="p"]').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Mine.');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await ask(id, 'dates');
  await groups(page, 1);
  await page.route('**/agent/turns/*/undo', async (route) => { await sleep(900); await route.continue(); });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.down(MOD);
  await page.keyboard.down('z');
  await page.waitForTimeout(150);
  await page.keyboard.down('z');
  await page.keyboard.down('z');
  await page.keyboard.up('z');
  await page.keyboard.up(MOD);
  await page.waitForFunction(() => document.querySelectorAll('[data-marble-id="list"] .date').length === 0, null, { timeout: 5000 });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-marble-id="p"]').textContent(), 'Notes for the week. Mine.', 'your edit stands');
});

test('a second ⌘Z while one change is being taken back is ignored', async () => {
  const a = await newChat();
  const b = await newChat();
  const page = await open({ attending: [a, b] });
  await ask(a, 'dates');
  await ask(b, 'rename');
  await groups(page, 2);
  let undos = 0;
  await page.route('**/agent/turns/*/undo', async (route) => { undos += 1; await sleep(900); await route.continue(); });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForTimeout(150);
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForFunction(() => document.querySelector('[data-marble-id="h"]').textContent === 'Reading list', null, { timeout: 5000 });
  await page.waitForTimeout(600);
  assert.equal(undos, 1, 'one undo asked of the host');
  assert.equal(await dates(page), 3, 'the other change stands');
});

test('⌘Z goes by when the change finished, not when the page heard of it', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await slowReview(page, 1500);
  await ask(id, 'dates');
  // Your edit after the change had finished, before the page had listed it.
  await page.locator('[data-marble-id="p"]').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Mine.');
  await groups(page, 1);
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForFunction(() => document.querySelector('[data-marble-id="p"]').textContent === 'Notes for the week.');
  await page.waitForTimeout(400);
  assert.equal(await dates(page), 3, 'the change stands');
});

test('the thing as it was goes back the moment the window loses the hold', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'dates');
  await groups(page, 1);
  await restOn(page, 'r1');
  for (const event of ['blur', 'pagehide']) {
    const tag = await page.locator('.marble-review-tag button').boundingBox();
    await page.mouse.move(tag.x + tag.width / 2, tag.y + tag.height / 2);
    await page.mouse.down();
    await page.locator('.marble-review-before').waitFor({ state: 'attached' });
    await page.evaluate((type) => dispatchEvent(new Event(type)), event);
    await page.waitForFunction(() => !document.querySelector('.marble-review-before')
      && getComputedStyle(document.querySelector('[data-marble-id="list"]')).visibility === 'visible', null, { timeout: 1000 });
    await page.mouse.up();
  }
});

test('no rest is drawn while typing has just happened, or with a button held', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await ask(id, 'dates');
  await groups(page, 1);
  await page.locator('[data-marble-id="p"]').click();
  await page.keyboard.type('x');
  await restOn(page, 'r1', { wait: 650 });
  assert.equal(await page.locator('.marble-review-group').count(), 0, 'just typed: no drawing');
  await page.waitForTimeout(300);
  const r = await box(page, 'r2');
  await page.mouse.move(r.x + 30, r.y + r.height / 2);
  await page.waitForTimeout(650);
  await bar(page).waitFor({ timeout: 500 });

  await away(page);
  await nothingDrawn(page);
  await page.mouse.down();
  await restOn(page, 'r3', { wait: 700 });
  assert.equal(await page.locator('.marble-review-group').count(), 0, 'dragging: no drawing');
  await page.mouse.up();
});

test('a write from outside the page is not the person: ⌘Z after it still takes back the change', async () => {
  const id = await newChat();
  const page = await open({ attending: [id] });
  await page.locator('[data-marble-id="p"]').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Mine.');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await ask(id, 'dates');
  await groups(page, 1);
  await page.mouse.move(1000, 120);
  await page.waitForTimeout(2200);
  const source = await host.drive.store.read('list');
  await host.drive.putDocument('list', source.replace('>Reading list</h1>', '>Reading list, shared</h1>'), { label: 'outside' });
  await page.waitForFunction(() => document.querySelector('[data-marble-id="h"]').textContent === 'Reading list, shared', null, { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForFunction(() => document.querySelectorAll('[data-marble-id="list"] .date').length === 0, null, { timeout: 5000 });
});

test('a component of the page\'s own is never brought to life a second time by a copy of it', async () => {
  const id = await newChat();
  const page = await open({ doc: 'custom', attending: [id] });
  await ask(id, 'custom', 'custom');
  await page.waitForFunction(() => window.marbleReview.groups().length === 1, null, { timeout: 10_000 });
  assert.equal(await page.evaluate(() => window.__made), 1);
  await restOn(page, 'rct');
  await page.locator('.marble-review-outline').waitFor({ timeout: 1000 });
  const tag = await page.locator('.marble-review-tag button').boundingBox();
  await page.mouse.move(tag.x + tag.width / 2, tag.y + tag.height / 2);
  await page.mouse.down();
  await page.locator('.marble-review-before').waitFor({ state: 'attached' });
  const seen = await page.evaluate(() => ({ made: window.__made, cards: document.querySelectorAll('review-card').length }));
  await page.mouse.up();
  assert.deepEqual(seen, { made: 1, cards: 1 });
});
