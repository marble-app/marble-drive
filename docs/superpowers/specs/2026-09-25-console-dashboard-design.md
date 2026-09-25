# The Console's dashboard: state, use and cost of every drive, over time

2026-09-25. Status: built and shipped to admin-p1 the same day (the owner said "ship this"). Where the build differs from the design, the section says so under *As built*. Choices were made here and
say why, per the owner's standing preference; the questions still open are at
the end.

## Why

The Console says what each drive is doing *now*. It cannot say what they did
yesterday, what that cost, or what the owner will pay this month. The first
real bill (Fly Cost Explorer, 2026-09-19 to 09-25: **$6.75**, of which RAM
$6.05, CPU $0.58, hot storage $0.11) showed the question matters and that the
guesses were off: memory is 90 % of the bill, CPU hardly counts.

**What he asked for:** track price and usage in the Console; for every sprite,
a timeline of its state (running, warm, cold) coloured by state; the total cost
and the cost of each sprite; all of it close to live; a dashboard the Console
opens on, with whatever other charts are useful.

## The constraint that shapes everything

Nothing about the fleet can be recorded by watching it from admin-p1:

- The Console polls the Sprites API only while a console tab is open, and
  admin-p1 sleeps otherwise (by design: a status page must never keep a
  machine up or wake one).
- The Sprites API answers *now* (status, `last_running_at`,
  `last_warming_at`), with no history and no usage.
- Fly has no public API for the bill. The Cost Explorer is a dashboard page;
  the GraphQL API does not document usage; the Sprites release notes list
  none (checked 2026-09-25).

So: **each drive keeps its own ledger.** A drive's host runs exactly while the
drive is awake, which is exactly while Fly bills it. It can write down, once a
minute, that it is awake, how much CPU and memory it used and why it is up,
for nothing: no wake, no connection, no second machine. The Console gathers
those ledgers when a drive is awake anyway, and adds what it saw of warm and
cold from the API. Cost is **estimated** from the ledger at Fly's rates, and
**reconciled** against the real bill when the owner pastes Cost Explorer's
text in.

*Considered and rejected:* polling from admin-p1 whenever it is awake (still
gaps whenever admin-p1 sleeps, and outbound calls every 20 s may count as
activity and keep it up all day, costing more than it measures); an external
always-on collector (a new machine to run and pay for, to watch machines that
cost ~$1 a day); waking drives to read them (the one thing the Console must
never do).

## 1. The ledger (every drive): `server/usage.js`

Every 60 s of awake time the host appends one line to
`<drive>/.marble/usage/<YYYY-MM-DD>.jsonl` (UTC day):

```json
{"t":1790000000,"dt":60,"cpu":1.84,"mem":1.62,"disk":4.9,
 "why":{"tabs":1,"looking":1,"work":0,"asks":0},"turns":0,"opens":2,"wake":null}
```

| Field | What | Read from |
|---|---|---|
| `t`, `dt` | end of the minute (unix s), awake seconds it covers (by `awake.js`, so a freeze adds nothing) | awake clock |
| `cpu` | CPU-seconds used by the whole machine in `dt` | cgroup `cpu.stat` `usage_usec` delta; else `/proc/stat` |
| `mem` | GB in use, averaged over the minute's 4 readings (every 15 s, on the awake tick) | cgroup `memory.current`; else `MemTotal − MemAvailable` |
| `disk` | GB used on the drive's filesystem | `statfs` |
| `why.tabs` | tabs holding live streams | `streams.count` |
| `why.looking` | of those, tabs that reported use in the last minute | `/tab/alive` |
| `why.work` | turns or splits holding keep-awake | `keep-awake` `held` |
| `why.asks` | turns waiting on a question | `hold.js` |
| `turns`, `opens` | agent turns started, documents opened, this minute | agents, channels |
| `wake` | on the first line after a sleep: `"warm"` (the process survived: the awake clock jumped) or `"cold"` (a new process on a fresh boot, `/proc/sys/kernel/random/boot_id` changed); a new process on the same boot is a restart (deploy, settings) and is `"restart"` | awake clock, boot id |

- ~150 bytes a line, at most 1,440 lines a day: ≤ 7 MB a month for a drive
  that never sleeps, far less in practice. Kept **90 days**, then deleted by
  the host at start-up.
- Off Linux (the Mac, tests) the readers return `null` and the line still
  records awake time and reasons.
- A write fails quietly (a full disk must not break the drive), and is
  logged once.
- **To verify first, on t-bryan:** which cgroup files exist inside a sprite,
  and whether `memory.current` tracks what Fly bills (compare a day of ledger
  against Cost Explorer's per-app view). If the VM's cgroup is not visible,
  `/proc/meminfo` is the fallback and the reconciliation factor (section 3)
  absorbs the difference.

A drive reads its own ledger at `GET /usage?since=<t>` (behind the gate), for
itself and for tests. The Console does not use HTTP to reach it (below).

## 2. Gathering it (admin-p1): `server/console/usage.js`

Two sources, merged into one store at
`/drive/.marble/console/usage/<sprite>/<YYYY-MM>.jsonl`:

- **Ledger lines**, pulled with `sprite exec` of a small reader
  (`server/console/ledger-read.mjs`, copied like the probe) that prints every
  line after a cursor the Console keeps per sprite. Pulled:
  - from every **awake** drive, every **60 s** while a console tab is open (an
    exec on a running sprite costs a second of what it already costs). With
    no tab open the Console does nothing, as today;
  - never from a warm or cold drive. Its lines wait on its own disk (90 days)
    and arrive the next time it is awake while the Console is watching.
  - admin-p1's own ledger is read from its disk directly.
- **State observations** from the Sprites API poll the Console already runs
  (every 20 s while watched): each change of `status` for a sprite is
  appended as `{"t":…, "status":"warm"}`. Only changes, so a day is a few
  dozen lines. Also on each poll, `last_running_at` and `last_warming_at`
  pin the most recent wake and pause even if the Console missed them.

The pull is a job only in the sense of being serialised per drive (it waits
for a deploy on that drive to finish); it is not shown in Activity, which is
for what the owner asked for.

## 3. From lines to answers: pure modules

### Timeline: `server/console/timeline.js`

Per sprite, a list of segments `{from, to, state}` with state `running`,
`warm`, `cold` or `unknown`:

- **running**: ledger minutes, joined when consecutive (a gap of more than
  2.5 × `dt` ends a segment). Where a drive has no ledger yet (not deployed
  with it), API observations of `running` fill in, for as long as the
  Console watched.
- **asleep** gaps between running segments are:
  - `warm` or `cold` where an API observation says so, from that
    observation until the next;
  - otherwise, by how the drive woke at the gap's end: `warm` if it woke
    warm; if it woke `cold`, the gap is warm and then cold, with the switch
    unknown, drawn as `cold` with a soft left edge and said in the tooltip
    ("stopped some time in this gap");
  - `unknown` before the first thing known.
- The last segment runs to now, from the latest status.

### Cost: `server/console/cost.js`

Rates, in one table with the dates they apply (Fly pricing and the
2026-10-01 update):

| | until 2026-09-30 | from 2026-10-01 |
|---|---|---|
| CPU | $0.07 / CPU-hour | $0.03825 |
| Memory | $0.04375 / GB-hour | $0.021875 |
| Hot storage (awake) | $0.000683 / GB-hour | same |
| Cold storage (always) | $0.000027 / GB-hour | same |

Per ledger minute, at the rate of that minute's date: `cpu` × CPU rate / 3600
(floor 0.0625 CPU for the minute, Fly's minimum while running) + `max(mem,
0.25)` × memory rate × `dt` / 3600 + `disk` × hot rate × `dt` / 3600. Cold
storage accrues on the last known `disk` for every hour of the range. Minutes
from API observations alone (no ledger) are costed at the sprite's median
awake memory and CPU, and marked *estimated from state*.

**Reconciliation.** A **Bill** box on the dashboard takes the Cost Explorer
page pasted as text (the exact shape the owner pasted on 2026-09-25: range,
total, one line per product, and, from *View per-app breakdown*, one line
per app). `server/console/bill.js` parses it into
`{from, to, total, products: {ram, cpu, hot}, apps?: {…}}`, kept in
`console/bills.jsonl`. For each product the dashboard shows billed against
estimated for that range, and the ratio. The latest ratio per product
**calibrates** every estimate and the projection, said as such ("calibrated
to your bill of Sep 25, RAM ×1.12"). A paste that does not parse says which
line it could not read; nothing is guessed.

### Projection

Month-end = month-to-date (calibrated) + the daily average of the last 7
days (calibrated, at next month's rates where the month changes rates) ×
days left. Shown with the 7-day range of daily spend as its band.

## 4. The API

- `GET /console/api/usage?range=24h|7d|30d|month` →
  `{ now, from, to, rates, bill, sprites: [{ name, role, segments,
  hours: [{t, awake, cpu, mem, cost:{ram,cpu,hot,cold}, why:{…}, turns,
  opens}], totals }], totals, projection }`. Hourly buckets for 7 d and
  longer, 5-minute buckets for 24 h. Computed on request from the store and
  cached until a new line arrives.
- `POST /console/api/bill` `{ text }` → the parsed bill or the line it
  could not read.
- `PUT /console/api/budget` `{ monthly }` → the owner's monthly budget, or
  none.
- The event stream gains `usage`: `{ sprite, lines }` as lines arrive, and
  `status` changes as the poll sees them. The page folds them into its data;
  it never refetches the range for a live update.

## 5. The page: a Dashboard view, the one the Console opens on

`VIEWS` gains **Dashboard** first; the Console opens on it (the saved view
still wins once chosen). One filter row at the top: **24 h · 7 d · 30 d ·
This month** (segmented), and the time of the last line received. Every
chart below answers to that range, is hand-built SVG in
`runtime/console-charts.js` (no library: runtime files are served as they
are, and every chart here is a few rects and paths), has a hover layer, and
has a table view (a *Table* toggle on its card) so nothing is colour alone.

Top to bottom, on the well in cards; two columns on a wide screen, one on a
phone:

1. **Numbers** (stat tiles, not charts): *Month to date* (calibrated, with
   "est." until a bill has been pasted), *Projected month end* (with its band,
   and turning caution-coloured with a mark when it passes the budget),
   *Awake now* (n of 6, their names), *Awake hours* in the range.
2. **State over time** (the one he asked for; full width). One lane per
   sprite, owner's first, then testers; each lane its name and whose, and a
   bar of segments coloured by state. The right edge is now and moves every
   second while the tab is shown. Hover a segment: state, from, to, how long,
   and for a running one its cost, peak memory and why it was up. Click a
   lane: that drive in Drives.
3. **Cost by sprite**: one horizontal bar per sprite for the range, stacked
   RAM, CPU, storage, sorted by cost, its total at the end. Hover: each part.
4. **Spend this month**: the cumulative line of calibrated spend, day by
   day; a dashed projection to the month's end with its band; the budget as a
   rule if set; pasted bills as dots at their end dates. One axis (dollars).
5. **Daily spend**: stacked columns, one per day, one colour per sprite.
6. **Why it was awake**: one 100 % bar per sprite, awake time split into
   *someone looking* (a tab with input in the minute), *a tab open, nobody
   looking*, *an agent working*, *waiting on a question*, *nothing of
   ours* (a deploy, an exec, the Console's own look). This is the chart that
   says what the keep-awake limits cost.
7. **When it is used**: hour of day × day of week, cells shaded by awake
   minutes; a picker for all drives or one.
8. **Memory** and **CPU**: two charts, never one with two axes; a line per
   sprite over the range, drawn only where the drive was awake.
9. **Activity**: agent turns and documents opened per day, a sparkline pair
   per sprite.

The **Drives** detail pane gains a *Use* section: that drive's 7-day state
strip, its month-to-date cost and projection, and its why-awake bar, drawn
by the same functions.

### Colour

Chosen by the job each colour does, and every palette run through the
dataviz validator in light and dark before shipping:

- **State** is ordered, so one hue from strong to pale: running = the
  Console's accent at full strength, warm = a mid step, cold = a pale step,
  unknown = the well with a 45° hatch. The legend names all four.
- **Sprites** are identities: a fixed categorical order assigned by creation
  date and kept (a removed tester's colour is not reused in that month's
  charts). Six drives fit in eight slots; a ninth folds into "Others".
- **Products** (RAM, CPU, storage) are three categorical slots distinct from
  the sprites', since the two never share a chart.
- The budget line and an over-budget projection use `--caution`, with a mark
  and a label.

Motion follows the Console's spec: the view crossfades in 150 ms, a live
segment grows without animating, reduced motion changes nothing else.

## 6. What it costs to run

- Drives: one small append a minute while awake; no wakes, no connections.
- admin-p1: while a console tab is open, one exec a minute per awake drive;
  nothing otherwise. The store is at most tens of MB a year.

## 7. Testing

- `test/usage.test.js`: the ledger with fake `/proc`, cgroup and statfs
  readers and a fake awake clock: minute lines, reasons, warm/cold/restart
  wake detection, 90-day pruning, a failing write.
- `test/console-timeline.test.js`, `test/console-cost.test.js`: segments
  from ledgers alone, from observations alone, and both; the cold gap with an
  unknown switch; cost across the 2026-10-01 rate change; the memory and CPU
  floors; calibration; projection across a month boundary.
- `test/console-bill.test.js`: the exact text pasted on 2026-09-25, the
  per-app view, and a paste with a line it cannot read.
- `test/console.test.js`: the new routes, the pull cursor (no line twice,
  none lost across a restart), the stream's `usage` events.
- `test-browser/console-dashboard.test.js`: the dashboard from fixture data;
  range switch; hover on a segment; a live `usage` event extends a lane
  without a refetch; the table toggle; a phone width with no sideways scroll.
- **On t-bryan:** deploy, leave it a day, compare its per-app line in Cost
  Explorer with the dashboard's estimate for the same range.

## 8. Rollout

1. Ledger + dashboard to t-bryan (`--local`), verify the cgroup readings.
2. admin-p1, where the Console runs; state history starts at once from API
   observations and admin-p1's own ledger.
3. Testers' drives get their ledgers only when the owner ships (`--all`);
   until then their lanes show what the Console observed, marked so.
4. `docs/HOSTING.md` (Costs, and the ledger in the file table) and a
   `HOSTING-DECISIONS.md` entry ("a drive keeps its own ledger").

## Not in this

- Alerts sent anywhere (a push or an email when the projection passes the
  budget). The budget is drawn, not enforced.
- Anthropic's spend. It is the larger bill, but it is not Fly's, and the
  drives on a login have no per-token record. A later section of this same
  dashboard could read the usage API for API-key drives.
- History before today: the first real line is the day this ships. The
  pasted bill of 2026-09-25 is the one fact about the past.

## Open questions for the owner

1. **Budget:** is there a monthly number to draw, or leave it unset?
2. **Tester privacy:** the dashboard shows when each friend uses their drive
   (the hour × weekday chart, per sprite). It is visible only to the owner on
   admin-p1. Keep per-person, or show testers only in aggregate?

## As built

- **Answers the open questions by default:** no budget until one is set (a
  *Set a budget* button), and each tester shown by name.
- **The page refetches instead of folding lines in.** A `usage` or `status`
  event makes the page read its range again, at most every ten seconds, and it
  reads again every minute while shown. Folding lines client-side would have
  meant a second copy of the timeline and cost code in the browser.
- **The Console always opens on the Dashboard**, as asked ("opens up to all
  visualizations"); the old remembered view no longer overrides it.
- **A sixth reason:** minutes the API saw running with no ledger line are
  *Not recorded*, not *Nothing of ours*.
- **Products are greys** (memory, CPU, storage), shown in a bar's tooltip and
  table, so they never look like a drive's colour; cold storage is folded
  into storage.
- **Cost by drive is coloured by drive**, the same colour as its lane dot,
  daily column and lines everywhere on the page.
