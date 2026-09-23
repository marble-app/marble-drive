// Using Marble never makes a git change. A development drive sits inside the
// app's checkout, so this stands one up: a git repository with the drive
// ignored inside it, the host working in the drive, and git asked from the
// drive the way an agent's turn would ask it (server/agent/runner.js sets the
// same ceiling).

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { seedDrive } = await import('../server/seed.js');

const git = (cwd, args, env = {}) => spawnSync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });

test('working in a drive inside a checkout leaves the checkout clean, and git cannot be reached from the drive', async (t) => {
  const checkout = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-checkout-'));
  execFileSync('git', ['init', '-q'], { cwd: checkout });
  await fsp.writeFile(path.join(checkout, '.gitignore'), 'drive/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: checkout });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'app'], { cwd: checkout });

  const root = path.join(checkout, 'drive');
  const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root }), { log: { log() {}, error() {} }, agents: false });
  t.after(() => drive.close());
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));

  await seedDrive(drive.store);
  await drive.createDocument('Notes/plan', '<html><body><p>plan</p></body></html>', { label: 'test' });
  const up = await fetch(`http://127.0.0.1:${port}/drive/upload-file?folder=Notes&name=song.mp3&client=t`, {
    method: 'POST',
    body: Buffer.alloc(4096, 7),
  });
  assert.equal(up.status, 200);

  assert.equal(git(checkout, ['status', '--porcelain']).stdout, '');

  const fenced = git(root, ['status'], { GIT_CEILING_DIRECTORIES: path.dirname(root) });
  assert.notEqual(fenced.status, 0);
  assert.match(fenced.stderr, /not a git repository/);
});
