# v5: self-modifying interfaces — build decisions

The spec is the drive document **Notes and Sketches/Ask at Anything**, section
v5 (`z995hbxn`). Read it there; the frames are the design. This file records
what the build decided where the spec leaves a question open, what it builds
in this pass, and what it leaves for later and why.

**Built**, Tasks 1–9, `origin/main..HEAD` (`fd2767e..c5f68fe` for the feature
itself; Task 9 — this file's own update, the guide and the docs — follows on
top). Every "Built in this pass" item below shipped; see "Rulings made during
the build" for where an implementer resolved something this file left open or
found the spec ambiguous on, while building it.

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
   menu, and it survives a reload (the server keeps each turn's parts). Turns
   that changed the same thing (one's part is, holds, or sits inside the
   other's, or they share a close-enough parent) draw and undo together as
   one bar — "· 2 asks" (R23, R26).
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
   one rule — or, for a part no rule could reach (its own style attribute, an
   id rule), inline styles on the parts instead, filed as the same one undo
   (R31). ⇧ while grabbing changes only that one.
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

## Rulings made during the build

In commit order, the full ledger is `.superpowers/sdd/2026-10-03-v5-self-modifying/progress.md`. One line each:

- Ruling R1: redo writes use client `agent-undo:<conversationId>` (like undo) — a redo is a retraction of a retraction; it must neither fork against the turn's own ids nor be noted in sessionTouched — if wrong: a redo could fork against a person's concurrent edit instead of being skipped by the hash guard, which the guard already prevents.
- Ruling R2: when `marbleText.claims(client)` is true, change-marks draws nothing for that run (no tints, no tag); agent-text's caret tag ("Typing n of m words") is the run's tag — one tag per change, as the spec says — if wrong: a single-block word edit shows no meter/status card, only the caret's count.
- Ruling R3: redo does not clear keptAt — a kept turn has been reviewed; putting it back after an undo is deliberate and need not be reviewed again — if wrong: a redone kept change is not drawn on rest (still in history/chat).
- Ruling R4: turns that changed a document only by whole-file restore (agent file tools) have no per-part steps, so they are not listed for review and have no redo; the page hides Redo when the redo route 409s — if wrong: such turns can only be undone from the chat.
- Ruling R5: /agent/review scans conversations per call (no index); the page calls it on boot and on turn end only, never polls — if wrong: slow lists on a drive with thousands of conversations.
- Ruling R6 (supersedes part of R2): agent-text claims a run only while the turn has touched one part (frame.count ≤ 1, or no count); from the second part on change-marks owns the run (tints + counting tag) and agent-text releases its claim — the spec's replay counts many single-row batches as one change — if wrong: a multi-part word edit shows tints and the engine's word reveal instead of the v3 caret.
- Ruling R7: fix partsOf's inserted-row parsing and clear agent-undo presence after an undo in Task 3's fix round (same implementer), since Task 3's page depends on both — if wrong: none (they are bugs).
- Ruling R8: fold reviewer Minors 1 (end frame dropped when attendance lapses), 2 (undo run can stick), 4 (collab skips agent-undo zones even where change-marks does not boot), 7 (status card divider uses accent on one side) into fix round 1 — later tasks (review on end, undo playback) build on them — if wrong: a slightly larger fix diff.
- Ruling R9: accept R6 widening — agent-text also steps aside when a frame's total > 1 or reach has > 1 id — a change that announces several parts is a counted change from its first part — if wrong: a declared multi-part word edit never shows the v3 caret on its first part.
- Ruling R10: accept greedy batches + bounded reorder for spread, seeded test — the spec's "spread across the page" is the goal; greedy alone fails it — if wrong: none visible.
- Ruling R11: accept change-marks additions (run end does not land a moving batch; 300 ms lift floor; engine infers arrivals/removals for undo frames; hand rule scope) — they make undo animate and over-budget batches visible — if wrong: tints linger ≤300 ms longer.
- Ruling R12: the callout undo test flake (removal ops land before change-marks' first paint, so the removed row is never tinted) is a real timing gap, not test noise; it enters Task 4's fix loop — if wrong: one extra fix item.
- Ruling R13: a collapsed selection outside editable content does not hold elements (supersedes the brief's literal "selection's anchor" for clicks in plain text) — otherwise any click freezes that paragraph's ancestors from every later motion — if wrong: an element a person clicked into (non-editable) may animate under their pointer.
- Ruling R14: fold reviewer Minors 2 (opacity 0 ghost flashes at 1), 3 (onPart start after end), 4 (drag/focus starting mid-motion is not exempted), 6 (unchanged trailing words hidden before writing) into fix round 1 — visible glitches later tasks would inherit — if wrong: a larger fix diff.
- Ruling R15: several parts read "Change these N <unit>" when they share a unit, else "these N parts" — plainer than the brief's verbatim — if wrong: placeholder wording.
- Ruling R16: when the line speaks for a turn (answer / cant / ask), change-marks shows no end tag for that run ("Nothing changed" would say it twice and hangs over the row above) — enters Task 5's fix loop — if wrong: no end words for an empty run started from the line.
- Ruling R17: a prompt is a question only if it ends with "?" or starts with a wh-word (what/why/how/when/who/which/where); is/are/can/do… no longer count — "Do the same…" and "Can you shorten…" are requests — if wrong: a yes/no question without "?" that changes nothing opens as cant (words back + the reply), still readable.
- Ruling R18: fold reviewer Minors 4 (line blocks ⇧-click pick under it), 5 (Esc before turn.started does nothing — queue the cancel), 6 (Ask-more/ask words lost on Esc), 7 ("Agents" in send-failure text), 9 (hardcode the mandated curves), 10 (share unitOf with change-marks), 12 (marble-line:closed after a sent line folds) + R16 into fix round 1 — person-visible — if wrong: larger diff.
- Ruling R19: keys go back where they were after ⏎ except into the part being changed (a caret there would hold the change off it) — if wrong: after ⏎ focus lands on body instead of the paragraph being rewritten.
- Ruling R20: the host must publish the conversation summary again after the turn record is final (finish() writes status after the end frame and summary), so /agent/review never misses a just-finished turn; the page's bounded re-asks stay only as a fallback — enters Task 6's fix loop — if wrong: none.
- Ruling R21: the held "Before" copy and the old-outline measuring clone go in the document beside the original (data-marble-transient, ids stripped, inert), not in the layer, so ancestor-dependent CSS still applies — enters Task 6's fix loop — if wrong: a transient sibling briefly in the document tree.
- Ruling R22: accept the tag straddling a bordered block's top edge, and bars flipping above when below would cover another change in Show what changed — if wrong: placement.
- Ruling R23 (grouping): turns join one group only when they changed the same thing — a part of one is, contains, or is inside a part of the other; or their parts' common parent block (the common ancestor of the parts' parents) is the same element. Mere containment of high blocks never groups. A turn's parts are always drawn together wherever you rest on any of them, and Undo in a group undoes the newest turn of that group — if wrong: two asks on neighbouring blocks show as two bars instead of one "· 2 asks".
- Ruling R24: fold Minors (load() returning stale in-flight data; ⌘Z repeat falling through to the person's undo; overlapping undos; ⌘Z compares listing time not finishedAt; Before restore safety net on blur/pagehide/visibilitychange; rest drawing while typing; clearHistory after an external write counted as the person; live custom elements in copies) into fix round 1 with R20/R21 — they decide whether Undo/⌘Z hit the right thing — if wrong: larger diff.
- Ruling R25: accept Tab order tag → Change more → Keep → Undo; a part found one level up (row/card) for rest; ⇧⌘Z refusal with nothing drawn announced via live region only; Before copy as next sibling (nth-child/+ rules may shift while held) — if wrong: minor visual shift while holding Before.
- Ruling R26 (refines R23): two turns also group when one's parent block is the other's parent block's parent (one level of containment — a list and one of its rows); deeper containment never groups — the spec's "one change since you last kept" on one list — if wrong: a list-level and a row-level ask in nested lists may group.
- Ruling R27: ⌘Z (and ⇧⌘Z) of a rule commit must play through the engine (spec: "⌘Z plays the same motion backwards") — enters Task 7's fix loop — if wrong: none.
- Ruling R28: turning Reshape on from the tray row returns focus to the page so Esc leaves Reshape — enters the fix loop — if wrong: none.
- Ruling R29: accept unitOf class nouns (div.card → "card") everywhere — if wrong: a class named like a noun mislabels a part.
- Ruling R30: fold Minors 1 (drag captures another drag's overrides), 2 (chrome guard always), 3 (Reshape row hidden on touch), 4 (keyboard-only grips on cards with nothing focusable), 5 (dead rule → fall back to agent), 6 (verb whitelist; no "Thinking"), 8 (draft kept until commit/fallback), 9 (route: abort on disconnect, concurrency cap), 10 (presses on likes after commit swallowed), 12 (lexicon plurals/comparatives; shorter wait) + R27 + R28 into fix round 1 — person-visible or filing junk — if wrong: larger diff.
- Ruling R31: a drag no rule would reach lands as inline styles on the parts (no rule filed) rather than failing; words still fall back to the agent — failing would undo every ⇧-drag on a part with its own inline style — if wrong: some drags file inline styles instead of a rule.
- Ruling R32: accept subtreesOf (one parse) for worker markup; workers' edits not added to the agent's read ledger (the agent re-reads once — correct staleness); extra guards (no scripts/iframes/on*/javascript:, overlapping/unknown shard ids refused); presence `groups` field; no overall cap (worst ~245 s < bridge 300 s) — if wrong: an 8-shard fan-out can take 4 min.
- Ruling R33: a failed group that later lands through apply_ops is no longer counted failed (tag and end text) — enters Task 8's fix loop — if wrong: none.
- Ruling R34: fold Minors 1 (script guard as a parsed attribute walk), 2 (check abort inside prepare), 3 (group counts per fan_out call), 4 (deleted part reads "changed while it worked"), and workers run with --strict-mcp-config (no MCP servers attach) + R33 into fix round 1 — security/truthfulness — if wrong: larger diff.
- Ruling R35: accept guardOps dry check inside the shared batch (apply_ops refusals now come back as `refused` with nothing counted instead of a thrown error after counting) and the planned.html hand-off in applyOps — if wrong: a core write-path change; re-review on the strongest model.
- Ruling R36: Reshape is a menu row on hover devices only (`always: true`); on touch the tray keeps its v4 design (only contextual tools stand), so Reshape by hand is not offered on phones — reverses the Task 7 touch change and its test; phones can still ask in words — if wrong: phone/iPad users cannot reshape by hand.
- Ruling R37: the reach/total/fan_out guidance lives in server/agent/instructions.js (always loaded) and the drive's growing-the-open-page skill; the marble package's read_guide text is not changed in this ship (it needs an npm publish of @bdhmin/marble) — if wrong: an agent reading only read_guide misses reach/total/fan_out.
- Ruling R38: the fork-conflict picker (collab.js ~:514, "You and the agent both changed this" / "Agent") is a surface on the page; it names the versions without "agent" ("This changed while you were editing it" / "Yours" / "The new one") — global constraint — if wrong: wording.
- Ruling R40: the final fix wave runs as two sequential fix dispatches (server, then runtime) instead of one — the list spans two halves of a 1 MB diff — if wrong: an extra dispatch.
- Ruling R41: share-link visitors never receive `prompt` (owner pages keep the status card's prompt) — privacy — if wrong: none.
- Ruling R42: ⌘Z takes back an agent change only if it ended while this tab was open, or its drawing is up now; otherwise ⌘Z belongs to the document — a reload must not make ⌘Z reach back days — if wrong: after a reload ⌘Z needs a rest on the change first.
- Ruling R43: with nothing set up to make changes, the line says so before folding ("Changes need setting up first." with a "Set up" button opening setup), never names an agent; host error text never reaches the line ("Didn't finish. Try again.") — if wrong: wording.
- Ruling R44: ⌘J with nothing under the pointer on the Drive page opens the chat as before (the page line is for documents) — if wrong: none.
- Ruling R45: accept readiness = any provider installed and signed in (out-of-quota still sends); withProp writes the browser's normalised style text; ghosts show an input's default value; the idle fallback asks the host every 2 min while a turn is silent — if wrong: minor.
- Ruling R46: P5's timeout case is load-bearing (sprites sleep and wake often): a provider whose detection timed out counts as unknown (send goes ahead) — smallest change, one tiny dispatch + test — if wrong: none.
