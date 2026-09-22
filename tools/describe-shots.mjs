// A seeing loop for Select and Sketch. Not a test: the tray with its two new
// tools, a marquee mid-drag, ink over a list with its reading showing, and the
// card that ink opened with the reading already in the composer.
// `node tools/marks-shots.mjs [outdir]`
import fsp from 'node:fs/promises';
import path from 'node:path';

import { GARDEN, startDrive } from '../test-browser/harness.js';

const out = path.resolve(process.argv[2] ?? '/tmp/marks-shots');
await fsp.mkdir(out, { recursive: true });

const host = await startDrive({ documents: { garden: GARDEN } });
const { page } = await host.newPage();
await page.setViewportSize({ width: 1100, height: 760 });
await page.goto(`${host.base}/a/garden`);
await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));

const drawer = page.locator('marble-agent-drawer');
const launcher = drawer.locator('.launcher');
const tool = (id) => drawer.locator(`.tool[data-tool="${id}"]`);
const shot = async (name, clip = null) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `${name}.png`), ...(clip ? { clip } : {}) });
};
const corner = { x: 1100 - 320, y: 760 - 380, width: 320, height: 380 };
const boxOf = (id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();

// The column, with the two tools that draw in it.
await launcher.hover();
await shot('tray', corner);

// A marquee, held half way down the list so the outline is visible.
await tool('marks-select').click();
const q = await boxOf('q');
await page.mouse.move(q.x - 20, q.y - 14);
await page.mouse.down();
await page.mouse.move(q.x + q.width + 20, q.y + q.height + 14, { steps: 10 });
await shot('marquee');
await page.mouse.up();

// Ink: a box round the list and an arrow from the heading to it, with the
// reading of the stroke under the pointer showing.
await launcher.hover();
await tool('marks-sketch').click();
const draw = async (points) => {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.up();
};
const h = await boxOf('h');
await draw([
  { x: q.x + 240, y: q.y - 10 }, { x: q.x + q.width + 14, y: q.y - 12 },
  { x: q.x + q.width + 12, y: q.y + q.height + 12 }, { x: q.x + 240, y: q.y + q.height + 10 },
  { x: q.x + 238, y: q.y - 6 },
]);
// An arrow from the heading down to what it was sketched around.
await draw([
  { x: h.x + 120, y: h.y + h.height + 6 }, { x: q.x + 220, y: q.y + q.height / 2 },
]);
await page.mouse.move(q.x + 240, q.y + q.height / 2);
await shot('sketch');

// And the door out: Ask here, with the reading written into the card.
await page.keyboard.press('Escape');
await launcher.hover();
await tool('ask').click();
await page.locator('.marble-callout marble-conversation .editor').waitFor();
await shot('card');

await host.close();
console.log(out);
process.exit(0);
