# Visuals in the chat

> An agent that can build an interface should be able to **show** one in the
> answer, not describe it in a paragraph and wait to be told it guessed wrong.

Date: 2026-09-22. Status: built.

Brief: *"design and build a skill that will instruct our coding agents to not
only generate text, but also interactive visuals — demo components to choose
between, SVG diagrams, widgets that help me express what I want when there are
clarifying questions."*

The brief names a skill, but a skill on its own writes markup nobody renders:
the transcript shows agent text and never interprets it (`renderText`, a safe
Markdown subset built with `textContent`). So this is two things — **a surface
the chat can render** and **a skill that teaches an agent to use it well** — and
the surface has to come first.

Decided and built without a round of approval per the standing instruction for
design work here: decide, record the reasoning, check in at milestones.

## What a visual is

One fenced block in an ordinary agent message:

~~~
```marble-visual Three ways to lay out the card
<div class="options">…</div>
<style>…</style>
<script>…</script>
```
~~~

The fence tag is the whole protocol. Everything after it on the info line is the
caption. The body is an HTML *fragment* — no `<!doctype>`, no `<head>`, no
boilerplate — and the host wraps it in a document of its own before showing it.

Why a fence and not a tool: it works on every provider (Claude, Cursor, the
documents-only capability with five MCP tools), it streams, it is recorded in
the turn's text event, so a reload re-renders it with no new storage, no new
route, and no server round trip. A tool would have needed all four.

## What the host does with it

`runtime/chat-visual.js`, dynamically imported the first time a visual appears
(the pattern `choice-question.js` already uses), turns the block into a card in
the transcript:

```
figure.visual
  .visual-head    caption · Sent · [Code] [Expand]
  iframe.visual-frame  sandbox="allow-scripts"  srcdoc=<the wrapped document>
  pre.visual-code (hidden)
```

**The frame is sandboxed with `allow-scripts` and nothing else.** No
`allow-same-origin`, so the visual runs at an opaque origin: it cannot read the
parent document, the drive's cookie, or storage, and it cannot navigate the tab.
Interactive means interactive — a visual that could not run script could not be
a widget — and this is the boundary that makes that safe on a drawer that sits
on top of every document. It is the same posture as the blob route's
`default-src 'none'; sandbox`.

**The wrapper carries the design system in.** The host reads the conversation
element's own computed tokens — `--ink --muted --faint --line --paper --paper-2
--paper-3 --card --accent --accent-soft --accent-ink --danger --caution
--radius --ui-font` — and writes them into `:root` in the srcdoc, plus
`color-scheme` derived from the paper's luminance and `--visual-font-size`
taken off the transcript's own `.log`, because a phone reads at seventeen and a
card set at fourteen beside it is a picture of a smaller app. Those tokens are already the
page's: `applyPageTheme` copies the open document's palette onto the chrome, so
a visual in a conversation about a green Research document is green, and the
same visual in Bryan's Days is that document's accent. A theme change repaints
mounted frames with a `postMessage`; nothing reloads.

**Sizing is the frame's own job.** The wrapper measures its content wrapper with
a `ResizeObserver` and posts `{what:'size', height}`; the host sets the iframe's
inline height and lets CSS cap it (`min(70vh, 560px)`, `85vh` when expanded).
Because it *is* a frame, the visual's own `@media (max-width: 420px)` fires off
the card's width, not the window's — one visual is legibly responsive in a
380px drawer, a Focus pane and a phone with no work by the author beyond a
sensible grid.

**Answering is a message.** The wrapper exposes `marble.answer(text)` and
`marble.draft(text)`, and wires two declarative attributes so the common case
needs no script at all:

- `data-answer="…"` on a `<button>` — click sends that text as the reply.
- `data-draft="…"` — click puts it in the composer without sending.

The host takes `answer` through the same path the prose choice-picker already
uses (`this.input.value = text; this.submit()`), so queueing, steering and the
sending guard are the ones that already exist. Guards: 600 ms between answers
from one card, 12 per card, 2000 characters, and the card marks itself `Sent`.

**Streaming does not leak.** A half-written visual would otherwise dump raw HTML
into the transcript as it arrives. While a `marble-visual` fence is open, the
live message renders the text before it plus a quiet *Drawing…* placeholder; the
real card appears when the finished text event lands.

**It degrades rather than hangs.** A host that cannot serve
`runtime/chat-visual.js` — an older one, a reload with no network — shows the
block as code. A placeholder that shimmers for ever is the worse failure.

## What the skill teaches

`.claude/skills/visuals-in-chat/SKILL.md` — when to show instead of tell, the
three shapes (options to choose, a diagram, a widget that answers a question),
the wrapper's contract, and the house style: paper and ink and one accent,
hairlines, 12px corners, 14px sans, no webfonts, no colour the tokens do not
name. `recipes.md` holds four copy-ready patterns.

Three sentences in `server/agent/instructions.js` (all three capabilities) name
the affordance, because a skill nobody knows about does not fire: an agent in a
project that has no copy of the skill still knows the fence exists.

## Rules the skill insists on

1. **A visual replaces a paragraph; it never repeats one.** One or two per
   message.
2. **Show a real thing.** A demo component is the component, at the size it will
   be. A diagram is the structure, not a picture of a box labelled "Structure".
3. **Every visual that asks something answers itself** — a `data-answer` button
   per option, so the person clicks rather than types a paragraph back.
4. **The tokens are the palette.** No hex in a visual's CSS except through a
   token; `color-mix` against `--accent` for tints.
5. **No network, no storage, no links.** Opaque origin: `localStorage` throws,
   `target=_blank` is blocked, a font request fails. Inline SVG only.
6. **Nothing that moves without being asked.** Transitions on interaction,
   110–340 ms, `--settle`/`--snap`; honour `prefers-reduced-motion`.

## Testing

- `test/chat-visual.test.js` — the pure half in node (8): fence parsing,
  caption, the wrapper document (tokens present, a token value that would close
  the rule dropped, fragment not escaped, bridge attached), the streaming mask,
  answer-message validation, clamping.
- `test-browser/chat-visual.test.js` — the real thing in Chromium against the
  scripted fake provider (16): the card renders and the prose around it stays
  prose, the frame is sandboxed without `allow-same-origin`, the palette
  arrives and is repainted live, it sizes to exactly its content and answers to
  its own width, `data-answer` sends a turn and `marble.draft` does not, Code
  and Expand work (and Expand is offered only when the card is holding
  something back), a visual cannot reach the parent (`window.__pwned` stays
  undefined), raw HTML never appears in the log while streaming, a reload
  re-renders from the stored transcript, two visuals in one message answer
  independently, the card reads at the phone's seventeen, its caption stays out
  of the callout's one line, and a host that cannot serve the module shows the
  markup.
- `node tools/visual-shots.mjs` renders the skill's four recipes at drawer and
  pane width in light and dark — the seeing loop, and the check that the
  documented recipe is the one that renders.

## Rejected

- **A tool call (`show_visual`).** Needs a new route, new storage, new replay,
  and does not exist on providers whose tool list Marble does not control.
- **Inline SVG rendered into the shadow root.** Cheaper for a static diagram,
  but then interactive visuals need a second mechanism and a sanitizer — two
  paths, two sets of bugs. One card renders everything.
- **A full-screen compare surface.** `<marble-alt>` and its compare surface
  already do that job for versions of a *document element*. A chat visual is
  part of a sentence; it grows full-bleed in place and no further.
- **Persisting widget state.** A visual is how something is shown or asked, not
  where anything is kept. What the person picked becomes a message, and the
  message is the record.
