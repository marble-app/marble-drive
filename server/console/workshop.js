// The workshop as the console shows it: admin-p2's checkouts of marble-drive
// and marble (/home/sprite/src), what main is, and how far a drive's release is
// behind it. Read with git and npm; nothing here changes anything.
//
// Each checkout also comes with `next`: where it stands, in one word, and the
// one thing to do about it. It is worked out here rather than in the page so
// that "1 behind" and "npm 0.2.2 · here 0.2.3" arrive already read.

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

/** Who npm is signed in as here: a name, false when it is not signed in, and
 *  null when npm could not be asked (no network, no npm). */
const npmWhoami = () =>
  new Promise((resolve) => {
    execFile('npm', ['whoami'], { timeout: 30_000 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout.trim() || null);
      resolve(/E401|ENEEDAUTH|401 Unauthorized|not logged in/i.test(`${stdout}${stderr}`) ? false : null);
    });
  });

/** -1, 0 or 1, for x.y.z versions; null when either is not one. */
export function compareVersions(a, b) {
  const pa = /^(\d+)\.(\d+)\.(\d+)/.exec(String(a ?? ''));
  const pb = /^(\d+)\.(\d+)\.(\d+)/.exec(String(b ?? ''));
  if (!pa || !pb) return null;
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return Math.sign(d);
  }
  return 0;
}

export const nextPatch = (version) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ''));
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : null;
};

/** A version commit the Publish button makes, which is not itself a change. */
const RELEASE_SUBJECT = /^marble \d+\.\d+\.\d+$/;

/**
 * Where a checkout stands and the one thing to do next. `state` is what is
 * true; `action` is the button that moves it on (pull, publish, finish,
 * npm-login), or null when there is nothing to do or nothing safe to offer.
 * Order matters: uncommitted edits and a copy behind GitHub are settled
 * before anything is published, because Publish builds from this copy.
 */
export function nextFor(r, marble) {
  if (!r.exists) return { state: 'missing', action: null };
  if (r.changed.length) return { state: 'edited', action: null };
  if (r.behind > 0) return { state: 'behind', action: 'pull', count: r.behind };
  if (r.behind === null) return { state: 'no-upstream', action: null };
  if (r.name !== 'marble') return { state: r.ahead > 0 ? 'ahead' : 'current', action: null, count: r.ahead };

  const here = marble.repo;
  if (marble.npm === null) return { state: 'npm-unknown', action: null, version: here };
  const cmp = compareVersions(here, marble.npm);
  if (cmp === null) return { state: 'npm-unknown', action: null, version: here };
  if (cmp < 0) return { state: 'older', action: null, version: here, npm: marble.npm };
  const prepared = cmp > 0;
  const changes = marble.unreleased?.length ?? 0;
  if (!prepared && marble.unreleased === null) return { state: 'untagged', action: null, version: here };
  if (!prepared && !changes) return { state: 'current', action: null, version: here };
  const version = prepared ? here : nextPatch(here);
  const state = prepared ? 'prepared' : 'unreleased';
  // Signed out stops a publish before it changes anything, so say it first.
  if (marble.npmUser === false) return { state, action: 'npm-login', version, npm: marble.npm, count: changes, signedOut: true };
  return { state, action: prepared ? 'finish' : 'publish', version, npm: marble.npm, count: changes, ahead: r.ahead };
}

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

export function createWorkshop({ src, npmVersion = () => npmLatest('@bdhmin/marble'), npmUser = npmWhoami, fetchEveryMs = 60_000 }) {
  const dirOf = (name) => path.join(src, name);
  let fetchedAt = 0;
  let npm = { at: 0, value: null, user: null };

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
    if (Date.now() - npm.at > 10 * 60_000) {
      const [value, user] = await Promise.all([npmVersion(), npmUser()]);
      npm = { at: Date.now(), value, user };
    }
    const [own, dep] = await Promise.all([
      readJson(path.join(dirOf('marble'), 'package.json')),
      readJson(path.join(dirOf('marble-drive'), 'package.json')),
    ]);
    return {
      repo: own?.version ?? null,
      dependency: dep?.dependencies?.['@bdhmin/marble'] ?? null,
      npm: npm.value,
      npmUser: npm.user,
      unreleased: await unreleased(npm.value),
    };
  }

  /** marble's commits since the release npm has, by its tag; null when that
   *  tag is not here, because then nobody can say. */
  async function unreleased(version) {
    if (!version) return null;
    const dir = dirOf('marble');
    const tag = `v${version}`;
    if ((await git(dir, ['rev-parse', '-q', '--verify', `refs/tags/${tag}`])) === null) return null;
    const log = await git(dir, [...LOG, `${tag}..HEAD`]);
    if (log === null) return null;
    return commits(log).filter((c) => !RELEASE_SUBJECT.test(c.subject)).map(({ sha, subject }) => ({ sha, subject }));
  }

  /** Ask npm again on the next read: after a publish or a sign-in, the
   *  ten-minute cache would say the old thing for ten minutes. */
  const forgetNpm = () => {
    npm = { at: 0, value: null, user: null };
  };

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
    for (const r of repos) r.next = nextFor(r, marble);
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

  return { status, fetch, behind, main, dirOf, forgetNpm };
}
