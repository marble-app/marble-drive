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
- **Drag documents in.** Drop a `.mrbl` anywhere on the page and it lands in the
  folder you are looking at; drop it on a folder and it lands in that one. A
  whole folder from the desktop comes in with its shape intact. A name the path
  grammar would refuse is flattened rather than turned away, and what is not a
  document is left where it was.
- **New.** Seven starters — document, sheet, slides, board, canvas, ACM paper,
  LaTeX. "New sheet" is a clone, and the clone is yours to reshape.
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
marble-drive icon [path]        the mark, for a document that predates it
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

On a Mac you keep the drive on, run it under launchd instead of in a terminal
window — it has no terminal to be hung up on when an ssh session ends, comes
back on its own if it ever stops, and starts again at login:

```
macos/launchd/daemon.sh install     # or: npm run daemon -- install
macos/launchd/daemon.sh status
macos/launchd/daemon.sh logs        # ~/Library/Logs/marble-drive/serve.log
```

`server/` changes still need a restart: `macos/launchd/daemon.sh restart`.

## What is in the repository, and what is not

The repository is the host: the code that serves a drive, the templates and
starters it seeds one from, the tests, and the tools in `tools/` that keep it
honest. Cloning it gives you an empty drive and everything needed to fill one.

What it does not carry, on purpose:

- **Your drive.** `drive/` is gitignored. A change to a document is saved the
  moment it is made — that is what the drive is for — and `.marble/` under it is
  the history. There is nothing to commit after editing a document.
- **Your skills and settings.** A skill you make, or have an agent make, lives
  in your drive at `drive/.claude/skills/`, and the drive's own choices (which
  folders wear a colour, which document `/today` opens) in
  `drive/.marble/drive.json`. The app's own agent skills ship in
  `agent-plugin/` and reach every agent turn wherever the drive is.
- **This machine.** `.env`, `.claude/settings.local.json`, `.codex/`, `.sprite`,
  `test-results/`, worktrees.

Agents working in your drive cannot reach this repository's git: their turns
run with `GIT_CEILING_DIRECTORIES` at the drive's parent, so nothing done in the
drive becomes a commit here.
- **What a session leaves behind.** `scratchpad/` and `.superpowers/`. A script
  worth keeping moves to `tools/`; the rest is never read back.

A test that checks one of your own documents lives beside that document, in the
drive, and is run by hand — the suite in `test/` runs on temporary drives only.

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

99 of them. They cover the path grammar, the store, the watcher, the op log, the
gate, the backups, the gallery, the mark, the blob round trip, and the loop end
to end over HTTP — including that the client which filed an edit is never told
about it, that a document arriving from outside is checked against the format's
own invariants before it is let in, that a document keeps its icon through a
download, and that every document this repo can produce passes Marble's own
doctor.
