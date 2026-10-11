# Design Pattern Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the 7 missing archetype corpora, build tooling + GenUI pack + crosswalk, and ship an interactive Pattern Atlas Marble document.

**Architecture:** Corpus JSON is the seed; `validate.mjs` gates quality; `build.mjs` emits `atlas.json`, per-pattern schemas, GenUI artifacts, and `Pattern Atlas.mrbl`; the `.mrbl` is then the live inspector (malleable overview–detail over all spaces).

**Tech Stack:** Node ESM, JSON corpus, Marble `.mrbl` (HTML + CSS + JS, `window.marble` ops), no server.

**Spec:** `docs/superpowers/specs/2026-09-15-design-pattern-generation-design.md` (working copy: `drive/Research/Design Pattern Generation/DESIGN.md`)

## Global Constraints

- Evidence: only `overview-detail` is `coded`; all new entries `synthesized`
- Entry shape must pass `tools/validate.mjs` (camelCase keys, ≥2 vars per sub, technique dims match, scores 1–5, wild 0–3)
- Marble: one fact one place; transient derived UI; every element `data-marble-id`; file ops on persistable controls
- Visual: chart paper `#eef2f0`, teal `#0e6a6a`, Avenir Next + Iowan italic; level ◆●▪ + blue/orange/aqua
- Folder: `drive/Research/Design Pattern Generation/`

---

### Task 1: Finish corpus — schedule, explore-space, consume-media, configure

**Files:**
- Create: `corpus/schedule.json`, `corpus/explore-space.json`, `corpus/consume-media.json`, `corpus/configure.json`
- Test: `node tools/validate.mjs`

**Patterns (plus archetype entry + any planned components):**
- schedule: calendar, availability-picker, gantt-timeline, task-list
- explore-space: map-explorer, zoomable-canvas, seat-map, object-viewer-3d
- consume-media: media-player, reader, playlist-queue, stories
- configure: settings, product-configurator

- [ ] Write four corpus arrays matching existing depth (~5–6 dims for patterns)
- [ ] Run validate; fix until zero errors (warnings OK for unresolved relations)

### Task 2: Finish corpus — analyze, collaborate, delegate-ai

**Files:**
- Create: `corpus/analyze.json`, `corpus/collaborate.json`, `corpus/delegate-ai.json`
- Test: `node tools/validate.mjs`

**Patterns:**
- analyze: chart, coordinated-views, pivot-table, notebook, focus-context
- collaborate: co-editing-presence, version-history, sharing-permissions, annotation
- delegate-ai: ai-chat, inline-suggestion, generative-variations, agent-run (+ components prompt-input, suggestion-chips, ai-provenance)

- [ ] Write three corpus arrays at matching depth
- [ ] Validate clean

### Task 3: Crosswalk + build/extract tools + GenUI pack

**Files:**
- Create: `crosswalk.json`, `tools/build.mjs`, `tools/extract.mjs`, `genui/grammar.schema.json`, `genui/prompt.md`, `genui/examples/*.json`
- Modify: none required on validate.mjs
- Test: `node tools/validate.mjs --strict` after relations resolve; `node tools/build.mjs`

- [ ] Author crosswalk Tidwell / Material 3 / HIG → pattern or variation
- [ ] build.mjs: load corpus+tax+method+crosswalk → atlas.json, schemas/, genui examples stubs, Pattern Atlas.mrbl shell with all entries in markup
- [ ] extract.mjs: parse `.mrbl` pattern blocks back to corpus arrays
- [ ] GenUI grammar + prompt + ≥3 worked examples (including overview-detail)

### Task 4: Pattern Atlas interaction

**Files:**
- Modify: `Pattern Atlas.mrbl`
- Test: open file:// or marble host; exercise views

- [ ] Rail views: Atlas, Families, Method, Grammar, Findings, Crosswalk
- [ ] Overview layouts Hierarchy/Grid/Table/Matrix/Map; open-in modes; Fluid Attributes filter/sort
- [ ] Pattern detail with Configure → live spec, Copy, Randomize
- [ ] Persist view attrs via marble.op; marble.register for derived focus
- [ ] README.md documenting rebuild and round-trip

### Task 5: Verification

- [ ] validate + build + extract round-trip
- [ ] No-host smoke of all rail views
- [ ] Commit tracked docs (spec/plan) if user wants; drive/ stays local

---

**Execution:** User approved “do everything” — implement Tasks 1–5 now without further gates.
