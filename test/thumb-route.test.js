// The host keeps a picture the page drew, on a host with no QuickLook — every
// host but a Mac, and a Mac with MARBLE_DRIVE_QUICKLOOK=0.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-thumb-route-'));
const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_QUICKLOOK: '0' }), { log: { log() {}, error() {} }, agents: false });
const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
const base = `http://127.0.0.1:${port}`;
test.after(() => drive.close());

await fsp.mkdir(path.join(root, 'Papers'), { recursive: true });
await fsp.writeFile(path.join(root, 'Papers', 'draft.pdf'), '%PDF-1.4 not really');

const png = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const thumb = (p) => `${base}/drive/thumb?path=${encodeURIComponent(p)}&w=640`;
const put = (p, body, type = 'image/png') => fetch(thumb(p), { method: 'PUT', headers: { 'Content-Type': type }, body });

test('with no QuickLook and nothing drawn, there is no picture', async () => {
  assert.equal((await fetch(thumb('Papers/draft.pdf'))).status, 404);
});

test('a picture the page drew is kept and served as what it is', async () => {
  const drawn = png(640, 905);
  assert.equal((await put('Papers/draft.pdf', drawn)).status, 200);
  const got = await fetch(thumb('Papers/draft.pdf'));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), drawn);
});

test('a picture of nothing, or that is not a picture, is refused', async () => {
  assert.equal((await put('Papers/missing.pdf', png(10, 10))).status, 404);
  assert.equal((await put('Papers/draft.pdf', Buffer.from('<svg/>'), 'image/svg+xml')).status, 400);
  assert.equal((await put('Papers/draft.pdf', Buffer.alloc(600 * 1024))).status, 413);
});
