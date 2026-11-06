# The store

> `server/paths.js` is fifty lines and every route reaches through it to the
> filesystem directly. Turn it into a store — read, write, list, stat, history —
> and every generation after this one is a new implementation rather than a
> rewrite. Highest leverage change in the plan.
>
> — the `k-seam` card

## The contract

Every path is a Drive path: segments joined by slashes, no extension, `''` for
the root. Every method that takes one validates it through
[`server/paths.js`](../server/paths.js) before it touches anything.

```
ready()                              make whatever the store needs to exist
read(path)              → string|null
readRaw(path)           → {path,name,ext,bytes,open()}|null   a file, not a document
has(path)               → boolean         a document is there
hasFolder(path)         → boolean         a folder is there
hasFile(path)           → boolean         something that is neither is there
stat(path)              → entry|null
list({folder,recursive,files}) → entry[]  flat, newest first, folders included
tree({folder,files})    → folder node with `children`, files included unless `files` is false
treeSince({folder,files,since}) → {v, tree} | {v, patch} | {v, same: true}
write(path, source, {label, ops}) → {path, bytes, sha}
mark(path, source, label)                 a restore point for a state nobody replaced
create(path, source)                      refuses to overwrite
mkdir(path)
move(from, to)                            all three kinds; history follows a document
trash(path)             → {id, path, kind}
listTrash()             → entry[]
untrash(id, {to})
history(path)           → checkpoint[]    newest first
snapshot(path, sha)     → string|null
thinHistory(path)
blobs                   → {put, get, head}
```

An `entry` is what a Drive shows:

```json
{ "kind": "doc", "path": "work/q3/notes", "name": "notes", "folder": "work/q3",
  "title": "Field journal", "nodes": 41, "bytes": 19717, "modified": 1787407475468 }
```

`kind: "folder"` entries carry `path`, `name`, `folder`, `title`, `modified` —
and `children` when they come from `tree()`.

## A listing that is kept

A Drive asks for the tree on every folder it opens and again after every change
anywhere in the drive, from every tab. Walking the disk each time stopped
scaling once a drive held experiment output: on the owner's PC (2026-11-05) the
tree was 40,000 entries, a walk took 2.2 s and 3.3 s of CPU, and a folder click
waited 2.6 s for it.

So while a watcher runs (`server/watch.js`), `list()` and `tree()` answer from
a listing kept in memory ([`server/store/live-index.js`](../server/store/live-index.js)).
Each folder is read once. After that the watcher says which names changed (any
writer: an agent's editor, a `git checkout`, Finder), and the store says so
for its own writes before the route that made them tells anybody, so the next
listing reads only those names. A folder the watcher lost is read on every
listing, and once a minute each folder's change time is checked against the one
it was read at, which catches what nobody reported. With no watcher (a command
line tool, a test) the store walks the disk as it always did.

Every change to what a folder lists is numbered. `treeSince({since})` takes the
`v` an earlier answer carried and answers `{same: true}`, or a `patch`: each
folder whose listing changed, with all it now lists, parents first, its own
folders without their children. Another run of the host, or a patch of more
than 2,000 folders, is answered with the whole `tree`. `GET /drive/tree` takes
the same `since`; without it the answer is the tree, as before.
`runtime/drive.js` keeps each tab's last tree and asks with `since`, so a
refresh while agents work is a few hundred bytes. It still hands each caller
its own copy, because pages write onto what they are given.

## The third kind

A folder holds the work and it also holds what the work needed: the
bibliography beside the paper, the cover images, the JSON a script reads.
Those are `kind: "file"`.

```json
{ "kind": "file", "path": "paper/refs.bib", "name": "refs.bib",
  "folder": "paper", "title": "refs.bib", "ext": "bib",
  "bytes": 4210, "modified": 1787407475468 }
```

Two things about them are deliberate.

**The path keeps the extension.** A document's path drops `.mrbl` because every
document has it, so it carries no information; `paper/refs.bib` and
`paper/refs.json` are two different files and the extension *is* the address.

**`list()` leaves them out unless asked.** Every caller that says "documents"
means documents — `/docs` is the carrier's surface and it would be wrong to
answer it with a `.bib`. `tree()` passes `files: true`, because a tree is what a
Drive draws a folder from, and a folder that holds a file and says nothing about
it is a folder that loses it.

`move()` and `trash()` take all three kinds. `readRaw()` hands back an `open()`
rather than the bytes, because a drive is allowed to hold a 400 MB video and a
store that buffers one to answer a GET is a store that falls over on the file it
was asked for. It refuses a `.mrbl`: a document is served as the app it is, and
a second way to reach its source would be a second answer to what opening it
means.

## What the filesystem implementation does with it

```
<root>/…/<name>.mrbl        the documents. Folders are folders.
<root>/.marble/             the one bookkeeping tree
<root>/.marble/history/     gzipped snapshots, content-addressed
<root>/.marble/trash/       what was deleted, and the journal saying where from
<root>/.marble/blobs/       bytes that are not structure
```

Three things are worth knowing about it.

**One history tree.** The Marble checkout this grew out of had two — `./.marble/`
and `apps/.marble/` — depending on whether the host was started by `npm run dev`
or by the command, and picking one late means moving snapshots. Here the drive
root decides, once, in `server/config.js`, which also points Marble's history
module at it.

**History is keyed by path, and a move renames it.** The index for
`work/q3/notes` is `.marble/work%2Fq3%2Fnotes.history.jsonl` — flat, because
Marble's history writes its index into one directory and a key with a slash in
it would be a write into a folder nobody made. `%2F` is reversible and is
already what a URL would have called it. `move()` renames the index, the op log,
the intent log and the blob directory together, so a rename never quietly costs
you your undo.

**Deleting is recoverable.** `trash()` moves the bytes into `.marble/trash/` and
appends a line saying where they came from. Restoring appends `{id, restored:
true}` rather than rewriting the journal, so the journal stays append-only. If
something else has taken the name in the meantime, the restore lands beside it
with the date attached rather than overwriting.

## What it costs

A file stays a file, and storage moves behind a seam rather than into a
database. The cost, named in the vision and repeated here so nobody has to
rediscover it: **no queries across documents.** The index is something a folder
listing can answer, and anything that wants to ask "every document mentioning
X" has to read them all. `list({recursive: true})` is one traversal and it stats
every document in the drive; at a few thousand documents that is fine and at a
hundred thousand it is not.

That is the point at which a second implementation of this interface earns its
keep — and the reason the interface exists before it is needed.

## Adding one

```js
export function createSomethingStore({ … }) {
  return { kind: 'something', root, marbleDir, blobs, ready, read, has, … };
}
```

`createStore({ kind })` in [`server/store/index.js`](../server/store/index.js)
picks it. Nothing else in the repo changes, with one honest exception: the
watcher takes a real directory, so a store that is not a directory has to offer
some other way to hear about a change made behind the host's back — or accept
that there is no such way, which for a network store is often the truth.
