#!/usr/bin/env python3
"""The idle cut: hide chats nobody has touched in a while, on a slider.

Run on templates/agents.mrbl, then on drive/Agents.mrbl. Every substitution
asserts it matched exactly once, so a mismatch fails loudly instead of landing
crooked. No data-marble-id is touched: the control is page chrome, built by the
page's own script, and only two addressed elements are added.

    python3 scratchpad/idle-filter-patch.py templates/agents.mrbl --write
"""
import random
import re
import sys

# ---------------------------------------------------------------- 1. the CSS

CSS_OLD = """  .filter-clear:hover, .filter-clear:focus-visible { text-decoration: underline; outline: none; }
"""

CSS_NEW = """  .filter-clear:hover, .filter-clear:focus-visible { text-decoration: underline; outline: none; }
  /* The idle cut. Its value is a duration, and the durations that matter here
     run from five minutes to a fortnight — a range no linear track can hold.
     So the track carries the logistic of the log: position is a sigmoid over
     log-duration, normalised so the ends land exactly on five minutes and
     12.5 days and the middle of the track lands on five hours. The hours,
     where the answer usually is, get the middle half of the track; the
     extremes stay reachable in the last few millimetres. Past the left end is
     one hard stop for All chats.
     Behind the thumb, one bar per slice of that same axis, so the slider is
     read against the chats it is about to hide rather than against nothing:
     every bar to the left of the thumb is a chat going away. */
  .idle { width: 100%; display: flex; flex-direction: column; gap: .25rem; }
  .idle-hist { display: flex; align-items: flex-end; gap: 1px; height: 2.1rem; padding: 0 7px; }
  .idle-hist > i {
    flex: 1 1 0; min-width: 0; height: 2px; border-radius: 2px 2px 0 0;
    background: var(--accent);
    transition: height var(--t) var(--settle), background var(--t) var(--settle);
  }
  .idle-hist > i[data-cut] { background: var(--line); }
  .idle-hist > i[data-empty] { background: var(--paper-3); }
  .idle-range {
    appearance: none; -webkit-appearance: none;
    width: 100%; margin: 0; padding: 0; height: 14px; background: none; cursor: pointer;
  }
  .idle-range::-webkit-slider-runnable-track {
    height: 3px; border-radius: 999px;
    background: linear-gradient(to right, var(--line) 0 var(--idle-p, 50%), var(--accent) var(--idle-p, 50%) 100%);
  }
  .idle-range::-moz-range-track {
    height: 3px; border-radius: 999px;
    background: linear-gradient(to right, var(--line) 0 var(--idle-p, 50%), var(--accent) var(--idle-p, 50%) 100%);
  }
  .idle-range::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5.5px;
    border-radius: 50%; background: var(--card);
    border: 1px solid var(--line); box-shadow: var(--shadow-lift);
  }
  .idle-range::-moz-range-thumb {
    width: 14px; height: 14px; box-sizing: border-box;
    border-radius: 50%; background: var(--card);
    border: 1px solid var(--line); box-shadow: var(--shadow-lift);
  }
  .idle-range:focus-visible { outline: none; }
  .idle-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--accent-soft); }
  .idle-range:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px var(--accent-soft); }
  .idle-scale { display: flex; align-items: baseline; gap: .4rem; font-size: .68rem; color: var(--faint); }
  .idle-scale > span:first-child, .idle-scale > span:last-child { flex: none; }
  .idle-said { flex: 1; text-align: center; color: var(--muted); font-variant-numeric: tabular-nums; }
  .idle-read { color: var(--ink); font-weight: 500; }
  @media (prefers-reduced-motion: reduce) { .idle-hist > i { transition: none; } }
"""

# ------------------------------------------------------------- 2. the markup

MARKUP_OLD = """      <div class="filter-row" data-marble-id="__ID__">
        <span class="filter-name" data-marble-id="__ID__">Agent</span>
        <div class="seg cli" role="group" aria-label="CLI" data-marble-transient></div>
      </div>
"""

MARKUP_NEW = """      <div class="filter-row" data-marble-id="__ID__">
        <span class="filter-name" data-marble-id="__ID__">Agent</span>
        <div class="seg cli" role="group" aria-label="CLI" data-marble-transient></div>
      </div>
      <!-- The slider and its histogram are the page's, built by the script the
           way the Agent segment above is: what is hiding what is a filter, and
           a filter is never written into this file. -->
      <div class="filter-row" data-filter-row="idle" data-marble-id="__ID__">
        <span class="filter-name" data-marble-id="__ID__">Idle</span>
      </div>
"""

# ------------------------------------------------- 3. the scale and the rule

SCALE_OLD = """      if (s < 86400) return Math.round(s / 3600) + 'h';
      return Math.round(s / 86400) + 'd';
    };
"""

SCALE_NEW = """      if (s < 86400) return Math.round(s / 3600) + 'h';
      return Math.round(s / 86400) + 'd';
    };

    // ---- The idle cut. A chat nobody has touched in a while is clutter, so
    // the list hides one past a cut you set. It hides rather than files:
    // Archive is a decision a person made about one conversation, and a clock
    // is not allowed to make that decision for them forty times over. Moving
    // the slider back brings every one of them straight back.
    //
    // The scale. Position runs 0 at the left to 1 at the right and the cut
    // runs the other way — five minutes at the right end, 12.5 days at the
    // left, and one hard stop past that for All chats. Between them the
    // position is the *logistic* of the log-duration, normalised so the ends
    // land exactly on their durations and the middle of the track lands on
    // five hours. Log alone would spend as much track on the difference
    // between nine and twelve days as on the difference between one and five
    // hours; the sigmoid buys that track back for the hours, where the answer
    // to "how long before this is stale" actually lives.
    const IDLE_KEY = 'marble-agents:idle';
    const IDLE_MIN = 5;                                 // minutes, the right end
    const IDLE_MID = 5 * 60;                            // the middle of the track, and the default
    const IDLE_MAX = (IDLE_MID * IDLE_MID) / IDLE_MIN;  // 18000 min — as far above the middle as IDLE_MIN is below
    const IDLE_K = 6;                                   // how hard the S bends
    const IDLE_STEPS = 1000;
    const IDLE_BUCKETS = 32;
    const IDLE_SPAN = Math.log(IDLE_MAX / IDLE_MIN);
    const sigmoid = (x) => 1 / (1 + Math.exp(-x));
    const IDLE_S0 = sigmoid(-IDLE_K / 2);
    const IDLE_S1 = sigmoid(IDLE_K / 2);
    /** Track position (0 left … 1 right) → minutes. */
    const idleMinutesAt = (t) => {
      const p = IDLE_S0 + (1 - Math.min(1, Math.max(0, t))) * (IDLE_S1 - IDLE_S0);
      return IDLE_MIN * Math.exp((0.5 + Math.log(p / (1 - p)) / IDLE_K) * IDLE_SPAN);
    };
    /** Its inverse: minutes → track position. */
    const idlePositionOf = (minutes) => {
      const clamped = Math.min(IDLE_MAX, Math.max(IDLE_MIN, minutes));
      const s = Math.log(clamped / IDLE_MIN) / IDLE_SPAN;
      return 1 - (sigmoid(IDLE_K * (s - 0.5)) - IDLE_S0) / (IDLE_S1 - IDLE_S0);
    };
    /** The durations a person would name out loud. A drag that lands within a
     *  hair of one takes it, so the cut reads '1 day' rather than '23.7 hr'. */
    const IDLE_STOPS = [5, 10, 15, 30, 45, 60, 120, 180, 300, 480, 720, 1440, 2880, 5760, 10080, IDLE_MAX];
    const idleSnap = (minutes) => {
      const t = idlePositionOf(minutes);
      let best = null;
      for (const stop of IDLE_STOPS) {
        const gap = Math.abs(idlePositionOf(stop) - t);
        if (gap < 0.012 && (!best || gap < best.gap)) best = { stop, gap };
      }
      return best ? best.stop : minutes;
    };
    const idleLabel = (minutes) => {
      if (minutes == null) return 'All chats';
      if (minutes < 60) return `${Math.round(minutes)} min`;
      const hours = minutes / 60;
      if (hours < 24) return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} hr`;
      const days = hours / 24;
      const n = days < 10 ? Math.round(days * 10) / 10 : Math.round(days);
      return `${n} ${n === 1 ? 'day' : 'days'}`;
    };
    let idleCut = (() => {
      const saved = recalled(IDLE_KEY);
      if (saved === 'all') return null;
      const n = Number(saved);
      return Number.isFinite(n) && n > 0 ? Math.min(IDLE_MAX, Math.max(IDLE_MIN, n)) : IDLE_MID;
    })();
    /** Last touched, by you or by the agent — whichever is later. */
    const idleTouchedAt = (summary) => Math.max(
      summary?.lastInteractedAt ?? 0,
      summary?.updatedAt ?? 0,
      summary?.lastFinishedAt ?? 0,
      summary?.createdAt ?? 0,
    );
    /** Live work is never stale: something running, queued, or waiting on an
     *  answer is the opposite of an unused chat however long ago it started,
     *  and the conversation you have open is not clutter either. A clock that
     *  closed what you were reading would be a filter fighting you. */
    const idleHides = (summary, cut = idleCut, now = Date.now()) => {
      if (cut == null || !summary || summary.archived) return false;
      if (summary.id && summary.id === openId) return false;
      if (summary.running || summary.queued || summary.asking || summary.status === 'running') return false;
      const touched = idleTouchedAt(summary);
      return touched > 0 && now - touched > cut * 60_000;
    };
    // The page's own, not a runtime module: exposed so the scale can be read
    // back and checked without a pointer in the way.
    window.marbleAgentIdle = {
      MIN: IDLE_MIN, MID: IDLE_MID, MAX: IDLE_MAX, K: IDLE_K, STEPS: IDLE_STEPS,
      BUCKETS: IDLE_BUCKETS, STOPS: IDLE_STOPS,
      minutesAt: idleMinutesAt, positionOf: idlePositionOf,
      snap: idleSnap, label: idleLabel, hides: idleHides,
      cut: () => idleCut,
    };
"""

# ------------------------------------------------------------ 4. the control

CONTROL_OLD = """    clearFilters.textContent = 'Clear filters';
    filterFoot.append(clearFilters);
    let filterOpen = false;
"""

CONTROL_NEW = """    clearFilters.textContent = 'Clear filters';
    filterFoot.append(clearFilters);
    let filterOpen = false;

    // The idle cut's control: a histogram of how long ago each chat was last
    // touched, with the cut standing in it. All of it is built rather than
    // written down, like the Agent segment it sits under.
    const idleRow = document.querySelector('.filter-row[data-filter-row="idle"]');
    const idleRead = document.createElement('span');
    idleRead.className = 'idle-read';
    idleRead.setAttribute('data-marble-transient', '');
    idleRow?.querySelector('.filter-name')?.append(idleRead);
    const idleEl = document.createElement('div');
    idleEl.className = 'idle';
    idleEl.setAttribute('data-marble-transient', '');
    const idleHist = document.createElement('div');
    idleHist.className = 'idle-hist';
    idleHist.setAttribute('aria-hidden', 'true');
    const idleBars = [];
    for (let i = 0; i < IDLE_BUCKETS; i += 1) {
      const bar = document.createElement('i');
      idleBars.push(bar);
      idleHist.append(bar);
    }
    const idleRange = document.createElement('input');
    idleRange.className = 'idle-range';
    idleRange.type = 'range';
    idleRange.min = '0';
    idleRange.max = String(IDLE_STEPS);
    idleRange.step = '1';
    idleRange.setAttribute('aria-label', 'Hide chats idle longer than');
    const idleScale = document.createElement('div');
    idleScale.className = 'idle-scale';
    const [, idleSaid] = ['All chats', '', `${IDLE_MIN} min`].map((text) => {
      const span = document.createElement('span');
      span.textContent = text;
      idleScale.append(span);
      return span;
    });
    idleSaid.className = 'idle-said';
    idleEl.append(idleHist, idleRange, idleScale);
    idleRow?.append(idleEl);

    /** One bar per slice of the axis the thumb runs on, so where a bar falls
     *  relative to the thumb *is* the answer to "does this one go?". Anything
     *  idle longer than the left end piles into the first bucket; anything
     *  touched in the last five minutes into the last. */
    const idleBuckets = (now) => {
      const counts = new Array(IDLE_BUCKETS).fill(0);
      for (const summary of summaries.values()) {
        if (summary.archived) continue;
        const touched = idleTouchedAt(summary);
        if (!touched) continue;
        const at = idlePositionOf(Math.max(0, now - touched) / 60_000);
        counts[Math.min(IDLE_BUCKETS - 1, Math.max(0, Math.floor(at * IDLE_BUCKETS)))] += 1;
      }
      return counts;
    };

    let idleHidden = new Set();
    const paintIdle = () => {
      const position = idleCut == null ? 0 : idlePositionOf(idleCut);
      idleRange.value = String(Math.round(position * IDLE_STEPS));
      idleEl.style.setProperty('--idle-p', `${(position * 100).toFixed(2)}%`);
      const said = idleCut == null ? 'never hidden' : `hidden after ${idleLabel(idleCut)}`;
      idleRange.setAttribute('aria-valuetext', said);
      idleRead.textContent = ` \\u00b7 ${said}`;
      const counts = idleBuckets(Date.now());
      const tallest = Math.max(1, ...counts);
      // A bar is cut when its middle is left of the thumb, not its edge: the
      // edge rule turns the exact midpoint into a rounding error you can see.
      const edge = position * IDLE_BUCKETS - 0.5;
      counts.forEach((n, i) => {
        const bar = idleBars[i];
        bar.style.height = n ? `${Math.max(12, Math.round((n / tallest) * 100))}%` : '2px';
        bar.toggleAttribute('data-empty', n === 0);
        bar.toggleAttribute('data-cut', idleCut != null && i < edge);
      });
      idleSaid.textContent = idleHidden.size ? `${idleHidden.size} hidden` : '';
    };

    const setIdleCut = (minutes, { save = true } = {}) => {
      idleCut = minutes == null ? null : Math.min(IDLE_MAX, Math.max(IDLE_MIN, minutes));
      if (save) remember(IDLE_KEY, idleCut == null ? 'all' : String(Math.round(idleCut)));
      applyFilters();
    };

    idleRange.addEventListener('input', () => {
      const step = Number(idleRange.value);
      setIdleCut(step <= 0 ? null : idleSnap(idleMinutesAt(step / IDLE_STEPS)));
    });
    // Arrow keys walk the named stops rather than the thousand steps under
    // them: one step is a tenth of a percent of the track, and inside a snap
    // zone it would move nothing at all.
    idleRange.addEventListener('keydown', (event) => {
      const back = event.key === 'ArrowLeft' || event.key === 'ArrowDown';
      const on = event.key === 'ArrowRight' || event.key === 'ArrowUp';
      const home = event.key === 'Home';
      const end = event.key === 'End';
      if (!back && !on && !home && !end) return;
      event.preventDefault();
      if (home) return setIdleCut(null);
      if (end) return setIdleCut(IDLE_MIN);
      const ladder = [null, ...[...IDLE_STOPS].reverse()];
      const at = (stop) => (stop == null ? 0 : idlePositionOf(stop));
      const here = idleCut == null ? 0 : idlePositionOf(idleCut);
      let index = 0;
      for (let i = 1; i < ladder.length; i += 1) {
        if (Math.abs(at(ladder[i]) - here) < Math.abs(at(ladder[index]) - here)) index = i;
      }
      setIdleCut(ladder[Math.min(ladder.length - 1, Math.max(0, index + (on ? 1 : -1)))]);
    });
    // A range with no value painted sits at its own midpoint, which is not the
    // cut; the first listing is a long way off on a cold drive.
    paintIdle();
"""

# --------------------------------------------- 5. the rule, and the counting

MATCHES_OLD = """      if (cli !== 'all' && summary.provider !== cli) return false;
      return true;
    };

    const applyFilters = () => {
      paintFilterState();
      for (const [id, el] of nodes) el.hidden = !matches(summaries.get(id));
"""

MATCHES_NEW = """      if (cli !== 'all' && summary.provider !== cli) return false;
      if (idle && idleHides(summary)) return false;
      return true;
    };

    /** What the cut alone is hiding — the chats every other filter would have
     *  shown. That is the number worth putting on the button, because it is
     *  the one a person cannot otherwise see the reason for. */
    const idleHiddenNow = () => {
      const hidden = new Set();
      if (idleCut == null) return hidden;
      for (const [id, summary] of summaries) {
        if (idleHides(summary) && matches(summary, { idle: false })) hidden.add(id);
      }
      return hidden;
    };

    // A cut is a claim about the clock, so it has to be re-asked as the clock
    // moves. Without this a chat crosses five hours while you are looking at
    // the list and stays on it until something else happens to repaint.
    const idleSweep = () => {
      if (idleCut == null) return;
      const next = idleHiddenNow();
      if (next.size === idleHidden.size && [...next].every((id) => idleHidden.has(id))) return;
      applyFilters();
    };
    setInterval(idleSweep, 60_000);

    const applyFilters = () => {
      idleHidden = idleHiddenNow();
      paintFilterState();
      for (const [id, el] of nodes) el.hidden = !matches(summaries.get(id));
"""

SIGNATURE_OLD = """    const matches = (summary) => {
      if (!summary) return false;
"""

SIGNATURE_NEW = """    const matches = (summary, { idle = true } = {}) => {
      if (!summary) return false;
"""

# ------------------------------------------------ 6. the button, and clearing

ACTIVE_OLD = """      query ? `\\u201c${search.value.trim()}\\u201d` : '',
    ].filter(Boolean);
"""

ACTIVE_NEW = """      query ? `\\u201c${search.value.trim()}\\u201d` : '',
      idleHidden.size ? `${idleHidden.size} idle hidden` : '',
    ].filter(Boolean);
"""

PAINT_OLD = """      filterFoot.hidden = !active.length;
    };
"""

PAINT_NEW = """      filterFoot.hidden = !active.length;
      paintIdle();
    };
"""

CLEAR_OLD = """      cli = 'all';
      remember(CLI_KEY, null);
      deriveCli();
      await setFilter('all');
"""

CLEAR_NEW = """      cli = 'all';
      remember(CLI_KEY, null);
      deriveCli();
      idleCut = null;
      remember(IDLE_KEY, 'all');
      await setFilter('all');
"""

# The live doc holds real ids where the template holds __ID__, so the one hunk
# that adds markup is matched by shape there and its two new ids are minted.
MARKUP_LIVE_RE = re.compile(
    r'(      <div class="filter-row" data-marble-id="[^"]+">\n'
    r'        <span class="filter-name" data-marble-id="[^"]+">Agent</span>\n'
    r'        <div class="seg cli" role="group" aria-label="CLI" data-marble-transient></div>\n'
    r'      </div>\n)'
)


def markup_live(src):
    taken = set(re.findall(r'data-marble-id="([^"]+)"', src))
    fresh = []
    while len(fresh) < 2:
        mint = ''.join(random.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(8))
        if mint not in taken and mint not in fresh:
            fresh.append(mint)
    tail = MARKUP_NEW[len(MARKUP_OLD):].replace('__ID__', '{}').format(*fresh)
    hits = MARKUP_LIVE_RE.findall(src)
    if len(hits) != 1:
        raise SystemExit(f'markup: matched {len(hits)} times, wanted exactly 1')
    return MARKUP_LIVE_RE.sub(lambda m: m.group(1) + tail, src, count=1)


EDITS = [
    ('css', CSS_OLD, CSS_NEW),
    ('markup', MARKUP_OLD, MARKUP_NEW),
    ('scale', SCALE_OLD, SCALE_NEW),
    ('control', CONTROL_OLD, CONTROL_NEW),
    ('matches-signature', SIGNATURE_OLD, SIGNATURE_NEW),
    ('matches-rule', MATCHES_OLD, MATCHES_NEW),
    ('active-filters', ACTIVE_OLD, ACTIVE_NEW),
    ('paint-filter-state', PAINT_OLD, PAINT_NEW),
    ('clear-filters', CLEAR_OLD, CLEAR_NEW),
]


def main():
    target = sys.argv[1]
    write = '--write' in sys.argv
    src = open(target, encoding='utf-8').read()
    before = len(src)
    # An open page merges a write selectively: it adopts new addressed markup
    # and throws away every <style>/<script> hunk, because those carry no id.
    # So the second write has to be able to carry only what is still missing.
    for name, old, new in EDITS:
        if name == 'markup':
            if 'data-filter-row="idle"' in src:
                print(f'  {name}: already there')
                continue
            if '__ID__' not in src:
                src = markup_live(src)
                continue
        if old not in src and new in src:
            print(f'  {name}: already there')
            continue
        hits = src.count(old)
        if hits != 1:
            raise SystemExit(f'{name}: matched {hits} times in {target}, wanted exactly 1')
        src = src.replace(old, new, 1)
    print(f'{target}: {before} -> {len(src)} bytes, {len(EDITS)} edits')
    if write:
        open(target, 'w', encoding='utf-8').write(src)
        print('written')
    else:
        print('dry run (pass --write)')


main()
