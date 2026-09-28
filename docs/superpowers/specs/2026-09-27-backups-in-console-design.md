# Backups in the Console

2026-09-27. The owner asked for controls for the Mac's backups of admin-p1
(`tools/drive-backup.sh`, HOSTING-DECISIONS 24) inside Marble Drive, in the
drive on the VM, organised the way the Console already is.

## What it is for

The priority is crash safety: a copy that keeps up with admin-p1 off Fly. The
two ways that fails are backups stopping without anyone noticing, and a
restore that needs a terminal. So the page has to (1) say plainly whether
backups are keeping up, and (2) back up, pause the schedule and restore from
it.

## Where it lives

A **Backups** view in the Console on admin-p1, beside Drives. The Console is
already where every drive and everything done to them lives; checkpoints are
there, and backups are the same kind of thing, kept somewhere else.

## The one hard part: the backups are on the Mac, the page is on the sprite

admin-p1 cannot reach the Mac. The Mac can reach admin-p1 (`sprite exec`), and
already does every 15 minutes. So the Mac is the one that talks:

- **A backup agent on the Mac** (`tools/backup-agent.mjs`, launchd, every
  minute). Each run asks the Sprites API about admin-p1, which wakes nothing.
  Only when admin-p1 is running (awake anyway), or right after it backed it
  up, does it touch the sprite: one `sprite exec` reads the Console's requests
  and writes a **report**. So a page open on admin-p1 hears from the Mac within
  a minute, and a sleeping admin-p1 is never woken to be told nothing.
- **The report** (`/drive/.marble/console/backups/<sprite>.json`): which
  machine, when it last checked in, the schedule, the last backup and its
  error, every kept snapshot (time, documents, bytes added, why), disk used and
  free, and the results of recent requests.
- **Requests** (`/drive/.marble/console/backups/requests/<id>.json`, one JSON
  line each), written by the Console: back up now, schedule on/off, restore a
  snapshot onto a drive. The agent removes a request before acting on it, and
  keeps the ids it has handled on the Mac, and ignores requests older than an
  hour, so a snapshot that happens to contain a pending request can never
  replay it after a restore.
- **The schedule** is a flag on the Mac (`~/Marble Backups/<sprite>/.schedule-off`),
  not the launchd job: turned off, the agent still checks in and still takes
  requests, so the page can turn it back on.

`tools/drive-backup.sh` keeps its rules (`--if-changed`), gains `--every <min>`
(how often while the sprite is awake, 15) and writes one line per snapshot to
`.snapshots.jsonl`, so nothing has to measure a 2 GB tree to draw the page.

## The view

- **The drive's card**: backed up to which Mac; Schedule On/Off; Back up now.
  One line: last backup and why, how many kept, space on the Mac, when the Mac
  last checked in.
- **Warnings**: the Mac has not checked in for 5 minutes while this page is
  open (it should, every minute, while admin-p1 is awake): asleep, off, or
  failing. The last backup failed: the error. Both also mark the tab.
- **Waiting for the Mac**: requests not yet picked up, with Withdraw; recent
  results under them.
- **Snapshots**: newest first, grouped the way they are kept (today, then
  days, then months): time, documents, what it added, why. **Restore…** asks
  for the target drive (this one by default) and its name typed to confirm.
  Restoring admin-p1 from its own page says what happens: the page goes away
  for a few minutes, agents working here stop, the drive now is set aside on
  the sprite, never deleted.
- **If this drive is down**: the terminal command for the Mac, with Copy.

## Not now

A Console on the Mac (the fallback room while admin-p1 is down; the terminal
covers it), backing up friends' drives, browsing inside a snapshot, Finder.

## Tests

`test/console-backups.test.js` (reports and requests, validation, routes),
`test/backup-agent.test.js` (the agent's decisions against a fake `sprite` and
fake backup tools), `test-browser/console-backups.test.js` (the view from a
seeded report), and one real run against t-bryan.

## Revised the same day: one copy, history on Fly, backups after changes

The owner found dated snapshots every 15 minutes too many and too often. Now
the Mac keeps one copy (`~/Marble Backups/<utc>/`, linked from `~/Marble
Drive`, carrying `.marble/sync.json`), each backup makes a Fly checkpoint first,
and a backup is due only after a real change in the drive: 10 quiet minutes
after it, hourly while changes keep coming, once as it goes to sleep with
changes. The agent learns of changes from its minute check-in (the newest file
time outside the ledger and the Console's own files). The view's snapshot list
became **On the Mac** (the copy, Restore…) and **History on Fly** (checkpoints,
Restore… as a request the Mac carries out, after checkpointing what is there).
