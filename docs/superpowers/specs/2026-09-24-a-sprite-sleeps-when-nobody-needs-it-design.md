# A sprite sleeps when nobody needs it

2026-09-24. Status: design; the owner asked for it to be built once written.

## Why

A sprite bills for the CPU and memory it actually uses, and only while it runs
(Fly: "a four-hour Claude Code session averaging 30% of 2 CPUs and 1.5 GB comes
to $0.44"). It runs while anything holds it up: an inbound connection to its
URL, an open `sprite exec` or console session, or a Sprites task (what the
host's keep-awake holds while work runs). The goal:

**No sprite runs without a person using it or a piece of work making progress,
and even working, not more than a day unattended.**

Two rules the owner set:

- **Freeze, never kill.** A limit only stops holding the sprite awake. The
  sprite pauses, its processes freeze in place, and they carry on when someone
  opens the drive. Hitting a limit costs time, never work.
- **Long jobs are real.** Agents and lab scientists run jobs for hours, often
  silently (one command doing a long analysis). A limit must tell *stuck* from
  *working*, not *short* from *long*.

## Two things found while designing

1. **The existing stall rule kills long silent work.** The runner fails a turn
   after 30 minutes with no output from the CLI
   (`MARBLE_DRIVE_AGENT_STALL_MINUTES`). A turn running one quiet 3-hour
   command is ended as "stalled".
2. **A frozen sprite's timers fire on waking.** When a paused sprite resumes,
   overdue `setTimeout`s fire at once, so a turn frozen overnight would be
   "stalled" the moment its owner opens the drive. Every limit has to count
   **awake time**, not wall time.

## Every hole, and what closes it

| # | What holds a sprite up | Closed by |
|---|---|---|
| 1 | A hidden tab's live streams | tab-rest (1): streams close after 60 s hidden |
| 2 | A visible tab nobody is using | tab-rest (1): 10 min without input counts as away |
| 3 | A tab opened before this change (old code reconnects forever) | the host's stream rule (2) |
| 4 | An agent waiting for an answer nobody gives | keep-awake (3): released after 10 min unanswered |
| 5 | A turn that is stuck (no output, no CPU, no disk) | keep-awake (3): released after 30 min without progress |
| 6 | A turn or job still working a full day, nobody visiting | keep-awake (3): released after 24 h |
| 7 | A stem split that hangs | keep-awake (3): the same progress rule |
| 8 | A paused, stopped or queued turn | holds nothing today; tested |
| 9 | The self-update switcher | holds nothing; gives up after 2 h |
| 10 | A crash while a task is held | the task expires by itself after 5 min |
| 11 | A `sprite console` / `exec` left open | outside Marble: documented in HOSTING.md |
| 12 | Strangers or bots on a public URL | the gate answers at once; each wakes the sprite briefly (the front door fixes it) |

## Design

### 1. Tab-rest: `runtime/tab-rest.js`, injected first on every page

- Wraps `window.EventSource` before any other script runs, so every stream a
  page opens (Marble's document stream, the Drive's folder stream, agent
  streams) goes through it. Each wrapper keeps the page's listeners; underneath
  it holds a real `EventSource` or none.
- **Rests** (closes every stream underneath) when the tab has been hidden for
  60 s, or visible with no input (pointer, key, wheel, touch, scroll, focus)
  for 10 min.
- **Wakes** on the next input or on becoming visible: each stream reopens at the
  same address and catches up. Agent streams reopen from the last event they saw
  (`after=<id>`: the server already replays). Every other stream gets one
  synthetic "changed" signal: Marble's carrier re-reads the file, and the Drive
  redraws.
- A page closing a stream itself (the Agents page does, when hidden) closes it
  for good; only a rest is temporary.
- Reports it is in use: while awake and used, it sends `POST /tab/alive` at
  most once a minute, and it tags every stream's address with its tab id
  (`tab=<id>`), so the host can tell a used tab from a forgotten one (2).
- The agent drawer's usage meter polls only while the tab is awake.

### 2. The host's stream rule: `server/streams.js`

Every live stream (`/events` for documents and the drive, `/agent/events`)
registers with one registry:

- A stream whose tab has not reported use in **15 min** is closed. A stream
  with no tab id (a page from before this change) counts as unused.
- A reconnect from a tab that has not reported use in 15 min is answered
  `204 No Content`, which tells a browser's `EventSource` to stop
  reconnecting. An old tab goes quiet until reloaded; a current tab reopens by
  itself when used again.

### 3. Keep-awake by progress, in awake time

Keep-awake holds the sprite while at least one piece of work is **held**. A
running turn is held unless:

- it has an unanswered question and it has been **10 min** (awake time) since
  it was asked;
- it has made **no progress for 30 min** (awake time). Progress is any event
  from the CLI, or any growth in CPU time or disk I/O of its process tree
  (`/proc/<pid>/stat` and `/proc/<pid>/io`, summed over the tree, sampled every
  minute), so a long silent command counts as working;
- it has been held for **24 h** (awake time) since anyone last used the drive.

A stem split is held under the same progress and 24 h rules. When nothing is
held, keep-awake releases its task and the sprite pauses about 30 s later. Any
use of the drive (a tab's `/tab/alive`) resets the 24 h clock.

**Awake time.** The host keeps one clock that only advances while the process
runs: a 15 s tick adds the time since the last tick, capped at two ticks, so the
gap of a freeze adds nothing. Every limit above, and the runner's stall rule,
read this clock.

### 4. The stall rule stops killing working turns

The runner's stall timer uses the same progress signal and the awake clock:
a turn is ended as stalled only after 30 min of awake time with no events and no
CPU or disk activity. A turn frozen by a paused sprite is never stalled on
waking. `MARBLE_DRIVE_AGENT_MAX_MINUTES` stays off by default.

### 5. Settings

In a sprite's `sprite.env`, with these defaults:

| Setting | Default |
|---|---|
| `MARBLE_DRIVE_TAB_HIDDEN_SECONDS` | 60 |
| `MARBLE_DRIVE_TAB_IDLE_MINUTES` | 10 |
| `MARBLE_DRIVE_STREAM_UNUSED_MINUTES` | 15 |
| `MARBLE_DRIVE_ASK_HOLD_MINUTES` | 10 |
| `MARBLE_DRIVE_NO_PROGRESS_MINUTES` | 30 |
| `MARBLE_DRIVE_AWAKE_MAX_HOURS` | 24 |

The page reads its two from the host (served with the page), so one setting
changes both sides.

## Guards

- **tab-rest** (browser): after the hidden and idle limits (shortened), the
  host's `/health` stream count reaches 0; on input it returns; a document
  changed while resting is shown after waking; an agent conversation that ran
  while resting replays what was missed; a page's own `close()` stays closed.
- **streams** (unit): an unused tab's stream is closed; a stream without a tab
  id is treated as unused; a reconnect from an unused tab gets 204; a used tab's
  stream stays.
- **keep-awake** (unit, fake clock and a fake process table): holds a
  progressing turn; releases after 30 awake-min without progress; a turn whose
  process tree uses CPU but prints nothing stays held; releases 10 min after an
  unanswered question; releases after 24 h; a freeze gap adds no awake time;
  `/tab/alive` resets the 24 h clock.
- **stall** (unit): a quiet turn with CPU activity is not stalled; a thawed
  turn is not stalled on waking.
- **Real run** on `t-bryan`: a tab left hidden lets the sprite pause (the
  Sprites task list is empty and the host sees a freeze gap); an agent turn
  running a silent 40-minute command with every tab closed completes.

## Out of scope

- Sprite-level spend limits in Fly itself (checked separately).
- The front door, rate limiting strangers.
- Per-person budgets (part of limits and cost).
