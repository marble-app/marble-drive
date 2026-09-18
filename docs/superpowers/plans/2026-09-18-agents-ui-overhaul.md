# Agents UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One conversation across four views — a shared state vocabulary, panes everywhere (including a Focus stage that stacks), a Focus field that follows its content, and view switches where every conversation morphs into its next shape.

**Architecture:** The Agents page is one Marble document (`templates/agents.mrbl`: CSS + a page script) over two runtime libraries (`runtime/agent-folders.js` pure layout helpers, `runtime/agent-ui.js` the `<marble-conversation>` component and shared helpers) and the agent store. Work lands in five phases, each green and committed on its own: A state + attributes, B panes + board, C hover + drag, D Focus layout, E transitions.

**Tech Stack:** Node 22, `node:test`, Playwright via `test-browser/harness.js` (`startDrive`, fake provider with scripts), Web Animations API, no new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-18-agents-ui-overhaul-design.md`

## Global Constraints

- Same UIST warm / Dusk tokens. No new palette, no new npm dependencies. Node 22.
- Do not reparent the file's `<marble-conversation>` (reconcile would clone it). Extra panes are transient (`data-marble-transient`) and never get a file `data-marble-id`.
- Page-only state (view, open id, dock) lives in `localStorage`, never in ops.
- Every task ends with: `npm test` green, and the named browser files green (`node --test --test-concurrency=1 --test-reporter=spec test-browser/<file>.test.js`). Run the whole `npm run test:browser` before each phase commit.
- Known flake: `agents-page.test.js` "dragging a conversation onto the pane edge opens a second pane" can time out under the full concurrent run and passes alone — rerun the file alone before treating it as a break.
- `drive/Agents.mrbl` is gitignored and live; it is replaced by hand once at the end (Task 16), one write then verify.
- Commit messages: one sentence of what and why, wrapped body, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility touched by this plan |
|---|---|
| `server/agent/store.js` | `REVIEWABLE` gains `done`. |
| `runtime/agent-ui.js` | Two contiguous additions only: `stateOf` + `STATE_CSS` after `TAG_CSS`; `:host([data-focused])` rules beside the `data-chrome` rules. Another session owns the rest of this file. |
| `runtime/agent-folders.js` | `assignLods` ignores hover; `packFocus` regions-by-content packed down-then-across with `col`; `regionAt`; `steadySlot`. |
| `templates/agents.mrbl` | Everything page-side: `statusOf`, `data-state` painting, shared attribute classes, board pane + stack + column FLIP, open-beside / split / empty panes / dock zone, Focus hover/size/drop polish, Focus stage-as-tree and 2-D targeting, `morphViews`. |
| `test/agent-store.test.js`, `test/agent-folders.test.js` | Node tests. |
| `test-browser/agents-page.test.js`, `agents-panes.test.js`, `agents-focus.test.js`, new `agents-transitions.test.js` | Browser tests. |
| `test-browser/shots.js` | `--stack`. |

The template's script is one IIFE; functions are addressed by name (`const statusOf = …`) because line numbers shift with every task. `grep -n "const <name>" templates/agents.mrbl` finds each anchor.

---

# Phase A — state and attributes (spec §3, §4)

### Task 1: `done` needs review

**Files:**
- Modify: `server/agent/store.js` (`REVIEWABLE`, line 23)
- Test: `test/agent-store.test.js` (the `needsReview` block near line 130)

**Interfaces:**
- Produces: `needsReview(meta)` true for `lastOutcome: 'done'` until `lastReviewedAt >= lastFinishedAt`.

- [ ] **Step 1: Flip the assertion**

In `test/agent-store.test.js`, find the line
`assert.equal(needsReview({ ...base, lastOutcome: 'done' }), false);` and replace it with:

```js
  // An answered turn is something the person has not read yet. 'done' used to
  // fall straight through to Completed, which left the review column empty.
  assert.equal(needsReview({ ...base, lastOutcome: 'done' }), true);
  assert.equal(needsReview({ ...base, lastOutcome: 'done', lastReviewedAt: base.lastFinishedAt }), false);
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/agent-store.test.js`
Expected: 1 failing — `done` returns `false`.

- [ ] **Step 3: Add `done`**

```js
const REVIEWABLE = new Set(['changes', 'done', 'failed', 'interrupted', 'watchdog']);
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test test/agent-store.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/agent/store.js test/agent-store.test.js
git commit -m "An answered turn needs review until it is opened."
```

### Task 2: `stateOf` and `STATE_CSS` in agent-ui.js

**Files:**
- Modify: `runtime/agent-ui.js` — insert directly after the `TAG_CSS` template literal ends; add the two names to the `window.marbleAgentUI = { … }` object (line ~4019).
- Test: `test-browser/agents-page.test.js` (new test at the end)

**Interfaces:**
- Produces: `window.marbleAgentUI.stateOf(summary) → 'waiting' | 'working' | 'failed' | 'unseen' | 'idle'` and `window.marbleAgentUI.STATE_CSS` (a string of rules on `[data-state] .dot`).

- [ ] **Step 1: Write the failing test**

Append to `test-browser/agents-page.test.js`:

```js
test('stateOf is one vocabulary: waiting, working, failed, unseen, idle', async () => {
  const { page } = await openAgents();
  const states = await page.evaluate(() => {
    const s = window.marbleAgentUI.stateOf;
    return [
      s({ asking: true, running: true }),
      s({ running: true }),
      s({ queued: true }),
      s({ needsReview: true, lastOutcome: 'failed' }),
      s({ needsReview: true, lastOutcome: 'watchdog' }),
      s({ needsReview: true, lastOutcome: 'done' }),
      s({ lastOutcome: 'done' }),
      s({}),
    ];
  });
  assert.deepEqual(states, ['waiting', 'working', 'working', 'failed', 'failed', 'unseen', 'idle', 'idle']);
  assert.match(await page.evaluate(() => window.marbleAgentUI.STATE_CSS), /\[data-state="waiting"\] \.dot/);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-page.test.js`
Expected: the new test fails with `stateOf is not a function`.

- [ ] **Step 3: Implement**

After the closing backtick of `TAG_CSS` in `runtime/agent-ui.js`:

```js
  /** Five words for what a conversation is doing, shared by every view. The
   *  dot is the only thing that reads them; its colours are the same tokens
   *  the status buckets already use. */
  const stateOf = (summary) => {
    if (summary?.asking) return 'waiting';
    if (summary?.running || summary?.queued || summary?.status === 'running') return 'working';
    if (summary?.needsReview) {
      return summary.lastOutcome === 'failed' || summary.lastOutcome === 'watchdog' ? 'failed' : 'unseen';
    }
    return 'idle';
  };

  const STATE_CSS = `
    .dot {
      flex: none; width: 8px; height: 8px; border-radius: 999px;
      background: var(--faint); box-sizing: border-box;
    }
    [data-state="idle"] .dot { background: transparent; border: 1.5px solid var(--faint); }
    [data-state="unseen"] .dot { background: var(--ink); }
    [data-state="failed"] .dot { background: var(--danger); }
    [data-state="working"] .dot { background: var(--accent-ink); animation: dot-breathe 1.6s ease-in-out infinite; }
    [data-state="waiting"] .dot { background: var(--caution); animation: dot-ring 1.8s ease-out infinite; }
    @keyframes dot-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
    @keyframes dot-ring {
      0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--caution) 55%, transparent); }
      70%, 100% { box-shadow: 0 0 0 7px transparent; }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-state="working"] .dot, [data-state="waiting"] .dot { animation: none; }
    }
  `;
```

Add `stateOf, STATE_CSS,` to the `window.marbleAgentUI = { … }` object.

- [ ] **Step 4: Run to see it pass**

Run the same file. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/agents-page.test.js
git commit -m "One state vocabulary for a conversation: waiting, working, failed, unseen, idle."
```

### Task 3: the page paints state; waiting sits in Needs review; seen on finish

**Files:**
- Modify: `templates/agents.mrbl` — `statusOf`; `paintRow`; `paintFocusCard`; the folder tab painter (`const tab = document.createElement('button'); tab.className = 'folder-tab'` inside `paintFolderRail`); `paintBar` + `BAR_MARKUP`; the `place()` for board columns; the `agent.on('*', …)` stream handler that calls `upsert` (grep `receive(` / `upsert(summary)` near the bottom); a `<style>` injection of `STATE_CSS` in the boot code where `TAG_CSS` is injected (grep `TAG_CSS`).
- Test: `test-browser/agents-page.test.js`

**Interfaces:**
- Consumes: `window.marbleAgentUI.stateOf`, `STATE_CSS` (Task 2).
- Produces: `data-state` on `.conv`, `.folder-tab`, `.focus-card`, `.dock-bar`; `statusOf(summary)` returns `'review'` for `asking`; review column order.

- [ ] **Step 1: Write the failing tests**

Append to `test-browser/agents-page.test.js`. A `say`-only script yields `lastOutcome: 'done'` — add it to `SCRIPTS` at the top of the file: `answer: [{ say: 'Just an answer.' }],`.

```js
test('an answered turn sits in Needs review until it is opened', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:answer', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"][data-status="review"]`).waitFor();
  assert.equal(await page.locator(`.conv[data-id="${id}"]`).getAttribute('data-state'), 'unseen');
  await page.keyboard.press('v');
  await page.locator(`.column[data-col="review"] .conv[data-id="${id}"]`).waitFor();
  await page.locator(`.column .conv[data-id="${id}"]`).click();
  await page.locator(`.conv[data-id="${id}"][data-status="completed"]`).waitFor();
  assert.equal(await page.locator(`.conv[data-id="${id}"]`).getAttribute('data-state'), 'idle');
});

test('a conversation waiting on the person sits first in Needs review, marked waiting', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const done = await agent.start({ provider: 'fake' });
    await agent.send(done, { prompt: 'script:answer', target: 'garden', viewing: 'Agents', selection: [] });
    const asking = await agent.start({ provider: 'fake' });
    await agent.send(asking, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] });
    return { done, asking };
  });
  await page.locator(`.conv[data-id="${ids.asking}"][data-state="waiting"]`).waitFor();
  await page.locator(`.conv[data-id="${ids.done}"][data-state="unseen"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  const order = await page.evaluate(() => [...document.querySelectorAll('.column[data-col="review"] > .conv:not([hidden])')].map((el) => el.dataset.id));
  assert.equal(order[0], ids.asking, 'waiting first');
  assert.ok(order.includes(ids.done));
  assert.equal(await page.locator(`.column[data-col="running"] .conv[data-id="${ids.asking}"]`).count(), 0);
});

test('a turn that finishes while its pane is focused is already seen', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await page.locator(`.conv[data-id="${id}"]`).click();
  await page.locator(`.pane marble-conversation[conversation="${id}"]`).waitFor();
  await page.evaluate((cid) => window.marble.agent.send(cid, { prompt: 'script:answer', target: 'garden', viewing: 'Agents', selection: [] }), id);
  await page.locator(`.conv[data-id="${id}"][data-status="running"]`).waitFor();
  await page.locator(`.conv[data-id="${id}"]:not([data-status="running"])`).waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(`.conv[data-id="${id}"]`).getAttribute('data-status'), 'completed');
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-page.test.js`
Expected: three new failures (`data-status="review"` never appears for `done`; waiting sits in running; the finished chat drops into review).

- [ ] **Step 3: Implement `statusOf`, sort, painting, seen**

`statusOf`:

```js
    const statusOf = (summary) => {
      // Waiting on the person is the one thing Running must not hide.
      if (summary?.asking) return 'review';
      if (summary?.running || summary?.status === 'running' || summary?.queued) return 'running';
      if (summary?.needsReview) return 'review';
      return 'completed';
    };
    const stateOf = (summary) => window.marbleAgentUI?.stateOf?.(summary) ?? 'idle';
```

Review column order — find `place(el)` (the function that appends a `.conv` into its column / list). Where it appends into a board column, insert by order instead of appending:

```js
      const reviewRank = (s) => (s?.asking ? 0 : 1);
      const before = [...column.querySelectorAll(':scope > .conv')].find((other) => {
        const o = summaries.get(other.dataset.id);
        if (column.dataset.col === 'review' && reviewRank(o) !== reviewRank(summary)) return reviewRank(o) > reviewRank(summary);
        return (o?.lastFinishedAt ?? o?.updatedAt ?? 0) < (summary.lastFinishedAt ?? summary.updatedAt ?? 0);
      });
      column.insertBefore(el, before ?? null);
```

Painting — in `paintRow`, `paintFocusCard`, the folder tab painter and `paintBar` add `el.dataset.state = stateOf(summary);`. In `paintBar` also give the bar a dot: add `<span class="dot" aria-hidden="true"></span>` as the first child of `BAR_MARKUP` (before the grip) and set `bar.dataset.state`. In `makeFocusCard` the existing `.focus-dot` span gains the shared class: `class="focus-dot dot"`; the folder tab's dot span likewise `class="dot"`; `.conv` already has `.dot`. Delete the old per-view dot colour rules (`.conv .dot`, `.conv[data-status=…] .dot`, `.focus-dot` colour rules and `.focus-card[data-lod="chip"] .focus-dot { display: none; }`) and inject `STATE_CSS` where the boot code injects `TAG_CSS`:

```js
    const stateStyle = document.createElement('style');
    stateStyle.setAttribute('data-marble-transient', '');
    stateStyle.textContent = window.marbleAgentUI?.STATE_CSS ?? '';
    document.head.append(stateStyle);
```

Seen on finish — in the stream handler that receives summaries (grep `agent.on('*'` — the one that calls `upsert(summary)`), before `upsert`:

```js
        const prev = summaries.get(summary.id);
        const finished = prev?.running && !summary.running && summary.lastFinishedAt;
        if (finished && document.visibilityState === 'visible' && focusedPaneId() === summary.id && summary.needsReview) {
          agent.markReviewed(summary.id).catch(() => {});
          summary = { ...summary, needsReview: false };
        }
```

with, near `slotOf`:

```js
    const focusedPaneId = () => (dock.focus === 'primary' ? convo.getAttribute('conversation') : dock.extras[dock.focus]?.id) ?? null;
```

- [ ] **Step 4: Run to see them pass; run the file whole**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-page.test.js`
Expected: all pass, including `opening a conversation clears needs-review` and `a queued conversation sits in Running, not Completed`.

- [ ] **Step 5: Run the other browser files that paint rows/tabs/cards**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-folders.test.js test-browser/agents-focus.test.js`
Expected: pass (a rail tab still "carries its status").

- [ ] **Step 6: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-page.test.js
git commit -m "Paint one state dot in every view; waiting sits first in Needs review; a watched turn is seen when it finishes."
```

### Task 4: one style per attribute

**Files:**
- Modify: `templates/agents.mrbl` — CSS: `.conv .tag…` block (line ~821) becomes shared `.tag` rules (or simply rely on `TAG_CSS`, which the page already injects, and delete the `.conv .tag[data-hue]` duplicates); `.focus-card-model` rules; `makeFocusCard` markup; `paintFocusCard`; `focusLodSize`.
- Modify: `runtime/agent-folders.js` — nothing (sizes come from the template).
- Test: `test-browser/agents-focus.test.js`

**Interfaces:**
- Produces: `.focus-card[data-lod="digest"] .tags .tag` pills; `focusLodSize('digest') → { w: 260, h: 148 }`.

- [ ] **Step 1: Write the failing test**

Append to `test-browser/agents-focus.test.js`:

```js
test('a digest shows the same pills a row does; a chip keeps its dot and hides the rest', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, Array.from({ length: 7 }, (_, i) => ({ key: `c${i}`, title: `card ${i}` })));
  await page.locator(`.focus-card[data-id="${ids.c0}"]`).click();
  await page.waitForFunction((id) => document.querySelector(`.focus-card[data-id="${id}"]`)?.dataset.lod === 'digest', ids.c0);
  const digest = page.locator(`.focus-card[data-id="${ids.c0}"]`);
  assert.ok(await digest.locator('.tags .tag').count() >= 1, 'a digest carries pills');
  const pill = await digest.locator('.tags .tag').first().evaluate((el) => getComputedStyle(el).borderRadius);
  const rowPill = await page.evaluate(() => getComputedStyle(document.querySelector('#list .conv .tags .tag')).borderRadius);
  assert.equal(pill, rowPill, 'same pill everywhere');
  await page.waitForFunction(() => [...document.querySelectorAll('.focus-card')].some((el) => el.dataset.lod === 'chip'));
  const chip = page.locator('.focus-card[data-lod="chip"]').first();
  assert.equal(await chip.locator('.dot').evaluate((el) => getComputedStyle(el).display !== 'none'), true, 'a chip keeps its dot');
  assert.equal(await chip.locator('.tags .tag').evaluateAll((els) => els.filter((el) => getComputedStyle(el).display !== 'none').length), 0, 'a chip hides the pills');
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-focus.test.js`
Expected: fails — no `.tags` inside a Focus card.

- [ ] **Step 3: Implement**

`makeFocusCard` markup: replace `<span class="focus-card-model"></span>` with nothing in the head, and insert `<p class="tags focus-tags"></p>` as the first child of `.focus-card-body`. Give the existing body lines the shared classes: `focus-target target`, `focus-activity activity`, `focus-status status-word`, `focus-age age`; the title span `focus-card-title title`.

`paintFocusCard`: replace the `model` block with:

```js
      const tags = card.querySelector('.focus-tags');
      if (tags) {
        tags.replaceChildren();
        for (const tag of (window.marbleAgentUI?.conversationTags?.(summary, labels) ?? [])) {
          const span = document.createElement('span');
          span.className = 'tag';
          span.dataset.kind = tag.kind;
          span.dataset.hue = String(tag.hue);
          span.textContent = tag.label;
          tags.append(span);
        }
      }
```

CSS: delete `.focus-card-model` rules; add

```css
  .focus-tags { display: flex; gap: .3rem; flex-wrap: nowrap; overflow: hidden; margin: 0 0 .1rem; }
  .focus-card[data-lod="chip"] .focus-tags { display: none; }
  .focus-card[data-lod="chip"] .focus-card-head .age { margin-left: auto; font-size: .72rem; color: var(--faint); font-variant-numeric: tabular-nums; }
```

and move the age into the chip's head: in `makeFocusCard` add `<span class="age focus-head-age"></span>` after the title; `paintFocusCard` writes `age(summary.updatedAt)` into both age spans; CSS hides `.focus-head-age` except on chips (`.focus-card:not([data-lod="chip"]) .focus-head-age { display: none; }`).

Replace the `.conv .tag[data-hue=…]` colour rules (light and dark) with nothing — `TAG_CSS` already defines `.tag[data-hue]`; keep only layout rules that are `.conv`-specific (`.conv .tags { … }`). Add `.tags { display: flex; gap: .3rem; flex-wrap: wrap; }` once.

`focusLodSize`: `digest` → `{ w: 260, h: 148 }`.

- [ ] **Step 4: Run to see it pass; then the whole focus file and the page file**

Expected: all pass. (`a conversation row tags the agent and the model` still passes — the pills are unchanged for rows.)

- [ ] **Step 5: Look at it**

Run: `node test-browser/shots.js /tmp/agent-shots --pin=1` and open `focus.png` and `list.png`. The digest's pills must be the row's pills.

- [ ] **Step 6: Commit and phase-close**

Run `npm test` and `npm run test:browser`. Then:

```bash
git add templates/agents.mrbl test-browser/agents-focus.test.js
git commit -m "One style per attribute: a Focus digest wears the row's pills, a chip hides them and keeps its dot."
```

---

# Phase B — panes and the board (spec §5, §6)

### Task 5: the focused pane is lit, the others dim

**Files:**
- Modify: `runtime/agent-ui.js` — beside the `:host([data-chrome="tile"])` rules (~line 1014).
- Modify: `templates/agents.mrbl` — `paintChrome`; CSS for `.dock-frame`, `.pane`, `.dock-bar`.
- Test: `test-browser/agents-panes.test.js`

**Interfaces:**
- Produces: `data-focused` on the focused `.dock-frame` / the `.pane` (single) and on that pane's `.dock-bar`; every `marble-conversation` in a pane carries `data-focused="true|false"`.

- [ ] **Step 1: Write the failing test**

Append to `test-browser/agents-panes.test.js`:

```js
test('the focused pane is lit and the others dim, in every view', async () => {
  const { page } = await openAgents(2);
  await dragOnto(page, 1, 'P', 'right');
  const read = () => page.evaluate(() => [...document.querySelectorAll('.dock-frame:not(.dock-ghost)')].map((f) => ({
    key: f.dataset.key, focused: f.hasAttribute('data-focused'), bg: getComputedStyle(f).backgroundColor,
  })));
  let frames = await read();
  assert.equal(frames.filter((f) => f.focused).length, 1, 'exactly one lit pane');
  const lit = frames.find((f) => f.focused);
  const dim = frames.find((f) => !f.focused);
  assert.notEqual(lit.bg, dim.bg, 'the dim pane has a different surface');
  await page.locator(`.dock-frame[data-key="${dim.key}"] .dock-bar`).click();
  frames = await read();
  assert.equal(frames.find((f) => f.key === dim.key).focused, true, 'clicking a bar focuses it');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  frames = await read();
  assert.equal(frames.filter((f) => f.focused).length, 1, 'still one lit pane on the board');
});
```

- [ ] **Step 2: Run to see it fail**

Expected: `exactly one lit pane` fails (0).

- [ ] **Step 3: Implement**

`paintChrome` (template):

```js
    const paintChrome = () => {
      const focusedKey = dock.focus === 'primary' ? PRIMARY : dock.extras[dock.focus]?.key;
      const mark = (el, on) => { if (!el) return; if (on) el.setAttribute('data-focused', ''); else el.removeAttribute('data-focused'); };
      mark(pane, !dock.extras.length || focusedKey === PRIMARY);
      mark(primaryFrame, focusedKey === PRIMARY);
      mark(pane.querySelector(':scope > .dock-bar'), focusedKey === PRIMARY);
      convo.setAttribute('data-focused', String(!dock.extras.length || focusedKey === PRIMARY));
      convo.setAttribute('data-chrome', !dock.extras.length || focusedKey === PRIMARY ? 'pane' : 'tile');
      dock.extras.forEach((extra, index) => {
        const on = dock.focus === index;
        mark(extra.el, on);
        mark(extra.el?.querySelector(':scope > .dock-bar'), on);
        extra.el?.querySelector('marble-conversation')?.setAttribute('data-focused', String(on));
        extra.el?.querySelector('marble-conversation')?.setAttribute('data-chrome', on ? 'pane' : 'tile');
      });
    };
```

Template CSS, beside `.dock-frame`:

```css
  /* The pane you are in is the lit one; its neighbours step back onto the
     paper so there is never a question of where typing goes. */
  .pane[data-dock] .dock-frame:not([data-focused]) { background: var(--paper); }
  .pane[data-dock] .dock-frame:not([data-focused]) .dock-bar { background: var(--paper-2); color: var(--muted); }
  .pane[data-dock] .dock-frame:not([data-focused]) marble-conversation { opacity: .86; }
  .pane[data-dock] > .dock-bar:not([data-focused]) { background: var(--paper-2); color: var(--muted); }
  .pane[data-dock] > marble-conversation:not([data-marble-transient])[data-focused="false"] { opacity: .86; }
  .dock-bar[data-focused] { box-shadow: inset 0 -1px 0 var(--accent); }
  .dock-frame, .dock-bar, marble-conversation { transition: background 200ms var(--ease-out), opacity 200ms var(--ease-out); }
```

`runtime/agent-ui.js`, beside the `data-chrome` rules:

```css
    :host([data-focused="false"]) .transcript { filter: saturate(.85); }
```

Call `paintChrome()` from `focusSlot` (after `paintOpen()`), so a bar click re-lights immediately.

- [ ] **Step 4: Run to see it pass; run the file whole and `agents-page.test.js`**

Expected: pass; `pane layout motion uses ease-out` still passes.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js templates/agents.mrbl test-browser/agents-panes.test.js
git commit -m "Light the focused pane and dim its neighbours, in every view."
```

### Task 6: the board opens into the rounded pane

**Files:**
- Modify: `templates/agents.mrbl` — CSS `body[data-view="board"][data-panel="open"] …` block (~line 686–705) and narrow rules (~1120–1135); markup: delete `.board-panel`; script: `openBoardPanel`, `closeBoardPanel`, the `panel-close` listener, the `boardPanel` references at boot (~5031, 5067, 5070); `closeSlot('primary')` when in board with no extras → `closeBoardPanel()`.
- Test: `test-browser/agents-page.test.js` — the three tests that wait for `.board-panel[data-open="true"]` (lines ~506, 524, 750, 775) wait for `body[data-panel="open"]` instead and the two `.board-panel marble-conversation` counts are deleted; the narrow test measures `.pane` only.

**Interfaces:**
- Produces: `body[data-panel="open"]` remains the open flag; the pane column is `.library` as today; the close is the primary `.dock-bar`'s `.dock-close`.

- [ ] **Step 1: Update the tests**

In `clicking a board card opens the conversation panel`: replace the `.board-panel[data-open="true"]` wait with `await page.waitForFunction(() => document.body.getAttribute('data-panel') === 'open');`, delete the `.board-panel marble-conversation` assertion, and add:

```js
  const paneShape = await page.evaluate(() => {
    const pane = document.querySelector('.pane');
    const cs = getComputedStyle(pane, '::before');
    return { radius: parseFloat(cs.borderRadius), bar: Boolean(document.querySelector('.pane > .dock-bar:not([hidden])')) };
  });
  assert.ok(paneShape.radius >= 12, `board pane is rounded, radius ${paneShape.radius}`);
  assert.equal(paneShape.bar, true, 'the pane carries its bar');
  await page.locator('.pane > .dock-bar .dock-close').click();
  await page.waitForFunction(() => !document.body.hasAttribute('data-panel'));
```

Make the same `.board-panel` → `data-panel` substitutions in the other three tests; in the narrow test, delete the `panel` measurements and keep the pane ones.

- [ ] **Step 2: Run to see them fail**

Expected: `.pane::before` radius is 0 on the board; the bar is hidden.

- [ ] **Step 3: Implement**

Delete `.board-panel` markup and its CSS. Replace the board split CSS:

```css
  body[data-view="board"][data-panel="open"] {
    grid-template-columns: minmax(0, 1fr) minmax(18rem, var(--panel-track));
  }
  body[data-view="board"][data-panel="open"] .board { grid-column: 1; grid-row: 2; min-width: 0; }
  body[data-view="board"][data-panel="open"] .library {
    display: grid; grid-column: 2; grid-row: 2;
    grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
    min-width: 0; z-index: 2; padding: 1rem 1rem 1rem 0; background: transparent; border: 0;
  }
  body[data-view="board"][data-panel="open"] .list { display: none; }
  /* The same pane List draws: rounded, shadowed, with its bar. */
  body[data-view="board"] .pane > .dock-bar,
  body[data-view="board"] .dock-frame .dock-bar { background: transparent; border-radius: var(--pane-r) var(--pane-r) 0 0; padding-left: .8rem; }
```

Find the rule that gives the List pane its `::before` card (`.pane::before { … border-radius: var(--pane-r) … }`, ~line 1046) and make sure its selector is not gated on `body[data-view="library"]`; if it is, add `body[data-view="board"]` to that selector list. Remove `box-shadow: none; border-radius: 0; padding-top: 0;` from the board pane rule.

Script: `openBoardPanel` / `closeBoardPanel` keep setting `body[data-panel]` and drop the `boardPanel` element. `closeSlot('primary')` with no extras in board view: call `closeBoardPanel()` before `open(null)`. Delete the `panel-close` listener and the two `boardPanel.setAttribute/removeAttribute` lines in the reconcile hook (keep the `document.body` `data-panel` lines there). Narrow rules: drop `.board-panel` lines; keep `body[data-view="board"][data-panel="open"] .column { display: none; }`.

- [ ] **Step 4: Run `agents-page.test.js` whole**

Expected: pass, including `the board panel does not overflow a narrow viewport`, `opening the board panel does not clone the conversation on reconcile`, `board view survives a file reconcile that still says library`.

- [ ] **Step 5: Look**

`node test-browser/shots.js /tmp/agent-shots` then in `probe.js` or a one-off: open a board card and screenshot. The pane must be the List pane, rounded, with a bar.

- [ ] **Step 6: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-page.test.js
git commit -m "The board opens into the same rounded pane as List, with its bar and close."
```

### Task 7: open beside, split into an empty pane, dock zone

**Files:**
- Modify: `templates/agents.mrbl` — `openRow` (in `upsert`), folder tab click, Focus card click, `BAR_MARKUP`, `makeBar`, `paintBar`, `normalizeExtras`, `makeLeaf`, `rememberDock`, `resolveDrop`, `paintDrop`, `endDrop`; CSS for `.dock-split`, `.board-dockzone`.
- Test: `test-browser/agents-page.test.js`, `test-browser/agents-panes.test.js`

**Interfaces:**
- Produces: `openBeside(id)`; `splitEmpty(key, side)`; `dock.extras[i].id === null` is a legal empty pane; `resolveDrop` returns `{ plan: { mode: 'fill', zone: true } }` over the board dock zone.

- [ ] **Step 1: Write the failing tests**

Append to `test-browser/agents-panes.test.js`:

```js
test('Alt-click opens a conversation beside the focused pane', async () => {
  const { page } = await openAgents(2);
  await page.locator('#list .conv').nth(1).click({ modifiers: ['Alt'] });
  await page.waitForFunction(() => document.querySelectorAll('.dock-frame:not(.dock-ghost)').length === 2);
  const rects = await cards(page);
  assert.equal(overlaps(rects), false);
  assert.equal(await page.locator('marble-conversation[conversation]').count(), 2);
});

test('split makes an empty pane, and the next row fills it', async () => {
  const { page } = await openAgents(2);
  await page.locator('.pane > .dock-bar .dock-split[data-side="right"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.dock-frame:not(.dock-ghost)').length === 2);
  const empty = page.locator('.dock-frame.dock-leaf marble-conversation:not([conversation])');
  assert.equal(await empty.count(), 1, 'the new pane is empty');
  assert.equal(await page.locator('.dock-frame.dock-leaf[data-focused]').count(), 1, 'and focused');
  await page.locator('#list .conv').nth(1).click();
  await page.locator('.dock-frame.dock-leaf marble-conversation[conversation]').waitFor();
  assert.equal(await page.locator('marble-conversation:not([conversation])').count(), 0);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.locator('.pane > marble-conversation[conversation]').waitFor();
});

test('split down stacks the empty pane under the pane', async () => {
  const { page } = await openAgents(1);
  await page.locator('.pane > .dock-bar .dock-split[data-side="bottom"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.dock-frame:not(.dock-ghost)').length === 2);
  const [a, b] = await cards(page);
  assert.ok(Math.abs(a.x - b.x) < 2 && a.y !== b.y, 'one above the other');
});
```

Append to `test-browser/agents-page.test.js`:

```js
test('with no pane open, dragging a board card to the right edge opens it there', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.update(id, { title: 'to dock' });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  const row = await page.locator(`.column .conv[data-id="${id}"]`).boundingBox();
  const board = await page.locator('.board').boundingBox();
  await page.mouse.move(row.x + 40, row.y + 12);
  await page.mouse.down();
  await page.mouse.move(row.x + 80, row.y + 40, { steps: 3 });
  await page.mouse.move(board.x + board.width - 30, board.y + board.height / 2, { steps: 10 });
  await page.locator('.board-dockzone[data-drop]').waitFor();
  await page.mouse.up();
  await page.waitForFunction(() => document.body.getAttribute('data-panel') === 'open');
  assert.equal(await page.locator('.pane marble-conversation').getAttribute('conversation'), id);
});
```

- [ ] **Step 2: Run to see them fail**

Expected: no `.dock-split`, no `.board-dockzone`, Alt-click replaces instead of splitting.

- [ ] **Step 3: Implement**

`openBeside`, near `dockAt`:

```js
    /** Alt-click anywhere: the chat lands beside the focused pane, on the
     *  pane's longer side. With nothing open it just opens. */
    const openBeside = async (id) => {
      if (!id) return;
      const hasPane = document.body.hasAttribute('data-open') && convo.getAttribute('conversation');
      if (!hasPane || narrowView.matches || reduceMotion.matches) return open(id);
      if (slotOf(id) != null) return open(id);
      const target = dock.focus === 'primary' ? PRIMARY : dock.extras[dock.focus]?.key ?? PRIMARY;
      dockAt(id, { target, side: restingSide(target) });
    };
```

Wire it: in `openRow` (inside `upsert`) take the event — `const openRow = (event) => { … if (event?.altKey) return openBeside(el.dataset.id); … }` and pass the event from both listeners (for keydown, `Enter` with `altKey`). Same in the folder tab click handler and the Focus card click (`selectFocusCard` — when `event.altKey`, `openBeside(id)` instead of select).

Empty panes: `makeLeaf` already tolerates `extra.id` null. `paintBar(bar, null)` → title `'Empty pane'`, no target. `normalizeExtras` matches by `extra.key` first (already), and for `extra.id == null` always mints a key. `rememberDock`: `extras: dock.extras.filter((extra) => extra.id).map(...)`, and set `tree: null` when any extra is empty (the tree would name a leaf that will not come back). `treeToSaved`: unchanged.

```js
    const splitEmpty = (key, side) => {
      const k = newKey();
      dock.extras.push({ key: k, id: null });
      dock.tree = insertBeside(cloneTree(treeOf()), key, side, k);
      dock.focus = slotOfKey(k);
      rememberDock();
      applyDock();
      paintOpen();
    };
```

`BAR_MARKUP`: add before the close button

```html
<button type="button" class="dock-split" data-side="right" aria-label="Split right" title="Split right"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 3v10" stroke="currentColor" stroke-width="1.4"/></svg></button><button type="button" class="dock-split" data-side="bottom" aria-label="Split down" title="Split down"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 8h12" stroke="currentColor" stroke-width="1.4"/></svg></button>
```

In `makeBar`: `for (const b of bar.querySelectorAll('.dock-split')) b.addEventListener('click', (e) => { e.stopPropagation(); splitEmpty(bar.dataset.key, b.dataset.side); });`. CSS: `.dock-split { appearance: none; border: 0; background: none; color: var(--faint); width: 1.4rem; height: 1.4rem; border-radius: 8px; cursor: pointer; display: grid; place-items: center; } .dock-split:hover { color: var(--ink); background: var(--paper-3); }`. `open(id)` when `dock.focus` names an empty extra already writes into it (`dock.extras[dock.focus].id = id`).

Dock zone — in `resolveDrop`, before the `hasPane` check:

```js
      if (view() === 'board' && !document.body.hasAttribute('data-panel')) {
        const b = boardEl.getBoundingClientRect();
        if (clientX >= b.right - b.width * 0.12 && clientX <= b.right && clientY >= b.top && clientY <= b.bottom) {
          return { plan: { mode: 'fill', zone: true } };
        }
        return none;
      }
```

(`view()` is `document.body.getAttribute('data-view') || 'library'`; define it if absent.) `paintDrop`: when `plan?.zone`, ensure a `.board-dockzone` (transient `div` appended to `boardEl`, `position:absolute; top:1rem; bottom:1rem; right:1rem; width: min(38vw, 28rem); border: 1.5px dashed color-mix(in srgb, var(--accent-ink) 50%, transparent); border-radius: var(--pane-r); background: color-mix(in srgb, var(--accent-ink) 7%, var(--paper)); pointer-events: none;`) with `data-drop` set; otherwise remove `data-drop`. While any conv drag is live in board with no panel, create the zone (without `data-drop`) so it is visible as a target; `endDrop` removes it. `dropOnto` with `mode: 'fill'` in board: `openBoardPanel(); open(id);`.

- [ ] **Step 4: Run the two files whole**

Expected: pass; `the arrangement is remembered across a reload` still passes.

- [ ] **Step 5: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-panes.test.js test-browser/agents-page.test.js
git commit -m "Three more ways to a pane: Alt-click opens beside, a bar splits into an empty pane, the board's edge docks a drag."
```

### Task 8: the board stacks when thin, and columns make room

**Files:**
- Modify: `templates/agents.mrbl` — CSS `.board[data-stack]`; a `ResizeObserver` on `boardEl` in the boot code; `upsert` → column FLIP; `test-browser/shots.js` `--stack`.
- Test: `test-browser/agents-page.test.js`

**Interfaces:**
- Produces: `.board[data-stack]` when `boardEl.clientWidth < 3 * MIN_COL + 2 * gap`; `flipColumns(el, run)` used by `upsert`.

- [ ] **Step 1: Write the failing tests**

```js
test('a thin board stacks its columns and scrolls as one', async () => {
  const { page } = await openAgents({ viewport: { width: 980, height: 800 } });
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.update(id, { title: 'stacked' });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  assert.equal(await page.locator('.board[data-stack]').count(), 0, 'wide enough for three columns');
  await page.locator(`.column .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.getAttribute('data-panel') === 'open');
  await page.locator('.board[data-stack]').waitFor();
  const cols = await page.evaluate(() => [...document.querySelectorAll('.column')].map((c) => c.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y) })));
  assert.ok(cols[0].x === cols[1].x && cols[1].x === cols[2].x, 'one column of three');
  assert.ok(cols[0].y < cols[1].y && cols[1].y < cols[2].y, 'stacked in order');
});

test('a card changing column animates into place', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  await page.evaluate((cid) => window.marble.agent.send(cid, { prompt: 'script:answer', target: 'garden', viewing: 'Agents', selection: [] }), id);
  await page.locator(`.column[data-col="running"] .conv[data-id="${id}"]`).waitFor();
  const moved = await page.evaluate((cid) => new Promise((resolve) => {
    const el = document.querySelector(`.conv[data-id="${cid}"]`);
    const tick = () => {
      const anim = el.getAnimations().find((a) => a.effect?.getKeyframes?.().some((k) => k.transform));
      if (anim && el.closest('.column')?.dataset.col === 'review') resolve(anim.effect.getTiming().duration);
      else requestAnimationFrame(tick);
    };
    tick();
  }), id);
  assert.ok(moved > 0 && moved <= 420, `column move animates (${moved}ms)`);
});
```

- [ ] **Step 2: Run to see them fail**

Expected: no `data-stack`; no animation on the moved card.

- [ ] **Step 3: Implement**

CSS:

```css
  /* Too thin for three abreast — one column of three stages, scrolling as one. */
  .board[data-stack] { flex-direction: column; overflow-y: auto; overflow-x: hidden; gap: .75rem; }
  .board[data-stack] .column { flex: none; min-width: 0; overflow: visible; }
  .board[data-stack] .column h2 { position: sticky; top: -.7rem; }
  .board[data-stack] .rz-col { display: none !important; }
```

Boot, after `boardEl` exists:

```js
    const BOARD_MIN_COL = 14 * 16;
    const fitBoard = () => {
      const gap = 16;
      boardEl.toggleAttribute('data-stack', boardEl.clientWidth > 0 && boardEl.clientWidth < 3 * BOARD_MIN_COL + 2 * gap + 32);
    };
    new ResizeObserver(fitBoard).observe(boardEl);
    fitBoard();
```

Column FLIP — in `upsert`, wrap the `place(el)` call:

```js
      const wasIn = el.parentElement;
      const first = view() === 'board' && wasIn ? captureRects() : null;
      place(el);
      if (first && el.parentElement !== wasIn && !reduceMotion.matches) {
        playFlip(first, boardOrder(), { duration: 240, stagger: 0 });
      }
```

and give `playFlip` an options argument: `const playFlip = (first, ordered, { duration = FLIP_MS, stagger = STAGGER_MS } = {}) => { … duration, delay: Math.min(index, 7) * stagger … }`.

`shots.js`: `--stack` sets viewport `{ width: 980, height: 900 }` and opens the first board card before the board shot.

- [ ] **Step 4: Run `agents-page.test.js` whole**

Expected: pass; `toggling twice during FLIP keeps one node on the library` still passes.

- [ ] **Step 5: Phase-close**

`npm test`, `npm run test:browser` (rerun the known flake alone if it times out). Then:

```bash
git add templates/agents.mrbl test-browser/agents-page.test.js test-browser/shots.js
git commit -m "A thin board stacks its three stages; a card changing stage animates into its column."
```

---

# Phase C — hover and drag (spec §7.1, §7.4)

### Task 9: hover never resizes; size animates; the lift survives the spring

**Files:**
- Modify: `runtime/agent-folders.js` — `assignLods`.
- Modify: `templates/agents.mrbl` — `paintFocus` (pass `hoveredId: null`), `animateFocusCard`, `springCardTo`, CSS `.focus-card:hover`, `[data-lift]`.
- Test: `test/agent-folders.test.js`, `test-browser/agents-focus.test.js`

**Interfaces:**
- Produces: `assignLods(cards, ctx)` ignores `ctx.hoveredId`; `animateFocusCard(card, from, to, velocity)` animates size.

- [ ] **Step 1: Write the failing tests**

`test/agent-folders.test.js`, after the `assignLods` tests:

```js
test('assignLods does not promote a hovered card — hover informs, selection commits', () => {
  const cards = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, lastInteractedAt: 0, updatedAt: 0 }));
  const cold = F().assignLods(cards, { fullIds: [], selectedIds: [], hoveredId: 'c7', now: 1e12 });
  const plain = F().assignLods(cards, { fullIds: [], selectedIds: [], hoveredId: null, now: 1e12 });
  assert.deepEqual(cold, plain);
});
```

`test-browser/agents-focus.test.js`:

```js
test('hovering a chip lifts it without resizing it or moving its neighbours', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, Array.from({ length: 7 }, (_, i) => ({ key: `c${i}`, title: `card ${i}` })));
  await page.waitForFunction(() => [...document.querySelectorAll('.focus-card')].some((el) => el.dataset.lod === 'chip'));
  const chip = page.locator('.focus-card[data-lod="chip"]').first();
  const before = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].map((el) => [el.dataset.id, el.getBoundingClientRect().top, el.getBoundingClientRect().height]));
  await chip.hover();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].map((el) => [el.dataset.id, el.getBoundingClientRect().top, el.getBoundingClientRect().height]));
  assert.deepEqual(after, before, 'nothing moved or grew');
  assert.equal(await chip.getAttribute('data-lod'), 'chip');
});

test('selecting a chip grows it with an animation, not a snap', async () => {
  const { page } = await openAgents();
  await seedFocus(page, Array.from({ length: 7 }, (_, i) => ({ key: `c${i}`, title: `card ${i}` })));
  await page.waitForFunction(() => [...document.querySelectorAll('.focus-card')].some((el) => el.dataset.lod === 'chip'));
  const chip = page.locator('.focus-card[data-lod="chip"]').first();
  const id = await chip.getAttribute('data-id');
  await chip.click();
  const grew = await page.evaluate((cid) => new Promise((resolve) => {
    const el = document.querySelector(`.focus-card[data-id="${cid}"]`);
    const tick = () => {
      const anim = el.getAnimations().find((a) => a.effect?.getKeyframes?.().some((k) => 'height' in k));
      if (anim) resolve(anim.effect.getTiming().duration);
      else requestAnimationFrame(tick);
    };
    tick();
  }), id);
  assert.ok(grew >= 200 && grew <= 400, `height animates (${grew}ms)`);
});
```

- [ ] **Step 2: Run to see them fail**

Expected: hover promotes to digest and moves neighbours; no height animation.

- [ ] **Step 3: Implement**

`assignLods`: delete `card.id === hoveredId ||` from `alwaysDigest` (keep destructuring `hoveredId` so the signature reads the same). In `paintFocus`, pass `hoveredId: null`; leave the `pointerenter` listeners (they still drive `focusHoveredId` for Quick Look) but make `paintFocus({ quiet: true })` there a no-op by removing those two calls.

CSS:

```css
  .focus-card:hover { box-shadow: var(--shadow-lift); }
  .focus-card { --lift: 1; }
  .focus-card[data-lift="lead"] { --lift: 1.02; transform: scale(var(--lift)); }
```

`springCardTo`: write `card.style.transform = \`translate(${x - to.x}px, ${y - to.y}px) scale(var(--lift, 1))\`;` and on settle `card.style.transform = ''`.

`animateFocusCard`:

```js
    const animateFocusCard = (card, from, to, velocity) => {
      if (!from) {
        card.style.left = `${to.x}px`; card.style.top = `${to.y}px`;
        card.style.width = `${to.w}px`; card.style.height = `${to.h}px`;
        return;
      }
      const resized = Math.abs(from.w - to.w) > 0.5 || Math.abs(from.h - to.h) > 0.5;
      springCardTo(card, to, velocity);
      if (resized && !reduceMotion.matches) {
        card.animate(
          [{ width: `${from.w}px`, height: `${from.h}px` }, { width: `${to.w}px`, height: `${to.h}px` }],
          { duration: 280, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
        );
        card.querySelector('.focus-card-body')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 120, fill: 'backwards' });
      }
    };
```

`stopCardSpring` already cancels `card.getAnimations()`, so a spring restart also cancels a running size animation; in `flattenCardMotion` the live box is read first, so the restart resumes from the mid-size.

- [ ] **Step 4: Run both test files**

Expected: pass, including the existing `click selects a Focus card…` and `assignLods never chips a selected, running, or review card`.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-folders.js templates/agents.mrbl test/agent-folders.test.js test-browser/agents-focus.test.js
git commit -m "Hover lifts a Focus card without resizing it; a size change animates; the lift survives the spring."
```

### Task 10: optimistic drop and slot hysteresis

**Files:**
- Modify: `runtime/agent-folders.js` — `steadySlot`.
- Modify: `templates/agents.mrbl` — `commitFocusDrop`, `finish` in `bindFocusCard`, `aim`.
- Test: `test/agent-folders.test.js`, `test-browser/agents-focus.test.js`

**Interfaces:**
- Produces: `steadySlot(prev, next, point, band = 8) → next | prev` — keeps `prev` when `next` differs only by one index and the point is within `band` px of the boundary that `prev` recorded (`prev.edge`). `slotAt` returns the boundary it decided on as `edge` (the `y` it already computes).

- [ ] **Step 1: Write the failing tests**

`test/agent-folders.test.js`:

```js
test('steadySlot holds the current slot while the pointer hovers a midline', () => {
  const prev = { key: 'folder:a:2', index: 2, edge: 300 };
  const flip = { key: 'folder:a:3', index: 3, edge: 300 };
  assert.equal(F().steadySlot(prev, flip, { y: 305 }), prev, 'within the band, the old answer stands');
  assert.equal(F().steadySlot(prev, flip, { y: 312 }), flip, 'past it, the new one wins');
  assert.equal(F().steadySlot(prev, { key: 'folder:b:0', index: 0, edge: 40 }, { y: 305 }).key, 'folder:b:0', 'a different column is never held');
  assert.equal(F().steadySlot(null, flip, { y: 305 }), flip);
});
```

`test-browser/agents-focus.test.js`:

```js
test('a drop springs home before the PATCH round trip completes', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [{ key: 'a', title: 'first' }, { key: 'b', title: 'second' }, { key: 'c', title: 'third' }]);
  await page.evaluate(() => {
    const agent = window.marble.agent;
    const real = agent.update.bind(agent);
    window.__slow = [];
    agent.update = (id, body) => new Promise((resolve) => { window.__slow.push(() => resolve(real(id, body))); });
  });
  const target = await page.locator(`.focus-card[data-id="${ids.a}"]`).boundingBox();
  const release = await dragTo(page, ids.c, { x: target.x + target.width / 2, y: target.y + 6 });
  await release();
  await page.waitForTimeout(600);
  const order = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].sort((p, q) => p.getBoundingClientRect().top - q.getBoundingClientRect().top).map((el) => el.dataset.id));
  assert.equal(order[0], ids.c, 'the card is in its slot while the PATCH is still pending');
  await page.evaluate(() => { for (const go of window.__slow) go(); });
});
```

- [ ] **Step 2: Run to see them fail**

Expected: `steadySlot is not a function`; the card is not at the top until the PATCH resolves.

- [ ] **Step 3: Implement**

`runtime/agent-folders.js` (export on `marbleAgentFolders`):

```js
  /** A slot answer near the boundary that produced the last one is the same
   *  answer. Without this, a pointer resting on a card's midline opens and
   *  closes the gap on every pixel. */
  const steadySlot = (prev, next, point, band = 8) => {
    if (!prev || !next) return next;
    if (prev.column !== next.column || (prev.folderId ?? null) !== (next.folderId ?? null)) return next;
    if (Math.abs((next.index ?? 0) - (prev.index ?? 0)) !== 1) return next;
    if (!Number.isFinite(prev.edge)) return next;
    const axis = prev.column === 'stage' ? point.x : point.y;
    return Math.abs(axis - prev.edge) <= band ? prev : next;
  };
```

`focusTargetAt` (template): include `edge: slot.y` on folder answers and `edge: slot.x` on stage answers. In `aim()`: `const next = helpers.steadySlot(focusDrag.target, focusTargetAt(point), point);`.

`commitFocusDrop`: collect `[id, body]` pairs into `const writes = []` instead of awaiting `patch` inline (mutate local state exactly as today), and at the end:

```js
      return writes;
```

`finish` in `bindFocusCard`:

```js
          const writes = target ? await commitFocusDrop(drag.ids, target) : [];
          paintFocus({ velocity: speed, velocityId: drag.lead });
          await Promise.all((writes ?? []).map(([id, body]) => agent.update(id, body).catch(() => {})));
```

(`commitFocusDrop` still awaits `createFolder` for the merge/new cases before returning, because the folder id is needed for the paint.)

- [ ] **Step 4: Run both files whole**

Expected: pass, including every existing drag test.

- [ ] **Step 5: Phase-close**

`npm test`, `npm run test:browser`. Then:

```bash
git add runtime/agent-folders.js templates/agents.mrbl test/agent-folders.test.js test-browser/agents-focus.test.js
git commit -m "A Focus drop paints before it files, and a slot holds steady on a midline."
```

---

# Phase D — the Focus field and stage (spec §7.2, §7.3)

### Task 11: regions follow their content, packed down then across

**Files:**
- Modify: `runtime/agent-folders.js` — `packFocus` (the `regions` loop), new `regionAt`.
- Test: `test/agent-folders.test.js`

**Interfaces:**
- Produces: `packFocus(...)` → regions with `{ folderId, x, y, w, h, col, inner, cards }` where `h` is content height (≤ inner canvas height); `regionAt(pack, point) → region | null` — the region containing the point (gap tolerance) else the nearest by rect distance.

- [ ] **Step 1: Write the failing tests**

Replace the test `a deep folder wraps into a second sub-column, never a second row` body's title with `a deep folder wraps into a second sub-column` (keep its assertions) and append:

```js
test('two small folders sit one above the other, not in two mostly-empty columns', () => {
  const two = [
    { folderId: 'aaaaaaaaaaaa', cards: cards('a', 2, 'digest') },
    { folderId: 'bbbbbbbbbbbb', cards: cards('b', 2, 'digest') },
  ];
  const { regions } = pack({ groups: two });
  assert.equal(regions.length, 2);
  assert.equal(Math.round(regions[0].x), Math.round(regions[1].x), 'same field column');
  assert.ok(regions[1].y >= regions[0].y + regions[0].h, 'the second sits below the first');
  assert.ok(regions[0].h < CANVAS.h * 0.6, 'a region is as tall as its content');
  assert.equal(regions[0].col, 0);
  assert.equal(regions[1].col, 0);
});

test('a region that does not fit under the previous one starts the next field column', () => {
  const groups = [
    { folderId: 'aaaaaaaaaaaa', cards: cards('a', 4, 'digest') },
    { folderId: 'bbbbbbbbbbbb', cards: cards('b', 4, 'digest') },
    { folderId: null, cards: cards('u', 1, 'chip') },
  ];
  const { regions } = pack({ groups });
  assert.ok(regions[1].x > regions[0].x || regions[1].y >= regions[0].y + regions[0].h);
  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) assert.equal(overlap(regions[i], regions[j]), false, `${i} overlaps ${j}`);
  }
  assert.equal(regions.at(-1).folderId, null, 'ungrouped is last');
  for (const region of regions) assert.ok(region.y + region.h <= CANVAS.h, 'nothing runs past the canvas');
});

test('regionAt answers the region under a point, else the nearest', () => {
  const two = [
    { folderId: 'aaaaaaaaaaaa', cards: cards('a', 2, 'digest') },
    { folderId: 'bbbbbbbbbbbb', cards: cards('b', 2, 'digest') },
  ];
  const packed = pack({ groups: two });
  const [a, b] = packed.regions;
  assert.equal(F().regionAt(packed, { x: a.x + 5, y: a.y + 5 }).folderId, a.folderId);
  assert.equal(F().regionAt(packed, { x: b.x + 5, y: b.y + b.h + 200 }).folderId, b.folderId, 'below everything → nearest');
  assert.equal(F().regionAt({ regions: [] }, { x: 0, y: 0 }), null);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/agent-folders.test.js`
Expected: regions share `y` and each is full height; `regionAt` missing.

- [ ] **Step 3: Implement**

In `packFocus`, replace the `regions` loop:

```js
    // A region is as tall as what it holds. Regions pack down a field column
    // and start the next column when the canvas runs out — so two small
    // folders share a column instead of each taking a tall, mostly empty one.
    const regions = [];
    let colIndex = 0;
    let colX = x;
    let colTop = top;
    let colW_ = 0;
    for (const group of shaped) {
      const w = group.stacks.length * colW + (group.stacks.length - 1) * gap + 2 * PAD;
      const tallest = Math.max(...group.stacks.map((stack) => stack.reduce((n, card) => n + cardHeight(card, sizes) + gap, 0) - gap), 0);
      const h = Math.min(availH, tallest + NAME_H + 2 * PAD);
      if (regions.length && colTop + h > top + availH + 0.01) {
        colIndex += 1;
        colX += colW_ + gap;
        colTop = top;
        colW_ = 0;
      }
      const region = {
        folderId: group.folderId,
        x: colX, y: colTop, w, h, col: colIndex,
        inner: { x: colX + PAD, y: colTop + PAD + NAME_H, w: w - 2 * PAD, h: h - NAME_H - 2 * PAD },
        cards: [],
      };
      group.stacks.forEach((stack, si) => {
        const cx = colX + PAD + si * (colW + gap);
        let cy = colTop + PAD + NAME_H;
        for (const card of stack) {
          const ch = cardHeight(card, sizes);
          const rect = { id: card.id, x: cx, y: cy, w: colW, h: ch };
          region.cards.push(rect);
          rects[card.id] = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
          cy += ch + gap;
        }
      });
      regions.push(region);
      colTop += h + gap;
      colW_ = Math.max(colW_, w);
    }
    x = regions.length ? colX + colW_ + gap : x;
```

`fixed` (the width budget) counts `shaped.length - 1` region gaps; leave it — it over-reserves slightly when regions stack, which only gives conversations more room.

```js
  const regionAt = (pack, point, gap = GAP) => {
    const regions = pack?.regions ?? [];
    if (!regions.length) return null;
    const hit = regions.find((r) => point.x >= r.x - gap && point.x <= r.x + r.w + gap && point.y >= r.y - gap && point.y <= r.y + r.h + gap);
    if (hit) return hit;
    const dist = (r) => Math.hypot(
      Math.max(r.x - point.x, 0, point.x - (r.x + r.w)),
      Math.max(r.y - point.y, 0, point.y - (r.y + r.h)),
    );
    return regions.reduce((best, r) => (dist(r) < dist(best) ? r : best), regions[0]);
  };
```

Export `regionAt`.

- [ ] **Step 4: Run the node tests**

Expected: all pass, including `packFocus gives every folder a column no other column touches` (regions still never overlap) and `the field never starts above the stage` — revise that one: the first region starts at `stage.y`; regions below it do not. Change its assertion to `assert.ok(region.x >= stage.x + stage.w)` only, and add `assert.equal(Math.round(regions[0].y), Math.round(stage.y))`.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-folders.js test/agent-folders.test.js
git commit -m "Focus regions are as tall as their content and pack down a column before starting the next."
```

### Task 12: the page uses the new field

**Files:**
- Modify: `templates/agents.mrbl` — `focusTargetAt` (2-D via `regionAt`), `paintFocusBasins` (nothing structural; it already paints `region.x/y/w/h`), `moveFocusCard` (unchanged), `sizeFocusExtent` (unchanged).
- Test: `test-browser/agents-focus.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('two two-card folders share a field column, one above the other', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [
    { key: 'a1', title: 'a one' }, { key: 'a2', title: 'a two' },
    { key: 'b1', title: 'b one' }, { key: 'b2', title: 'b two' },
  ]);
  await page.evaluate(async (seeded) => {
    await window.marble.agent.createFolder({ conversationIds: [seeded.a1, seeded.a2], name: 'A' });
    await window.marble.agent.createFolder({ conversationIds: [seeded.b1, seeded.b2], name: 'B' });
  }, ids);
  await page.waitForFunction(() => document.querySelectorAll('.focus-basin').length === 2);
  await page.waitForTimeout(400);
  const basins = await page.evaluate(() => [...document.querySelectorAll('.focus-basin')].map((b) => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) }; }));
  assert.equal(basins[0].x, basins[1].x, 'same column');
  assert.ok(basins[1].y >= basins[0].y + basins[0].h, 'stacked');
  // And a drop into the lower basin still joins that folder.
  const lower = basins[1];
  const release = await dragTo(page, ids.a1, { x: lower.x + 60, y: lower.y + lower.h - 30 });
  await page.locator('.focus-basin[data-drop="into"]').waitFor();
  await release();
  await until(page, async () => (await metaOf(page, ids.a1))?.folderId === (await metaOf(page, ids.b1))?.folderId, 'a1 to join B');
});
```

- [ ] **Step 2: Run to see it fail**

Expected: basins side by side (until Task 11's packer is wired — it is already imported, so the first two assertions may already pass; the drop assertion fails because `focusTargetAt` picks by `x` only).

- [ ] **Step 3: Implement**

In `focusTargetAt`, replace the `zones` block:

```js
      const inStage = pack.stage.w > 0 && stageStays.length
        && point.x >= pack.stage.x - gap && point.x <= pack.stage.x + pack.stage.w + gap;
      if (inStage) {
        const slot = helpers.stageSlotAt(pack.stage, point, gap);
        const index = drop(pack.stage.cols, slot.index);
        return { column: 'stage', index, key: `stage:${index}`, edge: slot.x };
      }
      if (pack.newGroup && point.x >= pack.newGroup.x - gap && point.x <= pack.newGroup.x + pack.newGroup.w + gap) {
        return { column: 'new', key: 'new' };
      }
      const region = helpers.regionAt(pack, point, gap);
      if (!region) return null;
```

and keep the folder-slot code that follows (`slotAt(region, point, gap)` …), adding `edge: slot.y` to the returned object.

- [ ] **Step 4: Run the focus file whole**

Expected: pass — `Focus basins are regions that never overlap or leave the canvas`, `dragging a card into another folder's column joins that folder`, `dropping on the New group column makes a folder` all still hold.

- [ ] **Step 5: Look**

`node test-browser/shots.js /tmp/agent-shots` — `focus.png`: Research and Marble must share a column or sit beside each other only because the column filled.

- [ ] **Step 6: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-focus.test.js
git commit -m "Focus drops are found in two dimensions, so a folder below another is a target."
```

### Task 13: the stage is the pane tree

**Files:**
- Modify: `templates/agents.mrbl` — `layoutFocusPane`, `paintFocus` (stage width from the tree), `focusColumnsOf` (stage from `dock`), `pinFocus`, `unpinFocus`, `commitFocusDrop` stage branch, `focusTargetAt` stage branch (`resolveDrop`), `applyDock` (`view === 'focus'` branch), `rememberDock`/restore keyed by view, `makeFocusCard` (drop `.focus-live`), CSS for `.focus-card[data-lod="full"]`.
- Modify: `runtime/agent-folders.js` — nothing; `packFocus` takes `fulls` = one entry per stage column.
- Test: `test-browser/agents-focus.test.js`

**Interfaces:**
- Consumes: `dockAt`, `insertBeside`, `resolveDrop`, `layoutOf`, `paintChrome` (Task 5), `openBeside` (Task 7).
- Produces: in Focus, `dock.extras` are the pins beyond the primary; `dock.tree` is the stage arrangement; `stageColumns(tree) → number`.

- [ ] **Step 1: Write the failing tests**

Replace `a pinned conversation is a full-height column beside the field, not a band above it` assertions on `.focus-live` (if any) with the pane, and append:

```js
test('pinning makes a pane in the stage, and a second pin sits beside it by default', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [{ key: 'a', title: 'first' }, { key: 'b', title: 'second' }, { key: 'c', title: 'loose' }]);
  await page.locator(`.focus-card[data-id="${ids.a}"]`).dblclick();
  await page.locator(`.pane marble-conversation[conversation="${ids.a}"]`).waitFor();
  await page.locator(`.focus-card[data-id="${ids.b}"]`).dblclick({ modifiers: ['Shift'] });
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)').length === 2);
  await page.waitForTimeout(600);
  const frames = await page.evaluate(() => [...document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)')].map((f) => { const r = f.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) }; }));
  assert.equal(frames[0].y, frames[1].y, 'side by side');
  assert.ok(frames[0].h > 400, 'a conversation is a tall thing');
  assert.equal(await page.locator('.pane .dock-frame[data-focused]').count(), 1);
});

test('dropping a card on the bottom band of a stage pane stacks it under', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [{ key: 'a', title: 'first' }, { key: 'b', title: 'second' }]);
  await page.locator(`.focus-card[data-id="${ids.a}"]`).dblclick();
  await page.locator(`.pane marble-conversation[conversation="${ids.a}"]`).waitFor();
  const paneBox = await page.locator('.pane').boundingBox();
  const release = await dragTo(page, ids.b, { x: paneBox.x + paneBox.width / 2, y: paneBox.y + paneBox.height * 0.92 });
  await page.locator('.pane .dock-ghost').waitFor();
  await release();
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost):not(.marble-leaving)').length === 2);
  await page.waitForTimeout(700);
  const frames = await page.evaluate(() => [...document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)')].map((f) => { const r = f.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }));
  assert.equal(frames[0].x, frames[1].x, 'one column');
  assert.notEqual(frames[0].y, frames[1].y, 'stacked');
  await until(page, async () => (await metaOf(page, ids.b))?.pinned === true, 'b to be pinned');
  const stageW = await page.evaluate(() => document.querySelector('.pane').getBoundingClientRect().width);
  assert.ok(stageW <= 560 + 2, `two stacked pins take one column's width (${stageW})`);
});

test('the Focus arrangement and the List arrangement do not overwrite each other', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [{ key: 'a', title: 'first' }, { key: 'b', title: 'second' }]);
  await page.locator(`.focus-card[data-id="${ids.a}"]`).dblclick();
  await page.locator(`.focus-card[data-id="${ids.b}"]`).dblclick({ modifiers: ['Shift'] });
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)').length === 2);
  await page.locator('.views [data-view="library"]').click();
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'library');
  assert.equal(await page.locator('.pane .dock-frame:not(.dock-ghost)').count(), 0, 'List is one pane');
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)').length === 2);
});
```

- [ ] **Step 2: Run to see them fail**

Expected: no `.dock-frame` in the Focus pane; the stage pane has no ghost.

- [ ] **Step 3: Implement**

Dock per view — keep two dock records: `docks = { page: { tree, extras, focus }, focus: { tree, extras, focus } }` and make `dock` a getter over the current view: `const dockFor = (view) => (view === 'focus' ? docks.focus : docks.page);` and replace `let dock = …` with `let dock = docks.page;`. In `applyLayout` inside `setView`, before `applyDock()`: `dock = dockFor(next);`. `rememberDock` writes both under `DOCK_KEY` as `{ v: 3, page: …, focus: … }`; the restore code reads `v: 3` (and treats `v: 2` as `page`).

`applyDock`'s `view === 'focus'` branch: instead of returning after `leaveTreeMode()`, run the same tree path as other views (the pane is positioned by `layoutFocusPane`; the tree lays out inside it). Delete the early return; keep `handOver?.ghost.remove()` out (the ghost is wanted).

`focusColumnsOf`: the stage is `[primaryId, ...dock.extras.map((e) => e.id)]` filtered to items that are pinned and present, in `layoutOf(dock.tree)` left-to-right/top-to-bottom order for ranking (`leaves` sorted by `x` then `y`). Pinned items not in the dock (e.g. after a reload) are added: primary first, others as extras — do this in a `syncStageDock(items)` called at the top of `paintFocus`:

```js
    const syncStageDock = (items) => {
      const pinned = items.filter((item) => item.pinned).sort((a, b) => (a.focusY ?? 1) - (b.focusY ?? 1)).slice(0, FULL_CAP).map((item) => item.id);
      const have = [convo.getAttribute('conversation'), ...dock.extras.map((e) => e.id)].filter(Boolean);
      if (pinned.join() === have.join()) return;
      const [primary, ...rest] = pinned;
      if (primary) convo.setAttribute('conversation', primary); else convo.removeAttribute('conversation');
      dock.extras = rest.map((id) => dock.extras.find((e) => e.id === id) ?? { id });
      dock.tree = pinned.length > 1 ? reconcileTree(dock.tree, [PRIMARY, ...dock.extras.map((e) => e.key).filter(Boolean)]) : null;
      if (typeof dock.focus === 'number' && !dock.extras[dock.focus]) dock.focus = 'primary';
      openId = primary ?? null;
      if (primary) document.body.setAttribute('data-open', 'true'); else document.body.removeAttribute('data-open');
    };
```

`stageColumns(tree)`:

```js
    const stageColumns = (tree) => {
      if (!tree) return 1;
      const xs = new Set([...layoutOf(tree).leaves.values()].map((r) => Math.round(r.x * 1000)));
      return Math.max(1, xs.size);
    };
```

`paintFocus`: `fulls` passed to `packFocus` becomes `Array.from({ length: fullIds.length ? stageColumns(dock.tree) : 0 }, (_, i) => ({ id: `stage${i}` }))` — the packer only needs the count; the stage rect is `pack.stage`. Full cards no longer get a rect from the packer: place each Full card at `pack.stage` (all of them; they sit under the pane and only show while dragging).

`layoutFocusPane(fullIds)`: position `pane` at `pack.stage` (fixed coords: canvas rect + stage x/y − scroll), `display: grid`, then `applyDock()`; the `.focus-live` loop is deleted. `makeFocusCard`: delete `<div class="focus-live"></div>`; CSS: delete the `.focus-live` rules and `.focus[data-arranging] … .focus-live` rules; `.focus-card[data-lod="full"] { z-index: 3 }` stays.

`pinFocus(id, { keepOpen })`: after the PATCHes, `syncStageDock(matchingFocusItems())` runs via `paintFocus` — but the *arrangement* for a new pin is `reconcileTree` splitting off the focused leaf on its longer side, which for a wide pane is `right` — the default "side by side". `unpinFocus`: `closeSlot(slotOf(id))` when the id is in the dock, then PATCH `pinned: false`.

`focusTargetAt` stage branch: when `stageStays.length`, and the point is inside the pane's client rect, ask `resolveDrop(clientX, clientY, leadId)`: if it returns a `split`/`swap` plan, return `{ column: 'stage', plan, key: \`stage:${roomKey(plan)}\` }` and call `paintDrop(clientX, clientY, leadId)` so the ghost opens; otherwise `{ column: 'stage', index: stageStays.length, key: 'stage:end' }`. When the target leaves the stage, call `endDrop(false)` once. (`aim()` has the client point in `focusDrag.point`.)

`commitFocusDrop` stage branch: if `target.plan`, PATCH `pinned: true` for the ids and call `dockAt(ids[0], target.plan)`; else keep today's rank logic. `pending` for the gap stays `column: 'stage'` (the field opens no gap for a stage target).

`FULL_CAP` cap: `syncStageDock` slices to 4; a fifth pin unpins the last leaf as `commitFocusDrop` does today.

- [ ] **Step 4: Run the focus, panes and page files**

Expected: pass, including `with nothing pinned, Focus has no stage band and hides the live pane`, `narrow Focus is a stack and does not add extra panes`, `reduced motion pins without transform travel`, `dragging a card to the stage pins it, and dragging it back off unpins it`.

- [ ] **Step 5: Look**

`node test-browser/shots.js /tmp/agent-shots --pin=2` — `focus.png` shows two rounded panes with bars in the stage.

- [ ] **Step 6: Phase-close**

`npm test`, `npm run test:browser`. Then:

```bash
git add templates/agents.mrbl test-browser/agents-focus.test.js
git commit -m "The Focus stage is the pane tree: pins are panes, and a pane can stack under another."
```

---

# Phase E — transitions (spec §8)

### Task 14: every conversation morphs between views

**Files:**
- Modify: `templates/agents.mrbl` — `setView` (third path), new `morphViews`, `cancelFlip`, CSS `.vt-layer`, `.vt-ghost`.
- Create: `test-browser/agents-transitions.test.js`

**Interfaces:**
- Produces: `morphViews(current, next, applyLayout)`; `representationsOf(view) → Map<id, Element>`.

- [ ] **Step 1: Write the failing tests**

`test-browser/agents-transitions.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const openAgents = async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const out = [];
    for (const title of ['one', 'two', 'three']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
      out.push(id);
    }
    return out;
  });
  await page.locator('#list .conv').nth(2).waitFor();
  return { page, ids };
};

/** Switch and catch the layer while it is up. */
const switchAndCatch = async (page, view) => {
  await page.evaluate((v) => { window.__ghosts = null; document.querySelector(`.views [data-view="${v}"]`).click(); }, view);
  return page.evaluate(() => new Promise((resolve) => {
    const tick = () => {
      const layer = document.querySelector('.vt-layer');
      if (layer && layer.children.length) {
        resolve([...layer.children].map((g) => ({ id: g.dataset.id, anims: g.getAnimations().length })));
      } else requestAnimationFrame(tick);
    };
    tick();
  }));
};

test('List to Focus morphs each row into its card', async () => {
  const { page, ids } = await openAgents();
  const ghosts = await switchAndCatch(page, 'focus');
  assert.deepEqual(ghosts.map((g) => g.id).sort(), [...ids].sort());
  assert.ok(ghosts.every((g) => g.anims >= 1));
  await page.waitForFunction(() => !document.querySelector('.vt-layer'), null, { timeout: 2000 });
  const landed = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].map((el) => getComputedStyle(el).opacity));
  assert.ok(landed.every((o) => o === '1'));
});

test('Focus to Folders morphs each card into its tab, and a switch mid-switch leaves no layer', async () => {
  const { page, ids } = await openAgents();
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.focus-card').length === 3 && !document.querySelector('.vt-layer'));
  const ghosts = await switchAndCatch(page, 'folders');
  assert.deepEqual(ghosts.map((g) => g.id).sort(), [...ids].sort());
  await page.evaluate(() => document.querySelector('.views [data-view="board"]').click());
  await page.waitForFunction(() => !document.querySelector('.vt-layer'), null, { timeout: 2000 });
  assert.equal(await page.locator('.vt-ghost').count(), 0);
  assert.equal(await page.locator('.column .conv').count(), 3);
});

test('reduced motion crossfades without ghosts', async () => {
  const { page } = await openAgents();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.querySelector('.views [data-view="focus"]').click());
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'focus');
  assert.equal(await page.locator('.vt-layer').count(), 0);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-transitions.test.js`
Expected: no `.vt-layer` ever appears.

- [ ] **Step 3: Implement**

```js
    const representationsOf = (view) => {
      const out = new Map();
      const sel = view === 'folders' ? '.folder-rail .folder-tab[data-id]'
        : view === 'focus' ? '.focus .focus-card[data-id]'
          : view === 'board' ? '.column > .conv[data-id]' : '#list > .conv[data-id]';
      for (const el of document.querySelectorAll(sel)) {
        if (el.hidden || el.closest('[hidden]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.set(el.dataset.id, el);
      }
      return out;
    };

    let vtLayer = null;
    const clearMorph = () => {
      for (const g of vtLayer?.children ?? []) for (const a of g.getAnimations()) a.cancel();
      vtLayer?.remove();
      vtLayer = null;
    };

    /** Every conversation on screen in both views gets a ghost of its old
     *  shape that travels to — and dissolves into — its new one. */
    const morphViews = (current, next, applyLayout) => {
      const before = representationsOf(current);
      const stood = new Map([...before].map(([id, el]) => [id, { el, rect: el.getBoundingClientRect() }]));
      clearMorph();
      vtLayer = document.createElement('div');
      vtLayer.className = 'vt-layer';
      vtLayer.setAttribute('data-marble-transient', '');
      for (const [id, { el, rect }] of stood) {
        const ghost = el.cloneNode(true);
        ghost.classList.add('vt-ghost');
        ghost.dataset.id = id;
        ghost.removeAttribute('data-marble-id');
        ghost.removeAttribute('tabindex');
        ghost.querySelector('marble-conversation')?.remove();
        for (const child of ghost.querySelectorAll('[data-marble-id]')) child.removeAttribute('data-marble-id');
        Object.assign(ghost.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', transform: 'none', overflow: 'hidden', pointerEvents: 'none' });
        vtLayer.append(ghost);
      }
      document.body.append(vtLayer);
      applyLayout();
      const after = representationsOf(next);
      const order = [...after.keys()];
      const gen = fadeGen;
      const anims = [];
      for (const ghost of [...vtLayer.children]) {
        const target = after.get(ghost.dataset.id);
        if (!target) { ghost.remove(); continue; }
        const to = target.getBoundingClientRect();
        const delay = Math.min(order.indexOf(ghost.dataset.id), 7) * STAGGER_MS;
        anims.push(ghost.animate(
          [{ left: `${ghost.style.left}`, top: `${ghost.style.top}`, width: ghost.style.width, height: ghost.style.height, opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.6 },
            { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, opacity: 0, offset: 1 }],
          { duration: FLIP_MS, easing: VT_EASE, delay, fill: 'both' },
        ));
        anims.push(target.animate([{ opacity: 0 }, { opacity: 1, offset: 0.6 }, { opacity: 1 }], { duration: FLIP_MS, easing: VT_EASE, delay, fill: 'both' }));
      }
      if (!vtLayer.children.length) clearMorph();
      Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {
        if (gen !== fadeGen) return;
        for (const a of anims) a.cancel();
        clearMorph();
      });
    };
```

CSS: `.vt-layer { position: fixed; inset: 0; z-index: 5; pointer-events: none; } .vt-ghost { box-sizing: border-box; }`.

`setView`: the crossfade branch becomes

```js
      if (reduceMotion.matches || narrowView.matches) { crossfade(); return; }
      if (!isListBoard(current) || !isListBoard(next)) {
        cancelFlip();
        const gen = ++fadeGen;
        morphViews(current, next, () => crossfadeWith(applyLayout, gen));
        return;
      }
```

where `crossfadeWith(applyLayout, gen)` is today's `crossfade` body with `fadeGen` already bumped by the caller (refactor `crossfade` into `crossfadeWith` and keep a one-line `crossfade = () => crossfadeWith(applyLayout, ++fadeGen)`). `cancelFlip` also calls `clearMorph()`. In the morph path the incoming conversation elements are faded by the morph, not the shell — so in `crossfadeWith`, when a morph is live, skip the shell's `incoming` opacity animation for `list`, `.focus`, `.folders`' rail tabs? No: the shells still fade; the element-level fade multiplies with it and both land at 1 by the end. Leave the shells alone.

- [ ] **Step 4: Run the transitions file, then `agents-page.test.js` and `agents-focus.test.js`**

Expected: pass, including `V toggles library and board; the same conversation node moves`, `toggling twice during a crossfade does not stick opacity`, `switching view eases out instead of the Web Animations linear default`.

- [ ] **Step 5: Look, with motion**

Run `node test-browser/shots.js /tmp/agent-shots` for the stills; then in a one-off Playwright script record a `page.video` of List→Focus→Folders→Board to watch the ghosts. Cards must arrive on their targets, never overshoot, and the layer must be gone at the end.

- [ ] **Step 6: Phase-close**

`npm test`, `npm run test:browser`. Then:

```bash
git add templates/agents.mrbl test-browser/agents-transitions.test.js
git commit -m "Every conversation morphs into its next shape when the view changes."
```

---

# Close-out

### Task 15: merge to main

- [ ] **Step 1:** In the main checkout, confirm the other sessions' in-flight template edits are committed (`git status --short templates/agents.mrbl runtime/agent-ui.js` empty). If not, ask their owner (marble-drive-10 or the usage-meter session) to commit; do not merge over a dirty template.
- [ ] **Step 2:** `git merge --no-ff agents-ui-overhaul`, resolve any conflict in `templates/agents.mrbl` by keeping both sides' hunks (they are in different functions), rerun `npm test` and `npm run test:browser`.
- [ ] **Step 3:** Commit the merge.

### Task 16: the live document

**Files:** `drive/Agents.mrbl` (gitignored).

- [ ] **Step 1:** Stop nothing — the serve process may stay up; the write is one atomic rename.
- [ ] **Step 2:** Generate: read `templates/agents.mrbl`, replace `__TITLE__` with the live `<h1>` text, `__ICON__` with the live icon, and every `__ID__` with a fresh 8-char base36 id; carry the live `<body>`'s `style` attribute (seam widths) across.
- [ ] **Step 3:** Write to a sibling temp file and `rename` over `drive/Agents.mrbl`.
- [ ] **Step 4:** Verify: `node ../marble/scripts/doctor.js drive/Agents.mrbl` reports 0 errors; `grep -c "<marble-alt" drive/Agents.mrbl` is 0; open `http://localhost:4400/a/Agents` and switch through the four views once.
