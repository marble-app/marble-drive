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

/** `git status -z` as the paths it names. A rename names two, the new one first. */
function changedFiles(porcelain) {
  const parts = porcelain.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') i += 1;
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
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(at), GIT_TERMINAL_PROMPT: '0' },
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
    return { remote, ref, name: `${remote}/${ref.replace(/^refs\/heads\//, '')}` };
  }

  const changes = async (at) =>
    changedFiles(await must(at, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));

  /** Commits on this branch its upstream does not have. */
  async function aheadOf(at, upstream) {
    const counted = await git(at, ['rev-list', '--count', `${upstream.name}..HEAD`]);
    // An upstream that was never fetched has nothing to compare against, and
    // everything here is ahead of it.
    if (counted.code !== 0) return Number((await must(at, ['rev-list', '--count', 'HEAD'])).trim());
    return Number(counted.stdout.trim());
  }

  async function status(folder) {
    const { folder: clean, at } = await repoAt(folder);
    if (!at) return { repo: false, path: clean };
    const branch = await branchOf(at);
    const upstream = await upstreamOf(at, branch);
    return {
      repo: true,
      path: clean,
      branch,
      upstream: upstream?.name ?? null,
      changed: (await changes(at)).length,
      ahead: upstream ? await aheadOf(at, upstream) : null,
    };
  }

  async function publishNow(folder) {
    const { folder: clean, at } = await repoAt(folder);
    if (!at) throw bad(`"${clean}" is not a git repository`);
    const branch = await branchOf(at);
    if (!branch) throw bad('this folder is not on a branch, so there is nowhere to publish to', 409);
    const upstream = await upstreamOf(at, branch);
    if (!upstream) {
      throw bad(`${branch} has no upstream yet: push it once from a terminal with git push -u`, 409);
    }

    const files = await changes(at);
    if (files.length) {
      await must(at, ['add', '-A'], CHANGE);
      await must(at, ['commit', '--quiet', '-m', messageFor(files)], CHANGE);
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
    return { ok: true, branch, upstream: upstream.name, commit, files };
  }

  function publish(folder) {
    const key = parsePath(folder, { allowRoot: false });
    const next = (chains.get(key) ?? Promise.resolve()).then(() => publishNow(key), () => publishNow(key));
    chains.set(key, next.catch(() => {}));
    return next;
  }

  return { status, publish };
}
