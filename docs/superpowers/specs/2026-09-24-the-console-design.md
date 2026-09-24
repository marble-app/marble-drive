# The console: every drive, from one page on admin-p1

2026-09-24. Status: design; the owner asked for it to be designed, specified,
planned and built without stopping for questions, so every choice below was
made here and says why.

## Why

Running Marble in the cloud is now six sprites, three repositories' worth of
shipping, and a workshop. Every one of those is done from a terminal today:
`sprite-deploy.sh`, `sprite-provision.sh`, `sprite exec` to read a log,
`sprite api` to see who is awake, a roster file on a laptop that no longer
serves a drive. The owner works in his drive on admin-p1; the console puts all
of it there, as one page, in Marble's own design language.

**What he asked for:** monitor, edit and manage everything about every drive,
their states, updating marble-drive and marble, and the workshop, from an app
on admin-p1. Clean, usable, smooth, and complete.

## What it is

A document called **Console** in admin-p1's drive, and a host module behind it.

- **The page** is a thin document (`templates/console.mrbl`, seeded once, like
  Agents and Chat) whose look and behaviour come from `runtime/console.js` and
  `runtime/console.css`, which the host injects into it.
  *Why a document:* it lives in the drive beside everything else, opens from
  the Drive, and is a tab like any other. *Why the code is runtime, not the
  file:* the console shows machine state, not writing; nothing on it is the
  owner's content to edit, and the lesson of the Agents page is that code kept
  in a live document drifts from the repo and has to be patched by hand. Code
  in `runtime/` ships with every deploy and is re-read on every request.
- **The host module** (`server/console/`) answers `/console/api/*` and runs
  every action as a **job**: a recorded, streamed, cancellable run of the same
  tools the owner uses from a terminal. It is on only where
  `MARBLE_DRIVE_CONSOLE=1` and the drive has a passphrase: admin-p1.

The page never talks to another sprite. Everything goes through admin-p1's
host, which holds the Sprites, GitHub and npm sign-ins.

## Where each fact comes from

The rule: **showing the console never wakes a drive.** A paused sprite costs
nothing, and a status page that woke six machines every time it drew would be
the most expensive page in Marble.

| Fact | Source | Wakes it? |
|---|---|---|
| Which drives exist, labels, link, public or private | Sprites API (`/v1/sprites/`) | no |
| Awake or asleep, and since when | Sprites API: `status` is `running` while awake, `warm` while paused (measured 2026-09-24); `last_running_at` is when it woke, `last_warming_at` when it paused | no |
| Checkpoints | Sprites API (`/v1/sprites/<n>/checkpoints`) | not a paused one; a **cold** (stopped) one is started by it, so it is asked only on request (found on admin-p1) |
| What it runs, when nobody looked | its last "before deploy <release>" checkpoint, or a deploy the console finished | no (a floor: shown as "or later") |
| Release live, history, Claude and marble versions, sprite.env keys, Claude mode, saved keys, a Claude login, working or not, disk, documents, recent log | **Look inside**: a read-only probe run on the sprite with `sprite exec` | **yes**, so it is asked for |
| What main is, what is on it that a drive lacks | the workshop checkout (`git fetch`), cached a minute | no |
| marble on npm | `npm view`, cached ten minutes | no |
| What the console itself did | its job log, on admin-p1 | no |

A drive that is already awake is looked inside automatically (at most every
five minutes while the console is open), because an exec on a running sprite
costs nothing extra. An asleep drive shows what was seen last and when
("Looked 3 h ago · Look now").

Polling the Sprites API happens only while a console tab is connected, every
20 s; with no tab, the module does nothing and admin-p1 can sleep.

## The page

One topbar, four views, and a detail pane: the Agents page's anatomy.

**Topbar** (translucent paper, blur): *Console* at 1.15rem/500; a segmented
control **Drives · Ship · Workshop · Activity**; on the right the one filled
pill the view is for: *New drive* on Drives, *Ship* on Ship. A dot on Activity
breathes while a job runs (marked, not counted).

### Drives

A list pane and a detail pane on the well (cards, 5px gap). On a phone, the
list, and a tap slides the detail in.

- **The row:** the state dot, the sprite's name and whose it is, then one meta
  line: release, Claude (login or key), link (public or private), and the age
  on the right: *awake* or how long it has slept. Grouped: **Yours** (admin-p1,
  t-bryan) and **Testers**.
- **The dot:** asleep is the idle ring; awake is the accent, breathing; a job
  running on it is the accent breathing with the row's meta saying what
  (*Deploying 6bd7e58…*); the last job failed is danger, filled, until the
  drive is opened (seeing it is reviewing it).
- **The detail**, top to bottom:
  - *Header:* name, whose, *Open drive ↗*, awake or asleep since when, *Look now*.
  - *Release:* live release (sha, subject, when), how far behind main, the last
    three it can roll back to; *Deploy main*, *Deploy the workshop's copy*,
    *Roll back*.
  - *Health* (from the last look): working or idle (keep-awake's task), streams
    open, documents, disk used, and the log's last lines with *Read more*.
  - *Claude:* **Login · API key** segmented, what is set up (a login on the
    machine, a key saved), and how to sign in (the exact command, copyable),
    *Sign out of Claude*.
  - *Access:* the link, **Public · Private** segmented, the passphrase shown as
    dots with *Show*, *Copy* and *New passphrase*, and a note to send someone
    (link + passphrase, copyable).
  - *Settings:* the sleep and agent limits as fields with their defaults as
    placeholders, and every other `sprite.env` line (secrets shown as *set*,
    never their value). Edits collect in a bar at the foot of the pane:
    *2 changes · Apply (restarts the drive) · Discard*. On admin-p1 the bar
    says it restarts when no agent is working.
  - *Checkpoints:* the list with comments and times; *Make one*; *Restore* asks
    for the drive's name to be typed, because a restore takes the drive back
    too.
  - *Remove* (testers only): destroys the sprite after the name is typed.
- **New drive** opens a popover under the pill: person, Claude (**Key** or
  **Login**), an optional key; it provisions `t-<person>` and, when done, shows
  the note to send.

### Ship

What main is and who has it.

- **Main:** the head commit and the commits since the oldest release anywhere,
  each with the drives that lack it.
- **The fleet against main:** one row per drive: live release, *up to date* or
  *N behind*, the last deploy's result.
- **Ship** (the pill) opens the plan before it does anything, read from
  `sprite-deploy.sh --print-plan`: the release, marble and Claude versions,
  who gets it in what order (testers, then admin-p1 when no agent is working),
  and which drives skip their checkpoint and why. Its button says what it will
  do: *Ship 6bd7e58 to 6 drives*.
- **Try on t-bryan** deploys the workshop's working copy to the test drive.
- A drive whose checkpoint store is stuck (the JuiceFS `file exists` failure)
  is remembered as such and shipped with `--no-checkpoint`, saying so; *Try
  checkpoints again* clears it.

### Workshop

The two checkouts and the agent that works in them.

- **marble-drive** and **marble**, side by side: branch, head, ahead and behind
  origin, changed files. *Pull* (fast-forward only), *Run tests* (streamed).
- **marble** also has *Publish*: the next patch version in package.json and
  both plugin manifests, committed, tagged and pushed, then published (marble's
  prepublish guard and unit tests run first; npm may ask the owner to approve).
  marble-drive needs no change: it depends on `file:../marble`, and a deploy
  installs whatever version that checkout declares.
- **A workshop chat, on the page:** a live conversation (`<marble-conversation>`)
  in the Marble Drive or Marble project, with the recent workshop chats beside
  it, each opening in Agents. Asking for a change is typing it here.

### Activity

Every job, newest first: the dot, what it was (*Deploy 6bd7e58 to t-irene*),
how long, when. Selecting one opens its output, streamed while it runs, in the
mono register on paper-2, following the tail unless scrolled up; *Stop* on a
running job. admin-p1's own switch log (self-updates waiting for idle) is here
as well.

### Motion and the hand

From the design system, not invented here: a view switch crossfades in 150 ms;
rows arrive together, staggered, capped; the detail pane changes on the
room's clock (520 ms) as a crossfade, never cards flying; a popover
materialises from its trigger; a press answers on the way down, in colour; the
dot breathes on a 2 s cycle; reduced motion keeps only the crossfade. Every
control says what it will do before, and what it did at the control after
(*Deploying… → Deployed*). Consequential and irreversible acts (restore,
remove) ask for the name to be typed; nothing else asks.

## Jobs

Every action is a job: `{ id, kind, title, target, state, startedAt, endedAt,
exit, steps }`, its output kept in `/drive/.marble/console/jobs/<id>.log`
(capped at 1 MB) and streamed to the page.

- **One at a time per drive**, and one per workshop checkout; a second asks to
  wait its turn and says so.
- **Commands are argument lists**, never shell strings built from input. A
  drive's name must be one Sprites listed; a person's name is slugged the way
  `sprite-provision.sh` slugs it.
- **Secrets never reach a log.** Every value the job was given or read that is
  secret (a passphrase, a key) is replaced by `••••` in its output, and keys
  reach a tool only as a file, mode 600, removed afterwards.
- **The tools come from what is being shipped.** A deploy of main runs
  `sprite-deploy.sh` from a checkout of that commit (`/home/sprite/src/marble-drive-ship`,
  detached), so the release script and the Claude pin are the ones that commit
  carries, whatever state the workshop checkout is in. A deploy of the
  workshop's copy runs from the workshop checkout with `--local`.
- **Changing a drive's settings** rewrites its `sprite.env` from a fresh read
  (never from the page's copy), refuses a value with a comma or a newline, and
  restarts the service with a new `release.sh apply` (the live release,
  switched to again: same health check and fall-back). admin-p1 applies its
  own when no agent is working (`apply-when-idle`).
- **Claude login or key** is the drive's own Agents setting, so the job signs
  in to that drive with its passphrase and sets it, exactly as the owner's
  browser would.

## Safety

- The routes exist only with `MARBLE_DRIVE_CONSOLE=1` **and** a passphrase;
  anything else is 404, and a console with no gate refuses to start.
- Behind the gate, a changing request must come from the page's own origin
  (the `Origin` header), on top of the SameSite cookie.
- A passphrase reaches the browser only when *Show* or *Copy* is pressed, is
  never cached on disk, and is never written to a job log.
- `sprite …/services` answers with the service's environment, secrets
  included; the console never forwards it.
- admin-p1 cannot be removed or restored from the console, and never appears
  in the list *Ship* treats as testers.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `MARBLE_DRIVE_CONSOLE` | off | turn the console on (admin-p1 only) |
| `MARBLE_DRIVE_CONSOLE_ORG` | `marble-drive` | the Fly org |
| `MARBLE_DRIVE_CONSOLE_SRC` | `/home/sprite/src` | where the workshop checkouts are |
| `MARBLE_DRIVE_CONSOLE_SPRITE` | `sprite` | the Sprites CLI (tests put a fake here) |
| `MARBLE_DRIVE_CONSOLE_SELF` | the hostname | which drive this is |

## Guards

- **Unit:** the Sprites list is read into rows and nothing secret passes; a
  probe's output is split into what may be shown and what may not; sprite.env
  is patched keeping comments and order, and a comma or newline is refused;
  jobs stream, persist, redact, refuse a second job on a busy drive, and stop;
  routes are absent without the setting or the gate, and refuse a foreign
  Origin; provisioning a name slugs it; *Ship* orders testers before admin-p1
  and skips checkpoints only where they are stuck.
- **release.sh:** `apply` restarts the live release with the new settings and
  keeps the history.
- **Browser:** with a fake fleet (a fake `sprite` and fake tools), the page
  draws the rows and groups, opens a drive, collects settings edits into the
  bar and applies them as a job whose output streams into Activity, shows the
  ship plan before shipping, types-to-confirm a restore, works on a phone, in
  both schemes; screenshots at 390, 820 and 1280 wide are reviewed.
- **Real:** on admin-p1, the console lists the six drives with correct awake
  states without waking any; *Look now* on t-bryan; a settings change on
  t-bryan applies; *Try on t-bryan* deploys.

## Out of scope

- Costs in money: the Sprites API does not report usage; awake time is shown
  instead.
- Editing a person's documents from the console: their drive is theirs; *Open
  drive* is the way in.
- The front door (sign-up, accounts): still shelved.
