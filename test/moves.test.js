// Moving a document changes its address, and what pointed at the old address
// has to still land: a kept link forwards, however many moves ago it was
// kept; a folder's move carries what is under it; a name taken again belongs
// to the new document; and the Drive's pins follow in its own file.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createMoves } from '../server/moves.js';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-moves-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

const quiet = { log() {}, error() {} };
const drive = await createDrive(loadConfig(), { log: quiet, agents: false });
const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
const base = `http://127.0.0.1:${port}`;
test.after(() => drive.close());

const DOC = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body data-marble-id="b"><p data-marble-id="p">${title}</p></body></html>`;
const DRIVE = `<!doctype html><html><head><meta charset="utf-8"><title>My Drive</title></head><body data-marble-id="b">
<ul class="pins" id="pins" data-marble-id="pins">
  <li class="pin" data-marble-id="p1" data-path="Research/atlas" data-kind="doc"><span data-marble-id="p1l">atlas</span></li>
  <li class="pin" data-marble-id="p2" data-path="Travel" data-kind="folder"><span data-marble-id="p2l">Travel</span></li>
  <li class="pin" data-marble-id="p3" data-path="Travel/plans" data-kind="doc"><span data-marble-id="p3l">plans</span></li>
</ul></body></html>`;

const move = async (from, to) => {
  const res = await fetch(`${base}/drive/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }) });
  assert.ok(res.ok, `${res.status} ${await res.text()}`);
};
const where = async (p) => {
  const res = await fetch(`${base}/a/${encodeURIComponent(p)}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') };
};

test('the record: a chain resolves to its end, a folder carries its contents, and moving back undoes nothing twice', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moves-'));
  const moves = createMoves({ dir });
  await moves.note('a', 'b');
  await moves.note('b', 'Folder/c');
  assert.equal(await moves.resolve('a'), 'Folder/c');
  assert.equal(await moves.resolve('b'), 'Folder/c');
  await moves.note('Folder', 'Other', 'folder');
  assert.equal(await moves.resolve('a'), 'Other/c', 'through a folder move too');
  assert.equal(await moves.resolve('Folder/x/y'), 'Other/x/y');
  // Back where it started: its first address is live again, and nothing loops.
  await moves.note('Other/c', 'a');
  assert.equal(await moves.resolve('a'), null);
  assert.equal(await moves.resolve('nowhere'), null);
  // It is a file, read again by the next host.
  assert.equal(await createMoves({ dir }).resolve('b'), 'a');
});

test('an old address forwards to where the document went, and the Drive\'s pins follow it', async () => {
  await drive.createDocument('drive', DRIVE, { label: 'test' });
  await drive.createDocument('Research/atlas', DOC('Atlas'), { label: 'test' });
  await drive.createDocument('Travel/plans', DOC('Plans'), { label: 'test' });

  await move('Research/atlas', 'Archive/atlas');
  assert.deepEqual(await where('Research/atlas'), { status: 302, location: `/a/${encodeURIComponent('Archive/atlas')}` });
  assert.equal((await where('Archive/atlas')).status, 200);

  await move('Travel', 'Trips');
  assert.deepEqual(await where('Travel/plans'), { status: 302, location: `/a/${encodeURIComponent('Trips/plans')}` });

  const pins = await drive.store.read('drive');
  assert.match(pins, /data-marble-id="p1"[^>]*data-path="Archive\/atlas"/);
  assert.match(pins, /data-marble-id="p2"[^>]*data-path="Trips"/);
  assert.match(pins, /data-marble-id="p3"[^>]*data-path="Trips\/plans"/);

  // A new document at an old address is that document, not a forward.
  await drive.createDocument('Research/atlas', DOC('A new atlas'), { label: 'test' });
  assert.equal((await where('Research/atlas')).status, 200);
  // And an address nothing ever lived at is still nothing.
  assert.equal((await where('never/was')).status, 404);
});
