# The workshop: changing and shipping Marble from inside Marble

2026-09-24. Status: design, awaiting review. Follows
`2026-09-23-a-sprite-per-tester-design.md`.

## Why

The owner works in his drive on `admin-p1` (his real drive since 2026-09-24).
Using it, he finds a bug or has an idea, and the fix belongs in the
`marble-drive` repo or the `marble` package. He wants to make that change, try
it, and ship it to every user's sprite without leaving the Marble UI: a
conversation in Agents, not a laptop.

Decided with the owner:

- **One sprite for him:** `admin-p1` is both his drive and the workshop. It is
  private to the Fly org and has a passphrase, so the keys that can change
  everyone's drive sit behind two locks. `t-bryan` is his dummy user, for
  trying a change as a user sees it (on an API key).
- **Shipping goes straight to `main`:** the agent tests, tries the change on
  `t-bryan`, pushes to `main`, and runs `--all` when he says so. A
  pull-request flow can be added later without undoing any of this.
- **The admin console app** (sprites, versions, buttons) is a later spec.

## What the workshop is

Not a new app: the Agents UI already on `admin-p1`, with four things added.

### 1. The code, beside the drive

- `/home/sprite/src/marble-drive` (a clone of the public
  `marble-app/marble-drive`) and `/home/sprite/src/marble` (a clone of the
  private `marble-app/marble`), side by side, so `marble-drive`'s
  `"@bdhmin/marble": "file:../marble"` resolves as it does on a laptop.
  `npm install` in both.
- Registered as agent projects **Marble Drive** and **Marble**. A conversation
  in either runs Claude in that checkout with git working (only Drive-project
  turns are git-fenced), and the Marble tools still reach the drive, so an agent
  fixing a bug can read the document where it happened.
- Outside `/drive`: code is not drive content, is not in the drive's history or
  backups, and a Drive-project agent never sees a repository.
- Git commits as the owner (`bdhmin`, his email), not the image's "Sprite".

### 2. The keys

From files on the Mac, never printed, never in the repo or the drive:

- **GitHub** (fine-grained: contents read and write on `marble-app/marble-drive`
  and `marble-app/marble`): `gh auth login --with-token`, then `gh auth
  setup-git`, so plain `git push` works.
- **npm** (publish `@bdhmin/marble`): `~/.npmrc`, mode 600.
- **Sprites** (org `marble-drive`): `sprite auth setup --token`, so
  `tools/sprite-deploy.sh` and `tools/sprite-provision.sh` run from `admin-p1`.

`tools/sprite-workshop.sh <sprite> --github <file> --npm <file> --sprites <file>`
does all of section 1 and section 2, idempotently: running it again updates the
checkouts and replaces any key given.

Every agent in a workshop project has a shell beside these keys. That is the
point, and it means `--all` is only as careful as the agent running it; the
owner is the only person who can reach `admin-p1`.

### 3. The Claude version is pinned in the repo

`tools/sprite-deploy.sh` defaults `--claude` to the version of the `claude` on
the machine running it. On `admin-p1` that is the image's 2.1.251, which cannot
run the host's flags, so a deploy from the workshop would break every sprite's
agents. The pin moves into the repo: `tools/sprite/claude-version` (one line,
e.g. `2.1.281`) is the default, bumped deliberately in a commit; `--claude`
still overrides.

### 4. Updating `admin-p1` from `admin-p1`

An agent runs inside the host that serves it, so switching `admin-p1` to a new
release restarts the host that is running the turn that asked for it. The
switch waits until the work is done:

- When `tools/sprite-deploy.sh admin-p1` runs on `admin-p1` itself, it stages
  and smoke-tests the release as always, then hands the switch to a separate
  Sprites service, `marble-switch`, which runs `release.sh switch-when-idle
  <name>` and returns at once: "admin-p1 will switch to <name> when no agent is
  working."
- `switch-when-idle` waits until the host holds no Sprites task (keep-awake
  holds one exactly while a turn or a stem split runs) at two checks 15 s apart,
  switches, and then deletes its own service. It gives up after two hours and
  says so in `~/app/switch.log`.
- A separate service, because a process started from the turn would be a child
  of the host that the switch restarts.
- `--rollback` on itself goes through the same wait.

### 5. How an agent in the workshop ships

A `CLAUDE.md` at the repo root, which Claude reads in every workshop
conversation, gives the procedure:

1. Make the change; run `npm test` and the browser tests it touches.
2. Try it as a user: `tools/sprite-deploy.sh t-bryan --local`.
3. For a `marble` change: publish it to npm (bump its version), then point
   `marble-drive` at that version.
4. Commit and push to `main`.
5. When the owner says so: `tools/sprite-deploy.sh --all` (Irene's sprite with
   `--no-checkpoint` while its checkpoints are broken), then
   `tools/sprite-deploy.sh admin-p1` (switches when idle).
6. Report what shipped where.

## Guards

- `switch-when-idle`, against a fake Sprites socket and a stubbed `sprite-env`:
  it does not switch while a task is held, switches after two idle checks, and
  deletes its own service afterwards.
- `sprite-deploy.sh` reads its default Claude version from
  `tools/sprite/claude-version`, and running on the target itself hands off to
  `marble-switch` instead of switching.
- A real run from `admin-p1`: a conversation in the Marble Drive project makes a
  small real change, tests it, deploys it to `t-bryan --local`, pushes, and
  updates `admin-p1`; the conversation completes and `admin-p1` ends up on the
  new release.

## Out of scope

- The admin console app (next spec).
- Pull requests, GitHub Actions, other developers.
- Secrets management beyond files with mode 600.
