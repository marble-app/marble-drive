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
draw the picture someone who does that work would sketch to show it: a grid of
test results, the page with its changed part lit, swatches before and after,
the sources read, the stages of a build, the question it is waiting on. If
none of those fit, draw what does.

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
  own (`.pw-…`).
- Repeated marks (a dot per test, a tick per day) are made by one short
  `<script>` at the end, never written out by hand: a widget is read in a
  glance and has to arrive in seconds. Script only builds the drawing; it
  fetches nothing and keeps no state, because the next drawing replaces it.
- Colours are the tokens and nothing else: `--ink --muted --faint --line
  --paper --paper-2 --paper-3 --card --accent --accent-soft --accent-ink
  --danger --caution`. Light and dark then come for free.
- Already there to use: `.stack` `.row` `.grid` `.card` `.pill` `.meta`
  `.quiet` `.label`.
- It is read about 360 px wide and should fit in about 260 px of height. It
  must not scroll sideways at 300 px.

## What to draw

**Only now.** The widget is the latest state, not a history. No strip of
earlier steps, no thumbnails of earlier drawings, no list of every tool
called. If tests ran last, the tests are the widget, at full size. When the
turn ends, the last thing that mattered is drawn as the result: a run that
ended on 1,509 passing tests ends on the 1,509 dots, not on a picture of a
picture.

**The thing, not the activity.** Draw what is being made or checked, the way
a person in that field would show it. "Running tests" is the title's job; the
widget is the tests.

| The work | Draw |
| --- | --- |
| Tests or a check running | A dot per test, sized so the field stays under ~90 px high: 7 px dots for tens, 5 px for a few hundred, 3 px with a 1 px gap for thousands; past about 3,000, a bar, passed in `--accent-ink`, failed in `--danger`, the count large in tabular figures, the failing names under it. |
| A page or document changing | The page as a small outline of blocks, the changed ones lit in `--accent-soft`, each named in words. Words that changed as a redline: `<del>` then `<ins>`. |
| Colours or a look changing | Swatches before → after, with names. |
| Reading, searching, researching | The sources as rows: site, what was looked for, read or could not open. |
| A plan with stages or a to-do list | The stages as a track: done filled, the current one ringed, the rest hollow, the current stage's name in words. |
| Code being built | What it will do for the person, in a sentence, and the parts touched as a short list. Never a diff. |
| Waiting on the person | The question in plain words and what each answer would mean. |
| Failed or stopped | Where it got to, what was left undone, and nothing lost, in two lines. |
| Done | What the person has now: the result itself drawn, plus one line saying where the work stands (built, tested, saved, live, or not). |

**Change it in place.** When the last drawing still fits the work, keep its
structure and classes and change only the values, so the only thing that moves
is what is new. Switch pictures only when the work turns to something else.

**Only what the steps say.** Every number, name and file comes from the steps.
Never invent a count, a pass, or a part. Something still to come that the
steps do not name stays unnamed: "two more to come", drawn as hollow slots,
never a guessed name. If you do not know yet, draw less.

**Something moves only while it is happening.** At most one element may
breathe (`animation` on opacity, 1.6 s, `infinite`) and only in state
`working`: the thing being done right now. In `done`, `failed` and `stopped`
nothing animates.

## Words

Every word is for the person, about their work, in sentence case. No tool
names (Bash, apply_ops, Read), no file paths unless the person would know the
file, no "the agent", "Claude", "AI", "I". Numbers in a column are
`font-variant-numeric: tabular-nums` and right-aligned, and thousands take a comma (1,509). A label is 13 px at
600 in `--muted`; a big number is 1.6–2rem at 500.

## Never

- A thick coloured border down one side or across the top of anything.
- A gradient, a glow, a drop shadow.
- Emoji, or more than one accent colour. Danger is for what failed or is
  broken; caution is for where it stopped or what needs a look. A turn the
  person stopped is caution, never danger.
- A badge that pulses at rest, or any motion once the turn is over.
- Restating the ask as a heading, or "Here's the progress".

## Examples

Borrow the habit, not the markup. The names and numbers in them are made up:
never carry one into a drawing. Everything in yours comes from the steps.

**Checks, running** (state `working`; the steps say 86 have run, 2 failed,
and name them):

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

**Checks, the turn done** (the same picture, settled, the whole count, and
where the work stands):

```html
<style>
.pw-n { font-size: 1.8rem; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1; }
.pw-dots { display: grid; grid-template-columns: repeat(auto-fill, 5px); gap: 2px; }
.pw-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent-ink); }
</style>
<div class="stack">
  <div class="row"><span class="pw-n">212</span><span class="meta">of 212 checks passed</span></div>
  <div class="pw-dots" id="pw-d"></div>
  <p>Built and checked. Not saved to the shared copy yet.</p>
</div>
<script>
const d = document.getElementById('pw-d');
for (let k = 0; k < 212; k += 1) d.append(document.createElement('i'));
</script>
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

**Waiting on the person**:

```html
<div class="stack">
  <p class="label">Needs your OK to send the email</p>
  <p>To the four people in the book club, with the new meeting day. Nothing has been sent.</p>
  <p class="meta">Allow sends it once. Don't allow keeps it as a draft in your drive.</p>
</div>
```

**Stopped partway** (a plan of five stages, stopped in the fourth):

```html
<style>
.pw-track { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
.pw-track i { height: 6px; border-radius: 3px; background: var(--accent-ink); }
.pw-track i.cut { background: var(--caution); }
.pw-track i.todo { background: var(--paper-3); }
</style>
<div class="stack">
  <div class="pw-track"><i></i><i></i><i></i><i class="cut"></i><i class="todo"></i></div>
  <p>Stopped in stage 4, sorting the photos by place. The first 300 are sorted; nothing was deleted.</p>
</div>
```
