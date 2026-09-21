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

    @media (prefers-reduced-transparency: reduce) {
      .marble-marks-main, .marble-marks-strip {
        background: var(--marks-paper);
        -webkit-backdrop-filter: none; backdrop-filter: none;
        border: 1px solid color-mix(in srgb, var(--marks-ink) 18%, transparent);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .marble-marks-main { transition: none; }
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

    // ------------------------------------------------------------ the corner
    //
    // The page's edge, not the viewport's: a pinned drawer takes the right
    // side of <html> with a margin, and a toolbar under the drawer is lost.

    const edges = () => {
      const r = document.documentElement.getBoundingClientRect();
      return { left: Math.max(0, r.left), right: Math.min(innerWidth, r.right), top: 0, bottom: innerHeight };
    };
    const stored = localStorage.getItem(cornerKey(app));
    let corner = CORNERS.has(stored) ? stored : 'br';
    bar.dataset.corner = corner;
    let pos = { x: 0, y: 0 };
    const restingPoint = (which) => {
      const e = edges();
      return {
        x: which.endsWith('l') ? e.left + PAD : e.right - PAD - bar.offsetWidth,
        y: which.startsWith('t') ? e.top + PAD : e.bottom - PAD - bar.offsetHeight,
      };
    };
    const paint = () => { bar.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`; };
    // Overridden in Task 6 to stay out of the way of a drag or a flight.
    let settle = () => { pos = restingPoint(corner); paint(); };
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; settle(); }); };
    addEventListener('resize', schedule);
    // The dock changes <html>'s width without a resize event.
    new ResizeObserver(schedule).observe(document.documentElement);
    settle();

    // On a phone the drawer is a sheet from the bottom; the toolbar yields.
    const drawerOpen = () => PHONE.matches && Boolean(document.querySelector('marble-agent-drawer[data-open-state="open"]'));
    const syncHidden = () => { bar.hidden = drawerOpen(); };
    new MutationObserver(syncHidden).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-open-state'] });
    PHONE.addEventListener('change', syncHidden);
    syncHidden();
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
