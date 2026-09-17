# Agents

> An agent is a third writer. It files ops like a gesture does, through the
> same queue, and it can be told no.

Design: [`superpowers/specs/2026-09-16-agent-interface-design.md`](superpowers/specs/2026-09-16-agent-interface-design.md).

## Turning it on

```
MARBLE_DRIVE_AGENTS=1
MARBLE_DRIVE_AGENT_PROVIDER=claude-subscription
```

Refused, with the reason printed at boot, on a multi-tenant host, on an
ungated host that is not listening on loopback, and on a host bound to one
address other than loopback (the MCP bridge calls back on loopback). One host
runs agents on a drive at a time: it holds `.marble/agents/host.lock`, and a
second `serve` on the same drive boots with agents off. Utility commands
(`weigh`) never start them.

An ungated host answers `/agent/*` only when addressed as `localhost`,
`127.0.0.1` or `[::1]`, and `/agent/tools/*` refuses any request carrying
`X-Forwarded-*` headers, since behind Tailscale Serve every peer is loopback.

## How a turn runs

```
POST /agent/conversations/:id/turns {prompt, context:{target, viewing, selection}}
  → runner queues it (one per conversation, maxRunning across all)
  → spawns the provider's CLI in ~/.cache/marble-drive/agents/<conversation>/
  → the CLI starts bin/marble-mcp.js, which calls /agent/tools/* with the turn's token
  → tools.js reads, checks, and writes through applyOps
  → every open tab hears `changed`; the transcript streams on /agent/events
```

## The rules the tools enforce

- **Read before you write.** An element must have been shown to this
  conversation in full before `apply_ops` may change it.
- **Stale is refused.** If the element changed since, nothing in the batch
  applies and the agent gets the current source back. A person's own ops are
  never refused for being stale.
- **Only the target.** A turn writes to its target document and to documents it
  created. It reads anything.
- **Every batch can be undone.** Undo skips anything a person edited after the
  agent, and says how much it kept.

## What the watchdog is for

Every agent writes through ops, so an agent's work never looks like an edit
from outside. If a document changes outside the host while a turn runs, the turn
gets a `watchdog` event carrying the restore point taken just before the change.
Nothing is reverted automatically: the likeliest outside writer is you.

## Storage

```
.marble/agents/settings.json
.marble/agents/<conversation>/meta.json
.marble/agents/<conversation>/events.jsonl
.marble/agents/<conversation>/turns/<turn>.json
.marble/agents/<conversation>/turns/<turn>.undo.json
.marble/agents/<conversation>/raw/<turn>.jsonl
```

## Providers

| id | runs | boundary |
|---|---|---|
| `claude-subscription` | `claude -p`, prompt on stdin, no `ANTHROPIC_API_KEY` in its environment, so the CLI's login is used | `--tools ""` and `--strict-mcp-config`: it has no tool but Marble's |
| `claude-api` | the same, with `ANTHROPIC_API_KEY` | the same |
| `cursor` | `cursor-agent -p`, model `composer-2.5` unless the conversation names one, prompt passed after `--` (a dash-leading prompt would otherwise be parsed as a flag) | `.cursor/hooks.json` `preToolUse`, fail-closed, allowing only Marble's five tools (`bin/marble-cursor-hook.js`) |

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

## Not yet

- A turn's target does not follow a move, and a trashed target is not named as
  such: both make `apply_ops` answer `no document "…"` (spec §6.1, deferred).
