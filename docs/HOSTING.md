# Hosting Marble Drive

How Marble Drive runs in the cloud as of 2026-09-24: what runs where, what is
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
| `admin-p1` | the owner | his real drive **and** the workshop, where Marble is changed and shipped | `marble-owner` | by name, last |
| `t-bryan` | the owner | a test user on an API key; try changes here first | `marble-tester` | `--all` |
| `t-irene`, `t-sam` | friends | their drives; agents on the owner's Claude login | `marble-tester` | `--all` |
| `t-sangho`, `t-peiling` | friends | their drives; agents on their own API keys | `marble-tester` | `--all` |

The owner's MacBook no longer serves a drive. Its `drive/` folder is a
**frozen backup** from 2026-09-24 01:15 UTC; nothing syncs it.

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
| `~/.config/marble-drive/sprite.env` | this sprite's settings (`KEY=value`, mode 600): passphrase, secure cookie, which Claude pays, extra keys (TYPESAFE_API_KEY on admin-p1) | yes |
| `~/.config/marble-drive/agent-keys` | API keys saved in Agents settings (mode 600) | yes |
| `~/.claude/` | a Claude login, where the owner ran `claude login` | yes |
| Sprites service `marble-drive` | the host, port 4400, recreated on every switch | recreated |
| `/.sprite/logs/services/marble-drive.log` | the host's log | yes |
| `~/app/switch.log` | admin-p1 only: self-updates that waited for idle | yes |
| `/home/sprite/src/{marble-drive,marble}` | admin-p1 only: the workshop checkouts, agent projects "Marble Drive" and "Marble" | yes |

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
  **admin-p1's URL is private to the Fly org** as well, because it holds the
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
  flags the host passes). The owner's subscription is shared with two friends
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
  - **admin-p1 stays up while the owner uses it:** its `sprite.env` has
    `MARBLE_DRIVE_TAB_HIDDEN_SECONDS=1800` and `MARBLE_DRIVE_TAB_IDLE_MINUTES=60`
    (so its stream cut is 91 min). Waking costs seconds from paused and
    about 70 s from stopped (measured 2026-09-25), which is what made moving
    between pages feel slow. Testers keep the short defaults.
- **Page weight:** the host compresses text (Brotli, else gzip; Fly's edge
  gzips anyway), and a page names each runtime file at `?v=<hash>`, which the
  browser keeps until the file changes. Moving between documents downloads
  only the document.
- **Git:** agents in a person's Drive project cannot reach a repository
  (`GIT_CEILING_DIRECTORIES`); agents in a registered project (the workshop's)
  can.

## Shipping a change: the workshop

The owner works in his drive on admin-p1. A bug or an idea becomes a
conversation there in the **Marble Drive** (or **Marble**) project. The agent
follows the repo's `CLAUDE.md`:

1. Make the change; `npm test` and the browser tests it touches.
2. Try it as a user: `tools/sprite-deploy.sh t-bryan --local`.
3. A `marble` change: bump, `npm publish` from `../marble`, point this repo at it.
4. Commit and push to `main` (straight to `main`, by the owner's choice).
5. When the owner says so: `tools/sprite-deploy.sh --all`, then
   `tools/sprite-deploy.sh admin-p1`. From admin-p1 itself this stages the
   release and hands the switch to a `marble-switch` service that waits until no
   agent is working, so the conversation that asked is not cut off. From
   anywhere else, add `--when-idle` for the same wait.
6. Report what shipped where.

admin-p1 is signed in to GitHub (`gh auth login` + `gh auth setup-git`), npm
(`npm login`) and Sprites (`sprite login`) by the owner, and commits as
`bdhmin`. `tools/sprite-workshop.sh admin-p1` refreshes the checkouts (fast-forward
only, never over local changes), installs them and re-registers the projects.

The same steps work from the MacBook, where this repo also lives.

## The console

**Console** is a document in admin-p1's drive (`/a/Console`): every drive and
everything done to them, from one page. It is on only where `sprite.env` says
`MARBLE_DRIVE_CONSOLE=1` and the drive has a passphrase, which is admin-p1. Its
code is the host's (`server/console/`, `runtime/console.js`, `console.css`),
so it ships with every deploy; the document is only where it lives.

| View | What it does |
|---|---|
| **Dashboard** (opens on it) | every drive's state over time (running, warm, cold), cost by drive, why each was awake, spend this month and its projection (and a budget, if set), spend per day, when drives are awake (hour × weekday), memory, CPU, agent turns and documents opened; 24 h, 7 days, 30 days or this month; any chart as a table; **Paste a bill** takes Fly's Cost Explorer page and calibrates every estimate to it |
| **Drives** | every drive, awake or asleep and since when, without waking any; a drive's release, health, Claude (login or key, sign in or out), access (public or private, the passphrase: show, copy, new), settings (`sprite.env`, applied with a restart), checkpoints (make, restore by typing the name), and removing a tester; **New drive** provisions one |
| **Ship** | main's recent commits and which drives have them; each drive against main; **Ship** shows the plan (`sprite-deploy.sh --print-plan`) before deploying main to every user and then admin-p1; **Try the workshop on t-bryan** |
| **Workshop** | both checkouts (branch, head, changes, against origin), pull, run tests, **Publish** marble (the next patch in package.json and both plugin manifests, committed, tagged and pushed, then `npm publish`, which runs marble's guard and unit tests; npm may ask you to approve it). marble-drive needs no change: it depends on `file:../marble`, and a deploy installs the version that checkout declares, and a workshop chat in the Marble Drive or Marble project |
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
admin-p1's own from disk, and records each change of status the Sprites API
shows, with the wake and pause times the API keeps. Kept on admin-p1 in
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
`sprite.env` and applied with `release.sh apply` (admin-p1: `apply-when-idle`).
No passphrase or key reaches a log or a cache file; a passphrase reaches the
page only on **Show** or **Copy**. A new drive's roster entry is written on
admin-p1 (`~/.config/marble-drive/testers.json`), the machine that made it.

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
| `tools/sprite-provision.sh <person> [--agent api\|subscription] [--key-file f] [--local]` | makes `t-<person>`: passphrase, `sprite.env`, optional preloaded key, deploy, public URL, outside check, roster entry, a note to send |
| `tools/sprite-provision.sh --resume <person>` | finish one that stopped part way |
| `tools/sprite-provision.sh --remove <person>` | destroy after typing the name; drops the roster entry |
| `tools/sprite-workshop.sh <sprite> [--github f] [--npm f] [--sprites f]` | the workshop: checkouts, projects, identity, optional token files |
| `node tools/sprite/check-tester.mjs t-<person> [save-key]` | sign in with the roster passphrase and check gate, agent, views, materials |
| `node tools/sprite/smoke.mjs [base]` | Drive, drawn PDF picture, 100 MB upload with a cut chunk, through `sprite proxy` |

## Runbooks

**Add a friend.** Push `main` first. `tools/sprite-provision.sh <name> --agent
api` (or `subscription`, then `claude login` in their console). Send the
printed note. Loop over several under `bash`, not zsh: zsh does not split an
unquoted variable into words.

**Update everyone.** In the console: Ship, read the plan, Ship. From a
terminal: `tools/sprite-deploy.sh --all --list`, then `--all`, then
`tools/sprite-deploy.sh admin-p1`. `t-irene` and `t-sam` currently need
`--no-checkpoint` (see Troubleshooting).

**Undo a deploy.** `tools/sprite-deploy.sh <sprite> --rollback`. For the
drive itself: `sprite checkpoint list -o marble-drive -s <sprite>`, then
`sprite restore <id> -o marble-drive -s <sprite>` (destructive: everything
since that checkpoint, drive included).

**Look at a sprite without its URL.** `sprite proxy -o marble-drive -s <sprite>
4410:4400` (4400 may be taken locally). Through the proxy the Host header is
`127.0.0.1`, which an ungated host allows; send
`-H "Host: <sprite>-b3fwm.sprites.app"` to see what a browser sees.

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
| API says `running` but `sprite exec`/`console` hang (i/o timeout) and a checkpoint says 503 "No process is running to checkpoint" | the sprite itself is stuck, below Marble: admin-p1 2026-09-26, 06:12–16:22 UTC; its ledger went silent, a deploy stalled after sending `release.sh`, memory never passed 2.4 GB | nothing inside can help; it came back on its own with a cold boot. Do not restore (you lose the drive since the checkpoint); give Fly the `fly-request-id`. Afterwards redeploy whatever stalled |
| `Failed to create checkpoint … v3.in-progress … file exists` | stuck checkpoint store (t-irene since 2026-09-23, t-sam since 2026-09-24) | `--no-checkpoint`; report to Fly if it persists |
| An API key vanished after a deploy | keys inside the release (old behaviour) | keys live in `~/.config/marble-drive/agent-keys` now |
| `tar: unrecognized option '--no-mac-metadata'` | a macOS-only flag on Linux | fixed: the flag is passed only on macOS |
| A deploy from admin-p1 would kill its own turn | switching restarts the host running the turn | self-deploys hand off to `marble-switch`; watch `~/app/switch.log` |
| `/today` lands somewhere odd | `latest` in `/drive/.marble/drive.json`, or `MARBLE_DRIVE_LATEST_DOC` | set `latest` |
| Agents: "Playwright is not available … node_modules/@bdhmin/marble/node_modules/playwright" | npm hoisted Playwright beside marble (every sprite) and the host looked only inside it | fixed 2026-09-25: `playwrightEntry` resolves it either way |
| Agents' browser lands on `/gate` | the turn's browser had no pass | fixed 2026-09-25: the runner hands it one; a stage fails if Chromium will not launch |
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
  admin-p1` to fast-forward the workshop checkout.
