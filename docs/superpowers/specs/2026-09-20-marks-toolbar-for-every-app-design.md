# Marks: a toolbar for briefing agents on any Marble app

**Date:** 2026-09-20
**Status:** design, for Bryan's review
**Scope:** new `runtime/agent-marks.js`, `runtime/agent-callout.js` (dispatch hooks), `runtime/agent.js` (`send` carries marks), `server/agent/runner.js` (marks in the prompt), `server/app.js` (injection, a marks store and route), `docs/AGENTS.md`, tests
**Builds on:** `2026-09-19-callout-summon-an-agent-in-a-document-design.md` (the callout) and `2026-09-19-zone-is-someone-else-design.md` (the zone). Two of the callout's "not in v1" items, a marquee over elements and a stored anchor you can place without sending a turn, are this design.

## 1. The problem

Agents in the drive are not only coding agents. They read and edit the same
documents the person is looking at, and increasingly they are asked to do work
*inside* an app: rearrange these cards, redraw that section, fix the thing under
this heading. Today the person's half of that request is one gesture: select
text, summon, type. It works for one region and one sentence.

What is missing is the way people actually brief someone about an interface:
they mark it up. A box around three things. An arrow from here to there. A note
stuck on a card. A scribble over the part that is wrong. Then, having marked
several things, they hand the whole thing over. That is two phases, and the
current gesture has one.

This must work on every Marble app, not one. The drive holds about a hundred
documents of every kind: the Drive page itself, a daily paper, a research
proposal, a Pokémon team, a market landscape, the Agents page. None of them can
be edited to gain the feature, and none of them can be allowed to break it.

## 2. The model in one sentence

**A mark is a stored anchor on an addressed element; a brief is the set of
draft marks handed to one turn; the toolbar makes marks and the callout sends
them.**

The callout established that a conversation is one object in several views.
Marks are a second object with the same discipline: one mark, drawn wherever
its anchor is, in whatever state its turn is in.

## 3. Vocabulary

- **Toolbar**: the floating control at a corner of any document. Collapsed it
  is one button. Expanded it holds three tools and Send.
- **Tool**: a mode the toolbar puts the page in. **Select** (a marquee),
  **Comment** (a pinned note), **Sketch** (ink, boxes, arrows).
- **Mark**: what a tool leaves on the page. Every mark has an anchor, a kind,
  and a state.
- **Anchor**: a `data-marble-id` plus a position expressed as fractions of that
  element's box. Never a pixel coordinate.
- **Brief**: every draft mark on the page, sent together as one turn.
- **Reading**: what the layer derives from a sketch before the agent sees it:
  "a box around A, B and C", "an arrow from X to Y", "ink over P".

States of a mark: **draft** (yours, unsent, editable), **sent** (belongs to a
turn, drawn quieter, no longer editable), **resolved** (its chat was marked
reviewed; the mark is removed, the same moment the trail goes).

## 4. What "every Marble app" requires

These are the constraints that shaped every decision below. Each one was
checked against the code, not assumed.

1. **Injection is the callout's.** `injectCarrier` in `server/app.js` adds the
   callout script after `collab.js` when agents are on. Marks is one more
   script after it, on the same condition, and it stands down on any page with
   `<meta name="marble-agent" content="custom">`, which today is the Agents page.
   A toolbar for briefing agents has no place on the page made of agents.
2. **No document is edited.** Everything the layer draws is
   `data-marble-transient` chrome in a fixed layer on `<html>`, shown as a
   manual popover so it sits in the top layer above every document's own
   stacking contexts (the rule in the "floating UI needs the top layer" note).
   Marks live in a sidecar, never in the `.mrbl`.
3. **Anchors are ids.** Documents reflow, the dock shrinks `<html>` by a margin,
   phones are narrow, and agents rewrite elements while you look. A mark at a
   pixel is lost by all four. A mark at an id plus fractions of that id's box
   survives all four, and disappears cleanly when the id does.
4. **The corner is not free.** The pinned drawer removes the right edge of the
   page by setting `margin-inline-end` on `<html>`; the callout's own
   no-anchor fallback sits bottom-right; on phones the drawer is a bottom
   sheet. The toolbar reads the right edge from `<html>`'s bounding rect, not
   `innerWidth`; a callout with no anchor sits above the toolbar; and the
   toolbar hides while the phone drawer is open. Because some documents will
   still want that corner, the toolbar can be dragged to any of the four and
   remembers the choice per app.
5. **The app owns its pointer at rest.** Drive selects with a held finger,
   Focus drags panes, editors take the caret. The layer is
   `pointer-events: none` except the toolbar itself. Only while a tool is
   active does a transparent overlay take the pointer, and Escape or a second
   tap on the tool gives it back. Wheel scrolling passes through the overlay
   even in a mode.
6. **The app owns its keys.** Documents here bind their own shortcuts. The
   layer binds nothing global except Escape inside a mode. Tools are reached by
   pointer, and the toolbar has a hover title on each.
7. **Colour is the document's.** As the callout and zone do since `bb4ad2a`,
   marks wear `var(--accent-ink)` with the violet carry as fallback, and paper
   comes from `var(--card, var(--paper))`. Dark mode is per document, so
   nothing here consults `prefers-color-scheme`.
8. **Only the carrier surface.** The layer depends on `data-marble-id`,
   `marble.app`, `marble.agent`, the `marble:ops` event and the callout's two
   custom events. Nothing app-specific. That is what lets it ride to upstream
   Marble the way the callout would.

## 5. Design

### 5.1 The toolbar

One round button, 40px, at the bottom right by default, inset 16px from the
page's own edges. It carries the comment-bubble glyph the callout handle uses,
so the two say the same thing: *ask an agent about this*. A count of draft
marks sits on it as a small badge when there are any.

Pressing it expands the toolbar upward into a vertical strip: **Select**,
**Comment**, **Sketch**, a hairline, **Send**. Send is disabled with no drafts.
The strip is a translucent material, blur 20px and saturate 180% over the
document's paper at 72%, with a brighter top edge; under
`prefers-reduced-transparency` it is solid paper with a line. Labels on hover
are 12px, weight 500, tracking +0.01em, the vibrancy rule for small text on
glass.

The strip grows out of the button, `transform-origin: bottom right` (or
whichever corner it lives in), and it materialises: blur radius and scale
animate together, critically damped, about 300ms of settle. It collapses along
the same path. A tool button highlights on pointer-down, not on release, with a
0.97 press scale.

**Dragging the toolbar.** Pointer-down and a 10px hysteresis start a 1:1 drag
with pointer capture, respecting the grab offset. The last few moves are kept
for velocity. On release the resting point is projected with Apple's
deceleration form, `(v/1000)·d/(1−d)` with `d = 0.998`, the nearest corner to
the projection is chosen, and a spring with slight bounce (damping 0.8,
response 0.4) carries it there starting at the release velocity. A flick
throws it across the page; a slow drop settles beside the nearest corner. The
corner is remembered in `localStorage` under `marble-marks:corner:<app>`.
Under `prefers-reduced-motion` the toolbar cross-fades to the corner instead.

### 5.2 Select: a marquee that reads elements

Select puts the page in a mode where a drag draws a rectangle. From the first
frame the rectangle exists, every addressed element it covers gets a 1.5px
outline in the accent, updated on each pointer move, so the person sees the
reading before they let go. Which elements count:

1. Candidates are elements with `data-marble-id` whose box the rectangle
   covers by at least 60% of the element's area, or that the rectangle fully
   contains. Chrome under `[data-marble-transient]` and shadow roots are
   excluded, as are `<html>` and `<body>`.
2. Leaves win, then coalesce upward exactly as `idsInRange` does for a text
   selection: if every addressed child of a candidate's parent is itself a
   candidate, the parent replaces them. A rectangle across a whole card list
   selects the list, not forty items.
3. Shift held while releasing adds the result to the existing selection.

On release the ids go to `marble.agent.select(ids)`, which is the same path
Option-pick uses. The callout's handle then appears at the first element's
corner and the existing summon flow (card, chips, which chat answers)
continues unchanged. Select therefore leaves no stored mark; it is pick mode
drawn with a rectangle. A Select with nothing under it clears the selection.

The mode ends on release. Holding the tool button for a beat, or double
clicking it, pins the mode so several rectangles can be drawn; Escape unpins.

### 5.3 Comment: a note pinned to an element

Comment puts the page in a mode where a tap places a pin. The pin appears on
pointer-down at the exact point, and the note field opens under it on release
with the caret in it. The anchor is the deepest addressed element under the
point; the position is stored as fractions `u, v` of that element's box, so
the pin keeps its place when the element moves or resizes. Enter saves, Escape
discards an empty note. A saved comment is a small paper card, one or two
lines, folded to a dot with a count after it loses hover.

A draft comment is editable in place. Clicking a draft opens it; Delete while
it is open removes it. A sent comment opens read-only and names its turn.

### 5.4 Sketch: ink that becomes a reading

Sketch puts the page in a mode where the pointer draws. Ink is a live SVG path
in the layer, fed by `getCoalescedEvents` so fast strokes are smooth, 2px in
the accent, round joins. Pressure is ignored in v1.

On release the stroke is stored and read:

- **Anchor.** The deepest addressed element containing the stroke's centroid.
  If none contains it, the nearest addressed element by edge distance, and the
  fractions are allowed outside 0 to 1. Points are stored as fractions of the
  anchor's box. Because the anchor can be an ancestor of what the stroke is
  about, the reading is derived from geometry each time, never from the anchor.
- **Reading.** Three shapes are recognised, by cheap heuristics, and the ink is
  never replaced by a clean shape; people distrust an interface that redraws
  their hand. A stroke that closes on itself with a bounding box it mostly
  fills is a **box**: its reading is `around: [ids]`, the elements the box
  covers by 60% or more, coalesced as Select does. A stroke that is mostly
  straight, or a straight stroke followed within 400ms by a short V at one end,
  is an **arrow**: `from` is the addressed element under its start and `to`
  the one under its end. Anything else is **ink**: `over: [ids]`, the elements
  its bounding box covers. A stroke over nothing gets an empty reading and is
  still sent.
- **Caption.** Hovering a stroke shows its reading in words as a small caption,
  so the person can see what the agent will be told and fix it by redrawing.

Sketch mode has an eraser (a second button revealed while Sketch is active)
that removes the stroke under the pointer on pointer-down, and ⌘Z inside the
mode removes the last stroke. The mode stays on until Escape or the tool is
tapped again, because a sketch is usually several strokes.

### 5.5 Storage and life across tabs

Marks are stored per document in a sidecar, `drive/.marble/<app>.marks.json`,
beside the existing `.history.jsonl` and `.ops.jsonl`. The shape:

```json
{ "id": "m7", "kind": "comment" | "sketch", "anchor": { "id": "p12", "u": 0.31, "v": 0.8 },
  "text": "…", "points": [[u, v], …], "reading": { "around": [...] } | { "from": "h3", "to": "aside2" } | { "over": [...] },
  "state": "draft" | "sent", "turn": null | "<turn id>", "by": "<person>", "at": 1758400000000 }
```

Routes: `GET /agent/marks?app=` returns the file; `PUT /agent/marks/:id`
writes one; `DELETE` removes a draft. Each write is broadcast down `/events`
so another tab, or another person, sees the mark land. On attach the layer
fetches once, the ask-not-listen rule the presence fix established. Server
work here means a host restart, as always.

On load the layer rehydrates: draws every draft, draws every sent mark whose
chat still needs review, and drops sent marks whose chat is reviewed or
archived. A mark whose anchor no longer resolves is kept in the file and not
drawn, so an agent rewrite that later restores the id restores the mark.

### 5.6 Send: the brief becomes a turn

Send gathers every draft mark and opens a callout card anchored at the first
mark's element. The card is the callout's own `<marble-conversation
data-chrome="callout">`, and which chat answers follows the callout's rule. In
its composer each mark is a chip: a comment chip shows its first words, a
sketch chip shows its reading. The person types the sentence that ties them
together, or nothing, and sends.

`marble.agent.send(id, { prompt, selection, marks })` gains `marks`. The
`selection` sent with it is the union of every id the marks name, so the
runner's existing slicing puts the elements' HTML in the prompt with no new
code. The runner freezes `marks` on the turn as it does `selection`, and
`composePrompt` adds one block after the selection:

```
- They marked up the page:
  1. Comment on p12 (near the top left): "this should be the headline"
  2. Sketch: a box around card4, card5, card6
  3. Sketch: an arrow from h3 to aside2
```

followed by a `<marks>` element carrying the raw SVG of the sketches in
page-relative coordinates, so an agent that wants the drawing has it and an
agent that wants the reading has that. The construction zone then lands on
the union of ids, as it does for any selection.

Sending flips every draft to sent with the turn's id. Sent marks are drawn at
55% and stop taking edits. When the chat is marked reviewed, by the callout's
Done, the pane, or the drawer, the layer hears `marble-callout:reviewed` and
removes those marks. Undo of a turn leaves its marks sent; the person can
re-brief from what they see.

### 5.7 Motion, in one place

One rule for the layer, drawn from the callout: things arrive and leave, they
never blink. Enter and exit use `@starting-style` with
`transition-behavior: allow-discrete`, 180ms, the callout's curve. Only
`transform` and `opacity` animate on the compositor. The toolbar's expand and
its corner spring are the two exceptions above, and both are documented
there. Under `prefers-reduced-motion`, every spring and slide becomes a
cross-fade, the press scale stays, and the marquee outline still updates per
frame because it is feedback, not motion.

## 6. Decisions made here, and why

- **Select leaves no mark.** A marquee is a faster way to pick; the callout
  already stores and displays what was picked. Storing it twice would give a
  second thing to keep in sync and nothing to look at.
- **Ink is kept, the reading is derived.** Replacing a hand-drawn box with a
  neat rectangle is what whiteboard apps do, and people turn it off. The
  agent gets both the drawing and the reading, so a poor reading costs
  nothing.
- **Coverage is 60%, not intersection.** A rectangle that grazes a column
  should not select the column. The text selection rule cannot apply
  directly, because a rectangle has no DOM range, so the threshold stands in
  for "meant it".
- **Marks are per document, not per conversation.** A brief is made before a
  chat exists, and a second person should see it. The turn id is written on
  the mark when it is sent, which is the join.
- **One Send, one turn.** Splitting a brief across agents is real
  orchestration and it is the obvious next step. It is not in v1 because the
  two-phase model has to prove itself first, and because the callout's
  "which chat answers" rule already gives Send a home.
- **No image clip.** The runtime has no rasteriser and the agent's browser tool
  can screenshot the region itself. The reading carries the meaning the image
  would.
- **No global letter shortcuts.** Documents own their keys. Escape is the only
  key the layer takes, and only inside a mode.
- **Corner drag with a spring, and nothing else springs.** The one thing a
  person throws is the toolbar. Every other motion here is a state change
  with no momentum behind it, so it settles without bounce.

## 7. Components and boundaries

- `runtime/agent-marks.js`: the layer. Exposes nothing on `window`; talks to
  `marble.agent` and to the callout by events (`marble-callout:summon`,
  `marble-callout:reviewed`) and by `marble.agent.select`.
  - `geometry.js` (a section, extracted for tests): `idsInRect(rect)`,
    `anchorAt(x, y)`, `toFractions(anchor, points)`, `fromFractions`,
    `readStroke(points)`. Pure, DOM-in DOM-out or array-in array-out.
  - Toolbar, modes, marks drawing, store client.
- `runtime/agent-callout.js`: `openCard` accepts `{ ids, marks }` and renders
  mark chips; the no-anchor fallback yields the corner to the toolbar.
- `runtime/agent.js`: `send` forwards `marks`.
- `server/agent/runner.js`: freezes `marks`, adds the prompt block.
- `server/app.js`: `RUNTIME` entry, injection line, `/agent/marks` routes
  over a small store in `server/agent/marks.js`, broadcast on write.

## 8. Error handling

- A mark whose anchor is gone is not drawn and not deleted.
- A `PUT` that fails leaves the mark drawn as draft with a small retry affordance
  in its card; the layer never drops a person's note on a network error.
- Sending with marks whose ids no longer resolve sends the ones that do and
  says in the chip which were dropped.
- The overlay in a mode never `preventDefault`s wheel or pinch, so a page can
  always be scrolled out from under a stuck mode; Escape always exits.
- A stroke with fewer than three points is discarded, and a comment with an
  empty note is discarded on blur.

## 9. Testing

Node, on the pure geometry with a JSDOM fixture of nested addressed elements:
`idsInRect` coalesces a full list and ignores a grazed column; `anchorAt` picks
the deepest element and falls back to the nearest; fractions round-trip after
the anchor moves; `readStroke` reads a hand-drawn box, an arrow with and
without a head, and a scribble.

Node, on the store: write, read, broadcast, delete refuses a sent mark.

Node, on the runner: a turn with marks produces the block and the `<marks>`
element, and its `selection` is the union.

Browser: the toolbar appears on a document and not on Agents; a marquee over a
card list selects the list and shows the callout handle; a comment survives a
reload and shows in a second page; a sketch's chip names its reading and the
sent turn carries `marks`; pinning the drawer moves the toolbar inward; sent
marks disappear on Done; `prefers-reduced-motion` produces no transform
animation. Tests that create conversations archive them and close their pages,
per the callout's lesson.

## 10. Build order

Three phases, each usable on its own:

1. **Toolbar and Select.** Injection, the corner, the drag, the marquee,
   handing off to the callout. No server store.
2. **Comment and the store.** The sidecar, routes, broadcast, rehydration,
   Send with comment chips, the runner block.
3. **Sketch.** Ink, the eraser, readings, captions, SVG in the prompt.

## 11. Not in v1

- Splitting a brief across several agents.
- Moving a sent mark, or replying to a comment.
- Pressure, colours, or text in sketches.
- Clipping a region as an image.
- Phone sketching beyond what the overlay gives; on a phone Send hands to the
  drawer as the callout does.
- Readings beyond box, arrow and ink.
