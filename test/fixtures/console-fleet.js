// A fake fleet for the console's tests: a `sprite` executable that answers
// from a state file (test/fixtures/fake-sprite.mjs) and a log of every call.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-sprite.mjs');

const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

export const sprite = (name, { status = 'warm', labels = ['marble-tester'], auth = 'public', ranAgo = 90, sleptAgo = 60 } = {}) => ({
  id: `sprite-${name}`,
  name,
  status,
  url: `https://${name}-b3fwm.sprites.app`,
  url_settings: { auth },
  labels,
  organization: 'marble-drive',
  created_at: iso(60 * 24),
  last_running_at: iso(ranAgo),
  last_warming_at: status === 'running' ? null : iso(sleptAgo),
});

export const FLEET = () => [
  sprite('admin-p1', { status: 'running', labels: ['marble-owner'], auth: 'sprite', ranAgo: 5 }),
  sprite('t-bryan', { sleptAgo: 30 }),
  sprite('t-irene', { sleptAgo: 180 }),
  sprite('t-peiling', { sleptAgo: 60 * 26 }),
  sprite('t-sam', { status: 'running', ranAgo: 2 }),
  sprite('t-sangho', { sleptAgo: 12 }),
];

export const probe = (name, extra = {}) => ({
  release: '20260924T053531Z-0dd39ac',
  history: ['20260924T032614Z-f588657', '20260924T053531Z-0dd39ac'],
  claudeVersion: '2.1.281',
  marbleVersion: '0.2.1',
  health: { ok: true, streams: 0, docs: { docs: 0, drive: 0 } },
  working: false,
  env: [
    { key: 'MARBLE_DRIVE_SECRET', value: `pass-${name}` },
    { key: 'MARBLE_DRIVE_SECURE_COOKIE', value: '1' },
    { key: 'MARBLE_DRIVE_AGENT_PROVIDER', value: 'claude-api' },
  ],
  claudeAuth: 'api',
  keys: ['anthropic'],
  claudeLogin: false,
  documents: 12,
  driveBytes: 48_000_000,
  diskFree: 90_000_000_000,
  log: ['[marble-drive] serving /drive', 'GET /health 200'],
  ...extra,
});

export async function fakeFleet(state = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-fleet-'));
  const statePath = path.join(dir, 'state.json');
  const logPath = path.join(dir, 'calls.log');
  const bin = path.join(dir, 'sprite');
  const full = { sprites: FLEET(), checkpoints: {}, probe: {}, exec: {}, fail: {}, ...state };
  await fsp.writeFile(statePath, JSON.stringify(full));
  await fsp.writeFile(bin, `#!/bin/sh\nFAKE_SPRITE_STATE='${statePath}' FAKE_SPRITE_LOG='${logPath}' exec '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  return {
    bin,
    dir,
    state: full,
    async set(next) {
      Object.assign(full, next);
      await fsp.writeFile(statePath, JSON.stringify(full));
    },
    async calls() {
      const text = await fsp.readFile(logPath, 'utf8').catch(() => '');
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    },
  };
}
