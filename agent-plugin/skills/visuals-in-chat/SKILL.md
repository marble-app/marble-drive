---
name: visuals-in-chat
description: Use when a reply in a Marble Drive conversation would land better shown than described — offering layouts or components to choose between, explaining a structure or flow, comparing before and after, or asking a clarifying question the person could answer by pointing instead of writing. Renders an interactive, themed, responsive card in the transcript from a ```marble-visual block, and turns a click in it into the next message.
---

# Visuals in the chat

The transcript can render one thing that is not text: a fenced block tagged
`marble-visual`. The host puts its body in a sandboxed frame dressed in the
open document's own palette, sizes the frame to its content, and turns a click
inside it into the person's next message.

So: when the answer is a shape, a choice or an amount, **draw it**.

````
Two ways to lay out the card.

```marble-visual Two layouts
<div class="grid">
  <button class="pick" aria-pressed="false" data-answer="Side by side"><b>Side by side</b><span class="meta">Two columns, the picture leading.</span></button>
  <button class="pick" aria-pressed="false" data-answer="Stacked"><b>Stacked</b><span class="meta">One column, the words leading.</span></button>
</div>
```

Pick one and I will build it.
````

Everything on the info line after `marble-visual` is the caption, shown above
the card. The body is a **fragment** — markup, an optional `<style>`, an
optional `<script>`. No doctype, no `<head>`, no boilerplate.

## When

Draw when the thing is visual and the alternative is a paragraph the person has
to imagine:

- **Options.** Anything of the form "I could do A, B or C". Build each one
  small and real — the demo *is* the argument — with one `data-answer` each.
- **A structure.** A flow, a layout, a hierarchy, a before/after. A diagram of
  boxes and arrows beats four sentences about what points at what.
- **A clarifying question with a quantity or a scope in it.** "How wide?",
  "which of these should it cover?", "how far back?" — a slider, chips or a
  segmented control the person moves, and one button that sends the sentence.
- **Something you just changed that they cannot see yet** — a palette, a
  spacing scale, a state machine, a set of icons.

Do not draw a list of steps you took, a summary, a table of numbers that reads
fine as text, or a picture of a box labelled "The Component". One or two per
message, and never a visual that only repeats the paragraph next to it.

## What the host gives you

- **The palette.** `--ink --muted --faint --placeholder --line --paper
  --paper-2 --paper-3 --card --accent --accent-soft --accent-ink --danger
  --caution --radius --ui-font --settle --snap`, live, and repainted if the
  page changes theme. They are the open document's, so a visual in a green
  document is green. Use no other colour.
- **A base sheet**: the design system's type, and these classes —
  `.stack` `.row` `.grid` (auto-fitting columns) `.card` `.pick` (an option
  that is a whole card) `.pill` (a small toggle) `.send` (the one filled
  button) `.label` `.meta` `.quiet`. Your own `<style>` comes after it and
  wins.
- **Its own width.** The frame is a viewport: a `@media (max-width: 420px)`
  inside it fires off the card's width, not the window's. The same visual has
  to read in a 380px drawer and a 900px pane. Test both in your head; prefer
  `.grid` and `flex-wrap` to fixed columns.
- **Its own height.** The frame measures its content and grows. Do not set a
  height on `body`, do not use `position: fixed`, and keep it under ~500px or
  the card is capped and the person has to press Expand.
- **`marble.answer(text)`** sends `text` as the next message.
  **`marble.draft(text)`** puts it in the composer without sending. And
  declaratively, with no script at all: `data-answer="…"` on a `<button>`
  sends on click, `data-draft="…"` drafts. Writing `aria-pressed="false"` on
  those buttons gets the chosen look and clears its siblings for free.

## The rules

1. **Answer in the person's words, not in keys.** `data-answer="Use the
   stacked list."` — a sentence they would be happy to have sent for them, not
   `"A"`.
2. **A widget that adjusts drafts; a button sends.** Slider moves →
   `marble.draft(...)`. *Use this* → `marble.answer(...)`. Never send on every
   keystroke.
3. **Paper and ink and one accent.** Tokens only, no hex, no webfont, no
   emoji as an icon. Tints are `color-mix(in srgb, var(--accent) 10%, …)`.
4. **Hairlines and 12px corners.** `1px solid var(--line)`; 12 for a card,
   999 for a pill, 8 for a small control.
5. **Motion only on interaction**, 110–340 ms, and nothing that moves on its
   own. A press answers in colour, never by scaling.
6. **Reachable.** Real `<button>`s (they answer to Enter and Space), an
   `aria-label` on a group, 44px targets if it could be touched, and text at
   14px — a miniature may be smaller, a control may not.
7. **No network, no storage, no links.** The frame is an opaque origin:
   `localStorage` throws, a font or image URL fails, `target="_blank"` and
   navigation are blocked. Inline SVG, inline data, nothing fetched.
8. **Nothing that has to persist.** A visual is how something is shown or
   asked. What the person picked becomes a message; the message is the record.
   Re-rendering a visual (a reload, a second tab) starts it fresh.
9. **Write it once and finish it.** The block is not streamed into the page as
   it arrives — until the fence closes the person sees *Drawing…* — so an
   unclosed fence is a card that never comes.

## Recipes

[`recipes.md`](recipes.md) has four complete, working blocks to copy: **options**,
**diagram**, **amount**, **scope**. `node tools/visual-shots.mjs` (in the
marble-drive repo) renders them at both widths in both schemes, which is how to
check one before sending it.
