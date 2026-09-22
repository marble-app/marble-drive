// A seeing loop for Describe mode. Not a test: the tray entry, the toolbar,
// the frame with its field, ink and a note on the page, the Explore ask, and
// the variations pill with the compare surface.
// `node tools/describe-shots.mjs [outdir]`
import fsp from 'node:fs/promises';
import path from 'node:path';

import { GARDEN, startDrive } from '../test-browser/harness.js';

const STUDIO = `<!doctype html>
<html><head><meta charset="utf-8"><title>Studio</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 40px; max-width: 760px; }
  .card { padding: 16px 18px; border: 1px solid #e3e3e6; border-radius: 14px; }
  .tight { padding: 7px 10px; }
  .loud { font-size: 21px; font-weight: 650; letter-spacing: -.01em; }
</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Studio</h1>
  <p data-marble-id="p">One element that might have been three.</p>
  <marble-alt data-marble-id="card" data-marble-active="v1">
    <div data-marble-id="c1" data-marble-alt="v1" data-why="the one that was here" class="card">A quiet card, the way it arrived</div>
    <div data-marble-id="c2" data-marble-alt="tight" data-why="less air around it" class="card tight">A tighter card</div>
    <div data-marble-id="c3" data-marble-alt="loud" data-why="reads first" class="card loud">A card that reads first</div>
  </marble-alt>
</body></html>
`;


const BOARD = `<!doctype html>
<html><head><meta charset="utf-8"><title>Board</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 34px; }
  ul { list-style: none; padding: 0; display: grid; gap: 8px; width: 420px; }
  li { border: 1px solid #e3e3e6; border-radius: 10px; padding: 10px 12px; }
  .side { border: 1px solid #dcdce4; border-radius: 12px; padding: 12px; box-sizing: border-box; margin-top: 14px; }
</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Board</h1>
  <ul data-marble-id="plain">
    <li data-marble-id="p1">Read the transcripts</li>
    <li data-marble-id="p2">Code the first pass</li>
    <li data-marble-id="p3">Second rater</li>
  </ul>
  <aside class="side" data-marble-id="side" data-marble-resizable="wh" style="width:280px;height:88px">
    <p data-marble-id="sidep">A pane that says it can be pulled.</p>
  </aside>
</body></html>
`;

const out = path.resolve(process.argv[2] ?? '/tmp/describe-shots');
await fsp.mkdir(out, { recursive: true });

const host = await startDrive({ documents: { garden: GARDEN, studio: STUDIO, board: BOARD } });
const { page } = await host.newPage();
await page.setViewportSize({ width: 1180, height: 820 });
const shot = async (name, clip = null) => {
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(out, `${name}.png`), ...(clip ? { clip } : {}) });
};
const boxOf = (id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();
const tool = (id) => page.locator(`.marble-marks-tool[data-tool="${id}"]`);
const draw = async (points) => {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.up();
};

await page.goto(`${host.base}/a/garden`);
await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));
const drawer = page.locator('marble-agent-drawer');
const launcher = drawer.locator('.launcher');

// The tray, which is one button lighter than it was: Describe, and the two
// that were always there.
await launcher.hover();
await shot('tray', { x: 1180 - 300, y: 820 - 340, width: 300, height: 340 });

// The toolbar, on the picker, where a hand rests.
await drawer.locator('.tool[data-tool="marks-describe"]').click();
await page.locator('.marble-marks-bar').waitFor();
await page.mouse.move(590, 300);
await shot('toolbar');

// A marquee: one frame around what it means, with the field on it.
const q = await boxOf('q');
await page.mouse.move(q.x - 10, q.y - 10);
await page.mouse.down();
await page.mouse.move(q.x + q.width + 10, q.y + q.height + 10, { steps: 10 });
await page.mouse.up();
await page.locator('.marble-marks-field').waitFor();
await shot('frame');

// Ink and a note, and what the frame makes of both.
await tool('sketch').click();
const h = await boxOf('h');
await draw([
  { x: h.x + 60, y: h.y + h.height + 8 },
  { x: q.x + 180, y: q.y - 6 },
]);
await tool('text').click();
await page.mouse.click(q.x + q.width - 190, q.y + q.height + 30);
await page.keyboard.type('two lines, not four');
await page.mouse.move(590, 240);
await shot('marks');

// The ask: what to try, and why.
await tool('select').click();
await tool('explore').click();
await page.locator('.marble-marks-explore:not([hidden])').waitFor();
await page.locator('.marble-marks-ask').first().click();
await page.keyboard.type('a denser list');
await page.locator('.marble-marks-ask').nth(1).click();
await page.keyboard.type('it is the first thing anyone reads');
await shot('explore');

// Adjust: what is under the pointer, what it allows, and where a drag lands.
await page.goto(`${host.base}/a/board`);
await page.waitForFunction(() => Boolean(window.marble?.agent));
await launcher.hover();
await drawer.locator('.tool[data-tool="marks-describe"]').click();
await page.locator('.marble-marks-bar').waitFor();
await tool('adjust').click();
const p1 = await boxOf('p1');
await page.mouse.move(p1.x + 60, p1.y + p1.height / 2);
await page.locator('.marble-marks-aim:not([hidden])').waitFor();
await shot('adjust-aim');

const p3 = await boxOf('p3');
await page.mouse.down();
await page.mouse.move(p3.x + 60, p3.y + p3.height - 3, { steps: 10 });
await shot('adjust-slot');
await page.mouse.up();
await page.waitForTimeout(300);
await shot('adjust-declare');

const side = await boxOf('side');
await page.mouse.move(side.x + 6, side.y + 6);
await page.locator('.marble-marks-grab[data-edge="se"]').waitFor();
await shot('adjust-handles');

// And the other half: a document that already has alternatives.
await page.goto(`${host.base}/a/studio`);
await page.locator('.marble-variations-pill:not([hidden])').waitFor();
await shot('pill', { x: 0, y: 0, width: 900, height: 420 });
await page.locator('.marble-variations-open').click();
await page.locator('.marble-variations-panel').waitFor();
await shot('compare');

await host.close();
console.log(out);
process.exit(0);
