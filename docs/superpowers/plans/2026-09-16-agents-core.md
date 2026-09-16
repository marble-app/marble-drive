# Agents Core Implementation Plan (Plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host-side agent core — conversation store, turn runner, Marble tools with preconditions and per-turn undo, an MCP bridge, HTTP/SSE routes and a watchdog — fully exercised by a scripted fake agent, with no model involved.

**Architecture:** Agents write only through ops. A new `server/agent/` package holds the store, runner, tools, inverse-op computation and routes; `server/app.js` gains an `applyOps` `prepare/after` hook so a tool can check preconditions and record inverses inside the document's write queue. Provider CLIs (Plan 2) plug into the runner through a small adapter contract; this plan ships only a test provider that drives `test/fixtures/fake-agent.mjs`, which speaks MCP to `bin/marble-mcp.js` exactly as a real CLI would.

**Tech Stack:** Node ≥ 22 ESM, `node:test`, `node:child_process`, parse5 via `@bdhmin/marble` (reached only through `server/engine.js`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-agent-interface-design.md` (sections 2, 3, 5, 6, 7, 8, 12, 14). Plans 2–5 (providers, drawer, `Agents.mrbl`, Codex) are written after this one lands.

## Global Constraints

- No new npm dependencies.
- Everything from the Marble package is imported through `server/engine.js`, never directly.
- Agents are off unless `MARBLE_DRIVE_AGENTS=1`; never on a multi-tenant host (`MARBLE_DRIVE_DATA` set); never on an ungated host whose `HOST` is not loopback. When off, every `/agent/*` route answers 404.
- Agent writes go through `applyOps` only, with `client: agent:<conversationId>`; undo with `client: agent-undo:<conversationId>`.
- `apply_ops` caps: `validateOps` default 24 ops per call; `innerLimit` 12 000 characters.
- Read budget for `read_document`: 24 000 characters.
- Tool calls accepted only from loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) with a live turn's bearer token (32 random bytes, hex).
- Storage root: `<drive root>/.marble/agents/`. Workspaces: `MARBLE_DRIVE_AGENT_WORKDIR`, default `~/.cache/marble-drive/agents/<conversationId>/`, never under the drive root.
- Defaults: `maxRunning` 3, stall 10 minutes, max turn 30 minutes, cancel `SIGTERM` then `SIGKILL` after 3 s.
- Child env allowlist: `PATH HOME USER LOGNAME SHELL LANG LC_ALL TERM TMPDIR`, plus what a provider adds, plus `MARBLE_DRIVE_URL` and `MARBLE_AGENT_TOKEN`. Never `MARBLE_DRIVE_SECRET`.
- Code style: match the repo — ESM, two-space indent, single quotes, explanatory comments in the existing voice (why, not what), no TypeScript.
- Run the full suite with `npm test`. When filtering one server test file, run the whole file (name filters skip the test that closes the shared server and hang).

## File Structure

| file | responsibility |
|---|---|
| `server/engine.js` (modify) | also export `parseSource indexIds sliceOf applyOp` from the patcher and `collectSlices repairOps validateOps` from the intent layer |
| `server/app.js` (modify) | `applyOps` `prepare`/`after` hook; `writeOps` (apply + announce); `createDocument`; agent wiring; `/agent/*` dispatch; watchdog call |
| `server/config.js` (modify) | agent settings from env |
| `server/agent/source.js` | pure source helpers: `hashesOf`, `topLevelIds`, `idsIn`, `tagsOf` |
| `server/agent/inverse.js` | pure: `inverseSteps(source, ops)` → the undo record for a batch |
| `server/agent/tools.js` | tool schemas + implementations, per-conversation read ledger |
| `server/agent/undo.js` | `undoTurn` — reverts a turn's records, keeping what a person changed afterwards |
| `server/agent/store.js` | conversations, events, turns, undo records, settings, index, `needsReview` |
| `server/agent/hub.js` | SSE fan-out for conversation streams and the summary stream |
| `server/agent/runner.js` | queue, spawn, stream parsing, cancel, stall, interrupted-on-boot, tokens, watchdog |
| `server/agent/routes.js` | the `/agent/*` HTTP surface |
| `server/agent/index.js` | `createAgents(...)` — wires the above for `app.js`; `agentsAllowed(config)` |
| `bin/marble-mcp.js` | stdio MCP server forwarding to `/agent/tools` |
| `test/fixtures/fake-agent.mjs` | scripted CLI: MCP client of the bridge, prints a JSONL stream |
| `test/fixtures/fake-provider.js` | provider adapter for the fake agent |
| `test/agent-source.test.js`, `test/agent-inverse.test.js`, `test/agent-store.test.js`, `test/agent-tools.test.js`, `test/agent-runner.test.js`, `test/agent-http.test.js`, `test/app-write-hooks.test.js` | tests |
| `docs/AGENTS.md` | how the core works and how to turn it on |

---

### Task 1: Engine exports and the `applyOps` write hook

**Files:**
- Modify: `server/engine.js:40-53`
- Modify: `server/app.js` (the `applyOps` function near line 143, the `/ops` route near line 266, the returned object near line 722)
- Test: `test/app-write-hooks.test.js`

**Interfaces:**
- Produces:
  - `server/engine.js` exports `parseSource(source) → parse5 tree`, `indexIds(tree) → Map<id, node>`, `sliceOf(source, id) → {id, tag, html}`, `applyOp(source, op) → source`, `collectSlices(source, ids, {budget}) → [{id, tag, html, shape, of?}]`, `repairOps(ops, source) → {ops, repaired}`, `validateOps(ops, source, {slices, innerLimit}) → ops` (throws with a reason).
  - `drive.writeOps(docPath, ops, { client, prepare, after }) → Promise<{ applied, bytes, sha, refused? }>` where `prepare(source) → Promise<{ ops } | { refused }>` runs inside the document's queue before the guard, and `after(before, next)` runs inside the queue after a successful write (also when nothing changed, with `before === next`). Announces `changed` to document and drive channels when `applied > 0`, excluding `client`.
  - `drive.createDocument(docPath, source, { label }) → Promise<{path, bytes, sha}>` (the existing `putDocument`, exposed).

- [ ] **Step 1: Write the failing test**

Create `test/app-write-hooks.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-hooks-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const engine = await import('../server/engine.js');
const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

const quiet = { log() {}, error() {} };
const drive = await createDrive(loadConfig(), { log: quiet });

const SOURCE = `<!doctype html>
<html><head><title>Hooks</title></head>
<body data-marble-id="b0">
  <h1 data-marble-id="h1">Title</h1>
  <ul data-marble-id="l1">
    <li data-marble-id="i1">One</li>
    <li data-marble-id="i2">Two</li>
  </ul>
</body></html>
`;

test('the engine exposes what the agent tools need', () => {
  for (const name of ['parseSource', 'indexIds', 'sliceOf', 'applyOp', 'collectSlices', 'repairOps', 'validateOps']) {
    assert.equal(typeof engine[name], 'function', name);
  }
});

test('prepare can refuse a batch, and nothing is written', async () => {
  await drive.createDocument('hooks-refuse', SOURCE, { label: 'test' });
  const result = await drive.writeOps('hooks-refuse', [], {
    client: 'agent:x',
    prepare: async () => ({ refused: { reason: 'stale' } }),
  });
  assert.deepEqual(result.refused, { reason: 'stale' });
  assert.equal(result.applied, 0);
  assert.equal(await drive.store.read('hooks-refuse'), SOURCE);
});

test('prepare can replace the ops, and after sees the source on both sides', async () => {
  await drive.createDocument('hooks-apply', SOURCE, { label: 'test' });
  let seen = null;
  const result = await drive.writeOps('hooks-apply', [], {
    client: 'agent:x',
    prepare: async (source) => {
      assert.equal(source, SOURCE);
      return { ops: [{ type: 'setText', id: 'h1', text: 'Renamed' }] };
    },
    after: (before, next) => {
      seen = { before, next };
    },
  });
  assert.equal(result.applied, 1);
  assert.equal(seen.before, SOURCE);
  assert.match(seen.next, />Renamed</);
  assert.match(await drive.store.read('hooks-apply'), />Renamed</);
});

test('a gesture without hooks still writes the way it always did', async () => {
  await drive.createDocument('hooks-plain', SOURCE, { label: 'test' });
  const result = await drive.writeOps('hooks-plain', [{ type: 'setText', id: 'i1', text: 'Uno' }], { client: 'tab' });
  assert.equal(result.applied, 1);
  assert.match(await drive.store.read('hooks-plain'), />Uno</);
});

test.after(() => drive.close());
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/app-write-hooks.test.js`
Expected: FAIL — `the engine exposes…` fails on `parseSource`, and the others with `drive.createDocument is not a function`.

- [ ] **Step 3: Export from the engine**

In `server/engine.js`, replace:

```js
export const { applyOp, applyOps, knownIds } = patcher;
```

with:

```js
export const { applyOp, applyOps, indexIds, knownIds, parseSource, sliceOf } = patcher;
```

and replace:

```js
export const { resolveIntent } = intent;
```

with:

```js
// The agent tools read and check with the same functions the intent layer
// does: an agent is a third writer, not a second opinion about what an op is.
export const { collectSlices, repairOps, resolveIntent, validateOps } = intent;
```

- [ ] **Step 4: Add the hook to `applyOps` and expose `writeOps` / `createDocument`**

In `server/app.js`, replace the whole `applyOps` function with:

```js
  /** The one write path. Ops are checked against the document as it actually
   *  is and refused as a batch, a restore point is taken of what is being
   *  replaced, and only then do the bytes move.
   *
   *  `prepare` and `after` are for a writer that has to decide against the
   *  document *as it is inside the queue* — an agent's precondition, and the
   *  undo record it keeps. Nothing can land between them and the write. A
   *  gesture passes neither. */
  async function applyOps(docPath, ops, { client = null, prepare = null, after = null } = {}) {
    return enqueue(docPath, async () => {
      const source = await store.read(docPath);
      if (source === null) throw Object.assign(new Error(`no document "${docPath}"`), { status: 404 });

      if (prepare) {
        const planned = await prepare(source);
        if (planned.refused) {
          return { applied: 0, refused: planned.refused, bytes: bytesOf(source), sha: shaOf(source) };
        }
        ops = planned.ops;
      }

      const next = guardOps(source, ops);
      if (next === source) {
        after?.(source, source);
        return { applied: 0, bytes: bytesOf(source), sha: shaOf(source) };
      }

      lastKnown.set(docPath, { source: next, client });
      pendingWrites.mark(docPath, shaOf(next));
      const written = await store.write(docPath, next, { label: 'ops', ops });
      await oplog.append(docPath, ops, { client: client ?? 'anon' });
      after?.(source, next);
      return { applied: ops.length, ...written };
    });
  }

  /** Apply, then tell everybody else. The route and the agent tools both come
   *  through here, so the echo rule lives in one place. */
  async function writeOps(docPath, ops, options = {}) {
    const result = await applyOps(docPath, ops, options);
    if (result.applied) {
      channels.toDocument(docPath, 'changed', { except: options.client ?? null });
      channels.toDrive('changed', { path: docPath, bytes: result.bytes }, { except: options.client ?? null });
    }
    return result;
  }
```

In the `/ops` route, replace:

```js
        const result = await applyOps(docPath, ops, { client });
        if (result.applied) {
          // The echo is for the other tabs, the other devices, the other
          // people, and the agent — never for whoever filed it.
          channels.toDocument(docPath, 'changed', { except: client });
          channels.toDrive('changed', { path: docPath, bytes: result.bytes }, { except: client });
        }
        return json(res, 200, { ok: true, ...result });
```

with:

```js
        // The echo is for the other tabs, the other devices, the other people,
        // and the agent — never for whoever filed it.
        const result = await writeOps(docPath, ops, { client });
        return json(res, 200, { ok: true, ...result });
```

In the object returned by `createDrive`, add after `oplog,`:

```js
    writeOps,
    createDocument: (docPath, source, { label = 'created' } = {}) => putDocument(docPath, source, { label }),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test --test-reporter=spec test/app-write-hooks.test.js && npm test`
Expected: PASS — 4 new tests, and the full suite still green.

- [ ] **Step 6: Commit**

```bash
git add server/engine.js server/app.js test/app-write-hooks.test.js
git commit -m "Agents core: an applyOps hook that decides inside the write queue"
```

---

### Task 2: Source helpers and inverse ops

**Files:**
- Create: `server/agent/source.js`
- Create: `server/agent/inverse.js`
- Test: `test/agent-source.test.js`, `test/agent-inverse.test.js`

**Interfaces:**
- Consumes: `parseSource`, `indexIds`, `applyOp` from `server/engine.js` (Task 1).
- Produces:
  - `hashesOf(source, ids?) → Map<id, hash>` — 16-hex sha256 of each element's outer source; all ids when `ids` omitted; absent ids are simply missing from the map.
  - `topLevelIds(source) → string[]` — addressed elements with no addressed ancestor, in document order.
  - `idsIn(html) → string[]` — every `data-marble-id` value in a markup string, in order.
  - `tagsOf(source) → [{id, tag}]`.
  - `inverseSteps(source, ops) → [{ path?: undefined, inverse: op|null, id: string|null, expect: string|null, absent: string|null }]`, one per op, in apply order. `inverse` undoes that op; `id`+`expect` are the element and its hash right after the op (undo refuses the step if the element no longer matches); `absent` is an id that must not exist for the step to apply (used when undoing a `remove`). Throws whatever `applyOp` throws.

- [ ] **Step 1: Write the failing tests**

Create `test/agent-source.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { hashesOf, idsIn, tagsOf, topLevelIds } from '../server/agent/source.js';

const SOURCE = `<!doctype html>
<html><head><title>S</title></head>
<body>
  <main data-marble-id="m">
    <h1 data-marble-id="h">Hello</h1>
    <p data-marble-id="p">Text</p>
  </main>
  <aside data-marble-id="a">Side</aside>
</body></html>
`;

test('a hash names the bytes of one element, and changes when they do', () => {
  const before = hashesOf(SOURCE);
  assert.equal(before.size, 4);
  assert.match(before.get('h'), /^[0-9a-f]{16}$/);
  const after = hashesOf(SOURCE.replace('Hello', 'Hi'), ['h', 'p']);
  assert.notEqual(after.get('h'), before.get('h'));
  assert.equal(after.get('p'), before.get('p'));
  assert.equal(after.has('m'), false, 'only the ids asked for');
});

test('an id the source does not have is missing, not an error', () => {
  assert.equal(hashesOf(SOURCE, ['nope']).has('nope'), false);
});

test('top-level ids are the addressed elements nothing addressed contains', () => {
  assert.deepEqual(topLevelIds(SOURCE), ['m', 'a']);
});

test('ids in a fragment, in order', () => {
  assert.deepEqual(idsIn('<li data-marble-id="x"><b data-marble-id="y">z</b></li>'), ['x', 'y']);
});

test('tags by id', () => {
  assert.deepEqual(tagsOf(SOURCE).find((t) => t.id === 'p'), { id: 'p', tag: 'p' });
});
```

Create `test/agent-inverse.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyOp } from '../server/engine.js';
import { inverseSteps } from '../server/agent/inverse.js';
import { hashesOf } from '../server/agent/source.js';

const SOURCE = `<!doctype html>
<html><head><title>I</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="h" class="big">Hello <em data-marble-id="e">there</em></h1>
  <ul data-marble-id="u">
    <li data-marble-id="i1">One</li>
    <li data-marble-id="i2">Two</li>
    <li data-marble-id="i3">Three</li>
  </ul>
  <ol data-marble-id="o"></ol>
</body></html>
`;

const run = (source, ops) => ops.reduce(applyOp, source);
const undo = (source, steps) => steps.slice().reverse().reduce((s, step) => applyOp(s, step.inverse), source);
const order = (source) => [...source.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);

test('setInner comes back byte for byte', () => {
  const ops = [{ type: 'setInner', id: 'h', html: 'Plain' }];
  const steps = inverseSteps(SOURCE, ops);
  assert.equal(undo(run(SOURCE, ops), steps), SOURCE);
});

test('setText is undone with setInner, so markup inside it survives', () => {
  const ops = [{ type: 'setText', id: 'i1', text: 'Uno' }];
  const steps = inverseSteps(SOURCE, ops);
  assert.equal(steps[0].inverse.type, 'setInner');
  assert.equal(undo(run(SOURCE, ops), steps), SOURCE);
});

test('setAttr restores the old value, or removes an attribute that was not there', () => {
  const ops = [
    { type: 'setAttr', id: 'h', name: 'class', value: 'small' },
    { type: 'setAttr', id: 'u', name: 'hidden', value: '' },
  ];
  const steps = inverseSteps(SOURCE, ops);
  assert.deepEqual(steps[1].inverse, { type: 'setAttr', id: 'u', name: 'hidden', value: null });
  assert.equal(undo(run(SOURCE, ops), steps), SOURCE);
});

test('remove comes back in the same place', () => {
  const ops = [{ type: 'remove', id: 'i2' }];
  const steps = inverseSteps(SOURCE, ops);
  assert.equal(steps[0].absent, 'i2');
  const restored = undo(run(SOURCE, ops), steps);
  assert.deepEqual(order(restored), order(SOURCE));
  assert.equal(hashesOf(restored).get('i2'), hashesOf(SOURCE).get('i2'));
});

test('move goes back to its old parent and neighbour', () => {
  const ops = [{ type: 'move', id: 'i1', parentId: 'o', beforeId: null }];
  const steps = inverseSteps(SOURCE, ops);
  const restored = undo(run(SOURCE, ops), steps);
  assert.deepEqual(order(restored), order(SOURCE));
});

test('insert is undone by removing what it inserted', () => {
  const ops = [{ type: 'insert', html: '<li data-marble-id="i4">Four</li>', parentId: 'u', beforeId: null }];
  const steps = inverseSteps(SOURCE, ops);
  assert.deepEqual(steps[0].inverse, { type: 'remove', id: 'i4' });
  assert.equal(steps[0].id, 'i4');
  assert.deepEqual(order(undo(run(SOURCE, ops), steps)), order(SOURCE));
});

test('each step expects the element as that op left it, not as the batch did', () => {
  const ops = [
    { type: 'setText', id: 'i3', text: 'Tres' },
    { type: 'setText', id: 'i3', text: 'Drei' },
  ];
  const steps = inverseSteps(SOURCE, ops);
  assert.equal(steps[0].expect, hashesOf(run(SOURCE, ops.slice(0, 1))).get('i3'));
  assert.equal(steps[1].expect, hashesOf(run(SOURCE, ops)).get('i3'));
});

test('an element whose parent has no id cannot be put back, and says so with a null inverse', () => {
  const source = SOURCE.replace('<ol data-marble-id="o"></ol>', '<div><p data-marble-id="orphan">x</p></div>');
  const steps = inverseSteps(source, [{ type: 'remove', id: 'orphan' }]);
  assert.equal(steps[0].inverse, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-reporter=spec test/agent-source.test.js test/agent-inverse.test.js`
Expected: FAIL — `Cannot find module '…/server/agent/source.js'`.

- [ ] **Step 3: Implement `server/agent/source.js`**

```js
// Small, pure questions about a document's source that the agent tools ask
// over and over. Everything here parses with the same patcher that splices, so
// "the element" means the same bytes to the tools as it does to the write.

import crypto from 'node:crypto';

import { indexIds, parseSource } from '../engine.js';

const ID = 'data-marble-id';

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

const outer = (source, node) => {
  const loc = node.sourceCodeLocation;
  return source.slice(loc.startOffset, loc.endOffset);
};

/** What each element's bytes are, as a short name. A precondition is "the
 *  element is still what you read", and this is how that is said. */
export function hashesOf(source, ids = null) {
  const byId = indexIds(parseSource(source));
  const out = new Map();
  for (const id of ids ?? byId.keys()) {
    const node = byId.get(id);
    if (node?.sourceCodeLocation) out.set(id, hash(outer(source, node)));
  }
  return out;
}

const hasId = (node) => (node.attrs ?? []).some((a) => a.name === ID);

/** The addressed elements nothing addressed contains — where reading a whole
 *  document starts. */
export function topLevelIds(source) {
  const byId = indexIds(parseSource(source));
  const top = [];
  for (const [id, node] of byId) {
    let up = node.parentNode;
    while (up && !(up.tagName && hasId(up))) up = up.parentNode;
    if (!up) top.push(id);
  }
  return top;
}

export const idsIn = (html) => [...String(html).matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);

export const tagsOf = (source) =>
  [...indexIds(parseSource(source))].map(([id, node]) => ({ id, tag: node.tagName }));
```

- [ ] **Step 4: Implement `server/agent/inverse.js`**

```js
// The op that undoes an op, worked out on the host from the source as it stood
// before the op ran. The carrier has the same idea (`invert` in Marble's
// runtime), computed from a live DOM; an agent's edits never pass through a
// page, so the host keeps its own.
//
// Two choices worth knowing:
//
//   - `setText` is undone with `setInner` holding the old inner bytes, because
//     "the old text" of an element with markup inside it is not something a
//     setText can put back;
//   - every step records what the element looked like *right after* its op.
//     Undo compares against that, so an element somebody edited afterwards is
//     left alone instead of being rolled back over their work.

import { applyOp, indexIds, parseSource } from '../engine.js';
import { hashesOf } from './source.js';

const ID = 'data-marble-id';
const TRANSIENT = 'data-marble-transient';

const attr = (node, name) => (node.attrs ?? []).find((a) => a.name === name)?.value ?? null;
const isElement = (node) => Boolean(node?.tagName);

function innerOf(source, node) {
  const loc = node.sourceCodeLocation;
  if (!loc?.startTag || !loc?.endTag) return null;
  return source.slice(loc.startTag.endOffset, loc.endTag.startOffset);
}

/** Where an element sits, as ids: its parent's, and the next addressed,
 *  non-transient sibling's. Null when the parent has no id to name it by. */
function placeOf(node) {
  const parentId = isElement(node.parentNode) ? attr(node.parentNode, ID) : null;
  if (!parentId) return null;
  const siblings = node.parentNode.childNodes.filter((c) => isElement(c) && attr(c, TRANSIENT) === null);
  const after = siblings.slice(siblings.indexOf(node) + 1);
  const next = after.find((c) => attr(c, ID));
  return { parentId, beforeId: next ? attr(next, ID) : null };
}

const firstId = (html) => /^\s*<[a-zA-Z][^>]*\sdata-marble-id="([^"]+)"/.exec(html)?.[1] ?? null;

function inverseOf(source, op) {
  const node = op.id ? indexIds(parseSource(source)).get(op.id) : null;

  switch (op.type) {
    case 'setText':
    case 'setInner': {
      const html = node && innerOf(source, node);
      return html === null || html === undefined ? null : { type: 'setInner', id: op.id, html };
    }
    case 'setAttr':
      return node ? { type: 'setAttr', id: op.id, name: op.name, value: attr(node, op.name.toLowerCase()) } : null;
    case 'remove': {
      const place = node && placeOf(node);
      if (!place) return null;
      const loc = node.sourceCodeLocation;
      return { type: 'insert', html: source.slice(loc.startOffset, loc.endOffset), ...place };
    }
    case 'move': {
      const place = node && placeOf(node);
      return place ? { type: 'move', id: op.id, ...place } : null;
    }
    case 'insert': {
      const id = firstId(op.html);
      return id ? { type: 'remove', id } : null;
    }
    default:
      return null;
  }
}

/** One undo step per op, in the order the ops apply. */
export function inverseSteps(source, ops) {
  const steps = [];
  let current = source;
  for (const op of ops) {
    const inverse = inverseOf(current, op);
    current = applyOp(current, op);
    const id = op.type === 'insert' ? firstId(op.html) : op.type === 'remove' ? null : op.id;
    steps.push({
      inverse,
      id,
      expect: id ? hashesOf(current, [id]).get(id) ?? null : null,
      absent: op.type === 'remove' ? op.id : null,
    });
  }
  return steps;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test --test-reporter=spec test/agent-source.test.js test/agent-inverse.test.js`
Expected: PASS — 5 + 8 tests. If `remove comes back in the same place` fails on whitespace only, the `order` and hash assertions are the contract; do not weaken them — check `placeOf` picks the next *addressed* sibling.

- [ ] **Step 6: Commit**

```bash
git add server/agent/source.js server/agent/inverse.js test/agent-source.test.js test/agent-inverse.test.js
git commit -m "Agents core: element hashes and the op that undoes an op"
```

---

### Task 3: The tools — reads, preconditions, apply, create, guide

**Files:**
- Create: `server/agent/tools.js`
- Test: `test/agent-tools.test.js`

**Interfaces:**
- Consumes: Task 1 `drive.writeOps`, `drive.createDocument`, `drive.store`; Task 2 `hashesOf`, `topLevelIds`, `idsIn`, `tagsOf`, `inverseSteps`; engine `collectSlices`, `repairOps`, `validateOps`, `enginePath`; `server/paths.js` `parsePath`, `splitPath`; `server/gallery.js` `build`.
- Produces:
  - `TOOL_SCHEMAS` — `[{ name, description, inputSchema }]` for `list_documents`, `read_document`, `apply_ops`, `create_document`, `read_guide`.
  - `createTools({ store, writeOps, createDocument, buildStarter, guidePath }) → { schemas, call(name, input, turn), forget(conversationId) }`.
  - A `turn` object passed to `call` must have: `{ id: string, conversationId: string, target: string, writable: Set<string>, undo: Array, onEvent(event) }`. `call` appends to `turn.undo` records `{ path, steps }` (steps from `inverseSteps`) and adds created paths to `turn.writable`. It calls `turn.onEvent({ type: 'ops.applied', path, count })` and `turn.onEvent({ type: 'ops.refused', path, reason })`.
  - Every `call` resolves to a plain JSON object; failures resolve to `{ error: string }` rather than throwing.

- [ ] **Step 1: Write the failing test**

Create `test/agent-tools.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-tools-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { enginePath } = await import('../server/engine.js');
const { build } = await import('../server/gallery.js');
const { createTools, TOOL_SCHEMAS } = await import('../server/agent/tools.js');

const drive = await createDrive(loadConfig(), { log: { log() {}, error() {} } });
const tools = createTools({
  store: drive.store,
  writeOps: drive.writeOps,
  createDocument: drive.createDocument,
  buildStarter: build,
  guidePath: enginePath('skills/build-in-marble/SKILL.md'),
});

const SOURCE = `<!doctype html>
<html><head><title>Garden</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Research Garden</h1>
  <ul data-marble-id="q">
    <li data-marble-id="q1">Why?</li>
    <li data-marble-id="q2">How?</li>
  </ul>
</body></html>
`;

let n = 0;
async function freshTurn(conversationId = `c${++n}`) {
  const target = `garden-${n}`;
  await drive.createDocument(target, SOURCE, { label: 'test' });
  const events = [];
  return {
    id: `${conversationId}.1`,
    conversationId,
    target,
    writable: new Set([target]),
    undo: [],
    events,
    onEvent: (event) => events.push(event),
  };
}

test('the schemas name exactly the five tools', () => {
  assert.deepEqual(TOOL_SCHEMAS.map((t) => t.name).sort(), [
    'apply_ops', 'create_document', 'list_documents', 'read_document', 'read_guide',
  ]);
  for (const t of TOOL_SCHEMAS) assert.equal(t.inputSchema.type, 'object');
});

test('an edit to an element never read is refused, and the refusal counts as a read', async () => {
  const turn = await freshTurn();
  const first = await tools.call('apply_ops', {
    path: turn.target, note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }],
  }, turn);
  assert.equal(first.refused, true);
  assert.match(first.reason, /read/);
  assert.equal(first.current[0].id, 'h');
  assert.deepEqual(turn.events.at(-1), { type: 'ops.refused', path: turn.target, reason: first.reason });

  const second = await tools.call('apply_ops', {
    path: turn.target, note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }],
  }, turn);
  assert.equal(second.applied, 1);
  assert.match(await drive.store.read(turn.target), />Backlog</);
});

test('reading the whole document lets the agent edit anything it was shown in full', async () => {
  const turn = await freshTurn();
  const read = await tools.call('read_document', { path: turn.target }, turn);
  assert.equal(read.whole, true);
  assert.match(read.source, /Why\?/);
  const result = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'setText', id: 'q1', text: 'Why not?' }],
  }, turn);
  assert.equal(result.applied, 1);
  assert.deepEqual(turn.events.at(-1), { type: 'ops.applied', path: turn.target, count: 1 });
});

test('an element a person changed after the agent read it is refused with its current source', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target, ids: ['q2'] }, turn);
  // The person types into the same item.
  await drive.writeOps(turn.target, [{ type: 'setText', id: 'q2', text: 'How, exactly?' }], { client: 'tab' });

  const result = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'setText', id: 'q2', text: 'How come?' }],
  }, turn);
  assert.equal(result.refused, true);
  assert.match(result.reason, /changed since/);
  assert.match(result.current[0].html, /How, exactly\?/);
  assert.match(await drive.store.read(turn.target), /How, exactly\?/, 'the person keeps their text');
});

test('the agent can make consecutive edits without re-reading its own work', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target, ids: ['q'] }, turn);
  const one = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'setText', id: 'q1', text: 'A' }],
  }, turn);
  const two = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'setAttr', id: 'q', name: 'class', value: 'backlog' }],
  }, turn);
  assert.equal(one.applied, 1);
  assert.equal(two.applied, 1, 'the list changed because of the agent, which is not stale');
});

test('an insert needs only its parent to exist, and its new element is editable next', async () => {
  const turn = await freshTurn();
  const inserted = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'insert', html: '<li>New question</li>', parentId: 'q', beforeId: null }],
  }, turn);
  assert.equal(inserted.applied, 1);
  assert.equal(inserted.introduced.length, 1, 'repairOps minted the id');
  const [id] = inserted.introduced;
  const edited = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'setText', id, text: 'Sharper question' }],
  }, turn);
  assert.equal(edited.applied, 1);
});

test('every applied batch leaves an undo record', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [{ type: 'remove', id: 'q2' }] }, turn);
  assert.equal(turn.undo.length, 1);
  assert.equal(turn.undo[0].path, turn.target);
  assert.equal(turn.undo[0].steps[0].absent, 'q2');
});

test('only the target and what the turn created are writable', async () => {
  const turn = await freshTurn();
  const other = await tools.call('apply_ops', {
    path: 'somewhere-else', note: 'x', ops: [{ type: 'remove', id: 'h' }],
  }, turn);
  assert.match(other.error, /not writable/);

  const made = await tools.call('create_document', { path: `made-${n}`, from: 'doc' }, turn);
  assert.equal(made.path, `made-${n}`);
  assert.ok(turn.writable.has(`made-${n}`));
});

test('a batch the checks reject comes back as a reason, not a crash', async () => {
  const turn = await freshTurn();
  const result = await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [] }, turn);
  assert.equal(result.refused, true);
  assert.match(result.reason, /no ops/);
});

test('list and guide', async () => {
  const turn = await freshTurn();
  const listed = await tools.call('list_documents', {}, turn);
  assert.ok(listed.documents.some((d) => d.path === turn.target));
  const guide = await tools.call('read_guide', {}, turn);
  assert.ok(guide.sections.includes('The op vocabulary'));
  const section = await tools.call('read_guide', { section: 'op vocabulary' }, turn);
  assert.match(section.text, /setInner/);
});

test('a path outside the drive is an error', async () => {
  const turn = await freshTurn();
  const result = await tools.call('read_document', { path: '../etc/passwd' }, turn);
  assert.ok(result.error);
});

test.after(() => drive.close());
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/agent-tools.test.js`
Expected: FAIL — `Cannot find module '…/server/agent/tools.js'`.

- [ ] **Step 3: Implement `server/agent/tools.js`**

```js
// What an agent can do to a drive, and nothing else.
//
// Every provider — Claude, Cursor, Codex — reaches these through the same MCP
// bridge, so the rules below are the rules whichever model is running:
//
//   - reads are free, and remembered: each element whose full source an agent
//     was shown is recorded as a hash in this conversation's ledger;
//   - an edit to an element is only accepted if the element is still what the
//     ledger says. Otherwise the batch is refused with the element's current
//     source, which is itself a read, so the retry can succeed. A person's own
//     ops never carry a precondition — they own what they are typing in;
//   - the check, the undo record and the write all happen inside the
//     document's queue (`prepare`/`after`), so nothing lands in between.
//
// The ledger lives in memory. A host restart forgets it, which costs an agent
// one refusal-and-retry per element, and is the honest answer: after a restart
// nobody knows what the agent last saw.

import fsp from 'node:fs/promises';

import { collectSlices, repairOps, validateOps } from '../engine.js';
import { parsePath, splitPath } from '../paths.js';
import { inverseSteps } from './inverse.js';
import { hashesOf, idsIn, tagsOf, topLevelIds } from './source.js';

const READ_BUDGET = 24_000;
const REFUSAL_BUDGET = 12_000;
const INNER_LIMIT = 12_000;

export const TOOL_SCHEMAS = [
  {
    name: 'list_documents',
    description: 'List the Marble documents in the drive, optionally under one folder.',
    inputSchema: { type: 'object', properties: { folder: { type: 'string' } } },
  },
  {
    name: 'read_document',
    description:
      'Read a Marble document. Without ids: the whole document, or an outline of it when it is large. ' +
      'With ids: the full source of those elements. You must have read an element in full before apply_ops can change it.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'apply_ops',
    description:
      'Change a document with Marble ops (setText, setInner, setAttr, insert, move, remove) addressed by data-marble-id. ' +
      'At most 24 ops per call. If an element changed since you read it, nothing applies and you get its current source: ' +
      'rebuild your edit against that and call again. Inserted elements get ids minted for you.',
    inputSchema: {
      type: 'object',
      required: ['path', 'note', 'ops'],
      properties: {
        path: { type: 'string' },
        note: { type: 'string', description: 'One sentence: what this change does.' },
        ops: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    name: 'create_document',
    description: 'Create a new document from a starter (doc, sheet, slides, board, canvas). It becomes editable in this turn.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' }, from: { type: 'string' } },
    },
  },
  {
    name: 'read_guide',
    description: 'Read the guide to building in Marble. Without a section: the list of sections.',
    inputSchema: { type: 'object', properties: { section: { type: 'string' } } },
  },
];

export function createTools({ store, writeOps, createDocument, buildStarter, guidePath }) {
  // conversationId → docPath → Map<id, hash>
  const ledgers = new Map();

  const ledgerFor = (conversationId, docPath) => {
    if (!ledgers.has(conversationId)) ledgers.set(conversationId, new Map());
    const docs = ledgers.get(conversationId);
    if (!docs.has(docPath)) docs.set(docPath, new Map());
    return docs.get(docPath);
  };

  /** Everything inside a slice shown whole is now known to this conversation. */
  function remember(ledger, source, slices) {
    const shown = slices.filter((s) => !s.shape).flatMap((s) => idsIn(s.html));
    for (const [id, h] of hashesOf(source, shown)) ledger.set(id, h);
  }

  const readable = async (input) => {
    const docPath = parsePath(String(input.path ?? ''), { allowRoot: false });
    const source = await store.read(docPath);
    if (source === null) throw new Error(`no document "${docPath}"`);
    return { docPath, source };
  };

  const handlers = {
    async list_documents(input) {
      const folder = input.folder ? parsePath(String(input.folder)) : '';
      const entries = await store.list({ folder, recursive: true });
      return {
        documents: entries.filter((e) => e.kind === 'doc').map((e) => ({ path: e.path, title: e.title })),
      };
    },

    async read_document(input, turn) {
      const { docPath, source } = await readable(input);
      const ledger = ledgerFor(turn.conversationId, docPath);
      const ids = Array.isArray(input.ids) && input.ids.length ? input.ids.map(String) : null;

      // Small enough to hand over whole, which is also the one read that makes
      // every element in the document known.
      if (!ids && source.length <= READ_BUDGET) {
        for (const [id, h] of hashesOf(source)) ledger.set(id, h);
        return { path: docPath, whole: true, source };
      }

      const slices = collectSlices(source, ids ?? topLevelIds(source), { budget: READ_BUDGET });
      remember(ledger, source, slices);
      return {
        path: docPath,
        whole: false,
        slices: slices.map(({ id, tag, html, shape }) => ({ id, tag, html, outline: Boolean(shape) })),
        note: slices.some((s) => s.shape)
          ? 'Elements marked outline were shortened. Read them by id before editing anything inside them.'
          : undefined,
      };
    },

    async apply_ops(input, turn) {
      const docPath = parsePath(String(input.path ?? ''), { allowRoot: false });
      if (!turn.writable.has(docPath)) {
        return { error: `"${docPath}" is not writable in this turn — the target is "${turn.target}"` };
      }
      const ledger = ledgerFor(turn.conversationId, docPath);
      let steps = null;
      let introduced = [];

      const result = await writeOps(docPath, [], {
        client: `agent:${turn.conversationId}`,
        prepare: async (source) => {
          let ops;
          try {
            ops = repairOps(input.ops, source).ops;
            ops = validateOps(ops, source, { slices: tagsOf(source), innerLimit: INNER_LIMIT });
          } catch (err) {
            return { refused: { reason: err.message, current: [] } };
          }

          const current = hashesOf(source);
          const unread = [];
          const stale = [];
          for (const op of ops) {
            if (op.type === 'insert' || !op.id) continue;
            const known = ledger.get(op.id);
            if (known === undefined) unread.push(op.id);
            else if (known !== current.get(op.id)) stale.push(op.id);
          }
          const blocked = [...new Set([...stale, ...unread])];
          if (blocked.length) {
            for (const id of blocked) if (current.has(id)) ledger.set(id, current.get(id));
            const reason = stale.length
              ? `${stale.map((id) => `"${id}"`).join(', ')} changed since you read ${stale.length === 1 ? 'it' : 'them'} — nothing was applied. Here is the current source; rebuild the edit against it.`
              : `read ${unread.map((id) => `"${id}"`).join(', ')} before editing — nothing was applied. Here is the current source.`;
            const shown = collectSlices(source, blocked, { budget: REFUSAL_BUDGET });
            return {
              refused: { reason, current: shown.map(({ id, tag, html }) => ({ id, tag, html })) },
            };
          }

          steps = inverseSteps(source, ops);
          introduced = ops.filter((op) => op.type === 'insert').flatMap((op) => idsIn(op.html));
          return { ops };
        },
        after: (_before, next) => {
          const known = [...ledger.keys(), ...introduced];
          const now = hashesOf(next, known);
          for (const id of known) {
            if (now.has(id)) ledger.set(id, now.get(id));
            else ledger.delete(id);
          }
        },
      });

      if (result.refused) {
        turn.onEvent({ type: 'ops.refused', path: docPath, reason: result.refused.reason });
        return { refused: true, ...result.refused };
      }
      if (steps && result.applied) {
        turn.undo.push({ path: docPath, steps });
        turn.onEvent({ type: 'ops.applied', path: docPath, count: result.applied });
      }
      return { applied: result.applied, introduced };
    },

    async create_document(input, turn) {
      const docPath = parsePath(String(input.path ?? ''), { allowRoot: false });
      if (await store.has(docPath)) return { error: `"${docPath}" already exists` };
      const source = await buildStarter(String(input.from ?? 'doc'), { name: splitPath(docPath).name });
      await createDocument(docPath, source, { label: `agent:${turn.conversationId}` });
      turn.writable.add(docPath);
      return { path: docPath };
    },

    async read_guide(input) {
      const guide = await fsp.readFile(guidePath, 'utf8');
      const parts = guide.split(/^## /m).slice(1).map((part) => {
        const newline = part.indexOf('\n');
        return { title: part.slice(0, newline).trim(), text: `## ${part}` };
      });
      if (!input.section) return { sections: parts.map((p) => p.title) };
      const wanted = String(input.section).toLowerCase();
      const found = parts.find((p) => p.title.toLowerCase().includes(wanted));
      return found ? { section: found.title, text: found.text } : { error: `no section matching "${input.section}"` };
    },
  };

  async function call(name, input, turn) {
    const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
    if (!handler) return { error: `no tool "${name}"` };
    try {
      return await handler(input ?? {}, turn);
    } catch (err) {
      return { error: err.message };
    }
  }

  return {
    schemas: TOOL_SCHEMAS,
    call,
    forget: (conversationId) => ledgers.delete(conversationId),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=spec test/agent-tools.test.js`
Expected: PASS — 11 tests. If `a batch the checks reject…` fails because `repairOps` throws on an empty array before `validateOps`, the `try` already covers both; check the reason text matches `/no ops/` from `validateOps` ("the model returned no ops").

- [ ] **Step 5: Commit**

```bash
git add server/agent/tools.js test/agent-tools.test.js
git commit -m "Agents core: Marble tools with read ledger, preconditions and undo records"
```

---
### Task 4: The conversation store

**Files:**
- Create: `server/agent/store.js`
- Test: `test/agent-store.test.js`

**Interfaces:**
- Produces:
  - `needsReview(meta) → boolean` — true when `meta.lastOutcome` is one of `changes failed interrupted watchdog` and `meta.lastReviewedAt` is null or earlier than `meta.lastFinishedAt`.
  - `summarize(meta) → { ...meta, status, needsReview }` where `status` is `'running'` when `meta.running`, else `meta.lastOutcome ?? 'new'`.
  - `createAgentStore({ dir }) →`
    - `ready() → Promise<void>`
    - `settings() → Promise<{ defaultProvider, models, maxRunning }>` and `saveSettings(patch) → Promise<settings>`; defaults `{ defaultProvider: <constructor option defaultProvider>, models: {}, maxRunning: 3 }`.
    - `createConversation({ provider, model = null, handoffFrom = null }) → Promise<meta>`; `meta = { id, provider, model, title: null, createdAt, updatedAt, archived: false, handoffFrom, handoffTo: null, providerSession: null, running: false, activity: '', lastFinishedAt: null, lastOutcome: null, lastReviewedAt: null }`. Ids are 12 hex characters.
    - `conversation(id) → Promise<meta|null>`; `updateConversation(id, patch) → Promise<meta>` (sets `updatedAt`).
    - `conversations({ archived = false }) → Promise<summary[]>`, newest `updatedAt` first.
    - `appendEvent(conversationId, event) → Promise<stored>`; `stored = { seq, t, ...event }`, `seq` from 1, strictly increasing per conversation even under concurrent calls. The first `{type: 'user', text}` sets the title to the first 60 characters of `text`.
    - `events(conversationId, { after = 0 }) → Promise<stored[]>`.
    - `createTurn(conversationId, { prompt, context }) → Promise<turn>`; `turn = { id: '<conversationId>-t<n>', conversationId, n, status: 'queued', prompt, context, createdAt, startedAt: null, finishedAt: null, error: null, applied: 0, usage: null, undoneAt: null }`.
    - `turn(turnId) → Promise<turn|null>`; `updateTurn(turnId, patch) → Promise<turn>`; `turns(conversationId) → Promise<turn[]>` in `n` order.
    - `saveUndo(turnId, records)`; `undoRecords(turnId) → Promise<records|null>`.
    - `appendRaw(turnId, line)`.
    - `interruptUnfinished() → Promise<turn[]>` — every `queued`/`running` turn becomes `interrupted` with `finishedAt`, its conversation gets `running: false, lastOutcome: 'interrupted', lastFinishedAt`, and a `turn.interrupted` event.
  - `conversationOf(turnId) → string`.

- [ ] **Step 1: Write the failing test**

Create `test/agent-store.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { conversationOf, createAgentStore, needsReview, summarize } from '../server/agent/store.js';

const fresh = async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-agents-'));
  const store = createAgentStore({ dir, defaultProvider: 'claude-subscription' });
  await store.ready();
  return { dir, store };
};

test('a conversation is created, read back and listed', async () => {
  const { store } = await fresh();
  const meta = await store.createConversation({ provider: 'cursor', model: 'composer-2.5' });
  assert.match(meta.id, /^[0-9a-f]{12}$/);
  assert.equal((await store.conversation(meta.id)).provider, 'cursor');
  const listed = await store.conversations();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, 'new');
  assert.equal(listed[0].needsReview, false);
});

test('events are numbered in order even when appended at once, and the first message titles the conversation', async () => {
  const { store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  await Promise.all([
    store.appendEvent(id, { type: 'user', text: 'Turn the open questions into a sortable research backlog, please, today' }),
    store.appendEvent(id, { type: 'turn.queued' }),
    store.appendEvent(id, { type: 'text', text: 'ok' }),
  ]);
  const events = await store.events(id);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual((await store.events(id, { after: 2 })).map((e) => e.seq), [3]);
  assert.equal((await store.conversation(id)).title, 'Turn the open questions into a sortable research backlog, pl');
});

test('turns are numbered per conversation and updated in place', async () => {
  const { store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  const one = await store.createTurn(id, { prompt: 'a', context: { target: 'doc' } });
  const two = await store.createTurn(id, { prompt: 'b', context: { target: 'doc' } });
  assert.equal(one.id, `${id}-t1`);
  assert.equal(two.n, 2);
  assert.equal(conversationOf(two.id), id);
  await store.updateTurn(one.id, { status: 'completed', applied: 3 });
  assert.equal((await store.turn(one.id)).applied, 3);
  assert.deepEqual((await store.turns(id)).map((t) => t.n), [1, 2]);
});

test('undo records and raw lines are kept per turn', async () => {
  const { dir, store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  const turn = await store.createTurn(id, { prompt: 'a', context: {} });
  assert.equal(await store.undoRecords(turn.id), null);
  await store.saveUndo(turn.id, [{ path: 'doc', steps: [] }]);
  assert.deepEqual(await store.undoRecords(turn.id), [{ path: 'doc', steps: [] }]);
  await store.appendRaw(turn.id, '{"a":1}');
  assert.equal(await fsp.readFile(path.join(dir, id, 'raw', `${turn.id}.jsonl`), 'utf8'), '{"a":1}\n');
});

test('a restart turns unfinished work into interrupted work, and says so', async () => {
  const { dir, store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  const running = await store.createTurn(id, { prompt: 'a', context: {} });
  await store.updateTurn(running.id, { status: 'running' });
  await store.updateConversation(id, { running: true });
  const done = await store.createTurn(id, { prompt: 'b', context: {} });
  await store.updateTurn(done.id, { status: 'completed' });

  const again = createAgentStore({ dir, defaultProvider: 'fake' });
  await again.ready();
  const interrupted = await again.interruptUnfinished();
  assert.deepEqual(interrupted.map((t) => t.id), [running.id]);
  const meta = await again.conversation(id);
  assert.equal(meta.running, false);
  assert.equal(meta.lastOutcome, 'interrupted');
  assert.equal((await again.events(id)).at(-1).type, 'turn.interrupted');
  assert.equal((await again.conversations())[0].needsReview, true);
});

test('archived conversations are listed only when asked for', async () => {
  const { store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(id, { archived: true });
  assert.equal((await store.conversations()).length, 0);
  assert.equal((await store.conversations({ archived: true })).length, 1);
});

test('settings have defaults and keep what was saved', async () => {
  const { store } = await fresh();
  assert.deepEqual(await store.settings(), { defaultProvider: 'claude-subscription', models: {}, maxRunning: 3 });
  await store.saveSettings({ defaultProvider: 'cursor', models: { cursor: 'composer-2.5' } });
  assert.equal((await store.settings()).models.cursor, 'composer-2.5');
});

test('needs review: changes, failures and interruptions nobody has looked at', () => {
  const base = { lastFinishedAt: 100, lastReviewedAt: null, running: false };
  assert.equal(needsReview({ ...base, lastOutcome: 'changes' }), true);
  assert.equal(needsReview({ ...base, lastOutcome: 'done' }), false);
  assert.equal(needsReview({ ...base, lastOutcome: 'cancelled' }), false);
  assert.equal(needsReview({ ...base, lastOutcome: 'failed', lastReviewedAt: 150 }), false);
  assert.equal(needsReview({ ...base, lastOutcome: 'watchdog', lastReviewedAt: 50 }), true);
  assert.equal(summarize({ ...base, running: true, lastOutcome: 'changes' }).status, 'running');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/agent-store.test.js`
Expected: FAIL — `Cannot find module '…/server/agent/store.js'`.

- [ ] **Step 3: Implement `server/agent/store.js`**

```js
// Where conversations live: `<drive>/.marble/agents/`, beside the history, so
// the backups that already copy `.marble/` carry them without being told.
//
//   settings.json
//   <conversationId>/meta.json
//   <conversationId>/events.jsonl        the transcript and the audit log, one line per event
//   <conversationId>/turns/<turnId>.json
//   <conversationId>/turns/<turnId>.undo.json
//   <conversationId>/raw/<turnId>.jsonl  the provider's own stream, untouched
//
// A listing reads every meta.json. At the number of conversations one person
// has that is cheaper than keeping an index honest, and there is nothing to
// get out of step.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const REVIEWABLE = new Set(['changes', 'failed', 'interrupted', 'watchdog']);

export const needsReview = (meta) =>
  REVIEWABLE.has(meta.lastOutcome) &&
  (meta.lastReviewedAt === null || meta.lastReviewedAt === undefined || meta.lastReviewedAt < meta.lastFinishedAt);

export const summarize = (meta) => ({
  ...meta,
  status: meta.running ? 'running' : meta.lastOutcome ?? 'new',
  needsReview: needsReview(meta),
});

export const conversationOf = (turnId) => turnId.slice(0, turnId.lastIndexOf('-t'));

const readJson = async (file, fallback = null) => {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
};

/** Written beside and renamed over, so a crash leaves the old file or the new
 *  one and never half of either. */
async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fsp.rename(tmp, file);
}

export function createAgentStore({ dir, defaultProvider = 'claude-subscription' }) {
  const convDir = (id) => path.join(dir, id);
  const metaFile = (id) => path.join(convDir(id), 'meta.json');
  const eventsFile = (id) => path.join(convDir(id), 'events.jsonl');
  const turnFile = (turnId) => path.join(convDir(conversationOf(turnId)), 'turns', `${turnId}.json`);
  const undoFile = (turnId) => path.join(convDir(conversationOf(turnId)), 'turns', `${turnId}.undo.json`);
  const rawFile = (turnId) => path.join(convDir(conversationOf(turnId)), 'raw', `${turnId}.jsonl`);

  // One chain per conversation, so two events appended at once still get
  // consecutive numbers and land in the file in that order.
  const chains = new Map();
  const counters = new Map();
  const serial = (id, task) => {
    const next = (chains.get(id) ?? Promise.resolve()).then(task, task);
    chains.set(id, next.catch(() => {}));
    return next;
  };

  async function events(id, { after = 0 } = {}) {
    let text;
    try {
      text = await fsp.readFile(eventsFile(id), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event.seq > after);
  }

  async function conversation(id) {
    if (!/^[0-9a-f]{12}$/.test(String(id))) return null;
    return readJson(metaFile(id));
  }

  async function updateConversation(id, patch) {
    return serial(`meta:${id}`, async () => {
      const meta = await conversation(id);
      if (!meta) throw Object.assign(new Error(`no conversation "${id}"`), { status: 404 });
      const next = { ...meta, ...patch, updatedAt: Date.now() };
      await writeJson(metaFile(id), next);
      return next;
    });
  }

  async function appendEvent(id, event) {
    const stored = await serial(id, async () => {
      if (!counters.has(id)) counters.set(id, (await events(id)).at(-1)?.seq ?? 0);
      const seq = counters.get(id) + 1;
      counters.set(id, seq);
      const line = { seq, t: Date.now(), ...event };
      await fsp.mkdir(convDir(id), { recursive: true });
      await fsp.appendFile(eventsFile(id), `${JSON.stringify(line)}\n`);
      return line;
    });
    if (event.type === 'user') {
      const meta = await conversation(id);
      if (meta && !meta.title) await updateConversation(id, { title: String(event.text ?? '').trim().slice(0, 60) });
    }
    return stored;
  }

  async function turns(id) {
    let names;
    try {
      names = await fsp.readdir(path.join(convDir(id), 'turns'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const records = await Promise.all(
      names.filter((n) => /-t\d+\.json$/.test(n)).map((n) => readJson(path.join(convDir(id), 'turns', n))),
    );
    return records.filter(Boolean).sort((a, b) => a.n - b.n);
  }

  async function ids() {
    try {
      return (await fsp.readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && /^[0-9a-f]{12}$/.test(e.name))
        .map((e) => e.name);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  return {
    ready: () => fsp.mkdir(dir, { recursive: true }),

    async settings() {
      const saved = (await readJson(path.join(dir, 'settings.json'))) ?? {};
      return { defaultProvider, models: {}, maxRunning: 3, ...saved };
    },

    async saveSettings(patch) {
      const next = { ...(await this.settings()), ...patch };
      await writeJson(path.join(dir, 'settings.json'), next);
      return next;
    },

    async createConversation({ provider, model = null, handoffFrom = null }) {
      const now = Date.now();
      const meta = {
        id: crypto.randomBytes(6).toString('hex'),
        provider,
        model,
        title: null,
        createdAt: now,
        updatedAt: now,
        archived: false,
        handoffFrom,
        handoffTo: null,
        providerSession: null,
        running: false,
        activity: '',
        lastFinishedAt: null,
        lastOutcome: null,
        lastReviewedAt: null,
      };
      await writeJson(metaFile(meta.id), meta);
      return meta;
    },

    conversation,
    updateConversation,

    async conversations({ archived = false } = {}) {
      const metas = (await Promise.all((await ids()).map((id) => conversation(id)))).filter(Boolean);
      return metas
        .filter((meta) => Boolean(meta.archived) === Boolean(archived))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(summarize);
    },

    appendEvent,
    events,

    async createTurn(id, { prompt, context }) {
      return serial(`turns:${id}`, async () => {
        const n = (await turns(id)).length + 1;
        const turn = {
          id: `${id}-t${n}`,
          conversationId: id,
          n,
          status: 'queued',
          prompt,
          context,
          createdAt: Date.now(),
          startedAt: null,
          finishedAt: null,
          error: null,
          applied: 0,
          usage: null,
          undoneAt: null,
        };
        await writeJson(turnFile(turn.id), turn);
        return turn;
      });
    },

    turn: (turnId) => readJson(turnFile(turnId)),

    async updateTurn(turnId, patch) {
      return serial(`turn:${turnId}`, async () => {
        const turn = await readJson(turnFile(turnId));
        if (!turn) throw Object.assign(new Error(`no turn "${turnId}"`), { status: 404 });
        const next = { ...turn, ...patch };
        await writeJson(turnFile(turnId), next);
        return next;
      });
    },

    turns,

    saveUndo: (turnId, records) => writeJson(undoFile(turnId), records),
    undoRecords: (turnId) => readJson(undoFile(turnId)),

    async appendRaw(turnId, line) {
      await fsp.mkdir(path.dirname(rawFile(turnId)), { recursive: true });
      await fsp.appendFile(rawFile(turnId), `${line}\n`);
    },

    async interruptUnfinished() {
      const interrupted = [];
      for (const id of await ids()) {
        for (const turn of await turns(id)) {
          if (turn.status !== 'queued' && turn.status !== 'running') continue;
          const finishedAt = Date.now();
          interrupted.push(await this.updateTurn(turn.id, { status: 'interrupted', finishedAt }));
          await appendEvent(id, { type: 'turn.interrupted', turn: turn.id });
          await updateConversation(id, {
            running: false,
            activity: 'Interrupted when the host stopped',
            lastOutcome: 'interrupted',
            lastFinishedAt: finishedAt,
          });
        }
      }
      return interrupted;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=spec test/agent-store.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/agent/store.js test/agent-store.test.js
git commit -m "Agents core: conversations, turns and events on disk"
```

---

### Task 5: Undo a turn

**Files:**
- Create: `server/agent/undo.js`
- Test: add to `test/agent-tools.test.js`

**Interfaces:**
- Consumes: Task 1 `writeOps`; Task 2 `hashesOf`; engine `applyOp`; Task 3 undo records `[{ path, steps }]`.
- Produces: `undoTurn({ records, writeOps, client }) → Promise<{ reverted: number, kept: number, errors: string[] }>`. Walks records newest first; per document one `writeOps` batch; a step is kept (not reverted) when its inverse is null, its `absent` id exists, its `id` no longer hashes to `expect`, or its inverse no longer applies.

- [ ] **Step 1: Write the failing test**

Append to `test/agent-tools.test.js`, before `test.after`:

```js
const { undoTurn } = await import('../server/agent/undo.js');

test('undo reverts the agent and keeps what a person changed afterwards', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] }, turn);
  await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [{ type: 'remove', id: 'q2' }] }, turn);
  const inserted = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'insert', html: '<li>Where?</li>', parentId: 'q', beforeId: null }],
  }, turn);
  const [newId] = inserted.introduced;

  // The person rewrites the item the agent added.
  await drive.writeOps(turn.target, [{ type: 'setText', id: newId, text: 'Where, and when?' }], { client: 'tab' });

  const result = await undoTurn({ records: turn.undo, writeOps: drive.writeOps, client: `agent-undo:${turn.conversationId}` });
  assert.deepEqual(result, { reverted: 2, kept: 1, errors: [] });

  const after = await drive.store.read(turn.target);
  assert.match(after, />Research Garden</);
  assert.match(after, /data-marble-id="q2">How\?</);
  assert.match(after, /Where, and when\?/, 'the person’s edit survives');
});

test('undoing a turn whose document is gone reports it instead of throwing', async () => {
  const result = await undoTurn({
    records: [{ path: 'no-such-doc', steps: [{ inverse: { type: 'remove', id: 'x' }, id: 'x', expect: 'abc', absent: null }] }],
    writeOps: drive.writeOps,
    client: 'agent-undo:x',
  });
  assert.equal(result.reverted, 0);
  assert.equal(result.kept, 1);
  assert.match(result.errors[0], /no document/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/agent-tools.test.js`
Expected: FAIL — `Cannot find module '…/server/agent/undo.js'`.

- [ ] **Step 3: Implement `server/agent/undo.js`**

```js
// Taking back one turn of an agent's work without taking back yours.
//
// The records are the inverse steps `apply_ops` kept, oldest first. Undo walks
// them newest first, and each step only runs if the element is still exactly
// what the agent left: an element somebody edited afterwards is theirs now,
// and is counted as kept rather than rolled back over their work. The walk is
// simulated against the source inside the document's queue, so each step is
// checked against what the steps before it produced.

import { applyOp } from '../engine.js';
import { hashesOf } from './source.js';

export async function undoTurn({ records, writeOps, client }) {
  const byPath = new Map();
  for (const record of records) byPath.set(record.path, [...(byPath.get(record.path) ?? []), ...record.steps]);

  let reverted = 0;
  let kept = 0;
  const errors = [];

  for (const [docPath, steps] of [...byPath].reverse()) {
    let skipped = 0;
    try {
      const result = await writeOps(docPath, [], {
        client,
        prepare: async (source) => {
          let current = source;
          const ops = [];
          skipped = 0;
          for (const step of steps.slice().reverse()) {
            if (!step.inverse) {
              skipped += 1;
              continue;
            }
            const hashes = hashesOf(current, [step.id, step.absent].filter(Boolean));
            const moved = step.absent && hashes.has(step.absent);
            const edited = step.id && step.expect && hashes.get(step.id) !== step.expect;
            if (moved || edited) {
              skipped += 1;
              continue;
            }
            try {
              current = applyOp(current, step.inverse);
              ops.push(step.inverse);
            } catch {
              skipped += 1;
            }
          }
          return { ops };
        },
      });
      reverted += result.applied;
      kept += skipped;
    } catch (err) {
      kept += steps.length;
      errors.push(`${docPath}: ${err.message}`);
    }
  }

  return { reverted, kept, errors };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=spec test/agent-tools.test.js`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add server/agent/undo.js test/agent-tools.test.js
git commit -m "Agents core: undo a turn, keeping what a person edited afterwards"
```

---

### Task 6: The runner, with a scripted fake agent

**Files:**
- Create: `server/agent/hub.js`
- Create: `server/agent/runner.js`
- Create: `test/fixtures/fake-agent.mjs`
- Create: `test/fixtures/fake-provider.js`
- Test: `test/agent-runner.test.js`

**Interfaces:**
- Consumes: Task 3 `tools.call(name, input, turn)`; Task 4 store API; engine `collectSlices`.
- Produces:
  - Provider adapter contract (Plan 2 implements real ones):
    `{ id, label, detect() → Promise<{installed, signedIn, detail}>, prepare?({ workspace, mcp, meta }) → Promise<void>, spawn({ workspace, mcp, prompt, resume, model, env }) → { command, args, env, stdin }, parse(line, state) → event[] }`
    where `mcp = { command, args, env: { MARBLE_DRIVE_URL, MARBLE_AGENT_TOKEN } }` and parsed events are `{type:'session', id}`, `{type:'text.delta', text}`, `{type:'text', text}`, `{type:'tool.call', name, input, callId}`, `{type:'tool.result', callId, ok, summary}`, `{type:'usage', ...}`, `{type:'done', ok, error?}`.
  - `createHub() → { subscribe(key, res) → off, publish(conversationId, event, summary?), close() }`; `key` is a conversation id or `'*'`.
  - `createRunner({ store, tools, providers, workdir, origin, bridgePath, readDocument, publish, limits, log }) →`
    - `boot() → Promise<void>` (interrupts unfinished turns)
    - `send(conversationId, { prompt, context }) → Promise<{ turnId, status }>`; `context.target` required
    - `cancel(turnId) → Promise<boolean>`; `dequeue(turnId) → Promise<boolean>`
    - `turnForToken(token) → live turn | null`; `callTool(token, name, input) → Promise<object|null>` (null when the token is not a running turn's)
    - `watchdog(docPath, sha)`; `running() → live turn[]`; `close() → Promise<void>`
  - `limits = { maxRunning, stallMs, maxMs, killGraceMs }`.
  - Fake provider: `createFakeProvider({ scripts, id = 'fake' })`. The prompt's first line `script:<name>` picks `scripts[name]`, an array of steps: `{say}`, `{sleep}`, `{silent}`, `{call, args, as}`, `{fail}`, `{exit}`, `{ignoreTerm: true}`. Args may contain `{"$ref": "<as>.<dot.path>"}`.

- [ ] **Step 1: Write the fake agent and its provider**

Create `test/fixtures/fake-agent.mjs`:

```js
#!/usr/bin/env node
// A stand-in for `claude -p` or `cursor-agent -p`, driven by a script instead
// of a model. It does what a real CLI does with Marble: starts the MCP bridge it
// was configured with, speaks MCP to it, and prints a JSON line per thing that
// happens. The runner cannot tell it from the real thing, which is the point.

import { spawn } from 'node:child_process';
import readline from 'node:readline';

const script = JSON.parse(process.env.FAKE_SCRIPT ?? '[]');
const mcp = process.env.FAKE_MCP ? JSON.parse(process.env.FAKE_MCP) : null;
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;

let bridge = null;
let nextId = 1;
const pending = new Map();

async function rpc(method, params) {
  if (!bridge) {
    bridge = spawn(mcp.command, mcp.args, { env: { ...process.env, ...mcp.env }, stdio: ['pipe', 'pipe', 'inherit'] });
    readline.createInterface({ input: bridge.stdout }).on('line', (line) => {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '0' } });
    bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  }
  const id = nextId++;
  const reply = new Promise((resolve) => pending.set(id, resolve));
  bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return reply;
}

const vars = {};
const resolve = (value) => {
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === 'object') {
    if (typeof value.$ref === 'string') {
      return value.$ref.split('.').reduce((at, key) => at?.[key], vars);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
  }
  return value;
};

out({ kind: 'session', id: process.env.FAKE_RESUME || `fake-${process.pid}` });
out({ kind: 'text', text: `prompt:${prompt.split('\n')[0]}` });

for (const step of script) {
  if (step.ignoreTerm) process.on('SIGTERM', () => {});
  if (step.say) {
    out({ kind: 'delta', text: step.say.slice(0, 3) });
    out({ kind: 'text', text: step.say });
  }
  if (step.sleep) await sleep(step.sleep);
  if (step.silent) await sleep(step.silent);
  if (step.call) {
    const callId = `call-${nextId}`;
    const args = resolve(step.args ?? {});
    out({ kind: 'call', name: step.call, input: args, callId });
    const reply = await rpc('tools/call', { name: step.call, arguments: args });
    const text = reply.result?.content?.[0]?.text ?? '{}';
    const body = JSON.parse(text);
    if (step.as) vars[step.as] = body;
    out({ kind: 'result', callId, ok: !reply.result?.isError, summary: text.slice(0, 200) });
  }
  if (step.fail) {
    out({ kind: 'done', ok: false, error: step.fail });
    bridge?.kill();
    process.exit(1);
  }
  if (step.exit !== undefined) {
    bridge?.kill();
    process.exit(step.exit);
  }
}

out({ kind: 'done', ok: true });
bridge?.kill();
process.exit(0);
```

Create `test/fixtures/fake-provider.js`:

```js
// The provider adapter for `fake-agent.mjs`. Real adapters (Plan 2) have the
// same five members; this one's stream format is simply the fake agent's own.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-agent.mjs');

export function createFakeProvider({ scripts = {}, id = 'fake' } = {}) {
  return {
    id,
    label: 'Fake',
    detect: async () => ({ installed: true, signedIn: true, detail: 'scripted' }),
    spawn({ mcp, prompt, resume, env }) {
      const name = /^script:(\S+)/.exec(prompt)?.[1];
      return {
        command: process.execPath,
        args: [AGENT],
        env: {
          ...env,
          FAKE_SCRIPT: JSON.stringify(scripts[name] ?? []),
          FAKE_MCP: JSON.stringify(mcp),
          FAKE_RESUME: resume ?? '',
        },
        stdin: prompt,
      };
    },
    parse(line) {
      const e = JSON.parse(line);
      switch (e.kind) {
        case 'session': return [{ type: 'session', id: e.id }];
        case 'delta': return [{ type: 'text.delta', text: e.text }];
        case 'text': return [{ type: 'text', text: e.text }];
        case 'call': return [{ type: 'tool.call', name: e.name, input: e.input, callId: e.callId }];
        case 'result': return [{ type: 'tool.result', callId: e.callId, ok: e.ok, summary: e.summary }];
        case 'done': return [{ type: 'done', ok: e.ok, error: e.error }];
        default: return [];
      }
    },
  };
}
```

- [ ] **Step 2: Write the failing runner test**

Create `test/agent-runner.test.js`. It uses a stub `tools` (the real one is exercised end to end in Task 9) and no bridge calls, so it isolates the runner:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRunner } from '../server/agent/runner.js';
import { createAgentStore } from '../server/agent/store.js';
import { createFakeProvider } from './fixtures/fake-provider.js';

const SCRIPTS = {
  hello: [{ say: 'Hello from the fake agent' }],
  slow: [{ sleep: 600 }, { say: 'done sleeping' }],
  stall: [{ silent: 5_000 }],
  stubborn: [{ ignoreTerm: true }, { silent: 5_000 }],
  broken: [{ fail: 'You have hit your usage limit' }],
};

async function setup({ limits = {} } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-runner-'));
  const store = createAgentStore({ dir: path.join(dir, 'agents'), defaultProvider: 'fake' });
  await store.ready();
  const published = [];
  const toolCalls = [];
  const runner = createRunner({
    store,
    tools: { call: async (name, input, turn) => { toolCalls.push({ name, input, turn: turn.id }); return { ok: true }; } },
    providers: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
    workdir: path.join(dir, 'work'),
    origin: () => 'http://127.0.0.1:1',
    bridgePath: '/nonexistent/marble-mcp.js',
    readDocument: async () => '<html><body data-marble-id="b"><p data-marble-id="p">hi</p></body></html>',
    publish: (conversationId, event) => published.push({ conversationId, event }),
    limits: { maxRunning: 3, stallMs: 60_000, maxMs: 60_000, killGraceMs: 200, ...limits },
    log: { log() {}, error() {} },
  });
  await runner.boot();
  return { store, runner, published, toolCalls };
}

const until = async (check, ms = 5_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out');
};

const finished = (store, turnId) =>
  until(async () => {
    const turn = await store.turn(turnId);
    return turn && !['queued', 'running'].includes(turn.status) ? turn : null;
  });

test('a turn runs, streams into the transcript, and completes', async () => {
  const { store, runner, published } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:hello\nsay hi', context: { target: 'doc', selection: ['p'] } });
  const turn = await finished(store, turnId);
  assert.equal(turn.status, 'completed');

  const types = (await store.events(id)).map((e) => e.type);
  assert.deepEqual(types, ['user', 'turn.queued', 'turn.started', 'text', 'text', 'turn.completed']);
  const texts = (await store.events(id)).filter((e) => e.type === 'text').map((e) => e.text);
  assert.equal(texts[0], 'prompt:script:hello', 'the prompt reached the agent on stdin');
  assert.ok(published.some((p) => p.event.type === 'text.delta'), 'deltas are published live');
  assert.ok(!(await store.events(id)).some((e) => e.type === 'text.delta'), 'and never stored');
  assert.match((await store.conversation(id)).providerSession, /^fake-/);
  await runner.close();
});

test('the prompt carries the target and the selected source', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:hello', context: { target: 'notes', viewing: 'reading', selection: ['p'] } });
  await finished(store, turnId);
  const turn = await store.turn(turnId);
  assert.match(turn.context.selectionSource, /<p data-marble-id="p">hi<\/p>/);
  await runner.close();
});

test('the next turn resumes the provider session', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  await finished(store, (await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } })).turnId);
  const session = (await store.conversation(id)).providerSession;
  await finished(store, (await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } })).turnId);
  assert.equal((await store.conversation(id)).providerSession, session);
  await runner.close();
});

test('one conversation runs one turn at a time; the next waits its turn', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const first = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  const second = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } });
  assert.equal(first.status, 'running');
  assert.equal(second.status, 'queued');
  const a = await finished(store, first.turnId);
  const b = await finished(store, second.turnId);
  assert.ok(b.startedAt >= a.finishedAt);
  await runner.close();
});

test('maxRunning caps turns across conversations', async () => {
  const { store, runner } = await setup({ limits: { maxRunning: 1 } });
  const one = await store.createConversation({ provider: 'fake' });
  const two = await store.createConversation({ provider: 'fake' });
  const a = await runner.send(one.id, { prompt: 'script:slow', context: { target: 'd' } });
  const b = await runner.send(two.id, { prompt: 'script:hello', context: { target: 'd' } });
  assert.equal(b.status, 'queued');
  await finished(store, a.turnId);
  assert.equal((await finished(store, b.turnId)).status, 'completed');
  await runner.close();
});

test('a queued turn can be removed before it starts', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const running = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  const queued = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } });
  assert.equal(await runner.dequeue(queued.turnId), true);
  assert.equal((await store.turn(queued.turnId)).status, 'removed');
  await finished(store, running.turnId);
  await runner.close();
});

test('cancel stops the process and ends the turn cancelled', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:stall', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  assert.equal(await runner.cancel(turnId), true);
  assert.equal((await finished(store, turnId)).status, 'cancelled');
  await runner.close();
});

test('a process that ignores SIGTERM is killed after the grace period', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:stubborn', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await runner.cancel(turnId);
  assert.equal((await finished(store, turnId)).status, 'cancelled');
  await runner.close();
});

test('silence past the stall limit fails the turn', async () => {
  const { store, runner } = await setup({ limits: { stallMs: 300 } });
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:stall', context: { target: 'd' } });
  const turn = await finished(store, turnId);
  assert.equal(turn.status, 'failed');
  assert.match(turn.error, /stalled/);
  await runner.close();
});

test('a provider error reaches the person verbatim', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:broken', context: { target: 'd' } });
  const turn = await finished(store, turnId);
  assert.equal(turn.status, 'failed');
  assert.equal(turn.error, 'You have hit your usage limit');
  assert.equal((await store.conversation(id)).lastOutcome, 'failed');
  await runner.close();
});

test('a tool call is accepted only with a running turn’s token', async () => {
  const { store, runner, toolCalls } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:stall', context: { target: 'd' } });
  // The token is minted a moment after the turn starts running.
  const live = await until(() => (runner.running()[0]?.token ? runner.running()[0] : null));
  assert.match(live.token, /^[0-9a-f]{64}$/);
  assert.deepEqual(await runner.callTool(live.token, 'read_document', { path: 'd' }), { ok: true });
  assert.equal(toolCalls[0].turn, turnId);
  assert.equal(await runner.callTool('nope', 'read_document', {}), null);
  await runner.cancel(turnId);
  await finished(store, turnId);
  assert.equal(await runner.callTool(live.token, 'read_document', {}), null, 'the token died with the turn');
  await runner.close();
});

test('the watchdog flags every running turn and marks it for review', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  runner.watchdog('d', 'a'.repeat(64));
  await finished(store, turnId);
  const flagged = (await store.events(id)).find((e) => e.type === 'watchdog');
  assert.equal(flagged.path, 'd');
  assert.equal(flagged.sha, 'a'.repeat(64));
  assert.equal((await store.conversation(id)).lastOutcome, 'watchdog');
  await runner.close();
});

test('an unknown provider fails the turn instead of throwing', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'gone' });
  const { turnId } = await runner.send(id, { prompt: 'x', context: { target: 'd' } });
  const turn = await finished(store, turnId);
  assert.equal(turn.status, 'failed');
  assert.match(turn.error, /no provider "gone"/);
  await runner.close();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/agent-runner.test.js`
Expected: FAIL — `Cannot find module '…/server/agent/runner.js'`.

- [ ] **Step 4: Implement `server/agent/hub.js`**

```js
// Who hears about agent work as it happens. Two kinds of listener, the same
// split as the Drive's own channels: one conversation's full stream, for the
// drawer and the transcript, and a summary of every conversation, for lists and
// boards that only need to know a card moved.

const KEEPALIVE = 25_000;

export function createHub() {
  const listeners = new Map();

  function subscribe(key, res) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(res);
    return () => {
      listeners.get(key)?.delete(res);
      if (listeners.get(key)?.size === 0) listeners.delete(key);
    };
  }

  const write = (res, payload) => {
    try {
      res.write(payload);
    } catch {
      // Gone between the check and the write; its close handler unsubscribes it.
    }
  };

  function publish(conversationId, event, summary = null) {
    const idLine = event.seq ? `id: ${event.seq}\n` : '';
    for (const res of listeners.get(conversationId) ?? []) write(res, `${idLine}data: ${JSON.stringify(event)}\n\n`);
    if (summary) {
      for (const res of listeners.get('*') ?? []) write(res, `event: summary\ndata: ${JSON.stringify(summary)}\n\n`);
    }
  }

  const beat = setInterval(() => {
    for (const set of listeners.values()) for (const res of set) write(res, ': ping\n\n');
  }, KEEPALIVE);
  beat.unref?.();

  return {
    subscribe,
    publish,
    close() {
      clearInterval(beat);
      listeners.clear();
    },
  };
}
```

- [ ] **Step 5: Implement `server/agent/runner.js`**

```js
// Turns: queued, run one at a time per conversation, streamed into the store
// as they happen, and ended one way or another — never left running with
// nobody watching.
//
// The runner knows nothing about any particular CLI. A provider says how to
// start one and how to read a line of what it prints; the runner owns
// everything else: the queue, the process, the token that lets the process's
// MCP bridge call back in, cancellation, stalls, and what the store says
// afterwards.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import { collectSlices } from '../engine.js';
import { summarize } from './store.js';

const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR'];
const SELECTION_BUDGET = 6_000;
const STDERR_TAIL = 4_000;

const pick = (env) => Object.fromEntries(ENV_ALLOWLIST.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));

export function createRunner({ store, tools, providers, workdir, origin, bridgePath, readDocument, publish, limits, log = console }) {
  const live = new Map(); // turnId → live turn
  const order = []; // turnIds, in the order they were sent
  const tokens = new Map(); // token → live turn
  let closed = false;

  const runningTurns = () => [...live.values()].filter((t) => t.status === 'running');

  async function emit(turn, event) {
    const stored = await store.appendEvent(turn.conversationId, { turn: turn.id, ...event });
    const meta = await store.conversation(turn.conversationId);
    publish(turn.conversationId, stored, meta ? summarize(meta) : null);
    return stored;
  }

  async function composePrompt(turn, meta) {
    const context = turn.context;
    const lines = [
      turn.prompt,
      '',
      '---',
      'Context from Marble Drive:',
      `- The person is viewing: ${context.viewing ?? context.target}`,
      `- The document you may edit: ${context.target}`,
    ];
    if (context.selectionSource) lines.push('- They selected these elements:', '', context.selectionSource);
    if (meta.handoffFrom && turn.n === 1) {
      const brief = await handoffBrief(meta.handoffFrom);
      if (brief) lines.unshift(`This continues an earlier conversation. What happened there:\n\n${brief}\n\n---\n`);
    }
    return lines.join('\n');
  }

  async function handoffBrief(fromId) {
    const events = (await store.events(fromId)).filter((e) =>
      ['user', 'text', 'ops.applied'].includes(e.type),
    );
    const lines = events.slice(-12).map((e) =>
      e.type === 'user' ? `Person: ${e.text}` : e.type === 'text' ? `Agent: ${e.text}` : `(edited ${e.count} element(s) in ${e.path})`,
    );
    return lines.join('\n').slice(-8_000);
  }

  async function send(conversationId, { prompt, context }) {
    const meta = await store.conversation(conversationId);
    if (!meta) throw Object.assign(new Error(`no conversation "${conversationId}"`), { status: 404 });
    if (!context?.target) throw Object.assign(new Error('a turn needs context.target'), { status: 400 });

    const frozen = { viewing: context.viewing ?? null, target: context.target, selection: context.selection ?? [] };
    if (frozen.selection.length) {
      const source = await readDocument(frozen.target).catch(() => null);
      if (source) {
        frozen.selectionSource = collectSlices(source, frozen.selection, { budget: SELECTION_BUDGET })
          .map((s) => s.html)
          .join('\n\n');
      }
    }

    const record = await store.createTurn(conversationId, { prompt: String(prompt ?? ''), context: frozen });
    const turn = {
      id: record.id,
      n: record.n,
      conversationId,
      prompt: record.prompt,
      context: frozen,
      target: frozen.target,
      writable: new Set([frozen.target]),
      undo: [],
      status: 'queued',
      token: null,
      child: null,
      cancelled: null,
      done: null,
      usage: null,
      applied: 0,
      watchdog: false,
      stderr: '',
      timers: [],
      onEvent: (event) => {
        if (event.type === 'ops.applied') turn.applied += event.count;
        emit(turn, event).catch((err) => log.error(`[agents] ${err.message}`));
      },
    };
    live.set(turn.id, turn);
    order.push(turn.id);

    await emit(turn, { type: 'user', text: turn.prompt, context: { viewing: frozen.viewing, target: frozen.target, selection: frozen.selection } });
    await emit(turn, { type: 'turn.queued' });
    await pump();
    return { turnId: turn.id, status: turn.status };
  }

  async function pump() {
    if (closed) return;
    for (const turnId of [...order]) {
      if (runningTurns().length >= limits.maxRunning) return;
      const turn = live.get(turnId);
      if (!turn || turn.status !== 'queued') continue;
      if (runningTurns().some((t) => t.conversationId === turn.conversationId)) continue;
      await start(turn);
    }
  }

  async function start(turn) {
    turn.status = 'running';
    const meta = await store.conversation(turn.conversationId);
    const provider = providers.get(meta.provider);
    await store.updateTurn(turn.id, { status: 'running', startedAt: Date.now() });
    await store.updateConversation(turn.conversationId, { running: true, activity: `Working on ${turn.target}` });
    await emit(turn, { type: 'turn.started', provider: meta.provider });

    if (!provider) return finish(turn, { status: 'failed', error: `no provider "${meta.provider}"` });

    turn.token = crypto.randomBytes(32).toString('hex');
    tokens.set(turn.token, turn);
    const workspace = path.join(workdir, turn.conversationId);
    const mcp = {
      command: process.execPath,
      args: [bridgePath],
      env: { MARBLE_DRIVE_URL: origin(), MARBLE_AGENT_TOKEN: turn.token },
    };

    let spec;
    try {
      await fsp.mkdir(workspace, { recursive: true });
      await provider.prepare?.({ workspace, mcp, meta });
      spec = provider.spawn({
        workspace,
        mcp,
        prompt: await composePrompt(turn, meta),
        resume: meta.providerSession,
        model: meta.model,
        env: { ...pick(process.env), ...mcp.env },
      });
    } catch (err) {
      return finish(turn, { status: 'failed', error: err.message });
    }

    const child = spawn(spec.command, spec.args, { cwd: workspace, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'] });
    turn.child = child;
    child.stdin.on('error', () => {});
    child.stdin.end(spec.stdin ?? '');

    const state = {};
    let stall;
    const resetStall = () => {
      clearTimeout(stall);
      stall = setTimeout(() => stop(turn, { status: 'failed', error: `stalled — no output for ${Math.round(limits.stallMs / 1000)} s` }), limits.stallMs);
      stall.unref?.();
    };
    resetStall();
    const cap = setTimeout(() => stop(turn, { status: 'cancelled', error: `took longer than ${Math.round(limits.maxMs / 60000)} min` }), limits.maxMs);
    cap.unref?.();
    turn.timers.push(() => clearTimeout(stall), () => clearTimeout(cap));

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.trim()) return;
      resetStall();
      store.appendRaw(turn.id, line).catch(() => {});
      let events = [];
      try {
        events = provider.parse(line, state);
      } catch {
        return;
      }
      for (const event of events) handle(turn, event);
    });
    child.stderr.on('data', (chunk) => {
      turn.stderr = (turn.stderr + chunk).slice(-STDERR_TAIL);
    });
    child.on('error', (err) => {
      turn.stderr = err.message;
    });
    child.on('close', (code) => {
      const ok = code === 0 && turn.done?.ok !== false;
      finish(turn, turn.cancelled ?? {
        status: ok ? 'completed' : 'failed',
        error: ok ? null : turn.done?.error ?? (turn.stderr.trim() || `exited with ${code}`),
      });
    });
  }

  function handle(turn, event) {
    switch (event.type) {
      case 'session':
        store.updateConversation(turn.conversationId, { providerSession: event.id }).catch(() => {});
        return;
      case 'text.delta':
        publish(turn.conversationId, { turn: turn.id, ...event });
        return;
      case 'text':
      case 'tool.call':
      case 'tool.result':
        turn.onEvent(event);
        return;
      case 'usage':
        turn.usage = { ...event };
        delete turn.usage.type;
        return;
      case 'done':
        turn.done = event;
        return;
      default:
    }
  }

  /** Ask a running process to stop, and make sure it does. */
  function stop(turn, outcome) {
    if (!turn.child || turn.cancelled) return;
    turn.cancelled = outcome;
    turn.child.kill('SIGTERM');
    const kill = setTimeout(() => turn.child.kill('SIGKILL'), limits.killGraceMs);
    kill.unref?.();
    turn.timers.push(() => clearTimeout(kill));
  }

  async function finish(turn, { status, error = null }) {
    if (turn.status === 'finished') return;
    turn.status = 'finished';
    for (const clear of turn.timers) clear();
    if (turn.token) tokens.delete(turn.token);
    live.delete(turn.id);
    order.splice(order.indexOf(turn.id), 1);

    const finishedAt = Date.now();
    if (turn.undo.length) await store.saveUndo(turn.id, turn.undo);
    await store.updateTurn(turn.id, { status, finishedAt, error, applied: turn.applied, usage: turn.usage });
    const outcome = turn.watchdog
      ? 'watchdog'
      : status === 'completed'
        ? turn.applied ? 'changes' : 'done'
        : status;
    await store.updateConversation(turn.conversationId, {
      running: false,
      activity: status === 'completed' ? (turn.applied ? `Changed ${turn.applied} element(s)` : 'Answered') : error ?? status,
      lastOutcome: outcome,
      lastFinishedAt: finishedAt,
    });
    await emit(turn, { type: `turn.${status}`, applied: turn.applied, ...(error ? { error } : {}) });
    await pump();
  }

  return {
    async boot() {
      await store.interruptUnfinished();
    },

    send,

    async cancel(turnId) {
      const turn = live.get(turnId);
      if (!turn) return false;
      if (turn.status === 'queued') return this.dequeue(turnId);
      stop(turn, { status: 'cancelled', error: null });
      return true;
    },

    async dequeue(turnId) {
      const turn = live.get(turnId);
      if (!turn || turn.status !== 'queued') return false;
      live.delete(turnId);
      order.splice(order.indexOf(turnId), 1);
      await store.updateTurn(turnId, { status: 'removed', finishedAt: Date.now() });
      await emit(turn, { type: 'turn.removed' });
      return true;
    },

    turnForToken: (token) => tokens.get(token) ?? null,

    async callTool(token, name, input) {
      const turn = tokens.get(token);
      if (!turn) return null;
      return tools.call(name, input, turn);
    },

    watchdog(docPath, sha) {
      for (const turn of runningTurns()) {
        turn.watchdog = true;
        turn.onEvent({ type: 'watchdog', path: docPath, sha });
      }
    },

    running: runningTurns,

    async close() {
      closed = true;
      for (const turn of runningTurns()) turn.child?.kill('SIGKILL');
    },
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test --test-reporter=spec test/agent-runner.test.js`
Expected: PASS — 13 tests. If `a turn runs…` sees events in a different order, check that `emit` is awaited for `user`/`turn.queued` before `pump()` and that `text` events go through `turn.onEvent` (not `publish`). Do not loosen the order assertion.

- [ ] **Step 7: Commit**

```bash
git add server/agent/hub.js server/agent/runner.js test/fixtures/fake-agent.mjs test/fixtures/fake-provider.js test/agent-runner.test.js
git commit -m "Agents core: the turn runner, with a scripted fake agent"
```

---
### Task 7: The MCP bridge

**Files:**
- Create: `bin/marble-mcp.js`
- Test: `test/agent-bridge.test.js`

**Interfaces:**
- Consumes: the host's `GET /agent/tools` → `{ tools: TOOL_SCHEMAS }` and `POST /agent/tools/:name` with body `{ arguments }` → the tool's JSON result, both with `Authorization: Bearer <MARBLE_AGENT_TOKEN>` (Task 8 serves them).
- Produces: a stdio MCP server named `marble`. Env: `MARBLE_DRIVE_URL`, `MARBLE_AGENT_TOKEN` (exits 2 without them). Methods: `initialize` (echoes the client's `protocolVersion`, default `2025-06-18`), `ping`, `tools/list`, `tools/call` → `{ content: [{ type: 'text', text: <pretty JSON of the result> }], isError: Boolean(result.error) }`. Unknown methods → JSON-RPC error `-32601`. Notifications get no reply. A host that cannot be reached or answers non-2xx becomes an `isError` result the agent can read.

- [ ] **Step 1: Write the failing test**

Create `test/agent-bridge.test.js`:

```js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'marble-mcp.js');

// A host that answers the two routes the bridge uses. Real HTTP, so what is
// tested is the bridge's actual requests.
const seen = [];
const host = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    const end = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/agent/tools') return end(200, { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] });
    if (req.url === '/agent/tools/echo') return end(200, { echoed: JSON.parse(body).arguments });
    if (req.url === '/agent/tools/refused') return end(200, { error: 'not writable' });
    return end(401, { error: 'no running turn holds that token' });
  });
});
await new Promise((resolve) => host.listen(0, '127.0.0.1', resolve));
const URL_BASE = `http://127.0.0.1:${host.address().port}`;

function startBridge(env = { MARBLE_DRIVE_URL: URL_BASE, MARBLE_AGENT_TOKEN: 'tok' }) {
  const child = spawn(process.execPath, [BRIDGE], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  let id = 0;
  const rpc = (method, params) => {
    id += 1;
    const answer = new Promise((resolve) => waiting.set(id, resolve));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return answer;
  };
  return { child, rpc };
}

test('initialize answers as a tools server and echoes the protocol version', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {} });
  assert.equal(reply.result.protocolVersion, '2025-03-26');
  assert.deepEqual(reply.result.capabilities, { tools: {} });
  assert.equal(reply.result.serverInfo.name, 'marble');
  child.kill();
});

test('tools come from the host, with the token', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('tools/list', {});
  assert.equal(reply.result.tools[0].name, 'echo');
  assert.equal(seen.at(-1).auth, 'Bearer tok');
  child.kill();
});

test('a call is forwarded and its result handed back as text', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('tools/call', { name: 'echo', arguments: { x: 1 } });
  assert.equal(reply.result.isError, false);
  assert.deepEqual(JSON.parse(reply.result.content[0].text), { echoed: { x: 1 } });
  child.kill();
});

test('a tool error and a refused token both reach the agent as readable errors', async () => {
  const { child, rpc } = startBridge();
  const refused = await rpc('tools/call', { name: 'refused', arguments: {} });
  assert.equal(refused.result.isError, true);
  const denied = await rpc('tools/call', { name: 'anything', arguments: {} });
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /no running turn/);
  child.kill();
});

test('an unreachable host is an error result, not a crash', async () => {
  const { child, rpc } = startBridge({ MARBLE_DRIVE_URL: 'http://127.0.0.1:9', MARBLE_AGENT_TOKEN: 'tok' });
  const reply = await rpc('tools/call', { name: 'echo', arguments: {} });
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /could not be reached/);
  child.kill();
});

test('an unknown method is a JSON-RPC error', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('resources/list', {});
  assert.equal(reply.error.code, -32601);
  child.kill();
});

test('without its environment the bridge refuses to start', async () => {
  const { child } = startBridge({});
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 2);
});

test.after(() => host.close());
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/agent-bridge.test.js`
Expected: FAIL — the bridge file does not exist, so the child exits immediately and `rpc` promises never resolve; the test runner reports failures/timeouts. (If it hangs, stop it with Ctrl-C; the failure is the point.)

- [ ] **Step 3: Implement `bin/marble-mcp.js`**

```js
#!/usr/bin/env node
// Marble's tools, as an MCP server on stdio.
//
// Every agent CLI — Claude Code, Cursor, Codex — can start an MCP server and
// call its tools, so this is the one door they all come through. It holds no
// logic: each call is forwarded to the host that started the turn, with the
// turn's token, and the host decides everything. That keeps one copy of the
// rules, and it means a bridge that outlives its turn can do nothing at all.

import readline from 'node:readline';

const BASE = process.env.MARBLE_DRIVE_URL;
const TOKEN = process.env.MARBLE_AGENT_TOKEN;

if (!BASE || !TOKEN) {
  process.stderr.write('marble-mcp: MARBLE_DRIVE_URL and MARBLE_AGENT_TOKEN are required\n');
  process.exit(2);
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function host(route, { method = 'GET', body = null } = {}) {
  const response = await fetch(new URL(route, BASE), {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { error: payload.error ?? `the drive answered ${response.status}` };
  return payload;
}

const asContent = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  isError: Boolean(payload.error),
});

async function handle({ id, method, params }) {
  // A notification carries no id and wants no answer.
  if (id === undefined || id === null) return;
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'marble', version: '0.1.0' },
        });
      case 'ping':
        return reply(id, {});
      case 'tools/list': {
        const listed = await host('/agent/tools');
        if (listed.error) return fail(id, -32603, listed.error);
        return reply(id, { tools: listed.tools ?? [] });
      }
      case 'tools/call': {
        const name = encodeURIComponent(String(params?.name ?? ''));
        return reply(id, asContent(await host(`/agent/tools/${name}`, {
          method: 'POST',
          body: { arguments: params?.arguments ?? {} },
        })));
      }
      default:
        return fail(id, -32601, `no method "${method}"`);
    }
  } catch (err) {
    // Said to the agent as a tool result, because an agent reads those and
    // tells the person; a protocol error is something a CLI swallows.
    if (method === 'tools/call') {
      return reply(id, asContent({ error: `the drive could not be reached: ${err.cause?.code ?? err.message}` }));
    }
    return fail(id, -32603, err.message);
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  handle(message);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `chmod +x bin/marble-mcp.js && node --test --test-reporter=spec test/agent-bridge.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add bin/marble-mcp.js test/agent-bridge.test.js
git commit -m "Agents core: the MCP bridge every agent CLI comes through"
```

---

### Task 8: Routes, configuration and wiring into the host

**Files:**
- Modify: `server/config.js`
- Create: `server/agent/providers/index.js`
- Create: `server/agent/routes.js`
- Create: `server/agent/index.js`
- Modify: `server/app.js` (signature of `createDrive`, route dispatch, `close`, returned object)
- Test: `test/agent-http.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces:
  - Config: `config.agents` (bool, `MARBLE_DRIVE_AGENTS`), `config.agentProvider` (`MARBLE_DRIVE_AGENT_PROVIDER`, default `claude-subscription`), `config.agentWorkdir` (absolute; `MARBLE_DRIVE_AGENT_WORKDIR`, default `~/.cache/marble-drive/agents`), `config.agentStallMinutes` (10), `config.agentMaxMinutes` (30).
  - `agentsAllowed(config) → { ok: boolean, why: string|null }`.
  - `builtInProviders() → Map<id, provider>` (empty until Plan 2).
  - `createAgents({ config, store, writeOps, createDocument, origin, providers, log }) → Promise<{ handle(req, res, url), handleTools(req, res, url), watchdog(docPath, sha), store, runner, close() }>`.
  - `agentsAllowed` also refuses when `config.agentWorkdir` is inside `config.root`.
  - `isLoopback(req) → boolean`.
  - `createDrive(config, { log, agentProviders })` — `agentProviders` overrides `builtInProviders()`; the returned drive has `agents` (null when not allowed).
  - HTTP, all JSON: `GET /agent/providers` → `[{id, label, installed, signedIn, detail, default}]`; `GET|PUT /agent/settings`; `GET /agent/conversations?archived=1`; `POST /agent/conversations {provider, model?, handoffFrom?}` → 201 meta; `GET /agent/conversations/:id` → `{meta, turns, events}`; `PATCH /agent/conversations/:id {archived?, reviewed?, title?}` → meta; `POST /agent/conversations/:id/turns {prompt, context}` → 202 `{turnId, status}`; `DELETE /agent/turns/:id` → `{removed}`; `POST /agent/turns/:id/cancel` → `{cancelled}`; `POST /agent/turns/:id/undo` → `{reverted, kept, errors}` (409 when running or already undone); `GET /agent/events?conversation=:id&after=n` and `?all=1` (SSE); `GET /agent/tools`, `POST /agent/tools/:name` (loopback + token).

- [ ] **Step 1: Write the failing test**

Create `test/agent-http.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-agents-http-'));
const WORK = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-agents-work-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { agentsAllowed } = await import('../server/agent/index.js');
const { isLoopback } = await import('../server/agent/routes.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

const quiet = { log() {}, error() {} };

const SOURCE = `<!doctype html>
<html><head><title>Garden</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Research Garden</h1>
  <ul data-marble-id="q">
    <li data-marble-id="q1">Why?</li>
  </ul>
</body></html>
`;

const SCRIPTS = {
  edit: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
  wait: [{ sleep: 2500 }, { say: 'waited' }],
  hold: [{ silent: 20_000 }],
};

const config = loadConfig({
  ...process.env,
  MARBLE_DRIVE_AGENTS: '1',
  MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
  MARBLE_DRIVE_AGENT_WORKDIR: WORK,
});
const drive = await createDrive(config, {
  log: quiet,
  agentProviders: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
});
await drive.createDocument('garden', SOURCE);
await drive.createDocument('watched', SOURCE);

const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
const base = `http://127.0.0.1:${port}`;

const api = async (method, route, body, headers = {}) => {
  const response = await fetch(base + route, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const until = async (check, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('timed out');
};

const finished = (conversationId, turnId) =>
  until(async () => {
    const { body } = await api('GET', `/agent/conversations/${conversationId}`);
    const turn = body.turns.find((t) => t.id === turnId);
    return turn && !['queued', 'running'].includes(turn.status) ? { turn, body } : null;
  });

/** Frames from an SSE route, until `stop(frames)` or the deadline. */
async function frames(route, stop, ms = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const seen = [];
  try {
    const response = await fetch(base + route, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!stop(seen)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        const data = part.match(/^data: (.*)$/m)?.[1];
        if (data !== undefined) seen.push(data);
      }
    }
  } catch {
    // aborted
  }
  clearTimeout(timer);
  controller.abort();
  return seen;
}

const start = async (prompt, target = 'garden', extra = {}) => {
  const conversation = await api('POST', '/agent/conversations', { provider: 'fake', ...extra });
  const turn = await api('POST', `/agent/conversations/${conversation.body.id}/turns`, {
    prompt,
    context: { target, viewing: target, selection: [] },
  });
  return { conversationId: conversation.body.id, turnId: turn.body.turnId, status: turn.status };
};

let edited = null;

test('providers are listed, with the default marked', async () => {
  const { status, body } = await api('GET', '/agent/providers');
  assert.equal(status, 200);
  assert.deepEqual(body, [{ id: 'fake', label: 'Fake', installed: true, signedIn: true, detail: 'scripted', default: true }]);
});

test('an agent edits a document through the bridge, and the open tab hears it', async () => {
  const heard = frames('/events?app=garden&client=tab1', (seen) => seen.includes('changed'));
  edited = await start('script:edit\nRename the heading');
  assert.equal(edited.status, 202);
  const { turn, body } = await finished(edited.conversationId, edited.turnId);

  assert.equal(turn.status, 'completed');
  assert.equal(turn.applied, 1);
  assert.match(await drive.store.read('garden'), />Backlog</);
  const types = body.events.map((e) => e.type);
  for (const type of ['user', 'turn.started', 'tool.call', 'tool.result', 'ops.applied', 'text', 'turn.completed']) {
    assert.ok(types.includes(type), type);
  }
  assert.equal(body.meta.needsReview, true);
  assert.ok((await heard).includes('changed'));
});

test('the conversation stream replays what happened and follows what happens next', async () => {
  const { conversationId, turnId } = await start('script:wait');
  const seen = await frames(`/agent/events?conversation=${conversationId}&after=0`, (s) =>
    s.some((d) => d.includes('"turn.completed"')),
  );
  const events = seen.map((d) => JSON.parse(d));
  assert.equal(events[0].type, 'user', 'replayed from the start');
  assert.ok(events.some((e) => e.type === 'text.delta'), 'live deltas arrive');
  assert.ok(events.some((e) => e.type === 'turn.completed'));
  await finished(conversationId, turnId);
});

test('undo over HTTP puts the heading back, once', async () => {
  const first = await api('POST', `/agent/turns/${edited.turnId}/undo`);
  assert.deepEqual(first.body, { reverted: 1, kept: 0, errors: [] });
  assert.match(await drive.store.read('garden'), />Research Garden</);
  const again = await api('POST', `/agent/turns/${edited.turnId}/undo`);
  assert.equal(again.status, 409);
  const { body } = await api('GET', `/agent/conversations/${edited.conversationId}`);
  assert.equal(body.events.at(-1).type, 'turn.undone');
});

test('reviewed and archived', async () => {
  const reviewed = await api('PATCH', `/agent/conversations/${edited.conversationId}`, { reviewed: true });
  assert.equal(reviewed.body.needsReview, false);
  await api('PATCH', `/agent/conversations/${edited.conversationId}`, { archived: true });
  const listed = await api('GET', '/agent/conversations');
  assert.ok(!listed.body.some((c) => c.id === edited.conversationId));
  const archived = await api('GET', '/agent/conversations?archived=1');
  assert.ok(archived.body.some((c) => c.id === edited.conversationId));
});

test('a handoff links both conversations and briefs the next agent', async () => {
  const next = await start('Carry on', 'garden', { handoffFrom: edited.conversationId });
  const { body } = await finished(next.conversationId, next.turnId);
  assert.equal(body.meta.handoffFrom, edited.conversationId);
  assert.match(body.events.find((e) => e.type === 'text').text, /^prompt:This continues an earlier conversation/);
  const old = await api('GET', `/agent/conversations/${edited.conversationId}`);
  assert.equal(old.body.meta.handoffTo, next.conversationId);
});

test('tools answer only a running turn’s token, and the token dies with the turn', async () => {
  assert.equal((await api('GET', '/agent/tools')).status, 401);
  assert.equal((await api('POST', '/agent/tools/read_document', { arguments: {} }, { Authorization: 'Bearer nope' })).status, 401);

  const held = await start('script:hold');
  const token = await until(() => drive.agents.runner.running()[0]?.token);
  const listed = await api('GET', '/agent/tools', null, { Authorization: `Bearer ${token}` });
  assert.equal(listed.body.tools.length, 5);

  const cancelled = await api('POST', `/agent/turns/${held.turnId}/cancel`);
  assert.deepEqual(cancelled.body, { cancelled: true });
  assert.equal((await finished(held.conversationId, held.turnId)).turn.status, 'cancelled');
  assert.equal((await api('GET', '/agent/tools', null, { Authorization: `Bearer ${token}` })).status, 401);
});

test('only loopback is loopback', () => {
  assert.equal(isLoopback({ socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '100.108.111.56' } }), false);
});

test('a mutation from another origin is refused', async () => {
  const { status } = await api('POST', '/agent/conversations', { provider: 'fake' }, { Origin: 'http://evil.example' });
  assert.equal(status, 403);
});

test('an unknown provider and a turn with no target are refused up front', async () => {
  assert.equal((await api('POST', '/agent/conversations', { provider: 'nope' })).status, 400);
  const { body } = await api('POST', '/agent/conversations', { provider: 'fake' });
  assert.equal((await api('POST', `/agent/conversations/${body.id}/turns`, { prompt: 'x', context: {} })).status, 400);
});

test('settings are read and saved', async () => {
  const saved = await api('PUT', '/agent/settings', { models: { fake: 'm1' } });
  assert.equal(saved.body.models.fake, 'm1');
  assert.equal((await api('GET', '/agent/settings')).body.defaultProvider, 'fake');
});

test('when agents are allowed, and when not', () => {
  const base = { agents: true, multiTenant: false, secret: null, host: '127.0.0.1', root: '/data/drive', agentWorkdir: '/cache/agents' };
  assert.equal(agentsAllowed(base).ok, true);
  assert.match(agentsAllowed({ ...base, agents: false }).why, /MARBLE_DRIVE_AGENTS/);
  assert.match(agentsAllowed({ ...base, multiTenant: true }).why, /multi-tenant/);
  assert.equal(agentsAllowed({ ...base, host: '0.0.0.0' }).ok, false);
  assert.equal(agentsAllowed({ ...base, host: '0.0.0.0', secret: 'x' }).ok, true);
  assert.match(agentsAllowed({ ...base, agentWorkdir: '/data/drive/.work' }).why, /inside the drive/);
});

test('a host with agents off answers 404 to all of it', async () => {
  const off = await createDrive(loadConfig({ ...process.env, MARBLE_DRIVE_AGENTS: '' }), { log: quiet });
  const offPort = await new Promise((resolve) => off.server.listen(0, '127.0.0.1', () => resolve(off.server.address().port)));
  assert.equal(off.agents, null);
  assert.equal((await fetch(`http://127.0.0.1:${offPort}/agent/providers`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${offPort}/agent/tools`)).status, 404);
  await off.close();
});

test.after(() => drive.close());
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/agent-http.test.js`
Expected: FAIL — `Cannot find module '…/server/agent/index.js'`.

- [ ] **Step 3: Add the configuration**

In `server/config.js`, add `import os from 'node:os';` after `import path from 'node:path';`, and add inside the returned object, after `open: bool('MARBLE_DRIVE_OPEN', false),`:

```js

    // Agents: Claude, Cursor or Codex running on this machine and editing the
    // drive through Marble's tools. Off unless asked for, because it is a
    // process on this machine acting for whoever got through the gate. See
    // docs/AGENTS.md.
    agents: bool('MARBLE_DRIVE_AGENTS', false),
    agentProvider: str('MARBLE_DRIVE_AGENT_PROVIDER', 'claude-subscription'),
    // Each conversation's scratch workspace. Deliberately not under the drive
    // root: an agent's own tools should find nothing there worth touching.
    agentWorkdir: path.resolve(str('MARBLE_DRIVE_AGENT_WORKDIR', path.join(os.homedir(), '.cache', 'marble-drive', 'agents'))),
    agentStallMinutes: num('MARBLE_DRIVE_AGENT_STALL_MINUTES', 10),
    agentMaxMinutes: num('MARBLE_DRIVE_AGENT_MAX_MINUTES', 30),
```

- [ ] **Step 4: Create `server/agent/providers/index.js`**

```js
// The agent CLIs this host knows how to run. Plan 2 registers
// `claude-subscription`, `claude-api` and `cursor` here; until then the
// registry is empty and a host can only run providers handed to `createDrive`.

export const builtInProviders = () => new Map();
```

- [ ] **Step 5: Create `server/agent/routes.js`**

```js
// The agent surface over HTTP. Two doors with different locks:
//
//   - `/agent/tools/*` is for the MCP bridge a turn's process started. It
//     answers only this machine, and only the token of a turn that is running
//     right now. It sits in front of the gate, because the bridge has the
//     turn's token and not the drive's secret — which is the point.
//   - everything else is for the person, behind the gate like every other
//     route, and a change also has to come from this origin.

import { json, readJson } from '../http.js';
import { parsePath } from '../paths.js';
import { sameOrigin } from '../sessions.js';
import { summarize } from './store.js';
import { undoTurn } from './undo.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const DETECT_TIMEOUT = 5_000;
const DETECT_CACHE = 60_000;

export const isLoopback = (req) => LOOPBACK.has(req.socket?.remoteAddress);
const bearer = (req) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
const CONVERSATION = /^\/agent\/conversations\/([0-9a-f]{12})(\/turns)?$/;
const TURN = /^\/agent\/turns\/([0-9a-f]{12}-t\d+)(\/cancel|\/undo)?$/;
const TOOL = /^\/agent\/tools\/([a-z_]+)$/;

export function createAgentRoutes({ store, runner, tools, hub, providers, writeOps, maxBody }) {
  let detected = null;

  async function detectAll() {
    if (detected && Date.now() - detected.at < DETECT_CACHE) return detected.list;
    const list = await Promise.all(
      [...providers.values()].map(async (provider) => {
        const timeout = new Promise((resolve) =>
          setTimeout(() => resolve({ installed: false, signedIn: false, detail: 'detection timed out' }), DETECT_TIMEOUT).unref?.(),
        );
        const found = await Promise.race([provider.detect().catch((err) => ({ installed: false, signedIn: false, detail: err.message })), timeout]);
        return { id: provider.id, label: provider.label, ...found };
      }),
    );
    detected = { at: Date.now(), list };
    return list;
  }

  async function handleTools(req, res, url) {
    if (!isLoopback(req)) return json(res, 403, { error: 'agent tools answer only on this machine' });
    const token = bearer(req);
    if (!runner.turnForToken(token)) return json(res, 401, { error: 'no running turn holds that token' });

    if (url.pathname === '/agent/tools' && req.method === 'GET') return json(res, 200, { tools: tools.schemas });
    const match = TOOL.exec(url.pathname);
    if (match && req.method === 'POST') {
      const body = await readJson(req, maxBody);
      const result = await runner.callTool(token, match[1], body.arguments ?? {});
      return json(res, 200, result ?? { error: 'the turn ended' });
    }
    return json(res, 404, { error: 'not found' });
  }

  async function publishSummary(conversationId, event) {
    const meta = await store.conversation(conversationId);
    hub.publish(conversationId, event, meta ? summarize(meta) : null);
  }

  async function handle(req, res, url) {
    const route = url.pathname;
    const method = req.method;
    if (method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'a change has to come from this drive' });

    if (route === '/agent/providers' && method === 'GET') {
      const { defaultProvider } = await store.settings();
      return json(res, 200, (await detectAll()).map((p) => ({ ...p, default: p.id === defaultProvider })));
    }

    if (route === '/agent/settings') {
      if (method === 'GET') return json(res, 200, await store.settings());
      if (method === 'PUT') {
        const body = await readJson(req, maxBody);
        const patch = {};
        if (typeof body.defaultProvider === 'string') patch.defaultProvider = body.defaultProvider;
        if (body.models && typeof body.models === 'object') patch.models = { ...(await store.settings()).models, ...body.models };
        // Read when the host starts; a change applies after a restart.
        if (Number.isInteger(body.maxRunning) && body.maxRunning > 0) patch.maxRunning = body.maxRunning;
        return json(res, 200, await store.saveSettings(patch));
      }
    }

    if (route === '/agent/conversations') {
      if (method === 'GET') {
        return json(res, 200, await store.conversations({ archived: url.searchParams.get('archived') === '1' }));
      }
      if (method === 'POST') {
        const body = await readJson(req, maxBody);
        if (!providers.has(body.provider)) return json(res, 400, { error: `no provider "${body.provider}"` });
        const from = body.handoffFrom ? await store.conversation(body.handoffFrom) : null;
        if (body.handoffFrom && !from) return json(res, 404, { error: `no conversation "${body.handoffFrom}"` });
        const { models } = await store.settings();
        const meta = await store.createConversation({
          provider: body.provider,
          model: body.model ?? models[body.provider] ?? null,
          handoffFrom: from?.id ?? null,
        });
        if (from) {
          await store.updateConversation(from.id, { handoffTo: meta.id });
          await publishSummary(from.id, await store.appendEvent(from.id, { type: 'handoff', to: meta.id, provider: meta.provider }));
          await publishSummary(meta.id, await store.appendEvent(meta.id, { type: 'handoff', from: from.id, provider: from.provider }));
        }
        return json(res, 201, summarize(await store.conversation(meta.id)));
      }
    }

    const conversation = CONVERSATION.exec(route);
    if (conversation) {
      const [, id, turns] = conversation;
      const meta = await store.conversation(id);
      if (!meta) return json(res, 404, { error: `no conversation "${id}"` });

      if (turns && method === 'POST') {
        const body = await readJson(req, maxBody);
        if (!body.context?.target) return json(res, 400, { error: 'a turn needs context.target' });
        const context = {
          viewing: body.context.viewing ? parsePath(String(body.context.viewing)) : null,
          target: parsePath(String(body.context.target), { allowRoot: false }),
          selection: Array.isArray(body.context.selection) ? body.context.selection.map(String) : [],
        };
        return json(res, 202, await runner.send(id, { prompt: String(body.prompt ?? ''), context }));
      }
      if (!turns && method === 'GET') {
        return json(res, 200, {
          meta: summarize(meta),
          turns: await store.turns(id),
          events: await store.events(id, { after: Number(url.searchParams.get('after') ?? 0) }),
        });
      }
      if (!turns && method === 'PATCH') {
        const body = await readJson(req, maxBody);
        const patch = {};
        if (typeof body.archived === 'boolean') patch.archived = body.archived;
        if (body.reviewed === true) patch.lastReviewedAt = Date.now();
        if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 120);
        const next = summarize(await store.updateConversation(id, patch));
        hub.publish(id, { type: 'meta' }, next);
        return json(res, 200, next);
      }
    }

    const turnRoute = TURN.exec(route);
    if (turnRoute) {
      const [, turnId, action] = turnRoute;
      if (!action && method === 'DELETE') return json(res, 200, { removed: await runner.dequeue(turnId) });
      if (action === '/cancel' && method === 'POST') return json(res, 200, { cancelled: await runner.cancel(turnId) });
      if (action === '/undo' && method === 'POST') {
        const turn = await store.turn(turnId);
        if (!turn) return json(res, 404, { error: `no turn "${turnId}"` });
        if (turn.status === 'queued' || turn.status === 'running') return json(res, 409, { error: 'the turn is still running' });
        if (turn.undoneAt) return json(res, 409, { error: 'this turn was already undone' });
        const result = await undoTurn({
          records: (await store.undoRecords(turnId)) ?? [],
          writeOps,
          client: `agent-undo:${turn.conversationId}`,
        });
        await store.updateTurn(turnId, { undoneAt: Date.now() });
        await publishSummary(
          turn.conversationId,
          await store.appendEvent(turn.conversationId, { type: 'turn.undone', turn: turnId, reverted: result.reverted, kept: result.kept }),
        );
        return json(res, 200, result);
      }
    }

    if (route === '/agent/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      const id = url.searchParams.get('conversation');
      if (id && /^[0-9a-f]{12}$/.test(id)) {
        for (const event of await store.events(id, { after: Number(url.searchParams.get('after') ?? 0) })) {
          res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        req.on('close', hub.subscribe(id, res));
      } else {
        req.on('close', hub.subscribe('*', res));
      }
      return undefined;
    }

    return json(res, 404, { error: 'not found' });
  }

  return { handle, handleTools };
}
```

- [ ] **Step 6: Create `server/agent/index.js`**

```js
// Everything agents need, put together for the host. `app.js` asks two
// questions of this file — may agents run here, and what handles their routes —
// and nothing else in the host knows how any of it works.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { enginePath } from '../engine.js';
import { build as buildStarter } from '../gallery.js';
import { createHub } from './hub.js';
import { createAgentRoutes } from './routes.js';
import { createRunner } from './runner.js';
import { createAgentStore } from './store.js';
import { createTools } from './tools.js';

const BRIDGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'marble-mcp.js');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function agentsAllowed(config) {
  if (!config.agents) return { ok: false, why: 'MARBLE_DRIVE_AGENTS is not set' };
  if (config.multiTenant) return { ok: false, why: 'agents are for one owner, and this host is multi-tenant' };
  if (!config.secret && !LOOPBACK_HOSTS.has(config.host)) {
    return { ok: false, why: `an ungated host on ${config.host} would let anyone who reaches it run agents on this machine` };
  }
  const inside = path.relative(config.root, config.agentWorkdir);
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
    return { ok: false, why: `MARBLE_DRIVE_AGENT_WORKDIR is inside the drive (${config.agentWorkdir}); put it where an agent's own tools find nothing` };
  }
  return { ok: true, why: null };
}

export async function createAgents({ config, store, writeOps, createDocument, origin, providers, log = console }) {
  const agentStore = createAgentStore({ dir: path.join(store.marbleDir, 'agents'), defaultProvider: config.agentProvider });
  await agentStore.ready();
  const settings = await agentStore.settings();
  const hub = createHub();
  const tools = createTools({
    store,
    writeOps,
    createDocument,
    buildStarter,
    guidePath: enginePath('skills/build-in-marble/SKILL.md'),
  });
  const runner = createRunner({
    store: agentStore,
    tools,
    providers,
    workdir: config.agentWorkdir,
    origin,
    bridgePath: BRIDGE,
    readDocument: (docPath) => store.read(docPath),
    publish: hub.publish,
    limits: {
      maxRunning: settings.maxRunning,
      stallMs: config.agentStallMinutes * 60_000,
      maxMs: config.agentMaxMinutes * 60_000,
      killGraceMs: 3_000,
    },
    log,
  });
  await runner.boot();

  const routes = createAgentRoutes({ store: agentStore, runner, tools, hub, providers, writeOps, maxBody: config.maxBodyBytes });

  return {
    handle: routes.handle,
    handleTools: routes.handleTools,
    watchdog: (docPath, sha) => runner.watchdog(docPath, sha),
    store: agentStore,
    runner,
    async close() {
      await runner.close();
      hub.close();
    },
  };
}
```

- [ ] **Step 7: Wire it into `server/app.js`**

Add to the imports:

```js
import { agentsAllowed, createAgents } from './agent/index.js';
import { builtInProviders } from './agent/providers/index.js';
```

Change the signature:

```js
export async function createDrive(config, { log = console, agentProviders = null } = {}) {
```

Just before `const server = http.createServer(async (req, res) => {`, add:

```js
  // Set once the server exists, because the agents need to know where to tell
  // their MCP bridge to call back. Null when agents are not allowed here.
  let agents = null;
```

Inside the handler, replace:

```js
      if (route === '/gate') return gateRoute(req, res, url);
```

with:

```js
      if (route === '/gate') return gateRoute(req, res, url);
      // In front of the gate: the MCP bridge carries a turn's token, not the
      // drive's secret, and the tool routes check that token themselves.
      if (route === '/agent/tools' || route.startsWith('/agent/tools/')) {
        // Awaited, so a refusal thrown inside reaches the catch below as a status.
        return agents ? await agents.handleTools(req, res, url) : text(res, 404, 'not found');
      }
```

and immediately after the gate's `if (!gate.allows(req)) { … }` block, add:

```js
      if (route.startsWith('/agent/')) {
        return agents ? await agents.handle(req, res, url) : text(res, 404, 'not found');
      }
```

After the `const server = http.createServer(…);` statement ends, add:

```js
  if (agentsAllowed(config).ok) {
    agents = await createAgents({
      config,
      store,
      writeOps,
      createDocument: (docPath, source, { label = 'created' } = {}) => putDocument(docPath, source, { label }),
      // Where the bridge calls back: this server, on loopback, whatever port it
      // ended up on.
      origin: () => {
        const address = server.address();
        const loopback = address.family === 'IPv6' ? '[::1]' : '127.0.0.1';
        return `http://${loopback}:${address.port}`;
      },
      providers: agentProviders ?? builtInProviders(),
      log,
    });
  }
```

In the returned object add `agents,` after `writeOps,`, and in `close()` add as the first line:

```js
      await agents?.close();
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test --test-reporter=spec test/agent-http.test.js && npm test`
Expected: PASS — 13 new tests, full suite green.

- [ ] **Step 9: Commit**

```bash
git add server/config.js server/app.js server/agent/index.js server/agent/routes.js server/agent/providers/index.js test/agent-http.test.js
git commit -m "Agents core: the /agent surface, wired into the host behind MARBLE_DRIVE_AGENTS"
```

---

### Task 9: The watchdog, the boot line, and the docs

**Files:**
- Modify: `server/app.js` (watcher callback, the external-edit branch)
- Modify: `bin/marble-drive.js` (`serve()` boot log)
- Modify: `.env.example`
- Create: `docs/AGENTS.md`
- Test: add to `test/agent-http.test.js`

**Interfaces:**
- Consumes: Task 8 `drive.agents.watchdog(docPath, sha)`; the watcher's existing `pre-external` restore point, whose checkpoint sha is `shaOf(prior.source)`; the existing `POST /restore?app=<path>&sha=<sha>`.
- Produces: a `watchdog` event `{type: 'watchdog', path, sha}` on every running turn when a document changes outside the host; the sha restores the state before that change.

- [ ] **Step 1: Write the failing test**

Append to `test/agent-http.test.js`, before `test.after`:

```js
test('a document changed outside Marble during a turn is flagged, with a way back', async () => {
  const running = await start('script:wait', 'watched');
  await until(() => drive.agents.runner.running().length === 1);

  const file = path.join(ROOT, 'watched.mrbl');
  const before = await fsp.readFile(file, 'utf8');
  await fsp.writeFile(file, before.replace('Research Garden', 'Scribbled from outside'));

  const { body } = await finished(running.conversationId, running.turnId);
  const flagged = body.events.find((e) => e.type === 'watchdog');
  assert.ok(flagged, 'the turn was flagged');
  assert.equal(flagged.path, 'watched');
  assert.equal(body.meta.lastOutcome, 'watchdog');
  assert.equal(body.meta.needsReview, true);

  const restored = await fetch(`${base}/restore?app=watched&sha=${flagged.sha}`, { method: 'POST' });
  assert.equal(restored.status, 200);
  assert.match(await drive.store.read('watched'), />Research Garden</);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/agent-http.test.js`
Expected: FAIL — `the turn was flagged`.

- [ ] **Step 3: Call the watchdog from the watcher**

In `server/app.js`, in the watcher callback, replace:

```js
    if (prior) await store.mark(docPath, prior.source, 'pre-external');
```

with:

```js
    if (prior) {
      await store.mark(docPath, prior.source, 'pre-external');
      // Every agent writes through ops, so an agent's own work never reaches
      // this branch. Something changing a document from outside while a turn
      // runs is flagged on that turn, with the restore point just taken, and
      // left to a person: the likeliest outside writer is them, in an editor.
      agents?.watchdog(docPath, shaOf(prior.source));
    }
```

- [ ] **Step 4: Say whether agents are on at boot**

In `bin/marble-drive.js`, add to the imports:

```js
import { agentsAllowed } from '../server/agent/index.js';
```

and in `serve()`, after the intent-provider `console.log(...)`, add:

```js
    console.log(
      drive.agents
        ? `[drive] agents on — conversations in ${path.join(config.root, '.marble', 'agents')}`
        : `[drive] agents off — ${agentsAllowed(config).why}`,
    );
```

- [ ] **Step 5: Document the environment**

Append to `.env.example`:

```
# Agents: Claude, Cursor or Codex editing the drive through Marble's tools, on
# this machine. Off unless set. See docs/AGENTS.md.
MARBLE_DRIVE_AGENTS=
# claude-subscription | claude-api | cursor | codex — the default for a new conversation.
MARBLE_DRIVE_AGENT_PROVIDER=claude-subscription
# Scratch workspaces for agent processes. Never inside the drive.
MARBLE_DRIVE_AGENT_WORKDIR=
MARBLE_DRIVE_AGENT_STALL_MINUTES=10
MARBLE_DRIVE_AGENT_MAX_MINUTES=30
```

- [ ] **Step 6: Write `docs/AGENTS.md`**

````markdown
# Agents

> An agent is a third writer. It files ops like a gesture does, through the
> same queue, and it can be told no.

Design: [`superpowers/specs/2026-09-16-agent-interface-design.md`](superpowers/specs/2026-09-16-agent-interface-design.md).

## Turning it on

```
MARBLE_DRIVE_AGENTS=1
MARBLE_DRIVE_AGENT_PROVIDER=claude-subscription
```

Refused, with the reason printed at boot, on a multi-tenant host and on an
ungated host that is not listening on loopback.

## How a turn runs

```
POST /agent/conversations/:id/turns {prompt, context:{target, viewing, selection}}
  → runner queues it (one per conversation, maxRunning across all)
  → spawns the provider's CLI in ~/.cache/marble-drive/agents/<conversation>/
  → the CLI starts bin/marble-mcp.js, which calls /agent/tools/* with the turn's token
  → tools.js reads, checks, and writes through applyOps
  → every open tab hears `changed`; the transcript streams on /agent/events
```

## The rules the tools enforce

- **Read before you write.** An element must have been shown to this
  conversation in full before `apply_ops` may change it.
- **Stale is refused.** If the element changed since, nothing in the batch
  applies and the agent gets the current source back. A person's own ops are
  never refused for being stale.
- **Only the target.** A turn writes to its target document and to documents it
  created. It reads anything.
- **Every batch can be undone.** Undo skips anything a person edited after the
  agent, and says how much it kept.

## What the watchdog is for

Every agent writes through ops, so an agent's work never looks like an edit
from outside. If a document changes outside the host while a turn runs, the turn
gets a `watchdog` event carrying the restore point taken just before the change.
Nothing is reverted automatically: the likeliest outside writer is you.

## Storage

```
.marble/agents/settings.json
.marble/agents/<conversation>/meta.json
.marble/agents/<conversation>/events.jsonl
.marble/agents/<conversation>/turns/<turn>.json
.marble/agents/<conversation>/turns/<turn>.undo.json
.marble/agents/<conversation>/raw/<turn>.jsonl
```

## Providers

A provider is `{ id, label, detect, prepare?, spawn, parse }` — see
`server/agent/runner.js`. `test/fixtures/fake-provider.js` is the smallest
complete one. Claude and Cursor adapters arrive in Plan 2.
````

- [ ] **Step 7: Run everything**

Run: `node --test --test-reporter=spec test/agent-http.test.js && npm test`
Expected: PASS — the watchdog test and the full suite. Run `npm test` three times; the agent HTTP tests use real processes and the filesystem watcher, and a flake is a bug to find, not to retry past.

- [ ] **Step 8: Commit**

```bash
git add server/app.js bin/marble-drive.js .env.example docs/AGENTS.md test/agent-http.test.js
git commit -m "Agents core: the watchdog, a boot line, and docs/AGENTS.md"
```

---

## After this plan

- **Plan 2 — Providers:** `claude-subscription`, `claude-api`, `cursor` adapters (spawn flags and stream parsing from the spec §4.2, recorded fixtures from one real run each), workspace files (`mcp.json`, `.cursor/mcp.json`, `.cursor/hooks.json` with the `preToolUse` allowlist, `INSTRUCTIONS.md`/`AGENTS.md`), detection. Live turns on Claude and Cursor.
- **Plan 3 — Drawer:** `runtime/agent.js` (`window.marble.agent`), `runtime/agent-ui.js` (`<marble-agent-drawer>`, `<marble-conversation>`), injection, watchdog Restore.
- **Plan 4 — `Agents.mrbl`:** library ⇄ board with the FLIP toggle.
- **Plan 5 — Codex:** adapter behind experimental; live verification when the quota returns (2026-10-15).
