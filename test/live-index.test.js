// The listing kept in memory (server/store/live-index.js) has to say what a
// walk of the disk would say, whoever changed the disk and however, and a page
// patching its copy (runtime/drive.js) has to end up with the same tree.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-live-'));
process.env.MARBLE_APPS = ROOT;

const { createStore } = await import('../server/store/index.js');
const { watchDrive } = await import('../server/watch.js');

// runtime/drive.js, run without a page: only its tree helpers come out.
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
await import('../runtime/drive.js');
const { patchTree, copyTree } = globalThis.marbleDriveTree;

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const doc = (title) => `<!doctype html><html><head><title>${title}</title></head><body><p data-marble-id="p">${title}</p></body></html>`;

// Ties in time are ordered by whatever the walk met first, so a comparison
// orders them by path; everything else must match exactly.
const norm = (node) => {
  const out = { ...node };
  if (node.children) {
    out.children = node.children.map(norm).sort((a, b) =>
      a.kind !== b.kind ? a.kind.localeCompare(b.kind) : b.modified - a.modified || a.path.localeCompare(b.path));
  }
  return out;
};
const flatNorm = (list) => [...list].sort((a, b) => a.path.localeCompare(b.path));

/** A store that walks the disk every time: what the kept listing must equal. */
const walker = (root) => createStore({ root });

test('the kept listing says what a walk says, for every kind of thing in a folder', async () => {
  const root = path.join(ROOT, 'kinds');
  await fsp.mkdir(path.join(root, 'work/q3/deep'), { recursive: true });
  await fsp.mkdir(path.join(root, 'repo/.git'), { recursive: true });
  await fsp.mkdir(path.join(root, '.hidden'), { recursive: true });
  await fsp.writeFile(path.join(root, 'top.mrbl'), doc('Top'));
  await fsp.writeFile(path.join(root, 'work/q3/notes.mrbl'), doc('Notes'));
  await fsp.writeFile(path.join(root, 'work/q3/data.csv'), 'a,b\n1,2\n');
  await fsp.writeFile(path.join(root, 'work/bad name (1).mrbl'), doc('Refused'));
  await fsp.writeFile(path.join(root, 'work/.dotfile'), 'x');
  await fsp.writeFile(path.join(root, 'repo/readme.md'), '# hi');
  await fsp.symlink(path.join(root, 'work'), path.join(root, 'linked'));
  const store = createStore({ root });
  await store.ready();
  const walked = { tree: norm(await store.tree()), bare: norm(await store.tree({ files: false })), flat: flatNorm(await store.list({ recursive: true, files: true })), shallow: flatNorm(await store.list({ recursive: false })) };
  const watcher = watchDrive(store, () => {}, { recursiveSupported: false });
  try {
    assert.equal(store._fsIndex.live, true);
    assert.deepEqual(norm(await store.tree()), walked.tree);
    assert.deepEqual(norm(await store.tree({ files: false })), walked.bare);
    assert.deepEqual(flatNorm(await store.list({ recursive: true, files: true })), walked.flat);
    assert.deepEqual(flatNorm(await store.list({ recursive: false })), walked.shallow);
    assert.deepEqual(norm(await store.tree({ folder: 'work' })), norm(await walker(root).tree({ folder: 'work' })));
    assert.deepEqual(norm(await store.tree({ folder: 'nowhere' })), norm(await walker(root).tree({ folder: 'nowhere' })));
    assert.equal((await store.tree()).children.find((c) => c.path === 'repo').repo, true);
  } finally {
    watcher.close();
  }
  assert.equal(store._fsIndex.live, false);
});

test('a write through the store is in the very next listing, before the watcher hears it', async () => {
  const root = path.join(ROOT, 'own');
  const store = createStore({ root });
  await store.ready();
  const watcher = watchDrive(store, () => {}, { recursiveSupported: false });
  try {
    await store.tree();
    await store.write('a/b/c/new', doc('New'));
    let flat = await store.list({ recursive: true });
    assert.deepEqual(flat.map((e) => e.path).sort(), ['a', 'a/b', 'a/b/c', 'a/b/c/new']);
    await store.move('a/b', 'moved');
    flat = await store.list({ recursive: true });
    assert.deepEqual(flat.map((e) => e.path).sort(), ['a', 'moved', 'moved/c', 'moved/c/new']);
    const { id } = await store.trash('moved/c/new');
    assert.deepEqual((await store.list({ recursive: true })).map((e) => e.path).sort(), ['a', 'moved', 'moved/c']);
    await store.untrash(id);
    assert.ok((await store.list({ recursive: true })).some((e) => e.path === 'moved/c/new'));
    await store.mkdir('empty/inside');
    assert.ok((await store.list({ recursive: true })).some((e) => e.path === 'empty/inside'));
  } finally {
    watcher.close();
  }
});

test('a change nobody said is found by the sweep', async () => {
  const root = path.join(ROOT, 'unsaid');
  await fsp.mkdir(path.join(root, 'f'), { recursive: true });
  const store = createStore({ root });
  await store.ready();
  // Believed as if watched, with no watcher to say anything.
  store._fsIndex.watching(true);
  try {
    assert.deepEqual((await store.list({ recursive: true })).map((e) => e.path), ['f']);
    await fsp.writeFile(path.join(root, 'f/quiet.mrbl'), doc('Quiet'));
    assert.deepEqual((await store.list({ recursive: true })).map((e) => e.path), ['f'], 'unsaid, so not yet seen');
    await store._fsIndex.sweep();
    assert.deepEqual((await store.list({ recursive: true })).map((e) => e.path).sort(), ['f', 'f/quiet']);
  } finally {
    store._fsIndex.watching(false);
  }
});

test('a folder removed and made again under its name is read anew', async () => {
  const root = path.join(ROOT, 'again');
  await fsp.mkdir(path.join(root, 'x'), { recursive: true });
  await fsp.writeFile(path.join(root, 'x/old.mrbl'), doc('Old'));
  const store = createStore({ root });
  await store.ready();
  const watcher = watchDrive(store, () => {}, { recursiveSupported: false });
  try {
    await store.tree();
    await fsp.rm(path.join(root, 'x'), { recursive: true });
    await fsp.mkdir(path.join(root, 'x'));
    await settle();
    await fsp.writeFile(path.join(root, 'x/new.mrbl'), doc('New'));
    await settle();
    assert.deepEqual(norm(await store.tree()), norm(await walker(root).tree()));
  } finally {
    watcher.close();
  }
});

test('since: the same tree is same, a change is a patch, and a patched tree is the tree', async () => {
  const root = path.join(ROOT, 'since');
  await fsp.mkdir(path.join(root, 'a/b'), { recursive: true });
  await fsp.writeFile(path.join(root, 'a/b/one.mrbl'), doc('One'));
  const store = createStore({ root });
  await store.ready();
  const watcher = watchDrive(store, () => {}, { recursiveSupported: false });
  try {
    const first = await store.treeSince({ since: null });
    assert.ok(first.v && first.tree);
    assert.deepEqual(await store.treeSince({ since: first.v }), { v: first.v, same: true });
    await store.write('a/b/two', doc('Two'));
    const delta = await store.treeSince({ since: first.v });
    assert.ok(delta.patch, 'a patch, not the tree');
    assert.ok(delta.patch.length <= 3, 'only the folders on the way to the change');
    assert.deepEqual(norm(patchTree(first.tree, delta.patch)), norm(await store.tree()));
    // A file changes nothing a listing without files shows… except the
    // folder's own time, which is in its parent's listing.
    const bare = await store.treeSince({ files: false });
    await fsp.writeFile(path.join(root, 'a/b/one.mrbl'), doc('One, again'));
    await settle();
    const bareDelta = await store.treeSince({ files: false, since: bare.v });
    assert.deepEqual(norm(patchTree(bare.tree, bareDelta.patch)), norm(await store.tree({ files: false })));
    // Another run's number is answered with the tree.
    assert.ok((await store.treeSince({ since: 'beef.1' })).tree);
  } finally {
    watcher.close();
  }
});

test('patchTree leaves the tree it was given as it was', () => {
  const tree = { kind: 'folder', path: '', children: [
    { kind: 'folder', path: 'a', name: 'a', modified: 1, children: [{ kind: 'doc', path: 'a/x', modified: 1 }] },
    { kind: 'folder', path: 'b', name: 'b', modified: 1, children: [] },
  ] };
  const before = JSON.stringify(tree);
  const next = patchTree(tree, [{ path: 'a', children: [{ kind: 'doc', path: 'a/y', modified: 2 }] }]);
  assert.equal(JSON.stringify(tree), before);
  assert.deepEqual(next.children[0].children.map((c) => c.path), ['a/y']);
  assert.equal(next.children[1], tree.children[1], 'what did not change is shared');
  assert.equal(patchTree(tree, [{ path: 'nowhere', children: [] }]), null, 'a patch for some other tree');
  const copy = copyTree(next);
  copy.children[0].children[0].acts = {};
  assert.equal(next.children[0].children[0].acts, undefined, 'a copy is its own');
});

// Every way the disk can change, from outside and through the store, in
// random order, with a page keeping its tree by patches all along.
test('random changes from every side: the kept listing and a patched page both match a walk', async () => {
  const root = path.join(ROOT, 'random');
  await fsp.mkdir(root, { recursive: true });
  const store = createStore({ root });
  await store.ready();
  const watcher = watchDrive(store, () => {}, { recursiveSupported: false });
  let seed = Number(process.env.LIVE_SEED ?? 7);
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  const pick = (list) => list[rand(list.length)];
  const NAMES = ['a', 'b', 'c', 'notes', 'Data'];
  const page = { files: await store.treeSince({}), bare: await store.treeSince({ files: false }) };
  page.files = { v: page.files.v, tree: page.files.tree };
  page.bare = { v: page.bare.v, tree: page.bare.tree };
  const visible = (p) => !p.split('/').some((s) => s.startsWith('.'));
  const folders = () => [''].concat(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.relative(root, path.join(d.parentPath ?? d.path, d.name)).split(path.sep).join('/'))
    .filter(visible));
  const things = () => fs.readdirSync(root, { recursive: true })
    .map((p) => p.split(path.sep).join('/'))
    .filter(visible);
  try {
    for (let round = 0; round < Number(process.env.LIVE_ROUNDS ?? 40); round++) {
      for (let step = 0; step < 6; step++) {
        const dir = pick(folders());
        const at = (name) => path.join(root, dir, name);
        const name = pick(NAMES);
        const kind = rand(9);
        try {
          if (kind === 0) await fsp.mkdir(at(name), { recursive: true });
          else if (kind === 1) await fsp.writeFile(at(`${name}.mrbl`), doc(`${name} ${round}`));
          else if (kind === 2) await fsp.writeFile(at(`${name}.txt`), 'x'.repeat(rand(50)));
          else if (kind === 3) {
            const thing = pick(things());
            if (thing) await fsp.rm(path.join(root, thing), { recursive: true, force: true });
          } else if (kind === 4) {
            const thing = pick(things());
            const to = path.join(root, pick(folders()), `${pick(NAMES)}${path.extname(thing ?? '')}`);
            if (thing && !to.startsWith(path.join(root, thing) + path.sep) && !fs.existsSync(to)) await fsp.rename(path.join(root, thing), to);
          } else if (kind === 5) await store.write(`${dir ? `${dir}/` : ''}${name}`, doc(`stored ${round}`));
          else if (kind === 6) await store.mkdir(`${dir ? `${dir}/` : ''}${name}/inner`);
          else if (kind === 7) {
            const docs = (await walker(root).list({ recursive: true })).filter((e) => e.kind === 'doc');
            if (docs.length) await store.trash(pick(docs).path);
          } else await fsp.utimes(at(`${name}.txt`), new Date(), new Date()).catch(() => {});
        } catch (err) {
          if (!['EEXIST', 'ENOENT', 'ENOTDIR', 'EISDIR', 'ENOTEMPTY'].includes(err.code) && err.name !== 'PathError') throw err;
        }
      }
      await settle(rand(3) === 0 ? 0 : 150);
      // Unsettled rounds may still be hearing the watcher; settled ones must match.
      if (round % 3 === 2) await settle(200);
      for (const [key, files] of [['files', true], ['bare', false]]) {
        const answer = await store.treeSince({ files, since: page[key].v });
        const next = answer.tree ?? (answer.same ? page[key].tree : patchTree(page[key].tree, answer.patch));
        assert.ok(next, `round ${round}: a patch that fits`);
        page[key] = { v: answer.v, tree: next };
        if (round % 3 === 2) {
          const walked = norm(await walker(root).tree({ files }));
          const keptTree = norm(await store.tree({ files }));
          if (process.env.LIVE_DEBUG && JSON.stringify(keptTree) !== JSON.stringify(walked)) {
            const flat = (n, out = new Map()) => { for (const c of n.children ?? []) { out.set(c.path, JSON.stringify({ ...c, children: undefined })); flat(c, out); } return out; };
            const a = flat(keptTree), b = flat(walked);
            for (const k of new Set([...a.keys(), ...b.keys()])) if (a.get(k) !== b.get(k)) console.log('DIFF', k, '\n kept  ', a.get(k), '\n walked', b.get(k));
          }
          assert.deepEqual(keptTree, walked, `round ${round}: kept ${key} listing`);
          assert.deepEqual(norm(next), walked, `round ${round}: patched ${key} page`);
        }
      }
    }
  } finally {
    watcher.close();
  }
});
