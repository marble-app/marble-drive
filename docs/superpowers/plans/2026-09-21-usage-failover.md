# Continue on Cursor when Claude usage stops — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Claude turn fails because its usage window is spent, that same chat switches to Cursor's newest Grok and sends **Continue** with the transcript attached, unless the chat is set to Pause.

**Architecture:** Pure decisions live in `server/agent/usage-failover.js` (`usageStopped`, `matchEffort`, `usageBrief`, `pickGrok`). The runner's `finish()` calls `handoffUsage` while the failed turn still holds the slot. Pause stores `usageStopped` and the page shows a note above the composer. **Switch** hits `POST /agent/conversations/:id/failover`, which calls the same function.

**Tech Stack:** Node 22, the existing agent runner, store, and `<marble-conversation>` in `runtime/agent-ui.js`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-21-usage-failover-design.md`

## Global Constraints

- Node 22. No new npm dependencies.
- `failover` is `"auto"` or `"pause"`. Missing means `"auto"`. A new conversation is stored as `"auto"` unless the create body says `"pause"`.
- Only `claude-subscription` and `claude-api` can start a handoff.
- `usageStopped` matches `hit your limit`, `usage limit`, `out of extra usage`, `extra usage limit` (case-insensitive) and rejects text that also matches `try again`, `retry`, `rate limit`, or `overloaded`.
- Stay suffixes, verbatim:
  - `— Cursor is unavailable, so this chat stayed on Claude`
  - `— Cursor's model list could not be read, so this chat stayed on Claude`
  - `— no Grok model is available, so this chat stayed on Claude`
- Effort ladder: `low`, `medium`, `high`, `xhigh`, `max`. Same step when offered. Nearest otherwise. A tie takes the higher step. No effort uses the bare model when `hasBare`, otherwise `high` (or the nearest offered step to `high`).
- Stored Cursor `model` is the Grok family id from `pickCursorPickerModels`, never `auto`. `effort` is stored separately.
- The bubble is the word `Continue`. The brief is prepended only when `usageHandoff` is set. Cap 24,000 characters. Tool payloads stay out.
- Continue is queued ahead of prompts already waiting, and is not folded into a combined queue.
- One handoff per failure. A second `POST` returns the Continue turn already started.
- The composer control is one word, **Auto** or **Pause**, inside the setup row (so a phone's setup sheet carries it). The pause note sits above the composer.

---

### Task 1: Pure decisions

**Files:**
- Create: `server/agent/usage-failover.js`
- Test: `test/agent-usage-failover.test.js`

**Interfaces:**
- Produces: `usageStopped(error) -> boolean`, `matchEffort(effort, family) -> string`, `pickGrok(models) -> family | null`, `continuedLabel(familyLabel, effort) -> string`, `usageBrief(events, error) -> string`, `STAY` (`signedOut`, `unreadable`, `noGrok`), `BRIEF_CAP = 24000`, `CONTINUE = 'Continue'`, `CLAUDE_PROVIDERS`

- [x] Write `test/agent-usage-failover.test.js` covering the phrases, the retry rejection, effort (same step, `max` → `xhigh`, tie to the higher step, no effort), `pickGrok` ignoring `auto`, and a brief that keeps the instruction and file list while dropping older agent text.
- [x] Run `node --test test/agent-usage-failover.test.js` and confirm it fails because the module is missing.
- [x] Implement `server/agent/usage-failover.js`.
- [x] Re-run the test and confirm it passes.

### Task 2: Store and route fields

**Files:**
- Modify: `server/agent/store.js` (`createConversation`, `createTurn`)
- Modify: `server/agent/routes.js` (PATCH `failover`, POST create, POST `/failover`, POST `/usage-left`)
- Modify: `runtime/agent.js` (`start`, `failover`, `leaveUsage`)
- Test: `test/agent-http.test.js`

**Interfaces:**
- Consumes: conversation id regex `[0-9a-f]{12}`
- Produces: `meta.failover`, `turn.usageHandoff`, `POST /agent/conversations/:id/failover`, `POST /agent/conversations/:id/usage-left` with body `{ turn }`

- [x] A new conversation's summary has `failover: "auto"`. PATCH `"pause"` sticks. PATCH `"later"` is 400.
- [x] POST `/usage-left` appends `{ type: 'usage.left', turn }` and a reload of the conversation still has that event.
- [x] `createTurn` persists `usageHandoff: true` when asked.

### Task 3: Runner handoff

**Files:**
- Modify: `server/agent/runner.js` (`finish`, `send`, `composePrompt`, `mergeQueued`)
- Test: `test/agent-runner.test.js`

**Interfaces:**
- Consumes: Task 1 functions, `providers.get('cursor').detect()` and `.listModels()`
- Produces: `runner.handoffUsage(conversationId) -> { turnId, status }`

- [x] Auto on a Claude usage stop leaves that turn failed, points the chat at the newest Grok with the matched effort, clears `providerSession`, emits `usage.continued`, and queues one Continue turn whose spawned prompt contains the brief.
- [x] An already queued message runs after Continue and its prompt does not contain the brief.
- [x] Continue failing, a crash, a retry-shortly error, Cursor signed out, an unreadable list, and no Grok do not switch. The last three keep the Claude error and add the suffix.
- [x] Pause does not queue Continue. The stored turn and `turn.failed` carry `usageStopped: true` and `canSwitch`.
- [x] A second `handoffUsage` returns the Continue turn already started.

### Task 4: Composer

**Files:**
- Modify: `runtime/agent-ui.js`
- Test: `test-browser/conversation.test.js`

**Interfaces:**
- Consumes: `api.update`, `api.failover`, `api.leaveUsage`, events `turn.failed`, `usage.left`, `usage.continued`

- [x] One word beside the model. A click flips it and PATCHes that chat. A click before the chat exists is sent with `POST /agent/conversations`.
- [x] On Pause, `turn.failed` with `usageStopped` shows the note above the editor. **Leave it** hides it and posts `/usage-left`. **Switch** posts `/failover`.
- [x] `usage.continued` renders “Claude usage stopped. Continuing on \<label\>.”

### Task 5: Docs

**Files:**
- Modify: `docs/AGENTS.md` (the composer paragraph)
- Modify: `docs/superpowers/specs/2026-09-21-usage-failover-design.md` status line to approved

- [x] Document the word, the note, and the Continue handoff next to the existing Claude-to-Cursor switch sentence.
