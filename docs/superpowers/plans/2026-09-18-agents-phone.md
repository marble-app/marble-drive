# Agents on a phone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Agents document a phone-native surface: a fifth view, **Deck**, ordered by what wants you; a **Focus** layout for phones where a card's size falls off continuously with its distance from the one in your hand; phone chrome (topbar, thumb bar, sheets) that moves like an app; and the one server route it needs, `GET /agent/asks`.

**Architecture:** All arithmetic lives in a new pure module `runtime/agent-phone.js` (bands, ask lead, fisheye layout and its inverse, a spring stepper), tested in Node. `templates/agents.mrbl` gains the Deck view, the phone Focus layout, the phone chrome and the sheets, all under the existing `(max-width: 719px)` breakpoint. `runtime/agent-ui.js` exports the ask-card builder so Deck can draw the same card the drawer draws, and gains a `damping` parameter on its spring. The runner remembers each open ask's request so `GET /agent/asks` can list them and the `*` stream can announce them.

**Tech Stack:** Vanilla JS in an IIFE (no modules in `.mrbl`), Web Animations, Pointer Events, `matchMedia`, `visualViewport`; Node 22 `node:test`; Playwright for browser tests.

**Spec:** `docs/superpowers/specs/2026-09-18-agents-phone-design.md`

## Global Constraints

- No new npm dependencies. Node 22.
- Same UIST warm / Dusk tokens (`--paper`, `--paper-2`, `--ink`, `--faint`, `--line`, `--accent`, `--danger`, `--caution`, `--ease-out`, `--settle`); no new palette.
- Never reparent the file's `<marble-conversation>`; retarget it via its `conversation` attribute.
- The phone breakpoint is the existing `PHONE` / `narrowView` constant: `(max-width: 719px)`. Do not add a second breakpoint.
- Consequential answers (Allow, Deny, Undo, Stop) are buttons, never completed gestures.
- Every new control under `(hover: none)` is at least 44 pt (`2.75rem`) tall.
- `prefers-reduced-motion`: every spring becomes a 150 ms opacity crossfade; no travel.
- Existing browser tests (`agents-page`, `agents-focus`, `agents-folders`, `agents-panes`, `agents-transitions`) must pass unchanged.
- `drive/Agents.mrbl` is seed-once: it is patched by hand at the end, one write then verify, never while a `serve` is racing it.
- Commit after every task. Commit messages are one sentence in the house voice, then the attribution lines from the session reminder.

---

### Task 1: `agent-phone.js` — bands and the ask lead

**Files:**
- Create: `runtime/agent-phone.js`
- Create: `test/agent-phone.test.js`

**Interfaces:**
- Produces on `globalThis.marbleAgentPhone`:
  - `bandOf(summary) → 'asks' | 'running' | 'review' | 'idle' | null` (null = archived)
  - `bandCompare(band) → (a, b) => number` — the sort within a band
  - `askLead(events, askSeq) → [{ type, text?, name?, input? }]` — up to the last two `text` / `tool.call` events before `askSeq`
  - `peekOf(request) → { title, detail, lines }` — what an ask card shows cold

- [ ] **Step 1: Write the failing tests**

```js
// test/agent-phone.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import '../runtime/agent-phone.js';

const P = () => globalThis.marbleAgentPhone;

test('bandOf puts every summary in exactly one band, asking first', () => {
  assert.equal(P().bandOf({ asking: true, running: true }), 'asks');
  assert.equal(P().bandOf({ running: true }), 'running');
  assert.equal(P().bandOf({ queued: true }), 'running');
  assert.equal(P().bandOf({ needsReview: true }), 'review');
  assert.equal(P().bandOf({ lastOutcome: 'changes' }), 'idle');
  assert.equal(P().bandOf({}), 'idle');
  assert.equal(P().bandOf({ archived: true, asking: true }), null);
});

test('bandCompare: asks oldest first, the rest most recent first', () => {
  const a = { updatedAt: 1 };
  const b = { updatedAt: 2 };
  assert.ok(P().bandCompare('asks')(a, b) < 0);
  assert.ok(P().bandCompare('running')(a, b) > 0);
  assert.ok(P().bandCompare('review')({ lastFinishedAt: 5, updatedAt: 1 }, { lastFinishedAt: 3, updatedAt: 9 }) < 0);
  assert.ok(P().bandCompare('idle')(a, b) > 0);
});

test('askLead is the last two text or tool.call events before the ask', () => {
  const events = [
    { seq: 1, type: 'user', text: 'go' },
    { seq: 2, type: 'text', text: 'Reading the file' },
    { seq: 3, type: 'tool.call', name: 'Read', input: { file_path: 'a.js' } },
    { seq: 4, type: 'tool.result', ok: true },
    { seq: 5, type: 'text', text: 'Now I will build' },
    { seq: 6, type: 'ask', requestId: 'r1' },
    { seq: 7, type: 'text', text: 'after' },
  ];
  assert.deepEqual(P().askLead(events, 6), [
    { type: 'tool.call', name: 'Read', input: { file_path: 'a.js' } },
    { type: 'text', text: 'Now I will build' },
  ]);
  assert.deepEqual(P().askLead(events, 2), []);
});

test('peekOf shows a command, a path with new lines, or the tool', () => {
  assert.deepEqual(P().peekOf({ kind: 'permission', tool: 'Bash', input: { command: 'latexmk -pdf' } }), {
    title: 'Bash', detail: 'latexmk -pdf', lines: [],
  });
  const edit = P().peekOf({ kind: 'permission', tool: 'Edit', input: { file_path: 'runtime/x.js', old_string: 'a', new_string: '1\n2\n3\n4\n5\n6\n7\n8' } });
  assert.equal(edit.title, 'Edit');
  assert.equal(edit.detail, 'runtime/x.js');
  assert.deepEqual(edit.lines, ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(P().peekOf({ kind: 'permission', tool: 'WebFetch', input: { url: 'https://x' } }), { title: 'WebFetch', detail: 'https://x', lines: [] });
  assert.equal(P().peekOf({ kind: 'question', tool: 'AskUserQuestion', input: { questions: [{ question: 'A or B?' }] } }).title, 'A or B?');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/agent-phone.test.js`
Expected: FAIL — `Cannot find module '../runtime/agent-phone.js'`

- [ ] **Step 3: Write the module**

```js
// runtime/agent-phone.js
// Pure helpers for the Agents document on a phone: which band a conversation
// belongs in, what an ask card shows cold, and the fisheye that lays Focus
// out as one column. Classic IIFE so the host can inject it as a script tag;
// Node tests import it for its side effect.

(() => {
  // ------------------------------------------------------------ bands
  //
  // Deck orders by how much a conversation wants you. Every summary lands in
  // exactly one band, derived from what summarize() already publishes.

  const bandOf = (summary) => {
    if (!summary || summary.archived) return null;
    if (summary.asking) return 'asks';
    if (summary.running || summary.queued || summary.status === 'running') return 'running';
    if (summary.needsReview) return 'review';
    return 'idle';
  };

  const bandCompare = (band) => {
    if (band === 'asks') return (a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
    if (band === 'review') return (a, b) => (b.lastFinishedAt ?? b.updatedAt ?? 0) - (a.lastFinishedAt ?? a.updatedAt ?? 0);
    return (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  };

  // ------------------------------------------------------------ asks

  const LEAD_TYPES = new Set(['text', 'tool.call']);

  /** The last two things the agent said or did before it asked. */
  const askLead = (events, askSeq) => events
    .filter((event) => event.seq < askSeq && LEAD_TYPES.has(event.type))
    .slice(-2)
    .map((event) => (event.type === 'text'
      ? { type: 'text', text: String(event.text ?? '') }
      : { type: 'tool.call', name: event.name, input: event.input ?? {} }));

  const PEEK_LINES = 6;

  /** Enough to answer without opening the conversation. */
  const peekOf = (request) => {
    const input = request?.input ?? {};
    if (request?.kind === 'question') {
      return { title: String(input.questions?.[0]?.question ?? 'A question'), detail: '', lines: [] };
    }
    const title = String(request?.displayName || request?.tool || 'Tool');
    const detail = String(input.command ?? input.file_path ?? input.path ?? input.url ?? input.pattern ?? '');
    const body = typeof input.new_string === 'string' ? input.new_string : typeof input.content === 'string' ? input.content : '';
    const lines = body ? body.split('\n').slice(0, PEEK_LINES) : [];
    return { title, detail, lines };
  };

  globalThis.marbleAgentPhone = { bandOf, bandCompare, askLead, peekOf };
})();
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/agent-phone.test.js`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-phone.js test/agent-phone.test.js
git commit -m "Agents on a phone: bands, and what an ask card shows cold, as pure helpers.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 2: `agent-phone.js` — the fisheye, its inverse, the spring stepper

**Files:**
- Modify: `runtime/agent-phone.js`
- Modify: `test/agent-phone.test.js`

**Interfaces:**
- Produces on `globalThis.marbleAgentPhone`:
  - `TIERS = { full: null, digest: 112, chip: 44, sliver: 10 }`, `SLIVER_OVERLAP = 2`
  - `fisheye(count, focal, room) → [{ top, height, lod, d }]` — `lod` is `'full' | 'digest' | 'chip' | 'sliver'` (the nearest integer tier); `d` the distance
  - `focalFor(index, top, count, room) → number` — the `focal` that puts card `index` at `top`
  - `stepSpring(state, target, dt, { damping = 1, response = 0.4 }) → { x, v, settled }`
  - `project(v, rate = 0.998)`

- [ ] **Step 1: Write the failing tests** (append)

```js
test('fisheye: heights fill the room, one full at an integer focal, continuous in focal', () => {
  const { fisheye } = P();
  const room = 700;
  for (const focal of [0, 1, 2.5, 5, 11]) {
    const cards = fisheye(12, focal, room);
    assert.equal(cards.length, 12);
    const total = cards[cards.length - 1].top + cards[cards.length - 1].height;
    assert.ok(Math.abs(total - room) < 0.01, `focal ${focal}: ${total}`);
  }
  const atFive = fisheye(12, 5, room);
  assert.equal(atFive.filter((c) => c.lod === 'full').length, 1);
  assert.equal(atFive[5].lod, 'full');
  assert.equal(atFive[4].lod, 'digest');
  assert.equal(atFive[3].lod, 'chip');
  assert.equal(atFive[2].lod, 'sliver');
  assert.equal(atFive[4].height, 112);
  assert.equal(atFive[3].height, 44);
  // Continuous: a nudge of focal moves no edge more than a few px.
  const a = fisheye(12, 5, room);
  const b = fisheye(12, 5.02, room);
  for (let i = 0; i < 12; i += 1) assert.ok(Math.abs(a[i].top - b[i].top) < 6, `card ${i} jumped`);
  // A smaller room never grows a neighbour.
  const small = fisheye(12, 5, 400);
  for (let i = 0; i < 12; i += 1) if (i !== 5) assert.ok(small[i].height <= atFive[i].height + 0.01);
});

test('fisheye: one card fills the room; slivers overlap', () => {
  const one = P().fisheye(1, 0, 500);
  assert.equal(one[0].height, 500);
  const many = P().fisheye(20, 10, 700);
  assert.ok(many[0].height === 10 && many[1].top === 8, 'slivers stack 2px over');
});

test('focalFor is the inverse of fisheye', () => {
  const { fisheye, focalFor } = P();
  const room = 700;
  for (const i of [0, 3, 6, 11]) {
    for (const top of [0, 40, 120, 300, 520]) {
      const focal = focalFor(i, top, 12, room);
      const placed = fisheye(12, focal, room)[i].top;
      assert.ok(Math.abs(placed - top) < 0.5 || focal === 0 || focal === 11, `card ${i} wanted ${top} got ${placed} (focal ${focal})`);
    }
  }
});

test('stepSpring settles; damping .8 overshoots and damping 1 does not', () => {
  const { stepSpring } = P();
  const run = (damping) => {
    let s = { x: 0, v: 8 };
    let max = 0;
    for (let t = 0; t < 400 && !s.settled; t += 1) {
      s = stepSpring(s, 1, 1 / 120, { damping, response: 0.4 });
      max = Math.max(max, s.x);
    }
    return { s, max };
  };
  const crit = run(1);
  assert.ok(crit.s.settled && Math.abs(crit.s.x - 1) < 0.001);
  assert.ok(crit.max <= 1.02, `critical overshoot ${crit.max}`);
  const bouncy = run(0.8);
  assert.ok(bouncy.s.settled && bouncy.max > 1.02, `bouncy max ${bouncy.max}`);
});

test('project is zero at rest and follows the sign of velocity', () => {
  assert.equal(P().project(0), 0);
  assert.ok(P().project(300) > 0 && P().project(-300) < 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/agent-phone.test.js`
Expected: the five new tests FAIL (`fisheye is not a function`).

- [ ] **Step 3: Implement** — insert before the `globalThis.marbleAgentPhone = …` line and extend the export

```js
  // ------------------------------------------------------------ the fisheye
  //
  // One scalar, `focal`, lays out the whole column. A card's tier is its
  // distance from focal: 0 full, 1 digest, 2 chip, 3+ sliver, linear between.
  // The Full takes whatever the neighbours leave, so heights always sum to
  // the room and a smaller room only ever shrinks the Full.

  const TIERS = { full: null, digest: 112, chip: 44, sliver: 10 };
  const SLIVER_OVERLAP = 2;
  const LADDER = [TIERS.digest, TIERS.chip, TIERS.sliver]; // heights at d = 1, 2, 3

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Height of a neighbour at distance d (d > 0), before the Full is sized. */
  const neighbourHeight = (d) => {
    if (d >= 3) return TIERS.sliver;
    if (d <= 1) return TIERS.digest;
    const lo = Math.floor(d);
    const t = d - lo;
    return LADDER[lo - 1] + (LADDER[lo] - LADDER[lo - 1]) * t;
  };

  const lodOf = (d) => (d < 0.5 ? 'full' : d < 1.5 ? 'digest' : d < 2.5 ? 'chip' : 'sliver');

  function fisheye(count, focal, room) {
    if (!count) return [];
    const f = clamp(focal, 0, count - 1);
    const lo = Math.floor(f);
    const hi = Math.min(count - 1, lo + 1);
    const t = f - lo;
    // Between two integers the Full is shared: card lo holds (1 - t) of the
    // full share and card hi holds t of it. Everything else is a neighbour.
    const heights = new Array(count);
    let used = 0;
    for (let i = 0; i < count; i += 1) {
      const d = Math.abs(i - f);
      if (i === lo || i === hi) continue;
      heights[i] = neighbourHeight(d);
      used += heights[i];
    }
    // The two cards nearest focal blend between full and digest.
    const nearLo = neighbourHeight(Math.max(1, Math.abs(lo - f) + 1)); // what lo would be as a neighbour at d≈1
    const nearHi = neighbourHeight(Math.max(1, Math.abs(hi - f) + 1));
    let full = room - used;
    if (lo === hi) {
      heights[lo] = Math.max(TIERS.digest, full);
    } else {
      // The pair together always occupies full + digest; t decides the split.
      const pair = Math.max(TIERS.digest * 2, full);
      const share = pair - TIERS.digest;
      heights[lo] = TIERS.digest + share * (1 - t);
      heights[hi] = TIERS.digest + share * t;
      void nearLo; void nearHi;
    }
    // Slivers overlap so a run of them reads as a deck edge-on.
    const cards = [];
    let top = 0;
    for (let i = 0; i < count; i += 1) {
      const d = Math.abs(i - f);
      const lod = lodOf(d);
      const prevSliver = i > 0 && lodOf(Math.abs(i - 1 - f)) === 'sliver';
      if (lod === 'sliver' && prevSliver) top -= SLIVER_OVERLAP;
      cards.push({ top, height: heights[i], lod, d });
      top += heights[i];
    }
    // Overlaps freed a little room; give it to the Full so the column still
    // ends exactly at the bottom.
    const slack = room - top;
    if (slack !== 0) {
      const target = lo === hi ? lo : (t < 0.5 ? lo : hi);
      cards[target].height += slack;
      for (let i = target + 1; i < count; i += 1) cards[i].top += slack;
    }
    return cards;
  }

  /** The focal that puts card `index` at `top`. The layout is monotone in
   *  focal (moving focal down moves every card up), so bisect. */
  function focalFor(index, top, count, room) {
    if (count < 2) return 0;
    let lo = 0;
    let hi = count - 1;
    for (let n = 0; n < 40; n += 1) {
      const mid = (lo + hi) / 2;
      const placed = fisheye(count, mid, room)[index].top;
      if (placed > top) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ------------------------------------------------------------ the spring
  //
  // The desk's spring (agent-ui.js) is critically damped and lives on rAF.
  // This is the same integrator as a pure step, with the damping ratio as a
  // parameter, so a flick can overshoot and a tap cannot.

  const stepSpring = (state, target, dt, { damping = 1, response = 0.4 } = {}) => {
    const omega = (2 * Math.PI) / response;
    const step = Math.min(0.032, Math.max(0.0005, dt));
    let { x, v } = state;
    v += (-omega * omega * (x - target) - 2 * damping * omega * v) * step;
    x += v * step;
    const settled = Math.abs(x - target) < 0.0005 && Math.abs(v) < 0.01;
    return settled ? { x: target, v: 0, settled: true } : { x, v, settled: false };
  };

  /** Where a released gesture would come to rest (Apple's projection). */
  const project = (velocity, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);
```

and change the export line to:

```js
  globalThis.marbleAgentPhone = { bandOf, bandCompare, askLead, peekOf, TIERS, SLIVER_OVERLAP, fisheye, focalFor, stepSpring, project };
```

Then delete the two `nearLo` / `nearHi` lines and the `void` line — they were scaffolding and the split rule does not need them.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/agent-phone.test.js`
Expected: 9 passing. If the continuity test fails, check `neighbourHeight` at `d` just above 1 (should be 112) and that the pair rule hands `share` linearly.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-phone.js test/agent-phone.test.js
git commit -m "The fisheye: one scalar lays Focus out as a column, with its inverse and a spring step that can overshoot.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 3: The runner remembers open asks; the hub announces them

**Files:**
- Modify: `server/agent/runner.js:457` (the `case 'ask'` in `handle`), `:508` (`voidAsks`), `:706` (`answer`), `:685` (the returned object)
- Modify: `server/agent/hub.js`
- Modify: `server/agent/index.js:137` (pass `hub.publishAsk`)
- Test: `test/agent-hub.test.js`, `test/agent-runner.test.js`

**Interfaces:**
- Produces `runner.openAsks() → [{ conversation, turn, requestId, request, since }]` where `request` is the stored ask event `{ requestId, tool, displayName, input, kind, interactive }`.
- Produces `hub.publishAsk(kind, payload)`: writes `event: ask` or `event: ask.resolved` to every `*` listener.
- Runner option `publishAsk` (function), optional.

- [ ] **Step 1: Failing hub test** (append to `test/agent-hub.test.js`; mirror its existing fake-`res` pattern — read the top of the file for the `fakeRes` helper it uses and reuse it)

```js
test('publishAsk writes ask and ask.resolved to the summary listeners only', () => {
  const hub = createHub();
  const all = fakeRes();
  const one = fakeRes();
  hub.subscribe('*', all);
  hub.subscribe('abc', one);
  hub.publishAsk('ask', { conversation: 'abc', requestId: 'r1' });
  hub.publishAsk('ask.resolved', { conversation: 'abc', requestId: 'r1' });
  assert.match(all.written, /event: ask\ndata: {"conversation":"abc","requestId":"r1"}/);
  assert.match(all.written, /event: ask\.resolved\n/);
  assert.equal(one.written, '');
  hub.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/agent-hub.test.js`
Expected: FAIL — `hub.publishAsk is not a function`.

- [ ] **Step 3: Hub** — add beside `publishFolders`:

```js
  /** An ask opened or closed somewhere. Lists want to know without holding
   *  every conversation's stream. */
  function publishAsk(kind, payload) {
    for (const res of listeners.get('*') ?? []) {
      write(res, `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  }
```

and export it: `return { subscribe, publish, publishFolders, publishAsk, close() {…} }`.

- [ ] **Step 4: Failing runner test** (append to `test/agent-runner.test.js`; use the file's existing `boot`/fake-provider helpers — read its first 80 lines and the test at the `ask` script to copy the setup exactly)

```js
test('openAsks lists an open ask with its request, and forgets it once answered', async () => {
  const asks = [];
  const { runner, store, conv } = await bootWith({ publishAsk: (kind, payload) => asks.push({ kind, ...payload }) });
  await runner.send(conv.id, { prompt: 'script:permission', context: CONTEXT });
  const ask = await until(async () => (await store.events(conv.id)).find((e) => e.type === 'ask'));
  const open = runner.openAsks();
  assert.equal(open.length, 1);
  assert.equal(open[0].conversation, conv.id);
  assert.equal(open[0].requestId, ask.requestId);
  assert.equal(open[0].request.tool, 'Bash');
  assert.equal(open[0].request.kind, 'permission');
  assert.ok(open[0].since > 0);
  assert.deepEqual(asks.map((a) => a.kind), ['ask']);
  await runner.answer(`${conv.id}-t1`, ask.requestId, { behavior: 'allow' });
  assert.equal(runner.openAsks().length, 0);
  assert.deepEqual(asks.map((a) => a.kind), ['ask', 'ask.resolved']);
});
```

`bootWith` is whatever the file already uses to create a runner with a `permission` script; if it is named differently, use that name and pass `publishAsk` through its options.

- [ ] **Step 5: Run to verify failure**

Run: `node --test test/agent-runner.test.js`
Expected: FAIL — `runner.openAsks is not a function`.

- [ ] **Step 6: Runner**

In `createRunner`'s options add `publishAsk = () => {}`.

`case 'ask'` becomes:

```js
      case 'ask': {
        const kind = event.tool === 'AskUserQuestion' ? 'question' : 'permission';
        const request = { ...event, kind };
        turn.asks.set(event.requestId, { closed: false, request, since: Date.now() });
        turn.holdStall?.();
        chained(turn.conversationId, () => store.updateConversation(turn.conversationId, { asking: true }))
          .then(async () => {
            await emit(turn, request);
            publishAsk('ask', { conversation: turn.conversationId, turn: turn.id, requestId: event.requestId, request, since: turn.asks.get(event.requestId)?.since ?? Date.now() });
          })
          .catch((err) => log.error(`[agents] ${err.message}`));
        return;
      }
```

In `voidAsks`, after `await emit(turn, { type: 'ask.void', requestId, why });` add:

```js
      publishAsk('ask.resolved', { conversation: turn.conversationId, requestId });
```

In `answer`, after `await emit(turn, { type: 'ask.answered', requestId, response });` add:

```js
      publishAsk('ask.resolved', { conversation: turn.conversationId, requestId });
```

On the returned object add:

```js
    /** Every ask a running turn is waiting on, across conversations. Derived
     *  from the live turns; nothing is stored for it. */
    openAsks: () => {
      const out = [];
      for (const turn of live.values()) {
        for (const [requestId, ask] of turn.asks) {
          if (ask.closed) continue;
          out.push({ conversation: turn.conversationId, turn: turn.id, requestId, request: ask.request, since: ask.since });
        }
      }
      return out.sort((a, b) => a.since - b.since);
    },
```

In `server/agent/index.js` pass `publishAsk: hub.publishAsk,` next to `publish: hub.publish,`.

- [ ] **Step 7: Run**

Run: `node --test test/agent-hub.test.js test/agent-runner.test.js`
Expected: all passing.

- [ ] **Step 8: Commit**

```bash
git add server/agent/runner.js server/agent/hub.js server/agent/index.js test/agent-hub.test.js test/agent-runner.test.js
git commit -m "The runner keeps each open ask's request, and the summary stream hears an ask open and close.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 4: `GET /agent/asks`, and the carrier's `agent.asks()`

**Files:**
- Modify: `server/agent/routes.js:196` (add the route beside `/agent/usage`)
- Modify: `runtime/agent.js:91-105` (listen for `ask` events on `*`), `:140` (add `asks`)
- Modify: `runtime/agent.js` — inject `runtime/agent-phone.js`? No — that is the host's job; see Task 6.
- Test: `test/agent-http.test.js`

**Interfaces:**
- Produces route `GET /agent/asks → { asks: [{ conversation, turn, requestId, request, since, lead, title, target }] }`.
- Produces `marble.agent.asks()`; `marble.agent.on('*', fn)` now also delivers `{ kind: 'ask', conversation, turn, requestId, request, since }` and `{ kind: 'ask.resolved', conversation, requestId }`.

- [ ] **Step 1: Failing HTTP test** (append to `test/agent-http.test.js`, after the existing `POST /agent/turns/:id/answer` test at line 699; reuse its `api`, `until`, `drive` helpers)

```js
test('GET /agent/asks lists open asks with a lead, and the * stream announces them', async () => {
  const heard = [];
  const stream = await openStream('/agent/events?all=1', (name, data) => heard.push({ name, data }));
  const conv = (await api('POST', '/agent/conversations', { provider: 'fake' })).body;
  await api('POST', `/agent/conversations/${conv.id}/turns`, { prompt: 'script:permission', context: { target: 'garden' } });
  const ask = await until(async () => (await drive.agents.store.events(conv.id)).find((e) => e.type === 'ask'));
  const listed = (await api('GET', '/agent/asks')).body.asks;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].conversation, conv.id);
  assert.equal(listed[0].requestId, ask.requestId);
  assert.equal(listed[0].request.kind, 'permission');
  assert.ok(Array.isArray(listed[0].lead));
  assert.equal(listed[0].title, 'script:permission');
  await until(() => heard.some((h) => h.name === 'ask'));
  await api('POST', `/agent/turns/${conv.id}-t1/answer`, { requestId: ask.requestId, response: { behavior: 'allow' } });
  await until(() => heard.some((h) => h.name === 'ask.resolved'));
  assert.equal((await api('GET', '/agent/asks')).body.asks.length, 0);
  stream.close();
});
```

`openStream` — if the file has no SSE helper, add one above the tests:

```js
const openStream = (route, onEvent) => new Promise((resolve) => {
  const req = http.get(`${base}${route}`, { headers: { Accept: 'text/event-stream' } }, (res) => {
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const name = /^event: (.+)$/m.exec(frame)?.[1] ?? 'message';
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (data) onEvent(name, JSON.parse(data));
      }
    });
    resolve({ close: () => req.destroy() });
  });
});
```

(`base` is whatever the file calls the server's URL; match it.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/agent-http.test.js`
Expected: the new test FAILS with status 404 on `/agent/asks`.

- [ ] **Step 3: Route** — insert after the `/agent/usage/history` block:

```js
    if (route === '/agent/asks' && method === 'GET') {
      const open = runner.openAsks();
      const asks = await Promise.all(open.map(async (ask) => {
        const [events, meta] = await Promise.all([store.events(ask.conversation), store.conversation(ask.conversation)]);
        const stored = events.find((e) => e.type === 'ask' && e.requestId === ask.requestId);
        return {
          ...ask,
          lead: stored ? askLead(events, stored.seq) : [],
          title: meta?.title ?? '',
          target: meta?.target ?? '',
        };
      }));
      return json(res, 200, { asks });
    }
```

The route module cannot import the browser IIFE, so add a small server-side twin at the top of `routes.js`:

```js
const LEAD_TYPES = new Set(['text', 'tool.call']);
/** The last two things the agent said or did before it asked. Mirrors
 *  runtime/agent-phone.js askLead; the page has that copy, the route this one. */
const askLead = (events, askSeq) => events
  .filter((event) => event.seq < askSeq && LEAD_TYPES.has(event.type))
  .slice(-2)
  .map((event) => (event.type === 'text'
    ? { type: 'text', text: String(event.text ?? '') }
    : { type: 'tool.call', name: event.name, input: event.input ?? {} }));
```

- [ ] **Step 4: Carrier** — in `runtime/agent.js` `on()`, the `*` branch becomes:

```js
        if (key === '*') {
          entry.source.addEventListener('summary', deliver);
          entry.source.addEventListener('folders', deliver);
          for (const kind of ['ask', 'ask.resolved']) {
            entry.source.addEventListener(kind, (message) => {
              let data;
              try { data = JSON.parse(message.data); } catch { return; }
              for (const handler of [...current.handlers]) handler({ kind, ...data });
            });
          }
        } else entry.source.onmessage = deliver;
```

and add to the `agent` object next to `usage`:

```js
      asks: () => ask('/agent/asks'),
```

- [ ] **Step 5: Run**

Run: `node --test test/agent-http.test.js`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add server/agent/routes.js runtime/agent.js test/agent-http.test.js
git commit -m "GET /agent/asks: every open ask across conversations, with what the agent said just before; the carrier hears them on the summary stream.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 5: `agent-ui.js` — the ask card as a builder, `damping` on the spring, the phone density

**Files:**
- Modify: `runtime/agent-ui.js:233` (`spring`), `:3374-3505` (`ask()`), `:1222-1230` (chrome CSS), `:4973` (exports)
- Test: `test-browser/conversation.test.js` (existing ask tests must still pass)

**Interfaces:**
- Produces `window.marbleAgentUI.buildAskCard(event, submit) → HTMLElement` — the `.ask` card; `submit(response)` is called with the built response.
- Produces `window.marbleAgentUI.ASK_CSS` — the `.ask…` rules, for a light-DOM host.
- `spring({ …, damping = 1 })`.
- `:host([data-chrome="phone"])` density.

- [ ] **Step 1: Spring damping** — change the integrator line in `spring` to

```js
  function spring({ from, to, velocity = 0, response = 0.34, damping = 1, onFrame, onDone }) {
    …
      v += (-omega * omega * (x - to) - 2 * damping * omega * v) * dt;
```

- [ ] **Step 2: Extract the ask card.** Move the body of `ask(turn, event)` from `const card = h('div', 'ask');` through the `else { … }` permission branch into a module-level function placed just above `toolLabel` (line ~1062):

```js
  /** The card a process's ask becomes: a permission prompt with Allow / Deny
   *  and a note, or a question's numbered options with Other…. `submit` gets
   *  the built response; whoever owns the card decides where it goes. */
  function buildAskCard(event, submit) {
    const card = h('div', 'ask');
    card.dataset.request = event.requestId;
    card.dataset.kind = event.kind;
    // …the existing body, verbatim, with `submit` in place of the inner
    // `submit` closure that called this.api.answer…
    return card;
  }
```

`ask()` becomes:

```js
    ask(turn, event) {
      const submit = async (response) => {
        for (const b of card.querySelectorAll('button')) b.disabled = true;
        try {
          await this.api.answer(turn, event.requestId, response);
        } catch (err) {
          for (const b of card.querySelectorAll('button')) b.disabled = false;
          this.system(err.message, true);
        }
      };
      const card = buildAskCard(event, submit);
      this.record(turn).asks.set(event.requestId, card);
      this.append(turn, card);
      card.querySelector('button')?.focus({ preventScroll: true });
    }
```

- [ ] **Step 3: Lift the ask CSS.** Find every rule in `CONVERSATION_CSS` whose selector starts with `.ask` (grep `^\s*\.ask` inside the template string; also `.deny-note`, `.ask-actions`, `.ask-options`, `.ask-other`, `.ask-other-text`, `.ask-q`, `.ask-title`). Cut them into a module-level `const ASK_CSS = \`…\`;` defined above `CONVERSATION_CSS`, and put `${ASK_CSS}` back where they were inside `CONVERSATION_CSS`.

- [ ] **Step 4: Phone density** — after the `tile` rules:

```js
    /* A phone shows one conversation, full screen. The mast folds to a line,
       the transcript takes the width, and type is the size a thumb reads. */
    :host([data-chrome="phone"]) .mast { padding: 6px 14px 6px; gap: 2px; }
    :host([data-chrome="phone"]) .heading { font-size: 15px; }
    :host([data-chrome="phone"]) .log { padding: 8px 14px 12px; font-size: 17px; line-height: 1.45; }
    :host([data-chrome="phone"]) .composer { padding: 6px 10px calc(8px + env(safe-area-inset-bottom, 0px)); }
    :host([data-chrome="phone"]) .msg { max-width: none; }
```

- [ ] **Step 5: Export** — extend the `window.marbleAgentUI = { … }` line with `buildAskCard, ASK_CSS`.

- [ ] **Step 6: Run the existing ask tests**

Run: `node --test --test-concurrency=1 test-browser/conversation.test.js`
Expected: passing, including `a permission ask shows a card, and Allow answers it` and both question tests.

- [ ] **Step 7: Commit**

```bash
git add runtime/agent-ui.js
git commit -m "The ask card is a builder any host can draw; the spring takes a damping ratio; a phone density for one conversation full screen.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 6: Inject `agent-phone.js`; the fifth view exists; the phone defaults to it

**Files:**
- Modify: `server/app.js` (wherever `agent-folders.js` is injected — grep `agent-folders`), and any list of runtime scripts in `server/agent/index.js`
- Modify: `templates/agents.mrbl:1305-1310` (`VIEW_ORDER`, `restoreView`), `:1163-1168` (view buttons), `:118-121` (view CSS), `:5279` (`setView`)
- Test: `test-browser/agents-phone.test.js` (new), `test-browser/agents-page.test.js` (V cycle, if asserted — grep `'v'` there)

**Interfaces:**
- `VIEW_ORDER = ['library', 'board', 'folders', 'focus', 'deck']`.
- `body[data-view="deck"]`; a `.deck` shell (empty until Task 7).
- `body[data-phone]` is set when `narrowView.matches`.

- [ ] **Step 1: Failing browser test** — create `test-browser/agents-phone.test.js` from the head of `agents-focus.test.js` (same `sourceOfAgents`, `startDrive`, `openAgents`), with `openAgents` defaulting to `viewport: { width: 393, height: 852 }` and the Playwright context created with `hasTouch: true, isMobile: true`. `harness.newPage` does not take those yet — extend it: `newPage({ viewport, reducedMotion, colorScheme, hasTouch = false, isMobile = false })` passing them to `browser.newContext`. Then:

```js
test('at phone width, Deck is the default view; a stored view wins', async () => {
  const { page } = await openAgents();
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-view')), 'deck');
  assert.equal(await page.evaluate(() => document.body.hasAttribute('data-phone')), true);
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'library'));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-view')), 'library');
});

test('V cycles through five views and comes back', async () => {
  const { page } = await openAgents({ viewport: { width: 1280, height: 800 } });
  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('v');
    seen.push(await page.evaluate(() => document.body.getAttribute('data-view')));
  }
  assert.deepEqual(seen, ['board', 'folders', 'focus', 'deck', 'library']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test --test-concurrency=1 test-browser/agents-phone.test.js`
Expected: FAIL — `data-view` is `library` at phone width.

- [ ] **Step 3: Inject the script.** Find where the host injects `runtime/agent-folders.js` (grep `agent-folders` in `server/`) and add `runtime/agent-phone.js` beside it, same transient marking. Also add it to the browser harness if the harness lists runtime scripts explicitly (grep `agent-folders` in `test-browser/harness.js`).

- [ ] **Step 4: Template — the view**

Markup: add a fifth button after Focus in `.seg.views`:

```html
      <button type="button" data-view="deck" aria-pressed="false" data-marble-id="__ID__">Deck</button>
```

and a shell after `.focus`:

```html
<div class="deck" data-marble-id="__ID__" data-marble-transient></div>
```

CSS at line 118: add `body[data-view="deck"] .views [data-view="deck"]` to the pressed-thumb rule; add to the hide rules:

```css
  body[data-view="deck"] .library, body[data-view="deck"] .board,
  body[data-view="deck"] .folders, body[data-view="deck"] .focus { display: none; }
  body:not([data-view="deck"]) .deck { display: none; }
  body[data-view="deck"] .deck { display: block; overflow-y: auto; }
```

JS:

```js
    const VIEW_ORDER = ['library', 'board', 'folders', 'focus', 'deck'];

    const restoreView = () => {
      const savedView = recalled(VIEW_KEY);
      if (VIEW_ORDER.includes(savedView)) document.body.setAttribute('data-view', savedView);
      else if (matchMedia('(max-width: 719px)').matches) document.body.setAttribute('data-view', 'deck');
      deriveView();
    };
```

`shellFor(view)`: add `if (view === 'deck') return deckEl;` with `const deckEl = $('.deck');` beside `focusEl`. In `setView`'s `applyLayout`, after `paintFocus();` add `paintDeck();` (a no-op function `const paintDeck = () => {};` for now — Task 7 fills it). In `place()`, before the `view === 'board'` branch, add:

```js
      if (view === 'deck') {
        placeInDeck(el, summary);
        return;
      }
```

with `const placeInDeck = () => {};` as a stub until Task 7.

Phone flag: beside `narrowView`:

```js
    const syncPhone = () => document.body.toggleAttribute('data-phone', narrowView.matches);
    syncPhone();
    narrowView.addEventListener('change', syncPhone);
```

- [ ] **Step 5: Run**

Run: `node --test --test-concurrency=1 test-browser/agents-phone.test.js test-browser/agents-page.test.js test-browser/agents-transitions.test.js`
Expected: passing. If a transitions test asserts the four-view cycle, update its expectation to five.

- [ ] **Step 6: Commit**

```bash
git add server test-browser/harness.js test-browser/agents-phone.test.js templates/agents.mrbl
git commit -m "A fifth view, Deck, in the cycle and the bar; a phone with no stored view opens on it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 7: Deck — bands, rows, ask cards

**Files:**
- Modify: `templates/agents.mrbl` — CSS (new block after the Focus rules), the `.deck` shell markup, `placeInDeck`, `paintDeck`, the `*` handler at `:5590`, `load()` at `:5368`
- Test: `test-browser/agents-phone.test.js`

**Interfaces:**
- Consumes `marbleAgentPhone.bandOf / bandCompare / peekOf`, `marbleAgentUI.buildAskCard / ASK_CSS`, `agent.asks()`, `on('*')` ask payloads (Task 4).
- Produces: `.deck > section.band[data-band]` with `h2.band-head` and `.band-body`; ask cards `.deck-ask[data-request]` inside `[data-band="asks"] .band-body`; `.conv` rows reused inside the other bands.

- [ ] **Step 1: Failing tests** (append to `agents-phone.test.js`; `scripts` for the harness need the `permission` script — pass `scripts: { permission: [{ ask: { tool: 'Bash', input: { command: 'rm -rf build' } } }, { say: 'after' }] }` to `startDrive`)

```js
test('Deck bands: an asking conversation is a card in NEEDS YOU with a peek; Allow answers it optimistically', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  const card = page.locator('.deck [data-band="asks"] .deck-ask');
  await card.waitFor();
  assert.match(await card.locator('.deck-ask-title').textContent(), /script:permission|Untitled/);
  assert.match(await card.locator('.deck-peek').textContent(), /rm -rf build/);
  assert.match(await page.locator('.deck [data-band="asks"] .band-count').textContent(), /1/);
  await card.locator('button.allow').click();
  // Gone on tap, before the answer lands.
  assert.equal(await page.locator('.deck-ask').count(), 0);
  await page.locator(`.deck [data-band]:not([data-band="asks"]) .conv[data-id="${id}"]`).waitFor();
});

test('Deck bands: running, review and idle rows land in their bands with counts', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    return [a, b];
  });
  await host.drive.agents.store.updateConversation(ids[0], { running: true, activity: 'reading' });
  await host.drive.agents.store.updateConversation(ids[1], { lastOutcome: 'failed', lastFinishedAt: Date.now(), activity: 'boom' });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.deck .conv').length >= 2);
  assert.equal(await page.locator(`[data-band="running"] .conv[data-id="${ids[0]}"]`).count(), 1);
  assert.equal(await page.locator(`[data-band="review"] .conv[data-id="${ids[1]}"]`).count(), 1);
  assert.equal((await page.locator('[data-band="running"] .band-count').textContent()).trim(), '1');
  assert.equal(await page.evaluate(() => document.querySelector('[data-band="idle"]').hasAttribute('data-collapsed')), true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test --test-concurrency=1 test-browser/agents-phone.test.js`
Expected: the two new tests FAIL (no `.band`).

- [ ] **Step 3: Markup** — replace the `.deck` shell with

```html
<div class="deck" data-marble-id="__ID__">
  <section class="band" data-band="asks" data-marble-id="__ID__">
    <h2 class="band-head" data-marble-id="__ID__"><button type="button" class="band-toggle" aria-expanded="true" data-marble-id="__ID__">Needs you<span class="band-count" data-marble-transient></span></button></h2>
    <div class="band-body asks-rail" data-marble-transient></div>
  </section>
  <section class="band" data-band="running" data-marble-id="__ID__">
    <h2 class="band-head" data-marble-id="__ID__"><button type="button" class="band-toggle" aria-expanded="true" data-marble-id="__ID__">Running<span class="band-count" data-marble-transient></span></button></h2>
    <div class="band-body" role="list" data-marble-transient></div>
  </section>
  <section class="band" data-band="review" data-marble-id="__ID__">
    <h2 class="band-head" data-marble-id="__ID__"><button type="button" class="band-toggle" aria-expanded="true" data-marble-id="__ID__">Review<span class="band-count" data-marble-transient></span></button></h2>
    <div class="band-body" role="list" data-marble-transient></div>
  </section>
  <section class="band" data-band="idle" data-collapsed data-marble-id="__ID__">
    <h2 class="band-head" data-marble-id="__ID__"><button type="button" class="band-toggle" aria-expanded="false" data-marble-id="__ID__">Idle<span class="band-count" data-marble-transient></span></button></h2>
    <div class="band-body" role="list" data-marble-transient></div>
  </section>
</div>
```

- [ ] **Step 4: CSS** — a new `<style>` block is not needed; add to the main stylesheet after the Focus rules:

```css
  /* ---- Deck: what wants you, in order. Bands are a partition of the same
     summaries every other view draws; nothing here is stored. */
  .deck { padding: 0 0 6rem; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; touch-action: pan-y; }
  .band { border-bottom: 1px solid var(--line); }
  .band-head { margin: 0; font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
  .band-toggle { display: flex; align-items: center; gap: .5rem; width: 100%; min-height: 2.75rem; padding: 0 1rem; font: inherit; color: inherit; background: none; border: 0; text-align: left; cursor: pointer; }
  .band-toggle::after { content: '▾'; margin-left: auto; transition: transform var(--t) var(--settle); }
  .band[data-collapsed] .band-toggle::after { transform: rotate(-90deg); }
  .band[data-collapsed] .band-body { display: none; }
  .band-count { font-variant-numeric: tabular-nums; color: var(--ink); }
  .band-count:empty { display: none; }
  .band[data-band="asks"] .band-count { color: var(--danger); }
  .band[data-band="asks"]:not(:has(.deck-ask)) { display: none; }
  .band-head[data-flash] { animation: band-flash 300ms var(--ease-out); }
  @keyframes band-flash { from { background: var(--paper-2); } to { background: transparent; } }
  /* Rows in a band are List rows with the leading colour and a taller hit. */
  .deck .conv { margin: 0; border-radius: 0; border-left-width: 2px; min-height: 3.5rem; }
  .deck .band-body[role="list"]:empty::before { content: 'Nothing here'; display: block; padding: .5rem 1rem 1rem; color: var(--faint); font-size: .85rem; }
  /* Ask cards page sideways, one per screen. */
  .asks-rail { display: flex; gap: .75rem; padding: .25rem 1rem 1rem; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .asks-rail::-webkit-scrollbar { display: none; }
  .deck-ask { flex: 0 0 calc(100% - 1rem); scroll-snap-align: center; border: 1px solid var(--line); border-radius: var(--pane-r); background: var(--card); box-shadow: var(--shadow); padding: .85rem 1rem 1rem; display: flex; flex-direction: column; gap: .5rem; }
  .deck-ask-head { display: flex; align-items: center; gap: .5rem; min-width: 0; }
  .deck-ask-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .deck-ask-target { font-size: .8rem; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .deck-peek { border-left: 2px solid var(--line); padding: .25rem .6rem; font-size: .82rem; color: var(--muted); display: grid; gap: .15rem; }
  .deck-peek .peek-lead { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .deck-peek pre { margin: 0; font-size: .78rem; white-space: pre-wrap; word-break: break-word; color: var(--ink); max-height: 8.5em; overflow: hidden; }
  .deck-ask .ask { margin: 0; border: 0; padding: 0; background: none; box-shadow: none; }
  .deck-ask .ask-actions { margin-top: .35rem; }
  .deck-ask .ask-actions button, .deck-ask .ask-options button, .deck-ask .ask-other-text { min-height: 2.75rem; font-size: 1rem; }
  .deck-ask .ask-actions .allow, .deck-ask .ask-actions .deny { flex: 1 1 0; }
  .deck-ask-open { align-self: flex-end; font: inherit; font-size: .85rem; color: var(--accent-ink); background: none; border: 0; padding: .4rem .2rem; cursor: pointer; }
```

Also, since `buildAskCard`'s CSS lives in `marbleAgentUI.ASK_CSS`, inject it once into the page beside the existing `stateStyle` injection at `:5585`: `stateStyle.textContent = … + (window.marbleAgentUI?.ASK_CSS ?? '')`, scoped with a `.deck-ask ` prefix is not possible in a string — instead the ASK_CSS selectors (`.ask`, `.ask-actions`, …) are class-based and harmless in light DOM; append as-is.

- [ ] **Step 5: JS** — replace the two stubs and add the ask state:

```js
    // ---- Deck. Rows are the same .conv elements List draws, placed by band;
    // asks are cards keyed by request, built by the drawer's own builder.
    const deckEl = $('.deck');
    const asksRail = deckEl?.querySelector('.asks-rail');
    const openAsks = new Map(); // requestId → { ask, card }
    const BAND_KEY = 'marble-agents:bands';
    const phone = () => window.marbleAgentPhone;

    const bandBody = (band) => deckEl?.querySelector(`.band[data-band="${band}"] .band-body`);

    const placeInDeck = (el, summary) => {
      const band = phone()?.bandOf(summary) ?? null;
      if (!band || band === 'asks') {
        // An asking conversation is its ask card; the row waits in its next band.
        if (band === 'asks') {
          const under = summary.running ? 'running' : 'idle';
          placeInBand(el, summary, under);
          return;
        }
        el.remove();
        return;
      }
      placeInBand(el, summary, band);
    };

    const placeInBand = (el, summary, band) => {
      const body = bandBody(band);
      if (!body) return;
      const cmp = phone().bandCompare(band);
      const siblings = [...body.querySelectorAll(':scope > .conv')].filter((n) => n !== el);
      const before = siblings.find((n) => cmp(summary, summaries.get(n.dataset.id) ?? {}) < 0);
      if (before) body.insertBefore(el, before);
      else body.append(el);
    };

    const paintBandCounts = () => {
      for (const band of deckEl?.querySelectorAll('.band') ?? []) {
        const n = band.dataset.band === 'asks'
          ? band.querySelectorAll('.deck-ask').length
          : band.querySelectorAll('.band-body > .conv:not([hidden])').length;
        band.querySelector('.band-count').textContent = n ? String(n) : '';
      }
    };

    const restoreBands = () => {
      let saved = {};
      try { saved = JSON.parse(recalled(BAND_KEY) || '{}'); } catch { saved = {}; }
      for (const band of deckEl?.querySelectorAll('.band') ?? []) {
        const collapsed = band.dataset.band in saved ? Boolean(saved[band.dataset.band]) : band.dataset.band === 'idle';
        band.toggleAttribute('data-collapsed', collapsed);
        band.querySelector('.band-toggle').setAttribute('aria-expanded', String(!collapsed));
      }
    };
    const rememberBands = () => {
      const state = {};
      for (const band of deckEl?.querySelectorAll('.band') ?? []) state[band.dataset.band] = band.hasAttribute('data-collapsed');
      remember(BAND_KEY, JSON.stringify(state));
    };
    deckEl?.addEventListener('click', (event) => {
      const toggle = event.target.closest('.band-toggle');
      if (!toggle) return;
      const band = toggle.closest('.band');
      band.toggleAttribute('data-collapsed');
      toggle.setAttribute('aria-expanded', String(!band.hasAttribute('data-collapsed')));
      rememberBands();
    });

    const flashBand = (band) => {
      const head = deckEl?.querySelector(`.band[data-band="${band}"] .band-head`);
      if (!head) return;
      head.removeAttribute('data-flash');
      void head.offsetWidth;
      head.setAttribute('data-flash', '');
    };

    const buildDeckAsk = (ask) => {
      const helpers = window.marbleAgentUI;
      const peek = phone().peekOf(ask.request);
      const summary = summaries.get(ask.conversation);
      const card = document.createElement('article');
      card.className = 'deck-ask';
      card.dataset.request = ask.requestId;
      card.dataset.conversation = ask.conversation;
      const head = document.createElement('div');
      head.className = 'deck-ask-head';
      head.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="deck-ask-title"></span>';
      head.querySelector('.deck-ask-title').textContent = summary?.title || ask.title || 'Untitled';
      const target = document.createElement('div');
      target.className = 'deck-ask-target';
      target.textContent = tailOfTarget(summary?.target || ask.target || '');
      const peekEl = document.createElement('div');
      peekEl.className = 'deck-peek';
      for (const lead of ask.lead ?? []) {
        const line = document.createElement('div');
        line.className = 'peek-lead';
        line.textContent = lead.type === 'text' ? lead.text : `${lead.name} ${lead.input?.file_path ?? lead.input?.command ?? lead.input?.pattern ?? ''}`.trim();
        peekEl.append(line);
      }
      if (peek.detail || peek.lines.length) {
        const pre = document.createElement('pre');
        pre.textContent = [peek.detail, ...peek.lines].filter(Boolean).join('\n');
        peekEl.append(pre);
      }
      const submit = async (response) => {
        // Optimistic: the card leaves now and comes back with a line if the
        // answer is lost.
        removeDeckAsk(ask.requestId);
        try {
          await agent.answer(ask.turn, ask.requestId, response);
        } catch (err) {
          const back = buildDeckAsk(ask);
          const note = document.createElement('div');
          note.className = 'deck-ask-target';
          note.textContent = `Not sent: ${err.message}`;
          back.prepend(note);
          addDeckAsk(ask, back);
        }
      };
      const askCard = helpers.buildAskCard(ask.request, submit);
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'deck-ask-open';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', () => open(ask.conversation));
      card.append(head, target, peekEl, askCard, openBtn);
      return card;
    };

    const addDeckAsk = (ask, card = buildDeckAsk(ask)) => {
      if (!asksRail) return;
      const existing = openAsks.get(ask.requestId);
      existing?.card.remove();
      openAsks.set(ask.requestId, { ask, card });
      asksRail.append(card);
      const band = asksRail.closest('.band');
      if (existing == null) {
        if (band.hasAttribute('data-collapsed') && openAsks.size === 1) {
          band.removeAttribute('data-collapsed');
          band.querySelector('.band-toggle').setAttribute('aria-expanded', 'true');
        } else flashBand('asks');
      }
      paintBandCounts();
    };

    const removeDeckAsk = (requestId) => {
      const entry = openAsks.get(requestId);
      if (!entry) return;
      entry.card.remove();
      openAsks.delete(requestId);
      paintBandCounts();
    };

    const loadAsks = async () => {
      if (!agent?.asks) return;
      try {
        const { asks } = await agent.asks();
        const seen = new Set(asks.map((a) => a.requestId));
        for (const id of [...openAsks.keys()]) if (!seen.has(id)) removeDeckAsk(id);
        for (const ask of asks) if (!openAsks.has(ask.requestId)) addDeckAsk(ask);
      } catch { /* the host predates the route; the rows still say Needs you */ }
    };

    const paintDeck = () => {
      if ((document.body.getAttribute('data-view') || 'library') !== 'deck') return;
      for (const el of nodes.values()) place(el);
      paintBandCounts();
    };
```

In `placeAll`, after `paintColumnCounts();` add `paintBandCounts();`. In the `*` handler, before `if (!payload?.id) return;` add:

```js
          if (payload?.kind === 'ask') {
            addDeckAsk({ ...payload, lead: payload.lead ?? [] });
            return;
          }
          if (payload?.kind === 'ask.resolved') {
            removeDeckAsk(payload.requestId);
            return;
          }
```

In `load()`, after the summaries loop, add `await loadAsks();`. Call `restoreBands();` once at boot, next to `restoreView()`. When a summary arrives whose band changed, `place()` already re-slots the row on `upsert` → make sure `upsert` calls `place(el)` (it does today for list/board — verify by reading `upsert` to its end; if it calls `place`, nothing to do).

- [ ] **Step 6: Run**

Run: `node --test --test-concurrency=1 test-browser/agents-phone.test.js`
Expected: passing. The first test's `Allow` click removes the card synchronously before the fetch resolves.

- [ ] **Step 7: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-phone.test.js test-browser/harness.js
git commit -m "Deck: four bands of the same rows, and every open ask as a card you can answer without opening anything.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 8: Deck gestures — swipe to review, reveal Undo, long-press for actions

**Files:**
- Modify: `templates/agents.mrbl` (Deck JS from Task 7; the `.conv` creation in `upsert` at `:5129`)
- Test: `test-browser/agents-phone.test.js`

**Interfaces:**
- Produces `openActions(id)` → shows the actions sheet (Task 9 builds the sheet; this task calls a stub `const openActions = () => {};`).
- Produces on a `.conv` in a Deck band: `data-swipe="review" | "undo"` during a gesture; a `.swipe-undo` button behind the row.

- [ ] **Step 1: Failing test**

```js
test('a REVIEW row swiped right is marked reviewed; swiped left it reveals Undo and does not undo', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await host.drive.agents.store.updateConversation(id, { lastOutcome: 'changes', lastFinishedAt: Date.now(), activity: 'done' });
  await page.reload();
  const row = page.locator(`[data-band="review"] .conv[data-id="${id}"]`);
  await row.waitFor();
  const box = await row.boundingBox();
  const y = box.y + box.height / 2;
  // Left: reveal.
  await page.mouse.move(box.x + 300, y);
  await page.mouse.down();
  for (let x = 300; x > 160; x -= 20) await page.mouse.move(box.x + x, y);
  await page.mouse.up();
  await page.locator(`.conv[data-id="${id}"] .swipe-undo`).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate((id) => document.querySelector(`.conv[data-id="${id}"]`).closest('.band').dataset.band, id), 'review');
  // Right: reviewed.
  await page.mouse.move(box.x + 40, y);
  await page.mouse.down();
  for (let x = 40; x < 220; x += 20) await page.mouse.move(box.x + x, y);
  await page.mouse.up();
  await page.locator(`[data-band="idle"] .conv[data-id="${id}"]`).waitFor();
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — no `.swipe-undo`.

- [ ] **Step 3: Implement** — in `upsert`, after the `innerHTML` for a new row, append the undo affordance and the gesture:

```js
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'swipe-undo';
        undoBtn.textContent = 'Undo turn';
        undoBtn.setAttribute('data-marble-transient', '');
        undoBtn.addEventListener('click', async (event) => {
          event.stopPropagation();
          el.removeAttribute('data-swipe');
          el.style.transform = '';
          try {
            const { turns } = await agent.conversation(el.dataset.id);
            const last = [...turns].reverse().find((t) => t.status === 'completed' && !t.undoneAt);
            if (last) await agent.undo(last.id);
          } catch (err) { showEmpty(err.message); }
        });
        el.append(undoBtn);
        attachDeckGestures(el);
```

and the gesture module (near the Deck JS):

```js
    // ---- Deck gestures. A cheap, reversible action completes as a swipe;
    // a consequential one is revealed by a swipe and taken by a button.
    const SWIPE_COMMIT = 96;
    const SWIPE_REVEAL = 88;
    const LONG_PRESS_MS = 400;
    const attachDeckGestures = (el) => {
      let start = null;
      let axis = null;
      let pressTimer = 0;
      let dx = 0;
      let history = [];
      const inDeck = () => el.closest('.band-body') != null;
      const settle = (to, velocity = 0) => {
        const from = dx;
        if (reduceMotion.matches) { el.style.transform = to ? `translateX(${to}px)` : ''; dx = to; return; }
        window.marbleAgentUI.spring({ from, to, velocity, response: 0.3, onFrame: (x) => { dx = x; el.style.transform = x ? `translateX(${x}px)` : ''; } });
      };
      el.addEventListener('pointerdown', (event) => {
        if (!inDeck() || event.target.closest('.manage, .swipe-undo')) return;
        start = { x: event.clientX, y: event.clientY, id: event.pointerId };
        axis = null;
        history = [{ x: event.clientX, t: performance.now() }];
        pressTimer = setTimeout(() => { pressTimer = 0; start = null; openActions(el.dataset.id); }, LONG_PRESS_MS);
      });
      el.addEventListener('pointermove', (event) => {
        if (!start) return;
        const mx = event.clientX - start.x;
        const my = event.clientY - start.y;
        if (!axis) {
          if (Math.hypot(mx, my) < 10) return;
          clearTimeout(pressTimer); pressTimer = 0;
          axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
          if (axis === 'x') el.setPointerCapture(start.id);
          else { start = null; return; }
        }
        event.preventDefault();
        suppressConvClick = true;
        const band = el.closest('.band')?.dataset.band;
        const canRight = band === 'review';
        const canLeft = band === 'review' || band === 'idle';
        let x = mx;
        if ((x > 0 && !canRight) || (x < 0 && !canLeft)) x = x * 0.25;
        dx = x;
        el.style.transform = `translateX(${x}px)`;
        el.dataset.swipe = x > 0 ? 'review' : 'undo';
        history.push({ x: event.clientX, t: performance.now() });
        if (history.length > 6) history.shift();
      });
      const end = (event) => {
        clearTimeout(pressTimer); pressTimer = 0;
        if (!start) return;
        const was = start; start = null;
        if (axis !== 'x') return;
        try { el.releasePointerCapture(was.id); } catch { /* not captured */ }
        setTimeout(() => { suppressConvClick = false; }, 0);
        const first = history[0]; const last = history[history.length - 1];
        const velocity = last.t > first.t ? ((last.x - first.x) / (last.t - first.t)) * 1000 : 0;
        const projected = dx + window.marbleAgentUI.project(velocity);
        if (projected > SWIPE_COMMIT && el.closest('.band')?.dataset.band === 'review') {
          const id = el.dataset.id;
          const summary = summaries.get(id);
          if (summary) upsert({ ...summary, needsReview: false }); // optimistic
          settle(0, velocity);
          el.removeAttribute('data-swipe');
          agent.markReviewed(id).catch(() => upsert({ ...summary, needsReview: true }));
          return;
        }
        if (projected < -SWIPE_REVEAL) { settle(-SWIPE_REVEAL - 8, velocity); el.dataset.swipe = 'undo'; return; }
        settle(0, velocity);
        el.removeAttribute('data-swipe');
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('click', () => { if (dx) { settle(0); el.removeAttribute('data-swipe'); } }, true);
    };
    const openActions = (id) => {}; // Task 9
```

CSS:

```css
  .deck .conv { position: relative; touch-action: pan-y; will-change: transform; background: var(--paper); }
  .deck .conv .swipe-undo { display: none; position: absolute; right: 0; top: 0; bottom: 0; width: 88px; border: 0; background: var(--caution); color: #fff; font: inherit; font-weight: 600; transform: translateX(100%); }
  .deck .conv[data-swipe="undo"] .swipe-undo { display: block; }
  .deck .conv[data-swipe="review"]::before { content: 'Reviewed'; position: absolute; left: -100%; top: 0; bottom: 0; width: 100%; display: flex; align-items: center; justify-content: flex-end; padding-right: 1rem; background: var(--accent-soft); color: var(--accent-ink); font-size: .8rem; }
```

`reduceMotion` — the template already has `const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')` (grep it; if named differently, use that).

- [ ] **Step 4: Run**

Run: `node --test --test-concurrency=1 test-browser/agents-phone.test.js`
Expected: passing.

- [ ] **Step 5: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-phone.test.js
git commit -m "Deck rows: a swipe marks reviewed, a swipe the other way only reveals Undo, and a long press asks what to do.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 9: Sheets — actions, new conversation, fleet

**Files:**
- Modify: `templates/agents.mrbl` (markup after `.deck`; CSS; JS replacing the `openActions` stub)
- Test: `test-browser/agents-phone.test.js`

**Interfaces:**
- Produces `openSheet(kind, { id })` / `closeSheet()`; kinds `'actions' | 'new' | 'fleet'`; `body[data-sheet]` while one is open.
- Markup `<div class="sheet-scrim">` and `<section class="sheet" role="dialog">` with `.sheet-grip`, `.sheet-body`.

- [ ] **Step 1: Failing test**

```js
test('long-press on a row opens the actions sheet; dragging it down past the sill closes it', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await page.reload();
  const row = page.locator(`.deck .conv[data-id="${id}"]`);
  await row.waitFor();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 100, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  const sheet = page.locator('.sheet[data-kind="actions"]');
  await sheet.waitFor({ state: 'visible' });
  assert.ok(await sheet.locator('button', { hasText: 'Archive' }).count());
  const sb = await sheet.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 12);
  await page.mouse.down();
  for (let y = 12; y < 260; y += 24) await page.mouse.move(sb.x + sb.width / 2, sb.y + y);
  await page.mouse.up();
  await page.waitForFunction(() => !document.body.hasAttribute('data-sheet'));
});

test('the new-conversation sheet starts a conversation in the chosen project and opens it', async () => {
  const { page } = await openAgents();
  await page.locator('.thumb-new').click();
  const sheet = page.locator('.sheet[data-kind="new"]');
  await sheet.waitFor({ state: 'visible' });
  await sheet.locator('.sheet-prompt').fill('script:rename');
  await sheet.locator('button.sheet-start').click();
  await page.waitForFunction(() => document.body.hasAttribute('data-open'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.deck .conv').length), 1);
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — no `.sheet`.

- [ ] **Step 3: Markup** (after `.deck`; the thumb bar is Task 10 but the New button is needed now, so add the bar's shell here):

```html
<div class="thumb" data-marble-id="__ID__">
  <button type="button" class="thumb-field" data-marble-id="__ID__">Say something…</button>
  <button type="button" class="thumb-new" aria-label="New conversation" data-marble-id="__ID__">+</button>
</div>
<div class="sheet-scrim" data-marble-transient hidden></div>
<section class="sheet" role="dialog" aria-modal="true" data-marble-transient hidden>
  <div class="sheet-grip" aria-hidden="true"></div>
  <div class="sheet-body"></div>
</section>
```

- [ ] **Step 4: CSS**

```css
  /* ---- Sheets. A bottom sheet tracks the finger from where it was grabbed,
     rubber-bands past the top, and commits by the sign of its velocity. */
  .sheet-scrim { position: fixed; inset: 0; background: rgba(0,0,0,.28); z-index: 40; opacity: 0; transition: opacity 200ms var(--ease-out); }
  .sheet-scrim[hidden] { display: none; }
  body[data-sheet] .sheet-scrim { opacity: 1; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 41; background: var(--paper); border-radius: var(--pane-r) var(--pane-r) 0 0; box-shadow: var(--shadow-lift); padding: 0 1rem calc(1rem + env(safe-area-inset-bottom, 0px)); max-height: 80vh; overflow-y: auto; transform: translateY(100%); touch-action: none; will-change: transform; }
  .sheet[hidden] { display: none; }
  .sheet-grip { width: 36px; height: 4px; border-radius: 2px; background: var(--line); margin: 8px auto 12px; }
  .sheet-body { display: grid; gap: .5rem; }
  .sheet-body h3 { margin: .25rem 0 .5rem; font-size: 1rem; }
  .sheet-body .sheet-row { display: flex; align-items: center; gap: .6rem; width: 100%; min-height: 2.75rem; padding: 0 .75rem; font: inherit; font-size: 1rem; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 10px; text-align: left; cursor: pointer; }
  .sheet-body .sheet-row:active { background: var(--paper-2); }
  .sheet-body .sheet-row[data-tone="danger"] { color: var(--danger); }
  .sheet-prompt { min-height: 5.5rem; font: inherit; font-size: 17px; line-height: 1.45; padding: .6rem .75rem; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--ink); resize: none; }
  .sheet-start { min-height: 2.75rem; font: inherit; font-size: 1rem; font-weight: 600; color: #fff; background: var(--accent-ink); border: 0; border-radius: 10px; }
  .sheet-start:active { transform: scale(.97); transition: transform 100ms ease-out; }
  .sheet-seg { display: flex; gap: .35rem; flex-wrap: wrap; }
  .sheet-seg button { min-height: 2.5rem; padding: 0 .8rem; font: inherit; border: 1px solid var(--line); border-radius: 999px; background: var(--card); color: var(--ink); }
  .sheet-seg button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); }
  .fleet-meters { display: grid; gap: .5rem; }
  body[data-sheet] .deck, body[data-sheet] .focus, body[data-sheet] .library { transform: scale(.96); transition: transform 200ms var(--ease-out); transform-origin: 50% 0; }
  @media (prefers-reduced-motion: reduce) {
    .sheet { transition: opacity 150ms linear; transform: none !important; }
    body[data-sheet] .deck, body[data-sheet] .focus, body[data-sheet] .library { transform: none; }
  }
```

- [ ] **Step 5: JS** — replace the `openActions` stub:

```js
    // ---- Sheets.
    const sheetEl = $('.sheet');
    const scrimEl = $('.sheet-scrim');
    const sheetBody = sheetEl?.querySelector('.sheet-body');
    let sheetY = 0;
    let sheetStop = null;
    const sheetHeight = () => sheetEl?.getBoundingClientRect().height || 1;
    const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
    const placeSheet = (y) => { sheetY = y; if (sheetEl) sheetEl.style.transform = `translateY(${y}px)`; };
    const springSheet = (to, velocity, done) => {
      sheetStop?.();
      if (reduceMotion.matches) { placeSheet(to); done?.(); return; }
      sheetStop = window.marbleAgentUI.spring({ from: sheetY, to, velocity, response: 0.3, damping: 0.8, onFrame: (y) => placeSheet(y), onDone: done });
    };
    const closeSheet = (velocity = 0) => {
      if (!sheetEl || sheetEl.hidden) return;
      document.body.removeAttribute('data-sheet');
      springSheet(sheetHeight(), velocity, () => { sheetEl.hidden = true; scrimEl.hidden = true; sheetBody.replaceChildren(); });
    };
    const openSheet = (kind, fill) => {
      if (!sheetEl) return;
      sheetBody.replaceChildren();
      sheetEl.dataset.kind = kind;
      fill(sheetBody);
      sheetEl.hidden = false;
      scrimEl.hidden = false;
      placeSheet(sheetHeight());
      requestAnimationFrame(() => { document.body.setAttribute('data-sheet', kind); springSheet(0, 0); });
    };
    scrimEl?.addEventListener('click', () => closeSheet());
    // Drag the sheet from anywhere on it that is not a control.
    (() => {
      let grab = null;
      let history = [];
      sheetEl?.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button, input, textarea, select')) return;
        sheetStop?.();
        grab = { y: event.clientY, at: sheetY, id: event.pointerId };
        history = [{ y: event.clientY, t: performance.now() }];
        sheetEl.setPointerCapture(event.pointerId);
      });
      sheetEl?.addEventListener('pointermove', (event) => {
        if (!grab) return;
        const raw = grab.at + (event.clientY - grab.y);
        placeSheet(raw < 0 ? rubberband(raw, sheetHeight()) : raw);
        history.push({ y: event.clientY, t: performance.now() });
        if (history.length > 6) history.shift();
      });
      const release = () => {
        if (!grab) return;
        grab = null;
        const a = history[0]; const b = history[history.length - 1];
        const velocity = b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0;
        if (velocity > 40 || (Math.abs(velocity) <= 40 && sheetY > sheetHeight() * 0.5)) closeSheet(velocity);
        else springSheet(0, velocity);
      };
      sheetEl?.addEventListener('pointerup', release);
      sheetEl?.addEventListener('pointercancel', release);
    })();

    const sheetRow = (label, onTap, tone) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sheet-row';
      if (tone) b.dataset.tone = tone;
      b.textContent = label;
      b.addEventListener('click', async () => { closeSheet(); try { await onTap(); } catch (err) { showEmpty(err.message); } });
      return b;
    };

    const runningTurnOf = async (id) => {
      const { turns } = await agent.conversation(id);
      return turns.find((t) => t.status === 'running' || t.status === 'queued') ?? null;
    };

    const openActions = (id) => {
      const summary = summaries.get(id);
      if (!summary || !agent) return;
      openSheet('actions', (body) => {
        const h3 = document.createElement('h3');
        h3.textContent = summary.title || 'Untitled';
        body.append(h3);
        if (statusOf(summary) === 'running') {
          body.append(sheetRow('Stop', async () => { const t = await runningTurnOf(id); if (t) await agent.cancel(t.id); }, 'danger'));
        }
        body.append(sheetRow('Open', () => open(id)));
        if (summary.needsReview) body.append(sheetRow('Mark reviewed', () => agent.markReviewed(id)));
        body.append(sheetRow(summary.archived ? 'Unarchive' : 'Archive', () => agent.archive(id, !summary.archived)));
        if (folderCatalog.length) {
          for (const folder of folderCatalog) {
            if (folder.id === summary.folderId) continue;
            body.append(sheetRow(`Move to ${folder.name}`, () => agent.update(id, { folderId: folder.id })));
          }
          if (summary.folderId) body.append(sheetRow('Remove from folder', () => agent.update(id, { folderId: null })));
        }
        for (const provider of [...labels.values()].filter((p) => p.installed && p.signedIn && p.id !== summary.provider)) {
          body.append(sheetRow(`Continue in ${provider.label}`, async () => open(await agent.handoff(id, provider.id))));
        }
      });
    };

    const openNewSheet = (text = '') => {
      if (!agent) return;
      openSheet('new', async (body) => {
        const h3 = document.createElement('h3');
        h3.textContent = 'New conversation';
        const projects = document.createElement('div');
        projects.className = 'sheet-seg';
        projects.setAttribute('role', 'group');
        projects.setAttribute('aria-label', 'Project');
        const setups = document.createElement('div');
        setups.className = 'sheet-seg';
        setups.setAttribute('role', 'group');
        setups.setAttribute('aria-label', 'Agent');
        const prompt = document.createElement('textarea');
        prompt.className = 'sheet-prompt';
        prompt.placeholder = 'What should it do?';
        prompt.value = text;
        const start = document.createElement('button');
        start.type = 'button';
        start.className = 'sheet-start';
        start.textContent = 'Start';
        body.append(h3, projects, setups, prompt, start);
        let projectId = 'drive';
        let providerId = null;
        const seg = (parent, items, chosen, onPick) => {
          parent.replaceChildren();
          for (const item of items) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = item.label;
            b.setAttribute('aria-pressed', String(item.id === chosen));
            b.addEventListener('click', () => { onPick(item.id); seg(parent, items, item.id, onPick); });
            parent.append(b);
          }
        };
        try {
          const listed = await agent.projects();
          const rows = (listed.projects ?? listed ?? []).map((p) => ({ id: p.id, label: p.name ?? p.id }));
          projectId = listed.defaultProject ?? rows[0]?.id ?? 'drive';
          seg(projects, rows.length ? rows : [{ id: 'drive', label: 'Drive' }], projectId, (id) => { projectId = id; });
        } catch { seg(projects, [{ id: 'drive', label: 'Drive' }], 'drive', () => {}); }
        if (!labels.size) { try { for (const p of await agent.providers()) labels.set(p.id, p); } catch { /* none */ } }
        const ready = [...labels.values()].filter((p) => p.installed && p.signedIn);
        providerId = (ready.find((p) => p.default) ?? ready[0])?.id ?? null;
        seg(setups, ready.map((p) => ({ id: p.id, label: p.label })), providerId, (id) => { providerId = id; });
        start.addEventListener('click', async () => {
          if (!providerId) return;
          const words = prompt.value.trim();
          closeSheet();
          try {
            const id = await agent.start({ provider: providerId, project: projectId });
            await open(id);
            if (words) await agent.send(id, { prompt: words });
          } catch (err) { showEmpty(err.message); }
        });
        prompt.focus();
      });
    };

    const openFleetSheet = () => {
      openSheet('fleet', async (body) => {
        const h3 = document.createElement('h3');
        h3.textContent = 'Fleet';
        const meters = document.createElement('div');
        meters.className = 'fleet-meters';
        body.append(h3, meters);
        try {
          const usage = await agent.usage();
          window.marbleAgentUI?.fillMeters?.(meters, usage, { detail: true });
        } catch { meters.textContent = 'Usage unavailable'; }
        const running = [...summaries.values()].filter((s) => statusOf(s) === 'running');
        if (running.length) {
          body.append(sheetRow(`Stop all running (${running.length})`, async () => {
            for (const s of running) { const t = await runningTurnOf(s.id); if (t) await agent.cancel(t.id); }
          }, 'danger'));
        }
      });
    };

    $('.thumb-new')?.addEventListener('click', () => openNewSheet());
    $('.thumb-field')?.addEventListener('click', () => openNewSheet());
```

`fillMeters`'s real signature is whatever the template's usage code calls today (grep `fillMeters(` in the template and pass the same arguments; if it takes `(container, meters)` use that and drop the options).

- [ ] **Step 6: Run**

Run: `node --test --test-concurrency=1 test-browser/agents-phone.test.js`
Expected: passing.

- [ ] **Step 7: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-phone.test.js
git commit -m "Three sheets that track the finger: what to do with a conversation, how to start one, and the fleet.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 10: Phone chrome — topbar, thumb bar, materials, install meta, keyboard

**Files:**
- Modify: `templates/agents.mrbl:1-10` (head), `:1097-1140` (the `(max-width: 719px)` block), topbar markup `:1160-1245`, JS near `syncPhone`
- Test: `test-browser/agents-phone.test.js`

**Interfaces:**
- Produces `--vv-h` on `:root`; `.topbar .asks-pill`, `.topbar .usage-dot`, `.topbar .more` under phone width.
- Produces `openMore()` — a sheet listing Filter, Settings, and the views.

- [ ] **Step 1: Failing test**

```js
test('phone chrome: one-row topbar with an asks pill, a thumb bar with 44pt controls, safe-area padding, and --vv-h', async () => {
  const { page } = await openAgents();
  const top = await page.locator('.topbar').boundingBox();
  assert.ok(top.height <= 60, `topbar ${top.height}`);
  assert.equal(await page.locator('.topbar .more').isVisible(), true);
  assert.equal(await page.locator('.topbar .toggles').isVisible(), false);
  const thumb = await page.locator('.thumb').boundingBox();
  assert.ok(thumb.y + thumb.height >= 852 - 1);
  for (const sel of ['.thumb-new', '.thumb-field', '.band-toggle']) {
    const box = await page.locator(sel).first().boundingBox();
    assert.ok(box.height >= 44, `${sel} is ${box.height}`);
  }
  const vv = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vv-h').trim());
  assert.match(vv, /^\d+px$/);
  assert.equal(await page.evaluate(() => document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content), 'yes');
  assert.match(await page.evaluate(() => document.querySelector('meta[name="viewport"]').content), /viewport-fit=cover/);
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL on `.topbar .more`.

- [ ] **Step 3: Head**

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Agents">
<link rel="apple-touch-icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E%3Crect width='180' height='180' rx='40' fill='%23fafaf7'/%3E%3Ccircle cx='62' cy='62' r='22' fill='%239bb6cf'/%3E%3Ccircle cx='118' cy='62' r='22' fill='%23738698'/%3E%3Ccircle cx='62' cy='118' r='22' fill='%23738698'/%3E%3Ccircle cx='118' cy='118' r='22' fill='%239bb6cf'/%3E%3C/svg%3E">
```

(The tiled mark, four marbles, in the accent tones; the favicon builder in `server/favicon.js` draws the same figure — read it and match its geometry if it differs.)

- [ ] **Step 4: Topbar markup** — inside `.topbar`, after `.new`, add:

```html
  <button type="button" class="asks-pill" hidden aria-label="Open asks" data-marble-id="__ID__"><span class="dot" aria-hidden="true"></span><span class="asks-n" data-marble-transient></span></button>
  <button type="button" class="usage-dot" aria-label="Usage" data-marble-transient hidden></button>
  <button type="button" class="more" aria-label="More" aria-haspopup="dialog" data-marble-id="__ID__">⋯</button>
```

- [ ] **Step 5: CSS** — add to the `(max-width: 719px)` block, replacing its topbar rules:

```css
    :root { --vv-h: 100vh; --topbar-h: calc(2.75rem + env(safe-area-inset-top, 0px)); --thumb-h: calc(3.5rem + env(safe-area-inset-bottom, 0px)); }
    html, body { overscroll-behavior: none; }
    body { -webkit-tap-highlight-color: transparent; font-size: 17px; line-height: 1.45; }
    .topbar { position: sticky; top: 0; z-index: 30; flex-wrap: nowrap; align-items: center; gap: .5rem; height: var(--topbar-h); padding: env(safe-area-inset-top, 0px) .75rem 0 1rem; background: rgba(var(--paper-rgb), .72); -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%); border-bottom: 0; }
    .topbar::after { content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 12px; background: linear-gradient(rgba(var(--paper-rgb), .9), transparent); pointer-events: none; }
    .topbar h1 { order: 0; flex: 1 1 auto; min-width: 0; font-size: 1rem; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .topbar .toggles, .topbar .filterbox, .topbar .settings, .topbar .new, .topbar .usage { display: none; }
    .topbar .asks-pill { display: inline-flex; align-items: center; gap: .3rem; min-height: 2.25rem; padding: 0 .6rem; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--danger); font: inherit; font-size: .85rem; font-variant-numeric: tabular-nums; }
    .topbar .asks-pill[hidden] { display: none; }
    .topbar .asks-pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
    .topbar .usage-dot { width: 2.25rem; height: 2.25rem; border-radius: 50%; border: 0; background: conic-gradient(var(--tone, var(--accent)) calc(var(--used, 0) * 1%), var(--line) 0); padding: 0; position: relative; }
    .topbar .usage-dot::after { content: ''; position: absolute; inset: 5px; border-radius: 50%; background: var(--paper); }
    .topbar .usage-dot[hidden] { display: none; }
    .topbar .more { width: 2.75rem; height: 2.75rem; border: 0; background: none; font: inherit; font-size: 1.3rem; color: var(--ink); }
    .thumb { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; align-items: center; gap: .5rem; height: var(--thumb-h); padding: 0 .75rem env(safe-area-inset-bottom, 0px) 1rem; background: rgba(var(--paper-rgb), .72); -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%); border-top: 1px solid rgba(255,255,255,.4); }
    .thumb::before { content: ''; position: absolute; left: 0; right: 0; bottom: 100%; height: 12px; background: linear-gradient(transparent, rgba(var(--paper-rgb), .9)); pointer-events: none; }
    .thumb-field { flex: 1 1 auto; min-height: 2.75rem; text-align: left; font: inherit; color: var(--faint); background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 0 1rem; }
    .thumb-new { width: 2.75rem; height: 2.75rem; border-radius: 50%; border: 0; background: var(--accent-ink); color: #fff; font: inherit; font-size: 1.4rem; line-height: 1; }
    .thumb-new:active, .thumb-field:active { transform: scale(.97); transition: transform 100ms ease-out; }
    body[data-open] .thumb, body[data-view="focus"] .thumb { display: none; }
    body:not([data-view="deck"]):not([data-view="focus"]) .thumb { display: none; }
    @media (prefers-reduced-transparency: reduce) { .topbar, .thumb { background: var(--paper); -webkit-backdrop-filter: none; backdrop-filter: none; } }
```

Outside the media query, so the desk never sees them: `.asks-pill, .usage-dot, .topbar .more, .thumb { display: none; }` placed **before** the media block (the block's rules then win under 719px).

- [ ] **Step 6: JS**

```js
    // ---- Phone chrome. The keyboard is just less room: the visual viewport
    // writes one variable and every phone layout reads it.
    const syncViewport = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--vv-h', `${Math.round(h)}px`);
      if (narrowView.matches && (document.body.getAttribute('data-view') || 'library') === 'focus') paintFocus({ quiet: true });
    };
    syncViewport();
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('scroll', syncViewport);
    addEventListener('resize', syncViewport);

    const asksPill = $('.asks-pill');
    const paintAsksPill = () => {
      if (!asksPill) return;
      const n = openAsks.size;
      asksPill.hidden = n === 0;
      asksPill.querySelector('.asks-n').textContent = n ? String(n) : '';
    };
    asksPill?.addEventListener('click', () => {
      setView('deck');
      const band = deckEl?.querySelector('.band[data-band="asks"]');
      band?.removeAttribute('data-collapsed');
      band?.scrollIntoView({ block: 'start', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    });

    const usageDot = $('.usage-dot');
    const paintUsageDot = (meters) => {
      if (!usageDot) return;
      const worst = (meters ?? []).filter((m) => Number.isFinite(m.used)).sort((a, b) => b.used - a.used)[0];
      usageDot.hidden = !worst;
      if (!worst) return;
      usageDot.style.setProperty('--used', String(worst.used));
      usageDot.style.setProperty('--tone', window.marbleAgentUI?.usageTone?.(worst.used) ?? 'var(--accent)');
      usageDot.title = `${worst.label} ${worst.used}%`;
    };
    usageDot?.addEventListener('click', () => openFleetSheet());

    const openMore = () => {
      openSheet('more', (body) => {
        const views = [['deck', 'Deck'], ['focus', 'Focus'], ['library', 'List'], ['board', 'Board'], ['folders', 'Folders']];
        for (const [view, label] of views) body.append(sheetRow(label, () => setView(view)));
        body.append(sheetRow('Filter', () => setFilterOpen(true, { focus: false })));
        body.append(sheetRow('Settings', () => agent?.openSettings?.()));
      });
    };
    $('.topbar .more')?.addEventListener('click', openMore);
    // The title stays editable — it is content — but on a phone a tap must
    // not raise a keyboard, so editing is a long press.
    (() => {
      const h1 = $('.topbar h1');
      if (!h1) return;
      let timer = 0;
      h1.addEventListener('pointerdown', () => { if (narrowView.matches) timer = setTimeout(() => h1.focus(), LONG_PRESS_MS); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) h1.addEventListener(ev, () => clearTimeout(timer));
      h1.addEventListener('mousedown', (e) => { if (narrowView.matches && e.pointerType !== 'mouse') e.preventDefault(); });
    })();
```

Call `paintAsksPill()` at the end of `addDeckAsk` and `removeDeckAsk`. Find where the template fills the `.usage` meters (grep `usage(` / `fillMeters` in the template) and call `paintUsageDot(meters)` with the same data there. `setFilterOpen` and `agent.openSettings` already exist (grep to confirm the names; use whatever the template uses for opening Settings — `openSettings(` — and the filter dialog).

- [ ] **Step 7: Run**

Run: `node --test --test-concurrency=1 test-browser/agents-phone.test.js test-browser/agents-page.test.js`
Expected: passing. `agents-page` still sees the desk topbar at 1280 wide.

- [ ] **Step 8: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-phone.test.js
git commit -m "Phone chrome: a one-row topbar and a thumb bar, both translucent, the keyboard as one variable, and the document declaring its own installability.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 11: One conversation full screen, and the edge swipe back

**Files:**
- Modify: `templates/agents.mrbl` — the `(max-width: 719px)` `.pane` rules, `applyDock` (grep `data-chrome` there), `open()`
- Test: `test-browser/agents-phone.test.js`

**Interfaces:**
- Under phone width with `body[data-open]`: `.pane` is `position: fixed; top: var(--topbar-h); bottom: 0`; `marble-conversation[data-chrome="phone"]`.

- [ ] **Step 1: Failing test**

```js
test('tapping a Deck row opens the conversation full screen at the phone density; an edge swipe goes back', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await page.reload();
  await page.locator(`.deck .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-open'));
  const pane = await page.locator('.pane').boundingBox();
  assert.ok(pane.width >= 392 && pane.height >= 700, `pane ${pane.width}x${pane.height}`);
  assert.equal(await page.evaluate(() => document.querySelector('marble-conversation').getAttribute('data-chrome')), 'phone');
  assert.equal(await page.locator('.deck').isVisible(), false);
  await page.mouse.move(6, 400);
  await page.mouse.down();
  for (let x = 6; x < 200; x += 16) await page.mouse.move(x, 400);
  await page.mouse.up();
  await page.waitForFunction(() => !document.body.hasAttribute('data-open'));
  assert.equal(await page.locator('.deck').isVisible(), true);
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — `data-chrome` is not `phone`, or the swipe does nothing.

- [ ] **Step 3: CSS** — in the phone block, replace the `body[data-open] .pane` rules:

```css
    body[data-open] .list, body[data-view="deck"][data-open] .deck { display: none; }
    body[data-open] .pane { display: grid; position: fixed; left: 0; right: 0; top: var(--topbar-h); height: calc(var(--vv-h) - var(--topbar-h)); min-height: 0; z-index: 20; background: var(--paper); will-change: transform; }
    body[data-view="deck"] .library { display: none; }
    body[data-view="deck"][data-open] .library { display: block; }
```

- [ ] **Step 4: JS** — where `applyDock` sets `data-chrome` on `convo` (grep `setAttribute('data-chrome'` in the template), make the phone win: `convo.setAttribute('data-chrome', narrowView.matches ? 'phone' : chrome)`. If it uses a variable per pane, apply the same rule to each. Add to `syncPhone` a call to `applyDock()` so a resize re-derives it.

Edge swipe:

```js
    // ---- Back by the edge. 1:1 from the left edge, commit by velocity sign.
    (() => {
      const EDGE = 24;
      let grab = null;
      let history = [];
      let stop = null;
      const place = (x) => { pane.style.transform = x ? `translateX(${x}px)` : ''; };
      pane?.addEventListener('pointerdown', (event) => {
        if (!narrowView.matches || !document.body.hasAttribute('data-open')) return;
        if (event.clientX > EDGE) return;
        stop?.();
        grab = { x: event.clientX, id: event.pointerId };
        history = [{ x: event.clientX, t: performance.now() }];
        pane.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      pane?.addEventListener('pointermove', (event) => {
        if (!grab) return;
        place(Math.max(0, event.clientX - grab.x));
        history.push({ x: event.clientX, t: performance.now() });
        if (history.length > 6) history.shift();
      });
      const release = () => {
        if (!grab) return;
        grab = null;
        const a = history[0]; const b = history[history.length - 1];
        const velocity = b.t > a.t ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0;
        const x = b.x - a.x;
        const w = pane.getBoundingClientRect().width;
        const leaving = velocity > 40 || (Math.abs(velocity) <= 40 && x > w * 0.4);
        const run = (to, done) => {
          if (reduceMotion.matches) { place(0); done?.(); return; }
          stop = window.marbleAgentUI.spring({ from: x, to, velocity, response: 0.35, onFrame: place, onDone: () => { place(0); done?.(); } });
        };
        if (leaving) run(w, () => open(null));
        else run(0);
      };
      pane?.addEventListener('pointerup', release);
      pane?.addEventListener('pointercancel', release);
    })();
```

The pane enters from the right: in `open(id)` when `narrowView.matches` and the body was not `data-open` before, after setting `data-open` run `pane.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })` unless `reduceMotion.matches` (then `[{ opacity: 0 }, { opacity: 1 }]`, 150 ms).

- [ ] **Step 5: Run**

Run: `node --test --test-concurrency=1 test-browser/agents-phone.test.js test-browser/agents-panes.test.js`
Expected: passing.

- [ ] **Step 6: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-phone.test.js
git commit -m "On a phone a conversation takes the screen, enters from the right, and leaves by the edge it came from.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 12: Focus on a phone — the fisheye

**Files:**
- Modify: `templates/agents.mrbl` — `paintFocus` `:3525` (the `data-stack` branch), `layoutFocusPane` `:2537`, CSS `:634-646` (`.focus[data-stack]`), the focus pointer handlers (grep `focusEl.addEventListener('pointerdown'`)
- Test: `test-browser/agents-phone.test.js`, `test-browser/probe.js`

**Interfaces:**
- Consumes `marbleAgentPhone.fisheye / focalFor / stepSpring / project`.
- Produces `.focus[data-phone]` with absolutely placed `.focus-card[data-lod]` (`sliver` included); `phoneFocal` state; the pane over the Full.

- [ ] **Step 1: Failing tests**

```js
const seedTwelve = async (page) => {
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const out = [];
    for (let i = 0; i < 12; i += 1) out.push(await agent.start({ provider: 'fake' }));
    return out;
  });
  for (const [i, id] of ids.entries()) await host.drive.agents.store.updateConversation(id, { title: `Chat ${i}`, target: `Research/${i}.mrbl`, activity: 'idle', createdAt: 1000 + i });
  return ids;
};

test('phone Focus: one Full, digests beside it, chips beyond, slivers at the ends; the pane overlays the Full', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await page.reload();
  await page.locator('.topbar .more').click();
  await page.locator('.sheet button', { hasText: 'Focus' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.focus[data-phone] .focus-card').length === 12);
  const lods = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].map((c) => c.dataset.lod));
  assert.equal(lods.filter((l) => l === 'full').length, 1);
  assert.ok(lods.includes('sliver'));
  const full = await page.locator('.focus-card[data-lod="full"]').boundingBox();
  const pane = await page.locator('.pane').boundingBox();
  assert.ok(Math.abs(full.y - pane.y) < 2 && Math.abs(full.height - pane.height) < 2, `pane ${pane.y}/${pane.height} vs full ${full.y}/${full.height}`);
  assert.ok(full.height > 300, `full is ${full.height}`);
});

test('phone Focus: dragging the stack keeps the grabbed card under the pointer, and a release snaps to one Full', async () => {
  const { page } = await openAgents();
  const ids = await seedTwelve(page);
  await page.reload();
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'focus'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.focus[data-phone] .focus-card').length === 12);
  const before = await page.evaluate(() => document.querySelector('.focus-card[data-lod="full"]').dataset.id);
  const digest = page.locator('.focus-card[data-lod="digest"]').last();
  const box = await digest.boundingBox();
  const grabY = box.y + 20;
  const offset = 20;
  await page.mouse.move(200, grabY);
  await page.mouse.down();
  const drift = [];
  for (let y = grabY; y > grabY - 220; y -= 20) {
    await page.mouse.move(200, y);
    const top = (await digest.boundingBox()).y;
    drift.push(Math.abs((y - offset) - top));
  }
  assert.ok(Math.max(...drift) < 4, `card drifted ${Math.max(...drift)}px`);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.focus-card[data-lod="full"]').length === 1 && !document.querySelector('.focus')?.hasAttribute('data-settling'));
  const after = await page.evaluate(() => document.querySelector('.focus-card[data-lod="full"]').dataset.id);
  assert.notEqual(after, before);
  assert.ok(ids.includes(after));
});

test('phone Focus: less room demotes the neighbours and keeps the Full', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await page.reload();
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'focus'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.focus[data-phone] .focus-card').length === 12);
  const tall = await page.evaluate(() => document.querySelectorAll('.focus-card[data-lod="digest"]').length);
  await page.setViewportSize({ width: 393, height: 500 });
  await page.waitForTimeout(100);
  const short = await page.evaluate(() => document.querySelectorAll('.focus-card[data-lod="digest"]').length);
  assert.ok(short <= tall);
  const full = await page.locator('.focus-card[data-lod="full"]').boundingBox();
  assert.ok(full.height >= 112);
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — `.focus[data-phone]` never appears.

- [ ] **Step 3: CSS** — replace the `.focus[data-stack]` rules with:

```css
  /* ---- Focus on a phone: one column, one scalar. A card's size is its
     distance from the one in your hand; the pane sits over the Full. */
  .focus[data-phone] { position: relative; overflow: hidden; height: calc(var(--vv-h) - var(--topbar-h)); touch-action: none; }
  .focus[data-phone] .focus-card { position: absolute; left: 0; right: 0; margin: 0 .75rem; width: auto; overflow: hidden; border-radius: 12px; transition: none; }
  .focus[data-phone] .focus-card[data-lod="sliver"] { border-radius: 4px 4px 0 0; box-shadow: 0 -1px 0 rgba(0,0,0,.06) inset; }
  .focus[data-phone] .focus-card[data-lod="sliver"] .focus-card-head,
  .focus[data-phone] .focus-card[data-lod="sliver"] .focus-card-body { opacity: 0; }
  .focus[data-phone] .focus-card[data-lod="chip"] .focus-card-body { display: none; }
  .focus[data-phone] .focus-card[data-lod="full"] .focus-card-body { opacity: .5; }
  .focus[data-phone] .focus-card-actions, .focus[data-phone] .focus-slot, .focus[data-phone] .focus-newgroup,
  .focus[data-phone] .focus-pinslot, .focus[data-phone] .focus-extent, .focus[data-phone] .focus-basin { display: none; }
  .focus[data-phone] .focus-card-head { min-height: 44px; }
  .focus[data-phone] .focus-card[data-color] { border-left: 2px solid var(--folder-color, var(--line)); }
```

`--folder-color` — the desk already colours cards by `data-color`; use whatever selector it uses (grep `.focus-card[data-color=`) rather than inventing a variable.

- [ ] **Step 4: JS** — in `paintFocus`, replace the `data-stack` handling:

```js
      if (narrowView.matches) focusEl.setAttribute('data-phone', '');
      else focusEl.removeAttribute('data-phone');
```

(keep `data-stack` for the mid width if `narrowView` is not the stack condition — it is the same query, so `data-stack` can go; remove its CSS.) Then replace the `if (focusEl.hasAttribute('data-stack') || narrowView.matches) { … return; }` block with:

```js
      if (narrowView.matches) {
        focusPack = null;
        sizeFocusExtent(null);
        paintFocusBasins(null);
        layoutPhoneFocus(items, opts);
        return;
      }
```

and add the phone Focus module beside the other Focus code:

```js
    // ---- Phone Focus. `phoneFocal` is a float index into the stack order.
    let phoneFocal = 0;
    let phoneOrder = [];
    let phoneStop = null;
    const phoneHelpers = () => window.marbleAgentPhone;

    const phoneStackOrder = (items) => focusColumnsOf(items, null).columns.flatMap((c) => c.ids);

    const phoneRoom = () => focusEl.clientHeight;

    const layoutPhoneFocus = (items, opts = {}) => {
      const order = phoneStackOrder(items);
      const changedOrder = order.join('|') !== phoneOrder.join('|');
      phoneOrder = order;
      if (!order.length) { hideFocusPane(); return; }
      if (changedOrder && !opts.keepFocal) {
        const want = openId && order.includes(openId) ? order.indexOf(openId) : Math.round(Math.min(phoneFocal, order.length - 1));
        phoneFocal = Math.max(0, want);
      }
      placePhoneStack();
    };

    const placePhoneStack = () => {
      const cards = phoneHelpers().fisheye(phoneOrder.length, phoneFocal, phoneRoom());
      let fullRect = null;
      phoneOrder.forEach((id, i) => {
        const card = focusEl.querySelector(`.focus-card[data-id="${id}"]`);
        if (!card) return;
        const c = cards[i];
        stopCardSpring(card);
        card.style.left = '';
        card.style.width = '';
        card.style.top = `${c.top}px`;
        card.style.height = `${c.height}px`;
        card.style.zIndex = c.lod === 'full' ? '3' : c.lod === 'sliver' ? '1' : '2';
        card.dataset.lod = c.lod;
        if (c.lod === 'full') fullRect = c;
      });
      layoutPhonePane(fullRect);
    };

    const layoutPhonePane = (rect) => {
      if (!pane) return;
      if (!rect) { hideFocusPane(); return; }
      const box = focusEl.getBoundingClientRect();
      pane.style.visibility = '';
      pane.style.display = 'grid';
      pane.style.position = 'fixed';
      pane.style.left = `${box.left + 12}px`;
      pane.style.top = `${box.top + rect.top}px`;
      pane.style.width = `${Math.max(0, box.width - 24)}px`;
      pane.style.height = `${Math.max(0, rect.height)}px`;
      pane.style.zIndex = '6';
      pane.style.borderRadius = '12px';
      pane.style.overflow = 'hidden';
      pane.style.pointerEvents = 'auto';
      applyDock();
      const id = phoneOrder[Math.round(phoneFocal)];
      if (id && convo.getAttribute('conversation') !== id && !focusEl.hasAttribute('data-settling')) retargetPhonePane(id);
    };

    const retargetPhonePane = (id) => {
      open(id);
      if (reduceMotion.matches) return;
      pane.animate([{ opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    };

    const settlePhone = (velocityCards) => {
      const n = phoneOrder.length;
      if (!n) return;
      const projected = phoneFocal + phoneHelpers().project(velocityCards);
      const target = Math.max(0, Math.min(n - 1, Math.round(projected)));
      const damping = Math.abs(projected - phoneFocal) >= 1 ? 0.8 : 1;
      focusEl.setAttribute('data-settling', '');
      phoneStop?.();
      if (reduceMotion.matches) {
        phoneFocal = target;
        focusEl.removeAttribute('data-settling');
        placePhoneStack();
        pane.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 150 });
        return;
      }
      let state = { x: phoneFocal, v: velocityCards };
      let last = performance.now();
      let frame = 0;
      const step = (now) => {
        state = phoneHelpers().stepSpring(state, target, (now - last) / 1000, { damping, response: 0.4 });
        last = now;
        phoneFocal = state.x;
        placePhoneStack();
        pane.style.opacity = String(1 - Math.min(1, 3 * Math.abs(phoneFocal - target)));
        if (state.settled) {
          focusEl.removeAttribute('data-settling');
          pane.style.opacity = '';
          placePhoneStack();
          return;
        }
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      phoneStop = () => cancelAnimationFrame(frame);
    };

    // The drag: the card you grabbed stays under your finger.
    (() => {
      let grab = null;
      let history = [];
      focusEl?.addEventListener('pointerdown', (event) => {
        if (!narrowView.matches) return;
        if (pane.contains(event.target)) return;
        const card = event.target.closest('.focus-card');
        phoneStop?.();
        focusEl.removeAttribute('data-settling');
        const index = card ? phoneOrder.indexOf(card.dataset.id) : Math.round(phoneFocal);
        const cardTop = card ? parseFloat(card.style.top) || 0 : 0;
        const y = event.clientY - focusEl.getBoundingClientRect().top;
        grab = { index, offset: y - cardTop, id: event.pointerId, startFocal: phoneFocal, moved: false, cardId: card?.dataset.id ?? null };
        history = [{ f: phoneFocal, t: performance.now() }];
        focusEl.setPointerCapture(event.pointerId);
      });
      focusEl?.addEventListener('pointermove', (event) => {
        if (!grab) return;
        const y = event.clientY - focusEl.getBoundingClientRect().top;
        const want = y - grab.offset;
        const next = phoneHelpers().focalFor(grab.index, want, phoneOrder.length, phoneRoom());
        if (!grab.moved && Math.abs(next - grab.startFocal) > 0.02) grab.moved = true;
        phoneFocal = next;
        placePhoneStack();
        pane.style.opacity = String(1 - Math.min(1, 3 * Math.abs(phoneFocal - grab.startFocal)));
        history.push({ f: phoneFocal, t: performance.now() });
        if (history.length > 6) history.shift();
      });
      const release = () => {
        if (!grab) return;
        const was = grab;
        grab = null;
        const a = history[0]; const b = history[history.length - 1];
        const velocity = b.t > a.t ? ((b.f - a.f) / (b.t - a.t)) * 1000 : 0;
        if (!was.moved && was.cardId) {
          // A tap: spring to that card.
          const index = phoneOrder.indexOf(was.cardId);
          if (index >= 0 && index !== Math.round(phoneFocal)) { phoneFocal += 0.001 * Math.sign(index - phoneFocal); settlePhoneTo(index); return; }
        }
        settlePhone(velocity);
      };
      focusEl?.addEventListener('pointerup', release);
      focusEl?.addEventListener('pointercancel', release);
    })();

    const settlePhoneTo = (index) => {
      focusEl.setAttribute('data-settling', '');
      phoneStop?.();
      if (reduceMotion.matches) { phoneFocal = index; focusEl.removeAttribute('data-settling'); placePhoneStack(); return; }
      let state = { x: phoneFocal, v: 0 };
      let last = performance.now();
      let frame = 0;
      const step = (now) => {
        state = phoneHelpers().stepSpring(state, index, (now - last) / 1000, { damping: 1, response: 0.4 });
        last = now;
        phoneFocal = state.x;
        placePhoneStack();
        pane.style.opacity = String(1 - Math.min(1, 3 * Math.abs(phoneFocal - index)));
        if (state.settled) { focusEl.removeAttribute('data-settling'); pane.style.opacity = ''; placePhoneStack(); return; }
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      phoneStop = () => cancelAnimationFrame(frame);
    };
```

`layoutFocusPane` must not fight this: at its top add `if (narrowView.matches) return;`. The desk's Focus pointer handlers (drag-to-region, selection) must bail when `narrowView.matches` — find `focusEl.addEventListener('pointerdown'` for the desk and add `if (narrowView.matches) return;` as its first line. In `syncViewport` (Task 10) the `paintFocus({ quiet: true })` call re-lays the stack; make `paintFocus` with `opts.quiet` under phone call `layoutPhoneFocus(items, { keepFocal: true })`.

Long-press on a card → `openActions(card.dataset.id)`: in the pointerdown above, start a 400 ms timer cleared on move/up, exactly as Task 8.

- [ ] **Step 5: Probe** — add to `test-browser/probe.js` a `--phone` flag that sets the viewport to 393 × 852, opens Focus, and prints each card's `{ id, lod, top, height }` plus the pane rect. Mirror its existing `--narrow` handling.

- [ ] **Step 6: Run**

Run: `node --test --test-concurrency=1 test-browser/agents-phone.test.js test-browser/agents-focus.test.js`
Expected: passing. The drift test tolerates 4 px (bisection error plus rounding).

- [ ] **Step 7: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-phone.test.js test-browser/probe.js
git commit -m "Focus on a phone is one column held by a scalar: the card in your hand is Full, its neighbours shrink with distance, and a flick lands where it was going.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 13: Live-ness on a radio — reconnect on visibility, shared ticker

**Files:**
- Modify: `runtime/agent.js` (`on()`), `templates/agents.mrbl` (boot)
- Test: `test-browser/agents-phone.test.js`

**Interfaces:**
- `marble.agent.suspend()` closes every stream and remembers the handlers; `marble.agent.resume()` reopens them and re-delivers nothing (the page resyncs by fetching).
- The page: on `visibilitychange` → hidden, `suspend()`; → visible, `resume()`, `load()`, `loadAsks()`.

- [ ] **Step 1: Failing test**

```js
test('going hidden closes the streams; coming back reopens them and resyncs', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await page.locator(`.deck .conv[data-id="${id}"]`).waitFor();
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => window.marble.agent.streamsOpen()), 0);
  await host.drive.agents.store.updateConversation(id, { title: 'Renamed while away' });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction((id) => document.querySelector(`.conv[data-id="${id}"] .title`)?.textContent === 'Renamed while away', id);
  assert.ok((await page.evaluate(() => window.marble.agent.streamsOpen())) >= 1);
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — `streamsOpen is not a function`.

- [ ] **Step 3: Carrier** — in `runtime/agent.js`, refactor `on()` so the `EventSource` creation is a function `openStream(key, entry)`; then:

```js
    let suspended = false;
    const openStream = (key, entry) => { /* the existing new EventSource + listeners, assigning entry.source */ };
    function suspend() {
      suspended = true;
      for (const entry of streams.values()) { entry.source?.close(); entry.source = null; }
    }
    function resume() {
      if (!suspended) return;
      suspended = false;
      for (const [key, entry] of streams) if (!entry.source) openStream(key, entry);
    }
    const streamsOpen = () => [...streams.values()].filter((e) => e.source).length;
```

`on()` calls `openStream` only when `!suspended`; the unsubscribe closes `entry.source` if present. Add `suspend, resume, streamsOpen` to the `agent` object.

- [ ] **Step 4: Page** — at boot, after `restoreDock()`:

```js
        document.addEventListener('visibilitychange', async () => {
          if (document.visibilityState === 'hidden') { api.suspend(); stopAgeTicker(); return; }
          api.resume();
          await load();
          await loadAsks();
          startAgeTicker();
        });
```

Ages: find the template's existing age repaint (grep `setInterval` near `age(`); wrap it as `startAgeTicker` / `stopAgeTicker` with one `setInterval(…, 1000)` that repaints `.age` in whichever view is showing. If none exists, add one that calls `paintRow(el, summary)` for visible rows every second only when `document.visibilityState === 'visible'`.

- [ ] **Step 5: Run**

Run: `node --test --test-concurrency=1 test-browser/agents-phone.test.js`
Expected: passing.

- [ ] **Step 6: Commit**

```bash
git add runtime/agent.js templates/agents.mrbl test-browser/agents-phone.test.js
git commit -m "A backgrounded page closes its streams and resyncs when it returns, so a phone never watches a dead stream.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

---

### Task 14: Reduced motion, touch targets, the seeing loop, docs, the live document

**Files:**
- Modify: `templates/agents.mrbl` (reduced-motion rules; `(hover: none)` heights)
- Modify: `test-browser/shots.js` (`--phone`)
- Modify: `docs/AGENTS.md`
- Modify: `drive/Agents.mrbl` (by hand, last)
- Test: `test-browser/agents-phone.test.js`

- [ ] **Step 1: Failing tests**

```js
test('reduced motion: a Focus step runs no transform animation', async () => {
  const { page } = await openAgents({ reducedMotion: 'reduce' });
  await seedTwelve(page);
  await page.reload();
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'focus'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.focus[data-phone] .focus-card').length === 12);
  await page.locator('.focus-card[data-lod="digest"]').first().click();
  const animating = await page.evaluate(() => document.getAnimations().some((a) => (a.effect?.getKeyframes?.() ?? []).some((k) => 'transform' in k)));
  assert.equal(animating, false);
});

test('every phone control is at least 44pt tall under hover: none', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await page.reload();
  await page.locator('.deck .conv').first().waitFor();
  const short = await page.evaluate(() => [...document.querySelectorAll('.topbar button, .thumb button, .band-toggle, .deck .conv')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => [el.className, el.getBoundingClientRect().height])
    .filter(([, h]) => h < 44));
  assert.deepEqual(short, []);
});
```

- [ ] **Step 2: Run to verify failure**, fix what fails: add to the phone block

```css
    @media (prefers-reduced-motion: reduce) {
      .focus[data-phone] .focus-card { transition: opacity 150ms linear; }
      .band-head[data-flash] { animation: none; }
    }
    @media (hover: none) { .topbar button, .thumb button, .band-toggle, .sheet-row { min-height: 2.75rem; } }
```

- [ ] **Step 3: shots** — in `test-browser/shots.js`, add `const phone = process.argv.includes('--phone');`, viewport `phone ? { width: 393, height: 852 }`, `hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 3 : 1` in `host.newPage` (extend the harness `newPage` to accept `deviceScaleFactor`), and when `phone`, shoot `deck` and `focus` (and `deck-open` after tapping the first row). `--keyboard` sets the viewport height to 852 − 336 before the Focus shot. Run it once and look:

Run: `node test-browser/shots.js /tmp/agent-shots --phone && open /tmp/agent-shots/deck.png /tmp/agent-shots/focus.png`

Read the two PNGs with the Read tool. Fix anything that reads as a squeeze rather than a design (overflowing text, a thumb bar over content, a pane not on its Full) before moving on.

- [ ] **Step 4: Docs** — in `docs/AGENTS.md`, the "The Agents document" section: five views (`V` cycles List → Board → Folders → Focus → Deck); a **Deck** paragraph (bands, ask cards with a peek, swipe to review, long-press actions, the asks pill); a **Focus on a phone** paragraph (one column, the fisheye, held not scrolled, the keyboard as less room); a **Phone** paragraph (installable from Safari's Share → Add to Home Screen; the topbar, thumb bar and sheets; what is not on the phone and why, from spec §6.5). In the routes list add `GET /agent/asks` and the `ask` / `ask.resolved` events on `/agent/events?all=1`.

- [ ] **Step 5: Full suites**

Run: `npm test && npm run test:browser`
Expected: all passing. If `agent-http fork` or `page archive/pane-edge` flake under load, rerun the file alone once (known load flakes) before treating it as a regression.

- [ ] **Step 6: Commit**

```bash
git add templates/agents.mrbl test-browser/shots.js test-browser/harness.js test-browser/agents-phone.test.js docs/AGENTS.md
git commit -m "Reduced motion crossfades, 44pt everywhere a thumb lands, a phone pass for the seeing loop, and the docs.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016BRFDr4GKMYLG2KgE4tAcn"
```

- [ ] **Step 7: The live document** — only after the branch is merged to `main` and the host restarted: confirm no `serve` is racing the file (memory: editing-mrbl-while-served), then regenerate `drive/Agents.mrbl` from the template the way the seed does (`server/seed.js` — read how it fills `__TITLE__` / `__ID__` / `__ICON__`), write it **once**, reopen it in the browser, and verify Deck appears. Do not do this from the worktree; the drive lives with the main checkout.

---

## Self-review

**Spec coverage.** §3 (three widths, Deck default) → Task 6. §4.1 topbar → Task 10. §4.2 thumb bar → Tasks 9–10 (the field opens New on Deck; on Focus and full-screen the pane's own composer is at the bottom and the bar hides — §6.3's "the composer is the thumb bar" is met by the pane extending to the sill, per Task 11's CSS and Task 12's pane rect). §4.3 sheets → Task 9. §4.4 fleet → Task 9. §4.5 materials/type/install/keyboard → Task 10. §5 Deck → Tasks 7–8. §5.4 asks route and events → Tasks 3–4. §6 fisheye → Tasks 2, 12. §7 full screen → Task 11. §8 live-ness → Task 13. §9 motion → Tasks 8, 9, 11, 12, 14. §10 files → all; `probe.js --phone` → Task 12; `shots.js --phone` → Task 14. §11 tests → each task; the Node tests for `bands`, `fisheye`, `focalFor`, `stepSpring`, `project` are Tasks 1–2; the server test is Task 4; the browser tests are Tasks 6–14. §12 push → out of scope, as the spec says.

**Gaps closed inline.** The spec's `spring1d` is `stepSpring` (a pure stepper) plus the existing rAF `spring` in `agent-ui.js` with a new `damping` option — two names for one integrator, one pure and one on the clock; Task 2 and Task 5 say so. The spec's "swipe the Full's header left or right → the neighbour" is folded into Task 12's tap-to-spring and drag; a horizontal swipe on the pane header is not built, because the pane owns its pointer events and a vertical drag already steps one card — recorded here as a deliberate omission.

**Type consistency.** `bandOf` / `bandCompare` / `askLead` / `peekOf` / `fisheye` / `focalFor` / `stepSpring` / `project` are the names in Tasks 1–2 and are what Tasks 7, 12 call. `buildAskCard(event, submit)` and `ASK_CSS` from Task 5 are what Task 7 uses. `runner.openAsks()` and `hub.publishAsk(kind, payload)` from Task 3 are what Task 4 uses. `agent.asks()`, `agent.suspend/resume/streamsOpen` are Tasks 4 and 13. `openSheet / closeSheet / sheetRow / openActions / openNewSheet / openFleetSheet` are Task 9 and are called from Tasks 8, 10, 12.
