# Focus — columns, and a drag you can trust

> Status: **approved to build**, 2026-09-18. Supersedes §5 of
> `2026-09-18-agents-four-views-design.md`, which shipped the partition but
> kept the band-over-band shape and a drag that could only file a coordinate.

Same UIST warm / Dusk tokens. No new npm dependencies. Node 22. Do not
reparent the file's `<marble-conversation>` (reconcile would clone it).

## 1. Why

`shots.js focus` against the ten-conversation drive, before this change:

- Every region is full height and every region's cards hug the top. Research
  fills 300px of an 810px box; Marble fills 430px of the same. The rest is
  dead space the eye still has to cross.
- Regions are different widths for no reason a reader can name — Research is
  two digests wide, Marble is one — because width fell out of a fair-share
  column solve rather than out of anything the content says.
- A chip is 168 wide inside a region whose digests are 260. Inside one box
  that is not a size class, it is a ragged edge.
- The rightmost 250px of a 1440 canvas is empty.
- With four pins the stage takes 52% of the height and each Full is a 700×220
  letterbox. **A conversation is a tall thing.** A transcript in a 220px band
  shows two turns.

The last one is the real fault and the rest follow from it. The old layout
spends the canvas's **height** on ranking — stage on top, field below, most
important highest — and height is the one axis a conversation needs for
itself. Ranking should be spent on the axis the content does not want.

> **Importance reads left to right. Content reads top to bottom.**

## 2. The shape

One row of full-height columns, left to right, no bands:

```
┌ stage ─────────────────────┬ field ───────────────────────────────┐
│ ┌──────────┐ ┌──────────┐  │ ┌ Research ─┐ ┌ Marble ─┐ ┌ loose ─┐ │
│ │          │ │          │  │ │ [digest]  │ │[digest] │ │[digest]│ │
│ │  pinned  │ │  pinned  │  │ │ [digest]  │ │[digest] │ │[chip]  │ │
│ │   Full   │ │   Full   │  │ │ [digest]  │ │[chip]   │ │[chip]  │ │
│ │          │ │          │  │ │ [chip]    │ │[chip]   │ │        │ │
│ └──────────┘ └──────────┘  │ └───────────┘ └─────────┘ └────────┘ │
└────────────────────────────┴──────────────────────────────────────┘
      each column is the full height of the canvas
```

- **Stage columns** — one per pinned Full, full height, leftmost is most
  important. Present only when something is pinned; with nothing pinned the
  field owns the canvas, exactly as today.
- **Field regions** — one column per folder in catalog order, ungrouped last.
  Cards **fill down, then wrap right** into a second sub-column of the same
  region. The old packer filled right and wrapped down; this is that packer
  transposed, which is the whole geometric content of the change.
- **Every field card spans its column's width.** A chip is a short row, a
  digest a tall one. Height is the size class; width is the column. That
  removes the ragged edge and makes a column a single target.
- Columns that exceed the canvas width **scroll horizontally**. A column is
  never shortened to fit, and the field never wraps to a second row — a
  second row would put ranking back on the vertical axis.

### 2.1 Width negotiation

Heights are settled first and are width-independent: a region's sub-column
count is `ceil` of its cards' stacked height over the canvas's inner height.
With `K` total sub-columns and `n` Fulls:

| | floor | preferred | ceiling |
|---|---|---|---|
| Full column | 300 | whatever is left after the field | 560 |
| field column | 196 | 260 | 320 |

The stage takes the room the field does not want, clamped to its own range;
the field's column width is then the remaining room shared by `K`, clamped to
its range. When a floor cannot be met the floor wins and the canvas scrolls —
never a 200px conversation.

### 2.2 What does not change

`assignLods` and the cooling budget, Quick Look, select, the springs, the
`data-stack` phone layout, and the digest's four lines. Sizes stay 132 and 56
tall. This section changes **where a card goes**, not what it is.

## 3. Rearranging

The partition buys one uniform gesture: **pick a card up, drop it in a slot.**
A slot is a position in a column, and every column is either the stage or a
folder. That single sentence has to cover every case below, or the view is a
demo.

| Drag | Drop | What it means |
|---|---|---|
| field card | between two stage columns | pin it, at that position |
| field card | onto a stage column | pin it, insert before or after |
| stage card | into a field column | unpin, join that folder there |
| stage card | another stage position | reorder the stage |
| field card | elsewhere in its own column | reorder inside the folder |
| field card | another folder's column | join that folder, at that index |
| field card | the ungrouped column | leave the folder |
| loose card | the **middle** of another loose card | make a folder of the two |
| any card | the trailing **New group** column | make a folder of it |
| n selected | any of the above | all of them move, in order |

Insertion, not swapping, is the general case — with two columns an insert
*is* a swap, and with three it is the thing a swap cannot express. The one
exception is the merge band: the middle 44% of a loose card's height makes a
folder, because two loose cards have no folder to insert into. The band is
lit before the release, so it never surprises.

### 3.1 What the person sees while dragging

Foresight, continuously, not a result at the end:

- The card **lifts** — scale, lifted shadow, `grabbing` — on the 10px that
  commits the drag, tracking the pointer 1:1 from the grab offset.
- The target column **lights** (`data-drop="into"` on its basin).
- An **insertion bar** draws at the exact slot, the column's inner width.
- The cards below the slot **open a real gap**, sprung, so the card has
  somewhere to land. Recomputed only when the slot changes, never per frame.
- A merge target gets a ring, and the bar does not draw — the two readings
  are never on screen together.
- A **New group** column appears at the right edge for the length of the
  drag. Making a folder is otherwise undiscoverable.
- The live pane hides for the length of the drag and the dragged Full shows
  its digest. A `position: fixed` iframe-alike cannot chase a spring, and a
  placeholder that says what the card *is* beats one that stutters.
- Near an edge of a scrollable canvas the canvas **scrolls**, proportional to
  how deep in the margin the pointer is.
- `Escape` cancels: the card springs back to the slot it came from and
  nothing is filed.

On release the card springs to its slot carrying the pointer's velocity
(response 0.4, damping 1.0 — Apple's reposition pair), and exactly one PATCH
per changed fact is filed.

### 3.2 Order is a rank, and a rank is one PATCH

The store clamps `focusX` / `focusY` to `[0,1]`, so a rank is a fraction, not
an index: a card dropped between two others takes the **midpoint** of its
neighbours' ranks, and that is one write. Renumbering the column `(i+1)/(n+1)`
happens only when there is no midpoint to take — the first rearrangement of a
column, where nobody is numbered yet, and the rare case where 1e-4 of
precision has been used up. Unranked cards sort last, so a conversation that
starts while you are working joins the bottom of the loose column and moves
nothing.

`focusY` is read as **"my rank in my column"**. On the stage the column runs
left to right, so `focusY` is what orders the panes. One field, one meaning,
no store migration.

`focusX` is no longer written. Existing values are still read as a tiebreak.

### 3.3 Reach

- `Alt` + `←` / `→` moves the **card** across columns — out of the stage,
  between folders, into the loose column — and `Alt` + `↑` / `↓` moves it
  within its column. Arrows alone still move the selection.
- The same drop rules run for both, so the keyboard cannot reach a state the
  pointer cannot.
- `.focus-card` keeps `touch-action: none` on the canvas, where dragging is
  the point; in `data-stack` it goes back to `auto`, because a list you
  cannot scroll with a finger is a list you cannot read. That was a bug.

## 4. Where it lands

| File | Change |
|---|---|
| `runtime/agent-folders.js` | `packRegions` → `packFocus`: stage columns, transposed field, width negotiation, returned slot geometry. New pure `slotAt`, `stageSlotAt`, `rankFor`, `ranks`. |
| `templates/agents.mrbl` | Focus layout call site, the drag controller, insertion bar, New-group column, keyboard moves, the CSS for all of it. |
| `drive/Agents.mrbl` | The same, mirrored — it is the live copy. |
| `test/agent-folders.test.js` | Packer tests rewritten for columns; rank tests added. |
| `test-browser/agents-focus.test.js` | Drag cases: reorder, join, unpin, pin-by-drag, new group, cancel. |
| `test-browser/shots.js` | `--pin N` so the stage can be seen. |

## 5. Risks

- **A wide drive scrolls horizontally.** Six folders at 296 plus two Fulls is
  ~2000px. Accepted: scrolling to reach the sixth folder is better than
  reading a conversation through a letterbox, and the alternative — wrapping —
  is the fault this spec exists to fix.
- **Renumbering warms a column.** `updateConversation` stamps
  `lastInteractedAt` on any interaction field, so a first rearrangement holds
  that column's cards at digest for the cooling window. Judged correct: you
  just handled them.
