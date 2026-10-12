// Watch a page being built (runtime/gen-progress.js), without a real agent.
//
//   node test-browser/gen-progress-demo.mjs [out-dir]
//
// Starts a throwaway drive with the scripted provider, opens an empty page,
// and runs one followed turn on it: it reads the page, says the outline of
// three sections, inserts them one stage at a time, and finishes. Each run
// is recorded as a video (light and dark, desk and phone, with reduced motion
// last), with a still at each stage, into out-dir (default /tmp/gen-progress-demo).
// Not a test: the suite is gen-progress.test.js.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { startDrive } from './harness.js';

const OUT = path.resolve(process.argv[2] ?? '/tmp/gen-progress-demo');

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Week plan</title>
<style>
  :root { color-scheme: light dark; --ink: light-dark(#1d1d1f, #ececee); --paper: light-dark(#fff, #1c1c1e); }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 40px 32px; background: var(--paper); color: var(--ink); }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 4px; font-weight: 600; }
  header p { margin: 0 0 8px; color: light-dark(#666, #999); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
  .card { padding: 16px; border: 1px solid light-dark(#e3e3e6, #333); border-radius: 12px; min-height: 88px; }
  ul { padding: 0; list-style: none; }
  li { padding: 10px 12px; border-bottom: 1px solid light-dark(#eee, #2a2a2c); }
</style></head>
<body data-marble-id="b"><main data-marble-id="m"></main></body></html>`;

const HEADER = '<header><h1>Week plan</h1><p>What the team is doing this week.</p></header>';
const CARDS = '<div class="grid"><div class="card">Design review</div><div class="card">Build the cards</div><div class="card">Ship Friday</div></div>';
const ROWS = '<ul><li>Monday: review</li><li>Wednesday: try it on t-bryan</li><li>Friday: demo</li></ul>';

const SCRIPTS = {
  build: [
    { call: 'read_document', args: { path: 'plan' } },
    { sleep: 2500 },
    { call: 'apply_ops', args: { path: 'plan', note: 'Stage 1 of 3: the outline.', ops: [], outline: { parentId: 'm', blocks: [{ shape: 'header' }, { shape: 'cards', count: 3 }, { shape: 'rows', count: 3 }] } } },
    { sleep: 3000 },
    { call: 'apply_ops', args: { path: 'plan', note: 'Stage 2 of 3: the header.', ops: [{ type: 'insert', parentId: 'm', html: HEADER }] } },
    { sleep: 2500 },
    { call: 'apply_ops', args: { path: 'plan', note: 'Stage 3 of 3: the cards.', ops: [{ type: 'insert', parentId: 'm', html: CARDS }] } },
    { sleep: 2500 },
    { call: 'apply_ops', args: { path: 'plan', note: 'And the days.', ops: [{ type: 'insert', parentId: 'm', html: ROWS }] } },
    { sleep: 1500 },
    { call: 'check_document', args: { path: 'plan' } },
    { sleep: 1200 },
    { say: 'Built.' },
  ],
};

const RUNS = [
  { name: 'light-desk', colorScheme: 'light', viewport: { width: 1200, height: 760 } },
  { name: 'dark-desk', colorScheme: 'dark', viewport: { width: 1200, height: 760 } },
  { name: 'light-phone', colorScheme: 'light', viewport: { width: 390, height: 844 } },
  { name: 'dark-phone', colorScheme: 'dark', viewport: { width: 390, height: 844 } },
  { name: 'reduced-motion', colorScheme: 'light', viewport: { width: 1200, height: 760 }, reducedMotion: 'reduce' },
];

await fsp.mkdir(OUT, { recursive: true });
const host = await startDrive({ scripts: SCRIPTS, documents: { plan: PAGE } });
const api = async (method, url, body) => (await fetch(`${host.base}${url}`, {
  method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})).json();
const lineState = (page) => page.evaluate(() => document.querySelector('marble-gen-line')?.shadowRoot.querySelector('.line')?.dataset.state ?? null);

for (const run of RUNS) {
  await host.reset();
  const id = (await api('POST', '/agent/conversations', { provider: 'fake' })).id;
  const dir = path.join(OUT, `${run.name}-video`);
  const { page } = await host.newPage({ ...run, attending: [id], video: dir });
  await page.goto(`${host.base}/a/plan`);
  await page.waitForFunction(() => Boolean(window.marbleGen?.stats));
  await page.waitForTimeout(600);
  await api('POST', `/agent/conversations/${id}/turns`, { prompt: 'script:build Make a week plan', context: { target: 'plan', viewing: 'plan', selection: [], also: [] } });
  // A still each time the page shows something new.
  let last = '';
  let n = 0;
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const s = await page.evaluate(() => JSON.stringify([window.marbleGen.stats().said, document.querySelectorAll('.marble-gen-block').length, document.querySelector('[data-marble-id="m"]').children.length]));
    if (s !== last) {
      last = s;
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, `${run.name}-${String(++n).padStart(2, '0')}.png`) });
    }
    if ((await lineState(page)) === 'done') { await page.waitForTimeout(700); await page.screenshot({ path: path.join(OUT, `${run.name}-${String(++n).padStart(2, '0')}-done.png`) }); break; }
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(2000);
  const video = page.video();
  await page.context().close();
  const file = await video?.path();
  if (file) await fsp.rename(file, path.join(OUT, `${run.name}.webm`));
  await fsp.rm(dir, { recursive: true, force: true });
  console.log(`${run.name}: ${n} stills, ${run.name}.webm`);
}
await host.close();
console.log(`in ${OUT}`);
