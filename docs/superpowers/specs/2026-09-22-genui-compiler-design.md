# The GenUI compiler: a screen spec that runs, and can be turned

**Date:** 2026-09-22
**Status:** design, awaiting review (revised 2026-09-22 — the division of labour, §2)
**Builds on:** `2026-09-21-writing-screens-composition-study-design.md` (the grammar, v1–v6, and the 40 screens),
`2026-09-18-genui-authored-spaces-design.md` (the app-space contract), `2026-09-18-genui-generate-design.md` (the engine)
**Method:** stage 9 of `method.json`, *demonstrate across domains and stakeholders*; feeds stage 11.

## 1. Why

Two halves of GenUI were built separately and have never met.

The **spec** half is done and well evidenced: 118 design spaces coded by three model raters at
κ ≥ 0.80 (`Coding and IRR.mrbl`), and a composition grammar at v6 — 52 constructs, 14 relations —
with 40 screens written in it, every one validating against the published schema
(`Writing Screens.mrbl`).

The **engine** half — `drive/GenUI.mrbl`, `POST /genui/root`, `POST /genui/decide`, the
`genui-author` skill — decides a root pattern and variation picks over a nine-entry mini atlas,
and hands the writing of the document to an agent. `grep grammar server/` returns nothing. The
grammar is not in the loop anywhere.

So nothing turns a screen spec into a thing a person can use, and the malleability the corpus
declares has never been anything but a JSON field. This builds the missing half: a compiler from
a grammar spec to a running app space, where the spec's `malleability` becomes controls the
person can actually turn.

**And it is a third instrument.** Stage 10 counted what the grammar could not *state*. A compiler
counts what can be stated but has nothing to *render*: a `malleability: true` on a dimension no
CSS can express is a hole the composition checker cannot see, because the spec is well-formed.
Same loop as the composition study — compile, count the holes, fill, migrate.

## 2. The division of labour

> **The LLM builds the space. Jev positions within it. Neither does the other's job.**

Everything up to and including the creation of the design space is authoring, and authoring is
generative: it decides what the screen *is*, and its output is a space of possible screens.
Everything after is positioning: choosing one point in a space that already exists, from options
that are already built. Jev is very good at the second and has no business doing the first.

**This moves the root-pattern decision off Jev.** `POST /genui/root` asks Jev to pick one pattern
from `ROOT_PATTERNS`, a 13-item constant, and that has been the wrong shape all along — the
corpus says so plainly:

| Measured over the 40 written screens | |
|---|---|
| screens that are a single pattern — what one L0 Choice can express | **0** |
| screens made entirely of `ROOT_PATTERNS` entries | **0** |
| distinct patterns actually used | **65** |
| patterns used that are not on the 13-item menu | **52** |

A real screen is four or five patterns in relation to each other. "Which pattern" is not a
decision with a menu; it is the first line of the authoring, and it belongs to whatever writes
the spec.

**What is lost, and what replaces it.** L0 gave a bounded menu, a confidence and a probability
distribution — an off-menu answer was a 502. Giving that to the LLM gives it up. The replacement
is the checker: an LLM-written spec must pass `grammar-check.mjs`, so every pattern must resolve
to a real Atlas entry, every `config` key to a real sub-dimension, and every value to a named
variation. The guarantee is weaker per decision and much broader in reach, and — unlike a
confidence score — it is a proof rather than an estimate.

Jev keeps the job it is actually good at, and its guardrails are untouched: criteria are only the
options the document implements, off-menu is refused, below 0.75 keeps the author's default,
pinned never moves.

## 2a. The pipeline

```
  PROMPT
    │
    ▼   ┌── LLM ─────────────────────────────────────────────────────┐
        │  agent turn. Writes a screen spec in the grammar:          │
        │  sources, instances, config, relations, malleability.      │
        │  UNBOUNDED — this is the whole generative step.            │
        └────────────────────────────────────────────────────────────┘
    │  screen spec (JSON, grammar vN)
    ▼   ┌── CHECK ── grammar-check.mjs checkScreen() ────────────────┐
        │  deterministic. Patterns, keys and variations must resolve │
        │  against the codebook. Errors go back to the LLM verbatim. │
        └────────────────────────────────────────────────────────────┘
    │  valid spec
    ▼   ┌── COMPILE ── tools/compile.mjs ───────────────────────────┐
        │  deterministic, NO MODEL. Renderers build the markup and  │
        │  the CSS for every option; malleability becomes           │
        │  declarations.                                            │
        └───────────────────────────────────────────────────────────┘
    │  SPACE₁ — the app space. A finite, countable set of screens.
    ▼   ┌── POSITION ── POST /genui/decide ── JEV ──────────────────┐
        │  one Choice per live dimension, criteria = only what this │
        │  document implements. Output is setAttr ops, never markup.│
        └───────────────────────────────────────────────────────────┘
    │  the first show
    ▼
  THE RUNNING UI ──── a person turns a control ────┐
    ▲                                              │
    └──────── same attribute, same CSS ────────────┘
```

The last two steps are the same mechanism. Jev positioning the screen and the person turning a
control both write one attribute on an instance root, and CSS does the rest. **A generated
interface and a customized one differ only in who moved** — which is the cleanest statement of
the thesis the demo can make, and it falls out of the architecture rather than being argued for.

## 2b. The repair loop

The LLM writes a spec; `checkScreen` accepts it or returns errors; the errors go back verbatim
and it tries again, three attempts, then fails loudly. Same posture as `gateWithRepair` elsewhere
in this repo and as `decide.js`'s refusal of an off-menu answer: a wrong-shaped answer is a bug
to see, not data to smooth over.

**Sequencing.** The compiler is built and trusted *before* a model is put in front of it (M1–M3
below use specs written by hand, from the corpus). A failure in an LLM-written spec is otherwise
unattributable — grammar, renderer or model, with no way to tell which.

## 2c. What the compiler produces

`node tools/compile.mjs <screen-id>` reads a screen from `genui/rounds/*.mjs` (or any spec JSON
that passes the checker, including an LLM-written one) and writes `drive/Spaces/<screen-id>.mrbl`:
a real app space, satisfying `validateSpace` from `server/genui/space.js`.

The output is an app space in the existing contract, not a new format:

- `data-genui="<atlas-id>#<instance-id>"` on each instance root, with `data-marble-id`
- `data-genui-about="…"` — one sentence, taken from the instance's role in the spec
- facts: `data-<kebab-sub-key>="<slug>"` from `config`
- declarations: `data-genui-<key>="slug | slug | …"` for what may be turned
- every declared option implemented by a `[data-<key>="<slug>"]` rule
- `data-genui-request` on `<body>` — here, the screen's `what` line
- `data-genui-excludes` where the spec's `constraints` forbid a pair

Because it is that contract, three things come free: `marble-drive genui space <doc>` validates it,
`marble-drive genui decide <doc>` lets Jev position it, and `GET /genui/spaces` lists it — so the
existing GenUI page can open a compiled screen with no new route.

The hand-authored `test/fixtures/genui/metrics.mrbl` (dashboard#ops + stat-tile#kpi + chart#trend,
11 KB, every option implemented in CSS) is the quality bar for screen one: 9 live dimensions,
**5,832 distinct screens** from one document. The compiler's output should be at least as good,
from the spec alone.

### The tension worth naming

Eighteen hand-written renderers will make every compiled screen look like the same application.
An LLM writing CSS directly produces something bespoke each time, and that variety is most of
what makes a GenUI demo feel like one. Trading it away is a real cost, not a neutral refactor.

The resolution, if it proves necessary: the compiler owns **structure and options** — the
declarations and the implementation of every variation, which must be complete and checkable —
and the LLM may author a **skin**: presentation CSS layered over a compiled structure, touching
no declaration and no option rule. Not built in M1. Recorded here so the choice is deliberate
when the first three screens look like siblings.

## 3. Three units

**`genui/compile/resolve.mjs` — spec + atlas → a resolved screen.** Pure; no HTML. Reuses the
resolution already written in `tools/grammar-check.mjs` (corpus lookup, config keys → atlas
sub-dimensions, variation slugs, relation requires/allows). Adds: `malleability` keys are
*dimension names* (`"Arrangement"`) while facts and declarations are *sub-dimension keys*
(`arrangement`, `density`) — resolve maps one to the other through the atlas entry's `dims[].subs[]`,
and a dimension name that matches nothing is an error, not a silent drop.

**`genui/compile/patterns/<atlas-id>.mjs` — one renderer per pattern.** Each exports:

```js
export default {
  pattern: 'dashboard',
  roles: ['metric', 'label', 'trend'],        // what it binds
  implements: { arrangement: ['fixed-grid', 'single-scrolling-column', 'story-layout'],
                density: ['a-few-glanceable-tiles', 'dense-wall'], … },
  markup(instance, ctx),                       // HTML for this instance, children slotted by ctx
  css(instance, ctx),                          // rules, scoped under the instance root
};
```

`implements` is the contract: it names the variations this renderer really builds. A renderer
that claims a variation its CSS does not select is a test failure, checked by parsing its own
`css()` output for `[data-<key>="<slug>"]` — the same rule `validateSpace` applies to a document,
applied to a renderer.

**`genui/compile/compose.mjs` — resolved screen + renderers → the document.** Layout, relations,
the malleability controls, and assembly. `layout.place` is already `[col, row, w, h]` on a 12×8
grid with `over` for overlays (this is what draws the wire diagrams in `grammar-report.mjs`), so
the screens carry their own geometry and it compiles straight to CSS grid.

## 4. Malleability: the rule

A declaration is emitted for a sub-dimension if and only if

1. the spec marks its **dimension** malleable (`true`, or a permission object), and
2. the renderer's `implements` names **two or more** of its variations.

The three cases:

- **`malleability: false` or absent** → the fact is written, no declaration. It renders and it
  cannot be turned. This matters: if everything is malleable, *malleable* means nothing, and the
  spec's refusals are part of the claim.
- **`true`** → declaration plus a control.
- **`{ who, scope, persists, why }`** → declaration, control, and the governance carried into the
  document as `data-who` / `data-scope`. **Governed malleability is the thesis** — not a
  free-for-all, but a screen that knows who may change what, and says so.

  **Revised during M1, from building it.** The first rule was "a dimension with a named `who` is
  held", which turned out to make governance mean prohibition: every one of `observe`'s five
  malleable dimensions names a party (`team` twice, `admin` once), so the whole demo screen had
  nothing a person could turn. But `who: 'team'` does not mean *not you* — it names **which
  party** may turn it. So the document carries **who you are viewing as** (`data-viewer` on
  `<body>`, defaulting to the party the screen most often trusts), and a control is held only
  when the viewer is not the party the spec names. Switching viewer opens the admin's dimension
  and closes the team's. This is a better demonstration than a greyed-out button: the same screen
  offers different malleability to different people, which is what the permission was always
  saying.
- **marked malleable, renderer implements fewer than two** → a **render hole**. Not declared
  (so the document still validates), and reported. These are the findings.

**Where the control comes from.** Each Atlas entry carries `techniques[]` from stage 7 of the
method — `{ name, dim, how, ai }`, e.g. dashboard's *Tile surfacing* and *Arrange by glance
frequency*. Where a technique exists for the dimension being turned, the control is labelled with
it and its `how` is the help text, and `ai: true` techniques are shown as proposals rather than
switches. The control surface is therefore drawn from the codebook, not invented for the demo —
which is the whole argument the atlas exists to make.

**How a control writes.** Setting a control sets `data-<key>` on the instance root; CSS does the
rest. It works from a file with no host at all. If `window.marble` is present, the change is also
filed as an op, so it persists across a reload and Mod+Z reverses it.

That second half is a deliberate departure from the `genui-author` skill's rule that an app space
carries no `window.marble`. The reason: a malleability demo where your change vanishes on reload
proves nothing. It is feature-detected and never required for rendering, so the document remains
plain web UI that runs from a file — the property the rule protects. If review prefers the rule
kept whole, the fallback is `localStorage`, at the cost of undo.

## 5. Relations → markup

Only the kinds the chosen screens need, which is also where the corpus is densest —
`contains` 68, `reports` 31, `triggers` 28, `selects` 19, `alternative` 5:

| Kind | Compiles to |
|---|---|
| `contains` | the child's root is placed in the slot the relation names, inside the parent's markup |
| `alternative` | one region, members stacked, `data-alt="<member>"` chooses; the switcher is the control |
| `selects` | clicking an item in `from` sets `data-selected` on the screen root; `to` binds against it |
| `reports` | the source's `states` (stale, empty, error, absent) become real rendered states, driven by the fixture, not decoration |
| `triggers` | a named condition the fixture can raise; `takes` decides whether it may take the foreground |

Every other kind is declared unimplemented and counted. That is not a gap in the work; it is the
measurement the work exists to make.

## 6. Data

One fixture per screen at `genui/fixtures/<screen-id>.json`, shaped to that screen's
`sources[].path`. Bindings resolve role → path → value through the small JSONPath subset the
paths already use. Realistic sample data; no invented copy standing where a data path belongs
(rule 8 of the author skill). The fixture also carries the state and trigger switches `reports`
and `triggers` need, so the demo can show a stale source rather than describe one.

## 7. The screens, in order

Chosen on the survey of all 40 (malleability count, governance count, relation spread, and how
much of the renderer library each one shares).

**M1 — `observe` (round 1).** dashboard, stat-tile, chart, annotation, coordinated-views.
Three governed malleability declarations, the most in the corpus, and its pattern set is exactly
the hand-authored `metrics.mrbl`, which gives the renderers a worked reference in CSS.
Relations: contains, selects, anchors, triggers.

**M2 — `triage` (round 1).** inbox, overview-detail, bulk-actions, search-results. Five
malleability declarations, and it rests on `overview-detail` — the **only** entry in the atlas
that is human-`coded` (CHI '25) rather than agent-coded, so one demo screen stands on human
evidence. Adds the `alternative` and `reports` relations. `49ers.mrbl` is its CSS reference.

**M3 — `views` (round 1).** spreadsheet, kanban-board, calendar, view-switcher, filter-controls,
property-inspector. Eight malleability declarations, the most of any screen, and the recognisable
demo: one database, switched between table, board and calendar, by a person, at run time.

**Stress case, after M3 — `frontdoor` (round 5).** A smart-home wall panel: surfaces, contexts,
a night variant, and a guest who may work the lights and never the locks. It is expected to
produce render holes — `voice`, `surfaces`, `variants`, `acts` have no renderer — and that is the
point of compiling it. Holes are the finding, not the failure.

Eighteen renderers across the four screens is the ceiling, not the plan: M1 is five, and each
later screen is only what it adds.

## 8. Testing

- **Resolve, all 40.** Every screen in the corpus resolves without crashing, whether or not it
  can be rendered. Guards against the compiler assuming the shape of the screens it was built on.
- **Renderer honesty.** For each renderer, every slug in `implements` is selected by its own
  `css()`. Catches the failure the whole design turns on.
- **Contract.** Every compiled screen passes `validateSpace(source, atlas).ok`. Run in-process
  against `server/genui/space.js`, so the tool and the host cannot drift.
- **Browser (`test-browser/genui-compile.test.js`).** Load a compiled screen; for each declared
  control, click it and assert *both* that the attribute changed *and* that a computed style
  actually differs. The validator matches bytes; this catches a rule that matches and does
  nothing — the failure mode that would make the malleability claim false while every check is
  green.
- **The repair loop (M4).** The checker's errors are fed back and the retry is bounded at three;
  tested with a deliberately invalid spec (a `config` naming a variation that does not exist), so
  the loop is exercised without needing a model that happens to fail.
- **Report.** `tools/compile-report.mjs` → a render-hole table: dimension, screen, why it could
  not be rendered. This is the study output, and the input to the next round.

## 9. Scope

Not in this work: the other 36 screens; the nine unimplemented relation kinds; anything in v7.
`genui/grammar/`, `genui/rounds/` and `Writing Screens.mrbl` are **not touched** — conversation
`5a70804ffcab` is writing v7 and rounds 6–10 right now. The compiler reads the published
`genui/grammar.schema.json` and tolerates constructs it does not know, so v7 landing mid-build
changes nothing here.

No changes to `server/genui/*` in M1–M3: it is imported as a library and left alone.

`POST /genui/root` and `ROOT_PATTERNS` leave the pipeline at M4, but are **not deleted** —
`drive/GenUI.mrbl` still calls the route and draws an L0 node with confidence bars. Migrating
that page to the spec pipeline is its own piece of work, scoped after M4; until then the two
paths coexist and the route keeps working. Removing it before the page moves would break the
only front end GenUI has.

## 10. Milestones

The deterministic path is built and trusted first; the model goes in front of it last.

1. **M1** — `resolve` + five renderers + `observe` compiled, validating, and turnable in a browser.
2. **M2** — `triage`, on the coded entry; `alternative` and `reports` working.
3. **M3** — `views`; the recognisable switch; the first render-hole report across three screens.
4. **M4 — the LLM in front.** A `genui-spec` skill: prompt → screen spec → checker → repair →
   compile → Jev positions the first show. The end-to-end pipeline of §2a, on a prompt that was
   never in the corpus. This is the demo.
5. **Stress** — `frontdoor` compiled for its holes, and the report written up as the third
   instrument.

Check in at each; decisions taken along the way are recorded here rather than asked.
