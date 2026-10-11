# A sprite per tester: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command gives a named tester their own Marble Drive sprite behind a passphrase, with agents on a Console key or the owner's login, and every tester's sprite updates with one command; the Drive they start with is the product's, not the owner's.

**Architecture:** Template edits (step 0); a label setting in the host; the release script folds a per-sprite `sprite.env` into the service; a Mac-side provision script built on the deploy script, plus `--all` on the deploy script.

**Tech Stack:** bash, the `sprite` CLI, Node 22 `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-a-sprite-per-tester-design.md`

**Workspace:** worktree `.claude/worktrees/sprite-testers`, branch `sprite-testers`.

## Global Constraints

- Tester sprites are named `t-<person>` (`a-z0-9-`), label `marble-tester`, org `marble-drive`; `admin-p1` is never touched by `--all`.
- Per-sprite settings: `~/.config/marble-drive/sprite.env` (mode 600); keys: `~/.config/marble-drive/agent-keys` (mode 600), for every sprite.
- Roster on the Mac: `~/.config/marble-drive/testers.json` (mode 600). Never an API key in it, in output, or in the repo.
- `MARBLE_DRIVE_API_LABEL` default `Claude API`.
- Template keeps Grid, List, Timeline, Weight.

## Review Focus

- A `sprite.env` line with a comma in its value: the service `--env` list is comma-separated, so the release script must refuse it rather than split it silently.
- Provisioning a person whose sprite already exists: refuse, change nothing.
- A provision that fails part way (create ok, deploy fails): say what exists and how to remove it; the roster is written only at the end.
- `--remove` with a mistyped confirmation: nothing destroyed.
- An existing drive whose saved view is `map` or `pulse` loading the new template: Grid, not a blank page.

---

### Task 1: the shipped Drive (spec step 0)

**Files:** `templates/drive.mrbl`; test `test-browser/drive-template-product.test.js`.

- [ ] Failing browser test: no `[data-set-view="map"]` / `pulse` buttons, no `drawMap`/`drawPulse` in the source; a saved view of `map` (localStorage) opens as Grid; with documents `drive` and `Notes/a`, the root listing shows `drive` in the materials strip (`[data-material]`) and not among document tiles.
- [ ] Remove Map and Pulse (buttons, CSS, draw functions, the `mode()` values, any `.orbit`/pulse styles); fall back to Grid for unknown saved views; `isMaterial` true for the page's own document.
- [ ] Run it plus `drive-templates`, `drive-trash`, `drive-realms`, `drive-drop-files`, `drive-drawn-pictures`; commit.

### Task 2: the API agent's name

**Files:** `server/config.js` or `server/agent/providers/index.js`, `server/agent/providers/claude.js`, `runtime/agent-ui.js`, `docs/AGENTS.md`; tests in `test/agent-provider-claude.test.js`.

- [ ] Failing tests: `createClaudeProvider({ auth: 'api', env: {} }).label === 'Claude API'`; with `MARBLE_DRIVE_API_LABEL=KIXLAB API` it is that; the missing-key error names the label; `git grep KIXLAB -- server runtime templates` is empty.
- [ ] Implement; `agent-ui.js` stops hard-coding `'claude-api': 'KIXLAB API'` and uses the provider's reported label.
- [ ] `npm test`; commit.

### Task 3: per-sprite settings in the release script

**Files:** `tools/sprite/release.sh`; test `test/sprite-release.test.js`.

- [ ] Failing test with a stub `sprite-env` (records its arguments) and a fake `/health` (stub `curl`): `switch` creates the service with `MARBLE_DRIVE_AGENT_KEYS=<home>/.config/marble-drive/agent-keys` and every `sprite.env` line, `sprite.env` values after the defaults; a `sprite.env` value containing a comma fails the switch with a message and changes nothing.
- [ ] Implement (`read_sprite_env`, refuse commas, `mkdir -p ~/.config/marble-drive` mode 700).
- [ ] Commit.

### Task 4: provisioning and `--all`

**Files:** `tools/sprite-provision.sh`, `tools/sprite-deploy.sh` (`--all`), `docs/DEPLOY.md`.

- [ ] `sprite-provision.sh <person> [--agent api|subscription] [--key-file f] [--org o]` and `--remove <person>`, per the spec's ten steps; roster written last; on a failure after `sprite create`, print what exists and the remove command.
- [ ] `sprite-deploy.sh --all`: every `t-*` sprite, continue past failures, summary lines.
- [ ] `bash -n`; usage and refusal paths run locally (bad name, missing value, existing roster entry via a stub `sprite`).
- [ ] Commit.

### Task 5: the real run

- [ ] `tools/sprite-provision.sh smoke --agent api`: from the Mac, `/health` 200 and `/` is the gate; sign in with the passphrase in Playwright; save a test key in Agents settings (a dummy string); `tools/sprite-deploy.sh t-smoke`; the key is still set; Map and Pulse absent, Drive in materials.
- [ ] Ask the owner before `tools/sprite-provision.sh --remove smoke`.
