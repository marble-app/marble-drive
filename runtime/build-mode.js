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
  const READS = new Set(['read_document', 'list_documents', 'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']);
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

  const STYLE = `
    .marble-build-layer {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0; background: none; overflow: visible;
      pointer-events: none; z-index: 2147483003;
      --b-ink: var(--ink, #111); --b-muted: var(--muted, #5a5a5a); --b-faint: var(--faint, #8a8a8a);
      --b-paper: var(--paper, #fafaf7); --b-paper-2: var(--paper-2, #f3f1ea); --b-paper-3: var(--paper-3, #eceae1);
      --b-card: var(--card, #fff); --b-line: var(--line, #e6e2d8);
      --b-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)));
      --b-accent: var(--accent, #9bb6cf); --b-accent-soft: var(--accent-soft, #f1f5f8);
      --b-caution: var(--caution, light-dark(#a07a2c, #d9b25e));
      --b-shadow: var(--shadow-lift, 0 2px 6px rgba(74,66,52,.07), 0 8px 18px rgba(74,66,52,.08));
      --b-ui: var(--ui, var(--ui-font, system-ui, -apple-system, "Segoe UI", sans-serif));
      font: 400 13px/1.4 var(--b-ui); color: var(--b-ink);
    }
    .marble-build-layer:popover-open { position: fixed; inset: 0; }
    .marble-build-layer button { font: inherit; color: inherit; }
    .marble-build-layer [hidden] { display: none !important; }

    /* ---- in the toolbar (inside agent-marks.js's bar; its styles are
       Describe's own, these are the build's additions). */
    .marble-build-status { color: var(--muted, #5a5a5a); }
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
      transition: background 120ms ${EASE}, opacity 120ms ${EASE};
    }
    .marble-build-go:hover { background: color-mix(in srgb, var(--ink, #111) 84%, var(--card, #fff)); }
    .marble-build-go:active { background: color-mix(in srgb, var(--ink, #111) 72%, var(--card, #fff)); }
    .marble-build-go:focus-visible { outline: 2px solid var(--accent-ink, #738698); outline-offset: 2px; }
    .marble-build-go[aria-disabled="true"] { opacity: .35; cursor: default; }
    .marble-build-go[aria-disabled="true"]:hover { background: var(--ink, #111); }
    .marble-build-go[hidden], .marble-build-run[hidden] { display: none; }
    /* While a build runs, Build becomes the build: the tag's words and meter,
       in its ink, with Pause and Stop beside them. Paused is caution. */
    .marble-build-run {
      --mark: var(--accent-ink, #738698);
      display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 2px 0 10px; margin: 0 2px; border-radius: 10px;
      background: color-mix(in srgb, var(--mark) 12%, var(--card, #fff)); color: color-mix(in srgb, var(--mark) 70%, var(--ink, #111));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mark) 30%, transparent);
      font: 500 11.5px/1 var(--ui, system-ui, sans-serif); white-space: nowrap;
    }
    .marble-build-run[data-run="paused"] { --mark: var(--caution, #a07a2c); }
    .marble-build-run .w { font-variant-numeric: tabular-nums; }
    .marble-build-run .w b { font-weight: 650; color: var(--mark); }
    .marble-build-meter { position: relative; flex: none; width: 40px; height: 4px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, var(--mark) 22%, transparent); }
    .marble-build-meter i { position: absolute; inset: 0 auto 0 0; width: var(--p, 0%); border-radius: 2px; background: var(--mark); transition: width 240ms ${EASE}; }
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
      position: fixed; pointer-events: auto; box-sizing: border-box; width: var(--thread-w, 300px); max-width: calc(100vw - 24px);
      border-radius: 12px; padding: 4px 0 8px; transform-origin: var(--thread-from, 0 0);
      transition: width 200ms ${EASE}, opacity 180ms ${EASE}, scale 220ms ${EASE};
      background: color-mix(in srgb, var(--b-card) 92%, transparent);
      -webkit-backdrop-filter: blur(24px) saturate(1.4); backdrop-filter: blur(24px) saturate(1.4);
      border: 1px solid var(--b-line); box-shadow: var(--b-shadow); font-size: 13px;
    }
    @starting-style { .marble-build-thread { opacity: 0; scale: .92; } }
    .marble-build-thread[data-leaving] { opacity: 0; scale: .12; pointer-events: none; }
    .marble-build-thread .lines { max-height: 300px; overflow: auto; }
    .marble-build-line { padding: 8px 12px 2px; }
    .marble-build-line .who { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--b-muted); margin-bottom: 2px; }
    .marble-build-line .who b { color: var(--b-ink); font-weight: 600; }
    .marble-build-line .av { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font: 600 9.5px/1 var(--b-ui); background: var(--b-paper-3); color: var(--b-ink); }
    /* The app answers in its own name, with its tile: a rounded square, where
       a person's is a circle. The agents that write it are never named. */
    .marble-build-line[data-who="agent"] .av { border-radius: 5px; background: var(--b-accent-soft); color: var(--b-mark); }
    .marble-build-line p { margin: 0; overflow-wrap: anywhere; }
    .marble-build-line .acts { display: flex; gap: 4px; padding-top: 6px; }
    .marble-build-line .done { color: var(--b-muted); font-size: 12px; padding-top: 4px; }
    .marble-build-dots { display: inline-flex; gap: 3px; padding: 4px 0; }
    .marble-build-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--b-mark); animation: marble-build-dot 1.2s ${EASE} infinite; }
    .marble-build-dots i:nth-child(2) { animation-delay: .15s; }
    .marble-build-dots i:nth-child(3) { animation-delay: .3s; }
    @keyframes marble-build-dot { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
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

    /* What the agent read, beside the part it feeds: the status card's shape
       with a head in the tag's ink. Once its part has landed it is drawn as
       what was there before: dashed, muted, its lines struck. */
    .marble-build-found {
      position: fixed; pointer-events: none; box-sizing: border-box; width: 250px; padding: 9px 11px 10px;
      background: var(--b-card); border-radius: 10px; box-shadow: 0 0 0 1px var(--b-line), var(--b-shadow);
      font: 400 12px/1.4 var(--b-ui);
      transition: opacity 340ms ${EASE}, translate 340ms ${EASE}, box-shadow 200ms ${EASE}, top 340ms ${EASE}, left 340ms ${EASE};
    }
    @starting-style { .marble-build-found { opacity: 0; translate: 0 3px; } }
    .marble-build-found .fh { display: flex; align-items: center; gap: 6px; color: color-mix(in srgb, var(--b-mark) 70%, var(--b-ink)); font: 500 11.5px/1.2 var(--b-ui); }
    .marble-build-found .fh svg { flex: none; width: 13px; height: 13px; color: var(--b-mark); }
    .marble-build-found .fh span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-build-found .fp { font: 11px var(--mono, ui-monospace, monospace); color: var(--b-muted); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-build-found ul { margin: 6px 0 0; padding: 0; list-style: none; }
    .marble-build-found li { padding: 3px 0; border-top: 1px solid var(--b-line); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-build-found li:first-child { border-top: 0; }
    .marble-build-found[data-used] { box-shadow: none; outline: 1px dashed color-mix(in srgb, var(--b-muted) 85%, transparent); outline-offset: -1px; background: color-mix(in srgb, var(--b-card) 82%, transparent); color: var(--b-muted); }
    .marble-build-found[data-used] li { text-decoration: line-through; text-decoration-color: var(--b-faint); }
    .marble-build-found[data-gone] { opacity: 0; translate: 0 3px; }

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
      position: fixed; top: var(--marble-shell-top, 0px); right: 0; bottom: 0; width: ${SIDE_W}px; max-width: 100vw;
      pointer-events: auto; display: flex; flex-direction: column; box-sizing: border-box;
      background: var(--b-paper); border-left: 1px solid var(--b-line);
      translate: 100% 0; transition: translate 340ms ${EASE};
    }
    /* In from the edge, and out the same way (slide(), below). */
    .marble-build-pieces[data-in] { translate: 0 0; }
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
      .marble-build-pieces { top: auto; left: 0; right: 0; width: auto; height: min(62vh, 520px); border-left: 0; border-top: 1px solid var(--b-line); border-radius: 16px 16px 0 0; box-shadow: var(--b-shadow); }
      .marble-build-pieces { translate: 0 100%; }
      .marble-build-pieces[data-in] { translate: 0 0; }
      .marble-build-thread { width: calc(100vw - 24px); }
    }
    @media (max-width: 520px) {
      .marble-build-go { padding: 0 10px; margin: 0 1px; }
      .marble-build-run { padding-left: 8px; gap: 3px; }
      .marble-build-run .marble-build-meter { display: none; }
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
          // The app was named, or filed: this tab goes where it went.
          stream.close();
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
    const buildsButton = h('button', 'marble-marks-tool');
    buildsButton.type = 'button';
    buildsButton.innerHTML = ICON.builds;
    buildsButton.setAttribute('aria-label', 'Builds');
    buildsButton.setAttribute('aria-haspopup', 'dialog');
    const piecesButton = h('button', 'marble-marks-tool');
    piecesButton.type = 'button';
    piecesButton.innerHTML = ICON.pieces;
    piecesButton.setAttribute('aria-label', 'Pieces');
    piecesButton.setAttribute('aria-pressed', 'false');
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
    M.slot.append(status, buildsButton, piecesButton, go, run);

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
    tipped(buildsButton, 'Builds · go back to any');
    tipped(piecesButton, 'Pieces from your other apps');
    tipped(stopButton, 'Stop · go back to the last finished build');

    // ---------------------------------------------------------- the reading

    const builds = () => state?.builds ?? [];
    const runningBuild = () => builds().find((b) => b.status === 'running') ?? null;
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
      // Build: what it will take; while a build runs, the build itself.
      const picked = M.picked();
      const chosen = picked.filter((id) => waiting().some((m) => m.id === id));
      go.textContent = chosen.length ? 'Build selection' : 'Build';
      const can = (chosen.length || n > 0) && !build;
      go.setAttribute('aria-disabled', String(!can));
      go.hidden = Boolean(build);
      run.hidden = !build;
      if (build) {
        run.dataset.run = build.status === 'paused' ? 'paused' : 'building';
        runWords.innerHTML = '';
        const verb = build.status === 'paused' ? 'Paused' : 'Building';
        if (of) {
          runWords.append(`${verb} `, h('b', '', String(done)), ` of ${of}`);
        } else runWords.append(build.status === 'paused' ? 'Paused' : 'Planning');
        meter.style.setProperty('--p', `${of ? Math.round((done / of) * 100) : 6}%`);
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

    const statusWord = (b) => {
      const { done, of } = progressOf(b);
      if (b.status === 'running') return of ? `Building ${done} of ${of}` : 'Building';
      if (b.status === 'paused') return of ? `Paused, ${done} of ${of}` : 'Paused';
      if (b.showing) return 'Showing';
      if (b.status === 'finished') return 'Finished';
      if (b.status === 'stopped') return of ? `Stopped at ${done} of ${of}` : 'Stopped';
      return 'Did not finish';
    };
    const drawBuilds = (node) => {
      node.setAttribute('aria-label', 'Builds');
      const head = h('div', 'ph');
      head.append(h('b', '', 'Builds'), h('span', '', builds().length ? 'Pick one to see the app as it was' : 'None yet'));
      node.append(head);
      const list = h('ol');
      const busy = Boolean(runningBuild());
      for (const b of [...builds()].reverse()) {
        const row = h('li', 'marble-build-row');
        row.dataset.status = b.status;
        row.toggleAttribute('data-showing', Boolean(b.showing) && b.status !== 'running');
        const pick = h('button', 'pick');
        pick.type = 'button';
        pick.append(h('span', 'n', `Build ${b.n}`), h('span', 's', statusWord(b)), h('span', 't', b.title));
        const canView = !busy && b.hasEnd && !b.showing;
        pick.setAttribute('aria-disabled', String(!canView));
        if (canView) pick.addEventListener('click', () => view(b.id));
        row.append(pick);
        if (b.status === 'paused' && !busy) {
          const acts = h('span', 'acts');
          const resume = h('button', '', 'Resume');
          resume.type = 'button';
          resume.addEventListener('click', () => act(b.id, 'resume'));
          const stop = h('button', '', 'Stop');
          stop.type = 'button';
          stop.addEventListener('click', () => act(b.id, 'stop'));
          acts.append(resume, stop);
          row.append(acts);
        }
        list.append(row);
        // The build being shown: the picture of its work, as it was drawn.
        if (row.hasAttribute('data-showing') && b.hasDrawn) {
          const box = h('div', 'marble-build-drawn');
          box.setAttribute('aria-hidden', 'true');
          list.append(box);
          (b.drawn ? Promise.resolve({ drawn: b.drawn }) : ask('GET', `/agent/builds/${enc(b.id)}/drawn?path=${enc(app)}`))
            .then((got) => { if (got?.drawn?.html) mountDrawn(box, got.drawn.html).then(() => open && hangOver(open.node, open.button)); })
            .catch(() => {});
        }
      }
      if (state?.origin) {
        const row = h('li', 'marble-build-row');
        row.toggleAttribute('data-showing', Boolean(state.origin.showing));
        const pick = h('button', 'pick');
        pick.type = 'button';
        const firstBuild = builds()[0];
        pick.append(
          h('span', 'n', firstBuild?.title === 'From your prompt' ? 'Your prompt' : 'Before build 1'),
          h('span', 's', state.origin.showing ? 'Showing' : ''),
          h('span', 't', firstBuild?.title === 'From your prompt' ? 'The empty app' : 'The app as it was'),
        );
        const canView = !busy && !state.origin.showing;
        pick.setAttribute('aria-disabled', String(!canView));
        if (canView) pick.addEventListener('click', () => view('origin'));
        row.append(pick);
        list.append(row);
      }
      node.append(list);
      node.append(h('p', 'foot', busy ? 'Wait for the build to finish, or stop it, to look at another.' : 'Stop always goes back to the last finished build.'));
    };

    // The status mark opens no card: it brings the margin out, headed by the
    // build while one is in hand, and puts it away when pressed again
    // (build-margin.js).
    status.addEventListener('click', () => {
      hideTip();
      const margin = window.marbleMargin;
      if (!margin?.toggle) return;
      margin.toggle();
    });
    buildsButton.addEventListener('click', () => openPop('builds', buildsButton, drawBuilds));

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

    const start = async ({ marks = null, words = '' } = {}) => {
      if (runningBuild()) return null;
      await flushing;
      flush();
      await flushing;
      const made = await settled(ask('POST', route('/start'), { marks, words }));
      if (made?.conversation) agent.attend(made.conversation);
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
    sel.append(selLabel, selA, selArchive, selB);
    layer.append(sel);
    let selNow = { marks: [], parts: [] };
    M.onPicked((detail) => {
      selNow = detail;
      paintBar();
      if (!detail.span || (!detail.marks.length && !detail.parts.length)) { sel.hidden = true; return; }
      if (detail.marks.length) {
        const n = detail.marks.length;
        const built = detail.marks.filter((id) => waiting().every((m) => m.id !== id)).length;
        selLabel.textContent = built === n ? `${plural(n, 'mark')}, built already` : plural(n, 'mark');
        selA.textContent = 'Delete';
        selArchive.hidden = false;
        selB.textContent = 'Build these';
        selB.setAttribute('aria-disabled', String(built === n || Boolean(current())));
        sel.dataset.kind = 'marks';
      } else {
        const n = detail.parts.length;
        selLabel.textContent = n === 1 ? 'This part of the app' : `${n} parts of the app`;
        selA.textContent = 'Note';
        selArchive.hidden = true;
        selB.textContent = 'Save as piece';
        selB.setAttribute('aria-disabled', 'false');
        sel.dataset.kind = 'parts';
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
      if (sel.dataset.kind === 'marks') { M.remove(selNow.marks); M.clearPicked(); return; }
      const part = selNow.parts[0];
      M.clearPicked();
      M.setMode(null);
      M.note({ anchorId: part, u: 1, v: 0 });
    });
    selArchive.addEventListener('click', () => {
      const ids = [...selNow.marks];
      M.clearPicked();
      archive(ids, true);
    });
    selB.addEventListener('click', async () => {
      if (selB.getAttribute('aria-disabled') === 'true') return;
      if (sel.dataset.kind === 'marks') { start({ marks: selNow.marks }); return; }
      const parts = selNow.parts;
      selB.setAttribute('aria-disabled', 'true');
      let saved = 0;
      for (const id of parts.slice(0, 6)) {
        const piece = await ask('POST', '/agent/pieces', { path: app, id }).catch(() => null);
        if (piece) saved += 1;
      }
      M.clearPicked();
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
      for (const line of kept?.thread ?? []) {
        const row = h('div', 'marble-build-line');
        row.dataset.who = line.who;
        const who = h('div', 'who');
        const av = h('span', 'av', line.who === 'agent' ? tileOf() : 'Y');
        av.setAttribute('aria-hidden', 'true');
        who.append(av, h('b', '', line.who === 'agent' ? name : 'You'), h('span', '', line.pending ? '' : ago(line.at)));
        row.append(who);
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
    const postComment = async (id, text) => {
      if (!(state?.marks ?? []).some((m) => m.id === id)) {
        // Its first line: the pin is kept now, then the words go in it.
        const mark = M.get(id);
        if (mark) await ask('PUT', route('/marks'), { mark }).catch(() => null);
        M.keepNow(id);
      }
      return settled(ask('POST', route('/comment'), { id, text }));
    };

    const thread = h('div', 'marble-build-thread');
    thread.setAttribute('role', 'dialog');
    thread.setAttribute('aria-label', 'Comment');
    thread.hidden = true;
    layer.append(thread);
    let threadFor = null;
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
      // What is half written survives the thread being drawn again.
      const was = thread.querySelector('textarea');
      const draft = was?.value ?? '';
      const typing = Boolean(was && document.activeElement === was);
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
      const compose = h('form', 'marble-build-compose');
      const input = h('textarea');
      input.placeholder = lines.length ? 'Reply' : 'Add a comment';
      input.setAttribute('aria-label', input.placeholder);
      const post = h('button', 'marble-build-round');
      post.type = 'submit';
      post.innerHTML = ICON.send;
      post.setAttribute('aria-label', 'Post');
      post.setAttribute('aria-disabled', 'true');
      input.addEventListener('input', () => post.setAttribute('aria-disabled', String(!input.value.trim())));
      compose.append(input, post);
      // The card widens with the longest line, 300 to 440px, then wraps.
      const fit = growing(input, {
        onWidth: (chars) => {
          thread.style.setProperty('--thread-w', `${Math.round(Math.min(440, Math.max(300, chars * 7.4 + 70)))}px`);
          placeThread();
        },
        onSend: () => compose.requestSubmit(),
      });
      if (draft) { input.value = draft; post.setAttribute('aria-disabled', String(!draft.trim())); requestAnimationFrame(fit); }
      if (typing) requestAnimationFrame(() => input.focus({ preventScroll: true }));
      compose.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text || !threadFor) return;
        const id = threadFor;
        input.value = '';
        fit();
        post.setAttribute('aria-disabled', 'true');
        // With the margin open the box that wrote it folds into its pin now,
        // and the comment is read in its card.
        if (side === 'comments') closeThread({ posting: true });
        await postComment(id, text);
        if (side === 'comments') dispatchEvent(new CustomEvent('marble-build:pick', { detail: { id } }));
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeThread(); }
      });
      thread.append(compose);
      thread.hidden = false;
      placeThread();
      if (focus) {
        // After the press that made the pin has let go: the release would
        // otherwise take the caret back to the page.
        const put = () => { if (input.isConnected) input.focus({ preventScroll: true }); };
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

    // ---------------------------------------------------- what it read

    let following = null; // { conversation, turn, off }
    const found = [];
    let workingAt = null;
    const docName = (p) => String(p ?? '').replace(/\.mrbl$/, '');
    const readWords = (name, input = {}) => {
      switch (name) {
        case 'read_document': {
          const p = docName(input.path);
          return { head: p === app ? 'Read this app' : `Read ${p.split('/').pop()}`, path: p };
        }
        case 'list_documents': return { head: 'Looked through your drive', path: input.folder || '' };
        case 'Read': return { head: `Read ${String(input.file_path ?? '').split('/').pop()}`, path: String(input.file_path ?? '') };
        case 'Grep': return { head: `Searched for "${clip(input.pattern, 40)}"`, path: String(input.path ?? input.glob ?? '') };
        case 'Glob': return { head: `Looked for ${clip(input.pattern, 40)}`, path: String(input.path ?? '') };
        case 'WebSearch': return { head: `Searched the web for "${clip(input.query, 40)}"`, path: '' };
        case 'WebFetch': {
          let host = '';
          try { host = new URL(input.url).host; } catch { host = clip(input.url, 40); }
          return { head: `Read ${host}`, path: clip(input.url, 80) };
        }
        default: return null;
      }
    };
    const linesOf = (summary) => {
      const text = String(summary ?? '').trim();
      if (!text || /^[[{]/.test(text)) return [];
      return text.split('\n').map((line) => line.replace(/^\s*\d+[:→-]\s?/, '').replace(/^[^:]{1,80}\.mrbl:\d+:/, '').trim())
        .filter((line) => line && line.length > 2).slice(0, 3).map((line) => clip(line, 80));
    };
    const anchorRect = () => {
      const node = workingAt ? document.querySelector(`[data-marble-id="${CSS.escape(workingAt)}"]`) : null;
      const r = node?.getBoundingClientRect();
      if (r?.width) return r;
      const main = document.querySelector('main, [role="main"]') ?? document.body;
      return main.getBoundingClientRect();
    };
    const placeFound = () => {
      if (!found.length) return;
      const r = anchorRect();
      const right = innerWidth - (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--marble-dock-right')) || 0);
      const besideRight = r.right + 14 + 250 <= right - 8;
      const besideLeft = r.left - 14 - 250 >= 8;
      let y = Math.max(12, Math.min(r.top, innerHeight - 200));
      const x = besideRight ? r.right + 14 : besideLeft ? r.left - 264 : Math.max(8, right - 262);
      // The marks on the app stay readable: a card that would land on one
      // goes under it.
      const marksThere = (state?.marks ?? []).map((m) => M.elementOf(m.id)?.getBoundingClientRect()).filter((b) => b?.width && b.right > x && b.left < x + 250);
      for (const card of found.filter((c) => !c.gone).slice(-3)) {
        const height = card.node.getBoundingClientRect().height || 60;
        for (const b of marksThere) if (y < b.bottom + 8 && y + height > b.top - 8) y = b.bottom + 10;
        card.node.style.left = `${Math.round(x)}px`;
        card.node.style.top = `${Math.round(y)}px`;
        y += height + 8;
      }
      for (const card of found.filter((c) => !c.gone).slice(0, -3)) card.node.dataset.gone = '';
    };
    const clearFound = (delay = 0) => {
      const cards = found.splice(0);
      setTimeout(() => {
        for (const card of cards) card.node.dataset.gone = '';
        setTimeout(() => { for (const card of cards) card.node.remove(); }, 400);
      }, delay);
    };
    const onTurnEvent = (event) => {
      if (!following || event.turn !== following.turn) return;
      if (event.type === 'tool.call') {
        const short = String(event.name ?? '').split('__').pop();
        if (!READS.has(short)) return;
        const words = readWords(short, event.input ?? {});
        if (!words) return;
        const node = h('div', 'marble-build-found');
        node.setAttribute('aria-hidden', 'true');
        const fh = h('div', 'fh');
        fh.innerHTML = /Searched|Looked/.test(words.head) ? ICON.search : ICON.read;
        fh.append(h('span', '', words.head));
        node.append(fh);
        if (words.path) node.append(h('div', 'fp', words.path));
        layer.append(node);
        found.push({ callId: event.callId, node, used: false, gone: false });
        placeFound();
        return;
      }
      if (event.type === 'tool.result') {
        const card = found.find((c) => c.callId === event.callId);
        if (!card) return;
        const lines = linesOf(event.summary);
        if (lines.length) {
          const list = h('ul');
          for (const line of lines) list.append(h('li', '', line));
          card.node.append(list);
          placeFound();
        }
        return;
      }
      if (event.type === 'ops.applied') {
        // What was read has gone into the part that landed.
        for (const card of found) if (!card.used) { card.used = true; card.node.dataset.used = ''; }
        return;
      }
      if (/^turn\.(completed|failed|cancelled)$/.test(event.type)) clearFound(1500);
    };
    const follow = (build) => {
      const turn = build?.status === 'running' ? build.turn : null;
      if (following?.turn === turn) return;
      following?.off?.();
      following = null;
      if (!turn || !build.conversation) return;
      agent.attend(build.conversation);
      following = { conversation: build.conversation, turn, off: agent.on(build.conversation, onTurnEvent) };
    };
    document.addEventListener('marble:presence', ({ detail }) => {
      if (!following || detail?.client !== `agent:${following.conversation}`) return;
      const now = detail.marks?.draw?.find((d) => d.as === 'now' || d.key)?.at;
      const at = now ?? detail.parts?.[0] ?? detail.ids?.[0] ?? null;
      if (at && at !== workingAt) { workingAt = at; placeFound(); }
    });

    // ------------------------------------------------------------- Pieces

    const pieces = h('aside', 'marble-build-pieces');
    pieces.setAttribute('aria-label', 'Pieces');
    pieces.hidden = true;
    layer.append(pieces);
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
    // Pieces and the margin (build-margin.js) take the right side where the
    // chat was, one at a time and never with the chat. Which has it is one
    // value, pieces, comments or none, kept per app in this browser, so the
    // rule that only one has it cannot be broken by what is stored. Docked,
    // it narrows the page the way the docked chat does (agent-ui.js dock());
    // on a phone it is a sheet from the foot and docks nothing.
    const SIDE_KEY = `marble-build:side:${app}`;
    const SIDES = new Set(['pieces', 'comments']);
    let side = 'none';
    // Whether the side took the place of the pinned chat, so putting the side
    // away gives the chat its place back.
    let tookChat = false;
    // Hide everything (⌘\) takes the side away with the bar, and bringing the
    // bar back brings it back.
    const frameOff = () => window.marbleShell?.layout?.frame === false;
    let frameHidden = frameOff();
    const sheet = matchMedia('(max-width: 620px), (hover: none) and (pointer: coarse)');
    // The side slides in from the edge and the app gives way beside it, in
    // the one motion and the one time; and the same out. The motion is on
    // the root only while it moves, as the shell's own docking does, so a
    // margin never trails anything else.
    let settling = 0;
    let docked = false;
    const dockSide = ({ animate = true } = {}) => {
      const shown = side !== 'none' && !frameHidden;
      const on = shown && !sheet.matches;
      let style = document.getElementById('marble-build-dock');
      const moving = animate && on !== docked && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      docked = on;
      clearTimeout(settling);
      if (!shown && !moving) { style?.remove(); return; }
      if (!style) {
        style = document.createElement('style');
        style.id = 'marble-build-dock';
        style.setAttribute(TRANSIENT, '');
        document.head.append(style);
      }
      // Said as well as taken, so chrome that centres on the page (Describe's
      // toolbar) centres on what is left of it.
      // As a sheet it docks nothing, and says how tall it is so Describe's
      // toolbar stands above it (the margin lowers it: --marble-build-sheet).
      const write = (motion) => {
        const ease = motion ? ` transition: margin 340ms ${EASE} !important;` : '';
        style.textContent = on
          ? `html { margin-inline-end: ${SIDE_W}px !important; --marble-dock-right: ${SIDE_W}px;${ease} }`
          : shown ? 'html { --marble-dock-bottom: var(--marble-build-sheet, min(62vh, 520px)); }'
          : `html { margin-inline-end: 0px !important;${ease} }`;
      };
      write(moving);
      if (moving) settling = setTimeout(() => { if (shown) write(false); else style.remove(); }, 400);
    };
    function setSide(next, { remember = true, byChat = false, reveal = true, animate = true } = {}) {
      const wanted = SIDES.has(next) ? next : 'none';
      // The marks are read in the margin while Describe is on; asking for it
      // turns Describe on first.
      if (wanted === 'comments' && !M.describing) M.setDescribing(true);
      // The side lives in the shell's frame: asking for it with the frame
      // hidden brings the frame back, as reaching for the chat does.
      if (wanted !== 'none' && frameHidden && reveal && window.marbleShell) {
        frameHidden = false;
        window.marbleShell.setOpen(true);
      }
      const was = side;
      side = wanted;
      if (remember) { try { localStorage.setItem(SIDE_KEY, side); } catch { /* private mode */ } }
      piecesOpen = side === 'pieces';
      slide(pieces, piecesOpen && !frameHidden);
      piecesButton.setAttribute('aria-pressed', String(piecesOpen));
      M.setMargin?.(side === 'comments' && !frameHidden);
      if (side !== 'none' && side !== was) {
        raise();
        // The chat gives the side up: unpinned in the shell, closed without.
        const shell = window.marbleShell;
        if (shell?.layout?.pinChat) { tookChat = true; shell.setChat(false); }
        else if (!shell) document.querySelector('marble-agent-drawer')?.close?.();
        if (piecesOpen) { piecesCache = null; drawPieces(); }
      }
      if (side === 'none' && was !== 'none') {
        if (tookChat && !byChat && remember) window.marbleShell?.setChat(true);
        tookChat = false;
      }
      dockSide({ animate: animate && remember });
      dispatchEvent(new CustomEvent('marble-build:side', { detail: { side, hidden: frameHidden } }));
      placeFound();
    }
    /** A button's press: shows its side, or puts it away when it is showing. */
    const toggleSide = (which) => setSide(side === which && !frameHidden ? 'none' : which);
    piecesButton.addEventListener('click', () => toggleSide('pieces'));
    addEventListener('marble-build:toggle-pieces', () => toggleSide('pieces'));
    addEventListener('marble-build:toggle-comments', () => toggleSide('comments'));
    sheet.addEventListener('change', dockSide);
    addEventListener('marble-shell:layout', (event) => {
      const layout = event.detail ?? {};
      // The chat pinned, or brought out on purpose (its button, ⌘J), takes
      // the side back.
      if ((layout.pinChat || layout.focusChat) && side !== 'none') setSide('none', { byChat: true, animate: false });
      const hidden = layout.frame === false;
      if (hidden !== frameHidden) {
        frameHidden = hidden;
        slide(pieces, piecesOpen && !frameHidden);
        M.setMargin?.(side === 'comments' && !frameHidden);
        dockSide();
        dispatchEvent(new CustomEvent('marble-build:side', { detail: { side, hidden: frameHidden } }));
      }
    });
    /** The side this app had last time, unless the chat has it now. */
    const restoreSide = () => {
      let kept = 'none';
      frameHidden = frameOff();
      try { kept = localStorage.getItem(SIDE_KEY) ?? 'none'; } catch { /* private mode */ }
      if (window.marbleShell?.layout?.pinChat) kept = 'none';
      if (kept === 'comments' && !M.describing) kept = 'none';
      if (SIDES.has(kept)) setSide(kept, { remember: false, reveal: false });
      else dispatchEvent(new CustomEvent('marble-build:side', { detail: { side: 'none', hidden: frameHidden } }));
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
      if (!on) { closePop(); closeThread(); sel.hidden = true; if (side === 'comments') setSide('none'); }
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
      follow(runningBuild());
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
        placeFound();
        placeHandle();
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
      act,
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
