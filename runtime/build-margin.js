// Build mode's margin: every mark on the app, read beside it, and how far
// each one has got.
//
// It is Docs' margin. A card for each mark (note, sketch, comment, piece)
// stands level with the part it is about, the app narrowed to make room
// (build-mode.js docks the side), and the one you pick comes level with its
// pin and steps toward the app. The build is carried on the marks: each pin
// says how its change is going, each card ends in one status line with the
// one control that fits, and on Building the cards are headed by the build's
// own card, its sentence, clock and the drawer's picture of the work. Nothing
// here names a job, a part or an agent; the app answers in its own name.
//
// While the margin is open Describe's layer carries data-margin: the bodies
// of notes and pieces leave the app and sketches fade, and the pins drawn
// here stand in for them, so the app reads clear and still shows where each
// thing is.
//
// Everything here is page-only (data-marble-transient): the marks are kept
// on the host (server/build), and the side, the filter and the pick are this
// browser's.
//
// Spec: Notes and Sketches/Build Mode (section 12, E); plan: Notes and
// Sketches/Build Mode Plan.

(() => {
  // ------------------------------------------------------------ the rules
  //
  // Pure, so test/build-margin.test.js can run them without a page.

  /** Where each card goes, as Docs places its comments. `items` are in page
   *  order, each { id, want, height }: `want` is the top that would put it
   *  level with its pin. Every card sits at its want unless the one above
   *  reaches it, then `gap` below that one; none goes above `head`. A picked
   *  card sits at its want and the ones above it move up out of its way, as
   *  far as `head` allows; past that, they pack down from `head`.
   *  Returns id → top. */
  function stackCards(items, { head = 0, gap = 8, picked = null } = {}) {
    const list = [...items].sort((a, b) => a.want - b.want);
    const tops = list.map((item) => Math.max(item.want, head));
    const down = (from) => {
      for (let i = from; i < list.length; i++) {
        if (i > 0) tops[i] = Math.max(list[i].want, head, tops[i - 1] + list[i - 1].height + gap);
      }
    };
    const p = picked == null ? -1 : list.findIndex((item) => item.id === picked);
    if (p < 0) down(1);
    else {
      // The ones above stack as they would with nothing picked, so cards
      // that crowd each other near the top settle among themselves first.
      for (let i = 1; i < p; i++) tops[i] = Math.max(list[i].want, head, tops[i - 1] + list[i - 1].height + gap);
      tops[p] = Math.max(list[p].want, head);
      // Then each moves up only as far as the one under it needs.
      for (let i = p - 1; i >= 0; i--) tops[i] = Math.min(tops[i], tops[i + 1] - gap - list[i].height);
      // No room above for all of them: they come down from the head only as
      // far as they must, and the picked one as near its pin as that leaves.
      if (tops[0] < head) {
        tops[0] = head;
        for (let i = 1; i <= p; i++) tops[i] = Math.max(tops[i], tops[i - 1] + list[i - 1].height + gap);
      }
      down(p + 1);
    }
    return new Map(list.map((item, i) => [item.id, Math.round(tops[i])]));
  }

  /** Where a mark stands, for its pin, its card's status line and the
   *  filter. `builds` are the build state's; `holds(partIds, anchorId)` says
   *  whether a part of the plan is about the mark's anchor (on a page, by
   *  containment); `name` is the app's, which is who answers.
   *
   *  { key, words, show: open|build|done, act, ring (0..1 or null) } */
  function statusOf(mark, { builds = [], holds = (ids, id) => ids.includes(id), name = 'The app' } = {}) {
    const out = (key, words, show, act = null, ring = null) => ({ key, words, show, act, ring });
    if (mark.type === 'comment') {
      const thread = mark.thread ?? [];
      const last = thread.at(-1);
      if (mark.resolved) return out('resolved', 'Resolved', 'done', 'reopen');
      if (last?.pending) return out('answering', `${name} is answering`, 'open');
      if (last?.who === 'agent' && last.offer && last.offer.taken === null) return out('asking', `${name} asked you`, 'open', 'offer');
      if (last?.who === 'agent') return out('answered', 'Answered', 'open', 'resolve');
      return out('sent', 'Waits for an answer', 'open', 'resolve');
    }
    if (mark.state === 'built') {
      const n = builds.find((b) => b.id === mark.build)?.n;
      return out('built', n ? `Done in Build ${n}` : 'Done', 'done');
    }
    if (mark.state === 'building') {
      const build = builds.find((b) => b.id === mark.build) ?? null;
      const parts = build?.plan?.parts ?? [];
      const part = parts.find((x) => x.state === 'now' && holds(x.ids ?? [], mark.anchorId))
        ?? parts.find((x) => holds(x.ids ?? [], mark.anchorId));
      const done = parts.filter((x) => x.state === 'done').length;
      const ring = part ? { ahead: 0.08, now: 0.5, done: 1 }[part.state] ?? 0.08 : parts.length ? Math.max(0.08, done / parts.length) : 0.08;
      if (build?.status === 'paused') return out('paused', 'Paused', 'build', null, ring);
      if (part?.state === 'done') return out('made', 'Made · the build carries on', 'build', null, ring);
      if (part?.state === 'now') return out('making', 'Being made', 'build', null, ring);
      if (part) return out('ahead', 'In this build · still to come', 'build', null, ring);
      return out('building', parts.length ? `In this build · ${done} of ${parts.length} parts made` : 'In this build', 'build', null, ring);
    }
    if (mark.held) return out('held', 'Held back', 'open', 'unhold');
    return out('waiting', 'Waits for the next build', 'open', 'hold');
  }

  // Run again (a page put back in place runs its scripts again), the margin
  // already there keeps its own.
  if (globalThis.marbleMargin?.toggle) return;
  globalThis.marbleMargin = { stackCards, statusOf };
  if (typeof document === 'undefined') return;

  // ------------------------------------------------------------ the page

  const TRANSIENT = 'data-marble-transient';
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';
  const W = 312;
  const CARD = 276;
  const HEAD = 52;
  const GAP = 8;
  const STEP = 12;
  const PIN_LIFT = 10;
  const SR_ONLY = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;';
  // The drawer's own phone (agent-ui.js PHONE): where the sidebar is a sheet.
  const PHONE = '(max-width: 719px)';

  const KIND = {
    note: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M3 2.5h10v7.5L9.5 13.5H3z"/><path d="M9.5 13.5V10H13"/></svg>',
    comment: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 2.5a5.5 5.5 0 1 1-2.6 10.3L2.5 13.5l.7-2.9A5.5 5.5 0 0 1 8 2.5z"/></svg>',
    stroke: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12.5c2-4.5 3.6-7 4.6-7 1.6 0 .2 5.6 1.8 5.6 1 0 2-1.4 2.6-4"/><path d="M11 3.5l1.5 1.5"/></svg>',
    piece: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2"/><path d="M11.25 9.25v4M9.25 11.25h4" stroke-linecap="round"/></svg>',
    // A part moved: the arrows of a move.
    move: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v11M2.5 8h11M8 2.5 6.5 4M8 2.5 9.5 4M8 13.5 6.5 12M8 13.5 9.5 12M2.5 8 4 6.5M2.5 8 4 9.5M13.5 8 12 6.5M13.5 8 12 9.5"/></svg>',
    plus: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
    // A box with its lid on: put away, kept.
    archive: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.25" y="3" width="11.5" height="3" rx="1"/><path d="M3.25 6v6.25c0 .55.45 1 1 1h7.5c.55 0 1-.45 1-1V6"/><path d="M6.5 8.75h3"/></svg>',
    back: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.75 4 5.75 8l4 4"/></svg>',
    trash: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.25c.04.42.39.75.81.75h4.18c.42 0 .77-.33.81-.75l.6-8.25"/></svg>',
    close: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
    send: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/></svg>',
  };
  const CHECK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.4 6.8 11 12 5' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\") center / 12px no-repeat";

  const STYLE = `
    /* ---- the margin: paper beside the app, docked where the chat docks. */
    /* A view of the chat's sidebar (agent-ui.js addView): it fills it, and
       the sidebar brings the edge, the width, the resize and the motion. */
    .marble-margin {
      position: relative; flex: 1; min-height: 0;
      pointer-events: auto; box-sizing: border-box; overflow: hidden;
    }
    .marble-margin * { box-sizing: border-box; }
    .marble-margin button { all: unset; box-sizing: border-box; cursor: pointer; }
    .marble-margin button:focus-visible { outline: 2px solid var(--b-mark); outline-offset: 1px; }

    /* Its head stays in reach while the cards go under it. */
    .marble-margin .mh {
      position: absolute; inset: 0 0 auto 0; height: ${HEAD}px; z-index: 2;
      display: flex; align-items: center; gap: 6px; padding: 0 8px 0 12px;
      background: var(--b-paper);
    }
    /* One list, every state in it: the head says how many of each. */
    .marble-margin .sum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; color: var(--b-muted); font-variant-numeric: tabular-nums; }
    .marble-margin .sum b { font-weight: 500; color: var(--b-ink); }
    .marble-margin .mh .sp { flex: 1; }
    .marble-margin .add { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 10px; border-radius: 8px; font-size: 13px; color: var(--b-ink); transition: background 200ms ${EASE}; }
    .marble-margin .add:hover { background: var(--b-paper-2); }
    .marble-margin .add:active { background: var(--b-paper-3); transition-duration: 110ms; }
    .marble-margin .add svg { width: 14px; height: 14px; color: var(--b-muted); }
    /* Archive: a card's own control, the head's way in, and its list. */
    .marble-margin .arc, .marble-margin .icon { width: 28px; height: 28px; border-radius: 7px; display: inline-grid; place-items: center; color: var(--b-muted); flex: none; transition: background 200ms ${EASE}, color 200ms ${EASE}; }
    .marble-margin .arc:hover, .marble-margin .icon:hover { background: var(--b-paper-2); color: var(--b-ink); }
    .marble-margin .arc svg, .marble-margin .icon svg { width: 15px; height: 15px; }
    .marble-margin-card .k .arc { width: 24px; height: 24px; margin: -4px -6px -4px auto; }
    .marble-margin-card .k .arc svg { color: currentColor; }
    .marble-margin .tray { display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 8px; border-radius: 8px; font-size: 12.5px; color: var(--b-muted); font-variant-numeric: tabular-nums; transition: background 200ms ${EASE}, color 200ms ${EASE}; }
    .marble-margin .tray:hover { background: var(--b-paper-2); color: var(--b-ink); }
    .marble-margin .tray svg { width: 15px; height: 15px; }
    .marble-margin .back { display: inline-flex; align-items: center; gap: 2px; height: 30px; padding: 0 8px 0 4px; border-radius: 8px; font-size: 13px; font-weight: 500; color: var(--b-ink); }
    .marble-margin .back:hover { background: var(--b-paper-2); }
    .marble-margin .back svg { width: 15px; height: 15px; color: var(--b-muted); }
    .marble-margin .gone { display: inline-flex; align-items: center; height: 30px; padding: 0 10px; border-radius: 8px; font-size: 12.5px; color: var(--b-muted); }
    .marble-margin .gone:hover { background: var(--b-paper-2); color: var(--b-ink); }
    .marble-margin[data-view="archive"] .cards, .marble-margin[data-view="archive"] .none { display: none; }
    .marble-margin .arch { position: absolute; inset: 0; overflow: auto; overscroll-behavior: contain; padding: 4px 18px 18px; display: none; flex-direction: column; gap: ${GAP}px; }
    .marble-margin[data-view="archive"] .arch { display: flex; }
    .marble-margin-old { padding: 9px 12px 8px; border-radius: 12px; background: var(--b-paper-2); font-size: 12.5px; line-height: 1.4; color: var(--b-muted); }
    .marble-margin-old .k { display: flex; align-items: center; gap: 6px; font-size: 11.5px; margin-bottom: 3px; min-width: 0; }
    .marble-margin-old .k svg { width: 13px; height: 13px; flex: none; }
    .marble-margin-old .k span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-margin-old .words { margin: 0; color: var(--b-ink); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .marble-margin-old .row { display: flex; align-items: center; gap: 6px; margin-top: 6px; min-height: 26px; font-size: 12px; }
    .marble-margin-old .row .w { flex: 1; min-width: 0; }
    .marble-margin-old .sb { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 7px; font-size: 12px; font-weight: 500; color: var(--b-ink); transition: background 200ms ${EASE}; }
    .marble-margin-old .sb:hover { background: var(--b-paper-3); }
    .marble-margin-old .icon { width: 24px; height: 24px; }
    .marble-margin-old .icon:hover { background: var(--b-paper-3); }
    .marble-margin .arch .empty { margin: 14px 0 0; text-align: center; font-size: 13px; color: var(--b-muted); }
    .marble-margin .shut { display: inline-grid; width: 30px; height: 30px; border-radius: 8px; place-items: center; color: var(--b-muted); }
    .marble-margin .shut:hover { background: var(--b-paper-2); color: var(--b-ink); }
    .marble-margin .shut svg { width: 15px; height: 15px; }

    /* The cards' ground scrolls with the page: one translate for all. */
    .marble-margin .ground { position: absolute; top: ${HEAD}px; left: 0; right: 0; bottom: 0; overflow: hidden; }
    .marble-margin .cards { position: absolute; inset: 0 0 auto 0; will-change: transform; }
    .marble-margin .none { position: absolute; top: 18px; left: 18px; right: 22px; margin: 0; color: var(--b-muted); font-size: 13px; line-height: 1.45; text-align: center; }

    /* ---- a card */
    .marble-margin-card {
      position: absolute; left: 18px; right: 18px; padding: 9px 12px 10px;
      background: var(--b-card); border: 1px solid var(--b-line); border-radius: 12px;
      box-shadow: var(--shadow, 0 1px 2px rgba(74,66,52,.05), 0 2px 4px rgba(74,66,52,.03));
      font-size: 12.5px; line-height: 1.4; color: var(--b-ink); cursor: pointer; outline: none;
      transition: top 340ms ${EASE}, left 200ms ${EASE}, box-shadow 200ms ${EASE}, opacity 200ms ${EASE};
    }
    .marble-margin[data-still] .marble-margin-card { transition: none; }
    .marble-margin-card[data-hot] { box-shadow: var(--shadow-rest, 0 1px 2px rgba(74,66,52,.06), 0 6px 16px rgba(74,66,52,.08)); }
    .marble-margin-card:focus-visible { box-shadow: 0 0 0 2px var(--b-mark); }
    /* Picked: stepped toward the app and shaded in the accent, as its pin is
       on the app. */
    .marble-margin-card[aria-expanded="true"] {
      left: ${18 - STEP}px; right: ${18 + STEP}px; cursor: default; box-shadow: var(--b-shadow);
      background: color-mix(in srgb, var(--b-accent) 20%, var(--b-card)); border-color: color-mix(in srgb, var(--b-mark) 40%, var(--b-line));
    }
    .marble-margin-card { transition: top 340ms ${EASE}, left 200ms ${EASE}, right 200ms ${EASE}, box-shadow 200ms ${EASE}, opacity 200ms ${EASE}, background 200ms ${EASE}, border-color 200ms ${EASE}; }
    /* In the build: tinted, the meter under it says how far its change is. */
    .marble-margin-card[data-show="build"] { border-color: color-mix(in srgb, var(--b-mark) 26%, var(--b-line)); }
    .marble-margin-card[data-show="build"]:not([aria-expanded="true"]) { background: color-mix(in srgb, var(--b-accent) 9%, var(--b-card)); }
    /* A note's words are written here as well as on the app. */
    .marble-margin-card .words[contenteditable] { cursor: text; border-radius: 6px; margin: 0 -4px; padding: 1px 4px; outline: none; transition: background 120ms ${EASE}; }
    .marble-margin-card .words[contenteditable]:hover { background: color-mix(in srgb, var(--b-ink) 4%, transparent); }
    .marble-margin-card .words[contenteditable]:focus { background: var(--b-card); box-shadow: 0 0 0 1px var(--b-accent), 0 0 0 3px var(--b-accent-soft); }
    .marble-margin-card .words:empty::before { content: "Say what you want here…"; color: var(--b-faint); }
    .marble-margin-card .atts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .marble-margin-card .atts img { display: block; height: 56px; max-width: 120px; object-fit: cover; border-radius: 6px; box-shadow: 0 0 0 1px var(--b-line); }
    .marble-margin-card .atts span { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 6px; background: var(--b-paper-2); color: var(--b-muted); font-size: 11.5px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-margin-card .k { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; font-size: 11.5px; color: var(--b-muted); min-width: 0; }
    .marble-margin-card .k svg { width: 13px; height: 13px; flex: none; color: var(--b-mark); }
    .marble-margin-card .k span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-margin-card .k .no { flex: none; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px 8px 8px 2px; background: var(--b-accent-soft); color: var(--b-mark); font: 650 9.5px/16px var(--b-ui); text-align: center; font-variant-numeric: tabular-nums; }
    .marble-margin-card .words { margin: 0; overflow-wrap: anywhere; }
    .marble-margin-card .marble-build-line { padding: 5px 0 0; }
    .marble-margin-card .marble-build-line .acts { display: none; }
    .marble-margin-card .marble-build-line p { margin: 2px 0 0; }
    .marble-margin-card:not([aria-expanded="true"]) :is(.words:not(:focus), .marble-build-line p) { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .marble-margin-card:not([aria-expanded="true"]) .marble-build-line:not(:first-child):not(:last-child) { display: none; }
    /* Done: faint, and folded to its first line until it is picked. */
    .marble-margin-card[data-show="done"] { background: var(--b-paper); box-shadow: none; }
    .marble-margin-card[data-show="done"] :is(.words, .marble-build-line p) { color: var(--b-muted); }
    .marble-margin-card[data-show="done"]:not([aria-expanded="true"]) :is(.words, .marble-build-line p) { -webkit-line-clamp: 1; }
    .marble-margin-card[data-show="done"]:not([aria-expanded="true"]) :is(.marble-build-line:not(:first-child), .stl) { display: none; }

    /* Its status: one line of words, and the one thing to do from there. */
    .marble-margin-card .stl { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--b-line); }
    .marble-margin-card .row { display: flex; align-items: center; gap: 7px; min-height: 26px; font-size: 12px; color: var(--b-muted); }
    .marble-margin-card .row .w { flex: 1; min-width: 0; }
    .marble-margin-card .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 1.5px var(--b-mark); }
    .marble-margin-card[data-key="held"] .dot { box-shadow: none; border: 1.5px dashed var(--b-faint); }
    .marble-margin-card:is([data-key="making"], [data-key="ahead"], [data-key="made"], [data-key="building"], [data-key="answered"], [data-key="answering"]) .dot { background: var(--b-mark); box-shadow: none; }
    .marble-margin-card:is([data-key="paused"], [data-key="asking"]) .dot { background: var(--b-caution); box-shadow: none; }
    .marble-margin-card:is([data-key="built"], [data-key="resolved"]) .dot { background: var(--b-faint); box-shadow: none; }
    .marble-margin-card .sb { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 7px; font-size: 12px; font-weight: 500; color: var(--b-ink); white-space: nowrap; transition: background 200ms ${EASE}; }
    .marble-margin-card .sb:hover { background: var(--b-paper-2); }
    .marble-margin-card .sb:active { background: var(--b-paper-3); transition-duration: 110ms; }
    .marble-margin-card .sb.primary { background: var(--b-ink); color: var(--b-card); }
    .marble-margin-card .sb.primary:hover { background: color-mix(in srgb, var(--b-ink) 84%, var(--b-card)); }
    .marble-margin-card .meter { height: 3px; margin: 3px 0 2px; border-radius: 2px; background: var(--b-line); overflow: hidden; }
    .marble-margin-card .meter i { display: block; height: 100%; width: var(--p, 8%); background: var(--b-mark); border-radius: 2px; transition: width 340ms ${EASE}; }
    .marble-margin-card[data-key="paused"] .meter i { background: var(--b-caution); }
    .marble-margin-card .offer { margin: 4px 0 0; color: var(--b-ink); }
    .marble-margin-card .ask { display: flex; gap: 6px; margin-top: 6px; }

    /* A waiting note's footer: its model and effort, and Send. */
    .marble-margin-card .nfoot { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
    .marble-margin-card .nfoot .sp { flex: 1; }
    .marble-margin-card .nfoot .model { display: inline-flex; align-items: center; gap: 3px; height: 24px; padding: 0 7px; border-radius: 7px; font-size: 12px; color: var(--b-muted); max-width: 170px; }
    .marble-margin-card .nfoot .model span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-margin-card .nfoot .model svg { width: 13px; height: 13px; flex: none; }
    .marble-margin-card .nfoot .model:hover { background: var(--b-paper-2); color: var(--b-ink); }
    .marble-margin-card .nfoot .send { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px 0 6px; border-radius: 999px;
      background: var(--b-mark); color: var(--b-card); font: 500 11px/1 var(--b-ui); }
    .marble-margin-card .nfoot .send:hover { background: color-mix(in srgb, var(--b-mark) 86%, var(--b-ink)); }
    .marble-margin-card .nfoot .send svg { width: 14px; height: 14px; }
    .marble-margin-card .nfoot .send kbd { font: inherit; opacity: .78; }
    .marble-margin-card[data-show="build"] .nfoot { display: none; }
    /* Its reply box, while it is picked. */
    .marble-margin-card .reply { display: none; align-items: flex-end; gap: 6px; margin-top: 8px; padding: 4px 4px 4px 10px; border: 1px solid var(--b-line); border-radius: 10px; background: var(--b-card); }
    .marble-margin-card[aria-expanded="true"] .reply { display: block; }
    .marble-margin-card .reply { border: 0; padding: 0; background: none; }
    .marble-margin-card .reply .marble-build-write { margin: 0; }
    .marble-margin-card .reply textarea { all: unset; flex: 1; min-width: 0; font-size: 12.5px; line-height: 18px; padding: 2px 0; color: var(--b-ink); white-space: pre-wrap; overflow-wrap: anywhere;
      field-sizing: content; min-height: 22px; max-height: 30vh; overflow-y: auto; }
    .marble-margin-card .reply textarea::placeholder { color: var(--b-faint); }
    .marble-margin-card .reply button { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; background: var(--b-ink); color: var(--b-card); }
    .marble-margin-card .reply button[aria-disabled="true"] { opacity: .3; cursor: default; }
    .marble-margin-card .reply svg { width: 13px; height: 13px; }

    /* ---- the build's status (build-mode.js statusCard), heading the list
       while a build is in hand, and the last one to end under them. */
    .marble-margin .marble-bst { position: absolute; left: 18px; right: 18px; z-index: 1; }
    .marble-margin .marble-bst[data-folded]:not([data-open]) .bst-pic { display: none; }

    /* ---- the pins: each mark's number on the app, and how it is going. */
    .marble-margin-pins { position: fixed; inset: 0; pointer-events: none; }
    .marble-margin-pin {
      all: unset; box-sizing: border-box; position: fixed; width: 22px; height: 22px; transform: translate(0, -100%);
      border-radius: 50% 50% 50% 3px; pointer-events: auto; cursor: pointer;
      background: var(--b-card); color: var(--b-mark); box-shadow: inset 0 0 0 1.5px var(--b-mark), 0 1px 3px rgba(0,0,0,.14);
      font: 650 10.5px/22px var(--b-ui); text-align: center; font-variant-numeric: tabular-nums;
      transition: scale 140ms ${EASE}, opacity 200ms ${EASE}, background 200ms ${EASE}, color 200ms ${EASE};
    }
    .marble-margin-pin:hover, .marble-margin-pin[data-hot], .marble-margin-pin:focus-visible { scale: 1.12; outline: none; }
    /* The mark appears where the note folded into it, and its pick is the
       same accent shade as its card. */
    @starting-style { .marble-margin-pin { scale: .4; opacity: 0; } }
    .marble-margin-pin[data-picked] { scale: 1.15; z-index: 1; }
    .marble-margin-pin[data-picked]:not([data-key="built"]):not([data-key="resolved"]) { background: color-mix(in srgb, var(--b-accent) 45%, var(--b-card)); color: var(--b-ink); box-shadow: inset 0 0 0 1.5px var(--b-mark), 0 0 0 4px color-mix(in srgb, var(--b-accent) 30%, transparent), 0 1px 3px rgba(0,0,0,.14); }
    .marble-margin-pin[data-key="held"] { box-shadow: none; border: 1.5px dashed var(--b-mark); line-height: 19px; }
    /* In the build, or a comment answered: filled. */
    .marble-margin-pin:is([data-key="making"], [data-key="ahead"], [data-key="made"], [data-key="building"], [data-key="paused"], [data-key="answered"], [data-key="answering"], [data-key="asking"], [data-key="sent"]) { background: var(--b-mark); color: var(--b-card); box-shadow: 0 1px 3px rgba(0,0,0,.18); }
    /* The ring is a meter, so its fill is the one place a sweep is the
       honest drawing: how much of this mark's change is made. */
    .marble-margin-pin[data-ring]::after {
      content: ""; position: absolute; inset: -5px; border-radius: 50%; pointer-events: none;
      background: conic-gradient(var(--b-mark) var(--p, 0%), color-mix(in srgb, var(--b-mark) 22%, transparent) 0);
      -webkit-mask: radial-gradient(circle, transparent 12.5px, black 13px); mask: radial-gradient(circle, transparent 12.5px, black 13px);
    }
    .marble-margin-pin[data-key="paused"] { background: var(--b-caution); }
    .marble-margin-pin[data-key="paused"]::after { background: conic-gradient(var(--b-caution) var(--p, 0%), color-mix(in srgb, var(--b-caution) 22%, transparent) 0); }
    /* The app asked you something. */
    .marble-margin-pin[data-key="asking"]::before { content: ""; position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--b-caution); box-shadow: 0 0 0 2px var(--b-card); }
    /* Done and brought back from the archive: faint, its number and nothing
       more. */
    .marble-margin-pin:is([data-key="built"], [data-key="resolved"]) { opacity: .45; box-shadow: inset 0 0 0 1px var(--b-faint); color: var(--b-muted); }
    .marble-margin-pin[hidden] { display: none; }
    .marble-margin-pin { touch-action: none; }
    .marble-margin-pin[data-carried] { cursor: grabbing; scale: 1.2; box-shadow: 0 6px 16px rgba(0,0,0,.22); transition: scale 140ms ${EASE}; }


    /* ---- on a phone the sidebar is a sheet from the foot: the cards in page
       order, scrolled on their own. */
    .marble-margin[data-sheet] .ground { overflow: auto; overscroll-behavior: contain; }
    .marble-margin[data-sheet] .cards { position: static; transform: none !important; display: flex; flex-direction: column; gap: ${GAP}px; padding: 4px 12px 16px; }
    .marble-margin[data-sheet] :is(.marble-margin-card, .marble-bst) { position: relative; top: auto !important; left: auto; right: auto; }
    .marble-margin[data-sheet] .marble-margin-card[aria-expanded="true"] { left: auto; right: auto; }
    .marble-margin[data-sheet] .none { position: static; padding: 12px 18px; }

    @media (prefers-reduced-motion: reduce) {
      .marble-margin, .marble-margin *, .marble-margin-pin { transition: opacity 150ms linear !important; }
    }
  `;

  const h = (tag, className = '', text = null) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.setAttribute(TRANSIENT, '');
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (className, label, html = null) => {
    const node = h('button', className);
    node.type = 'button';
    if (html) { node.innerHTML = html; if (label) node.append(label); } else node.textContent = label;
    return node;
  };
  const clip = (text, n) => { const t = String(text ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const clock = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const byId = (id) => (id ? document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`) : null);
  /** On a page, a part of the plan is about a mark when one holds the other. */
  const holds = (ids, anchorId) => {
    const anchor = byId(anchorId);
    if (!anchor) return ids.includes(anchorId);
    return ids.some((id) => {
      if (id === anchorId) return true;
      const part = byId(id);
      return Boolean(part && (part.contains(anchor) || anchor.contains(part)));
    });
  };

  const boot = () => {
    const M = window.marbleMarks;
    const B = window.marbleBuild;
    const layer = document.querySelector('.marble-build-layer');
    if (!M || !B || !layer) return false;
    if (layer.querySelector('.marble-margin')) return true;

    const style = h('style');
    style.textContent = STYLE;
    document.head.append(style);

    // The margin goes first in Build mode's layer, so its tips, the floating
    // thread and the bar on a pick all paint over it.
    const pins = h('div', 'marble-margin-pins');
    const panel = h('section', 'marble-margin');
    panel.setAttribute('aria-label', 'Marks');
    pins.hidden = true;
    layer.prepend(pins);
    B.addView('marks', panel, STYLE);
    // What has the caret, inside the sidebar's shadow root as well.
    const active = () => panel.getRootNode()?.activeElement ?? document.activeElement;

    // Every mark in one list, in the order they stand on the app; how far
    // each has got is in how its card is drawn. The head counts them.
    const head = h('div', 'mh');
    const sum = h('span', 'sum');
    sum.setAttribute('role', 'status');
    const add = button('add', 'Note', KIND.plus);
    B.tip(add, 'Press a part of the app to write on it: keep it as a note, or send it with ⌘↵');
    add.addEventListener('click', () => { unpick(); M.setMode('text'); });
    const shut = button('shut', '', KIND.close);
    shut.setAttribute('aria-label', 'Close');
    shut.addEventListener('click', () => B.setSide('none'));
    const tray = button('tray', '', KIND.archive);
    const trayCount = h('span', '');
    tray.append(trayCount);
    B.tip(tray, 'Archived marks: built, resolved and put away. Bring one back or delete it there.');
    tray.addEventListener('click', () => setView('archive'));
    head.append(sum, h('span', 'sp'), tray, add, shut);
    // The Archived list's own head: the way back, and clearing it out.
    const back = button('back', 'Archived', KIND.back);
    back.setAttribute('aria-label', 'Back to the marks');
    back.addEventListener('click', () => setView('marks'));
    const gone = button('gone', 'Delete all');
    B.tip(gone, 'Delete every archived mark. Undo brings them back.');
    gone.addEventListener('click', () => {
      const ids = archived().map((m) => m.id);
      if (ids.length) M.remove(ids);
    });
    const ground = h('div', 'ground');
    const cards = h('div', 'cards');
    const none = h('p', 'none');
    none.setAttribute('role', 'status');
    const arch = h('div', 'arch');
    arch.setAttribute('aria-label', 'Archived marks');
    ground.append(cards, none, arch);
    panel.append(head, ground);

    // ------------------------------------------------------------ the state

    let open = false;
    let picked = null;
    let extra = 0;
    const sheet = matchMedia(PHONE);
    const cardOf = new Map(); // id → { node, pin, status, sig }
    const writers = new Map(); // comment id → its reply box (build-mode.js composer)
    let buildCard = null;

    const marks = () => {
      const server = new Map((B.state()?.marks ?? []).map((m) => [m.id, m]));
      const here = M.list();
      // What the page has, as the host keeps it where it has it; in the order
      // they were made, which is what the pins count by.
      return here.map((m) => ({ ...m, ...(server.get(m.id) ?? {}), archived: Boolean(m.archived) })).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    };
    const archived = () => marks().filter((m) => m.archived);
    let view = 'marks';
    function setView(next) {
      view = next === 'archive' ? 'archive' : 'marks';
      panel.dataset.view = view;
      if (view === 'archive') unpick();
      draw();
      if (view === 'archive') back.focus({ preventScroll: true });
      else tray.focus({ preventScroll: true });
    }
    const statusFor = (mark) => statusOf(mark, { builds: B.state()?.builds ?? [], holds, name: B.name });

    const partName = (id) => {
      const node = byId(id);
      if (!node || node === document.body || node === document.documentElement) return 'the app';
      const label = node.getAttribute('aria-label')
        || node.querySelector(':scope > :is(h1, h2, h3, h4, h5, legend, caption, label, summary)')?.textContent
        || node.querySelector('h1, h2, h3, h4, h5, legend, caption, th')?.textContent
        || node.textContent;
      return clip(label, 30) || 'the app';
    };
    const kindOf = (mark) => {
      if (mark.type === 'note') return mark.first ? 'Your prompt' : 'Note';
      if (mark.type === 'comment') return 'Comment';
      if (mark.type === 'piece') return 'Piece';
      if (mark.type === 'move') return 'Move';
      if (mark.kind === 'box') return 'Box';
      if (mark.kind === 'arrow') return 'Arrow';
      return 'Sketch';
    };
    const whereOf = (mark) => {
      if (mark.type === 'stroke' && mark.kind === 'arrow') return `from ${partName(mark.from)} to ${partName(mark.to)}`;
      if (mark.type === 'stroke' && mark.kind === 'box') return `around ${partName(mark.ids?.[0] ?? mark.anchorId)}`;
      return `on ${partName(mark.anchorId)}`;
    };
    const wordsOf = (mark) => {
      if (mark.type === 'note') return mark.text || 'An empty note';
      if (mark.type === 'piece') return mark.piece?.title ? `Put “${mark.piece.title}” here` : 'A piece to put here';
      if (mark.type === 'move') return mark.text ? `Move “${clip(mark.text, 60)}” here` : 'Move this part here';
      if (mark.type === 'stroke') return mark.kind === 'arrow' ? 'Move this there' : mark.kind === 'box' ? 'A box drawn around it' : 'Drawn over it';
      return '';
    };

    /** Where a mark's pin goes, on screen: its point on the app; a sketch's
     *  is the top right of what was drawn. */
    const pointOf = (mark) => {
      if (mark.type === 'stroke') {
        const span = M.spanOf(mark.id);
        return span ? { x: span.left + span.width, y: span.top } : null;
      }
      const anchor = byId(mark.anchorId);
      if (!anchor) return null;
      const r = anchor.getBoundingClientRect();
      return { x: r.left + (mark.u ?? 0) * r.width, y: r.top + (mark.v ?? 0) * r.height };
    };

    // ------------------------------------------------------------ the cards

    // A press on a card's control does its one thing and does not also pick
    // the card.
    const tapper = (node, fn, title) => {
      node.addEventListener('click', (event) => { event.stopPropagation(); fn(); });
      if (title) B.tip(node, title);
      return node;
    };

    const drawCard = (mark, n, status) => {
      const card = h('article', 'marble-margin-card');
      card.tabIndex = 0;
      card.dataset.id = mark.id;
      const kind = h('div', 'k');
      kind.innerHTML = KIND[mark.type] ?? KIND.note;
      const no = h('b', 'no', String(n));
      no.setAttribute('aria-hidden', 'true');
      kind.prepend(no);
      kind.append(h('span', '', `${kindOf(mark)} · ${whereOf(mark)}`));
      if (mark.state !== 'building') {
        const put = tapper(button('arc', '', KIND.archive), () => B.archive([mark.id], true), 'Archive: off the app, kept under Archived');
        put.setAttribute('aria-label', `Archive ${kindOf(mark).toLowerCase()} ${n}`);
        kind.append(put);
      }
      card.append(kind);
      if (mark.type === 'comment') {
        const lines = h('div', 'lines');
        B.drawLines(lines, mark);
        card.append(lines);
      } else if (mark.type === 'note') {
        const words = h('p', 'words', mark.text ?? '');
        // Written here as well as on the app, while it waits for a build.
        if ((mark.state ?? 'waiting') === 'waiting') {
          words.contentEditable = 'plaintext-only';
          if (words.contentEditable !== 'plaintext-only') words.contentEditable = 'true';
          words.setAttribute('role', 'textbox');
          words.setAttribute('aria-multiline', 'true');
          words.setAttribute('aria-label', `Note ${n}`);
          words.spellcheck = true;
          let typed = 0;
          const save = () => { clearTimeout(typed); const text = words.innerText.trim(); if (text !== (mark.text ?? '')) M.edit(mark.id, text); };
          words.addEventListener('focus', () => { if (picked !== mark.id) pick(mark.id, { keepFocus: true }); });
          words.addEventListener('input', () => { clearTimeout(typed); typed = setTimeout(save, 500); });
          words.addEventListener('blur', save);
          words.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); words.blur(); }
          });
        } else if (!mark.text) words.textContent = wordsOf(mark);
        card.append(words);
        if (mark.images?.length || mark.clips?.length) {
          const atts = h('div', 'atts');
          for (const image of mark.images ?? []) {
            const img = h('img');
            img.alt = 'A pasted picture';
            img.loading = 'lazy';
            img.src = `/agent/builds/image?name=${encodeURIComponent(image.name)}`;
            atts.append(img);
          }
          for (const clip of mark.clips ?? []) atts.append(h('span', '', clip.text ? `Pasted part · ${clip.text}` : 'Pasted part'));
          card.append(atts);
        }
      } else card.append(h('p', 'words', wordsOf(mark)));

      const stl = h('div', 'stl');
      const row = h('div', 'row');
      row.append(h('span', 'dot'), h('span', 'w', status.words));
      let control = null;
      if (status.act === 'hold') control = tapper(button('sb', 'Hold back'), () => B.hold(mark.id, true), 'Leave it out of the next build');
      else if (status.act === 'unhold') control = tapper(button('sb', 'Put back'), () => B.hold(mark.id, false), 'Back in the next build');
      else if (status.act === 'resolve') control = tapper(button('sb', 'Resolve'), () => B.resolve(mark.id, true), 'Put it under Done');
      else if (status.act === 'reopen') control = tapper(button('sb', 'Reopen'), () => B.resolve(mark.id, false), 'Back under Open');
      if (control) row.append(control);
      stl.append(row);
      if (status.ring != null) {
        const meter = h('div', 'meter');
        meter.setAttribute('aria-hidden', 'true');
        const fill = h('i');
        fill.style.setProperty('--p', `${Math.round(status.ring * 100)}%`);
        meter.append(fill);
        stl.append(meter);
      }
      if (status.act === 'offer') {
        const offer = mark.thread?.at(-1)?.offer;
        if (offer?.text) stl.append(h('p', 'offer', offer.text));
        const ask = h('div', 'ask');
        ask.append(
          tapper(button('sb primary', 'Build that'), () => B.takeOffer(mark.id, true), 'Add it to the next build as a note'),
          tapper(button('sb', 'Not now'), () => B.takeOffer(mark.id, false), 'Leave the app as it is'),
        );
        stl.append(ask);
      }
      card.append(stl);

      if (mark.type === 'comment') {
        // The same box as everywhere a thing is written: words, pasted
        // pictures, Send (⌘↵). One per comment, kept across redraws.
        let write = writers.get(mark.id);
        if (!write) {
          write = B.composer({
            placeholder: 'Ask more, or say what to change',
            label: `Reply to comment ${n}`,
            onSend: ({ text, images }) => B.comment(mark.id, text, images),
          });
          writers.set(mark.id, write);
        }
        const reply = h('div', 'reply');
        reply.append(write.node);
        card.append(reply);
      }
      // A note waiting for a build: the note's own footer, its model and
      // effort, and Send (to be answered or made now, or queued behind a
      // running build).
      if (mark.type === 'note' && (mark.state ?? 'waiting') === 'waiting') {
        const foot = h('div', 'nfoot');
        const model = button('model', '');
        model.append(h('span', '', 'Model'));
        model.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6.5 8 9.5l3-3"/></svg>');
        model.addEventListener('click', (event) => { event.stopPropagation(); M.pickModel?.(mark.id, model); });
        M.paintModelOn?.(mark.id, model);
        const send = button('send', '');
        send.innerHTML = `${M.sendGlyph ?? KIND.send}<kbd>${M.MOD ?? '⌘'}↵</kbd>`;
        send.setAttribute('aria-label', B.current() ? 'Queue: make it once the running build is done' : 'Send: ask it, or have it made now');
        send.title = B.current() ? 'Queue it behind the running build' : 'Ask it, or have it made now';
        send.addEventListener('click', (event) => { event.stopPropagation(); M.send?.(mark.id); });
        foot.append(model, h('span', 'sp'), send);
        card.append(foot);
      }

      card.addEventListener('click', (event) => {
        if (event.target.closest('button, input, textarea, a, [contenteditable]')) return;
        pick(picked === mark.id ? null : mark.id);
      });
      card.addEventListener('keydown', (event) => {
        if (mark.type === 'note' && event.ctrlKey && event.altKey && !event.metaKey) {
          const step = { ArrowLeft: ['model', -1], ArrowRight: ['model', 1], ArrowUp: ['effort', 1], ArrowDown: ['effort', -1] }[event.key];
          if (step) { event.preventDefault(); event.stopPropagation(); M.stepModel?.(mark.id, ...step); return; }
        }
        if (mark.type === 'note' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); M.send?.(mark.id); return; }
        if (event.target !== card) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(picked === mark.id ? null : mark.id); }
      });
      card.addEventListener('pointerenter', () => hot(mark.id, true));
      card.addEventListener('pointerleave', () => hot(mark.id, false));
      return card;
    };

    const drawPin = (mark, n) => {
      const pin = button('marble-margin-pin', String(n));
      pin.dataset.id = mark.id;
      // A press picks it; a drag carries the mark, folded as it is, to
      // another place on the app (agent-marks.js placeAt).
      let carried = false;
      pin.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const entry = cardOf.get(mark.id);
        if (!entry || entry.status?.show === 'build') return;
        const x0 = event.clientX;
        const y0 = event.clientY;
        const left0 = Number.parseFloat(pin.style.left) || 0;
        const top0 = Number.parseFloat(pin.style.top) || 0;
        carried = false;
        pin.setPointerCapture?.(event.pointerId);
        const move = (e) => {
          if (!carried && Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
          carried = true;
          pin.setAttribute('data-carried', '');
          pin.style.left = `${Math.round(left0 + e.clientX - x0)}px`;
          pin.style.top = `${Math.round(top0 + e.clientY - y0)}px`;
        };
        const up = (e) => {
          pin.removeEventListener('pointermove', move);
          pin.removeEventListener('pointerup', up);
          pin.removeEventListener('pointercancel', up);
          pin.removeAttribute('data-carried');
          if (carried && e.type === 'pointerup') M.placeAt?.(mark.id, left0 + e.clientX - x0, top0 + e.clientY - y0);
          schedule();
        };
        pin.addEventListener('pointermove', move);
        pin.addEventListener('pointerup', up);
        pin.addEventListener('pointercancel', up);
      });
      pin.addEventListener('click', (event) => {
        event.stopPropagation();
        if (carried) { carried = false; return; }
        pick(picked === mark.id ? null : mark.id);
      });
      pin.addEventListener('pointerenter', () => hot(mark.id, true));
      pin.addEventListener('pointerleave', () => hot(mark.id, false));
      return pin;
    };

    const hot = (id, on) => {
      const entry = cardOf.get(id);
      entry?.node.toggleAttribute('data-hot', on);
      entry?.pin.toggleAttribute('data-hot', on);
    };

    // Every build in hand (running, or waiting paused) heads the list as its
    // status in three layers (build-mode.js statusCard), newest first; builds
    // can run side by side. Under them, the last build to end stays, with its
    // summary, until another ends; History keeps every one.
    const statusCards = new Map(); // build id → statusCard
    const drawBuild = (list = []) => {
      const hand = [...(B.inHand?.() ?? [B.current()].filter(Boolean))].reverse();
      const last = B.lastEnded?.();
      if (last && !hand.some((b) => b.id === last.id)) hand.push(last);
      // Once the person is marking for the next build, the last one folds to
      // its line; pressed, it opens on its summary again.
      const marking = Boolean(last?.endedAt) && list.some((m) => (m.at ?? 0) > last.endedAt);
      const keep = new Set(hand.map((b) => b.id));
      for (const [id, card] of statusCards) if (!keep.has(id)) { card.node.remove(); statusCards.delete(id); }
      let after = null;
      for (const b of hand) {
        let card = statusCards.get(b.id);
        if (!card) { card = B.statusCard(); statusCards.set(b.id, card); }
        card.update(b);
        card.node.toggleAttribute('data-folded', b.id === last?.id && marking);
        if (after) after.after(card.node); else cards.prepend(card.node);
        after = card.node;
      }
      buildCard = hand.length ? { node: { get offsetHeight() { return stackHeight(); } }, id: () => hand[0].id } : null;
    };
    const stackHeight = () => {
      let height = 0;
      for (const card of statusCards.values()) height += card.node.offsetHeight + GAP;
      return Math.max(0, height - GAP);
    };

    // ------------------------------------------------------------ archive

    /** The Archived list: what was built, resolved or put away, newest first,
     *  each with Put back and Delete. Only the margin draws it; nothing of it
     *  is on the app. */
    let headView = null;
    function drawArchive(list) {
      trayCount.textContent = String(list.length);
      tray.setAttribute('aria-label', `Archived marks: ${list.length}`);
      tray.hidden = !list.length;
      if (view === 'archive' && !list.length) { view = 'marks'; panel.dataset.view = view; }
      if (headView !== view) {
        headView = view;
        if (view === 'archive') head.replaceChildren(back, h('span', 'sp'), gone, shut);
        else head.replaceChildren(sum, h('span', 'sp'), tray, add, shut);
      }
      if (view !== 'archive') return;
      const builds = B.state()?.builds ?? [];
      const rows = [...list].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).map((mark) => {
        const card = h('article', 'marble-margin-old');
        card.dataset.id = mark.id;
        const kind = h('div', 'k');
        kind.innerHTML = KIND[mark.type] ?? KIND.note;
        kind.append(h('span', '', `${kindOf(mark)} · ${whereOf(mark)}`));
        const words = mark.type === 'comment'
          ? (mark.thread ?? []).find((line) => line.text)?.text ?? 'A comment'
          : mark.type === 'note' ? (mark.text || 'An empty note') : wordsOf(mark);
        const row = h('div', 'row');
        const n = builds.find((b) => b.id === mark.build)?.n;
        const was = mark.type === 'comment' && mark.resolved ? 'Resolved'
          : mark.state === 'built' ? (n ? `Done in Build ${n}` : 'Done') : 'Archived';
        const put = tapper(button('sb', 'Put back'), () => {
          if (mark.type === 'comment' && mark.resolved) B.resolve(mark.id, false);
          else B.archive([mark.id], false);
        }, 'Back on the app and in the list');
        const del = tapper(button('icon', '', KIND.trash), () => M.remove([mark.id]), 'Delete it. Undo brings it back.');
        del.setAttribute('aria-label', `Delete this ${kindOf(mark).toLowerCase()}`);
        row.append(h('span', 'w', was), put, del);
        card.append(kind, h('p', 'words', words), row);
        return card;
      });
      arch.replaceChildren(...rows);
      if (!rows.length) arch.append(h('p', 'empty', 'Nothing archived.'));
    }

    // ------------------------------------------------------------ drawing

    let order = [];
    const draw = () => {
      if (!open) return;
      const all = marks();
      const list = all.filter((m) => !m.archived);
      drawArchive(all.filter((m) => m.archived));
      const live = new Set();
      order = [];
      list.forEach((mark, i) => {
        const n = i + 1;
        const status = statusFor(mark);
        const sig = JSON.stringify([n, status, mark.text, mark.thread, mark.resolved, mark.held, mark.anchorId, mark.piece?.title, B.name, mark.model, mark.effort, Boolean(B.current())]);
        let entry = cardOf.get(mark.id);
        // The card whose words are being written is left as it is.
        const writing = entry?.node.querySelector('.words[contenteditable]');
        if (entry && writing && active() === writing) entry.sig = sig;
        if (!entry || entry.sig !== sig) {
          const node = drawCard(mark, n, status);
          const focused = entry?.node.contains(active()) ? active() : null;
          const draft = '';
          if (entry) entry.node.replaceWith(node); else cards.append(node);
          const pin = entry?.pin ?? drawPin(mark, n);
          if (!entry) pins.append(pin);
          entry = { node, pin, status, sig, mark };
          cardOf.set(mark.id, entry);
          void draft;
          if (focused?.closest?.('.marble-build-write')) writers.get(mark.id)?.focus();
          else if (focused) node.focus({ preventScroll: true });
        }
        entry.mark = mark;
        entry.status = status;
        const { node, pin } = entry;
        node.dataset.key = status.key;
        node.dataset.show = status.show;
        node.hidden = false;
        node.setAttribute('aria-expanded', String(picked === mark.id));
        node.setAttribute('aria-label', `${n}: ${kindOf(mark)} ${whereOf(mark)} · ${status.words}`);
        pin.textContent = String(n);
        pin.dataset.key = status.key;
        pin.toggleAttribute('data-ring', status.ring != null);
        if (status.ring != null) pin.style.setProperty('--p', `${Math.round(status.ring * 100)}%`);
        pin.toggleAttribute('data-picked', picked === mark.id);
        pin.setAttribute('aria-label', `${n}: ${kindOf(mark)} ${whereOf(mark)} · ${status.words}`);
        live.add(mark.id);
        order.push(mark.id);
      });
      for (const [id, entry] of cardOf) {
        if (live.has(id)) continue;
        entry.node.remove();
        entry.pin.remove();
        cardOf.delete(id);
        if (picked === id) picked = null;
      }
      drawBuild(list);
      none.hidden = list.length > 0 || Boolean(buildCard);
      none.textContent = all.length
        ? 'Nothing open on the app. What was built, resolved or put away is under Archived.'
        : 'Nothing on the app yet. Write on a part with Note, or select it: leave it as a note for the next build, or send it with ⌘↵ to have it answered or made now.';
      const count = { open: 0, build: 0, done: 0 };
      for (const id of order) count[cardOf.get(id).status.show] += 1;
      const said = [['open', 'open'], ['build', 'in the build'], ['done', 'done']].filter(([key]) => count[key]);
      sum.replaceChildren(...(said.length ? said.flatMap(([key, words], i) => [...(i ? [' · '] : []), h('b', '', String(count[key])), ` ${words}`]) : ['No marks yet']));
      place();
    };

    // ------------------------------------------------------------ placing

    let placing = 0;
    const schedule = () => { if (open && !placing) placing = requestAnimationFrame(() => { placing = 0; place(); }); };
    const place = () => {
      if (!open) return;
      const groundTop = ground.getBoundingClientRect().top;
      const items = [];
      for (const id of order) {
        const entry = cardOf.get(id);
        const point = pointOf(entry.mark);
        entry.pin.hidden = !point || !M.describing;
        if (point) {
          entry.pin.style.left = `${Math.round(point.x)}px`;
          entry.pin.style.top = `${Math.round(point.y)}px`;
        }
        if (entry.node.hidden) continue;
        // Its top level with the pin's top, in the page's terms, so one
        // translate moves them all with the scroll.
        const pinTop = point ? point.y - 22 : groundTop;
        items.push({ id, want: pinTop - PIN_LIFT - groundTop + scrollY, height: entry.node.offsetHeight });
      }
      if (panel.hasAttribute('data-sheet')) return;
      let floor = GAP;
      if (statusCards.size) {
        let top = GAP;
        for (const node of cards.querySelectorAll(':scope > .marble-bst')) {
          node.style.top = `${top}px`;
          top += node.offsetHeight + GAP;
        }
        floor = top;
      }
      const tops = stackCards(items, { head: floor, gap: GAP, picked });
      for (const [id, top] of tops) cardOf.get(id).node.style.top = `${top}px`;
      // What runs on below the foot of the page can still be reached: the
      // wheel over the margin takes the page as far as it goes, then the
      // cards the rest of the way.
      const last = Math.max(0, ...items.map((item) => (tops.get(item.id) ?? 0) + item.height));
      const room = ground.clientHeight;
      const end = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      maxExtra = Math.max(0, last + GAP * 2 - (end + room));
      extra = Math.min(extra, maxExtra);
      cards.style.transform = `translateY(${-(scrollY + extra)}px)`;
    };
    let maxExtra = 0;

    // ------------------------------------------------------------ picking

    /** The scrolling element a part of the app moves with: the nearest
     *  ancestor that scrolls, or the page. */
    const scrollerOf = (node) => {
      for (let el = node?.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        const y = getComputedStyle(el).overflowY;
        if ((y === 'auto' || y === 'scroll' || y === 'overlay') && el.scrollHeight > el.clientHeight + 1) return el;
      }
      return null;
    };
    function pick(id, { keepFocus = false } = {}) {
      picked = id && cardOf.has(id) ? id : null;
      for (const [key, entry] of cardOf) {
        entry.node.setAttribute('aria-expanded', String(key === picked));
        entry.pin.toggleAttribute('data-picked', key === picked);
      }
      place();
      const entry = picked && cardOf.get(picked);
      if (!entry) return;
      if (panel.hasAttribute('data-sheet')) {
        // On a phone: the app goes to the pin, and the sheet lowers so it shows.
        byId(entry.mark.anchorId)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        entry.node.scrollIntoView({ block: 'nearest' });
      } else {
        // The card sits level with its mark, so the mark has to be where the
        // card can be read beside it: in view, below the margin's head, with
        // room under it for the card above the toolbar. If it is not, the part
        // of the app it is on comes to it — the page, or whatever inside the
        // app scrolls — and the cards follow (place(), on the scroll).
        const point = pointOf(entry.mark);
        if (point) {
          const top = ground.getBoundingClientRect().top;
          const floor = (document.querySelector('.marble-marks-bar')?.getBoundingClientRect().top || innerHeight) - 12;
          const tall = Math.min(entry.node.offsetHeight, Math.max(0, floor - top - 40));
          const pinTop = point.y - 22 - PIN_LIFT;
          if (pinTop < top + 4 || pinTop + tall > floor) {
            const want = top + Math.max(24, Math.min((floor - top) / 4, floor - top - tall - 8)) + 22 + PIN_LIFT;
            const by = point.y - want;
            const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
            const inner = scrollerOf(byId(entry.mark.anchorId));
            if (inner) {
              // Inside the app first, then the page for what the app could
              // not take.
              const room = by > 0 ? inner.scrollHeight - inner.clientHeight - inner.scrollTop : -inner.scrollTop;
              const there = by > 0 ? Math.min(by, room) : Math.max(by, room);
              inner.scrollBy({ top: there, behavior });
              if (Math.abs(by - there) > 1) scrollBy({ top: by - there, behavior });
            } else {
              // Past the foot of the page the cards themselves move instead.
              scrollBy({ top: by, behavior });
            }
          }
        }
      }
      if (keepFocus) return;
      if (entry.mark.type === 'comment') requestAnimationFrame(() => writers.get(entry.mark.id)?.focus());
    }
    const unpick = () => { if (picked) pick(null); };

    // ------------------------------------------------------------ open, shut

    const sync = () => {
      const want = B.side === 'comments' && !B.sideHidden;
      panel.toggleAttribute('data-sheet', sheet.matches);
      if (want === open) { if (open) draw(); return; }
      open = want;
      pins.hidden = !open;
      if (!open) {
        picked = null;
        return;
      }
      panel.setAttribute('data-still', '');
      extra = 0;
      draw();
      requestAnimationFrame(() => requestAnimationFrame(() => panel.removeAttribute('data-still')));
    };

    addEventListener('marble-build:side', sync);
    addEventListener('marble-build:state', () => draw());
    addEventListener('marble-build:pick', (event) => {
      const id = event.detail?.id;
      if (!open || !id) return;
      draw();
      pick(id);
    });
    addEventListener('marble-marks:describing', () => schedule());
    M.onChange(() => { if (open) draw(); });
    sheet.addEventListener('change', sync);
    addEventListener('scroll', (event) => {
      if (!open) return;
      // The page itself: one translate. Anything inside it that scrolls
      // moves the parts the marks are on, so everything is placed again.
      if (event.target === document || event.target === document.documentElement) {
        if (scrollY < document.documentElement.scrollHeight - innerHeight - 1) extra = 0;
        cards.style.transform = `translateY(${-(scrollY + extra)}px)`;
      }
      schedule();
    }, { capture: true, passive: true });
    addEventListener('resize', schedule);
    new ResizeObserver(schedule).observe(document.documentElement);
    if (document.body) new ResizeObserver(schedule).observe(document.body);
    new ResizeObserver(schedule).observe(cards);
    ground.addEventListener('wheel', (event) => {
      if (panel.hasAttribute('data-sheet') || !maxExtra) return;
      const end = document.documentElement.scrollHeight - innerHeight;
      const dy = event.deltaY;
      if (dy > 0 && scrollY >= end - 1) {
        event.preventDefault();
        extra = Math.min(maxExtra, extra + dy);
        cards.style.transform = `translateY(${-(scrollY + extra)}px)`;
      } else if (dy < 0 && extra > 0) {
        event.preventDefault();
        extra = Math.max(0, extra + dy);
        cards.style.transform = `translateY(${-(scrollY + extra)}px)`;
      }
    }, { passive: false });

    // Esc lets go of a pick; a second Esc is Describe's.
    addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !open || !picked || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      const was = cardOf.get(picked)?.node;
      unpick();
      was?.focus({ preventScroll: true });
    }, true);
    // A press on the app, away from the marks, lets go too, as in Docs.
    addEventListener('pointerdown', (event) => {
      if (!open || !picked) return;
      const path = event.composedPath();
      // Build mode's own (the margin, its pins, a tip, the thread) and
      // Describe's toolbar keep it.
      if (path.includes(layer) || path.includes(panel) || path.some((node) => node?.classList?.contains?.('marble-marks-layer'))) return;
      unpick();
    }, true);

    // Defined, not assigned, so the getters stay live.
    Object.defineProperties(globalThis.marbleMargin, Object.getOwnPropertyDescriptors({
      get open() { return open; },
      get picked() { return picked; },
      pick,
      /** The status mark's press: the margin out, or put away. */
      toggle() {
        if (open) { B.setSide('none'); return; }
        B.setSide('comments');
      },
    }));
    sync();
    return true;
  };

  const start = () => { if (!boot()) addEventListener('marble-build:ready', boot, { once: true }); };
  start();
})();
