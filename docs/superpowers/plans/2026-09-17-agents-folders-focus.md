# Agents Folders and Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Folders (vertical tab groups + pane workspace) and Focus (pinned Full / Digest / Chip spatial windows) to Agents, sharing one durable folder catalog.

**Architecture:** Pure layout and naming helpers live in `runtime/agent-folders.js` (`globalThis.marbleAgentFolders`). The agent store keeps `folders.json` plus `folderId` / `pinned` / `focusX` / `focusY` / `lastInteractedAt` on each conversation. HTTP and `window.marble.agent` expose that catalog. `templates/agents.mrbl` gains two views; the seeded `<marble-conversation>` is never reparented.

**Tech Stack:** ESM on the server, one Agents HTML file, classic injected scripts, Web Animations / springs via WAAPI `easing: 'ease-out'` plus a tiny spring stepper in `agent-folders.js` (no new npm). Node ≥ 22 `node:test`. Playwright via `test-browser/harness.js`.

**Spec:** `docs/superpowers/specs/2026-09-17-agents-folders-focus-design.md`

## Global Constraints

- No new npm dependencies. Browser tests use `test-browser/harness.js`.
- Node 22: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH`.
- Do not reparent the file’s `<marble-conversation>`. Extra live threads are `data-marble-transient`, at most four.
- Conversation rows are never stored in the Agents file. Folder catalog is `.marble/agents/folders.json`, not ops.
- Tokens match Drive / the drawer (UIST warm / Dusk). Font `14px/1.5 "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- `V` cycles `library → board → folders → focus → library`. First `V` from List is still Board.
- Reduced motion: 150 ms opacity, no travel. Narrow (`max-width: 719px`): no extra panes; Focus is a vertical stack.
- Agent text is never HTML.
- Do not bind or stop port 4400. Do not overwrite an already-seeded live `Agents` document (seed-once). Tests inject `templates/agents.mrbl`.
- Code style: two-space indent, single quotes, comments that say why.
- Every task’s requirements implicitly include this section and the spec.

## File Structure

| file | responsibility |
|---|---|
| `runtime/agent-folders.js` | Pure helpers + `globalThis.marbleAgentFolders` |
| `test/agent-folders.test.js` | Unit tests for those helpers |
| `server/agent/store.js` | `folders.json`, meta fields, dissolve-if-empty |
| `test/agent-store.test.js` | Store coverage for folders |
| `server/agent/hub.js` | `publishFolders` |
| `server/agent/routes.js` | Folder HTTP, PATCH allowlist |
| `test/agent-http.test.js` | HTTP coverage |
| `runtime/agent.js` | `folders` / `createFolder` / …; `folders` SSE |
| `server/app.js` | Serve and inject `agent-folders.js` |
| `templates/agents.mrbl` | Four views, Folders rail, Focus canvas |
| `test-browser/agents-page.test.js` | `V` still List→Board first |
| `test-browser/agents-folders.test.js` | Folders gestures |
| `test-browser/agents-focus.test.js` | Focus gestures |
| `docs/AGENTS.md` | User-facing description |

---

### Task 1: Folder helpers (`runtime/agent-folders.js`)

**Files:**
- Create: `runtime/agent-folders.js`
- Test: `test/agent-folders.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `globalThis.marbleAgentFolders` with `COLOR_KEYS`, `REALMS`, `CHIP_COOL_MS` (45000), `DIGEST_BUDGET` (4), `FULL_CAP` (4), `GAP` (8), `realmOf(path)`, `suggestName(targets)`, `nextColor(used)`, `assignLods(cards, ctx)`, `nearestCard(cards, fromId, dir)`, `rubberband(overshoot, dimension, constant = 0.55)`, `separateRects(rects, gap = 8)`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import '../runtime/agent-folders.js';

const F = () => globalThis.marbleAgentFolders;

test('suggestName uses the most specific shared path segment', () => {
  assert.equal(F().suggestName(['Research/Marble/a', 'Research/Marble/b']), 'Marble');
  assert.equal(F().suggestName(['Research/x', 'Fun/y']), 'Group');
  assert.equal(F().suggestName([]), 'Group');
});

test('realmOf reads Drive’s first-segment map', () => {
  assert.equal(F().realmOf('Research/Marble/uist'), 'research');
  assert.equal(F().realmOf("Bryan's Days/today"), 'days');
  assert.equal(F().realmOf(''), '');
});

test('nextColor skips keys already used', () => {
  assert.equal(F().nextColor([]), 'research');
  assert.equal(F().nextColor(['research', 'fun']), 'days');
  const all = [...F().COLOR_KEYS];
  assert.equal(F().nextColor(all), 'research');
});

test('assignLods never chips a selected, running, or review card', () => {
  const cards = [
    { id: 'a', running: false, needsReview: false, lastInteractedAt: 0, updatedAt: 0 },
    { id: 'b', running: true, needsReview: false, lastInteractedAt: 0, updatedAt: 0 },
    { id: 'c', running: false, needsReview: true, lastInteractedAt: 0, updatedAt: 0 },
  ];
  const lods = F().assignLods(cards, {
    fullIds: ['a'],
    selectedIds: [],
    hoveredId: null,
    now: 1_000_000,
  });
  assert.equal(lods.a, 'full');
  assert.equal(lods.b, 'digest');
  assert.equal(lods.c, 'digest');
});

test('cold unfocused cards chip once Digest budget is exceeded', () => {
  const cards = Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    running: false,
    needsReview: false,
    lastInteractedAt: 0,
    updatedAt: 0,
  }));
  const lods = F().assignLods(cards, {
    fullIds: [],
    selectedIds: [],
    hoveredId: null,
    now: 60_000,
  });
  const digest = Object.values(lods).filter((v) => v === 'digest').length;
  const chip = Object.values(lods).filter((v) => v === 'chip').length;
  assert.equal(digest, 4);
  assert.equal(chip, 2);
});

test('nearestCard picks the nearest card in a 90 degree cone', () => {
  const cards = [
    { id: 'o', cx: 0, cy: 0 },
    { id: 'r', cx: 10, cy: 1 },
    { id: 'far', cx: 40, cy: 2 },
    { id: 'up', cx: 1, cy: -10 },
  ];
  assert.equal(F().nearestCard(cards, 'o', 'right').id, 'r');
  assert.equal(F().nearestCard(cards, 'o', 'up').id, 'up');
  assert.equal(F().nearestCard(cards, 'o', 'left'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-reporter=spec test/agent-folders.test.js`

Expected: FAIL, cannot find module or `marbleAgentFolders` undefined.

- [ ] **Step 3: Write minimal implementation**

`runtime/agent-folders.js` is an IIFE assigned to `globalThis.marbleAgentFolders`. Implement:

- `REALMS` copy Drive’s map (`Research`, `Fun`, `Bryan's Days`, `Marble`, `Travel`).
- `COLOR_KEYS` as in the spec.
- `suggestName`: longest common prefix of path segments; use the last shared segment; else `Group`; slice 40.
- `nextColor(used)`: first `COLOR_KEYS` entry not in `used`; if all used, `COLOR_KEYS[0]`.
- `assignLods`: Full if in `fullIds`. Else Digest if selected, hovered, `running`, or `needsReview`. Remaining cards: warm if `now - max(lastInteractedAt, updatedAt) < CHIP_COOL_MS`. Fill `max(0, DIGEST_BUDGET - alwaysDigestCount)` slots with warm first, then cold (warmest / most recent first). The rest Chip.
- `nearestCard`: skip non-positive projection on the direction unit vector; reject if `atan2(|lateral|, proj) > π/4`; pick smallest hypot.
- `rubberband`: `(overshoot * dimension * constant) / (dimension + constant * abs(overshoot))`.
- `separateRects(rects, gap)`: each `{ id, x, y, w, h }`; up to 40 iterations, for every overlapping pair (including gap) push each along center delta by half the penetration; return new rects.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-reporter=spec test/agent-folders.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-folders.js test/agent-folders.test.js
git commit -m "$(cat <<'EOF'
Add folder color, name, and Focus LOD helpers.

EOF
)"
```

---

### Task 2: Store catalog and conversation fields

**Files:**
- Modify: `server/agent/store.js`
- Modify: `test/agent-store.test.js`

**Interfaces:**
- Consumes: `globalThis.marbleAgentFolders.suggestName`, `nextColor`, `realmOf`, `FULL_CAP` (side-effect import `../../runtime/agent-folders.js`)
- Produces: `store.listFolders()` → `{ folders, workingSetIds }`; `store.createFolder({ conversationIds, name, color })`; `store.updateFolder(id, patch)`; `store.deleteFolder(id)`; `store.setWorkingSet(ids)`; `createConversation` includes `folderId: null`, `pinned: false`, `focusX: null`, `focusY: null`, `lastInteractedAt: createdAt`; `updateConversation` dissolves a folder when it has no remaining members after a `folderId` change

- [ ] **Step 1: Write the failing tests**

Append to `test/agent-store.test.js`:

```js
test('a folder is created with exclusive membership, unused color, and a name from targets', async () => {
  const { store } = await fresh();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(a.id, { target: 'Research/Marble/uist' });
  await store.updateConversation(b.id, { target: 'Research/Marble/notes' });
  const folder = await store.createFolder({ conversationIds: [a.id, b.id] });
  assert.match(folder.id, /^[0-9a-f]{12}$/);
  assert.equal(folder.name, 'Marble');
  assert.equal(folder.color, 'research');
  assert.equal((await store.conversation(a.id)).folderId, folder.id);
  assert.equal((await store.conversation(b.id)).folderId, folder.id);
  assert.deepEqual(folder.openIds, [a.id, b.id]);
});

test('moving the last member out dissolves the folder', async () => {
  const { store } = await fresh();
  const a = await store.createConversation({ provider: 'fake' });
  const folder = await store.createFolder({ conversationIds: [a.id], name: 'Solo', color: 'fun' });
  await store.updateConversation(a.id, { folderId: null });
  assert.equal((await store.listFolders()).folders.find((f) => f.id === folder.id), undefined);
  assert.equal((await store.conversation(a.id)).folderId, null);
});

test('createConversation starts ungrouped and unpinned', async () => {
  const { store } = await fresh();
  const meta = await store.createConversation({ provider: 'fake' });
  assert.equal(meta.folderId, null);
  assert.equal(meta.pinned, false);
  assert.equal(meta.focusX, null);
  assert.equal(meta.lastInteractedAt, meta.createdAt);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-reporter=spec test/agent-store.test.js`

Expected: FAIL, `createFolder` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `store.js`:

- `import '../../runtime/agent-folders.js';` then `const folderLib = () => globalThis.marbleAgentFolders;`
- `foldersFile = path.join(dir, 'folders.json')`
- `readFolders()` default `{ folders: [], workingSetIds: [] }`
- `writeFolders(state)` via existing `writeJson`
- `createFolder`: mint 12-hex id; for each conversation id `updateConversation` with `folderId`; if name omitted `suggestName(targets)`; if color omitted `nextColor(existing colors)` preferring `realmOf(first target)` when unused; `openIds` = first `FULL_CAP` ids; `order` = max+1 or 0.
- `updateConversation`: after write, if `patch.folderId` was set (including null), load previous `folderId` from the pre-patch meta; if that id is set and no conversation still has it, remove that row from `folders.json`. Drop dissolved id from every `openIds`. When patch includes `folderId`, `pinned`, `focusX`, or `focusY`, set `lastInteractedAt: Date.now()`. Clamp `focusX`/`focusY` to `[0,1]` or null.
- `deleteFolder`: set members’ `folderId` null (without infinite dissolve loop — delete the row first), then ungroup.
- `setWorkingSet`: keep only ids that exist.
- Add the five fields to `createConversation`’s `meta`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-reporter=spec test/agent-store.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/agent/store.js test/agent-store.test.js
git commit -m "$(cat <<'EOF'
Persist agent folders and exclusive conversation membership.

EOF
)"
```

---

### Task 3: HTTP, PATCH allowlist, folders SSE

**Files:**
- Modify: `server/agent/hub.js`
- Modify: `server/agent/routes.js`
- Modify: `test/agent-http.test.js`
- Modify: `server/app.js` (RUNTIME map + inject)

**Interfaces:**
- Consumes: store folder methods from Task 2
- Produces: `GET/POST /agent/folders`, `PATCH/DELETE /agent/folders/:id`, `PUT /agent/folders/working-set`; PATCH conversation accepts `folderId`, `pinned`, `focusX`, `focusY`; `hub.publishFolders({ folders, workingSetIds })`; `/runtime/agent-folders.js` is served and injected when agents are on

- [ ] **Step 1: Write the failing tests**

In `test/agent-http.test.js`:

```js
test('folders can be created, listed, joined, and dissolved over HTTP', async () => {
  const a = await api('POST', '/agent/conversations', { provider: 'fake' });
  const b = await api('POST', '/agent/conversations', { provider: 'fake' });
  await api('PATCH', `/agent/conversations/${a.body.id}`, { title: 'A' });
  const created = await api('POST', '/agent/folders', { conversationIds: [a.body.id, b.body.id], name: 'CHI', color: 'fun' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'CHI');
  const listed = await api('GET', '/agent/folders');
  assert.equal(listed.body.folders.length, 1);
  const moved = await api('PATCH', `/agent/conversations/${a.body.id}`, { folderId: null });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.folderId, null);
});

test('PATCH rejects an unknown folderId', async () => {
  const created = await api('POST', '/agent/conversations', { provider: 'fake' });
  const nope = await api('PATCH', `/agent/conversations/${created.body.id}`, { folderId: 'ffffffffffff' });
  assert.equal(nope.status, 400);
});
```

In `test/agent-http.test.js` custom-meta page test (the one that already expects `agent-ui.js`), also assert `agent-folders.js` is present.

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-reporter=spec test/agent-http.test.js`

Expected: FAIL, `/agent/folders` 404.

- [ ] **Step 3: Write minimal implementation**

`hub.js` add:

```js
function publishFolders(payload) {
  for (const res of listeners.get('*') ?? []) {
    write(res, `event: folders\ndata: ${JSON.stringify(payload)}\n\n`);
  }
}
```

Return it next to `publish`.

`routes.js` (same-origin + gate already wrap the handler):

- `GET /agent/folders` → `store.listFolders()`
- `POST /agent/folders` → 201 `createFolder`; then `publishFolders` and `publish` each member summary (`type: 'meta'`)
- `PATCH /agent/folders/:id` → `updateFolder`; 404 if missing
- `DELETE /agent/folders/:id`
- `PUT /agent/folders/working-set` `{ ids }`
- PATCH conversation allowlist: `folderId` (null or 12-hex; 400 if non-null and not in catalog), `pinned` boolean, `focusX`/`focusY` number or null

`app.js`: `'agent-folders.js': () => path.join(REPO, 'runtime', 'agent-folders.js')` on `RUNTIME`; inject `<script src="/runtime/agent-folders.js" data-marble-transient></script>` next to `agent-ui.js`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-reporter=spec test/agent-http.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/agent/hub.js server/agent/routes.js server/app.js test/agent-http.test.js
git commit -m "$(cat <<'EOF'
Expose agent folders over HTTP and inject folder helpers.

EOF
)"
```

---

### Task 4: `window.marble.agent` folder methods

**Files:**
- Modify: `runtime/agent.js`
- Create: `test-browser/agents-folders.test.js` (folder API round-trip on the Agents page; later tasks append UI tests to this file)

**Interfaces:**
- Consumes: Task 3 routes
- Produces: `agent.folders()`, `agent.createFolder(body)`, `agent.updateFolder(id, patch)`, `agent.deleteFolder(id)`, `agent.saveWorkingSet(ids)`; `agent.on('*', fn)` also receives `{ folders, workingSetIds }` from `event: folders`

- [ ] **Step 1: Write the failing test**

Copy the `openAgents` helper from `test-browser/agents-page.test.js` (same `startDrive`, `sourceOfAgents`, `GARDEN`) into `test-browser/agents-folders.test.js`. Then:

```js
test('marble.agent can create and list a folder', async () => {
  const { page } = await openAgents();
  const result = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    const folder = await agent.createFolder({ conversationIds: [a, b], name: 'CHI', color: 'fun' });
    const listed = await agent.folders();
    return { folder, listed, aFolder: (await agent.conversation(a)).meta.folderId };
  });
  assert.equal(result.folder.name, 'CHI');
  assert.equal(result.listed.folders.length, 1);
  assert.equal(result.aFolder, result.folder.id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-folders.test.js`

Expected: FAIL, `createFolder` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `runtime/agent.js` `agent` object:

```js
folders: () => ask('/agent/folders'),
createFolder: (body) => ask('/agent/folders', { method: 'POST', body }),
updateFolder: (id, patch) => ask(`/agent/folders/${enc(id)}`, { method: 'PATCH', body: patch }),
deleteFolder: (id) => ask(`/agent/folders/${enc(id)}`, { method: 'DELETE' }),
saveWorkingSet: (ids) => ask('/agent/folders/working-set', { method: 'PUT', body: { ids } }),
```

In `on()`, when `key === '*'`, also `entry.source.addEventListener('folders', deliver);`

- [ ] **Step 4: Run tests and make sure they pass**

Run the same browser file as Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent.js test-browser/agents-folders.test.js
git commit -m "$(cat <<'EOF'
Add folder methods on window.marble.agent.

EOF
)"
```

---

### Task 5: Four-view switcher

**Files:**
- Modify: `templates/agents.mrbl` (topbar buttons, `setView`, `restoreView`, `V`, CSS hide/show, two empty shells `.folders` and `.focus`)
- Modify: `test-browser/agents-page.test.js` only if a test assumes `V` is a two-way toggle that would break; keep first `V` → Board

**Interfaces:**
- Consumes: none of the folder APIs yet
- Produces: `body[data-view]` in `library|board|folders|focus`; localStorage accepts four names; empty Folders and Focus sections in the file (with `data-marble-id` on the sections and the two new buttons)

- [ ] **Step 1: Write the failing test**

In `test-browser/agents-page.test.js` (or folders file):

```js
test('V cycles List, Board, Folders, Focus and does not file the view', async () => {
  const { page } = await openAgents();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'folders');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'focus');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'library');
  const filed = await page.evaluate(() => window.marble.source.outer(document.body));
  assert.equal(filed.includes('data-view="focus"'), false, 'focus is page-only and must not be filed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-page.test.js`

Expected: FAIL, second `V` returns to library.

- [ ] **Step 3: Write minimal implementation**

In `templates/agents.mrbl`:

- Add buttons Folders / Focus next to Board.
- Add `<div class="folders">` with `.folder-rail` and a workspace that **reuses** `.library`’s `.pane` via CSS (do not move `marble-conversation`). Pattern: `body[data-view=folders] .board { display:none }`, `body[data-view=folders] .library { display:grid }` but hide `#list` and show `.folder-rail` in the list column. Focus: `body[data-view=focus] .library, .board { display:none }` and show `.focus` full-bleed under the topbar. When Focus needs the live pane, position `.pane` absolutely onto the primary Full frame in Task 8. For this task `.focus` can be an empty labeled region.
- `setView` accepts four names. Cycle array `['library','board','folders','focus']`.
- `restoreView` accepts four names.
- `pageOnly` already includes `data-view`.
- Pressed CSS: extend the existing `body[data-view=…] .views [data-view=…]` rules.
- Reduced-motion crossfade: fade the incoming shell (library, board, folders, or focus).

Mint every new element with `__ID__` like the rest of the template.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-page.test.js`

Expected: PASS, including existing Board tests.

- [ ] **Step 5: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-page.test.js
git commit -m "$(cat <<'EOF'
Cycle Agents through List, Board, Folders, and Focus.

EOF
)"
```

---

### Task 6: Folders sidebar (tab groups + New chat)

**Files:**
- Modify: `templates/agents.mrbl`
- Test: `test-browser/agents-folders.test.js`

**Interfaces:**
- Consumes: `agent.folders()`, `agent.conversations()`, `agent.start`, `agent.update`; `marbleAgentFolders.REALMS` for CSS variables on `[data-color]`
- Produces: `.folder-rail` listing group headers, nested tabs, ungrouped block, `+ New chat`; click header opens that folder; click ungrouped tab opens that chat in `.pane`

- [ ] **Step 1: Write the failing test**

```js
test('Folders rail groups conversations and New chat lands ungrouped', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'outline spec' });
    await agent.update(b, { title: 'figure pass' });
    await agent.createFolder({ conversationIds: [a, b], name: 'Research', color: 'research' });
    window.__ids = { a, b };
  });
  await page.locator('.views [data-view="folders"]').click();
  await page.locator('.folder-group[data-color="research"]', { hasText: 'Research' }).waitFor();
  assert.match(await page.locator('.folder-group[data-color="research"]').textContent(), /outline spec/);
  await page.locator('.folder-new-chat').click();
  await page.waitForFunction(() => document.querySelectorAll('.folder-ungrouped .folder-tab').length >= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-folders.test.js`

Expected: FAIL, missing `.folder-group`.

- [ ] **Step 3: Write minimal implementation**

Paint the rail from `agent.folders()` + `summaries` Map (reuse `upsert`). On `agent.on('*', …)`, if the payload has `folders`, repaint the rail; if it has `id`, keep calling `upsert`. Group order from `folder.order`. Nested tabs: conversations whose `folderId` matches, not archived unless filter is archived. Ungrouped: `folderId` null, at the bottom, always rendered (empty drop target). `+ New chat` calls existing `startNew` and stays ungrouped.

Click group header: `activeFolderId = folder.id`, restore that folder’s `openIds` into the existing `dock` extras (cap 4), `open` the first. Click nested tab: same folder, `open(id)` and add to `openIds` via `updateFolder`. Click ungrouped: `activeFolderId = null`, `open(id)`, clear extras.

CSS: group uses Drive realm tokens via `[data-color="research"]` etc. (copy the five `--folder` blocks from `templates/drive.mrbl`, plus five extras for `clay, sage, mist, ink, gold` using the existing tag hues).

All rail nodes are `data-marble-transient`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-folders.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-folders.test.js
git commit -m "$(cat <<'EOF'
Render Agents Folders as vertical tab groups.

EOF
)"
```

---

### Task 7: Folders grouping gestures

**Files:**
- Modify: `templates/agents.mrbl`
- Modify: `test-browser/agents-folders.test.js`

**Interfaces:**
- Consumes: `createFolder`, `update` (`folderId`), `deleteFolder` (via dissolve in store), `saveWorkingSet`
- Produces: drop tab-on-tab creates or joins; drop on ungrouped leaves; last member dissolves; Shift/Cmd multi-select tiles a working set and shows Save / Not now; drop on `.pane` joins the open folder or the working set

- [ ] **Step 1: Write the failing tests**

```js
test('dropping a tab on another tab creates a folder', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'alpha' });
    await agent.update(b, { title: 'beta' });
    return { a, b };
  });
  await page.locator('.views [data-view="folders"]').click();
  const alpha = page.locator(`.folder-tab[data-id="${ids.a}"]`);
  const beta = page.locator(`.folder-tab[data-id="${ids.b}"]`);
  await alpha.waitFor();
  await alpha.dragTo(beta);
  await page.locator('.folder-group').waitFor();
  const listed = await page.evaluate(() => window.marble.agent.folders());
  assert.equal((await listed).folders.length, 1);
});

test('Save as folder persists a shift-selected working set; Not now does not', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'one' });
    await agent.update(b, { title: 'two' });
    return { a, b };
  });
  await page.locator('.views [data-view="folders"]').click();
  await page.locator(`.folder-tab[data-id="${ids.a}"]`).click();
  await page.locator(`.folder-tab[data-id="${ids.b}"]`).click({ modifiers: ['Shift'] });
  await page.locator('.folder-save').waitFor();
  await page.locator('.folder-save-dismiss').click();
  let listed = await page.evaluate(() => window.marble.agent.folders());
  assert.equal((await listed).folders.length, 0);
  await page.locator(`.folder-tab[data-id="${ids.b}"]`).click({ modifiers: ['Shift'] });
  await page.locator('.folder-save-confirm').click();
  listed = await page.evaluate(() => window.marble.agent.folders());
  assert.equal((await listed).folders.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-folders.test.js`

Expected: FAIL on missing group after drag (or missing `.folder-save`).

- [ ] **Step 3: Write minimal implementation**

Pointer: 10px hysteresis, `setPointerCapture`, follow with a `.dock-card`-style ghost (existing Agents drag card). On drop:

- Over ungrouped tab: if dragging a grouped tab, `update(id, { folderId: null })`.
- Over grouped tab or group header: `update(id, { folderId: thatFolder })`.
- Over ungrouped tab while dragging ungrouped: `createFolder({ conversationIds: [dragId, targetId] })`.
- Over `.pane` while a folder is active: join that folder and `openIds`.
- Over `.pane` during a working set: append to `workingSetIds` and `saveWorkingSet`.

Multi-select: Shift = range between last anchor and this tab in rail order; Cmd/Ctrl = toggle. When `selectedIds.length >= 2`, set `workingSetIds`, tile dock extras (cap 4), show a popover `.folder-save` with name input (placeholder `suggestName`), **Save as folder** / **Not now**.

One-level undo: keep `lastFolderGesture = { type, inverse }` and Mod+Z applies the inverse (`createFolder` ↔ `deleteFolder`, `folderId` swap). Guard with `typingIn()`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-folders.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-folders.test.js
git commit -m "$(cat <<'EOF'
Create and move Agents folders with drag and multi-select.

EOF
)"
```

---

### Task 8: Focus cards, LOD, pack, and pin gestures

**Files:**
- Modify: `templates/agents.mrbl`
- Test: `test-browser/agents-focus.test.js`

**Interfaces:**
- Consumes: `assignLods`, `separateRects`, `GAP`, `agent.update` for `pinned` / `focusX` / `focusY`; existing dock live-conversation rule
- Produces: `.focus-card` per matching conversation; click selects; double-click pins Full; other Fulls become Digest; drag 1:1 then separate+ease-out; primary Full frames `.pane` without reparenting; extra Fulls are transient conversations

- [ ] **Step 1: Write the failing tests**

```js
test('click selects a Focus card; double-click pins Full and demotes the previous Full to digest', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'first', pinned: true });
    await agent.update(b, { title: 'second' });
    return { a, b };
  });
  await page.locator('.views [data-view="focus"]').click();
  const second = page.locator(`.focus-card[data-id="${ids.b}"]`);
  await second.click();
  assert.equal(await second.getAttribute('data-selected'), 'true');
  assert.equal(await second.getAttribute('data-lod'), 'digest');
  await second.dblclick();
  await page.waitForFunction((id) => {
    const el = document.querySelector(`.focus-card[data-id="${id}"]`);
    return el?.getAttribute('data-lod') === 'full';
  }, ids.b);
  assert.equal(await page.locator(`.focus-card[data-id="${ids.a}"]`).getAttribute('data-lod'), 'digest');
  const stillInPane = await page.evaluate(() => Boolean(document.querySelector('.pane > marble-conversation:not([data-marble-transient])')));
  assert.equal(stillInPane, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-focus.test.js`

Expected: FAIL, missing `.focus-card`.

- [ ] **Step 3: Write minimal implementation**

`.focus` is a positioned canvas. Each card: `data-lod`, `data-selected`, `data-color` from its folder. Sizes: Full `min(72vw, 920px)` × `min(70vh, 720px)` (split if 2–4 Fulls); Digest 280×200; Chip 168×56. `assignLods` each paint. `separateRects` then WAAPI `transform`/`width`/`height` with `easing: 'ease-out', duration: 400` from the **current** computed box (read `getBoundingClientRect`, do not start from the target). Reduced motion: duration 150, opacity only, set left/top instantly.

Click vs double-click: pointerup without drag → select immediately (Chip peeks to Digest by adding to `selectedIds`). Second click within 400ms on the same card → pin: `update(id, { pinned: true })` and `update(otherFull, { pinned: false })` unless Shift was held (Keep open). If Keep-open would exceed `FULL_CAP` (4), unpin the Full with the oldest `lastInteractedAt` first. Drag if movement > 10px: capture, 1:1, on release `separateRects` + PATCH `focusX/Y` as fractions of the canvas.

Primary Full: measure the card frame, set `.pane` `position:absolute; left/top/width/height` to that frame (canvas-relative). Extra Fulls: clone the dock-extra pattern (`data-marble-transient` conversation). Leaving Focus clears `.pane` inline position.

Header buttons Focus / Keep open / collapse as real `<button>`s, `:hover` and `:focus-within`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-focus.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-focus.test.js
git commit -m "$(cat <<'EOF'
Add Focus cards with pin-to-Full and packed layout.

EOF
)"
```

---

### Task 9: Focus keyboard, Quick Look, basins, decay

**Files:**
- Modify: `templates/agents.mrbl`
- Modify: `test-browser/agents-focus.test.js`

**Interfaces:**
- Consumes: `nearestCard`, `assignLods`, `agent.conversation` (events for Quick Look), folder catalog for basins
- Produces: arrow-move selection; Space Quick Look (no pin); Enter from Quick Look pins; Escape layered dismiss; basins join/leave; 45s+budget Chip decay, interruptible on hover

- [ ] **Step 1: Write the failing tests**

```js
test('arrows move Focus selection; Space previews without pinning', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'left-card' });
    await agent.update(b, { title: 'right-card' });
    return { a, b };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.a}"]`).click();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.focus-card[data-selected="true"]')?.textContent.includes('right-card')
    || document.querySelector('.focus-card[data-selected="true"]')?.dataset.id);
  await page.keyboard.press('Space');
  await page.locator('.focus-look').waitFor();
  const pinned = await page.evaluate((id) => window.marble.agent.conversation(id), ids.b);
  assert.equal((await pinned).meta.pinned, false);
  await page.keyboard.press('Enter');
  await page.waitForFunction((id) => document.querySelector(`.focus-card[data-id="${id}"]`)?.getAttribute('data-lod') === 'full', ids.b);
});

test('dropping a card on another ungrouped card forms a basin', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'a' });
    await agent.update(b, { title: 'b' });
    return { a, b };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.a}"]`).dragTo(page.locator(`.focus-card[data-id="${ids.b}"]`));
  await page.locator('.focus-basin').waitFor();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-focus.test.js`

Expected: FAIL, missing `.focus-look` or `.focus-basin`.

- [ ] **Step 3: Write minimal implementation**

Keyboard: if view is focus and `!typingIn()`, arrows call `nearestCard` using card centers; Shift+arrow appends selection; Enter = pin selection (exclusive unless already a multi Full add via Shift); Space toggles `.focus-look` (transient overlay: title, target, activity, last events from `agent.conversation`, no composer); Escape closes look, else unpins selected Full, else clears selection.

Basins: for each folder, a `.focus-basin` behind cards, padded bounding box, `data-color`, editable name (PATCH `updateFolder`). Drop target: if pointer in basin, join; if on empty canvas, ungroup; if on another ungrouped card, `createFolder`. Folder chip `<button>` on Digest/Full header opens a menu (folders + Ungrouped + Save as folder).

Decay: `setInterval` 1s while `data-view=focus` and not `document.hidden`, recompute `assignLods`. Hover sets `hoveredId` and cancels Chip. Do not Chip running / needsReview / selected.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-focus.test.js test-browser/agents-folders.test.js test-browser/agents-page.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-focus.test.js
git commit -m "$(cat <<'EOF'
Add Focus keyboard, Quick Look, basins, and Digest cooling.

EOF
)"
```

---

### Task 10: Narrow, reduced motion, docs, full suite

**Files:**
- Modify: `templates/agents.mrbl` (narrow stack; reduced-motion duration)
- Modify: `docs/AGENTS.md`
- Test: add cases in `test-browser/agents-focus.test.js` / `agents-folders.test.js`

**Interfaces:**
- Consumes: existing `narrowView` and `reduceMotion` media queries
- Produces: documented Folders and Focus; no extra panes when narrow/reduced-motion; Focus stack; `V` crossfade 150 ms

- [ ] **Step 1: Write the failing tests**

```js
test('narrow Focus is a stack and does not add extra panes', async () => {
  const { page } = await openAgents({ viewport: { width: 500, height: 800 } });
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    await agent.start({ provider: 'fake' });
    await agent.start({ provider: 'fake' });
  });
  await page.locator('.views [data-view="focus"]').click();
  assert.equal(await page.locator('.focus[data-stack]').count(), 1);
  assert.equal(await page.locator('.pane marble-conversation[data-marble-transient]').count(), 0);
});
```

Use the same `prefers-reduced-motion` pattern as the existing Agents page test (emulate media). Assert no `transform` on cards after a pin, opacity transition only.

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-focus.test.js`

Expected: FAIL until `[data-stack]` exists.

- [ ] **Step 3: Write minimal implementation**

When `narrowView.matches`, `.focus` gets `data-stack`, cards are a column, skip `separateRects`, skip extra conversations. Folders: hide extra dock extras (existing early return). Reduced motion: pin/LOD/view changes are 150 ms opacity; `separateRects` applied instantly.

Update `docs/AGENTS.md` “The Agents document”: four views, Folders tab groups, Focus pins, exclusive folders, Quick Look Space, `V` cycle. Do not claim conversation rows live in the file.

- [ ] **Step 4: Run the full suite**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 --test-reporter=spec test-browser/agents-page.test.js test-browser/agents-folders.test.js test-browser/agents-focus.test.js && PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH npm test`

Expected: all PASS. Fix any regression (especially `V` List→Board and pane docking on Board).

- [ ] **Step 5: Commit**

```bash
git add templates/agents.mrbl test-browser/agents-focus.test.js test-browser/agents-folders.test.js docs/AGENTS.md
git commit -m "$(cat <<'EOF'
Document Folders and Focus and honor narrow and reduced motion.

EOF
)"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| §4 four views, `V` order | 5, 10 |
| §5.1–5.2 rail + workspace | 6 |
| §5.3 create/move/working set | 7 |
| §5.4 name/color | 1, 2, 6 |
| §5.5 undo dissolve | 7 |
| §6.1–6.3 LOD, pin, decay | 1, 8, 9 |
| §6.4–6.5 keyboard, Quick Look | 9 |
| §6.6 pack/drag | 1 (`separateRects`), 8 |
| §6.7 basins | 9 |
| §6.8 do not reparent | 8 |
| §7 data model / HTTP / agent | 2, 3, 4 |
| §8 reduced motion / a11y buttons | 8, 10 |
| §11 tests | each task |
