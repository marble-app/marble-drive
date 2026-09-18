---
name: genui-author
description: Author an app space — a Marble document whose design decisions are attributes with every option already implemented — so Jev can position it in one round trip. Use when asked to generate a UI, build a widget, or make an app space from a prompt.
---

# Author an app space

You are writing a `.mrbl` for Jev to decide inside. Jev never generates; it
picks one of the options you implemented. So the document must hold every
option, and declare them. Read `build-in-marble` first — every rule there holds.

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
5. **Implement every option.** A CSS rule containing `[data-<key>="<slug>"]`,
   scoped under the root (`#games[data-open-in="pop-up"] .detail {…}`,
   `.overview[data-shape="horizontal"] .card {…}`), or a
   `<marble-alt>` under the root with a `data-marble-alt="<slug>"` child per
   option. Unimplemented options are refused by the validator.
6. **Bind content by role; never author content strings the data supplies.**
   Sample data is fine and should be realistic; invented copy standing in for
   a data path is not.
7. `data-genui-request="<the prompt, verbatim>"` on `<body>`.
8. Everything else is ordinary Marble: every element addressable, editable
   text marked editable, the file works with no host.

Three worked spaces to read before writing: `test/fixtures/genui/49ers.mrbl`
(overview–detail + card), `metrics.mrbl` (dashboard + stat-tile + chart),
`signup.mrbl` (wizard + stepper; `labels` on the wizard is form's, reached
through `specializes`).

## How to choose

- Pick the root pattern the way `genui/prompt.md` says: archetype → pattern,
  from `schemas/<id>.schema.json`. The root set you choose from is Monitor's
  Wave 3 list, not all 60: `overview-detail`, `inbox`, `kanban-board`,
  `search-results`, `dashboard`, `chart`, `form`, `wizard`, `settings`,
  `ai-chat`, `calendar`, `media-player`, `checkout`. A checkout prompt is not
  forced through overview–detail. A prompt that names an activity rather than
  a widget goes through the archetype first (`taxonomy.json`), then its
  patterns. Prefer coded evidence when two fit equally.
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
