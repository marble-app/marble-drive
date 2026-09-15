---
name: day
description: Compose Bryan's Days — a personalized daily Marble document at drive/Bryan's Days/<the day's theme>.mrbl (mirrored to today.mrbl). Three reading streams (to-dos, news, papers) down the middle and a sticky rail of widgets (weather, weeks-ahead calendar, US Open bracket, palette/art) that reveals on scroll. Not a template: the run composes the day's layout from a component vocabulary against lib/design.css. Papers are scored against the research-vision doc. Uses the apple-design skill and a layout doctor. Use when Bryan runs /day or asks to build/refresh the day.
---

# Bryan's Days

Writes `drive/Bryan's Days/<the day's theme>.mrbl`, mirrored to `today.mrbl` (the stable
tab). Past issues are the dated files beside it.

**This is a composition engine, not a template.** `lib/design.css` is the design
system; `lib/build.mjs` renders components; **you decide the day's layout** —
which components exist, where each sits, how it's treated, how much it carries.
Two days with different content should produce genuinely different pages.

## Load every run, before you design anything

1. **`apple-design`** skill — hard dependency. Motion, type, materials,
   restraint. Anything you author must obey it.
2. **`marble:build-in-marble` → [interaction.md]** — hard dependency, and the one
   that governs every control you emit. This page is not a printout: every tick,
   star, chevron and view switch is a write to a file Bryan also opens in an
   editor. What that costs a control is set out there; the short version is
   §Interaction law below.
3. `drive/Research/research-vision.mrbl` §02 (projects) + §05 (open questions) —
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
| `focus` | must-do-today rows, checkable, addable | stream (top) | the "if nothing else" list — **no fixed number** |
| `push` | one thing to move + a drafted starting point | stream | use `tint` |
| `todos` | full to-do list, checkable/snoozable/pinnable | stream | |
| `news` | **Reading** (cards, default) ⇄ **Front page** (mosaic) | stream | a main stream · `view: list\|cal` |
| `papers` | today's arXiv cs.HC as a card grid | stream | a main stream |
| `weather` | **where he is** + one away city, °F with °C alongside, **48 hours** scrubbed sideways under a temperature curve and a precipitation curve, sky-tinted; **expands** to a ten-day forecast | rail | cities come from `state/profile.json` — **never hardcode them here**; cites Open-Meteo |
| `calendar` | what's coming, two readings | **tail**, `card` | `view: t` Timeline \| `l` List |
| `usopen` | Now / Men / Women, real bracket | **stream** | a draw needs width; never the rail |
| `nfl` | one week's slate ⇄ one game in full | **stream** | `view: week\|niners` · use on a game day |
| `nflseason` | **The arc** (18 weeks at once) ⇄ **The West** (division race) | **stream** | `view: arc\|west` · the season, not the week |
| `art` | the day's painting + palette swatches; **expands** to the palette with hex values and roles | rail (last) | cites the museum |
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

### A second reading, behind a chevron

A component may carry more than fits. When it does, it returns a `more` string
from `componentBody` and the header grows a chevron at its top right; the panel
opens **in place**, below the component's own content, and the open/shut state is
filed as `data-expanded` so the page reopens the way Bryan left it.

```js
return { html: rWeather(P.weather), more: rWeatherMore(P.weather),
         moreTip: 'Ten-day forecast, sun times, and the day in full' };
```

Rules for what belongs in there:

- **A second reading of the same subject, not a different one.** The weather
  panel is still the weather — ten days instead of two, the sun times spelled
  out. If the content answers a different question it wants its own component.
- **Never hide something the collapsed view needed.** The panel is for depth, not
  for offloading what did not fit. If the collapsed component is unreadable
  without expanding, the collapsed component is wrong.
- `moreTip` says what is behind the chevron, in Bryan's terms — "Ten-day
  forecast, sun times, and the day in full", not "Expand".
- Anything charted follows the same rule as the hourly strip: the compact chart
  carries the **curve only**, because the band is stretched several times wider
  than it is tall and anything with a shape of its own — a circle, a letter —
  smears. Labels and markers belong in the expanded panel, in HTML.

`weather` and `art` carry one today. Any component can: return `more`, style the
classes you emit, and the chevron appears.

### Adapting to the day

The composition is expected to change:

- **Thin day** (few to-dos, no news): drop `todos`, open the timeline at `m` zoom,
  give `papers` the room.
- **Heavy day** (deadline, many dates): `focus` first and `tint` it, open the
  timeline at `d` zoom so the next fortnight is legible, cut the rail to
  weather + art.
- **Nothing in a category**: omit the component. Never render an empty shell.
- **Volume caps** so no component dominates: `todos` ≤ 8, news ≤ 4 per bucket,
  `papers` ≤ 12. Cut by relevance, not by truncation. **`focus` has no cap** — it
  is the list of what genuinely has to happen today, and some days that is one
  thing and some days it is six. Never pad it to a number.

---

# Design law

These are enforced or checked; violating them fails the build.

1. **No inner scrolling — two named exceptions.** Never emit a bare
   `class="scroll"` or `overflow-y: auto`. If something is too long, carry fewer
   items. The exceptions are the timeline's own track (`tly-scroll`) and the
   weather's 48-hour strip (`wx-hrs` / `wx-track`, horizontal). Both are
   deliberate and named so; `selfCheck` rejects everything else.
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

# Interaction law

Design law governs what the page looks like. This governs what happens when
Bryan touches it — and it is the half that was missing. An audit of six Marble
documents, this one included, found 177 `:hover` rules against 8
`:focus-visible` ones, zero `tabindex` on a bespoke control, and half the
documents shipping every gesture that writes while dropping the undo binding.

The page is not a dashboard he reads. It is a file he edits by touching it.

1. **Every control is a real `<button>`.** Not a `<span>` with a click handler.
   A button is focusable, announces itself, and fires on Enter and Space for
   free. The one place this document got it wrong — the view switcher, a
   `<span class="seg">` — is now a `role="group"` whose buttons carry
   `aria-pressed`. Do not reintroduce the pattern.
2. **State is announced, not only coloured.** A starred row and an unstarred one
   must not be the same button with the same name. `aria-pressed` for a toggle,
   `aria-expanded` + `aria-controls` for a chevron, one pressed segment per
   group. All of it is **derived** in `shell.mrbl`'s `deriveAria` from the same
   attribute the stylesheet reads — never written into the markup by
   `build.mjs`, which would be the same fact in two places, and would go stale
   the moment Bryan pressed Mod+Z.
3. **Every `:hover` that reveals or explains has a focus twin.** `:focus-within`
   on the row, `:focus-visible` on the control. The rules live in one block at
   the end of `design.css` marked `interaction` — add to it rather than scattering.
4. **A tip no tap can open is a lie.** 315 `data-tip` explanations behind
   `:hover` are 315 pieces of nothing on an iPad. Under `@media (hover: none)`
   the tips are suppressed and the chrome is shown outright, and hit targets go
   to 2.75rem. So: **a `data-tip` may only carry a second reading of something
   already legible.** If the collapsed thing is unreadable without the tip, the
   collapsed thing is wrong — the same rule the chevron panel already follows.
5. **Every gesture is undoable, and says so.** Mod+Z is bound. A row Bryan ticks
   by accident comes back. Never add a confirm dialog; a reversal offered where
   the loss happened is better and costs nothing until it is needed.
6. **Press feedback on `pointerdown`, never on the round trip.** The attribute is
   yours to set and you have already set it — do not wait for the op to land.
7. **Nothing reports a commit through motion alone.** Under
   `prefers-reduced-motion` the animation is gone; if it was the only evidence
   the file changed, that reader gets no feedback at all.
8. **Never `localStorage`.** A fact about the day goes in the file; a fact about
   this tab is `data-marble-transient` and dies with it. There is no third case.

Check the four load-bearing ones before every build: real buttons, focus twins,
announced state, and a way back.

---

# The run

### 0. Read who and where he is

```
cat .claude/skills/day/state/profile.json
```

**Standing facts Bryan stated outright, which no sweep can tell you and no run may
guess.** Read this before composing anything — it decides what the weather says
and whose season the `nflseason` component is about.

| field | today | what it drives |
|---|---|---|
| `location.here` | **San Anselmo**, Marin County | `sources.mjs weather --here`, and the "you are here" label |
| `location.away` | San Diego | the second weather block |
| `nfl.team` | **San Francisco 49ers** (`sf`, NFC West) | `nflseason` — the arc is his team, The West is his division |
| `nfl.place` | stream, every day | where the season component sits |
| `travel` | Seattle legs dropped 15 Sep | dates you must **not** re-add from `third-year.mrbl` |

This file exists because the page showed him **Zurich's weather while he was
sitting in Seattle**, for days, and then showed him Seattle's while he was in
Marin. The city had been written into `sources.mjs` as a default and nothing ever
asked. A fact about Bryan's life belongs in state, read every run, the same way
`carry.json` holds a to-do he typed.

Rules:

1. **Never hardcode a city, a team, or a place he lives in a payload or a
   renderer.** Read the field. If a run needs a fact that is not in the file and
   not derivable, ask him and then write it down.
2. **Update a field only when he says it changed**, and record the date and his
   words in the neighbouring `_note`, so the next run can see when it was last
   true rather than trusting it blindly.
3. **`travel.dropped` is a do-not-resurrect list.** Those dates are still sitting
   in `third-year.mrbl`, so the date sweep will find them again every morning.
   Dropping a date he has cancelled is not the same as never having seen it.
4. Anything not in `GAZETTEER` is geocoded on the fly, so a new town needs no code
   change — only this file.

### 1. Read yesterday back
```
node .claude/skills/day/lib/build.mjs readback drive/Bryan's Days/today.mrbl
```
Gives per-item `done`/`snooze`/`pin`/`open`/`vote`/`saved`/`note` keyed by
`data-key`, plus each viewbox's last `data-view`. Drop `done` to-dos, carry
`snooze`d ones. Votes, saves, notes and expand state carry forward automatically
for anything you re-include; view state is restored per component.

`readback.added` is separate and matters more: rows **Bryan typed himself**. They
come from a `<template>` and carry no `data-key`, so they are collected on their
own.

### 1b. Read what Bryan wrote down
```
node .claude/skills/day/lib/build.mjs carry --list
```
`state/carry.json` is the standing list of to-dos Bryan added by hand. A to-do he
typed is a fact about his life, not a row in one morning's file, so it outlives
the issue. Every run must:

1. **Re-include every open item**, and **pass its `key` from `carry.json`
   verbatim**. This is the only thing that links the row back to the carried
   item. A row with no `key` is keyed `slug(source + "|" + title)`, which can
   never equal a carry key like `own-book-flights-and-hotel-to-detroit` — so the
   item silently fails to match, `lastSeen` never advances, and a to-do Bryan
   ticks off comes back the next morning as if he had never touched it. Matching
   his title is not enough and never was. Keep his `title` and `note` as he wrote
   them too, so the row still reads as his.

   ```jsonc
   { "key": "own-book-flights-and-hotel-to-detroit",      // from carry.json
     "title": "Book Flights and Hotel to Detroit",         // his words
     "note": "I need to do this right after my chi deadline" }
   ```

   The `key` travels with the item, not with the component — pass it whether the
   item lands in `todos` or gets promoted into `focus`.
2. **Resolve what it implies, once.** "Book flights to NYC — right after my CHI
   deadline" has a real date behind it. Work it out from the rest of the sweep
   (the CHI deadline is 10 Sep, so this becomes actionable 11 Sep), write it into
   the item's `date` or `after` field, and **add it to `keyDates`** so it appears
   on the timeline. Do this once and record it; do not re-derive it every day.
3. **Promote it when it is actually urgent.** When its date is ≤ 2 days out — or
   it is a booking whose anchor event is close enough that prices or availability
   are the risk — move it into `focus`, not `todos`, and say why in the `why`.
4. **Never drop one silently.** An item leaves `carry.json` only when Bryan ticks
   it off; `build.mjs carry` retires it then, on its own.

Anything Bryan writes in a row's note is his instruction about that row. Read it.

### 1c. Read what Bryan asked you to change
```
node .claude/skills/day/lib/build.mjs feedback
```
**Bryan does not file tickets against this dashboard. He types into it.** A note
under a row, a to-do he adds himself, a thumbs-down — that is the bug report, and
until now it sat in one morning's file and was never read again. This sweeps
*every issue ever written*, drops what a previous run already acted on, and
returns the rest, newest and most request-like first.

Each entry carries `text` (his exact words), `where` (which component it was
written in), `on` (the row it hangs off), `firstSeen`/`lastSeen`, and `likely` —
a hint that it reads like a request rather than a private note. **`likely` is a
sort order, not a filter.** Read all of them; he does not phrase things for a
parser.

Every run must:

1. **Act on what is actionable this morning.** Some asks are per-issue ("more
   news about frontier AI") — satisfy them in today's composition. Some are
   structural ("give me the front page by default", "make the titles black") —
   those belong in `lib/design.css`, `lib/build.mjs`, or `sources.md`, so fix
   them at the source rather than working around them in one payload.
2. **Record what you did**, so it stops resurfacing:
   ```
   node lib/build.mjs feedback --apply <id>[,<id>] --change "what you changed, and where"
   ```
   Only mark an item applied when the change is actually written and building.
3. **Leave what you cannot do open**, and say so in the report. An item stays in
   the sweep until a run marks it applied — that is deliberate. Silence is how
   the last round of feedback got lost.
4. **Never edit his words** out of a past issue to make the list shorter.

A note that is plainly not about the dashboard ("I need to do this right after my
chi deadline") is an instruction about *that row* — honour it there, per step 1b,
and leave it open in the sweep rather than marking it applied.

### 2. Voice, and naming the day
`greeting` — one line. `summary` — one or two plain sentences about where the
day sits. Both sit at the top of the **stream**, stacked and flush left with
everything you read down; there is no banner, no hero, no clock.

`title` — **what this day is about**, and it becomes the filename:
`drive/Bryan's Days/Two days to CHI.mrbl`. A dated filename tells you nothing you
did not already know; the theme tells you why that morning mattered when you
scroll the folder back. Three to six words, concrete, drawn from whatever
actually dominates — the deadline, the flight, the talk, the one thing that has
to happen. "Two days to CHI", "Ai2 starts Sunday", "Camera-ready, then Detroit".
Not "Tuesday" and not "Daily brief". The date is not lost: it lives in the file's
`day:date` meta, which is what `build.mjs` sorts issues by.

### 3. Gather
- **focus / todos** — Notion, Google Calendar, Gmail. One line per thread.
- **keyDates** — sweep for the next ~6 months every run: Calendar
  (`list_calendars` → `list_events` ~180d), Gmail (`deadline|due|camera-ready`,
  `flight|itinerary`, `Ai2|internship`, `visa|CPT|lease`), Notion dated pages,
  `node lib/build.mjs dates` (sweeps `third-year.mrbl` + `key-dates.md`, which is
  pins/corrections only).

  **The timeline is Bryan's commitments, not his inbox.** Asked for on 11 Sep:
  *"my right side column with key events is being populated with things that I
  don't need. The meetings and calendar events was relevant, the chi grace period
  was relevant, but these random newsletter stuff aren't."* A date earns a row
  only if he is actually on the hook for it:

  - **Yes** — anything on his calendar; his own paper and conference deadlines and
    their review cycle; his trips, flights and bookings; dates where he is a named
    invitee, attendee or author; a deadline someone set *for him* personally
    (an advisor, ISEO, a collaborator, a landlord).
  - **No** — announcements broadcast to a list he merely receives
    (`cogsci-grads-g`, `dlab-members`, `today@ucsd.edu`, campus-wide mail):
    seminars and defenses he is not part of, fellowship and nomination CFPs,
    showcases, design-a-thons, recruitment notices, newsletters. These are not
    his dates; they are things that happened to arrive.

  The test is **"is Bryan on the hook for this?"**, not "does it have a date in
  it". A broadcast that he decides to act on becomes a **to-do** — and only earns
  a timeline row once he has actually committed. When in doubt, leave it out: a
  timeline he trusts at a glance is worth more than a complete one.
- **profile** — `state/profile.json` first, before anything guesses. Standing facts
  Bryan stated outright: **where he is** (`location.here`, which is what
  `--here` takes) and **which team he follows** (`nfl`). He was shown Zurich's
  weather while sitting in Seattle because the city was hardcoded; read the file
  and that cannot recur. Update a field only when he says it changed.
- **nfl / nflseason** — ESPN's public JSON, no key required:
  `site.api.espn.com/apis/site/v2/sports/football/nfl/teams/<slug>/schedule` for the
  season arc, `…/teams/<slug>` for each division rival's record. On a Tuesday the
  season is the live reading and the week is finished — prefer `nflseason` and
  leave `nfl` out rather than re-running a result a past issue already carried.
- **weather** — `node lib/sources.mjs weather --here "<city>" --away "<city>"` →
  straight into `payload.weather`. Cities come from `profile.json`; anything not in
  `GAZETTEER` is geocoded automatically, so a new town needs no code change.
  Glyphs already carry U+FE0F so every condition renders in colour, and each
  block carries a `sky` class that paints the card with a condition-accurate
  gradient (clear / clear-night / partly / cloudy / rain / snow / storm / fog).
  Nothing to do beyond passing the object through.
- **usOpen** — `WebSearch` both draws; see the shape below.
- **arxiv** — `node lib/sources.mjs arxiv --since <the last issue's day:date> --unseen --max 150`
  → score it, then into `payload.arxiv`. `--since` reads every announcement since the
  last issue, so a morning with no run no longer loses its listing — that is how
  *The Interface of Theseus* was missed. `--unseen` drops what an issue already
  showed. The `watch` list in `state/tuning.json` (authors, and comment-field tracks
  such as `UIST Visions`) is queried on its own and leads the result, each paper
  carrying a `watch` reason. When the export API rate-limits, it falls back to the
  RSS listing and says so in `via` and `notes` — the watch queries are skipped then,
  so re-run later or search the watched names by hand. See sources.md §Papers like
  *The Interface of Theseus*.
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

- **`calendar` — Timeline vs List, in the right-hand tail.** Both scroll **on
  their own** so the page keeps its place. **Timeline** (default) puts the dates
  in space: distance runs on a sqrt curve so next week breathes while next spring
  still fits, with ticks at *today / 1 week / 3 weeks / 3 months / 6 months* so
  the distortion is declared. Rows lay out in flow with computed margins, so they
  can never overlap. **List** does not distort anything — every date in order,
  one per line, nothing but what is next. In both, urgency is carried by the dot
  and only by the dot: **one hue, the theme's `--accent`, and nearness is how
  much of it there is** (`urgencyVar`, a `color-mix` ramp from 100% today down to
  14% beyond four months). Never reintroduce a multi-colour urgency scale — it
  made "soon" and "far" look like different kinds of thing. Every row explains
  itself on hover.
- **`news` — Reading vs Front page.** `Reading` is the card list grouped by
  bucket. `Front page` is a mosaic ranked by relevance: the lead runs the full
  width with its picture, the next two at half, the rest as short columns, with
  newspaper rules between them. A mosaic item is **not** an `.ncard` — it has its
  own box model; mixing the two is what broke this view once already.

### 4c. Tag every paper by what kind of research it is

Each paper takes a `tags` array — up to four, rendered as chips under the authors
so the grid is scannable without reading a word of prose. Colour encodes the
**kind**, not the individual tag, so a row reads as three categories rather than
eight arbitrary colours:

| kind | colour | means | tags |
|---|---|---|---|
| **artifact** | accent | what the paper hands you | `dataset` `corpus` `benchmark` `model` `system` `toolkit` `technique` |
| **method** | warm | how the claim was earned | `study` `formative` `interview` `survey` `eval` `theory` `position` |
| **topic** | outline only | the field it sits in | `hci` `genui` `malleable` `llm` `rlhf` `agents` `nlp` `vis` `xr` `robotics` `health` `a11y` `fab` `audio` `education` `cscw` `creativity` `ml` |

Common aliases resolve on their own (`user study` → Study, `visualization` →
Vis, `accessibility` → Access, `alignment` → RLHF, `end-user programming` →
Malleable, `ar`/`vr` → XR). **An unrecognised tag is kept, not dropped** — it
renders as a topic in Bryan's own words, so a new area does not need a code
change first. Every chip explains itself on hover.

Aim for two or three: one artifact or method, one or two topics. `["system",
"genui", "study"]` tells him more at a glance than five topic words do.

### 4d. Authors are named in full, and clickable

Never abbreviate an author list — no `et al.`, no `+7`. The et-al always hides
exactly the name Bryan is scanning for. `build.mjs` renders every author from
`payload.arxiv.papers[].authors`; pass the complete list.

Each name is a control. Clicking it marks that person as someone Bryan knows,
marks **every** instance of them on the page at once, and `harvest` folds it into
`state/authors.json` — so from the next morning on, every paper that person
appears on shows it already. Nothing to do per run beyond passing full author
lists; the marking and the memory are automatic.

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
node .claude/skills/day/lib/build.mjs assemble --payload /tmp/nl.json
```
It picks the palette, renders every component, inlines images, runs the
self-check **and the layout doctor**, writes atomically, mirrors to `today.mrbl`.
On failure it aborts — fix the composition or `design.css`, not the payload.

### 7. Look at it
If the `claude-in-chrome` extension is connected: serve, screenshot at ~1512px
and ~700px, and check for overlap, clipping, a rail taller than the viewport,
components that look empty, or type that has gone tiny. Then **tab through it** —
the first ten stops should reach real controls with a visible ring, and every
segment, star and chevron should report its state. Fix and rebuild. If the
extension isn't available, say so in the report — the static doctor is the only
gate that ran.

### 8. Harvest + verify
```
node lib/build.mjs harvest drive/Bryan's Days/today.mrbl
node lib/build.mjs check --file drive/Bryan's Days/today.mrbl
MARBLE_APPS="$PWD/drive" node node_modules/@bdhmin/marble/bin/marble.js doctor drive/Bryan's Days/today.mrbl drive/Bryan's Days/index.mrbl
```
Mark every request of Bryan's you actually acted on (step 1c):
```
node lib/build.mjs feedback --apply <id> --change "what changed, and where"
```
Fold 👍/👎 into `state/tuning.json`; add newly ★-saved items to `index.mrbl`'s
reading list with a verified BibTeX block. Report: palette, composition, counts,
images, whether the screenshot pass ran, and **which of Bryan's open requests you
applied and which you left open, quoting his words** — that list is the part he
cannot reconstruct for himself.

### 9. Email — only when asked
Compact digest to **bdmnewsletters@gmail.com** in the day's palette: greeting,
focus list, next date, top 3 links, a link to the doc. One column, ~600px.

---

# Payload

```jsonc
{
  "date": "YYYY-MM-DD",
  "title": "Two days to CHI",                // the day's theme — becomes the FILENAME
  "greeting": "Good morning, Bryan.",
  "summary": "one or two sentences",
  "palette": "Peacock & Sand",              // optional; omit to auto-rotate
  "layout": { "rail": [...], "stream": [...] },
  "hero":   { "image": "<iiif url>", "credit": "Water Lily Pond, Claude Monet, 1900" },
  "push":   { "title": "...", "body": "2–3 sentences you actually drafted" },
  "focus":  [{ "title", "why", "source"? }],
  "todos":  [{ "title", "source", "meta"?, "note"?, "snooze"? }],
  "keyDates": [{ "label", "date": "YYYY-MM-DD", "source"? }],
  "weather": <sources.mjs weather> | { "error": "..." },  // °F; °C is rendered alongside for you
  "usOpen": {
    "note": "one line",
    "top":   [ { "label": "Men's QF", "a": {…}, "b": {…}, "winner": "" } ],
    "men":   { "rounds": [ { "name": "Round of 16", "matches": [
                 { "a": { "seed":"2","name":"C. Alcaraz","country":"Spain",
                          "score":"6-4 6-3 6-4","photo":"<url>" },
                   "b": { "name":"T. Paul","country":"USA" }, "winner":"a" } ] } ] },
    "women": { … }
  },
  "nflSeason": {                              // from ESPN; see step 3 · `nflseason`
    "team": "49ers", "record": "1-0", "played": 1, "total": 17,
    "pf": 27, "pa": 7, "diff": 20, "byeWeek": 8,
    "homeCount": 9, "awayCount": 8, "divCount": 6,
    "nextDay": "Sunday, September 20",
    "weeks": [ { "week": 1, "date": "2026-09-11", "home": false, "opp": "LAR",
                 "oppName": "Rams", "div": true, "played": true, "result": "W",
                 "us": 27, "them": 7, "when": "Fri, Sep 11, 5:15 PM", "venue": "…" },
               { "week": 8, "bye": true } ],
    "next": { "…one of weeks[], the first unplayed…": null },
    "west": [ { "abbr": "SF", "name": "49ers", "record": "1-0",
                "w": 1, "l": 0, "pf": 27, "pa": 7, "diff": 20, "us": true } ],
    "sourceName": "ESPN — 49ers schedule and NFC West records", "sourceUrl": "…"
  },
  "arxiv": { "papers": [ { ...sources.mjs fields,
                           "authors": ["every author, in full — never abbreviated"],
                           "relevance": 0-3, "why": "the named connection",
                           "tags": ["system","genui","study"] } ] },
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
- The issue is named for its theme, not its date. `payload.title` is the filename;
  the date lives in the `day:date` meta.
- A to-do Bryan typed himself is never dropped. It lives in `state/carry.json`
  until he ticks it off — see step 1b.
- Where Bryan is and which team he follows are read from `state/profile.json`
  every run, never guessed and never written into a renderer. He spent days
  looking at the weather for a city he had left — see step 0.
- Never reuse a `data-marble-id`.
- Authored markup: no script, no network, no external assets. Images arrive only
  as `data:` URIs.
- Verify citations. Score papers. Never invent a link or a time.
- Author lists are never abbreviated, and every paper carries `tags`.
- A newly added row arrives **empty**, with its prompt drawn by the stylesheet
  (`:empty::before` on `data-ph`). Never ship placeholder words as real text —
  they get saved as a real to-do the moment Bryan forgets to delete them.
- A request Bryan typed into a page is never silently dropped. It stays in
  `build.mjs feedback` until a run applies it and says so — see step 1c.
- Controls announce their state, derived in `shell.mrbl` and never emitted as
  markup by `build.mjs`. Adding a control means adding its reading to
  `deriveAria`, not an `aria-*` attribute to a template string.
- If a check fails after a write, restore from `drive/.marble/history/`.
