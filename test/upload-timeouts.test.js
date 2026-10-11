// A big file over a slow link: the upload is timed by silence, not by length.
//
// Node gives a whole request five minutes by default (`requestTimeout`), which
// quietly capped a dropped file at whatever the link could carry in five
// minutes — a 2 GB cap that was really ~600 MB at 2 MB/s. An upload now runs as
// long as bytes keep arriving, and is cut only after MARBLE_DRIVE_UPLOAD_IDLE_SECONDS
// of nothing.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-upload-idle-'));
const config = loadConfig({ MARBLE_DRIVE_ROOT: ROOT, MARBLE_DRIVE_UPLOAD_IDLE_SECONDS: '1' });
const drive = await createDrive(config, { log: { log() {}, error() {} } });
const port = await new Promise((resolve) => {
  drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port));
});
test.after(async () => {
  await drive.close();
  await fsp.rm(ROOT, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** POST a file in pieces, waiting `gap` ms before each. Resolves with the
 *  status and body, or with `{ cut: true }` when the host hangs up. */
function trickle(name, pieces, gap) {
  return new Promise((resolve) => {
    const req = http.request({
      port,
      host: '127.0.0.1',
      method: 'POST',
      path: `/drive/upload-file?folder=&name=${encodeURIComponent(name)}&client=t`,
      headers: { 'Content-Type': 'application/octet-stream' },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ cut: true }));
    (async () => {
      for (const piece of pieces) {
        await sleep(gap);
        if (req.destroyed) return;
        req.write(piece);
      }
      req.end();
    })();
  });
}

test('the host sets no deadline on a whole request', () => {
  assert.equal(drive.server.requestTimeout, 0);
});

test('an upload that keeps sending outlives the idle limit many times over', async () => {
  const pieces = Array.from({ length: 8 }, (_, i) => Buffer.alloc(1024, i));
  const answer = await trickle('slow.bin', pieces, 400);
  assert.equal(answer.status, 200, JSON.stringify(answer));
  const on = await fsp.readFile(path.join(ROOT, 'slow.bin'));
  assert.equal(on.length, 8 * 1024);
});

test('an upload that goes quiet is cut, and leaves nothing behind', async () => {
  const pieces = [Buffer.alloc(1024, 1), Buffer.alloc(1024, 2)];
  const answer = await trickle('stalled.bin', pieces, 2500);
  assert.equal(answer.cut ?? answer.status >= 400, true, JSON.stringify(answer));
  // The client hears the hang-up before the host has finished tidying, so wait
  // for the part file to go rather than looking once.
  const stalled = async () => (await fsp.readdir(ROOT)).filter((n) => n.includes('stalled'));
  for (let waited = 0; (await stalled()).length && waited < 3000; waited += 50) await sleep(50);
  assert.deepEqual(await stalled(), []);
});
