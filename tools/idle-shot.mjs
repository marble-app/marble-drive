import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GARDEN, startDrive } from '../test-browser/harness.js';

const T = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const raw = await fsp.readFile(T, 'utf8');
const AGENTS = raw.replaceAll('__TITLE__', 'Agents').replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10)).replace('__ICON__', '');
const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
const metaFile = (id) => path.join(host.drive.store.marbleDir, 'agents', id, 'meta.json');
const backdate = async (id, minutes) => {
  const file = metaFile(id);
  const at = Date.now() - minutes * 60_000;
  for (let i = 0; i < 40; i += 1) {
    const meta = JSON.parse(await fsp.readFile(file, 'utf8'));
    await fsp.writeFile(file, `${JSON.stringify({ ...meta, createdAt: at, updatedAt: at, lastInteractedAt: at, lastFinishedAt: at }, null, 2)}\n`);
    await new Promise((d) => setTimeout(d, 120));
    if (JSON.parse(await fsp.readFile(file, 'utf8')).updatedAt === at) return;
  }
};
const scheme = process.argv[2] === 'dark' ? 'dark' : 'light';
const { page } = await host.newPage({ colorScheme: scheme });
await page.goto(`${host.base}/a/Agents`);
await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleAgentIdle));
const ids = await page.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 14; i += 1) {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    out.push(id);
  }
  return out;
});
for (const id of ids) await page.locator(`.conv[data-id="${id}"]`).waitFor();
await page.waitForFunction(async (rows) => {
  const s = await window.marble.agent.conversations();
  return rows.every((id) => { const r = s.find((x) => x.id === id); return r && !r.running && !r.queued; });
}, ids);
// A plausible spread: a few live-ish, a clump in the hours, a tail of old ones.
const ages = [2, 8, 22, 40, 75, 140, 200, 320, 460, 700, 1500, 3000, 6200, 13000];
for (let i = 0; i < ids.length; i += 1) await backdate(ids[i], ages[i]);
await page.reload();
await page.waitForFunction(() => Boolean(window.marbleAgentIdle));
await page.waitForTimeout(1500);
await fsp.mkdir('scratchpad/shots', { recursive: true });
// The closed button, with the idle cut hiding rows behind it.
await page.screenshot({ path: `scratchpad/shots/bar-${scheme}.png`, clip: { x: 300, y: 0, width: 640, height: 46 } });
await page.locator('.filter-toggle').click();
await page.locator('.filter-pop').waitFor({ state: 'visible' });
await page.waitForTimeout(600);
await page.screenshot({ path: `scratchpad/shots/idle-${scheme}.png`, clip: { x: 300, y: 0, width: 420, height: 330 } });
await page.screenshot({ path: `scratchpad/shots/idle-${scheme}-full.png` });
console.log('read', await page.evaluate(() => document.querySelector('.idle-read')?.textContent));
console.log('said', await page.evaluate(() => document.querySelector('.idle-said')?.textContent));
console.log('pill', await page.evaluate(() => document.querySelector('.filter-count')?.textContent));
console.log('hidden rows', await page.evaluate(() => [...document.querySelectorAll('.conv')].filter((e) => e.hidden).length, ids.length));
await host.close();
