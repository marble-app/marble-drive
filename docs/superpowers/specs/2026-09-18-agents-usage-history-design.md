# Agents usage history: a daily heatmap and per-model breakdown

Date: 2026-09-18. Status: draft, awaiting review.

## Goal

The Usage tab of the agent settings sheet shows three or four live limit bars
and nothing else. Make it a real picture of how the person has been using
their agents: a GitHub-style daily activity heatmap, a per-model breakdown
(including Fable), and a few summary numbers.

## What exists (checked 2026-09-18, not assumed)

- Anthropic's `/api/oauth/usage` returns only the current windows: no history.
  Fable is the `weekly_scoped` entry in `limits` with
  `scope.model.display_name: "Fable"` (already parsed in `server/agent/usage.js`).
- Claude Code writes every assistant message to
  `~/.claude/projects/**/*.jsonl` with a timestamp, `message.model`, and
  `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`). On this machine: 254 files, 392 MB, 2026-08-16 to
  now, 26 active days, 28,129 assistant lines of which 14,802 are duplicates
  (the same `message.id` + `requestId` appears once per content block, and
  again in resumed sessions). Models seen: opus-5, sonnet-5, haiku-4.5,
  fable-5-1, plus `<synthetic>` placeholders. A full aggregate scan takes
  about 1.2 s.
- The agents host already has a gated `GET /agent/usage` and a client method
  `agent.usage()` (`runtime/agent.js:147`); tests inject `usage` on `createDrive`.
- The Usage tab is a 460 px modal sheet (`SETTINGS_CSS`, `runtime/agent-ui.js`).

## Decisions (and why)

1. **Source is the local Claude Code transcripts.** They are the only history
   available, and they are the person's own files on the host machine. The
   server reads numbers out of them and returns only aggregates: no message
   text, no paths, no prompts ever leave the file scan.
2. **The heatmap measures work, not quota.** The quota percentage is not
   derivable from tokens, so the heatmap does not pretend to be "percent of
   limit". Default metric is **Tokens = input + output + cache-creation**.
   Cache reads are excluded from the headline: they are ~100x larger
   (hundreds of millions a day) and would flatten every other signal. They
   appear in the tooltip. A second metric, **Messages**, is a toggle.
3. **Dedupe globally by `message.id:requestId`**, keeping the first sighting,
   so resumed sessions and per-block repeats are not double-counted. Subagent
   (sidechain) messages are counted: they spend usage. `<synthetic>` is dropped.
4. **Days are host-local calendar days.** One timezone, stated in the UI
   footer. A remote viewer in another zone sees the host's days.
5. **Incremental scan, in memory.** Cache per file keyed on
   `(path, size, mtimeMs)`; only changed files are re-read; files whose mtime
   is older than the requested range are skipped. Result memoised ~60 s. No
   on-disk cache: the cold scan is ~1 s and shown behind a loading state.
6. **Widen the sheet on the Usage tab only** (to `min(880px, 100vw - 24px)`).
   A dedicated page is more surface than this needs, and the person asked for
   it in the usage popup. Clicking a header meter also opens the Usage tab.
7. **Model families**: `opus`, `sonnet`, `haiku`, `fable`, `other` by regex on
   the model id, so a new point release lands in its family without a code
   change. (`claude-fable-5-1` -> fable.)
8. **New client module** `runtime/agent-usage-charts.js`, registered like
   `agent-folders.js` (two entries in `server/app.js`). `agent-ui.js` is
   already ~4,000 lines; the chart rendering is self-contained.

## Server

`server/agent/usage-history.js`

- `createUsageHistory({ root, ttl, now })` returns
  `async ({ weeks = 26 } = {}) => { from, to, generatedAt, tz, source, days }`.
- `days`: `[{ date: 'YYYY-MM-DD', messages, tokens, cacheRead, byModel: { fable: { messages, tokens }, ... } }]`,
  dense over the range (zero days included) so the client does no gap filling.
- Missing root, unreadable file, bad JSON line: skipped, never a throw; an
  absent directory is an empty history.
- Route `GET /agent/usage/history?weeks=N` in `server/agent/routes.js`, behind
  the same gate as `/agent/usage`; `weeks` clamped to 1..53.
- `createDrive` accepts an injected `usageHistory` (as it does `usage`) so
  browser tests never read the real `~/.claude`.
- Client: `usageHistory: (weeks) => ask('/agent/usage/history?weeks=' + weeks)`.

## Client: the Usage tab

Top to bottom, in one scrolling sheet:

1. **Limits now** (existing rows: Claude Short-term / Weekly / Fable, Cursor).
2. **Activity heatmap** (the hero). Columns are weeks, rows Sun-Sat, Mon/Wed/Fri
   labels at left, month labels on top, up to 26 weeks trimmed on the left to
   the first week with data (minimum 12 weeks so it is never a sliver). Five
   levels: empty plus four steps of one accent hue (quartiles of the non-zero
   days in the current metric + filter). Today is outlined. Legend "Less to
   More". Cells are focusable; hover or focus shows a tooltip:
   `Fri, Sep 18 - 1.6M tokens - 1,642 messages - Opus 61% - Sonnet 30% - Fable 9%`.
   Above it: metric toggle (Tokens | Messages) and model chips
   (All, Opus, Sonnet, Fable, Haiku) that recolour the grid to that model only.
3. **Summary tiles**: this week vs last week (with a delta), busiest day,
   active days ("26 of 34"), current and longest streak, average per active day.
4. **Weekly stacked bars by model**, last 12 weeks: shows Fable's share over
   time. Bars are labelled; a model-share strip (whole range) sits above.
5. Footer: "Claude Code on this Mac - days in <tz> - cache reads excluded from
   token counts."

Empty history (no transcripts): the section shows a single line and the live
limits are unchanged. While loading: skeleton grid. Failure: a short inline
message; the live limits still render.

Visual rules (per the dataviz skill, loaded at implementation): one accent hue
for intensity, a validated categorical palette for the four model families,
both themes, no colour-only encoding (levels also carry an aria-label with the
value), tooltips reachable by keyboard, `prefers-reduced-motion` respected.

## Testing

- Unit `test/agent-usage-history.test.js`: fixture directory of `.jsonl`
  covering cross-file duplicates, per-block repeats, synthetic, sidechain, bad
  lines, a missing root, model-family mapping, local-day bucketing across
  midnight, range cutoff, incremental re-scan (changed vs untouched file), zero
  days present.
- HTTP: the route is gated, clamps `weeks`, and returns the injected history.
- Browser (`agents-page.test.js` + harness stub): grid has one cell per day,
  levels rise with value, tooltip text, model chip and metric toggle recolour,
  keyboard focus reaches cells, sheet widens on the Usage tab only, header
  meter click opens it, empty and error states, phone width has no overflow.

## Not in scope, and known limits (stated in the UI where it matters)

- Only Claude Code on this Mac: not claude.ai chat, other machines, or Cursor
  (Cursor's dashboard API is not known to expose daily history).
- The heatmap is not percent of quota; it is tokens or messages.
- No cost estimate: no reliable price table for new models.
- No persistence of history beyond the transcripts themselves.

## Coordination

Touches `server/app.js` (two lines, module registration) which another session
(marble-drive-10) is editing on a branch; tell them before that edit. The
Agents-page live doc needs no change: the Usage tab is in `agent-ui.js`.
