# Agents conversation as a changelog — design (slice A)

> Status: **approved to build**, 2026-09-17. Slice A of the Agents visual
> redesign. Slices B (model/effort slider) and C (board split pane + VS Code
> docking) are out of scope here.

This extends the existing UIST warm / Dusk world. It does not replace Drive
tokens. The conversation is still `<marble-conversation>` in
`runtime/agent-ui.js`, shared by the drawer and `Agents.mrbl`.

## 1. What changes

The transcript stops reading as a chat. Your prompts are changelog entries on
the same paper as the rest of the page — ink on a quiet wash, full width, not
right-aligned black bubbles. A conversation has an editable title. It wears
two tags: the marble document it is editing (colored from the path), and the
agent (provider · model · effort). Typing `/` and then Tab turns the
highlighted command into a composer chip.

## 2. Changelog transcript

Keep the event stream and class names that tests already use (`.msg.me`,
`.msg.agent`, `.tool`, `.turn-footer`). Restyle them:

- `.msg.me` is a turn heading: `align-self: stretch`, `color: var(--ink)`,
  background `var(--paper-2)`, a hairline, 10px radius. Never `var(--ink)` as
  the fill with `var(--paper)` as the text.
- Agent text and tool rows stay left, full measure, no bubble.
- Consecutive turns separate by the heading’s top margin, not a new thread.

## 3. Title

`PATCH /agent/conversations/:id` already accepts `title` (trim, 120 chars).
`<marble-conversation>` grows a mast (hidden until the element has a
`conversation` id):

- An `h2.heading` that is contenteditable. Enter or blur saves via
  `marble.agent.update`. Escape restores the last saved title.
- Empty blur does not PATCH; the heading returns to the saved value
  (or “Untitled”).
- The first user prompt still titles an untitled conversation (existing store
  rule). A later PATCH wins.

The drawer’s recent-menu title button stays. The mast is the place you edit.

## 4. Tags

One fact, one place: `meta.provider`, `meta.model`, `meta.effort`.
Nothing is copied into the Agents file. The target document stays in
the inspector, not as a tag — a conversation started on Agents was
tagging every row "Agents".

- `conversationTags(summary, labels)` in `runtime/agent-ui.js` (exported on
  `window.marbleAgentUI`) returns `{ kind, label, title?, hue }` for the
  agent (`Claude Code`, `Claude API Key`, `Cursor`, …) and for the
  catalog (`Sonnet • high`), hue from provider: Claude clay, Cursor cool,
  else hashed. Model ids like `sonnet` or `claude-sonnet-4-5` show as
  `Sonnet`.
- The mast and each `.conv` row render those tags. CSS maps `data-hue` in both
  light and dark, using the existing paper/ink family — not neon, not black
  pills.

## 5. Slash → chip

`/` still opens the listbox. **Tab** (and only Tab) autocompletes the
highlighted row into a chip in the composer:

| kind | chip | on send |
|---|---|---|
| skill | `/id` | prompt prefixed with `/id ` |
| model | model label | sets the conversation model (also immediately, like the dropdown) |
| effort | effort name | sets effort the same way |
| compact | Compact | prompt is `/compact` plus any typed rest |
| clear | — | Tab still runs Clear; it is not a chip |

One model chip and one effort chip; a new pick replaces. Skills may stack.
Backspace on an empty textarea removes the last chip. Removing a model/effort
chip does not clear the dropdown (the conversation still has that catalog).
After a successful send, skill and compact chips clear; model/effort chips
stay until the person removes them.

Enter on the listbox keeps today’s behavior (complete, and submit for
non-skills).

Sendable when there is typed text **or** a skill/compact chip.

## 6. Out of scope

Dropdowns stay for model and effort (slice B is the slider). Board open still
overlays (slice C). No new npm dependencies. Node 22.
