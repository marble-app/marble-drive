// The workshop's state as the console shows it: each checkout's branch, head,
// changed files and where it stands against origin; main's recent commits;
// and how far a drive's release is behind main.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createWorkshop } from '../server/console/workshop.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

async function world() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'workshop-'));
  const src = path.join(root, 'src');
  await fsp.mkdir(src);
  for (const name of ['marble-drive', 'marble']) {
    const bare = path.join(root, `${name}.git`);
    git(root, 'init', '-q', '--bare', '-b', 'main', bare);
    git(src, 'clone', '-q', bare, name);
    const dir = path.join(src, name);
    git(dir, 'checkout', '-q', '-b', 'main');
    const pkg = name === 'marble'
      ? { name: '@bdhmin/marble', version: '0.2.2' }
      : { name: 'marble-drive', dependencies: { '@bdhmin/marble': '^0.2.1' } };
    await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg));
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'first');
    git(dir, 'push', '-q', '-u', 'origin', 'main');
  }
  await fsp.mkdir(path.join(src, 'marble-drive', 'tools', 'sprite'), { recursive: true });
  await fsp.writeFile(path.join(src, 'marble-drive', 'tools', 'sprite', 'claude-version'), '2.1.281\n');
  return { root, src };
}

test('each checkout says its branch, head, changes, and where it stands against origin', async () => {
  const { src } = await world();
  const md = path.join(src, 'marble-drive');
  const released = git(md, 'rev-parse', 'HEAD');
  for (const n of [1, 2, 3]) {
    await fsp.writeFile(path.join(md, `f${n}.txt`), String(n));
    git(md, 'add', '.');
    git(md, 'commit', '-q', '-m', `change ${n}`);
  }
  git(md, 'push', '-q');
  await fsp.writeFile(path.join(md, 'f1.txt'), 'edited');
  await fsp.writeFile(path.join(src, 'marble', 'new.txt'), 'x');
  git(path.join(src, 'marble'), 'add', 'new.txt');
  git(path.join(src, 'marble'), 'commit', '-q', '-m', 'local only');

  const workshop = createWorkshop({ src, npmVersion: async () => '0.2.1' });
  const s = await workshop.status();
  const drive = s.repos.find((r) => r.name === 'marble-drive');
  assert.equal(drive.branch, 'main');
  assert.equal(drive.head.subject, 'change 3');
  assert.deepEqual(drive.changed, [{ status: 'M', file: 'f1.txt' }]);
  assert.deepEqual([drive.ahead, drive.behind], [0, 0]);
  const marble = s.repos.find((r) => r.name === 'marble');
  assert.deepEqual([marble.ahead, marble.behind], [1, 0]);
  assert.deepEqual(s.marble, { repo: '0.2.2', dependency: '^0.2.1', npm: '0.2.1' });
  assert.equal(s.claudePin, '2.1.281');
  assert.deepEqual(s.main.commits.map((c) => c.subject), ['change 3', 'change 2', 'change 1', 'first']);
  assert.equal(await workshop.behind(`20260924T000000Z-${released.slice(0, 7)}`), 3);
  assert.equal(await workshop.behind(`20260924T000000Z-local-${released.slice(0, 7)}`), 3);
  assert.equal(await workshop.behind('20260924T000000Z-deadbee'), null, 'a commit it does not know');
});

test('a missing checkout is said to be missing, not an error', async () => {
  const src = await fsp.mkdtemp(path.join(os.tmpdir(), 'workshop-none-'));
  const s = await createWorkshop({ src, npmVersion: async () => null }).status();
  assert.deepEqual(s.repos.map((r) => [r.name, r.exists]), [['marble-drive', false], ['marble', false]]);
});
