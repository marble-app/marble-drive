# Focus: an unlimited stage, and a field that folds

2026-09-19. Bryan, looking at a Focus canvas that was scrolling sideways:

> I should be able to have an unlimited number of focused panels, there's a max
> of 4 that is set right now, and i don't want that limit. those only get
> unfocused when I replace the focused set of things. This also means that the
> visual compacting of other unfocused things such as groups need to get more
> unfocused and more compressed, such as the ungrouped group needs to turn into
> like a pile that's just a small group like a folder thing or something,
> something small like that. […] Right now, it's scrolling, but i don't want any
> horizontal scrolling to see these things, focused should just be all in one
> screen, making things smaller and smaller to account for the space that i want
> when there are things i want focused.

Three asks, and they are one ask. The cap of four existed because four panes at
reading width is all a laptop canvas holds — so lifting the cap only means
something if the canvas can find the width somewhere else. It finds it by
compacting what is *not* focused, and the compaction has to reach further down
than it did.

## What was true before

- `FULL_CAP = 4` in `runtime/agent-folders.js`, applied in six places in
  `templates/agents.mrbl`: the pinned set, both lenses, keep-open, and the two
  stage-drop paths. A fifth pin silently unpinned the least-ranked one.
- `reconcileTree` on the Focus stage always did `insertAtRoot(…, 'right')` — a
  new pin is a new column, forever. Four columns was fine because four was
  the cap.
- `packFocus` negotiated stage against field at φ, clamped by `PANE_MIN` (300)
  and `FIELD_MIN` (196), and when neither floor could be met it returned
  `width > canvas.w` and let the canvas scroll. That is the scrolling in the
  screenshot.
- The field's compaction ladder was two rungs: digest → chip. A group of chips
  still costs a full sub-column of width, forever.

## What is true now

### The stage has no ceiling

`pinnedIdsOf` and both lenses return every matching chat. Keep-open retires
nothing. Dropping on the stage, on a pane edge or between columns, adds without
removing. A chat leaves the stage when you take it off — closing its pane,
collapsing its card, unpinning — and at no other time.

The cap survives in one place on purpose: the Folders view's `openIds`, which
is a different thing (how many panes opening a folder opens). It was not what
the screenshot was about.

### The stage grows downward once it is as wide as it goes

`maxStageColumns()` is how many `PANE_MIN` columns fit once the rail of piles
has taken its width. Below it, a new pin is a column on the right, as before.
At it, the pin stacks under the column holding the fewest panes
(`shortestStageLeaf`), so ten pins on a laptop are two rows of five, not a row
of ten nobody could read. `defaultTree` takes the same ceiling, so a mode
switch that stages nine at once builds the same shape.

This is a ceiling on the *shape* of the stage, never on what is on it.

### Groups fold into piles

The new rung at the bottom of the ladder. A pile is a group folded down to a
**tab in a rail**: its name turned a quarter turn so it runs the length of the
tab, a count, and nothing else. `PILE_W` is 34 — a finger. The rail stands at
the left edge, and the tabs in it divide the canvas's height between them, so
it is full from top to bottom.

This took two corrections to get right, and both were about the same thing:

1. The first cut laid piles flat, 152 × 30, in a rail of their own. Bryan's
   screenshot: a folded Ungrouped and an open folder side by side, each
   charging the stage a full column. **A column's width to say one word.**
2. So piles became sediment — seated in whatever height the open regions of a
   column left over, at that column's foot. That fixed the two-columns
   complaint, but the next screenshot showed the rest of it: two folded groups
   in a 152px column using 80px of 800, **white space for the remainder**.

The answer to both is the same: turn the tab on its side. Sideways, a folded
group costs 34px of width instead of 152 and uses every pixel of the height it
is given. There is no sediment and no special case — the rail is one narrow
column at the low end of the row, and it reads as a vertical menu of what you
are not working on.

### The rail has three forms

Each smaller than the last, and which one it takes is decided by what it holds,
not by a setting:

| form | when | what an entry is | width |
|---|---|---|---|
| `open` | you clicked an entry | a menu: the opened one lists its chats, the rest are rows | 196 |
| `tab` | every entry can have `PILE_MIN_H` (64) of height | a name turned a quarter turn, tabs dividing the canvas | 34 |
| `dot` | more entries than that | a square in the group's colour with its count inside | 26 |

The square is the floor of the whole ladder: no name at all, because at 26px
the colour *is* the name, and the number says how much is behind it. Squares
spread down the rail rather than stacking at the top, so it is full top to
bottom at every size.

A 26px square has room for exactly one thing. The lens button still occupies
flex space at `opacity: 0`, which was enough to shove the count out of the box
and under `overflow: hidden` — so in the square form it is `display: none`, and
Focus/Unfocus lives on the top-bar pill instead.

`packFocus` decides. It folds only what it must:

```
while the row does not fit at its floors and there is something left to fold:
    fold the lightest group
```

`weight` is what "lightest" means, and the caller passes recency: the group
nothing has happened in all day is the one that disappears. Ungrouped has no
weight of its own and folds before any real folder — it is the junk drawer, and
in the screenshot that asked for this it was eating half the canvas.

### Opening one is a peek, not a promotion

Clicking an entry opens it **inside the rail**. The rail widens once — to
`PILE_OPEN_W` (196, one field column's floor) — and the entry you opened lists
its chats as rows under its name. Everything else in the rail becomes a plain
menu row, because the rail is now wide enough for names the right way up.
Clicking that name again folds it back: the same target, both halves of one
toggle.

The cost is paid once, however many entries you open, and it is bounded: an
opened entry is as tall as what it shows and no taller. Where a group has more
chats than its share of the rail has room for, the rows stop and the entry says
`+n` — a peek that pushed the panes under reading width would be the thing this
is trying not to be.

An opened group **is still folded**. Two earlier attempts made it exempt from
folding instead — first by weighting it heavily (which fails: past a few pins
there is no slack anywhere, every group folds, and the pile you clicked folds
itself again), then by holding it open as a full field column (which works, and
costs the stage a column — exactly the greed this is here to avoid). Opening
changes how an entry *draws*, not whether it folded.

Every other group's name still selects its members, as before. The only names
that changed behaviour are the ones the person has explicitly opened.

The rail reads in catalog order, not in the order things happened to fold: a
tab that changed seats every time its neighbour folded would be a menu you
cannot learn.

A group that is the lens keeps its place in the row even when the stage has
swallowed every member, because `Unfocus` lives on its basin. With nothing left
in it, it is drawn as a pile — and a pile carries that button in the seat its
count would have had.

### The canvas never scrolls sideways

`packFocus` returns `width: canvas.w`, always. Everything above is the
negotiation that makes that honest:

1. Both sides give from preferred toward their floors, in proportion.
2. The field folds groups into piles, lightest first.
3. With every group folded and the stage still too wide, the panes go under
   reading width, down to `PANE_FLOOR` (168).
4. Past that the panes simply share what the canvas has.

Rung 3 is a real concession and it is deliberate: the person asked for this many
conversations at once, and the screen is the budget. `overflow: hidden auto` on
`.focus` is the guarantee, not the mechanism.

Down still scrolls. A column of cards is a column.

## Decisions that could have gone the other way

- **Fold by recency, not by size.** Folding the biggest group first would clear
  the most width per fold, but it would mean the group you have most work in is
  the first to vanish. Recency folds what you are not looking at.
- **Rotate rather than pack cleverly.** Sediment-in-leftover-height was the
  clever answer and it was beaten by a dumber one: a tab that is 34px wide
  instead of 152px saves more width than any packing of 152px boxes can, and
  it has no special cases. Bryan asked whether this wanted a constraint
  solver; it wanted a `writing-mode`. A solver over the old boxes would have
  found a better arrangement of the wrong primitive.
- **The fold loop does not ask whether a fold pays.** It cannot: two groups
  sharing a column, one folded, leaves the column exactly as wide as it was.
  Only the *next* fold removes it. A version that kept a fold only when the
  field got narrower stopped one fold short and left panes at 135px.
- **No separate fold control.** Adding a collapse button to every basin would
  put new chrome on the canvas for something the canvas already does correctly.
  The toggle rides the name that is already there, and only for a group the
  person opened by hand.
- **A piled card keeps its element.** `display: none` rather than removal, so
  opening a pile is a paint and not a rebuild.
- **The tree is not re-balanced on resize.** Narrowing the window drops
  `maxStageColumns`, but an arrangement the person made is theirs; the packer
  takes the shortfall out of pane width instead.

## What this does not fix

The stage can now hold ten conversations. **Their panes cannot all show
anything**, and that is not a layout problem.

Every open conversation holds its own `EventSource` (`/agent/events?conversation=<id>`),
on top of one `/agent/events?all=1` and the Drive's own `/events?drive=1`.
Chrome allows six connections per origin over HTTP/1.1. Measured on the
harness, with each conversation holding a transcript:

| panes | 1 | 2 | 3 | 4 | 6 | 10 |
|---|---|---|---|---|---|---|
| transcript renders | ✓ | ✓ | ✓ | — | — | — |
| a `fetch` completes | ✓ | ✓ | ✓ | hangs | hangs | hangs |

Three panes work. The fourth is blank and every subsequent request queues
behind the exhausted pool. This is **pre-existing** — it bites at exactly the
count the old cap allowed, which is very likely why nobody hit it — but it is
now the binding constraint on the feature.

The fix is to multiplex: one EventSource for the page, carrying per-conversation
events tagged with their conversation id, with the pane set and per-conversation
cursors in the URL and the stream reopened when the set changes. That is a
change to `server/agent/routes.js` (`/agent/events`, `streamConversation`) and
`runtime/agent.js` (`openStream`/`on`), it has real replay-and-dedupe
correctness to get right, and it needs the host restarted. It is not done here.

## Where it lives

- `runtime/agent-folders.js` — `PILE_W`, `PILE_H`, `PANE_FLOOR`, the
  `shapeField`/fold loop in `packFocus`, the pile rail, `width: canvas.w`.
- `templates/agents.mrbl` — the `FULL_CAP` removals, `maxStageColumns`,
  `shortestStageLeaf`, `defaultTree(keys, maxCols)`, `focusOpened` /
  `toggleFocusPile`, the `weight`, `piled` and `opened` arguments, `data-piled`
  cards, the `.focus-basin[data-pile]` block, `overflow: hidden auto`.
- `test/agent-folders.test.js` — the fold loop, the rail, weights, the
  no-scroll contract (the two tests that asserted sideways scrolling were
  rewritten, not deleted: they are the same question with the new answer).
- `test-browser/agents-focus-modes.test.js` — a lens stages the whole group.
