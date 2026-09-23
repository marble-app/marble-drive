# Marble Drive on a sprite

2026-09-23. Status: design, awaiting review. Piece 1 of opening Marble Drive to
other people; the owner's direction is in the 2026-09-22 hosting notes (a
machine per person, agents on each person's own API key).

## Why

Each person gets their own Fly Sprite running today's single-owner host. Before
provisioning, a front door or limits, one sprite has to run Marble Drive well.
The first is `admin-p1` in the `marble-drive` org, the owner's test drive, set
up exactly the way every person's sprite will be, apart from two things only it
has: the owner's own `claude login`, and the option to deploy unreleased code
from the owner's Mac.

What a sprite gives (docs.sprites.dev, read 2026-09-23): a Linux VM (admin-p1:
8 CPUs, 8 GB, 99 GB disk, Node 24, `claude`, `git`, `uv`, passwordless `sudo`)
with a private URL (`https://admin-p1-b3fwm.sprites.app`, "sprite" auth: members
of the org only). After about 30 seconds with no activity it pauses warm, every
process frozen; later it may stop cold, processes gone. Open connections count
as activity and do not survive a pause. A **service** (`sprite-env services`)
starts on boot, survives warm pauses, restarts after a cold one, and the one
with `--http-port` receives the URL's traffic. A **task** registered on the
socket `/.sprite/api.sock` keeps the sprite from pausing. **Checkpoints**
snapshot the disk copy-on-write, and Sprites takes automatic ones.

## Design

### 1. Code arrives from public sources

`marble-drive` is a public repo and `@bdhmin/marble` is public on npm (0.2.1,
the same as the local `marble`), so a sprite needs no credentials. Every
sprite runs a released `marble-drive` commit plus a published `marble` version,
installed the way the Dockerfile already does it: remove the `file:../marble`
dependency, then `npm install --omit=dev @bdhmin/marble@<version>`, plus
Playwright's Chromium for the agents' browser.

`--local` is the exception for the owner's test sprite: the deploy script packs
the working copies on the Mac instead (`git ls-files` of `marble-drive`, and
`npm pack` of `marble`, which gives exactly the shape npm would), so unpublished
changes can be tried on `admin-p1` before they are released.

### 2. Releases, switched atomically

`tools/sprite-deploy.sh <sprite> [--org marble-drive] [--ref <commit>] [--marble <version>] [--local] [--rollback]`,
run on the Mac:

1. Checkpoint the sprite (`sprite checkpoint create`).
2. Stage a release at `/home/sprite/app/releases/<utc-time>-<short-sha>/`: fetch
   `marble-drive` at `--ref` (default: `origin/main`), install dependencies.
   `--marble` defaults to the local `marble`'s version; the script stops with
   "publish marble first, or deploy --local" if npm does not have it.
3. Smoke-test the release on a spare port against a throwaway drive root:
   `/health` answers.
4. Point `/home/sprite/app/current` at it, restart the service, and check
   `/health` again through the service.
5. Keep the last three releases. `--rollback` points `current` at the previous
   one and restarts.

### 3. The host is a Sprites service

```
sprite-env services create marble-drive \
  --cmd node --args bin/marble-drive.js,serve \
  --dir /home/sprite/app/current/marble-drive \
  --env MARBLE_DRIVE_ROOT=/drive,PORT=4400,MARBLE_DRIVE_AGENTS=1,NODE_ENV=production \
  --http-port 4400
```

The drive lives at `/drive` (created once with `sudo`, owned by `sprite`), the
root-level folder the companion spec named for production. Whether the Sprites
proxy reaches the host on `127.0.0.1` or it has to listen on every interface
(`HOST=0.0.0.0`) is checked on first deploy and recorded here.

### 4. It stays awake while work runs

`server/keep-awake.js`: when `/.sprite/api.sock` exists, the host checks every
15 seconds whether anything is running that no tab is watching (an agent turn,
a stem split) and, while something is, registers a task named `marble-drive`
that expires after 5 minutes and is renewed every minute; when nothing is, it
removes the task. On any other machine it does nothing. An open tab keeps the
sprite awake on its own through its live connection.

The 15-second check is inside Sprites' 30-second idle window, so a turn that
outlives its tab is held before the sprite can pause. Tested against a fake
socket. *Confirmed on `admin-p1` 2026-09-23:* `POST /v1/tasks
{"name","expire"}` answers 201 with `expires_at`, `GET /v1/tasks` lists it, and
`DELETE /v1/tasks/<name>` answers 204 — exactly the calls keep-awake makes.

### 5. Access

The URL stays in "sprite" mode: only members of the `marble-drive` org, signed
in with Fly, reach `admin-p1`. No Marble passphrase on top for this sprite.
Other people's sprites get their sign-in from the front door (piece 3).

### 6. Agents

On `admin-p1` only, the owner runs `claude login` once in `sprite console`; it
lives in `~/.claude` there. No other sprite ever gets it; theirs start with no
key and agents unavailable until the person adds their own in Agents settings.

### 7. Backups

A checkpoint before every deploy, plus Sprites' automatic ones. Restoring is
`sprite restore <id>`, which the deploy script prints after each checkpoint.

## Done when

- `https://admin-p1-b3fwm.sprites.app` opens the Drive after the Fly sign-in.
- A PDF uploaded there gets a picture the page drew; a 100 MB upload survives a
  cut connection.
- An agent turn started and then left with every tab closed still finishes
  (the sprite stayed awake), and its transcript is there when a tab returns.
- After a cold stop, the next request brings the Drive back with its documents.
- A deploy, a `--local` deploy and a `--rollback` each leave a working Drive.

## Out of scope

- Creating sprites for other people (piece 2), the front door (piece 3), limits
  and cost (piece 4).
- A custom domain.
- Stem splitting on the sprite (`uv` is there, but Demucs on CPU is a separate
  question).
- Cursor or Codex agents on the sprite.
