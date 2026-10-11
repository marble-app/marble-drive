# Agents composer sliders and panes — design (slices B + C)

> Status: **implemented**, 2026-09-17. Continues slice A
> (`2026-09-17-agents-changelog-design.md`).

Same UIST warm / Dusk tokens. No new npm dependencies. Node 22. Do not
reparent the file’s `<marble-conversation>` (reconcile would clone it).

## B. Model and effort sliders

The composer’s model and effort controls are **stepped sliders**, not
`<select>` dropdowns. Settings still uses dropdowns (defaults for new
conversations). Slash chips still set model/effort.

- `input type="range"` with `step=1`, one stop per catalog entry including
  Default (empty id).
- The live label beside the track is the selected name (e.g. `Alt`, `high`).
- Cursor has no effort list: the effort slider stays hidden, same as today.
- Dragging updates the label 1:1; `change` PATCHes the conversation.
- Arrow keys are the native range keys.

## C1. Board is a split, not a pull-over

On the board, opening a conversation **splits the page**: kanban stays in the
left column, conversation in the right. The board is not covered,
not translated, and not `pointer-events: none` overlay.

- `body[data-view=board][data-panel=open]` is a two-column grid under the
  topbar.
- `.list` stays hidden in board view.
- The file’s `<marble-conversation>` stays in `.pane`.
- `.board-panel[data-open]` remains the close flag tests already wait for;
  the close control sits on the conversation column.
- Narrow screens keep today’s full-width sheet.

## C2. Drag to extra panes

In library or board (with a conversation open), dragging a conversation onto
an **edge** of a conversation pane splits that pane and opens the dragged
thread there. Dropping in the **center** focuses/opens it in that pane (today’s
click).

- Extra `<marble-conversation>` elements are created in JS, marked
  `data-marble-transient`, never given a file `data-marble-id`.
- The seeded conversation node is never moved.
- Layout is page-only (`localStorage` `marble-agents:dock`): direction
  (`row` | `col`), whether the file conversation sits at start or end, extra
  leaf ids, sizes.
- At most four panes. Closing the last extra restores the single pane.
- The focused pane drives the list highlight.
- Each pane has a header (grip, title, target document, close). Drag the
  header onto another header to swap chats, or onto an edge to redock.
  Dragging a list row follows the pointer as a card; the row stays in the
  list. A conversation occupies only one pane.
- Layout motion uses `ease-out`.
- A gutter between panes resizes the split (pointer capture, 1:1).
- Narrow / reduced-motion: no extra panes; drag is ignored, click still opens.
