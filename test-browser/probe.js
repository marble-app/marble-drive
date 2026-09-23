// Drives the four views and reports what actually happens. A diagnosis loop.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  let n = 0;
  return raw.replaceAll('__TITLE__', 'Agents').replaceAll('__ID__', () => `k${(n += 1).toString(36)}`).replace('__ICON__', '');
};

const SEED = [
  { title: 'CHI 2027 related work pass', target: 'Research/CHI2027 - Elicitive UIs.mrbl', folder: 'Research', activity: 'reading a 1985 paper', running: true },
  { title: 'Bibliography dedup', target: 'Research/Bibliography Cleanup.mrbl', folder: 'Research', lastOutcome: 'changes', activity: 'merged 14 duplicate keys' },
  { title: 'Figure 3 redraw', target: 'Research/CHI2027 - Elicitive UIs.mrbl', folder: 'Research', lastOutcome: 'changes', activity: 'exported figure-3.svg' },
  { title: 'Three-thesis vision edit', target: 'Research/Research Vision Docs/vision.mrbl', folder: 'Research', lastOutcome: 'failed', activity: 'write refused' },
  { title: 'Agents drawer plan', target: 'Marble/docs/agents-drawer.md', folder: 'Marble', running: true, activity: 'drafting Plan 3' },
  { title: 'Affordance caret fix', target: 'Marble/lib/affordances.js', folder: 'Marble', lastOutcome: 'changes', activity: 'empty rows take a caret' },
  { title: 'Tailscale serve notes', target: 'Marble/docs/remote.md', folder: 'Marble', lastOutcome: 'changes', activity: 'documented the funnel flag' },
  { title: 'US Open bracket widget', target: 'Days/today.mrbl', lastOutcome: 'changes', activity: 'bracket renders' },
  { title: 'Kyoto itinerary', target: 'Travel/Japan.mrbl' },
  { title: 'Weekend reading', target: 'Fun/Reading.mrbl', lastOutcome: 'changes', activity: 'three papers queued' },
];

const host = await startDrive({ documents: { garden: GARDEN, Agents: await sourceOfAgents() } });
const store = host.drive.agents.store;
// `--phone` measures the fisheye at an iPhone's size: every card's tier and
// box, and where the pane landed.
const phone = process.argv.includes('--phone');
const { page, errors } = await host.newPage(phone
  ? { viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
  : { viewport: { width: 1440, height: 900 } });
await page.goto(`${host.base}/a/Agents`);
await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));

const byFolder = new Map();
for (const row of SEED) {
  const id = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  await store.updateConversation(id, {
    title: row.title, target: row.target, activity: row.activity ?? '',
    running: Boolean(row.running), lastOutcome: row.lastOutcome ?? null,
  });
  if (row.folder) byFolder.set(row.folder, [...(byFolder.get(row.folder) ?? []), id]);
}
for (const [name, ids] of byFolder) await store.createFolder({ conversationIds: ids, name, color: null });

await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.conv').length >= 10);

const report = {};

if (phone) {
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'focus'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.focus[data-phone] .focus-card').length >= 10);
  await page.waitForTimeout(500);
  report.phoneFocus = await page.evaluate(() => {
    const pane = document.querySelector('.pane').getBoundingClientRect();
    return {
      room: document.querySelector('.focus').clientHeight,
      cards: [...document.querySelectorAll('.focus-card')].map((c) => ({
        title: c.querySelector('.focus-card-title')?.textContent,
        lod: c.dataset.lod,
        top: Math.round(parseFloat(c.style.top)),
        height: Math.round(parseFloat(c.style.height)),
      })),
      pane: [Math.round(pane.x), Math.round(pane.y), Math.round(pane.width), Math.round(pane.height)],
    };
  });
  console.log(JSON.stringify(report, null, 2));
  console.log('ERRORS', errors);
  await host.close();
  process.exit(0);
}

// --- Focus -----------------------------------------------------------------
await page.locator('.views [data-view="focus"]').click();
await page.waitForTimeout(600);
report.focus = await page.evaluate(() => {
  const el = document.querySelector('.focus');
  const cards = [...document.querySelectorAll('.focus-card')].map((c) => ({
    title: c.querySelector('.focus-card-title')?.textContent,
    lod: c.dataset.lod,
    box: [Math.round(c.offsetLeft), Math.round(c.offsetTop), Math.round(c.offsetWidth), Math.round(c.offsetHeight)],
  }));
  const basins = [...document.querySelectorAll('.focus-basin')].map((b) => ({
    name: b.querySelector('.focus-basin-name')?.textContent,
    box: [Math.round(b.offsetLeft), Math.round(b.offsetTop), Math.round(b.offsetWidth), Math.round(b.offsetHeight)],
  }));
  const pane = document.querySelector('.pane');
  const pr = pane.getBoundingClientRect();
  return {
    canvas: [el.clientWidth, el.clientHeight],
    topBandEmpty: Math.min(...cards.map((c) => c.box[1])),
    cards, basins,
    paneVisible: getComputedStyle(pane).display !== 'none',
    paneBox: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)],
    paneComposerOnCanvas: Boolean(document.querySelector('.pane .composer, .pane form')),
  };
});

// Does double-click pin and fill?
const firstCard = page.locator('.focus-card').first();
await firstCard.dblclick();
await page.waitForTimeout(800);
report.focusAfterPin = await page.evaluate(() => {
  const full = [...document.querySelectorAll('.focus-card[data-lod="full"]')].map((c) => ({
    title: c.querySelector('.focus-card-title')?.textContent,
    box: [Math.round(c.offsetLeft), Math.round(c.offsetTop), Math.round(c.offsetWidth), Math.round(c.offsetHeight)],
  }));
  const pane = document.querySelector('.pane');
  const pr = pane.getBoundingClientRect();
  return { full, paneBox: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)], panePos: pane.style.position };
});
await page.screenshot({ path: '/tmp/agent-shots/focus-pinned.png' });

// --- Folders ---------------------------------------------------------------
await page.locator('.views [data-view="folders"]').click();
await page.waitForTimeout(400);
report.folders = await page.evaluate(() => ({
  rail: [...document.querySelectorAll('.folder-group')].map((g) => ({
    name: g.querySelector('.folder-name')?.textContent,
    tabs: [...g.querySelectorAll('.folder-tab')].map((t) => t.textContent.trim()),
  })),
  right: (() => {
    const pane = document.querySelector('.pane');
    const r = pane.getBoundingClientRect();
    return { box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], extras: document.querySelectorAll('.dock-extras > *').length };
  })(),
}));
await page.locator('.folder-header').first().click();
await page.waitForTimeout(600);
report.foldersAfterHeaderClick = await page.evaluate(() => ({
  extras: document.querySelectorAll('.dock-extras > *').length,
  panes: document.querySelectorAll('marble-conversation').length,
  activeGroup: document.querySelector('.folder-group.marble-active .folder-name')?.textContent ?? null,
  openConv: document.querySelector('.pane marble-conversation')?.getAttribute('conversation') ?? null,
}));
await page.screenshot({ path: '/tmp/agent-shots/folders-open.png' });

console.log(JSON.stringify(report, null, 2));
console.log('ERRORS', errors);
await host.close();
process.exit(0);
