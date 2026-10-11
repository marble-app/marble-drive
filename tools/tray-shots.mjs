// A seeing loop for the agent tray. Not a test: four shots of the corner —
// at rest, hovered, hovered with an agent working, and beside a pinned panel.
// `node tools/tray-shots.mjs [outdir]`
import fsp from 'node:fs/promises';
import path from 'node:path';

import { GARDEN, startDrive } from '../test-browser/harness.js';

const out = path.resolve(process.argv[2] ?? '/tmp/tray-shots');
await fsp.mkdir(out, { recursive: true });

const host = await startDrive({ documents: { garden: GARDEN } });
const { page } = await host.newPage();
await page.setViewportSize({ width: 1100, height: 760 });
await page.goto(`${host.base}/a/garden`);
await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));

const drawer = page.locator('marble-agent-drawer');
const launcher = drawer.locator('.launcher');
// The corner, at the size a hand meets it.
const corner = { x: 1100 - 340, y: 760 - 340, width: 340, height: 340 };
const shot = async (name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(out, `${name}.png`), clip: corner });
};

await shot('rest');
await launcher.hover();
await shot('hover');

await page.evaluate(() => {
  document.dispatchEvent(new CustomEvent('marble:presence', {
    detail: { client: 'agent:c1', ids: ['h'], phase: 'writing', note: 'Rename the heading.' },
  }));
  const range = document.createRange();
  range.selectNodeContents(document.querySelector('[data-marble-id="p"]'));
  getSelection().removeAllRanges();
  getSelection().addRange(range);
});
await page.mouse.move(40, 40);
await launcher.hover();
await shot('hover-working');

await launcher.click();
await drawer.locator('.pin').click();
await page.waitForTimeout(500);
await launcher.hover();
await page.waitForTimeout(450);
await page.screenshot({ path: path.join(out, 'pinned.png') });

await host.close();
console.log(out);
process.exit(0);
