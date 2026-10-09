// Build mode: no chat. You mark up the app, and press Build.
//
// Describe (agent-marks.js) draws the marks and the toolbar; this is the rest
// of the mode around them:
//
//   - the marks are kept on the host (server/build) and every tab of the app
//     hears each change, so a note left here is on the app everywhere;
//   - the toolbar's build: a status mark (nothing waits, how many marks wait,
//     the build's ring filling, held when paused, a check when up to date)
//     that opens the margin; Builds, every build kept, to go back
//     and forth between; and Build, which becomes the build's meter with Pause
//     and Stop while it runs;
//   - the right side: Pieces or the margin (build-margin.js), one at a time,
//     docked where the chat docks, and taking turns with it;
//   - a bar on what is picked: Build these, or Save as piece;
//   - comment threads, answered on the app by the app, in its own name;
//   - what the agent reads, drawn beside the part it is working on;
//   - Pieces, parts of other apps to put on this one;
//   - out of Describe, one button in the corner;
//   - a new app's first note, from New, and its first build.
//
// The progress of the work itself — tints, the ring where it is working,
// dashed outlines of what is to come, the tag — is the change marks every
// agent draws on a page (change-marks.js); a build's turn is an ordinary turn.
//
// Spec: Notes and Sketches/Build Mode; build decisions in
// docs/superpowers/specs/2026-10-06-build-mode-design.md.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';
  // The right side's width: the chat's own docked width, give or take.
  const SIDE_W = 312;
  const KINDS = [['all', 'All'], ['widget', 'Widgets'], ['layout', 'Layouts'], ['pattern', 'Patterns'], ['interaction', 'Interactions'], ['automation', 'Automations']];

  const ICON = {
    builds: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.4 9.3A8 8 0 1 1 4 12"/><path d="M3.8 5v4.4h4.4"/><path d="M12 8v4l2.8 1.8"/></svg>',
    pieces: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><path d="M16.5 13.5v6M13.5 16.5h6"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6.5v11M15 6.5v11"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M8.5 5.8v12.4l9.5-6.2z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="6.5" y="6.5" width="11" height="11" rx="2.2"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 4.5 4.5"/></svg>',
    read: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h5.5A2.5 2.5 0 0 1 12 8v11a2 2 0 0 0-2-2H4z"/><path d="M20 5.5h-5.5A2.5 2.5 0 0 0 12 8v11a2 2 0 0 1 2-2h6z"/></svg>',
    describe: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M7.5 15c2.2-4.6 3.8-6.9 4.8-6.9 1.5 0 .3 6.9 1.8 6.9 1 0 1.9-1.4 2.6-4.2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  };

  // The status mark: one glyph for the build, in a 18px box. Each state is
  // drawn once and shown by the state the bar is in.
  const GLYPH = `
    <svg class="g g-idle" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6.5"/></svg>
    <svg class="g g-pend" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6.5"/><text class="n" x="9" y="9.4"></text></svg>
    <svg class="g g-work" viewBox="0 0 18 18" aria-hidden="true"><circle class="tr" cx="9" cy="9" r="6.5"/><circle class="arc" cx="9" cy="9" r="6.5" pathLength="100"/></svg>
    <svg class="g g-pause" viewBox="0 0 18 18" aria-hidden="true"><circle class="tr" cx="9" cy="9" r="6.5"/><circle class="arc" cx="9" cy="9" r="6.5" pathLength="100"/><path d="M7.6 7v4M10.4 7v4"/></svg>
    <svg class="g g-done" viewBox="0 0 18 18" aria-hidden="true"><circle class="d" cx="9" cy="9" r="7.5"/><path d="M6 9.3 8 11.2l4-4.4"/></svg>`;

  // Build mode's own names for the page's tokens: on its layer over the
  // page, and on the chat sidebar's views (Marks, Pieces, History), which
  // live in the drawer's shadow root (agent-ui.js addView).
  const VARS = `
      --b-ink: var(--ink, #111); --b-muted: var(--muted, #5a5a5a); --b-faint: var(--faint, #8a8a8a);
      --b-paper: var(--paper, #fafaf7); --b-paper-2: var(--paper-2, #f3f1ea); --b-paper-3: var(--paper-3, #eceae1);
      --b-card: var(--card, #fff); --b-line: var(--line, #e6e2d8);
      --b-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)));
      --b-accent: var(--accent, #9bb6cf); --b-accent-soft: var(--accent-soft, #f1f5f8);
      --b-caution: var(--caution, light-dark(#a07a2c, #d9b25e));
      --b-shadow: var(--shadow-lift, 0 2px 6px rgba(74,66,52,.07), 0 8px 18px rgba(74,66,52,.08));
      --b-ui: var(--ui, var(--ui-font, system-ui, -apple-system, "Segoe UI", sans-serif));`;

  const STYLE = `
    .marble-build-layer {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0; background: none; overflow: visible;
      pointer-events: none; z-index: 2147483003;
      ${VARS}
      font: 400 13px/1.4 var(--b-ui); color: var(--b-ink);
    }
    .marble-build-layer:popover-open { position: fixed; inset: 0; }
    .marble-build-layer button { font: inherit; color: inherit; }
    .marble-build-layer [hidden] { display: none !important; }

    /* ---- in the toolbar (inside agent-marks.js's bar; its styles are
       Describe's own, these are the build's additions). */
    .marble-build-status { color: var(--muted, #5a5a5a); }
    /* Its tip is the build's picture (the peek), not the bar's chip. */
    .marble-build-status::after { display: none; }
    .marble-build-status .g-box { width: 18px; height: 18px; position: relative; display: grid; place-items: center; }
    .marble-build-status .g { position: absolute; inset: 0; width: 18px; height: 18px; opacity: 0; transition: opacity 200ms ${EASE};
      fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    .marble-build-status[data-run="idle"] .g-idle, .marble-build-status[data-run="pending"] .g-pend,
    .marble-build-status[data-run="building"] .g-work, .marble-build-status[data-run="paused"] .g-pause,
    .marble-build-status[data-run="done"] .g-done { opacity: 1; }
    .marble-build-status .g-idle circle { opacity: .8; }
    .marble-build-status .g-pend { color: var(--accent-ink, #738698); }
    .marble-build-status .g-pend .n { fill: currentColor; stroke: none; font: 600 9px/1 var(--ui, system-ui, sans-serif); font-variant-numeric: tabular-nums; text-anchor: middle; dominant-baseline: central; }
    .marble-build-status .tr { opacity: .22; }
    .marble-build-status .arc { stroke-dasharray: var(--ring, 4) 100; transform: rotate(-90deg); transform-origin: 9px 9px; transition: stroke-dasharray 340ms ${EASE}; }
    .marble-build-status .g-work { color: var(--accent-ink, #738698); }
    .marble-build-status .g-pause { color: var(--caution, #a07a2c); }
    .marble-build-status .g-done { color: var(--accent-ink, #738698); }
    .marble-build-status .g-done .d { fill: currentColor; stroke: none; }
    .marble-build-status .g-done path { stroke: var(--card, #fff); stroke-width: 1.8; }
    .marble-build-go {
      all: unset; box-sizing: border-box; height: 36px; padding: 0 14px; margin: 0 2px; border-radius: 10px; cursor: pointer;
      display: inline-flex; align-items: center; white-space: nowrap;
      font: 500 13px/1 var(--ui, system-ui, sans-serif); background: var(--ink, #111); color: var(--card, #fff);
      overflow: hidden; interpolate-size: allow-keywords; width: auto;
      transition: background 120ms ${EASE}, opacity 180ms ${EASE}, width 300ms ${EASE}, padding 300ms ${EASE}, margin 300ms ${EASE}, display 300ms allow-discrete;
    }
    .marble-build-go:hover { background: color-mix(in srgb, var(--ink, #111) 84%, var(--card, #fff)); }
    .marble-build-go:active { background: color-mix(in srgb, var(--ink, #111) 72%, var(--card, #fff)); }
    .marble-build-go:focus-visible { outline: 2px solid var(--accent-ink, #738698); outline-offset: 2px; }
    .marble-build-go[aria-disabled="true"] { opacity: .35; cursor: default; }
    .marble-build-go[aria-disabled="true"]:hover { background: var(--ink, #111); }
    /* Build becomes the run and back: one narrows and fades as the other
       widens in from nothing, in the same place on the bar. */
    .marble-build-go[hidden], .marble-build-run[hidden] { display: none; opacity: 0; width: 0; padding-inline: 0; margin-inline: 0; }
    @starting-style {
      .marble-build-go:not([hidden]), .marble-build-run:not([hidden]) { opacity: 0; width: 0; padding-inline: 0; }
    }
    /* While a build runs, Build becomes the build: the tag's words and meter,
       in its ink, with Pause and Stop beside them. Paused is caution. */
    .marble-build-run {
      --mark: var(--accent-ink, #738698);
      display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 2px 0 10px; margin: 0 2px; border-radius: 10px;
      background: color-mix(in srgb, var(--mark) 12%, var(--card, #fff)); color: color-mix(in srgb, var(--mark) 70%, var(--ink, #111));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mark) 30%, transparent);
      font: 500 11.5px/1 var(--ui, system-ui, sans-serif); white-space: nowrap;
      max-width: 420px; overflow: hidden; interpolate-size: allow-keywords; width: auto;
      transition: opacity 240ms ${EASE} 80ms, width 360ms ${EASE}, padding 360ms ${EASE}, margin 360ms ${EASE}, background 200ms ${EASE}, display 360ms allow-discrete;
    }
    .marble-build-run[data-run="paused"] { --mark: var(--caution, #a07a2c); }
    /* What it is doing, in one line, over the stages as dashes: made ones
       full, the one being made half, the ones to come faint. */
    .marble-build-run .w { display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; max-width: 260px; }
    .marble-build-run .w span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: color-mix(in srgb, var(--mark) 55%, var(--ink, #111)); }
    .marble-build-meter { display: flex; gap: 3px; flex: none; width: 100%; min-width: 60px; height: 4px; }
    .marble-build-meter i { flex: 1; min-width: 6px; max-width: 28px; border-radius: 2px; background: color-mix(in srgb, var(--mark) 22%, transparent); transition: background 240ms ${EASE}; position: relative; overflow: hidden; }
    .marble-build-meter i[data-state="done"] { background: var(--mark); }
    .marble-build-meter i[data-state="now"]::before { content: ""; position: absolute; inset: 0 50% 0 0; background: var(--mark); border-radius: 2px; }
    .marble-build-meter i[data-state="plan"] { max-width: none; }
    .marble-build-run button { all: unset; box-sizing: border-box; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; cursor: pointer; }
    .marble-build-run button:hover { background: color-mix(in srgb, var(--mark) 14%, transparent); }
    .marble-build-run button:focus-visible { outline: 2px solid var(--mark); outline-offset: 1px; }
    .marble-build-run button svg { width: 16px; height: 16px; }

    /* ---- cards: the plan, Builds, a thread, what the agent read, a tip */
    .marble-build-pop {
      position: fixed; pointer-events: auto; box-sizing: border-box; width: max-content; min-width: 13rem; max-width: 19rem;
      padding: 10px 12px 11px; border-radius: 10px; background: var(--b-card); color: var(--b-ink);
      box-shadow: 0 0 0 1px var(--b-line), var(--b-shadow); font: 400 12.5px/1.4 var(--b-ui);
      transition: opacity 140ms ${EASE}, translate 140ms ${EASE};
    }
    @starting-style { .marble-build-pop { opacity: 0; translate: 0 3px; } }
    .marble-build-pop .ph b { display: block; font-weight: 600; overflow-wrap: anywhere; }
    .marble-build-pop .ph span { display: block; margin-top: 3px; color: var(--b-muted); font-variant-numeric: tabular-nums; }
    .marble-build-pop .foot { margin: 9px 0 0; padding-top: 8px; border-top: 1px solid var(--b-line); color: var(--b-muted); font-size: 12px; }
    .marble-build-pop .foot button { all: unset; cursor: pointer; color: var(--b-ink); font-weight: 500; }
    .marble-build-pop .foot button:hover { text-decoration: underline; }
    /* A build picked in Builds shows the picture of its work. */
    .marble-build-drawn { margin: 2px 8px 6px; border-radius: 8px; overflow: hidden; }
    .marble-build-drawn iframe { display: block; width: 100%; border: 0; }
    .marble-build-steps { list-style: none; display: grid; gap: 6px; margin: 9px 0 0; padding: 9px 0 0; border-top: 1px solid var(--b-line); }
    .marble-build-steps li { display: flex; align-items: baseline; gap: 8px; color: var(--b-faint); }
    .marble-build-steps li small { color: var(--b-faint); margin-left: .25rem; }
    .marble-build-steps .m { flex: none; align-self: center; box-sizing: border-box; width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid color-mix(in srgb, var(--b-mark) 32%, transparent); }
    .marble-build-steps li[data-s="now"] { color: var(--b-ink); }
    .marble-build-steps li[data-s="now"] .m { border-color: var(--b-mark); box-shadow: inset 0 0 0 1.5px var(--b-card); background: var(--b-mark); }
    .marble-build-steps li[data-s="done"] { color: var(--b-muted); }
    .marble-build-steps li[data-s="done"] .m { border-color: var(--b-mark); background: var(--b-mark); }
    .marble-build-pop[data-run="paused"] { --b-mark: var(--b-caution); }

    .marble-build-builds { width: 300px; max-width: calc(100vw - 24px); padding: 5px; border-radius: 12px; }
    .marble-build-builds .ph { padding: 5px 8px 6px; }
    .marble-build-builds .ph b { font-size: 13px; }
    .marble-build-builds ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
    .marble-build-row { display: flex; align-items: center; gap: 8px; border-radius: 8px; }
    .marble-build-row > button.pick { all: unset; box-sizing: border-box; flex: 1; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; padding: 6px 8px; border-radius: 8px; cursor: pointer; }
    .marble-build-row > button.pick:hover, .marble-build-row > button.pick:focus-visible { background: var(--b-paper-2); outline: none; }
    .marble-build-row > button.pick[aria-disabled="true"] { cursor: default; }
    .marble-build-row > button.pick[aria-disabled="true"]:hover { background: none; }
    .marble-build-row .n { font-weight: 500; }
    .marble-build-row .t { grid-column: 1; color: var(--b-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-build-row .s { grid-column: 2; grid-row: 1 / span 2; align-self: center; color: var(--b-faint); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .marble-build-row[data-showing] .s { color: var(--b-ink); font-weight: 500; }
    .marble-build-row[data-status="paused"] .s { color: var(--b-caution); }
    .marble-build-row .acts { display: flex; gap: 2px; padding-right: 4px; }
    .marble-build-row .acts button { all: unset; box-sizing: border-box; height: 26px; padding: 0 8px; border-radius: 7px; cursor: pointer; font-size: 12px; font-weight: 500; }
    .marble-build-row .acts button:hover, .marble-build-row .acts button:focus-visible { background: var(--b-paper-3); outline: none; }

    /* The bar on what is picked, hung under it as Describe's line is: its
       words say what is picked; its one action is the toolbar's Build, for
       just these. */
    .marble-build-sel {
      position: fixed; pointer-events: auto; display: flex; align-items: center; gap: 6px; box-sizing: border-box;
      min-width: 280px; max-width: calc(100vw - 24px); padding: 6px 6px 6px 14px; border-radius: 14px;
      background: color-mix(in srgb, var(--b-card) 90%, transparent);
      -webkit-backdrop-filter: blur(24px) saturate(1.4); backdrop-filter: blur(24px) saturate(1.4);
      box-shadow: 0 0 0 1px var(--b-line), var(--b-shadow); font-size: 13.5px;
    }
    .marble-build-sel .lbl { flex: 1; min-width: 0; color: var(--b-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .marble-build-btn {
      all: unset; box-sizing: border-box; height: 30px; padding: 0 12px; border-radius: 9px; cursor: pointer; white-space: nowrap;
      font: 500 13px/30px var(--b-ui); color: var(--b-ink); transition: background 120ms ${EASE};
    }
    .marble-build-btn:hover { background: var(--b-paper-2); }
    .marble-build-btn:active { background: var(--b-paper-3); }
    .marble-build-btn:focus-visible { outline: 2px solid var(--b-mark); outline-offset: 1px; }
    .marble-build-btn.primary { background: var(--b-ink); color: var(--b-card); }
    .marble-build-btn.primary:hover { background: color-mix(in srgb, var(--b-ink) 84%, var(--b-card)); }
    .marble-build-btn.quiet { color: var(--b-muted); }
    .marble-build-btn[aria-disabled="true"] { opacity: .4; cursor: default; }

    /* A thread opens as a kept note's card does: frosted, a hairline, lifted.
       The agent's lines are plain; an offer is two buttons under it. */
    /* As wide as what is being written, from 300px to 440px, and as tall:
       the whole prompt is always in view. Put away, it folds into its pin. */
    .marble-build-thread {
      position: fixed; pointer-events: auto; box-sizing: border-box; width: var(--thread-w, 340px); max-width: calc(100vw - 24px);
      border-radius: 12px; padding: 4px 0 8px; transform-origin: var(--thread-from, 0 0);
      transition: width 200ms ${EASE}, opacity 180ms ${EASE}, scale 220ms ${EASE};
      background: color-mix(in srgb, var(--b-card) 92%, transparent);
      -webkit-backdrop-filter: blur(24px) saturate(1.4); backdrop-filter: blur(24px) saturate(1.4);
      border: 1px solid var(--b-line); box-shadow: var(--b-shadow); font-size: 13px;
    }
    @starting-style { .marble-build-thread { opacity: 0; scale: .92; } }
    .marble-build-thread[data-leaving] { opacity: 0; scale: .12; pointer-events: none; }
    .marble-build-thread .lines { max-height: 300px; overflow: auto; }
    /* Q and A: the question slanted and faded, the answer plain under it, a
       little air before the next question. */
    .marble-build-line { padding: 3px 12px 2px; }
    .marble-build-line[data-who="you"] { padding-top: 10px; }
    .marble-build-line[data-who="you"]:first-child { padding-top: 8px; }
    .marble-build-line p { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
    .marble-build-line[data-who="you"] p { font-style: italic; color: var(--b-muted); }
    .marble-build-line .pics { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 4px; }
    .marble-build-line .pics img { height: 48px; max-width: 120px; object-fit: cover; border-radius: 6px; box-shadow: 0 0 0 1px var(--b-line); }
    .marble-build-line .acts { display: flex; gap: 4px; padding-top: 6px; }
    .marble-build-line .done { color: var(--b-muted); font-size: 12px; padding-top: 4px; }
    .marble-build-dots { display: inline-flex; gap: 3px; padding: 4px 0; }
    .marble-build-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--b-mark); animation: marble-build-dot 1.2s ${EASE} infinite; }
    .marble-build-dots i:nth-child(2) { animation-delay: .15s; }
    .marble-build-dots i:nth-child(3) { animation-delay: .3s; }
    @keyframes marble-build-dot { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
    /* The box a reply is written in: the note's own (agent-marks.js), the
       words, what was pasted, and Send, the up arrow on the accent with its
       key. Enter is a new line; ⌘↵ sends. */
    .marble-build-write { margin: 8px 8px 0; border-radius: 10px; background: var(--b-card); box-shadow: 0 0 0 1px var(--b-line); }
    .marble-build-write:focus-within { box-shadow: 0 0 0 1px var(--b-accent), 0 0 0 4px var(--b-accent-soft); }
    .marble-build-write .field { display: block; min-height: 1.45em; max-height: 40vh; overflow-y: auto; padding: 8px 10px 4px; outline: none;
      font: 13px/1.45 var(--b-ui); color: var(--b-ink); white-space: pre-wrap; overflow-wrap: anywhere; caret-color: var(--b-mark); }
    .marble-build-write .field:empty::before { content: attr(data-placeholder); color: var(--placeholder, #767676); }
    .marble-build-write .pics { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 10px 0; }
    .marble-build-write .pics:empty { display: none; }
    .marble-build-write .pic { position: relative; }
    .marble-build-write .pic img { display: block; height: 52px; max-width: 120px; object-fit: cover; border-radius: 6px; box-shadow: 0 0 0 1px var(--b-line); }
    .marble-build-write .pic[data-loading] img { opacity: .5; }
    .marble-build-write .pic button { all: unset; position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center;
      background: var(--b-card); box-shadow: 0 0 0 1px var(--b-line); color: var(--b-muted); font-size: 12px; cursor: pointer; }
    .marble-build-write .act { display: flex; align-items: center; gap: 6px; padding: 4px 6px 6px 10px; }
    .marble-build-write .act .sp { flex: 1; }
    .marble-build-send { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px 0 6px; border-radius: 999px; cursor: pointer;
      background: var(--b-mark); color: var(--b-card); font: 500 11px/1 var(--b-ui); }
    .marble-build-send:hover { background: color-mix(in srgb, var(--b-mark) 86%, var(--b-ink)); }
    .marble-build-send:focus-visible { outline: 2px solid var(--b-mark); outline-offset: 2px; }
    .marble-build-send[aria-disabled="true"] { opacity: .35; cursor: default; }
    .marble-build-send svg { width: 14px; height: 14px; }
    .marble-build-send kbd { font: inherit; opacity: .78; }
    .marble-build-compose { display: flex; align-items: flex-end; gap: 6px; margin: 8px 8px 0; padding: 4px 4px 4px 10px; border-radius: 10px; background: var(--b-card); box-shadow: 0 0 0 1px var(--b-line); }
    .marble-build-compose:focus-within { box-shadow: 0 0 0 1px var(--b-accent), 0 0 0 4px var(--b-accent-soft); }
    .marble-build-compose textarea { flex: 1; min-width: 0; border: 0; background: none; font: 13.5px/1.45 var(--b-ui); color: var(--b-ink); padding: 4px 0; margin: 0; caret-color: var(--b-mark);
      resize: none; field-sizing: content; min-height: calc(1.45em + 8px); max-height: 40vh; overflow-y: auto; overflow-wrap: anywhere; }
    .marble-build-compose textarea:focus { outline: none; }
    .marble-build-compose textarea::placeholder { color: var(--placeholder, #767676); }
    .marble-build-round { all: unset; box-sizing: border-box; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; background: var(--b-mark); color: var(--b-card); }
    .marble-build-round[aria-disabled="true"] { opacity: .35; cursor: default; }
    .marble-build-round svg { width: 15px; height: 15px; }
    .marble-build-x { all: unset; box-sizing: border-box; width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; cursor: pointer; color: var(--b-muted); }
    .marble-build-x:hover, .marble-build-x:focus-visible { background: var(--b-paper-3); color: var(--b-ink); outline: none; }
    .marble-build-x svg { width: 15px; height: 15px; }
    .marble-build-thread .top { display: flex; justify-content: flex-end; padding: 2px 4px 0; gap: 2px; }

    /* ---- a build's status, in three layers: its picture (the drawer's
       drawing of the work); pressed, its stages; a stage pressed, what was
       read, searched for and changed in it. Used at the head of Marks while
       a build is in hand, and for every build in History. */
    .marble-bst { display: flex; flex-direction: column; gap: 0; background: var(--b-card); border: 1px solid var(--b-line); border-radius: 12px;
      box-shadow: var(--shadow, 0 1px 2px rgba(74,66,52,.05), 0 2px 4px rgba(74,66,52,.03)); font: 400 12.5px/1.4 var(--b-ui); color: var(--b-ink); overflow: hidden; }
    .marble-bst .bst-top { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 10px 12px 10px; cursor: pointer; text-align: left; }
    .marble-bst .bst-top:hover { background: color-mix(in srgb, var(--b-ink) 3%, transparent); }
    .marble-bst .bst-top:focus-visible { outline: 2px solid var(--b-mark); outline-offset: -2px; }
    .marble-bst .bst-head { display: flex; align-items: baseline; gap: 8px; }
    .marble-bst .bst-head b { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-bst .bst-head time { flex: none; color: var(--b-muted); font-variant-numeric: tabular-nums; font-size: 12px; }
    .marble-bst .bst-sub { display: flex; align-items: center; gap: 6px; margin-top: 2px; color: var(--b-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    .marble-bst .bst-sub .chev { margin-left: auto; width: 14px; height: 14px; color: var(--b-faint); transition: rotate 200ms ${EASE}; }
    .marble-bst[data-open] .bst-sub .chev { rotate: 90deg; }
    .marble-bst[data-status="paused"] .bst-sub, .marble-bst[data-status="failed"] .bst-sub { color: var(--b-caution); }
    .marble-bst .bst-pic { margin: 8px -4px 0; border-radius: 8px; overflow: hidden; pointer-events: none; }
    .marble-bst .bst-pic:empty { display: none; }
    .marble-bst .bst-pic iframe { display: block; width: 100%; border: 0; }
    /* Its stages. */
    .marble-bst .bst-stages { list-style: none; margin: 0; padding: 2px 6px 8px; border-top: 1px solid var(--b-line); }
    .marble-bst:not([data-open]) .bst-stages { display: none; }
    .marble-bst .bst-stage > button { all: unset; box-sizing: border-box; display: grid; grid-template-columns: 16px 1fr auto; align-items: center; column-gap: 8px; width: 100%;
      padding: 7px 6px; border-radius: 8px; cursor: pointer; }
    .marble-bst .bst-stage > button:hover { background: var(--b-paper-2); }
    .marble-bst .bst-stage > button:focus-visible { outline: 2px solid var(--b-mark); outline-offset: -2px; }
    .marble-bst .bst-stage > button[aria-disabled="true"] { cursor: default; }
    .marble-bst .bst-stage > button[aria-disabled="true"]:hover { background: none; }
    .marble-bst .bst-dot { width: 10px; height: 10px; border-radius: 50%; justify-self: center; box-sizing: border-box; border: 1.5px solid var(--b-faint); }
    .marble-bst .bst-stage[data-state="now"] .bst-dot { border-color: var(--b-mark); background: color-mix(in srgb, var(--b-mark) 25%, transparent); }
    .marble-bst .bst-stage[data-state="done"] .bst-dot { border-color: var(--b-mark); background: var(--b-mark); }
    .marble-bst .bst-st { min-width: 0; }
    .marble-bst .bst-st span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-bst .bst-stage[data-state="ahead"] .bst-st span { color: var(--b-muted); }
    .marble-bst .bst-stage[data-state="now"] .bst-st span { font-weight: 600; }
    .marble-bst .bst-st small { display: block; color: var(--b-muted); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-bst .bst-n { color: var(--b-faint); font-size: 11.5px; font-variant-numeric: tabular-nums; }
    .marble-bst .bst-talk { border-top: 1px solid var(--b-line); padding-bottom: 8px; }
    .marble-bst .bst-lines:empty { display: none; }
    .marble-bst .bst-lines { padding-bottom: 2px; }
    .marble-bst .bst-said { margin: 6px 6px 0; padding-top: 8px; border-top: 1px solid var(--b-line); color: var(--b-muted); font-size: 12px; }
    /* A stage's steps. */
    .marble-bst .bst-steps { list-style: none; margin: 0 0 4px 30px; padding: 0; border-left: 1px solid var(--b-line); }
    .marble-bst .bst-stage:not([data-open]) .bst-steps { display: none; }
    .marble-bst .bst-step { display: grid; grid-template-columns: 14px 1fr; column-gap: 8px; padding: 6px 6px 6px 10px; border-radius: 0 8px 8px 0; }
    .marble-bst .bst-step[data-ids] { cursor: pointer; }
    .marble-bst .bst-step[data-ids]:hover { background: color-mix(in srgb, var(--b-accent) 18%, transparent); }
    .marble-bst .bst-step svg { width: 13px; height: 13px; margin-top: 2px; color: var(--b-mark); }
    .marble-bst .bst-step[data-kind="change"] svg { color: var(--b-ink); }
    .marble-bst .bst-step b { display: block; font-weight: 500; overflow-wrap: anywhere; }
    .marble-bst .bst-step code { display: block; margin-top: 1px; font: 11px/1.4 var(--mono, ui-monospace, monospace); color: var(--b-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-bst .bst-step p { margin: 3px 0 0; color: var(--b-muted); font-size: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    .marble-bst .bst-step[data-failed] b { color: var(--b-caution); }
    .marble-bst .bst-none { padding: 4px 10px 6px; color: var(--b-faint); font-size: 12px; }

    /* The status mark's own peek: the build's picture, on a rest over it. */
    .marble-build-peek { position: fixed; pointer-events: none; box-sizing: border-box; width: 300px; max-width: calc(100vw - 16px);
      padding: 10px 12px 11px; border-radius: 12px; background: var(--b-card); border: 1px solid var(--b-line); box-shadow: var(--b-shadow);
      font: 400 12.5px/1.4 var(--b-ui); color: var(--b-ink); transition: opacity 140ms ${EASE}, translate 140ms ${EASE}; }
    @starting-style { .marble-build-peek { opacity: 0; translate: 0 4px; } }
    .marble-build-peek b { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-build-peek span { display: block; color: var(--b-muted); font-size: 12px; margin-top: 1px; }
    .marble-build-peek .pic { margin: 8px -4px 0; border-radius: 8px; overflow: hidden; }
    .marble-build-peek .pic:empty { display: none; }
    .marble-build-peek .pic iframe { display: block; width: 100%; border: 0; }

    /* What changed, lit on the app from a hand over a step or a History
       entry: the accent wash and a ring, never anything saved. */
    .marble-build-lit { position: fixed; pointer-events: none; border-radius: 6px;
      background: color-mix(in srgb, var(--b-accent) 22%, transparent); box-shadow: 0 0 0 1.5px var(--b-mark);
      transition: opacity 160ms ${EASE}; }
    @starting-style { .marble-build-lit { opacity: 0; } }

    /* Out of Describe: the toolbar folds into one button in the corner, with
       the build's state as its dot. Nothing comes up over the app under a
       passing hand. */
    .marble-build-handle {
      position: fixed; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); pointer-events: auto; box-sizing: border-box;
      width: 44px; height: 44px; padding: 0; display: grid; place-items: center; border-radius: 50%; cursor: pointer;
      border: 1px solid var(--b-line); background: var(--b-card); color: var(--b-ink); box-shadow: var(--b-shadow);
      transition: opacity 340ms ${EASE}, translate 340ms ${EASE}, background 200ms ${EASE};
    }
    .marble-build-handle:hover { background: var(--b-paper-2); }
    .marble-build-handle:focus-visible { outline: 2px solid var(--b-mark); outline-offset: 2px; }
    .marble-build-handle svg { width: 20px; height: 20px; }
    .marble-build-handle .dot { position: absolute; top: 7px; right: 7px; width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box; box-shadow: 0 0 0 2px var(--b-card); background: var(--b-ink); }
    .marble-build-handle[data-run="idle"] .dot, .marble-build-handle[data-run="done"] .dot { display: none; }
    .marble-build-handle[data-run="building"] .dot { background: var(--b-mark); animation: marble-build-breathe 1.6s ease-in-out infinite; }
    .marble-build-handle[data-run="paused"] .dot { background: var(--b-card); border: 2px solid var(--b-caution); }
    .marble-build-handle[data-run="pending"] .dot { background: var(--b-mark); }
    .marble-build-handle[data-away] { opacity: 0; translate: 0 8px; pointer-events: none; }
    @keyframes marble-build-breathe { 50% { opacity: .45; } }

    /* The tip every icon here has: what a press does, and its key. */
    .marble-build-tip {
      position: fixed; pointer-events: none; max-width: 16rem; padding: 6px 10px; border-radius: 8px;
      background: var(--b-card); color: var(--b-ink); border: 1px solid var(--b-line);
      box-shadow: var(--shadow-rest, 0 1px 2px rgba(74,66,52,.06), 0 6px 16px rgba(74,66,52,.08));
      font: 400 12.5px/1.35 var(--b-ui); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      transition: opacity 140ms ${EASE}, translate 140ms ${EASE};
    }
    @starting-style { .marble-build-tip { opacity: 0; translate: 0 3px; } }
    .marble-build-tip kbd { font: inherit; color: var(--b-muted); margin-left: .45rem; }

    /* ---- the right side: Pieces, or the margin (build-margin.js), one at a
       time, docked where the chat docks. The page narrows by its width, so
       nothing in the app is covered; it is paper, and the app's own edge is
       the line between them. */
    .marble-build-pieces {
      position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; box-sizing: border-box;
      pointer-events: auto;
    }
    .marble-build-pieces .head { height: 46px; padding: 0 8px 0 14px; display: flex; align-items: center; gap: 2px; flex: none; }
    .marble-build-pieces .head b { flex: 1; font-weight: 500; font-size: 14px; }
    .marble-build-find { margin: 0 12px 6px; display: flex; align-items: center; gap: .45rem; padding: 0 10px; height: 34px; border-radius: 17px; background: var(--b-card); border: 1px solid var(--b-line); flex: none; }
    .marble-build-find:focus-within { border-color: var(--b-accent); box-shadow: 0 0 0 3px var(--b-accent-soft); }
    .marble-build-find svg { flex: none; width: 15px; height: 15px; color: var(--b-faint); }
    .marble-build-find input { flex: 1; min-width: 0; border: 0; background: none; font: 13px var(--b-ui); color: var(--b-ink); }
    .marble-build-find input:focus { outline: none; }
    .marble-build-find input::placeholder { color: var(--placeholder, #767676); }
    .marble-build-kinds { display: flex; flex-wrap: wrap; gap: 0 2px; padding: 0 8px 6px; flex: none; }
    .marble-build-kinds button { all: unset; padding: 3px 7px; border-radius: 7px; font-size: 12px; font-weight: 500; color: var(--b-muted); cursor: pointer; }
    .marble-build-kinds button:hover { background: var(--b-paper-2); color: var(--b-ink); }
    .marble-build-kinds button:focus-visible { outline: 2px solid var(--b-mark); }
    .marble-build-kinds button[aria-pressed="true"] { color: var(--b-ink); font-weight: 600; }
    .marble-build-gallery { flex: 1; overflow: auto; padding: 0 12px 14px; }
    .marble-build-sec { font-size: 13px; font-weight: 600; margin: 10px 2px 6px; display: flex; align-items: baseline; gap: .4rem; }
    .marble-build-sec span { font-weight: 400; color: var(--b-faint); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-build-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .marble-build-empty { color: var(--b-muted); font-size: 12.5px; padding: 4px 2px 2px; }
    .marble-build-pc {
      position: relative; box-sizing: border-box; min-width: 0; background: var(--b-card); border: 1px solid var(--b-line); border-radius: 12px;
      padding: 6px 6px 8px; cursor: grab; touch-action: none; transition: box-shadow 200ms ${EASE}, opacity 200ms ${EASE};
    }
    .marble-build-pc:hover, .marble-build-pc:focus-within { box-shadow: var(--shadow-rest, 0 1px 2px rgba(74,66,52,.06), 0 6px 16px rgba(74,66,52,.08)); }
    .marble-build-pc .pv { height: 62px; border-radius: 8px; background: var(--b-paper); margin-bottom: 6px; position: relative; overflow: hidden; }
    .marble-build-pc .pv iframe { position: absolute; left: 0; top: 0; width: 300%; height: 300%; border: 0; transform: scale(.3333); transform-origin: 0 0; pointer-events: none; }
    .marble-build-pc .pn { font-size: 12.5px; font-weight: 500; line-height: 1.3; padding: 0 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-build-pc .pk { font-size: 11.5px; color: var(--b-muted); padding: 0 2px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-build-pc .pl { font-size: 11.5px; color: var(--b-ink); padding: 2px 2px 0; line-height: 1.35; }
    .marble-build-pc .inc {
      all: unset; position: absolute; right: 10px; top: 40px; height: 22px; padding: 0 9px; border-radius: 7px; cursor: pointer;
      background: var(--b-ink); color: var(--b-card); font: 500 12px/22px var(--b-ui); opacity: 0; transition: opacity 200ms ${EASE};
    }
    .marble-build-pc:hover .inc, .marble-build-pc:focus-within .inc { opacity: 1; }
    .marble-build-pc .inc:focus-visible { outline: 2px solid var(--b-mark); outline-offset: 1px; }
    .marble-build-pc .del { position: absolute; top: 8px; right: 8px; width: 22px; height: 22px; opacity: 0; background: var(--b-card); }
    .marble-build-pc:hover .del, .marble-build-pc:focus-within .del { opacity: 1; }
    .marble-build-pc[data-in] { opacity: .45; }
    .marble-build-pc[data-in] .inc { display: none; }
    @media (hover: none) { .marble-build-pc .inc, .marble-build-pc .del { opacity: 1; } }
    .marble-build-ghost { position: fixed; pointer-events: none; width: 150px; opacity: .92; transform: translate(-50%, -30%) rotate(-1.5deg); }

    /* On a phone there is no room beside the app: Pieces is a sheet from the
       foot, over the lower part of the page. */
    @media (max-width: 620px) {
      .marble-build-thread { width: calc(100vw - 24px); }
    }
    @media (max-width: 520px) {
      .marble-build-go { padding: 0 10px; margin: 0 1px; }
      .marble-build-run { padding-left: 8px; gap: 3px; }
      .marble-build-run .w { max-width: 120px; }
    }
    @media (pointer: coarse) {
      .marble-build-btn { height: 36px; line-height: 36px; }
      .marble-build-x { width: 36px; height: 36px; }
    }
    @media (prefers-reduced-transparency: reduce) {
      .marble-build-sel, .marble-build-thread, .marble-build-pieces { background: var(--b-card); -webkit-backdrop-filter: none; backdrop-filter: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .marble-build-layer *, .marble-build-status .g, .marble-build-status .arc, .marble-build-meter i { transition: opacity 150ms linear !important; animation: none !important; }
      @starting-style { .marble-build-pop, .marble-build-found, .marble-build-tip { translate: none; } }
    }
  `;

  const enc = encodeURIComponent;
  const h = (tag, className = '', text = null) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.setAttribute(TRANSIENT, '');
    if (text != null) node.textContent = text;
    return node;
  };
  const clip = (text, n) => { const t = String(text ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  /** A side panel in and out: shown, then slid in from its edge on the next
   *  frame; slid out, then hidden once it is out of sight. Its CSS says which
   *  edge ([data-in] is in). */
  const slide = (node, show) => {
    clearTimeout(node.slideTimer);
    if (show) {
      if (node.hidden) {
        node.hidden = false;
        node.removeAttribute('data-in');
        void node.offsetWidth;
      }
      node.setAttribute('data-in', '');
      return;
    }
    if (node.hidden) return;
    node.removeAttribute('data-in');
    const away = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 360;
    node.slideTimer = setTimeout(() => { if (!node.hasAttribute('data-in')) node.hidden = true; }, away);
  };
  /** A box for words that is as tall as what is in it (field-sizing where
   *  there is one, measured where not), and says how wide its longest line
   *  wants to be, so the card round it can widen. Enter sends; Shift+Enter is
   *  a new line. */
  const growing = (textarea, { onWidth = null, onSend = null } = {}) => {
    textarea.rows = 1;
    const measure = () => {
      if (!CSS.supports?.('field-sizing', 'content')) {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
      }
      if (onWidth) {
        const longest = Math.max(0, ...textarea.value.split('\n').map((line) => line.length));
        onWidth(longest);
      }
    };
    textarea.addEventListener('input', measure);
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && onSend) { event.preventDefault(); onSend(); }
    });
    requestAnimationFrame(measure);
    return measure;
  };
  const clock = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const ago = (t) => {
    const s = Math.max(0, (Date.now() - Number(t || 0)) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.round(s / 60)} min`;
    if (s < 86400) return `${Math.round(s / 3600)} h`;
    return new Date(Number(t)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const boot = () => {
    const M = window.marbleMarks;
    const marble = window.marble;
    const agent = marble?.agent;
    if (!M?.building || !agent || !marble.app) return false;
    if (document.querySelector('.marble-build-layer')) return true;
    const app = marble.app;
    const name = app.split('/').pop();

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);

    // In the top layer, shown after Describe's own so it paints over it: the
    // cards here are about the marks and must never be under them.
    const layer = h('div', 'marble-build-layer');
    layer.setAttribute('popover', 'manual');
    document.documentElement.append(layer);
    const raise = () => {
      try { layer.hidePopover(); } catch { /* not shown */ }
      try { layer.showPopover(); } catch { /* fixed positioning still stands */ }
    };
    raise();
    window.marbleAgentUI?.keepKeys?.(layer);

    // The chat's sidebar, whose views Marks, Pieces and History are. The
    // first view brings this layer's styles and token names into its shadow
    // root; each brings its own besides.
    const drawer = document.querySelector('marble-agent-drawer');
    let viewCss = `.views { ${VARS} font: 400 13px/1.4 var(--b-ui); color: var(--b-ink); }
      .views [hidden] { display: none !important; }
      .views button { font: inherit; color: inherit; }
      ${STYLE}`;
    const addView = (name, node, css = '') => {
      if (!drawer?.addView) { layer.append(node); return; }
      drawer.addView(name, { node, css: viewCss + css });
      viewCss = '';
    };

    // Out of Describe, the toolbar folds into this: one button in the corner,
    // with the build's state as its dot (wired below).
    const handle = h('button', 'marble-build-handle');
    handle.type = 'button';
    handle.innerHTML = `${ICON.describe}<span class="dot" ${TRANSIENT}></span>`;
    handle.addEventListener('click', () => M.setDescribing(true));
    layer.append(handle);

    // -------------------------------------------------------------- the host

    const ask = async (method, route, body) => {
      const response = await fetch(route, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data?.error || `${response.status}`), { status: response.status });
      return data;
    };
    const route = (rest, extra = '') => `/agent/builds${rest}?path=${enc(app)}${extra}`;

    let state = null;
    let stream = null;
    const openStream = () => {
      stream?.close();
      stream = new EventSource(route('/events'));
      stream.onmessage = (message) => {
        let data;
        try { data = JSON.parse(message.data); } catch { return; }
        if (data.type === 'moved' && data.href) {
          // The app was named, or filed: this tab goes where it went, with
          // the sidebar on the view it had here.
          stream.close();
          try {
            const to = decodeURIComponent(new URL(data.href, location.href).pathname.replace(/^\/a\//, ''));
            localStorage.setItem(`marble-build:side:${to}`, side === 'none' ? 'comments' : side);
          } catch { /* private mode, or an address not of an app */ }
          location.replace(data.href);
          return;
        }
        if (data.type === 'state' && data.state) apply(data.state);
      };
    };

    // Marks go to the host as they change, a few at a time.
    const pending = new Map();
    const removing = new Set();
    let flushing = null;
    const flush = () => {
      if (flushing) return;
      flushing = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        while (pending.size || removing.size) {
          const ids = [...removing];
          removing.clear();
          if (ids.length) await ask('DELETE', route('/marks'), { ids }).catch((err) => console.warn('marble-build: a mark was not removed', err));
          const puts = [...pending.values()];
          pending.clear();
          for (const mark of puts) await ask('PUT', route('/marks'), { mark }).catch((err) => console.warn('marble-build: a mark was not kept', err));
        }
        flushing = null;
      })();
    };
    M.onKeep(({ type, mark, ids }) => {
      if (type === 'put') { removing.delete(mark.id); pending.set(mark.id, mark); }
      if (type === 'remove') for (const id of ids) { pending.delete(id); removing.add(id); }
      flush();
    });

    // ---------------------------------------------------------- the toolbar

    const status = h('button', 'marble-marks-tool marble-build-status');
    status.type = 'button';
    status.innerHTML = `<span class="g-box" ${TRANSIENT}>${GLYPH}</span>`;
    const go = h('button', 'marble-build-go', 'Build');
    go.type = 'button';
    const run = h('span', 'marble-build-run');
    run.hidden = true;
    const runWords = h('span', 'w');
    const meter = h('span', 'marble-build-meter');
    meter.append(h('i'));
    const pauseButton = h('button');
    pauseButton.type = 'button';
    const stopButton = h('button');
    stopButton.type = 'button';
    stopButton.innerHTML = ICON.stop;
    stopButton.setAttribute('aria-label', 'Stop and go back to the last finished build');
    run.append(runWords, meter, pauseButton, stopButton);
    // The bar holds the build alone: its status mark, and Build (or the build
    // running). Builds, now History, and Pieces are on the shell's bar.
    M.slot.append(status, go, run);

    // ------------------------------------------------------------ the tip

    const tip = h('div', 'marble-build-tip');
    tip.setAttribute('role', 'tooltip');
    tip.id = 'marble-build-tip';
    tip.hidden = true;
    layer.append(tip);
    let tipTimer = 0;
    const showTip = (node, now = false) => {
      clearTimeout(tipTimer);
      const words = node.dataset.tipText;
      if (!words || matchMedia('(hover: none)').matches) return;
      const put = () => {
        tip.replaceChildren(document.createTextNode(words));
        if (node.dataset.tipKey) tip.append(h('kbd', '', node.dataset.tipKey));
        tip.hidden = false;
        const r = node.getBoundingClientRect();
        const t = tip.getBoundingClientRect();
        const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
        const top = r.top - t.height - 8 >= 8 ? r.top - t.height - 8 : r.bottom + 8;
        Object.assign(tip.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
        node.setAttribute('aria-describedby', tip.id);
      };
      if (now) put();
      else tipTimer = setTimeout(put, 750);
    };
    const hideTip = () => { clearTimeout(tipTimer); tip.hidden = true; };
    /** What a press does, said where the control is: in the toolbar by its
     *  own chip (agent-marks.js), anywhere else by this layer's tip. */
    const tipped = (node, words, key = '') => {
      node.setAttribute('aria-label', words);
      if (node.classList.contains('marble-marks-tool')) {
        node.dataset.label = words;
        node.dataset.keyHint = key ? `\u2003${key}` : '';
        return;
      }
      node.dataset.tipText = words;
      if (key) node.dataset.tipKey = key;
    };
    for (const node of [pauseButton, stopButton, handle]) {
      node.addEventListener('pointerenter', () => showTip(node));
      node.addEventListener('pointerleave', hideTip);
      node.addEventListener('focus', () => { if (node.matches(':focus-visible')) showTip(node, true); });
      node.addEventListener('blur', hideTip);
      node.addEventListener('pointerdown', hideTip);
    }
    tipped(stopButton, 'Stop · go back to the last finished build');

    // ---------------------------------------------------------- the reading

    const builds = () => state?.builds ?? [];
    let workLine = null; // { say, at }: the running build's own line, newest
    // Builds can run side by side: the newest is the one the bar shows.
    const runningBuild = () => [...builds()].reverse().find((b) => b.status === 'running') ?? null;
    const inHand = () => builds().filter((b) => b.status === 'running' || b.status === 'paused');
    /** The last build to end, finished or not: Marks keeps it, with its
     *  summary, under any running now. */
    const lastEnded = () => [...builds()].reverse().find((b) => b.status !== 'running' && b.status !== 'paused') ?? null;
    const buildConversations = () => new Set(builds().map((b) => b.conversation).concat(state?.conversation ?? []).filter(Boolean));
    const pausedBuild = () => [...builds()].reverse().find((b) => b.status === 'paused') ?? null;
    const current = () => runningBuild() ?? pausedBuild();
    const waiting = () => (state?.marks ?? []).filter((m) => m.state === 'waiting' && m.type !== 'comment' && !m.archived);
    const progressOf = (build) => {
      const parts = build?.plan?.parts ?? [];
      return { done: parts.filter((p) => p.state === 'done').length, of: parts.length };
    };
    /** Where the build stands, in one word the glyph and the corner share. */
    const runOf = () => {
      if (runningBuild()) return 'building';
      if (pausedBuild()) return 'paused';
      if (waiting().length) return 'pending';
      if (builds().some((b) => b.status === 'finished')) return 'done';
      return 'idle';
    };

    const paintBar = () => {
      const r = runOf();
      const build = current();
      const { done, of } = progressOf(build);
      status.dataset.run = r;
      const n = waiting().length;
      status.querySelector('.g-pend .n').textContent = n > 9 ? '9+' : String(n);
      const ring = of ? Math.max(4, Math.round((done / of) * 100)) : 4;
      status.style.setProperty('--ring', String(ring));
      // What it is now, and what a press does: show the marks beside the app.
      const words = {
        idle: 'Nothing waits to be built · press for your marks',
        pending: `${plural(n, 'mark')} ${n === 1 ? 'waits' : 'wait'} for the next build · press for your marks`,
        building: of ? `Building · ${done} of ${of} parts · press to follow it` : 'Building · press to follow it',
        paused: of ? `Paused at ${done} of ${of} parts · press to follow it` : 'Paused · press to follow it',
        done: `Up to date · build ${builds().filter((b) => b.status === 'finished').at(-1)?.n ?? ''} · press for your marks`,
      }[r];
      tipped(status, words);
      // The same mark on Marks in the shell's bar (shell.js).
      dispatchEvent(new CustomEvent('marble-build:status', { detail: {
        run: r, ring, n,
        label: { idle: 'nothing waits', pending: `${plural(n, 'mark')} ${n === 1 ? 'waits' : 'wait'}`, building: of ? `building, ${done} of ${of}` : 'building', paused: 'paused', done: 'up to date' }[r],
      } }));
      // Build: what it will take; while a build runs, the build itself.
      const picked = M.picked();
      const chosen = picked.filter((id) => waiting().some((m) => m.id === id));
      go.textContent = chosen.length ? 'Build selection' : 'Build';
      // Build is never shut, and never a queue: while one runs, what is marked
      // starts at once, alongside it, or joins it when it is about the same
      // parts (the host decides).
      const can = Boolean(chosen.length || n > 0);
      go.setAttribute('aria-disabled', String(!can));
      go.hidden = Boolean(build) && !can;
      tipped(go, build ? 'Build these now: alongside the running build, or into it when they are about the same parts' : 'Build what is marked');
      run.hidden = !build;
      if (build) {
        run.dataset.run = build.status === 'paused' ? 'paused' : 'building';
        const parts = build.plan?.parts ?? [];
        const now = parts.find((p) => p.state === 'now');
        // The one line: what it is doing now, in the words its steps or the
        // work's own line use, else the stage it is on.
        const lineOf = () => {
          if (build.status === 'paused') return now ? `Paused · ${now.title}` : 'Paused';
          const recent = workLine && Date.now() - workLine.at < 20_000 ? workLine.say : null;
          return recent || build.log?.at(-1)?.head || now?.title || 'Working out the plan';
        };
        runWords.replaceChildren(h('span', '', lineOf()), meter);
        meter.replaceChildren(...(parts.length ? parts.map((p) => {
          const dash = h('i');
          dash.dataset.state = p.state;
          dash.title = p.title;
          return dash;
        }) : [(() => { const dash = h('i'); dash.dataset.state = 'plan'; return dash; })()]));
        meter.setAttribute('aria-label', parts.length ? `${done} of ${of} stages made` : 'Working out the plan');
        run.title = parts.length ? parts.map((p) => `${p.state === 'done' ? '✓' : p.state === 'now' ? '•' : '○'} ${p.title}`).join('\n') : '';
        if (build.status === 'paused') {
          pauseButton.innerHTML = ICON.play;
          tipped(pauseButton, 'Resume · carry on with the same plan');
        } else {
          pauseButton.innerHTML = ICON.pause;
          tipped(pauseButton, 'Pause · keep what has landed');
        }
      }
      handle.dataset.run = r;
      tipped(handle, r === 'building' ? 'Describe · a build is running' : r === 'pending' ? `Describe · ${plural(n, 'mark')} waiting` : 'Describe · mark up this app', '⌘⇧D');
    };

    // -------------------------------------------------------------- popovers

    let open = null; // { kind, node }
    const closePop = () => {
      if (!open) return;
      open.node.remove();
      open.button?.setAttribute('aria-expanded', 'false');
      open = null;
    };
    /** A card that hangs over the button that opened it, centred on it and
     *  kept inside the window. */
    const hangOver = (node, button) => {
      const r = button.getBoundingClientRect();
      const s = node.getBoundingClientRect();
      const left = Math.min(Math.max(12, r.left + r.width / 2 - s.width / 2), innerWidth - s.width - 12);
      Object.assign(node.style, { left: `${Math.round(left)}px`, top: `${Math.round(Math.max(12, r.top - s.height - 10))}px` });
    };
    const openPop = (kind, button, draw) => {
      if (open?.kind === kind) { closePop(); return; }
      closePop();
      const node = h('div', `marble-build-pop marble-build-${kind}`);
      node.setAttribute('role', 'dialog');
      layer.append(node);
      open = { kind, node, button, draw };
      button.setAttribute('aria-expanded', 'true');
      draw(node);
      hangOver(node, button);
      hideTip();
    };
    const redrawPop = () => {
      if (!open) return;
      open.node.replaceChildren();
      open.draw(open.node);
      hangOver(open.node, open.button);
    };
    addEventListener('pointerdown', (event) => {
      if (!open) return;
      const path = event.composedPath();
      if (path.includes(open.node) || path.includes(open.button)) return;
      closePop();
    }, true);

    // The status mark opens no card: it brings the margin out, headed by the
    // build while one is in hand, and puts it away when pressed again
    // (build-margin.js).
    status.addEventListener('click', () => {
      hideTip();
      const margin = window.marbleMargin;
      if (!margin?.toggle) return;
      margin.toggle();
    });

    // --------------------------------------------------------------- actions

    const say = (words) => {
      // One line where the press was, for a refusal worth reading.
      tip.replaceChildren(document.createTextNode(words));
      tip.hidden = false;
      const r = M.bar.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      Object.assign(tip.style, { left: `${Math.round(r.left + r.width / 2 - t.width / 2)}px`, top: `${Math.round(r.top - t.height - 10)}px` });
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 3200);
    };
    const settled = (promise) => promise.then((next) => { if (next?.marks) apply(next); return next; }).catch((err) => { say(err.message || 'That did not work'); return null; });

    /** Build: started, or, while one runs, queued for after it; `steer`
     *  sends the marks into the running build instead. */
    const start = async ({ marks = null, words = '', steer = false } = {}) => {
      await flushing;
      flush();
      await flushing;
      const made = await settled(ask('POST', route('/start'), { marks, words, steer }));
      if (made?.conversation) agent.attend(made.conversation);
      if (made?.joined) say(`Added to build ${made.joined}, which is working on the same parts.`);
      else if (made?.alongside) say('Building it now, alongside the build already running.');
      else if (made?.steered) say(`${plural(made.steered, 'mark')} sent into the build running now.`);
      M.clearPicked();
      return made;
    };
    const act = (id, verb) => settled(ask('POST', `/agent/builds/${enc(id)}/${verb}?path=${enc(app)}`, {})).then((next) => {
      if (verb === 'resume' && next?.conversation) agent.attend(next.conversation);
      return next;
    });
    const view = (id) => { closePop(); return settled(ask('POST', `/agent/builds/${enc(id)}/view?path=${enc(app)}`, {})); };
    const fileInto = (folder) => { closePop(); return settled(ask('POST', route('/folder'), { folder })); };

    go.addEventListener('click', () => {
      if (go.getAttribute('aria-disabled') === 'true') { if (!runningBuild()) say('Mark what you want first: a note, a sketch or a piece.'); return; }
      const chosen = M.picked().filter((id) => waiting().some((m) => m.id === id));
      start({ marks: chosen.length ? chosen : null });
    });
    pauseButton.addEventListener('click', () => {
      const build = current();
      if (!build) return;
      act(build.id, build.status === 'paused' ? 'resume' : 'pause');
    });
    stopButton.addEventListener('click', () => { const build = current(); if (build) act(build.id, 'stop'); });

    // ---------------------------------------------------------- drawings

    /** The drawer's picture of a build's work (server/agent/drawer.js), in the
     *  sandboxed frame a chat's progress uses (chat-visual.js mountDrawing),
     *  swapped in place when a new one comes. */
    let visual = null;
    const mountDrawn = async (box, html) => {
      visual ??= import('/runtime/chat-visual.js').catch(() => null);
      const mod = await visual;
      if (mod?.mountDrawing && box.isConnected && html) mod.mountDrawing(box, { html });
    };

    // ---------------------------------------------------------- the picked

    const sel = h('div', 'marble-build-sel');
    sel.setAttribute('role', 'toolbar');
    sel.hidden = true;
    const selLabel = h('span', 'lbl');
    const selA = h('button', 'marble-build-btn quiet');
    selA.type = 'button';
    // Picked marks can be put away together: off the app, into Archived.
    const selArchive = h('button', 'marble-build-btn quiet', 'Archive');
    selArchive.type = 'button';
    const selB = h('button', 'marble-build-btn primary');
    selB.type = 'button';
    const selSteer = h('button', 'marble-build-btn', 'Steer');
    selSteer.type = 'button';
    selSteer.hidden = true;
    selSteer.title = 'Send these into the build running now, as a change of course';
    sel.append(selLabel, selA, selArchive, selSteer, selB);
    layer.append(sel);
    let selNow = { marks: [], parts: [] };
    let promptedFor = '';
    M.onPicked((detail) => {
      selNow = detail;
      paintBar();
      if (!detail.parts.length) promptedFor = '';
      if (!detail.span || (!detail.marks.length && !detail.parts.length)) { sel.hidden = true; return; }
      if (detail.marks.length) {
        const n = detail.marks.length;
        const built = detail.marks.filter((id) => waiting().every((m) => m.id !== id)).length;
        selLabel.textContent = built === n ? `${plural(n, 'mark')}, built already` : plural(n, 'mark');
        selA.textContent = 'Delete';
        selArchive.hidden = false;
        // While a build runs: queue them for after it, or steer it with them.
        const busy = Boolean(runningBuild());
        selB.textContent = 'Build these';
        selB.setAttribute('aria-disabled', String(built === n));
        selSteer.hidden = !busy || built === n;
        sel.dataset.kind = 'marks';
      } else {
        // Parts of the app: no bar. The box to write in comes up under them
        // (agent-marks.js prompt), once for each new selection.
        sel.hidden = true;
        const key = detail.parts.join(' ');
        if (key !== promptedFor) {
          promptedFor = key;
          M.prompt(detail.parts, detail.span);
        }
        return;
      }
      sel.hidden = false;
      const s = sel.getBoundingClientRect();
      const floor = M.bar.getBoundingClientRect().top - 10;
      const span = detail.span;
      let top = span.top + span.height + 16;
      if (top + s.height > floor) top = span.top - s.height - 16;
      if (top < 8) top = Math.min(floor - s.height, span.top + 16);
      const left = Math.min(Math.max(12, span.left + span.width / 2 - s.width / 2), innerWidth - s.width - 12);
      Object.assign(sel.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
    });
    selA.addEventListener('click', () => {
      M.remove(selNow.marks);
      M.clearPicked();
    });
    selArchive.addEventListener('click', () => {
      const ids = [...selNow.marks];
      M.clearPicked();
      archive(ids, true);
    });
    selB.addEventListener('click', async () => {
      if (selB.getAttribute('aria-disabled') === 'true') return;
      start({ marks: selNow.marks });
    });
    selSteer.addEventListener('click', () => start({ marks: [...selNow.marks], steer: true }));
    // Save as piece, from the box written on a selection.
    addEventListener('marble-marks:save-piece', async (event) => {
      const parts = event.detail?.ids ?? [];
      let saved = 0;
      for (const id of parts.slice(0, 6)) {
        const piece = await ask('POST', '/agent/pieces', { path: app, id }).catch(() => null);
        if (piece) saved += 1;
      }
      say(saved ? `Saved as ${plural(saved, 'piece')}. Find ${saved === 1 ? 'it' : 'them'} in Pieces.` : 'That part could not be saved.');
      piecesCache = null;
      if (piecesOpen) drawPieces();
    });

    // -------------------------------------------------------------- comments

    /** A comment's lines, as the floating thread and the margin's card both
     *  draw them: yours, and the app's, signed with its name and its tile. An
     *  answer that offers a change carries Build that and Not now. */
    const tileOf = () => (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? '·').toUpperCase();
    function drawLines(box, kept) {
      // A question and its answer, not a chat: what you asked, slanted and
      // faded; what the app says, plain under it. No faces and no names.
      for (const line of kept?.thread ?? []) {
        const row = h('div', 'marble-build-line');
        row.dataset.who = line.who;
        row.setAttribute('aria-label', line.who === 'agent' ? `${name} answers` : 'You asked');
        if (line.images?.length) {
          const pics = h('div', 'pics');
          for (const image of line.images) {
            const img = h('img');
            img.alt = 'A pasted picture';
            img.loading = 'lazy';
            img.src = `/agent/builds/image?name=${enc(image.name)}`;
            pics.append(img);
          }
          row.append(pics);
        }
        if (line.pending) {
          const dots = h('span', 'marble-build-dots');
          dots.setAttribute('role', 'status');
          dots.setAttribute('aria-label', `${name} is answering`);
          dots.append(h('i'), h('i'), h('i'));
          row.append(dots);
        } else row.append(h('p', '', line.text));
        if (line.offer) {
          if (line.offer.taken === null) {
            const acts = h('div', 'acts');
            const yes = h('button', 'marble-build-btn primary', 'Build that');
            yes.type = 'button';
            yes.addEventListener('click', (event) => { event.stopPropagation(); takeOffer(kept.id, true); });
            const no = h('button', 'marble-build-btn quiet', 'Not now');
            no.type = 'button';
            no.addEventListener('click', (event) => { event.stopPropagation(); takeOffer(kept.id, false); });
            acts.append(yes, no);
            row.append(acts);
          } else {
            row.append(h('div', 'done', line.offer.taken ? 'Added to the next build as a note.' : 'Left as it is.'));
          }
        }
        box.append(row);
      }
    }
    const takeOffer = (id, take) => settled(ask('POST', route('/offer'), { id, take }));
    /** The box a reply is written in, as a note is: words, pictures pasted
     *  in, and Send (⌘↵). `onSend({ text, images })`. */
    const composer = ({ placeholder = 'Reply', label = 'Reply', onSend, onEscape = null } = {}) => {
      const node = h('div', 'marble-build-write');
      const field = h('div', 'field');
      field.contentEditable = 'plaintext-only';
      if (field.contentEditable !== 'plaintext-only') field.contentEditable = 'true';
      field.setAttribute('role', 'textbox');
      field.setAttribute('aria-multiline', 'true');
      field.setAttribute('aria-label', label);
      field.dataset.placeholder = placeholder;
      const pics = h('div', 'pics');
      const act = h('div', 'act');
      act.append(h('span', 'sp'));
      const send = h('button', 'marble-build-send');
      send.type = 'button';
      send.innerHTML = `${M.sendGlyph ?? ICON.send}<kbd>${M.MOD ?? '⌘'}↵</kbd>`;
      send.setAttribute('aria-label', 'Send');
      send.title = 'Send';
      act.append(send);
      node.append(field, pics, act);
      let images = [];
      let busy = 0;
      const text = () => field.innerText.replace(/\n+$/, '').trim();
      const paint = () => send.setAttribute('aria-disabled', String((!text() && !images.length) || busy > 0));
      const drawPics = () => {
        pics.replaceChildren(...images.map((image) => {
          const pic = h('span', 'pic');
          pic.toggleAttribute('data-loading', !image.name);
          const img = h('img');
          img.alt = 'A pasted picture';
          img.src = image.preview ?? `/agent/builds/image?name=${enc(image.name)}`;
          const x = h('button', '', '×');
          x.type = 'button';
          x.setAttribute('aria-label', 'Take this picture off');
          x.addEventListener('click', () => { images = images.filter((one) => one !== image); drawPics(); paint(); });
          pic.append(img, x);
          return pic;
        }));
      };
      field.addEventListener('paste', (event) => {
        const data = event.clipboardData;
        if (!data) return;
        const files = [...(data.files ?? [])].filter((file) => file.type.startsWith('image/'));
        event.preventDefault();
        if (files.length && M.keepPicture) {
          for (const file of files.slice(0, 6)) {
            const image = { name: null, preview: URL.createObjectURL(file) };
            images.push(image);
            busy += 1;
            M.keepPicture(file).then((kept) => Object.assign(image, kept)).catch(() => { images = images.filter((one) => one !== image); })
              .finally(() => { busy -= 1; drawPics(); paint(); });
          }
          drawPics();
          paint();
          return;
        }
        const words = data.getData('text/plain');
        if (words) document.execCommand('insertText', false, words);
      });
      const go = () => {
        if (send.getAttribute('aria-disabled') === 'true') return;
        const said = { text: text(), images: images.filter((image) => image.name).map(({ name, w, h: hh }) => ({ name, w, h: hh })) };
        field.textContent = '';
        images = [];
        drawPics();
        paint();
        onSend?.(said);
      };
      field.addEventListener('input', paint);
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); go(); }
        if (event.key === 'Escape' && onEscape) { event.preventDefault(); event.stopPropagation(); onEscape(); }
      });
      send.addEventListener('pointerdown', (event) => event.preventDefault());
      send.addEventListener('click', (event) => { event.stopPropagation(); go(); });
      node.addEventListener('click', (event) => event.stopPropagation());
      paint();
      return {
        node,
        focus: () => field.focus({ preventScroll: true }),
        get typing() { return Boolean(text() || images.length); },
        clear: () => { field.textContent = ''; images = []; drawPics(); paint(); },
      };
    };
    /** A note sent (⌘↵): the host makes it a comment, answered or built, and
     *  that comment's thread opens where the note was. */
    M.onSend(async (mark) => {
      await flushing;
      flush();
      await flushing;
      const got = await settled(ask('POST', route('/send'), { id: mark.id }));
      if (!got?.comment) { M.elementOf(mark.id)?.removeAttribute('data-sending'); M.load(state?.marks ?? []); return; }
      requestAnimationFrame(() => dispatchEvent(new CustomEvent('marble-marks:comment', { detail: { id: got.comment } })));
    });
    /** Put marks away, or bring them back: drawn at once, kept on the host,
     *  and undoable from the line over the toolbar. */
    const archive = (ids, on, { undo = true } = {}) => {
      const list = ids.filter((id) => (state?.marks ?? []).some((m) => m.id === id && m.state !== 'building'));
      if (!list.length) return Promise.resolve(null);
      M.setArchived(list, on);
      if (undo) {
        const n = list.length;
        M.offerUndo(on ? (n === 1 ? 'Archived' : `${n} marks archived`) : (n === 1 ? 'Back on the app' : `${n} marks back on the app`), () => archive(list, !on, { undo: false }));
      }
      return settled(ask('POST', route('/archive'), { ids: list, archived: Boolean(on) }));
    };
    const postComment = async (id, text, images = []) => {
      if (!(state?.marks ?? []).some((m) => m.id === id)) {
        // Its first line: the pin is kept now, then the words go in it.
        const mark = M.get(id);
        if (mark) await ask('PUT', route('/marks'), { mark }).catch(() => null);
        M.keepNow(id);
      }
      return settled(ask('POST', route('/comment'), { id, text, images }));
    };

    const thread = h('div', 'marble-build-thread');
    thread.setAttribute('role', 'dialog');
    thread.setAttribute('aria-label', 'Comment');
    thread.hidden = true;
    layer.append(thread);
    let threadFor = null;
    let threadWrite = null; // the thread's reply box (composer), for threadFor
    let leaving = 0;
    const closeThread = ({ posting = false } = {}) => {
      if (!threadFor) return;
      const id = threadFor;
      threadFor = null;
      // It folds into its pin, the way it came out of it.
      const pin = M.elementOf(id)?.getBoundingClientRect();
      const box = thread.getBoundingClientRect();
      if (pin?.width && box.width && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        thread.style.setProperty('--thread-from', `${Math.round(pin.left + pin.width / 2 - box.left)}px ${Math.round(pin.top + pin.height / 2 - box.top)}px`);
        thread.setAttribute('data-leaving', '');
        clearTimeout(leaving);
        leaving = setTimeout(() => { if (!threadFor) thread.hidden = true; thread.removeAttribute('data-leaving'); }, 230);
      } else thread.hidden = true;
      M.closeComments();
      // A pin with nothing said in it was a slip of the hand.
      const mark = M.get(id);
      if (!posting && mark && !(state?.marks ?? []).some((m) => m.id === id)) M.dropDraft(id);
    };
    const placeThread = () => {
      if (!threadFor) return;
      const pin = M.elementOf(threadFor)?.getBoundingClientRect();
      if (!pin?.width) { thread.hidden = true; return; }
      thread.hidden = false;
      const t = thread.getBoundingClientRect();
      let left = pin.right + 10;
      if (left + t.width > innerWidth - 12) left = pin.left - t.width - 10;
      left = Math.min(Math.max(12, left), innerWidth - t.width - 12);
      const top = Math.min(Math.max(12, pin.top - 6), innerHeight - t.height - 12);
      Object.assign(thread.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
    };
    const drawThread = ({ focus = false } = {}) => {
      if (!threadFor) return;
      const kept = (state?.marks ?? []).find((m) => m.id === threadFor);
      const lines = kept?.thread ?? [];
      // One box for the thread, kept across redraws, so what is half written
      // (and pasted) survives them.
      const writing = threadWrite?.node.contains(document.activeElement);
      thread.replaceChildren();
      const top = h('div', 'top');
      if (kept) {
        const del = h('button', 'marble-build-x');
        del.type = 'button';
        del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';
        del.setAttribute('aria-label', 'Delete this comment');
        del.title = '';
        del.addEventListener('click', () => { const id = threadFor; closeThread(); M.remove([id]); });
        top.append(del);
      }
      const close = h('button', 'marble-build-x');
      close.type = 'button';
      close.innerHTML = ICON.close;
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', () => closeThread());
      top.append(close);
      if (lines.length) thread.append(top);
      const box = h('div', 'lines');
      drawLines(box, kept);
      thread.append(box);
      if (!threadWrite || threadWrite.for !== threadFor) {
        const id = threadFor;
        threadWrite = composer({
          placeholder: lines.length ? 'Ask more, or say what to change' : 'Ask, or say what to change',
          label: 'Reply',
          onEscape: () => closeThread(),
          onSend: async ({ text, images }) => {
            if (!threadFor) return;
            // With Marks open the box that wrote it folds into its pin now,
            // and the comment is read in its card.
            if (side === 'comments') closeThread({ posting: true });
            await postComment(id, text, images);
            if (side === 'comments') dispatchEvent(new CustomEvent('marble-build:pick', { detail: { id } }));
          },
        });
        threadWrite.for = id;
      }
      const compose = threadWrite.node;
      if (writing) requestAnimationFrame(() => threadWrite.focus());
      thread.append(compose);
      thread.hidden = false;
      placeThread();
      if (focus) {
        // After the press that made the pin has let go: the release would
        // otherwise take the caret back to the page.
        const put = () => { if (compose.isConnected) threadWrite.focus(); };
        put();
        addEventListener('pointerup', () => setTimeout(put, 0), { once: true, capture: true });
        setTimeout(put, 120);
      }
    };
    addEventListener('marble-marks:comment', (event) => {
      const id = event.detail?.id;
      if (!id) return;
      if (threadFor && threadFor !== id) closeThread();
      clearTimeout(leaving);
      thread.removeAttribute('data-leaving');
      thread.style.removeProperty('--thread-w');
      threadFor = id;
      drawThread({ focus: true });
    });
    addEventListener('pointerdown', (event) => {
      if (!threadFor) return;
      const path = event.composedPath();
      if (path.includes(thread) || path.includes(M.elementOf(threadFor))) return;
      closeThread();
    }, true);

    // The line the work itself says (agent-work.js), for the build's turns.
    addEventListener('marble-work:line', (event) => {
      const d = event.detail;
      if (!d?.conversation || d.conversation !== runningBuild()?.conversation) return;
      workLine = d.say ? { say: d.say, at: Date.now() } : null;
      paintBar();
    });

    // ------------------------------------------------- following a build
    //
    // The page attends the running build's conversation, so the change marks
    // its turn draws are drawn here. What it reads and changes is kept with
    // the build on the host (server/build/steps.js) and shown in its status,
    // never floated over the app.

    const following = new Set(); // turn ids attended
    const follow = () => {
      for (const b of builds()) {
        if (b.status !== 'running' || !b.turn || !b.conversation || following.has(b.turn)) continue;
        following.add(b.turn);
        agent.attend(b.conversation);
      }
    };

    // -------------------------------------------------------------- lit
    //
    // What a step or a History entry changed, lit on the app while a hand is
    // on it, or held by a press (and then brought into view).
    const lit = [];
    let litIds = [];
    let litHeld = false;
    const placeLit = () => {
      let i = 0;
      // Not over the sidebar: a part under it (a sheet on a phone, a floating
      // card) is not lit through it.
      const side = drawer?.isOpen ? drawer.shadowRoot?.querySelector('.panel')?.getBoundingClientRect() : null;
      const under = (r) => side && r.left + r.width / 2 >= side.left && r.top + r.height / 2 >= side.top && r.top + r.height / 2 <= side.bottom;
      for (const id of litIds) {
        const node = document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`);
        const r = node?.getBoundingClientRect();
        if (!r?.width || !r.height || node === document.body || under(r)) continue;
        let box = lit[i];
        if (!box) { box = h('div', 'marble-build-lit'); lit.push(box); layer.append(box); }
        box.hidden = false;
        Object.assign(box.style, { left: `${Math.round(r.left - 3)}px`, top: `${Math.round(r.top - 3)}px`, width: `${Math.round(r.width + 6)}px`, height: `${Math.round(r.height + 6)}px` });
        i += 1;
      }
      for (; i < lit.length; i += 1) lit[i].hidden = true;
    };
    /** Light these parts; `hold` keeps them lit past the hand leaving, and
     *  brings the first into view. */
    const light = (ids, { hold = false } = {}) => {
      // The outermost of what changed is enough: a part and its words are one
      // thing to the eye.
      const nodes = (ids ?? []).map((id) => document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`)).filter(Boolean);
      const outer = nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
      litIds = outer.slice(0, 40).map((node) => node.getAttribute('data-marble-id'));
      litHeld = hold;
      placeLit();
      if (hold && outer[0]) {
        const r = outer[0].getBoundingClientRect();
        if (r.top < 60 || r.bottom > innerHeight - 90) outer[0].scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
      return litIds.length;
    };
    const unlight = ({ held = false } = {}) => {
      if (litHeld && !held) return;
      litIds = [];
      litHeld = false;
      placeLit();
    };
    // A press anywhere else lets go of what a press lit.
    addEventListener('pointerdown', (event) => {
      if (!litHeld) return;
      if (event.composedPath().some((node) => node?.dataset?.lights)) return;
      unlight({ held: true });
    }, true);

    // ------------------------------------------------------------ status
    //
    // A build's status in three layers (spec: Notes and Sketches/Build Mode
    // and Asking/Build Mode, section 12): its picture, the drawer's drawing of
    // the work; pressed, its stages, the plan's parts; a stage pressed, what
    // was read, searched for and changed in it, kept on the host with the
    // build (server/build/steps.js). A changed step lights what it touched.
    const STEP_ICON = {
      read: ICON.read,
      look: ICON.read,
      search: ICON.search,
      change: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 18.5 9.5 9 19H5v-4z"/><path d="M12.5 7.5l4 4"/></svg>',
    };
    const CHEV = '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.25 4 10.25 8l-4 4"/></svg>';
    const statusLine = (b) => {
      const parts = b.plan?.parts ?? [];
      const done = parts.filter((p) => p.state === 'done').length;
      if (b.status === 'running') return parts.length ? `Build ${b.n} · ${done} of ${parts.length} parts made` : `Build ${b.n} · working out the plan`;
      if (b.status === 'paused') return parts.length ? `Build ${b.n} · paused at ${done} of ${parts.length} parts` : `Build ${b.n} · paused`;
      if (b.status === 'finished') return `${parts.length ? `Build ${b.n} · ${plural(parts.length, 'part')} made` : `Build ${b.n} · done`}${b.summing && !b.summary ? ' · summing it up' : ''}`;
      if (b.status === 'stopped') return `Build ${b.n} · stopped, the app went back`;
      if (b.status === 'failed') return `Build ${b.n} · did not finish`;
      return `Build ${b.n}`;
    };
    /** The status of one build: `card.update(build, log)` as it changes. What
     *  is open stays open between updates. */
    const statusCard = () => {
      const node = h('section', 'marble-bst');
      const top = h('button', 'bst-top');
      top.type = 'button';
      top.setAttribute('aria-expanded', 'false');
      const head = h('div', 'bst-head');
      const title = h('b');
      const time = h('time');
      head.append(title, time);
      const sub = h('div', 'bst-sub');
      const subWords = h('span');
      sub.append(subWords);
      sub.insertAdjacentHTML('beforeend', CHEV);
      const pic = h('div', 'bst-pic');
      pic.setAttribute('aria-hidden', 'true');
      top.append(head, sub, pic);
      const stages = h('ol', 'bst-stages');
      stages.setAttribute('aria-label', 'Stages');
      // What is said to the build, and its answers, over a box to say more:
      // a question is answered here; a change is made (talk(), on the host).
      const talk = h('div', 'bst-talk');
      const said = h('div', 'bst-lines');
      talk.append(said);
      node.append(top, stages, talk);
      let write = null;
      let saidKey = '';
      const openStages = new Set();
      let build = null;
      let log = [];
      let picAt = null;
      let ticker = 0;
      let changedIds = [];
      // An ended build lights everything it changed while a hand is on it.
      top.addEventListener('pointerenter', () => { if (top.dataset.lights) light(changedIds); });
      top.addEventListener('pointerleave', () => { if (top.dataset.lights) unlight(); });
      top.addEventListener('click', () => {
        const on = !node.hasAttribute('data-open');
        node.toggleAttribute('data-open', on);
        top.setAttribute('aria-expanded', String(on));
        if (on) drawStages();
      });
      const tick = () => {
        clearInterval(ticker);
        if (!build) return;
        const paint = () => { time.textContent = clock((build.endedAt ?? Date.now()) - build.startedAt); };
        paint();
        if (build.status === 'running') ticker = setInterval(() => { if (!node.isConnected) { clearInterval(ticker); return; } paint(); }, 1000);
      };
      function drawStages() {
        if (!node.hasAttribute('data-open') || !build) return;
        const parts = build.plan?.parts ?? [];
        const groups = new Map();
        const planning = log.filter((step) => !step.part || !parts.some((p) => p.title === step.part));
        if (planning.length || !parts.length) groups.set('', { title: parts.length ? 'Working out the plan' : (build.status === 'running' ? 'Working out the plan' : 'Its work'), detail: '', state: parts.length ? 'done' : build.status === 'running' ? 'now' : 'done', steps: planning });
        for (const part of parts) groups.set(part.title, { title: part.title, detail: part.detail ?? '', state: part.state, ids: part.ids ?? [], steps: log.filter((step) => step.part === part.title) });
        const rows = [];
        for (const [key, group] of groups) {
          const li = h('li', 'bst-stage');
          li.dataset.state = group.state;
          const press = h('button');
          press.type = 'button';
          const st = h('span', 'bst-st');
          st.append(h('span', '', group.title));
          if (group.detail) st.append(h('small', '', group.detail));
          press.append(h('i', 'bst-dot'), st, h('span', 'bst-n', group.steps.length ? String(group.steps.length) : ''));
          const has = group.steps.length > 0;
          press.setAttribute('aria-disabled', String(!has));
          press.setAttribute('aria-expanded', String(openStages.has(key)));
          li.toggleAttribute('data-open', has && openStages.has(key));
          if (has) {
            press.addEventListener('click', () => {
              if (openStages.has(key)) openStages.delete(key); else openStages.add(key);
              drawStages();
            });
          }
          // The part's own place on the app, when the plan named it.
          if (group.ids?.length) {
            press.dataset.lights = '1';
            press.addEventListener('pointerenter', () => light(group.ids));
            press.addEventListener('pointerleave', () => unlight());
          }
          li.append(press);
          if (has && openStages.has(key)) {
            const steps = h('ul', 'bst-steps');
            for (const step of group.steps) {
              const row = h('li', 'bst-step');
              row.dataset.kind = step.kind;
              row.toggleAttribute('data-failed', Boolean(step.failed));
              row.insertAdjacentHTML('afterbegin', STEP_ICON[step.kind] ?? ICON.read);
              const body = h('div');
              body.append(h('b', '', step.head));
              if (step.path) body.append(h('code', '', step.path));
              for (const line of (step.lines ?? []).slice(0, 2)) body.append(h('p', '', line));
              row.append(body);
              if (step.ids?.length) {
                row.dataset.ids = '1';
                row.dataset.lights = '1';
                row.title = 'Light what this changed on the app';
                row.addEventListener('pointerenter', () => light(step.ids));
                row.addEventListener('pointerleave', () => unlight());
                row.addEventListener('click', () => light(step.ids, { hold: true }));
              }
              steps.append(row);
            }
            li.append(steps);
          }
          rows.push(li);
        }
        if (build.said) rows.push(h('li', 'bst-said', build.said));
        if (!rows.length) rows.push(h('li', 'bst-none', 'Nothing yet.'));
        stages.replaceChildren(...rows);
      }
      return {
        node,
        id: () => build?.id ?? null,
        update(next, nextLog = null) {
          const changed = !build || build.id !== next.id;
          build = next;
          if (nextLog) log = nextLog;
          else if (next.log) log = next.log;
          else if (changed) log = [];
          node.dataset.status = next.status;
          node.setAttribute('aria-label', `Build ${next.n}`);
          title.textContent = next.title || `Build ${next.n}`;
          subWords.textContent = statusLine(next);
          // Once it has ended, its summary takes the picture's place.
          const drawing = next.summary ?? next.drawn;
          node.toggleAttribute('data-summary', Boolean(next.summary));
          changedIds = [...new Set(log.filter((step) => step.kind === 'change').flatMap((step) => step.ids ?? []))];
          const ended = next.status !== 'running' && next.status !== 'paused';
          top.title = ended && changedIds.length ? 'Light what this build changed' : '';
          if (ended && changedIds.length) top.dataset.lights = '1'; else delete top.dataset.lights;
          if (drawing?.html && drawing.at !== picAt) { picAt = drawing.at; mountDrawn(pic, drawing.html); }
          if (!drawing?.html && changed) { pic.textContent = ''; picAt = null; }
          const lines = next.thread ?? [];
          const key = JSON.stringify(lines);
          if (key !== saidKey) { saidKey = key; said.replaceChildren(); drawLines(said, { id: next.id, thread: lines }); }
          const live = next.status === 'running';
          if (!write) {
            write = composer({
              placeholder: '',
              label: `Reply to build ${next.n}`,
              onSend: ({ text, images }) => settled(ask('POST', route(`/${enc(build.id)}/reply`), { text, images })),
            });
            talk.append(write.node);
          }
          const field = write.node.querySelector('.field');
          if (field) field.dataset.placeholder = live ? 'Ask about it, or steer it' : 'Ask about it, or say what to change';
          tick();
          drawStages();
        },
        open(on = true) { node.toggleAttribute('data-open', on); top.setAttribute('aria-expanded', String(on)); drawStages(); },
      };
    };

    // The status mark's peek: on a rest over it, the latest build's picture,
    // or what the mark says when no build has drawn one.
    const peek = h('div', 'marble-build-peek');
    peek.setAttribute('role', 'tooltip');
    peek.hidden = true;
    const peekHead = h('b');
    const peekSub = h('span');
    const peekPic = h('div', 'pic');
    peek.append(peekHead, peekSub, peekPic);
    layer.append(peek);
    let peekAt = null;
    let peekTimer = 0;
    const showPeek = () => {
      const now = current();
      const b = now ?? builds().at(-1) ?? null;
      peekHead.textContent = b ? (b.title || `Build ${b.n}`) : 'No build yet';
      peekSub.textContent = now ? statusLine(now) : status.getAttribute('aria-label') ?? '';
      const drawing = b?.summary ?? b?.drawn ?? null;
      if (drawing?.html && drawing.at !== peekAt) { peekAt = drawing.at; mountDrawn(peekPic, drawing.html).then(placePeek); }
      if (!drawing?.html) { peekPic.textContent = ''; peekAt = null; }
      peek.hidden = false;
      placePeek();
    };
    function placePeek() {
      if (peek.hidden) return;
      const r = status.getBoundingClientRect();
      const t = peek.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
      Object.assign(peek.style, { left: `${Math.round(left)}px`, top: `${Math.round(Math.max(8, r.top - t.height - 10))}px` });
    }
    status.addEventListener('pointerenter', () => { if (matchMedia('(hover: hover)').matches) { clearTimeout(peekTimer); peekTimer = setTimeout(showPeek, 280); } });
    status.addEventListener('pointerleave', () => { clearTimeout(peekTimer); peek.hidden = true; });
    status.addEventListener('pointerdown', () => { clearTimeout(peekTimer); peek.hidden = true; });
    status.addEventListener('focus', () => { if (status.matches(':focus-visible')) showPeek(); });
    status.addEventListener('blur', () => { peek.hidden = true; });

    // ------------------------------------------------------------- Pieces

    const pieces = h('aside', 'marble-build-pieces');
    pieces.setAttribute('aria-label', 'Pieces');
    pieces.hidden = true;
    let piecesOpen = false;
    let piecesCache = null;
    let suggested = null;
    let suggestedFor = null;
    let kind = 'all';
    let findWords = '';
    const piecesHead = h('div', 'head');
    piecesHead.append(h('b', '', 'Pieces'));
    const piecesClose = h('button', 'marble-build-x');
    piecesClose.type = 'button';
    piecesClose.innerHTML = ICON.close;
    piecesClose.setAttribute('aria-label', 'Close Pieces');
    piecesClose.addEventListener('click', () => setSide('none'));
    addView('pieces', pieces);
    piecesHead.append(piecesClose);
    const find = h('label', 'marble-build-find');
    find.innerHTML = ICON.search;
    const findInput = h('input');
    findInput.type = 'search';
    findInput.placeholder = 'Find a piece';
    findInput.setAttribute('aria-label', 'Find a piece');
    find.append(findInput);
    findInput.addEventListener('input', () => { findWords = findInput.value.trim().toLowerCase(); drawPieces(); });
    const kinds = h('div', 'marble-build-kinds');
    kinds.setAttribute('role', 'group');
    kinds.setAttribute('aria-label', 'Kinds of piece');
    for (const [id, label] of KINDS) {
      const b = h('button', '', label);
      b.type = 'button';
      b.dataset.kind = id;
      b.setAttribute('aria-pressed', String(id === kind));
      b.addEventListener('click', () => {
        kind = id;
        for (const other of kinds.children) other.setAttribute('aria-pressed', String(other.dataset.kind === kind));
        drawPieces();
      });
      kinds.append(b);
    }
    const gallery = h('div', 'marble-build-gallery');
    pieces.append(piecesHead, find, kinds, gallery);

    const inUse = () => new Set((state?.marks ?? []).filter((m) => m.type === 'piece' && m.state !== 'built').map((m) => m.piece?.id));
    const card = (piece, { saved = false } = {}) => {
      const node = h('div', 'marble-build-pc');
      node.dataset.k = String(piece.kind || '').toLowerCase();
      node.dataset.piece = piece.id;
      node.tabIndex = 0;
      node.toggleAttribute('data-in', inUse().has(piece.id));
      const pv = h('div', 'pv');
      const frame = h('iframe');
      frame.setAttribute('sandbox', '');
      frame.setAttribute('loading', 'lazy');
      frame.setAttribute('tabindex', '-1');
      frame.setAttribute('aria-hidden', 'true');
      frame.src = saved || piece.saved
        ? `/agent/pieces/preview?id=${enc(piece.id)}`
        : `/agent/pieces/preview?path=${enc(piece.source?.path ?? '')}&at=${enc(piece.source?.id ?? '')}`;
      pv.append(frame);
      node.append(pv, h('div', 'pn', piece.title));
      const from = piece.doc ?? piece.source?.path ?? '';
      node.append(h('div', 'pk', [piece.kind, from ? from.split('/').pop() : ''].filter(Boolean).join(' · ')));
      if (piece.line) node.append(h('div', 'pl', piece.line));
      const inc = h('button', 'inc', 'Incorporate');
      inc.type = 'button';
      inc.addEventListener('click', (event) => { event.stopPropagation(); incorporate(piece); });
      node.append(inc);
      if (saved) {
        const del = h('button', 'marble-build-x del');
        del.type = 'button';
        del.innerHTML = ICON.close;
        del.setAttribute('aria-label', `Remove ${piece.title} from your pieces`);
        del.addEventListener('click', async (event) => {
          event.stopPropagation();
          await ask('DELETE', `/agent/pieces/${enc(piece.id)}`).catch(() => null);
          piecesCache = null;
          drawPieces();
        });
        node.append(del);
      }
      node.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target === node) incorporate(piece); });
      node.addEventListener('pointerdown', (event) => dragPiece(event, piece, node));
      return node;
    };
    const matches = (piece) => {
      if (kind !== 'all' && String(piece.kind || '').toLowerCase() !== kind) return false;
      if (!findWords) return true;
      return [piece.title, piece.kind, piece.doc, piece.source?.path, piece.line].some((w) => String(w ?? '').toLowerCase().includes(findWords));
    };
    const section = (title, sub, list, options) => {
      const shown = list.filter(matches);
      if (!shown.length) return null;
      const wrap = h('section');
      const head = h('p', 'marble-build-sec', title);
      if (sub) head.append(h('span', '', sub));
      const grid = h('div', 'marble-build-grid');
      for (const piece of shown) grid.append(card(piece, options));
      wrap.append(head, grid);
      return wrap;
    };
    async function drawPieces() {
      if (!piecesOpen) return;
      if (!piecesCache) {
        gallery.replaceChildren(h('p', 'marble-build-empty', 'Looking through your apps…'));
        piecesCache = await ask('GET', `/agent/pieces?path=${enc(app)}`).catch(() => ({ saved: [], drive: [] }));
      }
      const parts = [];
      if (suggested === null || suggestedFor !== state?.rev) {
        // Once per version of the app: the agent's picks, each with a reason.
        if (suggested === null) {
          parts.push(h('p', 'marble-build-sec', 'Suggested'), h('p', 'marble-build-empty', 'Finding pieces for this app…'));
        }
        suggestedFor = state?.rev;
        ask('GET', `/agent/pieces/suggested?path=${enc(app)}`).then((got) => {
          suggested = got.suggested ?? [];
          drawPieces();
        }).catch(() => { suggested = []; });
      }
      const sug = suggested?.length ? section('Suggested', `for ${name}`, suggested, {}) : null;
      const saved = section('Saved', 'by you', piecesCache.saved ?? [], { saved: true });
      const drive = section('In your drive', '', piecesCache.drive ?? [], {});
      gallery.replaceChildren(...[sug, ...(sug ? [] : parts), saved, drive].filter(Boolean));
      if (!gallery.childElementCount) {
        gallery.append(h('p', 'marble-build-empty', findWords || kind !== 'all'
          ? 'No piece matches that.'
          : 'No pieces yet. Select a part of any app and choose Save as piece.'));
      }
    }
    const incorporate = (piece) => {
      M.piece(piece);
      markInUse();
    };
    /** A piece already on the app, and not built in yet, is faint in the
     *  gallery: putting it on twice is rarely meant. */
    const markInUse = () => {
      const used = inUse();
      for (const node of gallery.querySelectorAll('.marble-build-pc')) node.toggleAttribute('data-in', used.has(node.dataset.piece));
    };
    // ------------------------------------------------------- the right side
    //
    // Marks (build-margin.js), Pieces and History are views of the chat's
    // own sidebar (agent-ui.js addView): the same edge, width, resize, pinned
    // or floating card, and motion as the chat, and one of them at a time,
    // the chat among them. Which is showing is the drawer's; the side named
    // here is read from it, and the last one shown is kept per app in this
    // browser and shown again on the next visit.
    const VIEW_OF = { comments: 'marks', pieces: 'pieces', history: 'history' };
    const SIDE_OF = { marks: 'comments', pieces: 'pieces', history: 'history' };
    const SIDE_KEY = `marble-build:side:${app}`;
    let side = 'none';
    let restored = false;
    const frameHidden = false;
    const readSide = () => (drawer?.isOpen ? SIDE_OF[drawer.viewName] ?? 'none' : 'none');
    function syncSide() {
      const was = side;
      side = readSide();
      piecesOpen = side === 'pieces';
      M.setMargin?.(side === 'comments');
      // Kept once the view this app had has been read back, not before: the
      // sidebar opening on the chat at load is not a choice.
      if (restored && drawer?.isOpen) { try { localStorage.setItem(SIDE_KEY, side); } catch { /* private mode */ } }
      if (side === was) return;
      // The marks are read beside the app while Describe is on.
      if (side === 'comments' && !M.describing) M.setDescribing(true);
      if (piecesOpen) { piecesCache = null; drawPieces(); }
      dispatchEvent(new CustomEvent('marble-build:side', { detail: { side, hidden: false } }));
    }
    addEventListener('marble-agent:view', syncSide);
    /** Show a side, or put the sidebar away ('none'). */
    function setSide(next) {
      const view = VIEW_OF[next];
      if (!drawer) return;
      if (!view) { if (side !== 'none') drawer.close(); return; }
      drawer.showView(view);
      if (!drawer.isOpen) drawer.open();
      syncSide();
    }
    /** A button's press: shows its side, or puts it away when it is showing. */
    const toggleSide = (which) => { drawer?.toggleView(VIEW_OF[which]); syncSide(); };
    addEventListener('marble-build:toggle-pieces', () => toggleSide('pieces'));
    addEventListener('marble-build:toggle-comments', () => toggleSide('comments'));
    addEventListener('marble-build:toggle-history', () => toggleSide('history'));
    /** The view this app had last time, in the sidebar, out or not. */
    const restoreSide = () => {
      // Marks, headed by the build's status, unless another view was left.
      let kept = 'comments';
      try { kept = localStorage.getItem(SIDE_KEY) ?? 'comments'; } catch { /* private mode */ }
      if (kept === 'comments' && !M.describing) kept = 'none';
      if (VIEW_OF[kept] && drawer) drawer.showView(VIEW_OF[kept]);
      restored = true;
      syncSide();
      dispatchEvent(new CustomEvent('marble-build:side', { detail: { side, hidden: false } }));
    };

    /** A piece pulled out of the gallery and dropped where it should go. */
    const dragPiece = (event, piece, node) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const x0 = event.clientX;
      const y0 = event.clientY;
      let ghost = null;
      const move = (e) => {
        if (!ghost && Math.hypot(e.clientX - x0, e.clientY - y0) < 6) return;
        if (!ghost) {
          ghost = node.cloneNode(true);
          ghost.classList.add('marble-build-ghost');
          ghost.removeAttribute('tabindex');
          layer.append(ghost);
        }
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
      };
      const up = (e) => {
        removeEventListener('pointermove', move, true);
        removeEventListener('pointerup', up, true);
        if (!ghost) return;
        ghost.remove();
        const r = pieces.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) { M.piece(piece, { x: e.clientX - 40, y: e.clientY - 12 }); markInUse(); }
      };
      addEventListener('pointermove', move, true);
      addEventListener('pointerup', up, true);
    };

    // ------------------------------------------------------ out of Describe

    const launcherRect = () => {
      const root = document.querySelector('marble-agent-drawer')?.shadowRoot;
      const button = root?.querySelector('.launcher') ?? root?.querySelector('.tray');
      const r = button?.getBoundingClientRect();
      return r?.width ? r : null;
    };
    const placeHandle = () => {
      // Beside the chat's own button, in the corner, where the toolbar went.
      const t = launcherRect();
      const right = t ? innerWidth - t.left + 10 : 20;
      handle.style.right = `${Math.round(right)}px`;
      if (t) handle.style.bottom = `${Math.round(innerHeight - t.bottom + (t.height - 44) / 2)}px`;
    };

    const paintDescribing = () => {
      const on = M.describing;
      handle.toggleAttribute('data-away', on);
      if (!on) { closePop(); closeThread(); sel.hidden = true; if (side === 'comments') { drawer?.showView('chat'); syncSide(); } }
      placeHandle();
    };
    addEventListener('marble-marks:describing', paintDescribing);

    // ---------------------------------------------------------- the shell

    const offerFolder = () => {
      const shell = window.marbleShell;
      if (!shell?.offer) return;
      if (state?.folder && !app.includes('/')) {
        shell.offer({
          lead: 'Not in a folder yet',
          action: `Move to ${state.folder}`,
          icon: ICON.folder,
          onAct: () => fileInto(state.folder),
          onDismiss: () => settled(ask('POST', route('/folder'), { dismiss: true })),
        });
      } else shell.offer(null);
    };

    // ------------------------------------------------------------- the state

    function apply(next) {
      if (!next || next.path !== app) return;
      // A request's answer can come after the stream has sent something
      // newer (a comment answered in the time its post took to return): the
      // older state is not put back over it.
      if (state && Number.isFinite(next.rev) && Number.isFinite(state.rev) && next.rev < state.rev) return;
      state = next;
      M.load(state.marks);
      M.setRunning(Boolean(runningBuild()));
      follow();
      paintBar();
      if (open) redrawPop();
      if (threadFor) drawThread();
      if (piecesOpen) markInUse();
      offerFolder();
      dispatchEvent(new CustomEvent('marble-build:state', { detail: { state } }));
    }

    // Keep everything that hangs on the page where it belongs.
    let framing = 0;
    const reframe = () => {
      if (framing) return;
      framing = requestAnimationFrame(() => {
        framing = 0;
        placeThread();
        placeHandle();
        placeLit();
        if (open) hangOver(open.node, open.button);
      });
    };
    addEventListener('scroll', reframe, true);
    addEventListener('resize', reframe);
    document.addEventListener('marble:ops', reframe);
    M.onChange(() => { paintBar(); });

    // ⌘⇧D from Use: the handle's key, already Describe's (agent-marks.js).
    // The marks layer is shown again on top whenever Describe comes back, so
    // this layer is raised after it.
    addEventListener('marble-marks:describing', () => raise());

    // -------------------------------------------------------------- arrival

    /** A new app, from New: the prompt is its first note, and the first build
     *  starts from it. Read once, then taken off the address. */
    const arrive = async () => {
      const m = /(?:^#|&)build=([^&]*)/.exec(location.hash);
      if (!m) return;
      const words = decodeURIComponent(m[1]).trim();
      history.replaceState(null, '', location.pathname + location.search);
      if (!words || (state?.marks ?? []).some((mark) => mark.first) || builds().length) return;
      // At the top of the app, toward its right, as a note on it.
      const main = document.querySelector('main[data-marble-id], [role="main"][data-marble-id]') ?? document.body;
      const r = main.getBoundingClientRect();
      const x = Math.max(r.left + 12, Math.min(r.right - 214, r.left + r.width * 0.68));
      M.note({ x, y: Math.max(r.top, 0) + 24, text: words, first: true });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await start();
    };

    ask('GET', route('')).then(async (first) => {
      apply(first);
      restoreSide();
      openStream();
      await arrive();
    }).catch((err) => console.warn('marble-build: the build state did not load', err));

    paintBar();
    paintDescribing();
    dispatchEvent(new CustomEvent('marble-build:ready'));
    window.marbleBuild = {
      start,
      state: () => state,
      pieces: (on) => (on == null ? toggleSide('pieces') : setSide(on ? 'pieces' : 'none')),
      /** What the margin (build-margin.js) builds on. */
      app,
      get name() { return name; },
      get side() { return side; },
      get sideHidden() { return frameHidden; },
      setSide,
      addView,
      drawer,
      drawLines,
      comment: postComment,
      takeOffer,
      hold: (id, held) => settled(ask('POST', route('/hold'), { id, held: Boolean(held) })),
      resolve: (id, resolved) => {
        // Resolved is put away, so it says so and can be undone the same way.
        if (resolved) M.offerUndo('Comment resolved', () => settled(ask('POST', route('/resolve'), { id, resolved: false })));
        M.setArchived([id], Boolean(resolved));
        return settled(ask('POST', route('/resolve'), { id, resolved: Boolean(resolved) }));
      },
      archive,
      mountDrawn,
      statusCard,
      composer,
      light,
      unlight,
      slide,
      growing,
      /** A tip that says more than a control's own words, after a rest. */
      tip: (node, words) => {
        node.dataset.tipText = words;
        node.addEventListener('pointerenter', () => showTip(node));
        node.addEventListener('pointerleave', hideTip);
        node.addEventListener('focus', () => { if (node.matches(':focus-visible')) showTip(node, true); });
        node.addEventListener('blur', hideTip);
        node.addEventListener('pointerdown', hideTip);
      },
      current,
      inHand,
      lastEnded,
      buildConversations,
      act,
      view,
      say,
    };
    return true;
  };

  const start = () => {
    if (boot()) return;
    addEventListener('marble-marks:ready', () => boot(), { once: true });
  };
  if (window.marbleMarks) start();
  else addEventListener('marble-marks:ready', () => boot(), { once: true });
})();
