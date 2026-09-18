# Agents

> An agent is a third writer. It files ops like a gesture does, through the
> same queue, and it can be told no.

Design: [`superpowers/specs/2026-09-16-agent-interface-design.md`](superpowers/specs/2026-09-16-agent-interface-design.md).

## Turning it on

```
MARBLE_DRIVE_AGENTS=1
MARBLE_DRIVE_AGENT_PROVIDER=claude-subscription
```

API keys belong in `.agent-keys.local` (gitignored) or `MARBLE_DRIVE_AGENT_KEYS`,
not in the drive and not in `.marble/`. The settings panel writes them there.
`.env.local` can still hold `ANTHROPIC_API_KEY` / `CURSOR_API_KEY` for a host
that has no panel-set key; both files are gitignored.

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
  → spawns the provider's CLI (cwd the drive for a full turn, else the empty workspace)
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
- **Only the target.** A turn's **ops** write to its target document and to
  documents it created. File tools on a `full` agent reach the whole drive.
- **Every batch can be undone.** Undo skips anything a person edited after the
  agent, and says how much it kept. A document rewritten with file tools is
  restored to its pre-turn snapshot.

## What a full agent can do

Every provider runs at capability `full` unless it declares `documents` or
`MARBLE_DRIVE_AGENT_POWER=documents` is set. A new adapter that does not name a
capability therefore sees the drive. `claude-subscription`, `claude-api` and
`cursor` all ship at `full`.

Claude's own tools — `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`,
`TodoWrite` — run with the drive as the working directory, alongside Marble's
tools. `--restricted` confines the **file** tools to the drive; a `Read` above
it is refused by the CLI itself. It does **not** confine `Bash`: an agent's
shell can reach the whole machine, as yours can. That is stated rather than
fixed — the enforcement that would close it is platform-specific and is its own
project. The spawn goes through a `sandbox` seam in the runner so it can be
closed without touching any provider.

Cursor has no `--restricted`. Its file tools are pointed at the drive with
`--add-dir`; the shell's cwd is the drive; the conversation workspace still
holds the turn token, the MCP config and the hook. The hook allows Cursor's own
tools at `full` and still refuses another MCP server's tools. Cursor's shell is
not confined either.

`MARBLE_DRIVE_AGENT_POWER=documents` holds every provider down to the tools-only
boundary.

The drawer on a document and the Agents page start the same runner. A turn's
*target* is the page you asked from; its *tools* are not smaller there.

Undo covers documents. An asset or script an agent writes is not watched by the
host, so it is neither listed in the turn's changes nor restorable — keep the
drive under git or `backups/`.

## What the watchdog is for

A `documents` agent writes only through ops, so a document changing on disk
while its turn runs is an intrusion: the turn gets a `watchdog` event carrying
the restore point taken just before the change. A `full` agent writes files
itself, so the same disk change is recorded as that turn's work
(`document.changed`) rather than flagged. Nothing is reverted automatically.

## Storage

```
.marble/agents/settings.json
.marble/agents/<conversation>/meta.json
.marble/agents/<conversation>/events.jsonl
.marble/agents/<conversation>/turns/<turn>.json
.marble/agents/<conversation>/turns/<turn>.undo.json
.marble/agents/<conversation>/raw/<turn>.jsonl
```

Default agent, per-provider models, and effort live in `settings.json`. API keys do not:
the settings panel writes them to `.agent-keys.local` (gitignored) or
`MARBLE_DRIVE_AGENT_KEYS`. `GET /agent/settings` says whether a key is set, never
the value. Backups of `.marble/` therefore do not take them.

## Providers

| id | runs | boundary |
|---|---|---|
| `claude-subscription` | `claude -p`, prompt on stdin, `--model` / `--effort` from the conversation, skills copied into the workspace so `/skill-name` works | `full`: `--restricted`, cwd the drive, `Read`/`Write`/`Edit`/`Glob`/`Grep`/`Bash`/`TodoWrite` plus Marble's MCP tools |
| `claude-api` | the same, with `ANTHROPIC_API_KEY`; without it the turn fails rather than fall back to the login | the same |
| `cursor` | `cursor-agent -p`, model `composer-2.5` unless the conversation names one, prompt passed after `--` (a dash-leading prompt would otherwise be parsed as a flag) | `full`: `--add-dir` the drive, cwd the drive, hook allows Cursor's own tools plus Marble's MCP tools (`bin/marble-cursor-hook.js`) |

The Cursor hook sees a tool's name (`MCP:read_document`) but not which MCP
server it belongs to, and `--approve-mcps` approves every server Cursor loads,
including the user's own from `~/.cursor/mcp.json`. A user server with a tool
named like one of Marble's would get past the hook, so while that file names any
server (or cannot be parsed) `agents providers` shows Cursor as blocked and its
turns fail before they start. Whether a user-level `~/.cursor/hooks.json` runs
alongside the workspace hook, and how the two answers combine, is unverified.

Every agent gets the same rules (`server/agent/instructions.js`). Each turn,
`prepare` rewrites the workspace's MCP config with that turn's token (mode 600).

The workspace is outside the drive (it still holds the turn token at mode 600).
A `full` turn's working directory is the drive itself, so its file tools find
the documents. A `documents` turn still runs in the empty workspace. Each CLI
also keeps its own record of every session under your home directory —
`~/.claude/projects/…` for Claude, `~/.cursor/projects/…` for Cursor — and those
transcripts contain whatever document content the agent read or wrote. Deleting
a conversation in Marble does not remove them. `--restricted` ignores this
machine's `CLAUDE.md`, hooks and skills, so those cannot add tools.

```
npm run agents -- providers              what is installed and signed in
npm run agents -- try claude-subscription one real turn on a scratch drive
npm run agents -- try cursor --model=composer-2.5
```

A provider is `{ id, label, detect, prepare, spawn, parse }`, and optionally
`lostSession(error)`: true when a resumed turn failed because the CLI no longer
has the session. The runner then forgets the session, says so in the turn's
error, and the next message starts a new one (it does not retry). A parser is
tested against streams recorded from real runs in `test/fixtures/providers/`;
record a new one when a CLI changes its output. Codex arrives in Plan 5.

## The drawer

Every document gets a launcher (bottom right, `⌘J`). The drawer slides over the
page without changing its layout; **pin** docks it beside the page instead,
with a transient stylesheet, so nothing about the document changes. Drag the
left edge to resize it. Overlay and pinned each remember their own width
(default 420 px). The conversation and the drawer copy the open document's palette (`--paper`,
`--ink`, and the rest on `:root`, or the body's background and color when
those variables are missing) so the chrome matches the page — a white
starter, a custom theme, or Drive cream. Drive UIST warm / Dusk is only
the fallback. Below 720 px
it is a full-screen sheet. Drag the header away to dismiss it.

The conversation you had open follows you from page to page. A turn keeps the
document it started on: when you are looking at another page, the header says
which file it is editing. Each finished turn shows what changed with **Undo
turn**, and a turn the watchdog flagged offers **Restore**.

The Agents topbar and the drawer header show Claude and Cursor usage as a
compact percent meter (`GET /agent/usage`). The host reads the CLI tokens
from the macOS keychain and asks each vendor; it never returns those
tokens. A meter is omitted when that CLI is not signed in. If Claude is
signed in but its usage fetch fails, the meter still appears as
**Unavailable** (grey, no fill) instead of disappearing. API-key-only
Claude has no subscription window, so it does not appear. The number and
the fill are how much has been used, filling toward 100%. The bar is blue
below 50%, yellow from 50%, orange from 75%, and red from 90%. Cursor's
meter is the Auto + Composer pool (the dashboard's Cursor-models bar), not
the blended total that mixes in the smaller API bucket. Claude's compact
meter is the 5-hour (short-term) window, not the week, even when the week
is more spent. Settings has a **Usage** tab with two bars per CLI, like
Cursor: Claude **Short-term** and **Weekly**, Cursor **models** and
**Other models**, and when each resets. Hovering a compact meter
on Agents shows that reset as a short tooltip.

**Settings** (the drawer's More menu, and a button on the Agents page) is where
you pick the default agent, a model per agent, effort where the agent has it,
and API keys. The composer has a status line like the CLIs themselves
(`Cursor Grok Extra High · 12% · 1 document changed` with the mode on the
right, and the drive path · branch underneath). Under that, saved setups
are the main toggles when Claude or Cursor is signed in: Anthropic or
Cursor mark plus a short **model + effort** name (Sonnet High, Opus Extra
High, Grok High, Grok Extra High). Those presets stay clickable on an
existing thread, so you can switch from Claude to Cursor (or back) without
starting a new conversation. The next turn uses the new CLI and does not
resume the previous CLI's session. A new conversation still prefers the
Settings default, except when Claude's 5-hour meter is at 100%: then the
picker starts on Cursor if Cursor is signed in. If Claude usage cannot be
read, Claude is treated as unavailable: the picker starts on Cursor, Claude's
CLI and presets are disabled, and the Claude meter reads Unavailable. **Custom** expands the three thin
segmented bars for **CLI** (Claude, Cursor, KIXLAB API), **model**, and
**effort**. If a bar would overflow the row, it becomes a compact dropdown
instead of scrolling sideways. Cursor's picker is Default, Auto, and the
newest Grok family; Claude stays Haiku → Sonnet → Opus → Fable. **Shift+Tab**
cycles that CLI's modes (Claude: Default → Accept edits → Plan → Bypass
permissions; Cursor: Run Everything → Plan → Ask → Auto-review) and the
next turn is spawned with the matching flag (`--permission-mode`, `--yolo`,
`--mode plan|ask`, `--auto-review`). `/` opens the same knobs plus skills,
**Compact**, and **Clear conversation**. **Tab** on a highlighted slash
row turns it into a chip in the composer (a removable tag); Enter keeps
the previous complete-and-run behavior. Prompts are changelog entries on
paper, not inverted chat bubbles. The conversation mast has an editable
title and tags for the agent (`Claude`, `KIXLAB API`) and for
model • effort (`Sonnet 4.5 • high`). On Agents, the title and the
target document live on the pane header instead of a right-hand inspector.

Agent text is shown, never interpreted as HTML (`renderText` in
`runtime/agent-ui.js`). Browser tests: `npm run test:browser`; screenshots:
`node test-browser/screens.mjs <dir>`.

## The Agents document

A drive that has run `serve` at least once with this host gets an `Agents`
document at the root, seeded the same way Drive is: written only if it is
not already there. It is a library of every conversation and a board of
the ones that are running, need review, or are done. `V` toggles the two.
The drawer's **Open Agents** appears once that document exists.

The page uses `window.marble.agent` and the same `<marble-conversation>`
as the drawer (`<meta name="marble-agent" content="custom">`, so it does
not wear a second launcher). The topbar has three thin segmented bars on
one row: **List / Board**, **CLI** (All plus each signed-in agent, so you
can show only Claude, Cursor, or KIXLAB API), and **All / Running / Review /
Archived**. Conversation rows are not stored in the file. Each row has a
⋯ menu for **Archive** / **Unarchive**, **Mark reviewed**, **Undo last
turn**, and **Continue in** another CLI. Archiving the open thread
switches the pane to the next remaining conversation, or the newest one
left; if none remain, the pane is empty. Archived threads leave All /
Running / Review and show under **Archived**. Nothing is deleted.
On the board, opening a conversation splits the kanban and the thread
side by side. Each open chat has a header (title, target, close). Drag a
list row or that header as a card — the list row stays put — onto a pane
**edge** to split, or onto another header to swap. A conversation occupies
one pane. Extra panes are tab-local (`localStorage`) and never filed.

## Not yet

- A turn's target does not follow a move, and a trashed target is not named as
  such: both make `apply_ops` answer `no document "…"` (spec §6.1, deferred).
