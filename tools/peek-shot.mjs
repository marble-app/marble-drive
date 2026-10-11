// A picture of the peek: a canvas of chats, the pointer resting on one of
// them. `node tools/peek-shot.mjs [dark]`.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GARDEN, startDrive } from '../test-browser/harness.js';

const SCRIPTS = {
  work: [
    { call: 'read_document', args: { path: 'garden' } },
    { tool: 'Bash', input: { command: 'node --test test/agent-folders.test.js', description: 'Run the folder tests' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading to **Backlog** and left the two questions alone.\n\nThe rename is one `setText`, so it undoes in one step — and nothing else in the document moved.' },
  ],
  busy: [
    { tool: 'Read', input: { file_path: '/Users/x/marble-drive/templates/agents.mrbl' } },
    { tool: 'Grep', input: { pattern: 'packFocus', path: '/Users/x/marble-drive/runtime' } },
    { tool: 'Edit', input: { file_path: '/Users/x/marble-drive/runtime/agent-folders.js' } },
    { silent: 60_000 },
  ],
};

const T = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const raw = await fsp.readFile(T, 'utf8');
const AGENTS = raw.replaceAll('__TITLE__', 'Agents').replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10)).replace('__ICON__', '');
const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, Agents: AGENTS } });
const scheme = process.argv[2] === 'dark' ? 'dark' : 'light';
const { page } = await host.newPage({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
await page.goto(`${host.base}/a/Agents`);
await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));

const ids = await page.evaluate(async () => {
  const agent = window.marble.agent;
  const titles = ['Hover peek on Focus cards', 'Bibliography cleanup', 'Idle cut slider', 'Phone deck polish', 'Undo across documents',
    'Design system swatches', 'Coding and IRR round 3', 'Writing screens holes', 'Days almanac digests', 'Template gallery brief',
    'Drive folder covers', 'Marks toolbar phase 2', 'Callout in situ', 'Seam snapping', 'Usage sliders 429'];
  const made = [];
  for (const title of titles) {
    const id = await agent.start({ provider: 'fake' });
    await agent.update(id, { title, pinned: false });
    made.push(id);
  }
  await agent.send(made[0], {
    prompt: 'In the focus view, I want to be able to hover over the chat cards to see a more detailed peek into what that chat was about.',
    target: 'garden',
    viewing: 'Agents',
    selection: [],
  });
  await agent.send(made[3], { prompt: 'script:busy Polish the phone deck.', target: 'garden', viewing: 'Agents', selection: [] });
  return made;
});
// The first chat's turn has to be a `work` script: send it by prompt prefix.
await page.evaluate(async (id) => {
  await window.marble.agent.send(id, {
    prompt: 'script:work Rename the heading of the garden, and tell me what you left alone.',
    target: 'garden',
    viewing: 'Agents',
    selection: [],
  });
}, ids[0]);
await page.waitForFunction(async (id) => {
  const rows = await window.marble.agent.conversations();
  const row = rows.find((r) => r.id === id);
  return Boolean(row && !row.running && !row.queued);
}, ids[0]);

await page.locator('.views [data-view="focus"]').click();
await page.waitForTimeout(600);
await fsp.mkdir('scratchpad/shots', { recursive: true });

await page.locator(`.focus-card[data-id="${ids[0]}"]`).hover();
await page.locator('.focus-look').waitFor();
await page.waitForTimeout(700);
await page.screenshot({ path: `scratchpad/shots/peek-idle-${scheme}.png` });

await page.locator(`.focus-card[data-id="${ids[3]}"]`).hover();
await page.waitForTimeout(700);
await page.screenshot({ path: `scratchpad/shots/peek-running-${scheme}.png` });

console.log(await page.evaluate(() => document.querySelector('.focus-look')?.innerText));
await host.close();
process.exit(0);
