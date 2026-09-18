# Construction Zones and Conflict Forks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent's construction zone say who is doing what, make the conflict fork bar say why it exists and what its buttons do, and stop forks from appearing when the person only looked at — or long ago edited — the element the agent is changing.

**Architecture:** Client-side wording lives in `runtime/collab.js` (label and fork bar). Server-side, `server/app.js` swaps the package's touched-id registry for a drive-side one with timestamps (`server/touched.js`), stops feeding presence into it, and scopes a person's edits to "since this agent turn began" at the two places a write is checked for conflict. `@bdhmin/marble` is not changed.

**Tech Stack:** Node 22 ESM, `node:test`, Playwright via `test-browser/harness.js`, the fake provider in `test/fixtures/fake-provider.js`.

**Spec:** `docs/superpowers/specs/2026-09-18-construction-zone-and-forks-design.md`

## Global Constraints

- Label text is exactly `Agent · <clause>` (middle dot U+00B7 with a space each side); phases are lowercase `reading` / `writing` / `working`.
- Fork bar context line is exactly `You and the agent both changed this.`; the button that was *Merge* is now `Ask an agent to combine` and its behaviour (`askMerge`) is unchanged.
- The `/presence` route still broadcasts frames; it must no longer call `note()` on any touched registry.
- No edits under `node_modules/` or `../marble`.
- Run unit tests with `node --test --test-reporter=spec <file>`; browser tests with `node --test --test-concurrency=1 --test-reporter=spec <file>`. Three browser tests fail on `main` regardless (row-pop, drag-to-stage, seam double-click); do not chase them.
- Commit messages: one plain sentence in the repo's voice, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 0: Land the zone-placement fix that is already in the working tree

The `MutationObserver`/`ResizeObserver` fix in `runtime/collab.js` and its two tests in `test-browser/collab.test.js` are uncommitted in the main worktree. Commit **only those two files** before branching, so the feature branch starts from them.

**Files:**
- Commit: `runtime/collab.js`, `test-browser/collab.test.js`

- [ ] **Step 1: Confirm the two files are the only intended change**

Run: `git status --short runtime/collab.js test-browser/collab.test.js`
Expected: both listed as ` M`.

- [ ] **Step 2: Run the collab browser tests**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/collab.test.js`
Expected: 11 pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add runtime/collab.js test-browser/collab.test.js
git commit -m "Keep the construction zone on its target when the page reflows under it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: A touched-id registry that remembers when

**Files:**
- Create: `server/touched.js`
- Test: `test/touched.test.js`

**Interfaces:**
- Produces: `createTouched()` returning `{ note(doc, client, ids, at?), except(doc, client, { since }?), all(doc, { since }?), drop(doc, client), forget(client) }`. Same shape as the package's registry (`node_modules/@bdhmin/marble/server/collab.js:449`), plus `since`. `agent:<conv>` and `agent-undo:<conv>` are the same writer, as in the package's `sameWriter`.

- [ ] **Step 1: Write the failing tests**

```js
// test/touched.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createTouched } from '../server/touched.js';

test('note remembers ids per document and client; except unions the others', () => {
  const t = createTouched();
  t.note('doc', 'you', ['a', 'b']);
  t.note('doc', 'agent:c1', ['c']);
  t.note('other', 'you', ['z']);
  assert.deepEqual(t.except('doc', 'you').sort(), ['c']);
  assert.deepEqual(t.except('doc', 'agent:c1').sort(), ['a', 'b']);
  assert.deepEqual(t.all('doc').sort(), ['a', 'b', 'c']);
  assert.deepEqual(t.except('doc', null).sort(), ['a', 'b', 'c']);
});

test('an agent and its undo are one writer', () => {
  const t = createTouched();
  t.note('doc', 'agent:c1', ['a']);
  t.note('doc', 'agent-undo:c1', ['b']);
  assert.deepEqual(t.except('doc', 'agent:c1'), []);
  assert.deepEqual(t.except('doc', 'agent-undo:c1'), []);
  assert.deepEqual(t.except('doc', 'agent:c2').sort(), ['a', 'b']);
});

test('since keeps only ids noted at or after it, and a re-note moves the id forward', () => {
  const t = createTouched();
  t.note('doc', 'you', ['old'], 1000);
  t.note('doc', 'you', ['new'], 3000);
  assert.deepEqual(t.except('doc', 'agent:c1', { since: 2000 }), ['new']);
  assert.deepEqual(t.except('doc', 'agent:c1', { since: 3000 }), ['new']);
  assert.deepEqual(t.except('doc', 'agent:c1').sort(), ['new', 'old']);
  t.note('doc', 'you', ['old'], 4000);
  assert.deepEqual(t.except('doc', 'agent:c1', { since: 2000 }).sort(), ['new', 'old']);
  assert.deepEqual(t.all('doc', { since: 3500 }), ['old']);
});

test('note ignores a missing client and empty ids; drop and forget clear', () => {
  const t = createTouched();
  t.note('doc', null, ['a']);
  t.note('doc', 'you', ['', null, 'a']);
  assert.deepEqual(t.all('doc'), ['a']);
  t.drop('doc', 'you');
  assert.deepEqual(t.all('doc'), []);
  t.note('doc', 'agent:c1', ['a']);
  t.note('two', 'agent-undo:c1', ['b']);
  t.forget('agent:c1');
  assert.deepEqual(t.all('doc'), []);
  assert.deepEqual(t.all('two'), []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-reporter=spec test/touched.test.js`
Expected: FAIL — `Cannot find module '../server/touched.js'`.

- [ ] **Step 3: Write the registry**

```js
// server/touched.js
// Which ids each writer has touched in each document, and when. The package's
// registry (`createTouched` in @bdhmin/marble/server/collab.js) remembers the
// ids; this one also remembers the time, so a conflict check can ask "touched
// since this turn began?" rather than "touched ever". Same shape otherwise.

const conversationOf = (client) => {
  if (typeof client !== 'string') return null;
  if (client.startsWith('agent-undo:')) return client.slice('agent-undo:'.length);
  if (client.startsWith('agent:')) return client.slice('agent:'.length);
  return null;
};

// An agent and its undo write as one; anyone else is themselves.
function sameWriter(a, b) {
  if (!a || !b) return a === b;
  if (a === b) return true;
  const left = conversationOf(a);
  const right = conversationOf(b);
  return left !== null && left === right;
}

export function createTouched() {
  // doc → client → id → time last noted
  const docs = new Map();

  const clientsOf = (doc) => {
    if (!docs.has(doc)) docs.set(doc, new Map());
    return docs.get(doc);
  };

  return {
    note(doc, client, ids, at = Date.now()) {
      if (!client) return;
      const clients = clientsOf(doc);
      if (!clients.has(client)) clients.set(client, new Map());
      const times = clients.get(client);
      for (const id of ids) {
        if (!id) continue;
        times.set(id, Math.max(at, times.get(id) ?? 0));
      }
    },

    except(doc, client, { since = 0 } = {}) {
      const union = new Set();
      for (const [who, times] of clientsOf(doc)) {
        if (sameWriter(who, client)) continue;
        for (const [id, at] of times) if (at >= since) union.add(id);
      }
      return [...union];
    },

    all(doc, options) {
      return this.except(doc, null, options);
    },

    drop(doc, client) {
      clientsOf(doc).delete(client);
    },

    // A writer that has gone away is not touching anything anywhere.
    forget(client) {
      if (!client) return;
      for (const clients of docs.values()) {
        for (const who of [...clients.keys()]) {
          if (sameWriter(who, client)) clients.delete(who);
        }
      }
    },
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test --test-reporter=spec test/touched.test.js`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add server/touched.js test/touched.test.js
git commit -m "A touched-id registry that remembers when each id was touched.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: A caret is not a claim

Swap `app.js` onto the new registry and stop the `/presence` route from noting ids. Rewrite the two server tests that used presence as a claim so they use a write instead, and add the test that encodes the new rule.

**Files:**
- Modify: `server/app.js:23` (import), `:127` (registry), `:405-413` (presence route)
- Test: `test/server.test.js:559-613`

**Interfaces:**
- Consumes: `createTouched` from `server/touched.js` (Task 1).
- Produces: nothing new; `sessionTouched` keeps its name and call sites.

- [ ] **Step 1: Rewrite the two presence-as-claim tests and add the new one**

Replace the two tests at `test/server.test.js:559-613` with these three. The first two are the old tests with the presence POST replaced by an `/ops` write from `you` (that is how `you` now claims `hc1`); the third is new.

```js
test('an outside write to a disjoint id both-applies next to a heading you wrote', async () => {
  const source = collabDoc('Hello');
  const made = await asJson(await put('', 'Collab Live.mrbl', source));
  const doc = encodeURIComponent(made.path);

  const wrote = await fetch(`${base}/ops?app=${doc}&client=you`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ type: 'setText', id: 'hc1', text: 'Hello' }]),
  });
  assert.equal(wrote.status, 200);

  const listening = collect(`/events?app=${doc}&client=you`, { want: 3, ms: 2500 });
  await listening.ready;

  const file = path.join(ROOT, `${made.path}.mrbl`);
  const onDisk = await fsp.readFile(file, 'utf8');
  await fsp.writeFile(file, onDisk.replace('</main>', '<p data-marble-id="pc1">Body</p>\n</main>'));

  const frames = await listening.frames;
  assert.ok(frames.some((frame) => frame.event === 'ops' || frame.data === 'changed'));

  const after = await fsp.readFile(file, 'utf8');
  assert.match(after, /<h1 data-marble-id="hc1"[^>]*>Hello<\/h1>/);
  assert.match(after, /<p data-marble-id="pc1">Body<\/p>/);
  assert.doesNotMatch(after, /<marble-alt/);
});

test('an outside rewrite of a heading you wrote forks rather than clobbering', async () => {
  const source = collabDoc('Yours');
  const made = await asJson(await put('', 'Collab Fork.mrbl', source));
  const doc = encodeURIComponent(made.path);

  await fetch(`${base}/ops?app=${doc}&client=you`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ type: 'setText', id: 'hc1', text: 'Yours' }]),
  });

  const listening = collect(`/events?app=${doc}&client=you`, { want: 3, ms: 2500 });
  await listening.ready;

  const file = path.join(ROOT, `${made.path}.mrbl`);
  const onDisk = await fsp.readFile(file, 'utf8');
  await fsp.writeFile(file, onDisk.replace(
    '<h1 data-marble-id="hc1" data-marble-editable>Yours</h1>',
    '<h1 data-marble-id="hc1" data-marble-editable>Theirs</h1>',
  ));

  await listening.frames;
  const after = await fsp.readFile(file, 'utf8');
  assert.match(after, /<marble-alt data-marble-id="hc1"/);
  assert.match(after, /Yours/);
  assert.match(after, /Theirs/);
});

test('an outside rewrite of a heading you only had your caret in applies cleanly', async () => {
  const source = collabDoc('Looking');
  const made = await asJson(await put('', 'Collab Look.mrbl', source));
  const doc = encodeURIComponent(made.path);

  const noted = await fetch(`${base}/presence?app=${doc}&client=you`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ['hc1'] }),
  });
  assert.equal(noted.status, 200);

  const listening = collect(`/events?app=${doc}&client=you`, { want: 3, ms: 2500 });
  await listening.ready;

  const file = path.join(ROOT, `${made.path}.mrbl`);
  const onDisk = await fsp.readFile(file, 'utf8');
  await fsp.writeFile(file, onDisk.replace(
    '<h1 data-marble-id="hc1" data-marble-editable>Looking</h1>',
    '<h1 data-marble-id="hc1" data-marble-editable>Changed</h1>',
  ));

  await listening.frames;
  const after = await fsp.readFile(file, 'utf8');
  assert.doesNotMatch(after, /<marble-alt/, 'a caret is observation, not a claim');
  assert.match(after, /<h1 data-marble-id="hc1"[^>]*>Changed<\/h1>/);
});
```

Note: `applyOps` returns early at `app.js:206-209` when the write changes nothing, *before* it notes ids at line 215 — so a `setText` with the text the heading already has is not a claim. The two `/ops` calls above therefore must change the text: in the first test use `text: 'Hello!'` and match `>Hello!<` in the final assertion; in the second use `text: 'Yours!'`, replace `>Yours!</h1>` with `>Theirs</h1>` in the outside rewrite, and match `Yours!` and `Theirs` at the end.

- [ ] **Step 2: Run to verify the new test fails**

Run: `node --test --test-reporter=spec --test-name-pattern="caret in applies cleanly" test/server.test.js`
Expected: FAIL — `a caret is observation, not a claim` (a `<marble-alt>` was made).

- [ ] **Step 3: Switch the registry and stop noting presence**

In `server/app.js`:

Line 23 — remove `createTouched` from the `./engine.js` import list and add:
```js
import { createTouched } from './touched.js';
```

Line 127 stays `const sessionTouched = createTouched();`.

Lines 405-413 — the presence route no longer notes:
```js
      if (route === '/presence' && req.method === 'POST') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        const client = url.searchParams.get('client');
        const body = JSON.parse((await readBody(req, config.maxBodyBytes)).toString('utf8'));
        const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
        // Where a person is looking is not a claim on it. The frame is for the
        // wash other tabs draw; conflicts come from writes (see applyOps).
        channels.toPresence(docPath, { client, ids }, { except: client });
        return json(res, 200, { ok: true });
      }
```

- [ ] **Step 4: Run the whole server test file**

Run: `node --test --test-reporter=spec test/server.test.js`
Expected: all pass, including the three rewritten/new tests. If `engine.js` still exports `createTouched` that is fine — nothing else imports it from there (`grep -rn "createTouched" server test` should show only `touched.js`, `touched.test.js`, `engine.js`, `app.js`).

- [ ] **Step 5: Commit**

```bash
git add server/app.js test/server.test.js
git commit -m "Stop counting where a person's caret is as a claim on the element.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: A person's edit is concurrent only if it landed after the turn began

**Files:**
- Modify: `server/agent/runner.js:248-256` (`start`), `server/app.js:194-204` (`applyOps` conflict site), `server/app.js:878-885` (external-write conflict site)
- Modify: `test/agent-http.test.js:35-41` (`SCRIPTS`)
- Test: `test/agent-http.test.js`

**Interfaces:**
- Consumes: `sessionTouched.except(doc, client, { since })` (Task 1); `agents.running()` (exists, `runner.js:672`) returning live turn objects with `conversationId`.
- Produces: `turn.startedAt` (ms epoch) on the live turn; `sinceFor(client)` helper in `app.js`.

- [ ] **Step 1: Add a `late` script and two failing tests**

In `test/agent-http.test.js` `SCRIPTS`, add:
```js
  late: [
    { sleep: 600 },
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed late.' },
  ],
```

Add these tests after `'an agent edits a document through the bridge, and the open tab hears it'` (line ~199). Each resets `garden` first so earlier edits do not leak in.

```js
const resetGarden = async () => {
  await drive.store.write('garden', SOURCE, { label: 'test' });
};

const personWrites = (ops, client = 'you') =>
  fetch(`${base}/ops?app=garden&client=${client}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ops),
  });

test('an edit you made before the turn began does not fork the agent’s rewrite', async () => {
  await resetGarden();
  assert.equal((await personWrites([{ type: 'setText', id: 'h', text: 'Mine' }])).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const run = await start('script:edit\nRename the heading');
  const { turn } = await finished(run.conversationId, run.turnId);
  assert.equal(turn.status, 'completed');

  const after = await drive.store.read('garden');
  assert.doesNotMatch(after, /<marble-alt/, 'the agent read your version before writing; that is not a conflict');
  assert.match(after, />Backlog</);
});

test('an edit you made while the turn ran forks the agent’s rewrite', async () => {
  await resetGarden();
  const run = await start('script:late\nRename the heading');
  await until(async () => {
    const { body } = await api('GET', `/agent/conversations/${run.conversationId}`);
    return body.turns.find((t) => t.id === run.turnId)?.status === 'running' ? true : null;
  });
  assert.equal((await personWrites([{ type: 'setText', id: 'h', text: 'Mine' }])).status, 200);

  const { turn } = await finished(run.conversationId, run.turnId);
  assert.equal(turn.status, 'completed');

  const after = await drive.store.read('garden');
  assert.match(after, /<marble-alt data-marble-id="h"/, 'both of you changed it during the turn');
  assert.match(after, /Mine/);
  assert.match(after, /Backlog/);
});
```

- [ ] **Step 2: Run to verify the first fails and the second passes**

Run: `node --test --test-reporter=spec --test-name-pattern="before the turn began|while the turn ran" test/agent-http.test.js`
Expected: `before the turn began` FAILS (a `<marble-alt>` is made — today every past write counts); `while the turn ran` PASSES (today's behaviour already forks).

- [ ] **Step 3: Stamp the live turn and scope the check**

`server/agent/runner.js`, in `start(turn)` right after `turn.status = 'running';` (line 249):
```js
    turn.status = 'running';
    turn.startedAt = Date.now();
```
(The `store.updateTurn(..., { startedAt: Date.now() })` call at line 253 stays; it can use `turn.startedAt` instead of a second `Date.now()`.)

`server/app.js`, add next to `sessionTouched` (after line 127):
```js
  // A person's edits are concurrent with an agent's write only if they landed
  // after that agent's turn began: the turn read the document as its base,
  // and anything before the base is history it has already seen.
  const sinceFor = (client) => {
    const conv = typeof client === 'string' && client.startsWith('agent:') ? client.slice('agent:'.length) : null;
    if (!conv) return undefined;
    const turn = agents?.running?.().find((t) => t.conversationId === conv);
    return turn?.startedAt;
  };
```

`server/app.js:195`, in `applyOps`:
```js
        const others = sessionTouched.except(docPath, client, { since: sinceFor(client) });
```

`server/app.js:883`, in the external-write branch:
```js
        touchedIds: conv
          ? sessionTouched.except(docPath, `agent:${conv}`, { since: sinceFor(`agent:${conv}`) })
          : sessionTouched.all(docPath),
```

`agents` is assigned later in `createDrive` than `applyOps` is defined, but both helpers run at request time, after it exists; `applyOps` already reads `agents?.documentTouched` the same way at line 875.

- [ ] **Step 4: Run the agent tests**

Run: `node --test --test-reporter=spec test/agent-http.test.js test/agent-runner.test.js`
Expected: all pass, including both new tests.

- [ ] **Step 5: Commit**

```bash
git add server/agent/runner.js server/app.js test/agent-http.test.js
git commit -m "Count a person's edit as a conflict only when it landed after the agent's turn began.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The zone label names its author

**Files:**
- Modify: `runtime/collab.js:399-405` (`phaseLabel`)
- Test: `test-browser/collab.test.js`

**Interfaces:**
- Produces: `phaseLabel(detail)` returning `Agent · <clause>`.

- [ ] **Step 1: Update the existing label assertions and add the note-shaping tests**

In `test-browser/collab.test.js`:

In `'agent presence tapes off the region it is working on'` change `assert.match(await zone.innerText(), /Working/);` to:
```js
  assert.match(await zone.innerText(), /Agent · working/);
```

In `'the construction label uses the apply_ops note, and Hide puts it away'` change the dispatched note to `note: 'Rename the heading.'` and the assertion to:
```js
  assert.match(await zone.innerText(), /Agent · rename the heading(?!\.)/);
```

In `'agent work with no ids is a page banner, not a box around the document'` change `/Working/` to `/Agent · working/`.

Add:
```js
test('the construction label keeps an all-caps first word and names the phase without a note', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  const labelFor = async (detail) => {
    await page.evaluate((d) => {
      document.dispatchEvent(new CustomEvent('marble:presence', { detail: d }));
    }, { client: 'agent:c1', ids: ['p'], ...detail });
    return (await page.locator('.marble-zone-label').innerText()).replace(/\s*Hide\s*$/, '').trim();
  };
  assert.equal(await labelFor({ phase: 'writing', note: 'PDF export gets a footer.' }), 'Agent · PDF export gets a footer');
  assert.equal(await labelFor({ phase: 'reading' }), 'Agent · reading');
  assert.equal(await labelFor({ phase: 'writing' }), 'Agent · writing');
  assert.equal(await labelFor({ phase: 'working' }), 'Agent · working');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/collab.test.js`
Expected: the four label tests FAIL (labels read `Working`, `rename the heading.`, etc.).

- [ ] **Step 3: Rewrite `phaseLabel`**

Replace `runtime/collab.js:399-405`:
```js
    // The note is written as a sentence ("Rename the heading."); after
    // "Agent ·" it reads as a clause, so it loses its capital and its period —
    // unless the first word is all capitals, which is a name, not a sentence.
    function asClause(note) {
      const text = note.replace(/\.\s*$/, '');
      const first = text.match(/^\S+/)?.[0] ?? '';
      if (first && first === first.toUpperCase() && /[A-Z]/.test(first)) return text;
      return text.charAt(0).toLowerCase() + text.slice(1);
    }

    function phaseLabel(detail) {
      const note = String(detail.note ?? '').trim();
      if (note) return `Agent · ${asClause(note)}`;
      if (detail.phase === 'reading') return 'Agent · reading';
      if (detail.phase === 'writing') return 'Agent · writing';
      return 'Agent · working';
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/collab.test.js`
Expected: 12 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add runtime/collab.js test-browser/collab.test.js
git commit -m "Say who the construction zone belongs to, and read the note as a clause.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The fork bar says why it is there and what its buttons do

**Files:**
- Modify: `runtime/collab.js:70-79` (`.marble-fork` CSS), `:617-685` (`wireFork`)
- Test: `test-browser/collab.test.js:45-59`

- [ ] **Step 1: Update the fork-bar test and add the combine-button test**

In `'a conflict fork shows You, Agent, Keep this, and Merge'` rename the test to `'a conflict fork says why it is there, and shows You, Agent, Keep this, and Ask an agent to combine'` and change the label assertion and add the context line check:
```js
  const labels = await bar.locator('button').allTextContents();
  assert.deepEqual(labels.map((t) => t.trim()), ['You', 'Agent', 'Keep this', 'Ask an agent to combine']);
  assert.equal(await bar.locator('.marble-fork-why').textContent(), 'You and the agent both changed this.');
```

Add after it:
```js
test('Ask an agent to combine hands both versions to the agent drawer', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.locator('marble-alt > .marble-fork').waitFor();
  await page.evaluate(() => {
    window.__agent = { selected: null, aimed: null, opened: 0 };
    window.marble.agent = {
      select: (ids) => { window.__agent.selected = ids; },
      aim: (app) => { window.__agent.aimed = app; },
      current: () => null,
      send: () => {},
      open: () => { window.__agent.opened += 1; },
    };
  });
  await page.getByRole('button', { name: 'Ask an agent to combine both versions' }).click();
  const seen = await page.evaluate(() => window.__agent);
  assert.deepEqual(seen.selected, ['hy', 'ha']);
  assert.equal(seen.opened, 1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec --test-name-pattern="conflict fork|combine" test-browser/collab.test.js`
Expected: both FAIL (button still says `Merge`; no `.marble-fork-why`).

- [ ] **Step 3: Add the context line and rename the button**

In the `<style>` block of `runtime/collab.js`, after the `.marble-fork` rule (line ~79), add:
```css
      .marble-fork-why {
        flex-basis: 100%;
        color: var(--muted, #5a5a5a);
        margin-bottom: -.15rem;
      }
```

In `wireFork` (line ~628) build the line and put it first in the bar:
```js
      const bar = document.createElement('div');
      bar.className = 'marble-fork';
      bar.setAttribute(TRANSIENT, '');
      bar.setAttribute('contenteditable', 'false');

      const why = document.createElement('div');
      why.className = 'marble-fork-why';
      why.textContent = 'You and the agent both changed this.';
```
and change `bar.append(seg, acts);` (line ~681) to:
```js
      bar.append(why, seg, acts);
```

In `render()` (line ~672), the merge button:
```js
        const merge = document.createElement('button');
        merge.type = 'button';
        merge.textContent = 'Ask an agent to combine';
        merge.setAttribute('aria-label', 'Ask an agent to combine both versions');
        merge.title = 'Sends both versions to an agent, which writes a third';
        merge.addEventListener('click', () => askMerge(alt));
```

- [ ] **Step 4: Run the collab tests**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/collab.test.js`
Expected: 13 pass, 0 fail.

- [ ] **Step 5: Screenshot the bar for the review**

Add to the test from Step 1, after the assertions:
```js
  await page.locator('marble-alt').screenshot({ path: 'test-browser/shots/fork-bar.png' });
```
Run the test once, look at `test-browser/shots/fork-bar.png`: the context line sits on its own row above `You | Agent · Keep this · Ask an agent to combine`. Then remove the screenshot line (the tests do not keep images) and delete the file.

- [ ] **Step 6: Commit**

```bash
git add runtime/collab.js test-browser/collab.test.js
git commit -m "Tell the person why a fork is there, and name the combine button for what it does.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Document it

**Files:**
- Modify: `docs/AGENTS.md` (after the `## The rules the tools enforce` section, before `## What a full agent can do`, ~line 59)

- [ ] **Step 1: Add the section**

```markdown
## While an agent works

A corner-marked frame on the page is where the agent is, and its label says
what it is doing — `Agent · reading`, or the note it gave its edit
(`Agent · rename the heading`). It follows the element as the page reflows,
and *Hide* puts it away for the session (*Show work* brings it back).

Being on the page is not a claim on it. Where your caret is has no bearing on
what the agent may change; only an edit you made **after its turn began**
counts as a conflict with an edit of the same element by the agent. When that
happens, nothing is overwritten: the element becomes two versions with a bar
above — *You* and *Agent* to look at each, *Keep this* to settle on the one
showing, and *Ask an agent to combine* to send both to an agent that writes a
third. An agent's own turn-ending forgets what it touched, so its claims never
outlive it.
```

- [ ] **Step 2: Run the whole unit suite once**

Run: `npm test`
Expected: pass (the doc change touches nothing, this is the end-of-plan check).

- [ ] **Step 3: Commit**

```bash
git add docs/AGENTS.md
git commit -m "Document the construction zone, and what does and does not count as a conflict.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** §4.1 → Task 4. §4.2 → Task 5. §4.3(a) → Task 2. §4.3(b) → Tasks 1 and 3. §4.4 → Task 6. §2 (already landed) → Task 0 commits it. §6 tests: label with note / all-caps / phases (Task 4); bar text and buttons, combine still calls `select`/`aim`/`open` (Task 5); registry unit tests (Task 1); presence does not claim (Task 2); before-turn write applies cleanly, during-turn write forks (Task 3); socket close still clears — covered by the existing `drop` call at `app.js:396`, which is untouched, and by `test/touched.test.js`'s `drop` case.

**Placeholders.** None. Task 5 step 5 is an explicit "skip if tests pass".

**Type consistency.** `createTouched().except(doc, client, { since })` is the name used in Tasks 1, 2 and 3. `sinceFor(client)` is defined in Task 3 and used only there. `turn.startedAt` is set in Task 3 and read in Task 3. `phaseLabel` keeps its name and call site.
