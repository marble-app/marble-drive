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
      .marble-marks-main, .marble-marks-strip, .marble-marks-tool, .marble-marks-tool::after { transition: none; }
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
    main.addEventListener('click', toggle);

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

    const collectBoxes = () => {
      const els = [...document.querySelectorAll('[data-marble-id]')].filter((el) =>
        el !== document.body && el !== document.documentElement && !el.closest(`[${TRANSIENT}]`) && el.getRootNode() === document);
      const known = new Set(els);
      return els.map((el) => {
        const r = el.getBoundingClientRect();
        const parent = el.parentElement?.closest('[data-marble-id]');
        return {
          id: el.getAttribute('data-marble-id'),
          parent: parent && known.has(parent) ? parent.getAttribute('data-marble-id') : null,
          left: r.left, top: r.top, width: r.width, height: r.height,
        };
      });
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

    // Set on scroll and cleared inside `frame`: a scrolling document moves
    // every box, but recomputing them all is real work, so a momentum
    // scroll pays for one pass per frame rather than one per scroll event.
    let boxesDirty = false;
    const rectOf = (d) => ({
      left: Math.min(d.x0, d.x1), top: Math.min(d.y0, d.y1),
      width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0),
    });
    const frame = () => {
      if (!drag) return;
      drag.raf = 0;
      if (boxesDirty) { drag.boxes = collectBoxes(); boxesDirty = false; }
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
      paintHits([], []);
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
      drag = { id: event.pointerId, x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY, boxes: collectBoxes(), ids: [], raf: 0 };
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
      frame();
      const ids = drag.ids;
      const prior = event.type === 'pointerup' && event.shiftKey ? agent.context().selection : [];
      endDrag();
      const union = [...prior, ...ids.filter((id) => !prior.includes(id))];
      agent.select(union.length ? union : null);
      fromMarquee = union.length > 0;
      if (!pinned) setMode(null);
    };
    overlay.addEventListener('pointerup', finish);
    overlay.addEventListener('pointercancel', finish);
    // Wheel passes through the overlay and the page moves under the drag.
    addEventListener('scroll', () => { if (drag) { boxesDirty = true; scheduleFrame(); } }, true);

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
    const launcherRect = () => document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')?.getBoundingClientRect() ?? null;
    const stored = localStorage.getItem(cornerKey(app));
    let corner = CORNERS.has(stored) ? stored : 'br';
    bar.dataset.corner = corner;
    let pos = { x: 0, y: 0 };
    const restingPoint = (which) => {
      const e = edges();
      // SIZE, not bar.offsetWidth/offsetHeight: the bar is display:none while
      // the drawer is open and unpinned (below), and a resize during that
      // window would otherwise compute the rest from a zero-size box —
      // landing flush in the corner and staying there once the bar reappears,
      // since nothing else re-settles it.
      const x = which.endsWith('l') ? e.left + PAD : e.right - PAD - SIZE;
      let y = which.startsWith('t') ? e.top + PAD : e.bottom - PAD - SIZE;
      // A document with agents off, or the Agents page, has no drawer to clear.
      const l = launcherRect();
      if (l) {
        const overlaps = x < l.right && x + SIZE > l.left && y < l.bottom && y + SIZE > l.top;
        // Stack clear of it instead of sitting on it: up from a bottom
        // corner, down from a top one. The corner now reads bottom-up as
        // launcher, toolbar, and — later — a callout with nothing to point at.
        if (overlaps) y = which.startsWith('t') ? l.bottom + GAP : l.top - GAP - SIZE;
      }
      return { x, y };
    };
    const paint = () => { bar.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`; };
    // Overridden in Task 6 to stay out of the way of a drag or a flight.
    let settle = () => { pos = restingPoint(corner); paint(); };
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; settle(); syncHidden(); }); };
    addEventListener('resize', schedule);
    // The dock changes <html>'s width without a resize event.
    new ResizeObserver(schedule).observe(document.documentElement);
    settle();

    // The marks layer is a top-layer popover, so an unpinned drawer panel
    // would otherwise float underneath the toolbar's own corner — a card
    // parked on top of the very conversation it covers. Pinned is different:
    // the page is docked and the toolbar belongs to the page's own area,
    // already tracked by edges() above, so it moves in with the edge rather
    // than hiding. On a phone the drawer is never pinned, so this one rule
    // also covers the phone-sheet case the brief asked for separately.
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
    // silently never attach, with no error to point at why.
    const drawerRoot = drawerHost()?.shadowRoot;
    if (drawerRoot) new MutationObserver(syncHidden).observe(drawerRoot, { subtree: true, attributes: true, attributeFilter: ['data-pinned'] });
    syncHidden();
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
