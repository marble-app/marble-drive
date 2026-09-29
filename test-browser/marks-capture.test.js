// What Describe mode's marks were drawn over reaches the agent: a picture of
// the region with the marks drawn back on it, and the live page's own reading
// of what is there — typed values and script-drawn content included, which the
// document's saved source does not have.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { startDrive } from './harness.js';

// A panel whose most important parts are not in its source: a line a script
// writes, a field the person types into, and a chart drawn on a canvas.
const PANEL = `<!doctype html>
<html><head><meta charset="utf-8"><title>Panel</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 40px; }
  section { width: 560px; padding: 16px; border: 1px solid #ccc; border-radius: 12px; }
  canvas { display: block; margin-top: 12px; }
</style>
</head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Launch settings</h1>
  <section data-marble-id="card">
    <div data-marble-id="live" id="live"></div>
    <label data-marble-id="lab">Mission name <input data-marble-id="name" placeholder="Name it"></label>
    <canvas data-marble-id="chart" id="chart" width="520" height="220"></canvas>
  </section>
  <script>
    document.getElementById('live').innerHTML = '<button>Launch rocket</button> <span>Drawn by script: 42 items</span>';
    const g = document.getElementById('chart').getContext('2d');
    g.fillStyle = '#39c';
    g.fillRect(20, 40, 140, 160);
    g.fillRect(200, 100, 140, 100);
  </script>
</body></html>
`;

const host = await startDrive({ documents: { panel: PANEL } });
test.after(() => host.close());

// A reset drive keeps its conversations, and the callout rebuilds a card for
// every chat about the document — so one test's brief would hang over the
// next test's page. File them between tests.
const clearConversations = async () => {
  for (const summary of await (await fetch(`${host.base}/agent/conversations`)).json()) {
    const detail = await (await fetch(`${host.base}/agent/conversations/${summary.id}`)).json();
    for (const turn of detail.turns ?? []) {
      if (turn.status === 'running') await fetch(`${host.base}/agent/turns/${turn.id}/cancel`, { method: 'POST' });
      if (turn.status === 'queued') await fetch(`${host.base}/agent/turns/${turn.id}`, { method: 'DELETE' });
    }
    await fetch(`${host.base}/agent/conversations/${summary.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
  }
};

const pages = [];
test.after(async () => {
  for (const page of pages) await page.close().catch(() => {});
});

const open = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
  await clearConversations();
  await host.reset();
  const { page } = await host.newPage();
  pages.push(page);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`${host.base}/a/panel`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  return page;
};
const describe = async (page) => {
  await page.locator('marble-agent-drawer .launcher').hover();
  await page.locator('marble-agent-drawer .tool[data-tool="marks-describe"]').click();
  await page.locator('.marble-marks-bar').waitFor();
};
const use = async (page, name) => {
  await page.locator(`.marble-marks-tool[data-tool="${name}"]`).click();
  await page.locator(`.marble-marks-layer[data-mode="${name}"]`).waitFor();
};
const drag = async (page, points) => {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.mouse.up();
};
const boxOf = (page, id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();
const promptWith = async (words) => {
  for (let i = 0; i < 160; i += 1) {
    const found = host.prompts.find((prompt) => prompt.includes(words));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no turn started with "${words}"`);
};
const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

test('a sketch and a note send a picture of what they cover and the live page under them', async () => {
  const page = await open();
  await page.locator('[data-marble-id="name"]').fill('Apollo Eleven');
  await describe(page);

  // A note stuck on the chart, first, so the card the marks hang is not
  // where the hand goes next.
  await use(page, 'text');
  const chart = await boxOf(page, 'chart');
  await page.mouse.click(chart.x + 300, chart.y + 150);
  await page.locator('.marble-marks-note-body').waitFor();
  await page.keyboard.type('make this a line chart');
  await page.waitForFunction(() => document.querySelector('.marble-callout-status')?.textContent.includes('a note on chart'));

  // A box around the line the script wrote, and the field.
  await use(page, 'sketch');
  const live = await boxOf(page, 'live');
  const lab = await boxOf(page, 'lab');
  const top = live.y - 8;
  const bottom = lab.y + lab.height + 8;
  const left = live.x - 8;
  const right = live.x + 380;
  await drag(page, [
    { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top + 2 },
  ]);
  await page.waitForFunction(() => document.querySelector('.marble-callout-status')?.textContent.includes('a box around'));

  await page.locator('.marble-callout marble-conversation .editor').click();
  await page.keyboard.type('tidy this up');
  await page.locator('.marble-callout marble-conversation .send').click();

  const prompt = await promptWith('tidy this up');
  // The words, as before.
  assert.match(prompt, /^I marked up the page: a note on chart: "make this a line chart"; a box around [^.]+\. tidy this up/);
  // What was on the live page: the script's words and what was typed.
  assert.match(prompt, /What was on screen under the marks/);
  assert.match(prompt, /Drawn by script: 42 items/);
  assert.match(prompt, /Launch rocket/);
  assert.match(prompt, /input #name = "Apollo Eleven"/);
  assert.match(prompt, /canvas #chart 520×220/);
  assert.match(prompt, /◀ marked/);
  // And a picture of it, with the marks on.
  const shot = /A screenshot of the part of the page they marked[^:]*: (\S+\.png)\./.exec(prompt);
  assert.ok(shot, prompt);
  const bytes = await fsp.readFile(shot[1]);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  const size = pngSize(bytes);
  // The region, not the page: the box and the note, and a margin round them.
  assert.ok(size.width > 300 && size.height > 150, JSON.stringify(size));
  assert.ok(size.width < 1200 * 2 && size.height < 800 * 2, JSON.stringify(size));
});

test('an area drawn inside one element, covering none of its parts, still names it and is pictured', async () => {
  const page = await open();
  await describe(page);
  const chart = await boxOf(page, 'chart');
  // A corner of the canvas: too little of anything for the marquee's own rule.
  await drag(page, [{ x: chart.x + 180, y: chart.y + 60 }, { x: chart.x + 360, y: chart.y + 200 }]);
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["chart"]');

  await page.locator('.marble-callout marble-conversation .editor').click();
  await page.keyboard.type('what is this bar');
  await page.locator('.marble-callout marble-conversation .send').click();

  const prompt = await promptWith('what is this bar');
  assert.match(prompt, /canvas #chart 520×220\s+◀ marked/);
  assert.match(prompt, /A screenshot of the part of the page they marked[^:]*: \S+\.png\./);
});
