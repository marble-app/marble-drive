# Subagents — a step that has steps

> Status: **approved to build**, 2026-09-19. Adds a live indicator and an
> inspection surface for the subagents a full-capability Claude turn spawns.
> No new UI vocabulary, no new colours, no store schema change, no new
> dependencies. Node 22.

Read against the real wire, not from the CLI docs: every claim below about
what arrives on stdout was measured over the recorded streams in
`drive/.marble/agents/*/raw/*.jsonl`, which already contain 27 real
subagents. Re-measure there before changing any of it.

## 0. Summary

Subagents already run here. The corpus holds 27 of them; one ran 38 minutes,
made 129 tool calls and spent 245k tokens. The CLI reports all of it. Marble
discards nearly all of it, and the person watching sees one dead line —
`Agent · Runtime phone density fixes` — that sits pending for those 38
minutes and then folds itself into a `17 steps` disclosure alongside a couple
of greps.

Two things are missing and they are the same thing at two scales: there is no
sign that a subagent is *running*, and no way to see what it *did*. This spec
fixes both by letting the Agent row stop being a leaf. It becomes a step that
has steps — collapsed it carries a live line of what its subagent is doing
right now; expanded it holds that subagent's own tool rows, rendered by the
same `toolLabel`, the same dot states and the same folding the parent
transcript already uses.

Nothing else moves. A subagent does not become a conversation, does not get a
pane, does not appear in List, Board, Focus or the Deck.

## 1. What the wire already carries

Measured across every stream containing `local_agent`:

| Line | Count | Carries |
|---|---|---|
| `system` / `task_started` | 13 | `task_id`, `tool_use_id`, `description`, `subagent_type`, `spawn_depth`, `is_backgrounded`, `prompt`, `task_type` |
| `system` / `task_progress` | 629 | `task_id`, `tool_use_id`, `description`, `subagent_type`, `last_tool_name`, `usage: { total_tokens, tool_uses, duration_ms }` |
| `system` / `task_notification` | 5 | `status` (`completed` \| `failed` \| `stopped`), `summary`, `usage` |
| nested `assistant` (`parent_tool_use_id` set) | 688 | `tool_use` blocks (129 for the largest single subagent), and 17 `text` blocks across the corpus |
| nested `user` | — | `tool_result` blocks, one per call |
| nested `stream_event` | **0** | — |

Four measurements that shape the design, each of which contradicts a
reasonable guess:

- **`task_progress` is not a heartbeat.** It fires once per subagent tool
  call — 129 progress lines for that subagent's 129 tool calls — and each
  carries a ready-made human phrase (`Reading ~/.claude/skills/apple-design/SKILL.md`,
  `Running cd /Users/bryanmin/Development/…`) plus cumulative usage. It is a
  per-step record, not a ticker, so "publish it live and don't persist it" is
  a choice about noise, not about volume.
- **`task_progress` fires only for `local_agent`.** All 629 carry
  `subagent_type`; not one belongs to a `local_bash` task. The line is
  self-identifying.
- **A subagent never streams.** Zero nested `stream_event` lines. There are
  no partial deltas to render, so the body is built from whole `tool_use` and
  `tool_result` blocks only.
- **A subagent's prose barely exists in the parent stream.** 17 text blocks
  across 688 nested assistant lines. The real report comes back separately —
  via `SubagentHandback` (4 calls in the corpus), delivered as a message, with
  the `tool_result` saying only *"This agent's report was delivered to you as
  a message… it is not repeated here."* The expanded body therefore shows a
  subagent's **steps**, not its reasoning. That is a limit of the wire, not a
  design choice, and §7 records it as a known gap.

### Where it is thrown away

- `server/agent/providers/claude.js:104`, `:112` and `:124` — every line with
  a `parent_tool_use_id` returns `[]`. That is the entire subagent
  transcript.
- `task_progress` has no case at all; it falls through to `default: return []`.
- `task_started` / `task_notification` are reduced to
  `{ type: 'background', pending: tasks.size }` (`claude.js:67`), which
  `runner.js:721` uses only to widen the settle window. It never reaches
  `store` or the UI.

### And one conflation

`task_type` is `local_bash` (861 in the corpus — a backgrounded shell) or
`local_agent` (27 — a real subagent). The `background` counter lumps them.
For the settle timer that is correct and stays: the turn must outlive both. For
the word *agent* it is wrong. Only `local_agent` may produce a subagent event
or be counted in the footer's "2 agents".

## 2. Events

Six new event types. Naming follows the existing `tool.call` / `ops.applied`
convention: a dotted noun path, past-tense or bare.

Emitted by `parseClaudeLine`:

```js
{ type: 'subagent.start',  callId, taskId, description, agentType, depth, background }
{ type: 'subagent.progress', callId, taskId, step, lastTool, tokens, toolUses, ms }
{ type: 'subagent.end',    callId, taskId, status, tokens, toolUses, ms }
{ type: 'subagent.tool.call',   parent, callId, name, input }
{ type: 'subagent.tool.result', parent, callId, ok, denied, summary }
{ type: 'subagent.text',   parent, text }
```

`callId` on the first three is the *parent's* `tool_use_id` — the id of the
`Agent` tool call the person can already see. `parent` on the last three is
the same value, arriving as `parent_tool_use_id`. One key joins the whole
tree, and it is a key the UI already has in `record(turn).tools`.

`depth` defaults to `1` when `spawn_depth` is absent (the corpus shows `1`
for every `local_agent` and `undefined` for every `local_bash`). Rendering
handles any depth generically by nesting; nothing special is built for a
depth we have never observed.

### Parser changes, precisely

`state.tasks` becomes a `Map` from `task_id` to `{ agent, callId }` instead
of a `Set`. Three constraints on that change, each protecting existing
behaviour:

1. The `background` count stays a count of **all** tasks, agent and bash
   alike, and `pending` keeps meaning `tasks.size`. The settle timer must not
   get shorter.
2. `test/agent-provider-claude.test.js:247` drives `task_started` with no
   `task_type` at all. Absent `task_type` means not an agent: count it, emit
   no subagent event. That test must pass unchanged.
3. A `task_notification` for a `task_id` this process never started — the
   resumed-session case the existing comment at `claude.js:58` describes —
   still decrements nothing it does not know about, and emits no
   `subagent.end`. The Map lookup misses; that is the whole guard.

Nested lines stop returning `[]`:

- nested `assistant` → a `subagent.tool.call` per `tool_use` block, a
  `subagent.text` per non-empty `text` block.
- nested `user` → a `subagent.tool.result` per `tool_result` block, reusing
  `isDenial()` so a refused subagent step reads the same as a refused parent
  step. **Never** a text event: the one nested `user` text block per subagent
  is the prompt echoed back, which the Agent row's own label already says.
- nested `stream_event` → still `[]`. None exist, and a partial delta of a
  step nobody is reading is noise.
- top-level `tool_progress` (the Bash elapsed-time heartbeat, distinct from
  `system` / `task_progress`) → still `[]`, at any nesting.

`toolName()` already strips the `mcp__*__` prefix and is reused for nested
calls, so an MCP tool a subagent used reads the same as one the parent used.

## 3. Runner

`handle()` in `server/agent/runner.js` gains:

- `subagent.start`, `subagent.end`, `subagent.tool.call`,
  `subagent.tool.result`, `subagent.text` → `turn.onEvent(event)`. Persisted
  and published, exactly like `tool.call`.
- `subagent.progress` → `publish(turn.conversationId, { turn: turn.id, ...event })`
  only. Live, never stored. `text.delta` at `runner.js:695` is the precedent
  and the reason: a transcript is what happened, and a progress line is only
  ever *what is happening*. Its durable residue is the final `usage` on
  `subagent.end`, which `task_notification` supplies.

`background` is untouched. No new turn state: the UI counts live subagents
from the events it already receives, so the runner learns nothing it does not
need for timing.

`store.appendEvent` is generic JSONL (`store.js:181`) and needs no change.

## 4. The UI

All of this is `runtime/agent-ui.js`, which is re-read per request — no host
restart.

### The row

When `toolCall()` sees `Agent` or `Task`, it builds a `.subagent` instead of
a bare `.tool`:

```html
<div class="subagent" data-call="toolu_01Dx…" data-agent-type="general-purpose">
  <button class="tool subagent-head" data-state="pending" aria-expanded="false">
    <span class="subagent-label">Agent · Runtime phone density fixes</span>
    <span class="subagent-meta">Running node --test test-browser/…</span>
  </button>
  <div class="subagent-body" hidden></div>
</div>
```

The class split matters. The **head keeps the `tool` class and carries
`data-state`**, so every `.tool[data-state]::before` rule already in the
sheet applies with no new CSS: the same pending pulse, the same
`--accent-ink` when done, `--danger` when failed, `--caution` when refused.
The **wrapper is `.subagent` only** — a `display: flex; flex-direction:
column` box, so the body sits under the head rather than beside it, which is
what putting `tool` on the wrapper would have caused (`.tool` is a baseline
row).

The head wears both existing glyphs, and that pairing is the whole idea: the
`.tool::before` dot (so it is a step) and the `.tool-group-head::before`
caret (so it is a container). No new colour, no new shape, no badge.
`--muted` label, `--faint` meta, 12.5px, and the same `padding-left: 13px` on
the body that `.tool-group-body` uses.

### The states

- **`tool.call`** builds the row. It arrives *first* — measured: the `Agent`
  call is stream line 492, its `task_started` is line 509.
- **`subagent.start`** enriches it: `agentType` into `data-agent-type`,
  `description` into the label if the tool input had none.
- **`subagent.progress`** rewrites `.subagent-meta` to `step`, truncated with
  `text-overflow: ellipsis`, and stores the usage on the record. This is the
  live indicator, and it is the answer to "is anything happening": the line
  changes every time the subagent picks up a tool.
- **`subagent.tool.call` / `.result`** append rows into `.subagent-body`,
  routed by `parent`, using `toolLabel()` and the identical state machine as
  `toolCall()` / `toolResult()`. `collapseToolRows()` then runs **over the
  body's own children**, so a subagent's 129 steps fold into its own groups
  rather than the transcript's.
- **`subagent.text`** appends a `.subagent-say` paragraph, `--muted`, in the
  body.
- **`subagent.end`** maps `status` onto `data-state`: `completed` → `done`,
  `failed` → `failed`, `stopped` → `stopped`. The first two already have
  dot rules; `stopped` deliberately has none, so it falls back to
  `.tool::before`'s `--faint` grey, which reads as neither success nor
  failure — exactly right, and no new CSS. It then
  replaces the meta with the shape `129 steps · 38 min · 245k tokens`.
  `steps` is `usage.tool_uses`, the duration is `seconds(usage.duration_ms)`
  (`agent-ui.js:1424`, which yields `38 min` / `9 s`), and tokens are
  `usage.total_tokens` rounded to `k`. A `stopped` or `failed` subagent keeps
  the same meter — how far it got is the useful half — prefixed with
  `Stopped · ` or `Failed · `, matching how `toolResult()` already prefixes a
  failed row's kept label.

### Two registries, and the guard between them

`record(turn).tools` keeps mapping `callId` → the node `toolResult()` will
paint. For a subagent that node is the **head** (it carries `data-state`),
not the wrapper. A second map, `record(turn).subagents`, holds `callId` →
`{ wrapper, head, body, tools: Map, usage }`, where the inner `tools` map
pairs the subagent's *own* call ids to its *own* rows — a separate namespace,
so a nested call id can never collide with a parent one.

The `Agent` call's own `tool.result` still arrives, and left alone it would
do two wrong things: repaint a `stopped` subagent as `done`, and — on
failure — run `row.textContent = 'Failed: …'`, which would wipe the head's
label and meta spans. So `toolResult()` returns early for a node whose
`dataset.name` is `Agent` or `Task`: a subagent's outcome is `subagent.end`'s
to write, and it is strictly better informed.

`this.append(turn, …)` receives the wrapper, so the log's child list — and
therefore `turnNodes()` and `collapseToolRows()` — sees one node per
subagent.

### The two lines that make it visible

These are small and they are the point — without them the rest is invisible.

1. **`foldable()` (`agent-ui.js:1540`) excludes a subagent.** Today a
   finished subagent is swallowed into `17 steps` beside two greps. A row
   representing 38 minutes of work must never be folded away by a rule meant
   for one-line reads. It stands alone and, like a pending or failed row,
   ends a run.

   Guard on **`data-name`**, not on the class:

   ```js
   const foldable = (node) =>
     node?.classList?.contains('tool') &&
     node.dataset.name !== 'Agent' && node.dataset.name !== 'Task' &&
     node.dataset.state === 'done';
   ```

   `toolCall()` already writes `row.dataset.name = event.name`, so this works
   on *today's* plain `.tool` row — which is what lets step 3 of §6 ship
   before the `.subagent` markup exists. Once the wrapper is built it is
   doubly safe: `collapseToolRows` walks `turnNodes()`, whose members are the
   log's direct children, and the wrapper is a `.subagent` with no `tool`
   class, so it can never match anyway.
2. **The turn footer counts live subagents.** While a turn is running with
   `n ≥ 1` subagents pending, `footer()` renders `Working… · 2 agents`
   (`1 agent` singular) instead of bare `Working…`. `local_agent` only — a
   backgrounded `npm test` is not an agent and must not say so.

### What does not change

No change to the conversation card, the List/Board rows, the Focus pane
header, the phone Deck, or the `[data-state]` dots on any of them. A
subagent is an event inside a turn, and the turn is already marked running
everywhere those surfaces look. Adding a second liveness signal beside the
breathing dot would be noise, and `pane-focus-is-colour-only` is the standing
reason to resist decorating a surface that already says what it needs to.

### Reload

Replaying stored events rebuilds the row, the body, the states and the final
meter, because everything except `subagent.progress` is persisted. A subagent
that is *still running* when the page is reloaded shows its label, its rows
so far and a pending dot, with an empty meta until the next progress line
lands — at most one tool call's wait. Accepted: the alternative is persisting
a per-step line whose only value is being current.

### Motion, dark, phone

- Reduced motion: the pending dot is `.tool::before`, already covered by
  `agent-ui.js:2514`. The caret rotation reuses `.tool-group-head`'s existing
  120ms `--settle` transition. Nothing new to exempt.
- Dark: only `--muted`, `--faint`, `--accent`, `--accent-ink`, `--danger`,
  `--caution` — every one already has a dark value.
- Phone: the head is a single flex row; the label takes its natural width,
  the meta takes the rest and ellipses. The body indents 13px once per depth,
  like every other nested run.

## 5. Tests

- **`test/agent-provider-claude.test.js`** — new fixture
  `test/fixtures/providers/claude-subagent.jsonl`, cut from
  `45b61262736f/raw/45b61262736f-t6.jsonl` (a real `local_agent`: start,
  several progress lines, nested calls and results, notification). Assert:
  the six event types and their fields; a `local_bash` task produces
  `background` and **no** subagent event; `background`'s `pending` count is
  unchanged for both kinds; a notification for an unknown `task_id` yields
  neither a `subagent.end` nor a negative count; the existing test at :247
  (no `task_type`) still passes.
- **`test/agent-runner.test.js`** — `subagent.progress` publishes without
  appending; the other five append.
- **`test-browser/agents-subagents.test.js`** — the row renders as
  `.subagent`; the head expands and reveals nested rows; a finished subagent
  is **not** absorbed into a `.tool-group`; the footer reads `· 1 agent`
  while one is pending and drops the suffix when it ends; a `stopped`
  subagent does not read as done.

Run `test-browser` files one at a time and check `uptime` before believing a
failure — see `load-flaky-tests`.

## 6. Order of work

1. Parser + its tests (fixture first; the corpus is the oracle).
2. Runner dispatch + its tests.
3. `foldable()` and the footer count — the two smallest changes, and alone
   they already fix "no indicator".
4. The `.subagent` row, body and states.
5. Browser tests, then a look at a real turn that spawns a subagent.

Steps 1–3 are independently shippable and leave the UI strictly better than
today even if 4 is not reached.

## 7. Known gaps, deliberately not closed

- **A subagent's reasoning is not shown**, because it is not on the wire —
  only 17 text blocks across 688 nested assistant lines, and the real report
  arrives by `SubagentHandback` as a separate message. Expanding a subagent
  shows what it *did*.
- **You cannot continue a subagent.** The result carries
  `agentId: a48ba2ce2812681d6` and the CLI can resume it with `SendMessage`.
  Making that a button means deciding what a half-owned conversation is, and
  that is the child-pane subsystem this spec deliberately did not build.
- **No card- or list-level indicator.** §4 argues the turn's own running
  state already covers it.

The event shape is chosen so none of these is harder later: every subagent
record is keyed by a stable `callId` and carries `agentType` and `taskId`, so
a future "open this subagent as a pane" reads the records that already exist
rather than a new stream.
