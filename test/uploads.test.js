// Uploads that survive the link they travel over: a big file goes up in
// chunks through a session, a dropped chunk is retried from what the host
// actually has, and a reload can pick the session up again. Nothing
// half-arrived is ever listed.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

async function host(env = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-uploads-'));
  const drive = await createDrive(loadConfig({
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_UPLOAD_CHUNK: '8',
    MARBLE_DRIVE_MAX_FILE: '64',
    MARBLE_DRIVE_UPLOAD_MARGIN: '0',
    ...env,
  }), { log: { log() {}, error() {} }, agents: false });
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, route, body) => {
    const init = { method };
    if (body instanceof Uint8Array || typeof body === 'string') init.body = body;
    else if (body) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    const res = await fetch(base + route, init);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return { root, drive, call, close: () => drive.close() };
}

const bytes = (n) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 37) % 256));

test('a file assembles byte for byte from its chunks, and appears only when finished', async (t) => {
  const h = await host();
  t.after(h.close);
  const whole = bytes(20);
  const started = await h.call('POST', '/drive/uploads', { folder: 'Clips', name: 'take (1).mov', bytes: 20, modified: 5 });
  assert.equal(started.status, 200);
  assert.equal(started.body.chunk, 8);
  assert.equal(started.body.received, 0);
  const { id } = started.body;

  for (let at = 0; at < 20; at += 8) {
    const put = await h.call('PUT', `/drive/uploads/${id}?offset=${at}`, whole.subarray(at, at + 8));
    assert.equal(put.status, 200);
    assert.equal(put.body.received, Math.min(at + 8, 20));
  }
  const tree = await h.drive.store.list({ folder: '', files: true });
  assert.ok(!tree.some((e) => /take/.test(e.path)), 'nothing listed before finish');

  const done = await h.call('POST', `/drive/uploads/${id}/finish`);
  assert.equal(done.status, 200);
  assert.equal(done.body.path, 'Clips/take 1.mov');
  assert.equal(done.body.bytes, 20);
  assert.deepEqual(await fsp.readFile(path.join(h.root, 'Clips', 'take 1.mov')), whole);
  assert.deepEqual(await fsp.readdir(path.join(h.root, '.marble', 'uploads')), []);
});

test('a chunk sent at the wrong place is refused with where the host is, and a retried chunk does not duplicate', async (t) => {
  const h = await host();
  t.after(h.close);
  const whole = bytes(16);
  const { body: { id } } = await h.call('POST', '/drive/uploads', { folder: '', name: 'a.bin', bytes: 16 });
  await h.call('PUT', `/drive/uploads/${id}?offset=0`, whole.subarray(0, 8));
  // The answer to that chunk was lost, so the page sends it again.
  const again = await h.call('PUT', `/drive/uploads/${id}?offset=0`, whole.subarray(0, 8));
  assert.equal(again.status, 409);
  assert.equal(again.body.received, 8);
  assert.equal((await h.call('GET', `/drive/uploads/${id}`)).body.received, 8);
  await h.call('PUT', `/drive/uploads/${id}?offset=8`, whole.subarray(8));
  const done = await h.call('POST', `/drive/uploads/${id}/finish`);
  assert.equal(done.status, 200);
  assert.deepEqual(await fsp.readFile(path.join(h.root, 'a.bin')), whole);
});

test('finishing early, sending too much, and an unknown session are all refused', async (t) => {
  const h = await host();
  t.after(h.close);
  const { body: { id } } = await h.call('POST', '/drive/uploads', { folder: '', name: 'b.bin', bytes: 10 });
  await h.call('PUT', `/drive/uploads/${id}?offset=0`, bytes(8));
  assert.equal((await h.call('POST', `/drive/uploads/${id}/finish`)).status, 409);
  assert.equal((await h.call('PUT', `/drive/uploads/${id}?offset=8`, bytes(8))).status, 413);
  assert.equal((await h.call('GET', `/drive/uploads/${id}`)).body.received, 8, 'the overflow was not kept');
  assert.equal((await h.call('GET', '/drive/uploads/nope')).status, 404);
});

test('cancel, and the sweep of a session nobody came back for, leave nothing behind', async (t) => {
  const h = await host();
  t.after(h.close);
  const one = (await h.call('POST', '/drive/uploads', { folder: '', name: 'c.bin', bytes: 10 })).body.id;
  await h.call('PUT', `/drive/uploads/${one}?offset=0`, bytes(8));
  assert.equal((await h.call('DELETE', `/drive/uploads/${one}`)).status, 200);
  assert.equal((await h.call('GET', `/drive/uploads/${one}`)).status, 404);

  const two = (await h.call('POST', '/drive/uploads', { folder: '', name: 'd.bin', bytes: 10 })).body.id;
  await h.call('PUT', `/drive/uploads/${two}?offset=0`, bytes(8));
  const swept = await h.drive.uploads.sweep({ now: Date.now() + 25 * 60 * 60 * 1000 });
  assert.equal(swept, 1);
  assert.equal((await h.call('GET', `/drive/uploads/${two}`)).status, 404);
  assert.deepEqual(await fsp.readdir(path.join(h.root, '.marble', 'uploads')), []);
});

test('a file too big for the cap, or for the disk, is refused before a byte is sent', async (t) => {
  const h = await host();
  t.after(h.close);
  const over = await h.call('POST', '/drive/uploads', { folder: '', name: 'big.bin', bytes: 65 });
  assert.equal(over.status, 413);
  const full = await host({ MARBLE_DRIVE_MAX_FILE: String(2 ** 50), MARBLE_DRIVE_UPLOAD_MARGIN: String(2 ** 60) });
  t.after(full.close);
  const refused = await full.call('POST', '/drive/uploads', { folder: '', name: 'big.bin', bytes: 10 });
  assert.equal(refused.status, 507);
  assert.match(refused.body.error, /room/);
  const single = await full.call('POST', '/drive/upload-file?folder=&name=x.bin&client=t', bytes(10));
  assert.equal(single.status, 507);
});

test('the default cap is 20 GB', () => {
  assert.equal(loadConfig({ MARBLE_DRIVE_ROOT: os.tmpdir() }).maxFileBytes, 20 * 1024 ** 3);
});
