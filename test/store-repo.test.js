// A folder that is its own git repository says so in the tree, so the Drive can
// show it without asking git about every folder it draws.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStore } from '../server/store/index.js';

const DOC = '<!doctype html><html data-marble-id="h"><body data-marble-id="b"></body></html>\n';

test('a folder with its own .git is marked, as a directory or as a file', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'store-repo-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'Site/.git'), { recursive: true });
  await fsp.mkdir(path.join(root, 'Site/Inner'), { recursive: true });
  await fsp.mkdir(path.join(root, 'Worktree'), { recursive: true });
  await fsp.writeFile(path.join(root, 'Worktree/.git'), 'gitdir: /elsewhere\n');
  await fsp.mkdir(path.join(root, 'Plain'), { recursive: true });
  await fsp.writeFile(path.join(root, 'Site/page.mrbl'), DOC);

  const tree = await createStore({ root }).tree({ folder: '' });
  const find = (node, p) => node.path === p ? node : (node.children ?? []).map((c) => find(c, p)).find(Boolean);
  assert.equal(find(tree, 'Site').repo, true);
  assert.equal(find(tree, 'Worktree').repo, true);
  assert.equal(find(tree, 'Plain').repo, undefined);
  assert.equal(find(tree, 'Site/Inner').repo, undefined);
  // The .git itself stays hidden.
  assert.equal(find(tree, 'Site/.git'), undefined);
});
