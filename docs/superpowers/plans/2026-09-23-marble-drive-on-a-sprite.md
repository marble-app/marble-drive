# Marble Drive on a sprite: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `admin-p1` runs Marble Drive as a Sprites service, deployed by one script from public sources (or the Mac's working copies with `--local`), and never pauses in the middle of an agent turn.

**Architecture:** A small host module (`server/keep-awake.js`) holds a Sprites task while work runs; a deploy script on the Mac (`tools/sprite-deploy.sh`) drives a release script on the sprite (`tools/sprite/release.sh`) through `sprite exec`, staging releases side by side and switching a `current` link.

**Tech Stack:** Node 22+ (`node:test`, `node:http` over a unix socket), bash, the `sprite` CLI, `sprite-env` on the sprite.

**Spec:** `docs/superpowers/specs/2026-09-23-marble-drive-on-a-sprite-design.md`

**Workspace:** worktree `.claude/worktrees/sprite-host`, branch `sprite-host`.

## Global Constraints

- Org `marble-drive`, sprite `admin-p1`, URL `https://admin-p1-b3fwm.sprites.app`, "sprite" URL auth.
- Drive root `/drive` on the sprite; releases under `/home/sprite/app/releases/`, `current` link at `/home/sprite/app/current`; keep 3 releases.
- Service `marble-drive`, `--http-port 4400`, env `MARBLE_DRIVE_ROOT=/drive,PORT=4400,MARBLE_DRIVE_AGENTS=1,NODE_ENV=production`.
- Keep-awake: check every 15 s; task `marble-drive`, expiry 5 min, renewed every 60 s; only when `/.sprite/api.sock` exists.
- Public sources by default: `marble-drive` from GitHub `marble-app/marble-drive`, `@bdhmin/marble@<version>` from npm; `--local` packs the Mac's working copies.
- No credentials of any kind are copied to a sprite. The owner's `claude login` on `admin-p1` is done by the owner by hand.

## Review Focus

- The sprite's task API answering an error (or the socket vanishing mid-run): the host must keep serving, and try again on the next check.
- A deploy whose install or smoke test fails: `current` must not move, and the running service must be untouched.
- A `--rollback` when there is no previous release: refuse, change nothing.
- A turn that finishes while a renewal request is in flight: the task is still removed afterwards.
- `--local` with uncommitted changes in `marble-drive`: they are what gets deployed (that is the point), and the release name says `local`.

---

### Task 1: keep-awake

**Files:** Create `server/keep-awake.js`; modify `server/app.js` (start it, stop it in `close()`); test `test/keep-awake.test.js`.

**Interfaces:** `createKeepAwake({ socket = '/.sprite/api.sock', busy: () => boolean, checkMs = 15000, renewMs = 60000, expire = '5m', name = 'marble-drive', log })` → `{ start(), stop(), state() }`. Inert (no timers) when `socket` does not exist.

- [ ] Failing tests against a fake unix-socket HTTP server: busy → one `POST /v1/tasks {name, expire}`; still busy → renewed after `renewMs`; idle → task deleted; socket missing → no requests and no timers; server answering 500 → host keeps going and retries next check; stop() removes a held task.
- [ ] Implement; wire in `app.js` with `busy = () => (agents?.runner?.running().length ?? 0) > 0 || stems.list().jobs.some((j) => j.state === 'running' || j.state === 'queued')`.
- [ ] `node --test test/keep-awake.test.js`, then `npm test`; commit.

### Task 2: the deploy scripts

**Files:** Create `tools/sprite-deploy.sh` (Mac side), `tools/sprite/release.sh` (sprite side); docs in `docs/DEPLOY.md` (a "On a Fly Sprite" section).

- `sprite-deploy.sh <sprite> [--org O] [--ref R] [--marble V] [--local] [--rollback]`:
  - resolves the ref (`git rev-parse` against `origin`), or packs working copies for `--local` (`git ls-files -co --exclude-standard` in marble-drive into a tar; `npm pack` in `../marble`);
  - checks `npm view @bdhmin/marble@V version` unless `--local`;
  - `sprite checkpoint create`, prints the id and the restore command;
  - uploads `release.sh` (and the packs for `--local`) with `sprite exec` stdin, runs it.
- `release.sh stage|switch|rollback …` on the sprite: stage into `releases/<utc>-<sha|local>`, `npm pkg delete dependencies.@bdhmin/marble && npm install --omit=dev <marble spec>`, `npx playwright install chromium` (once, cached), smoke-test on port 4499 with a temp drive root and `/health`; `switch` creates `/drive` if missing, points `current`, creates or restarts the service, waits for `/health` on 4400, prunes to 3; `rollback` refuses without a previous release.
- [ ] `bash -n` both; `shellcheck` if installed.
- [ ] Verified for real in Task 3 (a script that drives a remote machine has no honest unit test here) — Ruling recorded.
- [ ] Commit.

### Task 3: first deploy to admin-p1

- [ ] `tools/sprite-deploy.sh admin-p1 --org marble-drive --local` (main is not pushed; `--local` deploys what is on the Mac).
- [ ] Probe from the sprite: does the URL reach the host on `127.0.0.1:4400`? (`sprite exec curl` the URL with an org token, or open it.) If not, set `HOST=0.0.0.0` in the service env. Record in the spec.
- [ ] Probe the task API: `POST /v1/tasks`, list, delete — confirm the delete call keep-awake uses. Record in the spec; fix keep-awake if it differs (with a test).
- [ ] Commit spec notes and any fixes.

### Task 4: done criteria

Through `sprite proxy 4400` (a local port onto the sprite, so Playwright needs no Fly sign-in):
- [ ] The Drive opens; a PDF upload gets a drawn picture; a 100 MB upload with one chunk cut completes.
- [ ] The owner runs `claude login` in `sprite console -o marble-drive -s admin-p1` (asked for when reached).
- [ ] An agent turn started, all tabs closed, sprite stays awake (a task is listed) and the turn completes.
- [ ] Service restarted (stand-in for a cold stop: `sprite-env services restart`), the Drive comes back with its documents.
- [ ] A second deploy and a `--rollback` each leave a working Drive.
