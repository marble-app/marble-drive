# Agent conversation controls — design

> Status: **approved to build**, 2026-09-17. Continues the conversation view
> (`2026-09-16-agent-interface-design.md`, changelog / sliders / panes).

Same UIST warm / Dusk tokens. No new npm dependencies. Node 22. Do not
reparent the file’s `<marble-conversation>`. Agent chrome stays transient.

## 1. What we are building

Four slices of `<marble-conversation>` (drawer and Agents page, same element):

1. **New-chat catalog.** Model + effort (and agent) picked on a blank composer
   become the next new chat’s defaults. Changing an existing thread does not.
2. **Queue controls.** Edit a queued message. Each row is `queue` / `steer` /
   `interrupt`. The list has one switch: send individually vs as one prompt.
   Enter queues; ⌘Enter steers. No mid-turn inject into the CLI.
3. **Tool progress.** Consecutive same-name tool rows collapse (`Shell ×6`).
   The in-flight call stays visible. Failures and refusals never hide.
4. **Choice picker.** The last finished agent message, when it looks like a
   question plus options, gets ↑ ↓ Space Enter selection. Composer still works.

## 2. Decisions locked in design

| Topic | Decision |
|---|---|
| Steer | Wait, then wrap the model-facing prompt as course-correction. CLI stdin stays closed after spawn. |
| Interrupt | Cancel the running turn, then start this message (or the combined batch). |
| Combine | One conversation flag. Rows stay visible. Fire as one numbered list. |
| Batch dispatch | Interrupt if any row is interrupt; else steer if any is steer; else queue. |
| New-chat defaults | Blank composer writes `settings.models` / `efforts` / `defaultProvider`. Existing chats write only conversation meta. |
| Tools | Consecutive same `data-name`, click to expand. Pending / failed / refused break the group. |
| Questions | Parse the last finished agent `text`. No AskQuestion tool in v1. |
| Interrupt shortcut | Not on the composer. Set it on a queued row. |

## 3. Data model and runner

Queued turns stay queued turns. New fields, not a second queue.

### 3.1 Turn (`turns/<id>.json`)

| Field | Meaning |
|---|---|
| `dispatch` | `queue` \| `steer` \| `interrupt`. Default `queue`. |
| `behind` | `true` if, at `send`, this conversation already had a running or queued turn. |
| `bundle` | Optional `string[]`. When combining, the survivor stores every queued prompt in order (including its own). Absent means use `prompt` alone. |
| `prompt` | What the person typed. Edit PATCHes this while `status === 'queued'`. |

New terminal status: `combined`. Extra turns in a combined batch leave the
queue this way. They never ran. Listings that treat `queued` / `running` as
live must ignore `combined`.

### 3.2 Conversation (`meta.json`)

`queueCombine`: boolean, default `false`. One switch for the whole list.

### 3.3 Settings

Same maps the settings panel already uses: `defaultProvider`, `models[provider]`,
`efforts[provider]`.

- **Blank composer** (no `conversation` attribute): on agent / model / effort
  change, `saveSettings` with those keys. Empty “Default” deletes that
  provider’s model or effort key.
- **Existing conversation:** `persistCatalog` stays a PATCH on that
  conversation only.
- **New conversation POST:** already falls back to those maps when the body
  omits model / effort. Blank-composer writes make the next `start()` inherit
  them even if the client sent nothing.

### 3.4 Events

Events stay append-only.

| Event | When |
|---|---|
| `user` | Unchanged. The typed text. |
| `user.edited` | `{ turn, text }` after a queued prompt PATCH. UI replaces that turn’s `.msg.me`. |
| `turn.queued` | Unchanged. Include `dispatch` so a reload paints the row mode. |
| `turn.combined` | Extra turns dropped into a bundle. Queue row goes. **Do not** `forget()` the user bubble (unlike `turn.removed`). |
| `turn.removed` | Dequeue. Unchanged: queue row and that turn’s log nodes go. |

### 3.5 APIs

`POST /agent/conversations/:id/turns` body gains optional `dispatch`. Invalid
values → 400. Idle send with `steer` is allowed; `behind` is false, so no wrap.

`PATCH /agent/turns/:id` while `status === 'queued'`: `{ prompt?, dispatch? }`.
Otherwise 409. Prompt trim; empty prompt → 400. After a prompt patch, append
`user.edited`. After a dispatch patch, if the new batch rules say interrupt
and a turn is running on that conversation, cancel it, then `pump()`.

`PATCH /agent/conversations/:id` accepts `queueCombine` boolean. If the flag
becomes true and any queued turn is `interrupt` (or the batch rule is
interrupt) while one is running, cancel then `pump()`.

`window.marble.agent.send(id, { prompt, dispatch, … })`  
`window.marble.agent.patchTurn(turnId, { prompt?, dispatch? })`

### 3.6 Pump

Today: skip a conversation that already has a running turn.

Add:

1. **Interrupt at enqueue / patch time**, not inside `pump`’s skip. If the
   surviving work is interrupt and a turn is running on that conversation,
   `cancel` the running one. `finish` already calls `pump`.
2. **When `pump` would start** the next queued turn for a conversation: if
   `queueCombine` and two or more turns are queued, merge them first.
3. **Merge:** first queued turn is the survivor. `bundle` = each queued
   `prompt` in send order. Survivor `dispatch` = batch rule. Extras → status
   `combined`, `turn.combined`, drop from `live` / `order`. Then `start(survivor)`.
4. **`composePrompt`:** body is a numbered list of `bundle` when present,
   else `prompt`. If `dispatch === 'steer'` and `behind`, wrap once:

   > While you were working I added this note. Treat it as course-correction.
   >
   > {body}

   Stored `prompt` and the log bubble stay what the person typed.
5. **Idle:** `behind === false`. ⌘Enter still sends; no wrap. Interrupt is
   not offered on the composer.

Steer wrap is model-facing only. Tests that read `events` of type `user` still
see the original text. Tests that read the fake provider’s stdin see the wrap
(and the Marble Drive context block already appended today).

## 4. Composer and queue UI

Keep `.queued`, `.queued-item`, `button.dequeue`. Tests already wait on those.

### 4.1 Keyboard

| Keys | Composer empty, picker visible | Composer has text, a turn is running | Composer has text, idle |
|---|---|---|---|
| Enter | Submit picker as `queue` | Send as `queue` | Send now (`behind` false) |
| ⌘Enter / Ctrl+Enter | Submit picker as `steer` | Send as `steer` | Send now, no wrap |
| Shift+Enter | Newline (unchanged) | Newline | Newline |

Slash / Tab / Backspace-on-chip stay first. Picker keys only when the
textarea is empty and a picker is armed (see §6).

The send button stays Enter’s meaning (queue if running, send if idle). No
second send button for steer.

### 4.2 Queue row

```
[Queue ▾]  first line of prompt…                    ×
```

- `.queued-dispatch` is a real `<button>`. Click cycles
  `queue → steer → interrupt → queue`. `aria-label` names the current mode
  and that a click changes it. `data-dispatch` on `.queued-item`.
- Click the prompt (`.queued-text`) to edit: the span becomes a textarea
  (or `contenteditable`). Enter or blur PATCHes `prompt`. Escape restores.
  Clicking × still dequeues and does not save.
- Truncate to one line when not editing.

### 4.3 List switch

When there are **two or more** queued rows, a toolbar above them with two
buttons, same segmented pattern as the composer setup:

**Send individually** | **Send as one prompt**

This is `queueCombine`. One fact on the conversation. Pressed state from
`data-combine` on `.queued`. Hidden at 0–1 rows (flag may stay true on disk;
the next time two items exist it shows as on).

Reload: `load()` reads `queueCombine` from conversation meta and each queued
row’s `dispatch` from the turn record (replay of `turn.queued` may carry it
too). `user` then `user.edited` replay in order so the bubble matches.

### 4.4 Visual

Same paper tokens as today. Dispatch label is muted 11.5px. Interrupt uses
`--caution`, not `--danger` (it is not a failure). No new colors.

## 5. Tool progress

`toolLabel` already prints `Tried ${name}` for unknown tools and
`Blocked: ${name}` on failure. Each `.tool` keeps `data-name` and
`data-state`.

After every `tool.call` / `tool.result` / `ops.applied` / `ops.refused` for a
turn, regroup that turn’s tool rows:

- Walk sibling `.tool` nodes in order.
- A **run** is consecutive rows with the same `data-name` whose state is
  `done` (or still `pending` only if it is the single in-flight row — an
  in-flight row is never folded into a count).
- `failed` and `refused` always stand alone and break the run.
- A run of length ≥ 2 becomes one `.tool-group` button:
  `{shortName} ×{n}`, `aria-expanded="false"`. The member rows get
  `hidden`. Click toggles expand. Expanded shows the original rows.
- `shortName`: last path segment of the tool name, `shell`/`Bash` → `Shell`,
  `read_document` → `Read`, `apply_ops` / `edit` → `Edit`, `updateTodos` /
  `TodoWrite` → `Todos`, else the name as `Tried` already showed it without
  the word `Tried`.
- `window.marbleAgentUI.collapseToolRows(container)` and
  `window.marbleAgentUI.toolShortName(name)` so browser tests can call them.

No animation of the collapse. `prefers-reduced-motion` already disables the
pending pulse.

## 6. Choice picker

No new tool. Parse the **last `text` event of a turn that just reached a
terminal status** (`completed`, `failed`, `cancelled`, `interrupted`). Do not
arm while `text.delta` is still streaming.

### 6.1 `parseChoiceQuestion(text)`

Return `null` or `{ question, options: [{ key, label }], multiHint }`.

A message qualifies only if **all** of:

1. A list of **at least two** options sits at the **end** (only whitespace
   after the last option).
2. A question line (a line containing `?`) appears in the **three lines
   immediately before** that list.
3. Options match, one per line, any of:
   - `A)` / `A.` / `A:` / `a)` … through `Z`
   - `1.` / `1)` / `1:` …
   - `- [ ] …` / `* [ ] …` / `- [x] …`
   - `- A) …` (letter inside a bullet)

`key` is the letter or number (or `1…n` for checkbox-only lists). `label` is
the rest of the line, markdown stripped to plain text. Fenced code blocks are
ignored so a recap that contains a numbered list in a fence does not match.

`multiHint` is true if the question line matches `/select all|one or more|multiple/i`
or the options are checkboxes. It does not change the keys: Space always
toggles.

False-positive recaps (“Next: 1. foo 2. bar” with no `?`) stay plain
`renderText`.

Export on `window.marbleAgentUI`.

### 6.2 Presentation

A `.choice-ask` list sits **under that agent message**, inside the log, not
in the composer.

- `role="group"` with `aria-label` = the question line.
- Each option is a real `<button role="checkbox" aria-checked>` (multi) or
  `role="radio"` when `!multiHint`. Space still toggles in both; for radios,
  checking one clears the others.
- Highlighted option: `data-current`. ↑ ↓ move it (wrap). Home / End to
  first / last.
- Enter (from empty composer, or while the group is focused) submits.
  If nothing is checked, that submits the highlighted option only.
- Clicking an option moves current; double-click or a small **Send** in the
  group also submits.
- Submitted prompt: `A, C — label A; label C` (keys plus labels). Then the
  same `submit({ dispatch })` path as typing it.

If the person types a custom reply, the picker stays visible until that send
succeeds, then it unmounts. It does not trap focus. It is not written into
the conversation file.

Escape on the picker clears checks; it does not close the conversation.

## 7. Error handling

| Case | Behavior |
|---|---|
| PATCH turn that is no longer queued | 409; UI system line; row reverts from events |
| Dequeue of a turn already started | Existing `dequeue` false; row already gone on `turn.started` |
| Combine with one row | No-op merge; start that row |
| Interrupt with nothing running | Start immediately (`behind` may still be true if other queued rows existed; wrap only for steer) |
| `saveSettings` on blank composer fails | System error; the pick stays on screen for this session |
| Parser miss | Message stays markdown. Person answers in the composer |
| Two live conversations, four panes | Each view has its own picker and queue; store is shared; SSE keeps them honest |

## 8. Testing

Node (TDD):

- Store: `createTurn` default `dispatch: 'queue'`; `queueCombine` on meta.
- Runner: second send stays queued; after the first completes, steer with
  `behind` shows the wrap on stdin, not on the `user` event.
- Runner: interrupt cancels the running turn, then starts the interrupt turn.
- Runner: `queueCombine` merges two queued prompts into `bundle`, extras
  `combined`, one `turn.started`.
- Runner: combined batch with one interrupt row cancels running, then starts
  the survivor with the numbered list and **no** steer wrap.
- HTTP: PATCH prompt / dispatch; PATCH `queueCombine`; POST `dispatch`.
- `parseChoiceQuestion` cases: lettered list with `?`, numbered, checkboxes,
  recap without `?`, list not at end, fence.

Browser (`test-browser/conversation.test.js`):

- Existing dequeue test still passes.
- Queue row: edit prompt, cycle dispatch, × still removes.
- Two queued rows show the combine switch; toggling PATCHes meta.
- Enter while running queues; ⌘Enter sets `dispatch: steer`.
- Blank composer model change writes settings; a fresh mount without a
  conversation id shows that model.
- Existing conversation model change does **not** change settings.
- Six consecutive `Tried shell` rows (fake script) collapse to `Shell ×6`;
  expand shows six; a `Blocked:` row stays outside the count.
- Agent `say` with a trailing A/B/C question renders `.choice-ask`; ↑ ↓ Space
  Enter send the keys.

## 9. Out of scope

- Mid-turn follow-up into the provider process
- An `AskQuestion` MCP tool
- Grouping a subset of the queue
- Composer shortcut for interrupt
- Writing new-chat defaults from an existing thread
- Redesign of `.msg.me` / changelog styling
- Folders / Focus views

## 10. Files

| File | Role |
|---|---|
| `server/agent/store.js` | `dispatch`, `behind`, `bundle`, `combined`, `queueCombine` |
| `server/agent/runner.js` | send/patch/pump/merge/`composePrompt` wrap |
| `server/agent/routes.js` | POST `dispatch`, PATCH turn, PATCH `queueCombine` |
| `runtime/agent.js` | `send` + `patchTurn` |
| `runtime/agent-ui.js` | composer keys, queue UI, collapse, picker, blank `saveSettings` |
| `test/agent-runner.test.js` | pump / wrap / combine / interrupt |
| `test/agent-http.test.js` | new routes |
| `test/agent-store.test.js` | new fields |
| `test-browser/conversation.test.js` | queue, keys, collapse, picker, defaults |
