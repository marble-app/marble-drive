// Describe mode: the toolbar of tools for saying what you want about a
// document, the frame that wraps what you meant, and the card on it. What it
// has to get right is that everything still ends where a text selection ends —
// one selection, one callout, one conversation.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

// A page that carries its own conversation chrome mounts no drawer, so there
// is no tray — and Describe mode is only reachable from one.
const CUSTOM = `<!doctype html>
<html><head><meta charset="utf-8"><title>Custom</title>
<meta name="marble-agent" content="custom">
<style>body { font: 16px/1.5 Georgia, serif; margin: 40px; }</style>
</head>
<body data-marble-id="b">
  <p data-marble-id="p">A paragraph an agent is on.</p>
</body></html>
`;

const host = await startDrive({ documents: { garden: GARDEN, custom: CUSTOM } });
test.after(() => host.close());

const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

// A reset drive keeps its conversations, and the callout rebuilds a card for
// every unreviewed chat about the document — so one test's brief would hang
// over the next test's page. Stop and file them between tests.
const clearConversations = async () => {
  const list = await (await fetch(`${host.base}/agent/conversations`)).json();
  for (const summary of list) {
    if (summary.status === 'running' || summary.queued) {
      const detail = await (await fetch(`${host.base}/agent/conversations/${summary.id}`)).json();
      for (const turn of detail.turns ?? []) {
        if (turn.status === 'running') await fetch(`${host.base}/agent/turns/${turn.id}/cancel`, { method: 'POST' });
        if (turn.status === 'queued') await fetch(`${host.base}/agent/turns/${turn.id}`, { method: 'DELETE' });
      }
    }
    await fetch(`${host.base}/agent/conversations/${summary.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
  }
};

const open = async (doc = 'garden', { width = 1200, height = 800 } = {}) => {
  await closePages();
  await clearConversations();
  await host.reset();
  const { page } = await host.newPage();
  pages.push(page);
  await page.setViewportSize({ width, height });
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  return page;
};

const launcher = (page) => page.locator('marble-agent-drawer .launcher');
const trayTool = (page, id) => page.locator(`marble-agent-drawer .tool[data-tool="${id}"]`);
const layer = (page) => page.locator('.marble-marks-layer');
const bar = (page) => page.locator('.marble-marks-bar');
const tool = (page, id) => page.locator(`.marble-marks-tool[data-tool="${id}"]`);
const frame = (page) => page.locator('.marble-marks-frame');
// The composer on the marks is a callout card, borrowed: the same component
// as every other chat on the page, never a second one of the mode's own.
const field = (page) => page.locator('.marble-callout');
const brief = (page) => page.locator('.marble-callout-status');
const selection = (page) => page.evaluate(() => window.marble.agent.context().selection);
const boxOf = (page, id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();

const describe = async (page) => {
  await launcher(page).hover();
  await trayTool(page, 'marks-describe').click();
  await bar(page).waitFor();
};
const use = async (page, name) => {
  await tool(page, name).click();
  await page.locator(`.marble-marks-layer[data-mode="${name}"]`).waitFor();
};
const stroke = async (page, points) => {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.mouse.up();
};
// A brief handed over by the field waits for the card to find out which agents
// exist before it can send, so the turn lands a beat after the click.
const knownChats = (page) => page.evaluate(async () => (await window.marble.agent.conversations()).map((c) => c.id));
// The host keeps its conversations across a reset, so a turn is only this
// test's if the chat holding it was not there before the click.
const newTurn = async (page, known = []) => {
  for (let i = 0; i < 60; i += 1) {
    const turn = await page.evaluate(async (before) => {
      const fresh = (await window.marble.agent.conversations()).filter((c) => !before.includes(c.id));
      for (const summary of fresh) {
        const detail = await window.marble.agent.conversation(summary.id);
        if (detail?.turns?.length) return detail.turns[0];
      }
      return null;
    }, known);
    if (turn) return turn;
    await page.waitForTimeout(250);
  }
  throw new Error('no turn ever arrived');
};
const boxAround = (box, pad = 8) => [
  { x: box.x - pad, y: box.y - pad },
  { x: box.x + box.width + pad, y: box.y - pad },
  { x: box.x + box.width + pad, y: box.y + box.height + pad },
  { x: box.x - pad, y: box.y + box.height + pad },
  { x: box.x - pad, y: box.y - pad + 2 },
];

test('the tray holds one entry, and a page with no tray has no layer at all', async () => {
  const page = await open();
  await layer(page).waitFor({ state: 'attached' });
  await launcher(page).hover();
  await trayTool(page, 'marks-describe').waitFor({ state: 'visible' });
  assert.equal(await trayTool(page, 'marks-describe').getAttribute('aria-label'), 'Describe a change');
  assert.equal(await trayTool(page, 'marks-select').count(), 0, 'the modal tools are not in two homes');
  assert.equal(await bar(page).isVisible(), false, 'no toolbar until you ask for one');

  const custom = await open('custom');
  await custom.waitForTimeout(300);
  assert.equal(await layer(custom).count(), 0, 'no tray, so the layer stands down rather than draw its own affordance');
});

test('Describe opens the toolbar on the picker; Escape drops the tool, then the mode', async () => {
  const page = await open();
  await describe(page);
  await page.locator('.marble-marks-layer[data-mode="select"]').waitFor();
  assert.equal(await tool(page, 'select').getAttribute('aria-pressed'), 'true');
  for (const id of ['sketch', 'text', 'explore', 'done']) {
    assert.equal(await tool(page, id).isVisible(), true, id);
  }
  assert.equal(await tool(page, 'explore').isDisabled(), true, 'nothing selected to explore yet');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').dataset.mode === '');
  assert.equal(await bar(page).isVisible(), true, 'the toolbar is still there; only the tool went');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.marble-marks-layer').hasAttribute('data-describing'));

  // And Done is the same door.
  await describe(page);
  await tool(page, 'done').click();
  await page.waitForFunction(() => !document.querySelector('.marble-marks-layer').hasAttribute('data-describing'));
});

test('leaving the mode takes the marks off the page and brings them back, keeping every one', async () => {
  const page = await open();
  await describe(page);
  await use(page, 'sketch');
  const q = await boxOf(page, 'q');
  await stroke(page, boxAround(q));
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-stroke').length === 1);
  await use(page, 'text');
  const p = await boxOf(page, 'p');
  await page.mouse.click(p.x + 40, p.y + 4);
  await page.locator('.marble-marks-note-body').waitFor();
  await page.keyboard.type('shorter');
  await page.waitForFunction(() => document.querySelector('.marble-callout-status')?.textContent.includes('a note on p'));

  // Out: a fade, not a blink, and nothing thrown away.
  await tool(page, 'done').click();
  const fading = await layer(page).evaluate((el) => el.getAnimations()
    .flatMap((a) => a.effect.getKeyframes())
    .flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))));
  assert.ok(fading.includes('opacity'), `the layer fades out, got ${fading.join(', ') || 'nothing'}`);

  await page.waitForFunction(() => getComputedStyle(document.querySelector('.marble-marks-layer')).visibility === 'hidden');
  assert.equal(await page.locator('.marble-marks-stroke').count(), 1, 'the ink is still there, only out of sight');
  assert.equal(await page.locator('.marble-marks-note').count(), 1);
  // And out of reach while it is out of sight: no caret, no tab stop.
  assert.equal(await page.locator('.marble-marks-note-body').isVisible(), false);
  assert.equal(await field(page).isVisible(), false);
  assert.equal(await bar(page).isVisible(), false);
  // Including the one piece of it that lives in another layer: the callout's
  // handle, which would otherwise hang at a selection nobody can see.
  assert.deepEqual(await selection(page), []);
  assert.equal(await page.locator('.marble-callout-handle:not([hidden])').count(), 0);

  // The way back says the work is still in hand.
  await launcher(page).hover();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').shadowRoot
    .querySelector('.tool[data-tool="marks-describe"]')?.getAttribute('aria-label') === 'Describe · 2 kept');

  // In: the same marks, the same brief.
  await trayTool(page, 'marks-describe').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.marble-marks-layer')).visibility === 'visible');
  await page.waitForFunction(() => {
    const said = document.querySelector('.marble-callout-status')?.textContent ?? '';
    return said.includes('a box around q') && said.includes('a note on p: "shorter"');
  });
  assert.equal(await page.locator('.marble-marks-stroke').count(), 1);
  assert.equal(await page.locator('.marble-marks-note-body').textContent(), 'shorter');
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q","p"]');
});

test('a marquee wraps what it means in one frame and hangs the card on it', async () => {
  const page = await open();
  await describe(page);
  const q = await boxOf(page, 'q');
  await page.mouse.move(q.x - 6, q.y - 6);
  await page.mouse.down();
  await page.mouse.move(q.x + q.width + 6, q.y + q.height / 2, { steps: 6 });
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-hit:not([hidden])').length === 1);
  await page.mouse.move(q.x + q.width + 6, q.y + q.height + 6, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q"]');

  await frame(page).waitFor();
  await field(page).waitFor();
  assert.equal(await brief(page).textContent(), '1 element');
  // The frame is around the list, not around the window.
  const [f, list] = await Promise.all([frame(page).boundingBox(), boxOf(page, 'q')]);
  assert.ok(f.x <= list.x && f.y <= list.y, `frame ${JSON.stringify(f)} does not contain ${JSON.stringify(list)}`);
  assert.ok(f.x + f.width >= list.x + list.width - 1 && f.width < list.width + 40);
  // And the field hangs under it.
  const input = await field(page).boundingBox();
  assert.ok(input.y > f.y + f.height - 2, 'the field is below the frame');
});

test('a region too tall to sit under keeps its card at the marks, never on the toolbar', async () => {
  const page = await open();
  // A box around most of a page has no room under it, which is how the field
  // used to end up parked at the bottom of the window — on the toolbar, and
  // nowhere near the thing it was about.
  await page.evaluate(() => {
    document.querySelector('[data-marble-id="q"]').style.minHeight = '620px';
  });
  await describe(page);
  await use(page, 'sketch');
  const q = await boxOf(page, 'q');
  await stroke(page, boxAround(q, 6));
  await field(page).waitFor();

  const [box, toolbar, frameBox] = await Promise.all([
    field(page).boundingBox(),
    bar(page).boundingBox(),
    frame(page).boundingBox(),
  ]);
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  assert.equal(overlaps(box, toolbar), false, `field ${JSON.stringify(box)} is on the toolbar ${JSON.stringify(toolbar)}`);

  // And it is against the marks — over, under, beside, or inside them — rather
  // than in a corner of the window.
  const dx = Math.max(frameBox.x - (box.x + box.width), box.x - (frameBox.x + frameBox.width), 0);
  const dy = Math.max(frameBox.y - (box.y + box.height), box.y - (frameBox.y + frameBox.height), 0);
  assert.ok(Math.hypot(dx, dy) <= 16, `field is ${Math.round(Math.hypot(dx, dy))}px from the marks`);
});

test('a sketch says what it read in the brief line, and Select picks the ink back up', async () => {
  const page = await open();
  await describe(page);
  await use(page, 'sketch');
  const q = await boxOf(page, 'q');
  await stroke(page, boxAround(q));
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q"]');
  await page.waitForFunction(() => document.querySelector('.marble-callout-status')?.textContent.includes('a box around q'));
  assert.equal(await page.locator('.marble-marks-stroke').count(), 1, 'the hand\'s own stroke, never redrawn as a shape');

  // A marquee over the ink picks the mark itself — the things you drew are as
  // pointable as the things the document holds — and ⌫ takes it off.
  await use(page, 'select');
  await stroke(page, [{ x: q.x - 30, y: q.y - 30 }, { x: q.x + q.width + 30, y: q.y + q.height + 30 }]);
  await page.locator('.marble-marks-halo:not([hidden])').waitFor();
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-stroke').length === 0);
});

test('Note puts a text box on the page, and what is typed in it is part of the brief', async () => {
  const page = await open();
  await describe(page);
  await use(page, 'text');
  const p = await boxOf(page, 'p');
  await page.mouse.click(p.x + 40, p.y + 4);
  const body = page.locator('.marble-marks-note-body');
  await body.waitFor();
  await page.keyboard.type('make this the headline');
  await page.waitForFunction(() => document.querySelector('.marble-callout-status')?.textContent.includes('a note on p: "make this the headline"'));
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["p"]');

  // A note dragged by its grip keeps its place on the element it was put on.
  const before = await page.locator('.marble-marks-note').boundingBox();
  const grip = await page.locator('.marble-marks-note-grip').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + grip.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  const after = await page.locator('.marble-marks-note').boundingBox();
  assert.ok(Math.abs(after.x - before.x - 60) < 6 && Math.abs(after.y - before.y - 30) < 6, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

  // An empty note is a slip of the hand, not a mark.
  await page.mouse.click(p.x + 200, p.y + 4);
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-note').length === 2);
  await page.locator('.marble-callout marble-conversation .editor').click();
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-note').length === 1);
});

test('the card sends with the marks in front of the sentence, and the mode steps back', async () => {
  const page = await open();
  await describe(page);
  await use(page, 'sketch');
  const q1 = await boxOf(page, 'q1');
  await stroke(page, boxAround(q1));
  await page.waitForFunction(() => document.querySelector('.marble-callout-status')?.textContent.includes('a box around q1'));

  await page.locator('.marble-callout marble-conversation .editor').click();
  await page.keyboard.type('make these one line');
  const before = await knownChats(page);
  await page.locator('.marble-callout marble-conversation .send').click();

  await page.locator('.marble-callout marble-conversation .editor').waitFor();
  // Sent, not just drafted: the card is the one that answers.
  const turn = await newTurn(page, before);
  assert.ok(turn.prompt.startsWith('I marked up the page: a box around q1.'), turn.prompt);
  assert.ok(turn.prompt.endsWith('make these one line'), turn.prompt);
  assert.deepEqual(turn.context.selection, ['q1'], 'the turn carries what was marked');
  // Sent is the end of describing: the mode steps back and the page is yours
  // to read again — but what was marked stays up while the agent works from
  // it, in the sheet the mode's fade does not reach.
  await page.waitForFunction(() => !document.querySelector('.marble-marks-layer').hasAttribute('data-describing'));
  await page.waitForFunction(() => document.querySelector('.marble-marks-held .marble-marks-stroke')?.dataset.state === 'working');
  assert.equal(await page.locator('.marble-marks-held .marble-marks-stroke').isVisible(), true, 'the marks show while the work goes on');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.marble-marks-bar')).visibility === 'hidden');
  // The card is the ordinary callout on the work now, and there is only one.
  assert.equal(await page.locator('.marble-callout').count(), 1);
  assert.equal(await page.locator('.marble-callout').isVisible(), true);

  // Putting the callout away is putting the brief away: the marks go back to
  // being kept marks, out of sight outside the mode.
  const done = page.locator('.marble-callout-actions button', { hasText: 'Done' });
  await done.waitFor({ timeout: 20000 });
  await done.click();
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer .marble-marks-stroke')?.dataset.state === 'sent');
  assert.equal(await page.locator('.marble-marks-stroke').isVisible(), false);
});

test('one composer: Describe mode hangs the callout card on the marks, never a field of its own', async () => {
  const page = await open();
  await describe(page);
  const q = await boxOf(page, 'q');
  await stroke(page, [{ x: q.x - 6, y: q.y - 6 }, { x: q.x + q.width + 6, y: q.y + q.height + 6 }]);
  await field(page).waitFor();
  // Leave the tool: this is when the callout's own handle used to come back
  // and summon a second card on top of the first.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.marble-callout').count(), 1, 'one card');
  assert.equal(await page.locator('.marble-callout-handle:not([hidden])').count(), 0, 'no handle for a second one');
  assert.equal(await page.locator('.marble-marks-field').count(), 0, 'no composer of the mode\'s own');
  // ⌘J means this card, too.
  await page.keyboard.press('ControlOrMeta+j');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.marble-callout').count(), 1);
  // The card has the full chat composer: the model picker comes with it.
  assert.equal(await page.locator('.marble-callout marble-conversation .editor').isVisible(), true);

  // Out of the mode it goes with the marks, and comes back with them.
  await tool(page, 'done').click();
  await page.waitForFunction(() => document.querySelector('.marble-callout')?.hidden === true);
  await launcher(page).hover();
  await trayTool(page, 'marks-describe').click();
  await page.waitForFunction(() => document.querySelector('.marble-callout')?.hidden === false);
});

test('with a tool on, the pinned chat panel and the card are still the app\'s to click', async () => {
  const page = await open();
  await launcher(page).click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  await page.locator('marble-agent-drawer .pin').click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.panel')?.dataset.pinned === 'true');
  await describe(page);
  await page.locator('.marble-marks-layer[data-mode="select"]').waitFor();

  // Into the panel's own composer, with Select still on.
  const editor = page.locator('marble-agent-drawer marble-conversation .editor').first();
  await editor.click();
  await page.keyboard.type('still reachable');
  assert.equal((await editor.textContent()).includes('still reachable'), true);
  assert.equal(await page.locator('.marble-marks-layer').getAttribute('data-mode'), 'select', 'the tool is still on');

  // And into the card hung on the marks.
  const q = await boxOf(page, 'q');
  await stroke(page, [{ x: q.x - 6, y: q.y - 6 }, { x: q.x + q.width + 6, y: q.y + q.height + 6 }]);
  const card = page.locator('.marble-callout marble-conversation .editor');
  await card.waitFor();
  await card.click();
  await page.keyboard.type('ok');
  assert.equal((await card.textContent()).includes('ok'), true);
  // ⌫ in the card is the card's, not a mark being taken off the page.
  await page.keyboard.press('Backspace');
  assert.equal(await page.evaluate(() => JSON.stringify(window.marble.agent.context().selection)), '["q"]');
});

test('Explore asks for variations in the document\'s own words, and says what it wants and why', async () => {
  const page = await open();
  await describe(page);
  const q = await boxOf(page, 'q');
  await stroke(page, [{ x: q.x - 6, y: q.y - 6 }, { x: q.x + q.width + 6, y: q.y + q.height + 6 }]);
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q"]');
  await page.waitForFunction(() => !document.querySelector('.marble-marks-tool[data-tool="explore"]').disabled);

  await tool(page, 'explore').click();
  await page.locator('.marble-marks-explore:not([hidden])').waitFor();
  const asks = page.locator('.marble-marks-ask');
  await asks.first().click();
  await page.keyboard.type('shorter lines');
  await asks.nth(1).click();
  await page.keyboard.type('the list is the first thing read');
  await page.locator('.marble-marks-count[aria-pressed="false"]').first().click();
  const before = await knownChats(page);
  await page.locator('.marble-marks-go').click();

  const { prompt } = await newTurn(page, before);
  assert.ok(prompt.startsWith('Explore 5 variations of q'), prompt.slice(0, 80));
  assert.ok(prompt.includes('What to try: shorter lines'), prompt);
  assert.ok(prompt.includes('Why: the list is the first thing read'), prompt);
  assert.ok(prompt.includes('<marble-alt>'), 'the ask is in the format the document has for this');
});
