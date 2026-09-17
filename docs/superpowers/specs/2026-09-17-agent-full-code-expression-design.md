# Full code expression for agents — design

> Status: **draft for review**, 2026-09-17. This is sub-project 5, named but
> deferred by
> [`2026-09-16-agent-interface-design.md`](2026-09-16-agent-interface-design.md)
> ("Out of scope here: shell/coding tools and git worktrees"). It supersedes
> that document's §2.3 ("the boundary is enforced, not requested") and §5 ("the
> tools") where the two differ; everything else there still stands.

## 1. What we are building

An agent in Marble gets the toolbelt it has in a terminal — `Read`, `Write`,
`Edit`, `Glob`, `Grep`, `Bash` — rooted at the drive. It can rewrite a document
end to end, write and run a script, grep across folders, check its own work, and
edit the files a document depends on. Marble's ops tools stay, because a small
precise edit to a document someone is looking at is still better expressed as
ops.

The limitation being removed is not a missing feature; it is the shape of the
boundary. Today an agent has five MCP tools and nothing else
(`server/agent/tools.js`), and each provider is launched so its own tools cannot
run (`--tools ""` for Claude, a fail-closed `preToolUse` hook for Cursor). An
agent cannot rewrite a document — only file ≤24 ops per call, each keyed to a
`data-marble-id`, with a 12 KB `setInner` ceiling, against documents that run to
3 MB. It cannot touch a file that is not a `.mrbl`. It cannot run anything, so it
can never tell whether the code it just wrote works.

**In scope:** the Claude providers, the spawn, the tools, attribution, undo,
format invariants, instructions, docs and tests.

**Out of scope:** git worktrees per conversation; Cursor and Codex at full
capability (§9); an OS-level sandbox (§10.1, deferred with reasons).

## 2. What changes, in one picture

```
 before                                     after
 ──────                                     ─────
 workspace = ~/.cache/…/<conversation>      cwd = <drive root>
 empty dir, nothing to find                 the drive itself
                                            workspace still outside the drive,
                                            still holds the turn token (mode 600)

 --tools ""                                 --restricted
 --setting-sources project                  --tools "Bash,Read,Write,Edit,Glob,Grep,TodoWrite"
 --strict-mcp-config                        --settings <workspace>/settings.json
                                            --permission-prompts none
                                            --strict-mcp-config

 5 MCP tools, nothing else                  native toolbelt, confined to cwd
                                            + the same MCP tools, plus check_document

 writes: apply_ops → applyOps queue         writes: apply_ops → applyOps queue
                                                 or Write/Edit → disk → watcher
                                                 → store.mark('pre-external')
                                                 → patch open tabs

 undo: inverse ops                          undo: inverse ops (ops writes)
                                                + restore points (file writes)

 outside write during a turn = watchdog     outside write during a turn = this
                                            turn's own work, recorded
```

## 3. Principles that change, and the ones that hold

Superseding §2.3 of the 2026-09-16 design:

1. **The boundary is confinement, not absence.** An agent has real tools; what
   is enforced is *where* they reach. `--restricted` confines the file tools to
   the working directory. This is weaker than "it has no tools" and it is the
   point: a writer that cannot write is not a writer.
2. **Shell is trusted, and said so plainly.** `Bash` is not confined by
   `--restricted` (§10.1). We do not pretend otherwise in the docs or the UI.
3. **Ops stay the sharpest tool, not the only one.** `apply_ops` still refuses
   on staleness, still carries a note, still yields exact undo. The agent picks:
   `Write`/`Edit` to rewrite, ops for surgery on a document someone is reading.

Unchanged and still load-bearing: you own the element you are editing (ops are
refused when stale, a person's ops never are); one store, two interfaces; agent
chrome is transient; agents are for one owner on a loopback host.

## 4. The spawn

### 4.1 Verified, not assumed

Probed against `claude` 2.1.274 on 2026-09-17, in a scratch directory with a
file one level above it:

| Question | Result |
|---|---|
| Does `--restricted` still allow Bash when `--tools` names it? | Yes. `init` reported `["Bash","Edit","Glob","Grep","Read","Write"]` |
| Are file tools confined to cwd? | Yes, by the CLI: `Read` of `../outside.txt` denied — *"file is outside the working directory due to --restricted mode"* |
| Is Bash confined? | **No.** `cat ../outside.txt` returned the file's contents |
| Does `--settings` still apply under `--restricted`? | Yes — `permissions.allow` suppressed every prompt |

### 4.2 The invocation

```
cwd = <drive root>

claude -p --output-format stream-json --verbose --include-partial-messages
  --restricted
  --tools "Bash,Read,Write,Edit,Glob,Grep,TodoWrite"
  --settings    <workspace>/settings.json
  --permission-prompts none
  --strict-mcp-config --mcp-config <workspace>/mcp.json
  --append-system-prompt <INSTRUCTIONS>
  [--model …] [--effort …] [--resume …]
```

`--restricted` replaces `--setting-sources project`. It is a better fit for what
that flag was chosen to do: it ignores this machine's user, project and local
settings — so no `CLAUDE.md`, hooks or skills leak in from the host, which is
the isolation the 2026-09-16 spike wanted — *and* it confines the file tools.

`--permission-prompts none` means anything not covered by `settings.json` is
denied rather than left hanging: a headless turn must never block on a prompt
nobody can answer.

The workspace stays outside the drive and keeps holding `mcp.json` with the
turn's token at mode 600, so `agentsAllowed`'s existing refusal (a workdir
inside the drive "would let an agent's own tools find it") is unchanged and
still meaningful — more so now that those tools exist.

`settings.json` is written per turn beside `mcp.json`:

```json
{ "permissions": { "allow": ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "TodoWrite"] } }
```

## 5. The tools

The five MCP tools stay, unchanged in behaviour, plus one:

- `check_document(path)` → `examine(name, source)` from `server/engine.js:62`,
  "the format's own invariants, asked of a document arriving from outside".
  Returns the findings. The agent is expected to call it after rewriting a
  document; the runner also calls it for every `.mrbl` the turn touched (§7).

`read_document` keeps earning its place on large documents: it outlines a 3 MB
file that `Read` would simply blow the context window on.

## 6. Attribution: the watchdog's premise inverts

`server/app.js:793` currently reasons:

> Every agent writes through ops, so an agent's own work never reaches this
> branch. Something changing a document from outside while a turn runs is
> flagged on that turn […] the likeliest outside writer is you.

After this change an agent's own work reaches that branch constantly, and the
likeliest outside writer during a turn is the agent. Left alone, every turn
would trip its own watchdog.

**New rule, and it turns on capability.** While a turn running at capability
`full` is in flight, a change to a document in the drive is attributed to that
turn: the runner records a `document.changed` event carrying the path and the
restore point `store.mark(…, 'pre-external')` just took, and does not raise
`watchdog`.

A turn running at `documents` claims nothing. That agent writes only through
ops, so the branch's original reasoning still holds exactly: a document changing
from outside during its turn *is* an intrusion, and is still flagged. The
watchdog is not weakened for the boundary it was written for — it is narrowed to
the boundary where it still means something.

The cost, stated: if you edit a document while a `full` turn runs, your edit is
attributed to the agent. You do not lose it — it appears in that turn's change
list with its restore point, which is the same affordance the watchdog offered,
without calling it an alarm. This is the honest trade: the alternative is
flagging every full turn, which trains you to ignore the flag.

`needsReview` keeps `watchdog` as an outcome for both the no-turn-running case
and every `documents` turn.

## 7. Undo, rebuilt on restore points

Undo becomes two mechanisms behind one button.

- **Ops writes** keep exact inverse-op undo (`server/agent/inverse.js`), which
  already skips anything a person edited after the agent.
- **File writes** undo by restore point. `store.mark(docPath, prior.source,
  'pre-external')` already fires on every outside write, and `seed()` already
  guarantees a document has a restore point even if no browser ever opened it —
  so the snapshots this needs exist today, for free. The turn records the
  *first* pre-turn restore point per path; undo restores each touched document
  to it, through `putDocument`, so it echoes and patches tabs like any write.

Order matters: undo restores files first, then replays inverse ops for any
document that only received ops, so a document written both ways lands on its
pre-turn state.

After a turn, the runner runs `examine` over every `.mrbl` the turn touched and
attaches the findings to the turn. A rewrite that dropped `data-marble-id`s is
then visible in review rather than discovered weeks later by a broken link.

## 8. Instructions

`server/agent/instructions.js` currently opens by telling the agent the opposite
of what will be true — *"There are no file or shell tools"* — and must be
rewritten wholesale. The new mental model:

- you are in a shell at the root of a Marble drive, and the drive is the only
  place your file tools reach;
- a document is one `.mrbl` HTML file; every addressable element carries a
  `data-marble-id`; **preserve those ids when you rewrite** — an id you drop is
  a link, a selection and a history entry you break;
- documents are large. `Grep`, `sed` and `read_document`'s outline before
  `Read`;
- `apply_ops` is still the right tool for a small edit to a document someone is
  looking at: it patches their page at element granularity and is refused
  instead of clobbering if they changed it;
- `check_document` after you rewrite; `read_guide` when unsure of the format.

The `build-in-marble` guide already backs `read_guide`, so the agent has a
guaranteed route to format knowledge that does not depend on skills loading.

**Open question, resolved by probe during build:** whether skills can be loaded
under `--restricted` (it ignores project settings, and skills are copied into
the workspace today by `server/agent/skills.js`). If they cannot, the fallback
is `read_guide` plus the format rules already in the system prompt — so nothing
in this design depends on the answer. The composer's `/` skills menu is a
Claude-only affordance either way.

## 9. Provider capability

Providers gain a declared capability:

| capability | means |
|---|---|
| `full` | native toolbelt rooted at the drive (§4) |
| `documents` | the 2026-09-16 boundary: MCP tools only |

`claude-subscription` and `claude-api` ship at `full`. `cursor` stays at
`documents`: its boundary is a `preToolUse` hook that sees a tool's name but not
its server, and giving it parity means deleting that hook and relying on
`cursor-agent`'s own confinement, which has not been verified. Codex is still
unwritten. The drawer and settings panel say which capability a conversation is
running at, so "why can Claude do this and Cursor not" is answerable from the
UI.

`MARBLE_DRIVE_AGENT_POWER=documents` forces every provider down to `documents`.

## 10. Security, honestly

The host-level guarantees are unchanged and still do the heavy lifting: agents
refuse to start on a multi-tenant host, on an ungated non-loopback host, or when
a second host holds the drive's `host.lock`; `/agent/tools/*` refuses requests
carrying `X-Forwarded-*`; a turn token is good for one turn.

What changes is what a turn can do once it starts.

### 10.1 Bash is not confined — deferred, with reasons

`--restricted` confines the file tools. It does not confine `Bash`, and the
probe in §4.1 proves it: `cat ../outside.txt` succeeded. An agent can therefore
read and write outside the drive through the shell.

**Decision: accept and document, do not build an OS sandbox now.** Reasoning:

- the agent runs as you, on your machine, on a loopback single-owner host,
  driven by a prompt you typed. It holds no privilege you do not already hold in
  the terminal next to it. The realistic failure is an accident, not an
  attacker;
- against accidents, restore points and review (§6, §7) are worth more than
  confinement, and this design strengthens both;
- the enforcement that would close it is platform-specific — `sandbox-exec` on
  macOS, bubblewrap or namespaces on Linux — and Marble supports both
  (`server/watch.js` carries a Linux fallback for exactly this reason). That is
  its own sub-project, not a clause in this one.

**What this design owes it:** the child process is spawned through a single
`sandbox` seam in the provider contract — a function that may wrap the command
and args — so a seatbelt profile can be added later without touching any
provider. Shipping the seam now is what keeps the deferral honest rather than
permanent.

The `.env.example`, `docs/AGENTS.md` and the settings panel all state that a
`full` agent's shell reaches the whole machine.

### 10.2 What an agent can still not do

Reach the drive over HTTP without a turn token; run on a host it does not hold
the lock for; survive its turn (the token dies with it).

## 11. Known limitations, stated

- **Bash reaches outside the drive** (§10.1).
- **Undo covers `.mrbl` documents, and Marble cannot even see the rest.**
  `watch.js` filters to `.mrbl` (`relativeDoc` returns null for anything else),
  so an asset, script or data file an agent writes is neither listed in the
  turn's changes nor restorable from Marble — it simply happens. Git and
  `backups/` are the only backstop. Extending the watcher to non-document files
  would fix both halves and is a follow-up, not this design; until then the
  turn's change list is explicitly a list of *documents* changed, and the drawer
  labels it that way rather than implying completeness.
- **A concurrent human edit is attributed to the running turn** (§6).
- **Cursor stays at `documents`** (§9).
- **A turn's target still does not follow a move**, and a trashed target is
  still not named as such — inherited from the 2026-09-16 design, unchanged.
- **Turns get slower and cost more.** A toolbelt invites exploration. `stallMs`
  and `maxMs` already bound it; the defaults may need raising.

## 12. Testing

- **Unit** — spawn args for both capabilities (`full` carries `--restricted`,
  `--tools`, `--settings`, `--permission-prompts none`; `documents` still
  carries `--tools ""`); `settings.json` written at mode 600 alongside
  `mcp.json`; the `sandbox` seam wraps command and args when supplied;
  capability resolution including `MARBLE_DRIVE_AGENT_POWER`.
- **Integration** — extend `test/fixtures/fake-provider.js` to write files
  directly as well as call MCP: a file write during a turn produces
  `document.changed` and no `watchdog`; the same write with no turn running still
  produces `watchdog`; undo restores a file-written document to its pre-turn
  restore point; undo of a turn that both wrote and filed ops lands on the
  pre-turn state; `examine` findings are attached to the turn; a document
  rewritten without `data-marble-id`s is reported, not silently accepted.
- **Live, by hand** — one real turn that rewrites a document end to end while a
  browser has it open (it should patch, not reload); one that writes and runs a
  script; one confirming `Read` outside the drive is refused and that `Bash`
  outside is not.

## 13. Build order

1. **Capability seam** — `capability` on the provider contract, the `sandbox`
   seam, `MARBLE_DRIVE_AGENT_POWER`, spawn-arg tests. No behaviour change yet.
2. **The spawn** — Claude at `full`: cwd, `--restricted`, `settings.json`,
   rewritten `INSTRUCTIONS`. First real turn with a toolbelt.
3. **Attribution** — `document.changed` versus `watchdog`, turn change lists.
4. **Undo and invariants** — restore-point undo, `check_document`, `examine`
   after a turn, findings surfaced in review.
5. **Surfaces** — drawer and `Agents.mrbl` show touched documents and findings;
   settings panel states the capability and what shell access means.
6. **Docs** — `docs/AGENTS.md`, `.env.example`.

## 14. Decisions taken without asking

Recorded here rather than raised as questions, per standing preference.

1. **OS sandbox deferred, seam shipped** (§10.1). Capability was chosen over
   confinement explicitly; the seam keeps the door open at near-zero cost.
2. **`MARBLE_DRIVE_AGENT_POWER` kept.** It looked like a second code path to
   maintain, but the `documents` path has to exist anyway for Cursor, so the
   escape hatch is nearly free — and it is the rollback if a `full` turn goes
   badly on a real drive.
3. **Attribution over flagging** (§6). Flagging every turn would make the
   watchdog noise, and a warning nobody reads is worse than no warning.
4. **`--restricted` over `--dangerously-skip-permissions`.** Same capability for
   the file tools minus the escape, and it preserves the host-isolation property
   `--setting-sources project` was chosen for.
