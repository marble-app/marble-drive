# Design Pattern Generation — coding the corpus to agreement

**Date:** 2026-09-20
**Status:** Approved by request ("populate the collection; three subagents, same task, reconvene until IRR is high enough"); building
**Folder:** `drive/Research/Design Pattern Generation/` (drive-local, gitignored; this spec is the tracked record)
**Builds on:** `DESIGN.md`, `method.json` stages 3–4 and `codingProtocol`, `PLAN.md` §10

## 1. What this is

Stages 3–4 of the method, run on every entry that is still `synthesized` (118 of 119).
Until now each design space was a seed codebook; after this run each has been applied
by three independent raters to a shared sample of real instances, with inter-rater
reliability reported and the codebook revised where the raters said it failed.

It is the base for what follows: a design space of design patterns that GenUI can
generate a personalized design space *from*, and that Jev can select a UI *within*.

## 2. Honesty first

The raters are language models recalling well-known products, not people visiting
sampled screens. That is a real content analysis of a real codebook, but it is not
the CHI '25 procedure. So:

- A new evidence tier, **`agent-coded`**, between `synthesized` and `coded`. Only
  overview–detail keeps `coded`.
- **First-pass κ is the reported IRR.** Reconciliation rounds resolve cells; they do
  not overwrite the first-pass numbers. Both are stored.
- Cells the three raters never agree on stay `unresolved`; variations no rater ever
  applied are flagged `unobserved`; sub-dimensions whose κ stays below 0.60 are
  flagged `unreliable`. Flags are findings, not failures to hide.

## 3. Protocol

| Step | Who | Output |
|---|---|---|
| 0 Codebook briefs | `tools/coding-brief.mjs` | `coding/codebook/<archetype>.md` — the entry's dims/subs/vars, nothing else |
| 1 Sample | 4 sampler agents, one per slice | `coding/samples/<archetype>.json` — 20 instances per entry (`product`, `screen`, `platform`, `where`, `note`), diverse across the entry's frame; real, widely known products only |
| 2 Code, round 1 | 3 raters × 4 slices = 12 agents | `coding/round1/<rater>/<archetype>.json` — one code per (instance, sub-dimension), one note per instance, structured `proposals` for variations/dimensions the codebook lacked |
| 3 IRR | `tools/irr.mjs` | `coding/irr/round<n>.json` — Fleiss' κ per sub, item-weighted per entry, all-agree %, disagreement packets |
| 4 Reconvene | the same 3 raters, given the packet | `coding/round<n>/<rater>/…` — re-code the disagreeing cells only, seeing the other two raters' codes and notes; may hold with a reason |
| 5 Stop | `irr.mjs` | entry passes at κ ≥ 0.80; at most two reconciliation rounds |
| 6 Finalize | `tools/coding-finalize.mjs` | majority code per cell → `coding` block on each corpus entry; adopted proposals (≥2 raters) become variations/dimensions; `evidence: agent-coded`; validate + build |

**Raters are three different models** — Fable, Opus, Sonnet — with a byte-identical
prompt and codebook. Three runs of one model would share its blind spots and inflate κ.

**Independence.** Each rater writes only its own files and never sees another rater's
codes until the packet in step 4. The sampler does not code.

**Codes.** `sel: one` → one variation name; `sel: many` → an array (empty = none
apply). `n/a` when the sub-dimension does not apply to the instance; `?` when the
rater cannot tell from what they know of the product; `+Name` proposes a variation
the codebook lacks (also listed under `proposals` with a gloss).

**κ.** Fleiss' κ per sub-dimension over the 20 instances. `sel: many` is scored per
variation as present/absent (multi-label convention). A sub with no variance across
all raters and instances has undefined κ; it is reported as `constant` and counted as
agreement. Entry κ is the item-weighted mean of its subs.

## 4. Slices (balanced by sub-dimension count)

1. browse-collections · configure · search · guide — 29 entries, 169 subs
2. enter-data · navigate · collaborate — 32 entries, 167 subs
3. monitor · delegate-ai · create · analyze — 30 entries, 170 subs
4. communicate · schedule · transact · explore-space · consume-media — 28 entries, 174 subs

## 5. What lands in the corpus

Per entry, a `coding` block: tier, instance count, raters, rounds, `kappaFirstPass`,
`kappaFinal`, `agreementFirstPass`, `agreementFinal`, `perSub` (κ and flag), the
consensus code per instance, `distribution` (codes per variation), `unresolved`,
`proposals` (raised / adopted). The sample itself stays in `coding/samples/`.

`taxonomy.json` gains `evidence.agent-coded` and `dimensionOrigins.agent-coded`.

## 6. Verification

- `node tools/coding-check.mjs` passes on every samples and codes file before an agent
  may report done.
- `node tools/irr.test.mjs` — κ against known values.
- `node tools/validate.mjs` and `node tools/build.mjs` clean after finalize; the Atlas
  shows the new tier.

## 7. Out of scope (next)

- The personalized design-space generator and Jev-driven selection over it.
- Re-sampling with a browser-visited frame to promote `agent-coded` to `coded`.

## 8. Results

**Round 1 — the reported IRR (frozen in `coding/irr/round1.json`, 2026-09-20).**
All 118 entries, 2,360 instances, 12 rater-runs, 0 missing cells.

| | |
|---|---|
| Mean entry κ | **0.690** |
| Median | 0.704 |
| All three raters agree | 78.8% of cells |
| κ ≥ 0.80 | 17 / 118 |
| Range | 0.24 (checkout) – 0.91 (breadcrumbs) |
| Sub-dimensions | 668 scored · `pick one` mean κ 0.679 · `pick any` 0.665 · 2 constant |

Anatomy of the 1,533 disagreeing cells in one slice: 58% were `pick any` lists
that partially overlap, 30% two raters against a third's different label, 6%
involved a proposal, 3% one rater's `?`, and only 2% three-way splits. The
raters were not reading different products; they were filling the same list to
different depths.

**Round 2 — reconciliation works.** Every archetype whose round completed rose
above threshold:

| archetype | round 1 κ range | round 2 | |
|---|---|---|---|
| communicate | 0.50 – 0.81 | 0.81 – 0.97 | 6/6 pass |
| consume-media | 0.48 – 0.89 | 0.81 – 0.90 | 5/5 |
| explore-space | 0.52 – 0.75 | 0.85 – 0.93 | 5/5 |
| schedule | 0.55 – 0.77 | 0.89 – 0.96 | 5/5 |

At 33% round-2 coverage the corpus stands at mean κ 0.754, 48/118 passing.
**consume-media and explore-space passed with only the outlier rater re-coding**
— when one rater was systematically under-inclusive on `pick any`, its
convergence alone carried the entry. Reconciliation is not three-way haggling;
it is mostly one rater seeing what it missed.

**The codebook findings, reported independently by all three raters.** These are
the point of running the analysis, not noise in it:

1. **`pick one` sub-dimensions that hold two truths at once** — media-player
   `mode`, chat-thread `lifetime`, checkout `structure`, data-table `columnSet`,
   stories `presentation`, sharing-permissions `lifecycle`, reader `pagination`.
   They want to be `pick any` or to split into two axes.
2. **Content sub-dimensions written as closed sets that are not** —
   bottom-sheet `holds` and drawer `holds` drew eight distinct proposals from
   three raters.
3. **Variations that never discriminate** — seat-map `seatConstraints` "Max
   quantity" is true of all 20 instances; video-call `constraints` leads with
   "Automatic quality (e.g., All)".
4. **Exemplars naming one product under two variations** — Gmail for both
   inbox `Labels` and `Automatic categories`; Google Docs for both
   `Chronological list` and `Calendar of days`; GitHub cited for split diff,
   which split all four git clients.
5. **`pick any` lists with a self-negating member** — reported independently by
   two raters on different archetypes: collaborate `authorship`'s "Async
   activity only" and focus-context `focusContent`'s "X only" cannot be chosen
   alongside anything else, so one rater picks the exclusive value and another
   picks the specifics, and they read as disagreeing about the product when they
   agree entirely. An exclusive value does not belong in a multi-select.
6. **Sub-dimensions unobservable from product knowledge** — date-picker
   `locale`, slider `scale`, progress-indicator `delay`, co-editing-presence
   `density`. These are honest `?` territory and should be marked as requiring
   instrumentation, not recall.

### One rater defers, and what that costs

`reconcile.md` says convergence is not the goal. `tools/coding-deference.mjs`
checks whether that held, by classifying every re-coded cell against the rater's
own round-1 code. A list that only grew is counted as *widened* before anything
else, so a rater correctly adding what it missed is never called deference.

| rater | held | widened | converged to a peer | independent |
|---|---|---|---|---|
| fable | 75% | 8% | 16% | 1% |
| opus | 73% | 8% | 19% | 1% |
| sonnet | 20% | 49% | 30% | 0% |

Half of Sonnet's churn is legitimate: its round-1 `pick any` lists were
systematically thinner than the products warranted, and it said so itself before
the numbers did. But it converges on a peer at twice the others' rate and makes
essentially no independent moves. **Sonnet is the soft rater**, and any
post-reconciliation figure that includes it is partly an artifact of that.

The clean check is to score the two raters who held their ground:

| | all three | fable × opus |
|---|---|---|
| Round 1 (first pass) | 0.690 | **0.800** |
| Round 2 (after reconciliation) | 0.805 | **0.889** |

Two independent raters who mostly did not defer already agreed at κ 0.800 on
first contact with the codebook — at the threshold, before any discussion. The
conservative three-rater 0.690 is depressed by one deferential rater, not by
genuine ambiguity in the design spaces. Report 0.690 as the headline because it
is the most conservative defensible figure, and report the pair as the
robustness check.

**Why the soft rater was thin, in its own words.** Asked afterwards, it said it
had been "treating values as mutually exclusive rather than additive" on
`pick any` sub-dimensions — reading a multi-select as a single-select and
recording only the most salient value per product. That single misreading
accounts for the 49% widening, for most of the 58% of round-1 disagreements that
were partially-overlapping lists, and for why its reconciliation looked like
capitulation when half of it was correction.

That is a **briefing failure, not a rater failure**. `PROTOCOL.md` states the
rule once, in a sentence, and the codebook briefs print `(pick any that apply)`
in the same weight as everything else. A rerun should make multi-select
structurally obvious — say how many values a typical instance carries, and have
`coding-check.mjs` warn when a rater's `pick any` lists average near one item
across a whole entry, which would have caught this at the first file instead of
after 2,360 instances.

**For a rerun:** three raters is the right number, but they should be three
models of comparable strength. A weaker third rater does not add an independent
reading; it adds noise at first pass and agreement at second.

### The protocol's own defect: coding an absence

Reported independently by raters on four archetypes, and the single largest
avoidable source of disagreement. `PROTOCOL.md` gives three ways to say a thing
is not there and never says which to use:

- an **empty array** on a `pick any` sub ("none of these apply"),
- **`n/a`** ("this sub-dimension does not apply to this instance"),
- and some codebooks carry a literal **`None`** variation.

So a search result with no description was coded `n/a` by one rater and
"Static description" by another; an NLE with no automation was `[]` to one and
`None` to another. These are not disagreements about products. A revision should
pick one convention per sub-dimension and say it in the gloss — `n/a` reserved
for "the question is meaningless here", the empty array for "asked and absent",
and no `None` variation in a `pick any` list at all.

A second, smaller convention gap: whether a control that is always present
(Add task) counts as an empty state's create action — i.e. whether a sub-dimension
asks about the screen as sampled or about the product's capability. The
`spreadsheet` entry's glosses settle it one way and its sub names the other.

## 9. Operational notes

- A reconciler handed a 1,000-cell packet will try to fan out to subagents and
  hit the 20-concurrent cap; `reconcile.md` now forbids delegation.
- 13 agents died at once on a session rate limit. Partial work survives: files
  already written are kept, and `tools/coding-coverage.mjs --round n` reports
  exactly which entries each rater still owes.
- `tools/irr.mjs` scores only entries every rater has finished, and treats a
  rater's half-written JSON as not-ready rather than failing the run.
- **Simultaneous reconciliation can cross.** Twice, two raters swapped positions
  in the same round — each adopting the other's proposal name — which preserves
  the disagreement instead of resolving it. Worse, κ compared proposal labels as
  raw strings, so two raters who both said "the codebook lacks a value for
  zooming the whole field" scored as disagreeing because one wrote
  `+Whole-field zoom` and the other `+Whole-view zoom`. `irr.mjs` now clusters
  near-synonym proposals *within a sub-dimension* before scoring (equal token
  sets, proper subset with ≥2 tokens, or ≥2 shared tokens and Jaccard ≥ 0.5;
  codebook variations are never merged, only free-text `+proposals`). Run with
  `--raw` to score without it. Effect on round 1: 22 merges, mean κ
  0.690 → 0.691 — the headline number is robust either way, because round-1
  proposals were too sparse to distort it. It matters in later rounds, where
  raters see each other's names.
- **Lexical matching was not enough.** The real crossings shared almost no
  words: `+Mark read` vs `+Read on view`, `+Centre of screen` vs
  `+Centre overlay`. So `irr.mjs` also clusters by **co-extension**: two raters
  naming the same gap apply their names to the same instances. If rater A used
  only label X, rater B used only label Y, neither used the other's, and their
  cell sets overlap by Jaccard ≥ 0.5, the labels are one concept. This is
  evidence rather than wording, and it is the stronger signal — it lifted round 2
  from 88 to 90 passing (κ 0.845 → 0.852) by itself. Guard conditions matter and
  are tested: one rater using *both* labels means they are that rater's two
  distinct codes, not alternatives, and are never merged.

  The same hazard will appear in the generated-DSL work downstream. Two prompts
  that name one concept differently are not two concepts, and a generator that
  compares strings will think they are.
