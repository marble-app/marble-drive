# Files in a cloud drive

2026-09-22. Status: design, awaiting review. Companion to
`2026-09-22-drive-is-its-own-space-design.md`.

## Why

The Drive takes any dropped file (songs, photos, PDFs, video, archives) and
shows it as a tile. Two things about that only work well on the owner's
MacBook today, and a cloud drive has to do both everywhere:

1. **Every file shows what it is.** Today pictures for images, PDFs, video and
   Office files come from the host (`/drive/thumb`), and the host makes them
   with macOS QuickLook (`server/thumbs.js`). On any other host a PDF or a
   video is an icon and a badge, and an image tile downloads the whole image.
2. **Any file can be uploaded, however big, over whatever link.** Today one
   upload is one HTTP request. A dropped connection loses the whole transfer,
   and a proxy with a per-request limit caps it.

Already fixed separately (2026-09-22): Node's default five-minute deadline on a
whole request, which capped an upload at what the link carried in five
minutes. The server now has no whole-request deadline, and the upload route
cuts a request only after `MARBLE_DRIVE_UPLOAD_IDLE_SECONDS` (default 60) of
silence (`test/upload-timeouts.test.js`).

## Part 1: the page draws the pictures

Songs already work this way: the page decodes the audio and draws its own
waveform. The same move covers the rest, with the host keeping what the page
drew so it is drawn once per file, not once per visit.

### What the page draws

| Kind | How | Needs |
|---|---|---|
| image | `createImageBitmap(blob, { resizeWidth })` onto a canvas | the file, once |
| video | a muted `<video preload="metadata">` on `/drive/file` (Range already works), seek to `min(1 s, duration / 10)`, draw the frame | the first seconds, via Range |
| pdf | pdf.js renders page one | the first pages, via Range |

Each is drawn at **640 px wide**, encoded as WebP (quality 0.8), and posted to
the host. One size: the tile scales it, and the existing `w` parameter keeps
meaning "the size you want" for QuickLook's pictures.

A kind the browser cannot decode (HEIC in Chrome, camera RAW, PSD, Office,
a video codec the browser lacks) fails its draw and keeps today's glyph and
badge. On the MacBook, QuickLook still answers first for every kind it
already does, so nothing there gets worse.

### When

- **Right after an upload**, by the page that uploaded it. It still holds the
  `File`, so drawing costs nothing on the network. This is the common path.
- **Lazily**, when a tile for a file with no picture scrolls into view (the
  existing lazy mount), for files that arrived another way: an agent wrote
  them, they were copied into the folder, or they predate this change.
- At most two draws at once per page, like `thumbs`' own `most = 2`.

### The host keeps them

- `PUT /drive/thumb?path=<file>&v=<mtime>` with an `image/webp` or `image/png`
  body stores the picture in `.marble/thumbs/`, keyed by path and modified
  time like QuickLook's, so a changed file is drawn again.
- `GET /drive/thumb` answers from that cache first, then QuickLook on macOS,
  then 404 as now.
- Validation: the path must be an existing file; the body is at most 512 KB,
  must sniff as WebP or PNG, and at most 1280 px on its long side (read from
  the header, not decoded). Anything else is a 400. The route is behind the
  gate like everything else; a picture is not a document, so it has no history.
- Moving or deleting a file moves or drops its picture with it, the way
  history follows a document (`fs-store.js`).

### pdf.js

`pdfjs-dist` becomes a dependency, and the host serves its module and worker
under `/runtime/vendor/`. Served by the host rather than a CDN, so a drive
works without a third party and the page's content policy stays as it is.
Loaded only when a PDF tile needs drawing.

### Both Drive documents

`filePreview()` exists twice: `templates/drive.mrbl` (what a new drive gets)
and the owner's live `drive/drive.mrbl`. Both gain the draw-and-post path. The
live copy is patched with one write while the host is stopped (the
serve-host rule), with a patch script in `tools/` that handles both, as the
previews work did.

## Part 2: resumable uploads

### The protocol

A file larger than one chunk (32 MB) is sent in chunks through an upload
session. Smaller files keep using `POST /drive/upload-file` unchanged, as do
agents and scripts.

| Call | Does |
|---|---|
| `POST /drive/uploads` `{ folder, name, bytes, modified }` | Checks the cap and free space, opens a session, answers `{ id, chunk, received: 0 }` |
| `PUT /drive/uploads/<id>?offset=<n>` (body: the bytes) | Appends if `offset` equals what the host has; otherwise 409 with `{ received }`. Answers `{ received }` |
| `GET /drive/uploads/<id>` | `{ received, bytes }`, for resuming |
| `POST /drive/uploads/<id>/finish` | Checks `received === bytes`, picks the free name (`freeFilePath`), links the part into place, announces `created`, answers like the single-request route |
| `DELETE /drive/uploads/<id>` | Cancels: removes the part |

- A session is a small JSON file under `.marble/uploads/<id>.json` (folder,
  name, bytes, modified, received, updated) plus a hidden `.part` file beside
  the destination, the same hidden-then-linked approach as `putFile`. Nothing
  half-arrived is ever listed.
- Each `PUT` is an ordinary short request, so neither a proxy's per-request
  limit nor the idle cut ever sees the whole file.
- A session untouched for 24 hours is swept at boot and hourly: part and JSON
  removed.

### The page

- `marble.drive.uploadFile` (runtime/drive.js) chunks anything over 32 MB,
  retries a failed chunk with backoff (1, 2, 4, 8, 16 s, then "paused"), and
  on a 409 continues from the host's `received`.
- The existing upload card (bytes-weighted bar, per-file %, MB/s, Cancel)
  gains two states: **Reconnecting…** while retrying, and **Paused** with a
  Retry button once backoff runs out.
- **Resume after a reload.** A browser cannot reopen a dropped file after a
  reload, so the page remembers each open session in `localStorage`
  (`id`, folder, name, bytes, modified). Dropping the same file again (same
  name, size and modified time) into the same folder continues that session
  from `received` instead of starting over. The upload card offers
  "Drop *name* again to finish it" for any remembered session.

## Part 3: the cap

- **One setting, checked up front.** `MARBLE_DRIVE_MAX_FILE` stays the cap;
  the session start refuses a declared size above it (413) before a byte is
  sent, and every `PUT` still counts.
- **The default rises from 2 GB to 20 GB.** With chunks, size costs neither
  memory nor a single long request; what is left is disk space, checked next.
- **Free space.** Session start refuses (507) when `bytes` is more than the
  free space on the drive's volume (`fs.statfs`) minus a 1 GB margin, with a
  message that says how much room there is. The single-request route checks
  the same using `Content-Length` when the client sends one.
- Raising it is `MARBLE_DRIVE_MAX_FILE=<bytes>` in `.env.local` on the MacBook,
  or in the launch environment on Fly and Sprites, then a host restart.

## Part 4: other features on a production host

Moved here from the companion spec.

- **Stem splitting** needs `uv` and Demucs, which the Alpine image does not
  have; `/stems/split` already answers "this host has no uv". `GET /stems`
  reports `available: false` when `findUv()` finds nothing and no
  `MARBLE_STEMS_UV` is set, and the Drive page hides the split action then.
- **Machine size.** `fly.toml` gives a 3 GB volume and 512 MB of memory. The
  free-space check keeps an upload from filling the volume; sizing the machines
  themselves belongs to the Sprites deploy.
- The Finder helper maps a local folder and does not apply to a production
  host.

## Guards

- Host: a posted picture is stored, served before QuickLook, replaced when the
  file's modified time changes, moved and dropped with its file; bad bodies
  (too big, not WebP/PNG, too large in pixels, no such file) are 400s.
- Host: a session assembles a file byte for byte across chunks; a wrong offset
  is a 409 with the right `received`; finish before the last byte is refused;
  cancel and the sweep leave nothing behind; the cap and free-space checks
  refuse at start; nothing half-arrived is listed.
- Browser (template and live doc): after a drop, an image, a PDF and a video
  tile each show a drawn picture on a host with no QuickLook (`thumbs` built
  with `platform: 'linux'`), and a second page gets it from the host without
  drawing; an unsupported kind keeps its glyph.
- Browser: a 100 MB upload with the network cut mid-chunk (Playwright route
  abort) shows Reconnecting and completes; a reload plus a second drop of the
  same file finishes it from where it stopped.

## Milestones

1. **Pictures, template.** Part 1 in `templates/drive.mrbl`, the host routes,
   pdf.js vendoring, tests.
2. **Resumable uploads and the cap.** Parts 2 and 3, tests.
3. **Live doc and production.** Patch the owner's live `drive.mrbl` for Parts
   1 and 2 with the host stopped; Part 4.

## Out of scope

- Pictures for kinds no browser can decode (HEIC, RAW, PSD, Office) off the
  Mac. They keep the glyph and badge.
- History for files that are not documents.
- De-duplicating identical uploads.
