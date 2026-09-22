// Marks: the tray's two tools for briefing an agent about a region — Select,
// a marquee over addressed elements, and Sketch, ink that is read as a box, an
// arrow or a scribble over them. What both have to get right is that they end
// where a text selection ends, so the callout's handle and the tray's Ask here
// are the one door out.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

// A page that carries its own conversation chrome mounts no drawer, so there
// is no tray — and these tools are only reachable from one.
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

const open = async (doc = 'garden', { width = 1200, height = 800 } = {}) => {
  await closePages();
  await host.reset();
  const { page } = await host.newPage();
  pages.push(page);
  await page.setViewportSize({ width, height });
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  return page;
};

const launcher = (page) => page.locator('marble-agent-drawer .launcher');
const tool = (page, id) => page.locator(`marble-agent-drawer .tool[data-tool="${id}"]`);
const layer = (page) => page.locator('.marble-marks-layer');
const selection = (page) => page.evaluate(() => window.marble.agent.context().selection);
const boxOf = (page, id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();
// The tray closes on a click, and a closed tray takes no pointer, so every
// reach for a tool starts at the launcher.
const pick = async (page, id) => {
  await launcher(page).hover();
  await tool(page, id).click();
};
const enter = async (page, name) => {
  await pick(page, `marks-${name}`);
  await page.locator(`.marble-marks-layer[data-mode="${name}"]`).waitFor();
};
const stroke = async (page, points) => {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.mouse.up();
};

test('the tools are in the tray, and a page with no tray has no tools and no layer', async () => {
  const page = await open();
  await layer(page).waitFor({ state: 'attached' });
  assert.equal(await layer(page).evaluate((el) => el.hasAttribute('data-marble-transient')), true);
  await launcher(page).hover();
  await tool(page, 'marks-select').waitFor({ state: 'visible' });
  assert.equal(await tool(page, 'marks-select').getAttribute('aria-label'), 'Select an area');
  assert.equal(await tool(page, 'marks-sketch').getAttribute('aria-label'), 'Sketch');
  assert.equal(await tool(page, 'marks-clear').isVisible(), false, 'nothing to clear yet');

  const custom = await open('custom');
  await custom.waitForTimeout(300);
  assert.equal(await layer(custom).count(), 0, 'no tray, so the layer stands down rather than draw its own affordance');
});

test('Select outlines what the rectangle means, hands the list to the callout, and leaves the mode', async () => {
  const page = await open();
  await enter(page, 'select');
  assert.equal(await tool(page, 'marks-select').getAttribute('aria-pressed'), 'true');
  const q = await boxOf(page, 'q');
  await page.mouse.move(q.x - 6, q.y - 6);
  await page.mouse.down();
  await page.mouse.move(q.x + q.width + 6, q.y + q.height / 2, { steps: 6 });
  await page.locator('.marble-marks-marquee:not([hidden])').waitFor();
  // Half way down the list only the first item is covered.
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-hit:not([hidden])').length === 1);
  await page.mouse.move(q.x + q.width + 6, q.y + q.height + 6, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q"]');
  // The mode ends with the release, and the callout's handle takes over.
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').dataset.mode === '');
  await page.locator('.marble-callout-handle:not([hidden])').waitFor();
  assert.equal(await page.locator('.marble-marks-marquee:not([hidden])').count(), 0);
});

test('a marquee that grazes an element selects nothing, and Escape clears what one left standing', async () => {
  const page = await open();
  const p = await boxOf(page, 'p');
  await enter(page, 'select');
  await stroke(page, [{ x: p.x - 6, y: p.y + p.height - 3 }, { x: p.x + p.width + 6, y: p.y + p.height + 3 }]);
  await page.waitForTimeout(100);
  assert.deepEqual(await selection(page), []);

  await enter(page, 'select');
  await stroke(page, [{ x: p.x - 6, y: p.y - 6 }, { x: p.x + p.width + 6, y: p.y + p.height + 6 }]);
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["p"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 0);
});

test('the tray is reachable inside a mode — the overlay has a hole in it — and Escape gets out', async () => {
  const page = await open();
  await enter(page, 'sketch');
  assert.equal(await tool(page, 'marks-sketch').getAttribute('aria-pressed'), 'true');
  // The overlay is in the top layer and the tray is not. Without the hole the
  // one piece of chrome that ends a mode would be under it.
  const hit = await page.evaluate(() => {
    const l = document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.launcher');
    const b = l.getBoundingClientRect();
    return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.tagName?.toLowerCase() ?? null;
  });
  assert.equal(hit, 'marble-agent-drawer');
  // And the middle of the page is the overlay's, which is what a mode means.
  const middle = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.className ?? '');
  assert.equal(middle, 'marble-marks-overlay');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').dataset.mode === '');
  assert.equal(await page.locator('.marble-marks-overlay:not([hidden])').count(), 0);
  assert.equal(await tool(page, 'marks-sketch').getAttribute('aria-pressed'), 'false');
});

test('a box sketched round the list selects the list and reads as a box around it', async () => {
  const page = await open();
  await enter(page, 'sketch');
  const q = await boxOf(page, 'q');
  const left = q.x - 10;
  const right = q.x + q.width + 10;
  const top = q.y - 8;
  const bottom = q.y + q.height + 8;
  await stroke(page, [
    { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom },
    { x: left, y: bottom }, { x: left, y: top + 2 },
  ]);
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q"]');
  assert.equal(await page.locator('.marble-marks-stroke').count(), 1, 'the hand\'s own stroke, never redrawn as a shape');
  // The reading, in words, under the pointer that drew it.
  await page.mouse.move(left, (top + bottom) / 2);
  await page.locator('.marble-marks-caption:not([hidden])').waitFor();
  assert.equal(await page.locator('.marble-marks-caption').textContent(), 'a box around q');
  // The mode is sticky: a sketch is usually several strokes.
  assert.equal(await layer(page).evaluate((el) => el.dataset.mode), 'sketch');
});

test('the sketch goes out through Ask here, with its reading written into the card as a draft', async () => {
  const page = await open();
  await enter(page, 'sketch');
  const q1 = await boxOf(page, 'q1');
  await stroke(page, [
    { x: q1.x - 8, y: q1.y - 6 }, { x: q1.x + q1.width + 8, y: q1.y - 6 },
    { x: q1.x + q1.width + 8, y: q1.y + q1.height + 6 }, { x: q1.x - 8, y: q1.y + q1.height + 6 },
    { x: q1.x - 8, y: q1.y - 4 },
  ]);
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q1"]');
  await page.keyboard.press('Escape');
  // Ask here is the drawer's own tool; what it says while there is a sketch to
  // send is the marks layer's business.
  await launcher(page).hover();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').shadowRoot
    .querySelector('.tool[data-tool="ask"]')?.getAttribute('aria-label') === 'Ask about the sketch');
  await tool(page, 'ask').click();
  const editor = page.locator('.marble-callout marble-conversation .editor');
  await editor.waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector('.marble-callout marble-conversation')?.shadowRoot?.querySelector('.editor');
    return el?.textContent?.startsWith('I marked up the page: a box around q1.');
  }, null, { timeout: 5000 });
  // The person's to edit, with the caret left after it: typing carries on
  // where the reading stopped rather than replacing it.
  await page.keyboard.type(' Make these two lines one.');
  const text = await editor.textContent();
  assert.ok(text.startsWith('I marked up the page: a box around q1.'), text);
  assert.ok(text.trimEnd().endsWith('Make these two lines one.'), text);
});

test('Clear takes the ink and the selection with it, and ⌘Z takes back the last stroke', async () => {
  const page = await open();
  await enter(page, 'sketch');
  const h = await boxOf(page, 'h');
  const p = await boxOf(page, 'p');
  await stroke(page, [
    { x: h.x - 6, y: h.y - 6 }, { x: h.x + h.width + 6, y: h.y - 6 },
    { x: h.x + h.width + 6, y: h.y + h.height + 6 }, { x: h.x - 6, y: h.y + h.height + 6 },
    { x: h.x - 6, y: h.y - 4 },
  ]);
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["h"]');
  await stroke(page, [
    { x: p.x - 6, y: p.y - 6 }, { x: p.x + p.width + 6, y: p.y - 6 },
    { x: p.x + p.width + 6, y: p.y + p.height + 6 }, { x: p.x - 6, y: p.y + p.height + 6 },
    { x: p.x - 6, y: p.y - 4 },
  ]);
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["h","p"]');
  assert.equal(await page.locator('.marble-marks-stroke').count(), 2);

  await page.keyboard.press('Meta+z');
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["h"]');
  assert.equal(await page.locator('.marble-marks-stroke').count(), 1);

  await page.keyboard.press('Escape');
  await pick(page, 'marks-clear');
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-stroke').length === 0);
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 0);
  await launcher(page).hover();
  assert.equal(await tool(page, 'marks-clear').isVisible(), false, 'nothing left to clear');
});

test('ink follows the element it was drawn on when the page scrolls under it', async () => {
  const page = await open();
  await page.evaluate(() => { document.body.style.paddingBottom = '2000px'; });
  await enter(page, 'sketch');
  const q1 = await boxOf(page, 'q1');
  await stroke(page, [
    { x: q1.x - 8, y: q1.y - 6 }, { x: q1.x + q1.width + 8, y: q1.y - 6 },
    { x: q1.x + q1.width + 8, y: q1.y + q1.height + 6 }, { x: q1.x - 8, y: q1.y + q1.height + 6 },
    { x: q1.x - 8, y: q1.y - 4 },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-stroke').length === 1);
  const before = await page.locator('.marble-marks-stroke').boundingBox();
  // A mark is an anchor and fractions of its box, never a pixel: the element
  // moving under the window is the stroke moving with it.
  await page.evaluate(() => scrollTo(0, 80));
  await page.waitForFunction(() => scrollY >= 79);
  await page.waitForFunction((was) => {
    const ink = document.querySelector('.marble-marks-stroke').getBoundingClientRect();
    const el = document.querySelector('[data-marble-id="q1"]').getBoundingClientRect();
    return Math.abs(ink.top - (was - 80)) < 4 && Math.abs((ink.top + 6) - el.top) < 12;
  }, before.y, { timeout: 5000 });
});
