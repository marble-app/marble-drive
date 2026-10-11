// tools/drive-backup.sh copies the workshop (the sprite's checkouts) beside
// the drive, and tools/workshop-restore.sh puts it back. Here the "sprite" is
// two local folders, rsync's transport runs rsync locally, and the workshop is
// real git: one checkout all pushed, one with work that is nowhere else.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TOOLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });

async function world() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'workshop-'));
  const bin = path.join(root, 'bin');
  await fsp.mkdir(bin);
  // rsync's transport: drop the host and run the far end here, where the
  // sprite's /home/sprite/src is this test's folder.
  await fsp.writeFile(path.join(bin, 'rsh'), '#!/bin/bash\nshift\nargs=()\nfor a in "$@"; do args+=("${a//\\/home\\/sprite\\/src/$FAKE_SRC}"); done\nexec "${args[@]}"\n', { mode: 0o755 });
  // `sprite exec … -- sh -c <cmd>`, run here.
  await fsp.writeFile(path.join(bin, 'sprite'), '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n', { mode: 0o755 });

  const drive = path.join(root, 'remote-drive');
  await fsp.mkdir(path.join(drive, '.marble'), { recursive: true });
  await fsp.writeFile(path.join(drive, 'Notes.mrbl'), '<html>notes</html>');

  const src = path.join(root, 'remote-src');
  await fsp.mkdir(src);
  const origin = path.join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', origin);
  for (const name of ['pushed', 'working']) {
    const dir = path.join(src, name);
    git(src, 'clone', '-q', origin, name);
    await fsp.writeFile(path.join(dir, `${name}.txt`), 'one\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'first');
    git(dir, 'push', '-q', 'origin', `HEAD:refs/heads/${name}`);
    git(dir, 'branch', '-q', '-u', `origin/${name}`);
  }
  // A worktree of `pushed`, as the workshop's feature checkouts are: its .git
  // names the repository by its path on the sprite.
  git(path.join(src, 'pushed'), 'worktree', 'add', '-q', '-b', 'feature', path.join(src, 'feature'));
  await fsp.writeFile(path.join(src, 'feature', 'feature.txt'), 'wip\n');
  // As on the sprite, the worktree names its repository by the sprite's path,
  // which does not exist here: the report can only read it through the copy.
  await fsp.writeFile(path.join(src, 'feature', '.git'), 'gitdir: /home/sprite/src/pushed/.git/worktrees/feature\n');
  await fsp.mkdir(path.join(src, 'pushed', 'node_modules', 'dep'), { recursive: true });
  await fsp.writeFile(path.join(src, 'pushed', 'node_modules', 'dep', 'index.js'), 'x');
  // Work that is nowhere else: a commit no remote has, and an edit not committed.
  await fsp.writeFile(path.join(src, 'working', 'working.txt'), 'two\n');
  git(path.join(src, 'working'), 'commit', '-q', '-am', 'second, not pushed');
  await fsp.writeFile(path.join(src, 'working', 'working.txt'), 'three, not committed\n');

  const to = path.join(root, 'Marble Backups');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, BACKUP_RSH: path.join(bin, 'rsh'), BACKUP_REMOTE_DRIVE: drive, BACKUP_REMOTE_SRC: '/home/sprite/src', FAKE_SRC: src, SPRITE_BIN: path.join(bin, 'sprite') };
  const backup = (extra = {}) =>
    spawnSync('bash', [path.join(TOOLS, 'drive-backup.sh'), 'admin-test', '--no-checkpoint', '--to', to, '--link', path.join(root, 'Marble Drive'), '--workshop-link', path.join(root, 'Marble Workshop')], { env: { ...env, ...extra }, encoding: 'utf8' });
  return { root, src, to, env, backup, workshop: path.join(root, 'Marble Workshop') };
}

test('the workshop is copied beside the drive, with its .git and uncommitted work, and without node_modules', async () => {
  const w = await world();
  const r = w.backup();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /done: \S+, 1 documents/);
  assert.equal(fs.readFileSync(path.join(w.root, 'Marble Drive', 'Notes.mrbl'), 'utf8'), '<html>notes</html>');
  assert.equal(fs.readFileSync(path.join(w.workshop, 'working', 'working.txt'), 'utf8'), 'three, not committed\n');
  assert.ok(fs.existsSync(path.join(w.workshop, 'working', '.git')));
  assert.ok(!fs.existsSync(path.join(w.workshop, 'pushed', 'node_modules')), 'node_modules stays behind');
  const report = JSON.parse(fs.readFileSync(path.join(w.workshop, 'workshop.json'), 'utf8'));
  const by = Object.fromEntries(report.checkouts.map((c) => [c.checkout, c]));
  assert.deepEqual([by.pushed.changed, by.pushed.unpushed], [0, 0]);
  assert.deepEqual([by.working.changed, by.working.unpushed], [1, 1]);
  assert.deepEqual([by.feature.branch, by.feature.changed, by.feature.unpushed], ['feature', 1, 0], 'a worktree is read through the copy of its repository');
  assert.equal(fs.readFileSync(path.join(w.workshop, 'feature', 'feature.txt'), 'utf8'), 'wip\n');
  assert.match(r.stdout, /workshop: \d+ files; only here: feature \(1 changed, 0 unpushed\), working \(1 changed, 1 unpushed\)/);
});

test('a second run keeps one copy of each, and the links follow it', async () => {
  const w = await world();
  assert.equal(w.backup().status, 0);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await fsp.writeFile(path.join(w.src, 'pushed', 'new.txt'), 'new\n');
  assert.equal(w.backup().status, 0);
  const snaps = (dir) => fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}T\d{6}Z$/.test(n));
  assert.equal(snaps(w.to).length, 1);
  assert.equal(snaps(path.join(w.to, 'workshop')).length, 1);
  assert.equal(fs.readFileSync(path.join(w.workshop, 'pushed', 'new.txt'), 'utf8'), 'new\n');
  assert.equal(fs.realpathSync(w.workshop), path.join(fs.realpathSync(w.to), 'workshop', snaps(path.join(w.to, 'workshop'))[0]));
});

test('a sprite with no checkouts backs up its drive and says there is no workshop', async () => {
  const w = await world();
  const r = w.backup({ FAKE_SRC: path.join(w.root, 'nothing-here') });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /done: /);
  assert.match(r.stdout, /no workshop on admin-test/);
  assert.ok(!fs.existsSync(w.workshop));
});

test('restoring says what it would do, then puts the checkouts back, setting aside what was there', async () => {
  const w = await world();
  assert.equal(w.backup().status, 0);
  const target = path.join(w.root, 'new-sprite-src');
  await fsp.mkdir(path.join(target, 'pushed'), { recursive: true });
  await fsp.writeFile(path.join(target, 'pushed', 'stale.txt'), 'already here');
  const restore = (...args) => spawnSync('bash', [path.join(TOOLS, 'workshop-restore.sh'), 'admin-new', '--from', w.workshop, ...args], { env: { ...w.env, BACKUP_REMOTE_SRC: target }, encoding: 'utf8' });

  const plan = restore();
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /nothing done: add --yes/);
  assert.deepEqual(fs.readdirSync(target), ['pushed']);

  const done = restore('--yes');
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /set aside: pushed\.before-restore-/);
  const names = fs.readdirSync(target).sort();
  assert.equal(names.length, 4);
  assert.ok(names.some((n) => n.startsWith('pushed.before-restore-')));
  assert.equal(fs.readFileSync(path.join(target, 'working', 'working.txt'), 'utf8'), 'three, not committed\n');
  assert.equal(git(path.join(target, 'working'), 'log', '-1', '--format=%s').trim(), 'second, not pushed');
});

test('restore refuses what is not a checkout name', async () => {
  const w = await world();
  assert.equal(w.backup().status, 0);
  const r = spawnSync('bash', [path.join(TOOLS, 'workshop-restore.sh'), 'admin-new', '../etc', '--from', w.workshop, '--yes'], { env: w.env, encoding: 'utf8' });
  assert.equal(r.status, 2);
});
