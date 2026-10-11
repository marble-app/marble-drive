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

/** A stand-in for /.sprite/api.sock that behaves as the real one does: a task
 *  is made by POST (409 if its name exists), extended by PUT to its name (404
 *  if it does not), and let go by DELETE. `status` overrides every answer. */
async function fakeSprite({ status = null } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ka-'));
  const socket = path.join(dir, 'api.sock');
  const calls = [];
  const tasks = new Set();
  const state = { status };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : null;
      calls.push({ method: req.method, url: req.url, body: parsed });
      const named = decodeURIComponent(req.url.split('/v1/tasks/')[1] ?? '');
      let code = 404;
      if (req.method === 'POST' && req.url === '/v1/tasks') {
        code = tasks.has(parsed.name) ? 409 : 201;
        tasks.add(parsed.name);
      } else if (req.method === 'PUT' && named) code = tasks.has(named) ? 200 : 404;
      else if (req.method === 'DELETE' && named) code = tasks.delete(named) ? 204 : 404;
      res.writeHead(state.status ?? code, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  return { socket, calls, state, tasks, close: () => new Promise((resolve) => server.close(resolve)) };
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
  // Renewed by extending the task: a second POST of the same name is a 409.
  await until(() => sprite.calls.filter((c) => c.method === 'PUT').length >= 2);
  const puts = sprite.calls.filter((c) => c.method === 'PUT');
  assert.deepEqual(puts[0], { method: 'PUT', url: '/v1/tasks/marble-drive', body: { expire: '5m' } });
  assert.ok(puts.length <= 3, `renewed on its interval, not every check (${puts.length})`);
  assert.equal(sprite.calls.filter((c) => c.method === 'POST').length, 1);

  busy = false;
  await until(() => sprite.calls.some((c) => c.method === 'DELETE'));
  assert.deepEqual(sprite.calls.find((c) => c.method === 'DELETE').url, '/v1/tasks/marble-drive');
  // Let go once the sprite has answered, not the moment it was asked.
  await until(() => !ka.state().held);
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
  sprite.state.status = null;
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

test('work that starts is held at once, not at the next check', async (t) => {
  // A sprite pauses about a second after its last connection closes: the
  // request that started a turn is often the last one, so waiting for the
  // next 15 s check lets it freeze first.
  const sprite = await fakeSprite();
  t.after(sprite.close);
  let busy = false;
  const ka = createKeepAwake({ socket: sprite.socket, busy: () => busy, checkMs: 60_000, log: { error() {} } });
  t.after(() => ka.stop());
  ka.start();
  await sleep(50);
  busy = true;
  ka.nudge();
  await until(() => sprite.calls.some((c) => c.method === 'POST'), 300);
});

test('a task that is already there (a host restarted) is extended; one that lapsed is made again', async (t) => {
  const sprite = await fakeSprite();
  t.after(sprite.close);
  sprite.tasks.add('marble-drive');
  const ka = createKeepAwake({ socket: sprite.socket, busy: () => true, checkMs: 20, renewMs: 60, log: { error() {} } });
  t.after(() => ka.stop());
  ka.start();
  await until(() => ka.state().held);
  assert.ok(sprite.calls.some((c) => c.method === 'PUT'), 'a 409 on POST is taken up by extending');

  sprite.tasks.clear(); // expired while the host was not looking
  const before = sprite.calls.filter((c) => c.method === 'POST').length;
  await until(() => sprite.calls.filter((c) => c.method === 'POST').length > before && sprite.tasks.has('marble-drive'));
});

test('letting go of a task that already lapsed is done, not retried forever', async (t) => {
  const sprite = await fakeSprite();
  t.after(sprite.close);
  let busy = true;
  const ka = createKeepAwake({ socket: sprite.socket, busy: () => busy, checkMs: 20, renewMs: 10_000, log: { error() {} } });
  t.after(() => ka.stop());
  ka.start();
  await until(() => ka.state().held);
  sprite.tasks.clear();
  busy = false;
  await until(() => !ka.state().held, 500);
  await sleep(100);
  assert.equal(sprite.calls.filter((c) => c.method === 'DELETE').length, 1);
});
