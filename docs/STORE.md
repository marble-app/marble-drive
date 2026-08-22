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
has(path)               → boolean         a document is there
hasFolder(path)         → boolean         a folder is there
stat(path)              → entry|null
list({folder,recursive})→ entry[]         flat, newest first, folders included
tree({folder})          → folder node with `children`
write(path, source, {label, ops}) → {path, bytes, sha}
mark(path, source, label)                 a restore point for a state nobody replaced
create(path, source)                      refuses to overwrite
mkdir(path)
move(from, to)                            documents and folders; history follows
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
