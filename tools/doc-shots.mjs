// A seeing loop for the Document starter. Not a test: the page in both schemes,
// the font card open, and the toolbar close up.
// `node tools/doc-shots.mjs [outdir]`
import fsp from 'node:fs/promises';
import path from 'node:path';

import { build } from '../server/gallery.js';
import { startDrive } from '../test-browser/harness.js';

const out = path.resolve(process.argv[2] ?? '/tmp/doc-shots');
await fsp.mkdir(out, { recursive: true });

const notes = await build('doc', { name: 'Notes' });
const host = await startDrive({ agents: false, documents: { notes } });

const look = async (scheme) => {
  const { page } = await host.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
  await page.goto(`${host.base}/a/notes`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `page-${scheme}.png`) });
  await page.screenshot({ path: path.join(out, `toolbar-${scheme}.png`), clip: { x: 0, y: 0, width: 900, height: 110 } });
  await page.click('[data-cmd="fonts"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `fonts-${scheme}.png`) });
  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `narrow-${scheme}.png`) });
  await page.close();
};

await look('light');
await look('dark');
await host.close();
console.log('shots in', out);
