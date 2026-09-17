# Agents Providers Implementation Plan (Plan 2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real agents — Claude on the subscription, Claude on the API key, and Cursor — run turns on Marble Drive through the core built in Plan 1, each confined to Marble's tools.

**Architecture:** Each provider is an adapter satisfying the runner's contract `{ id, label, detect, prepare, spawn, parse }` (server/agent/runner.js). `prepare` writes the per-turn MCP config (and for Cursor a fail-closed `preToolUse` hook plus `AGENTS.md`) into the conversation's workspace; `spawn` builds the CLI invocation verified in spikes on 2026-09-16; `parse` turns one stdout line into the runner's common events. Parsers are tested against streams recorded from real runs (`test/fixtures/providers/*.jsonl`). A `marble-drive agents` command lists providers and runs one real turn against a scratch drive for live verification.

**Tech Stack:** Node ≥ 22 ESM, `node:test`, `node:child_process`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-agent-interface-design.md` §4 (providers), §12 (security), §14 (testing). Core contract: `docs/AGENTS.md`, `server/agent/runner.js`.

## Global Constraints

- No new npm dependencies; Marble package only through `server/engine.js` (this plan does not need it).
- Provider ids exactly: `claude-subscription`, `claude-api`, `cursor`. Labels: `Claude`, `Claude (API key)`, `Cursor`.
- A provider never reads or returns `MARBLE_DRIVE_SECRET`. The runner already strips it; `spawn` returns only the env keys a provider adds (`ANTHROPIC_API_KEY` for `claude-api` only; `CURSOR_API_KEY` for `cursor` only if set in the host env).
- Claude spawn, exactly (prompt on stdin — `--tools` is variadic and would swallow a trailing prompt argument): `claude -p --output-format stream-json --verbose --include-partial-messages --tools "" --strict-mcp-config --mcp-config <workspace>/mcp.json --allowedTools mcp__marble --setting-sources project --disable-slash-commands --append-system-prompt <INSTRUCTIONS> [--model m] [--resume <session>]`. Never `--bare` (it skips the keychain the subscription login lives in).
- Cursor spawn, exactly: `cursor-agent -p --output-format stream-json --stream-partial-output --approve-mcps --trust --workspace <workspace> --model <model|composer-2.5> [--resume <session>] <prompt>`; `<workspace>/.cursor/mcp.json`, `<workspace>/.cursor/hooks.json` (`preToolUse`, `failClosed: true`), `<workspace>/AGENTS.md`.
- Cursor default model `composer-2.5` (the default model is at its plan limit until 2026-09-19); a conversation's `model` overrides it.
- MCP config files carry the turn token: write them with mode `0o600`.
- The Cursor hook allows exactly `MCP:list_documents`, `MCP:read_document`, `MCP:apply_ops`, `MCP:create_document`, `MCP:read_guide` and denies everything else, including other MCP servers' tools and malformed input.
- Detection probes time out after 5 s; `claude-subscription` detection runs without `ANTHROPIC_API_KEY` in its env.
- Code style: match the repo — ESM, two-space indent, single quotes, comments in the existing voice (why, not what).
- `npm test` baseline at plan start: 257 passing.

## File Structure

| file | responsibility |
|---|---|
| `server/agent/instructions.js` | the rules every agent is given, one copy for all providers |
| `server/agent/providers/exec.js` | `runCommand` — run a short probe command with a timeout |
| `server/agent/providers/claude.js` | `parseClaudeLine`, `createClaudeProvider({auth})` |
| `server/agent/providers/cursor.js` | `parseCursorLine`, `createCursorProvider()` |
| `bin/marble-cursor-hook.js` | Cursor `preToolUse` hook: allow Marble's tools only |
| `server/agent/providers/index.js` (modify) | `builtInProviders()` registers the three |
| `server/agent/try.js` | `tryProvider` — one real turn against a scratch drive |
| `bin/marble-drive.js` (modify), `package.json` (modify) | `marble-drive agents providers|try` |
| `docs/AGENTS.md` (modify) | the providers section |
| `test/fixtures/providers/*.jsonl` (already committed) | recorded real streams: `claude-1` (two tool calls + reply), `claude-2` (resumed), `cursor-1`, `cursor-2` |
| `test/agent-provider-common.test.js`, `test/agent-provider-claude.test.js`, `test/agent-provider-cursor.test.js`, `test/agent-try.test.js` | tests |

---

### Task 1: Instructions and the probe runner

**Files:**
- Create: `server/agent/instructions.js`
- Create: `server/agent/providers/exec.js`
- Test: `test/agent-provider-common.test.js`

**Interfaces:**
- Produces:
  - `INSTRUCTIONS` — a string.
  - `runCommand(command, args = [], { timeout = 5000, env = process.env }) → Promise<{ code: number|null, stdout: string, stderr: string, missing: boolean, timedOut?: true, error?: string }>`; never rejects. `missing` is true when the command is not on PATH.

- [ ] **Step 1: Write the failing test**

Create `test/agent-provider-common.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_SCHEMAS } from '../server/agent/tools.js';
import { INSTRUCTIONS } from '../server/agent/instructions.js';
import { runCommand } from '../server/agent/providers/exec.js';

test('the instructions name every tool and the rules the tools enforce', () => {
  for (const { name } of TOOL_SCHEMAS) assert.ok(INSTRUCTIONS.includes(name), name);
  assert.match(INSTRUCTIONS, /read .* before/i);
  assert.match(INSTRUCTIONS, /refused/i);
  assert.match(INSTRUCTIONS, /data-marble-id/);
});

test('a probe reports what the command printed and how it exited', async () => {
  const result = await runCommand(process.execPath, ['-e', 'console.log("hi"); console.error("there"); process.exit(3)']);
  assert.equal(result.code, 3);
  assert.equal(result.stdout, 'hi\n');
  assert.equal(result.stderr, 'there\n');
  assert.equal(result.missing, false);
});

test('a command that is not installed is missing, not an error', async () => {
  const result = await runCommand('marble-definitely-not-a-command', ['--version']);
  assert.equal(result.missing, true);
  assert.equal(result.code, null);
});

test('a probe that hangs is stopped at its timeout', async () => {
  const started = Date.now();
  const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeout: 200 });
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 2000);
});

test('a probe gets exactly the environment it is given', async () => {
  const result = await runCommand(process.execPath, ['-e', 'console.log(process.env.MARBLE_PROBE ?? "unset")'], {
    env: { PATH: process.env.PATH, MARBLE_PROBE: 'seen' },
  });
  assert.equal(result.stdout.trim(), 'seen');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/agent-provider-common.test.js`
Expected: FAIL — `Cannot find module '…/server/agent/instructions.js'`.

- [ ] **Step 3: Implement `server/agent/instructions.js`**

```js
// What every agent is told, whichever CLI it runs in. Claude gets it as an
// appended system prompt and Cursor as the workspace's AGENTS.md; there is one
// copy so the two cannot drift.
//
// Nothing depends on an agent obeying this. The tools refuse what the rules
// forbid; the rules are here so an agent stops trying.

export const INSTRUCTIONS = `You are working inside Marble Drive. Every document is one HTML file, and every element you can change carries a data-marble-id attribute. You can only act on documents through these tools: list_documents, read_document, apply_ops, create_document and read_guide. There are no file or shell tools.

How to work:
- Read before you edit. apply_ops refuses to change an element this conversation has not seen in full. read_document with no ids gives you the whole document, or an outline of a large one; read_document with ids gives the full source of those elements.
- Edit with small ops: setText, setInner, setAttr, insert, move, remove, at most 24 per apply_ops call, each addressed by data-marble-id. Never invent an id for an element you were not shown. Elements you insert get ids minted for you.
- If apply_ops is refused because an element changed since you read it, the person has edited it. The refusal includes its current source: rebuild your change against that source and call apply_ops again. Do not overwrite their work.
- You may only change the document you were asked about and documents you create in this turn. You may read any document.
- If you are unsure how an op or an affordance works, call read_guide.

When you finish, reply with a short plain-language summary of what you changed.`;
```

- [ ] **Step 4: Implement `server/agent/providers/exec.js`**

```js
// A short command, run to find something out: is this CLI installed, is it
// signed in. Never a turn — the runner owns those. It always resolves, so a
// provider's detect() can report "not installed" instead of throwing.

import { spawn } from 'node:child_process';

export function runCommand(command, args = [], { timeout = 5_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, ...result });
    };

    let child;
    try {
      child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return finish({ code: null, missing: err.code === 'ENOENT', error: err.message });
    }

    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: null, missing: false, timedOut: true });
    }, timeout);
    timer.unref?.();

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => finish({ code: null, missing: err.code === 'ENOENT', error: err.message }));
    child.on('close', (code) => finish({ code, missing: false }));
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test --test-reporter=spec test/agent-provider-common.test.js && npm test`
Expected: PASS — 5 new tests; full suite 262.

- [ ] **Step 6: Commit**

```bash
git add server/agent/instructions.js server/agent/providers/exec.js test/agent-provider-common.test.js
git commit -m "Agents providers: one set of instructions, and a probe that always answers"
```

---

### Task 2: The Claude adapter

**Files:**
- Create: `server/agent/providers/claude.js`
- Test: `test/agent-provider-claude.test.js`
- Uses (committed): `test/fixtures/providers/claude-1.jsonl`, `claude-2.jsonl`

**Interfaces:**
- Consumes: Task 1 `INSTRUCTIONS`, `runCommand`.
- Produces:
  - `parseClaudeLine(line) → event[]`: `system/init` → `session`; `stream_event` `content_block_delta` `text_delta` → `text.delta`; `assistant` text block → `text`, `tool_use` block → `tool.call` (name without `mcp__marble__`); `user` `tool_result` block → `tool.result {callId, ok: !is_error, summary ≤200 chars}`; `result` → `usage {costUsd, inputTokens, outputTokens}` then `done {ok}` or `done {ok:false, error}`; anything else → `[]`. Assistant lines with a non-null `parent_tool_use_id` → `[]`.
  - `createClaudeProvider({ auth = 'subscription' | 'api', exec = runCommand, env = process.env }) → provider`.

- [ ] **Step 1: Write the failing test**

Create `test/agent-provider-claude.test.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { INSTRUCTIONS } from '../server/agent/instructions.js';
import { createClaudeProvider, parseClaudeLine } from '../server/agent/providers/claude.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'providers');
const stream = (name) => fs.readFileSync(path.join(FIXTURES, `${name}.jsonl`), 'utf8').trim().split('\n');
const parseAll = (name) => stream(name).flatMap((line) => parseClaudeLine(line));
const brief = (events) =>
  events
    .filter((e) => e.type !== 'text.delta')
    .map((e) =>
      e.type === 'tool.call' ? `call:${e.name}` : e.type === 'tool.result' ? `result:${e.ok}` : e.type === 'text' ? `text:${e.text}` : e.type === 'done' ? `done:${e.ok}` : e.type,
    );

test('a recorded turn with two tool calls reads as the runner expects', () => {
  const events = parseAll('claude-1');
  assert.deepEqual(brief(events), [
    'session',
    'call:read_document',
    'result:true',
    'call:apply_ops',
    'result:true',
    'text:Renamed the heading from "Research Garden" to "Backlog".',
    'usage',
    'done:true',
  ]);
  assert.equal(events[0].id, '3df910ef-8170-4799-b459-af7b781e4d3b');
  const apply = events.find((e) => e.name === 'apply_ops');
  assert.deepEqual(apply.input, { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] });
  const results = events.filter((e) => e.type === 'tool.result');
  assert.equal(results[0].callId, events.find((e) => e.name === 'read_document').callId);
  assert.match(results[0].summary, /Research Garden/);
  assert.deepEqual(events.find((e) => e.type === 'usage'), { type: 'usage', costUsd: 0.0205657, inputTokens: 25, outputTokens: 437 });
});

test('the live deltas spell out the final text', () => {
  const events = parseAll('claude-1');
  const deltas = events.filter((e) => e.type === 'text.delta').map((e) => e.text).join('');
  assert.equal(deltas, events.find((e) => e.type === 'text').text);
});

test('a resumed turn keeps its session', () => {
  assert.deepEqual(brief(parseAll('claude-2')), ['session', 'text:resumed', 'usage', 'done:true']);
  assert.equal(parseAll('claude-2')[0].id, parseAll('claude-1')[0].id);
});

test('an error result ends the turn with Claude’s own words', () => {
  const events = parseClaudeLine(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Claude AI usage limit reached|1789624200' }));
  assert.deepEqual(events.at(-1), { type: 'done', ok: false, error: 'Claude AI usage limit reached|1789624200' });
});

test('a failed tool result is not ok', () => {
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'no document "x"' }] }] } });
  assert.deepEqual(parseClaudeLine(line), [{ type: 'tool.result', callId: 't1', ok: false, summary: 'no document "x"' }]);
});

test('ids, labels, and the spawn verified by the spike', () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: { ANTHROPIC_API_KEY: 'sk-test' } });
  const api = createClaudeProvider({ auth: 'api', env: { ANTHROPIC_API_KEY: 'sk-test' } });
  assert.equal(sub.id, 'claude-subscription');
  assert.equal(sub.label, 'Claude');
  assert.equal(api.id, 'claude-api');
  assert.equal(api.label, 'Claude (API key)');

  const spec = sub.spawn({ workspace: '/w', prompt: 'Rename it', resume: 'sess-1', model: 'claude-haiku-4-5', env: { PATH: '/bin' } });
  assert.equal(spec.command, 'claude');
  assert.equal(spec.stdin, 'Rename it');
  assert.deepEqual(spec.args, [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--strict-mcp-config', '--mcp-config', path.join('/w', 'mcp.json'),
    '--allowedTools', 'mcp__marble', '--setting-sources', 'project', '--disable-slash-commands',
    '--append-system-prompt', INSTRUCTIONS, '--model', 'claude-haiku-4-5', '--resume', 'sess-1',
  ]);
  assert.ok(!spec.args.includes('--bare'));
  assert.deepEqual(spec.env, {}, 'the subscription never gets the API key');
  assert.deepEqual(api.spawn({ workspace: '/w', prompt: 'x', env: {} }).env, { ANTHROPIC_API_KEY: 'sk-test' });
  assert.ok(!sub.spawn({ workspace: '/w', prompt: 'x', env: {} }).args.includes('--resume'));
});

test('prepare writes the MCP config privately, with the turn’s bridge', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-claude-ws-'));
  const mcp = { command: '/usr/bin/node', args: ['/repo/bin/marble-mcp.js'], env: { MARBLE_DRIVE_URL: 'http://127.0.0.1:1', MARBLE_AGENT_TOKEN: 'tok' } };
  await createClaudeProvider().prepare({ workspace, mcp, meta: {} });
  const file = path.join(workspace, 'mcp.json');
  assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), { mcpServers: { marble: mcp } });
  assert.equal((await fsp.stat(file)).mode & 0o777, 0o600);
});

test('detect: signed in, signed out, not installed, and the API key', async () => {
  const calls = [];
  const exec = (answer) => async (command, args, options) => {
    calls.push({ command, args, env: options?.env });
    return answer;
  };
  const signedIn = createClaudeProvider({ exec: exec({ code: 0, stdout: '{"loggedIn": true, "authMethod": "claude.ai"}', stderr: '', missing: false }), env: { ANTHROPIC_API_KEY: 'k', PATH: '/bin' } });
  assert.deepEqual(await signedIn.detect(), { installed: true, signedIn: true, detail: 'signed in (claude.ai)' });
  assert.equal(calls.at(-1).command, 'claude');
  assert.deepEqual(calls.at(-1).args, ['auth', 'status']);
  assert.equal(calls.at(-1).env.ANTHROPIC_API_KEY, undefined, 'probing the subscription without the key');

  const signedOut = createClaudeProvider({ exec: exec({ code: 1, stdout: '{"loggedIn": false}', stderr: '', missing: false }), env: {} });
  assert.equal((await signedOut.detect()).signedIn, false);

  const missing = createClaudeProvider({ exec: exec({ code: null, stdout: '', stderr: '', missing: true }), env: {} });
  assert.deepEqual(await missing.detect(), { installed: false, signedIn: false, detail: 'claude is not installed' });

  const installed = exec({ code: 0, stdout: '{}', stderr: '', missing: false });
  assert.equal((await createClaudeProvider({ auth: 'api', exec: installed, env: { ANTHROPIC_API_KEY: 'k' } }).detect()).signedIn, true);
  assert.equal((await createClaudeProvider({ auth: 'api', exec: installed, env: {} }).detect()).signedIn, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/agent-provider-claude.test.js`
Expected: FAIL — `Cannot find module '…/server/agent/providers/claude.js'`.

- [ ] **Step 3: Implement `server/agent/providers/claude.js`**

```js
// Claude Code as a Marble agent.
//
// The invocation is the one the 2026-09-16 spike proved: no built-in tools at
// all (`--tools ""`), only the marble MCP server (`--strict-mcp-config`), no
// user settings, hooks or CLAUDE.md from this machine (`--setting-sources
// project` over an empty workspace), and the prompt on stdin, because
// `--tools` takes a list and would swallow a trailing prompt as one of its
// values. `--bare` would also shed settings, but it skips the keychain the
// subscription login lives in.
//
// The two providers differ only in billing: the subscription gets no API key
// in its environment, so the CLI uses the login; the API provider hands it one.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { INSTRUCTIONS } from '../instructions.js';
import { runCommand } from './exec.js';

const PREFIX = 'mcp__marble__';
const SUMMARY = 200;

const toolName = (name) => (name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name);
const textOf = (content) =>
  Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('') : String(content ?? '');

/** One line of `claude -p --output-format stream-json` as the runner's events. */
export function parseClaudeLine(line) {
  const e = JSON.parse(line);
  switch (e.type) {
    case 'system':
      return e.subtype === 'init' && e.session_id ? [{ type: 'session', id: e.session_id }] : [];

    case 'stream_event': {
      const delta = e.event?.delta;
      return e.event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text
        ? [{ type: 'text.delta', text: delta.text }]
        : [];
    }

    case 'assistant': {
      if (e.parent_tool_use_id) return [];
      const events = [];
      for (const block of e.message?.content ?? []) {
        if (block.type === 'text' && block.text) events.push({ type: 'text', text: block.text });
        if (block.type === 'tool_use') {
          events.push({ type: 'tool.call', name: toolName(block.name), input: block.input ?? {}, callId: block.id });
        }
      }
      return events;
    }

    case 'user': {
      const events = [];
      for (const block of e.message?.content ?? []) {
        if (block.type !== 'tool_result') continue;
        events.push({
          type: 'tool.result',
          callId: block.tool_use_id,
          ok: !block.is_error,
          summary: textOf(block.content).slice(0, SUMMARY),
        });
      }
      return events;
    }

    case 'result': {
      const usage = e.usage ?? {};
      return [
        {
          type: 'usage',
          costUsd: e.total_cost_usd ?? null,
          inputTokens: usage.input_tokens ?? null,
          outputTokens: usage.output_tokens ?? null,
        },
        e.is_error
          ? { type: 'done', ok: false, error: String(e.result || e.subtype || 'Claude reported an error') }
          : { type: 'done', ok: true },
      ];
    }

    default:
      return [];
  }
}

export function createClaudeProvider({ auth = 'subscription', exec = runCommand, env = process.env } = {}) {
  const api = auth === 'api';

  return {
    id: api ? 'claude-api' : 'claude-subscription',
    label: api ? 'Claude (API key)' : 'Claude',

    async detect() {
      const probeEnv = { ...env };
      // Asked with a key in the environment, the CLI answers about the key.
      if (!api) delete probeEnv.ANTHROPIC_API_KEY;
      const probe = await exec('claude', ['auth', 'status'], { env: probeEnv });
      if (probe.missing) return { installed: false, signedIn: false, detail: 'claude is not installed' };

      if (api) {
        return env.ANTHROPIC_API_KEY
          ? { installed: true, signedIn: true, detail: 'ANTHROPIC_API_KEY is set' }
          : { installed: true, signedIn: false, detail: 'set ANTHROPIC_API_KEY to use Claude on the API' };
      }

      let status = null;
      try {
        status = JSON.parse(probe.stdout);
      } catch {
        // Not JSON: an older CLI, or one that failed. Either way, not signed in as far as we can tell.
      }
      if (status?.loggedIn) {
        return { installed: true, signedIn: true, detail: `signed in (${status.authMethod ?? 'claude'})` };
      }
      return {
        installed: true,
        signedIn: false,
        detail: probe.timedOut ? 'claude auth status timed out' : 'run `claude` once to sign in',
      };
    },

    async prepare({ workspace, mcp }) {
      const config = { mcpServers: { marble: { command: mcp.command, args: mcp.args, env: mcp.env } } };
      // The token in here is good for one turn, and nobody else's business.
      await fsp.writeFile(path.join(workspace, 'mcp.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
      await fsp.chmod(path.join(workspace, 'mcp.json'), 0o600);
    },

    spawn({ workspace, prompt, resume = null, model = null }) {
      const args = [
        '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--tools', '', '--strict-mcp-config', '--mcp-config', path.join(workspace, 'mcp.json'),
        '--allowedTools', 'mcp__marble', '--setting-sources', 'project', '--disable-slash-commands',
        '--append-system-prompt', INSTRUCTIONS,
      ];
      if (model) args.push('--model', model);
      if (resume) args.push('--resume', resume);
      return {
        command: 'claude',
        args,
        env: api && env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {},
        stdin: prompt,
      };
    },

    parse: (line) => parseClaudeLine(line),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=spec test/agent-provider-claude.test.js && npm test`
Expected: PASS — 8 new tests; full suite 270.

- [ ] **Step 5: Commit**

```bash
git add server/agent/providers/claude.js test/agent-provider-claude.test.js
git commit -m "Agents providers: Claude, on the subscription or the API key"
```

---

### Task 3: The Cursor adapter and its hook

**Files:**
- Create: `server/agent/providers/cursor.js`
- Create: `bin/marble-cursor-hook.js`
- Test: `test/agent-provider-cursor.test.js`
- Uses (committed): `test/fixtures/providers/cursor-1.jsonl`, `cursor-2.jsonl`

**Interfaces:**
- Consumes: Task 1 `INSTRUCTIONS`, `runCommand`; `TOOL_SCHEMAS` from `server/agent/tools.js` (test only).
- Produces:
  - `parseCursorLine(line, state) → event[]`. With `--stream-partial-output`, Cursor sends assistant text as fragments and then the whole message once more; the parser accumulates fragments in `state.text`, emits each fragment as `text.delta`, and emits `text` once — when a message equal to the accumulated fragments arrives, or before a tool call / the result if fragments are still pending. `system/init` → `session`; `tool_call` `mcpToolCall` started → `tool.call {name: args.toolName, input: args.args}`, completed → `tool.result {ok: success && !isError}`; other `*ToolCall` kinds except `getMcpToolsToolCall` → `tool.call` named by the kind without `ToolCall` and a `tool.result` with `ok:false` and the rejection reason when rejected; `result` → `usage {inputTokens, outputTokens}` then `done`.
  - `createCursorProvider({ exec = runCommand, env = process.env, defaultModel = 'composer-2.5', hookPath }) → provider`.
  - `bin/marble-cursor-hook.js`: reads Cursor's hook JSON on stdin, prints `{permission:'allow'}` for the five `MCP:<tool>` names and a deny with `user_message`/`agent_message` for anything else; its allowlist is asserted against `TOOL_SCHEMAS` names by test.

- [ ] **Step 1: Write the failing test**

Create `test/agent-provider-cursor.test.js`:

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { INSTRUCTIONS } from '../server/agent/instructions.js';
import { createCursorProvider, parseCursorLine } from '../server/agent/providers/cursor.js';
import { TOOL_SCHEMAS } from '../server/agent/tools.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'providers');
const HOOK = path.join(HERE, '..', 'bin', 'marble-cursor-hook.js');

const parseAll = (name) => {
  const state = {};
  return fs.readFileSync(path.join(FIXTURES, `${name}.jsonl`), 'utf8').trim().split('\n').flatMap((line) => parseCursorLine(line, state));
};
const brief = (events) =>
  events
    .filter((e) => e.type !== 'text.delta')
    .map((e) =>
      e.type === 'tool.call' ? `call:${e.name}` : e.type === 'tool.result' ? `result:${e.ok}` : e.type === 'text' ? `text:${e.text}` : e.type === 'done' ? `done:${e.ok}` : e.type,
    );

test('a recorded turn with two tool calls reads as the runner expects, each message once', () => {
  const events = parseAll('cursor-1');
  assert.deepEqual(brief(events), [
    'session',
    'text:I\'ll use the Marble tools as specified — first checking their schemas, then calling `read_document` and `apply_ops` on "garden".\n',
    'call:read_document',
    'result:true',
    'call:apply_ops',
    'result:true',
    'text:Renamed the garden document heading from "Research Garden" to "Backlog".',
    'usage',
    'done:true',
  ]);
  assert.equal(events[0].id, '248a44d2-e14c-463e-9779-7ad64c3beb2a');
  assert.deepEqual(events.find((e) => e.name === 'apply_ops').input, {
    path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }],
  });
  assert.match(events.find((e) => e.type === 'tool.result').summary, /Research Garden/);
  assert.deepEqual(events.find((e) => e.type === 'usage'), { type: 'usage', inputTokens: 13009, outputTokens: 342 });
});

test('the fragments spell out exactly the messages', () => {
  const events = parseAll('cursor-1');
  const deltas = events.filter((e) => e.type === 'text.delta').map((e) => e.text).join('');
  assert.equal(deltas, events.filter((e) => e.type === 'text').map((e) => e.text).join(''));
});

test('a resumed turn keeps its session', () => {
  assert.deepEqual(brief(parseAll('cursor-2')), ['session', 'text:resumed', 'usage', 'done:true']);
});

test('fragments with no closing message are still stored before the result', () => {
  const state = {};
  const lines = [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Half' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ' done' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Half done', usage: { inputTokens: 1, outputTokens: 2 } },
  ];
  const events = lines.flatMap((l) => parseCursorLine(JSON.stringify(l), state));
  assert.deepEqual(brief(events), ['text:Half done', 'usage', 'done:true']);
});

test('a tool the hook blocked shows up as a failed call, with the reason', () => {
  const state = {};
  const started = { type: 'tool_call', subtype: 'started', call_id: 'c1', tool_call: { editToolCall: { args: { path: '/tmp/x.mrbl' } } } };
  const completed = { type: 'tool_call', subtype: 'completed', call_id: 'c1', tool_call: { editToolCall: { args: { path: '/tmp/x.mrbl' }, result: { rejected: { path: '', reason: 'Marble agents can only use Marble tools' } } } } };
  const events = [started, completed].flatMap((l) => parseCursorLine(JSON.stringify(l), state));
  assert.deepEqual(events, [
    { type: 'tool.call', name: 'edit', input: { path: '/tmp/x.mrbl' }, callId: 'c1' },
    { type: 'tool.result', callId: 'c1', ok: false, summary: 'Marble agents can only use Marble tools' },
  ]);
});

test('an error result ends the turn with Cursor’s own words', () => {
  const events = parseCursorLine(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'You\'ve hit your usage limit' }), {});
  assert.deepEqual(events.at(-1), { type: 'done', ok: false, error: 'You\'ve hit your usage limit' });
});

test('spawn is the verified invocation, with the default model and the prompt last', () => {
  const provider = createCursorProvider({ env: {} });
  assert.equal(provider.id, 'cursor');
  assert.equal(provider.label, 'Cursor');
  const spec = provider.spawn({ workspace: '/w', prompt: 'Rename it', resume: 'chat-1', model: null, env: {} });
  assert.equal(spec.command, 'cursor-agent');
  assert.deepEqual(spec.args, [
    '-p', '--output-format', 'stream-json', '--stream-partial-output', '--approve-mcps', '--trust',
    '--workspace', '/w', '--model', 'composer-2.5', '--resume', 'chat-1', 'Rename it',
  ]);
  assert.deepEqual(spec.env, {});
  assert.equal(provider.spawn({ workspace: '/w', prompt: 'p', model: 'gpt-5.2', env: {} }).args.at(-2), 'gpt-5.2');
  assert.deepEqual(createCursorProvider({ env: { CURSOR_API_KEY: 'ck' } }).spawn({ workspace: '/w', prompt: 'p', env: {} }).env, { CURSOR_API_KEY: 'ck' });
});

test('prepare writes the MCP config privately, the fail-closed hook, and the instructions', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-cursor-ws-'));
  const mcp = { command: '/usr/bin/node', args: ['/repo/bin/marble-mcp.js'], env: { MARBLE_DRIVE_URL: 'http://127.0.0.1:1', MARBLE_AGENT_TOKEN: 'tok' } };
  await createCursorProvider({ hookPath: '/repo/bin/marble-cursor-hook.js' }).prepare({ workspace, mcp, meta: {} });

  const mcpFile = path.join(workspace, '.cursor', 'mcp.json');
  assert.deepEqual(JSON.parse(await fsp.readFile(mcpFile, 'utf8')), { mcpServers: { marble: mcp } });
  assert.equal((await fsp.stat(mcpFile)).mode & 0o777, 0o600);

  const hooks = JSON.parse(await fsp.readFile(path.join(workspace, '.cursor', 'hooks.json'), 'utf8'));
  assert.equal(hooks.version, 1);
  assert.equal(hooks.hooks.preToolUse.length, 1);
  assert.equal(hooks.hooks.preToolUse[0].failClosed, true);
  assert.match(hooks.hooks.preToolUse[0].command, /marble-cursor-hook\.js/);

  assert.equal(await fsp.readFile(path.join(workspace, 'AGENTS.md'), 'utf8'), INSTRUCTIONS);
});

test('detect: signed in, signed out, not installed', async () => {
  const exec = (answer) => async () => answer;
  assert.deepEqual(
    await createCursorProvider({ exec: exec({ code: 0, stdout: '✓ Logged in as someone@example.com\n', stderr: '', missing: false }) }).detect(),
    { installed: true, signedIn: true, detail: 'signed in as someone@example.com' },
  );
  assert.equal((await createCursorProvider({ exec: exec({ code: 1, stdout: 'Not logged in', stderr: '', missing: false }) }).detect()).signedIn, false);
  assert.deepEqual(
    await createCursorProvider({ exec: exec({ code: null, stdout: '', stderr: '', missing: true }) }).detect(),
    { installed: false, signedIn: false, detail: 'cursor-agent is not installed' },
  );
});

const askHook = (input) => {
  const run = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  return { code: run.status, answer: JSON.parse(run.stdout) };
};

test('the hook allows exactly Marble’s tools', () => {
  for (const { name } of TOOL_SCHEMAS) {
    assert.deepEqual(askHook(JSON.stringify({ tool_name: `MCP:${name}`, tool_input: {} })).answer, { permission: 'allow' }, name);
  }
});

test('the hook denies everything else, including other MCP servers and nonsense', () => {
  for (const input of [
    JSON.stringify({ tool_name: 'Shell', tool_input: { command: 'rm -rf /' } }),
    JSON.stringify({ tool_name: 'Write', tool_input: {} }),
    JSON.stringify({ tool_name: 'Read', tool_input: {} }),
    JSON.stringify({ tool_name: 'MCP:github_create_issue', tool_input: {} }),
    JSON.stringify({}),
    'not json',
  ]) {
    const { code, answer } = askHook(input);
    assert.equal(code, 0);
    assert.equal(answer.permission, 'deny', input);
    assert.ok(answer.agent_message);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/agent-provider-cursor.test.js`
Expected: FAIL — `Cannot find module '…/server/agent/providers/cursor.js'`.

- [ ] **Step 3: Implement `bin/marble-cursor-hook.js`**

```js
#!/usr/bin/env node
// Cursor's preToolUse hook for a Marble agent's workspace.
//
// cursor-agent has no flag that removes its own file and shell tools — the
// 2026-09-16 spike watched `--mode ask` and `--sandbox enabled` both let its
// edit tool write a file. A hook can refuse, though, and Cursor asks this one
// before every tool call. It allows Marble's tools by name and nothing else:
// not the built-in tools, and not some other MCP server's tools that a user
// config might have added. The workspace registers it with `failClosed`, so a
// hook that crashes is a refusal too.

const ALLOWED = new Set([
  'MCP:list_documents',
  'MCP:read_document',
  'MCP:apply_ops',
  'MCP:create_document',
  'MCP:read_guide',
]);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  let name = '';
  try {
    name = String(JSON.parse(input || '{}').tool_name ?? '');
  } catch {
    // Unreadable input is not a reason to allow anything.
  }
  const answer = ALLOWED.has(name)
    ? { permission: 'allow' }
    : {
        permission: 'deny',
        user_message: 'Marble agents can only use Marble tools',
        agent_message: 'Only the marble tools are available here: list_documents, read_document, apply_ops, create_document and read_guide.',
      };
  process.stdout.write(JSON.stringify(answer));
});
```

- [ ] **Step 4: Implement `server/agent/providers/cursor.js`**

```js
// Cursor Agent as a Marble agent.
//
// Cursor cannot be told to drop its own tools, so the boundary is a hook
// (bin/marble-cursor-hook.js) that Cursor consults before every call, written
// into the conversation's workspace with `failClosed`. The MCP config and the
// instructions live in the same workspace, which is outside the drive, so even
// a tool that slipped past the hook would find nothing there worth touching.
//
// The default model is composer-2.5: on 2026-09-16 Cursor's default model was
// at its plan limit and composer-2.5 was not. A conversation's own model wins.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INSTRUCTIONS } from '../instructions.js';
import { runCommand } from './exec.js';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'marble-cursor-hook.js');
const SUMMARY = 200;

/** One line of `cursor-agent -p --output-format stream-json --stream-partial-output`.
 *
 *  Cursor sends a message as fragments and then the whole message again. The
 *  fragments are what a person watches arrive; the whole message is what the
 *  transcript keeps — once. `state.text` is the fragments so far. */
export function parseCursorLine(line, state) {
  const e = JSON.parse(line);
  state.text ??= '';

  const pending = () => {
    if (!state.text) return [];
    const text = state.text;
    state.text = '';
    return [{ type: 'text', text }];
  };

  switch (e.type) {
    case 'system':
      return e.subtype === 'init' && e.session_id ? [{ type: 'session', id: e.session_id }] : [];

    case 'assistant': {
      const text = (e.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (!text) return [];
      if (state.text && text === state.text) {
        state.text = '';
        return [{ type: 'text', text }];
      }
      state.text += text;
      return [{ type: 'text.delta', text }];
    }

    case 'tool_call': {
      const kind = Object.keys(e.tool_call ?? {}).find((key) => key.endsWith('ToolCall'));
      // Cursor's own lookup of the MCP schemas is bookkeeping, not work.
      if (!kind || kind === 'getMcpToolsToolCall') return [];
      const call = e.tool_call[kind];
      const mcp = kind === 'mcpToolCall';

      if (e.subtype === 'started') {
        return [
          ...pending(),
          {
            type: 'tool.call',
            name: mcp ? call.args?.toolName : kind.replace(/ToolCall$/, ''),
            input: mcp ? call.args?.args ?? {} : call.args ?? {},
            callId: e.call_id,
          },
        ];
      }

      if (e.subtype === 'completed') {
        const result = call.result ?? {};
        const content = Array.isArray(result.success?.content)
          ? result.success.content.map((c) => c.text?.text ?? '').join('')
          : '';
        return [
          {
            type: 'tool.result',
            callId: e.call_id,
            ok: Boolean(result.success) && !result.success.isError,
            summary: (content || String(result.rejected?.reason ?? result.error?.message ?? '')).slice(0, SUMMARY),
          },
        ];
      }
      return [];
    }

    case 'result': {
      const usage = e.usage ?? {};
      return [
        ...pending(),
        { type: 'usage', inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null },
        e.is_error
          ? { type: 'done', ok: false, error: String(e.result || 'Cursor reported an error') }
          : { type: 'done', ok: true },
      ];
    }

    default:
      return [];
  }
}

export function createCursorProvider({ exec = runCommand, env = process.env, defaultModel = 'composer-2.5', hookPath = HOOK } = {}) {
  return {
    id: 'cursor',
    label: 'Cursor',

    async detect() {
      const probe = await exec('cursor-agent', ['status']);
      if (probe.missing) return { installed: false, signedIn: false, detail: 'cursor-agent is not installed' };
      const account = /Logged in as (\S+)/.exec(`${probe.stdout}\n${probe.stderr}`)?.[1];
      if (account) return { installed: true, signedIn: true, detail: `signed in as ${account}` };
      return {
        installed: true,
        signedIn: false,
        detail: probe.timedOut ? 'cursor-agent status timed out' : 'run `cursor-agent login`',
      };
    },

    async prepare({ workspace, mcp }) {
      const dir = path.join(workspace, '.cursor');
      await fsp.mkdir(dir, { recursive: true });

      const mcpFile = path.join(dir, 'mcp.json');
      const config = { mcpServers: { marble: { command: mcp.command, args: mcp.args, env: mcp.env } } };
      await fsp.writeFile(mcpFile, JSON.stringify(config, null, 2), { mode: 0o600 });
      await fsp.chmod(mcpFile, 0o600);

      const hooks = {
        version: 1,
        hooks: { preToolUse: [{ command: `"${process.execPath}" "${hookPath}"`, failClosed: true }] },
      };
      await fsp.writeFile(path.join(dir, 'hooks.json'), JSON.stringify(hooks, null, 2));
      await fsp.writeFile(path.join(workspace, 'AGENTS.md'), INSTRUCTIONS);
    },

    spawn({ workspace, prompt, resume = null, model = null }) {
      const args = [
        '-p', '--output-format', 'stream-json', '--stream-partial-output', '--approve-mcps', '--trust',
        '--workspace', workspace, '--model', model ?? defaultModel,
      ];
      if (resume) args.push('--resume', resume);
      args.push(prompt);
      return {
        command: 'cursor-agent',
        args,
        env: env.CURSOR_API_KEY ? { CURSOR_API_KEY: env.CURSOR_API_KEY } : {},
        stdin: '',
      };
    },

    parse: (line, state) => parseCursorLine(line, state),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `chmod +x bin/marble-cursor-hook.js && node --test --test-reporter=spec test/agent-provider-cursor.test.js && npm test`
Expected: PASS — 11 new tests; full suite 281.

- [ ] **Step 6: Commit**

```bash
git add server/agent/providers/cursor.js bin/marble-cursor-hook.js test/agent-provider-cursor.test.js
git commit -m "Agents providers: Cursor, held to Marble's tools by a fail-closed hook"
```

---

### Task 4: Register the providers, try one for real, and document it

**Files:**
- Modify: `server/agent/providers/index.js`
- Create: `server/agent/try.js`
- Modify: `bin/marble-drive.js`, `package.json`
- Modify: `docs/AGENTS.md` (the `## Providers` section)
- Test: `test/agent-try.test.js`

**Interfaces:**
- Consumes: Tasks 2–3 provider factories; Plan 1 `createDrive(config, { log, agentProviders })`, `loadConfig(env)`, `drive.agents`, `drive.agentsWhy`, `drive.createDocument`, the `/agent/*` routes; `test/fixtures/fake-provider.js` `createFakeProvider({scripts})`.
- Produces:
  - `builtInProviders({ env = process.env } = {}) → Map` with keys `claude-subscription`, `claude-api`, `cursor` in that order.
  - `tryProvider({ providerId, providers = builtInProviders(), prompt = DEFAULT_PROMPT, model = null, timeoutMs = 180_000 }) → Promise<{ status, error, applied, heading, costUsd, events: string[] }>` — builds a scratch drive (temp root, temp workdir, agents on, loopback, no secret) holding one document `garden` whose `<h1 data-marble-id="h">` says `Research Garden`, runs one turn through HTTP, and removes the scratch directories. Throws when the provider id is unknown or agents cannot start.
  - CLI: `marble-drive agents providers` (one line per provider: id, `ready` | `signed out` | `not installed`, detail) and `marble-drive agents try <provider> [--prompt=…] [--model=…]` (exit 1 unless the turn completed); `npm run agents -- <args>`.

- [ ] **Step 1: Write the failing test**

Create `test/agent-try.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

const { builtInProviders } = await import('../server/agent/providers/index.js');
const { tryProvider } = await import('../server/agent/try.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

test('the built-in providers are Claude on either billing, and Cursor', () => {
  const providers = builtInProviders({ env: {} });
  assert.deepEqual([...providers.keys()], ['claude-subscription', 'claude-api', 'cursor']);
  for (const provider of providers.values()) {
    for (const member of ['detect', 'prepare', 'spawn', 'parse']) assert.equal(typeof provider[member], 'function', `${provider.id}.${member}`);
  }
});

test('a try runs one real turn against a scratch drive and reports what it did', async () => {
  const scripts = {
    rename: [
      { call: 'read_document', args: { path: 'garden' } },
      { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
      { say: 'Renamed the heading.' },
    ],
  };
  const result = await tryProvider({
    providerId: 'fake',
    providers: new Map([['fake', createFakeProvider({ scripts })]]),
    prompt: 'script:rename',
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.applied, 1);
  assert.equal(result.heading, 'Backlog');
  assert.ok(result.events.includes('tool.call'));
  assert.ok(result.events.includes('ops.applied'));
});

test('a try that fails says why', async () => {
  const result = await tryProvider({
    providerId: 'fake',
    providers: new Map([['fake', createFakeProvider({ scripts: { broken: [{ fail: 'You have hit your usage limit' }] } })]]),
    prompt: 'script:broken',
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'You have hit your usage limit');
  assert.equal(result.heading, 'Research Garden');
});

test('an unknown provider is refused before anything starts', async () => {
  await assert.rejects(tryProvider({ providerId: 'nope', providers: new Map() }), /no provider "nope"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=spec test/agent-try.test.js`
Expected: FAIL — the registry test fails on an empty Map, and `Cannot find module '…/server/agent/try.js'`.

- [ ] **Step 3: Register the providers**

Replace the whole of `server/agent/providers/index.js` with:

```js
// The agent CLIs this host knows how to run. Each is an adapter to the
// runner's contract (see server/agent/runner.js and docs/AGENTS.md); which of
// them is usable on this machine is `detect()`'s answer, not this list's.
//
// Codex is not here yet: its plan was at its usage limit until 2026-10-15, so
// its adapter could not be verified against a real run (Plan 5).

import { createClaudeProvider } from './claude.js';
import { createCursorProvider } from './cursor.js';

export const builtInProviders = ({ env = process.env } = {}) =>
  new Map([
    ['claude-subscription', createClaudeProvider({ auth: 'subscription', env })],
    ['claude-api', createClaudeProvider({ auth: 'api', env })],
    ['cursor', createCursorProvider({ env })],
  ]);
```

- [ ] **Step 4: Implement `server/agent/try.js`**

```js
// One real turn, to find out whether a provider works on this machine.
//
// It never touches your drive. A scratch drive is made in a temp directory
// with one document in it, agents are switched on for that host only, the
// turn runs through the same HTTP surface the drawer will use, and the scratch
// directories are removed afterwards. What comes back is what a person would
// want to know: did it finish, did it change the document, what did it cost.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createDrive } from '../app.js';
import { loadConfig } from '../config.js';
import { builtInProviders } from './providers/index.js';

export const DEFAULT_PROMPT = 'Rename the heading of this document to "Backlog". Change nothing else.';

const SOURCE = `<!doctype html>
<html><head><title>Garden</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Research Garden</h1>
  <ul data-marble-id="q">
    <li data-marble-id="q1">Why do people stop using a tool?</li>
  </ul>
</body></html>
`;

const quiet = { log() {}, error() {} };

export async function tryProvider({
  providerId,
  providers = builtInProviders(),
  prompt = DEFAULT_PROMPT,
  model = null,
  timeoutMs = 180_000,
}) {
  if (!providers.has(providerId)) throw new Error(`no provider "${providerId}" — there is: ${[...providers.keys()].join(', ')}`);

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-try-drive-'));
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-try-work-'));
  let drive = null;

  try {
    const config = loadConfig({
      ...process.env,
      MARBLE_DRIVE_ROOT: root,
      MARBLE_DRIVE_DATA: '',
      MARBLE_DRIVE_SECRET: '',
      HOST: '127.0.0.1',
      MARBLE_DRIVE_AGENTS: '1',
      MARBLE_DRIVE_AGENT_PROVIDER: providerId,
      MARBLE_DRIVE_AGENT_WORKDIR: workdir,
      MARBLE_DRIVE_BACKUP_DIR: '',
      MARBLE_DRIVE_BACKUP_CMD: '',
    });
    drive = await createDrive(config, { log: quiet, agentProviders: providers });
    if (!drive.agents) throw new Error(`agents could not start: ${drive.agentsWhy}`);
    await drive.createDocument('garden', SOURCE, { label: 'try' });

    const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
    const base = `http://127.0.0.1:${port}`;
    const call = async (method, route, body) => {
      const response = await fetch(base + route, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const answer = await response.json();
      if (!response.ok) throw new Error(answer.error ?? `${route} answered ${response.status}`);
      return answer;
    };

    const conversation = await call('POST', '/agent/conversations', { provider: providerId, ...(model ? { model } : {}) });
    const { turnId } = await call('POST', `/agent/conversations/${conversation.id}/turns`, {
      prompt,
      context: { target: 'garden', viewing: 'garden', selection: [] },
    });

    const deadline = Date.now() + timeoutMs;
    let snapshot;
    for (;;) {
      snapshot = await call('GET', `/agent/conversations/${conversation.id}`);
      const turn = snapshot.turns.find((t) => t.id === turnId);
      if (turn && !['queued', 'running'].includes(turn.status)) break;
      if (Date.now() > deadline) {
        await call('POST', `/agent/turns/${turnId}/cancel`);
        throw new Error(`the turn did not finish within ${Math.round(timeoutMs / 1000)} s`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const turn = snapshot.turns.find((t) => t.id === turnId);
    const source = await drive.store.read('garden');
    return {
      status: turn.status,
      error: turn.error,
      applied: turn.applied,
      heading: /<h1 data-marble-id="h">([^<]*)<\/h1>/.exec(source)?.[1] ?? null,
      costUsd: turn.usage?.costUsd ?? null,
      events: snapshot.events.map((e) => e.type),
    };
  } finally {
    await drive?.close();
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(workdir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Add the command**

In `bin/marble-drive.js`:

Add to the header comment, after the `remote` line:

```js
//   marble-drive agents providers    which agent CLIs are installed and signed in
//   marble-drive agents try <id>     one real turn against a scratch drive
```

Add to the imports:

```js
import { builtInProviders } from '../server/agent/providers/index.js';
import { tryProvider } from '../server/agent/try.js';
```

Add a case before `case 'starters':`:

```js
  case 'agents':
    await agentsCommand();
    break;
```

Add `agents` to the list in the `default:` failure message, after `remote`.

Append at the end of the file:

```js
// --------------------------------------------------------------------- agents

/** The agent CLIs on this machine, and a way to watch one work before trusting
 *  it with a real drive. `try` spends that provider's quota on one small turn. */
async function agentsCommand() {
  const sub = args[0];

  if (sub === 'providers') {
    for (const provider of builtInProviders().values()) {
      const found = await provider.detect();
      const state = !found.installed ? 'not installed' : found.signedIn ? 'ready' : 'signed out';
      console.log(`  ${provider.id.padEnd(20)} ${state.padEnd(14)} ${found.detail}`);
    }
    return;
  }

  if (sub === 'try') {
    const id = args[1];
    if (!id) fail('usage: marble-drive agents try <provider> [--prompt="…"] [--model=…]');
    console.log(`[drive] one real turn on ${id}, against a scratch drive — this uses that provider's quota\n`);
    const result = await tryProvider({
      providerId: id,
      prompt: typeof flags.prompt === 'string' ? flags.prompt : undefined,
      model: typeof flags.model === 'string' ? flags.model : null,
    });
    console.log(`  status    ${result.status}${result.error ? `  — ${result.error}` : ''}`);
    console.log(`  applied   ${result.applied} op(s)`);
    console.log(`  heading   ${result.heading}`);
    if (result.costUsd !== null) console.log(`  cost      $${result.costUsd.toFixed(4)}`);
    console.log(`  events    ${result.events.join(' → ')}`);
    if (result.status !== 'completed') process.exit(1);
    return;
  }

  fail(`no "agents ${sub ?? ''}" — there is: providers, try`);
}
```

In `package.json` `scripts`, after `"remote"`, add:

```json
    "agents": "node --env-file-if-exists=.env --env-file-if-exists=.env.local bin/marble-drive.js agents",
```

- [ ] **Step 6: Update `docs/AGENTS.md`**

Replace the `## Providers` section (from its heading up to `## Not yet`) with:

````markdown
## Providers

| id | runs | boundary |
|---|---|---|
| `claude-subscription` | `claude -p`, prompt on stdin, no `ANTHROPIC_API_KEY` in its environment, so the CLI's login is used | `--tools ""` and `--strict-mcp-config`: it has no tool but Marble's |
| `claude-api` | the same, with `ANTHROPIC_API_KEY` | the same |
| `cursor` | `cursor-agent -p`, model `composer-2.5` unless the conversation names one | `.cursor/hooks.json` `preToolUse`, fail-closed, allowing only Marble's five tools (`bin/marble-cursor-hook.js`) |

Every agent gets the same rules (`server/agent/instructions.js`). Each turn,
`prepare` rewrites the workspace's MCP config with that turn's token (mode 600).

```
npm run agents -- providers              what is installed and signed in
npm run agents -- try claude-subscription one real turn on a scratch drive
npm run agents -- try cursor --model=composer-2.5
```

A provider is `{ id, label, detect, prepare, spawn, parse }`. Its parser is
tested against streams recorded from real runs in `test/fixtures/providers/`;
record a new one when a CLI changes its output. Codex arrives in Plan 5.
````

- [ ] **Step 7: Run the tests**

Run: `node --test --test-reporter=spec test/agent-try.test.js && npm test`
Expected: PASS — 4 new tests; full suite 285.

- [ ] **Step 8: Check the providers on this machine, then one real turn each**

These spend a little real quota and are the plan's live verification (spec §14). Never use port 4400.

Run: `node bin/marble-drive.js agents providers`
Expected: `claude-subscription` ready, `claude-api` ready or signed out depending on `ANTHROPIC_API_KEY`, `cursor` ready.

Run: `node bin/marble-drive.js agents try claude-subscription --model=claude-haiku-4-5`
Expected: `status completed`, `applied 1 op(s)` (or more), `heading Backlog`, events including `tool.call`, `ops.applied`, `turn.completed`.

Run: `node bin/marble-drive.js agents try cursor`
Expected: the same shape. If Cursor reports a usage limit, record the exact message in the report — that is a provider state, not a code failure.

Confirm afterwards: `pgrep -fl "marble-mcp|claude -p|cursor-agent -p"` shows nothing started by these runs.

- [ ] **Step 9: Commit**

```bash
git add server/agent/providers/index.js server/agent/try.js bin/marble-drive.js package.json docs/AGENTS.md test/agent-try.test.js
git commit -m "Agents providers: registered, and tried for real from the command line"
```

---

## After this plan

- **Plan 3 — Drawer:** `runtime/agent.js` (`window.marble.agent`), `runtime/agent-ui.js`, injection, watchdog Restore, provider picker from `/agent/providers`.
- **Plan 4 — `Agents.mrbl`:** library ⇄ board with the FLIP toggle.
- **Plan 5 — Codex:** adapter behind experimental; record a stream when the quota returns (2026-10-15).
- Deferred from Plan 1: a turn's target following a move/trash (spec §6.1).
