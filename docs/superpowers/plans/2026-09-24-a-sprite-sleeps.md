# A sprite sleeps when nobody needs it: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** no sprite runs without a person using it or work making progress, and not more than a day unattended; limits freeze, never kill.

**Spec:** `docs/superpowers/specs/2026-09-24-a-sprite-sleeps-when-nobody-needs-it-design.md`

## Tasks

1. `server/awake.js`: the awake clock (15 s tick, gap capped at two ticks) and a process-tree progress sampler (`/proc` CPU + I/O; inert off Linux). Unit tests with a fake clock and fake `/proc`.
2. Keep-awake by progress: the runner records per turn its last output (awake time), open-ask start, and child pid; keep-awake holds a turn unless 10 min unanswered, 30 min without progress (output or process-tree CPU/I/O), or 24 h since the drive was last used; stem splits under the progress and 24 h rules. Unit tests.
3. The stall rule reads the same progress and awake clock. Unit tests: a quiet busy turn is not stalled; a thawed turn is not stalled.
4. `server/streams.js` + `POST /tab/alive`: streams tagged `tab=<id>`, closed after 15 min unused, untagged streams unused, 204 on reconnect when unused. Unit tests.
5. `runtime/tab-rest.js`, injected first, reading its limits from the host; the usage meter polls only while awake. Browser tests (shortened limits).
6. Settings in `server/config.js`; HOSTING.md and HOSTING-DECISIONS.md updated.
7. Real run on t-bryan.

## Global constraints

Defaults: hidden 60 s, idle 10 min, stream unused 15 min, ask hold 10 min, no progress 30 min, awake max 24 h. Freeze, never kill: no limit ends a turn except the stall rule after 30 min of true no-progress in awake time.
