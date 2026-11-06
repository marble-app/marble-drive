// The drive's listing, held in memory and told what changed.
//
// A Drive asks for the whole tree each time it draws: on every folder opened,
// and again whenever anything in the drive changes, from every open tab. On
// the owner's PC (2026-11-05) that tree was 260 documents, 8,118 folders and
// 32,040 other files. Walking it took 2.2 s and 3.3 s of CPU every time, so
// with agents saving every few seconds the host spent most of a core reading
// folders nothing had touched, and a folder click waited 2.6 s behind it.
//
// So each folder is read once and then kept. Whatever can change one says
// which: the watcher (server/watch.js) for every writer that is not this host,
// and the store for its own writes, before the route that made them tells
// anybody. A folder said to have changed is read again the next time
// something lists it: only the names said to have changed, or all of it when
// the change could have been anything. Nothing else is read.
//
// It is believed only while something watches. Without a watcher (a tool run
// from the command line, a test that never starts one) the store walks the
// disk as it always did. A folder the watcher lost is read afresh on every
// listing. And once a minute each folder's own change time is checked against
// the one it was read at, so a change nobody reported is seen within a minute.
//
// Every change to what a folder lists is numbered. A page that already holds
// the tree at some number is sent only the folders that changed after it
// (`changesSince`), so a refresh while agents work is a few hundred bytes
// rather than twelve megabytes.

import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { isInside, joinPath, splitPath, titleize } from '../paths.js';

const HIDDEN = /^\./;

// Folders, then documents, then everything else, each newest first: the
// order a Drive shows a folder in (and the order the walk's tree used).
const KIND_RANK = { folder: 0, doc: 1, file: 2 };
const byShowing = (a, b) =>
  a.kind !== b.kind
    ? KIND_RANK[a.kind] - KIND_RANK[b.kind]
    : b.modified - a.modified || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// Folders read at once. Each read is a readdir and a stat a name, all handed
// to libuv's four threads, so more than this only queues there.
const READ_AT_ONCE = 64;
// A patch bigger than this is no cheaper than the tree.
const PATCH_MAX = 2000;
const SWEEP_MS = 60 * 1000;

const same = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
};

async function inPool(items, limit, fn) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/**
 * `abs(path)` is where a drive path is on disk. `entryOf(folder, name,
 * dirent)` is what the store lists for a name that is not a folder (a
 * document's stat, a file's), or null for one it does not list; `dirent` is
 * readdir's, or an lstat of the one name, and either says what kind of thing
 * it is without following a link.
 */
export function createLiveIndex({ abs, entryOf, sweepMs = SWEEP_MS }) {
  const epoch = randomBytes(4).toString('hex');
  let version = 0;
  let watched = false;
  let sweeping = null;
  let timer = null;

  // folder path → what is known of that folder. `entries` is null until it is
  // first read; `all` asks for the whole folder to be read again, `stale` for
  // only those names. `changed` is the number of the last change to what it
  // lists, `shown` of the last one a listing without files would show.
  const dirs = new Map();
  const dirty = new Set();
  const lost = new Set();

  const stateOf = (dir) => ({ path: dir, entries: null, repo: false, mtime: 0, ino: 0, all: true, stale: new Set(), busy: null, changed: 0, shown: 0 });
  dirs.set('', stateOf(''));
  dirty.add('');

  const needs = (d) => d.all || !d.entries || d.stale.size > 0 || lost.has(d.path);

  function drop(dir) {
    for (const key of [...dirs.keys()]) {
      if (key === dir || key.startsWith(`${dir}/`)) {
        dirs.delete(key);
        dirty.delete(key);
        lost.delete(key);
      }
    }
  }

  function mark(dir, name) {
    const d = dirs.get(dir);
    // A folder never read is read whole when it is, and one not known yet
    // turns up in its parent's listing.
    if (!d?.entries) return;
    d.stale.add(name);
    dirty.add(dir);
  }

  /** Something at `rel` (a path under the root, `/`-separated, with its
   *  extension) may have changed: been made, written, renamed or removed. */
  function saw(rel) {
    const parts = String(rel).split('/').filter(Boolean);
    if (!parts.length) return;
    const name = parts.pop();
    // Inside a hidden folder (`.marble/…`, `.git/…`) nothing is listed. A
    // `.git` itself still matters: it is what makes a folder a repository.
    if (parts.some((part) => HIDDEN.test(part))) return;
    if (HIDDEN.test(name) && name !== '.git') return;
    const dir = parts.join('/');
    mark(dir, name);
    // The folder's own change time moves with what it holds, and that time
    // is in its parent's listing.
    if (parts.length) {
      const { parent, name: leaf } = splitPath(dir);
      mark(parent, leaf);
    }
  }

  /** Read this folder whole next time: a watcher has only now started on it,
   *  so whatever happened in it before that went unsaid. */
  function reread(dir) {
    lost.delete(dir);
    const d = dirs.get(dir);
    if (!d) return;
    d.all = true;
    dirty.add(dir);
  }

  /** Nothing watches this folder now, so it is read on every listing. */
  function unwatched(dir) {
    lost.add(dir);
  }

  async function folderEntry(dir, name) {
    const info = await fsp.stat(path.join(abs(dir), name)).catch(() => null);
    return {
      entry: { kind: 'folder', path: joinPath(dir, name), name, folder: dir, title: titleize(name), modified: info?.mtimeMs ?? 0 },
      ino: info?.ino ?? 0,
    };
  }

  async function one(dir, name, dirent) {
    if (HIDDEN.test(name)) return null;
    if (dirent.isDirectory()) return folderEntry(dir, name);
    const entry = await entryOf(dir, name, dirent);
    return entry ? { entry } : null;
  }

  function fresh(d) {
    if (d.busy) return d.busy;
    d.busy = (async () => {
      const whole = d.all || !d.entries || lost.has(d.path);
      const names = whole ? null : [...d.stale];
      // Anything said while this read is out lands in a new set and is read
      // on the next pass, never lost under this one.
      d.all = false;
      d.stale = new Set();
      dirty.delete(d.path);

      const at = abs(d.path);
      const info = await fsp.stat(at).catch(() => null);
      let repo = d.repo;
      const found = new Map();
      let next;
      if (whole) {
        const listed = info?.isDirectory() ? await fsp.readdir(at, { withFileTypes: true }).catch(() => []) : [];
        repo = listed.some((dirent) => dirent.name === '.git');
        next = new Map();
        await Promise.all(listed.map(async (dirent) => {
          const got = await one(d.path, dirent.name, dirent);
          if (got) found.set(dirent.name, got);
        }));
        // In the order the folder was read, so a listing reads the same
        // however often the folder has been read since.
        for (const dirent of listed) if (found.has(dirent.name)) next.set(dirent.name, found.get(dirent.name).entry);
      } else {
        next = new Map(d.entries);
        await Promise.all(names.map(async (name) => {
          if (name === '.git') {
            repo = Boolean(await fsp.lstat(path.join(at, name)).catch(() => null));
            return;
          }
          const dirent = await fsp.lstat(path.join(at, name)).catch(() => null);
          const got = dirent ? await one(d.path, name, dirent) : null;
          if (got) found.set(name, got);
          else next.delete(name);
        }));
        for (const [name, got] of found) next.set(name, got.entry);
      }
      // Dropped while it was read: its parent no longer holds it.
      if (dirs.get(d.path) !== d) return;
      settle(d, next, found, repo, info);
    })().catch((err) => {
      // Whatever it was, the folder is still owed a read.
      d.all = true;
      dirty.add(d.path);
      throw err;
    }).finally(() => {
      d.busy = null;
    });
    return d.busy;
  }

  function settle(d, next, found, repo, info) {
    let changed = !d.entries;
    let shown = !d.entries;
    const before = d.entries ?? new Map();
    for (const [name, was] of before) {
      const now = next.get(name);
      if (now && same(was, now)) continue;
      changed = true;
      if (was.kind !== 'file' || now?.kind !== 'file') shown = true;
      if (was.kind === 'folder' && now?.kind !== 'folder') drop(was.path);
    }
    for (const [name, now] of next) {
      if (!before.has(name)) {
        changed = true;
        if (now.kind !== 'file') shown = true;
      }
      if (now.kind !== 'folder') continue;
      const ino = found.get(name)?.ino;
      const child = dirs.get(now.path);
      // A folder removed and made again under the same name is a new folder,
      // and nothing of the old one's listing holds.
      if (child && ino && child.ino && ino !== child.ino) drop(now.path);
      if (!dirs.has(now.path)) {
        dirs.set(now.path, stateOf(now.path));
        dirty.add(now.path);
      }
    }
    d.entries = next;
    d.mtime = info?.mtimeMs ?? 0;
    d.ino = info?.ino ?? 0;
    if (changed || shown) version += 1;
    if (changed) d.changed = version;
    if (shown) d.shown = version;
    if (repo !== d.repo) {
      d.repo = repo;
      // Whether a folder is a repository is drawn on its row, in its parent.
      const parent = d.path === '' ? null : dirs.get(splitPath(d.path).parent);
      if (parent) {
        version += 1;
        parent.changed = version;
        parent.shown = version;
      }
    }
  }

  /**
   * Brings `folder` up to date, and with `deep` everything under it. Answers
   * whether it is a folder at all. Each folder is read at most twice a call,
   * so a writer that never stops cannot keep a listing from answering.
   */
  async function ensure(folder, { deep = true } = {}) {
    let at = '';
    const down = folder === '' ? [] : folder.split('/');
    for (let i = 0; ; i++) {
      const d = dirs.get(at);
      if (!d) return false;
      if (needs(d)) await fresh(d);
      if (dirs.get(at) !== d) return false;
      if (i === down.length) break;
      at = joinPath(at, down[i]);
    }
    if (!deep) return true;
    const reads = new Map();
    const within = (dir) => dir === folder || isInside(dir, folder);
    for (;;) {
      const todo = [];
      for (const dir of [...dirty, ...lost]) {
        if (!within(dir) || (reads.get(dir) ?? 0) >= (lost.has(dir) ? 1 : 2)) continue;
        const d = dirs.get(dir);
        if (d && needs(d)) todo.push(d);
      }
      if (!todo.length) return true;
      for (const d of todo) reads.set(d.path, (reads.get(d.path) ?? 0) + 1);
      await inPool([...new Set(todo)], READ_AT_ONCE, fresh);
    }
  }

  const copyOf = (entry) => {
    if (entry.kind !== 'folder') return { ...entry };
    return dirs.get(entry.path)?.repo ? { ...entry, repo: true } : { ...entry };
  };

  /** What one folder lists, in the order it is shown, copies all. */
  function childrenOf(dir, { files = true } = {}) {
    const d = dirs.get(dir);
    if (!d?.entries) return [];
    const out = [];
    for (const entry of d.entries.values()) if (files || entry.kind !== 'file') out.push(copyOf(entry));
    return out.sort(byShowing);
  }

  /** Every entry under `folder`, flat and unsorted, as the walk found them. */
  function entries(folder, { recursive = true, files = false } = {}) {
    const out = [];
    const visit = (dir) => {
      const d = dirs.get(dir);
      if (!d?.entries) return;
      for (const entry of d.entries.values()) {
        if (entry.kind === 'file' && !files) continue;
        // The walk only knew a folder was a repository by going into it.
        out.push(recursive ? copyOf(entry) : { ...entry });
        if (entry.kind === 'folder' && recursive) visit(entry.path);
      }
    };
    visit(folder);
    return out;
  }

  /** The folder as a tree: folders carry `children`. */
  function tree(folder, { files = true } = {}) {
    const { parent, name } = splitPath(folder);
    const fill = (node) => {
      node.children = childrenOf(node.path, { files }).map((child) => (child.kind === 'folder' ? fill(child) : child));
      return node;
    };
    return fill({ kind: 'folder', path: folder, name, folder: parent, title: folder === '' ? 'My Drive' : titleize(name), children: [] });
  }

  const token = () => `${epoch}.${version}`;

  /**
   * What changed under `folder` after `since` (a token this index handed
   * out): `{same: true}`, or `{patch}` — each folder whose listing changed,
   * with all it lists now, parents before children, its folders without
   * their own children. Null when `since` cannot be answered that way (another
   * run of the host, or too much changed), and the whole tree is the answer.
   */
  function changesSince(since, folder, { files = true } = {}) {
    const [was, count] = String(since ?? '').split('.');
    const n = Number(count);
    if (was !== epoch || !Number.isInteger(n) || n < 0 || n > version) return null;
    const key = files ? 'changed' : 'shown';
    const moved = [];
    for (const d of dirs.values()) {
      if (d[key] <= n || !d.entries) continue;
      if (d.path !== folder && !isInside(d.path, folder)) continue;
      moved.push(d.path);
      if (moved.length > PATCH_MAX) return null;
    }
    if (!moved.length) return { same: true };
    const depth = (dir) => (dir === '' ? 0 : dir.split('/').length);
    moved.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1));
    return { patch: moved.map((dir) => ({ path: dir, children: childrenOf(dir, { files }) })) };
  }

  /** Each folder's own change time against the one it was read at: what
   *  catches a change the watcher never said. */
  async function sweep() {
    if (sweeping) return sweeping;
    sweeping = inPool([...dirs.values()], 16, async (d) => {
      // A folder already owed a read will be read, and the read takes its time.
      if (!d.entries || d.busy || dirty.has(d.path) || dirs.get(d.path) !== d) return;
      const info = await fsp.stat(abs(d.path)).catch(() => null);
      if (!info || info.mtimeMs !== d.mtime || info.ino !== d.ino) {
        if (d.path === '') {
          d.all = true;
          dirty.add('');
        } else {
          const { parent, name } = splitPath(d.path);
          mark(parent, name);
          d.all = true;
          dirty.add(d.path);
        }
      }
    }).finally(() => {
      sweeping = null;
    });
    return sweeping;
  }

  /** The watcher started (true) or stopped (false). What happened while
   *  nothing watched is unknown, so a start reads every folder again. */
  function watching(on) {
    if (on && !watched) {
      for (const d of dirs.values()) {
        d.all = true;
        dirty.add(d.path);
      }
      if (sweepMs > 0) {
        timer = setInterval(() => sweep().catch(() => {}), sweepMs);
        timer.unref?.();
      }
    }
    if (!on) {
      clearInterval(timer);
      timer = null;
    }
    watched = Boolean(on);
  }

  return {
    get live() {
      return watched;
    },
    saw,
    reread,
    unwatched,
    watching,
    ensure,
    entries,
    childrenOf,
    tree,
    token,
    changesSince,
    sweep,
    get folders() {
      return dirs.size;
    },
  };
}
