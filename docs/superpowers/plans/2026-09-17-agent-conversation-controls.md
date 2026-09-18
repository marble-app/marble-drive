# Agent Conversation Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New chats remember the blank composer’s model and effort; queued messages can be edited, set to queue/steer/interrupt, and sent as one prompt; consecutive tool rows collapse; clarifying questions get an ↑ ↓ Space Enter picker.

**Architecture:** Dispatch lives on each queued turn (`queue` | `steer` | `interrupt`). Combine is one boolean on the conversation. The runner wraps steer prompts at start, cancels then starts for interrupt, and merges bundled prompts when `queueCombine` is on. The conversation view is still `<marble-conversation>` in `runtime/agent-ui.js`.

**Tech Stack:** Node 22 ESM, existing `node:test` + Playwright harness. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-agent-conversation-controls-design.md`

## Global Constraints

- No new npm dependencies. Browser tests use `test-browser/harness.js`.
- Node 22: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH`.
- Same UIST tokens. Do not reparent `<marble-conversation>`.
- Agent chrome stays transient. Agent text is never `innerHTML`.
- Keep existing class names tests wait on: `.queued`, `.queued-item`, `button.dequeue`, `.tool`, `.msg.me`, `.msg.agent`.
- Steer wrap string, verbatim: `While you were working I added this note. Treat it as course-correction.`
- Bundle body is `1. …\n2. …` of the queued prompts, in send order.
- `behind` is true iff, at `send`, that conversation already had a live `queued` or `running` turn.
- Wrap only when `dispatch === 'steer' && behind`. Interrupt never wraps.
- Batch dispatch: interrupt if any row is interrupt, else steer if any is steer, else queue.
- Blank composer writes `settings.defaultProvider` / `models[id]` / `efforts[id]`. Existing chats PATCH only conversation meta.
- Code style: ESM on the server, IIFE in `runtime/agent-ui.js`, two-space indent, single quotes, comments that say why.
- TDD: failing test first, watch it fail, then implement. Do not skip the red run.
- Do not bind or stop port 4400.

## File Structure

| file | responsibility |
|---|---|
| `server/agent/store.js` | `dispatch`, `behind`, `bundle`, `combined`, `queueCombine` |
| `server/agent/runner.js` | send/patch/pump/merge/`composePrompt` wrap |
| `server/agent/routes.js` | POST `dispatch`, PATCH turn, PATCH `queueCombine` |
| `runtime/agent.js` | `send({ dispatch })`, `patchTurn` |
| `runtime/choice-question.js` | `parseChoiceQuestion`, `toolShortName` (ESM, also served) |
| `runtime/agent-ui.js` | composer keys, queue UI, collapse, picker, blank `saveSettings` |
| `server/app.js` | allowlist `/runtime/choice-question.js` |
| `test/agent-store.test.js` | new fields |
| `test/agent-runner.test.js` | wrap, interrupt, combine |
| `test/agent-http.test.js` | new routes |
| `test/choice-question.test.js` | parser |
| `test-browser/conversation.test.js` | queue, keys, collapse, picker, defaults |

---

### Task 1: Store fields

**Files:**
- Modify: `server/agent/store.js`
- Modify: `test/agent-store.test.js`

**Interfaces:**
- Consumes: `createTurn(id, { prompt, context })`, `createConversation({ provider, … })`
- Produces: `createTurn(id, { prompt, context, dispatch, behind, bundle })` writes `dispatch` default `'queue'`, `behind` default `false`, `bundle` default `null`. `createConversation` writes `queueCombine: false`.

- [ ] **Step 1: Write the failing tests**

Add to `test/agent-store.test.js`:

```js
test('a new turn defaults to queue dispatch and a conversation defaults to sending individually', async () => {
  const { store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  assert.equal((await store.conversation(id)).queueCombine, false);
  const turn = await store.createTurn(id, { prompt: 'a', context: { target: 'doc' } });
  assert.equal(turn.dispatch, 'queue');
  assert.equal(turn.behind, false);
  assert.equal(turn.bundle, null);
  const steered = await store.createTurn(id, {
    prompt: 'b', context: { target: 'doc' }, dispatch: 'steer', behind: true,
  });
  assert.equal(steered.dispatch, 'steer');
  assert.equal(steered.behind, true);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test test/agent-store.test.js`

Expected: FAIL — `queueCombine` undefined, `dispatch` undefined.

- [ ] **Step 3: Minimal implementation**

In `createConversation` meta, add `queueCombine: false`.

In `createTurn`, accept `{ prompt, context, dispatch = 'queue', behind = false, bundle = null }` and write those three fields onto the turn JSON.

- [ ] **Step 4: Run the test and watch it pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/agent/store.js test/agent-store.test.js
git commit -m "$(cat <<'EOF'
feat(agents): store queue dispatch and combine flag

New chats and queued turns need a place for send mode and whether the
list fires as one prompt.
EOF
)"
```

---

### Task 2: Runner — steer wrap, interrupt, combine

**Files:**
- Modify: `server/agent/runner.js`
- Modify: `test/agent-runner.test.js`

**Interfaces:**
- Consumes: Task 1 fields; `createTurn`; existing `send(id, { prompt, context })`, `cancel`, `dequeue`
- Produces:
  - `send(id, { prompt, context, dispatch })` — `dispatch` one of `queue|steer|interrupt`, default `queue`. Sets `behind`. Copies those onto the live turn and the stored turn.
  - `patchQueued(turnId, { prompt?, dispatch? })` — 409 if not queued; 400 if empty prompt or bad dispatch. Updates live + store. Prompt change emits `user.edited`. Dispatch change emits `{ type: 'turn.dispatch', dispatch }`. If the conversation’s effective batch is interrupt and a turn is running, cancel it.
  - `composePrompt` uses `bundle` as `1. …\n2. …` when present, else `prompt`. Prepends the steer wrap plus a blank line when `dispatch === 'steer' && behind`.
  - `pump` / `start`: before starting the next queued turn, if conversation `queueCombine` and ≥2 queued, merge onto the first (set `bundle` to every prompt in order, `dispatch` to the batch rule, extras `status: 'combined'`, emit `turn.combined`, drop from `live`/`order`). Then start the survivor.
  - After creating a turn in `send`, if effective batch dispatch is `interrupt`, cancel the running turn on that conversation, then `pump`.

**Helpers to add in `runner.js` (names exact):**

```js
const STEER_NOTE = 'While you were working I added this note. Treat it as course-correction.';
const DISPATCH = new Set(['queue', 'steer', 'interrupt']);

function liveFor(conversationId) {
  return [...live.values()].filter((t) => t.conversationId === conversationId);
}
function queuedFor(conversationId) {
  return order.map((id) => live.get(id)).filter((t) => t && t.conversationId === conversationId && t.status === 'queued');
}
function batchDispatch(turns) {
  if (turns.some((t) => t.dispatch === 'interrupt')) return 'interrupt';
  if (turns.some((t) => t.dispatch === 'steer')) return 'steer';
  return 'queue';
}
```

Effective batch at send/patch time: if `meta.queueCombine`, `batchDispatch(queuedFor(id))` (including the turn just added); else that turn’s own `dispatch`.

- [ ] **Step 1: Write the failing tests**

Append to `test/agent-runner.test.js`. Reuse `setup`, `finished`, `until`. The fake agent’s first `text` event is `prompt:` plus stdin’s first line.

```js
test('a steer that waited wraps the model prompt, not the user event', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const first = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  const second = await runner.send(id, { prompt: 'script:hello\nkeep going', context: { target: 'd' }, dispatch: 'steer' });
  assert.equal((await store.turn(second.turnId)).dispatch, 'steer');
  assert.equal((await store.turn(second.turnId)).behind, true);
  await finished(store, first.turnId);
  await finished(store, second.turnId);
  const user = (await store.events(id)).find((e) => e.turn === second.turnId && e.type === 'user');
  assert.equal(user.text, 'script:hello\nkeep going');
  const echoed = (await store.events(id)).find((e) => e.turn === second.turnId && e.type === 'text');
  assert.match(echoed.text, /^prompt:While you were working I added this note/);
  await runner.close();
});

test('idle steer does not wrap', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' }, dispatch: 'steer' });
  await finished(store, turnId);
  assert.equal((await store.turn(turnId)).behind, false);
  const echoed = (await store.events(id)).find((e) => e.type === 'text');
  assert.equal(echoed.text, 'prompt:script:hello');
  await runner.close();
});

test('interrupt cancels the running turn then starts the next', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const first = await runner.send(id, { prompt: 'script:hold', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  const second = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' }, dispatch: 'interrupt' });
  await finished(store, first.turnId);
  await finished(store, second.turnId);
  assert.equal((await store.turn(first.turnId)).status, 'cancelled');
  assert.equal((await store.turn(second.turnId)).status, 'completed');
  await runner.close();
});

test('queueCombine merges queued prompts onto the first turn', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(id, { queueCombine: true });
  const first = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  const a = await runner.send(id, { prompt: 'alpha note', context: { target: 'd' } });
  const b = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } });
  await finished(store, first.turnId);
  await finished(store, a.turnId);
  assert.equal((await store.turn(b.turnId)).status, 'combined');
  assert.deepEqual((await store.turn(a.turnId)).bundle, ['alpha note', 'script:hello']);
  const echoed = (await store.events(id)).find((e) => e.turn === a.turnId && e.type === 'text');
  assert.equal(echoed.text, 'prompt:1. alpha note');
  assert.ok((await store.events(id)).some((e) => e.type === 'turn.combined' && e.turn === b.turnId));
  const userA = (await store.events(id)).find((e) => e.turn === a.turnId && e.type === 'user');
  const userB = (await store.events(id)).find((e) => e.turn === b.turnId && e.type === 'user');
  assert.equal(userA.text, 'alpha note');
  assert.equal(userB.text, 'script:hello');
  await runner.close();
});

test('combined interrupt cancels running and does not steer-wrap', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(id, { queueCombine: true });
  const first = await runner.send(id, { prompt: 'script:hold', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  const a = await runner.send(id, { prompt: 'one', context: { target: 'd' } });
  const b = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' }, dispatch: 'interrupt' });
  await finished(store, first.turnId);
  await finished(store, a.turnId);
  assert.equal((await store.turn(first.turnId)).status, 'cancelled');
  assert.equal((await store.turn(b.turnId)).status, 'combined');
  const echoed = (await store.events(id)).find((e) => e.turn === a.turnId && e.type === 'text');
  assert.equal(echoed.text, 'prompt:1. one');
  await runner.close();
});

test('patchQueued edits a waiting prompt and cycles dispatch', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const first = await runner.send(id, { prompt: 'script:hold', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  const second = await runner.send(id, { prompt: 'later', context: { target: 'd' } });
  await runner.patchQueued(second.turnId, { prompt: 'script:hello' });
  assert.equal((await store.turn(second.turnId)).prompt, 'script:hello');
  assert.ok((await store.events(id)).some((e) => e.type === 'user.edited' && e.text === 'script:hello'));
  await runner.patchQueued(second.turnId, { dispatch: 'steer' });
  assert.equal((await store.turn(second.turnId)).dispatch, 'steer');
  await runner.cancel(first.turnId);
  await finished(store, first.turnId);
  await finished(store, second.turnId);
  await runner.close();
});
```

`script:hold` must exist in this file’s `SCRIPTS` (add `{ silent: 20_000 }` like the browser tests) if it is not already there. Do not change existing tests’ expected event lists except where `turn.queued` may now carry `dispatch` — existing `deepEqual` on event types must still pass (`turn.queued` stays in the same place; extra fields on the event object are fine).

- [ ] **Step 2: Run the new tests and watch them fail**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test test/agent-runner.test.js`

Expected: FAIL — `send` has no `dispatch`, no wrap, no `patchQueued`.

- [ ] **Step 3: Minimal implementation**

`send`:
1. Normalize `dispatch` through `DISPATCH` (unknown → `'queue'`).
2. `behind = liveFor(id).some((t) => t.status === 'queued' || t.status === 'running')`.
3. Pass `{ prompt, context, dispatch, behind }` into `createTurn`.
4. Put `dispatch` and `behind` on the live turn object (same fields as today: `id`, `prompt`, …).
5. `emit(turn, { type: 'user', … })` unchanged.
6. `emit(turn, { type: 'turn.queued', dispatch: turn.dispatch })`.
7. After `live.set` / `order.push`, if effective batch is `interrupt`, find the running turn on this conversation and `cancel` it (do not cancel the new turn).
8. `await pump()`.

`composePrompt`: build `body` from `bundle` or `prompt`. If `turn.dispatch === 'steer' && turn.behind`, `body = STEER_NOTE + '\n\n' + body`. Then the existing context block using `body` instead of `turn.prompt`.

`mergeQueued(conversationId)`: if `!(await store.conversation(id)).queueCombine` return. `const waiting = queuedFor(id)`. If `waiting.length < 2` return. Survivor = `waiting[0]`. `survivor.bundle = waiting.map((t) => t.prompt)`. `survivor.dispatch = batchDispatch(waiting)`. `await store.updateTurn(survivor.id, { bundle: survivor.bundle, dispatch: survivor.dispatch })`. For each extra: `live.delete`, splice `order`, `emit({ type: 'turn.combined' })`, `store.updateTurn(id, { status: 'combined', finishedAt: Date.now() })`.

Call `await mergeQueued(turn.conversationId)` at the top of `start`, or in `pump` immediately before `start`.

`patchQueued`: as the interface block. After a dispatch patch, if effective batch is interrupt, cancel running then `pump`.

Export `patchQueued` next to `dequeue` on the returned runner object.

- [ ] **Step 4: Run tests and watch them pass**

Same command plus the rest of `test/agent-runner.test.js`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/agent/runner.js test/agent-runner.test.js
git commit -m "$(cat <<'EOF'
feat(agents): steer, interrupt, and combined queued turns

The runner now waits and wraps a steer, cancels then starts an
interrupt, and can fire the queue as one numbered prompt.
EOF
)"
```

---

### Task 3: HTTP and `marble.agent`

**Files:**
- Modify: `server/agent/routes.js`
- Modify: `runtime/agent.js`
- Modify: `test/agent-http.test.js`

**Interfaces:**
- Consumes: `runner.send(..., { dispatch })`, `runner.patchQueued`
- Produces:
  - `POST /agent/conversations/:id/turns` reads `body.dispatch` (omit → queue). Invalid string → 400 `{ error: 'dispatch must be queue, steer, or interrupt' }`.
  - `PATCH /agent/turns/:id` → `patchQueued`. 404 if no turn. Map thrown `status`.
  - `PATCH /agent/conversations/:id` accepts boolean `queueCombine`. After save, if true and batch is interrupt, `runner` must cancel running (call `patchQueued` is wrong here — after update, if a running turn exists and `queuedFor` batch is interrupt, `runner.cancel(runningId)`). Simplest: add `runner.syncQueue(conversationId)` that reads meta, merges/cancels as `send` does at the end. **Do not invent a third path:** after PATCH `queueCombine`, call `runner.patchQueued` on the first queued turn with its current dispatch (no-op write) only if that is awkward. Preferred: export `runner.kick(conversationId)` which: if `queueCombine` and batch interrupt and something is running, cancel it; then `pump()`.
  - `marble.agent.send(id, { prompt, dispatch, … })` includes `dispatch` in the POST body when provided.
  - `marble.agent.patchTurn(turnId, patch)` → `PATCH /agent/turns/:id`.

TURN regex stays `^/agent/turns/([0-9a-f]{12}-t\d+)(/cancel|/undo)?$`. PATCH is `!action && method === 'PATCH'`.

- [ ] **Step 1: Write the failing HTTP tests**

In `test/agent-http.test.js`, next to the existing dequeue test:

```js
test('a turn can be sent as steer and a queued turn can be patched', async () => {
  const running = await start('script:wait');
  const queued = await api('POST', `/agent/conversations/${running.conversationId}/turns`, {
    prompt: 'later', context: { target: 'garden', selection: [] }, dispatch: 'steer',
  });
  assert.equal(queued.status, 202);
  const edited = await api('PATCH', `/agent/turns/${queued.body.turnId}`, { prompt: 'later still' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.prompt, 'later still');
  const steered = await api('PATCH', `/agent/turns/${queued.body.turnId}`, { dispatch: 'steer' });
  assert.equal(steered.body.dispatch, 'steer');
  const bad = await api('POST', `/agent/conversations/${running.conversationId}/turns`, {
    prompt: 'x', context: { target: 'garden', selection: [] }, dispatch: 'yell',
  });
  assert.equal(bad.status, 400);
  const combine = await api('PATCH', `/agent/conversations/${running.conversationId}`, { queueCombine: true });
  assert.equal(combine.body.queueCombine, true);
  await api('POST', `/agent/turns/${running.turnId}/cancel`);
  await api('DELETE', `/agent/turns/${queued.body.turnId}`);
});
```

`patchQueued` should return the updated turn JSON (so HTTP can `json(res, 200, turn)`).

- [ ] **Step 2: Run and watch fail**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test test/agent-http.test.js`

Expected: FAIL — PATCH turn 404/405, `queueCombine` missing.

- [ ] **Step 3: Implement routes + carrier**

`POST` turns: parse `dispatch` from body; if present and not in the set, 400; pass to `runner.send`.

`PATCH` turn: `try { return json(res, 200, await runner.patchQueued(turnId, body)) } catch (err) { return json(res, err.status ?? 500, { error: err.message }) }`.

Conversation PATCH: `if (typeof body.queueCombine === 'boolean') patch.queueCombine = body.queueCombine`. After `updateConversation`, if `queueCombine === true`, `await runner.kick(id)` (implement `kick` in the same commit as this task if Task 2 did not: cancel running when batch is interrupt, then `pump()`). Always `hub.publish(id, { type: 'meta', queueCombine: (await store.conversation(id)).queueCombine }, next)`.

`runtime/agent.js`:

```js
send(id, { prompt, target, viewing, selection, also, dispatch } = {}) {
  const here = context();
  const body = {
    prompt,
    context: {
      target: target ?? here.target,
      viewing: viewing ?? here.viewing,
      selection: selection ?? here.selection,
      also: also ?? here.also,
    },
  };
  if (dispatch) body.dispatch = dispatch;
  return ask(`/agent/conversations/${enc(id)}/turns`, { method: 'POST', body });
},
patchTurn: (turnId, patch) => ask(`/agent/turns/${enc(turnId)}`, { method: 'PATCH', body: patch }),
```

- [ ] **Step 4: Run HTTP tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add server/agent/routes.js server/agent/runner.js runtime/agent.js test/agent-http.test.js
git commit -m "$(cat <<'EOF'
feat(agents): expose queue dispatch and combine over HTTP

The composer needs to send steer/interrupt and edit waiting turns
without a new queue store.
EOF
)"
```

---

### Task 4: `parseChoiceQuestion` and `toolShortName`

**Files:**
- Create: `runtime/choice-question.js`
- Create: `test/choice-question.test.js`
- Modify: `server/app.js` (`RUNTIME` allowlist `'choice-question.js'`)

**Interfaces:**
- Produces: ESM

```js
export function parseChoiceQuestion(text) → null | {
  question: string,
  options: { key: string, label: string }[],
  multiHint: boolean,
}
export function toolShortName(name) → string
```

Parser rules (spec §6.1), implement exactly:

1. Normalize `\r\n` to `\n`. Strip fenced code with `/```[\s\S]*?```/g`.
2. Trim trailing blank lines. From the end, collect a run of option lines. Stop at the first non-option, non-blank line. Ignore blank lines inside the run.
3. Option lines (first match wins):
   - `/^\s*[-*]\s+\[[ xX]\]\s+(.+?)\s*$/` → checkbox, key is `'1'…` in order, `multiHint` true
   - `/^\s*[-*]\s+([A-Za-z])[.)\:]\s+(.+?)\s*$/`
   - `/^\s*([A-Za-z])[.)\:]\s+(.+?)\s*$/`
   - `/^\s*(\d+)[.)\:]\s+(.+?)\s*$/`
4. Need ≥ 2 options. Keys: letter uppercased, or the number, or checkbox index as decimal string.
5. Look at up to 3 non-empty lines immediately above the option run. One of them must contain `?`. `question` is the last of those three that contains `?`.
6. `multiHint` true if checkbox options or the question matches `/select all|one or more|multiple/i`.
7. Else `null`.

`toolShortName`: map `shell`/`Bash`/`bash` → `Shell`; `read_document`/`Read`/`read` → `Read`; `apply_ops`/`edit`/`Edit` → `Edit`; `updateTodos`/`TodoWrite` → `Todos`; `task`/`Task` → `Task`. Else last segment after `:` or `/`, first letter uppercased, rest unchanged. Empty → `Tool`.

- [ ] **Step 1: Write `test/choice-question.test.js`** (import from `../runtime/choice-question.js`) covering: lettered list with `?`, numbered, checkboxes, recap without `?` → null, list not at end → null, fenced numbered list → null, `toolShortName('shell') === 'Shell'`.

- [ ] **Step 2: Run — FAIL** (module missing)

- [ ] **Step 3: Implement the module + `RUNTIME` entry so `GET /runtime/choice-question.js` is 200 (add an assertion in `test/agent-http.test.js` next to the existing runtime script check, or a one-liner in this test file is enough if you fetch nothing — the allowlist is required for the browser import in Task 6). Add the HTTP assertion in `test/agent-http.test.js`:

```js
assert.equal((await fetch(`${base}/runtime/choice-question.js`)).status, 200);
```

inside the existing “document is served with the agent scripts” test.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add runtime/choice-question.js test/choice-question.test.js server/app.js test/agent-http.test.js
git commit -m "$(cat <<'EOF'
feat(agents): parse clarifying questions and short tool names

The picker and collapsed tool rows need one place that names a
question's options and a tool's short label.
EOF
)"
```

---

### Task 5: Composer, queue UI, new-chat defaults

**Files:**
- Modify: `runtime/agent-ui.js`
- Modify: `test-browser/conversation.test.js`

**Interfaces:**
- Consumes: `send({ dispatch })`, `patchTurn`, `saveSettings`, `update({ queueCombine })`, Task 2 events `user.edited`, `turn.dispatch`, `turn.combined`, `meta`
- Produces: the composer and `.queued` behaviour in the spec §§3.3, 4

**Keyboard in the textarea `keydown` handler** (after slash/chip handling, instead of today’s bare Enter):

```js
if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault();
    this.submit({ dispatch: this.running && !this.input.value.trim() ? 'steer' : (this.running ? 'steer' : 'queue') });
    return;
  }
  event.preventDefault();
  this.submit({ dispatch: this.running ? 'queue' : 'queue' });
}
```

When the picker is armed and the textarea is empty, Enter/⌘Enter go to the picker (Task 6). In this task, if `this.choiceAsk` exists and `!this.input.value.trim()`, call `this.submitChoice(dispatch)` instead of `submit`. Stub `submitChoice` as `this.submit({ dispatch, prompt: this.choicePrompt() })` only after Task 6; for this task, keep a no-op `if (this.choiceAsk && !this.input.value.trim()) { event.preventDefault(); return; }` **only if** that would block existing tests — it would. **Do not stub.** Wire picker keys in Task 6. This task: Enter = `submit({ dispatch: this.running ? 'queue' : 'queue' })`, ⌘Enter = `submit({ dispatch: this.running ? 'steer' : 'queue' })`.

`submit({ dispatch = 'queue' } = {})`: pass `dispatch` into `this.api.send(id, { prompt, dispatch, ...context })`. Idle + `steer` is allowed (runner sets `behind: false`).

`persistCatalog`: if `!id`, and a provider radio is set, `this.api.saveSettings({ defaultProvider: provider, models: { [provider]: model || '' }, efforts: { [provider]: effort || '' } })`. Do not PATCH a conversation. If `id`, keep today’s `update`.

`queue(turn, present)`: rebuild or update the row:

```
.queued
  .queued-bar (hidden unless ≥2 .queued-item)
    button.queued-individually
    button.queued-together
  .queued-item[data-turn][data-dispatch]
    button.queued-dispatch  (label Queue|Steer|Interrupt)
    span.queued-text
    button.dequeue
```

`.queued-bar` is a sibling **inside** `.queued`, inserted once in the template (not per item). Count **items** (`.queued-item`), not all children. `hidden` on the bar when `querySelectorAll('.queued-item').length < 2`.

Click `.queued-dispatch` cycles `queue → steer → interrupt → queue` via `patchTurn(turn, { dispatch })`. Set `data-dispatch` immediately (optimistic), revert on catch.

Click `.queued-text`: replace with a textarea, value = `this.prompts.get(turn)`. Enter (no shift) or blur → `patchTurn({ prompt })`. Escape → restore span. `dequeue` click must not save.

`user.edited`: `this.prompts.set(turn, event.text)`; update `.msg.me` for that turn (give user bubbles `data-turn` when appending — add `node.dataset.turn = turn` on `.msg.me`) and the queue text.

`turn.dispatch`: set `data-dispatch` and the button label.

`turn.combined`: `this.queue(turn, false)` only. Do not remove `.msg.me`.

`meta` with `queueCombine`: `this.queuedEl.dataset.combine = event.queueCombine ? '1' : '0'` and aria-pressed on the two bar buttons.

Bar buttons: individually sets `queueCombine: false`, together `true`, via `this.api.update(id, { queueCombine })`.

CSS: dispatch button 11.5px muted; `[data-dispatch=interrupt] .queued-dispatch { color: var(--caution); }`. Interrupt is not danger.

Template: add `.queued-bar` inside `.queued` in the existing innerHTML.

- [ ] **Step 1: Write browser tests** in `test-browser/conversation.test.js`

Keep `sendFrom` as Enter. Add `sendSteer(view, text)` that fills then `press('Meta+Enter')` (and on Linux the harness is macOS in CI — Meta+Enter is enough; also dispatch a keydown with `metaKey: true` via `locator.press('Meta+Enter')`).

```js
test('a queued message can be edited, cycled, and ⌘Enter steers', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await sendFrom(view, 'wait up');
  const item = view.locator('.queued-item');
  await item.waitFor();
  assert.equal(await item.getAttribute('data-dispatch'), 'queue');
  await item.locator('.queued-dispatch').click();
  await page.waitForFunction(() => document.querySelector('marble-conversation').shadowRoot.querySelector('.queued-item')?.dataset.dispatch === 'steer');
  await item.locator('.queued-text').click();
  await item.locator('textarea').fill('wait up edited');
  await item.locator('textarea').press('Enter');
  await page.waitForFunction(() => document.querySelector('marble-conversation').shadowRoot.querySelector('.queued-text')?.textContent.includes('wait up edited'));
  await view.locator('button.dequeue').click();
  await item.waitFor({ state: 'detached' });
});

test('two queued rows can send as one prompt', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await sendFrom(view, 'one');
  await sendFrom(view, 'two');
  await view.locator('.queued-item').nth(1).waitFor();
  await view.locator('.queued-together').click();
  await view.locator('.queued[data-combine="1"]').waitFor();
});

test('a blank composer remembers model and effort for the next new chat', async () => {
  const { page, view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await view.evaluate((el) => {
    window.marbleAgentUI.fillRadios(el.shadowRoot.querySelector('[data-seg="model"]'), 'model', [
      { id: 'fake', label: 'Fake' }, { id: 'alt', label: 'Alt' },
    ], { empty: 'Default', value: 'fake' });
    el.syncEfforts({ effort: 'high' });
    el.persistCatalog();
  });
  await page.waitForTimeout(200);
  const { view: again } = await mount();
  await again.locator('input[name="agent"][value="fake"]').waitFor();
  await again.evaluate(async (el) => {
    await el.syncCatalog();
  });
  assert.equal(await again.locator('input[name="effort"][value="high"]').isChecked(), true);
});
```

The third test must use the fake provider’s real radios if `fillRadios` from outside fights the picker — prefer clicking the effort/model control the page already rendered. If the fake agent only has Default + listed efforts, click `input[name="effort"][value="high"]` then `persistCatalog` via the existing `change` handler (it already calls `persistCatalog`). Prefer:

```js
await view.locator('input[name="effort"][value="high"]').click({ force: true });
```

then unmount/remount. If effort radios are hidden until catalog sync, wait for them.

Existing test `'a second message while one runs is queued, and can be removed'` must still pass (`button.dequeue`).

- [ ] **Step 2: Run the new tests — FAIL**

`PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH npm run test:browser -- test-browser/conversation.test.js`

If the filter does not apply, run `npm run test:browser` (slow). Expected: FAIL — no `.queued-dispatch`.

- [ ] **Step 3: Implement the UI**

- [ ] **Step 4: PASS**, including the old dequeue test

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/conversation.test.js
git commit -m "$(cat <<'EOF'
feat(agents): edit and steer queued composer messages

Waiting sends can be rewritten or marked steer/interrupt, and a blank
composer stores the catalog for the next new chat.
EOF
)"
```

---

### Task 6: Collapse tool rows + choice picker

**Files:**
- Modify: `runtime/agent-ui.js`
- Modify: `test-browser/conversation.test.js`
- Modify: `test/fixtures` scripts in the browser test file’s `SCRIPTS`

**Interfaces:**
- Consumes: `parseChoiceQuestion`, `toolShortName` from `runtime/choice-question.js` (dynamic `import('/runtime/choice-question.js')` once at module load, cache on `window.marbleAgentUI`). Also assign them on `window.marbleAgentUI` next to `conversationTags` so tests can call them. Because the IIFE runs before the dynamic import resolves, **duplicate the two functions into agent-ui.js by importing is not possible**. Copy the function bodies into the IIFE (same source as `runtime/choice-question.js`) and export them on `marbleAgentUI`. Keep the two files identical. If they drift, node tests still own the ESM file.

- Produces: spec §§5–6

**Collapse:** after `toolCall` / `toolResult` / `opsApplied` / `opsRefused`, call `collapseToolRows(this.logEl, turn)`:

Walk `.tool` nodes that belong to this turn (set `dataset.turn` on each tool row when creating). Consecutive `data-name` with `data-state="done"` and length ≥ 2 wrap into a group: a `button.tool-group` with text `${toolShortName(name)} ×${n}`, `aria-expanded="false"`. Member rows `hidden`. Click toggles `hidden` and `aria-expanded`. `pending`, `failed`, `refused` break the run and stay visible. In-flight pending is never inside a count. Re-run collapse from scratch each time: unwrap existing `.tool-group` for this turn first so counts stay honest.

**Picker:** on `text` (the final `text` event, not delta) do nothing. On `turn.completed` / `failed` / `cancelled` / `interrupted`, take the last `.msg.agent` for that turn (not `.live`), `parseChoiceQuestion(textContent)` — better: keep the last `text` event string on `record(turn).lastText` in `text()`. If parse hits, render `.choice-ask` under that message:

```
div.choice-ask[role=group]
  p.choice-q
  button.choice-opt[role=checkbox|radio][data-key][aria-checked]
  button.choice-send  Send
```

`data-current` on the focused option. ↑ ↓ wrap. Home/End. Space toggles (`preventDefault` when picker keys run). Radios (`!multiHint`): Space/click checks one. Checkboxes: independent. Enter with empty composer submits: if none checked, the current option only; else all checked. Prompt: `A, C — labelA; labelC`. Then `this.submit({ dispatch: this.running ? 'queue' : 'queue', prompt })` — extend `submit` to accept `{ prompt }` override so it does not read the empty textarea.

When textarea is empty and `.choice-ask` exists, textarea keydown for ArrowUp/Down/Space/Enter/Home/End/`Meta+Enter` is handled by the picker (`Meta+Enter` submits as steer if `this.running`). If textarea has text, keys stay with the composer.

Escape on picker: uncheck all; do not close the conversation.

Unmount `.choice-ask` after a successful `submit` from it.

- [ ] **Step 1: Browser tests**

Add scripts:

```js
spam: Array.from({ length: 6 }, () => ({ call: 'shell', args: {} })).concat([{ say: 'done' }]),
ask: [{ say: 'Which layout?\n\nA) List\nB) Board\nC) Both\n' }],
```

`shell` tool can 404 from MCP — that still emits `tool.call` / `tool.result` with `ok: false` (`Blocked: shell`). For collapse of **done** rows, use a name the fake MCP implements, or make the fake `call` succeed: the runner’s tools for unknown names. In browser harness, unknown tool names fail. Use six `read_document` calls (they succeed) to assert `Read ×6`, plus one failing `shell` if easy — or six successful `read_document` only.

```js
spam: [
  { call: 'read_document', args: { path: 'garden' } },
  { call: 'read_document', args: { path: 'garden' } },
  { call: 'read_document', args: { path: 'garden' } },
  { call: 'read_document', args: { path: 'garden' } },
  { call: 'read_document', args: { path: 'garden' } },
  { call: 'read_document', args: { path: 'garden' } },
  { say: 'done' },
],
```

```js
test('consecutive tool rows collapse until expanded', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:spam');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const group = view.locator('.tool-group');
  await group.waitFor();
  assert.match(await group.textContent(), /Read ×6/);
  assert.equal(await view.locator('.tool[data-name="read_document"]:visible').count(), 0);
  await group.click();
  assert.equal(await view.locator('.tool[data-name="read_document"]').count(), 6);
});

test('a finished multiple-choice question is answerable from the keyboard', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:ask');
  await view.locator('.choice-ask').waitFor();
  await view.locator('textarea').press('ArrowDown');
  await view.locator('textarea').press('Space');
  await view.locator('textarea').press('Enter');
  await view.locator('.msg.me').nth(1).waitFor();
  assert.match(await view.locator('.msg.me').nth(1).textContent(), /B/);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement collapse + picker + export `parseChoiceQuestion` / `toolShortName` / `collapseToolRows` on `window.marbleAgentUI`**

- [ ] **Step 4: PASS** `npm run test:browser` for conversation tests, and `npm test` for the node suite

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/conversation.test.js
git commit -m "$(cat <<'EOF'
feat(agents): collapse tool spam and pick clarifying answers

Long same-tool runs fold into a count, and a finished A/B/C question
can be answered with the arrow keys.
EOF
)"
```

---

## Self-review

- Spec §3 runner rules → Task 2
- Spec §3 APIs → Task 3
- Spec §3.3 new-chat defaults → Task 5
- Spec §4 queue UI / keys → Task 5
- Spec §5 tools → Task 6
- Spec §6 picker → Tasks 4 and 6
- Spec §8 tests mapped to the six tasks
- No TBD / “similar to Task N”
- `patchQueued` return value, `kick`/`syncQueue`, and `.msg.me[data-turn]` are named the same in later tasks as in earlier ones
