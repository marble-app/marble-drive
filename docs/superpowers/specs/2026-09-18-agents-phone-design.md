# Agents on a phone — Deck, and Focus as a fisheye

> Status: **approved to build**, 2026-09-18. Extends
> `2026-09-18-agents-four-views-design.md`, which made the four desk views
> usable and left the phone as a squeeze of them.

Same UIST warm / Dusk tokens. No new npm dependencies. Node 22. Do not
reparent the file's `<marble-conversation>` (reconcile would clone it).
Follows the `apple-design` skill for motion, materials and gestures; the
values it names are the ones below.

## 1. Why

`@media (max-width: 719px)` in `templates/agents.mrbl` hides the panes,
turns Board into a scroll-snap carousel of one column, and stacks Focus's
cards. Under that treatment three of the four views collapse into the same
thing:

| View | On a phone | Why |
|---|---|---|
| List | survives, about five rows visible | but it browses by recency — it answers *what exists* |
| Board | one column at a time | a column encodes status, already a dot on every card |
| Folders | a tab strip with no dock | the dock of up to four live chats *is* the view |
| Focus | a stack of cards | spatial memory needs a stable, large surface |

All four organize by **where work belongs** — folders, columns, regions.
That is the desk question: how do I arrange my work. The phone is never
where you arrange. It is where you are while the agents run without you,
and its question is **what needs me, and what do I say.** Nothing answers
that today: an ask lives inside one conversation's drawer, so unblocking an
agent from a phone is notice, guess which chat, open it, scroll, tap.

Two views answer it. **Deck** is a fifth view, ordered by how much a
conversation wants you. **Focus** gets a phone layout of its own: one column
where a card's size falls off continuously with its distance from the one in
your hand. Both are projections of `summarize()`; neither adds a stored fact.

## 2. Principles

1. **The organizing fact is attention, not place.** Deck sorts by urgency
   and is allowed to reorder; Focus keeps a stable order and is not. Each
   is honest about which.
2. **A consequential answer is never a gesture.** Allow, Deny and Undo are
   buttons. A permission you can grant with a thumb in a pocket is not a
   permission system.
3. **The screen does not move under a descending thumb.** New work bumps a
   count; it does not take the screen.
4. **Cellular is the constraint.** One stream, optimistic writes, reconnect
   on return.
5. **An app, not a page.** Springs, not durations, for anything a finger
   drives; feedback on touch-down; every motion interruptible; translucent
   chrome; installable from its own head.
6. **Quiet, never hidden.** The four desk views stay reachable on a phone
   behind `⋯`. An iPad rotated past 719 px gets the desk back.
7. **Same tokens as Drive.** No new palette.

## 3. One document, three widths

| Width | Default view | What changes |
|---|---|---|
| ≤ 719 px (`PHONE`, the existing constant) | Deck | phone topbar, thumb bar, Focus as fisheye, one pane at a time, sheets |
| 720–1099 px | as stored | today's stacked layouts |
| ≥ 1100 px | as stored | today's desk |

Deck is a **real fifth view**, not a phone skin: it is in the `V` cycle
(List → Board → Folders → Focus → Deck), it renders at any width, and
`shots.js` can photograph it at 1440. Under `PHONE` it is the default when
no view preference is stored for this tab; a stored preference is honoured.
The choice is a preference default, not a fork — the file behaves the same
everywhere, and hand-editing it still means one thing.

## 4. The phone chrome

### 4.1 Topbar

One 44 pt row plus `env(safe-area-inset-top)`:

```
│ Agents            ●2   ▓62%   ⋯ │
```

- The document title. It is content (`data-marble-editable`), so it stays
  editable — by long-press, so a tap does not raise a keyboard.
- The **asks pill** (`●2`): open asks across every conversation. Present on
  every phone view; tapping it goes to Deck's NEEDS YOU band. Hidden at
  zero. This is how an ask arriving while you are in Focus is one tap from
  answered.
- The **usage dot**: the worst of the signed-in CLIs' short-term meters, in
  the existing colour ramp. Tapping opens the fleet sheet (§4.4).
- `⋯`: Filter, Settings, and the view list (Deck, Focus, then List, Board,
  Folders).

The existing five-row phone topbar (title, toggles, filter, settings, new,
usage) is replaced under `PHONE`. A third of the screen for chrome was the
first thing to go.

### 4.2 Thumb bar

Always present, bottom-anchored, `env(safe-area-inset-bottom)`:

```
 ┌──────────────────────────┐
 │ Say something…           │ ⊕
 └──────────────────────────┘
```

- On Deck the field starts a new conversation (the ⊕ sheet, §4.3, with the
  text carried in); on Focus it *is* the Full's composer — the pane's bar,
  promoted, so the composer is at the thumb and not somewhere in a card.
- No speech recognition. iOS Safari's `webkitSpeechRecognition` is
  unreliable and would be a second input path to maintain; the OS keyboard
  has dictation one tap from this field. The design's job is to make the
  field large and reachable.

### 4.3 Sheets

Three bottom sheets: **New conversation** (project, a saved setup preset,
the prompt; target is `marble.app`, the Agents document, as on the desk),
**Conversation actions** (long-press on any row or card: Stop, Steer,
Interrupt, Mark reviewed, Archive, Move to folder, Continue in…), and
**Fleet** (§4.4).

A sheet tracks the finger 1:1 from the grab offset (`setPointerCapture`,
a short position history for velocity), rubber-bands past the top
(`overshoot · h · 0.55 / (h + 0.55 · |overshoot|)`), and on release
commits or returns by the **sign of velocity**, springing at damping 0.8,
response 0.3 — Apple's drawer values, and the one place bounce is right
because a release carries momentum. The view behind dims and pushes back
(`scale(.96)`, ease-out 200 ms). A sheet opens from the bottom and closes
to the bottom.

### 4.4 Fleet sheet

Two bars per signed-in CLI (short-term and weekly, as in Settings → Usage)
with their reset times, and **Stop all running** with a count. There is no
*Allow all*: answering several permission prompts with one tap is the
failure mode this design exists to prevent.

### 4.5 Materials, type, install

- Topbar and thumb bar: `rgba(paper, .72)` + `backdrop-filter: blur(20px)
  saturate(180%)`, a bright 1 px top edge on the thumb bar; content scrolls
  under both; a 12 px fade where content meets chrome, not a rule.
  `prefers-reduced-transparency` makes both solid.
- Body 17 px / 1.45; the title tightened to `-0.01em`; ages
  `font-variant-numeric: tabular-nums`; spacing in `rem` so text zoom
  scales the layout.
- `-webkit-tap-highlight-color: transparent`; our own `:active` at 100 ms
  ease-out (`transform: scale(.97)` on buttons, a paper-2 wash on rows).
- `html, body { overscroll-behavior: none }` under `PHONE`; scrolling
  regions own their bounce. `touch-action: pan-y` on the Deck and the
  stack, `manipulation` on every control.
- In the document `<head>`: `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style: black-translucent`,
  `viewport-fit=cover` on the viewport meta, and an `apple-touch-icon`
  carrying the tiled mark inline as a data URI. The document declares its
  own installability; the host ships nothing.
- The keyboard: `visualViewport` `resize`/`scroll` → `--vv-h` on `:root`
  → every phone layout reads it. Nothing `position: fixed` guesses where
  the keyboard is.

## 5. Deck

```
┌──────────────────────────────┐
│ NEEDS YOU · 2                │
│ ┌──────────────────────────┐ │   full-bleed ask cards, paged sideways
│ │ ● Figure 3 redraw        │ │   (scroll-snap x, one card per page)
│ │ Research/CHI2027         │ │
│ │ ┌ peek ──────────────┐   │ │   the last two transcript lines, or
│ │ │ …wrote figure3.tex │   │ │   the diff hunk clipped to six lines
│ │ │ Bash: latexmk -pdf │   │ │
│ │ └────────────────────┘   │ │
│ │  [ Deny ]    [ Allow ]   │ │   buttons, bottom third of the card
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ RUNNING · 3                  │   one live line each
│ ● Figure 3     reading  4m   │   tap = open · long-press = actions
│ ● atlas gen    Bash ×4  12m  │
├──────────────────────────────┤
│ REVIEW · 2                   │   swipe → reviewed · swipe ← reveals Undo
│ ! focus cols   failed   1h   │
├──────────────────────────────┤
│ IDLE · 5                   ▾ │   collapsed by default
└──────────────────────────────┘
```

### 5.1 Bands

Every conversation lands in exactly one band, from `summarize()`:

| Band | Predicate | Order within |
|---|---|---|
| NEEDS YOU | `asking` | oldest ask first |
| RUNNING | `running` or `queued` | most recent activity first |
| REVIEW | `needsReview` | most recent first |
| IDLE | everything else, not archived | most recent first |

Archived conversations are under the `⋯` filter, as on the desk. Band
headers collapse and expand on tap; the state is tab-local
(`localStorage`), like extra panes, and never filed. IDLE starts
collapsed; the others start open.

### 5.2 Ask cards

An ask card is the existing ask renderer from `runtime/agent-ui.js` (the
`case 'ask'` card), given a header — the conversation's status dot, title,
target — and a **peek**: enough to answer cold. For a permission prompt,
the tool and its argument, and the last two transcript lines before it.
For an edit, the diff hunk clipped to six lines. **Open** goes full screen
when that is not enough. Options of an `AskUserQuestion` are the numbered
rows the drawer already draws, at 44 pt each, plus *Other…*.

Answers are **optimistic**: the card leaves on tap and the next snaps in;
if the POST fails, it comes back with one line saying so. An ask queue
that stutters on every answer is unusable on a train.

An ask that arrives while another band is being read **bumps the count
and flashes the header** (one 300 ms paper-2 pulse); it does not expand
the band. The one exception is when NEEDS YOU is empty and collapsed —
then it expands, because there is nothing under the thumb to mis-tap.

### 5.3 Rows

A RUNNING row is: status dot in tone · title · the activity line (already
folded, `6 steps · Shell ×2 …`) · elapsed, ticking from one shared
`setInterval(1000)` that pauses when the page is hidden. A REVIEW row
carries the outcome word in tone. Folder colour rides the leading edge as
the 2 px rule the four-views spec put on every other row.

Tap opens the conversation (§7). Long-press (400 ms, cancelled by 10 px of
movement) opens the actions sheet. A REVIEW row swipes right to **Mark
reviewed** — the cheap, reversible action completes as a gesture — and
swipes left to *reveal* **Undo turn** as a button, which is §2.2.

### 5.4 Asks across conversations

Today an ask's content lives only in its conversation's event stream, and
`asking: true` is the whole of what the `*` channel says. A phone
subscribing to N streams is the wrong answer on a radio, so:

- **`GET /agent/asks`** → `{ asks: [{ conversation, turn, requestId,
  request, lead, since }] }` — every open ask, with `lead` the last two
  transcript events before it. Derived from the runner's in-memory
  pending asks, which it already holds to route answers; nothing new is
  written.
- The `*` channel gains `event: ask` (`{ conversation, turn, requestId,
  request, lead }`) when one opens and `event: ask.resolved`
  (`{ conversation, requestId }`) when it closes — on answer, on Stop, or
  when the process ends first.

Deck reads the route once at load and thereafter listens. No polling.

## 6. Focus on a phone — the fisheye

```
┌──────────────────────────────┐
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  │  slivers: 10 pt, stacked 2 pt over
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  │
│ ● atlas gen             12m  │  chip: 44 pt — dot · title · age
│ ┌──────────────────────────┐ │
│ │ ● bib cleanup            │ │  digest: 112 pt — the four-line card
│ │ Research/Bibliography    │ │  from the desk, full width
│ │ deduping 40 entries      │ │
│ │ running · 3m             │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ ● Figure 3 redraw   ⋯    │ │  FULL: the remainder of the room —
│ │ Research/CHI2027         │ │  the live transcript; the composer is
│ │  …6 steps · Read ×2…     │ │  the thumb bar
│ │  wrote figure3.tex       │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ ● focus columns          │ │  digest
│ └──────────────────────────┘ │
│ ● pane edges             1h  │  chip
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  │  slivers
└──────────────────────────────┘
```

### 6.1 One scalar

`focal` is a float index: `2.37` is between the third and fourth card. A
card's tier is its distance `d = |i − focal|`:

| `d` | tier | height |
|---|---|---|
| 0 | full | `room` minus everything else |
| 1 | digest | 112 |
| 2 | chip | 44 |
| ≥ 3 | sliver | 10, each overlapping the last by 2 |

The tier is written to the card's existing `data-lod` attribute, which
gains the value `sliver`; the desk's three values keep their CSS.

Between integers the height is linear in `d`, so as you drag, the next
card grows chip → digest → full while the last shrinks the other way.
Four tiers rather than the desk's three: the chip is too tall to be the
floor on a phone, and the sliver is what "gradually minimized" looks like
at its end. With twelve conversations on an 852 pt iPhone it leaves the
Full about 450 pt.

`room = --vv-h − topbar − thumb bar`. When the keyboard rises, room
shrinks and the same function demotes digests to chips and chips to
slivers so the Full keeps its transcript above the composer. There is no
keyboard special case.

### 6.2 Held, not scrolled

Scroll-snap cannot do this: snap positions shift while heights change
under them. Instead the stack is a **gesture on one value**. A drag sets
`focal` so that **the card you grabbed stays under your finger**: the
layout is monotone in `focal`, so each frame solves for the value that
puts the grabbed card's top at the finger minus the grab offset. That is
the difference between holding a stack and scrolling a list.

On release, velocity in cards/s from the last ~80 ms of pointer history is
projected (`v/1000 · 0.998/0.002`), `focal` snaps to the nearest integer
to the projection, and a spring carries the release velocity there —
damping 1, response 0.4 (the desk's `FOCUS_RESPONSE` / `FOCUS_DAMPING`),
or damping 0.8 when the projection crossed at least one card, because
then the gesture carried momentum. A touch during the spring grabs the
live value; nothing is locked out.

Tap a non-Full card → spring `focal` to it, damping 1. Swipe the Full's
header left or right → the neighbour, for one-handed stepping. Long-press
any card → the actions sheet.

### 6.3 The transcript is the pane, not a card

The Full slot is a placeholder. `.pane` — the seeded `<marble-conversation>`
and its chrome — is positioned over it, as `layoutFocusPane` does on the
desk stage; it is never reparented. During a drag the pane's opacity is
`1 − min(1, 3 · |focal − focalAtGrab|)`, so it is gone within a third of a
card's travel and the slot underneath shows the digest content at Full
size. When the spring settles on a different card, the pane retargets via
its `conversation` attribute and materializes: blur 8 → 0 px with opacity
0 → 1 over 200 ms ease-out. The dozen-node stack is what animates at
120 Hz; the transcript does not.

The composer under `PHONE` Focus is the thumb bar (§4.2): the pane's bar
is laid out there with a transient stylesheet, the same mechanism the
drawer uses to dock without changing the document.

### 6.4 Order and folders

The desk's: folders in catalog order, ungrouped last, oldest-first within,
stable. The stack does not reshuffle when a chat ticks, so a thumb learns
where things are. Folder colour rides each card's leading edge; regions
collapse to order and colour.

### 6.5 Not on the phone Focus, and why

| Desk feature | Phone | Because |
|---|---|---|
| Keep open / multi-Full | no | no room for two live transcripts |
| Quick Look | no | the digest is the quick look |
| `assignLods` cooling | no | tier is positional here, not temporal |
| Drag to another region | no | a chore with little return (four-views §5.2); *Move to folder* is on the actions sheet |
| `focusX` / `focusY` | ignored | order is the desk's order; a phone does not arrange |

The desk Focus is untouched. Under `PHONE` the four-views "stack the
cards" fallback is replaced by this; above it nothing changes.

## 7. One conversation, full screen

From Deck, tapping a row promotes the existing `.pane` the way
`body[data-open]` already does under 719 px, at a new
`data-chrome="phone"` density in `runtime/agent-ui.js`: the mast folded to
one line (status dot, title, target); the composer's setup folded fully
into More (already the documented fold); prose 17 px / 1.45 full width;
tool rows folded as today. Back is a chevron and a left-edge swipe (1:1,
commit by velocity sign, spring damping 1). The pane enters from the right
and leaves to the right.

The thumb bar is the composer here too.

## 8. Live-ness on a radio

One `EventSource` on `/agent/events` (`*`) for the page; a second only
while a conversation is open. On `visibilitychange` → hidden: close both,
remember the last summary `seq`. On visible: reconnect, `GET
/agent/conversations` and `GET /agent/asks` to resync, then repaint. A
phone backgrounds constantly, and a dead stream nobody reconnected is
exactly how this would come to feel broken. Elapsed timers stop while
hidden and resync from `updatedAt` on return.

## 9. Motion, in one place

| Interaction | Mechanism | Values |
|---|---|---|
| Fisheye settle | scalar spring | damping 1, response 0.4; 0.8 after a flick |
| Sheet open / dismiss | 1:1 drag → spring | damping 0.8, response 0.3; commit by velocity sign |
| Pane enter / leave | 1:1 edge drag → spring | damping 1, response 0.35; from/to the right |
| Ask card paging | `scroll-snap-type: x mandatory` | the browser's own physics |
| Swipe-to-review | 1:1 drag → spring back or commit | damping 1, response 0.3 |
| Touch-down | `:active` | 100 ms ease-out |
| Pane materialize | Web Animations | blur 8→0 + opacity, 200 ms ease-out |
| Band flash | Web Animations | one 300 ms paper-2 pulse |
| View switch | the four-views crossfade | unchanged |

`prefers-reduced-motion`: every spring becomes a 150 ms opacity crossfade;
the fisheye still lays out but tiers crossfade instead of grow; sheets
fade in place; no travel anywhere. The existing tests assert the
crossfade already.

## 10. Files

| Unit | Change |
|---|---|
| `runtime/agent-phone.js` | **new**, pure, exported on `marbleAgentPhone`, unit-tested in Node: `bands(summaries)`; `askLead(events)`; `fisheye(count, focal, room)` → `[{ top, height, tier, t }]`; `focalFor(index, top, count, room)`, its inverse; `spring1d({ from, to, velocity, damping, response })` as a stepper; `project(v)` |
| `templates/agents.mrbl` | the Deck view; Focus's `PHONE` layout replacing the narrow stack; phone topbar, thumb bar, sheets; install meta in `<head>`; `V` cycles five; visibility reconnect |
| `runtime/agent-ui.js` | `data-chrome="phone"` density; the ask card takes a header and a peek |
| `server/agent/runner.js` | expose open asks; publish `ask` / `ask.resolved` on `*` |
| `server/agent/routes.js` | `GET /agent/asks` |
| `test-browser/shots.js`, `probe.js` | `--phone` → 393 × 852, `hasTouch`, `isMobile`, DPR 3; `--keyboard` shrinks the visual viewport by 336 |
| `test/agent-phone.test.js` | new |
| `test-browser/agents-phone.test.js` | new |
| `docs/AGENTS.md` | Deck; Focus on a phone; the asks route; the cycle of five; installing |
| `drive/Agents.mrbl` | seed-once, so patched by hand after the browser tests pass — one write, then verify |

## 11. Testing

**Node** (`test/agent-phone.test.js`):

- `bands`: every summary lands in exactly one band; an `asking` summary is
  NEEDS YOU even if also `running`; archived is in none.
- `fisheye`: heights sum to `room` for any `focal`; exactly one card has
  `tier === 'full'` at an integer `focal`; heights are continuous in
  `focal` (no jump larger than one frame's worth at `focal ± ε`); a
  smaller `room` never grows a neighbour.
- `focalFor`: `fisheye(count, focalFor(i, y, …), room)[i].top === y` within
  0.5 px across a sweep.
- `spring1d`: settles at the target; carries an initial velocity past it
  at damping 0.8 and not at damping 1; a retarget mid-flight starts from
  the live value.
- `project`: `project(0) === 0`; sign follows velocity.

**Server** (`test/agent-http.test.js`): `GET /agent/asks` lists an open ask with
its `lead`; answering it removes it; the `*` stream carries `ask` then
`ask.resolved`.

**Browser** (`test-browser/agents-phone.test.js`, at 393 × 852 with
touch):

- Deck is the default view at phone width with no stored preference; a
  stored preference wins.
- A seeded ask renders as a card in NEEDS YOU with the conversation's
  title and a peek; tapping Allow posts `/answer` and the card is gone
  before the response arrives.
- A REVIEW row swiped right is marked reviewed; swiped left shows an Undo
  button and does not undo.
- Focus at phone width: exactly one `.focus-card[data-lod="full"]`; the
  `.pane` overlays it; the topmost card is a sliver when there are more
  than seven.
- Dragging the stack keeps the grabbed card under the pointer (probe
  measures its top against the pointer each frame).
- Shrinking the visual viewport (`--keyboard`) demotes the digests to
  chips and keeps the composer visible.
- Reduced motion: no element reports a running transform animation
  during a Focus step.
- Every control under `(hover: none)` is at least 44 pt tall.

The existing `agents-page`, `agents-focus`, `agents-folders`,
`agents-panes`, `agents-transitions` tests must pass unchanged; this adds
a view and a phone layout, it does not touch the four above 719 px.

## 12. Phase 2 — push, scoped separately

Without push this is a page you remember to open; with it an ask taps
your shoulder. iOS 16.4+ delivers Web Push to a web app on the Home
Screen, and Tailscale Serve already provides the HTTPS it requires. It
needs a `manifest.json`, a service worker, a VAPID keypair in
`.agent-keys.local`, `POST /agent/push` for subscriptions, and
`navigator.setAppBadge` for the count.

That sits against *the host ships no interface* and gets the treatment
`/favicon.svg` got: a named exception with its reason. A manifest is
metadata about installing a document; the worker ships no interface,
only a push-to-notification bridge. It is its own spec so Phase 1 ships
and works in plain Safari.

## 13. What we are not building

- Speech recognition (§4.2).
- *Allow all* (§4.4).
- A physics library. The spring is the desk's, made scalar.
- Multi-Full, Quick Look, cooling, or arranging on the phone (§6.5).
- Changing the data model. No new stored fields; `GET /agent/asks` is
  derived from state the runner already holds.
- Re-seeding live drives.
