// Find, mark, commit (v5, Notes and Sketches/Ask at Anything, "Round the
// corners" and "From a hand, not a sentence"): grab one part and every part
// like it follows. In Reshape the part under the pointer gets a dot in its
// corner and a bar inside its right edge; resting on either marks every part
// like it at once; a press on a mark leaves that part out; a drag changes them
// all one to one, and letting go files one rule, undone by one ⌘Z. A few
// words in the line that sound like a look become the same one rule, and
// anything that is not one rule goes to the agent as it was asked.

import assert from 'node:assert/strict';
import test from 'node:test';

import { examine } from '../server/engine.js';
import { composeScript } from '../server/gallery.js';
import { startDrive } from './harness.js';

// The document's own history: ⌘Z is marble.undo(), as a starter has it.
const HISTORY = await composeScript(['editable', 'history']);

// Four cards and a panel that looks like them but is another kind. The cards
// ease their corners themselves, so a value that is not set one to one under
// the hand would be seen mid-transition.
const board = ({ inline = '' } = {}) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Board</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 40px; max-width: 720px; }
  h1 { font-size: 24px; margin: 0 0 16px; }
  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .card { padding: 14px; border: 1px solid #bbb; border-radius: 12px; background: #fff; transition: border-radius 300ms, padding 300ms; }
  .card b { display: block; }
  .panel { margin-top: 20px; padding: 14px; border: 1px solid #bbb; border-radius: 12px; background: #f6f6f6; }
</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Reading list</h1>
  <div class="cards" data-marble-id="cards">
    <div class="card" data-marble-id="c1"><b data-marble-id="c1t">Malleable software</b><span data-marble-id="c1s">Ink &amp; Switch</span></div>
    <div class="card" data-marble-id="c2"${inline}><b data-marble-id="c2t">Direct manipulation</b><span data-marble-id="c2s">Shneiderman</span></div>
    <div class="card" data-marble-id="c3"><b data-marble-id="c3t">Morphic</b><span data-marble-id="c3s">Maloney and Smith</span></div>
    <div class="card" data-marble-id="c4"><b data-marble-id="c4t">Dynamicland</b><span data-marble-id="c4s">Victor</span></div>
  </div>
  <div class="panel" data-marble-id="panel"><b data-marble-id="pt">Notes</b><p data-marble-id="pp">What makes a page feel like clay?</p></div>
  <script data-marble-id="aff">${HISTORY}</script>
</body></html>
`;

// An agent's change to the heading, for ⌘Z to have something older to pass.
const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'board' } },
    { call: 'apply_ops', args: { path: 'board', note: 'Rename the list.', ops: [{ type: 'setText', id: 'h', text: 'Papers' }] } },
    { say: 'Done.' },
  ],
};
const host = await startDrive({
  scripts: SCRIPTS,
  documents: { board: board(), inline: board({ inline: ' style="border-radius: 8px"' }) },
});
test.after(() => host.close());
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const pages = [];
const closePages = async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); };
test.after(closePages);

const api = async (method, url, body) => {
  const response = await fetch(`${host.base}${url}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
};
const settle = async () => {
  for (const summary of await api('GET', '/agent/conversations')) {
    const detail = await api('GET', `/agent/conversations/${summary.id}`);
    for (const turn of detail.turns ?? []) if (turn.status === 'running') await api('POST', `/agent/turns/${turn.id}/cancel`);
    await api('PATCH', `/agent/conversations/${summary.id}`, { archived: true });
  }
  await host.reset();
};
const file = async (doc = 'board') => (await fetch(`${host.base}/a/${doc}`)).text();
const rulesInFile = async (doc = 'board') => [...(await file(doc)).matchAll(/<style[^>]*data-marble-rule="([^"]*)"[^>]*>([^<]*)<\/style>/g)].map((m) => ({ key: m[1], text: m[2] }));

const open = async ({ doc = 'board', ...options } = {}) => {
  await closePages();
  await settle();
  const { page, errors } = await host.newPage(options);
  pages.push(page);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleRules && window.marbleChange && window.marbleLine));
  // Every entry the person's history takes, counted.
  await page.evaluate(() => {
    window.__records = [];
    const record = window.marble.record;
    window.marble.record = (entry, options) => { window.__records.push(entry); return record(entry, options); };
  });
  page.errors = errors;
  return page;
};

const box = (page, id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();
const radius = (page, id) => page.evaluate((i) => getComputedStyle(document.querySelector(`[data-marble-id="${i}"]`)).borderTopLeftRadius, id);
const radii = (page) => page.evaluate(() => ['c1', 'c2', 'c3', 'c4', 'panel'].map((id) => getComputedStyle(document.querySelector(`[data-marble-id="${id}"]`)).borderTopLeftRadius));
const corner = (page) => page.locator('.marble-rules-grip[data-grip="corner"]');
const bar = (page) => page.locator('.marble-rules-grip[data-grip="padding"]');
const tints = (page) => page.locator('.marble-change-tint:not([data-state="gone"])');
// The tag is drawn once a frame: wait for it to say what is expected.
const tagSays = (page, pattern, timeout = 3000) => page.waitForFunction(
  (source) => new RegExp(source).test(document.querySelector('.marble-change-tag[data-local] .marble-change-said')?.textContent ?? ''),
  pattern.source, { timeout },
);
// The page's own cards ease their corners: wait for them to get where they go.
const radiiAre = (page, want, timeout = 3000) => page.waitForFunction(
  (w) => ['c1', 'c2', 'c3', 'c4', 'panel'].map((id) => getComputedStyle(document.querySelector(`[data-marble-id="${id}"]`)).borderTopLeftRadius).join() === w.join(),
  want, { timeout },
);
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Reshape on, the pointer on a card, then on its corner dot. */
async function grab(page, id = 'c1') {
  await page.evaluate(() => window.marbleRules.reshape(true));
  const card = await box(page, id);
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await corner(page).waitFor();
  const dot = center(await corner(page).boundingBox());
  await page.mouse.move(dot.x, dot.y);
  return dot;
}
/** A drag from `from` by (dx, dy), in steps, the button still down. */
async function dragBy(page, from, dx, dy, steps = 5) {
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
}

test('likes: a card is like the other cards and not the panel; ⇧ means just the one', async () => {
  const page = await open();
  const ids = (only) => page.evaluate((o) => window.marbleRules.likes(document.querySelector('[data-marble-id="c2"]'), { only: o }).map((el) => el.dataset.marbleId), only);
  assert.deepEqual(await ids(false), ['c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(await ids(true), ['c2']);
  // A part with no class of its own: its likes are under parents like its own.
  const titles = await page.evaluate(() => window.marbleRules.likes(document.querySelector('[data-marble-id="c1t"]')).map((el) => el.dataset.marbleId));
  assert.deepEqual(titles, ['c1t', 'c2t', 'c3t', 'c4t'], 'the cards\' titles, not the panel\'s');
  assert.deepEqual(page.errors, []);
});

test('Reshape is a toggle in the chat button\'s menu, and Esc leaves it', async () => {
  const page = await open();
  const row = page.locator('marble-agent-drawer .tool[data-tool="reshape"]');
  await row.waitFor({ state: 'attached' });
  assert.equal(await row.getAttribute('aria-pressed'), 'false');
  await row.evaluate((el) => el.click());
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-reshaping'));
  assert.equal(await row.getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.documentElement.classList.contains('marble-reshaping'));
  assert.equal(await row.getAttribute('aria-pressed'), 'false');
});

test('a drag on one card\'s corner turns all four one to one, and letting go files one rule that one ⌘Z takes back', async () => {
  const page = await open();
  const dot = await grab(page);
  // Marks before motion: every card like it is tinted the moment the dot is
  // under the pointer, before anything moves.
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-tint:not([data-state="gone"])').length === 4);
  assert.deepEqual(await radii(page), ['12px', '12px', '12px', '12px', '12px'], 'nothing moved yet');
  const marked = await page.evaluate(() => [...document.querySelectorAll('.marble-change-tint')].map((t) => t.dataset.id).sort());
  assert.deepEqual(marked, ['c1', 'c2', 'c3', 'c4'], 'the panel is not marked');

  await dragBy(page, dot, 20, 20);
  // Under the hand nothing eases: the cards' own transition is held off.
  assert.deepEqual(await radii(page), ['32px', '32px', '32px', '32px', '12px'], 'all four at once, the panel untouched');
  await tagSays(page, /^Rounding 4 cards · 32 px$/);
  assert.equal(await page.locator('[data-marble-dragging]').count(), 4, 'the engine is told a hand is on them');
  await page.mouse.up();

  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  assert.equal(await page.locator('[data-marble-dragging]').count(), 0);
  assert.deepEqual(await radii(page), ['32px', '32px', '32px', '32px', '12px'], 'the rule holds them where the hand left them');
  const inline = await page.evaluate(() => ['c1', 'c2', 'c3', 'c4'].map((id) => document.querySelector(`[data-marble-id="${id}"]`).getAttribute('style')));
  assert.deepEqual(inline, [null, null, null, null], 'nothing of the drag is left on the cards');
  assert.equal(await page.evaluate(() => window.__records.length), 1, 'one entry in the history');
  const [entry] = await page.evaluate(() => window.__records);
  assert.equal(entry.redo.length, 1);
  assert.equal(entry.redo[0].type, 'insert');
  assert.equal(entry.redo[0].parentId, 'b', 'the last thing in the body');
  // The file has the rule, once, keyed by what it is for.
  let rules = [];
  for (let i = 0; i < 40 && rules.length !== 1; i += 1) { rules = await rulesInFile(); if (rules.length !== 1) await page.waitForTimeout(100); }
  assert.equal(rules.length, 1);
  assert.equal(rules[0].key, 'div.card|border-radius');
  assert.equal(rules[0].text.trim(), 'html div.card:not([data-marble-transient], [data-marble-transient] *) { border-radius: 32px; }');
  const id = await page.evaluate(() => document.querySelector('style[data-marble-rule]').dataset.marbleId);
  assert.ok(id && (await file()).split(`data-marble-id="${id}"`).length === 2, 'the rule has an id of its own');
  assert.deepEqual(examine('board.mrbl', await host.drive.store.read('board')) ?? [], [], 'the document is still sound');

  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForFunction(() => !document.querySelector('style[data-marble-rule]'));
  await radiiAre(page, ['12px', '12px', '12px', '12px', '12px']);
  for (let i = 0; i < 40 && (await rulesInFile()).length; i += 1) await page.waitForTimeout(100);
  assert.deepEqual(await rulesInFile(), [], 'and out of the file');
  assert.deepEqual(page.errors, []);
});

test('a press on a marked card before the drag leaves it out: it keeps its corners, and the rule says so', async () => {
  const page = await open();
  const dot = await grab(page);
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-tint').length === 4);
  const c3 = center(await box(page, 'c3'));
  await page.mouse.move(c3.x, c3.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.marble-change-tint[data-id="c3"]')?.dataset.state === 'out');
  await tagSays(page, /^Rounding 3 of 4 cards/);
  // The marks stay while the pointer goes back to the dot.
  await page.mouse.move(dot.x, dot.y);
  await dragBy(page, dot, 10, 10);
  assert.deepEqual(await radii(page), ['22px', '22px', '12px', '22px', '12px']);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  assert.deepEqual(await radii(page), ['22px', '22px', '12px', '22px', '12px']);
  const text = await page.evaluate(() => document.querySelector('style[data-marble-rule]').textContent);
  assert.equal(text.trim(), 'html div.card:not([data-marble-id="c3"]):not([data-marble-transient], [data-marble-transient] *) { border-radius: 22px; }');
  assert.deepEqual(page.errors, []);
});

test('a card whose own style sets its corners still ends where the others do, and ⌘Z gives it its own back', async () => {
  const page = await open({ doc: 'inline' });
  assert.equal(await radius(page, 'c2'), '8px');
  const dot = await grab(page);
  await dragBy(page, dot, 20, 20);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  assert.deepEqual(await radii(page), ['32px', '32px', '32px', '32px', '12px']);
  assert.match(await page.locator('[data-marble-id="c2"]').getAttribute('style'), /border-radius: 32px/);
  const [entry] = await page.evaluate(() => window.__records);
  assert.deepEqual(entry.redo.map((op) => op.type), ['insert', 'setAttr'], 'the rule, and the card its own style outvotes');
  for (let i = 0; i < 40 && !/border-radius: 32px/.test(/data-marble-id="c2"[^>]*/.exec(await file('inline'))?.[0] ?? ''); i += 1) await page.waitForTimeout(100);
  assert.match(/<div[^>]*data-marble-id="c2"[^>]*>/.exec(await file('inline'))[0], /border-radius: 32px/);

  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForFunction(() => !document.querySelector('style[data-marble-rule]'));
  assert.equal(await page.locator('[data-marble-id="c2"]').getAttribute('style'), 'border-radius: 8px');
  await radiiAre(page, ['12px', '8px', '12px', '12px', '12px']);
  assert.deepEqual(page.errors, []);
});

test('a second drag on the same kind changes the same rule', async () => {
  const page = await open();
  let dot = await grab(page);
  await dragBy(page, dot, 10, 10);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  const first = await page.evaluate(() => document.querySelector('style[data-marble-rule]').dataset.marbleId);
  // Away and back, so the dot is found afresh where the corner now is.
  await page.mouse.move(700, 700);
  dot = await grab(page, 'c4');
  await dragBy(page, dot, -6, -6);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('style[data-marble-rule]')?.textContent.includes('16px'));
  assert.equal(await page.locator('style[data-marble-rule]').count(), 1, 'still one');
  assert.equal(await page.evaluate(() => document.querySelector('style[data-marble-rule]').dataset.marbleId), first);
  assert.deepEqual(await radii(page), ['16px', '16px', '16px', '16px', '12px']);
  const records = await page.evaluate(() => window.__records);
  assert.equal(records.length, 2);
  assert.equal(records[1].redo[0].type, 'setInner');
  let rules = [];
  for (let i = 0; i < 40; i += 1) { rules = await rulesInFile(); if (rules.length === 1 && rules[0].text.includes('16px')) break; await page.waitForTimeout(100); }
  assert.equal(rules.length, 1);
  assert.match(rules[0].text, /border-radius: 16px/);
  assert.deepEqual(page.errors, []);
});

test('Esc in the middle of a drag puts every card back and files nothing', async () => {
  const page = await open();
  const dot = await grab(page);
  await dragBy(page, dot, 20, 20);
  assert.deepEqual(await radii(page), ['32px', '32px', '32px', '32px', '12px']);
  await page.keyboard.press('Escape');
  assert.deepEqual(await radii(page), ['12px', '12px', '12px', '12px', '12px']);
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('style[data-marble-rule]').count(), 0);
  assert.equal(await page.evaluate(() => window.__records.length), 0);
  assert.equal(await page.locator('[data-marble-dragging]').count(), 0);
  const inline = await page.evaluate(() => ['c1', 'c2', 'c3', 'c4'].map((id) => document.querySelector(`[data-marble-id="${id}"]`).getAttribute('style')));
  assert.deepEqual(inline, [null, null, null, null]);
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('marble-reshaping')), 'Esc took back the drag, not Reshape');
});

test('the keys: Tab reaches the dot, arrows move every card a pixel (⇧ four), Enter files it, Esc puts it back', async () => {
  const page = await open();
  await page.evaluate(() => window.marbleRules.reshape(true));
  const card = await box(page, 'c1');
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await corner(page).waitFor();
  // The part under the pointer is the first stop, then its dot.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('marble-rules-ring') && window.marbleRules.part?.dataset.marbleId), 'c1');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.grip), 'corner');
  assert.equal(await corner(page).getAttribute('aria-label'), 'Corner radius, 12 px');
  assert.equal(await corner(page).getAttribute('title'), null, 'a drawn tip, not a title');
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-tint').length === 4, null, { timeout: 2000 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowRight');
  assert.deepEqual(await radii(page), ['18px', '18px', '18px', '18px', '12px']);
  assert.equal(await corner(page).getAttribute('aria-label'), 'Corner radius, 18 px');
  await page.keyboard.press('Escape');
  assert.deepEqual(await radii(page), ['12px', '12px', '12px', '12px', '12px'], 'Esc put it back');
  assert.equal(await page.evaluate(() => window.__records.length), 0);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  assert.deepEqual(await radii(page), ['11px', '11px', '11px', '11px', '12px']);
  assert.equal(await page.evaluate(() => window.__records.length), 1);
  // Tab again: the padding bar.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.grip), 'padding');
  assert.equal(await bar(page).getAttribute('aria-label'), 'Padding, 14 px');
  assert.deepEqual(page.errors, []);
});

test('resting on a grip draws its tip: what a drag does, verb first', async () => {
  const page = await open();
  await grab(page);
  await page.waitForTimeout(900);
  const tip = page.locator('.marble-rules-tip:not([hidden])');
  await tip.waitFor();
  assert.equal(await tip.getAttribute('role'), 'tooltip');
  assert.match(await tip.innerText(), /^Drag to round all 4 cards/);
});

test('the padding bar pads every card one to one', async () => {
  const page = await open();
  await page.evaluate(() => window.marbleRules.reshape(true));
  const card = await box(page, 'c2');
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await bar(page).waitFor();
  const at = center(await bar(page).boundingBox());
  await page.mouse.move(at.x, at.y);
  await dragBy(page, at, -6, 0);
  const pads = () => page.evaluate(() => ['c1', 'c2', 'c3', 'c4', 'panel'].map((id) => getComputedStyle(document.querySelector(`[data-marble-id="${id}"]`)).paddingRight));
  assert.deepEqual(await pads(), ['20px', '20px', '20px', '20px', '14px']);
  await tagSays(page, /^Padding 4 cards · 20 px$/);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('style[data-marble-rule]')?.dataset.marbleRule === 'div.card|padding');
  assert.deepEqual(await pads(), ['20px', '20px', '20px', '20px', '14px']);
  assert.deepEqual(page.errors, []);
});

test('on a phone the grips are 22px and always drawn on the part a finger chose', async () => {
  const page = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.evaluate(() => window.marbleRules.reshape(true));
  const card = await box(page, 'c1');
  await page.touchscreen.tap(card.x + card.width / 2, card.y + card.height / 2);
  await corner(page).waitFor();
  const dot = await corner(page).boundingBox();
  assert.equal(Math.round(dot.width), 22);
  assert.equal(Math.round(dot.height), 22);
  assert.equal(await corner(page).evaluate((el) => getComputedStyle(el).opacity), '1');
});

test('a few words in the line that are one rule: every card is marked, the rule lands, and no agent is asked', async () => {
  const page = await open();
  let asked = null;
  await page.route('**/agent/change-intent', async (route) => {
    asked = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rule: { selector: 'div.card', declarations: { 'border-radius': '24px' }, unit: 'cards', verb: 'Rounding' } }) });
  });
  await page.evaluate(() => window.marbleLine.open({}));
  await page.locator('.marble-line-input').waitFor();
  await page.keyboard.type('round the corners');
  await page.keyboard.press('Enter');
  // Marked at once, before anything moves, with a tag that counts.
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-tint').length === 4);
  await tagSays(page, /^Rounding 4 cards$/);
  assert.deepEqual(await radii(page), ['12px', '12px', '12px', '12px', '12px'], 'marks before motion');
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1, null, { timeout: 5000 });
  // The engine plays it in, in loose batches; then every card is there.
  await radiiAre(page, ['24px', '24px', '24px', '24px', '12px']);
  assert.equal(asked.words, 'round the corners');
  assert.ok(asked.outline.some((o) => o.selector === 'div.card' && o.count === 4), 'the page\'s outline went with the words');
  assert.equal(await page.evaluate(() => window.__records.length), 1, 'one entry, the person\'s own');
  // The tints lift once it has landed.
  await page.waitForFunction(() => !document.querySelector('.marble-change-tint'), null, { timeout: 5000 });
  assert.deepEqual(await api('GET', '/agent/conversations'), [], 'no agent was asked');
  // ⌘Z takes it back.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForFunction(() => !document.querySelector('style[data-marble-rule]'));
  assert.deepEqual(page.errors, []);
});

test('words that are no rule go to the agent as they were asked', async () => {
  const page = await open();
  await page.route('**/agent/change-intent', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"rule":null}' }));
  await page.evaluate(() => window.marbleLine.open({}));
  await page.locator('.marble-line-input').waitFor();
  await page.keyboard.type('round the corners');
  await page.keyboard.press('Enter');
  let turns = [];
  for (let i = 0; i < 60 && !turns.length; i += 1) {
    const list = await api('GET', '/agent/conversations');
    turns = list.length ? (await api('GET', `/agent/conversations/${list[0].id}`)).turns ?? [] : [];
    if (!turns.length) await page.waitForTimeout(100);
  }
  assert.equal(turns.length, 1);
  assert.equal(turns[0].prompt, 'round the corners');
  assert.equal(await page.locator('style[data-marble-rule]').count(), 0);
});

test('a rule that does not hold up on the page goes to the agent too', async () => {
  const page = await open();
  // A selector matching nothing here, and a property no rule may set.
  const replies = [
    { selector: '.nothing-here', declarations: { 'border-radius': '24px' }, unit: 'cards', verb: 'Rounding' },
    { selector: 'div.card', declarations: { display: 'none' }, unit: 'cards', verb: 'Hiding' },
  ];
  for (const rule of replies) {
    const ok = await page.evaluate((r) => window.marbleRules.check(r, []), rule);
    assert.equal(ok, null, JSON.stringify(rule));
  }
  const scoped = await page.evaluate(() => window.marbleRules.check({ selector: 'div.card', declarations: { 'border-radius': '20px' } }, ['c1']));
  assert.equal(scoped, null, 'a rule reaching past the thing the line is about');
  const fine = await page.evaluate(() => window.marbleRules.check({ selector: '[data-marble-id="cards"] div.card', declarations: { 'border-radius': '20px' } }, ['cards']));
  assert.equal(fine.targets, 4);
});

test('⇧ at the press changes only that card, with a rule of its own, and the others are seen left out', async () => {
  const page = await open();
  const dot = await grab(page);
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-tint').length === 4);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.keyboard.up('Shift');
  for (let i = 1; i <= 5; i += 1) await page.mouse.move(dot.x + 4 * i, dot.y + 4 * i);
  assert.deepEqual(await radii(page), ['32px', '12px', '12px', '12px', '12px']);
  await tagSays(page, /^Rounding 1 of 4 cards · 32 px$/);
  const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.marble-change-tint')].map((t) => [t.dataset.id, t.dataset.state])));
  assert.deepEqual([states.c2, states.c3, states.c4], ['out', 'out', 'out']);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  assert.equal(await page.evaluate(() => document.querySelector('style[data-marble-rule]').dataset.marbleRule), 'div.card[data-marble-id="c1"]|border-radius');
  assert.deepEqual(await radii(page), ['32px', '12px', '12px', '12px', '12px']);
  // A drag of the kind afterwards takes it in again: one rule for all.
  const again = await grab(page, 'c1');
  await dragBy(page, again, 4, 4);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('style[data-marble-rule]')?.dataset.marbleRule === 'div.card|border-radius');
  assert.equal(await page.locator('style[data-marble-rule]').count(), 1, 'its own rule went with it');
  assert.deepEqual(await radii(page), ['36px', '36px', '36px', '36px', '12px']);
  assert.equal(await page.locator('[data-marble-id="c1"]').getAttribute('style'), null);
  assert.deepEqual(page.errors, []);
});

test('a rule the person made is theirs: ⌘Z takes it back before an agent\'s older change, however long the words took', async () => {
  const page = await open();
  const id = (await api('POST', '/agent/conversations', { provider: 'fake' })).id;
  await api('POST', `/agent/conversations/${id}/turns`, { prompt: 'script:rename', context: { target: 'board', viewing: 'board', selection: [], also: [] } });
  await page.waitForFunction(() => document.querySelector('[data-marble-id="h"]').textContent === 'Papers', null, { timeout: 15_000 });
  await page.waitForFunction(() => window.marbleReview?.groups().length === 1, null, { timeout: 10_000 });
  // The words take longer than a hand's own moment to come back as a rule.
  await page.route('**/agent/change-intent', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2600));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rule: { selector: 'div.card', declarations: { 'border-radius': '20px' }, unit: 'cards', verb: 'Rounding' } }) });
  });
  await page.evaluate(() => window.marbleLine.open({}));
  await page.locator('.marble-line-input').waitFor();
  await page.keyboard.type('round the corners');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1, null, { timeout: 10_000 });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForFunction(() => !document.querySelector('style[data-marble-rule]'), null, { timeout: 5000 });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-marble-id="h"]').textContent(), 'Papers', 'the agent\'s change stands');
  const turn = (await api('GET', `/agent/conversations/${id}`)).turns.at(-1);
  assert.equal(turn.undoneAt ?? null, null);
});

test('a rule never reaches the drive\'s own chrome: words that would are the agent\'s, and a hand\'s rule steps round it', async () => {
  const page = await open();
  await page.evaluate(() => {
    const chrome = document.createElement('div');
    chrome.className = 'card';
    chrome.setAttribute('data-marble-transient', '');
    chrome.textContent = 'Not the page';
    document.body.append(chrome);
  });
  assert.equal(await page.evaluate(() => window.marbleRules.check({ selector: 'div.card', declarations: { 'border-radius': '20px' } }, [])), null);
  const dot = await grab(page);
  await dragBy(page, dot, 10, 10);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  const text = await page.evaluate(() => document.querySelector('style[data-marble-rule]').textContent);
  assert.match(text, /:not\(\[data-marble-transient\], \[data-marble-transient\] \*\)/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('div.card[data-marble-transient]')).borderTopLeftRadius), '12px');
  assert.deepEqual(await radii(page), ['22px', '22px', '22px', '22px', '12px']);
});

test('Esc while the words are still being read stops them: nothing changes and nothing goes to an agent', async () => {
  const page = await open();
  let answered = false;
  await page.route('**/agent/change-intent', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    answered = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rule: { selector: 'div.card', declarations: { 'border-radius': '20px' }, unit: 'cards', verb: 'Rounding' } }) }).catch(() => {});
  });
  await page.evaluate(() => window.marbleLine.open({}));
  await page.locator('.marble-line-input').waitFor();
  await page.keyboard.type('round the corners');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Escape');
  for (let i = 0; i < 30 && !answered; i += 1) await page.waitForTimeout(100);
  await page.waitForTimeout(900);
  assert.equal(await page.locator('style[data-marble-rule]').count(), 0);
  assert.deepEqual(await radii(page), ['12px', '12px', '12px', '12px', '12px']);
  assert.deepEqual(await api('GET', '/agent/conversations'), []);
  assert.equal(await page.locator('.marble-change-tint').count(), 0);
});

test('with reduced motion the words still mark, then land in one crossfade', async () => {
  const page = await open({ reducedMotion: 'reduce' });
  await page.route('**/agent/change-intent', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rule: { selector: 'div.card', declarations: { padding: '20px' }, unit: 'cards', verb: 'Spacing' } }) }));
  await page.evaluate(() => window.marbleLine.open({}));
  await page.locator('.marble-line-input').waitFor();
  await page.keyboard.type('more padding');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-tint').length === 4);
  await page.waitForFunction(() => document.querySelector('style[data-marble-rule]')?.dataset.marbleRule === 'div.card|padding', null, { timeout: 5000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-marble-id="c3"]')).paddingTop === '20px');
  await tagSays(page, /^4 cards spaced$/);
});

test('Hide work hides an agent\'s marks, not the person\'s own: Reshape stays drawn', async () => {
  const page = await open();
  await page.evaluate(() => document.documentElement.classList.add('marble-zones-off'));
  await grab(page);
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-tint').length === 4);
  const shown = await page.evaluate(() => [...document.querySelectorAll('.marble-change-tint')].every((t) => getComputedStyle(t).display !== 'none')
    && getComputedStyle(document.querySelector('.marble-change-layer')).display !== 'none');
  assert.ok(shown);
});

// ------------------------------------------------------------ review round 1

const inlineStyles = (page) => page.evaluate(() => ['c1', 'c2', 'c3', 'c4'].map((id) => {
  const el = document.querySelector(`[data-marble-id="${id}"]`);
  return el ? el.getAttribute('style') : 'gone';
}));
const intentRule = (page, rule, { delay = 0 } = {}) => page.route('**/agent/change-intent', async (route) => {
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rule }) }).catch(() => {});
});
const say = async (page, words) => {
  await page.evaluate(() => window.marbleLine.open({}));
  await page.locator('.marble-line:not([data-state="sent"]):not([data-leaving]) .marble-line-input').waitFor();
  // Words given back to the line before are not these.
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(words);
  await page.keyboard.press('Enter');
};
const turnsAsked = async () => {
  const out = [];
  for (const summary of await api('GET', '/agent/conversations')) out.push(...((await api('GET', `/agent/conversations/${summary.id}`)).turns ?? []).map((t) => t.prompt));
  return out;
};

test('the part in hand leaving the page mid-drag puts every part back, files nothing, and leaves the page usable', async () => {
  const page = await open();
  const dot = await grab(page);
  await dragBy(page, dot, 10, 10);
  await page.evaluate(() => document.querySelector('[data-marble-id="c1"]').remove());
  await page.mouse.move(dot.x + 14, dot.y + 14);
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(() => [...document.documentElement.classList].filter((c) => c.startsWith('marble-rules-held'))), []);
  assert.deepEqual((await inlineStyles(page)).slice(1), [null, null, null], 'no overrides left on the others');
  assert.equal(await page.locator('[data-marble-dragging]').count(), 0);
  assert.equal(await page.locator('style[data-marble-rule]').count(), 0);
  assert.equal(await page.evaluate(() => window.__records.length), 0);
  // A later drag files clean styles.
  await page.mouse.move(700, 700);
  const again = await grab(page, 'c2');
  await dragBy(page, again, 4, 4);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  const text = await page.evaluate(() => document.querySelector('style[data-marble-rule]').textContent);
  assert.doesNotMatch(text, /transition|!important/);
  assert.deepEqual((await inlineStyles(page)).slice(1), [null, null, null]);
  assert.deepEqual(page.errors, []);
});

test('⌘Z and ⇧⌘Z play a rule back and forth through the engine', async () => {
  const page = await open();
  const dot = await grab(page);
  await dragBy(page, dot, 20, 20);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  await page.mouse.move(700, 700);
  await page.evaluate(() => {
    window.__moved = new Set();
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, timing) {
      const list = Array.isArray(frames) ? frames : [];
      if ((timing?.id ?? '') === 'marble-morph' || list.some((f) => f && 'borderTopLeftRadius' in f)) {
        if (list.some((f) => f && 'borderTopLeftRadius' in f)) window.__moved.add(this.dataset?.marbleId);
      }
      return animate.call(this, frames, timing);
    };
    document.activeElement?.blur?.();
  });
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForFunction(() => !document.querySelector('style[data-marble-rule]'));
  await page.waitForFunction(() => ['c1', 'c2', 'c3', 'c4'].every((id) => window.__moved.has(id)), null, { timeout: 2000 });
  await radiiAre(page, ['12px', '12px', '12px', '12px', '12px']);
  await page.evaluate(() => window.__moved.clear());
  await page.keyboard.press(`${MOD}+Shift+z`);
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  await page.waitForFunction(() => ['c1', 'c2', 'c3', 'c4'].every((id) => window.__moved.has(id)), null, { timeout: 2000 });
  await radiiAre(page, ['32px', '32px', '32px', '32px', '12px']);
  assert.deepEqual(page.errors, []);
});

test('Reshape turned on from the menu gives the keys back to the page, so Esc leaves it', async () => {
  const page = await open();
  const tray = page.locator('marble-agent-drawer .tray');
  await tray.locator('.launcher').hover();
  const row = tray.locator('.tool[data-tool="reshape"]');
  await row.waitFor({ state: 'visible' });
  await row.click();
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-reshaping'));
  await page.waitForTimeout(50);
  assert.ok(await page.evaluate(() => document.activeElement === document.body || !document.activeElement?.closest?.('[data-marble-transient]')), 'the keys are the page\'s');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.documentElement.classList.contains('marble-reshaping'), null, { timeout: 2000 });
});

test('a drag while a rule from words is still playing in files clean styles: no hand of this page is taken for the page\'s own', async () => {
  const page = await open();
  await intentRule(page, { selector: 'div.card', declarations: { 'border-radius': '24px' }, unit: 'cards', verb: 'Rounding' });
  await say(page, 'round the corners');
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1, null, { timeout: 5000 });
  // At once, while the engine plays it in: two drags, one after the other.
  for (const by of [4, 4]) {
    const dot = await grab(page);
    await dragBy(page, dot, by, by, 2);
    await page.mouse.up();
  }
  await page.waitForTimeout(1200);
  assert.deepEqual(await inlineStyles(page), [null, null, null, null]);
  assert.equal(await page.locator('[data-marble-dragging]').count(), 0);
  let rules = [];
  for (let i = 0; i < 40; i += 1) { rules = await rulesInFile(); if (rules.length === 1 && /32px/.test(rules[0].text)) break; await page.waitForTimeout(100); }
  assert.doesNotMatch(await file(), /transition: none|!important/);
  assert.deepEqual(await radii(page), ['32px', '32px', '32px', '32px', '12px']);
});

test('a rule from words steps round the drive\'s chrome too, even chrome that comes later', async () => {
  const page = await open();
  await intentRule(page, { selector: 'div.card', declarations: { 'border-radius': '24px' }, unit: 'cards', verb: 'Rounding' });
  await say(page, 'round the corners');
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1, null, { timeout: 5000 });
  assert.match(await page.evaluate(() => document.querySelector('style[data-marble-rule]').textContent), /:not\(\[data-marble-transient\], \[data-marble-transient\] \*\)/);
  const later = await page.evaluate(() => {
    const chrome = document.createElement('div');
    chrome.className = 'card';
    chrome.setAttribute('data-marble-transient', '');
    document.body.append(chrome);
    return getComputedStyle(chrome).borderTopLeftRadius;
  });
  assert.equal(later, '12px');
});

test('on a touch screen Reshape is in the chat button\'s menu', async () => {
  const page = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const row = page.locator('marble-agent-drawer .tool[data-tool="reshape"]');
  await row.waitFor({ state: 'attached' });
  assert.notEqual(await row.evaluate((el) => getComputedStyle(el).display), 'none');
  assert.equal(await row.evaluate((el) => el.hidden), false);
});

test('with only the keys: Tab walks the parts, then a part\'s dot; arrows move every card like it; Enter files it', async () => {
  const page = await open();
  await page.evaluate(() => { document.activeElement?.blur?.(); window.marbleRules.reshape(true); });
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('marble-rules-ring')), 'a ring on the first part');
  assert.equal(await page.evaluate(() => window.marbleRules.part?.dataset.marbleId), 'c1');
  // The arrows walk the parts; the ring follows.
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => window.marbleRules.part?.dataset.marbleId), 'c2');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => window.marbleRules.part?.dataset.marbleId), 'c1');
  assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid', 'a ring that is seen');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.grip), 'corner');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await radii(page), ['14px', '14px', '14px', '14px', '12px']);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  // On past the bar: the next part's ring.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('marble-rules-ring') && window.marbleRules.part?.dataset.marbleId), 'c2');
});

test('a selector that only parses because the page closes it, a rule every part outvotes, and a leading html all hold up or go to the agent', async () => {
  const page = await open({ doc: 'inline' });
  // Unclosed: querySelectorAll closes it; a sheet does not.
  await intentRule(page, { selector: 'div.card[data-marble-id^="c"', declarations: { 'border-radius': '24px' }, unit: 'cards', verb: 'Rounding' });
  await say(page, 'round the corners');
  for (let i = 0; i < 60 && !(await turnsAsked()).length; i += 1) await page.waitForTimeout(100);
  assert.deepEqual(await turnsAsked(), ['round the corners'], 'a dead rule went to the agent');
  assert.equal(await page.locator('style[data-marble-rule]').count(), 0);
  assert.equal(await page.evaluate(() => window.__records.length), 0);
  // A leading html is the page's own root: read without it.
  assert.equal((await page.evaluate(() => window.marbleRules.check({ selector: 'html div.card', declarations: { 'border-radius': '20px' } }, [])))?.targets, 4);
  assert.equal((await page.evaluate(() => window.marbleRules.check({ selector: ':root .cards > div.card', declarations: { 'border-radius': '20px' } }, [])))?.targets, 4);
});

test('a rule from words that every part it reaches outvotes is no rule: the agent is asked', async () => {
  const page = await open({ doc: 'inline' });
  await intentRule(page, { selector: '.cards > [data-marble-id="c2"]', declarations: { 'border-radius': '24px' }, unit: 'cards', verb: 'Rounding' });
  await say(page, 'round the corners');
  for (let i = 0; i < 60 && !(await turnsAsked()).length; i += 1) await page.waitForTimeout(100);
  assert.deepEqual(await turnsAsked(), ['round the corners']);
  assert.equal(await page.locator('style[data-marble-rule]').count(), 0);
  assert.equal(await page.locator('[data-marble-id="c2"]').getAttribute('style'), 'border-radius: 8px');
  assert.equal(await page.evaluate(() => window.__records.length), 0);
});

test('the tag\'s verb comes from what the rule sets, never from the model', async () => {
  const page = await open();
  await intentRule(page, { selector: 'div.card', declarations: { 'border-radius': '4px' }, unit: 'cards', verb: 'Thinking' });
  await say(page, 'square the corners');
  await tagSays(page, /^Squaring 4 cards$/);
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1, null, { timeout: 5000 });
  await tagSays(page, /^4 cards squared$/);
});

test('the words wait in the line\'s drafts until the rule has landed', async () => {
  const page = await open();
  await intentRule(page, { selector: 'div.card', declarations: { 'border-radius': '24px' }, unit: 'cards', verb: 'Rounding' }, { delay: 1200 });
  await say(page, 'round the corners');
  await page.waitForTimeout(300);
  const drafts = () => page.evaluate(() => Object.entries(sessionStorage).filter(([k]) => k.startsWith('marble-line-drafts:')).map(([, v]) => v).join(''));
  assert.match(await drafts(), /round the corners/, 'kept while the page reads them');
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1, null, { timeout: 5000 });
  for (let i = 0; i < 30 && /round the corners/.test(await drafts()); i += 1) await page.waitForTimeout(100);
  assert.doesNotMatch(await drafts(), /round the corners/, 'and let go once they are the page');
});

test('after a change lands, a press on a card is the page\'s again', async () => {
  const page = await open();
  await page.evaluate(() => {
    window.__pressed = 0;
    document.querySelector('[data-marble-id="c3"]').addEventListener('click', () => { window.__pressed += 1; });
  });
  const dot = await grab(page);
  await dragBy(page, dot, 6, 6);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('style[data-marble-rule]').length === 1);
  const c3 = center(await box(page, 'c3'));
  await page.mouse.click(c3.x, c3.y);
  assert.equal(await page.evaluate(() => window.__pressed), 1);
  assert.equal(await page.locator('.marble-change-tint[data-state="out"]').count(), 0);
});

test('words that sound like a look, plural or compared, are tried as one rule first; others go straight to the agent', async () => {
  const page = await open();
  const asked = [];
  await page.route('**/agent/change-intent', async (route) => {
    asked.push(JSON.parse(route.request().postData()).words);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"rule":null}' });
  });
  const looks = ['fix the corners', 'thicker borders', 'make them squarer', 'rounder cards', 'more spacing out', 'bigger margins'];
  for (const words of [...looks, 'add a row for Potluck']) {
    await say(page, words);
    for (let i = 0; i < 40 && !(await turnsAsked()).includes(words); i += 1) await page.waitForTimeout(100);
  }
  assert.deepEqual(asked, looks);
});

test('a hand\'s change that no rule would reach lands on the part\'s own style, with no dead rule filed', async () => {
  const page = await open({ doc: 'inline' });
  await page.evaluate(() => window.marbleRules.reshape(true));
  const card = await box(page, 'c2');
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await corner(page).waitFor();
  const dot = center(await corner(page).boundingBox());
  await page.mouse.move(dot.x, dot.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.keyboard.up('Shift');
  for (let i = 1; i <= 4; i += 1) await page.mouse.move(dot.x + 2 * i, dot.y + 2 * i);
  await page.mouse.up();
  await page.waitForFunction(() => window.__records.length === 1);
  assert.equal(await page.locator('style[data-marble-rule]').count(), 0, 'no rule that reaches nothing');
  assert.equal(await page.locator('[data-marble-id="c2"]').getAttribute('style'), 'border-radius: 16px');
  const [entry] = await page.evaluate(() => window.__records);
  assert.deepEqual(entry.redo.map((op) => op.type), ['setAttr']);
});
