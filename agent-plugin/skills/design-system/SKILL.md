---
name: design-system
description: Use before styling anything in a Marble drive — a new document or app, a card, pane, row, control or popover added to a page, a restyle, a dark mode, a phone layout, motion on a gesture. The drive's Design System page holds its tokens, type, shape, motion, parts and the rules behind them; this skill says how to read it and apply it so what you build looks like it belongs to the drive's own apps.
---

# The drive's design system

Every drive is seeded with a **Design System** page next to Agents, Chat and
Board. It is not a picture of the styles. The Agents page and the Drive are
drawn with those tokens, and the page is drawn with them too. It is the source
of truth. This skill is a map of it. Where they disagree, the page wins,
because its owner may have changed it and this skill cannot know.

## Find it and read it

The page lives wherever the drive keeps it. `.marble/apps.json` records where
under `seeded["design-system"]`. It defaults to `Design System` at the root.
If the page is missing, use `tokens.css` next to this file. It holds the
shipped tokens and nothing more.

The page is about 240 KB, so read the part you need, not the whole file:

```sh
f="$(node -e 'const m=require("./.marble/apps.json");console.log((m.seeded["design-system"]||"Design System")+".mrbl")' 2>/dev/null || echo 'Design System.mrbl')"
sed -n '/^  :root {/,/^  }/p' "$f"            # the tokens, light-dark() pairs, each with its reason
grep -n 'class="k"' "$f"                      # the section map: 00 sources … 12 starting an app
```

`read_document` on it gives an outline you can open by id. The sections are
`s-pri` (principles), `s-col` (colour), `s-typ` (type), `s-shp` (shape, depth,
space), `s-mot` (motion), `s-int` (interaction), `s-cmp` (components), `s-lay`
(layout and touch), `s-voc` (voice), `s-bld` (building it in Marble), `s-rej`
(what was rejected) and `s-sta` (starting an app). Read the section for what you
are about to build. For a new app, always read `s-sta` and `s-rej`.

## When it applies, and when the document already has a look

- **A new document or app:** copy the token block into the top of its
  `<style>` and walk the checklist below. The page's "Starting an app" section
  is the same list, and its Copy button yields the token block read live off
  the stylesheet.
- **Adding to a page someone built:** the page's own tokens come first. If
  it already declares `--ink`, `--paper`, `--accent` and the rest, use those
  names and add nothing new. If it has its own system (a daily page with its
  own `design.css`, a paper set in its venue's style), extend that one and do
  not graft this one on.
- **A restyle the person asked for** in some other look: do what they asked.
  The system is the default, not a veto.
- **A `marble-visual` card in the chat:** follow `visuals-in-chat`. The host
  themes that frame.

## The rules, short

Each rule is argued for on the page. When one seems wrong for your case, read
the argument there before breaking it.

**Colour. Paper and ink, one accent.** Warm off-white paper for the interface
and white to the edge for a document. Near-black ink in three greys (`--ink`,
`--muted`, `--faint`), plus `--placeholder`, the only grey that clears 4.5:1 for
a prompt. One dusty blue (`--accent`, `--accent-soft` for tints, `--accent-ink`
for accent as text). `--danger` and `--caution` are the only other hues. An app
may pick one accent from the family (research green, terracotta, sage and gold,
travel blue, slate). **Violet is reserved** for an agent working in the
document. Never use it as app colour.

**Dark is the same paper, unlit.** Write every colour once, as a
`light-dark(light, dark)` pair, with `color-scheme: light dark` on the root.
Dark greys are neutral, with no warm cast, and match the luminance of the light
value they replace. After dark, the accent is the light colour of its pair, so
what sits on it is `--paper`, never white. Shadows are warm on paper and black
after dark. Never build a shadow with `color-mix` on `--ink`.

**Material weight is hierarchy.** A sidebar sits one shade back (`--paper-2`),
a hover two shades back (`--paper-3`), and panes are cards on `--well`. The lit
pane is one step deeper (`--pane-lit`). Focus is a change of colour and nothing
else: nothing appears or disappears to say so.

**Hairlines, and a ring when it matters.** Every border is 1px of `--line`. A
drop target or a large region reacts with a ring drawn inside its edge (`inset 0
0 0 2px var(--accent)`). A tint only supports the ring.

**Type.** One sans (`--ui`) at 14px/1.5 for chrome. Weights are 400 for context,
500 for anything that names a thing, and 600 for the chosen one, and nothing
else. Page title 1.15rem/500/−.015em. Meta .78rem muted. Section label 13px/600
in label ink, never 11px uppercase. Ages and numbers in columns use tabular
figures. Documents read in `--serif` at about 1.02rem/1.6, and code in `--mono`
12px on `--paper-2`. Phone reading text is 17px. **No document names a webfont
or links a stylesheet.** Set `button { font: inherit }`.

**Shape.** 3 for a document page, 4 for editable text, 8 for a small control,
12 for a card, 14 for a sheet, 16 for a pane, 999 for a pill. A colour rule
(a folder's colour, a leading edge) is a straight segment inset past the
radius. It never bends around a corner. The border stays one weight and one
colour all the way round.

**Space.** Chrome spaces in rem fractions: .35, .45, .55, .65, .75, 1. A topbar
pads .55rem 1rem and a row .55rem .9rem. The gap between panes is 5px, and the
gap is the divider.

**Motion. Three curves, five clocks.** `--ease-out` for anything that arrives or
settles, `--ease` for colour, `--snap` for the instant a press registers. Use
`--t-fast` 110ms for a press, `--t` 200ms for hover, colour and popovers,
`--t-slow` 340ms for rows arriving (staggered, capped so forty rows finish
inside a third of a second), `--t-snap` 300ms, and `--t-room` 520ms for one
state of the room becoming the next. A view switch is a 150ms crossfade of the
big regions, and cards do not fly between views. What arrives rises 3px from
.98 scale. A row that leaves closes its height. Include two blocks:
`prefers-reduced-motion` cuts everything except the crossfade, and
`prefers-reduced-transparency` makes translucent bars opaque.

**Under a hand, nothing eases.** A dragged thing tracks one to one with no
transition and springs on release (response .34s, damping 1, interruptible).
A drag files one op, on release, from the composed value. On touch, a lift
starts after 400ms held still.

**A press answers on the way down**, in colour. Rows and pills never scale. Only
a thing shaped like a physical button gives a little. On touch, every control
answers within 100ms.

**Words, not capsules.** Chrome is bare text on the bar until it is hovered,
open or holding a value. The filled ink pill is the loudest thing on the page,
so spend it once, on the page's one action (New). An outline is for a setting,
bare text for context. Danger is a colour on the same shapes, never a red box.

**Marked, not counted; said once.** A dot says something is hidden, and the
popover says what. Never put a digit on a button. Emptiness is one centred
sentence, and only when there is nothing at all.

**Drawn, not typed.** Icons are one SVG in `currentColor`, 20px inside a 44px hit
box. A disclosure arrow is the masked `--chevron`, never a typed ▾.

**Floating chrome is a layer.** Topbars and sheets are translucent: paper at 78%
over a 20px blur, or a sheet at 88% over 24px, with `--edge-lit` along the top.
A popover hangs under the button that opened it and grows from the nearest
corner. It is never a sheet at the far edge of the window.

**A finger is not a mouse.** Targets are 44pt, grouped-list rows 48pt. No menu
may be reachable only by hover. Every hover reveal has a `:focus-within` twin
and a `hover: none` answer. Measure heights against the visual viewport. A tap
opens and a held finger chooses.

**Never sideways.** What doesn't fit compacts until it does: cards become
chips, groups become piles, a label becomes a quarter-turned tab. Down is
allowed.

**Layout.** Width breakpoints are container queries on `html`, not `@media`
widths, because a docked panel shrinks the page and leaves the viewport alone.
`@media` is for capabilities only (hover, pointer, motion, transparency,
scheme). Cap the measure per column, not per page.

**Voice.** Every label is a word in the file, editable. Use sentence case with
no full stops on buttons. Buttons are verbs or the name of what they open. A
row states what it is and what it is doing.

**Every gesture is a commit, with a way back.** Say what a control will do
before it does it, show that it did it where the person pressed, and bind Mod+Z
with a recorded inverse. Confirm almost nothing. Where the page's "Building it
in Marble" section and `build-in-marble` or `read_guide` disagree, those win:
they are the format.

**Write the reason above the rule.** A stylesheet comment says *why*. That is
where this system came from, and it is what lets the next person disagree with
the reason instead of the rule.

## Starting an app: the checklist

1. Put the token block at the top of `<style>`, with `color-scheme: light dark`
   on the root. Chrome goes on paper, and a document on white.
2. One sans at 14/1.5, weights 400, 500 and 600. `button { font: inherit }`.
3. One accent from the family, or the blue. Danger and caution are the only
   other hues.
4. Editable text gets the `--accent-soft` tint under the pointer and a 1px
   accent ring with a 4px soft halo at the caret. Keyboard focus gets one 2px
   accent ring everywhere a key can land.
5. A press answers on the way down, in colour. Rows never scale.
6. Both motion blocks: reduced motion and reduced transparency.
7. Width is a container query on `html`. `hover: none` and `pointer: coarse`
   stay media queries.
8. Every fact in one attribute, and every look derived from it. Page-only state
   is a `marble-` class or a declared page-only attribute, never an op.
9. Icons are drawn: SVG in `currentColor`, 20 inside a 44 hit box.
10. Reasons above rules.
11. Affordances with their history part, and Mod+Z bound.
12. Dragged things track one to one and spring on release.

## Rejected. Do not bring these back

The page's `s-rej` section lists what was tried and removed. In a diff, each one
is a regression. The ones that recur most:

- Painted drop bands, and cards flying between views.
- Focus that hides a title or turns a bar white, and dimmed neighbours.
- Capsules and borders around a prompt, and a digit on a button.
- "Nothing here" said more than once.
- A typed ▾.
- 11px uppercase headers in faint ink.
- A warm dark mode.
- A press that scales a row.
- A menu as a sheet far from its button.
- A transition on the thing being dragged.
- A coloured border bent around a rounded corner.

## Check your work

Render it in both schemes and at phone and desk widths (360, 460, 620, 820,
1100). Look for hover-only controls, sideways overflow, and contrast of
`--faint` text under 4.5:1 where it carries meaning. Run `check_document`
after any rewrite. If what you built looks wrong next to the Agents page, it is
wrong.
