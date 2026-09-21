// The marks toolbar: mark a document up, then hand the marks to an agent.
//
// A floating button at a corner of any document. It opens into the tools —
// Select in this phase — and each tool is a mode the page is put in and taken
// out of. Everything drawn here is transient chrome in one fixed layer, like
// the callout; no document is edited to get it. Select leaves no mark of its
// own: it names elements and the callout takes them from there.
//
// Spec: docs/superpowers/specs/2026-09-20-marks-toolbar-for-every-app-design.md

(() => {
  const TRANSIENT = 'data-marble-transient';
  const PHONE = matchMedia('(max-width: 719px)');
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');
  const PAD = 16;
  const SIZE = 40;
  // The callout's spacing between stacked chrome.
  const GAP = 12;
  // The callout's curve, so the two layers move as one.
  const EASE = 'cubic-bezier(.2, .8, .3, 1)';
  const CORNERS = new Set(['tl', 'tr', 'bl', 'br']);
  const cornerKey = (app) => `marble-marks:corner:${app}`;
  const G = () => globalThis.marbleMarksGeometry;

  // The callout's mark: an outlined bubble with a beak. The toolbar says the
  // same thing the handle does — ask an agent about this — so it wears the
  // same glyph.
  const BUBBLE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6.5 15.1A8 8 0 1 1 10.9 18.2L4.9 21.1a.6.6 0 0 1-.72-.85Z"/></svg>';

  const STYLE = `
    .marble-marks-layer {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none;
      z-index: 2147483002;
      --marks-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)));
      --marks-paper: var(--card, var(--paper, #fff));
      --marks-ink: var(--ink, #222);
      /* Small text on glass: a touch heavier and wider than body text. */
      font: 500 12px/1.2 var(--ui-font, system-ui, -apple-system, sans-serif);
      letter-spacing: .01em;
      color: var(--marks-ink);
    }
    /* In the top layer so no document's stacking context can cover it; the UA
       sheet for [popover] would otherwise centre it and give it a border. */
    .marble-marks-layer:popover-open { position: fixed; inset: 0; }

    .marble-marks-bar {
      position: absolute; left: 0; top: 0; width: ${SIZE}px; height: ${SIZE}px;
      pointer-events: auto; will-change: transform;
    }
    .marble-marks-bar[hidden] { display: none; }
    .marble-marks-main {
      all: unset; box-sizing: border-box; position: relative;
      width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%;
      display: grid; place-items: center; cursor: grab; touch-action: none;
      color: var(--marks-mark);
      background: color-mix(in srgb, var(--marks-paper) 72%, transparent);
      -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 40%, transparent),
        0 1px 2px rgba(0, 0, 0, .08), 0 8px 24px rgba(0, 0, 0, .12);
      transition: transform 100ms ease-out;
    }
    .marble-marks-main:active, .marble-marks-bar[data-dragging] .marble-marks-main { transform: scale(.97); cursor: grabbing; }
    .marble-marks-main:focus-visible { outline: 2px solid var(--marks-mark); outline-offset: 2px; }
    .marble-marks-badge {
      position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 5px;
      border-radius: 9px; background: var(--marks-mark); color: var(--marks-paper);
      font-size: 11px; display: grid; place-items: center;
    }
    .marble-marks-badge[hidden] { display: none; }

    .marble-marks-strip {
      position: absolute; display: flex; flex-direction: column; gap: 2px; padding: 4px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--marks-paper) 72%, transparent);
      -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 40%, transparent),
        0 1px 2px rgba(0, 0, 0, .08), 0 12px 32px rgba(0, 0, 0, .14);
    }
    .marble-marks-strip[hidden] { display: none; }
    .marble-marks-bar[data-corner^="b"] .marble-marks-strip { bottom: calc(100% + 8px); }
    .marble-marks-bar[data-corner^="t"] .marble-marks-strip { top: calc(100% + 8px); }
    .marble-marks-bar[data-corner$="r"] .marble-marks-strip { right: 0; }
    .marble-marks-bar[data-corner$="l"] .marble-marks-strip { left: 0; }

    /* The strip materialises out of the button: blur, scale and opacity
       together, so it reads as a surface arriving rather than a fade. */
    .marble-marks-strip {
      opacity: 1; transform: scale(1); filter: blur(0);
      transition: opacity 300ms ${EASE}, transform 300ms ${EASE}, filter 300ms ${EASE},
                  display 300ms allow-discrete;
    }
    @starting-style { .marble-marks-strip { opacity: 0; transform: scale(.9); filter: blur(6px); } }
    .marble-marks-strip[hidden] { opacity: 0; transform: scale(.9); filter: blur(6px); }
    .marble-marks-bar[data-corner="br"] .marble-marks-strip { transform-origin: bottom right; }
    .marble-marks-bar[data-corner="bl"] .marble-marks-strip { transform-origin: bottom left; }
    .marble-marks-bar[data-corner="tr"] .marble-marks-strip { transform-origin: top right; }
    .marble-marks-bar[data-corner="tl"] .marble-marks-strip { transform-origin: top left; }

    .marble-marks-tool {
      all: unset; box-sizing: border-box; position: relative;
      width: 36px; height: 36px; border-radius: 10px;
      display: grid; place-items: center; cursor: pointer;
      color: var(--marks-ink);
      transition: transform 100ms ease-out, background 120ms ease, color 120ms ease;
    }
    .marble-marks-tool:hover { background: color-mix(in srgb, var(--marks-ink) 8%, transparent); }
    .marble-marks-tool:active { transform: scale(.97); }
    .marble-marks-tool:focus-visible { outline: 2px solid var(--marks-mark); outline-offset: 2px; }
    .marble-marks-tool[aria-pressed="true"] { background: var(--marks-mark); color: var(--marks-paper); }
    .marble-marks-tool svg { width: 20px; height: 20px; }
    /* The label sits on the side away from the page edge. */
    .marble-marks-tool::after {
      content: attr(data-label); position: absolute; top: 50%; transform: translateY(-50%);
      white-space: nowrap; padding: 4px 8px; border-radius: 6px;
      background: color-mix(in srgb, var(--marks-ink) 88%, transparent); color: var(--marks-paper);
      opacity: 0; pointer-events: none; transition: opacity 120ms ease;
    }
    .marble-marks-tool:hover::after, .marble-marks-tool:focus-visible::after { opacity: 1; }
    .marble-marks-bar[data-corner$="r"] .marble-marks-tool::after { right: calc(100% + 10px); }
    .marble-marks-bar[data-corner$="l"] .marble-marks-tool::after { left: calc(100% + 10px); }

    /* Inside a mode the overlay takes the pointer and nothing else changes:
       wheel still scrolls the page under it. Pinch still works too; a single
       finger is claimed for the marquee drag rather than left free to pan —
       dropping touch-action entirely would let the browser start that pan on
       the first touch, before the first pointermove ever reaches here. */
    .marble-marks-overlay { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; touch-action: pinch-zoom; }
    .marble-marks-overlay[hidden] { display: none; }
    .marble-marks-marquee {
      position: fixed; pointer-events: none; border-radius: 2px;
      border: 1px solid var(--marks-mark);
      background: color-mix(in srgb, var(--marks-mark) 8%, transparent);
    }
    .marble-marks-marquee[hidden] { display: none; }
    /* The same outline the callout's pick mode draws, one per element the
       rectangle means, repainted every frame of the drag. */
    .marble-marks-hit { position: fixed; pointer-events: none; border: 1.5px solid var(--marks-mark); border-radius: 6px; }
    .marble-marks-hit[hidden] { display: none; }

    @media (prefers-reduced-transparency: reduce) {
      .marble-marks-main, .marble-marks-strip {
        background: var(--marks-paper);
        -webkit-backdrop-filter: none; backdrop-filter: none;
        border: 1px solid color-mix(in srgb, var(--marks-ink) 18%, transparent);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .marble-marks-main, .marble-marks-tool, .marble-marks-tool::after { transition: none; }
      /* §5.7: every spring and slide becomes a cross-fade — a cross-fade, not
         a blink. The strip keeps its opacity transition and loses only the
         two properties that move it, the way the throw fades to its corner
         instead of springing there. */
      .marble-marks-strip {
        transition: opacity 300ms ${EASE}, display 300ms allow-discrete;
      }
      .marble-marks-strip, .marble-marks-strip[hidden] { transform: none; filter: none; }
    }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app || !G()) return;
    // The Agents page is the orchestration view already; a toolbar for
    // briefing agents has no place on the page made of them.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-marks-layer')) return;
    const app = marble.app;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);

    const layer = document.createElement('div');
    layer.className = 'marble-marks-layer';
    layer.setAttribute(TRANSIENT, '');
    layer.setAttribute('popover', 'manual');
    document.documentElement.append(layer);
    try { layer.showPopover(); } catch { /* no popover here: fixed positioning still stands */ }

    // ------------------------------------------------------------ the toolbar

    const bar = document.createElement('div');
    bar.className = 'marble-marks-bar';
    bar.setAttribute(TRANSIENT, '');

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'marble-marks-main';
    main.setAttribute('aria-label', 'Mark up this page for an agent');
    main.setAttribute('aria-expanded', 'false');
    main.innerHTML = BUBBLE;

    const badge = document.createElement('span');
    badge.className = 'marble-marks-badge';
    badge.hidden = true;
    main.append(badge);

    const strip = document.createElement('div');
    strip.className = 'marble-marks-strip';
    strip.setAttribute('role', 'toolbar');
    strip.setAttribute('aria-label', 'Marks');
    strip.hidden = true;

    bar.append(main, strip);
    layer.append(bar);

    const GLYPHS = {
      select: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5"/></svg>',
    };
    const tool = (name, label, glyph) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'marble-marks-tool';
      button.dataset.tool = name;
      button.dataset.label = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = glyph;
      strip.append(button);
      return button;
    };
    const selectTool = tool('select', 'Select', GLYPHS.select);

    const expand = () => { strip.hidden = false; main.setAttribute('aria-expanded', 'true'); };
    const collapse = () => { strip.hidden = true; main.setAttribute('aria-expanded', 'false'); };
    const toggle = () => (strip.hidden ? expand() : collapse());

    // ------------------------------------------------------------ modes
    //
    // A tool is a mode the page is put in. The overlay under the toolbar
    // takes the pointer while a mode is on; Escape, or the tool again, gives
    // it back. Later phases add Comment and Sketch through the same switch.

    const overlay = document.createElement('div');
    overlay.className = 'marble-marks-overlay';
    overlay.setAttribute(TRANSIENT, '');
    overlay.hidden = true;
    const marquee = document.createElement('div');
    marquee.className = 'marble-marks-marquee';
    marquee.setAttribute(TRANSIENT, '');
    marquee.hidden = true;
    const hits = [];
    // Under the bar, so the toolbar stays clickable inside a mode.
    bar.before(overlay, marquee);

    let mode = null;
    let pinned = false;
    let drag = null;
    let fromMarquee = false;
    const tools = { select: selectTool };

    // ------------------------------------------------------------ boxes

    // Real documents here are not the size of a test fixture: the Pattern
    // Atlas carries 21,587 addressed elements and a dozen more documents are
    // past 1,500. Two things keep that from landing on a drag.
    //
    // The first is scope. The marquee is `position: fixed`, so a rectangle
    // drawn in it can only ever mean something on screen: every box whose
    // rect misses the viewport is dropped, and what reaches the geometry is
    // the page you can see rather than the page you have. Off-screen
    // *ancestors* of a box that was kept stay, because the coalescing rule
    // reads the parent chain and a chain with a hole in it would coalesce
    // wrongly. An addressed child scrolled out of view is simply not there,
    // so a rectangle over everything visible can name the parent — which is
    // what a person dragging over all of something means.
    //
    // The second is the parent walk. `closest()` on every element walks to
    // the root every time; `querySelectorAll` hands them back in document
    // order, so a stack of open ancestors answers the same question in one
    // pass. `contains` on the way down is the only comparison it costs.
    const collectBoxes = () => {
      const els = [...document.querySelectorAll('[data-marble-id]')].filter((el) =>
        el !== document.body && el !== document.documentElement && !el.closest(`[${TRANSIENT}]`) && el.getRootNode() === document);
      const parentOf = new Map();
      const rects = new Map();
      const open = [];
      for (const el of els) {
        while (open.length && !open[open.length - 1].contains(el)) open.pop();
        parentOf.set(el, open[open.length - 1] ?? null);
        open.push(el);
        rects.set(el, el.getBoundingClientRect());
      }
      const keep = new Set();
      for (const el of els) {
        const r = rects.get(el);
        if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
        keep.add(el);
        for (let p = parentOf.get(el); p && !keep.has(p); p = parentOf.get(p)) keep.add(p);
      }
      const out = [];
      for (const el of els) {
        if (!keep.has(el)) continue;
        const r = rects.get(el);
        out.push({
          id: el.getAttribute('data-marble-id'),
          parent: parentOf.get(el)?.getAttribute('data-marble-id') ?? null,
          left: r.left, top: r.top, width: r.width, height: r.height,
        });
      }
      return out;
    };
    const paintHits = (ids, boxes) => {
      const byId = new Map(boxes.map((box) => [box.id, box]));
      ids.forEach((id, i) => {
        let hit = hits[i];
        if (!hit) {
          hit = document.createElement('div');
          hit.className = 'marble-marks-hit';
          hit.setAttribute(TRANSIENT, '');
          hits.push(hit);
          marquee.before(hit);
        }
        const box = byId.get(id);
        Object.assign(hit.style, { left: `${box.left - 3}px`, top: `${box.top - 3}px`, width: `${box.width + 6}px`, height: `${box.height + 6}px` });
        hit.hidden = false;
      });
      for (let i = ids.length; i < hits.length; i += 1) hits[i].hidden = true;
    };

    // ------------------------------------------------------------ Select

    const rectOf = (d) => ({
      left: Math.min(d.x0, d.x1), top: Math.min(d.y0, d.y1),
      width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0),
    });
    // A page scrolling under a drag moves every box the same distance, and
    // the boxes are in client coordinates, so the scroll is a pure shift:
    // translating what was measured at the press costs nothing, where
    // re-measuring a long document costs the frame. What the shift cannot
    // know is a `position: fixed` element, which does not move with the page
    // — `finish` measures again before any id is committed for exactly that
    // reason.
    const shiftBoxes = () => {
      if (!drag) return;
      const dx = scrollX - drag.scrollX;
      const dy = scrollY - drag.scrollY;
      if (!dx && !dy) return;
      for (const box of drag.boxes) { box.left -= dx; box.top -= dy; }
      drag.scrollX = scrollX;
      drag.scrollY = scrollY;
    };
    const frame = () => {
      if (!drag) return;
      drag.raf = 0;
      shiftBoxes();
      const r = rectOf(drag);
      Object.assign(marquee.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      drag.ids = G().idsInRect(r, drag.boxes);
      paintHits(drag.ids, drag.boxes);
    };
    const scheduleFrame = () => { if (drag && !drag.raf) drag.raf = requestAnimationFrame(frame); };
    // The one place a drag ends: cancel its pending frame, blank the marquee
    // and every outline, and let go of the state. `setMode` calls this when
    // a mode is left mid-drag — Escape, or the tool clicked again — and
    // `finish` calls it once the pointer itself has come up, so there is one
    // place that knows how a drag ends rather than two copies of it.
    const endDrag = () => {
      if (!drag) return;
      cancelAnimationFrame(drag.raf);
      drag = null;
      marquee.hidden = true;
      // The pool lives for the drag, not for the page: it grows to the
      // largest selection ever painted, and on a document of thousands of
      // addressed elements that is thousands of divs left in the layer.
      for (const hit of hits.splice(0)) hit.remove();
    };

    // ------------------------------------------------------------ the switch

    const setMode = (next) => {
      // A mode being left never leaves its drag behind: hiding the overlay
      // below takes it out of hit-testing (and drops its pointer capture
      // with it), so a pointerup after this point would never reach
      // `finish` — this is the only other place a drag ends, and it is a
      // no-op when none is running.
      endDrag();
      mode = next;
      layer.dataset.mode = next ?? '';
      overlay.hidden = !next;
      for (const [name, button] of Object.entries(tools)) button.setAttribute('aria-pressed', String(name === next));
      if (!next) { pinned = false; delete layer.dataset.pinned; }
    };
    const pin = (name) => { setMode(name); pinned = true; layer.dataset.pinned = ''; };

    overlay.addEventListener('pointerdown', (event) => {
      if (mode !== 'select' || event.button !== 0 || drag) return;
      // The page never sees this press: no text selection starts under it.
      event.preventDefault();
      overlay.setPointerCapture(event.pointerId);
      // Picking the tool leaves the strip up, so it can still be pinned or
      // swapped for another; the corner is only busy once a drag starts.
      collapse();
      drag = {
        id: event.pointerId, x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY,
        boxes: collectBoxes(), scrollX, scrollY, ids: [], raf: 0,
      };
      marquee.hidden = false;
      frame();
    });
    overlay.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag.x1 = event.clientX;
      drag.y1 = event.clientY;
      scheduleFrame();
    });
    const finish = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      cancelAnimationFrame(drag.raf);
      drag.raf = 0;
      // The release point, not the last move: a finger usually travels a few
      // pixels between the two, and the rectangle a person let go of is the
      // one they meant.
      drag.x1 = event.clientX;
      drag.y1 = event.clientY;
      // Measured again, once, before anything is committed. The live outline
      // follows a scroll by translating the boxes from the press, which is
      // wrong for a `position: fixed` element that stayed where it was — so
      // the outline may drift a pixel mid-scroll, while the ids handed to an
      // agent are always measured fresh. A briefly wrong outline and a wrong
      // id reaching an agent are not mistakes of the same order.
      drag.boxes = collectBoxes();
      drag.scrollX = scrollX;
      drag.scrollY = scrollY;
      frame();
      const ids = drag.ids;
      const prior = event.shiftKey ? agent.context().selection : [];
      endDrag();
      const union = [...prior, ...ids.filter((id) => !prior.includes(id))];
      agent.select(union.length ? union : null);
      fromMarquee = union.length > 0;
      if (!pinned) setMode(null);
    };
    overlay.addEventListener('pointerup', finish);
    // A cancel is not a release: a pinch during a marquee — which the
    // overlay's `touch-action: pinch-zoom` invites — takes the pointer away
    // mid-rectangle, and committing the half-drawn one would name whatever
    // the hand happened to be over. Escape mid-drag discards; so does this.
    overlay.addEventListener('pointercancel', (event) => { if (drag && event.pointerId === drag.id) endDrag(); });
    // Wheel passes through the overlay and the page moves under the drag.
    addEventListener('scroll', () => { if (drag) scheduleFrame(); }, true);

    // Escape inside a mode leaves it; Escape with a marquee selection standing
    // clears it, as Escape clears Option-picks.
    addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (mode) { event.preventDefault(); event.stopPropagation(); setMode(null); return; }
      if (fromMarquee) { fromMarquee = false; agent.select(null); }
    }, true);
    // A fresh text selection is the person choosing something else.
    document.addEventListener('selectionchange', () => {
      const sel = getSelection();
      if (!fromMarquee || !sel || sel.isCollapsed || !sel.rangeCount) return;
      const node = sel.anchorNode;
      const anchor = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!anchor || anchor.closest(`[${TRANSIENT}]`)) return;
      fromMarquee = false;
      agent.select(null);
    });

    setMode(null);
    selectTool.addEventListener('click', () => setMode(mode === 'select' ? null : 'select'));
    selectTool.addEventListener('dblclick', () => pin('select'));

    // ------------------------------------------------------------ the drawer
    //
    // The marks layer is a top-layer popover, so an unpinned drawer panel
    // would otherwise float underneath the toolbar's own corner — a card
    // parked on top of the very conversation it covers. Pinned is different:
    // the page is docked and the toolbar belongs to the page's own area,
    // already tracked by edges() below, so it moves in with the edge rather
    // than hiding. On a phone the drawer is never pinned, so this one rule
    // also covers the phone-sheet case the brief asked for separately.
    //
    // This block comes before the corner's because the corner's code reads
    // it: `schedule` calls `syncHidden`, and the launcher is measured
    // through `drawerHost`. It used to sit below, and worked only because a
    // ResizeObserver never calls back synchronously.
    const drawerHost = () => document.querySelector('marble-agent-drawer');
    const drawerPanel = () => drawerHost()?.shadowRoot?.querySelector('.panel') ?? null;
    const drawerOpen = () => {
      const host = drawerHost();
      if (!host?.hasAttribute('data-open-state')) return false;
      return drawerPanel()?.dataset.pinned !== 'true';
    };
    const syncHidden = () => { bar.hidden = drawerOpen(); };
    new MutationObserver(syncHidden).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-open-state'] });
    // Captured once, not re-read on demand: this is guaranteed non-null by
    // the injection order in server/app.js — agent-ui.js's script tag (and so
    // its drawer mount) always runs before this file's — so the shadow root
    // already exists here. Reordering those tags would make this observer
    // silently never attach, with no error to point at why; the order is
    // held by a line in test/agent-http.test.js.
    const drawerRoot = drawerHost()?.shadowRoot;
    if (drawerRoot) new MutationObserver(syncHidden).observe(drawerRoot, { subtree: true, attributes: true, attributeFilter: ['data-pinned'] });
    syncHidden();

    // ------------------------------------------------------------ the corner
    //
    // The page's edge, not the viewport's: a pinned drawer takes the right
    // side of <html> with a margin, and a toolbar under the drawer is lost.

    const edges = () => {
      const r = document.documentElement.getBoundingClientRect();
      return { left: Math.max(0, r.left), right: Math.min(innerWidth, r.right), top: 0, bottom: innerHeight };
    };
    // The drawer's own launcher already lives in this corner (its CSS is in
    // runtime/agent-ui.js). Its box does not move when the drawer opens —
    // only its opacity does — so measuring it here is stable, and the
    // toolbar never jumps once it has settled clear of it.
    const launcherRect = () => drawerHost()?.shadowRoot?.querySelector('.launcher')?.getBoundingClientRect() ?? null;
    // `agent.storage`, not `localStorage`: it is the try/catch every other
    // runtime file here reads and writes through. Raw storage throws where a
    // person has it turned off, and this read runs during boot — the whole
    // toolbar would fail to appear, with no toolbar-shaped error to find.
    const stored = agent.storage.get(cornerKey(app));
    let corner = CORNERS.has(stored) ? stored : 'br';
    bar.dataset.corner = corner;
    let pos = { x: 0, y: 0 };
    // The throw's state is declared here, not beside the throw below, because
    // `settle` is the one piece that has to know about it: nothing re-seats
    // the bar while a hand or a flight still has hold of it.
    let hold = null;
    let flight = 0;
    const restingPoint = (which) => {
      const e = edges();
      // A document with agents off, or the Agents page, has no drawer.
      const l = launcherRect();
      const centre = l?.width ? { x: l.left + l.width / 2, y: l.top + l.height / 2 } : null;
      // Where the launcher shares this corner, the toolbar takes its inset
      // from the launcher's measured box instead of from PAD, and the two
      // stand in one column. Three pieces of corner chrome at three insets
      // read as a staircase — and the insets are not even comparable: the
      // launcher's is `calc(20px + env(safe-area-inset-right))` and PAD is a
      // bare 16, so on a phone in landscape, where the safe area is about
      // 44px, the toolbar would sit beside the launcher rather than above it,
      // partly under the display cutout. Measuring the launcher inherits its
      // safe-area handling for free. PAD is the inset for a corner the
      // toolbar has to itself. A pinned drawer leaves the launcher outside
      // the page's own edges, which is one of those corners.
      const shared = Boolean(centre) && centre.x >= e.left && centre.x <= e.right
        && G().nearestCorner({ x: centre.x - e.left, y: centre.y - e.top }, { width: e.right - e.left, height: e.bottom - e.top }) === which;
      // SIZE, not bar.offsetWidth/offsetHeight: the bar is display:none while
      // the drawer is open and unpinned (above), and a resize during that
      // window would otherwise compute the rest from a zero-size box —
      // landing flush in the corner and staying there once the bar reappears,
      // since nothing else re-settles it.
      const x = shared ? centre.x - SIZE / 2 : (which.endsWith('l') ? e.left + PAD : e.right - PAD - SIZE);
      // Stack clear of the launcher instead of sitting on it: up from a
      // bottom corner, down from a top one. The corner reads bottom-up as
      // launcher, toolbar, and — later — a callout with nothing to point at.
      const y = shared
        ? (which.startsWith('t') ? l.bottom + GAP : l.top - GAP - SIZE)
        : (which.startsWith('t') ? e.top + PAD : e.bottom - PAD - SIZE);
      return { x, y };
    };
    const paint = () => { bar.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`; };
    // Resize and the dock re-seat the bar, unless a hand or a flight has it.
    const settle = () => { if (hold?.moved || flight) return; pos = restingPoint(corner); paint(); };
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; settle(); syncHidden(); }); };
    addEventListener('resize', schedule);
    // The dock changes <html>'s width without a resize event.
    new ResizeObserver(schedule).observe(document.documentElement);
    settle();

    // ------------------------------------------------------------ throwing it
    //
    // The button follows the pointer 1:1 from where it was grabbed. On
    // release the landing point is projected from the release velocity, the
    // nearest corner to that projection wins, and a spring with a little
    // bounce carries the bar there starting at the hand's speed — the only
    // motion in this layer that has momentum behind it.

    let justDragged = false;
    const stopFlight = () => { cancelAnimationFrame(flight); flight = 0; };
    const velocityOf = (history) => {
      if (history.length < 2) return { x: 0, y: 0 };
      const last = history[history.length - 1];
      const first = history.find((sample) => last.t - sample.t <= 120) ?? history[0];
      const dt = (last.t - first.t) / 1000;
      if (dt <= 0) return { x: 0, y: 0 };
      return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
    };
    const flyTo = (target, velocity) => {
      stopFlight();
      if (stillness.matches) {
        pos = target;
        paint();
        bar.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
        return;
      }
      let sx = { x: pos.x, v: velocity.x };
      let sy = { x: pos.y, v: velocity.y };
      let last = performance.now();
      const step = (now) => {
        // The spring substeps internally at a fixed rate, so this clamp is
        // no longer here for numerical stability — it exists so that a tab
        // returning from the background, where `now` can jump by seconds,
        // does not read as one enormous step of the throw.
        const dt = Math.min(0.032, Math.max(0.001, (now - last) / 1000));
        last = now;
        sx = G().spring(sx, target.x, dt, { damping: 0.8, response: 0.4 });
        sy = G().spring(sy, target.y, dt, { damping: 0.8, response: 0.4 });
        pos = { x: sx.x, y: sy.x };
        paint();
        if (G().settled(sx, target.x) && G().settled(sy, target.y)) {
          pos = target;
          paint();
          flight = 0;
          // A resize or a dock change that landed mid-flight was dropped by
          // `settle`'s own guard above; catch it up now that nothing is
          // holding the bar any more, instead of leaving it stale until the
          // next one.
          schedule();
          return;
        }
        flight = requestAnimationFrame(step);
      };
      flight = requestAnimationFrame(step);
    };
    main.addEventListener('pointerdown', (event) => {
      // A second touch while the first is still down would otherwise
      // overwrite `hold` out from under it: the first pointer's later
      // moves and its release would stop matching `hold.id` and be
      // silently dropped, and the drag would reassign to the second
      // pointer with the threshold and grab offset reset. The Select
      // overlay had the same bug and was fixed the same way.
      if (event.button !== 0 || hold) return;
      // A throw that was cancelled rather than released — the drawer opening
      // over the bar, the browser taking the pointer away — sets
      // `justDragged` and is never followed by the click that clears it, so
      // the flag would latch and swallow the next real tap. A press starts
      // clean.
      justDragged = false;
      main.setPointerCapture(event.pointerId);
      stopFlight();
      hold = { id: event.pointerId, sx: event.clientX, sy: event.clientY, gx: event.clientX - pos.x, gy: event.clientY - pos.y, moved: false, history: [] };
    });
    main.addEventListener('pointermove', (event) => {
      if (!hold || event.pointerId !== hold.id) return;
      if (!hold.moved) {
        if (Math.hypot(event.clientX - hold.sx, event.clientY - hold.sy) < 10) return;
        hold.moved = true;
        collapse();
        bar.dataset.dragging = '';
      }
      pos = { x: event.clientX - hold.gx, y: event.clientY - hold.gy };
      paint();
      hold.history.push({ x: event.clientX, y: event.clientY, t: performance.now() });
      if (hold.history.length > 8) hold.history.shift();
    });
    // The one place a hold ends — the way `endDrag` already serves both
    // `setMode` and `finish` for Select — so `release` and a capture lost
    // out from under it share one path rather than two copies of it.
    const endHold = () => {
      const done = hold;
      hold = null;
      delete bar.dataset.dragging;
      return done;
    };
    const release = (event) => {
      if (!hold || event.pointerId !== hold.id) return;
      const done = endHold();
      if (!done.moved) return;
      justDragged = true;
      const velocity = velocityOf(done.history);
      const e = edges();
      // SIZE, not bar.offsetWidth/offsetHeight, for the same reason
      // restingPoint() above measures with it: the bar can be display:none
      // here too if the drawer opened mid-drag, and a landing computed from
      // a zero-size box would put the corner test off by half the bar.
      const landing = { x: pos.x + G().project(velocity.x), y: pos.y + G().project(velocity.y) };
      corner = G().nearestCorner(
        { x: landing.x + SIZE / 2 - e.left, y: landing.y + SIZE / 2 - e.top },
        { width: e.right - e.left, height: e.bottom - e.top },
      );
      bar.dataset.corner = corner;
      // Wrapped for the same reason as the read above, and one more: a throw
      // here would abort the release before `flyTo` and strand the bar in
      // mid-air, where the hand let go of it.
      agent.storage.set(cornerKey(app), corner);
      flyTo(restingPoint(corner), velocity);
    };
    main.addEventListener('pointerup', release);
    main.addEventListener('pointercancel', release);
    // The drawer opening mid-drag hides `main`'s ancestor, and a hidden
    // element implicitly loses pointer capture per spec — with a
    // `lostpointercapture`, never a `pointerup` or a `pointercancel`.
    // Without this, `hold` would latch forever: `settle`'s guard above would
    // stay tripped, and the bar would freeze wherever the drag left it once
    // the drawer closed and un-hid it. The hand's velocity means nothing
    // once the browser took the pointer away on its own, so this resettles
    // the bar at the corner it already claims rather than throwing it to a
    // new one from a history that no longer reflects anything.
    main.addEventListener('lostpointercapture', (event) => {
      if (!hold || event.pointerId !== hold.id) return;
      const done = endHold();
      if (done.moved) settle();
    });
    main.addEventListener('click', () => {
      // The click after a throw is the hand letting go, not a press.
      if (justDragged) { justDragged = false; return; }
      toggle();
    });
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
