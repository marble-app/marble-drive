# Agents at terminal parity — design

> Status: **draft for review**, 2026-09-18. Supersedes
> [`2026-09-17-agent-full-code-expression-design.md`](2026-09-17-agent-full-code-expression-design.md)
> §3.1, §4, §8, §9 and §10, and the 2026-09-16 design's §2.3, where they differ.
> Everything else in those documents still stands: ops are the only way a
> `documents` agent writes, stale ops are refused, one store two interfaces,
> agent chrome is transient, agents run for one owner on a loopback host.

## 1. What we are building

An agent started from Marble is the same agent the person gets by typing
`claude` or `cursor-agent` in a terminal — the same tools, the same skills,
plugins, hooks, memory and MCP servers, the same subagents, the same permission
prompts and clarifying questions — plus Marble's document tools. It works in a
**project**: the drive, or any directory the owner registers. Two conversations
never wear each other's events, and a long implementation turn is never killed
for being long.

The goal, in the owner's words: *prompt in Marble instead of relying on the
terminal.*

## 2. What is wrong today, with evidence

The evidence is the drive's own `.marble/agents/` store (17 conversations,
70 turns) and two probes of `claude` 2.1.276 on 2026-09-18.

1. **The Claude launch strips the harness.** A `full` Claude turn runs
   `--restricted --tools <nine names> --strict-mcp-config`. `--restricted`
   ignores user and project settings, so the person's plugins (superpowers,
   marble, frontend-design, …), `~/.claude/skills`, `CLAUDE.md`, hooks, memory
   and MCP servers never load, and `--tools` leaves out `Task` (subagents),
   `Skill`, `AskUserQuestion`, `Workflow`, `ToolSearch`, `NotebookEdit` and the
   rest. Probed unrestricted from a scratch directory, the same CLI reported 30
   tools, every plugin skill, three custom agents and a running SessionStart
   hook. Conversation `d394843c` has Claude describing itself as having "no
   shell, no subagents, five document tools".
2. **The drive is the only project.** cwd is `drive/` and the file tools are
   confined there. Every substantial conversation in the store —
   `12f6c0f1` (conversation controls), `b4c2f6f0` (Folders and Focus),
   `787e0a0e` — was work on the **marble-drive repository**, reachable only
   because Cursor's tools are not confined and the drive happens to sit inside
   the repo. Any other repository is out of reach. Meanwhile every turn's
   prompt says "The document you may edit: Agents", which is how turn
   `b4c2f6f0-t18` ended with the agent overwriting the live `Agents.mrbl`.
3. **Timers kill real work.** `took longer than 30 min` cancelled two
   implementation turns (`12f6c0f1-t9`, `b4c2f6f0-t14`); `stalled — no output
   for 600 s` killed a third while a subagent worked silently
   (`12f6c0f1-t11`). The terminal has neither limit.
4. **Context bleeds between conversations.**
   - The watchdog fanned out to every running turn: `347957892a54-t7` and
     `6af6dec32699-t1` both carry `watchdog` events for
     `Research/TypeSafe AI/Run` with identical timestamps. The uncommitted
     `ownsPath` change in `server/agent/runner.js` fixes this and the sibling
     bug in `documentTouched`; it is not committed.
   - Two conversations shared one git checkout: in `b4c2f6f0-t17` the agent
     stashed and restored the *other* conversation's uncommitted work to
     complete its merge.
   - The page context is frozen into every prompt whether or not it is
     relevant, pulling a repository conversation back toward document editing.
5. **The catalog is stale.** Models read Sonnet 4.5 / Opus 4.1 / Fable 5; the
   terminal default on this machine is `claude-fable-5-1[1m]`. The Claude
   mode list has no `auto`, which is what the terminal runs.

## 3. Principles

Replacing §3.1 of the 2026-09-17 design:

1. **Launch the CLI the way the terminal does, then add Marble.** A `full`
   agent loads the person's own configuration. Isolation from the machine was
   the 2026-09-17 boundary; it is exactly what made the agent weaker than the
   terminal, and it is dropped on purpose. Marble's MCP server is *added* with
   `--mcp-config`, never `--strict-mcp-config`.
2. **A conversation works in a project.** The drive is one project. The
   working directory decides what the file tools see, where the CLI keeps its
   session and memory, and which `CLAUDE.md` loads — the same as `cd` in a
   terminal.
3. **A prompt the person must answer reaches the person.** Permission prompts
   and `AskUserQuestion` come to the drawer instead of being denied or absent.
4. **The person stops a turn; a timer does not.** Limits exist to catch a
   hung process, not to bound work.
5. **Nothing one conversation does is recorded on another.** Ownership of
   writes and watchdog flags is by path, and a conversation is told who else is
   working in its project.

Unchanged: `documents` capability and `MARBLE_DRIVE_AGENT_POWER=documents`
remain the tools-only boundary and the rollback.

## 4. Projects

### 4.1 Model

```
settings.json
  projects: [{ id, name, path }]      // the drive is always present as id "drive"
  defaultProject: "drive"
meta.json (conversation)
  project: "drive" | <project id>     // fixed at creation; absent means "drive"
```

- `drive` is synthesized from `config.root`, cannot be removed or renamed, and
  is not stored.
- `POST /agent/projects { name, path }` validates: absolute path, exists, is a
  directory, is not the drive or inside the drive's `.marble`. Duplicated paths
  return the existing project. `DELETE /agent/projects/:id` refuses `drive`
  and does not touch conversations that name the project; they keep running
  there (the path is resolved at turn start and a missing directory fails the
  turn with a plain message).
- `POST /agent/conversations` accepts `project`; unknown ids are 400. The
  default is `settings.defaultProject`, then `drive`.
- `window.marble.agent` gains `projects()`, `addProject({ name, path })`,
  `removeProject(id)`, and `start({ project })`.

### 4.2 Working directory

A `full` turn's cwd is the project path. For the drive project this is what
happens today. For any other project the CLI's session files, auto-memory and
`CLAUDE.md` discovery are the project's own — so `claude --resume` in a
terminal can pick up a Marble conversation, and a memory the agent saved from
Marble is there in the terminal. That is intended and documented.

A `documents` turn keeps its empty workspace as cwd, unchanged.

### 4.3 Picker

The composer's `.setup` block gains a **Project** segmented control beside
CLI, Model and Effort, on the Agents page and in the drawer. It lists the
drive first, then registered projects in name order, then **Add…** which
takes a path and a name in the settings panel. The drawer defaults to the
drive; the Agents page defaults to `settings.defaultProject`. Once a
conversation has a project the control shows it read-only in the mast
(`marble-drive · Claude · Fable 5.1`).

### 4.4 Prompt context by project

`composePrompt` writes one of two context blocks.

For the drive project, today's block, unchanged: viewing, target, also,
selection source, handoff brief, steer wrap.

For any other project:

```
---
Sent from Marble Drive. The person was viewing the document "<viewing>"
(on disk at <absolute path>) when they sent this. Marble's document tools
can read and edit it; use them only if the request is about that document.
```

plus the selection source if there is one, the handoff brief and the steer
wrap. No "document you may edit" line — a `full` agent may edit anything in
its project.

Both blocks end with, when true:

```
<n> other agent conversation(s) are running in this project right now. Do
not stash, reset, check out or discard changes you did not make.
```

The count is the runner's other running turns with the same project.

### 4.5 Ownership

The uncommitted `ownsPath` change is the rule, committed as the first step:
a `document.changed` is credited to the running full turn that owns the path
(target, created, earlier writes), else to the only running full turn, else
to nobody; a `watchdog` goes only to `documents` turns that own the path.
Ownership is per conversation, never per project.

Marble does not create git worktrees per conversation. The two skills the
person already uses (`using-git-worktrees`, `subagent-driven-development`)
make that call better than a host can, and the `b4c2f6f0-t17` incident
happened *despite* a worktree, at merge time. The warning line in §4.4 is the
countermeasure, and "Also working here" in the mast (§8) is the visibility.

## 5. The Claude spawn

### 5.1 Verified, 2026-09-18, `claude` 2.1.276

| Question | Result |
|---|---|
| Unrestricted `-p` from a scratch cwd: which tools? | 30, including `Task`, `Skill`, `Workflow`, `ToolSearch`, `NotebookEdit`, `WebSearch`, `WebFetch` |
| Do plugins, skills, hooks and custom agents load? | Yes: `slash_commands` listed every plugin skill; `agents` listed the person's three; a `SessionStart` hook ran |
| `--permission-mode auto` accepted? | Yes (choices: `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`) |
| Does `--input-format stream-json` with `--permission-prompts host` alone send prompts to stdin/stdout? | No: `AskUserQuestion` absent, no `control_request` |
| …with `--permission-prompt-tool stdio` and an `initialize` control request first? | Yes: `AskUserQuestion` present (33 tools); a `control_request { subtype: "can_use_tool", tool_name, input, tool_use_id }` arrives on stdout and a `control_response { behavior: "allow", updatedInput }` on stdin answers it; the turn continued with "You chose Option A." |
| Does the `initialize` response carry anything useful? | Yes: `commands` — the CLI's own list of skills with descriptions |

### 5.2 Invocation

```
cwd = <project path>

claude -p --output-format stream-json --input-format stream-json --verbose
  --include-partial-messages
  --permission-mode <mode>                 # conversation mode; default auto
  --permission-prompts host --permission-prompt-tool stdio
  --mcp-config <workspace>/mcp.json        # Marble's server, added to the person's own
  --append-system-prompt <INSTRUCTIONS for the project kind>
  [--model <id>] [--effort <level>] [--resume <session>]
  [--allow-dangerously-skip-permissions]   # only with bypassPermissions
```

Gone: `--restricted`, `--tools`, `--settings <workspace>/settings.json`,
`--permission-prompts none`, `--strict-mcp-config`, `--setting-sources`. The
per-turn `settings.json` is no longer written. `mcp.json` still is, mode 600,
with the turn token, and the workspace stays outside the drive.

stdin carries, in order, an `initialize` control request, then the prompt as
a `user` message, and then stays **open** for the turn so control responses
can be written (§6). It is closed when the turn ends.

No `--model` and no `--effort` when the conversation has none: the person's
own `settings.json` model and effort apply, which is the terminal default.
The catalog's empty choice is labelled **Terminal default**.

### 5.3 Modes

`CLAUDE_MODES` becomes `auto` (Auto — default), `acceptEdits` (Accept edits),
`plan` (Plan), `manual` (Ask me), `bypassPermissions` (Bypass permissions).
A stored `default` or null runs as `auto`. `dontAsk` is not offered: it is
`auto` with the prompts denied, and §6 makes the prompts answerable.

### 5.4 Models

`CLAUDE_MODELS` becomes `haiku` Haiku 4.5, `sonnet` Sonnet 5, `opus` Opus 5,
`fable` Fable 5.1, plus the empty **Terminal default**. Aliases are passed as
they are; the CLI resolves them.

### 5.5 Skills menu

The composer's `/` menu for Claude is fed from the CLI's own list: the
runner records `slash_commands` from each turn's `init` event into
`settings.skills[provider]` (name and description, the description from the
`initialize` response's `commands` when present). Until a turn has run, the
directory scan in `server/agent/skills.js` is the fallback. `installSkills`
(copying skills into the workspace) is deleted: the CLI loads them itself.

### 5.6 Parse

`parseClaudeLine` gains:

- `control_request` with `subtype: "can_use_tool"` →
  `{ type: 'ask', requestId, tool, displayName, input, interactive }`.
- `control_response` answering the `initialize` request →
  `{ type: 'catalog', skills }` from its `commands`; any other
  `control_response` → nothing.
- `system` `init` → `session` as today, plus `{ type: 'catalog', skills, agents }`
  from `slash_commands` and `agents` (names only; the `initialize` response
  supplies descriptions and wins when both arrive).
- `stream_event`, `assistant` and `user` lines with `parent_tool_use_id` are
  still dropped from the transcript, but every line still resets the stall
  timer, so a working subagent is not a stall.

## 6. Asks: prompts and questions that reach the person

### 6.1 Events

```
ask           { turn, requestId, kind: 'permission' | 'question', tool, displayName, input }
ask.answered  { turn, requestId, response }          // response is what was sent back
ask.void      { turn, requestId, why: 'cancelled' | 'ended' | 'timeout' }
```

`kind` is `question` when `tool` is `AskUserQuestion`, else `permission`.
The turn keeps `asks: Map<requestId, { event, answered }>` in memory; the
conversation summary carries `asking: true` while any ask is open, so lists,
boards and Focus cards can show **Needs you** (a new outcome-like state,
drawn like `needsReview`, cleared when answered).

### 6.2 Answering

`POST /agent/turns/:id/answer { requestId, response }` → `runner.answer()`
writes `{ type: 'control_response', response: { subtype: 'success',
request_id, response } }` to the child's stdin, appends `ask.answered`, and
resolves. A second answer, an unknown request, or a turn that is not running
is 409. `window.marble.agent.answer(turnId, requestId, response)`.

Responses the drawer sends:

| Button | `response` |
|---|---|
| Allow | `{ behavior: 'allow' }` |
| Allow and don't ask again this turn | `{ behavior: 'allow', updatedPermissions: [<the CLI's suggestion>] }` when the request carried `permission_suggestions`; otherwise the button is not shown |
| Deny | `{ behavior: 'deny', message: <typed note or "Denied from Marble"> }` |
| Question answered | `{ behavior: 'allow', updatedInput: { ...input, answers: { [question]: label(s) } } }` |

### 6.3 Presentation

An open ask is a card at the end of the log, under the turn's last message,
in the same paper as the conversation-controls choice picker (that spec's
§6.2), which it reuses: a question renders its options with ↑ ↓ Space Enter
and `multiSelect` honoured; a permission renders the tool name, the input
summarised the way `toolLabel` already summarises a call (a Bash command in
a code block; a path for file tools), and the three buttons. Escape does
nothing to it. It is not written into the conversation file.

The text-parsing picker from the conversation-controls spec stays as the
fallback for a provider without this channel (Cursor).

### 6.4 Lifetime

- **Stall timer is suspended** while an ask is open and resumed on answer.
- **Cancel** answers every open ask with `deny` before killing, so the CLI
  does not record a dangling prompt, then emits `ask.void { why: 'cancelled' }`.
- **Process exit** with open asks emits `ask.void { why: 'ended' }`.
- **Host close** is cancel.
- **No timeout of its own.** A turn waits for the person as the terminal
  does. `maxMs`, when set, still applies.

## 7. Limits

- `MARBLE_DRIVE_AGENT_MAX_MINUTES` default **0** — no cap. A positive value
  still caps.
- `MARBLE_DRIVE_AGENT_STALL_MINUTES` default **30**. The stall timer is reset
  by any stdout line including subagent lines, and suspended by an open ask.
- The drawer's Stop button and `POST …/cancel` are the way a turn ends early.

## 8. Surfaces

- **Composer setup**: Project segment (§4.3); Claude modes and models per
  §5.3–5.4; the `/` menu from §5.5.
- **Mast**: project name; **Also working here: n** when other conversations
  are running in the same project, each a link to that conversation.
- **Log**: ask cards (§6.3).
- **Agents page** (List, Board, Folders, Focus): **Needs you** state on a
  card while `asking`; sorted with running work.
- **Settings panel**: projects list with add and remove; the capability text
  now reads: *A full agent runs with your own Claude Code (or Cursor)
  configuration — your plugins, skills, hooks, MCP servers and permission
  rules — in the project you choose. It is exactly as capable, and as
  powerful, as the terminal.*

## 9. Cursor

cwd is the project path and `--add-dir` names it; `--workspace` stays the
conversation workspace (hook, `mcp.json`, `AGENTS.md`). The project-kind
instructions from §10 go into `AGENTS.md`. Cursor has no host-answered
prompt channel, so it runs `--yolo` as today and questions fall back to the
text picker. The user-level MCP block (documented in `docs/AGENTS.md`)
stands; it is a real ambiguity in Cursor's hook payload and not this
design's to fix.

## 10. Instructions

`server/agent/instructions.js` becomes three texts:

- `INSTRUCTIONS` (`documents`): unchanged.
- `DRIVE_INSTRUCTIONS` (`full`, drive project): today's `FULL_INSTRUCTIONS`
  minus the sentence claiming the file tools reach nothing outside the drive
  (no longer true) and minus the tool inventory (the CLI knows its own
  tools). Keeps: what a document is, preserve `data-marble-id`, `apply_ops`
  for a document someone is viewing, grow-the-open-page, `check_document`
  after a rewrite, documents are big.
- `PROJECT_INSTRUCTIONS` (`full`, any other project), short:

  > You are the person's usual coding agent, working in this project from
  > Marble Drive instead of a terminal. Nothing about your tools, skills or
  > workflow is different. Marble's document tools (list_documents,
  > read_document, apply_ops, create_document, check_document, read_guide)
  > are also available for the Marble document the person was viewing; a
  > document is one HTML file whose elements carry data-marble-id, and
  > apply_ops is the right way to change one someone is looking at. Finish
  > with a short plain-language summary.

`instructionsFor(capability, projectKind)`.

## 11. Security, honestly

A `full` agent now runs with the owner's own CLI configuration. Its hooks,
MCP servers, plugins and permission allowlists are the owner's; its shell was
already unconfined (2026-09-17 §10.1) and its file tools now are too. It holds
no privilege the owner does not hold in the terminal beside it, and it runs
only where the host rules already allow: one owner, loopback or gated,
`MARBLE_DRIVE_AGENTS=1`, `host.lock` held. The turn token is still per turn;
`MARBLE_DRIVE_SECRET` is still withheld from the child; the workspace with
`mcp.json` is still outside the drive. Projects are registered explicitly by
the owner through a gated, same-origin route. `MARBLE_DRIVE_AGENT_POWER=documents`
is the rollback and keeps every 2026-09-16 guarantee.

Permission mode `auto` means the CLI's own classifier decides most calls and
asks about the rest; `manual` asks about everything; `bypassPermissions`
asks about nothing. The drawer shows which one a conversation runs in.

## 12. Known limitations, stated

- **Mid-turn steering is still not injected.** stdin is open for control
  responses; a second `user` message mid-turn is still queued by the runner,
  per the conversation-controls decision. A later spec may revisit it.
- **Cursor has no ask channel.** Its prompts are `--yolo`, its questions are
  text.
- **Shared checkouts are warned about, not prevented** (§4.5).
- **Undo covers `.mrbl` documents only**, as before; in a code project git is
  the undo.
- **A project's absence fails the turn** rather than being detected at pick
  time; the picker does not re-validate paths.

## 13. Testing

- **Provider (Claude)**: spawn args at `full` — no `--restricted`, no
  `--tools`, `--input-format stream-json`, `--permission-prompts host`,
  `--permission-prompt-tool stdio`, `--mcp-config` without `--strict-mcp-config`,
  mode mapping (`default`/null → `auto`, `bypassPermissions` adds the
  allow flag), no `--model`/`--effort` when null; stdin is an `initialize`
  request followed by a `user` message; `prepare` writes `mcp.json` only;
  `parse` turns `can_use_tool` into `ask`, ignores `control_response`,
  emits `catalog` from `init`. `documents` spawn unchanged.
- **Store**: projects add, list, remove, validation, `drive` immutable;
  `conversation.project` default; `settings.skills`.
- **Runner** (fake provider extended to emit `ask` lines and read stdin):
  ask stored and published with `asking` in the summary; `answer()` writes
  the control response and emits `ask.answered`; stall suspended while an
  ask is open; cancel denies then voids; exit voids; cwd is the project
  path; a missing project fails the turn; `maxMs: 0` never caps; prompt
  context block by project kind; the "other conversations" line counts only
  the same project; `catalog` updates `settings.skills`.
- **HTTP**: `/agent/projects` CRUD and gating; `POST …/answer` 200, 409 on a
  second answer, 404 on an unknown turn; `POST /agent/conversations`
  with `project`.
- **Browser**: project segment on Agents page and drawer; ask card allow,
  deny and question flows against the fake provider; **Needs you** on a
  board card; mast shows project and "Also working here".
- **Live, by hand**: a Claude turn in the marble-drive project that loads
  `superpowers:brainstorming`, spawns an `Explore` subagent, asks an
  `AskUserQuestion` answered from the drawer, edits a file under `runtime/`,
  and runs `npm test`; the same turn resumed from the terminal with
  `claude --resume`; a drive-project turn that still `apply_ops` a viewed
  document; `MARBLE_DRIVE_AGENT_POWER=documents` still gives the old
  boundary.

## 14. Build order

1. **Commit the ownership fix** already in the tree (`ownsPath`,
   `documentTouched`, the two runner tests, the `app.js` line). Bleeding
   between conversations stops here.
2. **Projects** — settings, store, routes, client, composer segment, mast.
3. **The spawn** — Claude at `full` rewritten per §5; instructions per §10;
   catalog per §5.3–5.4; skills from `init`. First real turn with the
   terminal's toolbelt. Cursor's cwd follows.
4. **Asks** — parse, runner, route, client, drawer card, Needs-you state.
5. **Limits** — defaults, stall suspension.
6. **Docs** — `docs/AGENTS.md`, `.env.example`, settings panel copy.

## 15. Decisions taken without asking

Recorded here rather than raised, per standing preference.

1. **`--restricted` dropped, not narrowed.** The 2026-09-17 design valued
   host isolation; the evidence (§2.1) is that isolation is the capability
   gap. `documents` keeps the isolated boundary for anyone who wants it.
2. **Projects are a registry, not a file picker.** A path typed once in the
   settings panel is enough; discovering repositories on the machine is
   scope without a request behind it.
3. **No Marble-managed worktrees** (§4.5).
4. **Asks reuse the choice picker** rather than adding a second question UI.
5. **`maxMs` off by default.** A cap that cancelled two of the three longest
   turns in the store is not protecting anything.
6. **The stalled conversation-controls edits to
   `test/agent-provider-claude.test.js`** (adding `Task`, `Skill`,
   `--add-dir`, `--name`) are replaced by this design's expectations, not
   completed; they were a step toward the same goal by a narrower route.
