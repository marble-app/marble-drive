# What an element affords, and the gesture that follows from it

**Date:** 2026-09-21
**Status:** design, built the same day
**Scope:** `../marble` — new `runtime/affords.js` (`affords`, `styleWith`), `lib/affordances.js` (the `resizable` part; canvas moved onto `styleWith`), `scripts/carrier-surface.js` + `skills/build-in-marble/carrier.md`, `skills/build-in-marble/SKILL.md`, `SPEC.md`, `apps/` fixture and a test. `marble-drive` — `runtime/agent-marks.js` (the **Adjust** tool), tests, `docs/AGENTS.md`
**Builds on:** `2026-09-21-describe-mode-design.md`, which left this out on purpose

## 1. Why the last build stopped short

Describe mode can mark a page up and hand it to an agent, and it can compare
alternatives an agent wrote. What it could not do was the most ordinary thing a
person wants when a layout is wrong: **drag the thing where it should go, and
pull its corner until it is the right size.**

It stopped because of rule 3. An affordance belongs to the document, never to
the host: `lib/affordances.js` is a library a document *copies into itself*, and
the gesture that moves a card is wired by that document's own script. A tool in
the host that dragged anything anywhere would be the host deciding what a
document permits — and it would file ops no affordance sanctioned.

But look at what that leaves. The vocabulary says what a *reader* may do. There
is no way for anything outside the document — a host's chrome, an agent, another
host tomorrow — to ask the one question direct manipulation begins with:

> **What can be done to this element, and what op would that file?**

Every consumer therefore re-implements the vocabulary or refuses to act. That is
the generalizable gap, and it is the whole of this design.

## 2. Three things, in the format

### 2.1 `marbleVocabulary.affords(el)` — the vocabulary, readable

A pure reader, served beside the carrier. It writes nothing, wires nothing and
knows no behaviour; it reads the attributes the *default* vocabulary defines and
reports what they mean, including the op each gesture would file:

```js
globalThis.marbleVocabulary.affords(card)
// {
//   move: { kind: 'sortable', group: 'cards', container: <ul>, op: 'move' },
//   size: { kind: 'resizable', axes: 'wh', op: 'setAttr', name: 'style' },
//   text: true, remove: false, pick: true,
//   attrs: [{ kind: 'toggle', name: 'data-done' }],
// }
```

`move` is `null`, a sortable (the element's parent declares `data-marble-sortable`
and both share a group), or a canvas (`data-marble-canvas`, not `"off"`). `size`
is `null` or a `data-marble-resizable` with its axes. The rest is one boolean per
state affordance, so a consumer can ask about text, removal and selection in the
same breath.

**Where it lives, and why not on the carrier.** The first build put it on
`window.marble`, and the format's own e2e test caught it: that suite enumerates
the carrier surface member by member, because the surface *is* the contract and
"nothing else crosses" is what makes two hosts render a file identically. The
same test's comment explains why it has no `select` and no `intent` — a carrier
that offered them would be answering for every document. A reader for one
particular vocabulary is the same kind of answer, so it is not on the carrier: it
is its own module a host may serve, on its own global, feature-detected by
whoever wants it. `lib/affordances.js` is a template, not a dependency, and this
is a reader for that template.

Reading is still not wiring. Nothing about `affords` implements an interaction,
which is what makes it safe for a host to put on the page at all.

### 2.2 `marbleVocabulary.styleWith(el, declarations)` — an inline style, composed

The canvas already knew the trap and solved it privately: reading `style` back
off an element hands the file the browser's own serialization — respaced,
reordered, semicolon appended — which is the renormalization the patcher exists
to avoid. Its `withPosition` is generalized to one helper: keep every declaration
the element has except the ones being written, put the new ones first, return the
string. `null` removes one.

```js
marbleVocabulary.styleWith(card, { width: '320px', height: null })
```

`lib/affordances.js` prefers it and carries the same five lines as a fallback,
because a document has to work under a host that serves only the carrier.

Position, size, and anything a future affordance writes inline now share one
implementation, and the bytes in the page are the bytes in the file.

### 2.3 `data-marble-resizable` — the affordance that was missing

A sortable answers *in what order*. A canvas answers *where*. Nothing answered
*how big*, so every document that wanted a resizable pane hand-rolled one.

```html
<aside data-marble-id="side" data-marble-resizable="w" style="width:320px">
```

The value names the axes: `w`, `h`, or `wh` (the default). Wired by
`affordances.js`, it draws handles on hover or focus, drags to a live size, and
files **one** `setAttr` on `style` on release with its inverse recorded — the
canvas's discipline exactly. Shift keeps the aspect. Escape mid-drag puts it
back. A minimum of 24px, because an element dragged to nothing cannot be dragged
back. Arrow keys on a focused handle nudge by 8px, 1px with Shift, so the
affordance is reachable without a pointer.

## 3. Adjust, in Describe mode

The drive's Describe toolbar gains one tool, between Select and Sketch:
**Adjust**. It is the direct-manipulation tool, and it implements no layout
semantics of its own. It asks `marbleVocabulary.affords` and offers what the
answer says:

| What the element affords | The gesture | The op filed |
|---|---|---|
| sortable parent | drag; a line shows the slot | `move` |
| canvas parent | drag freely | `setAttr` `style` (left/top) |
| `resizable` | three handles on the outline — east, south, corner | `setAttr` `style` (width/height) |
| none of them | the same gestures, marked **undeclared** | the same ops |

The last row is the one worth arguing about, and the argument is rule 1:
*changing the interface is changing the code*. A drag that refuses to change the
file is not Marble. Reordering siblings **is** a `move` — DOM order is the
layout, whether or not anyone declared it — and a size is an inline style, which
is as legible a diff as exists. So the tool does it, says it did it undeclared,
and offers the one thing that makes it declared next time: a **Declare** button
that adds `data-marble-sortable` or `data-marble-resizable` in a second op.

That is the whole shape: *the tool never invents a permission, it uses one or
offers to write one.*

Every adjustment also lands in Describe mode's brief — `moved q2 above q1`,
`sized card to 320×180` — so an agent reading the brief knows what the hand
already did, which is usually the example for what it should do to the rest.

## 4. Decisions

- **Reading is a module beside the carrier, wiring stays in the document.** The
  split that keeps rule 3 true while letting anything at all offer direct
  manipulation — and keeps the carrier surface exactly as closed as it was.
- **The label says what each half allows, separately.** A pane that declares a
  size and sits in a list that declares nothing is exactly that; one flattened
  "undeclared" would be wrong about one of the two.
- **A drag captures its own inverse at the press.** `marble.invert` reads the
  page as it stands, which is right for an op nobody has applied and wrong for a
  gesture that has been moving the element for half a second — the undo it
  computes would put the element back where it just was.
- **The tool files the affordance's own op, not an approximation.** A move done
  by hand and a move done by the document's own sortable are the same bytes.
- **Undeclared gestures are allowed and say so.** The alternative — refusing —
  makes the tool useless on every document that exists today, and none of them
  declares anything yet.
- **One op per gesture, on release.** An op per pointermove is a hundred splices
  for one drag and ninety-nine lies about where it ended up.
- **No new store.** Sizes and positions are inline styles; order is the DOM.
  There is nothing to keep in sync.
- **The `affords` shape is data, not functions.** A consumer must be able to log
  it, send it to an agent, or diff it. Handing back callbacks would make it a
  framework, which is exactly what the carrier is not.

## 5. Not in this cut

- Multi-element adjust (drag a selection of three). One element per gesture.
- Dragging a piece from one container into another, even where both declare the
  same sortable group. A gesture reorders inside the list it started in.
- Snapping to siblings, guides and distribution.
- A grid affordance (`data-marble-grid`) saying *where in a grid* rather than
  *where in pixels*.
- `affords` reporting `add`, `note` or `instruction`; it covers what a pointer
  can do to an element that exists.

## 6. Testing

Format: node tests over `affords` against a JSDOM-free fixture of attributes
(pure reading), and `styleWith` keeping the rest of a declaration list intact; a
browser test that a resizable pane drags to a new width, files one op, lands in
the file, and comes back with Escape and with undo.

Drive: browser tests that Adjust reorders a sortable list and files a `move`,
resizes a resizable aside, offers **Declare** on an undeclared list and adds the
attribute, and writes what it did into the brief.
