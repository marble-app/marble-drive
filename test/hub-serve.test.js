// test/hub-serve.test.js
// A home host with a hub holds the sprite awake as soon as a write request
// comes in: a sprite pauses about a second after its last connection, so the
// 15 s keep-awake check alone would miss it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { touchOnWrites } from '../server/hub/schedule.js';

test('a write request holds the hub keep-awake at once', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hs-'));
  const root = path.join(dir, 'drive');
  await fsp.mkdir(root);
  const socket = path.join(dir, 's.sock');
  const tasks = [];
  const sprite = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      tasks.push({ method: req.method, url: req.url, body, at: Date.now() });
      res.writeHead(200).end('{}');
    });
  });
  await new Promise((r) => sprite.listen(socket, r));
  const lease = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"home":"fly","epoch":1}'));
  await new Promise((r) => lease.listen(0, '127.0.0.1', r));
  await fsp.writeFile(path.join(dir, 'hub-bryan.env'), [
    'HUB_DRIVE=bryan', 'HUB_MACHINE=fly', 'HUB_PASSPHRASE=p', 'HUB_SALT=s', `LEASE_URL=http://127.0.0.1:${lease.address().port}`,
    'LEASE_TOKEN=t', 'HUB_BACKEND=local', `HUB_LOCAL_DIR=${path.join(dir, 'hub')}`, '',
  ].join('\n'));
  const child = spawn(process.execPath, ['bin/marble-drive.js', 'serve'], {
    env: {
      ...process.env, MARBLE_DRIVE_ROOT: root, PORT: '4493', HOST: '127.0.0.1', MARBLE_HUB_ENV: path.join(dir, 'hub-bryan.env'),
      MARBLE_DRIVE_SPRITE_SOCKET: socket, MARBLE_DRIVE_AGENTS: '0', MARBLE_DRIVE_APP_UPDATES: '0', MARBLE_DRIVE_SECRET: '',
    },
    stdio: 'ignore',
  });
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      up = await fetch('http://127.0.0.1:4493/health').then((r) => r.ok, () => false);
    }
    assert.ok(up, 'the host answered /health');
    const hubHolds = () => tasks.filter((t) => t.method === 'POST' && t.url === '/v1/tasks' && JSON.parse(t.body).name === 'marble-drive-hub');
    await new Promise((r) => setTimeout(r, 300));
    const before = hubHolds().length;
    const sent = Date.now();
    await fetch('http://127.0.0.1:4493/no-such-route', { method: 'POST', body: '{}' }).catch(() => {});
    for (let i = 0; i < 20 && hubHolds().length === before; i += 1) await new Promise((r) => setTimeout(r, 100));
    const held = hubHolds().filter((t) => t.at >= sent);
    // Either this request made the hold, or one was already made at start; a
    // hold that waited for the 15 s check would not be here within 2 s.
    assert.ok(held.length > 0 || before > 0, 'the hub task was held');
    if (before === 0) assert.ok(held[0].at - sent < 2_000);
  } finally {
    child.kill('SIGTERM');
    sprite.close();
    lease.close();
  }
});

// The request event fires when the headers arrive, before the handler has
// written anything: an upload that starts in that gap would carry the touch
// without the write. So a write request touches again when its response
// closes (after it finished, or when the client gave up).
test('a write request touches when it arrives and again when its response ends, finished or aborted', async () => {
  let wrote = false;
  const touches = [];
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      wrote = true; // the write lands after the headers came in
      res.end('ok');
    }, 50);
  });
  touchOnWrites(server, () => touches.push({ wrote }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await (await fetch(`${base}/api/doc`, { method: 'POST', body: '{}' })).text();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(touches.map((t) => t.wrote), [false, true], 'once on arrival, once after the write');
    for (const [method, route] of [['GET', '/doc.mrbl'], ['HEAD', '/doc.mrbl'], ['POST', '/tab/alive'], ['POST', '/tab/alive?x=1']]) {
      wrote = false;
      await (await fetch(`${base}${route}`, { method, ...(method === 'POST' && { body: '{}' }) })).text();
    }
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(touches.length, 2, 'reads and the tab heartbeat do not touch');

    // A client that gives up before the response still gets its second touch.
    const gone = new AbortController();
    const aborted = fetch(`${base}/api/doc`, { method: 'POST', body: '{}', signal: gone.signal }).catch(() => 'aborted');
    await new Promise((r) => setTimeout(r, 10));
    gone.abort();
    assert.equal(await aborted, 'aborted');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(touches.length, 4, 'one on arrival, one when the connection closed');
  } finally {
    server.close();
  }
});
