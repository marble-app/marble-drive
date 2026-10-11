// Publishing a folder that is its own git repository: commit what changed in
// it, and push.
//
// This is the one place the Drive makes a git change on purpose. Everywhere
// else it never does (test/drive-git-boundary.test.js), so this is off unless
// the drive's environment says MARBLE_DRIVE_GIT, and it refuses to start on a
// drive with no passphrase: an open drive answers every request as its owner,
// and this pushes to somebody's remote with their credentials.
//
// A folder is a repository only when the `.git` is in it. Nothing here walks
// up looking for one, because the folder a person pressed Publish on is the
// thing they meant, and a checkout the whole drive happens to sit inside is
// not something the Drive gets to commit to.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { runCommand } from './agent/providers/exec.js';
import { parsePath, resolveUnder, splitPath } from './paths.js';

// A commit runs the repository's own hooks, and a push talks to a remote over
// whatever network the drive has. Both get longer than a question does.
const ASK = 15_000;
const CHANGE = 120_000;
// Asking GitHub what it has: long enough for a slow network, short enough
// that a popover waiting on it is not left asking.
const FETCH = 10_000;
const MESSAGE_MAX = 500;

export function gitAllowed(config) {
  if (!config.git) return { ok: false, why: 'MARBLE_DRIVE_GIT is not set' };
  if (!config.secret) return { ok: false, why: 'publishing needs a passphrase on this drive' };
  return { ok: true, why: null };
}

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

/** The line of git's complaint a person can act on: its `fatal:` or `error:`
 *  if it gave one, otherwise the last thing it said. */
function complaint(result) {
  if (result.missing) return 'git is not installed on this host';
  if (result.timedOut) return 'git took too long and was stopped';
  const lines = String(result.stderr || result.stdout || result.error || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const told = lines.find((line) => /^(fatal|error):/.test(line)) ?? lines.at(-1) ?? 'git failed';
  return told.replace(/^(fatal|error):\s*/, '');
}

/** A remote's page on GitHub, or null for anything that is not GitHub. A
 *  token written into an https remote is dropped: this goes to a page. */
export function githubWeb(remoteUrl) {
  const found = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i
    .exec(String(remoteUrl ?? '').trim());
  return found ? `https://github.com/${found[1]}/${found[2]}` : null;
}

/** `git status -z` as what changed and how. A rename names two paths, the new
 *  one first, and counts as a change to the new one. */
function changedFiles(porcelain) {
  const parts = porcelain.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const change = code === '??' || code.includes('A') ? 'new' : code.includes('D') ? 'deleted' : 'changed';
    files.push({ path: entry.slice(3), change });
    if (code[0] === 'R' || code[0] === 'C') i += 1;
  }
  return files;
}

/** What the commit says it is: the names a person would recognise, not paths. */
function messageFor(files) {
  const names = [...new Set(files.map((file) => splitPath(file).name))];
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
  return `Publish from Marble Drive: ${shown}${more}`;
}

export function createGit({ root, run = runCommand }) {
  // One publish per folder at a time: two presses of the button are one push
  // and then a "nothing to publish", not two commits racing for the index.
  const chains = new Map();

  async function repoAt(folder) {
    const clean = parsePath(folder, { allowRoot: false });
    const at = resolveUnder(root, clean);
    const dot = await fsp.stat(path.join(at, '.git')).catch(() => null);
    return { folder: clean, at: dot ? at : null };
  }

  // The ceiling is the folder's parent: `-C` already points git at the folder
  // and it finds the `.git` there first, so this only matters for a repository
  // that has since gone — git then stops instead of finding a bigger one.
  const git = (at, args, timeout = ASK) =>
    run('git', ['-C', at, ...args], {
      timeout,
      // No optional locks: a look at the status from the bar must never hold
      // the index lock a publish's `add` is about to need.
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(at), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });

  async function must(at, args, timeout) {
    const result = await git(at, args, timeout);
    if (result.code !== 0) throw bad(complaint(result), result.missing ? 501 : 502);
    return result.stdout;
  }

  /** The branch checked out, or null when HEAD is detached. */
  async function branchOf(at) {
    const result = await git(at, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    return result.code === 0 ? result.stdout.trim() : null;
  }

  /** Where the branch pushes to, as git configured it: `origin` and `refs/heads/main`. */
  async function upstreamOf(at, branch) {
    if (!branch) return null;
    const remote = (await git(at, ['config', '--get', `branch.${branch}.remote`])).stdout.trim();
    const ref = (await git(at, ['config', '--get', `branch.${branch}.merge`])).stdout.trim();
    if (!remote || !ref) return null;
    // A branch may push to a URL rather than to a named remote, and that URL
    // may carry a token. The name goes to a page, so it goes without one.
    const shown = remote.replace(/^([a-z][\w+.-]*:\/\/)[^/@]*@/i, '$1');
    return { remote, ref, name: `${shown}/${ref.replace(/^refs\/heads\//, '')}` };
  }

  /** What changed, and the repositories inside this one that are not part of
   *  it. Edits inside a tracked inner repository are its own to publish, and
   *  an untracked one would be filed as a bare link, so neither is a change
   *  here; `nested` is what `add` has to leave out. */
  async function changes(at) {
    const listed = changedFiles(await must(at, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=dirty']));
    const files = [];
    const nested = [];
    for (const file of listed) {
      const inner = file.change === 'new' && file.path.endsWith('/')
        && await fsp.stat(path.join(at, file.path, '.git')).catch(() => null);
      if (inner) nested.push(file.path.slice(0, -1));
      else files.push(file);
    }
    return { files, nested };
  }

  /** Commits on this branch its upstream does not have. */
  async function aheadOf(at, upstream) {
    const counted = await git(at, ['rev-list', '--count', `${upstream.name}..HEAD`]);
    // An upstream that was never fetched has nothing to compare against, and
    // everything here is ahead of it.
    if (counted.code !== 0) return Number((await must(at, ['rev-list', '--count', 'HEAD'])).trim());
    return Number(counted.stdout.trim());
  }

  /** The repository's page on GitHub, from the remote the branch pushes to. */
  async function webOf(at, upstream) {
    const remote = upstream?.remote ?? 'origin';
    if (/:\/\/|^[\w.-]+@[\w.-]+:/.test(remote)) return githubWeb(remote);
    return githubWeb((await git(at, ['config', '--get', `remote.${remote}.url`])).stdout);
  }

  /** HEAD as a person reads it, or null on a branch with no commits yet. */
  async function lastOf(at, web) {
    const shown = await git(at, ['log', '-1', '--format=%H%x00%h%x00%s%x00%cI']);
    if (shown.code !== 0 || !shown.stdout.trim()) return null;
    const [commit, short, message, when] = shown.stdout.trim().split('\0');
    return { commit, short, message, when, url: web ? `${web}/commit/${commit}` : null };
  }

  /** Commits the upstream has that HEAD lacks, as of the last fetch. */
  async function behindOf(at, upstream) {
    const counted = await git(at, ['rev-list', '--count', `HEAD..${upstream.name}`]);
    return counted.code === 0 ? Number(counted.stdout.trim()) : null;
  }

  async function status(folder, { fetch = false } = {}) {
    const { folder: clean, at } = await repoAt(folder);
    if (!at) return { repo: false, path: clean };
    const branch = await branchOf(at);
    const upstream = await upstreamOf(at, branch);
    // Asking GitHub is the slow part and the only one that leaves the
    // machine, so it happens when a person opens the popover, not on every
    // look at the bar.
    let fetched = null;
    let fetchError = null;
    if (fetch && upstream) {
      const got = await git(at, ['fetch', '--quiet', upstream.remote], FETCH);
      fetched = got.code === 0;
      if (!fetched) fetchError = complaint(got);
    }
    const { files } = await changes(at);
    const web = await webOf(at, upstream);
    return {
      repo: true,
      path: clean,
      branch,
      upstream: upstream?.name ?? null,
      changed: files.length,
      files,
      ahead: upstream ? await aheadOf(at, upstream) : null,
      behind: fetch && upstream ? await behindOf(at, upstream) : null,
      fetched,
      fetchError,
      web,
      last: await lastOf(at, web),
      message: files.length ? messageFor(files.map((file) => file.path)) : null,
    };
  }

  async function publishNow(folder, { message = '' } = {}) {
    const said = String(message ?? '').trim();
    if (said.length > MESSAGE_MAX) throw bad(`a message is at most ${MESSAGE_MAX} characters`);
    const { folder: clean, at } = await repoAt(folder);
    if (!at) throw bad(`"${clean}" is not a git repository`);
    const branch = await branchOf(at);
    if (!branch) throw bad('this folder is not on a branch, so there is nowhere to publish to', 409);
    const upstream = await upstreamOf(at, branch);
    if (!upstream) {
      throw bad(`${branch} has no upstream yet: push it once from a terminal with git push -u`, 409);
    }

    const { files: changed, nested } = await changes(at);
    const files = changed.map((file) => file.path);
    if (files.length) {
      await must(at, ['add', '-A', '--', '.', ...nested.map((inner) => `:(exclude)${inner}`)], CHANGE);
      await must(at, ['commit', '--quiet', '-m', said || messageFor(files)], CHANGE);
    }
    const commit = (await must(at, ['rev-parse', 'HEAD'])).trim();
    if (!files.length && (await aheadOf(at, upstream)) === 0) {
      return { ok: true, nothing: true, branch, upstream: upstream.name, commit, files };
    }

    // Named outright rather than left to `push.default`, which pushes nothing
    // at all when the upstream's branch is called something else.
    const pushed = await git(at, ['push', '--quiet', upstream.remote, `HEAD:${upstream.ref}`], CHANGE);
    if (pushed.code !== 0) {
      const kept = files.length ? 'Committed here, but not published' : 'Not published';
      // Never forced: a remote that moved on has someone else's work in it.
      if (/\[rejected\]|non-fast-forward|fetch first/.test(pushed.stderr)) {
        throw bad(`${kept}: the remote has changes this folder does not. Pull them first.`, 409);
      }
      throw bad(`${kept}: ${complaint(pushed)}`, 502);
    }
    return { ok: true, branch, upstream: upstream.name, commit, files, last: await lastOf(at, await webOf(at, upstream)) };
  }

  function publish(folder, options = {}) {
    const key = parsePath(folder, { allowRoot: false });
    const next = (chains.get(key) ?? Promise.resolve()).then(() => publishNow(key, options), () => publishNow(key, options));
    chains.set(key, next.catch(() => {}));
    return next;
  }

  return { status, publish };
}
