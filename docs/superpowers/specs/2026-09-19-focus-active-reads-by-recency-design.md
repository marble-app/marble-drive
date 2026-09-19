# Focus — Active is a recency order, not just a stage

> Status: **built** 2026-09-19 on main. Decided autonomously (Bryan's standing
> instruction) and recorded here. Extends
> `2026-09-18-focus-balance-and-modes-design.md` §7 and
> `2026-09-19-focus-priority-reads-rightward-design.md`. No new tokens, no new
> dependencies.

## 0. The ask, verbatim

"In the focus view, we have pinned active, group. Update the Active view. It
prioritizes the active to focus. I also want this view to also
deprioritize/order the cards based on latest it was changed. That means if
there are no active, then we will simply see all the cards, but then ordered by
latest completed. That also means that the latest completed will always be
sorted to the top within the group as well."

## 1. The decision

**Active is one order, all the way down: what is live is on the stage, and
everything else is ranked by when it last changed.** The mode already answered
"what is happening now" for the stage; it answered nothing for the field, which
kept the arranged order and so buried the chat that had just finished among
chats from yesterday. Now the whole canvas is one gradient in time.

Three consequences, each a change:

1. **Nothing active stages nothing.** The old rule drafted the most recent chat
   onto the stage "so the pane is never blank". That is the page choosing what
   you are working on — and it hid the answer the mode already gives when the
   work is finished: the whole canvas, every card, newest first. An empty stage
   is a state Focus already supports (it is what Pinned with no pins looks
   like); the pin rail still stands at the right edge for a drag.
2. **The field is ranked by recency under Active, not by hand.** `focusY` — the
   rank a drag files — is ignored while the lens is on. A drag inside the field
   still files a rank and it still means something the moment you leave the
   mode; what it cannot do is outrank recency inside a lens whose whole claim is
   that it orders itself.
3. **A lens with an empty stage dims nothing.** Chips at opacity .55 say "the
   stage is the lit thing". With no stage there is no off-the-stage, so the
   force-to-chip pass and the dimming rule both wait for a stage to exist.

What does **not** change: the stage's own order (`orderStageByDock` — a pane
dragged left stays left), Pinned and Group, the φ split, the packer, and the
fact that a mode writes nothing to the store. Leaving Active restores the
arrangement exactly, because nothing about it was overwritten.

**Recency is `recencyOf` — `max(lastInteractedAt, updatedAt)` — not
`updatedAt`.** "Latest completed" is the last time the chat did anything or was
touched; the stage sort was on bare `updatedAt` and is now on the same key as
everything else, so the stage and the field cannot disagree about which of two
chats is newer.

## 1a. The stage is a generation, not a live query (second ask, same day)

**Ask, verbatim.** "One fix in the Active. If an agent is done, and I click into
the chat, the chat instantly relegates away. Can we not do that? Do not
relegate when i check focus in different chats. Only relegate when i introduce
another chat into the focus view."

The bug is the seam between two rules that are each right on their own.
*Reading a finished turn is reviewing it* (`markSeen` on pane focus, see
`2026-09-18-focus-gradual-attention-design.md`), and `isActiveChat` counts
*Needs review* as active. So clicking into a finished chat cleared the one flag
keeping it on the stage, and the pane closed under the click. Worse, it did not
even need a click: a chat that finished in the pane you were already focused in
was marked seen by that same rule and vanished the moment it was done.

**Decision: under Active the stage is a generation of work.** It holds
everything that has been active since the last time new work arrived, and a
chat *entering* the active set is the only thing that starts the next
generation. Your own attention never relegates anything.

- `activeLive` is the live set at the last settle; `activeHeld` is what is
  staged but no longer live. `settleActiveStage(items)` runs once per paint,
  before anything asks what the stage holds: an id in `live` that was not in
  `activeLive` is an arrival, and an arrival empties `activeHeld`; then
  everything that dropped out of `activeLive` joins it. Held ids that go live
  again, or are archived, leave. A search filter hiding a chat does not — clear
  the filter and the stage is whole.
- `stageIdsFor` stages `isActiveChat(item) || activeHeld.has(item.id)`, still
  newest first.
- Nothing is stored. Leaving Active forgets the generation, the same way the
  mode forgets everything else.

**Considered and rejected: exempting the pane you are sitting in from the
sweep.** It protects a read in progress, but it contradicts the ask in the
literal case — start a new chat while reading a finished one and the finished
one would stay — and it makes the stage a place things can never leave. An
arrival is the person's own act; the sweep that follows is legible.

**Consequence for §1.1.** "Nothing active stages nothing" still describes
*entering* Active, and what the canvas comes back to once a generation is
swept. What it no longer means is that a finishing chat empties the stage
behind itself.

Test: "Active holds a chat you are reading, and relegates it only when new work
arrives" — a chat runs, finishes, has its bar clicked (Needs review clears),
and is still the stage two quiet repaints later; answering a second chat takes
the stage alone and drops the first into the field.

## 2. Where it is

All in `templates/agents.mrbl`; `drive/Agents.mrbl` took the same four
exact-string substitutions in one write (§4).

- `stageIdsFor`, `mode === 'active'`: filter `isActiveChat` or `activeHeld`,
  sort by `recencyOf` descending, return it — no fallback branch.
- `settleActiveStage`, `activeHeld`, `activeLive`: the generation (§1a),
  settled once per paint from `paintFocus`.
- `focusColumnsOf`: `const byRecency = effectiveFocusMode() === 'active'`, read
  by the `order` helper that every field column (and the loose one) is sorted
  through. Under Active it sorts `recencyOf(b) - recencyOf(a)`; otherwise it is
  the rank sort, unchanged. The pre-sort by `createdAt` stays as the stable tie
  break — chats filed into a folder in one write share a millisecond, and the
  order they were made in is the only thing left to say.
- `paintFocus`: sets `focusEl.dataset.staged` to `'true'`/`'false'` each paint,
  and the force-to-chip pass is now `mode !== 'pinned' && fullIds.length`.
- CSS: both dimming rules gain `[data-staged="true"]`.

Downstream nothing else needed touching — the phone's `phoneStackOrder` reads
`focusColumnsOf`, and the packer takes the column order as `oy: index`.

## 3. Tests

`test-browser/agents-focus-modes.test.js`:

- "Active with nothing active stages nothing and lights every card" (was
  "…stages the most recent chat"): the stage is empty, `data-staged` is
  `false`, no card is a chip, every card is at full opacity, and three touched
  chats read newest first.
- New: "Active ranks every column by recency, newest at the top" — a three-chat
  group written oldest to newest reads m1, m2, m3 top to bottom, and touching
  m3 lifts it to the top of its own column with nobody dragging it.

- New: "Active holds a chat you are reading, and relegates it only when new
  work arrives" (§1a).

A test that means to read an order has to write it on purpose, with a gap:
`createFolder` stamps every member's `updatedAt` in one write, and the store's
timestamps are milliseconds.

Green after both passes: focus-modes (9), focus (27), focus-groups,
focus-close (3), focus-piles, focus-seen, focus-new-chat, and
`test/agent-folders.test.js` (38).

## 4. Live doc

CSS and JS only, no `__ID__` markup, so `drive/Agents.mrbl` took the same four
substitutions as the template in one write, verified by landmark count
(`byRecency`, `data-staged`) and `check_document` (no errors; the ten standing
warnings are unrelated and pre-existing). A tab already open on Agents needs a
reload to run the new script.
