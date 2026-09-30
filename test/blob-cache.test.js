// test/blob-cache.test.js
// A blob never changes behind its hash, so it is cached for a year, but only
// by the browser: it sits behind the gate, and no shared cache (a CDN in
// front of the front door) may keep a copy for someone else.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';

test('a blob is cached privately, forever', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'blob-cache-'));
  const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root }), { log: { log() {}, error() {}, info() {} }, agents: false });
  t.after(() => drive.close());
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const put = await (await fetch(`${base}/blob`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello' })).json();
  const res = await fetch(`${base}${put.href}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.equal(await res.text(), 'hello');
});
