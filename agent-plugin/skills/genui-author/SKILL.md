---
name: genui-author
description: Author an app space — a plain web UI whose design decisions are attributes with every option already implemented in CSS — so Jev can position it in one round trip. Use when asked to generate a UI, build a widget, or make an app space from a prompt.
---

# Author an app space

You are writing an HTML document for Jev to decide inside. Jev never generates;
it picks one of the options you implemented. So the document must hold every
option, implemented, and declare them.

**The result is plain web UI, not a Marble document.** It is served by the
Marble host and moved by it, but it must not use Marble's components or
affordances: no `<marble-alt>`, no `data-marble-editable`, `-choose`,
`-toggle`, `-step`, `-sortable`, `-transient`, no affordance script, no
`window.marble`. Ordinary HTML, CSS and — if the UI needs behaviour — ordinary
JavaScript. The one Marble attribute it carries is `data-marble-id` on each
instance root, because that is the address the host writes a decision to.

Two spaces. Space₀ is the Pattern Atlas: 119 entries, their dimensions,
sub-dimensions and named variations, at
`drive/Research/Design Pattern Generation/` (`atlas.json`, `schemas/<id>.schema.json`,
`genui/prompt.md`). Space₁ is what you write: the subset one app implements.
Jev positions within Space₁. You never invent a dimension; you choose which
Atlas dimensions are live here and implement their variations.

## The contract

1. **Instance roots.** Each pattern instance is one element with
   `data-genui="<atlas-id>#<name>"` and a `data-marble-id`. Nested instances
   (a card inside a grid, a stepper inside a wizard) are their own roots.
   Names are unique in the file. **A repeated role's root is the container
   that holds its stamped items** — the `.overview` holding the cards, the
   `.tiles` holding the tiles, the `.channels` holding the rows — never the
   first item. Write the fact once there; every item derives from it
   (`.overview[data-shape="horizontal"] .card {…}`). Sixteen games are one
   Card instance. Never copy a fact onto siblings.
2. **One sentence about it:** `data-genui-about="…"` — what this instance shows.
3. **Facts:** for each design decision you want Jev to make, one attribute on
   the root: `data-<key>="<slug>"`, where `<key>` is the Atlas sub-dimension key
   in kebab case (`openIn` → `data-open-in`, `overviewType` → `data-overview-type`).
   The value is the authored default — the first show if Jev never runs.
4. **Declarations:** `data-genui-<key>="slug | slug: gloss | …"`. A slug that
   matches an Atlas variation (slugified: lowercase, non-alphanumerics → `-`)
   needs no gloss; the codebook's own is used. A preset you invented (for a
   `sel: many` sub-dimension like attribute placement or widgets) needs
   `slug: gloss`, and the gloss must say what a person would see.
   Two or more options, or it is not a decision — fix one value and do not declare it.
5. **Implement every option in CSS.** A rule containing `[data-<key>="<slug>"]`,
   scoped under the root (`#games[data-open-in="pop-up"] .detail {…}`,
   `.overview[data-shape="horizontal"] .card {…}`), with the value spelled
   exactly as the slug. Build every alternative into the markup and let the
   attribute choose which shows: a modal *and* a side panel *and* a page, one
   visible. Unimplemented options are refused by the validator.
6. **Structure is a decision too.** Which sections exist and in what order is
   a live dimension when the Atlas has one for it (`arrangement`, `ia`,
   `composition`, `presentation`): implement it as CSS over whole sections
   (`#notifications[data-ia="tabbed-categories"] .section:not(.current) { display: none }`),
   not as a cosmetic tweak. Where a pattern's items should not all look the
   same, author a second role instance for the exception (`card#featured-card`
   for the first item) rather than varying items by hand.
7. **Coherence:** when two options across dimensions cannot both be true
   (`open-in=new-page` hides the overview, so `overview-type` is moot; a
   `modal` with `grouped-questions` is a wall), say so once on the root:
   `data-genui-excludes="open-in:new-page + overview-type:table | presentation:modal + density:grouped-questions"`.
   The gate keeps the more confident of the two.
8. **Bind content by role; never author content strings the data supplies.**
   Sample data is fine and should be realistic; invented copy standing in for
   a data path is not.
9. `data-genui-request="<the prompt, verbatim>"` on `<body>`.
10. Everything else is ordinary, good web UI: semantic elements, real buttons,
    keyboard reachable, responsive, works from a file with no host at all.

Three worked spaces to read before writing: `test/fixtures/genui/49ers.mrbl`
(overview–detail + card), `metrics.mrbl` (dashboard + stat-tile + chart),
`signup.mrbl` (wizard + stepper; `labels` on the wizard is form's, reached
through `specializes`).

## How to choose

- Pick the root pattern the way `genui/prompt.md` says: archetype → pattern,
  from `schemas/<id>.schema.json`. If the prompt names the root pattern (a
  generator will), use it. Otherwise choose from Monitor's Wave 3 list, not all
  60: `overview-detail`, `inbox`, `kanban-board`, `search-results`,
  `dashboard`, `chart`, `form`, `wizard`, `settings`, `ai-chat`, `calendar`,
  `media-player`, `checkout`. A checkout prompt is not forced through
  overview–detail. Prefer coded evidence when two fit equally.
- Spawn a child instance only from the pattern's `relations.uses`, or when a
  variation you implemented needs it (open-in = pop-up needs a modal; a grid
  needs a card; `widgets` including charts needs a chart). Spawn the role
  once, not once per item.
- Make a sub-dimension live only if a reasonable person or context would move
  it: layout and arrangement, density, what opens where, what a card shows.
  Everything else: one authored value, no declaration.
- Two to six options per live decision. More is a menu, not a decision. Options
  should be visibly different from one another *and* from their glosses' point
  of view — if you cannot say in one sentence when Jev should pick A over B,
  A and B are one option.

## Extending a space you did not write

When asked to *extend* an existing space for a signal ("add a way to mute
things fast"): edit that document in place — add one live dimension or one
option, implement it, keep every existing fact and declaration untouched, and
re-run the validator. Do not rewrite the document; the person's positions
and pins live in it.

## Verify before you stop

```
node bin/marble-drive.js genui space "<doc path>"
```
must print `ok`. Fix every issue in the document — never by weakening the
declaration.

```
node bin/marble-drive.js genui decide "<doc path>" --dry '--context={"viewport":"phone","items":6}'
node bin/marble-drive.js genui decide "<doc path>" --dry '--context={"viewport":"desktop","items":30}'
```
Read the confidences. A decision that is near-uniform in every context (all
options around 1/n) means the options are indistinguishable from their
glosses, or the dimension should not be live. Fix the document: sharpen the
glosses, drop an option, or fix the value and remove the declaration. Do not
add a question, a split, or a longer prompt to paper over a space that is not
a space. A decision that moves with context — list on a phone, grid on a
desktop — is the space working.

Say what you made in three lines: the instances, the live decisions, and the
one you are least sure Jev can tell apart.
