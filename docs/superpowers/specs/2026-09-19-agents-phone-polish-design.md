# Agents on a phone — the polish pass

> Status: **review complete, solutions approved to build**, 2026-09-19.
> Follows `2026-09-18-agents-phone-design.md` (Deck, fisheye Focus, phone
> chrome). This is a usability and visual review of what shipped, at
> 393 × 852 with touch, light and dark, keyboard up and down, followed by
> the fix for every finding. Same tokens, no new dependencies, follows the
> `apple-design` skill (values named inline).

Reviewed with `tools/phone-tour.mjs` (every phone surface as a PNG,
plus a touch-target and overflow audit) and `test-browser/shots.js --phone`.
Re-run the tour after a change; do not judge from the code alone.

## 0. Summary

The bones are right: Deck answers "what needs me", the fisheye is a real
gesture on one value, sheets track the finger, asks are optimistic. What
fails is the layer between the bones and the thumb — chrome stacked three
deep over a conversation, desk controls (28 px menus, 21 px pickers, a
hidden filter box) surviving into the phone, sheets that ignore the
keyboard, and a Focus stack whose edge cases (slivers, the blank Full mid
drag, the unlabeled pane) read as glitches. Forty findings, grouped by
surface, each with its fix. Nothing here changes the data model or the
desk.

Severity: **S1** blocks a phone task · **S2** makes it clumsy · **S3**
polish.

## 1. Chrome and navigation

| # | Finding | Sev |
|---|---|---|
| A1 | **Three headers over an open conversation.** Topbar (title, asks pill, usage ring, ⋯) stays; under it the pane's 36 px dock bar (empty but for × and a floating back chevron); under that the 79 px mast (title, provider pill, target link, "Also working here: 3 — …" wrapping to two lines). 159 px of chrome before the first transcript line; with the keyboard up the transcript gets ~200 px. Spec §7 asked for a mast folded to one line. | S1 |
| A2 | **Back is clipped and doubled.** `.pane .back` is a 32 px floating disc at top/left .6rem inside a 36 px bar; the pane clips its left edge (a "(" sliver shows at x=0). The bar also carries × (Close pane), which on a phone means the same thing by a different route. | S1 |
| A3 | **The usage ring reads as a spinner.** A 36 px conic ring with a 5 px track is the loudest element on every phone screen; at 23 % it looks like something is loading. | S2 |
| A4 | **Topbar controls are three different heights.** Asks pill 42 × 36, ring 36 × 44, ⋯ 44 × 44; the pill misses 44 pt and the three do not share a centre line. | S2 |
| A5 | The topbar title has `pointer-events: none`; the spec promised long-press to rename. Renaming this document from a phone is not a phone task — drop the promise, not the guard. | S3 |
| A6 | **No way to start a chat from List, Board or Folders.** The thumb bar hides outside Deck and Focus and the ⋯ sheet has no *New conversation*. | S1 |
| A7 | **Filter is broken on the phone.** ⋯ → Filter calls `setFilterOpen(true)` on a `.filterbox` that the phone stylesheet sets `display: none`; the panel opens at 0 × 0. | S1 |
| A8 | **The ⋯ sheet is seven identical outlined rows.** No title, no current-view mark (`aria-pressed` is set, no CSS reads it), no *New*, view rows indistinguishable from Filter/Settings. | S2 |
| A9 | **Every row keeps its desk ⋯ button.** 28 × 28 target, opens a 13 px popover with only Archive / Mark reviewed, sits where a left swipe lands, and duplicates the long-press actions sheet with a smaller menu. | S2 |

### Fixes

- **A1/A2 — the topbar becomes the conversation's header.** Under `PHONE`
  with `body[data-open]` (and not in Focus): the topbar shows a 44 pt
  back chevron (left, labelled with the view you came from: *Deck*,
  *List*…), the conversation title on one line (15 px / 600, ellipsis)
  with its status dot, and ⋯ on the right that opens the **actions sheet
  for this conversation** (not the view menu). The asks pill stays (it is
  how you get to the next ask). The pane's dock bar is hidden
  (`body[data-phone][data-open]:not([data-view="focus"]) .pane > .dock-bar
  { display: none }`) and `.pane .back` is removed from the phone. The
  runtime folds the mast to **one line at phone density**: target link ·
  tags; the heading is gone (it is in the topbar); *Also working here*
  becomes a single small tag "+2 here" that opens the actions sheet's
  *Working here* list. Result: 44 px topbar + 32 px mast line, then the
  transcript.
- **A3/A4 — one control height.** All three right-hand controls are
  44 × 44 hit boxes on a shared centre, visually 28 px: the pill is 28 px
  tall with 44 pt via padding; the ring is 22 px with a 3 px stroke,
  neutral (`--line` track, `--muted` arc) below 50 %, toned above, and it
  carries `aria-label="Usage 23%"`. ⋯ is a 20 px SVG. Gap 2 px, right
  padding 6 px.
- **A6 — the thumb bar is on every list view.** Deck, List, Board and
  Folders show it; Focus and an open conversation do not. *New
  conversation* is also the first row of the ⋯ sheet.
- **A7 — Filter is a sheet.** `openSheet('filter')` moves the existing
  `.filter-pop` contents (status chips, archived toggle, search) into the
  sheet body and returns them on close (same node, so the desk filter is
  untouched). The search field is 44 pt and 17 px so iOS does not zoom.
- **A8 — the ⋯ sheet has structure.** Title *Agents*; a primary *New
  conversation* row; a **view group** (one rounded group, hairline
  separators: Deck · Focus · List · Board · Folders, the current one with
  a ✓ in `--accent-ink`); a second group: Filter (with the active count
  when set), Settings. Groups use the grouped-list style in §3.
- **A9 — one menu.** Under `PHONE` the row ⋯ opens `openActions(id)`;
  the popover never builds. The button's hit is 44 × 44 (visual 28 px).

## 2. Deck

| # | Finding | Sev |
|---|---|---|
| B1 | **Rows are three lines (~70 px) and repeat themselves.** Title / target path / "Fake · activity". The provider label is on every row; the target path duplicates the folder colour; every age reads "now". | S2 |
| B2 | **Band headers are nearly invisible.** 11.5 px uppercase in `--faint` with a 9 px "▾" glyph at the far right; not sticky, so a long Review band loses its label. | S2 |
| B3 | **Status dots have no vocabulary.** Running is a static muted dot; asking is a ring; review is black; failed is red. Nothing moves, nothing says which is which. | S2 |
| B4 | **The ask card says the command twice** (peek `pre` and the ask's own detail box), shows a raw lead line, squeezes Allow / Deny / "Why not? (opt" into one row so the reason input is ~100 px, and orphans *Open* as a text button bottom-right. | S1 |
| B5 | Two or more asks page sideways with no indicator. | S3 |
| B6 | **Swipe-to-review commits with no feeling.** "Reviewed" is 12.8 px faint text; the row snaps back and jumps to Idle on the next paint. | S2 |
| B7 | Long-press on a row's text pops the iOS selection loupe before the sheet (`-webkit-touch-callout` / `user-select` are not cleared on rows, cards, band heads or sheet rows). | S1 |
| B8 | **"Nothing here" three times.** Every empty band prints it; an empty Deck is three faint labels and a collapsed Idle. | S2 |
| B9 | Dark mode: the thumb bar's top edge is `rgba(255,255,255,.4)` — a white hairline across a dark screen. | S3 |
| B10 | The ⊕ is a text "+" (1.4 rem), optically low-left of centre. | S3 |

### Fixes

- **B1 — two-line rows.** Line 1: dot · title · age (tabular). Line 2:
  the activity while running, the outcome word in tone when finished,
  else the target's tail. Provider hidden under `PHONE` (it is in the
  header and the actions sheet). Folder colour is the 3 px leading rule.
  Row 60 px, padding 12/16, title 17 px / 500, line 2 15 px `--muted`.
- **B2 — band headers you can find.** 13 px / 600 `--muted` sentence
  case, the count in a 22 px tonal pill (asks in `--danger-soft`), the
  chevron a 16 px SVG that rotates with the section's spring; the header
  is `position: sticky; top: 0` inside `.deck` with the topbar material.
  Collapsing animates height (`grid-template-rows` 1fr→0fr, 240 ms,
  `--settle`); reduced motion cuts.
- **B3 — one dot vocabulary, drawn once.** running = `--accent`, a 2 s
  opacity breath (.55→1, reduced motion: static); asking = `--danger`
  ring, 2 px; review = `--ink`; failed = `--danger` filled; idle = 1 px
  `--line` ring. The same rules serve List, Board, Focus cards and the
  topbar title dot.
- **B4 — the ask card, once.** Head: dot · title · target tail on one
  line, whole head tappable (opens the conversation; a chevron at the
  right says so; *Open* button removed). Peek: lead lines only when they
  are not the request itself (drop the `prompt:` echo). The ask card's
  own detail box is the single command/file display. Buttons: Allow
  (primary, 50 %) and Deny (50 %) on one row, both 48 pt; the *Why not?*
  reason input appears **under** the row only after Deny is tapped (Deny
  becomes *Send*), so nothing is truncated. Question asks: numbered rows
  48 pt each, *Other…* last.
- **B5 — page dots.** When the rail has >1 card, 6 px dots under it,
  current in `--ink`, from the rail's `scroll` position.
- **B6 — a swipe that answers.** The commit label is an SVG check + word
  that scales .8→1 as the drag crosses the threshold; the row's
  background tints `--accent-soft` at commit; on release the row
  collapses (height spring to 0, 260 ms) and re-appears in Idle — the
  same collapse pattern for a left-swipe *Undo turn* commit.
- **B7 — touch guards.** `.conv, .focus-card, .band-toggle, .sheet-row,
  .thumb, .topbar { -webkit-touch-callout: none; -webkit-user-select:
  none; user-select: none }` under `PHONE`; transcripts stay selectable.
- **B8 — empty states.** A band with no rows hides (Idle too, when it is
  empty); an empty Deck shows one centred state ("Nothing is running.
  Say something below to start." with the ⊕). The NEEDS YOU band already
  hides when empty.
- **B9** — the edge is `rgba(255,255,255,.4)` in light and `.08` in dark
  via `--edge-lit`.
- **B10** — a 20 px SVG plus, centred.

## 3. Sheets

| # | Finding | Sev |
|---|---|---|
| C1 | **Sheets ignore the keyboard.** `.sheet { position: fixed; bottom: 0 }`; on iOS the keyboard covers the New sheet's *Start* and half its textarea. | S1 |
| C2 | The textarea shows the UA's thick blue focus ring. | S3 |
| C3 | Rows are outlined cards with 8 px gaps — heavy, and few rows fit above the fold. | S3 |
| C4 | Fleet copy: "resets Resets Thu, Sep 17"; five ragged text lines repeating the two meters above them. | S2 |
| C5 | The actions sheet is a bare title over a flat list, *Move to X* once per folder. | S2 |
| C6 | **A tall sheet cannot scroll on touch**: `touch-action: none` on the sheet blocks panning; the fleet and actions sheets overflow at 393 × 852. | S1 |

### Fixes

- **C1 — sheets read the visual viewport.** `syncViewport` also writes
  `--kb` = `innerHeight − vv.height − vv.offsetTop`; `.sheet { bottom:
  var(--kb, 0px); max-height: calc(var(--vv-h) * .88) }`. The New sheet
  focuses its textarea after the spring settles, not before.
- **C2** — `outline: none; border-color: var(--accent); box-shadow: 0 0 0
  3px var(--accent-soft)`.
- **C3 — grouped lists.** `.sheet-group` (rounded 12 px, `--card`, 1 px
  `--line`) with 48 pt rows separated by hairlines inset 16 px; tone via
  `data-tone`; a trailing ✓ or chevron. Sheets get a 17 px / 600 title
  row with an optional subtitle.
- **C4 — fleet rows.** One row per window: label (left), bar (middle),
  "23 % · Thu 3:30 PM" (right, tabular); the duplicate meters block goes.
  *Stop all running (n)* stays a danger row at the bottom.
- **C5 — actions sheet.** Header: title + subtitle (target tail · status ·
  age). Groups: *Open*, *Stop* (danger, running only) · *Mark reviewed*,
  *Move to folder ›* (a second sheet page listing folders + *Remove from
  folder*), *Archive* · *Continue in …*. A *Working here* group lists the
  other agents on the same target when there are any.
- **C6 — scrolling and dismissal coexist.** `.sheet { touch-action:
  pan-y }`; the drag-to-dismiss handler engages only when the grab starts
  on the grip/title, or when `sheet.scrollTop === 0` and the first move is
  downward; otherwise the sheet scrolls natively.

## 4. Focus on a phone

| # | Finding | Sev |
|---|---|---|
| D1 | **Slivers look like ruled paper.** Seven 10 px bars with 1 px borders overlapping by 2 px at each end of the stack. | S2 |
| D2 | **Nothing says the stack is draggable** or where you are in it. | S2 |
| D3 | **The Full slot is blank while dragging.** The pane fades to 0 and the card underneath shows a head and empty body. | S2 |
| D4 | The Full pane has the same three-deep chrome as A1, plus a × whose meaning on a stack is unclear. | S1 |
| D5 | **The composer shows the whole desk setup row** ("Fake Default Fake Alt Default low high Default"): 21–23 px controls, the scrubber and the pickers both, below 44 pt everywhere; Send is 28 × 28. Spec §7 asked for the setup folded into More. | S1 |
| D6 | With the keyboard up, the cards below the Full keep their height and the composer floats mid-screen. | S2 |
| D7 | Digest heads have a full-width hairline under them; a digest reads as two cards. | S3 |
| D8 | The folder colour rides chips but not digests or the Full. | S3 |
| D9 | The last sliver run ends at the screen bottom under the home indicator. | S3 |
| D10 | Focus with nothing in it is a blank screen (`.focus-empty` hidden). | S2 |

### Fixes

- **D1 — a pile, not lines.** Slivers become one `.focus-pile` element
  per end (top and bottom), drawn as three 6 px steps, each inset 4 px
  more than the last (a deck seen edge-on), with a "+N" count when the
  run is longer than three. The cards keep their `data-lod="sliver"` for
  layout; they render `visibility: hidden` and the pile is what shows.
- **D2 — position and affordance.** A 3 px `--line` track on the right
  edge with a `--muted` thumb whose position is `focal / (n − 1)`; it
  fades in on pointerdown and out 600 ms after settle (reduced motion:
  no fade). Chips and digests show a faint chevron at the far right.
  The first open of phone Focus shows a one-time hint on the Full ("Drag
  the stack · tap a card"), stored in `localStorage`.
- **D3 — the Full slot has content.** `.focus-card[data-lod="full"]`
  renders the digest at Full size: title 20 px / 600, target, activity or
  outcome, age, and the conversation's last transcript line (from the
  summary's `activity` / `lastText` when present). Body opacity 1.
- **D4 — the card is the header.** In phone Focus the pane's dock bar is
  hidden and the mast is the one-line fold from A1; the Full card's own
  head (dot · title · age) stays visible above the pane (the pane is
  placed 44 px below the card top). No ×; long-press for actions.
- **D5 — one chip.** At `data-chrome="phone"` the runtime hides
  `.setup` and renders a single 40 pt chip "Claude · Default" (provider ·
  setup, mode when not default) at the bar's left; tapping it opens the
  picker in a popover sheet (the existing `.seg` menus, re-hosted). Send
  is 44 × 44. Attach and stop buttons 44 × 44.
- **D6 — the keyboard demotes below first.** `fisheye` takes an
  `{ anchor: 'bottom' }` hint when `room` shrank because of the keyboard
  (`--kb > 0`): cards **below** the Full step to slivers before those
  above, so the composer sits on the keyboard.
- **D7** — no head hairline on digests; head and body are one surface.
- **D8** — the 3 px leading rule on every tier.
- **D9** — `.focus[data-phone] { padding-bottom: env(safe-area-inset-bottom) }`
  and `room` subtracts it.
- **D10** — a phone empty state: "Nothing pinned. Open a chat and pin it
  from ⋯, or start one." with a *New conversation* button.

## 5. The open conversation (runtime, `data-chrome="phone"`)

| # | Finding | Sev |
|---|---|---|
| E1 | Mast: see A1. | S1 |
| E2 | Setup row: see D5. | S1 |
| E3 | Send 28 × 28; the target-jump link is 18 px tall. | S2 |
| E4 | Edge-swipe back moves only the pane; the view behind neither slides nor undims, so the gesture has no depth. | S3 |

### Fixes

- **E1/E2** as above. **E3** — send 44 × 44 (visual 32), the target link
  padded to 44 pt. **E4** — during the edge drag the view behind
  translates from −28 % to 0 and a scrim fades .28→0 in step with the
  pane's x; the pane keeps a 0 0 0 1px + 12 px shadow on its left edge.

## 6. Materials, type, motion — cross-cutting

| # | Finding | Sev |
|---|---|---|
| F1 | `:active` is missing on band heads, ask buttons, chips, the topbar controls. | S3 |
| F2 | The band chevron is a text glyph; the ⊕ is a text plus; weights differ from the SVG icons around them. | S3 |
| F3 | `.sheet max-height: 80vh` and any `100vh` fallback ignore the visual viewport. | S2 |
| F4 | No `prefers-reduced-transparency` on the sheet. | S3 |

### Fixes

- **F1** — one rule: `@media (hover: none) { .pressable:active { … } }`
  with the paper-2 wash for rows and `scale(.97)` for pills/buttons at
  100 ms ease-out; every phone control carries the class.
- **F2** — SVG for both.
- **F3** — every phone height reads `--vv-h`.
- **F4** — the sheet goes solid under reduced transparency.

## 7. Motion values (unchanged where the phone spec set them)

| Interaction | Mechanism | Values |
|---|---|---|
| Band collapse | grid rows 1fr→0fr | 240 ms `--settle` |
| Row commit collapse | height spring | damping 1, response 0.26 |
| Ask card leave / next | translate + opacity | 200 ms ease-out |
| Stack position track | opacity | in on down, out 600 ms after settle |
| Edge-swipe parallax | 1:1 with the pane | behind: −28 % → 0, scrim .28 → 0 |
| Sheet, fisheye, swipe | as before | drawer 0.8/0.3; stack 1/0.4 (0.8 after a flick); swipe 1/0.3 |

`prefers-reduced-motion`: collapses cut; the breath is static; parallax
is a crossfade.

## 8. Files

| Unit | Change |
|---|---|
| `templates/agents.mrbl` | phone topbar-as-header; thumb bar on list views; filter sheet; ⋯ sheet groups; row ⋯ → actions; two-line rows; band headers; dot vocabulary; ask card; swipe commit; empty states; touch guards; sheets (keyboard, scroll, groups, fleet, actions); phone Focus (pile, track, Full slot, card-as-header, keyboard anchor, hairlines, rule, safe area, empty) ; edge-swipe parallax |
| `runtime/agent-ui.js` | `data-chrome="phone"`: mast one line, setup chip + picker sheet, 44 pt send/attach/stop, target link hit |
| `runtime/agent-phone.js` | `fisheye(count, focal, room, { anchor })`; `pileRuns(cards)` |
| `test/agent-phone.test.js`, `test-browser/agents-phone.test.js` | new assertions per section; existing ones must stay green |
| `test-browser/shots.js --phone` | also shoots `open`, `more`, `actions`, `new`, `focus-mid` |
| `docs/AGENTS.md` | phone section updated |
| `drive/Agents.mrbl` | regenerated once at the end (`memory/regen-live-agents.py --write`), verified with `cmp` |

## 9. Testing (browser, 393 × 852, touch)

- Open a conversation: the topbar shows back + title; `.pane > .dock-bar`
  is not visible; the mast is ≤ 36 px tall; the first `.log` child is
  within 100 px of the topbar's bottom.
- Every phone control ≥ 44 pt including the topbar cluster, row ⋯,
  send, the setup chip, sheet rows, band heads.
- ⋯ → Filter opens a visible sheet with the status chips; toggling one
  filters the Deck.
- ⋯ → New conversation opens the New sheet from List.
- A sheet taller than the viewport scrolls with a pan; a downward drag
  from the grip dismisses it.
- With `--kb` set to 336, the New sheet's *Start* is inside the visual
  viewport.
- Row ⋯ on the phone opens the actions sheet, not a popover.
- Long-press on a row's title opens the sheet and selects no text
  (`getSelection().isCollapsed`).
- An ask card shows the command once; Deny reveals the reason field.
- Swiping a review row right collapses it and it re-appears in Idle.
- Phone Focus: `.focus-pile` shows at the ends with a "+N" when > 3
  slivers; the Full card's body has text mid-drag; with `--kb` the cards
  below the Full are slivers before those above.
- Reduced motion: unchanged assertions.
