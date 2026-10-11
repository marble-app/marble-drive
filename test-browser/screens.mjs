// Screenshots of the drawer, for looking at — not a test.
//
//   node test-browser/screens.mjs <out-dir>
//
// Light, dark, pinned, phone and a finished turn, against a scratch drive with
// the scripted fake agent, so what you see does not depend on any real agent.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { startDrive } from './harness.js';

const out = process.argv[2];
if (!out) {
  console.error('usage: node test-browser/screens.mjs <out-dir>');
  process.exit(1);
}
await fsp.mkdir(out, { recursive: true });

const host = await startDrive({
  scripts: {
    rename: [
      { call: 'read_document', args: { path: 'garden' } },
      { call: 'apply_ops', args: { path: 'garden', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
      { say: 'Renamed the heading to **Backlog** and left the questions as they were.\n\n- `h` now reads Backlog\n- nothing else changed' },
    ],
  },
});

async function shot(name, { viewport = { width: 1280, height: 800 }, colorScheme = 'light', steps = async () => {} } = {}) {
  await host.reset();
  const { page } = await host.newPage({ viewport, colorScheme });
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));
  await steps(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(path.join(out, `${name}.png`));
}

const drawer = (page) => page.locator('marble-agent-drawer');
const openIt = async (page) => {
  await drawer(page).locator('.launcher').click();
  await drawer(page).locator('aside.panel[data-open="true"]').waitFor();
};
const runRename = async (page) => {
  await openIt(page);
  await drawer(page).locator('button.new').click();
  await drawer(page).locator('marble-conversation textarea').fill('script:rename');
  await drawer(page).locator('marble-conversation textarea').press('Enter');
  await drawer(page).locator('marble-conversation .turn-footer[data-status="completed"]').waitFor();
};

await shot('1-closed');
await shot('2-open-new', { steps: openIt });
await shot('3-turn-light', { steps: runRename });
await shot('4-turn-dark', { colorScheme: 'dark', steps: runRename });
await shot('5-pinned', { steps: async (page) => { await runRename(page); await drawer(page).locator('button.pin').click(); } });
await shot('6-phone', { viewport: { width: 390, height: 844 }, steps: runRename });
await shot('7-menu', { steps: async (page) => { await runRename(page); await drawer(page).locator('button.title').click(); } });

await host.close();
