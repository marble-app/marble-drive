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

// Each sprite's own settings (~/.config/marble-drive/sprite.env: a tester's
// passphrase, which agent pays) and its saved API keys live outside every
// release, so a deploy keeps them. Stubs stand in for the sprite: `sprite-env`
// records how the service was made, `curl` says /health answered.
async function spriteStubs(home, envLines) {
  const bin = path.join(home, 'bin');
  await fsp.mkdir(bin, { recursive: true });
  const log = path.join(home, 'sprite-env.log');
  await fsp.writeFile(path.join(bin, 'sprite-env'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`, { mode: 0o755 });
  for (const name of ['curl', 'sudo']) await fsp.writeFile(path.join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fsp.mkdir(path.join(home, 'app', 'releases', 'r1', 'marble-drive'), { recursive: true });
  if (envLines !== null) {
    await fsp.mkdir(path.join(home, '.config', 'marble-drive'), { recursive: true });
    await fsp.writeFile(path.join(home, '.config', 'marble-drive', 'sprite.env'), envLines.join('\n') + '\n');
  }
  const run = spawnSync('bash', [SCRIPT, 'switch', 'r1'], {
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, MARBLE_SPRITE_DRIVE: path.join(home, 'drive') },
    encoding: 'utf8',
  });
  const calls = await fsp.readFile(log, 'utf8').catch(() => '');
  return { run, calls };
}

test('the service gets the sprite\'s own settings after the defaults, and keys outside the release', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'sprite-env-'));
  const { run, calls } = await spriteStubs(home, ['# a tester', 'MARBLE_DRIVE_SECRET=Tr0ub4dor-x', '', 'MARBLE_DRIVE_AGENT_PROVIDER=claude-api']);
  assert.equal(run.status, 0, run.stderr);
  const create = calls.split('\n').find((line) => line.startsWith('services create'));
  assert.ok(create, calls);
  const env = /--env (\S+)/.exec(create)[1].split(',');
  assert.ok(env.includes(`MARBLE_DRIVE_AGENT_KEYS=${home}/.config/marble-drive/agent-keys`), env.join('\n'));
  assert.ok(env.indexOf('MARBLE_DRIVE_SECRET=Tr0ub4dor-x') > env.findIndex((e) => e.startsWith('MARBLE_DRIVE_ROOT=')));
  assert.ok(env.includes('MARBLE_DRIVE_AGENT_PROVIDER=claude-api'));
  assert.equal((await fsp.readlink(path.join(home, 'app', 'current'))).endsWith('/r1'), true);
});

test('a setting with a comma in it is refused before anything moves', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'sprite-env-'));
  const { run, calls } = await spriteStubs(home, ['MARBLE_DRIVE_SECRET=a,b']);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /comma/);
  assert.equal(calls, '');
  await assert.rejects(fsp.readlink(path.join(home, 'app', 'current')));
});
