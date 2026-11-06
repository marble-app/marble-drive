// A watcher that sees into folders.
//
// Marble's host watches one flat directory, which is the right amount of
// watching for a flat namespace. Nested folders need `{recursive: true}`, and
// what breaks quietly without it is not the listing — it is live reconcile, the
// thing that makes an edit from a text editor or an agent arrive in an open page
// as a patch instead of a reload. A document one level down would simply stop
// updating, with nothing in any log to say so.
//
// Two things this has to get right, both of which cost a bug to learn:
//
//   - a save is a rename, so the *directory* is watched, never the file;
//   - one save wakes the watcher more than once, so events are debounced per
//     document and the writer is remembered rather than consumed.
//
// It also keeps the store's listing (server/store/live-index.js): every name
// it hears change, document or not, is said to the index at once, so a Drive
// listing reads only the folders something touched instead of walking the
// whole drive.

import fs from 'node:fs';
import path from 'node:path';

import { DOC_EXT, isValidPath } from './paths.js';

const SETTLE = 80;

// macOS and Windows support recursive watches natively; Linux does not, and
// Node says so by throwing ERR_FEATURE_UNAVAILABLE_ON_PLATFORM. A Drive that
// only reconciles on a Mac is not a Drive, so the fallback is a walk that
// watches each directory it finds and picks up new ones as they appear.
const RECURSIVE_SUPPORTED = process.platform === 'darwin' || process.platform === 'win32';

export function watchDrive(
  store,
  onChange,
  { recursiveSupported = RECURSIVE_SUPPORTED, onError = (docPath, err) => console.error(`[watch] ${docPath}: ${err?.stack ?? err}`) } = {},
) {
  const root = store._fsWatchRoot();
  const index = store._fsIndex ?? null;
  const pending = new Map();
  const watchers = new Map();
  // Which directory each watcher was opened on: a folder removed and made
  // again under its name is a new directory, and the old watch is dead.
  const inodes = new Map();
  let closed = false;
  let started = false;

  const relativeOf = (full) => path.relative(root, full).split(path.sep).join('/');

  const relativeDoc = (filename) => {
    if (!filename || !filename.endsWith(DOC_EXT)) return null;
    const docPath = filename.split(path.sep).join('/').slice(0, -DOC_EXT.length);
    // `.marble/…` is bookkeeping, and a name the grammar refuses is a file
    // somebody put there by hand. Neither is a document changing.
    if (docPath.split('/').some((segment) => segment.startsWith('.'))) return null;
    return isValidPath(docPath) ? docPath : null;
  };

  function fire(docPath) {
    clearTimeout(pending.get(docPath));
    pending.set(
      docPath,
      setTimeout(() => {
        pending.delete(docPath);
        // A handler that fails is said, with the document it failed on —
        // swallowed, a merge that threw left a page silently out of step.
        if (closed) return;
        try {
          Promise.resolve(onChange(docPath)).catch((err) => onError(docPath, err));
        } catch (err) {
          onError(docPath, err);
        }
      }, SETTLE),
    );
  }

  function watchDir(dir) {
    if (closed) return;
    if (watchers.has(dir)) {
      // Still the directory it was opened on, or one made since in its
      // place, which the old watch cannot hear: everything under a folder
      // that was removed and made again is new, however deep.
      const ino = fs.statSync(dir, { throwIfNoEntry: false })?.ino;
      if (ino === inodes.get(dir)) return;
      watchers.get(dir).close();
      watchers.delete(dir);
      inodes.delete(dir);
    }
    let watcher;
    try {
      watcher = fs.watch(dir, { recursive: recursiveSupported });
      inodes.set(dir, fs.statSync(dir, { throwIfNoEntry: false })?.ino ?? 0);
    } catch {
      // A directory that vanished between the walk and the watch. Not an error:
      // the parent's own watcher will report it if it comes back.
      watcher?.close();
      return;
    }
    watchers.set(dir, watcher);
    // A folder that turned up after the start: whatever landed in it before
    // this watch went unheard, so the index reads it whole.
    if (started) index?.reread(relativeOf(dir));

    watcher.on('error', () => {
      watcher.close();
      // One replaced since is not this one's to take down.
      if (watchers.get(dir) !== watcher) return;
      watchers.delete(dir);
      inodes.delete(dir);
      if (recursiveSupported) index?.watching(false);
      else index?.unwatched(relativeOf(dir));
    });

    watcher.on('change', (_event, filename) => {
      // No name is "something here changed": read the folder whole.
      if (!filename) return index?.reread(relativeOf(dir));
      const full = path.join(dir, filename.toString());
      const relative = path.relative(root, full);
      index?.saw(relative.split(path.sep).join('/'));

      const docPath = relativeDoc(relative);
      if (docPath) return fire(docPath);

      // Not a document, so it may be a folder — a new one to watch under the
      // fallback, or a rename that reparented documents under it.
      if (recursiveSupported) return;
      fs.stat(full, (err, info) => {
        if (!err && info.isDirectory()) walk(full);
      });
    });
  }

  function walk(dir) {
    if (closed) return;
    watchDir(dir);
    if (recursiveSupported) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name));
    }
  }

  walk(root);
  started = true;
  index?.watching(true);

  return {
    get watching() {
      return watchers.size;
    },
    recursive: recursiveSupported,
    close() {
      closed = true;
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
      inodes.clear();
      index?.watching(false);
    },
  };
}
