# Marble Drive

Google Drive, but every file in it is the app.

A drive of `.mrbl` documents, in folders, served by a host that runs each one as
a page rather than previewing it. Change something on screen and the file in the
drive is rewritten — no save, no build, no deploy — and every other browser on
that document follows.

This is the MVP of the ecosystem plan in
[`ecosystem-vision.mrbl`](../marble/apps/ecosystem-vision.mrbl): **G0, hosted for
one**, and **G1, the Drive**. The format, the patcher, the carrier and the intent
layer come from the [`@bdhmin/marble`](https://github.com/bdhmin/marble) package.
Everything that has to do with there being more than one folder is here.

```
npm install
npm run dev            # http://localhost:4400
```

The first run writes one document into the drive: the Drive itself.

## What you can do with it

- **Folders.** Nested paths, drag a document onto a folder to move it, breadcrumbs.
- **New.** Five starters — document, sheet, slides, board, canvas. "New sheet" is
  a clone, and the clone is yours to reshape.
- **Everything is live.** Two tabs on one document stay in step. So does an edit
  made in a text editor, or by an agent — the page patches rather than reloads,
  and your caret and scroll position survive it.
- **Every write has a way back.** A gzipped snapshot precedes every change,
  including changes made from outside the host.
- **Pin, rename, copy, download, trash.** A download is one self-contained file,
  blobs and all, that opens with no host at all.

## The part that is not Drive

The Drive is a document. `drive.mrbl` is an ordinary file *in* the drive that
asks the host what exists and writes what it thinks of the answer into its own
markup. So the sidebar labels, the column headings, the name of the drive and
the pinned list are all content: type over them and you have changed the app.

Open it in a text editor and you will find the sidebar in it.

## Commands

```
marble-drive serve              serve the drive
marble-drive new <path>         a document from a starter, without a browser
marble-drive weigh [path]       what the documents weigh, and how much is base64
marble-drive backup             one backup, now
marble-drive starters           what you can make
```

## Running it somewhere

```
cp .env.example .env            # put a real secret in it
docker compose up -d
```

The image holds the host; the drive is a volume. See [docs/DEPLOY.md](docs/DEPLOY.md).

## Reading it

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | the layers, and where the line with Marble is |
| [docs/STORE.md](docs/STORE.md) | the seam every later generation hangs off |
| [docs/PATHS.md](docs/PATHS.md) | the path grammar, and what it refuses |
| [docs/CARRIER-DRIVE.md](docs/CARRIER-DRIVE.md) | `marble.drive`, proposed for the carrier surface |
| [docs/DRIVE-DOC.md](docs/DRIVE-DOC.md) | how a Drive can be a document without lying |
| [docs/GALLERY.md](docs/GALLERY.md) | starters, and why there are no upgrades |
| [docs/OPLOG.md](docs/OPLOG.md) | the two fields that are free now and a migration later |
| [docs/BLOBS.md](docs/BLOBS.md) | where "one file, one app" strains, and the way back |
| [docs/DEPLOY.md](docs/DEPLOY.md) | the container, the gate, the backups |
| [docs/ROADMAP.md](docs/ROADMAP.md) | this repo against the five generations |
| [TODO.md](TODO.md) | the list this was built from |

## Tests

```
npm test
```

74 of them. They cover the path grammar, the store, the watcher, the op log, the
gate, the backups, the gallery, the blob round trip, and the loop end to end over
HTTP — including that the client which filed an edit is never told about it, and
that every document this repo can produce passes Marble's own doctor.
