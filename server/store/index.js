// The seam.
//
// This is the fifty-line change the vision calls the highest-leverage one in the
// plan, and it is a seam rather than a refactor because of what it makes cheap
// later: a store per account at G2, a store that syncs at G4, a store over
// object storage the first time somebody's drive outgrows a disk. Each of those
// is a sibling of `fs-store.js`. None of them is a change to a route.
//
// The contract, in full. Every path is a Drive path — segments joined by
// slashes, no extension, `''` for the root — and every method that takes one
// validates it through `../paths.js`.
//
//   ready()                          make whatever the store needs to exist
//   read(path)          → string|null
//   has(path)           → boolean          a document is there
//   hasFolder(path)     → boolean          a folder is there
//   stat(path)          → entry|null       {kind,path,name,folder,title,nodes,bytes,modified}
//   list({folder,recursive}) → entry[]     flat, newest first, folders included
//   tree({folder})      → folder node with `children`
//   write(path, source, {label, ops}) → {path, bytes, sha}
//   mark(path, source, label)              a restore point for a state nobody replaced
//   create(path, source)                   refuses to overwrite
//   mkdir(path)
//   move(from, to)                         documents and folders, history follows
//   trash(path)         → {id, path, kind} recoverable
//   listTrash()         → entry[]
//   untrash(id, {to})
//   history(path)       → checkpoint[]     newest first
//   snapshot(path, sha) → string|null
//   thinHistory(path)
//   blobs               → {put, get, head}
//
// Anything prefixed `_fs` is not part of the contract. It exists because
// `fs.watch` needs a real directory, and a store that cannot be watched would
// have to be polled.

import { createFsStore } from './fs-store.js';

export function createStore({ root, kind = 'fs' }) {
  if (kind !== 'fs') throw new Error(`no store named "${kind}" — there is: fs`);
  return createFsStore({ root });
}

export { createFsStore };
