import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compareOps, createOpLog } from '../server/oplog.js';

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-ops-'));
const log = createOpLog({ dir });

test('every line carries who filed it and their count of it', async () => {
  await log.append('work/notes', [{ type: 'setText', id: 'a', text: 'x' }], { client: 'c1' });
  await log.append('work/notes', [
    { type: 'move', id: 'b', parentId: 'p', beforeId: null },
    { type: 'remove', id: 'c' },
  ], { client: 'c2' });

  const lines = await log.since('work/notes');
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.equal(line.doc, 'work/notes');
    assert.ok(Number.isFinite(line.t));
    assert.ok(line.client);
    assert.ok(Number.isInteger(line.seq));
  }
  assert.deepEqual(lines.map((l) => l.seq), [1, 1, 2]);
  assert.deepEqual(lines.map((l) => l.client), ['c1', 'c2', 'c2']);
});

test('the log for a nested document is one flat file', async () => {
  const files = await fsp.readdir(dir);
  assert.deepEqual(files, ['work%2Fnotes.ops.jsonl']);
});

test('two clients inside one millisecond still have a total order', () => {
  const a = { t: 10, client: 'a', seq: 2 };
  const b = { t: 10, client: 'a', seq: 1 };
  const c = { t: 10, client: 'b', seq: 1 };
  const d = { t: 9, client: 'z', seq: 99 };
  const sorted = [a, b, c, d].sort(compareOps);
  assert.deepEqual(sorted, [d, b, a, c]);
  // And the order is stable: sorting it again does not move anything.
  assert.deepEqual([...sorted].sort(compareOps), sorted);
});

test('a truncated last line does not take the reader down', async () => {
  await fsp.appendFile(path.join(dir, 'work%2Fnotes.ops.jsonl'), '{"t":1,"doc":"work/n');
  assert.equal((await log.since('work/notes')).length, 3);
});

test('a batch id rides every line of its batch, and is read back after a restart', async () => {
  const own = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-ops-batch-'));
  try {
    const first = createOpLog({ dir: own });
    await first.append('doc', [{ type: 'setText', id: 'a', text: '1' }, { type: 'setText', id: 'b', text: '2' }], { client: 'tab', batch: 'b-1' });
    await first.append('doc', [{ type: 'setText', id: 'a', text: '3' }], { client: 'tab' });
    const lines = await first.since('doc');
    assert.deepEqual(lines.map((l) => l.batch), ['b-1', 'b-1', undefined]);

    // A new process: seq starts again, the batch ids do not.
    const again = createOpLog({ dir: own });
    const seen = await again.batches('doc');
    assert.deepEqual([...seen.keys()], ['b-1']);
    assert.equal(seen.get('b-1').applied, 2);
    assert.equal(seen.get('b-1').client, 'tab');
  } finally {
    await fsp.rm(own, { recursive: true, force: true });
  }
});

test('the active log is sealed into a segment once it passes the limit, and since() reads across segments', async () => {
  const own = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-ops-seg-'));
  try {
    const log = createOpLog({ dir: own, maxBytes: 600 });
    const text = 'x'.repeat(100);
    for (let i = 0; i < 30; i += 1) {
      await log.append('work/notes', [{ type: 'setText', id: `n${i}`, text }], { client: 'tab', batch: `b${i}` });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const names = (await fsp.readdir(own)).sort();
    const sealed = names.filter((n) => n.includes('@'));
    assert.ok(sealed.length >= 4, `sealed segments: ${names.join(', ')}`);
    for (const name of sealed) assert.match(name, /^work%2Fnotes@\d+-\d+(-\d+)?\.ops\.jsonl$/);
    assert.ok(names.includes('work%2Fnotes.ops.jsonl'), 'a new active log');
    const active = await fsp.stat(path.join(own, 'work%2Fnotes.ops.jsonl'));
    assert.ok(active.size < 600 + 300, 'the active log stays near the limit');

    // Every line, in order, across all segments.
    const all = await log.since('work/notes', { limit: 1000 });
    assert.deepEqual(all.map((l) => l.id), Array.from({ length: 30 }, (_, i) => `n${i}`));
    // The tail only, read from the newest segments.
    const tail = await log.since('work/notes', { limit: 5 });
    assert.deepEqual(tail.map((l) => l.id), ['n25', 'n26', 'n27', 'n28', 'n29']);
    // After a time: only what came later.
    const after = await log.since('work/notes', { after: all[19].t, limit: 1000 });
    assert.ok(after.every((l) => l.t > all[19].t));
    assert.ok(after.map((l) => l.id).includes('n29'));

    // A sealed segment is never written again: its bytes stay as they were.
    const before = await Promise.all(sealed.map((n) => fsp.readFile(path.join(own, n), 'utf8')));
    await log.append('work/notes', [{ type: 'remove', id: 'n0' }], { client: 'tab' });
    const later = await Promise.all(sealed.map((n) => fsp.readFile(path.join(own, n), 'utf8')));
    assert.deepEqual(later, before);
  } finally {
    await fsp.rm(own, { recursive: true, force: true });
  }
});

test('a log already over the limit when the host starts is sealed on its next append', async () => {
  const own = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-ops-old-'));
  try {
    const old = Array.from({ length: 50 }, (_, i) => JSON.stringify({ t: 1000 + i, doc: 'big', client: 'c', seq: i + 1, type: 'remove', id: `o${i}` })).join('\n');
    await fsp.writeFile(path.join(own, 'big.ops.jsonl'), `${old}\n`);
    const log = createOpLog({ dir: own, maxBytes: 1000 });
    const { sealed } = await log.append('big', [{ type: 'remove', id: 'new' }], { client: 'c' });
    assert.ok(sealed, 'sealed on the first append');
    assert.match(path.basename(sealed), /^big@1000-\d+\.ops\.jsonl$/, 'named from its own first line');
    assert.equal((await fsp.readFile(path.join(own, 'big.ops.jsonl'), 'utf8')).trim().split('\n').length, 1);
    const all = await log.since('big', { limit: 100 });
    assert.equal(all.length, 51);
    assert.equal(all.at(-1).id, 'new');
    // Another document whose name starts the same is not mixed in.
    await log.append('big2', [{ type: 'remove', id: 'x' }], { client: 'c' });
    assert.equal((await log.since('big', { limit: 100 })).length, 51);
  } finally {
    await fsp.rm(own, { recursive: true, force: true });
  }
});

test('the segment size comes from MARBLE_OPLOG_SEGMENT_BYTES', async () => {
  const own = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-ops-env-'));
  const was = process.env.MARBLE_OPLOG_SEGMENT_BYTES;
  process.env.MARBLE_OPLOG_SEGMENT_BYTES = '200';
  try {
    const log = createOpLog({ dir: own });
    for (let i = 0; i < 6; i += 1) await log.append('d', [{ type: 'setText', id: 'a', text: 'y'.repeat(80) }], { client: 'c' });
    assert.ok((await log.segments('d')).length >= 2);
  } finally {
    if (was === undefined) delete process.env.MARBLE_OPLOG_SEGMENT_BYTES;
    else process.env.MARBLE_OPLOG_SEGMENT_BYTES = was;
    await fsp.rm(own, { recursive: true, force: true });
  }
});

test.after(() => fsp.rm(dir, { recursive: true, force: true }));
