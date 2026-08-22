# Marble Drive — the MVP list

Scope: **G0 (hosted for one) + G1 (the Drive)** from
`../marble/apps/ecosystem-vision.mrbl`. Each item below names the card it comes
from, so the plan and the roadmap can be checked against each other.

Marks: `[ ]` not started · `[~]` in progress · `[x]` done.

**All of it is done.** `npm test` is green — 85 tests. What is deliberately not
here is G2 onward, listed at the bottom of [docs/ROADMAP.md](docs/ROADMAP.md).

## 0 — Ground

- [x] `0.1` Repo skeleton, `package.json`, `@bdhmin/marble` as a `file:` dependency
- [x] `0.2` `server/engine.js` — the one place that reaches into the marble package
- [x] `0.3` `server/config.js` — every env var read once, defaults documented

## G0 — Hosted for one

- [x] `G0.1` **The loop, over a network** (`k-loop`) — serve the file as the page,
      take the edit as an op, splice the bytes, tell the other browsers
- [x] `G0.2` **Who the echo is for** (`k-echo`) — never echo a write back to the
      client that filed it; every other client hears it
- [x] `G0.3` **One gate, not an account system** (`k-gate`) — shared secret,
      signed cookie, constant-time compare
- [x] `G0.4` **Ops that can be ordered later** (`k-ord`) — the op log gains
      `client` and `seq` alongside `t`
- [x] `G0.5` **Fold the two history trees into one** (`k-hist`) — exactly one
      `.marble/` per drive, under the drive root
- [x] `G0.6` **Backups off the box** (`k-back`) — documents + `.marble/history/`
      to a target on a schedule, restorable
- [x] `G0.7` **Touch** (`k-touch`) — pointer events and `touch-action` everywhere
      the Drive is dragged
- [x] `G0.8` **Measure what a document weighs** (`k-wt`) — `marble-drive weigh`
      reports bytes, nodes, and how much of it is base64
- [x] `G0.9` **A container and a disk** (`k-box`) — Dockerfile, compose, a volume
      at the drive root, HTTPS notes

## G1 — The Drive

- [x] `G1.1` **The storage seam** (`k-seam`) — read, write, list, stat, history,
      as an interface; no route names the filesystem
- [x] `G1.2` **Nested paths** (`k-path`) — a path grammar, segments joined by
      slashes, no `..`
- [x] `G1.3` **A watcher that sees into folders** (`k-watch`) — recursive, and
      live reconcile still works one level down
- [x] `G1.4` **The listing becomes a tree** (`k-tree`) — `/docs` answers flat for
      the carrier and nested on request
- [x] `G1.5` **The template gallery** (`k-gal`) — starters: doc, sheet, slides,
      board, canvas; "new sheet" is a clone
- [x] `G1.6` **Blobs, with a way back** (`k-blob`) — hash-addressed bytes beside
      the file, and a flatten that puts them back in it
- [x] `G1.7` **A Drive that is itself a document** (`k-drive`) — `drive.mrbl`,
      Google-Drive-shaped, asking the carrier what exists

## Surface and shell

- [x] `S.1` `runtime/drive.js` — the carrier extension the Drive verbs need
      (`marble.drive.*`), written down as a proposal for the carrier surface
- [x] `S.2` The Drive document: sidebar, breadcrumb, grid/list, search, New
- [x] `S.3` Drag a row onto a folder to move it; keyboard and touch paths
- [x] `S.4` Drag a document *in* from outside — onto the page for the folder you
      are looking at, onto a folder row for that one. `POST /drive/upload`,
      `marble.drive.upload`, and a name grammar that meets a filesystem's

## Proof

- [x] `P.1` Unit tests: paths, store, oplog, gallery, gate, tree
- [x] `P.2` Server tests: the loop end to end over HTTP, echo exclusion, history
- [x] `P.3` `npm test` green, and the Drive opens against a real drive root

## Writing

- [x] `W.1` `README.md` — what it is, how to run it
- [x] `W.2` `ARCHITECTURE.md` — the seam, the layers, what is borrowed
- [x] `W.3` `docs/STORE.md`, `docs/PATHS.md`, `docs/CARRIER-DRIVE.md`,
      `docs/OPLOG.md`, `docs/GALLERY.md`, `docs/DEPLOY.md`, `docs/DRIVE-DOC.md`
- [x] `W.4` `docs/ROADMAP.md` — this list against the five generations

## Found on the way, and fixed

Six things this list did not predict, kept here because each one is the kind of
bug that looks like something else:

- **A blob came back as its own length.** `blobs.get()` returned `{bytes, …meta}`
  and the metadata's byte *count* replaced the buffer — a 200 with an empty body,
  which reads as a network problem for an afternoon. The buffer is `data` now.
- **Every other tab heard one edit twice.** The write path announces and the
  watcher announced again. Marble's host broadcasts from the watcher because its
  write path does not; doing both is a duplicate. The watcher now returns early
  for a change it already knows about.
- **A sortable drag stopped filing ops after the first reorder.** `setPointerCapture`
  is released when the captured element moves in the DOM, which is exactly what
  reordering does. The listeners live on the window for the length of a drag now.
- **Dropping a document into a folder also opened it.** A pointer that goes down
  and comes up over the listing is a click. A drag now suppresses the click that
  follows it.
- **A drop had to be two APIs, not one.** Every other drag on this page is on
  pointer events, for `k-touch` reasons. A file from the desktop fires none of
  them: it is a `dataTransfer` on `dragover`/`drop` and there is no second way
  to be handed one. The two coexist — the pointer drag moves what is already in
  the drive, the drag-and-drop API brings things into it — and they mark their
  target with the same class, because to a hand they are one gesture.
- **A folder is not in `dataTransfer.files`.** Dropping one gives an empty
  FileList and a directory in `items`, reachable only through
  `webkitGetAsEntry()` — which has to be called before the handler returns,
  because a DataTransfer is emptied the moment the event is over.

And one thing the list got wrong: the Drive template started life in `drive/`,
which is also the default drive root — so the host would have served the
template, `__ID__` placeholders and all, as a document. It lives in `templates/`.
