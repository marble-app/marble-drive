# Agents — the four views, made usable

> Status: **approved to build**, 2026-09-18. Repairs and raises
> `2026-09-17-agents-folders-focus-design.md`, which shipped the data model
> and the chrome but left Focus's layout and Folders' workspace unreachable.

Same UIST warm / Dusk tokens. No new npm dependencies. Node 22. Do not
reparent the file's `<marble-conversation>` (reconcile would clone it).

## 1. Why

Every fault below was measured in a seeded drive, not inferred. The two
tools that measured them ship with this change:

| Tool | What it does |
|---|---|
| `test-browser/shots.js` | Screenshots the four views against a realistic ten-conversation drive. `--narrow`, `--dark`. |
| `test-browser/probe.js` | Prints measured card rects, basin rects, dock state, and what a click actually did. |

Neither is a test. They are a seeing loop, and they are why this spec can
name coordinates.

## 2. The faults

### 2.1 Motion

`setView`'s `crossfade()` animates both shells with **no `easing`**, so
the Web Animations default — `linear` — is what ships. The spec called for
ease-out.

Two further problems in the same six lines:

- `applyLayout()` runs **before** the fade starts, so the shell that is
  "fading out" has already been re-laid-out. The crossfade shows the new
  layout dissolving into itself.
- Both shells run `0 → 1` and `1 → 0` over the same 150 ms. At the midpoint
  both sit at 0.5 and the page background shows through. A dip.

### 2.2 Folders — the workspace is unreachable

`restoreFolderDock` is correct and `applyDock` fills the dock. The header
click never gets there: `.folder-name` is `flex: 1` and calls
`stopPropagation()`, so it swallows the click across almost the whole
header.

Measured on a three-conversation Research folder:

| Click | `editing` | `active` | `.dock-leaf` | `marble-conversation` |
|---|---|---|---|---|
| Header center | `true` | `null` | 0 | 1 |
| Header right edge, −6px | `false` | `Research` | 2 | 3 |

Rename is the default gesture. Opening the folder — the reason the view
exists — is a ten-pixel sliver.

The rail is also informationally bare: a tab is a title and nothing else.
No status, no target, no time, no folder color.

### 2.3 Focus

**Phantom Full band.** `paintFocus` calls `defaultFocusRect(..., fullIds.length || 1)`.
The `|| 1` is meant to keep `focusLodSize` from dividing by zero, but
`defaultFocusRect` reads the same argument as "how many Fulls to reserve
room for". With nothing pinned it reserves a full row anyway:
`below = 20 + fullH * fullRows + 20` ≈ 420 px.

Measured: on an 843 px canvas with zero Fulls, the topmost card sits at
**y = 428**. The top half of the view is dead space.

**Stray pane chrome.** With no Full, `layoutFocusPane` calls
`clearFocusPane()`, which removes the inline positioning but leaves `.pane`
displayed — `body[data-view="focus"] .library { display: block }` keeps it
on. Measured at `[0, 56, 1440, 202]`: the composer and its provider pills
laid across the top of the canvas, over the dead band.

**Basins overlap.** A basin is the bounding box of its members, and the
members are placed by a free pack that knows nothing about folders. So the
boxes intersect and spill off-canvas:

```
Research  [ -2, 402,  556, 444 ]
Marble    [290, 402,  892, 244 ]
                ^^^^^^^^^^  x 290..554 belongs to both
```

A negative left edge, and a region that is simultaneously two folders. A
bounding box cannot be a container unless something guarantees the members
are together. Nothing does.

**Chips on the sill.** `chipY = canvas.h - size.h - 16` puts every chip in
one row hard against the bottom edge, and a row wider than the canvas
simply runs off it.

**Hollow digests.** A digest card is 280×200 holding
`target · status · activity` joined into one muted run-on line. Three lines
of text in a 200 px box, no hierarchy, no tone on the status.

### 2.4 Board

- Columns are `flex: 1 1 0` and the *board* scrolls, not the column. A
  2 / 0 / 8 split gives one column of dead space beside one that overflows
  the viewport.
- `columnFor` buckets on `statusOf`, which maps anything not running and
  not needing review to `completed`. A conversation whose `lastOutcome` is
  `error` files under **Completed**, its failure visible only as muted grey
  activity text.
- No counts.

### 2.5 List

- `conversationTags` puts the provider label first on every row. When every
  conversation uses one provider — the normal case — the loudest element in
  the list is a word repeated identically ten times.
- The **target path** — the one fact that tells two rows apart — is not
  rendered in List at all.
- `age()` returns `Math.round(s / 60) + 'm'`, so everything under 30
  seconds reads `0m`.
- Folder colour, which exists in the data, appears nowhere.

## 3. Principles

1. **A container is a partition, not a hull.** If a region means "these
   belong together", layout must place them together. Basins get allocated
   space; cards pack inside it.
2. **The default gesture is the common one.** Opening a folder is what
   people do; renaming is what they do once. Click opens; double-click
   renames.
3. **Repeat nothing.** A value identical on every row is chrome, not
   information. Demote it and promote what differs.
4. **Reserve space only for what exists.** No Fulls, no stage.
5. **Motion follows the existing vocabulary.** Ease-out for layout,
   springs only behind a gesture. `prefers-reduced-motion` keeps 150 ms
   opacity and no travel.
6. **Same tokens as Drive.** No new palette.

## 4. Motion

One curve, shared:

```
--t-view: 200ms;
--ease-out: cubic-bezier(0.22, 0.61, 0.36, 1);
```

`crossfade()` becomes asymmetric so there is no midpoint dip:

| Shell | Keyframes | Duration | Easing |
|---|---|---|---|
| Outgoing | `1 → 0` | 0–40 % of 200 ms | ease-out |
| Incoming | `0 → 1` | 30–100 % of 200 ms | ease-out |

The outgoing shell is measured and frozen **before** `applyLayout()` runs,
so it fades showing the layout it actually had.

Reduced motion: 150 ms opacity, both shells, no offset — today's behaviour,
which the existing tests assert.

The List ↔ Board FLIP keeps `420ms ease-out` with its 18 ms stagger. It was
never the problem.

## 5. Focus — stage and field

The canvas becomes two bands. Either may be empty.

```
┌─ stage ────────────────────────────────────────┐   present only when
│  [ Full ]   [ Full ]                           │   something is pinned
├─ field ────────────────────────────────────────┤
│ ┌ Research ─────────┐ ┌ Marble ──────┐ ┌ ... ┐ │   regions, side by side,
│ │ [dg] [dg]         │ │ [dg]         │ │     │ │   never overlapping
│ │ [chip] [chip]     │ │ [chip] [chip]│ │     │ │
│ └───────────────────┘ └──────────────┘ └─────┘ │
│ ungrouped: [dg] [chip] [chip]                  │   no pad, last
└────────────────────────────────────────────────┘
```

### 5.1 Stage

Present only when `fullIds.length > 0`. Height is
`min(canvas.h * 0.52, 460)`, full width, Fulls tiled left to right (two
columns once there are three or more, as today). **With zero Fulls the
stage has zero height** and the field owns the whole canvas — the phantom
band is gone, because the count passed to the layout is the real count,
not `|| 1`.

`.pane` is hidden outright when there is no primary Full:
`pane.style.display = 'none'` in `clearFocusPane`'s no-Full path, not just
cleared positioning. That removes the stray composer.

### 5.2 Field regions

Folders present among the matching cards are allocated regions across the
field, in catalog `order`. Each region's width is proportional to its
members' packed area, floored at one digest column plus padding. Ungrouped
cards get the last region and draw no pad.

Within a region, cards flow: digests first in a grid at the region's
width, then chips wrapping beneath. A region is exactly the box its packed
contents occupy plus 18 px of pad — which is now a container, because the
packer put the members inside it.

If the regions' natural widths exceed the canvas, the field wraps to a
second row of regions and the canvas scrolls vertically. Chips no longer
have a special bottom-edge rule; they wrap like everything else.

`focusX` / `focusY` remain honoured, but as an **ordering hint within the
card's own region** rather than raw coordinates: cards sort by `oy` then
`ox`, stably, so a card dragged upward moves up the region and one never
dragged keeps its place. Free coordinates inside a region would reintroduce
the overlap the partition exists to prevent, and arranging chats by hand is
a chore with little return. Dropping a card into another region is what
changes `folderId` — the same PATCH as today.

Within a region cards lay out **oldest first**. The list sorts by recency,
but a canvas that reorders itself every time a chat ticks destroys the
spatial memory that makes Focus worth using, and arrow keys navigate by
screen position, so layout order is the order they move through.

Column counts are a **fair share of the shelf** plus a greedy top-up to the
group stacking deepest — not a per-group `sqrt`, which squares each group in
isolation and folds three cards into an L when one row would have fitted.

### 5.3 Digest content

A digest card stops being one run-on string:

```
┌──────────────────────────────┐
│ ● CHI 2027 related work pass │  title, status dot in status tone
│ Research/CHI2027 — Elici…    │  target, faint, path-tail-truncated
│ reading Hollan 1985          │  activity, ink
│ running · 4m                 │  status word in tone, then age
└──────────────────────────────┘
```

Size drops to 260×132 — enough for four lines, so the card is full rather
than a third full. Chips stay 168×56.

### 5.4 What does not change

Select / pin / Quick Look / keyboard / cooling all keep the behaviour in
the folders-focus spec and its tests. `assignLods` is untouched. The
springs are untouched. This section changes **where cards go**, not what
they are.

## 6. Folders

### 6.1 The header

| Gesture | Was | Becomes |
|---|---|---|
| Click anywhere on header | rename | **open the folder** |
| Double-click the name | — | rename |
| `Enter` on focused header | open | open |
| `F2` / rename button | — | rename |
| Click the colour tick | palette | palette (unchanged) |

`.folder-name` stops calling `stopPropagation()` on click and stops
listening for `click` at all; it listens for `dblclick`, matching
`.focus-basin-name`, which already worked this way. The two name fields in
the app now agree.

While a name is being edited, the header's click handler is suppressed —
the existing `.folder-name[contenteditable]` guard already covers this.

### 6.2 The rail tab

A tab gains the facts that make the rail scannable, in one line plus one:

```
│ ● Figure 3 redraw          4m │   status dot in tone, title, age
│   Research/CHI2027 — Elici…   │   target, faint
```

Folder colour rides the tab's leading edge as a 2 px rule, so a tab is
legible as a member of its group even when the rail is scrolled past the
header.

The active folder's group gets `marble-active` applied on open — which
`activate()` already does — and the CSS for it already exists at
`.folder-group.marble-active .folder-header`. It simply was never reached.

## 7. Board

- `.column` becomes `min-height: 0; overflow-y: auto` inside a board that
  no longer scrolls on its own account, so a long column scrolls in place
  and a short one does not stretch the page. The `h2` sticks.
- Each `h2` carries a count. `:has()` already derives emptiness; the count
  is one `textContent` in `paintRow`'s wake.
- A card's leading edge takes its folder colour, the same 2 px rule as the
  rail tab, so Board and Folders read as the same objects.

**Correction, found while building.** §2.4 claimed an `error` outcome files
under Completed. It does not. The outcome vocabulary is `changes`, `failed`,
`interrupted`, `watchdog` (`server/agent/store.js`), `needsReview` already
covers `failed` and `watchdog`, and `statusOf` already maps those to the
review column — correctly dropping back to Completed once reviewed. The
seed data used a value (`error`) that is not in the vocabulary, so it fell
through to Completed. The seed was wrong, not the router. `columnFor` is
left alone; the fixtures now use real outcomes, and the danger tone is wired
to `[data-outcome="failed"]`, which is what the code writes.

## 8. List

- Row becomes: status dot · title · age on line one; target path on line
  two; activity on line three, dropping to two lines when there is no
  activity.
- The provider keeps its tag — `agents-page.test.js` asserts a row names its
  agent, and that is a deliberate contract, not an oversight — but gives up
  the filled pill and shares the last line with the activity. It reads as
  context instead of as the headline. (The first attempt dropped the tag
  when every conversation shared a provider; that broke the contract, so it
  was reverted in favour of restyling.) In Focus, where a chip has room for
  one tick of context and no test governs it, the constant provider name is
  replaced by the age.
- Folder colour on the leading edge, as above.
- `age()` gains a `< 45 s → 'now'` case.

## 9. Files

| Unit | Change |
|---|---|
| `templates/agents.mrbl` | Motion tokens and `crossfade`; Focus stage/field layout and digest markup; folder header and tab gestures; board columns; list row. |
| `runtime/agent-folders.js` | `packRegions(groups, canvas)` — the partition. Pure, exported on `marbleAgentFolders`, unit-tested in Node. |
| `runtime/agent-ui.js` | A `data-chrome="tile"` density for a pane sharing the screen, so only the focused pane in a folder carries the status line and pickers. |
| `test-browser/shots.js` | New. The seeing loop. |
| `test-browser/probe.js` | New. The measuring loop. |
| `docs/AGENTS.md` | Document the header gesture change. |

`drive/Agents.mrbl` is seed-once, so the live copy does not pick this up
from the template. It is replaced by hand after the browser tests pass,
one write then verify, per the editing-while-served hazard.

## 10. Testing

**Node.** `test/agent-folders.test.js` gains `packRegions`: regions never
overlap, every card lands inside its own region, ungrouped is last, a
region is at least one digest wide, and the partition is stable under a
canvas resize.

**Browser.** The existing `agents-focus.test.js`, `agents-folders.test.js`
and `agents-page.test.js` must keep passing unchanged — they encode the
behaviour §5.4 promises not to touch. Added:

- No Fulls → the topmost card sits above `canvas.h * 0.25`, and `.pane` is
  not displayed.
- Two folders → their basin rects do not intersect, and no rect has a
  negative edge.
- Clicking a folder header opens it: `marble-active` is set and
  `.dock-leaf` count matches `openIds`.
- Double-clicking a folder name enters edit mode and does **not** open.
- An `error` outcome lands in the review column.
- View switch: the crossfade's animations report `ease-out`, not `linear`.

## 11. What we are not building

- Nested folders, pointer-fisheye sizing, LLM-written digests — all still
  out, per the previous spec.
- A physics library. The partition is arithmetic.
- Changing the data model. No new fields, no new routes, no migration.
- Re-seeding live drives automatically.
