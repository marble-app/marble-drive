# Agents

> An agent is a third writer. It files ops like a gesture does, through the
> same queue, and it can be told no.

Design: [`superpowers/specs/2026-09-16-agent-interface-design.md`](superpowers/specs/2026-09-16-agent-interface-design.md).

## Turning it on

```
MARBLE_DRIVE_AGENTS=1
MARBLE_DRIVE_AGENT_PROVIDER=claude-subscription
```

Refused, with the reason printed at boot, on a multi-tenant host and on an
ungated host that is not listening on loopback.

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

A provider is `{ id, label, detect, prepare?, spawn, parse }` — see
`server/agent/runner.js`. `test/fixtures/fake-provider.js` is the smallest
complete one. Claude and Cursor adapters arrive in Plan 2.
