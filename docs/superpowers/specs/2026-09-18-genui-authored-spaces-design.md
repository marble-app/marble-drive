# Fast GenUI — Authored Spaces, Jev Decisions

**Date:** 2026-09-18
**Status:** Implemented 2026-09-18 on branch `genui-authored-spaces` (worktree `.claude/worktrees/genui-authored-spaces`); Stage B, CLI, inspector and skill in place; first real-model decides 244–312 ms across three spaces. The running host needs a restart on this branch before `/genui/*` exists there.
**Supersedes for steady state:** the Recursive Subquestions loop in `server/typesafe/pipeline.js` (kept; see §11)
**Depends on:** Pattern Atlas (`drive/Research/Design Pattern Generation/`, 119 entries, 680 sub-dimensions, `schemas/*.schema.json`), TypeSafe client (`server/typesafe/client.js`), the Drive's one write path (`writeOps` in `server/app.js`)

## 1. Goal

Generate UIs as expressively as an LLM can, but change them at Jev speed.

The current loop (Monitor.mrbl, `pipeline.js`) puts an LLM *inside* the generation path: Grok shapes the first question and splits every low-confidence one. Each split is a 10–180 s `cursor-agent` call. The UI cannot be fast because the LLM is on the critical path.

The reframe: **the LLM's job moves from answering questions to authoring the space the questions range over.** Jev then positions within that space. Rendering is not a stage — in Marble, the alternatives are already in the file, so a Jev decision is one attribute write.

Two spaces, stated once:

| | Space₀ — the Atlas | Space₁ — an app space |
|---|---|---|
| What | Universal design space of UI patterns | The subset of Space₀ one app implements |
| Size | 119 entries, 2 918 variations | Typically 5–25 decisions, 2–6 options each |
| Authored by | Corpus + method (exists) | An LLM, once per app, slowly |
| Positioned by | — | Jev, per request/context, in one round trip |
| Lives as | `atlas.json`, `schemas/*.schema.json` | A `.mrbl` document whose attribute vocabulary *is* the space |

Success is measured on Space₁ → position, not on authoring:

- **G1 Speed.** `POST /genui/decide` on a document with ≤ 24 live decisions: p50 < 400 ms, p95 < 1 s end to end (one TypeSafe request + one file write + the open page moving). Logged per call.
- **G2 No LLM in the fast path.** Structural: the decide path imports nothing from `llm.js`, and a test asserts no `complete` is ever invoked.
- **G3 Re-decide reacts.** Changing `context` (viewport, item count, data shape) and deciding again flips at least one layout-family decision on the fixture. Asserted with a fake gate; judged with the real model in the inspector.
- **G4 Quality.** On the fixture across five context variants, the fraction of decisions above the stop threshold is reported, and a person can say of each result what Monitor's wave rule already asks: *a designer would recognize it as a reasonable first show.* Not automated; the inspector exists to make this judgment cheap.

## 2. Architecture

```
Space₀  atlas.json + schemas/<pattern>.schema.json                (exists)
   │  read by the author skill; read by the question builder
   ▼
Stage A · AUTHOR  (Claude agent turn with the `genui-author` skill; minutes; once)
   input   the person's prompt
   output  <app>.mrbl in the app-space contract (§3):
           every design decision is an attribute on an instance root,
           every option is already implemented in the file,
           every live decision is declared with its options and glosses
   ▼
Stage B · DECIDE  (server; ~100–400 ms; repeatable)
   input   doc path + context {request, viewport, data, signals}
   1  extract the space from the document                  server/genui/space.js
   2  build one TypeSafe request: one Choice per decision,
      shared state, criteria = declared options              server/genui/questions.js
   3  ask Jev (existing askSystemOne)                        server/typesafe/client.js
   4  answers → setAttr ops, gated on confidence             server/genui/decide.js
   5  writeOps(doc, ops, {client:'genui'})                   server/app.js
   ▼
(no render stage) the host wrote the file; open pages move under the person.
```

What json-render taught, applied: Jev sees only ids and glosses; it can never author a string that reaches the screen. Every answer is checked against the offered criteria before anything is written. All questions in a decide go in one request. Unlike json-render, a decision is a **position on a named dimension**, not membership of an element, so the unchosen options stay in the file and can be moved to later — by Jev again, by a person, or by an Atlas technique bound to the same key.

## 3. The app-space contract (what Stage A writes, what Stage B reads)

A document is an app space when it contains at least one **instance root**. Everything else is ordinary Marble.

### 3.1 Instance root

```html
<section data-marble-id="games" data-genui="overview-detail#games"
         data-genui-about="Upcoming and recent 49ers games with the series record per opponent"
         data-open-in="side-by-side"
         data-genui-open-in="side-by-side | pop-up | new-page"
         data-overview-type="grid"
         data-genui-overview-type="grid | list | table"
         data-density="identity-stat"
         data-genui-density="identity: team names and date only | identity-stat: names, date, and the series record | full: every attribute the card has">
```

- `data-genui="<atlas-id>#<instance-name>"` — which Atlas entry this instance is, and a name unique in the document. Nested instances (a card inside the grid) are their own roots: `data-genui="card#game-card"`.
- **A repeated role's root is the container that holds its stamped items** — the `.overview` that holds the cards, the `.tiles` that hold the tiles — never the first item. The fact is written once there and every item derives from it through CSS (`.overview[data-shape="horizontal"] .card {…}`). Monitor's rule, made literal: sixteen games are one Card instance. Putting the fact on the first card and copying it to its siblings is the same-fact-twice bug the doctrine names, and a decide would move one card.
- `data-genui-about` — one authored sentence: what this instance shows. Goes into Jev's state. Optional but the skill always writes it.
- **The fact:** for each live sub-dimension, `data-<key>="<slug>"` on the root. `<key>` is the Atlas sub-dimension key in kebab case (`openIn` → `open-in`). This is the one place the current position lives; CSS and any script derive from it. It is what `setAttr` changes.
- **The declaration:** `data-genui-<key>="<slug>[: gloss] | <slug>[: gloss] | …"`. A slug that matches an Atlas variation name (slugified) needs no gloss — the Atlas gloss is used. A slug that does not (an authored preset for a `sel: many` sub-dimension, e.g. density) must carry one. Two or more options, or the sub-dimension is not live.
- **Slug rule** (one function, used on Atlas names and on declarations alike): lowercase; every run of characters outside `[a-z0-9]` becomes one `-`; leading and trailing `-` trimmed. `Side-by-side` → `side-by-side`, `Sum or average` → `sum-or-average`, `Picture-in-picture` → `picture-in-picture`.
- **Key rule:** the attribute name is the Atlas sub-dimension key in kebab case (`openIn` → `data-open-in`, `overviewType` → `data-overview-type`); the reverse mapping is unambiguous because Atlas keys are camelCase without digits.
- Optionally, `data-genui-request="<the originating prompt>"` on `<body>`, so a document can be re-decided without the caller restating the request. The author skill always writes it.

### 3.2 Implementation of options

Each declared option must be reachable from the fact:

- **CSS:** a rule in any of the document's stylesheets whose selector contains `[data-<key>="<slug>"]` (the validator checks presence, not scoping — scoping the rule under the root is the author's job and is what the skill writes), or
- **Markup:** a `<marble-alt>` under the root whose `data-marble-active` is derived from the fact, with a `data-marble-alt="<slug>"` child per option.

The validator (§4.1) enforces: every declared slug is implemented by one of these; the current value is a declared slug; no live sub-dimension has fewer than two options; instance names are unique; the Atlas id exists and the key is a sub-dimension of that entry (or of an entry it `specializes`).

### 3.3 What is not in the contract

No question text, no rubric prose, no default rationale in the document. The dimension's question (`dims[].q`) and sub-dimension name come from the Atlas at decide time. One fact, one place: variation meaning lives in Space₀; which variations this app implements lives in the document as the CSS/markup that implements them plus one declaration line the validator holds honest.

## 4. Stage B in detail

### 4.1 `server/genui/space.js`

- `extractSpace(source) → { request, instances: [{ name, marbleId, pattern, about, parent, decisions: [{ key, attr, current, options: [{ slug, gloss|null }] }] }] }`. Parses with the same `parseSource` the engine already exports; reads roots by `[data-genui]`; `parent` is the nearest enclosing root's name or `null`.
- `validateSpace(source, atlas) → { ok, issues: [{ instance, key, kind, message }] }`. The rules in §3.2. `kind` ∈ `unknown-pattern | unknown-key | too-few-options | unimplemented-option | current-not-declared | missing-gloss | duplicate-instance`.

### 4.2 `server/genui/questions.js`

`buildQuestions(space, atlas, { request, context }) → { state, questions }`

- **State (shared by every question):**
  ```json
  {
    "request": "<the original prompt, or the document's data-genui-request if present>",
    "context": { "viewport": "phone|tablet|desktop", "items": 16, "...": "anything the caller passes, verbatim" },
    "instances": [{ "name": "games", "pattern": "Overview–detail", "about": "Upcoming and recent…", "children": ["game-card"] }]
  }
  ```
- **One Choice per decision**, id `<instance>.<key>`:
  - `instructions`: an object — `{ instance: "games", pattern: "Overview–detail", about: "…", dimension: "<Atlas dims[].q>", subdimension: "<Atlas subs[].name>", ask: "Choose the best first show for this instance given request and context. Options are the only variations this app implements." }`. Backticked state paths are used where the Atlas question refers to content.
  - `criteria`: `{ "<slug>": "<gloss>" }` for the declared options only. Order preserved from the declaration.
- No `no_match` criterion: every option is implemented and one must be shown; the authored default is the no-match. A low-confidence answer keeps it (§4.3). *Recorded decision — see §10.*
- `sel: many` sub-dimensions are never multi-choice. The author declares named presets (Monitor's compile contract); each preset is one option.

### 4.3 `server/genui/decide.js`

`answersToOps(space, answers, { stop = 0.75 }) → { ops, decisions: [{ id, choice, confidence, applied, reason }] }`

- Refuse an answer whose `choice` is not one of that question's offered slugs (throw; mirrors json-render's evaluator and this repo's `gateWithRepair` posture — a wrong-shaped answer is a bug, not data).
- `applied = confidence ≥ stop && choice !== current`. Reasons: `applied | kept-low-confidence | kept-unchanged`.
- One `setAttr` op per applied decision: `{ type: 'setAttr', id: <root marbleId>, name: 'data-<key>', value: <slug> }`.
- `stop` defaults to the pipeline's 0.75 and is per-request. Confidence is TypeSafe's own for Choice (`gateConfidence` already does this).

### 4.4 `server/genui/routes.js`

Created in `createDrive` beside `createTypesafeHandler`, handed `{ store, atlas, apiKey, writeOps }`. Like the typesafe handler it accepts an `ask` override (`createDrive(config, { genui: { ask } })`) so the HTTP and browser tests run against a fake gate with no network and no key.

- `GET /genui/space?doc=<path>` → `{ space, validation }`. For the inspector and the author skill's self-check.
- `POST /genui/decide` body `{ doc, request?, context?, stop?, dry? }` →
  `{ decisions, ops, applied, elapsedMs, usage }`.
  `dry: true` builds and asks but does not write — the inspector's preview. Otherwise `writeOps(doc, ops, { client: 'genui' })`; the page moves because that is what `writeOps` does.
  Errors use `explainTypesafeFailure`; a validation failure is 422 with `issues`.
- Every decide appends one line to `.marble/<docKey>.genui.jsonl`: `{ at, doc, context, stop, decisions, elapsedMs, usage }` — the same posture as `intents.jsonl`: a record of what the model does, to improve against.

### 4.5 Atlas access — `server/genui/atlas.js`

`loadAtlas(path)` reads `atlas.json` once and indexes entries by id, sub-dimensions by key, and slugified variation names → gloss. Resolves a key through `relations.specializes` so `inbox` can use an `overview-detail` sub-dimension. Path from config `genuiAtlas`, default `<root>/Research/Design Pattern Generation/atlas.json`; tests use `test/fixtures/genui/atlas.mini.json`.

## 5. Stage A — the author skill

`.agents/skills/genui-author/SKILL.md`, loaded by the existing Claude agent (the `full` provider in `server/agent/providers/claude.js`). No new LLM plumbing: the agent already has the marble MCP, the `build-in-marble` skill, projects, streaming, and permission prompts routed to the drawer.

The skill says, in order:

1. Read the prompt. Pick the root pattern from the Atlas the way `genui/prompt.md` already says (archetype → pattern), reading `schemas/<id>.schema.json`. Prefer coded evidence. Spawn child instances only from the pattern's `relations.uses` and only when a chosen variation needs them (Monitor's spawn policy).
2. For each instance, choose which sub-dimensions are live — the ones a reasonable person or context would move — and which 2–6 options to implement per live sub-dimension. Everything else is fixed at one authored value and not declared.
3. Write the document in the app-space contract (§3): roots, facts, declarations, and a real implementation of every option. Use `<marble-alt>` for structural alternatives and attribute-scoped CSS for the rest. Bind content by role the way `binding` does in the GenUI grammar; never author content strings the data should supply.
4. Set authored defaults — the first show if Jev never runs.
5. Run `node bin/marble-drive.js genui space <file>` and fix every issue until it reports `ok`.
6. Run `node bin/marble-drive.js genui decide <file> --dry` and read the confidences. A decision that comes back near-uniform is a space-authoring smell: the options are indistinguishable from the glosses, or the sub-dimension should not be live. Fix the document, not the question.

Step 6 is where the json-render comparison lands: a decision that would have needed a split is repaired at authoring time, never at runtime.

## 6. The inspector — `drive/Research/TypeSafe AI/Decide.mrbl`

Monitor's "Sandbox" stage, minimal. A research document, same visual language as Monitor/Run:

- Pick a document with instance roots (from `/docs`, filtered by `GET /genui/space`).
- Context fields: viewport (choose), items (step), free-text signals (editable). Stop threshold dial (reuse Monitor's).
- **Decide** and **Preview** (`dry`). Per decision: instance · sub-dimension · options with probability bars (reuse Monitor's `.bars`) · confidence · `applied / kept`. Elapsed ms in the corner.
- The target document is opened beside it (a `data-go-doc` link, like Run's). Pressing Decide and watching the other tab move is the demo.

Facts in the file: chosen doc, context, stop. Results are transient (they are a record on the server, not document state).

## 7. Fixtures — three hand-authored spaces across the Atlas, not one pattern

Nothing in Stage B is specific to overview–detail: the extractor, validator, question builder and gate read any Atlas entry. The fixtures have to prove that, so there are three, mirroring the three worked examples the GenUI pack already ships (`genui/examples/{overview-detail,dashboard,ai-chat}.json`) but chosen to cover four archetypes and a `specializes` chain:

| Fixture | Archetype(s) | Instances | Decisions | What it proves |
|---|---|---|---|---|
| `49ers.mrbl` | browse-collections | `overview-detail#games`, `card#game-card` | 8 | Monitor's Wave 0; a nested component; a `sel: many` preset |
| `metrics.mrbl` | monitor, analyze | `dashboard#ops`, `stat-tile#kpi`, `chart#trend` | 9 | A pattern that is not overview–detail; a variation-triggered child (`widgets` includes charts → a chart instance) |
| `signup.mrbl` | enter-data | `wizard#signup`, `stepper#steps` | 7 | A key inherited through `specializes` (`wizard` → `form`: `labels`), so the codebook resolves up the chain on a real entry |

All three are tracked under `test/fixtures/genui/` and seeded into `drive/Research/TypeSafe AI/Spaces/` for the inspector. The mini Atlas the tests use is **cut from the real `atlas.json`** by a script, not typed by hand, so the keys and glosses are the codebook's own.

Built **before** the author skill. The order is the honest one: prove Stage B is fast and correct on spaces a person wrote, across patterns, then automate the writing.

The author skill (§5) is told the root set explicitly — Monitor's Wave 3 list, not all 60 — and told to reach any pattern in it: form, wizard, dashboard, search-results, chat-thread/ai-chat, calendar, settings, media-player, checkout, overview–detail, kanban-board, inbox. A prompt that names an activity rather than a widget goes through the archetype first.

## 8. Tests

Unit (`node --test`, matching `test/typesafe-*.test.js` idiom; fakes, no network):

- `test/genui-space.test.js` — extract: roots, keys kebab→camel, declarations with and without glosses, nested instances, `about`. Validate: **all three fixtures pass**; every `kind` in §4.1 has a failing fixture and a passing one; CSS-implemented and `<marble-alt>`-implemented options both count; a `wizard` key inherited from `form` validates.
- `test/genui-questions.test.js` — one question per decision; criteria are exactly the declared slugs in declared order; Atlas gloss used when slug matches, authored gloss otherwise; `specializes` resolves keys; state carries request, context verbatim, instance summaries; no question mentions TypeSafe or confidence.
- `test/genui-decide.test.js` — off-menu choice throws; below-stop keeps; unchanged keeps; applied yields one setAttr with the root's marble id; `stop` per call; G2: a spy `complete` is never called.
- `test/genui-http.test.js` — temp store + fake `fetch` for TypeSafe (the `typesafe-http.test.js` pattern): `GET /genui/space` returns validation; `POST /genui/decide` writes the file (read it back, attribute changed), logs one line, returns `elapsedMs`; `dry` writes nothing; no key → 503 with the existing explanation; invalid space → 422 with issues.

Browser (`test-browser/genui-decide.test.js`, via `startDrive` in the harness):

- Serve the fixtures; open `49ers`; POST decide with a fake gate that flips `open-in` to `pop-up`; assert the live page's root has `data-open-in="pop-up"` and the detail is positioned as the pop-up rule says — **without reload**. Then decide with a different context and a gate that flips back; assert G3. Repeat once on `metrics` (dashboard `arrangement` flips to `single-scrolling-column` on a phone) so the page-moves proof is not overview–detail-only.

Manual, in the inspector (real model, real key):

- Five contexts on the fixture: phone/3 items, phone/30, desktop/3, desktop/30, desktop/30 with "I care about the series record". Record per-decision confidence and whether the first show is reasonable. This is G4 and it is a judgment; the record goes in `Decide.mrbl` as editable notes.

## 9. Files

```
server/genui/
  atlas.js        load + index atlas.json; slug ↔ gloss; specializes
  space.js        extractSpace, validateSpace
  questions.js    buildQuestions
  decide.js       answersToOps
  routes.js       GET /genui/space, POST /genui/decide, genui.jsonl record
server/app.js     create the handler; pass store, atlas, apiKey, writeOps  (one hunk)
server/config.js  genuiAtlas path                                           (one hunk)
bin/marble-drive.js   `genui space <file>` and `genui decide <file> [--dry] [--stop N] [--context JSON]`
                  — the same modules, no host needed; what the author skill and a person at a
                  terminal use. `.env`/`.env.local` are loaded the way `npm run dev` loads them.
.agents/skills/genui-author/SKILL.md
test/fixtures/genui/{49ers,metrics,signup}.mrbl, atlas.mini.json   (mini atlas cut from the real one by tools/genui-mini-atlas.mjs)
tools/genui-mini-atlas.mjs                                            cut the entries the fixtures use out of atlas.json
test/genui-{space,questions,decide,http}.test.js
test-browser/genui-decide.test.js
drive/Research/TypeSafe AI/Decide.mrbl                                   (untracked; drive is gitignored)
drive/Research/TypeSafe AI/Spaces/49ers.mrbl                             (seeded copy of the fixture)
```

`app.js` is shared with the other live session (agents-ui-overhaul); the hunk is one handler creation next to `createTypesafeHandler` and one `route.startsWith('/genui/')` dispatch. Check `ListAgents` before touching it.

## 10. Decisions and why

| Decision | Alternative rejected | Why |
|---|---|---|
| The document *is* the space; decisions are attributes on instance roots | A sidecar `space.json` next to the `.mrbl` | One fact one place. The attribute is what CSS reads and what `setAttr` changes; a sidecar would be a second copy that drifts. Hand-editable, and the diff of a decision is one attribute. |
| Options are declared in `data-genui-<key>` and validated against the implementation | Derive options by parsing selectors and `<marble-alt>` children | Parsing is clever and brittle; a declaration is legible and the validator catches drift in either direction. |
| Glosses come from the Atlas when the slug matches; authored only for presets | Author every gloss in the document | Variation meaning lives in Space₀. Duplicating it in every app space is the same drift problem, and the Atlas glosses were coded. |
| No `no_match`; low confidence keeps the authored default | Offer `keep-default` as a criterion | Every option is implemented and one must show. A keep criterion muddies the distribution over real options; the confidence gate already expresses "not sure, leave it". |
| Stage A is an agent skill, not new server code | A bespoke prompt through `llm.js`/cursor-agent | The agent can write the file, run the validator, dry-decide, and fix — a loop. `llm.js` is text-only and 180 s per call. No new plumbing. |
| Jev's decision is a host-side file write (`writeOps`) | The document posts to a route and applies ops client-side | Doctrine: a document names no route. The host writing the file and the page moving is the mechanism Marble already has; the generated app needs no decide script at all. |
| One TypeSafe request per decide, all decisions parallel | One request per instance, or per depth | Every decision ranges over the same state and none depends on another's answer. json-render's pass 1. Depth here is authoring-time structure, not a runtime barrier. |
| Fixture first, skill second | Skill first | Speed and correctness of Stage B are the thesis. Proving them on a hand-written space removes the LLM as a confound. |
| `stop` default 0.75 | 0.60 (harmless-preference posture) | Consistent with the pipeline and Monitor's dial. Per-request override exists; the inspector's dial finds the right value on real runs. |

## 11. Out of scope, parked on purpose

- **Runtime splitting.** `pipeline.js` and Grok stay for research. In this design a decision that keeps needing a split is an authoring defect, fed back to Stage A (step 6), never split at decide time. If Wave 1 shows real decisions that are unanswerable without a split, revisit.
- **Techniques / end-user customization** bound to the same keys (Atlas stage 7). The contract is built so they can be: a technique is a `setAttr` on the same fact. Not wired here.
- **Content generation.** Data is bound by role; no model writes copy. Stage A binds; Stage B never touches content.
- **Streaming decide.** One request, one write. If a space grows past what one request answers, batch by instance — not needed for ≤ 24 decisions.
- **Multi-document spaces**, cross-instance constraints (a choice on the grid forbidding one on the card). Declare fewer options instead; revisit if the fixture needs it.
- **Space₀ changes.** The Atlas is read-only to this work. Corpus fixes go through its own build/extract.

## 12. Milestone check-in — what Bryan decides

1. The document-is-the-space contract (§3) — this is the expensive-to-reverse one. Everything else follows from it.
2. Running the author skill on the 49ers prompt for real (Stage A, §5) spends subscription usage and is not needed for tasks 1–3 of the plan; I'll ask again before the first real run.
3. This spec is written but **not committed**: the other live session has `agents-ui-overhaul` waiting to fast-forward into `main`, and a new commit on `main` would block that. Say the word and I'll commit it, or commit it once they've landed.
