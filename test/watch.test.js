import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-watch-'));
process.env.MARBLE_APPS = ROOT;

const { createStore } = await import('../server/store/index.js');
const { watchDrive } = await import('../server/watch.js');

const store = createStore({ root: ROOT });
await store.ready();

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the watcher reported, over a window long enough for the 80ms debounce
 *  and a filesystem event to land. */
async function watching(fn, { recursiveSupported } = {}) {
  const seen = [];
  const watcher = watchDrive(store, (docPath) => seen.push(docPath), { recursiveSupported });
  await settle(80);
  await fn();
  await settle();
  watcher.close();
  return seen;
}

test('a document at the root is seen', async () => {
  const seen = await watching(() => fsp.writeFile(path.join(ROOT, 'top.mrbl'), '<html></html>'));
  assert.deepEqual(seen, ['top']);
});

test('a document three folders down is seen — the thing a flat watch misses', async () => {
  await fsp.mkdir(path.join(ROOT, 'work/q3'), { recursive: true });
  const seen = await watching(() =>
    fsp.writeFile(path.join(ROOT, 'work/q3/notes.mrbl'), '<html></html>'),
  );
  assert.deepEqual(seen, ['work/q3/notes']);
});

test('the same, with the recursive flag unavailable — the Linux path', async () => {
  await fsp.mkdir(path.join(ROOT, 'deep/er'), { recursive: true });
  const seen = await watching(
    () => fsp.writeFile(path.join(ROOT, 'deep/er/thing.mrbl'), '<html></html>'),
    { recursiveSupported: false },
  );
  assert.deepEqual(seen, ['deep/er/thing']);
});

test('a folder made after the watch started is picked up on the fallback path', async () => {
  const seen = await watching(
    async () => {
      await fsp.mkdir(path.join(ROOT, 'later'), { recursive: true });
      await settle(250);
      await fsp.writeFile(path.join(ROOT, 'later/doc.mrbl'), '<html></html>');
    },
    { recursiveSupported: false },
  );
  assert.ok(seen.includes('later/doc'), `saw ${JSON.stringify(seen)}`);
});

test('the bookkeeping tree is not a document changing', async () => {
  const seen = await watching(async () => {
    await fsp.writeFile(path.join(ROOT, '.marble/notes.history.jsonl'), '{}\n');
    await fsp.writeFile(path.join(ROOT, 'notes.txt'), 'not a document');
  });
  assert.deepEqual(seen, []);
});

test('a burst of events for one save is one report', async () => {
  const file = path.join(ROOT, 'busy.mrbl');
  const seen = await watching(async () => {
    for (let i = 0; i < 8; i += 1) await fsp.writeFile(file, `<html>${i}</html>`);
  });
  assert.deepEqual(seen, ['busy']);
});

test.after(() => fsp.rm(ROOT, { recursive: true, force: true }));
