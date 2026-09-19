# Focus — gradual attention

> Status: **approved to build**, 2026-09-18. Extends
> `2026-09-18-agents-focus-columns-design.md`, which shipped the column shape
> and a drag that can file any rearrangement. This spec keeps that shape and
> fixes what it left discrete: three sizes where there should be five, one
> partition where there should be an order, and a drag that shows almost
> nothing about where it will land.

Same UIST warm / Dusk tokens. No new npm dependencies. Node 22. Do not
reparent the file's `<marble-conversation>` (reconcile would clone it).
Built on `f7a6689`, which settled field-column assignment before width
negotiation, retuned `GAP` 5 / `PAD` 10 / `MARGIN` 8, and removed the
New-group column.

## 1. Why

Nine complaints, one cause: **attention is continuous and the canvas expresses
it in steps.**

- `assignLods` hands out `DIGEST_BUDGET = 4` digests whether the field has
  1100px or 200px. The budget is a count, and the thing it should answer to is
  a width.
- There are three sizes — full, digest, chip — and then a cliff. Below a chip
  there is nothing, so a group of twelve loose chats costs 12 × 56px however
  little you care about it right now.
- A group cannot be put away. `.focus-collapse` on a card means *unpin*, not
  *collapse*; no region has a collapsed state at all.
- The stage is always drawn first, at `x = margin`. Rank reads left to right
  because the layout has one place to put the panes.
- Split bands are 25% of a pane (34% once open) and the root band is **12px**,
  and none of them is painted. You aim at an invisible target.
- A drag into a folder or the loose column shows no reaction. Not because it is
  unwired — `templates/agents.mrbl:2936` has set `data-drop="into"` since the
  columns spec — but because, measured, the reaction is a **6% shift in
  background and a 1px border tint** on a region 1424 × 533. It is below the
  threshold of noticing.
- Room opens for a split and then folds while the pointer is still on it.
  Measured: `resolveDrop` tests the pointer against the pane's bounding box
  fresh on every move with no memory of an open room, so **two pixels** past an
  edge that nothing paints takes the whole room away.
- Folders can be created but never renamed, recoloured or removed from the
  canvas, though the server has had all three endpoints all along.
- A title is the first 60 characters of the first prompt, forever.

> **Size is how much attention something has. It should have as many values as
> attention does, and the canvas should spend them against the room it has.**

## 2. The ladder

Five levels, not three. A card's level is chosen, never measured from content.

| level | height | what it shows | new |
|---|---|---|---|
| `full` | pane | live transcript | |
| `digest` | 148 | four lines, as today | |
| `chip` | 56 | title, dot, age | |
| `row` | 26 | one line: dot, title, state colour | ✱ |
| `pile` | 44 | *per region*: folder colour, name, count, stacked-card glyph | ✱ |

`row` is a chip with its second line and its padding gone — the smallest thing
that is still a named, clickable, droppable conversation. `pile` is not a card
level at all: it is what a **region** becomes when its cards are put away, and
it is the only level that hides conversations rather than shrinking them.

`cardHeight` gains the two sizes. `focusLodSize` gains `row`. A pile's height
is a region height, so `regionH` returns `PILE_H` for a collapsed group and
skips the stack solve.

## 3. Attention, and the room to spend it on

`assignLods` becomes `attention({ cards, regions, ctx })`, returning
`{ lods, collapsed }`. Two nested fits, both "demote until it fits, in
priority order".

### 3.1 The score

Per card, highest first:

| weight | condition |
|---|---|
| 3 | `running` or `needsReview` |
| 2 | selected |
| 1.5 | in a folder that holds a conversation currently in a pane |
| 0–1 | recency, decaying across the existing 45s `CHIP_COOL_MS` window |

The 1.5 is the one new idea: the folder you are working *out of* stays legible
while you work, because its siblings are the things you are most likely to
reach for next. A region's score is the sum of its cards'.

### 3.2 Vertical fit

Within a region, hand out `digest` in score order until the next one would
exceed the column's inner height; then `chip`; then `row`. A region that
cannot fit its cards as rows in the sub-columns it is allowed keeps the
overflow at `row` and lets the region scroll — a row is already the floor.

### 3.3 Horizontal fit

The field can afford `floor(fieldW / (FIELD_MIN + gap))` sub-columns. If the
regions need more, collapse regions to piles, **lowest score first**, until
they fit. A region holding a pane's siblings is collapsed last. A region
collapsed by hand is collapsed regardless of score and never auto-expanded.

Hand-collapse persists on the folder, as `collapsed` in `folders.json`. The
loose region's collapse persists in agent settings as `focusLooseCollapsed`,
having no folder row to live on.

### 3.4 Why not a density slider

A single slider would be one number for a question that has two independent
answers — how much room the panes get, and how that room is spent. §4 is the
first, §3 is the second, and they compose.

## 4. The budget: a curve and a seam

Both, because both are true: pinning another conversation *is* a statement
about space, and so is dragging the edge.

```
field share = 1 / (1 + 0.92·n)          n = pane columns
n=0 → 1.00   n=1 → 0.52   n=2 → 0.35   n=3 → 0.27   n=4 → 0.21
```

The seam between the field and the panes is draggable. A drag stores a
**bias**, not a width: `k = 2^bias` multiplies the pane share, `bias` clamped
to `[-1.5, 1.5]` and persisted in agent settings as `focusFieldBias`.

```
paneShare = clamp((1 - base) · 2^bias, 0.05, 0.92)
```

So adding a pane moves the seam along the curve and **keeps your adjustment**.
A bias of 0 is the curve exactly; the seam never needs resetting because it is
never an absolute.

Floors still win. `PANE_MIN` 300 and `FIELD_MIN` 196 are honoured before the
share is, and when both cannot be met the canvas scrolls — the rule §2.1 of
the columns spec set, unchanged.

## 5. One column order

`focusColumnsOf` returns `{ stage, columns }` and the pack draws the stage
first. Both go. In their place: **one ordered list of columns**, each either

- a **pane column** — one or more live conversations stacked vertically, or
- a **region column** — one or more folder regions stacked vertically.

A pane column is a very wide column and nothing else. `stageColumns` already
counts the stage's x-distinct leaves, and `layoutDock(tree, extraRects)`
already accepts explicit rects for the ghost — so the pack becomes the
authority for pane geometry (x and width per pane column) and the tree supplies
only the vertical shares inside a column.

### 5.1 The tree flattens to two levels

The dock tree becomes a row of vertical stacks: root is horizontal, every child
is a leaf or a vertical node of leaves. Arbitrary nesting goes.

That is a real loss — split right, then split that half top, then split *that*
right is no longer expressible — and it buys the drop vocabulary that makes the
rest of this spec legible:

| drop | means |
|---|---|
| left / right edge of a pane | a new pane column beside this one |
| top / bottom edge of a pane | stack inside this column |
| a pane's centre | swap or replace, as today |

Two sentences cover every pane drop, and both name something visible.

### 5.2 Direction follows the person

No default side. A new pane is inserted adjacent to `lastPlacedColumn` — the
column index of the most recently placed pane, remembered for the session — so
panes cluster where you have been working rather than at an edge the layout
prefers. With nothing placed yet, a first pane goes to the right of the field,
which puts the least-attended thing leftmost: the default order this spec
inherits, inverted, as asked.

Non-contiguous panes are legal. Nothing enforces a block, because the moment
something enforces it, dragging a pane through the field has to fail.

## 6. A drag that shows its work

### 6.1 Painted thresholds

The hovered pane paints its five zones — four bands and a centre — as tinted
regions, the live one lit. A band is 22% of the pane's short side with a 72px
floor, so it is a target at any pane size. The root band goes 12px → 28px and
paints an edge strip along the whole canvas edge. A drop that makes a new
column paints a full-height seam bar at the column boundary.

Hysteresis stays as it is in kind — an open edge widens to 34% — but is
measured against the **painted** band, so what widens is what you can see.

### 6.2 Room stays open — *implemented*

Investigated before changing anything, and the first two suspects were both
wrong. Holding the pointer perfectly still keeps the room open for at least
three seconds; so does jittering it eleven pixels; so does the root band at a
canvas edge. What reproduces is **drifting outward**: at six pixels inside the
pane's bottom edge the room is open, and at two pixels outside it is gone, with
no fade.

The cause is `resolveDrop`'s bounds test — the pointer against the pane's
bounding box, evaluated fresh on every move, with no memory of a room already
open. Nothing paints that border, and a drop aimed at "the bottom" or "the
side" sits within a pixel or two of it.

An open room now holds while the pointer is within `ROOM_KEEP` (56px) of the
pane. Only an open room gets the tolerance: outside the pane with nothing open
is still nothing, so a drag that never reached the stage cannot conjure a split
from beyond its edge. `endDrop` inside hit-testing is left alone — with the
split branch returning first it no longer fires on this path, and one change at
a time is how the cause stays legible.

### 6.3 Groups and piles react — *partly implemented*

The reaction was wired and invisible, so what it needed was weight, not a
writer. A **ring drawn inside the region's edge** carries it, because a ring
reads at whatever size the region happens to be; the tint only supports it. The
loose region has no fill to change, so there the ring is the whole reaction, and
closing its dashed edge says "a place to land" in the same move. The folder's
name takes the folder's colour while it is the target.

Still to come, with the ladder:

- A **pile fans open** while a drag hovers it: the region expands to rows for
  the length of the hover, so a slot inside a put-away group is aimable. It
  collapses on release, with the card in it.

## 7. Menus

The server has had `createFolder`, `updateFolder` (name, color, order) and
`deleteFolder` (which ungroups members rather than deleting chats) all along.
This is UI only, plus one field.

A `⋯` button on hover on a basin name and on a card; the same menu on
`contextmenu` over either.

| target | items |
|---|---|
| group | Rename · Colour ▸ · Collapse/Expand · Ungroup all · Delete group |
| chat | Rename · Colour ▸ · Move to ▸ · Save as folder · Focus/Unfocus · Archive |
| empty canvas | New group |

Plus a small `+ New group` button at the end of the column order. A button,
not the column `f7a6689` removed: a column that cannot be pressed at rest, and
that shoves the field sideways when reserved for a drag, was right to go.

New field: `color` on conversation meta, `null` meaning "inherit the folder's".
`PATCH /agent/conversations/:id` accepts it against `COLOR_KEYS`.

## 8. Titles a session writes for itself

`server/agent/store.js:203` sets `title` to the first 60 characters of the
first user message and never revisits it.

New `server/agent/title.js`. `titleFor(id)` builds a digest of the session —
the first user message in full, then each turn's prompt and closing summary,
capped at 4000 characters — and asks for **six words or fewer**. One-shot
`claude -p --model haiku` through the existing `runCommand` path, which needs
no API key under subscription auth; falling back to the conversation's own
provider, and finally to today's slice-60.

The answer is validated before it is written: one line, 1–60 characters,
quotes and trailing punctuation stripped, rejected if empty or if it is the
model refusing.

Two triggers:

1. **After the first user message** — so the title is read from the whole
   prompt rather than its first 60 characters, which is the ask.
2. **On `onFinish`** (`server/agent/runner.js:615`, the hook already exists) —
   so a conversation renames itself when the work is done.

Serialised per conversation through the store's existing `serial`, one in
flight, silent on failure, never blocking a turn.

New field `titleSource: 'auto' | 'user'`. A title typed by a person sets
`'user'`, and auto-titling never touches it again. A title the store derived
from a first message is `'auto'`, so the first real title replaces it.

## 9. One title per pane

`templates/agents.mrbl:4669` sets `chrome = dock.extras.length ? 'tile' :
'pane'`, and `:host([data-chrome="pane"]) .heading { display: none }` matches
only `pane`. So a dock with extras keeps its mast heading **and** its bar
title: every conversation in a multi-pane dock names itself twice, 12.5px in
the bar and 15px in the mast beneath it, the lower one larger.

Focus docks panes by design, so this is its common case.

Heading-wins, because `.heading` is `contenteditable` and `.dock-title` is
not: a bar-only title would cost renaming a conversation from its pane, and
quieting something is not permission to reduce what it can do.

- **In a dock** the heading is the title, at 13px, and the bar drops its title
  text — keeping the dot, the target link and the controls.
- **A lone pane** has no heading (the `pane` rule hides it), so its bar keeps
  the title, at 11.5px.

The condition is the dock's, not the frame's. `BAR_MARKUP` fills `.dock-title`
for `.pane > .dock-bar` as well as every `.dock-frame` bar
(`templates/agents.mrbl:4638`), so hiding it in frames alone would leave a dock
naming itself in the first pane's bar and nowhere else. Both are governed by
the same thing that sets the chrome: `dock.extras.length`.

This keeps four existing assertions green rather than rewriting them —
`agents-polish.test.js:129` (bar title ≥ 6rem) and `agents-page.test.js:231`
(bar title non-empty) both measure the lone-pane path, and
`agents-ui-polish.test.js:202`/`:250` assert every pane in a dock shows its
heading, which is the direction this takes.

## 10. Where it lands

| File | Change |
|---|---|
| `runtime/agent-folders.js` | `attention` replaces `assignLods`; `row`/`pile` in `cardHeight`; the curve and the bias; `packFocus` takes one column order; `regionH` for a pile |
| `templates/agents.mrbl` | zone painting, room state machine, basin and pile drop states, the seam, menus, pile markup, bar title, CSS |
| `runtime/agent-ui.js` | `.heading` 15px → 13px; tile chrome keeps it |
| `server/agent/store.js` | `color`, `titleSource`, `collapsed` on folders |
| `server/agent/routes.js` | `color` and `titleSource` on PATCH; `collapsed` on folder PATCH |
| `server/agent/title.js` | new — the digest, the call, the validation |
| `server/agent/index.js` | title on first message and on `onFinish` |
| `test/agent-folders.test.js` | the ladder, the score, both fits, the curve |
| `test/agent-title.test.js` | new — digest shape, validation, `titleSource` |
| `test-browser/agents-focus.test.js` | zones, room held, basin reaction, pile fan, menus |
| `drive/Agents.mrbl` | mirrored once, at the end |

## 11. Risks

- **The flattened tree is a capability loss.** Stated in §5.1 and accepted:
  four panes do not need arbitrary nesting, and the column reading is what
  every other part of this spec leans on.
- **A pile is a place things can hide.** Mitigated by the count on the glyph,
  the fan-open on hover, and never auto-collapsing a region whose siblings are
  in a pane.
- **Auto-titling spends a model call per finished turn.** Haiku, one short
  prompt, no tools, and silent on failure. A conversation with a `'user'` title
  spends nothing.
- **`row` is 26px.** Below a comfortable touch target, so `data-stack` (the
  phone layout) never demotes past `chip`.
- **`runtime/agent-ui.js` is contended.** Another session has been rewriting it
  all day. The change here is the heading rule and its size, and nothing else.
