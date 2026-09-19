import fsp from 'node:fs/promises';
import path from 'node:path';
import { GARDEN, startDrive } from '/Users/bryanmin/Development/3rd-year-projects/marble-drive/test-browser/harness.js';
const AGENTS_TEMPLATE = '/Users/bryanmin/Development/3rd-year-projects/marble-drive/templates/agents.mrbl';
const out = '/tmp/ph-tour';
let n = 0;
const src = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8')).replaceAll('__TITLE__', 'Agents').replaceAll('__ID__', () => `k${(n += 1).toString(36)}`).replace('__ICON__', '');
const SEED = [
  { title: 'CHI 2027 related work pass', target: 'Research/CHI2027 - Elicitive UIs.mrbl', folder: 'Research', activity: 'reading Hollan 1985', running: true },
  { title: 'Bibliography dedup', target: 'Research/Bibliography Cleanup.mrbl', folder: 'Research', lastOutcome: 'changes', activity: 'merged 14 duplicate keys' },
  { title: 'Figure 3 redraw', target: 'Research/CHI2027 - Elicitive UIs.mrbl', folder: 'Research', lastOutcome: 'changes', activity: 'exported figure-3.svg' },
  { title: 'Agents drawer plan', target: 'Marble/docs/agents-drawer.md', folder: 'Marble', running: true, activity: 'drafting Plan 3' },
  { title: 'Affordance caret fix', target: 'Marble/lib/affordances.js', folder: 'Marble', lastOutcome: 'changes', activity: 'empty rows take a caret again' },
  { title: 'Kyoto itinerary', target: 'Travel/Japan.mrbl', lastOutcome: null, activity: '' },
  { title: 'Weekend reading', target: 'Fun/Reading.mrbl', lastOutcome: 'changes', activity: 'three papers queued' },
];
const host = await startDrive({ documents: { garden: GARDEN, Agents: src } });
const store = host.drive.agents.store;
const { page } = await host.newPage({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await page.goto(`${host.base}/a/Agents`);
await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
const byFolder = new Map();
for (const row of SEED) {
  const id = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  await store.updateConversation(id, { title: row.title, target: row.target, activity: row.activity ?? '', running: Boolean(row.running), lastOutcome: row.lastOutcome ?? null, lastFinishedAt: row.running ? null : Date.now() - 3e6 });
  if (row.folder) { if (!byFolder.has(row.folder)) byFolder.set(row.folder, []); byFolder.get(row.folder).push(id); }
}
for (const [name, cids] of byFolder) await store.createFolder({ conversationIds: cids, name, color: null });
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log('shot', name); };
const view = async (v) => { await page.evaluate((v) => { localStorage.setItem('marble-agents:view', v); localStorage.removeItem('marble-agents:open'); }, v); await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.conv').length >= 7); await page.waitForTimeout(600); };
await view('board'); await shot('20-board');
await view('folders'); await shot('21-folders');
await view('deck');
await page.locator('.topbar .more').click(); await page.locator('.sheet-row', { hasText: 'Filter' }).click(); await shot('22-filter');
const filterInfo = await page.evaluate(() => { const f = document.querySelector('.filter-pop'); if (!f) return 'no .filter-pop'; const r = f.getBoundingClientRect(); return { hidden: f.hidden, display: getComputedStyle(f).display, rect: [r.x, r.y, r.width, r.height] }; });
console.log('filter', JSON.stringify(filterInfo));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
// row menu
await page.locator('.deck [data-band="review"] .conv .manage .more').first().click(); await page.waitForTimeout(300);
const menuInfo = await page.evaluate(() => { const m = document.querySelector('.conv .manage .menu'); if (!m) return 'no menu'; const r = m.getBoundingClientRect(); return { rect: [r.x, r.y, r.width, r.height], items: [...m.querySelectorAll('button')].map((b) => b.textContent.trim()) }; });
console.log('rowmenu', JSON.stringify(menuInfo)); await shot('23-row-menu');
await page.keyboard.press('Escape');
// swipe left (reveal undo) - hold
{ const row = page.locator('.deck [data-band="review"] .conv').first(); const b = await row.boundingBox();
  await page.mouse.move(b.x + 300, b.y + 20); await page.mouse.down(); for (let x = 300; x > 140; x -= 10) { await page.mouse.move(b.x + x, b.y + 20); await page.waitForTimeout(16); } await page.mouse.up(); await page.waitForTimeout(600);
  console.log('swipe', await row.getAttribute('data-swipe')); await shot('24-swipe-left'); }
// back button geometry with a conversation open
await page.locator('.deck [data-band="running"] .conv').first().click(); await page.waitForFunction(() => document.body.hasAttribute('data-open')); await page.waitForTimeout(400);
const backInfo = await page.evaluate(() => { const b = document.querySelector('.pane .back'); const r = b.getBoundingClientRect(); const bar = document.querySelector('.pane > .dock-bar')?.getBoundingClientRect(); const mast = document.querySelector('marble-conversation')?.shadowRoot?.querySelector('.mast')?.getBoundingClientRect(); const log = document.querySelector('marble-conversation')?.shadowRoot?.querySelector('.log')?.getBoundingClientRect(); return { back: [r.x, r.y, r.width, r.height], bar: bar && [bar.x, bar.y, bar.width, bar.height], mast: mast && [mast.y, mast.height], logTop: log?.y, topbar: document.querySelector('.topbar').getBoundingClientRect().height }; });
console.log('back', JSON.stringify(backInfo));
// composer geometry
const comp = await page.evaluate(() => { const sr = document.querySelector('marble-conversation').shadowRoot; const q = (s) => { const r = sr.querySelector(s)?.getBoundingClientRect(); return r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }; return { composer: q('.composer'), bar: q('.bar'), setup: q('.setup'), field: q('textarea'), send: q('.send'), setupHidden: sr.querySelector('.setup')?.hidden, setupChildren: [...(sr.querySelector('.setup')?.children ?? [])].map((c) => c.className + ':' + c.textContent.trim().slice(0, 30)) }; });
console.log('composer', JSON.stringify(comp));
await host.close(); process.exit(0);
