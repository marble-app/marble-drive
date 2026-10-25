// The drive as one zip its person can take away: GET /drive/export.zip
// (server/app.js), which the door's account page links as Download my drive.
//
// Everything they put in it, in the folders they put it in, under one folder
// named for the drive, the way zipping a folder by hand gives it. Every
// document is flattened, its pictures and recordings put back inside it as
// /drive/download gives one, so each opens on its own; every other file is
// as it is. None of `.marble/` (history, chats, logs, blobs, trash) and
// nothing else whose name starts with a dot: the host's bookkeeping, a
// half-made upload or a repository's insides, none of which the Drive shows.
//
// A link is never followed, whoever made it, so a link to the drive's home
// cannot put the agent's login in the zip; pipes, sockets and devices are
// passed over. It is a courtesy, not a wall: an agent can read the home
// anyway. Streamed: nothing is held whole but one document's own text.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { refreshed } from './favicon.js';
import { blobsIn, flattenChunks } from './flatten.js';
import { DOC_EXT } from './paths.js';

// Marble's own paths are at most 16 folders deep (server/paths.js). A tree an
// agent made deeper than this is left out rather than walked, as the backups
// leave it (linux/pc-host/backup-tree).
const MAX_DEPTH = 64;
// O_NONBLOCK: a pipe put where a file was, between the listing and the open,
// must not hold the export until something writes to it.
const READ = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
// A document is read whole to be flattened. One bigger than this is all
// inline pictures already, and more than a string can hold, so it goes in as
// the bytes on disk.
const DOC_WHOLE_MAX = 256 * 1024 * 1024;
// What is worth compressing: documents and text. A picture, a PDF or a
// recording is compressed already, and goes in as it is (deflate's level 0,
// server/zip-write.js says why).
const TEXT = new Set([
  'mrbl', 'html', 'htm', 'txt', 'md', 'json', 'jsonl', 'csv', 'tsv', 'bib', 'tex', 'yml', 'yaml',
  'toml', 'ini', 'js', 'mjs', 'cjs', 'ts', 'py', 'r', 'sql', 'sh', 'css', 'log', 'svg', 'xml', 'ipynb',
]);

const extOf = (name) => {
  const at = name.lastIndexOf('.');
  return at < 1 ? '' : name.slice(at + 1).toLowerCase();
};

/** A name worth putting in a zip: not hidden, and nothing an unzip could read
 *  as a second folder (a backslash) or that would not survive as a name. */
const usable = (name) => !name.startsWith('.') && !/[\\\u0000-\u001f\u007f]/.test(name);

/** What the zip, and the folder inside it, are called: the drive's name at
 *  the door, else its folder's. Kept to what a file name can be anywhere. */
export function exportName({ doorName = null, root }) {
  const raw = String(doorName || path.basename(path.resolve(root)) || 'drive');
  const clean = raw.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '');
  return clean || 'drive';
}

/** Content-Disposition for a download called `file`: a plain-ASCII name for
 *  the browsers that read only that, and the UTF-8 one (RFC 6266) beside it. */
export function attachment(file) {
  const ascii = file.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  const utf8 = encodeURIComponent(file).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** Opened without following a link, and only if it is a regular file. */
async function openFile(file) {
  const handle = await fsp.open(file, READ).catch(() => null);
  if (!handle) return null;
  const info = await handle.stat().catch(() => null);
  if (!info?.isFile()) {
    await handle.close().catch(() => {});
    return null;
  }
  return { handle, info };
}

/** At most how many bytes a document comes to once flattened, so the zip
 *  knows before its header whether the entry may pass 4 GB. */
async function flatSize(source, blobs) {
  let size = Buffer.byteLength(source);
  for (const { hash, type } of blobsIn(source)) {
    const blob = await blobs.open(hash);
    if (blob) size += 32 + String(blob.type || type).length + 4 * Math.ceil(blob.bytes / 3);
  }
  return size;
}

/**
 * The zip's entries for server/zip-write.js, folders first and each folder's
 * entries in name order. A file is opened before its entry is handed over and
 * closed when the next is asked for, so one the zip stops reading part-way is
 * closed too.
 */
export async function* exportEntries({ root, blobs, top }) {
  const base = path.resolve(root);
  const info = await fsp.lstat(base);
  if (!info.isDirectory()) throw new Error(`${base} is not a folder`);
  yield { name: `${top}/`, folder: true, modified: info.mtimeMs };

  async function* walk(dir, rel, depth) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (!usable(entry.name)) continue;
      const here = path.join(dir, entry.name);
      const inside = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH) continue;
        const folder = await fsp.lstat(here).catch(() => null);
        if (!folder?.isDirectory()) continue;
        yield { name: `${top}/${inside}/`, folder: true, modified: folder.mtimeMs };
        yield* walk(here, inside, depth + 1);
        continue;
      }
      // A link, a pipe, a socket or a device is never part of an export.
      if (!entry.isFile()) continue;
      const opened = await openFile(here);
      if (!opened) continue;
      const { handle, info: file } = opened;
      try {
        if (entry.name.endsWith(DOC_EXT) && file.size <= DOC_WHOLE_MAX) {
          const source = refreshed(await handle.readFile('utf8'));
          await handle.close();
          yield blobsIn(source).length
            ? { name: `${top}/${inside}`, modified: file.mtimeMs, deflate: true, size: await flatSize(source, blobs), chunks: () => flattenChunks(source, blobs) }
            : { name: `${top}/${inside}`, modified: file.mtimeMs, deflate: true, data: source };
          continue;
        }
        const deflate = TEXT.has(extOf(entry.name));
        // Up to the size it had when it was opened: a file that grows while it
        // is read is taken as it was, and one that shrinks ends where it ends.
        yield file.size === 0
          ? { name: `${top}/${inside}`, modified: file.mtimeMs, data: Buffer.alloc(0) }
          : { name: `${top}/${inside}`, modified: file.mtimeMs, deflate, size: file.size, chunks: () => handle.createReadStream({ start: 0, end: file.size - 1, autoClose: false }) };
      } finally {
        await handle.close().catch(() => {});
      }
    }
  }

  yield* walk(base, '', 0);
}
