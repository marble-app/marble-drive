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
    (15), `MARBLE_DRIVE_ASK_HOLD_MINUTES` (10), `MARBLE_DRIVE_NO_PROGRESS_MINUTES`
    (30), `MARBLE_DRIVE_AWAKE_MAX_HOURS` (24). The page reads its two from the
    host. A turn is only ever ended by the stall rule: 30 min of no output and
    no work, in awake time (`MARBLE_DRIVE_AGENT_STALL_MINUTES`).
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
   agent is working, so the conversation that asked is not cut off.
6. Report what shipped where.

admin-p1 is signed in to GitHub (`gh auth login` + `gh auth setup-git`), npm
(`npm login`) and Sprites (`sprite login`) by the owner, and commits as
`bdhmin`. `tools/sprite-workshop.sh admin-p1` refreshes the checkouts (fast-forward
only, never over local changes), installs them and re-registers the projects.

The same steps work from the MacBook, where this repo also lives.

## Tools

| Command | Does |
|---|---|
| `tools/sprite-deploy.sh <sprite>` | a pushed `origin/main` (GitHub) + `@bdhmin/marble` (npm) + pinned Claude; checkpoint, stage, smoke-test on a throwaway drive, switch, go back if it does not come up |
| `… --local` | this machine's working copies instead (unpushed code, unpublished `marble`) |
| `… --ref <commit>` / `--marble <v>` / `--claude <v>` | pick versions |
| `… --rollback` | back to the release before (from itself: when idle) |
| `… --no-checkpoint` | skip the restore point, only when Sprites cannot make one |
| `… --print-plan` | say what would be deployed, and stop |
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

**Update everyone.** `tools/sprite-deploy.sh --all --list`, then `--all`, then
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
| `Failed to create checkpoint … v3.in-progress … file exists` | stuck checkpoint store (t-irene since 2026-09-23, t-sam since 2026-09-24) | `--no-checkpoint`; report to Fly if it persists |
| An API key vanished after a deploy | keys inside the release (old behaviour) | keys live in `~/.config/marble-drive/agent-keys` now |
| `tar: unrecognized option '--no-mac-metadata'` | a macOS-only flag on Linux | fixed: the flag is passed only on macOS |
| A deploy from admin-p1 would kill its own turn | switching restarts the host running the turn | self-deploys hand off to `marble-switch`; watch `~/app/switch.log` |
| `/today` lands somewhere odd | `latest` in `/drive/.marble/drive.json`, or `MARBLE_DRIVE_LATEST_DOC` | set `latest` |
| The gate check says 401 where a browser gets the passphrase page | the gate redirects only requests asking for `text/html` | send `Accept: text/html` |

## Costs

Sprites bill CPU and memory per second **only while running**, and disk for
what is written (about $0.50 per GB-month) while paused
([Fly pricing](https://fly.io/pricing/); new prices from 2026-10-01). A sprite
runs while someone is using a tab on it or its work is getting somewhere, and
not more than a day unattended (see "Staying awake, and sleeping").

## Shelved (decided, not built)

- **UI updates to existing drives:** a `Marble Updates/` folder in every drive,
  each update a note with a "Merge into my Drive" button that briefs the
  person's own agent.
- **The admin console app** on admin-p1: every sprite, its release, awake or
  paused, deploy and rollback buttons, the roster, add or remove a tester.
- **The front door:** sign-up, sign-in and routing, replacing passphrases and
  provisioning by hand; then limits and cost per person.
- **Labels:** move every user to `marble-user` (`--all` already accepts it).
- Catch up: `--all` to bring testers to the latest `main`; `sprite-workshop.sh
  admin-p1` to fast-forward the workshop checkout.
