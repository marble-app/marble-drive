# Agents Drawer Implementation Plan (Plan 3 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In any Marble document, a launcher opens a drawer where you talk to an agent about that document, watch its edits land live, stop it, and undo its turn — the conversation following you from page to page.

**Architecture:** The host injects two scripts into every document when agents are on: `runtime/agent.js` adds `window.marble.agent` (a thin client for the `/agent/*` routes, event streams, and the page's selection), and `runtime/agent-ui.js` defines two shadow-DOM custom elements — `<marble-conversation>` (transcript + composer, reused by `Agents.mrbl` in Plan 4) and `<marble-agent-drawer>` (launcher, overlay/pinned panel, menus) — and mounts the drawer as a transient element. Browser behaviour is tested with Playwright, resolved through the Marble package the way `server/engine.js` resolves Marble itself.

**Tech Stack:** Plain browser JS (no build step, no framework), Custom Elements + Shadow DOM, `EventSource`, `requestAnimationFrame` spring; Node ≥ 22 `node:test`; Playwright via `@bdhmin/marble`'s own `node_modules` (no new dependency).

**Spec:** `docs/superpowers/specs/2026-09-16-agent-interface-design.md` §9 (`window.marble.agent`), §10 (the drawer), §6.3 (needs review), §13 (known limitations); `docs/AGENTS.md`; the Drive's visual language in `templates/drive.mrbl` (tokens "UIST warm" / "Dusk", motion curves).

**Note on UI code:** tasks 3 and 4 give complete code, and each ends with a visual check against screenshots. Implementers may change CSS values (spacing, sizes, colours within the token set) after looking at the screenshots; they may not change behaviour, DOM contracts, or the tests' assertions.

## Global Constraints

- No new npm dependencies. Browser tests import Playwright from the Marble package: `new URL('node_modules/playwright/index.mjs', import.meta.resolve('@bdhmin/marble/package.json'))`.
- Browser tests live in `test-browser/` (not `test/`, so `npm test` stays headless-free) and run with `npm run test:browser` (`node --test --test-concurrency=1 --test-reporter=spec "test-browser/*.test.js"`).
- Scripts are injected only when `drive.agents` is non-null, with `data-marble-transient`, after `runtime/drive.js`: `/runtime/agent.js` always, `/runtime/agent-ui.js` unless the document contains `<meta name="marble-agent" content="custom">`.
- Nothing the drawer draws is document content: the drawer element carries `data-marble-transient`; docking is a transient `<style data-marble-transient id="marble-agent-dock">` in `<head>`, never an attribute or style on `<html>`/`<body>`. After any drawer interaction, the document file on disk must be byte-identical unless an agent edited it.
- Agent text is never parsed as HTML. Rendering builds DOM nodes with `textContent`; links are created only for `http:`/`https:` URLs, with `target="_blank"` and `rel="noopener noreferrer"`.
- `localStorage` keys, each access wrapped in try/catch: `marble-agent:conversation` (open conversation id), `marble-agent:open` (`'1'`/`'0'`), `marble-agent:pinned` (`'1'`/`'0'`).
- Shortcut: `⌘J` / `Ctrl+J` toggles the drawer; `Escape` closes it when focus is inside it.
- Sizes: panel width `420px`; below `720px` viewport width the panel is a full-screen sheet from the bottom and pinning is unavailable. Launcher `44px`, `20px` from the bottom-right corner plus safe-area insets.
- Motion: drawer open/close is a critically damped spring on a 0–1 progress value, `response 0.34s`, started from the current progress (interruptible); release velocity is projected with `project(v) = (v/1000)·0.998/(1−0.998)`. `prefers-reduced-motion: reduce` → no transform motion, a 150 ms opacity cross-fade.
- Tokens (inside shadow roots, light / dark): ink `#111111`/`#e8e6e1`, muted `#5a5a5a`/`#a3a7ab`, faint `#8a8a8a`/`#71767a`, line `#ddd9cf`/`#2f3438`, paper `#fafaf7`/`#16181a`, paper-2 `#f3f1ea`/`#1e2124`, card `#ffffff`/`#1c1f22`, accent `#9bb6cf`/`#7fa8c9`, accent-soft `#f1f5f8`/`#1d2932`, accent-ink `#738698`/`#9dc0dc`, danger `#b4533e`/`#e08a74`, caution `#a07a2c`/`#d9b25e`. Font `14px/1.5 "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Code style: match the repo — ESM on the server, IIFE scripts in `runtime/`, two-space indent, single quotes, comments in the existing voice (why, not what).
- `npm test` baseline at plan start: 309 passing. Never bind or stop port 4400.

## File Structure

| file | responsibility |
|---|---|
| `server/app.js` (modify) | serve `/runtime/agent.js`, `/runtime/agent-ui.js`; inject them when agents are on |
| `server/agent/routes.js` (modify) | `/agent/providers` entries gain `defaultModel` |
| `server/agent/providers/cursor.js` (modify) | expose `defaultModel` on the provider |
| `runtime/agent.js` | `window.marble.agent` |
| `runtime/agent-ui.js` | `renderText`, `<marble-conversation>`, `<marble-agent-drawer>`, mounting |
| `test-browser/harness.js` | a scratch drive with the fake provider + a Chromium, for browser tests |
| `test-browser/agent-api.test.js`, `test-browser/conversation.test.js`, `test-browser/drawer.test.js` | browser tests |
| `test-browser/screens.mjs` | screenshots for the visual check (not a test) |
| `package.json` (modify) | `test:browser` script |
| `docs/CARRIER-DRIVE.md`, `docs/AGENTS.md` (modify) | the `marble.agent` surface; the drawer |

---

### Task 1: Serve and inject the agent scripts; providers report their default model

**Files:**
- Modify: `server/app.js` (the `RUNTIME` map near line 84, `injectCarrier` near line 125)
- Modify: `server/agent/routes.js` (`detectAll`)
- Modify: `server/agent/providers/cursor.js` (the returned provider object)
- Create: `runtime/agent.js`, `runtime/agent-ui.js` as one-line placeholders so the routes have files to serve (Tasks 2–4 replace them)
- Test: `test/agent-http.test.js` (append), `test/agent-provider-cursor.test.js` (append)

**Interfaces:**
- Produces: `GET /runtime/agent.js` and `GET /runtime/agent-ui.js` (JavaScript, 200). Document HTML (`GET /a/<path>`) contains `<script src="/runtime/agent.js" data-marble-transient></script>` and, unless the document has `<meta name="marble-agent" content="custom">`, `<script src="/runtime/agent-ui.js" data-marble-transient></script>`, both after `/runtime/drive.js` — only when `drive.agents` is non-null. `/agent/providers` entries: `{ id, label, installed, signedIn, detail, default, defaultModel }` (`defaultModel` is the provider's `defaultModel` property or `null`). Cursor provider object has `defaultModel` (`'composer-2.5'` unless constructed otherwise).

- [ ] **Step 1: Write the failing tests**

Append to `test/agent-http.test.js`, before `test.after`:

```js
test('a document is served with the agent scripts after the Drive’s, when agents are on', async () => {
  const page = await (await fetch(`${base}/a/garden`)).text();
  const drive = page.indexOf('/runtime/drive.js');
  const api = page.indexOf('<script src="/runtime/agent.js" data-marble-transient></script>');
  const ui = page.indexOf('<script src="/runtime/agent-ui.js" data-marble-transient></script>');
  assert.ok(drive > 0 && api > drive && ui > api, 'drive.js, then agent.js, then agent-ui.js');
  for (const file of ['agent.js', 'agent-ui.js']) {
    const response = await fetch(`${base}/runtime/${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-type'), /javascript/);
  }
});

test('a document that presents agents itself gets the API but not the drawer', async () => {
  await drive.createDocument('custom-agents', SOURCE.replace('<title>', '<meta name="marble-agent" content="custom"><title>'));
  const page = await (await fetch(`${base}/a/custom-agents`)).text();
  assert.ok(page.includes('/runtime/agent.js'));
  assert.ok(!page.includes('/runtime/agent-ui.js'));
});

test('providers say which model they use unless told otherwise', async () => {
  const { body } = await api('GET', '/agent/providers');
  assert.equal(body[0].defaultModel, null, 'the fake provider has none');
});
```

Append inside the existing `a host with agents off answers 404 to all of it` test, just before `await off.close();`:

```js
  await off.createDocument('plain', SOURCE);
  const plain = await (await fetch(`http://127.0.0.1:${offPort}/a/plain`)).text();
  assert.ok(!plain.includes('/runtime/agent'), 'no agent scripts when agents are off');
```

Append to `test/agent-provider-cursor.test.js`:

```js
test('the provider names its default model, for the picker', () => {
  assert.equal(createCursorProvider({ env: {} }).defaultModel, 'composer-2.5');
  assert.equal(createCursorProvider({ env: {}, defaultModel: 'gpt-5.2' }).defaultModel, 'gpt-5.2');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-reporter=spec test/agent-http.test.js test/agent-provider-cursor.test.js`
Expected: FAIL — no agent scripts in the page, `/runtime/agent.js` 404, `defaultModel` undefined.

- [ ] **Step 3: Implement**

Create `runtime/agent.js` with the single line `// window.marble.agent — see Task 2.` and `runtime/agent-ui.js` with `// The agent drawer — see Tasks 3–4.` (placeholders so the routes serve real files; Tasks 2–4 replace them).

In `server/app.js`, add to `RUNTIME` after `'drive.js'`:

```js
  // Agents, when they are on: the client for /agent/* and the drawer that
  // uses it. Served to every document; injected only when agents run here.
  'agent.js': () => path.join(REPO, 'runtime', 'agent.js'),
  'agent-ui.js': () => path.join(REPO, 'runtime', 'agent-ui.js'),
```

Replace `injectCarrier` with:

```js
  const injectCarrier = (source, docPath) => {
    let tags =
      `<script src="/runtime/marble.js" data-marble-app="${escapeHtml(docPath)}" data-marble-transient></script>\n` +
      `<script src="/runtime/drive.js" data-marble-transient></script>`;
    if (agents) {
      tags += `\n<script src="/runtime/agent.js" data-marble-transient></script>`;
      // A document that draws its own agent interface (Agents.mrbl) wants the
      // client and not a second drawer on top of itself.
      if (!/<meta\s+name="marble-agent"\s+content="custom"\s*\/?>/i.test(source)) {
        tags += `\n<script src="/runtime/agent-ui.js" data-marble-transient></script>`;
      }
    }
    return source.includes('</body>')
      ? source.replace(/<\/body>/i, () => `${tags}\n</body>`)
      : source + tags;
  };
```

(`agents` is the `let` declared before the server is created; `injectCarrier` only runs inside request handling, after it has been assigned.)

In `server/agent/routes.js` `detectAll`, change the mapped object to:

```js
        return { id: provider.id, label: provider.label, defaultModel: provider.defaultModel ?? null, ...found };
```

In `server/agent/providers/cursor.js`, add `defaultModel,` to the returned provider object right after `label: 'Cursor',`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --test-reporter=spec test/agent-http.test.js test/agent-provider-cursor.test.js && npm test`
Expected: PASS; full suite 313.

- [ ] **Step 5: Commit**

```bash
git add server/app.js server/agent/routes.js server/agent/providers/cursor.js runtime/agent.js runtime/agent-ui.js test/agent-http.test.js test/agent-provider-cursor.test.js
git commit -m "Agents drawer: every document gets the agent scripts when agents are on"
```

---

### Task 2: The browser harness and `window.marble.agent`

**Files:**
- Create: `test-browser/harness.js`
- Replace: `runtime/agent.js`
- Modify: `package.json` (`test:browser` script)
- Test: `test-browser/agent-api.test.js`

**Interfaces:**
- Consumes: Task 1 injection; the `/agent/*` routes (Plan 1): `GET /agent/providers`, `GET|PUT /agent/settings`, `GET /agent/conversations[?archived=1]`, `POST /agent/conversations {provider, model?, handoffFrom?}` → 201 `{id,…}`, `GET /agent/conversations/:id` → `{meta, turns, events}`, `PATCH /agent/conversations/:id {archived?, reviewed?}`, `POST /agent/conversations/:id/turns {prompt, context}` → 202 `{turnId, status}`, `POST /agent/turns/:id/cancel`, `POST /agent/turns/:id/undo`, `DELETE /agent/turns/:id`, `GET /agent/events?conversation=:id` (SSE `id:` = seq, `data:` = event JSON; replays from `Last-Event-ID`), `GET /agent/events?all=1` (SSE `event: summary`); `POST /restore?app=<path>&sha=<sha>`. Carrier: `window.marble.app` (this document's path), `marble:ready` event.
- Produces `window.marble.agent`:
  - `providers()`, `settings()`, `saveSettings(patch)`, `conversations({archived})`, `conversation(id)` → the routes' JSON
  - `start({provider, model?, handoffFrom?}) → Promise<id>`; `handoff(id, provider) → Promise<id>`
  - `send(id, {prompt, target?, viewing?, selection?}) → Promise<{turnId, status}>` — missing context fields come from `context()`
  - `cancel(turnId)`, `undo(turnId)`, `dequeue(turnId)`, `archive(id, archived = true)`, `markReviewed(id)`, `restore(path, sha)`
  - `on(key, fn) → unsubscribe` — `key` is a conversation id (fn gets every event, replayed from the start, with `seq`; live `text.delta` without `seq`) or `'*'` (fn gets summaries). One `EventSource` per key, closed when the last handler leaves.
  - `context() → {viewing, target, selection: string[]}` — `viewing` and `target` are `marble.app`; `selection` is `select()`'s ids if set, else the addressed elements (nearest `[data-marble-id]`, outside transient elements) at the ends of the page's last non-empty text selection.
  - `select(ids | null)`; `current() → id | null` and `remember(id | null)` (the `marble-agent:conversation` key); `open(id?)` / `close()` dispatch `marble:agent-open` `{detail:{id}}` / `marble:agent-close` on `window`.
  - Dispatches `marble:agent` (`detail` = the API) when attached, and `marble:agent-context` whenever `context()` would change.
- Produces `test-browser/harness.js`: `startDrive({ scripts = {}, agents = true, documents = { garden: GARDEN } }) → { drive, base, newPage({viewport, reducedMotion, colorScheme}) → Promise<{page, errors}>, reset() → Promise (rewrites every starting document to its original source, so tests in one file do not inherit each other's edits), close() }`, and `GARDEN` (a document with `<h1 data-marble-id="h">Research Garden</h1>` and a list `q` with items `q1`, `q2`).

- [ ] **Step 1: Write the harness**

Create `test-browser/harness.js`:

```js
// A scratch drive with the scripted fake agent, and a Chromium to open it in.
//
// Playwright is not a dependency of this repo. The Marble package has it, and
// is reached the way server/engine.js reaches Marble: through its package.json
// as a file URL, which an exports map cannot filter.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { createFakeProvider } from '../test/fixtures/fake-provider.js';

const PLAYWRIGHT = new URL('node_modules/playwright/index.mjs', import.meta.resolve('@bdhmin/marble/package.json'));
const { chromium } = await import(PLAYWRIGHT.href);

export const GARDEN = `<!doctype html>
<html><head><meta charset="utf-8"><title>Garden</title>
<style>body { font: 16px/1.5 Georgia, serif; margin: 40px; } h1 { font-size: 32px; }</style>
</head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Research Garden</h1>
  <p data-marble-id="p">Open questions we keep coming back to.</p>
  <ul data-marble-id="q">
    <li data-marble-id="q1">Why do people stop using a tool?</li>
    <li data-marble-id="q2">What makes an interface feel alive?</li>
  </ul>
</body></html>
`;

const quiet = { log() {}, error() {} };

export async function startDrive({ scripts = {}, agents = true, documents = { garden: GARDEN } } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-browser-drive-'));
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-browser-work-'));
  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_DATA: '',
    MARBLE_DRIVE_SECRET: '',
    HOST: '127.0.0.1',
    MARBLE_DRIVE_AGENTS: agents ? '1' : '',
    MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
    MARBLE_DRIVE_AGENT_WORKDIR: workdir,
    MARBLE_DRIVE_BACKUP_DIR: '',
    MARBLE_DRIVE_BACKUP_CMD: '',
  });
  const drive = await createDrive(config, {
    log: quiet,
    agentProviders: new Map([['fake', createFakeProvider({ scripts })]]),
  });
  for (const [docPath, source] of Object.entries(documents)) await drive.createDocument(docPath, source, { label: 'test' });
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();

  return {
    drive,
    base,
    async reset() {
      for (const [docPath, source] of Object.entries(documents)) await drive.createDocument(docPath, source, { label: 'reset' });
    },
    async newPage({ viewport = { width: 1280, height: 800 }, reducedMotion = 'no-preference', colorScheme = 'light' } = {}) {
      const context = await browser.newContext({ viewport, reducedMotion, colorScheme });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      return { page, errors };
    },
    async close() {
      await browser.close();
      await drive.close();
      await fsp.rm(root, { recursive: true, force: true });
      await fsp.rm(workdir, { recursive: true, force: true });
    },
  };
}
```

In `package.json` `scripts`, after `"test"`, add:

```json
    "test:browser": "node --test --test-concurrency=1 --test-reporter=spec \"test-browser/*.test.js\"",
```

- [ ] **Step 2: Write the failing test**

Create `test-browser/agent-api.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS });
test.after(() => host.close());

const open = async (path = 'garden') => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/${path}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  return { page, errors };
};

test('the agent API attaches to the carrier and reaches the host', async () => {
  const { page, errors } = await open();
  const providers = await page.evaluate(() => window.marble.agent.providers());
  assert.equal(providers[0].id, 'fake');
  assert.equal(providers[0].default, true);
  assert.deepEqual(errors, []);
});

test('start and send run a turn, and the stream replays and follows it', async () => {
  const { page } = await open();
  const events = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    const seen = [];
    await new Promise((resolve) => {
      const off = agent.on(id, (event) => {
        seen.push(event);
        if (event.type === 'turn.completed') {
          off();
          resolve();
        }
      });
      agent.send(id, { prompt: 'script:rename' });
    });
    return seen;
  });
  const types = events.map((e) => e.type);
  for (const type of ['user', 'turn.started', 'tool.call', 'ops.applied', 'text.delta', 'text', 'turn.completed']) {
    assert.ok(types.includes(type), type);
  }
  const stored = events.filter((e) => e.seq);
  assert.deepEqual(stored.map((e) => e.seq), stored.map((_, i) => i + 1), 'every stored event once, in order');
  assert.equal(events.find((e) => e.type === 'user').context.target, 'garden', 'the target is this document');
  assert.match(await host.drive.store.read('garden'), />Backlog</);
});

test('context is this document and the addressed elements the person selected', async () => {
  const { page } = await open();
  const empty = await page.evaluate(() => window.marble.agent.context());
  assert.deepEqual(empty, { viewing: 'garden', target: 'garden', selection: [] });

  await page.evaluate(() => {
    const range = document.createRange();
    range.setStart(document.querySelector('[data-marble-id="q1"]').firstChild, 0);
    range.setEnd(document.querySelector('[data-marble-id="q2"]').firstChild, 4);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 2);
  assert.deepEqual((await page.evaluate(() => window.marble.agent.context())).selection, ['q1', 'q2']);

  // Clicking away inside the document clears it.
  await page.evaluate(() => getSelection().collapse(document.querySelector('[data-marble-id="p"]').firstChild, 1));
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 0);
});

test('a selection survives focus moving into transient chrome', async () => {
  const { page } = await open();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-marble-id="h"]'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const chrome = document.createElement('div');
    chrome.setAttribute('data-marble-transient', '');
    chrome.innerHTML = '<input id="chrome-input">';
    document.body.append(chrome);
  });
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 1);
  await page.focus('#chrome-input');
  await page.evaluate(() => getSelection().collapse(document.getElementById('chrome-input'), 0));
  await page.waitForTimeout(50);
  assert.deepEqual((await page.evaluate(() => window.marble.agent.context())).selection, ['h']);
});

test('select() overrides the text selection until cleared', async () => {
  const { page } = await open();
  assert.deepEqual(await page.evaluate(() => {
    window.marble.agent.select(['q2']);
    return window.marble.agent.context().selection;
  }), ['q2']);
  assert.deepEqual(await page.evaluate(() => {
    window.marble.agent.select(null);
    return window.marble.agent.context().selection;
  }), []);
});

test('remember, current, open and close', async () => {
  const { page } = await open();
  const result = await page.evaluate(async () => {
    const agent = window.marble.agent;
    agent.remember('abc123abc123');
    const heard = [];
    addEventListener('marble:agent-open', (e) => heard.push(['open', e.detail.id]));
    addEventListener('marble:agent-close', () => heard.push(['close']));
    agent.open('abc123abc123');
    agent.close();
    return { current: agent.current(), heard };
  });
  assert.deepEqual(result, { current: 'abc123abc123', heard: [['open', 'abc123abc123'], ['close']] });
});

test('a failing call rejects with the host’s own words', async () => {
  const { page } = await open();
  const message = await page.evaluate(() => window.marble.agent.start({ provider: 'nope' }).catch((err) => err.message));
  assert.equal(message, 'no provider "nope"');
});

test('the summary stream reports conversations changing', async () => {
  const { page } = await open();
  const summary = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const heard = new Promise((resolve) => {
      const off = agent.on('*', (s) => {
        off();
        resolve(s);
      });
    });
    await new Promise((r) => setTimeout(r, 100));
    const id = await agent.start({ provider: 'fake' });
    agent.send(id, { prompt: 'script:rename' });
    return heard;
  });
  assert.ok(summary.id);
  assert.ok('needsReview' in summary);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:browser`
Expected: FAIL — `page.waitForFunction` times out: `window.marble.agent` is undefined (the placeholder defines nothing).

- [ ] **Step 4: Implement `runtime/agent.js`**

```js
// The agents surface of the carrier: `window.marble.agent`.
//
// Like `marble.drive`, a namespace a document can test for, and a proposal for
// the carrier rather than part of it. It is only ever injected when the host
// runs agents, so its absence is the answer to "can I talk to an agent here".
//
// Two things it does that are not just fetch calls:
//
//   - it remembers what the person last selected in the document, because the
//     moment they click into a composer to ask about it, the page's selection
//     collapses — focus moving into transient chrome is not a new selection;
//   - it keeps one event stream per conversation, however many views of that
//     conversation are open, and closes it when the last one goes.

(() => {
  const KEY = 'marble-agent:conversation';
  const TRANSIENT = '[data-marble-transient]';

  const attach = (marble) => {
    if (marble.agent) return;

    const enc = encodeURIComponent;

    const ask = async (route, { method = 'GET', body = null } = {}) => {
      const response = await fetch(route, {
        method,
        cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(answer.error ?? `${route} answered ${response.status}`);
      return answer;
    };

    // ---------------------------------------------------------- the selection

    let chosen = null;
    let remembered = [];

    const elementOf = (node) => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement ?? null);

    const addressed = (node) => {
      const hit = elementOf(node)?.closest?.('[data-marble-id]');
      if (!hit || hit.closest(TRANSIENT)) return null;
      return hit.getAttribute('data-marble-id');
    };

    const notify = () => dispatchEvent(new CustomEvent('marble:agent-context'));

    document.addEventListener('selectionchange', () => {
      const selection = getSelection();
      if (!selection || !selection.rangeCount) return;
      // Focus moving into the drawer is not the person choosing something new.
      const anchor = elementOf(selection.anchorNode);
      if (!anchor || anchor.closest(TRANSIENT) || anchor.shadowRoot || anchor.getRootNode() !== document) return;
      if (selection.isCollapsed) {
        if (!remembered.length) return;
        remembered = [];
        notify();
        return;
      }
      const ids = [];
      for (const id of [addressed(selection.anchorNode), addressed(selection.focusNode)]) {
        if (id && !ids.includes(id)) ids.push(id);
      }
      remembered = ids;
      notify();
    });

    const context = () => ({
      viewing: marble.app,
      target: marble.app,
      selection: [...(chosen ?? remembered)],
    });

    // ---------------------------------------------------------- the streams

    const streams = new Map();

    function on(key, fn) {
      let entry = streams.get(key);
      if (!entry) {
        const url = key === '*' ? '/agent/events?all=1' : `/agent/events?conversation=${enc(key)}`;
        entry = { source: new EventSource(url), handlers: new Set() };
        const current = entry;
        const deliver = (message) => {
          let data;
          try {
            data = JSON.parse(message.data);
          } catch {
            return;
          }
          for (const handler of [...current.handlers]) handler(data);
        };
        if (key === '*') entry.source.addEventListener('summary', deliver);
        else entry.source.onmessage = deliver;
        streams.set(key, entry);
      }
      entry.handlers.add(fn);
      return () => {
        entry.handlers.delete(fn);
        if (entry.handlers.size === 0 && streams.get(key) === entry) {
          entry.source.close();
          streams.delete(key);
        }
      };
    }

    // ------------------------------------------------------------- the rest

    const storage = {
      get(key) {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      set(key, value) {
        try {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        } catch {
          // Private browsing, or storage refused. The drawer still works; it just forgets.
        }
      },
    };

    const agent = {
      providers: () => ask('/agent/providers'),
      settings: () => ask('/agent/settings'),
      saveSettings: (patch) => ask('/agent/settings', { method: 'PUT', body: patch }),
      conversations: ({ archived = false } = {}) => ask(`/agent/conversations${archived ? '?archived=1' : ''}`),
      conversation: (id) => ask(`/agent/conversations/${enc(id)}`),

      async start({ provider, model = null, handoffFrom = null } = {}) {
        const body = { provider };
        if (model) body.model = model;
        if (handoffFrom) body.handoffFrom = handoffFrom;
        return (await ask('/agent/conversations', { method: 'POST', body })).id;
      },
      handoff: (id, provider) => agent.start({ provider, handoffFrom: id }),

      send(id, { prompt, target, viewing, selection } = {}) {
        const here = context();
        return ask(`/agent/conversations/${enc(id)}/turns`, {
          method: 'POST',
          body: {
            prompt,
            context: {
              target: target ?? here.target,
              viewing: viewing ?? here.viewing,
              selection: selection ?? here.selection,
            },
          },
        });
      },

      cancel: (turnId) => ask(`/agent/turns/${enc(turnId)}/cancel`, { method: 'POST' }),
      undo: (turnId) => ask(`/agent/turns/${enc(turnId)}/undo`, { method: 'POST' }),
      dequeue: (turnId) => ask(`/agent/turns/${enc(turnId)}`, { method: 'DELETE' }),
      archive: (id, archived = true) => ask(`/agent/conversations/${enc(id)}`, { method: 'PATCH', body: { archived } }),
      markReviewed: (id) => ask(`/agent/conversations/${enc(id)}`, { method: 'PATCH', body: { reviewed: true } }),
      restore: (docPath, sha) => ask(`/restore?app=${enc(docPath)}&sha=${enc(sha)}`, { method: 'POST' }),

      on,
      context,
      select(ids) {
        chosen = Array.isArray(ids) && ids.length ? [...ids] : null;
        notify();
      },

      current: () => storage.get(KEY),
      remember: (id) => storage.set(KEY, id ?? null),
      storage,

      open: (id = null) => dispatchEvent(new CustomEvent('marble:agent-open', { detail: { id } })),
      close: () => dispatchEvent(new CustomEvent('marble:agent-close')),
    };

    marble.agent = agent;
    dispatchEvent(new CustomEvent('marble:agent', { detail: agent }));
  };

  if (window.marble) attach(window.marble);
  else addEventListener('marble:ready', (event) => attach(event.detail), { once: true });
})();
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:browser && npm test`
Expected: PASS — 8 browser tests; `npm test` still 313.

- [ ] **Step 6: Commit**

```bash
git add test-browser/harness.js test-browser/agent-api.test.js runtime/agent.js package.json
git commit -m "Agents drawer: window.marble.agent, tested in a real browser"
```

---
### Task 3: `<marble-conversation>` — the transcript and the composer

**Files:**
- Replace: `runtime/agent-ui.js` (this task writes the whole file except the drawer class; Task 4 adds the drawer and its styles)
- Create: `test-browser/conversation.test.js`

**Interfaces:**
- Consumes: Task 2 `window.marble.agent`.
- Produces (`runtime/agent-ui.js`, loaded as a classic script):
  - `window.marbleAgentUI = { renderText, spring, project, TOKENS }` — `renderText(text) → DocumentFragment` (safe subset: paragraphs with line breaks, `-`/`*` and `1.` lists, fenced code, inline `code`, `**bold**`, `*em*`, `[label](https://…)` links); `spring({from, to, velocity, response, onFrame, onDone}) → cancel()`; `project(velocity, rate = 0.998) → px`; `TOKENS` (the `:host` token CSS).
  - `<marble-conversation>` custom element, open shadow root:
    - attribute `conversation` (id); none → **new** mode: an agent picker (`select.picker-select`, options from `providers()`, unusable ones disabled with their `detail`, preselecting `default`) above the composer; the first send starts a conversation, sets the attribute, and dispatches `conversation` (`detail: {id}`, bubbles, composed).
    - shadow parts, selected by class: `.log` (`role="log"`), `.msg.me`, `.msg.agent` (`.live` while streaming), `.tool` rows with `data-state` in `pending|done|refused|failed`, `.turn-footer` with `data-status` in `running|completed|failed|cancelled|interrupted` and buttons `.undo`, `.restore`, `.system` lines (`.system.error` for failures to reach the host), `.queued` with `.queued-item` rows and `.dequeue` buttons, `form.composer` with `.context` chip (`.context-text`, `.context-clear`), `textarea`, `button.send`, `button.stop` (visible only while a turn of this conversation runs).
    - dispatches `meta` (`detail: {meta}`) after loading, and `running` (`detail: {turn, target} | {turn: null}`), both bubbling and composed.
    - methods: `focusInput()`.
  - Mounting: a no-op in this task (the drawer is Task 4).

- [ ] **Step 1: Write the failing test**

Create `test-browser/conversation.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading to **Backlog**.\n\n- kept the questions\n- changed nothing else' },
  ],
  hostile: [{ say: 'Try <img src=x onerror="window.__pwned=1"> and [bad](javascript:window.__pwned=1) and [good](https://example.com)' }],
  slow: [{ sleep: 1500 }, { say: 'finally' }],
  hold: [{ silent: 20_000 }],
  stale: [
    { call: 'apply_ops', args: { path: 'garden', note: 'unread', ops: [{ type: 'setText', id: 'p', text: 'x' }] } },
    { say: 'It was refused.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS });
test.after(() => host.close());

/** A page with a bare <marble-conversation> in it — the drawer is not needed to test the view. */
async function mount(id = null) {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate((conversation) => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    if (conversation) el.setAttribute('conversation', conversation);
    el.style.cssText = 'position:fixed;right:0;top:0;width:420px;height:100vh;';
    document.body.append(el);
  }, id);
  // `body >` so the drawer's own conversation (inside its shadow root, Task 4) is never matched.
  return { page, errors, view: page.locator('body > marble-conversation') };
}

const sendFrom = async (view, text) => {
  await view.locator('textarea').fill(text);
  await view.locator('textarea').press('Enter');
};

test('a new conversation picks an agent, sends on Enter, and becomes that conversation', async () => {
  const { page, view, errors } = await mount();
  await view.locator('select.picker-select').waitFor();
  assert.equal(await view.locator('select.picker-select').inputValue(), 'fake');

  const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
  await sendFrom(view, 'script:rename');
  const id = await started;
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(await view.getAttribute('conversation'), id);

  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.msg.me').first().textContent(), 'script:rename');
  assert.equal(await view.locator('select.picker-select').count() === 0 || !(await view.locator('select.picker-select').isVisible()), true);
  assert.deepEqual(errors, []);
});

test('the transcript shows the agent’s words, its tool calls, and what changed', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:rename');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();

  const agent = view.locator('.msg.agent').last();
  assert.equal(await agent.locator('strong').textContent(), 'Backlog');
  assert.equal(await agent.locator('li').count(), 2);
  assert.equal(await view.locator('.msg.agent.live').count(), 0, 'the streamed text was replaced by the final text');

  const tools = view.locator('.tool');
  assert.match(await tools.nth(0).textContent(), /Read garden/);
  assert.match(await tools.nth(1).textContent(), /Edited 1 element in garden/);
  assert.equal(await tools.nth(1).getAttribute('data-state'), 'done');
  assert.match(await view.locator('.turn-footer').last().textContent(), /Changed 1 element/);
});

test('undo reverts the turn and says so', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:rename');
  await view.locator('.turn-footer[data-status="completed"] button.undo').click();
  await page.waitForFunction(async () => (await (await fetch('/a/garden')).text()).includes('>Research Garden<'));
  await view.locator('.turn-footer .undone').waitFor();
  assert.match(await view.locator('.turn-footer .undone').textContent(), /Undid 1/);
  assert.equal(await view.locator('.turn-footer button.undo').count(), 0);
});

test('agent text is never HTML, and only http(s) links become links', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:hostile');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const agent = view.locator('.msg.agent').last();
  assert.equal(await agent.locator('img').count(), 0);
  assert.match(await agent.textContent(), /<img src=x onerror=/);
  const links = agent.locator('a');
  assert.equal(await links.count(), 1);
  assert.equal(await links.first().getAttribute('href'), 'https://example.com');
  assert.equal(await links.first().getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
});

test('stop is there while a turn runs, and stops it', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await view.locator('button.stop').click();
  await view.locator('.turn-footer[data-status="cancelled"]').waitFor();
  assert.equal(await view.locator('button.stop').isVisible(), false);
});

test('a second message while one runs is queued, and can be removed', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:slow');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await sendFrom(view, 'script:rename');
  await view.locator('.queued-item').waitFor();
  await view.locator('.queued-item button.dequeue').click();
  await view.locator('.queued-item').waitFor({ state: 'detached' });
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.turn-footer').count(), 1, 'only the first turn ran');
});

test('a refused edit is shown as refused, not as an error', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:stale');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.tool').first().getAttribute('data-state'), 'refused');
  assert.match(await view.locator('.tool').first().textContent(), /Refused/);
});

test('an existing conversation opens with its whole history', async () => {
  const id = await (async () => {
    const { page } = await mount();
    const view = page.locator('body > marble-conversation');
    const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
    await sendFrom(view, 'script:rename');
    const conversation = await started;
    await view.locator('.turn-footer[data-status="completed"]').waitFor();
    return conversation;
  })();
  const { view } = await mount(id);
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.msg.me').count(), 1);
  assert.equal(await view.locator('.msg.agent').count(), 1);
});

test('the context chip shows the target and the selection, and can drop the selection', async () => {
  const { page, view } = await mount();
  assert.equal((await view.locator('.context-text').textContent()).trim(), 'garden');
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-marble-id="h"]'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await view.locator('.context-text', { hasText: '1 selected' }).waitFor();
  await view.locator('.context-clear').click();
  assert.equal((await view.locator('.context-text').textContent()).trim(), 'garden');
});

test('shift+enter makes a new line instead of sending', async () => {
  const { view } = await mount();
  await view.locator('textarea').fill('one');
  await view.locator('textarea').press('Shift+Enter');
  await view.locator('textarea').pressSequentially('two');
  assert.equal(await view.locator('textarea').inputValue(), 'one\ntwo');
  assert.equal(await view.locator('.msg.me').count(), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test-browser/conversation.test.js`
Expected: FAIL — `waitForFunction` times out: `customElements.get('marble-conversation')` is undefined.

- [ ] **Step 3: Implement `runtime/agent-ui.js` (conversation part)**

Replace `runtime/agent-ui.js` with:

```js
// The agent drawer and the conversation view it shows.
//
// Both are custom elements with open shadow roots: no document's stylesheet
// reaches in, and nothing in here reaches out, which is what lets the same
// drawer sit on top of a slide deck, a spreadsheet and the Drive itself. Both
// are transient — nothing they draw is ever the document — and the file on
// disk only changes when an agent edits it.
//
// Agent text is shown, never interpreted: renderText builds nodes from a small
// safe subset of Markdown with textContent, and only http(s) links become links.

(() => {
  if (customElements.get('marble-conversation')) return;

  // ------------------------------------------------------------------ tokens

  // The Drive's own tokens ("UIST warm" in the light, "Dusk" after dark), so a
  // drawer over any document looks like it belongs to the Drive, not to it.
  const TOKENS = `
    :host {
      --ink: #111111; --muted: #5a5a5a; --faint: #8a8a8a; --line: #ddd9cf;
      --paper: #fafaf7; --paper-2: #f3f1ea; --card: #ffffff;
      --accent: #9bb6cf; --accent-soft: #f1f5f8; --accent-ink: #738698;
      --danger: #b4533e; --caution: #a07a2c;
      --shadow-lift: 0 4px 10px rgba(74,66,52,.10), 0 14px 28px rgba(74,66,52,.12);
      --settle: cubic-bezier(.22, 1, .36, 1); --snap: cubic-bezier(.4, 0, .2, 1);
      --radius: 12px;
      font: 14px/1.5 "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --ink: #e8e6e1; --muted: #a3a7ab; --faint: #71767a; --line: #2f3438;
        --paper: #16181a; --paper-2: #1e2124; --card: #1c1f22;
        --accent: #7fa8c9; --accent-soft: #1d2932; --accent-ink: #9dc0dc;
        --danger: #e08a74; --caution: #d9b25e;
        --shadow-lift: 0 6px 16px rgba(0,0,0,.45), 0 18px 36px rgba(0,0,0,.35);
      }
    }
  `;

  // ------------------------------------------------------------ safe text

  const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))/g;

  function inline(parent, text) {
    let last = 0;
    INLINE.lastIndex = 0;
    for (let match = INLINE.exec(text); match; match = INLINE.exec(text)) {
      if (match.index > last) parent.append(text.slice(last, match.index));
      const [whole] = match;
      let node;
      if (match[1]) {
        node = document.createElement('code');
        node.textContent = whole.slice(1, -1);
      } else if (match[2]) {
        node = document.createElement('strong');
        node.textContent = whole.slice(2, -2);
      } else if (match[3]) {
        node = document.createElement('em');
        node.textContent = whole.slice(1, -1);
      } else {
        node = document.createElement('a');
        node.textContent = /^\[([^\]]+)\]/.exec(whole)[1];
        node.href = match[5];
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
      }
      parent.append(node);
      last = match.index + whole.length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  const BULLET = /^\s*[-*]\s+(.*)$/;
  const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
  const FENCE = /^\s*```/;

  function renderText(text) {
    const out = document.createDocumentFragment();
    const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (FENCE.test(line)) {
        const body = [];
        for (i += 1; i < lines.length && !FENCE.test(lines[i]); i += 1) body.push(lines[i]);
        i += 1;
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = body.join('\n');
        pre.append(code);
        out.append(pre);
        continue;
      }
      const kind = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
      if (kind) {
        const list = document.createElement(kind === BULLET ? 'ul' : 'ol');
        for (; i < lines.length && kind.test(lines[i]); i += 1) {
          const item = document.createElement('li');
          inline(item, kind.exec(lines[i])[1]);
          list.append(item);
        }
        out.append(list);
        continue;
      }
      if (!line.trim()) {
        i += 1;
        continue;
      }
      const paragraph = document.createElement('p');
      let first = true;
      for (; i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]); i += 1) {
        if (!first) paragraph.append(document.createElement('br'));
        inline(paragraph, lines[i]);
        first = false;
      }
      out.append(paragraph);
    }
    return out;
  }

  // ------------------------------------------------------------ motion

  /** A critically damped spring on one number. It starts from wherever the
   *  value is now and at whatever velocity it is moving, which is what makes an
   *  animation interruptible: a new target is a new spring from the present. */
  function spring({ from, to, velocity = 0, response = 0.34, onFrame, onDone }) {
    const omega = (2 * Math.PI) / response;
    let x = from;
    let v = velocity;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const dt = Math.min(0.032, Math.max(0.001, (now - last) / 1000));
      last = now;
      v += (-omega * omega * (x - to) - 2 * omega * v) * dt;
      x += v * dt;
      if (Math.abs(x - to) < 0.0005 && Math.abs(v) < 0.01) {
        onFrame(to, 0);
        onDone?.();
        return;
      }
      onFrame(x, v);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }

  /** Where a released gesture would come to rest (Apple's projection). */
  const project = (velocity, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);

  // ------------------------------------------------------------ helpers

  const h = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const seconds = (ms) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
  const firstSentence = (text) => String(text ?? '').split(/(?<=[.!?—])\s/)[0].replace(/\s*—\s*$/, '');

  function toolLabel(name, input = {}) {
    const where = input.path ? ` ${input.path}` : '';
    switch (name) {
      case 'read_document':
        return `Read${where}${Array.isArray(input.ids) && input.ids.length ? ` · ${plural(input.ids.length, 'element')}` : ''}`;
      case 'apply_ops':
        return `Editing${where}${input.note ? ` — ${input.note}` : ''}`;
      case 'list_documents':
        return 'Listed documents';
      case 'create_document':
        return `Creating${where}`;
      case 'read_guide':
        return input.section ? `Read the guide · ${input.section}` : 'Read the guide';
      default:
        return `Tried ${name}`;
    }
  }

  // ------------------------------------------------------------ the view

  const CONVERSATION_CSS = `
    :host { display: flex; flex-direction: column; min-height: 0; background: transparent; }
    .log { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px 8px; display: flex; flex-direction: column; gap: 10px; overscroll-behavior: contain; }
    .msg { max-width: 88%; overflow-wrap: anywhere; }
    .msg.me { align-self: flex-end; background: var(--ink); color: var(--paper); padding: 8px 12px; border-radius: 16px 16px 4px 16px; white-space: pre-wrap; }
    .msg.agent { align-self: flex-start; color: var(--ink); }
    .msg.agent.live { color: var(--muted); white-space: pre-wrap; }
    .msg.agent p { margin: 0 0 .5em; } .msg.agent p:last-child { margin-bottom: 0; }
    .msg.agent ul, .msg.agent ol { margin: .25em 0 .5em; padding-left: 1.25em; }
    .msg.agent code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--paper-2); padding: 1px 4px; border-radius: 4px; }
    .msg.agent pre { background: var(--paper-2); padding: 10px 12px; border-radius: 8px; overflow-x: auto; }
    .msg.agent pre code { background: none; padding: 0; }
    .msg.agent a { color: var(--accent-ink); }
    .tool { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; color: var(--muted); padding-left: 2px; }
    .tool::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--faint); transform: translateY(-1px); }
    .tool[data-state="pending"]::before { background: var(--accent); animation: pulse 1.2s var(--snap) infinite; }
    .tool[data-state="done"]::before { background: var(--accent-ink); }
    .tool[data-state="refused"] { color: var(--caution); } .tool[data-state="refused"]::before { background: var(--caution); }
    .tool[data-state="failed"] { color: var(--danger); } .tool[data-state="failed"]::before { background: var(--danger); }
    .turn-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 12px; color: var(--faint); padding: 2px 0 6px; border-bottom: 1px solid var(--line); }
    .turn-footer[data-status="running"] { border-bottom-color: transparent; }
    .turn-footer[data-status="failed"] .status { color: var(--danger); }
    .turn-footer .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s var(--snap) infinite; }
    .turn-footer button { font: inherit; color: var(--accent-ink); background: none; border: 0; padding: 2px 6px; margin: -2px -6px; border-radius: 6px; cursor: pointer; }
    .turn-footer button:hover { background: var(--accent-soft); }
    .turn-footer button:active { transform: scale(.96); }
    .turn-footer button:disabled { color: var(--faint); cursor: default; }
    .turn-footer .watch { color: var(--caution); }
    .system { align-self: center; font-size: 12px; color: var(--faint); text-align: center; max-width: 90%; }
    .system.error { color: var(--danger); }
    .queued { display: flex; flex-direction: column; gap: 4px; padding: 0 18px 6px; }
    .queued[hidden] { display: none; }
    .queued-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); background: var(--paper-2); border-radius: 8px; padding: 4px 4px 4px 10px; }
    .queued-item span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queued-item button { font: inherit; border: 0; background: none; color: var(--muted); width: 22px; height: 22px; border-radius: 6px; cursor: pointer; }
    .queued-item button:hover { background: var(--line); }
    .composer { flex: none; padding: 8px 12px calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
    .picker { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
    .picker[hidden] { display: none; }
    .picker-select { font: inherit; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px; }
    .context { display: flex; align-items: center; gap: 4px; align-self: flex-start; max-width: 100%; font-size: 11.5px; color: var(--muted); background: var(--paper-2); border-radius: 999px; padding: 2px 4px 2px 10px; }
    .context-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .context-clear { font: inherit; border: 0; background: none; color: var(--faint); width: 18px; height: 18px; border-radius: 50%; cursor: pointer; line-height: 1; }
    .context-clear[hidden] { display: none; }
    .context-clear:hover { background: var(--line); color: var(--ink); }
    .row { display: flex; align-items: flex-end; gap: 8px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 6px 6px 6px 12px; transition: border-color 200ms var(--settle), box-shadow 200ms var(--settle); }
    .row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    textarea { flex: 1; font: inherit; color: var(--ink); background: none; border: 0; outline: none; resize: none; max-height: 160px; padding: 4px 0; }
    textarea::placeholder { color: var(--faint); }
    .send, .stop { flex: none; width: 32px; height: 32px; border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center; transition: transform 110ms var(--snap), opacity 200ms var(--settle); }
    .send { background: var(--ink); color: var(--paper); }
    .send:disabled { opacity: .35; cursor: default; }
    .stop { background: var(--paper-2); color: var(--ink); }
    .stop[hidden] { display: none; }
    .send:active, .stop:active { transform: scale(.92); }
    @keyframes pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .tool::before, .turn-footer .pulse { animation: none; } }
  `;

  const SEND_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const STOP_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="currentColor"/></svg>';

  class MarbleConversation extends HTMLElement {
    static get observedAttributes() {
      return ['conversation'];
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${TOKENS}${CONVERSATION_CSS}</style>
        <div class="log" role="log" aria-live="polite" aria-label="Conversation"></div>
        <div class="queued" hidden></div>
        <form class="composer">
          <label class="picker" hidden>Agent <select class="picker-select"></select></label>
          <div class="context"><span class="context-text"></span><button type="button" class="context-clear" aria-label="Don’t send the selection">×</button></div>
          <div class="row">
            <textarea rows="1" placeholder="Ask about this document…" aria-label="Message"></textarea>
            <button type="button" class="stop" hidden aria-label="Stop">${STOP_ICON}</button>
            <button type="submit" class="send" aria-label="Send" disabled>${SEND_ICON}</button>
          </div>
        </form>`;
      this.logEl = root.querySelector('.log');
      this.queuedEl = root.querySelector('.queued');
      this.form = root.querySelector('form');
      this.picker = root.querySelector('.picker');
      this.pickerSelect = root.querySelector('.picker-select');
      this.contextText = root.querySelector('.context-text');
      this.contextClear = root.querySelector('.context-clear');
      this.input = root.querySelector('textarea');
      this.sendButton = root.querySelector('.send');
      this.stopButton = root.querySelector('.stop');

      this.seen = 0;
      this.turns = new Map();
      this.prompts = new Map();
      this.live = null;
      this.running = null;
      this.off = null;
      this.skipSelection = false;
      this.sending = false;

      this.form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submit();
      });
      this.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          this.submit();
        }
      });
      this.input.addEventListener('input', () => this.autosize());
      this.stopButton.addEventListener('click', () => {
        if (this.running) this.api.cancel(this.running.turn).catch((err) => this.system(err.message, true));
      });
      this.contextClear.addEventListener('click', () => {
        this.skipSelection = true;
        this.updateContext();
      });
      this.onContext = () => {
        this.skipSelection = false;
        this.updateContext();
      };
    }

    get api() {
      return window.marble?.agent;
    }

    connectedCallback() {
      addEventListener('marble:agent-context', this.onContext);
      this.updateContext();
      this.load();
    }

    disconnectedCallback() {
      removeEventListener('marble:agent-context', this.onContext);
      this.off?.();
      this.off = null;
    }

    attributeChangedCallback(_name, before, after) {
      if (this.isConnected && before !== after && after !== this.loadedId) this.load();
    }

    focusInput() {
      this.input.focus({ preventScroll: true });
    }

    // ---------------------------------------------------------- loading

    async load() {
      this.off?.();
      this.off = null;
      this.logEl.replaceChildren();
      this.queuedEl.replaceChildren();
      this.queuedEl.hidden = true;
      this.seen = 0;
      this.turns.clear();
      this.prompts.clear();
      this.live = null;
      this.setRunning(null);

      const id = this.getAttribute('conversation');
      this.loadedId = id;
      const token = Symbol('load');
      this.loading = token;

      if (!id) {
        await this.showPicker(token);
        return;
      }
      this.picker.hidden = true;
      try {
        const { meta } = await this.api.conversation(id);
        if (this.loading !== token) return;
        this.meta = meta;
        this.dispatchEvent(new CustomEvent('meta', { detail: { meta }, bubbles: true, composed: true }));
      } catch (err) {
        if (this.loading === token) this.system(`This conversation could not be opened: ${err.message}`, true);
        return;
      }
      this.off = this.api.on(id, (event) => this.receive(event));
      this.updateSendable();
    }

    async showPicker(token) {
      this.picker.hidden = false;
      this.pickerSelect.replaceChildren();
      let providers = [];
      try {
        providers = await this.api.providers();
      } catch (err) {
        if (this.loading === token) this.system(`Agents could not be listed: ${err.message}`, true);
      }
      if (this.loading !== token) return;
      const usable = providers.filter((p) => p.installed && p.signedIn);
      for (const provider of providers) {
        const ready = provider.installed && provider.signedIn;
        const option = h('option', '', ready ? provider.label : `${provider.label} — ${provider.detail}`);
        option.value = provider.id;
        option.disabled = !ready;
        this.pickerSelect.append(option);
      }
      const preferred = usable.find((p) => p.default) ?? usable[0];
      if (preferred) this.pickerSelect.value = preferred.id;
      else this.system('No agent is ready on this machine. `npm run agents -- providers` says why.');
      this.updateSendable();
    }

    // ---------------------------------------------------------- sending

    updateSendable() {
      const noAgent = !this.getAttribute('conversation') && !this.pickerSelect.value;
      this.sendButton.disabled = this.sending || noAgent || !this.input.value.trim();
    }

    autosize() {
      this.input.style.height = 'auto';
      this.input.style.height = `${Math.min(160, this.input.scrollHeight)}px`;
      this.updateSendable();
    }

    updateContext() {
      const { target, selection } = this.api?.context() ?? { target: '', selection: [] };
      const count = this.skipSelection ? 0 : selection.length;
      this.contextText.textContent = count ? `${target} · ${count} selected` : target;
      this.contextClear.hidden = !count;
    }

    async submit() {
      const prompt = this.input.value.trim();
      if (!prompt || this.sending) return;
      this.sending = true;
      this.updateSendable();
      try {
        const context = this.api.context();
        if (this.skipSelection) context.selection = [];
        let id = this.getAttribute('conversation');
        if (!id) {
          const provider = this.pickerSelect.value;
          if (!provider) throw new Error('Choose an agent first.');
          id = await this.api.start({ provider });
          this.setAttribute('conversation', id);
          this.dispatchEvent(new CustomEvent('conversation', { detail: { id }, bubbles: true, composed: true }));
        }
        await this.api.send(id, { prompt, ...context });
        this.input.value = '';
        this.skipSelection = false;
        this.updateContext();
      } catch (err) {
        this.system(err.message, true);
      } finally {
        this.sending = false;
        this.autosize();
      }
    }

    // ---------------------------------------------------------- receiving

    receive(event) {
      if (event.seq) {
        if (event.seq <= this.seen) return;
        this.seen = event.seq;
      }
      const stuck = this.logEl.scrollHeight - this.logEl.scrollTop - this.logEl.clientHeight < 48;
      const turn = event.turn;
      switch (event.type) {
        case 'user':
          this.endLive();
          this.prompts.set(turn, event.text);
          this.record(turn).target = event.context?.target ?? null;
          this.append(turn, h('div', 'msg me', event.text));
          break;
        case 'turn.queued':
          this.queue(turn, true);
          break;
        case 'turn.removed':
          this.queue(turn, false);
          this.forget(turn);
          break;
        case 'turn.started':
          this.queue(turn, false);
          this.record(turn).started = event.t;
          this.footer(turn, 'running');
          this.setRunning(turn);
          break;
        case 'text.delta':
          this.delta(turn, event.text);
          break;
        case 'text':
          this.text(turn, event.text);
          break;
        case 'tool.call':
          this.endLive();
          this.toolCall(turn, event);
          break;
        case 'tool.result':
          this.toolResult(turn, event);
          break;
        case 'ops.applied':
          this.opsApplied(turn, event);
          break;
        case 'ops.refused':
          this.opsRefused(turn, event);
          break;
        case 'watchdog':
          this.record(turn).watchdog = event;
          break;
        case 'turn.completed':
        case 'turn.failed':
        case 'turn.cancelled':
        case 'turn.interrupted':
          this.endLive();
          this.finish(turn, event);
          break;
        case 'turn.undone':
          this.undone(turn, event);
          break;
        case 'handoff':
          this.system(event.from ? 'Continued from an earlier conversation.' : 'Continued in a new conversation.');
          break;
        default:
      }
      if (stuck) this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    record(turn) {
      if (!this.turns.has(turn)) this.turns.set(turn, { tools: new Map(), applies: [], applied: 0, footer: null });
      return this.turns.get(turn);
    }

    forget(turn) {
      this.turns.delete(turn);
    }

    /** Entries of a turn go above its footer, so the footer stays last. */
    append(turn, node) {
      const footer = turn ? this.turns.get(turn)?.footer : null;
      if (footer?.isConnected) this.logEl.insertBefore(node, footer);
      else this.logEl.append(node);
    }

    system(message, error = false) {
      this.logEl.append(h('div', error ? 'system error' : 'system', message));
      this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    delta(turn, text) {
      if (!this.live || this.live.turn !== turn) {
        this.endLive();
        const node = h('div', 'msg agent live');
        this.live = { turn, node };
        this.append(turn, node);
      }
      this.live.node.append(text);
    }

    text(turn, text) {
      if (this.live && this.live.turn === turn) {
        this.live.node.classList.remove('live');
        this.live.node.replaceChildren(renderText(text));
        this.live = null;
        return;
      }
      const node = h('div', 'msg agent');
      node.append(renderText(text));
      this.append(turn, node);
    }

    endLive() {
      if (!this.live) return;
      this.live.node.classList.remove('live');
      this.live = null;
    }

    toolCall(turn, event) {
      const row = h('div', 'tool', toolLabel(event.name, event.input));
      row.dataset.state = 'pending';
      row.dataset.name = event.name;
      const record = this.record(turn);
      record.tools.set(event.callId, row);
      if (event.name === 'apply_ops') record.applies.push({ row, path: event.input?.path });
      this.append(turn, row);
    }

    toolResult(turn, event) {
      const row = this.record(turn).tools.get(event.callId);
      if (!row || row.dataset.state === 'refused') return;
      if (row.dataset.state === 'pending' && event.ok && row.dataset.name !== 'apply_ops') {
        row.dataset.state = 'done';
        return;
      }
      if (!event.ok) {
        row.dataset.state = 'failed';
        row.title = event.summary ?? '';
        if (!['list_documents', 'read_document', 'apply_ops', 'create_document', 'read_guide'].includes(row.dataset.name)) {
          row.textContent = `Blocked: ${row.dataset.name}`;
        }
      } else if (row.dataset.state === 'pending') {
        row.dataset.state = 'done';
      }
    }

    pendingApply(turn, path) {
      return this.record(turn).applies.find((a) => a.row.dataset.state === 'pending' && (!a.path || !path || a.path === path));
    }

    opsApplied(turn, event) {
      const record = this.record(turn);
      record.applied += event.count;
      const apply = this.pendingApply(turn, event.path);
      if (!apply) return;
      apply.row.dataset.state = 'done';
      apply.row.textContent = `Edited ${plural(event.count, 'element')} in ${event.path}`;
    }

    opsRefused(turn, event) {
      const apply = this.pendingApply(turn, event.path);
      if (!apply) return;
      apply.row.dataset.state = 'refused';
      apply.row.textContent = `Refused — ${firstSentence(event.reason)}`;
      apply.row.title = event.reason ?? '';
    }

    queue(turn, present) {
      const existing = this.queuedEl.querySelector(`[data-turn="${CSS.escape(turn)}"]`);
      if (!present) {
        existing?.remove();
      } else if (!existing) {
        const item = h('div', 'queued-item');
        item.dataset.turn = turn;
        item.append(h('span', '', `Queued: ${this.prompts.get(turn) ?? ''}`));
        const remove = h('button', 'dequeue', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove from the queue');
        remove.addEventListener('click', () => this.api.dequeue(turn).catch((err) => this.system(err.message, true)));
        item.append(remove);
        this.queuedEl.append(item);
      }
      this.queuedEl.hidden = !this.queuedEl.children.length;
      // A queued turn's message stays in the log; only the queue row goes.
    }

    footer(turn, status) {
      const record = this.record(turn);
      if (!record.footer) {
        record.footer = h('div', 'turn-footer');
        this.logEl.append(record.footer);
      }
      record.footer.dataset.status = status;
      record.footer.replaceChildren();
      if (status === 'running') {
        record.footer.append(h('span', 'pulse'), h('span', 'status', 'Working…'));
      }
      return record.footer;
    }

    finish(turn, event) {
      const record = this.record(turn);
      const status = event.type.slice('turn.'.length);
      const footer = this.footer(turn, status);
      const applied = event.applied ?? record.applied;
      const took = record.started ? ` · ${seconds(event.t - record.started)}` : '';
      const words = {
        completed: applied ? `Changed ${plural(applied, 'element')}` : 'Done',
        failed: event.error ? `Failed — ${event.error}` : 'Failed',
        cancelled: applied ? `Stopped · changed ${plural(applied, 'element')}` : 'Stopped',
        interrupted: 'Interrupted when the host stopped',
      }[status];
      footer.append(h('span', 'status', `${words}${took}`));

      if (applied && !record.undone) {
        const undo = h('button', 'undo', 'Undo turn');
        undo.type = 'button';
        undo.addEventListener('click', async () => {
          undo.disabled = true;
          try {
            await this.api.undo(turn);
          } catch (err) {
            undo.disabled = false;
            footer.append(h('span', 'status', err.message));
          }
        });
        footer.append(undo);
      }
      if (record.watchdog) {
        const { path, sha } = record.watchdog;
        footer.append(h('span', 'watch', `${path} changed outside Marble`));
        const restore = h('button', 'restore', 'Restore');
        restore.type = 'button';
        restore.addEventListener('click', async () => {
          restore.disabled = true;
          try {
            await this.api.restore(path, sha);
            restore.textContent = 'Restored';
          } catch (err) {
            restore.disabled = false;
            footer.append(h('span', 'status', err.message));
          }
        });
        footer.append(restore);
      }
      if (this.running?.turn === turn) this.setRunning(null);
    }

    undone(turn, event) {
      const record = this.record(turn);
      record.undone = true;
      const footer = record.footer ?? this.footer(turn, 'completed');
      footer.querySelector('button.undo')?.remove();
      footer.append(h('span', 'undone', `Undid ${event.reverted}${event.kept ? ` · kept ${event.kept} you edited` : ''}`));
    }

    setRunning(turn) {
      this.running = turn ? { turn, target: this.turns.get(turn)?.target ?? null } : null;
      this.stopButton.hidden = !turn;
      this.dispatchEvent(new CustomEvent('running', { detail: this.running ?? { turn: null }, bubbles: true, composed: true }));
    }
  }

  customElements.define('marble-conversation', MarbleConversation);

  window.marbleAgentUI = { renderText, spring, project, TOKENS };
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --test-reporter=spec test-browser/conversation.test.js && npm run test:browser && npm test`
Expected: PASS — 10 conversation tests; browser total 18; `npm test` 313.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/conversation.test.js
git commit -m "Agents drawer: the conversation view — transcript, tools, undo, stop, queue"
```

---
### Task 4: `<marble-agent-drawer>` — launcher, panel, motion, menus

**Files:**
- Modify: `runtime/agent-ui.js` (add the drawer before the final `window.marbleAgentUI = …` line; add mounting)
- Create: `test-browser/drawer.test.js`

**Interfaces:**
- Consumes: Task 2 `window.marble.agent` (incl. `current`, `remember`, `storage`, `open`/`close` events, `markReviewed`, `handoff`, `archive`, `conversations`, `providers`, `on('*')`); Task 3 `<marble-conversation>` (attribute `conversation`, events `conversation`/`meta`/`running`, `focusInput()`), `spring`, `project`, `TOKENS`; the carrier's `marble.app`, `marble.docs()`, `marble.href(name)`.
- Produces `<marble-agent-drawer>` (open shadow root), mounted once per page as `document.body`'s last child with `data-marble-transient`, unless the page has `<meta name="marble-agent" content="custom">`:
  - `button.launcher` (`aria-expanded`), with `.launcher-dot` (visible when any conversation needs review) and class `running` when any conversation runs.
  - `aside.panel` (`role="dialog"`, `aria-label="Agent"`), `data-open="true|false"`, `data-pinned="true|false"`, `inert` while closed; contains `header.bar` (`button.title` with `.title-text`, `.provider`, `button.new`, `button.more`, `button.pin` `aria-pressed`, `button.close`), `.where` (shown when the running turn's target differs from this page), `.menu.recent` and `.menu.actions` (`role="menu"`, items `button[role="menuitem"]`), and one `<marble-conversation>`.
  - Behaviour: ⌘J/Ctrl+J toggles; Escape closes when focus is inside; open → focuses the composer and marks the open conversation reviewed; the open conversation id, open state and pinned state persist in `localStorage` and are restored on the next page; pinning (≥720px) adds `<style id="marble-agent-dock" data-marble-transient>html{margin-inline-end:420px!important}</style>` to `<head>` while open, removes it when closed or unpinned; the header can be dragged to dismiss (right on desktop, down below 720px) with projected release velocity; `marble:agent-open` with an id opens that conversation.
  - `.menu.actions` items: `Continue in <label>` for each other usable provider (starts a handoff and switches to it), `Archive conversation`, and `Open Agents` only when the drive has a document named `Agents`.

- [ ] **Step 1: Write the failing test**

Create `test-browser/drawer.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
  hold: [{ silent: 20_000 }],
};

const host = await startDrive({
  scripts: SCRIPTS,
  documents: { garden: GARDEN, reading: GARDEN.replace('Research Garden', 'Reading List').replace('<title>Garden', '<title>Reading') },
});
test.after(() => host.close());

async function visit(path = 'garden', options = {}) {
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/${path}`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));
  const drawer = page.locator('marble-agent-drawer');
  return { page, errors, drawer, panel: drawer.locator('aside.panel'), view: drawer.locator('marble-conversation') };
}

const opened = (panel) => panel.locator('xpath=self::*[@data-open="true"]').waitFor();

test('the drawer is on the page and not in the document', async () => {
  await host.reset();
  const { page, drawer, panel, errors } = await visit();
  assert.equal(await drawer.getAttribute('data-marble-transient'), '');
  assert.equal(await panel.getAttribute('data-open'), 'false');
  const served = await (await fetch(`${host.base}/a/garden`)).text();
  assert.ok(!served.includes('<marble-agent-drawer'), 'never written into the document');
  await drawer.locator('.launcher').click();
  await opened(panel);
  assert.equal(await page.locator('marble-agent-drawer').count(), 1);
  assert.equal(await host.drive.store.read('garden'), GARDEN, 'the file is untouched by opening the drawer');
  assert.deepEqual(errors, []);
});

test('⌘J and Ctrl+J toggle it, Escape closes it, and opening focuses the composer', async () => {
  const { page, panel, view } = await visit();
  await page.keyboard.press('Meta+j');
  await opened(panel);
  await page.waitForFunction(() => {
    const view = document.querySelector('marble-agent-drawer').shadowRoot.querySelector('marble-conversation');
    return view.shadowRoot.activeElement?.tagName === 'TEXTAREA';
  });
  await view.locator('textarea').press('Escape');
  await panel.locator('xpath=self::*[@data-open="false"]').waitFor();
  await page.keyboard.press('Control+j');
  await opened(panel);
  await page.keyboard.press('Control+j');
  await panel.locator('xpath=self::*[@data-open="false"]').waitFor();
});

test('a conversation from the drawer edits the page, and follows you to the next page', async () => {
  await host.reset();
  const { page, drawer, panel, view } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await view.locator('textarea').fill('script:rename');
  await view.locator('textarea').press('Enter');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  await page.locator('h1', { hasText: 'Backlog' }).waitFor();
  await drawer.locator('.title-text', { hasText: 'script:rename' }).waitFor();

  await page.goto(`${host.base}/a/reading`);
  const again = page.locator('marble-agent-drawer');
  await again.locator('aside.panel[data-open="true"]').waitFor();
  await again.locator('marble-conversation .turn-footer[data-status="completed"]').waitFor();
  assert.equal(await again.locator('marble-conversation .msg.me').count(), 1);
});

test('the header names the file being edited when you are looking at another page', async () => {
  await host.reset();
  const { page, drawer, panel, view } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await drawer.locator('button.new').click();
  await view.locator('textarea').fill('script:hold');
  await view.locator('textarea').press('Enter');
  await view.locator('button.stop').waitFor({ state: 'visible' });

  await page.goto(`${host.base}/a/reading`);
  const again = page.locator('marble-agent-drawer');
  await again.locator('.where').waitFor({ state: 'visible' });
  assert.match(await again.locator('.where').textContent(), /Viewing reading · editing garden/);
  await again.locator('marble-conversation button.stop').click();
  await again.locator('marble-conversation .turn-footer[data-status="cancelled"]').waitFor();
  await again.locator('.where').waitFor({ state: 'hidden' });
});

test('overlay leaves the page’s layout alone; pinning docks it, and it stays transient', async () => {
  await host.reset();
  const { page, drawer, panel } = await visit();
  const widthBefore = await page.evaluate(() => document.documentElement.clientWidth);
  await drawer.locator('.launcher').click();
  await opened(panel);
  assert.equal(await page.evaluate(() => document.documentElement.clientWidth), widthBefore, 'overlay does not reflow');

  await drawer.locator('button.pin').click();
  await panel.locator('xpath=self::*[@data-pinned="true"]').waitFor();
  const dock = page.locator('head > style#marble-agent-dock');
  assert.equal(await dock.getAttribute('data-marble-transient'), '');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).marginRight), '420px');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('style')), null);

  await page.reload();
  await page.locator('marble-agent-drawer aside.panel[data-pinned="true"][data-open="true"]').waitFor();
  await page.locator('marble-agent-drawer button.close').click();
  await page.locator('head > style#marble-agent-dock').waitFor({ state: 'detached' });
  assert.equal(await host.drive.store.read('garden'), GARDEN);
});

test('on a phone the drawer is a full-screen sheet, and pinning is not offered', async () => {
  const { page, drawer, panel } = await visit('garden', { viewport: { width: 390, height: 844 } });
  await drawer.locator('.launcher').click();
  await opened(panel);
  const box = await panel.boundingBox();
  assert.ok(Math.abs(box.width - 390) < 2 && Math.abs(box.height - 844) < 2, JSON.stringify(box));
  assert.equal(await drawer.locator('button.pin').isVisible(), false);
});

test('dragging the header away past halfway dismisses it; a small drag springs back', async () => {
  const { page, drawer, panel } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await page.waitForTimeout(500);
  const spacer = await drawer.locator('header.bar .spacer').boundingBox();
  const startX = spacer.x + spacer.width / 2;
  const y = spacer.y + spacer.height / 2;

  // Slowly: a small drag with little velocity projects short of halfway.
  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let dx = 10; dx <= 40; dx += 10) {
    await page.mouse.move(startX + dx, y);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(600);
  assert.equal(await panel.getAttribute('data-open'), 'true', 'a small, slow drag springs back');

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + 300, y, { steps: 6 });
  await page.mouse.up();
  await panel.locator('xpath=self::*[@data-open="false"]').waitFor();
});

test('reduced motion opens without sliding', async () => {
  const { page, drawer, panel } = await visit('garden', { reducedMotion: 'reduce' });
  await drawer.locator('.launcher').click();
  await opened(panel);
  const transform = await panel.evaluate((el) => getComputedStyle(el).transform);
  assert.ok(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)', transform);
});

test('the launcher shows a dot for work nobody has looked at, until you open it', async () => {
  await host.reset();
  const { page, drawer, panel, view } = await visit();
  await page.evaluate(async () => {
    for (const summary of await window.marble.agent.conversations()) await window.marble.agent.markReviewed(summary.id);
  });
  await drawer.locator('.launcher').click();
  await drawer.locator('button.new').click();
  await view.locator('textarea').fill('script:rename');
  await view.locator('textarea').press('Enter');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  await drawer.locator('button.close').click();

  // Another tab, which never saw that turn, is told it needs review.
  const other = await visit('reading');
  await other.drawer.locator('.launcher-dot').waitFor({ state: 'visible' });
  await other.drawer.locator('.launcher').click();
  await other.panel.locator('xpath=self::*[@data-open="true"]').waitFor();
  await other.drawer.locator('button.title').click();
  await other.drawer.locator('.menu.recent [role="menuitem"]', { hasText: 'script:rename' }).first().click();
  await other.drawer.locator('.launcher-dot').waitFor({ state: 'hidden' });
  void panel;
});

test('the recent menu switches conversations; new starts one; continue-in hands off', async () => {
  const { drawer, panel, view } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await drawer.locator('button.new').click();
  assert.equal(await view.getAttribute('conversation'), null);
  await drawer.locator('button.title').click();
  const items = drawer.locator('.menu.recent [role="menuitem"]');
  await items.first().waitFor();
  assert.ok((await items.count()) >= 1);
  await items.first().click();
  assert.match(await view.getAttribute('conversation'), /^[0-9a-f]{12}$/);

  await drawer.locator('button.more').click();
  await drawer.locator('.menu.actions').waitFor({ state: 'visible' });
  assert.equal(await drawer.locator('.menu.actions [role="menuitem"]', { hasText: 'Open Agents' }).count(), 0, 'no Agents document in this drive');
  assert.equal(await drawer.locator('.menu.actions [role="menuitem"]', { hasText: 'Archive' }).count(), 1);
});

test('a document that draws its own agent interface gets no drawer', async () => {
  await host.drive.createDocument('custom', GARDEN.replace('<title>', '<meta name="marble-agent" content="custom"><title>'));
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/custom`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForTimeout(300);
  assert.equal(await page.locator('marble-agent-drawer').count(), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test-browser/drawer.test.js`
Expected: FAIL — `waitForFunction` times out: no `marble-agent-drawer` on the page.

- [ ] **Step 3: Implement the drawer**

In `runtime/agent-ui.js`, replace the final two statements

```js
  customElements.define('marble-conversation', MarbleConversation);

  window.marbleAgentUI = { renderText, spring, project, TOKENS };
})();
```

with:

```js
  customElements.define('marble-conversation', MarbleConversation);

  // ------------------------------------------------------------ the drawer

  const WIDTH = 420;
  const PHONE = '(max-width: 719px)';
  const OPEN_KEY = 'marble-agent:open';
  const PIN_KEY = 'marble-agent:pinned';
  const TOOLS = new Set(['button', 'select', 'textarea', 'input', 'a']);

  const DRAWER_CSS = `
    :host { position: fixed; inset: auto 0 0 auto; z-index: 2147483000; }
    .launcher { position: fixed; right: calc(20px + env(safe-area-inset-right, 0px)); bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); color: var(--ink);
      box-shadow: var(--shadow-lift); cursor: pointer; display: grid; place-items: center;
      transition: transform 110ms var(--snap), opacity 200ms var(--settle); }
    .launcher:hover { transform: translateY(-1px); }
    .launcher:active { transform: scale(.92); transition-duration: 60ms; }
    .launcher svg { width: 20px; height: 20px; }
    .launcher-dot { position: absolute; top: 6px; right: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent-ink); box-shadow: 0 0 0 2px var(--card); }
    .launcher-dot[hidden] { display: none; }
    .launcher.running::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--accent); animation: spin 1s linear infinite; }
    :host([data-open-state="open"]) .launcher { opacity: 0; pointer-events: none; }

    .panel { position: fixed; top: 0; right: 0; bottom: 0; width: ${WIDTH}px; max-width: 100vw; display: flex; flex-direction: column;
      background: rgba(250, 250, 247, .86); -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
      border-left: 1px solid var(--line); box-shadow: -18px 0 40px rgba(74,66,52,.12);
      transform: translateX(100%); will-change: transform; visibility: hidden; }
    .panel[data-pinned="true"] { box-shadow: none; background: var(--paper); -webkit-backdrop-filter: none; backdrop-filter: none; }
    @media (prefers-color-scheme: dark) { .panel { background: rgba(22, 24, 26, .86); box-shadow: -18px 0 40px rgba(0,0,0,.45); } .panel[data-pinned="true"] { background: var(--paper); } }
    @media (prefers-reduced-transparency: reduce) { .panel { background: var(--paper); -webkit-backdrop-filter: none; backdrop-filter: none; } }

    .bar { flex: none; display: flex; align-items: center; gap: 4px; padding: calc(10px + env(safe-area-inset-top, 0px)) 10px 8px 14px; touch-action: none; cursor: grab; user-select: none; }
    .bar:active { cursor: grabbing; }
    .grip { display: none; }
    .title { min-width: 0; display: flex; align-items: center; gap: 4px; font: 600 14px/1.3 inherit; font-family: inherit; color: var(--ink); background: none; border: 0; padding: 6px 8px; margin-left: -8px; border-radius: 8px; cursor: pointer; }
    .title:hover { background: var(--paper-2); }
    .title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title svg { flex: none; color: var(--faint); }
    .provider { flex: none; font-size: 11px; color: var(--muted); background: var(--paper-2); border-radius: 999px; padding: 1px 8px; }
    .provider:empty { display: none; }
    .spacer { flex: 1; }
    .icon { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 8px; background: none; color: var(--muted); cursor: pointer; transition: transform 110ms var(--snap), background 200ms var(--settle); }
    .icon:hover { background: var(--paper-2); color: var(--ink); }
    .icon:active { transform: scale(.92); }
    .icon[aria-pressed="true"] { color: var(--accent-ink); background: var(--accent-soft); }
    .where { flex: none; margin: 0 14px 6px; font-size: 12px; color: var(--muted); background: var(--accent-soft); border-radius: 8px; padding: 5px 10px; }
    .where[hidden] { display: none; }

    .menu { position: absolute; top: calc(52px + env(safe-area-inset-top, 0px)); left: 10px; right: 10px; z-index: 2; max-height: 60vh; overflow-y: auto;
      background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-lift); padding: 6px; transform-origin: top left;
      animation: menu-in 160ms var(--settle); }
    .menu.actions { left: auto; width: 240px; transform-origin: top right; }
    .menu[hidden] { display: none; }
    .menu [role="menuitem"] { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; text-align: left; font: inherit; color: var(--ink); background: none; border: 0; border-radius: 8px; padding: 7px 10px; cursor: pointer; }
    .menu [role="menuitem"]:hover, .menu [role="menuitem"]:focus-visible { background: var(--paper-2); outline: none; }
    .menu [role="menuitem"] small { font-size: 11.5px; color: var(--faint); }
    .menu .empty { font-size: 12px; color: var(--faint); padding: 8px 10px; }

    marble-conversation { flex: 1; min-height: 0; }

    @media ${PHONE} {
      .panel { top: 0; left: 0; width: 100vw; border-left: 0; transform: translateY(100%); }
      .grip { display: block; position: absolute; top: calc(6px + env(safe-area-inset-top, 0px)); left: 50%; width: 36px; height: 4px; margin-left: -18px; border-radius: 2px; background: var(--line); }
      .bar { padding-top: calc(18px + env(safe-area-inset-top, 0px)); }
      .pin { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel { transition: opacity 150ms linear; }
      .launcher.running::after, .menu { animation: none; }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes menu-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
  `;

  const ICONS = {
    launcher: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3H6.5A2.5 2.5 0 0 1 4 10.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.5 8h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    chevron: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    more: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor"/></svg>',
    pin: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9.5 3v10" stroke="currentColor" stroke-width="1.5"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };

  class MarbleAgentDrawer extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${TOKENS}${DRAWER_CSS}</style>
        <button type="button" class="launcher" aria-label="Agent (⌘J)" aria-expanded="false">${ICONS.launcher}<span class="launcher-dot" hidden></span></button>
        <aside class="panel" role="dialog" aria-label="Agent" data-open="false" data-pinned="false" inert>
          <span class="grip" aria-hidden="true"></span>
          <header class="bar">
            <button type="button" class="title" aria-haspopup="menu" aria-expanded="false"><span class="title-text">New conversation</span>${ICONS.chevron}</button>
            <span class="provider"></span>
            <span class="spacer"></span>
            <button type="button" class="icon new" aria-label="New conversation">${ICONS.plus}</button>
            <button type="button" class="icon more" aria-label="More" aria-haspopup="menu" aria-expanded="false">${ICONS.more}</button>
            <button type="button" class="icon pin" aria-label="Pin beside the page" aria-pressed="false">${ICONS.pin}</button>
            <button type="button" class="icon close" aria-label="Close">${ICONS.close}</button>
          </header>
          <div class="where" hidden></div>
          <div class="menu recent" role="menu" aria-label="Recent conversations" hidden></div>
          <div class="menu actions" role="menu" aria-label="Conversation actions" hidden></div>
          <marble-conversation></marble-conversation>
        </aside>`;
      this.launcher = root.querySelector('.launcher');
      this.dot = root.querySelector('.launcher-dot');
      this.panel = root.querySelector('.panel');
      this.bar = root.querySelector('.bar');
      this.titleButton = root.querySelector('.title');
      this.titleText = root.querySelector('.title-text');
      this.providerEl = root.querySelector('.provider');
      this.where = root.querySelector('.where');
      this.recent = root.querySelector('.menu.recent');
      this.actions = root.querySelector('.menu.actions');
      this.pinButton = root.querySelector('.pin');
      this.view = root.querySelector('marble-conversation');

      this.progress = 0;
      this.cancelMotion = null;
      this.isOpen = false;
      this.pinned = false;
      this.phone = matchMedia(PHONE);
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
      this.summaries = new Map();
      this.labels = new Map();
    }

    get api() {
      return window.marble?.agent;
    }

    connectedCallback() {
      const api = this.api;
      this.pinned = api.storage.get(PIN_KEY) === '1';
      const current = api.current();
      if (current) this.view.setAttribute('conversation', current);

      this.launcher.addEventListener('click', () => this.open());
      this.root('.close').addEventListener('click', () => this.close());
      this.root('.new').addEventListener('click', () => this.startNew());
      this.pinButton.addEventListener('click', () => this.setPinned(!this.pinned));
      this.titleButton.addEventListener('click', () => this.toggleMenu(this.recent, this.titleButton, () => this.fillRecent()));
      this.root('.more').addEventListener('click', (event) => this.toggleMenu(this.actions, event.currentTarget, () => this.fillActions()));

      this.view.addEventListener('conversation', (event) => {
        api.remember(event.detail.id);
      });
      this.view.addEventListener('meta', (event) => this.showMeta(event.detail.meta));
      this.view.addEventListener('running', (event) => this.showWhere(event.detail));

      this.onKey = (event) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j') {
          event.preventDefault();
          if (this.isOpen) this.close();
          else this.open();
        } else if (event.key === 'Escape' && this.isOpen && this.shadowRoot.activeElement !== null) {
          if (!this.recent.hidden || !this.actions.hidden) this.hideMenus();
          else this.close();
        }
      };
      addEventListener('keydown', this.onKey, true);
      this.onOpenRequest = (event) => {
        if (event.detail?.id) this.switchTo(event.detail.id);
        this.open();
      };
      this.onCloseRequest = () => this.close();
      addEventListener('marble:agent-open', this.onOpenRequest);
      addEventListener('marble:agent-close', this.onCloseRequest);
      this.onViewport = () => this.render();
      this.phone.addEventListener('change', this.onViewport);
      this.onOutside = (event) => {
        if (!event.composedPath().some((node) => node === this.recent || node === this.actions || node === this.titleButton || node?.classList?.contains?.('more'))) this.hideMenus();
      };
      this.shadowRoot.addEventListener('pointerdown', this.onOutside);

      this.bindDrag();

      api.conversations().then((list) => {
        for (const summary of list) this.summaries.set(summary.id, summary);
        this.showLauncherState();
      }).catch(() => {});
      this.offSummaries = api.on('*', (summary) => {
        this.summaries.set(summary.id, summary);
        this.showLauncherState();
        if (summary.id === this.view.getAttribute('conversation')) this.showMeta(summary);
      });
      api.providers().then((providers) => {
        for (const provider of providers) this.labels.set(provider.id, provider);
        this.showMeta(this.meta);
      }).catch(() => {});

      if (api.storage.get(OPEN_KEY) === '1') this.open({ animate: false });
      else this.render();
    }

    disconnectedCallback() {
      removeEventListener('keydown', this.onKey, true);
      removeEventListener('marble:agent-open', this.onOpenRequest);
      removeEventListener('marble:agent-close', this.onCloseRequest);
      this.phone.removeEventListener('change', this.onViewport);
      this.offSummaries?.();
      this.cancelMotion?.();
      this.dock(false);
    }

    root(selector) {
      return this.shadowRoot.querySelector(selector);
    }

    // ---------------------------------------------------------- open, close

    open({ animate = true } = {}) {
      this.isOpen = true;
      this.api.storage.set(OPEN_KEY, '1');
      this.animateTo(1, { animate });
      this.view.focusInput();
      const id = this.view.getAttribute('conversation');
      if (id && this.summaries.get(id)?.needsReview) this.api.markReviewed(id).catch(() => {});
    }

    close() {
      this.isOpen = false;
      this.api.storage.set(OPEN_KEY, '0');
      this.hideMenus();
      this.animateTo(0);
      this.launcher.focus({ preventScroll: true });
    }

    animateTo(target, { animate = true, velocity = 0 } = {}) {
      this.cancelMotion?.();
      this.cancelMotion = null;
      if (!animate || this.reduced.matches) {
        this.progress = target;
        this.render();
        return;
      }
      this.cancelMotion = spring({
        from: this.progress,
        to: target,
        velocity,
        onFrame: (value) => {
          this.progress = value;
          this.render();
        },
        onDone: () => {
          this.cancelMotion = null;
        },
      });
      this.render();
    }

    render() {
      const phone = this.phone.matches;
      const p = Math.max(0, Math.min(1, this.progress));
      const visible = this.isOpen || p > 0.001;
      this.panel.dataset.open = String(this.isOpen);
      this.panel.dataset.pinned = String(this.pinned && !phone);
      this.panel.inert = !this.isOpen;
      this.panel.style.visibility = visible ? 'visible' : 'hidden';
      this.launcher.setAttribute('aria-expanded', String(this.isOpen));
      this.toggleAttribute('data-open-state', false);
      if (this.isOpen) this.setAttribute('data-open-state', 'open');
      if (this.reduced.matches) {
        this.panel.style.transform = 'none';
        this.panel.style.opacity = this.isOpen ? '1' : '0';
      } else {
        this.panel.style.opacity = '';
        this.panel.style.transform = phone ? `translateY(${(1 - p) * 100}%)` : `translateX(${(1 - p) * 100}%)`;
      }
      this.pinButton.setAttribute('aria-pressed', String(this.pinned));
      this.dock(this.isOpen && this.pinned && !phone);
    }

    setPinned(pinned) {
      this.pinned = pinned;
      this.api.storage.set(PIN_KEY, pinned ? '1' : '0');
      this.render();
    }

    /** Docking moves the page, which is the whole point of pinning — and is
     *  done with a transient stylesheet, so nothing about the document changes. */
    dock(on) {
      const existing = document.getElementById('marble-agent-dock');
      if (on && !existing) {
        const style = document.createElement('style');
        style.id = 'marble-agent-dock';
        style.setAttribute('data-marble-transient', '');
        style.textContent = `html { margin-inline-end: ${WIDTH}px !important; }`;
        document.head.append(style);
      } else if (!on && existing) {
        existing.remove();
      }
    }

    // ---------------------------------------------------------- dragging

    bindDrag() {
      let drag = null;
      this.bar.addEventListener('pointerdown', (event) => {
        if (!this.isOpen || event.button !== 0) return;
        if (event.composedPath().some((node) => TOOLS.has(node?.localName) && node !== this.titleButton)) return;
        drag = { id: event.pointerId, start: this.phone.matches ? event.clientY : event.clientX, moved: false, history: [] };
        this.bar.setPointerCapture(event.pointerId);
      });
      this.bar.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const position = this.phone.matches ? event.clientY : event.clientX;
        const distance = position - drag.start;
        if (!drag.moved && Math.abs(distance) < 10) return;
        if (!drag.moved) {
          drag.moved = true;
          this.cancelMotion?.();
          this.cancelMotion = null;
        }
        const size = this.phone.matches ? innerHeight : WIDTH;
        // Past the open edge the sheet resists rather than stops.
        const offset = distance >= 0 ? distance : (distance * size * 0.55) / (size + 0.55 * Math.abs(distance)) ;
        this.progress = 1 - offset / size;
        drag.history.push({ position, t: event.timeStamp });
        if (drag.history.length > 5) drag.history.shift();
        this.render();
      });
      const release = (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const current = drag;
        drag = null;
        if (!current.moved) return;
        // The click that ends a drag on the title is not a request for the menu.
        this.suppressClick = true;
        setTimeout(() => {
          this.suppressClick = false;
        }, 0);
        const size = this.phone.matches ? innerHeight : WIDTH;
        const [first, last] = [current.history[0], current.history.at(-1)];
        const velocity = first && last && last.t > first.t ? ((last.position - first.position) / (last.t - first.t)) * 1000 : 0;
        const offset = (1 - this.progress) * size;
        const resting = offset + project(velocity);
        if (resting > size / 2) {
          this.isOpen = false;
          this.api.storage.set(OPEN_KEY, '0');
          this.animateTo(0, { velocity: -velocity / size });
        } else {
          this.animateTo(1, { velocity: -velocity / size });
        }
      };
      this.bar.addEventListener('pointerup', release);
      this.bar.addEventListener('pointercancel', release);
      // A drag that ends on the title must not also open the recent menu.
      this.titleButton.addEventListener('click', (event) => {
        if (this.suppressClick) {
          event.stopImmediatePropagation();
          this.suppressClick = false;
        }
      }, true);
    }

    // ---------------------------------------------------------- content

    startNew() {
      this.hideMenus();
      this.api.remember(null);
      this.view.removeAttribute('conversation');
      this.meta = null;
      this.showMeta(null);
      if (!this.isOpen) this.open();
      else this.view.focusInput();
    }

    switchTo(id) {
      this.hideMenus();
      if (this.view.getAttribute('conversation') === id) return;
      this.api.remember(id);
      this.view.setAttribute('conversation', id);
      if (this.summaries.get(id)?.needsReview && this.isOpen) this.api.markReviewed(id).catch(() => {});
    }

    showMeta(meta) {
      if (meta !== undefined) this.meta = meta;
      const current = this.meta && this.meta.id === this.view.getAttribute('conversation') ? this.meta : null;
      this.titleText.textContent = current?.title || (this.view.getAttribute('conversation') ? 'Conversation' : 'New conversation');
      this.providerEl.textContent = current ? this.labels.get(current.provider)?.label ?? current.provider : '';
    }

    showWhere(running) {
      const target = running?.turn ? running.target : null;
      const here = window.marble?.app;
      if (target && target !== here) {
        this.where.textContent = `Viewing ${here} · editing ${target}`;
        this.where.hidden = false;
      } else {
        this.where.hidden = true;
      }
    }

    showLauncherState() {
      const list = [...this.summaries.values()].filter((s) => !s.archived);
      this.launcher.classList.toggle('running', list.some((s) => s.status === 'running'));
      const openId = this.isOpen ? this.view.getAttribute('conversation') : null;
      this.dot.hidden = !list.some((s) => s.needsReview && s.id !== openId);
    }

    // ---------------------------------------------------------- menus

    toggleMenu(menu, button, fill) {
      const opening = menu.hidden;
      this.hideMenus();
      if (!opening) return;
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      fill();
    }

    hideMenus() {
      for (const [menu, button] of [[this.recent, this.titleButton], [this.actions, this.root('.more')]]) {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    }

    item(menu, label, detail, onChoose) {
      const button = h('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.append(h('span', '', label));
      if (detail) button.append(h('small', '', detail));
      button.addEventListener('click', () => {
        this.hideMenus();
        onChoose();
      });
      menu.append(button);
      return button;
    }

    async fillRecent() {
      this.recent.replaceChildren(h('div', 'empty', 'Loading…'));
      let list = [];
      try {
        list = await this.api.conversations();
      } catch (err) {
        this.recent.replaceChildren(h('div', 'empty', err.message));
        return;
      }
      this.recent.replaceChildren();
      if (!list.length) this.recent.append(h('div', 'empty', 'No conversations yet.'));
      for (const summary of list.slice(0, 20)) {
        this.summaries.set(summary.id, summary);
        const provider = this.labels.get(summary.provider)?.label ?? summary.provider;
        const state = summary.status === 'running' ? 'Running' : summary.needsReview ? 'Needs review' : summary.activity || summary.status;
        this.item(this.recent, summary.title || 'Untitled', `${provider} · ${state}`, () => this.switchTo(summary.id));
      }
      this.recent.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    }

    async fillActions() {
      this.actions.replaceChildren();
      const id = this.view.getAttribute('conversation');
      const summary = id ? this.summaries.get(id) ?? this.meta : null;
      if (id) {
        for (const provider of this.labels.values()) {
          if (!provider.installed || !provider.signedIn || provider.id === summary?.provider) continue;
          this.item(this.actions, `Continue in ${provider.label}`, 'A new conversation that knows what happened here', async () => {
            try {
              const next = await this.api.handoff(id, provider.id);
              this.switchTo(next);
            } catch (err) {
              this.view.system(err.message, true);
            }
          });
        }
        this.item(this.actions, 'Archive conversation', 'Hidden from the list; nothing is deleted', async () => {
          try {
            await this.api.archive(id, true);
            this.startNew();
          } catch (err) {
            this.view.system(err.message, true);
          }
        });
      }
      try {
        const docs = await window.marble.docs();
        if (docs.some((doc) => (doc.path ?? doc.name) === 'Agents')) {
          this.item(this.actions, 'Open Agents', 'Every conversation, as a list or a board', () => {
            location.href = window.marble.href('Agents');
          });
        }
      } catch {
        // No listing, no link.
      }
      if (!this.actions.children.length) this.actions.append(h('div', 'empty', 'Nothing to do yet.'));
    }
  }

  customElements.define('marble-agent-drawer', MarbleAgentDrawer);

  // ------------------------------------------------------------ mounting

  const mount = () => {
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('marble-agent-drawer')) return;
    const drawer = document.createElement('marble-agent-drawer');
    drawer.setAttribute('data-marble-transient', '');
    document.body.append(drawer);
  };

  window.marbleAgentUI = { renderText, spring, project, TOKENS };

  if (window.marble?.agent) mount();
  else addEventListener('marble:agent', mount, { once: true });
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --test-reporter=spec test-browser/drawer.test.js && npm run test:browser && npm test`
Expected: PASS — 11 drawer tests; browser total 29 (the conversation tests still pass with a drawer on the page); `npm test` 313. Run `npm run test:browser` three times; motion tests must not flake.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/drawer.test.js
git commit -m "Agents drawer: the drawer — launcher, overlay or pinned, springs, menus, follows you"
```

---

### Task 5: Look at it, try it for real, and write it down

**Files:**
- Create: `test-browser/screens.mjs`
- Modify: `docs/CARRIER-DRIVE.md`, `docs/AGENTS.md`
- May modify: CSS values inside `runtime/agent-ui.js` only (see the note at the top of this plan)

**Interfaces:**
- Consumes: everything above; `node bin/marble-drive.js serve` with `MARBLE_DRIVE_AGENTS=1` for the live check.
- Produces: screenshots under the session scratchpad (not committed); docs.

- [ ] **Step 1: Write the screenshot script**

Create `test-browser/screens.mjs`:

```js
// Screenshots of the drawer, for looking at — not a test.
//
//   node test-browser/screens.mjs <out-dir>
//
// Light, dark, pinned, phone and a finished turn, against a scratch drive with
// the scripted fake agent, so what you see does not depend on any real agent.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { startDrive } from './harness.js';

const out = process.argv[2];
if (!out) {
  console.error('usage: node test-browser/screens.mjs <out-dir>');
  process.exit(1);
}
await fsp.mkdir(out, { recursive: true });

const host = await startDrive({
  scripts: {
    rename: [
      { call: 'read_document', args: { path: 'garden' } },
      { call: 'apply_ops', args: { path: 'garden', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
      { say: 'Renamed the heading to **Backlog** and left the questions as they were.\n\n- `h` now reads Backlog\n- nothing else changed' },
    ],
  },
});

async function shot(name, { viewport = { width: 1280, height: 800 }, colorScheme = 'light', steps = async () => {} } = {}) {
  await host.reset();
  const { page } = await host.newPage({ viewport, colorScheme });
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));
  await steps(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(path.join(out, `${name}.png`));
}

const drawer = (page) => page.locator('marble-agent-drawer');
const openIt = async (page) => {
  await drawer(page).locator('.launcher').click();
  await drawer(page).locator('aside.panel[data-open="true"]').waitFor();
};
const runRename = async (page) => {
  await openIt(page);
  await drawer(page).locator('button.new').click();
  await drawer(page).locator('marble-conversation textarea').fill('script:rename');
  await drawer(page).locator('marble-conversation textarea').press('Enter');
  await drawer(page).locator('marble-conversation .turn-footer[data-status="completed"]').waitFor();
};

await shot('1-closed');
await shot('2-open-new', { steps: openIt });
await shot('3-turn-light', { steps: runRename });
await shot('4-turn-dark', { colorScheme: 'dark', steps: runRename });
await shot('5-pinned', { steps: async (page) => { await runRename(page); await drawer(page).locator('button.pin').click(); } });
await shot('6-phone', { viewport: { width: 390, height: 844 }, steps: runRename });
await shot('7-menu', { steps: async (page) => { await runRename(page); await drawer(page).locator('button.title').click(); } });

await host.close();
```

- [ ] **Step 2: Look at the screenshots and fix what looks wrong**

Run: `node test-browser/screens.mjs <scratchpad>/drawer-screens` and open every PNG (the Read tool shows images).

Check, and fix in CSS only: the launcher and panel read as part of the Drive (tokens, radius, weight); nothing in the panel overlaps or clips (header, where-banner, menu, composer); the user bubble, agent text, tool rows and footer have clear hierarchy (the agent's words are the most prominent thing, tool rows quiet, the footer quieter); dark mode has no light-on-light or unreadable text; the phone sheet fills the screen with the composer above the home indicator; the pinned page's content is not under the panel. After any CSS change re-run `npm run test:browser` and the screenshots. Put the final screenshot paths and a one-line note per screenshot in the report.

- [ ] **Step 3: One real turn through the drawer**

This spends a little Claude quota. Start a real host on a scratch drive (never port 4400) and drive it with Playwright:

```bash
SCRATCH=$(mktemp -d)
node --input-type=module -e "const m = await import('./test-browser/harness.js'); process.stdout.write(m.GARDEN)" > "$SCRATCH/garden.mrbl"
MARBLE_DRIVE_ROOT="$SCRATCH" MARBLE_DRIVE_AGENTS=1 MARBLE_DRIVE_AGENT_PROVIDER=claude-subscription \
  MARBLE_DRIVE_AGENT_WORKDIR="$(mktemp -d)" PORT=4478 HOST=127.0.0.1 node bin/marble-drive.js serve &
SERVER=$!
sleep 2
curl -s -X PUT -H 'Content-Type: application/json' -d '{"models":{"claude-subscription":"claude-haiku-4-5"}}' http://127.0.0.1:4478/agent/settings
```

Then with a short Playwright script (same import as the harness) open `http://127.0.0.1:4478/a/garden`, open the drawer, send `Rename the heading to "Backlog". Change nothing else.`, wait up to 180 s for `.turn-footer[data-status="completed"]`, confirm the page's `h1` reads `Backlog`, take a screenshot, click **Undo turn**, confirm the `h1` reads `Research Garden` again. Then `kill $SERVER` and remove the scratch dirs. Record the outcome and screenshot path in the report. If it fails, record the transcript and error; do not change code on a guess.

- [ ] **Step 4: Document it**

Append to `docs/CARRIER-DRIVE.md` a section:

````markdown
## `marble.agent`

Injected (with `runtime/agent-ui.js`, the drawer) only when the host runs agents — see [AGENTS.md](AGENTS.md). Its absence is the answer to "can I talk to an agent here".

| call | |
|---|---|
| `marble.agent.providers()` | `[{id, label, installed, signedIn, detail, default, defaultModel}]` |
| `marble.agent.conversations({archived})` / `.conversation(id)` | summaries / `{meta, turns, events}` |
| `marble.agent.start({provider, model, handoffFrom})` | → conversation id |
| `marble.agent.send(id, {prompt, target, viewing, selection})` | missing context comes from `context()` |
| `marble.agent.cancel(turn)` / `.undo(turn)` / `.dequeue(turn)` | |
| `marble.agent.archive(id, bool)` / `.markReviewed(id)` / `.handoff(id, provider)` | |
| `marble.agent.restore(path, sha)` | the watchdog's restore point |
| `marble.agent.on(id \| '*', fn)` | a conversation's events (replayed, then live) / summaries; returns unsubscribe |
| `marble.agent.context()` | `{viewing, target, selection}` — the selection survives focus moving into transient chrome |
| `marble.agent.select(ids)` | for documents with their own selection model; `null` clears |
| `marble.agent.current()` / `.remember(id)` | the conversation that follows you between pages |
| `marble.agent.open(id)` / `.close()` | ask the drawer |

A document that draws its own agent interface says `<meta name="marble-agent" content="custom">` and gets the API without the drawer.
````

Append to `docs/AGENTS.md` a section before `## Not yet`:

````markdown
## The drawer

Every document gets a launcher (bottom right, `⌘J`). The drawer slides over the
page without changing its layout; **pin** docks it beside the page instead,
with a transient stylesheet, so nothing about the document changes. Below 720 px
it is a full-screen sheet. Drag the header away to dismiss it.

The conversation you had open follows you from page to page. A turn keeps the
document it started on: when you are looking at another page, the header says
which file it is editing. Each finished turn shows what changed with **Undo
turn**, and a turn the watchdog flagged offers **Restore**.

Agent text is shown, never interpreted as HTML (`renderText` in
`runtime/agent-ui.js`). Browser tests: `npm run test:browser`; screenshots:
`node test-browser/screens.mjs <dir>`.
````

- [ ] **Step 5: Run everything**

Run: `npm run test:browser` (3 times) and `npm test`.
Expected: 29 browser tests pass every time; `npm test` 313.

- [ ] **Step 6: Commit**

```bash
git add test-browser/screens.mjs docs/CARRIER-DRIVE.md docs/AGENTS.md runtime/agent-ui.js
git commit -m "Agents drawer: screenshots, a real turn through it, and the docs"
```

---

## After this plan

- **Plan 4 — `Agents.mrbl`:** library ⇄ board with the FLIP toggle, reusing `<marble-conversation>` and `window.marble.agent`.
- **Plan 5 — Codex.**
- Deferred: token-count normalisation and billing on the session event (for a usage line in the footer); a lost-session automatic retry; a target following move/trash.
