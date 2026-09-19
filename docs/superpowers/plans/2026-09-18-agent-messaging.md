# Agent Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents in one project can list each other, send a message, and wait for a reply, through the same MCP bridge every provider already loads.

**Architecture:** Three new bridge tools delegate to a messaging surface on the runner. One persisted inbox per conversation is the only queue; delivery differs only in who picks it up (a waiting turn, a turn that is starting, or a delivery turn the runner starts for an idle conversation). Every message lands as an event in both transcripts and the Agents page renders it as a from-bubble.

**Tech Stack:** Node 22, `node:test`, the existing fake provider (`test/fixtures/fake-agent.mjs`, which speaks real MCP to `bin/marble-mcp.js`), Playwright for one browser test. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-18-agent-messaging-design.md`

## Global Constraints

- Node 22. No new npm dependencies.
- A message is text ≤ 4000 characters; at most 12 sends per turn; a thread refuses past hop 8; `wait_for_reply` clamps seconds to [5, 300], default 120.
- Recipients: same project, not archived, not self. Refusals are returned `{ error }`, never thrown.
- A message to an idle conversation starts its turn on its own (decision of 2026-09-18). Nothing here raises Needs you.
- Inbox is `.marble/agents/<conversationId>/inbox.jsonl`, one JSON message per line.
- Every provider gets this through `bin/marble-mcp.js`; Cursor additionally needs the three tool names in `bin/marble-cursor-hook.js`.
- The Agents page is edited in `templates/agents.mrbl` and tested through the browser harness; `drive/Agents.mrbl` is patched once afterwards, never edited while the host is running (see memory: editing `.mrbl` while served races).
- Four deviations from the spec, decided while planning and building, recorded here: (1) validation of recipients lives in the runner, not `tools.js`, because the runner holds the agent store and the tools hold the document store; the tools stay thin delegates. (2) The messaging paragraph is composed into the turn prompt by `composePrompt` when peers exist, from a constant exported by `instructions.js`, because the instruction texts are static per provider and cannot know whether peers exist. (3) The hop cap reads a parent message from host memory (`threads`) or from what the turn itself received, and treats a parent it no longer knows as a fresh thread: a restart forgets threads, and refusing on a forgotten parent would be worse than restarting the count. (4) The three static instruction texts in `instructions.js` name `list_agents`, `send_message` and `wait_for_reply` unconditionally — an existing test requires every tool the bridge holds to be named in the instructions, and those texts are built once per provider, before any conversation exists. The per-turn paragraph of (2) still appears only when the project actually has peers, so an agent alone in a project is told the names but never urged to use them.

## File map

| File | Responsibility after this plan |
|---|---|
| `server/agent/store.js` | `createMessage`, `appendInbox`, `inbox`, `takeInbox` — persistence only |
| `server/agent/messages.js` (new) | pure functions: `renderMessages`, `validateText`, `clampSeconds`, `pickTarget` |
| `server/agent/runner.js` | `deliver`, `wait`, `peers`, inbox flush at start and finish, `from` on `send`, boot recovery |
| `server/agent/tools.js` | three schemas; handlers that delegate to a late-bound `messaging` object |
| `server/agent/index.js` | creates `messaging = {}` before the tools, fills it from the runner after |
| `server/agent/instructions.js` | `MESSAGING_INSTRUCTIONS` constant |
| `bin/marble-cursor-hook.js` | allowlist |
| `runtime/agent-ui.js` | from-bubble, "Sent to" line, `marble-agent:open` event |
| `templates/agents.mrbl` | listens for `marble-agent:open` and opens that conversation |
| `docs/AGENTS.md` | "Messages" section |

---

### Task 1: Store — messages and the inbox

**Files:**
- Modify: `server/agent/store.js` (inside `createAgentStore`, next to `createTurn` at line ~456)
- Test: `test/agent-store.test.js`

**Interfaces:**
- Produces:
  - `store.createMessage({ from, to, text, about = null, inReplyTo = null, hop = 0 })` → `{ id, from, to, text, about, inReplyTo, hop, t }` (pure; `id` is 12 hex, `t` is `Date.now()`; nothing written)
  - `store.appendInbox(conversationId, message)` → `Promise<void>`
  - `store.inbox(conversationId)` → `Promise<message[]>` (non-destructive)
  - `store.takeInbox(conversationId)` → `Promise<message[]>` (returns and empties, atomically under `serial`)

- [ ] **Step 1: Write the failing tests**

Append to `test/agent-store.test.js`:

```js
test('the inbox appends, reads without taking, then takes and is empty', async () => {
  const { store } = await fresh();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const m1 = store.createMessage({ from: a.id, to: b.id, text: 'first' });
  const m2 = store.createMessage({ from: a.id, to: b.id, text: 'second', inReplyTo: m1.id, hop: 1 });
  assert.match(m1.id, /^[0-9a-f]{12}$/);
  assert.equal(typeof m1.t, 'number');
  assert.equal(m1.hop, 0);
  assert.equal(m2.hop, 1);
  assert.deepEqual(await store.inbox(b.id), []);
  await store.appendInbox(b.id, m1);
  await store.appendInbox(b.id, m2);
  assert.deepEqual((await store.inbox(b.id)).map((m) => m.text), ['first', 'second']);
  assert.deepEqual((await store.inbox(b.id)).map((m) => m.text), ['first', 'second'], 'inbox() does not take');
  assert.deepEqual((await store.takeInbox(b.id)).map((m) => m.text), ['first', 'second']);
  assert.deepEqual(await store.takeInbox(b.id), []);
  assert.deepEqual(await store.inbox(b.id), []);
});

test('the inbox survives reopening the store', async () => {
  const { dir, store } = await fresh();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  await store.appendInbox(b.id, store.createMessage({ from: a.id, to: b.id, text: 'kept' }));
  const again = createAgentStore({ dir, defaultProvider: 'claude-subscription' });
  await again.ready();
  assert.deepEqual((await again.inbox(b.id)).map((m) => m.text), ['kept']);
});

test('a torn last inbox line is skipped, not fatal', async () => {
  const { dir, store } = await fresh();
  const b = await store.createConversation({ provider: 'fake' });
  await store.appendInbox(b.id, store.createMessage({ from: 'x', to: b.id, text: 'whole' }));
  await fsp.appendFile(path.join(dir, b.id, 'inbox.jsonl'), '{"id":"tor');
  assert.deepEqual((await store.inbox(b.id)).map((m) => m.text), ['whole']);
});
```

`createMessage` is synchronous and pure, so the first test calls it on a fresh store and never awaits it.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/agent-store.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: three `not ok` lines, failing with `store.createMessage is not a function`.

- [ ] **Step 3: Implement**

In `server/agent/store.js`, next to `metaFile`/`eventsFile` (line ~68) add:

```js
  const inboxFile = (id) => path.join(convDir(id), 'inbox.jsonl');
```

Inside the returned object, after `createTurn`, add:

```js
    /** A message between two conversations. Pure: minted here, stored by
     *  appendInbox and by the events each side records. */
    createMessage({ from, to, text, about = null, inReplyTo = null, hop = 0 }) {
      return {
        id: crypto.randomBytes(6).toString('hex'),
        from,
        to,
        text: String(text),
        about: about ?? null,
        inReplyTo: inReplyTo ?? null,
        hop: Number(hop) || 0,
        t: Date.now(),
      };
    },

    // The inbox is the one queue for messages to a conversation. Who empties
    // it — a turn that is waiting, a turn that is starting, or a delivery turn
    // the runner starts — is the runner's business; here it is a file.
    async appendInbox(id, message) {
      await serial(`inbox:${id}`, async () => {
        await fsp.mkdir(convDir(id), { recursive: true });
        await fsp.appendFile(inboxFile(id), `${JSON.stringify(message)}\n`);
      });
    },

    async inbox(id) {
      return serial(`inbox:${id}`, () => readInbox(id));
    },

    async takeInbox(id) {
      return serial(`inbox:${id}`, async () => {
        const messages = await readInbox(id);
        if (messages.length) await fsp.rm(inboxFile(id), { force: true });
        return messages;
      });
    },
```

And a module-level helper inside `createAgentStore` (near `readInbox` usage, before the `return {`):

```js
  async function readInbox(id) {
    let text;
    try {
      text = await fsp.readFile(inboxFile(id), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const messages = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line));
      } catch {
        // A torn last line from a crash mid-append. The message it held is
        // lost; the ones before it are not.
      }
    }
    return messages;
  }
```

`crypto` is already imported at the top of `store.js`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/agent-store.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server/agent/store.js test/agent-store.test.js
git commit -m "Give each conversation an inbox: messages minted, appended, read and taken atomically."
```

---

### Task 2: Pure helpers — rendering, limits, target choice

**Files:**
- Create: `server/agent/messages.js`
- Modify: `server/agent/instructions.js` (append one export)
- Test: `test/agent-messages.test.js` (new)

**Interfaces:**
- Produces:
  - `MAX_TEXT = 4000`, `MAX_SENDS = 12`, `MAX_HOP = 8`, `WAIT_DEFAULT = 120`, `WAIT_MIN = 5`, `WAIT_MAX = 300`
  - `validateText(text)` → `null` if fine, else a reason string
  - `clampSeconds(value)` → integer in [5, 300], 120 when not a finite number
  - `pickTarget({ receiver, about, senderTarget })` → the first non-empty of `receiver.target`, `about?.path`, `senderTarget`, else `null`
  - `renderMessages(messages, titles)` → prompt text; `titles` is `Map<conversationId, { title, provider }>`
  - `instructions.MESSAGING_INSTRUCTIONS` → the paragraph from spec §6

- [ ] **Step 1: Write the failing tests**

Create `test/agent-messages.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_HOP, MAX_SENDS, MAX_TEXT, WAIT_DEFAULT, WAIT_MAX, WAIT_MIN,
  clampSeconds, pickTarget, renderMessages, validateText,
} from '../server/agent/messages.js';
import { MESSAGING_INSTRUCTIONS } from '../server/agent/instructions.js';

test('the limits are the spec\'s numbers', () => {
  assert.deepEqual([MAX_TEXT, MAX_SENDS, MAX_HOP, WAIT_DEFAULT, WAIT_MIN, WAIT_MAX], [4000, 12, 8, 120, 5, 300]);
});

test('text must be a non-empty string within the cap', () => {
  assert.equal(validateText('hello'), null);
  assert.match(validateText(''), /empty/);
  assert.match(validateText('   '), /empty/);
  assert.match(validateText(42), /text/);
  assert.match(validateText('x'.repeat(4001)), /4000/);
  assert.equal(validateText('x'.repeat(4000)), null);
});

test('seconds clamp to [5, 300] and default to 120', () => {
  assert.equal(clampSeconds(undefined), 120);
  assert.equal(clampSeconds('abc'), 120);
  assert.equal(clampSeconds(1), 5);
  assert.equal(clampSeconds(9000), 300);
  assert.equal(clampSeconds(42.7), 42);
});

test('a delivery turn targets the receiver\'s document, then the message\'s, then the sender\'s', () => {
  assert.equal(pickTarget({ receiver: { target: 'theirs' }, about: { path: 'about' }, senderTarget: 'mine' }), 'theirs');
  assert.equal(pickTarget({ receiver: { target: null }, about: { path: 'about' }, senderTarget: 'mine' }), 'about');
  assert.equal(pickTarget({ receiver: {}, about: null, senderTarget: 'mine' }), 'mine');
  assert.equal(pickTarget({ receiver: {}, about: null, senderTarget: null }), null);
});

test('messages render with who sent them, what they are about, and how to reply', () => {
  const titles = new Map([['aaaaaaaaaaaa', { title: 'Bibliography', provider: 'claude-subscription' }]]);
  const text = renderMessages([
    { id: 'm1m1m1m1m1m1', from: 'aaaaaaaaaaaa', to: 'b', text: 'Is the bib clean?', about: { path: 'Research/CHI', ids: ['h1', 'p2'] }, hop: 0 },
    { id: 'm2m2m2m2m2m2', from: 'zzzzzzzzzzzz', to: 'b', text: 'Second note', about: null, hop: 0 },
  ], titles);
  assert.match(text, /Message from the conversation "Bibliography" \(aaaaaaaaaaaa, claude-subscription\):/);
  assert.match(text, /Is the bib clean\?/);
  assert.match(text, /About: Research\/CHI — h1, p2/);
  assert.match(text, /Reply with send_message to "aaaaaaaaaaaa" and inReplyTo "m1m1m1m1m1m1"\./);
  assert.match(text, /Message from the conversation "zzzzzzzzzzzz" \(zzzzzzzzzzzz, unknown\):/, 'an unknown sender is named by id');
  assert.match(text, /Second note/);
  assert.equal(text.split('Message from the conversation').length - 1, 2);
});

test('the messaging paragraph names the three tools and points shared state at documents', () => {
  for (const name of ['list_agents', 'send_message', 'wait_for_reply']) assert.match(MESSAGING_INSTRUCTIONS, new RegExp(name));
  assert.match(MESSAGING_INSTRUCTIONS, /document/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/agent-messages.test.js 2>&1 | grep -E "^not ok|Error|^# (pass|fail)" | head`
Expected: the import fails with `Cannot find module '.../server/agent/messages.js'`.

- [ ] **Step 3: Implement**

Create `server/agent/messages.js`:

```js
// Messages between two agent conversations: the limits, and the pure
// functions the runner and the tools share. Nothing here reads a file or
// knows what a turn is; that is what keeps it testable in a line each.

export const MAX_TEXT = 4000;
export const MAX_SENDS = 12;
export const MAX_HOP = 8;
export const WAIT_DEFAULT = 120;
export const WAIT_MIN = 5;
export const WAIT_MAX = 300;

/** Null when the text is fine, else the reason it is not. */
export function validateText(text) {
  if (typeof text !== 'string') return 'text must be a string';
  if (!text.trim()) return 'text is empty';
  if (text.length > MAX_TEXT) return `text is over ${MAX_TEXT} characters`;
  return null;
}

/** How long one wait_for_reply may block. Clamped so the MCP client's own
 *  tool timeout never fires first; the agent is told a timeout means
 *  "nothing yet". */
export function clampSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return WAIT_DEFAULT;
  return Math.min(WAIT_MAX, Math.max(WAIT_MIN, Math.floor(n)));
}

/** A turn cannot exist without a document. The receiver's own is the natural
 *  one; failing that, the document the message is about; failing that, the
 *  sender's. */
export function pickTarget({ receiver, about, senderTarget }) {
  return receiver?.target || about?.path || senderTarget || null;
}

/** The prompt a batch of messages becomes. `titles` maps a conversation id
 *  to `{ title, provider }` for the senders the caller could look up. */
export function renderMessages(messages, titles = new Map()) {
  const blocks = messages.map((m) => {
    const who = titles.get(m.from);
    const lines = [
      `Message from the conversation "${who?.title || m.from}" (${m.from}, ${who?.provider || 'unknown'}):`,
      '',
      m.text,
      '',
    ];
    if (m.about?.path) {
      const ids = Array.isArray(m.about.ids) && m.about.ids.length ? ` — ${m.about.ids.join(', ')}` : '';
      lines.push(`[About: ${m.about.path}${ids}]`);
    }
    lines.push(`Reply with send_message to "${m.from}" and inReplyTo "${m.id}".`);
    return lines.join('\n');
  });
  return blocks.join('\n\n---\n\n');
}
```

Append to `server/agent/instructions.js`:

```js
/** Added to a turn's prompt when other conversations exist in its project. */
export const MESSAGING_INSTRUCTIONS = `Other conversations are working in this project. list_agents shows them; send_message sends one a note, and wait_for_reply waits for an answer (a timeout means nothing has arrived yet — call it again or move on). Message another agent to ask a question or hand something over, not to narrate. Shared state belongs in a document both of you can read. Do not reply to a reply unless you have something new to say.`;
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/agent-messages.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server/agent/messages.js server/agent/instructions.js test/agent-messages.test.js
git commit -m "Name the limits and the rendering of agent-to-agent messages in one small module."
```

---

### Task 3: Runner — deliver, wait, peers, and the inbox at start and finish

This is the largest task. It adds the messaging surface to `createRunner` and threads the inbox through a turn's life.

**Files:**
- Modify: `server/agent/runner.js`
  - `send()` at line ~127: accept `from`
  - the turn object: add `sent`, `waiter`, `from`
  - `composePrompt()` at line ~86: inbox flush + messaging paragraph
  - `start()` at line ~247: activity for a message-started turn
  - `finish()` `finally` at line ~556: queue a delivery turn when inbox is non-empty
  - `boot()` at line ~588: recover inboxes
  - the returned object: `deliver`, `wait`, `peers`
- Test: `test/agent-runner.test.js`

**Interfaces:**
- Consumes: Task 1 store methods; Task 2 helpers.
- Produces (on the runner):
  - `runner.peers(turn)` → `Promise<{ agents: [{ id, title, provider, target, status, activity, lastFinishedAt }] }>` where `status ∈ idle | queued | running | waiting | asking`; same project, non-archived, excludes the caller.
  - `runner.deliver(turn, { to, text, about = null, inReplyTo = null })` → `Promise<{ messageId, delivered: 'turn' | 'live' | 'inbox', to: { id, title } } | { error }>`
  - `runner.wait(turn, seconds)` → `Promise<{ messages } | { timeout: true }>`
  - `runner.send(conversationId, { prompt, context, from = null })` — `from` is `{ conversation, title, provider }` and is copied onto the `user` event.

- [ ] **Step 1: Write the failing tests**

In `test/agent-runner.test.js`, add to `SCRIPTS` (the object at line ~14):

```js
  // Sends one message to whoever is in $to (the test rewrites the script), then ends.
  sendone: [
    { call: 'list_agents', args: {}, as: 'peers' },
    { call: 'send_message', args: { to: { $ref: 'peers.agents.0.id' }, text: 'ping from a' }, as: 'sent' },
    { say: 'sent' },
  ],
  // Sends, then waits up to 5 s for a reply, then reports whether one came.
  sendwait: [
    { call: 'list_agents', args: {}, as: 'peers' },
    { call: 'send_message', args: { to: { $ref: 'peers.agents.0.id' }, text: 'question' }, as: 'sent' },
    { call: 'wait_for_reply', args: { seconds: 5 }, as: 'reply' },
    { say: 'waited' },
  ],
  // The receiver: replies to the first message in its prompt. The fake cannot
  // parse its prompt, so it lists peers and answers the first one it sees.
  replyfirst: [
    { call: 'list_agents', args: {}, as: 'peers' },
    { call: 'send_message', args: { to: { $ref: 'peers.agents.0.id' }, text: 'answer' }, as: 'sent' },
    { say: 'replied' },
  ],
  // Long enough to still be running when a message arrives.
  linger: [{ sleep: 1500 }, { say: 'done lingering' }],
```

Change `setup()` so it can run the real tools against the runner's messaging surface. Replace the `tools:` line in `createRunner({...})` inside `setup()` with:

```js
    tools: tools ?? realTools ?? { call: async (name, input, turn) => { toolCalls.push({ name, input, turn: turn.id }); return { ok: true }; } },
```

and add `realTools = null` to `setup()`'s destructured options. Then add, above the tests:

```js
import { createTools } from '../server/agent/tools.js';

// Real tools whose messaging surface is bound to the runner after creation,
// the way index.js does it. Document tools are not exercised here.
async function setupMessaging(options = {}) {
  const messaging = {};
  const realTools = createTools({
    store: { read: async () => null, list: async () => [] },
    writeOps: async () => ({ applied: 0 }),
    createDocument: async () => {},
    buildStarter: async () => '',
    guidePath: '/nonexistent',
    examine: () => [],
    messaging,
  });
  const made = await setup({ ...options, realTools });
  Object.assign(messaging, {
    peers: (turn) => made.runner.peers(turn),
    deliver: (turn, input) => made.runner.deliver(turn, input),
    wait: (turn, seconds) => made.runner.wait(turn, seconds),
  });
  return made;
}
```

Then add the tests:

```js
test('a message to an idle conversation starts its turn, and both transcripts say so', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(b.id, { title: 'Bee', target: 'bees' });
  const { turnId } = await runner.send(a.id, { prompt: 'script:sendone', context: { target: 'd' } });
  await finished(store, turnId);
  const bTurn = await until(async () => (await store.turns(b.id))[0] ?? null);
  await finished(store, bTurn.id);

  const sent = (await store.events(a.id)).find((e) => e.type === 'message.sent');
  assert.equal(sent.to, b.id);
  assert.equal(sent.toTitle, 'Bee');
  assert.equal(sent.text, 'ping from a');
  assert.equal(sent.delivered, 'turn');

  const user = (await store.events(b.id)).find((e) => e.type === 'user');
  assert.equal(user.from.conversation, a.id);
  assert.equal(user.from.provider, 'fake');
  assert.match(user.text, /ping from a/);
  assert.match(user.text, /Reply with send_message to "/);
  assert.equal(user.context.target, 'bees', 'the receiver keeps its own document');
  assert.match((await store.conversation(b.id)).activity, /^Message from|^Answered|^Changed/);
  await runner.close();
});

test('a message to a running conversation lands in its inbox and a delivery turn follows', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const bFirst = await runner.send(b.id, { prompt: 'script:linger', context: { target: 'd' } });
  await until(() => runner.running().some((t) => t.conversationId === b.id));
  const { turnId } = await runner.send(a.id, { prompt: 'script:sendone', context: { target: 'd' } });
  await finished(store, turnId);
  const sent = (await store.events(a.id)).find((e) => e.type === 'message.sent');
  assert.equal(sent.delivered, 'inbox');
  await finished(store, bFirst.turnId);
  const second = await until(async () => (await store.turns(b.id))[1] ?? null);
  await finished(store, second.id);
  const user = (await store.events(b.id)).filter((e) => e.type === 'user')[1];
  assert.match(user.text, /ping from a/);
  assert.equal(user.from.conversation, a.id);
  assert.deepEqual(await store.inbox(b.id), []);
  await runner.close();
});

test('a waiting turn receives a message live and wait_for_reply returns it', async () => {
  const { store, runner } = await setupMessaging({ limits: { maxRunning: 3 } });
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(a.id, { prompt: 'script:sendwait', context: { target: 'd' } });
  // a's message starts a delivery turn on b, whose prompt is the rendered
  // message, not a script — so b's fake agent just ends. Reply as b by hand,
  // through the runner surface, with a synthetic turn: what matters here is
  // that a is parked and receives the reply live.
  await until(() => runner.running().find((t) => t.conversationId === a.id && t.waiter) ?? null);
  const asB = { conversationId: b.id, target: 'd', sent: 0, project: { id: 'drive' } };
  const result = await runner.deliver(asB, { to: a.id, text: 'answer' });
  assert.equal(result.delivered, 'live');
  await finished(store, turnId);
  const events = await store.events(a.id);
  const got = events.find((e) => e.type === 'message' && e.delivered === 'live');
  assert.equal(got.text, 'answer');
  assert.equal(got.from, b.id);
  assert.ok(events.some((e) => e.type === 'tool.result' && /answer/.test(e.summary ?? '')), 'the tool result carried the reply');
  await runner.close();
});

test('wait_for_reply times out with a plain answer and the turn goes on', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(a.id, { prompt: 'script:sendwait', context: { target: 'd' } });
  const turn = await finished(store, turnId, 20_000);
  assert.equal(turn.status, 'completed');
  const results = (await store.events(a.id)).filter((e) => e.type === 'tool.result').map((e) => e.summary);
  assert.ok(results.some((s) => /"timeout":true/.test(s)), 'the wait reported a timeout');
  await runner.close();
});

test('send_message refuses self, strangers, other projects, archived, empty and oversize text, and the caps', async () => {
  const { store, runner } = await setupMessaging({
    projects: { find: async (id) => (id === 'other' ? { id: 'other', name: 'Other', path: '/tmp', builtIn: false } : { id: 'drive', name: 'Drive', path: '/tmp', builtIn: true }) },
  });
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const elsewhere = await store.createConversation({ provider: 'fake', project: 'other' });
  const gone = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(gone.id, { archived: true });
  const turn = { conversationId: a.id, target: 'd', sent: 0, project: { id: 'drive' } };

  assert.match((await runner.deliver(turn, { to: a.id, text: 'me' })).error, /yourself/);
  assert.match((await runner.deliver(turn, { to: 'nope', text: 'x' })).error, /no conversation/);
  assert.match((await runner.deliver(turn, { to: elsewhere.id, text: 'x' })).error, /project/);
  assert.match((await runner.deliver(turn, { to: gone.id, text: 'x' })).error, /archived/);
  assert.match((await runner.deliver(turn, { to: b.id, text: '' })).error, /empty/);
  assert.match((await runner.deliver(turn, { to: b.id, text: 'x'.repeat(4001) })).error, /4000/);

  let last;
  for (let i = 0; i < 12; i++) last = await runner.deliver(turn, { to: b.id, text: `n${i}` });
  assert.ok(last.messageId, 'twelve sends are allowed');
  assert.match((await runner.deliver(turn, { to: b.id, text: 'thirteen' })).error, /12/);

  const deep = { conversationId: b.id, target: 'd', sent: 0, project: { id: 'drive' } };
  let parent = last.messageId;
  for (let hop = 1; hop <= 8; hop++) {
    const r = await runner.deliver(hop % 2 ? deep : { ...turn, sent: 0 }, { to: hop % 2 ? a.id : b.id, text: `hop ${hop}`, inReplyTo: parent });
    assert.ok(r.messageId, `hop ${hop} is allowed`);
    parent = r.messageId;
  }
  assert.match((await runner.deliver(deep, { to: a.id, text: 'too deep', inReplyTo: parent })).error, /8/);
  await runner.close();
});

test('list_agents shows the other conversations in the project with an honest status', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const c = await store.createConversation({ provider: 'fake' });
  await store.createConversation({ provider: 'fake', project: 'other' });
  await store.updateConversation(b.id, { title: 'Bee', target: 'bees' });
  await runner.send(c.id, { prompt: 'script:linger', context: { target: 'd' } });
  await until(() => runner.running().some((t) => t.conversationId === c.id));
  const turn = { conversationId: a.id, target: 'd', project: { id: 'drive' } };
  const { agents } = await runner.peers(turn);
  assert.deepEqual(agents.map((x) => x.id).sort(), [b.id, c.id].sort());
  const bee = agents.find((x) => x.id === b.id);
  assert.equal(bee.title, 'Bee');
  assert.equal(bee.target, 'bees');
  assert.equal(bee.status, 'idle');
  assert.equal(agents.find((x) => x.id === c.id).status, 'running');
  await runner.close();
});

test('a pending inbox at boot becomes a delivery turn', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(b.id, { target: 'bees' });
  await store.appendInbox(b.id, store.createMessage({ from: a.id, to: b.id, text: 'left over' }));
  await runner.close();
  const { runner: again } = await setupMessagingWithStore(store);
  const turn = await until(async () => (await store.turns(b.id))[0] ?? null);
  await finished(store, turn.id);
  assert.match((await store.events(b.id)).find((e) => e.type === 'user').text, /left over/);
  assert.deepEqual(await store.inbox(b.id), []);
  await again.close();
});
```

`setupMessagingWithStore(store)` reuses an existing store; add it next to `setupMessaging`:

```js
async function setupMessagingWithStore(store) {
  const messaging = {};
  const realTools = createTools({
    store: { read: async () => null, list: async () => [] },
    writeOps: async () => ({ applied: 0 }),
    createDocument: async () => {},
    buildStarter: async () => '',
    guidePath: '/nonexistent',
    examine: () => [],
    messaging,
  });
  const provider = createFakeProvider({ scripts: SCRIPTS });
  const runner = createRunner({
    store,
    tools: realTools,
    providers: new Map([['fake', provider]]),
    workdir: path.join(os.tmpdir(), `marble-runner-again-${Date.now()}`),
    driveRoot: os.tmpdir(),
    projects: { find: async (id) => (!id || id === 'drive' ? { id: 'drive', name: 'Drive', path: os.tmpdir(), builtIn: true } : null) },
    origin: () => 'http://127.0.0.1:1',
    bridgePath: path.join(HERE, '..', 'bin', 'marble-mcp.js'),
    readDocument: async () => '<html><body data-marble-id="b"><p data-marble-id="p">hi</p></body></html>',
    publish: () => {},
    limits: { maxRunning: 3, stallMs: 60_000, maxMs: 60_000, killGraceMs: 200 },
    log: { log() {}, error() {} },
  });
  Object.assign(messaging, {
    peers: (turn) => runner.peers(turn),
    deliver: (turn, input) => runner.deliver(turn, input),
    wait: (turn, seconds) => runner.wait(turn, seconds),
  });
  await runner.boot();
  return { runner };
}
```

Check the top of the file for `HERE`; if absent, add `const HERE = path.dirname(fileURLToPath(import.meta.url));` with `import { fileURLToPath } from 'node:url';`. Also confirm `setup()` passes a real `bridgePath` — it currently passes `/nonexistent/marble-mcp.js`, which is fine for tests whose scripts never call a tool but not for these. Change `setup()`'s `bridgePath` to `path.join(HERE, '..', 'bin', 'marble-mcp.js')`; existing tests do not depend on it being missing (they stub `tools.call`, which the bridge reaches through `runner.callTool`). Run the whole file after the change to confirm.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/agent-runner.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: the seven new tests fail (`runner.peers is not a function`, `runner.deliver is not a function`, or tool `{ error: 'no tool "list_agents"' }`); the existing tests still pass.

- [ ] **Step 3: Implement**

In `server/agent/runner.js`:

1. Imports at the top, next to the existing ones:

```js
import { MAX_HOP, MAX_SENDS, clampSeconds, pickTarget, renderMessages, validateText } from './messages.js';
import { MESSAGING_INSTRUCTIONS } from './instructions.js';
```

2. `send()` signature and the turn object. Change the first line to:

```js
  async function send(conversationId, { prompt, context, from = null }) {
```

Add to the turn literal, after `inflight: new Set(),`:

```js
      sent: 0, // messages this turn has sent; capped
      waiter: null, // resolve() of a wait_for_reply parked on this turn
      from, // { conversation, title, provider } when a message started this turn
```

Change the `user` emit to carry `from`:

```js
    await emit(turn, {
      type: 'user',
      text: turn.prompt,
      context: { viewing: frozen.viewing, target: frozen.target, selection: frozen.selection, also: frozen.also ?? [] },
      ...(from ? { from } : {}),
    });
```

3. `composePrompt()`: after the `others` block and before the `handoffFrom` block, add the inbox flush and the paragraph:

```js
    // Messages that arrived while this conversation was busy or asleep ride in
    // on whatever turn starts next, so no message waits for a person.
    const arrived = await store.takeInbox(turn.conversationId);
    if (arrived.length) {
      for (const m of arrived) {
        await emit(turn, { type: 'message', messageId: m.id, from: m.from, fromTitle: (await store.conversation(m.from))?.title ?? null, text: m.text, about: m.about, delivered: 'inbox' });
      }
      lines.push('', 'Messages that arrived while you were away:', '', renderMessages(arrived, await titlesOf(arrived.map((m) => m.from))));
    }
    if (await hasPeers(turn.conversationId, project.id)) lines.push('', MESSAGING_INSTRUCTIONS);
```

Add the two helpers next to `handoffBrief`:

```js
  async function titlesOf(ids) {
    const titles = new Map();
    for (const id of new Set(ids)) {
      const meta = await store.conversation(id);
      if (meta) titles.set(id, { title: meta.title, provider: meta.provider });
    }
    return titles;
  }

  async function projectPeers(conversationId, projectId) {
    const all = await store.conversations({ archived: false });
    return all.filter((c) => c.id !== conversationId && (c.project ?? 'drive') === projectId);
  }

  const hasPeers = async (conversationId, projectId) => (await projectPeers(conversationId, projectId)).length > 0;
```

4. `start()`: the activity line. Replace

```js
      await store.updateConversation(turn.conversationId, { running: true, activity: `Working on ${turn.target}` });
```

with

```js
      await store.updateConversation(turn.conversationId, {
        running: true,
        activity: turn.from ? `Message from ${turn.from.title || turn.from.conversation}` : `Working on ${turn.target}`,
      });
```

5. `finish()`'s `finally`: after `live.delete(turn.id);` and the `onFinish` block, before `turn.endTurn();`, add:

```js
      // Anything that arrived for this conversation while it was running and
      // was not taken by a wait rides in on a delivery turn. At most one: the
      // next turn to start takes the whole inbox.
      if (!closed) {
        store.inbox(turn.conversationId)
          .then((pending) => (pending.length ? startDelivery(turn.conversationId, pending, turn.target) : null))
          .catch((err) => log.error(`[agents] ${err.message}`));
      }
```

6. The delivery starter, next to `send`:

```js
  /** Start a turn on an idle conversation carrying the messages in its inbox.
   *  Returns the send result, or null when the conversation is gone or has no
   *  document to work in. */
  async function startDelivery(conversationId, messages, fallbackTarget = null) {
    const meta = await store.conversation(conversationId);
    if (!meta) return null;
    const first = messages[0];
    const target = pickTarget({ receiver: meta, about: first?.about, senderTarget: fallbackTarget });
    if (!target) {
      log.error(`[agents] a message for ${conversationId} has no document to start a turn in; left in its inbox`);
      return null;
    }
    const taken = await store.takeInbox(conversationId);
    const batch = taken.length ? taken : messages;
    const sender = await store.conversation(first.from);
    return send(conversationId, {
      prompt: renderMessages(batch, await titlesOf(batch.map((m) => m.from))),
      context: { target },
      from: { conversation: first.from, title: sender?.title ?? null, provider: sender?.provider ?? null },
    });
  }
```

7. The messaging surface, in the returned object after `answer`:

```js
    /** The other conversations in this turn's project, with what each is
     *  doing right now. The caller is omitted; archived ones too. */
    async peers(turn) {
      const meta = await store.conversation(turn.conversationId);
      const projectId = turn.project?.id ?? meta?.project ?? 'drive';
      const others = await projectPeers(turn.conversationId, projectId);
      const statusOf = (c) => {
        const running = runningTurns().find((t) => t.conversationId === c.id);
        if (running?.waiter) return 'waiting';
        if (running && [...running.asks.values()].some((a) => !a.closed)) return 'asking';
        if (running) return 'running';
        if ([...live.values()].some((t) => t.conversationId === c.id && t.status === 'queued')) return 'queued';
        return 'idle';
      };
      return {
        agents: others
          .sort((x, y) => (y.lastInteractedAt ?? 0) - (x.lastInteractedAt ?? 0))
          .map((c) => ({ id: c.id, title: c.title, provider: c.provider, target: c.target, status: statusOf(c), activity: c.activity, lastFinishedAt: c.lastFinishedAt })),
      };
    },

    /** Send a message from this turn's conversation. Every refusal is a
     *  returned reason; nothing here throws at an agent. */
    async deliver(turn, { to, text, about = null, inReplyTo = null }) {
      const badText = validateText(text);
      if (badText) return { error: badText };
      if (typeof to !== 'string' || !to) return { error: 'to is required' };
      if (to === turn.conversationId) return { error: 'you cannot message yourself' };
      const receiver = await store.conversation(to);
      if (!receiver) return { error: `no conversation "${to}"` };
      if (receiver.archived) return { error: `conversation "${to}" is archived` };
      const sender = await store.conversation(turn.conversationId);
      const projectId = turn.project?.id ?? sender?.project ?? 'drive';
      if ((receiver.project ?? 'drive') !== projectId) return { error: `conversation "${to}" is in another project` };
      if ((turn.sent ?? 0) >= MAX_SENDS) return { error: `this turn has already sent ${MAX_SENDS} messages` };
      let hop = 0;
      if (inReplyTo) {
        const parent = threads.get(inReplyTo);
        hop = (parent?.hop ?? -1) + 1; // an unknown parent (host restarted) starts a fresh thread
        if (hop > MAX_HOP) return { error: `this thread is ${MAX_HOP} replies deep; start a new message if there is something new to say` };
      }
      const cleanAbout = about && typeof about.path === 'string' && about.path
        ? { path: about.path, ...(Array.isArray(about.ids) ? { ids: about.ids.map(String) } : {}) }
        : null;
      const message = store.createMessage({ from: turn.conversationId, to, text, about: cleanAbout, inReplyTo, hop });
      threads.set(message.id, { hop, from: message.from, to });
      turn.sent = (turn.sent ?? 0) + 1;

      await store.appendInbox(to, message);
      const running = runningTurns().find((t) => t.conversationId === to);
      const queued = [...live.values()].some((t) => t.conversationId === to && t.status === 'queued');
      let delivered;
      if (running?.waiter) {
        delivered = 'live';
        running.waiter();
      } else if (running || queued) {
        delivered = 'inbox';
      } else {
        delivered = (await startDelivery(to, [message], turn.target)) ? 'turn' : 'inbox';
      }
      await recordSent(turn, message, receiver, delivered);
      return { messageId: message.id, delivered, to: { id: to, title: receiver.title } };
    },

    /** Park this turn until a message arrives or the clamp runs out. The
     *  stall timer is held, as it is for an open ask. */
    async wait(turn, seconds) {
      const ms = clampSeconds(seconds) * 1000;
      const take = async () => {
        const messages = await store.takeInbox(turn.conversationId);
        for (const m of messages) {
          await emit(turn, { type: 'message', messageId: m.id, from: m.from, fromTitle: (await store.conversation(m.from))?.title ?? null, text: m.text, about: m.about, delivered: 'live' });
        }
        return messages;
      };
      const early = await take();
      if (early.length) return { messages: early };
      turn.holdStall?.();
      let timer;
      const woke = await new Promise((resolve) => {
        turn.waiter = () => resolve(true);
        timer = setTimeout(() => resolve(false), ms);
        timer.unref?.();
      });
      clearTimeout(timer);
      turn.waiter = null;
      turn.resumeStall?.();
      if (!woke) return { timeout: true };
      const messages = await take();
      return messages.length ? { messages } : { timeout: true };
    },
```

Add the two pieces of state and the recorder near `publishChains`:

```js
  // messageId → { hop, from, to } for every message this host has sent. The
  // hop cap reads the parent from here; a parent minted before a restart is
  // unknown and starts a fresh thread, which is the lenient side to err on.
  const threads = new Map();

  async function recordSent(turn, message, receiver, delivered) {
    if (!turn.id) return; // a synthetic turn in a test has no transcript to write
    await emit(turn, {
      type: 'message.sent',
      messageId: message.id,
      to: message.to,
      toTitle: receiver.title,
      text: message.text,
      about: message.about,
      inReplyTo: message.inReplyTo,
      delivered,
    });
  }
```

8. `boot()`:

```js
    async boot() {
      await store.interruptUnfinished();
      // A host that stopped with messages waiting delivers them now.
      for (const c of await store.conversations({ archived: false })) {
        const pending = await store.inbox(c.id);
        if (pending.length) await startDelivery(c.id, pending).catch((err) => log.error(`[agents] ${err.message}`));
      }
    },
```

9. A waiting turn that is stopped must not stay parked. In `finish()`, right after `for (const clear of turn.timers) clear();` add:

```js
    turn.waiter?.(); // a wait parked on this turn returns now; the tool call is in `inflight` and drains below
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/agent-runner.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`. If the third test ("waiting turn receives a message live") is flaky because `b`'s delivery turn races the hand-delivered reply, simplify it: remove the `bTurn` lookup and deliver from the synthetic `bLive` turn only. The assertion that matters is `delivered === 'live'` and the `message` event with `delivered: 'live'` on `a`.

Then the whole suite: `node --test "test/**/*.test.js" 2>&1 | grep -E "^# (pass|fail)"`. Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server/agent/runner.js test/agent-runner.test.js
git commit -m "Let a turn list its project's other conversations, message one, and wait for a reply; the inbox rides in on whatever turn starts next."
```

---

### Task 4: Tools — three schemas delegating to the runner, and the wiring

**Files:**
- Modify: `server/agent/tools.js` (`TOOL_SCHEMAS`, `createTools` options, `handlers`)
- Modify: `server/agent/index.js` (lines ~126–170: create `messaging`, pass it, fill it)
- Test: `test/agent-tools.test.js`

**Interfaces:**
- Consumes: `runner.peers(turn)`, `runner.deliver(turn, input)`, `runner.wait(turn, seconds)` from Task 3.
- Produces: `createTools({ ..., messaging = null })` where `messaging` is an object whose `peers`, `deliver`, `wait` may be assigned after creation. Handlers return `{ error: 'messaging is not available on this host' }` when a function is missing.

- [ ] **Step 1: Write the failing tests**

In `test/agent-tools.test.js`, update the schema test to include the new names:

```js
test('the schemas name the marble tools', () => {
  assert.deepEqual(TOOL_SCHEMAS.map((t) => t.name).sort(), [
    'apply_ops', 'check_document', 'create_document', 'list_agents', 'list_documents', 'read_document', 'read_guide', 'send_message', 'wait_for_reply',
  ]);
  for (const t of TOOL_SCHEMAS) assert.equal(t.inputSchema.type, 'object');
});
```

Add:

```js
test('the messaging tools delegate to the host and pass the turn through', async () => {
  const seen = [];
  const messaging = {
    peers: async (turn) => { seen.push(['peers', turn.conversationId]); return { agents: [] }; },
    deliver: async (turn, input) => { seen.push(['deliver', turn.conversationId, input]); return { messageId: 'm', delivered: 'turn', to: { id: input.to, title: null } }; },
    wait: async (turn, seconds) => { seen.push(['wait', turn.conversationId, seconds]); return { timeout: true }; },
  };
  const t = createTools({
    store: drive.store, writeOps: drive.writeOps, createDocument: drive.createDocument,
    buildStarter: build, guidePath: enginePath('skills/build-in-marble/SKILL.md'), messaging,
  });
  const turn = await freshTurn();
  assert.deepEqual(await t.call('list_agents', {}, turn), { agents: [] });
  assert.equal((await t.call('send_message', { to: 'b', text: 'hi', about: { path: 'garden', ids: ['h'] } }, turn)).messageId, 'm');
  assert.deepEqual(await t.call('wait_for_reply', { seconds: 30 }, turn), { timeout: true });
  assert.deepEqual(seen, [
    ['peers', turn.conversationId],
    ['deliver', turn.conversationId, { to: 'b', text: 'hi', about: { path: 'garden', ids: ['h'] }, inReplyTo: null }],
    ['wait', turn.conversationId, 30],
  ]);
});

test('without a messaging host the tools say so instead of throwing', async () => {
  const turn = await freshTurn();
  assert.match((await tools.call('list_agents', {}, turn)).error, /not available/);
  assert.match((await tools.call('send_message', { to: 'b', text: 'x' }, turn)).error, /not available/);
  assert.match((await tools.call('wait_for_reply', {}, turn)).error, /not available/);
});

test('send_message and wait_for_reply describe the caps and the meaning of a timeout', () => {
  const send = TOOL_SCHEMAS.find((t) => t.name === 'send_message');
  const wait = TOOL_SCHEMAS.find((t) => t.name === 'wait_for_reply');
  assert.deepEqual(send.inputSchema.required, ['to', 'text']);
  assert.equal(send.inputSchema.properties.text.maxLength, 4000);
  assert.match(send.description, /12/);
  assert.equal(wait.inputSchema.properties.seconds.maximum, 300);
  assert.match(wait.description, /nothing/i);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/agent-tools.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: four `not ok` (the schema list, the delegation, the not-available answer, the descriptions).

- [ ] **Step 3: Implement**

In `server/agent/tools.js`, import the limits:

```js
import { MAX_SENDS, MAX_TEXT, WAIT_DEFAULT, WAIT_MAX, WAIT_MIN } from './messages.js';
```

Append to `TOOL_SCHEMAS`:

```js
  {
    name: 'list_agents',
    description:
      'List the other agent conversations working in this project: id, title, provider, the document each works on, ' +
      'and its status (idle, queued, running, waiting for a reply, asking the person). Use an id with send_message.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_message',
    description:
      'Send a message to another agent conversation in this project. If it is idle, this starts its turn; if it is busy, ' +
      `it reads the message when its current turn ends or when it calls wait_for_reply. At most ${MAX_SENDS} messages per turn; ` +
      'a thread of replies stops after 8. Returns the message id and how it was delivered. To answer a message, pass its id as inReplyTo.',
    inputSchema: {
      type: 'object',
      required: ['to', 'text'],
      properties: {
        to: { type: 'string', description: 'The conversation id, from list_agents or from the message you are answering.' },
        text: { type: 'string', maxLength: MAX_TEXT },
        about: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } },
          description: 'The document, and optionally the elements, this message is about.',
        },
        inReplyTo: { type: 'string', description: 'The id of the message you are answering.' },
      },
    },
  },
  {
    name: 'wait_for_reply',
    description:
      `Wait up to \`seconds\` (default ${WAIT_DEFAULT}, at most ${WAIT_MAX}) for messages from other agents. Returns them as soon as one arrives. ` +
      'A timeout means nothing has arrived yet: call again if you are still waiting, or move on.',
    inputSchema: {
      type: 'object',
      properties: { seconds: { type: 'integer', minimum: WAIT_MIN, maximum: WAIT_MAX } },
    },
  },
```

Change the `createTools` signature:

```js
export function createTools({ store, writeOps, createDocument, buildStarter, guidePath, examine, onLook, messaging = null }) {
```

Add to `handlers`:

```js
    // Messaging lives on the runner, which is created after the tools; the
    // host fills `messaging` in once it exists. Until then, and on a host
    // without agents, these answer plainly.
    async list_agents(_input, turn) {
      if (!messaging?.peers) return { error: 'messaging is not available on this host' };
      return messaging.peers(turn);
    },

    async send_message(input, turn) {
      if (!messaging?.deliver) return { error: 'messaging is not available on this host' };
      return messaging.deliver(turn, {
        to: input.to,
        text: input.text,
        about: input.about ?? null,
        inReplyTo: input.inReplyTo ?? null,
      });
    },

    async wait_for_reply(input, turn) {
      if (!messaging?.wait) return { error: 'messaging is not available on this host' };
      return messaging.wait(turn, input.seconds);
    },
```

In `server/agent/index.js` `boot()`: before `const tools = createTools({`, add `const messaging = {};`; pass `messaging,` into `createTools`; after `await runner.boot();` add:

```js
  // Late-bound: the tools exist before the runner, the runner needs the
  // tools, and messaging is the runner's. Three functions by name, not the
  // runner itself, so tools stay testable with a stub.
  Object.assign(messaging, {
    peers: (turn) => runner.peers(turn),
    deliver: (turn, input) => runner.deliver(turn, input),
    wait: (turn, seconds) => runner.wait(turn, seconds),
  });
```

Note: assign `messaging` **before** `await runner.boot()` rather than after, because boot may start delivery turns whose agents call the tools immediately. Move the `Object.assign` to just after `const runner = createRunner({...});` and before `await runner.boot();`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/agent-tools.test.js test/agent-runner.test.js test/agent-http.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`. `agent-http.test.js` boots the real `createAgents`, which exercises the wiring.

- [ ] **Step 5: Commit**

```bash
git add server/agent/tools.js server/agent/index.js test/agent-tools.test.js
git commit -m "Expose list_agents, send_message and wait_for_reply on the bridge, bound to the runner after it exists."
```

---

### Task 5: Cursor hook allowlist

**Files:**
- Modify: `bin/marble-cursor-hook.js:18-25`
- Test: `test/agent-provider-cursor.test.js`

**Interfaces:** none new. The hook reads `MCP:<name>` and must allow the three new names at every capability.

- [ ] **Step 1: Write the failing test**

The file already defines `HOOK` (line ~17) as the path to `bin/marble-cursor-hook.js` but only checks that `prepare()` writes it into `hooks.json`; nothing runs it. Add a helper that runs the hook the way Cursor does — JSON on stdin, JSON on stdout — and a test:

```js
import { spawn } from 'node:child_process';

/** Run the hook as Cursor would: `{ tool_name }` on stdin, one JSON answer on stdout. */
const runHook = (toolName, capability = '') => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [HOOK], { env: { ...process.env, MARBLE_CURSOR_CAPABILITY: capability }, stdio: ['pipe', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.on('error', reject);
  child.on('close', () => {
    try { resolve(JSON.parse(out)); } catch (err) { reject(err); }
  });
  child.stdin.end(JSON.stringify({ tool_name: toolName }));
});

test('the hook allows the messaging tools at the narrow capability, and still denies a stranger', async () => {
  for (const name of ['MCP:list_agents', 'MCP:send_message', 'MCP:wait_for_reply']) {
    assert.equal((await runHook(name)).permission, 'allow', `${name} is allowed`);
  }
  const blocked = await runHook('MCP:somebody_elses_tool');
  assert.equal(blocked.permission, 'deny');
  assert.match(blocked.agent_message, /send_message/, 'the denial names the tools that are available');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/agent-provider-cursor.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: one `not ok`: the three names are denied.

- [ ] **Step 3: Implement**

In `bin/marble-cursor-hook.js`, extend the set:

```js
const MARBLE = new Set([
  'MCP:list_documents',
  'MCP:read_document',
  'MCP:apply_ops',
  'MCP:create_document',
  'MCP:read_guide',
  'MCP:check_document',
  'MCP:list_agents',
  'MCP:send_message',
  'MCP:wait_for_reply',
]);
```

And in the same file's denial answer, update the narrow-capability `agent_message` so it names what is actually available:

```js
          : 'Only the marble tools are available here: list_documents, read_document, apply_ops, create_document, check_document, read_guide, list_agents, send_message and wait_for_reply.',
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/agent-provider-cursor.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add bin/marble-cursor-hook.js test/agent-provider-cursor.test.js
git commit -m "Let Cursor agents reach the messaging tools through the hook."
```

---

### Task 6: The Agents page — from-bubble, sent line, and opening the sender

**Files:**
- Modify: `runtime/agent-ui.js` — CSS near line 1016 (`.msg.me`), `userMessage()` at line ~2580, the `switch` at line ~2639, `system()` at line ~2846
- Modify: `templates/agents.mrbl` — one listener near `async function open(id)` (line ~4659)
- Test: `test-browser/agents-page.test.js`

**Interfaces:**
- Consumes: `user` events with `from: { conversation, title, provider }`; `message` events `{ from, fromTitle, text, delivered }`; `message.sent` events `{ to, toTitle, text, delivered }` (Task 3).
- Produces: a `marble-agent:open` CustomEvent (`bubbles: true, composed: true, detail: { id }`) dispatched from the `<marble-conversation>` element when the person clicks a sender's name; the Agents page listens on `document` and calls its `open(id)`.

- [ ] **Step 1: Write the failing browser test**

Add to `test-browser/agents-page.test.js`:

```js
test('a message from another agent renders as a from-bubble that opens the sender', async () => {
  const { page, errors } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'Sender' });
    await agent.send(a, { prompt: 'script:sendone', target: 'garden', viewing: 'Agents', selection: [] });
    return { a, b };
  });
  // Open b once its turn exists; the delivery turn's user event carries `from`.
  await page.locator(`.conv[data-id="${ids.b}"]`).waitFor();
  await page.locator(`.conv[data-id="${ids.b}"]`).click();
  const bubble = page.locator('marble-conversation .msg.me.from-agent').first();
  await bubble.waitFor({ timeout: 15_000 });
  assert.match(await bubble.locator('.from').textContent(), /Sender/);
  assert.match(await bubble.locator('.msg-text').textContent(), /ping from a/);
  await bubble.locator('.from').click();
  await page.waitForFunction((id) => document.querySelector('marble-conversation')?.getAttribute('conversation') === id, ids.a);
  const sent = page.locator('marble-conversation .system', { hasText: /Sent to/ }).first();
  await sent.waitFor();
  assert.deepEqual(errors, []);
});
```

The browser harness's `startDrive({ scripts })` hands `scripts` to the fake provider. `test-browser/agents-page.test.js` calls `startDrive` once near its top with a `scripts` object (search for `startDrive(`); add the `sendone` script from Task 3 to that object verbatim:

```js
  sendone: [
    { call: 'list_agents', args: {}, as: 'peers' },
    { call: 'send_message', args: { to: { $ref: 'peers.agents.0.id' }, text: 'ping from a' }, as: 'sent' },
    { say: 'sent' },
  ],
```

In the browser both conversations are in the `drive` project, so `peers.agents.0` is `b` (the only other conversation).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-concurrency=1 test-browser/agents-page.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: one `not ok`: `.msg.me.from-agent` never appears.

- [ ] **Step 3: Implement**

In `runtime/agent-ui.js`:

1. CSS, after the `.msg.me` rules near line 1016:

```css
    .msg.me.from-agent { background: var(--paper-2); border: 1px solid var(--line); color: var(--ink); }
    .msg.me .from { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
    .msg.me .from button { all: unset; cursor: pointer; text-decoration: underline; text-decoration-color: var(--line); }
    .msg.me .from button:hover { color: var(--ink); }
```

Use the same custom-property names the surrounding rules use; if `--line` or `--paper-2` are not defined in this stylesheet, use the nearest existing token (read lines 990–1030 first).

2. `userMessage(text, from = null)`: change the signature and, right after `const node = h('div', 'msg me');`, add:

```js
      if (from) {
        node.classList.add('from-agent');
        const who = h('span', 'from');
        const open = h('button', '', from.title || from.conversation);
        open.type = 'button';
        open.title = 'Open that conversation';
        open.addEventListener('click', () => {
          this.dispatchEvent(new CustomEvent('marble-agent:open', { bubbles: true, composed: true, detail: { id: from.conversation } }));
        });
        who.append('From ', open);
        node.append(who);
      }
```

3. In the `switch`, change the `user` case's append to pass `from`:

```js
          this.append(turn, this.userMessage(event.text, event.from ?? null));
```

and add two cases before `default:`:

```js
        case 'message':
          this.endLive();
          this.append(turn, this.userMessage(event.text, { conversation: event.from, title: event.fromTitle }));
          break;
        case 'message.sent':
          this.system(`Sent to ${event.toTitle || event.to}${event.delivered === 'turn' ? ' — started their turn' : event.delivered === 'live' ? ' — they were waiting' : ' — they will read it when their turn ends'}`);
          break;
```

Also, in the `user` case, the mast title should not become the rendered message when a message started the conversation: change `title: this.meta?.title || said.trim().slice(0, 60)` to `title: this.meta?.title || (event.from ? `From ${event.from.title || event.from.conversation}` : said.trim().slice(0, 60))`.

In `templates/agents.mrbl`, next to `async function open(id)` (line ~4659), register once:

```js
    document.addEventListener('marble-agent:open', (event) => {
      const id = event.detail?.id;
      if (id) open(id).catch(() => {});
    });
```

Place it after `open` is defined, inside the same closure, so `open` is in scope.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-concurrency=1 test-browser/agents-page.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0` (note from memory: four browser tests elsewhere were already failing on 2026-09-18; confirm any failure is pre-existing by running the same file on `git stash` before blaming this task).

Then patch the live document once, with the host stopped: the Agents page script lives in `templates/agents.mrbl`; copy the changed block into `drive/Agents.mrbl` at the same position, verify with `node -e` that the file parses and has no duplicate ids, then restart the host. Do not write `drive/Agents.mrbl` while `marble-drive serve` is running.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js templates/agents.mrbl test-browser/agents-page.test.js test-browser/harness.js
git commit -m "Show a message from another agent as a from-bubble that opens the sender, and say where a sent message went."
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/AGENTS.md` — new section "Messages" after "## Asks" (line ~111); the tool lists in `INSTRUCTIONS`-related prose (grep `read_guide` in the doc first; add the three names wherever the six are enumerated)

- [ ] **Step 1: Write the section**

Insert after the "## Asks" section:

```markdown
## Messages

Agents in one project can talk to each other. Three tools, on every
provider, through the bridge:

- `list_agents` — the other non-archived conversations in this project, with
  what each is doing: `idle`, `queued`, `running`, `waiting` (parked in
  `wait_for_reply`) or `asking`.
- `send_message { to, text, about?, inReplyTo? }` — text up to 4000
  characters, optionally about a document and some ids. Returns the message
  id and how it was delivered: `turn` (the receiver was idle and its turn
  started), `live` (the receiver was waiting and got it at once) or `inbox`
  (the receiver is busy and reads it when its turn ends).
- `wait_for_reply { seconds? }` — waits up to 300 s (default 120) for
  messages. A timeout is a plain `{ timeout: true }`: nothing yet.

The inbox (`<conversation>/inbox.jsonl`) is the one queue. Whatever turn
starts next on that conversation takes it — a queued turn, a turn the
message itself starts, or a delivery turn the runner queues when a turn ends
with messages waiting. A host that restarts with messages waiting delivers
them at boot. A turn that a message started works in the receiver's own
document, else the document the message is about, else the sender's.

Caps: 12 sends per turn, 8 replies per thread, same project only, never to
yourself or an archived conversation. Delivery turns take ordinary
`maxRunning` slots. Nothing here asks the person: a message never raises
Needs you, and the Agents page shows it as a bubble naming the sender, whose
name opens that conversation.

Design: [`superpowers/specs/2026-09-18-agent-messaging-design.md`](superpowers/specs/2026-09-18-agent-messaging-design.md).
```

Update every list of the tools in `docs/AGENTS.md` (search for `check_document`) to name nine tools. Update `docs/AGENTS.md`'s storage list (§Storage, line ~130) to add `<conversationId>/inbox.jsonl  messages waiting for the next turn`.

- [ ] **Step 2: Check the links resolve**

Run: `ls docs/superpowers/specs/2026-09-18-agent-messaging-design.md && grep -c "inbox.jsonl" docs/AGENTS.md`
Expected: the file is listed and the count is at least 2.

- [ ] **Step 3: Commit**

```bash
git add docs/AGENTS.md
git commit -m "Document agent-to-agent messages: the tools, the inbox, the caps."
```

---

## Self-review against the spec

- §2 vocabulary → Task 1 (`createMessage` shape) and Task 3 (`about` cleaning, `hop`).
- §3 tools and every refusal → Task 4 (schemas, delegation) and Task 3 (refusals in `deliver`, clamp in `wait`, stall hold).
- §4 delivery, all three outcomes, inbox at start and finish, boot recovery, target fallback → Task 3 and Task 2 (`pickTarget`).
- §5 caps → Task 2 constants, Task 3 enforcement, Task 3 tests.
- §6 prompt paragraph and rendering → Task 2 (`MESSAGING_INSTRUCTIONS`, `renderMessages`) and Task 3 (`composePrompt`).
- §7 events and UI → Task 3 (events), Task 6 (bubbles, activity line in `start()`).
- §8 Cursor → Task 5.
- §9 files → all present; `index.js` late-binding documented in Task 4.
- §10 tests → Tasks 1–6 each carry theirs; `test/agent-store.test.js` covers reopen; Task 3 covers boot recovery.

Known deviations from the spec, all recorded in Global Constraints: recipient validation lives in the runner; the messaging paragraph is composed per turn by `composePrompt`; the hop cap reads parents from host memory (or from the turn's own inbound messages) and treats an unknown parent as a fresh thread; the static instruction texts name the three messaging tools unconditionally.
