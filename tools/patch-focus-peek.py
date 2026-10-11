"""Carry the Focus-card peek from templates/agents.mrbl into drive/Agents.mrbl.

The change is `<style>` and `<script>` only — no element carrying a
data-marble-id moves — so the host's diff is empty and one write lands verbatim
under a running serve (see memory/script-only-write-lands.md). The new text is
read out of the template rather than repeated here, so the two copies cannot
drift; every substitution asserts it matched exactly once.

    python3 tools/patch-focus-peek.py            # dry run
    python3 tools/patch-focus-peek.py --write
"""
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parent.parent
tpl = (root / 'templates/agents.mrbl').read_text()
live_path = root / 'drive/Agents.mrbl'
live = live_path.read_text()


def between(text, start, end):
    """The template's own text from `start` up to (not including) `end`."""
    i = text.index(start)
    j = text.index(end, i)
    return text[i:j]


NEW_CSS = between(tpl, '  /* ---- The peek. A card says which chat this is;', '  /* ---- Focus on a phone:')
NEW_PEEK = between(tpl, '    // ---- The peek. What a chat was about, beside the card the pointer is on.', '    /** A basin is the region the packer allocated,')
NEW_HOVER = between(tpl, '      // Hover is remembered, and the card itself never answers it:', "      card.querySelector('.focus-pin')")

OLD_CSS = '''  .focus-look {
    position: fixed; z-index: 12;
    width: min(28rem, calc(100vw - 2rem)); max-height: 70vh; overflow: auto;
    padding: 1rem 1.1rem; border: 1px solid var(--line); border-radius: 12px;
    background: rgba(var(--card-rgb), .86);
    backdrop-filter: blur(20px) saturate(160%);
    -webkit-backdrop-filter: blur(20px) saturate(160%);
    box-shadow: var(--shadow-lift);
  }
  .focus-look h3 { margin: 0 0 .35rem; font-size: 1rem; font-weight: 500; }
  .focus-look .look-meta { color: var(--muted); font-size: .8rem; margin: 0 0 .75rem; }
  .focus-look .look-events { margin: 0; padding-left: 1.1rem; color: var(--ink); font-size: .85rem; }
'''

OLD_PEEK_START = "    const closeFocusLook = () => {\n      document.querySelector('.focus-look')?.remove();\n      focusLookId = null;\n    };\n"
OLD_PEEK_END = "    /** A basin is the region the packer allocated,"

OLD_HOVER = '''      // Hover is remembered for Quick Look, and nothing else: a card that
      // grew under the pointer pushed its column and the pointer off itself.
      card.addEventListener('pointerenter', () => {
        if (focusSuppressClick) return;
        focusHoveredId = card.dataset.id;
      });
      card.addEventListener('pointerleave', () => {
        if (focusHoveredId === card.dataset.id) focusHoveredId = null;
      });
'''

# The old Quick Look ran from closeFocusLook to the basin comment; it is
# replaced whole by the peek.
i = live.index(OLD_PEEK_START)
OLD_PEEK = live[i:live.index(OLD_PEEK_END, i)]

HELD = '''    // Held: opened with Space and staying until Escape, as against the
    // transient one a pointer resting on a card brings up.
    let focusLookHeld = false;
'''

WATCH = '''
    // A peek is tied to the card it points at, so anything that moves the
    // canvas under it takes it away: scrolling, and a press anywhere but
    // inside a held one.
    focusEl?.addEventListener('scroll', () => {
      if (focusLookId) closeFocusLook();
    }, { passive: true });
    document.addEventListener('pointerdown', (event) => {
      if (!focusLookId) return;
      if (event.target?.closest?.('.focus-look')) return;
      closeFocusLook();
    }, true);
'''

SUBS = [
    (OLD_CSS, NEW_CSS),
    ('    let focusLookId = null;\n', '    let focusLookId = null;\n' + HELD),
    (OLD_PEEK, NEW_PEEK),
    (OLD_HOVER, NEW_HOVER),
    (
        '        if (focusLookId === id) closeFocusLook();\n        else openFocusLook(id);',
        '        if (focusLookId === id) closeFocusLook();\n        else openFocusLook(id, { held: true });',
    ),
    (
        '          if (focusLookId) openFocusLook(next.id);',
        '          if (focusLookId) openFocusLook(next.id, { held: focusLookHeld, moved: true });',
    ),
    (
        "      document.querySelector('.focus-look')?.remove();\n      closeFolderPalettes();\n      focusLookId = null;\n      stopFocusDecay();",
        '      closeFocusLook();\n      closeFolderPalettes();\n      stopFocusDecay();',
    ),
    (
        '        const begin = () => {\n          focusSuppressClick = true;',
        '        const begin = () => {\n          focusSuppressClick = true;\n          closeFocusLook();',
    ),
    (
        '      event.preventDefault();\n      startNew({ folderId });\n    });\n',
        '      event.preventDefault();\n      startNew({ folderId });\n    });\n' + WATCH,
    ),
]

ids_before = re.findall(r'data-marble-id="[^"]*"', live)
out = live
for old, new in SUBS:
    assert out.count(old) == 1, f'no single match for:\n{old[:120]}'
    out = out.replace(old, new)

ids_after = re.findall(r'data-marble-id="[^"]*"', out)
assert ids_before == ids_after, 'this patch must not touch an addressed element'
print(f'{len(live)} → {len(out)} bytes, {len(ids_after)} ids untouched')

if '--write' in sys.argv:
    live_path.write_text(out)
    print('written')
else:
    print('dry run; pass --write')
