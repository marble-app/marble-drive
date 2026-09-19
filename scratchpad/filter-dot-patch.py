#!/usr/bin/env python3
"""The Filter button is marked, not counted.

A digit reads as a notification you are meant to clear, and with an idle cut on
by default it would never go away. Run on templates/agents.mrbl then on
drive/Agents.mrbl; idempotent, every substitution asserts one match.
"""
import sys

CSS_OLD = """  .filter-count {
    min-width: 1.05rem; height: 1.05rem; padding: 0 .3rem; box-sizing: border-box;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 999px; background: var(--accent-ink); color: var(--paper);
    font-size: .65rem; font-weight: 600; font-variant-numeric: tabular-nums;
  }
  .filter-count:empty { display: none; }
"""

CSS_NEW = """  /* Marked, not counted. A digit on the button reads as a notification you
     are meant to go and clear, and with an idle cut on by default it would
     never go away. The dot says only that something is hiding rows; the
     popover — and the button's own tooltip — say what. */
  .filter-count {
    display: none; width: 5px; height: 5px; flex: none; padding: 0;
    box-sizing: border-box; border-radius: 999px; background: var(--accent-ink);
  }
  .filter-count[data-on] { display: block; }
"""

JS_OLD = """      filterCount.textContent = active.length ? String(active.length) : '';
      filterCount.title = active.length ? `Showing: ${active.join(', ')}` : '';
"""

JS_NEW = """      filterCount.toggleAttribute('data-on', active.length > 0);
      // The tooltip belongs on the button, which is what a pointer is over;
      // the dot is a five-pixel target and says nothing on its own.
      filterToggle.title = active.length ? `Showing: ${active.join(', ')}` : '';
"""

MARK_OLD = """    const filterCount = $('.filter-count');
"""

MARK_NEW = """    const filterCount = $('.filter-count');
    // Nothing to read out: what is filtered is on the button and in the panel.
    filterCount?.setAttribute('aria-hidden', 'true');
"""

EDITS = [('css', CSS_OLD, CSS_NEW), ('js', JS_OLD, JS_NEW), ('aria', MARK_OLD, MARK_NEW)]


def main():
    target = sys.argv[1]
    src = open(target, encoding='utf-8').read()
    before = len(src)
    for name, old, new in EDITS:
        if old not in src and new in src:
            print(f'  {name}: already there')
            continue
        hits = src.count(old)
        if hits != 1:
            raise SystemExit(f'{name}: matched {hits} times in {target}, wanted exactly 1')
        src = src.replace(old, new, 1)
    print(f'{target}: {before} -> {len(src)} bytes')
    if '--write' in sys.argv:
        open(target, 'w', encoding='utf-8').write(src)
        print('written')
    else:
        print('dry run (pass --write)')


main()
