---
name: drawing-the-change
description: Use when changing something on a Marble page someone is looking at with apply_ops or fan_out and the change touches more than one part or takes more than one batch — rows, cells, a chart, a diagram, a map, a timeline, a plate map, a drawing, a form, any artifact, including kinds nobody has drawn before; when deciding what the page should show while a change runs; or when about to write status lines, highlight classes, overlay elements or a style into a document to show work in progress.
---

# Drawing the change

## Overview

The page changes; nothing talks. While you change a thing, the page shows the tool a person would hold on *that* thing, counting in *that* thing's unit — and you tell it what to draw with `marks` on `apply_ops` (and `fan_out`). The page draws them in a layer of its own and takes them away when you finish. Nothing about the work is ever written into the document.

There is no list of kinds to pick from. A seismogram, a tide table and a pedigree each have their own tool, and you work it out each time, from the thing, the way the examples in `examples.md` were worked out.

**When not to:** a change of words inside one block (the page writes them at a caret already), or a single edit to a single part. Send no marks; a `note` is enough.

## 1. Name the shape of the change

| Shape | When | How it lands | Its tool |
|---|---|---|---|
| **Rule** | the same instruction on every part, no thought per part: round, tighten, convert, scale, mirror, transpose, swap a palette, shift every time, rename X to Y | at once: one call, or as few as the 24-op limit allows, each call's parts dealt across the whole reach (every fifth row), never a block in reading order | the **control a specialist would set it with**, drawn once on what stands for the rule — a key signature, a column header, a legend, a palette, a corner — with the value as `text`. Nothing walks |
| **Walk** | each part needs thought, and depends on the one before: picks along a record, crossing answers, rounds of a bracket, matches that use up invoices, deductions | one call per natural step, in the artifact's order | what the specialist holds **where they are**, keyed so it moves with your thinking |
| **Judgment** | six or more parts, each needing its own thought, independent of the others: rewrite each, caption each, an icon for each | `fan_out` (one plan, shards of ids); groups land as their workers finish | none that moves — the work is in many places at once. The tag's words, `reach`, and a few `ahead` marks |
| **Build** | parts that do not exist yet: a section, a row of cards, stations on a new line | stages: outlines first, then filled in (see growing-the-open-page) | a line where the next part lands; the parts to come as dashed outlines |

Judge by what the work *is*, not by how many ops it takes. A rule over 300 rows is still a rule; walking it block by block reads as someone working down a list, which is the one thing the page must never look like.

## 2. Fill in the card, before the first edit

Read enough of the artifact to answer each line as the person who works on it for a living would. Keep the card in your notes, not on the page.

```
Artifact  what its maker calls it         "a 96-well plate laid out for a dilution series", not "a table"
Unit      what they count in (one/many)   well / wells
Shape     rule, walk, judgment or build   walk
Order     walk and build only: the way    the protocol's: column by column, controls left alone
          its own people work through it
Tool      for the shape (table above),    "the ring of the pipette tip on the well being filled"
          and exactly where it sits
Ahead     what is still to come, in the   "the wells still to fill, outlined dashed"
          artifact's own form
Before    how the field shows what was    "—" when the change shows it; "the old figure, struck"
          there, if the change hides it
Tag       <Verb> n of N <unit>            "Filling 36 of 80 wells"
          or <Verb> x of y <measure>      "Widening 15 of 24 px"
```

**Tool:** picture the specialist doing this exact change by hand or in their own software — the copy editor, the cartographer, the lab tech, the surveyor, the subtitler — and name the one thing on their screen or bench that shows where they are (a walk) or what they set (a rule): a cursor, a ring, a playhead, a pick, a pen, a field with a number in it, a line where the next row will land. If two would fit, take the one that sits on a part, not the one that frames the region.

**Order:** the artifact's grammar, which is often not the order of its markup. A timeline goes along time; a family tree generation by generation; a tide table by date; a pedigree from the founders down. Ask how its own people read or work through it, and check the field's convention rather than assuming top to bottom.

## 3. Turn the card into marks

| Card line | `marks` |
|---|---|
| Tag | `verb` (the field's word: Picking, Transposing, Redrafting, Matching) and `unit: [one, many]`; or `measure: {now, of, unit}` when the count is not parts |
| Tool | one `draw` mark, `as: "now"`. A walk's tool has a `key` (e.g. `"tool"`): the same key next call glides it to its new part |
| Ahead | `as: "ahead"` marks (dashed, faint) on what is still to come, or one dashed path over the whole artifact |
| Before | `as: "before"` marks (a faint ghost; words struck), only on parts the change has just hidden |
| Reach | `reach: [ids]` (up to 200; past that, name what holds them — rows, not cells) and `total` — the page tints every part ahead of time, so you need not ring each one |

A mark is `{at, on, as, shape | svg | text, x, y, key}`:

- `at`: the `data-marble-id` it stands on — one you have read, never one you made up. Pick the smallest part that holds the place; if the place has no id of its own (a cell, a word), anchor to what holds it and place the mark with `x`, `y` or `svg`.
- `on`: `over` (default), `above`, `below`, `start`, `end`.
- `shape`: `ring` hugs the part (a cursor, a selection; dashed `ahead`, it is a place still to fill); `line` runs along the side `on` names (`below`: where the next row lands; `start`: a caret, for the one place you are now — a column of them reads as a stripe down the side, so mark many places ahead with dashed rings instead; `over`: a vertical line at `x`, a playhead); `dot` sits at `x,y` (where it is now on a map or drawing); `fill` washes the part.
- `svg`: shapes (`path`, `line`, `polyline`, `polygon`, `rect`, `circle`, `ellipse`, `g`) in a 0–100 box stretched over the part — percent of its width and height. Strokes keep their width; circles stretch, so use `dot` for points. `class` may be `ahead`, `before`, `fill`, `solid`, `thin`. No text inside.
- `text`: a few words or a value, set small in the ink: the number being written, `+24 px`, `×1.5`, `G minor → A minor`.
- `x`, `y`: percent across and down the part. You never see pixels: derive them from the artifact's own coordinates (an SVG's `viewBox`, a time axis, a column index), or anchor to a smaller part instead of guessing.

At most 24 marks a call; aim for six or so — the tool (and its twin, if the same place shows in two views), the next few `ahead`, and `before` only on what this call just changed. Past ten it is clutter: let `reach` carry the rest. A `draw` replaces the last one; leave it out to keep what is drawn; `[]` clears it. Everything goes when the turn ends.

## 4. Land it

1. **Marks before motion.** First call: `ops: []`, with `reach`, `total` and `marks` (the tool, what is ahead). Nothing is written; the page shows the reach and the tool. A call with `ops: []` can also move a walk's tool while you read, before you write.
2. **Rule:** then one call with the ops (or a few, each dealt across the reach). The page turns the parts in loose batches by itself.
3. **Walk:** then one call per step, each with its ops, a `note` of "Stage n of m: …", and `marks.draw`. Send them one at a time, each after the last has returned — never as parallel tool calls, which land together and turn the walk into a jump. The tool sits where you are working *between* calls: each call lands the part it was on and moves the tool (same `key`) to the part you will work on next.
4. **Judgment:** then `fan_out` with `path`, `note`, `plan`, `shards: [{ids, brief}]` and `marks` (its `verb`, `unit`, and any `ahead`). Workers return edits and draw nothing; each group's parts are marked as they land.
5. **Finish** with the last ops. You do not clear up: the page takes the marks away, and shows what changed when the person rests on it.

```json
{ "path": "Field/Event 2026-10-04", "note": "Stage 1 of 2: find the first arrivals", "ops": [],
  "reach": ["pfo", "bar", "gor", "isa", "lac"], "total": 5,
  "marks": { "verb": "Picking", "unit": ["station", "stations"], "draw": [
    { "at": "pfo", "shape": "ring", "key": "tool" },
    { "at": "stack", "as": "ahead", "svg": "<polyline points='18,0 26,25 34,50 42,75 50,100'/>" } ] } }

{ "path": "Field/Event 2026-10-04", "note": "Stage 2 of 2: pick each station",
  "ops": [ { "type": "setAttr", "id": "pfo", "name": "data-p", "value": "4.21" } ],
  "marks": { "draw": [
    { "at": "bar", "shape": "ring", "key": "tool" },
    { "at": "pfo", "svg": "<path d='M21 0V100'/>", "text": "P 4.21 s", "x": 21, "y": 0 },
    { "at": "stack", "as": "ahead", "svg": "<polyline points='26,25 34,50 42,75 50,100'/>" } ] } }
```

## Rules the page holds you to

- **Nothing about the work goes in the document.** No status line, caption, chip or pill; no `data-*` flag or class to show state; no `<style>` or `<script>` for the working look; no disabled controls to show you are busy; no cleanup call at the end. If `marks` cannot draw it, it is not drawn.
- **The result is what was asked for, and only that.** A redline, a "was 1 cup", a summary line are the page's review on rest, not content — unless the person asked for a marked-up copy.
- **Nothing talks.** The tag is a verb and a count or measure. No agent, AI, thinking, "Looking for…", or sentences in marks.
- **Quiet ink.** One accent, tints and dashes. No pulse, breathing, pop, glow, sweep, scan line, bracket in the margin, gradient, emoji or coloured stripe down one side.
- **The press that sends is theirs.** Never press Confirm, Send, Book, Pay or Publish: leave everything ready, ring the button `as: "ahead"`, and stop.
- **Their hand wins.** Do not change the part they are typing in; come back to it after. The page already hides your marks there.

## Red flags — stop and redo the card

| You are about to… | Instead |
|---|---|
| insert a `<style>`, a caption or an overlay element "for the working state" | put it in `marks` |
| walk a rule part by part, or in blocks down the page | one call (or dealt batches), the tool on the control that sets it |
| tint everything and call that the tool | name what the specialist holds or sets; tint is only the reach |
| say "Changing 4 of 10 parts" / "items" / "elements" | the card's unit: bars, wells, clauses, stations |
| go top to bottom because that is the DOM | the artifact's order (by date, by round, by generation) |
| give each fan_out worker a tool, a key or a call of its own | fan_out takes one `marks`: words and `ahead` |
| copy an example and swap the nouns | answer the Tool line for this artifact; examples show reasoning, not answers |
| add Keep/Undo buttons or a summary line | nothing: review on rest is the page's |

## Examples

`examples.md` has the spec's stills worked as cards and marks, grouped by the kind of work (filling, placing, measuring, connecting, cutting, matching, reading, rules, judgment), and two derivations for things no still covers. Read the two or three nearest in the *kind of work*, not the subject, and one far away; take their reasoning, then fill in your own card.
