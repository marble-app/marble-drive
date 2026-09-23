// Adjust: the direct-manipulation tool in Describe mode. What it has to get
// right is that it invents no permission — it asks the vocabulary what the
// element allows and files the op that answer names, and where a document
// declares nothing it says so and offers to write the declaration.
import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const BOARD = `<!doctype html>
<html><head><meta charset="utf-8"><title>Board</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 30px; }
  ul { list-style: none; padding: 0; display: grid; gap: 6px; width: 380px; }
  li { border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; }
  .side { border: 1px solid #ccd; border-radius: 10px; padding: 10px; box-sizing: border-box; }
  .board { position: relative; height: 140px; border: 1px dashed #ccc; margin-top: 12px; }
  .chip { position: absolute; padding: 4px 8px; border-radius: 6px; background: #eef; }
</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Board</h1>

  <ul data-marble-id="declared" data-marble-sortable="cards">
    <li data-marble-id="d1">Declared one</li>
    <li data-marble-id="d2">Declared two</li>
    <li data-marble-id="d3">Declared three</li>
  </ul>

  <ul data-marble-id="plain">
    <li data-marble-id="p1">Plain one</li>
    <li data-marble-id="p2">Plain two</li>
  </ul>

  <aside class="side" data-marble-id="side" data-marble-resizable="wh" style="width:200px;height:80px">
    <p data-marble-id="sidep">A pane that says it can be pulled.</p>
  </aside>

  <div class="board" data-marble-id="canvas" data-marble-canvas>
    <span class="chip" data-marble-id="chip" style="left:20px;top:20px">A chip</span>
  </div>
</body></html>
`;

const host = await startDrive({ documents: { board: BOARD } });
test.after(() => host.close());

const pages = [];
test.after(async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); });

const open = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
  await host.reset();
  const { page } = await host.newPage();
  pages.push(page);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${host.base}/a/board`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && globalThis.marbleVocabulary));
  await page.locator('marble-agent-drawer .launcher').hover();
  await page.locator('marble-agent-drawer .tool[data-tool="marks-describe"]').click();
  await page.locator('.marble-marks-bar').waitFor();
  await page.locator('.marble-marks-tool[data-tool="adjust"]').click();
  await page.locator('.marble-marks-layer[data-mode="adjust"]').waitFor();
  return page;
};

const boxOf = (page, id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();
const order = (page, list) => page.evaluate((id) => [...document.querySelector(`[data-marble-id="${id}"]`).children]
  .map((el) => el.getAttribute('data-marble-id')), list);
const says = (page) => page.locator('.marble-marks-says');
const brief = (page) => page.locator('.marble-callout-status');
const drag = async (page, from, to) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
};

test('the vocabulary reader is on the page, and it answers for the document not for the tool', async () => {
  const page = await open();
  const read = await page.evaluate(() => {
    const can = (id) => {
      const answer = globalThis.marbleVocabulary.affords(document.querySelector(`[data-marble-id="${id}"]`));
      return { move: answer.move?.kind ?? null, group: answer.move?.group ?? null, size: answer.size?.axes ?? null };
    };
    return { d1: can('d1'), p1: can('p1'), side: can('side'), chip: can('chip') };
  });
  assert.deepEqual(read.d1, { move: 'sortable', group: 'cards', size: null });
  assert.deepEqual(read.p1, { move: null, group: null, size: null }, 'a plain list declares nothing, and that is a true answer');
  assert.deepEqual(read.side, { move: null, group: null, size: 'wh' });
  assert.deepEqual(read.chip, { move: 'canvas', group: null, size: null });
});

test('Adjust outlines what is under the pointer and says what that element allows', async () => {
  const page = await open();
  const d1 = await boxOf(page, 'd1');
  await page.mouse.move(d1.x + 40, d1.y + d1.height / 2);
  await page.locator('.marble-marks-aim:not([hidden])').waitFor();
  await says(page).waitFor();
  assert.equal(await says(page).textContent(), 'd1 · reorder · resize (undeclared)', 'it names what it is aimed at: declared for order, undeclared for size');

  const chip = await boxOf(page, 'chip');
  await page.mouse.move(chip.x + 10, chip.y + chip.height / 2);
  await page.waitForFunction(() => document.querySelector('.marble-marks-says').textContent.startsWith('chip · move · resize'));
});

test('a drag in a declared list files the move the sortable would have filed', async () => {
  const page = await open();
  assert.deepEqual(await order(page, 'declared'), ['d1', 'd2', 'd3']);
  const d1 = await boxOf(page, 'd1');
  const d3 = await boxOf(page, 'd3');
  await page.mouse.move(d1.x + 40, d1.y + d1.height / 2);
  await page.locator('.marble-marks-aim:not([hidden])').waitFor();
  await drag(page,
    { x: d1.x + 40, y: d1.y + d1.height / 2 },
    { x: d3.x + 40, y: d3.y + d3.height - 2 });
  await page.waitForFunction(() => [...document.querySelector('[data-marble-id="declared"]').children]
    .map((el) => el.getAttribute('data-marble-id')).join() === 'd2,d3,d1');

  // It reached the file, and the brief says what the hand did.
  await page.waitForFunction(() => document.querySelector('.marble-callout-status')?.textContent.includes('moved d1 to the end of its list'));
  assert.equal(await page.locator('.marble-marks-declare').isVisible(), false, 'nothing to declare: the list already said so');
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble));
  assert.deepEqual(await order(page, 'declared'), ['d2', 'd3', 'd1'], 'the move is in the file');
});

test('a drag in a list that declares nothing still moves it, says so, and offers the vocabulary', async () => {
  const page = await open();
  const p1 = await boxOf(page, 'p1');
  const p2 = await boxOf(page, 'p2');
  await page.mouse.move(p1.x + 40, p1.y + p1.height / 2);
  await page.locator('.marble-marks-aim:not([hidden])').waitFor();
  await drag(page,
    { x: p1.x + 40, y: p1.y + p1.height / 2 },
    { x: p2.x + 40, y: p2.y + p2.height - 2 });
  await page.waitForFunction(() => [...document.querySelector('[data-marble-id="plain"]').children]
    .map((el) => el.getAttribute('data-marble-id')).join() === 'p2,p1');

  const declare = page.locator('.marble-marks-declare');
  await declare.waitFor();
  assert.equal(await declare.textContent(), 'Make this list sortable');
  await declare.click();
  await page.waitForFunction(() => document.querySelector('[data-marble-id="plain"]').getAttribute('data-marble-sortable') === 'plain');
  assert.equal(await declare.isVisible(), false, 'said once, and then it has nothing more to say');

  // And the reader now answers for it, which is the whole point of writing it.
  const after = await page.evaluate(() => globalThis.marbleVocabulary.affords(document.querySelector('[data-marble-id="p1"]')).move?.kind);
  assert.equal(after, 'sortable');
});

test('pulling the corner of a resizable pane writes one size into the file', async () => {
  const page = await open();
  const side = await boxOf(page, 'side');
  // The aside's own padding: a point two lines in would be the paragraph, and
  // the deepest addressed element under the pointer is the one being aimed at.
  await page.mouse.move(side.x + 5, side.y + 5);
  await page.waitForFunction(() => document.querySelector('.marble-marks-says')?.textContent.startsWith('side · '));
  await page.locator('.marble-marks-aim:not([hidden])').waitFor();
  const corner = await page.locator('.marble-marks-grab[data-edge="se"]').boundingBox();
  await drag(page,
    { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 },
    { x: corner.x + corner.width / 2 + 60, y: corner.y + corner.height / 2 + 30 });
  await page.waitForFunction(() => Math.round(document.querySelector('[data-marble-id="side"]').getBoundingClientRect().width) === 260);
  const style = await page.getAttribute('[data-marble-id="side"]', 'style');
  assert.equal(style, 'width:260px;height:110px', 'the declarations are composed, not read back off the browser');
  await page.waitForFunction(() => document.querySelector('.marble-callout-status')?.textContent.includes('sized side to 260×110'));

  // One op for the gesture: the carrier's undo puts the whole drag back.
  await page.evaluate(() => window.marble.undo());
  await page.waitForFunction(() => document.querySelector('[data-marble-id="side"]').getAttribute('style') === 'width:200px;height:80px');
});

test('what the hand did rides along in the brief when the card sends', async () => {
  const page = await open();
  const d1 = await boxOf(page, 'd1');
  const d2 = await boxOf(page, 'd2');
  await page.mouse.move(d1.x + 40, d1.y + d1.height / 2);
  await page.locator('.marble-marks-aim:not([hidden])').waitFor();
  await drag(page,
    { x: d1.x + 40, y: d1.y + d1.height / 2 },
    { x: d2.x + 40, y: d2.y + d2.height - 2 });
  await page.waitForFunction(() => document.querySelector('.marble-callout-status')?.textContent.includes('moved d1'));

  const before = await page.evaluate(async () => (await window.marble.agent.conversations()).map((c) => c.id));
  await page.locator('.marble-callout marble-conversation .editor').click();
  await page.keyboard.type('now do the same to the others');
  await page.locator('.marble-callout marble-conversation .send').click();
  let turn = null;
  for (let i = 0; i < 60 && !turn; i += 1) {
    turn = await page.evaluate(async (known) => {
      const fresh = (await window.marble.agent.conversations()).filter((c) => !known.includes(c.id));
      for (const summary of fresh) {
        const detail = await window.marble.agent.conversation(summary.id);
        if (detail?.turns?.length) return detail.turns[0];
      }
      return null;
    }, before);
    if (!turn) await page.waitForTimeout(250);
  }
  assert.ok(turn, 'the brief was sent');
  assert.ok(turn.prompt.includes('I already moved d1 above d3 by hand.'), turn.prompt);
  assert.ok(turn.prompt.endsWith('now do the same to the others'), turn.prompt);
  assert.deepEqual(turn.context.selection, ['d1']);
});
