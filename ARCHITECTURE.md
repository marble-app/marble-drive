# Architecture

Two packages, one line between them, and the line is a file you can read.

```
   ┌─────────────────────────────────────────────────────────────┐
   │  the browser                                                │
   │                                                             │
   │   drive.mrbl ── a document that happens to list documents   │
   │        │                                                    │
   │   window.marble          ← the carrier (Marble's)           │
   │   window.marble.drive    ← the Drive's extension to it      │
   └────────┬────────────────────────────────────────────────────┘
            │  HTTP + one event stream per document,
            │  and one for the drive
   ┌────────┴────────────────────────────────────────────────────┐
   │  server/app.js — routes, and nothing else                   │
   │                                                             │
   │  ┌──────────┬─────────┬──────────┬─────────┬─────────────┐  │
   │  │  store   │ oplog   │ channels │  gate   │  watcher    │  │
   │  └────┬─────┴─────────┴──────────┴─────────┴─────────────┘  │
   │       │                                                     │
   │  ┌────┴──────────────────────────────────────────────────┐  │
   │  │  server/engine.js — the only import of @bdhmin/marble │  │
   │  └───────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────┘
                              │
                     the drive root on disk
                     documents, and one .marble/
```

## What is borrowed and what is here

Marble is the format and the machinery. It knows how to splice a byte range
addressed by a node id, how to refuse a batch of ops that would destroy
addressed content nobody asked to remove, how to keep a content-addressed
gzipped restore point, how to run the carrier in a page, and how to turn a
gesture into ops with a model. None of that is Drive work.

`server/engine.js` is the one module that imports any of it. Everything else in
this repo imports from there, so the boundary is a file rather than a habit —
and when the Marble package grows subpath exports for these, that file is the
only one that changes.

What is here is everything to do with there being more than one folder:

| | |
|---|---|
| `server/paths.js` | the path grammar. A name is a path now, `..` is refused twice, and a name from another filesystem is flattened into one this accepts |
| `server/store/` | the seam: read, write, list, tree, move, trash, history, blobs |
| `server/watch.js` | a recursive watcher, with a walk for the platforms that have no recursive flag |
| `server/oplog.js` | the op log, with `client` and `seq` alongside `t` |
| `server/gate.js` | one shared secret and a signed cookie. Thrown away at G2 |
| `server/sse.js` | two channels: this document moved, and the folder did |
| `server/gallery.js` | starters, composed from Marble's affordance parts |
| `server/favicon.js` | the mark: one marble, bare for a document and tiled for the Drive, inline in the head of both |
| `server/flatten.js` | blobs out of a document, and blobs back into it |
| `server/backup.js` | the documents *and* the history, off the box |
| `lib/affordances.drive.js` | one affordance overridden by name: a sortable a finger can use |
| `runtime/drive.js` | `marble.drive` — the carrier surface a Drive needs |
| `templates/drive.mrbl` | the Drive, as a document |
| `starters/` | seven answers to "what is a document", two of which typeset. A starter is one `.mrbl` file, or a folder of parts that are concatenated — which is how the two that typeset share one typesetter rather than carrying two copies of it |

## The rules the host keeps

**Nothing above the store names the filesystem.** Every route reads and writes
through `store`. The three functions prefixed `_fs` exist because `fs.watch`
takes a real directory, and they are named so that reaching past the seam is
obvious at the call site.

**The host ships no interface.** The only HTML it serves that is not a document
is the gate form, and that is one `<form>`, because a door has to be openable
before there is a document to open. Everything else you see is `drive.mrbl`. The
one other thing it answers that nothing asked it for is `/favicon.svg`, and that
is a drawing rather than an interface: it exists for the documents that were in
a drive before the mark was, because a document made here carries the mark in
its own head and never asks.

**The host injects no affordance.** It injects the carrier and the Drive's
extension to it, both marked transient. A document carries its own behaviour, so
two hosts render the same file identically. The mark is not injected either — it
is spliced into the document at build time, which is why a downloaded `.mrbl`
opened from a file:// URL still has an icon in the tab.

**The write path announces; the watcher does not repeat it.** An op is applied,
a snapshot is taken of what it replaced, and every client except the one that
filed it is told — synchronously, by the route. The watcher exists for the other
writer: a text editor, an agent, a `git checkout`. Marble's own host broadcasts
from the watcher instead, because its write path does not; doing both is how
every other tab hears one edit twice.

**Writes are serialized per document.** One queue per path, so two ops batches
against one file cannot interleave.

## The shape of a request

```
POST /ops?app=work/q3/notes&client=a3f1
  → parsePath                      refuse anything that is not a path
  → gate.allows                    refuse anything without a cookie, if closed
  → enqueue(docPath)               one writer per document at a time
      → store.read
      → guardOps                   refuse the batch if it would destroy something
      → store.write                snapshot what is being replaced, then rename into place
      → oplog.append               {t, doc, client, seq, …op}
  → channels.toDocument(except: client)
  → channels.toDrive(except: client)
```

Every other write in the system — a restore, a flatten, a document created from
a starter — goes through `putDocument`, which is the same thing without the ops.

## Where this repo disagrees with nothing

The vision document splits the plan into five generations and pulls two
decisions early: the op log's ordering fields at G0, and the storage seam as
named work rather than an implied refactor. Both are done here, and both are
done for the reason it gives — they are free now and a migration later.

What is deliberately *not* here is anything from G2 onward: no wildcard origin,
no accounts, no capability URLs, no per-document storage. The gate is a
placeholder that says so in its own header comment.
