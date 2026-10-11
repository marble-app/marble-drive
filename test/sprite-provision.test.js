// tools/sprite-provision.sh --door: the drive someone asked for at
// marbledrive.app, made by the door sprite. With a stub `sprite` CLI, a stub
// curl and a stub deploy, nothing leaves this machine: the test reads the
// settings the script would have put on the sprite, and what it printed.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'sprite-provision.sh');
const ACCOUNT = 'a1b2c3d4e5f60718';
const KEYS = 'k1:MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE= k0:MCowBQYDK2VwAyEAd75Wsd0EdS0pT0Ka5gS6bGpIyFTmd5r5tKX9WR1Xd8A=';

async function rig({ deployFails = false, enter = '302 https://marbledrive.app/enter?drive=ana&to=%2F' } = {}) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'sprite-provision-'));
  const bin = path.join(home, 'bin');
  const got = path.join(home, 'got');
  await fsp.mkdir(bin, { recursive: true });
  await fsp.mkdir(got, { recursive: true });
  await fsp.writeFile(path.join(bin, 'sprite'), `#!/usr/bin/env bash
echo "sprite $*" >>"${home}/calls"
case "$1" in
  list) exit 0 ;;
  info) echo "URL: https://d-ana-abc.sprites.app"; exit 0 ;;
  exec)
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == --file ]]; then src="\${2%%:*}"; dst="\${2#*:}"; cp "$src" "${got}/$(basename "$dst")"; shift 2; continue; fi
      shift
    done
    exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
  await fsp.writeFile(path.join(bin, 'curl'), `#!/usr/bin/env bash
if [[ "$*" == *redirect_url* ]]; then printf '%s' '${enter}'; else printf 200; fi
`, { mode: 0o755 });
  const deploy = path.join(bin, 'deploy');
  await fsp.writeFile(deploy, `#!/usr/bin/env bash\necho "deploy $*" >>"${home}/calls"\n${deployFails ? 'exit 3' : 'exit 0'}\n`, { mode: 0o755 });
  const keys = path.join(home, 'door-keys');
  await fsp.writeFile(keys, `${KEYS}\n`);
  const run = (args) =>
    spawnSync('bash', [SCRIPT, ...args], {
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, MARBLE_SPRITE_DEPLOY: deploy },
      encoding: 'utf8',
    });
  // The same, without blocking: for a run that calls the door, served here.
  const runAsync = (args) =>
    new Promise((resolve) => {
      const child = spawn('bash', [SCRIPT, ...args], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, MARBLE_SPRITE_DEPLOY: deploy } });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (b) => { stdout += b; });
      child.stderr.on('data', (b) => { stderr += b; });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
  return { home, got, keys, run, runAsync, calls: async () => (await fsp.readFile(path.join(home, 'calls'), 'utf8').catch(() => '')).trim().split('\n') };
}

test('--door makes d-<name>, labelled marble-user, with exactly the door settings, and prints no passphrase', async () => {
  const r = await rig();
  const run = r.run(['--door', 'ana', '--account', ACCOUNT, '--keys', r.keys]);
  assert.equal(run.status, 0, run.stderr);
  const env = await fsp.readFile(path.join(r.got, 'sprite.env'), 'utf8');
  const lines = env.trim().split('\n').filter((l) => !l.startsWith('#'));
  const keys = lines.map((l) => l.split('=')[0]);
  assert.deepEqual(keys, [
    'MARBLE_DRIVE_SECRET',
    'MARBLE_DRIVE_SECURE_COOKIE',
    'MARBLE_DRIVE_AGENT_PROVIDER',
    'MARBLE_DOOR_KEYS',
    'MARBLE_DOOR_NAME',
    'MARBLE_DOOR_OWNER',
    'MARBLE_DRIVE_GATE',
    'MARBLE_DRIVE_PUBLIC_URL',
  ]);
  const value = (k) => lines.find((l) => l.startsWith(`${k}=`)).slice(k.length + 1);
  const secret = value('MARBLE_DRIVE_SECRET');
  assert.match(secret, /^[A-Za-z0-9]{24}$/);
  assert.equal(value('MARBLE_DRIVE_AGENT_PROVIDER'), 'claude-api');
  assert.equal(value('MARBLE_DOOR_KEYS'), KEYS);
  assert.equal(value('MARBLE_DOOR_NAME'), 'ana');
  assert.equal(value('MARBLE_DOOR_OWNER'), ACCOUNT);
  assert.equal(value('MARBLE_DRIVE_GATE'), 'tools');
  assert.equal(value('MARBLE_DRIVE_PUBLIC_URL'), 'https://ana.marbledrive.app');
  assert.ok(!lines.some((l) => l.includes(',')), 'no comma, which sprite.env cannot hold');

  assert.ok(!run.stdout.includes(secret) && !run.stderr.includes(secret), 'the passphrase is never printed');
  assert.doesNotMatch(run.stdout, /send this|passphrase:/);
  const steps = run.stdout.split('\n').filter((l) => l.startsWith('step: '));
  assert.deepEqual(steps, ['step: machine now', 'step: machine done', 'step: install now', 'step: install done', 'step: check now', 'step: check done']);
  assert.match(run.stdout, /^url: https:\/\/d-ana-abc\.sprites\.app$/m);

  const calls = await r.calls();
  assert.ok(calls.includes('sprite create -o marble-drive --skip-console --label marble-user d-ana'), calls.join('\n'));
  assert.ok(calls.some((c) => c.startsWith('deploy d-ana --org marble-drive')));
  await assert.rejects(fsp.access(path.join(r.home, '.config', 'marble-drive', 'testers.json')), 'no roster entry');
});

test('--door refuses a name that is not a drive name, before it makes anything', async () => {
  for (const name of ['An', 'a--b', 'pc-ana', 't-ana', '-ana', 'ana_b', `a${'b'.repeat(30)}`]) {
    const r = await rig();
    const run = r.run(['--door', name, '--account', ACCOUNT, '--keys', r.keys]);
    assert.notEqual(run.status, 0, name);
    assert.match(run.stderr, /is not a drive name/, name);
    assert.deepEqual(await r.calls(), [''], `${name}: no sprite call`);
  }
});

test('--door wants an account id and a keys file of the right shape', async () => {
  const r = await rig();
  assert.match(r.run(['--door', 'ana', '--account', 'nope', '--keys', r.keys]).stderr, /--account/);
  assert.match(r.run(['--door', 'ana', '--account', ACCOUNT, '--keys', '/nonexistent']).stderr, /--keys/);
  await fsp.writeFile(r.keys, 'k1:abc,k2:def\n');
  assert.match(r.run(['--door', 'ana', '--account', ACCOUNT, '--keys', r.keys]).stderr, /keys file/);
});

test('a deploy that fails stops at install, and says how to finish or remove it', async () => {
  const r = await rig({ deployFails: true });
  const run = r.run(['--door', 'ana', '--account', ACCOUNT, '--keys', r.keys]);
  assert.notEqual(run.status, 0);
  const steps = run.stdout.split('\n').filter((l) => l.startsWith('step: '));
  assert.deepEqual(steps.at(-1), 'step: install now');
  assert.match(run.stderr, /--resume ana --door ana/);
  assert.match(run.stderr, /--remove ana --door ana/);
});

test('a drive that does not send a browser to sign in is not done', async () => {
  const r = await rig({ enter: '200 ' });
  const run = r.run(['--door', 'ana', '--account', ACCOUNT, '--keys', r.keys]);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /did not send a browser to sign in/);
  assert.doesNotMatch(run.stdout, /^url: /m);
});

const TOKEN = `mdc_${'a1'.repeat(24)}`;

test('--door with --credit-file puts the drive on starter credit: the proxy, its token, and claude-credit', async () => {
  const r = await rig();
  const file = path.join(r.home, 'credit.env');
  await fsp.writeFile(file, `MARBLE_CREDIT_URL=https://marbledrive.app/_credit\nMARBLE_CREDIT_TOKEN=${TOKEN}\n`, { mode: 0o600 });
  const run = r.run(['--door', 'ana', '--account', ACCOUNT, '--keys', r.keys, '--credit-file', file]);
  assert.equal(run.status, 0, run.stderr);
  const env = await fsp.readFile(path.join(r.got, 'sprite.env'), 'utf8');
  assert.match(env, /^MARBLE_DRIVE_AGENT_PROVIDER=claude-credit$/m);
  assert.match(env, /^MARBLE_CREDIT_URL=https:\/\/marbledrive\.app\/_credit$/m);
  assert.match(env, new RegExp(`^MARBLE_CREDIT_TOKEN=${TOKEN}$`, 'm'));
  assert.ok(!run.stdout.includes(TOKEN) && !run.stderr.includes(TOKEN), 'the token is never printed');
});

test('a credit file of the wrong shape is refused before anything is made', async () => {
  const r = await rig();
  const file = path.join(r.home, 'credit.env');
  await fsp.writeFile(file, 'MARBLE_CREDIT_URL=http://evil.example\nMARBLE_CREDIT_TOKEN=sk-ant-oops\n');
  const run = r.run(['--door', 'ana', '--account', ACCOUNT, '--keys', r.keys, '--credit-file', file]);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /credit file/);
  assert.ok(!(await r.calls()).some((c) => c.startsWith('deploy')));
});

test('a drive made by hand with --credit mints its token from the door and says nothing needs setting up', async () => {
  const { route } = await import('../worker/src/router.js');
  const { doorEnv } = await import('./fixtures/door-env.js');
  const env = doorEnv({ CREDIT_ANTHROPIC_KEY: 'sk-ant-owner', DOOR_SIGNING_KEY: '' });
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const answer = await route(new Request(`https://marbledrive.app${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), env);
    res.writeHead(answer.status, Object.fromEntries(answer.headers));
    res.end(Buffer.from(await answer.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const r = await rig({ enter: '302 https://t-ana-abc.sprites.app/gate' });
    const conf = path.join(r.home, '.config', 'marble-drive');
    await fsp.mkdir(conf, { recursive: true, mode: 0o700 });
    await fsp.writeFile(path.join(conf, 'door.env'), `DOOR_URL=http://127.0.0.1:${server.address().port}\nDOOR_ADMIN_TOKEN=${env.DOOR_ADMIN_TOKEN}\n`, { mode: 0o600 });
    const run = await r.runAsync(['ana', '--credit']);
    assert.equal(run.status, 0, run.stderr);
    const settings = await fsp.readFile(path.join(r.got, 'sprite.env'), 'utf8');
    assert.match(settings, /^MARBLE_DRIVE_AGENT_PROVIDER=claude-credit$/m);
    const token = /^MARBLE_CREDIT_TOKEN=(mdc_[0-9a-f]{48})$/m.exec(settings)?.[1];
    assert.ok(token, settings);
    assert.ok(!run.stdout.includes(token), 'not printed');
    assert.match(run.stdout, /Agents run on starter credit to begin with/);
    assert.doesNotMatch(run.stdout, /paste your Anthropic API key/);
    const listed = await (await route(new Request('https://marbledrive.app/_credit/admin/drives', { headers: { authorization: `Bearer ${env.DOOR_ADMIN_TOKEN}` } }), env)).json();
    assert.deepEqual(listed.drives.map((d) => d.name), ['t-ana']);
  } finally {
    server.close();
  }
});
