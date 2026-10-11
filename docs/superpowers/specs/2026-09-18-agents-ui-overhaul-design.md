# Agents — transitions, review, panes and the Focus field

> Status: **approved to build**, 2026-09-18. Extends
> `2026-09-18-agents-focus-columns-design.md` (the stage and the field) and
> `2026-09-17-agents-panes-design.md` (the pane tree). Where this document
> contradicts either, this one wins.

Same UIST warm / Dusk tokens. No new npm dependencies. Node 22. Do not
reparent the file's `<marble-conversation>` (reconcile would clone it).

## 1. Why

Ten faults, each measured against the current template with `shots.js` and
`probe.js` before a line was written:

| # | Fault | Where it lives |
|---|---|---|
| 1 | Conversations only animate between List and Board. Every other switch crossfades. | `setView`: FLIP is gated on `isListBoard(current) && isListBoard(next)` because only those views share a `.conv` node. |
| 2 | The board's Needs review column is almost always empty. | `runner.js` writes `lastOutcome: 'done'` for a completed turn that applied nothing; `store.js` `REVIEWABLE` lacks `done`. A turn waiting on the person (`asking`) is bucketed as Running. |
| 3 | Board + an open chat is a flat split with a floating close button, not the rounded pane the other views use, and a pane can only be made by dragging a row onto a pane edge. | `body[data-view=board][data-panel=open]` CSS; `.board-panel`. |
| 4 | A thin board scrolls sideways through three columns. | `.board` narrow rules: `scroll-snap-type: x`. |
| 5 | Which pane is focused is said only by the composer chrome and the caret. | `paintChrome` toggles `data-chrome` pane/tile. |
| 6 | Dragging in Focus jitters. | `pointerenter` → `hoveredId` → `assignLods` promotes the card → the column re-packs under the pointer → leave/enter → repeat. Drops wait on PATCH round trips before the card springs home. |
| 7 | Pinned conversations can only sit side by side; a folder with two cards takes a full-height column. | `packFocus`: one row of full-height columns, by design of the previous spec. |
| 8 | Hovering a card resizes it and pushes the column; the resize itself does not animate. | `assignLods` `card.id === hoveredId → digest`; `animateFocusCard` springs position only. |
| 9 | Chips have no state dot; the dot that exists says running / review / failed, not "done and unseen" or "waiting on you". | `.focus-card[data-lod="chip"] .focus-dot { display: none }`; `statusOf` three-way. |
| 10 | The model reads as a hued pill on a row and as faint text on a Focus card. | `.conv .tag` vs `.focus-card-model`. |

## 2. Principles

1. **A conversation is one object in four views.** It keeps its identity —
   and its motion — when the view changes.
2. **State has one vocabulary.** Working, waiting, unseen, idle, failed: the
   same five words, the same dot, the same colours, in every view.
3. **An attribute has one style.** Where there is no room it is hidden, never
   restyled.
4. **The pane tree is the only pane model.** Board, List, Folders and the
   Focus stage lay panes out with the same tree, the same gutters, the same
   room-making ghost.
5. **Hover informs; selection commits.** Nothing moves because the pointer
   passed over it.
6. **Space follows content.** A region is as tall as what it holds.

## 3. State (§9 of the ask)

### 3.1 The store

`server/agent/store.js`:

```
REVIEWABLE = { changes, done, failed, interrupted, watchdog }
needsReview(meta) = REVIEWABLE.has(lastOutcome)
                 && (lastReviewedAt == null || lastReviewedAt < lastFinishedAt)
```

`done` joins the set. Nothing else in the store changes; `summarize` already
carries `asking`, `running`, `queued`, `needsReview`, `lastOutcome`.

### 3.2 The client vocabulary

One derivation, `stateOf(summary)`, in `runtime/agent-ui.js` (exported on
`window.marbleAgentUI`, so the template and the component agree):

| state | when | dot |
|---|---|---|
| `waiting` | `asking` | caution, expanding ring (1.8s) |
| `working` | `running` or `queued`, not asking | accent-ink, breathing opacity (1.6s) |
| `failed` | `needsReview` and `lastOutcome` ∈ {failed, watchdog} | danger, solid |
| `unseen` | `needsReview` otherwise | ink, solid |
| `idle` | everything else | faint, hollow (1px ring, no fill) |

`data-state` is set on `.conv`, `.folder-tab`, `.focus-card`, and on every
`.dock-bar`, which gains a dot before its title. One CSS block, `STATE_CSS`,
exported beside `TAG_CSS` and injected once by the template. Reduced motion
stops the breathing and the ring; the colours stay.

`statusOf` — the three-way bucket the board and the Review filter use — reads
from the same facts: `asking` → `review`; `running || queued` → `running`;
`needsReview` → `review`; else `completed`.

### 3.3 Seen

A conversation is marked reviewed (`agent.markReviewed`, the existing PATCH)
when it is opened — as today — **and** when a `turn.completed` /
`turn.failed` / `turn.interrupted` event arrives for a conversation that is
the focused pane while `document.visibilityState === 'visible'`. A chat you
are already watching does not fall back into Needs review the moment it
finishes.

### 3.4 The board

Needs review holds `waiting` first, then the rest by `lastFinishedAt`
descending. Counts update as today.

## 4. Attributes (§10)

Every fact a conversation shows has one class and one rule:

| fact | class | where shown | where hidden |
|---|---|---|---|
| state | `.dot` | everywhere | — |
| title | `.title` | everywhere | — |
| project / agent / model pills | `.tag` (`TAG_CSS`) | list row, board card, Focus digest | chip, folder tab, pane bar |
| target path tail | `.target` | row, card, digest, tab, bar | chip |
| activity | `.activity` | row, card, digest | chip, tab, bar |
| status word | `.status-word` | digest | row, card, chip, tab |
| age | `.age` | everywhere except the bar | bar |

The Focus card keeps its `.focus-*` hooks (tests address them) and adds the
shared class to the same element. The digest grows one line for the pills:
`260 × 148`. `soloProvider()` no longer changes what a chip shows — a chip
shows title, dot and age, always.

## 5. Panes (§3, §5)

### 5.1 Focus is lit, neighbours dim

`.pane` (or `.dock-frame`) with `data-focused` keeps `--card` and a 1px
`--accent` hairline on its bar. Every other pane in the tree takes
`--paper` for its surface, `--paper-2` for its bar, and `.86` opacity on its
transcript. `paintChrome` sets `data-focused` where it already sets
`data-chrome`. The composer still takes the caret on focus, as today.

Applies identically in List, Folders, Board, and the Focus stage (§7.2).

### 5.2 Board uses the pane

`body[data-view=board][data-panel=open]` keeps its two-column grid, but the
pane column is the same rounded pane as List: `--pane-r` radius,
`--shadow`, a `1rem` gap, the dock bar with its close button. `.board-panel`
and `.panel-close` are removed from the template; `closeBoardPanel` is wired
to the bar's close. The pane tree, gutters, drag-to-edge, swap and the ghost
room all work in Board because nothing about them is view-specific — the
only Board-specific rule left is the grid column.

### 5.3 Three more ways to make a pane

- **Open beside.** `Alt`+click, or `Alt`+`Enter`, on a list row, board
  card, folder tab or Focus card opens it beside the focused pane, on the
  pane's longer side (`restingSide`). If no pane is open it simply opens.
- **Split.** Each `.dock-bar` gains two buttons, split right (`⊞` rotated)
  and split down, that insert an **empty pane** beside it. An empty pane is a
  leaf with `id: null`: it shows the pane hint and a composer. Starting a
  chat in it fills it; clicking a row while it is the focused pane fills it
  (`open()` already writes into the focused extra). `normalizeExtras`,
  `paintBar`, `rememberDock` and `savedToTree` accept a null id; an empty
  pane is not remembered across reloads.
- **Dock zone.** In Board with no pane open, dragging a card into the
  rightmost 12% of the board shows a dashed zone the width the pane will
  take; dropping there opens it. `resolveDrop` returns `{ mode: 'fill' }`
  for the zone; the zone is `.board-dockzone`, transient, drawn only during a
  drag.

Keyboard: no new global shortcuts. `V` is untouched.

## 6. The board stacks (§4)

A `ResizeObserver` on `.board` sets `data-stack` when
`board.clientWidth < 3 × MIN_COL + 2 × gap` (`MIN_COL` = 14rem). Stacked:

- `.board` is `flex-direction: column; overflow-y: auto`; each `.column` is
  `flex: none; min-height: 0; overflow: visible` and as tall as its cards;
  the `h2` stays sticky to the board.
- Column seams (`.rz-col`) hide.
- The pane, if open, keeps its column; on the phone breakpoint the existing
  sheet rules still win.

Cards changing column on a status event FLIP: `upsert` captures the rects of
the moving card's old and new columns before `place()` and plays the same
`playFlip` the view switch uses, 240ms, no stagger. The column visibly makes
room for the arrival.

## 7. Focus (§6, §7, §8)

### 7.1 Hover

`assignLods` no longer promotes `hoveredId`; the argument stays for API
compatibility and the template passes `null`. Hover is
`box-shadow: var(--shadow-lift)` and the actions row. **Selecting** a card
(click) promotes it to digest, as today. Pinning makes a pane (§7.2).

### 7.2 The stage is the pane tree

A pinned conversation is a pane, not a card with a hole in it.

- The `.focus-live` slot and the per-Full transient `<marble-conversation>`
  go away. `layoutFocusPane` places `.pane` over the stage rect as it does
  now (fixed, over the canvas), and inside it the dock tree lays the pinned
  conversations out — `dock.extras` are the pins beyond the primary,
  `dock.tree` is the arrangement.
- **Default arrangement** is side by side, left to right in stage rank
  (`focusY`), which is what the previous spec drew. `reconcileTree` produces
  it for a set of pins nobody has arranged.
- **Stacking.** Dropping a Focus card on the top or bottom band of a stage
  pane inserts it below or above (`insertBeside(side)`), with the ghost room
  preview. Left/right bands split beside. The gutters resize. The tree is
  remembered in `marble-agents:dock` keyed by view (`focus`), so Focus and
  List do not overwrite each other's arrangement.
- **Stage width** is negotiated by `packFocus` as before, with `n` = the
  number of leaf columns in the tree's widest row (from `layoutOf`: distinct
  x-ranges), not the number of pins. Two pins stacked vertically take one
  column's width.
- The stage's drop zone in `focusTargetAt` is the pane's rect; within it the
  answer comes from `resolveDrop` (which already knows edges, swap bands and
  the root band). `stageSlotAt` is kept for the empty-stage rail only.
- Unpinning closes the leaf (`closeSlot`). The primary is whichever pin is
  focused (`focusPrimaryId` ↔ `dock.focus`).

Drag of a stage pane by its bar into the field unpins it (today: drag the
Full card's header). The Full card element remains as the digest shown
while dragging and as the keyboard target; when not dragging it is hidden
under the pane.

### 7.3 Regions follow their content

`packFocus` changes shape. A region is `colW` wide and **as tall as its cards
plus name and pad**, capped at the canvas's inner height (a taller region
still wraps into a second sub-column, as today). Regions are then packed
**down a field column, then across**: catalog order, ungrouped last; a region
that does not fit under the previous one starts the next field column. The
canvas scrolls horizontally when the columns outrun it, as before.

Rank within a region is still `focusY`. Order between regions is catalog
order. The previous spec's "never a second row" rule is withdrawn: the
vertical axis now carries content *and* the next group, which is what the
person asked for.

`focusTargetAt` becomes two-dimensional: the zone is the region whose rect
contains the point (with the gap as tolerance), else the nearest region by
distance to its rect. `slotAt` is unchanged — it was already region-local.

Returned geometry: `regions[i]` gains `col` (which field column it landed
in); `rects`, `stage`, `newGroup`, `width`, `height` keep their meaning.

### 7.4 Drag polish

- **Size animates.** `animateFocusCard` compares the card's current size to
  the target; a change animates `width`/`height` with the Web Animations
  API, 280ms, `--ease-out`, while position springs as today. The body's
  content crossfades on a lod change (`.focus-card-body` opacity, 160ms).
- **Lift survives the spring.** The spring writes
  `transform: translate(…) scale(var(--lift, 1))`; `[data-lift="lead"]`
  sets `--lift: 1.02`.
- **Optimistic drop.** `commitFocusDrop` computes every patch and mutates
  the local summaries first, calls `paintFocus({ velocity })` immediately,
  then fires the PATCHes in parallel. The server's echo repaints without
  velocity, as today.
- **Slot hysteresis.** `aim()` remembers the boundary that produced the
  current slot; a new answer within 8px of it is ignored. The gap opens once
  per crossing, not on every pixel near a midline.
- **Auto-scroll** is unchanged.

## 8. Transitions (§1)

`setView` keeps its two paths and adds a third:

| switch | motion |
|---|---|
| List ↔ Board | same-node FLIP, unchanged (tests assert node identity) |
| reduced motion, phone | crossfade, unchanged |
| everything else | **morph**: shells crossfade as today; each conversation visible in both views gets a ghost |

The morph, `morphViews(current, next)`:

1. Before `applyLayout`, for every conversation visible in `current`, record
   `rect` and a shallow **clone** of its element (`.conv`, `.folder-tab` or
   `.focus-card` — the Full's live pane is not cloned, its digest is).
   Clones drop `data-marble-id`, `tabindex` and listeners, get
   `data-marble-transient`, `pointer-events: none`, `position: fixed`, and
   sit in a `.vt-layer` appended to `body` at `z-index: 5`.
2. `applyLayout()`.
3. For every id also visible in `next`: the ghost animates `left/top/width/
   height` to the new element's rect over 420ms `VT_EASE`, `overflow:
   hidden`, opacity `1 → 0` over the last 40%; the real element animates
   opacity `0 → 1` over the first 60%, with the 18ms stagger by
   `next`-order. Ids only in `current` leave with their shell; ids only in
   `next` fade in on the shell's schedule.
4. On finish or cancel the layer is removed. `cancelFlip` and `fadeGen`
   guard a switch during a switch, as they do for the FLIP.

Focus cards on entry have no `data-placed`, so `paintFocus` sets their
position without a spring and the ghost lands on a still target.

## 9. Files

| Unit | Change |
|---|---|
| `server/agent/store.js` | `done` in `REVIEWABLE`. |
| `runtime/agent-ui.js` | `stateOf`, `STATE_CSS`; `:host([data-focused])` dim/lit rules; empty-pane composer. |
| `runtime/agent-folders.js` | `assignLods` ignores hover; `packFocus` regions-by-content, packed down then across, `col` on regions; `regionAt(pack, point)`. |
| `templates/agents.mrbl` | `statusOf` + sort; `data-state` painting; shared attribute classes; board pane, dock zone, `data-stack`, column FLIP; open-beside, split buttons, empty panes; Focus stage as tree, `focusTargetAt` 2-D, hover, size animation, optimistic drop, hysteresis; `morphViews`. |
| `test/agent-folders.test.js` | Packer: regions sized to content, packed down then across, never overlap; `regionAt`. |
| `test/agent-store.test.js` (or nearest) | `done` needs review until reviewed. |
| `test-browser/agents-page.test.js` | Board: answered turn in Needs review; waiting sits in review, first; board pane is rounded with a bar; stacked board; column FLIP; open-beside; split → empty pane → fill. |
| `test-browser/agents-panes.test.js` | Dim/lit; empty pane remembered as not-remembered. |
| `test-browser/agents-focus.test.js` | Hover does not resize; pin makes a pane; drop on top band stacks; two folders sit one above the other; digest shows pills, chip shows dot. |
| `test-browser/agents-transitions.test.js` | New. List→Focus and Focus→Folders produce a ghost per shared id that ends on the new rect; a switch mid-switch leaves no layer behind. |
| `test-browser/shots.js` | `--stack` for the narrow board. |
| `drive/Agents.mrbl` | Replaced by hand after the browser tests pass, one write then verify. |

## 10. Build order

Each phase leaves every suite green and is committed on its own.

| Phase | Sections | Why this order |
|---|---|---|
| A | 3, 4 | Data vocabulary first; every later phase paints `data-state` and the shared classes. |
| B | 5, 6 | The pane tree becomes the one model before Focus adopts it. |
| C | 7.1, 7.4 | Hover and drag fixes are independent of the layout change and make D easier to see. |
| D | 7.2, 7.3 | The stage-as-tree and regions-by-content. |
| E | 8 | The morph reads final element shapes; it goes last. |

## 11. What we are not building

- A fourth board column. Waiting-on-you is a review state with a badge.
- Nested folders, LLM digests, pointer-fisheye — still out.
- A physics library or a container-query rewrite. `data-stack` is one
  observer.
- Persisting empty panes.
- Changing the drop rules table of the previous spec; every row still holds,
  the stage rows now resolve through the pane tree.
