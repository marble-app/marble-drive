# Codex agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex runs as a Marble agent beside Claude — on an OpenAI API key or the ChatGPT login — with the setup popup, settings, composer and naming all working for either, on every drive.

**Architecture:** A new provider `server/agent/providers/codex.js` adapts `codex exec --json` (what `@openai/codex-sdk` wraps) to the runner's `{detect, prepare, spawn, parse, lostSession}` contract. The key store gains an `openai` field passed as `CODEX_API_KEY`; `/agent/setup` learns to connect either agent. `runtime/agent-ui.js` names, brands and presets Codex, and its popup offers the choice. Sprite releases install a pinned `@openai/codex`.

**Tech Stack:** Node 22 ESM, `node:test`, Playwright browser tests, bash release scripts, Codex CLI 0.159.3.

**Spec:** `docs/superpowers/specs/2026-10-01-codex-agent-design.md`

## Global Constraints

- Provider id `codex`, label `Codex`. One id; the key wins when set.
- The key reaches Codex only as `CODEX_API_KEY`, only in the child's environment, never argv, never a response body.
- Marble's MCP servers are named `marble_drive` and `marble_browser` in Codex config (the person may have their own `marble`).
- Modes, in order: `full` "Full access" (default), `workspace` "Workspace", `read` "Read only".
- Models: `codex debug models`, entries with `visibility: "list"`, in catalog order; efforts per model.
- Naming via Codex runs with no key in its environment.
- Pinned Codex: `tools/sprite/codex-version` = `0.159.3`.
- Words on screen follow Design Don'ts `#words`; the popup keeps its current look.

## Review Focus

1. A resumed Codex thread that the CLI no longer has (drive moved Mac ↔ Fly) — the turn says so and the next message starts fresh (`lostSession`).
2. A Codex turn whose key is wrong — fails once, with OpenAI's message, not five "Reconnecting…" lines in the transcript.
3. A drive with only Codex usable — no Connect popup, new chats default to Codex, Claude-only presets hidden.
4. Instructions or paths with quotes, newlines or spaces — passed as valid TOML through `-c`.
5. A host where `codex` is not installed — `detect` says so, the popup offers Claude only, nothing throws.

---

### Task 1: The Codex provider

**Files:**
- Create: `server/agent/providers/codex.js`
- Modify: `server/agent/providers/index.js` (register), `server/agent/catalog.js` (`CODEX_MODES`, picker order), `server/agent/runner.js:606` (pass `browser` to `spawn`)
- Create: `test/fixtures/providers/codex-1.jsonl`, `codex-2.jsonl`, `codex-3.jsonl` (recorded 2026-10-01: tools turn, resumed turn, bad key)
- Test: `test/agent-provider-codex.test.js`

**Interfaces:**
- Produces: `createCodexProvider({ exec, env, secrets })` → provider `{ id:'codex', label:'Codex', capability:'full', modes: CODEX_MODES, efforts, listModels(), detect(), prepare(), spawn(), parse(), lostSession() }`; `parseCodexLine(line, state)`; `parseCodexModels(json)`; `codexArgs(...)` is internal.
- `CODEX_MODES = [{id:'full',label:'Full access'},{id:'workspace',label:'Workspace'},{id:'read',label:'Read only'}]` exported from `catalog.js`.
- `spawn({ workspace, prompt, resume, model, effort, mode, capability, kind, cwd, mcp, browser })` returns `{ command:'codex', args, env, stdin: prompt, cwd? }`.

- [ ] **Step 1: Record the fixtures** from real runs (`codex exec --json …` against a stub MCP server named `marble_drive`), trimming nothing but home paths.
- [ ] **Step 2: Write the failing tests** — parse each fixture to the brief `['session','text:…','call:Bash','result:true','call:read_document','result:true','text:…','usage','done:true']`; the bad-key fixture to `['session', 'done:false']` with the 401 message and no text from "Reconnecting"; `spawn` args for a fresh turn (`exec --json --skip-git-repo-check -C <cwd> -s danger-full-access … -m <model> -c model_reasoning_effort="high" -c developer_instructions=… -c mcp_servers.marble_drive.env_vars=[…] -`), for a resumed turn (`… resume <id> -`), each mode's sandbox flag, the key only in `env.CODEX_API_KEY`, TOML quoting of a path with a space and quotes; `detect` for missing CLI / key set / ChatGPT login / signed out; `parseCodexModels` keeps `list` only with nested efforts; `lostSession('no rollout found for thread id …')`.
- [ ] **Step 3: Run** `node --test test/agent-provider-codex.test.js` — FAIL (module missing).
- [ ] **Step 4: Implement** `codex.js` (parser maps `thread.started`→session, `agent_message`→text, `command_execution`→Bash, `mcp_tool_call`→its tool, `file_change`→Edit, `web_search`→WebSearch, `turn.completed`→usage+done, `turn.failed`→done false; ignores `error` events that are retries and `reasoning`), register it, add `CODEX_MODES`, pass `browser` from the runner.
- [ ] **Step 5: Run** the provider, runner and catalog tests — PASS.
- [ ] **Step 6: Commit** `Codex as an agent: codex exec --json behind the provider contract`.

### Task 2: An OpenAI key, checked, and setup for either agent

**Files:**
- Modify: `server/agent/keys.js` (`openai` → `CODEX_API_KEY`), `server/agent/key-check.js` (`checkOpenAIKey`), `server/config.js` (`openaiBase` from `MARBLE_DRIVE_OPENAI_BASE`), `server/agent/index.js` (pass it), `server/agent/routes.js` (`setupState`, `POST /agent/setup {provider,key}`, `publicSettings` flags), `runtime/agent-ui.js` api (`connectAgent(provider, key)`)
- Test: `test/agent-keys.test.js`, `test/agent-setup.test.js`

**Interfaces:**
- `GET /agent/setup` → `{ needed, login, key, claudeAuth, offers: ['claude','codex'], codex: { installed, signedIn, key } }`. `needed` is true only when no offered agent is usable. `offers` lists `codex` only when it is installed.
- `POST /agent/setup { provider: 'claude'|'codex', key }` — `provider` defaults to `claude`; checks with Anthropic or OpenAI; a kept Codex key makes `codex` the default agent when the current default is not usable.
- `checkOpenAIKey(key, { baseURL, timeoutMs })` → `'ok'|'rejected'|'unchecked'` via `GET {base}/v1/models`.

- [ ] **Step 1: Failing tests** — keys round-trip `openai`; `asEnv()` gives `CODEX_API_KEY`; setup: a Codex-only signed-in drive asks nothing; a drive with neither asks and offers both; a good OpenAI key (fake server checks `Authorization: Bearer`) is kept, `keys.openai` true, default becomes `codex`; a refused one is not kept (400, "OpenAI didn't accept"); the key never appears in a response.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `An OpenAI key for Codex, checked before it is kept; setup connects either agent`.

### Task 3: The interface knows Codex

**Files:**
- Modify: `runtime/agent-ui.js` — `PICKER_PROVIDER_ORDER`, `BRAND.codex`, `PRESETS` (a `codex-high` setup between Grok and Opus), `EFFORT_WORD` (`max`, `ultra`), `providerHue`, `KNOWN_PROVIDERS`, `preferredProvider` (Codex when Claude is spent and Cursor is absent), `resolvePresetModel` / `presetShownName` / `markCustomSetup` for Codex, settings panel (OpenAI key row, Projects hint), `<marble-agent-setup>` (agent choice when `offers` has two, words and links per agent).
- Test: `test-browser/agent-setup.test.js`, `test-browser/composer-setups.test.js`

- [ ] **Step 1: Failing browser tests** — with `offers:['claude','codex']` the popup is titled "Connect an agent", Codex chosen shows "OpenAI API key" and the platform.openai.com link, a pasted `sk-ant-` key moves the choice to Claude; with Claude only it still reads "Connect Claude". Composer: a signed-in Codex adds a setup named from the catalog ("GPT-6-Astra High") with the Codex mark.
- [ ] **Step 2: Run** `node tools/browser-tests.mjs test-browser/agent-setup.test.js test-browser/composer-setups.test.js` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Render** the popup and composer in both schemes at phone and desk widths; run the Design Don'ts scan on the changed words.
- [ ] **Step 6: Commit** `The drawer, settings and Connect popup offer Codex beside Claude`.

### Task 4: Naming falls back to Codex

**Files:** Modify `server/agent/namer.js`; Test `test/agent-namer.test.js`.

- [ ] **Step 1: Failing test** — tried order is `['claude','cursor-agent','codex']`, the Codex attempt's env has no `CODEX_API_KEY`, and a Codex answer becomes the title.
- [ ] **Step 2–4:** run, implement (`codex exec --skip-git-repo-check --ephemeral -s read-only --ignore-user-config -c model_reasoning_effort="low" -`, prompt on stdin through `exec`'s `input` or as the last argument), run.
- [ ] **Step 5: Commit** `A chat on a Codex-only drive still gets a name`.

### Task 5: Every release carries Codex

**Files:** Create `tools/sprite/codex-version`; modify `tools/sprite/release.sh` (stage takes `<codex>`, installs `@openai/codex@$codex`, checks `codex --version`), `tools/sprite-deploy.sh` (reads the pin, `--codex <v>`, passes it), `docs/AGENTS.md`, `docs/HOSTING.md`, `CLAUDE.md` (pin rule).

- [ ] **Step 1:** `bash -n` both scripts; `tools/sprite-deploy.sh t-bryan --print-plan` shows the Codex version.
- [ ] **Step 2: Commit** `Sprite releases install the pinned Codex CLI`.

### Task 6: Live verification

- [ ] `npm test`; the touched browser tests.
- [ ] `npm run agents -- try codex` on a scratch drive (ChatGPT login): reads and edits a document through `marble_drive`, resume works.
- [ ] `tools/sprite-deploy.sh t-bryan --local`; on t-bryan, Codex detects as installed; with no key the popup offers it; a turn with an OpenAI key if one is available, else confirm the refusal path.
- [ ] Fresh reviewer over the branch; fix what holds up.

### Task 7: Ship

- [ ] Push `main`. `tools/sprite-deploy.sh --all --when-idle`, then `tools/sprite-deploy.sh admin-p2`, then the Mac release detached with its wait-for-idle. Report what shipped and where.
