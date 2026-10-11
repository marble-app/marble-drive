# Full Code Expression for Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Marble agents the terminal toolbelt — `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash` — rooted at the drive, instead of five MCP tools and nothing else.

**Architecture:** Claude is spawned with `--restricted` (which confines its file tools to the working directory and ignores this machine's settings) plus `--tools` naming Bash, with `cwd` set to the drive root instead of an empty workspace. The Marble MCP tools stay for ops-based surgery. Because `server/app.js` already snapshots every outside write via `store.mark(…, 'pre-external')` and patches open tabs, undo and live reconcile need only be wired up, not invented; the watchdog's premise — "an agent's own work never reaches this branch" — is inverted so a turn's own writes are attributed to it rather than flagged.

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict`, no test framework. Claude Code CLI 2.1.274.

**Spec:** [`docs/superpowers/specs/2026-09-17-agent-full-code-expression-design.md`](../specs/2026-09-17-agent-full-code-expression-design.md)

## Global Constraints

- **Node ESM throughout.** `import`, no `require`. Every new file gets a comment header explaining *why* it exists, matching the house style in `server/agent/*.js`.
- **Tests:** `npm test` runs `node --test "test/**/*.test.js"`. Browser tests are `npm run test:browser`. Never add a test framework.
- **Two capabilities, exact strings:** `'full'` and `'documents'`.
- **Env var, exact name:** `MARBLE_DRIVE_AGENT_POWER`. Only the value `documents` has an effect; anything else (including unset) leaves providers at their declared capability.
- **The tool list, verbatim and in this order:** `Bash,Read,Write,Edit,Glob,Grep,TodoWrite`
- **The workspace stays outside the drive.** `agentsAllowed` already refuses a workdir inside the drive; nothing in this plan may weaken that. `mcp.json` and the new `settings.json` are both written there at mode `0600` via `writePrivateFile`.
- **Never remove the `documents` path.** Cursor depends on it.
- **Commit after every task.** End commit messages with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XEpmpmc5UXX45AbVmitNA9
  ```

---

## File Structure

| File | Responsibility |
|---|---|
| `server/agent/capability.js` | **Create.** Resolve a provider's effective capability against `MARBLE_DRIVE_AGENT_POWER`. One exported function, no I/O. |
| `server/agent/providers/claude.js` | **Modify.** Declare `capability: 'full'`; branch `spawn()` and `prepare()` on the requested capability. |
| `server/agent/providers/cursor.js` | **Modify.** Declare `capability: 'documents'`. No behaviour change. |
| `server/agent/runner.js` | **Modify.** Pass capability + drive root into `spawn`/`prepare`; honour `spec.cwd`; apply `spec.sandbox`; record touched documents. |
| `server/agent/instructions.js` | **Modify.** Two instruction strings — one per capability. |
| `server/agent/tools.js` | **Modify.** Add `check_document`. |
| `server/app.js` | **Modify.** Invert the watchdog branch: attribute drive changes to a running turn. |
| `server/config.js` | **Modify.** Read `MARBLE_DRIVE_AGENT_POWER`. |
| `test/agent-capability.test.js` | **Create.** Capability resolution. |
| `test/fixtures/fake-provider.js` | **Modify.** Let the fake provider declare a capability and write files directly. |

**Task order rationale:** Task 1 is pure logic with no callers. Task 2 changes the spawn but is still inert until Task 3 gives it a `cwd`. Task 4 (attribution) must land before Task 5 (undo), because undo consumes the events attribution produces.

---

### Task 1: Capability resolution

**Files:**
- Create: `server/agent/capability.js`
- Create: `test/agent-capability.test.js`
- Modify: `server/config.js:119-128`

**Interfaces:**
- Produces: `effectiveCapability(provider, { power }) → 'full' | 'documents'` — `provider` is any object with an optional `capability` string; `power` is the raw env value or `undefined`. Later tasks call this in `runner.js` and in the routes that report provider state.
- Produces: `config.agentPower` — the raw string from `MARBLE_DRIVE_AGENT_POWER`, or `''`.

- [ ] **Step 1: Write the failing test**

Create `test/agent-capability.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { effectiveCapability } from '../server/agent/capability.js';

test('a provider runs at the capability it declares', () => {
  assert.equal(effectiveCapability({ capability: 'full' }, {}), 'full');
  assert.equal(effectiveCapability({ capability: 'documents' }, {}), 'documents');
});

test('a provider that declares nothing is a documents provider', () => {
  assert.equal(effectiveCapability({}, {}), 'documents');
  assert.equal(effectiveCapability({ capability: 'nonsense' }, {}), 'documents');
});

test('MARBLE_DRIVE_AGENT_POWER=documents holds every provider down', () => {
  assert.equal(effectiveCapability({ capability: 'full' }, { power: 'documents' }), 'documents');
});

test('any other value of the switch leaves the provider alone', () => {
  for (const power of ['', 'full', 'yes', undefined]) {
    assert.equal(effectiveCapability({ capability: 'full' }, { power }), 'full', `power=${power}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="capability"`
Expected: FAIL — `Cannot find module '.../server/agent/capability.js'`

- [ ] **Step 3: Write the implementation**

Create `server/agent/capability.js`:

```js
// What a provider is allowed to be, this run.
//
// A provider declares what it can do; the host decides what it may do. The two
// are separate because the answer has to survive one provider being upgraded
// (Claude, here) while another is not (Cursor's boundary is a hook that cannot
// express this yet), and because a drive owner needs one switch that holds
// everything down without editing any adapter.

export const CAPABILITIES = ['documents', 'full'];

/** A provider's capability, after the host's switch has had its say. Anything
 *  unrecognised is `documents`: the narrower answer is the safe one to guess. */
export function effectiveCapability(provider, { power } = {}) {
  const declared = CAPABILITIES.includes(provider?.capability) ? provider.capability : 'documents';
  return power === 'documents' ? 'documents' : declared;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="capability"`
Expected: PASS, 4 tests

- [ ] **Step 5: Wire the config switch**

In `server/config.js`, in the object that already holds `agents`/`agentProvider` (around line 119), add after the `agentProvider` line:

```js
    // One switch that holds every provider down to the 2026-09-16 boundary,
    // whatever each adapter declares. The rollback, if a full turn goes wrong.
    agentPower: str('MARBLE_DRIVE_AGENT_POWER', ''),
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS — no existing test reads `agentPower`, so nothing should change.

- [ ] **Step 7: Commit**

```bash
git add server/agent/capability.js test/agent-capability.test.js server/config.js
git commit -m "Agents: a provider declares a capability, the host can hold it down

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEpmpmc5UXX45AbVmitNA9"
```

---

### Task 2: Two instruction sets

**Files:**
- Modify: `server/agent/instructions.js` (whole file)
- Modify: `test/agent-provider-claude.test.js:9` (import)

**Interfaces:**
- Consumes: nothing.
- Produces: `instructionsFor(capability) → string`. `INSTRUCTIONS` stays exported and unchanged in value, so existing imports keep working; it is what `instructionsFor('documents')` returns.

**Why this task is separate:** the current text opens with *"There are no file or shell tools"*, which becomes a lie the moment Task 3 lands. Getting the text right before the spawn changes means no commit in this sequence ships an agent being told the opposite of the truth.

- [ ] **Step 1: Write the failing test**

Append to `test/agent-provider-claude.test.js`:

```js
test('each capability is told the truth about its own tools', async () => {
  const { instructionsFor, INSTRUCTIONS } = await import('../server/agent/instructions.js');

  assert.equal(instructionsFor('documents'), INSTRUCTIONS);
  assert.match(instructionsFor('documents'), /There are no file or shell tools/);

  const full = instructionsFor('full');
  assert.doesNotMatch(full, /There are no file or shell tools/);
  assert.match(full, /data-marble-id/, 'a full agent still has to keep ids');
  assert.match(full, /apply_ops/, 'ops are still the right tool for a live document');
  assert.match(full, /Grep/, 'it must be steered off Read on a 3 MB document');
  assert.match(full, /check_document/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="told the truth"`
Expected: FAIL — `instructionsFor is not a function`

- [ ] **Step 3: Write the implementation**

Replace the whole of `server/agent/instructions.js`:

```js
// What every agent is told, whichever CLI it runs in. Claude gets it as an
// appended system prompt and Cursor as the workspace's AGENTS.md; there is one
// copy so the two cannot drift.
//
// There are two, because there are two boundaries. A `documents` agent has the
// five MCP tools and nothing else. A `full` agent has its own file and shell
// tools, confined to the drive, and needs telling what that costs: a document
// is not a text file, and an id it drops is a link somebody loses.
//
// Nothing depends on an agent obeying either one. The tools refuse what the
// rules forbid; the rules are here so an agent stops trying.

export const INSTRUCTIONS = `You are working inside Marble Drive. Every document is one HTML file, and every element you can change carries a data-marble-id attribute. You can only act on documents through these tools: list_documents, read_document, apply_ops, create_document and read_guide. There are no file or shell tools.

How to work:
- Read before you edit. apply_ops refuses to change an element this conversation has not seen in full. read_document with no ids gives you the whole document, or an outline of a large one; read_document with ids gives the full source of those elements.
- Edit with small ops: setText, setInner, setAttr, insert, move, remove, at most 24 per apply_ops call, each addressed by data-marble-id — for example {"type":"setText","id":"<data-marble-id>","text":"New text"}. Never invent an id for an element you were not shown. Elements you insert get ids minted for you.
- If apply_ops is refused because an element changed since you read it, the person has edited it. The refusal includes its current source: rebuild your change against that source and call apply_ops again. Do not overwrite their work.
- You may only change the document you were asked about and documents you create in this turn. You may read any document.
- If you are unsure how an op or an affordance works, call read_guide.

When you finish, reply with a short plain-language summary of what you changed.`;

export const FULL_INSTRUCTIONS = `You are working inside Marble Drive, at a shell rooted at the drive. Your working directory is the drive itself, and your file tools reach nothing outside it.

You have your usual tools — Read, Write, Edit, Glob, Grep, Bash — and Marble's tools as well: list_documents, read_document, apply_ops, create_document, check_document and read_guide.

What a document is:
- One .mrbl file, which is one HTML file.
- Every addressable element carries a data-marble-id attribute. Those ids are how links, selections, comments and history find an element. **Preserve them when you rewrite a file.** An id you drop or renumber is a link somebody loses and a restore point that no longer lands. Add new elements without ids only if you then let Marble mint them.
- Call check_document after rewriting a document. It reports the format's own invariants and will tell you what you broke.

Which tool to use:
- **apply_ops** for a small, precise change to a document someone is looking at right now. It patches their open page at element granularity rather than reloading it, and it is refused rather than clobbering if they edited that element since you read it.
- **Write / Edit** to restructure or rewrite a document, and for any file that is not a document.
- **Bash** to run, test and check your work. Prefer it over guessing.

Documents are big — often one to three megabytes. Do not open one with Read. Use Grep, sed or read_document (which outlines a large document instead of dumping it) to find your way, and read only the parts you need.

Scope: your file tools are confined to the drive. Your shell is not — be careful, and stay inside the drive unless you were asked to leave it.

When you finish, reply with a short plain-language summary of what you changed.`;

/** The text for a capability. Anything unrecognised gets the narrower one. */
export const instructionsFor = (capability) =>
  capability === 'full' ? FULL_INSTRUCTIONS : INSTRUCTIONS;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="told the truth"`
Expected: PASS

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — `INSTRUCTIONS` is unchanged in value, so the existing spawn test still matches.

- [ ] **Step 6: Commit**

```bash
git add server/agent/instructions.js test/agent-provider-claude.test.js
git commit -m "Agents: instructions for an agent that has its own tools

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEpmpmc5UXX45AbVmitNA9"
```

---

### Task 3: The full spawn

**Files:**
- Modify: `server/agent/providers/claude.js:100-183`
- Modify: `test/agent-provider-claude.test.js`

**Interfaces:**
- Consumes: `instructionsFor(capability)` (Task 2); `writePrivateFile(file, text)` from `./private-file.js`.
- Produces: `provider.capability === 'full'`; `spawn({ …, capability, cwd })` returns `{ command, args, env, stdin, cwd }` — the new `cwd` member is what Task 4's runner change reads. `prepare({ …, capability })` writes `settings.json` beside `mcp.json` when capability is `'full'`.

**Note for the implementer:** the runner currently spawns with `cwd: workspace` and ignores anything the provider says about a directory. This task only *returns* `cwd`; Task 4 makes the runner honour it. That split is deliberate — it keeps this task's test a pure unit test with no runner in it.

- [ ] **Step 1: Write the failing test**

Append to `test/agent-provider-claude.test.js`:

```js
test('a full-capability spawn is confined, tooled, and prompt-free', async () => {
  const { instructionsFor } = await import('../server/agent/instructions.js');
  const sub = createClaudeProvider({ auth: 'subscription', env: {} });
  assert.equal(sub.capability, 'full');

  const spec = sub.spawn({
    workspace: '/w', prompt: 'Rewrite it', capability: 'full', cwd: '/drive', env: { PATH: '/bin' },
  });

  assert.equal(spec.cwd, '/drive', 'a full agent runs in the drive, not the workspace');
  assert.deepEqual(spec.args, [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--restricted',
    '--tools', 'Bash,Read,Write,Edit,Glob,Grep,TodoWrite',
    '--settings', path.join('/w', 'settings.json'),
    '--permission-prompts', 'none',
    '--strict-mcp-config', '--mcp-config', path.join('/w', 'mcp.json'),
    '--append-system-prompt', instructionsFor('full'),
  ]);
  assert.ok(!spec.args.includes('--setting-sources'), '--restricted already sheds this machine settings');
  assert.ok(!spec.args.includes('--dangerously-skip-permissions'));
});

test('a documents-capability spawn is exactly what it was before', () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: {} });
  const before = sub.spawn({ workspace: '/w', prompt: 'x', env: {} });
  const asked = sub.spawn({ workspace: '/w', prompt: 'x', capability: 'documents', cwd: '/drive', env: {} });
  assert.deepEqual(asked.args, before.args, 'the old boundary is untouched by the new one');
  assert.ok(asked.args.includes('--tools') && asked.args[asked.args.indexOf('--tools') + 1] === '');
  assert.equal(asked.cwd, undefined, 'a documents agent still runs in its empty workspace');
});

test('prepare writes a private settings.json only for a full turn', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-full-'));
  const mcp = { command: 'node', args: ['/bridge.js'], env: { MARBLE_AGENT_TOKEN: 't' } };

  await createClaudeProvider().prepare({ workspace, mcp, meta: {}, capability: 'full' });
  const file = path.join(workspace, 'settings.json');
  const stat = await fsp.stat(file);
  assert.equal(stat.mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), {
    permissions: { allow: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite'] },
  });

  const other = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-docs-'));
  await createClaudeProvider().prepare({ workspace: other, mcp, meta: {}, capability: 'documents' });
  await assert.rejects(fsp.stat(path.join(other, 'settings.json')), { code: 'ENOENT' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="full-capability spawn"`
Expected: FAIL — `sub.capability` is `undefined`

- [ ] **Step 3: Write the implementation**

In `server/agent/providers/claude.js`, replace the `INSTRUCTIONS` import:

```js
import { instructionsFor } from '../instructions.js';
```

Add below the `CLAUDE_EFFORTS` line:

```js
// Named once. `--restricted` confines these to the working directory; Bash is
// in the list because `--restricted` drops code-running tools unless it is.
const FULL_TOOLS = 'Bash,Read,Write,Edit,Glob,Grep,TodoWrite';
const FULL_SETTINGS = { permissions: { allow: FULL_TOOLS.split(',') } };
```

Add `capability: 'full',` to the returned provider object, immediately after the `label:` line.

Replace `prepare` with:

```js
    async prepare({ workspace, mcp, skills = [], capability = 'documents' }) {
      const config = { mcpServers: { marble: { command: mcp.command, args: mcp.args, env: mcp.env } } };
      // The token in here is good for one turn, and nobody else's business.
      await writePrivateFile(path.join(workspace, 'mcp.json'), JSON.stringify(config, null, 2));
      // `--restricted` refuses bypassPermissions and ignores this machine's
      // settings, so the only way a headless turn never stops on a prompt is
      // an allow-list it is handed explicitly.
      if (capability === 'full') {
        await writePrivateFile(path.join(workspace, 'settings.json'), JSON.stringify(FULL_SETTINGS, null, 2));
      }
      if (skills.length) {
        const { installSkills } = await import('../skills.js');
        await installSkills(workspace, skills);
      }
    },
```

Replace `spawn` with:

```js
    spawn({ workspace, prompt, resume = null, model = null, effort = null, capability = 'documents', cwd = null }) {
      const current = live();
      const full = capability === 'full';
      const args = [
        '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        ...(full
          ? [
              // Confines the file tools to the working directory — the drive —
              // and ignores this machine's user, project and local settings,
              // which is what `--setting-sources project` was here for.
              '--restricted',
              '--tools', FULL_TOOLS,
              '--settings', path.join(workspace, 'settings.json'),
              // Anything the allow-list does not cover is denied, not left
              // hanging: nobody is here to answer a prompt.
              '--permission-prompts', 'none',
              '--strict-mcp-config', '--mcp-config', path.join(workspace, 'mcp.json'),
            ]
          : [
              '--tools', '', '--strict-mcp-config', '--mcp-config', path.join(workspace, 'mcp.json'),
              '--allowedTools', 'mcp__marble', '--setting-sources', 'project',
            ]),
        '--append-system-prompt', instructionsFor(capability),
      ];
      if (model) args.push('--model', model);
      if (effort) args.push('--effort', effort);
      if (resume) args.push('--resume', resume);
      // Without a key the CLI would fall back to the login, and bill the
      // subscription for a conversation someone chose to put on the API.
      if (api && !current.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is not set, so Claude (API key) cannot run — set it or choose Claude');
      }
      return {
        command: 'claude',
        args,
        env: api ? { ANTHROPIC_API_KEY: current.ANTHROPIC_API_KEY } : {},
        stdin: prompt,
        // A full agent works in the drive. A documents agent keeps its empty
        // workspace, where its own tools — if any ever got through — find
        // nothing.
        ...(full && cwd ? { cwd } : {}),
      };
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="capability spawn|private settings"`
Expected: PASS, 3 tests

- [ ] **Step 5: Declare Cursor's capability**

In `server/agent/providers/cursor.js`, add `capability: 'documents',` immediately after the returned object's `label:` line, with this comment above it:

```js
    // Cursor's boundary is a preToolUse hook that sees a tool's name but not
    // which MCP server it came from. That cannot express "your own tools, but
    // only inside the drive", so Cursor stays where it was until it can.
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS — the pre-existing spawn test asserts the documents args, which are byte-identical.

- [ ] **Step 7: Commit**

```bash
git add server/agent/providers/claude.js server/agent/providers/cursor.js test/agent-provider-claude.test.js
git commit -m "Agents: Claude spawns confined to the drive with its own tools

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEpmpmc5UXX45AbVmitNA9"
```

---

### Task 4: The runner honours cwd, capability, and the sandbox seam

**Files:**
- Modify: `server/agent/runner.js:196-220`
- Modify: `server/agent/index.js:130-155` (pass `root` and `power` into the runner)
- Modify: `test/fixtures/fake-provider.js`
- Modify: `test/agent-http.test.js`

**Interfaces:**
- Consumes: `effectiveCapability` (Task 1); `spec.cwd` (Task 3).
- Produces: `createRunner({ …, driveRoot, power, sandbox })`. `sandbox` is `null` or `({ command, args, cwd }) → { command, args }`; it is the seam §10.1 of the spec owes to the deferred OS sandbox. The runner passes `capability` and `cwd` into both `provider.prepare` and `provider.spawn`.

- [ ] **Step 1: Write the failing test**

Create `test/agent-runner-capability.test.js`. A separate file, not an append to `agent-http.test.js`: that file builds **one** module-level host and shares it across every test, so a case needing a different provider or a different `MARBLE_DRIVE_AGENT_POWER` cannot live there.

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-cap-root-'));
const WORK = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-cap-work-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

const quiet = { log() {}, error() {} };
const SOURCE = '<!doctype html>\n<html><body data-marble-id="b"><h1 data-marble-id="h">Hi</h1></body></html>\n';

/** A host with one fake provider, watched so the test can see how it was spawned. */
async function hostWith({ capability, power = '', sandbox = null } = {}) {
  const root = await fsp.mkdtemp(path.join(ROOT, 'd-'));
  const seen = [];
  const provider = createFakeProvider({ scripts: { noop: [{ say: 'done' }] } });
  if (capability) provider.capability = capability;
  const spawn = provider.spawn.bind(provider);
  provider.spawn = (opts) => {
    seen.push({ capability: opts.capability, cwd: opts.cwd });
    const spec = spawn(opts);
    return opts.capability === 'full' && opts.cwd ? { ...spec, cwd: opts.cwd } : spec;
  };

  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_AGENTS: '1',
    MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
    MARBLE_DRIVE_AGENT_WORKDIR: await fsp.mkdtemp(path.join(WORK, 'w-')),
    MARBLE_DRIVE_AGENT_POWER: power,
  });
  const drive = await createDrive(config, {
    log: quiet,
    agentProviders: new Map([['fake', provider]]),
    agentSandbox: sandbox,
  });
  await drive.createDocument('notes', SOURCE);
  return { drive, config, seen, root };
}

/** Run one turn and wait for it to leave the runner. */
async function runTurn(drive, prompt = 'script:noop') {
  const conversation = await drive.agents.store.createConversation({ provider: 'fake' });
  const { turnId } = await drive.agents.runner.submit(conversation.id, {
    prompt,
    context: { target: 'notes', viewing: 'notes', selection: [] },
  });
  await drive.agents.runner.live?.(turnId)?.ended ?? null;
  for (let i = 0; i < 200 && drive.agents.runner.running().length; i += 1) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return { conversationId: conversation.id, turnId };
}

test('a full provider is spawned rooted at the drive', async () => {
  const { drive, config, seen } = await hostWith({ capability: 'full' });
  await runTurn(drive);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].capability, 'full');
  assert.equal(seen[0].cwd, config.root, 'a full turn is rooted at the drive');
  await drive.close();
});

test('a documents provider keeps its empty workspace', async () => {
  const { drive, seen } = await hostWith({ capability: 'documents' });
  await runTurn(drive);
  assert.equal(seen[0].capability, 'documents');
  assert.equal(seen[0].cwd, null, 'no drive cwd is offered to a documents turn');
  await drive.close();
});

test('MARBLE_DRIVE_AGENT_POWER=documents holds a full provider down', async () => {
  const { drive, seen } = await hostWith({ capability: 'full', power: 'documents' });
  await runTurn(drive);
  assert.equal(seen[0].capability, 'documents');
  assert.equal(seen[0].cwd, null);
  await drive.close();
});

test('the sandbox seam sees the spawn and may rewrite it', async () => {
  const wrapped = [];
  const sandbox = ({ command, args, cwd }) => {
    wrapped.push({ command, cwd });
    return { command, args };
  };
  const { drive, config } = await hostWith({ capability: 'full', sandbox });
  await runTurn(drive);
  assert.equal(wrapped.length, 1, 'the seam saw the spawn');
  assert.equal(wrapped[0].cwd, config.root, 'and is told where it will run');
  await drive.close();
});
```

**Before writing this, verify three names against the code** rather than trusting them: `drive.agents.store.createConversation`, `drive.agents.runner.submit` and `drive.agents.runner.running` (the last is real — `test/agent-http.test.js:309` uses it). If `submit`/`createConversation` are named differently, drive the turn over HTTP the way `agent-http.test.js` does with its `start()` helper instead; the assertions are unchanged either way. Also confirm `createDrive` accepts an `agentSandbox` option — it does not yet, and Step 4 adds it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="runs in the drive"`
Expected: FAIL — `seen[0].capability` is `undefined`

- [ ] **Step 3: Implement in the runner**

In `server/agent/runner.js`, add to the `createRunner({ … })` destructured parameters:

```js
  driveRoot,
  power = '',
  sandbox = null,
```

Add the import at the top:

```js
import { effectiveCapability } from './capability.js';
```

In `start(turn)`, replace the `await provider.prepare?.(…)` line and the `spawn(…)` call. The block from `await fsp.mkdir(workspace…)` through `const child = spawn(…)` becomes:

```js
      await fsp.mkdir(workspace, { recursive: true });
      const capability = effectiveCapability(provider, { power });
      turn.capability = capability;
      await provider.prepare?.({ workspace, mcp, meta, skills, capability });
      const prompt = await composePrompt(turn, meta);

      // Cancel (or a host shutdown) can land anywhere in the awaits above,
      // before there is any child to kill. Check here, the last point before
      // a process would actually start, rather than leave it running unwanted.
      if (turn.cancelled) return safeFinish(turn, turn.cancelled);
      if (closed) return safeFinish(turn, { status: 'cancelled', error: 'host closing' });

      const base = { ...pickEnv(process.env), ...mcp.env };
      const spec = provider.spawn({
        workspace,
        mcp,
        prompt,
        resume: meta.providerSession,
        model: meta.model,
        effort: meta.effort,
        env: base,
        capability,
        cwd: capability === 'full' ? driveRoot : null,
      });

      // The runner builds the environment, not the provider: a provider that
      // returns none gets the allowlist rather than Node's default of
      // everything this host has, and the drive's secret never goes, whoever
      // asks for it.
      const env = { ...base, ...(spec.env ?? {}) };
      delete env.MARBLE_DRIVE_SECRET;

      // A full agent's own tools are confined to its working directory, so the
      // working directory is the boundary: the drive for a full turn, the empty
      // workspace for every other. The seam below is where an OS sandbox goes
      // when one is written (spec §10.1); until then it is null and this is a
      // plain spawn.
      const cwd = spec.cwd ?? workspace;
      const launch = sandbox ? sandbox({ command: spec.command, args: spec.args, cwd }) : spec;
      const child = spawn(launch.command, launch.args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
```

- [ ] **Step 4: Pass the drive root, the switch, and the seam in**

In `server/agent/index.js`, inside `boot(…)`, add to the `createRunner({ … })` call, after `workdir: config.agentWorkdir,`:

```js
    driveRoot: config.root,
    power: config.agentPower,
    sandbox,
```

Thread `sandbox` through: add it to `createAgents({ … })`'s destructured parameters and to `boot({ … })`'s, defaulting to `null` in `createAgents`, and pass it from `boot`'s call site. Then in `server/app.js`, where `createAgents({ … })` is called, pass the option through from `createDrive`'s own options object — find the existing `agentProviders` option and add `agentSandbox` beside it:

```js
      sandbox: options.agentSandbox ?? null,
```

This is the only reason `agentSandbox` exists as a `createDrive` option: a test needs to observe the seam, and the deferred OS sandbox (spec §10.1) will need to supply one. Nothing in production passes it yet.

- [ ] **Step 5: Run the tests**

Run: `npm test -- --test-name-pattern="runs in the drive|holds a full provider down|sandbox seam"`
Expected: PASS, 3 tests

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. The fake provider declares no capability, so every existing test resolves to `documents` and keeps `cwd: workspace`.

- [ ] **Step 7: Commit**

```bash
git add server/agent/runner.js server/agent/index.js test/fixtures/fake-provider.js test/agent-http.test.js
git commit -m "Agents: a full turn runs rooted at the drive, behind a sandbox seam

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEpmpmc5UXX45AbVmitNA9"
```

---

### Task 5: Attribution — a turn's own writes stop being intrusions

**Files:**
- Modify: `server/app.js:786-800`
- Modify: `server/agent/runner.js:424-430` (the `watchdog` method)
- Modify: `server/agent/index.js:166`
- Modify: `test/agent-http.test.js`

**Interfaces:**
- Consumes: `turn.capability` (set by Task 4).
- Produces: `runner.documentTouched(docPath, sha) → boolean` — a **new** method beside `runner.watchdog(docPath, sha)`, which keeps its current behaviour. Returns `true` when a turn running at capability `full` claimed the change (and emitted `document.changed`), `false` otherwise, in which case `app.js` falls through to the watchdog. The event carries `{ type: 'document.changed', path, sha }`.

**Background the implementer needs:** `server/app.js` around line 786 handles a document that changed on disk without the host writing it. It already calls `store.mark(docPath, prior.source, 'pre-external')`, recording a restore point of the *previous* content. Its comment says *"Every agent writes through ops, so an agent's own work never reaches this branch."* After Task 3 that is false **for a full turn**: its `Write` lands here every time, and left alone every full turn trips its own watchdog.

**It stays true for a documents turn**, which writes only through ops — so that turn must keep being flagged. This is not a nicety: `test/agent-http.test.js:307` ("a document changed outside Marble during a turn is flagged, with a way back") writes to `watched.mrbl` during a turn on the **fake** provider, which declares no capability and therefore resolves to `documents`. Claiming changes for every running turn would break that test, and would be wrong. **Only claim for `full`.**

- [ ] **Step 1: Write the failing test**

First give the fake agent a way to write a file directly. In `test/fixtures/fake-agent.mjs`, add an import and a step, so a script can do what a full agent does — bypass MCP entirely:

```js
import fsp from 'node:fs/promises';
```

and inside the `for (const step of script)` loop, beside the `step.call` branch:

```js
  // What a full agent does that a documents agent cannot: write the file
  // itself, with no op and no bridge. The host hears it from the watcher.
  if (step.write) {
    await fsp.writeFile(step.write.file, step.write.text);
    out({ kind: 'text', text: `wrote ${step.write.file}` });
  }
```

Then add to `test/agent-runner-capability.test.js` (the file created in Task 4, which already has `hostWith` and `runTurn`):

```js
/** Wait for `check()` to return truthy, or fail. The watcher debounces ~80 ms. */
const until = async (check, ms = 5_000) => {
  for (let waited = 0; waited < ms; waited += 40) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('timed out');
};

test('a document a full turn writes itself is its work, not an intrusion', async () => {
  const { drive, root } = await hostWith({ capability: 'full' });
  const file = path.join(root, 'notes.mrbl');
  const script = [
    { write: { file, text: SOURCE.replace('Hi', 'Rewritten by the agent') } },
    { sleep: 400 }, // let the watcher's 80 ms debounce fire before the turn ends
  ];
  drive.agents.runner.providers?.get('fake'); // no-op; scripts are keyed by prompt

  const { conversationId } = await runTurnWithScript(drive, script);
  const events = await drive.agents.store.events(conversationId);
  const kinds = events.map((e) => e.type);

  assert.ok(kinds.includes('document.changed'), 'the turn recorded what it touched');
  assert.ok(!kinds.includes('watchdog'), 'and was not flagged for its own writing');
  const changed = events.find((e) => e.type === 'document.changed');
  assert.equal(changed.path, 'notes');
  assert.ok(changed.sha, 'the restore point taken just before the write travels with it');
  await drive.close();
});

test('a documents turn is still flagged when a document changes under it', async () => {
  const { drive, root } = await hostWith({ capability: 'documents' });
  const file = path.join(root, 'notes.mrbl');
  const script = [{ sleep: 1200 }];
  const running = runTurnWithScript(drive, script);
  await until(() => drive.agents.runner.running().length === 1);
  await fsp.writeFile(file, SOURCE.replace('Hi', 'Scribbled from outside'));

  const { conversationId } = await running;
  const events = await drive.agents.store.events(conversationId);
  assert.ok(events.some((e) => e.type === 'watchdog'), 'a documents turn writes only ops, so this is an intrusion');
  assert.ok(!events.some((e) => e.type === 'document.changed'));
  await drive.close();
});
```

`runTurnWithScript(drive, script)` is `runTurn` with the script passed through: extend `hostWith` so its provider's `scripts` map can be added to after construction (the fake provider reads `scripts[name]` at spawn time, so mutating the object the test passed in is enough), and have `runTurnWithScript` register the script under a fresh name and submit `script:<name>`.

**Verify `drive.agents.store.events(conversationId)` exists** before relying on it; `agent-http.test.js` reads events through `GET /agent/conversations/:id` (`body.events`), which is the fallback if the store method is named differently.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="not an intrusion"`
Expected: FAIL — the event is `watchdog`, not `document.changed`

- [ ] **Step 3: Implement in the runner**

In `server/agent/runner.js`, **leave `watchdog(docPath, sha)` exactly as it is** and add this method beside it:

```js
    /** A document changed on disk without this host writing it.
     *
     *  A `full` turn has its own file tools, so while one is running this is
     *  almost always that turn: it is recorded as the turn's work, with the
     *  restore point just taken, rather than flagged. A `documents` turn writes
     *  only through ops, so a change under it is what the watchdog was written
     *  for and is left to it. Answers whether a turn took this one.
     *
     *  The cost, accepted in spec §6: your own edit during a full turn is filed
     *  under that turn. You do not lose it — it is in the turn's change list
     *  with its restore point — but the turn gets the credit. Flagging every
     *  full turn instead would make the flag noise. */
    documentTouched(docPath, sha) {
      let claimed = false;
      for (const turn of runningTurns()) {
        if (turn.capability !== 'full') continue;
        turn.touched.set(docPath, turn.touched.get(docPath) ?? sha);
        turn.onEvent({ type: 'document.changed', path: docPath, sha });
        claimed = true;
      }
      return claimed;
    },
```

In the turn object literal (around line 124, beside `watchdog: false`), add:

```js
      // docPath → the restore point taken before this turn first changed it.
      // First write wins: undo wants where the document started, not its last step.
      touched: new Map(),
```

- [ ] **Step 4: Implement in the host**

In `server/agent/index.js`, add a line beside the existing `watchdog:` line of the returned object — keep both:

```js
    watchdog: (docPath, sha) => runner.watchdog(docPath, sha),
    documentTouched: (docPath, sha) => runner.documentTouched(docPath, sha),
```

In `server/app.js`, replace the `if (prior) { … }` block at ~line 789:

```js
    if (prior) {
      await store.mark(docPath, prior.source, 'pre-external');
      // A full agent writes with its own file tools, so an agent's own work
      // reaches this branch constantly and a running turn claims it (spec §6).
      // What nobody claims is what this branch was written for: you, in an
      // editor, while a turn happens to be running.
      const claimed = agents?.documentTouched(docPath, shaOf(prior.source));
      if (!claimed) agents?.watchdog(docPath, shaOf(prior.source));
    }
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- --test-name-pattern="intrusion|watchdog"`
Expected: PASS

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, with **no change to any existing test**. `test/agent-http.test.js:307` writes to `watched.mrbl` during a turn on the fake provider, which declares no capability and so resolves to `documents` — the capability gate means it still gets `watchdog`, `lastOutcome: 'watchdog'` and its restore link. If that test fails, the gate is missing; fix the gate, do not weaken the test.

- [ ] **Step 7: Commit**

```bash
git add server/app.js server/agent/runner.js server/agent/index.js test/agent-http.test.js
git commit -m "Agents: a turn's own writes are its work, not a watchdog alarm

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEpmpmc5UXX45AbVmitNA9"
```

---

### Task 6: `check_document`, and invariants after a turn

**Files:**
- Modify: `server/agent/tools.js:26-73` (schemas) and the `handlers` object
- Modify: `server/agent/index.js` (pass `examine` in)
- Modify: `test/agent-tools.test.js` — if no such file exists, create it following the shape of `test/agent-store.test.js`

**Interfaces:**
- Consumes: `examine(name, source)` from `server/engine.js:62` — already imported by `server/app.js:23`, and already used at `app.js:696` as ``examine(`${name}.mrbl`, source)``.
- Produces: MCP tool `check_document({ path }) → { path, findings: [...] }`.

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createTools } from '../server/agent/tools.js';

const turn = { conversationId: 'c1', target: 'notes', writable: new Set(['notes']), undo: [], onEvent() {} };

test('check_document reports the format\'s own invariants', async () => {
  const sources = new Map([['notes', '<h1 data-marble-id="h1">Hi</h1>']]);
  const tools = createTools({
    store: { read: async (p) => sources.get(p) ?? null, has: async (p) => sources.has(p), list: async () => [] },
    writeOps: async () => ({ applied: 0 }),
    createDocument: async () => {},
    buildStarter: async () => '',
    guidePath: '/dev/null',
    examine: (name, source) => (source.includes('data-marble-id') ? [] : [{ level: 'error', message: 'no ids' }]),
  });

  assert.deepEqual(await tools.call('check_document', { path: 'notes' }, turn), { path: 'notes', findings: [] });

  sources.set('notes', '<h1>Hi</h1>');
  const bad = await tools.call('check_document', { path: 'notes' }, turn);
  assert.equal(bad.findings.length, 1);
  assert.match(bad.findings[0].message, /no ids/);

  assert.deepEqual(await tools.call('check_document', { path: 'nope' }, turn), { error: 'no document "nope"' });
});

test('check_document is offered to agents', () => {
  const tools = createTools({
    store: {}, writeOps: async () => ({}), createDocument: async () => {},
    buildStarter: async () => '', guidePath: '/dev/null', examine: () => [],
  });
  assert.ok(tools.schemas.some((s) => s.name === 'check_document'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="check_document"`
Expected: FAIL — `no tool "check_document"`

- [ ] **Step 3: Implement**

In `server/agent/tools.js`, append to `TOOL_SCHEMAS`:

```js
  {
    name: 'check_document',
    description:
      'Check a document against the format\'s own invariants — the ids and structure Marble needs to address it. ' +
      'Call this after rewriting a document with your own tools. No findings means it is well formed.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
    },
  },
```

Change the signature to accept `examine`:

```js
export function createTools({ store, writeOps, createDocument, buildStarter, guidePath, examine }) {
```

Add the handler beside `read_guide`:

```js
    async check_document(input) {
      const { docPath, source } = await readable(input);
      // The same question `app.js` asks of a document arriving from outside,
      // asked on demand — a full agent rewriting a file is a document arriving
      // from outside, it just happens to be one we started.
      return { path: docPath, findings: examine(`${splitPath(docPath).name}.mrbl`, source) ?? [] };
    },
```

In `server/agent/index.js`, add `examine` to the `createTools({ … })` call and import it:

```js
import { enginePath, examine } from '../engine.js';
```
```js
  const tools = createTools({
    store,
    writeOps,
    createDocument,
    buildStarter,
    guidePath: enginePath('skills/build-in-marble/SKILL.md'),
    examine,
  });
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- --test-name-pattern="check_document"`
Expected: PASS, 2 tests

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/agent/tools.js server/agent/index.js test/agent-tools.test.js
git commit -m "Agents: check_document, so a rewrite can be checked by the agent that made it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEpmpmc5UXX45AbVmitNA9"
```

---

### Task 7: Undo a turn that wrote files

**Files:**
- Modify: `server/agent/undo.js` (whole file)
- Modify: `server/agent/runner.js` (persist `touched` alongside the undo record)
- Modify: `test/agent-http.test.js`

**Interfaces:**
- Consumes: `turn.touched` (Task 5); `store.readCheckpoint` / `listCheckpoints` from `server/engine.js:42-50`; `putDocument`-backed restore.
- Produces: undo records gain a `restores: [{ path, sha }]` array alongside the existing `steps`. Undo restores files first, then replays inverse ops **only** for documents that received ops and were never file-written — a document written both ways is already back at its pre-turn state once restored, and replaying inverse ops over it would undo a second time.

**Read first:** `server/agent/undo.js` and `server/agent/inverse.js` for the existing shape, and `server/engine.js:42-50` for the checkpoint API.

- [ ] **Step 1: Write the failing test**

Add to `test/agent-runner-capability.test.js`:

```js
test('undo restores a document the turn rewrote with its own tools', async () => {
  const { drive, root } = await hostWith({ capability: 'full' });
  const before = await drive.store.read('notes');
  const file = path.join(root, 'notes.mrbl');

  const { turnId } = await runTurnWithScript(drive, [
    { write: { file, text: SOURCE.replace('Hi', 'Rewritten by the agent') } },
    { sleep: 400 },
  ]);
  assert.notEqual(await drive.store.read('notes'), before, 'the turn really changed it');

  const result = await drive.agents.runner.undo(turnId);
  assert.equal(await drive.store.read('notes'), before, 'undo put it back');
  assert.ok(result.reverted >= 1);
  await drive.close();
});

test('undo of a turn that both wrote and filed ops lands on the pre-turn state', async () => {
  const { drive, root } = await hostWith({ capability: 'full' });
  const before = await drive.store.read('notes');
  const file = path.join(root, 'notes.mrbl');

  const { turnId } = await runTurnWithScript(drive, [
    { call: 'read_document', args: { path: 'notes' } },
    { call: 'apply_ops', args: { path: 'notes', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Via ops' }] } },
    { sleep: 200 },
    { write: { file, text: SOURCE.replace('Hi', 'Then rewritten wholesale') } },
    { sleep: 400 },
  ]);

  await drive.agents.runner.undo(turnId);
  assert.equal(await drive.store.read('notes'), before, 'one undo, not two, and it lands on the start');
  await drive.close();
});
```

**Verify the undo entry point** — `agent-http.test.js:166` goes through `POST /agent/turns/:id/undo`, which is the guaranteed route if `runner.undo(turnId)` is named differently. Use the HTTP route if in doubt; the assertions do not change.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="undo restores a document"`
Expected: FAIL — the document keeps the agent's bytes

- [ ] **Step 3: Persist what the turn touched**

In `server/agent/runner.js`, the `onEvent` handler currently persists undo records only on `ops.applied`:

```js
        if (event.type === 'ops.applied') {
          turn.applied += event.count;
          const records = [...turn.undo];
          turn.undoSaved = turn.undoSaved
            .then(() => store.saveUndo(turn.id, records))
            .catch((err) => log.error(`[agents] ${err.message}`));
        }
```

Make a document the turn wrote persist the same way. Replace that block with:

```js
        if (event.type === 'ops.applied') turn.applied += event.count;
        if (event.type === 'ops.applied' || event.type === 'document.changed') {
          // Written as each batch or write lands, in order, not only when the
          // turn ends: a crash would otherwise leave changes nobody can take
          // back. `restores` is where the document started, so undo of a
          // document written both ways is one restore, not a restore and a
          // replay.
          const record = {
            steps: [...turn.undo],
            restores: [...turn.touched].map(([path, sha]) => ({ path, sha })),
          };
          turn.undoSaved = turn.undoSaved
            .then(() => store.saveUndo(turn.id, record))
            .catch((err) => log.error(`[agents] ${err.message}`));
        }
```

Note `turn.undo` is already an array of `{ path, steps }` records, so the saved shape becomes `{ steps: [{path, steps}], restores: [{path, sha}] }`. **Read `store.saveUndo` and the route that loads it first** and keep the on-disk shape backward compatible: turn files written before this change hold a bare array, and `POST /agent/turns/:id/undo` must still undo them. Normalize on read — `Array.isArray(saved) ? { steps: saved, restores: [] } : saved`.

- [ ] **Step 4: Implement undo**

In `server/agent/undo.js`, change the signature to take the normalized record and a way to restore, and do restores before inverse steps:

```js
export async function undoTurn({ records, restores = [], writeOps, restore, client }) {
  const restored = new Set();
  let reverted = 0;
  let kept = 0;
  const errors = [];

  // A document the agent rewrote with its own tools goes back to where it
  // started, in one move. Its inverse ops are then skipped: the restore has
  // already taken them back, and replaying them would undo a second time.
  for (const { path: docPath, sha } of restores) {
    try {
      await restore(docPath, sha, { client });
      restored.add(docPath);
      reverted += 1;
    } catch (err) {
      errors.push(`${docPath}: ${err.message}`);
    }
  }

  const byPath = new Map();
  for (const record of records) {
    if (restored.has(record.path)) continue;
    byPath.set(record.path, [...(byPath.get(record.path) ?? []), ...record.steps]);
  }

  // …the existing loop over byPath, unchanged from here down…
```

`restore(docPath, sha)` restores a document to a checkpoint. **Do not write a new one** — `server/app.js` already serves `POST /restore?app=<path>&sha=<sha>` (used by `agent-http.test.js:322`). Find the function behind that route and pass it in from `server/agent/index.js`; it already goes through `putDocument`, so the restore echoes and patches open tabs like any other write.

Update the caller in `server/agent/routes.js` to pass `restores` and `restore`.

- [ ] **Step 5: Run the tests**

Run: `npm test -- --test-name-pattern="undo"`
Expected: PASS — including the existing ops-undo tests, whose records now carry an empty `restores`.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`

- [ ] **Step 7: Commit**

```bash
git add server/agent/undo.js server/agent/runner.js test/agent-http.test.js
git commit -m "Agents: undo a turn that rewrote files, by restore point

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEpmpmc5UXX45AbVmitNA9"
```

---

### Task 8: Surfaces and docs

**Files:**
- Modify: `runtime/agent-ui.js` (render `document.changed` in the transcript; label the change list "documents changed")
- Modify: `docs/AGENTS.md`
- Modify: `.env.example`
- Modify: `test-browser/conversation.test.js`

- [ ] **Step 1: Write the failing browser test**

In `test-browser/conversation.test.js`, following the file's existing shape: drive a conversation whose transcript contains a `document.changed` event and assert the drawer shows the touched document; assert the section is labelled so it does not imply non-document files are covered.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:browser -- --test-name-pattern="document.changed"`

- [ ] **Step 3: Render the event**

In `runtime/agent-ui.js`, render `document.changed` beside the existing `ops.applied` rendering. Use `renderText` — never `innerHTML` — per the rule in that file.

- [ ] **Step 4: Update the docs**

In `docs/AGENTS.md`, rewrite the **Providers** table's `boundary` column for the two Claude rows, and add a section after "The rules the tools enforce":

```markdown
## What a full agent can do

`claude-subscription` and `claude-api` run at capability `full`: the CLI's own
tools — `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `TodoWrite` — with the
drive as the working directory, alongside Marble's tools.

`--restricted` confines the **file** tools to the drive; a `Read` above it is
refused by the CLI itself. It does **not** confine `Bash`: an agent's shell can
reach the whole machine, as yours can. That is stated rather than fixed — the
enforcement that would close it is platform-specific and is its own project.
The spawn goes through a `sandbox` seam in the runner so it can be closed
without touching any provider.

`MARBLE_DRIVE_AGENT_POWER=documents` holds every provider down to the tools-only
boundary. Cursor is there already: its hook sees a tool's name but not its
server, so it cannot express "your own tools, but only inside the drive".

Undo covers documents. An asset or script an agent writes is not watched by the
host, so it is neither listed in the turn's changes nor restorable — keep the
drive under git or `backups/`.
```

In `.env.example`, add:

```
# Hold every agent provider down to the tools-only boundary (no file or shell
# tools). Unset, Claude runs with its own tools, confined to the drive — except
# its shell, which is not confined. See docs/AGENTS.md.
# MARBLE_DRIVE_AGENT_POWER=documents
```

- [ ] **Step 5: Run both suites**

Run: `npm test && npm run test:browser`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add runtime/agent-ui.js docs/AGENTS.md .env.example test-browser/conversation.test.js
git commit -m "Agents: show what a turn touched, and document what full capability means

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEpmpmc5UXX45AbVmitNA9"
```

---

### Task 9: Live verification

Not a code task. Do this by hand and record the results in the spec's §4.1 table.

- [ ] **Step 1:** Start the host with agents on against a scratch drive, not your real one:
  `MARBLE_DRIVE_AGENTS=1 MARBLE_DRIVE_ROOT=/tmp/scratch-drive npm run dev`
- [ ] **Step 2:** One turn that rewrites a document end to end while a browser has it open. Confirm the page **patches** rather than reloads, and that ids survive (`check_document` reports nothing).
- [ ] **Step 3:** One turn that writes a script and runs it with Bash. Confirm the output reaches the transcript.
- [ ] **Step 4:** One turn asked to read a file above the drive. Confirm `Read` is refused by the CLI, and confirm `Bash` is **not** — this is the limitation, and it should be observed rather than assumed still true.
- [ ] **Step 5:** Undo that turn. Confirm the document returns to its pre-turn state.
- [ ] **Step 6:** Probe whether skills load under `--restricted` (spec §8's open question). If they do not, no code changes — `read_guide` is the documented fallback. Record the answer in `docs/AGENTS.md`.
- [ ] **Step 7:** Commit the recorded results.

---

## Self-Review

**Spec coverage:** §4 spawn → Task 3; §5 tools → Task 6; §6 attribution → Task 5; §7 undo → Task 7; §8 instructions → Task 2; §9 capability → Tasks 1, 3; §10.1 sandbox seam → Task 4; §11 limitations → Task 8 docs; §12 testing → spread across every task plus Task 9; §13 build order → task order matches.

**A design bug this review caught.** The first draft had `documentTouched` claim a changed document for *any* running turn. That would have broken `test/agent-http.test.js:307` — which writes to a document during a turn on the fake provider, a `documents` provider — and it was wrong on its own terms: an agent with no file tools writes only through ops, so a document changing under it really is an intrusion. Attribution is now gated on `capability === 'full'`, `watchdog` is left intact rather than replaced, and the spec's §6 was corrected to match. Task 5 now expects the existing suite to pass untouched, which is the stronger claim.

**Remaining softness, flagged rather than hidden.** Four names are used before being verified, each with a stated fallback the implementer can take without changing any assertion:
- `drive.agents.store.createConversation` / `runner.submit` (Task 4) → fall back to driving turns over HTTP, as `agent-http.test.js`'s `start()` does.
- `drive.agents.store.events(id)` (Task 5) → fall back to `GET /agent/conversations/:id` → `body.events`.
- `runner.undo(turnId)` (Task 7) → fall back to `POST /agent/turns/:id/undo`.
- `store.saveUndo`'s on-disk shape (Task 7, Step 3) → must be read before changing; the step says how to stay backward compatible.

Task 7 Step 4 gives the restore-before-replay algorithm and the `restored` skip-set as real code, but splices into an existing loop rather than reproducing `undo.js` whole; the implementer reads that file first. Task 8's browser test is described rather than written, because `test-browser/conversation.test.js`'s harness has not been read.

**Type consistency:** `effectiveCapability(provider, { power })` — Tasks 1, 4. `instructionsFor(capability)` — Tasks 2, 3. `spec.cwd` — Tasks 3, 4. `runner.documentTouched(docPath, sha) → boolean` — Tasks 5, 7. `document.changed` event name — Tasks 5, 7, 8. `FULL_TOOLS` string — Task 3 only, matching the Global Constraints verbatim.
