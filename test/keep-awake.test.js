// On a Fly Sprite, a host with work running and no tab watching must not let
// the sprite pause: it holds a task on the sprite's API socket while it is
// busy, renews it, and lets it go when it is not. Anywhere else it does nothing.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createKeepAwake } from '../server/keep-awake.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A stand-in for /.sprite/api.sock: records every request, answers `status`. */
async function fakeSprite({ status = 200 } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ka-'));
  const socket = path.join(dir, 'api.sock');
  const calls = [];
  const state = { status };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      res.writeHead(state.status, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  return { socket, calls, state, close: () => new Promise((resolve) => server.close(resolve)) };
}

const until = async (check, ms = 2000) => {
  for (let t = 0; t < ms; t += 10) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error('timed out');
};

test('busy holds a task, renews it, and idle lets it go', async (t) => {
  const sprite = await fakeSprite();
  t.after(sprite.close);
  let busy = true;
  const ka = createKeepAwake({ socket: sprite.socket, busy: () => busy, checkMs: 20, renewMs: 80, log: { error() {} } });
  t.after(() => ka.stop());
  ka.start();
  await until(() => sprite.calls.length >= 1);
  assert.deepEqual(sprite.calls[0], { method: 'POST', url: '/v1/tasks', body: { name: 'marble-drive', expire: '5m' } });
  await until(() => sprite.calls.filter((c) => c.method === 'POST').length >= 2);
  const posts = sprite.calls.filter((c) => c.method === 'POST').length;
  assert.ok(posts <= 3, `renewed on its interval, not every check (${posts})`);

  busy = false;
  await until(() => sprite.calls.some((c) => c.method === 'DELETE'));
  assert.deepEqual(sprite.calls.find((c) => c.method === 'DELETE').url, '/v1/tasks/marble-drive');
  assert.equal(ka.state().held, false);
});

test('with no sprite socket it does nothing at all', async () => {
  let asked = 0;
  const ka = createKeepAwake({ socket: path.join(os.tmpdir(), 'no-such-dir', 'api.sock'), busy: () => { asked += 1; return true; }, checkMs: 10 });
  ka.start();
  await sleep(60);
  ka.stop();
  assert.equal(asked, 0);
  assert.equal(ka.state().active, false);
});

test('a sprite API that answers an error does not stop the host, and is asked again', async (t) => {
  const sprite = await fakeSprite({ status: 500 });
  t.after(sprite.close);
  const ka = createKeepAwake({ socket: sprite.socket, busy: () => true, checkMs: 20, renewMs: 80, log: { error() {} } });
  t.after(() => ka.stop());
  ka.start();
  await until(() => sprite.calls.length >= 2);
  assert.equal(ka.state().held, false, 'nothing is held that the sprite refused');
  sprite.state.status = 200;
  await until(() => ka.state().held);
});

test('stopping lets a held task go', async (t) => {
  const sprite = await fakeSprite();
  t.after(sprite.close);
  const ka = createKeepAwake({ socket: sprite.socket, busy: () => true, checkMs: 20, renewMs: 1000, log: { error() {} } });
  ka.start();
  await until(() => ka.state().held);
  await ka.stop();
  assert.ok(sprite.calls.some((c) => c.method === 'DELETE'));
});

test('the host starts it against the sprite socket it is given, and stops it on close', async (t) => {
  const sprite = await fakeSprite();
  t.after(sprite.close);
  const { createDrive } = await import('../server/app.js');
  const { loadConfig } = await import('../server/config.js');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ka-host-'));
  const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SPRITE_SOCKET: sprite.socket }), { log: { log() {}, error() {} }, agents: false });
  assert.equal(drive.keepAwake.state().active, true);
  await sleep(50);
  assert.deepEqual(sprite.calls, [], 'an idle host holds nothing');
  await drive.close();
  assert.equal(drive.keepAwake.state().active, false);
});
