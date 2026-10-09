// Describe mode: the tools for saying what you want about a document, and the
// frame and card that carry what you said to an agent.
//
// The tray's entry, the shell's bar or ⌘⇧D turns it on; the tools themselves
// live in a toolbar at the bottom of the page, where a hand rests while the
// eye is on it, one key each: V is the page itself, A Select, P Sketch,
// T Note, E Explore.
// Select is a marquee over addressed elements — and over the marks you made.
// Sketch is ink, read as a box, an arrow or a scribble. Text is a note stuck
// on the page. Explore asks for alternatives, which the document has its own
// element for, so the comparing is `agent-variations.js`'s job and not this
// one's.
//
// Nothing here edits the document: everything drawn is transient chrome in one
// fixed layer, like the callout. Nothing here invents a way to send, either —
// the composer hung on the marks is the ⌘J line (change-line.js), lent, so the
// words go out through the same component, and look the same, as every other
// ask on the page.
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
    // The cursor: the page answering as it always does, with the marks left
    // where they are.
    use: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6.5 4.2 18 12.4l-5.4 1.1-2.5 5.3z"/></svg>',
    // An area, drawn as the marquee itself; ink, drawn as a stroke that is
    // plainly a hand's; a note; a set of things that might have been; and the
    // way out.
    select: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5"/></svg>',
    sketch: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 16.2c2.6-6.4 4.6-9.6 6-9.6 2 0 .4 9.6 2.4 9.6 1.4 0 3.1-3.2 5.1-9.6"/><path d="M4 20.2h16"/></svg>',
    // A note: a slip of paper with its corner turned and two lines on it.
    text: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4.5h11a2 2 0 0 1 2 2v7.5l-5.5 5.5h-7.5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z"/><path d="M19.5 14H16a2 2 0 0 0-2 2v3.5"/><path d="M8.5 9h7M8.5 12.5h4"/></svg>',
    // Build mode's one new tool: a pin with a thread, which the agent answers.
    comment: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5a7.5 7.5 0 1 1-3.5 14.1L4.5 19.5l.9-3.9A7.5 7.5 0 0 1 12 4.5z"/></svg>',
    explore: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="4" width="8" height="7" rx="2"/><rect x="13" y="4" width="8" height="7" rx="2"/><rect x="3" y="13" width="8" height="7" rx="2"/><rect x="13" y="13" width="8" height="7" rx="2"/></svg>',
    clear: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 18.5 4 14a1.6 1.6 0 0 1 0-2.3l7-7a1.6 1.6 0 0 1 2.3 0l5.2 5.2a1.6 1.6 0 0 1 0 2.3l-6.3 6.3z"/><path d="M9 20h11"/></svg>',
    done: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>',
  };

  const STYLE = `
    .marble-marks-layer, .marble-marks-held {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none;
      z-index: 2147483002;
      --marks-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)));
      --marks-paper: var(--card, var(--paper, #fff));
      --marks-ink: var(--ink, #222);
      /* The mode's own colour: leaf green, a pen rather than a warning. Not the
         caution gold, which means an agent is waiting on you; not the accent;
         not an agent's violet. So being in Describe mode cannot be mistaken
         for anything else on the page. A document may set --sketch and
         --sketch-on; text on the colour flips with the scheme, because white
         on the light green reads and white on the dark one does not. */
      --marks-notice: var(--sketch, light-dark(#2b8052, #7fd3a0));
      --marks-notice-on: var(--sketch-on, light-dark(#ffffff, #1c1f22));
      font: 400 13px/1.35 var(--ui-font, system-ui, -apple-system, sans-serif);
      color: var(--marks-ink);
    }
    /* In the top layer so no document's stacking context can cover it; the UA
       sheet for [popover] would otherwise centre it and give it a border. */
    .marble-marks-layer:popover-open, .marble-marks-held:popover-open { position: fixed; inset: 0; }
    /* Marks an agent is working from. They leave the mode's layer for this one
       when the brief is sent, so leaving Describe mode does not take them
       with it: while the work is going on, the page still shows what was
       asked for and where. Inert, because they are the brief now and not a
       draft. */
    .marble-marks-held * { pointer-events: none !important; }

    /* Leaving Describe mode takes everything it drew with it — the ink, the
       notes, the frame, the card, the toolbar — and brings it all back on the
       way in. Nothing is thrown away: the marks are still in the layer, still
       in the brief, still naming their elements. What goes is the sight of
       them, because a page you have stopped marking up is a page you want to
       read.

       Opacity does the fading and visibility does the rest: without it the
       notes would still take the caret and the toolbar would still be in the
       tab ring, invisibly. It flips after the fade on the way out and
       immediately on the way in, which is the difference between a fade and a
       blink. */
    /* The notice: a ring round the window's edge and a line at the top, for
       as long as the mode lasts. You cannot be looking at the page without
       seeing that you are in it. */
    .marble-marks-ring {
      position: fixed; inset: 0; pointer-events: none;
      box-shadow: inset 0 0 0 3px var(--marks-notice), inset 0 0 38px color-mix(in srgb, var(--marks-notice) 20%, transparent);
    }
    .marble-marks-notice {
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 13px; border-radius: 999px;
      background: var(--marks-notice); color: var(--marks-notice-on); white-space: nowrap; pointer-events: auto;
      font: 500 12.5px/1 var(--ui-font, system-ui, -apple-system, sans-serif);
      box-shadow: 0 4px 10px rgba(0,0,0,.12), 0 14px 28px rgba(0,0,0,.14);
    }
    .marble-marks-notice b { font-weight: 650; }
    .marble-marks-notice .marble-marks-notice-sep { opacity: .55; }
    .marble-marks-notice button {
      font: inherit; font-size: 12px; color: var(--marks-notice-on); background: color-mix(in srgb, var(--marks-notice-on) 18%, transparent); border: 0;
      border-radius: 999px; padding: 5px 10px; cursor: pointer;
    }
    .marble-marks-notice button:hover { background: color-mix(in srgb, var(--marks-notice-on) 30%, transparent); }
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

    .marble-marks-ink { position: fixed; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .marble-marks-stroke {
      fill: none; stroke: var(--marks-mark); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round;
      transition: opacity 180ms ${EASE};
    }
    /* Handed over: still yours to look at, no longer the thing being made. */
    .marble-marks-stroke[data-state="sent"] { opacity: .55; }

    /* A note is a thing you put *on* the page, so it has a paper of its own and
       a grip, and it never pretends to be part of the document under it. */
    /* As wide as its longest line, from a slip to a card: it widens as the
       words come and wraps once it is as wide as a note should be, so the
       whole of what was typed is always in view. */
    .marble-marks-note {
      position: fixed; pointer-events: auto; box-sizing: border-box;
      width: max-content; min-width: 220px; max-width: min(380px, calc(100vw - 32px)); border-radius: 12px;
      background: var(--marks-paper); color: var(--marks-ink);
      border: 1px solid color-mix(in srgb, var(--marks-mark) 45%, transparent);
      box-shadow: 0 1px 2px rgba(0, 0, 0, .06), 0 8px 22px rgba(0, 0, 0, .12);
      overflow: hidden; transform-origin: 0 0;
      transition: opacity 200ms ${EASE}, scale 260ms ${EASE}, visibility 0s;
    }
    .marble-marks-note[data-state="sent"] { opacity: .62; }
    /* Being written, it is a box to type in: the composer's ring. Left, it
       is a note: paper on the app. Sent, it folds into the pin of the comment
       it becomes. */
    .marble-marks-layer[data-build] .marble-marks-note[data-writing] {
      border-color: var(--accent, #9bb6cf);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #9bb6cf) 30%, transparent), 0 8px 22px rgba(0, 0, 0, .12);
    }
    .marble-marks-note[data-sending] { opacity: 0; scale: .1; pointer-events: none; transition: opacity 200ms ${EASE}, scale 240ms ${EASE}; }
    .marble-marks-note-act {
      display: none; align-items: center; gap: 4px; padding: 0 6px 6px 8px;
    }
    .marble-marks-layer[data-build] .marble-marks-note:is([data-writing], :hover, :focus-within) .marble-marks-note-act { display: flex; }
    .marble-marks-note-act .sp { flex: 1; }
    .marble-marks-note-act button {
      all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border-radius: 8px;
      font: 500 12px/1 var(--ui-font, system-ui, sans-serif); cursor: pointer; color: color-mix(in srgb, var(--marks-ink) 70%, transparent);
    }
    .marble-marks-note-act button:hover { background: color-mix(in srgb, var(--marks-ink) 7%, transparent); color: var(--marks-ink); }
    .marble-marks-note-act button:focus-visible { outline: 2px solid var(--marks-mark); outline-offset: 1px; }
    .marble-marks-note-act .send { background: var(--marks-ink); color: var(--marks-paper); }
    .marble-marks-note-act .send:hover { background: color-mix(in srgb, var(--marks-ink) 84%, var(--marks-paper)); color: var(--marks-paper); }
    .marble-marks-note-act .send[aria-disabled="true"] { opacity: .35; cursor: default; }
    .marble-marks-note-act kbd { font: inherit; opacity: .6; }
    .marble-marks-note-act svg { width: 13px; height: 13px; }
    /* The top edge is the grip: no strip and no rule drawn on it, just the
       hand when it is over it, and the × at its end. */
    .marble-marks-note-grip {
      display: flex; align-items: center; justify-content: flex-end; height: 18px; padding: 3px 4px 0 7px;
      margin-bottom: -10px; position: relative; z-index: 1;
      cursor: grab; touch-action: none;
    }
    .marble-marks-note[data-dragging] .marble-marks-note-grip { cursor: grabbing; }
    .marble-marks-note-dots { display: none; }
    .marble-marks-note-close {
      all: unset; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center;
      cursor: pointer; font-size: 13px; line-height: 1; color: color-mix(in srgb, var(--marks-ink) 55%, transparent);
    }
    .marble-marks-note-close:hover { background: color-mix(in srgb, var(--marks-ink) 10%, transparent); }
    .marble-marks-note-body {
      display: block; padding: 8px 26px 9px 11px; font-size: 13px; line-height: 1.45; min-height: 1.45em;
      outline: none; white-space: pre-wrap; overflow-wrap: anywhere;
    }
    /* What was pasted in: pictures as pictures, a part of a page as the part,
       drawn small. Each comes off with its own ×. */
    .marble-marks-note-att { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 11px 10px; }
    .marble-marks-note-att:empty { display: none; }
    .marble-marks-att {
      position: relative; margin: 0; border-radius: 8px; overflow: hidden; flex: none;
      background: color-mix(in srgb, var(--marks-ink) 5%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marks-ink) 10%, transparent);
    }
    .marble-marks-att img { display: block; max-width: 100%; max-height: 180px; object-fit: contain; }
    .marble-marks-att[data-kind="image"] { max-width: 100%; }
    .marble-marks-att[data-kind="image"]:only-child img { max-height: 240px; }
    .marble-marks-att[data-loading] img { opacity: .5; }
    .marble-marks-att[data-kind="clip"] { width: 100%; }
    .marble-marks-att iframe { display: block; width: 100%; height: 88px; border: 0; pointer-events: none; background: var(--paper, #fafaf7); }
    .marble-marks-att figcaption {
      padding: 5px 8px; font-size: 11.5px; line-height: 1.3; color: color-mix(in srgb, var(--marks-ink) 62%, transparent);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .marble-marks-att .marble-marks-note-close {
      position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; font-size: 13px;
      background: color-mix(in srgb, var(--marks-paper) 88%, transparent); opacity: 0; transition: opacity 120ms ${EASE};
    }
    .marble-marks-att:hover .marble-marks-note-close, .marble-marks-att .marble-marks-note-close:focus-visible,
    .marble-marks-note:focus-within .marble-marks-att .marble-marks-note-close { opacity: 1; }
    @media (hover: none) { .marble-marks-att .marble-marks-note-close { opacity: 1; } }
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

    /* The toolbar. Bottom centre, where every drawing tool puts one, because
       that is where a hand rests when the eye is on the page. */
    /* Centred on the page the tools act on: inside the shell (runtime/shell.js)
       and beside a docked chat, that is the room they leave, not the window. */
    .marble-marks-bar {
      position: fixed; transform: translateX(-50%);
      left: calc(var(--marble-shell-left, 0px) + (100vw - var(--marble-shell-left, 0px) - var(--marble-dock-right, 0px)) / 2);
      /* Above a sheet from the foot (Build mode's side on a phone). */
      bottom: calc(18px + var(--marble-dock-bottom, 0px) + env(safe-area-inset-bottom, 0px));
      display: flex; align-items: center; gap: 2px; padding: 5px; border-radius: 15px;
      pointer-events: auto;
      background: color-mix(in srgb, var(--marks-paper) 74%, transparent);
      -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
      box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 40%, transparent),
        0 1px 2px rgba(0, 0, 0, .08), 0 12px 32px rgba(0, 0, 0, .16);
      transition: opacity 180ms ${EASE}, transform 180ms ${EASE}, bottom 340ms ${EASE}, left 340ms ${EASE};
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
    /* Just the icon; the name and its key come up on hover or focus, after a
       beat, so passing over the row does not flash a label at every step. */
    .marble-marks-tool::after {
      content: attr(data-label) attr(data-key-hint); position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
      white-space: nowrap; padding: 4px 8px; border-radius: 7px; font: 500 11.5px/1 var(--ui-font, system-ui, sans-serif);
      background: color-mix(in srgb, var(--marks-ink) 88%, transparent); color: var(--marks-paper);
      opacity: 0; pointer-events: none; transition: opacity 120ms ${EASE};
    }
    .marble-marks-tool:hover::after, .marble-marks-tool:focus-visible::after { opacity: 1; transition-delay: 300ms; }
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

    /* What was just taken off, and the way to put it back: a line over the
       toolbar for a few seconds, the same ⌘Z the hand already knows. */
    .marble-marks-undo {
      position: fixed; transform: translateX(-50%); pointer-events: auto;
      left: calc(var(--marble-shell-left, 0px) + (100vw - var(--marble-shell-left, 0px) - var(--marble-dock-right, 0px)) / 2);
      bottom: calc(76px + var(--marble-dock-bottom, 0px) + env(safe-area-inset-bottom, 0px));
      display: flex; align-items: center; gap: 10px; padding: 5px 5px 5px 13px; border-radius: 11px;
      background: var(--marks-paper); color: var(--marks-ink); white-space: nowrap;
      font: 400 12.5px/1 var(--ui-font, system-ui, -apple-system, sans-serif);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--marks-ink) 10%, transparent), 0 1px 2px rgba(0,0,0,.06), 0 8px 22px rgba(0,0,0,.12);
      transition: opacity 180ms ${EASE}, translate 180ms ${EASE}, left 340ms ${EASE};
    }
    .marble-marks-undo[hidden] { display: none; }
    @starting-style { .marble-marks-undo { opacity: 0; translate: 0 6px; } }
    .marble-marks-undo button {
      all: unset; cursor: pointer; padding: 6px 10px; border-radius: 8px; font-weight: 500;
      color: var(--marks-mark);
    }
    .marble-marks-undo button:hover { background: color-mix(in srgb, var(--marks-mark) 10%, transparent); }
    .marble-marks-undo button:focus-visible { outline: 2px solid var(--marks-mark); outline-offset: 1px; }
    .marble-marks-undo kbd { font: inherit; opacity: .6; margin-left: 6px; }

    /* ---------------------------------------------------------- Build mode

       Describe is where every app starts, so it says so with nothing but the
       toolbar rising from the foot: no ring round the window, no line at its
       top, and the app at full size. The bar is a rounded rectangle at the
       sheet radius, its tools at 10px inside. */
    .marble-marks-layer[data-build] .marble-marks-ring,
    .marble-marks-layer[data-build] .marble-marks-notice { display: none; }
    .marble-marks-layer[data-build] .marble-marks-bar { border-radius: 14px; transition: opacity 340ms ${EASE}, transform 340ms ${EASE}, left 340ms ${EASE}; }
    .marble-marks-slot { display: contents; }
    /* Comment is the one tool Describe did not have: a dot says so until it
       is used once. */
    .marble-marks-tool[data-new]::before {
      content: ""; position: absolute; top: 6px; right: 6px; width: 6px; height: 6px; border-radius: 50%;
      background: var(--accent, #9bb6cf); box-shadow: 0 0 0 2px var(--marks-paper);
    }
    .marble-marks-tool[aria-pressed="true"][data-new]::before { display: none; }
    .marble-marks-layer[data-mode="comment"] .marble-marks-overlay { cursor: copy; }

    /* A mark says where it is in the builds, in its foot: waiting for the
       next one while a build runs, in the build, or built. Built marks stay,
       faint, as the record of why a part looks as it does. */
    .marble-marks-note-foot {
      display: flex; align-items: center; gap: 5px; padding: 0 8px 6px; font-size: 11px; line-height: 1.2;
      color: color-mix(in srgb, var(--marks-ink) 55%, transparent);
    }
    .marble-marks-note-foot[hidden] { display: none; }
    .marble-marks-note-foot::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity: .7; }
    .marble-marks-note[data-state="built"], .marble-marks-piece[data-state="built"] { opacity: .62; }
    .marble-marks-stroke[data-state="built"] { opacity: .45; }
    /* Archived — built, resolved, or put away by hand — is off the app. It is
       kept in the margin's Archived list (build-margin.js). */
    .marble-marks-layer :is(.marble-marks-note, .marble-marks-piece, .marble-marks-pin)[data-archived],
    .marble-marks-stroke[data-archived] { display: none; }

    /* A comment is a numbered pin with its beak on the point, as a kept note
       is (agent-notes.js); its thread opens beside it (build-mode.js). */
    .marble-marks-pin {
      position: fixed; width: 22px; height: 22px; padding: 0; margin: 0; border: 0; cursor: pointer; pointer-events: auto;
      transform: translate(0, -100%);
      border-radius: 50% 50% 50% 3px; background: var(--marks-mark); color: var(--marks-paper);
      font: 650 11px/22px var(--ui-font, system-ui, sans-serif); text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.2);
      transition: scale 140ms ${EASE};
    }
    .marble-marks-pin:hover, .marble-marks-pin:focus-visible, .marble-marks-pin[aria-expanded="true"] { scale: 1.12; outline: none; }
    .marble-marks-pin[data-state="built"] { opacity: .62; }
    .marble-marks-pin[hidden] { display: none; }
    /* With Build mode's margin open (build-margin.js), the marks are read
       there: the bodies of notes and pieces fold into the point they were put
       on, sketches fade, and the margin's own pins say where each one is. One
       being written stays whole until it is left — a new note, a comment not
       yet posted — and then folds the same way. Closing the margin unfolds
       them from their pins. */
    .marble-marks-layer[data-margin] :is(.marble-marks-note:not(:focus-within):not([data-writing]), .marble-marks-piece) {
      opacity: 0; scale: .08; visibility: hidden; pointer-events: none;
      transition: opacity 220ms ${EASE}, scale 260ms ${EASE}, visibility 0s 260ms;
    }
    .marble-marks-layer[data-margin] .marble-marks-pin:not([data-local]) {
      opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 200ms ${EASE}, visibility 0s 200ms;
    }
    .marble-marks-layer[data-margin] .marble-marks-stroke { opacity: .35; }
    @starting-style { .marble-marks-pin { scale: .4; } }

    /* A piece put on the app: attached on top like a card on a canvas,
       outlined dashed (a part still to come) until a build works it in. */
    .marble-marks-piece {
      position: fixed; pointer-events: auto; width: 268px; border-radius: 12px; transform-origin: 0 0;
      transition: opacity 200ms ${EASE}, scale 260ms ${EASE}, visibility 0s;
      background: var(--marks-paper); color: var(--marks-ink);
      box-shadow: 0 2px 6px rgba(0,0,0,.07), 0 8px 18px rgba(0,0,0,.08);
      outline: 1px dashed color-mix(in srgb, var(--marks-mark) 75%, transparent); outline-offset: 3px;
    }
    .marble-marks-piece[hidden] { display: none; }
    .marble-marks-piece-head {
      display: flex; align-items: center; gap: 6px; padding: 7px 6px 6px 11px; cursor: grab; touch-action: none;
      font-size: 12.5px; font-weight: 500;
    }
    .marble-marks-piece[data-dragging] .marble-marks-piece-head { cursor: grabbing; }
    .marble-marks-piece-head span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-marks-piece-head small { font-weight: 400; color: color-mix(in srgb, var(--marks-ink) 50%, transparent); font-size: 12px; }
    .marble-marks-piece iframe {
      display: block; width: calc(100% - 16px); height: 132px; margin: 0 8px; border: 0; border-radius: 8px;
      background: var(--paper, #fafaf7); pointer-events: none;
    }
    .marble-marks-piece .marble-marks-note-foot { padding: 7px 11px 8px; }

    /* A phone has no room for the whole bar: the tools close up, the
       hairlines go, and Clear waits for Select (its bar can remove what is
       picked). Nothing runs off the side. */
    @media (max-width: 520px) {
      .marble-marks-layer[data-build] .marble-marks-bar { gap: 0; padding: 4px; max-width: calc(100vw - 16px); }
      .marble-marks-layer[data-build] .marble-marks-tool { width: 31px; height: 36px; }
      .marble-marks-layer[data-build] .marble-marks-sep { display: none; }
      .marble-marks-layer[data-build] .marble-marks-tool[data-tool="clear"] { display: none; }
    }

    /* Picked, in Build mode: Select's outline and nothing filled. */
    .marble-marks-layer[data-build] .marble-marks-frame { background: none; }

    @media (prefers-reduced-transparency: reduce) {
      .marble-marks-bar { background: var(--marks-paper); -webkit-backdrop-filter: none; backdrop-filter: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .marble-marks-stroke, .marble-marks-bar, .marble-marks-frame, .marble-marks-tool { transition: none; }
      .marble-marks-layer[data-margin] :is(.marble-marks-note, .marble-marks-piece) { scale: none; }
      .marble-marks-undo { transition: opacity 120ms linear; }
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
      key: '⌘⇧D',
      icon: GLYPHS.describe,
      always: true,
      active: false,
      onSelect: () => setDescribing(!describing),
    })) return false;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);

    // Build mode (build-mode.js): every app starts in Describe, its marks are
    // kept for it by the host, and Build takes them. The Drive's own page is
    // the frame apps sit in, not an app to build, and keeps Describe as it was.
    // It can be turned off for this browser (the shell's Settings, "Build
    // mode"), or by a page for itself (<meta name="marble-build" content="off">),
    // and then Describe is the mode you turn on that sends from the ⌘J line.
    const buildOff = () => {
      if (document.querySelector('meta[name="marble-build"][content="off"]')) return true;
      try { return localStorage.getItem('marble-build') === 'off'; } catch { return false; }
    };
    const building = !document.body?.classList.contains('drive') && !buildOff();
    const app = marble.app;

    const layer = document.createElement('div');
    layer.className = 'marble-marks-layer';
    layer.setAttribute(TRANSIENT, '');
    layer.setAttribute('popover', 'manual');
    layer.toggleAttribute('data-build', building);
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

    const notes = el('div', 'marble-marks-notes', layer);
    const halos = [];
    const hits = [];

    // ------------------------------------------------------------ the held
    //
    // A second top-layer sheet for the marks an agent is working from. It is
    // not inside the mode's layer, so the mode fading out leaves it standing.

    const held = document.createElement('div');
    held.className = 'marble-marks-held';
    held.setAttribute(TRANSIENT, '');
    held.setAttribute('popover', 'manual');
    held.inert = true;
    document.documentElement.append(held);
    try { held.showPopover(); } catch { /* fixed positioning still stands */ }
    const heldInk = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    heldInk.setAttribute('class', 'marble-marks-ink');
    heldInk.setAttribute('aria-hidden', 'true');
    heldInk.setAttribute(TRANSIENT, '');
    held.append(heldInk);
    const heldNotes = el('div', 'marble-marks-notes', held);

    // ----------------------------------------------------------- the toolbar

    // A note or the Explore ask is typed into on the page itself; its keys
    // are its own, not the page's shortcuts (runtime/agent-ui.js, keepKeys).
    window.marbleAgentUI?.keepKeys?.(layer);

    const bar = el('div', 'marble-marks-bar', layer);
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Describe');
    // Not hidden: out of the mode the whole layer is invisible, and the toolbar
    // is only ever `hidden` when the drawer is covering the page it acts on.
    const button = (id, label, glyph, { pressed = null, key = null } = {}) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'marble-marks-tool';
      node.dataset.tool = id;
      node.dataset.label = label;
      if (key) {
        node.dataset.key = key.toLowerCase();
        node.dataset.keyHint = `\u2003${key}`;
        node.setAttribute('aria-keyshortcuts', key);
      }
      node.setAttribute(TRANSIENT, '');
      node.setAttribute('aria-label', key ? `${label} (${key})` : label);
      if (pressed !== null) node.setAttribute('aria-pressed', String(pressed));
      node.innerHTML = glyph;
      bar.append(node);
      return node;
    };
    // The cursor first: with no tool on, the page is the page — and every
    // tool is one key away from it, and back.
    const useButton = button('use', 'Use the app', GLYPHS.use, { pressed: true, key: 'V' });
    const tools = {
      select: button('select', 'Select', GLYPHS.select, { pressed: false, key: 'A' }),
      sketch: button('sketch', 'Sketch', GLYPHS.sketch, { pressed: false, key: 'P' }),
      text: button('text', 'Note', GLYPHS.text, { pressed: false, key: 'T' }),
    };
    // Build mode has no Comment tool: a note is the one thing to write, and
    // it is kept as a note or sent (⌘↵) to be answered or made now.
    el('span', 'marble-marks-sep', bar);
    // Build mode drops Explore from the bar: Build is what the marks are for.
    const exploreButton = button('explore', 'Explore variations', GLYPHS.explore, { key: 'E' });
    if (building) exploreButton.remove();
    const clearButton = button('clear', 'Clear marks', GLYPHS.clear);
    el('span', 'marble-marks-sep', bar);
    // Where Build mode puts the build: its status, Builds and Build.
    const slot = el('span', 'marble-marks-slot', bar);
    if (building) el('span', 'marble-marks-sep', bar);
    else slot.remove();
    const doneButton = button('done', 'Done', GLYPHS.done, { key: 'Esc' });

    // The notice, shown with the rest of the layer only while describing.
    const ring = el('div', 'marble-marks-ring', layer);
    ring.setAttribute('aria-hidden', 'true');
    const notice = el('div', 'marble-marks-notice', layer);
    notice.setAttribute('role', 'status');
    const noticeTitle = document.createElement('b');
    noticeTitle.textContent = 'Describe mode';
    const noticeSep = document.createElement('span');
    noticeSep.className = 'marble-marks-notice-sep';
    noticeSep.textContent = '·';
    const noticeLine = document.createElement('span');
    noticeLine.textContent = 'Mark what you mean — nothing you draw changes the page';
    const noticeLeave = document.createElement('button');
    noticeLeave.type = 'button';
    noticeLeave.textContent = 'Esc to leave';
    noticeLeave.setAttribute('aria-label', 'Leave Describe mode');
    noticeLeave.addEventListener('click', () => setDescribing(false));
    for (const node of [noticeTitle, noticeSep, noticeLine, noticeLeave]) node.setAttribute(TRANSIENT, '');
    notice.append(noticeTitle, noticeSep, noticeLine, noticeLeave);

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
    // The ⌘J line this mode has borrowed as its composer, while it has one.
    let card = null;
    // True while Explore's ask is on its way: that ask already carries the
    // marks' reading, so the card must not put it in front a second time.
    let exploring = false;
    const marks = [];
    const picked = new Set();
    // Who wants to know (build-mode.js): that the marks changed (`watchers`),
    // and what is picked and where (`pickers`), on every paint of the frame.
    const watchers = new Set();
    const pickers = new Set();
    const tellPicked = (span) => {
      if (!pickers.size) return;
      const detail = {
        marks: [...picked].map((mark) => mark.id).filter(Boolean),
        parts: fromUs ? [...mine] : [],
        span: span && describing ? { left: span.left, top: span.top, width: span.width, height: span.height } : null,
      };
      for (const fn of pickers) fn(detail);
    };

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
      if (mark.el) {
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
      if (mark.type === 'note') return `a note on ${mark.anchorId}: "${mark.text}"`;
      if (mark.type === 'comment') return `a comment on ${mark.anchorId}`;
      if (mark.type === 'piece') return `the piece "${mark.piece?.title ?? 'a piece'}" on ${mark.anchorId}`;
      if (mark.kind === 'box') return `a box around ${names(mark.ids)}`;
      if (mark.kind === 'arrow') return `an arrow from ${mark.from ?? 'nothing'} to ${mark.to ?? 'nothing'}`;
      return `ink over ${names(mark.ids)}`;
    };
    const idsOf = (mark) => {
      if (mark.type !== 'stroke') return mark.anchorId ? [mark.anchorId] : [];
      return mark.kind === 'arrow' ? [mark.from, mark.to].filter(Boolean) : mark.ids;
    };
    const drafts = () => marks.filter((mark) => !mark.sent);
    const note = () => {
      const drawn = drafts().map(phraseOf);
      return drawn.length ? `I marked up the page: ${drawn.join('; ')}. ` : '';
    };

    const repaint = () => {
      for (const mark of marks) {
        const box = boxOf(mark.anchorId);
        if (mark.el) {
          if (!box) { mark.el.hidden = true; continue; }
          mark.el.hidden = false;
          // At its point, unless that would put it past the window's right
          // edge: a wide note near the edge, or any note on a phone, comes in
          // far enough to be read whole.
          const x = box.left + mark.u * box.width;
          const room = innerWidth - (mark.el.offsetWidth || 0) - 8;
          mark.el.style.left = `${Math.round(mark.type === 'comment' ? x : Math.max(8, Math.min(x, room)))}px`;
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
    const scheduleRepaint = () => { if (!repainting) repainting = requestAnimationFrame(() => { repainting = 0; repaint(); }); };

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

    // ---------------------------------------------------- the frame and card

    /** Everything meant right now, as one rectangle: the elements the
     *  selection names and the marks drawn about them. */
    const union = () => {
      const spans = [];
      for (const id of (fromUs ? mine : [])) {
        const box = boxOf(id);
        if (box?.width || box?.height) spans.push(box);
      }
      // In Build mode the marks stay on the app between builds, so the frame
      // is round what is picked, not round everything ever marked.
      for (const mark of (building ? [...picked] : drafts())) {
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
      if (building) tellPicked(span);
      if (!span) {
        frame.hidden = true;
        card?.show(false);
        return;
      }
      const pad = 6;
      Object.assign(frame.style, {
        left: `${Math.round(span.left - pad)}px`, top: `${Math.round(span.top - pad)}px`,
        width: `${Math.round(span.width + pad * 2)}px`, height: `${Math.round(span.height + pad * 2)}px`,
      });
      frame.hidden = false;
      paintCard(span);
      paintExplore(span);
    };

    /** Hang something on the marks. Four places, tried in order — under them,
     *  over them, beside them, and failing all three just inside their top edge
     *  — because the one thing it must not do is give up and go and sit at the
     *  bottom of the window. Down there is the toolbar, and a card that lands
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
      node.style.right = 'auto';
      node.style.bottom = 'auto';
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

    /** What the card's head line says: what is meant, in the fewest words. */
    const briefLine = () => {
      const count = fromUs ? mine.length : 0;
      const parts = [];
      if (count) parts.push(`${count} element${count === 1 ? '' : 's'}`);
      for (const mark of drafts()) parts.push(phraseOf(mark));
      return parts.join(' · ');
    };

    /** The composer is the ⌘J line, lent (change-line.js): the same
     *  component, words, send and conversation as every other ask on the
     *  page, not a card of its own. One line for the whole mode, however the
     *  marks change; its placeholder reads the marks and it sends their
     *  reading, unseen, ahead of what is typed. */
    const borrowCard = () => {
      if (card) return card;
      const line = window.marbleLine;
      if (!line?.lend) return null;
      card = line.lend({
        ids: () => (fromUs ? [...mine] : []),
        label: briefLine() || 'Describe the change',
        brief: () => (exploring ? '' : note()),
        onSent: (detail) => onSent({ detail }),
        // Put away (Esc) before it sent: the next paint lends a fresh one.
        onClose: () => { card = null; },
        // The toolbar is the floor: a line on it is in the way of the tools.
        floor: () => (describing && !bar.hidden ? bar.getBoundingClientRect().top - 10 : innerHeight - 8),
      });
      return card;
    };
    const paintCard = (span) => {
      // Build mode hangs its own bar on the selection (build-mode.js): Build
      // these, and nothing sent from here.
      if (building) return;
      if (!describing || explore.hidden === false) { card?.show(false); return; }
      const lent = borrowCard();
      if (!lent) return;
      lent.label(briefLine() || 'Describe the change');
      lent.show(true);
      lent.hang(span);
    };
    const paintExplore = (span) => {
      if (explore.hidden) return;
      hang(explore, span);
    };

    /** Sent: the agent has the brief, so the mode steps back and the page is
     *  yours to read again — but what was marked stays up, in the held sheet,
     *  for as long as the agent is working from it. The card stops being
     *  this mode's and becomes the ordinary callout on the work. */
    function onSent(event) {
      const lent = card;
      if (!lent) return;
      const id = event.detail?.id ?? null;
      for (const mark of drafts()) hold(mark, id);
      card = null;
      exploring = false;
      lent.release(fromUs ? mine : []);
      area = [];
      setDescribing(false);
      syncSelection();
      syncBrief();
    }

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
      if (mark.working !== undefined || mark.archived) return false;
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

    // ------------------------------------------------------------- keeping
    //
    // In Build mode a mark outlives the tab: the host keeps every app's marks
    // (server/build), and build-mode.js carries them there and back. Each mark
    // gets an id when it is made; `keep` says it changed, `forget` that it is
    // gone, and `load` draws what the host has, mark by mark, leaving alone
    // the one under the hand.
    const newMarkId = () => `m${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;
    const keepers = new Set();
    const serial = (mark) => {
      const out = {
        id: mark.id, type: mark.type, anchorId: mark.anchorId, u: mark.u ?? 0, v: mark.v ?? 0, at: mark.at,
        state: mark.state ?? 'waiting', build: mark.build ?? null,
      };
      if (mark.first) out.first = true;
      if (mark.archived) out.archived = true;
      if (mark.type === 'note') {
        out.text = mark.text;
        if (mark.images?.length) out.images = mark.images.filter((image) => image.name).map(({ name, w, h }) => ({ name, w, h }));
        if (mark.clips?.length) out.clips = mark.clips.map(({ html, text }) => ({ html, text }));
        if (mark.ids?.length) out.ids = [...mark.ids];
      }
      if (mark.type === 'stroke') {
        Object.assign(out, { kind: mark.kind, ids: mark.ids, from: mark.from, to: mark.to, parts: mark.parts.map((part) => ({ pairs: part.pairs })) });
      }
      if (mark.type === 'comment') { out.thread = mark.thread ?? []; out.resolved = Boolean(mark.resolved); }
      if (mark.type === 'piece') { out.piece = mark.piece; }
      return out;
    };
    const keep = (mark) => {
      if (!building || !mark?.id || mark.local) return;
      // What this page just said about it outranks what the host says back
      // for a moment: its answer to an earlier change may still be on the way.
      mark.touched = Date.now();
      for (const fn of keepers) fn({ type: 'put', mark: serial(mark) });
    };
    const forget = (list) => {
      const ids = list.filter((mark) => mark?.id && !mark.local).map((mark) => mark.id);
      if (!building || !ids.length) return;
      for (const fn of keepers) fn({ type: 'remove', ids });
    };
    /** What a mark's foot says: where it is in the builds. */
    let buildRunning = false;
    const footOf = (mark) => {
      if (mark.state === 'built') return mark.first ? 'Your prompt · built' : 'Built';
      if (mark.held && mark.state === 'waiting') return 'Held back';
      if (mark.state === 'building') return mark.first ? 'Your prompt · building' : 'In this build';
      if (buildRunning) return 'Next build';
      return mark.first ? 'Your prompt' : '';
    };
    const paintState = (mark) => {
      const state = mark.state ?? 'waiting';
      if (mark.type === 'stroke') {
        for (const part of mark.parts) {
          part.el.dataset.state = state === 'waiting' ? 'draft' : state;
          part.el.toggleAttribute('data-archived', Boolean(mark.archived));
        }
        return;
      }
      if (!mark.el) return;
      mark.el.dataset.state = state === 'waiting' ? 'draft' : state;
      mark.el.toggleAttribute('data-archived', Boolean(mark.archived));
      mark.el.toggleAttribute('data-first', Boolean(mark.first));
      const foot = mark.el.querySelector(':scope > .marble-marks-note-foot');
      if (foot) {
        const words = mark.type === 'piece' && state === 'waiting' && !buildRunning ? 'Not built in yet' : footOf(mark);
        foot.textContent = words;
        foot.hidden = !words;
      }
    };

    const commitStroke = (points) => {
      const geometry = G();
      if (points.length < 3 || geometry.lengthOf(points) < SCRATCH) return false;
      const kind = geometry.readStroke(points);
      // A short stroke at the end of the arrow just drawn is the head someone
      // put on it, not a second mark — and which end it is on is which way the
      // arrow points.
      const last = marks[marks.length - 1];
      if (last && last.type === 'stroke' && !last.sent && (last.state ?? 'waiting') === 'waiting') {
        // Measured where the shaft is *now*: the page may have scrolled
        // between the two strokes.
        const shaftBox = boxOf(last.anchorId);
        const shaft = shaftBox ? pointsOf(last.parts[0], shaftBox) : last.points;
        const end = shaft ? geometry.arrowHeadFor({ kind: last.kind, points: shaft }, points, { elapsed: Date.now() - last.at }) : null;
        if (end) {
          if (end === 'start') { const from = last.from; last.from = last.to; last.to = from; }
          const box = boxOf(last.anchorId) ?? geometry.boundsOf(points);
          last.parts.push({ pairs: geometry.toFractions(box, points), el: newPath() });
          keep(last);
          return true;
        }
      }
      const bounds = geometry.boundsOf(points);
      const centre = geometry.centroidOf(points);
      const anchor = elementAt(centre.x, centre.y);
      if (!anchor) return false;
      const mark = {
        id: newMarkId(),
        type: 'stroke',
        kind,
        anchorId: anchor.getAttribute('data-marble-id'),
        at: Date.now(),
        sent: false,
        state: 'waiting',
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
      keep(mark);
      return true;
    };

    // ------------------------------------------------------------------ Text

    const closeButton = (label) => {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'marble-marks-note-close';
      close.setAttribute(TRANSIENT, '');
      close.setAttribute('aria-label', label);
      close.textContent = '×';
      return close;
    };

    /** A note's card, for a note made here or one the host kept. */
    const hasWords = (mark) => Boolean(mark.text || mark.images?.length || mark.clips?.length);
    const drawNote = (mark, { focus = false } = {}) => {
      const node = el('div', 'marble-marks-note', notes);
      node.dataset.state = 'draft';
      const grip = el('div', 'marble-marks-note-grip', node);
      el('span', 'marble-marks-note-dots', grip);
      const close = closeButton('Delete this note');
      grip.append(close);
      const body = el('div', 'marble-marks-note-body', node);
      body.contentEditable = 'true';
      body.setAttribute('role', 'textbox');
      body.setAttribute('aria-multiline', 'true');
      body.dataset.placeholder = building ? 'Say what you want here, or paste a picture…' : 'Say what you want here…';
      body.textContent = mark.text ?? '';
      const att = el('div', 'marble-marks-note-att', node);
      // Build mode: keep it (leave it, the default) or send it now (⌘↵), and,
      // written on a selection, keep that part as a piece.
      let sendButton = null;
      if (building) {
        const act = el('div', 'marble-marks-note-act', node);
        if (mark.ids?.length) {
          const piece = document.createElement('button');
          piece.type = 'button';
          piece.className = 'piece';
          piece.setAttribute(TRANSIENT, '');
          piece.textContent = 'Save as piece';
          piece.title = 'Keep this part to put on other apps';
          piece.addEventListener('pointerdown', (event) => event.preventDefault());
          piece.addEventListener('click', () => dispatchEvent(new CustomEvent('marble-marks:save-piece', { detail: { ids: [...mark.ids] } })));
          act.append(piece);
        }
        el('span', 'sp', act);
        sendButton = document.createElement('button');
        sendButton.type = 'button';
        sendButton.className = 'send';
        sendButton.setAttribute(TRANSIENT, '');
        sendButton.innerHTML = `Send <kbd ${TRANSIENT}>${MOD}↵</kbd>`;
        sendButton.title = 'Ask it, or have it changed now';
        sendButton.setAttribute('aria-label', 'Send: ask it, or have it changed now');
        // A press here is not a blur that keeps the note.
        sendButton.addEventListener('pointerdown', (event) => event.preventDefault());
        sendButton.addEventListener('click', () => sendNote(mark));
        act.append(sendButton);
      }
      mark.paintSend = () => sendButton?.setAttribute('aria-disabled', String(!hasWords(mark)));
      const foot = el('div', 'marble-marks-note-foot', node);
      foot.hidden = true;
      mark.el = node;
      mark.body = body;
      mark.att = att;
      drawAttachments(mark);
      close.addEventListener('click', () => removeMark(mark));
      // A note names the element it was put on, the same way a stroke names
      // what it covers: what you wrote on is part of what you are pointing at.
      let typed = 0;
      body.addEventListener('input', () => {
        mark.text = body.innerText.trim();
        scheduleRepaint();
        // Kept as it is typed, a beat after the last key, and for certain
        // when the caret leaves it.
        clearTimeout(typed);
        if (hasWords(mark)) typed = setTimeout(() => { delete mark.local; keep(mark); }, 600);
        syncSelection();
        syncBrief();
      });
      body.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.stopPropagation(); body.blur(); }
        // Enter is a new line; ⌘↵ sends it.
        if (building && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); sendNote(mark); }
      });
      body.addEventListener('paste', (event) => pasteInto(mark, event));
      body.addEventListener('input', () => mark.paintSend?.());
      node.addEventListener('pointerenter', () => { hovered = mark; });
      node.addEventListener('pointerleave', () => { if (hovered === mark) hovered = null; });
      body.addEventListener('focus', () => {
        node.setAttribute('data-writing', '');
        // Writing in a note that was already there is the Note tool's one
        // press too: the next press is the app's.
        if (building && mode === 'text') setMode(null);
      });
      // An empty note is a slip of the hand, not a mark.
      body.addEventListener('blur', () => {
        clearTimeout(typed);
        // Written on a selection: what was picked is let go with it.
        if (mark.fromSelection) {
          delete mark.fromSelection;
          if (area.length) { area = []; syncSelection(); paintHalos(); syncBrief(); }
        }
        mark.text = body.innerText.trim();
        // Left: with the margin open it folds into its pin from here.
        node.removeAttribute('data-writing');
        if (!hasWords(mark)) { if (!mark.uploading) removeMark(mark, { undo: false }); return; }
        delete mark.local;
        keep(mark);
      });
      // The × is not the grip: a press on it is a press, not a drag.
      grip.addEventListener('pointerdown', (event) => { if (!event.target.closest('.marble-marks-note-close')) startMove(event, [mark], node); });
      paintState(mark);
      mark.paintSend();
      if (focus) { node.setAttribute('data-writing', ''); body.focus(); }
      return mark;
    };

    // ---------------------------------------------------------- sending
    //
    // ⌘↵ in a note, or over one, or its Send: the note is sent to be
    // answered or made now (build-mode.js asks the host; server/build: the
    // note becomes a comment, which the app answers, or which a build makes
    // at once). It folds into the pin of that comment as it goes.
    const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
    const senders = new Set();
    let hovered = null;
    const sendNote = (mark) => {
      if (!building || !marks.includes(mark) || mark.type !== 'note' || mark.state !== 'waiting') return;
      mark.text = mark.body?.innerText.trim() ?? mark.text;
      if (!hasWords(mark) || mark.uploading) return;
      delete mark.local;
      keep(mark);
      mark.el?.setAttribute('data-sending', '');
      mark.el?.removeAttribute('data-writing');
      mark.body?.blur();
      for (const fn of senders) fn(serial(mark));
    };
    addEventListener('keydown', (event) => {
      if (!building || !describing || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      if (typing(event.composedPath()[0])) return;
      if (!hovered) return;
      event.preventDefault();
      event.stopPropagation();
      sendNote(hovered);
    }, true);

    // ----------------------------------------------------------- pasting
    //
    // A note takes what a hand pastes the way a person would mean it: a
    // picture is a picture on the note, a part copied off a page is that part
    // drawn small, and words are words, without the styles they came with.

    const imageSrc = (name) => `/agent/builds/image?name=${encodeURIComponent(name)}`;
    const drawAttachments = (mark) => {
      const box = mark.att;
      if (!box) return;
      box.replaceChildren();
      // By what it is, not by the object it was drawn from: the host's copy
      // of the list may have replaced that object since.
      const off = (list, item) => {
        const same = list === 'images'
          ? (one) => one === item || (item.name && one.name === item.name)
          : (one) => one === item || one.html === item.html;
        const at = mark[list]?.findIndex(same) ?? -1;
        if (at < 0) return;
        mark[list].splice(at, 1);
        drawAttachments(mark);
        if (hasWords(mark)) keep(mark);
        else removeMark(mark);
        scheduleRepaint();
      };
      for (const image of mark.images ?? []) {
        const fig = el('figure', 'marble-marks-att', box);
        fig.dataset.kind = 'image';
        fig.toggleAttribute('data-loading', !image.name);
        const img = document.createElement('img');
        img.setAttribute(TRANSIENT, '');
        img.alt = 'A pasted picture';
        img.src = image.preview ?? imageSrc(image.name);
        if (image.w && image.h) { img.width = image.w; img.height = image.h; img.style.height = 'auto'; }
        img.addEventListener('load', scheduleRepaint, { once: true });
        fig.append(img);
        const x = closeButton('Take this picture off');
        x.addEventListener('click', () => off('images', image));
        fig.append(x);
      }
      for (const clip of mark.clips ?? []) {
        const fig = el('figure', 'marble-marks-att', box);
        fig.dataset.kind = 'clip';
        const frameEl = document.createElement('iframe');
        frameEl.setAttribute('sandbox', '');
        frameEl.setAttribute('tabindex', '-1');
        frameEl.setAttribute('aria-hidden', 'true');
        frameEl.setAttribute(TRANSIENT, '');
        frameEl.srcdoc = `<!doctype html><meta charset="utf-8"><style>html{font:13px/1.4 system-ui,sans-serif;color:#222}body{margin:8px;zoom:.7}img{max-width:100%}</style>${clip.html}`;
        fig.append(frameEl);
        const cap = el('figcaption', '', fig);
        cap.textContent = clip.text ? `Pasted part · ${clip.text}` : 'Pasted part';
        const x = closeButton('Take this part off');
        x.addEventListener('click', () => off('clips', clip));
        fig.append(x);
      }
    };

    /** A picture made small enough to keep: no side past 1600px. */
    const shrink = async (blob) => {
      try {
        const bitmap = await createImageBitmap(blob);
        const { width, height } = bitmap;
        const scale = Math.min(1, 1600 / Math.max(width, height));
        if (scale === 1 && blob.size < 2_500_000) { bitmap.close?.(); return { blob, w: width, h: height }; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        const type = blob.type === 'image/png' && canvas.width * canvas.height < 1_200_000 ? 'image/png' : 'image/jpeg';
        const out = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.86));
        return { blob: out ?? blob, w: canvas.width, h: canvas.height };
      } catch {
        return { blob, w: 0, h: 0 };
      }
    };
    const addImage = async (mark, blob) => {
      const image = { name: null, preview: URL.createObjectURL(blob), w: 0, h: 0 };
      (mark.images ??= []).push(image);
      mark.uploading = (mark.uploading ?? 0) + 1;
      drawAttachments(mark);
      scheduleRepaint();
      try {
        const small = await shrink(blob);
        const response = await fetch(`/agent/builds/image?path=${encodeURIComponent(app)}`, {
          method: 'POST', headers: { 'Content-Type': small.blob.type || 'image/png' }, body: small.blob,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.name) throw new Error(data.error || 'not kept');
        Object.assign(image, { name: data.name, w: small.w, h: small.h });
      } catch (err) {
        console.warn('marble-marks: a pasted picture was not kept', err);
        mark.images = mark.images.filter((one) => one !== image);
      }
      mark.uploading -= 1;
      drawAttachments(mark);
      mark.paintSend?.();
      if (marks.includes(mark) && hasWords(mark)) { delete mark.local; keep(mark); }
      else if (marks.includes(mark) && !mark.uploading && document.activeElement !== mark.body) removeMark(mark);
      scheduleRepaint();
    };
    // What a pasted page fragment is: words, unless it carries the parts of
    // an interface — a picture, a control, a table, an addressed element.
    const PARTS = 'img, svg, button, input, select, textarea, table, form, canvas, video, iframe, [data-marble-id]';
    const pasteInto = (mark, event) => {
      const data = event.clipboardData;
      if (!data) return;
      event.preventDefault();
      const files = [...(data.files ?? [])].filter((file) => file.type.startsWith('image/'));
      const html = data.getData('text/html');
      const text = data.getData('text/plain');
      if (building && files.length) {
        for (const file of files.slice(0, 6)) addImage(mark, file);
        if (text && !html) document.execCommand('insertText', false, text);
        return;
      }
      if (building && html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        for (const node of doc.querySelectorAll('script, style, meta, link, base')) node.remove();
        const pics = [...doc.querySelectorAll('img[src]')].map((img) => img.getAttribute('src')).filter((src) => /^(data:image\/|https?:|\/)/.test(src));
        // Its words, each piece of text apart from the next, as they read.
        const pieces = [];
        const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        for (let t = walk.nextNode(); t; t = walk.nextNode()) if (t.nodeValue.trim()) pieces.push(t.nodeValue.trim());
        const words = pieces.join(' ').replace(/\s+/g, ' ').trim();
        const onlyPictures = pics.length && words.length < 2;
        if (onlyPictures) {
          for (const src of pics.slice(0, 6)) fetch(src).then((r) => r.blob()).then((blob) => { if (blob.type.startsWith('image/')) addImage(mark, blob); }).catch(() => {});
          return;
        }
        if (doc.body.querySelector(PARTS)) {
          for (const node of doc.querySelectorAll('*')) {
            for (const attr of [...node.attributes]) if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
          }
          (mark.clips ??= []).push({ html: doc.body.innerHTML.trim().slice(0, 20_000), text: words.slice(0, 160) });
          drawAttachments(mark);
          delete mark.local;
          keep(mark);
          syncBrief();
          scheduleRepaint();
          return;
        }
      }
      if (text) document.execCommand('insertText', false, text);
    };

    const placeNote = (x, y, { text = '', anchor: given = null, ids = null } = {}) => {
      const anchor = given ?? elementAt(x, y);
      if (!anchor) return null;
      const box = anchor.getBoundingClientRect();
      const mark = {
        id: newMarkId(),
        type: 'note',
        kind: 'text',
        anchorId: anchor.getAttribute('data-marble-id'),
        at: Date.now(),
        sent: false,
        state: 'waiting',
        // Not kept until there are words in it.
        local: !text,
        ...(ids?.length ? { ids: [...ids] } : {}),
        u: box.width ? (x - box.left) / box.width : 0,
        v: box.height ? (y - box.top) / box.height : 0,
        text,
      };
      marks.push(mark);
      drawNote(mark, { focus: !text });
      if (text) keep(mark);
      repaint();
      return mark;
    };

    // --------------------------------------------------------------- Comment

    /** A comment's pin carries the number its card has in the margin: every
     *  mark on the app counts, in the order they were made. */
    const numberPins = () => {
      let n = 0;
      for (const mark of marks) {
        if (!mark.id || mark.archived) continue;
        n += 1;
        if (mark.type === 'comment') mark.el.textContent = String(n);
      }
    };
    const drawComment = (mark) => {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'marble-marks-pin';
      pin.setAttribute(TRANSIENT, '');
      pin.toggleAttribute('data-local', Boolean(mark.local));
      pin.setAttribute('aria-expanded', 'false');
      notes.append(pin);
      mark.el = pin;
      const label = () => {
        const said = (mark.thread ?? []).filter((line) => line.text);
        pin.setAttribute('aria-label', said.length ? `Comment: ${said[0].text}` : 'New comment');
      };
      mark.relabel = label;
      label();
      // A press opens the thread; a drag moves the pin.
      pin.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const x0 = event.clientX;
        const y0 = event.clientY;
        const up = (end) => {
          removeEventListener('pointerup', up, true);
          if (Math.hypot(end.clientX - x0, end.clientY - y0) < 4) openComment(mark);
        };
        addEventListener('pointerup', up, true);
        startMove(event, [mark], pin);
      });
      pin.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openComment(mark); }
      });
      paintState(mark);
      numberPins();
      return mark;
    };
    const openComment = (mark, { fresh = false } = {}) => {
      for (const other of marks) if (other.type === 'comment') other.el.setAttribute('aria-expanded', String(other === mark));
      dispatchEvent(new CustomEvent('marble-marks:comment', { detail: { id: mark.id, fresh } }));
    };
    const placeComment = (x, y) => {
      const anchor = elementAt(x, y);
      if (!anchor) return null;
      const box = anchor.getBoundingClientRect();
      const mark = {
        id: newMarkId(),
        type: 'comment',
        anchorId: anchor.getAttribute('data-marble-id'),
        at: Date.now(),
        state: 'waiting',
        // Kept once something is said in it (build-mode.js posts it).
        local: true,
        u: box.width ? (x - box.left) / box.width : 0,
        v: box.height ? (y - box.top) / box.height : 0,
        thread: [],
      };
      marks.push(mark);
      drawComment(mark);
      repaint();
      openComment(mark, { fresh: true });
      try { localStorage.setItem('marble-build:commented', '1'); } catch { /* private mode */ }
      delete tools.comment?.dataset.new;
      return mark;
    };

    // ----------------------------------------------------------------- Piece

    /** A piece's card on the app: its name and where it is from, its own
     *  markup drawn small in a frame where nothing runs, and its state. */
    const drawPiece = (mark) => {
      const node = el('div', 'marble-marks-piece', notes);
      const head = el('div', 'marble-marks-piece-head', node);
      const name = el('span', '', head);
      name.textContent = mark.piece?.title ?? 'A piece';
      const from = mark.piece?.source?.path ? mark.piece.source.path.split('/').pop() : '';
      if (from) {
        const small = el('small', '', name);
        small.textContent = ` · ${from}`;
      }
      const close = closeButton('Take this piece off');
      head.append(close);
      const frameEl = document.createElement('iframe');
      frameEl.setAttribute('sandbox', '');
      frameEl.setAttribute('loading', 'lazy');
      frameEl.setAttribute('tabindex', '-1');
      frameEl.setAttribute('aria-hidden', 'true');
      frameEl.setAttribute(TRANSIENT, '');
      const p = mark.piece ?? {};
      const query = p.id && !String(p.id).includes('#')
        ? `id=${encodeURIComponent(p.id)}`
        : `path=${encodeURIComponent(p.source?.path ?? '')}&at=${encodeURIComponent(p.source?.id ?? '')}`;
      frameEl.src = `/agent/pieces/preview?${query}`;
      node.append(frameEl);
      const foot = el('div', 'marble-marks-note-foot', node);
      foot.hidden = true;
      mark.el = node;
      close.addEventListener('click', () => removeMark(mark));
      head.addEventListener('pointerdown', (event) => { if (event.target !== close) startMove(event, [mark], node); });
      paintState(mark);
      return mark;
    };
    /** A piece put on the app at a point (a drop), or near the top of what is
     *  in view (Incorporate). */
    const placePiece = (piece, at = null) => {
      let x = at?.x;
      let y = at?.y;
      if (x == null || y == null) {
        // In view, toward the right of the page, clear of the top bar; a few
        // pieces in a row step down so none lands on the last.
        const placedNow = marks.filter((m) => m.type === 'piece' && m.state === 'waiting').length;
        x = Math.max(24, innerWidth - 268 - 48 - (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--marble-dock-right')) || 0));
        y = Math.min(innerHeight - 260, 96 + placedNow * 36);
      }
      const anchor = elementAt(x, y);
      if (!anchor) return null;
      const box = anchor.getBoundingClientRect();
      const mark = {
        id: newMarkId(),
        type: 'piece',
        anchorId: anchor.getAttribute('data-marble-id'),
        at: Date.now(),
        state: 'waiting',
        u: box.width ? (x - box.left) / box.width : 0,
        v: box.height ? (y - box.top) / box.height : 0,
        piece: {
          id: String(piece.id ?? ''),
          title: String(piece.title ?? 'A piece'),
          kind: String(piece.kind ?? ''),
          line: String(piece.line ?? ''),
          source: piece.source ?? null,
        },
      };
      marks.push(mark);
      drawPiece(mark);
      keep(mark);
      repaint();
      syncBrief();
      return mark;
    };

    /** Each element a mark is drawn with, however it was drawn. */
    const elsOf = (mark) => (mark.el ? [mark.el] : mark.type === 'stroke' ? mark.parts.map((part) => part.el) : []);
    /** Sent, and being worked from: into the held sheet, where leaving the
     *  mode does not reach. */
    const hold = (mark, id) => {
      mark.sent = true;
      mark.working = id;
      picked.delete(mark);
      for (const node of elsOf(mark)) {
        node.dataset.state = 'working';
        (mark.type === 'note' ? heldNotes : heldInk).append(node);
      }
    };
    /** The work it was for is put away: a kept mark again, back in the mode's
     *  own layer, dimmed as sent. */
    const unhold = (mark) => {
      delete mark.working;
      for (const node of elsOf(mark)) {
        node.dataset.state = 'sent';
        (mark.type === 'note' ? notes : ink).append(node);
      }
    };

    const dropMark = (mark) => {
      const at = marks.indexOf(mark);
      if (at < 0) return false;
      marks.splice(at, 1);
      picked.delete(mark);
      for (const node of elsOf(mark)) node.remove();
      if (mark.type === 'comment') numberPins();
      return true;
    };
    const removeMark = (mark, { undo = true } = {}) => {
      // A mark a build is working from is its brief now.
      if (mark.state === 'building') return;
      const kept = building && undo && mark.id && !mark.local && (mark.type !== 'note' || hasWords(mark)) ? serial(mark) : null;
      if (!dropMark(mark)) return;
      forget([mark]);
      if (kept) offerUndo([kept]);
      syncSelection();
      syncBrief();
    };

    // ------------------------------------------------------------- undo
    //
    // What was taken off can be put back: a line over the toolbar says what
    // went, with Undo, and ⌘Z does the same while it is there and after. The
    // host forgot the mark; putting it back keeps it again, as it was.
    const undone = [];
    const undoLine = el('div', 'marble-marks-undo', layer);
    undoLine.setAttribute('role', 'status');
    undoLine.hidden = true;
    const undoWords = el('span', '', undoLine);
    const undoButton = document.createElement('button');
    undoButton.type = 'button';
    undoButton.setAttribute(TRANSIENT, '');
    undoButton.innerHTML = `Undo<kbd ${TRANSIENT}>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘Z' : 'Ctrl+Z'}</kbd>`;
    undoLine.append(undoButton);
    let undoTimer = 0;
    const KIND_WORDS = { note: 'Note', comment: 'Comment', piece: 'Piece', stroke: 'Sketch' };
    const sayUndo = (entry) => {
      undone.push(entry);
      if (undone.length > 20) undone.shift();
      undoWords.textContent = entry.words;
      undoLine.hidden = false;
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => { undoLine.hidden = true; }, 8000);
    };
    const offerUndo = (list) => {
      if (batching) { batching.push(list); return; }
      sayUndo({
        words: list.length === 1 ? `${KIND_WORDS[list[0].type] ?? 'Mark'} deleted` : `${list.length} marks deleted`,
        run: () => restore(list),
      });
    };
    // A Delete over several picked marks is one step to undo, not several.
    let batching = null;
    const batch = (fn) => {
      batching = [];
      const offer = offerUndo;
      try { fn(); } finally {
        const list = batching;
        batching = null;
        if (list.length) offer(list.flat());
      }
    };
    const undoLast = () => {
      const entry = undone.pop();
      undoLine.hidden = true;
      clearTimeout(undoTimer);
      if (!entry) return false;
      entry.run();
      return true;
    };
    const restore = (list) => {
      for (const given of list) {
        if (marks.some((m) => m.id === given.id)) continue;
        const mark = upsert(given);
        if (mark) keep(mark);
      }
      marks.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
      numberPins();
      repaint();
      syncSelection();
      syncBrief();
    };
    undoButton.addEventListener('click', undoLast);
    const clearMarks = () => {
      // What an agent is working from is its brief now, not this mode's to
      // rub out; it goes when that callout is put away. A mark in a running
      // build is the same.
      const kept = marks.filter((mark) => mark.working !== undefined || mark.state === 'building');
      const gone = [];
      for (const mark of marks.splice(0)) {
        if (kept.includes(mark)) continue;
        gone.push(mark);
        for (const node of elsOf(mark)) node.remove();
      }
      marks.push(...kept);
      forget(gone);
      picked.clear();
      caption.hidden = true;
      area = [];
      numberPins();
      syncSelection();
      syncBrief();
      repaint();
    };

    /** The host's marks, drawn: new ones made, changed ones moved or
     *  re-worded, gone ones taken off. A note with the caret in it, a mark
     *  under the hand, and one not kept yet are left as they are. */
    const load = (list) => {
      const wanted = new Map((Array.isArray(list) ? list : []).filter((m) => m?.id).map((m) => [m.id, m]));
      for (const mark of [...marks]) {
        if (!mark.id || mark.local || wanted.has(mark.id)) continue;
        if (mark.working !== undefined) continue;
        dropMark(mark);
      }
      const held = moving ? new Set(moving.marks.map((item) => item.mark)) : new Set();
      for (const [id, given] of wanted) {
        let mark = marks.find((m) => m.id === id);
        if (mark && (held.has(mark) || (mark.body && document.activeElement === mark.body) || Date.now() - (mark.touched ?? 0) < 2500)) {
          mark.state = given.state;
          mark.build = given.build;
          mark.held = Boolean(given.held);
          mark.archived = Boolean(given.archived);
          paintState(mark);
          continue;
        }
        upsert(given, mark);
      }
      // The order the host keeps is the order they were made in.
      marks.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
      numberPins();
      repaint();
      syncSelection();
      syncBrief();
    };
    /** One mark as the host keeps it, drawn: made if it is new, or brought up
     *  to date. */
    function upsert(given, found = null) {
      const id = given.id;
      let mark = found ?? marks.find((m) => m.id === id);
      if (!mark) {
        mark = { id, type: given.type, sent: false };
        marks.push(mark);
      }
      Object.assign(mark, {
        anchorId: given.anchorId, u: given.u ?? 0, v: given.v ?? 0, at: given.at ?? Date.now(),
        state: given.state ?? 'waiting', build: given.build ?? null, first: Boolean(given.first),
        // Set by their own presses on the host, never by this page.
        held: Boolean(given.held),
        archived: Boolean(given.archived),
      });
      if (given.type === 'note') {
        mark.kind = 'text';
        mark.text = given.text ?? '';
        mark.ids = given.ids ?? [];
        const same = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
        const pictures = (given.images ?? []).map(({ name, w, h }) => ({ name, w, h }));
        const changed = !same((mark.images ?? []).filter((i) => i.name).map(({ name, w, h }) => ({ name, w, h })), pictures) || !same(mark.clips, given.clips);
        // Pictures still on their way up are this page's until they land.
        if (!mark.uploading) { mark.images = pictures; mark.clips = (given.clips ?? []).map(({ html, text }) => ({ html, text })); }
        if (!mark.el) drawNote(mark);
        else {
          if (mark.body && mark.body.innerText.trim() !== mark.text) mark.body.textContent = mark.text;
          if (changed && !mark.uploading) drawAttachments(mark);
        }
      } else if (given.type === 'stroke') {
        Object.assign(mark, { kind: given.kind, ids: given.ids ?? [], from: given.from ?? null, to: given.to ?? null });
        const parts = (given.parts ?? []).map((part) => ({ pairs: part.pairs }));
        for (const old of mark.parts ?? []) old.el.remove();
        mark.parts = parts.map((part) => ({ ...part, el: newPath() }));
      } else if (given.type === 'comment') {
        mark.thread = given.thread ?? [];
        mark.resolved = Boolean(given.resolved);
        if (!mark.el) drawComment(mark);
        mark.relabel?.();
      } else if (given.type === 'piece') {
        mark.piece = given.piece;
        if (!mark.el) drawPiece(mark);
      }
      paintState(mark);
      return mark;
    }
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
      moving.travel = (moving.travel ?? 0) + Math.hypot(event.clientX - moving.x, event.clientY - moving.y);
      moveBy(event.clientX - moving.x, event.clientY - moving.y);
      moving.x = event.clientX;
      moving.y = event.clientY;
      repaint();
    });
    const dropMove = (event) => {
      if (!moving || event.pointerId !== moving.id) return;
      delete moving.node.dataset.dragging;
      const moved = moving.marks.map((item) => item.mark);
      const travelled = moving.travel ?? 0;
      moving = null;
      repaint();
      // Where it was put down is where it is kept.
      if (travelled > 2) for (const mark of moved) keep(mark);
    };
    addEventListener('pointerup', dropMove);
    addEventListener('pointercancel', dropMove);

    // ------------------------------------------------------------ the switch

    /** The selection is what the marquee picked *and* what the marks name,
     *  kept in two lists so that drawing does not wipe a rectangle and rubbing
     *  a stroke out does not wipe the rectangle either. */
    const syncSelection = () => {
      // In Build mode the marks are the brief, kept on the host and taken by
      // Build: what the agent is pointed at is the parts picked with Select,
      // and nothing is handed to the callout from here.
      if (building) {
        mine = area.filter((id) => document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`));
        fromUs = mine.length > 0;
        return;
      }
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
      const count = building ? marks.filter((mark) => mark.state !== 'building' && !mark.archived).length : drafts().length;
      // Out of the mode with marks still in hand: the way back says so, since
      // nothing else on the page does any more.
      update({
        id: 'marks-describe',
        label: describing ? 'Leave Describe' : (count ? `Describe · ${count} kept` : 'Describe a change'),
      });
      // Always there, so the bar never closes up round a gap: with nothing it
      // could take off, it is shown and dimmed.
      clearButton.disabled = count === 0 && !(fromUs && mine.length);
      clearButton.setAttribute('aria-disabled', String(clearButton.disabled));
      exploreButton.disabled = !(fromUs && mine.length);
      for (const fn of watchers) fn();
      update({ id: 'ask', label: count && fromUs ? 'Ask about the sketch' : 'Ask here' });
      paintFrame();
    };

    const trayEl = () => document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.tray') ?? null;
    /** The overlay is in the top layer and the tray is not, so the tray would
     *  be under it — and the tray is how Describe mode is turned off. Clip the
     *  corner it stands in out of the overlay, and the clicks there reach it. */
    const punch = () => {
      // A pinned panel is the app beside the page, not the page: the overlay
      // stops at its edge, so the chat in it can be read, typed in and
      // scrolled with a tool still on.
      const side = document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.panel');
      const beside = side?.dataset.open === 'true' && (side?.dataset.pinned === 'true' || (side?.dataset.view ?? 'chat') !== 'chat');
      const pinned = beside ? side.getBoundingClientRect() : null;
      overlay.style.right = pinned?.width ? `${Math.max(0, Math.round(innerWidth - pinned.left))}px` : '';
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
      mode = next;
      layer.dataset.mode = next ?? '';
      overlay.hidden = !next;
      caption.hidden = true;
      if (next) punch();
      for (const [name, node] of Object.entries(tools)) node.setAttribute('aria-pressed', String(name === next));
      useButton.setAttribute('aria-pressed', String(!next));
      // The callout's handle would be drawn under the overlay and unclickable;
      // it comes back when the mode ends.
      dispatchEvent(new CustomEvent('marble-marks:mode', { detail: { mode: next, describing } }));
    }
    // Turning Describe off is remembered for this app, in this browser: the
    // next visit opens the way it was left. Every app starts in it otherwise.
    const PREF = `marble-build:describe:${app}`;
    const remembered = () => { try { return localStorage.getItem(PREF); } catch { return null; } };
    function setDescribing(on, { remember = true } = {}) {
      if (describing === on) return;
      describing = on;
      if (building && remember) { try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* private mode */ } }
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
      // does in a mode like it is point at something. In Build mode the app
      // is still the app under the cursor, so it opens on that.
      setMode(on && !building ? 'select' : null);
      if (!on && building) { picked.clear(); area = []; syncSelection(); paintHalos(); }
      syncBrief();
      dispatchEvent(new CustomEvent('marble-marks:describing', { detail: { on } }));
    }

    for (const [name, node] of Object.entries(tools)) {
      node.addEventListener('click', () => setMode(mode === name ? null : name));
    }
    useButton.addEventListener('click', () => setMode(null));
    clearButton.addEventListener('click', () => { clearMarks(); syncBrief(); });
    // Another door in: the shell's bar (runtime/shell.js), or anything else
    // that wants to offer Describe without a tray of its own.
    // The callout's Describe door arrives with what the card was about, so
    // the mode opens with it already marked.
    addEventListener('marble-marks:toggle', (event) => {
      const on = event.detail?.on ?? !describing;
      setDescribing(on);
      const ids = event.detail?.ids;
      if (!on || !Array.isArray(ids) || !ids.length) return;
      area = ids.filter((id) => typeof id === 'string' && document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`));
      syncSelection();
      syncBrief();
    });
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
      // In Build mode a note is one press, as a comment is: the note takes
      // the caret and the cursor goes back to using the app, so the next
      // press is the app's and not a second note.
      if (mode === 'text') { placeNote(event.clientX, event.clientY); if (building) setMode(null); return; }
      if (mode === 'comment') { placeComment(event.clientX, event.clientY); setMode(null); return; }
    });

    /** The stroke under a point, if any: within a finger's width of its line. */
    const strokeAt = (x, y) => {
      for (const mark of [...marks].reverse()) {
        if (mark.type !== 'stroke' || mark.archived) continue;
        const box = boxOf(mark.anchorId);
        if (!box) continue;
        for (const part of mark.parts) {
          if (pointsOf(part, box).some((p) => Math.hypot(p.x - x, p.y - y) <= 12)) return mark;
        }
      }
      return null;
    };
    // With Select on, a press on a note, pin or piece picks it (Shift adds),
    // and a drag from there moves everything picked.
    notes.addEventListener('pointerdown', (event) => {
      if (!building || mode !== 'select' || event.button !== 0) return;
      const mark = marks.find((m) => m.el && m.el.contains(event.target));
      if (!mark) return;
      if (event.target.closest('.marble-marks-note-close, .marble-marks-note-act, [data-writing]')) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        if (picked.has(mark)) picked.delete(mark);
        else picked.add(mark);
      } else if (!picked.has(mark)) {
        picked.clear();
        picked.add(mark);
      }
      area = [];
      syncSelection();
      paintHalos();
      syncBrief();
      if (picked.has(mark)) startMove(event, [...picked], mark.el);
    }, true);
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
      if (mode === 'sketch' && !moving) hover(event);
    });
    const finish = (event) => {
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
      const tiny = Math.abs(drag.x1 - drag.x0) < 4 && Math.abs(drag.y1 - drag.y0) < 4;
      const caught = drag.marks;
      endDrag();
      if (building && tiny) {
        // A click, not a rectangle: the mark under it, or the part of the app.
        const hit = strokeAt(event.clientX, event.clientY);
        if (!event.shiftKey) picked.clear();
        if (hit) {
          if (event.shiftKey && picked.has(hit)) picked.delete(hit);
          else picked.add(hit);
          area = event.shiftKey ? area : [];
        } else {
          const part = elementAt(event.clientX, event.clientY)?.getAttribute('data-marble-id');
          area = part ? [...prior.filter((id) => id !== part), ...(prior.includes(part) ? [] : [part])] : prior;
        }
        paintHalos();
      } else if (building && caught.length) {
        // Marks were caught: those are what was meant, not the app under them.
        area = event.shiftKey ? area : [];
      } else {
        area = [...prior, ...ids.filter((id) => !prior.includes(id))];
      }
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
        if (mark.type !== 'stroke' || mark.archived) continue;
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
      // The ask goes out through the same borrowed line as a sentence would,
      // so it lands in the same kind of conversation and ends the same way.
      const lent = borrowCard();
      if (lent) {
        exploring = true;
        lent.send(lines.join('\n')).finally(() => { exploring = false; });
      } else {
        agent.open();
      }
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
    // One key per tool while describing, and ⌘⇧D in and out from anywhere —
    // a chord, so it is heard even mid-sentence in a composer.
    const KEYS = building ? { v: null, a: 'select', p: 'sketch', t: 'text', n: 'text' } : { v: null, a: 'select', p: 'sketch', t: 'text' };
    addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        event.stopPropagation();
        setDescribing(!describing);
        return;
      }
      if (!describing || event.metaKey || event.ctrlKey || event.altKey || event.repeat || typing(event.composedPath()[0])) return;
      const key = event.key.toLowerCase();
      if (key === 'e') {
        if (building || exploreButton.disabled || exploreButton.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        exploreButton.click();
        return;
      }
      if (!(key in KEYS)) return;
      // The tools' keys are the mode's while it is on; the app hears every
      // other key as it always does.
      event.preventDefault();
      event.stopPropagation();
      setMode(KEYS[key]);
    }, true);
    addEventListener('keydown', (event) => {
      // Keys typed into a composer are the composer's, and the card's lives in
      // a shadow root, where document.activeElement is only its host: ⌫ in
      // the brief must not take a mark off the page, nor ⌘Z a stroke.
      if (typing(event.composedPath()[0])) {
        if (event.key !== 'Escape' || !mode) return;
      }
      if (mode === 'sketch' && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        if (!marks.length) return;
        event.preventDefault();
        event.stopPropagation();
        undoStroke();
        return;
      }
      // While the line that says what was deleted is up, ⌘Z puts it back;
      // after that the key is the app's own again.
      if (building && !undoLine.hidden && (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.stopPropagation();
        undoLast();
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && picked.size) {
        event.preventDefault();
        batch(() => { for (const mark of [...picked]) removeMark(mark); });
        picked.clear();
        repaint();
        return;
      }
      if (event.key !== 'Escape') return;
      // Escape inside Build mode's margin is the margin's: it lets go of the
      // card picked there before anything here is left (build-margin.js).
      if (event.composedPath().some((node) => node?.classList?.contains?.('marble-margin'))) return;
      if (!explore.hidden) { event.preventDefault(); event.stopPropagation(); explore.hidden = true; paintFrame(); return; }
      // Escape leaves the tool; Escape with no tool leaves Describe mode. The
      // ink stays either way, because it is the brief and not the mode.
      if (mode) { event.preventDefault(); event.stopPropagation(); setMode(null); return; }
      if (building && (picked.size || area.length)) {
        event.preventDefault();
        event.stopPropagation();
        picked.clear();
        area = [];
        syncSelection();
        paintHalos();
        syncBrief();
        return;
      }
      // In Build mode the app is in use under the cursor, so its own Escape
      // (a dialog, a field) goes first; one nobody took leaves Describe, below.
      if (building) return;
      if (describing) { event.preventDefault(); event.stopPropagation(); setDescribing(false); return; }
      if (fromUs) { area = []; fromUs = false; mine = []; agent.select(null); syncBrief(); }
    }, true);
    if (building) {
      addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !describing || mode) return;
        if (typing(event.composedPath()[0])) return;
        event.preventDefault();
        setDescribing(false);
      });
    }

    // A fresh text selection is the person choosing something else; so is any
    // other selection this layer did not make.
    addEventListener('marble:agent-context', () => {
      // In Build mode what Select picked is the marks layer's own, never the
      // page's selection, so a caret moving in a note does not let it go.
      if (building || handling || !fromUs) return;
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
        // Only the chat covers what the tools act on: the sidebar's other views
        // (Build mode's marks, Pieces, History) are read beside the marking.
        const covered = panel.dataset.open === 'true' && panel.dataset.pinned !== 'true' && (panel.dataset.view ?? 'chat') === 'chat';
        // A hidden bar is for the drawer covering the page. Leaving the mode is the
        // layer's own fade, which a display:none here would cut short.
        bar.hidden = covered;
        if (covered && mode) setMode(null);
      }).observe(panel, { attributes: true, attributeFilter: ['data-open', 'data-pinned', 'data-view'] });
    }

    // The rest of the app stays usable under a tool. The card the brief is
    // written in is the callout's, and its layer is lifted over this one — a
    // top-layer sheet shown later paints later — so no hole is needed for it.
    dispatchEvent(new CustomEvent('marble-callout:raise'));
    if (panel) {
      new ResizeObserver(() => { if (mode) punch(); }).observe(panel);
      new MutationObserver(() => { if (mode) punch(); }).observe(panel, { attributes: true, attributeFilter: ['data-open', 'data-pinned', 'data-view', 'style'] });
    }

    const tray = trayEl();
    if (tray) {
      // The hole follows the tray: it grows a row when a tool appears, and it
      // moves inward with the page's edge when the drawer is pinned.
      new ResizeObserver(() => { if (mode) punch(); }).observe(tray);
      new MutationObserver(() => { if (mode) punch(); }).observe(tray, { attributes: true, attributeFilter: ['style', 'data-away', 'data-open'] });
    }

    // ⌘J and Ask here inside the mode mean the card already hung on the marks.
    addEventListener('marble-marks:focus', () => {
      if (!describing) return;
      paintFrame();
      card?.focus();
    });

    // The callout an agent was briefed from is put away — Done, or closed —
    // and the marks it was working from go back to being kept marks: out of
    // sight outside the mode, dimmed inside it.
    // The same when the line that carried the brief is done with it.
    document.addEventListener('marble-line:done', (event) => {
      const id = event.detail?.conversation ?? null;
      for (const mark of marks) if (mark.working !== undefined && mark.working === id) unhold(mark);
    });
    addEventListener('marble-callout:removed', (event) => {
      const id = event.detail?.id ?? null;
      for (const mark of marks) if (mark.working !== undefined && mark.working === id) unhold(mark);
    });

    // ------------------------------------------------------------ Build mode

    window.marbleMarks = {
      building,
      get describing() { return describing; },
      get mode() { return mode; },
      setDescribing: (on, options) => setDescribing(Boolean(on), options),
      setMode: (next) => { if (!describing) setDescribing(true); setMode(next); },
      /** The toolbar's place for the build's own controls. */
      slot,
      bar,
      /** The marks as the host keeps them. */
      list: () => marks.filter((mark) => mark.id && !mark.local).map(serial),
      load,
      /** One mark, as the host keeps it, by id. */
      get: (id) => { const mark = marks.find((m) => m.id === id); return mark ? serial(mark) : null; },
      /** Where a mark is on screen. */
      spanOf: (id) => { const mark = marks.find((m) => m.id === id); return mark ? spanOf(mark) : null; },
      elementOf: (id) => marks.find((m) => m.id === id)?.el ?? null,
      onKeep: (fn) => { keepers.add(fn); return () => keepers.delete(fn); },
      onChange: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
      onPicked: (fn) => { pickers.add(fn); return () => pickers.delete(fn); },
      picked: () => [...picked].map((mark) => mark.id).filter(Boolean),
      parts: () => (fromUs ? [...mine] : []),
      clearPicked: () => { picked.clear(); area = []; syncSelection(); paintHalos(); syncBrief(); },
      remove: (ids) => batch(() => { for (const mark of marks.filter((m) => ids.includes(m.id))) removeMark(mark); }),
      /** A note's words, changed somewhere else (the margin's card). */
      edit: (id, text) => {
        const mark = marks.find((m) => m.id === id && m.type === 'note');
        if (!mark || mark.state === 'building') return false;
        mark.text = String(text ?? '').trim();
        if (mark.body && mark.body.innerText.trim() !== mark.text) mark.body.textContent = mark.text;
        if (!hasWords(mark)) { removeMark(mark); return true; }
        keep(mark);
        syncBrief();
        scheduleRepaint();
        return true;
      },
      undo: () => undoLast(),
      /** Archived on the host, drawn here now: off the app, or back on it. */
      setArchived: (ids, on) => {
        for (const mark of marks) {
          if (!ids.includes(mark.id) || mark.state === 'building') continue;
          mark.archived = Boolean(on);
          picked.delete(mark);
          paintState(mark);
        }
        numberPins();
        repaint();
        syncSelection();
        syncBrief();
      },
      /** The line over the toolbar, for something else this page can undo. */
      offerUndo: (words, run) => sayUndo({ words, run }),
      clear: () => clearMarks(),
      /** A note, put on a part of the app or at a point. */
      note: ({ x = null, y = null, anchorId = null, u = 0, v = 0, text = '', first = false } = {}) => {
        if (!describing) setDescribing(true);
        const anchor = anchorId ? document.querySelector(`[data-marble-id="${CSS.escape(anchorId)}"]`) : null;
        let px = x;
        let py = y;
        if (anchor && (px == null || py == null)) {
          const r = anchor.getBoundingClientRect();
          px = r.left + u * r.width;
          py = r.top + v * r.height;
        }
        const mark = placeNote(px ?? innerWidth / 2, py ?? innerHeight / 3, { text, anchor });
        if (mark && first) { mark.first = true; paintState(mark); keep(mark); }
        return mark ? mark.id : null;
      },
      piece: (piece, at = null) => {
        if (!describing) setDescribing(true);
        return placePiece(piece, at)?.id ?? null;
      },
      /** The box to write in, under what Select picked: a note on those
       *  parts, kept or sent like any other. One at a time: an empty one left
       *  from before goes. */
      prompt: (ids, span) => {
        // An empty one left from before goes; one with words in it stays.
        for (const old of marks.filter((m) => m.type === 'note' && m.local && m.fromSelection && !hasWords(m))) removeMark(old, { undo: false });
        if (marks.some((m) => m.type === 'note' && m.fromSelection && m.body && m.body === document.activeElement)) return null;
        const anchor = ids?.[0] ? document.querySelector(`[data-marble-id="${CSS.escape(ids[0])}"]`) : null;
        if (!anchor || !span) return null;
        const floor = (bar.hidden ? innerHeight : bar.getBoundingClientRect().top) - 10;
        const below = span.top + span.height + 10;
        const y = below + 96 > floor ? Math.max(8, span.top - 106) : below;
        const mark = placeNote(Math.max(8, span.left), y, { anchor, ids });
        if (mark) mark.fromSelection = true;
        return mark?.id ?? null;
      },
      /** A note sent (⌘↵): build-mode.js asks the host. */
      onSend: (fn) => { senders.add(fn); return () => senders.delete(fn); },
      /** A comment's pin, taken off when its thread was never started. */
      dropDraft: (id) => { const mark = marks.find((m) => m.id === id && m.local); if (mark) dropMark(mark); },
      /** Kept now (a comment once its first line is posted). */
      keepNow: (id) => { const mark = marks.find((m) => m.id === id); if (mark) { delete mark.local; mark.el?.removeAttribute?.('data-local'); keep(mark); } },
      /** Build mode's margin is open: the marks are read there (build-margin.js). */
      setMargin: (on) => layer.toggleAttribute('data-margin', Boolean(on)),
      closeComments: () => { for (const mark of marks) if (mark.type === 'comment') mark.el.setAttribute('aria-expanded', 'false'); },
      setRunning: (on) => {
        if (buildRunning === Boolean(on)) return;
        buildRunning = Boolean(on);
        for (const mark of marks) paintState(mark);
      },
      elementAt: (x, y) => elementAt(x, y),
    };

    setMode(null);
    syncBrief();
    if (building) {
      // Every app starts in Describe, unless it was turned off here last time.
      if (remembered() !== 'off') setDescribing(true, { remember: false });
      dispatchEvent(new CustomEvent('marble-marks:ready'));
    }
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
