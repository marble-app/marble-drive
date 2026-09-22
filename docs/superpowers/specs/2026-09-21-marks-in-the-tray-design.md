# Marks in the tray: Select and Sketch as agent tools

**Date:** 2026-09-21
**Status:** design, built the same day
**Scope:** `runtime/agent-marks-geometry.js`, `runtime/agent-marks.js`, `runtime/agent-ui.js` (tray active state, composer draft), `runtime/agent-callout.js` (mode guard, card event, the floor above the launcher), `server/app.js` (injection), tests, `docs/AGENTS.md`
**Supersedes:** the toolbar half of `2026-09-20-marks-toolbar-for-every-app-design.md` and PR #3. The model in that spec — a mark is a stored anchor, a brief is the set of marks handed to one turn — stands; its floating corner toolbar does not.

## 1. What changed

Phase 1 shipped Select on a branch as a round button at the page's bottom
right, and the first thing it ran into was that the corner was already taken
by the drawer's launcher: it had to measure the launcher through a shadow
root, stack itself 12px above it, inherit its inset, and hide whenever the
drawer opened. Three rulings to make two buttons in one corner tolerable, and
the open question at the end of that build was whether they should have been
one button all along.

Meanwhile the launcher became the **tray**: hover it and a column of agent
tools rises, and a tool is in the column only while it has something to do.
That is a home for exactly this. So the toolbar dissolves — its drag, its
spring, its four corners and its per-document memory all go — and Select and
Sketch register as tray tools like any other.

## 2. The tools

Registered with `marble-tray:register`, the contract `collab.js` already uses.
**If nothing answers the ask there is no tray on this page, and the marks
layer takes itself down** rather than draw a second affordance — the tools
are unreachable without a column to hang them in.

- **Select an area** (`always`, so it is in the column at rest on a pointer
  device and absent on a touch one). A drag draws a marquee; every addressed
  element it covers by 60% or more is outlined as you drag; a rectangle over a
  whole list outlines the list, not its items. Release hands the ids to
  `marble.agent.select`, which is where a text selection and an Option-pick
  both end, so the callout's handle and card take over unchanged. One-shot:
  the mode ends with the release.
- **Sketch** (`always`). The pointer draws. Each stroke is stored in the layer
  as fractions of an addressed element's box, read as one of three shapes, and
  the union of what the strokes name becomes the selection. Sticky: it stays
  on until Escape or the tool again.
- **Clear sketch** (contextual: only with ink on the page).

## 3. A sketch is a selection with a reading attached

The one design decision worth naming. Sketch does not get its own Send button,
and it does not get its own glyph in the corner. Every stroke updates
`marble.agent.select(...)` with the elements it names, which lights the door
that already exists: the callout's handle at the first element, **Ask here**
in the tray, ⌘J, the drawer's own context chip. What the sketch adds is a
*reading* — `a box around q1, q2; an arrow from h to p` — and the reading is
put into the composer as the first sentence of the draft, for the person to
edit before they send.

So one gesture, one door, and the words are the person's to change. The
alternative, a second bubble in the tray that sends a brief of its own, would
have been a second affordance for the thing the first one already does.

Readings, from `readStroke`, on the stroke's own geometry and never on the
anchor:

- **box** — closed on itself and travelling no further than twice its
  bounding box's perimeter. `around: [ids]`, the elements the box covers,
  coalesced the way the marquee coalesces.
- **arrow** — mostly straight (end-to-end distance at least 0.8 of the path
  length). `from` the addressed element under its start, `to` the one under
  its end. A short stroke drawn within 500ms near either end is read as the
  head, not as a second mark, and points the arrow.
- **ink** — anything else. `over: [ids]`, the elements its bounding box
  covers.

The ink is never redrawn as a clean shape. Hovering a stroke inside the mode
shows its reading in words, so a wrong reading is visible before it is sent.

## 4. Decisions made here

- **No sidecar store yet.** Marks live in the page for the life of the tab.
  The store, sent/resolved states and rehydration across tabs are still
  phase 2 of the parent spec, and nothing here forecloses them: a stroke
  already carries the anchor-and-fractions shape the file wants.
- **The reading, not the ink, reaches the agent.** The `<marks>` SVG block in
  the runner's prompt is server work; the reading plus the selection is what
  v1 sends, and the selection is what the construction zone lands on.
- **⌘Z inside the mode, no eraser.** One stroke back covers the common
  mistake; erasing from the middle of five strokes can wait for the store.
- **The overlay has a hole in it.** In a mode a transparent overlay takes the
  pointer, and it lives in the top layer — which would put it over the tray,
  the one thing you need to get back out. A `clip-path` hole over the tray's
  own rect keeps that corner the tray's. Escape still always exits.
- **In-situ affordances step aside inside a mode.** The callout's handle is
  hidden while a tool mode is on: it would be drawn under the overlay and
  unclickable. The tray is the way out, and the handle returns on exit.
- **Nothing is sketched on a phone.** Both tools are `always`, which is the
  tray's word for "hidden where there is no hover" — a finger dragging over a
  document is a scroll, and the phone's answer to briefing is the drawer.

## 5. Testing

Node, on the geometry: a hand-drawn box, a circle, an arrow with and without a
head, a scribble; fractions round-trip after the anchor moves; the marquee
rules from phase 1 stand.

Browser: the tools are in the tray and not on a page with no tray; a marquee
over a list selects the list and raises the callout's handle; a sketched box
around two items selects both and puts its reading in the card's composer;
Escape leaves the mode; Clear takes the ink and the selection with it; the
tray is clickable while a mode is on.
