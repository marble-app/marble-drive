# Agents Page Implementation Plan (Plan 4 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed an `Agents` document that lists every conversation as a searchable library and as a board, reusing `<marble-conversation>` and `window.marble.agent`, with an interruptible FLIP toggle between the two.

**Architecture:** `Agents` is an ordinary Drive document (`templates/agents.mrbl`), seeded once like Drive. It carries `<meta name="marble-agent" content="custom">` so the host drawer does not mount on top of it. The host still injects `agent.js` and `agent-ui.js` (custom meta skips **mounting** the drawer, not loading the conversation element). Conversation rows and board cards are the same DOM nodes, rearranged; their data is never stored in the Agents file (page-only list + `localStorage` for view and open id).

**Tech Stack:** One `.mrbl` file (HTML/CSS/JS, no build), `window.marble.agent`, `<marble-conversation>` from `runtime/agent-ui.js`, Web Animations API for FLIP; Node ≥ 22 `node:test`; Playwright via the existing `test-browser/harness.js`.

**Spec:** `docs/superpowers/specs/2026-09-16-agent-interface-design.md` §11 (`Agents.mrbl`), §6.3 (needs review), §9 (`window.marble.agent`); Plan 3 drawer (`docs/superpowers/plans/2026-09-17-agents-drawer.md`); `docs/AGENTS.md`.

## Global Constraints

- No new npm dependencies. Browser tests use `test-browser/harness.js`.
- Node 22: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH`.
- Custom meta means **no drawer**, not **no agent-ui.js**. Always inject `/runtime/agent-ui.js` when agents are on; `MarbleAgentDrawer.mount` already returns early on custom meta.
- Conversation list, filters, board columns, and the open conversation are page-only. They are not ops and not in the file. View (`library` | `board`) and the open conversation id persist in `localStorage` keys `marble-agents:view` and `marble-agents:open`, each access in try/catch.
- One conversation is one element (`data-id`), used as a library row and as a board card. Toggle rearranges those nodes; it does not clone them.
- `V` toggles List | Board. Reduced motion: 150 ms crossfade, nothing translates. Narrow (`max-width: 719px`): library is list that pushes to the conversation; board is horizontally scroll-snapped columns; toggle is the crossfade.
- Tokens match Drive / the drawer (UIST warm / Dusk). Font `14px/1.5 "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Agent text is never HTML (`<marble-conversation>` already enforces this).
- Do not bind or stop port 4400. Do not implement Codex (Plan 5).
- Code style: match the repo — ESM on the server, one file for Agents, two-space indent, single quotes, comments that say why.
- `npm test` baseline at plan start: 313. Browser baseline: 30.

## File Structure

| file | responsibility |
|---|---|
| `server/app.js` (modify) | inject `agent-ui.js` even when custom meta is present |
| `server/seed.js` (modify) | `buildAgents` / `seedAgents` |
| `bin/marble-drive.js` (modify) | seed Agents on serve, like Drive |
| `templates/agents.mrbl` | the Agents app |
| `test/agent-http.test.js` (modify) | custom-meta document still gets `agent-ui.js` |
| `test/seed-agents.test.js` | seed once, do not overwrite |
| `test-browser/agents-page.test.js` | library, inspector, board, FLIP, reduced motion |
| `docs/AGENTS.md` (modify) | the Agents document |

---

### Task 1: Inject `agent-ui.js` for custom agent documents, and seed `Agents`

**Files:**
- Modify: `server/app.js` (`injectCarrier`)
- Modify: `server/seed.js`
- Modify: `bin/marble-drive.js`
- Modify: `test/agent-http.test.js`
- Create: `test/seed-agents.test.js`

**Interfaces:**
- Consumes: Plan 3 injection; `seedDrive` pattern; custom meta already skips drawer **mount**.
- Produces: every agents-on document includes `/runtime/agent-ui.js`. A missing `Agents` document is written once at path `Agents`. Existing `Agents` is left alone.

- [ ] **Step 1: Write the failing tests**

In `test/agent-http.test.js`, change the custom-meta test to expect `agent-ui.js` **present** (the drawer still must not appear; that remains a browser test):

```js
test('a document that presents agents itself gets the API and the conversation element, not a second drawer script skip', async () => {
  await drive.createDocument('custom-agents', SOURCE.replace('<title>', '<meta name="marble-agent" content="custom"><title>'));
  const page = await (await fetch(`${base}/a/custom-agents`)).text();
  assert.ok(page.includes('/runtime/agent.js'));
  assert.ok(page.includes('/runtime/agent-ui.js'), 'custom chrome still needs <marble-conversation>');
});
```

Create `test/seed-agents.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStore } from '../server/store/index.js';
import { seedAgents, seedDrive } from '../server/seed.js';

const fresh = async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-agents-seed-'));
  const store = createStore({ root });
  await store.ready();
  return { root, store };
};

test('Agents is seeded once, and a hand-edited copy is not overwritten', async () => {
  const { store } = await fresh();
  await seedDrive(store);
  const first = await seedAgents(store);
  assert.equal(first.seeded, true);
  assert.equal(first.path, 'Agents');
  assert.match(await store.read('Agents'), /marble-agent" content="custom"/);
  assert.match(await store.read('Agents'), /<marble-conversation/);

  const edited = (await store.read('Agents')).replace('Agents', 'Agents (mine)');
  await store.write('Agents', edited, { label: 'edit' });
  const second = await seedAgents(store);
  assert.equal(second.seeded, false);
  assert.match(await store.read('Agents'), /Agents \(mine\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-reporter=spec test/seed-agents.test.js test/agent-http.test.js`

Expected: seed test fails (`seedAgents` missing); custom-meta test fails if still asserting `agent-ui.js` is absent — flip that assertion first so RED is “script missing” after you change the assertion to expect it present, then implement.

- [ ] **Step 3: Implement injection + seed**

In `server/app.js` `injectCarrier`, always append `agent-ui.js` when agents are on. Delete the custom-meta branch that skipped it. Keep the comment that custom meta skips the **drawer mount** (that lives in `runtime/agent-ui.js`).

```js
    if (agents) {
      tags += `\n<script src="/runtime/agent.js" data-marble-transient></script>`;
      tags += `\n<script src="/runtime/agent-ui.js" data-marble-transient></script>`;
    }
```

In `server/seed.js`, add `buildAgents` / `seedAgents` beside Drive. Use `iconLink('doc')`, mint `__ID__` the same way, no affordance pack required (the page’s behaviour is its own script). Template path `templates/agents.mrbl`. For this task the template may be a stub that still satisfies the seed test (`custom` meta + a `<marble-conversation>` node). Task 2 replaces the stub.

```js
export async function buildAgents({ name = 'Agents', title = 'Agents' } = {}) {
  const template = await fsp.readFile(path.join(REPO, 'templates', 'agents.mrbl'), 'utf8');
  return template
    .replaceAll('__TITLE__', title)
    .replace('__ICON__', () => iconLink('doc'))
    .replace(/__ID__/g, () => newId());
}

export async function seedAgents(store, { name = 'Agents', title = 'Agents' } = {}) {
  if (await store.has(name)) return { seeded: false, path: name };
  await store.write(name, await buildAgents({ name, title }), { label: 'seeded' });
  return { seeded: true, path: name };
}
```

Create `templates/agents.mrbl` stub (Task 2 replaces the body; keep the meta tag):

```html
<!doctype html>
<html lang="en" data-marble="1">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="marble:capabilities" content="storage; net=none">
<meta name="marble-agent" content="custom">
<title>__TITLE__</title>
__ICON__
</head>
<body data-marble-id="__ID__" data-view="library">
  <marble-conversation data-marble-id="__ID__"></marble-conversation>
</body>
</html>
```

In `bin/marble-drive.js` serve():

```js
  await seedDrive(drive.store, { name: config.home });
  await seedAgents(drive.store);
```

Import `seedAgents` next to `seedDrive`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH npm test`

Expected: 315 (313 + seed tests; the custom-meta test still counts as one). Browser tests still 30 (`custom` page still has no drawer because `mount()` returns early).

- [ ] **Step 5: Commit**

```bash
git add server/app.js server/seed.js bin/marble-drive.js templates/agents.mrbl test/agent-http.test.js test/seed-agents.test.js
git commit -m "$(cat <<'EOF'
Agents page: seed Agents once, and still load the conversation element on custom chrome.

Custom meta skips the drawer mount, not agent-ui.js — Agents.mrbl needs
<marble-conversation> without a second launcher on top of the library.
EOF
)"
```

---

### Task 2: Library — list, conversation, inspector

**Files:**
- Replace: `templates/agents.mrbl`
- Create: `test-browser/agents-page.test.js` (library cases in this task; board cases in Task 3)

**Interfaces:**
- Consumes: `window.marble.agent` (`conversations`, `conversation`, `on('*')`, `start`, `archive`, `markReviewed`, `handoff`, `providers`, `undo`); `<marble-conversation>` (`conversation` attr, `conversation` / `meta` / `running` events, `focusInput()`); `window.marble.href`.
- Produces: three-pane library. List rows: title, provider badge, status dot, activity, age. Filters All · Running · Review · Archived. Search matches title/activity. Clicking a row sets `conversation` on the page’s `<marble-conversation>` and fills the inspector. `localStorage` `marble-agents:open` restored on load. File on disk unchanged by browsing.

- [ ] **Step 1: Write the failing library tests**

Create `test-browser/agents-page.test.js` (library tests now; Task 3 appends board tests to the same file):

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
};

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();

const host = await startDrive({
  scripts: SCRIPTS,
  documents: { garden: GARDEN, Agents: AGENTS },
});
test.after(() => host.close());

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  return { page, errors };
};

test('the Agents page has no drawer and lists a conversation', async () => {
  const { page, errors } = await openAgents();
  assert.equal(await page.locator('marble-agent-drawer').count(), 0);
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  assert.match(await page.locator(`.conv[data-id="${id}"] .title`).textContent(), /script:rename|Untitled/);
  assert.deepEqual(errors, []);
});

test('clicking a row opens it in the conversation pane and the inspector', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).click();
  const view = page.locator('marble-conversation');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.getAttribute('conversation'), id);
  assert.match(await page.locator('.inspector').textContent(), /garden|Fake|script:rename/i);
});

test('filters and search hide rows without deleting them', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    await agent.send(await agent.start({ provider: 'fake' }), {
      prompt: 'script:rename',
      target: 'garden',
      viewing: 'Agents',
      selection: [],
    });
  });
  await page.locator('.conv').first().waitFor();
  await page.locator('button.filter[data-filter="running"]').click();
  assert.equal(await page.locator('.conv:not([hidden])').count(), 0);
  await page.locator('button.filter[data-filter="all"]').click();
  await page.locator('input.search').fill('nope-nope');
  assert.equal(await page.locator('.conv:not([hidden])').count(), 0);
  await page.locator('input.search').fill('');
  assert.ok((await page.locator('.conv:not([hidden])').count()) >= 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-page.test.js`

Expected: FAIL — no `.conv` rows (stub page).

- [ ] **Step 3: Implement the library in `templates/agents.mrbl`**

Replace the stub. Requirements for this task (board markup may exist hidden; behaviour in Task 3):

- `<meta name="marble-agent" content="custom">`
- Header: title “Agents”; segmented **List | Board** (`button[data-view="library"]`, `button[data-view="board"]`, `aria-pressed`); search input `.search`; filter buttons `.filter` with `data-filter` in `all|running|review|archived` (`archived=1` listings use `agent.conversations({ archived: true })` when that filter is on).
- `.library` three panes: `#list` (role="list"), pane with `<marble-conversation>`, `.inspector`.
- `.board` three columns `.column[data-col="running"|"review"|"completed"]` (empty until Task 3 fills them).
- Script (no host required for first paint of chrome):
  - `marble.pageOnly('data-view')` so a reconcile does not write the view into the file. Never file an op for view, filter, search, or the open id.
  - Restore `localStorage['marble-agents:view']` and `['marble-agents:open']`.
  - `load()` fetches conversations (and archived when that filter is on), builds one `.conv` node per id (`data-id`, `.title`, `.badge`, `.dot`, `.activity`, `.age`), keyed in a `Map`. Reuse the node on summary events (`agent.on('*', …)`).
  - `status` from summary: `running` if `running`/`status==='running'`; else review if `needsReview`; else completed (including `new` with no turns — still a row).
  - Click `.conv` → `open(id)`: set `marble-conversation[conversation]`, `localStorage` open id, inspector from `agent.conversation(id)` plus summary (provider, model, target from last user context if present, Undo if a completed turn with `applied`, Archive, Mark reviewed when `needsReview`).
  - New conversation: a **New** button calls `start` after picking the default provider, then `open`.
  - Age: relative (`12m`, `3h`, `2d`) from `updatedAt`.
  - Do not `marble.op` any of this.

Match Drive tokens (`--ink`, `--paper`, …) including dark `prefers-color-scheme`. Inspector links to target docs via `marble.href(path)`.

Keep the file readable. Every element you add that is document furniture (header, panes) gets `data-marble-id`. The conversation rows are created in script into `#list` / columns marked `data-marble-transient` so they never persist.

- [ ] **Step 4: Run library tests**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-page.test.js && PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH npm test`

Expected: library tests PASS; `npm test` still green.

- [ ] **Step 5: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-page.test.js
git commit -m "$(cat <<'EOF'
Agents page: library of conversations, the shared transcript, and an inspector.

Rows are page-only; the Agents file stays a shell. Summary events keep the
list honest while a turn runs in the drawer on another page.
EOF
)"
```

---

### Task 3: Board, V toggle, FLIP

**Files:**
- Modify: `templates/agents.mrbl` (board fill + toggle animation)
- Modify: `test-browser/agents-page.test.js` (append tests)

**Interfaces:**
- Consumes: Task 2 `.conv` nodes and status classification.
- Produces: columns Running (running + queued), Needs review, Completed. Archived not on the board. `V` toggles. FLIP 420 ms `cubic-bezier(.2, .8, .2, 1)`, 18 ms stagger by column order capped at 8; reverse mid-flight from current progress. Selection carries (open id stays highlighted; board click opens a 520 px panel with the same `<marble-conversation>` + condensed inspector). Reduced motion: 150 ms crossfade. Narrow: horizontal scroll-snap columns; toggle is crossfade.

- [ ] **Step 1: Write the failing board tests**

Append to `test-browser/agents-page.test.js`:

```js
test('V toggles library and board; the same conversation node moves', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  assert.equal(await page.locator('body').getAttribute('data-view'), 'library');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  assert.equal(await page.locator(`.column[data-col="completed"] .conv[data-id="${id}"]`).count(), 1);
  assert.equal(await page.locator('.conv').count(), 1, 'the row was moved, not cloned');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'library');
  assert.equal(await page.locator(`#list .conv[data-id="${id}"]`).count(), 1);
});

test('reduced motion crossfades and does not wait on a FLIP', async () => {
  const { page } = await openAgents({ reducedMotion: 'reduce' });
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  const transform = await page.locator('.conv').first().evaluate((el) => getComputedStyle(el).transform).catch(() => 'none');
  assert.ok(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)' || transform == null);
});

test('clicking a board card opens the conversation panel', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.locator(`.column .conv[data-id="${id}"]`).click();
  await page.locator('.board-panel[data-open="true"] marble-conversation').waitFor();
  assert.equal(await page.locator('.board-panel marble-conversation').getAttribute('conversation'), id);
});
```

- [ ] **Step 2: Run to verify they fail**

Run the agents-page browser file. Expected: FAIL on `data-view === 'board'` or missing column.

- [ ] **Step 3: Implement toggle + FLIP**

In the Agents script:

- `place(node)`: append to `#list` when library; else to the column for its status (`running` → running, `needsReview` → review, else completed). Skip archived on the board (leave them out of columns; they remain in the Map).
- `setView(next)`:
  - Persist `marble-agents:view`.
  - If `prefers-reduced-motion: reduce` or `matchMedia('(max-width: 719px)')`: set `data-view`, `place` all, 150 ms opacity on `.library` / `.board`.
  - Else: record `getBoundingClientRect` for every `.conv`; set `data-view`; `place` all; for each node, invert with `transform: translate(dx,dy) scale(...)`; animate to identity with WAAPI 420 ms `cubic-bezier(.2, .8, .2, 1)`, delay `min(index, 7) * 18` ms. Store the `Animation`s. A new `setView` before they finish: reverse each (`playbackRate = -1` or `animation.reverse()` from current progress), then run the new layout.
- Keyboard: `v` / `V` without modifiers, not when typing in search or the composer.
- Board card click: `open(id)` and show `.board-panel` (`data-open="true"`, width 520px) containing the **same** `<marble-conversation>` (move the element from the library pane into the panel, move it back when closing or returning to library). Do not create a second conversation element.

- [ ] **Step 4: Run tests**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH npm run test:browser && PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH npm test`

Expected: all previous browser tests plus new ones; `npm test` 315+.

Run `npm run test:browser` three times; FLIP tests must not flake.

- [ ] **Step 5: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-page.test.js
git commit -m "$(cat <<'EOF'
Agents page: library ⇄ board with an interruptible FLIP, one node per conversation.

The toggle rearranges the same rows. Reduced motion and a phone width skip
the transform and crossfade instead.
EOF
)"
```

---

### Task 4: Docs and the drawer’s Open Agents path

**Files:**
- Modify: `docs/AGENTS.md`
- Modify: `docs/CARRIER-DRIVE.md` only if the seeding behaviour needs a sentence
- No product CSS changes unless screenshots (optional, not committed) show a clip

**Interfaces:**
- Consumes: drawer already links to `Agents` when that document exists (`runtime/agent-ui.js`).
- Produces: docs that say the page exists, is seeded once, and is opened from the drawer menu.

- [ ] **Step 1: Append to `docs/AGENTS.md` after the drawer section**

```markdown
## The Agents document

A drive that has run `serve` at least once with this host gets an `Agents`
document at the root, seeded the same way Drive is: written only if it is
not already there. It is a library of every conversation and a board of
the ones that are running, need review, or are done. `V` toggles the two.
The drawer’s **Open Agents** appears once that document exists.

The page uses `window.marble.agent` and the same `<marble-conversation>`
as the drawer (`<meta name="marble-agent" content="custom">`, so it does
not wear a second launcher). Conversation rows are not stored in the file.
```

- [ ] **Step 2: Run everything**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH npm test && PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH npm run test:browser`

Expected: server baseline + seed tests; browser 30 + agents-page tests.

- [ ] **Step 3: Commit**

```bash
git add docs/AGENTS.md
git commit -m "Agents page: document the seeded Agents library and board"
```

---

## After this plan

- **Plan 5 — Codex** (experimental provider).
- Drive-picked targeting (`marble.agent.aim`) is a separate worktree (`drive-agent-aim`), not this plan.

## Spec coverage

| Spec §11 | Task |
|---|---|
| Seeded `Agents` document | 1 |
| Library panes list / conversation / inspector | 2 |
| Filters, search, row fields | 2 |
| Board columns + card panel | 3 |
| List \| Board, `V`, FLIP, interruptible, reduced motion, narrow | 3 |
| View + selection in localStorage | 2–3 |
| Custom chrome, no extra drawer | 1 + 2 |
| Drawer Open Agents | already Plan 3; docs in 4 |
