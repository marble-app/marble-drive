# Focus — balance, swap preview, group chats and modes

> Status: **built** 2026-09-18, all seven items, on main. Decided
> autonomously (Bryan's standing instruction) and recorded here so they can be
> reviewed; each section carries a "Built" note with what the implementation
> corrected. Built on main after `2eb56c0` plus the folder-rail work that was
> sitting uncommitted in the tree from peer sessions, which landed in the same
> commit. `drive/Agents.mrbl` regenerated from the template (positional ids,
> one write, verified).
>
> Extends `2026-09-18-focus-gradual-attention-design.md`. Same tokens, no new
> dependencies, Node 22. The bands are still not painted (§6.1 there); nothing
> here draws over the panes during a drag except the panes themselves moving.

## 0. The seven asks, verbatim

1. Dragging onto the centre (a swap) shows no preview. Animate it.
2. A new chat started while Focus is open always gets a column, never a pane
   under a pane.
3. Keep a golden ratio in the spatial distribution: stage against field, and
   things inside the field.
4. Double-click in a group's empty area starts a chat that belongs to that
   group.
5. A chat on the stage still shows which group it belongs to.
6. Two more Focus modes: focus every active chat; focus a group (its 1–4
   latest/active chats on stage, everything else deprioritised).
7. A drop must preview the balanced layout, not just split the target: three
   columns means three even columns.

## 1. Where things are (grep anchors, not line numbers)

Everything is in `templates/agents.mrbl` unless said otherwise; the live copy
`drive/Agents.mrbl` is patched afterwards by exact string substitution (see
§9). The Focus packer is `runtime/agent-folders.js` (`packFocus`,
`assignLods`, `FULL_CAP`), unit-tested in `test/agent-folders.test.js`.

- Pane tree: `leafNode`, `splitNode`, `insertBeside`, `insertAtRoot`,
  `removeLeaf`, `defaultTree`, `layoutOf`, `reconcileTree`.
- Drag: `resolveDrop` (returns `{plan}` with `mode` in `fill | replace |
  split | swap`), `paintDrop`, `endDrop`, `dropOnto`, `swapIds`, `dockAt`,
  `buildRoom`/`openRoom`/`foldRoom`/`closeRoom`, `layoutDock(tree,
  extraRects)`, `dragLive()`.
- Focus: `paintFocus`, `focusColumnsOf`, `pinnedIdsOf`, `syncStageDock`,
  `pinFocus`, `paintFocusBasins`, `paintFocusCard`, `bindFocusCard`,
  `startNew`, `matchingFocusItems`, `focusLodSize`.
- Bars: `paintBar`, `paintBars`, `paintChrome`, `makeBar`, `BAR_MARKUP`,
  `folderColorOf`.

## 2. Balance (asks 7 and 3) — the tree

**Decision: siblings on one axis always share evenly; the golden ratio lives
between the stage and the field, not between panes.** Bryan named three even
columns explicitly, and a stage of panes is a working set where no pane
outranks another. A manual seam drag still works and still persists; it is
only an *insert* that re-levels the node it lands in.

- `insertBeside`: after splicing the new leaf into a same-axis parent, set
  `parent.sizes = kids.map(() => 1 / kids.length)`. A fresh pair is `[0.5,
  0.5]` (unchanged).
- `insertAtRoot`: same-axis root becomes even across all kids (it already
  scales the others by `1 - share`, which is even only if they were even;
  now it is even regardless). A cross-axis root wraps as an even pair
  `[0.5, 0.5]` instead of `[0.7, 0.3]`.
- `removeLeaf` keeps its proportional redistribution: closing one of three
  even columns yields two even columns anyway, and closing after a manual
  resize keeps the person's proportions.
- Because `buildRoom` previews with the very same insert functions, the room
  preview *is* the balanced layout (ask 7) with no separate code path.

## 3. Balance (ask 3) — stage against field, and inside the field

`packFocus` fills spare width in proportion to what each side already has.
**Decision: when both a stage and a field exist, the target split of the
usable canvas width is φ : 1 (stage 61.8 %, field 38.2 %), clamped by the
existing floors and ceilings** (`PANE_MIN`/`PANE_MAX` per pin,
`FIELD_MIN`/`FIELD_MAX` per sub-column). Floors still win over the ratio and
the canvas scrolls, exactly as today. With no field the stage takes
everything; with no stage the field does.

Implementation in `packFocus`, `spare >= 0` branch: compute `want =
(room - bar) / (1 + 1/φ)` for the stage, clamp to `[stageAt(paneMin),
stageAt(paneMax)]`, give the field the rest clamped to `[fieldAt(fieldMin),
fieldAt(fieldMax)]`, then hand any remainder to whichever side is not at its
ceiling (stage first). The whole-pixel rounding and "stage takes the
rounding remainder" rules stay. The deficit branch is unchanged. `PHI =
(1 + Math.sqrt(5)) / 2` is exported from the helpers.

**Built 2026-09-18, with one refinement.** Past both ceilings together
(`usable > stageAt(paneMax) + fieldAt(fieldMax)`) the ceilings say nothing
and the split is φ exactly; leaving the excess as air would contradict the
existing "filled edge to edge" behaviour. Inside the ceilings the stage is
clamped first and the remainder handed stage-first, then field. In the
`spare >= 0` branch the floors can never bind (both preferred widths already
fit), so "floors win" is the deficit branch's doing, unchanged. There is a
≤4px discontinuity at the width where both ceilings are first exceeded,
because 560 : 340 is not φ.

Inside the field: the digest card is `260 × 161` (was 148) so its face is a
golden rectangle; the chip stays `168 × 56`. `focusLodSize` in the template
and the packer's fallback digest height move together (the packer's old
fallback of 132 was already out of step with 148).

Three even columns measure 2.5px apart in the DOM, not equal: each frame is
inset by half the 5px gap on every edge that faces a neighbour, so the inner
column is a gap narrower than the outer two while the tree's shares are
exactly thirds.

## 4. A new chat gets a column (ask 2)

`reconcileTree` places an unplaced key beside the focused leaf on its longer
side, which stacks a pane under a pane whenever the focused pane is taller
than wide. **Decision: in the Focus dock a key with no leaf is always added
as a root-level column on the right** (`insertAtRoot(next, 'right', key)`),
which with §2 gives n even columns. The page dock (List/Folders) keeps the
longer-side rule, because there the person chose the split. `startNew` from
Focus already pins before opening, so this one change covers the New button,
the thumb bar, and §5's double-click.

## 5. Double-click a group's empty area (ask 4)

A basin (`.focus-basin`) is an absolutely positioned element under the cards
that already carries `data-folder-id` (`'ungrouped'` for the loose region).
A `dblclick` listener on `focusEl` (desktop only, `!narrowView.matches`)
that did not land on a card, the pane, a basin name, a button or an input,
finds `event.target.closest('.focus-basin')`; if found, it calls
`startNew({ folderId })` with the basin's folder id (`null` for ungrouped or
bare canvas). Bare canvas outside every basin starts an ungrouped chat too:
the ask is "empty area", and an empty canvas is the emptiest area there is.
`startNew` already files the folder before opening and pins in Focus, so the
chat lands as a new stage column (§4) with the group's colour (§6).

**Built 2026-09-18.** `.focus-basin` is `pointer-events: none`, so
`closest('.focus-basin')` never matches on desktop; the listener keeps that
branch and then hit-tests `focusPack.regions` with `focusPoint(clientX,
clientY)`, which is the path that actually fires. A region's `folderId` is
`null` for the loose one, and a point outside every region is also `null`.
The basin-name button's own double-click (rename) stops propagation, so it
never reaches this handler. Test: `test-browser/agents-focus-groups.test.js`.

## 6. A staged chat wears its group (ask 5)

Cards carry `data-color` and a `.focus-folder` tick; a pane's bar carries
neither. **Decision: `paintBar` sets `data-color` on the bar (from
`folderColorOf(summary.folderId)`) and the bar shows the same tick the card
shows** — a `.dock-folder` element inserted into `BAR_MARKUP` before the
title, styled by the existing `.folder-tick`/`.focus-folder` rules
(extended to include `.dock-folder`), hidden when the bar has no colour, with
`title` set to the group's name. Clicking it opens `openFocusFolderMenu` for
that chat (the menu takes a card; it is given the chat's field card, or a
stand-in object with `dataset.id` when the card is seated). The colour rule
block `.folder-group[data-color=…], .conv[…], .focus-card[…],
.focus-basin[…]` gains `.dock-bar[data-color=…]` for each of the ten keys.

## 7. Focus modes (ask 6)

Three modes on `focusEl` as `data-mode`, remembered in localStorage under
`marble-agents:focus-mode`:

- `pinned` (today's behaviour, the default): the stage is the pinned set.
- `active`: the stage is every chat that is running or asking, most recently
  updated first, capped at `FULL_CAP`. If nothing is active, the single most
  recent chat holds the stage so the pane is never blank.
- `group:<folderId>`: the stage is that folder's 1–4 members, ordered running
  and asking first, then by `lastInteractedAt`/`updatedAt`, capped at
  `FULL_CAP`.

In `active` and `group` modes every card off the stage is a chip
(deprioritised: `assignLods` is given `forceChip: true` for non-stage ids,
or the template overrides the lods after the call), and `.focus[data-mode]
.focus-card[data-lod="chip"]` sits at opacity .55 so the stage reads as the
only lit thing. Nothing is written to the store by a mode: `pinned` flags are
untouched, so leaving a mode restores the pinned stage exactly. The mode's
stage ids are what `syncStageDock` and `focusColumnsOf` receive in place of
`pinnedIdsOf(items)`; a helper `stageIdsFor(items)` is the one place that
decides.

**Pinning while in a mode returns to `pinned`.** A double-click or Focus
button is the person taking over; the mode yields and the pin applies.

UI: a small floating segmented pill at the top-left of the Focus canvas,
built in JS as transient chrome (no new `__ID__` markup): `Pinned · Active ·
Group ▾`. `Group` opens a menu listing the folders; the pill shows the chosen
group's name and colour while that mode is on. Each basin's name also gets a
small `Focus` button on hover that enters `group:<id>`. Keyboard: none new.

**Built 2026-09-18, four corrections.** The pill sits at the **top-right**,
not top-left: the stage starts at the canvas margin and the pane is fixed at
z-index 6 over it, so anything top-left is covered whenever something is
staged. The basin button cannot reveal on `.focus-basin:hover` (the basin is
`pointer-events: none`); it reveals on the name's hover via a sibling
combinator, on its own hover/focus, while pressed, and always on touch. No
`forceChip` option in `assignLods` was needed; the template overrides the
lods after the call. And a real pre-existing bug surfaced: `load()` painted
Focus before the folder catalog arrived and nothing repainted afterwards, so
a reload straight into Focus drew no group basins and a remembered group
mode could never find its folder — one `paintFocus()` after the boot
catalog load fixes it. A group with zero members stages nothing. A folder
that disappears while its mode is on falls back to `pinned` quietly
(`settleFocusMode`). Test: `test-browser/agents-focus-modes.test.js`.

## 8. The swap preview (ask 1)

`resolveDrop` returns `mode: 'swap'` when a docked chat is dragged onto
another docked chat's bar or centre. Today that tints the target bar.
**Decision: the preview is the swap itself — the two panes trade places.**
`paintDrop`, on `swap`, builds `swapTree = cloneTree(treeOf())` with the two
leaf keys exchanged (`renameLeaf` through a temporary key) and calls
`layoutDock(swapTree)`; the `--t-room` transition carries both panes across.
A state `swapPreview = { source, target, tree }` is kept; when the mode
changes or the drag ends without a swap drop, `layoutDock(treeOf())` eases
them back. `dragLive()` includes `swapPreview`, so a patch mid-drag re-lays
the swap tree rather than the committed one (the same guard as the room).

**The drop commits the tree, not the ids.** `dropOnto` for `swap` sets
`dock.tree = swapTree` (with its sizes as they are, so a swap between a wide
and a narrow column moves the panes, not the widths — that is what the
preview showed), keeps `dock.focus` on the dragged chat's slot, then
`rememberDock(); applyDock()`. `swapIds` stays for callers outside a drag.
The bar tint (`marble-drop-swap`) stays as the "release here" cue.

Not in narrow or reduced-motion: `resolveDrop` never returns `swap` there.

**Built 2026-09-18, three corrections.** `endDrop` runs before `dropOnto`
and cannot know on its own that the drag is ending in a swap, so it takes
`{ swap }` from the two callers that hold the resolved plan (the pane-bar
drag and the rail-tab drag); without it the preview was cleared and the drop
fell back to `swapIds`, moving ids but not frames. The patch-hook guard is in
`boot`'s `marble.register` callback, not `restoreDock`. And a drop that lands
before the 120ms swap intent fires still commits `swapTreeOf(source,
target)` — the same end state the preview would have shown — rather than
falling back to `swapIds`; `swapIds` is the last resort only when the source
key or the target chat is missing. Test:
`test-browser/agents-swap-preview.test.js`. For anyone writing more drag
tests: rects read during the first dock's 520ms transition are wrong — the
primary is still full-width and its "centre" is the seam.

## 9. Live doc

All changes are CSS/JS plus one bar-markup string that lives inside a JS
constant, so `drive/Agents.mrbl` is patched by running the same exact-string
substitution script against both files (one write, verify by counting
landmarks). No `__ID__` markup is added.

## 10. Tests

- `test/agent-folders.test.js`: φ split at rest, floors still win, digest
  161 tall.
- `test-browser/agents-panes.test.js` or a new file: insert re-levels a
  three-column row to thirds; the room preview matches the committed layout;
  swap preview moves both frames and commits the tree.
- New file `test-browser/agents-focus-modes.test.js` (own harness copy, as
  the folder-rail memory advises): double-click on a basin starts a chat in
  that folder and on the stage as a column; a staged chat's bar carries
  `data-color`; `active` and `group` modes stage the right ids and write no
  pins; a new chat in Focus lands as a root column.

## 11. Verification

`npm test`; the browser files named above run alone with
`--test-concurrency=1`; then the live host (`127.0.0.1:4400`) in Chrome for
the usability pass: drag a pane onto another's centre, start a chat from a
basin, switch modes, drop a third column.
