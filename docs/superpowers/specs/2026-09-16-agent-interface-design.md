# Agents in Marble Drive — design

> Status: **draft for review**, 2026-09-16. Covers sub-projects 2 (agent bridge +
> ops tools), 3 (agent drawer) and 4 (`Agents.mrbl`). Remote access (1) shipped
> the same day. Decisions and spike evidence gathered on the way are in
> [`2026-09-16-agent-interface-notes.md`](2026-09-16-agent-interface-notes.md);
> this document supersedes it where they differ.

## 1. What we are building

You open any Marble document — from the MacBook Pro or over the tailnet — press
a launcher, and talk to a coding agent about the document. The agent edits the
document **live, through Marble ops**, while you keep editing it too. Every
conversation is also visible in `Agents.mrbl`, a Drive document that lists,
continues, reviews and undoes agent work, in a library view and a board view
you can toggle between.

The agent is one of four **providers**, chosen per conversation: Claude
(subscription), Claude (API key), Cursor Agent, Codex. Each runs as a headless
CLI process on the host machine. None of them can touch the drive except through
Marble's tools.

**Out of scope here:** shell/coding tools and git worktrees (sub-project 5),
auto-start and operations (6), CRDT merging (its own project), multi-tenant
hosts (agents are disabled when `MARBLE_DRIVE_DATA` is set).

## 2. Principles that decide the rest

1. **Ops are the only way an agent writes.** An agent never holds file bytes.
   Its tools file ops through the same per-document queue a gesture uses. This
   is also the seam a CRDT replaces later: the tools, drawer and `Agents.mrbl`
   keep talking in ops, and only what sits under `applyOps` changes.
2. **You own the element you are editing.** When an agent's op targets an
   element that changed since the agent read it, the op is refused with the
   element's current source and the agent retries. A person's ops never carry a
   precondition and are never refused for being stale.
3. **The boundary is enforced, not requested.** Each provider is launched so its
   own file and shell tools cannot run (verified by spike for Claude and Cursor),
   inside an empty workspace outside the drive. A watchdog catches anything that
   slips through.
4. **One store, two interfaces.** The drawer and `Agents.mrbl` read and write the
   same conversations through `window.marble.agent`. A document never names a
   route.
5. **Agent chrome is transient.** Nothing the drawer draws is ever document
   content.

## 3. Architecture

```
 browser (any document)                    host (marble-drive serve)                       provider process
 ─────────────────────                     ─────────────────────────                       ────────────────
 runtime/agent.js  window.marble.agent ──► /agent/*  routes (gate + same-origin)
 runtime/agent-ui.js  <marble-agent-drawer>    │
 templates/agents.mrbl  (library ⇄ board)      ├─ server/agent/store.js     .marble/agents/…
                         ▲ SSE /agent/events   ├─ server/agent/runner.js ──spawn──► claude -p | cursor-agent -p | codex exec
                         │                     │     └─ providers/{claude,cursor,codex}.js      │ stdio MCP
                         │                     ├─ server/agent/tools.js ◄── POST /agent/tools/* ◄─ bin/marble-mcp.js
                         │                     │     read / apply_ops / create / guide              (bearer turn token)
                         └──── changed ◄───────┴─ applyOps (existing queue) ── store.write ── oplog
```

### 3.1 Units

| unit | responsibility | depends on |
|---|---|---|
| `server/agent/store.js` | conversations, turns, event log, settings, undo records on disk | store root |
| `server/agent/providers/*.js` | per-CLI: detect, build the spawn, parse its stream into common events | nothing but `node:child_process` |
| `server/agent/workspace.js` | per-conversation scratch dir, provider config files, instructions | providers |
| `server/agent/runner.js` | turn queue, spawn, stream → store + SSE, cancel, stall, interrupted-on-boot | store, providers, workspace |
| `server/agent/tools.js` | the tool implementations: reads, preconditions, inverse ops, apply | `applyOps`, engine |
| `server/agent/inverse.js` | the op that undoes an op, computed from source before it applies | patcher |
| `server/agent/routes.js` | HTTP + SSE surface, token check for tools | all of the above |
| `bin/marble-mcp.js` | stdio MCP server; forwards each call to `/agent/tools/:name` | nothing but `fetch` |
| `runtime/agent.js` | `window.marble.agent` carrier extension | routes |
| `runtime/agent-ui.js` | the drawer and the shared conversation view, as custom elements in shadow DOM | `marble.agent` |
| `templates/agents.mrbl` | the Agents app: library ⇄ board | `marble.agent`, `agent-ui.js` |

## 4. Providers

### 4.1 The adapter contract

```js
export default {
  id: 'claude-subscription',          // stable, stored on a conversation
  label: 'Claude',                    // what the picker shows
  async detect() {},                  // → { installed, signedIn, detail }
  spawn({ workspace, mcpConfig, prompt, resume, model, instructions }) {},
                                      // → { command, args, env, stdin }
  parse(line, state) {},              // one stdout line → common events[]; state is per-turn scratch
};
```

Common events emitted by `parse`: `session {id}`, `text.delta {text}`,
`text {text}` (a completed assistant message), `tool.call {name, input, callId}`,
`tool.result {callId, ok, summary}`, `usage {inputTokens, outputTokens, costUsd?}`,
`done {ok, error?}`. Anything a provider says that maps to none of these is kept
in the raw log only.

**Child environment is an allowlist**: `PATH HOME USER LOGNAME SHELL LANG LC_ALL
TERM TMPDIR`, plus what a provider needs (`ANTHROPIC_API_KEY` for
`claude-api` only; `CURSOR_API_KEY` if set), plus `MARBLE_DRIVE_URL` and
`MARBLE_AGENT_TOKEN` for the MCP bridge. `MARBLE_DRIVE_SECRET` never crosses.

### 4.2 The four

| id | spawn | resume | boundary |
|---|---|---|---|
| `claude-subscription` | `claude -p --output-format stream-json --verbose --include-partial-messages --tools "" --strict-mcp-config --mcp-config <ws>/mcp.json --allowedTools mcp__marble --setting-sources project --disable-slash-commands --append-system-prompt "$(<ws>/INSTRUCTIONS.md)" [--model m]`, prompt on **stdin**, env without `ANTHROPIC_API_KEY` | `--resume <session>` | no built-in tools exist (spike: enforced). `--setting-sources project` over an empty workspace keeps user hooks, plugins and CLAUDE.md out; `--bare` is not used because it skips the keychain the subscription login lives in |
| `claude-api` | same, env with `ANTHROPIC_API_KEY` | same | same |
| `cursor` | `cursor-agent -p --output-format stream-json --stream-partial-output --approve-mcps --trust --workspace <ws> [--model m] <prompt>` with `<ws>/.cursor/mcp.json`, `<ws>/.cursor/hooks.json`, `<ws>/AGENTS.md` | `--resume <chatId>` | `preToolUse` hook, `failClosed: true`, allows only `MCP:*` (spike: enforced; `--mode ask` and `--sandbox` are not) |
| `codex` *(experimental)* | `codex exec --json --ignore-user-config -s read-only --skip-git-repo-check -C <ws> -c mcp_servers.marble.command=… -c mcp_servers.marble.args=[…] -c mcp_servers.marble.env={…} [-m m] -`, prompt on stdin, `<ws>/AGENTS.md` | `codex exec resume <id> -` | read-only sandbox; **unverified** — the ChatGPT plan is at its limit until 2026-10-15 |

Codex ships marked experimental. Its adapter is unit-tested against a synthetic
stream; the live check (MCP reachable from inside the sandbox, user config
ignored, auth kept) is a follow-up task that runs when the quota returns. If the
sandbox blocks the bridge's loopback call, the fallback is `-s workspace-write`
with the workspace as the only writable root.

### 4.3 Detection

`GET /agent/providers` runs, with a 5 s timeout each and a 60 s cache:
`claude auth status` (JSON: `loggedIn`, `authMethod`), `cursor-agent status`
("Logged in as …"), `codex login status`, and checks `ANTHROPIC_API_KEY` for
`claude-api`. A provider that is not installed is hidden from pickers; one that
is installed but signed out is shown disabled with its `detail`.

Usage-limit errors (both Cursor and Codex print them on stdout as an error
event) end the turn as `failed` with the provider's own message shown verbatim,
so "resets 9/19" reaches the person.

### 4.4 Settings

`<root>/.marble/agents/settings.json`, read and written through
`GET/PUT /agent/settings`:

```json
{ "defaultProvider": "claude-subscription",
  "models": { "cursor": "composer-2.5" },
  "maxRunning": 3 }
```

`MARBLE_DRIVE_AGENT_PROVIDER` seeds `defaultProvider` when the file does not
exist. Agents are **off unless `MARBLE_DRIVE_AGENTS=1`**, and refuse to turn on
when the host is multi-tenant, or when it is ungated and not bound to loopback.

### 4.5 Choosing and switching

A provider is chosen when a conversation starts (the default is preselected) and
is fixed for that conversation, because a session id only means something to the
CLI that made it. **Continue in…** starts a new conversation on another provider
with `handoffFrom` set; its first turn is prefixed with a handoff brief built by
the host (the last 12 user/assistant messages and tool summaries, capped at
8 000 characters, plus the documents the old conversation touched). Both
conversations show the link.

## 5. The tools

Served to every provider by `bin/marble-mcp.js` as MCP server `marble`, each
call forwarded to `POST /agent/tools/:name` with the turn's bearer token. The
host accepts a tool call only from loopback, only with the token of a turn that
is running, and resolves every path through `parsePath`.

| tool | input | does |
|---|---|---|
| `list_documents` | `{folder?}` | paths and titles under a folder |
| `read_document` | `{path, ids?}` | no `ids`: an outline of the whole document (`outlineOf`, 24 000-char budget). With `ids`: their full source (`collectSlices`). Records a read hash for every element whose full source was returned |
| `apply_ops` | `{path, note, ops}` | see 5.1 |
| `create_document` | `{path, from?}` | a new document from a starter; the path becomes writable for this turn |
| `read_guide` | `{section?}` | sections of `build-in-marble/SKILL.md`, so the agent can learn the op vocabulary without file tools |

**Writable paths** for a turn: its target document, plus anything it created.
Any path is readable.

### 5.1 `apply_ops`

Inside the document's existing queue (`enqueue`), in one task, so nothing can
land between the check and the write:

1. `repairOps` then `validateOps` (from the Marble intent layer: mints missing
   ids, checks shapes, caps a call at 24 ops) then `guardOps`.
2. **Precondition.** For every op with an `id` (`setText setInner setAttr move
   remove`), the element's current outer source hash must equal the hash this
   conversation recorded when it last read or wrote that element. An element
   never read is a refusal too. On refusal nothing in the batch applies, and the
   tool returns `{refused: true, reason, current: [slices]}` — which also counts
   as a read, so the agent's retry can succeed. `insert` checks only that its
   parent exists; inserting into a list someone else is editing merges by
   construction.
3. **Inverse.** `inverse.js` computes, against the source before the batch, the
   op that undoes each op (the server twin of the carrier's `invert`), and
   appends them to the turn's undo record.
4. Apply through the existing `applyOps` path with `client: agent:<conversationId>`
   (history restore point, oplog, `changed` to every tab — the agent is not a tab,
   so nobody is excluded).
5. Re-hash every element this conversation has recorded, against the new source.

`applyOps` gains an optional `{ precondition(source) → refusal|null,
after(source, next) }` pair to make this possible. Gestures do not pass one.

### 5.2 Undo a turn

`POST /agent/turns/:id/undo` walks the turn's inverses in reverse. Each inverse
carries the hash of the element **right after** the agent's op; if the element
has changed since (you edited it), that inverse is skipped. The result says
`{reverted, kept}` and the drawer shows "Undid 7 changes · kept 2 you edited
afterwards". Undo is one batch per document through `applyOps` with
`client: agent-undo:<conversationId>`. A turn can be undone once; the event log
records it.

## 6. Turns

### 6.1 Lifecycle

```
queued → running → completed | failed | cancelled
                 ↘ interrupted (host stopped mid-turn)
```

- **Send.** `POST /agent/conversations/:id/turns {prompt, context}` where
  `context = {viewing, target, selection: [ids]}`. The host freezes `target` and
  the selection's source into the turn. The prompt handed to the CLI is the
  person's text followed by a context block: viewing, target, and each selected
  element's source (capped at 6 000 characters).
- **One running turn per conversation.** Sending while one runs queues the next
  turn; the drawer shows it as queued, and it can be removed before it starts.
- **Global cap.** At most `maxRunning` (default 3) turns run at once; the rest
  wait in order.
- **Two conversations on one document** is allowed. Their ops merge, and the
  precondition catches one agent editing an element the other just changed.
- **Target moved** mid-turn: the turn's target follows (the same path the
  `pendingWrites.move` already follows). **Target trashed:** tool calls return
  `{error: "…was moved to the trash"}` and the agent decides what to say.
- **Cancel.** `SIGTERM`, then `SIGKILL` after 3 s. Ops already applied are kept;
  the turn ends `cancelled` with Undo offered.
- **Stall.** No output for 10 minutes ends the turn `failed: stalled`. A turn
  longer than 30 minutes is cancelled. Both are settings.
- **Host restart.** On boot, any turn stored as `running` becomes `interrupted`.
  Nothing re-runs by itself; the next Send resumes the provider session.
- **Host close** kills running children.

### 6.2 The watchdog

While any turn is running, a `.mrbl` change the watcher reports as *outside the
host* (not ours, not identical — the path fixed today) is attributed to the
running turns, which get a `watchdog` event: "a document changed outside Marble
while this turn ran". The watcher already writes a `pre-external` restore point
before announcing the change; the drawer offers **Restore** for it.

It flags and offers rather than restoring by itself, because every provider's
boundary is now enforced, which makes the watchdog a safety net — and the most
likely cause of an outside change is you, in a text editor, which an automatic
restore would silently revert.

### 6.3 Needs review

A conversation needs review when its latest finished turn is `completed` with at
least one applied op, or is `failed`, `interrupted`, or carries a `watchdog`
event — and nobody has opened that conversation since the turn finished. Opening
it (drawer or `Agents.mrbl`) or pressing **Mark reviewed** clears it.

## 7. Storage

```
<root>/.marble/agents/
  settings.json                   (maxRunning takes effect on restart)
  <conversationId>/
    meta.json                     provider, model, title, created, archived, handoffFrom/To,
                                  providerSession, lastReviewedAt
    events.jsonl                  the normalized event log — the audit log and the transcript
    turns/<turnId>.json           status, context, timings, usage, writable paths
    turns/<turnId>.undo.json      inverse ops with post-op hashes
    raw/<turnId>.jsonl            the provider's own stream, untouched
```

Under `.marble/`, so the existing backups carry it. A listing reads every
`meta.json` rather than keeping an index: at one person's scale that is cheaper
than keeping an index honest. Files are written beside and renamed over. `events.jsonl` lines:
`{seq, t, turn, type, …}` with types `user`, `text`, `tool.call`, `tool.result`,
`ops.applied {path, count}`, `ops.refused {path, reason}`, `turn.queued`,
`turn.started`, `turn.completed`, `turn.failed`, `turn.cancelled`,
`turn.interrupted`, `turn.undone {reverted, kept}`, `watchdog`, `handoff`.
Text deltas are streamed live and not stored; the completed `text` is.

A conversation's title is its first message, trimmed to 60 characters. No model
call names it.

Workspaces live at `~/.cache/marble-drive/agents/<conversationId>/`
(`MARBLE_DRIVE_AGENT_WORKDIR`), never under the drive root, and are recreated if
missing.

## 8. HTTP surface

All under the gate. Mutating routes also require `sameOrigin` (from
`server/sessions.js`). All return 404 when agents are off.

```
GET   /agent/providers
GET   /agent/settings                   PUT /agent/settings
GET   /agent/conversations?archived=0|1
POST  /agent/conversations              {provider, model?, handoffFrom?} → {id}
GET   /agent/conversations/:id          meta + events (?after=seq)
PATCH /agent/conversations/:id          {archived?, reviewed?, title?}
POST  /agent/conversations/:id/turns    {prompt, context} → {turnId, status}
DELETE /agent/turns/:id                 remove a queued turn
POST  /agent/turns/:id/cancel
POST  /agent/turns/:id/undo             → {reverted, kept}
GET   /agent/events?conversation=:id&after=seq    SSE: that conversation's events
GET   /agent/events?all=1                          SSE: summary changes for lists and boards
POST  /agent/tools/:name                loopback + bearer turn token only
```

## 9. `window.marble.agent`

Added by `runtime/agent.js`, injected beside `runtime/drive.js` only when agents
are on. A namespace, like `marble.drive`, so a document can test for it.

```js
marble.agent.providers()                         → [{id,label,installed,signedIn,detail,default}]
marble.agent.settings() / .saveSettings(patch)
marble.agent.conversations({archived})           → summaries
marble.agent.conversation(id)                    → {meta, events}
marble.agent.start({provider, model})            → id
marble.agent.send(id, {prompt, target, selection})→ {turnId, status}
marble.agent.cancel(turnId) / .undo(turnId) / .dequeue(turnId)
marble.agent.archive(id, bool) / .markReviewed(id) / .handoff(id, provider)
marble.agent.restore(path, sha)                  the watchdog's restore point, via the existing POST /restore
marble.agent.on(id | '*', fn)                    → unsubscribe
marble.agent.context()                           → {viewing, target, selection}
marble.agent.select(ids)                         for documents with their own selection model
marble.agent.open(id?) / .close()                the drawer
```

`context().selection` is the addressed elements containing the page's text
selection, unless the document has called `select(ids)` (the Drive's lasso,
for example), which takes precedence until cleared.

## 10. The drawer

`runtime/agent-ui.js` defines two custom elements with shadow DOM, so no document
stylesheet reaches them and theirs reach no document: `<marble-agent-drawer>`
and `<marble-conversation>` (the transcript + composer, reused by
`Agents.mrbl`). The host injects the script into every document; the element is
added with `data-marble-transient`. A document that wants to present agents its
own way includes `<meta name="marble-agent" content="custom">`, and only the API
is injected.

- **Launcher**: a 40 px round button, bottom-right, inside the safe area.
  `⌘J` / `Ctrl+J` toggles. When a turn is running anywhere, the launcher shows a
  progress ring; when a conversation needs review, a dot.
- **Overlay by default**: 420 px wide, slides over the right edge, never changes
  the document's viewport. **Pin** docks it: the drawer sets
  `margin-inline-end: 420px` on `<html>` as an inline transient style, which a
  document can see and respond to. Below 720 px wide it is a full-screen sheet.
- **Header**: conversation title; a switcher of recent conversations; **New**;
  provider badge; **Open Agents**; pin; close. When the page you are viewing
  differs from the running turn's target: "Viewing Reading List · editing
  Research Garden".
- **Transcript**: your messages; assistant text rendered as a small safe subset
  of Markdown (paragraphs, emphasis, code, lists, links — no raw HTML); tool
  activity as compact rows ("Read Research Garden · outline", "Edited 3
  elements", "Refused: the heading changed since it was read — re-reading");
  a footer per turn with status, duration, **Undo turn**, and the watchdog's
  **Restore** when present.
- **Composer**: `Enter` sends, `Shift+Enter` breaks the line; a context chip
  showing the target and the selection count, removable; **Stop** while running;
  queued turns listed above the composer with remove buttons. A new
  conversation's composer shows the provider picker.
- **Follows navigation**: the open conversation id is kept in `localStorage`, so
  the drawer reopens on the next page with the same conversation. A running
  turn's target never changes; the next Send captures the new page.
- **Continue in…** in the header's menu: providers other than this one.

## 11. `Agents.mrbl`

A template (`templates/agents.mrbl`) seeded once at the drive root as `Agents`,
the same way the Drive seeds itself. It uses `marble.agent` and
`<marble-conversation>`, and names no route.

### 11.1 Library (A)

Three panes: **list** (search; filters All · Running · Review · Archived; each row:
title, provider badge, status dot, activity line, age), **conversation** (the
shared `<marble-conversation>`), **inspector** (status; provider and model;
target documents as links; changes per document with op counts; context of the
selected turn; provider session resumable · N turns; duration and usage; Undo
turn; Continue in…; Mark reviewed; Archive).

### 11.2 Board (C)

Three columns: **Running** (running and queued), **Needs review** (6.3),
**Completed**. Cards: title, provider badge, activity line, age, a changes count.
Clicking a card opens a 520 px panel over the board holding the same
`<marble-conversation>` plus a condensed inspector. Archived conversations are
not on the board.

### 11.3 The toggle

A segmented control **List | Board** in the header; `V` toggles. Each
conversation is one element in both layouts, keyed by id.

- **Library → Board**: record every row's rect; switch the layout class; record
  every card's rect; animate each from the row rect to the card rect with FLIP
  (transform + scale, Web Animations API, 420 ms,
  `cubic-bezier(.2, .8, .2, 1)`, 18 ms stagger by column position, capped at
  8 staggered); the conversation and inspector panes fade and slide out over
  180 ms while columns fade in.
- **Board → Library** is the same in reverse.
- **Interruptible**: toggling mid-flight reverses running animations from their
  current progress instead of restarting.
- **Selection carries**: the conversation open in the library is highlighted on
  the board and its panel is not opened automatically; the card last opened on
  the board is the conversation the library shows on the way back.
- **Reduced motion**: a 150 ms crossfade and nothing moves.
- **Narrow screens** (< 720 px): the library is a list that pushes to the
  conversation; the board is horizontally scroll-snapped columns; the toggle
  animation is the crossfade.

The view and the selection persist in `localStorage`.

## 12. Security

- Agents run only when `MARBLE_DRIVE_AGENTS=1`, never on a multi-tenant host,
  and never on an ungated host reachable beyond loopback.
- Every `/agent/*` route is behind the gate; mutations also require same origin.
- Tool calls require loopback and a per-turn token (32 random bytes) that dies
  with the turn.
- Paths go through `parsePath`; writes only to the turn's writable set.
- Child processes get an allowlisted environment, an empty workspace outside the
  drive, and no provider-level access to files or shell (section 4.2).
- The instructions file tells the agent the rules, but nothing depends on it
  obeying them.

## 13. Known limitations, stated

- **A tab's local undo ring clears when agent ops land.** The carrier reconciles
  on `changed` and clears its inverses (`runtime/marble.js` `patchFromFile`). The
  caret and unflushed keystrokes survive (it already bails while ops are queued
  and restores the caret). Fixing the undo ring means broadcasting ops instead of
  `changed`, which is G3 work and a Marble carrier change.
- **Codex is unverified live** until its quota returns.
- **Cursor also loads user-level hooks** (`~/.cursor/hooks.json` and Claude's
  hooks). A user hook that allows cannot override ours denying — verified only for
  the project hook alone; re-check with a user hook present during implementation.

## 14. Testing

- **Unit**: each provider's `parse` against recorded streams (Claude and Cursor
  recorded from real runs during implementation; Codex synthetic);
  `inverse.js` round trips (apply op, apply inverse, source byte-identical);
  preconditions (unread, stale, own re-hash, insert into a changed parent);
  store (atomic index, event seq, interrupted-on-boot); settings.
- **Integration**: `test/fixtures/fake-agent.mjs` is a scripted CLI that speaks a
  provider's stream format and calls `bin/marble-mcp.js` for real, run by the
  real runner against a real host: ops applied and broadcast; a stale op refused
  then retried; undo keeps a person's later edit; cancel keeps applied ops;
  queued turns run in order; `maxRunning`; interrupted on restart; watchdog
  event on an outside write; tool token rejected after the turn ends and from a
  non-loopback address; agents off → 404.
- **UI**: `marble.agent` against the fake agent in a real browser (Playwright):
  drawer send/stream/stop/undo; conversation follows navigation; pin changes the
  viewport and overlay does not; `Agents.mrbl` toggle both ways, mid-flight
  reversal, selection carried, reduced motion.
- **Live, by hand**: one real turn each on Claude subscription and Cursor
  (`composer-2.5`) editing a scratch document while typing in it; Codex when its
  quota returns.

## 15. Build order

1. **Core** — store, `applyOps` precondition hook, `inverse.js`, tools, routes,
   MCP bridge, runner, fake agent. Everything testable with no model.
2. **Providers** — Claude (both auths) and Cursor adapters, workspace files,
   detection; live turns.
3. **Drawer** — `runtime/agent.js`, `runtime/agent-ui.js`, injection, watchdog UI.
4. **`Agents.mrbl`** — library, board, toggle.
5. **Codex** — adapter behind experimental; live verification when possible.
