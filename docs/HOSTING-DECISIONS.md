# Taking Marble Drive to the cloud: the decision record

What was decided between 2026-09-22 and 2026-09-30, in the order it was
decided: the problem, the options weighed, what was chosen and why, and what it
cost or taught. The design and the build were done in one long session between
the owner and Claude (Claude Code). How things work now is in
[`HOSTING.md`](HOSTING.md); the specs behind each stage are in
`docs/superpowers/specs/` (2026-09-22 to 2026-09-29).

## How the work was done

Each stage followed the same loop, and the loop is part of what made it work:

1. **Find the real problem first.** Before any design, read the code, run the
   real system, and measure. The session began with the Agents UI freezing: the
   cause was a shared global regex in the new markdown renderer, recursing into
   itself and rescanning forever. It was found by replaying all 2,454 real
   agent messages from the drive through the renderer, not by guessing.
2. **Brainstorm with the owner, one decision at a time.** Claude explored the
   repo and the platform, then asked only the questions that were the owner's
   to answer (purpose, risk, preference), with a recommended option each time.
   Technical choices were made and recorded, not asked.
3. **Write a spec, then a plan.** Each stage has a design spec (why, design,
   guards, out of scope) and an implementation plan with tasks, interfaces and a
   "review focus" of the inputs the tests would not otherwise meet.
4. **Build test-first, in a separate worktree.** Every behaviour had a test
   that was watched failing before the code existed; tests written after the
   code were mutation-checked (break the code, see the test fail). Work
   happened on a branch in a git worktree, because the running host serves
   `runtime/` straight from the main checkout.
5. **Prove it on the real thing.** Every stage ended with a run on real
   sprites: a real deploy, a real upload, a real agent turn with every
   connection cut, a real provision checked from outside. Most of the bugs in
   the troubleshooting table were found only this way.
6. **Keep a ledger of rulings.** Every deviation from a plan was written down
   as "ruling: what, why, cost if wrong", and reported to the owner.

## The decisions

### 1. The repository is the app; a drive is someone's own space

**Problem.** The owner's own setup shipped to everyone: his `/my-day` skill in
every `/` menu, his folder names in the shipped Drive, `/today` pointing at his
folder, a Finder helper installer aimed at his laptop. And the drive lived
inside the git checkout, so only `.gitignore` stood between a person's work and
the repository.

**Considered.** Anonymising the repo (the owner's first reading, then set
aside: "it doesn't have to be entirely anonymous"); moving the drive out of the
checkout; fencing agents instead.

**Chose.** Two guarantees, stated before any code: a fresh install starts with
its own empty space; using Marble never makes a git change. The owner's
`bdhmin` name and history stay; what goes is anything that makes a new drive
his.

### 2. Where a drive lives: the checkout in development, an explicit root in production

**Chose.** On a development machine the drive stays at `<repo>/drive`
(the owner did not want his layout changed; `~/drive` was proposed and
rejected). Production sets its root explicitly: `/data` on Fly Machines,
`/drive` on a sprite.

### 3. Fence agents from git instead of moving the drive

**Problem.** With the drive inside the checkout, an agent working in the drive
could `git commit` into the app.

**Chose.** Every full turn in the Drive project gets `GIT_CEILING_DIRECTORIES`
set to the drive's parent: git inside the drive finds no repository. Registered
projects (where code work belongs) keep git. It guards accident, not intent.

### 4. A drive names its own choices: `.marble/drive.json`

Folder colours (`realms`) and the document `/today` opens (`latest`) moved out
of the host and the shipped template into a file inside each drive: it travels
and is backed up with the drive, never shows in a listing, and a new drive has
none. The owner's live Drive page kept its own copies.

### 5. The app's skills ship as a plugin; a person's skills live in their drive

**Found by probing.** A real Claude turn run from a drive inside the checkout
loaded the repository's `.claude/skills` by walking up the folders, which is how
the owner's `/my-day` leaked into every drive.

**Chose.** The app's own skills (`visuals-in-chat`, `genui-author`,
`growing-the-open-page`, `typesafe-ai`) moved to `agent-plugin/`, passed to
every full turn with `--plugin-dir`; the owner's `/my-day` moved into his drive
(`.claude/skills/`); agents are told a skill they make for a person goes there.

### 6. Files in a cloud drive: the page draws the pictures

**Problem.** File thumbnails came from macOS QuickLook, so on any other host a
PDF or a video was an icon. Uploads were one HTTP request, capped in practice
by Node's five-minute request timeout (about 600 MB at 2 MB/s, whatever the
configured cap said).

**Considered.** Server-side thumbnailers on Linux (sharp, pdftoppm, ffmpeg,
LibreOffice) against letting the page draw.

**Chose.** The page draws images, a PDF's first page (pdf.js from jsdelivr,
pinned) and a video's frame, and the host keeps the picture per version of the
file, so it is drawn once. QuickLook stays as the Mac's fallback. Uploads over
32 MB go in resumable chunks; the cap rose to 20 GB with a free-space check
before a byte is sent; an upload is cut only after 60 s of silence.

### 7. One machine per person, on Fly Sprites

**Considered.** The multi-tenant host in `ACCOUNTS.md` against one
single-owner host per person. Agents have a real shell, registered projects and
a browser, so a shared host would need per-turn sandboxing.

**Chose.** One sprite per person, running this host unchanged. Other people's
agents run on their own API keys (never the owner's subscription), with one
exception the owner chose for two friends (decision 12).

### 8. A sprite gets its code from public sources

**Found.** The `marble` repository is private; pulling it would put a GitHub
credential on every person's sprite.

**Considered.** Pushing a packed bundle from the Mac, against installing from
public sources.

**Chose.** `marble-drive` from its public GitHub repo at a pushed commit,
`@bdhmin/marble` from npm, and `--local` to push a machine's working copies to a
test sprite. No sprite holds a credential it does not need.

### 9. Releases side by side, switched by a link

Each deploy builds a release in its own folder, smoke-tests it against a
throwaway drive, then points `~/app/current` at it and recreates the service;
if the service does not come up, it goes back. Three releases that went live
are kept; a checkpoint is taken first. A bug found by the real deploy (a failed
build left its folder, and pruning could delete a good release in its favour)
became a regression test.

### 10. A sprite stays awake while an agent works

**Found in the docs, then proved.** A sprite pauses after its last
connection and freezes every process; a turn outlives its tab. The host now
holds a Sprites task while anything runs. Proved by starting a turn, cutting
every connection, and reading the event timestamps afterwards: it finished 57 s
later, not when the sprite was next woken. That run had a connection open when the turn
began. On 2026-09-24 a turn sent with nothing else connected froze within a
second, before keep-awake's first 15 s check, so the hold is now taken the
moment work starts.

### 11. Claude Code is pinned per release, from the repository

**Found by the first real turn.** The Sprites image's `claude` (2.1.251) lacked
a flag the host passes, so every turn failed at once. Each release installs its
own Claude Code; npm on a sprite blocks install scripts, so the release runs its
installer explicitly. The version first defaulted to the deploying machine's
`claude`; once deploys could run from a sprite (whose `claude` is old), it moved
to a pin file in the repo, bumped deliberately.

### 12. Getting in, and who pays for agents

- **Every sprite has a passphrase.** Found by the owner's first visit: a host
  with no passphrase answers agent routes only when asked for as `localhost`,
  which a sprite URL never is (tests through a proxy on `127.0.0.1` hid it).
- **Testers' URLs are public** behind the passphrase, because a Fly org member
  can open every sprite in the org, the owner's included. **admin-p1 is private
  to the org as well**, because it holds the keys.
- **Paying for agents is per sprite:** a Console API key, or the owner's Claude
  login for two friends. Claude flagged that consumer subscriptions are for one
  person and sharing one may risk the account; the owner chose it for internal
  testing, and a Console key per person remains the path for anyone else.
- **One Claude, with a switch:** instead of two agents in the picker, one
  "Claude" with a Claude login / API key switch in Agents settings.

### 13. The shipped Drive is the product's

The owner's own views (Map, the orbit; Pulse, the GitHub-style day squares)
left the template; the Drive page folds itself into the materials strip instead
of listing itself as a document; one lab's name ("KIXLAB API") left the shipped
host and page code. Done before any tester's drive was made, because a person's
Drive page is copied from the template once.

### 14. Provisioning by hand, updating by label

`tools/sprite-provision.sh` makes a tester's sprite end to end and prints a
note to send; `--resume` finishes one that stopped, `--remove` destroys only
after the name is typed. `--all` picks sprites by label (`marble-tester`, later
`marble-user`), not by name, after the owner's own drive was found left out by
a `t-` prefix rule. The owner's test bed is labelled `marble-owner` and deployed
by name only.

### 15. The owner's drive moves to the cloud

The Mac's drive (2 GB, 5,574 files, 120 documents, 132 conversations) was
streamed to a sprite with both hosts stopped, then merged into `admin-p1` with
the documents the owner had made there (4 documents, 7 conversations; where
both had a file, his customised versions won; the other side was set aside,
never deleted). The Mac copy is a frozen backup. A dummy user, `t-bryan`, was
made for trying changes as a user sees them.

### 16. Where code is changed and shipped: the owner's one sprite

**The owner's requirement.** Work in his drive, hit a bug, fix it in
`marble-drive` or `marble`, and ship it to every drive, all from inside the
Marble UI.

**Considered, equally.**

| Option | For | Against |
|---|---|---|
| A. His public drive holds the keys | one UI | keys behind one public passphrase; deploying itself kills its own turn |
| B. A separate workshop sprite, two tabs | safe | tab switching |
| C. A workshop driven from his drive (remote projects) | one UI, safe | a new feature |
| D. GitHub deploys on merged pull requests | smallest risk | set-up, an extra step |
| E. Keep the Mac | nothing to build | not in the Marble UI |

**Chose (the owner's refinement).** One sprite for himself: `admin-p1` is both
his drive and the workshop, private to the org and behind a passphrase, so
option A without its main risk. Changes go straight to `main`; the
pull-request flow (D) can be added later without undoing anything.

### 17. A sprite updates itself only when no agent is working

**Problem.** An agent runs inside the host that serves it; a deploy to
admin-p1 from one of its own conversations would restart that host and end the
conversation mid-turn. A process started from the turn is a child of that
host, so it would die too.

**Chose.** A self-deploy stages as usual, then hands the switch to a separate
Sprites service that waits until the host holds no Sprites task at two checks in
a row, switches, and removes itself; it gives up after two hours of wall time.
Proved end to end: a workshop conversation made a change, tested it, deployed
it to `t-bryan`, found and fixed a real bug (a macOS-only `tar` flag), pushed,
and updated admin-p1, which switched 34 s after the turn ended.

### 18. Signing in the workshop by hand

The workshop was designed to take narrow tokens from files. The owner signed in
interactively instead (`gh auth login`, `npm login`, `sprite login` in the
sprite's console): simpler, broader, and acceptable on a private sprite. The
token-file path remains in `tools/sprite-workshop.sh`.

### 19. When the platform breaks: a way around, stated

`t-irene`'s checkpoint store got stuck (a leftover `v3.in-progress`), so every
checkpoint failed and the deploy stopped before changing anything, as designed.
Rather than weaken the default, `--no-checkpoint` exists for exactly that case,
and says so when used.

### 20. A sprite sleeps when nobody needs it; limits freeze, never kill

**Found.** Three ways a sprite billed with nobody there: an open tab (its live
streams count as activity, for as long as the tab stays open), keep-awake
holding for any running turn, even one waiting days on an unanswered question
or hung, and polling (the usage meter, every two minutes). And two bugs in the
stall rule: it ended a turn after 30 min without output, killing one long silent
command, and a sprite that froze mid-turn woke to overdue timers and ended the
turn the moment its owner came back.

**Considered.** A hard cap on how long a sprite may run (1 or 2 hours), against
limits on attention and progress. The owner has run long jobs, and lab
scientists may run longer: a cap that ends work is wrong. A cap that only
freezes it is safe, so the one hard limit is a day unattended, as a backstop.

**Chose.** Tabs rest (hidden 60 s, idle 10 min) and the host closes the streams
of tabs that stopped saying they are used. Keep-awake holds only work that is
getting somewhere: 10 min for an unanswered question, 30 min without progress,
24 h since anyone used the drive. Progress includes CPU and I/O of the turn's
process tree, read from `/proc`, so a silent command counts as working and a
hung one does not. Every limit counts **awake time**: a clock that adds at most
two ticks across any gap, so a freeze adds nothing. Letting go freezes; the
only thing that ends a turn is the stall rule, on the same progress and clock.

### 21. The console: the tools, with a page in front of them

**Asked for.** One app on admin-p1 to monitor and manage every drive, ship
marble-drive and marble, and run the workshop; in Marble's design system;
designed and built without stopping for questions.

**Chose.**
- *A document, with the host's code.* Console is a document in the drive, so
  it opens from the Drive like anything else, but everything it does is
  `runtime/console.js` and `console.css`, injected by the host. The Agents page
  taught that code kept in a live document drifts from the repo and has to be
  patched by hand; nothing on the console is the owner's writing to keep.
- *Never wake a drive to draw a page.* The Sprites API answers who is awake,
  links and checkpoints for nothing; what only the drive knows is a look, asked
  for, or taken for free from a drive already awake. A status page that woke
  six machines on every paint would have been the most expensive page in Marble.
- *The same tools, not a second way.* Every action runs the scripts the owner
  runs from a terminal, as a recorded, streamed, stoppable job; a deploy of main
  runs the deploy script from that very commit, so the release script and the
  Claude pin match what ships.
- *Safety at the edges:* on only with the setting and a passphrase; changing
  requests only from the page's own origin; passphrases on explicit request
  only, and never in a log or a cache; admin-p1 never public, never restored or
  removed from itself; restore and remove need the drive's name typed.
- *Considered and left out:* money (the Sprites API reports no usage; awake
  time stands in), editing a person's documents (their drive is theirs; Open
  drive is the way in), and anything that would poll a drive to keep the page
  fresh.

**Found on the way.** `status: warm` had been read as "the API cannot tell";
held open with an exec, the same sprite read `running`, so `warm` is paused and
the list is honest.

### 22. A drive keeps its own ledger; cost is estimated, then reconciled

**Found.** The owner asked for state, use and cost over time. Nothing could
record it from outside for free: the Sprites API answers only "now", Fly has no
API for the bill (checked 2026-09-25: the Cost Explorer is a dashboard page),
and the console runs on admin-p1, which sleeps when nobody uses it. Inside a
sprite the whole VM is one cgroup (`0::/`): `cpu.stat` and `memory.current`
cover the machine. On t-bryan `memory.current` read 3.6 GB where
`MemTotal − MemAvailable` read 1.8 GB, so which one Fly bills is not obvious.

**Chose.**
- *The drive writes it down.* Its host runs exactly while it is billed, so one
  line per awake minute costs no wake and no connection (`server/ledger.js`).
  How it woke is read from the machine itself: the process was frozen (warm),
  the boot id changed (cold), or a new host on the same boot (a restart).
- *The console gathers, never wakes.* It reads ledgers only from drives the API
  says are running, and records status changes it sees. Rejected: polling from
  admin-p1 whenever it is awake (still gaps while it sleeps, and a call every
  20 s may itself keep it up), an always-on collector (a new machine to watch
  machines that cost about a dollar a day), and waking drives to ask.
- *Estimated, then reconciled.* Cost is the ledger at Fly's dated rates; both
  memory readings are kept, `memory.current` is used, and a pasted Cost
  Explorer page sets a factor per product, so a wrong guess about what Fly
  measures is corrected by the first bill rather than argued about.

### 23. An agent's browser carries a pass to its own drive

**Found.** Agents on sprites could not open a page or take a screenshot. Two
walls, one behind the other: the host looked for Playwright only inside
`@bdhmin/marble/node_modules`, where a linked checkout keeps it and an npm
install from the registry never does (it hoists it), so every browser call
failed before Chromium started; and past that, a sprite is always gated, and a
turn's browser is a fresh profile with no cookie, so the drive sent it to the
passphrase page.

**Chose.**
- *Find Playwright the way Node would*, from marble's own package, nested or
  hoisted (`playwrightEntry`). The release installs the Chromium build that
  Playwright names on every stage, and launches it, so a Playwright bump
  cannot leave a sprite with the wrong build or ship a browser that cannot run.
- *A pass, not an exemption.* The runner hands each turn's browser the gate's
  own signed cookie, good for a day, planted for `127.0.0.1` and `localhost`
  only. Rejected: letting loopback through the gate (anything on the sprite, or
  any proxy forwarding to it, would be signed in), and giving the browser the
  passphrase itself. An agent with a browser already has a shell on the
  sprite, so the pass grants it nothing it could not reach; it only lets the
  page be seen the way the person sees it.
- *Told where the page is.* A document is served at `/a/<path>` with no
  `.mrbl`, which an agent guessed wrong; a full turn's prompt now carries the
  address of the page the person is on.

### 24. Heavy work runs on the Mac, against a mirror; a backup keeps up with the drive

**Problem.** A sprite is too small for the big changes to Marble: full test
runs, browser suites and several agents at once, on the machine that also
serves the owner's drive. And admin-p1 stalled twice (2026-09-26 and 09-27),
leaving the Mac's three-day-old backup as the only copy within reach.

**Considered.** Moving the owner's documents to `t-bryan` and keeping admin-p1
for the console and shipping: rejected, since `t-bryan` gets every change first
(it is in `--all`, and takes `--local` builds), which would make the real drive
the canary, and the compute would still be a sprite's. Syncing the drive both
ways: rejected, since two hosts writing copies of one drive fork it.

**Chose.** admin-p1 stays the owner's drive and the light workshop (fix what
you hit, from inside Marble). The Mac is the heavy workshop: its checkout, and
its `drive/` as a one-way mirror of admin-p1, pulled on request
(`tools/drive-pull.sh`), set aside rather than deleted, and marked
(`.marble/mirror.json`) so a mirror is never taken for the real drive. It
needs the sprite running, so pull while it is well.

**And a backup, separate from the mirror.** The owner's priority was a copy
that keeps up with admin-p1 in case it crashes. The mirror cannot be that: the
local host writes to it and each pull replaces it. So `tools/drive-backup.sh`
keeps dated snapshots in `~/Marble Backups/`, on a 15-minute launchd schedule,
and `tools/drive-restore.sh` puts one back on a sprite. *Considered:* a live
two-way sync (rejected, as above: a crash is exactly when two copies disagree
and nothing would say which is right); Fly checkpoints alone (they share the
platform that stalled, and the 09-26 recovery may itself have been a restore);
tar each time (2.2 GB and 80 s per run against 224 KB and 11 s with rsync and
hard links). *Schedule without waking:* the API answers without waking a sprite,
and a sleeping drive does not change, so a run backs up only while it is awake,
plus once after it sleeps. The last-word run wakes it once, which would look
like new activity; the rule compares when it last woke with when the last
snapshot *ended*, so its own wake never triggers another.

**Controls in the Console (2026-09-27).** The owner wanted them in the drive on
the VM. The sprite cannot reach the Mac, so the Mac does the talking: an agent
on the Mac, every minute, reads the Console's requests and leaves a report, but
only while the sprite is awake anyway, so no page ever wakes it and a sleeping
drive is never woken to be told nothing. *Considered:* the controls only in a
Console on the Mac (right for when admin-p1 is down, but the owner lives on
admin-p1; that page shows the terminal command for that case instead);
reaching the Mac from the sprite over Tailscale (a network to run for one
page). Spec: `docs/superpowers/specs/2026-09-27-backups-in-console-design.md`.

**One copy on the Mac, the history on Fly (2026-09-27).** Dated snapshots
every 15 minutes looked like a lot (each folder shows 2.2 GB in Finder, though
all 35 held 2.5 GB), and 15 minutes of being awake is not 15 minutes of work:
an open tab keeps a sprite awake. The owner asked for one copy, `~/Marble
Drive` pointing at `~/Marble Backups/<utc>/`, carrying its sync reference, and
backups only when there is something to back up. So each backup makes a Fly
checkpoint and replaces the copy, and a backup is due only after a real change:
10 quiet minutes after it, or hourly while changes keep coming, or once as the
drive goes to sleep with changes. *Traded:* history now lives on the platform
that stalled twice, and Sprites' checkpoint store can jam (t-irene, t-sam, and
t-bryan since 2026-09-28), in which case a copy goes ahead without one and says
so. The Mac's copy is the part that survives Fly; going further back than it
needs Fly.

### 25. The owner moves to a new sprite; a host that dies starts again

**Problem.** admin-p1 stalled below Marble three days running (2026-09-26,
09-27, 09-28): `running` to the API, while exec, the console and the proxy
hung. On 09-28 the files API still listed `/drive` while anything under
`/home/sprite` hung. Its checkpoint store misbehaved too: a checkpoint missing
its data, a pre-restore that would not boot, and a restore that hung 40 min and
failed with `INTERNAL_ERROR` without applying. No other sprite, all taking the
same deploys, ever stalled. Separately, the same afternoon its host ran out of
V8 heap and stayed down, because a Sprites service is not restarted when its
process exits.

**Options.** Split the drive from the workshop onto two sprites (the owner's
first thought), with the workshop's heavy work reached from the drive; a new
sprite for both, as before; or stay and wait on Fly.

**Chosen.** A new sprite, admin-p2, doing both jobs as admin-p1 did, because
the evidence pointed at admin-p1's own storage and not at the workload, and
the owner wants one place to work. If admin-p2 stalls too, the workload is the
suspect and the split is next. admin-p1 is kept asleep for Fly. And two
guards: the service runs `tools/sprite/serve.sh`, which starts the host again
when it dies and keeps a crash log; and an agent's turn is the kernel's first
choice when memory runs out. A per-turn memory ceiling was the plan; Sprites
will not let a cgroup's `memory.max` be written, even by root.

**Cost or lesson.** The diagnosis was wrong: admin-p2 froze the same way the
next night, and its ledger showed why: memory climbing from 1.2 to 6.3 GB
under several agents' work, then thrashing. The fix is the memory guard
(decision 26), not the move; the move cost little and is kept. Moving took a
minute of copying inside Fly (rsync, run on the old sprite, through
`sprite-rsh.sh`) and 13 s offline. The sign-ins moved
with the home folder, which the owner copies himself: an agent is not to move
credentials between machines. A new sprite's first request starts the day's
run, so the drive goes over before the first deploy.

### 26. The host stops an agent's heaviest command before memory runs out

**Problem.** A sprite has 8 GB and no swap. Several agents' turns, each with
its own Chromium, and browser test runs (a Chromium per core by default) ran
it short, and Linux thrashed rather than killing anything, for hours.

**Options.** A cgroup ceiling for turns (cannot be written on a sprite); the
kernel's own killer with turns first (never fires while thrashing); a
watchdog; fewer things at once; a bigger sprite (16 GB on request from Fly);
tests on the owner's Mac.

**Chosen.** A watchdog in the host (`server/memory-guard.js`) that stops the
heaviest command a turn runs, and one browser test file at a time on a sprite.
The rest wait on how often it acts, which the ledger now counts. Thresholds
are amounts, calibrated on t-bryan with a capped hog against the host's own
reading: it acts at about 4.6–5 GB of load, with 1.1–1.5 GB left.

**Cost or lesson.** A shell and the host on the same sprite read different
`/proc/meminfo` (8 GB against 16 GB, the shell's in steps), and a sprite's
init runs at the turns' kill score: the first version would have counted it
as a turn. Test the guard's aim before its trigger, and with a backstop.

### 27. The owner's browser tests run on his Mac

**Problem.** Browser test runs were the biggest single user of memory on the
workshop sprite (4.9 GB of Chromium in one run on 2026-09-28), and the Mac has
room to spare.

**Options.** Tailscale on both, so the sprite could reach the Mac directly (a
key for each, and a way in to the owner's machine); a runner sprite with no
keys (still Fly's memory); the Mac doing the talking, as the backup agent does.

**Chosen.** The Mac does the talking: it checks in while the sprite is awake,
takes requests from `~/app/runner`, and streams output back. Owner-only by
construction, since only admin-p2 has a Mac watching it; bounded to `node
--test` on `test-browser/` files of a checkout under `/home/sprite/src`. The
sprite falls back to running the tests itself, one at a time.

**Cost or lesson.** Tried from a scratch checkout on admin-p2: 2 files in 11 s
(copy, packages and run), 5 files (26 tests) in 6 s, and a 40-file run
stopped at 10 s with nothing left running on the Mac. A Mac that looked every
few seconds would itself keep the sprite awake and billed; it looks often only
while the drive is busy of itself.

### 28. A drive at home on the Mac; Fly stands by through R2

Amends 24. Decision 24 made the Mac a mirror, pulled one way on request. This
lets the owner's drive live on the Mac, and keeps 24's reason: two hosts writing
one drive fork it.

**Problem.** The owner wants to work at the Mac's speed (36 GB and 12 cores
against a sprite's 8 GB with no swap, and a sprite that stalls), without paying
for a sprite that is awake while he does. If the Mac sleeps, dies or drops off
the network, the drive should still be reachable, from Fly, with the latest
state.

**Chose.**

| Decision | Chose | Why |
|---|---|---|
| Where the drive lives | the Mac is home; the sprite stands by | speed, and the stalls |
| How the two stay in step | R2 is the hub: the home uploads its changes; a machine taking over downloads first | Fly stays asleep while the Mac is home, and still starts from the latest state |
| Who may write | one home at a time, by a lease in a Cloudflare Worker with a Durable Object per drive | strongly consistent (KV can lag by a minute); every move names the epoch it moves from, so two moves cannot both win |
| Encryption | on the machine before upload (rclone `crypt`, names and contents) | the drive holds drafts and agent transcripts; Cloudflare holds only ciphertext. Without the passphrase and salt R2 is unreadable, so the owner keeps them in his password manager |
| What code runs the drive on the Mac | a release, like a sprite's (`tools/mac-release.sh`), not the dev checkout | experiments in the repo never touch real documents, and both homes run the same code |
| Undo | the trash: every upload and download sets aside what it replaces, 7 days | nothing is ever deleted outright |

**Set aside.**

- Two-way live sync: two writers fork a drive, and a crash is when they
  disagree (24).
- The Mac pushing straight to the sprite every 15 minutes: it wakes Fly on every
  push, and a crash leaves Fly up to 15 minutes behind.
- Cloudflare instead of Fly for the computer: its containers lose their disk
  when they sleep. Cloudflare holds the lease and the copy; a VM is still the
  computer.
- restic for the copy: dated snapshots, but restoring a delta onto a live copy
  and pruning minute-by-minute snapshots cost more than they give. The trash
  covers "undo that".
- A second domain for drives (like `github.io`): safer, but not bought.
- Fly taking over by itself when the Mac goes quiet, and the front door at
  `marbledrive.app`: designed (the spec's phases 2 and 3), not built. A move is
  a command, `tools/drive-home.mjs`, for now.

**What the trial changed.**

- **An encrypted file list.** The first design let `rclone sync` compare the two
  sides. Over crypt on S3 it asks R2 once per file: a 55-file upload took 402 s
  and a sync with nothing to send 95 s, and the real drive has about 6,500 files.
  So each upload writes `manifest.json` (size and mtime per file), both sides
  diff against it, and requests scale with what changed. A move on a 56-file
  drive: 211 s and 121 s before, 15–24 s (Fly to Mac) and 59–113 s (Mac to Fly)
  after. The list is trusted only when its `seq` matches `state.json`'s; else the
  pass is a full sync.
- **A hold file, not a stopped service.** The leaving side was first to be
  stopped, but the Sprites proxy starts a stopped service on the next request,
  and it would come up serving as home. `hold-<drive>` beside the hub settings
  makes the host answer standby whatever the lease says, across restarts and
  reboots. `drive-home` holds the leaving side before its last upload and
  releases the arriving one only once its download matches.
- **Short rclone timeouts.** From the owner's home network R2 sometimes leaves a
  request unanswered 5–90 s after connecting, while `curl` connects in 0.05 s
  and from Fly every request answers in 0.3 s. Every call now times out at 10 s
  (5 s to connect) and retries up to 20 times. This is why the Mac side is
  slower.
- **A second keep-awake.** A sprite pauses about a second after its last
  connection, freezing an upload. `marble-drive-hub` holds it while changes are
  not yet in the hub, taken on each write request and a 15 s rescan, and let go
  after 30 minutes of failed tries.
- **A host that cannot reach the lease** goes by the last lease it saw, unless
  the lease refused it (401, 403, 404: a wrong token or URL), or it is held.

**Cost or lesson.** A move that fails must say where the lease is and what it
started, and must be undoable without an upload (`drive-home lease-to`). Do not
run `drive-home` from a conversation hosted on either side: it stops that host.
A rollback of admin-p2 past the hub, while the Mac is home, would bring it up
serving. As of 2026-09-30 `t-bryan` is at home on Fly and the Mac has a service
for it; the owner's own drive has not moved, and the backup agent (24) still
runs until it does.

### 29. The PC takes over from the Mac as the drive's home

**Decided 2026-10-06.** The owner has a Windows PC that stays on, and wants the
drive there instead of on the MacBook Pro: served from home, reached from
anywhere at `bryan.marbledrive.app`, with the Mac able to pull a copy.

| Question | Chose | Over | Why |
|---|---|---|---|
| How the PC runs the host | Ubuntu under WSL2, systemd `--user`, lingering, a Windows task holding WSL up from sign-in | Windows natively | every script and the host already run on Linux (a sprite is Linux); native Windows would mean porting bash, rclone paths and the agent runner |
| How the PC fits the lease | a third machine name, `pc`, beside `mac` and `fly` | relabelling the PC as `mac` | two machines that both call themselves `mac` would both serve when the lease said so; a name per machine means a forgotten Mac service stands by on its own |
| Which moves exist | between the machine you are on and Fly; Mac to PC goes through Fly | any machine to any machine | `drive-home` holds and restarts the side it leaves and the side it reaches; only Fly can be driven from elsewhere (`sprite exec`). Through Fly is the tested path and costs a minute or two of admin-p2 |
| The PC's tunnel | its own, `marble-bryan-pc` for `pc-bryan.marbledrive.app`, `DRIVES.bryan.pc` | moving the Mac's tunnel credentials to the PC | two connectors on one tunnel would split requests between machines; a new tunnel needs no secret carried across |
| Carrying settings across | one file encrypted with a passphrase typed by the owner (`tools/home-secrets.sh`) | pasting into a chat, or the hub | keys never pass through an agent; the file can travel any way |
| Projects registered on other machines | `MARBLE_PROJECT_PREFIXES` with two pairs on the PC (Fly's and the Mac's checkouts both to the PC's) | a `/Users/bryanmin` symlink on the PC | honest paths; the variable already takes several pairs. A sprite takes one pair (no comma in `sprite.env`), so a project registered on the PC does not open on Fly |
| The Mac afterwards | home service and tunnel uninstalled, a hold file, `~/Marble Drive` set aside; `drive-pull.sh --hub` for a copy | deleting it, or keeping it as a live second home | nothing deleted; a hold file means a reboot or a stray `home.sh install` stands by |

**Cost or lesson.** The PC is a home only while Windows is signed in and awake:
a reboot for an update stops the drive until the owner signs in
(`bryan.marbledrive.app` then says the PC is out of reach). A home that is gone
cannot be held, so `drive-home rescue-to <side> --from pc` takes the drive from
the hub's last upload; the PC's unuploaded minutes stay on its disk. As with the Mac, never run `drive-home` from a conversation
hosted on either side.

### 30. Background work outlives the answer; a run is never cut off by silence

**Found 2026-10-08.** An agent building a feature on admin-p2 started its test
runs in the background, answered, and lost every run: "my background test runs
keep getting cut off between turns". A result with background work still out
ended the turn after a minute of silence. That window was meant for subagents,
which print as they go; a backgrounded command prints nothing until it ends, so
the minute always ran out, stdin closed, and the CLI left and took the run with
it. The drive's logs on the PC alone held 20 "Background shell command didn't
finish before the previous session ended" and 16 "Orphaned by a previous Claude
Code process exit". Separately, one whole unit suite outran the CLI's ten-minute
ceiling on a single command, which a host setting could not lift: the
environment allowlist drops `BASH_MAX_TIMEOUT_MS`.

**Chose.** While the CLI reports background work outstanding, no clock ends the
turn. The CLI picks the conversation up by itself when the work ends, as the
terminal does (52 times in those logs); the runner then gives it five seconds
to say so, and none while one of the agent's own tool calls is still running,
since background work can end in the middle of a silent foreground command. The one thing
that ends the wait is decision 20's rule: no output and no CPU or I/O in the
turn's process tree for the stall window, and a turn whose answer is in ends
then as completed, not failed. A full Claude turn gets `BASH_MAX_TIMEOUT_MS` of
30 min from the provider, so the allowlist stays as tight as it was.

**Cost.** A message sent while an agent waits on its own background work queues
behind it, as it does behind any running turn; Interrupt still cuts in, and
ends the run.

## Traps worth remembering

| Trap | How it showed up | Lesson |
|---|---|---|
| A global `/g` regex reused in a recursive function | the Agents UI froze on any bold text | `lastIndex` is shared state; use `matchAll` |
| Tests through `sprite proxy` send `Host: 127.0.0.1` | the ungated-host refusal was invisible until the owner used the URL | test as the browser does: set the Host header |
| `spawnSync` in a test that also runs a fake server | the test hung | the server needs the event loop |
| A loop's timeout summed from its sleeps | a hanging check would stretch 2 h into days | measure wall time |
| zsh does not split `$var` into words | provisioning four friends failed at argument parsing (harmlessly) | loop in `bash` |
| GNU vs BSD tools (`mv -T`, `tar --no-mac-metadata`) | worked on the Mac, failed on the sprite, or the reverse | test scripts on both, or pick portable forms |
| A name declared twice in one script scope | the whole Drive page stopped drawing | read the page's own errors first |
| Three writes in the same millisecond | a "newest document" test flaked on the sprite | never race the clock in a test; set times |
| An agent turn is a child of its host | a self-deploy would kill the turn doing it | hand the switch to something the restart does not touch |
| The image's `claude` is older than yours | every agent turn failed instantly | pin the tool with the release |
| npm blocks install scripts on a sprite | Claude Code's binary was missing | run the one installer that is needed, explicitly |
| A frozen machine's timers fire all at once on waking | a turn frozen overnight would be "stalled" the moment its owner looked | measure limits in awake time, not wall time |
| "No output" is not "no work" | a long quiet build was killed as stalled | read the process tree's CPU and I/O |
| An open connection is activity | a forgotten tab kept a sprite billing | streams rest with their tab; the host closes the rest |
| Renewing a Sprites task by POSTing its name again | a 409 every renewal; every hold lapsed after 5 min, unseen because the proof's turn took 57 s | extend with `PUT /v1/tasks/<name>`; prove a limit by outlasting it |
| A status page that reads the machine it reports on | would wake every drive it drew | read the platform's API; look inside only when asked, or when awake anyway |
| Listing a stopped (cold) sprite's checkpoints | three friends' drives were started every five minutes the console was open | never ask a cold sprite anything on a timer; re-read only after it has run |
| A sprite pauses about a second after its last connection, not 30 s | a turn sent with no tab open froze before keep-awake's first 15 s check | take the hold when work starts, not on a timer |
| Waking is the slow part, not the network | the owner's drive felt slow between pages; Fly's edge answered in ~90 ms, while a wake took 9 s paused and 70 s stopped | on the owner's drive, a tab keeps the sprite up for 30 min hidden and 60 min idle; the host's stream cut follows those limits unless set |
| A chart drawn into a hidden box | the phone's drive detail guessed 600 px for a chart it could not measure and pushed the page sideways | draw once the box has a width (`whenSized`) |
| One more tab in a flex bar inside a grid | a grid item's minimum width is its content, so the whole Console grew to 448 px on a 390 px phone | `min-width: 0` on the bar; let the tabs scroll within it |
| A dependency's dependency reached by path (`<pkg>/node_modules/<dep>`) | worked on the Mac (a linked checkout nests it), failed on every sprite (npm hoists it) | resolve it with `createRequire` from the package, never by path |
| The runtime was `no-store` | every page switch refetched 14 scripts (~265 KB compressed) | name each at `?v=<hash>` and let the browser keep it; `no-cache` + ETag for any other address |
| A test of a memory ceiling run before checking the ceiling was set | a 64 MB cgroup could not be made, the hog ran unbounded and t-bryan thrashed (load 30) until the kernel killed it | prove the guard is in place before testing what it guards |
| A watchdog tested from a script whose only timer was `unref`'d | the script exited at once, the hog ran to its cap and the machine thrashed | keep the test process alive, and give every hog its own backstop |
| `node --test` inside another `node --test` | the inner run printed nothing: it reported to the outer runner through `NODE_TEST_CONTEXT` | drop that variable when a test runs a test runner |
