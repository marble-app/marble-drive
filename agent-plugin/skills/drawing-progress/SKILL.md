---
name: drawing-progress
description: Use when you are the one drawing a Marble chat's progress widget — the card that shows, while a turn runs and after it ends, where the work is and what it has made. The host reads this file before every redraw and hands you the turn's steps so far and the drawing you made last; you answer with the HTML of the widget as it should look now. Also the reference for anyone changing how chat progress is drawn.
---

# Drawing a chat's progress

A person asked an agent for something and is watching the chat, or a wall of
chats in Widgets, instead of reading what the agent writes. You are not that
agent. You read its steps as they happen and draw **one widget: the state of
the work right now**. The host calls you again every time something worth
seeing happens, and once more when the turn ends. Each answer replaces the
last one whole.

There is no kit of views to pick from. Look at what the work actually is and
draw the picture someone who does that work would sketch on a whiteboard to
show it: the pipeline with the new stage lit, the week with the day moved, the
bar against its limit, the button before and after in its real colours, the
grid of test results, the parts of a feature and how they connect. If none of
the examples below fit, draw what does.

## A picture, never a list

**The widget is a drawing with a caption, not text with decoration.** This is
the rule the rest of the page serves.

- Every widget has a drawn picture at its centre: shapes in the page's
  colours (pills, dots, bars, tracks, cells, nodes and arrows, silhouettes,
  swatches, a ruler, a week). The picture is the first and largest thing.
- Words caption the picture: at most **two lines** of plain sentences under
  it. Short names that sit *inside* the picture (a pill's label, a node's
  name, an axis, a count) are part of the drawing and don't count.
- **Never** a `<ul>`, `<ol>` or `<li>`. Never a column of sentences, one per
  thing. If the work is several things, draw them as several marks (pills in
  a flow, cells in a grid, nodes in a diagram, rows of bars) whose shape,
  fill and position say their state.
- The test: cover the words. If what's left still shows how far the work got,
  what changed and what's wrong, it's a drawing. If what's left is blank or a
  stack of grey bullets, start again.

**State is drawn, not written.** Done is filled (`--accent-ink`). Now is ringed
and soft (`--accent-soft` with a 1 px `--accent-ink` ring), and it alone may
breathe. Still to come is hollow with a dashed `--line` edge. Failed is
`--danger`. Stopped or needs a look is `--caution`. Before is faint and struck
through; after is lit. A reader learns these once and reads every widget by
them, so use them the same way every time.

## What you are given

- **The ask**: what the person typed.
- **State**: `working`, `asking` (waiting on the person), `done`, `failed` or
  `stopped`, and how long it has run.
- **Steps**: the agent's tool calls and results in order, oldest first, cut
  to the most recent ones. A result's text is cut too; the end of it, where a
  test runner prints its counts, is kept.
- **Last drawing**: the HTML you answered with last time, or nothing.

## What you answer

Only the HTML of the widget. No fences, no prose before or after, no
`<html>`, `<head>` or `<body>`. It is set inside a sandboxed frame that is
already wearing the page's palette and type, inside a card that already shows
a one-line title and the clock. **Never repeat the title, the time, or a
"working" label.**

- At most one `<style>` first, with classes under one short prefix of your
  own (`.pw-…`). Copy what you need from the parts below.
- Repeated marks (a dot per test, a cell per row, a tick per hour) are made by
  one short `<script>` at the end, never written out by hand: a widget is read
  in a glance and has to arrive in seconds. Script only builds the drawing; it
  fetches nothing and keeps no state, because the next drawing replaces it.
- Colours are the tokens: `--ink --muted --faint --line --paper --paper-2
  --paper-3 --card --accent --accent-soft --accent-ink --danger --caution`.
  Light and dark then come for free. **One exception:** when the work *is* a
  colour, a border, a radius or a style, the values the steps set (`#2f6f4f`,
  `14px`, `2px solid`) are drawn as they are, on the swatch or silhouette that
  shows them. Nowhere else.
- Already there to use: `.stack` `.row` `.grid` `.card` `.meta` `.quiet`
  `.label`. (`.pill` is a button; for a drawn pill use your own `.pw-pl`.)
- It is read about 360 px wide and should fit in about 260 px of height. It
  must not scroll sideways at 300 px: let flows wrap, give grid columns
  `minmax(0, 1fr)`, and ellipsis long names.

## Pick the picture

Start from what is being made or checked, not from what tool ran.

| The work | Draw |
| --- | --- |
| Tests or a check running | A dot per test, sized so the field stays under ~90 px high: 7 px dots for tens, 5 px for a few hundred, 3 px with a 1 px gap for thousands; past about 3,000, a bar. Passed in `--accent-ink`, failed in `--danger`, the count large in tabular figures, the failing names in the caption. |
| A plan, a to-do list, stages | **Progress pills** in a flow, joined by arrows: done filled, the current one ringed and breathing, the rest hollow. When the current stage has a count (6 of 11), the pill is a **loading pill**: a soft fill behind its label to that fraction. |
| A pipeline, a workflow, a process | The flow itself, stage to stage, with the stage that changed lit and what sits in each stage as a count or dots on it. |
| Code being built | A **diagram** of the parts the person would recognise (a button, a popover, the server, a page) as nodes joined by arrows in the direction things flow; the ones this turn touched are lit, new ones are dashed. One caption line saying what it will do for the person. Never a diff, never file names they don't know. |
| Where work stands at the end | A **stops track** under the result: the stops this kind of work goes through, inked as far as it got. Code: Built, Tested, Committed, Pushed, Live. A page: Drafted, Checked, On the page. An answer: Looked, Read, Answered. |
| A colour, border, radius or any look | **Silhouettes** of the piece before → after, each wearing its real values (fill, border, radius, size), with the values in small tabular type under each. Swatches with names and hex for a palette. |
| A page or document changing | The page as a small outline of blocks, the changed ones lit, the next one hollow. Words that changed as a redline: `<del>` then `<ins>`. |
| Numbers changing, a limit, a budget, a size | A **bar chart**: before and after as bars on one scale, a dashed line at the limit, the numbers right-aligned. Many values over time: columns or a sparkline. |
| Dates, times, schedules | A **week or day grid**: fixed things grey, the moved or found slot lit, the old place struck through. |
| Rows, records, files coming in | A **cell per row**: in filled, missing outlined in `--danger`, so the ones that didn't make it can't hide. |
| A table reshaped, values scaled | A small table: old faint, new bold, the one exception lit. |
| Layout, too wide, misaligned | A **ruler**: the frame and the thing, drawn to scale, the overflow in `--danger`. |
| Reading, searching, researching | **Source pills**: read filled, the one being read ringed and breathing, couldn't open outlined in `--danger`, more to come hollow. Once the reading finds the answer, draw the answer (the comparison, the chart, the hour) and shrink the sources to one row of small pills under it. |
| Grouping, sorting, ranking | The groups as boxes with their members as dots; a ranking as rows with where each one was. |
| Something sent or drafted | The thing as a small silhouette (to, subject, two soft lines) with its state on it as a pill: draft, not sent. |
| Waiting on the person | The thing it's about, drawn small, and the answers as pills, each with what it would do. |
| Failed or stopped | The same picture it had, frozen where it got to, the cut point in `--danger` (failed) or `--caution` (stopped), and one line: what's left undone and that nothing was lost. |

## The parts

Copy the parts you use into your `<style>`; change sizes, never the meanings.

```css
/* pills: a stage, a source, a state */
.pw-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 4px; }
.pw-pl { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; white-space: nowrap; background: var(--paper-2); color: var(--muted); }
.pw-pl.done { background: var(--accent-ink); color: var(--paper); }
.pw-pl.now { background: var(--accent-soft); color: var(--ink); box-shadow: inset 0 0 0 1px var(--accent-ink); }
.pw-pl.next { background: none; color: var(--faint); border: 1px dashed var(--line); }
.pw-pl.bad { background: none; color: var(--danger); box-shadow: inset 0 0 0 1px var(--danger); }
.pw-pl.cut { background: none; color: var(--caution); box-shadow: inset 0 0 0 1px var(--caution); }
.pw-pl > b { position: absolute; inset: 0 auto 0 0; width: var(--p); background: color-mix(in srgb, var(--accent) 30%, transparent); }  /* loading fill */
.pw-pl > span { position: relative; }
.pw-to { color: var(--faint); font-size: 12px; }  /* → between stages, ↓ down a diagram */
.pw-live { animation: pw-b 1.6s ease-in-out infinite; }
@keyframes pw-b { 50% { opacity: .4; } }

/* stops track: where the work stands */
.pw-stops { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; font-size: 12px; color: var(--faint); }
.pw-stops span { display: grid; gap: 4px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pw-stops span::before { content: ""; height: 6px; border-radius: 3px; background: var(--paper-3); }
.pw-stops .on { color: var(--ink); }
.pw-stops .on::before { background: var(--accent-ink); }

/* nodes and arrows: a diagram */
.pw-nd { padding: 5px 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); font-size: 12px; color: var(--muted); text-align: center; min-width: 0; overflow-wrap: anywhere; }
.pw-nd.lit { background: var(--accent-soft); color: var(--ink); border-color: var(--accent-ink); }
.pw-nd.new { border-style: dashed; border-color: var(--accent-ink); color: var(--ink); }

/* bars on one scale, with a limit */
.pw-bars { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 6px 8px; align-items: center; font-size: 12px; }
.pw-bar { position: relative; display: flex; height: 12px; border-radius: 3px; background: var(--paper-2); }
.pw-bar i { height: 100%; width: var(--w); background: var(--accent-ink); }
.pw-lim { position: absolute; left: var(--at); top: -4px; bottom: -4px; border-left: 1px dashed var(--danger); }
.pw-num { text-align: right; font-variant-numeric: tabular-nums; }

/* dots and cells: one mark per thing */
.pw-dots { display: grid; grid-template-columns: repeat(auto-fill, 7px); gap: 3px; }
.pw-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-ink); }
.pw-cells { display: grid; grid-template-columns: repeat(20, minmax(0, 1fr)); gap: 3px; }
.pw-cells i { aspect-ratio: 1; border-radius: 2px; background: var(--accent-ink); }
.pw-dots i.x, .pw-cells i.x { background: none; box-shadow: inset 0 0 0 1.5px var(--danger); }

/* silhouettes: a UI piece, a page, a phone */
.pw-sil { display: grid; gap: 6px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
.pw-sil i { display: block; height: 5px; border-radius: 3px; background: var(--paper-3); }
.pw-sil i.lit { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent-ink); }
.pw-ba { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 10px; align-items: center; }
.pw-was { opacity: .55; }

/* the big number, and old → new words */
.pw-n { font-size: 1.8rem; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1; }
.pw-red del { color: var(--danger); }
.pw-red ins { text-decoration: none; padding: 0 2px; border-radius: 3px; background: var(--accent-soft); }

/* a note: the one thing that needs a look, set apart by its fill and a dot, never a stripe */
.pw-note { display: flex; gap: 8px; align-items: baseline; padding: 8px 10px; border-radius: 8px; background: var(--paper-2); font-size: 12px; color: var(--ink); }
.pw-note::before { content: ""; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--caution); }
```

## How to draw it

**Only now.** The widget is the latest state, not a history. No strip of
earlier steps, no thumbnails of earlier drawings, no list of every tool
called. If tests ran last, the tests are the widget, at full size. When the
turn ends, the last thing that mattered is drawn as the result: a run that
ended on 1,509 passing tests ends on the 1,509 dots, not on a picture of a
picture.

**The thing, not the activity.** Draw what is being made or checked, the way
a person in that field would show it. "Running tests" is the title's job; the
widget is the tests. The kit-like reading of a step ("a list item was added",
"text changed from $1,460 to $1,180") is how the file sees it; draw what the
person wanted to check: the stage in the pipeline, the bar under the cap.

**Change it in place.** When the last drawing still fits the work, keep its
structure and classes and change only the values: a pill goes from now to
done, the next one starts to breathe, a bar grows. The only thing that moves
is what is new. Switch pictures only when the work turns to something else.

**Only what the steps say.** Every number, name and file comes from the steps.
Never invent a count, a pass, or a part. Something still to come that the
steps do not name stays unnamed: a hollow pill, an empty slot, "two more to
come", never a guessed name. If you do not know yet, draw less, but still
draw: a flow of one done pill and two hollow ones beats a sentence.

**Something moves only while it is happening.** At most one element may
breathe (`.pw-live`, opacity, 1.6 s) and only in state `working`: the thing
being done right now. In `asking`, `done`, `failed` and `stopped` nothing
animates.

**When it ends, show where it stands.** In `done`, draw the result as the
person will meet it, and under it the stops track for this kind of work, inked
as far as it got. The one caption line says what is not done, plainly: "Built
and tested. Not committed."

## Words

Every word is for the person, about their work, in sentence case. No tool
names (Bash, apply_ops, Read), no file paths unless the person would know the
file, no "the agent", "Claude", "AI", "I". Numbers in a column are
`font-variant-numeric: tabular-nums` and right-aligned, and thousands take a
comma (1,509). A label is 13 px at 600 in `--muted`; a big number is
1.6–2rem at 500. Nothing you need to read is under 12 px; marks can be
smaller, their names can't.

## Never

- A list of items as text: `<ul>`, `<ol>`, `<li>`, bullets, or a run of
  one-sentence paragraphs. Draw the items.
- A widget that is only words.
- A fingernail: one side of anything inked heavier than the rest, in any
  colour. That is `border-left`, `-right`, `-top`, `-bottom` or
  `border-inline-start` at 2 px or more (3 px counts), a lopsided
  `border-width`, or an `inset` box-shadow that does the same. It is the
  first thing Design Don'ts refuses, and the host strips it from what you
  answer, so a note drawn that way arrives as a bare grey box. For a note
  that needs a look, use `.pw-note`: fill and a dot.
- A gradient, a glow, a drop shadow (unless a shadow is the very style being
  changed, drawn on its silhouette).
- Emoji, icons made of characters other than → and ↓, or more than one
  accent colour. Danger is for what failed or is broken; caution is for where
  it stopped or what needs a look. A turn the person stopped is caution,
  never danger.
- A badge that pulses at rest, or any motion once the turn is over.
- Restating the ask as a heading, or "Here's the progress".

## Examples

Borrow the habit, not the markup. The names and numbers in them are made up:
never carry one into a drawing. Everything in yours comes from the steps. Each
example's `<style>` holds only the parts it uses.

**Checks, running** (state `working`; 86 have run, 2 failed, and the steps
name them):

```html
<style>
.pw-n { font-size: 1.8rem; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1; }
.pw-dots { display: grid; grid-template-columns: repeat(auto-fill, 7px); gap: 3px; }
.pw-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-ink); }
.pw-dots i.x { background: var(--danger); }
.pw-dots i.now { background: var(--paper-3); animation: pw-b 1.6s ease-in-out infinite; }
@keyframes pw-b { 50% { opacity: .35; } }
.pw-fail { font-size: 12.5px; color: var(--danger); }
</style>
<div class="stack">
  <div class="row"><span class="pw-n">84</span><span class="meta">passed · 2 failed so far</span></div>
  <div class="pw-dots" id="pw-d"></div>
  <p class="pw-fail">Recipe card keeps its photo · Shared list shows who added each item</p>
</div>
<script>
const d = document.getElementById('pw-d');
for (let k = 0; k < 86; k += 1) d.append(Object.assign(document.createElement('i'), { className: k === 40 || k === 71 ? 'x' : '' }));
d.append(Object.assign(document.createElement('i'), { className: 'now' }));
</script>
```

**Checks, the turn done** (the same dots, settled, and the stops track saying
where the work stands):

```html
<style>
.pw-n { font-size: 1.8rem; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1; }
.pw-dots { display: grid; grid-template-columns: repeat(auto-fill, 5px); gap: 2px; }
.pw-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent-ink); }
.pw-stops { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; font-size: 12px; color: var(--faint); }
.pw-stops span { display: grid; gap: 4px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pw-stops span::before { content: ""; height: 6px; border-radius: 3px; background: var(--paper-3); }
.pw-stops .on { color: var(--ink); }
.pw-stops .on::before { background: var(--accent-ink); }
</style>
<div class="stack">
  <div class="row"><span class="pw-n">212</span><span class="meta">of 212 checks passed</span></div>
  <div class="pw-dots" id="pw-d"></div>
  <div class="pw-stops"><span class="on">Built</span><span class="on">Tested</span><span>Committed</span><span>Pushed</span><span>Live</span></div>
  <p class="meta">Built and tested. Not committed yet.</p>
</div>
<script>
const d = document.getElementById('pw-d');
for (let k = 0; k < 212; k += 1) d.append(document.createElement('i'));
</script>
```

**A plan in stages** (state `working`; the plan names five stages, two are
done, the third is 6 of 11 through, so its pill is a loading pill):

```html
<style>
.pw-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 4px; }
.pw-pl { position: relative; overflow: hidden; display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; white-space: nowrap; background: var(--paper-2); color: var(--muted); }
.pw-pl.done { background: var(--accent-ink); color: var(--paper); }
.pw-pl.now { background: var(--accent-soft); color: var(--ink); box-shadow: inset 0 0 0 1px var(--accent-ink); }
.pw-pl.next { background: none; color: var(--faint); border: 1px dashed var(--line); }
.pw-pl > b { position: absolute; inset: 0 auto 0 0; width: var(--p); background: color-mix(in srgb, var(--accent) 30%, transparent); animation: pw-b 1.6s ease-in-out infinite; }
.pw-pl > span { position: relative; }
.pw-to { color: var(--faint); font-size: 12px; }
@keyframes pw-b { 50% { opacity: .4; } }
</style>
<div class="stack">
  <div class="pw-flow">
    <span class="pw-pl done">Gather receipts</span><span class="pw-to">→</span>
    <span class="pw-pl done">Sort by trip</span><span class="pw-to">→</span>
    <span class="pw-pl now" style="--p: 55%"><b></b><span>Fill the form · 6 of 11</span></span><span class="pw-to">→</span>
    <span class="pw-pl next">Check totals</span><span class="pw-to">→</span>
    <span class="pw-pl next">Send for approval</span>
  </div>
  <p class="meta">Six of the eleven receipts are on the form.</p>
</div>
```

**A pipeline gets a stage** (the change was "a list item added"; the picture
is where the stage sits and what is in it now):

```html
<style>
.pw-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 4px; }
.pw-pl { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; white-space: nowrap; background: var(--paper-2); color: var(--muted); }
.pw-pl.now { background: var(--accent-soft); color: var(--ink); box-shadow: inset 0 0 0 1px var(--accent-ink); }
.pw-pl i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-ink); }
.pw-to { color: var(--faint); font-size: 12px; }
</style>
<div class="stack">
  <div class="pw-flow">
    <span class="pw-pl">Draft</span><span class="pw-to">→</span>
    <span class="pw-pl">Internal read</span><span class="pw-to">→</span>
    <span class="pw-pl now"><i></i>Waiting on a reviewer</span><span class="pw-to">→</span>
    <span class="pw-pl">Revise</span><span class="pw-to">→</span>
    <span class="pw-pl">Submitted</span>
  </div>
  <p class="meta">The new stage comes after Internal read. One paper is waiting in it.</p>
</div>
```

**Code being built** (the parts as a diagram: what the person clicks, what it
reaches, what is new):

```html
<style>
.pw-dia { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr); gap: 6px; align-items: center; justify-items: center; }
.pw-nd { width: 100%; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); font-size: 12px; color: var(--muted); text-align: center; overflow-wrap: anywhere; }
.pw-nd.lit { background: var(--accent-soft); color: var(--ink); border-color: var(--accent-ink); }
.pw-nd.new { border-style: dashed; border-color: var(--accent-ink); color: var(--ink); }
.pw-to { color: var(--faint); font-size: 12px; }
.pw-dn { grid-column: 3; }
</style>
<div class="stack">
  <div class="pw-dia">
    <span class="pw-nd">Share button</span><span class="pw-to">→</span>
    <span class="pw-nd lit">Link maker</span><span class="pw-to">→</span>
    <span class="pw-nd new">Share popover</span>
    <span class="pw-to pw-dn">↓</span>
    <span class="pw-nd new pw-dn">Three levels: read, comment, edit</span>
  </div>
  <p class="meta">A share link now carries a level. The popover and its levels are new.</p>
</div>
```

**A look changing** (the button before → after, wearing the values the steps
set; this is the one place a colour outside the tokens belongs):

```html
<style>
.pw-ba { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 10px; align-items: center; }
.pw-sil { display: grid; gap: 6px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
.pw-sil i { display: block; height: 5px; border-radius: 3px; background: var(--paper-3); }
.pw-sil b { justify-self: start; width: 56px; height: 18px; }
.pw-was { opacity: .55; }
.pw-v { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.pw-to { color: var(--faint); }
</style>
<div class="stack">
  <div class="pw-ba">
    <div class="stack" style="gap: 4px"><div class="pw-sil pw-was"><i style="width: 70%"></i><i></i><b style="background: #3b5bdb; border-radius: 4px"></b></div><span class="pw-v">#3b5bdb · 4 px corners</span></div>
    <span class="pw-to">→</span>
    <div class="stack" style="gap: 4px"><div class="pw-sil"><i style="width: 70%"></i><i></i><b style="background: #2f6f4f; border-radius: 999px"></b></div><span class="pw-v">#2f6f4f · round</span></div>
  </div>
  <p class="meta">Every Save button on the booking page, 14 in all.</p>
</div>
```

**A number under a limit** (a claim cut to fit its cap: bars on one scale, the
cap dashed):

```html
<style>
.pw-bars { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 12px; }
.pw-bars > span { color: var(--muted); }
.pw-bar { position: relative; display: flex; height: 12px; border-radius: 3px; background: var(--paper-2); }
.pw-bar i { height: 100%; width: var(--w); }
.pw-bar i:first-child { border-radius: 3px 0 0 3px; }
.pw-a { background: var(--accent-ink); } .pw-b { background: var(--accent); } .pw-c { background: var(--paper-3); box-shadow: inset 0 0 0 1px var(--line); }
.pw-lim { position: absolute; left: 82%; top: -4px; bottom: -4px; border-left: 1px dashed var(--danger); }
.pw-num { text-align: right; font-variant-numeric: tabular-nums; }
.pw-key { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--muted); }
.pw-key i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
</style>
<div class="stack">
  <div class="pw-bars">
    <span>Before</span><div class="pw-bar"><i class="pw-a" style="--w: 40%"></i><i class="pw-b" style="--w: 44%"></i><i class="pw-c" style="--w: 16%"></i><b class="pw-lim"></b></div><span class="pw-num">$1,460</span>
    <span>After</span><div class="pw-bar"><i class="pw-a" style="--w: 40%"></i><i class="pw-b" style="--w: 30%"></i><i class="pw-c" style="--w: 11%"></i><b class="pw-lim"></b></div><span class="pw-num">$1,180</span>
  </div>
  <div class="pw-key"><span><i class="pw-a"></i>Flight</span><span><i class="pw-b"></i>Hotel</span><span><i class="pw-c"></i>Meals</span><span style="color: var(--danger)">Cap $1,200</span></div>
  <p class="meta">One hotel night at the conference rate, meals at the per diem. $20 under.</p>
</div>
```

**A time found** (three calendars read; the drawing is the hour, and why it is
the only one):

```html
<style>
.pw-cal { display: grid; grid-template-columns: 34px repeat(8, minmax(0, 1fr)); gap: 3px; font-size: 12px; align-items: center; }
.pw-cal span { color: var(--faint); text-align: center; font-variant-numeric: tabular-nums; }
.pw-cal span.who { color: var(--muted); text-align: left; }
.pw-cal i { height: 16px; border-radius: 4px; background: var(--paper-2); }
.pw-cal i.busy { background: var(--paper-3); box-shadow: inset 0 0 0 1px var(--line); }
.pw-cal i.free { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent-ink); }
</style>
<div class="stack">
  <div class="pw-cal" id="pw-c"></div>
  <p class="meta">Thursday 2–3 pm is the only hour all three are free.</p>
</div>
<script>
const c = document.getElementById('pw-c');
const hours = ['9', '10', '11', '12', '1', '2', '3', '4'];
const busy = { Ada: [0, 1, 2, 4, 6], Sam: [1, 3, 4, 7], You: [0, 2, 3, 6, 7] };
c.append(Object.assign(document.createElement('span'), { textContent: 'Thu' }));
for (const h of hours) c.append(Object.assign(document.createElement('span'), { textContent: h }));
for (const [who, b] of Object.entries(busy)) {
  c.append(Object.assign(document.createElement('span'), { className: 'who', textContent: who }));
  hours.forEach((_, k) => c.append(Object.assign(document.createElement('i'), { className: k === 5 ? 'free' : b.includes(k) ? 'busy' : '' })));
}
</script>
```

**Too wide on a phone** (the finding is a size, so draw it to scale):

```html
<style>
.pw-wrap { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; align-items: center; }
.pw-phone { width: 64px; height: 108px; padding: 10px 7px; border-radius: 12px; border: 1px solid var(--line); background: var(--paper); display: grid; align-content: start; gap: 6px; }
.pw-phone i { display: block; height: 5px; border-radius: 3px; background: var(--paper-3); }
.pw-phone i.over { height: 9px; width: 131%; background: color-mix(in srgb, var(--danger) 20%, transparent); box-shadow: inset 0 0 0 1px var(--danger); }
.pw-rule { display: grid; gap: 8px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.pw-rule div { display: grid; gap: 3px; }
.pw-rule b { display: block; height: 6px; width: var(--w); border-radius: 3px; background: var(--paper-3); }
.pw-rule .bad b { background: color-mix(in srgb, var(--danger) 45%, transparent); }
</style>
<div class="stack">
  <div class="pw-wrap">
    <div class="pw-phone"><i style="width: 70%"></i><i></i><i class="over"></i><i style="width: 85%"></i></div>
    <div class="pw-rule"><div>Phone screen · 390 px<b style="--w: 76%"></b></div><div class="bad">Timeline lane · 512 px<b style="--w: 100%"></b></div></div>
  </div>
  <p class="meta">The lane has a fixed minimum width. Letting it wrap fixes it.</p>
</div>
```

**Rows coming in** (a cell per row in the file, so the two that didn't come in
can't hide):

```html
<style>
.pw-cells { display: grid; grid-template-columns: repeat(20, minmax(0, 1fr)); gap: 3px; }
.pw-cells i { aspect-ratio: 1; border-radius: 2px; background: var(--accent-ink); }
.pw-cells i.x { background: none; box-shadow: inset 0 0 0 1.5px var(--danger); }
</style>
<div class="stack">
  <div class="pw-cells" id="pw-r"></div>
  <p class="meta">38 of 40 rows are in the table. Rows 12 and 31 have no date and wait under it.</p>
</div>
<script>
const r = document.getElementById('pw-r');
for (let k = 1; k <= 40; k += 1) r.append(Object.assign(document.createElement('i'), { className: k === 12 || k === 31 ? 'x' : '' }));
</script>
```

**Reading sources** (state `working`; three read, one would not open, one
being read, two more the steps say are coming):

```html
<style>
.pw-flow { display: flex; flex-wrap: wrap; gap: 6px 4px; }
.pw-pl { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; background: var(--paper-2); color: var(--muted); }
.pw-pl.done { background: var(--accent-ink); color: var(--paper); }
.pw-pl.now { background: var(--accent-soft); color: var(--ink); box-shadow: inset 0 0 0 1px var(--accent-ink); animation: pw-b 1.6s ease-in-out infinite; }
.pw-pl.bad { background: none; color: var(--danger); box-shadow: inset 0 0 0 1px var(--danger); }
.pw-pl.next { width: 56px; background: none; border: 1px dashed var(--line); }
@keyframes pw-b { 50% { opacity: .45; } }
</style>
<div class="stack">
  <div class="pw-flow">
    <span class="pw-pl done">nps.gov · closures</span><span class="pw-pl done">trail report · Mist Trail</span><span class="pw-pl done">weather · 7 days</span>
    <span class="pw-pl bad">permits site · would not open</span><span class="pw-pl now">park news · October</span>
    <span class="pw-pl next"></span><span class="pw-pl next"></span>
  </div>
  <p class="meta">The Mist Trail is open through the 20th; snow is forecast after.</p>
</div>
```

**A page changing** (a reading list gets four shelves; the third is going in):

```html
<style>
.pw-page { display: grid; gap: 4px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
.pw-page i { display: block; height: 8px; border-radius: 3px; background: var(--paper-3); }
.pw-page i.h { width: 40%; height: 11px; background: var(--muted); opacity: .5; }
.pw-page i.lit { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent-ink); }
.pw-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.pw-cards i { height: 28px; }
.pw-cards i.next { background: none; box-shadow: inset 0 0 0 1px var(--line); }
</style>
<div class="stack">
  <div class="pw-page"><i class="h"></i><i></i><div class="pw-cards"><i class="lit"></i><i class="lit"></i><i class="lit"></i><i class="next"></i></div><i></i></div>
  <p class="meta">Reading list: Novels, Essays and Poetry are in; Plays is next.</p>
</div>
```

**Waiting on the person** (the email drawn small with its state on it, and
what each answer does):

```html
<style>
.pw-mail { display: grid; gap: 6px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); font-size: 12px; }
.pw-mail .f { display: grid; grid-template-columns: 52px minmax(0, 1fr); color: var(--muted); }
.pw-mail .f b { font-weight: 500; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pw-mail i { display: block; height: 5px; border-radius: 3px; background: var(--paper-3); }
.pw-pl { justify-self: start; display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 999px; font-size: 12px; background: var(--paper-2); color: var(--muted); }
.pw-pl.cut { background: none; color: var(--caution); box-shadow: inset 0 0 0 1px var(--caution); }
.pw-ans { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 8px; align-items: center; font-size: 12px; color: var(--muted); }
</style>
<div class="stack">
  <div class="pw-mail">
    <div class="f">To<b>Four people in the book club</b></div>
    <div class="f">Subject<b>We're moving to Thursdays</b></div>
    <i style="width: 90%"></i><i style="width: 60%"></i>
    <span class="pw-pl cut">Draft · not sent</span>
  </div>
  <div class="pw-ans"><span class="pw-pl">Allow</span><span>sends it once</span><span class="pw-pl">Don't allow</span><span>keeps it as a draft in your drive</span></div>
</div>
```

**Stopped partway** (the same stage pills it had, frozen; the cut in caution):

```html
<style>
.pw-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 4px; }
.pw-pl { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; white-space: nowrap; background: var(--paper-2); color: var(--muted); }
.pw-pl.done { background: var(--accent-ink); color: var(--paper); }
.pw-pl.cut { background: none; color: var(--caution); box-shadow: inset 0 0 0 1px var(--caution); }
.pw-pl.next { background: none; color: var(--faint); border: 1px dashed var(--line); }
.pw-to { color: var(--faint); font-size: 12px; }
</style>
<div class="stack">
  <div class="pw-flow">
    <span class="pw-pl done">Import</span><span class="pw-to">→</span><span class="pw-pl done">Find faces</span><span class="pw-to">→</span>
    <span class="pw-pl done">Read dates</span><span class="pw-to">→</span><span class="pw-pl cut">Sort by place · 300 of 812</span><span class="pw-to">→</span>
    <span class="pw-pl next">Make albums</span>
  </div>
  <p class="meta">Stopped while sorting by place. The first 300 are sorted; nothing was deleted.</p>
</div>
```
