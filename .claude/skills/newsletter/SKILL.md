---
name: newsletter
description: Build Bryan's Bulletin — a personalized daily dashboard as a Marble document at drive/Newsletter/today.mrbl. Spoken masthead + a rotating Sanzo-Wada color palette; panels for Today's focus, todos, key dates (list + calendar), weather (Zurich + San Diego), the US Open, a research/industry/HCI feed with full abstracts and figures, and a full sweep of today's arXiv cs.HC; then archive yesterday and (if asked) email a digest. Use when Bryan runs /newsletter or asks to build/refresh the daily bulletin.
---

# Bryan's Bulletin

Builds `drive/Newsletter/today.mrbl` — a stable path Bryan keeps a browser tab
on. Yesterday's issue is archived to `drive/Newsletter/archive/YYYY-MM-DD.mrbl`.

The document is inert HTML (`net=none`): it can't fetch or send. Everything
dynamic happens here, in this run. The mechanical half — archiving, date math,
the calendar grid, palette rotation, rendering the template, inlining images,
verifying invariants — is `lib/`. Your job is the gathering, the ranking, the
voice, and the representation.

**House style for every panel: more visual, more information.** If a thing has a
description, give the full version (abstract, dates, context). If it can carry a
picture — a paper's figure, a news photo, a player — inline one. If it's about
time, show a count *and* a calendar. Pick the representation that fits the thing.

## Files

| file | role |
|---|---|
| `template.mrbl` | the dashboard scaffold: warm palette tokens, panels, item `<template>`s, interactions. `build.mjs` fills it. Don't hand-edit per run. |
| `lib/build.mjs` | `readback`, `dates`, `assemble`, `harvest`, `check`. `node lib/build.mjs` for usage. |
| `lib/sources.mjs` | `weather` (Open-Meteo, Zurich + San Diego) and `arxiv` (cs.HC, today's papers with full abstracts). No keys. |
| `lib/images.mjs` | `<url\|path> [--width N]` or `--batch <json>` → `data:` URI (fetch + `sips` resize). The only way a picture reaches a `net=none` doc. |
| `lib/palettes.json` | ~18 palettes after *A Dictionary of Color Combinations*. `build.mjs` rotates one per issue and draws the swatch clump. |
| `sources.md` | feed query catalog + ranking rules. |
| `key-dates.md` | pins & corrections only — key dates are **discovered** each run (step 4). |
| `representations/LOG.md` | ledger of past "road ahead" representations — never repeat a form. |
| `state/seen.json` · `state/tuning.json` · `state/palettes.json` | build-managed ledgers (feed dedup, 👍/👎 steering, recent palettes). |

## Connectors (all connected)

Gmail, Google Calendar, Notion. Slack todos are out of scope until a Slack
connector exists — skip that source silently. If a connector is unavailable,
build without it and note the gap.

## The run

### 1. Read yesterday back

```
node .claude/skills/newsletter/lib/build.mjs readback drive/Newsletter/today.mrbl
```

Per-item `done`/`snooze`/`pin`/`open`/`vote`/`saved`/`note`/`title`/`url`, keyed
by `data-key`, plus the key-dates panel's `dateView`. Use it to drop `done`
todos, carry `snooze`d ones forward, and see feed votes/saves. `vote`, `saved`,
`note`, and the expand state `open` are carried forward automatically for any
item you re-include — you don't thread them through the payload. (First run:
`exists:false` — skip.)

### 2. Masthead — the voice

- `greeting`: `"Good morning, Bryan!"` (or match the hour if it's clearly not
  morning).
- `summary`: **2–3 sentences, written to Bryan**, plain and warm — where his head
  should be today, the one or two things in the way, and a taste of what's below.
  Not a bulleted recap; prose.
- `glance` is auto (focus count, todos, next date, weather, arXiv count).
- The **palette** is automatic — `build.mjs` picks a Sanzo-Wada combination not
  used in the last several issues and shows its swatch clump top-left. Pass
  `palette` (a name from `palettes.json`, or an index) only to force one.

### 3. Today's focus + todos

- **`focus`** — the *few* things that genuinely must happen today (2–4). Each
  `{ title, why }`. This is the "if nothing else" list.
- **`todos`** — the fuller list: Notion (`My Tasks` / dated pages — note the DB
  may not return rows through the connector; fall back to mail + calendar +
  the current trip page), Google Calendar task-like items, Gmail threads needing
  a reply/action (summarize each as one line), plus carried-forward snoozed
  todos. `{ title, source, meta?, note?, snooze? }`.

### 4. Key dates — a discovery task

**Go find the dates Bryan needs to be aware of over the next ~6 months.** Sweep
every run — don't read a static list:

- **Google Calendar** — `list_calendars`, then `list_events` over ~180 days on
  every calendar. Keep milestone-shaped entries (deadlines, flights, trips,
  start/end dates, retreats, screenings).
- **Gmail** — `search_threads`: `deadline OR "due date" OR submission OR
  camera-ready`, `flight OR itinerary OR "booking confirmation"`, `Ai2 OR "Allen
  Institute" OR internship`, `CHI OR UIST OR review OR rebuttal`, `visa OR I-20
  OR CPT OR insurance OR lease`. Open the promising threads for the concrete date.
- **Notion** — dated pages / trip plans / a semester tracker.
- `node lib/build.mjs dates` — sweeps `third-year.mrbl` + `key-dates.md`.
- `key-dates.md` — pins & corrections only; rewrite a `(confirm)` line when you
  verify it.

Emit `{ label, date: "YYYY-MM-DD", source }`. Resolve fuzzy dates ("mid-Oct")
against the calendar and tag "(approx)". Dedupe across sources. `build.mjs`
computes "N days", the day-count bars, the flag for ≤14 days, **and the 2-month
calendar grid** — the panel toggles between them.

### 5. Weather

```
node .claude/skills/newsletter/lib/sources.mjs weather
```

Drop the JSON straight into `payload.weather`. It carries current temp + feels,
hi/lo, condition, and the next ~9 hours for **Zurich** (where Bryan is) and **San
Diego**. `build.mjs` renders the cards, the "rest of the day" line, and the
hourly strip. On `{"error":...}` the panel says so — still fine.

### 6. US Open

It's on now (through ~Sep 13). `WebSearch` the current state of both draws —
completed rounds with scores, the live QF/SF/F matchups, seeds, and any
champion. Fill `payload.usOpen`:

```jsonc
{ "asOf": "Mon, Sep 7",
  "note": "one line on where the tournament is",
  "men":   { "rounds": [ { "name": "Round of 16", "matches": [
             { "a": {"seed":"2","name":"C. Alcaraz","score":"6-4 6-3 6-4","photo":"<url>"},
               "b": {"seed":"20","name":"T. Paul"}, "winner":"a" } ] } ],
             "champion": null },
  "women": { ... } }
```

Add a `photo` URL for the notable players / the champion when you can find a
hotlinkable one (`build.mjs` inlines it via `images.mjs`; Wikimedia hotlinks are
blocked, ESPN/press photos usually work). Missing photos degrade to a clean
placeholder.

### 7. Feed

Follow `sources.md`. Three buckets (`genui` · `industry` · `hci`), ~3–6 each.
**Each item now carries the long version:**

```jsonc
{ "tag": "arXiv", "title": "...", "url": "...", "meta": "authors · venue",
  "published": "May 26, 2026",            // human date, so age is obvious
  "why": "one sentence — which thesis it touches",
  "abstract": "the full abstract, or a clearly-marked (summary) paraphrase",
  "authors": ["..."],                      // optional
  "image": "<url or data: URI>" }           // a figure / og:image when there is one
```

Prefer the real abstract (arXiv API by id, or the abs page). If you paraphrase,
prefix `(summary)`. For `image`, pass a URL and `build.mjs` inlines it (budget
~14 images/issue), or inline it yourself with `images.mjs` and pass the `data:`
URI. Drop items whose key is in `state/seen.json`; apply `state/tuning.json`.

### 8. Today on arXiv — cs.HC

```
node .claude/skills/newsletter/lib/sources.mjs arxiv --max 70
```

Returns every cs.HC paper from the newest submission date (arXiv skips
weekends), each with **full abstract, author list, submitted date, primary
category, abs/pdf/html URLs**. Put the whole object in `payload.arxiv`, then:

- add a one-line `why` to each paper (how it relates to the vision, or "peripheral");
- for the ~4–6 most relevant, add an `image`: grab the first real figure from
  `https://arxiv.org/html/<id>` (`<img src>` under the paper's folder) and either
  pass the URL or inline via `images.mjs --batch`.
- Optionally also skim Google Scholar's recent HCI results for anything arXiv
  missed and fold it into the feed — Scholar has no API and blocks scraping, so
  treat it as best-effort and don't block the run on it.

`build.mjs` renders each as an expandable row with the submitted date shown
(fresh ones highlighted), abstract behind "abstract", figure inline, and
vote/save/note.

### 9. The "road ahead" representation

As before: read `research-vision.mrbl` §§04–06 + project states, design a
**brand-new** visual of the agenda (a form not in `representations/LOG.md`),
self-contained markup + one scoped `<style>` using the palette vars (`--ink`,
`--muted`, `--line`, `--accent`, `--accent-soft`, `--warm`, `--faint`), **no
script / no network / no external assets**, fresh `data-marble-id` on every
element, a few pieces editable or sortable. Append a line to `LOG.md`.

### 10. Assemble

Write the payload to a temp file, then:

```
node .claude/skills/newsletter/lib/build.mjs assemble --payload /tmp/nl-payload.json
```

Archives the current issue, picks + injects the palette, renders every panel,
inlines images, runs the self-check, writes atomically, re-reads from disk. On
failure it aborts without writing — fix the payload and re-run. Recover a
corrupted file from `drive/.marble/history/`.

### 11. Harvest → dashboard, then verify

```
node .claude/skills/newsletter/lib/build.mjs harvest drive/Newsletter/archive/<yesterday>.mrbl
```

Updates `state/seen.json`, prints `saved` items + `votes`. Fold 👍/👎 into
`state/tuning.json`. Add each newly `saved` feed item to `drive/Newsletter/index.mrbl`'s
reading list (build-in-marble rules: minimal edit, fresh ids, title link + meta +
note + PDF/arXiv URL + a `<pre>` BibTeX block). Refresh its recent-issues and
representations lists.

- `node lib/build.mjs check --file drive/Newsletter/today.mrbl`
- `MARBLE_APPS="$PWD/drive" node node_modules/@bdhmin/marble/bin/marble.js doctor drive/Newsletter/today.mrbl drive/Newsletter/index.mrbl` — expect 0 errors
- Report: palette name, counts per panel, images inlined, what was archived, any
  source that was unavailable.

### 12. Email (only if asked, or if this is the scheduled morning run)

Compact HTML digest to **bdmnewsletters@gmail.com**: greeting, the focus list,
next key date, weather one-liner, top 3 feed items as links, and a prominent link
to `http://localhost:4400/a/Newsletter%2Ftoday`. Sending is side-effecting —
don't do it on an ad-hoc rebuild unless Bryan asks.

## Payload schema (v2)

```jsonc
{
  "date": "YYYY-MM-DD",
  "greeting": "Good morning, Bryan!",
  "summary": ["sentence", "sentence", "sentence"],
  "palette": "Peacock & Sand",            // optional; omit to auto-rotate
  "glance": ["<b>3</b> to focus on", ...], // optional; omit to auto-build
  "focus":    [{ "title", "why" }],
  "todos":    [{ "title", "source", "meta"?, "note"?, "done"?, "snooze"?, "pin"?, "key"? }],
  "keyDates": [{ "label", "date": "YYYY-MM-DD", "source"? }],
  "weather":  <sources.mjs weather output>  |  { "error": "..." },
  "usOpen":   { "asOf", "note", "men": {...}, "women": {...} }  |  { "error": "..." },
  "arxiv":    <sources.mjs arxiv output, each paper + why + optional image>  |  { "error": "..." },
  "feed": { "genui": [ <feed item> ], "industry": [...], "hci": [...] },
  "representation": { "name": "Iceberg", "html": "<style>.repr …</style>…" }
}
```

## Invariants

- One write per run, through `assemble` (atomic temp+rename). Don't hand-write `today.mrbl`.
- Never reuse a `data-marble-id`. `assemble` mints fresh ones; your representation must too.
- Representation = markup + scoped CSS only. No script, no network, no external assets.
- Images reach the doc only as `data:` URIs (via `images.mjs` or pre-inlined). External `<img src>` is dead under `net=none`.
- `today.mrbl` is a stable path — never rename it, never point the email elsewhere.
- If `check`/`doctor` fails after a write, restore from `drive/.marble/history/`.
