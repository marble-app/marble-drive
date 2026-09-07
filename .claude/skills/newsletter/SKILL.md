---
name: newsletter
description: Compose Bryan's Bulletin — a personalized daily Marble document at drive/Newsletter/<date>.mrbl (mirrored to today.mrbl). Three reading streams (to-dos, news, papers) down the middle and a sticky rail of widgets (weather, weeks-ahead calendar, US Open bracket, palette/art) that reveals on scroll. Not a template: the run composes the day's layout from a component vocabulary against lib/design.css. Papers are scored against the research-vision doc. Uses the apple-design skill and a layout doctor. Use when Bryan runs /newsletter or asks to build/refresh the bulletin.
---

# Bryan's Bulletin

Writes `drive/Newsletter/<YYYY-MM-DD>.mrbl`, mirrored to `today.mrbl` (the stable
tab). Past issues are the dated files beside it.

**This is a composition engine, not a template.** `lib/design.css` is the design
system; `lib/build.mjs` renders components; **you decide the day's layout** —
which components exist, where each sits, how it's treated, how much it carries.
Two days with different content should produce genuinely different pages.

## Load every run, before you design anything

1. **`apple-design`** skill — hard dependency. Motion, type, materials,
   restraint. Anything you author must obey it.
2. `drive/Research/research-vision.mrbl` §02 (projects) + §05 (open questions) —
   the yardstick for scoring every paper.

---

# The composition contract

`payload.layout` has two tracks. Omit it and a sensible default is used, but you
should almost always compose it deliberately.

```jsonc
"layout": {
  "rail":   [ { "type": "weather",  "treatment": "card" }, … ],  // left, sticky
  "stream": [ { "type": "focus",    "treatment": "bare" }, … ],  // the middle, what you read
  "tail":   [ { "type": "calendar", "treatment": "card" } ]      // right, sticky
}
```

Three tracks, all fixed from first paint — nothing flies in or docks on scroll.
The page **fills the display**; the side tracks scale with it (`clamp` on `vw`)
and the stream takes what's left. Readability is protected by capping the
*measure* of running text at ~72ch, never by boxing the layout into a column.

- **`rail`** (left, ~17rem, sticky) — glanceable widgets: weather, the palette.
  2–3 items; each must fit without scrolling.
- **`stream`** (middle) — the spine you read down: **to-dos, news, papers**, plus
  whatever else the day needs. Anything wide or long belongs here, including the
  draw.
- **`tail`** (right, sticky) — the timeline. It is the one component allowed
  **its own scroll**, and it takes as much height as the viewport gives it
  (`100dvh` minus the chrome), with faded top and bottom edges, so the page
  underneath keeps its place.

Below 82rem the tail drops under the stream; below 62rem everything stacks.

### Component vocabulary

| `type` | renders | belongs in | notes |
|---|---|---|---|
| `focus` | 2–4 must-do-today rows, checkable | stream (top) | the "if nothing else" list |
| `push` | one thing to move + a drafted starting point | stream | use `tint` |
| `todos` | full to-do list, checkable/snoozable/pinnable | stream | |
| `news` | **Reading** (cards, default) ⇄ **Front page** (mosaic) | stream | a main stream · `view: list\|cal` |
| `papers` | today's arXiv cs.HC as a card grid | stream | a main stream |
| `weather` | Zurich + San Diego, °F, colour emoji, 7 hours, sky-tinted | rail | cites Open-Meteo |
| `calendar` | vertical timeline of what's coming, own scroll | **tail**, `card` | `view: c` compressed \| `s` to scale |
| `usopen` | Now / Men / Women, real bracket | **stream** | a draw needs width; never the rail |
| `art` | the day's painting + palette swatches | rail (last) | cites the museum |
| `roadahead` | your authored representation | stream (last) | `card` |
| `custom` | your own `html` | anywhere | same guards as the representation |

Per-node keys: `type`, `treatment`, `title` (override; `null` hides the header),
`cat` (override the category colour), plus `view` / `weeks` where noted.

**View state.** Components with a segmented control remember which view Bryan last
chose and reopen there. Setting `view` on the layout node *overrides* that — use it
only when you deliberately want to lead with a particular view (e.g. after
changing what a view shows).

### Treatments — three, no others

- **`bare`** — no border, no background. Part of the page. **Use this for the
  three reading streams** and anything that is the main content. Bare stream
  components get a hairline rule underneath for rhythm.
- **`card`** — panel background + hairline + radius. For rail widgets and
  anything that is a self-contained object.
- **`tint`** — the component's category hue at 8%. Exactly one per issue, on the
  single thing you want the eye to land on (usually `push`).

Do not box everything. A page of cards reads as a control panel; the streams
should read as the page itself.

### Adapting to the day

The composition is expected to change:

- **Thin day** (few to-dos, no news): drop `todos`, open the timeline at `m` zoom,
  give `papers` the room.
- **Heavy day** (deadline, many dates): `focus` first and `tint` it, open the
  timeline at `d` zoom so the next fortnight is legible, cut the rail to
  weather + art.
- **Nothing in a category**: omit the component. Never render an empty shell.
- **Volume caps** so no component dominates: `focus` ≤ 4, `todos` ≤ 8,
  news ≤ 4 per bucket, `papers` ≤ 12. Cut by relevance, not by truncation.

---

# Design law

These are enforced or checked; violating them fails the build.

1. **No inner scrolling — one exception.** Never emit a bare `class="scroll"` or
   `overflow-y: auto`. If something is too long, carry fewer items. The single
   exception is the timeline's own track (`tly-scroll`), which is deliberate and
   named so; `selfCheck` rejects everything else.
2. **Full width, capped measure.** Never put a `max-width` on the page or a
   track. Long-form text gets `max-width: 72ch`; everything else fills.
3. **Components are self-responsive.** Every `.comp` is a CSS container. Internals
   respond to the *component's* width via `@container`, never the viewport — that
   is what lets `calendar` sit in the 20rem rail and in the full-width stream and
   look right in both. If you add CSS, use `@container`, not `@media`.
4. **Colour encodes.** Category hue per component (`--cat`), urgency on dates
   (`--u`: ≤2d warm → ≤7d accent → ≤21d accent-ink → faint), relevance as a
   coloured pill. No decorative colour.
5. **Relevance is a pill, not a meter.** `Core` (accent) / `Adjacent` (warm) /
   `Tangential` (faint) / `Field` (line). The build renders it from `relevance`.
6. **Motion.** Components reveal on scroll (`animation-timeline: view()`, with an
   IntersectionObserver fallback already in the shell); rail widgets ease in from
   the left. Press feedback on every control. All of it disabled under
   `prefers-reduced-motion`.
7. **Type.** Geist (embedded, offline-safe) for UI; serif for titles; mono for
   dates/metadata. Don't introduce a fourth family.
8. **No fabricated live data.** No clocks, no "as of" times you can't stand
   behind, no links you haven't verified.
9. **Every class you emit must be styled.** The layout doctor fails the build on
   an *orphan class* — markup using a class no rule matches. That is what a lost
   stylesheet block looks like from the outside, and it is how a component
   silently renders as raw stacked text. If you add a class, add its rule.
10. **Cite every outside source, with a link.** Any component showing data that
   didn't come from Bryan carries a `.csrc` line — weather → open-meteo.com,
   papers → the arXiv cs.HC listing, artwork → the museum page, the draw → the
   official site. Pass `sourceName` / `sourceUrl` where a component takes them.
   If you can't name where something came from, don't show it.
11. **Nothing tries to be text in a small box.** A calendar day cell is a colour
   and a count of dots; the event names live in its tooltip. Never truncate a
   label to two characters and call it a label.
12. **Everything abbreviated explains itself on hover.** Any truncated label,
   score, pill, glyph, initial or dot must carry `class="tip" data-tip="…"`.
   Newlines in `data-tip` render, so give it real structure — the full event
   name and date, what a relevance grade means, the hour's conditions and rain
   chance, a player's country and score. If the eye can't read it, the pointer
   must be able to. Use the plain pointer — never `cursor: help`.

---

# The run

### 1. Read yesterday back
```
node .claude/skills/newsletter/lib/build.mjs readback drive/Newsletter/today.mrbl
```
Gives per-item `done`/`snooze`/`pin`/`open`/`vote`/`saved`/`note` keyed by
`data-key`, plus each viewbox's last `data-view`. Drop `done` to-dos, carry
`snooze`d ones. Votes, saves, notes and expand state carry forward automatically
for anything you re-include; view state is restored per component.

### 2. Voice
`greeting` — one line. `summary` — one or two plain sentences about where the
day sits. That is the whole masthead; there is no hero, no brief name, no clock.

### 3. Gather
- **focus / todos** — Notion, Google Calendar, Gmail. One line per thread.
- **keyDates** — sweep for the next ~6 months every run: Calendar
  (`list_calendars` → `list_events` ~180d), Gmail (`deadline|due|camera-ready`,
  `flight|itinerary`, `Ai2|internship`, `visa|CPT|lease`), Notion dated pages,
  `node lib/build.mjs dates` (sweeps `third-year.mrbl` + `key-dates.md`, which is
  pins/corrections only).
- **weather** — `node lib/sources.mjs weather` → straight into `payload.weather`.
  Glyphs already carry U+FE0F so every condition renders in colour, and each
  block carries a `sky` class that paints the card with a condition-accurate
  gradient (clear / clear-night / partly / cloudy / rain / snow / storm / fog).
  Nothing to do beyond passing the object through.
- **usOpen** — `WebSearch` both draws; see the shape below.
- **arxiv** — `node lib/sources.mjs arxiv --max 70` → straight into `payload.arxiv`.
- **news** — `sources.md` queries.
- **art** — `node lib/sources.mjs art --q "<mood>"`; set `hero.image` + `hero.credit`.

### 4. Verify + score every paper and article
- **Verify the citation** from a real fetched source (arXiv abs page, DOI,
  publisher). Title, authors, date, URL. If you can't verify it, drop it. Never
  reconstruct from memory or a search snippet.
- **`relevance` 0–3** against research-vision §02/§05 — 3 = advances a named
  project or answers an open question, 2 = clearly adjacent, 1 = tangential,
  0 = field awareness. The build sorts by it.
- **`why`** = the named connection: "Your **World Interface Models** project asks
  exactly this." Not "relevant to your research."
- **Images**: news items → the article's `og:image`. arXiv papers → nothing; the
  build screenshots the **first PDF page** automatically. Budget ~30 images.

### 4b. How the two multi-view components read

- **`calendar` — the timeline, in the right-hand tail.** A vertical column of what
  is coming, scrolling **on its own** so the page keeps its place. Two scales:
  **Compressed** (default) puts distance on a sqrt curve so next week breathes
  while next spring still fits, and marks *today / 1 week / 3 weeks / 3 months /
  6 months* so the distortion is declared; **To scale** is strictly proportional —
  one pixel per unit of time, crowding and all. Both lay out in flow with computed
  margins, so rows can never overlap. Every row explains itself on hover.
- **`news` — Reading vs Front page.** `Reading` is the card list grouped by
  bucket. `Front page` is a mosaic ranked by relevance: the lead runs the full
  width with its picture, the next two at half, the rest as short columns, with
  newspaper rules between them. A mosaic item is **not** an `.ncard` — it has its
  own box model; mixing the two is what broke this view once already.

### 5. Author the road ahead — properly designed
Read research-vision §§02/04/05/06 and design a **brand-new visual** of the
agenda; check `representations/LOG.md` and don't repeat a form. It is rendered
inside `.repr`, so scope every rule as `.repr .yourclass`.

**It must actually be designed.** A bare `<div>` of sentences is a failure. Before
you emit it, confirm all of:
- a real layout — grid/flex with explicit gaps, not stacked default blocks;
- visible structure — grouping, rules, chips, bars, or a small inline SVG;
- palette vars only (`--ink --muted --line --faint --accent --accent-soft --warm
  --c1..--c4 --pop`), no literal colours;
- `@container` (not `@media`) if it needs to adapt;
- a hover or transition using `--dur` / `--ease`, disabled under reduced motion;
- a fresh `data-marble-id` on every element; some pieces editable or sortable;
- **no script, no network, no external assets** — the build rejects these.

Then append a line to `representations/LOG.md`.

### 6. Compose + assemble
Decide `layout`, write the payload, then:
```
node .claude/skills/newsletter/lib/build.mjs assemble --payload /tmp/nl.json
```
It picks the palette, renders every component, inlines images, runs the
self-check **and the layout doctor**, writes atomically, mirrors to `today.mrbl`.
On failure it aborts — fix the composition or `design.css`, not the payload.

### 7. Look at it
If the `claude-in-chrome` extension is connected: serve, screenshot at ~1512px
and ~700px, and check for overlap, clipping, a rail taller than the viewport,
components that look empty, or type that has gone tiny. Fix and rebuild. If the
extension isn't available, say so in the report — the static doctor is the only
gate that ran.

### 8. Harvest + verify
```
node lib/build.mjs harvest drive/Newsletter/today.mrbl
node lib/build.mjs check --file drive/Newsletter/today.mrbl
MARBLE_APPS="$PWD/drive" node node_modules/@bdhmin/marble/bin/marble.js doctor drive/Newsletter/today.mrbl drive/Newsletter/index.mrbl
```
Fold 👍/👎 into `state/tuning.json`; add newly ★-saved items to `index.mrbl`'s
reading list with a verified BibTeX block. Report: palette, composition, counts,
images, whether the screenshot pass ran.

### 9. Email — only when asked
Compact digest to **bdmnewsletters@gmail.com** in the day's palette: greeting,
focus list, next date, top 3 links, a link to the doc. One column, ~600px.

---

# Payload

```jsonc
{
  "date": "YYYY-MM-DD",
  "greeting": "Good morning, Bryan.",
  "summary": "one or two sentences",
  "palette": "Peacock & Sand",              // optional; omit to auto-rotate
  "layout": { "rail": [...], "stream": [...] },
  "hero":   { "image": "<iiif url>", "credit": "Water Lily Pond, Claude Monet, 1900" },
  "push":   { "title": "...", "body": "2–3 sentences you actually drafted" },
  "focus":  [{ "title", "why", "source"? }],
  "todos":  [{ "title", "source", "meta"?, "note"?, "snooze"? }],
  "keyDates": [{ "label", "date": "YYYY-MM-DD", "source"? }],
  "weather": <sources.mjs weather> | { "error": "..." },
  "usOpen": {
    "note": "one line",
    "top":   [ { "label": "Men's QF", "a": {…}, "b": {…}, "winner": "" } ],
    "men":   { "rounds": [ { "name": "Round of 16", "matches": [
                 { "a": { "seed":"2","name":"C. Alcaraz","country":"Spain",
                          "score":"6-4 6-3 6-4","photo":"<url>" },
                   "b": { "name":"T. Paul","country":"USA" }, "winner":"a" } ] } ] },
    "women": { … }
  },
  "arxiv": <sources.mjs arxiv, each paper + why + relevance>,
  "feed":  { "genui": [ { "title","url","meta","published","relevance","why","abstract","image"? } ],
             "industry": [...], "hci": [...] },
  "representation": { "name": "...", "html": "<style>.repr … </style>…" },
  "sources": ["gmail","gcal","notion","arxiv","meteo"]
}
```
Player photos: `https://en.wikipedia.org/api/rest_v1/page/summary/<Name>` →
`thumbnail.source`. `country` becomes a flag on the face. Rounds are auto-padded
to powers of two so the bracket connectors line up.

# Invariants

- One write per run through `assemble`; atomic; mirrors to `today.mrbl`.
- Never reuse a `data-marble-id`.
- Authored markup: no script, no network, no external assets. Images arrive only
  as `data:` URIs.
- Verify citations. Score papers. Never invent a link or a time.
- If a check fails after a write, restore from `drive/.marble/history/`.
