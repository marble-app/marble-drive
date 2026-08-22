// The store, backed by a directory.
//
// This is the implementation the seam exists to make replaceable. Everything in
// it is filesystem arithmetic; nothing above it knows that a document is a file
// or that a folder is a directory, which is the whole point — G2 wants a store
// per account and G4 wants one that syncs, and both should be a sibling of this
// file rather than a rewrite of the routes.
//
// Layout under the drive root:
//
//   <root>/…/<name>.mrbl        the documents. Folders are folders.
//   <root>/.marble/             the one bookkeeping tree (history, ops, blobs)
//   <root>/.marble/trash/       what was deleted, and the journal that says
//                               where each piece came from
//
// A document's identity is its path without the extension. `work/q3/notes` is
// the name in every API, in every log line, and in the URL.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  bytesOf,
  checkpoint,
  listCheckpoints,
  prune,
  readCheckpoint,
  shaOf,
  writeAtomic,
} from '../engine.js';
import {
  DOC_EXT,
  PathError,
  docKey,
  joinPath,
  parsePath,
  resolveUnder,
  splitPath,
  titleize,
} from '../paths.js';
import { createBlobs } from './blobs.js';

const HIDDEN = /^\./;

const titleOf = (source, fallback) =>
  source.match(/<title>([^<]*)<\/title>/i)?.[1].trim() || fallback;

// What a .mrbl document is worth measuring in — how much of it a hand or a model
// can address. Kept identical to Marble's own count so two hosts agree.
const nodesOf = (source) => (source.match(/data-marble-id="/g) ?? []).length;

export function createFsStore({ root }) {
  const abs = (docPath) => resolveUnder(root, docPath);
  const fileOf = (docPath) => `${abs(docPath)}${DOC_EXT}`;
  const marbleDir = path.join(root, '.marble');
  const trashDir = path.join(marbleDir, 'trash');
  const trashLog = path.join(marbleDir, 'trash.jsonl');

  const blobs = createBlobs({ dir: path.join(marbleDir, 'blobs') });

  const exists = (file) =>
    fsp
      .access(file)
      .then(() => true)
      .catch(() => false);

  // ------------------------------------------------------------------ reading

  async function read(docPath) {
    return fsp.readFile(fileOf(parsePath(docPath, { allowRoot: false })), 'utf8').catch(() => null);
  }

  async function has(docPath) {
    return exists(fileOf(parsePath(docPath, { allowRoot: false })));
  }

  async function hasFolder(folderPath) {
    const at = abs(parsePath(folderPath));
    return fsp
      .stat(at)
      .then((s) => s.isDirectory())
      .catch(() => false);
  }

  async function stat(docPath) {
    const clean = parsePath(docPath, { allowRoot: false });
    const file = fileOf(clean);
    const [info, source] = await Promise.all([
      fsp.stat(file).catch(() => null),
      fsp.readFile(file, 'utf8').catch(() => null),
    ]);
    if (!info || source === null) return null;
    const { parent, name } = splitPath(clean);
    return {
      kind: 'doc',
      path: clean,
      name,
      folder: parent,
      title: titleOf(source, titleize(name)),
      nodes: nodesOf(source),
      bytes: info.size,
      modified: info.mtimeMs,
      created: info.birthtimeMs || info.ctimeMs,
    };
  }

  /**
   * Every document and every folder under `folder`, newest first. Flat by
   * design: the tree is composed from this rather than walked twice, so there
   * is one traversal and one place that decides what is hidden.
   */
  async function list({ folder = '', recursive = true } = {}) {
    const base = parsePath(folder);
    const out = [];

    async function walk(relative) {
      const here = abs(relative);
      const entries = await fsp.readdir(here, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (HIDDEN.test(entry.name)) continue;
        const child = joinPath(relative, entry.name);
        if (entry.isDirectory()) {
          const info = await fsp.stat(path.join(here, entry.name)).catch(() => null);
          out.push({
            kind: 'folder',
            path: child,
            name: entry.name,
            folder: relative,
            title: titleize(entry.name),
            modified: info?.mtimeMs ?? 0,
          });
          if (recursive) await walk(child);
          continue;
        }
        if (!entry.name.endsWith(DOC_EXT)) continue;
        const docPath = child.slice(0, -DOC_EXT.length);
        // A name the grammar refuses is a file somebody put there by hand. It
        // is not addressable, so it is not listed — but it is not deleted or
        // complained about either, because it is their folder.
        try {
          parsePath(docPath, { allowRoot: false });
        } catch {
          continue;
        }
        const info = await stat(docPath);
        if (info) out.push(info);
      }
    }

    await walk(base);
    return out.sort((a, b) => b.modified - a.modified);
  }

  /** The same entries, nested. Folders carry `children`; documents are leaves. */
  async function tree({ folder = '' } = {}) {
    const base = parsePath(folder);
    const flat = await list({ folder: base, recursive: true });

    const folders = new Map();
    folders.set(base, { kind: 'folder', path: base, name: splitPath(base).name, folder: splitPath(base).parent, title: base === '' ? 'My Drive' : titleize(splitPath(base).name), children: [] });

    for (const entry of flat) {
      if (entry.kind !== 'folder') continue;
      folders.set(entry.path, { ...entry, children: [] });
    }
    for (const entry of flat) {
      const parent = folders.get(entry.folder) ?? folders.get(base);
      parent.children.push(entry.kind === 'folder' ? folders.get(entry.path) : entry);
    }
    // Folders before documents, each newest first — the order a Drive shows.
    const order = (node) => {
      node.children.sort((a, b) =>
        a.kind === b.kind ? b.modified - a.modified : a.kind === 'folder' ? -1 : 1,
      );
      for (const child of node.children) if (child.kind === 'folder') order(child);
    };
    const rootNode = folders.get(base);
    order(rootNode);
    return rootNode;
  }

  // ------------------------------------------------------------------ writing

  /**
   * The write every other write goes through. A restore point is taken of what
   * is being replaced *before* the bytes move, and the write itself is atomic —
   * a crash in the middle leaves the old file, never half of a new one.
   */
  async function write(docPath, source, { label = 'ops', ops = [] } = {}) {
    const clean = parsePath(docPath, { allowRoot: false });
    const file = fileOf(clean);
    await fsp.mkdir(path.dirname(file), { recursive: true });

    const prior = await fsp.readFile(file, 'utf8').catch(() => null);
    if (prior !== null) {
      // A failure here must cost the restore point, never the edit.
      await checkpoint(docKey(clean), prior, { label, ops }).catch(() => {});
    }
    await writeAtomic(file, source);
    return { path: clean, bytes: bytesOf(source), sha: shaOf(source) };
  }

  /** A restore point for a state nobody is replacing — opening, or first sight. */
  async function mark(docPath, source, label) {
    return checkpoint(docKey(parsePath(docPath, { allowRoot: false })), source, { label }).catch(
      () => null,
    );
  }

  async function create(docPath, source) {
    const clean = parsePath(docPath, { allowRoot: false });
    if (await has(clean)) throw new PathError(`"${clean}" already exists`);
    return write(clean, source, { label: 'created' });
  }

  async function mkdir(folderPath) {
    const clean = parsePath(folderPath, { allowRoot: false });
    if (await has(clean)) throw new PathError(`"${clean}" is a document, not a folder`);
    await fsp.mkdir(abs(clean), { recursive: true });
    return { path: clean };
  }

  /**
   * Move or rename, for a document or a folder — one operation, because on a
   * filesystem they are one operation and pretending otherwise would give the
   * Drive two code paths that can disagree.
   *
   * The history follows the document. It is keyed by path, so a move that left
   * the snapshots behind would be a rename that quietly costs you your undo.
   */
  async function move(fromPath, toPath) {
    const from = parsePath(fromPath, { allowRoot: false });
    const to = parsePath(toPath, { allowRoot: false });
    if (from === to) return { from, to, moved: false };
    if (to.startsWith(`${from}/`)) throw new PathError('a folder cannot be moved inside itself');

    const isDoc = await has(from);
    const isFolder = !isDoc && (await hasFolder(from));
    if (!isDoc && !isFolder) throw new PathError(`nothing at "${from}"`);
    if ((await has(to)) || (await hasFolder(to))) throw new PathError(`"${to}" already exists`);

    const source = isDoc ? fileOf(from) : abs(from);
    const target = isDoc ? fileOf(to) : abs(to);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(source, target);

    if (isDoc) await renameHistory(from, to);
    else {
      // Every document under the folder moved with it.
      for (const entry of await list({ folder: to, recursive: true })) {
        if (entry.kind !== 'doc') continue;
        const was = joinPath(from, entry.path.slice(to.length + 1));
        await renameHistory(was, entry.path);
      }
    }
    return { from, to, moved: true, kind: isDoc ? 'doc' : 'folder' };
  }

  // The history of a document is an index file and a directory of blobs, both
  // named after it. Renaming them is the whole of "history follows the file".
  async function renameHistory(from, to) {
    const pairs = [
      [`${docKey(from)}.history.jsonl`, `${docKey(to)}.history.jsonl`],
      [`${docKey(from)}.ops.jsonl`, `${docKey(to)}.ops.jsonl`],
      [`${docKey(from)}.intents.jsonl`, `${docKey(to)}.intents.jsonl`],
      [path.join('history', docKey(from)), path.join('history', docKey(to))],
    ];
    for (const [was, now] of pairs) {
      const source = path.join(marbleDir, was);
      if (!(await exists(source))) continue;
      const target = path.join(marbleDir, now);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.rename(source, target).catch(() => {});
    }
  }

  // -------------------------------------------------------------------- trash

  /**
   * Deleting moves the bytes somewhere they are still readable and writes down
   * where they came from. A Drive whose delete is `rm` is a Drive you cannot
   * hand to anybody, and the history tree is no help for a file that is gone —
   * it is keyed by a path that no longer resolves.
   */
  async function trash(docPath) {
    const clean = parsePath(docPath, { allowRoot: false });
    const isDoc = await has(clean);
    const isFolder = !isDoc && (await hasFolder(clean));
    if (!isDoc && !isFolder) throw new PathError(`nothing at "${clean}"`);

    const id = `${Date.now().toString(36)}-${shaOf(clean).slice(0, 8)}`;
    await fsp.mkdir(trashDir, { recursive: true });
    const target = path.join(trashDir, isDoc ? `${id}${DOC_EXT}` : id);
    await fsp.rename(isDoc ? fileOf(clean) : abs(clean), target);

    const entry = { id, t: Date.now(), path: clean, kind: isDoc ? 'doc' : 'folder' };
    await fsp.appendFile(trashLog, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  async function listTrash() {
    const log = await fsp.readFile(trashLog, 'utf8').catch(() => '');
    const entries = new Map();
    for (const line of log.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        // Later lines win: a restore appends `{id, restored:true}` rather than
        // rewriting the log, so the journal stays append-only.
        if (entry.restored) entries.delete(entry.id);
        else entries.set(entry.id, entry);
      } catch {
        // A truncated last line is what an interrupted append looks like.
      }
    }
    return [...entries.values()].reverse();
  }

  async function untrash(id, { to = null } = {}) {
    const entry = (await listTrash()).find((item) => item.id === id);
    if (!entry) throw new PathError(`nothing in the trash with id "${id}"`);

    let target = parsePath(to ?? entry.path, { allowRoot: false });
    // Something else may have taken the name in the meantime. Restoring beside
    // it beats refusing, and beats overwriting by a very long way.
    if ((await has(target)) || (await hasFolder(target))) {
      const { parent, name } = splitPath(target);
      target = joinPath(parent, `${name} restored ${new Date(entry.t).toISOString().slice(0, 10)}`);
    }

    const source = path.join(trashDir, entry.kind === 'doc' ? `${entry.id}${DOC_EXT}` : entry.id);
    const destination = entry.kind === 'doc' ? fileOf(target) : abs(target);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.rename(source, destination);
    await fsp.appendFile(trashLog, `${JSON.stringify({ id: entry.id, restored: true, t: Date.now() })}\n`);
    return { ...entry, path: target };
  }

  // ------------------------------------------------------------------ history

  const history = (docPath) => listCheckpoints(docKey(parsePath(docPath, { allowRoot: false })));

  const snapshot = (docPath, sha) =>
    readCheckpoint(docKey(parsePath(docPath, { allowRoot: false })), sha);

  const thinHistory = (docPath) => prune(docKey(parsePath(docPath, { allowRoot: false })));

  // ------------------------------------------------------------------- bounds

  async function ready() {
    await fsp.mkdir(root, { recursive: true });
    await fsp.mkdir(marbleDir, { recursive: true });
    await fsp.mkdir(trashDir, { recursive: true });
    await blobs.ready();
  }

  return {
    kind: 'fs',
    root,
    marbleDir,
    blobs,
    ready,
    read,
    has,
    hasFolder,
    stat,
    list,
    tree,
    write,
    mark,
    create,
    mkdir,
    move,
    trash,
    listTrash,
    untrash,
    history,
    snapshot,
    thinHistory,
    // The escape hatch, named so it is obvious at a call site that something is
    // reaching past the seam. Only the watcher uses it, because `fs.watch`
    // takes a real directory and there is no honest way around that.
    _fsPath: (docPath = '') => abs(parsePath(docPath)),
    _fsFile: (docPath) => fileOf(parsePath(docPath, { allowRoot: false })),
    _fsWatchRoot: () => {
      fs.mkdirSync(root, { recursive: true });
      return root;
    },
  };
}
