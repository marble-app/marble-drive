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

`MARBLE_DRIVE_AGENT_MAX_MINUTES` is `0` by default — no cap; a turn ends when
the agent finishes or you press Stop. `MARBLE_DRIVE_AGENT_STALL_MINUTES`
(30) ends a turn whose process prints nothing for that long and is not
waiting on you. `MARBLE_DRIVE_AGENT_MAX_RUNNING` is `0` by default — no cap
on how many conversations run at once; set it only to hold a small machine
down. A conversation still runs one turn at a time, so a prompt waits only
behind that conversation's own turn.

A new chat is named twice. The first prompt lands as a placeholder — sixty
characters of what was typed, minus the composer's attachment markup — so no
row on the board is ever blank while the turn runs. When that turn ends, a
small model (`MARBLE_DRIVE_AGENT_NAMING_MODEL`, `haiku`) reads the question
and the answer and writes a short title over it. Naming runs on the login,
never on an API key, from an empty directory with no tools and none of your
settings; it never blocks or fails a turn, and a chat is asked about once,
not once per turn. A title you type yourself is never written over. Set
`MARBLE_DRIVE_AGENT_NAMING=0` to keep the placeholder.

An ungated host answers `/agent/*` only when addressed as `localhost`,
`127.0.0.1` or `[::1]`, and `/agent/tools/*` refuses any request carrying
`X-Forwarded-*` headers, since behind Tailscale Serve every peer is loopback.

## How a turn runs

```
POST /agent/conversations/:id/turns {prompt, context:{target, viewing, selection}}
  → runner queues it (one turn at a time per conversation; no cap across them)
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

## While an agent works

A violet box on the page is where the agent is, and the pill under it says what
it is doing — `Agent · reading`, or the note it gave its edit
(`Agent · rename the heading`). The colour is the agent's, not the document's:
every accent in this drive is a muted blue, sage, terracotta or gold, so a
violet frame is never a control of the app you are in. The wash inside it is
thin, and the box takes no clicks — what is under it is still yours to select
and type in. It follows the element as the page reflows.

The pill carries two buttons. *Open chat* opens the conversation doing the work:
on a page that draws its own agent interface it lands on that page's stage,
anywhere else in the dock on the right. *Hide* puts every zone away for the
session (*Show work* brings them back).

The other direction: a running conversation shows **Building here**, or
**Building in `<document>`**, under its title. Pressing it scrolls to the work,
opening the other document first if that is where the work is.

Being on the page is not a claim on it. Where your caret is has no bearing on
what the agent may change; only an edit you made **after its turn began**
counts as a conflict with an edit of the same element by the agent. When that
happens, nothing is overwritten: the element becomes two versions with a bar
above — *You* and *Agent* to look at each, *Keep this* to settle on the one
showing, and *Ask an agent to combine* to send both to an agent that writes a
third. A turn's ending forgets what it touched, and an undo claims nothing it
restores, so an agent's claims never outlive its work.

## Summoning an agent in a document

Select something in any document and a small violet handle appears at the
selection's corner, where the construction zone's label will hang once an
agent is working there. Click it, or press `⌘J` while the selection is live,
and a **callout** opens: a card holding a real conversation, anchored to the
region it is about. With no selection `⌘J` still toggles the drawer.

The selection is every addressed element the range crosses. A fully selected
list travels as the list; three paragraphs picked out of a section travel as
three paragraphs. Hold **Option** to pick elements one at a time instead — the
element under the pointer is outlined, a click toggles it, **Escape** clears.

The card's composer is the composer: setups, model, effort, and the Project
picker. Choosing a registered project makes it a coding turn in that
repository, which is how "fix the code behind this" works with no new
mechanism. **Continue in `<title>`** sends the brief to the chat this tab was
last in, if it is idle, instead of starting a new one — the same agent, with
its memory, brought to a new region.

While the agent works the card stands where the zone's label would, showing
`Agent · <what it is doing>`, and the label itself steps back: one object on
the page, not two saying the same thing. Every element the turn changes keeps
a thin violet edge — the **trail** — until the chat is reviewed. When the turn
ends the card reads `Changed 4 elements · Undo · Done`. *Undo* is the turn's
own undo. *Done* marks the chat reviewed, clears the trail, and puts the
callout away: seeing it and saying done is reviewing it.

`×` folds the card to a pill with the chat's name, or with what its last turn
did if that ended while it was folded. The pill reopens the card. While the
agent is still working the pill steps aside altogether, because the zone's own
label is the folded callout — *Open chat* there brings the card back.
**Open beside** moves the chat to the drawer; **Open in Agents** leaves for the
Agents page with that chat open. Undo and Done live in the card, never on the
pill: they come after looking.

A reload rebuilds callouts for chats about this document that are running,
asking, or unreviewed, at the region their last turn was about — at most six,
newest first. A chat whose region is no longer on the page draws nothing; the
drawer still lists it. A prompt sent from the drawer with a selection gets a
callout as well, so both paths end at the same object.

On a phone the handle opens the drawer with the selection attached; there is
no anchored card. The Agents page draws no callouts of its own.

## What a full agent can do

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
as you, with your configuration, on your machine. Its shell and file tools
reach whatever yours do. The turn token is still per turn and
`MARBLE_DRIVE_SECRET` is still withheld from the child.
`MARBLE_DRIVE_AGENT_POWER=documents` is the rollback to the tools-only
boundary.

Cursor's file tools are pointed at the project with `--add-dir`; the shell's
cwd is the project; `--sandbox disabled` lets its native `WebSearch` /
`WebFetch` and the browser reach the network. Cursor has no host-answered
prompt channel, so it runs `--yolo` and asks its questions in text.

The drawer on a document and the Agents page start the same runner. A turn's
*target* is the page you asked from; its *tools* are not smaller there.

Undo covers documents. An asset or script an agent writes is not watched by the
host, so it is neither listed in the turn's changes nor restorable — in a code
project, git is the undo.

## Why a full agent still gets refused

"As capable as the terminal" cuts both ways: the ceiling on what an agent may
run is Claude Code's, not Marble's, and it is set in `~/.claude/settings.json`.
Marble adds nothing to it and can lift nothing from here.

In `auto` — the mode every conversation starts in — an untrusted command is
judged by Claude Code's **auto-mode classifier**. Most of the time a borderline
one escalates: the runner gets an `ask`, and a card appears in the drawer. But
some it refuses outright, with no card and no way to answer:

```
Permission for this action was denied by the Claude Code auto mode
classifier. Reason: [Credential Exploration].
```

The refusal is **sticky for the conversation**. Reading one credential store —
`security find-generic-password`, `~/.claude/.credentials.json` — is enough to
put the session in that state, and from then on ordinary `grep`, `sed` and
`awk` over this repo's own source are refused too. In the worked case
(conversation `23617e5f3b2d`) the first 40 tool calls ran clean; after two
keychain probes, seven plain source reads were refused in a row while `Read`
kept working. This repo is unusually good at provoking it, because its own
subject matter is sign-in state and usage meters.

Two settings fix it, both in the person's own config:

- `permissions.allow` — an explicit rule is matched before the classifier is
  consulted, so `Bash(grep:*)` takes ordinary source reading off its desk. The
  refusal text says so itself: *"the user can add a Bash permission rule to
  their settings."*
- `autoMode.environment` — names the repos whose work is routine. A machine set
  up around one repo makes every other repo's work unroutine, including this
  one's.

`node tools/agent-permissions.mjs` prints exactly what it would add to both;
`--apply` backs the file up and writes it. It must be run by a person: Claude
Code refuses to let an agent edit the settings that govern it
(`[Self-Modification]`), which is the right boundary and not worth routing
around. A user `autoMode.allow` **replaces** the shipped exceptions rather than
adding to them, so the script reads them back from `claude auto-mode defaults`
and appends — see `test/agent-permissions.test.js`.

Prefer a rule to a bigger hammer. Raising the mode to `bypassPermissions`
removes the classifier and every other check with it.

## Blocked and failed are different

A tool that was refused and a tool that exited 1 both arrive as
`is_error: true`, and the drawer used to call both **Blocked**. Most were not:
of 24 failed `Bash` calls across the stored conversations, 10 were refusals and
14 were the agent tripping over its own shell — a zsh quoting error, a missing
module, a script run from the wrong cwd. Fourteen rows saying "Blocked: Bash"
read as a drive with no access.

The provider now marks a result `denied` when the text is a refusal
(`isDenial` in `providers/claude.js`), and the drawer says **Blocked** only for
those — in `--caution`, beside a refused `apply_ops` — and **Failed** in
`--danger` for the rest. Both keep the label of the step they replaced, so the
row still says which command it was.

## Default mode

`models`, `efforts` and `modes` in the agent settings are the per-provider
defaults a new conversation starts from; the settings panel has a picker for
each. Before `modes` existed every conversation started in `auto` and had to be
cycled by hand, which is most of why `auto` is the mode in every stored
conversation.

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
options as numbered rows with their descriptions and an **Other…** row for
your own words (↑ ↓ move, a digit or Space picks, Enter answers). A question
the agent asks in prose — a `?` line followed by `A)` / `1.` / `- [ ]`
options — gets the same kind of picker under the message, and Enter sends
the chosen keys and labels as the reply. `POST /agent/turns/:id/answer
{ requestId, response }` sends an ask's reply into the process. The stall timer is suspended while an ask is open;
Stop denies it; a process that ends first voids it. There is no timeout on
you.

`GET /agent/asks` lists every open ask across conversations — the request,
the turn, and a `lead` of the last two things the agent said or did before
it asked — derived from the runner's live turns, not stored. The summary
stream (`/agent/events?all=1`) carries `event: ask` when one opens and
`event: ask.resolved` when it closes, so a list can know without holding
every conversation's stream. The Agents page's Deck is built on both.

## Messages

Agents in one project can talk to each other. Three tools, on every
provider, through the bridge:

- `list_agents` — the other non-archived conversations in this project, with
  what each is doing: `idle`, `queued`, `running`, `waiting` (parked in
  `wait_for_reply`) or `asking`.
- `send_message { to, text, about?, inReplyTo? }` — text up to 4000
  characters, optionally about a document and some ids. Returns the message
  id and how it was delivered: `turn` (the receiver was idle and its turn
  started), `live` (the receiver was waiting and got it at once) or `inbox`
  (the receiver is busy and reads it when its turn ends).
- `wait_for_reply { seconds? }` — waits up to 300 s (default 120) for
  messages. A timeout is a plain `{ timeout: true }`: nothing yet.

The inbox (`<conversation>/inbox.jsonl`) is the one queue. Whatever turn
starts next on that conversation takes it — a queued turn, a turn the
message itself starts, or a delivery turn the runner queues when a turn ends
with messages waiting. A host that restarts with messages waiting delivers
them at boot. A turn that a message started works in the receiver's own
document, else the document the message is about, else the sender's.

Caps: 12 sends per turn, 8 replies per thread, same project only, never to
yourself or an archived conversation. A delivery turn queues behind the
receiver's own turn, like any other. Nothing here asks the person: a message
never raises Needs you, and the Agents page shows it as a bubble naming the
sender, whose name opens that conversation.

Design: [`superpowers/specs/2026-09-18-agent-messaging-design.md`](superpowers/specs/2026-09-18-agent-messaging-design.md).

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
.marble/agents/<conversation>/inbox.jsonl  messages waiting for the next turn
.marble/agents/<conversation>/turns/<turn>.json
.marble/agents/<conversation>/turns/<turn>.undo.json
.marble/agents/<conversation>/raw/<turn>.jsonl
```

Default agent, per-provider models and effort, registered projects and the
default project, and the skills each CLI last reported live in `settings.json`.
API keys do not:
the settings panel writes them to `.agent-keys.local` (gitignored) or
`MARBLE_DRIVE_AGENT_KEYS`. `GET /agent/settings` says whether a key is set, never
the value. Backups of `.marble/` therefore do not take them.

## Providers

| id | runs | boundary |
|---|---|---|
| `claude-subscription` | `claude -p --input-format stream-json`, the initialize handshake then the prompt on stdin, `--model` / `--effort` from the conversation (none means your own settings), `--permission-mode` from the conversation (`auto` unless picked) | `full`: the terminal's own configuration, cwd the project, every built-in tool, plus Marble's document MCP and browser MCP; prompts and questions come back to the drawer |
| `claude-api` | the same, with `ANTHROPIC_API_KEY`; without it the turn fails rather than fall back to the login | the same |
| `cursor` | `cursor-agent -p`, model `composer-2.5` unless the conversation names one, prompt passed after `--` (a dash-leading prompt would otherwise be parsed as a flag) | `full`: `--add-dir` the drive, `--sandbox disabled`, cwd the drive, hook allows Cursor's own tools, Marble's document tools, and Marble's `MCP:browser_*` (`bin/marble-cursor-hook.js`) |

The Cursor hook sees a tool's name (`MCP:read_document`) but not which MCP
server it belongs to, and `--approve-mcps` approves every server Cursor loads,
including the user's own from `~/.cursor/mcp.json`. A user server with a tool
named like one of Marble's — or like `browser_tabs` — would get past the hook,
so while that file names any server (or cannot be parsed) `agents providers`
shows Cursor as blocked and its turns fail before they start. Whether a
user-level `~/.cursor/hooks.json` runs alongside the workspace hook, and how
the two answers combine, is unverified.

The browser MCP uses Playwright from `@bdhmin/marble`. If Chromium is not
installed, a browser tool returns an error telling you to run
`npx playwright install chromium`.

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

The Agents topbar and the drawer header show usage as two compact percent
sliders and only two (`GET /agent/usage`): **Claude** and **Fable**, the pair
you spend. Every other provider — Cursor included — keeps its meters in
Settings › **Usage** and in the phone's Fleet sheet. The host reads the CLI
tokens from the macOS keychain and asks each vendor; it never returns those
tokens. Both sliders are always drawn: one the host cannot read reads
**Unavailable** (grey, no fill) rather than disappearing, because a slider
that vanishes takes the row's shape with it and reads as "none left" instead
of "not known". API-key-only Claude has no subscription window, so it reads
Unavailable too. The number and
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
and API keys. The composer is one card: the text, then a bar under it with
the setup on the left and the mode, Stop and Send on the right. Agent, model
and project are the mast's tags; what a turn changed is its footer; there is
no status line. The setup shrinks first (segments fold into dropdowns, the
capsule packs into More) and takes its own line only when even that does not
fit. Saved setups are the main toggles when Claude or Cursor is signed in: Anthropic or
Cursor mark plus a short **model + effort** name (Fable 5.1 High, Opus Extra
High, Opus High, Sonnet High, Grok Extra High). Those presets stay clickable on an
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
paper, not inverted chat bubbles.

The box you type in is an editor, not a textarea. `- ` (or `* `, `1. `) at
the start of a line starts a list; Shift+Enter makes the next item, or a
plain newline outside a list, and on an empty item leaves the list; Enter
sends. The document the message is about leads the text as a chip
(`garden · 2 selected`); its × drops the selection, and the chip comes back
for the next message. A pasted screenshot or a long paste (over 12 lines or
900 characters) becomes a chip at the caret, so it can be pointed at in the
sentence; the prompt carries each as a tagged block at the top
(`<pasted-image index="1" …>`) and a token where the chip stood
(`[image 1]`), numbered in the order they sit in the text. Backspace,
select-all-delete and cut take a chip out like any character. The sent
bubble shows the same chips in the same places and renders the lists.

While a turn runs, the bar offers **Queue**, **Steer** and **Interrupt**
for the next send (⌘Enter is always steer). Queued prompts are rows above
the box, each with its mode (click it to cycle), its text (click to edit
in place) and ×. Two or more rows show **Send individually** / **Send as
one prompt**, which is `queueCombine` on the conversation: as one prompt,
the queue fires as a numbered list on a single turn. A steer that waited
is wrapped for the model as course-correction; an interrupt cancels the
running turn first.

In the transcript, a tool row says what it touched (`Read harness.js`,
`Grep packFocus in runtime`, `Ran the runner tests`), and a run of two or
more finished rows folds into one line — `6 steps · Shell ×2 · Read ×2
harness.js, agents.mrbl · Grep packFocus` — that opens on click. The row
still running, and any failed or refused row, stays out of the fold. The conversation mast has an editable
title and tags for the agent (`Claude`, `KIXLAB API`) and for
model • effort (`Sonnet 4.5 • high`). On Agents, the title and the
target document live on the pane header instead of a right-hand inspector.

Agent text is shown, never interpreted as HTML (`renderText` in
`runtime/agent-ui.js`). Browser tests: `npm run test:browser`; screenshots:
`node test-browser/screens.mjs <dir>`.

## The Agents document

A drive that has run `serve` at least once with this host gets an `Agents`
document at the root, seeded the same way Drive is: written only if it is
not already there. It is a library of conversations in five views: **List**,
**Board**, **Folders**, **Focus**, and **Deck**. `V` cycles that order.
`⌘⇧O` starts a new chat from anywhere on the page — the same thing **New**
does, and it keeps working while the caret is in a composer. The
drawer's **Open Agents** appears once that document exists.

The page uses `window.marble.agent` and the same `<marble-conversation>`
as the drawer (`<meta name="marble-agent" content="custom">`, so it does
not wear a second launcher). The topbar has three thin segmented bars on
one row: **List / Board / Folders / Focus**, **CLI** (All plus each signed-in
agent, so you can show only Claude, Cursor, or KIXLAB API), and **All /
Running / Review / Archived**. Conversation rows are not stored in the file.

**Folders** is a vertical tab strip. Groups sit on top, ungrouped last, and
**New chat** is under that. A conversation belongs to at most one folder
(`meta.folderId`). Drag a tab onto another tab to form a group; Shift-select
and **Save as folder** names a working set of panes. Opening a group reuses
the existing pane dock (at most four live conversations). The seeded
`<marble-conversation>` is never reparented.

**Click a group header to open it**; **double-click its name** (or `F2`) to
rename. The name fills the header, so taking the click for renaming left
opening the folder reachable only beside the count. A rename holds the rail
still until it commits, and the open is held for one double-click interval so
the first click of a rename does not repaint the field away.

A rail tab carries its status dot, target and age, and its folder's colour on
the leading edge. Every pane in a folder's workspace keeps its mast and its
composer bar; a tile only gives up padding.

**Focus** is a spatial canvas of rounded cards, laid out as a partition. A
**stage** across the top holds the Fulls and exists only when something is
pinned; below it the **field** divides into one region per folder, with
ungrouped last, and cards pack inside their own region. Regions never
overlap, so a basin is a container rather than a bounding box. Dragging a
card into another region changes its folder; `focusX` / `focusY` order it
within its own. Cards lay out oldest-first so the canvas does not reshuffle
whenever a chat ticks.

Click selects. Double-click or Enter pins a chat **Full**; other Fulls become
Digest. Shift-double-click or **Keep open** adds a Full without demoting the
others, up to four. Cold Digests over the budget become Chips. Arrow keys
move selection; Space opens a Quick Look preview without pinning. Narrow view
stacks the cards and does not add extra panes.

**Deck** orders by how much a conversation wants you, not where it lives:
four bands — **Needs you**, **Running**, **Review**, **Idle** — each a
projection of the same summaries every other view draws. Nothing is stored
for it. An open ask is a card in the first band with a **peek** (the tool
and its argument, the last two things the agent said or did, a diff's first
six lines) so it can be answered without opening anything; the answer is
optimistic, and a lost one comes back with a line saying so. A new ask
bumps the band's count and flashes its header rather than taking the
screen. Idle starts collapsed; band state is tab-local. On a phone a
review row swiped right is marked reviewed; swiped left it only reveals
**Undo turn** as a button. A long press on any row opens an actions sheet
(Stop, Open, Mark reviewed, Archive, Move to folder, Continue in…).
Consequential answers are buttons, never completed gestures.

**On a phone** (under 720 px) Deck is the default view when none is
stored, and the chrome is a phone's: a one-row topbar with the document's
title, an **asks pill** (open asks, on every view; tapping it goes to
Deck), a 22 px ring for the worst signed-in meter (tapping it opens the
**Fleet** sheet: one row per usage window, and **Stop all running**), and
**⋯** for a structured sheet — **New conversation**, the five views with
the current one ticked, then Filter (a sheet holding the real filter
panel) and Settings. A translucent **thumb bar** sits at the sill on
every list view (Deck, List, Board, Folders) and starts a new
conversation. Rows are two lines — title and age, then the activity, the
outcome word in tone, or the target — with the folder colour as a leading
rule and one dot vocabulary (running breathes, asking is a ring, review is
ink, failed is red, idle is an outline). Band headers are sticky and
count in a pill; empty bands hide, and an empty Deck says so once. A
tapped row takes the screen and **the topbar becomes its header** (back
chevron named for the view you left, the title, ⋯ for that
conversation's actions); the pane keeps no bar of its own, the mast folds
to one line (target · tags · a "+N here" tag for the other agents on the
same target), and the composer's setup folds into one chip that opens the
pickers as a sheet. It enters from the right and leaves by a swipe from
the left edge, the view behind sliding up under it. Every control is at
least 44 pt. Sheets are grouped lists; they track the finger, rubber-band
at the top, commit by the sign of the velocity at release, scroll when
tall, and stand on the keyboard (`--kb`, from `visualViewport`, beside
`--vv-h`). Long presses select no text. The document declares its own
installability in its `<head>` (`apple-mobile-web-app-capable` and
friends), so Safari's **Add to Home Screen** opens it without browser
chrome; the host ships nothing for it. A backgrounded page closes its
event streams and resyncs on return.

**Focus on a phone** is one column held by one number: the card in your
hand is Full (the live pane sits under the card's own head, which stays
the header), the next is a four-line digest, the one beyond a chip, and
everything further a sliver — drawn as one **pile** per end of the stack
(a deck seen edge-on, with a "+N" when it is deeper than three) rather
than a run of hairlines. Sizes interpolate as you drag; the card you grab
stays under your finger; a release projects the flick, snaps to the
nearest card and springs there (damping 1, or 0.8 when the flick carried
at least one card). A position track on the right edge shows while the
stack is in hand; a one-time hint says what to do. A tap springs to that
card; a long press opens the actions sheet. With the keyboard up the
cards below the Full fold to slivers first so the composer sits on it.
Order is the desk's: folders in catalog order, oldest first, stable. Not
on the phone: keep-open, Quick Look, cooling, and dragging between
regions (**Move to folder** is on the sheet).

The filter popover's **Idle** row is a cut: chats nobody has touched past it
are hidden, five hours by default. It hides and never files — Archive is a
decision a person made about one conversation, and a clock does not get to
make it for them forty times over — so sliding back to **All chats** returns
every one of them and the store is never written to. The slider's track is
the logistic of the log-duration, normalised so its ends land exactly on
five minutes (right) and 12.5 days (left) and its middle exactly on five
hours; that buys the hours, where the answer usually is, the middle half of
the track. Arrow keys walk the named durations rather than the thousand raw
steps; Home is All chats, End is five minutes. Behind the thumb, one bar per
slice of the same axis says how many chats sit where, and every bar left of
the thumb is one going away. Running, queued and asking chats are spared, as
is the conversation you have open. The cut is the page's, like the search and
the status filter — `localStorage`, never an op.

The closed Filter button is **marked, not counted**: one dot when anything is
hiding rows, and the tooltip names what. It used to carry the number of active
filters, which reads as a notification you are meant to go and clear — and with
the idle cut on by default it would never go away.

Each row has a ⋯ menu for **Archive** / **Unarchive**, **Mark reviewed**,
**Undo last turn**, and **Continue in** another CLI. Archiving the open thread
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
