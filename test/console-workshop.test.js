// The workshop's state as the console shows it: each checkout's branch, head,
// changed files and where it stands against origin; main's recent commits;
// and how far a drive's release is behind main.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compareVersions, createWorkshop, nextFor, nextPatch } from '../server/console/workshop.js';

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

  const workshop = createWorkshop({ src, npmVersion: async () => '0.2.1', npmUser: async () => 'owner' });
  const s = await workshop.status();
  const drive = s.repos.find((r) => r.name === 'marble-drive');
  assert.equal(drive.branch, 'main');
  assert.equal(drive.head.subject, 'change 3');
  assert.deepEqual(drive.changed, [{ status: 'M', file: 'f1.txt' }]);
  assert.deepEqual([drive.ahead, drive.behind], [0, 0]);
  const marble = s.repos.find((r) => r.name === 'marble');
  assert.deepEqual([marble.ahead, marble.behind], [1, 0]);
  assert.deepEqual(s.marble, { repo: '0.2.2', dependency: '^0.2.1', npm: '0.2.1', npmUser: 'owner', unreleased: null });
  // Edits come first: publishing builds from this copy, so nothing is offered.
  assert.deepEqual(drive.next, { state: 'edited', action: null });
  assert.equal(s.claudePin, '2.1.281');
  assert.deepEqual(s.main.commits.map((c) => c.subject), ['change 3', 'change 2', 'change 1', 'first']);
  assert.equal(await workshop.behind(`20260924T000000Z-${released.slice(0, 7)}`), 3);
  assert.equal(await workshop.behind(`20260924T000000Z-local-${released.slice(0, 7)}`), 3);
  assert.equal(await workshop.behind('20260924T000000Z-deadbee'), null, 'a commit it does not know');
});

test('a missing checkout is said to be missing, not an error', async () => {
  const src = await fsp.mkdtemp(path.join(os.tmpdir(), 'workshop-none-'));
  const s = await createWorkshop({ src, npmVersion: async () => null, npmUser: async () => null }).status();
  assert.deepEqual(s.repos.map((r) => [r.name, r.exists]), [['marble-drive', false], ['marble', false]]);
});

// What each state reads as, and the one button it offers. The Publish button
// once bumped a version, failed to upload it, and offered to bump again.
test('the next step for marble: pull first, sign in before changing anything, finish rather than bump twice', () => {
  const clean = { name: 'marble', exists: true, changed: [], ahead: 0, behind: 0 };
  const m = (over = {}) => ({ repo: '0.2.3', npm: '0.2.3', npmUser: 'owner', unreleased: [], ...over });
  const two = [{ sha: 'a', subject: 'x' }, { sha: 'b', subject: 'y' }];

  assert.deepEqual(nextFor(clean, m()), { state: 'current', action: null, version: '0.2.3' });
  assert.deepEqual(nextFor({ ...clean, behind: 1 }, m({ unreleased: two })), { state: 'behind', action: 'pull', count: 1 });
  assert.deepEqual(nextFor({ ...clean, changed: [{ status: 'M', file: 'a' }] }, m()), { state: 'edited', action: null });
  assert.equal(nextFor(clean, m({ unreleased: two })).action, 'publish');
  assert.equal(nextFor(clean, m({ unreleased: two })).version, '0.2.4');
  assert.equal(nextFor(clean, m({ unreleased: two })).count, 2);

  const prepared = nextFor(clean, m({ repo: '0.2.4' }));
  assert.deepEqual([prepared.state, prepared.action, prepared.version], ['prepared', 'finish', '0.2.4']);

  const signedOut = nextFor(clean, m({ repo: '0.2.4', npmUser: false }));
  assert.deepEqual([signedOut.state, signedOut.action, signedOut.signedOut], ['prepared', 'npm-login', true]);
  // Signed out with nothing to publish is not a problem worth a button.
  assert.equal(nextFor(clean, m({ npmUser: false })).action, null);

  assert.equal(nextFor(clean, m({ npm: null })).state, 'npm-unknown');
  assert.equal(nextFor(clean, m({ unreleased: null })).state, 'untagged');
  assert.equal(nextFor(clean, m({ npm: '0.2.5' })).state, 'older');

  const drive = { ...clean, name: 'marble-drive' };
  assert.deepEqual(nextFor(drive, m()), { state: 'current', action: null, count: 0 });
  assert.equal(nextFor({ ...drive, behind: 2 }, m()).action, 'pull');

  assert.equal(compareVersions('0.2.10', '0.2.9'), 1);
  assert.equal(compareVersions('0.2.3', '0.2.3'), 0);
  assert.equal(nextPatch('0.2.3'), '0.2.4');
});

test('marble lists what changed since the version npm has, without the version commits', async () => {
  const { src } = await world();
  const marble = path.join(src, 'marble');
  git(marble, 'tag', '-a', 'v0.2.2', '-m', 'marble 0.2.2');
  for (const subject of ['The doctor says more', 'marble 0.2.3']) {
    await fsp.writeFile(path.join(marble, `${subject.length}.txt`), subject);
    git(marble, 'add', '.');
    git(marble, 'commit', '-q', '-m', subject);
  }
  git(marble, 'push', '-q');
  let asked = 0;
  const workshop = createWorkshop({ src, npmVersion: async () => '0.2.2', npmUser: async () => { asked += 1; return false; } });
  const s = await workshop.status();
  assert.deepEqual(s.marble.unreleased.map((c) => c.subject), ['The doctor says more']);
  assert.equal(s.marble.npmUser, false);
  const next = s.repos.find((r) => r.name === 'marble').next;
  assert.deepEqual([next.state, next.action, next.version, next.count], ['unreleased', 'npm-login', '0.2.3', 1]);

  await workshop.status();
  assert.equal(asked, 1, 'npm is asked once in ten minutes');
  workshop.forgetNpm();
  await workshop.status();
  assert.equal(asked, 2, 'and again at once after a publish or a sign-in');
});
