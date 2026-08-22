import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The history module resolves its directory from this, and reads it when it is
// called — so it has to be set before the store is imported *and* pointed at
// the same temp root the store gets.
const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-store-'));
process.env.MARBLE_APPS = ROOT;

const { createStore } = await import('../server/store/index.js');

const store = createStore({ root: ROOT });
await store.ready();

const doc = (title) =>
  `<!doctype html><html data-marble="1"><head><title>${title}</title></head>` +
  `<body><main data-marble-id="m"><p data-marble-id="p">hello</p></main></body></html>`;

test('a document written into a folder that does not exist yet', async () => {
  await store.write('work/q3/notes', doc('Notes'));
  assert.equal(await store.has('work/q3/notes'), true);
  assert.equal(await store.hasFolder('work/q3'), true);
  assert.match(await store.read('work/q3/notes'), /hello/);
});

test('stat reports the things a Drive shows', async () => {
  const info = await store.stat('work/q3/notes');
  assert.equal(info.kind, 'doc');
  assert.equal(info.folder, 'work/q3');
  assert.equal(info.name, 'notes');
  assert.equal(info.title, 'Notes');
  assert.equal(info.nodes, 2);
  assert.ok(info.bytes > 0);
});

test('the listing is flat and the tree is nested, from one traversal', async () => {
  await store.write('top', doc('Top'));
  const flat = await store.list({ recursive: true });
  assert.deepEqual(
    flat.map((entry) => entry.path).sort(),
    ['top', 'work', 'work/q3', 'work/q3/notes'],
  );

  const tree = await store.tree();
  assert.equal(tree.path, '');
  const work = tree.children.find((child) => child.path === 'work');
  assert.equal(work.kind, 'folder');
  assert.equal(work.children[0].path, 'work/q3');
  assert.equal(work.children[0].children[0].path, 'work/q3/notes');
  // Folders before documents at every level, which is the order a Drive shows.
  assert.equal(tree.children[0].kind, 'folder');
});

test('the bookkeeping folder is never listed as content', async () => {
  const flat = await store.list({ recursive: true });
  assert.ok(!flat.some((entry) => entry.path.startsWith('.marble')));
});

test('a write takes a restore point of what it is replacing, and only then writes', async () => {
  await store.write('work/q3/notes', doc('Notes, again'), { label: 'ops' });
  const history = await store.history('work/q3/notes');
  assert.equal(history.length, 1);
  assert.equal(history[0].label, 'ops');
  // The snapshot is the state *before* the write.
  assert.match(await store.snapshot('work/q3/notes', history[0].sha), /<title>Notes<\/title>/);
  assert.match(await store.read('work/q3/notes'), /<title>Notes, again<\/title>/);
});

test('history follows a document that moves', async () => {
  const before = await store.history('work/q3/notes');
  await store.move('work/q3/notes', 'archive/notes');
  assert.equal(await store.has('work/q3/notes'), false);
  assert.equal(await store.has('archive/notes'), true);
  const after = await store.history('archive/notes');
  assert.deepEqual(after.map((e) => e.sha), before.map((e) => e.sha));
});

test('moving a folder carries its documents and their history', async () => {
  await store.write('inbox/a', doc('A'));
  await store.write('inbox/a', doc('A2'));
  await store.move('inbox', 'work/inbox');
  assert.equal(await store.has('work/inbox/a'), true);
  assert.equal((await store.history('work/inbox/a')).length, 1);
});

test('a folder cannot be moved inside itself, and nothing is overwritten', async () => {
  await assert.rejects(() => store.move('work', 'work/deeper'), /inside itself/);
  await store.write('one', doc('One'));
  await assert.rejects(() => store.move('one', 'top'), /already exists/);
});

test('deleting is recoverable, and restoring beside a name that was retaken', async () => {
  const entry = await store.trash('one');
  assert.equal(await store.has('one'), false);
  assert.equal((await store.listTrash()).length, 1);

  await store.write('one', doc('A different one'));
  const back = await store.untrash(entry.id);
  assert.notEqual(back.path, 'one');
  assert.match(back.path, /^one restored /);
  assert.equal((await store.listTrash()).length, 0);
});

test('create refuses to overwrite', async () => {
  await store.create('fresh', doc('Fresh'));
  await assert.rejects(() => store.create('fresh', doc('Fresh')), /already exists/);
});

test('every method refuses a path that leaves the drive', async () => {
  await assert.rejects(() => store.write('../escape', doc('No')), /not a folder|outside/);
  await assert.rejects(() => store.mkdir('../escape'), /not a folder|outside/);
  assert.equal(await store.read('../escape').catch(() => 'threw'), 'threw');
});

test.after(() => fsp.rm(ROOT, { recursive: true, force: true }));
