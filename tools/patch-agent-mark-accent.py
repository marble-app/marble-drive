"""The agent's mark wears the document's accent, and the handle is a comment pin.

Two changes, both reversals of an earlier call.

1. The violet was deliberately outside every document's palette, so that the
   agent would never be mistaken for a control of the app it was working in
   (see docs/superpowers/specs/2026-09-19-zone-is-someone-else-design.md 2.1).
   Bryan asked for the opposite: the agent's chrome should belong to the
   document it is standing in. `--accent-ink` is the document's own strong,
   ink-safe accent, so it needs no carry toward the ink the way a fixed
   literal did. The violet stays as the fallback for a document that declares
   no accent at all, and keeps its carry.

2. The handle was a rounded box with a border-tail and two lines of writing.
   Figma's comment mark is a round bubble whose bottom-left corner is squared
   off into the point — one shape, no separate tail — and Bryan wants it with
   nothing inside.

Exact substitutions, each asserted to match once.
"""
import sys

# The document's own accent, or the old violet carried toward the page's ink
# for a document that declares none.
MARK = "var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)))"

FILES = {
    "runtime/collab.js": [
        (
            """        box-shadow: inset 2px 0 0 color-mix(in srgb, #6d55d4 78%, var(--ink, #222));""",
            f"""        box-shadow: inset 2px 0 0 {MARK};""",
        ),
        (
            """           Dark mode here is per-document, not per-OS, so the violet is carried
           toward the document's own ink — darker on light paper, lighter on
           dark, the same hue either way. */
        --zone-mark: color-mix(in srgb, #6d55d4 78%, var(--ink, #111));""",
            """           The agent works in the document's own accent. It used to wear one
           violet, chosen to sit outside every document's palette so that an
           agent could never be read as a control of the app it was standing
           in; the zone's shape, its wash and its label carry that now, and
           belonging to the page it is on costs nothing.
           The fallback is that violet, and it keeps the old carry toward the
           page's ink: dark mode here is per-document, not per-OS, so a fixed
           literal has to adapt itself, where a document's own accent already has. */
        --zone-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #111)));""",
        ),
    ],
    "runtime/agent-ui.js": [
        (
            """      --zone-mark: color-mix(in srgb, #6d55d4 78%, var(--ink));""",
            """      --zone-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink)));""",
        ),
    ],
    "runtime/agent-callout.js": [
        (
            """      --callout-mark: color-mix(in srgb, #6d55d4 78%, var(--ink, #222));""",
            f"""      --callout-mark: {MARK};""",
        ),
        # ------------------------------------------------ the pin
        (
            """    /* A comment bubble, not a dot. A disc is a marker — it says something is
       here and nothing about what. The bubble says the one true thing: there
       is something to be said about this. It needs the real tail and two
       written lines: a rounded box with three dots in it is the glyph every
       interface uses for *more options*, which is the wrong promise. */
    .marble-callout-handle {
      position: fixed; width: 26px; height: 20px; border-radius: 7px; border: 0; padding: 0;""",
            """    /* A comment pin, the shape Figma drops on a canvas: a round bubble with
       its bottom-left corner squared off into the point. The tail is the
       shape, not a triangle stuck to it, which is why it survives being 22px
       and why it needs nothing inside — a disc with a dot in it said only
       that something was here, and a rounded box with three dots in it is
       every interface's *more options*. This says: there is a comment here.
       The squared corner is the one nearest the text it hangs under. */
    .marble-callout-handle {
      position: fixed; width: 22px; height: 22px; border-radius: 50% 50% 50% 3px; border: 0; padding: 0;""",
        ),
        (
            """    /* The tail, cut from two borders, hanging off the bottom-left corner —
       the corner nearest the text the bubble is about. */
    .marble-callout-handle::before {
      content: ''; position: absolute; left: 4px; bottom: -4px;
      border-left: 6px solid var(--callout-mark);
      border-bottom: 5px solid transparent;
    }
    /* Two lines of writing. The second is drawn as the first one's shadow,
       pulled in at both ends so it reads as a shorter line, the way the last
       line of a paragraph is short. */
    .marble-callout-handle::after {
      content: ''; width: 12px; height: 2px; border-radius: 1px; background: #fff;
      box-shadow: -1.5px 4px 0 -0.5px #fff;
    }
""",
            "",
        ),
    ],
}


def main(root="."):
    for path, edits in FILES.items():
        full = f"{root}/{path}"
        src = open(full, encoding="utf-8").read()
        for old, new in edits:
            hits = src.count(old)
            assert hits == 1, f"{path}: expected 1 match, found {hits} for:\n{old[:90]}..."
            src = src.replace(old, new)
        open(full, "w", encoding="utf-8").write(src)
        print(f"{path}: {len(edits)} edits applied")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
