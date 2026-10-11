# Agents talking to each other

> Status: **approved to build**, 2026-09-18. Adds a messaging surface to the
> agent bridge. Extends `docs/AGENTS.md` §Projects and §How a turn runs; touches
> nothing in the document write path.

Node 22. No new npm dependencies. Same store layout (`.marble/agents/<id>/`).
Every provider — Claude, Cursor, anything that loads `bin/marble-mcp.js` —
gets this identically, because all of it lives behind the bridge.

## 1. Why

A drive with twenty conversations has twenty agents that cannot see each other.
Two of them working in the same project learn about each other only through
the count in their prompt ("2 other conversations are running here"). The
person is the only channel: read one transcript, paste into another.

What is wanted is small: an agent can find out who else is working in its
project, send one of them a message, and wait for an answer. Everything else —
shared state, plans, results — already has a home in documents, and the
prompt should say so.

The decision that shapes the rest, made 2026-09-18: **a message to an idle
agent starts its turn on its own.** No approval step. Autonomy is the point;
what keeps it safe is hard caps and the Agents page, where every message is
visible and every turn can be stopped. A per-conversation "accepts messages"
switch was considered and deferred — add it when a conversation turns out to
be expensive or sensitive enough to need it.

## 2. Vocabulary

A **message** is text from one conversation to another in the same project.

```
{ id, from, to, text, about?: { path, ids? }, inReplyTo?, hop, t }
```

- `from`, `to`: conversation ids. `text` ≤ 4000 characters.
- `about`: a document path and optional ids the message is about. Informational
  for the receiver; also the fallback `context.target` of a turn it starts.
- `inReplyTo`: the id of the message being answered. A reply's `hop` is the
  original's `hop + 1`; a fresh message has `hop = 0`.
- `id`: 12 hex, minted by the store. `t`: ms since epoch.

There is no broadcast, no cross-project message, no message from a person
(a turn already is that), and no message to yourself.

## 3. The tools

Three schemas added to `TOOL_SCHEMAS` in `server/agent/tools.js`; the bridge
lists them like the rest. Every refusal is a returned `{ error }`, never a
throw, so the agent reads the reason and adjusts.

### `list_agents`

No input. Returns the other non-archived conversations in the calling turn's
project:

```
{ agents: [ { id, title, provider, target, status, activity, lastFinishedAt } ] }
```

`status` is one of `idle`, `queued`, `running`, `waiting` (running and inside
`wait_for_reply`), `asking`. The calling conversation is omitted. Ordered by
`lastInteractedAt`, newest first.

### `send_message`

```
{ to, text, about?: { path, ids? }, inReplyTo? }
→ { messageId, delivered: 'turn' | 'live' | 'inbox', to: { id, title } }
```

Refused with a reason when: `to` is the caller, unknown, archived or in
another project; `text` is empty or over 4000 characters; the turn has already
sent 12 messages; `inReplyTo` names a message whose `hop` is already 8; the
turn is finishing.

### `wait_for_reply`

```
{ seconds? }   default 120, clamped to [5, 300]
→ { messages: [message, …] }  |  { timeout: true }
```

Long-polls the caller's inbox. Returns as soon as one or more messages are
present, with all of them. The clamp exists because the MCP client in Claude
Code and Cursor times out a tool call; the agent is told in the description
that a timeout means "nothing yet — call again or move on". While a turn is
waiting its stall timer is held (`turn.holdStall`), exactly as for an open
ask, and released when the wait returns.

## 4. Delivery

Delivery is the runner's job (`server/agent/runner.js`), because it is the
one place that knows what every conversation is doing right now.

```
send_message(to)
  │
  ├─ to has a running turn that is in wait_for_reply ──► resolve the wait      (live)
  │
  ├─ to has a running or queued turn ─────────────────► append to to's inbox   (inbox)
  │
  └─ to is idle ──────────────────────────────────────► runner.send(to, …)     (turn)
```

**A turn started by a message.** `runner.send(to, { prompt, context, from })`
with `context.target` chosen in this order: the receiver's `meta.target`; the
message's `about.path`; the sender's turn target. A turn cannot exist without
one. The prompt is the rendered message (§6). The `user` event carries
`from: { conversation, title, provider }` so the transcript knows who spoke.

**The inbox.** `<conversation>/inbox.jsonl`, one message per line, read and
truncated by the store (`inbox(id)`, `takeInbox(id)`). It exists for two
moments:

- **Turn start.** Before the prompt is built, pending inbox messages are
  appended to it under "Messages that arrived while you were away", and a
  `message` event with `delivered: 'inbox'` is recorded for each. This covers
  a queued turn and a delivery turn alike.
- **Turn finish.** In the same `finally` that removes the turn from the
  runner, if the inbox is non-empty a delivery turn is queued with an empty
  prompt; the inbox fills it at start. At most one extra turn ever results.

**Boot.** After the existing sweep that marks interrupted turns, any
conversation with a non-empty inbox gets a delivery turn queued. A host
restart loses nothing.

**Slots.** Delivery turns take ordinary `maxRunning` slots and queue like any
other. Two agents each waiting on the other hold two slots until their waits
time out; that is the intended failure — bounded, visible, and each agent then
decides.

## 5. Caps

| What | Limit | Where enforced |
|---|---|---|
| Sends per turn | 12 | tools, per `turn` |
| Hops per thread | 8 | tools, from the parent message's `hop` |
| Text length | 4000 chars | tools |
| Wait per call | 300 s | tools |
| Recipient | same project, not archived, not self | tools |
| Running turns | existing `maxRunning` | runner |

The morning of this spec was spent on a document that doubled on every click
because nothing bounded a loop between two writers. These are that lesson.

## 6. What the agent reads

`server/agent/instructions.js` gains one paragraph, present in all three
instruction sets, rendered only when the project has other conversations:

> Other conversations are working in this project. `list_agents` shows them;
> `send_message` sends one a note, and `wait_for_reply` waits for an answer.
> Message another agent to ask a question or hand something over — not to
> narrate. Shared state belongs in a document both of you can read. Do not
> reply to a reply unless you have something new to say.

A message is rendered into a prompt as:

```
Message from the conversation "<title>" (<id>, <provider>):

<text>

[About: <path> — <ids>]
Reply with send_message to "<id>" and inReplyTo "<messageId>".
```

## 7. What the person sees

Events, all stored in `events.jsonl` and streamed on `/agent/events`:

- Sender: `message.sent { messageId, to, toTitle, text, delivered }`.
- Receiver, turn started by the message: the `user` event with `from`.
- Receiver, otherwise: `message { messageId, from, fromTitle, text, delivered: 'live' | 'inbox' }`.

`runtime/agent-ui.js` renders a `user` event with `from` and a `message` event
as a **from-bubble**: the sender's title as a link that opens that
conversation, then the text. `message.sent` renders as a quiet system line,
"Sent to <title>". The conversation summary's `activity` becomes
"Message from <title>" when a message started the turn. No Needs you; nothing
new on the board cards.

## 8. Cursor

`bin/marble-cursor-hook.js` adds `MCP:list_agents`, `MCP:send_message`,
`MCP:wait_for_reply` to its `MARBLE` set. That is the whole Cursor change: the
tools arrive through the same MCP config, and nothing here uses asks, which
Cursor does not have.

## 9. Files

| File | Change |
|---|---|
| `server/agent/tools.js` | three schemas; handlers that call the runner's messaging surface; per-turn send count |
| `server/agent/runner.js` | `deliver(message)`, inbox flush at start and finish, `wait(turn, seconds)`, `status` per conversation for `list_agents`, boot recovery, `from` on `send` |
| `server/agent/store.js` | `appendInbox`, `inbox`, `takeInbox`; message id minting |
| `server/agent/instructions.js` | the messaging paragraph; the prompt renderer for a message |
| `server/agent/index.js` | hand the runner to the tools (today tools do not see it) |
| `bin/marble-cursor-hook.js` | allowlist |
| `runtime/agent-ui.js`, `templates/agents.mrbl` | from-bubble, sent line, activity string |
| `docs/AGENTS.md` | new section "Messages", `list_agents` in the tool list |

`tools.js` currently receives `store, writeOps, createDocument, …` and not the
runner. The tools need `runner.deliver`, `runner.wait`, `runner.statusOf`;
`index.js` creates the runner first and passes those three functions to
`createTools` by name, not the runner, so tools stay testable with a stub.

## 10. Testing

- `test/agent-runner.test.js`, fake provider: idle target starts a turn whose
  `user` event carries `from`; running-and-waiting target gets the message
  live and the wait resolves; running target gets it in the inbox and a
  delivery turn follows the finish; queued target sees it in its prompt at
  start; boot with a pending inbox queues a delivery turn; `maxRunning` is
  honoured by delivery turns.
- `test/agent-tools.test.js`, stubbed runner: `list_agents` scoping and
  status; every `send_message` refusal in §3; `wait_for_reply` clamp and
  timeout shape; the 12-send and 8-hop caps.
- `test/agent-store.test.js`: inbox append, read, take; survives a reopen.
- `test/agent-provider-cursor.test.js`: the hook allows the three names.
- `test-browser/agents-page.test.js`: a from-bubble renders with a link to the
  sending conversation.

## 11. Not in this spec

Person-to-agent messages, broadcast, cross-project messages, an HTTP endpoint
for messages, a per-conversation accept switch, message search, and any
change to how documents are written. Agents that want shared state write a
document; that path is already built and already forks on conflict.
