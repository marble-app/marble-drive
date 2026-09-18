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

// A deterministic history: `weeks` of days ending on a fixed Friday, active on
// weekdays after week 3, with Fable only in the last 9 days. Days are what the
// host sends (dense, oldest first), so the browser tests read exact values.
export const usageHistoryStub = (weeks = 26) => {
  const end = Date.UTC(2026, 8, 18);
  const days = [];
  for (let i = weeks * 7 - 1; i >= 0; i -= 1) {
    const at = new Date(end - i * 86_400_000);
    const date = at.toISOString().slice(0, 10);
    const dow = at.getUTCDay();
    const active = i < 60 && dow !== 0 && dow !== 6;
    const messages = active ? 20 + ((i * 7) % 40) : 0;
    const byModel = {};
    if (messages) {
      const fable = i < 9 ? Math.round(messages / 4) : 0;
      const rest = messages - fable;
      byModel.opus = { messages: Math.ceil(rest / 2), tokens: Math.ceil(rest / 2) * 1000 };
      byModel.sonnet = { messages: Math.floor(rest / 2), tokens: Math.floor(rest / 2) * 800 };
      if (fable) byModel.fable = { messages: fable, tokens: fable * 1200 };
    }
    const tokens = Object.values(byModel).reduce((sum, m) => sum + m.tokens, 0);
    days.push({ date, messages, tokens, cacheRead: tokens * 30, byModel });
  }
  return { source: 'claude-code-local', tz: 'America/Los_Angeles', generatedAt: '2026-09-18T20:00:00.000Z', from: days[0].date, to: days.at(-1).date, days };
};

export async function startDrive({ scripts = {}, agents = true, documents = { garden: GARDEN }, genui = null } = {}) {
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
    genui,
    usageHistory: async ({ weeks = 26 } = {}) => usageHistoryStub(weeks),
    usage: async () => ({
      meters: [
        {
          id: 'claude-subscription',
          label: 'Claude',
          used: 23,
          left: 77,
          window: '5h',
          resetsAt: '2026-09-17T22:30:00Z',
          detail: '5h 23% used · week 41% used',
          windows: [
            { id: '5h', label: 'Short-term', used: 23, left: 77, resetsAt: '2026-09-17T22:30:00Z', kind: 'quota' },
            { id: 'week', label: 'Weekly', used: 41, left: 59, resetsAt: '2026-09-20T10:59:59Z', kind: 'quota' },
            { id: 'fable', label: 'Fable', used: 58, left: 42, resetsAt: '2026-09-21T10:59:59Z', kind: 'quota' },
          ],
        },
        {
          id: 'cursor',
          label: 'Cursor',
          used: 19,
          left: 81,
          window: 'plan',
          resetsAt: '1789861494000',
          detail: 'Cursor models 12% used · Other 100% used',
          windows: [
            { id: 'auto', label: 'Cursor models', used: 12, left: 88, resetsAt: '1789861494000', kind: 'quota' },
            { id: 'api', label: 'Other models', used: 100, left: 0, resetsAt: '1789861494000', kind: 'quota' },
          ],
        },
      ],
    }),
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
      // The composer remembers the model a person picks, so one test's pick is
      // the next test's default. A reset drive has not picked anything yet.
      await drive.agents?.store.saveSettings({ models: {}, efforts: {} });
    },
    async newPage({ viewport = { width: 1280, height: 800 }, reducedMotion = 'no-preference', colorScheme = 'light', hasTouch = false, isMobile = false, deviceScaleFactor = 1 } = {}) {
      const context = await browser.newContext({ viewport, reducedMotion, colorScheme, hasTouch, isMobile, deviceScaleFactor });
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
