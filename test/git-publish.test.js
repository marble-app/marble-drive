// Publish: a folder that is its own git repository is committed and pushed
// from the Drive. The one deliberate exception to "using Marble never makes a
// git change" (test/drive-git-boundary.test.js), so most of what is checked
// here is who may ask and what it refuses to touch.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const DOC = `<!doctype html>
<html data-marble-id="h"><head data-marble-id="hd"><title data-marble-id="t">Page</title></head>
<body data-marble-id="b"><h1 data-marble-id="title">Page</h1></body></html>
`;

// The repository's own settings, so the user's global ones — a signing key, a
// hook path — cannot decide whether these pass.
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();

async function boot(t, env = { MARBLE_DRIVE_GIT: '1', MARBLE_DRIVE_SECRET: 'hunter2' }) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'git-publish-'));
  const remote = path.join(tmp, 'remote.git');
  const root = path.join(tmp, 'drive');
  const site = path.join(root, 'Site');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  await fsp.mkdir(path.join(site, 'Nested'), { recursive: true });
  await fsp.mkdir(path.join(root, 'Plain'), { recursive: true });
  await fsp.writeFile(path.join(site, 'page.mrbl'), DOC);
  await fsp.writeFile(path.join(site, 'Nested/inner.mrbl'), DOC);
  await fsp.writeFile(path.join(root, 'Plain/other.mrbl'), DOC);
  git(site, 'init', '-q', '-b', 'main');
  git(site, 'config', 'user.name', 'Test');
  git(site, 'config', 'user.email', 'test@example.com');
  git(site, 'config', 'commit.gpgsign', 'false');
  git(site, 'remote', 'add', 'origin', remote);
  git(site, 'add', '-A');
  git(site, 'commit', '-qm', 'first');
  git(site, 'push', '-q', '-u', 'origin', 'main');

  const drive = await createDrive(
    loadConfig({ MARBLE_DRIVE_ROOT: root, ...env }),
    { log: { log() {}, error() {}, info() {}, warn() {} }, agents: false },
  );
  t.after(async () => {
    await drive.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const origin = `http://127.0.0.1:${port}`;
  let owner = '';
  if (env.MARBLE_DRIVE_SECRET) {
    const signIn = await fetch(`${origin}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.MARBLE_DRIVE_SECRET }),
    });
    owner = signIn.headers.get('set-cookie').split(';')[0];
  }
  const ask = (p, { method = 'GET', body, cookie = owner, from = origin } = {}) => fetch(`${origin}${p}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(from ? { Origin: from } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const publish = (folder, opts = {}) => ask('/drive/git/publish', { method: 'POST', body: { path: folder }, ...opts });
  const status = (folder) => ask(`/drive/git?path=${encodeURIComponent(folder)}`);
  return { tmp, remote, root, site, ask, publish, status };
}

test('off unless the drive says MARBLE_DRIVE_GIT', async (t) => {
  const { status, publish } = await boot(t, { MARBLE_DRIVE_SECRET: 'hunter2' });
  assert.equal((await status('Site')).status, 404);
  assert.equal((await publish('Site')).status, 404);
});

test('off on a drive with no passphrase, even when asked for', async (t) => {
  const { status } = await boot(t, { MARBLE_DRIVE_GIT: '1' });
  assert.equal((await status('Site')).status, 404);
});

test('status says which folders are repositories, without looking above them', async (t) => {
  const { status, site } = await boot(t);
  const repo = await (await status('Site')).json();
  assert.equal(repo.repo, true);
  assert.equal(repo.branch, 'main');
  assert.equal(repo.upstream, 'origin/main');
  assert.equal(repo.changed, 0);
  assert.equal(repo.ahead, 0);

  await fsp.writeFile(path.join(site, 'page.mrbl'), DOC.replace('Page</h1>', 'Changed</h1>'));
  assert.equal((await (await status('Site')).json()).changed, 1);

  // Inside a repository is not a repository: Publish names the folder that is one.
  assert.equal((await (await status('Site/Nested')).json()).repo, false);
  assert.equal((await (await status('Plain')).json()).repo, false);
});

test('publish commits what changed and pushes it', async (t) => {
  const { publish, site, remote } = await boot(t);
  await fsp.writeFile(path.join(site, 'page.mrbl'), DOC.replace('Page</h1>', 'Changed</h1>'));
  await fsp.writeFile(path.join(site, 'cv.mrbl'), DOC);

  const res = await publish('Site');
  assert.equal(res.status, 200);
  const answer = await res.json();
  assert.equal(answer.ok, true);
  assert.equal(answer.branch, 'main');
  assert.deepEqual([...answer.files].sort(), ['cv.mrbl', 'page.mrbl']);

  const head = git(site, 'rev-parse', 'HEAD');
  assert.equal(answer.commit, head);
  assert.equal(git(remote, 'rev-parse', 'main'), head);
  assert.match(git(site, 'log', '-1', '--format=%s'), /^Publish from Marble Drive: /);
  assert.equal(git(site, 'status', '--porcelain'), '');
});

test('publish with nothing new says so and pushes nothing', async (t) => {
  const { publish, remote } = await boot(t);
  const before = git(remote, 'rev-parse', 'main');
  const answer = await (await publish('Site')).json();
  assert.equal(answer.nothing, true);
  assert.equal(git(remote, 'rev-parse', 'main'), before);
});

test('a commit made earlier and never pushed is pushed', async (t) => {
  const { publish, site, remote } = await boot(t);
  await fsp.writeFile(path.join(site, 'page.mrbl'), DOC.replace('Page</h1>', 'Local</h1>'));
  git(site, 'commit', '-qam', 'by hand');
  const answer = await (await publish('Site')).json();
  assert.equal(answer.ok, true);
  assert.equal(git(remote, 'rev-parse', 'main'), git(site, 'rev-parse', 'HEAD'));
});

test('a remote that moved on is not overwritten; the commit stays here', async (t) => {
  const { publish, site, remote, tmp } = await boot(t);
  const other = path.join(tmp, 'other');
  execFileSync('git', ['clone', '-q', remote, other]);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.com');
  await fsp.writeFile(path.join(other, 'theirs.txt'), 'theirs');
  git(other, 'add', '-A');
  git(other, 'commit', '-qm', 'theirs');
  git(other, 'push', '-q');
  const theirs = git(remote, 'rev-parse', 'main');

  await fsp.writeFile(path.join(site, 'page.mrbl'), DOC.replace('Page</h1>', 'Mine</h1>'));
  const res = await publish('Site');
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /pull/i);
  assert.equal(git(remote, 'rev-parse', 'main'), theirs);
  assert.match(git(site, 'log', '-1', '--format=%s'), /^Publish from Marble Drive: /);
});

test('a folder that is not a repository is refused', async (t) => {
  const { publish } = await boot(t);
  assert.equal((await publish('Plain')).status, 400);
  assert.equal((await publish('Site/Nested')).status, 400);
  assert.equal((await publish('')).status, 400);
  assert.equal((await publish('../elsewhere')).status, 400);
});

test("only the Drive's own page may ask", async (t) => {
  const { publish, remote } = await boot(t);
  const before = git(remote, 'rev-parse', 'main');
  assert.equal((await publish('Site', { from: null })).status, 403);
  assert.equal((await publish('Site', { from: 'http://elsewhere.test' })).status, 403);
  // And never someone without the passphrase.
  assert.notEqual((await publish('Site', { cookie: '' })).status, 200);
  assert.equal(git(remote, 'rev-parse', 'main'), before);
});

test('the shell is told publishing is on, and only then', async (t) => {
  const on = await boot(t);
  const page = await (await on.ask('/a/Site%2Fpage')).text();
  assert.match(page, /shell\.js[^>]*data-git="1"/);

  const off = await boot(t, { MARBLE_DRIVE_SECRET: 'hunter2' });
  const plain = await (await off.ask('/a/Site%2Fpage')).text();
  assert.doesNotMatch(plain, /data-git=/);
});

test('status lists each change with its kind, and the message a publish would use', async (t) => {
  const { status, site } = await boot(t);
  await fsp.writeFile(path.join(site, 'page.mrbl'), DOC.replace('Page</h1>', 'Changed</h1>'));
  await fsp.writeFile(path.join(site, 'new.mrbl'), DOC);
  await fsp.rm(path.join(site, 'Nested/inner.mrbl'));
  const answer = await (await status('Site')).json();
  const byPath = Object.fromEntries(answer.files.map((f) => [f.path, f.change]));
  assert.deepEqual(byPath, { 'page.mrbl': 'changed', 'new.mrbl': 'new', 'Nested/inner.mrbl': 'deleted' });
  assert.equal(answer.changed, 3);
  assert.match(answer.message, /^Publish from Marble Drive: /);
  assert.equal(answer.behind, null);
  assert.equal(answer.fetched, null);
});

test('status names the last commit; a remote that is not GitHub has no links', async (t) => {
  const { status, site } = await boot(t);
  const answer = await (await status('Site')).json();
  assert.equal(answer.last.message, 'first');
  assert.equal(answer.last.commit, git(site, 'rev-parse', 'HEAD'));
  assert.ok(answer.last.short.length >= 7);
  assert.ok(!Number.isNaN(Date.parse(answer.last.when)));
  assert.equal(answer.last.url, null);
  assert.equal(answer.web, null);
  assert.equal(answer.message, null);
});

test('with fetch, status counts what the remote has that the folder does not', async (t) => {
  const { ask, remote, tmp } = await boot(t);
  const other = path.join(tmp, 'other');
  execFileSync('git', ['clone', '-q', remote, other]);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.com');
  await fsp.writeFile(path.join(other, 'theirs.txt'), 'theirs');
  git(other, 'add', '-A');
  git(other, 'commit', '-qm', 'theirs');
  git(other, 'push', '-q');
  const answer = await (await ask('/drive/git?path=Site&fetch=1')).json();
  assert.equal(answer.fetched, true);
  assert.equal(answer.behind, 1);
});

test('a remote that cannot be reached is said, not thrown', async (t) => {
  const { ask, site, tmp } = await boot(t);
  git(site, 'remote', 'set-url', 'origin', path.join(tmp, 'gone.git'));
  const res = await ask('/drive/git?path=Site&fetch=1');
  assert.equal(res.status, 200);
  const answer = await res.json();
  assert.equal(answer.fetched, false);
  assert.ok(answer.fetchError);
});

test('publish uses the message given, and answers with the commit it made', async (t) => {
  const { publish, site, remote } = await boot(t);
  await fsp.writeFile(path.join(site, 'page.mrbl'), DOC.replace('Page</h1>', 'Bio</h1>'));
  const res = await publish('Site', { body: { path: 'Site', message: '  Update the bio  ' } });
  assert.equal(res.status, 200);
  const answer = await res.json();
  assert.equal(git(site, 'log', '-1', '--format=%s'), 'Update the bio');
  assert.equal(answer.last.message, 'Update the bio');
  assert.equal(answer.last.commit, git(remote, 'rev-parse', 'main'));
});

test('a message over 500 characters is refused and nothing is committed', async (t) => {
  const { publish, site, remote } = await boot(t);
  const before = git(remote, 'rev-parse', 'main');
  await fsp.writeFile(path.join(site, 'page.mrbl'), DOC.replace('Page</h1>', 'Long</h1>'));
  const res = await publish('Site', { body: { path: 'Site', message: 'x'.repeat(501) } });
  assert.equal(res.status, 400);
  assert.equal(git(site, 'rev-parse', 'HEAD'), before);
  assert.equal(git(remote, 'rev-parse', 'main'), before);
});
