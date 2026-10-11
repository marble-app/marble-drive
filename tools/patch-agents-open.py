"""Give a live Agents document the callout's `?open=<id>` reader.

The template change is JavaScript only — no `__ID__` slots — so this is an
exact substitution, applied once to the served copy. Run it with the host
stopped: a running serve rewrites the script block a beat after any change.
"""
import sys

OLD = """        const saved = recalled(OPEN_KEY);
        if (saved) await open(saved);
"""
NEW = """        // Arrived from a callout's Open in Agents: that chat wins over the
        // one this tab last had open, and the parameter is spent so a reload
        // does not reopen it.
        const arrived = new URL(location.href);
        const wanted = arrived.searchParams.get('open');
        if (wanted) {
          arrived.searchParams.delete('open');
          history.replaceState(history.state, '', arrived.href);
        }
        const first = wanted || recalled(OPEN_KEY);
        if (first) await open(first).catch(() => {});
"""

for path in sys.argv[1:]:
    src = open(path, encoding='utf-8').read()
    if "searchParams.get('open')" in src:
        print(path, 'already patched')
        continue
    found = src.count(OLD)
    assert found == 1, f'{path}: expected one restore-open block, found {found}'
    open(path, 'w', encoding='utf-8').write(src.replace(OLD, NEW))
    print(path, 'patched')
