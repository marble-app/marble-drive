# Bryan's Days: the story view

*Design, 2026-09-19. Status: spec, nothing built.*

Bryan asked for a second way to read a day on the phone. The page he has now scrolls;
the new one reads like an Instagram or Snapchat story: tap to advance through every
component, widget, item and paper one screen at a time, tap back to re-read, swipe
up on any screen to start interacting with it, and at the end you are done. A toggle
switches between the two.

The hard part is not the gestures. It is that a screen is a fixed size and the day's
content is not: a to-do can be one line or a six-bullet note, a news card can carry an
image or not, a paper can be Core or Field. This spec sets out how a day is cut into
screens adaptively, what the build has to decide at generation time, what the page
decides at read time, and what the skill has to be told.

Bryan works autonomously with this agent, so the open design questions below were
decided rather than asked, with the reasoning recorded. Anything marked *decided*
can be reversed at review.

## 1. The shape of it

Two **reading modes** of one document:

- **Page** — what exists today. The stacked layout under 62rem.
- **Story** — a full-screen sequence of screens over the same document.

Inside story mode there are two **states**:

- **Glance.** A screen shows one thought: a group of short to-dos, one paper, the
  weather, the painting. Nothing on it is tappable. Tapping the right two thirds goes
  forward, the left third goes back, and dragging sideways moves the screens
  1:1 under the finger. A progress bar across the top shows where you are.
- **Hold.** Swipe up (or press Open) and the screen gives way to the real document,
  scrolled to that component. Everything is live there: the checkbox, the star, the
  note you type into, the segmented control, the chevron. A bar at the top says which
  component you are in and takes you back to the story, at the same screen. Undo is
  the document's own Mod+Z.

The story ends on an end card. There is no auto-advance, ever: this is reading, not a
slideshow.

### Why hold is the real document and not a sheet

*Decided.* Instagram's swipe-up opens the linked thing. Here the linked thing is the
component itself, and the component already exists, wired, in the page underneath.
Moving the element into a sheet and back would mean DOM moves under the carrier's
sortable and editable wiring, and a second place where a to-do could be ticked.
Scrolling the real page to it costs nothing, keeps one DOM and one set of controls,
and honours the interaction law: the story files nothing, the page files what it
always did.

### Why glance screens are clones

*Decided.* Glance is read-only by design, so a clone loses nothing, and clones can be
laid out, measured, positioned and animated freely inside a transient overlay without
touching the elements that carry `data-marble-id`. They are rebuilt whenever the
document changes (the shell already watches for that), so a row ticked in hold shows
ticked in the next glance. Nothing from the overlay can ever be filed: it is one
`data-marble-transient` subtree.

## 2. Units: what a screen can be made of

A **unit** is the smallest thing the story will never split. Each component declares
how it becomes units. The **group** is the label at the top of the screen and the
boundary a screen never crosses: a screen holds units from one group only.

| component | units | group label | packs? | own screen when |
|---|---|---|---|---|
| masthead | the cover | — | no | always (screen 1) |
| `focus` | each row | Today, sharply | up to 3 | its note is a list or long (§4.2) |
| `push` | the whole component | Push one thing forward | no | always |
| `todos` | each row | To-dos | up to 5 | its note is a list or long |
| `news` | each card, in the Reading view | the bucket heading | up to 3 | relevance 3 |
| `papers` | each card | Fresh on arXiv | up to 3 | relevance ≥ 2 |
| `weather` | the whole component | Sky | no | always |
| `calendar` | the whole component, List view | The weeks ahead | no | always |
| `nflseason` | the whole component, Arc view | the component title | no | always |
| `nfl` | the whole component, Week view | NFL | no | always |
| `usopen` | the whole component, Now view | US Open | no | always |
| `art` | the whole component | Today's colour | no | always |
| `roadahead` | the whole component | The road ahead | no | always |
| `custom` | the whole component | its title | no | always |
| colophon | the end card | — | no | always (last) |

Rules that follow from the table:

- **A unit is never split across screens.** If a unit is taller than a screen even
  alone, the screen clamps it with a fade at the bottom and the hint reads *swipe up
  for all of it*. Glance never scrolls inside a screen. Hold shows the whole thing.
- **A multi-view component contributes one view.** The story view is the one that
  reads top to bottom on a phone: news → Reading, calendar → List, nflseason → The
  arc, usopen → Now, nfl → The week. The build declares it; the page's own
  `data-view` is untouched, so the desktop reopens where Bryan left it.
- **A component's chevron panel is not in the story.** It is a second reading, and
  hold is where second readings live.
- **Images are earned by standing alone.** A paper on its own screen shows its PDF
  thumbnail; packed papers do not. A news card on its own screen shows its picture as
  a banner; packed cards do not. This is what lets three Field papers share a screen
  and one Core paper fill it, and it means a unit's height is known before packing.
- **Sources stay.** The `.csrc` line travels with its component's units onto the
  screen, small, so design law 10 holds in both modes.
- **Empty rows, add buttons and `.exp` panels are not cloned.** They are for hold.

## 3. Order

Default story order, when the layout does not say otherwise:

1. cover (masthead)
2. `weather` — the first glance out of the window
3. `focus`, `push`, `todos`, in stream order
4. `calendar` — after the to-dos, because it is the other half of *what has to happen*
5. the rest of the stream in order: `news`, `papers`, `nflseason`/`nfl`/`usopen`,
   `roadahead`, any `custom`
6. `art` — the last thing before the end, the painting full-screen
7. end card

The run may override with `layout.story.order` (a list of component types) and may
leave a component out with `layout.story.skip`. Rail and tail components are placed
by these rules, not by their track; the tracks are a desktop fact.

## 4. Generation time: what `build.mjs` decides

The build knows the content; the phone knows the screen. So the build decides
everything editorial and leaves geometry to the page.

### 4.1 Attributes emitted

All on elements that already exist. No new persistent elements.

| on | attribute | values | meaning |
|---|---|---|---|
| `main.page` | `data-read` | `page` \| `story` | the reading mode Bryan last chose on a narrow screen (§6) |
| `section.comp` | `data-story` | `items` \| `unit` \| `skip` | how it becomes units |
| `section.comp` | `data-story-view` | a view name | which `.v-*` panel is the story view (viewboxes only) |
| `section.comp` | `data-story-label` | text | kicker override; default is the component title |
| `li.row`, `.ncard`, `.pcard` | `data-story-own` | present | must stand alone on a screen |

`readback` ignores every `data-story*` attribute. `harvest` ignores them. The layout
doctor's orphan-class check is unaffected because these are attributes, not classes.

### 4.2 The own-screen rule for rows

A `focus` or `todos` row gets `data-story-own` when any of:

- its note contains a newline (Bryan typed a list; notes are `pre-line`);
- its note is 160 characters or longer;
- title + why + note together are 320 characters or longer;
- the payload item says `"storyOwn": true`.

Measured against the twelve issues so far: notes run from 13 to 2,462 characters,
with six-line lists on three recent days. The thresholds put every list and every
paragraph-length note on its own screen and leave one-liners to pack.

A paper gets `data-story-own` at relevance ≥ 2; a news card at relevance 3. The run
can add `storyOwn` to any item to promote it.

### 4.3 Pack ceilings

The maximum units on one screen, by kind, regardless of height: focus 3, todos 5,
news 3, papers 3. Ceilings keep a screen readable at a glance; height keeps it
honest. Both apply.

### 4.4 The estimate, and the check

The build cannot measure a phone, but it can count. `assemble` reports
`story: { units, screensEst }` using a character model per unit (under 80 chars:
five to a screen; under 200: four; under 450: two; else one) and the ceilings above.
The layout doctor **warns** above 40 estimated screens and says which group is
longest, because the fix is editorial: cut by relevance, not by truncation. It does
not fail the build.

### 4.5 Nothing else changes in the file

The story adds attributes and the shell's script. The markup of every component is
the markup it already has. That is deliberate: the page view is unchanged, and a
story built from the same elements cannot drift from it.

## 5. Read time: what the shell does

A new block in `shell.mrbl`'s script and a new block at the end of `design.css`
marked `story`. Guarded on `matchMedia` and on the toggle, so a desktop tab pays
nothing.

### 5.1 The overlay

`<div class="story" data-marble-transient>` appended to `body` when story mode is
entered, removed when it is left. Fixed, `inset: 0`, above the page, honouring the
safe-area insets. Inside it:

- **top**: the progress bar, one segment per screen, each tinted with its group's
  `--cat`, filled up to the current screen; then the kicker row: group label on the
  left, `3 / 24` on the right, and a small ✕ (a real `<button>`, *Read as a page*)
  that leaves the story at the current component.
- **middle**: the track holding the current screen and, during a move, its neighbour.
- **two tap zones**: full-height transparent `<button>`s, *Previous* (left 35%) and
  *Next* (right 65%), with `aria-label`s. They are what makes the story keyboard and
  screen-reader navigable at all.
- **bottom**: the hold hint, a real `<button>` (*Open*) drawn as ︿ with a word under
  it. On a clamped screen the word is *swipe up for all of it*.

### 5.2 Packing

Run on entry, on resize or orientation change (debounced), when fonts finish loading,
and when the document mutates (debounced 250 ms, reusing the existing observer).

```
H     = overlay height − top chrome − bottom chrome − safe areas
units = every unit in story order, cloned into a measuring column of the screen's
        width, each with { kind, group, own, height }
screens = []; cur = null
for u in units:
  if u.own or cur == null or cur.group != u.group
     or cur.count >= ceiling(u.kind) or cur.height + gap + u.height > H:
    cur = new screen(u.group); screens.push(cur)
  cur.add(u)
```

A unit taller than `H` on its own marks its screen `data-clamped`; the unit box gets
`max-height: H`, `overflow: hidden` and a bottom mask fade.

After a re-pack the story stays on the screen that now holds the unit it was showing,
found by that unit's `data-marble-id`. Nothing is remembered across tabs: the current
screen is a fact about this tab, so it lives in the overlay and dies with it.

### 5.3 Gestures and motion

Everything here obeys the apple-design skill; the numbers are its numbers.

- **Tap**: feedback on `pointerdown` (the tapped zone dims 4%), commit on
  `pointerup`, cancelled by moving more than 10 px.
- **Horizontal drag**: after 10 px of hysteresis, the track follows the finger 1:1
  from the grab point with the neighbour screen alongside. On release, project the
  landing point from velocity (`v/1000 · 0.998 / 0.002`), snap to the nearer screen,
  and hand the release velocity to a spring: damping 1.0 / response 0.35 when it was a
  placement, damping 0.8 / response 0.35 when it was a flick. At the first and last
  screen the track rubber-bands.
- **Swipe up**: after 10 px, the screen content follows the finger up and fades
  (1:1); past 30% of the height, or a downward-projected landing beyond it, release
  commits to hold: the document is scrolled so the unit's section sits at the top
  (`scroll-margin-top` for the return bar), the overlay finishes its move with a
  spring (damping 0.8 / response 0.3, the drawer values) and is then hidden, not
  removed. Releasing earlier springs back.
- **Return from hold**: the return bar is a translucent material (`backdrop-filter`,
  a solid fallback under `prefers-reduced-transparency`) fixed at the top of the
  document, reading *↓ To-dos · back to the story*. Tapping it, dragging it down, or
  Esc brings the overlay back at the same screen along the same path it left by.
- **Keyboard**: ← → move, ↑ or Enter opens hold, Esc returns from hold, and the
  tap-zone buttons take focus with a visible ring.
- **Reduced motion**: screens cross-fade instead of sliding, hold cross-fades instead
  of rising, and no spring overshoots. The progress bar still moves, and the kicker
  still changes, so no state is reported through motion alone.
- **Interruptibility**: every move animates from the track's live transform, never
  from the target, so a tap during a slide re-targets rather than jumps.

### 5.4 What a glance screen looks like

Type is set for arm's length: unit titles at 1.2rem serif, body at 1rem, measure the
screen's width. Units stack with hairline rules between them, the same rules the page
uses. State the page already colours stays coloured: a done row is struck through, a
pinned row is tinted, a saved card shows its star, a known author shows as known.
Chrome that only exists to be pressed (`.acts`, `.chk`, `.add`, `.exp-toggle`, segment
controls, the chevron) is not drawn. Colour keeps its meaning: the progress segment
and the kicker dot carry the group's `--cat`, exactly as the page's headers do.

Clones carry no `data-marble-id`, no `contenteditable`, no `data-act`, no `href`
(a link in glance would navigate on the tap that meant *next*). `pointer-events:
none` on the whole screen; only the overlay's own buttons and the track's drag surface
receive input.

### 5.5 Cover and end

The **cover** is the masthead as a screen: date, greeting, summary, and one mono
line, *24 screens*. The **end card** says *That's your day*, shows the sources line
and the palette name from the colophon, and carries two real buttons: *Read as a
page* and *Start over*. Tapping next on the end card rubber-bands; the way out is a
button, so nobody leaves by accident.

### 5.6 No host

With no host (`data-marble-readonly`), the story still runs: it never needed the
carrier. Hold still shows the real page, and the page still says once that changes
will not be saved.

## 6. The toggle

Under 62rem the runtime inserts a transient segmented control at the top of the page,
in the `.seg` pattern that already exists (a `role="group"`, two real buttons,
`aria-pressed` derived): **Page · Story**. Choosing Story enters the overlay at the
cover, or at the current component if the page is scrolled past the masthead.

The choice is filed on `main.page` as `data-read`, the same way a component's view is
filed, and `readback` carries it into the next morning's build so tomorrow opens the
way Bryan reads. It is honoured only under 62rem: the file is one file for phone and
desktop, and a desktop tab never opens a story because the phone asked for one.

*Decided against* `localStorage` (interaction law 8) and against a purely transient
choice, which would make him choose Story every morning.

The URL hash `#story` opens story mode at any width and is not filed. It exists so a
screenshot pass and a browser test can reach the story on a desktop-sized run.

## 7. What the skill is told

A new section in `SKILL.md`, **§The story**, after *Adapting to the day*, and three
touches elsewhere. In substance:

> **The story.** On a phone Bryan reads the day as screens: tap forward, tap back,
> swipe up to interact, an end card. The build cuts the day into units and the page
> packs them; you decide what deserves a screen of its own and what order the day
> reads in.
>
> - `layout.story` is optional: `{ "order": ["weather","focus",…], "skip":
>   ["nflseason"] }`. The default order is cover, weather, the to-do components,
>   calendar, the rest of the stream, art, end. Override it when the day has a
>   shape: a game day leads with the season; a deadline day leads with focus.
> - Any item may carry `"storyOwn": true`. Use it for the one to-do he has to read
>   in full, or a Tangential paper you want him to see alone. Long notes, lists,
>   Core and Adjacent papers and relevance-3 news stand alone without asking.
> - **A screen is one thought.** The run's report carries `story: N screens (est.)`.
>   Aim for 15 to 30. Over 40 is the doctor's warning and your signal to cut by
>   relevance, which the volume caps already ask of you. Never pad a thin day to a
>   number; a nine-screen story is a fine morning.
> - A multi-view component contributes one view to the story (news the Reading
>   view, calendar the List). Nothing you do per run changes that.
> - Step 7 gains a phone pass: screenshot at 393 × 852 with `#story`, walk every
>   screen, and look for a clamped screen that should have been split (a unit that
>   is two thoughts), a screen with one short line on it (a ceiling or a group
>   boundary you could have avoided), and type that has gone small.

The three touches: the component table gains a *story* column summarising §2; the
payload block gains `storyOwn` on items and `layout.story`; the invariants gain
*The story files nothing but `data-read`. Glance is read-only; hold is the page.*

## 8. Testing

- **`test/day-story-units.test.js`** (node, runs `build.mjs assemble --out` against
  `sample-payload.json` plus a fixture with a six-line note, a one-line to-do, a
  relevance-3 paper and a relevance-1 paper): asserts `data-story` on every section,
  `data-story-view` on every viewbox, `data-story-own` on the long-note row and the
  Core paper and not on the others, the estimate in the JSON report, and that
  `readback` of the built file reports nothing new.
- **`test-browser/day-story.test.js`** (through `harness.js`, the way `day-run`
  loads a day), at 393 × 852:
  - the toggle appears; Story opens the overlay; segments equal screens equal the
    kicker's denominator;
  - every unit's source id appears on exactly one screen;
  - next and previous move the kicker; the end card rubber-bands; the cover too;
  - a fixture with a 40-line note produces a `data-clamped` screen;
  - a synthetic swipe-up opens hold: the document is scrolled to the row's section
    and the return bar names it; ticking the row and returning shows the clone
    struck through;
  - resizing to 700 px repacks and stays on the same unit;
  - under emulated reduced motion no element animates `transform`;
  - `data-read="story"` is filed once on the root and nothing else is filed
    (count ops);
  - at 1280 px with no hash there is no overlay; with `#story` there is.

## 9. Out of scope

- Auto-advance, timers, or a "seen" state per screen. Reading is not watching.
- A story on the desktop as a default. `#story` reaches it for testing only.
- Reordering rows from inside hold beyond what the page already does.
- The `/today` route (memory: `my-day-ios-request`, part 4). Unrelated, still open.
- Haptics. The Vibration API is unsupported on iOS Safari; nothing to design.
