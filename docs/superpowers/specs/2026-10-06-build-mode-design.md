# Build mode — build decisions

The spec is the drive document **Notes and Sketches/Build Mode** ("No chat: you
mark up the app, and press Build"), and its mock is the design; its section 12,
variation E ("marks carry the build"), is the one that ships. The plan for E is
**Notes and Sketches/Build Mode Plan**. This file
records what the build decided where the spec leaves a question open, how the
parts map onto the code that was already here, and what is left for later.

## What it is

A new app is a place you go to. Describe is on from the start, the app stays
at full size, and what you want goes onto the app as marks: notes, sketches,
comments and pieces. Build hands the marks (or the selected ones) to one lead
agent, which plans, builds in the open and can fan out. Every build is kept and
can be paused, stopped, or gone back to.

Everything said about the app, and how far each thing has got, is read in one
margin beside it, as in Docs: a card per mark, level with its pin. The build is
carried on the marks themselves: each pin shows how its change is going, each
card ends in one status line, and the toolbar holds the one build. Nothing on
screen names a job, a part or an agent; the app answers comments in its own
name.

## Where each part lives

| Part | Code |
|---|---|
| The marks and the toolbar (Use, Select, Sketch, Note, Comment, Clear, Done) | `runtime/agent-marks.js` — Describe mode, grown: no ring and no notice, on by default, marks kept on the server, a Comment tool, a selection bar instead of a frame round every mark |
| Status mark, Builds, Build and its meter, found cards, comment threads, the right side (Pieces or the margin, docked), the corner button and + handles, the folder chip, the first note | `runtime/build-mode.js` (new), after `agent-marks.js` |
| The margin: a card per mark, its status line and one control, the filter (Open, Building, Done), the build's own card with the drawer's picture, the numbered pins with their progress | `runtime/build-margin.js` (new), after `build-mode.js`; its stacking and status rules are pure and unit-tested (`test/build-margin.test.js`) |
| Describe, Pieces and Comments on the shell's bar | `runtime/shell.js` (`data-act` describe, pieces, comments; pressed state from `marble-build:side`) |
| A build's drawing | `server/agent/drawer.js` draws every turn that uses tools; `server/build/index.js` keeps a build's latest `progress.drawn` as `drawn { html, at, final }` and sends it on `build:<path>` |
| Build state: marks, builds, plans, snapshots, saved pieces | `server/build/` (new): `store.js`, `brief.js`, `index.js`, `reply.js`, `pieces.js`, `routes.js` |
| The lead agent's plan | a new agent tool, `build_plan` (`server/agent/tools.js`), handed to `server/build` |
| New goes to the app | `runtime/shell.js` (an App tile, the default for Enter), the `app` starter (`starters/app.mrbl`, not listed in the gallery) |
| Build these, Remove and Save as piece on a selection | `runtime/build-mode.js`, the bar on what is picked |

## Rulings

**Marks live on the server, not in the document.** A mark is about the app, not
the app's state: putting it in the file would make every note an edit to the
app, put it in the app's undo and diff, and leave it in a downloaded copy. The
build state of a document is one JSON file under `.marble/builds/`, keyed by
the document's path and moved with it (`followMove`). Every tab reads it on
load and hears changes on the conversation hub's `build:<path>` channel.

**A build is a conversation turn.** Build starts (or reuses) one conversation
per document, titled after the app, and sends it one turn whose prompt is the
brief composed from the marks (`server/build/brief.js`). The turn is an
ordinary turn: it shows in Agents, draws its own change marks on the page
(tints, dashed outlines, the moving ring, the tag), and is undone like any
other. The lead is told to call `build_plan` first and keep it up to date, and
to use `fan_out` when marks fall in separate parts.

**Checkpoints are kept by the build, not the history log.** History is pruned;
a build's checkpoints must outlive that. Each build stores the document as it
was when it started and when it ended, gzipped, by content hash
(`.marble/builds/snapshots/`). Viewing a build writes that snapshot back
through the same path a restore takes (`before-restore`), so viewing is itself
a restore point and nothing is lost either way.

**Pause** cancels the running turn and keeps what landed; the build is
`paused` with its plan. **Resume** sends the same conversation a new turn that
names the plan and what is done, so the agent keeps its context (answers "does
a paused build keep its workers' context": yes, through the conversation's
session). **Stop** cancels the turn, keeps the document as it got to in the
build's `end` snapshot, and writes back its `start` snapshot (the last finished
version). Its marks go back to waiting.

**Marks after a build** stay on the app, faint, labelled Built, until Clear
marks (answers "do marks go once built"). In Use they are out of sight with
the rest of the layer. In the margin they are under Done, folded to one line.

**One right side.** The chat, Pieces and the margin take turns in it. Which of
Pieces and the margin has it is one value per app in this browser
(`marble-build:side:<app>`: pieces, comments or none), so what is stored cannot
open both. Open, it docks as the pinned chat does (`#marble-build-dock` gives
`html` a 312px right margin and says `--marble-dock-right`), and unpins the
chat; put away, it gives a chat it unpinned its place back. Pinning the chat,
or bringing it out on purpose, puts the side away. The side lives in the
shell's frame: Hide everything takes it with the bar and brings it back with
it, and asking for it with the frame hidden brings the frame back. On a phone it
is a sheet from the foot and docks nothing.

**The margin** opens from Comments on the bar, and from the status mark on
Building (pressed again, it closes). While it is open, Describe's layer carries
`data-margin`: the bodies of notes and pieces leave the app and sketches fade,
and the margin's own numbered pins stand in for them. A card's top is its pin's
top less 10px; cards keep page order and 8px apart; a picked card comes level
with its pin, steps 12px toward the app, opens its reply line, and a 1px line
joins it to its pin. Esc inside the margin is the margin's (Describe's own Esc
waits for it). The filter is kept per app as `marble-build:show:<app>`.

**Marks carry the build.** A mark's status comes from its state, its build and
the build's plan: the part of `build_plan` whose ids hold the mark's anchor (by
containment, on the page) says whether its change is still to come, being made
or made, and fills the ring on its pin. A comment's status comes from its
thread: the app is answering, asked you (Build that, Not now), Answered
(Resolve), Resolved (Reopen). A waiting mark can be **held back**: `held` is
the page's to set (`POST /agent/builds/hold`) and the host's to keep, and Build
leaves held marks out unless they are picked by name. Comments can be
**resolved** (`POST /agent/builds/resolve`); a new line opens one again.

**There is no plan popover.** The status mark's press shows the build in the
margin, headed by the build's own card: its sentence and clock, then the
drawer's picture of the work (mounted with `chat-visual.js` `mountDrawing`, in
its sandboxed frame), swapped in place as new ones come; before the first, the
plan's parts as one quiet line, which stay the card's words for a screen
reader. A drawing that arrives after its build ended is dropped unless it is
the final one; the final one is kept with the build and shown under its row
when it is picked in Builds (`GET /agent/builds/b<n>/drawn`).

**The app answers, never an agent.** Replies in a thread are signed with the
app's name and a tile of its initial, in the floating thread and in the card,
and the reply model is told to answer as the app and never to mention an
agent, a model or a job.

**Comments** are answered by the login's small model (`server/build/reply.js`,
the same plumbing as the callout's offer: no tools, a hard timeout). The model
sees the comment, the thread, the element it is pinned to and an outline of
the page, and answers `{answer, offer}`; an offer is shown as Build that / Not
now. Build that files the offer as a note on the same element, waiting for the
next build. Comments are also in the next build's brief, as context.

**Pieces** are kept in one store for the drive (`.marble/builds/pieces.json`),
each with its source (document and id), a snapshot of its markup and the
styles it needs, a kind and one line (answers "where do saved pieces live").
"In your drive" is read from the drive's documents: named regions (sections,
asides, articles, tables, forms, figures, and blocks that open with a
heading). Suggested pieces are picked by the small model when Pieces opens,
once per version of the app (answers "when does the agent suggest"). A piece
put on the app is a mark like the others, drawn as a card with the piece's
own markup in a sandboxed frame, dashed, "Not built in yet".

**Describe is on by default** on every document except the drive's own pages
(Drive, Agents, Chat, Console) and pages that say `marble-agent` is custom.
Turning it off is remembered for that app in this browser, as the spec asks.

**The way back to a chat** stays: the shell's chat button and ⌘⇧J still open
the drawer, which takes the right side back from Pieces or the margin.

**The folder chip and the name.** The lead may give the app a `title` and a
`folder` in `build_plan`. When a build of an app still called Untitled
finishes, the page renames it to the title and reloads at its new address. The
folder is offered as a chip in the shell's bar ("Not in a folder yet · Move to
UCSD") until taken or dismissed.

## After the first ship (8 October)

Marked up on the spec page after using it:

- **Boxes that grow.** A note is as wide as its longest line, 220 to 380px,
  then wraps; it is pulled in from the window's edge when it would run past
  it. The comment box is a textarea that grows with what is typed, and its
  card widens from 300 to 440px; Enter posts, Shift+Enter is a new line. The
  margin's reply box grows the same way.
- **One press.** In Build mode the Note tool, like Comment, puts down one
  note and hands the cursor back to the app; writing in a note that was
  already there does the same. The tool's icon is a note, not a T.
- **Deleting is undoable.** The note's × works (the grip no longer captures
  the press on it). A deleted mark, by its ×, Delete or a comment's trash,
  says so in a line over the toolbar with Undo, and ⌘Z puts it back while
  the line is up; putting back keeps it on the host again as it was.
- **Pasting.** A picture pasted onto a note is shrunk to 1600px, kept beside
  the builds (`.marble/builds/images`, by content hash; POST/GET
  `/agent/builds/image`) and drawn on the note; a part copied off a page
  (anything with a control, a table, a picture or an addressed element) is
  drawn small as a pasted part; words are pasted as plain words. The brief
  gives the build each picture's path to Read and each part's markup.
- **The margin.** No filter: every mark in one list, its card drawn by state
  (plain while waiting, tinted with its meter in the build, faint and folded
  when done), the head counting each. No line from pin to card: the picked
  card and its pin are shaded in the accent. A note's words are written on
  its card while it waits. The margin and Pieces slide in from the edge and
  the app's margin eases with them. Picking a card brings its part into
  view, scrolling inside the app first when the app scrolls. The build's
  card heads the list only while a build is in hand.
- **What is being written stays.** With the margin open a new note or comment
  stays whole on the app until it is left, then folds into its pin (notes and
  pieces fold to their point and unfold when the margin shuts). Before, a new
  note was hidden before it could take the caret.
- **Quiet hover.** The + and ring on a part under a passing hand are gone.
- **The chat on the bar.** In Build mode the shell's right-side button is the
  chat's, drawn as a speech balloon beside Pieces and Comments with the
  launcher's dot, and the launcher leaves the corner.

## Left for later

- Taking one finished part out of a stopped build (only looking at it is here).
- Live pause of fan_out workers mid-shard (pause stops the turn; workers stop
  with it, as on any cancel).
- A drawing and Pause and Stop for each job of a build: jobs are never shown,
  so a build is drawn, paused and stopped as one.
- Undo for one built mark: going back to a build in Builds is the way back.
- Hold back for a mark already in a running build: pause or stop the build.

There is no comment on the whole app: a comment anywhere can be about all of
it, and the app works out which.
