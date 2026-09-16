# Agent interface — design notes (not yet a spec)

> Status: **decisions recorded, spec not written.** These are the notes to resume
> from for sub-projects 2, 3 and 4. Remote access (sub-project 1) is being built
> first and is not covered here. Written 2026-09-16.
>
> The brainstorm screens these decisions were made on are in
> `.superpowers/brainstorm/89187-1789568634/content/` (untracked):
> `architecture-options-restarted`, `agent-first-timeline`,
> `agent-surface-options`, `agent-turn-dataflow`, `agents-app-layouts`.

## Where this sits

**Hosting: the MacBook Pro is the host.** The drive root, the repository and every
agent process stay on it. The MacBook Air (or any browser) reaches it through
Tailscale, behind the passphrase gate. Rejected: a rented always-on host (cost,
remote file ownership, sync question) and a hybrid with cloud sandboxes (source
and secrets cross a cloud boundary; patch transfer and job storage needed now).
Moving later means moving the same container and drive volume.

**This is a single-owner extension to today's host.** It does not complete G4
("local-first, desktop, agent as peer"); the sync protocol is still future work.

## The sub-projects

| # | Sub-project | Depends on | State |
|---|---|---|---|
| 1 | Remote access — Tailscale, gate hardening, remote live-stream check | — | **in progress** |
| 2 | Agent bridge + ops tool | — | notes below |
| 3 | Agent drawer | 2 | notes below |
| 4 | `Agents.mrbl` | 2 (shares components with 3) | notes below |
| 5 | Coding worktrees — shell tools in an isolated worktree, preview, promote/discard | 2 | later |
| 6 | Always-on operations — auto-start, sleep/power, health, off-device restore drill | 1 | later |
| — | CRDT infrastructure | replaces what sits under `applyOps` | **committed future**, own project |

Order agreed: agent interaction before operations. 2 → 3 → 4 is "the first agent
release"; 5 is "the coding release"; 6 is "the reliability release".

## Permission boundary

- **First agent release (2–4):** Claude reads and writes *documents* inside the
  drive root, through Marble tools only. Bash and WebFetch are removed. Direct,
  live Marble authoring without general control of the Mac.
- **Coding release (5):** shell tools exist only inside an isolated git
  worktree on a task branch, with resource limits and scoped env. The main drive
  receives a tested result, not every intermediate edit.

## 2 · Agent bridge + ops tool

**Claude Code runs as a job, never as a browser terminal.**

- Adapter over `claude -p` with `--output-format stream-json`; resume by session
  id; cancel; an audit log of every tool call.
- Authenticated job API on the existing host, behind the same gate as `/ops`.
- The server **freezes the turn's context** when it accepts a turn: the target
  document path (and selected elements) cannot change while that turn runs.
- One conversation store, global, under the drive's backed-up `.marble/`
  metadata — never inside whichever document happened to be open. Both the
  drawer (3) and `Agents.mrbl` (4) read it.

### Decision: Claude writes through ops, not files

Both writers — you and the agent — are op streams against `data-marble-id`
addressed elements, through the same per-document `enqueue` in
`server/app.js` `applyOps`.

- Claude gets Marble tools (working names `read_document`, `apply_ops`); the
  built-in `Edit`/`Write` are denied for `.mrbl`. Ops use the model vocabulary
  in `@bdhmin/marble` `server/ops-schema.js` (`setText setInner setAttr insert
  move remove`) and pass `guardOps`.
- Agent ops are filed with `client: agent:<sessionId>` so the op log
  (`server/oplog.js`, which already carries `client` + `seq`) can tell whose is
  whose.
- **Different elements merge by construction.** Claude restructures a list while
  you retype a heading: no collision.
- **Same element: the agent op is refused with the element's current state, and
  Claude rebases and retries.** You own the element you are typing in. The
  "intelligence" is the model re-deriving its edit against what is there now,
  not an algorithm guessing.
- **Undo Claude's turn** reverts that turn's ops only — not your edits
  interleaved with it. (Not a whole-file restore to the turn's start.)

**Why not the alternatives:** a host-side 3-way merge of file writes observes the
write after the fact (the file briefly lacks your edits) and is a second merge
algorithm beside ops. A CRDT is the right end state but is G3/G4 infrastructure
and its own project.

**CRDT is the future, and this must not block it.** Keep the op call as the
seam: the agent's tools, the drawer and `Agents.mrbl` talk in ops and never in
file bytes, so replacing what sits under `applyOps` with a CRDT does not change
them. Do not build anything whose correctness depends on reject-and-retry being
the merge strategy forever.

### Gaps found in the code that this decision creates

1. **Ops carry no precondition.** `guardOps` checks that an op destroys only what
   it names; nothing checks that the element is still what the writer last read.
   "Refuse a stale agent op" needs one — e.g. the agent's op carries a hash of the
   element's source as read, and the guard refuses on mismatch, returning the
   current element. Human gesture ops can keep filing without one.
2. **The echo is "changed", not the ops.** `channels.toDocument(docPath,
   'changed', {except})` makes every other tab refetch and reconcile the whole
   document, and `server/sse.js` notes that a reconcile clears the undo ring. If
   an agent files ops every few seconds while you type, your tab reconciles under
   your caret each time. Live merge needs the tab to either receive ops or have a
   reconcile that preserves the focused element, caret and undo ring. This is
   also the first step toward G3 ("ops broadcast as ops"). **Decide in the spec.**
3. **Undo-by-ops needs inverse ops.** Reverting only the agent's ops means
   recording, per applied op, what it replaced (the patcher knows the byte range
   it spliced). Today undo is whole-file history (`store.mark`, `/restore`).
4. The watcher's `pre-external` restore point (`server/app.js`) stays as the
   safety net for anything that still writes a file from outside.

## 3 · Agent drawer

- A reusable, **document-owned** side conversation, available in the Drive and
  in any Marble document, via a `window.marble.agent` carrier API
  (`agent.send(turn)` etc.).
- **Overlay by default, pin to dock.** The drawer slides over the right edge and
  does not change the document's viewport (so responsive and spatial documents
  do not reflow); it collapses to one launcher; pinning docks it as a split.
  Full-screen on phones. (Rejected as the default: a persistent split, which
  reflows the document; a command palette, which hides history and long-running
  progress too quickly.)
- **Boundary:** the document owns the launcher and drawer presentation; the host
  supplies agent operations, process isolation and stored sessions. **Agent
  chrome is transient and never becomes document content** (`data-marble-transient`).
- Each turn sends the active document path and the selected elements' Marble
  source.
- **The conversation follows navigation; a turn's target never drifts.** Send on
  Research Garden, open Reading List mid-turn: Claude keeps editing Research
  Garden, and the same drawer reconnects on the new page. The next Send captures
  the new path.
- **Target stays visible:** the drawer names both the page you are viewing and
  the file Claude is editing when they differ.
- Progress shows tool events inline (e.g. "Editing Research Garden.mrbl · 3
  elements inserted").

## 4 · `Agents.mrbl`

The full app for every global conversation, running task, file change and
resumable Claude session. The drawer handles the current conversation; this
handles all of them. Same store as the drawer.

**Two views, toggled: A · Library + inspector, and C · Agent board.**

- **A — Library + inspector.** Conversation list (search; All / Running / Review
  filters) · full chat with a composer · run details (status, files changed,
  context, Claude session resumable · N turns).
- **C — Agent board.** Columns by status: Running · Needs review · Completed.
  Cards show title, current activity, age.
- **The toggle is a transition, not a page swap.** Each conversation is one
  object shown two ways: a library row and a board card. Toggling morphs each row
  into its card and flies it into its status column; the chat and inspector panes
  fade as the columns open. The reverse on the way back. Interruptible
  (toggle mid-flight reverses from where it is). `prefers-reduced-motion` gets a
  plain crossfade. Use the `apple-design` skill for the motion.
- **Selection carries across the toggle.** The conversation open in A is
  highlighted on the board. Clicking any card on the board opens that
  conversation in a panel **over** the board — so a long conversation can be
  continued without leaving C. Switching back to A keeps whatever was opened last.

## Not yet discussed — settle these in the spec

- Error and failure states: `claude` exits non-zero, stream stalls, host
  restarts mid-turn (is the turn resumable or marked failed?), Tailscale drops
  while the drawer is open, a turn's target document is trashed or moved
  mid-turn.
- Cancel semantics: are ops already applied by a cancelled turn kept or undone?
- Concurrency: one running turn per conversation? Two conversations targeting
  the same document at once?
- What "Needs review" means before worktrees exist (a completed turn you have not
  looked at?).
- Claude authentication on the host (the logged-in CLI account vs
  `ANTHROPIC_API_KEY`), model choice, cost/usage display.
- The session store's on-disk format under `.marble/` and how it is backed up.
- Mobile layout of `Agents.mrbl` (the toggle on a phone).
- Testing: a fake `claude -p` that emits recorded stream-json, so the bridge and
  the merge rules are testable without a model.
