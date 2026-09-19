// A phone tour: every phone surface, plus a touch-target and overflow audit.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { GARDEN, startDrive } from '/Users/bryanmin/Development/3rd-year-projects/marble-drive/test-browser/harness.js';

const AGENTS_TEMPLATE = '/Users/bryanmin/Development/3rd-year-projects/marble-drive/templates/agents.mrbl';
const out = process.argv[2] ?? '/tmp/ph-tour';
const dark = process.argv.includes('--dark');
let n = 0;
const src = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8')).replaceAll('__TITLE__', 'Agents').replaceAll('__ID__', () => `k${(n += 1).toString(36)}`).replace('__ICON__', '');
const SCRIPTS = {
  rename: [{ call: 'read_document', args: { path: 'garden' } }, { say: 'I read the garden document. It has three sections and a list of plants. Want me to reorganise it by season?' }],
  permission: [{ ask: { tool: 'Bash', input: { command: 'rm -rf build && npm run build' } } }, { say: 'after' }],
};
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
const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, Agents: src } });
const store = host.drive.agents.store;
const { page, errors } = await host.newPage({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
await page.goto(`${host.base}/a/Agents`);
await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
const byFolder = new Map();
const ids = [];
for (const row of SEED) {
  const id = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  ids.push(id);
  await store.updateConversation(id, { title: row.title, target: row.target, activity: row.activity ?? '', running: Boolean(row.running), lastOutcome: row.lastOutcome ?? null, lastFinishedAt: row.running ? null : Date.now() - Math.floor(Math.random() * 7e6) });
  if (row.folder) { if (!byFolder.has(row.folder)) byFolder.set(row.folder, []); byFolder.get(row.folder).push(id); }
}
for (const [name, cids] of byFolder) await store.createFolder({ conversationIds: cids, name, color: null });
// a transcript and an ask
const talker = await page.evaluate(async () => { const a = window.marble.agent; const id = await a.start({ provider: 'fake' }); await a.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] }); return id; });
await store.updateConversation(talker, { title: 'Garden reorganisation', target: 'garden.mrbl' });
const asker = await page.evaluate(async () => { const a = window.marble.agent; const id = await a.start({ provider: 'fake' }); await a.send(id, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] }); return id; });
await store.updateConversation(asker, { title: 'Rebuild the site', target: 'Marble/site' });
await page.waitForTimeout(600);

const closeSheet = async () => { const vis = await page.locator('.sheet-scrim').isVisible().catch(() => false); if (vis) await page.locator('.sheet-scrim').click(); await page.waitForTimeout(450); };
const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log('shot', name); };
const view = async (v) => { await page.evaluate((v) => localStorage.setItem('marble-agents:view', v), v); await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.conv').length >= 10); await page.waitForTimeout(600); };
const longPress = async (loc) => { const b = await loc.boundingBox(); await page.mouse.move(b.x + 120, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(520); await page.mouse.up(); };

await view('deck');
await shot('01-deck-ask');
await page.evaluate(() => document.querySelector('.deck').scrollTo(0, 99999));
await shot('02-deck-bottom');
await page.evaluate(() => document.querySelector('.deck').scrollTo(0, 0));
await page.locator('.topbar .more').click(); await shot('03-more-sheet');
await closeSheet();
await page.locator('.usage-dot').click().catch(() => {}); await shot('04-fleet-sheet');
await closeSheet();
await page.locator('.thumb-new').click(); await shot('05-new-sheet');
await closeSheet();
await longPress(page.locator('.deck [data-band="running"] .conv').first()); await shot('06-actions-sheet');
await closeSheet();
// swipe a review row right ~60px (reveal), keep pointer down for the shot
{ const row = page.locator('.deck [data-band="review"] .conv').first(); const b = await row.boundingBox();
  await page.mouse.move(b.x + 40, b.y + 20); await page.mouse.down(); for (let x = 40; x < 110; x += 10) { await page.mouse.move(b.x + x, b.y + 20); await page.waitForTimeout(16); }
  await shot('07-swipe-right-held'); await page.mouse.up(); await page.waitForTimeout(500);
}
{ const row = page.locator('.deck [data-band="review"] .conv').nth(1); const b = await row.boundingBox();
  await page.mouse.move(b.x + 300, b.y + 20); await page.mouse.down(); for (let x = 300; x > 150; x -= 12) { await page.mouse.move(b.x + x, b.y + 20); await page.waitForTimeout(16); } await page.mouse.up();
  await shot('08-swipe-left-undo');
}
// row ⋯ button on phone
await page.locator('.deck [data-band="review"] .conv .manage .more').first().click().catch(() => {}); await shot('09-row-menu');
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
// open the conversation with a transcript
await page.locator(`.deck .conv[data-id="${talker}"]`).click({ force: true }).catch(async () => { await page.evaluate((id) => { const el = document.querySelector(`.conv[data-id="${id}"]`); el?.scrollIntoView(); el?.click(); }, talker); });
await page.waitForFunction(() => document.body.hasAttribute('data-open')); await shot('10-open-transcript');
// composer More
await page.evaluate(() => document.querySelector('marble-conversation')?.shadowRoot?.querySelector('.composer .more')?.click()); await shot('11-composer-more');
// filter pop
await page.evaluate(() => document.body.removeAttribute('data-open'));
await view('deck');
await page.locator('.topbar .more').click(); await page.locator('.sheet-row', { hasText: 'Filter' }).click(); await shot('12-filter');
await page.keyboard.press('Escape');
await view('library'); await shot('13-list');
await view('board'); await shot('14-board');
await view('folders'); await shot('15-folders');
await view('focus'); await shot('16-focus-top');
// drag the stack to the middle
{ const focus = page.locator('.focus'); const b = await focus.boundingBox(); await page.mouse.move(200, b.y + b.height - 30); await page.mouse.down(); for (let y = b.y + b.height - 30; y > b.y + 200; y -= 20) { await page.mouse.move(200, y); await page.waitForTimeout(16); } await shot('17-focus-mid-drag'); await page.mouse.up(); await page.waitForTimeout(900); await shot('18-focus-mid'); }
// audit
const audit = await page.evaluate(() => {
  const small = [];
  for (const el of document.querySelectorAll('button, a, [role="button"], input, textarea, .conv')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue;
    if (r.height < 44 || r.width < 44) small.push({ sel: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`, w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20) });
  }
  const overflow = document.documentElement.scrollWidth > innerWidth;
  const shadowSmall = [];
  const c = document.querySelector('marble-conversation');
  for (const el of c?.shadowRoot?.querySelectorAll('button, a, input, textarea') ?? []) { const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; if (r.height < 44 || r.width < 44) shadowSmall.push({ sel: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`, w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20) }); }
  return { small, overflow, shadowSmall };
});
console.log(JSON.stringify(audit, null, 1));
console.log('errors', errors);
await host.close(); process.exit(0);
