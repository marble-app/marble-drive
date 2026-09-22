# The peek: resting on a Focus card tells you what that chat was about

**Date:** 2026-09-22
**Status:** design, built the same day
**Scope:** `runtime/agent-folders.js` (`peekOf`, pure), `templates/agents.mrbl` (the peek card, hover wiring, Quick Look rewritten on top of it), `drive/Agents.mrbl` (one style+script patch), tests
**Builds on:** the Focus canvas (`2026-09-18-focus-*`), and the Space-bar Quick Look that has been on the page since it was built

## 1. What a card does not say

A Focus card carries a title, a folder colour, a path, one line of activity
and an age. That is enough to *find* a chat and not enough to *remember* it.
Titles are auto-written and they generalise: "Marble Drive UI Fix", "Agent
Tray Design", "Focus View Layout State". Twenty cards on a canvas, and the
question you actually have — *which one was the one where I asked for the
hover thing?* — is answered by neither the title nor the activity line.

The two things that answer it are the last thing you asked and the last thing
that came back. Both are on disk. Neither is on the card, and neither fits on
the card: a digest is a hundred and sixty pixels tall.

So they go where extra detail goes when the room is already spent — on the
hover, beside the card, for as long as the pointer rests there.

## 2. One object, two registers

There is already a Quick Look on this page: Space over a selected card opens
`.focus-look`, a translucent card beside it. Its body lists `row.type ||
row.text` for the last eight events, which in practice reads

    tool.call
    tool.result
    tool.call
    tool.result

— the shape of the work, with the work removed. It is the right object with
nothing in it.

So the hover peek is not a second thing. It is the same `.focus-look`, given
a real body, opened two ways:

- **Hover** — rest on a card for 420 ms and it appears. Transient: it closes
  when the pointer leaves, it does not take pointer events, and it never
  scrolls (what does not fit is clamped away, because a peek you have to
  scroll is a window you should have opened).
- **Space** — the same card, *held*. It stays until Escape, a click, or Space
  again; arrows move it from card to card, as they already do. Held, it takes
  pointer events and may scroll.

Hover is ignored while one is held. Two registers, one object, and the
keyboard path keeps the behaviour it had.

## 3. What the peek says

Top to bottom, and each part is dropped when it is empty rather than drawn as
an empty row:

1. **Head** — the status dot, the title, the age. The same three marks the
   card wears, so the peek reads as that card enlarged and not as a new thing.
2. **Meta** — path · model · how many turns. One muted line.
3. **You asked** — the last turn's prompt, clamped to three lines. This is the
   part that answers the question; it is first for that reason.
4. **Now** (running) or **It said** (idle) —
   - running: the last three tool calls, newest last, one line each, plus the
     activity line the card already shows;
   - idle: the last thing the agent said, clamped to five lines.
5. **Touched** — the documents this chat wrote to, most recent first, as the
   same pills a card wears for tags.

Markdown is stripped rather than rendered. A peek is a glance, and `**bold**`
in a glance is noise either way — as syntax or as weight.

### Where it comes from

`GET /agent/conversations/:id` already answers with `{ meta, turns, events }`.
The prompts are in `turns` (whole, one per turn); the answer, the tool calls
and the document writes are in `events`. So the peek needs no new route.

It is a large answer for a hover — a long chat's event log runs to hundreds of
kilobytes — so it is fetched once per chat and cached against that chat's
`updatedAt`, and a fetch that lands after the pointer has moved on is dropped.
A tail parameter on that route is the fix if this ever costs anything
measurable; it does not today, on a local host.

`peekOf({ meta, turns, events })` is pure and lives in `runtime/agent-folders.js`
beside the rest of the Focus logic, so Node tests it directly. It returns
facts — `{ asked, said, doing: [{name, input}], touched, turns, tools }` —
and the page turns them into lines, because the tool labeller
(`window.marbleAgentUI.toolLabel`) is a browser thing and `agent-folders.js`
is imported by the host.

## 4. When it does not appear

- while a card is being dragged, or the canvas is being marquee-selected;
- over a **Full** card — the pane on top of it *is* the conversation;
- on a phone, or any `hover: none` pointer;
- outside the Focus view;
- while a held peek is open (§2).

It closes on: pointer leave (after a 120 ms grace, so crossing the gap between
two cards does not flicker), pointer down, scroll, view change, Escape.

A peek is **not** a review. Seeing a pane clears Needs review; resting a
pointer on a card does not, and must not — the whole point of the peek is to
decide whether to open the thing.

## 5. Motion

A tooltip that animates in slowly is a tooltip you wait for twice. It fades
and rises 4 px over 120 ms, and it is placed, not eased, when it moves from
one card to the next: the delay is the gesture, the arrival should be
instant. Under `prefers-reduced-motion` it simply appears.
