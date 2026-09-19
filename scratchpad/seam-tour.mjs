// A seam tour: drag the bar between the field and the stage all the way in,
// a frame at a time, and see what the field does with the width it is left.
import fsp from 'node:fs/promises';
import { GARDEN, startDrive } from '/Users/bryanmin/Development/3rd-year-projects/marble-drive/test-browser/harness.js';

const AGENTS_TEMPLATE = '/Users/bryanmin/Development/3rd-year-projects/marble-drive/templates/agents.mrbl';
const out = process.argv[2] ?? '/tmp/seam-tour';
let n = 0;
const src = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => `k${(n += 1).toString(36)}`)
  .replace('__ICON__', '');
const SEED = [
  { title: 'CHI 2027 related work pass', target: 'Research/CHI2027 - Elicitive UIs.mrbl', folder: 'Research', activity: 'reading Hollan 1985', running: true },
  { title: 'Bibliography dedup', target: 'Research/Bibliography Cleanup.mrbl', folder: 'Research', lastOutcome: 'changes', activity: 'merged 14 duplicate keys' },
  { title: 'Figure 3 redraw', target: 'Research/CHI2027 - Elicitive UIs.mrbl', folder: 'Research', lastOutcome: 'changes', activity: 'exported figure-3.svg' },
  { title: 'Agents drawer plan', target: 'Marble/docs/agents-drawer.md', folder: 'Marble', running: true, activity: 'drafting Plan 3' },
  { title: 'Affordance caret fix', target: 'Marble/lib/affordances.js', folder: 'Marble', lastOutcome: 'changes', activity: 'empty rows take a caret again' },
  { title: 'Kyoto itinerary', target: 'Travel/Japan.mrbl', lastOutcome: null, activity: '' },
  { title: 'Weekend reading', target: 'Fun/Reading.mrbl', lastOutcome: 'changes', activity: 'three papers queued' },
];
await fsp.mkdir(out, { recursive: true });
const host = await startDrive({ documents: { garden: GARDEN, Agents: src } });
const store = host.drive.agents.store;
const { page, errors } = await host.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${host.base}/a/Agents`);
await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
await page.evaluate(async (seed) => {
  const mk = async (row) => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(id, { title: row.title, target: row.target, activity: row.activity ?? '' });
    return id;
  };
  const byFolder = new Map();
  let first = null;
  for (const row of seed) {
    const id = await mk(row);
    if (!first) first = id;
    if (row.folder) {
      if (!byFolder.has(row.folder)) byFolder.set(row.folder, []);
      byFolder.get(row.folder).push(id);
    }
  }
  await window.marble.agent.update(first, { pinned: true });
  for (const [name, ids] of byFolder) await window.marble.agent.createFolder({ conversationIds: ids, name, color: null });
}, SEED);
await page.locator('.views [data-view="focus"]').click();
await page.locator('.focus-seam').waitFor();
await page.waitForTimeout(600);

const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  const seam = await page.evaluate(() => window.marbleFocusSeam?.());
  const shape = await page.evaluate(() => ({
    columns: document.querySelectorAll('.focus-basin:not([data-pile])').length,
    piles: document.querySelectorAll('.focus-basin[data-pile]').length,
    split: document.querySelector('.focus').getAttribute('data-split'),
    scrolls: document.querySelector('.focus').scrollWidth > document.querySelector('.focus').clientWidth + 1,
  }));
  console.log(name.padEnd(12), 'seam', Math.round(seam?.seamX ?? -1), JSON.stringify(shape));
};
const stops = await page.evaluate(() => window.marbleFocusSeam?.());
console.log('stops', (stops.stops ?? []).map(Math.round).join(' '), 'min', Math.round(stops.min), 'max', Math.round(stops.max));

const dragTo = async (x, { still = true } = {}) => {
  const box = await page.locator('.focus-seam').boundingBox();
  const y = box.y + 300;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  if (still) { await page.waitForTimeout(140); await page.mouse.move(x, y); }
  await page.mouse.up();
  await page.waitForTimeout(500);
};

await shot('0-rest');
const canvas = await page.evaluate(() => document.querySelector('.focus').getBoundingClientRect().left);
let step = 0;
for (const x of [canvas + 620, canvas + 470, canvas + 330, canvas + 240, canvas + 120, canvas + 40]) {
  step += 1;
  await dragTo(x);
  await shot(`${step}-at-${Math.round(x - canvas)}`);
}
await dragTo(canvas + 700);
await shot('back-wide');
console.log('errors', errors);
await page.close();
await host.close();
