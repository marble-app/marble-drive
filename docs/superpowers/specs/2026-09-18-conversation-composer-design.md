# The conversation: an editor you can point with, and a transcript you can read

> Status: **approved to build**, 2026-09-18. Continues
> `2026-09-17-agent-conversation-controls-design.md` (queue modes, tool
> collapse, choice picker) — whose server half (store, runner, routes,
> `runtime/agent.js`, `runtime/choice-question.js`) is now on this branch —
> and `2026-09-16-agent-interface-design.md`. Where this document contradicts
> the controls spec, this one wins. It does not touch the Agents page
> (`templates/agents.mrbl`), which `2026-09-18-agents-ui-overhaul-design.md`
> owns, nor the messaging work in `2026-09-18-agent-messaging-design.md`.

Same UIST warm / Dusk tokens. No new npm dependencies. Node 22. Do not
reparent `<marble-conversation>`. Agent chrome stays transient. Agent text is
never `innerHTML`.

## 1. Why

Seven things Bryan named, looking at two panes side by side on 2026-09-18:

| # | Ask | What it is today |
|---|---|---|
| 1 | Both panes should keep their heading and controls; only the focused one shows them now. | `:host([data-chrome="tile"])` hides `.heading`, `.mast`, `.statusline`, `.setup`. |
| 2 | The line above the controls (agent · model · usage · documents changed · path · branch) repeats the mast; drop it and make the controls take less height. | `.statusline` (two lines) + `.setup` row + `.context` row + the input card: four stacked rows. |
| 3 | The "Agents" pill is the document the message is about; make it part of the prompt the way pasted things are. | `.context` is a row above the input, outside the text. |
| 4 | Pasted images and text should sit inline in the text so they can be referred to, not in a strip above it. | `.attachments` strip above the textarea; blocks prepended to the prompt. |
| 5 | Runs of `Tried Bash` / `Tried Read` should fold up, and say what was read or searched. | One `.tool` row per call; unknown tools print `Tried <name>`. |
| 6 | Clarifying questions should be interactive, as in other coding-agent UIs. | `AskUserQuestion` gets a card with plain buttons; questions asked in prose get nothing. |
| 7 | Queueing should be interactive: a list of queued prompts, sent one at a time or as a batch, each as queue / steer / interrupt. | One `Queued: …` row with ×. Server side of dispatch and combine is built (this branch), the UI is not. |
| 8 | Typing `- ` in the box should start a bullet list, because a prompt is often a to-do list. | A `<textarea>`. |

## 2. Decisions

Recorded here so they can be reviewed rather than re-asked.

| Topic | Decision | Why |
|---|---|---|
| Editor element | A `contenteditable` `div.editor` replaces the `<textarea>`. It exposes a `value` accessor (serialized text), so `this.input.value` and tests' `el.value` keep working. | Inline chips and lists need element children; a textarea cannot hold them. |
| Attachment reference in the prompt | Blocks still travel at the top as `<pasted-text index="n">` / `<pasted-image index="n">`; the chip in the text serializes to `[image n]` or `[pasted text n]`. | Keeps the prompt format tests and the agent already read; gives the person a token to point at ("compare [image 1] with [image 2]"). |
| Context chip | The document chip (`Agents · 3 selected`) is an inline chip at the start of a fresh message. Removing it drops the selection; the target document still travels, because a turn cannot exist without one. It serializes to nothing. | Bryan asked for it to live with the pasted things. The server requires `context.target`; lying about that would be worse than a chip that reads "don't send my selection". |
| Enter vs bullets | Enter sends. Shift+Enter makes a newline, and inside a list item makes the next item (an empty item exits the list). | Same as Slack; keeps the one rule every test and finger already knows. |
| List markers | `- ` and `* ` start a bullet; `1. ` starts a numbered list. Lists serialize as `- item` / `1. item` lines. | The agent reads Markdown; the sent bubble renders the same lines back as a list. |
| Status line | Removed. The mode (Default / Plan) becomes a small button in the composer bar. Usage, documents changed, path and branch are not shown in the composer. | Bryan: redundant with the mast; the turn footer already says what changed; usage meters live in the drawer header and the Agents page. |
| Setup row | Kept (presets capsule, Custom, segmented picker) but moved inside the input card as its bottom bar, beside the mode button and the send button. | Rewriting the picker into a popover would invalidate a dozen tests another session is mid-way through; the row itself is one line once the status line and the context row are gone. |
| Tiles | A tile keeps its mast and controls; only padding shrinks. | Ask #1. |
| Tool grouping | A run of consecutive finished tool rows — any names — folds into one `.tool-group` line that counts by kind and names sources. The in-flight row stays visible under it; failed and refused rows never fold. | Bryan's example interleaves Bash and Read; grouping by name alone would still leave six lines. |
| Tool labels | Every known CLI tool gets a verb and its source (`Read harness.js`, `Grep packFocus`, `Ran node --test …`); unknown tools show the name and their first short string argument. `Tried` goes away. | "Tried" says nothing; the source is what the person wants to see. |
| Question card | One card per ask; each question stacked with numbered options (label + description), an **Other…** free-text row, ↑ ↓ / digits / Space / Enter. Permission cards keep Allow / Deny + reason. | Matches the CLI's own AskUserQuestion; the existing `.ask[data-kind]`, `[role="radio"]`, `button.allow`, `button.answer` hooks stay. |
| Prose questions | The last `text` of a finished turn is parsed with `parseChoiceQuestion` (already built); a match renders a `.choice-ask` picker under it. | Cursor has no ask channel; its questions arrive as prose. |
| Queue UI | Rows with a dispatch button (Queue → Steer → Interrupt), editable text, ×; a `Send individually` / `Send as one prompt` switch at two or more rows; and while a turn runs, a dispatch chooser in the composer bar so the next send can be queue, steer or interrupt before it is sent. ⌘Enter is still steer. | Ask #7. The controls spec kept interrupt off the composer; Bryan asked for all three there. |
| Steer | Still wait-then-wrap (the runner's `STEER_NOTE`). No mid-turn injection. | Unchanged from the controls spec; a stdin steer is a later project. |
| Serving the parser | `agent-ui.js` is a classic script; it loads `parseChoiceQuestion` with one `import('/runtime/choice-question.js')`, cached, the first time a turn finishes. | One copy of the parser, testable under node. |

## 3. The editor

### 3.1 DOM

```
<div class="editor" contenteditable="true" role="textbox" aria-multiline="true"
     aria-label="Message" data-placeholder="Ask about this document…">
  <span class="ichip" data-kind="context" contenteditable="false">
    <span class="context-text">Agents · 3 selected</span><button class="context-clear">×</button>
  </span>
  Compare <span class="ichip" data-kind="image" data-key="a1" contenteditable="false"><img …><span>shot.png</span></span> with
  <ul><li>the first draft</li><li>the second</li></ul>
</div>
```

Chips are `contenteditable="false"` so the caret skips over them and Backspace
removes them whole. Every chip keeps a `data-key` that names the attachment it
stands for (the context chip has none).

`.context-text` and `.context-clear` keep their names: tests read the text and
press the ×.

### 3.2 `value`

`Object.defineProperty(editor, 'value', { get, set })`.

**get** walks child nodes in order:

| node | text |
|---|---|
| text node | its text |
| `<br>` | `\n` |
| `<div>` / `<p>` (browser or paste) | `\n` before, then its children |
| `<ul>` | each `<li>` as `- ` + inline children + `\n` |
| `<ol>` | each `<li>` as `{n}. ` + inline children + `\n` |
| `.ichip[data-kind="image"]` | `[image {index}]` |
| `.ichip[data-kind="text"]` | `[pasted text {index}]` |
| `.ichip[data-kind="context"]` | nothing |

where `index` is the chip's 1-based position among attachment chips in document
order. A single trailing `\n` is dropped. Non-breaking spaces become spaces.

**set** clears the editor and inserts the text: lines joined by `<br>`, runs of
lines that start with `- ` / `* ` / `1. ` become lists. It is used by the slash
handlers (`/opus rest of prompt`) and by clearing after a send. Setting `value`
drops chips; the class then reconciles attachments (§3.5).

### 3.3 Keys

| Keys | Effect |
|---|---|
| Enter | Submit (slash menu first, as today). |
| ⌘Enter / Ctrl+Enter | Submit as `steer` when a turn is running; plain send otherwise. |
| Shift+Enter | In a list item: a new item after it; on an empty item: leave the list (paragraph line). Else: `<br>`. |
| Space | If the current line so far is exactly `-`, `*` or `1.` (and the caret is not already in a list item), replace the line with a list and one empty item. |
| Backspace | At the start of an empty first item: turn the list back into a line. At the start of a later empty item: remove the item and leave the list. Otherwise native (a chip before the caret goes whole). |
| Tab / Shift+Tab, ↑ ↓, Escape | Slash menu and mode cycling as today. |

"Line so far" is the text between the caret and the nearest preceding `<br>`,
block start, or editor start.

### 3.4 Paste and drop

Same thresholds as today (`PASTE_LINES`, `PASTE_CHARS`, image types, 8 MB).

- An image → `attachImage(file)` → an image chip **at the caret**.
- Long text → `attachText(text)` → a text chip at the caret.
- Short text → inserted at the caret as plain text (`insertText`), newlines
  kept.
- A dropped image → chip at the end of the editor (a drop has no caret).

After inserting a chip a single space follows it so typing continues.

### 3.5 Attachments follow the DOM

`this.attachments` stays the list of `{ key, kind, name, … }` records. After
every `input` event the class reconciles: a record whose chip is gone is
dropped (blob URL revoked, peek closed); a context chip that is gone sets
`skipSelection = true`. Fill, cut, select-all-delete and Backspace all end up
in the same place.

`updateContext()` puts the context chip back at the start of the editor when
`skipSelection` is false and no context chip is present (a new message, or the
selection changed), and rewrites its text otherwise. It never moves a chip the
person left somewhere else in the text.

### 3.6 Size

The editor grows with its content to `max-height: 160px`, then scrolls.
`autosize()` becomes `updateSendable()` only. The placeholder is CSS
(`.editor:empty::before`, and `.editor[data-empty]` when only a context chip
is present).

### 3.7 Sending

`submit()` reads `this.input.value`; `packAttachments()` walks `this.attachments`
in **chip order** (document order of `.ichip[data-key]`), so `[image 1]` in the
text and `index="1"` in the block agree. Everything else in `submit` is as
today, plus `dispatch` (§7).

## 4. The composer

```
┌─ .row ─────────────────────────────────────────────────────────┐
│ [Agents · 3 selected] Ask about this document…                 │
│                                                                 │
│ (⧉ Sonnet High | Opus XH | Grok High | ⋯) Custom   Default     │ ← .bar
│                                     [Queue|Steer|Interrupt] ■ ↑ │
└─────────────────────────────────────────────────────────────────┘
```

- `.composer` holds `.slash`, `.peek`, `.queued` (moved in from above, §7) and
  `.row`. The `.statusline` and the `.context` row are gone; `paintStatus`
  now only paints the mode button and the tags.
- `.row` is the card: `.chips` (skill / model / effort chips, as today), the
  `.editor`, then `.bar`.
- `.bar` is one flex row, `gap: 6px`, `align-items: center`, `flex-wrap: wrap`:
  `.setup` (presets capsule, Custom toggle, and — when Custom is open — the
  segmented `.picker`, which wraps to its own line inside the bar), the
  `.mode` button (`Default` / `Plan`, click or Shift+Tab cycles; hidden when
  the provider has no modes), a spacer, `.dispatch` (§7, only while running),
  `.stop`, `.send`.
- The presets capsule and the picker keep their classes and their fit logic;
  `fitPicker` measures against the bar's width minus the buttons, which is
  what it already does through `scrollWidth`.
- Heights: the card is `editor + bar`; the bar is 28px tall. The composer
  padding drops from `8px 12px 12px` to `6px 10px 10px`.
- Tiles: `:host([data-chrome="tile"])` keeps `.mast` and `.setup`; it only
  tightens `.composer` and `.log` padding. The `data-focused` dim/lit rules the
  overhaul spec adds sit right after this block.

## 5. Sent messages

`userMessage(text)`:

1. `splitPasted(text)` → `blocks`, `rest`.
2. `rest` is rendered with `renderText(rest, { chip })`, where `chip(kind, n)`
   returns the same `.ichip` the editor showed (an image thumbnail or a
   `Pasted text · 60 lines` chip) for the block with that index; clicking it
   opens the peek. `inline()` gains the token rule
   `\[(image|pasted text) (\d+)\]`, used only when a `chip` hook is given.
3. Blocks with no token in the text (an old message, or a chip the person
   deleted from the text but not the list — impossible now, but old events
   exist) are appended after the text as a strip, as today.

`.msg.me` loses `white-space: pre-wrap` in favour of the rendered paragraphs
and lists (`.msg.me p`, `.msg.me ul/ol` rules mirror `.msg.agent`'s). The
messaging spec's `from` parameter and "From <sender>" line sit above this and
are unaffected.

## 6. Tool rows

### 6.1 Labels

`toolLabel(name, input)` gains cases; each also records `data-short` (the kind)
and `data-source` (what it touched) on the row:

| tool(s) | label | source |
|---|---|---|
| `Bash`, `shell`, `Shell` | `Ran ` + `description` or the command trimmed to 60 chars | same |
| `Read`, `read_file` | `Read <tail>` | file tail |
| `Grep` | `Grep <pattern>` (+ ` in <tail>` when `path`) | pattern |
| `Glob` | `Glob <pattern>` | pattern |
| `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | `Edited <tail>` / `Wrote <tail>` | file tail |
| `LS` | `Listed <tail>` | tail |
| `WebFetch` | `Fetched <host>` | host |
| `Task`, `Agent` | `Agent · <description>` | description |
| `TodoWrite` | `Updated todos` | — |
| `Skill` | `Skill /<name>` | name |
| the Marble tools | as today | path |
| anything else | `<name>` + first string input value ≤ 60 chars, if any | that value |

`<tail>` is the last path segment. `toolShortName(name)` (already built) is
the kind used in group labels and `data-short`.

### 6.2 Groups

After any tool row changes state (`toolResult`, `opsApplied`, `opsRefused`,
`documentChanged`) and at `finish`, the class calls `regroup(turn)`, which is
`window.marbleAgentUI.collapseToolRows(logEl, footer)` on the range of that
turn's nodes:

- Walk the turn's children in order. A **run** is a maximal sequence of
  consecutive `.tool[data-state="done"]` rows (including `document.changed`
  rows), with nothing else between them. A `.tool-group` already in the walk
  counts as its members.
- `pending`, `failed` and `refused` rows are never members and end a run.
- A run of ≥ 2 becomes one `.tool-group`:
  ```
  <div class="tool-group" data-open="false">
    <button class="tool-group-head" aria-expanded="false">
      <span class="tool-group-count">7 steps</span>
      <span class="tool-group-kinds">Bash ×4 · Read harness.js, agents.mrbl +1 · Grep packFocus</span>
    </button>
    <div class="tool-group-body" hidden> …the rows… </div>
  </div>
  ```
  Kinds are listed in order of first appearance; each names up to two distinct
  sources and `+k` for the rest. The whole kinds string is also the head's
  `title`.
- A finished row that lands right after a group joins it; an open group stays
  open. A run of 1 stays a plain row.
- Click toggles `aria-expanded` / `data-open` and `hidden` on the body. No
  animation.

`collapseToolRows` and `toolShortName` are exported on `window.marbleAgentUI`.

## 7. Queue

Server, routes and client API are on this branch (`dispatch`, `behind`,
`bundle`, `combined`, `queueCombine`, `patchQueued`, `user.edited`,
`turn.dispatch`, `turn.combined`, `agent.send({ dispatch })`,
`agent.patchTurn`).

### 7.1 Rows

`.queued` sits inside `.composer`, above `.row`:

```
[ Send individually | Send as one prompt ]           ← .queued-bar, at ≥ 2 rows
[Queue ▾] fix the drag jitter first                ×  ← .queued-item[data-dispatch]
[Steer ▾] also rename packFocus                    ×
```

- `.queued-dispatch` is a button; click cycles queue → steer → interrupt →
  queue and PATCHes `dispatch`. `aria-label` says the mode and that a click
  changes it. Interrupt is `--caution`.
- Click `.queued-text` to edit in place (a one-line `contenteditable` span);
  Enter or blur PATCHes `prompt`; Escape restores; × still dequeues without
  saving.
- `.queued-bar` is `queueCombine`; pressed state from `data-combine` on
  `.queued`; hidden at 0–1 rows.
- `load()` reads `queueCombine` from meta; `turn.queued` carries `dispatch`;
  `user.edited` rewrites the bubble and the row; `turn.combined` removes the
  row and keeps the bubble.

### 7.2 The composer's dispatch

While `this.running` is set, `.dispatch` appears in the bar: a segmented
`Queue | Steer | Interrupt` (same capsule pattern as the presets, 11px). Enter
and the send button send with the chosen mode; ⌘Enter always sends `steer`.
The choice resets to Queue when the turn ends. Idle sends have no chooser and
send with `queue` (`behind` is false, so nothing wraps).

## 8. Asks

### 8.1 Question card

```
<div class="ask" data-kind="question" data-request>
  <div class="ask-q">
    <div class="ask-title">Which layout?</div>
    <div class="ask-options" role="radiogroup">
      <button role="radio" aria-checked><kbd>1</kbd><b>Side by side</b><small>Two panes, equal width</small></button>
      <button role="radio"><kbd>2</kbd><b>Stacked</b><small>…</small></button>
      <button role="radio" class="ask-other"><kbd>3</kbd><b>Other…</b></button>
      <input class="ask-other-text" hidden placeholder="Type an answer">
    </div>
  </div>
  … one .ask-q per question …
  <div class="ask-actions"><button class="answer">Answer</button></div>
</div>
```

- ↑ ↓ move focus (wrap); digits 1–9 select; Space toggles; Enter answers (the
  focused option first if nothing is checked). Multi-select questions use
  `role="checkbox"`.
- Choosing **Other…** reveals the input and focuses it; its text is that
  question's answer.
- `askResponse` is unchanged except that an "other" answer is passed as the
  chosen label.
- The first option takes focus when the card appears, as today.

### 8.2 Permission card

As today, restyled to the same card: title `Allow Bash?`, the command in a
`pre`, Allow (accent), Deny, reason field. Enter on a focused button presses
it; nothing else changes.

### 8.3 Prose questions

In `finish()`, after the footer: if the turn's last `text` node exists and
`parseChoiceQuestion(text)` matches, a `.choice-ask` group is appended under
that message — `role="group"`, one `button[role=radio|checkbox]` per option
with its key as the `kbd`, ↑ ↓ / Space / Enter / digits as in §8.1, a small
**Send** button. Submitting sends `A, C — label A; label C` through
`submit()`. A custom reply typed in the composer leaves the picker until that
send succeeds. Escape clears checks. The picker is not stored.

## 9. Files

| Unit | Change |
|---|---|
| `runtime/agent-ui.js` | Editor (§3); composer bar and status removal (§4); `userMessage` rendering (§5); `toolLabel`, `collapseToolRows`, `regroup` (§6); queue rows, bar, dispatch chooser (§7); ask card and `.choice-ask` (§8); tile CSS. Exports `collapseToolRows`, `toolShortName`, `parseChoiceQuestion` (once loaded) on `window.marbleAgentUI` on a new line after the existing export. |
| `runtime/choice-question.js` | Already on the branch. Unchanged. |
| `test-browser/composer-editor.test.js` | New: bullets, Shift+Enter, Backspace out of a list, `value` round trip, inline image and text chips, chip order = block index, context chip removal drops the selection, fill drops chips and attachments. |
| `test-browser/composer-attachments.test.js` | Chips inline instead of a strip; the sent bubble shows the chip in the text. |
| `test-browser/conversation.test.js` | `textarea` → `.editor`; status test becomes a bar test (mode button; no usage/path); tiles keep controls; tool groups; question card with Other; `.choice-ask`; queue rows, dispatch, edit, combine; composer dispatch chooser; ⌘Enter steers. |
| `test-browser/drawer.test.js`, `drive-aim.test.js` | `textarea` → `.editor` where they type. |
| `test/fixtures/fake-agent.mjs` scripts in `harness.js` / tests | A `tools` script with six mixed calls; a `question` ask with descriptions; a prose `choice` script. |

## 10. Build order

Each phase leaves every suite green and is committed on its own.

| Phase | Sections | Why this order |
|---|---|---|
| A | 3, 5 | The editor is what everything else sits in; sent rendering is its mirror. |
| B | 4 | Chrome: status out, bar in, tiles show. Independent of A but reads better once chips are inline. |
| C | 6 | Tool labels and groups; self-contained. |
| D | 8 | Ask cards and the prose picker. |
| E | 7 | Queue UI last: it adds the dispatch chooser to the bar B made. |

## 11. What we are not building

- A popover model picker; a rich-text editor beyond chips, `<br>` and lists
  (no bold, no headings, no nesting).
- Mid-turn steering over stdin.
- An AskQuestion MCP tool for Cursor.
- Grouping a subset of the queue, or reordering it by drag.
- Changes to `templates/agents.mrbl`, the pane tree, or the Agents page.
