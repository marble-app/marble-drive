#!/usr/bin/env python3
"""Pin the phone's fixed chrome to the visual viewport, not the layout viewport.

A phone browser answers the keyboard two ways at once: it shrinks the visual
viewport *and* slides it down the layout viewport so the caret clears the keys.
The page only read the first. `--vv-top` is the second, and the two surfaces
that are fixed to the layout viewport now stand on it.

CSS/JS only — no element and no id is touched, so the same script runs on
templates/agents.mrbl and on the live drive/Agents.mrbl.
"""
import sys

SUBS = [
    # 1. The variable itself, beside the height it belongs with.
    (
        "    :root { --vv-h: 100vh; --topbar-h:",
        "    :root { --vv-h: 100vh; --vv-top: 0px; --topbar-h:",
    ),
    # 2. The topbar rides down with the visual viewport instead of staying
    #    pinned to a layout viewport the keyboard has slid out from under.
    (
        "    .topbar { position: sticky; top: 0; z-index: 30;",
        "    /* `--vv-top` is how far down the layout viewport the visible strip now\n"
        "       starts. Sticky pins the topbar to the layout viewport, which with the\n"
        "       keyboard up is above the screen — so it rides down by that much and the\n"
        "       conversation's own header stays where it can be read. */\n"
        "    .topbar { transform: translateY(var(--vv-top, 0px)); position: sticky; top: 0; z-index: 30;",
    ),
    # 3. The open conversation starts below the topbar *on the screen*, so its
    #    composer ends on the keyboard rather than `--vv-top` above it.
    (
        "body[data-open] .pane { display: grid; position: fixed; left: 0; right: 0; top: var(--topbar-h); height: calc(var(--vv-h) - var(--topbar-h));",
        "body[data-open] .pane { display: grid; position: fixed; left: 0; right: 0; top: calc(var(--vv-top, 0px) + var(--topbar-h)); height: calc(var(--vv-h) - var(--topbar-h));",
    ),
    # 4. Focus's column is the other surface measured against the visual
    #    viewport. It is in flow under the topbar, so it is moved the same way
    #    the topbar is — by relative offset, not a transform, so the pane that
    #    Focus places over the Full card (fixed, from the column's own rect)
    #    keeps the viewport as its containing block.
    (
        "  .focus[data-phone] { position: relative; overflow: hidden;",
        "  .focus[data-phone] { position: relative; top: var(--vv-top, 0px); overflow: hidden;",
    ),
    # 5. One more line in syncViewport, and the comment that says why there are
    #    now two insets and not one.
    (
        """      // The keyboard is the strip of the layout viewport the visual viewport
      // no longer covers. Anything standing on the sill stands on `--kb`.
      const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      document.documentElement.style.setProperty('--kb', `${kb}px`);""",
        """      // The keyboard does not only take room, it moves the room: to keep the
      // caret clear the browser slides the visual viewport down the layout
      // viewport, and everything the page fixed to the layout viewport is then
      // that much too high. `--vv-top` is where the visible strip starts and
      // `--kb` is where it ends; between them they place every fixed surface
      // on the screen the person is actually looking at.
      const top = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
      document.documentElement.style.setProperty('--vv-top', `${top}px`);
      const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      document.documentElement.style.setProperty('--kb', `${kb}px`);""",
    ),
]


def main(path):
    src = open(path, encoding="utf8").read()
    for i, (old, new) in enumerate(SUBS, 1):
        n = src.count(old)
        assert n == 1, f"substitution {i} matched {n} times in {path}"
        src = src.replace(old, new)
    open(path, "w", encoding="utf8").write(src)
    print(f"patched {path}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        main(p)
