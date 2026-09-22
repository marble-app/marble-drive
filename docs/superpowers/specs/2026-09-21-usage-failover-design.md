# Continue on Cursor when Claude usage stops

> Status: **approved**, 2026-09-21. When a Claude turn dies because its
> usage window is spent, the same chat can switch to Cursor's newest Grok and
> send **Continue**, with the transcript attached so Grok can finish the work.
> Extends `docs/AGENTS.md` (the composer and how a turn ends).

Node 22. No new npm dependencies. The decision lives in the runner, so a chat
keeps going when the page is in the background.

## 1. Why

A Claude coding turn that hits a spent usage window ends failed, and the work
stops with it. The person wanted that chat to keep going on Grok, at the same
effort or the nearest one Grok offers, without resending the original prompt.
A per-chat control chooses whether that happens on its own or waits for a yes.

A new conversation already starts on Cursor when Claude's 5-hour meter reads
100%. That stays as it is. This design is the other moment: a turn already
running, which then fails.

## 2. The control

Each conversation stores `failover`: `"auto"` or `"pause"`. A new conversation
is created with `"auto"`. A conversation with no value is treated as `"auto"`.

On the composer, beside the model, one word shows the current value: **Auto**
or **Pause**. A click flips it and `PATCH`es that conversation. The only
accepted values are `"auto"` and `"pause"`. Anything else is a 400. It is
about the size of a mode pill. Both states are not shown at once.

On a phone the word lives in the setup sheet with the model. It is not a
second control on the bar.

## 3. When it fires

Only a Claude turn can start this. Claude means `claude-subscription` and
`claude-api`. A Cursor turn never does.

`usageStopped(error)` is true when the turn's error text is a spent window.
It matches, case-insensitive, any of:

- `hit your limit`
- `usage limit`
- `out of extra usage`
- `extra usage limit`

It is false when the text also asks for a short retry (`try again`, `retry`,
`rate limit`, `overloaded`), and false for a refusal, a stall, a crash, or a
lost session. Those turns fail exactly as they do today.

## 4. What the runner does

`handoffUsage(conversationId)` is the one function both paths call. Auto calls
it from `finish()` while the failed turn is still holding the conversation's
slot, before `pump()` can start anything else queued on that chat. Pause calls
it from the route in §6.

It does five things, in order:

1. The Claude turn stays failed. The transcript still shows that usage stopped.
2. The conversation points at `cursor`. The model is the Grok entry from
   `pickCursorPickerModels` (the same pick the composer uses), never the
   `auto` entry. The stored `model` is that family id, and the stored
   `effort` is the step from §5, which is how the composer already stores a
   Cursor model. `resolveCursorModel` composes them at spawn. The label is
   Grok 4.7 when `cursor-agent models` lists it. `providerSession` is
   cleared. Claude's permission mode is left stored as it is. Cursor already
   treats a mode it does not know as Run Everything, which is what a manual
   switch does today.
3. An event `{ type: 'usage.continued', label }` is appended. The page renders
   it as “Claude usage stopped. Continuing on \<label\>.” The label is the
   family name plus the effort word, for example “Grok 4.7 High”.
4. One new turn is queued. Its stored prompt, and the bubble, is the word
   **Continue**. `composePrompt` prepends the brief from §7. The turn reuses
   the failed turn's context (`target`, `viewing`, `selection`). The turn
   record carries `usageHandoff: true` so a later message on this chat does
   not get the brief again. Grok's own session covers those.
5. It runs once for that failure. A later failure of the Continue turn stays
   a normal failure, because the chat is already on Cursor.

Continue is inserted ahead of any prompt the person already queued, and it is
not folded into a combined queue. The waiting message then runs on Grok
without a second brief.

If queueing Continue throws, the chat is still on Grok. The activity line says
the handoff could not be started. The switch is not rolled back. The next
message the person types runs on Grok.

### When Cursor cannot take the chat

If Cursor is not signed in, or its model list cannot be read, or that list
has no Grok, there is no switch and no Continue. The Claude error is kept,
with a suffix:

- not signed in: `— Cursor is unavailable, so this chat stayed on Claude`
- list unreadable: `— Cursor's model list could not be read, so this chat stayed on Claude`
- no Grok: `— no Grok model is available, so this chat stayed on Claude`

On Pause, the note in §6 then offers only **Leave it**, and its text is that
reason.

## 5. Effort

The ladder, low to high, is `low`, `medium`, `high`, `xhigh`, `max`.

Grok gets the same step when that family offers it. Otherwise it gets the
offered step with the smallest distance on the ladder. A tie goes to the
higher step. A Claude chat with no effort set uses that family's bare model
when it has one, and `high` otherwise.

## 6. Pause

On Pause, `finish()` does not call `handoffUsage`. The stored turn and the
`turn.failed` event both carry `usageStopped: true`. The same moment checks
whether Cursor can take the chat, using the rules in §4. When it cannot, the
event also carries `canSwitch: false` and the suffix from §4, and the note
offers only **Leave it**. When it can, `canSwitch` is true.

The note sits above the composer, so it stays put while the transcript
scrolls. When Cursor can take the chat, its text is “Claude usage stopped.
Switch to Cursor?” and the actions are **Switch** and **Leave it**. When
Cursor cannot, the text is the reason from §4 and the only action is
**Leave it**.

**Switch** is `POST /agent/conversations/:id/failover`. It calls
`handoffUsage`. A second call, from the same tab or another, finds the
Continue turn already queued or running and returns that turn. It does not
start another.

**Leave it** appends `{ type: 'usage.left', turn }` for that failed turn. The
note stays gone across a reload. Flipping the control to Auto afterwards does
not restart that turn. Auto applies the next time usage stops.

A page that was closed still shows the note on the next open, because the
failed event is in the transcript and no `usage.left` follows it. Auto does
not need the page. The runner has already continued.

## 7. The brief

The bubble is **Continue**. The brief is not what the transcript shows. It is
prepended in `composePrompt` for a turn with `usageHandoff: true`, the same
way an existing `handoffFrom` brief is prepended on a new conversation's first
turn. That older brief is unchanged. This one is built from this chat's own
events, excluding the new Continue message.

Four parts, in this order:

1. **The instruction.** Claude stopped because its usage was used up. Finish
   the work it started. The files on disk are the current state. Read them.
   Do not redo edits that are already there, and do not revert them.
2. **The task.** Every `user` message in this chat, in order.
3. **What already changed.** Paths and counts from `ops.applied` and
   `document.changed`. No file bodies.
4. **Where it stopped.** Claude's `text` events, oldest first, then the usage
   error from the failed turn. When this part is long, the cut keeps the
   latest text.

Tool-call and tool-result payloads stay out. The cap is 24,000 characters.
Past it, the cut drops older agent text first, then older user messages. The
instruction and the file list are never dropped.

## 8. Tests

No test calls a real Claude or Cursor process. A usage stop is a failed turn
whose error text matches.

- `usageStopped` accepts each phrase in §3 and rejects a retry-shortly
  message, a refusal, and a stall.
- Effort matching covers the same step, `max` down to `xhigh`, a tie going
  higher, and a chat with no effort.
- The brief includes every user message, the changed paths, and Claude's
  text. It leaves out tool-call bodies. Past the cap, older agent text goes
  first, and the instruction and the file list stay.
- In `test/agent-runner.test.js`: Auto leaves the Claude turn failed, points
  the chat at the newest Grok with the matched effort, clears the session,
  and queues one Continue turn whose composed prompt contains the brief.
  Continue is ahead of an already queued message, and that message has no
  second brief. A second failure of Continue does not switch. A crash does
  not switch. Cursor signed out, an unreadable list, or no Grok leaves the
  Claude turn failed with the suffix from §4. Pause does not queue Continue
  and marks the turn `usageStopped`, with `canSwitch` false when Cursor
  cannot take the chat.
- In `test/agent-http.test.js`: **Switch** starts that handoff. A second call
  returns the turn already started. **Leave it** is still set after a reload.
  A new conversation stores `failover: "auto"`.
- In `test-browser/conversation.test.js`: the composer shows one word, and a
  click flips it and saves it on that chat. With Pause and a usage stop, the
  note sits above the box. **Leave it** removes it. **Switch** makes the next
  turn **Continue** on Cursor.

## 9. Docs

`docs/AGENTS.md` gains a short account of the word on the composer, the note
above the box, and the Continue handoff, next to the paragraph that already
describes switching a thread from Claude to Cursor.
