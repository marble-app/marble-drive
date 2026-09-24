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

// When a deploy targets the machine it runs on (admin-p1 updating itself from
// one of its own conversations), switching at once would restart the host that
// is running that conversation. `switch-when-idle` waits until the host holds
// no Sprites task (keep-awake holds one exactly while a turn runs), then
// switches, then removes its own service.
async function fakeTaskSocket(answers) {
  const http = await import('node:http');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sock-'));
  const socket = path.join(dir, 'api.sock');
  let n = 0;
  const server = http.createServer((req, res) => {
    const a = answers[Math.min(n, answers.length - 1)];
    n += 1;
    res.writeHead(a.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tasks: a.tasks ?? [] }));
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  return { socket, calls: () => n, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function whenIdle(answers, giveUp = '30') {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'switch-idle-'));
  const bin = path.join(home, 'bin');
  await fsp.mkdir(bin, { recursive: true });
  const log = path.join(home, 'sprite-env.log');
  await fsp.writeFile(path.join(bin, 'sprite-env'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`, { mode: 0o755 });
  for (const name of ['curl', 'sudo']) await fsp.writeFile(path.join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fsp.mkdir(path.join(home, 'app', 'releases', 'r2', 'marble-drive'), { recursive: true });
  const sock = await fakeTaskSocket(answers);
  // Not spawnSync: the fake socket lives in this process and has to answer.
  const { spawn } = await import('node:child_process');
  const child = spawn('bash', [SCRIPT, 'switch-when-idle', 'r2'], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      MARBLE_SPRITE_DRIVE: path.join(home, 'drive'),
      MARBLE_SPRITE_SOCKET: sock.socket,
      MARBLE_SWITCH_CHECK_SECONDS: '0.2',
      MARBLE_SWITCH_GIVE_UP_SECONDS: giveUp,
    },
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const status = await new Promise((resolve) => child.on('close', resolve));
  const run = { status, stderr };
  await sock.close();
  const calls = (await fsp.readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const switchLog = await fsp.readFile(path.join(home, 'app', 'switch.log'), 'utf8').catch(() => '');
  return { run, calls, checks: sock.calls(), switchLog, home };
}

const busy = { tasks: [{ name: 'marble-drive' }] };
const idle = { tasks: [] };

test('it waits while a turn is running, switches after two idle checks, then removes itself', async () => {
  const { run, calls, checks, home } = await whenIdle([busy, busy, busy, idle, idle]);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(checks >= 5, `checked ${checks} times`);
  const created = calls.findIndex((c) => c.startsWith('services create marble-drive'));
  const removed = calls.findIndex((c) => c === 'services delete marble-switch');
  assert.ok(created >= 0, calls.join('\n'));
  assert.ok(removed > created, 'the switcher removes itself after switching');
  assert.ok((await fsp.readlink(path.join(home, 'app', 'current'))).endsWith('/r2'));
});

test('an answer it cannot read counts as busy, and it gives up without switching', async () => {
  const { run, calls, switchLog } = await whenIdle([{ status: 500 }], '1');
  assert.notEqual(run.status, 0);
  assert.ok(!calls.some((c) => c.startsWith('services create marble-drive')), calls.join('\n'));
  assert.ok(calls.includes('services delete marble-switch'));
  assert.match(switchLog, /gave up/);
});

// The console changes a drive's settings by rewriting its sprite.env, then
// asking for the live release again: `apply` restarts the service with the new
// settings through the same health check, and leaves the history alone.
// admin-p1 applies its own when no agent is working.
async function applyStubs(command) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'sprite-apply-'));
  const bin = path.join(home, 'bin');
  await fsp.mkdir(bin, { recursive: true });
  const log = path.join(home, 'sprite-env.log');
  await fsp.writeFile(path.join(bin, 'sprite-env'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`, { mode: 0o755 });
  for (const name of ['curl', 'sudo']) await fsp.writeFile(path.join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const r of ['r1', 'r2']) await fsp.mkdir(path.join(home, 'app', 'releases', r, 'marble-drive'), { recursive: true });
  await fsp.symlink(path.join(home, 'app', 'releases', 'r2'), path.join(home, 'app', 'current'));
  await fsp.writeFile(path.join(home, 'app', 'history'), 'r1\nr2\n');
  await fsp.mkdir(path.join(home, '.config', 'marble-drive'), { recursive: true });
  await fsp.writeFile(path.join(home, '.config', 'marble-drive', 'sprite.env'), 'MARBLE_DRIVE_AWAKE_MAX_HOURS=12\n');
  const run = spawnSync('bash', [SCRIPT, command], {
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, MARBLE_SPRITE_DRIVE: path.join(home, 'drive') },
    encoding: 'utf8',
  });
  const calls = (await fsp.readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return { run, calls, home };
}

test('apply restarts the live release with the new settings and keeps the history', async () => {
  const { run, calls, home } = await applyStubs('apply');
  assert.equal(run.status, 0, run.stderr);
  const create = calls.find((line) => line.startsWith('services create marble-drive'));
  assert.ok(create && create.includes('MARBLE_DRIVE_AWAKE_MAX_HOURS=12'), calls.join('\n'));
  assert.ok((await fsp.readlink(path.join(home, 'app', 'current'))).endsWith('/r2'));
  assert.equal(await fsp.readFile(path.join(home, 'app', 'history'), 'utf8'), 'r1\nr2\n');
});

test('apply-when-idle hands the live release to marble-switch', async () => {
  const { run, calls } = await applyStubs('apply-when-idle');
  assert.equal(run.status, 0, run.stderr);
  assert.ok(calls.some((line) => line.startsWith('services create marble-switch') && line.includes('switch-when-idle,r2')), calls.join('\n'));
});
