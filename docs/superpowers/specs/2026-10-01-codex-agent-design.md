# Codex as a Marble agent

2026-10-01. The owner wants Codex beside Claude: an OpenAI API key, and the
whole workflow around it, so that a drive works with either one. Shipped to
every drive. This is Plan 5 of the agents work (`2026-09-16-agent-interface-design.md`),
which waited on a ChatGPT plan that was at its limit.

## What was decided, and why

| Decision | Chose | Why |
|---|---|---|
| How Codex runs | `codex exec --json`, prompt on stdin, `resume <thread>` for later turns | it is what `@openai/codex-sdk` runs and reads; the runner already owns the process (Stop, stall, first-to-go, resume), so a second owner in between buys nothing |
| One agent or two | one, `codex`. It uses the OpenAI key when one is set, else the ChatGPT login | Claude needs two ids because a conversation records which one pays; Codex has no subscription meter in Marble to keep apart, and a key that wins when set is one rule to explain |
| Which variable carries the key | `CODEX_API_KEY` | `codex exec` reads it; `OPENAI_API_KEY` is ignored (checked 2026-10-01, 0.154) |
| How Marble's tools reach it | `-c mcp_servers.marble.*` and `.browser.*`, with `env_vars` naming what to forward | the turn token and the browser pass stay in the environment, never in argv |
| How Marble's rules reach it | `-c developer_instructions=…` | the same text Claude gets with `--append-system-prompt`; the project's own `AGENTS.md` still loads |
| The app's own skills | listed in the instructions by name, description and path | Codex has no `--plugin-dir`; it reads a `SKILL.md` when one fits, which is how it uses its own |
| Models and efforts | `codex debug models`, `visibility: list` only, each model with its own efforts | the catalog moves faster than this file; it answers without a login |
| Modes (Shift+Tab) | **Full access** (default) `-s danger-full-access`; **Workspace** `-s workspace-write`; **Read only** `-s read-only` | auto-review (`--approve-for-me`) in exec blocks the network and never escalates, so it is not offered |
| Asks | none; Codex asks in text, like Cursor | exec has no channel for an approval; the app-server protocol does, and is a later round |
| Checking a key | `GET /v1/models` at OpenAI before it is kept | spends nothing; a wrong paste is caught where it was made |
| Naming a chat | Codex after Claude and Cursor, on the login only | naming never bills an API key by accident (the rule Claude already keeps) |
| Sprites | `@openai/codex@<tools/sprite/codex-version>` installed with Claude Code in every release | the platform binary comes as an optional dependency, no install script |

## What a turn looks like on the wire

```
{"type":"thread.started","thread_id":"…"}                       → session
{"type":"item.completed","item":{"type":"agent_message","text"}} → text
{"type":"item.started","item":{"type":"command_execution",…}}   → tool.call  Bash {command}
{"type":"item.completed","item":{"type":"command_execution",…}} → tool.result ok = exit_code 0
{"type":"item.started","item":{"type":"mcp_tool_call","tool"}}  → tool.call  <tool> {arguments}
{"type":"item.completed","item":{"type":"mcp_tool_call",…}}     → tool.result ok = no error
{"type":"item.completed","item":{"type":"file_change","changes"}}→ tool.call + tool.result  Edit
{"type":"error","message":"Reconnecting... 2/5 …"}               → nothing (it is retrying)
{"type":"turn.completed","usage":{…}}                            → usage, done ok
{"type":"turn.failed","error":{"message"}}                       → done failed, with the message
```

A resumed thread Codex no longer has fails before any line with
`no rollout found for thread id`; that is `lostSession`.

## The interface

- **Connect an agent** (the first-visit popup) offers Claude or Codex, the key
  field and link for the one chosen, and checks with Anthropic or OpenAI. A
  pasted `sk-ant-` key moves the choice to Claude. It opens when no agent on
  the drive is usable.
- **Settings**: a Codex row (model, effort, mode) and an OpenAI API key field;
  the row's detail says whether Codex is on the key or the ChatGPT login.
- **Composer**: Codex in the CLI segment with its mark, and one saved setup —
  the catalog's first model at High — between Grok and Opus. When Claude's
  window is spent and Cursor is not signed in, a new chat starts on Codex.

## Not in this round

- Codex usage meters (the ChatGPT plan's windows).
- Auto continuing a spent Claude chat on Codex.
- Allow / Deny cards for Codex (app-server).
- Codex sessions do not travel with a drive that moves between the Mac and
  Fly; a resume on the other side starts a new Codex thread and says so.
