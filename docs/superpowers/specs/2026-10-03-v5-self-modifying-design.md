# v5: self-modifying interfaces — build decisions

The spec is the drive document **Notes and Sketches/Ask at Anything**, section
v5 (`z995hbxn`). Read it there; the frames are the design. This file records
what the build decided where the spec leaves a question open, what it builds
in this pass, and what it leaves for later and why.

## What v5 is

The interface is the thing that changes, in place, while you watch. No agent
names, bubbles or "thinking" on the page. A change is marked before it moves,
moves in loose batches ("scales, not a queue"), lands as one undo, and leaves
nothing behind but the new page. What changed is drawn only when you ask for it
(rest on it, focus it, or Show what changed), with Keep, Undo and Change more.

## Built in this pass (by the spec's phases)

1. **Flush, then on request.** ⌘J opens one line flush under the thing (or at
   the foot of the window for the page). ⏎ folds it in; the tint and a counting
   tag are all that show while it runs. Questions, answers and "nothing changed"
   come back in the line. No card, no trail. After a change: rest/focus draws it,
   with Keep, Undo (hold: all since Keep), Change more, hold the tag for Before,
   Redo while you are there, ⌘Z/⇧⌘Z, "Show what changed" in the chat button's
   menu, and it survives a reload (the server keeps each turn's parts).
2. **Part by part.** Each part an edit touches is tinted (light ahead, deeper
   with an accent hairline while it lands, lifting over 900 ms after). One tag
   per change counts in the parts' own unit, with a meter when the total is
   known, step tiles from "Stage n of m" notes, the time, and a status card on
   rest. A rail at the window's edge for parts out of view; past 12 parts, dots
   in the margin instead of tints. The box stays only where nothing is on the
   page to mark. The server reports the finest ids, the step, a count for the
   turn, and an optional reach and total (`apply_ops` takes `reach` and `total`).
3. **Find, mark, commit.** Style changes become one rule: found on the page,
   marked at once, committed as one op with one undo, played by the engine.
   Reached by a hand (Reshape) or by a few words in the line that a small model
   turns into a rule; anything it cannot turn into a rule goes to the agent.
4. **The transition engine.** End states in, motion out: numbers in a style,
   colours (interpolated in OKLCH), position/size/order (measured, played
   back), words (written in, old ones faded first), parts added (rise 3 px from
   .98) and removed (ghost fades, neighbours close the gap), crossfade for the
   rest; batches of 2–6, ~60 ms apart with ≤30 ms jitter, spread across the
   page, all started within 600 ms, each 380–460 ms; reduced motion is one
   150 ms crossfade.
5. **Grab one, all like it follow.** Reshape: a corner grip and a padding grip
   on the part under the pointer; every part like it is marked; a press on a
   mark leaves it out; dragging moves them all one to one; letting go commits
   one rule. ⇧ while grabbing changes only that one.
6. **Fan out.** `fan_out` tool: a plan and shards of ids; one worker per shard
   in parallel (the login's CLI, no tools); edits are staged, checked against the
   shard and the page, then streamed into the page as each worker returns; a
   failed shard keeps its marks and says so; the rest lands.
7. **No agent on the page.** No "Agent ·" anywhere a change happens: the box
   label, the caret's tag and the line all speak in what is changing.

## Defaults for the spec's open questions

| Question | Default in this build | Why |
|---|---|---|
| Which parts are all like it? | Same tag and the same set of classes (page-only `marble-*` classes ignored); a part with no class: same tag under parents with the same signature. ⇧ = only this one. | Predictable, visible before it moves, and the marks show the set so a wrong guess is seen and a press leaves a part out. |
| Where words live | The line. An answer longer than ~6 lines scrolls in the line and offers Open in chat. | One place for words; the chat stays a ⌘⇧J away. |
| Big changes | Stay a conversation; the page still marks parts and counts. | The marks scale; the line is for asks. |
| Your hand on the same thing | A part with your caret or focus in it is not tinted, not animated and not drawn for review while you are in it. | Same rule as v3's caret. |
| Kinds the page cannot tell apart | `data-marble-kind` names a kind for the tag's unit ("charts"). | One attribute is enough to count in the right noun. |
| One from each layer | Not decided by this build: the tint + counting tag is the one vocabulary; per-kind tools (cell cursor, marquee, playhead…) are not built. | The owner has not picked; the tint covers every kind. |
| Edits that land every second | Each batch is marked as it lands; the engine's batching smooths the rhythm. | Keeps pace without hiding work. |
| A change you are not following | Stays a dot (only with Show agent dots on). | Unchanged from v4. |
| How long a rest | 500 ms; focus draws at once. | The frames' value; focus is deliberate. |
| When a change stops waiting | Until Keep or Undo, or until you edit the part (then that part is yours). No timer. | Nothing is kept without a word. |
| Undo for two asks | Press Undo: the last ask. Hold Undo (600 ms, with a fill and a tip "Hold to undo all 2"): everything since Keep. | Matches the frames; the tip makes the hold findable. |
| An answer longer than the line | The line grows to six lines and scrolls, with Open in chat. | No second surface. |

## Not built in this pass

- Per-kind tools from "Marks, kind by kind" (cell cursor, list landing line,
  lifted board card, marquee, pen, handles, chart cap, route, calendar block,
  playhead, form ring, gutter marks, page bracket) and the "Building, beyond the
  box" / "Writing code" / "Diagrams" / research stills: they are explorations
  the owner has not chosen between (open question "One from each layer").
- Scrubbing or slow replay of a change ("You can watch it again"): holding the
  tag shows Before, and Undo/Redo play the change both ways.
- Blueprint outlines for a new section before its content exists: ops arrive
  with their content, so there is nothing to outline ahead of them.
