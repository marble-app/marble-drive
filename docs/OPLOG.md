# The op log

> The op log writes `{t, …op}` — no client id, no counter. Sync at G4 needs both.
> Two fields now costs nothing; two fields across a year of logs costs a
> migration. This is the one G4 decision worth making at G0.
>
> — the `k-ord` card

Every line:

```json
{"t":1787408196387,"doc":"work/q3/notes","client":"hxopj75m","seq":1,"batch":"k2f9q1",
 "type":"move","id":"4b55b336","parentId":"fef83e61","beforeId":null}
```

`t` is when the host wrote it. `client` is the id the page generated for itself.
`seq` is that client's count of its own ops, from this host's point of view.
`doc` is there because a log line that has been copied out of its file should
still say what it is about. `batch` is the id the page gave the POST the op
arrived in (`/ops?…&batch=<id>`), and is absent when it gave none.

## Batches and retries

A page names each POST to `/ops` with a batch id and sends the same id when it
retries. The host keeps, per document, the last 256 batch ids it applied with
the answer each got, keyed by client and id. A repeated id is answered `200`
with that answer plus `replay: true`, and nothing is applied again. `seq` cannot
do this job: the host counts it, and a restart starts it again. `batch` means the
same thing after a restart, so a restarted host rebuilds its set from the
`batch` fields in the active segment (below). A batch with no id behaves as it
always has.

What `/ops` answers:

| status | meaning | the page |
|---|---|---|
| 200 | landed, or had already landed (`replay: true`) | carries on |
| 403 | a share link's level does not allow it (`reason: "share-policy"`) | drops it |
| 404 | no such document | drops it |
| 409 | an op names something the document no longer has (`reason: "unresolvable"`) | drops it |
| 413 | the body is larger than the host takes | drops it |
| 422 | not JSON, not a list, a malformed op or one the guard refuses, a bad batch id (`reason`: `bad-json`, `not-a-list`, `refused`, `bad-batch`) | drops it |
| 500 / 503 | the host could not take it now (`reason: "internal"` or `"busy"`) | retries with the same batch id |

A 2xx body is `{ok, path, v, sha, bytes, applied, ops, forks, dropped, fixes, checkpointed, replay?, stale?}`
(see Versions, below). An add-only share link hears only `{ok, applied, replay?}`.

## Segments

A log is kept in segments, so it does not grow without end and a copy of the
drive that uploads changed files does not re-upload a long history on every
edit. The active segment is

    .marble/<docKey>.ops.jsonl

and when it passes `MARBLE_OPLOG_SEGMENT_BYTES` (default 4 MB) it is renamed,
whole, to a sealed segment beside it:

    .marble/<docKey>@<firstT>-<lastT>.ops.jsonl

where `firstT` and `lastT` are the `t` of its first and last lines (a counter
`-2`, `-3` follows if two segments would share both). A sealed segment is never
written again, so the hub uploads it once, as an ordinary file. A log that was
already over the limit when the host started is sealed on its next append, so
the first edit to each such document after an upgrade costs one rename.

`@` cannot appear in a document's name (server/paths.js), so a sealed segment
can never be mistaken for another document's active log. Both still end in
`.ops.jsonl`, so the study export and the PC backup (linux/pc-host) that take
`.marble/*.ops.jsonl` take sealed segments too. A move renames every segment
with the document.

`since(path, {after, limit})` reads the active segment, then sealed ones newest
first, and stops once it has `limit` lines after `after`.

## Versions

Every document has a version `v` (server/versions.js): 0 for one that has
never been written through this host, and one more for every batch that lands
on it — a page's, an agent's, an outside write the watcher took in, a restore,
a create. A batch that changes nothing (every op dropped, or a replay) leaves
it alone. Every line of a batch carries the version it made, and `by`, what
kind of writer filed it (`person`, `agent`, `outside`, `restore`):

```json
{"t":1787408196387,"doc":"notes","client":"hxopj75m","seq":3,"batch":"k2f9q1","v":42,"by":"person",
 "type":"setText","id":"p1","text":"Hello"}
```

A batch with no ops to log (a restore, a create, an outside write no op could
express) is one marker line, `{"type":"reset", "v":…}`. `since()` leaves the
markers out, so History reads what it always read. `fixed: true` on a batch's
lines says its sender's copy had to be corrected (its answer carried fixes).
On start, a document's version is the `v` of the newest line in its active
segment, or of the newest sealed one when the active one is empty.

A page is served with its version in `<meta name="marble-version">` (never in
the file) and an `X-Marble-Version` header, and names it as the `base` of each
batch it sends (`POST /ops?…&base=<v>`; none means the current version). The
host rebases the batch over every batch after its base by any other client
(server/rebase.js, the rules in `@bdhmin/marble/sync`), and answers

    { ok, v, sha, bytes, applied, ops, forks, dropped, fixes, replay?, stale? }

`ops` are the canonical ops every other copy receives; `fixes` the elements, as
they now are, whose state differs from what the sender's own ops made; `stale`
that the base was older than the host keeps records for (the last
`MARBLE_SYNC_RING_BATCHES`, 2000, or `MARBLE_SYNC_RING_BYTES`, 64 MB, of them),
so the batch was taken as made on the current version.

Every other subscriber of the document hears the batch as

    id: <v>
    event: batch
    data: {"v":…,"client":"…","batch":"…","ops":[…],"by":"…"}

and `GET /ops?app=<doc>&since=<v>` answers `{ v, batches: [{ v, client, batch,
by, ops }] }`, oldest first, from memory or this log, or `{ v, reset: true }`
when it cannot (a range holding a marker, a log older than versions). A
subscription that sends `Last-Event-ID: <v>` (or `?since=<v>`) is sent what it
missed first. A whole-document batch has no ops for a frame: those subscribers
are sent a bare `changed`, which a carrier that keeps versions answers by
asking `since`, being told `reset`, and reloading.

A subscription that names no version is a carrier from before versions (an
open tab, until it reloads): it is sent the legacy `event: ops` and `changed`
instead, and never `batch`. These stay for one release.

## Why a timestamp is not enough

Two clients whose clocks differ by 40ms — which is every pair of clients — are
unorderable by `t` alone. And one client filing two ops inside a millisecond,
which a drag does constantly, is unorderable by `t` even against itself.

`compareOps` gives a total order: time first, because that is what a person
means by "first"; then `seq` within a client; then the client id, which is
arbitrary and only has to be *consistent* to break a tie.

```js
export const compareOps = (a, b) =>
  a.t - b.t || (a.client === b.client ? a.seq - b.seq : a.client < b.client ? -1 : 1);
```

## What reads it today

Build mode's History (server/build) reads `since()` to say who changed what;
the host reads the active segment's `batch` fields when it restarts, the newest
`v` for each document's version, and the lines after a version for catch-up. G4 is
where the log earns its keep — "sync over the op log" is the one item in the
plan that cannot be added in front of the data it needs.

## What it is not

The op log is a record of what happened, not a way back. Replaying it from the
beginning would mean trusting every op in it to still apply, which is exactly
the assumption that fails when the thing you want to undo is an op that went
wrong.

The way back is `.marble/history/` — gzipped snapshots, content-addressed so a
document saved a hundred times while nothing changed costs one blob. One is
taken before every labelled write (an agent's turn starting, a build, a
restore, an edit from outside, a merge, a document arriving whole), before the
first write of each edit session (another client, a new agent turn, or a pause
of 90 s, which is how build mode's History cuts sessions), and otherwise at
most once every `MARBLE_HISTORY_MIN_INTERVAL_MS` (default 5 minutes) while
someone keeps typing. Taking one before every keystroke's batch gzipped an
11 MB page 90 times in a minute.
