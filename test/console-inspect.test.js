// Looking inside a drive: a read-only probe runs on the sprite and prints one
// JSON object; the console keeps what may be shown (cached on disk, with when)
// and holds what may not (the passphrase, keys) in memory only.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createInspector, PROBE } from '../server/console/inspect.js';
import { createSprites } from '../server/console/sprites.js';
import { fakeFleet, probe } from './fixtures/console-fleet.js';

const run = (file, env) => new Promise((resolve, reject) => {
  execFile(process.execPath, [file], { env: { ...process.env, ...env } }, (err, stdout) => (err ? reject(err) : resolve(JSON.parse(stdout))));
});

test('the probe reads a sprite: release, versions, settings, Claude, keys by name, documents, log', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'probe-home-'));
  const drive = path.join(home, 'drive');
  const rel = path.join(home, 'app', 'releases', 'r2', 'marble-drive');
  await fsp.mkdir(path.join(rel, 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true });
  await fsp.mkdir(path.join(rel, 'node_modules', '@bdhmin', 'marble'), { recursive: true });
  await fsp.writeFile(path.join(rel, 'node_modules', '@anthropic-ai', 'claude-code', 'package.json'), '{"version":"2.1.281"}');
  await fsp.writeFile(path.join(rel, 'node_modules', '@bdhmin', 'marble', 'package.json'), '{"version":"0.2.1"}');
  await fsp.symlink(path.join(home, 'app', 'releases', 'r2'), path.join(home, 'app', 'current'));
  await fsp.writeFile(path.join(home, 'app', 'history'), 'r1\nr2\n');
  await fsp.mkdir(path.join(home, '.config', 'marble-drive'), { recursive: true });
  await fsp.writeFile(path.join(home, '.config', 'marble-drive', 'sprite.env'), '# x\nMARBLE_DRIVE_SECRET=hush\nMARBLE_DRIVE_AGENT_PROVIDER=claude-api\n');
  await fsp.writeFile(path.join(home, '.config', 'marble-drive', 'agent-keys'), JSON.stringify({ anthropic: 'sk-ant-xyz' }));
  await fsp.mkdir(path.join(drive, '.marble', 'agents'), { recursive: true });
  await fsp.writeFile(path.join(drive, '.marble', 'agents', 'settings.json'), JSON.stringify({ claudeAuth: 'login' }));
  await fsp.writeFile(path.join(drive, 'a.mrbl'), 'x');
  await fsp.mkdir(path.join(drive, 'Folder'));
  await fsp.writeFile(path.join(drive, 'Folder', 'b.mrbl'), 'yy');
  await fsp.writeFile(path.join(drive, 'Folder', 'song.mp3'), 'zzz');
  const logs = path.join(home, 'logs');
  await fsp.mkdir(logs);
  await fsp.writeFile(path.join(logs, 'marble-drive.log'), Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n'));

  const out = await run(PROBE, { HOME: home, MARBLE_PROBE_DRIVE: drive, MARBLE_PROBE_LOGS: logs, MARBLE_PROBE_PORT: '1', MARBLE_PROBE_SOCKET: path.join(home, 'none.sock') });
  assert.equal(out.release, 'r2');
  assert.deepEqual(out.history, ['r1', 'r2']);
  assert.equal(out.claudeVersion, '2.1.281');
  assert.equal(out.marbleVersion, '0.2.1');
  assert.deepEqual(out.env, [{ key: 'MARBLE_DRIVE_SECRET', value: 'hush' }, { key: 'MARBLE_DRIVE_AGENT_PROVIDER', value: 'claude-api' }]);
  assert.equal(out.claudeAuth, 'login');
  assert.deepEqual(out.keys, ['anthropic'], 'which keys, never their values');
  assert.ok(!JSON.stringify(out).includes('sk-ant-xyz'));
  assert.equal(out.claudeLogin, false);
  assert.equal(out.documents, 2);
  assert.equal(out.driveBytes, 1 + 2 + 3);
  assert.equal(out.log.length, 40);
  assert.equal(out.log.at(-1), 'line 79');
  assert.equal(out.health, null, 'no host answered');
  assert.equal(out.working, null, 'no socket to ask');
});

test('a look keeps what may be shown on disk, and the passphrase only in memory', async () => {
  const fleet = await fakeFleet({ probe: { 't-irene': probe('t-irene') } });
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'inspect-'));
  const inspector = createInspector({ sprites: createSprites({ bin: fleet.bin, org: 'marble-drive' }), dir });
  const seen = await inspector.look('t-irene');
  assert.equal(seen.release, '20260924T053531Z-0dd39ac');
  assert.ok(seen.lookedAt);
  assert.deepEqual(seen.env.find((e) => e.key === 'MARBLE_DRIVE_SECRET'), { key: 'MARBLE_DRIVE_SECRET', secret: true });
  assert.deepEqual(seen.env.find((e) => e.key === 'MARBLE_DRIVE_AGENT_PROVIDER'), { key: 'MARBLE_DRIVE_AGENT_PROVIDER', value: 'claude-api' });
  const onDisk = await fsp.readFile(path.join(dir, 't-irene.json'), 'utf8');
  assert.ok(!onDisk.includes('pass-t-irene'), 'the passphrase is not cached');
  assert.equal(inspector.secret('t-irene', 'MARBLE_DRIVE_SECRET'), 'pass-t-irene');
  assert.deepEqual(await inspector.cached('t-irene'), seen);
  const call = (await fleet.calls()).find((c) => c[0] === 'exec');
  assert.ok(call.includes('--file') && call.at(-2) === 'node', call.join(' '));
});
