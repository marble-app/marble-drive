#!/usr/bin/env python3
"""Patch drive/drive.mrbl with the almanac: four readings of Bryan's Days.

Touches only the <style> and <script> blocks (no addressed markup), so a
running host accepts the write and the open tab reloads itself. Every anchor
is asserted to occur exactly once before the replacement is made.

    python3 tools/patch-days-almanac.py <src.mrbl> <dst.mrbl>
"""
import sys

src_path, dst_path = sys.argv[1], sys.argv[2]
src = open(src_path, encoding='utf-8').read()


def once(hay, needle):
    n = hay.count(needle)
    assert n == 1, f'expected exactly one occurrence, found {n}: {needle[:70]!r}'


def replace_once(hay, needle, repl):
    once(hay, needle)
    return hay.replace(needle, repl)


def between(hay, start, end):
    """The slice from `start` up to (not including) `end`; both must be unique."""
    once(hay, start)
    once(hay, end)
    a = hay.index(start)
    b = hay.index(end)
    assert a < b
    return hay[a:b]


# ------------------------------------------------------------------- the CSS
D = 'body[data-view] .items[data-rep="days"]'
CSS = r'''
  /* ---------------------------------------------------------- the almanac */
  /* The days behind today, read four ways. A day is not a file: it was
     written for one morning and marked by the person who read it — ticks,
     stars, thumbs, notes in his own words — and the folder reads those marks
     back instead of counting nodes. The readings are words, not icons, and
     appear only here, so nothing elsewhere in the Drive changes meaning. */
  .days-bar { display: flex; align-items: center; gap: 1rem; margin: 1.7rem 0 .7rem; flex-wrap: wrap; }
  .days-bar .days-head { margin: 0; }
  .days-seg { display: inline-flex; gap: .1rem; padding: .15rem; border-radius: 999px; background: var(--paper-3); }
  .days-seg button {
    appearance: none; border: 0; background: none; font: inherit; font-size: .78rem; font-weight: 500;
    color: var(--muted); padding: .26rem .72rem; border-radius: 999px; cursor: pointer;
  }
  .days-seg button:hover { color: var(--ink); }
  .days-seg button[aria-pressed="true"] { background: var(--card); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.1); }
  .days-note { margin-left: auto; font-size: .74rem; color: var(--faint); font-variant-numeric: tabular-nums; }
  .days-reading { animation: arrive var(--t-slow) var(--settle) backwards; }
  .days-empty {
    padding: 1.3rem 1.4rem; border-radius: 14px; color: var(--faint); font-size: .86rem;
    border: 1.5px dashed color-mix(in srgb, var(--faint) 42%, transparent);
  }

  /* A cover. The palette is the one thing that makes two days look different
     at a glance; the push is what the morning asked; the facts are the marks
     he left. Everything fades in when the day has been read, and a day with
     no marks says nothing rather than "0". */
  .day-pal { display: inline-flex; gap: .18rem; margin-left: auto; align-self: center; opacity: 0; transition: opacity var(--t-slow) var(--settle); }
  .day-pal i { width: .55rem; height: .55rem; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.07); }
  .day-card[data-digest="1"] .day-pal { opacity: 1; }
  .day-card.is-today .day-pal { margin: .5rem 0 0; }
  .day-card.is-today .day-pal i { width: .7rem; height: .7rem; }
  .day-push {
    font-size: .78rem; color: var(--muted); line-height: 1.35;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .day-push:empty { display: none; }
  .day-card.is-today .day-push { font-size: .92rem; -webkit-line-clamp: 3; margin-top: .1rem; }
  .day-facts { display: flex; flex-wrap: wrap; gap: .1rem .6rem; font-size: .74rem; color: var(--faint); font-variant-numeric: tabular-nums; }
  .day-facts:empty { display: none; }
  .day-facts .fact i { font-style: normal; font-size: .68rem; opacity: .85; }
  .day-facts .fact b { font-weight: 500; color: var(--muted); }
  .day-card.is-today .day-facts { font-size: .8rem; margin-top: .1rem; }

  /* The ledger: the same days as rows, when the Drive is in list mode. */
  .day-ledger { display: grid; gap: .3rem; }
  ''' + D + r''' .day-card.is-row {
    grid-template-columns: 7.6rem minmax(0, 1fr) minmax(0, 1.5fr) 8.5rem; align-items: center;
    gap: .9rem; padding: .5rem .85rem; border-radius: 10px;
  }
  .day-card.is-row .day-body { display: contents; }
  .day-card.is-row .day-when { gap: .3rem; }
  .day-card.is-row .day-when .dom { font-size: 1.05rem; }
  .day-card.is-row .day-title { font-size: .9rem; }
  .day-card.is-row .day-push { -webkit-line-clamp: 1; }
  .day-card.is-row .day-facts { flex-wrap: nowrap; justify-self: end; margin-right: 1.7rem; }
  .day-card.is-row .day-go { display: none; }

  /* Kept: every star, thumb and note, under the day it happened, in his voice. */
  .kept-filter { display: inline-flex; gap: .3rem; margin: .1rem 0 .3rem; flex-wrap: wrap; }
  .kept-filter button {
    appearance: none; font: inherit; font-size: .76rem; padding: .22rem .66rem; border-radius: 999px;
    border: 1px solid var(--line); background: var(--card); color: var(--muted); cursor: pointer;
  }
  .kept-filter button:hover { color: var(--ink); }
  .kept-filter button[aria-pressed="true"] { border-color: var(--accent-ink); color: var(--accent-ink); background: var(--accent-soft); }
  .kept-day {
    display: flex; align-items: baseline; gap: .6rem; margin: 1.1rem 0 .4rem; text-decoration: none; color: inherit;
    font-size: .7rem; letter-spacing: .09em; text-transform: uppercase;
  }
  .kept-day b { font-weight: 600; color: var(--faint); }
  .kept-day em { font-style: normal; text-transform: none; letter-spacing: 0; font-size: .82rem; color: var(--muted); }
  .kept-day:hover em { color: var(--accent-ink); }
  .kept-item {
    display: grid; grid-template-columns: 6rem minmax(0, 1fr); gap: .18rem .9rem; padding: .65rem .85rem;
    border: 1px solid var(--line); border-radius: 12px; background: var(--card); margin-bottom: .35rem;
  }
  .kept-kind {
    font-size: .68rem; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); padding-top: .2rem;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .kept-main { min-width: 0; }
  .kept-title { font-weight: 500; font-size: .92rem; }
  .kept-title a { color: inherit; text-decoration: none; }
  .kept-title a:hover { color: var(--accent-ink); }
  .kept-marks { margin-left: .45rem; font-size: .78rem; color: var(--accent-ink); letter-spacing: .1em; }
  .kept-marks:empty { display: none; }
  .kept-rel {
    margin-left: .4rem; font-size: .66rem; padding: .04rem .42rem; border-radius: 999px;
    border: 1px solid var(--line); color: var(--faint); vertical-align: 2px;
  }
  .kept-rel:empty { display: none; }
  .kept-by { grid-column: 2; font-size: .76rem; color: var(--faint); }
  .kept-by:empty { display: none; }
  .kept-note {
    grid-column: 2; margin-top: .3rem; padding: .1rem 0 .1rem .75rem; border-left: 2px solid var(--accent);
    font-size: .86rem; line-height: 1.45; color: var(--ink); white-space: pre-line;
  }
  .kept-note:empty { display: none; }

  /* Threads: to-dos matched across days. A row is a thread, a column is a
     day, and the answer no per-file card can give — what has been hanging
     around, what got done — reads straight across. */
  .threads { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; background: var(--card); }
  .threads table { border-collapse: collapse; width: 100%; font-size: .84rem; }
  .threads th, .threads td { padding: .5rem .55rem; text-align: left; vertical-align: top; }
  .threads thead th {
    font-size: .64rem; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); font-weight: 600;
    border-bottom: 1px solid var(--line); white-space: nowrap;
  }
  .threads th.day, .threads td.day { width: 1.4rem; text-align: center; padding-left: .1rem; padding-right: .1rem; font-variant-numeric: tabular-nums; }
  .threads th.day.now { color: var(--accent-ink); }
  .threads td.day a {
    display: inline-block; width: .56rem; height: .56rem; border-radius: 999px; box-sizing: border-box;
    border: 1.5px solid var(--faint); opacity: .55; transition: transform var(--t) var(--settle);
  }
  .threads td.day a.done { background: var(--accent-ink); border-color: var(--accent-ink); opacity: 1; }
  .threads td.day a.snooze { height: .16rem; border-radius: 2px; border-width: 0; background: var(--faint); vertical-align: middle; }
  .threads td.day a:hover { transform: scale(1.4); }
  .threads tbody tr { border-top: 1px solid color-mix(in srgb, var(--line) 55%, transparent); }
  .threads tbody tr:hover { background: var(--paper-2); }
  .threads th.what, .threads td.what { position: sticky; left: 0; background: var(--card); min-width: 15rem; }
  .threads tbody tr:hover td.what { background: var(--paper-2); }
  .threads .t-title { font-weight: 500; }
  .threads .t-note {
    font-size: .76rem; color: var(--muted); margin-top: .12rem; white-space: pre-line;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .threads td.state { white-space: nowrap; font-size: .74rem; color: var(--faint); text-align: right; }
  .threads td.state[data-s="open"] { color: var(--accent-ink); }
  .threads td.state[data-s="done"] { color: var(--muted); }
  .pushes { display: grid; gap: .1rem; }
  .pushes a {
    display: grid; grid-template-columns: 6rem minmax(0, 1fr); gap: .8rem; padding: .38rem .55rem; border-radius: 8px;
    color: inherit; text-decoration: none; font-size: .86rem;
  }
  .pushes a:hover { background: var(--paper-2); }
  .pushes .d { font-size: .68rem; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); padding-top: .2rem; white-space: nowrap; }

  /* The wall: the month as a calendar of paintings. Written days are tiles
     with the day's picture, unwritten days are faint empty cells, so the
     shape of the practice — the weekends skipped, the run before CHI — is
     the drawing. */
  .wall { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: .55rem; }
  .wall-dow { font-size: .64rem; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); text-align: center; }
  .wall-cell { position: relative; aspect-ratio: 1 / 1; border-radius: 12px; border: 1.5px dashed color-mix(in srgb, var(--line) 85%, transparent); }
  .wall-cell.is-off, .wall-cell.is-ahead { border-color: transparent; }
  .wall-cell .n { position: absolute; top: .45rem; left: .6rem; font-size: .76rem; font-weight: 500; color: var(--faint); }
  .wall-cell.is-now { border-style: solid; border-color: var(--accent-ink); }
  ''' + D + r''' .day-card.wall-cell {
    display: block; padding: 0; overflow: hidden; aspect-ratio: 1 / 1;
    border: 1px solid var(--line); background: var(--paper-3);
  }
  ''' + D + r''' .day-card.wall-cell.is-now { box-shadow: 0 0 0 3px rgba(var(--accent-ink-rgb), .22); }
  .wall-cell .pic { position: absolute; inset: 0; background-size: cover; background-position: center; opacity: 0; transition: opacity var(--t-slow) var(--settle); }
  .wall-cell[data-pic="1"] .pic { opacity: 1; }
  /* A day with no painting in it wears its palette instead; a day with no
     colour at all keeps the paper and the ink. */
  .wall-cell[data-pic="pal"] .pic { opacity: .8; }
  .wall-cell .foot { position: absolute; inset: auto 0 0; padding: 1.8rem .6rem .55rem; display: grid; gap: .15rem; color: var(--ink); }
  .wall-cell[data-pic] .foot { color: #fff; background: linear-gradient(to top, rgba(0,0,0,.68), rgba(0,0,0,0)); }
  .wall-cell[data-pic] .n, .wall-cell[data-pic] .more { color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.55); }
  .wall-cell .wt {
    font-size: .8rem; font-weight: 500; line-height: 1.2;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .wall-cell[data-pic] .wt { text-shadow: 0 1px 2px rgba(0,0,0,.4); }
  .wall-cell .wp { display: flex; align-items: center; gap: .28rem; font-size: .66rem; opacity: .92; min-height: .6rem; }
  .wall-cell .wp i { width: .5rem; height: .5rem; border-radius: 999px; box-shadow: 0 0 0 1px rgba(255,255,255,.45); flex: none; }
  .wall-cell .wp span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  @media (max-width: 46rem) {
    .wall { grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); }
    .wall-dow, .wall-cell:not(.day-card) { display: none; }
    ''' + D + r''' .day-card.is-row { grid-template-columns: 6.4rem minmax(0, 1fr) 6.5rem; }
    .day-card.is-row .day-push { display: none; }
  }
  @media (max-width: 40rem) {
    .threads th.what, .threads td.what { min-width: 11rem; max-width: 13rem; }
    .kept-item { grid-template-columns: minmax(0, 1fr); }
    .kept-by, .kept-note { grid-column: 1; }
  }

'''

CSS_ANCHOR = '  /* Research Vision Docs — one living program doc, with older versions kept\n'
src = replace_once(src, CSS_ANCHOR, CSS + CSS_ANCHOR)

# ---------------------------------------------------------------- dayCard
OLD_DAYCARD = between(src, '      function dayCard({ entry, key }, { hero = false } = {}) {\n', '      function heading(text, note) {\n')
NEW_DAYCARD = r'''      function dayCard({ entry, key }, { hero = false, row = false, wall = false } = {}) {
        const when = dayDate(key);
        const el = document.createElement('div');
        el.className =
          'item day-card' +
          (hero ? ' is-today' : '') +
          (row ? ' is-row' : '') +
          (wall ? ' wall-cell' + (key === dayKey(Date.now()) ? ' is-now' : '') : '');
        el.dataset.kind = entry.kind;
        el.dataset.path = entry.path;
        el.dataset.day = key;
        stampTint(el, entry.path);
        if (picked.has(entry.path)) el.classList.add('marble-picked');
        // The theme of the day is what the document calls itself; the address
        // is the name it is filed under. They are allowed to disagree, and
        // once the names are themes too they will stop disagreeing.
        const title = entry.title || leaf(entry.path);
        if (wall) {
          // A tile on the wall: the day's painting, once it has been read,
          // with the date and the theme over its foot.
          el.innerHTML =
            '<span class="pic"></span><b class="n"></b>' +
            '<span class="foot"><b class="wt"></b><span class="wp"></span></span>' +
            '<button class="more" aria-label="More">⋮</button>';
          el.querySelector('.n').textContent = when.getDate();
          el.querySelector('.wt').textContent = title;
        } else {
          el.innerHTML =
            '<span class="day-when"><i class="dow"></i><b class="dom"></b><i class="mon"></i><span class="day-pal"></span></span>' +
            '<span class="day-body"><b class="day-title"></b><span class="day-push"></span><span class="day-facts"></span>' +
            '<span class="day-go">Open<i>→</i></span></span>' +
            '<button class="more" aria-label="More">⋮</button>';
          el.querySelector('.dow').textContent = when.toLocaleDateString(undefined, {
            weekday: hero ? 'long' : 'short',
          });
          el.querySelector('.dom').textContent = when.getDate();
          el.querySelector('.mon').textContent = when.toLocaleDateString(
            undefined,
            hero ? { month: 'long', year: 'numeric' } : { month: 'short' },
          );
          el.querySelector('.day-title').textContent = title;
        }
        el.title = leaf(entry.path);

        // What the day itself says, once it has been read. Nodes and
        // kilobytes were what the host knew about the file; the palette, the
        // push and the marks are what the day knows about itself.
        const fill = (d) => {
          if (!d) return;
          el.dataset.digest = '1';
          const chips = d.palette.chips.map((h) => '<i style="background:' + h + '"></i>').join('');
          if (wall) {
            const pic = el.querySelector('.pic');
            if (d.art.thumb) {
              pic.style.backgroundImage = 'url("' + d.art.thumb + '")';
              el.dataset.pic = '1';
            } else if (d.palette.chips.length) {
              // No painting that day: the palette, in four bands, is the picture.
              const n = d.palette.chips.length;
              pic.style.backgroundImage =
                'linear-gradient(135deg, ' +
                d.palette.chips.map((h, i) => h + ' ' + (i * 100) / n + '% ' + ((i + 1) * 100) / n + '%').join(', ') +
                ')';
              el.dataset.pic = 'pal';
            }
            const wp = el.querySelector('.wp');
            wp.innerHTML = chips + '<span></span>';
            wp.querySelector('span').textContent = d.palette.name;
            el.title = [title, d.art.credit, d.road.name ? 'The road ahead: ' + d.road.name : '']
              .filter(Boolean)
              .join('\n');
          } else {
            const pal = el.querySelector('.day-pal');
            pal.innerHTML = chips;
            pal.title = d.palette.name;
            el.querySelector('.day-push').textContent = d.push.title;
            factsInto(el.querySelector('.day-facts'), d);
          }
        };
        const have = digestOf(entry);
        if (have) fill(have);
        else digest(entry).then(fill);

        el.addEventListener('click', (event) => {
          // The menu button, a modifier click and the tail of a drag all still
          // mean what they mean everywhere else in this Drive — they are left
          // to the listing's own handler rather than answered twice.
          if (event.target.closest('.more')) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          if (Date.now() - dragged < 400 || tapSwallowed()) return;
          event.stopPropagation();
          // A card is a row with a bigger picture on it, so the touchscreen's
          // choosing mode reaches it too — one that opened instead would be
          // the only thing in the folder a held finger could not pick.
          if (selectMode) return toggleSelect(entry.path);
          pick(entry.path);
          openItem(el);
        });
        return el;
      }

'''
src = src.replace(OLD_DAYCARD, NEW_DAYCARD)

# ---------------------------------------------------------------- the almanac
ALMANAC = r'''      // ------------------------------------------------------------ the almanac
      //
      // A day is a document that was read once, on the morning it was
      // written, and marked: a tick, a star, a thumb, a note in Bryan's own
      // words. The folder used to describe each day the way the host sees it
      // — nodes and kilobytes — which is true of the file and says nothing
      // about the day. What follows reads the marks back. It fetches each
      // issue's own HTML, parses it once, keeps a small digest, and draws the
      // days behind today in four readings: the run of covers, what was
      // kept, what carried from day to day, and the month as a wall of
      // paintings.
      //
      // Read here rather than written by the build, because the listing
      // already hands over `modified` and `bytes` — a free cache key — and
      // because the day Bryan is ticking through right now changes under any
      // digest a build could have written for it.
      const DIGEST_KEY = 'marble-drive:days-digest:v1';
      const DIGEST_LANES = 3;
      const digests = new Map();
      const digesting = new Map();
      const digestFailed = new Map();
      const digestQueue = [];
      let digestBusy = 0;
      try {
        for (const [p, v] of Object.entries(JSON.parse(localStorage.getItem(DIGEST_KEY) ?? '{}'))) {
          if (v && v.stamp && v.d) digests.set(p, v);
        }
      } catch {}
      const stampOf = (entry) => (entry.modified ?? 0) + '|' + (entry.bytes ?? 0);
      const digestOf = (entry) => {
        const got = digests.get(entry.path);
        return got && got.stamp === stampOf(entry) ? got.d : null;
      };
      const saveDigests = (keep) => {
        if (keep) for (const p of [...digests.keys()]) if (!keep.has(p)) digests.delete(p);
        try {
          localStorage.setItem(DIGEST_KEY, JSON.stringify(Object.fromEntries(digests)));
        } catch {}
      };

      const flat = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      // A note keeps its line breaks: he wrote them.
      const kept = (el) => (el ? el.textContent.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim() : '');
      const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
      const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const hexIn = (el) => tidyHex((/#[0-9a-f]{6}/i.exec(el?.getAttribute('style') ?? '') ?? [''])[0]);

      // The story view clones cards, and a clone carries no marks. Two
      // entries with one key are one thing: the marks are the union, the
      // note is the longer one.
      const merged = (list, keyOf) => {
        const out = new Map();
        for (const it of list) {
          const k = keyOf(it);
          const prev = out.get(k);
          if (!prev) {
            out.set(k, it);
            continue;
          }
          prev.saved = prev.saved || it.saved;
          prev.vote = prev.vote || it.vote;
          prev.done = prev.done || it.done;
          prev.snooze = prev.snooze || it.snooze;
          prev.focus = prev.focus || it.focus;
          if ((it.note || '').length > (prev.note || '').length) prev.note = it.note;
        }
        return [...out.values()];
      };

      function readDay(doc, entry) {
        const meta = (name) => doc.querySelector('meta[name="' + name + '"]')?.getAttribute('content') ?? '';
        const rows = (sel, focus) =>
          [...doc.querySelectorAll(sel)]
            .map((li) => ({
              key: li.dataset.key || slug(flat(li.querySelector('.title'))),
              title: flat(li.querySelector('.title')),
              note: kept(li.querySelector('.note')),
              focus,
              done: li.hasAttribute('data-done'),
              snooze: li.hasAttribute('data-snooze'),
            }))
            .filter((r) => r.title);
        const cards = (sel, kind) =>
          [...doc.querySelectorAll(sel)]
            .map((c) => {
              const head = kind === 'paper' ? '.ptitle' : '.ntitle';
              const a = c.querySelector(head + ' a') ?? c.querySelector(head);
              return {
                key: c.dataset.key || '',
                kind,
                title: flat(a),
                url: a?.getAttribute('href') || '',
                source:
                  kind === 'paper'
                    ? 'arXiv'
                    : c.querySelector('.nmeta .ic-wrap')?.dataset.tip || flat(c.querySelector('.nmeta span')) || 'news',
                by:
                  kind === 'paper'
                    ? flat(c.querySelector('.pmeta'))
                    : [...c.querySelectorAll('.nmeta span')].map(flat).filter(Boolean).join(' · '),
                rel: flat(c.querySelector('.rel')),
                saved: c.hasAttribute('data-saved'),
                vote: c.getAttribute('data-vote') || '',
                note: kept(c.querySelector('.note')),
              };
            })
            .filter((c) => c.title);
        const roadH = [...doc.querySelectorAll('h2')].find((h) => /^the road ahead$/i.test(flat(h)));
        const road = roadH?.closest('section');
        const wx = doc.querySelector('.wx-block');
        return {
          key: meta('day:date') || entry.day || dayOf(entry) || '',
          title: meta('day:title') || flat(doc.querySelector('title')) || entry.title || leaf(entry.path),
          palette: {
            name: flat(doc.querySelector('.pal-name')) || meta('day:palette'),
            chips: [...doc.querySelectorAll('.pal .pal-chips i')].map(hexIn).filter(Boolean).slice(0, 4),
          },
          art: { credit: doc.querySelector('.art-img img')?.getAttribute('alt') ?? '', thumb: '' },
          weather: wx
            ? {
                city: flat(wx.querySelector('.wx-city')).replace(/\s*—.*$/, ''),
                emoji: flat(wx.querySelector('.wx-emoji')),
                temp: (/-?\d+/.exec(flat(wx.querySelector('.wx-temp'))) ?? [''])[0],
                cond: flat(wx.querySelector('.wx-cond')),
              }
            : null,
          push: { title: flat(doc.querySelector('.push-h')), body: clip(flat(doc.querySelector('.push-b')), 280) },
          rows: merged([...rows('li.row.focus', true), ...rows('li.row.todo', false)], (r) => r.key),
          cards: merged([...cards('.ncard', 'news'), ...cards('.pcard', 'paper')], (c) => c.key || c.url || c.title),
          road: {
            name: flat(road?.querySelector('.chead .n')),
            line: clip(flat(road?.querySelector('.repr p')), 200),
          },
          contents: [...doc.querySelectorAll('section.comp > .chead > h2')].map(flat).filter(Boolean),
        };
      }

      // The painting, small. A day's picture is a data URI of a few hundred
      // kilobytes; the wall needs a thumbnail, and the cache has a quota.
      const shrink = (src) =>
        new Promise((resolve) => {
          if (!src || !src.startsWith('data:image/')) return resolve('');
          const img = new Image();
          img.onload = () => {
            try {
              const w = 320;
              const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              canvas.getContext('2d').drawImage(img, 0, 0, w, h);
              resolve(canvas.toDataURL('image/jpeg', 0.72));
            } catch {
              resolve('');
            }
          };
          img.onerror = () => resolve('');
          img.src = src;
        });

      async function readIssue(entry) {
        try {
          const res = await fetch(marble.href(entry.path), { credentials: 'same-origin' });
          if (!res.ok) throw new Error(res.status);
          const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
          const d = readDay(doc, entry);
          d.art.thumb = await shrink(doc.querySelector('.art-img img')?.getAttribute('src') ?? '');
          digests.set(entry.path, { stamp: stampOf(entry), d });
          saveDigests();
          return d;
        } catch {
          digestFailed.set(entry.path, stampOf(entry));
          return null;
        }
      }
      function pumpDigests() {
        while (digestBusy < DIGEST_LANES && digestQueue.length) {
          const job = digestQueue.shift();
          digestBusy += 1;
          readIssue(job.entry).then((d) => {
            digestBusy -= 1;
            digesting.delete(job.entry.path);
            job.resolve(d);
            pumpDigests();
          });
        }
      }
      // The digest of a day, fetching it if it has to. Three at a time: a
      // folder of a hundred days should not open a hundred connections.
      function digest(entry) {
        const have = digestOf(entry);
        if (have) return Promise.resolve(have);
        if (digestFailed.get(entry.path) === stampOf(entry)) return Promise.resolve(null);
        if (digesting.has(entry.path)) return digesting.get(entry.path);
        const p = new Promise((resolve) => digestQueue.push({ entry, resolve }));
        digesting.set(entry.path, p);
        pumpDigests();
        return p;
      }

      const factsOf = (d) => ({
        saved: d.cards.filter((c) => c.saved).length,
        liked: d.cards.filter((c) => c.vote === 'up').length,
        noted: d.cards.filter((c) => c.note).length + d.rows.filter((r) => r.note).length,
        done: d.rows.filter((r) => r.done).length,
        total: d.rows.length,
      });
      function factsInto(el, d) {
        const f = factsOf(d);
        el.replaceChildren();
        const add = (glyph, n, tip) => {
          const s = dayEl('span', 'fact');
          s.innerHTML = '<i></i> <b></b>';
          s.querySelector('i').textContent = glyph;
          s.querySelector('b').textContent = n;
          s.title = tip;
          el.append(s);
        };
        if (f.saved) add('★', f.saved, f.saved + ' saved');
        if (f.liked) add('▲', f.liked, f.liked + ' liked');
        if (f.noted) add('✎', f.noted, f.noted + (f.noted === 1 ? ' note' : ' notes'));
        if (f.total) add('✓', f.done + '/' + f.total, f.done + ' of ' + f.total + ' to-dos done');
      }

      const shortDate = (key) => dayDate(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const longDate = (key) =>
        dayDate(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

      // The readings. Words rather than icons, and only in this folder: the
      // Drive's own toggle keeps meaning grid, list, timeline, map, pulse and
      // weight everywhere, including here.
      const READINGS = [
        ['days', 'Days'],
        ['kept', 'Kept'],
        ['threads', 'Threads'],
        ['wall', 'Wall'],
      ];
      const HEADS = { days: 'Earlier days', kept: 'What you kept', threads: 'What carried', wall: 'The month' };
      const reading = () => {
        const r = document.body.getAttribute('data-days-read');
        return READINGS.some(([k]) => k === r) ? r : 'days';
      };
      // Filed on the body the way the view is, so it is undoable and the
      // folder reopens the way it was left.
      function setReading(next) {
        const was = reading();
        if (was === next) return;
        const id = marble.id(document.body);
        document.body.setAttribute('data-days-read', next);
        if (id) {
          marble.record({
            redo: [{ type: 'setAttr', id, name: 'data-days-read', value: next }],
            undo: [{ type: 'setAttr', id, name: 'data-days-read', value: was }],
          });
          marble.op({ type: 'setAttr', id, name: 'data-days-read', value: next }, { immediate: true });
        }
        draw();
      }

      const spanOf = (keys) => {
        if (!keys.length) return '';
        const sorted = [...keys].sort();
        const a = sorted[0];
        const b = sorted[sorted.length - 1];
        if (a === b) return shortDate(a);
        const sameMonth = a.slice(0, 7) === b.slice(0, 7);
        return sameMonth
          ? shortDate(a) + '\u2013' + dayDate(b).getDate()
          : shortDate(a) + ' \u2013 ' + shortDate(b);
      };
      function syncDaysNote(note, all) {
        const have = all.filter((d) => digestOf(d.entry)).length;
        note.textContent =
          have < all.length
            ? 'Reading ' + have + ' of ' + all.length + '…'
            : all.length + (all.length === 1 ? ' day' : ' days') + ' · ' + spanOf(all.map((d) => d.key));
      }
      function daysBar(all, r) {
        const bar = dayEl('div', 'days-bar');
        bar.append(heading(HEADS[r]));
        const seg = dayEl('span', 'days-seg');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'How to read the days');
        for (const [k, label] of READINGS) {
          const b = dayEl('button', '', label);
          b.type = 'button';
          b.dataset.daysRead = k;
          b.setAttribute('aria-pressed', k === r ? 'true' : 'false');
          b.addEventListener('click', () => setReading(k));
          seg.append(b);
        }
        bar.append(seg);
        const note = dayEl('span', 'days-note');
        syncDaysNote(note, all);
        bar.append(note);
        return bar;
      }
      const emptyNote = (text) => dayEl('div', 'days-empty', text);

      // Days: the run, grouped by the month the day belongs to, not the month
      // the file was last touched — an archive that reorders itself when you
      // read it is not an archive. Covers in grid mode, a ledger in list mode.
      function drawRun(archive) {
        const row = mode() === 'list';
        let month = null;
        let grid = null;
        for (const day of archive) {
          const key = day.key.slice(0, 7);
          if (key !== month) {
            month = key;
            items.append(heading(dayDate(day.key).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })));
            grid = dayEl('div', row ? 'day-ledger' : 'day-grid');
            items.append(grid);
          }
          grid.append(dayCard(day, { row }));
        }
      }

      // Kept and Threads need every day's digest. Rather than wait for all of
      // them, draw what is here and redraw the reading — only the reading —
      // as the rest arrive. The wall's tiles fill themselves.
      function drawReading(all, r) {
        const box = dayEl('div', 'days-reading');
        box.dataset.reading = r;
        items.append(box);
        const render = () => {
          if (!box.isConnected) return;
          box.replaceChildren();
          if (r === 'kept') drawKept(box, all);
          else if (r === 'threads') drawThreads(box, all);
          else drawWall(box, all);
        };
        render();
        if (r === 'wall') return;
        let timer = null;
        for (const day of all) {
          if (digestOf(day.entry)) continue;
          digest(day.entry).then(() => {
            clearTimeout(timer);
            timer = setTimeout(render, 120);
          });
        }
      }

      // What he kept: a star, a thumb up, or a note — on a paper, a story, or
      // a to-do. His marks, in his voice; the paper's pitch stays in the day.
      let keptFilter = 'all';
      const keptOf = (d, day) => {
        const out = [];
        for (const c of d.cards) {
          if (c.saved || c.vote === 'up' || c.note) out.push({ ...c, own: false });
        }
        for (const r of d.rows) {
          if (!r.note) continue;
          out.push({
            key: r.key,
            kind: 'todo',
            source: r.focus ? 'today, sharply' : 'to-do',
            title: r.title,
            url: marble.href(day.entry.path),
            by: r.done ? 'done' : '',
            rel: '',
            saved: false,
            vote: '',
            note: r.note,
            own: true,
          });
        }
        return out;
      };
      const keptShows = (k) =>
        keptFilter === 'all' ||
        (keptFilter === 'saved' && k.saved) ||
        (keptFilter === 'liked' && k.vote === 'up') ||
        (keptFilter === 'noted' && Boolean(k.note));
      function drawKept(box, all) {
        const filt = dayEl('div', 'kept-filter');
        for (const [k, label] of [['all', 'All'], ['saved', '★ Saved'], ['liked', '▲ Liked'], ['noted', '✎ Noted']]) {
          const b = dayEl('button', '', label);
          b.type = 'button';
          b.dataset.keptFilter = k;
          b.setAttribute('aria-pressed', k === keptFilter ? 'true' : 'false');
          b.addEventListener('click', () => {
            keptFilter = k;
            box.replaceChildren();
            drawKept(box, all);
          });
          filt.append(b);
        }
        box.append(filt);
        let any = 0;
        let ready = 0;
        // A to-do carries its note from day to day, so the same note would
        // show under every morning it rode along on. Once, on the newest.
        const seen = new Set();
        const fresh = (k) => {
          const id = k.kind + '|' + (k.key || k.url || k.title) + '|' + k.note + '|' + k.saved + '|' + k.vote;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        };
        for (const day of [...all].sort((a, b) => b.key.localeCompare(a.key))) {
          const d = digestOf(day.entry);
          if (!d) continue;
          ready += 1;
          const list = keptOf(d, day).filter(fresh).filter(keptShows);
          if (!list.length) continue;
          any += list.length;
          const h = dayEl('a', 'kept-day');
          h.href = marble.href(day.entry.path);
          h.innerHTML = '<b></b><em></em>';
          h.querySelector('b').textContent = longDate(day.key);
          h.querySelector('em').textContent = d.title;
          box.append(h);
          for (const k of list) box.append(keptItem(k));
        }
        if (!any) {
          box.append(
            emptyNote(
              ready
                ? 'Nothing kept under this filter yet. A star, a thumb up or a note on any card in any day lands here.'
                : 'Reading the days…',
            ),
          );
        }
      }
      function keptItem(k) {
        const el = dayEl('div', 'kept-item');
        el.dataset.kind = k.kind;
        el.innerHTML =
          '<span class="kept-kind"></span>' +
          '<span class="kept-main"><b class="kept-title"><a></a></b><span class="kept-marks"></span><span class="kept-rel"></span></span>' +
          '<span class="kept-by"></span><span class="kept-note"></span>';
        el.querySelector('.kept-kind').textContent = k.source;
        const a = el.querySelector('a');
        a.textContent = k.title;
        if (k.url) a.href = k.url;
        if (!k.own) {
          a.target = '_blank';
          a.rel = 'noopener';
        }
        el.querySelector('.kept-marks').textContent =
          (k.saved ? '★' : '') + (k.vote === 'up' ? '▲' : k.vote === 'down' ? '▼' : '');
        el.querySelector('.kept-rel').textContent = k.rel;
        el.querySelector('.kept-by').textContent = k.by;
        el.querySelector('.kept-note').textContent = k.note;
        return el;
      }

      // What carried: to-dos matched across days by their key. A row is a
      // thread; a cell is the day; the state chip answers the question no
      // per-file card can — what has been hanging around, and what got done.
      function drawThreads(box, all) {
        const asc = [...all].sort((a, b) => a.key.localeCompare(b.key));
        const today = dayKey(Date.now());
        const threads = new Map();
        let newest = null;
        for (const day of asc) {
          const d = digestOf(day.entry);
          if (!d) continue;
          newest = day.key;
          for (const r of d.rows) {
            let t = threads.get(r.key);
            if (!t) {
              t = { key: r.key, title: r.title, note: '', cells: new Map(), first: day.key, last: day.key, doneOn: null };
              threads.set(r.key, t);
            }
            t.title = r.title;
            if (r.note) t.note = r.note;
            t.cells.set(day.key, r.done ? 'done' : r.snooze ? 'snooze' : 'open');
            t.last = day.key;
            if (r.done) t.doneOn = day.key;
          }
        }
        if (!newest) {
          box.append(emptyNote('Reading the days…'));
          return;
        }
        const between = (a, b) => Math.round((dayDate(b) - dayDate(a)) / 86400000) + 1;
        const list = [...threads.values()].map((t) => {
          const state = t.doneOn ? 'done' : t.last === newest ? 'open' : 'dropped';
          const days = between(t.first, t.last);
          const label =
            state === 'done'
              ? 'Done ' + shortDate(t.doneOn)
              : state === 'open'
                ? 'Open · ' + days + (days === 1 ? ' day' : ' days')
                : 'Dropped after ' + shortDate(t.last);
          return { ...t, state, days, label };
        });
        const order = { open: 0, done: 1, dropped: 2 };
        list.sort(
          (a, b) =>
            order[a.state] - order[b.state] ||
            (a.state === 'open' ? b.days - a.days : b.last.localeCompare(a.last)) ||
            a.title.localeCompare(b.title),
        );

        const wrap = dayEl('div', 'threads');
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const hr = document.createElement('tr');
        hr.append(dayEl('th', 'what', 'Thread'));
        let month = null;
        for (const day of asc) {
          const th = dayEl('th', 'day' + (day.key === today ? ' now' : ''));
          const m = day.key.slice(0, 7);
          th.textContent = m !== month ? shortDate(day.key) : String(dayDate(day.key).getDate());
          month = m;
          th.title = longDate(day.key);
          hr.append(th);
        }
        hr.append(dayEl('th', 'state'));
        thead.append(hr);
        table.append(thead);
        const tbody = document.createElement('tbody');
        for (const t of list) {
          const tr = document.createElement('tr');
          const what = dayEl('td', 'what');
          what.append(dayEl('div', 't-title', t.title));
          if (t.note) what.append(dayEl('div', 't-note', t.note));
          tr.append(what);
          for (const day of asc) {
            const td = dayEl('td', 'day');
            const state = t.cells.get(day.key);
            if (state) {
              const a = document.createElement('a');
              a.className = state;
              a.href = marble.href(day.entry.path);
              a.title = longDate(day.key) + ' · ' + state;
              td.append(a);
            }
            tr.append(td);
          }
          const st = dayEl('td', 'state', t.label);
          st.dataset.s = t.state;
          tr.append(st);
          tbody.append(tr);
        }
        table.append(tbody);
        wrap.append(table);
        box.append(wrap);
        if (!list.length) box.append(emptyNote('No to-dos in these days yet.'));

        // The pushes: what each morning asked him to move, newest first.
        const pushes = dayEl('div', 'pushes');
        for (const day of [...asc].reverse()) {
          const d = digestOf(day.entry);
          if (!d || !d.push.title) continue;
          const a = document.createElement('a');
          a.href = marble.href(day.entry.path);
          a.append(dayEl('span', 'd', longDate(day.key)));
          a.append(dayEl('span', '', d.push.title));
          if (d.push.body) a.title = d.push.body;
          pushes.append(a);
        }
        if (pushes.childElementCount) {
          box.append(heading('The pushes', 'one thing a morning'));
          box.append(pushes);
        }
      }

      // The wall: a Monday-first calendar of the months that have days.
      function drawWall(box, all) {
        const byKey = new Map(all.map((d) => [d.key, d]));
        if (!byKey.size) return;
        const today = dayKey(Date.now());
        const months = new Set([...byKey.keys()].map((k) => k.slice(0, 7)));
        months.add(today.slice(0, 7));
        const dows = [];
        for (let i = 0; i < 7; i += 1) {
          dows.push(new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));
        }
        for (const m of [...months].sort().reverse()) {
          const [y, mo] = m.split('-').map(Number);
          const first = new Date(y, mo - 1, 1);
          box.append(heading(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })));
          const grid = dayEl('div', 'wall');
          for (const dow of dows) grid.append(dayEl('span', 'wall-dow', dow));
          const lead = (first.getDay() + 6) % 7;
          for (let i = 0; i < lead; i += 1) grid.append(dayEl('span', 'wall-cell is-off'));
          const n = new Date(y, mo, 0).getDate();
          for (let d = 1; d <= n; d += 1) {
            const key = m + '-' + pad(d);
            const day = byKey.get(key);
            if (day) {
              grid.append(dayCard(day, { wall: true }));
              continue;
            }
            const cell = dayEl('span', 'wall-cell' + (key === today ? ' is-now' : key > today ? ' is-ahead' : ''));
            cell.innerHTML = '<b class="n"></b>';
            cell.querySelector('.n').textContent = d;
            grid.append(cell);
          }
          box.append(grid);
        }
      }

'''
DRAWDAYS_ANCHOR = '      // The folder, drawn as what it is. Today sits alone at the top at the\n'
src = replace_once(src, DRAWDAYS_ANCHOR, ALMANAC + DRAWDAYS_ANCHOR)

# ---------------------------------------------------------------- drawDays tail
OLD_TAIL = between(src, "        if (archive.length) {\n          items.append(heading('Earlier days', archive.length + (archive.length === 1 ? ' day' : ' days')));\n", "      function drawCrumbs() {\n")
NEW_TAIL = r'''        // Everything behind today, read one of four ways. Today is in every
        // reading that aggregates — a star he put on a paper this morning is
        // kept — and stays out of the run, which it already heads.
        const all = current ? [current, ...archive] : archive;
        if (all.length) {
          const r = reading();
          const bar = daysBar(all, r);
          items.append(bar);
          if (r === 'days') drawRun(archive);
          else drawReading(all, r);
          const note = bar.querySelector('.days-note');
          for (const day of all) {
            if (digestOf(day.entry)) continue;
            digest(day.entry).then(() => {
              if (note.isConnected) syncDaysNote(note, all);
            });
          }
          saveDigests(new Set(all.map((d) => d.entry.path)));
        }

        if (rest.length) {
          items.append(heading('Also here'));
          const grid = document.createElement('div');
          grid.className = 'day-grid';
          for (const entry of rest) grid.append(node(entry));
          items.append(grid);
        }
      }

'''
src = src.replace(OLD_TAIL, NEW_TAIL)

open(dst_path, 'w', encoding='utf-8').write(src)
print('wrote', dst_path, len(src.encode('utf-8')), 'bytes')
