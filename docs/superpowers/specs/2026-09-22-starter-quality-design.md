# Starters people could actually ship

2026-09-22. Bryan, after the gallery started showing the starters as pictures of
themselves: *"improve the engineering, the responsiveness/mobile support and
overall usability of all of these templates and all the robustness of them…
professional grade ready-for-production apps."* LaTeX and ACM paper are already
good and are not touched.

Six in scope: **doc, note, sheet, board, canvas, slides**. This spec is the
contract all six are built to, so that six people working separately produce one
system rather than six opinions. Each starter also has its own brief; where the
two disagree, this one wins.

## The thing that must not be lost

`docs/GALLERY.md` says it: *the first six are small enough to read in a sitting,
because the first thing anyone does with a starter is change it.* A starter is
not a product, it is a **thing you clone and then edit**, and the person editing
it has to be able to find their way around the file in an afternoon.

So "production grade" here does **not** mean more code. It means:

- the behaviour that a real app would be embarrassing without, present;
- the behaviour that is already in the affordance library, *used* rather than
  half-rebuilt;
- nothing that works only on a 1400px desktop with a mouse;
- nothing that breaks when the content is empty, enormous, or pasted.

**Budget: `sheet`, `board`, `canvas`, `slides` stay under 600 lines each.** If a
feature cannot be had inside the budget, it is not had. `doc` (2197) and `note`
(1446) are already past that; they get a polish pass, not a rewrite, and must not
grow by more than ~15%.

## 1. Tokens — one block, copied exactly

Every starter's `:root` is replaced by the block below, taken from
`drive/Design System.mrbl`. Today each starter declares a light palette and
repeats it inside `@media (prefers-color-scheme: dark)`; `light-dark()` says it
once, and a token that exists in one scheme and not the other becomes impossible.

```css
:root {
  color-scheme: light dark;
  --ink: light-dark(#111111, #e8e6e1);
  --muted: light-dark(#5a5a5a, #a3a7ab);
  --faint: light-dark(#8a8a8a, #71767a);
  --placeholder: light-dark(#767676, #8d9296);
  --line: light-dark(#e6e2d8, #272c30);
  --paper: light-dark(#ffffff, #1c1f22);   /* a document is white to the edge */
  --paper-2: light-dark(#f7f6f2, #212528);
  --well: light-dark(#f3f1ea, #16181a);
  --card: light-dark(#ffffff, #22262a);
  --accent: light-dark(#9bb6cf, #7fa8c9);
  --accent-soft: light-dark(#f1f5f8, #1d2932);
  --accent-ink: light-dark(#738698, #9dc0dc);
  --danger: light-dark(#b4533e, #e08a74);
  --caution: light-dark(#a07a2c, #d9b25e);
  --shadow: 0 1px 2px light-dark(rgba(74,66,52,.05), rgba(0,0,0,.28)), 0 2px 4px light-dark(rgba(74,66,52,.03), rgba(0,0,0,.18));
  --shadow-lift: 0 2px 6px light-dark(rgba(74,66,52,.07), rgba(0,0,0,.32)), 0 8px 18px light-dark(rgba(74,66,52,.08), rgba(0,0,0,.26));
  --r: 12px; --r-sm: 8px; --r-text: 4px; --pill: 999px;
  --ease-out: cubic-bezier(.22, 1, .36, 1);
  --ease: cubic-bezier(.22, .61, .36, 1);
  --snap: cubic-bezier(.4, 0, .2, 1);
  --t-fast: 110ms; --t: 200ms; --t-slow: 340ms;
  --ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --serif: ui-serif, "New York", "Iowan Old Style", Palatino, Georgia, serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
}
```

Two deviations from the drive's own block, both deliberate and already the
starters' rule: **`--paper` is white**, because the off-white belongs to the
interface and a document is white to the edge; and the font stack is the
platform's, because **no document names a webfont**.

Nothing else in a starter may hold a raw hex. One accent does all the accenting.
`--danger` is for the one word the accent cannot say, and appears on a delete and
nowhere else.

## 2. Width is asked of the root, never the window

```css
html { container: doc / inline-size; }
```

and every breakpoint is `@container doc (max-width: …)`, **not**
`@media (max-width: …)`.

This is not a style preference. A Marble host docks a panel beside the page by
shrinking `<html>`; the viewport does not change. Every `@media (max-width)` in a
starter today is a layout that will be wrong the moment somebody opens the agent
drawer next to it. `doc` already does this and is the model.

Three sizes each starter must be correct at, and they are what the tests drive:

| | |
|---|---|
| **390px** | a phone. One thumb, no hover, no keyboard until asked. |
| **740px** | a tablet, or a desktop with the drawer pinned open. |
| **1280px** | the whole window. |

`@media (prefers-color-scheme: …)` is gone entirely — `light-dark()` does it.
`@media (hover: none)`, `(pointer: coarse)`, `(prefers-reduced-motion: reduce)`
stay: those are facts about the hand and the person, not about width.

## 3. The hand

From `/apple-design`, and non-negotiable:

- **Every press answers on the way down.** `:active { transform: scale(.97) }`
  at `--t-fast`, never a change that waits for `click`.
- **44×44 minimum** for anything a finger commits with, under
  `@media (pointer: coarse)`. A 30px `+ card` button is the current state of
  three of these and it is the single most common defect.
- **A drag tracks 1:1 and is interruptible.** The `sortable`, `canvas` and
  `resizable` parts already do this properly — use them rather than writing a
  seventh pointer handler.
- **`prefers-reduced-motion: reduce` gets a cross-fade**, no travel, no scale,
  no overshoot. One block at the end of the stylesheet.
- **Nothing hides behind hover alone.** A control revealed on `:hover` must also
  be reachable by `:focus-within` and must be permanently visible under
  `@media (hover: none)`.
- **Safe areas**: `padding-bottom: max(<n>rem, env(safe-area-inset-bottom))` on
  anything that sits at the bottom of a phone screen.

## 4. Use the vocabulary

`lib/affordances.js` ships: `editable, removable, sortable, canvas, resizable,
add, alternatives, state, reversal, history, status` (plus `shared`, `grip`,
`tail`, which are automatic). A starter's parts list is in `STARTERS` in
`server/gallery.js`.

**Four of the six cannot undo.** `sheet`, `board`, `canvas` and `slides` ask for
`['editable','sortable','removable','add','status']` — no `history`, so Mod+Z
does nothing in them. That is the worst robustness bug in this set and it is a
one-word fix per starter. **Every starter gets `history`.**

Then use what is already written instead of hand-rolling it:

- **`state`** — `data-marble-toggle` (a checkable row), `data-marble-choose` /
  `data-marble-value` (a view switcher), `data-marble-expand` /
  `data-marble-controls` (a disclosure), `data-marble-step` / `data-marble-by`
  (a counter), `data-marble-note` / `data-marble-note-body`. Each files a real
  op and each is undoable. A hand-rolled checkbox is a bug with a nicer name.
- **`resizable`** — `data-marble-resizable`, for anything that answers "how big".
- **`reversal`** — draws a way to reach the undo history that the carrier is
  already keeping. Worth it wherever a gesture destroys something.

Adding a part costs a line in `server/gallery.js` and nothing else. If you add
one, say why in the comment beside it, in the voice the file already uses.

## 5. Robustness

Every starter is checked against all of these, and a test covers the ones marked †:

- **Empty** † — every list emptied by hand. An empty column, an empty deck, an
  empty sheet, a canvas with no notes. Each needs a drawn empty state that says
  what to do, and the app must not collapse to a 0px box.
- **Full** — 60 rows / 40 cards / 30 slides. No layout that only works at 3.
- **Long words** — a 200-character unbroken string in any editable. `overflow-wrap: anywhere`
  on every editable; nothing may push the layout sideways.
- **Paste** † — pasting rich text into a `data-marble-editable` must land as
  plain text (the part uses `plaintext-only`; confirm it, don't assume it).
- **Undo** † — every gesture the app offers, undone with Mod+Z and redone,
  ending byte-identical to where it started.
- **Reload** † — the document reloaded after each gesture shows the same thing.
  Nothing that matters may live only in the page.
- **Two windows** — the document open twice; a change in one appears in the
  other. This is the carrier's job, but a starter can break it by keeping state
  outside the file.
- **The doctor is clean** — `check_document`, or `examine(path, source)` from
  `server/engine.js`, reports **zero errors**. Warnings must each be either fixed
  or justified in a comment at the line they are about.
- **No console error, ever**, on load or on any gesture, at any of the three
  widths.

## 6. What a starter may not do

- Write page state into the file. A hover, a selection, a focus, an open menu,
  a "which view am I in" that is genuinely the person's attention — these are
  `data-marble-transient` chrome or `marble.pageOnly(...)` attributes. If it
  should survive a reload for *everyone* who opens the file, it is content and
  it is filed; if it dies with the tab, it never touches the file.
- Ship a class toggled at runtime without the `marble-` prefix. The doctor says
  so, and it is right: a reconcile drops it.
- Name a route, a host, or a webfont.
- Grow a second source of truth for something the markup already says. The
  sheet's column count is one custom property *because* two copies would drift.

## 7. The two things none of them do

Found by reading all six: not one starter has either of these, including the two
that were otherwise in good shape.

**Printing.** `grep -c "@media print"` is `0` across the set. The `doc` starter
draws an 8.5in page with a ruler and margin markers and cannot be printed onto
one; a deck cannot be handed out; a sheet cannot go on a wall. A `@media print`
block that drops the chrome, unwraps the scroller, lets content break across
pages, and prints the paper white regardless of scheme is a small block and the
difference between a document and a demo. Every starter that has a page gets one.

**The phone keyboard.** No starter mentions `visualViewport`. On a phone the
software keyboard does two things and the second one is the one everybody
misses: it **shrinks** the viewport *and* **scrolls** it, so a toolbar pinned to
the bottom ends up under the keyboard and the caret ends up behind it. Both
halves are needed:

```js
const vv = window.visualViewport;
const sync = () => {
  document.documentElement.style.setProperty('--kb', `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
  document.documentElement.style.setProperty('--vv-top', `${vv.offsetTop}px`);
};
vv?.addEventListener('resize', sync);
vv?.addEventListener('scroll', sync);
```

Anything anchored to the bottom then sits at
`bottom: calc(var(--kb, 0px) + max(0px, env(safe-area-inset-bottom)))`. This
applies to `doc` and `note` first, because they are the two you type into for an
hour, and to anything else that anchors a control to the bottom of the screen.

## 8. Done means

1. `node --test --test-reporter=spec test/gallery.test.js` passes.
2. `node --test --test-concurrency=1 --test-reporter=spec test-browser/starter-<id>.test.js`
   passes, and that file covers the † items above plus whatever is particular to
   this starter.
3. `examine()` reports zero errors on the built starter.
4. Screenshots at 390 / 740 / 1280, light and dark, look like one family and like
   something somebody would ship.
5. The file is inside its budget and still reads like the file it was.
