# Bryan's Days: the almanac (2026-09-21)

The folder `Bryan's Days` in the Drive currently draws its back issues as a
filing cabinet: date, theme, `1,598 nodes · 931 KB`. Bryan asked for the older
content to be *summarised from what the files contain* — the important tidbits,
the best things, and the things he noted for himself — and to see it in several
representations. This is the design, the decisions and their reasons.

## Thesis

A day is not a file. Each issue was written for one reader on one morning, and
the reader left marks on it: ticks on to-dos, ★ on papers, ▲/▼ on news, notes in
his own words. The unit of the archive is therefore not the document but the
**thread** — the to-do that carried nine days before it was done, the paper he
starred, the note he wrote himself, the painting that coloured the day. The
folder should read those marks back. Node counts are what the *host* knows about
a day; the folder should say what the *day* knows.

## What every issue already carries (the digest)

Read in the browser from the issue's own HTML (`fetch` of `/a/<path>`,
`DOMParser`), so the folder needs no build step, no host change, and any issue —
including the ones written before `data-comp` existed — is readable:

| field | where it comes from |
|---|---|
| date, theme | `meta[name=day:date]`, `meta[name=day:title]`, else the listing's `day`/`title` |
| palette | `.pal .pal-chips i[style]` (4 hexes), `.pal-name` |
| painting | `.art-img img` — `alt` is the credit, `src` is a data URI, downscaled on a canvas to a ~240px JPEG |
| weather | first `.wx-block`: `.wx-city`, `.wx-emoji`, `.wx-temp`, `.wx-cond` |
| focus + to-dos | `li.row.focus`, `li.row.todo`: `data-key`, `.title`, `.why`, `.meta`, `.note`, and the row's `data-done` / `data-snooze` / `data-pin` |
| the push | `.push-h`, `.push-b` |
| news | `.ncard`: `.ntitle a` (title, href), `.nmeta span` (source, date), `.nwhy span`, `.rel-N`, `data-saved`, `data-vote`, `.note`, enclosing `.nsub h3` |
| papers | `.pcard`: `.ptitle a`, `.pmeta`, `.ptags .ptag`, `.pwhy`, `.rel-N`, `.pdate`, `data-saved`, `data-vote`, `.note` |
| road ahead | the `section` whose `h2` is “The road ahead”: `.n` (the representation's name), first `p` inside `.repr` |
| contents | every `section.comp h2` — the day's table of contents |

**Why the browser and not the build.** `build.mjs` knows the format best, but a
digest it wrote would have to be re-run over twelve old issues and kept in sync
on every tick Bryan makes in `today.mrbl`. Reading the file the person is looking
at is the Marble way — what's on screen is the file — and `entry.modified` from
the listing is a free cache key: only the day that changed is re-read.

**Cache.** In-memory `Map` plus `localStorage['marble-drive:days-digest:v1']`,
keyed by path, stamped `modified|bytes`. Pruned to the days in the listing.
Three fetches at a time. A day whose digest is not cached yet renders with what
the listing knows (date, theme) and the facts fade in when they arrive. The
aggregate readings say `Reading 3 of 11…` in their head note and redraw as
digests land.

## Four readings

A segmented control of words — `Days · Kept · Threads · Wall` — sits under
Today, on the “Earlier days” line, because Today is the same in every reading
and the readings are ways of seeing everything behind it. The choice is filed on
`<body data-days-read>` with `marble.op`, exactly as `data-view` is, so it is
undoable and survives a reload. The Drive's own grid/list/timeline/map/pulse/
weight toggle is untouched: grid and list still enter the gallery, and inside it
grid vs list picks **covers vs ledger** in the Days reading; the four analytic
lenses still draw the generic listing as before.

**Why not reuse the Drive's toggle for the four readings.** Its icons mean
grid, list, timeline, map, pulse, weight everywhere else in the Drive. A folder
that quietly re-meant them would have six buttons that lie in one folder. Words
that only appear in this folder cannot lie.

### 1 · Days — the run (default)

Today's hero and the wait card are unchanged in behaviour. Every day card
becomes a **cover**:

- a 4-chip palette stripe across the card's top edge (the day's colour, which is
  the one thing that makes two days visually different at a glance);
- date, theme (as now);
- the **push** line — the one thing that morning asked him to move — in muted
  text, two lines at most;
- a **facts** row replacing nodes/KB: `★ 2 · ▲ 1 · ✎ 3 · ✓ 3/7` (saved, liked,
  notes written, to-dos done of total). Zero counts are omitted; a day with no
  marks says nothing rather than `★ 0`.

In list mode the same days are a **ledger**: one row per day — date · theme ·
push · facts · palette name. The hero keeps its two-column layout and gains the
same facts row.

### 2 · Kept — what you kept

Every ★-saved, ▲-liked or noted card from every day, today included, newest day
first, grouped under a small day heading (`SUN 20 SEP · Grace opened a new
Overleaf`, which opens the issue). To-do rows with a note are in here too — the
note on “Book flights to Detroit” is precisely the kind of thing he noted for
himself. Each entry:

- a kind mark: `arXiv` for papers, the source for news, `to-do` for a task;
- the title, linking to the source in a new tab (a to-do links to its day);
- the marks it carries: ★ ▲ ▼;
- **his note**, quoted with the accent bar — his voice, not the agent's;
- the `why` line is deliberately absent: this reading is his marks, not the
  paper's pitch. The relevance badge (Core/Adjacent/Tangential) stays as a tiny
  chip because it is a fact he steered.

Filter chips at the top: `All · ★ Saved · ▲ Liked · ✎ Noted`. Page-only state.

### 3 · Threads — what carried

To-dos matched across days by `data-key` (falling back to a normalised title).
Rows are threads, columns are days oldest → newest, today at the right edge:

- `○` present and open that day, `●` done that day, `–` snoozed, blank absent;
- a status chip per row: `Done 14 Sep` · `Open · 9 days` · `Dropped after 10 Sep`
  (was listed, then never again, never done);
- rows sorted: open, longest-carried first; then done, newest first; then
  dropped;
- the row's own note (if any) under the title, small;
- a cell is a link to that day's issue.

Under the grid, **The pushes**: one line per day, date → push title — the story
of what the mornings asked. This reading answers the question no per-file card
can: *what has been hanging around, and what actually got done.*

### 4 · Wall — the month as a gallery wall

A Monday-first 7-column calendar of the month(s) that have days. A written day is
a tile: the painting (downscaled), the date and the theme over a gradient at the
foot, the four palette chips and the palette name. An unwritten day is a faint
empty cell; today is ringed. The tile's tooltip carries the painting's credit and
the road-ahead representation's name (“The lending library”). Below 46rem the
calendar geometry is dropped for an auto-fill grid of the same tiles, because
seven columns on a phone is a grey smudge.

**Why a calendar and not a strip.** The strip is what the Days reading already is.
The calendar shows the *shape* of the practice — the weekends skipped, the run
before CHI — and the paintings make it a wall you recognise rather than a chart.

## What does not change

Picking, marquee, the ⋮ menu, drag, touch long-press selection, the hero,
“Today isn't written yet” and its runner, month grouping, “Also here”. Every
card is still an `.item.day-card` with `data-path` and `data-kind`, so all six
handlers keep working without knowing about readings. Nothing is hidden: a file
in the folder that is not a day is still drawn.

## Motion, dark, phone

- Cards and readings arrive with the Drive's own `arrive` keyframe; facts fade
  in via opacity; reduced motion is already handled globally.
- Colour comes only from the palettes and paintings; everything else uses the
  Drive's tokens, so dark mode is free.
- Readings bar scrolls sideways if it must; the Threads grid scrolls inside
  itself; the Wall drops its geometry under 46rem.

## Where it lives, how it lands

`drive/drive.mrbl` only — the template has no days gallery at all (same
situation as the touch selection, see memory `drive-mobile-tap-and-select`).
The change touches `<style>` and `<script>` and nothing addressed, so it is a
single disk write that a running host accepts and the open tab reloads itself
(`script-only-write-lands`). Verified with a Playwright test against the real
`drive/drive.mrbl` bytes and small fake issues that use the real markup shapes
(`test-browser/drive-days-almanac.test.js`, skipping when the gitignored drive
file is absent), plus `check_document`.

## Built 2026-09-21 — what changed on the way

- **Two days have no painting in the file** (16 and 17 Sep: the art component
  was emitted without its image) and **one has no colour component at all**
  (18 Sep). A wall tile with chips but no picture wears its palette as four
  diagonal bands; a tile with neither keeps the paper and the ink. The white
  caption and its gradient key on `data-pic`, never on "has been read".
- **A note rides along on a carried to-do**, so the same note would sit under
  every morning it was listed. Kept shows a (thread, note, marks) once, on
  its newest day.
- **The ledger's facts column is fixed-width** (8.5rem); with `auto` the push
  column started at a different x on every row.
- **Threads' first column is sticky** so the dots scroll under the titles on a
  phone.
- The date span reads `Sep 7–21` / `Aug 28 – Sep 21`, following the locale's
  own month-first short date.
- The patch is `tools/patch-days-almanac.py` (asserted single-occurrence
  anchors, style + script only); `tools/almanac-shots.mjs` screenshots the
  four readings against the real issues in a scratch host (it strips commas
  from names, which the scratch host's path rules refuse); the test is
  `test-browser/drive-days-almanac.test.js`.
