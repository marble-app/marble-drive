# Taking Marble Drive to the cloud: the decision record

What was decided between 2026-09-22 and 2026-09-24, in the order it was
decided: the problem, the options weighed, what was chosen and why, and what it
cost or taught. The design and the build were done in one long session between
the owner and Claude (Claude Code). How things work now is in
[`HOSTING.md`](HOSTING.md); the specs behind each stage are in
`docs/superpowers/specs/` (2026-09-22 to 2026-09-24).

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

**Found in the docs, then proved.** A sprite pauses about 30 s after its last
connection and freezes every process; a turn outlives its tab. The host now
holds a Sprites task while anything runs. Proved by starting a turn, cutting
every connection, and reading the event timestamps afterwards: it finished 57 s
later, not when the sprite was next woken.

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
