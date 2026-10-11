// Screenshots of the four readings of Bryan's Days, against the real issues,
// in a scratch host. Usage: node tools/almanac-shots.mjs <drive.mrbl> [out-dir]
import fsp from 'node:fs/promises';
import path from 'node:path';
import { startDrive } from '../test-browser/harness.js';

const [doc, out = '/tmp/almanac'] = process.argv.slice(2);
await fsp.mkdir(out, { recursive: true });
const SOURCE = await fsp.readFile(doc, 'utf8');
const dir = new URL("../drive/Bryan's Days/", import.meta.url);
const documents = { drive: SOURCE };
for (const f of await fsp.readdir(dir)) {
  if (!f.endsWith('.mrbl')) continue;
  documents[`Bryan's Days/${f.slice(0, -5).replace(/[,]/g, '')}`] = await fsp.readFile(new URL(f, dir), 'utf8');
}
const host = await startDrive({ agents: false, documents });
const { page, errors } = await host.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(`${host.base}/a/drive#/${encodeURIComponent("Bryan's Days")}`);
await page.locator('.items[data-rep="days"]').waitFor();
await page.locator('.days-bar .days-note', { hasText: /days ·/ }).waitFor({ timeout: 90_000 });
const shot = async (name, full = true) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: full });
  console.log('shot', name);
};
await shot('1-days');
await page.locator('[data-set-view="list"]').click();
await page.waitForTimeout(300);
await shot('1b-ledger');
await page.locator('[data-set-view="grid"]').click();
for (const r of ['kept', 'threads', 'wall']) {
  await page.locator(`[data-days-read="${r}"]`).click();
  await page.waitForTimeout(600);
  await shot('2-' + r);
}
await page.locator('[data-days-read="days"]').click();
await page.emulateMedia({ colorScheme: 'dark' });
await page.locator('[data-days-read="wall"]').click();
await shot('3-wall-dark');
await page.locator('[data-days-read="threads"]').click();
await shot('3-threads-dark');
await page.emulateMedia({ colorScheme: 'light' });
await page.setViewportSize({ width: 390, height: 844 });
for (const r of ['days', 'kept', 'threads', 'wall']) {
  await page.locator(`[data-days-read="${r}"]`).click();
  await page.waitForTimeout(400);
  await shot('4-phone-' + r);
}
console.log('errors', errors.filter((e) => !/sandbox/i.test(e)));
await page.close();
await host.close();
