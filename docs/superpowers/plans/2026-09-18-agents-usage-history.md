# Agents usage history: implementation plan

> **For agentic workers:** executed inline in one session (decided 2026-09-18:
> the tasks share interfaces tightly and the user asked to implement now).
> Steps use checkbox syntax. TDD: each task writes its test first.

**Goal:** a GitHub-style daily activity heatmap, per-model breakdown (with
Fable) and summary tiles in the agent settings Usage tab.

**Architecture:** the host aggregates Claude Code transcripts
(`~/.claude/projects/**/*.jsonl`) into dense per-day, per-model counts behind a
gated `GET /agent/usage/history`. A self-contained browser module
(`runtime/agent-usage-charts.js`) turns those days into the charts; the settings
sheet embeds it.

**Tech stack:** Node ESM server, classic-IIFE browser module, plain
HTML/CSS/SVG, `node:test`, Playwright browser tests via `test-browser/harness.js`.

**Spec:** `docs/superpowers/specs/2026-09-18-agents-usage-history-design.md`

## Global constraints

- Aggregates only leave the file scan: no message text, prompts or paths.
- Tokens = input + output + cache-creation. Cache reads are a separate field.
- Dedupe globally on `message.id:requestId`; drop `<synthetic>`; keep sidechains.
- Days are host-local (an IANA `timeZone` option makes tests deterministic).
- Model families: `opus | sonnet | haiku | fable | other`, by regex on the id.
- Palette (validated 2026-09-18, both themes pass; light aqua/yellow are
  below 3:1 so every segment carries a visible label plus a data table):
  categorical slots 1-4 = opus blue, sonnet orange, fable aqua, haiku yellow;
  heatmap = the one-hue sequential blue ramp.
  light `#2a78d6 #eb6834 #1baf7a #eda100`, dark `#3987e5 #d95926 #199e70 #c98500`.
- Both themes, keyboard-reachable cells, `prefers-reduced-motion`, phone width
  without horizontal page scroll, no colour-only encoding.
- Nothing is committed unless the user asks; stage by name (other sessions have
  uncommitted work in this tree).

## Files

- Create `server/agent/usage-history.js` — scan, dedupe, aggregate, memoise.
- Create `test/agent-usage-history.test.js`.
- Modify `server/agent/routes.js`, `server/agent/index.js`, `server/app.js`
  — route, injection (`usageHistory`), module registration.
- Modify `runtime/agent.js` — `usageHistory(weeks)`.
- Create `runtime/agent-usage-charts.js` — pure helpers + DOM renderer.
- Create `test/agent-usage-charts.test.js` — helpers under node.
- Modify `runtime/agent-ui.js` — embed in the Usage tab, widen sheet, meter click.
- Modify `test-browser/harness.js` — `usageHistory` stub.
- Modify `test-browser/agents-page.test.js` — UI behaviour.

## Interfaces

```js
// server/agent/usage-history.js
familyOf(modelId: string) -> 'opus'|'sonnet'|'haiku'|'fable'|'other'
createUsageHistory({ root?, ttl?, now?, timeZone? }) -> async ({ weeks = 26 } = {}) => History
History = { source: 'claude-code-local', tz, generatedAt, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', days: Day[] }
Day     = { date, messages, tokens, cacheRead, byModel: { [family]: { messages, tokens } } }  // dense, ascending
// runtime/agent-usage-charts.js  ->  globalThis.marbleUsageCharts
value(day, { metric: 'tokens'|'messages', model: 'all'|family }) -> number
levelFn(values: number[]) -> (v: number) => 0|1|2|3|4        // quartiles of the non-zero values
grid(days, { minWeeks = 12 }) -> { weeks: (Cell|null)[][], months: { col, label }[] }  // Sunday-first, left-trimmed
summary(days, opts) -> { last7, prev7, delta, busiest, activeDays, totalDays, streak, longest, avgActive }
weekly(days, { weeks = 12, ...opts }) -> { start, total, byModel }[]
share(days, opts) -> { family, value, share }[]
compact(n) -> '1.6M' | '12.3k' | '840'
render(host, history, { metric = 'tokens', model = 'all' } = {})   // DOM
```

## Task 1: the history scanner

**Files:** create `server/agent/usage-history.js`, `test/agent-usage-history.test.js`.

- [ ] Write the failing tests over a temp-dir fixture of `.jsonl` files:
  cross-file duplicate counted once; per-block repeat counted once;
  `<synthetic>` dropped; sidechain kept; bad JSON line and a non-assistant line
  skipped; missing root gives an empty dense history; `familyOf` maps
  `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`,
  `claude-haiku-4-5-20251001`, an unknown id; a message at 23:30 and 00:30 in
  `America/Los_Angeles` land on different days; `days` is dense with zero days;
  a file older than the range is skipped; a second call after appending to one
  file re-reads only that file (spy on a counter the module exposes as
  `history.stats.filesParsed`); `weeks` is clamped 1..53.
- [ ] Run: `node --test test/agent-usage-history.test.js` — expect FAIL (module missing).
- [ ] Implement `usage-history.js` to make them pass (streaming `readline`, a
  cheap substring filter before `JSON.parse`, per-file records keyed on
  `path + size + mtimeMs`, global `Map` dedupe at aggregation, ttl memo).
- [ ] Run again — expect PASS.

## Task 2: route, injection, client method

**Files:** modify `server/agent/routes.js`, `server/agent/index.js`,
`server/app.js`, `runtime/agent.js`, `test-browser/harness.js`; test in
`test/agent-http.test.js`.

- [ ] Failing test: `GET /agent/usage/history?weeks=999` returns the injected
  history with `weeks` clamped to 53, `weeks=abc` falls back to 26, and a closed
  drive answers 401 like `/agent/usage`.
- [ ] Implement: route next to `/agent/usage`; `usageHistory` option on
  `createDrive` -> `createAgents` -> `createAgentRoutes`, defaulting to
  `createUsageHistory({ root: <home>/.claude/projects })`; register
  `agent-usage-charts.js` (map entry + `<script>` after `agent-folders.js`);
  `usageHistory: (weeks) => ask('/agent/usage/history?weeks=' + weeks)` in
  `runtime/agent.js`; harness stub returns a deterministic 26-week history.
- [ ] Run `npm test` — expect PASS.

## Task 3: pure chart helpers

**Files:** create `runtime/agent-usage-charts.js` (helpers first), `test/agent-usage-charts.test.js`.

- [ ] Failing tests: `value` for both metrics and a model filter; `levelFn`
  gives 0 for zero and monotone levels 1-4 by quartile (and all-equal data does
  not divide by zero); `grid` starts on Sunday, pads the first/last week with
  `null`, trims empty leading weeks but never below 12 weeks, emits month labels
  at the first column of each month; `summary` streaks (current streak ends
  today or yesterday), busiest day, delta sign and a zero previous week gives
  `delta: null`; `weekly` sums to `summary` totals; `share` sums to 1;
  `compact` boundaries (999, 1_000, 1_250_000).
- [ ] Run — FAIL. Implement helpers. Run — PASS. (Node imports the file for its
  side effect and reads `globalThis.marbleUsageCharts`, as `agent-folders.js` does.)

## Task 4: renderer and settings integration

**Files:** modify `runtime/agent-usage-charts.js` (add `render`), `runtime/agent-ui.js`.

- [ ] Failing browser tests (`agents-page.test.js`): Usage tab shows a heatmap
  with one cell per day in range; cell `data-level` rises with value; hovering or
  focusing a cell shows the tooltip text; the "Fable" chip recolours the grid
  (only days with Fable messages are non-zero); the Messages toggle changes the
  tooltip unit; summary tiles, stacked weekly bars with a label on every
  segment, and a data table (visually hidden) are present; the sheet is wider on
  the Usage tab than on Settings; clicking a header meter opens the Usage tab;
  the empty history and a rejected fetch each show one inline line while the
  live limit bars still render; at 360px there is no horizontal page scroll.
- [ ] Implement `render` (heatmap grid as focusable `<button>` cells inside a
  `role="grid"`-free labelled group; one shared tooltip; chips and metric
  toggle as `aria-pressed` buttons; summary tiles; weekly stacks with 2px surface
  gaps and 4px rounded data-ends; share strip with direct labels; legend;
  footer). Tokens defined as CSS custom properties on the chart root, light and
  dark selected (not auto-flipped), skeleton while loading.
- [ ] Wire it into the Usage tab: fetch after the live meters render, widen the
  sheet via a `data-tab="usage"` attribute, header meters `click` ->
  `openSettings('usage')`.
- [ ] Run the agents-page suite — expect only the known pre-existing failures.

## Task 5: verification

- [ ] `npm test` and the agents/collab/conversation browser suites.
- [ ] Render the real thing with the harness at 1280 and 360 wide, light and
  dark, and look at the screenshots (layout, label collisions, overflow).
- [ ] Run the palette validator once more on the exact hexes shipped.
- [ ] Restart is the person's call; tell them what needs it.

## Self-review

Spec coverage: source/aggregation (T1), route and gate (T2), metric and
filters, heatmap, tiles, weekly stacks, footer, empty/error states (T3-T4),
widened sheet and meter click (T4), tests and known limits (T1-T5). Interface
names above are the only ones used in later tasks.
