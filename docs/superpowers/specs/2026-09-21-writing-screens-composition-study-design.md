# Writing screens: evaluating the GenUI grammar by composing real interfaces

**Status:** first loop (rounds 1–5) done 2026-09-21; procedure revised and second loop
(rounds 6–10) done 2026-09-22. Report: `drive/Research/Design Pattern Generation/Writing Screens.mrbl`.
(Everything under `drive/` is gitignored; this file is the tracked record.)

## Why

Stages 3–4 of the Design Pattern Generation method coded all 118 design spaces with
three model raters and reported κ. That measures whether a **dimension** asks one
question. The five worked composition specs written at the end of that study exposed
something the coding could not: the grammar that composes design spaces into a screen
had exactly one relation — `compose`, meaning containment — and four of the five
screens needed something else.

So: make composing screens the instrument. Freeze the grammar, write eight real
interfaces in it, make each screen declare what it must be able to state, and count
what has no construct.

## The loop (run five times)

1. **Hold.** The grammar is frozen for the round.
2. **Write.** Eight named products, chosen to be unlike the last eight.
3. **Claim.** Each screen lists the things it must be able to state, each naming the
   construct that states it (`rel:alternative:photos`, `mall:library.Content`,
   `param:clock.session`, …).
4. **Check.** `tools/grammar-check.mjs` resolves all of it. A claim with no construct
   is a hole; a hole needs ≥2 sightings before it earns a construct.
5. **Fill.** The next version answers the holes, and the screens that opened them are
   migrated to use it and must still check (`since: 'vN'` on the claim, which the
   checker verifies against that version's `introduces` list).

## Result

40 screens, 275 claims, 29 holes, v1 → v6 (5 constructs → 52, 1 relation → 14).
25 holes filled, 4 left open, 7 codebook variation proposals, 3 refusals argued.

| Round | Grammar | Writable at the time | Holes found |
|---|---|---|---|
| 1 ordinary software | v2 | 31/55 (56%) | conditional, states, lifetime, scoped, audience, anchor, freshness, flow |
| 2 an unusual reader | v3 | 34/52 (65%) | address, modality, viewer, authority, order, session, dependency |
| 3 domains with rules | v4 | 41/57 (72%) | params, format, interruption, required, derive |
| 4 not one screen | v5 | 36/49 (73%) | surface, foreign, counterpart, adaptation, provenance |
| 5 the edges | v6 | 53/62 (85%) | actuation, words, history, vocabulary — **left open** |

## Files

- `genui/grammar/v1–v6.schema.json` — authored, versioned, each with `introduces`.
  `tools/build.mjs` now **copies the newest to `genui/grammar.schema.json`** and
  regenerates `genui/prompt.md` from it; it used to write a v1 schema inline on every
  build, which would have silently undone all five revisions.
- `genui/rounds/round1–5.mjs` — the screens, claims, holes, fills and proposals.
- `tools/grammar-check.mjs` — a small JSON Schema subset (so the published schema
  really is what examples are checked against, with no dependency), plus corpus
  resolution, relation requires/allows rules, claim-pointer resolution, and the
  `since`/`introduces` consistency check. Also validates `genui/examples/*.json`.
- `tools/grammar-report.mjs` — → `Writing Screens.mrbl`. Wires are drawn from each
  screen's own instances, so a picture cannot show a box the spec lacks.
- `tools/vocab.mjs` — authoring aid: a pattern's subs, arities and variation names.
- `method.json` gained stage 10, *Compose real screens, and count what cannot be said*
  (evaluate moved to 11); the Atlas's Grammar view was rewritten for v6.

## Traps found

- **`build.mjs` regenerated the grammar.** Any `node tools/build.mjs` would have
  reverted v6 → v1. Check what a build *writes* before authoring anything it writes.
- **`.map(holeBlock)` passes the index** as the second argument — it became the id
  prefix and produced `0-conditional`. Doctor-clean by luck, not by design.
- **Same-rect boxes hide each other's labels.** Draw all rects, then all labels, and
  step colliding labels by a whole label-height.
- **Two real drift errors were caught by the checker**, which is the point: a
  `checkout` variation used on a `form`, and a relation kind (`standsIn`) that existed
  only in my head — `states.standsIn` is a field, not a relation.

## What is left

The four open holes are v7's brief: **actuation** (a binding that acts on the world and
can fail halfway), **words** (nothing in 52 constructs holds a sentence), **history**
(a screen has no past: no undo scope, no replay), **vocabulary** (every enum is closed,
which is the failure the atlas exists to prevent, reproduced inside the grammar that
reads it). The honest next step for the method itself is IRR on the claims: two more
people write claims for the same forty screens without seeing these.


---

## The second loop (2026-09-22): reflect, revise, run five more

### What the first five rounds measured badly

Measured before round 6, with the checker extended to report it:

| Fault | Evidence from rounds 1–5 |
|---|---|
| Screens chosen by taste | 38 of 103 atlas entries never composed (every navigation component, most enter-data components, timeline editor, stories, pivot) |
| Claims had no rubric | rounds 1–4 probed 7, 8, 9, 9 of 12 facets; *world*, *words*, *past* never asked about until round 5 — and round 5's holes were exactly those |
| "Writable" = "a pointer resolved" | share of written claims carried by a free string rose 8% → 16% → 26% → 37% → 35%: the grammar was filling holes with sentences |
| Instances could hang loose | 11 of 182 instances touched by no relation |
| Closed enums | found as a hole in round 5, but a procedural fault: the loop could not admit a barcode scanner without a grammar version |

### Procedure 2 (rounds 6–10, `procedure: 2` in the round file), all enforced by `tools/grammar-check.mjs`

1. **Facets.** Each claim carries one of twelve (structure, data, condition, state, reader,
   time, authority, failure, world, words, past, boundary), inferred from the pointer kind
   (`facetOf`) or declared with `facet:`. A screen must probe ≥ 6, a round all 12.
   The inference runs on rounds 1–5 too, so the facet grid is comparable.
2. **Carriers.** Every resolved claim is classified from the *schema* (`carrierOf`):
   structured (enum, `x-vocab`, number, boolean, id, `$ref`), prose (free string), or
   "id" (the pointer only asserts a construct exists). Reported per round; tagged per claim.
3. **Orphans.** An instance no relation touches is an error under procedure 2.
4. **Coverage.** A round must instance ≥ 4 atlas entries no earlier screen used, until none
   are left (`min(4, remaining)`). Coverage went 65 → 93 → 98 → 102 → 103 → 103.
5. **Open vocabularies.** v7 turned nine enums into `vocabularies` (`x-vocab` in the
   schema); a round extends one with `vocabulary: [{ vocab, add, seenIn, why }]`.
   Six extensions over rounds 5–9, no grammar version needed.

Unchanged: freeze for a round; two sightings before a construct; fill in the next version
with `introduces`; migrate with `since`. New discipline for fills: put the meaning in an
enum, a quantity or an id and keep the sentence beside it (v8's `rule.kind`, v9's
`floor.given`, v11's `authority.ask`).

### Result of rounds 6–10

| Round | Theme | Grammar | Claims | Writable at the time | Holes → filled by |
|---|---|---|---|---|---|
| 6 | the data has rules | v7 | 87 | 69 (79%) | rule, transfer, join, contention → v8 |
| 7 | several people at once | v8 | 97 | 74 (76%) | propagation, floor, group → v9 |
| 8 | the app, not the screen | v9 | 100 | 82 (82%) | app, consent → v10 |
| 9 | the machine acts | v10 | 101 | 85 (84%) | autonomy, rehearsal → v11 |
| 10 | interfaces that were generated | v11 | 98 | 78 (80%) | choice, stability, reflexivity — **open** |

Totals: 80 screens, 758 claims, 43 holes (40 filled, 3 open), v1 → v11 (5 → 89 constructs,
1 → 17 relations), 103/103 atlas entries composed, 0 orphans in rounds 6–10, 12/12 facets
every round from 6, 6 vocabulary extensions, 4 refusals (geometry, look, evidence, the model).

v7 filled round 5's four: `world` + `rel:acts` (outcome/partial/undo), `voice` + `copy`,
`history` + `rel:versions`, `vocab`. v8: `rules` over values, `rel:moves`, `source.relates`,
`source.contention`. v9: `source.propagation`, `groups`, `floors`. v10: `app`, `consents`.
v11: `grant.upTo/ask/unless`, `acts.rehearsal/rehearsedIn`.

### The three open holes (v12's brief)

- **choice** — an instance whose pattern is chosen at run time from named candidates by a
  named rule or model, with what the decision was based on (7 screens).
- **stability** — what a regeneration must preserve: ids, pins, positions, the person's
  edits (8 screens; Marble's own every-element-keeps-its-id rule is this contract).
- **reflexivity** — an instance whose config is another instance's source: the interface
  that edits its own spec (5 screens; the atlas's Configure panel, ODI's inspector).

### Traps found in the second loop

- A relation field name means one thing per kind: `shows` is an array on `reports`, so
  `versions` uses `in` for its instance rather than overloading it.
- A facet token must be in some version's `introduces` or the checker resolves it to the
  base construct; `rel:derives#stale`, `rel:counterpart#sides`, `rel:versions#keeps`,
  `authority#unless` were all fields that existed before anyone pointed at them. The
  checker's `tokenOf` now falls back to the base only when no version introduced the facet.
- A group id that collides with a source id (`owners`) is refused; name groups distinctly.
- `--json` output is fine; piping it into `node -e` truncates on exit. Write to a file.
- The report generator now refuses to build from a spec that does not check.
- Screen ids must be unique across rounds (the report mints element ids from them);
  round 7's `board` and round 9's `car` collided with round 2 and became `whiteboard`
  and `lanekeep`. The checker now refuses a repeat.
- Writing the rebuilt page while the drive host serves it: a plain overwrite is merged
  by the host (it re-inserted an old element and stripped `<style>`). What lands intact
  is delete the file, wait two seconds, copy the fresh build in, then `cmp` after ten.
