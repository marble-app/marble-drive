# The workshop: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a conversation on `admin-p1`, an agent can change `marble-drive` or `marble`, try it on `t-bryan`, push to `main`, deploy to everyone, and update `admin-p1` itself without killing its own turn.

**Architecture:** A repo pin for the Claude version; `release.sh switch-when-idle` run as its own Sprites service (`marble-switch`) when a deploy targets the machine it runs on; `tools/sprite-workshop.sh` for checkouts, projects, identity and keys; `CLAUDE.md` for the shipping procedure.

**Tech Stack:** bash, `sprite`/`sprite-env`, `gh`, npm, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-24-the-workshop-design.md`

**Workspace:** worktree `.claude/worktrees/workshop`, branch `workshop`.

## Global Constraints

- Checkouts at `/home/sprite/src/marble-drive` and `/home/sprite/src/marble`; projects named `Marble Drive` and `Marble`.
- Claude pin file `tools/sprite/claude-version`, one line.
- Idle = no Sprites task named `marble-drive`, at two checks 15 s apart; give up after 2 h; log `~/app/switch.log`; service `marble-switch` deletes itself.
- Keys come only from files on the Mac and are never printed; `~/.npmrc` mode 600.

## Review Focus

- `switch-when-idle` while the socket is missing or answers an error: never switch on an unknown state; keep waiting until the deadline.
- A second self-deploy while one is still waiting: the newer release replaces the older wait, never two switches.
- `sprite-workshop.sh` re-run: updates checkouts (fetch, fast-forward only), never clobbers local uncommitted work; reports it instead.
- Self-detection: a deploy to `admin-p1` from the Mac must still switch immediately.

---

### Task 1: Claude version pinned in the repo

**Files:** `tools/sprite/claude-version`, `tools/sprite-deploy.sh`; test `test/sprite-deploy.test.js`.

- [ ] Failing test: running `sprite-deploy.sh` with a stub `sprite`, `npm` (`view` succeeds) and `claude --version` answering `2.1.1` resolves the Claude version to the pin file's value (visible via a `--print-plan` dry run that prints name, source, marble, claude and target, and exits).
- [ ] Implement `--print-plan` and the pin default; commit.

### Task 2: switch when idle

**Files:** `tools/sprite/release.sh` (`switch-when-idle`, `hand-off`), `tools/sprite-deploy.sh` (self-detection); test `test/sprite-release.test.js`.

- [ ] Failing tests with a fake unix socket for `/v1/tasks` and a stub `sprite-env`: holds while a `marble-drive` task is listed; switches after two idle checks (intervals shortened by env for the test); an error answer counts as busy; afterwards `services delete marble-switch` was called.
- [ ] Implement; `sprite-deploy.sh` on the target itself (`hostname` equals the sprite name) calls `release.sh hand-off <name>`, which (re)creates the `marble-switch` service running `switch-when-idle`.
- [ ] Commit.

### Task 3: `tools/sprite-workshop.sh`

- [ ] Script: clone or fast-forward both checkouts (marble with the GitHub token), `npm install` in each, register the two projects through the host's API (signed in with the sprite's own passphrase), set git identity, place the keys given.
- [ ] `bash -n`; refusal paths locally.
- [ ] Commit.

### Task 4: `CLAUDE.md`

- [ ] The shipping procedure from the spec, section 5.
- [ ] Commit.

### Task 5: the real run (needs the three keys)

- [ ] Run `sprite-workshop.sh admin-p1` with the keys; a Marble Drive conversation on `admin-p1` makes a small change, tests, deploys to `t-bryan --local`, pushes, updates `admin-p1`; the turn completes; `admin-p1` ends on the new release.
