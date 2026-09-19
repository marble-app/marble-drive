# The Callout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From inside any document, select a region, summon an agent there, brief it in place, watch it work on that region, and finish with Undo or Done — the same conversation the drawer and the Agents page already show, drawn as a fifth view at the region it is about.

**Architecture:** Everything is runtime chrome. `runtime/agent.js` learns to map a native selection to *every* addressed element in the range. A new `runtime/agent-callout.js` owns a transient fixed layer holding the handle, the card (a fresh `<marble-conversation data-chrome="callout">`), the pill, Option-pick mode, docking to the construction zone, the end row, and rehydration from the conversation store. `runtime/collab.js` gains the trail, exposes two geometry helpers, and lets the callout take the zone's *Open chat*. `runtime/agent-ui.js` gains the `callout` chrome (folded log + ticker) and lets the callout take ⌘J when there is a selection. The server only injects the new script. The Agents page reads one `?open=<id>` parameter.

**Tech Stack:** Node 22 ESM, `node:test`, Playwright via `test-browser/harness.js` (Chromium from `@bdhmin/marble`'s node_modules), the fake provider in `test/fixtures/fake-provider.js`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-19-callout-summon-an-agent-in-a-document-design.md`

## Global Constraints

- The agent's colour is one violet, `color-mix(in srgb, #6d55d4 78%, var(--ink))`, never `--accent`. The callout layer declares it as `--callout-mark` with a fallback ink.
- All callout chrome carries `data-marble-transient` and lives in a layer appended to `<html>`; no `.mrbl` document is edited to get a callout.
- Never move a `<marble-conversation>` between parents. The card creates its own.
- The layer draws nothing on a page with `<meta name="marble-agent" content="custom">`, and nothing when `window.marble.agent` is absent.
- Event names are exactly: `marble-callout:summon` (on `window`, cancelable), `marble-callout:open` (on `document`, cancelable, `detail.id`), `marble-callout:reviewed` (on `document`, `detail.id`), `marble-callout:docked` / `marble-callout:undocked` (on `document`, `detail.id`).
- Copy is exact: handle aria-label `Ask an agent about this selection`; head buttons `Open beside`, `Open in Agents`, `×` (aria-label `Fold`); end row `Changed N element(s)` / `No changes` / `Failed` / `Stopped`, buttons `Undo`, `Done`; idle status `Ask about this`.
- Trail class is `marble-trail`, drawn as `box-shadow: inset 2px 0 0 <violet>`; never a border or outline.
- Unit tests: `node --test --test-reporter=spec <file>`. Browser tests: `node --test --test-concurrency=1 --test-reporter=spec <file>`. Some browser tests are load-flaky (see `docs/superpowers/plans/2026-09-18-construction-zone-and-forks.md` global constraints); rerun a failing file alone before treating it as a regression.
- Do not edit `node_modules/`, `../marble`, or `drive/Agents.mrbl` by hand. The live Agents doc is patched once, by script, in Task 10.
- Other sessions have uncommitted work in the main checkout (`runtime/agent-ui.js`, `server/agent/*`). Work in the worktree from Task 0; never stash, reset or check out over their changes.
- Commit messages: one plain sentence in the repo's voice, ending with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 0: A worktree for the branch

**Files:** none edited.

- [ ] **Step 1: Create the worktree from main**

```bash
cd /Users/bryanmin/Development/3rd-year-projects/marble-drive
git worktree add ../marble-drive-callout -b callout main
cd ../marble-drive-callout && ln -s ../marble-drive/node_modules node_modules
ls node_modules/@bdhmin/marble/package.json
```
Expected: the package.json path prints. All later commands run from `/Users/bryanmin/Development/3rd-year-projects/marble-drive-callout`.

- [ ] **Step 2: Confirm the browser harness runs here**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/agent-api.test.js`
Expected: all pass (10 tests).

---

### Task 1: Every addressed element in the range

**Files:**
- Modify: `runtime/agent.js:56-74` (the `selectionchange` listener)
- Test: `test-browser/agent-api.test.js`

**Interfaces:**
- Produces: `idsInRange(range: Range): string[]` inside the `attach` closure (not exported); `marble.agent.context().selection` now holds every addressed id the range intersects, coalesced upward, in document order.

- [ ] **Step 1: Write the failing tests**

Append to `test-browser/agent-api.test.js`, before the last test:

```js
const selectBetween = (page, fromId, fromOffset, toId, toOffset) => page.evaluate(([a, ao, b, bo]) => {
  const from = document.querySelector(`[data-marble-id="${a}"]`).firstChild;
  const to = document.querySelector(`[data-marble-id="${b}"]`).firstChild;
  const range = document.createRange();
  range.setStart(from, ao);
  range.setEnd(to, bo === -1 ? to.length : bo);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
}, [fromId, fromOffset, toId, toOffset]);

test('a selection carries every addressed element it crosses, and a fully covered list is its list', async () => {
  const { page } = await open();
  // From inside the paragraph to the end of the second question: p, then the
  // whole list, which coalesces to q.
  await selectBetween(page, 'p', 5, 'q2', -1);
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 2);
  assert.deepEqual((await page.evaluate(() => window.marble.agent.context())).selection, ['p', 'q']);
});

test('a selection that stops inside a list keeps the items, not the list', async () => {
  const { page } = await open();
  await selectBetween(page, 'q1', 0, 'q2', 4);
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 2);
  assert.deepEqual((await page.evaluate(() => window.marble.agent.context())).selection, ['q1', 'q2']);
});

test('a selection of the whole page never names the body', async () => {
  const { page } = await open();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.body);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForFunction(() => window.marble.agent.context().selection.length > 0);
  assert.deepEqual((await page.evaluate(() => window.marble.agent.context())).selection, ['h', 'p', 'q']);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/agent-api.test.js`
Expected: the first new test fails with `['p','q2']` (two ids, anchor and focus); the third fails with `['b']` or times out.

- [ ] **Step 3: Implement `idsInRange`**

In `runtime/agent.js`, replace the body of the `selectionchange` listener's non-collapsed branch. The listener currently reads:

```js
      const ids = [];
      for (const id of [addressed(selection.anchorNode), addressed(selection.focusNode)]) {
        if (id && !ids.includes(id)) ids.push(id);
      }
      remembered = ids;
      notify();
```

Replace with:

```js
      remembered = idsInRange(selection.getRangeAt(0));
      notify();
```

And add, above the listener (after `addressed`):

```js
    // Every addressed element the range touches, said once. Candidates are the
    // elements the range intersects, minus <html>, <body> and transient chrome.
    // Leaves are the deepest of those; a leaf's addressed ancestor replaces its
    // children only when the range holds all of it, so a fully selected list is
    // its list, and three paragraphs picked out of a section stay three.
    const SKIP = new Set(['HTML', 'BODY']);
    const contains = (range, el) => {
      const probe = document.createRange();
      probe.selectNode(el);
      return range.compareBoundaryPoints(Range.START_TO_START, probe) <= 0
        && range.compareBoundaryPoints(Range.END_TO_END, probe) >= 0;
    };
    const idsInRange = (range) => {
      const candidates = [...document.querySelectorAll('[data-marble-id]')].filter((el) =>
        !SKIP.has(el.tagName) && !el.closest(TRANSIENT) && el.getRootNode() === document && range.intersectsNode(el));
      const set = new Set(candidates);
      let chosenEls = candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
      for (;;) {
        let merged = false;
        for (const el of chosenEls) {
          const parent = el.parentElement?.closest('[data-marble-id]');
          if (!parent || !set.has(parent) || !contains(range, parent)) continue;
          chosenEls = [parent, ...chosenEls.filter((other) => !parent.contains(other))];
          merged = true;
          break;
        }
        if (!merged) break;
      }
      return chosenEls
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .map((el) => el.getAttribute('data-marble-id'));
    };
```

- [ ] **Step 4: Run the file**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/agent-api.test.js`
Expected: all pass, including the existing `context is this document…` test (`['q1','q2']` for a range from inside q1 to inside q2).

- [ ] **Step 5: Commit**

```bash
git add runtime/agent.js test-browser/agent-api.test.js
git commit -m "A selection carries every addressed element it crosses, and a fully covered list is its list.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The trail, two helpers, and a zone that can be claimed

**Files:**
- Modify: `runtime/collab.js` (CSS block near line 61; `paintZones` ~526-578; the `marble:ops` listener ~663-676; after `phaseLabel` ~410)
- Test: `test-browser/collab.test.js`

**Interfaces:**
- Produces: `window.marble.collab = Object.freeze({ tapeTarget, phaseLabel })` — `tapeTarget(els: Element[]): Element|null` (smallest common ancestor, null for html/body), `phaseLabel({phase, note}): string` (`Agent · <clause>`).
- Consumes/handles: `marble-callout:docked`/`marble-callout:undocked` (hide/show that zone's label), `marble-callout:reviewed` (clear that conversation's trail), and dispatches cancelable `marble-callout:open` before opening a chat from the zone label.
- Adds class `marble-trail` to every element an `agent:<id>` op touched; removes it for ids an `agent-undo:<id>` op touches.

- [ ] **Step 1: Write the failing tests**

Append to `test-browser/collab.test.js`:

```js
test('an agent op leaves a trail on the element, and reviewing the chat clears it', async () => {
  const { page, id } = await openWithTurn('building');
  await page.locator('[data-marble-id="h"].marble-trail').waitFor();
  const shadow = await page.locator('[data-marble-id="h"]').evaluate((el) => getComputedStyle(el).boxShadow);
  assert.match(shadow, /inset/, 'the trail is an inset rule, not a border');
  await page.evaluate((cid) => document.dispatchEvent(new CustomEvent('marble-callout:reviewed', { detail: { id: cid } })), id);
  assert.equal(await page.locator('[data-marble-id="h"].marble-trail').count(), 0);
});

test('a claimed zone hides its label, and Open chat can be taken by a callout', async () => {
  const { page, id } = await openWithTurn('building');
  await page.locator('.marble-zone-label').waitFor();
  await page.evaluate((cid) => document.dispatchEvent(new CustomEvent('marble-callout:docked', { detail: { id: cid } })), id);
  await page.locator('.marble-zone-label[hidden]').waitFor({ state: 'attached' });
  await page.evaluate((cid) => document.dispatchEvent(new CustomEvent('marble-callout:undocked', { detail: { id: cid } })), id);
  await page.locator('.marble-zone-label:not([hidden])').waitFor();
  const taken = await page.evaluate(() => new Promise((resolve) => {
    document.addEventListener('marble-callout:open', (event) => { event.preventDefault(); resolve(event.detail.id); }, { once: true });
    document.querySelector('.marble-zone-label button').click();
  }));
  assert.equal(taken, id);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('marble-agent-drawer')?.isOpen)), false, 'the drawer did not open: the callout took the click');
});

test('marble.collab exposes the zone geometry and label helpers', async () => {
  const { page } = await openWithTurn('building');
  const out = await page.evaluate(() => {
    const els = ['q1', 'q2'].map((id) => document.querySelector(`[data-marble-id="${id}"]`));
    return {
      tape: window.marble.collab.tapeTarget(els)?.getAttribute('data-marble-id'),
      body: window.marble.collab.tapeTarget([document.body]),
      label: window.marble.collab.phaseLabel({ phase: 'writing', note: 'Rename the heading.' }),
    };
  });
  assert.deepEqual(out, { tape: 'q', body: null, label: 'Agent · rename the heading' });
});
```

Check how the existing tests in this file start a turn and expose the conversation id (look at the test at line ~215, `agent presence tapes off the region…`). If there is no shared helper, add one near the top of the file:

```js
const openWithTurn = async (script) => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  const id = await page.evaluate(async (name) => {
    const agent = window.marble.agent;
    const cid = await agent.start({ provider: 'fake' });
    await agent.send(cid, { prompt: `script:${name}`, target: 'garden', selection: ['h'] });
    return cid;
  }, script);
  return { page, id };
};
```
and make sure this file's `SCRIPTS` has a `building` script (copy from `test-browser/conversation.test.js` lines 30-36 if missing).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/collab.test.js`
Expected: the three new tests fail (`marble-trail` never appears; `marble.collab` undefined; label never hidden).

- [ ] **Step 3: Add the trail CSS**

In the `<style>` text of `runtime/collab.js` that holds `.marble-flash` (line ~61), add after the `@keyframes marble-flash` block:

```css
      /* Where an agent's turn landed, until the chat is reviewed. An inset
         rule: it cannot move layout and it goes when the class goes. */
      html.marble-collab-host .marble-trail {
        box-shadow: inset 2px 0 0 color-mix(in srgb, #6d55d4 78%, var(--ink, #222));
      }
```

- [ ] **Step 4: Expose the helpers**

Directly after `phaseLabel` is defined (~line 416), add:

```js
    // The callout layer hangs its card where the zone hangs its label; both
    // need the same answer to "where is this set of ids". Frozen: a helper,
    // not a surface to extend.
    if (window.marble && !window.marble.collab) {
      window.marble.collab = Object.freeze({ tapeTarget, phaseLabel });
    }
```

- [ ] **Step 5: Let a callout claim a zone and take Open chat**

Above `paintZones`, add:

```js
    // A callout card docked to a zone *is* that zone's label; the pill would
    // say the same thing twice. The layer says so with docked/undocked.
    const docked = new Set();
    document.addEventListener('marble-callout:docked', (event) => {
      if (event.detail?.id) { docked.add(event.detail.id); paintZones(); }
    });
    document.addEventListener('marble-callout:undocked', (event) => {
      if (event.detail?.id) { docked.delete(event.detail.id); paintZones(); }
    });
```

Inside `paintZones`, after `const conversation = conversationOf(detail.client);` and its `if (conversation) {…}` block that appends the *Open chat* button, change the button's click handler and add the hidden flag:

```js
          open.addEventListener('click', () => {
            // A callout on this page for the same chat gets first refusal.
            const offer = new CustomEvent('marble-callout:open', { cancelable: true, detail: { id: conversation } });
            if (!document.dispatchEvent(offer)) return;
            openConversation(conversation);
          });
```
and right before `frame.append(label);`:

```js
        if (conversation && docked.has(conversation)) label.hidden = true;
```

- [ ] **Step 6: Draw the trail from the ops event**

Replace the `marble:ops` listener body (the one that flashes and wires forks) with:

```js
    const trails = new Map();
    const trailClient = (client) => {
      const name = String(client ?? '');
      if (name.startsWith('agent-undo:')) return { client: `agent:${name.slice('agent-undo:'.length)}`, undo: true };
      if (name.startsWith('agent:')) return { client: name, undo: false };
      return null;
    };
    const clearTrail = (client) => {
      for (const id of trails.get(client) ?? []) byId(id)?.classList.remove('marble-trail');
      trails.delete(client);
    };
    document.addEventListener('marble-callout:reviewed', (event) => {
      if (event.detail?.id) clearTrail(`agent:${event.detail.id}`);
    });

    document.addEventListener('marble:ops', ({ detail }) => {
      const ops = detail?.ops ?? [];
      const forked = new Set();
      const trail = trailClient(detail?.client);
      for (const op of ops) {
        if (op.type === 'insert' && /<marble-alt[\s>]/.test(op.html ?? '')) {
          const id = op.html.match(/data-marble-id="([^"]+)"/)?.[1];
          if (id) forked.add(id);
        }
        if (op.id) flash(op.id);
        if (trail && op.id) {
          const set = trails.get(trail.client) ?? new Set();
          if (trail.undo) { set.delete(op.id); byId(op.id)?.classList.remove('marble-trail'); }
          else { set.add(op.id); byId(op.id)?.classList.add('marble-trail'); }
          trails.set(trail.client, set);
        }
      }
      deriveAlts();
      for (const id of forked) wireFork(byId(id));
      paintPresence();
    });
```

Verify the payload really carries `client`: `grep -n "toDocument" server/app.js server/sse.js | head` and read `server/sse.js:52-63`; the `ops` event data must be `{ ops, client }`. If the field is named differently, use that name.

- [ ] **Step 7: Run the file**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/collab.test.js`
Expected: all pass (the existing 17 plus 3).

- [ ] **Step 8: Commit**

```bash
git add runtime/collab.js test-browser/collab.test.js
git commit -m "An agent's turn leaves a trail until the chat is reviewed, and a callout can claim the zone's label and its Open chat.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The `callout` chrome — a folded log with a ticker

**Files:**
- Modify: `runtime/agent-ui.js` (CSS near 1665; shadow markup ~2625-2640; constructor queries ~2680; `append` ~4707, `system` ~4715, `delta` ~4719, `case 'ask'` ~4502; `connectedCallback`)
- Test: `test-browser/conversation.test.js`

**Interfaces:**
- Produces: `<marble-conversation data-chrome="callout" data-folded>` hides the mast except tags, shows a one-line `.ticker` button carrying the latest log entry's text, hides the log while `data-folded` is present, toggles `data-folded` on ticker click, removes `data-folded` when an ask arrives, and sets the editor placeholder to `Ask about this…`.

- [ ] **Step 1: Write the failing test**

Append to `test-browser/conversation.test.js` (it already has `building`, `question` scripts and a page opener; reuse its opener, which is the function the other tests call to get a page with the drawer — read the file's first test to copy the call):

```js
test('callout chrome folds the log to a ticker, unfolds on click and on an ask', async () => {
  const { page } = await open();
  await page.evaluate(() => {
    const convo = document.createElement('marble-conversation');
    convo.id = 'callout-under-test';
    convo.dataset.chrome = 'callout';
    convo.setAttribute('project', 'drive');
    convo.setAttribute('data-folded', '');
    document.body.append(convo);
  });
  const convo = page.locator('#callout-under-test');
  await convo.locator('.editor').waitFor();
  assert.equal(await convo.locator('.editor').getAttribute('data-placeholder'), 'Ask about this…');
  assert.equal(await convo.locator('.heading').isVisible(), false, 'no heading in a callout');
  await convo.locator('.editor').click();
  await page.keyboard.type('script:rename');
  await page.keyboard.press('Enter');
  await convo.locator('.ticker:not([hidden])').waitFor();
  await page.waitForFunction(() => /Backlog|Renamed/.test(document.querySelector('#callout-under-test').shadowRoot.querySelector('.ticker').textContent));
  assert.equal(await convo.locator('.log').isVisible(), false, 'folded: the log is hidden');
  await convo.locator('.ticker').click();
  assert.equal(await convo.locator('.log').isVisible(), true, 'a click unfolds');
  await convo.locator('.ticker').click();
  assert.equal(await convo.locator('.log').isVisible(), false, 'and folds again');
  // An ask needs an answer, so it unfolds by itself.
  await convo.locator('.editor').click();
  await page.keyboard.type('script:question');
  await page.keyboard.press('Enter');
  await convo.locator('.ask').waitFor();
  assert.equal(await convo.evaluate((el) => el.hasAttribute('data-folded')), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/conversation.test.js`
Expected: the new test fails at the placeholder assertion.

- [ ] **Step 3: CSS**

After the `:host([data-chrome="tile"])` rules (~line 1667) add:

```css
    /* callout: the conversation drawn at the region it is about. The mast's
       furniture is the card's; only the tags stay so the model and target
       read once. The log folds behind a one-line ticker. */
    :host([data-chrome="callout"]) .mast { padding: 2px 12px 0; }
    :host([data-chrome="callout"]) .heading,
    :host([data-chrome="callout"]) .target-jump,
    :host([data-chrome="callout"]) .zone-jump,
    :host([data-chrome="callout"]) .also { display: none; }
    :host([data-chrome="callout"]) .log { padding: 6px 12px 10px; max-height: min(50vh, 360px); overflow: auto; }
    :host([data-chrome="callout"][data-folded]) .log { display: none; }
    .ticker { display: none; }
    :host([data-chrome="callout"]) .ticker:not([hidden]) {
      display: block; width: 100%; text-align: left; font: inherit; font-size: 12.5px; line-height: 1.4;
      color: var(--muted); background: none; border: 0; padding: 4px 12px; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    :host([data-chrome="callout"]) .ticker:hover { color: var(--ink); }
    :host([data-chrome="callout"]) .composer { --edge: 10px; padding: 4px var(--edge) 10px; }
```

- [ ] **Step 4: Markup and wiring**

In the shadow template, between `</header>` and `<div class="log" …>` insert:

```html
        <button type="button" class="ticker" hidden aria-label="Show or hide the conversation"></button>
```

After `this.logEl = root.querySelector('.log');` add:

```js
      this.ticker = root.querySelector('.ticker');
      this.ticker.addEventListener('click', () => this.toggleAttribute('data-folded'));
```

Add a method next to `system(...)`:

```js
    /** The callout's one line: whatever the log said last. Anything but the
     *  callout chrome leaves the button hidden, so this costs nothing there. */
    tick() {
      if (this.dataset.chrome !== 'callout') return;
      const last = [...this.logEl.children].reverse().find((el) => !el.classList.contains('footer'));
      const text = (last?.textContent ?? '').replace(/\s+/g, ' ').trim();
      this.ticker.textContent = text.slice(0, 240);
      this.ticker.hidden = !text;
    }
```

Call `this.tick();` as the last line of `append(turn, node)`, of `system(message, error)`, and of `delta(turn, text)`. In the event switch, at `case 'ask':`, add before the existing call: `this.removeAttribute('data-folded');`.

Find `connectedCallback()` (`grep -n "connectedCallback" runtime/agent-ui.js`; the conversation's is the one after line 2617). Add at its top:

```js
      if (this.dataset.chrome === 'callout') this.input.dataset.placeholder = 'Ask about this…';
```
(`this.input` is the `.editor`; confirm with `grep -n "this.input = " runtime/agent-ui.js`.)

- [ ] **Step 5: Run the file**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/conversation.test.js`
Expected: the new test passes; pre-existing load-flaky failures, if any, reproduce on `main` too.

- [ ] **Step 6: Commit**

```bash
git add runtime/agent-ui.js test-browser/conversation.test.js
git commit -m "A conversation in callout chrome folds its log behind a one-line ticker.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The layer, the handle, the card, and ⌘J

**Files:**
- Create: `runtime/agent-callout.js`
- Modify: `server/app.js:89-101` (RUNTIME map) and `:181-198` (`injectCarrier`)
- Modify: `runtime/agent-ui.js:5717` (the drawer's ⌘J handler)
- Test: create `test-browser/callout.test.js`; extend the server injection test (find it with `grep -rn "collab.js" test/*.test.js`)

**Interfaces:**
- Produces (module-internal, later tasks extend them): `records: Array<Record>` where `Record = { id: string|null, ids: string[], el, convo, head, live, status, actions, tools, state: 'card'|'pill', changed: Set<string>, docked: boolean, title: string }`; `recordOf(id)`, `openCard({ id, ids, state })`, `setState(record, state)`, `remove(record)`, `placeCard(record)`, `summon(): boolean`, `anchorOf(ids): Element|null`, `elementsOf(ids): Element[]`, `button(text, label, onClick)`.
- Handles `marble-callout:summon` on `window` (preventDefault when a card is drawn or the phone drawer opened).

- [ ] **Step 1: Write the failing tests**

Create `test-browser/callout.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  building: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { sleep: 1500 },
    { say: 'done' },
  ],
  hold: [{ silent: 20_000 }],
  quiet: [{ say: 'Nothing to change.' }],
};

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

export const open = async (doc = 'garden', { width = 1200, height = 800 } = {}) => {
  await host.reset();
  const { page } = await host.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  return page;
};

export const select = (page, id) => page.evaluate((mid) => {
  const el = document.querySelector(`[data-marble-id="${mid}"]`);
  const range = document.createRange();
  range.selectNodeContents(el);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
}, id);

const handle = (page) => page.locator('.marble-callout-handle:not([hidden])');
const card = (page) => page.locator('.marble-callout[data-state="card"]');

test('a settled selection grows a handle, and collapsing takes it away', async () => {
  const page = await open();
  assert.equal(await handle(page).count(), 0);
  await select(page, 'h');
  await handle(page).waitFor();
  const [h, dot] = await Promise.all([
    page.locator('[data-marble-id="h"]').boundingBox(),
    handle(page).boundingBox(),
  ]);
  assert.ok(dot.y >= h.y + h.height - 2, 'the handle hangs below the selection');
  assert.ok(Math.abs(dot.x - (h.x - 10)) < 3, 'left edge lines up with where the zone label will hang');
  await page.evaluate(() => getSelection().collapse(document.querySelector('[data-marble-id="p"]').firstChild, 1));
  await page.locator('.marble-callout-handle[hidden]').waitFor({ state: 'attached' });
});

test('the handle opens a card holding a callout conversation, and typing does not lose the selection', async () => {
  const page = await open();
  await select(page, 'q1');
  await handle(page).click();
  await card(page).waitFor();
  const convo = card(page).locator('marble-conversation[data-chrome="callout"]');
  await convo.locator('.editor').waitFor();
  assert.equal(await page.locator('.marble-callout-status').innerText(), 'Ask about this');
  await convo.locator('.editor').click();
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['q1'], 'focus into the card is not a new selection');
  assert.equal(await handle(page).count(), 0, 'the handle steps aside for the card');
});

test('⌘J with a selection summons a card; without one it toggles the drawer', async () => {
  const page = await open();
  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === false);
  await select(page, 'p');
  await page.keyboard.press('Control+j');
  await card(page).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer')?.isOpen), false, 'the drawer stayed shut');
});

test('at phone width the handle opens the drawer with the selection instead of a card', async () => {
  const page = await open('garden', { width: 393, height: 700 });
  await select(page, 'h');
  await handle(page).click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  assert.equal(await card(page).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['h']);
});

test('the Agents page draws no callout layer', async () => {
  const page = await open('Agents');
  await page.waitForFunction(() => Boolean(document.querySelector('marble-conversation')));
  assert.equal(await page.locator('.marble-callout-layer').count(), 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/callout.test.js`
Expected: every test but the Agents one fails (no `.marble-callout-handle` exists).

- [ ] **Step 3: Serve and inject the script**

In `server/app.js` RUNTIME map, after the `'collab.js'` entry add:

```js
  // The callout: a conversation drawn at the region of a document it is about.
  'agent-callout.js': () => path.join(REPO, 'runtime', 'agent-callout.js'),
```

In `injectCarrier`, after the `collab.js` tag line add:

```js
    // After collab.js: the callout hangs its card with the zone's own geometry.
    if (agents) tags += `\n<script src="/runtime/agent-callout.js" data-marble-transient></script>`;
```

Find the existing test that asserts the injected scripts (`grep -rn "runtime/collab.js" test/*.test.js`) and add, beside its agents-on assertion:

```js
  assert.match(html, /<script src="\/runtime\/collab\.js"[^>]*><\/script>\n<script src="\/runtime\/agent-callout\.js" data-marble-transient><\/script>/, 'the callout script follows collab.js when agents are on');
```
and beside its agents-off assertion: `assert.doesNotMatch(html, /agent-callout\.js/);`.

- [ ] **Step 4: Create `runtime/agent-callout.js`**

```js
// The callout: a conversation drawn at the region of the document it is about.
//
// The fifth view of a conversation. The drawer and the Agents page show the
// same object in a panel and in panes; this shows it in situ — a handle at
// your selection, a card when you summon, a pill when you fold it, and the
// zone's own label while the agent works there. Everything here is transient
// chrome in one fixed layer; no document is edited to get it.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const PHONE = matchMedia('(max-width: 719px)');
  const HANDLE_DELAY = 180;
  const CARD_WIDTH = 440;
  const GAP = 12;
  const PAD = 12;

  const STYLE = `
    .marble-callout-layer {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none; color: inherit;
      --callout-mark: color-mix(in srgb, #6d55d4 78%, var(--ink, #222));
      --callout-paper: var(--card, var(--paper, #fff));
      --callout-ink: var(--ink, #222);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .marble-callout-handle {
      position: fixed; width: 22px; height: 22px; border-radius: 50%; border: 0; padding: 0;
      background: var(--callout-mark); box-shadow: 0 1px 4px rgba(0,0,0,.28); cursor: pointer;
      pointer-events: auto; display: grid; place-items: center;
    }
    .marble-callout-handle::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #fff; }
    .marble-callout-handle[hidden] { display: none; }
    .marble-callout {
      position: fixed; width: min(${CARD_WIDTH}px, calc(100vw - ${PAD * 2}px)); pointer-events: auto;
      background: var(--callout-paper); color: var(--callout-ink);
      border: 1px solid color-mix(in srgb, var(--callout-mark) 45%, transparent); border-radius: 14px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18); display: grid; grid-template-rows: auto 1fr; overflow: hidden;
    }
    .marble-callout-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px 4px 12px; color: var(--callout-mark); font-size: 12.5px; }
    .marble-callout-live { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; opacity: .55; }
    .marble-callout[data-live] .marble-callout-live { opacity: 1; animation: marble-callout-pulse 1.4s ease-in-out infinite; }
    @keyframes marble-callout-pulse { 50% { opacity: .35; } }
    .marble-callout-status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-callout-actions, .marble-callout-tools { display: flex; gap: 2px; flex: none; }
    .marble-callout-head button {
      font: inherit; font-size: 12px; border: 0; background: none; color: inherit; cursor: pointer;
      padding: 2px 6px; border-radius: 6px; white-space: nowrap;
    }
    .marble-callout-head button:hover { background: color-mix(in srgb, var(--callout-mark) 12%, transparent); }
    .marble-callout-head button[hidden] { display: none; }
    .marble-callout marble-conversation { display: block; max-height: min(70vh, 560px); }
    .marble-callout[data-state="pill"] { width: auto; max-width: 320px; border-radius: 999px; cursor: pointer; }
    .marble-callout[data-state="pill"] .marble-callout-head { padding: 5px 12px; }
    .marble-callout[data-state="pill"] marble-conversation,
    .marble-callout[data-state="pill"] .marble-callout-tools,
    .marble-callout[data-state="pill"] .marble-callout-actions { display: none; }
    .marble-callout-pick { position: fixed; pointer-events: none; border: 1.5px solid var(--callout-mark); border-radius: 6px; }
    .marble-callout-pick[hidden] { display: none; }
    @media (prefers-reduced-motion: reduce) { .marble-callout[data-live] .marble-callout-live { animation: none; } }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app) return;
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-callout-layer')) return;
    const app = marble.app;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);

    // The top layer, so a document's own stacking contexts sit under the card.
    // The UA sheet for [popover] is undone in STYLE.
    const layer = document.createElement('div');
    layer.className = 'marble-callout-layer';
    layer.setAttribute(TRANSIENT, '');
    layer.setAttribute('popover', 'manual');
    document.documentElement.append(layer);
    try { layer.showPopover(); } catch { /* no popover support: fixed positioning still stands */ }

    const byId = (id) => document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`);
    const elementsOf = (ids) => (ids ?? []).map(byId).filter(Boolean);
    // The zone's rule for "where is this set of ids", falling back to the first
    // element when the only thing containing them all is the body.
    const anchorOf = (ids) => {
      const els = elementsOf(ids);
      if (!els.length) return null;
      return marble.collab?.tapeTarget?.(els) ?? els[0];
    };

    const button = (text, label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', (event) => { event.stopPropagation(); onClick(); });
      return b;
    };

    // ------------------------------------------------------------ records

    const records = [];
    const recordOf = (id) => (id ? records.find((r) => r.id === id) ?? null : null);

    function placeCard(record) {
      const el = record.el;
      const anchor = anchorOf(record.ids);
      if (!anchor) {
        // Nothing left to point at: the chat is still reachable, bottom-right.
        Object.assign(el.style, { left: 'auto', top: 'auto', right: `${PAD}px`, bottom: `${PAD}px` });
        return;
      }
      const r = anchor.getBoundingClientRect();
      const h = el.offsetHeight;
      const w = el.offsetWidth;
      const left = Math.min(Math.max(PAD, r.left - 10), innerWidth - PAD - w);
      let top = r.bottom + GAP;
      if (top + h > innerHeight - PAD) top = r.top - GAP - h;
      if (top < PAD) top = Math.max(PAD, Math.min(r.bottom + GAP, innerHeight - PAD - h));
      Object.assign(el.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, right: 'auto', bottom: 'auto' });
    }

    function setState(record, state) {
      record.state = state;
      record.el.dataset.state = state;
      placeCard(record);
    }

    function remove(record) {
      record.off?.();
      record.el.remove();
      const at = records.indexOf(record);
      if (at >= 0) records.splice(at, 1);
    }

    function openCard({ id = null, ids, state = 'card' }) {
      const existing = recordOf(id);
      if (existing) {
        setState(existing, state);
        if (state === 'card') existing.convo.focusInput?.();
        return existing;
      }
      const el = document.createElement('div');
      el.className = 'marble-callout';
      el.setAttribute(TRANSIENT, '');
      const head = document.createElement('div');
      head.className = 'marble-callout-head';
      const live = document.createElement('span');
      live.className = 'marble-callout-live';
      live.setAttribute('aria-hidden', 'true');
      const status = document.createElement('span');
      status.className = 'marble-callout-status';
      status.textContent = 'Ask about this';
      const actions = document.createElement('span');
      actions.className = 'marble-callout-actions';
      const tools = document.createElement('span');
      tools.className = 'marble-callout-tools';
      head.append(live, status, actions, tools);

      const convo = document.createElement('marble-conversation');
      convo.dataset.chrome = 'callout';
      convo.setAttribute('project', 'drive');
      convo.setAttribute('data-folded', '');
      el.append(head, convo);

      const record = { id, ids: [...ids], el, convo, head, live, status, actions, tools, state, changed: new Set(), docked: false, title: '' };
      records.push(record);
      tools.append(button('×', 'Fold', () => setState(record, 'pill')));
      head.addEventListener('click', (event) => {
        if (record.state === 'pill' && !event.target.closest('button')) setState(record, 'card');
      });
      convo.addEventListener('conversation', (event) => {
        record.id = event.detail?.id ?? null;
      });
      layer.append(el);
      // Attributes after append: the component only loads once connected.
      if (id) convo.setAttribute('conversation', id);
      handle.hidden = true;
      setState(record, state);
      if (state === 'card') convo.focusInput?.();
      return record;
    }

    // ------------------------------------------------------------ geometry

    let raf = 0;
    const relayout = () => {
      raf = 0;
      for (const record of records) placeCard(record);
      placeHandle();
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(relayout); };
    addEventListener('scroll', schedule, true);
    addEventListener('resize', schedule);
    document.addEventListener('marble:ops', schedule);

    // ------------------------------------------------------------ the handle

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'marble-callout-handle';
    handle.setAttribute('aria-label', 'Ask an agent about this selection');
    handle.hidden = true;
    // A mousedown on a button would collapse the very selection it is about.
    handle.addEventListener('pointerdown', (event) => event.preventDefault());
    handle.addEventListener('click', () => summon());
    layer.append(handle);

    let handleTimer = 0;
    let pointerDown = false;
    const scheduleHandle = () => {
      clearTimeout(handleTimer);
      handleTimer = setTimeout(placeHandle, HANDLE_DELAY);
    };
    function placeHandle() {
      const ids = agent.context().selection;
      const target = pointerDown || !ids.length || records.some((r) => r.id === null) ? null : anchorOf(ids);
      if (!target) { handle.hidden = true; return; }
      const r = target.getBoundingClientRect();
      handle.style.left = `${Math.round(Math.max(PAD, r.left - 10))}px`;
      handle.style.top = `${Math.round(Math.min(innerHeight - 30, r.bottom + 4))}px`;
      handle.hidden = false;
    }
    addEventListener('pointerdown', (event) => {
      if (layer.contains(event.target)) return;
      pointerDown = true;
      handle.hidden = true;
    }, true);
    addEventListener('pointerup', () => { pointerDown = false; scheduleHandle(); }, true);
    addEventListener('marble:agent-context', scheduleHandle);

    // ------------------------------------------------------------ summon

    function summon() {
      const ids = agent.context().selection;
      if (!ids.length) return false;
      handle.hidden = true;
      if (PHONE.matches) {
        // No room for a card beside the text on a phone; the drawer already
        // carries the selection as its own control.
        agent.open();
        return true;
      }
      openCard({ ids });
      return true;
    }
    addEventListener('marble-callout:summon', (event) => {
      if (summon()) event.preventDefault();
    });
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
```

- [ ] **Step 5: Let the drawer yield ⌘J**

In `runtime/agent-ui.js` at the drawer's `onKey` (~line 5717) replace:

```js
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j') {
          event.preventDefault();
          if (this.isOpen) this.close();
          else this.open();
        }
```
with:

```js
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j') {
          event.preventDefault();
          // A selection on the page decides where the agent appears: the
          // callout layer takes the key when it can draw a card there.
          const selected = window.marble?.agent?.context?.().selection?.length;
          if (selected && !dispatchEvent(new CustomEvent('marble-callout:summon', { cancelable: true }))) return;
          if (this.isOpen) this.close();
          else this.open();
        }
```

- [ ] **Step 6: Run the tests**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/callout.test.js && node --test --test-reporter=spec test/server.test.js`
Expected: all five callout tests pass; the server injection test passes.

If the phone test fails because `isOpen` never turns true, check how the drawer exposes open state (`grep -n "get isOpen\|this.isOpen =" runtime/agent-ui.js`) and use that.

- [ ] **Step 7: Commit**

```bash
git add runtime/agent-callout.js runtime/agent-ui.js server/app.js test-browser/callout.test.js test/server.test.js
git commit -m "A selection grows a handle, and the handle or ⌘J summons a conversation card at the region.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Pick mode

**Files:**
- Modify: `runtime/agent-callout.js` (inside `boot`, after the handle section)
- Test: `test-browser/callout.test.js`

**Interfaces:**
- Produces: holding Option over the page outlines the nearest addressed block (`.marble-callout-pick`); Option-click toggles it in `picked: Set<string>` and calls `agent.select([...picked])` (or `agent.select(null)` when empty); Escape clears; a fresh non-collapsed native selection clears.

- [ ] **Step 1: Write the failing test**

Append to `test-browser/callout.test.js`:

```js
test('Option-click picks elements, Escape clears, and a new text selection replaces the picks', async () => {
  const page = await open();
  const q2 = await page.locator('[data-marble-id="q2"]').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(q2.x + 10, q2.y + q2.height / 2);
  await page.locator('.marble-callout-pick:not([hidden])').waitFor();
  await page.mouse.click(q2.x + 10, q2.y + q2.height / 2);
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q2"]');
  const p = await page.locator('[data-marble-id="p"]').boundingBox();
  await page.mouse.click(p.x + 10, p.y + p.height / 2);
  await page.keyboard.up('Alt');
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q2","p"]');
  await handle(page).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 0);
  await page.keyboard.down('Alt');
  await page.mouse.click(p.x + 10, p.y + p.height / 2);
  await page.keyboard.up('Alt');
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["p"]');
  await select(page, 'h');
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["h"]');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/callout.test.js`
Expected: the new test times out waiting for `.marble-callout-pick`.

- [ ] **Step 3: Implement**

Add inside `boot`, after the summon section:

```js
    // ------------------------------------------------------------ pick mode
    // Option held: the pointer names an element instead of firing it. Option
    // is already Marble's pick modifier (the Drive listing's lasso).

    const pickFrame = document.createElement('div');
    pickFrame.className = 'marble-callout-pick';
    pickFrame.setAttribute(TRANSIENT, '');
    pickFrame.hidden = true;
    layer.append(pickFrame);
    const picked = new Set();
    let hovered = null;

    const addressedAt = (x, y) => {
      const hit = document.elementFromPoint(x, y)?.closest?.('[data-marble-id]');
      if (!hit || hit === document.body || hit === document.documentElement || hit.closest(`[${TRANSIENT}]`)) return null;
      return hit;
    };
    const outline = (el) => {
      hovered = el;
      if (!el) { pickFrame.hidden = true; return; }
      const r = el.getBoundingClientRect();
      Object.assign(pickFrame.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
      pickFrame.hidden = false;
    };
    const commitPicks = () => {
      agent.select(picked.size ? [...picked] : null);
    };

    addEventListener('pointermove', (event) => {
      if (!event.altKey) { if (hovered) outline(null); return; }
      outline(addressedAt(event.clientX, event.clientY));
    }, true);
    addEventListener('keyup', (event) => {
      if (event.key === 'Alt' && hovered) outline(null);
    }, true);
    addEventListener('click', (event) => {
      if (!event.altKey || layer.contains(event.target)) return;
      const el = addressedAt(event.clientX, event.clientY);
      if (!el) return;
      event.preventDefault();
      event.stopPropagation();
      const id = el.getAttribute('data-marble-id');
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      commitPicks();
    }, true);
    addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !picked.size) return;
      picked.clear();
      commitPicks();
    }, true);
    // A fresh text selection is the person choosing something else.
    document.addEventListener('selectionchange', () => {
      const selection = getSelection();
      if (!picked.size || !selection || selection.isCollapsed || !selection.rangeCount) return;
      const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
      if (!anchor || anchor.closest(`[${TRANSIENT}]`)) return;
      picked.clear();
      agent.select(null);
    });
```

Note the order matters: `agent.select(null)` must run before `runtime/agent.js`'s own `selectionchange` handler recomputes `remembered`, or after — either way `context()` prefers `chosen` only while it is non-null, so clearing it lets the new text selection through.

- [ ] **Step 4: Run the file**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/callout.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-callout.js test-browser/callout.test.js
git commit -m "Option held turns the pointer into a picker, and Escape lets go.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Watch and finish — docking to the zone, the trail count, Undo and Done

**Files:**
- Modify: `runtime/agent-callout.js` (inside `openCard` and new functions after it)
- Test: `test-browser/callout.test.js`

**Interfaces:**
- Consumes: the component's `conversation` (`detail.id`) and `zone` (`detail.zone: {path, ids, phase, note} | null`) events; `agent.on(id, handler)` events `turn.started`, `ask`, `turn.completed|failed|cancelled|interrupted`; `marble:ops` `detail.client`.
- Produces: `follow(record)`, `syncDock(record)`, `endRow(record, event)`, `undoLast(record)`, `done(record)`; dispatches `marble-callout:docked`/`undocked`/`reviewed`.

- [ ] **Step 1: Verify two field names before writing code**

Run: `grep -n "event.turn\b\|event.turn " runtime/agent-ui.js | head -5` and `grep -n "type: 'turn.started'" server/agent/runner.js | head -3`, and read the emitting line to confirm the turn id field on `turn.*` events (expected `turn`). Run `sed -n 52,63p server/sse.js` to confirm the `ops` SSE payload is `{ ops, client }`. Use the names you find below.

- [ ] **Step 2: Write the failing tests**

Append to `test-browser/callout.test.js`:

```js
const sendFromCard = async (page, prompt) => {
  const editor = card(page).locator('marble-conversation .editor');
  await editor.click();
  await page.keyboard.type(prompt);
  await page.keyboard.press('Enter');
};
const firstConversation = (page) => page.evaluate(async () => {
  const [summary] = await window.marble.agent.conversations();
  return summary ? { summary, detail: await window.marble.agent.conversation(summary.id) } : null;
});

test('a brief sent from the card carries the selection, docks to the zone, and ends with Undo and Done', async () => {
  const page = await open();
  await select(page, 'h');
  await handle(page).click();
  await sendFromCard(page, 'script:building');
  await page.locator('.marble-zone').waitFor();
  const { summary, detail } = await firstConversation(page);
  assert.deepEqual(detail.turns[0].context.selection, ['h'], 'the turn carries the selection');
  assert.equal(detail.turns[0].context.target, 'garden');
  await page.locator('.marble-zone-label[hidden]').waitFor({ state: 'attached' });
  await page.locator('.marble-callout-status', { hasText: 'Agent · rename the heading' }).waitFor();
  assert.ok(await page.locator('.marble-callout[data-live]').count(), 'the head pulses while the turn runs');
  await page.locator('.marble-callout-status', { hasText: 'Changed 1 element' }).waitFor({ timeout: 15_000 });
  assert.equal(await page.locator('.marble-zone').count(), 0, 'the zone went with the turn');
  assert.equal(await page.locator('[data-marble-id="h"].marble-trail').count(), 1);
  await page.getByRole('button', { name: 'Undo this turn' }).click();
  await page.waitForFunction(() => document.querySelector('[data-marble-id="h"]').textContent === 'Research Garden');
  await page.locator('.marble-callout-status', { hasText: 'Undone' }).waitFor();
  await page.getByRole('button', { name: 'Mark reviewed and put the callout away' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.marble-callout').length === 0);
  assert.equal(await page.locator('.marble-trail').count(), 0);
  const after = await page.evaluate(async (cid) => (await window.marble.agent.conversations()).find((s) => s.id === cid), summary.id);
  assert.equal(after.needsReview, false, 'Done reviewed the chat');
});

test('a turn that changes nothing says so, and folding a live card gives the zone its label back', async () => {
  const page = await open();
  await select(page, 'p');
  await handle(page).click();
  await sendFromCard(page, 'script:hold');
  await page.locator('.marble-zone').waitFor();
  await page.locator('.marble-zone-label[hidden]').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Fold' }).click();
  await page.locator('.marble-callout[data-state="pill"]').waitFor();
  await page.locator('.marble-zone-label:not([hidden])').waitFor();
  await page.evaluate(async () => {
    const [s] = await window.marble.agent.conversations();
    const d = await window.marble.agent.conversation(s.id);
    await window.marble.agent.cancel(d.turns.at(-1).id);
  });
  await page.locator('.marble-callout-status', { hasText: 'Stopped' }).waitFor({ timeout: 10_000 });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/callout.test.js`
Expected: the two new tests fail at the hidden-label wait.

- [ ] **Step 4: Implement**

In `openCard`, replace the `convo.addEventListener('conversation', …)` block with:

```js
      convo.addEventListener('conversation', (event) => {
        record.id = event.detail?.id ?? null;
        if (record.id) follow(record);
      });
      convo.addEventListener('zone', (event) => {
        const zone = event.detail?.zone ?? null;
        record.zone = zone && zone.path === app && elementsOf(zone.ids).length ? zone : null;
        if (record.zone) record.ids = [...record.zone.ids];
        if (zone) {
          record.status.textContent = zone.path === app
            ? (marble.collab?.phaseLabel?.(zone) ?? 'Agent · working')
            : `Building in ${zone.path}`;
        }
        syncDock(record);
        placeCard(record);
      });
      if (id) follow(record);
```
(`follow` is called for a rehydrated card too, so keep the `if (id) follow(record)` line after `records.push`.) Move the `if (id) convo.setAttribute('conversation', id);` line so it stays after `layer.append(el)`.

Also in `setState`, after `record.el.dataset.state = state;` add `syncDock(record);`.

After `openCard`, add:

```js
    // ------------------------------------------------------------ watching
    // Docked means: this card stands where the zone's label would, so the
    // label steps back. Only a card docks; a pill lets the label return.
    function syncDock(record) {
      const want = Boolean(record.zone) && record.state === 'card' && Boolean(record.id);
      if (want === record.docked) return;
      record.docked = want;
      document.dispatchEvent(new CustomEvent(want ? 'marble-callout:docked' : 'marble-callout:undocked', { detail: { id: record.id } }));
    }

    function follow(record) {
      record.off?.();
      record.off = agent.on(record.id, (event) => {
        switch (event.type) {
          case 'turn.started':
            record.changed.clear();
            record.el.dataset.live = '1';
            record.actions.replaceChildren();
            break;
          case 'ask':
            record.convo.removeAttribute('data-folded');
            if (record.state === 'pill') setState(record, 'card');
            break;
          case 'turn.completed':
          case 'turn.failed':
          case 'turn.cancelled':
          case 'turn.interrupted':
            endRow(record, event);
            break;
          default:
        }
      });
    }

    document.addEventListener('marble:ops', ({ detail }) => {
      const client = String(detail?.client ?? '');
      if (!client.startsWith('agent:')) return;
      const record = recordOf(client.slice('agent:'.length));
      if (!record) return;
      for (const op of detail.ops ?? []) if (op.id) record.changed.add(op.id);
    });

    // ------------------------------------------------------------ finishing

    function endRow(record, event) {
      delete record.el.dataset.live;
      record.zone = null;
      syncDock(record);
      const n = record.changed.size;
      const ok = event.type === 'turn.completed';
      record.status.textContent = !ok
        ? (event.type === 'turn.failed' ? 'Failed' : 'Stopped')
        : n ? `Changed ${n} element${n === 1 ? '' : 's'}` : 'No changes';
      if (event.type === 'turn.failed') record.convo.removeAttribute('data-folded');
      record.actions.replaceChildren();
      if (ok && n) record.actions.append(button('Undo', 'Undo this turn', () => undoLast(record)));
      record.actions.append(button('Done', 'Mark reviewed and put the callout away', () => done(record)));
      placeCard(record);
    }

    async function undoLast(record) {
      let detail = null;
      try { detail = await agent.conversation(record.id); } catch { return; }
      const turn = [...(detail?.turns ?? [])].reverse().find((t) => t.status === 'completed' && t.applied && !t.undoneAt);
      if (!turn) return;
      try { await agent.undo(turn.id); } catch { return; }
      record.changed.clear();
      record.status.textContent = 'Undone';
      record.actions.replaceChildren(button('Done', 'Mark reviewed and put the callout away', () => done(record)));
    }

    async function done(record) {
      if (record.id) {
        try { await agent.markReviewed(record.id); } catch { /* the callout still goes */ }
        document.dispatchEvent(new CustomEvent('marble-callout:reviewed', { detail: { id: record.id } }));
      }
      remove(record);
    }
```

- [ ] **Step 5: Run the file**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/callout.test.js`
Expected: all pass. If `Changed 1 element` never appears, log `detail.client` in the `marble:ops` handler and compare with the client the host sends (`agent:<id>`).

- [ ] **Step 6: Commit**

```bash
git add runtime/agent-callout.js test-browser/callout.test.js
git commit -m "While the agent works the card is the zone's label, and when it stops the card says what changed and offers Undo and Done.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The pill, rehydration, and prompts sent from elsewhere

**Files:**
- Modify: `runtime/agent-callout.js`
- Test: `test-browser/callout.test.js`

**Interfaces:**
- Consumes: `agent.conversations()` summaries (`id, target, archived, status, needsReview, asking, title, updatedAt`), `agent.conversation(id).turns[*].context.selection`, the `*` stream (`agent.on('*', …)`) `user` and `meta` events.
- Produces: `rehydrate()`, `paintPill(record)`, fold memory in `sessionStorage` under `marble-callout-folded:<app>`; handles `marble-callout:open`.

- [ ] **Step 1: Verify the `*` stream's field names**

Run: `grep -n "all=1\|conversation:" server/agent/routes.js server/agent/hub.js | head` and `grep -n "type: 'meta'" server/agent/runner.js server/agent/routes.js | head -3`. Note the field that names the conversation on a fanned-out event (expected `conversation`) and the payload field of a `meta` event (expected the summary spread or under `meta`). Use those names below.

- [ ] **Step 2: Write the failing tests**

Append to `test-browser/callout.test.js`:

```js
test('a reload while the agent works rebuilds the card at its region, and a fold is remembered', async () => {
  const page = await open();
  await select(page, 'q1');
  await handle(page).click();
  await sendFromCard(page, 'script:hold');
  await page.locator('.marble-zone').waitFor();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await card(page).waitFor();
  const [q1, box] = await Promise.all([page.locator('[data-marble-id="q1"]').boundingBox(), card(page).boundingBox()]);
  assert.ok(box.y > q1.y, 'the card hangs at the question it was about');
  await page.getByRole('button', { name: 'Fold' }).click();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.locator('.marble-callout[data-state="pill"]').waitFor();
  await page.evaluate(async () => {
    const [s] = await window.marble.agent.conversations();
    const d = await window.marble.agent.conversation(s.id);
    await window.marble.agent.cancel(d.turns.at(-1).id);
  });
});

test('a prompt sent from the drawer with a selection gets a callout too, and Open chat on its zone unfolds it', async () => {
  const page = await open();
  await select(page, 'h');
  await page.evaluate(() => window.marble.agent.open());
  const drawerEditor = page.locator('marble-agent-drawer marble-conversation .editor');
  await drawerEditor.click();
  await page.keyboard.type('script:building');
  await page.keyboard.press('Enter');
  await card(page).waitFor();
  await page.getByRole('button', { name: 'Fold' }).click();
  await page.locator('.marble-zone-label:not([hidden]) button', { hasText: 'Open chat' }).click();
  await card(page).waitFor();
});

test('a finished chat that was never reviewed comes back as a pill', async () => {
  const page = await open();
  await select(page, 'p');
  await handle(page).click();
  await sendFromCard(page, 'script:quiet');
  await page.locator('.marble-callout-status', { hasText: 'No changes' }).waitFor({ timeout: 10_000 });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.locator('.marble-callout[data-state="pill"]').waitFor();
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/callout.test.js`
Expected: the three new tests time out waiting for a card or pill after reload / from the drawer.

- [ ] **Step 4: Implement**

Add after the finishing section:

```js
    // ------------------------------------------------------------ the pill

    const FOLD_KEY = `marble-callout-folded:${app}`;
    const foldedIds = () => {
      try { return new Set(JSON.parse(sessionStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); }
    };
    const rememberFold = (id, on) => {
      if (!id) return;
      const set = foldedIds();
      if (on) set.add(id); else set.delete(id);
      try { sessionStorage.setItem(FOLD_KEY, JSON.stringify([...set])); } catch { /* private mode */ }
    };
    function paintPill(record) {
      // A pill has one line, and it is the chat's name. Status returns with the card.
      if (record.state === 'pill') record.status.textContent = record.title || 'Agent';
    }

    // ------------------------------------------------------------ rehydration
    // The store remembers everything the layer needs: target, the last turn's
    // selection, and whether the chat is running, asking, or unreviewed.

    async function rehydrate() {
      let list = [];
      try { list = await agent.conversations(); } catch { return; }
      const mine = list
        .filter((s) => s.target === app && !s.archived && (s.status === 'running' || s.asking || s.needsReview))
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
        .slice(0, 6);
      const folded = foldedIds();
      for (const summary of mine) {
        if (recordOf(summary.id)) continue;
        let detail = null;
        try { detail = await agent.conversation(summary.id); } catch { continue; }
        const ids = detail?.turns?.at(-1)?.context?.selection ?? [];
        if (!elementsOf(ids).length) continue;
        const live = summary.status === 'running' || summary.asking;
        const record = openCard({ id: summary.id, ids, state: live && !folded.has(summary.id) ? 'card' : 'pill' });
        record.title = summary.title ?? '';
        if (live) record.el.dataset.live = '1';
        if (!live) record.actions.append(button('Done', 'Mark reviewed and put the callout away', () => done(record)));
        paintPill(record);
      }
    }

    agent.on('*', (event) => {
      if (event.type === 'user' && event.context?.target === app) {
        const cid = event.conversation;
        if (cid && !recordOf(cid) && elementsOf(event.context.selection).length) {
          openCard({ id: cid, ids: event.context.selection });
        }
      }
      if (event.type === 'meta') {
        const meta = event.meta ?? event;
        const record = recordOf(meta.id);
        if (record) { record.title = meta.title ?? record.title; paintPill(record); }
        if (meta.id && meta.running === false && meta.needsReview === false) {
          document.dispatchEvent(new CustomEvent('marble-callout:reviewed', { detail: { id: meta.id } }));
        }
      }
    });

    document.addEventListener('marble-callout:open', (event) => {
      const record = recordOf(event.detail?.id);
      if (!record) return;
      event.preventDefault();
      setState(record, 'card');
      record.convo.focusInput?.();
    });

    rehydrate();
```

Update `setState` to remember folds and repaint the pill:

```js
    function setState(record, state) {
      record.state = state;
      record.el.dataset.state = state;
      rememberFold(record.id, state === 'pill');
      if (state === 'pill') paintPill(record);
      else if (!record.zone && !record.actions.childElementCount) record.status.textContent = 'Ask about this';
      syncDock(record);
      placeCard(record);
    }
```

Because `setState` now references `rememberFold`/`paintPill`/`syncDock` defined later in `boot`, they are `const`/function declarations hoisted within the same scope; keep `rememberFold` and `paintPill` as `function` declarations or move them above `setState`.

- [ ] **Step 5: Run the file**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/callout.test.js`
Expected: all pass. If the `*`-stream test spawns two cards, the `conversation` event from the drawer's component fired after the `user` event arrived — dedupe by checking `records.some((r) => r.convo.getAttribute('conversation') === cid)` as well as `recordOf(cid)`.

- [ ] **Step 6: Commit**

```bash
git add runtime/agent-callout.js test-browser/callout.test.js
git commit -m "A callout folds to a pill, comes back after a reload, and appears for any brief about this document.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Continue in, Open beside, Open in Agents, and `?open=`

**Files:**
- Modify: `runtime/agent-callout.js` (inside `openCard`)
- Modify: `templates/agents.mrbl` (~line 8208, after `restoreOpen();` inside `start`)
- Test: `test-browser/callout.test.js`, `test-browser/agents-page.test.js`

**Interfaces:**
- Consumes: `agent.current()`, `agent.remember(id)`, `agent.open(id)`, `marble.href(path)` (confirm with `grep -n "href" node_modules/@bdhmin/marble/runtime/marble.js | head -5`).
- Produces: head buttons `Continue in <title>` (before first send only), `Open beside`, `Open in Agents`; the Agents page opens `?open=<id>` and strips it.

- [ ] **Step 1: Write the failing tests**

Append to `test-browser/callout.test.js`:

```js
test('Open beside moves the chat to the drawer and folds the card; Continue in offers the chat you were in', async () => {
  const page = await open();
  // An idle chat this tab remembers is the one to continue in.
  const earlier = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.send(id, { prompt: 'script:quiet', target: 'garden' });
    await new Promise((r) => { const off = window.marble.agent.on(id, (e) => { if (e.type === 'turn.completed') { off(); r(); } }); });
    window.marble.agent.remember(id);
    return id;
  });
  await select(page, 'q2');
  await handle(page).click();
  const cont = page.locator('.marble-callout-tools button', { hasText: 'Continue in' });
  await cont.waitFor();
  await cont.click();
  assert.equal(await card(page).locator('marble-conversation').getAttribute('conversation'), earlier);
  await page.getByRole('button', { name: 'Open this chat in the dock' }).click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('marble-conversation').getAttribute('conversation')), earlier);
  await page.locator('.marble-callout[data-state="pill"]').waitFor();
});

test('Open in Agents leaves for the Agents page with the chat open', async () => {
  const page = await open();
  await select(page, 'h');
  await handle(page).click();
  await sendFromCard(page, 'script:quiet');
  await page.locator('.marble-callout-status', { hasText: 'No changes' }).waitFor({ timeout: 10_000 });
  const { summary } = await firstConversation(page);
  await page.getByRole('button', { name: 'Open this chat on the Agents page' }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/a/Agents'));
  await page.waitForFunction((cid) => document.querySelector(`marble-conversation[conversation="${cid}"]`) !== null, summary.id);
  assert.equal(new URL(page.url()).searchParams.has('open'), false, 'the parameter is spent');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/callout.test.js`
Expected: both new tests fail (no such buttons).

- [ ] **Step 3: The head buttons**

In `openCard`, replace `tools.append(button('×', 'Fold', …));` with:

```js
      const beside = button('Open beside', 'Open this chat in the dock', () => {
        if (!record.id) return;
        agent.remember?.(record.id);
        agent.open(record.id);
        setState(record, 'pill');
      });
      const inAgents = button('Open in Agents', 'Open this chat on the Agents page', () => {
        if (!record.id) return;
        const href = marble.href?.('Agents') ?? '/a/Agents';
        const url = new URL(href, location.href);
        url.searchParams.set('open', record.id);
        location.href = url.href;
      });
      const paintTools = () => { beside.hidden = inAgents.hidden = !record.id; };
      paintTools();
      tools.append(beside, inAgents, button('×', 'Fold', () => setState(record, 'pill')));
      // Continue in: the chat this tab was last in, if it is idle. The
      // portable agent — it follows you to the new region with its memory.
      const currentId = !id ? agent.current?.() : null;
      if (currentId) {
        agent.conversation(currentId).then((detail) => {
          const meta = detail?.meta;
          if (!meta || meta.archived || meta.running || record.id) return;
          const cont = button(`Continue in ${meta.title || 'the last chat'}`, 'Send this to the chat you were in', () => {
            record.id = currentId;
            convo.setAttribute('conversation', currentId);
            follow(record);
            cont.remove();
            paintTools();
          });
          tools.prepend(cont);
        }).catch(() => {});
      }
```
and in the `conversation` listener add `paintTools();` after `record.id = …`. Since `paintTools` is declared inside `openCard` after the listener is registered, register the listener after `paintTools` is defined (move the `convo.addEventListener('conversation', …)` block below this code).

- [ ] **Step 4: The Agents page reads `?open=`**

In `templates/agents.mrbl`, directly after the `restoreOpen();` call inside `start` (~line 8208), add:

```js
        // Arrived from a callout's Open in Agents: open that chat, then spend
        // the parameter so a reload does not reopen it.
        const arrived = new URL(location.href);
        const wanted = arrived.searchParams.get('open');
        if (wanted) {
          arrived.searchParams.delete('open');
          history.replaceState(history.state, '', arrived.href);
          open(wanted).catch(() => {});
        }
```

Append to `test-browser/agents-page.test.js`:

```js
test('arriving with ?open=<id> opens that chat and spends the parameter', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  const id = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  await page.goto(`${host.base}/a/Agents?open=${id}`);
  await page.waitForFunction((cid) => document.querySelector(`marble-conversation[conversation="${cid}"]`) !== null, id);
  assert.equal(new URL(page.url()).searchParams.has('open'), false);
});
```

- [ ] **Step 5: Run both files**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/callout.test.js test-browser/agents-page.test.js`
Expected: the new tests pass. (`agents-page.test.js` has one known pre-existing failure, "pressing a row does not pop it"; ignore it.)

- [ ] **Step 6: Commit**

```bash
git add runtime/agent-callout.js templates/agents.mrbl test-browser/callout.test.js test-browser/agents-page.test.js
git commit -m "A callout can continue the chat you were in, move beside the page, or leave for the Agents page.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs

**Files:**
- Modify: `docs/AGENTS.md` (new section after `## While an agent works`, ~line 100)
- Modify: `docs/CARRIER-DRIVE.md` (the `marble.agent` section, ~lines 90-110)

- [ ] **Step 1: AGENTS.md**

Insert before `## What a full agent can do`:

```markdown
## Summoning an agent in a document

Select something in any document and a small violet handle appears at the
selection's corner, where the construction zone's label will hang once an
agent is working there. Click it, or press `⌘J` while the selection is live,
and a **callout** opens: a card holding a real conversation, anchored to the
region. With no selection `⌘J` still toggles the drawer.

The selection is every addressed element the range crosses. A fully selected
list travels as the list; three paragraphs picked out of a section travel as
three paragraphs. Hold **Option** to pick elements one at a time instead — the
element under the pointer is outlined, a click toggles it, **Escape** clears.

The card's composer is the composer: setups, model, effort, and the Project
picker. Choosing a registered project makes it a coding turn in that
repository. **Continue in <title>** sends the brief to the chat this tab was
last in, if it is idle, instead of starting a new one.

While the agent works the card stands where the zone's label would, showing
`Agent · <what it is doing>`. Every element the turn changes keeps a thin
violet edge — the **trail** — until the chat is reviewed. When the turn ends
the card reads `Changed 4 elements · Undo · Done`. *Undo* is the turn's undo.
*Done* marks the chat reviewed, clears the trail, and puts the callout away.

`×` folds the card to a pill with the chat's name; the pill reopens it.
**Open beside** moves the chat to the drawer; **Open in Agents** leaves for the
Agents page with that chat open. A reload rebuilds callouts for chats about
this document that are running, asking, or unreviewed, at the region their
last turn was about. A prompt sent from the drawer with a selection gets a
callout as well.

On a phone the handle opens the drawer with the selection attached; there is
no anchored card. The Agents page draws no callouts of its own.
```

- [ ] **Step 2: CARRIER-DRIVE.md**

In the `marble.agent` section, where `context()` and the selection are described, replace the sentence about the anchor and focus elements with:

```markdown
`context().selection` is every addressed element the current text selection
intersects, coalesced upward so a fully covered container travels as itself,
in document order. `select(ids)` overrides it until `select(null)`.

`marble.collab` (set by `runtime/collab.js`) exposes `tapeTarget(els)` — the
smallest common ancestor of a set of elements, or `null` when only `<html>`
or `<body>` contains them — and `phaseLabel({phase, note})`, the zone label's
`Agent · <clause>` text. The callout layer (`runtime/agent-callout.js`) hangs
its card with them; a document may read them but should not rely on more.
```

- [ ] **Step 3: Commit**

```bash
git add docs/AGENTS.md docs/CARRIER-DRIVE.md
git commit -m "Document the callout: how a selection summons an agent and what the card shows while it works.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Full test pass, merge, host restart, live Agents doc

**Files:** none new. Runs from the worktree, then from the main checkout.

- [ ] **Step 1: Unit and browser suites in the worktree**

Run: `npm test` then `npm run test:browser`
Expected: unit suite green. Browser suite green apart from failures that also fail on `main` (check `uptime`; rerun any failing file alone before deciding).

- [ ] **Step 2: Merge**

Use the `superpowers:finishing-a-development-branch` skill. Before merging, run `git status --short` in the main checkout and confirm other sessions' uncommitted files are untouched by the merge (`runtime/agent-ui.js` is one of them: merge with `git merge --no-ff callout` from a clean index; if the working tree blocks the merge because of their uncommitted `agent-ui.js`, coordinate through `ListAgents`/`SendMessage` rather than stashing).

- [ ] **Step 3: Restart the host**

`server/app.js` changed, so the running host is serving the old injection list. Ask Bryan to restart the host (runtime files are re-read per request; the server is not). Then open any document, select text, and confirm the handle appears.

- [ ] **Step 4: Patch the live Agents document once, by script**

The template change is JS-only (no `__ID__` slots), so use the exact-substitution method. Write `scratchpad/patch-agents-open.py`:

```python
import sys
OLD = "        restoreOpen();\n"
NEW = OLD + """        // Arrived from a callout's Open in Agents: open that chat, then spend
        // the parameter so a reload does not reopen it.
        const arrived = new URL(location.href);
        const wanted = arrived.searchParams.get('open');
        if (wanted) {
          arrived.searchParams.delete('open');
          history.replaceState(history.state, '', arrived.href);
          open(wanted).catch(() => {});
        }
"""
for path in sys.argv[1:]:
    src = open(path, encoding='utf-8').read()
    if NEW in src:
        print(path, 'already patched'); continue
    assert src.count(OLD) == 1, f'{path}: expected one restoreOpen() call, found {src.count(OLD)}'
    open(path, 'w', encoding='utf-8').write(src.replace(OLD, NEW))
    print(path, 'patched')
```

Run it on the live doc only (the template already has the change from Task 8): `python3 scratchpad/patch-agents-open.py drive/Agents.mrbl`. Wait 15 seconds, then `grep -c "searchParams.get('open')" drive/Agents.mrbl` — expected `1`. If `0`, the host reverted the unaddressable script hunk; re-read the fresh file and run the script once more (see the memory note on two-write behaviour). Do not commit `scratchpad/`.

- [ ] **Step 5: Remove the worktree**

```bash
cd /Users/bryanmin/Development/3rd-year-projects/marble-drive
git worktree remove ../marble-drive-callout
git branch -d callout
```

---

## Self-review against the spec

- §4.1 range ids and coalescing: Task 1. Pick mode: Task 5.
- §4.2 handle, 180ms settle, hides on pointer down, ⌘J yield, custom-meta guard, phone → drawer: Task 4.
- §4.3 fresh component, `callout` chrome, folded log/ticker, full composer, Continue in, `project="drive"`: Tasks 3, 4, 8.
- §4.4 docking, `Agent · <clause>` head, trail, `Building in <path>`, ask unfolds: Tasks 2, 6.
- §4.5 end row, Undo, Done → markReviewed + clear trail + remove: Task 6.
- §4.6 pill, fold memory, rehydration (target, running/asking/needsReview, last turn selection, cap 6), `*` stream spawn: Task 7.
- §4.7 Open beside, Open in Agents, `?open=`, zone Open chat → callout: Tasks 2, 7, 8.
- §4.8 injection only: Task 4. Host restart + live doc: Task 10.
- §7 lost anchor → bottom-right: `placeCard` in Task 4. Body-only selection → first element: `anchorOf` in Task 4 and `SKIP` in Task 1.
- §8 tests: each task carries its own; `injectCarrier` assertion in Task 4.
- Docs (§ scope): Task 9.
