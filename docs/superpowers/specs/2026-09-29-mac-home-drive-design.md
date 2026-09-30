# The owner's drive lives on the Mac; Fly stands by

2026-09-29. The owner wants to work on his MacBook at full speed, with his
drive held locally, and not pay for a Fly sprite that is awake while he does.
If the Mac sleeps, dies or drops off the network, his drive should still be
reachable at the same address, from Fly, with the latest state. Switching
should be fast and, normally, automatic.

This reverses part of HOSTING-DECISIONS 24 ("the Mac is a mirror"), and keeps
its reason: two hosts writing one drive fork it. So this is not two-way sync.
It is **one home at a time**, with a copy that is always current somewhere
neither machine has to wake.

## What was decided, and why

| Decision | Chose | Why |
|---|---|---|
| Where the drive lives | the Mac is home; Fly (admin-p2) is standby | speed (36 GB, 12 cores vs 8 GB, no swap), and the sprite stalls |
| How the two stay in step | **R2 is the hub**: whichever machine is home uploads changes about once a minute; a machine taking over downloads first | Fly stays asleep while the Mac is home, and still starts from the latest state |
| Two-way live sync | rejected | two writers fork a drive, and a crash is when they disagree (HOSTING-DECISIONS 24) |
| When Fly takes over | **lazily**: only when a request for the drive arrives while the Mac is away | a lid closed overnight with nobody visiting costs nothing and needs no handback |
| A Mac that vanishes without warning | Fly takes over on the next request after about 2 minutes of silence; the Mac's un-uploaded tail is set aside when it returns | always reachable; at most about a minute at risk, and nothing is lost |
| Encryption | files are encrypted on the machine before upload (rclone `crypt`) | the drive holds drafts and agent transcripts; Cloudflare holds only ciphertext |
| What travels | the drive, **Claude sessions**, and a backup of **uncommitted code** | a conversation can be continued on either machine; unpushed work survives a dead Mac |
| Addresses | `marbledrive.app` is the homepage; each drive is `<name>.marbledrive.app` | each drive must be its own origin, since documents are code |
| Which code runs the real drive on the Mac | a **release**, like a sprite's, not the dev checkout | experiments in the repo can never touch real documents; Mac and Fly run the same code, so a switch never changes it |

Considered and set aside:

- **Mac pushes straight to the sprite** (every 15 min, or on sleep). It wakes
  Fly on every push, and a sudden crash leaves Fly up to 15 minutes behind.
- **Cloudflare instead of Fly.** Cloudflare's containers lose their disk when
  they sleep, so the drive would have to live elsewhere and Marble would need
  rebuilding around that. Cloudflare is the front door and the storage; a VM is
  still the computer.
- **restic** instead of rclone. restic gives dated snapshots, but restoring a
  delta onto a live copy and pruning minute-by-minute snapshots cost more than
  they give. A 7-day trash covers "undo that".
- **A second domain for drives** (like `github.io`). Safer, but the owner is
  not buying another. See "Addresses".

## The pieces

### 1. The hub: an encrypted copy in R2

- One private R2 bucket, `marble-drives`, with prefix `bryan/`. Its access key
  is scoped to that bucket and lives only on the Mac and on admin-p2, beside
  the other keys (never in the repo, never printed).
- The encryption passphrase (rclone `crypt`, which encrypts names and
  contents) lives on the same two machines. The owner also keeps it in his
  password manager: without it, R2 holds nothing usable.
- Layout under `bryan/`:
  - `drive/`: the drive.
  - `sessions/`: Claude sessions (piece 6).
  - `workshop/`: uncommitted code (piece 6).
  - `trash/<utc>/`: anything an upload overwrote or deleted, removed after 7
    days by a bucket lifecycle rule.
  - `manifest.json`: the file list (below). Inside the crypt, so encrypted.
  - `state.json`: what the last upload was (below). Not encrypted, and it
    holds no content.
- **The file list.** R2 answers each request in up to several seconds, and
  `rclone sync` over crypt makes one request per file to compare modtimes: on
  t-bryan a 55-file upload took 402 s and a no-change sync 95 s, and the
  owner's drive has ~6,500 files. So every upload also writes
  `manifest.json`, the files `drive/` holds as that upload saw them:

  ```json
  { "seq": 5031, "at": "…", "files": { "Notes/a.mrbl": [2048, 1790776273415] } }
  ```

  Each entry is `[size, mtimeMs]` (rounded to the millisecond), paths use `/`,
  and the left-out files below are never in it. Both sides compare their
  drive against it and move only what differs, so requests scale with what
  changed, not with the drive. Two files are the same when their sizes match
  and their mtimes are within 1 ms (the s3 backend keeps an mtime as a float
  of seconds, which can round a millisecond either side); never by size
  alone. The lists handed to rclone are read with `--files-from-raw`: plain
  `--files-from` skips names starting with `#` or `;` and trims spaces.
- **Upload** (home → R2), `tools/drive-sync.mjs up`. It runs about once a
  minute on the home machine, and only when something changed since the last
  upload. It diffs the drive against `manifest.json`: changed and new files
  go up by `rclone copy --files-from-raw … --no-traverse --ignore-times
  --backup-dir trash/<utc>` (an overwritten version lands in the trash);
  files gone from the drive are moved into `trash/<utc>/` by `rclone move
  --files-from-raw`. With no list yet (the first upload, or a hub uploaded
  before the list existed) it runs `rclone sync` with `--backup-dir` into
  `trash/`. Then it writes `manifest.json`, then `state.json`, in that order:
  an upload cut off part way leaves the old list, and the next one diffs
  against it and moves the rest. `state.json` says what the upload was:

  ```json
  { "home": "mac", "epoch": 12, "seq": 5031, "at": "…",
    "files": 6512, "documents": 96 }
  ```

  It refuses, and says so in Console, when the source has no documents or far
  fewer files than the last upload (the check `drive-pull.sh` already makes).
- **Download** (R2 → taking-over machine), `drive-sync.mjs down`. It diffs
  `manifest.json` against the machine's drive: files missing or different
  locally are fetched by `rclone copy --files-from-raw … --no-traverse
  --ignore-times` (rclone sets each one's mtime from the hub's, so afterwards
  it matches the list), and local files the list does not hold are moved
  aside, never deleted. Both what it replaces and what it moves aside go to
  a local trash (`~/.cache/marble-drive/hub-trash/<drive>/<utc>/`), kept 7
  days. It then scans again and says the drive matches only when every entry
  in the list agrees and nothing extra is left. A hub with no list yet is
  downloaded by `rclone sync`, as before.
- **What is left out:**
  - the host lock (`.marble/agents/host.lock`),
  - each machine's usage ledger (`.marble/usage/`),
  - Console's per-machine reports.
- **Cost:** a 2.2 GB drive is inside R2's free 10 GB. Listing once a minute
  while changes come in is well inside the free million operations a month.

### 2. The lease: exactly one home

A small **Cloudflare Worker** with a **Durable Object** per drive holds the
lease. Durable Objects are strongly consistent; KV can lag by a minute.

```
lease(bryan) = { home: "mac" | "fly", epoch, macSeenAt, macAway: bool, seq }
```

- A host serves the drive only while it holds the current epoch. It checks
  when it starts, and the uploader asks again before every upload.
- Every move raises the epoch. An uploader that finds its epoch is stale does
  not upload: it puts its host on standby, and the Mac's wake rule (piece 8)
  sets its changes aside. That is how a Mac that was off the network, and
  missed a takeover, learns about it. The gap between asking and uploading is
  seconds, and a takeover downloads only after the lease has moved, so a late
  upload lands in R2's trash-backed copy, never on the new home's disk.
- Phase 1 runs the Worker on `workers.dev`, with no DNS. Phase 2 puts the same
  Worker on `marbledrive.app` and adds routing, so the lease is written once.

### 3. Two host modes: home and standby

`marble-drive serve --standby`:

- serves only a small page ("this drive is on the Mac right now"), `/health`,
  and the takeover endpoint;
- starts nothing that writes to the drive: no agents, daily run, page
  upgrades (`app-updates.js`), upload sweep, ledger or backups;
- never opens `/drive` for writing.

A host also stays on standby when it cannot confirm it holds the lease.

### 4. The Mac as a host

- The drive lives at **`~/Marble Drive`**, a real folder. Today that name is a
  link to the latest backup; the first migration turns it into the drive,
  after the backup agent's last copy.
- It is served by a **release**: `~/Library/Application Support/Marble
  Drive/releases/…`, installed by `tools/sprite-deploy.sh mac`, which reuses
  `release.sh`. It runs under launchd as `com.marble.drive.home` on port 4401,
  with the same pinned `claude` as the sprites.
- The dev checkout keeps serving its throwaway `drive/` on 4400
  (`daemon.sh`), exactly as today.
- Shipping "bryan" deploys the release to both the Mac and admin-p2, so the
  two never run different code.
- **Agent projects** name sprite paths (`/home/sprite/src/…`). Each host maps
  them with one prefix setting (`MARBLE_PROJECT_PREFIXES=/home/sprite/src=…`),
  instead of `drive-pull.sh`'s rewrite, so settings survive round trips.
- **Keeping awake:** while an agent is working, the Mac host holds a power
  assertion (`caffeinate -i` for as long as the host reports busy), the
  counterpart of `keep-awake.js` on a sprite. A lid closed on battery still
  sleeps; the turn then pauses and resumes on wake.

### 5. Moving home

One routine, `tools/drive-home.mjs to <mac|fly>`, used by hand in phase 1 and
by the automatic triggers in phase 3.

**Leaving** (the current home):

1. Wait until no agent is working: the `--when-idle` rule, up to 10 minutes,
   or `--now`, which stops running turns (their conversations stay readable).
2. Switch the host to standby.
3. Do a final upload.
4. Release the lease (epoch + 1, `home` = the other machine).

**Arriving:**

1. Take the lease.
2. Download from R2. This moves only what changed since this machine last held
   the drive.
3. Compare file and document counts with `state.json`.
4. Start the host in home mode and check `/health`.

**If a step fails before the arriving host serves:** the lease goes back to
where it was, and the old home leaves standby. Nothing is deleted anywhere, so
every failure can be undone.

### 6. What travels besides the drive

- **Claude sessions.** Agents run with a working folder of
  `~/.cache/marble-drive/agents/<conversation>` (or a project's path), and
  Claude files each session under `~/.claude/projects/<that path, encoded>/`.
  The upload copies the session folders for this drive's working folders to
  `sessions/`, named by conversation id rather than by path. The download
  writes them back under this machine's encoding of the same working folder.
  So `claude --resume` finds them on either machine. Only Claude sessions:
  Cursor and Codex sessions stay where they were made.
- **Uncommitted code.** A backup, not a sync. On the Mac, the workshop
  checkouts (`~/Development/3rd-year-projects/*`, without `node_modules`) go
  to `workshop/` every 15 minutes while they change, which is what
  `drive-backup.sh` does for admin-p2's `~/src` today. Nothing applies it on
  Fly by itself. `tools/workshop-restore.sh` gains an R2 source, for when the
  Mac is gone. Code otherwise moves by git, as now, and a move of home warns
  about unpushed work on the side being left.
- **Never:** keys, logins, `sprite.env`, `agent-keys`, `~/.claude`
  credentials. Each machine keeps its own.

### 7. The front door (phase 2)

- `marbledrive.app` stays registered at Porkbun, with its nameservers moved to
  Cloudflare (free plan). Cloudflare issues the certificates for the apex and
  `*.marbledrive.app`.
- The Worker on `*.marbledrive.app/*` looks each name up in its table:
  - `bryan` → the lease (the Mac's tunnel, or admin-p2's `sprites.app` URL);
  - `irene`, `sam`, `sangho`, `peiling` → their sprites, always.

  It proxies requests, streaming responses and websockets. Reserved names
  (`www`, `app`, `api`, `docs`, `status`, `admin`, `mail`) never go to a drive.
  The apex serves a placeholder until the homepage project exists.
- **The Mac's side:** `cloudflared` runs under launchd as a named tunnel to
  port 4401, reachable only through the Worker.
- **Hosts:** each host takes its public name from config (`MARBLE_PUBLIC_HOST`),
  accepts it in the gate, and sets its login cookie host-only (`__Host-`
  prefix), never for `.marbledrive.app`. The Mac and admin-p2 share one
  passphrase and cookie secret, so a move of home does not sign anyone out.
- The `sprites.app` URLs keep working for tools and as a fallback. The daily
  cron ping moves to `bryan.marbledrive.app`, so it reaches whichever machine
  is home and wakes Fly only when it has to.
- **Plan:** the Workers free plan (100k requests a day) is enough for the
  owner alone. Before friends move over, switch to the $5 plan: live updates
  add up.
- **Later, not now:** the Public Suffix List entry for `marbledrive.app`,
  before anyone the owner does not know gets a drive. It is addable at any time
  without changing a URL.

### 8. Automatic moves (phase 3)

- **Heartbeat:** the Mac host tells the Worker it is alive every 15 seconds.
- **Sleep:** a small launchd helper (Swift, listening for
  `IORegisterForSystemPower`) catches "will sleep" and "will power off". It
  runs a final upload and marks the Mac away (`macAway: true`), using the few
  seconds macOS allows. A network drop is caught by the heartbeat stopping.
- **Lazy takeover:** when a request for `bryan` arrives and the Mac is away,
  or silent for more than 2 minutes, the Worker:
  1. moves the lease to Fly;
  2. wakes admin-p2 through its takeover endpoint;
  3. shows the waiting page ("waking your drive on Fly…") until Fly's host is
     home.
  Arriving runs piece 5.
- **Wake:** the Mac asks the Worker for the lease.
  - Still the Mac's: carry on. No download is needed; nothing ran elsewhere.
  - Fly's: first set aside anything the Mac changed after its last successful
    upload into `~/Marble Drive.unsent-<utc>/`, and say so in Console and in a
    notification. Then run piece 5 with Fly leaving: Fly waits for idle,
    uploads, releases; the Mac downloads and takes over.
- **Offline for a long time** (a plane): the Mac keeps serving locally. If
  nobody asked for the drive meanwhile, the lease never moved, and the Mac
  uploads when it is back online. If somebody did, the wake rule above
  applies.

## Phases

Each phase is usable on its own.

1. **Mac home, by hand.** R2 hub with encryption, the lease Worker on
   `workers.dev`, standby mode, the Mac release and launchd service, and
   `drive-home to mac|fly`. The owner uses `localhost:4401` on the Mac and
   the sprite URL on Fly. The backup agent (Fly → Mac) retires once R2 holds
   a verified copy.
2. **The front door.** Nameservers, the Worker on `marbledrive.app`, the
   tunnel, public-host config and cookies. Friends' drives at
   `<name>.marbledrive.app`.
3. **Automatic.** Heartbeat, the sleep helper, lazy takeover, the set-aside
   on wake, keeping the Mac awake while an agent works.
4. **Sessions and code.** Claude sessions and uncommitted code in R2.

## Console

Console's Drives view shows, for bryan:

- where the drive is now, and since when;
- the last upload (time, seq, files);
- whether an upload is refusing, and why;
- any set-aside folders waiting to be looked at.

It has **Move to Mac** and **Move to Fly** buttons. The Backups view gives way
to this once the backup agent retires.

## Testing

- `drive-sync` against a local S3 stand-in (MinIO, or rclone's `serve s3`),
  with a fixture drive:
  - upload and download round trips, with the trash;
  - the "looks empty" refusal;
  - exclusions;
  - an encrypted round trip.
- The lease as a pure module, tested for: moves, stale epochs refused, the
  2-minute rule, and "away" versus "silent". It runs inside the Worker and in
  a Node test.
- Standby: a host started with `--standby` writes nothing to a drive
  (snapshot of the file tree before and after), and serves only the three
  routes.
- `drive-home`, against a fake remote host: each failure point leaves the old
  home serving and the lease where it was.
- Sessions: a conversation started under one encoded path resumes under the
  other.
- By hand on t-bryan first: the owner's test user gets `bryan`'s whole setup
  with a second Mac folder, before admin-p2 does.

## Docs to update when this lands

`docs/HOSTING.md` (the shape, what is on each machine, runbooks) and
`docs/HOSTING-DECISIONS.md` (a new decision that amends 24). CLAUDE.md's
"Where it runs" gains the Mac as home.

## Open questions

- Whether the Sprites product keeps stalling on standby. If it does, the
  standby can become a plain Fly Machine, or any small server, without
  changing this design: the standby only needs to download from R2 and serve.
