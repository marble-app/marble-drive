// A scratch drive with the scripted fake agent, and a Chromium to open it in.
//
// Playwright is not a dependency of this repo. The Marble package has it, and
// is reached the way server/engine.js reaches Marble: through its package.json
// as a file URL, which an exports map cannot filter.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { createFakeProvider } from '../test/fixtures/fake-provider.js';

const PLAYWRIGHT = new URL('node_modules/playwright/index.mjs', import.meta.resolve('@bdhmin/marble/package.json'));
const { chromium } = await import(PLAYWRIGHT.href);

export const GARDEN = `<!doctype html>
<html><head><meta charset="utf-8"><title>Garden</title>
<style>body { font: 16px/1.5 Georgia, serif; margin: 40px; } h1 { font-size: 32px; }</style>
</head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Research Garden</h1>
  <p data-marble-id="p">Open questions we keep coming back to.</p>
  <ul data-marble-id="q">
    <li data-marble-id="q1">Why do people stop using a tool?</li>
    <li data-marble-id="q2">What makes an interface feel alive?</li>
  </ul>
</body></html>
`;

const quiet = { log() {}, error() {} };

export async function startDrive({ scripts = {}, agents = true, documents = { garden: GARDEN } } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-browser-drive-'));
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-browser-work-'));
  const keysFile = path.join(workdir, 'agent-keys.local');
  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_DATA: '',
    MARBLE_DRIVE_SECRET: '',
    HOST: '127.0.0.1',
    MARBLE_DRIVE_AGENTS: agents ? '1' : '',
    MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
    MARBLE_DRIVE_AGENT_WORKDIR: workdir,
    MARBLE_DRIVE_AGENT_KEYS: keysFile,
    MARBLE_DRIVE_BACKUP_DIR: '',
    MARBLE_DRIVE_BACKUP_CMD: '',
  });
  const drive = await createDrive(config, {
    log: quiet,
    agentProviders: new Map([['fake', createFakeProvider({ scripts })]]),
  });
  for (const [docPath, source] of Object.entries(documents)) await drive.createDocument(docPath, source, { label: 'test' });
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();

  return {
    drive,
    base,
    async reset() {
      for (const [docPath, source] of Object.entries(documents)) await drive.createDocument(docPath, source, { label: 'reset' });
    },
    async newPage({ viewport = { width: 1280, height: 800 }, reducedMotion = 'no-preference', colorScheme = 'light' } = {}) {
      const context = await browser.newContext({ viewport, reducedMotion, colorScheme });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      return { page, errors };
    },
    async close() {
      await browser.close();
      await drive.close();
      await fsp.rm(root, { recursive: true, force: true });
      await fsp.rm(workdir, { recursive: true, force: true });
    },
  };
}
