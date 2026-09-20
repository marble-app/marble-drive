"""Two fixes to the callout layer.

1. `x` closes. It used to fold, which is what a chevron is for; a cross that
   leaves the thing on screen is a cross that lied. Folding keeps its own
   button, and a closed callout stays closed for this tab.
2. Motion. Everything in the layer appeared and vanished on a frame. The
   handle, the card, the pill and the pick outline now fade and settle, and
   a card folding to a pill travels between the two shapes.

Exact substitutions, each asserted to match once, so a moved anchor fails
loudly rather than landing crooked.
"""
import sys

EDITS = [
    # ---------------------------------------------------------------- motion vocabulary
    (
        """  const HANDLE_DELAY = 180;
  const CARD_WIDTH = 440;
  const GAP = 12;
  const PAD = 12;
""",
        """  const HANDLE_DELAY = 180;
  const CARD_WIDTH = 440;
  const GAP = 12;
  const PAD = 12;
  // One duration and one curve for the whole layer, so a handle, a card and
  // a pill all arrive at the same speed and read as one piece of furniture.
  const MOTION = 180;
  const EASE = 'cubic-bezier(.2, .8, .3, 1)';
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');
""",
    ),
    # ---------------------------------------------------------------- handle: fade and pop
    (
        """    .marble-callout-handle {
      position: fixed; width: 22px; height: 22px; border-radius: 50%; border: 0; padding: 0;
      background: var(--callout-mark); box-shadow: 0 1px 4px rgba(0,0,0,.28); cursor: pointer;
      pointer-events: auto; display: grid; place-items: center;
    }
    .marble-callout-handle::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #fff; }
    .marble-callout-handle[hidden] { display: none; }
""",
        """    .marble-callout-handle {
      position: fixed; width: 22px; height: 22px; border-radius: 50%; border: 0; padding: 0;
      background: var(--callout-mark); box-shadow: 0 1px 4px rgba(0,0,0,.28); cursor: pointer;
      pointer-events: auto; display: grid; place-items: center;
      opacity: 1; transform: none;
      /* It grows out of the corner it hangs from, not out of its own middle:
         scaling about the centre walks the disc away from the selection it
         is pointing at, and a handle that arrives somewhere other than where
         it settles is a handle you reach for twice.
         allow-discrete is what lets display:none take part, so the handle can
         fade out instead of being cut. The overshoot is only on the way in:
         something offering itself may bounce, something leaving may not. */
      transform-origin: top left;
      transition: opacity 130ms ease, transform 160ms cubic-bezier(.2, .9, .35, 1.35),
                  display 160ms allow-discrete;
    }
    @starting-style { .marble-callout-handle { opacity: 0; transform: scale(.4); } }
    .marble-callout-handle::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #fff; }
    .marble-callout-handle[hidden] { display: none; opacity: 0; transform: scale(.4); }
    .marble-callout-handle:hover { transform: scale(1.12); }
""",
    ),
    # ---------------------------------------------------------------- card: rise in, settle out
    (
        """      box-shadow: 0 8px 28px rgba(0,0,0,.18); display: flex; flex-direction: column; overflow: hidden;
    }
""",
        """      box-shadow: 0 8px 28px rgba(0,0,0,.18); display: flex; flex-direction: column; overflow: hidden;
      opacity: 1; transform: none;
      transition: opacity ${MOTION}ms ease, transform ${MOTION}ms ${EASE},
                  border-radius ${MOTION}ms ${EASE}, display ${MOTION}ms allow-discrete;
    }
    /* Arriving and leaving are the same small move, run in opposite
       directions: up from under the line it is about, back down into it. */
    @starting-style { .marble-callout { opacity: 0; transform: translateY(8px) scale(.98); } }
    .marble-callout[hidden] { display: none; opacity: 0; transform: translateY(4px); }
    .marble-callout.is-out { opacity: 0; transform: translateY(8px) scale(.98); pointer-events: none; }
""",
    ),
    # ---------------------------------------------------------------- pill: fold button steps aside
    (
        """    .marble-callout[data-state="pill"] marble-conversation,
    .marble-callout[data-state="pill"] .marble-callout-actions { display: none; }
""",
        """    .marble-callout[data-state="pill"] marble-conversation,
    .marble-callout[data-state="pill"] .marble-callout-fold,
    .marble-callout[data-state="pill"] .marble-callout-actions { display: none; }
    /* The body crossfades while the box travels, so folding reads as one
       move rather than a resize with a hole in it. */
    .marble-callout marble-conversation { transition: opacity 120ms ease; }
    .marble-callout[data-state="pill"] marble-conversation { opacity: 0; }
""",
    ),
    # ---------------------------------------------------------------- pick outline: glide and fade
    (
        """    .marble-callout-pick { position: fixed; pointer-events: none; border: 1.5px solid var(--callout-mark); border-radius: 6px; }
    .marble-callout-pick[hidden] { display: none; }
""",
        """    .marble-callout-pick {
      position: fixed; pointer-events: none; border: 1.5px solid var(--callout-mark); border-radius: 6px;
      opacity: 1;
      /* It glides between blocks rather than teleporting: the outline is one
         pointer, moving, not a new box each time the pointer crosses a line. */
      transition: opacity 110ms ease, left 130ms ${EASE}, top 130ms ${EASE},
                  width 130ms ${EASE}, height 130ms ${EASE}, display 130ms allow-discrete;
    }
    @starting-style { .marble-callout-pick { opacity: 0; } }
    .marble-callout-pick[hidden] { display: none; opacity: 0; }
""",
    ),
    # ---------------------------------------------------------------- reduced motion
    (
        """    @media (prefers-reduced-motion: reduce) { .marble-callout[data-live] .marble-callout-live { animation: none; } }
""",
        """    @media (prefers-reduced-motion: reduce) {
      .marble-callout[data-live] .marble-callout-live { animation: none; }
      .marble-callout, .marble-callout-handle, .marble-callout-pick,
      .marble-callout marble-conversation { transition: none; }
      .marble-callout-handle:hover { transform: none; }
    }
""",
    ),
    # ---------------------------------------------------------------- morph + vanish helpers
    (
        """    function setState(record, state) {
      record.state = state;
      record.el.dataset.state = state;
      rememberFold(record.id, state === 'pill');
      if (state === 'pill') paintPill(record);
      else if (!record.zone && !record.said && !record.actions.childElementCount) record.status.textContent = 'Ask about this';
      syncDock(record);
      placeCard(record);
    }

    function remove(record) {
      record.off?.();
      record.el.remove();
      const at = records.indexOf(record);
      if (at >= 0) records.splice(at, 1);
      placeHandle();
    }
""",
        """    function applyState(record, state) {
      record.state = state;
      record.el.dataset.state = state;
      rememberFold(record.id, state === 'pill');
      if (state === 'pill') paintPill(record);
      else if (!record.zone && !record.said && !record.actions.childElementCount) record.status.textContent = 'Ask about this';
      syncDock(record);
      placeCard(record);
    }

    /** Card to pill and back. The box is measured either side of the change
     *  and animated between the two rectangles — not scaled, which would
     *  stretch the words inside it, but really resized, with the card's own
     *  overflow doing the hiding. */
    function morph(record, apply) {
      const el = record.el;
      const was = el.dataset.state;
      if (stillness.matches || !el.isConnected || !was || was === record.state) { apply(); return; }
      const before = el.getBoundingClientRect();
      apply();
      const after = el.getBoundingClientRect();
      const still = Math.abs(before.width - after.width) < 1 && Math.abs(before.height - after.height) < 1
        && Math.abs(before.left - after.left) < 1 && Math.abs(before.top - after.top) < 1;
      if (still) return;
      el.animate([
        { width: `${before.width}px`, height: `${before.height}px`, left: `${before.left}px`, top: `${before.top}px` },
        { width: `${after.width}px`, height: `${after.height}px`, left: `${after.left}px`, top: `${after.top}px` },
      ], { duration: MOTION, easing: EASE });
    }

    function setState(record, state) {
      morph(record, () => applyState(record, state));
    }

    /** Let a thing finish leaving before it is gone. The timer is the net:
     *  a transition on an element the browser never painted never ends. */
    function vanish(el, then) {
      if (stillness.matches || !el.isConnected) { then(); return; }
      el.classList.add('is-out');
      let done = false;
      const finish = () => { if (done) return; done = true; then(); };
      el.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, MOTION + 80);
    }

    function remove(record) {
      record.off?.();
      // Undock on the way out. A card shut while the agent is still working
      // here would otherwise take the zone's label with it and give nothing
      // back, leaving a box on the page that no longer says whose it is.
      record.zone = null;
      syncDock(record);
      record.el.hidden = false;
      const at = records.indexOf(record);
      if (at >= 0) records.splice(at, 1);
      vanish(record.el, () => record.el.remove());
      placeHandle();
    }
""",
    ),
    # ---------------------------------------------------------------- x closes, a chevron folds
    (
        """      tools.append(beside, inAgents, button('×', 'Fold', () => setState(record, 'pill')));
""",
        """      const fold = button('⌄', 'Fold', () => setState(record, 'pill'));
      fold.className = 'marble-callout-fold';
      tools.append(beside, inAgents, fold, button('×', 'Close', () => dismiss(record)));
""",
    ),
    # ---------------------------------------------------------------- dismiss
    (
        """    // Seeing it and saying done is reviewing it — the rule the Focus pane
    // already uses. The trail goes with the review.
    async function done(record) {
""",
        """    // A closed callout stays closed for this tab. Without this the next
    // rehydration would hand back the very thing you just shut.
    const SHUT_KEY = `marble-callout-shut:${app}`;
    const shutIds = () => {
      try { return new Set(JSON.parse(sessionStorage.getItem(SHUT_KEY) || '[]')); } catch { return new Set(); }
    };
    function rememberShut(id) {
      if (!id) return;
      const set = shutIds();
      set.add(id);
      try { sessionStorage.setItem(SHUT_KEY, JSON.stringify([...set])); } catch { /* private mode */ }
    }

    /** × is close, and close means gone from this page. The chat is not gone:
     *  Open beside and the Agents page still reach it. A chat that has
     *  finished is marked reviewed too, because shutting the thing that was
     *  showing you the work is how you say you have seen it — but a turn
     *  still running has not been seen yet, so its review waits. */
    function dismiss(record) {
      const id = record.id;
      const working = record.el.hasAttribute('data-live');
      remove(record);
      if (!id) return;
      rememberShut(id);
      rememberFold(id, false);
      if (working) return;
      Promise.resolve(agent.markReviewed(id)).catch(() => {});
      document.dispatchEvent(new CustomEvent('marble-callout:reviewed', { detail: { id } }));
    }

    // Seeing it and saying done is reviewing it — the rule the Focus pane
    // already uses. The trail goes with the review.
    async function done(record) {
""",
    ),
    # ---------------------------------------------------------------- a shut chat is not mine
    (
        """    const mine = (summary) => summary.target === app && !summary.archived
      && (summary.status === 'running' || summary.asking || summary.needsReview);
""",
        """    const mine = (summary) => summary.target === app && !summary.archived
      && !shutIds().has(summary.id)
      && (summary.status === 'running' || summary.asking || summary.needsReview);
""",
    ),
]


def main(path):
    src = open(path, encoding="utf-8").read()
    for old, new in EDITS:
        hits = src.count(old)
        assert hits == 1, f"expected 1 match, found {hits} for:\n{old[:90]}..."
        src = src.replace(old, new)
    open(path, "w", encoding="utf-8").write(src)
    print(f"{path}: {len(EDITS)} edits applied")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "runtime/agent-callout.js")
