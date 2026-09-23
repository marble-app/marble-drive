// tools/sprite/release.sh runs on a Fly Sprite, but its promise that a failed
// release leaves nothing behind can be checked anywhere: with stub `npm` and
// `node` that "succeed" without installing anything, a stage reaches its
// Claude Code check and fails there, through `die` — the path that used to
// leave a half-built release beside the good ones.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'sprite', 'release.sh');

test('a release that fails to stage leaves no folder under releases/', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'sprite-release-'));
  const bin = path.join(home, 'bin');
  const src = path.join(home, 'src');
  await fsp.mkdir(bin, { recursive: true });
  await fsp.mkdir(src, { recursive: true });
  for (const name of ['npm', 'node']) {
    await fsp.writeFile(path.join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  await fsp.writeFile(path.join(src, 'package.json'), '{}');
  execFileSync('tar', ['czf', path.join(home, 'src.tgz'), '-C', src, '.']);

  const run = spawnSync('bash', [SCRIPT, 'stage', 'half-built', `tar:${path.join(home, 'src.tgz')}`, 'x', '9.9.9'], {
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  assert.notEqual(run.status, 0, 'the stage failed');
  assert.match(run.stderr, /claude 9\.9\.9 did not install/);
  assert.deepEqual(await fsp.readdir(path.join(home, 'app', 'releases')), []);
});
