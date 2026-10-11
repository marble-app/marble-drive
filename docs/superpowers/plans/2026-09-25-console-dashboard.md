# Console Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each drive keeps a per-minute ledger of its awake time, CPU, memory, disk and reasons; the Console gathers them and draws state, use and cost over time on a Dashboard it opens on.

**Architecture:** `server/ledger.js` on every drive appends one JSON line per awake minute. On admin-p1, `server/console/usage.js` pulls new lines from awake drives with `sprite exec` of `ledger-read.mjs`, records API status changes, and answers `/console/api/usage` from three pure modules (`timeline.js`, `cost.js`, `bill.js`). `runtime/console-charts.js` draws hand-built SVG; `runtime/console.js` gains a Dashboard view.

**Tech Stack:** Node (ESM, no dependencies added), `node:test`, Playwright via `test-browser/harness.js`, plain SVG.

**Spec:** `docs/superpowers/specs/2026-09-25-console-dashboard-design.md`

Executed natively in this session at the owner's request ("ship this to admin"), so tasks list interfaces and tests; the code is written test-first in each task.

## Global Constraints

- Showing the console never wakes a drive: exec only on sprites whose API `status` is `running`.
- The ledger never fails the host: a write or read error is logged once and ignored.
- Ledger path: `<store.marbleDir>/usage/<YYYY-MM-DD>.jsonl` (UTC), kept 90 days.
- Named `ledger`, not `usage`: `createDrive` already has `usage`/`usageHistory` options for Claude's usage API.
- Rates: until 2026-09-30 CPU $0.07/CPU-h, RAM $0.04375/GB-h; from 2026-10-01 CPU $0.03825, RAM $0.021875; hot $0.000683/GB-h, cold $0.000027/GB-h throughout. Floors while running: 0.0625 CPU, 0.25 GB.
- No new npm dependencies; no chart library.
- Charts: one axis each; state is one hue strong→pale plus hatched unknown; sprites fixed categorical order by creation; a Table toggle on every chart card.

## Review Focus

- A drive that restarts (deploy) mid-minute: the next line says `wake:"restart"`, never double-counts CPU (a counter that went backwards is a restart, delta taken from zero).
- The Console restarting: the pull cursor persists per sprite, so no line is stored twice or lost.
- A sprite removed or renamed: its stored history still draws for the ranges that include it; no crash on an unknown name.
- A range with no data at all (fresh install): every chart draws its empty state, the numbers say "—", no NaN.
- A pasted bill in an unexpected shape: the parser names the line it could not read and stores nothing.

---

### Task 1: The ledger on every drive

**Files:** Create `server/ledger.js`, `test/ledger.test.js`. Modify `server/app.js` (create after `streams`/`keepAwake`, `GET /usage` behind the gate, close on shutdown).

**Interfaces — Produces:**
- `createLedger({ dir, clock = createAwakeClock-like {now()}, readers = systemReaders(), why = () => ({tabs, looking, work, asks}), counters = () => ({turns, opens}), now = Date.now, tickMs = 15_000, lineMs = 60_000, keepDays = 90, schedule = setInterval, log })` → `{ tick(), flush(), read(sinceT) → Promise<line[]>, stop() }`
- `systemReaders({ root = '/' })` → `{ cpuSeconds() → number|null, memGB() → number|null, diskGB() → number|null, bootId() → string|null }`
- Line: `{ t, dt, cpu, mem, disk, why:{tabs,looking,work,asks}, turns, opens, wake }`
- Wake: first line of a process: `"cold"` if bootId differs from `<dir>/.boot`, else `"restart"`; a later line after a clock jump (wall gap > 2 × tickMs between ticks): `"warm"`.

- [ ] Tests: minute line from fake readers (cpu delta, mem average of 4 readings, disk); counter going backwards → delta from 0; wake cold/restart/warm; 90-day prune at start; write failure logs once and keeps running; `read(since)` across two day files; `GET /usage?since=` behind the gate returns lines.
- [ ] Implement; wire in app.js: `why` from `streams.count`, `streams.looking(60_000)` (new: tabs with `alive` in the last minute), `keepAwake.state().held`, paused turns; `counters` from new turn ids seen and HTML document serves.
- [ ] `node --test test/ledger.test.js test/server.test.js`; commit.

### Task 2: Timeline, cost and bill (pure)

**Files:** Create `server/console/timeline.js`, `server/console/cost.js`, `server/console/bill.js`, tests `test/console-timeline.test.js`, `test/console-cost.test.js`, `test/console-bill.test.js`.

**Interfaces — Produces:**
- `segments({ lines, observations, from, to, now, status })` → `[{from, to, state:'running'|'warm'|'cold'|'unknown', coldEdge?:true, why?, cost?, peakMem?}]` (times in unix ms)
- `RATES` (array of `{from: 'YYYY-MM-DD', cpu, ram, hot, cold}`), `rateAt(tMs)`, `lineCost(line)` → `{ram, cpu, hot}`, `coldCost(diskGB, fromMs, toMs)`, `calibrate(cost, bill)` → factors `{ram, cpu, hot}`, `project({ monthToDate, lastDays:[$...], now })` → `{end, low, high}`
- `parseBill(text)` → `{ ok:true, bill:{from,to,total,products:{ram,cpu,hot},apps?} } | { ok:false, line, why }`

- [ ] Tests: segments from ledger only, observations only, both; cold gap with unknown switch; unknown before first datum; cost across 2026-10-01; floors; calibrate; projection across a month boundary; the exact 2026-09-25 paste; a per-app paste; an unreadable line.
- [ ] Implement; run; commit.

### Task 3: Gathering and the API (admin-p1)

**Files:** Create `server/console/usage.js`, `server/console/ledger-read.mjs`, `test/console-usage.test.js`. Modify `server/console/index.js` (pull in `tick`, observations in `readFleet`, routes, SSE `usage`), `test/fixtures/fake-sprite.mjs` (answer `node /tmp/marble-ledger-read.mjs <since>` from `state.ledger[name]`).

**Interfaces — Produces:**
- `createUsage({ dir, sprites, self, selfLedger, now })` → `{ observe(fleetRows), pull(name) → Promise<line[]>, query({range}) → payload, setBudget(n|null), addBill(text) → parseBill result, budget(), bills() }`
- Payload per spec §4: `{ now, from, to, step, rates, bill, budget, sprites:[{name, role, createdAt, status, segments, buckets:[{t, awake, cpu, mem, cost:{ram,cpu,hot,cold}, why:{looking,idle,work,asks,other}, turns, opens}], totals:{cost, awakeHours, byProduct}}], totals, projection, calibration }`
- Routes: `GET /console/api/usage?range=`, `POST /console/api/bill`, `PUT /console/api/budget`; SSE events `usage` `{sprite, lines}` and `status` `{sprite, status, t}`.

- [ ] Tests: pull stores lines once across a restart (cursor file); exec only for `running`; observations only on change; query buckets and totals; bill route; budget route; SSE `usage` after a pull.
- [ ] Implement; `node --test test/console-*.test.js`; commit.

### Task 4: The Dashboard

**Files:** Create `runtime/console-charts.js`, `test-browser/console-dashboard.test.js`. Modify `runtime/console.js` (VIEWS gains Dashboard first, default; `drawDashboard`; Drives detail *Use* section; `usage`/`status` events), `runtime/console.css`, `server/app.js` (RUNTIME + inject `console-charts.js` before `console.js`).

**Interfaces — Consumes:** Task 3 payload. **Produces:** `window.marbleConsoleCharts = { timeline, hbarStack, cumulative, columns, share, heatmap, lines, sparkPair, tiles, table }`, each `(el, data, opts) → void`, drawing into a card body.

- [ ] Validate palettes with the dataviz validator (light and dark).
- [ ] Browser tests: opens on Dashboard; range switch refetches; hover a segment shows its tooltip; a `usage` event extends a lane without a refetch; Table toggle; 390 px wide with no horizontal scroll; empty data draws "—".
- [ ] Implement; `node --test test-browser/console-dashboard.test.js test-browser/console.test.js`; commit.

### Task 5: Docs, try, ship

- [ ] `docs/HOSTING.md` (Costs; ledger in the file table), `docs/HOSTING-DECISIONS.md` entry; commit.
- [ ] `npm test`; `tools/sprite-deploy.sh t-bryan --local`; exec on t-bryan: cgroup files, one ledger line.
- [ ] Push `main`; `tools/sprite-deploy.sh admin-p1`; check the Console on admin-p1.
