// A console to look at in a browser: a real host with the console on, a fake
// fleet (test/fixtures/fake-sprite.mjs), real git checkouts for the workshop,
// fake deploy tools, and agents on so the workshop chat is real.

import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { seedConsole } from '../server/seed.js';
import { fakeFleet, probe } from '../test/fixtures/console-fleet.js';
import { startDrive } from './harness.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'bdhmin', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'bdhmin', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

const DEPLOY = `#!/usr/bin/env bash
for a in "$@"; do [[ $a == --print-plan ]] && { printf 'target: %s\\nrelease: R\\nsource: S\\nmarble: @bdhmin/marble@0.2.1\\nclaude: 2.1.281\\n' "$1"; exit 0; }; done
echo "==> checkpointing $1"; sleep \${FAKE_DEPLOY_SECONDS:-0.4}
echo "==> staging"; sleep \${FAKE_DEPLOY_SECONDS:-0.4}
echo "==> done: live on $1"
`;

export const SECRET = 'console-test-pass';

export async function consoleWorld({ fleet: fleetState = {} } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-world-'));
  const src = path.join(root, 'src');
  await fsp.mkdir(src);
  const subjects = ['Document hosting', 'drive-settings test: say which document is newest', 'DEPLOY.md: the workshop', 'Hold the sprite the moment work starts', 'Keep-awake renews its task with PUT'];
  const shas = [];
  for (const name of ['marble-drive', 'marble']) {
    const bare = path.join(root, `${name}.git`);
    git(root, 'init', '-q', '--bare', '-b', 'main', bare);
    git(src, 'clone', '-q', bare, name);
    const dir = path.join(src, name);
    git(dir, 'checkout', '-q', '-b', 'main');
    await fsp.mkdir(path.join(dir, 'tools', 'sprite'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'tools', 'sprite-deploy.sh'), DEPLOY, { mode: 0o755 });
    await fsp.writeFile(path.join(dir, 'tools', 'sprite', 'claude-version'), '2.1.281\n');
    await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify(name === 'marble' ? { name: '@bdhmin/marble', version: '0.2.1', scripts: { test: 'echo ok' } } : { name: 'marble-drive', dependencies: { '@bdhmin/marble': '^0.2.1' }, scripts: { test: 'echo ok' } }));
    for (const subject of name === 'marble' ? ['marble 0.2.1'] : subjects) {
      await fsp.writeFile(path.join(dir, 'CHANGES'), subject);
      git(dir, 'add', '.');
      git(dir, 'commit', '-q', '-m', subject);
      if (name === 'marble-drive') shas.push(git(dir, 'rev-parse', 'HEAD'));
    }
    git(dir, 'push', '-q', '-u', 'origin', 'main');
  }
  await fsp.writeFile(path.join(src, 'marble', 'README.md'), 'a change in progress');
  const release = (sha, stamp = '20260924T053531Z') => `${stamp}-${sha.slice(0, 7)}`;
  const head = shas.at(-1);
  const older = shas[1];
  const probes = {
    'admin-p1': probe('admin-p1', { release: release(head), history: [release(older, '20260923T100000Z'), release(head)], claudeAuth: 'login', claudeLogin: true, keys: [], working: true, health: { ok: true, streams: 3 }, documents: 124, driveBytes: 2_400_000_000 }),
    't-bryan': probe('t-bryan', { release: `20260924T051651Z-local-${head.slice(0, 7)}`, history: [release(older), `20260924T051651Z-local-${head.slice(0, 7)}`] }),
    't-irene': probe('t-irene', { release: release(head), claudeAuth: 'login', claudeLogin: true, keys: [] }),
    't-sam': probe('t-sam', { release: release(older, '20260923T100000Z'), claudeAuth: 'login', claudeLogin: false, keys: [] }),
    't-sangho': probe('t-sangho', { release: release(head), health: { ok: true, streams: 4 } }),
    't-peiling': probe('t-peiling', { release: release(older, '20260923T100000Z'), keys: [] }),
  };
  const fleet = await fakeFleet({
    probe: probes,
    checkpoints: { 't-sangho': [{ id: 'v6', create_time: '2026-09-24T05:36:33Z', comment: 'before deploy 20260924T053633Z-0dd39ac' }, { id: 'v5', create_time: '2026-09-23T21:02:00Z', comment: 'before deploy 20260923T210200Z-f588657' }] },
    ...fleetState,
  });
  const host = await startDrive({
    documents: {},
    env: {
      MARBLE_DRIVE_SECRET: SECRET,
      MARBLE_DRIVE_CONSOLE: '1',
      MARBLE_DRIVE_CONSOLE_SPRITE: fleet.bin,
      MARBLE_DRIVE_CONSOLE_SRC: src,
      MARBLE_DRIVE_CONSOLE_SELF: 'admin-p1',
    },
  });
  await seedConsole(host.drive.store);
  // The workshop's two agent projects, as sprite-workshop.sh registers them.
  const settings = await host.drive.agents.store.settings();
  await host.drive.agents.store.saveSettings({ ...settings, projects: [
    { id: 'mdrive', name: 'Marble Drive', path: path.join(src, 'marble-drive') },
    { id: 'marble', name: 'Marble', path: path.join(src, 'marble') },
  ] });
  // Looks the console would have made earlier, so every drive has something to say.
  for (const name of Object.keys(probes)) await host.drive.console.actions.look(name).catch(() => {});
  async function open({ width = 1280, height = 820, colorScheme = 'light', hasTouch = false, isMobile = false } = {}) {
    const { page, errors } = await host.newPage({ viewport: { width, height }, colorScheme, hasTouch, isMobile });
    await page.request.post(`${host.base}/gate`, { data: { secret: SECRET } });
    await page.goto(`${host.base}/a/Console`);
    await page.waitForSelector('.cx .row');
    return { page, errors };
  }
  return { host, fleet, src, open, shas };
}
