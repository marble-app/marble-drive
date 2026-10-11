# Focus — priority reads rightward

**Ask, verbatim.** "In the focus view panel management, let's flip the default
ordering of priority. I want the lower prio content to be on the left, and then
the more focused chats to be on the right."

## 1. The decision

**The canvas is a gradient that rises to the right.** The field — folder
regions in catalog order, the loose one last — is laid from the left margin;
the stage, the panes you are actually working in, stands at the right edge.

Left to right was already the axis rank read along (`packFocus`'s header says
so, and it is why the field is beside the stage rather than under it). What
flips is only which end the high end is. The row now ends where the attention
belongs, the direction the language reads.

What does **not** change:

- **Inside the stage, nothing is reordered.** "Between panes nobody outranks
  anybody" — the pane tree is what the person dragged, and a pane dragged left
  stays left. `FULL_CAP`'s "a fifth pin retires the rightmost" is a statement
  about the stage's own rank, untouched.
- **Inside the field, nothing is reordered.** Catalog order with the loose
  column last; a column is still ranked top to bottom.
- **The φ split, the floors and the ceilings.** Which end a side stands at is
  not a question about how wide it is.

## 2. Where it is

`runtime/agent-folders.js`, `packFocus`. The widths are negotiated exactly as
before; only the running `x` changed. The field is placed from `x = margin`,
then the New-group slot (dead in the live page, alive in the unit tests), then
`placeStage(x)` — the stage waits its turn instead of going first. The gap
between the two sides is the one the field already trailed. `wantsNew` now
measures the room left against `stageSpan`, since the stage is placed after it
and no longer counted in `x`.

Everything downstream reads geometry off the pack — `layoutFocusPane` puts the
dock over `pack.stage`, cards take `pack.rects`, `focusTargetAt` hit-tests
bands — so the flip propagates without a second source of truth.

Two places knew the side by hand, both in `templates/agents.mrbl`:

- **The pin rail.** With nothing staged there is no stage column to aim at, so
  an edge of the canvas stands in for one while a card is in the air. It moves
  to the right edge: `paintFocusPinSlot` draws at `box.right - FOCUS_RAIL` and
  `focusTargetAt` tests `point.x - scrollLeft > clientWidth - FOCUS_RAIL`.
- **The scroll rest position.** New: `anchorFocusScroll`.

## 3. The scroll, which is the whole cost of the flip

The canvas scrolls sideways when the floors cannot both be met (three pins
under ~1100px, two under ~950px). Overflow used to push the *field* off the
right, which cost nothing — it is the part you are not looking at. With the
stage at that end, the same overflow hides the panes.

**Decision: an overflowing canvas rests at its right end.** You scroll back to
the field; you never scroll forward to the panes. `anchorFocusScroll` sets
`scrollLeft` to the extent's right edge — but only when the extent's width
actually changed, never during a drag, and never when the whole stage is
already in view. The quiet repaint runs every second; re-anchoring on each one
would take the scroll away from whoever had just moved it, and a drag that
scrolled its own canvas would be a gesture that moves its own target.

Measured at 900 × 820 with three pins and two regions: on entering Focus,
`scrollLeft` lands at 163 of 163 and all three panes are inside the viewport;
scrolled back to 0 by hand, two seconds of quiet repaints leave it at 0.

## 4. Tests

- `test/agent-folders.test.js` — "the field stands to the left of the stage,
  never above it" (was "never starts above the stage it sits beside"); the two
  golden-ratio tests now check the **stage** reaches the right edge, and that
  the New-group slot stays left of it.
- `test-browser/agents-focus.test.js` — the full-height-column test asserts the
  stage is the right-hand end; the pin-by-drag test aims at the right edge.
- Unchanged and passing: focus, focus-groups, focus-modes, focus-close,
  focus-new-chat, balance, panes, swap-preview, ui-polish, page, transitions,
  phone (133 browser tests), and `test/agent-folders.test.js` (35).

## 5. Live doc

`drive/Agents.mrbl` carries the template's script, so the rail and the scroll
anchor were patched into it by the same three replacements. `agent-folders.js`
is served from disk, so the packer needed no doc write. The page has to be
reloaded to pick either up.
