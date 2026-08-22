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

test.after(() => fsp.rm(dir, { recursive: true, force: true }));
