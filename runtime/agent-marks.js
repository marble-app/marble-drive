// Describe mode: the tools for saying what you want about a document, and the
// frame and field that carry what you said to an agent.
//
// One tray entry turns it on; the tools themselves live in a toolbar at the
// bottom of the screen, where a hand rests while the eye is on the page.
// Select is a marquee over addressed elements — and over the marks you made.
// Sketch is ink, read as a box, an arrow or a scribble. Text is a note stuck
// on the page. Explore asks for alternatives, which the document has its own
// element for, so the comparing is `agent-variations.js`'s job and not this
// one's.
//
// Nothing here edits the document: everything drawn is transient chrome in one
// fixed layer, like the callout. Nothing here invents a way to send, either —
// the field opens the callout's card at the same region with the words in it.
//
// Spec: docs/superpowers/specs/2026-09-21-describe-mode-design.md

(() => {
  const TRANSIENT = 'data-marble-transient';
  const G = () => globalThis.marbleMarksGeometry;
  // A stroke's points are thinned to this, so a slow hand over a long drag
  // does not store a thousand points that all say the same thing.
  const THIN = 1.5;
  // Under this much travel a press is a press, not a stroke.
  const SCRATCH = 10;
  const EASE = 'cubic-bezier(.2, .8, .3, 1)';

  const GLYPHS = {
    // The tray's one entry: a page with a hand's mark across it.
    describe: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M7.5 15c2.2-4.6 3.8-6.9 4.8-6.9 1.5 0 .3 6.9 1.8 6.9 1 0 1.9-1.4 2.6-4.2"/></svg>',
    // An area, drawn as the marquee itself; ink, drawn as a stroke that is
    // plainly a hand's; a note; a set of things that might have been; and the
    // way out.
    select: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5"/></svg>',
    sketch: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 16.2c2.6-6.4 4.6-9.6 6-9.6 2 0 .4 9.6 2.4 9.6 1.4 0 3.1-3.2 5.1-9.6"/><path d="M4 20.2h16"/></svg>',
    text: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5V5.5h14v2"/><path d="M12 5.5v13"/><path d="M9 18.5h6"/></svg>',
    adjust: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg>',
    explore: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="4" width="8" height="7" rx="2"/><rect x="13" y="4" width="8" height="7" rx="2"/><rect x="3" y="13" width="8" height="7" rx="2"/><rect x="13" y="13" width="8" height="7" rx="2"/></svg>',
    clear: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 18.5 4 14a1.6 1.6 0 0 1 0-2.3l7-7a1.6 1.6 0 0 1 2.3 0l5.2 5.2a1.6 1.6 0 0 1 0 2.3l-6.3 6.3z"/><path d="M9 20h11"/></svg>',
    done: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>',
  };

  const STYLE = `
    .marble-marks-layer {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none;
      z-index: 2147483002;
      --marks-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)));
      --marks-paper: var(--card, var(--paper, #fff));
      --marks-ink: var(--ink, #222);
      font: 400 13px/1.35 var(--ui-font, system-ui, -apple-system, sans-serif);
      color: var(--marks-ink);
    }
    /* In the top layer so no document's stacking context can cover it; the UA
       sheet for [popover] would otherwise centre it and give it a border. */
    .marble-marks-layer:popover-open { position: fixed; inset: 0; }

    /* Leaving Describe mode takes everything it drew with it — the ink, the
       notes, the frame, the field, the toolbar — and brings it all back on the
       way in. Nothing is thrown away: the marks are still in the layer, still
       in the brief, still naming their elements. What goes is the sight of
       them, because a page you have stopped marking up is a page you want to
       read.

       Opacity does the fading and visibility does the rest: without it the
       notes would still take the caret and the toolbar would still be in the
       tab ring, invisibly. It flips after the fade on the way out and
       immediately on the way in, which is the difference between a fade and a
       blink. */
    .marble-marks-layer { opacity: 1; visibility: visible; transition: opacity 200ms ${EASE}, visibility 0s; }
    .marble-marks-layer:not([data-describing]) {
      opacity: 0; visibility: hidden;
      transition: opacity 200ms ${EASE}, visibility 0s 200ms;
    }
    .marble-marks-layer:not([data-describing]) * { pointer-events: none !important; }
    /* The toolbar leaves downward, the way it arrived. */
    .marble-marks-layer:not([data-describing]) .marble-marks-bar { transform: translateX(-50%) translateY(10px); }
    @media (prefers-reduced-motion: reduce) {
      .marble-marks-layer:not([data-describing]) .marble-marks-bar { transform: translateX(-50%); }
    }

    /* Inside a mode the overlay takes the pointer and nothing else changes:
       wheel still scrolls the page under it. Pinch still works too; a single
       finger is claimed for the drag rather than left free to pan.

       The hole the clip-path punches in it is the tray's corner: the overlay
       is in the top layer and the tray is not, so without the hole the one
       piece of chrome you need to get back out would be under it. Everything
       else this layer draws is a *sibling after* the overlay, which is enough
       to keep it clickable. */
    .marble-marks-overlay { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; touch-action: pinch-zoom; }
    .marble-marks-overlay[hidden] { display: none; }
    .marble-marks-layer[data-mode="text"] .marble-marks-overlay { cursor: text; }

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

    /* One object around everything meant, so the page says *this* rather than
       leaving a reader to add up four outlines. */
    .marble-marks-frame {
      position: fixed; pointer-events: none; border: 1.5px solid var(--marks-mark); border-radius: 10px;
      background: color-mix(in srgb, var(--marks-mark) 5%, transparent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--marks-paper) 60%, transparent);
      transition: opacity 140ms ${EASE};
    }
    .marble-marks-frame[hidden] { display: none; }

    .marble-marks-field {
      position: fixed; pointer-events: auto; width: min(380px, calc(100vw - 32px));
      display: flex; flex-direction: column; gap: 5px; padding: 8px 8px 8px 12px;
      border-radius: 14px; background: var(--marks-paper);
      border: 1px solid color-mix(in srgb, var(--marks-ink) 12%, transparent);
      box-shadow: 0 1px 2px rgba(0, 0, 0, .06), 0 10px 30px rgba(0, 0, 0, .14);
    }
    .marble-marks-field[hidden] { display: none; }
    .marble-marks-brief {
      font-size: 11.5px; color: color-mix(in srgb, var(--marks-ink) 55%, transparent);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .marble-marks-brief:empty { display: none; }
    .marble-marks-row { display: flex; align-items: center; gap: 6px; }
    .marble-marks-input {
      all: unset; flex: 1; min-width: 0; font: inherit; color: var(--marks-ink);
      caret-color: var(--marks-mark); padding: 2px 0;
    }
    .marble-marks-input:empty::before { content: attr(data-placeholder); color: color-mix(in srgb, var(--marks-ink) 40%, transparent); }
    .marble-marks-send {
      all: unset; flex: none; width: 28px; height: 28px; border-radius: 50%;
      display: grid; place-items: center; cursor: pointer;
      background: var(--marks-mark); color: var(--marks-paper);
      transition: opacity 120ms ${EASE}, transform 100ms ease-out;
    }
    .marble-marks-send svg { width: 16px; height: 16px; }
    .marble-marks-send:active { transform: scale(.94); }
    .marble-marks-send[disabled] { opacity: .35; cursor: default; }

    .marble-marks-ink { position: fixed; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .marble-marks-stroke {
      fill: none; stroke: var(--marks-mark); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round;
      transition: opacity 180ms ${EASE};
    }
    /* Handed over: still yours to look at, no longer the thing being made. */
    .marble-marks-stroke[data-state="sent"] { opacity: .55; }

    /* A note is a thing you put *on* the page, so it has a paper of its own and
       a grip, and it never pretends to be part of the document under it. */
    .marble-marks-note {
      position: fixed; pointer-events: auto; width: 190px; border-radius: 10px;
      background: var(--marks-paper); color: var(--marks-ink);
      border: 1px solid color-mix(in srgb, var(--marks-mark) 45%, transparent);
      box-shadow: 0 1px 2px rgba(0, 0, 0, .06), 0 8px 22px rgba(0, 0, 0, .12);
      overflow: hidden;
    }
    .marble-marks-note[data-state="sent"] { opacity: .62; }
    .marble-marks-note-grip {
      display: flex; align-items: center; gap: 4px; height: 16px; padding: 0 4px 0 7px;
      background: color-mix(in srgb, var(--marks-mark) 12%, transparent);
      cursor: grab; touch-action: none;
    }
    .marble-marks-note[data-dragging] .marble-marks-note-grip { cursor: grabbing; }
    .marble-marks-note-dots { flex: 1; height: 2px; border-radius: 1px; background: color-mix(in srgb, var(--marks-mark) 40%, transparent); }
    .marble-marks-note-close {
      all: unset; width: 13px; height: 13px; border-radius: 50%; display: grid; place-items: center;
      cursor: pointer; font-size: 11px; line-height: 1; color: color-mix(in srgb, var(--marks-ink) 60%, transparent);
    }
    .marble-marks-note-close:hover { background: color-mix(in srgb, var(--marks-ink) 10%, transparent); }
    .marble-marks-note-body {
      display: block; padding: 6px 8px 7px; font-size: 12.5px; line-height: 1.35; min-height: 1.35em;
      outline: none; white-space: pre-wrap; word-break: break-word;
    }
    .marble-marks-note-body:empty::before { content: attr(data-placeholder); color: color-mix(in srgb, var(--marks-ink) 38%, transparent); }

    /* Picked: a mark chosen by the marquee, which is a different thing from a
       mark being drawn — a dashed halo rather than the solid the page's own
       elements get. */
    .marble-marks-halo {
      position: fixed; pointer-events: none; border: 1.5px dashed var(--marks-mark); border-radius: 8px;
      background: color-mix(in srgb, var(--marks-mark) 6%, transparent);
    }
    .marble-marks-halo[hidden] { display: none; }

    /* What the agent will be told about the stroke under the pointer. */
    .marble-marks-caption {
      position: fixed; pointer-events: none; max-width: 260px; padding: 5px 9px; border-radius: 8px;
      font: 500 12px/1.2 var(--ui-font, system-ui, sans-serif);
      background: color-mix(in srgb, var(--marks-ink) 88%, transparent); color: var(--marks-paper);
      box-shadow: 0 6px 18px rgba(0, 0, 0, .18);
    }
    .marble-marks-caption[hidden] { display: none; }

    /* Adjust. What is under the pointer, what it allows, and where a drag of it
       would land — three pieces of chrome that all go away the moment the mode
       does, because none of them is a change. */
    .marble-marks-aim { position: fixed; pointer-events: none; border: 1.5px solid var(--marks-mark); border-radius: 6px; }
    .marble-marks-aim[hidden] { display: none; }
    .marble-marks-says {
      position: fixed; pointer-events: none; padding: 3px 7px; border-radius: 6px; white-space: nowrap;
      font: 500 11.5px/1.2 var(--ui-font, system-ui, sans-serif);
      background: var(--marks-mark); color: var(--marks-paper);
    }
    .marble-marks-says[hidden] { display: none; }
    .marble-marks-says[data-undeclared="true"] { background: color-mix(in srgb, var(--marks-ink) 85%, transparent); }
    /* The slot a release would drop into. A line, not a gap: the page has not
       moved yet, and pretending it had would be a preview of a different page. */
    .marble-marks-slot {
      position: fixed; pointer-events: none; background: var(--marks-mark); border-radius: 2px;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--marks-mark) 25%, transparent);
    }
    .marble-marks-slot[hidden] { display: none; }
    .marble-marks-grab {
      position: fixed; pointer-events: auto; width: 14px; height: 14px; margin: -7px 0 0 -7px;
      border-radius: 50%; border: 1.5px solid var(--marks-paper); background: var(--marks-mark);
      box-shadow: 0 1px 3px rgba(0, 0, 0, .25);
    }
    .marble-marks-grab[hidden] { display: none; }
    .marble-marks-grab[data-edge="e"] { cursor: ew-resize; }
    .marble-marks-grab[data-edge="s"] { cursor: ns-resize; }
    .marble-marks-grab[data-edge="se"] { cursor: nwse-resize; }
    .marble-marks-layer[data-mode="adjust"] .marble-marks-overlay { cursor: default; }

    /* One button, offered only after a gesture the document had not declared:
       the vocabulary it was missing, written in. */
    .marble-marks-declare {
      all: unset; flex: none; padding: 5px 9px; border-radius: 8px; cursor: pointer;
      font: 600 11.5px/1 var(--ui-font, system-ui, sans-serif);
      color: var(--marks-mark); background: color-mix(in srgb, var(--marks-mark) 12%, transparent);
    }
    .marble-marks-declare[hidden] { display: none; }

    /* The toolbar. Bottom centre, where every drawing tool puts one, because
       that is where a hand rests when the eye is on the page. */
    .marble-marks-bar {
      position: fixed; left: 50%; transform: translateX(-50%);
      bottom: calc(18px + env(safe-area-inset-bottom, 0px));
      display: flex; align-items: center; gap: 2px; padding: 5px; border-radius: 15px;
      pointer-events: auto;
      background: color-mix(in srgb, var(--marks-paper) 74%, transparent);
      -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
      box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 40%, transparent),
        0 1px 2px rgba(0, 0, 0, .08), 0 12px 32px rgba(0, 0, 0, .16);
      transition: opacity 180ms ${EASE}, transform 180ms ${EASE};
    }
    .marble-marks-bar[hidden] { display: none; }
    @starting-style { .marble-marks-bar { opacity: 0; transform: translateX(-50%) translateY(10px); } }
    .marble-marks-tool {
      all: unset; box-sizing: border-box; position: relative; width: 36px; height: 36px; border-radius: 10px;
      display: grid; place-items: center; cursor: pointer; color: var(--marks-ink);
      transition: background 120ms ${EASE}, color 120ms ${EASE}, transform 90ms ease-out;
    }
    .marble-marks-tool svg { width: 19px; height: 19px; }
    .marble-marks-tool:hover { background: color-mix(in srgb, var(--marks-ink) 8%, transparent); }
    .marble-marks-tool:active { transform: scale(.96); }
    .marble-marks-tool:focus-visible { outline: 2px solid var(--marks-mark); outline-offset: 2px; }
    .marble-marks-tool[aria-pressed="true"] { background: var(--marks-mark); color: var(--marks-paper); }
    .marble-marks-tool[disabled] { opacity: .4; cursor: default; }
    .marble-marks-tool[hidden] { display: none; }
    .marble-marks-tool::after {
      content: attr(data-label); position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
      white-space: nowrap; padding: 4px 8px; border-radius: 7px; font: 500 11.5px/1 var(--ui-font, system-ui, sans-serif);
      background: color-mix(in srgb, var(--marks-ink) 88%, transparent); color: var(--marks-paper);
      opacity: 0; pointer-events: none; transition: opacity 120ms ${EASE};
    }
    .marble-marks-tool:hover::after, .marble-marks-tool:focus-visible::after { opacity: 1; }
    .marble-marks-sep { width: 1px; height: 22px; margin: 0 4px; background: color-mix(in srgb, var(--marks-ink) 14%, transparent); }

    /* Explore: what you want and why, which is what makes a set of variations
       more than noise. */
    .marble-marks-explore {
      position: fixed; pointer-events: auto; width: min(320px, calc(100vw - 32px));
      display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 14px;
      background: var(--marks-paper);
      border: 1px solid color-mix(in srgb, var(--marks-ink) 12%, transparent);
      box-shadow: 0 1px 2px rgba(0, 0, 0, .06), 0 14px 40px rgba(0, 0, 0, .18);
    }
    .marble-marks-explore[hidden] { display: none; }
    .marble-marks-explore h4 { margin: 0; font: 600 13px/1.2 inherit; }
    .marble-marks-ask {
      all: unset; display: block; font: inherit; font-size: 12.5px; color: var(--marks-ink);
      caret-color: var(--marks-mark); padding: 7px 9px; border-radius: 9px;
      background: color-mix(in srgb, var(--marks-ink) 5%, transparent);
      min-height: 1.35em; white-space: pre-wrap;
    }
    .marble-marks-ask:empty::before { content: attr(data-placeholder); color: color-mix(in srgb, var(--marks-ink) 40%, transparent); }
    .marble-marks-ask:focus-visible { box-shadow: inset 0 0 0 1.5px var(--marks-mark); }
    .marble-marks-counts { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: color-mix(in srgb, var(--marks-ink) 55%, transparent); }
    .marble-marks-count {
      all: unset; padding: 3px 9px; border-radius: 999px; cursor: pointer; font-size: 12px;
      background: color-mix(in srgb, var(--marks-ink) 6%, transparent);
    }
    .marble-marks-count[aria-pressed="true"] { background: var(--marks-mark); color: var(--marks-paper); }
    .marble-marks-go {
      all: unset; text-align: center; padding: 8px; border-radius: 10px; cursor: pointer;
      font: 600 12.5px/1 inherit; background: var(--marks-mark); color: var(--marks-paper);
    }
    .marble-marks-go:active { transform: scale(.99); }

    @media (prefers-reduced-transparency: reduce) {
      .marble-marks-bar { background: var(--marks-paper); -webkit-backdrop-filter: none; backdrop-filter: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .marble-marks-stroke, .marble-marks-bar, .marble-marks-frame, .marble-marks-tool { transition: none; }
      @starting-style { .marble-marks-bar { opacity: 0; transform: translateX(-50%); } }
    }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app || !G()) return true;
    // The Agents page is the orchestration view already; tools for briefing an
    // agent about a document have no place on the page made of agents.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return true;
    if (document.querySelector('.marble-marks-layer')) return true;

    // --------------------------------------------------------------- the tray
    //
    // The tray is the only way to reach Describe mode, so it is also the
    // condition for having it: a register that nobody answers means there is no
    // tray on this page, and the layer stands down rather than draw a second
    // affordance in a corner a document may own. The drawer says
    // `marble-tray:ready` when it mounts, and boot is tried again then.

    const claim = (spec) => !dispatchEvent(new CustomEvent('marble-tray:register', { detail: spec, cancelable: true }));
    const update = (spec) => dispatchEvent(new CustomEvent('marble-tray:update', { detail: spec }));
    if (!claim({
      id: 'marks-describe',
      order: 10,
      label: 'Describe a change',
      icon: GLYPHS.describe,
      always: true,
      active: false,
      onSelect: () => setDescribing(!describing),
    })) return false;

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

    const el = (tag, className, parent = null) => {
      const node = document.createElement(tag);
      node.className = className;
      node.setAttribute(TRANSIENT, '');
      if (parent) parent.append(node);
      return node;
    };

    // Order is hit-testing: the overlay first, everything the hand needs after
    // it. Nothing below is clipped, so nothing needs a hole punched for it.
    const overlay = el('div', 'marble-marks-overlay');
    overlay.hidden = true;
    const marquee = el('div', 'marble-marks-marquee');
    marquee.hidden = true;
    const ink = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ink.setAttribute('class', 'marble-marks-ink');
    ink.setAttribute('aria-hidden', 'true');
    ink.setAttribute(TRANSIENT, '');
    const frame = el('div', 'marble-marks-frame');
    frame.hidden = true;
    const caption = el('div', 'marble-marks-caption');
    caption.hidden = true;
    layer.append(overlay, marquee, ink, frame, caption);

    const aim = el('div', 'marble-marks-aim', layer);
    aim.hidden = true;
    const says = el('div', 'marble-marks-says', layer);
    says.hidden = true;
    const slot = el('div', 'marble-marks-slot', layer);
    slot.hidden = true;
    const grabs = ['e', 's', 'se'].map((edge) => {
      const node = el('div', 'marble-marks-grab', layer);
      node.dataset.edge = edge;
      node.hidden = true;
      return node;
    });
    const notes = el('div', 'marble-marks-notes', layer);
    const halos = [];
    const hits = [];

    // ------------------------------------------------------------- the field

    const field = el('div', 'marble-marks-field', layer);
    field.hidden = true;
    const briefLine = el('div', 'marble-marks-brief', field);
    const row = el('div', 'marble-marks-row', field);
    const input = el('div', 'marble-marks-input', row);
    input.contentEditable = 'true';
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-label', 'Describe the change');
    input.dataset.placeholder = 'Describe the change…';
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'marble-marks-send';
    send.setAttribute(TRANSIENT, '');
    send.setAttribute('aria-label', 'Send to an agent');
    send.innerHTML = GLYPHS.send;
    const declare = document.createElement('button');
    declare.type = 'button';
    declare.className = 'marble-marks-declare';
    declare.setAttribute(TRANSIENT, '');
    declare.hidden = true;
    row.append(declare, send);

    // ----------------------------------------------------------- the toolbar

    const bar = el('div', 'marble-marks-bar', layer);
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Describe');
    // Not hidden: out of the mode the whole layer is invisible, and the toolbar
    // is only ever `hidden` when the drawer is covering the page it acts on.
    const button = (id, label, glyph, { pressed = null } = {}) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'marble-marks-tool';
      node.dataset.tool = id;
      node.dataset.label = label;
      node.setAttribute(TRANSIENT, '');
      node.setAttribute('aria-label', label);
      if (pressed !== null) node.setAttribute('aria-pressed', String(pressed));
      node.innerHTML = glyph;
      bar.append(node);
      return node;
    };
    const tools = {
      select: button('select', 'Select', GLYPHS.select, { pressed: false }),
      adjust: button('adjust', 'Move or resize', GLYPHS.adjust, { pressed: false }),
      sketch: button('sketch', 'Sketch', GLYPHS.sketch, { pressed: false }),
      text: button('text', 'Note', GLYPHS.text, { pressed: false }),
    };
    el('span', 'marble-marks-sep', bar);
    const exploreButton = button('explore', 'Explore variations', GLYPHS.explore);
    const clearButton = button('clear', 'Clear marks', GLYPHS.clear);
    el('span', 'marble-marks-sep', bar);
    const doneButton = button('done', 'Done', GLYPHS.done);

    // ------------------------------------------------------------ Explore ask

    const explore = el('div', 'marble-marks-explore', layer);
    explore.hidden = true;
    const exploreTitle = document.createElement('h4');
    exploreTitle.textContent = 'Explore variations';
    exploreTitle.setAttribute(TRANSIENT, '');
    explore.append(exploreTitle);
    const wantField = el('div', 'marble-marks-ask', explore);
    wantField.contentEditable = 'true';
    wantField.setAttribute('role', 'textbox');
    wantField.dataset.placeholder = 'What do you want to try?';
    wantField.setAttribute('aria-label', 'What do you want to try?');
    const whyField = el('div', 'marble-marks-ask', explore);
    whyField.contentEditable = 'true';
    whyField.setAttribute('role', 'textbox');
    whyField.dataset.placeholder = 'Why — what would make one better?';
    whyField.setAttribute('aria-label', 'Why');
    const counts = el('div', 'marble-marks-counts', explore);
    counts.append(document.createTextNode('How many'));
    let howMany = 3;
    const countButtons = [3, 5, 8].map((n) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'marble-marks-count';
      node.setAttribute(TRANSIENT, '');
      node.textContent = String(n);
      node.setAttribute('aria-pressed', String(n === howMany));
      node.addEventListener('click', () => {
        howMany = n;
        for (const other of countButtons) other.setAttribute('aria-pressed', String(Number(other.textContent) === howMany));
      });
      counts.append(node);
      return node;
    });
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'marble-marks-go';
    go.setAttribute(TRANSIENT, '');
    go.textContent = 'Explore';
    explore.append(go);

    let describing = false;
    let mode = null;
    let drag = null;
    let pen = null;
    let moving = null;
    let fromUs = false;
    let mine = [];
    let area = [];
    // True while the layer is putting its own selection away or taking it back
    // out, so the context listener below does not read that as the person
    // choosing something else.
    let handling = false;
    let pending = null;
    const marks = [];
    const picked = new Set();

    // ---------------------------------------------------------------- boxes
    //
    // Real documents here are not the size of a test fixture: the Pattern
    // Atlas carries 21,587 addressed elements. Two things keep that off a drag.
    //
    // The first is scope. The marquee is `position: fixed`, so a rectangle
    // drawn in it can only ever mean something on screen: every box whose rect
    // misses the viewport is dropped. Off-screen *ancestors* of a box that was
    // kept stay, because the coalescing rule reads the parent chain and a chain
    // with a hole in it would coalesce wrongly.
    //
    // The second is the parent walk. `closest()` on every element walks to the
    // root every time; `querySelectorAll` hands them back in document order, so
    // a stack of open ancestors answers the same question in one pass.
    const collectBoxes = () => {
      const els = [...document.querySelectorAll('[data-marble-id]')].filter((node) =>
        node !== document.body && node !== document.documentElement && !node.closest(`[${TRANSIENT}]`) && node.getRootNode() === document);
      const parentOf = new Map();
      const rects = new Map();
      const open = [];
      for (const node of els) {
        while (open.length && !open[open.length - 1].contains(node)) open.pop();
        parentOf.set(node, open[open.length - 1] ?? null);
        open.push(node);
        rects.set(node, node.getBoundingClientRect());
      }
      const keep = new Set();
      for (const node of els) {
        const r = rects.get(node);
        if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
        keep.add(node);
        for (let p = parentOf.get(node); p && !keep.has(p); p = parentOf.get(p)) keep.add(p);
      }
      const out = [];
      for (const node of els) {
        if (!keep.has(node)) continue;
        const r = rects.get(node);
        out.push({
          id: node.getAttribute('data-marble-id'),
          parent: parentOf.get(node)?.getAttribute('data-marble-id') ?? null,
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
          hit = el('div', 'marble-marks-hit');
          hits.push(hit);
          marquee.before(hit);
        }
        const box = byId.get(id);
        Object.assign(hit.style, { left: `${box.left - 3}px`, top: `${box.top - 3}px`, width: `${box.width + 6}px`, height: `${box.height + 6}px` });
        hit.hidden = false;
      });
      for (let i = ids.length; i < hits.length; i += 1) hits[i].hidden = true;
    };

    /** The deepest addressed element under a point, or the nearest one to it:
     *  a stroke may well start in a margin, and "nothing" is a worse answer
     *  than "the paragraph six pixels to the left". */
    const elementAt = (x, y) => {
      // Paint order, nearest the eye first, so the first addressed ancestor
      // found is the deepest element actually under the point.
      for (const node of document.elementsFromPoint(x, y)) {
        if (!node.closest || node.closest(`[${TRANSIENT}]`) || node.getRootNode() !== document) continue;
        const addressed = node.closest('[data-marble-id]');
        if (addressed && addressed !== document.body && addressed !== document.documentElement) return addressed;
      }
      let best = null;
      let nearest = Infinity;
      for (const node of document.querySelectorAll('[data-marble-id]')) {
        if (node === document.body || node.closest(`[${TRANSIENT}]`) || node.getRootNode() !== document) continue;
        const r = node.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const d = Math.hypot(dx, dy);
        // Ties go to the deeper element, which `querySelectorAll` hands over
        // later: a point inside a list and its item is 0 from both.
        if (d <= nearest) { nearest = d; best = node; }
      }
      return best;
    };
    const idAt = (x, y) => elementAt(x, y)?.getAttribute('data-marble-id') ?? null;
    const boxOf = (id) => {
      const node = id && document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`);
      return node ? node.getBoundingClientRect() : null;
    };

    // ----------------------------------------------------------------- marks

    const pointsOf = (part, box) => G().fromFractions(box, part.pairs);
    /** Where a mark is on screen right now, from its anchor. */
    const spanOf = (mark) => {
      const box = boxOf(mark.anchorId);
      if (!box) return null;
      if (mark.type === 'act') return box;
      if (mark.type === 'note') {
        const r = mark.el.getBoundingClientRect();
        return r.width ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
      }
      const all = mark.parts.flatMap((part) => pointsOf(part, box));
      return all.length ? G().boundsOf(all) : null;
    };
    const names = (ids) => {
      if (!ids.length) return 'nothing in particular';
      if (ids.length === 1) return ids[0];
      return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
    };
    /** What the agent will be told about one mark, in the words the person
     *  sees under their own pointer. */
    const phraseOf = (mark) => {
      if (mark.type === 'act') return mark.phrase;
      if (mark.type === 'note') return `a note on ${mark.anchorId}: "${mark.text}"`;
      if (mark.kind === 'box') return `a box around ${names(mark.ids)}`;
      if (mark.kind === 'arrow') return `an arrow from ${mark.from ?? 'nothing'} to ${mark.to ?? 'nothing'}`;
      return `ink over ${names(mark.ids)}`;
    };
    const idsOf = (mark) => {
      if (mark.type === 'act' || mark.type === 'note') return mark.anchorId ? [mark.anchorId] : [];
      return mark.kind === 'arrow' ? [mark.from, mark.to].filter(Boolean) : mark.ids;
    };
    const drafts = () => marks.filter((mark) => !mark.sent);
    const note = () => {
      const drawn = drafts().filter((mark) => mark.type !== 'act').map(phraseOf);
      const done = drafts().filter((mark) => mark.type === 'act').map(phraseOf);
      const said = [];
      if (drawn.length) said.push(`I marked up the page: ${drawn.join('; ')}.`);
      // What the hand already changed is context, not a request — and saying so
      // is the difference between "do this" and "do this to everything else".
      if (done.length) said.push(`I already ${done.join(', and ')} by hand.`);
      return said.length ? `${said.join(' ')} ` : '';
    };

    const repaint = () => {
      for (const mark of marks) {
        if (mark.type === 'act') continue;
        const box = boxOf(mark.anchorId);
        if (mark.type === 'note') {
          if (!box) { mark.el.hidden = true; continue; }
          mark.el.hidden = false;
          mark.el.style.left = `${Math.round(box.left + mark.u * box.width)}px`;
          mark.el.style.top = `${Math.round(box.top + mark.v * box.height)}px`;
          continue;
        }
        for (const part of mark.parts) {
          if (!box) { part.el.setAttribute('d', ''); continue; }
          part.el.setAttribute('d', pathOf(pointsOf(part, box)));
        }
      }
      paintHalos();
      paintFrame();
    };
    let repainting = 0;
    const scheduleRepaint = () => { if (!repainting) repainting = requestAnimationFrame(() => { repainting = 0; repaint(); paintAim(); }); };

    const paintHalos = () => {
      const chosen = [...picked];
      chosen.forEach((mark, i) => {
        let halo = halos[i];
        if (!halo) {
          halo = el('div', 'marble-marks-halo');
          halos.push(halo);
          frame.before(halo);
        }
        const span = spanOf(mark);
        if (!span) { halo.hidden = true; return; }
        Object.assign(halo.style, {
          left: `${span.left - 5}px`, top: `${span.top - 5}px`,
          width: `${span.width + 10}px`, height: `${span.height + 10}px`,
        });
        halo.hidden = false;
      });
      for (let i = chosen.length; i < halos.length; i += 1) halos[i].hidden = true;
    };

    // --------------------------------------------------- the frame and field

    /** Everything meant right now, as one rectangle: the elements the
     *  selection names and the marks drawn about them. */
    const union = () => {
      const spans = [];
      for (const id of (fromUs ? mine : [])) {
        const box = boxOf(id);
        if (box?.width || box?.height) spans.push(box);
      }
      for (const mark of drafts()) {
        const span = spanOf(mark);
        if (span) spans.push(span);
      }
      if (!spans.length) return null;
      const left = Math.min(...spans.map((s) => s.left));
      const top = Math.min(...spans.map((s) => s.top));
      const right = Math.max(...spans.map((s) => s.left + s.width));
      const bottom = Math.max(...spans.map((s) => s.top + s.height));
      return { left, top, width: right - left, height: bottom - top };
    };

    const paintFrame = () => {
      const span = union();
      if (!span) {
        frame.hidden = true;
        field.hidden = true;
        return;
      }
      const pad = 6;
      Object.assign(frame.style, {
        left: `${Math.round(span.left - pad)}px`, top: `${Math.round(span.top - pad)}px`,
        width: `${Math.round(span.width + pad * 2)}px`, height: `${Math.round(span.height + pad * 2)}px`,
      });
      frame.hidden = false;
      paintField(span);
      paintExplore(span);
    };

    /** The field hangs under the frame, flips above it when the bottom of the
     *  window is nearer than its own height, and never leaves the window. */
    /** Hang something on the marks. Four places, tried in order — under them,
     *  over them, beside them, and failing all three just inside their top edge
     *  — because the one thing it must not do is give up and go and sit at the
     *  bottom of the window. Down there is the toolbar, and a field that lands
     *  on the toolbar is in the way of the tools *and* nowhere near the thing
     *  it is about. A region taller than the window is the ordinary way to get
     *  there: a box sketched around most of a page has no room under it and
     *  none over it either. */
    const hang = (node, span, { gap = 10 } = {}) => {
      node.hidden = false;
      const size = node.getBoundingClientRect();
      const edge = describing && !bar.hidden ? bar.getBoundingClientRect() : null;
      const ceiling = 8;
      const floor = (edge?.height ? edge.top - gap : innerHeight - 8) - size.height;
      const at = (left, top) => {
        node.style.left = `${Math.round(Math.min(Math.max(12, left), innerWidth - size.width - 12))}px`;
        node.style.top = `${Math.round(Math.min(Math.max(ceiling, top), Math.max(ceiling, floor)))}px`;
      };
      const centred = span.left + span.width / 2 - size.width / 2;
      const under = span.top + span.height + gap;
      const over = span.top - gap - size.height;
      if (under <= floor) return at(centred, under);
      if (over >= ceiling) return at(centred, over);
      const beside = Math.min(Math.max(ceiling, span.top), Math.max(ceiling, floor));
      if (span.left + span.width + gap + size.width <= innerWidth - 12) return at(span.left + span.width + gap, beside);
      if (span.left - gap - size.width >= 12) return at(span.left - gap - size.width, beside);
      // Nothing fits outside it, so: inside, hugging the top right corner.
      // Text starts on the left, so that is the corner of a region with the
      // least of it underneath.
      return at(span.left + span.width - size.width - gap, span.top + gap);
    };
    const paintField = (span) => {
      if (explore.hidden === false) { field.hidden = true; return; }
      const count = fromUs ? mine.length : 0;
      const parts = [];
      if (count) parts.push(`${count} element${count === 1 ? '' : 's'}`);
      for (const mark of drafts()) parts.push(phraseOf(mark));
      briefLine.textContent = parts.join(' · ');
      hang(field, span);
    };
    const paintExplore = (span) => {
      if (explore.hidden) return;
      hang(explore, span);
    };

    const sendable = () => Boolean(input.textContent.trim() || drafts().length || (fromUs && mine.length));
    const paintSend = () => { send.disabled = !sendable(); };

    /** One door out, and it is the callout's: the card opens at the same
     *  region, with the brief and the sentence in it, and sends. */
    const handOff = (text, { submit = true } = {}) => {
      if (!fromUs && !drafts().length) return;
      pending = { text, submit, marks: drafts() };
      if (!dispatchEvent(new CustomEvent('marble-callout:summon', { cancelable: true }))) return;
      // Nothing took it — no callout on this page, or nothing to anchor to.
      pending = null;
      agent.open();
    };
    const sendField = () => {
      if (!sendable()) return;
      const typed = input.textContent.trim();
      input.textContent = '';
      paintSend();
      handOff(`${note()}${typed}`.trim());
    };
    send.addEventListener('click', sendField);
    input.addEventListener('input', paintSend);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendField(); return; }
      if (event.key === 'Escape') { event.stopPropagation(); input.blur(); }
    });

    // ---------------------------------------------------------------- Select

    const rectOf = (d) => ({
      left: Math.min(d.x0, d.x1), top: Math.min(d.y0, d.y1),
      width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0),
    });
    // A page scrolling under a drag moves every box the same distance, and the
    // boxes are in client coordinates, so the scroll is a pure shift:
    // translating what was measured at the press costs nothing, where
    // re-measuring a long document costs the frame. What the shift cannot know
    // is a `position: fixed` element — `finish` measures again before any id is
    // committed for that reason.
    const shiftBoxes = () => {
      if (!drag) return;
      const dx = scrollX - drag.scrollX;
      const dy = scrollY - drag.scrollY;
      if (!dx && !dy) return;
      for (const box of drag.boxes) { box.left -= dx; box.top -= dy; }
      drag.scrollX = scrollX;
      drag.scrollY = scrollY;
    };
    /** Which marks a rectangle means. A mark has no id and never enters the
     *  selection; it is picked so it can be moved or taken off the page. */
    const marksInRect = (r) => marks.filter((mark) => {
      const span = spanOf(mark);
      return span ? G().coverage(r, span) >= 0.6 : false;
    });
    const frameStep = () => {
      if (!drag) return;
      drag.raf = 0;
      shiftBoxes();
      const r = rectOf(drag);
      Object.assign(marquee.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      drag.ids = G().idsInRect(r, drag.boxes);
      drag.marks = marksInRect(r);
      paintHits(drag.ids, drag.boxes);
      picked.clear();
      for (const mark of drag.marks) picked.add(mark);
      paintHalos();
    };
    const scheduleFrame = () => { if (drag && !drag.raf) drag.raf = requestAnimationFrame(frameStep); };
    const endDrag = () => {
      if (!drag) return;
      cancelAnimationFrame(drag.raf);
      drag = null;
      marquee.hidden = true;
      // The pool lives for the drag, not for the page: it grows to the largest
      // selection ever painted, and on a document of thousands of addressed
      // elements that is thousands of divs left in the layer.
      for (const hit of hits.splice(0)) hit.remove();
    };

    // ---------------------------------------------------------------- Sketch

    const pathOf = (points) => points.map((p, i) => `${i ? 'L' : 'M'}${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join(' ');
    const newPath = () => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      node.setAttribute('class', 'marble-marks-stroke');
      node.dataset.state = 'draft';
      ink.append(node);
      return node;
    };
    const endPen = ({ keep = false } = {}) => {
      if (!pen) return null;
      const done = pen;
      pen = null;
      if (keep) return done;
      done.el.remove();
      return null;
    };

    const commitStroke = (points) => {
      const geometry = G();
      if (points.length < 3 || geometry.lengthOf(points) < SCRATCH) return false;
      const kind = geometry.readStroke(points);
      // A short stroke at the end of the arrow just drawn is the head someone
      // put on it, not a second mark — and which end it is on is which way the
      // arrow points.
      const last = marks[marks.length - 1];
      if (last && last.type === 'stroke' && !last.sent) {
        // Measured where the shaft is *now*: the page may have scrolled
        // between the two strokes.
        const shaftBox = boxOf(last.anchorId);
        const shaft = shaftBox ? pointsOf(last.parts[0], shaftBox) : last.points;
        const end = geometry.arrowHeadFor({ kind: last.kind, points: shaft }, points, { elapsed: Date.now() - last.at });
        if (end) {
          if (end === 'start') { const from = last.from; last.from = last.to; last.to = from; }
          const box = boxOf(last.anchorId) ?? geometry.boundsOf(points);
          last.parts.push({ pairs: geometry.toFractions(box, points), el: newPath() });
          return true;
        }
      }
      const bounds = geometry.boundsOf(points);
      const centre = geometry.centroidOf(points);
      const anchor = elementAt(centre.x, centre.y);
      if (!anchor) return false;
      const mark = {
        type: 'stroke',
        kind,
        anchorId: anchor.getAttribute('data-marble-id'),
        at: Date.now(),
        sent: false,
        points,
        parts: [{ pairs: geometry.toFractions(anchor.getBoundingClientRect(), points), el: newPath() }],
        ids: [],
        from: null,
        to: null,
      };
      if (kind === 'arrow') {
        mark.from = idAt(points[0].x, points[0].y);
        mark.to = idAt(points[points.length - 1].x, points[points.length - 1].y);
      } else {
        mark.ids = geometry.idsInRect(bounds, collectBoxes());
      }
      marks.push(mark);
      return true;
    };

    // ------------------------------------------------------------------ Text

    const placeNote = (x, y) => {
      const anchor = elementAt(x, y);
      if (!anchor) return null;
      const box = anchor.getBoundingClientRect();
      const node = el('div', 'marble-marks-note', notes);
      node.dataset.state = 'draft';
      const grip = el('div', 'marble-marks-note-grip', node);
      el('span', 'marble-marks-note-dots', grip);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'marble-marks-note-close';
      close.setAttribute(TRANSIENT, '');
      close.setAttribute('aria-label', 'Remove this note');
      close.textContent = '×';
      grip.append(close);
      const body = el('div', 'marble-marks-note-body', node);
      body.contentEditable = 'true';
      body.setAttribute('role', 'textbox');
      body.dataset.placeholder = 'Say what you want here…';
      const mark = {
        type: 'note',
        kind: 'text',
        anchorId: anchor.getAttribute('data-marble-id'),
        at: Date.now(),
        sent: false,
        u: box.width ? (x - box.left) / box.width : 0,
        v: box.height ? (y - box.top) / box.height : 0,
        text: '',
        el: node,
      };
      marks.push(mark);
      close.addEventListener('click', () => removeMark(mark));
      // A note names the element it was put on, the same way a stroke names
      // what it covers: what you wrote on is part of what you are pointing at.
      body.addEventListener('input', () => {
        mark.text = body.textContent.trim();
        syncSelection();
        syncBrief();
      });
      body.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.stopPropagation(); body.blur(); }
      });
      // An empty note is a slip of the hand, not a mark.
      body.addEventListener('blur', () => { if (!body.textContent.trim()) removeMark(mark); });
      grip.addEventListener('pointerdown', (event) => startMove(event, [mark], node));
      repaint();
      body.focus();
      return mark;
    };

    const removeMark = (mark) => {
      const at = marks.indexOf(mark);
      if (at < 0) return;
      marks.splice(at, 1);
      picked.delete(mark);
      if (mark.type === 'note') mark.el.remove();
      else if (mark.type === 'stroke') for (const part of mark.parts) part.el.remove();
      syncSelection();
      syncBrief();
    };
    const clearMarks = () => {
      for (const mark of marks.splice(0)) {
        if (mark.type === 'note') mark.el.remove();
        else if (mark.type === 'stroke') for (const part of mark.parts) part.el.remove();
      }
      picked.clear();
      caption.hidden = true;
      offerDeclare(null);
      area = [];
      syncSelection();
      syncBrief();
      repaint();
    };
    const undoStroke = () => {
      const mark = marks[marks.length - 1];
      if (!mark || mark.sent || mark.type !== 'stroke') return;
      // The head comes off before the arrow does: it was a separate stroke.
      if (mark.parts.length > 1) mark.parts.pop().el.remove();
      else removeMark(mark);
      syncSelection();
      syncBrief();
    };

    /** Marks are dragged by the hand, and what moves is their fractions: a
     *  mark that was two thirds down a card is two thirds down it wherever the
     *  card goes next. */
    const startMove = (event, which, node) => {
      if (event.button !== 0 || !which.length) return;
      event.preventDefault();
      event.stopPropagation();
      node.setPointerCapture?.(event.pointerId);
      node.dataset.dragging = '';
      moving = {
        id: event.pointerId,
        node,
        x: event.clientX,
        y: event.clientY,
        marks: which.map((mark) => ({ mark, box: boxOf(mark.anchorId) })).filter((item) => item.box),
      };
    };
    const moveBy = (dx, dy) => {
      for (const { mark, box } of moving.marks) {
        if (!box.width || !box.height) continue;
        if (mark.type === 'note') {
          mark.u += dx / box.width;
          mark.v += dy / box.height;
          continue;
        }
        for (const part of mark.parts) {
          part.pairs = part.pairs.map(([u, v]) => [u + dx / box.width, v + dy / box.height]);
        }
      }
    };
    addEventListener('pointermove', (event) => {
      if (!moving || event.pointerId !== moving.id) return;
      moveBy(event.clientX - moving.x, event.clientY - moving.y);
      moving.x = event.clientX;
      moving.y = event.clientY;
      repaint();
    });
    const dropMove = (event) => {
      if (!moving || event.pointerId !== moving.id) return;
      delete moving.node.dataset.dragging;
      moving = null;
      repaint();
    };
    addEventListener('pointerup', dropMove);
    addEventListener('pointercancel', dropMove);

    // ---------------------------------------------------------------- Adjust
    //
    // The direct-manipulation tool, and it implements no layout semantics of
    // its own: it asks the vocabulary what the element under the pointer
    // allows, and files the op that answer names. Where a document declares
    // nothing — which is every document written before the vocabulary had a
    // word for size — the same gesture still lands, because reordering
    // siblings *is* a move and a size *is* an inline style, and it says it did
    // so undeclared rather than pretending it was invited.

    const vocabulary = () => globalThis.marbleVocabulary ?? null;
    const affordsOf = (node) => vocabulary()?.affords(node) ?? { move: null, size: null };
    const styleWith = (node, declarations) => {
      const shared = vocabulary()?.styleWith;
      if (shared) return shared(node, declarations);
      const dropped = new Set(Object.keys(declarations));
      const rest = (node.getAttribute('style') ?? '').split(';').map((part) => part.trim())
        .filter((part) => part && !dropped.has(part.slice(0, part.indexOf(':')).trim().toLowerCase()));
      return [...Object.entries(declarations).map(([name, value]) => `${name}:${value}`), ...rest].join(';');
    };

    /** The carrier's own write path, as collab.js plays an op: apply, file,
     *  record the inverse so the document's own undo takes it back, flush.
     *
     *  `undo` is for the gesture that already moved the page before it filed
     *  anything. `marble.invert` reads the inverse off the page as it stands,
     *  which is right for an op nobody has applied yet and wrong for a drag —
     *  by release the element is already the new size, so the inverse it
     *  computes would put it back to where it just was. A drag captures its own
     *  before-value at the press and hands it in. */
    const play = (ops, { undo = null } = {}) => {
      const inverses = undo ? [...undo] : [];
      for (const op of ops) {
        if (!undo) {
          const inverse = marble.invert?.(op);
          if (inverse) inverses.unshift(inverse);
        }
        marble.apply(op);
        marble.op(op);
      }
      if (inverses.length) marble.record?.({ redo: ops, undo: inverses });
      return marble.flush?.() ?? Promise.resolve();
    };

    let aiming = null;
    let acting = null;
    let declaring = null;

    const siblingsOf = (node) => [...(node.parentElement?.children ?? [])]
      .filter((child) => child !== node && !child.hasAttribute(TRANSIENT) && child.getAttribute('data-marble-id'));
    /** Which way the children of this container run. A list is a column and a
     *  toolbar is a row, and a drop line drawn the wrong way round is a lie
     *  about where the thing will land. */
    const runsAcross = (node) => {
      const kids = siblingsOf(node).map((child) => child.getBoundingClientRect()).filter((r) => r.width && r.height);
      if (kids.length < 2) return false;
      const [a, b] = kids;
      return Math.abs(b.left - a.left) > Math.abs(b.top - a.top);
    };

    const clearAim = () => {
      aiming = null;
      aim.hidden = true;
      says.hidden = true;
      slot.hidden = true;
      for (const grab of grabs) grab.hidden = true;
    };

    /** What this element allows, half by half. One undeclared half does not
     *  make the other one undeclared — a pane that says it can be resized and
     *  sits in a list that says nothing is exactly that, and a label that
     *  flattened the two would be wrong about one of them. */
    const sayingFor = (can, id) => {
      const moves = can.move?.kind === 'canvas' ? 'move' : 'reorder';
      const parts = [
        `${moves}${can.move ? '' : ' (undeclared)'}`,
        `resize${can.size ? '' : ' (undeclared)'}`,
      ];
      return { text: [id, ...parts].filter(Boolean).join(' · '), undeclared: !can.move || !can.size };
    };

    const paintAim = () => {
      if (mode !== 'adjust' || !aiming?.el?.isConnected) { clearAim(); return; }
      const r = aiming.el.getBoundingClientRect();
      Object.assign(aim.style, {
        left: `${Math.round(r.left - 2)}px`, top: `${Math.round(r.top - 2)}px`,
        width: `${Math.round(r.width + 4)}px`, height: `${Math.round(r.height + 4)}px`,
      });
      aim.hidden = false;
      const saying = sayingFor(aiming.can, marble.id(aiming.el));
      says.textContent = saying.text;
      says.dataset.undeclared = String(saying.undeclared);
      says.hidden = false;
      const size = says.getBoundingClientRect();
      says.style.left = `${Math.round(Math.min(Math.max(8, r.left), innerWidth - size.width - 8))}px`;
      says.style.top = `${Math.round(r.top - size.height - 6 < 8 ? r.bottom + 6 : r.top - size.height - 6)}px`;
      const at = { e: [r.right, r.top + r.height / 2], s: [r.left + r.width / 2, r.bottom], se: [r.right, r.bottom] };
      for (const grab of grabs) {
        const [x, y] = at[grab.dataset.edge];
        grab.style.left = `${Math.round(x)}px`;
        grab.style.top = `${Math.round(y)}px`;
        grab.hidden = false;
      }
    };

    const aimAt = (x, y) => {
      if (acting) return;
      const node = elementAt(x, y);
      if (!node) { clearAim(); return; }
      if (aiming?.el === node) { paintAim(); return; }
      aiming = { el: node, can: affordsOf(node) };
      paintAim();
    };

    /** What a release would do, in the words the brief will carry. */
    const noteAct = (phrase, anchorId, declared) => {
      marks.push({ type: 'act', kind: 'act', anchorId, phrase, at: Date.now(), sent: false, declared });
      syncSelection();
      syncBrief();
    };

    const offerDeclare = (what) => {
      declaring = what;
      declare.hidden = !what;
      if (what) declare.textContent = what.label;
      paintFrame();
    };

    // ---- moving

    const startMoveGesture = (event) => {
      const node = aiming.el;
      const can = aiming.can;
      const id = marble.id(node);
      if (!id) return;
      acting = {
        kind: 'move', el: node, can, id, pointerId: event.pointerId,
        x: event.clientX, y: event.clientY,
        prior: node.getAttribute('style'),
        grab: null, before: undefined,
      };
      if (can.move?.kind === 'canvas') {
        const box = node.getBoundingClientRect();
        acting.grab = { x: event.clientX - box.left, y: event.clientY - box.top };
      }
      overlay.setPointerCapture(event.pointerId);
      says.hidden = true;
    };

    const dropPlace = (x, y) => {
      const node = acting.el;
      const across = runsAcross(node);
      const before = siblingsOf(node).find((child) => {
        const r = child.getBoundingClientRect();
        return across ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
      }) ?? null;
      return { before, across };
    };

    const paintSlot = (place) => {
      const node = acting.el;
      const parent = node.parentElement;
      if (!parent) { slot.hidden = true; return; }
      const box = parent.getBoundingClientRect();
      const edge = place.before ? place.before.getBoundingClientRect() : null;
      const last = siblingsOf(node).at(-1)?.getBoundingClientRect() ?? node.getBoundingClientRect();
      if (place.across) {
        const x = edge ? edge.left - 3 : last.right + 1;
        Object.assign(slot.style, { left: `${Math.round(x)}px`, top: `${Math.round(box.top)}px`, width: '3px', height: `${Math.round(box.height)}px` });
      } else {
        const y = edge ? edge.top - 3 : last.bottom + 1;
        Object.assign(slot.style, { left: `${Math.round(box.left)}px`, top: `${Math.round(y)}px`, width: `${Math.round(box.width)}px`, height: '3px' });
      }
      slot.hidden = false;
    };

    const commitMove = async () => {
      const { el: node, can, id, prior } = acting;
      if (can.move?.kind === 'canvas') {
        const value = styleWith(node, { left: node.style.left, top: node.style.top });
        acting = null;
        if (value === prior) { paintAim(); return; }
        node.setAttribute('style', value);
        await play([{ type: 'setAttr', id, name: 'style', value }], {
          undo: [{ type: 'setAttr', id, name: 'style', value: prior }],
        });
        noteAct(`moved ${id} on its canvas`, id, true);
        paintAim();
        return;
      }
      const place = acting.before === undefined ? { before: null } : { before: acting.before };
      const parent = node.parentElement;
      acting = null;
      slot.hidden = true;
      if (!parent || !marble.id(parent)) { paintAim(); return; }
      let next = place.before;
      // The element already sits there: a drag that changed nothing files
      // nothing, rather than an op that says it moved to where it was.
      let after = node.nextElementSibling;
      while (after && (after.hasAttribute(TRANSIENT) || !after.getAttribute('data-marble-id'))) after = after.nextElementSibling;
      if (next === after) { paintAim(); return; }
      await play([{ type: 'move', id, parentId: marble.id(parent), beforeId: next ? marble.id(next) : null }]);
      const where = next ? `above ${marble.id(next)}` : 'to the end of its list';
      noteAct(`moved ${id} ${where}`, id, Boolean(can.move));
      if (!can.move) offerDeclare({ kind: 'sortable', el: parent, label: 'Make this list sortable' });
      paintAim();
    };

    // ---- resizing

    const startSizeGesture = (event, edge) => {
      if (!aiming?.el) return;
      const node = aiming.el;
      const id = marble.id(node);
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      const box = node.getBoundingClientRect();
      acting = {
        kind: 'size', el: node, can: aiming.can, id, pointerId: event.pointerId, edge,
        x: event.clientX, y: event.clientY,
        start: { width: Math.round(box.width), height: Math.round(box.height) },
        prior: node.getAttribute('style'),
        at: null,
      };
      grabs.find((grab) => grab.dataset.edge === edge)?.setPointerCapture(event.pointerId);
      says.hidden = true;
    };

    const dragSize = (event) => {
      const { el: node, edge, start } = acting;
      const width = edge.includes('e') ? Math.max(24, Math.round(start.width + event.clientX - acting.x)) : start.width;
      const height = edge.includes('s') ? Math.max(24, Math.round(start.height + event.clientY - acting.y)) : start.height;
      acting.at = { width, height };
      if (edge.includes('e')) node.style.width = `${width}px`;
      if (edge.includes('s')) node.style.height = `${height}px`;
      paintAim();
    };

    const commitSize = async () => {
      const { el: node, can, id, edge, prior, at } = acting;
      acting = null;
      if (!at) { paintAim(); return; }
      const declarations = {};
      if (edge.includes('e')) declarations.width = `${at.width}px`;
      if (edge.includes('s')) declarations.height = `${at.height}px`;
      const value = styleWith(node, declarations);
      if (value === prior) { paintAim(); return; }
      node.setAttribute('style', value);
      await play([{ type: 'setAttr', id, name: 'style', value }], {
        undo: [{ type: 'setAttr', id, name: 'style', value: prior }],
      });
      const said = edge === 'se' ? `${at.width}×${at.height}` : (edge === 'e' ? `${at.width} wide` : `${at.height} tall`);
      noteAct(`sized ${id} to ${said}`, id, Boolean(can.size));
      if (!can.size) offerDeclare({ kind: 'resizable', el: node, label: 'Make this resizable' });
      paintAim();
    };

    for (const grab of grabs) {
      grab.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || acting) return;
        startSizeGesture(event, grab.dataset.edge);
      });
      grab.addEventListener('pointermove', (event) => {
        if (acting?.kind === 'size' && event.pointerId === acting.pointerId) dragSize(event);
      });
      const let_go = (event) => {
        if (acting?.kind === 'size' && event.pointerId === acting.pointerId) commitSize();
      };
      grab.addEventListener('pointerup', let_go);
      grab.addEventListener('pointercancel', let_go);
    }

    // The vocabulary the gesture found missing, written in — one op, on the
    // element or the list that needed it, and then the tool has nothing more
    // to say about it.
    declare.addEventListener('click', async () => {
      const what = declaring;
      if (!what) return;
      offerDeclare(null);
      const id = marble.id(what.el);
      if (!id) return;
      const name = what.kind === 'sortable' ? 'data-marble-sortable' : 'data-marble-resizable';
      const value = what.kind === 'sortable' ? (id || 'items') : 'wh';
      await play([{ type: 'setAttr', id, name, value }]);
      noteAct(`declared ${id} ${what.kind}`, id, true);
      if (aiming?.el) { aiming.can = affordsOf(aiming.el); paintAim(); }
    });

    // ------------------------------------------------------------ the switch

    /** The selection is what the marquee picked *and* what the marks name,
     *  kept in two lists so that drawing does not wipe a rectangle and rubbing
     *  a stroke out does not wipe the rectangle either. */
    const syncSelection = () => {
      const all = [...area];
      for (const mark of drafts()) for (const id of idsOf(mark)) if (id && !all.includes(id)) all.push(id);
      if (!all.length) {
        if (!fromUs) return;
        fromUs = false;
        mine = [];
        agent.select(null);
        return;
      }
      mine = all;
      fromUs = true;
      agent.select(all);
    };
    const syncBrief = () => {
      const count = drafts().length;
      // Out of the mode with marks still in hand: the way back says so, since
      // nothing else on the page does any more.
      update({
        id: 'marks-describe',
        label: describing ? 'Leave Describe' : (count ? `Describe · ${count} kept` : 'Describe a change'),
      });
      clearButton.hidden = count === 0 && !(fromUs && mine.length);
      exploreButton.disabled = !(fromUs && mine.length);
      update({ id: 'ask', label: count && fromUs ? 'Ask about the sketch' : 'Ask here' });
      paintSend();
      paintFrame();
    };

    const trayEl = () => document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.tray') ?? null;
    /** The overlay is in the top layer and the tray is not, so the tray would
     *  be under it — and the tray is how Describe mode is turned off. Clip the
     *  corner it stands in out of the overlay, and the clicks there reach it. */
    const punch = () => {
      const r = trayEl()?.getBoundingClientRect();
      if (!r?.width || !r?.height) { overlay.style.clipPath = ''; return; }
      const pad = 10;
      const x0 = Math.max(0, Math.round(r.left - pad));
      const y0 = Math.max(0, Math.round(r.top - pad));
      const x1 = Math.round(r.right + pad);
      const y1 = Math.round(r.bottom + pad);
      overlay.style.clipPath = `path(evenodd, "M0 0H${innerWidth}V${innerHeight}H0Z M${x0} ${y0}H${x1}V${y1}H${x0}Z")`;
    };

    function setMode(next) {
      // A mode being left never leaves its drag behind: hiding the overlay
      // takes it out of hit-testing (and drops its pointer capture with it), so
      // a pointerup after this point would never reach `finish`.
      endDrag();
      endPen();
      acting = null;
      clearAim();
      offerDeclare(null);
      mode = next;
      layer.dataset.mode = next ?? '';
      overlay.hidden = !next;
      caption.hidden = true;
      if (next) punch();
      for (const [name, node] of Object.entries(tools)) node.setAttribute('aria-pressed', String(name === next));
      // The callout's handle would be drawn under the overlay and unclickable;
      // it comes back when the mode ends.
      dispatchEvent(new CustomEvent('marble-marks:mode', { detail: { mode: next, describing } }));
    }
    function setDescribing(on) {
      if (describing === on) return;
      describing = on;
      layer.toggleAttribute('data-describing', on);
      explore.hidden = true;
      // The selection goes away with the sight of the marks and comes back
      // with them. It is derived from what is marked, so there is nothing to
      // remember — and a callout handle left hanging at a selection nobody can
      // see is the one piece of this mode that would outlive it.
      handling = true;
      if (on) syncSelection();
      else if (fromUs) agent.select(null);
      handling = false;
      update({ id: 'marks-describe', active: on });
      // Figma opens on the picker, and so does this: the first thing a hand
      // does in a mode like it is point at something.
      setMode(on ? 'select' : null);
      syncBrief();
    }

    for (const [name, node] of Object.entries(tools)) {
      node.addEventListener('click', () => setMode(mode === name ? null : name));
    }
    clearButton.addEventListener('click', () => { clearMarks(); syncBrief(); });
    doneButton.addEventListener('click', () => setDescribing(false));

    // --------------------------------------------------------------- pointer

    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || drag || pen || moving) return;
      // The page never sees this press: no text selection starts under it.
      event.preventDefault();
      if (mode === 'select') {
        // A press on something already picked moves what is picked, rather
        // than starting a rectangle that would drop it.
        const hit = [...picked].find((mark) => {
          const span = spanOf(mark);
          return span && event.clientX >= span.left - 6 && event.clientX <= span.left + span.width + 6
            && event.clientY >= span.top - 6 && event.clientY <= span.top + span.height + 6;
        });
        if (hit) { startMove(event, [...picked], overlay); return; }
        overlay.setPointerCapture(event.pointerId);
        drag = {
          id: event.pointerId, x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY,
          boxes: collectBoxes(), scrollX, scrollY, ids: [], marks: [], raf: 0,
        };
        marquee.hidden = false;
        frameStep();
        return;
      }
      if (mode === 'sketch') {
        overlay.setPointerCapture(event.pointerId);
        caption.hidden = true;
        pen = { id: event.pointerId, points: [{ x: event.clientX, y: event.clientY }], el: newPath() };
        pen.el.setAttribute('d', pathOf(pen.points));
        return;
      }
      if (mode === 'text') { placeNote(event.clientX, event.clientY); return; }
      if (mode === 'adjust' && aiming?.el) startMoveGesture(event);
    });
    overlay.addEventListener('pointermove', (event) => {
      if (drag && event.pointerId === drag.id) {
        drag.x1 = event.clientX;
        drag.y1 = event.clientY;
        scheduleFrame();
        return;
      }
      if (pen && event.pointerId === pen.id) {
        // Every point the browser had between frames, so a fast stroke is a
        // curve rather than a polygon.
        const moves = event.getCoalescedEvents?.() ?? [event];
        for (const move of moves) {
          const last = pen.points[pen.points.length - 1];
          if (Math.hypot(move.clientX - last.x, move.clientY - last.y) < THIN) continue;
          pen.points.push({ x: move.clientX, y: move.clientY });
        }
        pen.el.setAttribute('d', pathOf(pen.points));
        return;
      }
      if (acting?.kind === 'move' && event.pointerId === acting.pointerId) {
        if (acting.can.move?.kind === 'canvas') {
          const box = acting.can.move.container.getBoundingClientRect();
          acting.el.style.left = `${Math.round(event.clientX - box.left - acting.grab.x)}px`;
          acting.el.style.top = `${Math.round(event.clientY - box.top - acting.grab.y)}px`;
          paintAim();
          return;
        }
        const place = dropPlace(event.clientX, event.clientY);
        acting.before = place.before;
        paintSlot(place);
        return;
      }
      if (mode === 'adjust' && !acting) { aimAt(event.clientX, event.clientY); return; }
      if (mode === 'sketch' && !moving) hover(event);
    });
    const finish = (event) => {
      if (acting?.kind === 'move' && event.pointerId === acting.pointerId) { commitMove(); return; }
      if (pen && event.pointerId === pen.id) {
        const done = endPen({ keep: true });
        done.el.remove();
        if (commitStroke(done.points)) {
          repaint();
          syncSelection();
          syncBrief();
        }
        return;
      }
      if (!drag || event.pointerId !== drag.id) return;
      cancelAnimationFrame(drag.raf);
      drag.raf = 0;
      // The release point, not the last move: a finger usually travels a few
      // pixels between the two, and the rectangle a person let go of is the one
      // they meant.
      drag.x1 = event.clientX;
      drag.y1 = event.clientY;
      // Measured again, once, before anything is committed. The live outline
      // follows a scroll by translating the boxes from the press, which is
      // wrong for a `position: fixed` element that stayed where it was — so the
      // outline may drift a pixel mid-scroll, while the ids handed to an agent
      // are always measured fresh.
      drag.boxes = collectBoxes();
      drag.scrollX = scrollX;
      drag.scrollY = scrollY;
      frameStep();
      const ids = drag.ids;
      const prior = event.shiftKey ? area : [];
      endDrag();
      area = [...prior, ...ids.filter((id) => !prior.includes(id))];
      syncSelection();
      syncBrief();
      // A marquee is one gesture and it is over; Select stays on, because the
      // next thing a hand does in a picker is pick something else.
    };
    overlay.addEventListener('pointerup', finish);
    // A cancel is not a release: a pinch during a marquee — which the overlay's
    // `touch-action: pinch-zoom` invites — takes the pointer away mid-rectangle,
    // and committing the half-drawn one would name whatever the hand happened
    // to be over.
    overlay.addEventListener('pointercancel', (event) => {
      if (drag && event.pointerId === drag.id) endDrag();
      if (pen && event.pointerId === pen.id) endPen();
    });

    /** The reading of the stroke under the pointer, in words. */
    const hover = (event) => {
      let found = null;
      for (const mark of marks) {
        if (mark.type !== 'stroke') continue;
        const box = boxOf(mark.anchorId);
        if (!box) continue;
        for (const part of mark.parts) {
          const points = pointsOf(part, box);
          // The stroke's own box first: a pointer nowhere near it costs four
          // comparisons rather than a walk down every point in it.
          const span = G().boundsOf(points);
          if (event.clientX < span.left - 14 || event.clientX > span.left + span.width + 14
            || event.clientY < span.top - 14 || event.clientY > span.top + span.height + 14) continue;
          for (const p of points) {
            if (Math.hypot(p.x - event.clientX, p.y - event.clientY) > 14) continue;
            found = mark;
            break;
          }
          if (found) break;
        }
        if (found) break;
      }
      if (!found) { caption.hidden = true; return; }
      caption.textContent = phraseOf(found);
      caption.hidden = false;
      const r = caption.getBoundingClientRect();
      caption.style.left = `${Math.min(Math.max(8, event.clientX + 14), innerWidth - r.width - 8)}px`;
      caption.style.top = `${Math.min(Math.max(8, event.clientY + 16), innerHeight - r.height - 8)}px`;
    };

    // --------------------------------------------------------------- Explore

    const openExplore = () => {
      if (!(fromUs && mine.length)) return;
      explore.hidden = false;
      field.hidden = true;
      paintFrame();
      wantField.focus();
    };
    const runExplore = () => {
      const ids = fromUs ? mine : [];
      if (!ids.length) return;
      const want = wantField.textContent.trim();
      const why = whyField.textContent.trim();
      const lines = [
        `Explore ${howMany} variations of ${names(ids)} in this document.`,
        want && `What to try: ${want}`,
        why && `Why: ${why}`,
        note() && note().trim(),
        '',
        `Write them into the document as alternatives, not as prose: wrap each of ${names(ids)} in a <marble-alt> carrying that element's own data-marble-id, move the existing version inside it as the first child with a fresh id and data-marble-alt="v1", and add ${howMany - 1} more children, each a full version of the element with a fresh id, a short data-marble-alt name, and a data-why saying in a few words what it is trying. Set data-marble-active to the original. Do not change anything outside those elements, and do not explain the variations in chat — the page reads them from the file.`,
      ].filter(Boolean);
      explore.hidden = true;
      wantField.textContent = '';
      whyField.textContent = '';
      dispatchEvent(new CustomEvent('marble-variations:watch', { detail: { ids } }));
      handOff(lines.join('\n'));
      paintFrame();
    };
    exploreButton.addEventListener('click', () => {
      if (explore.hidden) { openExplore(); return; }
      explore.hidden = true;
      paintFrame();
    });
    go.addEventListener('click', runExplore);
    for (const node of [wantField, whyField]) {
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); runExplore(); }
        if (event.key === 'Escape') { event.stopPropagation(); explore.hidden = true; paintFrame(); }
      });
    }

    // ---------------------------------------------------------------- events

    // Wheel passes through the overlay and the page moves under the drag; the
    // ink and the notes move with the elements they were put on.
    addEventListener('scroll', () => { if (drag) scheduleFrame(); scheduleRepaint(); }, true);
    addEventListener('resize', () => { scheduleRepaint(); if (mode) punch(); });
    // An agent rewriting the page is the other way an anchor moves — and so is
    // the pinned drawer taking a margin off `<html>`, which is a reflow and not
    // a resize of the window. Watching the root catches both, and every reflow
    // a document does to itself besides.
    document.addEventListener('marble:ops', scheduleRepaint);
    new ResizeObserver(scheduleRepaint).observe(document.documentElement);

    const typing = (node) => node?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(node?.tagName);
    addEventListener('keydown', (event) => {
      if (mode === 'sketch' && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        if (!marks.length) return;
        event.preventDefault();
        event.stopPropagation();
        undoStroke();
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && picked.size && !typing(document.activeElement)) {
        event.preventDefault();
        for (const mark of [...picked]) removeMark(mark);
        picked.clear();
        repaint();
        return;
      }
      if (event.key !== 'Escape') return;
      if (!explore.hidden) { event.preventDefault(); event.stopPropagation(); explore.hidden = true; paintFrame(); return; }
      // Escape leaves the tool; Escape with no tool leaves Describe mode. The
      // ink stays either way, because it is the brief and not the mode.
      if (mode) { event.preventDefault(); event.stopPropagation(); setMode(null); return; }
      if (describing) { event.preventDefault(); event.stopPropagation(); setDescribing(false); return; }
      if (fromUs) { area = []; fromUs = false; mine = []; agent.select(null); syncBrief(); }
    }, true);

    // A fresh text selection is the person choosing something else; so is any
    // other selection this layer did not make.
    addEventListener('marble:agent-context', () => {
      if (handling || !fromUs) return;
      const now = agent.context().selection;
      if (now.length === mine.length && now.every((id, i) => id === mine[i])) return;
      fromUs = false;
      mine = [];
      area = [];
      syncBrief();
    });

    // The drawer opening covers the page a mode acts on, and its panel is not
    // in the top layer the overlay is — so the mode ends rather than draw over
    // a panel it cannot reach.
    const panel = document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.panel');
    if (panel) {
      new MutationObserver(() => {
        const covered = panel.dataset.open === 'true' && panel.dataset.pinned !== 'true';
        // A hidden bar is for the drawer covering the page. Leaving the mode is the
        // layer's own fade, which a display:none here would cut short.
        bar.hidden = covered;
        if (covered && mode) setMode(null);
      }).observe(panel, { attributes: true, attributeFilter: ['data-open', 'data-pinned'] });
    }
    const tray = trayEl();
    if (tray) {
      // The hole follows the tray: it grows a row when a tool appears, and it
      // moves inward with the page's edge when the drawer is pinned.
      new ResizeObserver(() => { if (mode) punch(); }).observe(tray);
      new MutationObserver(() => { if (mode) punch(); }).observe(tray, { attributes: true, attributeFilter: ['style', 'data-away', 'data-open'] });
    }

    // The callout card is where a brief lands. Whoever opened it, the words go
    // in as a draft the person can still edit; only a brief this layer sent on
    // purpose is submitted for them.
    addEventListener('marble-callout:card', (event) => {
      const convo = event.detail?.convo;
      const brief = pending;
      pending = null;
      const text = brief ? brief.text : (fromUs ? note() : '');
      if (!convo || !text) return;
      const sent = brief?.marks ?? drafts();
      if (brief?.submit && typeof convo.sendNow === 'function') convo.sendNow(text);
      else convo.draft?.(text);
      // Dimmed once the brief is on its way, not when the card opens: a card
      // closed without sending leaves the marks yours.
      const dim = () => {
        for (const mark of sent) {
          mark.sent = true;
          if (mark.type === 'note') mark.el.dataset.state = 'sent';
          else if (mark.type === 'stroke') for (const part of mark.parts) part.el.dataset.state = 'sent';
        }
        syncBrief();
      };
      if (brief?.submit) dim();
      else convo.addEventListener('conversation', dim, { once: true });
    });

    setMode(null);
    syncBrief();
    return true;
  };

  const start = () => {
    if (boot(window.marble)) return;
    // No tray yet: the drawer says so when it mounts.
    addEventListener('marble-tray:ready', () => boot(window.marble), { once: true });
  };

  if (window.marble?.agent) start();
  else addEventListener('marble:agent', start, { once: true });
})();
