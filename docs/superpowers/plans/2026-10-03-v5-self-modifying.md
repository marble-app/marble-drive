# v5: Self-modifying interfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build v5 of Ask at Anything: changes are marked part by part and played by a transition engine, ⌘J is one flush line, a finished change leaves nothing behind but is drawn on request with Keep/Undo/Change more, style changes commit as one rule from a hand or a few words, and per-part judgment fans out to parallel workers.

**Architecture:** The server enriches what it already sends (presence frames gain the turn, the finest parts, step, count, reach, total; turns keep their parts for review; undo gains redo). Five new page modules ride on that: `change-morph.js` (engine), `change-marks.js` (tints, tag, rail; replaces the zone box), `change-line.js` (the ⌘J line; replaces the card for asks), `change-review.js` (the change on request), `change-rules.js` (find/mark/commit and Reshape). `fan_out` is a new agent tool. Existing files lose the trail, the "Agent ·" labels and the ⌘J card.

**Tech Stack:** Node 22 ESM server (no framework), plain browser JS in `runtime/` served raw (no bundler), Web Animations API, CSS Custom Highlight API, Popover API, `node:test` + Playwright browser tests (`test-browser/harness.js`, fake agent `test/fixtures/fake-agent.mjs`).

**Spec:** `Notes and Sketches/Ask at Anything.mrbl` in the drive, section v5 (read its text with `python3` stripping tags, see the README of this plan below), and `docs/superpowers/specs/2026-10-03-v5-self-modifying-design.md` (decisions for open questions, what is not built).

**Worktree:** `~/Development/3rd-year-projects/marble-drive/.claude/worktrees/v5`, branch `v5-self-modifying` from `origin/main` (fd2767e). `node_modules` is a symlink to the main checkout's; `../marble` resolves through `.claude/worktrees/marble`.

## Global Constraints

- Words on the page never say "Agent", "AI", "thinking" or a model name where a change happens (tag, box label, caret, line, review bar). The chat itself is unchanged.
- No fingernails: no coloured border on one side of anything, no `inset Npx 0` shadows. Tints are fills; edges are a full 1px ring.
- Colour: only the document's own `--accent` / `--accent-ink` (fallbacks `light-dark(#9bb6cf, #7fa8c9)` / `light-dark(#738698, #9dc0dc)`), its greys, and `--danger` for a failure. No violet, no gradients doing a colour's job.
- Motion clocks: `--ease-out: cubic-bezier(.22, 1, .36, 1)` for arriving/settling, `cubic-bezier(.22, .61, .36, 1)` for colour; 110/200/340/520 ms; tints lift over 900 ms; nothing pulses at rest; `prefers-reduced-motion: reduce` → one 150 ms crossfade per change, state still legible.
- Under a hand nothing eases: dragged values track one to one; commit on release only.
- Every overlay element a script creates carries `data-marble-transient` and lives outside the document's addressed tree (a fixed layer or the top layer). Nothing a mark draws is ever filed as an op.
- Runtime CSS is inline in each runtime file (a `STYLE` string), as the existing files do.
- New runtime files are added to the `RUNTIME` map and to `injectCarrier` in `server/app.js`, in the agent group right after `agent-text.js`, in this order: `change-morph.js`, `change-marks.js`, `change-line.js`, `change-review.js`, `change-rules.js`.
- Browser tests run one file at a time locally: `node tools/browser-tests.mjs test-browser/<file>.test.js`. Unit tests: `npm test`. Baseline on origin/main: 1 failing unit test (`agent-http.test.js` "an edit you made while the turn ran forks the agent's rewrite") — leave it as found.
- Commit after each task with a message in the repo's style (a plain sentence saying what changed, e.g. "Marks: each part is tinted as it changes"), ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never edit another chat's worktree or the main checkout's uncommitted files.

## The shared contract: a v5 presence frame

Every task reads or writes this. All new fields are optional; a page that does not know them ignores them.

```js
// document event `marble:presence` detail, and the SSE `presence` frame
{
  client: 'agent:<conversationId>' | 'agent-undo:<conversationId>',
  ids: ['…'],                 // as today; [] clears the client's presence
  label, phase,               // as today: 'working' | 'reading' | 'writing' | 'acting'
  note,                       // as today, the apply_ops note
  // v5
  turn: '<conversationId>-t<n>',
  stage: 'start' | 'before' | 'after' | 'end',
  prompt: 'what was asked, whole, ≤300 chars',      // stage 'start' only
  parts: ['finest ids this batch changes'],           // 'before' and 'after'
  inserts: [{ parentId, beforeId, ids: ['root ids'] }],
  removes: ['ids'],
  moves: ['ids'],
  kind: 'words' | 'look' | 'attr' | 'structure' | 'mixed',
  step: { n: 2, of: 4, text: 'lay out the three columns' } | null,
  count: 7,                   // distinct parts this turn has touched, this batch included
  total: 15 | null,           // apply_ops `total`, remembered for the turn
  reach: ['ids'] | null,      // apply_ops `reach`, the step's parts sent ahead
  failed: ['ids'],            // fan_out: parts whose shard failed
  done: { status: 'completed' | 'failed' | 'cancelled', changed: 3, added: 1, removed: 0 }, // stage 'end'
}
```

Order on one document's SSE stream for one batch: `stage:'before'` presence (from `prepare`, before the write) → `ops` frame (carrier applies, then dispatches `marble:ops {ops, client}`) → `stage:'after'` presence. The page snapshots on `before` and plays on `marble:ops`.

## Review Focus

- **Long or whole-page edits:** a `setInner` that rewrites a big block, or 60+ parts in one turn — expect the page to stay responsive: the engine skips motion past its budget (60 parts / 300 restyled elements) and marks fall back to margin dots past 12 parts. Tests in Task 4 (budget) and Task 3 (many mode).
- **The person editing inside a part the agent is changing:** expect no tint, no animation, no review drawing on that part while the caret is in it, and the person's text never overwritten by an animation. Tests in Tasks 3, 4 and 6.
- **Reload mid-change and after a change:** a tab opened during a run gets the run from `/presence` catch-up; a tab opened after gets the unreviewed change from `/agent/review`. Tests in Tasks 3 and 6.
- **Esc meaning two things:** Esc in the line puts it away (keeping words); Esc while a change from the line runs stops it — but Esc while focus is in any other input, menu or dialog must do what that thing does and never stop a change. Test in Task 5.
- **Undo after the person edited:** Undo of a turn whose parts the person changed afterwards keeps the person's edits (server rule, unchanged) and the review drawing excludes those parts. Tests in Tasks 2 and 6.

---

## Phase A — the server says more

### Task 1: Finest parts, step and count on every agent batch

**Files:**
- Create: `server/change/parts.js`
- Modify: `server/agent/tools.js` (schema of `apply_ops`; `apply_ops` and `read_document` handlers), `server/app.js` (`writeOps` accepts `options.presence`), `server/agent/runner.js` (turn start and end looks), `server/agent/undo.js` (a `look` before each undo batch)
- Test: `test/change-parts.test.js` (new), `test/agent-tools.test.js` (extend), `test/agent-runner.test.js` (extend)

**Interfaces:**
- Produces `partsOf(source, ops) → { parts, inserts, removes, moves, kind }` from `server/change/parts.js`.
- Produces `parseStep(note) → { n, of, text } | null` from `server/change/parts.js`. Accepts "Stage 2 of 4: …", "Step 2 of 3 — …", "Stage 2/4: …" (case-insensitive); `text` is the rest, trimmed of leading punctuation; null otherwise.
- Produces the v5 presence fields above on: turn start (`stage:'start', turn, prompt`), each read (`phase:'reading', turn`), each `apply_ops` batch (`stage:'before'` from prepare, `stage:'after'` from `writeOps`), turn end (`stage:'end', turn, done`), each undo batch (`client:'agent-undo:<conv>', stage:'before'` then `'after'`, `turn`).
- `apply_ops` input gains optional `reach: string[]` (≤200; ids must exist in the document, unknown ones dropped silently) and `total: integer ≥ 1`.

Rules for `partsOf`:
- `setText {id}` → part `id`, kind `words`.
- `setAttr {id, name}` → part `id`, kind `look` when `name` is `style` or `class`, else `attr`.
- `setInner {id, html}` on `<style>`/`<script>` → part `id`, kind `look`/`attr`.
- `setInner {id, html}` otherwise: compare addressed descendants. Use the engine's `hashesOf(source, ids)` for the old and `hashesOf(html, ids)` (or a fragment parse via the marble engine already imported in `server/engine.js`) for the new. Changed = ids in the new html whose hash differs or that are new; removed = ids in the old subtree missing from the new. If changed ∪ removed is non-empty and ≤60, parts = the topmost of them (drop any id whose ancestor is also in the set) and removed ones go to `removes`; otherwise part `id`. Kind `words` when neither old nor new inner has element children with ids and the text differs, else `structure`.
- `insert {html, parentId, beforeId}` → parts = root ids of `html` (`idsIn` first-level roots), one `inserts` entry; kind `structure`.
- `remove {id}` → part `id`, `removes: [id]`; `move {id}` → part `id`, `moves: [id]`; kind `structure`.
- Mixed kinds in one batch → `mixed`. Parts deduped, document order.

- [ ] **Step 1: Write failing unit tests for `partsOf` and `parseStep`** in `test/change-parts.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { partsOf, parseStep } from '../server/change/parts.js';

const DOC = `<!doctype html><html><head><style data-marble-id="st">.a{}</style></head><body data-marble-id="b">
<ul data-marble-id="ul"><li data-marble-id="l1">One</li><li data-marble-id="l2">Two</li><li data-marble-id="l3">Three</li></ul>
<p data-marble-id="p">Hello <b data-marble-id="pb">there</b></p></body></html>`;

test('setInner on a list narrows to the rows that changed', () => {
  const ops = [{ type: 'setInner', id: 'ul', html: '<li data-marble-id="l1">One</li><li data-marble-id="l2">Deux</li><li data-marble-id="l3">Three</li>' }];
  const r = partsOf(DOC, ops);
  assert.deepEqual(r.parts, ['l2']);
  assert.equal(r.kind, 'structure');
});
test('setInner that drops a row names it removed', () => {
  const r = partsOf(DOC, [{ type: 'setInner', id: 'ul', html: '<li data-marble-id="l1">One</li><li data-marble-id="l3">Three</li>' }]);
  assert.deepEqual(r.removes, ['l2']);
});
test('insert names its roots and where they land', () => {
  const r = partsOf(DOC, [{ type: 'insert', parentId: 'ul', beforeId: 'l2', html: '<li data-marble-id="n1">New</li>' }]);
  assert.deepEqual(r.parts, ['n1']);
  assert.deepEqual(r.inserts, [{ parentId: 'ul', beforeId: 'l2', ids: ['n1'] }]);
});
test('style and class are a look; other attributes are attr; text is words', () => {
  assert.equal(partsOf(DOC, [{ type: 'setAttr', id: 'p', name: 'class', value: 'x' }]).kind, 'look');
  assert.equal(partsOf(DOC, [{ type: 'setAttr', id: 'p', name: 'title', value: 'x' }]).kind, 'attr');
  assert.equal(partsOf(DOC, [{ type: 'setText', id: 'pb', text: 'you' }]).kind, 'words');
  assert.equal(partsOf(DOC, [{ type: 'setInner', id: 'st', html: '.a{color:red}' }]).kind, 'look');
});
test('parseStep reads the stage out of a note', () => {
  assert.deepEqual(parseStep('Stage 2 of 4: lay out the three columns, empty.'), { n: 2, of: 4, text: 'lay out the three columns, empty.' });
  assert.deepEqual(parseStep('step 1/3 — read it'), { n: 1, of: 3, text: 'read it' });
  assert.equal(parseStep('Rename the heading.'), null);
});
```

- [ ] **Step 2: Run** `node --test test/change-parts.test.js` — expect FAIL (module missing).
- [ ] **Step 3: Implement `server/change/parts.js`** with the rules above, importing `hashesOf`, `idsIn` (and whatever fragment parse the engine offers) from `../engine.js`. Keep it pure.
- [ ] **Step 4: Run** the test — PASS.
- [ ] **Step 5: Write failing tests** in `test/agent-tools.test.js` for the frames: drive `apply_ops` with a stub `onLook` and a stub `writeOps` that records `options.presence`, and assert (a) the prepare look carries `{stage:'before', turn, parts, kind, count, step, total, reach}`; (b) `count` accumulates distinct parts across two calls in one turn; (c) `reach` drops ids not in the document; (d) `total` given once is repeated on later batches of the same turn; (e) the schema lists `reach` and `total`. In `test/agent-runner.test.js` assert the turn-start look has `stage:'start'`, `turn`, `prompt` (cut to 300) and the end look `ids:[]`, `stage:'end'`, `done.status`, `done.changed/added/removed` (counted from the turn's batches: added = insert roots, removed = removes, changed = other parts).
- [ ] **Step 6: Implement.** In `tools.js` keep per-turn state on the live turn object: `turn.v5 = { parts: new Set(), added: new Set(), removed: new Set(), total: null, reach: null }`. In `apply_ops.prepare`, after the ledger check, compute `partsOf(source, ops)`, update `turn.v5`, and call `onLook(docPath, idsOfOps(ops), client, { phase:'writing', note, turn: turn.id, stage:'before', parts, inserts, removes, moves, kind, step: parseStep(input.note), count: turn.v5.parts.size, total, reach })`; pass the same object minus `stage` as `options.presence` to `writeOps` with `stage:'after'`. In `app.js` `writeOps`, merge `options.presence` into the post-write payload when the client starts with `agent`. `onLook` in `app.js` must forward the extra fields untouched (check `rememberLook`/`toPresence` copy the whole object; fix if they pick fields). `read_document`'s looks add `turn`. Runner: the start look adds `stage:'start', turn: turn.id, prompt: String(turn.prompt ?? '').slice(0, 300)`; the end look adds `stage:'end', turn: turn.id, done: { status, changed, added, removed }` from `turn.v5`. Undo: give `undoTurn` an optional `look(ids, extra)` and call it in each path's `prepare` with the inverse ops' ids and `{ stage:'before', turn, parts: ids }` — wire it in `routes.js` to the same `onLook` with client `agent-undo:<conv>`; pass `presence: { stage:'after', turn, parts }` to its `writeOps`.
- [ ] **Step 7: Update the `apply_ops` schema** in `TOOL_SCHEMAS`: `reach: { type:'array', items:{type:'string'}, maxItems:200, description:'Ids this step will touch, sent with its first batch, so the page can show the whole reach before anything changes.' }`, `total: { type:'integer', minimum:1, description:'How many parts the whole change will touch, when you know it (e.g. 15 stills). The page counts toward it.' }`. Leave `required` as it is.
- [ ] **Step 8: Run** `npm test` — all pass except the known baseline failure.
- [ ] **Step 9: Commit** "Agent edits say which parts they touch, the step, a count, and what is coming".

### Task 2: Turns keep their parts for review; Keep, and Redo

**Files:**
- Create: `server/change/review.js`
- Modify: `server/agent/store.js` (turn record `keptAt`), `server/agent/routes.js` (three routes), `server/agent/undo.js` (redo record), `runtime/agent.js` (`review`, `keep`, `redo` on `marble.agent`)
- Test: `test/change-review.test.js` (new), `test/agent-http.test.js` (extend)

**Interfaces:**
- `GET /agent/review?path=<docPath>` → `{ turns: [ReviewTurn] }`, newest first, at most 20, finished within 30 days.
  ```js
  ReviewTurn = { id, conversationId, prompt /*≤300*/, finishedAt, parts: [ReviewPart] }
  ReviewPart =
    | { id, kind: 'added' }
    | { id, kind: 'words' | 'changed', before /*old inner html*/ }
    | { id, kind: 'look' | 'attr', name, before /*old value or null*/ }
    | { id, kind: 'removed', html, parentId, beforeId }
    | { id, kind: 'moved', parentId, beforeId /*where it was*/ }
  ```
  A turn is listed when: its path (target, or any `steps[].path`) is `docPath`; status `completed` (or `cancelled`) with `applied > 0`; `undoneAt` and `keptAt` are null; and the conversation's `lastReviewedAt` is null or earlier than the turn's `finishedAt`. Parts come from the turn's `.undo.json` steps for that path: the **first** step per id gives `before` (the original), inverse `remove` → `added`, `setInner` → `words` when the old html has no `data-marble-id` and the element's current inner has none, else `changed`; `setAttr` → `look` for style/class else `attr`; `insert` → `removed` (id = the removed element's id, `html` = the inverse's html); `move` → `moved`. A part is dropped when its element is now absent (except `removed`), or when its current hash differs from the last step's `expect` for that id (the person changed it since — it is theirs). A turn with no parts left is not listed.
- `POST /agent/turns/:id/keep` → `{ ok: true }`; sets `keptAt`. If no other unreviewed turn of that conversation is listed for any path, also sets the conversation's `lastReviewedAt` (clears the launcher dot).
- `POST /agent/turns/:id/redo` → `{ reverted, kept }` like undo; 409 unless `undoneAt` is set and `<turn>.redo.json` exists. Clears `undoneAt`, deletes the redo record, emits `turn.redone`.
- `undoTurn` saves `<turnId>.redo.json` (same shape as `.undo.json`) built from `inverseSteps(sourceBeforeEachInverse, [inverse])` for every inverse it applied.
- `marble.agent.review(path)`, `marble.agent.keep(turnId)`, `marble.agent.redo(turnId)` in `runtime/agent.js`.

- [ ] **Step 1: Failing unit tests** in `test/change-review.test.js` for `reviewPartsOf({ source, steps })` (pure function in `server/change/review.js`): added, words with `before`, look with old class, removed with `html/parentId/beforeId`, moved, "first step wins" when one id has two steps, a part dropped when the current hash ≠ the last `expect`, a part dropped when absent.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `reviewPartsOf` and `listReview({ store, docPath, read })`. **Step 4:** PASS.
- [ ] **Step 5: Failing HTTP tests** in `test/agent-http.test.js` using the existing fake-agent setup: a turn that inserts a row and renames a heading → `GET /agent/review?path=garden` lists one turn with `added` and `words` parts; `POST keep` → list empty and the conversation's `needsReview` false; undo → list empty; `POST redo` → the row is back in the file, list shows the turn again; redo twice → 409; a person's later `setText` on the heading → its part drops from the list.
- [ ] **Step 6: Implement** the routes (route table in `routes.js` next to `/agent/turns/:id/undo`), the `keptAt` field (default null in `createTurn`), redo saving in `undo.js`, and the three `marble.agent` calls.
- [ ] **Step 7: Run** `npm test` — pass (baseline failure aside).
- [ ] **Step 8: Commit** "Review: each turn keeps what it changed, to keep, undo or redo from the page".

---

## Phase B — the page marks each part

### Task 3: `change-marks.js` — tints, the counting tag, the rail; collab steps aside

**Files:**
- Create: `runtime/change-marks.js`
- Modify: `runtime/collab.js` (skip claimed clients; remove the trail; labels without "Agent ·"), `runtime/agent-text.js` (caret tag without "Agent ·"), `server/app.js` (`RUNTIME`, `injectCarrier` order), `test/agent-http.test.js:712` (injection order), `test-browser/collab.test.js`, `test-browser/callout.test.js`, `test-browser/agent-text.test.js`, `test-browser/act-feedback.test.js`, `test-browser/conversation.test.js` (expectations that assert the old box/trail/"Agent ·")
- Test: `test-browser/change-marks.test.js` (new)

**Interfaces:**
- Consumes the v5 presence frames (Task 1); `marble.agent.attending(conversationId)`, `marble.agent.open(id)`; `window.marbleText.claims(client)`; `window.marbleMorph` (Task 4) when present: `capture(ids, opts)` / `play(snapshot, opts)`.
- Produces `window.marbleChange = { claims(client) → boolean, runs() → Array<{client, turn, count, total}>, tintFor(id) → 'soon'|'now'|null }` and the DOM: one fixed layer `div.marble-change-layer[data-marble-transient][aria-hidden=true]` holding `i.marble-change-tint[data-state=soon|now|lift]`, `i.marble-change-dot`, `div.marble-change-tag`, `div.marble-change-rail`; the tag is a `button` (it opens the conversation) with `aria-label`.
- Produces document events `marble-change:landed {client, turn, ids}` (after a batch's parts finished moving) and `marble-change:end {client, turn, done}`.

Behaviour (the spec's "The marks, from reading to done" and the replay):
- A run starts on the first frame with a `turn` from an **attended** `agent:` client (`attending`), or any `agent-undo:` client. Unattended: draw nothing (glints keep their pref).
- `stage:'start'` with ids on the page → a light tint shaped to each id, out 6px past its edge (radius = its radius + 6), and the tag (time only) hung from the first. Without ids on the page → no tint; the tag hangs at the top-left of the viewport content area only once there is a part to hang it from.
- `phase:'reading'` → tag text "Reading N parts" (N = distinct ids read this turn); nothing else drawn over the words.
- `stage:'before'`: `reach` ids (if any, first time) → light tints all at once, each fading in after a random 0–380 ms. The batch's `parts` → `now` (22% fill + 1px `--accent-ink` ring at 26%). Start-stage scope tints fade out when the first part is marked. Call `marbleMorph.capture(parts, frame)` if present.
- On `marble:ops` from that client: `marbleMorph.play(snapshot, { onPart(id, 'end') })` if present; each part lifts (fade 900 ms) when its motion ends; without the engine, lift 300 ms after the ops.
- `stage:'after'` with `inserts` → tint the inserted roots `now`, then lift as above.
- Many mode: once a run's distinct parts > 12, new parts get a 5px dot in the left margin (`soon` faint, `now` ring, landed solid) and only `now` parts are tinted.
- The tag: one per run. Content: a 6px dot, then the text, a 40px meter when `total` is known, step tiles when `step.of` is known (done filled, current half), and the elapsed `m:ss`. Text = `<Verb> <n>[ of <total>] <unit>`: verb from the batch kind — words "Rewriting", look "Restyling", attr "Changing", structure with only inserts "Adding", only removes "Removing", else "Changing"; reading "Reading". Unit: from the parts' tag (`li`/`tr` rows, `td`/`th` cells, `p` paragraphs, `h1`–`h6` headings, `img`/`picture`/`figure` pictures, `section` sections, `button` buttons, `input`/`select`/`textarea` fields, `a` links, `svg` drawings, `[data-marble-kind=x]` → `x` + "s"), else "parts"; singular for 1. Placement: on a part with a border, across its top edge 16px in; on words, hanging just above the first line; kept 8px inside the viewport; glides 400 ms ease-out between parts. Rest (350 ms) or focus opens a status card under it: what was asked (whole), `m:ss`, and the steps named so far (done ✓ filled, current ink, the rest as "and N more" when `step.of` is ahead of what was named). A press opens the conversation (`marble.agent.open(conversationId)`). The tag never says Agent.
- `stage:'end'` → tag text from `done` ("3 changed · 1 added"; "Stopped · 2 changed" for cancelled; "Didn't finish" for failed with nothing changed), then after 2.2 s every mark of the run fades (220 ms) and the run is forgotten. Dispatch `marble-change:end`.
- The rail: while a run has parts outside the viewport, a 2px rail inside the right edge of the window with a tick per part at its document position (faint ahead, solid landed, wider for now) and a pill "N below" / "N above" (an `svg` chevron, `currentColor`) that scrolls the next out-of-view part into view on press (`scrollIntoView({block:'center', behavior:'smooth'})`). The page never scrolls by itself.
- The person's hand: a part containing `document.activeElement` (or the selection's anchor when it is in a contenteditable) is not tinted while it does.
- `html.marble-zones-off` (Hide work) hides the whole layer.
- `claims(client)` is true while a run for that client has at least one tint, dot or tag on the page. `collab.js` `zonesToPaint` skips claimed clients exactly as it skips `inText`, and repaints on `marble-change:claims`.
- Catch-up: on boot, fetch `/presence?app=` (as collab does) and start runs from its frames.
- Text work stays with the caret: when `marbleText.claims(client)` is true, change-marks draws no tints for that run (the tag still counts).

Changes to existing files:
- `collab.js`: delete the trail (`trails`, `.marble-trail` CSS, `clearTrail`, the add/remove in the `marble:ops` handler); `phaseLabel` returns the note's clause capitalised ("Rename the heading") or "Reading" / "Writing" / "Working" / "Pressing" / "Waiting for you" — no "Agent ·" prefix.
- `agent-text.js`: the caret's tag reads "Reading N words" (thinking and reading) and "Typing n of m words" (typing), no "Agent ·".

Tests (`test-browser/change-marks.test.js`), each with the fake agent and `attending: ['c1']` unless stated:
1. A turn with `reach` of 3 rows then three single-row batches: after the first `before` frame there are 3 tints with `data-state` soon/now; no `.marble-zone` on the page; after the end, the layer is empty within 3.5 s.
2. The tag reads "Changing 1 of 3 rows" (with `total:3`) then "… 3 of 3 rows", has a meter, never contains "Agent"; at the end "3 changed".
3. Notes "Stage 1 of 2: …", "Stage 2 of 2: …" → two tiles; rest on the tag → the status card shows the prompt whole and both step names.
4. 14 inserted rows in one turn → margin dots appear (`.marble-change-dot` ≥ 13) and at most the batch's rows are tinted.
5. A part with the caret in it (focus a contenteditable row first) gets no tint.
6. Parts below the fold → a rail with ticks and an "N below" pill; pressing it scrolls; the page does not scroll by itself (record `scrollY` before the turn).
7. Unattended conversation (no `attending`) → no layer children.
8. A tab opened mid-turn (the fake script sleeps between batches) shows the run's tag after catch-up.
9. `html.marble-zones-off` hides the layer.
10. Reduced motion (`newPage({ reducedMotion: 'reduce' })`) → tints still appear and lift; no `transform` animations run (assert `document.getAnimations()` has none with a `transform` keyframe).

- [ ] **Step 1:** Write `test-browser/change-marks.test.js` with the ten tests (scripts in the file's `SCRIPTS` object, each `apply_ops` step with `note`, `reach`/`total` where the test needs them, and `{ sleep: 250 }` between batches).
- [ ] **Step 2:** Run it — FAIL.
- [ ] **Step 3:** Add `change-marks.js` to `RUNTIME` and `injectCarrier` right after `agent-text.js` (each later module is added in its own task, in the order given in Global Constraints). Update the injection-order assertion in `test/agent-http.test.js` (~line 712).
- [ ] **Step 4:** Implement `runtime/change-marks.js`.
- [ ] **Step 5:** Run the new test file — PASS.
- [ ] **Step 6:** Make the collab/agent-text changes; update the existing browser tests that asserted the trail, the zone for attended agent edits that now draw tints, or "Agent ·" text. For each changed assertion, keep the test's intent (e.g. "a zone appears" becomes "the parts are tinted and no zone is drawn"; "trail is an inset rule" is deleted with the trail; "undo removes the trail" becomes "undo leaves no marks behind").
- [ ] **Step 7:** Run `collab`, `callout`, `agent-text`, `act-feedback`, `agent-work`, `agent-tray`, `conversation` browser files one by one; fix until they pass (note pre-existing failures from the memory list: conversation.test "the model name does not move…", "the usage toggle sits with the model…" — confirm they fail on origin/main too before ignoring).
- [ ] **Step 8:** `npm test`.
- [ ] **Step 9:** Commit "Marks: each part is tinted as it changes, one tag counts, and the box steps aside".

---

## Phase C — the transition engine

### Task 4: `change-morph.js` — end states in, motion out

**Files:**
- Create: `runtime/change-morph.js`
- Modify: `runtime/change-marks.js` (call capture/play; lift on `onPart(id,'end')`), `server/app.js` (`RUNTIME`, inject order)
- Test: `test-browser/change-morph.test.js` (new)

**Interfaces:**
- Produces `window.marbleMorph = { capture(ids, opts) → Snapshot, play(snapshot, opts) → Promise<void>, choreograph(items, opts) → Array<{item, delay, duration}> }`.
  - `capture(ids, { kind, removes, inserts, scope })`: `ids` are part ids; `kind:'look'` with a `<style>` part (or `scope:'page'`) snapshots up to 300 visible elements' style properties instead. Snapshot holds, per element: `rect` (viewport), the `PROPS` values from `getComputedStyle`, `text` (when the part is text-only), and for each id in `removes` a cleaned clone (`marble.clone(el)` or `cloneNode(true)` with ids and scripts stripped) plus its rect; and rects of up to 40 siblings of each part's parent (for FLIP).
  - `play(snapshot, { onPart(id, phase) })`: measures the after state and runs the motions below, dealt by `choreograph`. Resolves when the last motion ends. Calls `onPart(id,'start'|'end')`.
  - `choreograph(items, { spread = true })`: pure; returns delays and durations following "Scales, not a queue": batches of 2–6 (random), batch starts ~60 ms apart with ±30 ms jitter, each batch drawn far from the previous batch's centre (greedy: pick the remaining item farthest from the last batch's centroid as the seed, then its nearest neighbours to fill the batch), and the delays compressed so the last start ≤ 600 ms; durations 380–460 ms.
- `PROPS = ['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius','paddingTop','paddingRight','paddingBottom','paddingLeft','rowGap','columnGap','fontSize','letterSpacing','lineHeight','opacity','color','backgroundColor','borderTopColor','outlineColor']` (colour properties are colours; the rest numbers).

Motions:
- Number in a style changed (≥0.5px or 0.01 opacity): `el.animate([{[prop]: before}, {[prop]: after}], {duration, delay, easing: EASE_OUT, fill:'backwards'})`.
- Colour changed: same, keyframes written as `oklch(L C H / A)` strings converted from the computed `rgb()`/`color()` values (write a small sRGB→OKLab→OKLCH function), duration 300 ms.
- Position/size changed by ≥1px (the part and the siblings captured): FLIP — `transform: translate(dx,dy) scale(sx,sy)` → `none`, 340 ms, `transform-origin: 0 0`. Skip scale for text-bearing elements whose size changed (play only translate, then crossfade the content 150 ms).
- Inserted root (in `inserts[].ids` and now present): `[{opacity:0, transform:'translateY(3px) scale(.98)'}, {opacity:1, transform:'none'}]`, 340 ms.
- Removed (clone captured): put the clone in the transient layer at its old rect (`position:fixed`, `pointer-events:none`), fade it out 200 ms, then remove; the neighbours' FLIP closes the gap.
- Words (part's text changed, element has no element children that changed, not claimed by `marbleText`): put a clone of the old text (transient, fixed at the old rect) fading out 150 ms, and reveal the new words one at a time with the CSS Custom Highlight API (`CSS.highlights.set('marble-morph-unwritten', new Highlight(range))`, `::highlight(marble-morph-unwritten){color:transparent}`) at 60 characters a second, between 220 and 1500 ms; fall back to a 200 ms fade without `CSS.highlights`.
- Anything else changed in a part (e.g. a `setInner` that is not words): crossfade — `[{opacity:.35},{opacity:1}]` 150 ms.
- Reduced motion: every motion becomes `[{opacity:.35},{opacity:1}]`, 150 ms, all at once.

Budget and safety:
- No motion (resolve at once, calling `onPart(id,'end')` for every id) when: more than 60 parts; a look snapshot found >300 elements changed; `document.hidden`; or the snapshot is older than 10 s.
- Never animate an element that contains `document.activeElement`, the selection's anchor, or is being dragged (`[data-marble-dragging]`, `.marble-dragging`).
- Cancel a part's running animations before starting new ones on it (`el.getAnimations().forEach(a => a.cancel())` limited to animations this module started — tag them with `animation.id = 'marble-morph'`).
- Clean every highlight and clone when done or on the next `capture` of the same id.

Tests (`test-browser/change-morph.test.js`): call `marbleMorph` directly on a page served by the harness (no agent needed) and also through one agent turn:
1. `choreograph` of 30 items: every delay ≤ 600, batches of 2–6, durations within 380–460, consecutive batches' centroids farther apart than the median pair distance.
2. A `<style>` setInner that changes `.card{border-radius:0}` → `16px` on 6 cards: during play, `getAnimations()` has ≥6 animations on cards with `borderTopLeftRadius` keyframes; after play the computed radius is 16px and no animations remain.
3. Colour change animates with keyframes containing `oklch(`.
4. Insert: the new row has an animation from opacity 0.
5. Remove: a transient clone exists during play and is gone after; the following sibling had a transform animation.
6. setText on a paragraph: the `marble-morph-unwritten` highlight exists mid-play, absent after; final text correct.
7. Budget: 80 parts → no animations, `onPart` called 80 times with 'end'.
8. Focused element is not animated.
9. Reduced motion: only opacity keyframes, all delay 0.
10. Through the fake agent: an attended turn restyling 6 cards → tints lift only after their card's motion ended (`marble-change:landed` after `play`).

- [ ] **Step 1:** Write the test file. **Step 2:** Run — FAIL. **Step 3:** Implement `change-morph.js`; register in `RUNTIME`/inject (before `change-marks.js`); update the injection-order unit test. **Step 4:** Wire `change-marks.js` to it. **Step 5:** Run `change-morph` and `change-marks` browser tests — PASS. **Step 6:** `npm test`. **Step 7:** Commit "Engine: a change moves from what was to what is, in loose batches".

---

## Phase D — the line

### Task 5: `change-line.js` — ⌘J opens one line flush under the thing

**Files:**
- Create: `runtime/change-line.js`
- Modify: `runtime/agent-callout.js` (summon/point/`:ask`/`:send` route to the line; the offer and the after-send card are no longer used for asks; Describe mode's `borrowCard` keeps the card), `server/app.js` (`RUNTIME`, inject order), `test-browser/callout.test.js`, `test-browser/ask-v2.test.js`, `test-browser/agent-tray.test.js`, `test-browser/marks.test.js`, `test-browser/agent-text.test.js` (they open the card today)
- Test: `test-browser/change-line.test.js` (new)

**Interfaces:**
- Consumes: `marble-callout:summon` resolution in `agent-callout.js` (`summon()` steps 1–7: selection, rested element, caret block, pointer); `marbleScope.chainFrom/at`; `marble.agent.select/brief/attend/start/send/cancel/answer/on/open`; `marbleChange` (tag and tints come from Task 3 via the turn's presence).
- Produces `window.marbleLine = { open({ ids, scope, from, draft, conversation }) → boolean, close({ keep }) , running() → { conversation, turn } | null }` and DOM `div.marble-line-host[popover=manual][data-marble-transient]` > `div.marble-line[data-state=edit|sent|answer|ask|cant]` > `div.marble-line-input[contenteditable=plaintext-only][role=textbox][aria-label]` + `kbd ⏎`; plus a scope tint `i.marble-line-scope` in the same host.
- Produces document events `marble-line:sent {conversation, ids}`, `marble-line:closed`.

Behaviour (spec: "Asking, flush with the thing" and its six journeys):
- **Open.** `summon()` in `agent-callout.js` keeps its target resolution and calls `marbleLine.open({ids, scope, from:'key'})` instead of `openCard` (Describe mode, step 1, unchanged). Nothing found → `open({ ids: [], scope: 'page' })` — the page line — instead of opening the chat. Phone (≤719px) keeps today's behaviour (drawer, new conversation). A second ⌘J while the line is in `edit` closes it (keeping the draft). Point at something's plain click opens the line on the picked ids; ⇧-click adds to it.
- **Look.** Scope tint: the union rect of the ids, out 6px, radius 12px, `color-mix(in srgb, var(--accent) 14%, transparent)`; for a word selection, the words take a highlight (`::highlight(marble-line-words){background-color: color-mix(in srgb, var(--accent) 34%, transparent)}`) and there is no box tint. The line hangs 10px under the scope (flips above when there is no room), left/right flush with the scope's edges, min 320px (centred on the scope when wider than it), max 720px, kept 8px inside the viewport. Page line: centred at the foot of the window, width min(560px, 100vw − 32px), 16px from the bottom, no page tint. Style: `background: var(--card, #fff)`, radius 10px, `box-shadow: 0 0 0 1px var(--accent-ink), 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent), var(--shadow-lift)`; input 14px/1.45, one to three lines then scroll; placeholder in `--placeholder` or `--faint`: "Change this <unit>" (unit as in Task 3 for one id, "these words" for a selection, "these N parts" for several, "Change this page" for the page); `⏎` kbd at the end. The line rides scroll/resize with its scope (re-place on `scroll` capture + `ResizeObserver`); if the scope leaves the DOM, the line closes keeping the draft.
- **Keys.** ⏎ sends (empty does nothing). ⇧⏎ keeps the words as a note exactly as the offer's `onKeep` did (call the same function; if it needs the offer, extract it). Esc closes, keeping the draft per scope key (`ids.join(',')`, `'page'`, or `'words:'+text`) in `sessionStorage['marble-line-drafts:<app>']`; the next ⌘J on the same scope opens with it and the caret at the end. `[` and `]` widen/narrow (only while the input is empty, only for one id), moving along `marbleScope.chainFrom` exactly as the card did. A pointerdown outside the line and its scope closes it keeping the draft.
- **Send.** As the offer's `onSend` did: `agent.select(ids)`, `agent.brief(briefFor('main', ids))`, `marble-text:words {range}` for a selection, then send through a hidden `<marble-conversation data-chrome=callout project=drive>` kept in the host (`style.display='none'`) with `sendNow(text)`; on its `conversation` event, `agent.attend(id)`. The line goes to `sent`: the words fade (120 ms) and its height closes into the scope (220 ms, ease-out); the scope tint stays until the turn's first marks arrive (`marble-change` tints) or the turn ends.
- **While it runs.** Esc stops the change **only** when `document.activeElement` is the body or inside the document's own content (not an input, textarea, contenteditable, `[role=dialog]`, popover or menu) and no other overlay consumed the key (`defaultPrevented`). It calls `agent.cancel(turnId)`; what landed stays; the run's end frame lifts the marks.
- **Turn end** (`agent.on(conversation)` → `turn.completed|failed|cancelled|interrupted` with `applied`):
  - `applied > 0` → the line is done; nothing reopens (review takes over).
  - `applied === 0`, the asked text reads as a question (ends with "?" or starts with what/why/how/when/who/which/where/is/are/can/could/does/do/did/should/will/would) → `answer`: the turn's assistant text (collected from `text` events of that turn) in the line, ≤6 lines visible then scroll, "Open in chat" when longer than 280 characters (`agent.open(conversation)`), and an input "Ask more" under it that continues the **same conversation**. Esc closes.
  - `applied === 0` otherwise → `cant`: the input holds the words again (caret at the end), with the first two sentences of the assistant text above it (or "Nothing changed." when there is none), so it can be said another way; ⏎ sends in the same conversation.
- **A question back** (`ask` event of kind `question` for that turn): the line reopens in `ask` with the question and one chip per option; a press (or typing and ⏎) answers via `agent.answer(turn, requestId, response)` in the shape the drawer uses (copy it from `agent-ui.js`'s question answer), and the line closes again. A `permission` ask opens the chat (`agent.open`).
- **`:ask` / `:send` events** from notes and nudges: `:ask {ids, draft}` → `open({ids, draft})`; `:send {ids, text, brief}` → open, set the brief, send at once.
- **Change more** (Task 6): `open({ ids, conversation, from:'review' })` continues that conversation.
- Nothing about the conversation (bubbles, status, Undo/Done) is drawn on the page.

Tests (`test-browser/change-line.test.js`):
1. ⌘J on a selected phrase: `.marble-line` exists, no `.marble-callout`, its left/right equal the paragraph's within 1px, placeholder "Change these words", the words highlight exists.
2. ⌘J with nothing under the pointer or caret: the page line at the foot, centred, "Change this page", the drawer stays closed.
3. Type, Esc, ⌘J again on the same row → the words are back and the caret is at the end.
4. ⏎ on a script that applies one op: the line is `sent`, then gone; the parts were tinted (Task 3); no `.marble-callout`; the conversation's first turn has `context.selection` = the row's id and `context.brief` matches /in place/.
5. A question ("Why is this still unread?") on a script that only says a sentence → `answer` with that sentence; "Ask more" sends a second turn in the same conversation id.
6. A change script that says "None of these has a date to use." and applies nothing → `cant` with the words in the input and the sentence above.
7. A script with `ask` (question with options "Due", "Added") → chips; pressing "Due" answers; the turn completes.
8. Esc while the turn runs (focus on body) cancels it (`turn.cancelled`); Esc while focus is in a document input during a run does not.
9. `[` widens from a row to the list (placeholder "Change this list").
10. Phone viewport (390px): ⌘J opens the drawer as today.
11. Describe mode (⌘⇧D) still borrows the card (`.marble-callout` with `data-state`), i.e. `marks.test.js` "card sends with marks" still passes.

- [ ] Steps: write tests → fail → implement `change-line.js` and the `agent-callout.js` routing → register in `RUNTIME`/inject → run `change-line`, `callout`, `ask-v2`, `agent-tray`, `marks`, `agent-text`, `drawer` browser files one by one, updating assertions that expected the card for ⌘J (keep each test's intent) → `npm test` → commit "⌘J opens one line flush under the thing; the change is the answer".

---

## Phase E — the change on request

### Task 6: `change-review.js` — rest on a change to see it; Keep, Undo, Change more

**Files:**
- Create: `runtime/change-review.js`
- Modify: `runtime/agent-callout.js` (drop `endRow` Undo/Done for asks — the card no longer exists for them), `server/app.js` (`RUNTIME`, inject)
- Test: `test-browser/change-review.test.js` (new)

**Interfaces:**
- Consumes `marble.agent.review/keep/undo/redo/on('*')` (Task 2), `marbleMorph` (Task 4), `marbleLine.open` (Task 5), `marble-change:end` (Task 3).
- Produces `window.marbleReview = { groups() → Array<{turns, ids}>, showAll(), hide() }`, a tray row `{ id:'changes', order: 6, label:'Show what changed' }` registered with `marble-tray:register` only while there is something unreviewed (unregister otherwise), DOM in a `popover=manual` host `div.marble-review-host[data-marble-transient]`: per group a tag `div.marble-review-tag`, overlays `i.marble-review-add`, `div.marble-review-was` (old words), `i.marble-review-ghost` (removed), `i.marble-review-gap` (moved from), `i.marble-review-outline` (old shape), and the bar `div.marble-review-bar` with `button[data-act=more]` ("Change more"), `button[data-act=keep]` ("Keep"), `button[data-act=undo]` ("Undo"), and after an undo `button[data-act=redo]` ("Redo").

Behaviour (spec: "After a change", "Rest, then keep, undo or change more", "What changed, kind by kind", "Finding a change later, and on touch", "Keys, your own edits, and leaving it"):
- Load `review(app)` on boot, on `marble-change:end`, on `turn.undone`/`turn.redone`, and on summary changes for conversations targeting this app. Index parts by id. Groups: turns whose parts share an id or whose parts' nearest common block is the same are one group ("one change, since you last kept").
- **Nothing at rest.** No drawing until the pointer rests 500 ms (moved < 4px) over a changed part or inside one (or a part of a group contains the target), or focus moves into one (at once). Leaving (pointer outside the group's rect and the bar for 300 ms, or Esc, or a press on empty page) puts the drawing away; the change stays unreviewed.
- **Drawing by kind:** `added` → tint 24% + 1px ring `--accent-ink` 70% shaped to the part; `words`/`changed` → the part tinted 24% and under it a `marble-review-was` line with the old words, struck through, faint, at most two lines, ellipsised (text from `before` stripped of tags); `look` → a dashed 1px outline of the old shape over the new: measure it by cloning the element into the layer (`visibility:hidden`, `position:fixed` at the same rect) with the old attribute value applied, reading its rect and radius, then removing the clone; `attr` → tint only; `removed` → a ghost of the old html (sanitised clone: no scripts, no ids, `pointer-events:none`, opacity .55, dashed 1px ring, text struck through) laid over the page at its old place (before `beforeId`'s top, or the end of `parentId`), taking no room; `moved` → tint at the new place and a dashed 1px line where it was (top of the old `beforeId`, or the end of the old parent).
- **Tag** over the group's top-left, in ink on card (it is the page's state now): "3 rows added", "1 title changed", "4 cards restyled", "1 row removed", "1 row moved", mixed → "3 changed · 1 added"; more than one ask → "· 2 asks". **Press and hold the tag** (≥250 ms) shows Before: a clone of the group's nearest common block with the group's inverses applied to the clone by id (`before` html / old attribute / remove added / insert removed / move back), laid exactly over the original (which gets `visibility:hidden` while held); release restores. Nothing is undone.
- **Bar** under the group, flush with its width (min 300px), 10px below (flip above when no room). Keep → `keep(turn)` for every turn in the group, drawing lifts (900 ms) and never shows again. Undo (press) → `undo(last turn)`; the marks/engine play it (agent-undo frames); the bar then shows "Undone" and Redo until the pointer leaves, then goes. Hold Undo ≥600 ms (a fill across the button, a tip "Hold to undo all N" on rest) → undo every turn in the group newest first. Change more → `marbleLine.open({ ids: group's ids, conversation: last turn's conversation, from:'review' })`. On touch (`hover:none`), the bar's buttons are 44px tall.
- **Keyboard:** focus inside a changed part draws it; Tab from there reaches the bar (handle Tab in capture while drawn by focus: first Tab focuses Keep, Shift+Tab returns); ⏎ on Keep keeps; ⌘J opens the line (Change more) while drawn.
- **⌘Z / ⇧⌘Z:** a window capture-phase keydown. ⌘Z (no shift) when the target is not an input/textarea/plain contenteditable and the newest unreviewed turn on this page finished after the person's last own history change (track `marble:history` events' time) → `undo(turn)`, `preventDefault()`, `stopImmediatePropagation()`. ⇧⌘Z → redo the last turn this tab undid, if no person edit came since. Otherwise let the document's own undo run.
- **Yours:** an `input` event or a `marble:history` change whose target is inside a changed part drops that part from its group (and the server drops it on the next load because its hash changed).
- **Show what changed:** the tray row draws every group at once with its bar; Esc or a press on empty page puts them away. The launcher's ink dot stays as today (conversation `needsReview`).
- **Reduced motion:** no lift fades, drawings appear and go at once.
- The callout's `endRow` (Changed N elements / Undo / Done) and its `done()` path are removed for asks (the card is not used for them any more); `marble-callout:reviewed` stays dispatched by Keep so other listeners keep working.

Tests (`test-browser/change-review.test.js`):
1. After a turn that adds 3 date chips: nothing drawn at rest; hover a row for 600 ms → tag "3 … added", 3 `.marble-review-add`, a bar with Change more / Keep / Undo; pointer away → gone within 500 ms.
2. Keep → `GET /agent/review` empty, the drawing lifts, hovering again draws nothing, the conversation `needsReview` is false.
3. Undo → the chips leave (file no longer has them), the bar shows Redo; Redo → they are back; pointer away → bar gone.
4. Two asks on the same list → tag "· 2 asks"; hold Undo 700 ms → both undone.
5. Hold the tag → the original is hidden and a clone without the chips is shown; release → back; the file is unchanged.
6. A renamed title → `.marble-review-was` with the old words struck through. A removed row → a ghost at its old place, no layout shift (measure the next row's rect before/after drawing). A moved row → a gap line. A class change → a dashed outline.
7. Reload → hover still draws it (server list).
8. Type in a changed row's title → that part is no longer drawn; the others still are.
9. ⌘Z with focus on the body → the turn is undone; ⌘Z inside a `data-marble-editable` the person just edited → the person's edit is undone instead (agent turn untouched).
10. Tray: "Show what changed" exists only while something is unreviewed; pressing it draws all groups; Esc hides them.
11. Focus a changed part with Tab → drawing appears; Tab → Keep focused; ⏎ → kept.
12. Touch viewport (`hasTouch`, `isMobile`) → bar buttons ≥ 44px tall.

- [ ] Steps: write tests → fail → implement → register in `RUNTIME`/inject → remove the callout's endRow path and update `callout.test.js` (its "Changed 1 element / Undo / Done" assertions become review-bar assertions) → run `change-review`, `callout`, `collab`, `change-marks` → `npm test` → commit "After a change: nothing stays; rest on it to see it, keep it, undo it or change it more".

---

## Phase F — find, mark, commit

### Task 7: `change-rules.js` — Reshape by hand, and style changes from a few words

**Files:**
- Create: `runtime/change-rules.js`, `server/change/intent.js`
- Modify: `server/agent/routes.js` (`POST /agent/change-intent`), `runtime/change-line.js` (fast path before sending), `server/app.js` (`RUNTIME`, inject)
- Test: `test-browser/change-rules.test.js` (new), `test/change-intent.test.js` (new)

**Interfaces:**
- Produces `window.marbleRules = { likes(el, { only }) → Element[], commit({ selector, declarations, targets, exclude, label }) → Promise<{ id, undo }>, reshape(on) }`.
- Produces tray row `{ id:'reshape', order: 9, label:'Reshape', active }` (toggle); Esc leaves Reshape.
- Produces `POST /agent/change-intent { path, words, ids, outline }` → `{ rule: { selector, declarations, unit, verb } } | { rule: null }` via `server/change/intent.js` `readIntent({ words, outline, exec })` using the same `claude -p --model haiku --tools ''` plumbing and timeout pattern as `server/agent/offer.js` (8 s; no answer → `{ rule: null }`).

**Find (likes):** same `tagName` and the same set of classes ignoring `marble-*`, among addressed visible elements; an element with no class: same tag whose parents share the same tag + class signature. `only:true` (⇧) → just the element.

**Reshape (the hand):** in Reshape, the part under the pointer (an addressed element with a visible box — border, background or radius — at least 24×24) gets two grips: a corner dot at its top-left inside the radius (`left/top = r × 0.293 − 6px`, as the v5 demo) for border-radius, and a short bar inside its right edge for padding. Hovering a grip marks every like (light tint, all at once); a press on a like's tint toggles it out (dashed ring instead of fill). Dragging a grip: all included likes change one to one (inline style set directly on the page, transient, no transition); the tag over the grabbed part reads "Rounding N cards · 14 px" / "Padding N cards · 18 px". Release: `commit` one rule. ⇧ at press: only that part. Esc during drag: back to how it was, nothing filed.

**Commit:** one rule in a style element of its own, keyed by selector+property: `<style data-marble-id=NEW data-marble-rule="<selector>|<prop>">` inserted as the last child of `<body>` (`parentId` = body's id), contents `html <selector>:not([data-marble-id="x"]):not(…) { <prop>: <value>; }` — the `html ` prefix lifts specificity above a lone class rule. If a style with the same `data-marble-rule` exists, `setInner` it instead. Verify after applying: every target's computed value equals the target value; for any that do not (an inline style or an id rule wins), add `setAttr style` ops for those elements (appending the property) in the same step. File with `marble.apply(op)` + `marble.op(op)` for each op and one `marble.record({ redo: ops, undo: inverses })` so ⌘Z takes back all of it. Wrap in `marbleMorph.capture({scope:'page'})` before and `play` after so the motion is the engine's (for words; a drag is already at its end state, so skip play there and just remove the inline overrides after the rule lands).

**Words (fast path in the line):** before sending, `change-line.js` tests the words against a style lexicon (`/\b(round(ed|er)?|square|corner|radius|padding|spac(e|ing)|tight(er)?|loose(r)?|roomier|bigger|smaller|larger|text size|font size|bold(er)?|light(er)?|dark(er)?|colou?r|background|border|calm(er)?|quiet(er)?|soft(er)?)\b/i`). On a match it posts `change-intent` with an outline of the page (up to 40 class signatures with their counts and computed radius/padding/font-size/colour/background of the first of each) and the scope ids. A rule back: the page validates (selector parses with `document.querySelectorAll`; 1–400 matches; within the scope when there is one; declarations only from `border-radius, padding, padding-*, margin, margin-*, gap, row-gap, column-gap, font-size, font-weight, line-height, letter-spacing, color, background-color, border-color, opacity`), then: tint every target at once (Task 3's visual), the line folds in, a tag "Rounding 4 cards", 500 ms later `commit` with the engine playing the scales; tints lift as each lands. No rule, a timeout, or an invalid rule → send to the agent as normal, with nothing lost. The commit is the person's own (no review drawing); ⌘Z takes it back.

Tests:
- `test/change-intent.test.js`: `readIntent` parses a good JSON reply, rejects unknown properties, rejects a reply without a selector, returns null on timeout/missing CLI (stub `exec`).
- `test-browser/change-rules.test.js`: (1) `likes` on a card returns the 4 cards, not the panel; with `only` returns 1. (2) Reshape on: hovering a card shows the corner grip; hovering it tints 4 likes; dragging 20px changes all 4 radii live (no transition), release files exactly one insert op (one `<style data-marble-rule>` in the file) and one undo record; ⌘Z removes it. (3) A press on one like's mark before dragging leaves it at its old radius; the rule's selector has `:not([data-marble-id=…])`. (4) A card with an inline `border-radius` still ends at the new value (fallback setAttr), and ⌘Z restores the inline value. (5) A second drag on the same kind updates the same style element (still one). (6) The line with "round the corners" and a stubbed intent route (`page.route('**/agent/change-intent', …)` returning a rule) → targets tinted, rule committed, no agent turn started. (7) Intent returns `{rule:null}` → an agent turn is started with the words. (8) Esc mid-drag → nothing filed, radii back.

- [ ] Steps: tests → fail → implement `server/change/intent.js` + route → implement `change-rules.js` + line fast path → register → run browser tests → `npm test` → commit "Find, mark, commit: reshape one part and all like it follow; a few words become one rule".

---

## Phase G — fan out

### Task 8: `fan_out` — workers for changes that need judgment part by part

**Files:**
- Create: `server/change/fanout.js`
- Modify: `server/agent/tools.js` (schema + handler), `server/agent/runner.js` (abort workers on cancel), `runtime/change-marks.js` (`failed` parts keep a light tint, tag says how many failed)
- Test: `test/change-fanout.test.js` (new), `test-browser/change-marks.test.js` (one case)

**Interfaces:**
- Tool `fan_out` schema: `{ path: string, note: string, plan: string /* what every part should become */, shards: [{ ids: string[] /*1–24*/, brief?: string }] /* 2–8 */, model?: 'haiku' | 'sonnet' }`. Description: "Change many parts that each need their own judgment (a label per row, an icon per item, a rewrite per paragraph) by running one worker per shard in parallel. Every worker gets the same plan and only its shard's elements, returns edits that are checked before they land, and lands as soon as it is done. A shard that fails leaves its parts as they were and says why. Use it for six or more parts; for a few, use apply_ops."
- `runFanOut({ source, docPath, plan, note, shards, model, exec, signal, apply })` in `server/change/fanout.js`: for each shard (at most 4 at once): build the prompt (plan, brief, the shard's elements' source via `collectSlices(source, ids, {budget: 12000})`, the op vocabulary, the rule that only these ids or their descendants may be changed and inserts may only go inside them, reply with only `{"ops":[…]}`); run `claude -p --model <model or 'sonnet'> --tools '' --setting-sources project --output-format text` with a 120 s timeout and the turn's abort signal; parse; check every op's `id`/`parentId` is a shard id or a descendant of one in `source` (else the shard fails "edited outside its shard"); hand the ops to `apply(shardIndex, ops)` which goes through the same path as `apply_ops` (ledger: the shard's ids count as read by this turn at the hashes the worker saw; a stale id fails the shard "changed while it worked"); returns `{ applied, shards: [{ ids, applied, error? }] }`.
- The handler in `tools.js` reuses `apply_ops`' prepare/after logic (extract it into a function both call), pushes undo steps per applied shard, and notes each shard as one batch: `note: "<note> · part k of n"`, `total` = the sum of shard ids. A failed shard sends a presence frame `{ client, turn, stage:'after', failed: ids }`.
- `change-marks.js`: `failed` ids keep a light tint until the run ends; the tag reads "3 of 4 groups done · 1 failed" when any failed; the end text adds "· 1 failed".

Tests:
- `test/change-fanout.test.js` with a stub `exec`: 3 shards, one replying ops outside its ids → that shard fails with "outside its shard", the other two apply; one shard's exec times out → fails, others apply; concurrency never exceeds 4 (count overlapping stub calls with 6 shards); abort signal stops pending shards; the turn's undo has one record per applied shard; a shard whose id changed between read and apply fails "changed while it worked".
- `test-browser/change-marks.test.js` (+1): a frame with `failed:['l2']` keeps l2 tinted and the tag says "1 failed".

- [ ] Steps: tests → fail → implement → `npm test` + the marks browser file → commit "Fan out: parts that each need judgment are changed side by side, checked, and land as they finish".

---

## Phase H — words, docs, and the ship

### Task 9: The words on the page, the guide, and the docs

**Files:**
- Modify: `agent-plugin` or the guide the agent reads (`guidePath` in `server/agent/tools.js`; find the "Growing the open page" section) — add `reach`/`total` and `fan_out` guidance in one short paragraph each; `ARCHITECTURE.md` (a v5 section: the five modules and the presence contract); `PRODUCT.md` if it lists the ⌘J card; `docs/superpowers/specs/2026-10-03-v5-self-modifying-design.md` (mark built/not built after the run).
- Scan: run Design Don'ts' scan (the `scan-pre` block of `Design Don'ts.mrbl` in the drive) against every new runtime file's `STYLE` and visible strings; fix every hit.

- [ ] Steps: grep all runtime files for `Agent ·` and `'Agent'` in visible strings and remove those on change surfaces → update the guide and docs → run the scan → `npm test` and every browser file this plan touched, one by one → commit "v5: the words, the guide and the docs".

### Task 10: Ship

- [ ] **Step 1:** Rebase `v5-self-modifying` on the latest `origin/main` (`git fetch && git rebase origin/main`); rerun `npm test` and the touched browser files.
- [ ] **Step 2:** Whole-branch review (fresh reviewer on the most capable model) against this plan and the spec; fix what it finds.
- [ ] **Step 3:** Push: `git push origin HEAD:main`.
- [ ] **Step 4:** The owner's drives first (memory: tests-on-admin): `tools/mac-release.sh` (detached with `nohup … > /tmp/mac-release-<sha>.log 2>&1 &`; from a worktree, ensure `.claude/worktrees/marble -> ../../../marble` exists) and `tools/sprite-deploy.sh admin-p2`. Smoke: open `Notes and Sketches/Ask at Anything` on the Mac drive in the browser, ⌘J on a row, check the line; run a small change; rest to review it.
- [ ] **Step 5:** Everyone: `nohup tools/sprite-deploy.sh --all --when-idle > /tmp/deploy-all-<sha>.log 2>&1 &`; read the summary; rerun single sprites that hit a transient 502.
- [ ] **Step 6:** Report what shipped, where, and what failed.
