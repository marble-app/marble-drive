// The workshop as the console shows it: admin-p1's checkouts of marble-drive
// and marble (/home/sprite/src), what main is, and how far a drive's release is
// behind it. Read with git and npm; nothing here changes anything.

import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const REPOS = ['marble-drive', 'marble'];

const git = (cwd, args) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout.replace(/\n$/, '')));
  });

const npmLatest = (pkg) =>
  new Promise((resolve) => {
    execFile('npm', ['view', pkg, 'version'], { timeout: 30_000 }, (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });

const readJson = async (file) => {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
};

/** The commit a release was built from: <stamp>-<sha7> or <stamp>-local-<sha7>. */
export const releaseSha = (release) => /-([0-9a-f]{7,40})$/.exec(String(release ?? ''))?.[1] ?? null;

const LOG = ['log', '--format=%H%x1f%s%x1f%cI%x1f%an'];
const commits = (text) => (text ? text.split('\n').filter(Boolean).map((line) => {
  const [sha, subject, at, author] = line.split('\x1f');
  return { sha, subject, at, author };
}) : []);

export function createWorkshop({ src, npmVersion = () => npmLatest('@bdhmin/marble'), fetchEveryMs = 60_000 }) {
  const dirOf = (name) => path.join(src, name);
  let fetchedAt = 0;
  let npm = { at: 0, value: null };

  /** Bring origin up to date, at most once a minute unless told to. */
  async function fetch({ force = false } = {}) {
    if (!force && Date.now() - fetchedAt < fetchEveryMs) return;
    fetchedAt = Date.now();
    await Promise.all(REPOS.map((name) => git(dirOf(name), ['fetch', '--quiet', 'origin'])));
  }

  async function repo(name) {
    const dir = dirOf(name);
    const top = await git(dir, ['rev-parse', '--show-toplevel']);
    // Its own repository, not one it happens to sit inside; compared as real
    // paths, because a checkout may be reached through a link.
    const real = await fsp.realpath(dir).catch(() => null);
    if (top === null || real === null || (await fsp.realpath(top)) !== real) return { name, path: dir, exists: false };
    const [branch, head, status, counts, upstream] = await Promise.all([
      git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(dir, [...LOG, '-1']),
      git(dir, ['status', '--porcelain']),
      git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']),
      git(dir, ['rev-parse', '--abbrev-ref', '@{upstream}']),
    ]);
    const [ahead, behind] = (counts ?? '').split(/\s+/).map(Number);
    return {
      name,
      path: dir,
      exists: true,
      branch,
      upstream,
      head: commits(head)[0] ?? null,
      changed: (status ?? '').split('\n').filter(Boolean).map((line) => ({ status: line.slice(0, 2).trim(), file: line.slice(3) })),
      ahead: Number.isFinite(ahead) ? ahead : null,
      behind: Number.isFinite(behind) ? behind : null,
    };
  }

  async function marbleVersions() {
    if (Date.now() - npm.at > 10 * 60_000) npm = { at: Date.now(), value: await npmVersion() };
    const [own, dep] = await Promise.all([
      readJson(path.join(dirOf('marble'), 'package.json')),
      readJson(path.join(dirOf('marble-drive'), 'package.json')),
    ]);
    return { repo: own?.version ?? null, dependency: dep?.dependencies?.['@bdhmin/marble'] ?? null, npm: npm.value };
  }

  async function main(n = 12) {
    const dir = dirOf('marble-drive');
    const log = await git(dir, [...LOG, `-${n}`, 'origin/main']);
    const list = commits(log);
    return { sha: list[0]?.sha ?? null, commits: list };
  }

  async function status() {
    const [repos, marble, mainLog, pin] = await Promise.all([
      Promise.all(REPOS.map(repo)),
      marbleVersions(),
      main(),
      fsp.readFile(path.join(dirOf('marble-drive'), 'tools', 'sprite', 'claude-version'), 'utf8').catch(() => null),
    ]);
    return { repos, marble, main: mainLog, claudePin: pin?.trim() || null, fetchedAt: fetchedAt || null };
  }

  /** How many commits on main a release does not have; null when its commit
   *  is not one this checkout knows. */
  async function behind(release) {
    const sha = releaseSha(release);
    if (!sha) return null;
    const dir = dirOf('marble-drive');
    if ((await git(dir, ['cat-file', '-e', `${sha}^{commit}`])) === null) return null;
    const count = await git(dir, ['rev-list', '--count', `${sha}..origin/main`]);
    return count === null ? null : Number(count);
  }

  return { status, fetch, behind, main, dirOf };
}
