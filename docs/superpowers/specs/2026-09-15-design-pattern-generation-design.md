# Design Pattern Generation — Design Spec

**Date:** 2026-09-15  
**Status:** Approved in brainstorming (architecture §1–§3); awaiting implementation plan  
**Working folder:** `drive/Research/Design Pattern Generation/` (drive root is gitignored; this tracked copy is the review artifact)  
**Prior art:** `PLAN.md`, `method.json`, `taxonomy.json`, partial `corpus/` (9/16 archetypes), `tools/validate.mjs`

## 1. Problem

Min et al. CHI '25 and Min & Xia UIST '25 made **one** UI pattern malleable end to end: overview–detail. A content analysis produced a design space; that space became end-user customization techniques and a declarative Meridian specification that GenUI can target.

**Thesis.** The design space of a pattern is simultaneously (a) its analysis codebook, (b) its end-user customization surface, and (c) its GenUI generation target.

**Goal.** Generalize that method across UI design patterns at three levels of abstraction, then ship an interactive Marble document — a **design space of design spaces** — for inspecting them.

## 2. Constraints and honesty

- Stages 3–4 of the method (sampling + multi-coder IRR to saturation) cannot be run for ~120 patterns in one build. Every entry carries an **evidence** badge: `coded` (only overview–detail) or `synthesized` (seed codebook with real exemplars, ready for stages 3–4).
- Marble doctrine: one fact in one place; no `render()` over addressed nodes; no `localStorage`; edits file ops; works with no host.
- Existing folder and PLAN are the execution baseline (user chose continue-as-written, full depth then full Atlas).

## 3. Architecture

```
corpus/*.json  →  validate.mjs  →  build.mjs  →  atlas.json
                                              →  schemas/<id>.schema.json
                                              →  genui/{grammar,prompt,examples}
                                              →  Pattern Atlas.mrbl
                         ↑                         │
                         └── extract.mjs ←─────────┘  (post-edit round-trip)
```

- **This build’s seed of truth:** `corpus/*.json` (arrays of entries).
- **After first successful build:** `Pattern Atlas.mrbl` is canonical for human/agent edits inside the document; `extract.mjs` regenerates corpus JSON.
- **Folder location:** keep `drive/Research/Design Pattern Generation/`.

## 4. Method (10 stages)

Documented in `method.json`. Per pattern this build:

| Stage | Delivered as |
|---|---|
| 1 Scope | def, components/roles, aliases, neighbors, level, archetype |
| 2 Questions | CHI’s three questions, specialized (derived from entry) |
| 3 Sample | written sampling frame + unit of analysis (not executed) |
| 4 Code | dims as seed codebook; saturation `not run` except overview–detail |
| 5 Design space | dimensions → sub-dimensions → variations with gloss + exemplar |
| 6 Audit | desk audit + estimated 0–3 wild score (measured only for ODI) |
| 7 Techniques | per-dimension techniques; one signature; AI variants flagged |
| 8 Spec | roles + JSON Schema derived mechanically from the space |
| 9 Demonstrate | domains + GenUI examples; Atlas itself is a demo |
| 10 Evaluate | hypothesized usage + open questions for a future probe |

## 5. Catalog

### Levels
- **Archetype** ◆ — broad activity
- **Pattern** ● — screen/flow arrangement
- **Component** ▪ — widget reused inside patterns

### Archetypes (16)
browse-collections · navigate · search · enter-data · create · communicate · monitor · guide · transact · schedule · explore-space · consume-media · configure · analyze · collaborate · delegate-ai

**Done in corpus today:** first 9. **To finish at matching depth:** last 7 (~5–6 dimensions, real exemplars, techniques, sample/unit).

### Pattern / component inventory
As in `PLAN.md` §3 (~60 patterns, ~43 components). Relations: `parent`, `uses`, `specializes`, `neighbors`. Catalog saturation via crosswalk to Tidwell 3e, Material Design 3, Apple HIG — claim under test: most library entries are **variations inside** a pattern’s space, not sibling patterns.

### Dimension families (12)
Content, Composition, Layout (CHI); Invocation, Flow, Lifecycle, Initiative, Feedback, Scope, Encoding, Collaboration, Adaptation.

### Meta-dimensions (Atlas axes / filters)
level · archetype · data shape · platforms · family profile · size · ubiquity · wild · potential · malleability gap · spec readiness · evidence

## 6. Pattern Atlas (Marble document)

The Atlas is itself a malleable overview–detail interface. Stage attributes encode a Meridian-style config in markup (`data-overview`, `data-open-in`, `data-shown`, `data-focus`).

### Rail views
1. **Atlas** — overview: Hierarchy / Grid / Table / Matrix (pattern × family) / Map (two meta-attrs → plot). Open-in: side-by-side / pop-up / in-place / new page. Fluid Attributes on meta fields.
2. **Pattern detail** — anatomy; CHI Fig. 3–style space; **Configure** (pick variations → live instance spec, Copy / Randomize); wild; techniques; protocol; relations; usage; questions.
3. **Families** — definitions + derived shared variation vocabulary.
4. **Method** — 10 stages with ODI evidence vs atlas treatment.
5. **Grammar** — binding · config · compose · malleability + GenUI pipeline.
6. **Findings** — opportunity list, reuse, largest spaces, research agenda (derived).
7. **Crosswalk** — Tidwell / Material / HIG table.

### Visual direction
Chart-paper atlas: cool paper `#eef2f0`, sounding ink `#18262e`, channel teal `#0e6a6a`. Avenir Next + Iowan Old Style italic. Level by color **and** shape (blue/orange/aqua + ◆●▪). Not cream/serif broadsheet.

### GenUI pack
`genui/grammar.schema.json`, `prompt.md`, `examples/*.json` — archetype → pattern → config → bind → malleability.

## 7. Files to create or complete

```
Design Pattern Generation/
  PLAN.md, method.json, taxonomy.json          (exist)
  corpus/{9 done + 7 missing}.json
  crosswalk.json
  atlas.json                                   (built)
  schemas/*.schema.json                        (built)
  genui/grammar.schema.json, prompt.md, examples/
  tools/validate.mjs                           (exists)
  tools/build.mjs, extract.mjs
  Pattern Atlas.mrbl
  README.md
```

## 8. Verification

1. `node tools/validate.mjs` exits 0; `--strict` clean after all relations resolve.
2. `node tools/build.mjs` deterministic (two runs byte-identical).
3. `marble doctor "Pattern Atlas.mrbl"` → 0 errors (if marble CLI available).
4. extract round-trip: build → extract → corpus equal aside from key order.
5. No-host `file://` smoke: views, layouts, open-in, configure compose a spec; desktop + phone widths.
6. Optional under drive host: layout switch persists; Mod+Z reverts; restore test edits.

## 9. Out of scope

- Running real sampling + IRR for synthesized patterns.
- A Meridian-style runtime renderer beyond overview–detail (grammar/schemas are the input for that later work).

## 10. Approval record

- Path: architectural; continue existing PLAN (choice A).
- Scope: full remaining corpus depth, then full Atlas with all rail views (choice A).
- Architecture §1, catalog §2, Atlas/GenUI §3: approved 2026-09-15.
