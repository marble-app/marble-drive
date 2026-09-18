// A scratch Agents drive with a realistic working set, and screenshots of the
// four views. Not a test — a seeing loop. `node test-browser/shots.js [outdir]`.
//
// Every shot lands in the out dir as <view>.png. Pass --narrow for the 700px
// pass, --dark for the Dusk pass.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');

const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  let n = 0;
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => `k${(n += 1).toString(36)}`)
    .replace('__ICON__', '');
};

// A day's worth of work, the way Bryan's actually looks: a paper push, a
// Marble build thread, and a couple of loose ends.
const SEED = [
  { title: 'CHI 2027 related work pass', target: 'Research/CHI2027 - Elicitive UIs.mrbl', folder: 'Research', activity: 'reading Hollan 1985', running: true },
  { title: 'Bibliography dedup', target: 'Research/Bibliography Cleanup.mrbl', folder: 'Research', lastOutcome: 'changes', activity: 'merged 14 duplicate keys' },
  { title: 'Figure 3 redraw', target: 'Research/CHI2027 - Elicitive UIs.mrbl', folder: 'Research', lastOutcome: 'changes', activity: 'exported figure-3.svg' },
  { title: 'Three-thesis vision edit', target: 'Research/Research Vision Docs/vision.mrbl', folder: 'Research', lastOutcome: 'failed', activity: 'write refused: file was open' },
  { title: 'Agents drawer plan', target: 'Marble/docs/agents-drawer.md', folder: 'Marble', running: true, activity: 'drafting Plan 3' },
  { title: 'Affordance caret fix', target: 'Marble/lib/affordances.js', folder: 'Marble', lastOutcome: 'changes', activity: 'empty rows take a caret again' },
  { title: 'Tailscale serve notes', target: 'Marble/docs/remote.md', folder: 'Marble', lastOutcome: 'changes', activity: 'documented the funnel flag' },
  { title: 'US Open bracket widget', target: "Bryan's Days/today.mrbl", lastOutcome: 'changes', activity: 'bracket renders through the quarters' },
  { title: 'Kyoto itinerary', target: 'Travel/Japan.mrbl', lastOutcome: null, activity: '' },
  { title: 'Weekend reading', target: 'Fun/Reading.mrbl', lastOutcome: 'changes', activity: 'three papers queued' },
];

const out = process.argv.find((arg) => !arg.startsWith('-') && arg.endsWith('shots')) ?? process.argv[2];
const outDir = out && !out.startsWith('--') ? out : '/tmp/agent-shots';
const narrow = process.argv.includes('--narrow');
const dark = process.argv.includes('--dark');

await fsp.mkdir(outDir, { recursive: true });

const host = await startDrive({ documents: { garden: GARDEN, Agents: await sourceOfAgents() } });
const store = host.drive.agents.store;

const { page } = await host.newPage({
  viewport: narrow ? { width: 700, height: 900 } : { width: 1440, height: 900 },
  colorScheme: dark ? 'dark' : 'light',
});
await page.goto(`${host.base}/a/Agents`);
await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));

// Seed straight through the store: titles, targets and outcomes are facts the
// runner normally writes, and no fake turn would produce this spread.
const byFolder = new Map();
for (const row of SEED) {
  const id = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  await store.updateConversation(id, {
    title: row.title,
    target: row.target,
    activity: row.activity ?? '',
    running: Boolean(row.running),
    lastOutcome: row.lastOutcome ?? null,
    lastFinishedAt: row.running ? null : Date.now() - Math.floor(Math.random() * 7e6),
  });
  if (row.folder) {
    if (!byFolder.has(row.folder)) byFolder.set(row.folder, []);
    byFolder.get(row.folder).push(id);
  }
}
for (const [name, ids] of byFolder) {
  await store.createFolder({ conversationIds: ids, name, color: null });
}

await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.conv').length >= 10);

const shoot = async (view, name = view) => {
  await page.locator(`.views [data-view="${view}"]`).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
};

await shoot('library', 'list');
await shoot('board');
await shoot('folders');
await shoot('focus');

const errors = await page.evaluate(() => window.__shotErrors ?? []);
console.log(`shots in ${outDir}`, errors);
await host.close();
process.exit(0);
