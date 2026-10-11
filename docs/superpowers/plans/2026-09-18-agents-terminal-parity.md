# Agents at Terminal Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent started from Marble runs with the same tools, skills, plugins, subagents and prompts as the terminal, in a project the owner picks, and two conversations never wear each other's events.

**Architecture:** A `projects` registry in agent settings gives each conversation a working directory (the drive by default). The Claude provider drops `--restricted` and speaks stream-json on stdin so the runner can answer permission prompts and `AskUserQuestion` ("asks") from the drawer. Ownership of writes is by path; the 30-minute cap is off by default.

**Tech Stack:** Node 22 (`node:test`), no new dependencies, vanilla custom elements in shadow DOM, Playwright browser tests via `test-browser/harness.js`.

**Spec:** `docs/superpowers/specs/2026-09-18-agents-terminal-parity-design.md`

## Global Constraints

- Node `>=22.0.0`; `"type": "module"`; no new npm dependencies.
- Agent chrome is transient: nothing the drawer draws is ever document content.
- `documents` capability and `MARBLE_DRIVE_AGENT_POWER=documents` keep the 2026-09-16 tools-only boundary exactly (spec §3).
- The workspace holding `mcp.json` (turn token, mode 600) stays outside the drive (spec §5.2).
- Every `/agent/*` route stays behind the gate and same-origin check that `handle()` in `server/agent/routes.js` already applies.
- Commit messages: one sentence, sentence case, ending in a period, then a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run `npm test` before every commit. Browser tests (`npm run test:browser`) run in Task 8 and Task 9 only; they need `npx playwright install chromium` once.

---

## File map

| File | Responsibility after this plan |
|---|---|
| `server/agent/projects.js` (new) | the drive project, path validation, lookup by id |
| `server/agent/store.js` | settings gain `projects`, `defaultProject`, `skills`; conversations gain `project`; summaries gain `asking` |
| `server/agent/routes.js` | `/agent/projects`, `project` on conversation create, `POST /agent/turns/:id/answer`, `?provider=` on `/agent/skills` |
| `server/agent/runner.js` | cwd from the project, prompt context by project kind, open stdin, asks, stall suspension, `maxMs: 0` |
| `server/agent/instructions.js` | `INSTRUCTIONS`, `DRIVE_INSTRUCTIONS`, `PROJECT_INSTRUCTIONS`, `instructionsFor(capability, kind)` |
| `server/agent/providers/claude.js` | unrestricted spawn, stream-json stdin, asks in `parse`, catalog from `init` |
| `server/agent/providers/cursor.js` | `AGENTS.md` by project kind |
| `server/agent/index.js` | wires projects into the runner |
| `server/config.js` | `agentStallMinutes` 30, `agentMaxMinutes` 0 |
| `runtime/agent.js` | `projects()`, `addProject()`, `removeProject()`, `answer()`, `start({ project })`, `skills(provider)` |
| `runtime/agent-ui.js` | project segment, project tag, "Also working here", ask cards, settings-panel projects |
| `templates/agents.mrbl` | **Needs you** badge |
| `test/fixtures/fake-agent.mjs`, `test/fixtures/fake-provider.js` | line-based stdin, `ask` step |
| `docs/AGENTS.md`, `.env.example` | the new boundary, projects, asks, limits |

---

### Task 1: Land the ownership fix already in the tree

The working tree carries uncommitted agent-made work: ownership by path in the runner (`ownsPath`, `documentTouched`), `also`-in-view context, folder publishing, and three test-file edits in `test/agent-provider-claude.test.js` that push toward a `--restricted` allowlist this plan replaces (spec §15.6).

**Files:**
- Revert: `test/agent-provider-claude.test.js`
- Commit: everything else listed below

- [ ] **Step 1: Drop the superseded test edits**

```bash
git checkout -- test/agent-provider-claude.test.js
```

- [ ] **Step 2: Run the suite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 3: Commit the in-tree work (leave `.claude/skills/my-day/lib/design.css` alone; it is unrelated)**

```bash
git add package.json package-lock.json runtime/agent-folders.js runtime/agent-ui.js \
  server/agent/routes.js server/agent/runner.js server/app.js templates/agents.mrbl \
  test-browser/agents-focus.test.js test-browser/agents-folders.test.js test-browser/agents-page.test.js \
  test-browser/conversation.test.js test/agent-folders.test.js test/agent-http.test.js test/agent-runner.test.js \
  docs/superpowers/specs/2026-09-17-agent-conversation-controls-design.md \
  docs/superpowers/plans/2026-09-17-agent-conversation-controls.md \
  docs/superpowers/specs/2026-09-18-agents-four-views-design.md
git commit -m "Credit a document change to the turn that owns its path, and publish folder changes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Projects in the store

**Files:**
- Create: `server/agent/projects.js`
- Modify: `server/agent/store.js:233-236` (settings defaults), `:270-300` (createConversation), `:30-36` (summarize)
- Test: `test/agent-projects.test.js` (new), `test/agent-store.test.js:123-127`

**Interfaces:**
- Produces: `DRIVE_PROJECT_ID = 'drive'`; `driveProject(root) → { id:'drive', name:'Drive', path: root, builtIn: true }`; `listProjects({ settings, root }) → Project[]` (drive first); `findProject({ settings, root }, id) → Project | null`; `async validateProjectPath(candidate, { root }) → absolute path` (throws `{ status: 400 }`); `store.createConversation({ …, project = 'drive' })`; `store.settings()` now includes `projects: []`, `defaultProject: 'drive'`, `skills: {}`; `summarize(meta).asking`.

- [ ] **Step 1: Write the failing tests**

`test/agent-projects.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DRIVE_PROJECT_ID, driveProject, findProject, listProjects, validateProjectPath } from '../server/agent/projects.js';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-projects-root-'));
await fsp.mkdir(path.join(ROOT, '.marble'), { recursive: true });
const REPO = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-projects-repo-'));

test('the drive is always the first project and cannot be replaced', () => {
  const settings = { projects: [{ id: 'aabbccddeeff', name: 'Repo', path: REPO }] };
  const list = listProjects({ settings, root: ROOT });
  assert.equal(list[0].id, DRIVE_PROJECT_ID);
  assert.equal(list[0].path, ROOT);
  assert.equal(list[0].builtIn, true);
  assert.equal(list[1].name, 'Repo');
  assert.deepEqual(driveProject(ROOT), { id: 'drive', name: 'Drive', path: ROOT, builtIn: true });
});

test('findProject answers the drive, a registered id, and null', () => {
  const settings = { projects: [{ id: 'aabbccddeeff', name: 'Repo', path: REPO }] };
  assert.equal(findProject({ settings, root: ROOT }, 'drive').path, ROOT);
  assert.equal(findProject({ settings, root: ROOT }, 'aabbccddeeff').name, 'Repo');
  assert.equal(findProject({ settings, root: ROOT }, 'nope'), null);
  assert.equal(findProject({ settings, root: ROOT }, undefined).id, 'drive', 'no id means the drive');
});

test('a project path must be absolute, exist, be a directory, and not be the drive or its .marble', async () => {
  assert.equal(await validateProjectPath(REPO, { root: ROOT }), REPO);
  await assert.rejects(validateProjectPath('relative/dir', { root: ROOT }), { status: 400 });
  await assert.rejects(validateProjectPath(path.join(REPO, 'missing'), { root: ROOT }), { status: 400 });
  const file = path.join(REPO, 'file.txt');
  await fsp.writeFile(file, 'x');
  await assert.rejects(validateProjectPath(file, { root: ROOT }), { status: 400 });
  await assert.rejects(validateProjectPath(ROOT, { root: ROOT }), { status: 400 });
  await assert.rejects(validateProjectPath(path.join(ROOT, '.marble'), { root: ROOT }), { status: 400 });
  assert.equal(await validateProjectPath(`${REPO}/`, { root: ROOT }), REPO, 'a trailing slash is normalised away');
});
```

In `test/agent-store.test.js`, change the settings assertion at line 125 to:

```js
  assert.deepEqual(await store.settings(), {
    defaultProvider: 'claude-subscription', models: {}, efforts: {}, maxRunning: 3,
    projects: [], defaultProject: 'drive', skills: {},
  });
```

and add:

```js
test('a conversation belongs to the drive project unless told otherwise, and a summary says whether it is asking', async () => {
  const { store } = await fresh();
  const plain = await store.createConversation({ provider: 'fake' });
  assert.equal(plain.project, 'drive');
  const repo = await store.createConversation({ provider: 'fake', project: 'aabbccddeeff' });
  assert.equal(repo.project, 'aabbccddeeff');
  assert.equal((await store.summary(plain.id)).asking, false);
  await store.updateConversation(plain.id, { asking: true });
  assert.equal((await store.summary(plain.id)).asking, true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/agent-projects.test.js test/agent-store.test.js`
Expected: FAIL — `Cannot find module '../server/agent/projects.js'`, and the settings deep-equal fails.

- [ ] **Step 3: Write `server/agent/projects.js`**

```js
// Where an agent works. The drive is always a project; anything else is a
// directory the owner registered once in the settings panel. A conversation
// names its project by id and the runner resolves the path at turn start, so
// a project removed later fails the next turn plainly instead of silently
// running somewhere else.

import fsp from 'node:fs/promises';
import path from 'node:path';

export const DRIVE_PROJECT_ID = 'drive';

export const driveProject = (root) => ({ id: DRIVE_PROJECT_ID, name: 'Drive', path: root, builtIn: true });

const registered = (settings) => (Array.isArray(settings?.projects) ? settings.projects : [])
  .filter((p) => p && typeof p.id === 'string' && typeof p.path === 'string')
  .map((p) => ({ id: p.id, name: String(p.name || path.basename(p.path)), path: p.path, builtIn: false }));

export function listProjects({ settings, root }) {
  return [driveProject(root), ...registered(settings).sort((a, b) => a.name.localeCompare(b.name))];
}

export function findProject({ settings, root }, id) {
  if (id === undefined || id === null || id === '' || id === DRIVE_PROJECT_ID) return driveProject(root);
  return registered(settings).find((p) => p.id === id) ?? null;
}

const bad = (message) => Object.assign(new Error(message), { status: 400 });

const within = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The absolute, normalised path, or a 400 saying why not. */
export async function validateProjectPath(candidate, { root }) {
  const raw = String(candidate ?? '').trim();
  if (!raw || !path.isAbsolute(raw)) throw bad('a project path must be absolute');
  const resolved = path.resolve(raw);
  let stat;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    throw bad(`no directory at ${resolved}`);
  }
  if (!stat.isDirectory()) throw bad(`${resolved} is not a directory`);
  if (resolved === path.resolve(root)) throw bad('the drive is already a project');
  if (within(resolved, path.join(path.resolve(root), '.marble'))) throw bad('a project cannot live inside the drive\'s .marble');
  return resolved;
}
```

- [ ] **Step 4: Store changes**

In `server/agent/store.js`:

```js
// summarize: add one field
export const summarize = (meta) => ({
  ...meta,
  status: meta.running ? 'running' : meta.lastOutcome ?? 'new',
  needsReview: needsReview(meta),
  queued: Boolean(meta.queued),
  asking: Boolean(meta.asking),
});

// settings(): new defaults
    return { defaultProvider, models: {}, efforts: {}, maxRunning: 3, projects: [], defaultProject: 'drive', skills: {}, ...saved };

// createConversation: signature and meta
    async createConversation({ provider, model = null, effort = null, mode = null, handoffFrom = null, project = 'drive' }) {
      ...
        mode,
        project,
        title: null,
```

- [ ] **Step 5: Run to verify they pass**

Run: `node --test test/agent-projects.test.js test/agent-store.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/agent/projects.js server/agent/store.js test/agent-projects.test.js test/agent-store.test.js
git commit -m "Give agents a projects registry, with the drive always first.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Projects over HTTP and in the client

**Files:**
- Modify: `server/agent/routes.js` (imports; `/agent/projects` before the `/agent/conversations` block; conversation POST), `runtime/agent.js:151-161`
- Test: `test/agent-http.test.js`

**Interfaces:**
- Consumes: `listProjects`, `findProject`, `validateProjectPath` from Task 2; `root` already passed to `createAgentRoutes`.
- Produces: `GET /agent/projects → Project[]`; `POST /agent/projects { name, path } → 201 Project` (200 with the existing row when the path is already registered); `DELETE /agent/projects/:id → { removed: true }`, 400 for `drive`, 404 unknown; `POST /agent/conversations { project }` (400 for an unknown id); `marble.agent.projects()`, `.addProject({ name, path })`, `.removeProject(id)`, `.start({ project })`.

- [ ] **Step 1: Write the failing tests** (append to `test/agent-http.test.js`, which already has `api(method, route, body)` returning `{ status, body }` and `WORK` as a scratch dir)

```js
test('projects: the drive is listed first, a directory can be added once and removed, and the drive cannot', async () => {
  const repo = await fsp.mkdtemp(path.join(WORK, 'repo-'));
  const listed = await api('GET', '/agent/projects');
  assert.equal(listed.status, 200);
  assert.equal(listed.body[0].id, 'drive');
  assert.equal(listed.body[0].path, ROOT);

  const added = await api('POST', '/agent/projects', { name: 'Repo', path: repo });
  assert.equal(added.status, 201);
  assert.match(added.body.id, /^[0-9a-f]{12}$/);
  assert.equal(added.body.path, repo);
  const again = await api('POST', '/agent/projects', { name: 'Other name', path: `${repo}/` });
  assert.equal(again.status, 200, 'the same path is the same project');
  assert.equal(again.body.id, added.body.id);

  assert.equal((await api('POST', '/agent/projects', { name: 'x', path: 'relative' })).status, 400);
  assert.equal((await api('POST', '/agent/projects', { name: 'x', path: ROOT })).status, 400);

  const conv = await api('POST', '/agent/conversations', { provider: 'fake', project: added.body.id });
  assert.equal(conv.status, 201);
  assert.equal(conv.body.project, added.body.id);
  assert.equal((await api('POST', '/agent/conversations', { provider: 'fake', project: 'nope' })).status, 400);
  assert.equal((await api('POST', '/agent/conversations', { provider: 'fake' })).body.project, 'drive');

  assert.equal((await api('DELETE', '/agent/projects/drive')).status, 400);
  assert.equal((await api('DELETE', `/agent/projects/${added.body.id}`)).status, 200);
  assert.equal((await api('DELETE', `/agent/projects/${added.body.id}`)).status, 404);
  assert.equal((await api('GET', '/agent/projects')).body.length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/agent-http.test.js`
Expected: FAIL — `GET /agent/projects` answers 404.

- [ ] **Step 3: Routes**

In `server/agent/routes.js` add the import and regex:

```js
import crypto from 'node:crypto';
import { findProject, listProjects, validateProjectPath } from './projects.js';
const PROJECT = /^\/agent\/projects\/([0-9a-f]{12}|drive)$/;
```

Before `if (route === '/agent/conversations') {` insert:

```js
    if (route === '/agent/projects') {
      if (method === 'GET') return json(res, 200, listProjects({ settings: await store.settings(), root }));
      if (method === 'POST') {
        const body = await readJson(req, maxBody);
        let resolved;
        try {
          resolved = await validateProjectPath(body.path, { root });
        } catch (err) {
          if (err.status === 400) return json(res, 400, { error: err.message });
          throw err;
        }
        const settings = await store.settings();
        const existing = (settings.projects ?? []).find((p) => p.path === resolved);
        if (existing) return json(res, 200, { ...existing, builtIn: false });
        const project = {
          id: crypto.randomBytes(6).toString('hex'),
          name: String(body.name ?? '').trim().slice(0, 80) || resolved.split('/').filter(Boolean).pop(),
          path: resolved,
        };
        await store.saveSettings({ projects: [...(settings.projects ?? []), project] });
        return json(res, 201, { ...project, builtIn: false });
      }
    }
    const projectRoute = PROJECT.exec(route);
    if (projectRoute && method === 'DELETE') {
      const id = projectRoute[1];
      if (id === 'drive') return json(res, 400, { error: 'the drive is always a project' });
      const settings = await store.settings();
      if (!(settings.projects ?? []).some((p) => p.id === id)) return json(res, 404, { error: `no project "${id}"` });
      await store.saveSettings({ projects: settings.projects.filter((p) => p.id !== id) });
      return json(res, 200, { removed: true });
    }
```

In the conversation `POST`, after the `handoffFrom` check:

```js
        const settings = await store.settings();
        const { models, efforts } = settings;
        const projectId = typeof body.project === 'string' && body.project.trim() ? body.project.trim() : settings.defaultProject || 'drive';
        const project = findProject({ settings, root }, projectId);
        if (!project) return json(res, 400, { error: `no project "${projectId}"` });
        const meta = await store.createConversation({
          provider: body.provider,
          model: body.model ?? models[body.provider] ?? null,
          effort: body.effort ?? efforts?.[body.provider] ?? null,
          mode: typeof body.mode === 'string' && body.mode.trim() ? body.mode.trim() : null,
          handoffFrom: from?.id ?? null,
          project: project.id,
        });
```

(Remove the older `const { models, efforts } = await store.settings();` line.)

- [ ] **Step 4: Client**

In `runtime/agent.js`, inside the `agent` object:

```js
      projects: () => ask('/agent/projects'),
      addProject: (body) => ask('/agent/projects', { method: 'POST', body }),
      removeProject: (id) => ask(`/agent/projects/${enc(id)}`, { method: 'DELETE' }),

      async start({ provider, model = null, effort = null, mode = null, handoffFrom = null, project = null } = {}) {
        const body = { provider };
        if (model) body.model = model;
        if (effort) body.effort = effort;
        if (mode) body.mode = mode;
        if (handoffFrom) body.handoffFrom = handoffFrom;
        if (project) body.project = project;
        return (await ask('/agent/conversations', { method: 'POST', body })).id;
      },
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/agent-http.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/agent/routes.js runtime/agent.js test/agent-http.test.js
git commit -m "Register and pick projects over /agent/projects.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The runner works in the project, and stops capping turns

**Files:**
- Modify: `server/agent/runner.js` (`createRunner` options, `composePrompt`, `start`, the `cap` timer), `server/agent/index.js:135-160`, `server/config.js:127-128`, `.env.example:57-58`
- Test: `test/agent-runner.test.js`, `test/config.test.js`

**Interfaces:**
- Consumes: `findProject` (Task 2).
- Produces: `createRunner({ …, projects })` where `projects = { find: async (id) => Project | null }`; `provider.spawn()` and `provider.prepare()` receive `kind: 'drive' | 'project'` and `project`; `limits.maxMs <= 0` means no cap; `turn.project`.

- [ ] **Step 1: Write the failing tests**

In `test/agent-runner.test.js`, `setup()` currently builds the runner with `workdir`, `origin`, `bridgePath`, `limits`. Extend it so a test can hand in projects, and capture `spawned` (already there):

```js
async function setup({ limits = {}, tools, onLook, capability, projects = null } = {}) {
  ...
  const runner = createRunner({
    ...,
    driveRoot: path.join(dir, 'drive'),
    projects: projects ?? { find: async (id) => (!id || id === 'drive' ? { id: 'drive', name: 'Drive', path: path.join(dir, 'drive'), builtIn: true } : null) },
    ...
  });
```

and `await fsp.mkdir(path.join(dir, 'drive'), { recursive: true });` before creating the runner. Then add:

```js
test('a full turn runs in its project, and is told about the document only as context', async () => {
  const repo = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-runner-repo-'));
  const projects = { find: async (id) => (id === 'p1' ? { id: 'p1', name: 'Repo', path: repo, builtIn: false } : id === 'drive' || !id ? { id: 'drive', name: 'Drive', path: '/drive', builtIn: true } : null) };
  const { store, runner, spawned } = await setup({ capability: 'full', projects });
  const { id } = await store.createConversation({ provider: 'fake', project: 'p1' });
  await runner.send(id, { prompt: 'script:noop', context: { target: 'garden', viewing: 'garden' } });
  await until(async () => (await store.turn(`${id}-t1`)).status === 'completed');
  const spawn = spawned.at(-1);
  assert.equal(spawn.cwd, repo);
  assert.equal(spawn.kind, 'project');
  assert.equal(spawn.project.id, 'p1');
  assert.match(spawn.prompt, /Sent from Marble Drive\. The person was viewing the document "garden"/);
  assert.doesNotMatch(spawn.prompt, /The document you may edit/);
  await runner.close();
});

test('a drive turn keeps the document context block', async () => {
  const { store, runner, spawned } = await setup({ capability: 'full' });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:noop', context: { target: 'garden', viewing: 'garden' } });
  await until(async () => (await store.turn(`${id}-t1`)).status === 'completed');
  assert.equal(spawned.at(-1).kind, 'drive');
  assert.match(spawned.at(-1).prompt, /The document you may edit: garden/);
  await runner.close();
});

test('a conversation whose project is gone fails its turn plainly', async () => {
  const { store, runner } = await setup({ capability: 'full' });
  const { id } = await store.createConversation({ provider: 'fake', project: 'gone' });
  await runner.send(id, { prompt: 'script:noop', context: { target: 'garden' } });
  const turn = await until(async () => { const t = await store.turn(`${id}-t1`); return t.status === 'failed' ? t : null; });
  assert.match(turn.error, /project "gone" is not registered/);
  await runner.close();
});

test('a turn is told how many other conversations are running in its project, and not about other projects', async () => {
  const { store, runner, spawned } = await setup({ capability: 'full' });
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  await runner.send(a.id, { prompt: 'script:slow', context: { target: 'one' } });
  await until(() => runner.running().length === 1);
  await runner.send(b.id, { prompt: 'script:noop', context: { target: 'two' } });
  await until(() => spawned.length === 2);
  assert.match(spawned[1].prompt, /1 other agent conversation\(s\) are running in this project right now/);
  assert.doesNotMatch(spawned[0].prompt, /other agent conversation/);
  for (const turn of runner.running()) await runner.cancel(turn.id);
  await runner.close();
});

test('maxMs of zero never caps a turn', async () => {
  const { store, runner } = await setup({ limits: { maxMs: 0 } });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:slow', context: { target: 'garden' } });
  await until(async () => (await store.turn(`${id}-t1`)).status === 'completed', 8_000);
  assert.equal((await store.turn(`${id}-t1`)).error, null);
  await runner.close();
});
```

`SCRIPTS` in that file needs `noop: [{ say: 'done' }]` if absent. In `test/config.test.js` add:

```js
test('agent limits default to no cap and a 30 minute stall', () => {
  const config = loadConfig({ MARBLE_DRIVE_ROOT: '/tmp/x' });
  assert.equal(config.agentMaxMinutes, 0);
  assert.equal(config.agentStallMinutes, 30);
});
```

(Match the file's existing `loadConfig` import and env shape.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/agent-runner.test.js test/config.test.js`
Expected: FAIL — `spawn.kind` undefined, prompt lacks the new block, config defaults wrong.

- [ ] **Step 3: Runner**

`createRunner` signature: add `projects = null` after `driveRoot`. Add a resolver:

```js
  async function resolveProject(meta) {
    const id = meta.project || 'drive';
    const project = projects ? await projects.find(id) : { id: 'drive', name: 'Drive', path: driveRoot, builtIn: true };
    if (!project) throw new Error(`project "${id}" is not registered — pick another project for this conversation`);
    try {
      if (!(await fsp.stat(project.path)).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new Error(`the project directory ${project.path} is missing`);
    }
    return project;
  }
```

Replace `composePrompt`:

```js
  async function composePrompt(turn, meta, project) {
    const context = turn.context;
    const kind = project.id === 'drive' ? 'drive' : 'project';
    const lines = [turn.prompt, '', '---'];
    if (kind === 'drive') {
      lines.push(
        'Context from Marble Drive:',
        `- The person is viewing: ${context.viewing ?? context.target}`,
        `- The document you may edit: ${context.target}`,
      );
      if (context.also?.length) lines.push(`- Also in view: ${context.also.join(', ')}`);
    } else {
      const viewing = context.viewing ?? context.target;
      lines.push(
        `Sent from Marble Drive. The person was viewing the document "${viewing}" (on disk at ${path.join(driveRoot, `${viewing}.mrbl`)}) when they sent this. Marble's document tools can read and edit it; use them only if the request is about that document.`,
      );
    }
    if (context.selectionSource) lines.push('- They selected these elements:', '', context.selectionSource);
    const others = runningTurns().filter((t) => t.id !== turn.id && t.project?.id === project.id).length;
    if (others) {
      lines.push('', `${others} other agent conversation(s) are running in this project right now. Do not stash, reset, check out or discard changes you did not make.`);
    }
    if (meta.handoffFrom && turn.n === 1) {
      const brief = await handoffBrief(meta.handoffFrom);
      if (brief) lines.unshift(`This continues an earlier conversation. What happened there:\n\n${brief}\n\n---\n`);
    }
    return lines.join('\n');
  }
```

In `start(turn)`, after `turn.capability = capability;`:

```js
      const project = await resolveProject(meta);
      turn.project = project;
      const kind = project.id === 'drive' ? 'drive' : 'project';
```

Pass `kind` and `project` to `prepare` and `spawn`, and use the project path as cwd:

```js
      await provider.prepare?.({ workspace, mcp, browser, meta, skills, capability, kind, project });
      const prompt = await composePrompt(turn, meta, project);
      ...
      const spec = provider.spawn({
        workspace, mcp, prompt,
        resume: meta.providerSession, model: meta.model, effort: meta.effort, mode: meta.mode,
        env: base, capability, kind, project,
        cwd: capability === 'full' ? project.path : null,
      });
```

(`resolveProject` throwing inside the `try` in `start` already lands in `safeFinish(turn, { status: 'failed', error })`.)

The cap:

```js
      if (limits.maxMs > 0) {
        const cap = setTimeout(() => stop(turn, { status: 'cancelled', error: `took longer than ${Math.round(limits.maxMs / 60000)} min` }), limits.maxMs);
        cap.unref?.();
        turn.timers.push(() => clearTimeout(cap));
      }
```

Also set `project: null` in the `turn` object literal in `send()`.

- [ ] **Step 4: Wiring and config**

`server/agent/index.js`, in `boot()`, before `createRunner`:

```js
import { findProject } from './projects.js';
...
  const projects = { find: async (id) => findProject({ settings: await agentStore.settings(), root: config.root }, id) };
```

and pass `projects,` into `createRunner`. `server/config.js`:

```js
    agentStallMinutes: num('MARBLE_DRIVE_AGENT_STALL_MINUTES', 30),
    // 0 is no cap: a person stops a turn, a timer does not.
    agentMaxMinutes: num('MARBLE_DRIVE_AGENT_MAX_MINUTES', 0),
```

`.env.example` lines 57–58:

```
MARBLE_DRIVE_AGENT_STALL_MINUTES=30
# 0 is no cap. A turn ends when the agent finishes or you press Stop.
MARBLE_DRIVE_AGENT_MAX_MINUTES=0
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)|✖"`
Expected: `# fail 0`. If `test/agent-runner-capability.test.js` "a full provider is spawned rooted at the drive" fails on `cwd`, its host builds through `createDrive`, which now wires `projects`, so cwd is still `config.root`; fix only if the assertion text changed.

- [ ] **Step 6: Commit**

```bash
git add server/agent/runner.js server/agent/index.js server/config.js .env.example test/agent-runner.test.js test/config.test.js
git commit -m "Run a full turn in its project, tell it who else is there, and stop capping turns by default.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Claude launches like the terminal

**Files:**
- Modify: `server/agent/providers/claude.js`, `server/agent/instructions.js`, `server/agent/providers/cursor.js` (`prepare`), `server/agent/catalog.js:10-15`, `server/agent/runner.js` (stdin handling)
- Delete: `installSkills` from `server/agent/skills.js` and its call in `claude.js`
- Test: `test/agent-provider-claude.test.js`, `test/agent-skills.test.js`, `test/agent-provider-cursor.test.js`

**Interfaces:**
- Consumes: `kind` and `project` from Task 4.
- Produces: `instructionsFor(capability, kind = 'drive')`; `DRIVE_INSTRUCTIONS`, `PROJECT_INSTRUCTIONS`; spawn spec field `stdinOpen: true` (runner writes stdin and leaves it open until the turn ends); `parseClaudeLine` events `ask` and `catalog`; `CLAUDE_MODES` ids `auto, acceptEdits, plan, manual, bypassPermissions`; `CLAUDE_MODELS` labels `Haiku 4.5, Sonnet 5, Opus 5, Fable 5.1`.

- [ ] **Step 1: Rewrite the failing tests**

In `test/agent-provider-claude.test.js`:

Replace the test at line 82 (`ids, labels, and the spawn verified by the spike`) with:

```js
test('ids, labels, catalog, and the documents spawn', () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: { ANTHROPIC_API_KEY: 'sk-test' } });
  const api = createClaudeProvider({ auth: 'api', env: { ANTHROPIC_API_KEY: 'sk-test' } });
  assert.equal(sub.id, 'claude-subscription');
  assert.equal(sub.label, 'Claude');
  assert.equal(api.id, 'claude-api');
  assert.equal(api.label, 'KIXLAB API');

  const spec = sub.spawn({ workspace: '/w', prompt: 'Rename it', resume: 'sess-1', model: 'claude-haiku-4-5', effort: 'high', env: { PATH: '/bin' } });
  assert.equal(spec.command, 'claude');
  assert.equal(spec.stdin, 'Rename it');
  assert.ok(!spec.stdinOpen, 'a documents turn closes stdin after the prompt as before');
  assert.deepEqual(spec.args, [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--strict-mcp-config', '--mcp-config', path.join('/w', 'mcp.json'),
    '--allowedTools', 'mcp__marble', '--setting-sources', 'project',
    '--append-system-prompt', INSTRUCTIONS, '--model', 'claude-haiku-4-5', '--effort', 'high', '--resume', 'sess-1',
  ]);
  assert.deepEqual(spec.env, {}, 'the subscription never gets the API key');
  assert.deepEqual(api.spawn({ workspace: '/w', prompt: 'x', env: {} }).env, { ANTHROPIC_API_KEY: 'sk-test' });
  assert.deepEqual(sub.models.map((m) => m.id), ['haiku', 'sonnet', 'opus', 'fable']);
  assert.deepEqual(sub.models.map((m) => m.label), ['Haiku 4.5', 'Sonnet 5', 'Opus 5', 'Fable 5.1']);
  assert.deepEqual(sub.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(sub.modes.map((m) => m.id), ['auto', 'acceptEdits', 'plan', 'manual', 'bypassPermissions']);
});
```

Replace the test at line 211 (`each capability is told the truth about its own tools`) with:

```js
test('each capability and project kind gets its own instructions', async () => {
  const { instructionsFor, INSTRUCTIONS, DRIVE_INSTRUCTIONS, PROJECT_INSTRUCTIONS } = await import('../server/agent/instructions.js');
  assert.equal(instructionsFor('documents'), INSTRUCTIONS);
  assert.equal(instructionsFor('documents', 'project'), INSTRUCTIONS, 'a documents agent never sees a project');
  assert.match(INSTRUCTIONS, /There are no file or shell tools/);

  assert.equal(instructionsFor('full'), DRIVE_INSTRUCTIONS);
  assert.equal(instructionsFor('full', 'drive'), DRIVE_INSTRUCTIONS);
  assert.doesNotMatch(DRIVE_INSTRUCTIONS, /reach nothing outside/);
  assert.match(DRIVE_INSTRUCTIONS, /data-marble-id/);
  assert.match(DRIVE_INSTRUCTIONS, /apply_ops/);
  assert.match(DRIVE_INSTRUCTIONS, /Grep/);
  assert.match(DRIVE_INSTRUCTIONS, /check_document/);

  assert.equal(instructionsFor('full', 'project'), PROJECT_INSTRUCTIONS);
  assert.match(PROJECT_INSTRUCTIONS, /usual coding agent/);
  assert.match(PROJECT_INSTRUCTIONS, /apply_ops/);
  assert.ok(PROJECT_INSTRUCTIONS.length < DRIVE_INSTRUCTIONS.length, 'a project agent needs less telling');
});
```

Replace the test at line 241 (`a full-capability spawn is confined, tooled, and prompt-free`) with:

```js
test('a full-capability spawn is the terminal\'s, with Marble added and prompts routed to stdin', () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: {} });
  const { DRIVE_INSTRUCTIONS, PROJECT_INSTRUCTIONS } = instructionsModule;
  const spec = sub.spawn({ workspace: '/w', prompt: 'Rewrite it', capability: 'full', kind: 'drive', cwd: '/drive', env: { PATH: '/bin' } });
  assert.equal(spec.cwd, '/drive');
  assert.equal(spec.stdinOpen, true);
  assert.deepEqual(spec.args, [
    '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'auto',
    '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio',
    '--mcp-config', path.join('/w', 'mcp.json'),
    '--append-system-prompt', DRIVE_INSTRUCTIONS,
  ]);
  for (const gone of ['--restricted', '--tools', '--settings', '--strict-mcp-config', '--setting-sources', '--model', '--effort']) {
    assert.ok(!spec.args.includes(gone), `${gone} must not be passed`);
  }
  const lines = spec.stdin.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines[0], { type: 'control_request', request_id: 'marble-init', request: { subtype: 'initialize', hooks: {} } });
  assert.deepEqual(lines[1], { type: 'user', message: { role: 'user', content: 'Rewrite it' } });

  const project = sub.spawn({ workspace: '/w', prompt: 'x', capability: 'full', kind: 'project', cwd: '/repo', model: 'fable', effort: 'high', resume: 's1', mode: 'manual', env: {} });
  assert.equal(project.args[project.args.indexOf('--append-system-prompt') + 1], PROJECT_INSTRUCTIONS);
  assert.equal(project.args[project.args.indexOf('--permission-mode') + 1], 'manual');
  assert.deepEqual(project.args.slice(-6), ['--model', 'fable', '--effort', 'high', '--resume', 's1']);

  const legacy = sub.spawn({ workspace: '/w', prompt: 'x', capability: 'full', kind: 'drive', cwd: '/drive', mode: 'default', env: {} });
  assert.equal(legacy.args[legacy.args.indexOf('--permission-mode') + 1], 'auto', 'a stored default mode runs as auto');
  const bypass = sub.spawn({ workspace: '/w', prompt: 'x', capability: 'full', kind: 'drive', cwd: '/drive', mode: 'bypassPermissions', env: {} });
  assert.ok(bypass.args.includes('--allow-dangerously-skip-permissions'));
});
```

Add near the top of the file: `const instructionsModule = await import('../server/agent/instructions.js');`

Replace the test at line 276 (`a full-capability prepare writes the browser MCP server and private settings`) with:

```js
test('a full-capability prepare writes only a private mcp.json, with the browser server, and no settings file', async () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: {} });
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-claude-full-'));
  const mcp = { command: 'node', args: ['/bridge.js'], env: { MARBLE_AGENT_TOKEN: 't' } };
  const browser = { command: 'node', args: ['/browser.js'], env: { MARBLE_BROWSER_PROFILE: '/p' } };
  await sub.prepare({ workspace, mcp, browser, capability: 'full', kind: 'drive' });
  const mcpFile = JSON.parse(await fsp.readFile(path.join(workspace, 'mcp.json'), 'utf8'));
  assert.deepEqual(mcpFile.mcpServers.marble, mcp);
  assert.deepEqual(mcpFile.mcpServers.browser, browser);
  assert.equal((await fsp.stat(path.join(workspace, 'mcp.json'))).mode & 0o777, 0o600);
  await assert.rejects(fsp.stat(path.join(workspace, 'settings.json')), { code: 'ENOENT' });
});

test('a permission prompt on stdout becomes an ask, the initialize reply becomes a catalog, and init lists skills', () => {
  const ask = parseClaudeLine(JSON.stringify({
    type: 'control_request', request_id: 'r1',
    request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', display_name: 'AskUserQuestion', input: { questions: [] }, tool_use_id: 'tu1', requires_user_interaction: true },
  }));
  assert.deepEqual(ask, [{ type: 'ask', requestId: 'r1', tool: 'AskUserQuestion', displayName: 'AskUserQuestion', input: { questions: [] }, interactive: true }]);

  const bash = parseClaudeLine(JSON.stringify({
    type: 'control_request', request_id: 'r2',
    request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'tu2' },
  }));
  assert.equal(bash[0].displayName, 'Bash');
  assert.equal(bash[0].interactive, false);

  const catalog = parseClaudeLine(JSON.stringify({
    type: 'control_response',
    response: { subtype: 'success', request_id: 'marble-init', response: { commands: [{ name: 'apple-design', description: 'Apple UI' }, { name: 'superpowers:brainstorming', description: 'Design first' }] } },
  }));
  assert.deepEqual(catalog, [{ type: 'catalog', skills: [{ id: 'apple-design', name: 'apple-design', description: 'Apple UI' }, { id: 'superpowers:brainstorming', name: 'superpowers:brainstorming', description: 'Design first' }] }]);
  assert.deepEqual(parseClaudeLine(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'other' } })), []);

  const init = parseClaudeLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', slash_commands: ['compact', 'apple-design'], agents: ['Explore'] }));
  assert.deepEqual(init, [
    { type: 'session', id: 's' },
    { type: 'catalog', skills: [{ id: 'compact', name: 'compact', description: '' }, { id: 'apple-design', name: 'apple-design', description: '' }], agents: ['Explore'] },
  ]);
});
```

Update the `documents-capability spawn is exactly what it was before` test (line 267) to pass `kind: 'drive'` in `asked`; its assertions stand. In `test/agent-skills.test.js`, delete any test of `installSkills` (keep `listSkills`/`skillDirs` tests). In `test/agent-provider-cursor.test.js`, add to the `prepare` test that writes `AGENTS.md`:

```js
  await provider.prepare({ workspace, mcp, capability: 'full', kind: 'project' });
  assert.equal(await fsp.readFile(path.join(workspace, 'AGENTS.md'), 'utf8'), instructionsModule.PROJECT_INSTRUCTIONS);
```

(with the same `instructionsModule` import.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/agent-provider-claude.test.js test/agent-provider-cursor.test.js test/agent-skills.test.js`
Expected: FAIL on the new spawn args, missing exports, and parse events.

- [ ] **Step 3: Instructions**

Rewrite `server/agent/instructions.js`:

```js
// What every agent is told, whichever CLI it runs in. Claude gets it as an
// appended system prompt and Cursor as the workspace's AGENTS.md; one copy
// each, so the two cannot drift.
//
// Three texts. A `documents` agent has five MCP tools and nothing else. A
// `full` agent in the drive has its own tools and needs telling what a
// document is. A `full` agent in any other project is the person's usual
// coding agent and needs telling only that Marble's tools are there too.
//
// Nothing depends on an agent obeying any of them. The tools refuse what the
// rules forbid; the rules are here so an agent stops trying.

export const INSTRUCTIONS = `…unchanged from today…`;

export const DRIVE_INSTRUCTIONS = `You are working inside Marble Drive, at a shell rooted at the drive. Your working directory is the drive itself.

Alongside your usual tools you have Marble's document tools (list_documents, read_document, apply_ops, create_document, check_document, read_guide) and a browser (browser_tabs, browser_navigate, browser_snapshot, browser_click, browser_type, browser_take_screenshot, browser_close).

What a document is:
- One .mrbl file, which is one HTML file.
- Every addressable element carries a data-marble-id attribute. Those ids are how links, selections, comments and history find an element. **Preserve them when you rewrite a file.** An id you drop or renumber is a link somebody loses and a restore point that no longer lands. Add new elements without ids only if you then let Marble mint them.
- Call check_document after rewriting a document. It reports the format's own invariants and will tell you what you broke.

Which tool to use:
- **apply_ops** for a small, precise change to a document someone is looking at right now. It patches their open page at element granularity rather than reloading it, and it is refused rather than clobbering if they edited that element since you read it.
- If the person is viewing the document you are editing, grow it: insert a stub that matches the surrounding UI, then fill it with small apply_ops. Do not Write the finished subtree in one shot. An unfinished stub is the work; leave it if you stop. Never add a banner or marker that is not the UI itself.
- **Write / Edit** to restructure or rewrite a document nobody is viewing, and for any file that is not a document.
- **Bash** to run, test and check your work. Prefer it over guessing.
- **The browser** when the page must render or be clicked. Snapshot, then click or type by ref. Only http(s) URLs.

Documents are big — often one to three megabytes. Do not open one with Read. Use Grep, sed or read_document (which outlines a large document instead of dumping it) to find your way, and read only the parts you need.

The browser is a fresh Chromium with no cookies; it dies when the turn ends.

When you finish, reply with a short plain-language summary of what you changed.`;

export const PROJECT_INSTRUCTIONS = `You are the person's usual coding agent, working in this project from Marble Drive instead of a terminal. Nothing about your tools, skills or workflow is different.

Marble's document tools (list_documents, read_document, apply_ops, create_document, check_document, read_guide) are also available, for the Marble document the person was viewing when they sent this. A document is one HTML file whose elements carry data-marble-id; preserve those ids if you rewrite one, and use apply_ops to change a document someone is looking at, since it patches their page and is refused rather than clobbering a fresh edit.

When you finish, reply with a short plain-language summary of what you did.`;

/** The text for a capability and project kind. Anything unrecognised gets the narrower one. */
export const instructionsFor = (capability, kind = 'drive') => {
  if (capability !== 'full') return INSTRUCTIONS;
  return kind === 'project' ? PROJECT_INSTRUCTIONS : DRIVE_INSTRUCTIONS;
};
```

(Copy today's `INSTRUCTIONS` string verbatim; delete `FULL_INSTRUCTIONS`.)

- [ ] **Step 4: Catalog**

`server/agent/catalog.js`:

```js
export const CLAUDE_MODES = [
  { id: 'auto', label: 'Auto' },
  { id: 'acceptEdits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan' },
  { id: 'manual', label: 'Ask me' },
  { id: 'bypassPermissions', label: 'Bypass permissions' },
];
```

- [ ] **Step 5: The Claude provider**

In `server/agent/providers/claude.js`:

```js
export const CLAUDE_MODELS = [
  { id: 'haiku', label: 'Haiku 4.5' },
  { id: 'sonnet', label: 'Sonnet 5' },
  { id: 'opus', label: 'Opus 5' },
  { id: 'fable', label: 'Fable 5.1' },
];
// The request id Marble gives the stream-json initialize handshake. Its reply
// carries the CLI's own skills list.
export const INIT_REQUEST_ID = 'marble-init';
```

Delete `FULL_TOOLS` and `FULL_SETTINGS`. In `parseClaudeLine`:

```js
    case 'system': {
      if (e.subtype !== 'init') return [];
      const events = [];
      if (e.session_id) events.push({ type: 'session', id: e.session_id });
      const names = Array.isArray(e.slash_commands) ? e.slash_commands : [];
      if (names.length) {
        events.push({ type: 'catalog', skills: names.map((name) => ({ id: String(name), name: String(name), description: '' })), agents: Array.isArray(e.agents) ? e.agents : [] });
      }
      return events;
    }

    case 'control_request': {
      const r = e.request ?? {};
      if (r.subtype !== 'can_use_tool') return [];
      return [{
        type: 'ask',
        requestId: e.request_id,
        tool: r.tool_name,
        displayName: r.display_name ?? r.tool_name,
        input: r.input ?? {},
        interactive: Boolean(r.requires_user_interaction),
      }];
    }

    case 'control_response': {
      const r = e.response ?? {};
      if (r.request_id !== INIT_REQUEST_ID || !Array.isArray(r.response?.commands)) return [];
      return [{ type: 'catalog', skills: r.response.commands.map((c) => ({ id: String(c.name), name: String(c.name), description: String(c.description ?? '') })) }];
    }
```

`prepare`:

```js
    async prepare({ workspace, mcp, browser = null, capability = 'documents' }) {
      const config = { mcpServers: { marble: { command: mcp.command, args: mcp.args, env: mcp.env } } };
      if (capability === 'full' && browser) config.mcpServers.browser = browser;
      await writePrivateFile(path.join(workspace, 'mcp.json'), JSON.stringify(config, null, 2));
    },
```

`spawn`:

```js
    spawn({ workspace, prompt, resume = null, model = null, effort = null, mode = null, capability = 'documents', kind = 'drive', cwd = null }) {
      const current = live();
      const full = capability === 'full';
      const permission = !mode || mode === 'default' ? 'auto' : mode;
      const args = full
        ? [
            '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--include-partial-messages',
            // The person's own mode, prompts routed to us on stdin.
            '--permission-mode', permission,
            '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio',
            // Marble's server is added to whatever the person configured, not swapped for it.
            '--mcp-config', path.join(workspace, 'mcp.json'),
            '--append-system-prompt', instructionsFor('full', kind),
          ]
        : [
            '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
            '--tools', '', '--strict-mcp-config', '--mcp-config', path.join(workspace, 'mcp.json'),
            '--allowedTools', 'mcp__marble', '--setting-sources', 'project',
            '--append-system-prompt', instructionsFor('documents'),
          ];
      if (full && permission === 'bypassPermissions') args.push('--allow-dangerously-skip-permissions');
      if (!full && mode && mode !== 'default') {
        args.push('--permission-mode', mode);
        if (mode === 'bypassPermissions') args.push('--allow-dangerously-skip-permissions');
      }
      if (model) args.push('--model', model);
      if (effort) args.push('--effort', effort);
      if (resume) args.push('--resume', resume);
      if (api && !current.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is not set, so KIXLAB API cannot run — set it or choose Claude');
      }
      const stdin = full
        ? `${JSON.stringify({ type: 'control_request', request_id: INIT_REQUEST_ID, request: { subtype: 'initialize', hooks: {} } })}\n${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } })}\n`
        : prompt;
      return {
        command: 'claude',
        args,
        env: api ? { ANTHROPIC_API_KEY: current.ANTHROPIC_API_KEY } : {},
        stdin,
        // Open so a permission prompt or question can be answered mid-turn.
        ...(full ? { stdinOpen: true } : {}),
        ...(full && cwd ? { cwd } : {}),
      };
    },
```

Update the file header comment to say what the two invocations now are. Remove the `skills` parameter and the `installSkills` import from `prepare`. Delete `installSkills` from `server/agent/skills.js`.

- [ ] **Step 6: Cursor's `AGENTS.md` and the runner's stdin**

`server/agent/providers/cursor.js` `prepare({ workspace, mcp, browser = null, capability = 'documents', kind = 'drive' })`, last line:

```js
      await fsp.writeFile(path.join(workspace, 'AGENTS.md'), instructionsFor(capability, kind));
```

`server/agent/runner.js`, replace `child.stdin.end(spec.stdin ?? '');` with:

```js
      if (spec.stdinOpen) child.stdin.write(spec.stdin ?? '');
      else child.stdin.end(spec.stdin ?? '');
```

and in `finish()`, just after `for (const clear of turn.timers) clear();`:

```js
    try { turn.child?.stdin?.end(); } catch { /* already gone */ }
```

In `handle()` add:

```js
      case 'catalog':
        recordCatalog(turn, event);
        return;
```

with, above `handle`:

```js
  /** The CLI's own list of skills, kept per provider so the composer's `/`
   *  menu shows what the terminal would. Descriptions come from the
   *  initialize reply; names alone from init keep an older description. */
  function recordCatalog(turn, event) {
    const provider = turn.provider?.id;
    if (!provider || !Array.isArray(event.skills) || !event.skills.length) return;
    store.settings().then((settings) => {
      const old = new Map((settings.skills?.[provider] ?? []).map((s) => [s.id, s]));
      const next = event.skills.map((s) => ({ id: s.id, name: s.name ?? s.id, description: s.description || old.get(s.id)?.description || '' }));
      return store.saveSettings({ skills: { ...(settings.skills ?? {}), [provider]: next } });
    }).catch((err) => log.error(`[agents] ${err.message}`));
  }
```

- [ ] **Step 7: Run the suite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)|✖"`
Expected: `# fail 0`. `test/agent-runner-capability.test.js` "a full turn hands prepare a browser MCP spec" still passes (prepare's browser handling is unchanged).

- [ ] **Step 8: Commit**

```bash
git add server/agent/providers/claude.js server/agent/providers/cursor.js server/agent/instructions.js server/agent/catalog.js server/agent/skills.js server/agent/runner.js test/agent-provider-claude.test.js test/agent-provider-cursor.test.js test/agent-skills.test.js
git commit -m "Launch Claude the way the terminal does, with Marble added and prompts routed to stdin.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Asks in the runner, over HTTP, and in the fake agent

**Files:**
- Modify: `server/agent/runner.js` (`send` turn literal, `start` stall timer, `handle`, `stop`, `finish`, returned object), `server/agent/routes.js` (`TURN` regex, `/answer`), `runtime/agent.js`, `test/fixtures/fake-agent.mjs`, `test/fixtures/fake-provider.js`
- Test: `test/agent-runner.test.js`, `test/agent-http.test.js`

**Interfaces:**
- Consumes: `ask` events from `parse` (Task 5), `stdinOpen`.
- Produces: events `ask { turn, requestId, kind, tool, displayName, input, interactive }`, `ask.answered { turn, requestId, response }`, `ask.void { turn, requestId, why }`; `runner.answer(turnId, requestId, response)` (throws `{ status: 404 | 409 }`); `POST /agent/turns/:id/answer { requestId, response }`; `marble.agent.answer(turnId, requestId, response)`; conversation meta `asking`; fake script step `{ ask: { tool, input } }`.

- [ ] **Step 1: Fake agent reads stdin by line and can ask**

`test/fixtures/fake-agent.mjs`: replace the prompt read (`let prompt = ''; for await …`) with:

```js
// The first line is the prompt (its later lines are context and ignored).
// Anything after that which parses as a control_response answers an ask.
const stdin = readline.createInterface({ input: process.stdin });
const answers = [];
let waiter = null;
let prompt = null;
let promptReady;
const promptSeen = new Promise((resolve) => { promptReady = resolve; });
stdin.on('line', (line) => {
  if (prompt === null) {
    prompt = line;
    promptReady();
    return;
  }
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg?.type !== 'control_response') return;
  if (waiter) { const w = waiter; waiter = null; w(msg); } else answers.push(msg);
});
const nextAnswer = () => (answers.length ? Promise.resolve(answers.shift()) : new Promise((resolve) => { waiter = resolve; }));
await promptSeen;
```

and add a step in the loop:

```js
  if (step.ask) {
    const requestId = `ask-${nextId++}`;
    out({ kind: 'ask', requestId, tool: step.ask.tool, input: step.ask.input ?? {} });
    const msg = await nextAnswer();
    const r = msg.response?.response ?? {};
    out({ kind: 'text', text: `answered:${r.behavior}${r.updatedInput?.answers ? ':' + Object.values(r.updatedInput.answers).join(',') : ''}` });
  }
```

`test/fixtures/fake-provider.js`: `spawn` returns `stdin: `${prompt}\n``, `stdinOpen: true`; `parse` gains:

```js
        case 'ask': return [{ type: 'ask', requestId: e.requestId, tool: e.tool, displayName: e.tool, input: e.input, interactive: e.tool === 'AskUserQuestion' }];
```

- [ ] **Step 2: Write the failing runner tests**

Add to `SCRIPTS` in `test/agent-runner.test.js`:

```js
  permission: [{ ask: { tool: 'Bash', input: { command: 'rm -rf build' } } }, { say: 'after' }],
  question: [{ ask: { tool: 'AskUserQuestion', input: { questions: [{ question: 'A or B?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] } } }],
```

Tests:

```js
test('an ask is stored, marks the conversation asking, and an answer reaches the process', async () => {
  const { store, runner, published } = await setup({ capability: 'full' });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:permission', context: { target: 'garden' } });
  const ask = await until(async () => (await store.events(id)).find((e) => e.type === 'ask'));
  assert.equal(ask.kind, 'permission');
  assert.equal(ask.tool, 'Bash');
  assert.deepEqual(ask.input, { command: 'rm -rf build' });
  assert.equal((await store.summary(id)).asking, true);

  await runner.answer(`${id}-t1`, ask.requestId, { behavior: 'allow' });
  await until(async () => (await store.turn(`${id}-t1`)).status === 'completed');
  const events = await store.events(id);
  assert.ok(events.some((e) => e.type === 'ask.answered' && e.requestId === ask.requestId));
  assert.ok(events.some((e) => e.type === 'text' && e.text === 'answered:allow'));
  assert.equal((await store.summary(id)).asking, false);
  await assert.rejects(runner.answer(`${id}-t1`, ask.requestId, { behavior: 'allow' }), { status: 409 });
  await runner.close();
});

test('a question is an ask of kind question and its answer carries the chosen labels', async () => {
  const { store, runner } = await setup({ capability: 'full' });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:question', context: { target: 'garden' } });
  const ask = await until(async () => (await store.events(id)).find((e) => e.type === 'ask'));
  assert.equal(ask.kind, 'question');
  await runner.answer(`${id}-t1`, ask.requestId, { behavior: 'allow', updatedInput: { ...ask.input, answers: { 'A or B?': 'B' } } });
  await until(async () => (await store.events(id)).some((e) => e.type === 'text' && e.text === 'answered:allow:B'));
  await runner.close();
});

test('a turn waiting on an ask is not a stall', async () => {
  const { store, runner } = await setup({ capability: 'full', limits: { stallMs: 400 } });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:permission', context: { target: 'garden' } });
  const ask = await until(async () => (await store.events(id)).find((e) => e.type === 'ask'));
  await new Promise((r) => setTimeout(r, 900));
  assert.equal((await store.turn(`${id}-t1`)).status, 'running', 'still waiting for the person');
  await runner.answer(`${id}-t1`, ask.requestId, { behavior: 'deny', message: 'no' });
  await until(async () => (await store.turn(`${id}-t1`)).status === 'completed');
  await runner.close();
});

test('cancelling a turn denies its open ask and voids it', async () => {
  const { store, runner } = await setup({ capability: 'full' });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:permission', context: { target: 'garden' } });
  const ask = await until(async () => (await store.events(id)).find((e) => e.type === 'ask'));
  await runner.cancel(`${id}-t1`);
  await until(async () => (await store.turn(`${id}-t1`)).status === 'cancelled');
  const voided = (await store.events(id)).find((e) => e.type === 'ask.void');
  assert.equal(voided.requestId, ask.requestId);
  assert.equal(voided.why, 'cancelled');
  assert.equal((await store.summary(id)).asking, false);
  await assert.rejects(runner.answer(`${id}-t1`, ask.requestId, { behavior: 'allow' }), { status: 409 });
  await runner.close();
});
```

And in `test/agent-http.test.js` (`SCRIPTS` there gains the same `permission` script):

```js
test('POST /agent/turns/:id/answer answers an open ask once', async () => {
  const conv = (await api('POST', '/agent/conversations', { provider: 'fake' })).body;
  await api('POST', `/agent/conversations/${conv.id}/turns`, { prompt: 'script:permission', context: { target: 'garden' } });
  const ask = await until(async () => (await drive.agents.store.events(conv.id)).find((e) => e.type === 'ask'));
  assert.equal((await api('GET', `/agent/conversations/${conv.id}`)).body.meta.asking, true);
  const ok = await api('POST', `/agent/turns/${conv.id}-t1/answer`, { requestId: ask.requestId, response: { behavior: 'allow' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { answered: true });
  assert.equal((await api('POST', `/agent/turns/${conv.id}-t1/answer`, { requestId: ask.requestId, response: { behavior: 'allow' } })).status, 409);
  assert.equal((await api('POST', `/agent/turns/${conv.id}-t1/answer`, { requestId: 'nope', response: {} })).status, 404);
  assert.equal((await api('POST', `/agent/turns/${conv.id}-t9/answer`, { requestId: 'x', response: {} })).status, 409);
});
```

(That file's fake provider must be created with `capability: 'full'`? No: asks do not depend on capability. `until` exists in the runner test; copy the helper into the http test if absent.)

- [ ] **Step 3: Run to verify they fail**

Run: `node --test test/agent-runner.test.js test/agent-http.test.js`
Expected: FAIL — no `ask` event; `runner.answer` is not a function; route 404.

- [ ] **Step 4: Runner**

In the `turn` literal in `send()` add `asks: new Map(), holdStall: null, resumeStall: null,`.

In `start()`, after `const resetStall = () => {…}` change it so an open ask suspends it, and expose both:

```js
      const openAsks = () => [...turn.asks.values()].filter((a) => !a.closed).length;
      const resetStall = () => {
        clearTimeout(stall);
        if (openAsks()) return; // waiting on the person is not a stall
        stall = setTimeout(() => stop(turn, { status: 'failed', error: `stalled — no output for ${Math.round(limits.stallMs / 1000)} s` }), limits.stallMs);
        stall.unref?.();
      };
      turn.holdStall = () => clearTimeout(stall);
      turn.resumeStall = resetStall;
```

In `handle()`:

```js
      case 'ask': {
        const kind = event.tool === 'AskUserQuestion' ? 'question' : 'permission';
        turn.asks.set(event.requestId, { closed: false });
        turn.holdStall?.();
        chained(turn.conversationId, async () => {
          await store.updateConversation(turn.conversationId, { asking: true });
        }).then(() => emit(turn, { ...event, kind })).catch((err) => log.error(`[agents] ${err.message}`));
        return;
      }
```

Add a helper used by answer, stop and finish:

```js
  const writeControl = (turn, requestId, response) => {
    try {
      turn.child?.stdin?.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })}\n`);
    } catch { /* the process is gone; finish() will void the ask */ }
  };

  /** Close every open ask: deny it to the process (if asked) and void it in the log. */
  async function voidAsks(turn, why, { deny = false } = {}) {
    for (const [requestId, ask] of turn.asks) {
      if (ask.closed) continue;
      ask.closed = true;
      if (deny) writeControl(turn, requestId, { behavior: 'deny', message: `Turn ${why} from Marble` });
      await emit(turn, { type: 'ask.void', requestId, why });
    }
  }
```

In `stop()`, before `turn.child.kill('SIGTERM')`: `voidAsks(turn, 'cancelled', { deny: true }).catch((err) => log.error(`[agents] ${err.message}`));`

In `finish()`, after the timers are cleared and before stdin is ended: `await voidAsks(turn, 'ended');` and add `asking: false` to the `store.updateConversation(turn.conversationId, { … })` call there.

In the returned object:

```js
    async answer(turnId, requestId, response) {
      const turn = live.get(turnId);
      if (!turn || turn.status !== 'running' || turn.finishing) throw Object.assign(new Error('the turn is not running'), { status: 409 });
      const ask = turn.asks.get(requestId);
      if (!ask) throw Object.assign(new Error(`no ask "${requestId}" on this turn`), { status: 404 });
      if (ask.closed) throw Object.assign(new Error('this ask was already answered'), { status: 409 });
      ask.closed = true;
      writeControl(turn, requestId, response);
      const stillOpen = [...turn.asks.values()].some((a) => !a.closed);
      if (!stillOpen) await store.updateConversation(turn.conversationId, { asking: false });
      await emit(turn, { type: 'ask.answered', requestId, response });
      if (!stillOpen) turn.resumeStall?.();
      return true;
    },
```

- [ ] **Step 5: Route and client**

`server/agent/routes.js`: `const TURN = /^\/agent\/turns\/([0-9a-f]{12}-t\d+)(\/cancel|\/undo|\/answer)?$/;` and in the turn block:

```js
      if (action === '/answer' && method === 'POST') {
        const body = await readJson(req, maxBody);
        if (typeof body.requestId !== 'string' || !body.requestId) return json(res, 400, { error: 'requestId is required' });
        if (!body.response || typeof body.response !== 'object') return json(res, 400, { error: 'response is required' });
        try {
          await runner.answer(turnId, body.requestId, body.response);
          return json(res, 200, { answered: true });
        } catch (err) {
          if (err.status) return json(res, err.status, { error: err.message });
          throw err;
        }
      }
```

`runtime/agent.js`: `answer: (turnId, requestId, response) => ask(`/agent/turns/${enc(turnId)}/answer`, { method: 'POST', body: { requestId, response } }),`

- [ ] **Step 6: Run the suite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)|✖"`
Expected: `# fail 0`. Existing tests that read the fake's `prompt:` line still pass because the first stdin line is unchanged.

- [ ] **Step 7: Commit**

```bash
git add server/agent/runner.js server/agent/routes.js runtime/agent.js test/fixtures/fake-agent.mjs test/fixtures/fake-provider.js test/agent-runner.test.js test/agent-http.test.js
git commit -m "Bring permission prompts and questions to the person as asks.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Skills menu from the CLI's own list

**Files:**
- Modify: `server/agent/routes.js:172-175`, `runtime/agent.js` (`skills`), `runtime/agent-ui.js` (`syncCatalog`)
- Test: `test/agent-http.test.js`

**Interfaces:**
- Consumes: `settings.skills[provider]` written by `recordCatalog` (Task 5).
- Produces: `GET /agent/skills?provider=<id>` returns the recorded list when there is one, else the directory scan; `marble.agent.skills(provider)`.

- [ ] **Step 1: Failing test**

```js
test('GET /agent/skills prefers what the CLI reported for that provider', async () => {
  await drive.agents.store.saveSettings({ skills: { fake: [{ id: 'superpowers:brainstorming', name: 'superpowers:brainstorming', description: 'Design first' }] } });
  const forFake = await api('GET', '/agent/skills?provider=fake');
  assert.deepEqual(forFake.body, [{ id: 'superpowers:brainstorming', name: 'superpowers:brainstorming', description: 'Design first' }]);
  const plain = await api('GET', '/agent/skills');
  assert.equal(plain.status, 200);
  assert.ok(Array.isArray(plain.body));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/agent-http.test.js`
Expected: FAIL — the recorded list is not returned.

- [ ] **Step 3: Route and client**

```js
    if (route === '/agent/skills' && method === 'GET') {
      const provider = url.searchParams.get('provider');
      const recorded = provider ? (await store.settings()).skills?.[provider] : null;
      if (Array.isArray(recorded) && recorded.length) return json(res, 200, recorded);
      const list = typeof skills === 'function' ? await skills() : skills;
      return json(res, 200, list.map(({ id, name, description }) => ({ id, name: name ?? id, description: description ?? '' })));
    }
```

`runtime/agent.js`: `skills: (provider = null) => ask(provider ? `/agent/skills?provider=${enc(provider)}` : '/agent/skills'),`

`runtime/agent-ui.js` `syncCatalog`, right after `const provider = this.currentProvider();`:

```js
      if (provider?.id) this.skills = await this.api.skills?.(provider.id).catch(() => this.skills ?? []) ?? this.skills;
```

- [ ] **Step 4: Run and commit**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"` → `# fail 0`

```bash
git add server/agent/routes.js runtime/agent.js runtime/agent-ui.js test/agent-http.test.js
git commit -m "Feed the composer's slash menu from the CLI's own skills list.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Ask cards in the conversation view, Needs you on the Agents page

**Files:**
- Modify: `runtime/agent-ui.js` (styles near `.tool`, `receive()`, new `ask()`/`askClosed()`, drawer recent-list state at ~3274), `templates/agents.mrbl` (badge paint near line 2633)
- Test: `test-browser/conversation.test.js`, `test-browser/agents-page.test.js`

**Interfaces:**
- Consumes: `ask`, `ask.answered`, `ask.void` events; `marble.agent.answer`; `summary.asking`.
- Produces: `.ask[data-request][data-kind]` card with `button.allow`, `button.deny`, `input.deny-note`, and for questions `button[role="radio"|"checkbox"]` options plus `button.answer`; `window.marbleAgentUI.askResponse(kind, input, picks, note)`.

- [ ] **Step 1: Failing browser tests** (`test-browser/conversation.test.js`; add `permission` and `question` to its `SCRIPTS` exactly as in Task 6)

```js
test('a permission ask shows a card, and Allow answers it', async () => {
  const { view, errors } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await sendFrom(view, 'script:permission');
  const card = view.locator('.ask[data-kind="permission"]');
  await card.waitFor();
  assert.match(await card.textContent(), /Bash/);
  assert.match(await card.textContent(), /rm -rf build/);
  await card.locator('button.allow').click();
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.ask').count(), 0);
  assert.match(await view.locator('.msg.agent').last().textContent(), /answered:allow/);
  assert.deepEqual(errors, []);
});

test('a question ask offers its options; arrows move, Enter answers with the label', async () => {
  const { view, errors } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await sendFrom(view, 'script:question');
  const card = view.locator('.ask[data-kind="question"]');
  await card.waitFor();
  assert.equal(await card.locator('[role="radio"]').count(), 2);
  await card.locator('[role="radio"]').first().focus();
  await card.locator('[role="radio"]').first().press('ArrowDown');
  await card.locator('[role="radio"]').nth(1).press('Enter');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.match(await view.locator('.msg.agent').last().textContent(), /answered:allow:B/);
  assert.deepEqual(errors, []);
});
```

In `test-browser/agents-page.test.js` (its `SCRIPTS` gains `permission: [{ ask: { tool: 'Bash', input: { command: 'ls' } } }, { say: 'after' }]`; it already has `openAgents()`), add:

```js
test('a conversation waiting on the person says Needs you', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.send(id, { prompt: 'script:permission', target: 'garden' });
  });
  await page.locator('.conv .badge', { hasText: 'Needs you' }).first().waitFor();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:browser -- test-browser/conversation.test.js`
Expected: FAIL — no `.ask` element.

- [ ] **Step 3: The card**

Styles, beside `.tool` in the conversation element's `<style>`:

```css
    .ask { margin: 8px 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper-2, var(--paper)); display: grid; gap: 8px; }
    .ask .ask-title { font-weight: 600; font-size: 13px; }
    .ask pre { margin: 0; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
    .ask .ask-options { display: grid; gap: 4px; }
    .ask .ask-options button { text-align: left; font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: none; color: inherit; cursor: pointer; }
    .ask .ask-options button[aria-checked="true"] { border-color: var(--accent-ink); background: color-mix(in srgb, var(--accent-ink) 10%, transparent); }
    .ask .ask-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .ask .ask-actions button { font: inherit; font-size: 12.5px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--line); background: none; color: inherit; cursor: pointer; }
    .ask .ask-actions button.allow, .ask .ask-actions button.answer { background: var(--accent-ink); color: var(--paper); border-color: var(--accent-ink); }
    .ask .deny-note { flex: 1; min-width: 8em; font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: none; color: inherit; }
```

A pure helper next to `toolLabel`:

```js
  /** What to send back for an ask. `picks` is a Map question → Set of labels. */
  function askResponse(kind, input, picks = new Map(), note = '') {
    if (kind === 'question') {
      const answers = {};
      for (const q of input?.questions ?? []) {
        const chosen = [...(picks.get(q.question) ?? [])];
        if (chosen.length) answers[q.question] = q.multiSelect ? chosen.join(', ') : chosen[0];
      }
      return { behavior: 'allow', updatedInput: { ...input, answers } };
    }
    return note === null ? { behavior: 'allow' } : { behavior: 'deny', message: note || 'Denied from Marble' };
  }
```

(`askResponse('permission', input, new Map(), null)` is Allow; any string is Deny.) Export it on `window.marbleAgentUI`.

In `receive()`:

```js
        case 'ask':
          this.endLive();
          this.ask(turn, event);
          break;
        case 'ask.answered':
        case 'ask.void':
          this.askClosed(turn, event);
          break;
```

Methods on the conversation element:

```js
    ask(turn, event) {
      const card = h('div', 'ask');
      card.dataset.request = event.requestId;
      card.dataset.kind = event.kind;
      const submit = async (response) => {
        for (const b of card.querySelectorAll('button')) b.disabled = true;
        try {
          await this.api.answer(turn, event.requestId, response);
        } catch (err) {
          for (const b of card.querySelectorAll('button')) b.disabled = false;
          this.system(err.message, true);
        }
      };
      if (event.kind === 'question') {
        const picks = new Map();
        for (const q of event.input?.questions ?? []) {
          card.append(h('div', 'ask-title', q.question));
          const list = h('div', 'ask-options');
          list.setAttribute('role', q.multiSelect ? 'group' : 'radiogroup');
          const set = new Set();
          picks.set(q.question, set);
          const buttons = (q.options ?? []).map((o, i) => {
            const b = h('button', '', o.description ? `${o.label} — ${o.description}` : o.label);
            b.type = 'button';
            b.setAttribute('role', q.multiSelect ? 'checkbox' : 'radio');
            b.setAttribute('aria-checked', 'false');
            b.tabIndex = i === 0 ? 0 : -1;
            b.addEventListener('click', () => {
              if (!q.multiSelect) { set.clear(); for (const x of buttons) x.setAttribute('aria-checked', 'false'); }
              const on = b.getAttribute('aria-checked') !== 'true';
              if (on) set.add(o.label); else set.delete(o.label);
              b.setAttribute('aria-checked', String(on));
            });
            b.addEventListener('keydown', (e) => {
              const idx = buttons.indexOf(b);
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const next = buttons[(idx + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
                for (const x of buttons) x.tabIndex = -1;
                next.tabIndex = 0;
                next.focus();
              } else if (e.key === ' ') { e.preventDefault(); b.click(); }
              else if (e.key === 'Enter') { e.preventDefault(); if (!set.size) b.click(); submit(askResponse('question', event.input, picks)); }
            });
            return b;
          });
          list.append(...buttons);
          card.append(list);
        }
        const actions = h('div', 'ask-actions');
        const answer = h('button', 'answer', 'Answer');
        answer.type = 'button';
        answer.addEventListener('click', () => submit(askResponse('question', event.input, picks)));
        actions.append(answer);
        card.append(actions);
      } else {
        card.append(h('div', 'ask-title', `Allow ${event.displayName || event.tool}?`));
        const detail = event.input?.command ?? event.input?.file_path ?? event.input?.path ?? event.input?.url ?? '';
        if (detail) card.append(h('pre', '', String(detail)));
        else card.append(h('div', 'tool', toolLabel(event.tool, event.input ?? {})));
        const actions = h('div', 'ask-actions');
        const allow = h('button', 'allow', 'Allow');
        allow.type = 'button';
        allow.addEventListener('click', () => submit(askResponse('permission', event.input, new Map(), null)));
        const note = document.createElement('input');
        note.className = 'deny-note';
        note.placeholder = 'Why not? (optional)';
        note.setAttribute('aria-label', 'Reason for denying');
        const deny = h('button', 'deny', 'Deny');
        deny.type = 'button';
        deny.addEventListener('click', () => submit(askResponse('permission', event.input, new Map(), note.value.trim())));
        actions.append(allow, deny, note);
        card.append(actions);
      }
      this.record(turn).asks ??= new Map();
      this.record(turn).asks.set(event.requestId, card);
      this.append(turn, card);
      card.querySelector('button')?.focus({ preventScroll: true });
    }

    askClosed(turn, event) {
      const card = this.record(turn).asks?.get(event.requestId);
      if (!card) return;
      card.remove();
      this.record(turn).asks.delete(event.requestId);
      if (event.type === 'ask.void' && event.why !== 'cancelled') this.system('The agent stopped waiting for that answer.');
    }
```

Drawer recent list (~line 3274): `const state = summary.asking ? 'Needs you' : summary.status === 'running' ? 'Running' : …`.

`templates/agents.mrbl`, where a row's `.badge` is painted (near line 2633, `el.querySelector('.badge').textContent = ''`): set it to `'Needs you'` when `summary.asking`, else the current value. In the board and Focus cards, apply the same one-liner wherever the row status text is derived from `statusOf(summary)`.

- [ ] **Step 4: Run the browser tests, then commit**

Run: `npm run test:browser -- test-browser/conversation.test.js test-browser/agents-page.test.js`
Expected: PASS

```bash
git add runtime/agent-ui.js templates/agents.mrbl test-browser/conversation.test.js test-browser/agents-page.test.js
git commit -m "Show asks as cards the person can answer, and say Needs you on the Agents page.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Project picker, project tag, Also working here, settings-panel projects

**Files:**
- Modify: `runtime/agent-ui.js` (`.setup` markup ~1199-1215, constructor queries ~1234-1250, `showPicker`, `load`, `start()` call ~1923, `conversationTags` ~626, `paintMast`, settings panel `fill()`/`save()` ~2585-2700), `templates/agents.mrbl` (its own `agent.start` at ~3206)
- Test: `test-browser/conversation.test.js`, `test-browser/agents-page.test.js`

**Interfaces:**
- Consumes: `marble.agent.projects/addProject/removeProject/start({ project })`, `summary.project`.
- Produces: `[data-seg="project"]` radios named `project`; element attribute `project` as the default pick; `conversationTags(summary, labels, projects)`; `.mast .also` line.

- [ ] **Step 1: Failing browser tests**

```js
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('a new conversation is started in the picked project, and the mast names it', async () => {
  const { page, view } = await mount();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-browser-repo-'));
  // Registered from the page so the request is same-origin, like the settings panel's.
  const repo = await page.evaluate((p) => window.marble.agent.addProject({ name: 'Repo', path: p }), dir);
  await view.evaluate((el) => el.fillProjects());
  await view.locator('input[name="project"][value="drive"]').waitFor();
  assert.equal(await view.locator('input[name="project"][value="drive"]').isChecked(), true);
  await view.locator(`input[name="project"][value="${repo.id}"]`).check();
  const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
  await sendFrom(view, 'script:rename');
  const id = await started;
  const meta = await page.evaluate((cid) => window.marble.agent.conversation(cid).then((r) => r.meta), id);
  assert.equal(meta.project, repo.id);
  await view.locator('.tag[data-kind="project"]', { hasText: 'Repo' }).waitFor();
  assert.equal(await view.locator('.picker-project').isVisible(), false, 'a started conversation cannot change project');
});

test('the mast counts other conversations running in the same project', async () => {
  const { page, view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const other = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake', project: 'drive' });
    await window.marble.agent.send(id, { prompt: 'script:hold', target: 'garden' });
    return id;
  });
  await sendFrom(view, 'script:slow');
  await view.locator('.mast .also', { hasText: 'Also working here: 1' }).waitFor();
  await page.evaluate((id) => window.marble.agent.cancel(`${id}-t1`), other);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:browser -- test-browser/conversation.test.js`
Expected: FAIL — no `input[name="project"]`.

- [ ] **Step 3: Composer segment**

Markup, after the `picker-agent` fieldset:

```html
            <fieldset class="seg picker-project">
              <legend>Project</legend>
              <div class="seg-opts" data-seg="project"></div>
            </fieldset>
```

Constructor: `this.projectBox = root.querySelector('[data-seg="project"]'); this.projectLabel = root.querySelector('.picker-project');`

```js
    async fillProjects(value = null) {
      let projects = [];
      try { projects = await this.api.projects(); } catch { projects = [{ id: 'drive', name: 'Drive' }]; }
      this.projectList = projects;
      const wanted = value ?? this.getAttribute('project') ?? (await this.api.settings().catch(() => ({}))).defaultProject ?? 'drive';
      fillRadios(this.projectBox, 'project', projects.map((p) => ({ id: p.id, label: p.name })), { empty: null, value: projects.some((p) => p.id === wanted) ? wanted : 'drive' });
      this.projectLabel.hidden = false;
      this.fitSetup();
    }
```

In `showPicker`, after `this.fillAgents(fallback?.id ?? '')`: `await this.fillProjects();`. In `load()` with an id: `this.projectLabel.hidden = true;`. In the `start()` call: `project: radioValue(this.shadowRoot, 'project') || 'drive',` and set `this.meta.project` likewise. The drawer, where it creates its `<marble-conversation>` (search `createElement('marble-conversation')` in the drawer class), sets `el.setAttribute('project', 'drive')`. `templates/agents.mrbl` line ~3206 passes nothing, so the Agents page inherits `settings.defaultProject`.

- [ ] **Step 4: Tag and Also working here**

`conversationTags = (summary, labels, projects = null)`; first line of the body:

```js
    if (summary?.project && summary.project !== 'drive') {
      tags.push({ kind: 'project', label: projects?.get?.(summary.project)?.name ?? summary.project, hue: 200 });
    }
```

`paintTags` passes `new Map((this.projectList ?? []).map((p) => [p.id, p]))`; `load()` must call `this.projectList = await this.api.projects().catch(() => [])` before `paintMast()`. The Agents page's card renderer calls `conversationTags(summary, labels)`; leave it, or pass its own project map if it already fetches projects.

Mast markup: add `<div class="also" hidden></div>` inside `.mast` after the tags; style `.mast .also { font-size: 11.5px; color: var(--faint); }`. In `load()` after subscribing to the conversation:

```js
      this.offAll?.();
      this.offAll = this.api.on('*', (summary) => {
        if (!summary?.id) return;
        this.others ??= new Map();
        this.others.set(summary.id, summary);
        this.paintAlso();
      });
```

```js
    paintAlso() {
      const id = this.getAttribute('conversation');
      const mine = this.meta?.project ?? 'drive';
      const rows = [...(this.others?.values() ?? [])].filter((s) => s.id !== id && !s.archived && (s.project ?? 'drive') === mine && (s.status === 'running' || s.running));
      this.also.hidden = !rows.length;
      this.also.textContent = rows.length ? `Also working here: ${rows.length} — ${rows.map((s) => s.title || 'Untitled').join(', ')}` : '';
    }
```

(`this.also = root.querySelector('.also')` in the constructor; `disconnectedCallback` calls `this.offAll?.()`.)

- [ ] **Step 5: Settings panel**

In `fill()` after the `keys` fieldset:

```js
      const projects = document.createElement('fieldset');
      projects.append(h('legend', '', 'Projects'));
      projects.append(h('p', 'hint', 'A full agent runs with your own Claude Code (or Cursor) configuration — your plugins, skills, hooks, MCP servers and permission rules — in the project you choose. It is exactly as capable, and as powerful, as the terminal.'));
      for (const p of await this.api.projects().catch(() => [])) {
        const row = h('div', 'project');
        row.append(h('span', 'name', p.name), h('code', 'path', p.path));
        if (!p.builtIn) {
          const remove = h('button', 'link', 'Remove');
          remove.type = 'button';
          remove.addEventListener('click', async () => {
            try { await this.api.removeProject(p.id); await this.fill(); } catch (err) { this.status.textContent = err.message; this.status.classList.add('error'); }
          });
          row.append(remove);
        }
        projects.append(row);
      }
      const add = h('div', 'project-add');
      const name = document.createElement('input'); name.placeholder = 'Name'; name.name = 'project-name';
      const dir = document.createElement('input'); dir.placeholder = '/absolute/path/to/repo'; dir.name = 'project-path';
      const button = h('button', 'link', 'Add project'); button.type = 'button';
      button.addEventListener('click', async () => {
        try { await this.api.addProject({ name: name.value.trim(), path: dir.value.trim() }); await this.fill(); } catch (err) { this.status.textContent = err.message; this.status.classList.add('error'); }
      });
      add.append(name, dir, button);
      projects.append(add);
      this.body.replaceChildren(agents, keys, projects);
```

Style `.project { display: flex; gap: 8px; align-items: baseline; }`, `.project code { font-size: 11.5px; color: var(--faint); overflow-wrap: anywhere; }`, `.project-add { display: flex; gap: 6px; flex-wrap: wrap; }`.

- [ ] **Step 6: Run and commit**

Run: `npm run test:browser` (all) and `npm test`
Expected: PASS

```bash
git add runtime/agent-ui.js templates/agents.mrbl test-browser/conversation.test.js test-browser/agents-page.test.js
git commit -m "Pick a project for a conversation, name it in the mast, and say who else is working there.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Docs and a live check

**Files:**
- Modify: `docs/AGENTS.md` (§"What a full agent can do", §"Providers" Claude rows, new §"Projects", new §"Asks", §"Storage"), `.env.example` (already done in Task 4)

- [ ] **Step 1: Rewrite "What a full agent can do"**

Replace that section's body with:

```markdown
Every provider runs at capability `full` unless it declares `documents` or
`MARBLE_DRIVE_AGENT_POWER=documents` is set.

A `full` Claude turn is the terminal's: `claude -p` with **no** `--restricted`
and no tool allowlist, so your user settings, plugins, skills, `CLAUDE.md`,
hooks, memory, MCP servers, subagents and permission rules all load exactly
as they do when you type `claude` yourself. Marble's document MCP server and
its browser MCP are added with `--mcp-config`, never in place of yours. The
working directory is the conversation's **project** (below). Permission
prompts and `AskUserQuestion` are routed to Marble (`--permission-prompts
host --permission-prompt-tool stdio`) and appear in the drawer as cards you
answer; the permission mode (`auto` by default, or `acceptEdits`, `plan`,
`manual`, `bypassPermissions`) decides what gets asked.

This is exactly as capable, and as powerful, as the terminal: the agent runs
as you, with your configuration, on your machine. The turn token is still
per turn and `MARBLE_DRIVE_SECRET` is still withheld from the child.
`MARBLE_DRIVE_AGENT_POWER=documents` is the rollback to the tools-only
boundary.

Cursor's file tools are pointed at the project with `--add-dir`; the shell's
cwd is the project; `--sandbox disabled`. Cursor has no host-answered prompt
channel, so it runs `--yolo` and asks its questions in text.
```

- [ ] **Step 2: Add "Projects" and "Asks"**

```markdown
## Projects

A conversation works in a project: the drive (always present, id `drive`) or
a directory you register once in the settings panel (`POST /agent/projects
{ name, path }`; absolute, existing, a directory, not the drive or its
`.marble`). The picker on a new conversation chooses it; it cannot change
afterwards. A full turn's cwd is the project path, so the CLI's own session
files and memory land where the terminal's do — `claude --resume` in a
terminal can pick up a Marble conversation. A removed or missing project
fails the next turn with a plain message.

Every turn's prompt says how many other conversations are running in the
same project and tells the agent not to stash, reset or discard changes it
did not make. Marble does not create git worktrees per conversation; the
skills you already use decide that.

## Asks

When the CLI needs the person — a permission prompt in `manual` or `auto`
mode, or `AskUserQuestion` — the runner records an `ask` event and the
conversation is marked `asking` (**Needs you** on the Agents page). The
drawer shows a card: Allow / Deny with an optional note, or the question's
options. `POST /agent/turns/:id/answer { requestId, response }` sends the
reply into the process. The stall timer is suspended while an ask is open;
Stop denies it; a process that ends first voids it. There is no timeout on
you.
```

- [ ] **Step 3: Limits in "Turning it on"**

```markdown
`MARBLE_DRIVE_AGENT_MAX_MINUTES` is `0` by default — no cap; a turn ends when
the agent finishes or you press Stop. `MARBLE_DRIVE_AGENT_STALL_MINUTES`
(30) ends a turn whose process prints nothing for that long and is not
waiting on you.
```

Update the Providers table's Claude rows to match §"What a full agent can do", and add `settings.projects`, `settings.defaultProject`, `settings.skills` to the Storage section.

- [ ] **Step 4: Live check, by hand (record the result in the commit body)**

With `MARBLE_DRIVE_AGENTS=1` and the host running, register the marble-drive repo as a project in the settings panel, start a Claude conversation in it from the Agents page in `manual` mode, and send: "Run `git status`, then use AskUserQuestion to ask me whether to summarise it as A) short or B) long, then load /superpowers:brainstorming and stop." Expect: a permission card for Bash (answer Allow), a question card (answer B), the skill loading in the transcript, and a completed turn with no cap. Then run `claude --resume <providerSession from meta.json>` in the repo in a terminal and confirm the conversation continues.

- [ ] **Step 5: Commit**

```bash
git add docs/AGENTS.md
git commit -m "Document projects, asks, the terminal-parity boundary and the new limits.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** §4 projects → Tasks 2, 3, 4, 9. §4.4 prompt context and "other conversations" → Task 4. §4.5 ownership → Task 1. §5 spawn, modes, models, parse, skills from init → Task 5 (route and menu in Task 7). §6 asks → Tasks 6 and 8. §7 limits → Tasks 4 and 6. §8 surfaces → Tasks 8 and 9. §9 Cursor → Tasks 4 and 5. §10 instructions → Task 5. §11 copy → Tasks 9 and 10. §13 tests → each task; the live check in Task 10.

**Placeholders.** Task 8's Agents-page test and Task 9's harness helper describe the file's own conventions rather than repeating code the implementer must read anyway; every other step is complete.

**Type consistency.** `kind: 'drive' | 'project'` is the name in the runner, both providers, `instructionsFor`, and the tests. `stdinOpen` is read by the runner and set by both the Claude and fake providers. `ask` event fields (`requestId, kind, tool, displayName, input, interactive`) match parse, runner, fake provider, and the UI. `runner.answer` throws `{ status }` and the route forwards it. `summary.asking` is read by the drawer, the Agents page, and the HTTP test.
