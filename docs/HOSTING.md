# Hosting Marble Drive

How Marble Drive runs in the cloud as of 2026-09-30: what runs where, what is
on each machine, and how to ship, add people, recover and troubleshoot. The
reasoning behind each of these choices is in
[`HOSTING-DECISIONS.md`](HOSTING-DECISIONS.md); running a single drive on your
own machine or in a container is in [`DEPLOY.md`](DEPLOY.md).

No key, token or passphrase appears in this repository. Where they live is
listed below; what they are is never written down here.

## The shape

Every drive is its own **Fly Sprite** (a small Linux VM that pauses when idle)
in the Fly org **`marble-drive`**, running this repository's host exactly as it
runs on a laptop. One person, one sprite, one drive.

| Sprite | Who | Role | Label | Updated by |
|---|---|---|---|---|
| `admin-p2` | the owner | his real drive **and** the workshop, where Marble is changed and shipped | `marble-owner` | by name, last |
| `admin-p1` | nobody | the owner's sprite until 2026-09-28, kept asleep for Fly to look at (see "Moving the owner's sprite") | `marble-owner` until relabelled | never |
| `t-bryan` | the owner | a test user on an API key; try changes here first | `marble-tester` | `--all` |
| `t-irene`, `t-sam` | friends | their drives; agents on the owner's Claude login | `marble-tester` | `--all` |
| `t-sangho`, `t-peiling` | friends | their drives; agents on their own API keys | `marble-tester` | `--all` |

A drive can also have its **home on the owner's MacBook**, with its sprite
standing by: one home at a time, the two kept in step through an encrypted copy
in Cloudflare R2 and a lease held by a Cloudflare Worker (see "A drive at home
on the Mac"). That is built and tried on `t-bryan`, which is at home on Fly
(epoch 6) with a service installed on the Mac. **The owner's real drive has not
moved.** admin-p2 still serves it exactly as before, and the backup agent still
copies it to `~/Marble Drive`. When the owner says so, the drive (`bryan`) moves
to the Mac and admin-p2 becomes its standby, and still the workshop.

Until then the MacBook holds no real drive. Its dev checkout's `drive/` is a
**mirror** of admin-p2, pulled one way on request (`tools/drive-pull.sh`), so big
changes to Marble run their tests and harnesses on the Mac, against real
documents, and not on a sprite's compute. Anything written to the mirror is lost
at the next pull; real edits happen on admin-p2. Until the first pull it was a
frozen backup from 2026-09-24 01:15 UTC (kept at `drive.kept-<utc>/` when it is
replaced).

## Three layers, three ways of saving

| Layer | What | Saved by | Reaches |
|---|---|---|---|
| A person's drive | documents, apps, history, their skills and settings | Marble, as they work (`/drive/.marble/`) | that person only |
| `marble-drive` (this repo) | host, page code, templates, starters, agent skills | git → push → deploy | every sprite |
| `marble` (`../marble`) | the format and its carrier | git → `npm publish` → then this repo | every sprite |

A person's own **Drive and Agents pages** are documents in their drive, copied
from `templates/` once, when the drive is new. A deploy never changes them. So a
change to the host, `runtime/*.js`, `starters/` or `agent-plugin/` reaches
everyone on the next deploy, and a change to `templates/drive.mrbl` or
`templates/agents.mrbl` reaches new drives only (see "Shelved").

## What is on a sprite

| Path | What | Survives a deploy |
|---|---|---|
| `/drive` | the drive: documents, `.marble/` history, conversations, `.claude/skills/`, `.marble/drive.json` | yes (never touched) |
| `/drive/.marble/usage/<day>.jsonl` | the drive's own ledger: one line per awake minute (CPU, memory, disk, why it was up, how it woke), 90 days (`server/ledger.js`) | yes |
| `~/app/releases/<utc>-<sha or local-sha>/marble-drive` | a release of this repo, its own `node_modules` and its own pinned `claude` | the last three that went live are kept |
| `~/app/current` | link to the live release | switched by a deploy |
| `~/app/history` | releases that went live, in order (rollback reads it) | yes |
| `~/app/release.sh` | the sprite's half of a deploy (`tools/sprite/release.sh`), re-sent each deploy | replaced |
| `~/.config/marble-drive/sprite.env` | this sprite's settings (`KEY=value`, mode 600): passphrase, secure cookie, which Claude pays, extra keys (TYPESAFE_API_KEY on admin-p2) | yes |
| `~/.config/marble-drive/agent-keys` | API keys saved in Agents settings (mode 600) | yes |
| `~/.claude/` | a Claude login, where the owner ran `claude login` | yes |
| Sprites service `marble-drive` | the host, port 4400, run by the release's `tools/sprite/serve.sh`, which starts it again if it dies; recreated on every switch | recreated |
| `~/app/crash/` | `crashes.log` (a line per time the host died and was started again) and Node's report of a fatal error, such as running out of heap | yes |
| `/.sprite/logs/services/marble-drive.log` | the host's log | yes |
| `~/app/switch.log` | admin-p2 only: self-updates that waited for idle | yes |
| `/home/sprite/src/{marble-drive,marble}` | admin-p2 only: the workshop checkouts (and the other worktrees beside them), agent projects "Marble Drive" and "Marble" | yes |

The service's environment is the release script's defaults
(`MARBLE_DRIVE_ROOT=/drive`, `PORT=4400`, `HOST=127.0.0.1`, agents on,
`NODE_ENV=production`, the release's own `node_modules/.bin` first on `PATH`,
`MARBLE_DRIVE_AGENT_KEYS` outside the release) followed by every line of
`sprite.env`. A value in `sprite.env` may not contain a comma.

## Getting in

- **Every sprite has a Marble passphrase** (`MARBLE_DRIVE_SECRET` in its
  `sprite.env`). The host answers agent routes only to a signed-in browser, or,
  with no passphrase, only when asked for as `localhost`, which a sprite URL
  never is.
- **An agent's browser gets a pass.** Each turn's headless Chromium is handed
  the gate's own cookie, good for a day and planted for `127.0.0.1` and
  `localhost` only, so it can open the drive it works on (`/a/<path>`) and
  nothing else is signed in. Every release installs the Chromium build its
  Playwright wants and launches it before it can go live.
- **Testers' URLs are public**, so the passphrase is their only lock.
  **admin-p2's URL is private to the Fly org** as well, because it holds the
  keys that can change everyone's drive.
- **The roster** of URLs and passphrases is on the owner's Mac at
  `~/.config/marble-drive/testers.json` (mode 600). Read one:

  ```
  node -e 'console.log(JSON.parse(require("fs").readFileSync(require("os").homedir()+"/.config/marble-drive/testers.json","utf8"))["t-sam"])'
  ```

## Agents on a sprite

- One **Claude** agent, with a switch in Agents settings: **Claude login** or
  **API key**. New conversations use the chosen one; a conversation keeps the
  one it started on. A key-paid conversation's tag reads "Claude · API".
- A sprite's first mode comes from `MARBLE_DRIVE_AGENT_PROVIDER` in its
  `sprite.env` (`claude-subscription` or `claude-api`); after that, the switch.
- **Claude login:** the owner runs `sprite console -o marble-drive -s <sprite>`,
  then `claude login`. **API key:** the person pastes it in Agents → Settings
  under Claude.
- Each release carries its own Claude Code at the version in
  `tools/sprite/claude-version` (the Sprites image's `claude` is older and lacks
  flags the host passes), and its own Codex at `tools/sprite/codex-version`
  (`@openai/codex`, whose native binary is an optional dependency).
- **Codex:** the person pastes an OpenAI key in the first-visit popup or
  Agents → Settings, and Codex runs on it. A ChatGPT login works too
  (`sprite console`, then `codex login --device-auth`). Codex keeps its
  threads in `~/.codex`, which does not travel with a drive that moves between
  the Mac and Fly: a chat resumed on the other side starts a new thread. The owner's subscription is shared with two friends
  by his choice; Anthropic's consumer terms are for one person, so a
  Console key per friend is the path for anyone else.
- **Staying awake, and sleeping:** a sprite pauses about a second after its
  last connection closes (Fly's docs say 30 s; measured on t-bryan, it is
  immediate), freezing every process. Two things keep it up, and both let go:
  - **Tabs.** Every page runs `runtime/tab-rest.js` first: a tab hidden for
    60 s, or shown with no input for 10 min, closes its live streams, and
    reopens them and catches up on the next input. The host closes the streams
    of a tab that has not reported use (`POST /tab/alive`) in 15 min and answers
    its reconnect 204 (`server/streams.js`).
  - **Work.** While a turn or a stem split is getting somewhere, the host holds
    a Sprites task (`server/keep-awake.js`) so it outlives its tab. The task is
    taken the moment work starts (every agent event, and a split being asked
    for, nudges it), because the request that started the work is often the
    last connection. It lets go
    after 10 min of an unanswered question, 30 min without progress (output, or
    CPU and I/O of its processes), or 24 h since anyone used the drive
    (`server/hold.js`). Letting go freezes the work; it carries on when someone
    comes back. All of these count awake time (`server/awake.js`), so a night
    frozen adds nothing and wakes nothing.
  - Limits, in `sprite.env`: `MARBLE_DRIVE_TAB_HIDDEN_SECONDS` (60),
    `MARBLE_DRIVE_TAB_IDLE_MINUTES` (10), `MARBLE_DRIVE_STREAM_UNUSED_MINUTES`
    (15, or the idle and hidden limits added together plus a minute, if longer,
    unless it is set itself), `MARBLE_DRIVE_ASK_HOLD_MINUTES` (10),
    `MARBLE_DRIVE_NO_PROGRESS_MINUTES` (30), `MARBLE_DRIVE_AWAKE_MAX_HOURS`
    (24). The page reads its two from the host. A turn is only ever ended by the
    stall rule: 30 min of no output and no work, in awake time
    (`MARBLE_DRIVE_AGENT_STALL_MINUTES`).
  - **admin-p2 stays up while the owner uses it:** its `sprite.env` has
    `MARBLE_DRIVE_TAB_HIDDEN_SECONDS=1800` and `MARBLE_DRIVE_TAB_IDLE_MINUTES=60`
    (so its stream cut is 91 min). Waking costs seconds from paused and
    about 70 s from stopped (measured 2026-09-25), which is what made moving
    between pages feel slow. Testers keep the short defaults.
- **Staying up:** a Sprites service is not restarted when its process dies,
  so the service runs `tools/sprite/serve.sh`, which starts the host again
  (at once, then backing off to a minute while it keeps failing) and writes
  each exit to `~/app/crash/crashes.log`; Node leaves a report there on a
  fatal error. When the machine runs out of memory the kernel takes an agent's
  turn, and whatever it runs (a test's Chromium), before the host: Sprites
  starts a service at `oom_score_adj` -900 and each turn raises its own to 500
  (`server/agent/first-to-go.js`). A hard ceiling (a cgroup's `memory.max`)
  cannot be set on a sprite, even as root.
- **Memory:** a sprite has 8 GB and no swap, and short of memory Linux does not
  kill anything, it thrashes: exec, the files API and the host all stall for
  as long as the load lasts. The kernel's killer never fires, so the host
  watches instead (`server/memory-guard.js`): every 2 s it reads what is left
  and the kernel's memory pressure, and below 1.5 GB left (or 3 GB with
  pressure at 10%) it stops the heaviest thing an agent's turn is running (a
  test run and its Chromium), logging `[memory] …`; the turn goes on and reads
  its command as killed. Only processes under the host at a turn's score count
  (a sprite's init runs at that score too). The host sees a 16 GB machine of
  which about 8 GB is never its (Fly's autoscaled memory), so its
  `MemAvailable` is the real room: about 6 GB idle on t-bryan, falling one for
  one with load, pressure staying under 1% until the last few hundred MB. A
  shell's view (8 GB total) updates in steps and misleads. `/health` reports
  the host's reading; each ledger line has `total`, `procs` (MB for the host,
  the agents' turns, their browsers, the rest) and `relieved`. On a sprite,
  browser tests go through `node tools/browser-tests.mjs <files>`: on
  admin-p2, while the owner's Mac is watching, they run on the Mac (below);
  otherwise here, one file at a time (`node --test` alone runs a Chromium per
  core).
- **Browser tests on the owner's Mac:** `tools/test-runner.mjs`, kept running
  by `macos/launchd/test-runner.sh install` (installed 2026-09-29), watches
  admin-p2 as the backup agent does: the Sprites API for awake or asleep, and
  only while awake a look in `~/app/runner` there, every 3 s while an agent's
  turn or a tab keeps the drive busy and once a minute when not (so its looking
  never keeps the sprite up). It leaves a check-in (`mac.json`); a run asked
  for is a request file it takes, copies the checkout and `marble` into
  `~/Library/Caches/marble-runner/admin-p2/` (rsync through `sprite-rsh.sh`,
  without `node_modules` and `.git`), installs packages when `package.json` or
  the lock changed, runs `node --test --test-concurrency=2` on the files, and
  sends the output back every 2 s. The sprite's side prints it as it comes;
  stopping it stops the Mac's run. A checkout must be under `/home/sprite/src`
  and every file under its `test-browser/`, and nothing but `node --test` is
  ever run. The tests run as the owner, as his own Claude Code sessions do.
  No Mac (or one that does not take the run in 75 s, or goes quiet for 60 s):
  the run happens on the sprite. Log: `~/Library/Logs/marble-drive/test-runner.log`.
- **Page weight:** the host compresses text (Brotli, else gzip; Fly's edge
  gzips anyway), and a page names each runtime file at `?v=<hash>`, which the
  browser keeps until the file changes. Moving between documents downloads
  only the document.
- **Git:** agents in a person's Drive project cannot reach a repository
  (`GIT_CEILING_DIRECTORIES`); agents in a registered project (the workshop's)
  can.

## Shipping a change: the workshop

The owner works in his drive on admin-p2. A bug or an idea becomes a
conversation there in the **Marble Drive** (or **Marble**) project. The agent
follows the repo's `CLAUDE.md`:

1. Make the change; `npm test` and the browser tests it touches.
2. Try it as a user: `tools/sprite-deploy.sh t-bryan --local`.
3. A `marble` change: bump, `npm publish` from `../marble`, point this repo at it.
4. Commit and push to `main` (straight to `main`, by the owner's choice).
5. When the owner says so: `tools/sprite-deploy.sh --all`, then
   `tools/sprite-deploy.sh admin-p2`. From admin-p2 itself this stages the
   release and hands the switch to a `marble-switch` service that waits until no
   agent is working, so the conversation that asked is not cut off. From
   anywhere else, add `--when-idle` for the same wait.
6. Report what shipped where.

admin-p2 is signed in to GitHub (`gh auth login` + `gh auth setup-git`), npm
(`npm login`) and Sprites (`sprite login`) by the owner, and commits as
`bdhmin`. `tools/sprite-workshop.sh admin-p2` refreshes the checkouts (fast-forward
only, never over local changes), installs them and re-registers the projects.

The same steps work from the MacBook, where this repo also lives.

## A drive at home on the Mac or the PC

Built 2026-09-29 and 2026-09-30 for the Mac; tried on `t-bryan` (a 56-file
drive), then the owner's drive moved to the Mac on 2026-09-30. The PC (Windows,
the drive in Ubuntu under WSL2) joined as a third home on 2026-10-06, to take
over from the Mac (decision 29). The design is in
[`superpowers/specs/2026-09-29-mac-home-drive-design.md`](superpowers/specs/2026-09-29-mac-home-drive-design.md);
why, in decision 28. Only a drive whose `sprite.env` sets `MARBLE_HUB_ENV` takes
part. Every other drive is one host on one sprite, as before.

**One home at a time.** The drive lives on one machine, its **home**, and the
others stand by. Two hosts writing one drive fork it, so nothing is synced both
ways. The home uploads its changes to R2; a machine taking over downloads them
first.

| Part | What it is |
|---|---|
| **The hub** | Cloudflare R2 bucket `marble-drives` (Western North America), prefix `<drive>/`. Files are encrypted on the machine before upload (rclone `crypt`: names and contents), so R2 holds only ciphertext. Code: `server/hub/sync.js`; by hand: `tools/drive-sync.mjs` |
| **The lease** | the Worker `marble-lease` (`worker/`) at `https://marble-lease.bryandhmin.workers.dev`, on the Cloudflare account `bryandhmin@gmail.com`. One Durable Object per drive holds `{home: mac, pc or fly, epoch, since}`. Every move names the epoch it moves from and raises it, so two moves at once cannot both win. One secret, `LEASE_TOKEN` (`wrangler secret put`); every call carries it as a bearer token |
| **Home and standby** | a host serves the drive only while the lease names its machine. Otherwise it runs `marble-drive standby` (`server/standby.js`): `/health` (`standby: true`) and a page saying where the drive is, and nothing that writes: no agents, no daily run, no uploads |
| **The Mac's host** | a release under `~/Library/Application Support/Marble Drive/app` (`tools/home-release.sh`, also called `mac-release.sh`), run by launchd as `com.marble.drive.home.<name>` (`macos/launchd/home.sh`) through the same `tools/sprite/serve.sh` a sprite uses. `bryan` is `~/Marble Drive` on port **4401**; any other name is `~/Marble Drive (<name>)` on **4402**. The dev checkout keeps port 4400 and its throwaway `drive/` |
| **The PC's host** | the same, in Ubuntu under WSL2: a release under `~/.local/share/marble-drive/app` (`tools/home-release.sh`), run by systemd as the user service `marble-drive-home-<name>` (`linux/systemd/home.sh`; lingering on, so no window need be open), the same ports and folder names (`~/Marble Drive`, which Windows sees at `\\wsl.localhost\Ubuntu\home\<user>\Marble Drive`). Logs in `~/.local/state/marble-drive/`. A Windows task, "Marble Drive (WSL)" (`windows/wsl-home.ps1`), keeps WSL running from each sign-in. Set up by `tools/pc-setup.sh` |

### What the hub holds

- `<drive>/state.json`: the last upload (who, epoch, `seq`, counts, time). Plain;
  no content.
- `<drive>/data/`: encrypted. `drive/` (the drive), `manifest.json` (the file
  list) and `trash/<utc>/` (anything an upload overwrote or deleted).
- **Left out:** the host lock (`.marble/agents/host.lock`), each machine's usage
  ledger (`.marble/usage/`) and Console's backup reports
  (`.marble/console/backups/`).
- **The file list.** Over an encrypted store rclone asks R2 once per file to
  compare times, and R2 answers slowly: a 55-file upload took 402 s. So every
  upload writes `manifest.json`, `[size, mtimeMs]` for each file, and both sides
  compare their drive to it and move only what differs. Two files are the same
  when their sizes match and their times are within 1 ms. The list is trusted
  only when its `seq` equals `state.json`'s; if not (an older release wrote the
  hub, or an upload was cut off between the two writes) the pass is a full sync
  and writes a fresh list.
- **Trash.** Every upload puts what it replaces or removes in `trash/<utc>/`;
  every download puts what it replaces or sets aside in
  `~/.cache/marble-drive/hub-trash/<drive>/<utc>/` on that machine, 7 days.
  Nothing is deleted outright. In R2 a lifecycle rule **"trash 7 days"** on each
  drive's trash prefix removes the old ones; `node tools/drive-sync.mjs
  trash-prefix` prints the prefix (`<drive>/data/<encoded trash>/`). The rule is
  set by hand in the Cloudflare dashboard, once per drive.
- **Upload** (`drive-sync up`): the home host checks the lease every minute and
  uploads only when the drive differs from its last upload. It refuses, and
  says so in the log, when the drive has no documents or under half the files
  of the last upload ("looks empty": nothing is sent). A host that finds the
  lease has moved stops (exit 75; `serve.sh` starts it again on standby). One
  that cannot reach the lease waits a minute; it never uploads blind.
  A change on the Mac reaches R2 in about 1.5–2 minutes.
- **Download** (`drive-sync down`): fetches what differs, sets aside what the
  hub does not hold, and says it matches only when a fresh scan agrees with the
  list entry by entry.
- **A sprite stays awake until its changes are up.** A sprite pauses about a
  second after its last connection, which would freeze an upload. While changes
  are not yet in the hub, the home host holds a second keep-awake task,
  `marble-drive-hub`, taken on each write request (anything but GET or HEAD, when
  it arrives and again when its response closes) and on a rescan every 15 s. It
  lets go after 30 minutes of failed or refused tries, or of an unreachable
  lease, and a new change takes it again. The Mac has no such task.

### Which way a host starts

`tools/sprite/serve.sh` asks `tools/home-mode.mjs` before every start (only
where `MARBLE_HUB_ENV` is set), and it answers `serve` or `standby`, logging
`[home] <mode>: <why>` to `~/app/crash/crashes.log` (the Mac:
`~/Library/Logs/marble-drive/home-<name>-crash/`):

1. A **hold file** beside the hub settings, `hold-<drive>`, forces standby,
   whatever the lease says. `drive-home` puts one on the side a drive leaves.
   The Sprites proxy starts a stopped service on the next request, and a
   reboot starts the Mac's, so stopping a host is no hold; the file is.
2. Else the lease: it names this machine, `serve`; it names the other, `standby`.
3. A lease that cannot be reached (no network) is answered by the last lease
   this machine saw, kept beside the settings as `lease-<drive>.json`: the Mac
   on a plane goes on serving if that lease named it. A machine that never saw
   one stands by.
4. A lease that **refuses** this machine (401, 403, 404: a wrong `LEASE_URL` or
   `LEASE_TOKEN`) is not unreachable: the remembered lease is not used, and the
   machine stands by.
5. Settings that cannot be read: standby.

### Settings

| Where | File |
|---|---|
| Mac | `~/.config/marble-drive/hub-<name>.env` (mode 600) |
| PC | `~/.config/marble-drive/hub-<name>.env` (mode 600), in Ubuntu |
| sprite | `~/.config/marble-drive/hub.env` (mode 600), named by `MARBLE_HUB_ENV=/home/sprite/.config/marble-drive/hub.env` in `sprite.env` |

All hold the same keys, `HUB_MACHINE` being `mac`, `pc` or `fly`: `HUB_DRIVE`, `HUB_MACHINE`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `HUB_PASSPHRASE`, `HUB_SALT`, `LEASE_URL`,
`LEASE_TOKEN`. The host reads the file itself, so the R2 keys never reach an
agent's processes. **Without `HUB_PASSPHRASE` and `HUB_SALT` the R2 copy can
never be read.** The owner keeps both in his password manager. A file named but unreadable stops the host on standby; it is
never read as "no hub".

`sprite.env` on a sprite in the hub also has `MARBLE_PROJECT_PREFIXES=/Users/bryanmin/Development/3rd-year-projects=/home/sprite/src`.
Agent projects name paths on the machine that made them; each host maps the
other's prefix to its own, so the same conversation opens on either. (The Mac's
launchd job carries the reverse.) Like any `sprite.env` value it may not contain
a comma.

Beside the hub settings, each home has its own: `mac-<name>.env` on the Mac,
`pc-<name>.env` on the PC (the drive's passphrase, the daily run, the TypeSafe
key, Console). `tools/home-secrets.sh pack` on the Mac writes both files into
one encrypted file (AES-256, from a passphrase you type) for you to carry to
the PC however you like; `unpack` there writes the PC's copies, `HUB_MACHINE=pc`
and the Mac's paths turned into the PC's. Run it in your own terminal.

The **R2 access key** lives in these files and nowhere in this repository.

### rclone

Pinned for sprites at 1.75.1 (`tools/sprite/rclone-version`, and
`tools/sprite/rclone-sha256` for each architecture) and installed by the release
script into `~/.local/bin` only on a sprite whose `sprite.env` sets
`MARBLE_HUB_ENV`, so no friend's deploy fetches it. A failed install warns and
never fails a deploy. The Mac uses Homebrew's.

From the owner's home network, R2 sometimes leaves a request unanswered 5–90 s
after connecting (measured 2026-09-30: `curl` connects in 0.05 s, and from Fly
every request answers in 0.3 s). So every rclone call times out after 10 s (5 s
to connect) and retries up to 20 times (`PATIENCE` in `server/hub/sync.js`). The
Mac's side is slower for this reason, and only this. The PC uses the pinned
rclone, installed by `tools/pc-setup.sh`.

### How a move goes

`node tools/drive-home.mjs to <here|fly> [--drive bryan] [--sprite admin-p2] [--now]`,
run **on the Mac or the PC**, where `<here>` is that machine (`mac` or `pc`, its
`HUB_MACHINE`). A move is always between that machine and Fly: the Mac and the
PC never move a drive straight to each other. From the Mac to the PC is
`drive-home to fly` on the Mac, then `drive-home to pc` on the PC. A lease that
names a machine the run cannot reach (the Mac, run from the PC) stops it before
anything is touched.

1. Read the lease. If it already names the target and the target serves, done.
2. Wait until no agent is working on the side being left (up to 10 minutes;
   `--now` skips the wait and stops the running turns, whose conversations stay
   readable).
3. **Hold** the leaving side (its hold file, then a restart): it comes back on
   standby.
4. Its final upload.
5. Move the lease (epoch + 1).
6. The arriving side downloads and checks that it matches the hub.
7. Release the arriving side (remove its hold file, restart) and wait for
   `/health` to say it is serving. The leaving side stays held, and must say
   standby on `/health`.

Nothing is deleted at any step. A step that fails puts things back: the lease is
handed back if it moved, the side the lease names is released, and the message
says where the lease is and what was started. If the lease names a copy that was
not verified, that side is held, not released (it would upload over the hub),
and the message says so.

`node tools/drive-home.mjs rescue-to <here|fly> --from <mac|pc>` is for a home
that is gone: the PC switched off, asleep or broken while the lease names it,
so nothing can hold it or take its last upload. Run where the drive should go
next (on the Mac, or anywhere for Fly), it holds that side, moves the lease off
the dead machine, downloads the hub (the drive as the dead machine last
uploaded it, about two minutes behind) and releases it once the copy matches.
It refuses unless the lease still names the machine called dead, and refuses a
machine it can reach (use `to`). Changes the dead machine made after its last
upload stay on its own disk; when it comes back it asks the lease and stands
by, and its uploads stop as soon as they see the lease has moved.

`node tools/drive-home.mjs lease-to <here|fly> [--drive bryan]` moves only the
lease, with no upload or download, to a side whose copy is good: it holds the
other side, moves the lease, releases the target. It refuses while the other
side is serving as home, since its newest changes would be left behind (use
`to`). This is the way out of a move that stopped with the lease on a copy that
could not be verified.

**Never run `drive-home` from a conversation hosted on either side.** It stops
that host, and the conversation with it.

Measured 2026-09-30 on `t-bryan`, 56 files:

| | Fly to Mac | Mac to Fly |
|---|---|---|
| with the file list | 15–24 s | 59–113 s |
| before the file list | 211 s | 121 s |

### Day to day

- **The PC is home:** open `http://127.0.0.1:4401` in Windows (WSL passes
  localhost through) or `https://bryan.marbledrive.app` anywhere. Check, in
  Ubuntu: `linux/systemd/home.sh status bryan`; logs: `… logs bryan`.
- **The PC's code.** `tools/home-release.sh` in the PC's checkout, as on the Mac.
- **Pull a copy on the Mac** (or anywhere with the hub settings):
  `tools/drive-pull.sh --hub` puts a read-only copy of the drive, as its home
  last uploaded it, in the checkout's `drive/` (`--into <dir>` for elsewhere),
  for the dev host on 4400. It reads the hub only; edits made there are lost
  at the next pull. Each pull after the first fetches only what changed.
- **The Mac is home:** open `http://127.0.0.1:4401` (`bryan`) or `:4402`
  (a trial drive). The sprite's URL shows "This drive is being served from the
  other machine". Check: `zsh macos/launchd/home.sh status bryan`, and
  `node tools/drive-sync.mjs state` (with `MARBLE_HUB_ENV` set to the Mac's
  file) for the last upload.
- **The Mac's code.** `tools/mac-release.sh [--ref <commit>]` builds a release
  from the same sources a sprite runs (this repo, `@bdhmin/marble` from npm, the
  pinned Claude), smoke-tests it on a throwaway drive with no hub, switches
  `current`, and restarts every `com.marble.drive.home.*` job (one that fails is
  named at the end). Keep three.
- **Install a name:** `zsh macos/launchd/home.sh install <name>` after the
  first `mac-release.sh`; it comes up on standby if the lease says Fly. Also
  `start`, `stop`, `restart`, `status`, `logs`, `uninstall` (the drive's folder
  is left as it is).
- **Give the drive up on a stuck or wrong side:** `drive-home lease-to <side>`
  (above). **Hold a side by hand:** create `hold-<drive>` beside its hub
  settings and restart it; remove it and restart to release.
- **Rolling back admin-p2** to a release from before the hub while the Mac is
  home brings admin-p2 up serving, a second writer. Don't:
  `tools/sprite-deploy.sh admin-p2 --rollback` only while admin-p2 is at home.
- **Retiring the Mac as a home** (once the drive is at home on the PC): on the
  Mac, `zsh macos/launchd/tunnel.sh uninstall bryan`, `zsh
  macos/launchd/home.sh uninstall bryan`, and a hold file
  (`~/.config/marble-drive/hold-bryan`) so nothing there serves the drive
  again. Its `~/Marble Drive` is set aside, not deleted. The Mac keeps its hub
  settings for `drive-pull.sh --hub`, and could be a home again (`home.sh
  install`, remove the hold, `drive-home to mac` from Fly).

### The front door (marbledrive.app)

Built 2026-09-30, **not deployed**: the Worker routes and the Mac's tunnel are
not live yet. The aim: `https://bryan.marbledrive.app` reaches the owner's drive
wherever it is at home, with the drive's own passphrase. Other drives, wildcard
names and taking over a drive on a request are not built.

- **The router** is the lease Worker's second job (`worker/src/router.js`). A
  request whose hostname is `marbledrive.app` or under it is routed, and needs
  no `LEASE_TOKEN`; anything else (the workers.dev `/lease` API) is as before.
  The apex and `www.` show a "coming soon" page. A reserved name (`www`, `app`,
  `api`, `docs`, `status`, `admin`, `mail`), a name not in `DRIVES`, or a deeper
  name is a 404, "No drive lives here". For a drive, the Worker reads its lease
  from the Durable Object and passes the request through to that home whole
  (method, body, cookies; `X-Forwarded-Host` set to the public name,
  `X-Forwarded-Proto: https`, redirects not followed). The answer comes back
  untouched, so every `Set-Cookie` survives and SSE streams. The path is always
  joined to the home's own origin, never resolved against it, so `//other.host/`
  cannot send the request (its cookie, or the Sprites token) anywhere else.
  Each Worker isolate keeps a lease it read for 5 s, so not every request reads
  the Durable Object (the Free plan's quota is shared with the lease API); for
  those seconds after a move a request can reach the side just left, which
  answers as a standby.
- **When a home does not answer:** the Mac (a network failure, or Cloudflare's
  530 for a tunnel with no connector) gives a 503 saying the Mac is asleep or
  offline and that `node tools/drive-home.mjs to fly` on the Mac moves the
  drive. Fly gives a 503 "try again in a minute". A lease that cannot be read is
  a 503 "Can't tell where this drive lives right now". All with
  `Retry-After: 30`.
- **`DRIVES`** (a `[vars]` JSON string in `worker/wrangler.toml`) names each
  drive's two homes: `mac`, its tunnel name (`https://mac-bryan.marbledrive.app`),
  and `fly`, its sprite URL. The routes in `wrangler.toml` list each name
  (`marbledrive.app`, `www.`, `bryan.`), never a wildcard, so the tunnel names
  never pass through the Worker. A Worker route fires only on a hostname with a
  proxied DNS record, so each routed name needs one (e.g. `AAAA 100::`,
  proxied).
- **`SPRITES_TOKEN`** (optional Worker secret, `wrangler secret put
  SPRITES_TOKEN`). admin-p2's URL is private to the Fly org. With the token set,
  a request for a drive at home on Fly carries it as `Authorization: Bearer`
  (never over an `Authorization` the browser sent). **Setting it takes that
  privacy away in front of admin-p2:** anyone on the internet reaches its host
  through `bryan.marbledrive.app`, and the drive's passphrase is then its only
  lock, as it is on the Mac. Without it, the request is redirected (302) to the
  same path on the sprite URL, where the owner signs in to Sprites. A bearer
  through the Sprites proxy is untested.
- **The PC's tunnel** (`linux/systemd/tunnel.sh`, the same verbs and the same
  refusals) is `marble-<name>-pc` for `pc-<name>.marbledrive.app`, run by
  systemd as `marble-drive-tunnel-<name>`; its settings file is
  `pc-<name>.env`. `DRIVES` names it as the drive's `pc` home. The 503 for a
  home out of reach names the PC when the PC is home.
- **The tunnel** (`macos/launchd/tunnel.sh`). Once, after `cloudflared tunnel
  login` (pick the `marbledrive.app` zone): `zsh macos/launchd/tunnel.sh setup
  bryan mac-bryan.marbledrive.app` creates the tunnel `marble-bryan-mac`, writes
  `~/.cloudflared/marble-bryan.yml` (that name to `http://127.0.0.1:4401`,
  anything else 404) and points its DNS at the tunnel. Then `zsh
  macos/launchd/tunnel.sh install bryan` runs `cloudflared tunnel run` under
  launchd as `com.marble.drive.tunnel.bryan` (KeepAlive; log
  `~/Library/Logs/marble-drive/tunnel-bryan.log`); also `start`, `stop`,
  `restart`, `status`, `logs`, `uninstall` (which leaves the tunnel and its DNS
  record at Cloudflare), and `check`, which says whether `install` would be
  allowed. `setup` takes only a single-label name under `marbledrive.app` that
  the Worker does not route (`worker/wrangler.toml`), so a routed name's DNS is
  never pointed at the tunnel.
- **The tunnel is only for a gated drive.** `install`, `start` and `restart`
  refuse unless `~/.config/marble-drive/mac-<name>.env` sets a non-empty
  `MARBLE_DRIVE_SECRET` as node reads the file (the host reads it the same
  way; a node too old for `--env-file-if-exists` is refused by name), and
  unless the host on the loopback port the tunnel's config forwards to asks for
  it: `/` without a cookie is sent to `/gate` or refused (401), or the host is
  a standby. A config that forwards anywhere but http on loopback is refused. A
  passphrase added to the file counts only once the home service has
  restarted. The tunnel name is public, and anyone can reach it without
  passing the Worker. Use the drive's Fly passphrase, so one sign-in
  cookie is good on both machines.
- **Signing in.** The drive's gate does it, as on a sprite. Its cookie is
  host-only, so `bryan.marbledrive.app` has its own sign-in, apart from
  `127.0.0.1:4401` and the sprite URL. Behind the tunnel, cloudflared connects
  over loopback with `X-Forwarded-Proto: https`, so the cookie is `Secure` and
  named `__Host-marble_drive`. Every change has to come from the drive's own
  pages: the host compares `Origin` with `X-Forwarded-Host`
  (`server/sessions.js`, and Console's), so pages served under the public name
  can post and a page on another drive can't ("Other people's drives on the
  PC", below).
- **Share links.** The owner opens the Mac's drive at `127.0.0.1`, and a link
  written there would open only on the Mac. `mac-<name>.env` sets
  `MARBLE_DRIVE_PUBLIC_URL=https://<name>.marbledrive.app` so links are written
  at the front door (`docs/SHARING.md`); it counts once the home service has
  restarted. The Worker passes `/s/<token>` and the cookie it sets through
  untouched.
- **Adding a drive later:** add it to `DRIVES` and a route line for
  `<name>.marbledrive.app` in `worker/wrangler.toml`, plus a proxied DNS record
  for that name; deploy the Worker. For its Mac home, run `tunnel.sh setup
  <name> mac-<name>.marbledrive.app` and `install <name>` on the Mac (any name
  but `bryan` goes to port 4402, as `home.sh`).

### Accounts and the door

Built 2026-10-10 on the `accounts` branch, **not switched on**: no Worker
secrets, no OAuth apps, no wildcard route and no door sprite exist yet. How to
turn it on, every setting, and the day-to-day commands are in
[ACCOUNTS.md](ACCOUNTS.md); the design is
[the spec](superpowers/specs/2026-10-10-accounts-and-sign-in-design.md).

- **The pieces.** The Worker gains a third job, the door (`worker/src/door/`):
  the Directory (a Durable Object of people, invites, drives, sessions and the
  audit log), Google and GitHub sign-in, the pages at `marbledrive.app`, and
  the passes. With `DOOR_SIGNING_KEY` unset none of it runs. For a drive the
  Directory gives an owner, the router checks the owner's pass before it
  proxies, and answers strangers itself, so they never wake the sprite; share
  links and a script's bearer go through for the drive to judge. Each drive
  checks the same pass again (`server/door.js`), and a door sprite runs
  `marble-drive provisioner` to make the drives people ask for.
- **A drive made by sign-up** is sprite `d-<name>`, label `marble-user`, so
  `sprite-deploy.sh --all` includes it. Its `sprite.env` has a random
  passphrase nobody was shown, the door settings, and `MARBLE_DRIVE_GATE=tools`.

**Runbooks.**

- *A drive's making failed.* Its page says which step and that you will finish
  it; `node tools/door.mjs drives` shows `failed at <step>`. The door sprite's
  log (`sprite exec -s door -- tail ~/app/crash/crashes.log`, and the service's
  own output) has the script's error. Finish it with `--resume` or remove it
  with `--remove` (ACCOUNTS.md, "Day to day").
- *The signing key is lost or out.* Make a new pair, `DOOR_KEY_ID` to a new id,
  the new private half into `DOOR_SIGNING_KEY`, and the new public half into
  `DOOR_PUBLIC_KEYS` and every drive's `MARBLE_DOOR_KEYS` (deploy them). If the old key leaked, do not
  keep it in `DOOR_PUBLIC_KEYS` or any drive's list: every pass it signed stops
  working at once and its people sign in again. Nothing else holds it.
- *Someone's session must end.* They can sign out everywhere from their account
  page. For you to do it: hold their drive (`node tools/door.mjs hold <name>`),
  which the edge refuses within 30 seconds; a pass reaching the drive straight
  through its sprite URL lasts at most 12 hours, so for a drive that must close
  now, take `MARBLE_DOOR_*` out of its `sprite.env` and deploy.

## Other people's drives on the PC

The owner's PC runs drives for other people: the probe study's participants
first, and later anyone the door lets in. marble-host runs each one in a
sandbox of its own, behind one Cloudflare tunnel. The design is the drive page
*Research/Marble/Marble for Publication/Running the probe study from the PC*;
each part below says what it built.

### marble-host and the sandbox

Built 2026-10-25 and tried on the PC without root; not installed. Nothing on
the PC changes until the owner runs `install.sh` with sudo. Two parts are not
built, and both are the owner's to write. The updater puts releases in
`/opt/marble` and moves drives between them. The escape check tries the
sandbox's walls from inside. The end of this part says what each must do.

marble-host is the one service outside every guest's sandbox, and the only
thing that starts and stops their drives. It runs as the owner's user service
`marble-host.service`: `node bin/marble-drive.js host` from his current
release. Its code is in `server/host/`.

The router, on 127.0.0.1:4460, is all the tunnel `marble-pc-host` reaches. A
request without the Worker's key (`x-marble-host-key`) gets a 401. Otherwise
the router takes that header and `x-marble-drive` off and passes the request
to the drive's port. It adds `X-Forwarded-For`, so no drive takes the request
for a local one. The Worker's `X-Forwarded-Host` and `X-Forwarded-Proto` go on
as they came. Both directions stream, so live updates and uploads pass
through as they are written. A browser that leaves cuts the drive's request
too. A drive that isn't running gets a 503, which the Worker turns into its
resting page. `GET /_host/health` with the key answers 200 with `{ ok: true,
drives, running, release }` whenever marble-host answers at all.
`POST /_host/poke` makes it read the door's queue now.

The admin API, on 127.0.0.1:4461, is how the Console and `tools/pc-host.mjs`
see and change the drives. Every request carries
`Authorization: Bearer <HOST_ADMIN_TOKEN>`. Every guest shares the PC's
loopback, so the token is what keeps a guest out. It lives in `host.env`, in
the owner's home, which no guest can see.

The maker makes the drives the door queues for the PC
(`GET /_door/queue?home=pchost`). It looks at start, when poked, and every
five minutes. It reports `machine`, `install` and `check` to the door, then
`{ state: 'ready', home: 'pchost' }`. If the door didn't hear the ready
report, the maker tells it again at the next look.

The watcher reads each running drive's `/health` and its service's memory
every 30 s. Two missed answers in a row restart the drive. Memory past 90% of
the drive's `MemoryMax` is an alert to `HOST_NTFY_URL`, and so is the disk
under `/var/lib` past 90%. Each kind is sent at most once an hour per drive.
Everything that happens is a line in `~/.local/state/marble-host/events.jsonl`
(`node tools/pc-host.mjs events`). The drives' registry, `registry.json`, is
beside it, rewritten whole through a temporary file. marble-host will not
start on a registry it cannot read, rather than forget its drives.

Each drive is `marble-guest@<name>.service`, an instance of a system template.
It has a Linux user of its own (DynamicUser) and a folder of its own,
`/var/lib/private/marble-guests/<name>`, with the drive in `drive/` and its
home in `home/`. Its settings are `/etc/marble-guests/<name>.env`, mode 600.
marble-host writes that file, and systemd reads it before the walls close.
The folder of settings files is then hidden from every drive.

The walls are those of the plan's "A sandbox for each drive". Each drive gets
its own user and process namespace and a private `/tmp`. The system is
read-only. The owner's home, `/mnt`, and WSL's, Tailscale's and Docker's
sockets are hidden. IP rules close the home network, link-local addresses and
the tailnet, but let Tailscale's DNS through (100.100.100.100 and
fd7a:115c:a1e0::53). A drive slows at 1 GB, stops at 1.5 GB, and has at most
512 tasks. All the guests together are capped at 6 GB in
`marble-guests.slice`. Their CPU weight, half a slice's, is on `marble.slice`
above it, beside `user.slice`, where the owner's drive runs. A dash in a
slice's name is a level in the tree, and a weight counts only against
siblings.

No guest's unit is ever enabled. When marble-host starts, it starts every
drive the registry says is running whose unit is down. It marks a drive that
was cut off while being made as failed. A running drive whose settings file
has gone gets a new one. So after the PC restarts, the Windows task brings
WSL up, lingering brings up marble-host, and marble-host brings up the
drives. Stopping marble-host leaves the drives running. A drive that keeps
failing is started again however often, because marble-host may start a unit
but not reset one.

A new drive runs the release the registry names for everyone, which only the
updater will set. Until then it runs the newest folder in
`/opt/marble/releases`, by name, since a release's name starts with its UTC
time. `run-guest` runs node from
`/opt/marble/releases/$MARBLE_GUEST_RELEASE/marble-drive` as the drive's own
user. Its `HOME` is in the drive's folder, and Chromium comes from
`/opt/marble/ms-playwright`. bash stays the sandbox's first process and passes
a stop on to node: in that place, node left an agent's finished processes as
zombies.

Inside each drive, `/health` names its `release`. Its ledger and memory guard
read the drive's own cgroup when it has a numeric `memory.max`
(`server/cgroup.js`). The drive's memory then leaves out the file cache the
kernel can drop. In the trial, the first drive to read a release held 476 MB,
and 96 MB of that was its own. The guard acts with 10% of `MemoryMax` left. It
also acts when the drive's tasks wait on memory past 90% of `MemoryHigh`.

`GET /health/deep` (`server/health-deep.js`) answers only the owner, on this
machine. That is loopback with no forwarded header, and the drive's
passphrase as a bearer, which marble-host reads from the settings file.
Through the router it is a 404. Its answer, kept a minute, is `{ ok, release,
claude: { version, signedIn }, codex: { version, signedIn }, docs,
agentConnected }`. It asks each CLI about its login as the connect sheet does,
`claude auth status --json` and `codex login status`, under the drive's own
home with no key in the environment. `docs` counts the documents the person
made, not the pages the drive was seeded with. `agentConnected` is a login to
either CLI, or a key in the drive's own key file, which on a PC drive is what
`GET /agent/setup` calls `ready`.

`HOST_MODE=user` in `host.env` runs each drive as a transient unit of the
owner's own systemd, for a machine without the sudo step and for a trial. It
has every wall a user manager enforces, but the drive runs as the owner, and a
user manager ignores IP rules. The network walls exist only in `system` mode,
so `user` mode is never for other people's drives.

| Piece | Where |
|---|---|
| marble-host: router, admin API, maker, watcher, registry, boot | `server/host/`, run by `marble-drive host` |
| Its service | `linux/pc-host/host.sh` renders `marble-host.service.in` into `~/.config/systemd/user/`; log `~/.local/state/marble-drive/host.log` |
| Its tunnel | `linux/pc-host/tunnel.sh`: `marble-pc-host`, from `pc-host.marbledrive.app` to `http://127.0.0.1:4460` alone; user unit `marble-host-tunnel.service`, log `host-tunnel.log` |
| The sandbox | `linux/pc-host/marble-guest@.service`, `marble.slice`, `marble-guests.slice` |
| The polkit rule | `linux/pc-host/50-marble-host.rules`: the owner may start, stop, restart, try-restart and reload-or-restart `marble-guest@`, `marble-guest-backup@`, `marble-guest-export@` and `marble-guest-remove@` instances and `marble-guests-backup.service`, and nothing else |
| A drive's first process | `linux/pc-host/run-guest`, installed as `/opt/marble/bin/run-guest` |
| The sudo step | `linux/pc-host/install.sh`, which then runs every `install.d/*.sh` (`install.d/README`) |
| marble-host's settings | `~/.config/marble-drive/host.env`, mode 600, from `node tools/pc-host.mjs init` |
| From the terminal | `tools/pc-host.mjs` |
| Tests | `node --test test/host-*.test.js`, with stand-ins for systemctl and the drives |

`install.sh` installs the template and both slices into `/etc/systemd/system`,
the polkit rule with the owner's name in it, and `run-guest`. It makes
`/opt/marble`, with `bin`, `releases` and `ms-playwright` in it, the owner's
and mode 755. It makes `/etc/marble-guests`, the owner's and mode 700. Then it
reloads systemd and runs every `install.d/*.sh` in name order, as root, with
`OWNER`, `OWNER_HOME`, `OPT`, `ETC` and `RELEASE_DIR` set. `20-backup.sh` is
the backups' piece. `install.sh` copies no release, and it is safe to run
again. With `--uninstall` it stops every guest and runs the pieces with
`--uninstall` in reverse order. Then it takes away all of the above,
`/opt/marble` and `/etc/marble-guests` included, but never the drives'
folders.

The admin API's routes, all JSON. A refusal is `{ why }` with its status.

| Route | Does |
|---|---|
| `GET /drives` | every drive: `{ name, port, owner, channel, release, state, active, memoryBytes, health: { ok, working, release, at }, restarts, created, cohort }`, with `failed` or `removed` when they apply |
| `POST /drives` `{ name, owner, cohort? }` | make one now, as the door's queue does; 201 once its check passes |
| `POST /drives/<name>/restart` | restart it; a drive whose making failed is tried again |
| `POST /drives/<name>/suspend`, `/resume` | stop it and mark it so boot and the watcher leave it; start it again |
| `POST /drives/<name>/remove` `{ confirm: <name> }` | stop it, mark it removed and delete its settings file; its folder stays |
| `POST /drives/<name>/channel` `{ channel }` | `canary` or `everyone`, for the updater to act on |
| `GET /releases` | `{ channels: { canary, everyone }, paused, onDisk, newDrives: { release, from } }` |
| `POST /release`, `/promote`, `/rollback`, `/pause` | 501 `{ "why": "the updater isn't built yet" }` |
| `GET /events?limit=` | newest first: `{ at, drive, kind, detail }`, where kind is made, failed, started, restarted, unhealthy, suspended, resumed, removed, channel or alert |

Removing a drive deletes nothing of its person's. The backups' root helper,
`marble-guest-remove@<name>.service`, deletes the folder. It refuses until the
drive is stopped and its settings file is gone, which is what `remove` does
first. marble-host doesn't start the helper yet. The plan runs the drive's CLI
logouts before anything is deleted, and that comes with the Console's Remove.

The trial ran on 2026-10-25, in `user` mode, with marble-host from this branch
and its folders under `/var/tmp`. The release was a copy of the owner's
installed one with this branch's files laid over it. Chromium was copied from
`~/.cache/ms-playwright`. Two drives made through the admin API passed their
checks in about two seconds. Each answered through the router as itself with
the key, with a `302` to `https://marbledrive.app/enter?drive=<name>`.
Without the key the router said 401, and `/health/deep` through it was a 404.
With marble-host stopped, the drives kept running. With both drives stopped
too and marble-host started again, both answered within a second. Suspend,
resume and remove did what the table says. Nothing in the trial tried the
walls, and everything it made was removed.

To put it on the PC after this is merged, in Ubuntu as the owner (the paths
are in his current release):

1. Release the new code to his drive:
   `cd ~/Development/marble-drive && tools/home-release.sh`.
2. Write marble-host's settings:
   `cd ~/.local/share/marble-drive/app/current/marble-drive && node tools/pc-host.mjs init`.
   It says what it did with each setting, never a value, and
   `ls -l ~/.config/marble-drive/host.env` shows `-rw-------`. It copies the
   door's admin token from `door.env` and its keys from `door-keys`, and the
   alert topic from `ntfy-topic` when that is there.
3. Install the sandbox:
   `sudo bash ~/.local/share/marble-drive/app/current/marble-drive/linux/pc-host/install.sh`.
   It ends by printing the next two steps. Its backups piece needs the pinned
   rclone in `~/.local/bin` and the hub settings ("Backups of PC drives").
4. Run the escape check, once it is written (below). Go on only if every wall
   holds.
5. Start marble-host:
   `bash ~/.local/share/marble-drive/app/current/marble-drive/linux/pc-host/host.sh install`.
   It says `marble-host is up: router on 127.0.0.1:4460 (system mode)`.
6. Put a release in `/opt/marble/releases`, and the Chromium it needs in
   `/opt/marble/ms-playwright`. That is the updater's job (below). Until a
   release is there, no drive can be made.
7. Check it:
   `node ~/.local/share/marble-drive/app/current/marble-drive/tools/pc-host.mjs status`.
   It says marble-host is up, which release new drives get, and how many
   drives run.
8. Start the tunnel:
   `bash ~/.local/share/marble-drive/app/current/marble-drive/linux/pc-host/tunnel.sh setup && bash ~/.local/share/marble-drive/app/current/marble-drive/linux/pc-host/tunnel.sh install`.
   Then, from anywhere,
   `curl -s -o /dev/null -w '%{http_code}\n' https://pc-host.marbledrive.app/_host/health`
   prints `401`. The Worker's side is in [ACCOUNTS.md](ACCOUNTS.md), "A drive
   on the PC host".

The updater is the owner's to write. It copies a release, with its Chromium,
into `/opt/marble`, and moves drives from one release to another. It is also
what `tools/home-release.sh` hands a new release to. Until it exists,
`/release`, `/promote`, `/rollback` and `/pause` answer 501, and
`tools/pc-host.mjs release|promote|rollback|pause` say "the updater isn't
built yet" and exit 1. Every drive stays on the release it was made on.

What the updater must do is the plan's "Shipping a fix to everyone". Canary
drives move first and everyone after. Each drive moves only when its
`/health` says `working` is 0, so no turn is cut off. A moved drive is checked
within 60 s: `/health` names the new release, `GET /` answers below 500, and
`/health/deep` shows both CLIs' versions. That is the check `checkDrive` in
`server/host/check.js` makes. A drive that fails goes back to its last release
by itself, and the owner is told. Promoting moves several drives at once.
Rolling back is one action for everyone. The last three releases stay on
disk, and Pause stops all of it. The registry already has a place for each of
these: `channels`, `paused`, and each drive's `channel`, `release` and
`previous`. The watcher leaves alone any drive its `busy` says is being moved.

The escape check is the owner's to write too. It is a throwaway drive started
from the installed template. It tries every wall from inside, and prints
`PASS <check>` or `FAIL <check>: <why>` for each. No drive may be called
`escape-check`, so the name is free for it; `run-guest` has no command for it
yet. It must show each row of the plan's table in "A sandbox for each drive",
in `system` mode, and run again after any change to the template:

| What a drive can reach | Must be |
|---|---|
| Its own folder and home | yes, read and write |
| The owner's drive, settings and keys | no: his home looks empty |
| His Claude and ChatGPT logins | no: both CLIs say not logged in |
| His processes | no, with its own process namespace |
| The Windows C: drive | no, with `/mnt` closed off |
| Windows programs | no, with `/mnt` and WSL's sockets hidden |
| His Mac, iPad and iPhone on Tailscale, and his home network | no, through systemd's IP rules, which only a system service has |
| Anthropic, OpenAI and the internet | yes |
| Other drives on the PC | only through their own sign-in |
| Memory and processes | capped per drive, and for all of them together |

### The front door for PC drives

Built 2026-10-25, not switched on: `PC_HOST_KEY` is not set and
`NEW_DRIVE_HOME` is commented out in `worker/wrangler.toml`. Until both are,
the Worker routes and makes drives exactly as before. Turning it on is in
[ACCOUNTS.md](ACCOUNTS.md), "A drive on the PC host".

A drive on the PC host has no tunnel, DNS record or Worker route of its own.
The Directory records it with `home: 'pchost'`. Once the edge has checked its
owner's pass, the router (`worker/src/router.js`) sends the request to
`PC_HOST_URL`, `https://pc-host.marbledrive.app`, which is the tunnel
`marble-pc-host`. The path and query go with it, joined and never resolved.
Two headers say whose it is: `x-marble-drive: ana` and
`x-marble-host-key: <PC_HOST_KEY>`. The Worker drops whatever the browser sent
under those names from every request it forwards, and never sends the Sprites
token there. It sets `X-Forwarded-Host`
and `X-Forwarded-Proto: https` as for any home, and marble-host's router passes
both on: the drive's origin check and its `__Host-` cookie (below) read them.
If the wildcard route catches a request for `pc-host.marbledrive.app` itself,
it goes on to the tunnel as it came, with no key added, and the router answers
it 401.

Sign-up makes new drives where `NEW_DRIVE_HOME` says: `pchost`, or `fly`,
which is also what unset means. With `pchost`, and `PC_HOST_URL` and
`PC_HOST_KEY` set, naming a drive records `{ home: 'pchost', homes: { pchost:
true }, sprite: null, credit: 0 }` and takes no spare. The Worker then pokes
`PC_HOST_URL/_host/poke` with the host key and nothing else. Without the
address or the key, the name page says drives can't be made yet and makes
nothing. A drive on the PC host gets no starter credit, whatever its invite
says. Anthropic's terms for hosted Claude Code say a customer "may not pay for,
resell, or intermediate Claude usage on their end users' behalf", so its
person's agent runs on their own Claude or ChatGPT.

marble-host makes the drive the way the door sprite does. It reads the door's
queue, `GET /_door/queue`, where each entry says its `home` (`?home=pchost`
keeps to the PC's). It reports `machine`, `install` and `check`, then `{ state:
'ready', home: 'pchost' }`, which needs no sprite URL. The door sprite's
provisioner takes only drives whose home is `fly`, so a PC drive is never made
on Fly. `node tools/door.mjs drives` shows "the PC host" where a Fly drive
names its sprite.

When the PC can't be reached, the person whose drive it is reads "Your drive
is resting. Bryan has been told, and your work is safe." The page is a 503
with `Retry-After: 30`, and JSON for a script. It is given when the request
gets no answer, when the tunnel answers 530 (no connector), or when the router
answers 502, 503 or 504. The router says 503 for a drive that isn't running.
A 503 in JSON is the drive's own answer to a script (its apps give one when
they have no key), and goes back as it is. A drive at home on the owner's own
machine still gets the page with the owner's commands on it.

The Worker checks the PC itself every five minutes, so the owner hears before
the people do. The cron is `[triggers]` in `worker/wrangler.toml`, and the
`scheduled` handler in `worker/src/index.js` runs `checkPcHost` from
`worker/src/pc-host.js`. It asks `GET PC_HOST_URL/_host/health` with the key
and waits 10 s. No answer, a status other than 200, or a body without `ok:
true` is a failure. It is posted as one line of plain text to
`ALERT_NTFY_URL`: once when it starts, at most once an hour while it lasts, and
once more when the PC answers again. Without `ALERT_NTFY_URL` nothing is
posted, and without `PC_HOST_URL` and `PC_HOST_KEY` nothing is asked. What
was said, and when, is kept in the Directory under `meta:pchost-watch`, so
every run agrees, and an alert that couldn't be sent is tried again at the
next look. `npx wrangler@latest tail` shows each failed look as a
`pc-host watch:` line.

Every drive now has two of the guards that many people's pages under one
domain need. Until `marbledrive.app` is on the Public Suffix List, every drive
under it is same-site with every other. So SameSite=Lax still sends ana's
cookie when a page on `bob.marbledrive.app` posts to ana's drive. A drive now
refuses any request but GET, HEAD and OPTIONS unless its `Origin` names the
drive (its `X-Forwarded-Host`, else `Host`) or, with no `Origin`, it says
`Sec-Fetch-Site: same-origin`. That is `fromOwnPage` in `server/sessions.js`,
asked in front of every route in `server/app.js`. A bearer, and a request with
neither header (curl, scripts, the backup job), go on as before, and so do
Claude's and ChatGPT's connector routes, which judge their own tokens. The
second guard is the passphrase cookie: over https it is `__Host-marble_drive`,
which no other drive can plant, and only that name counts there. Plain http
(127.0.0.1, the agent's browser, the Mac at home) keeps `marble_drive`.
Someone who signed in with the passphrase over https signs in once more. The
third guard, the Public Suffix List entry, is the owner's to submit.

### People sign in to their own Claude or ChatGPT

Built 2026-10-25. A person on a PC drive connects their own Claude or ChatGPT
in the browser. Each CLI signs itself in on its company's own page: `claude
auth login --claudeai` or `codex login --device-auth`, run inside the drive's
sandbox with its own HOME. The login stays in that home
(`~/.claude`, `~/.codex/auth.json`). Marble starts the command, types the
one-time code the person pastes into Claude's prompt, and never reads, copies
or keeps the login. An API key for either is still offered, because
Anthropic's terms for hosting Claude Code say a host may not remove a sign-in
method. The sheet, its routes and what the commands print are in
[AGENTS.md](AGENTS.md), "Connect an agent".

A new drive opens on Start here with the connect sheet over it. The sheet's
line names the host from `MARBLE_HOST_OWNER`: "You sign in on their page, so
Bryan never sees your password." Start here's first row is "Connect Claude or
ChatGPT". It ticks itself once an agent works, and until then Make it waits
and says why under it.

A drive with `MARBLE_GUEST=1` differs from the owner's in four ways:

- The usage meter never opens the login file to ask Anthropic, as the owner's
  drive does, so it shows nothing for Claude. Claude Code 2.1.281 answers
  `claude -p /usage` with a breakdown of what used the plan, not its limits;
  once a version prints the limits, `MARBLE_DRIVE_CLI_USAGE=1` has the meter
  read them from there (`collectUsageFromCli`). Codex has no meter.
- Every key an agent gets comes from the drive's own key file. The agents'
  environment drops any key or starter-credit setting the host's environment
  holds, and without `MARBLE_DRIVE_AGENT_KEYS` the file is
  `$HOME/.config/marble-drive/agent-keys`, never one beside the shared release.
- There is no starter credit, since the person's own account has to pay.
- Settings offers Disconnect for any login, because the CLI's logout touches
  only that person's home. On the owner's drive it is offered only for a login
  the drive made from the sheet.

The small jobs beside a turn run on whichever CLI the person connected
(`server/agent/side-model.js`), so they spend a little of the person's plan.
They are chat titles, progress drawings, callout suggestions, build picks and
replies, a look read as one rule, and fan_out's workers. Before, every one but
titles called `claude` and failed quietly on a drive with only ChatGPT.

marble-host's `/health/deep` should ask the same two commands the drive asks,
with the guest's HOME and no key in the environment. `claude auth status
--json` means signed in when it exits 0 with `loggedIn: true`. `codex login
status` means signed in when it exits 0 with "Logged in using ChatGPT", which
it prints on stderr. Neither needs a login file opened. Leaving runs `claude
auth logout` and `codex logout`, as `POST /agent/claude/sign-out` and `POST
/agent/codex/sign-out` do.

No real account has signed in through it yet. To try it on a test guest:

1. Connect Claude from the sheet and send a chat.
2. Check that Agents › Usage shows the plan's limits, then press Disconnect.
3. Do the same with ChatGPT.

### Backups of PC drives

Built 2026-10-25. Each hour, every PC drive that changed since its last backup
is copied to R2, encrypted, under `guests/<name>/` in the hub's bucket. A
root-owned service does it: marble-host can start it but not change it, and
neither marble-host nor any drive can read its key. It switches on with the
sandbox's `sudo bash linux/pc-host/install.sh`, which runs
`linux/pc-host/install.d/20-backup.sh`.

Only the drive is backed up: `/var/lib/private/marble-guests/<name>/drive`,
with its documents, history, trash, pictures and chat logs. Its home never is.
That is where the person's Claude or ChatGPT login lives, and the host keeps no
credentials. A drive restored over its old one keeps its home, so its person
stays signed in; a drive restored into a new folder signs in again. As the hub
does, a backup leaves out the host lock (`.marble/agents/host.lock`), the
usage ledger (`.marble/usage/`) and Console's backup reports
(`.marble/console/backups/`). It also leaves out the thumbnail maker's scratch
folders (`.marble/thumbs/.work-*`). Links, pipes and sockets in a drive are
never followed or sent.

`marble-guests-backup.timer` starts `marble-guests-backup.service` each hour.
It may be up to five minutes late, so the PC doesn't wake everything at once,
and an hour the PC missed runs when it comes back. The service starts
`marble-guest-backup@<name>.service` for each folder in
`/var/lib/private/marble-guests` that holds a drive, one at a time. Each runs
`backup-guest <name>` in a sandbox that sees that drive's folder, read-only. It
sees nothing of the other drives, the owner's home, `/etc/marble-guests` or
`/etc/marble-backup`. A drive that hasn't changed costs a look at its files and
no request to R2. A drive that changed sends only the files that differ, and
whatever it replaces or deletes goes to `trash/<utc>/`. As in
`server/hub/sync.js`, each run compares the drive with the file list in R2
(`[size, mtimeMs]` by path). It trusts that list only when its `seq` is the one
this PC wrote last; otherwise the run is a full sync.

The drive is read by `backup-tree`, which opens every folder from its parent
without following a link, and rclone reads only root's copies of what it
found. An agent that swaps a folder for a link to `/etc/marble-backup` mid-run
gets its own files read, or none.

R2 holds each drive as an rclone `crypt` remote over `guests/<name>/`, with a
passphrase and salt of the backups' own, never the hub's. Every name and every
byte under the prefix is ciphertext:

| Under `guests/<name>/` | What |
|---|---|
| `drive/` | the drive as the last good run sent it |
| `trash/<utc>/` | what the run at `<utc>` replaced or deleted |
| `manifest.json` | the last run's file list |
| `manifests/<utc>.json` | every run's file list, so a restore can go back to any of them |

Trash is kept until someone removes it. To expire it, add an R2 lifecycle rule
for each drive, on the prefix that
`sudo /usr/local/lib/marble-guests/backup-guest <name> --trash-prefix` prints.
A restore `--from` a time before the rule's age then can't bring back the
versions the rule removed, and says the copy does not match.

Each run ends by writing `/var/lib/marble-backup/status/<name>.json`. Anyone on
the PC may read it, marble-host and the Console included:

```json
{"name":"ana","at":"2026-10-25T17:00:03Z","ok":true,"files":214,"bytes":5813302,"changed":false,"lastGood":"2026-10-25T17:00:03Z"}
```

`changed` says whether that run sent anything. `lastGood` is when a run of
that drive last ended well. A failed run has `ok: false` and says why in `why`,
for example "R2 could not be reached". The file holds counts and times only,
never a file name or a key. What rclone said goes to the journal:
`journalctl -u marble-guest-backup@ana`. A run also refuses when the drive has
lost all its documents or more than half its files since the last good backup,
or holds more than 10 GB (`GUEST_BACKUP_MAX_BYTES`). It then sends nothing, and
the last good backup stays as it was. If the loss was meant,
`sudo /usr/local/lib/marble-guests/backup-guest ana --force` sends it. To back
a drive up now, run `systemctl start marble-guest-backup@ana.service`, as
marble-host may.

The tools are root-owned copies in `/usr/local/lib/marble-guests`:
`backup-guest`, `backup-guests`, `restore-guest`, `remove-guest`,
`backup-check.sh`, `backup-tree`, `backup-lib.sh` and a copy of the pinned
rclone. They aren't in `/opt/marble/bin`, because `/opt/marble` is the owner's.
His user, and marble-host with it, could rename a file there and put another
in its place for root to run. The units are in `/etc/systemd/system`.

To restore one drive:

1. `sudo /usr/local/lib/marble-guests/restore-guest ana --list` prints the times
   there are backups of.
2. `sudo /usr/local/lib/marble-guests/restore-guest ana` puts back the latest.
   With `--from 20261025T170000Z`, it puts back the drive as the last backup at
   or before that time saw it.
3. Once the restored drive is right, delete the drive it replaced,
   `/var/lib/private/marble-guests/ana/drive.kept-<utc>`.

`restore-guest` downloads first, into `/var/lib/marble-backup/restoring/`, and
checks every file against the backup's file list. A download that fails or
doesn't match changes nothing (`--force` swaps it in anyway). Then it masks and
stops `marble-guest@ana`, so marble-host's watcher can't start it halfway. It
sets the drive aside as `drive.kept-<utc>`, moves the restored one in, unmasks
the unit and starts it again if it was running. marble-host may see the drive
down for that minute. To keep it quiet, run `node tools/pc-host.mjs suspend ana`
first and `node tools/pc-host.mjs resume ana` after. `--from` works because
each run moved what it replaced into its own trash. A file's version at that
time is the first one in a later trash, or else the one in `drive/`.
`--as <other>` restores ana's backup into another drive's folder and leaves
ana's as it is.

The restored files are root's until the drive starts, and then systemd hands
them to the drive's user. Since systemd 257, on a disk that allows ID-mapped
mounts (ext4 under WSL2 does), a DynamicUser state folder is owned by `nobody`
on disk and ID-mapped into the service. systemd decides whether to change
owners from the folder's top alone, and walks nothing below a top it already
finds right. So `restore-guest` gives `/var/lib/private/marble-guests/ana` to
root, and the next start chowns the whole tree. This is systemd 259's
`setup_exec_directory()` and `path_chown_recursive()`, as `systemd.exec(5)`
describes ("As an optimization…"). `backup-check.sh` checks that a restored
folder is root's.

The backups are tried once before the study, as the plan asks.
`sudo /usr/local/lib/marble-guests/backup-check.sh` makes a scratch drive,
`backup-check--<hex>`. It holds documents with odd names, a folder only its own
user may read, links, a pipe, the files a backup leaves out, and a login in its
home. The check backs it up through the real unit to R2 and runs it again
unchanged. It sends a change, restores both backups `--as` scratch names, and
compares every file by checksum. It prints `PASS <check>` or
`FAIL <check>: <why>` for each check, as `escape-check.sh` does. Then it deletes
the scratch folders, their status and their copies in R2. With a name,
`backup-check.sh ana` backs up and restores that drive and deletes only the
copy; run it on the test drive before the study. Files the drive changed after
its backup are counted, not compared.

A drive marble-host removes is deleted from the PC by
`marble-guest-remove@<name>.service`, which marble-host starts. It runs
`remove-guest`, which refuses unless `marble-guest@<name>` is stopped and
`/etc/marble-guests/<name>.env` is gone. Then it deletes the drive's folder
(the drive, its home and any `drive.kept-*`), systemd's link to it and its
backup status. The backup in R2 stays. Deleting it is the owner's call:
`sudo /usr/local/lib/marble-guests/backup-guest <name> --forget --yes`. That is
refused while the drive's folder is still on the PC.

The key is `/etc/marble-backup/backup.env`: root's, mode 600, in a folder of
mode 700. It holds the hub's four R2 settings (`R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`, from
`~/.config/marble-drive/hub-bryan.env`) and the backups' own
`GUEST_BACKUP_PASSPHRASE` and `GUEST_BACKUP_SALT`. `install.d/20-backup.sh`
draws those two at random the first time, and never writes the file again.
**Without `GUEST_BACKUP_PASSPHRASE` and `GUEST_BACKUP_SALT` the backups can
never be read.** The owner keeps both in his password manager; to read them,
`sudo cat /etc/marble-backup/backup.env`. Uninstalling keeps the file. The
backup unit gets it through `LoadCredential=`, never through its environment.

The install needs the pinned rclone in `~/.local/bin`, which
`tools/pc-setup.sh` puts there, and the hub settings file. Its copy of rclone
is checked against `tools/sprite/rclone-version`.
`node --test test/host-backup.test.js` runs all of it without root or R2. The
paths move under a temporary folder, rclone's local backend stands in for R2
under the same crypt remote, and a stand-in systemctl records what it is
asked.

### The study at the door

Built 2026-10-25, and off until the owner sets it up: `CONSENT_FORM` in
`worker/src/door/pages.js` is a placeholder and `CONSENT_VERSION` is
commented out in `worker/wrangler.toml`. Until both are set, a study invite's
consent screen says the study isn't ready and no study drive is made. Setting
it up, the admin routes and the shape of a people row are in
[ACCOUNTS.md](ACCOUNTS.md), "The study".

The study is a cohort, and it starts at the door. An invite made with
`study: true` (`node tools/door.mjs invite --study`, or the Console's Invite
someone) carries `cohort: 'study'`. After its person signs in, `/consent`
comes before `/name`. The name page sends them back until they answer. The
Directory also refuses to make a drive for a study invite with no answer on
file, so no request goes round the screen. A yes makes the PC drive's record
carry `cohort: 'study'`; a no makes the drive with none. The answer stays on
the account as `{ version, at, choice }`.

marble-host learns who is in the study from `GET /_door/people`, which it
reads every five minutes. A row is in the study when its cohort is `study`,
its consent was given and it hasn't withdrawn. For such a drive marble-host
writes `MARBLE_STUDY=1` and `MARBLE_CONSENT=<version>@<at>` into the drive's
env file, and it takes both out once the person leaves. The version goes
into that file as it is, because the door accepts only letters, digits,
dots, hyphens and underscores for it. marble-host reports back through
`POST /_door/events`: `agent-connected` and `first-document` the first time
`/health/deep` shows them, `drive-updated` after a move, and
`drive-restarted`. Those lines and the door's own sign-in lines make each
row's sign-up timeline. The Console's People view reads the same list and
calls the same routes. marble-host's side and the Console's are built in
their own PRs.

A drive ends in one of two ways, and both finish the same way. The owner
removes it (`POST /_door/drives/<name>/remove` with its name typed, or
`door.mjs remove`), which makes it `removing` and ends every session of the
person whose drive it is. Or that person deletes it from the account page,
which makes it `deleting`. marble-host then signs the drive's CLIs out,
deletes the drive from the PC and reports `{ state: 'removed' }` through
`step`. The record stays, so the name is never given out again. The drive's
encrypted backup in R2 stays too, as "Backups of PC drives" says. When the
person asked for their drive to be deleted, forget its backup once it is
removed; the delete page tells them the backup is kept until then. Nothing
else moves an ending drive: `step`, `hold` and `unspare` refuse it with a
409, so a maker that was half way through making it stops there.

The edge answers all three states itself, with a 410: "This drive has been
removed" or "This drive is being deleted", as a page or as JSON for a
script. It never forwards such a request, whatever pass it carries and
whatever `DRIVES` says. Only the sign-out walk (`/_marble/leave`) goes
through, to clear the pass. An isolate keeps a drive's record for up to 30
seconds, so a drive can still be reached for that long after it is removed,
as after a hold.

Revoking an account (`POST /_door/accounts/<id>/revoke`, or
`door.mjs revoke`) ends its sessions at the door at once. The edge checks a
pass's session only once the pass is an hour old, so a drive its person
already has open keeps working for up to an hour. To stop a drive now, hold
it or remove it.

## The console

**Console** is a document in the owner's drive (`/a/Console`): every drive and
everything done to them, from one page. It is on only where the drive's
settings say `MARBLE_DRIVE_CONSOLE=1` and the drive has a passphrase: admin-p2's
`sprite.env`, and, since the drive's home moved to the Mac, the Mac's
`~/.config/marble-drive/mac-bryan.env` too (with `MARBLE_DRIVE_CONSOLE_SRC`
pointing at the Mac's checkouts and `MARBLE_DRIVE_CONSOLE_SPRITE` at the
`sprite` CLI, since launchd's PATH has neither). Its
code is the host's (`server/console/`, `runtime/console.js`, `console.css`),
so it ships with every deploy; the document is only where it lives.

| View | What it does |
|---|---|
| **Dashboard** (opens on it) | every drive's state over time (running, warm, cold), cost by drive, why each was awake, spend this month and its projection (and a budget, if set), spend per day, when drives are awake (hour × weekday), memory, CPU, agent turns and documents opened; 24 h, 7 days, 30 days or this month; any chart as a table; **Paste a bill** takes Fly's Cost Explorer page and calibrates every estimate to it |
| **Drives** | every drive, awake or asleep and since when, without waking any; a drive's release, health, Claude (login or key, sign in or out), access (public or private, the passphrase: show, copy, new), settings (`sprite.env`, applied with a restart), checkpoints (make, restore by typing the name), and removing a tester; **New drive** provisions one |
| **Backups** | the Mac's backup of this drive, as the Mac last reported it: when it last backed up and why, whether changes are waiting and when they will be copied, when the Mac last checked in; warnings when it stops checking in, a backup fails or changes are overdue (they mark the tab); **Schedule** on/off and **Back up now**; **On the Mac**: the one copy (`~/Marble Drive`), its documents, size and matching Fly checkpoint, with **Restore…** onto this or another drive; **History on Fly**: the drive's checkpoints, each with **Restore…** (the Mac does it); names typed to confirm; the terminal command for when this drive is down. Buttons leave requests the Mac picks up within a minute (see "Back a drive up here") |
| **Ship** | main's recent commits and which drives have them; each drive against main; **Ship** shows the plan (`sprite-deploy.sh --print-plan`) before deploying main to every user and then admin-p2; **Try the workshop on t-bryan** |
| **Workshop** | a card per checkout that says where it stands in a sentence and offers the one next step (`next` in `server/console/workshop.js`): get GitHub's latest, publish, finish a publish, or sign in to npm; each button says what it does before it is pressed, and a running job shows its steps, npm's approval link as a button, and on failure what went wrong and the button that fixes it. **Publish** marble checks first and changes nothing if this copy has loose edits, cannot fast-forward to GitHub, or is not signed in to npm; then the next patch in package.json and both plugin manifests, committed, an annotated tag, pushed, then `npm publish` (marble's guard and unit tests). A version made but never uploaded is uploaded as it is (**Finish publishing**), never bumped again. **Sign in to npm** runs `npm login --auth-type=web` and shows its link; admin-p2 needs it once. marble-drive needs no change: it depends on `file:../marble`, and a deploy installs the version that checkout declares. Also a workshop chat in the Marble Drive or Marble project |
| **Features** | every change the owner is making, as a line: Spec → Plan → Build → Commit → Push, then the drives in rings (Yours: the Mac and admin-p2; t-bryan; everyone). **Lines**, **Drives** (each place and what has not reached it) and **Chats** (each chat once, with the features it moved). The board is the `triage` skill's (`agent-plugin/skills/triage`), saved to `.marble/console/features.json` only when the owner asks: **Run triage** starts a chat that runs it, or the owner asks in any chat, and the agent answers with `/a/Console?view=features&feature=<id>`. Where each feature is, is the server's, from git and the releases (`server/console/features.js`); a release the Console has not seen comes from the deploys' own `done: … is live on …` lines. Name, next step, stage and hidden are the owner's corrections, kept beside the board through every triage. Spec: the drive page `Notes and Sketches/Features view` |
| **Activity** | every job the console ran, its output streamed and kept |

How it knows things: the Sprites API for the list, awake or asleep
(`status` is `running` while awake, `warm` while paused, `cold` when stopped)
and links, none of which wakes a drive; checkpoints too, except that asking
about a **cold** drive's checkpoints starts it, so the console never does that
on its own (a cold drive's checkpoints are read only on request). What a drive
runs is known from a look, from a deploy the console finished, or from its last
"before deploy" checkpoint (shown as "or later": a deploy made without a
checkpoint does not show there); **Look now** runs a read-only probe on
a drive (`server/console/probe.mjs`) for its release, versions, settings,
Claude, documents and log, and does wake it. Drives already awake are looked at
by themselves, every five minutes while a console tab is open. The console
polls nothing when no console tab is open.

How the dashboard knows the past: every drive writes its own ledger while it
is awake, which is exactly while Fly bills it, so nothing has to watch it. The
console reads new ledger lines from each drive that is **running**, every
minute while a console tab is open (`server/console/ledger-read.mjs`), reads
admin-p2's own from disk, and records each change of status the Sprites API
shows, with the wake and pause times the API keeps. Kept on admin-p2 in
`/drive/.marble/console/usage/<sprite>/`. A drive asleep while the console
watched catches up the next time both are awake; a drive not yet deployed with
the ledger shows only what the console saw, costed as typical minutes and said
so.

How it acts: every action is a job running the same tools as this page
describes (`sprite-deploy.sh`, `sprite-provision.sh`, `release.sh`, the Sprites
CLI, git, npm), one job at a time per drive, output kept in
`/drive/.marble/console/jobs/`. A deploy of main runs the deploy script from a
checkout of that commit (`/home/sprite/src/marble-drive-ship`). A drive whose
checkpoint store is stuck is retried without a checkpoint and remembered
(**Try them again** clears it). Settings are rewritten from a fresh read of
`sprite.env` and applied with `release.sh apply` (admin-p2: `apply-when-idle`).
No passphrase or key reaches a log or a cache file; a passphrase reaches the
page only on **Show** or **Copy**. A new drive's roster entry is written on
admin-p2 (`~/.config/marble-drive/testers.json`), the machine that made it.

## Publishing a folder with git

A folder in the drive can be a git repository of its own: a website, say, whose
documents are edited here and deployed by a push. Where the drive's settings say
`MARBLE_DRIVE_GIT=1` and the drive has a passphrase, such a folder shows GitHub's
mark (on its row in the tree when hovered, after its name on the Drive page),
and inside it **Publish** sits beside Share in the bar and in the Drive page's
toolbar; the folder's menu in the tree has it too. Each opens one popover: the
branch and its GitHub page, whether everything is published (checked against
GitHub when it opens), the changed files, an optional message, and Publish. The
open page's edits are saved, everything changed in the folder is committed with
the message or as `Publish from Marble Drive: <names>`, and the branch is pushed
to its upstream (`server/git.js`); the popover then links the commit. The
repository's own hooks run.

- Only a folder with its own `.git` counts. Nothing walks up to a repository the
  folder sits inside, and the drive root is never one.
- Never forced. A remote with commits the folder lacks is refused with "pull them
  first", and the commit stays in the folder.
- A branch with no upstream is refused; push it once with `git push -u`.
- The push uses whatever credentials git finds as the user the host runs as: on
  the Mac, the login keychain or an SSH agent. `GIT_TERMINAL_PROMPT=0`, so a
  missing credential fails rather than waits.
- It is the one git change Marble makes on purpose
  (`test/drive-git-boundary.test.js` is about everything else). It is on for
  `bryan`'s Mac home (`mac-bryan.env`) and nowhere else.

## Tools

| Command | Does |
|---|---|
| `tools/sprite-deploy.sh <sprite>` | a pushed `origin/main` (GitHub) + `@bdhmin/marble` (npm) + pinned Claude; checkpoint, stage, smoke-test on a throwaway drive, switch, go back if it does not come up |
| `… --local` | this machine's working copies instead (unpushed code, unpublished `marble`) |
| `… --ref <commit>` / `--marble <v>` / `--claude <v>` | pick versions |
| `… --rollback` | back to the release before (from itself: when idle) |
| `… --no-checkpoint` | skip the restore point, only when Sprites cannot make one |
| `… --print-plan` | say what would be deployed, and stop |
| `… --when-idle` | stage now, switch when no agent is working (always so from the sprite itself); for a drive in use |
| `tools/sprite-deploy.sh --all [--list]` | every sprite labelled `marble-tester` or `marble-user`; continues past a failure; `--list` only names them |
| `tools/drive-backup.sh [<sprite>] [--to <dir>] [--link <path>]` | a Fly checkpoint, then the one copy of a drive (default admin-p2) in `~/Marble Backups/<utc>/`, linked from `~/Marble Drive`; unchanged files hard-linked to the copy before, so a run moves only what changed. Then the workshop (`/home/sprite/src`, with `.git`, without `node_modules`) into `~/Marble Backups/workshop/<utc>/`, linked from `~/Marble Workshop`, with `workshop.json` naming the checkouts whose work is nowhere else (`--no-workshop` to skip) |
| `tools/workshop-restore.sh <sprite> [<checkout>...] [--yes]` | puts the workshop's checkouts back on a sprite from `~/Marble Workshop`, setting aside any already there; says what it would do without `--yes` |
| `macos/launchd/backup.sh install [<sprite>]` | runs `tools/backup-agent.mjs` every minute and at login; `status`, `run`, `logs`, `uninstall` |
| `tools/backup-agent.mjs [<sprite>]` | the Mac's half of the Console's Backups view: backs up after changes (10 quiet minutes, hourly at most), takes the Console's requests and reports back, touching the sprite only while it is awake |
| `node tools/browser-tests.mjs [<files>]` | browser tests: on the owner's Mac when it is watching this sprite, else here one file at a time |
| `macos/launchd/test-runner.sh install [<sprite>]` | keeps `tools/test-runner.mjs` running: the Mac's half of the above (default admin-p2); `status`, `uninstall`, `logs` |
| `node tools/drive-home.mjs to <here\|fly> [--drive <name>] [--now]` | moves a drive's home between this machine (the Mac or the PC) and Fly (see "How a move goes"); `lease-to <side>` moves only the lease; `rescue-to <side> --from <dead>` takes the drive from a home that is gone |
| `node tools/drive-sync.mjs up\|down\|counts\|state\|trash-prefix` | the hub by hand and what `drive-home` runs on each machine; settings from `MARBLE_HUB_ENV` |
| `tools/home-release.sh [--ref <commit>]` (`mac-release.sh` on the Mac is the same) | a release of this repo on the Mac or the PC, made current, and every home service restarted onto it |
| `tools/pc-setup.sh [<name>]` | in the PC's Ubuntu: what a home needs (node 22, rclone, cloudflared, sprite CLI, Chromium's libraries, systemd, lingering), a release, the home service; lists the sign-ins left |
| `tools/home-secrets.sh pack [<name>]` / `unpack <file> [<name>]` | carries a drive's settings from the Mac to the PC in one encrypted file |
| `linux/systemd/home.sh`, `linux/systemd/tunnel.sh` | the PC's `home.sh` and `tunnel.sh`, under systemd `--user` |
| `windows/wsl-home.ps1 [-Distro Ubuntu] [-NoSleep] [-Remove]` | in Windows: keeps WSL running from each sign-in; `-NoSleep` keeps the PC awake while plugged in |
| `macos/launchd/home.sh install\|start\|stop\|restart\|status\|logs\|uninstall [<name>]` | a drive's host on the Mac under launchd, `com.marble.drive.home.<name>` (default `bryan`) |
| `macos/launchd/tunnel.sh setup <name> <hostname>`; `check\|install\|start\|stop\|restart\|status\|logs\|uninstall <name>` | a drive's Cloudflare tunnel on the Mac for the front door, `com.marble.drive.tunnel.<name>`; refuses to run for a drive with no passphrase, or one whose host answers without it |
| `node tools/home-mode.mjs` | prints `serve` or `standby`; what `serve.sh` asks before every start |
| `tools/drive-restore.sh <snapshot> <sprite> [--yes]` | puts a snapshot back on a sprite: stops the host, sets `/drive` aside, copies in, starts it, checks `/health` |
| `tools/drive-pull.sh [<sprite>] [--into <dir>]` | a one-way mirror of a drive (default admin-p2) into this checkout's `drive/`, the last one set aside |
| `tools/drive-pull.sh --hub [<drive>] [--into <dir>]` | the same mirror from the hub, wherever the drive is at home; wakes nothing, writes nothing to the hub |
| `tools/sprite-provision.sh <person> [--agent api\|subscription] [--key-file f] [--local]` | makes `t-<person>`: passphrase, `sprite.env`, optional preloaded key, deploy, public URL, outside check, roster entry, a note to send |
| `tools/sprite-provision.sh --resume <person>` | finish one that stopped part way |
| `tools/sprite-provision.sh --remove <person>` | destroy after typing the name; drops the roster entry |
| `tools/sprite-workshop.sh <sprite> [--github f] [--npm f] [--sprites f]` | the workshop: checkouts, projects, identity, optional token files |
| `node tools/sprite/check-tester.mjs t-<person> [save-key]` | sign in with the roster passphrase and check gate, agent, views, materials |
| `node tools/sprite/smoke.mjs [base]` | Drive, drawn PDF picture, 100 MB upload with a cut chunk, through `sprite proxy` |

## Runbooks

**Move the owner's drive from the Mac to the PC.** Once; each step can be
run again.

1. **Windows** (PowerShell as administrator): `wsl --install -d Ubuntu`,
   reboot, open Ubuntu and make your user.
2. **Ubuntu:** `sudo apt update && sudo apt install -y gh && gh auth login`
   (a new Ubuntu has no package list until `apt update`), then
   `mkdir -p ~/Development/3rd-year-projects && cd $_ && gh repo clone
   marble-app/marble-drive && gh repo clone bdhmin/marble`.
3. **Ubuntu:** `cd marble-drive && tools/pc-setup.sh`. The first run turns
   on systemd and asks for `wsl --shutdown`; run it again after. It ends with
   a list of what is left:
   - **Settings.** On the Mac, in Terminal: `tools/home-secrets.sh pack`.
     Carry `~/Desktop/marble-bryan-settings.enc` to the PC (it is
     encrypted), then in Ubuntu: `tools/home-secrets.sh unpack
     /mnt/c/Users/<you>/Downloads/marble-bryan-settings.enc`. Delete the file.
   - **Sign-ins:** Claude (`~/.local/share/marble-drive/app/current/marble-drive/node_modules/.bin/claude`,
     `/login`), Codex too if the drive's agents use it, `sprite org auth`,
     `cloudflared tunnel login` (pick `marbledrive.app`).
4. **Ubuntu:** `linux/systemd/home.sh restart bryan` (it reads its settings;
   it says standby: the lease names the Mac). Then `linux/systemd/tunnel.sh
   setup bryan pc-bryan.marbledrive.app` and `linux/systemd/tunnel.sh install
   bryan`.
5. **Windows** (PowerShell): `powershell -ExecutionPolicy Bypass -File
   \\wsl.localhost\Ubuntu\home\<user>\Development\3rd-year-projects\marble-drive\windows\wsl-home.ps1 -NoSleep`.
6. **The Worker** (from the Mac, `worker/`): `npx wrangler@latest deploy`, so
   `DRIVES` knows the PC.
7. **Mac:** `node tools/drive-home.mjs to fly` (from Terminal, never from a
   conversation hosted on the Mac). admin-p2 serves for the minute between.
8. **PC:** `node tools/drive-home.mjs to pc`. Check
   `https://bryan.marbledrive.app`.
9. **Mac:** retire it as a home ("Day to day" above).

**Add a friend.** Push `main` first. `tools/sprite-provision.sh <name> --agent
api` (or `subscription`, then `claude login` in their console). Send the
printed note. Loop over several under `bash`, not zsh: zsh does not split an
unquoted variable into words.

**Update everyone.** In the console: Ship, read the plan, Ship. From a
terminal: `tools/sprite-deploy.sh --all --list`, then `--all`, then
`tools/sprite-deploy.sh admin-p2`. `t-irene` and `t-sam` currently need
`--no-checkpoint` (see Troubleshooting).

**Undo a deploy.** `tools/sprite-deploy.sh <sprite> --rollback`. For the
drive itself: `sprite checkpoint list -o marble-drive -s <sprite>`, then
`sprite restore <id> -o marble-drive -s <sprite>` (destructive: everything
since that checkpoint, drive included).

**Look at a sprite without its URL.** `sprite proxy -o marble-drive -s <sprite>
4410:4400` (4400 may be taken locally). Through the proxy the Host header is
`127.0.0.1`, which an ungated host allows; send
`-H "Host: <sprite>-b3fwm.sprites.app"` to see what a browser sees.

**Back a drive up here.** admin-p2 is backed up to the owner's Mac by
`macos/launchd/backup.sh` (installed 2026-09-27), which runs
`tools/backup-agent.mjs` every minute. The Mac keeps **one copy**,
`~/Marble Backups/<utc>/`, and `~/Marble Drive` is a link to it; the history is
on Fly, as checkpoints. Each backup (`tools/drive-backup.sh`) makes a Fly
checkpoint (`backup <utc>`), copies the drive into a new `<utc>/` with every
unchanged file a hard link to the copy before (so only what changed moves),
points `~/Marble Drive` at it and removes the old one; a failed run leaves the
old copy and link alone. The same run then copies the workshop,
`/home/sprite/src`, every checkout with its `.git` and uncommitted work (not
`node_modules`), into `~/Marble Backups/workshop/<utc>/`, linked from
`~/Marble Workshop`, so code not yet pushed survives its sprite (added
2026-09-29, when admin-p2's disk failed; 232 MB, 14 s for drive and workshop).
Its `workshop.json` lists each checkout's branch, files changed and commits no
remote has, and the log line names the ones with work nowhere else. The
worktrees' `.git` names their repository by its path on the sprite, which the
report follows into the copy. Sign-ins are not copied. A workshop failure
leaves the last copy and never fails the drive's backup. The copy carries its sync reference in
`.marble/sync.json`: the drive, when, the Fly checkpoint it matches (or why
there is none: Sprites' checkpoint store can get stuck, and then the copy goes
ahead without), documents, files, bytes added.

When: the agent asks the Sprites API about the sprite every minute, which wakes
nothing. Only while it is running does it look inside, once: the newest real
change in the drive (its usage ledger and the Console's files are not changes)
and the Console's requests. It backs up only after a change: once the drive has
been quiet for 10 minutes, every hour while changes keep coming, or once when
it goes to sleep with changes not yet copied (the one wake). Awake and
untouched, however long, it copies nothing. It leaves a report in
`/drive/.marble/console/backups/<sprite>.json` and takes requests from
`requests/` (back up, schedule on/off, put the copy on a drive, restore a Fly
checkpoint), remembering every one it handled and refusing one older than an
hour, so a restore cannot replay one. The schedule is a flag on the Mac
(`~/Marble Backups/.schedule-off`), so turned off it still answers the page.
The copy runs rsync through `sprite exec` (`tools/sprite-rsh.sh`), taken while
the drive is live, and needs the Mac awake: a Mac that slept catches up on
waking.

**Restore a drive from a backup.** From the Console's Backups view, or:
`tools/drive-restore.sh "$HOME/Marble Drive" <sprite>` says what it would do;
add `--yes` to do it. Onto the same sprite after it lost its drive, or a new
one (`sprite-provision.sh` or a deploy first, since a backup holds the drive
only: `sprite.env`, keys and the Claude login are not in it). The drive it
replaces is set aside as `/drive.before-restore-<utc>`. Conversations come back
readable; their Claude sessions lived on the old machine. To go further back,
restore one of Fly's checkpoints (the whole machine: drive, code, settings);
from the Backups view the Mac does it, after checkpointing what is there now.

**Mirror a drive here.** `tools/drive-pull.sh` (admin-p2 into this
checkout's `drive/`; `<sprite>` and `--into <dir>` for others). Stop the local
host first; the script refuses while one holds the drive. The sprite must be
running: nothing reaches a stuck one, and a checkpoint cannot be read out, only
restored onto the same sprite. The copy streams through `sprite exec` while the
drive is live, so counts may differ by what was being written. Agent projects
are repointed at this machine's checkouts; the earlier mirror becomes
`drive.previous/`. Conversations come across readable, but their Claude
sessions do not.

**Edit a person's live Drive page** (rare; theirs to change). Stop the service
(`sprite-env services stop marble-drive`), write once, start it: a running
host reverts `<head>` and `<script>` edits made under it. Patch by anchor
(`tools/patch-cloud-files.py` is the pattern), never by copy.

**Move a drive between sprites.** Stop both services; set the target's
`/drive` aside (never delete); stream
`sprite exec -s A -- tar -C /drive -czf - . | sprite exec -s B -- tar -xzf - -C /drive`,
leaving out `.marble/agents/host.lock`; compare file and document counts; drop
agent projects whose paths do not exist there; carry keys from `sprite.env`
sprite to sprite without printing them; recreate the service. Old
conversations stay readable, but their Claude sessions stayed on the old
machine, so continuing one starts fresh.

**Moving the owner's sprite** (admin-p1 to admin-p2, 2026-09-28, about 13 s
offline). `sprite create -o marble-drive --skip-console --label marble-owner
<new>` (private to the org, like the old one). Copy `/drive` from the old
sprite while it still serves: `sudo mkdir /drive` and `chown` it on the new
one, then on the old one `rsync -a --delete --exclude
/.marble/agents/host.lock -e ~/app/current/marble-drive/tools/sprite-rsh.sh
/drive/ <new>:/drive/` (2.5 GB in a minute, inside Fly). The owner copies the
home folder himself, because it holds every sign-in (Claude, GitHub, npm,
Sprites, the other agent CLIs) and `sprite.env`: on the old sprite, `tar -C
/home/sprite -czf - --exclude=./app --exclude=./.npm --exclude=./.sprite-shared
. | sprite exec -o marble-drive -s <new> -- tar -C /home/sprite -xzf -`, from
a Mac terminal (a `!` command in Claude Code cannot reach the keychain).
Checkouts come across with their uncommitted work, and Claude sessions with
them, so old conversations can be continued. Deploy the new sprite only once
the drive is there: its first request would otherwise start the day's run on
an empty drive. To cut over: stop the old host (`sprite-env services stop
marble-drive`), stop the new one, rsync again (seconds), compare file counts,
`release.sh apply` on the new one. Then delete the old sprite's services so
nothing can wake its host, relabel it, `macos/launchd/backup.sh install
<new>`, and point the daily cron-job.org ping at the new URL.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Sprite URL: 502 "sprite isn't answering" | no service with `--http-port`, or it is down | deploy; `sprite-env services list` |
| Agents: "an ungated drive answers agent routes only as localhost" | the sprite has no passphrase | add `MARBLE_DRIVE_SECRET` to `sprite.env`, redeploy |
| Every turn fails at once: `unknown option '--permission-prompts'` | an old `claude` | releases pin `tools/sprite/claude-version`; deploy |
| `claude native binary not installed` | npm on a sprite blocks install scripts | the release runs `node node_modules/@anthropic-ai/claude-code/install.cjs` |
| A turn froze when its tab closed | sprite paused | keep-awake; check `GET /v1/tasks` on `/.sprite/api.sock` |
| A turn froze when nobody was around | held past its limit: an unanswered question (10 min), no progress (30 min), or a day unattended | by design; opening the drive wakes it and it carries on |
| A tab stopped updating | it rested (hidden 60 s, or idle 10 min) | any input wakes it; an old tab from before a deploy needs a reload |
| A sprite never pauses | something holds it: a stream, a request, or a Sprites task | `/health` `streams`; `GET /v1/tasks` on `/.sprite/api.sock` |
| API says `running` but `sprite exec`/`console` hang (i/o timeout) and a checkpoint says 503 "No process is running to checkpoint" | most likely out of memory and thrashing: it followed the owner from admin-p1 (09-26, 09-27, 09-28) to a new admin-p2 (09-29, memory 1.2 → 6.3 GB in 25 min under several agents' work, the ledger's minute timer running late before it went silent). The files API may still list some folders while others hang. Since 2026-09-29 the memory guard should stop it first; `grep '\[memory\]'` the host log | nothing inside can help. A dashboard restart may say it timed out and still take effect ~16 min later (admin-p2, 09-29); a restore can hang for 40 min and fail (`INTERNAL_ERROR`) without applying, though the sprite then cold-boots on its own disk with nothing lost. Give Fly the `fly-request-id`s. If it keeps happening, move to a new sprite ("Moving the owner's sprite") |
| The host died and the URL answers 502, though the service says running | before 2026-09-28 nothing restarted a host that exited (admin-p1, 15:17 UTC: out of heap) | fixed: `serve.sh` starts it again; read `~/app/crash/crashes.log` and any report beside it |
| `Failed to create checkpoint … v3.in-progress … file exists` | stuck checkpoint store: the next version's name is held by a checkpoint Sprites' own database has no row for (`sprite checkpoint info vN` says "not found"), and it cannot be reached from inside the sprite (t-irene since 2026-09-23, t-sam since 2026-09-24; t-bryan, t-eunhye, t-rima by 2026-09-28) | `sprite-deploy.sh` goes on without a checkpoint by itself and says so; report the stuck sprites to Fly |
| An API key vanished after a deploy | keys inside the release (old behaviour) | keys live in `~/.config/marble-drive/agent-keys` now |
| `tar: unrecognized option '--no-mac-metadata'` | a macOS-only flag on Linux | fixed: the flag is passed only on macOS |
| A deploy from admin-p2 would kill its own turn | switching restarts the host running the turn | self-deploys hand off to `marble-switch`; watch `~/app/switch.log` |
| `/today` lands somewhere odd | `latest` in `/drive/.marble/drive.json`, or `MARBLE_DRIVE_LATEST_DOC` | set `latest` |
| Agents: "Playwright is not available … node_modules/@bdhmin/marble/node_modules/playwright" | npm hoisted Playwright beside marble (every sprite) and the host looked only inside it | fixed 2026-09-25: `playwrightEntry` resolves it either way |
| Agents' browser lands on `/gate` | the turn's browser had no pass | fixed 2026-09-25: the runner hands it one; a stage fails if Chromium will not launch |
| Sprite URL shows "This drive is being served from the other machine" | the sprite is held: the drive's home is the Mac | use `http://127.0.0.1:4401` on the Mac (`4402` for a trial drive); `node tools/drive-sync.mjs state` says who is home. Not a fault |
| A move or upload says "the drive has no documents" or "under half of the … last uploaded" | the folder looks empty or far smaller than before (a wrong or unmounted `--root`, a folder swapped out); nothing was sent | look at the folder. On the Mac, `~/Marble Drive` must be a real folder, not the backup agent's link |
| Log: `[home] standby: the lease refused this machine (401)` | the Worker did not accept the token or URL: `LEASE_URL` or `LEASE_TOKEN` in the hub settings is wrong (or the Worker's secret changed) | fix the settings file, restart. The remembered lease is deliberately not used, so this machine stands by until it is fixed |
| Log: `[hub] upload waits: the lease is unreachable` | no network, or the Worker is down; the host goes by the last lease it saw and uploads nothing | wait, or check `LEASE_URL`; the drive itself is fine |
| `drive-home` stops at a step, saying where the lease is and what was started | a failed move; nothing was deleted | read the message. If the lease names a side whose copy was not verified, `drive-home lease-to <side>` gives the lease back to the good one with no upload |
| `drive-home` reports `verify-standby` | the target is home and serving, but the side left does not say standby | make sure the old side is not serving; `drive-home lease-to <target>` holds it again |
| The hub is slow from the Mac; rclone calls take minutes | R2 leaves some requests unanswered 5–90 s from the owner's home network (not from Fly) | expected; timeouts are 10 s with 20 retries. A Mac move is 59–113 s for a small drive |
| admin-p2 serves the drive after a rollback while the Mac is home | a release from before the hub does not know the lease | roll forward (`tools/sprite-deploy.sh admin-p2`) and hold admin-p2 (`drive-home lease-to mac`). Don't roll admin-p2 back past the hub |
| The gate check says 401 where a browser gets the passphrase page | the gate redirects only requests asking for `text/html` | send `Accept: text/html` |

## Costs

Sprites bill CPU actually used and memory held, per second, **only while
running**, plus storage: hot while awake, cold always
([Fly pricing](https://fly.io/pricing/)). A sprite runs while someone is using
a tab on it or its work is getting somewhere, and not more than a day
unattended (see "Staying awake, and sleeping").

| | until 2026-09-30 | from 2026-10-01 |
|---|---|---|
| CPU | $0.07 / CPU-hour | $0.03825 |
| Memory | $0.04375 / GB-hour | $0.021875 |
| Hot storage (awake) | $0.000683 / GB-hour (≈ $0.50 / GB-month) | same |
| Cold storage (always) | $0.000027 / GB-hour (≈ $0.02 / GB-month) | same |

While running, Fly bills at least 1/16 of a CPU and 256 MB. The first real bill
(2026-09-19 to 09-25, all six drives) was **$6.75**: memory $6.05, CPU $0.58,
hot storage $0.11, so memory is the bill. The dashboard estimates cost from
the ledgers at these rates (`server/console/cost.js`), using `memory.current`
(which counts file cache; `MemTotal − MemAvailable` is kept beside it), and a
pasted bill scales each product to what Fly actually charged. Fly has no API
for the bill.

## Shelved (decided, not built)

- **UI updates to existing drives:** a `Marble Updates/` folder in every drive,
  each update a note with a "Merge into my Drive" button that briefs the
  person's own agent.
- **The front door:** sign-up, sign-in and routing, replacing passphrases and
  provisioning by hand; then limits and cost per person.
- **Labels:** move every user to `marble-user` (`--all` already accepts it).
- Catch up: `--all` to bring testers to the latest `main`; `sprite-workshop.sh
  admin-p2` to fast-forward the workshop checkout.
