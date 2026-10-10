// server/provisioner.js: the door sprite takes queued drives one at a time,
// runs the provisioning script for each, and reports its steps to the door.
// Here the door is the real Worker code over a Directory in memory, and the
// script is a fake that prints what the real one prints.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { createProvisioner, scriptRunner } from '../server/provisioner.js';
import { forgetLeases, route } from '../worker/src/router.js';
import { browser, signInWith } from './fixtures/door-browser.js';
import { doorEnv, fakeProviders } from './fixtures/door-env.js';

beforeEach(() => forgetLeases());
const quiet = { log() {}, error() {} };

async function door(names = ['ana']) {
  const env = doorEnv();
  const google = { sub: '1', email: 'ana@example.com', name: 'Ana' };
  const fake = fakeProviders({ google });
  fake.setNonce = (n) => {
    google.nonce = n;
  };
  const fetchImpl = (input, init) => (String(input).startsWith('https://marbledrive.app/') ? route(new Request(input, init), env, { fetchImpl: fake.fetchImpl }) : fake.fetchImpl(input, init));
  const admin = async (method, path, body) =>
    (await fetchImpl(`https://marbledrive.app/_door${path}`, { method, headers: { authorization: `Bearer ${env.DOOR_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
  for (const [i, name] of names.entries()) {
    const code = (await admin('POST', '/invite', {})).link.split('/join/')[1];
    google.sub = String(i + 1);
    const b = browser(env, { fetchImpl: fake.fetchImpl, ip: `198.51.100.${i + 1}` });
    await signInWith(b, 'google', { invite: code, fake });
    const made = await b.form('/name', { name });
    assert.equal(made.status, 303);
  }
  return { env, fetchImpl, admin };
}

const SECRET = 'Zq8yP3rT6vW9xB2nM5kL7jH4';
const script = (lines, code = 0) => async (job, onLine) => {
  for (const line of lines(job)) await onLine(line);
  return code;
};

test('a queued drive is made: each step reported, then ready with its sprite URL', async () => {
  const d = await door(['ana']);
  const seen = [];
  const p = createProvisioner({
    directoryUrl: 'https://marbledrive.app',
    adminToken: d.env.DOOR_ADMIN_TOKEN,
    fetchImpl: d.fetchImpl,
    log: quiet,
    run: async (job, onLine) => {
      seen.push(job);
      for (const line of ['==> creating d-ana', 'step: machine now', 'step: machine done', `MARBLE_DRIVE_SECRET=${SECRET}`, 'step: install now']) await onLine(line);
      const mid = (await d.admin('GET', '/drives')).drives[0];
      assert.deepEqual(mid.steps, { machine: 'done', install: 'now' });
      for (const line of ['step: install done', 'step: check now', 'step: check done', 'url: https://d-ana-abc.sprites.app']) await onLine(line);
      return 0;
    },
  });
  assert.deepEqual(await p.once(), { made: 'ana' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, 'ana');
  assert.match(seen[0].account, /^[0-9a-f]{16}$/);
  const drive = (await d.admin('GET', '/drives')).drives[0];
  assert.equal(drive.state, 'ready');
  assert.equal(drive.homes.fly, 'https://d-ana-abc.sprites.app');
  assert.equal(drive.sprite, 'd-ana');
  assert.ok(!JSON.stringify(await d.admin('GET', '/log')).includes(SECRET), 'nothing the script said beyond its steps reached the door');
  assert.deepEqual(await p.once(), { idle: true });
});

test('a script that exits non-zero marks the drive failed, naming the step it was on', async () => {
  const d = await door(['ana']);
  const p = createProvisioner({
    directoryUrl: 'https://marbledrive.app',
    adminToken: d.env.DOOR_ADMIN_TOKEN,
    fetchImpl: d.fetchImpl,
    log: quiet,
    run: script(() => ['step: machine now', 'step: machine done', 'step: install now', 'sprite-deploy: npm failed'], 1),
  });
  assert.deepEqual(await p.once(), { failed: 'ana', step: 'install' });
  const drive = (await d.admin('GET', '/drives')).drives[0];
  assert.equal(drive.state, 'failed');
  assert.equal(drive.failed, 'install');
});

test('one at a time: a second once while one runs does nothing, and drain takes the queue in order', async () => {
  const d = await door(['ana', 'bob']);
  let release;
  const order = [];
  const p = createProvisioner({
    directoryUrl: 'https://marbledrive.app',
    adminToken: d.env.DOOR_ADMIN_TOKEN,
    fetchImpl: d.fetchImpl,
    log: quiet,
    run: async (job, onLine) => {
      order.push(job.name);
      if (job.name === 'ana') await new Promise((r) => (release = r));
      await onLine(`url: https://d-${job.name}-x.sprites.app`);
      return 0;
    },
  });
  const first = p.drain();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.busy(), true);
  assert.deepEqual(await p.once(), { skipped: true });
  release();
  assert.deepEqual(await first, { idle: true });
  assert.deepEqual(order, ['ana', 'bob']);
  assert.deepEqual((await d.admin('GET', '/drives')).drives.map((x) => x.state), ['ready', 'ready']);
});

test('the poke wants the door token; with it, the queue is drained', async () => {
  const d = await door(['ana']);
  let ran = 0;
  const p = createProvisioner({
    directoryUrl: 'https://marbledrive.app',
    adminToken: d.env.DOOR_ADMIN_TOKEN,
    fetchImpl: d.fetchImpl,
    log: quiet,
    run: async (job, onLine) => {
      ran += 1;
      await onLine('url: https://d-ana-abc.sprites.app');
      return 0;
    },
  });
  const server = await p.serve(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/poke`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/poke`, { method: 'POST', headers: { 'x-door-token': 'wrong' } })).status, 401);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/poke`, { method: 'POST', headers: { 'x-door-token': d.env.DOOR_ADMIN_TOKEN } })).status, 202);
    for (let i = 0; i < 50 && ran === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i < 50 && p.busy(); i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(ran, 1);
    assert.equal((await d.admin('GET', '/drives')).drives[0].state, 'ready');
  } finally {
    server.close();
  }
});

test('scriptRunner hands each line over in order and resolves with the exit code', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const fakeSpawn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.args = args;
    setImmediate(() => {
      child.stdout.end('step: machine now\nstep: machine done\nurl: https://x.sprites.app\n');
      child.stderr.end('');
      setTimeout(() => child.emit('close', 0), 20);
    });
    fakeSpawn.last = child;
    return child;
  };
  const lines = [];
  const run = scriptRunner({ script: '/x/sprite-provision.sh', keysFile: '/k', spawnImpl: fakeSpawn, log: quiet });
  const code = await run({ name: 'ana', account: 'a1b2c3d4e5f60718' }, async (l) => lines.push(l));
  assert.equal(code, 0);
  assert.deepEqual(lines, ['step: machine now', 'step: machine done', 'url: https://x.sprites.app']);
  assert.deepEqual(fakeSpawn.last.args, ['/x/sprite-provision.sh', '--door', 'ana', '--account', 'a1b2c3d4e5f60718', '--keys', '/k', '--org', 'marble-drive']);
});
