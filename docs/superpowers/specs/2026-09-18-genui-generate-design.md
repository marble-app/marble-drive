# GenUI — the prompt box, the decision tree, and the living UI

**Date:** 2026-09-18
**Status:** Approved in chat; building on branch `genui-generate`
**Builds on:** `2026-09-18-genui-authored-spaces-design.md` (the engine: app spaces, `POST /genui/decide`, the `genui-author` skill, `Decide.mrbl` as the behind-the-scenes view)

## 1. What it is

One document, `drive/GenUI.mrbl`. A prompt box; a decision tree on the left; the generated UI, live, on the right; a follow-up box underneath. You type what you want, the pattern is decided, the space is authored, every design decision inside it is decided, and the UI shows. You type again, Jev re-decides, the UI moves.

Every level of granularity is a Jev decision:

| Level | Decision | Who | Speed |
|---|---|---|---|
| L0 · Pattern | which Atlas root pattern serves the prompt, from the Wave-3 set | Jev, `POST /genui/root` | ~150 ms |
| — · Authoring | write the app space for that pattern | the `genui-author` agent turn | minutes, streamed |
| L1 · Instance | each live sub-dimension of the root instance | Jev, `POST /genui/decide` | one request, ~300 ms |
| L2 · Children | each live sub-dimension of every child instance | same request | — |

Two speeds, shown as two things: **Generate** (L0 + authoring + first decide) and **Re-decide** (a follow-up prompt becomes a signal; L1/L2 re-run; the tree diffs; the iframe moves). A follow-up never re-authors silently; **Regenerate** is its own control.

## 2. The page

```
┌ GenUI ───────────────────────────────────────────────────────────────┐
│ [ what do you want?                                    ] [Generate]  │
│ signals: (chips of follow-up prompts, each removable)   [Re-decide]  │
├ tree ────────────────────────────┬ ui ───────────────────────────────┤
│ L0 Pattern  dashboard  0.81  ▾   │ <iframe src="/a/Spaces/<slug>">    │
│   ▸ authoring · 12 steps · done  │ (moves when the host writes)       │
│ dashboard#ops               ▾    │                                    │
│   arrangement  fixed-grid  0.74  │                                    │
│   ⋯                              │                                    │
│   stat-tile#kpi             ▾    │                                    │
│     encoding  sparkline ✓  0.82  │                                    │
│   chart#trend               ▾    │                                    │
└──────────────────────────────────┴────────────────────────────────────┘
```

- **Prompt** — `data-marble-editable` paragraph; Enter or the button runs Generate.
- **Tree** — transient (rendered from server answers). Nodes: L0 with its bars; the authoring step with a live step count and last action (the day-runner's own vocabulary); one node per instance, nested by `parent`, each decision a row with current → choice, confidence, reason, and bars on expand. After a re-decide, rows that moved are marked.
- **UI** — an `<iframe>` of the generated document. It is a real Marble document under the host, so decides written through `writeOps` reach it over its own channel; nothing in this page touches the iframe's DOM.
- **Signals** — the follow-up prompts, kept as facts on the page (`<li data-marble-editable>` in a list; one op per signal). Sent as `context.signals` on every re-decide, plus `viewport` taken from the iframe's width.

Facts in the file: the prompt, the signals, the current space path (`data-space` on `<body>`), the chosen root pattern (`data-root`), and the conversation id of the last authoring run (`data-run`) so a reload resumes watching. Everything Jev returns is transient.

## 3. Server

- `POST /genui/root { request, context? }` → `{ choice, confidence, probabilities, options: [{ id, name, def }] }`. One Choice; criteria are the Wave-3 root ids with the Atlas `def` as gloss; state is the request and context. The root set is a constant in `server/genui/root.js` (`ROOT_PATTERNS`), filtered to entries the loaded Atlas actually has.
- `GET /genui/spaces` → `[{ path, request, instances: n, decisions: n }]` — documents whose source carries `data-genui`, so the page can reopen one without generating. Reads through the store; parses only files that contain the attribute string.
- Nothing else. Decide is the existing route; the authoring run is the existing agent API (`marble.agent.start/send/on`), aimed at the "Marble Drive" project so the `genui-author` skill is found.

## 4. Generate, step by step (client)

1. `POST /genui/root` with the prompt → draw L0.
2. `agent.start({ provider, project: <Marble Drive> })`, `agent.send(id, { prompt, target })` where the prompt is:
   `Use the genui-author skill. Root pattern: <id> (<name>) — Jev chose it at <confidence>. Write the app space to "Spaces/<slug>". Prompt, verbatim: "<prompt>". Validate with marble-drive genui space until ok, then stop.`
   Slug is the prompt's first six words, slugified, plus a short time suffix so two generations never collide.
3. Watch `agent.on(id, …)`: `tool.call`/`text` update the authoring node; `turn.completed` (or any `turn.*` other than started/queued) ends it.
4. `GET /genui/space?doc=Spaces/<slug>` → if valid, set `data-space`, point the iframe, draw L1/L2 from the space (current values, no confidences yet).
5. `POST /genui/decide { doc, request, context: { viewport, signals: [] } }` → fill confidences, mark applied. The iframe moves on its own.

**Re-decide:** append the signal, `POST /genui/decide` with all signals, diff against the last decisions, mark moved rows.

**Regenerate:** step 1 with the prompt plus the signals joined as "also: …", then 2–5 into a new slug.

Errors: no host → the page renders its last facts and says decide needs a host; no key → the route's `no_key` explanation shown in the tree's L0 slot; authoring that ends without a valid space → the authoring node says so and offers Regenerate; 404 on `/genui/*` → "the host is running code without /genui — restart it".

## 5. Tests

- `test/genui-root.test.js` — the root question: criteria are exactly the available Wave-3 ids with Atlas defs; the answer is validated against them; state carries the request.
- `test/genui-http.test.js` — `POST /genui/root` (fake ask), `GET /genui/spaces` lists the seeded fixture and not the garden.
- `test-browser/genui-generate.test.js` — fake provider script that just finishes; the target space is pre-seeded; fake gate. Type a prompt → L0 renders → the run finishes → the tree fills → the iframe shows the space. Type a follow-up with `viewport: phone` in the fake's logic → the tree marks `arrangement` moved and the iframe's `#ops` flips to `single-scrolling-column`. Asserted through the iframe's `contentDocument`.

## 6. Decisions

| Decision | Why |
|---|---|
| L0 is Jev over the Atlas root set, not the LLM authoring alternatives | Authoring is the slow, expensive step; multiplying it per prompt kills the loop. `<marble-alt>` at L0 stays possible later. |
| The tree is transient | It is Jev's answer, a record the host already keeps in `.genui.jsonl`; the page's facts are the inputs (prompt, signals, space, run). |
| The UI is an iframe of the real document | The generated document must be a document — addressable, openable on its own, moved by `writeOps`. Copying its markup in would be a second copy. |
| Signals accumulate | "Make it denser" is a constraint on top of the request, not a replacement. A chip's × removes one; the page never forgets silently. |
| Authoring is aimed at the "Marble Drive" project | That is where `.agents/skills/genui-author` is discovered, and where the CLI the skill runs for validation lives. |
