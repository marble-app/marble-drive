# Describe mode: a toolbar for saying what you want, and a surface for comparing what came back

**Date:** 2026-09-21
**Status:** design, built the same day
**Scope:** `runtime/agent-marks.js` (the layer, the toolbar, the frame, Text), new `runtime/agent-variations.js` (the compare surface and the version pill), `runtime/agent-callout.js` (a card can be opened with a prompt and sent), `runtime/agent-ui.js` (tray entry), `server/app.js`, tests, `docs/AGENTS.md`
**Builds on:** `2026-09-21-marks-in-the-tray-design.md` (Select and Sketch as tray tools) and `2026-09-19-callout-summon-an-agent-in-a-document-design.md`

## 1. What changed, and why the tray was not enough

Select and Sketch went into the tray because the tray is where an agent tool
belongs when there are two of them. There are now five, they are modal, and
they are used together in one sitting — draw a box, put a note beside it, pick
the thing next to it, ask for variations of all three. A hover-revealed column
of round buttons is a *launcher*: it is right for one-shot actions and wrong
for a working set you keep returning to while a mode is on.

So the modes come out of the tray and into one **Describe mode**: a horizontal
toolbar at the bottom centre of the screen, where Figma, Sketch and every
drawing tool put one, because that is where a hand rests when the eye is on the
page. The tray keeps a single entry, **Describe**, which turns it on.

This is not a second home for the same tools. Select and Sketch are *only* in
the toolbar now, and the tray is one button lighter than it was this morning.

## 2. The toolbar

Bottom centre, above the safe area, a translucent pill on the same material the
drawer uses. Left to right: **Select**, **Sketch**, **Text**, a hairline,
**Explore variations**, a hairline, **Done**. Each tool is a mode; the active
one wears the accent. Escape leaves the tool; Escape with no tool leaves
Describe mode, and so does Done.

- **Select** — the marquee from the last build, with one addition: it picks
  *marks* as well as elements. A rectangle over a sketch or a note takes that
  mark, so the things you drew are as pointable as the things the document
  holds. Picked marks can be deleted (⌫) and dragged.
- **Sketch** — unchanged: ink read as a box, an arrow or a scribble.
- **Text** — a click places a note on the page at that point, anchored to the
  element under it by id and fractions, and the caret goes into it. A note
  reads as `a note on q1: "make this the headline"`. Empty notes are discarded
  on blur. Notes are dragged by their edge and deleted with ⌫ while picked.
- **Explore variations** — §4.
- **Done** — leaves. What was marked stays; the toolbar going away does not
  throw away a brief.

The toolbar hides while an unpinned drawer is open, the way everything in this
layer does, and it never appears on a page with no tray ([[the register
contract]]: no tray, no marks layer at all).

## 3. The frame, and the field on it

The thing missing from the last build: after a marquee or a stroke, the
selection was described only by thin outlines and a tray label. Now the layer
draws **one frame** around the union of everything selected — a 1.5px accent
rectangle with a faint wash, with the per-element outlines kept inside it, so
there is a single object on screen saying *this is what I mean* — and hangs a
**field** on it:

```
┌──────────────────────────────────┐
│  (the selection, outlined)       │
└──────────────────────────────────┘
   ╭────────────────────────────────────────╮
   │ Describe the change…               [↑] │
   ╰────────────────────────────────────────╯
```

One line, the accent's caret, a send arrow, ⌘↵ or Enter to send. It sits under
the frame, flips above when there is no room below, and follows the frame on
scroll and reflow. Sending does not invent a second conversation path: it opens
the callout's card at the same region with the words already in it and submits,
so the turn, the zone, the trail, Undo and Done are all the ones that exist.

The field carries whatever the marks say. With a sketch on the page it opens
pre-filled with the reading (`a box around q1, q2`), and typing after it is the
sentence that ties it together.

## 4. Explore variations

The ask: *generate many variations of what I selected, implement them in the
UI, and let me compare them in whatever space the page has left.*

The important decision is what a variation **is**. It is not a preview in a
side panel and not a screenshot: this format already has an element for the
thing that might have been —

```html
<marble-alt data-marble-id="title" data-marble-active="v2">
  <h1 data-marble-alt="v1" …>Self-Modifying Documents</h1>
  <h1 data-marble-alt="v2" …>Self-Modifying User Interfaces</h1>
</marble-alt>
```

— and which one shows is one attribute, so switching costs a `setAttr` and
nothing else. So **a variation is a `<marble-alt>` child in the document**.
That makes every variation real, addressable, undoable, comparable, and still
there tomorrow; and it means the *agent* writes them through the write path it
already has, rather than answering in a format this page has to parse out of
prose.

Two halves, and they are independent on purpose:

**The asking.** Explore opens a small card at the frame: *what do you want, and
why* — two fields, because the why is what makes a set of variations more than
noise — a count (3, 5, 8), and Explore. It sends one turn through the callout,
with a prompt that names the ids, quotes the marks, and asks for exactly one
`<marble-alt>` per selected element, each child carrying a short
`data-marble-alt` name and a `data-why`.

**The comparing.** A separate layer, `agent-variations.js`, that knows nothing
about how the alternatives got there. It watches the document for
`<marble-alt>` elements with more than one child and offers two things:

- A **version pill** on the element itself: `v2 ▸ of 5`, with ‹ › to flip.
  One `setAttr`, so it is recorded, undoable and shared like any edit.
- A **compare surface** that lays the versions out *in the space that is
  actually free*, measured rather than assumed: the page's own rect minus the
  drawer, minus the toolbar, minus the frame. Wide and short → side by side.
  Wide and tall → a grid. Narrow → a stack with the pill. Each card is a live
  clone of that version rendered in a shadow root with the document's own
  stylesheets adopted, so it looks like itself, at a scale that fits.
  Each card offers **Use** (make it active) and **Keep only this** (resolve the
  alt and unwrap it, which `collab.js` already knows how to do).

The surface is draggable by its bar and resizable from its corner; it remembers
where it was left, per document.

## 5. Decisions made here

- **One home for the modal tools.** Two homes for one tool is the failure this
  project keeps rediscovering (the toolbar and the launcher in the same corner,
  a zone label and a pill saying the same thing). Describe mode takes them.
- **A variation is a document alternative, not a preview.** Anything else means
  a second store, a second undo, and a comparison of things that do not exist.
- **The compare surface reads the free space, it does not claim a side.** The
  page is the work; the surface takes what is left after the drawer and the
  toolbar, and says so by measuring on every layout.
- **The field sends through the callout.** A second send path would be a second
  conversation model. The field is a faster door onto the same room.
- **Marks are pickable, but they are not addressed elements.** They have no
  `data-marble-id` and never enter `marble.agent.select`; they enter the brief
  as words. A selection is elements; a brief is elements plus what you drew.
- **Still no sidecar store.** Marks live for the tab. Variations, being in the
  document, outlive everything — which is the other reason for the split.

## 6. Not in this cut

- Moving or resizing the document's own elements by dragging them in Describe
  mode. The gesture belongs to the affordance vocabulary (`data-marble-canvas`,
  `data-marble-sortable`), not to this layer, and doing it here would write ops
  no affordance offered.
- Lasso (freeform) select; the marquee and Sketch cover it for now.
- Variations of more than one element compared *together* as a set; each alt is
  compared on its own.
- Re-generating one card in place, and naming a variation by hand.

## 7. Testing

Browser: the toolbar appears in Describe mode and nowhere else; Select picks a
sketch as well as a list; a note is placed, typed, and read back in the brief;
the frame wraps the union and the field sends through the callout; a
`<marble-alt>` with three children grows a pill, flips on ›, and the compare
surface lays three cards out in the free space and applies one.
