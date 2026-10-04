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
| `server/shares.js` | share links: one document each, at a level, good until turned off (docs/SHARING.md) |
| `server/share-policy.js` | what each level may change, and what no link may: the page's code |
| `server/sse.js` | two channels: this document moved, and the folder did |
| `server/gallery.js` | starters, composed from Marble's affordance parts |
| `server/favicon.js` | the mark: one marble, bare for a document and tiled for the Drive, inline in the head of both |
| `server/flatten.js` | blobs out of a document, and blobs back into it |
| `server/backup.js` | the documents *and* the history, off the box |
| `lib/affordances.drive.js` | optional affordance overrides by name; none today |
| `runtime/drive.js` | `marble.drive` — the carrier surface a Drive needs |
| `templates/drive.mrbl` | the Drive, as a document |
| `server/app-updates.js` | bringing a drive's own copies of the app pages forward: base (the version it was built from, out of `templates/lineage/`), ours (the copy), theirs (today's template), merged by line with ids masked (`server/app-merge.js`) |
| `tools/` | scripts that maintain a running host or look at one — a screenshot over CDP, the phone and seam tours, regenerating the live Agents document from its template. None is imported by the host |
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
no accounts, no per-document storage. The gate is a placeholder that says so in
its own header comment. The one capability URL is the share link
(docs/SHARING.md): it opens one document for someone without the passphrase,
and is checked before any route runs.

## v5: the interface changes itself

Design: `docs/superpowers/specs/2026-10-03-v5-self-modifying-design.md`; plan:
`docs/superpowers/plans/2026-10-03-v5-self-modifying.md`. The interface is the
thing that changes, in place, while you watch — no agent names, bubbles or
"thinking" on the page. This is the first agent-facing layer `ARCHITECTURE.md`
describes; everything above it is the store/server boundary Marble and the
Drive agree on, and this sits above that, in `runtime/` and `server/agent/` +
`server/change/`.

### The five page modules

Loaded in this order (right after `agent-text.js`, in the `agents` group of
`injectCarrier`, `server/app.js`), each depending only on what loaded before it:

| Module | Owns |
|---|---|
| `runtime/change-morph.js` | The engine. The only thing that animates a write. `capture(ids, opts)` reads what the page looks like just before a batch lands; `play(snapshot, opts)` reads it again after and plays the difference — numbers in a style, colour in OKLCH, position/size (FLIP), inserted/removed parts, words revealed at reading pace, a crossfade for the rest. `choreograph` spreads batches of 2–6 parts across the page, ~60 ms apart, all started within 600 ms. One 150 ms crossfade under `prefers-reduced-motion`. |
| `runtime/change-marks.js` | The marks: replaces the old zone box. Tints each part a step touches (light for the reach, deepening with an accent hairline while it lands, lifting over 900 ms), one counting tag per change in the parts' own unit (with a meter once `total` is known), a rail at the window edge for parts out of view, and margin dots past 12 tinted parts. Steps aside where `agent-text.js` or a person's own caret/focus already claims a part. |
| `runtime/change-line.js` | The ⌘J line: replaces the old wide card. One line flush under the thing (or the foot of the window for the whole page). Asks, answers, questions-back and "could not be made" all live here; ⏎ folds it in, Esc puts it away. Words that sound like a style change are tried first as a rule (via `/agent/change-intent`); only what is not one goes to the agent. |
| `runtime/change-review.js` | The change on request: a finished turn leaves nothing drawn until you rest on it or focus it. Draws what changed (added/removed/moved/restyled), one tag that counts it, Keep / Undo (hold: everything since Keep) / Change more / Redo, and reads `/agent/review` on load and on turn end. ⌘Z / ⇧⌘Z from anywhere on the page act on the newest change after your own last edit. |
| `runtime/change-rules.js` | Find, mark, commit: a style change becomes one rule. Reshape (a hand: corner + padding grips) or a few words in the line (via `change-line.js` → `/agent/change-intent`) both resolve to the same thing — the parts "like" the one in hand, marked at once, committed as a single `data-marble-rule` `<style>` element with one undo entry. |

### The presence-frame contract

Every v5 module reads or writes the same enriched presence frame (the
`marble:presence` document event, and the SSE `presence` frame) — new fields
are optional, so a page that does not know them ignores them. Full shape in
the plan's "The shared contract: a v5 presence frame":

```js
{
  client: 'agent:<conversationId>' | 'agent-undo:<conversationId>',
  ids: ['…'], label, phase, note,     // as before v5
  turn: '<conversationId>-t<n>',
  stage: 'start' | 'before' | 'after' | 'end',
  prompt, parts, inserts, removes, moves, kind, step, count, total, reach,
  failed,                             // a fan out's failed ids
  groups: { call, of, done, failed, seq },   // a fan out's groups, when the turn fans out
  done: { status, changed, added, removed, failed? },  // `failed` whenever the turn fanned out
}
```

`client` and `ids` are always the look's own (`lookFrame`, `server/sse.js`);
a caller's fields never replace them. Someone holding a share link is sent
where the work is and how far along, never its words: their stream and
`GET /presence` drop `prompt`, `note` and `step.text` (`forVisitor`,
`server/sse.js`); the owner's tabs get the whole frame.

Order on one document's SSE stream for one batch: `stage:'before'` presence
(from `prepare`, before the write) → `ops` frame → `stage:'after'` presence.
`server/change/parts.js` (`partsOf`, `parseStep`) is what turns a batch of ops
and an agent's own note ("Stage 2 of 4: …") into `parts`/`kind`/`step`/`count`
without writing anything or depending on a turn or conversation.

### The review API

`server/change/review.js`: `reviewPartsOf` reads a turn's saved undo steps the
other way — not "what would put this back" but "what of this is still worth
drawing, and as what" — against the document as it stands now. `listReview`
is the host half (`GET /agent/review?path=`, `server/agent/routes.js`): every
turn that touched a document, newest first, with the parts of it still there
to Keep, Undo or Redo. `conversationHasReview` asks the same question across
every document a conversation's turns touched, which is what `/keep` needs
before it can clear a conversation's launcher dot. Each document is parsed
once per request (`indexOf`, `server/agent/source.js`), however many turns
and parts are read against it, and a part's `before` (or a removed part's
`html`) past 20 KB is sent as its words, cut, with `truncated: true`.

Turn actions, all under `POST /agent/turns/:turnId/<action>`: `/undo` and
`/redo` run `undoTurn` (`server/agent/undo.js`) against the turn's saved
records, publish `turn.undone` / `turn.redone`, and emit a `stage:'end'`
presence frame on every path the undo touched so a tab opened later is not
told an undo is still standing on the document. An undo keeps a redo
record only when it ran something to redo (one that only restored a page
keeps none, and drops any left from before), so `/redo` with no steps is a
409; a redo record that cannot be written is logged, and the undo still
stands. `/keep` marks the turn reviewed and clears the conversation's dot
once nothing else needs review.

### The intent route

`POST /agent/change-intent` (`server/change/intent.js`): the line tries a few
words that sound like a look here before sending them to the agent. A small
model reads them beside an outline of the page (each kind of part as a
selector, how many, how the first looks) and answers one selector and a few
declarations, or `{ rule: null }`. The page re-checks the rule against what is
really there before anything moves. At most two requests run at once; a third
gets `{ rule: null }` immediately. Same plumbing as the callout's offer
(`server/agent/offer.js`): the installed CLI on the login, no key, no tools
and no MCP servers (`--strict-mcp-config`), a hard timeout, and no answer is
not an error.

### `fan_out`

A new agent tool (`server/agent/tools.js`, schema + handler; `server/change/fanout.js`
for the run itself) for parts that each need their own judgment — a label per
row, an icon per item, a rewrite per paragraph — rather than one rule for all
of them. The agent writes one plan and shards the ids; one worker per shard
(the login's CLI, no tools and no MCP servers, started like a turn so it goes
before the host when memory runs out, at most four shards at once) gets the
plan, its shard's brief and only its shard's elements. A worker's reply is
untrusted: `{"ops": […]}`, checked against its shard and the document,
repaired and validated the same way `apply_ops` is (the two share the same
prepare/after path in `tools.js`), then landed as each worker finishes. A
shard that fails leaves its parts as they were, says why in the turn's
`failed` ids, and the rest still lands.

### Load order

`change-morph.js` first (the engine, before anything hands it a batch to
play), then `change-marks.js` (after the caret in `agent-text.js`, whose
claims it defers to, and after `collab.js`, whose zones step aside for what it
marks), then `change-line.js` (after the marks, whose tints its own tint gives
way to), then `change-review.js` (after the line, which its Change more
opens), then `change-rules.js` (after both marks and line, which it draws
with and tries words through). All five carry `data-marble-transient` and are
only injected when `agents` is true for the request.
