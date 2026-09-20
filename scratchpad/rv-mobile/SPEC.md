# Research Vision on a phone — the diagnosis, and what we are building

Measured on the real document at 390×844 (iPhone 14/15 logical size), via
`scratchpad/rv-mobile/look.mjs`. Every number below is observed, not estimated.

## What is actually wrong

| # | Finding | Evidence |
|---|---|---|
| 1 | **The rail is a wall.** `.rail` is 850px tall on an 844px viewport. A phone opens the document on one full screen of navigation and zero content. | `railHeight: 850` |
| 2 | **The first idea is two screens down.** In the default Spine view the first card's top is 1744px from the top of the document. | `firstCardTop: 1744` |
| 3 | **The main control gives no feedback.** Tapping any of the 8 view buttons changes `data-arrange`, but the pool it rearranges is ~900px below the fold, so the screen does not visibly change. The document's central verb appears broken. | screenshots `before-390-board.png` / `before-390-map.png` are pixel-identical above the fold |
| 4 | **The band eats half the screen, permanently.** `.band-wrap` is `position: sticky` and 421px tall at 390px wide — 50% of the viewport — because its 4 cards wrap onto 4 rows. | `bandHeight: 421` |
| 5 | **Chips sit on top of titles.** `.now-ref-form` is absolutely positioned with only `padding-right: 3.2rem` reserved; two-line titles run under it. | "Generating Design Pattern**s**" clipped by the ABSTRACT pill |
| 6 | **Touch targets are half the minimum.** `.now-ref-x` 18×18, `.field-btn` 20×20, `.chip` 19px tall, dial buttons 26px tall. The floor is 44×44. | `tooSmallTargets` |
| 7 | **Nested sideways scrollers with no affordance.** Board 682px, Now 682px, Timeline 1126px of horizontal scroll inside a vertically scrolling page — no snap, no peek, no indicator, nothing that says a column is a column. | `poolScrollsX` |
| 8 | **Map is an absolutely positioned canvas**, 612px wide, unreadable and un-pannable at 390px. | `poolScrollsX: 612` in `map` |
| 9 | **The instructions are for a mouse.** The 240-word `.rail-note` — grips, drag, drop, Shift-drop, arrow keys, Mod+Z — describes interactions that do not exist on touch, and occupies the prime position above the content. | markup |
| 10 | **`+ Idea` overlaps the first card** in the 1-column Spine packing. | `before-scroll.png` |

The through-line: this document was designed as a wide two-pane workspace —
persistent rail, persistent band, multi-column pool — and a phone has room for
exactly one of those things at a time. Nothing about the *ideas* is wrong. The
chrome is what does not fit.

## The direction

**One rule: on a phone, content is the page and chrome is summoned.**

The eight views are this document's main verb. On a phone the main verb belongs
under the thumb, permanently visible, and tapping it must visibly change what
you are reading — which is the single most broken thing today. Everything else
(arrange, focus, show, the note, the title) is a second-order dial and belongs
behind a disclosure.

### Decisions already made (do not relitigate)

- **Breakpoint is `@container doc (max-width: 720px)`**, never `@media`. `<html>`
  is `container: doc / inline-size`; a host that docks a panel shrinks `<html>`
  and leaves the viewport alone, so a media query would insist on room that is
  no longer there. Touch-only rules additionally gate on `@media (hover: none)`.
- **No control is duplicated.** The phone chrome re-lays-out the *existing* rail
  markup with CSS. The view list becomes the bottom bar; the rail itself becomes
  the sheet. We do not clone `[data-preset]` buttons into a second bar — that
  would be the same fact in two places, and the document's script derives the lit
  state from `data-arrange` for every `[data-preset]` it finds.
- **The band stops being sticky on a phone** and becomes a single-row horizontal
  snap strip. Sticky chrome on a phone must earn its pixels; the band is a
  reference list, and its reason for being pinned — as a drag target — does not
  exist on touch.
- **Map falls back to a readable arrangement on a phone.** A 612px free canvas at
  390px is not a map, it is a mess.
- **44×44 minimum hit area, achieved with an absolutely positioned `::before`
  expander** so the *visual* size of every pill and chip is unchanged. The design
  of this document is its typography; we are not making it chunky.

## Marble rules that bind all of this

Read `marble:build-in-marble` first. The ones that will bite:

- **Never change or drop a `data-marble-id`.** They are how links, comments and
  history find an element.
- **All new CSS is additive** — a new `<style data-marble-id="…">`, never a
  rewrite of the existing sheet. Your deliverable is a CSS block, so just write
  rules; do not restate or edit existing ones.
- **Any chrome you create in script is `data-marble-transient`** — it belongs to
  the page, not the file, and must not land in the saved document.
- **The file must still work with no host.** Guard every `window.marble` use.
- **Derived state goes in a `marble-`prefixed class** and is re-derived from
  `marble.register(fn)`, because a reconcile against the file is exactly when a
  derived class has just been lost.
- **Every `:hover` that reveals something needs a `@media (hover: none)` answer.**
- Respect `@media (prefers-reduced-motion: reduce)`.
- Use the document's existing vocabulary: `--ink`, `--ink-2`, `--muted`,
  `--faint`, `--line`, `--hair`, `--paper`, `--card`, `--accent`,
  `--accent-soft`, `--accent-ink`, `--r`, `--r-2`, `--serif`, `--sans`. Never a
  hard-coded colour — dark mode is a `prefers-color-scheme` block that rewrites
  exactly those variables, so a literal hex will not follow it.
- Respect the safe area: `env(safe-area-inset-bottom)` on anything fixed to the
  bottom, or it sits under the home indicator.

## How to work

Your workspace is `scratchpad/rv-mobile/ws-<name>/`. It holds a read-only copy
of the document (`rv.html`) and a server that injects your `part.css` and
`part.js` into it. **Edit only `part.css` and `part.js`.** Never edit `rv.html`
— three other agents are working on their own copies of the same document and
the integration step is mine.

```
cd scratchpad/rv-mobile/ws-<name>
# your server is already running on your port
node look.mjs <port> out 390 844 <preset>     # writes out.png + measurements
```

`look.mjs` prints `tooSmallTargets`, `overflowing`, `overlaps`,
`pageOverflowPx`, `bandHeight`, `railHeight`, `firstCardTop` and any page
errors. **Look at the PNG with the Read tool every iteration.** Do not reason
about what the CSS probably does — the whole point of the harness is that you
can see it. Iterate until the screenshot is something you would ship.

Check these widths before you finish: **390** (phone), **430** (large phone),
**744** (tablet, just above our breakpoint — must be *unchanged* from today),
**1440** (desktop — must be *unchanged* from today). Breaking the desktop layout
is the one unacceptable outcome.

## Deliverable

Leave `part.css` and `part.js` in your workspace, finished and commented in the
document's own voice (it explains *why*, in prose, not *what*). Then reply with:

1. What you changed and the reasoning behind each decision.
2. The before/after numbers from `look.mjs`.
3. Anything you found that belongs to another agent's scope (say so, do not fix it).
4. Any risk you know about in what you wrote.
